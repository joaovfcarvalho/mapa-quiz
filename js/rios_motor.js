"use strict";
// Motor do quiz dos rios: alvos do conjunto escolhido e interpretação do que
// foi digitado. Separado da interface (js/rios.js) porque o servidor do
// placar geral usa exatamente este código para refazer as partidas.
// Dados: data/rios.js — cada linha é [nome, nivel, km, [[[lng,lat],...], ...]].
var RIOS_MOTOR = (function () {
  // as mesmas regras de digitação do quiz de municípios: acentos, maiúsculas,
  // hífens e espaços não importam
  function normalizar(s) {
    return String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’´`]/g, "")
      .replace(/-/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Alvos do conjunto escolhido, com os rios homônimos fundidos num alvo só
  // (há cinco Rio Verde: digitou "verde", acendem os cinco e contam uma vez).
  // Cada alvo: {nome, nivel, km, linhas, partes, el, achado}
  function montarAlvos(conjunto) {
    var porNome = new Map();
    RIOS.forEach(function (r) {
      var nome = r[0], nivel = r[1], km = r[2], linhas = r[3];
      if (conjunto === "grandes" && nivel !== 1) return;
      var alvo = porNome.get(nome);
      if (!alvo) {
        porNome.set(nome, (alvo = {
          nome: nome, nivel: nivel, km: 0, linhas: [], partes: 0,
          el: null, achado: false,
        }));
      }
      alvo.nivel = Math.min(alvo.nivel, nivel);
      alvo.km += km;
      alvo.partes += 1;
      alvo.linhas = alvo.linhas.concat(linhas);
    });
    var alvos = Array.from(porNome.values());
    alvos.sort(function (a, b) { return b.km - a.km; });

    // índice de busca: cada forma aceita aponta para os alvos que casa —
    // sem o prefixo "rio", sem artigo inicial e tudo junto também valem;
    // nomes com alternativas ("Rio São Manuel ou Teles Pires") valem pelas duas
    var indice = new Map();
    function indexar(chave, alvo) {
      if (!chave) return;
      var lista = indice.get(chave);
      if (!lista) indice.set(chave, (lista = []));
      if (lista.indexOf(alvo) === -1) lista.push(alvo);
      var junta = chave.replace(/ /g, "");
      if (junta !== chave) indexar(junta, alvo);
    }
    alvos.forEach(function (alvo) {
      var resto = normalizar(alvo.nome).replace(/^rio /, "");
      resto.split(" ou ").forEach(function (alt) {
        indexar(alt, alvo);
        var semArtigo = alt.replace(/^d(a|as|o|os|e) /, "");
        if (semArtigo !== alt) indexar(semArtigo, alvo);
      });
    });
    return { alvos: alvos, indice: indice };
  }

  // Todas as formas que a digitação pode ter assumido, na ordem de tentativa.
  function buscar(indice, texto) {
    var t = normalizar(texto);
    if (!t) return [];
    var formas = [t, t.replace(/^rio /, ""), t.replace(/ /g, ""), t.replace(/ /g, "").replace(/^rio/, "")];
    var achados = [];
    formas.forEach(function (f) {
      (indice.get(f) || []).forEach(function (alvo) {
        if (achados.indexOf(alvo) === -1) achados.push(alvo);
      });
    });
    return achados;
  }

  // Configuração a partir da chave de recorde ("rios|conjunto=X|tempo=N"),
  // no mesmo espírito de MODOS.configDeChave. Devolve {cfg, chave} ou {erro}.
  function configDeChave(chave) {
    var m = /^rios\|conjunto=(grandes|todos)(?:\|tempo=(\d+))?$/.exec(String(chave || ""));
    if (!m) return { erro: "chave" };
    var cfg = { conjunto: m[1], tempoMin: null };
    if (m[2] !== undefined) {
      var t = parseInt(m[2], 10);
      if (t < 1 || t > 240 || String(t) !== m[2]) return { erro: "chave" };
      cfg.tempoMin = t;
    }
    return { cfg: cfg, chave: chave };
  }

  return {
    normalizar: normalizar,
    montarAlvos: montarAlvos,
    buscar: buscar,
    configDeChave: configDeChave,
  };
})();
