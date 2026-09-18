"use strict";
// Decodificador da malha gerada por tools/build_censo.py.
//
// O arquivo de dados é uma topologia no estilo TopoJSON achatada em vetores:
// os arcos (trechos de fronteira) aparecem uma vez só e são referenciados
// pelas unidades dos dois lados, com as coordenadas guardadas como inteiros
// pequenos (deltas quantizados). Aqui isso vira typed arrays — uma passada só,
// sem criar um objeto por polígono, que é o que permite desenhar centenas de
// milhares de setores sem o coletor de lixo atrapalhar.
var CENSO_TOPO = (function () {

  // Descompacta a fonte em typed arrays e calcula caixa envolvente, centroide
  // e um índice espacial em grade (para achar rápido a unidade sob o mouse).
  function decodificar(fonte) {
    var escalaX = fonte.escala[0], escalaY = fonte.escala[1];
    var transX = fonte.translada[0], transY = fonte.translada[1];

    // ---- arcos: delta quantizado -> grau absoluto ----
    var bruto = fonte.arcos;
    var nPontos = bruto.length >> 1;
    var arcoX = new Float32Array(nPontos);
    var arcoY = new Float32Array(nPontos);
    var arcoIni = Int32Array.from(fonte.arcosIni);
    var nArcos = arcoIni.length - 1;
    for (var a = 0; a < nArcos; a++) {
      var qx = 0, qy = 0;
      for (var p = arcoIni[a], fim = arcoIni[a + 1]; p < fim; p++) {
        qx += bruto[p << 1];
        qy += bruto[(p << 1) + 1];
        arcoX[p] = qx * escalaX + transX;
        arcoY[p] = qy * escalaY + transY;
      }
    }

    // ---- anéis por unidade (somas de prefixo, para virar tudo typed array) ----
    var n = fonte.unidadeNAnel.length;
    var uniIni = new Int32Array(n + 1);
    for (var i = 0; i < n; i++) uniIni[i + 1] = uniIni[i] + fonte.unidadeNAnel[i];
    var nAneis = uniIni[n];
    var anelIni = new Int32Array(nAneis + 1);
    for (var r = 0; r < nAneis; r++) anelIni[r + 1] = anelIni[r] + fonte.anelTam[r];
    var anelIds = Int32Array.from(fonte.anelIds);

    var malha = {
      n: n,
      arcoX: arcoX, arcoY: arcoY, arcoIni: arcoIni,
      uniIni: uniIni, anelIni: anelIni, anelIds: anelIds,
      minX: new Float32Array(n), minY: new Float32Array(n),
      maxX: new Float32Array(n), maxY: new Float32Array(n),
      cx: new Float32Array(n), cy: new Float32Array(n),
    };
    medirUnidades(malha);
    malha.grade = indexar(malha);
    return malha;
  }

  // Caixa envolvente e centroide (média ponderada pela área com sinal, que já
  // desconta os buracos) de cada unidade.
  function medirUnidades(m) {
    for (var i = 0; i < m.n; i++) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      var areaTotal = 0, mx = 0, my = 0;
      for (var anel = m.uniIni[i], fimAnel = m.uniIni[i + 1]; anel < fimAnel; anel++) {
        var area2 = 0, ax = 0, ay = 0;
        var px = NaN, py = NaN, x0 = NaN, y0 = NaN;
        var k = m.anelIni[anel], fimK = m.anelIni[anel + 1];
        for (; k < fimK; k++) {
          var id = m.anelIds[k];
          var invertido = id < 0;
          var arco = invertido ? ~id : id;
          var ini = m.arcoIni[arco], fim = m.arcoIni[arco + 1];
          for (var passo = 0, cnt = fim - ini; passo < cnt; passo++) {
            var p = invertido ? fim - 1 - passo : ini + passo;
            var x = m.arcoX[p], y = m.arcoY[p];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (px === px) {
              // o último ponto de um arco repete o primeiro do seguinte;
              // o termo cruzado dá zero, então não precisa filtrar
              var cruz = px * y - x * py;
              area2 += cruz;
              ax += (px + x) * cruz;
              ay += (py + y) * cruz;
            } else {
              x0 = x; y0 = y;
            }
            px = x; py = y;
          }
        }
        if (px === px) {
          var fecha = px * y0 - x0 * py;
          area2 += fecha;
          ax += (px + x0) * fecha;
          ay += (py + y0) * fecha;
        }
        areaTotal += area2;
        mx += ax;
        my += ay;
      }
      m.minX[i] = minX; m.minY[i] = minY; m.maxX[i] = maxX; m.maxY[i] = maxY;
      if (Math.abs(areaTotal) > 1e-12) {
        m.cx[i] = mx / (3 * areaTotal);
        m.cy[i] = my / (3 * areaTotal);
      } else {
        m.cx[i] = (minX + maxX) / 2;
        m.cy[i] = (minY + maxY) / 2;
      }
    }
  }

  // Grade regular sobre a caixa do recorte: cada célula lista as unidades cuja
  // caixa envolvente a toca. Montada com contagem + soma de prefixo, sem arrays
  // aninhados.
  function indexar(m) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < m.n; i++) {
      if (m.minX[i] < minX) minX = m.minX[i];
      if (m.minY[i] < minY) minY = m.minY[i];
      if (m.maxX[i] > maxX) maxX = m.maxX[i];
      if (m.maxY[i] > maxY) maxY = m.maxY[i];
    }
    var lado = Math.max(8, Math.min(512, Math.round(Math.sqrt(m.n / 4))));
    var escX = lado / Math.max(1e-9, maxX - minX);
    var escY = lado / Math.max(1e-9, maxY - minY);
    var cel = function (v, min, esc) {
      var c = Math.floor((v - min) * esc);
      return c < 0 ? 0 : c >= lado ? lado - 1 : c;
    };

    var contagem = new Int32Array(lado * lado + 1);
    var passo;
    for (passo = 0; passo < 2; passo++) {
      for (var u = 0; u < m.n; u++) {
        var cx0 = cel(m.minX[u], minX, escX), cx1 = cel(m.maxX[u], minX, escX);
        var cy0 = cel(m.minY[u], minY, escY), cy1 = cel(m.maxY[u], minY, escY);
        for (var gy = cy0; gy <= cy1; gy++) {
          for (var gx = cx0; gx <= cx1; gx++) {
            var c = gy * lado + gx;
            if (passo === 0) contagem[c + 1]++;
            else itens[posicao[c]++] = u;
          }
        }
      }
      if (passo === 0) {
        for (var c2 = 0; c2 < lado * lado; c2++) contagem[c2 + 1] += contagem[c2];
        var itens = new Int32Array(contagem[lado * lado]);
        var posicao = contagem.slice(0, lado * lado);
      }
    }
    return {
      lado: lado, minX: minX, minY: minY, escX: escX, escY: escY,
      ini: contagem, itens: itens, cel: cel,
    };
  }

  // Unidade que contém (lng, lat), ou -1. Consulta a célula da grade e testa
  // cada candidata com o algoritmo do raio (regra par-ímpar, que já trata os
  // buracos e os anéis aninhados do jeito certo).
  function unidadeEm(m, lng, lat) {
    var g = m.grade;
    var gx = g.cel(lng, g.minX, g.escX), gy = g.cel(lat, g.minY, g.escY);
    var c = gy * g.lado + gx;
    for (var k = g.ini[c], fim = g.ini[c + 1]; k < fim; k++) {
      var u = g.itens[k];
      if (lng < m.minX[u] || lng > m.maxX[u] || lat < m.minY[u] || lat > m.maxY[u]) continue;
      if (dentro(m, u, lng, lat)) return u;
    }
    return -1;
  }

  function dentro(m, u, lng, lat) {
    var impar = false;
    for (var anel = m.uniIni[u], fimAnel = m.uniIni[u + 1]; anel < fimAnel; anel++) {
      var px = NaN, py = NaN, x0 = NaN, y0 = NaN;
      for (var k = m.anelIni[anel], fimK = m.anelIni[anel + 1]; k < fimK; k++) {
        var id = m.anelIds[k];
        var invertido = id < 0;
        var arco = invertido ? ~id : id;
        var ini = m.arcoIni[arco], fim = m.arcoIni[arco + 1];
        for (var passo = 0, cnt = fim - ini; passo < cnt; passo++) {
          var p = invertido ? fim - 1 - passo : ini + passo;
          var x = m.arcoX[p], y = m.arcoY[p];
          if (px === px) {
            if ((py > lat) !== (y > lat) &&
                lng < ((x - px) * (lat - py)) / (y - py) + px) impar = !impar;
          } else {
            x0 = x; y0 = y;
          }
          px = x; py = y;
        }
      }
      if (px === px && (py > lat) !== (y0 > lat) &&
          lng < ((x0 - px) * (lat - py)) / (y0 - py) + px) impar = !impar;
    }
    return impar;
  }

  // Percorre os vértices de uma unidade chamando `aberto` no primeiro vértice
  // de cada anel e `ponto` nos demais. As funções recebem o ÍNDICE do ponto
  // nos vetores de arcos, não as coordenadas: assim quem desenha pode ler de
  // um vetor já projetado, sem refazer a conta por vértice. É o caminho quente
  // do desenho — meio milhão de unidades passam por aqui a cada redesenho.
  function percorrer(m, u, aberto, ponto) {
    for (var anel = m.uniIni[u], fimAnel = m.uniIni[u + 1]; anel < fimAnel; anel++) {
      var primeiro = true;
      for (var k = m.anelIni[anel], fimK = m.anelIni[anel + 1]; k < fimK; k++) {
        var id = m.anelIds[k];
        var invertido = id < 0;
        var arco = invertido ? ~id : id;
        var ini = m.arcoIni[arco], fim = m.arcoIni[arco + 1];
        // o primeiro ponto de um arco repete o último do anterior
        for (var passo = primeiro ? 0 : 1, cnt = fim - ini; passo < cnt; passo++) {
          var p = invertido ? fim - 1 - passo : ini + passo;
          if (primeiro) {
            aberto(p);
            primeiro = false;
          } else {
            ponto(p);
          }
        }
      }
    }
  }

  return {
    decodificar: decodificar,
    unidadeEm: unidadeEm,
    dentro: dentro,
    percorrer: percorrer,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CENSO_TOPO;
