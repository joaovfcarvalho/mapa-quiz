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
  var CAMPOS = ["c", "l", "lp", "f", "d", "k", "ka"];
  var cache = null;
  var partida = {}; // dimensão -> Set de ids já contados nesta partida

  function ler() {
    if (cache) return cache;
    var dados = null;
    try { dados = JSON.parse(localStorage.getItem(LS)); } catch (e) { dados = null; }
    if (!dados || typeof dados !== "object") {
      dados = {};
      // migração da contagem antiga: nº de partidas em que citou
      var antigo = null;
      try { antigo = JSON.parse(localStorage.getItem(LS_ANTIGO)); } catch (e) { antigo = null; }
      if (antigo && typeof antigo === "object") {
        Object.keys(antigo).forEach(function (id) {
          var n = +antigo[id] || 0;
          if (n > 0) dados[id] = { c: n };
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
    return d[id] || (d[id] = {});
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
  function de(mun) { return ler()[mun.id] || {}; }
  function vezesCitou(mun) { return de(mun).c || 0; }
  function tudo() { return ler(); }
  // contagem antiga (id -> nº de partidas em que citou), para compatibilidade
  function comoCitadas() {
    var d = ler();
    var out = {};
    Object.keys(d).forEach(function (id) { if (d[id].c) out[id] = d[id].c; });
    return out;
  }

  // Mescla (backup/sincronização): o maior contador de cada campo — nunca
  // diminui nada e importar duas vezes o mesmo backup não dobra nada.
  function mesclar(outro, citadasAntigas) {
    var d = ler();
    var mudou = false;
    if (outro && typeof outro === "object") {
      Object.keys(outro).forEach(function (id) {
        var deles = outro[id];
        if (!deles || typeof deles !== "object") return;
        var meu = d[id] || (d[id] = {});
        CAMPOS.forEach(function (campo) {
          var v = +deles[campo] || 0;
          if (v > (meu[campo] || 0)) { meu[campo] = v; mudou = true; }
        });
      });
    }
    if (citadasAntigas && typeof citadasAntigas === "object") {
      Object.keys(citadasAntigas).forEach(function (id) {
        var v = +citadasAntigas[id] || 0;
        var meu = d[id] || (d[id] = {});
        if (v > (meu.c || 0)) { meu.c = v; mudou = true; }
      });
    }
    if (mudou) salvar();
    return mudou;
  }

  function zerar() {
    cache = {};
    try { localStorage.removeItem(LS); localStorage.removeItem(LS_ANTIGO); } catch (e) {}
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
