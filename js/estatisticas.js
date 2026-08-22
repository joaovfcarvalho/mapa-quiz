"use strict";
// Página "pontos cegos": mapa e listas do que o jogador já citou (ou nunca
// citou) nas partidas, a partir da contagem local gravada pelo jogo.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var LS_CITADAS = "mapaquiz.citadas.v1";

  function carregarTally() {
    try { return JSON.parse(localStorage.getItem(LS_CITADAS)) || {}; }
    catch (e) { return {}; }
  }
  var tally = carregarTally();
  var muns = DADOS.municipios;

  function fmtInt(n) { return n.toLocaleString("pt-BR"); }
  function fmtPct(x) {
    return (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
  }
  function fmtPop(n) {
    if (n >= 1e6) return (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
    if (n >= 1e3) return Math.round(n / 1e3).toLocaleString("pt-BR") + " mil";
    return fmtInt(n);
  }
  function vezes(m) { return tally[m.id] || 0; }

  // ---------------- projeção e desenho ----------------
  var bounds = { latMin: 90, latMax: -90, lngMin: 180, lngMax: -180 };
  BRASIL_UF.forEach(function (anel) {
    anel.forEach(function (p) {
      if (p[1] < bounds.latMin) bounds.latMin = p[1];
      if (p[1] > bounds.latMax) bounds.latMax = p[1];
      if (p[0] < bounds.lngMin) bounds.lngMin = p[0];
      if (p[0] > bounds.lngMax) bounds.lngMax = p[0];
    });
  });
  bounds.latMin -= 0.4; bounds.latMax += 0.4; bounds.lngMin -= 0.4; bounds.lngMax += 0.4;
  var W = 1400;
  var proj = GEO.criarProjecao(bounds, W);
  var H = Math.round(proj.h);

  var canvas = $("mapa-cegos");
  canvas.width = W;
  canvas.height = H;
  var ctx = canvas.getContext("2d");

  // cor do ponto: nunca citada = tom neutro; citada = verde que escurece com
  // o nº de partidas (satura em 5)
  function corPonto(n) {
    if (n === 0) return "rgba(179, 168, 147, 0.55)";
    var t = Math.min(n - 1, 4) / 4;
    var a = [58, 168, 106], b = [10, 74, 32];
    return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," +
      Math.round(a[1] + (b[1] - a[1]) * t) + "," +
      Math.round(a[2] + (b[2] - a[2]) * t) + ")";
  }

  function desenhar() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#f3ede2";
    ctx.strokeStyle = "#b8ab93";
    ctx.lineWidth = 1;
    BRASIL_UF.forEach(function (anel) {
      ctx.beginPath();
      anel.forEach(function (p, i) {
        var x = proj.x(p[0]), y = proj.y(p[1]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
    // primeiro as nunca citadas (fundo), depois as citadas por cima
    muns.forEach(function (m) {
      if (vezes(m) > 0) return;
      ctx.fillStyle = corPonto(0);
      ctx.beginPath();
      ctx.arc(proj.x(m.lng), proj.y(m.lat), 1.7, 0, 2 * Math.PI);
      ctx.fill();
    });
    muns.forEach(function (m) {
      var n = vezes(m);
      if (n === 0) return;
      ctx.fillStyle = corPonto(n);
      ctx.beginPath();
      ctx.arc(proj.x(m.lng), proj.y(m.lat), 2.6, 0, 2 * Math.PI);
      ctx.fill();
    });
  }

  // ---------------- painel ----------------
  function montarPainel() {
    var citadas = muns.filter(function (m) { return vezes(m) > 0; });
    var resumo = $("resumo");
    if (citadas.length === 0) {
      resumo.innerHTML = "<h3>Nenhuma partida registrada ainda</h3>" +
        "Jogue algumas partidas no quiz — cada cidade que você citar entra aqui.";
    } else {
      var popCitada = 0;
      citadas.forEach(function (m) { popCitada += m.pop; });
      var maisCitada = citadas.slice().sort(function (a, b) {
        return (vezes(b) - vezes(a)) || (b.pop - a.pop);
      })[0];
      resumo.innerHTML = "<h3>Municípios que você já citou</h3>" +
        "<div class='grande'>" + fmtInt(citadas.length) + " <small style='font-size:14px'>de " +
        fmtInt(muns.length) + " (" + fmtPct(citadas.length / muns.length) + ")</small></div>" +
        "Juntos somam " + fmtPop(popCitada) + " habitantes (" +
        fmtPct(popCitada / DADOS.popTotal) + " do país).<br>" +
        "Sua favorita: <b>" + maisCitada.nome + " (" + maisCitada.uf + ")</b>, citada em " +
        vezes(maisCitada) + (vezes(maisCitada) === 1 ? " partida." : " partidas.");
    }

    // as maiores cidades que nunca apareceram num palpite seu
    var nunca = muns.filter(function (m) { return vezes(m) === 0; }).slice(0, 12);
    var alvo = $("lista-nunca");
    if (nunca.length === 0) {
      alvo.innerHTML = "<h3>🏆 Você já citou todos os municípios!</h3>";
    } else {
      alvo.innerHTML = "<h3>Maiores cidades que você nunca citou</h3><ol>" +
        nunca.map(function (m) {
          return "<li>" + m.nome + " (" + m.uf + ") <span class='pop'>· " +
            fmtPop(m.pop) + " hab.</span></li>";
        }).join("") + "</ol>";
    }

    // cobertura por UF, da mais para a menos coberta
    var porUF = {};
    muns.forEach(function (m) {
      if (!porUF[m.uf]) porUF[m.uf] = { total: 0, citadas: 0 };
      porUF[m.uf].total++;
      if (vezes(m) > 0) porUF[m.uf].citadas++;
    });
    var barras = Object.keys(porUF).map(function (uf) {
      var c = porUF[uf];
      return { uf: uf, pct: c.citadas / c.total, citadas: c.citadas, total: c.total };
    }).sort(function (a, b) { return (b.pct - a.pct) || a.uf.localeCompare(b.uf); });
    $("barras-uf").innerHTML = barras.map(function (b) {
      return "<div class='linha-uf'><span class='sigla'>" + b.uf +
        "</span><span class='trilho'><div style='width:" + (b.pct * 100).toFixed(1) +
        "%'></div></span><span class='valor'>" + b.citadas + "/" + b.total +
        " · " + Math.round(b.pct * 100) + "%</span></div>";
    }).join("");
  }

  // ---------------- tooltip (município mais próximo do mouse) ----------------
  var tooltip = $("tooltip");
  canvas.addEventListener("mousemove", function (ev) {
    var rect = canvas.getBoundingClientRect();
    // object-fit: contain — acha a área realmente ocupada pelo desenho
    var escala = Math.min(rect.width / W, rect.height / H);
    var offX = (rect.width - W * escala) / 2;
    var offY = (rect.height - H * escala) / 2;
    var x = (ev.clientX - rect.left - offX) / escala;
    var y = (ev.clientY - rect.top - offY) / escala;
    var melhor = null;
    var melhorD = 12 * 12; // raio de captura em px do canvas
    muns.forEach(function (m) {
      var dx = proj.x(m.lng) - x;
      var dy = proj.y(m.lat) - y;
      var d = dx * dx + dy * dy;
      if (d < melhorD) { melhorD = d; melhor = m; }
    });
    if (!melhor) { tooltip.hidden = true; return; }
    var n = vezes(melhor);
    tooltip.innerHTML = "<b>" + melhor.nome + " (" + melhor.uf + ")</b> · " +
      fmtPop(melhor.pop) + " hab. · " +
      (n === 0 ? "nunca citada" : "citada em " + n + (n === 1 ? " partida" : " partidas"));
    tooltip.hidden = false;
    var wrap = $("mapa-wrap").getBoundingClientRect();
    tooltip.style.left = ev.clientX - wrap.left + 14 + "px";
    tooltip.style.top = ev.clientY - wrap.top + 10 + "px";
  });
  canvas.addEventListener("mouseleave", function () { tooltip.hidden = true; });

  $("btn-zerar").addEventListener("click", function () {
    if (!confirm("Apagar a contagem de todas as cidades já citadas? Os recordes não são afetados.")) return;
    try { localStorage.removeItem(LS_CITADAS); } catch (e) {}
    tally = {};
    desenhar();
    montarPainel();
  });

  desenhar();
  montarPainel();
})();
