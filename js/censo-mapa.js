"use strict";
// Motor dos mapas de população do Censo 2022 (censo-areas.html e
// censo-setores.html).
//
// As duas páginas mostram a mesma coisa em recortes diferentes — 14.406 áreas
// de ponderação ou 468.061 setores censitários —, então o desenho, a câmera, a
// escala de cor e a interação ficam todos aqui; cada página só diz de onde vêm
// os dados e como descrever uma unidade.
//
// Desenhar meio milhão de polígonos não cabe no orçamento de 16 ms de um
// quadro, então o mapa é pintado em pedaços num canvas fora da tela e copiado
// para a tela a cada pedaço. Enquanto a mão arrasta ou dá zoom, aparece a
// última imagem pronta deslocada e escalada — exato para o arrasto, aproximado
// para o zoom; a repintura começa quando o movimento para.
var CENSO_MAPA = (function () {
  var RAD = Math.PI / 180;

  // Mesma rampa sequencial de um matiz só do mapa de densidade de municípios —
  // claro (vazio) → escuro (cheio), sobre o mesmo papel claro.
  var RAMPA = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
  var PAPEL = "#f7f6f3";
  var COR_VAZIO = "#e4e2dc";   // unidade sem ninguém morando
  // Fio de contorno cor do papel: sobre o azul escuro das unidades cheias ele
  // aparece, e sobre as vazias quase some — que é onde ele menos faz falta.
  var COR_BORDA = "rgba(247,246,243,.55)";
  var COR_DESTAQUE = "#f5b942";
  var BALDES = 64;             // passos discretos da rampa: agrupa o preenchimento
  var ALTURA_MAX = 170;        // px do topo da escala no modo 3D, antes do exagero

  // ---------------------------------------------------------------- projeção
  // Mercator: conforme, então a forma dos bairros não entorta no zoom fundo.
  function mundoX(lng) { return lng; }
  function mundoY(lat) {
    var f = Math.max(-85, Math.min(85, lat)) * RAD;
    return -Math.log(Math.tan(Math.PI / 4 + f / 2)) / RAD;
  }
  function latDeMundo(my) { return (2 * Math.atan(Math.exp(-my * RAD)) - Math.PI / 2) / RAD; }

  var CORES = (function () {
    var pare = RAMPA.map(function (c) {
      return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    });
    var cores = new Array(BALDES);
    for (var j = 0; j < BALDES; j++) {
      var t = (j / (BALDES - 1)) * (pare.length - 1);
      var a = Math.floor(t), b = Math.min(a + 1, pare.length - 1), f = t - a;
      cores[j] = "rgb(" +
        Math.round(pare[a][0] + (pare[b][0] - pare[a][0]) * f) + "," +
        Math.round(pare[a][1] + (pare[b][1] - pare[a][1]) * f) + "," +
        Math.round(pare[a][2] + (pare[b][2] - pare[a][2]) * f) + ")";
    }
    return cores;
  })();

  function numero(v, casas) {
    if (v == null || v !== v) return "—";
    return v.toLocaleString("pt-BR", {
      minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0,
    });
  }

  var cacheEscuro = Object.create(null);
  function escurecer(cor, k) {
    var chave = cor + "|" + k;
    var pronta = cacheEscuro[chave];
    if (pronta) return pronta;
    var m = /rgb\((\d+),(\d+),(\d+)\)/.exec(cor);
    var r, g, b;
    if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
    else {
      r = parseInt(cor.slice(1, 3), 16);
      g = parseInt(cor.slice(3, 5), 16);
      b = parseInt(cor.slice(5, 7), 16);
    }
    cacheEscuro[chave] = "rgb(" + Math.round(r * k) + "," + Math.round(g * k) + "," + Math.round(b * k) + ")";
    return cacheEscuro[chave];
  }

  // -------------------------------------------------------------------- mapa
  function criar(cfg) {
    var tela = cfg.canvas;
    var ctxTela = tela.getContext("2d");
    var buffer = document.createElement("canvas");
    var ctx = buffer.getContext("2d");

    var mapa = {
      blocos: [],
      metrica: "densidade",   // "densidade" | "populacao"
      escalaCor: "log",       // "log" | "linear"
      modo3d: false,
      escalaAltura: "linear", // "linear" | "raiz" | "log"
      exagero: 1,
      giro: -0.30,
      inclinacao: 0.62,
      bordas: true,
      contorno: true,
      selecionada: null,
      sobre: null,
      min: 1, max: 1, piso: 1, teto: 1,
      aoSelecionar: cfg.aoSelecionar || function () {},
      aoPassar: cfg.aoPassar || function () {},
      aoRedesenhar: cfg.aoRedesenhar || function () {},
    };

    var camera = { cx: mundoX(-53), cy: mundoY(-14.5), escala: 20 };
    var W = 0, H = 0, dpr = 1;
    var pintura = null;          // estado da repintura em pedaços
    var bufferValido = false;
    var cameraDoBuffer = null;
    var timerOcioso = 0;
    var linhasUF = null;         // divisas estaduais, em coordenadas de mundo

    // ------------------------------------------------ valores e escala de cor
    function valorDe(bl, i) {
      if (mapa.metrica === "populacao") return bl.pop[i];
      var km2 = bl.aream2[i] / 1e6;
      return km2 > 0 ? bl.pop[i] / km2 : 0;
    }

    function recalcular() {
      var max = 0, min = Infinity, b, i, bl, v;
      for (b = 0; b < mapa.blocos.length; b++) {
        bl = mapa.blocos[b];
        for (i = 0; i < bl.n; i++) {
          v = valorDe(bl, i);
          bl.valor[i] = v;
          if (v > max) max = v;
          if (v > 0 && v < min) min = v;
        }
      }
      mapa.max = max || 1;
      mapa.min = isFinite(min) ? min : 1;
      // A escala é cortada nos percentis 2 e 99,8 dos valores não nulos. Sem
      // isso, uma única área com 106 mil hab/km² de um lado e um setor de
      // 0,01 hab/km² do outro espremem todo o resto no meio da rampa e o mapa
      // fica de um tom só.
      var corte = percentis([0.02, 0.998]);
      mapa.piso = Math.max(corte[0], mapa.min);
      mapa.teto = Math.max(corte[1], mapa.piso * 4);
      for (b = 0; b < mapa.blocos.length; b++) baldear(mapa.blocos[b]);
      ordenarPorCor();
    }

    function percentis(ps) {
      var total = 0, b, i, bl;
      for (b = 0; b < mapa.blocos.length; b++) total += mapa.blocos[b].n;
      var v = new Float64Array(total), k = 0;
      for (b = 0; b < mapa.blocos.length; b++) {
        bl = mapa.blocos[b];
        for (i = 0; i < bl.n; i++) if (bl.valor[i] > 0) v[k++] = bl.valor[i];
      }
      if (!k) return ps.map(function () { return 1; });
      var naoNulos = v.subarray(0, k);
      naoNulos.sort();
      return ps.map(function (p) {
        return naoNulos[Math.min(k - 1, Math.floor(k * p))] || 1;
      });
    }

    // valor -> posição na rampa (0..1); negativo quer dizer "ninguém mora aqui"
    function fracao(v) {
      if (v <= 0) return -1;
      if (mapa.escalaCor === "linear") return Math.min(1, v / mapa.teto);
      var lo = Math.log(mapa.piso), hi = Math.log(mapa.teto);
      return Math.max(0, Math.min(1, (Math.log(v) - lo) / (hi - lo)));
    }

    // inversa de fracao(), para escrever os números da legenda
    function valorDaFracao(f) {
      if (mapa.escalaCor === "linear") return f * mapa.teto;
      var lo = Math.log(mapa.piso), hi = Math.log(mapa.teto);
      return Math.exp(lo + f * (hi - lo));
    }

    function baldear(bl) {
      for (var i = 0; i < bl.n; i++) {
        var f = fracao(bl.valor[i]);
        bl.balde[i] = f < 0 ? -1 : Math.min(BALDES - 1, Math.round(f * (BALDES - 1)));
      }
    }

    // Pintar na ordem da cor junta os preenchimentos de mesmo tom num caminho
    // só (muito menos troca de estado no canvas) e ainda deixa as unidades
    // cheias por cima das vazias. Ordenação por contagem, O(n).
    function ordenarPorCor() {
      for (var b = 0; b < mapa.blocos.length; b++) {
        var bl = mapa.blocos[b];
        var cont = new Int32Array(BALDES + 2);
        var i;
        for (i = 0; i < bl.n; i++) cont[bl.balde[i] + 2]++;
        for (i = 0; i < BALDES + 1; i++) cont[i + 1] += cont[i];
        for (i = 0; i < bl.n; i++) bl.ordemCor[cont[bl.balde[i] + 1]++] = i;
      }
    }

    // ---------------------------------------------------------------- câmera
    function camera3d() {
      return {
        cos: Math.cos(mapa.giro),
        sen: Math.sin(mapa.giro),
        achata: Math.cos(mapa.inclinacao),
      };
    }

    // Altura da barra, em pixels. A escala da altura é independente da escala
    // da cor: com a log, tudo que tem gente vira um espinho de tamanho parecido
    // e o mapa 3D some numa floresta; a raiz dá relevo com as cidades
    // destacadas, e a linear deixa só as favelas e os centros verticais de pé.
    function alturaPx(v) {
      if (v <= 0) return 0;
      var f;
      if (mapa.escalaAltura === "log") {
        var lo = Math.log(mapa.piso), hi = Math.log(mapa.teto);
        f = Math.max(0, Math.min(1, (Math.log(v) - lo) / (hi - lo)));
      } else {
        f = Math.min(1, v / mapa.teto);
        if (mapa.escalaAltura === "raiz") f = Math.sqrt(f);
      }
      return f * ALTURA_MAX * mapa.exagero;
    }

    // A projeção do chão é afim nas coordenadas de mundo, tanto em 2D quanto
    // em 3D (girar e inclinar é uma matriz 2×2). Guardar os seis coeficientes
    // deixa o laço de desenho com duas multiplicações por vértice.
    function transformacao(c3) {
      var e = camera.escala;
      if (!mapa.modo3d) {
        return { a: e, b: 0, c: 0, d: e,
                 e: W / 2 - camera.cx * e, f: H / 2 - camera.cy * e };
      }
      var a = e * c3.cos, b = -e * c3.sen;
      var c = e * c3.sen * c3.achata, d = e * c3.cos * c3.achata;
      return { a: a, b: b, c: c, d: d,
               e: W / 2 - (camera.cx * a + camera.cy * b),
               f: H / 2 - (camera.cx * c + camera.cy * d) };
    }

    function projetar(wx, wy, h, c3) {
      var T = transformacao(c3);
      return [T.a * wx + T.b * wy + T.e, T.c * wx + T.d * wy + T.f - h];
    }

    // Inverso da projeção no plano do chão — é como o mapa sabe qual unidade
    // está sob o ponteiro também no modo 3D.
    function desprojetar(px, py) {
      var T = transformacao(camera3d());
      var det = T.a * T.d - T.b * T.c;
      var x = px - T.e, y = py - T.f;
      return {
        lng: (x * T.d - y * T.b) / det,
        lat: latDeMundo((y * T.a - x * T.c) / det),
      };
    }

    // ------------------------------------------------------------- repintura
    function redimensionar() {
      var caixa = tela.parentElement.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(320, Math.round(caixa.width));
      H = Math.max(240, Math.round(caixa.height));
      tela.width = buffer.width = Math.round(W * dpr);
      tela.height = buffer.height = Math.round(H * dpr);
      tela.style.width = buffer.style.width = W + "px";
      tela.style.height = buffer.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cameraDoBuffer = null;
      invalidar();
    }

    function invalidar() {
      bufferValido = false;
      pintura = null;
      apresentar();
      clearTimeout(timerOcioso);
      timerOcioso = setTimeout(iniciarPintura, 80);
    }

    // Enquanto a repintura não sai, mostra a imagem anterior deslocada.
    function apresentar() {
      ctxTela.setTransform(1, 0, 0, 1, 0, 0);
      ctxTela.fillStyle = PAPEL;
      ctxTela.fillRect(0, 0, tela.width, tela.height);
      if (!cameraDoBuffer || cameraDoBuffer.modo3d !== mapa.modo3d) return;
      ctxTela.save();
      ctxTela.scale(dpr, dpr);
      ctxTela.globalAlpha = bufferValido ? 1 : 0.5;
      if (mapa.modo3d &&
          (cameraDoBuffer.giro !== mapa.giro || cameraDoBuffer.inclinacao !== mapa.inclinacao)) {
        // girando: não dá para remapear a imagem antiga, fica de fantasma
        ctxTela.drawImage(buffer, 0, 0, W, H);
      } else {
        var k = camera.escala / cameraDoBuffer.escala;
        var T = transformacao(camera3d());
        var dwx = cameraDoBuffer.cx - camera.cx, dwy = cameraDoBuffer.cy - camera.cy;
        ctxTela.translate(W / 2 + (T.a * dwx + T.b * dwy), H / 2 + (T.c * dwx + T.d * dwy));
        ctxTela.scale(k, k);
        ctxTela.translate(-W / 2, -H / 2);
        ctxTela.drawImage(buffer, 0, 0, W, H);
      }
      ctxTela.restore();
      desenharSobreposicao();
    }

    function iniciarPintura() {
      if (!mapa.blocos.length) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = PAPEL;
      ctx.fillRect(0, 0, W, H);
      var c3 = camera3d();
      pintura = {
        fase: 0,          // 0 = chão, 1 = divisas, 2 = barras
        bloco: 0, i: 0,
        c3: c3, T: transformacao(c3), limites: limitesVisiveis(),
      };
      if (mapa.modo3d) prepararProfundidade(c3);
      requestAnimationFrame(passo);
    }

    // Caixa do mundo visível, com folga. No 3D a rotação faz a tela cobrir uma
    // área maior, e as barras altas de fora da tela ainda entram pelo topo.
    function limitesVisiveis() {
      if (!mapa.modo3d) {
        return {
          x0: camera.cx - (W / 2) / camera.escala, x1: camera.cx + (W / 2) / camera.escala,
          y0: camera.cy - (H / 2) / camera.escala, y1: camera.cy + (H / 2) / camera.escala,
        };
      }
      var diag = Math.sqrt(W * W + H * H) / 2 / camera.escala * 1.1;
      var achata = Math.max(0.15, Math.cos(mapa.inclinacao));
      var alto = (ALTURA_MAX * mapa.exagero + 40) / camera.escala / achata;
      return {
        x0: camera.cx - diag, x1: camera.cx + diag,
        y0: camera.cy - diag / achata - alto,
        y1: camera.cy + diag / achata,
      };
    }

    // Ordem de pintura de trás para a frente. Ordenação por contagem em 4.096
    // faixas de profundidade: O(n), refeita a cada giro sem travar nada — a
    // ordem dentro de uma faixa não muda nada na tela.
    function prepararProfundidade(c3) {
      var FAIXAS = 4096;
      for (var b = 0; b < mapa.blocos.length; b++) {
        var bl = mapa.blocos[b];
        if (bl.giroDaOrdem === mapa.giro) continue;
        var m = bl.malha;
        var i, d, lo = Infinity, hi = -Infinity;
        var prof = bl.profundidade;
        for (i = 0; i < bl.n; i++) {
          d = m.cx[i] * c3.sen + bl.wcy[i] * c3.cos;
          prof[i] = d;
          if (d < lo) lo = d;
          if (d > hi) hi = d;
        }
        var esc = (FAIXAS - 1) / Math.max(1e-9, hi - lo);
        var cont = new Int32Array(FAIXAS + 1);
        for (i = 0; i < bl.n; i++) cont[((prof[i] - lo) * esc | 0) + 1]++;
        for (i = 0; i < FAIXAS; i++) cont[i + 1] += cont[i];
        for (i = 0; i < bl.n; i++) bl.ordemProfundidade[cont[(prof[i] - lo) * esc | 0]++] = i;
        bl.giroDaOrdem = mapa.giro;
      }
    }

    // Divisas dos estados por cima do preenchimento: sem elas o mapa vira uma
    // mancha sem referência.
    function desenharContorno() {
      if (!linhasUF || !mapa.contorno) return;
      var T = pintura.T;
      ctx.beginPath();
      for (var r = 0; r + 1 < linhasUF.ini.length; r++) {
        var ini = linhasUF.ini[r], fim = linhasUF.ini[r + 1];
        for (var k = ini; k < fim; k++) {
          var x = T.a * linhasUF.x[k] + T.b * linhasUF.y[k] + T.e;
          var y = T.c * linhasUF.x[k] + T.d * linhasUF.y[k] + T.f;
          if (k === ini) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      ctx.strokeStyle = "rgba(24,48,74,.5)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    function passo() {
      if (!pintura) return;
      var prazo = performance.now() + 14;
      var pronto = false;
      if (pintura.fase === 0) {
        if (pintarChao(prazo)) { pintura.fase = 1; pintura.bloco = 0; pintura.i = 0; }
      } else if (pintura.fase === 1) {
        desenharContorno();
        if (mapa.modo3d) { pintura.fase = 2; pintura.bloco = 0; pintura.i = 0; }
        else pronto = true;
      } else if (pintarBarras(prazo)) {
        pronto = true;
      }
      copiar();
      if (pronto) {
        pintura = null;
        bufferValido = true;
        mapa.aoRedesenhar();
      } else {
        requestAnimationFrame(passo);
      }
    }

    function copiar() {
      ctxTela.setTransform(1, 0, 0, 1, 0, 0);
      ctxTela.clearRect(0, 0, tela.width, tela.height);
      ctxTela.drawImage(buffer, 0, 0);
      cameraDoBuffer = {
        cx: camera.cx, cy: camera.cy, escala: camera.escala,
        modo3d: mapa.modo3d, giro: mapa.giro, inclinacao: mapa.inclinacao,
      };
      desenharSobreposicao();
    }

    // -------------------------------------------- coroplético (o chão do 3D)
    function pintarChao(prazo) {
      var lim = pintura.limites, T = pintura.T, esc = camera.escala;
      var contorno = mapa.bordas && esc * mapa.blocos[pintura.bloco].larguraTipica > 6;
      var wx, wy;
      var abrir = function (p) { ctx.moveTo(T.a * wx[p] + T.b * wy[p] + T.e, T.c * wx[p] + T.d * wy[p] + T.f); };
      var seguir = function (p) { ctx.lineTo(T.a * wx[p] + T.b * wy[p] + T.e, T.c * wx[p] + T.d * wy[p] + T.f); };

      while (pintura.bloco < mapa.blocos.length) {
        var bl = mapa.blocos[pintura.bloco];
        var m = bl.malha;
        wx = m.arcoX; wy = bl.arcoWY;
        var i = pintura.i;
        var baldeAtual = -2;
        ctx.beginPath();
        for (; i < bl.n; i++) {
          if ((i & 255) === 0 && performance.now() > prazo) break;
          var u = bl.ordemCor[i];
          if (m.maxX[u] < lim.x0 || m.minX[u] > lim.x1) continue;
          if (bl.wy1[u] < lim.y0 || bl.wy0[u] > lim.y1) continue;
          var bu = bl.balde[u];
          if (bu !== baldeAtual) {
            if (baldeAtual !== -2) fecharBalde(baldeAtual, contorno);
            baldeAtual = bu;
          }
          // unidade menor que um pixel: um retângulo resolve e poupa o caminho
          var lx = (m.maxX[u] - m.minX[u]) * esc;
          var ly = (bl.wy1[u] - bl.wy0[u]) * esc;
          if (lx < 1.2 && ly < 1.2) {
            var cx = m.cx[u], cy = bl.wcy[u];
            ctx.rect(T.a * cx + T.b * cy + T.e - 0.6, T.c * cx + T.d * cy + T.f - 0.6, 1.2, 1.2);
            continue;
          }
          CENSO_TOPO.percorrer(m, u, abrir, seguir);
          ctx.closePath();
        }
        if (baldeAtual !== -2) fecharBalde(baldeAtual, contorno);
        pintura.i = i;
        if (i < bl.n) return false;
        pintura.bloco++;
        pintura.i = 0;
      }
      return true;
    }

    function fecharBalde(balde, contorno) {
      ctx.fillStyle = balde < 0 ? COR_VAZIO : CORES[balde];
      ctx.fill();
      if (contorno) {
        ctx.strokeStyle = COR_BORDA;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      ctx.beginPath();
    }

    // ---------------------------------------------------------- barras do 3D
    function pintarBarras(prazo) {
      var lim = pintura.limites, T = pintura.T, esc = camera.escala;
      var achata = pintura.c3.achata;
      var corAnterior = "";
      var wx, wy, alturaDoTopo = 0;
      var paredeX = 0, paredeY = 0, temParede = false;

      var abrirParede = function (p) {
        paredeX = T.a * wx[p] + T.b * wy[p] + T.e;
        paredeY = T.c * wx[p] + T.d * wy[p] + T.f;
        temParede = true;
      };
      var seguirParede = function (p) {
        var sx = T.a * wx[p] + T.b * wy[p] + T.e;
        var sy = T.c * wx[p] + T.d * wy[p] + T.f;
        if (temParede) {
          ctx.moveTo(paredeX, paredeY);
          ctx.lineTo(sx, sy);
          ctx.lineTo(sx, sy - alturaDoTopo);
          ctx.lineTo(paredeX, paredeY - alturaDoTopo);
          ctx.closePath();
        }
        paredeX = sx; paredeY = sy;
      };
      var abrirTopo = function (p) {
        ctx.moveTo(T.a * wx[p] + T.b * wy[p] + T.e,
                   T.c * wx[p] + T.d * wy[p] + T.f - alturaDoTopo);
      };
      var seguirTopo = function (p) {
        ctx.lineTo(T.a * wx[p] + T.b * wy[p] + T.e,
                   T.c * wx[p] + T.d * wy[p] + T.f - alturaDoTopo);
      };

      while (pintura.bloco < mapa.blocos.length) {
        var bl = mapa.blocos[pintura.bloco];
        var m = bl.malha;
        wx = m.arcoX; wy = bl.arcoWY;
        var i = pintura.i;
        for (; i < bl.n; i++) {
          if ((i & 127) === 0 && performance.now() > prazo) break;
          var u = bl.ordemProfundidade[i];
          if (m.maxX[u] < lim.x0 || m.minX[u] > lim.x1) continue;
          if (bl.wy1[u] < lim.y0 || bl.wy0[u] > lim.y1) continue;

          var h = alturaPx(bl.valor[u]);
          if (h < 0.7) continue;   // sem relevo: o chão já está pintado
          var bu = bl.balde[u];
          var cor = bu < 0 ? COR_VAZIO : CORES[bu];
          var lx = (m.maxX[u] - m.minX[u]) * esc;
          var ly = (bl.wy1[u] - bl.wy0[u]) * esc * achata;

          if (lx < 2.2 && ly < 2.2) {
            // pegada menor que a ponta do lápis: uma espícula basta
            var cx = m.cx[u], cy = bl.wcy[u];
            var px = T.a * cx + T.b * cy + T.e;
            var py = T.c * cx + T.d * cy + T.f;
            if (cor !== corAnterior) { ctx.fillStyle = cor; corAnterior = cor; }
            ctx.fillRect(px - 0.7, py - h, 1.5, h);
            continue;
          }

          alturaDoTopo = h;
          ctx.beginPath();
          temParede = false;
          CENSO_TOPO.percorrer(m, u, abrirParede, seguirParede);
          ctx.fillStyle = escurecer(cor, 0.66);
          ctx.fill();
          ctx.beginPath();
          CENSO_TOPO.percorrer(m, u, abrirTopo, seguirTopo);
          ctx.closePath();
          ctx.fillStyle = cor;
          ctx.fill();
          corAnterior = "";
        }
        pintura.i = i;
        if (i < bl.n) return false;
        pintura.bloco++;
        pintura.i = 0;
      }
      return true;
    }

    // ------------------------------------------------------ realce da seleção
    function desenharSobreposicao() {
      var alvo = mapa.selecionada || mapa.sobre;
      if (!alvo) return;
      var bl = mapa.blocos[alvo.bloco];
      if (!bl) return;
      var m = bl.malha;
      var c3 = camera3d();
      var h = mapa.modo3d ? alturaPx(bl.valor[alvo.i]) : 0;
      var wy = bl.arcoWY;
      ctxTela.save();
      ctxTela.scale(dpr, dpr);
      ctxTela.beginPath();
      CENSO_TOPO.percorrer(m, alvo.i,
        function (p) { var q = projetar(m.arcoX[p], wy[p], h, c3); ctxTela.moveTo(q[0], q[1]); },
        function (p) { var q = projetar(m.arcoX[p], wy[p], h, c3); ctxTela.lineTo(q[0], q[1]); });
      ctxTela.closePath();
      ctxTela.lineWidth = 2;
      ctxTela.strokeStyle = COR_DESTAQUE;
      ctxTela.stroke();
      // uma unidade pequena demais some: um anel marca onde ela está
      if ((m.maxX[alvo.i] - m.minX[alvo.i]) * camera.escala < 7) {
        var c = projetar(m.cx[alvo.i], bl.wcy[alvo.i], h, c3);
        ctxTela.beginPath();
        ctxTela.arc(c[0], c[1], 8, 0, Math.PI * 2);
        ctxTela.stroke();
      }
      ctxTela.restore();
    }

    // ------------------------------------------------------------- interação
    function unidadeNaTela(px, py) {
      var g = desprojetar(px, py);
      for (var b = 0; b < mapa.blocos.length; b++) {
        var u = CENSO_TOPO.unidadeEm(mapa.blocos[b].malha, g.lng, g.lat);
        if (u >= 0) return { bloco: b, i: u };
      }
      return null;
    }

    var arrastando = false, girando = false, ultimo = null, moveu = false;

    tela.addEventListener("pointerdown", function (e) {
      try { tela.setPointerCapture(e.pointerId); } catch (erro) { /* sem captura */ }
      ultimo = { x: e.clientX, y: e.clientY };
      moveu = false;
      girando = mapa.modo3d && (e.button === 2 || e.shiftKey);
      arrastando = !girando;
    });

    tela.addEventListener("pointermove", function (e) {
      if (ultimo && (arrastando || girando)) {
        var dx = e.clientX - ultimo.x, dy = e.clientY - ultimo.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moveu = true;
        ultimo = { x: e.clientX, y: e.clientY };
        if (girando) {
          mapa.giro += dx * 0.006;
          mapa.inclinacao = Math.max(0.10, Math.min(1.45, mapa.inclinacao + dy * 0.005));
        } else if (mapa.modo3d) {
          var c3 = camera3d();
          var vy = dy / c3.achata;
          camera.cx -= (dx * c3.cos + vy * c3.sen) / camera.escala;
          camera.cy -= (-dx * c3.sen + vy * c3.cos) / camera.escala;
        } else {
          camera.cx -= dx / camera.escala;
          camera.cy -= dy / camera.escala;
        }
        invalidar();
        return;
      }
      var caixa = tela.getBoundingClientRect();
      var alvo = unidadeNaTela(e.clientX - caixa.left, e.clientY - caixa.top);
      var mudou = (alvo && mapa.sobre)
        ? (alvo.bloco !== mapa.sobre.bloco || alvo.i !== mapa.sobre.i)
        : (!!alvo !== !!mapa.sobre);
      mapa.sobre = alvo;
      if (mudou && !pintura) copiar();
      mapa.aoPassar(alvo, e.clientX, e.clientY);
    });

    function soltar(e) {
      try { tela.releasePointerCapture(e.pointerId); } catch (erro) { /* já solto */ }
      var eraClique = (arrastando || girando) && !moveu;
      arrastando = girando = false;
      ultimo = null;
      if (eraClique) {
        var caixa = tela.getBoundingClientRect();
        mapa.selecionada = unidadeNaTela(e.clientX - caixa.left, e.clientY - caixa.top);
        mapa.aoSelecionar(mapa.selecionada);
        if (!pintura) copiar();
      }
    }
    tela.addEventListener("pointerup", soltar);
    tela.addEventListener("pointercancel", soltar);
    tela.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    tela.addEventListener("pointerleave", function () {
      if (arrastando || girando) return;
      mapa.sobre = null;
      mapa.aoPassar(null);
      if (!pintura) copiar();
    });

    tela.addEventListener("wheel", function (e) {
      e.preventDefault();
      var caixa = tela.getBoundingClientRect();
      var px = e.clientX - caixa.left, py = e.clientY - caixa.top;
      var antes = desprojetar(px, py);
      var k = Math.pow(1.0016, -e.deltaY * (e.deltaMode === 1 ? 16 : 1));
      camera.escala = Math.max(3, Math.min(6e6, camera.escala * k));
      var depois = desprojetar(px, py);
      camera.cx += mundoX(antes.lng) - mundoX(depois.lng);
      camera.cy += mundoY(antes.lat) - mundoY(depois.lat);
      invalidar();
    }, { passive: false });

    // -------------------------------------------------------------------- API
    // Um bloco é um arquivo de dados já decodificado. A página de áreas de
    // ponderação tem um só; a de setores tem um por UF, e vão entrando conforme
    // baixam.
    mapa.adicionarBloco = function (bl) {
      var m = bl.malha;
      bl.n = m.n;
      bl.valor = new Float64Array(m.n);
      bl.balde = new Int8Array(m.n);
      bl.ordemCor = new Int32Array(m.n);
      bl.ordemProfundidade = new Int32Array(m.n);
      bl.profundidade = new Float64Array(m.n);
      bl.giroDaOrdem = NaN;
      // Mercator dos vértices e das caixas, uma vez só: sem isso seria um
      // Math.log por vértice a cada redesenho.
      bl.arcoWY = new Float32Array(m.arcoY.length);
      for (var p = 0; p < m.arcoY.length; p++) bl.arcoWY[p] = mundoY(m.arcoY[p]);
      bl.wy0 = new Float32Array(m.n);
      bl.wy1 = new Float32Array(m.n);
      bl.wcy = new Float32Array(m.n);
      var larguras = new Float64Array(m.n);
      for (var i = 0; i < m.n; i++) {
        bl.wy0[i] = mundoY(m.maxY[i]);
        bl.wy1[i] = mundoY(m.minY[i]);
        bl.wcy[i] = mundoY(m.cy[i]);
        larguras[i] = m.maxX[i] - m.minX[i];
      }
      // largura mediana das unidades: decide em que zoom vale desenhar o
      // contorno de cada uma (as áreas de ponderação são bem maiores que os
      // setores, então um limiar fixo serviria só para um dos dois recortes)
      larguras.sort();
      bl.larguraTipica = larguras[m.n >> 1] || 0.01;
      mapa.blocos.push(bl);
      return bl;
    };

    // aneis: lista de anéis [[lng, lat], ...] (data/brasil_uf.js)
    mapa.definirContorno = function (aneis) {
      var total = 0, r, k;
      for (r = 0; r < aneis.length; r++) total += aneis[r].length;
      var x = new Float32Array(total), y = new Float32Array(total);
      var ini = new Int32Array(aneis.length + 1);
      var n = 0;
      for (r = 0; r < aneis.length; r++) {
        for (k = 0; k < aneis[r].length; k++) {
          x[n] = aneis[r][k][0];
          y[n] = mundoY(aneis[r][k][1]);
          n++;
        }
        ini[r + 1] = n;
      }
      linhasUF = { x: x, y: y, ini: ini };
    };
    mapa.recalcular = recalcular;
    mapa.redesenhar = invalidar;
    mapa.redimensionar = redimensionar;
    mapa.camera = camera;
    mapa.valorDe = valorDe;
    mapa.fracao = fracao;
    mapa.valorDaFracao = valorDaFracao;
    mapa.cores = CORES;
    mapa.corVazio = COR_VAZIO;
    mapa.pintando = function () { return !!pintura; };

    mapa.irPara = function (lng, lat, escala) {
      camera.cx = mundoX(lng);
      camera.cy = mundoY(lat);
      if (escala) camera.escala = escala;
      invalidar();
    };

    mapa.enquadrar = function () {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var b = 0; b < mapa.blocos.length; b++) {
        var bl = mapa.blocos[b], m = bl.malha;
        for (var i = 0; i < m.n; i++) {
          if (m.minX[i] < minX) minX = m.minX[i];
          if (m.maxX[i] > maxX) maxX = m.maxX[i];
          if (bl.wy0[i] < minY) minY = bl.wy0[i];
          if (bl.wy1[i] > maxY) maxY = bl.wy1[i];
        }
      }
      if (!isFinite(minX)) return;
      camera.cx = (minX + maxX) / 2;
      camera.cy = (minY + maxY) / 2;
      camera.escala = Math.min(W / (maxX - minX), H / (maxY - minY)) * 0.94;
      invalidar();
    };

    mapa.selecionar = function (alvo) {
      mapa.selecionada = alvo;
      if (!pintura) copiar(); else desenharSobreposicao();
    };

    window.addEventListener("resize", redimensionar);
    return mapa;
  }

  return {
    criar: criar,
    numero: numero,
    escurecer: escurecer,
    RAMPA: RAMPA,
    CORES: CORES,
    mundoX: mundoX,
    mundoY: mundoY,
  };
})();
