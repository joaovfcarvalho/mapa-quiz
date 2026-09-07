"use strict";
// Pure scoring model; population groups preserve census geography without estimates.
var BAIRROS_METRICAS = (function () {
  function criar(bairros, meta) {
    var grupos = meta.gruposPopulacao || [];
    var agrupados = new Set(grupos.flatMap(function (g) { return g.ids; }));
    var unidades = bairros.filter(function (b) { return !agrupados.has(b.id) && b.populacao !== null; }).map(function (b) {
      return { ids: [b.id], populacao: b.populacao };
    }).concat(grupos);
    var populacao = unidades.reduce(function (s, u) { return s + u.populacao; }, 0);
    var area = bairros.reduce(function (s, b) { return s + b.area; }, 0);
    var top = unidades.slice().sort(function (a, b) { return b.populacao - a.populacao || a.ids[0].localeCompare(b.ids[0]); }).slice(0, 10);
    function resumo(ids) {
      var feitos = ids instanceof Set ? ids : new Set(ids);
      var completo = function (u) { return u.ids.every(function (id) { return feitos.has(id); }); };
      var pop = unidades.filter(completo).reduce(function (s, u) { return s + u.populacao; }, 0);
      var acertados = bairros.filter(function (b) { return feitos.has(b.id); });
      var km = acertados.reduce(function (s, b) { return s + b.area; }, 0);
      return { bairros: acertados.length, populacao: pop, area: km, top10: top.filter(completo).length,
        pct: { bairros: 100 * acertados.length / bairros.length, populacao: 100 * pop / populacao, area: 100 * km / area } };
    }
    return { total: { bairros: bairros.length, populacao: populacao, area: area }, top: top, resumo: resumo };
  }
  return { criar: criar };
})();
if (typeof module !== 'undefined') module.exports = BAIRROS_METRICAS;
