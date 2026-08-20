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
    // fração do mapa visível — o CSS multiplica traços, pontos e letras por
    // esse fator para que fiquem sempre com o mesmo tamanho na tela
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
  var gFaixas = elSvg("g", {});
  var gCirculos = elSvg("g", {});
  var gCidades = elSvg("g", {});
  var gMarcas = elSvg("g", {});

  // fundo de satélite (NASA Blue Marble, recortado nos mesmos limites do
  // mapa — como a projeção é equiretangular, a imagem esticada no viewBox
  // alinha com os contornos); só é baixado na primeira vez que for ligado
  var LS_SATELITE = "mapaquiz.satelite";
  var imgSatelite = null;
  function setSatelite(ligado) {
    if (ligado && !imgSatelite) {
      imgSatelite = elSvg("image", {
        x: 0, y: 0, width: proj.w, height: proj.h,
        preserveAspectRatio: "none",
        href: "data/satelite.jpg",
      });
      svg.insertBefore(imgSatelite, gEstados);
    }
    if (imgSatelite) imgSatelite.setAttribute("visibility", ligado ? "visible" : "hidden");
    svg.classList.toggle("satelite", ligado);
    $("btn-satelite").classList.toggle("ativo", ligado);
    try { localStorage.setItem(LS_SATELITE, ligado ? "1" : "0"); } catch (e) {}
  }

  // contorno das UFs
  BRASIL_UF.forEach(function (anel) {
    var d = anel.map(function (p, i) {
      return (i === 0 ? "M" : "L") + proj.x(p[0]).toFixed(1) + " " + proj.y(p[1]).toFixed(1);
    }).join("") + "Z";
    elSvg("path", { d: d, "class": "estado" }, gEstados);
  });

  // pontos das cidades (um <circle> por município, reaproveitado entre
  // partidas); tamanho igual para todos — o tamanho não pode entregar a
  // população — e definido de fato no CSS, na escala do zoom
  var pontos = [];
  DADOS.municipios.forEach(function (m) {
    pontos[m.idx] = elSvg("circle", {
      cx: proj.x(m.lng).toFixed(1),
      cy: proj.y(m.lat).toFixed(1),
      r: "1.2",
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
  // Região do jogo (Brasil inteiro ou uma UF)
  // ------------------------------------------------------------------
  var NOMES_UF = {
    AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
    CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
    MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
    MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
    PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro",
    RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia",
    RR: "Roraima", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo",
    TO: "Tocantins",
  };
  Object.keys(NOMES_UF).sort().forEach(function (uf) {
    var op = document.createElement("option");
    op.value = uf;
    op.textContent = "Só " + NOMES_UF[uf] + " (" + uf + ")";
    $("cfg-regiao").appendChild(op);
  });
  function ufDoJogo() {
    var uf = $("cfg-regiao").value;
    return uf === "BR" ? null : uf;
  }

  // esconde os pontos de fora da região da partida
  function aplicarRegiao(uf) {
    DADOS.municipios.forEach(function (m) {
      pontos[m.idx].classList.toggle("fora", !!uf && m.uf !== uf);
    });
  }

  function extentDe(lista, margem) {
    var e = { latMin: 90, latMax: -90, lngMin: 180, lngMax: -180 };
    lista.forEach(function (m) {
      if (m.lat < e.latMin) e.latMin = m.lat;
      if (m.lat > e.latMax) e.latMax = m.lat;
      if (m.lng < e.lngMin) e.lngMin = m.lng;
      if (m.lng > e.lngMax) e.lngMax = m.lng;
    });
    e.latMin -= margem; e.latMax += margem; e.lngMin -= margem; e.lngMax += margem;
    return e;
  }

  // aproxima o mapa da região da partida (ou volta ao Brasil inteiro)
  function enquadrarUniverso(jogo) {
    if (!jogo.cfg.uf) {
      vb = { x: vbBase.x, y: vbBase.y, w: vbBase.w, h: vbBase.h };
      aplicarViewBox();
      return;
    }
    var e = extentDe(jogo.universo, 0.35);
    var x1 = proj.x(e.lngMin), x2 = proj.x(e.lngMax);
    var y1 = proj.y(e.latMax), y2 = proj.y(e.latMin);
    var ar = vbBase.w / vbBase.h;
    var w = x2 - x1, h = y2 - y1;
    if (w / h > ar) h = w / ar; else w = h * ar;
    w = Math.min(vbBase.w, Math.max(vbBase.w / 40, w));
    h = w / ar;
    var cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    vb.w = w;
    vb.h = h;
    vb.x = Math.max(0, Math.min(vbBase.w - w, cx - w / 2));
    vb.y = Math.max(0, Math.min(vbBase.h - h, cy - h / 2));
    aplicarViewBox();
  }

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
  var limiteSeg = null;     // limite de tempo da partida em segundos (null = sem limite)
  var elFaixasLista = null; // itens da lista lateral do modo faixas
  var topnChips = null;     // rank -> chip da lista do modo Top N

  var DESCRICOES = {
    dist: "Chute cidades: cada palpite cobre todos os municípios num raio fixo. Cubra o máximo da região antes de acabarem os palpites — ou o tempo.",
    pop: "Cada cidade chutada vira o centro de um círculo que cresce até somar a população alvo. Escolha bem para cobrir o máximo da região.",
    faixas: "O mapa é dividido em faixas e você precisa nomear as maiores cidades de cada uma. Faixa completa muda de cor no mapa.",
    topn: "O modo raiz: cite de memória as N maiores cidades da região. Cada acerto acende a cidade no mapa e mostra a posição no ranking.",
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

  // Lê o limite da partida (nº de palpites ou tempo) dos modos de círculos,
  // gravando o campo escolhido em cfg. A parte de chave preserva o formato
  // antigo ("|palpites=N") para não invalidar recordes já salvos.
  function lerLimite(prefixo, cfg) {
    if ($("cfg-" + prefixo + "-limite").value === "tempo") {
      cfg.tempoMin = num("cfg-" + prefixo + "-tempo", 1, 240);
      return { chave: "|tempo=" + cfg.tempoMin, rotulo: cfg.tempoMin + " min (palpites ilimitados)" };
    }
    cfg.palpites = num("cfg-" + prefixo + "-palpites", 1, 100);
    return { chave: "|palpites=" + cfg.palpites, rotulo: cfg.palpites + " palpites" };
  }

  // Lê e valida a configuração do modo atual. Devolve {cfg, chave, rotulo}
  // ou {erro} (ex.: centro dos anéis não reconhecido). A UF da região entra
  // sempre no fim da chave ("|uf=SP"; Brasil inteiro fica sem sufixo, como
  // nas chaves antigas).
  function lerConfig() {
    var uf = ufDoJogo();
    var sufChave = uf ? "|uf=" + uf : "";
    var sufRotulo = uf ? " · só " + NOMES_UF[uf] : "";
    if (modoAtual === "dist") {
      var cfgD = {
        raio: num("cfg-dist-raio", 10, 2000),
        metrica: $("cfg-dist-metrica").value,
        homonimos: $("cfg-dist-homonimos").checked,
        uf: uf || undefined,
      };
      var limD = lerLimite("dist", cfgD);
      return {
        cfg: cfgD,
        chave: "dist|raio=" + cfgD.raio + limD.chave + "|metrica=" + cfgD.metrica +
          (cfgD.homonimos ? "|homonimos=1" : "") + sufChave,
        rotulo: "Círculos por distância · raio " + cfgD.raio + " km · " + limD.rotulo +
          " · objetivo: " + (cfgD.metrica === "pop" ? "população" : "nº de cidades") +
          (cfgD.homonimos ? " · homônimas juntas" : "") + sufRotulo,
      };
    }
    if (modoAtual === "pop") {
      var cfgP = {
        popAlvo: num("cfg-pop-alvo", 10000, 100000000),
        homonimos: $("cfg-pop-homonimos").checked,
        uf: uf || undefined,
      };
      var limP = lerLimite("pop", cfgP);
      return {
        cfg: cfgP,
        chave: "pop|alvo=" + cfgP.popAlvo + limP.chave +
          (cfgP.homonimos ? "|homonimos=1" : "") + sufChave,
        rotulo: "Círculos por população · " + fmtInt(cfgP.popAlvo) + " hab. por círculo · " +
          limP.rotulo + (cfgP.homonimos ? " · homônimas juntas" : "") + sufRotulo,
      };
    }
    if (modoAtual === "topn") {
      var cfgT = {
        n: num("cfg-topn-n", 5, 500),
        uf: uf || undefined,
      };
      var chaveT = "topn|n=" + cfgT.n;
      var rotuloT = "As " + cfgT.n + " maiores cidades";
      if ($("cfg-topn-limite").value === "tempo") {
        cfgT.tempoMin = num("cfg-topn-tempo", 1, 240);
        chaveT += "|tempo=" + cfgT.tempoMin;
        rotuloT += " · contra o relógio: " + cfgT.tempoMin + " min";
      }
      return { cfg: cfgT, chave: chaveT + sufChave, rotulo: rotuloT + sufRotulo };
    }
    var cfgF = {
      tipo: $("cfg-faixas-tipo").value,
      largura: num("cfg-faixas-largura", 50, 2000),
      topN: num("cfg-faixas-topn", 1, 10),
      uf: uf || undefined,
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
    if ($("cfg-faixas-limite").value === "tempo") {
      cfgF.tempoMin = num("cfg-faixas-tempo", 1, 240);
      chave += "|tempo=" + cfgF.tempoMin;
      rotulo += " · contra o relógio: " + cfgF.tempoMin + " min";
    }
    return { cfg: cfgF, chave: chave + sufChave, rotulo: rotulo + sufRotulo };
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
    else if (modoAtual === "topn") jogo = new MODOS.JogoTopN(lido.cfg);
    else jogo = new MODOS.JogoFaixas(lido.cfg);
    aplicarRegiao(jogo.cfg.uf || null);
    enquadrarUniverso(jogo);

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
    } else if (jogoModo === "topn") {
      montarListaTopN(jogo);
    }
    limiteSeg = jogo.cfg.tempoMin ? jogo.cfg.tempoMin * 60 : null;
    inicioMs = Date.now();
    atualizarPlacar();

    clearInterval(timerInt);
    timerInt = setInterval(tique, 1000);
    $("input-palpite").focus();
  }

  function tique() {
    if (jogo && !jogo.encerrado && limiteSeg !== null && tempoDecorrido() >= limiteSeg) {
      fimDeJogo(true, true);
      return;
    }
    atualizarPlacar();
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
        fmtInt(jogo.universo.length) + " (<b>" + fmtPct(pct) + "</b>)");
      linhas.push("População coberta: <b>" + fmtPop(jogo.popCoberta) + "</b>");
    } else if (jogoModo === "dist" || jogoModo === "pop") {
      linhas.push("População coberta: <b>" + fmtPop(jogo.popCoberta) + "</b> de " +
        fmtPop(jogo.uniPop) + " (<b>" + fmtPct(pct) + "</b>)");
      linhas.push("Cidades cobertas: <b>" + fmtInt(jogo.cobertos.size) + "</b>");
    } else if (jogoModo === "faixas") {
      linhas.push("Respostas certas: <b>" + jogo.achadosTotal + "</b> de " + jogo.alvosTotal +
        " (<b>" + fmtPct(pct) + "</b>) · " + jogo.faixas.length + " faixas");
    } else {
      linhas.push("Cidades achadas: <b>" + jogo.achadosTotal + "</b> de " + jogo.alvosTotal +
        " (<b>" + fmtPct(pct) + "</b>)");
    }
    if ((jogoModo === "dist" || jogoModo === "pop") && jogo.cfg.palpites) {
      linhas.push("Palpites restantes: <b>" + jogo.palpitesRestantes() + "</b> de " + jogo.cfg.palpites);
    }
    if (limiteSeg !== null) {
      var restante = Math.max(0, limiteSeg - tempoDecorrido());
      linhas.push("⏱️ Tempo restante: <b>" + fmtTempo(restante) + "</b> de " + fmtTempo(limiteSeg));
    } else {
      linhas.push("Tempo: <b>" + fmtTempo(tempoDecorrido()) + "</b>");
    }
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
    if (jogoModo === "faixas" || jogoModo === "topn") return palpitarAlvos(texto);

    var res = DADOS.buscar(texto);
    if (res.status === "vazio") return;
    if (res.status === "nao_encontrado") {
      feedback(res.ufErrada
        ? "Esse município existe, mas não nessa UF."
        : "Não encontrei nenhum município com esse nome.", "erro");
      return;
    }
    var muns = res.municipios;
    if (jogo.cfg.uf) {
      muns = muns.filter(function (m) { return m.uf === jogo.cfg.uf; });
      if (muns.length === 0) {
        feedback(res.municipios[0].nome + " fica fora da região do jogo (só " +
          NOMES_UF[jogo.cfg.uf] + ").", "erro");
        return;
      }
    }
    if (muns.length > 1 && !jogo.cfg.homonimos) {
      var ufs = muns.map(function (m) { return m.uf; }).join(", ");
      feedback("Há " + muns.length + " municípios com esse nome (" + ufs +
        "). Especifique: " + muns[0].nome + ", UF.", "erro");
      return;
    }
    // com a opção de homônimas ligada, um nome ambíguo entra inteiro:
    // todas as cidades daquele nome, num palpite só
    var r = jogo.palpitar(muns);
    if (r.tipo === "repetido") {
      feedback(muns.length > 1
        ? "Você já usou todas as cidades chamadas " + muns[0].nome + "."
        : "Você já usou " + nomeUF(muns[0]) + ".", "erro");
      return;
    }
    if (r.tipo !== "ok") return;

    var j = r.jogada;
    j.circulos.forEach(function (c) {
      elSvg("path", { d: caminhoGeodesico(c.mun.lat, c.mun.lng, c.raioKm), "class": "circulo-cobertura" }, gCirculos);
    });
    j.novos.forEach(function (idx) { pontos[idx].classList.add("coberta"); });
    j.circulos.forEach(function (c) {
      pontos[c.mun.idx].setAttribute("class", "cidade centro-palpite");
      elSvg("text", {
        x: proj.x(c.mun.lng).toFixed(1),
        y: proj.y(c.mun.lat).toFixed(1),
        "class": "rotulo-cidade centro-palpite",
      }, gMarcas).textContent = c.mun.nome;
    });

    var nome = j.muns.length === 1
      ? nomeUF(j.muns[0])
      : j.muns[0].nome + " ×" + j.muns.length + " (" +
        j.muns.map(function (m) { return m.uf; }).join(", ") + ")";
    var ordem = jogo.jogadas.length;
    var detalhe = jogoModo === "pop" && j.circulos.length === 1
      ? "raio " + Math.round(j.circulos[0].raioKm) + " km · +" + fmtPop(j.ganhoPop) + " hab. novos · +" + fmtInt(j.novos.length) + " cidades"
      : "+" + fmtPop(j.ganhoPop) + " hab. · +" + fmtInt(j.novos.length) + " cidades";
    var item = document.createElement("div");
    item.className = "item-jogada";
    item.innerHTML = "<b>" + ordem + ". " + nome + "</b><br><small>" + detalhe + "</small>";
    $("lista-jogo").prepend(item);

    feedback("✔ " + nome + " — " + detalhe, "ok");
    $("input-palpite").value = "";
    atualizarPlacar();
    if (jogo.encerrado) fimDeJogo(false);
  }

  // Palpites dos modos de alvos nomeados (faixas e Top N), cujos motores
  // fazem a própria busca e devolvem os alvos revelados.
  function palpitarAlvos(texto) {
    var r = jogo.palpitar(texto);
    if (r.tipo === "vazio") return;
    if (r.tipo === "nao_encontrado") {
      feedback(r.ufErrada
        ? "Esse município existe, mas não nessa UF."
        : "Não encontrei nenhum município com esse nome.", "erro");
      return;
    }
    if (r.tipo === "fora_regiao") {
      feedback(r.municipios[0].nome + " fica fora da região do jogo (só " +
        NOMES_UF[jogo.cfg.uf] + ").", "erro");
      return;
    }
    if (r.tipo === "nao_alvo") {
      var naoAlvo = jogoModo === "topn"
        ? " não está entre as " + jogo.alvosTotal + " maiores."
        : " não está entre as respostas.";
      feedback(r.municipios.length === 1
        ? nomeUF(r.municipios[0]) + naoAlvo
        : "Nenhum dos municípios chamados " + r.municipios[0].nome + naoAlvo, "erro");
      $("input-palpite").select();
      return;
    }
    r.revelados.forEach(function (par) {
      revelarAlvo(par.mun, par.faixa || null, false, par.rank);
    });
    var nomes = r.revelados.map(function (par) {
      return par.rank !== undefined
        ? par.rank + "º — " + nomeUF(par.mun) + " · " + fmtPop(par.mun.pop) + " hab."
        : nomeUF(par.mun) + " — faixa " + par.faixa.rotulo;
    });
    feedback("✔ " + nomes.join(" · "), "ok");
    $("input-palpite").value = "";
    atualizarPlacar();
    if (r.completo) fimDeJogo(false);
  }

  function revelarAlvo(mun, faixa, faltante, rank) {
    pontos[mun.idx].setAttribute("class", "cidade " + (faltante ? "faltante" : "achada"));
    elSvg("text", {
      x: proj.x(mun.lng).toFixed(1),
      y: proj.y(mun.lat).toFixed(1),
      "class": "rotulo-cidade" + (faltante ? " faltante" : ""),
    }, gMarcas).textContent = mun.nome;
    if (faixa) {
      if (faixa._elContador) {
        faixa._elContador.textContent = faixa.achados.size + "/" + faixa.alvos.length;
      }
      atualizarItemFaixa(faixa);
      // faixa 100% respondida muda de cor no mapa
      if (!faltante && faixa.achados.size === faixa.alvos.length) {
        if (faixa._elArea) faixa._elArea.setAttribute("visibility", "visible");
        if (faixa._elContador) faixa._elContador.classList.add("completa");
      }
    }
    if (rank !== undefined) atualizarChipTopN(rank, mun, faltante);
  }

  function fimDeJogo(desistiu, porTempo) {
    clearInterval(timerInt);
    var tempoSeg = tempoDecorrido();
    if (limiteSeg !== null && tempoSeg > limiteSeg) tempoSeg = limiteSeg;
    var faltantes = null;
    if (jogoModo === "faixas" || jogoModo === "topn") {
      faltantes = jogo.encerrar();
      if (desistiu) {
        faltantes.forEach(function (par) {
          revelarAlvo(par.mun, par.faixa || null, true, par.rank);
        });
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
    } else if (jogoModo === "topn") {
      placar = jogo.achadosTotal + "/" + jogo.alvosTotal + " cidades";
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
    el.innerHTML = (porTempo ? "⏰ <b>Tempo esgotado!</b>" : "<b>Fim de jogo!</b>") +
      " Resultado: <b>" + fmtPct(pct) + "</b> (" + placar +
      ") em " + fmtTempo(tempoSeg) + ".<br>" +
      (res.melhor
        ? "🎉 <b>Novo recorde pessoal nesta configuração!</b>"
        : "Seu recorde nesta configuração segue " + fmtPct(res.recorde.pct) +
          " (" + res.recorde.placar + ", " + fmtTempo(res.recorde.tempoSeg) + ").") +
      relatorioFinal(faltantes);
    atualizarRecordeUI();
  }

  // Relatório pós-partida: o que de maior ficou de fora.
  function relatorioFinal(faltantes) {
    var itens;
    if (jogoModo === "dist" || jogoModo === "pop") {
      var fora = [];
      for (var i = 0; i < jogo.universo.length && fora.length < 5; i++) {
        var m = jogo.universo[i];
        if (!jogo.cobertos.has(m.idx)) fora.push(m);
      }
      if (fora.length === 0) return "";
      itens = fora.map(function (m) { return nomeUF(m) + " — " + fmtPop(m.pop); });
      return "<div class='relatorio'>Ficou na mesa: <b>" +
        fmtPop(jogo.uniPop - jogo.popCoberta) + " hab.</b> em " +
        fmtInt(jogo.universo.length - jogo.cobertos.size) + " cidades.<br>" +
        "Maiores esquecidas: " + itens.join(" · ") + ".</div>";
    }
    if (!faltantes || faltantes.length === 0) return "";
    if (jogoModo === "topn") {
      itens = faltantes.slice(0, 5).map(function (par) {
        return par.rank + "º " + nomeUF(par.mun);
      });
      return "<div class='relatorio'>Maiores que faltaram: " + itens.join(" · ") +
        (faltantes.length > 5 ? " · e mais " + (faltantes.length - 5) : "") + ".</div>";
    }
    var maiores = faltantes.slice().sort(function (a, b) { return b.mun.pop - a.mun.pop; });
    itens = maiores.slice(0, 5).map(function (par) {
      return nomeUF(par.mun) + " — " + fmtPop(par.mun.pop);
    });
    return "<div class='relatorio'>Maiores respostas perdidas: " + itens.join(" · ") +
      (faltantes.length > 5 ? " · e mais " + (faltantes.length - 5) : "") + ".</div>";
  }

  // ---------------- desenho e lista das faixas ----------------
  function desenharFaixas(jogo) {
    var cfg = jogo.cfg;
    // recorta sombras e linhas na área do universo (importa quando a região é
    // uma UF só; no Brasil inteiro equivale aos limites do mapa)
    var ext = extentDe(jogo.universo, 0.4);
    var exX1 = proj.x(ext.lngMin), exX2 = proj.x(ext.lngMax);
    var exY1 = proj.y(ext.latMax), exY2 = proj.y(ext.latMin);
    jogo.faixas.forEach(function (f) {
      var cx, cy;
      if (cfg.tipo === "lat") {
        var y1 = proj.y(Math.min(f.latSup, ext.latMax));
        var y2 = proj.y(Math.max(f.latInf, ext.latMin));
        if (f.indice % 2 === 0) {
          elSvg("rect", { x: exX1.toFixed(1), y: y1.toFixed(1), width: (exX2 - exX1).toFixed(1), height: (y2 - y1).toFixed(1), "class": "faixa-sombra" }, gFaixas);
        }
        f._elArea = elSvg("rect", { x: exX1.toFixed(1), y: y1.toFixed(1), width: (exX2 - exX1).toFixed(1), height: (y2 - y1).toFixed(1), "class": "faixa-completa", visibility: "hidden" }, gFaixas);
        elSvg("line", { x1: exX1.toFixed(1), y1: y2.toFixed(1), x2: exX2.toFixed(1), y2: y2.toFixed(1), "class": "linha-faixa" }, gFaixas);
        cx = exX1 + 8; cy = (y1 + y2) / 2 + 4;
      } else if (cfg.tipo === "lng") {
        var x1 = proj.x(Math.max(f.lngOeste, ext.lngMin));
        var x2 = proj.x(Math.min(f.lngLeste, ext.lngMax));
        if (f.indice % 2 === 0) {
          elSvg("rect", { x: x1.toFixed(1), y: exY1.toFixed(1), width: (x2 - x1).toFixed(1), height: (exY2 - exY1).toFixed(1), "class": "faixa-sombra" }, gFaixas);
        }
        f._elArea = elSvg("rect", { x: x1.toFixed(1), y: exY1.toFixed(1), width: (x2 - x1).toFixed(1), height: (exY2 - exY1).toFixed(1), "class": "faixa-completa", visibility: "hidden" }, gFaixas);
        elSvg("line", { x1: x2.toFixed(1), y1: exY1.toFixed(1), x2: x2.toFixed(1), y2: exY2.toFixed(1), "class": "linha-faixa" }, gFaixas);
        cx = (x1 + x2) / 2 - 8; cy = exY1 + 14;
      } else {
        // anel: a área de completa é a coroa entre os dois raios (fill-rule
        // evenodd faz o círculo interno virar buraco)
        var dAnel = caminhoGeodesico(cfg.centro.lat, cfg.centro.lng, f.kmExterno) +
          (f.kmInterno > 0 ? caminhoGeodesico(cfg.centro.lat, cfg.centro.lng, f.kmInterno) : "");
        f._elArea = elSvg("path", { d: dAnel, "fill-rule": "evenodd", "class": "faixa-completa", visibility: "hidden" }, gFaixas);
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
    item.className = "item-faixa" +
      (f.alvos.length > 0 && f.achados.size === f.alvos.length ? " completa" : "");
    item.innerHTML = '<div class="titulo-faixa"><span>' + f.rotulo + "</span><span>" +
      f.achados.size + "/" + f.alvos.length + "</span></div><div class='chips'>" + chips + "</div>";
  }

  // ---------------- lista do modo Top N ----------------
  function montarListaTopN(jogo) {
    var alvo = $("lista-jogo");
    alvo.innerHTML = "";
    var item = document.createElement("div");
    item.className = "item-faixa";
    var chips = jogo.alvos.map(function (m, i) {
      return '<span class="chip" data-rank="' + (i + 1) + '">' + (i + 1) + " •••</span>";
    }).join("");
    item.innerHTML = "<div class='titulo-faixa'><span>As " + jogo.alvosTotal +
      " maiores</span><span id='topn-contador'>0/" + jogo.alvosTotal +
      "</span></div><div class='chips'>" + chips + "</div>";
    alvo.appendChild(item);
    topnChips = {};
    item.querySelectorAll(".chip").forEach(function (c) {
      topnChips[c.dataset.rank] = c;
    });
  }

  function atualizarChipTopN(rank, mun, faltante) {
    var chip = topnChips && topnChips[rank];
    if (!chip) return;
    chip.textContent = rank + ". " + nomeUF(mun);
    chip.className = "chip " + (faltante ? "faltante" : "achado");
    var cont = document.getElementById("topn-contador");
    if (cont) cont.textContent = jogo.achadosTotal + "/" + jogo.alvosTotal;
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
  // Desafio por link: a chave de recorde já é a serialização canônica da
  // configuração, então o link carrega a chave (e o recorde de quem enviou
  // como marca a bater).
  // ------------------------------------------------------------------
  function copiarDesafio() {
    var lido = lerConfig();
    if (lido.erro) {
      atualizarRecordeUI();
      return;
    }
    var url = location.href.split("#")[0] + "#d=" + encodeURIComponent(lido.chave);
    var rec = RECORDES.obter(lido.chave);
    if (rec) url += "&rec=" + (Math.round(rec.pct * 1000) / 10);
    var btn = $("btn-desafio");
    function avisar() {
      btn.textContent = "✔ Link copiado!";
      setTimeout(function () { btn.textContent = "🔗 Desafiar"; }, 2500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(avisar, function () { prompt("Copie o link do desafio:", url); });
    } else {
      prompt("Copie o link do desafio:", url);
    }
  }

  function aplicarDesafioDaURL() {
    if (location.hash.indexOf("#d=") !== 0) return;
    var partes = location.hash.slice(3).split("&");
    var chave = decodeURIComponent(partes[0]);
    var recAlvo = null;
    partes.slice(1).forEach(function (p) {
      if (p.indexOf("rec=") === 0) recAlvo = parseFloat(p.slice(4));
    });
    var tokens = chave.split("|");
    var modo = tokens[0];
    if (!DESCRICOES[modo]) return;
    var p = {};
    tokens.slice(1).forEach(function (t) {
      var i = t.indexOf("=");
      if (i > 0) p[t.slice(0, i)] = t.slice(i + 1);
    });
    function setVal(id, v) { if (v !== undefined) $(id).value = v; }
    $("cfg-regiao").value = p.uf && NOMES_UF[p.uf] ? p.uf : "BR";
    if (modo === "dist" || modo === "pop") {
      if (modo === "dist") {
        setVal("cfg-dist-raio", p.raio);
        if (p.metrica) $("cfg-dist-metrica").value = p.metrica;
      } else {
        setVal("cfg-pop-alvo", p.alvo);
      }
      $("cfg-" + modo + "-homonimos").checked = p.homonimos === "1";
      $("cfg-" + modo + "-limite").value = p.tempo ? "tempo" : "palpites";
      setVal("cfg-" + modo + "-tempo", p.tempo);
      setVal("cfg-" + modo + "-palpites", p.palpites);
    } else if (modo === "faixas") {
      if (p.tipo) $("cfg-faixas-tipo").value = p.tipo;
      $("rotulo-centro").hidden = $("cfg-faixas-tipo").value !== "aneis";
      setVal("cfg-faixas-largura", p.largura);
      setVal("cfg-faixas-topn", p.top);
      if (p.centro) {
        var centro = null;
        DADOS.municipios.forEach(function (m) {
          if (String(m.id) === p.centro) centro = m;
        });
        if (centro) $("cfg-faixas-centro").value = centro.nome + ", " + centro.uf;
      }
      $("cfg-faixas-limite").value = p.tempo ? "tempo" : "livre";
      setVal("cfg-faixas-tempo", p.tempo);
    } else {
      setVal("cfg-topn-n", p.n);
      $("cfg-topn-limite").value = p.tempo ? "tempo" : "livre";
      setVal("cfg-topn-tempo", p.tempo);
    }
    atualizarCamposLimite();
    document.querySelector('#abas-modo .aba[data-modo="' + modo + '"]').click();
    var lido = lerConfig();
    if (lido.erro) return;
    var banner = $("desafio-banner");
    banner.hidden = false;
    banner.innerHTML = "🎯 <b>Desafio recebido:</b> " + lido.rotulo + ".<br>" +
      (recAlvo !== null && !isNaN(recAlvo)
        ? "Marca a bater: <b>" +
          recAlvo.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%</b> — "
        : "") + "aperte ▶ Iniciar jogo e boa sorte!";
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
      vb = { x: vbBase.x, y: vbBase.y, w: vbBase.w, h: vbBase.h };
      aplicarViewBox();
      setConfigTravada(false);
      $("btn-iniciar").textContent = "▶ Iniciar jogo";
      atualizarRecordeUI();
    });
  });

  $("cfg-faixas-tipo").addEventListener("change", function () {
    $("rotulo-centro").hidden = $("cfg-faixas-tipo").value !== "aneis";
  });
  function atualizarCamposLimite() {
    ["dist", "pop"].forEach(function (p) {
      var porTempo = $("cfg-" + p + "-limite").value === "tempo";
      $("rotulo-" + p + "-palpites").hidden = porTempo;
      $("rotulo-" + p + "-tempo").hidden = !porTempo;
    });
    $("rotulo-faixas-tempo").hidden = $("cfg-faixas-limite").value !== "tempo";
    $("rotulo-topn-tempo").hidden = $("cfg-topn-limite").value !== "tempo";
  }
  document.querySelectorAll(".sel-limite").forEach(function (s) {
    s.addEventListener("change", atualizarCamposLimite);
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

  $("btn-satelite").addEventListener("click", function () {
    setSatelite(!svg.classList.contains("satelite"));
  });

  $("btn-desafio").addEventListener("click", copiarDesafio);

  $("btn-exportar-recordes").addEventListener("click", function () {
    var blob = new Blob([RECORDES.exportarJson()], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mapa-quiz-recordes.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("btn-importar-recordes").addEventListener("click", function () {
    $("arquivo-recordes").click();
  });
  $("arquivo-recordes").addEventListener("change", function () {
    var arq = this.files[0];
    this.value = "";
    if (!arq) return;
    var leitor = new FileReader();
    leitor.onload = function () {
      var r = RECORDES.importarJson(leitor.result);
      var nota = $("nota-import");
      nota.hidden = false;
      nota.textContent = r.ok ? "✔ " + r.msg : "⚠️ " + r.msg;
      nota.style.color = r.ok ? "" : "var(--vermelho)";
      abrirRecordes();
      atualizarRecordeUI();
    };
    leitor.readAsText(arq);
  });

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
  atualizarCamposLimite();
  atualizarRecordeUI();
  aplicarDesafioDaURL();
  // um link de desafio colado na aba já aberta também vale
  window.addEventListener("hashchange", aplicarDesafioDaURL);
  try {
    if (localStorage.getItem(LS_SATELITE) === "1") setSatelite(true);
  } catch (e) {}
})();
