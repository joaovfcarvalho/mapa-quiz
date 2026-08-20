"use strict";
(function () {
  var SVG_NS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------
  // Mapa: limites, projeção e camadas
  // ------------------------------------------------------------------
  var bounds = { latMin: 90, latMax: -90, lngMin: 180, lngMax: -180 };
  function alargar(lat, lng) {
    if (lat < bounds.latMin) bounds.latMin = lat;
    if (lat > bounds.latMax) bounds.latMax = lat;
    if (lng < bounds.lngMin) bounds.lngMin = lng;
    if (lng > bounds.lngMax) bounds.lngMax = lng;
  }
  BRASIL_UF.forEach(function (anel) {
    anel.forEach(function (p) { alargar(p[1], p[0]); });
  });
  DADOS.municipios.forEach(function (m) { alargar(m.lat, m.lng); });
  bounds.latMin -= 0.4; bounds.latMax += 0.4; bounds.lngMin -= 0.4; bounds.lngMax += 0.4;

  var proj = GEO.criarProjecao(bounds, 1000);
  var svg = $("mapa");
  var vbBase = { x: 0, y: 0, w: proj.w, h: proj.h };
  var vb = { x: vbBase.x, y: vbBase.y, w: vbBase.w, h: vbBase.h };
  function aplicarViewBox() {
    svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
  }
  aplicarViewBox();

  function elSvg(tag, attrs, pai) {
    var e = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    (pai || svg).appendChild(e);
    return e;
  }

  var gEstados = elSvg("g", {});
  var gFaixas = elSvg("g", {});
  var gCirculos = elSvg("g", {});
  var gCidades = elSvg("g", {});
  var gMarcas = elSvg("g", {});

  // contorno das UFs
  BRASIL_UF.forEach(function (anel) {
    var d = anel.map(function (p, i) {
      return (i === 0 ? "M" : "L") + proj.x(p[0]).toFixed(1) + " " + proj.y(p[1]).toFixed(1);
    }).join("") + "Z";
    elSvg("path", { d: d, "class": "estado" }, gEstados);
  });

  // pontos das cidades (um <circle> por município, reaproveitado entre partidas)
  function raioPonto(pop) {
    return Math.min(0.7 + Math.sqrt(pop) / 900, 5.5);
  }
  var pontos = [];
  DADOS.municipios.forEach(function (m) {
    pontos[m.idx] = elSvg("circle", {
      cx: proj.x(m.lng).toFixed(1),
      cy: proj.y(m.lat).toFixed(1),
      r: raioPonto(m.pop).toFixed(2),
      "class": "cidade",
      "data-idx": m.idx,
    }, gCidades);
  });

  function caminhoGeodesico(lat, lng, raioKm) {
    var pts = GEO.circuloGeodesico(lat, lng, raioKm);
    return pts.map(function (p, i) {
      return (i === 0 ? "M" : "L") + proj.x(p[1]).toFixed(1) + " " + proj.y(p[0]).toFixed(1);
    }).join("") + "Z";
  }

  // ------------------------------------------------------------------
  // Formatação
  // ------------------------------------------------------------------
  function fmtInt(n) { return n.toLocaleString("pt-BR"); }
  function fmtPct(x) {
    return (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
  }
  function fmtPop(n) {
    if (n >= 1e6) return (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
    if (n >= 1e3) return Math.round(n / 1e3).toLocaleString("pt-BR") + " mil";
    return fmtInt(n);
  }
  function fmtTempo(seg) {
    var m = Math.floor(seg / 60);
    var s = seg % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function nomeUF(m) { return m.nome + " (" + m.uf + ")"; }

  // ------------------------------------------------------------------
  // Estado da interface
  // ------------------------------------------------------------------
  var modoAtual = "dist";
  var jogo = null;
  var jogoModo = null;      // modo da partida em andamento
  var jogoChave = null;     // chave de recorde da partida
  var jogoRotulo = null;    // descrição legível da configuração
  var inicioMs = null;
  var timerInt = null;
  var elFaixasLista = null; // itens da lista lateral do modo faixas

  var DESCRICOES = {
    dist: "Chute cidades: cada palpite cobre todos os municípios num raio fixo. Cubra o máximo do Brasil antes de acabarem os palpites.",
    pop: "Cada cidade chutada vira o centro de um círculo que cresce até somar a população alvo. Escolha bem para cobrir o máximo do país.",
    faixas: "O mapa é dividido em faixas e você precisa nomear as maiores cidades de cada uma. Digite qualquer cidade — se ela for uma das respostas, aparece no mapa.",
  };

  // ------------------------------------------------------------------
  // Configuração
  // ------------------------------------------------------------------
  function num(id, min, max) {
    var v = parseInt($(id).value, 10);
    if (isNaN(v)) v = min;
    v = Math.max(min, Math.min(max, v));
    $(id).value = v;
    return v;
  }

  // Lê e valida a configuração do modo atual. Devolve {cfg, chave, rotulo}
  // ou {erro} (ex.: centro dos anéis não reconhecido).
  function lerConfig() {
    if (modoAtual === "dist") {
      var cfgD = {
        raio: num("cfg-dist-raio", 10, 2000),
        palpites: num("cfg-dist-palpites", 1, 100),
        metrica: $("cfg-dist-metrica").value,
      };
      return {
        cfg: cfgD,
        chave: "dist|raio=" + cfgD.raio + "|palpites=" + cfgD.palpites + "|metrica=" + cfgD.metrica,
        rotulo: "Círculos por distância · raio " + cfgD.raio + " km · " + cfgD.palpites +
          " palpites · objetivo: " + (cfgD.metrica === "pop" ? "população" : "nº de cidades"),
      };
    }
    if (modoAtual === "pop") {
      var cfgP = {
        popAlvo: num("cfg-pop-alvo", 10000, 100000000),
        palpites: num("cfg-pop-palpites", 1, 100),
      };
      return {
        cfg: cfgP,
        chave: "pop|alvo=" + cfgP.popAlvo + "|palpites=" + cfgP.palpites,
        rotulo: "Círculos por população · " + fmtInt(cfgP.popAlvo) + " hab. por círculo · " +
          cfgP.palpites + " palpites",
      };
    }
    var cfgF = {
      tipo: $("cfg-faixas-tipo").value,
      largura: num("cfg-faixas-largura", 50, 2000),
      topN: num("cfg-faixas-topn", 1, 10),
    };
    var chave = "faixas|tipo=" + cfgF.tipo + "|largura=" + cfgF.largura + "|top=" + cfgF.topN;
    var nomeTipo = { lat: "Faixas de latitude", lng: "Faixas de longitude", aneis: "Anéis concêntricos" }[cfgF.tipo];
    var rotulo = nomeTipo + " · " + cfgF.largura + " km · " + cfgF.topN + " maiores cidades por faixa";
    if (cfgF.tipo === "aneis") {
      var res = DADOS.buscar($("cfg-faixas-centro").value);
      if (res.status === "ok") {
        cfgF.centro = res.municipios[0];
        chave += "|centro=" + cfgF.centro.id;
        rotulo = "Anéis de " + cfgF.largura + " km em volta de " + nomeUF(cfgF.centro) +
          " · " + cfgF.topN + " maiores cidades por anel";
      } else if (res.status === "ambiguo") {
        return { erro: "Há mais de uma cidade com esse nome para o centro dos anéis — especifique a UF (ex.: " +
          res.municipios[0].nome + ", " + res.municipios[0].uf + ")." };
      } else {
        return { erro: "Não encontrei a cidade do centro dos anéis. Confira o nome (ex.: Brasília, DF)." };
      }
    }
    return { cfg: cfgF, chave: chave, rotulo: rotulo };
  }

  function atualizarRecordeUI() {
    var lido = lerConfig();
    var el = $("recorde-atual");
    if (lido.erro) {
      el.innerHTML = "⚠️ " + lido.erro;
      return;
    }
    var rec = RECORDES.obter(lido.chave);
    if (!rec) {
      el.innerHTML = "🏅 Você ainda não jogou nesta configuração.";
    } else {
      el.innerHTML = "🏅 Seu recorde nesta configuração: <b>" + fmtPct(rec.pct) + "</b>" +
        (rec.placar ? " (" + rec.placar + ")" : "") +
        " · tempo " + fmtTempo(rec.tempoSeg) +
        " · " + rec.jogos + (rec.jogos === 1 ? " jogo" : " jogos");
    }
  }

  // ------------------------------------------------------------------
  // Partida
  // ------------------------------------------------------------------
  function limparCamadasDeJogo() {
    gFaixas.innerHTML = "";
    gCirculos.innerHTML = "";
    gMarcas.innerHTML = "";
    pontos.forEach(function (p) { p.setAttribute("class", "cidade"); });
  }

  function setConfigTravada(travada) {
    var campos = document.querySelectorAll("#config input, #config select");
    campos.forEach(function (c) { c.disabled = travada; });
  }

  function iniciar() {
    var lido = lerConfig();
    if (lido.erro) {
      atualizarRecordeUI();
      return;
    }
    limparCamadasDeJogo();
    jogoModo = modoAtual;
    jogoChave = lido.chave;
    jogoRotulo = lido.rotulo;
    if (modoAtual === "dist") jogo = new MODOS.JogoCirculosDistancia(lido.cfg);
    else if (modoAtual === "pop") jogo = new MODOS.JogoCirculosPopulacao(lido.cfg);
    else jogo = new MODOS.JogoFaixas(lido.cfg);

    $("area-jogo").hidden = false;
    $("fim-jogo").hidden = true;
    $("feedback").textContent = "";
    $("feedback").className = "";
    $("lista-jogo").innerHTML = "";
    $("input-palpite").value = "";
    $("input-palpite").disabled = false;
    $("btn-palpitar").disabled = false;
    $("btn-encerrar").hidden = false;
    $("btn-iniciar").textContent = "↺ Reiniciar";
    setConfigTravada(true);

    if (jogoModo === "faixas") {
      desenharFaixas(jogo);
      montarListaFaixas(jogo);
    }
    atualizarPlacar();

    inicioMs = Date.now();
    clearInterval(timerInt);
    timerInt = setInterval(atualizarPlacar, 1000);
    $("input-palpite").focus();
  }

  function tempoDecorrido() {
    return inicioMs === null ? 0 : Math.floor((Date.now() - inicioMs) / 1000);
  }

  function atualizarPlacar() {
    if (!jogo) return;
    var linhas = [];
    var pct = jogo.pct();
    if (jogoModo === "dist" && jogo.cfg.metrica === "cidades") {
      linhas.push("Cidades cobertas: <b>" + fmtInt(jogo.cobertos.size) + "</b> de " +
        fmtInt(DADOS.total) + " (<b>" + fmtPct(pct) + "</b>)");
      linhas.push("População coberta: <b>" + fmtPop(jogo.popCoberta) + "</b>");
    } else if (jogoModo === "dist" || jogoModo === "pop") {
      linhas.push("População coberta: <b>" + fmtPop(jogo.popCoberta) + "</b> de " +
        fmtPop(DADOS.popTotal) + " (<b>" + fmtPct(pct) + "</b>)");
      linhas.push("Cidades cobertas: <b>" + fmtInt(jogo.cobertos.size) + "</b>");
    } else {
      linhas.push("Respostas certas: <b>" + jogo.achadosTotal + "</b> de " + jogo.alvosTotal +
        " (<b>" + fmtPct(pct) + "</b>) · " + jogo.faixas.length + " faixas");
    }
    if (jogoModo === "dist" || jogoModo === "pop") {
      linhas.push("Palpites restantes: <b>" + jogo.palpitesRestantes() + "</b> de " + jogo.cfg.palpites);
    }
    linhas.push("Tempo: <b>" + fmtTempo(tempoDecorrido()) + "</b>");
    $("placar-linhas").innerHTML = linhas.map(function (l) { return "<div>" + l + "</div>"; }).join("");
    $("barra-progresso").style.width = (pct * 100).toFixed(1) + "%";
  }

  function feedback(msg, classe) {
    $("feedback").textContent = msg;
    $("feedback").className = classe || "";
  }

  // ---------------- palpites ----------------
  function palpitar() {
    if (!jogo || jogo.encerrado) return;
    var texto = $("input-palpite").value;
    if (jogoModo === "faixas") return palpitarFaixas(texto);

    var res = DADOS.buscar(texto);
    if (res.status === "vazio") return;
    if (res.status === "nao_encontrado") {
      feedback(res.ufErrada
        ? "Esse município existe, mas não nessa UF."
        : "Não encontrei nenhum município com esse nome.", "erro");
      return;
    }
    if (res.status === "ambiguo") {
      var ufs = res.municipios.map(function (m) { return m.uf; }).join(", ");
      feedback("Há " + res.municipios.length + " municípios com esse nome (" + ufs +
        "). Especifique: " + res.municipios[0].nome + ", UF.", "erro");
      return;
    }
    var mun = res.municipios[0];
    var r = jogo.palpitar(mun);
    if (r.tipo === "repetido") {
      feedback("Você já usou " + nomeUF(mun) + ".", "erro");
      return;
    }
    if (r.tipo !== "ok") return;

    var j = r.jogada;
    elSvg("path", { d: caminhoGeodesico(mun.lat, mun.lng, j.raioKm), "class": "circulo-cobertura" }, gCirculos);
    j.novos.forEach(function (idx) { pontos[idx].classList.add("coberta"); });
    pontos[mun.idx].setAttribute("class", "cidade centro-palpite");
    elSvg("text", {
      x: (proj.x(mun.lng) + 4).toFixed(1),
      y: (proj.y(mun.lat) - 3).toFixed(1),
      "class": "rotulo-cidade centro-palpite",
    }, gMarcas).textContent = mun.nome;

    var ordem = jogo.jogadas.length;
    var detalhe = jogoModo === "pop"
      ? "raio " + Math.round(j.raioKm) + " km · +" + fmtPop(j.ganhoPop) + " hab. novos · +" + fmtInt(j.novos.length) + " cidades"
      : "+" + fmtPop(j.ganhoPop) + " hab. · +" + fmtInt(j.novos.length) + " cidades";
    var item = document.createElement("div");
    item.className = "item-jogada";
    item.innerHTML = "<b>" + ordem + ". " + nomeUF(mun) + "</b><br><small>" + detalhe + "</small>";
    $("lista-jogo").prepend(item);

    feedback("✔ " + nomeUF(mun) + " — " + detalhe, "ok");
    $("input-palpite").value = "";
    atualizarPlacar();
    if (jogo.encerrado) fimDeJogo(false);
  }

  function palpitarFaixas(texto) {
    var r = jogo.palpitar(texto);
    if (r.tipo === "vazio") return;
    if (r.tipo === "nao_encontrado") {
      feedback(r.ufErrada
        ? "Esse município existe, mas não nessa UF."
        : "Não encontrei nenhum município com esse nome.", "erro");
      return;
    }
    if (r.tipo === "nao_alvo") {
      feedback(r.municipios.length === 1
        ? nomeUF(r.municipios[0]) + " não está entre as respostas."
        : "Nenhum dos municípios chamados " + r.municipios[0].nome + " está entre as respostas.", "erro");
      $("input-palpite").select();
      return;
    }
    r.revelados.forEach(function (par) { revelarAlvo(par.mun, par.faixa, false); });
    var nomes = r.revelados.map(function (par) {
      return nomeUF(par.mun) + " — faixa " + par.faixa.rotulo;
    });
    feedback("✔ " + nomes.join(" · "), "ok");
    $("input-palpite").value = "";
    atualizarPlacar();
    if (r.completo) fimDeJogo(false);
  }

  function revelarAlvo(mun, faixa, faltante) {
    pontos[mun.idx].setAttribute("class", "cidade " + (faltante ? "faltante" : "achada"));
    elSvg("text", {
      x: (proj.x(mun.lng) + 4).toFixed(1),
      y: (proj.y(mun.lat) - 3).toFixed(1),
      "class": "rotulo-cidade" + (faltante ? " faltante" : ""),
    }, gMarcas).textContent = mun.nome;
    if (faixa._elContador) {
      faixa._elContador.textContent = faixa.achados.size + "/" + faixa.alvos.length;
    }
    atualizarItemFaixa(faixa);
  }

  function fimDeJogo(desistiu) {
    clearInterval(timerInt);
    var tempoSeg = tempoDecorrido();
    if (jogoModo === "faixas") {
      var faltantes = jogo.encerrar();
      if (desistiu) {
        faltantes.forEach(function (par) { revelarAlvo(par.mun, par.faixa, true); });
      }
    } else {
      jogo.encerrado = true;
    }
    atualizarPlacar();
    $("input-palpite").disabled = true;
    $("btn-palpitar").disabled = true;
    $("btn-encerrar").hidden = true;
    setConfigTravada(false);
    $("btn-iniciar").textContent = "▶ Jogar de novo";

    var pct = jogo.pct();
    var placar;
    if (jogoModo === "faixas") {
      placar = jogo.achadosTotal + "/" + jogo.alvosTotal + " respostas";
    } else if (jogoModo === "dist" && jogo.cfg.metrica === "cidades") {
      placar = fmtInt(jogo.cobertos.size) + " cidades";
    } else {
      placar = fmtPop(jogo.popCoberta) + " hab.";
    }
    var res = RECORDES.registrar(jogoChave, {
      pct: pct,
      placar: placar,
      rotulo: jogoRotulo,
      tempoSeg: tempoSeg,
      data: new Date().toISOString(),
    });
    var el = $("fim-jogo");
    el.hidden = false;
    el.className = res.melhor ? "recorde" : "";
    el.innerHTML = "<b>Fim de jogo!</b> Resultado: <b>" + fmtPct(pct) + "</b> (" + placar +
      ") em " + fmtTempo(tempoSeg) + ".<br>" +
      (res.melhor
        ? "🎉 <b>Novo recorde pessoal nesta configuração!</b>"
        : "Seu recorde nesta configuração segue " + fmtPct(res.recorde.pct) +
          " (" + res.recorde.placar + ", " + fmtTempo(res.recorde.tempoSeg) + ").");
    atualizarRecordeUI();
  }

  // ---------------- desenho e lista das faixas ----------------
  function desenharFaixas(jogo) {
    var cfg = jogo.cfg;
    jogo.faixas.forEach(function (f) {
      var cx, cy;
      if (cfg.tipo === "lat") {
        var y1 = proj.y(Math.min(f.latSup, bounds.latMax));
        var y2 = proj.y(Math.max(f.latInf, bounds.latMin));
        if (f.indice % 2 === 0) {
          elSvg("rect", { x: 0, y: y1.toFixed(1), width: proj.w, height: (y2 - y1).toFixed(1), "class": "faixa-sombra" }, gFaixas);
        }
        elSvg("line", { x1: 0, y1: y2.toFixed(1), x2: proj.w, y2: y2.toFixed(1), "class": "linha-faixa" }, gFaixas);
        cx = 8; cy = (y1 + y2) / 2 + 4;
      } else if (cfg.tipo === "lng") {
        var x1 = proj.x(Math.max(f.lngOeste, bounds.lngMin));
        var x2 = proj.x(Math.min(f.lngLeste, bounds.lngMax));
        if (f.indice % 2 === 0) {
          elSvg("rect", { x: x1.toFixed(1), y: 0, width: (x2 - x1).toFixed(1), height: proj.h, "class": "faixa-sombra" }, gFaixas);
        }
        elSvg("line", { x1: x2.toFixed(1), y1: 0, x2: x2.toFixed(1), y2: proj.h, "class": "linha-faixa" }, gFaixas);
        cx = (x1 + x2) / 2 - 8; cy = 14;
      } else {
        elSvg("path", { d: caminhoGeodesico(cfg.centro.lat, cfg.centro.lng, f.kmExterno), "class": "linha-faixa" }, gFaixas);
        var pMeio = GEO.destino(cfg.centro.lat, cfg.centro.lng, 0, (f.kmInterno + f.kmExterno) / 2);
        cx = proj.x(pMeio[1]) - 8; cy = proj.y(pMeio[0]) + 4;
      }
      f._elContador = elSvg("text", { x: cx.toFixed(1), y: cy.toFixed(1), "class": "contador-faixa" }, gFaixas);
      f._elContador.textContent = "0/" + f.alvos.length;
    });
    if (cfg.tipo === "aneis") {
      var cxC = proj.x(cfg.centro.lng), cyC = proj.y(cfg.centro.lat);
      elSvg("line", { x1: cxC - 5, y1: cyC, x2: cxC + 5, y2: cyC, "class": "marca-centro" }, gFaixas);
      elSvg("line", { x1: cxC, y1: cyC - 5, x2: cxC, y2: cyC + 5, "class": "marca-centro" }, gFaixas);
    }
  }

  function montarListaFaixas(jogo) {
    var alvo = $("lista-jogo");
    alvo.innerHTML = "";
    elFaixasLista = new Map();
    jogo.faixas.forEach(function (f) {
      var item = document.createElement("div");
      item.className = "item-faixa";
      alvo.appendChild(item);
      elFaixasLista.set(f.indice, item);
      atualizarItemFaixa(f);
    });
  }

  function atualizarItemFaixa(f) {
    if (!elFaixasLista) return;
    var item = elFaixasLista.get(f.indice);
    if (!item) return;
    var chips = f.alvos.map(function (m) {
      if (f.achados.has(m.idx)) return '<span class="chip achado">' + nomeUF(m) + "</span>";
      if (jogo && jogo.encerrado) return '<span class="chip faltante">' + nomeUF(m) + "</span>";
      return '<span class="chip">•••</span>';
    }).join("");
    item.innerHTML = '<div class="titulo-faixa"><span>' + f.rotulo + "</span><span>" +
      f.achados.size + "/" + f.alvos.length + "</span></div><div class='chips'>" + chips + "</div>";
  }

  // ------------------------------------------------------------------
  // Recordes (modal)
  // ------------------------------------------------------------------
  function abrirRecordes() {
    var lista = RECORDES.listar();
    var alvo = $("lista-recordes");
    if (lista.length === 0) {
      alvo.innerHTML = "<p class='modal-nota'>Nenhum recorde ainda — jogue uma partida!</p>";
    } else {
      alvo.innerHTML = "";
      lista.forEach(function (par) {
        var r = par.recorde;
        var item = document.createElement("div");
        item.className = "item-recorde";
        var data = r.data ? new Date(r.data).toLocaleDateString("pt-BR") : "—";
        item.innerHTML = "<div class='info'><b>" + fmtPct(r.pct) + "</b> — " + (r.placar || "") +
          " em " + fmtTempo(r.tempoSeg) +
          "<small>" + (r.rotulo || par.chave) + "</small>" +
          "<small>" + data + " · " + r.jogos + (r.jogos === 1 ? " jogo" : " jogos") + "</small></div>";
        var btn = document.createElement("button");
        btn.className = "botao-sec";
        btn.textContent = "Apagar";
        btn.addEventListener("click", function () {
          RECORDES.apagar(par.chave);
          abrirRecordes();
          atualizarRecordeUI();
        });
        item.appendChild(btn);
        alvo.appendChild(item);
      });
    }
    $("modal-recordes").hidden = false;
  }

  // ------------------------------------------------------------------
  // Tooltip e zoom/pan
  // ------------------------------------------------------------------
  var tooltip = $("tooltip");
  svg.addEventListener("mousemove", function (ev) {
    var t = ev.target;
    if (t.tagName === "circle" && t.dataset.idx !== undefined &&
        t.getAttribute("class") !== "cidade") {
      var m = DADOS.municipios[+t.dataset.idx];
      tooltip.innerHTML = "<b>" + nomeUF(m) + "</b> · " + fmtInt(m.pop) + " hab.";
      tooltip.hidden = false;
      var wrap = $("mapa-wrap").getBoundingClientRect();
      tooltip.style.left = ev.clientX - wrap.left + 14 + "px";
      tooltip.style.top = ev.clientY - wrap.top + 10 + "px";
    } else {
      tooltip.hidden = true;
    }
  });
  svg.addEventListener("mouseleave", function () { tooltip.hidden = true; });

  svg.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var rect = svg.getBoundingClientRect();
    var fx = (ev.clientX - rect.left) / rect.width;
    var fy = (ev.clientY - rect.top) / rect.height;
    var fator = ev.deltaY < 0 ? 1 / 1.25 : 1.25;
    var novoW = Math.min(vbBase.w, Math.max(vbBase.w / 40, vb.w * fator));
    var novoH = novoW * (vbBase.h / vbBase.w);
    vb.x = Math.max(0, Math.min(vbBase.w - novoW, vb.x + fx * (vb.w - novoW)));
    vb.y = Math.max(0, Math.min(vbBase.h - novoH, vb.y + fy * (vb.h - novoH)));
    vb.w = novoW;
    vb.h = novoH;
    aplicarViewBox();
  }, { passive: false });

  var arrasto = null;
  svg.addEventListener("mousedown", function (ev) {
    arrasto = { x: ev.clientX, y: ev.clientY, vbx: vb.x, vby: vb.y };
    svg.classList.add("arrastando");
  });
  window.addEventListener("mousemove", function (ev) {
    if (!arrasto) return;
    var rect = svg.getBoundingClientRect();
    vb.x = Math.max(0, Math.min(vbBase.w - vb.w, arrasto.vbx - (ev.clientX - arrasto.x) * (vb.w / rect.width)));
    vb.y = Math.max(0, Math.min(vbBase.h - vb.h, arrasto.vby - (ev.clientY - arrasto.y) * (vb.h / rect.height)));
    aplicarViewBox();
  });
  window.addEventListener("mouseup", function () {
    arrasto = null;
    svg.classList.remove("arrastando");
  });
  svg.addEventListener("dblclick", function () {
    vb = { x: vbBase.x, y: vbBase.y, w: vbBase.w, h: vbBase.h };
    aplicarViewBox();
  });

  // ------------------------------------------------------------------
  // Ligações da interface
  // ------------------------------------------------------------------
  document.querySelectorAll("#abas-modo .aba").forEach(function (aba) {
    aba.addEventListener("click", function () {
      modoAtual = aba.dataset.modo;
      document.querySelectorAll("#abas-modo .aba").forEach(function (a) {
        a.classList.toggle("ativa", a === aba);
      });
      document.querySelectorAll(".config-modo").forEach(function (div) {
        div.hidden = div.dataset.modo !== modoAtual;
      });
      $("descricao-modo").textContent = DESCRICOES[modoAtual];
      // trocar de modo abandona a partida em andamento
      if (jogo && !jogo.encerrado) {
        clearInterval(timerInt);
        jogo = null;
      }
      $("area-jogo").hidden = true;
      limparCamadasDeJogo();
      setConfigTravada(false);
      $("btn-iniciar").textContent = "▶ Iniciar jogo";
      atualizarRecordeUI();
    });
  });

  $("cfg-faixas-tipo").addEventListener("change", function () {
    $("rotulo-centro").hidden = $("cfg-faixas-tipo").value !== "aneis";
  });
  document.querySelectorAll("#config input, #config select").forEach(function (c) {
    c.addEventListener("change", atualizarRecordeUI);
  });

  $("btn-iniciar").addEventListener("click", iniciar);
  $("btn-palpitar").addEventListener("click", palpitar);
  $("input-palpite").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") { ev.preventDefault(); palpitar(); }
  });
  $("btn-encerrar").addEventListener("click", function () {
    if (jogo && !jogo.encerrado) fimDeJogo(true);
  });
  $("config").addEventListener("submit", function (ev) { ev.preventDefault(); });

  $("btn-recordes").addEventListener("click", abrirRecordes);
  $("btn-fechar-recordes").addEventListener("click", function () { $("modal-recordes").hidden = true; });
  $("modal-recordes").addEventListener("click", function (ev) {
    if (ev.target === $("modal-recordes")) $("modal-recordes").hidden = true;
  });
  $("btn-limpar-recordes").addEventListener("click", function () {
    if (confirm("Apagar todos os recordes salvos neste navegador?")) {
      RECORDES.limparTudo();
      abrirRecordes();
      atualizarRecordeUI();
    }
  });

  // estado inicial
  $("descricao-modo").textContent = DESCRICOES[modoAtual];
  atualizarRecordeUI();
})();
