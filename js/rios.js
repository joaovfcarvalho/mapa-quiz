"use strict";
// Quiz dos rios: digite um rio e veja o traçado acender no mapa.
// Dados: data/rios.js (ANA/SNIRH via tools/build_rios.py) — cada linha é
// [nome, nivel, km, [[[lng,lat],...], ...]], ordenado por extensão.
(function () {
  var SVG_NS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };

  // Normalização, alvos e busca vivem em js/rios_motor.js — o mesmo código
  // que o servidor do placar geral usa para refazer as partidas.
  var normalizar = RIOS_MOTOR.normalizar;
  var montarAlvos = RIOS_MOTOR.montarAlvos;
  var buscar = RIOS_MOTOR.buscar;

  function fmt(n) { return Math.round(n).toLocaleString("pt-BR"); }
  function fmtTempo(seg) {
    var m = Math.floor(seg / 60);
    var s = seg % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  // ------------------------------------------------------------------
  // Mapa: projeção, contorno das UFs e camada dos rios
  // ------------------------------------------------------------------
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

  var proj = GEO.criarProjecao(bounds, 1000);
  var svg = $("mapa");
  var vbBase = { x: 0, y: 0, w: proj.w, h: proj.h };
  var vb = { x: vbBase.x, y: vbBase.y, w: vbBase.w, h: vbBase.h };
  var vbStr = "";
  function aplicarViewBox() {
    var s = vb.x + " " + vb.y + " " + vb.w + " " + vb.h;
    if (s === vbStr) return; // arrasto não muda o zoom: não invalida os traços
    vbStr = s;
    svg.setAttribute("viewBox", s);
    svg.style.setProperty("--zoom", (vb.w / vbBase.w).toFixed(4));
  }
  aplicarViewBox();

  function elSvg(tag, attrs, pai) {
    var e = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    (pai || svg).appendChild(e);
    return e;
  }

  var gEstados = elSvg("g", {});
  var gRios = elSvg("g", {});

  BRASIL_UF.forEach(function (anel) {
    var d = "M";
    for (var i = 0; i < anel.length; i++) {
      d += (i ? "L" : "") + proj.x(anel[i][0]).toFixed(1) + " " + proj.y(anel[i][1]).toFixed(1);
    }
    elSvg("path", { d: d + "Z", "class": "estado" }, gEstados);
  });

  // espessura por extensão (escala log): o Amazonas salta aos olhos, um
  // afluente de 40 km é um fio — e o CSS multiplica por --zoom
  function larguraRio(km) {
    return Math.max(0.45, 0.45 + 0.9 * Math.log10(km / 50));
  }

  function desenharRios(alvos) {
    while (gRios.firstChild) gRios.removeChild(gRios.firstChild);
    // menores primeiro: os grandes ficam por cima nos cruzamentos
    alvos.slice().reverse().forEach(function (alvo, i) {
      var d = "";
      alvo.linhas.forEach(function (linha) {
        for (var j = 0; j < linha.length; j++) {
          d += (j ? "L" : "M") + proj.x(linha[j][0]).toFixed(1) + " " + proj.y(linha[j][1]).toFixed(1);
        }
      });
      alvo.el = elSvg("path", { d: d, "class": "rio" }, gRios);
      alvo.el.style.strokeWidth = "calc(" + larguraRio(alvo.km).toFixed(2) + "px * var(--zoom, 1))";
      alvo.el.__alvo = alvo;
    });
  }

  // ------------------------------------------------------------------
  // Partida
  // ------------------------------------------------------------------
  var CONJUNTOS = {
    grandes: { titulo: "Grandes rios do Brasil", quais: "os grandes rios (nível 1 da hidrografia da ANA)" },
    todos: { titulo: "Todos os rios do jogo", quais: "grandes rios e afluentes (níveis 1 e 2 da ANA)" },
  };
  var jogo = null; // {conjunto, alvos, indice, kmTotal, achados, kmFeito, inicioMs, timer, encerrado}

  // Configuração escolhida: conjunto + limite de tempo. Sem relógio, a chave
  // do recorde fica igual à de sempre ("rios|conjunto=..."), para os recordes
  // já gravados continuarem valendo; contra o relógio ela ganha "|tempo=N" —
  // cada duração é um recorde próprio, como nos modos do quiz principal.
  function lerConfig() {
    var conjunto = $("cfg-conjunto").value;
    var cfg = { conjunto: conjunto, tempoMin: null };
    cfg.chave = "rios|conjunto=" + conjunto;
    cfg.rotulo = "Rios do Brasil — " + CONJUNTOS[conjunto].quais;
    if ($("cfg-limite").value === "tempo") {
      var v = parseInt($("cfg-tempo").value, 10);
      cfg.tempoMin = Math.max(1, Math.min(240, isNaN(v) ? 10 : v));
      cfg.chave += "|tempo=" + cfg.tempoMin;
      cfg.rotulo += " · contra o relógio: " + cfg.tempoMin + " min";
    }
    return cfg;
  }

  function resumoConjunto(conjunto) {
    var m = montarAlvos(conjunto);
    var kmTotal = 0;
    m.alvos.forEach(function (a) { kmTotal += a.km; });
    return { n: m.alvos.length, kmTotal: kmTotal };
  }

  function atualizarTelaConfig() {
    var cfg = lerConfig();
    $("rotulo-tempo").hidden = $("cfg-limite").value !== "tempo";
    var r = resumoConjunto(cfg.conjunto);
    $("resumo-conjunto").textContent =
      r.n + " rios para citar, " + fmt(r.kmTotal) + " km de traçado no total." +
      (cfg.tempoMin ? " Contra o relógio: " + cfg.tempoMin + " min." : "");
    var rec = RECORDES.obter(cfg.chave);
    $("recorde-atual").hidden = !rec && !PLACAR.ativo;
    $("recorde-atual").innerHTML = rec
      ? "Seu recorde nesta configuração: <b>" +
        rec.pct.toFixed(1).replace(".", ",") + "%</b> dos km (" + rec.placar +
        ") em " + fmtTempo(rec.tempoSeg) + "."
      : "Você ainda não jogou nesta configuração.";
    // líder do placar geral desta configuração (só com o Supabase configurado)
    PLACAR.resumo($("recorde-atual"), cfg.chave, { pct: fmtPctPlacar });
  }

  // Com o placar geral ligado, a partida nasce no servidor (que a refaz no
  // fim para conferir o resultado); sem resposta, joga-se sem placar.
  var partidaPronta = false;
  function iniciar() {
    var cfg = lerConfig();
    if (PLACAR.ativo && !partidaPronta) {
      $("btn-iniciar").disabled = true;
      PLACAR.iniciarPartida(cfg.chave).then(function () {
        partidaPronta = true;
        $("btn-iniciar").disabled = false;
        iniciar();
      });
      return;
    }
    partidaPronta = false;
    var m = montarAlvos(cfg.conjunto);
    var kmTotal = 0;
    m.alvos.forEach(function (a) { kmTotal += a.km; });
    jogo = {
      conjunto: cfg.conjunto,
      cfg: cfg,
      limiteSeg: cfg.tempoMin ? cfg.tempoMin * 60 : null,
      alvos: m.alvos,
      indice: m.indice,
      kmTotal: kmTotal,
      achados: 0,
      kmFeito: 0,
      dicas: 0,
      inicioMs: Date.now(),
      timer: setInterval(tique, 1000),
      encerrado: false,
      recentes: [],
    };
    desenharRios(m.alvos);
    $("secao-config").hidden = true;
    $("secao-jogo").hidden = false;
    $("fim-jogo").hidden = true;
    $("fim-acoes").hidden = true;
    PLACAR.limpar($("placar-geral"));
    $("dica-atual").hidden = true;
    $("feedback").textContent = "";
    $("feedback").className = "";
    $("lista-acertos").innerHTML = "";
    $("input-palpite").disabled = false;
    $("btn-palpitar").disabled = false;
    $("btn-dica").disabled = false;
    $("btn-encerrar").disabled = false;
    $("jogo-titulo").textContent = CONJUNTOS[cfg.conjunto].titulo;
    $("jogo-subtitulo").textContent = m.alvos.length + " rios · " + fmt(kmTotal) + " km para acender" +
      (cfg.tempoMin ? " · ⏱️ " + cfg.tempoMin + " min" : "");
    document.body.classList.add("jogo-ativo");
    atualizarPlacar();
    $("input-palpite").focus();
  }

  function tempoSeg() { return Math.round((Date.now() - jogo.inicioMs) / 1000); }

  function tique() {
    if (jogo && !jogo.encerrado && jogo.limiteSeg !== null && tempoSeg() >= jogo.limiteSeg) {
      encerrar(false, true);
      return;
    }
    atualizarPlacar();
  }

  function atualizarPlacar() {
    if (!jogo) return;
    var pct = jogo.kmTotal ? (100 * jogo.kmFeito / jogo.kmTotal) : 0;
    $("barra-progresso").style.width = pct.toFixed(2) + "%";
    var linhas = [
      "Extensão acesa: <b>" + fmt(jogo.kmFeito) + " km</b> de " + fmt(jogo.kmTotal) +
        " km (<b>" + pct.toFixed(1).replace(".", ",") + "%</b>)",
      "Rios: <b>" + jogo.achados + "</b> de " + jogo.alvos.length,
    ];
    if (jogo.conjunto === "todos") {
      var g = { n: 0, ok: 0 }, a = { n: 0, ok: 0 };
      jogo.alvos.forEach(function (alvo) {
        var c = alvo.nivel === 1 ? g : a;
        c.n++;
        if (alvo.achado) c.ok++;
      });
      linhas.push("Grandes rios: <b>" + g.ok + "</b>/" + g.n +
        " · afluentes: <b>" + a.ok + "</b>/" + a.n);
    }
    if (jogo.limiteSeg !== null && !jogo.encerrado) {
      linhas.push("⏱️ Tempo restante: <b>" +
        fmtTempo(Math.max(0, jogo.limiteSeg - tempoSeg())) + "</b> de " + fmtTempo(jogo.limiteSeg));
    } else {
      linhas.push("Tempo: <b>" + fmtTempo(jogo.encerrado ? jogo.tempoFinal : tempoSeg()) + "</b>");
    }
    // cada linha num <span>: o #placar-linhas é uma coluna flex, e nós de
    // texto soltos virariam cada um a sua própria linha
    $("placar-linhas").innerHTML = linhas.map(function (l) {
      return "<span>" + l + "</span>";
    }).join("");
  }

  function feedback(texto, classe) {
    $("feedback").textContent = texto;
    $("feedback").className = classe || "";
  }

  function marcarRecente(alvos) {
    jogo.recentes.forEach(function (a) { a.el.classList.remove("recente"); });
    alvos.forEach(function (a) { a.el.classList.add("recente"); });
    jogo.recentes = alvos;
  }

  function palpitar() {
    if (!jogo || jogo.encerrado) return;
    var texto = $("input-palpite").value;
    if (!normalizar(texto)) return;
    PLACAR.anotar("p", texto); // diário da partida, para o servidor refazer
    var achados = buscar(jogo.indice, texto);
    if (!achados.length) {
      feedback("Não encontrei rio com esse nome no jogo. Vale com ou sem o \"rio\" na frente.", "erro");
      return;
    }
    var novos = achados.filter(function (a) { return !a.achado; });
    if (!novos.length) {
      feedback(achados[0].nome + " você já tinha acertado.", "erro");
      $("input-palpite").select();
      return;
    }
    $("input-palpite").value = "";
    var kmNovos = 0;
    novos.forEach(function (alvo) {
      alvo.achado = true;
      alvo.el.classList.add("acertado");
      jogo.achados++;
      jogo.kmFeito += alvo.km;
      kmNovos += alvo.km;
      var item = document.createElement("div");
      item.className = "item-jogada";
      item.innerHTML = "<b>" + alvo.nome + "</b><small>" +
        (alvo.partes > 1 ? alvo.partes + "× · " : "") + fmt(alvo.km) + " km</small>";
      $("lista-acertos").insertBefore(item, $("lista-acertos").firstChild);
    });
    marcarRecente(novos);
    var nomes = novos.map(function (a) { return a.nome; }).join(" + ");
    var extra = novos.length === 1 && novos[0].partes > 1
      ? " (" + novos[0].partes + " traçados no mapa)" : "";
    feedback("✓ " + nomes + extra + " — " + fmt(kmNovos) + " km", "ok");
    $("dica-atual").hidden = true;
    atualizarPlacar();
    if (jogo.achados === jogo.alvos.length) encerrar(true);
  }

  function dica() {
    if (!jogo || jogo.encerrado) return;
    var maior = null;
    for (var i = 0; i < jogo.alvos.length; i++) {
      if (!jogo.alvos[i].achado) { maior = jogo.alvos[i]; break; } // ordenados por km
    }
    if (!maior) return;
    jogo.dicas++;
    var inicial = maior.nome.replace(/^Rio /, "").charAt(0).toUpperCase();
    $("dica-atual").hidden = false;
    $("dica-atual").innerHTML = "O maior que falta começa com <b>«" + inicial +
      "»</b> — ~" + fmt(maior.km) + " km, " +
      (maior.nivel === 1 ? "um dos grandes." : "um afluente.");
  }

  function encerrar(completou, porTempo) {
    if (!jogo || jogo.encerrado) return;
    jogo.encerrado = true;
    jogo.tempoFinal = tempoSeg();
    // o tique pode passar 1 s do limite; o recorde não pode registrar mais
    if (jogo.limiteSeg !== null && jogo.tempoFinal > jogo.limiteSeg) {
      jogo.tempoFinal = jogo.limiteSeg;
    }
    clearInterval(jogo.timer);
    $("input-palpite").disabled = true;
    $("btn-palpitar").disabled = true;
    $("btn-dica").disabled = true;
    $("btn-encerrar").disabled = true;
    $("dica-atual").hidden = true;
    marcarRecente([]);

    var faltantes = jogo.alvos.filter(function (a) { return !a.achado; });
    faltantes.forEach(function (a) { a.el.classList.add("faltante"); });

    var pct = jogo.kmTotal ? (100 * jogo.kmFeito / jogo.kmTotal) : 0;
    var placar = jogo.achados + " de " + jogo.alvos.length + " rios · " + fmt(jogo.kmFeito) + " km";
    var res = RECORDES.registrar(jogo.cfg.chave, {
      pct: pct,
      placar: placar,
      rotulo: jogo.cfg.rotulo,
      tempoSeg: jogo.tempoFinal,
      data: new Date().toISOString(),
    });

    var html = completou
      ? "<b>Todos os " + jogo.alvos.length + " rios!</b> "
      : (porTempo ? "⏰ <b>Tempo esgotado!</b> " : "") +
        "<b>" + pct.toFixed(1).replace(".", ",") + "%</b> dos km de rio — " + placar + ". ";
    html += "Tempo: " + fmtTempo(jogo.tempoFinal) +
      (jogo.dicas ? " · " + jogo.dicas + " dica(s)" : "") + ".";
    if (res.melhor) html += " 🏆 Novo recorde pessoal!";
    if (faltantes.length) {
      var maiores = faltantes.slice(0, 8).map(function (a) {
        return "<b>" + a.nome + "</b> (" + fmt(a.km) + " km)";
      });
      html += "<div class=\"relatorio\">O que de maior ficou na mesa — em pontilhado no mapa:<ul><li>" +
        maiores.join("</li><li>") + "</li></ul></div>";
    }
    $("fim-jogo").hidden = false;
    $("fim-jogo").className = res.melhor ? "recorde" : "";
    $("fim-jogo").innerHTML = html;
    $("fim-acoes").hidden = false;
    // placar geral: o servidor refaz a partida pelo diário e devolve a nota
    // dele; só ela pode ser registrada
    var chave = jogo.cfg.chave;
    PLACAR.encerrarPartida({ placar: placar }).then(function (julg) {
      if (julg) julg.melhor = res.melhor;
      PLACAR.montar($("placar-geral"), chave, julg, { pct: fmtPctPlacar, tempo: fmtTempo });
    });
    atualizarPlacar();
  }
  function fmtPctPlacar(x) { return (x * 100).toFixed(1).replace(".", ",") + "%"; }

  function voltarConfig() {
    if (jogo && jogo.timer) clearInterval(jogo.timer);
    if (jogo && !jogo.encerrado) PLACAR.abandonarPartida();
    jogo = null;
    while (gRios.firstChild) gRios.removeChild(gRios.firstChild);
    document.body.classList.remove("jogo-ativo");
    $("secao-jogo").hidden = true;
    $("secao-config").hidden = false;
    atualizarTelaConfig();
  }

  // ------------------------------------------------------------------
  // Tooltip: rios revelados respondem ao mouse com nome e extensão
  // ------------------------------------------------------------------
  var tooltip = $("tooltip");
  var wrap = $("mapa-wrap");
  svg.addEventListener("mousemove", function (ev) {
    var alvo = ev.target.__alvo;
    var revelado = alvo && (alvo.achado || (jogo && jogo.encerrado));
    if (!revelado || arrasto) { tooltip.hidden = true; return; }
    tooltip.textContent = alvo.nome + " · " + fmt(alvo.km) + " km";
    tooltip.hidden = false;
    var r = wrap.getBoundingClientRect();
    tooltip.style.left = Math.min(ev.clientX - r.left + 14, r.width - tooltip.offsetWidth - 6) + "px";
    tooltip.style.top = (ev.clientY - r.top + 16) + "px";
  });
  svg.addEventListener("mouseleave", function () { tooltip.hidden = true; });

  // ------------------------------------------------------------------
  // Zoom e arrasto (mouse, toque e pinça) — o mesmo esquema do jogo
  // principal: um ponteiro arrasta, dois pinçam, roda dá zoom
  // ------------------------------------------------------------------
  function zoomEm(fator, fx, fy) {
    var novoW = Math.min(vbBase.w, Math.max(vbBase.w / 40, vb.w * fator));
    var novoH = novoW * (vbBase.h / vbBase.w);
    vb.x = Math.max(0, Math.min(vbBase.w - novoW, vb.x + fx * (vb.w - novoW)));
    vb.y = Math.max(0, Math.min(vbBase.h - novoH, vb.y + fy * (vb.h - novoH)));
    vb.w = novoW;
    vb.h = novoH;
    aplicarViewBox();
  }
  function medidaMapa() {
    var rect = svg.getBoundingClientRect();
    var escala = Math.min(rect.width / vb.w, rect.height / vb.h);
    return {
      escala: escala,
      x0: rect.left + (rect.width - vb.w * escala) / 2,
      y0: rect.top + (rect.height - vb.h * escala) / 2,
    };
  }
  function pontoDoMapa(clientX, clientY) {
    var m = medidaMapa();
    return { x: vb.x + (clientX - m.x0) / m.escala, y: vb.y + (clientY - m.y0) / m.escala };
  }

  svg.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var p = pontoDoMapa(ev.clientX, ev.clientY);
    zoomEm(ev.deltaY < 0 ? 1 / 1.25 : 1.25,
      Math.max(0, Math.min(1, (p.x - vb.x) / vb.w)),
      Math.max(0, Math.min(1, (p.y - vb.y) / vb.h)));
  }, { passive: false });

  $("btn-zoom-mais").addEventListener("click", function () { zoomEm(1 / 1.5, 0.5, 0.5); });
  $("btn-zoom-menos").addEventListener("click", function () { zoomEm(1.5, 0.5, 0.5); });
  $("btn-zoom-zerar").addEventListener("click", function () {
    vb = { x: vbBase.x, y: vbBase.y, w: vbBase.w, h: vbBase.h };
    aplicarViewBox();
  });

  var arrasto = null;
  var ponteiros = [];
  var pinca = null;
  var ultimoToque = null;

  function acharPonteiro(id) {
    for (var i = 0; i < ponteiros.length; i++) if (ponteiros[i].id === id) return i;
    return -1;
  }
  function medidaPinca() {
    var dx = ponteiros[0].x - ponteiros[1].x;
    var dy = ponteiros[0].y - ponteiros[1].y;
    return {
      d: Math.max(20, Math.sqrt(dx * dx + dy * dy)),
      cx: (ponteiros[0].x + ponteiros[1].x) / 2,
      cy: (ponteiros[0].y + ponteiros[1].y) / 2,
    };
  }

  svg.addEventListener("pointerdown", function (ev) {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    if (svg.setPointerCapture) {
      try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
    }
    if (acharPonteiro(ev.pointerId) === -1) {
      ponteiros.push({ id: ev.pointerId, x: ev.clientX, y: ev.clientY });
    }
    if (ponteiros.length === 1) {
      arrasto = { x: ev.clientX, y: ev.clientY, vbx: vb.x, vby: vb.y };
      svg.classList.add("arrastando");
    } else if (ponteiros.length === 2) {
      arrasto = null;
      tooltip.hidden = true;
      pinca = medidaPinca();
    } else {
      pinca = null;
    }
  });

  svg.addEventListener("pointermove", function (ev) {
    var i = acharPonteiro(ev.pointerId);
    if (i === -1) return;
    ponteiros[i].x = ev.clientX;
    ponteiros[i].y = ev.clientY;
    if (ponteiros.length === 2 && pinca) {
      var agora = medidaPinca();
      var p = pontoDoMapa(agora.cx, agora.cy);
      zoomEm(pinca.d / agora.d,
        Math.max(0, Math.min(1, (p.x - vb.x) / vb.w)),
        Math.max(0, Math.min(1, (p.y - vb.y) / vb.h)));
      var escala = medidaMapa().escala;
      vb.x = Math.max(0, Math.min(vbBase.w - vb.w, vb.x - (agora.cx - pinca.cx) / escala));
      vb.y = Math.max(0, Math.min(vbBase.h - vb.h, vb.y - (agora.cy - pinca.cy) / escala));
      aplicarViewBox();
      pinca = agora;
    } else if (arrasto && ponteiros.length === 1) {
      var esc = medidaMapa().escala;
      vb.x = Math.max(0, Math.min(vbBase.w - vb.w, arrasto.vbx - (ev.clientX - arrasto.x) / esc));
      vb.y = Math.max(0, Math.min(vbBase.h - vb.h, arrasto.vby - (ev.clientY - arrasto.y) / esc));
      aplicarViewBox();
    }
  });

  function soltarPonteiro(ev) {
    var i = acharPonteiro(ev.pointerId);
    if (i === -1) return;
    ponteiros.splice(i, 1);
    if (ponteiros.length === 1) {
      arrasto = { x: ponteiros[0].x, y: ponteiros[0].y, vbx: vb.x, vby: vb.y };
      pinca = null;
      return;
    }
    if (ponteiros.length > 0) return;
    svg.classList.remove("arrastando");
    var moveu = arrasto ? Math.abs(ev.clientX - arrasto.x) + Math.abs(ev.clientY - arrasto.y) : 99;
    arrasto = null;
    pinca = null;
    // toque duplo restaura o mapa inteiro, como no jogo principal
    if (ev.pointerType !== "mouse" && moveu < 12) {
      var agoraMs = Date.now();
      if (ultimoToque && agoraMs - ultimoToque.t < 350 &&
          Math.abs(ev.clientX - ultimoToque.x) + Math.abs(ev.clientY - ultimoToque.y) < 50) {
        ultimoToque = null;
        vb = { x: vbBase.x, y: vbBase.y, w: vbBase.w, h: vbBase.h };
        aplicarViewBox();
        return;
      }
      ultimoToque = { t: agoraMs, x: ev.clientX, y: ev.clientY };
    }
  }
  svg.addEventListener("pointerup", soltarPonteiro);
  svg.addEventListener("pointercancel", soltarPonteiro);
  svg.addEventListener("dblclick", function () {
    vb = { x: vbBase.x, y: vbBase.y, w: vbBase.w, h: vbBase.h };
    aplicarViewBox();
  });

  // ------------------------------------------------------------------
  // Traços esmaecidos dos rios não descobertos: ligados por padrão
  // ------------------------------------------------------------------
  var LS_TRACOS = "mapaquiz.rios.tracos";
  function setTracos(ligado) {
    svg.classList.toggle("sem-tracos", !ligado);
    $("btn-tracos").classList.toggle("ativo", ligado);
    $("btn-tracos").title = ligado
      ? "Rios não descobertos aparecem como relevo esmaecido — clique para ocultá-los"
      : "Rios não descobertos estão ocultos — clique para mostrá-los esmaecidos";
    try { localStorage.setItem(LS_TRACOS, ligado ? "1" : "0"); } catch (e) {}
  }
  $("btn-tracos").addEventListener("click", function () {
    setTracos(svg.classList.contains("sem-tracos"));
  });
  var tracosSalvo = null;
  try { tracosSalvo = localStorage.getItem(LS_TRACOS); } catch (e) {}
  setTracos(tracosSalvo !== "0");

  // ------------------------------------------------------------------
  // Ligações da interface
  // ------------------------------------------------------------------
  $("btn-iniciar").addEventListener("click", iniciar);
  $("btn-palpitar").addEventListener("click", palpitar);
  // o pointerdown cancelado impede os botões de roubarem o foco do campo
  $("btn-palpitar").addEventListener("pointerdown", function (ev) { ev.preventDefault(); });
  $("btn-dica").addEventListener("click", dica);
  $("btn-dica").addEventListener("pointerdown", function (ev) { ev.preventDefault(); });
  $("btn-encerrar").addEventListener("click", function () { encerrar(false); });
  $("btn-de-novo").addEventListener("click", voltarConfig);
  $("input-palpite").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") { ev.preventDefault(); palpitar(); }
  });
  $("cfg-conjunto").addEventListener("change", atualizarTelaConfig);
  $("cfg-limite").addEventListener("change", atualizarTelaConfig);
  $("cfg-tempo").addEventListener("input", atualizarTelaConfig);

  atualizarTelaConfig();
})();
