"use strict";
// Motores dos três modos de jogo. Cada motor guarda o estado da partida e
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
    lista.forEach(function (m) { pop += m.pop; });
    return { lista: lista, pop: pop };
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
  // cfg: {raio, metrica: 'pop'|'cidades', palpites? (sem limite se ausente),
  //       uf? (só uma UF se presente)}
  // ---------------------------------------------------------------
  function JogoCirculosDistancia(cfg) {
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
        }
      });
    });
    this.popCoberta += ganhoPop;
    var jogada = { muns: lista, circulos: circulos, novos: novos, ganhoPop: ganhoPop };
    this.jogadas.push(jogada);
    if (this.cfg.palpites && this.jogadas.length >= this.cfg.palpites) this.encerrado = true;
    return { tipo: "ok", jogada: jogada };
  };
  JogoCirculosDistancia.prototype.pct = function () {
    return this.cfg.metrica === "cidades"
      ? this.cobertos.size / this.universo.length
      : this.popCoberta / this.uniPop;
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
    this.achados = new Set();
    this.achadosSessao = 0;
    this.encerrado = false;
    if (cfg.idsIniciais && cfg.idsIniciais.length) {
      var ids = new Set(cfg.idsIniciais);
      var achados = this.achados;
      this.universo.forEach(function (m) {
        if (ids.has(m.id)) achados.add(m.idx);
      });
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

  return {
    JogoCirculosDistancia: JogoCirculosDistancia,
    JogoCirculosPopulacao: JogoCirculosPopulacao,
    JogoFaixas: JogoFaixas,
    JogoTopN: JogoTopN,
    JogoOndeEstou: JogoOndeEstou,
    JogoClique: JogoClique,
    JogoMaratona: JogoMaratona,
  };
})();
