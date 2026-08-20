"use strict";
// Utilidades geográficas: distâncias, círculos geodésicos e projeção do mapa.
var GEO = (function () {
  var R_TERRA = 6371.0088; // raio médio da Terra em km
  var RAD = Math.PI / 180;

  function haversineKm(lat1, lng1, lat2, lng2) {
    var dLat = (lat2 - lat1) * RAD;
    var dLng = (lng2 - lng1) * RAD;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R_TERRA * Math.asin(Math.sqrt(a));
  }

  // Ponto de destino a partir de (lat,lng), rumo em graus e distância em km.
  function destino(lat, lng, rumoGraus, distKm) {
    var d = distKm / R_TERRA;
    var rumo = rumoGraus * RAD;
    var la1 = lat * RAD;
    var lo1 = lng * RAD;
    var la2 = Math.asin(
      Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(rumo)
    );
    var lo2 =
      lo1 +
      Math.atan2(
        Math.sin(rumo) * Math.sin(d) * Math.cos(la1),
        Math.cos(d) - Math.sin(la1) * Math.sin(la2)
      );
    return [la2 / RAD, lo2 / RAD];
  }

  // Polígono (lista de [lat,lng]) do círculo de raio fixo sobre a esfera —
  // desenhado assim, o círculo fica correto em qualquer projeção.
  function circuloGeodesico(lat, lng, raioKm, n) {
    n = n || 96;
    var pts = [];
    for (var i = 0; i < n; i++) {
      pts.push(destino(lat, lng, (360 * i) / n, raioKm));
    }
    return pts;
  }

  // Projeção equiretangular com o eixo x comprimido pelo cosseno da latitude
  // média — boa aproximação para a escala do Brasil.
  function criarProjecao(bounds, larguraPx) {
    var kx = Math.cos(((bounds.latMin + bounds.latMax) / 2) * RAD);
    var escala = larguraPx / ((bounds.lngMax - bounds.lngMin) * kx);
    return {
      w: larguraPx,
      h: (bounds.latMax - bounds.latMin) * escala,
      x: function (lng) { return (lng - bounds.lngMin) * kx * escala; },
      y: function (lat) { return (bounds.latMax - lat) * escala; },
    };
  }

  return {
    R_TERRA: R_TERRA,
    KM_POR_GRAU: 111.32,
    haversineKm: haversineKm,
    destino: destino,
    circuloGeodesico: circuloGeodesico,
    criarProjecao: criarProjecao,
  };
})();
