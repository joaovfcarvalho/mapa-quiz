"use strict";
// Página "pontos cegos": mapa e listas do que o jogador já citou (ou nunca
// citou) nas partidas, a partir da contagem local gravada pelo jogo.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  // o registro por dimensão (citou, localizou, faltou, dica, comparou) vem
  // de js/conhecimento.js — que migra sozinho a contagem antiga
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
  function vezes(m) { return CONHECIMENTO.vezesCitou(m); }
  function saber(m) { return CONHECIMENTO.de(m); }

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

    // as dimensões do que você sabe: quantos municípios em cada uma
    var dim = { c: 0, l: 0, lBem: 0, f: 0, d: 0, k: 0, kBem: 0 };
    muns.forEach(function (m) {
      var s = saber(m);
      if (s.c) dim.c++;
      if (s.l) { dim.l++; if (s.lp / s.l >= 0.6) dim.lBem++; }
      if (s.f) dim.f++;
      if (s.d) dim.d++;
      if (s.k) { dim.k++; if ((s.ka || 0) / s.k >= 0.5) dim.kBem++; }
    });
    $("dimensoes").innerHTML = "<h3>O que você sabe, por dimensão</h3>" +
      "<div class='dim-linha'><span>🧠 Lembra o nome</span><b>" + fmtInt(dim.c) + "</b></div>" +
      "<div class='dim-linha'><span>📍 Localiza no mapa</span><b>" + fmtInt(dim.lBem) +
        "<small> de " + fmtInt(dim.l) + " perguntadas</small></b></div>" +
      "<div class='dim-linha'><span>⚖️ Acerta o porte</span><b>" + fmtInt(dim.kBem) +
        "<small> de " + fmtInt(dim.k) + " comparadas</small></b></div>" +
      "<div class='dim-linha'><span>🕳️ Deixou passar</span><b>" + fmtInt(dim.f) + "</b></div>" +
      "<div class='dim-linha'><span>💡 Só viu por dica</span><b>" + fmtInt(dim.d) + "</b></div>";

    // alvos que ficaram sem nome (o que treinar primeiro)
    var faltou = muns.filter(function (m) { return saber(m).f > 0; })
      .sort(function (a, b) { return (saber(b).f - saber(a).f) || (b.pop - a.pop); }).slice(0, 10);
    var elF = $("lista-faltou");
    elF.hidden = faltou.length === 0;
    if (faltou.length) {
      elF.innerHTML = "<h3>Alvos que você mais deixou passar</h3><ol>" +
        faltou.map(function (m) {
          var s = saber(m);
          return "<li>" + m.nome + " (" + m.uf + ") <span class='pop'>· " + fmtPop(m.pop) + " hab. · " +
            s.f + (s.f === 1 ? " vez" : " vezes") + (s.c ? "" : " · nunca citou") + "</span></li>";
        }).join("") + "</ol>";
    }
    // cidades que você sabe o nome mas coloca longe do lugar
    var mal = muns.filter(function (m) { var s = saber(m); return s.l >= 1 && s.lp / s.l < 0.5; })
      .sort(function (a, b) { return (saber(a).lp / saber(a).l) - (saber(b).lp / saber(b).l) || (b.pop - a.pop); }).slice(0, 10);
    var elL = $("lista-local");
    elL.hidden = mal.length === 0;
    if (mal.length) {
      elL.innerHTML = "<h3>Sabe o nome, erra o lugar</h3><ol>" +
        mal.map(function (m) {
          var s = saber(m);
          return "<li>" + m.nome + " (" + m.uf + ") <span class='pop'>· acerto médio " +
            Math.round(100 * s.lp / s.l) + "% em " + s.l + (s.l === 1 ? " rodada" : " rodadas") + "</span></li>";
        }).join("") + "</ol>";
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
    var s = saber(melhor);
    var extras = [];
    if (s.l) extras.push("localizou " + Math.round(100 * s.lp / s.l) + "%");
    if (s.f) extras.push("deixou passar " + s.f + "×");
    if (s.d) extras.push("viu por dica");
    tooltip.innerHTML = "<b>" + melhor.nome + " (" + melhor.uf + ")</b> · " +
      fmtPop(melhor.pop) + " hab. · " +
      (n === 0 ? "nunca citada" : "citada em " + n + (n === 1 ? " partida" : " partidas")) +
      (extras.length ? " · " + extras.join(" · ") : "");
    tooltip.hidden = false;
    var wrap = $("mapa-wrap").getBoundingClientRect();
    tooltip.style.left = ev.clientX - wrap.left + 14 + "px";
    tooltip.style.top = ev.clientY - wrap.top + 10 + "px";
  });
  canvas.addEventListener("mouseleave", function () { tooltip.hidden = true; });

  $("btn-zerar").addEventListener("click", function () {
    if (!confirm("Apagar tudo que o jogo registrou sobre o que você sabe (citou, localizou, deixou passar)? Os recordes não são afetados.")) return;
    CONHECIMENTO.zerar();
    desenhar();
    montarPainel();
  });

  desenhar();
  montarPainel();
})();
