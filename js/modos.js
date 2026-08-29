"use strict";
// Motores dos modos de jogo. Cada motor guarda o estado da partida e
// devolve resultados estruturados para a interface desenhar.
var MODOS = (function () {
  var municipios = DADOS.municipios; // já ordenados por população (desc)

  // Universo da partida: o Brasil inteiro ou só os municípios de uma UF
  // (cfg.uf). O filtro preserva a ordenação por população.
  function universoDe(cfg) {
    var lista = cfg.uf
      ? municipios.filter(function (m) { return m.uf === cfg.uf; })
      : municipios;
    var pop = 0;
    var area = 0;
    lista.forEach(function (m) { pop += m.pop; area += m.area; });
    return { lista: lista, pop: pop, area: area };
  }

  function dentroDaRegiao(cfg, muns) {
    if (!cfg.uf) return muns;
    var uf = cfg.uf;
    return muns.filter(function (m) { return m.uf === uf; });
  }

  function extentCidades(lista) {
    var latMin = 90, latMax = -90, lngMin = 180, lngMax = -180;
    lista.forEach(function (m) {
      if (m.lat < latMin) latMin = m.lat;
      if (m.lat > latMax) latMax = m.lat;
      if (m.lng < lngMin) lngMin = m.lng;
      if (m.lng > lngMax) lngMax = m.lng;
    });
    return { latMin: latMin, latMax: latMax, lngMin: lngMin, lngMax: lngMax };
  }

  // ---------------------------------------------------------------
  // Modo 1 — Círculos por distância: cada palpite cobre tudo num raio fixo.
  // cfg: {raio, metrica: 'pop'|'cidades'|'area', palpites? (sem limite se
  //       ausente), uf? (só uma UF se presente)}
  // ---------------------------------------------------------------
  function JogoCirculosDistancia(cfg) {
    this.cfg = cfg;
    var u = universoDe(cfg);
    this.universo = u.lista;
    this.uniPop = u.pop;
    this.uniArea = u.area;
    this.jogadas = [];
    this.usados = new Set();   // idx dos municípios já chutados
    this.cobertos = new Set();
    this.popCoberta = 0;
    this.areaCoberta = 0;      // km²: um município coberto conta o território inteiro
    this.encerrado = false;
  }
  JogoCirculosDistancia.prototype.palpitesRestantes = function () {
    return this.cfg.palpites - this.jogadas.length;
  };
  // Recebe uma lista de municípios (homônimos entram juntos): a jogada é uma
  // só, com um círculo por município ainda não usado.
  JogoCirculosDistancia.prototype.palpitar = function (muns) {
    if (this.encerrado) return { tipo: "encerrado" };
    var usados = this.usados;
    var lista = muns.filter(function (m) { return !usados.has(m.idx); });
    if (lista.length === 0) return { tipo: "repetido", mun: muns[0] };
    if (this.cfg.bloqueio) {
      var cobertosB = this.cobertos;
      var livres = lista.filter(function (m) { return !cobertosB.has(m.idx); });
      if (livres.length === 0) return { tipo: "coberto", mun: lista[0] };
      lista = livres;
    }

    var novos = [];
    var ganhoPop = 0;
    var ganhoArea = 0;
    var circulos = [];
    var cobertos = this.cobertos;
    var raio = this.cfg.raio;
    var uni = this.universo;
    lista.forEach(function (mun) {
      usados.add(mun.idx);
      circulos.push({ mun: mun, raioKm: raio });
      uni.forEach(function (m) {
        if (cobertos.has(m.idx)) return;
        if (GEO.haversineKm(mun.lat, mun.lng, m.lat, m.lng) <= raio) {
          cobertos.add(m.idx);
          novos.push(m.idx);
          ganhoPop += m.pop;
          ganhoArea += m.area;
        }
      });
    });
    this.popCoberta += ganhoPop;
    this.areaCoberta += ganhoArea;
    var jogada = { muns: lista, circulos: circulos, novos: novos, ganhoPop: ganhoPop, ganhoArea: ganhoArea };
    this.jogadas.push(jogada);
    if (this.cfg.palpites && this.jogadas.length >= this.cfg.palpites) this.encerrado = true;
    return { tipo: "ok", jogada: jogada };
  };
  JogoCirculosDistancia.prototype.pct = function () {
    if (this.cfg.metrica === "cidades") return this.cobertos.size / this.universo.length;
    if (this.cfg.metrica === "area") return this.areaCoberta / this.uniArea;
    return this.popCoberta / this.uniPop;
  };

  // ---------------------------------------------------------------
  // Modo 2 — Círculos por população: o círculo cresce a partir da cidade
  // chutada até somar a população alvo.
  // cfg: {popAlvo, palpites? (sem limite se ausente), uf?}
  // ---------------------------------------------------------------
  function JogoCirculosPopulacao(cfg) {
    this.cfg = cfg;
    var u = universoDe(cfg);
    this.universo = u.lista;
    this.uniPop = u.pop;
    this.jogadas = [];
    this.usados = new Set();   // idx dos municípios já chutados
    this.cobertos = new Set();
    this.popCoberta = 0;
    this.encerrado = false;
  }
  JogoCirculosPopulacao.prototype.palpitesRestantes = function () {
    return this.cfg.palpites - this.jogadas.length;
  };
  // Recebe uma lista de municípios (homônimos entram juntos): a jogada é uma
  // só, com um círculo próprio crescendo em volta de cada município.
  JogoCirculosPopulacao.prototype.palpitar = function (muns) {
    if (this.encerrado) return { tipo: "encerrado" };
    var usados = this.usados;
    var lista = muns.filter(function (m) { return !usados.has(m.idx); });
    if (lista.length === 0) return { tipo: "repetido", mun: muns[0] };
    if (this.cfg.bloqueio) {
      var cobertosB = this.cobertos;
      var livres = lista.filter(function (m) { return !cobertosB.has(m.idx); });
      if (livres.length === 0) return { tipo: "coberto", mun: lista[0] };
      lista = livres;
    }

    var novos = [];
    var ganhoPop = 0;
    var circulos = [];
    var cobertos = this.cobertos;
    var popAlvo = this.cfg.popAlvo;
    var uni = this.universo;
    lista.forEach(function (mun) {
      usados.add(mun.idx);

      // Ordena o universo pela distância à cidade chutada e acumula população
      // (cidades já cobertas também contam para "encher" o círculo).
      var porDist = uni
        .map(function (m) {
          return { m: m, d: GEO.haversineKm(mun.lat, mun.lng, m.lat, m.lng) };
        })
        .sort(function (a, b) { return a.d - b.d; });

      var acumulada = 0;
      var raio = 0;
      for (var i = 0; i < porDist.length; i++) {
        var m = porDist[i].m;
        acumulada += m.pop;
        raio = porDist[i].d;
        if (!cobertos.has(m.idx)) {
          cobertos.add(m.idx);
          novos.push(m.idx);
          ganhoPop += m.pop;
        }
        if (acumulada >= popAlvo) break;
      }
      raio = Math.max(raio, 8); // raio mínimo só para o círculo aparecer no mapa
      circulos.push({ mun: mun, raioKm: raio, popDentro: acumulada });
    });
    this.popCoberta += ganhoPop;
    var jogada = { muns: lista, circulos: circulos, novos: novos, ganhoPop: ganhoPop };
    this.jogadas.push(jogada);
    if (this.cfg.palpites && this.jogadas.length >= this.cfg.palpites) this.encerrado = true;
    return { tipo: "ok", jogada: jogada };
  };
  JogoCirculosPopulacao.prototype.pct = function () {
    return this.popCoberta / this.uniPop;
  };

  // ---------------------------------------------------------------
  // Modo 3 — Faixas: o mapa é dividido em faixas (latitude, longitude,
  // anéis concêntricos ou uma grade lat × lng) e é preciso nomear as N
  // maiores cidades de cada uma.
  // cfg: {tipo: 'lat'|'lng'|'aneis'|'grade', largura, topN, centro
  //       (município, só p/ anéis), uf?}
  // ---------------------------------------------------------------
  function grauTxt(v, eixo) {
    var hemisferio = eixo === "lat" ? (v >= 0 ? "N" : "S") : "O";
    return Math.abs(v).toFixed(1).replace(".", ",") + "°" + hemisferio;
  }

  // rótulo de coluna estilo planilha: 0 -> A, 25 -> Z, 26 -> AA…
  function letraColuna(n) {
    var s = "";
    n++;
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function JogoFaixas(cfg) {
    this.cfg = cfg;
    var u = universoDe(cfg);
    this.universo = u.lista;
    this.uniPop = u.pop;
    this.encerrado = false;
    this.achadosTotal = 0;

    var ext = extentCidades(this.universo);
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
    } else if (cfg.tipo === "grade") {
      // grade: células de largura × largura km (lat × lng juntas)
      var dLat = cfg.largura / GEO.KM_POR_GRAU;
      var latRefG = (ext.latMin + ext.latMax) / 2;
      var dLng = cfg.largura / (GEO.KM_POR_GRAU * Math.cos((latRefG * Math.PI) / 180));
      var topoG = ext.latMax + 1e-9;
      var oesteG = ext.lngMin - 1e-9;
      var nLin = Math.ceil((topoG - ext.latMin) / dLat);
      var nCol = Math.ceil((ext.lngMax - oesteG) / dLng);
      for (var g = 0; g < nLin * nCol; g++) {
        var li = Math.floor(g / nCol);
        var co = g % nCol;
        faixas.push({
          indice: g,
          celula: letraColuna(co) + (li + 1),
          latSup: topoG - li * dLat,
          latInf: topoG - (li + 1) * dLat,
          lngOeste: oesteG + co * dLng,
          lngLeste: oesteG + (co + 1) * dLng,
          rotulo: letraColuna(co) + (li + 1) + " · " +
            grauTxt(topoG - li * dLat, "lat") + " × " + grauTxt(oesteG + co * dLng, "lng"),
          alvos: [],
          achados: new Set(),
          nCidades: 0,
        });
      }
      indicePara = function (m) {
        return Math.floor((topoG - m.lat) / dLat) * nCol + Math.floor((m.lng - oesteG) / dLng);
      };
    } else {
      // anéis concêntricos em volta de cfg.centro
      var centro = cfg.centro;
      var distMax = 0;
      this.universo.forEach(function (m) {
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

    // o universo está ordenado por população desc: os primeiros topN de cada
    // faixa são exatamente as maiores cidades dela.
    this.universo.forEach(function (m) {
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
    var cand = dentroDaRegiao(this.cfg, res.municipios);
    if (cand.length === 0) return { tipo: "fora_regiao", municipios: res.municipios };

    var revelados = [];
    var self = this;
    var jaTinha = false;
    cand.forEach(function (m) {
      var faixa = self.faixaPorAlvo.get(m.idx);
      if (!faixa) return;
      if (faixa.achados.has(m.idx)) { jaTinha = true; return; }
      faixa.achados.add(m.idx);
      self.achadosTotal++;
      revelados.push({ mun: m, faixa: faixa });
    });
    if (revelados.length === 0) {
      return jaTinha
        ? { tipo: "repetido", mun: cand[0] }
        : { tipo: "nao_alvo", municipios: cand };
    }
    if (this.achadosTotal >= this.alvosTotal) this.encerrado = true;
    return { tipo: "ok", revelados: revelados, completo: this.encerrado };
  };

  // Dica: descreve o maior alvo ainda não achado (o universo está ordenado
  // por população, então a primeira faixa com alvo faltante já serve).
  JogoFaixas.prototype.dica = function () {
    var melhor = null;
    this.faixas.forEach(function (f) {
      f.alvos.forEach(function (m) {
        if (!f.achados.has(m.idx) && (!melhor || m.pop > melhor.mun.pop)) {
          melhor = { mun: m, faixa: f };
        }
      });
    });
    return melhor;
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

  // ---------------------------------------------------------------
  // Modo 4 — Top N: citar de memória as N maiores cidades do universo.
  // Os alvos são revelados no mapa e na lista com a posição no ranking.
  // cfg: {n, uf?, tempoMin?}
  // ---------------------------------------------------------------
  function JogoTopN(cfg) {
    this.cfg = cfg;
    var u = universoDe(cfg);
    this.universo = u.lista;
    this.uniPop = u.pop;
    this.encerrado = false;
    this.achadosTotal = 0;
    this.alvos = this.universo.slice(0, Math.min(cfg.n, this.universo.length));
    this.alvosTotal = this.alvos.length;
    this.achados = new Set();
    this.rankPorAlvo = new Map(); // idx do município -> posição (1..N)
    var self = this;
    this.alvos.forEach(function (m, i) { self.rankPorAlvo.set(m.idx, i + 1); });
  }

  JogoTopN.prototype.palpitar = function (texto) {
    if (this.encerrado) return { tipo: "encerrado" };
    var res = DADOS.buscar(texto);
    if (res.status === "vazio") return { tipo: "vazio" };
    if (res.status === "nao_encontrado") return { tipo: "nao_encontrado", ufErrada: res.ufErrada };
    var cand = dentroDaRegiao(this.cfg, res.municipios);
    if (cand.length === 0) return { tipo: "fora_regiao", municipios: res.municipios };

    var revelados = [];
    var self = this;
    var jaTinha = false;
    cand.forEach(function (m) {
      var rank = self.rankPorAlvo.get(m.idx);
      if (rank === undefined) return;
      if (self.achados.has(m.idx)) { jaTinha = true; return; }
      self.achados.add(m.idx);
      self.achadosTotal++;
      revelados.push({ mun: m, rank: rank });
    });
    if (revelados.length === 0) {
      return jaTinha
        ? { tipo: "repetido", mun: cand[0] }
        : { tipo: "nao_alvo", municipios: cand };
    }
    if (this.achadosTotal >= this.alvosTotal) this.encerrado = true;
    return { tipo: "ok", revelados: revelados, completo: this.encerrado };
  };

  // Dica: o maior alvo ainda não achado (alvos já estão em ordem de população).
  JogoTopN.prototype.dica = function () {
    for (var i = 0; i < this.alvos.length; i++) {
      var m = this.alvos[i];
      if (!this.achados.has(m.idx)) return { mun: m, rank: i + 1 };
    }
    return null;
  };

  // Encerra revelando o que faltou; devolve a lista dos alvos não achados.
  JogoTopN.prototype.encerrar = function () {
    this.encerrado = true;
    var faltantes = [];
    var self = this;
    this.alvos.forEach(function (m, i) {
      if (!self.achados.has(m.idx)) faltantes.push({ mun: m, rank: i + 1 });
    });
    return faltantes;
  };

  JogoTopN.prototype.pct = function () {
    return this.alvosTotal === 0 ? 0 : this.achadosTotal / this.alvosTotal;
  };

  // ---------------------------------------------------------------
  // Modo 5 — Onde estou?: o jogo sorteia um município secreto (com população
  // mínima cfg.minPop) e cada palpite responde com distância e direção.
  // cfg: {minPop, uf?}
  // ---------------------------------------------------------------
  function JogoOndeEstou(cfg) {
    this.cfg = cfg;
    var u = universoDe(cfg);
    this.universo = u.lista;
    this.pool = this.universo.filter(function (m) { return m.pop >= cfg.minPop; });
    this.secreto = this.pool[Math.floor(Math.random() * this.pool.length)];
    this.palpites = [];          // {mun, distKm, rumo}
    this.usados = new Set();
    this.dicasDadas = 0;         // cada dica custa +1 palpite no placar
    this.melhorDist = Infinity;
    this.encerrado = false;
    this.venceu = false;
  }
  JogoOndeEstou.prototype.totalPalpites = function () {
    return this.palpites.length + this.dicasDadas;
  };
  JogoOndeEstou.prototype.palpitar = function (texto) {
    if (this.encerrado) return { tipo: "encerrado" };
    var res = DADOS.buscar(texto);
    if (res.status === "vazio") return { tipo: "vazio" };
    if (res.status === "nao_encontrado") return { tipo: "nao_encontrado", ufErrada: res.ufErrada };
    var cand = dentroDaRegiao(this.cfg, res.municipios);
    if (cand.length === 0) return { tipo: "fora_regiao", municipios: res.municipios };
    if (cand.length > 1) return { tipo: "ambiguo", municipios: cand };
    var mun = cand[0];
    if (this.usados.has(mun.idx)) return { tipo: "repetido", mun: mun };
    this.usados.add(mun.idx);
    var s = this.secreto;
    var d = GEO.haversineKm(mun.lat, mun.lng, s.lat, s.lng);
    var r = GEO.rumo(mun.lat, mun.lng, s.lat, s.lng);
    if (d < this.melhorDist) this.melhorDist = d;
    var jogada = { mun: mun, distKm: d, rumo: r };
    this.palpites.push(jogada);
    if (mun.idx === s.idx) {
      this.encerrado = true;
      this.venceu = true;
    }
    return { tipo: "ok", mun: mun, distKm: d, rumo: r, acertou: this.venceu };
  };
  // Dicas progressivas sobre o secreto: UF, primeira letra, população.
  JogoOndeEstou.prototype.dica = function () {
    if (this.dicasDadas >= 3) return null;
    var etapa = this.dicasDadas++;
    var s = this.secreto;
    if (etapa === 0) return { etapa: 1, tipo: "uf", valor: s.uf };
    if (etapa === 1) return { etapa: 2, tipo: "letra", valor: s.nome.charAt(0) };
    return { etapa: 3, tipo: "pop", valor: s.pop };
  };
  JogoOndeEstou.prototype.encerrar = function () {
    this.encerrado = true;
    return this.secreto;
  };
  // Pontuação: 100% acertando de primeira, −4 pontos por palpite (ou dica)
  // extra, piso de 4%; desistir vale 0.
  JogoOndeEstou.prototype.pct = function () {
    if (!this.venceu) return 0;
    return Math.max(0.04, 1 - 0.04 * (this.totalPalpites() - 1));
  };

  // ---------------------------------------------------------------
  // Modo 6 — Onde fica?: o jogo mostra um nome e o jogador clica no mapa;
  // a rodada vale mais pontos quanto menor o erro em km.
  // cfg: {minPop, rodadas, uf?}
  // ---------------------------------------------------------------
  function JogoClique(cfg) {
    this.cfg = cfg;
    var u = universoDe(cfg);
    this.universo = u.lista;
    var pool = this.universo.filter(function (m) { return m.pop >= cfg.minPop; });
    // sorteio sem reposição (Fisher–Yates parcial)
    var copia = pool.slice();
    for (var i = copia.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copia[i]; copia[i] = copia[j]; copia[j] = tmp;
    }
    this.alvos = copia.slice(0, Math.min(cfg.rodadas, copia.length));
    this.resultados = [];        // {mun, lat, lng, distKm, score}
    this.encerrado = false;
  }
  JogoClique.prototype.alvoAtual = function () {
    return this.encerrado ? null : this.alvos[this.resultados.length] || null;
  };
  // Pontuação da rodada: 100% até 15 km de erro, caindo linearmente a 0 em 500 km.
  JogoClique.prototype.responder = function (lat, lng) {
    var alvo = this.alvoAtual();
    if (!alvo) return null;
    var d = GEO.haversineKm(lat, lng, alvo.lat, alvo.lng);
    var score = Math.max(0, Math.min(1, 1 - (d - 15) / 485));
    var r = { mun: alvo, lat: lat, lng: lng, distKm: d, score: score };
    this.resultados.push(r);
    if (this.resultados.length >= this.alvos.length) this.encerrado = true;
    return r;
  };
  JogoClique.prototype.erroMedioKm = function () {
    if (this.resultados.length === 0) return 0;
    var s = 0;
    this.resultados.forEach(function (r) { s += r.distKm; });
    return s / this.resultados.length;
  };
  // Rodadas não respondidas valem 0 — desistir no meio conta contra a média.
  JogoClique.prototype.pct = function () {
    var s = 0;
    this.resultados.forEach(function (r) { s += r.score; });
    return this.alvos.length === 0 ? 0 : s / this.alvos.length;
  };

  // ---------------------------------------------------------------
  // Modo 7 — Maratona: citar todos os municípios da região, com progresso
  // persistente entre sessões (a interface injeta/salva os ids achados).
  // cfg: {uf?, idsIniciais?: array de ids do IBGE já achados}
  // ---------------------------------------------------------------
  function JogoMaratona(cfg) {
    this.cfg = cfg;
    var u = universoDe(cfg);
    this.universo = u.lista;
    this.alvosTotal = this.universo.length;
    this.uniPop = u.pop;
    this.popAchada = 0;
    this.achados = new Set();
    this.achadosSessao = 0;
    this.encerrado = false;
    if (cfg.idsIniciais && cfg.idsIniciais.length) {
      var ids = new Set(cfg.idsIniciais);
      var achados = this.achados;
      var pop = 0;
      this.universo.forEach(function (m) {
        if (ids.has(m.id)) { achados.add(m.idx); pop += m.pop; }
      });
      this.popAchada = pop;
    }
  }
  JogoMaratona.prototype.palpitar = function (texto) {
    if (this.encerrado) return { tipo: "encerrado" };
    var res = DADOS.buscar(texto);
    if (res.status === "vazio") return { tipo: "vazio" };
    if (res.status === "nao_encontrado") return { tipo: "nao_encontrado", ufErrada: res.ufErrada };
    var cand = dentroDaRegiao(this.cfg, res.municipios);
    if (cand.length === 0) return { tipo: "fora_regiao", municipios: res.municipios };
    var revelados = [];
    var self = this;
    cand.forEach(function (m) {
      if (self.achados.has(m.idx)) return;
      self.achados.add(m.idx);
      self.achadosSessao++;
      self.popAchada += m.pop;
      revelados.push({ mun: m });
    });
    if (revelados.length === 0) return { tipo: "repetido", mun: cand[0] };
    if (this.achados.size >= this.alvosTotal) this.encerrado = true;
    return { tipo: "ok", revelados: revelados, completo: this.encerrado };
  };
  // Dica (grátis na maratona): o maior município que ainda falta.
  JogoMaratona.prototype.dica = function () {
    for (var i = 0; i < this.universo.length; i++) {
      var m = this.universo[i];
      if (!this.achados.has(m.idx)) return { mun: m };
    }
    return null;
  };
  JogoMaratona.prototype.idsAchados = function () {
    var achados = this.achados;
    return this.universo
      .filter(function (m) { return achados.has(m.idx); })
      .map(function (m) { return m.id; });
  };
  JogoMaratona.prototype.pct = function () {
    return this.alvosTotal === 0 ? 0 : this.achados.size / this.alvosTotal;
  };

  // ---------------------------------------------------------------
  // Grafo de divisas (modos Caminho, Cerco, Mancha e Ponte). Os vizinhos vêm
  // de data/vizinhos.js (VIZINHOS, carregado sob demanda pela interface) e
  // aqui viram listas de municípios por idx, ordenadas por população — a
  // ordem que o Cerco e as dicas usam. Ilhas (Ilhabela, Fernando de Noronha)
  // e municípios fora da malha ficam com lista vazia.
  // ---------------------------------------------------------------
  var _vizinhos = null; // idx -> [municipio, ...]
  function grafo() {
    if (_vizinhos) return _vizinhos;
    var porId = new Map();
    municipios.forEach(function (m) { porId.set(m.id, m); });
    _vizinhos = municipios.map(function (m) {
      var ids = (window.VIZINHOS && VIZINHOS[m.id]) || [];
      return ids
        .map(function (id) { return porId.get(id); })
        .filter(Boolean)
        .sort(function (a, b) { return b.pop - a.pop; });
    });
    return _vizinhos;
  }

  function conjuntoIdx(lista) {
    var s = new Set();
    lista.forEach(function (m) { s.add(m.idx); });
    return s;
  }

  // Menor caminho (em saltos) entre dois municípios, por BFS; permitido (Set
  // de idx) restringe o grafo (ex.: só a UF da partida). Devolve a lista de
  // municípios da origem ao destino, ou null se não há caminho.
  function menorCaminho(origem, destino, permitido) {
    var adj = grafo();
    var ant = new Map();
    ant.set(origem.idx, null);
    var fila = [origem.idx];
    for (var i = 0; i < fila.length; i++) {
      var v = fila[i];
      if (v === destino.idx) {
        var caminho = [];
        for (var p = v; p !== null; p = ant.get(p)) caminho.push(municipios[p]);
        return caminho.reverse();
      }
      adj[v].forEach(function (m) {
        if (ant.has(m.idx)) return;
        if (permitido && !permitido.has(m.idx)) return;
        ant.set(m.idx, v);
        fila.push(m.idx);
      });
    }
    return null;
  }

  // Distância em saltos de cada município alcançável até `ate` (Map idx -> saltos).
  function distanciasAte(ate, permitido) {
    var adj = grafo();
    var dist = new Map();
    dist.set(ate.idx, 0);
    var fila = [ate.idx];
    for (var i = 0; i < fila.length; i++) {
      var v = fila[i];
      var d = dist.get(v) + 1;
      adj[v].forEach(function (m) {
        if (dist.has(m.idx)) return;
        if (permitido && !permitido.has(m.idx)) return;
        dist.set(m.idx, d);
        fila.push(m.idx);
      });
    }
    return dist;
  }

  // ---------------------------------------------------------------
  // Modo 8 — Caminho: da origem ao destino citando sempre um município que
  // faz divisa com o último citado. Pontua contra o menor caminho possível.
  // cfg: {origem, destino, uf?}
  // ---------------------------------------------------------------
  function JogoCaminho(cfg) {
    this.cfg = cfg;
    var u = universoDe(cfg);
    this.universo = u.lista;
    this.permitido = cfg.uf ? conjuntoIdx(this.universo) : null;
    this.origem = cfg.origem;
    this.destino = cfg.destino;
    this.atual = cfg.origem;
    this.cadeia = [cfg.origem];
    this.visitados = new Set([cfg.origem.idx]);
    this.saltos = 0;
    this.dicasDadas = 0; // cada dica custa +1 salto na pontuação
    this.encerrado = false;
    this.venceu = false;
    this.distDestino = distanciasAte(cfg.destino, this.permitido);
    this.minCaminho = menorCaminho(cfg.origem, cfg.destino, this.permitido);
    this.minSaltos = this.minCaminho ? this.minCaminho.length - 1 : null;
    if (!this.minCaminho) {
      this.erroInicial = "Não existe caminho por divisas entre " + cfg.origem.nome +
        " e " + cfg.destino.nome +
        (cfg.uf ? " passando só por essa UF" : " (ilhas não fazem divisa com ninguém)") + ".";
    }
  }
  // Saltos que ainda faltam do município atual ao destino, pelo caminho mínimo.
  JogoCaminho.prototype.saltosRestantes = function () {
    var d = this.distDestino.get(this.atual.idx);
    return d === undefined ? null : d;
  };
  JogoCaminho.prototype.palpitar = function (texto) {
    if (this.encerrado) return { tipo: "encerrado" };
    var res = DADOS.buscar(texto);
    if (res.status === "vazio") return { tipo: "vazio" };
    if (res.status === "nao_encontrado") return { tipo: "nao_encontrado", ufErrada: res.ufErrada };
    var cand = dentroDaRegiao(this.cfg, res.municipios);
    if (cand.length === 0) return { tipo: "fora_regiao", municipios: res.municipios };
    var atual = this.atual;
    if (cand.length === 1 && cand[0].idx === atual.idx) return { tipo: "atual", mun: atual };
    // homônimos: se só um deles faz divisa com o município atual, é ele
    var adj = grafo()[atual.idx];
    var vizinhos = cand.filter(function (m) {
      return adj.some(function (v) { return v.idx === m.idx; });
    });
    if (vizinhos.length === 0) return { tipo: "nao_vizinho", municipios: cand, atual: atual };
    if (vizinhos.length > 1) return { tipo: "ambiguo", municipios: vizinhos };
    var mun = vizinhos[0];
    var repetido = this.visitados.has(mun.idx); // voltar atrás vale, mas custa o salto
    this.visitados.add(mun.idx);
    this.cadeia.push(mun);
    this.saltos++;
    this.atual = mun;
    if (mun.idx === this.destino.idx) {
      this.encerrado = true;
      this.venceu = true;
    }
    return { tipo: "ok", mun: mun, anterior: atual, repetido: repetido, venceu: this.venceu };
  };
  // Dica: o vizinho do município atual que está num caminho mínimo até o destino.
  JogoCaminho.prototype.dica = function () {
    if (this.encerrado) return null;
    var dist = this.distDestino;
    var permitido = this.permitido;
    var melhor = null;
    grafo()[this.atual.idx].forEach(function (m) {
      if (permitido && !permitido.has(m.idx)) return;
      var d = dist.get(m.idx);
      if (d === undefined) return;
      if (!melhor || d < dist.get(melhor.idx)) melhor = m;
    });
    if (!melhor) return null;
    this.dicasDadas++;
    return { mun: melhor };
  };
  JogoCaminho.prototype.encerrar = function () {
    this.encerrado = true;
    return this.minCaminho;
  };
  // 100% fazendo o caminho mínimo; cada salto (ou dica) a mais dilui.
  JogoCaminho.prototype.pct = function () {
    if (!this.venceu || !this.minSaltos) return 0;
    return Math.min(1, this.minSaltos / (this.saltos + this.dicasDadas));
  };

  // ---------------------------------------------------------------
  // Modo 9 — Cerco: nomear todos os municípios que fazem divisa com o alvo.
  // A região (uf) filtra só o sorteio do alvo — os vizinhos valem mesmo
  // quando ficam do outro lado da divisa estadual.
  // cfg: {alvo? (município escolhido), minPop? (porte do sorteio), uf?}
  // ---------------------------------------------------------------
  function JogoCerco(cfg) {
    this.cfg = cfg;
    var adj = grafo();
    var alvo = cfg.alvo || null;
    if (!alvo) {
      var uf = cfg.uf;
      var minPop = cfg.minPop || 0;
      var pool = municipios.filter(function (m) {
        return m.pop >= minPop && (!uf || m.uf === uf) && adj[m.idx].length > 0;
      });
      if (pool.length === 0) {
        this.erroInicial = "A região não tem municípios desse porte para o sorteio — escolha um porte menor.";
        return;
      }
      alvo = pool[Math.floor(Math.random() * pool.length)];
    }
    this.alvo = alvo;
    this.alvos = adj[alvo.idx]; // já ordenados por população (desc)
    this.alvosTotal = this.alvos.length;
    if (this.alvosTotal === 0) {
      this.erroInicial = alvo.nome + " (" + alvo.uf + ") não faz divisa com nenhum município — escolha outro alvo.";
      return;
    }
    this.ehAlvo = conjuntoIdx(this.alvos);
    this.achados = new Set();
    this.achadosTotal = 0;
    this.encerrado = false;
  }
  JogoCerco.prototype.palpitar = function (texto) {
    if (this.encerrado) return { tipo: "encerrado" };
    var res = DADOS.buscar(texto);
    if (res.status === "vazio") return { tipo: "vazio" };
    if (res.status === "nao_encontrado") return { tipo: "nao_encontrado", ufErrada: res.ufErrada };
    var self = this;
    var revelados = [];
    var repetido = null;
    res.municipios.forEach(function (m) {
      if (!self.ehAlvo.has(m.idx)) return;
      if (self.achados.has(m.idx)) { repetido = m; return; }
      self.achados.add(m.idx);
      self.achadosTotal++;
      revelados.push({ mun: m });
    });
    if (revelados.length === 0) {
      if (repetido) return { tipo: "repetido", mun: repetido };
      if (res.municipios.some(function (m) { return m.idx === self.alvo.idx; })) {
        return { tipo: "alvo" };
      }
      return { tipo: "nao_alvo", municipios: res.municipios };
    }
    if (this.achadosTotal >= this.alvosTotal) this.encerrado = true;
    return { tipo: "ok", revelados: revelados, completo: this.encerrado };
  };
  // Dica: o maior vizinho ainda não achado (alvos já estão em ordem de população).
  JogoCerco.prototype.dica = function () {
    for (var i = 0; i < this.alvos.length; i++) {
      var m = this.alvos[i];
      if (!this.achados.has(m.idx)) return { mun: m };
    }
    return null;
  };
  // Encerra revelando o que faltou; devolve a lista dos vizinhos não achados.
  JogoCerco.prototype.encerrar = function () {
    this.encerrado = true;
    var faltantes = [];
    var self = this;
    this.alvos.forEach(function (m) {
      if (!self.achados.has(m.idx)) faltantes.push({ mun: m });
    });
    return faltantes;
  };
  JogoCerco.prototype.pct = function () {
    return this.alvosTotal === 0 ? 0 : this.achadosTotal / this.alvosTotal;
  };

  // ---------------------------------------------------------------
  // Modo 10 — Mancha: comece por qualquer município e cresça um território
  // contíguo — só vale citar quem faz divisa com a mancha atual.
  // cfg: {uf?, tempoMin?}
  // ---------------------------------------------------------------
  function JogoMancha(cfg) {
    this.cfg = cfg;
    var u = universoDe(cfg);
    this.universo = u.lista;
    this.uniPop = u.pop;
    this.alvosTotal = this.universo.length;
    this.mancha = new Set();    // idx dos municípios da mancha
    this.popMancha = 0;
    this.fronteira = new Set(); // idx dos vizinhos da mancha ainda fora dela
    this.encerrado = false;
  }
  JogoMancha.prototype.incorporar = function (m) {
    var self = this;
    var uf = this.cfg.uf;
    this.mancha.add(m.idx);
    this.popMancha += m.pop;
    this.fronteira.delete(m.idx);
    grafo()[m.idx].forEach(function (v) {
      if (uf && v.uf !== uf) return;
      if (!self.mancha.has(v.idx)) self.fronteira.add(v.idx);
    });
  };
  JogoMancha.prototype.palpitar = function (texto) {
    if (this.encerrado) return { tipo: "encerrado" };
    var res = DADOS.buscar(texto);
    if (res.status === "vazio") return { tipo: "vazio" };
    if (res.status === "nao_encontrado") return { tipo: "nao_encontrado", ufErrada: res.ufErrada };
    var cand = dentroDaRegiao(this.cfg, res.municipios);
    if (cand.length === 0) return { tipo: "fora_regiao", municipios: res.municipios };
    var self = this;
    if (this.mancha.size === 0) {
      // a semente é livre — mas não pode ser uma ilha, senão a mancha morre ali
      if (cand.length > 1) return { tipo: "ambiguo", municipios: cand };
      var semente = cand[0];
      var uf = this.cfg.uf;
      var grau = grafo()[semente.idx].filter(function (v) {
        return !uf || v.uf === uf;
      }).length;
      if (grau === 0) return { tipo: "isolado", mun: semente };
      this.incorporar(semente);
      return { tipo: "ok", revelados: [{ mun: semente }], semente: true };
    }
    var novos = cand.filter(function (m) { return self.fronteira.has(m.idx); });
    if (novos.length === 0) {
      var dentro = cand.filter(function (m) { return self.mancha.has(m.idx); });
      if (dentro.length > 0) return { tipo: "repetido", mun: dentro[0] };
      return { tipo: "nao_vizinho", municipios: cand };
    }
    var revelados = [];
    novos.forEach(function (m) {
      self.incorporar(m);
      revelados.push({ mun: m });
    });
    if (this.mancha.size >= this.alvosTotal) this.encerrado = true;
    return { tipo: "ok", revelados: revelados, completo: this.encerrado };
  };
  // Dica: o maior município que faz divisa com a mancha (custa −1 no resultado).
  JogoMancha.prototype.dica = function () {
    var melhor = null;
    this.fronteira.forEach(function (idx) {
      var m = municipios[idx];
      if (!melhor || m.pop > melhor.pop) melhor = m;
    });
    return melhor ? { mun: melhor } : null;
  };
  // Relatório final: os maiores vizinhos da mancha que ficaram de fora.
  JogoMancha.prototype.maioresDeFora = function (n) {
    var fora = [];
    this.fronteira.forEach(function (idx) { fora.push(municipios[idx]); });
    fora.sort(function (a, b) { return b.pop - a.pop; });
    return fora.slice(0, n);
  };
  JogoMancha.prototype.pct = function () {
    return this.alvosTotal === 0 ? 0 : this.mancha.size / this.alvosTotal;
  };

  // ---------------------------------------------------------------
  // Modo 11 — Ponte: dois municípios sorteados; construa uma corrente de
  // divisas que os conecte. Cada palpite precisa fazer divisa com algo já
  // marcado (os dois extremos contam), então dá para crescer dos dois lados.
  // cfg: {minPop, uf?}
  // ---------------------------------------------------------------
  function JogoPonte(cfg) {
    this.cfg = cfg;
    var u = universoDe(cfg);
    this.universo = u.lista;
    this.permitido = cfg.uf ? conjuntoIdx(this.universo) : null;
    var pool = this.universo.filter(function (m) { return m.pop >= cfg.minPop; });
    var achou = null;
    // sorteia até achar um par conectado e não trivial (3+ saltos de distância)
    for (var t = 0; t < 400 && !achou; t++) {
      var a = pool[Math.floor(Math.random() * pool.length)];
      var b = pool[Math.floor(Math.random() * pool.length)];
      if (!a || !b || a.idx === b.idx) continue;
      var caminho = menorCaminho(a, b, this.permitido);
      if (caminho && caminho.length - 1 >= 3) achou = { a: a, b: b, caminho: caminho };
    }
    if (!achou) {
      this.erroInicial = "Não achei um par de municípios desse porte para ligar nesta região — tente um porte menor.";
      return;
    }
    this.a = achou.a;
    this.b = achou.b;
    this.minCaminho = achou.caminho;
    this.minMeio = achou.caminho.length - 2; // municípios entre os extremos no mínimo
    this.aceitos = new Set([this.a.idx, this.b.idx]);
    this.fronteira = new Set(); // idx dos vizinhos do que já está marcado
    this.usados = 0;            // municípios que o jogador acrescentou
    this.dicasDadas = 0;        // cada dica custa +1 município na pontuação
    this.encerrado = false;
    this.venceu = false;
    this.corrente = null;       // corrente que fechou a ligação (para desenhar)
    this.distB = distanciasAte(this.b, this.permitido);
    var self = this;
    [this.a, this.b].forEach(function (ext) {
      grafo()[ext.idx].forEach(function (v) {
        if (self.permitido && !self.permitido.has(v.idx)) return;
        if (!self.aceitos.has(v.idx)) self.fronteira.add(v.idx);
      });
    });
  }
  // Corrente de A até B usando só municípios marcados, ou null se ainda não liga.
  JogoPonte.prototype.correnteLigacao = function () {
    var adj = grafo();
    var aceitos = this.aceitos;
    var ant = new Map();
    ant.set(this.a.idx, null);
    var fila = [this.a.idx];
    for (var i = 0; i < fila.length; i++) {
      var v = fila[i];
      if (v === this.b.idx) {
        var corrente = [];
        for (var p = v; p !== null; p = ant.get(p)) corrente.push(municipios[p]);
        return corrente.reverse();
      }
      adj[v].forEach(function (m) {
        if (!aceitos.has(m.idx) || ant.has(m.idx)) return;
        ant.set(m.idx, v);
        fila.push(m.idx);
      });
    }
    return null;
  };
  // O quão perto o marcado chegou do outro extremo (em saltos), para a barra.
  JogoPonte.prototype.saltosRestantes = function () {
    var distB = this.distB;
    var melhor = Infinity;
    this.aceitos.forEach(function (idx) {
      var d = distB.get(idx);
      if (d !== undefined && d < melhor) melhor = d;
    });
    return melhor === Infinity ? null : melhor;
  };
  JogoPonte.prototype.palpitar = function (texto) {
    if (this.encerrado) return { tipo: "encerrado" };
    var res = DADOS.buscar(texto);
    if (res.status === "vazio") return { tipo: "vazio" };
    if (res.status === "nao_encontrado") return { tipo: "nao_encontrado", ufErrada: res.ufErrada };
    var cand = dentroDaRegiao(this.cfg, res.municipios);
    if (cand.length === 0) return { tipo: "fora_regiao", municipios: res.municipios };
    var self = this;
    var novos = cand.filter(function (m) { return self.fronteira.has(m.idx); });
    if (novos.length === 0) {
      var dentro = cand.filter(function (m) { return self.aceitos.has(m.idx); });
      if (dentro.length > 0) return { tipo: "repetido", mun: dentro[0] };
      return { tipo: "nao_vizinho", municipios: cand };
    }
    var revelados = [];
    novos.forEach(function (m) {
      self.aceitos.add(m.idx);
      self.fronteira.delete(m.idx);
      self.usados++;
      grafo()[m.idx].forEach(function (v) {
        if (self.permitido && !self.permitido.has(v.idx)) return;
        if (!self.aceitos.has(v.idx)) self.fronteira.add(v.idx);
      });
      revelados.push({ mun: m });
    });
    this.corrente = this.correnteLigacao();
    if (this.corrente) {
      this.encerrado = true;
      this.venceu = true;
    }
    return { tipo: "ok", revelados: revelados, venceu: this.venceu, corrente: this.corrente };
  };
  // Dica: o primeiro município ainda não marcado da menor corrente que
  // fecharia a ligação a partir do que já está marcado — seguir as dicas
  // sempre completa a ponte com o mínimo de municípios restante.
  JogoPonte.prototype.dica = function () {
    if (this.encerrado) return null;
    var adj = grafo();
    var permitido = this.permitido;
    var aceitos = this.aceitos;
    // o marcado se divide em (no máximo) dois blocos: o do A e o do B
    var compA = new Set([this.a.idx]);
    var fila = [this.a.idx];
    var i;
    for (i = 0; i < fila.length; i++) {
      adj[fila[i]].forEach(function (m) {
        if (aceitos.has(m.idx) && !compA.has(m.idx)) {
          compA.add(m.idx);
          fila.push(m.idx);
        }
      });
    }
    // BFS a partir do bloco do A até tocar o bloco do B
    var ant = new Map();
    fila = [];
    compA.forEach(function (idx) {
      ant.set(idx, null);
      fila.push(idx);
    });
    for (i = 0; i < fila.length; i++) {
      var v = fila[i];
      if (aceitos.has(v) && !compA.has(v)) {
        var caminho = [];
        for (var p = v; p !== null; p = ant.get(p)) caminho.push(p);
        caminho.reverse();
        for (var k = 0; k < caminho.length; k++) {
          if (!aceitos.has(caminho[k])) {
            this.dicasDadas++;
            return { mun: municipios[caminho[k]] };
          }
        }
        return null;
      }
      adj[v].forEach(function (m) {
        if (ant.has(m.idx)) return;
        if (permitido && !permitido.has(m.idx)) return;
        ant.set(m.idx, v);
        fila.push(m.idx);
      });
    }
    return null;
  };
  JogoPonte.prototype.encerrar = function () {
    this.encerrado = true;
    return this.minCaminho;
  };
  // 100% ligando com o mínimo de municípios; cada extra (ou dica) dilui.
  JogoPonte.prototype.pct = function () {
    if (!this.venceu || !this.minMeio) return 0;
    return Math.min(1, this.minMeio / (this.usados + this.dicasDadas));
  };

  return {
    JogoCirculosDistancia: JogoCirculosDistancia,
    JogoCirculosPopulacao: JogoCirculosPopulacao,
    JogoFaixas: JogoFaixas,
    JogoTopN: JogoTopN,
    JogoOndeEstou: JogoOndeEstou,
    JogoClique: JogoClique,
    JogoMaratona: JogoMaratona,
    JogoCaminho: JogoCaminho,
    JogoCerco: JogoCerco,
    JogoMancha: JogoMancha,
    JogoPonte: JogoPonte,
    // vizinhos de um município (para a interface desenhar os elos)
    vizinhosDe: function (mun) { return grafo()[mun.idx]; },
  };
})();
