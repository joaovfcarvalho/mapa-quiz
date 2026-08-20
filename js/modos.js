"use strict";
// Motores dos três modos de jogo. Cada motor guarda o estado da partida e
// devolve resultados estruturados para a interface desenhar.
var MODOS = (function () {
  var municipios = DADOS.municipios; // já ordenados por população (desc)

  function extentCidades() {
    var latMin = 90, latMax = -90, lngMin = 180, lngMax = -180;
    municipios.forEach(function (m) {
      if (m.lat < latMin) latMin = m.lat;
      if (m.lat > latMax) latMax = m.lat;
      if (m.lng < lngMin) lngMin = m.lng;
      if (m.lng > lngMax) lngMax = m.lng;
    });
    return { latMin: latMin, latMax: latMax, lngMin: lngMin, lngMax: lngMax };
  }

  // ---------------------------------------------------------------
  // Modo 1 — Círculos por distância: cada palpite cobre tudo num raio fixo.
  // cfg: {raio, palpites, metrica: 'pop'|'cidades'}
  // ---------------------------------------------------------------
  function JogoCirculosDistancia(cfg) {
    this.cfg = cfg;
    this.jogadas = [];
    this.cobertos = new Set();
    this.popCoberta = 0;
    this.encerrado = false;
  }
  JogoCirculosDistancia.prototype.palpitesRestantes = function () {
    return this.cfg.palpites - this.jogadas.length;
  };
  JogoCirculosDistancia.prototype.palpitar = function (mun) {
    if (this.encerrado) return { tipo: "encerrado" };
    var repetido = this.jogadas.some(function (j) { return j.mun.idx === mun.idx; });
    if (repetido) return { tipo: "repetido", mun: mun };

    var novos = [];
    var ganhoPop = 0;
    var cobertos = this.cobertos;
    var raio = this.cfg.raio;
    municipios.forEach(function (m) {
      if (cobertos.has(m.idx)) return;
      if (GEO.haversineKm(mun.lat, mun.lng, m.lat, m.lng) <= raio) {
        cobertos.add(m.idx);
        novos.push(m.idx);
        ganhoPop += m.pop;
      }
    });
    this.popCoberta += ganhoPop;
    var jogada = { mun: mun, raioKm: raio, novos: novos, ganhoPop: ganhoPop };
    this.jogadas.push(jogada);
    if (this.jogadas.length >= this.cfg.palpites) this.encerrado = true;
    return { tipo: "ok", jogada: jogada };
  };
  JogoCirculosDistancia.prototype.pct = function () {
    return this.cfg.metrica === "cidades"
      ? this.cobertos.size / DADOS.total
      : this.popCoberta / DADOS.popTotal;
  };

  // ---------------------------------------------------------------
  // Modo 2 — Círculos por população: o círculo cresce a partir da cidade
  // chutada até somar a população alvo. cfg: {popAlvo, palpites}
  // ---------------------------------------------------------------
  function JogoCirculosPopulacao(cfg) {
    this.cfg = cfg;
    this.jogadas = [];
    this.cobertos = new Set();
    this.popCoberta = 0;
    this.encerrado = false;
  }
  JogoCirculosPopulacao.prototype.palpitesRestantes = function () {
    return this.cfg.palpites - this.jogadas.length;
  };
  JogoCirculosPopulacao.prototype.palpitar = function (mun) {
    if (this.encerrado) return { tipo: "encerrado" };
    var repetido = this.jogadas.some(function (j) { return j.mun.idx === mun.idx; });
    if (repetido) return { tipo: "repetido", mun: mun };

    // Ordena todo o país pela distância à cidade chutada e acumula população
    // (cidades já cobertas também contam para "encher" o círculo).
    var porDist = municipios
      .map(function (m) {
        return { m: m, d: GEO.haversineKm(mun.lat, mun.lng, m.lat, m.lng) };
      })
      .sort(function (a, b) { return a.d - b.d; });

    var acumulada = 0;
    var raio = 0;
    var dentro = [];
    for (var i = 0; i < porDist.length; i++) {
      acumulada += porDist[i].m.pop;
      dentro.push(porDist[i].m);
      raio = porDist[i].d;
      if (acumulada >= this.cfg.popAlvo) break;
    }
    raio = Math.max(raio, 8); // raio mínimo só para o círculo aparecer no mapa

    var novos = [];
    var ganhoPop = 0;
    var cobertos = this.cobertos;
    dentro.forEach(function (m) {
      if (!cobertos.has(m.idx)) {
        cobertos.add(m.idx);
        novos.push(m.idx);
        ganhoPop += m.pop;
      }
    });
    this.popCoberta += ganhoPop;
    var jogada = {
      mun: mun,
      raioKm: raio,
      novos: novos,
      ganhoPop: ganhoPop,
      popDentro: acumulada,
    };
    this.jogadas.push(jogada);
    if (this.jogadas.length >= this.cfg.palpites) this.encerrado = true;
    return { tipo: "ok", jogada: jogada };
  };
  JogoCirculosPopulacao.prototype.pct = function () {
    return this.popCoberta / DADOS.popTotal;
  };

  // ---------------------------------------------------------------
  // Modo 3 — Faixas: o mapa é dividido em faixas (latitude, longitude ou
  // anéis concêntricos) e é preciso nomear as N maiores cidades de cada uma.
  // cfg: {tipo: 'lat'|'lng'|'aneis', largura, topN, centro (município, só p/ anéis)}
  // ---------------------------------------------------------------
  function grauTxt(v, eixo) {
    var hemisferio = eixo === "lat" ? (v >= 0 ? "N" : "S") : "O";
    return Math.abs(v).toFixed(1).replace(".", ",") + "°" + hemisferio;
  }

  function JogoFaixas(cfg) {
    this.cfg = cfg;
    this.encerrado = false;
    this.achadosTotal = 0;

    var ext = extentCidades();
    var faixas = [];
    var indicePara; // função município -> índice da faixa

    if (cfg.tipo === "lat") {
      var deltaLat = cfg.largura / GEO.KM_POR_GRAU;
      var topo = ext.latMax + 1e-9;
      var nLat = Math.ceil((topo - ext.latMin) / deltaLat);
      for (var i = 0; i < nLat; i++) {
        faixas.push({
          indice: i,
          latSup: topo - i * deltaLat,
          latInf: topo - (i + 1) * deltaLat,
          rotulo: grauTxt(topo - i * deltaLat, "lat") + " a " + grauTxt(topo - (i + 1) * deltaLat, "lat"),
          alvos: [],
          achados: new Set(),
          nCidades: 0,
        });
      }
      indicePara = function (m) { return Math.floor((topo - m.lat) / deltaLat); };
    } else if (cfg.tipo === "lng") {
      var latRef = (ext.latMin + ext.latMax) / 2;
      var deltaLng = cfg.largura / (GEO.KM_POR_GRAU * Math.cos((latRef * Math.PI) / 180));
      var oeste = ext.lngMin - 1e-9;
      var nLng = Math.ceil((ext.lngMax - oeste) / deltaLng);
      for (var j = 0; j < nLng; j++) {
        faixas.push({
          indice: j,
          lngOeste: oeste + j * deltaLng,
          lngLeste: oeste + (j + 1) * deltaLng,
          rotulo: grauTxt(oeste + j * deltaLng, "lng") + " a " + grauTxt(oeste + (j + 1) * deltaLng, "lng"),
          alvos: [],
          achados: new Set(),
          nCidades: 0,
        });
      }
      indicePara = function (m) { return Math.floor((m.lng - oeste) / deltaLng); };
    } else {
      // anéis concêntricos em volta de cfg.centro
      var centro = cfg.centro;
      var distMax = 0;
      municipios.forEach(function (m) {
        var d = GEO.haversineKm(centro.lat, centro.lng, m.lat, m.lng);
        m._distCentro = d;
        if (d > distMax) distMax = d;
      });
      var nAneis = Math.ceil((distMax + 1e-9) / cfg.largura);
      for (var k = 0; k < nAneis; k++) {
        faixas.push({
          indice: k,
          kmInterno: k * cfg.largura,
          kmExterno: (k + 1) * cfg.largura,
          rotulo: k * cfg.largura + "–" + (k + 1) * cfg.largura + " km",
          alvos: [],
          achados: new Set(),
          nCidades: 0,
        });
      }
      indicePara = function (m) { return Math.floor(m._distCentro / cfg.largura); };
    }

    // municipios está ordenado por população desc: os primeiros topN de cada
    // faixa são exatamente as maiores cidades dela.
    municipios.forEach(function (m) {
      var idx = indicePara(m);
      var faixa = faixas[idx];
      if (!faixa) return;
      faixa.nCidades++;
      if (faixa.alvos.length < cfg.topN) faixa.alvos.push(m);
    });

    this.faixas = faixas.filter(function (f) { return f.nCidades > 0; });
    this.alvosTotal = 0;
    this.faixaPorAlvo = new Map(); // idx do município -> faixa
    var self = this;
    this.faixas.forEach(function (f) {
      self.alvosTotal += f.alvos.length;
      f.alvos.forEach(function (m) { self.faixaPorAlvo.set(m.idx, f); });
    });
  }

  JogoFaixas.prototype.palpitar = function (texto) {
    if (this.encerrado) return { tipo: "encerrado" };
    var res = DADOS.buscar(texto);
    if (res.status === "vazio") return { tipo: "vazio" };
    if (res.status === "nao_encontrado") return { tipo: "nao_encontrado", ufErrada: res.ufErrada };

    var revelados = [];
    var self = this;
    res.municipios.forEach(function (m) {
      var faixa = self.faixaPorAlvo.get(m.idx);
      if (faixa && !faixa.achados.has(m.idx)) {
        faixa.achados.add(m.idx);
        self.achadosTotal++;
        revelados.push({ mun: m, faixa: faixa });
      }
    });
    if (revelados.length === 0) return { tipo: "nao_alvo", municipios: res.municipios };
    if (this.achadosTotal >= this.alvosTotal) this.encerrado = true;
    return { tipo: "ok", revelados: revelados, completo: this.encerrado };
  };

  // Encerra revelando o que faltou; devolve a lista dos alvos não achados.
  JogoFaixas.prototype.encerrar = function () {
    this.encerrado = true;
    var faltantes = [];
    this.faixas.forEach(function (f) {
      f.alvos.forEach(function (m) {
        if (!f.achados.has(m.idx)) faltantes.push({ mun: m, faixa: f });
      });
    });
    return faltantes;
  };

  JogoFaixas.prototype.pct = function () {
    return this.alvosTotal === 0 ? 0 : this.achadosTotal / this.alvosTotal;
  };

  return {
    JogoCirculosDistancia: JogoCirculosDistancia,
    JogoCirculosPopulacao: JogoCirculosPopulacao,
    JogoFaixas: JogoFaixas,
  };
})();
