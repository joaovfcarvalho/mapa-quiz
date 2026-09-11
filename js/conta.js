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
//   1. garante o arquivo no Drive (cria na primeira vez);
//   2. se o arquivo mudou desde a última vez que este aparelho o leu
//      (modifiedTime diferente), baixa e MESCLA no local — a mesclagem é a
//      mesma do importar backup: melhor recorde, união da maratona, maior
//      contador dos pontos cegos, união dos dias do Desafio. Nunca apaga;
//   3. se o local (já mesclado) difere do último enviado, envia.
// Dois aparelhos podem escrever em qualquer ordem: o resultado converge.
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
  var ATRASO_ENVIO_MS = 5000;

  var estado = {
    ligado: false, email: null, nome: null,
    arquivoId: null, modificadoEm: null, ultimaSync: null,
    token: null, expira: 0,
    ocupado: false, pendente: false, erro: null, ultimoMotivo: null,
  };
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
  function lerPerfil() {
    if (estado.email) return Promise.resolve();
    return chamar("https://www.googleapis.com/oauth2/v3/userinfo").then(function (r) { return r.json(); })
      .then(function (p) {
        estado.email = p.email || null;
        estado.nome = p.name || null;
        gravar();
      }).catch(function () {});
  }
  function acharArquivo() {
    if (estado.arquivoId) return Promise.resolve(estado.arquivoId);
    var url = API + "?spaces=appDataFolder&pageSize=10&fields=files(id,name,modifiedTime)" +
      "&q=" + encodeURIComponent("name = '" + NOME_ARQUIVO + "' and trashed = false");
    return chamar(url).then(function (r) { return r.json(); }).then(function (lista) {
      var arq = (lista.files || [])[0];
      if (arq) {
        estado.arquivoId = arq.id;
        estado.modificadoEm = null; // força a leitura do que está lá
        gravar();
        return arq.id;
      }
      return null;
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

  // o carimbo de data do export muda a cada chamada: fora da comparação
  function semData(texto) {
    return String(texto).replace(/"exportadoEm":\s*"[^"]*",?/, "");
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
    var mesclou = false;
    var enviou = false;
    lerPerfil()
      .then(acharArquivo)
      .then(function (id) {
        if (!id) {
          var texto0 = backup.exportar();
          return criarArquivo(texto0).then(function (meta) {
            estado.arquivoId = meta.id;
            estado.modificadoEm = meta.modifiedTime || null;
            ultimoEnviado = semData(texto0);
            enviou = true;
          });
        }
        return lerMetadados(id).then(function (meta) {
          if (meta.modifiedTime === estado.modificadoEm) return; // nada novo lá
          return baixar(id).then(function (texto) {
            importando = true;
            var r;
            try { r = backup.importar(texto); } finally { importando = false; }
            estado.modificadoEm = meta.modifiedTime || null;
            if (r && r.ok) {
              mesclou = true;
              if (backup.aoImportar) backup.aoImportar(r);
            }
          });
        }).then(function () {
          var texto = backup.exportar();
          var chave = semData(texto);
          if (chave === ultimoEnviado) return;
          return enviar(id, texto, motivo === "saida").then(function (meta) {
            ultimoEnviado = chave;
            estado.modificadoEm = meta.modifiedTime || estado.modificadoEm;
            enviou = true;
          });
        });
      })
      .then(function () {
        estado.ultimaSync = new Date().toISOString();
        estado.pendente = false;
        gravar();
        cb({ ok: true, mesclou: mesclou, enviou: enviou });
      })
      .catch(function (e) {
        var msg = String(e && e.message || e);
        if (msg === "token") {
          estado.pendente = true;
          estado.erro = null;
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
    pedirToken(!estado.ligado, function (ok) {
      if (!ok) { cb(false); return; }
      estado.ligado = true;
      estado.pendente = true;
      gravar();
      avisar();
      sincronizar("entrar", function (r) { cb(!!r.ok); });
    });
  }
  function sair() {
    var token = estado.token;
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token, function () {}); } catch (e) {}
    }
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
    // fechar a aba/app no meio da partida: manda o que der com keepalive
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
