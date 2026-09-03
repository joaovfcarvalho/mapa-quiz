"use strict";
// Placar geral: um ranking público por configuração de jogo, sem login. No
// fim da partida o jogador escolhe um apelido e o resultado vai para uma
// tabela no Supabase (Postgres + API REST); quem jogar a mesma configuração
// vê os mesmos nomes. Não há conta nem senha: o navegador guarda um "passe"
// aleatório que prende o apelido a este aparelho (ninguém sobrescreve o
// recorde do "joao-o-craque" sem ele) — e o passe viaja no backup, como o
// resto do progresso. Sem `placar.url`/`placar.chave` em js/config.js o
// módulo fica inerte e o jogo continua 100% local.
var PLACAR = (function () {
  var CFG = (window.MAPAQUIZ_CONFIG || {}).placar || {};
  var URL_BASE = String(CFG.url || "").replace(/\/+$/, "");
  var CHAVE_API = String(CFG.chave || "");
  var LS_NOME = "mapaquiz.placar.nome";
  var LS_PASSE = "mapaquiz.placar.passe";
  var TOP_N = 10;
  var CACHE_MS = 60 * 1000;
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
  // sessão inteira ainda usa um passe só (senão o segundo envio do mesmo
  // apelido já cairia em "nome em uso").
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

  // Top N de uma configuração: [{nome, pct, placar, tempo_seg, atualizado_em}]
  // e o total de jogadores registrados nela. Cache curto por chave.
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

  // Registra (ou melhora) o resultado do apelido nesta configuração.
  // resultado: {pct (0..1), placar, tempoSeg}. Resolve com a resposta do
  // servidor: {ok, melhorou, posicao, total, pct, tempo_seg} ou {ok:false, erro}.
  function registrar(chave, nome, resultado) {
    if (!ativo) return Promise.reject(new Error("placar desligado"));
    var v = validarNome(nome);
    if (v.erro) return Promise.resolve({ ok: false, erro: "nome", msg: v.erro });
    var corpo = {
      p_chave: chave,
      p_nome: v.nome,
      p_pct: Math.max(0, Math.min(1, +resultado.pct || 0)),
      p_placar: String(resultado.placar || "").slice(0, 80),
      p_tempo_seg: Math.max(0, Math.round(+resultado.tempoSeg || 0)),
      p_passe: passe(),
    };
    return fetch(URL_BASE + "/rest/v1/rpc/registrar_placar", {
      method: "POST",
      headers: cabecalhos(),
      body: JSON.stringify(corpo),
    }).then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    }).then(function (r) {
      if (r && r.ok) {
        gravarLS(LS_NOME, v.nome);
        delete cache[chave];
      }
      return r;
    });
  }

  var MSG_ERRO = {
    nome_em_uso: "Esse apelido já está no placar desta configuração por outro aparelho. " +
      "Escolha outro — ou importe aqui o backup do outro aparelho para continuar com ele.",
    nome: "Apelido inválido: 2 a 20 caracteres, só letras, números, espaço, ponto, hífen ou sublinhado.",
    limite: "Calma! Muitos envios em pouco tempo — tente de novo daqui a pouco.",
    chave: "Esta configuração não pode entrar no placar geral.",
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
  // Monta em `el` o bloco "Placar geral" da configuração `chave`. Com
  // `resultado` ({pct, placar, tempoSeg, melhor}) mostra também o formulário
  // de apelido; se o jogador já tem apelido e fez recorde pessoal, envia
  // sozinho (o servidor só guarda o melhor de cada apelido, então mandar um
  // resultado pior seria inútil). `fmt` = {pct, tempo} para formatar.
  function montar(el, chave, resultado, fmt) {
    if (!el) return;
    if (!ativo) { el.hidden = true; el.innerHTML = ""; return; }
    fmt = fmt || {};
    var fPct = fmt.pct || fmtPctPadrao;
    var fTempo = fmt.tempo || fmtTempoPadrao;
    var nome = nomeSalvo();
    var estado = { enviado: false, resposta: null, msg: "", erro: false };
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
      if (!resultado) return "";
      if (estado.resposta && estado.resposta.ok) {
        var r = estado.resposta;
        var texto = r.melhorou
          ? "✔ Registrado como <b>" + esc(nomeSalvo()) + "</b>: você é " + ordinal(r.posicao) + " de " + r.total + "."
          : "Seu melhor como <b>" + esc(nomeSalvo()) + "</b> segue " + fPct(r.pct) + " (" + fTempo(r.tempo_seg) +
            "), " + ordinal(r.posicao) + " de " + r.total + ".";
        return "<p class='placar-msg'>" + texto + " <a href='#' class='placar-trocar'>trocar apelido</a></p>";
      }
      var salvo = nomeSalvo();
      var valor = estado.digitado !== undefined ? estado.digitado : salvo;
      return "<form class='placar-form' autocomplete='off'>" +
        "<input type='text' class='placar-nome' maxlength='20' placeholder='seu apelido (ex.: joao-o-craque)' " +
        "value='" + esc(valor) + "' autocapitalize='none' spellcheck='false'>" +
        "<button type='submit' class='botao-sec'>" + (estado.enviando ? "Enviando…" : "Registrar") + "</button>" +
        "</form>" +
        (estado.msg ? "<p class='placar-msg" + (estado.erro ? " erro" : "") + "'>" + estado.msg + "</p>" : "") +
        (salvo ? "<p class='placar-nota'>Apelidos não têm senha: seus próximos recordes pessoais vão sozinhos para o placar. " +
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
        estado.resposta = null;
        estado.msg = "";
        render(dadosAtuais);
        var inp = el.querySelector(".placar-nome");
        if (inp) { inp.focus(); inp.select(); }
      });
      var sair = el.querySelector(".placar-sair");
      if (sair) sair.addEventListener("click", function (ev) {
        ev.preventDefault();
        esquecerNome();
        nome = "";
        render(dadosAtuais);
      });
    }

    var dadosAtuais = null;
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
      if (estado.enviando) return;
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
      registrar(chave, v.nome, resultado).then(function (r) {
        estado.enviando = false;
        if (r && r.ok) {
          nome = v.nome;
          estado.resposta = r;
          estado.erro = false;
          if (window.SITE && SITE.rastrear) SITE.rastrear("placar_registrou", { melhorou: !!r.melhorou });
          carregar(true);
        } else {
          estado.erro = true;
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
      if (resultado && resultado.melhor && nomeSalvo()) enviar();
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
    registrar: registrar,
    montar: montar,
    limpar: limpar,
    resumo: resumo,
    exportar: exportar,
    importar: importar,
  };
})();
