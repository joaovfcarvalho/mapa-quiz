"use strict";
// Mapa de densidade de municípios: para cada ponto do mapa, quantos municípios
// existem num raio de X km (municípios contados como pontos — a sede).
//
// Algoritmo: em vez de, para cada pixel, varrer os 5.570 municípios, fazemos o
// inverso — para cada município rasterizamos um disco de raio X sobre uma grade
// acumuladora (1 célula = 1 pixel do canvas). O resultado é idêntico (contagem
// de municípios a até X km do centro do pixel) e o custo é proporcional à área
// dos discos, não a pixels × municípios.
var DENSIDADE = (function () {
  var RAD = Math.PI / 180;
  var KM_GRAU = GEO.KM_POR_GRAU; // km por grau de latitude

  // ---------- limites e projeção (iguais aos do quiz) ----------
  var bounds = { latMin: 90, latMax: -90, lngMin: 180, lngMax: -180 };
  for (var i = 0; i < MUNICIPIOS.length; i++) {
    var m = MUNICIPIOS[i];
    if (m[3] < bounds.latMin) bounds.latMin = m[3];
    if (m[3] > bounds.latMax) bounds.latMax = m[3];
    if (m[4] < bounds.lngMin) bounds.lngMin = m[4];
    if (m[4] > bounds.lngMax) bounds.lngMax = m[4];
  }
  bounds.latMin -= 0.4; bounds.latMax += 0.4; bounds.lngMin -= 0.4; bounds.lngMax += 0.4;

  var proj = GEO.criarProjecao(bounds, 1200);
  var W = proj.w;
  var H = Math.round(proj.h);
  var degPxLat = (bounds.latMax - bounds.latMin) / proj.h; // graus de lat por pixel
  var degPxLng = (bounds.lngMax - bounds.lngMin) / W;      // graus de lng por pixel

  function pixelParaLatLng(px, py) {
    return {
      lat: bounds.latMax - (py + 0.5) * degPxLat,
      lng: bounds.lngMin + (px + 0.5) * degPxLng,
    };
  }

  // ---------- máscara do território (pixels dentro do Brasil) ----------
  var mask = (function () {
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var cx = cv.getContext("2d");
    cx.fillStyle = "#000";
    cx.beginPath();
    for (var r = 0; r < BRASIL_UF.length; r++) {
      var anel = BRASIL_UF[r];
      cx.moveTo(proj.x(anel[0][0]), proj.y(anel[0][1]));
      for (var p = 1; p < anel.length; p++) {
        cx.lineTo(proj.x(anel[p][0]), proj.y(anel[p][1]));
      }
      cx.closePath();
    }
    cx.fill();
    var dados = cx.getImageData(0, 0, W, H).data;
    var msk = new Uint8Array(W * H);
    for (var k = 0; k < msk.length; k++) msk[k] = dados[k * 4 + 3] > 127 ? 1 : 0;
    return msk;
  })();

  // ---------- escala de cor (sequencial, um matiz, claro → escuro) ----------
  var RAMPA = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
  var COR_ZERO = [241, 240, 236]; // dentro do Brasil, mas nenhum município no raio
  var LUT = (function () {
    function hex(c) {
      return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    }
    var stops = RAMPA.map(hex);
    var n = 512, out = new Uint8ClampedArray(n * 3);
    for (var j = 0; j < n; j++) {
      var t = (j / (n - 1)) * (stops.length - 1);
      var a = Math.floor(t), b = Math.min(a + 1, stops.length - 1), f = t - a;
      out[j * 3] = stops[a][0] + (stops[b][0] - stops[a][0]) * f;
      out[j * 3 + 1] = stops[a][1] + (stops[b][1] - stops[a][1]) * f;
      out[j * 3 + 2] = stops[a][2] + (stops[b][2] - stops[a][2]) * f;
    }
    return out;
  })();

  // A distribuição de contagens é muito assimétrica (sertão vazio × interior de
  // MG/SP lotado); raiz quadrada abre o pé da escala sem mentir sobre a ordem.
  function corDeContagem(v, max) {
    if (v === 0) return COR_ZERO;
    var t = Math.sqrt(v / max);
    var j = Math.min(511, Math.round(t * 511)) * 3;
    return [LUT[j], LUT[j + 1], LUT[j + 2]];
  }

  // ---------- cálculo da grade de contagens (em pedaços, sem travar a UI) ----------
  var acc = null;       // Uint16Array W*H com a contagem por pixel
  var maxCont = 0;
  var raioAtual = 0;
  var token = 0;        // invalida cálculos antigos quando o raio muda no meio

  function calcular(raioKm, aoProgredir, aoTerminar) {
    var meuToken = ++token;
    var grade = new Uint16Array(W * H);
    var idx = 0;
    var ryPx = raioKm / KM_GRAU / degPxLat;

    function pedaço() {
      if (meuToken !== token) return; // cancelado por um novo cálculo
      var fim = Math.min(idx + 250, MUNICIPIOS.length);
      for (; idx < fim; idx++) {
        var m = MUNICIPIOS[idx];
        var latM = m[3], lngM = m[4];
        var pyC = (bounds.latMax - latM) / degPxLat - 0.5;
        var pxC = (lngM - bounds.lngMin) / degPxLng - 0.5;
        var y0 = Math.max(0, Math.ceil(pyC - ryPx));
        var y1 = Math.min(H - 1, Math.floor(pyC + ryPx));
        for (var py = y0; py <= y1; py++) {
          var latRow = bounds.latMax - (py + 0.5) * degPxLat;
          var dyKm = (latRow - latM) * KM_GRAU;
          var resto = raioKm * raioKm - dyKm * dyKm;
          if (resto < 0) continue;
          // meia-largura do disco nesta linha, em pixels de longitude
          var meiaPx = Math.sqrt(resto) / (KM_GRAU * Math.cos(((latRow + latM) / 2) * RAD)) / degPxLng;
          var x0 = Math.max(0, Math.ceil(pxC - meiaPx));
          var x1 = Math.min(W - 1, Math.floor(pxC + meiaPx));
          var base = py * W;
          for (var px = x0; px <= x1; px++) grade[base + px]++;
        }
      }
      if (idx < MUNICIPIOS.length) {
        aoProgredir(idx / MUNICIPIOS.length);
        setTimeout(pedaço, 0);
      } else {
        var max = 1;
        for (var k = 0; k < grade.length; k++) {
          if (mask[k] && grade[k] > max) max = grade[k];
        }
        acc = grade;
        maxCont = max;
        raioAtual = raioKm;
        aoTerminar();
      }
    }
    pedaço();
  }

  // ---------- desenho ----------
  function renderizar(ctx) {
    var img = ctx.createImageData(W, H);
    var d = img.data;
    for (var k = 0; k < acc.length; k++) {
      if (!mask[k]) continue; // fora do Brasil: transparente
      var c = corDeContagem(acc[k], maxCont);
      var o = k * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // divisas das UFs por cima, discretas
    ctx.strokeStyle = "rgba(20, 40, 70, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var r = 0; r < BRASIL_UF.length; r++) {
      var anel = BRASIL_UF[r];
      ctx.moveTo(proj.x(anel[0][0]), proj.y(anel[0][1]));
      for (var p = 1; p < anel.length; p++) {
        ctx.lineTo(proj.x(anel[p][0]), proj.y(anel[p][1]));
      }
      ctx.closePath();
    }
    ctx.stroke();
  }

  // ---------- consultas ----------
  function contagemNoPixel(px, py) {
    if (px < 0 || py < 0 || px >= W || py >= H) return null;
    var k = py * W + px;
    if (!mask[k]) return null;
    return acc ? acc[k] : 0;
  }

  // Contagem exata (haversine) + municípios dentro do raio, para o ponto fixado.
  function sondar(lat, lng, raioKm) {
    var dentro = [];
    for (var i = 0; i < MUNICIPIOS.length; i++) {
      var m = MUNICIPIOS[i];
      if (Math.abs(m[3] - lat) * KM_GRAU > raioKm) continue; // corte barato
      if (GEO.haversineKm(lat, lng, m[3], m[4]) <= raioKm) dentro.push(m);
    }
    dentro.sort(function (a, b) { return b[5] - a[5]; });
    return dentro;
  }

  function pontoMaisDenso() {
    var melhorK = -1, melhor = -1;
    for (var k = 0; k < acc.length; k++) {
      if (mask[k] && acc[k] > melhor) { melhor = acc[k]; melhorK = k; }
    }
    var p = pixelParaLatLng(melhorK % W, Math.floor(melhorK / W));
    // nomeia pelo município mais próximo do pico
    var perto = null, dMin = Infinity;
    for (var i = 0; i < MUNICIPIOS.length; i++) {
      var m = MUNICIPIOS[i];
      var d = GEO.haversineKm(p.lat, p.lng, m[3], m[4]);
      if (d < dMin) { dMin = d; perto = m; }
    }
    return { contagem: melhor, lat: p.lat, lng: p.lng, perto: perto };
  }

  return {
    W: W, H: H,
    proj: proj,
    bounds: bounds,
    pixelParaLatLng: pixelParaLatLng,
    calcular: calcular,
    renderizar: renderizar,
    contagemNoPixel: contagemNoPixel,
    sondar: sondar,
    pontoMaisDenso: pontoMaisDenso,
    corDeContagem: function (v) { return corDeContagem(v, maxCont); },
    maxContagem: function () { return maxCont; },
    raioAtual: function () { return raioAtual; },
  };
})();

// ================= interface =================
(function () {
  var canvas = document.getElementById("mapa-dens");
  var overlay = document.getElementById("mapa-overlay");
  canvas.width = DENSIDADE.W; canvas.height = DENSIDADE.H;
  overlay.width = DENSIDADE.W; overlay.height = DENSIDADE.H;
  var ctx = canvas.getContext("2d");
  var octx = overlay.getContext("2d");

  var elRaio = document.getElementById("cfg-raio");
  var elRaioNum = document.getElementById("cfg-raio-num");
  var elStatus = document.getElementById("status-calc");
  var elLegenda = document.getElementById("legenda-canvas");
  var elLegendaTicks = document.getElementById("legenda-ticks");
  var elStats = document.getElementById("stats");
  var elChkCidades = document.getElementById("chk-cidades");
  var elTooltip = document.getElementById("tooltip");
  var elSonda = document.getElementById("sonda");
  var elSondaTitulo = document.getElementById("sonda-titulo");
  var elSondaLista = document.getElementById("sonda-lista");
  var btnSondaLimpar = document.getElementById("btn-sonda-limpar");

  var sondaPos = null; // {lat, lng} do ponto fixado com clique

  function fmt(n) { return n.toLocaleString("pt-BR"); }

  // O canvas usa object-fit:contain — a área desenhada pode ter faixas vazias
  // dos lados; este helper converte coordenadas do mouse em pixel da grade.
  function mouseParaPixel(e) {
    var rect = canvas.getBoundingClientRect();
    var escala = Math.min(rect.width / DENSIDADE.W, rect.height / DENSIDADE.H);
    var offX = (rect.width - DENSIDADE.W * escala) / 2;
    var offY = (rect.height - DENSIDADE.H * escala) / 2;
    return {
      px: Math.floor((e.clientX - rect.left - offX) / escala),
      py: Math.floor((e.clientY - rect.top - offY) / escala),
    };
  }

  // ---------- overlay: pontos das cidades + círculo da sonda ----------
  function desenharOverlay() {
    octx.clearRect(0, 0, DENSIDADE.W, DENSIDADE.H);
    if (elChkCidades.checked) {
      octx.fillStyle = "rgba(15, 25, 40, 0.45)";
      for (var i = 0; i < MUNICIPIOS.length; i++) {
        var m = MUNICIPIOS[i];
        octx.fillRect(DENSIDADE.proj.x(m[4]) - 0.5, DENSIDADE.proj.y(m[3]) - 0.5, 1.2, 1.2);
      }
    }
    if (sondaPos) {
      var pts = GEO.circuloGeodesico(sondaPos.lat, sondaPos.lng, DENSIDADE.raioAtual(), 128);
      octx.strokeStyle = "#c62828";
      octx.lineWidth = 2;
      octx.beginPath();
      octx.moveTo(DENSIDADE.proj.x(pts[0][1]), DENSIDADE.proj.y(pts[0][0]));
      for (var p = 1; p < pts.length; p++) {
        octx.lineTo(DENSIDADE.proj.x(pts[p][1]), DENSIDADE.proj.y(pts[p][0]));
      }
      octx.closePath();
      octx.stroke();
      octx.fillStyle = "#c62828";
      octx.beginPath();
      octx.arc(DENSIDADE.proj.x(sondaPos.lng), DENSIDADE.proj.y(sondaPos.lat), 3.5, 0, 2 * Math.PI);
      octx.fill();
    }
  }

  // ---------- legenda ----------
  function desenharLegenda() {
    var lw = elLegenda.width, lh = elLegenda.height;
    var lctx = elLegenda.getContext("2d");
    var img = lctx.createImageData(lw, lh);
    var max = DENSIDADE.maxContagem();
    for (var x = 0; x < lw; x++) {
      var v = (x / (lw - 1)) * max;
      var c = DENSIDADE.corDeContagem(v === 0 ? 0 : Math.max(1, v));
      for (var y = 0; y < lh; y++) {
        var o = (y * lw + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    lctx.putImageData(img, 0, 0);
    var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (f) { return Math.round(max * f); });
    elLegendaTicks.innerHTML = ticks.map(function (t) { return "<span>" + fmt(t) + "</span>"; }).join("");
  }

  // ---------- estatísticas ----------
  function atualizarStats() {
    var pico = DENSIDADE.pontoMaisDenso();
    elStats.innerHTML =
      "<strong>Pico:</strong> " + fmt(pico.contagem) + " municípios num raio de " +
      fmt(DENSIDADE.raioAtual()) + " km, perto de <strong>" +
      pico.perto[1] + ", " + pico.perto[2] + "</strong>.";
  }

  // ---------- sonda (clique) ----------
  function atualizarSonda() {
    if (!sondaPos) { elSonda.hidden = true; return; }
    var raio = DENSIDADE.raioAtual();
    var dentro = DENSIDADE.sondar(sondaPos.lat, sondaPos.lng, raio);
    elSonda.hidden = false;
    elSondaTitulo.innerHTML =
      "<strong>" + fmt(dentro.length) + " municípios</strong> num raio de " + fmt(raio) +
      " km do ponto (" + sondaPos.lat.toFixed(2) + ", " + sondaPos.lng.toFixed(2) + ")";
    var top = dentro.slice(0, 8);
    elSondaLista.innerHTML = top.map(function (m) {
      return "<li>" + m[1] + ", " + m[2] + " <span class='pop'>" + fmt(m[5]) + " hab.</span></li>";
    }).join("") + (dentro.length > top.length
      ? "<li class='mais'>… e mais " + fmt(dentro.length - top.length) + "</li>" : "");
  }

  // ---------- recálculo ----------
  function recalcular() {
    var raio = parseInt(elRaioNum.value, 10);
    if (!(raio >= 20 && raio <= 500)) return;
    elStatus.hidden = false;
    elStatus.textContent = "Calculando…";
    DENSIDADE.calcular(raio, function (frac) {
      elStatus.textContent = "Calculando… " + Math.round(frac * 100) + "%";
    }, function () {
      DENSIDADE.renderizar(ctx);
      desenharLegenda();
      atualizarStats();
      desenharOverlay();
      atualizarSonda();
      elStatus.hidden = true;
    });
  }

  var timerDebounce = null;
  function agendarRecalculo() {
    clearTimeout(timerDebounce);
    timerDebounce = setTimeout(recalcular, 250);
  }

  elRaio.addEventListener("input", function () {
    elRaioNum.value = elRaio.value;
    agendarRecalculo();
  });
  elRaioNum.addEventListener("input", function () {
    var v = parseInt(elRaioNum.value, 10);
    if (v >= 20 && v <= 500) { elRaio.value = v; agendarRecalculo(); }
  });

  elChkCidades.addEventListener("change", desenharOverlay);

  // ---------- tooltip ----------
  overlay.parentElement.addEventListener("mousemove", function (e) {
    var p = mouseParaPixel(e);
    var v = DENSIDADE.contagemNoPixel(p.px, p.py);
    if (v === null) { elTooltip.hidden = true; return; }
    var geo = DENSIDADE.pixelParaLatLng(p.px, p.py);
    elTooltip.hidden = false;
    elTooltip.innerHTML = "<strong>" + fmt(v) + "</strong> municípios em " +
      fmt(DENSIDADE.raioAtual()) + " km<br><span class='coord'>" +
      geo.lat.toFixed(2) + ", " + geo.lng.toFixed(2) + "</span>";
    var wrap = document.getElementById("mapa-wrap").getBoundingClientRect();
    elTooltip.style.left = (e.clientX - wrap.left + 14) + "px";
    elTooltip.style.top = (e.clientY - wrap.top + 14) + "px";
  });
  overlay.parentElement.addEventListener("mouseleave", function () {
    elTooltip.hidden = true;
  });

  overlay.parentElement.addEventListener("click", function (e) {
    var p = mouseParaPixel(e);
    if (DENSIDADE.contagemNoPixel(p.px, p.py) === null) return;
    sondaPos = DENSIDADE.pixelParaLatLng(p.px, p.py);
    desenharOverlay();
    atualizarSonda();
  });

  btnSondaLimpar.addEventListener("click", function () {
    sondaPos = null;
    desenharOverlay();
    atualizarSonda();
  });

  recalcular();
})();
