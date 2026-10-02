"use strict";
// Registro do que o jogador sabe sobre cada município — por dimensão, não
// só "já citou". Alimenta a página de pontos cegos e, adiante, os treinos
// dirigidos e as revanches. Tudo fica no localStorage, por código do IBGE:
//
//   c   citou de memória (evocação): digitou o nome sem ser perguntado —
//       no máximo uma vez por partida
//   l   localizou: rodadas do "Onde fica?" em que a cidade foi o alvo;
//   lp  soma das pontuações dessas rodadas (0..1) — a média lp/l diz se
//       ele acerta o lugar
//   f   faltou: era alvo (faixas, Top N, cerco, secreto do Onde estou?) e
//       ficou sem ser nomeada até o fim — uma vez por partida
//   d   dica: o jogo revelou pistas sobre ela a pedido
//   k   comparou: apareceu num duelo/ordenação de "Maior ou menor?";
//   ka  quantas dessas comparações ele acertou (a escala: população,
//       área, PIB, densidade)
//
// A contagem antiga (mapaquiz.citadas.v1, só "citou") é migrada para "c" na
// primeira leitura e continua sendo lida de backups antigos.
var CONHECIMENTO = (function () {
  var LS = "mapaquiz.conhecimento.v1";
  var LS_ANTIGO = "mapaquiz.citadas.v1";
  // Quando o jogador zerou os pontos cegos pela última vez (ISO). Vai no
  // backup como "_zeradoEm": os contadores não têm data, então quem traz a
  // marca mais recente ganha — dados de antes do zerar não ressuscitam.
  var LS_ZERADO = "mapaquiz.conhecimento.zerado.v1";
  var CHAVE_ZERADO_BACKUP = "_zeradoEm";
  var CAMPOS = ["c", "l", "lp", "f", "d", "k", "ka"];
  var cache = null;
  var partida = {}; // dimensão -> Set de ids já contados nesta partida

  // Só códigos do IBGE (7 dígitos) viram chave — "__proto__" e afins nunca.
  function idValido(id) {
    return /^\d{7}$/.test(String(id));
  }
  function tem(obj, k) {
    return Object.prototype.hasOwnProperty.call(obj, k);
  }
  function ehDataIso(v) {
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v);
  }
  function lerZeradoEm() {
    var v = null;
    try { v = localStorage.getItem(LS_ZERADO); } catch (e) { v = null; }
    return ehDataIso(v) ? v : "";
  }

  function ler() {
    if (cache) return cache;
    var bruto = null;
    try { bruto = JSON.parse(localStorage.getItem(LS)); } catch (e) { bruto = null; }
    var dados = {};
    if (bruto && typeof bruto === "object") {
      Object.keys(bruto).forEach(function (id) {
        if (idValido(id) && bruto[id] && typeof bruto[id] === "object") dados[id] = bruto[id];
      });
    } else {
      // migração da contagem antiga: nº de partidas em que citou
      var antigo = null;
      try { antigo = JSON.parse(localStorage.getItem(LS_ANTIGO)); } catch (e) { antigo = null; }
      if (antigo && typeof antigo === "object") {
        Object.keys(antigo).forEach(function (id) {
          var n = +antigo[id] || 0;
          if (n > 0 && idValido(id)) dados[id] = { c: n };
        });
      }
    }
    cache = dados;
    return cache;
  }

  function avisarMudanca() {
    try {
      if (typeof document !== "undefined" && document.dispatchEvent) {
        document.dispatchEvent(new CustomEvent("mapaquiz:dados", { detail: { origem: "conhecimento" } }));
      }
    } catch (e) {}
  }
  function salvar() {
    try { localStorage.setItem(LS, JSON.stringify(cache)); } catch (e) {}
    avisarMudanca();
  }

  function registro(id) {
    var d = ler();
    if (!idValido(id)) return {}; // descartado: não vai para o armazenamento
    return tem(d, id) ? d[id] : (d[id] = {});
  }
  function somar(id, campo, quanto) {
    var r = registro(id);
    r[campo] = Math.round(((r[campo] || 0) + quanto) * 1000) / 1000;
  }

  // Nova partida: as dimensões "uma vez por partida" recomeçam.
  function novaPartida() {
    partida = {};
  }
  function umaVez(dim, id) {
    var s = partida[dim] || (partida[dim] = new Set());
    if (s.has(id)) return false;
    s.add(id);
    return true;
  }

  // ---- eventos ----
  function citou(muns) {
    var mudou = false;
    muns.forEach(function (m) {
      if (!umaVez("c", m.id)) return;
      somar(m.id, "c", 1);
      mudou = true;
    });
    if (mudou) salvar();
  }
  function localizou(mun, score) {
    somar(mun.id, "l", 1);
    somar(mun.id, "lp", Math.max(0, Math.min(1, score)));
    salvar();
  }
  function faltou(muns) {
    var mudou = false;
    muns.forEach(function (m) {
      if (!umaVez("f", m.id)) return;
      somar(m.id, "f", 1);
      mudou = true;
    });
    if (mudou) salvar();
  }
  function dica(mun) {
    if (!umaVez("d", mun.id)) return;
    somar(mun.id, "d", 1);
    salvar();
  }
  function comparou(muns, acertou) {
    muns.forEach(function (m) {
      somar(m.id, "k", 1);
      if (acertou) somar(m.id, "ka", 1);
    });
    salvar();
  }

  // ---- consultas ----
  function de(mun) {
    var d = ler();
    return (tem(d, mun.id) && d[mun.id]) || {};
  }
  function vezesCitou(mun) { return de(mun).c || 0; }
  // Para o backup: os registros por município e, se houver, a marca do
  // último zerar em "_zeradoEm" (versões antigas a ignoram: não é objeto).
  function tudo() {
    var z = lerZeradoEm();
    if (!z) return ler();
    var out = Object.assign({}, ler());
    out[CHAVE_ZERADO_BACKUP] = z;
    return out;
  }
  // contagem antiga (id -> nº de partidas em que citou), para compatibilidade
  function comoCitadas() {
    var d = ler();
    var out = {};
    Object.keys(d).forEach(function (id) { if (d[id].c) out[id] = d[id].c; });
    return out;
  }

  // Mescla (backup/sincronização): o maior contador de cada campo — nunca
  // diminui nada e importar duas vezes o mesmo backup não dobra nada.
  // Zerar: vale o lado com a marca de zerado mais recente. Se a de lá é mais
  // velha (ou não existe) que a daqui, o que veio é de antes do nosso zerar
  // e fica de fora; se é mais nova, o daqui é que é de antes e sai.
  function mesclar(outro, citadasAntigas) {
    var d = ler();
    var mudou = false;
    var meuZerado = lerZeradoEm();
    var delesZerado = outro && typeof outro === "object" && tem(outro, CHAVE_ZERADO_BACKUP) &&
      ehDataIso(outro[CHAVE_ZERADO_BACKUP]) ? outro[CHAVE_ZERADO_BACKUP] : "";
    if (delesZerado < meuZerado) return false;
    if (delesZerado > meuZerado) {
      try { localStorage.setItem(LS_ZERADO, delesZerado); } catch (e) {}
      try { localStorage.removeItem(LS_ANTIGO); } catch (e) {}
      if (Object.keys(d).length) mudou = true;
      d = cache = {};
    }
    function meuRegistro(id) {
      return tem(d, id) ? d[id] : (d[id] = {});
    }
    if (outro && typeof outro === "object") {
      Object.keys(outro).forEach(function (id) {
        if (!idValido(id)) return;
        var deles = outro[id];
        if (!deles || typeof deles !== "object") return;
        var meu = meuRegistro(id);
        CAMPOS.forEach(function (campo) {
          var v = +deles[campo] || 0;
          if (v > (meu[campo] || 0)) { meu[campo] = v; mudou = true; }
        });
      });
    }
    if (citadasAntigas && typeof citadasAntigas === "object") {
      Object.keys(citadasAntigas).forEach(function (id) {
        if (!idValido(id)) return;
        var v = +citadasAntigas[id] || 0;
        if (v <= 0) return;
        var meu = meuRegistro(id);
        if (v > (meu.c || 0)) { meu.c = v; mudou = true; }
      });
    }
    if (mudou) salvar();
    return mudou;
  }

  function zerar() {
    cache = {};
    try {
      localStorage.removeItem(LS);
      localStorage.removeItem(LS_ANTIGO);
      localStorage.setItem(LS_ZERADO, new Date().toISOString());
    } catch (e) {}
    avisarMudanca();
  }

  return {
    novaPartida: novaPartida,
    citou: citou,
    localizou: localizou,
    faltou: faltou,
    dica: dica,
    comparou: comparou,
    de: de,
    vezesCitou: vezesCitou,
    tudo: tudo,
    comoCitadas: comoCitadas,
    mesclar: mesclar,
    zerar: zerar,
    CAMPOS: CAMPOS,
  };
})();
