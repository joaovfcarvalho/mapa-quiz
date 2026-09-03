"use strict";
// Placar geral: um ranking público por configuração de jogo, sem login.
//
// Como funciona: ao iniciar uma partida o navegador pede ao servidor (uma
// Edge Function do Supabase) que a registre; o servidor devolve um número de
// partida e uma semente para os sorteios. Durante a partida o navegador
// anota um diário (o que foi digitado, onde clicou, quando pediu dica) e, ao
// fim, manda o diário: o servidor refaz a partida com o mesmo motor do jogo,
// mede o tempo pelo relógio dele e é a nota DELE que vai para o placar — a
// interface nunca envia uma pontuação, só o que o jogador fez.
//
// Sem conta nem senha: o jogador escolhe um apelido e o navegador guarda um
// "passe" aleatório que prende o apelido a ele (ninguém sobrescreve o recorde
// do "joao-o-craque" sem o passe); o passe viaja no backup completo. Sem
// `placar.url`/`placar.chave` em js/config.js nada disto roda e o jogo segue
// 100% local.
var PLACAR = (function () {
  var CFG = (window.MAPAQUIZ_CONFIG || {}).placar || {};
  var URL_BASE = String(CFG.url || "").replace(/\/+$/, "");
  var CHAVE_API = String(CFG.chave || "");
  var LS_NOME = "mapaquiz.placar.nome";
  var LS_PASSE = "mapaquiz.placar.passe";
  var TOP_N = 10;
  var CACHE_MS = 60 * 1000;
  var MAX_EVENTOS = 8000;
  var ativo = !!(URL_BASE && CHAVE_API && window.fetch && window.Promise);
  var cache = {}; // chave -> {quando, top, total}

  function lerLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravarLS(k, v) {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
  }

  // ---------------- apelido e passe ----------------
  function nomeSalvo() { return lerLS(LS_NOME) || ""; }
  function esquecerNome() { gravarLS(LS_NOME, null); }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  // O passe fica também em memória: se o localStorage estiver bloqueado, a
  // sessão inteira ainda usa um passe só.
  var passeMem = null;
  function passe() {
    var p = lerLS(LS_PASSE) || passeMem;
    if (!p) {
      p = uuid();
      gravarLS(LS_PASSE, p);
    }
    passeMem = p;
    return p;
  }

  // Mesmas regras do servidor: 2 a 20 caracteres, letras (com acento),
  // números, espaço, ponto, hífen e sublinhado. Navegador sem classes
  // Unicode em regex cai numa versão só com o alfabeto latino.
  var RE_NOME;
  try {
    RE_NOME = new RegExp("^[\\p{L}\\p{N} _.\\-]+$", "u");
  } catch (e) {
    RE_NOME = /^[A-Za-z0-9À-ɏ _.\-]+$/;
  }
  function validarNome(bruto) {
    var nome = String(bruto || "").replace(/\s+/g, " ").trim();
    if (nome.length < 2) return { erro: "O apelido precisa ter pelo menos 2 caracteres." };
    if (nome.length > 20) return { erro: "O apelido pode ter no máximo 20 caracteres." };
    if (!RE_NOME.test(nome)) {
      return { erro: "Use só letras, números, espaço, ponto, hífen ou sublinhado." };
    }
    return { nome: nome };
  }

  // ---------------- API ----------------
  function cabecalhos() {
    return {
      apikey: CHAVE_API,
      Authorization: "Bearer " + CHAVE_API,
      "Content-Type": "application/json",
    };
  }

  // Top N de uma configuração (leitura direta da tabela, via PostgREST):
  // [{nome, pct, placar, tempo_seg, atualizado_em}] e o total de jogadores.
  function top(chave, forcar) {
    if (!ativo) return Promise.reject(new Error("placar desligado"));
    var c = cache[chave];
    if (c && !forcar && Date.now() - c.quando < CACHE_MS) return Promise.resolve(c);
    var url = URL_BASE + "/rest/v1/placar?select=nome,pct,placar,tempo_seg,atualizado_em" +
      "&chave=eq." + encodeURIComponent(chave) +
      "&order=pct.desc,tempo_seg.asc,atualizado_em.asc&limit=" + TOP_N;
    var h = cabecalhos();
    h.Prefer = "count=exact";
    return fetch(url, { headers: h }).then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var faixa = resp.headers.get("Content-Range") || "";
      var total = parseInt(faixa.split("/")[1], 10);
      return resp.json().then(function (linhas) {
        var r = {
          quando: Date.now(),
          top: linhas,
          total: isNaN(total) ? linhas.length : total,
        };
        cache[chave] = r;
        return r;
      });
    });
  }

  // Chamada à Edge Function do placar (iniciar / encerrar / registrar).
  function chamar(corpo, timeoutMs) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 10000) : null;
    return fetch(URL_BASE + "/functions/v1/placar", {
      method: "POST",
      headers: cabecalhos(),
      body: JSON.stringify(corpo),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (resp) {
      if (timer) clearTimeout(timer);
      if (!resp.ok && resp.status !== 400) throw new Error("HTTP " + resp.status);
      return resp.json();
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  // ---------------- partida (diário) ----------------
  var partida = null; // {id, semente, chave, eventos, geracao}
  var geracao = 0;    // cresce a cada partida nova: descarta respostas atrasadas

  // Pede ao servidor uma partida nova. Resolve com {semente} (ou null se o
  // placar não respondeu — a partida segue sem ele).
  function iniciarPartida(chave) {
    geracao++;
    partida = null;
    if (!ativo) return Promise.resolve(null);
    var minhaGeracao = geracao;
    return chamar({ acao: "iniciar", chave: chave }, 5000).then(function (r) {
      if (minhaGeracao !== geracao || !r || !r.ok) return null;
      partida = { id: r.partida, semente: r.semente, chave: chave, eventos: [], geracao: minhaGeracao };
      return { semente: r.semente };
    }, function () {
      return null;
    });
  }

  // Anota um evento do diário: "p" (texto digitado), "d" (dica pedida),
  // "c" (clique no mapa: lat, lng).
  function anotar(tipo, a, b) {
    if (!partida || partida.eventos.length >= MAX_EVENTOS) return;
    if (tipo === "p") partida.eventos.push(["p", String(a).slice(0, 80)]);
    else if (tipo === "d") partida.eventos.push(["d"]);
    else if (tipo === "c") partida.eventos.push(["c", +a, +b]);
  }

  function abandonarPartida() {
    partida = null;
    geracao++;
  }

  // Manda o diário; o servidor refaz a partida e devolve a nota dele.
  // Resolve sempre com um julgamento: {ok:true, partida, pct, placar,
  // tempo_seg} ou {ok:false, motivo}.
  function encerrarPartida(extra) {
    if (!ativo) return Promise.resolve({ ok: false, motivo: "desligado" });
    if (!partida) return Promise.resolve({ ok: false, motivo: "sem_partida", geracao: geracao });
    var p = partida;
    partida = null;
    return chamar({
      acao: "encerrar",
      partida: p.id,
      eventos: p.eventos,
      placar: String((extra && extra.placar) || "").slice(0, 80),
    }, 20000).then(function (r) {
      if (r && r.ok) {
        return { ok: true, partida: p.id, chave: p.chave, pct: r.pct, placar: r.placar, tempo_seg: r.tempo_seg, geracao: p.geracao };
      }
      return { ok: false, motivo: (r && r.erro) || "servidor", geracao: p.geracao };
    }, function () {
      return { ok: false, motivo: "rede", geracao: p.geracao };
    });
  }

  // Registra a partida (já conferida pelo servidor) com um apelido.
  function registrar(partidaId, nome) {
    var v = validarNome(nome);
    if (v.erro) return Promise.resolve({ ok: false, erro: "nome", msg: v.erro });
    return chamar({ acao: "registrar", partida: partidaId, nome: v.nome, passe: passe() }, 15000)
      .then(function (r) {
        if (r && r.ok) {
          gravarLS(LS_NOME, v.nome);
          cache = {};
        }
        return r;
      });
  }

  var MSG_ERRO = {
    nome_em_uso: "Esse apelido já está no placar desta configuração por outro aparelho. " +
      "Escolha outro — ou importe aqui o backup do outro aparelho para continuar com ele.",
    nome: "Apelido inválido: 2 a 20 caracteres, só letras, números, espaço, ponto, hífen ou sublinhado.",
    limite: "Calma! Muitos envios em pouco tempo — tente de novo daqui a pouco.",
    ja_registrada: "Esta partida já foi registrada no placar.",
    partida: "O servidor não encontrou esta partida — jogue de novo para registrar.",
  };
  var MSG_MOTIVO = {
    sem_partida: "Esta partida começou sem conexão com o placar geral, então não pode ser registrada. A próxima entra normalmente.",
    rede: "Sem conexão com o placar geral no fim da partida: o resultado não pôde ser conferido nem registrado.",
    servidor: "O placar geral não conseguiu conferir esta partida agora.",
    tempo: "O servidor não conseguiu validar o tempo desta partida (relógio do servidor × duração da partida), então ela não entra no placar.",
    ritmo: "Palpites rápidos demais para o servidor confiar nesta partida — ela não entra no placar.",
    chave: "Esta configuração não entra no placar geral.",
    replay: "O servidor não conseguiu refazer esta partida — ela não entra no placar.",
    ja_encerrada: "Esta partida já tinha sido enviada ao placar.",
    partida: "O servidor não encontrou esta partida.",
  };

  // ---------------- formatação ----------------
  function fmtPctPadrao(x) {
    return (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
  }
  function fmtTempoPadrao(seg) {
    var m = Math.floor(seg / 60);
    var s = seg % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ordinal(n) { return n + "º"; }

  // ---------------- widget da tela de resultado ----------------
  // Monta em `el` o bloco "Placar geral" da configuração `chave`. `julg` é o
  // julgamento do servidor (de encerrarPartida) mais `melhor` (recorde
  // pessoal local): com ok=true aparece o formulário de apelido — e, se o
  // jogador já tem apelido e fez recorde pessoal, o registro vai sozinho (o
  // servidor guarda só o melhor de cada apelido, então mandar um resultado
  // pior seria inútil). `fmt` = {pct, tempo} para formatar.
  function montar(el, chave, julg, fmt) {
    if (!el) return;
    if (!ativo) { el.hidden = true; el.innerHTML = ""; return; }
    // resposta de uma partida que já não é a atual (o jogador começou outra)
    if (julg && julg.geracao !== undefined && julg.geracao !== geracao) return;
    fmt = fmt || {};
    var fPct = fmt.pct || fmtPctPadrao;
    var fTempo = fmt.tempo || fmtTempoPadrao;
    var nome = nomeSalvo();
    var estado = { enviando: false, resposta: null, msg: "", erro: false, digitado: undefined };
    var dadosAtuais = null;
    el.hidden = false;
    el.className = "placar-geral";

    function linhaTop(linhas, total) {
      if (!linhas.length) {
        return "<p class='placar-vazio'>Ninguém registrou esta configuração ainda — seja a primeira pessoa!</p>";
      }
      var html = "<ol class='placar-lista'>";
      linhas.forEach(function (l, i) {
        var eu = nome && l.nome.toLowerCase() === nome.toLowerCase();
        html += "<li" + (eu ? " class='eu'" : "") + "><span class='pos'>" + (i + 1) + "</span>" +
          "<span class='nome'>" + esc(l.nome) + "</span>" +
          "<span class='pct'>" + fPct(l.pct) + "</span>" +
          "<span class='det'>" + esc(l.placar || "") + (l.placar ? " · " : "") + fTempo(l.tempo_seg) + "</span></li>";
      });
      html += "</ol>";
      if (total > linhas.length) {
        html += "<p class='placar-total'>" + total + " jogadores registrados nesta configuração.</p>";
      }
      return html;
    }

    function formulario() {
      if (!julg || julg.motivo === "desligado") return "";
      if (!julg.ok) {
        return "<p class='placar-nota'>" + (MSG_MOTIVO[julg.motivo] || MSG_MOTIVO.servidor) + "</p>";
      }
      var conferida = "Conferida pelo servidor: <b>" + fPct(julg.pct) + "</b> em " + fTempo(julg.tempo_seg) + ".";
      if (estado.resposta && estado.resposta.ok) {
        var r = estado.resposta;
        var texto = r.melhorou
          ? "✔ Registrado como <b>" + esc(nomeSalvo()) + "</b>: você é " + ordinal(r.posicao) + " de " + r.total + "."
          : "Seu melhor como <b>" + esc(nomeSalvo()) + "</b> segue " + fPct(r.pct) + " (" + fTempo(r.tempo_seg) +
            "), " + ordinal(r.posicao) + " de " + r.total + ".";
        return "<p class='placar-msg'>" + texto + "</p>" +
          "<p class='placar-nota'>" + conferida + " <a href='#' class='placar-trocar'>Trocar de apelido</a> a partir da próxima partida.</p>";
      }
      if (estado.registrada) {
        return "<p class='placar-nota'>" + conferida + "</p>";
      }
      var salvo = nomeSalvo();
      var valor = estado.digitado !== undefined ? estado.digitado : salvo;
      return "<p class='placar-nota'>" + conferida + "</p>" +
        "<form class='placar-form' autocomplete='off'>" +
        "<input type='text' class='placar-nome' maxlength='20' placeholder='seu apelido (ex.: joao-o-craque)' " +
        "value='" + esc(valor) + "' autocapitalize='none' spellcheck='false'>" +
        "<button type='submit' class='botao-sec'" + (estado.enviando ? " disabled" : "") + ">" +
        (estado.enviando ? "Enviando…" : "Registrar") + "</button>" +
        "</form>" +
        (estado.msg ? "<p class='placar-msg" + (estado.erro ? " erro" : "") + "'>" + estado.msg + "</p>" : "") +
        (salvo
          ? "<p class='placar-nota'>Apelidos não têm senha: seus próximos recordes pessoais vão sozinhos para o placar. " +
            "<a href='#' class='placar-sair'>Sair do placar</a></p>"
          : "<p class='placar-nota'>Sem cadastro: o apelido fica preso a este navegador (e ao seu backup). Use um apelido, não seu nome completo.</p>");
    }

    function render(dados, falha) {
      var cabecalho = "<div class='placar-titulo'>🌎 Placar geral desta configuração</div>";
      var corpo;
      if (falha) corpo = "<p class='placar-vazio'>Placar geral indisponível agora.</p>";
      else if (!dados) corpo = "<p class='placar-vazio'>carregando…</p>";
      else corpo = linhaTop(dados.top, dados.total);
      el.innerHTML = cabecalho + corpo + (falha ? "" : formulario());
      var form = el.querySelector(".placar-form");
      if (form) form.addEventListener("submit", enviar);
      var trocar = el.querySelector(".placar-trocar");
      if (trocar) trocar.addEventListener("click", function (ev) {
        ev.preventDefault();
        esquecerNome();
        trocar.textContent = "✔ Na próxima partida o apelido será pedido de novo.";
      });
      var sair = el.querySelector(".placar-sair");
      if (sair) sair.addEventListener("click", function (ev) {
        ev.preventDefault();
        esquecerNome();
        nome = "";
        render(dadosAtuais);
      });
    }

    function carregar(forcar) {
      return top(chave, forcar).then(function (d) {
        dadosAtuais = d;
        render(d);
      }, function () {
        render(null, true);
      });
    }

    function enviar(ev) {
      if (ev) ev.preventDefault();
      if (estado.enviando || !julg || !julg.ok) return;
      var inp = el.querySelector(".placar-nome");
      var digitado = inp ? inp.value : nomeSalvo();
      estado.digitado = digitado; // sobrevive às re-renderizações do bloco
      var v = validarNome(digitado);
      if (v.erro) {
        estado.msg = v.erro;
        estado.erro = true;
        render(dadosAtuais);
        return;
      }
      estado.enviando = true;
      estado.msg = "";
      render(dadosAtuais);
      registrar(julg.partida, v.nome).then(function (r) {
        estado.enviando = false;
        if (r && r.ok) {
          nome = v.nome;
          estado.resposta = r;
          estado.registrada = true;
          estado.erro = false;
          if (window.SITE && SITE.rastrear) SITE.rastrear("placar_registrou", { melhorou: !!r.melhorou });
          carregar(true);
        } else {
          estado.erro = true;
          if (r && r.erro === "ja_registrada") estado.registrada = true;
          estado.msg = (r && (r.msg || MSG_ERRO[r.erro])) || "Não deu para registrar agora. Tente de novo.";
          render(dadosAtuais);
        }
      }, function () {
        estado.enviando = false;
        estado.erro = true;
        estado.msg = "Sem conexão com o placar geral. Tente de novo daqui a pouco.";
        render(dadosAtuais);
      });
    }

    render(null);
    carregar(false).then(function () {
      // apelido já escolhido + recorde pessoal novo → registra sem pedir
      if (julg && julg.ok && julg.melhor && nomeSalvo()) enviar();
    });
  }

  function limpar(el) {
    if (!el) return;
    el.hidden = true;
    el.innerHTML = "";
  }

  // ---------------- resumo da tela de configuração ----------------
  // Escreve em `el` (criando um <div class="placar-resumo">) o líder da
  // configuração: "🌎 Recorde geral: 87,0% por joao-o-craque (27 jogadores)".
  // Espera um pouco antes de buscar (o jogador ainda está mexendo nos campos)
  // e ignora respostas de configurações que já não são a atual.
  var resumoTimer = null;
  var resumoSerial = 0;
  function resumo(el, chave, fmt) {
    if (!el || !ativo) return;
    fmt = fmt || {};
    var fPct = fmt.pct || fmtPctPadrao;
    var serial = ++resumoSerial;
    clearTimeout(resumoTimer);
    var alvo = document.createElement("div");
    alvo.className = "placar-resumo";
    var c = cache[chave];
    if (c && Date.now() - c.quando < CACHE_MS) {
      alvo.innerHTML = textoResumo(c, fPct);
      el.appendChild(alvo);
      return;
    }
    alvo.textContent = "🌎 Placar geral: consultando…";
    el.appendChild(alvo);
    resumoTimer = setTimeout(function () {
      top(chave).then(function (d) {
        if (serial !== resumoSerial) return;
        alvo.innerHTML = textoResumo(d, fPct);
      }, function () {
        if (serial !== resumoSerial) return;
        alvo.textContent = "🌎 Placar geral indisponível agora.";
      });
    }, 500);
  }
  function textoResumo(d, fPct) {
    if (!d.top.length) return "🌎 Placar geral: ninguém registrou esta configuração ainda.";
    var l = d.top[0];
    var nome = nomeSalvo();
    var minha = "";
    if (nome) {
      for (var i = 0; i < d.top.length; i++) {
        if (d.top[i].nome.toLowerCase() === nome.toLowerCase()) {
          minha = " · você: " + ordinal(i + 1);
          break;
        }
      }
    }
    return "🌎 Recorde geral: <b>" + fPct(l.pct) + "</b> por <b>" + esc(l.nome) + "</b> (" +
      d.total + (d.total === 1 ? " jogador" : " jogadores") + minha + ")";
  }

  // ---------------- backup ----------------
  // O apelido e o passe entram no backup completo: importar num aparelho
  // novo leva a "posse" do apelido junto. Nunca sobrescreve um passe que já
  // tenha sido usado aqui.
  function exportar() {
    var n = nomeSalvo();
    var p = lerLS(LS_PASSE);
    if (!n && !p) return null;
    return { nome: n || undefined, passe: p || undefined };
  }
  function importar(obj) {
    if (!obj || typeof obj !== "object") return false;
    var mudou = false;
    if (obj.passe && /^[0-9a-f-]{36}$/i.test(obj.passe) && !lerLS(LS_PASSE)) {
      gravarLS(LS_PASSE, obj.passe);
      mudou = true;
    }
    if (obj.nome && !nomeSalvo() && !validarNome(obj.nome).erro) {
      gravarLS(LS_NOME, validarNome(obj.nome).nome);
      mudou = true;
    }
    return mudou;
  }

  return {
    ativo: ativo,
    nomeSalvo: nomeSalvo,
    esquecerNome: esquecerNome,
    validarNome: validarNome,
    top: top,
    iniciarPartida: iniciarPartida,
    anotar: anotar,
    abandonarPartida: abandonarPartida,
    encerrarPartida: encerrarPartida,
    registrar: registrar,
    montar: montar,
    limpar: limpar,
    resumo: resumo,
    exportar: exportar,
    importar: importar,
  };
})();
