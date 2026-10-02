"use strict";
// Conta Google + sincronização do progresso entre aparelhos.
//
// Como funciona: o jogador entra com a conta Google (Google Identity
// Services, fluxo de token no navegador) e autoriza só o escopo
// drive.appdata — a "pasta de dados de aplicativo" do Google Drive dele,
// que nenhum outro app enxerga e que ele mesmo não vê na lista de arquivos.
// O backup completo do jogo (o mesmo JSON do botão "Exportar backup") fica
// lá, num arquivo só. Não existe servidor do Mapa Quiz no meio: o navegador
// fala direto com o Drive do próprio jogador.
//
// Ciclo de sincronização (sincronizar):
//   1. garante o arquivo no Drive (cria na primeira vez; se achar mais de
//      um — dois aparelhos criaram ao mesmo tempo —, mescla todos e fica
//      com o mais antigo);
//   2. se o arquivo mudou desde a última vez que este aparelho o leu
//      (modifiedTime diferente), baixa e MESCLA no local — a mesclagem é a
//      mesma do importar backup: melhor recorde, união da maratona, maior
//      contador dos pontos cegos, união dos dias do Desafio. Só some o que
//      foi apagado/zerado de propósito (as marcas de apagado viajam junto);
//   3. se o local (já mesclado) difere do último enviado, confere de novo o
//      modifiedTime (mudou? volta ao 2) e envia.
// Dois aparelhos podem escrever em qualquer ordem: o resultado converge.
// Um arquivo ilegível no Drive nunca é sobrescrito (vira aviso de erro).
//
// O token de acesso dura ~1 h e só pode ser pedido dentro de um gesto do
// usuário (senão o navegador bloqueia a janela do Google). Por isso: o
// envio no meio de uma partida usa o token enquanto ele vale; expirado,
// a sincronização fica "pendente" e é concluída no próximo clique que
// importa (iniciar/pausar/voltar) ou no botão da conta.
var CONTA = (function () {
  var CFG = (window.MAPAQUIZ_CONFIG || {}).google || {};
  var CLIENT_ID = CFG.clientId || "";
  var ESCOPO_DRIVE = "https://www.googleapis.com/auth/drive.appdata";
  var ESCOPOS = "openid email " + ESCOPO_DRIVE;
  var LS = "mapaquiz.conta.v1";      // {ligado, email, nome, arquivoId, modificadoEm, ultimaSync}
  var SS = "mapaquiz.conta.token";   // sessionStorage: {token, expira}
  var NOME_ARQUIVO = "mapaquiz-backup.json";
  var API = "https://www.googleapis.com/drive/v3/files";
  var UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  var REVOGAR = "https://oauth2.googleapis.com/revoke";
  var ATRASO_ENVIO_MS = 5000;
  // fetch com keepalive (o único que sobrevive ao fechar a aba) tem limite
  // de 64 KB no corpo; acima disso o envio de saída vai por fetch comum
  var LIMITE_KEEPALIVE = 60 * 1024;
  var MAX_REMESCLAS = 3; // o arquivo mudou entre ler e gravar: lê de novo até 3x

  var estado = {
    ligado: false, email: null, nome: null,
    arquivoId: null, modificadoEm: null, ultimaSync: null,
    token: null, expira: 0,
    ocupado: false, pendente: false, erro: null, ultimoMotivo: null,
    avisoRevogar: false, // saiu sem conseguir revogar: mostrar o caminho manual
  };
  var perfilDoToken = null; // token cujo dono (e-mail) já foi conferido
  var backup = null;        // {exportar, importar, aoImportar} — injetado pela interface
  var ouvintes = [];
  var ultimoEnviado = null; // texto do último backup enviado (sem a data)
  var timerEnvio = null;
  var refazer = false;      // chegou mudança durante um ciclo: roda outro depois
  var importando = false;   // ignora os eventos de dados disparados pela mesclagem
  var clienteToken = null;
  var gisCarregando = null;
  var aguardandoToken = null; // callback do pedido de token em andamento

  function disponivel() {
    return !!CLIENT_ID && /^https?:$/.test(location.protocol);
  }

  // ---------------- persistência do estado ----------------
  function carregar() {
    try {
      var s = JSON.parse(localStorage.getItem(LS));
      if (s && typeof s === "object") {
        estado.ligado = !!s.ligado;
        estado.email = s.email || null;
        estado.nome = s.nome || null;
        estado.arquivoId = s.arquivoId || null;
        estado.modificadoEm = s.modificadoEm || null;
        estado.ultimaSync = s.ultimaSync || null;
      }
    } catch (e) {}
    try {
      var t = JSON.parse(sessionStorage.getItem(SS));
      if (t && t.token && t.expira > Date.now()) {
        estado.token = t.token;
        estado.expira = t.expira;
      }
    } catch (e) {}
  }
  function gravar() {
    try {
      localStorage.setItem(LS, JSON.stringify({
        ligado: estado.ligado, email: estado.email, nome: estado.nome,
        arquivoId: estado.arquivoId, modificadoEm: estado.modificadoEm,
        ultimaSync: estado.ultimaSync,
      }));
    } catch (e) {}
    try {
      if (estado.token) sessionStorage.setItem(SS, JSON.stringify({ token: estado.token, expira: estado.expira }));
      else sessionStorage.removeItem(SS);
    } catch (e) {}
  }
  function avisar() {
    ouvintes.forEach(function (f) { try { f(snapshot()); } catch (e) {} });
  }
  function snapshot() {
    return {
      disponivel: disponivel(),
      ligado: estado.ligado,
      email: estado.email,
      nome: estado.nome,
      tokenValido: tokenValido(),
      ocupado: estado.ocupado,
      pendente: estado.pendente,
      erro: estado.erro,
      ultimaSync: estado.ultimaSync,
      avisoRevogar: estado.avisoRevogar,
    };
  }
  function tokenValido() {
    return !!estado.token && estado.expira > Date.now();
  }

  // ---------------- Google Identity Services ----------------
  function carregarGIS(cb) {
    if (window.google && google.accounts && google.accounts.oauth2) { cb(true); return; }
    if (gisCarregando) { gisCarregando.push(cb); return; }
    gisCarregando = [cb];
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = function () {
      var fila = gisCarregando; gisCarregando = null;
      fila.forEach(function (f) { f(true); });
    };
    s.onerror = function () {
      s.remove();
      var fila = gisCarregando; gisCarregando = null;
      fila.forEach(function (f) { f(false); });
    };
    document.head.appendChild(s);
  }
  function cliente() {
    if (clienteToken) return clienteToken;
    clienteToken = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: ESCOPOS,
      callback: function (resp) {
        var cb = aguardandoToken; aguardandoToken = null;
        if (!resp || resp.error || !resp.access_token) {
          estado.erro = resp && resp.error === "access_denied"
            ? "Acesso não autorizado." : "Não deu para entrar na conta Google.";
          avisar();
          if (cb) cb(false);
          return;
        }
        if (google.accounts.oauth2.hasGrantedAllScopes &&
            !google.accounts.oauth2.hasGrantedAllScopes(resp, ESCOPO_DRIVE)) {
          estado.erro = "É preciso permitir o acesso à pasta do jogo no Drive.";
          avisar();
          if (cb) cb(false);
          return;
        }
        estado.token = resp.access_token;
        estado.expira = Date.now() + (Math.max(60, +resp.expires_in || 3600) - 60) * 1000;
        estado.erro = null;
        gravar();
        avisar();
        if (cb) cb(true);
      },
      error_callback: function (err) {
        var cb = aguardandoToken; aguardandoToken = null;
        estado.erro = err && err.type === "popup_closed"
          ? "A janela do Google foi fechada antes de terminar."
          : "Não deu para abrir a janela do Google (bloqueio de pop-up?).";
        avisar();
        if (cb) cb(false);
      },
    });
    return clienteToken;
  }
  // Pede um token — só funciona dentro de um clique/toque do usuário. Com
  // prompt vazio, quem já autorizou não vê tela nenhuma (a janela abre e
  // fecha sozinha); a primeira vez mostra o consentimento do Google.
  function pedirToken(forcarConsentimento, cb) {
    if (!disponivel()) { cb(false); return; }
    carregarGIS(function (ok) {
      if (!ok) {
        estado.erro = "Não deu para carregar o login do Google (sem internet?).";
        avisar();
        cb(false);
        return;
      }
      if (aguardandoToken) { cb(false); return; } // já tem um pedido aberto
      aguardandoToken = cb;
      var opts = { prompt: forcarConsentimento ? "consent" : "" };
      if (estado.email) opts.hint = estado.email;
      try {
        cliente().requestAccessToken(opts);
      } catch (e) {
        aguardandoToken = null;
        estado.erro = "Não deu para abrir o login do Google.";
        avisar();
        cb(false);
      }
    });
  }
  // Token válido em mãos (renovando dentro de um gesto do usuário, se for o
  // caso). Fora de um gesto, com token expirado, devolve false.
  function garantirToken(dentroDeGesto, cb) {
    if (tokenValido()) { cb(true); return; }
    if (!estado.ligado || !dentroDeGesto) { cb(false); return; }
    pedirToken(false, cb);
  }

  // ---------------- chamadas ao Drive ----------------
  function chamar(url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    opts.headers.Authorization = "Bearer " + estado.token;
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) {
        // token recusado: expirou ou foi revogado — pede outro no próximo gesto
        estado.token = null;
        estado.expira = 0;
        gravar();
        throw new Error("token");
      }
      if (!r.ok) throw new Error("http " + r.status);
      return r;
    });
  }
  // Confere de quem é o token (a cada token novo: o navegador pode ter
  // entrado com outra conta Google). Conta diferente da ligada: esquece o
  // arquivo da anterior e só segue — mesclando o progresso deste aparelho
  // na conta nova — se o jogador confirmar.
  function lerPerfil() {
    if (estado.token && perfilDoToken === estado.token) return Promise.resolve();
    var token = estado.token;
    return chamar("https://www.googleapis.com/oauth2/v3/userinfo").then(function (r) { return r.json(); })
      .then(function (p) {
        var email = p && typeof p.email === "string" ? p.email : null;
        if (email && estado.email && email !== estado.email) {
          var ok = typeof confirm === "function" && confirm(
            "Você entrou como " + email + ", mas este aparelho estava ligado a " + estado.email +
            ".\n\nJuntar o progresso deste aparelho ao da conta " + email + "?\n" +
            "(Cancelar desconecta a conta; o progresso continua salvo neste aparelho.)");
          if (!ok) throw new Error("troca-recusada");
          estado.arquivoId = null;
          estado.modificadoEm = null;
          estado.ultimaSync = null;
          ultimoEnviado = null;
        }
        if (email) estado.email = email;
        estado.nome = (p && typeof p.name === "string" ? p.name : null) || estado.nome;
        perfilDoToken = token;
        gravar();
      }).catch(function (e) {
        var msg = String(e && e.message || e);
        if (msg === "troca-recusada" || msg === "token") throw e;
        // sem o perfil (rede?): segue; confere de novo no próximo ciclo
      });
  }
  // Acha o arquivo do jogo. Mais de um (dois aparelhos criaram ao mesmo
  // tempo): fica o mais antigo; os outros são mesclados no local e apagados.
  // Lista de novo nos ciclos "grandes" (entrar/início/manual) para pegar
  // duplicatas criadas depois.
  function acharArquivo(motivo) {
    var conferir = motivo === "entrar" || motivo === "inicio" || motivo === "manual";
    if (estado.arquivoId && !conferir) return Promise.resolve(estado.arquivoId);
    var url = API + "?spaces=appDataFolder&pageSize=10&orderBy=createdTime" +
      "&fields=files(id,name,modifiedTime,createdTime)" +
      "&q=" + encodeURIComponent("name = '" + NOME_ARQUIVO + "' and trashed = false");
    return chamar(url).then(function (r) { return r.json(); }).then(function (lista) {
      var arqs = (lista && lista.files) || [];
      if (!arqs.length) {
        estado.arquivoId = null;
        estado.modificadoEm = null;
        return null;
      }
      var principal = arqs[0];
      if (principal.id !== estado.arquivoId) {
        estado.arquivoId = principal.id;
        estado.modificadoEm = null; // força a leitura do que está lá
        gravar();
      }
      return arqs.slice(1).reduce(function (p, arq) {
        return p.then(function () {
          return baixar(arq.id).then(function (texto) {
            var r = importarTexto(texto);
            // ilegível: não apaga (pode ser o único lugar com aqueles dados)
            if (!r || !r.ok) return;
            ultimoEnviado = null; // o principal precisa receber a mescla
            return chamar(API + "/" + arq.id, { method: "DELETE" }).catch(function () {});
          });
        });
      }, Promise.resolve()).then(function () { return principal.id; });
    });
  }
  function criarArquivo(texto) {
    var limite = "mapaquiz" + Date.now();
    var corpo = "--" + limite + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify({ name: NOME_ARQUIVO, parents: ["appDataFolder"], mimeType: "application/json" }) +
      "\r\n--" + limite + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + texto +
      "\r\n--" + limite + "--";
    return chamar(UPLOAD + "?uploadType=multipart&fields=id,modifiedTime", {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + limite },
      body: corpo,
    }).then(function (r) { return r.json(); });
  }
  function lerMetadados(id) {
    return chamar(API + "/" + id + "?fields=modifiedTime").then(function (r) { return r.json(); });
  }
  function baixar(id) {
    return chamar(API + "/" + id + "?alt=media").then(function (r) { return r.text(); });
  }
  function enviar(id, texto, keepalive) {
    return chamar(UPLOAD + "/" + id + "?uploadType=media&fields=id,modifiedTime", {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: texto,
      keepalive: !!keepalive,
    }).then(function (r) { return r.json(); });
  }

  // mescla um texto vindo do Drive sem disparar novo envio a cada mudança
  var mesclouAlgo = false;
  function importarTexto(texto) {
    importando = true;
    var r;
    try { r = backup.importar(texto); } finally { importando = false; }
    if (r && r.ok) {
      mesclouAlgo = true;
      if (backup.aoImportar) backup.aoImportar(r);
    }
    return r;
  }

  // o carimbo de data do export muda a cada chamada: fora da comparação
  function semData(texto) {
    return String(texto).replace(/"exportadoEm":\s*"[^"]*",?/, "");
  }
  // JSON sem espaços: o export é indentado, e a maratona inteira indentada
  // passa dos 64 KB que o keepalive aceita
  function compactar(texto) {
    try { return JSON.stringify(JSON.parse(texto)); } catch (e) { return texto; }
  }
  function bytes(texto) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(texto).length;
    return texto.length * 3;
  }
  function exportarCompacto() {
    return compactar(backup.exportar());
  }

  // ---------------- o ciclo ----------------
  // motivo: "entrar" | "manual" | "auto" | "inicio" | "saida"
  function sincronizar(motivo, cb) {
    cb = cb || function () {};
    if (!estado.ligado || !backup) { cb({ ok: false, erro: "desligado" }); return; }
    if (!tokenValido()) {
      estado.pendente = true;
      avisar();
      cb({ ok: false, erro: "token" });
      return;
    }
    if (estado.ocupado) { refazer = true; cb({ ok: false, erro: "ocupado" }); return; }
    estado.ocupado = true;
    estado.erro = null;
    estado.ultimoMotivo = motivo;
    avisar();
    mesclouAlgo = false;
    var enviou = false;
    var saida = motivo === "saida";
    var trocaRecusada = false;

    // envia o local, se ele mudou desde o último envio
    function enviarSePreciso(id) {
      var texto = exportarCompacto();
      var chave = semData(texto);
      if (chave === ultimoEnviado) return Promise.resolve();
      // na saída a página pode morrer a qualquer instante: keepalive se couber
      return enviar(id, texto, saida && bytes(texto) <= LIMITE_KEEPALIVE).then(function (meta) {
        ultimoEnviado = chave;
        estado.modificadoEm = meta.modifiedTime || estado.modificadoEm;
        enviou = true;
      });
    }
    // Lê o modifiedTime logo antes de gravar. Mudou desde a última leitura?
    // Baixa, mescla e confere de novo (até MAX_REMESCLAS vezes) — assim o
    // envio não atropela o que outro aparelho acabou de gravar.
    function ciclo(id, rodada) {
      return lerMetadados(id).then(function (meta) {
        if (meta.modifiedTime === estado.modificadoEm) return enviarSePreciso(id);
        return baixar(id).then(function (texto) {
          var r = importarTexto(texto);
          // arquivo ilegível no Drive: não sobrescreve
          if (!r || !r.ok) throw new Error("ilegivel");
          estado.modificadoEm = meta.modifiedTime || null;
          if (rodada + 1 >= MAX_REMESCLAS) return enviarSePreciso(id);
          return ciclo(id, rodada + 1);
        });
      });
    }

    var feito;
    if (saida) {
      // saindo: nada de esperar leituras antes do envio — o PATCH sai já (a
      // mesclagem é por união: o outro aparelho recupera o que tiver de mais
      // novo no próximo ciclo dele)
      feito = estado.arquivoId && perfilDoToken === estado.token
        ? enviarSePreciso(estado.arquivoId)
        : Promise.resolve();
    } else {
      feito = lerPerfil()
        .then(function () { return acharArquivo(motivo); })
        .then(function (id) {
          if (!id) {
            var texto0 = exportarCompacto();
            return criarArquivo(texto0).then(function (meta) {
              estado.arquivoId = meta.id;
              estado.modificadoEm = meta.modifiedTime || null;
              ultimoEnviado = semData(texto0);
              enviou = true;
            });
          }
          return ciclo(id, 0);
        });
    }
    feito
      .then(function () {
        estado.ultimaSync = new Date().toISOString();
        estado.pendente = false;
        gravar();
        cb({ ok: true, mesclou: mesclouAlgo, enviou: enviou });
      })
      .catch(function (e) {
        var msg = String(e && e.message || e);
        if (msg === "token") {
          estado.pendente = true;
          estado.erro = null;
        } else if (msg === "troca-recusada") {
          trocaRecusada = true;
        } else if (msg === "ilegivel") {
          estado.erro = "O arquivo de progresso no seu Drive está ilegível e não foi sobrescrito. " +
            "Exporte um backup deste aparelho por segurança.";
          estado.pendente = true;
        } else if (/http 403/.test(msg)) {
          estado.erro = "O Google recusou o acesso à pasta do jogo (403).";
          estado.pendente = true;
        } else if (/http 404/.test(msg)) {
          // arquivo sumiu do Drive: recria no próximo ciclo
          estado.arquivoId = null;
          estado.modificadoEm = null;
          estado.pendente = true;
        } else {
          estado.erro = "Falha na sincronização (" + msg + "). Tento de novo depois.";
          estado.pendente = true;
        }
        gravar();
        cb({ ok: false, erro: msg });
      })
      .then(function () {
        estado.ocupado = false;
        if (trocaRecusada) { refazer = false; sair(); return; }
        avisar();
        if (refazer) { refazer = false; agendarEnvio(); }
      });
  }

  // envio adiado (o jogador digita várias cidades seguidas; uma chamada só)
  function agendarEnvio() {
    if (!estado.ligado || importando) return;
    estado.pendente = true;
    clearTimeout(timerEnvio);
    timerEnvio = setTimeout(function () {
      timerEnvio = null;
      sincronizar("auto");
    }, ATRASO_ENVIO_MS);
  }

  // Sincronização dentro de um gesto do usuário (iniciar/pausar/voltar):
  // renova o token se preciso e roda o ciclo. Chama cb quando terminar ou
  // ao estourar o prazo (a partida não pode ficar esperando a rede).
  function sincronizarNoGesto(motivo, prazoMs, cb) {
    cb = cb || function () {};
    if (!estado.ligado || !backup) { cb({ ok: false }); return; }
    var chamou = false;
    function fim(r) { if (chamou) return; chamou = true; cb(r); }
    if (prazoMs) setTimeout(function () { fim({ ok: false, erro: "prazo" }); }, prazoMs);
    garantirToken(true, function (ok) {
      if (!ok) { fim({ ok: false, erro: "token" }); return; }
      clearTimeout(timerEnvio);
      timerEnvio = null;
      sincronizar(motivo, fim);
    });
  }

  // ---------------- entrar / sair ----------------
  function entrar(cb) {
    cb = cb || function () {};
    if (!disponivel()) { cb(false); return; }
    estado.erro = null;
    estado.avisoRevogar = false;
    pedirToken(!estado.ligado, function (ok) {
      if (!ok) { cb(false); return; }
      estado.ligado = true;
      estado.pendente = true;
      gravar();
      avisar();
      sincronizar("entrar", function (r) { cb(!!r.ok); });
    });
  }
  // Sair revoga a autorização no Google (direto no endpoint de revogação —
  // não depende do script do Google ter carregado). Sem token em mãos (a
  // sessão venceu) ou se a revogação falhar, o aviso manda o jogador
  // remover o acesso em myaccount.google.com/permissions.
  function sair() {
    var token = estado.token;
    estado.avisoRevogar = !token;
    if (token) {
      try {
        fetch(REVOGAR + "?token=" + encodeURIComponent(token), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }).then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
        }).catch(function () {
          if (estado.ligado) return; // entrou de novo nesse meio-tempo
          estado.avisoRevogar = true;
          avisar();
        });
      } catch (e) {
        estado.avisoRevogar = true;
      }
    }
    perfilDoToken = null;
    estado.ligado = false;
    estado.email = null;
    estado.nome = null;
    estado.arquivoId = null;
    estado.modificadoEm = null;
    estado.ultimaSync = null;
    estado.token = null;
    estado.expira = 0;
    estado.pendente = false;
    estado.erro = null;
    ultimoEnviado = null;
    clearTimeout(timerEnvio);
    timerEnvio = null;
    gravar();
    avisar();
  }

  // ---------------- ligação com a interface ----------------
  function init(opts) {
    backup = opts;
    carregar();
    if (!disponivel()) { estado.ligado = false; }
    document.addEventListener("mapaquiz:dados", function () { agendarEnvio(); });
    // Fechar a aba/app no meio da partida: manda o que der. O envio sai já
    // no visibilitychange (que vem antes do pagehide e com a página ainda
    // viva) — com keepalive se o JSON couber nos 64 KB, por fetch comum
    // se não couber; o pagehide fica só de reserva.
    var despedida = function () {
      if (!estado.ligado || !estado.pendente || !tokenValido() || estado.ocupado) return;
      clearTimeout(timerEnvio);
      timerEnvio = null;
      sincronizar("saida");
    };
    window.addEventListener("pagehide", despedida);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") despedida();
    });
    // com token ainda válido (recarregou a página dentro da hora), já
    // busca o que pode ter mudado no outro aparelho
    if (estado.ligado && tokenValido()) sincronizar("inicio");
    else if (estado.ligado) estado.pendente = true;
    // conta ligada: o script do Google já vem carregado, para que o pedido
    // de token rode dentro do próprio clique (no iOS, esperar o script
    // carregar depois do toque faz o Safari bloquear a janela do Google)
    if (estado.ligado) carregarGIS(function () {});
    avisar();
  }
  function ouvir(f) { ouvintes.push(f); }

  // "há 2 min", "há 3 h", "ontem"…
  function tempoDesde(iso) {
    if (!iso) return null;
    var seg = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (seg < 60) return "agora mesmo";
    if (seg < 3600) return "há " + Math.floor(seg / 60) + " min";
    if (seg < 86400) return "há " + Math.floor(seg / 3600) + " h";
    var d = Math.floor(seg / 86400);
    return d === 1 ? "ontem" : "há " + d + " dias";
  }

  return {
    disponivel: disponivel,
    init: init,
    ouvir: ouvir,
    estado: snapshot,
    entrar: entrar,
    sair: sair,
    sincronizar: sincronizar,
    sincronizarNoGesto: sincronizarNoGesto,
    garantirToken: garantirToken,
    agendarEnvio: agendarEnvio,
    tempoDesde: tempoDesde,
  };
})();
