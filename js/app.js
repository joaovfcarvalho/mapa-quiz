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
  // fração visível máxima em que os rótulos das faixas ainda cabem no espaço
  // de cada faixa/célula (calculada em desenharFaixas)
  var zoomMaxRotulos = Infinity;
  function atualizarRotulosFaixas() {
    svg.classList.toggle("sem-rotulos-faixa", vb.w / vbBase.w > zoomMaxRotulos);
  }
  function aplicarViewBox() {
    svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
    // fração do mapa visível — o CSS multiplica traços, pontos e letras por
    // esse fator para que fiquem sempre com o mesmo tamanho na tela
    svg.style.setProperty("--zoom", (vb.w / vbBase.w).toFixed(4));
    atualizarRotulosFaixas();
  }
  aplicarViewBox();

  // O <svg> estica para preencher o painel, mas o conteúdo do viewBox é
  // encaixado com escala uniforme e centralizado (preserveAspectRatio padrão,
  // "xMidYMid meet"), deixando sobras vazias num dos eixos. Toda conversão
  // tela -> mapa precisa descontar essas sobras, senão o ponto desliza em
  // direção ao centro — pior perto das bordas.
  function medidaMapa() {
    var rect = svg.getBoundingClientRect();
    var escala = Math.min(rect.width / vb.w, rect.height / vb.h);
    return {
      escala: escala,
      x0: rect.left + (rect.width - vb.w * escala) / 2,
      y0: rect.top + (rect.height - vb.h * escala) / 2,
    };
  }
  // pixel da tela (clientX/Y) -> coordenadas do viewBox do mapa
  function pontoDoMapa(clientX, clientY) {
    var m = medidaMapa();
    return {
      x: vb.x + (clientX - m.x0) / m.escala,
      y: vb.y + (clientY - m.y0) / m.escala,
    };
  }

  function elSvg(tag, attrs, pai) {
    var e = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    (pai || svg).appendChild(e);
    return e;
  }

  var gEstados = elSvg("g", {});
  var gFaixas = elSvg("g", {});
  var gMalha = elSvg("g", { visibility: "hidden" }); // formas dos municípios (botão ⬡)
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

  // pontos ainda não descobertos: esmaecidos (padrão) ou ocultos de vez
  var LS_PONTOS = "mapaquiz.pontos";
  function setPontosOcultos(ocultos) {
    svg.classList.toggle("sem-pontos", ocultos);
    $("btn-pontos").classList.toggle("ativo", ocultos);
    $("btn-pontos").title = ocultos
      ? "Pontos não descobertos estão ocultos — clique para mostrá-los esmaecidos"
      : "Pontos não descobertos aparecem esmaecidos — clique para ocultá-los";
    try { localStorage.setItem(LS_PONTOS, ocultos ? "1" : "0"); } catch (e) {}
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

  // ------------------------------------------------------------------
  // Forma dos municípios (botão ⬡ Formas): cada município marcado ganha,
  // além do ponto da sede, o polígono do território. A malha (~2,4 MB) só é
  // carregada na primeira vez que o botão for ligado — quem não usa não paga.
  var LS_FORMAS = "mapaquiz.formas";
  var formasLigadas = false;
  var malhaPedida = false;
  var formas = []; // idx -> <path>, criado na primeira vez que o município é marcado
  var MARCA_FORMA = /\b(coberta|centro-palpite|achada|faltante)\b/;

  function dMunicipio(id) {
    var aneis = window.MALHA_MUNICIPIOS && MALHA_MUNICIPIOS[id];
    if (!aneis) return null; // sem forma na malha (ex.: município criado depois de 2022)
    return aneis.map(function (anel) {
      return anel.map(function (p, i) {
        return (i === 0 ? "M" : "L") + proj.x(p[0]).toFixed(1) + " " + proj.y(p[1]).toFixed(1);
      }).join("") + "Z";
    }).join("");
  }

  // Espelha no polígono o estado atual do ponto: mesmas classes de marcação e
  // mesma cor inline (população ou distância) — uma única fonte de verdade.
  function sincronizarForma(mun) {
    if (!formasLigadas || !window.MALHA_MUNICIPIOS) return;
    var p = pontos[mun.idx];
    var classe = p.getAttribute("class");
    var f = formas[mun.idx];
    if (!MARCA_FORMA.test(classe)) {
      if (f) { f.setAttribute("class", "municipio"); f.style.fill = ""; }
      return;
    }
    if (!f) {
      var d = dMunicipio(mun.id);
      if (!d) return; // fica só o ponto
      f = formas[mun.idx] = elSvg("path", { d: d, "fill-rule": "evenodd", "data-idx": mun.idx }, gMalha);
    }
    f.setAttribute("class", classe.replace("cidade", "municipio"));
    f.style.fill = p.style.fill;
  }
  function sincronizarFormas() {
    if (!formasLigadas || !window.MALHA_MUNICIPIOS) return;
    DADOS.municipios.forEach(sincronizarForma);
  }

  function setFormas(ligado) {
    formasLigadas = ligado;
    gMalha.setAttribute("visibility", ligado ? "visible" : "hidden");
    $("btn-formas").classList.toggle("ativo", ligado);
    try { localStorage.setItem(LS_FORMAS, ligado ? "1" : "0"); } catch (e) {}
    if (!ligado) return;
    if (window.MALHA_MUNICIPIOS) { sincronizarFormas(); return; }
    if (malhaPedida) return;
    malhaPedida = true;
    var s = document.createElement("script");
    s.src = "data/malha_municipios.js";
    s.onload = sincronizarFormas;
    s.onerror = function () {
      s.remove();
      malhaPedida = false;
      setFormas(false);
      alert("Não deu para carregar a forma dos municípios (~2,4 MB) — é preciso internet na primeira vez.");
    };
    document.head.appendChild(s);
  }

  function caminhoGeodesico(lat, lng, raioKm) {
    var pts = GEO.circuloGeodesico(lat, lng, raioKm);
    return pts.map(function (p, i) {
      return (i === 0 ? "M" : "L") + proj.x(p[1]).toFixed(1) + " " + proj.y(p[0]).toFixed(1);
    }).join("") + "Z";
  }

  // Cor do ponto pela população (escala log de 1 mil a ~11,5 mi = São Paulo):
  // amarelo → laranja → vinho. Os mesmos tons estão na legenda (CSS).
  var COR_POP = [[245, 208, 76], [238, 108, 47], [122, 16, 32]];
  function corPop(pop) {
    var t = (Math.log(Math.max(pop, 1000)) / Math.LN10 - 3) / (7.06 - 3);
    t = Math.max(0, Math.min(1, t)) * (COR_POP.length - 1);
    var i = Math.min(COR_POP.length - 2, Math.floor(t));
    var f = t - i;
    var a = COR_POP[i], b = COR_POP[i + 1];
    return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * f) + "," +
      Math.round(a[1] + (b[1] - a[1]) * f) + "," +
      Math.round(a[2] + (b[2] - a[2]) * f) + ")";
  }
  function pintarPonto(mun, classe) {
    var p = pontos[mun.idx];
    p.setAttribute("class", "cidade " + classe);
    p.style.fill = corPop(mun.pop);
    sincronizarForma(mun);
  }

  // Cor do palpite no "Onde estou?" pela distância até o secreto: azul
  // (longe) → amarelo → vermelho (perto). Mesmos tons da legenda (CSS).
  var COR_DIST = [[86, 119, 194], [245, 208, 76], [206, 32, 41]];
  function corDist(distKm) {
    var t = (1 - Math.min(distKm, 1500) / 1500) * (COR_DIST.length - 1);
    var i = Math.min(COR_DIST.length - 2, Math.floor(t));
    var f = t - i;
    var a = COR_DIST[i], b = COR_DIST[i + 1];
    return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * f) + "," +
      Math.round(a[1] + (b[1] - a[1]) * f) + "," +
      Math.round(a[2] + (b[2] - a[2]) * f) + ")";
  }

  // ------------------------------------------------------------------
  // Contagem local de municípios já citados (alimenta a página de
  // estatísticas "pontos cegos"): id do IBGE -> nº de partidas em que a
  // cidade foi citada. Cada cidade conta no máximo uma vez por partida.
  // ------------------------------------------------------------------
  var LS_CITADAS = "mapaquiz.citadas.v1";
  var tallyCitadas = null;
  var citadasPartida = new Set();
  function registrarCitadas(muns) {
    if (tallyCitadas === null) {
      try { tallyCitadas = JSON.parse(localStorage.getItem(LS_CITADAS)) || {}; }
      catch (e) { tallyCitadas = {}; }
    }
    var mudou = false;
    muns.forEach(function (m) {
      if (citadasPartida.has(m.idx)) return;
      citadasPartida.add(m.idx);
      tallyCitadas[m.id] = (tallyCitadas[m.id] || 0) + 1;
      mudou = true;
    });
    if (mudou) {
      try { localStorage.setItem(LS_CITADAS, JSON.stringify(tallyCitadas)); } catch (e) {}
    }
  }

  // ------------------------------------------------------------------
  // Progresso da maratona por região ("BR" ou sigla da UF)
  // ------------------------------------------------------------------
  var LS_MARATONA = "mapaquiz.maratona.v1";
  function lerMaratonas() {
    try { return JSON.parse(localStorage.getItem(LS_MARATONA)) || {}; }
    catch (e) { return {}; }
  }
  function carregarMaratona(regiao) {
    return lerMaratonas()[regiao] || null;
  }
  function salvarMaratona(regiao, dados) {
    var tudo = lerMaratonas();
    tudo[regiao] = dados;
    try { localStorage.setItem(LS_MARATONA, JSON.stringify(tudo)); } catch (e) {}
  }
  function zerarMaratona(regiao) {
    var tudo = lerMaratonas();
    delete tudo[regiao];
    try { localStorage.setItem(LS_MARATONA, JSON.stringify(tudo)); } catch (e) {}
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
  function fmtArea(km2) {
    if (km2 >= 1e6) return (km2 / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi km²";
    if (km2 >= 1e3) return Math.round(km2 / 1e3).toLocaleString("pt-BR") + " mil km²";
    return Math.round(km2).toLocaleString("pt-BR") + " km²";
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

  // aproxima o mapa da região da partida (ou volta ao Brasil inteiro); no
  // Cerco o enquadramento é a vizinhança do alvo, não a UF
  function enquadrarUniverso(jogo) {
    if (jogoModo === "cerco") {
      enquadrarLista([jogo.alvo].concat(jogo.alvos));
      return;
    }
    if (!jogo.cfg.uf) {
      vb = { x: vbBase.x, y: vbBase.y, w: vbBase.w, h: vbBase.h };
      aplicarViewBox();
      return;
    }
    enquadrarLista(jogo.universo);
  }
  function enquadrarLista(lista) {
    var e = extentDe(lista, 0.35);
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
  var dicasUsadas = 0;      // dicas pedidas na partida (faixas/topn: −1 acerto cada)
  var maratonaContadores = null; // contadores da lista lateral da maratona
  var maratonaTop = null;        // uf -> {idxs, total, achados} das 10 maiores
  var maratonaDetalheUF = null;  // UF cujo detalhe (maior que falta) está aberto
  var recentes = [];        // idx dos municípios do último acerto da maratona
  var rotulosRecentes = []; // rótulos <text> desses acertos (somem no próximo)
  var cliqueInicio = null;  // posição do mousedown para distinguir clique de arrasto

  var DESCRICOES = {
    dist: "Chute cidades: cada palpite cobre todos os municípios num raio fixo. Cubra o máximo da região antes de acabarem os palpites — ou o tempo.",
    pop: "Cada cidade chutada vira o centro de um círculo que cresce até somar a população alvo. Escolha bem para cobrir o máximo da região.",
    faixas: "O mapa é dividido em faixas (ou numa grade de quadrados) e você precisa nomear as maiores cidades de cada uma. A cor da faixa vai se intensificando conforme você acerta.",
    topn: "O modo raiz: cite de memória as N maiores cidades da região. Cada acerto acende a cidade no mapa e mostra a posição no ranking.",
    ondestou: "O jogo sorteia um município secreto e cada palpite responde com a distância e a direção até ele. Encontre-o no menor número de palpites — a cor dos pontos esquenta conforme você chega perto.",
    clique: "O jogo mostra o nome de um município e você clica no mapa onde acha que ele fica. Até 15 km de erro vale 100%; a pontuação cai até zerar em 500 km.",
    maratona: "O desafio definitivo: cite todos os municípios da região, no seu ritmo. O progresso e o tempo ficam salvos neste navegador — pause e continue quando quiser.",
    caminho: "Viagem por divisas: saia da origem e chegue ao destino citando sempre um município que faz divisa com o último. Menos saltos, mais pontos — o jogo compara com o caminho mínimo real.",
    cerco: "Nomeie todos os municípios que fazem divisa com o alvo. Trivial no litoral, brutal no interior.",
    mancha: "Comece por qualquer município e cresça um território contíguo: só vale citar quem faz divisa com a sua mancha.",
    ponte: "Dois municípios sorteados: construa uma corrente de divisas que os conecte. Cada palpite precisa encostar no que já está marcado.",
  };

  // modos que precisam do grafo de divisas (data/vizinhos.js, ~360 KB,
  // carregado sob demanda — quem não joga esses modos não paga nada)
  var MODOS_COM_VIZINHOS = { caminho: 1, cerco: 1, mancha: 1, ponte: 1 };
  var vizinhosCbs = null; // fila de callbacks enquanto o script carrega
  function carregarVizinhos(cb, silencioso) {
    if (window.VIZINHOS) { if (cb) cb(); return; }
    if (vizinhosCbs) { if (cb) vizinhosCbs.push(cb); return; }
    vizinhosCbs = cb ? [cb] : [];
    var s = document.createElement("script");
    s.src = "data/vizinhos.js";
    s.onload = function () {
      var fila = vizinhosCbs;
      vizinhosCbs = null;
      fila.forEach(function (f) { f(); });
    };
    s.onerror = function () {
      s.remove();
      vizinhosCbs = null; // a próxima tentativa recomeça do zero
      if (!silencioso) {
        alert("Não deu para carregar o mapa de divisas (~360 KB) — é preciso internet na primeira vez.");
      }
    };
    document.head.appendChild(s);
  }

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

  // rótulos dos seletores de porte (ondestou, clique, cerco, ponte)
  var NOME_POOL = {
    500000: "500 mil+ hab.", 100000: "100 mil+ hab.", 50000: "50 mil+ hab.",
    20000: "20 mil+ hab.", 0: "qualquer porte",
  };

  // Interpreta um campo de texto que deve conter exatamente um município
  // (origem/destino do caminho, alvo do cerco). Devolve {mun} ou {erro}.
  function lerCidadeCampo(id, rotulo) {
    var res = DADOS.buscar($(id).value);
    if (res.status === "ok") return { mun: res.municipios[0] };
    if (res.status === "ambiguo") {
      return { erro: "Há mais de uma cidade com esse nome para " + rotulo +
        " — especifique a UF (ex.: " + res.municipios[0].nome + ", " + res.municipios[0].uf + ")." };
    }
    return { erro: "Não encontrei a cidade de " + rotulo + ". Confira o nome (ex.: Campinas, SP)." };
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
        bloqueio: $("cfg-dist-bloqueio").checked,
        uf: uf || undefined,
      };
      var limD = lerLimite("dist", cfgD);
      return {
        cfg: cfgD,
        chave: "dist|raio=" + cfgD.raio + limD.chave + "|metrica=" + cfgD.metrica +
          (cfgD.homonimos ? "|homonimos=1" : "") + (cfgD.bloqueio ? "|bloqueio=1" : "") + sufChave,
        rotulo: "Círculos por distância · raio " + cfgD.raio + " km · " + limD.rotulo +
          " · objetivo: " + (cfgD.metrica === "pop" ? "população" :
            cfgD.metrica === "area" ? "área" : "nº de cidades") +
          (cfgD.homonimos ? " · homônimas juntas" : "") +
          (cfgD.bloqueio ? " · coberta não vale" : "") + sufRotulo,
      };
    }
    if (modoAtual === "pop") {
      var cfgP = {
        popAlvo: num("cfg-pop-alvo", 10000, 100000000),
        homonimos: $("cfg-pop-homonimos").checked,
        bloqueio: $("cfg-pop-bloqueio").checked,
        uf: uf || undefined,
      };
      var limP = lerLimite("pop", cfgP);
      return {
        cfg: cfgP,
        chave: "pop|alvo=" + cfgP.popAlvo + limP.chave +
          (cfgP.homonimos ? "|homonimos=1" : "") + (cfgP.bloqueio ? "|bloqueio=1" : "") + sufChave,
        rotulo: "Círculos por população · " + fmtInt(cfgP.popAlvo) + " hab. por círculo · " +
          limP.rotulo + (cfgP.homonimos ? " · homônimas juntas" : "") +
          (cfgP.bloqueio ? " · coberta não vale" : "") + sufRotulo,
      };
    }
    if (modoAtual === "ondestou" || modoAtual === "clique") {
      var minPop = parseInt($(modoAtual === "ondestou" ? "cfg-onde-pool" : "cfg-clique-pool").value, 10) || 0;
      var pool = DADOS.municipios.filter(function (m) {
        return m.pop >= minPop && (!uf || m.uf === uf);
      });
      var nomePool = NOME_POOL[minPop];
      if (modoAtual === "ondestou") {
        if (pool.length < 2) {
          return { erro: "A região não tem municípios suficientes desse porte para o sorteio — escolha um porte menor." };
        }
        return {
          cfg: { minPop: minPop, uf: uf || undefined },
          chave: "ondestou|pool=" + minPop + sufChave,
          rotulo: "Onde estou? · secreto de " + nomePool + " (" + fmtInt(pool.length) + " possíveis)" + sufRotulo,
        };
      }
      if (pool.length === 0) {
        return { erro: "A região não tem municípios desse porte — escolha um porte menor." };
      }
      var rodadas = Math.min(num("cfg-clique-rodadas", 3, 50), pool.length);
      return {
        cfg: { minPop: minPop, rodadas: rodadas, uf: uf || undefined },
        chave: "clique|pool=" + minPop + "|rodadas=" + rodadas + sufChave,
        rotulo: "Onde fica? · " + rodadas + " rodadas · cidades de " + nomePool + sufRotulo,
      };
    }
    if (modoAtual === "maratona") {
      return {
        cfg: { uf: uf || undefined },
        chave: "maratona" + sufChave,
        rotulo: "Maratona: todos os municípios" + (uf ? " de " + NOMES_UF[uf] : " do Brasil"),
      };
    }
    if (modoAtual === "caminho") {
      var origem = lerCidadeCampo("cfg-caminho-origem", "origem");
      if (origem.erro) return origem;
      var destino = lerCidadeCampo("cfg-caminho-destino", "destino");
      if (destino.erro) return destino;
      if (origem.mun.idx === destino.mun.idx) {
        return { erro: "Origem e destino são o mesmo município — escolha dois diferentes." };
      }
      if (uf && (origem.mun.uf !== uf || destino.mun.uf !== uf)) {
        return { erro: "Origem e destino precisam ficar em " + NOMES_UF[uf] +
          " — ou jogue com o Brasil inteiro." };
      }
      return {
        cfg: { origem: origem.mun, destino: destino.mun, uf: uf || undefined },
        chave: "caminho|de=" + origem.mun.id + "|para=" + destino.mun.id + sufChave,
        rotulo: "Caminho por divisas: " + nomeUF(origem.mun) + " → " + nomeUF(destino.mun) + sufRotulo,
      };
    }
    if (modoAtual === "cerco") {
      if ($("cfg-cerco-alvo").value.trim()) {
        var alvoC = lerCidadeCampo("cfg-cerco-alvo", "o município cercado");
        if (alvoC.erro) return alvoC;
        // com alvo escolhido, a região não importa (os vizinhos valem de
        // qualquer UF) — a chave fica sem o sufixo
        return {
          cfg: { alvo: alvoC.mun },
          chave: "cerco|alvo=" + alvoC.mun.id,
          rotulo: "Cerco: os vizinhos de " + nomeUF(alvoC.mun),
        };
      }
      var poolCerco = parseInt($("cfg-cerco-pool").value, 10) || 0;
      return {
        cfg: { minPop: poolCerco, uf: uf || undefined },
        chave: "cerco|pool=" + poolCerco + sufChave,
        rotulo: "Cerco: vizinhos de um município sorteado de " + NOME_POOL[poolCerco] + sufRotulo,
      };
    }
    if (modoAtual === "mancha") {
      var cfgM = { uf: uf || undefined };
      var chaveM = "mancha";
      var rotuloM = "Mancha: território contíguo por divisas";
      if ($("cfg-mancha-limite").value === "tempo") {
        cfgM.tempoMin = num("cfg-mancha-tempo", 1, 240);
        chaveM += "|tempo=" + cfgM.tempoMin;
        rotuloM += " · " + cfgM.tempoMin + " min";
      } else {
        rotuloM += " · sem limite de tempo";
      }
      return { cfg: cfgM, chave: chaveM + sufChave, rotulo: rotuloM + sufRotulo };
    }
    if (modoAtual === "ponte") {
      var poolPonte = parseInt($("cfg-ponte-pool").value, 10) || 0;
      return {
        cfg: { minPop: poolPonte, uf: uf || undefined },
        chave: "ponte|pool=" + poolPonte + sufChave,
        rotulo: "Ponte: ligar dois municípios sorteados de " + NOME_POOL[poolPonte] + sufRotulo,
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
    var nomeTipo = { lat: "Faixas de latitude", lng: "Faixas de longitude", aneis: "Anéis concêntricos", grade: "Grade lat × lng" }[cfgF.tipo];
    var rotulo = nomeTipo + " · " + cfgF.largura + " km · " + cfgF.topN + " maiores cidades por " +
      (cfgF.tipo === "grade" ? "célula" : "faixa");
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
    if (modoAtual === "maratona") {
      // na maratona o "recorde" é o próprio progresso salvo da região
      var regiao = ufDoJogo() || "BR";
      var total = ufDoJogo()
        ? DADOS.municipios.filter(function (m) { return m.uf === regiao; }).length
        : DADOS.total;
      var prog = carregarMaratona(regiao);
      var n = prog && prog.ids ? prog.ids.length : 0;
      el.innerHTML = n === 0
        ? "🏃 Você ainda não começou a maratona desta região (" + fmtInt(total) + " municípios te esperam)."
        : "🏃 Progresso salvo: <b>" + fmtInt(n) + "</b> de " + fmtInt(total) +
          " municípios (<b>" + fmtPct(n / total) + "</b>) em " + fmtTempo(prog.tempoSeg || 0) + ".";
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
    zoomMaxRotulos = Infinity;
    atualizarRotulosFaixas();
    gFaixas.innerHTML = "";
    gCirculos.innerHTML = "";
    gMarcas.innerHTML = "";
    recentes = [];
    rotulosRecentes = [];
    pontos.forEach(function (p) {
      p.setAttribute("class", "cidade");
      p.style.fill = "";
    });
    formas.forEach(function (f) {
      f.setAttribute("class", "municipio");
      f.style.fill = "";
    });
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
    // os modos de divisas dependem do grafo de vizinhos: carrega e volta aqui
    if (MODOS_COM_VIZINHOS[modoAtual] && !window.VIZINHOS) {
      carregarVizinhos(iniciar);
      return;
    }
    limparCamadasDeJogo();
    jogoModo = modoAtual;
    jogoChave = lido.chave;
    jogoRotulo = lido.rotulo;
    var tempoPrevio = 0;
    if (modoAtual === "dist") jogo = new MODOS.JogoCirculosDistancia(lido.cfg);
    else if (modoAtual === "pop") jogo = new MODOS.JogoCirculosPopulacao(lido.cfg);
    else if (modoAtual === "topn") jogo = new MODOS.JogoTopN(lido.cfg);
    else if (modoAtual === "ondestou") jogo = new MODOS.JogoOndeEstou(lido.cfg);
    else if (modoAtual === "clique") jogo = new MODOS.JogoClique(lido.cfg);
    else if (modoAtual === "caminho") jogo = new MODOS.JogoCaminho(lido.cfg);
    else if (modoAtual === "cerco") jogo = new MODOS.JogoCerco(lido.cfg);
    else if (modoAtual === "mancha") jogo = new MODOS.JogoMancha(lido.cfg);
    else if (modoAtual === "ponte") jogo = new MODOS.JogoPonte(lido.cfg);
    else if (modoAtual === "maratona") {
      var prog = carregarMaratona(lido.cfg.uf || "BR");
      lido.cfg.idsIniciais = prog && prog.ids ? prog.ids : [];
      tempoPrevio = prog && prog.tempoSeg ? prog.tempoSeg : 0;
      jogo = new MODOS.JogoMaratona(lido.cfg);
    } else jogo = new MODOS.JogoFaixas(lido.cfg);
    if (jogo.erroInicial) {
      // ex.: alvo do cerco é uma ilha, par da ponte não conecta na região
      $("recorde-atual").innerHTML = "⚠️ " + jogo.erroInicial;
      $("area-jogo").hidden = true;
      jogo = null;
      return;
    }
    // no Cerco os vizinhos valem de qualquer UF — nada some do mapa
    aplicarRegiao(jogoModo === "cerco" ? null : jogo.cfg.uf || null);
    enquadrarUniverso(jogo);

    citadasPartida = new Set();
    dicasUsadas = 0;
    $("area-jogo").hidden = false;
    // em telas pequenas o CSS usa esta classe para subir o mapa e enxugar o
    // painel (some a configuração, fica só o jogo)
    document.body.classList.add("jogo-ativo");
    $("fim-jogo").hidden = true;
    $("feedback").textContent = "";
    $("feedback").className = "";
    $("dica-atual").hidden = true;
    $("lista-jogo").innerHTML = "";
    $("input-palpite").value = "";
    $("input-palpite").disabled = false;
    $("btn-palpitar").disabled = false;
    $("btn-encerrar").hidden = false;
    $("btn-iniciar").textContent = "↺ Reiniciar";
    setConfigTravada(true);

    // o modo de clique esconde o campo de texto (a resposta é no mapa) e
    // todos os pontos de cidade — nada pode entregar as posições
    $("linha-palpite").hidden = jogoModo === "clique";
    svg.classList.toggle("modo-clique", jogoModo === "clique");
    $("alvo-clique").hidden = jogoModo !== "clique";

    var TEM_DICA = { faixas: 1, topn: 1, ondestou: 1, maratona: 1, caminho: 1, cerco: 1, mancha: 1, ponte: 1 };
    $("btn-dica").hidden = !TEM_DICA[jogoModo];
    atualizarBotaoDica();
    $("btn-zerar-maratona").hidden = jogoModo !== "maratona";
    $("btn-encerrar").textContent =
      jogoModo === "maratona" ? "⏸ Pausar (o progresso fica salvo)" :
      jogoModo === "ondestou" ? "🏳️ Desistir / revelar o município" :
      jogoModo === "clique" ? "🏳️ Encerrar a partida" :
      jogoModo === "caminho" ? "🏳️ Desistir / revelar o caminho mínimo" :
      jogoModo === "ponte" ? "🏳️ Desistir / revelar uma ligação mínima" :
      jogoModo === "cerco" ? "🏳️ Encerrar / revelar os vizinhos" :
      jogoModo === "mancha" ? "🏁 Encerrar a mancha" :
      "🏳️ Encerrar / revelar respostas";

    if (jogoModo === "faixas") {
      desenharFaixas(jogo);
      montarListaFaixas(jogo);
    } else if (jogoModo === "topn") {
      montarListaTopN(jogo);
    } else if (jogoModo === "maratona") {
      // repinta o que já foi achado em sessões anteriores (sem rótulos: podem
      // ser milhares de cidades)
      jogo.universo.forEach(function (m) {
        if (jogo.achados.has(m.idx)) pintarPonto(m, "achada");
      });
      montarListaMaratona(jogo);
    } else if (jogoModo === "clique") {
      mostrarAlvoClique();
    } else if (jogoModo === "caminho") {
      // origem em azul (é onde você está); destino em vermelho (aonde chegar)
      pintarPonto(jogo.origem, "centro-palpite");
      rotularMun(jogo.origem, "centro-palpite");
      pontos[jogo.destino.idx].setAttribute("class", "cidade faltante");
      sincronizarForma(jogo.destino);
      rotularMun(jogo.destino, "faltante");
    } else if (jogoModo === "cerco") {
      pintarPonto(jogo.alvo, "centro-palpite");
      rotularMun(jogo.alvo, "centro-palpite");
    } else if (jogoModo === "ponte") {
      [jogo.a, jogo.b].forEach(function (m) {
        pintarPonto(m, "centro-palpite");
        rotularMun(m, "centro-palpite");
      });
    }
    atualizarMissao();
    $("legenda-pop").hidden = jogoModo === "ondestou" || jogoModo === "clique";
    $("legenda-dist").hidden = jogoModo !== "ondestou";
    limiteSeg = jogo.cfg.tempoMin ? jogo.cfg.tempoMin * 60 : null;
    inicioMs = Date.now() - tempoPrevio * 1000;
    atualizarPlacar();

    clearInterval(timerInt);
    timerInt = setInterval(tique, 1000);
    if (jogoModo !== "clique") $("input-palpite").focus();
  }

  function atualizarBotaoDica() {
    var btn = $("btn-dica");
    if (jogoModo === "maratona") {
      btn.textContent = "💡 Dica (grátis)";
      btn.title = "Mostra pistas do maior município que ainda falta";
      btn.disabled = false;
      return;
    }
    // nos modos de divisas as dicas são ilimitadas, mas cada uma tem custo
    if (jogoModo === "caminho" || jogoModo === "ponte" || jogoModo === "mancha") {
      btn.textContent = "💡 Dica";
      btn.title = jogoModo === "caminho"
        ? "Pistas do próximo município de um caminho mínimo — cada dica custa +1 salto"
        : jogoModo === "ponte"
        ? "Pistas de um bom próximo elo — cada dica custa +1 município no placar"
        : "Pistas do maior vizinho da mancha — cada dica desconta 1 município do resultado";
      btn.disabled = !jogo || jogo.encerrado;
      return;
    }
    var restantes = Math.max(0, 3 - dicasUsadas);
    btn.textContent = "💡 Dica (" + restantes + ")";
    btn.title = jogoModo === "ondestou"
      ? "Revela UF, primeira letra e população do secreto — cada dica custa +1 palpite"
      : "Pistas do maior alvo que falta — cada dica desconta 1 acerto do resultado";
    btn.disabled = restantes === 0 || !jogo || jogo.encerrado;
  }

  function tique() {
    if (jogo && !jogo.encerrado && limiteSeg !== null && tempoDecorrido() >= limiteSeg) {
      fimDeJogo(true, true);
      return;
    }
    // fechar o navegador no meio da maratona não pode perder o relógio
    if (jogoModo === "maratona" && jogo && !jogo.encerrado && tempoDecorrido() % 30 === 0) {
      salvarProgressoMaratona();
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
    var barra = pct;
    if (jogoModo === "dist" && jogo.cfg.metrica === "cidades") {
      linhas.push("Cidades cobertas: <b>" + fmtInt(jogo.cobertos.size) + "</b> de " +
        fmtInt(jogo.universo.length) + " (<b>" + fmtPct(pct) + "</b>)");
      linhas.push("População coberta: <b>" + fmtPop(jogo.popCoberta) + "</b>");
    } else if (jogoModo === "dist" && jogo.cfg.metrica === "area") {
      linhas.push("Área coberta: <b>" + fmtArea(jogo.areaCoberta) + "</b> de " +
        fmtArea(jogo.uniArea) + " (<b>" + fmtPct(pct) + "</b>)");
      linhas.push("Cidades cobertas: <b>" + fmtInt(jogo.cobertos.size) + "</b>");
    } else if (jogoModo === "dist" || jogoModo === "pop") {
      linhas.push("População coberta: <b>" + fmtPop(jogo.popCoberta) + "</b> de " +
        fmtPop(jogo.uniPop) + " (<b>" + fmtPct(pct) + "</b>)");
      linhas.push("Cidades cobertas: <b>" + fmtInt(jogo.cobertos.size) + "</b>");
    } else if (jogoModo === "faixas") {
      linhas.push("Respostas certas: <b>" + jogo.achadosTotal + "</b> de " + jogo.alvosTotal +
        " (<b>" + fmtPct(pct) + "</b>) · " + jogo.faixas.length +
        (jogo.cfg.tipo === "grade" ? " células" : " faixas"));
    } else if (jogoModo === "ondestou") {
      linhas.push("Palpites: <b>" + jogo.palpites.length + "</b>" +
        (jogo.dicasDadas ? " · Dicas: <b>" + jogo.dicasDadas + "</b> (+1 palpite cada)" : ""));
      if (jogo.melhorDist < Infinity) {
        linhas.push("Mais perto que você chegou: <b>" + fmtInt(Math.round(jogo.melhorDist)) + " km</b>");
      }
      // a barra mostra a proximidade do melhor palpite, não uma % de acertos
      barra = jogo.melhorDist === Infinity ? 0 : Math.max(0, 1 - Math.min(jogo.melhorDist, 1500) / 1500);
    } else if (jogoModo === "clique") {
      linhas.push("Rodada: <b>" + Math.min(jogo.resultados.length + 1, jogo.alvos.length) +
        "</b> de " + jogo.alvos.length);
      if (jogo.resultados.length > 0) {
        linhas.push("Pontuação: <b>" + fmtPct(pct) + "</b> · erro médio <b>" +
          fmtInt(Math.round(jogo.erroMedioKm())) + " km</b>");
      }
      barra = jogo.alvos.length === 0 ? 0 : jogo.resultados.length / jogo.alvos.length;
    } else if (jogoModo === "maratona") {
      linhas.push("Municípios: <b>" + fmtInt(jogo.achados.size) + "</b> de " +
        fmtInt(jogo.alvosTotal) + " (<b>" + fmtPct(pct) + "</b>)");
      linhas.push("População: <b>" + fmtPop(jogo.popAchada) + "</b> de " +
        fmtPop(jogo.uniPop) +
        " (<b>" + fmtPct(jogo.uniPop ? jogo.popAchada / jogo.uniPop : 0) + "</b>)");
      linhas.push("Nesta sessão: <b>+" + fmtInt(jogo.achadosSessao) + "</b>");
    } else if (jogoModo === "caminho") {
      linhas.push("Saltos: <b>" + jogo.saltos + "</b> · mínimo possível: <b>" +
        jogo.minSaltos + "</b>" +
        (jogo.dicasDadas ? " · dicas: <b>" + jogo.dicasDadas + "</b> (+1 salto cada)" : ""));
      var restC = jogo.saltosRestantes();
      if (!jogo.venceu && restC !== null) {
        linhas.push("Do município atual ao destino: <b>" + restC +
          (restC === 1 ? " salto" : " saltos") + "</b>");
      }
      // a barra mostra o avanço real: fração do caminho mínimo já vencida
      barra = jogo.venceu ? 1 :
        Math.max(0, 1 - (restC === null ? 1 : restC / jogo.minSaltos));
    } else if (jogoModo === "cerco") {
      linhas.push("Vizinhos achados: <b>" + jogo.achadosTotal + "</b> de " +
        jogo.alvosTotal + " (<b>" + fmtPct(pct) + "</b>)");
    } else if (jogoModo === "mancha") {
      linhas.push("Sua mancha: <b>" + fmtInt(jogo.mancha.size) + "</b> de " +
        fmtInt(jogo.alvosTotal) + " municípios (<b>" + fmtPct(pct) + "</b>)");
      linhas.push("População da mancha: <b>" + fmtPop(jogo.popMancha) + "</b>");
    } else if (jogoModo === "ponte") {
      linhas.push("Municípios usados: <b>" + jogo.usados + "</b> · mínimo entre os extremos: <b>" +
        jogo.minMeio + "</b>" +
        (jogo.dicasDadas ? " · dicas: <b>" + jogo.dicasDadas + "</b> (+1 cada)" : ""));
      var restP = jogo.saltosRestantes();
      if (!jogo.venceu && restP !== null && restP > 1) {
        linhas.push("O marcado mais perto ainda está a <b>" + restP + " saltos</b> do outro extremo");
      }
      barra = jogo.venceu ? 1 :
        Math.max(0, 1 - (restP === null ? 1 : restP / (jogo.minMeio + 1)));
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
      linhas.push((jogoModo === "maratona" ? "Tempo total: <b>" : "Tempo: <b>") +
        fmtTempo(tempoDecorrido()) + "</b>");
    }
    $("placar-linhas").innerHTML = linhas.map(function (l) { return "<div>" + l + "</div>"; }).join("");
    $("barra-progresso").style.width = (barra * 100).toFixed(1) + "%";
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
    if (jogoModo === "maratona") return palpitarMaratona(texto);
    if (jogoModo === "ondestou") return palpitarOnde(texto);
    if (jogoModo === "caminho") return palpitarCaminho(texto);
    if (jogoModo === "cerco") return palpitarCerco(texto);
    if (jogoModo === "mancha") return palpitarMancha(texto);
    if (jogoModo === "ponte") return palpitarPonte(texto);
    if (jogoModo === "clique") return; // a resposta é um clique no mapa

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
    registrarCitadas(muns);
    var r = jogo.palpitar(muns);
    if (r.tipo === "repetido") {
      feedback(muns.length > 1
        ? "Você já usou todas as cidades chamadas " + muns[0].nome + "."
        : "Você já usou " + nomeUF(muns[0]) + ".", "erro");
      return;
    }
    if (r.tipo === "coberto") {
      feedback(nomeUF(r.mun) + " já está dentro de um círculo — cidade coberta não vale como palpite nesta partida.", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo !== "ok") return;

    var j = r.jogada;
    j.circulos.forEach(function (c) {
      elSvg("path", { d: caminhoGeodesico(c.mun.lat, c.mun.lng, c.raioKm), "class": "circulo-cobertura" }, gCirculos);
    });
    j.novos.forEach(function (idx) {
      pintarPonto(DADOS.municipios[idx], "coberta");
    });
    j.circulos.forEach(function (c) {
      pintarPonto(c.mun, "centro-palpite");
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
      : jogoModo === "dist" && jogo.cfg.metrica === "area"
      ? "+" + fmtArea(j.ganhoArea) + " · +" + fmtInt(j.novos.length) + " cidades"
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
      registrarCitadas(r.municipios);
      feedback(r.municipios[0].nome + " fica fora da região do jogo (só " +
        NOMES_UF[jogo.cfg.uf] + ").", "erro");
      return;
    }
    if (r.tipo === "repetido") {
      registrarCitadas([r.mun]);
      feedback("Você já acertou " + nomeUF(r.mun) + ".", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo === "nao_alvo") {
      registrarCitadas(r.municipios);
      var naoAlvo = jogoModo === "topn"
        ? " não está entre as " + jogo.alvosTotal + " maiores."
        : " não está entre as respostas.";
      feedback(r.municipios.length === 1
        ? nomeUF(r.municipios[0]) + naoAlvo
        : "Nenhum dos municípios chamados " + r.municipios[0].nome + naoAlvo, "erro");
      $("input-palpite").select();
      return;
    }
    registrarCitadas(r.revelados.map(function (par) { return par.mun; }));
    r.revelados.forEach(function (par) {
      revelarAlvo(par.mun, par.faixa || null, false, par.rank);
    });
    var nomes = r.revelados.map(function (par) {
      return par.rank !== undefined
        ? par.rank + "º — " + nomeUF(par.mun) + " · " + fmtPop(par.mun.pop) + " hab."
        : nomeUF(par.mun) + " — " + (jogo.cfg.tipo === "grade" ? "célula " : "faixa ") + par.faixa.rotulo;
    });
    feedback("✔ " + nomes.join(" · "), "ok");
    $("input-palpite").value = "";
    atualizarPlacar();
    if (r.completo) fimDeJogo(false);
  }

  function revelarAlvo(mun, faixa, faltante, rank) {
    if (faltante) {
      pontos[mun.idx].setAttribute("class", "cidade faltante");
      pontos[mun.idx].style.fill = "";
      sincronizarForma(mun);
    } else {
      pintarPonto(mun, "achada");
    }
    elSvg("text", {
      x: proj.x(mun.lng).toFixed(1),
      y: proj.y(mun.lat).toFixed(1),
      "class": "rotulo-cidade" + (faltante ? " faltante" : ""),
    }, gMarcas).textContent = mun.nome;
    if (faixa) {
      if (faixa._elContador) {
        faixa._elContador.textContent = rotuloContador(faixa);
      }
      atualizarItemFaixa(faixa);
      atualizarAreaFaixa(faixa);
      if (!faltante && faixa.achados.size === faixa.alvos.length) {
        if (faixa._elContador) faixa._elContador.classList.add("completa");
      }
    }
    if (rank !== undefined) atualizarChipTopN(rank, mun, faltante);
  }

  function rotuloContador(f) {
    return (f.celula ? f.celula + " " : "") + f.achados.size + "/" + f.alvos.length;
  }

  // A cor da faixa caminha para o tom final conforme os acertos: a área verde
  // fica com opacidade proporcional à fração respondida.
  function atualizarAreaFaixa(f) {
    if (!f._elArea) return;
    var frac = f.alvos.length === 0 ? 0 : f.achados.size / f.alvos.length;
    f._elArea.style.opacity = frac.toFixed(3);
  }

  // ---------------- modo Onde estou? ----------------
  var SETAS_RUMO = [
    "⬆ norte", "↗ nordeste", "➡ leste", "↘ sudeste",
    "⬇ sul", "↙ sudoeste", "⬅ oeste", "↖ noroeste",
  ];
  function setaDoRumo(graus) {
    return SETAS_RUMO[Math.round(graus / 45) % 8];
  }

  function palpitarOnde(texto) {
    var r = jogo.palpitar(texto);
    if (r.tipo === "vazio") return;
    if (r.tipo === "nao_encontrado") {
      feedback(r.ufErrada
        ? "Esse município existe, mas não nessa UF."
        : "Não encontrei nenhum município com esse nome.", "erro");
      return;
    }
    if (r.tipo === "fora_regiao") {
      registrarCitadas(r.municipios);
      feedback(r.municipios[0].nome + " fica fora da região do jogo (só " +
        NOMES_UF[jogo.cfg.uf] + ").", "erro");
      return;
    }
    if (r.tipo === "ambiguo") {
      var ufs = r.municipios.map(function (m) { return m.uf; }).join(", ");
      feedback("Há " + r.municipios.length + " municípios com esse nome (" + ufs +
        "). Especifique: " + r.municipios[0].nome + ", UF.", "erro");
      return;
    }
    if (r.tipo === "repetido") {
      feedback("Você já chutou " + nomeUF(r.mun) + ".", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo !== "ok") return;

    registrarCitadas([r.mun]);
    var km = fmtInt(Math.round(r.distKm)) + " km";
    var item = document.createElement("div");
    item.className = "item-jogada";
    if (r.acertou) {
      pintarPonto(r.mun, "centro-palpite");
      elSvg("text", {
        x: proj.x(r.mun.lng).toFixed(1),
        y: proj.y(r.mun.lat).toFixed(1),
        "class": "rotulo-cidade centro-palpite",
      }, gMarcas).textContent = r.mun.nome;
      item.innerHTML = "<b>" + jogo.palpites.length + ". " + nomeUF(r.mun) + "</b><br><small>🎯 é aqui!</small>";
      $("lista-jogo").prepend(item);
      $("input-palpite").value = "";
      atualizarPlacar();
      fimDeJogo(false);
      return;
    }
    var p = pontos[r.mun.idx];
    p.setAttribute("class", "cidade achada");
    p.style.fill = corDist(r.distKm);
    sincronizarForma(r.mun);
    elSvg("text", {
      x: proj.x(r.mun.lng).toFixed(1),
      y: proj.y(r.mun.lat).toFixed(1),
      "class": "rotulo-cidade",
    }, gMarcas).textContent = r.mun.nome;
    var direcao = km + " " + setaDoRumo(r.rumo);
    item.innerHTML = "<b>" + jogo.palpites.length + ". " + nomeUF(r.mun) +
      "</b><br><small>" + direcao + "</small>";
    $("lista-jogo").prepend(item);
    feedback("📍 " + r.mun.nome + ": o secreto está a " + direcao + " daqui.", "ok");
    $("input-palpite").value = "";
    atualizarPlacar();
  }

  // ---------------- modo Maratona ----------------
  function palpitarMaratona(texto) {
    var r = jogo.palpitar(texto);
    if (r.tipo === "vazio") return;
    if (r.tipo === "nao_encontrado") {
      feedback(r.ufErrada
        ? "Esse município existe, mas não nessa UF."
        : "Não encontrei nenhum município com esse nome.", "erro");
      return;
    }
    if (r.tipo === "fora_regiao") {
      registrarCitadas(r.municipios);
      feedback(r.municipios[0].nome + " fica fora da região do jogo (só " +
        NOMES_UF[jogo.cfg.uf] + ").", "erro");
      return;
    }
    if (r.tipo === "repetido") {
      registrarCitadas([r.mun]);
      feedback("Você já citou " + nomeUF(r.mun) + ".", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo !== "ok") return;

    registrarCitadas(r.revelados.map(function (par) { return par.mun; }));
    r.revelados.forEach(function (par) {
      pintarPonto(par.mun, "achada");
      atualizarContadorMaratona(par.mun);
    });
    destacarRecentes(r.revelados.map(function (par) { return par.mun; }));
    var nomes = r.revelados.map(function (par) {
      return nomeUF(par.mun) + " · " + fmtPop(par.mun.pop) + " hab.";
    });
    feedback("✔ " + nomes.join(" · "), "ok");
    $("input-palpite").value = "";
    salvarProgressoMaratona();
    atualizarPlacar();
    atualizarRecordeUI(); // o banner de progresso salvo acompanha em tempo real
    if (r.completo) fimSessaoMaratona(true);
  }

  // Na maratona só o último acerto fica aceso: a classe "recente" (ponto e
  // forma) e um rótulo com o nome migram a cada palpite certo, mostrando na
  // hora onde fica a cidade que acabou de ser digitada.
  function destacarRecentes(muns) {
    recentes.forEach(function (idx) {
      pontos[idx].classList.remove("recente");
      if (formas[idx]) formas[idx].classList.remove("recente");
    });
    rotulosRecentes.forEach(function (el) { el.remove(); });
    recentes = [];
    rotulosRecentes = [];
    muns.forEach(function (m) {
      recentes.push(m.idx);
      pontos[m.idx].classList.add("recente");
      if (formas[m.idx]) formas[m.idx].classList.add("recente");
      var rot = elSvg("text", {
        x: proj.x(m.lng).toFixed(1),
        y: proj.y(m.lat).toFixed(1),
        "class": "rotulo-cidade recente",
      }, gMarcas);
      rot.textContent = m.nome;
      rotulosRecentes.push(rot);
    });
  }

  function salvarProgressoMaratona() {
    if (jogoModo !== "maratona" || !jogo) return;
    salvarMaratona(jogo.cfg.uf || "BR", {
      ids: jogo.idsAchados(),
      tempoSeg: tempoDecorrido(),
    });
  }

  // Lista lateral da maratona: contadores por porte (sempre) e por UF (no
  // Brasil inteiro). Cada UF mostra também quantas das 10 maiores cidades já
  // saíram (★), e clicar na linha abre a posição da maior que falta — pista
  // sem revelar o nome (para isso existe o botão 💡).
  function contadorHtml(id, c) {
    return "<b id='" + id + "'" + (c.achados === c.total ? " class='completo'" : "") + ">" +
      c.achados + "/" + c.total + "</b>";
  }

  function montarListaMaratona(jogo) {
    var alvo = $("lista-jogo");
    alvo.innerHTML = "";
    maratonaContadores = {};
    maratonaTop = {};
    maratonaDetalheUF = null;

    // uma passada só pelo universo (ordenado por população): portes, totais
    // por UF e as 10 maiores de cada UF
    var portes = FAIXAS_POP.map(function (fx) {
      return { min: fx.min, rotulo: fx.rotulo, total: 0, achados: 0 };
    });
    var porUF = {};
    jogo.universo.forEach(function (m) {
      for (var i = 0; i < portes.length; i++) {
        if (m.pop >= portes[i].min) {
          portes[i].total++;
          if (jogo.achados.has(m.idx)) portes[i].achados++;
          break;
        }
      }
      var c = porUF[m.uf];
      if (!c) {
        c = porUF[m.uf] = { total: 0, achados: 0 };
        maratonaTop[m.uf] = { idxs: new Set(), total: 0, achados: 0 };
      }
      c.total++;
      if (jogo.achados.has(m.idx)) c.achados++;
      var t = maratonaTop[m.uf];
      if (t.total < 10) {
        t.total++;
        t.idxs.add(m.idx);
        if (jogo.achados.has(m.idx)) t.achados++;
      }
    });

    var itemPorte = document.createElement("div");
    itemPorte.className = "item-faixa";
    var linhasPorte = portes.map(function (p, i) {
      if (p.total === 0) return "";
      maratonaContadores["porte" + i] = p;
      return "<div class='linha-porte'><span>" + p.rotulo + "</span>" +
        contadorHtml("mar-cont-porte" + i, p) + "</div>";
    });
    // jogando uma UF só, a linha das 10 maiores do estado entra aqui em cima
    if (jogo.cfg.uf) {
      var tUF = maratonaTop[jogo.cfg.uf];
      if (tUF) {
        linhasPorte.unshift("<div class='linha-porte linha-uf' data-uf='" + jogo.cfg.uf +
          "' title='Clique: pista da maior cidade que falta'><span>As " + tUF.total +
          " maiores do estado</span>" + contadorHtml("mar-top-" + jogo.cfg.uf, tUF) + "</div>");
      }
    }
    itemPorte.innerHTML = "<div class='titulo-faixa'><span>Progresso por porte</span></div>" +
      "<div class='portes'>" + linhasPorte.join("") + "</div>";
    itemPorte.addEventListener("click", cliqueLinhaUF);
    alvo.appendChild(itemPorte);

    if (jogo.cfg.uf) return;

    var itemUF = document.createElement("div");
    itemUF.className = "item-faixa";
    var linhasUF = Object.keys(porUF).sort().map(function (uf) {
      var c = porUF[uf];
      maratonaContadores[uf] = c;
      var t = maratonaTop[uf];
      return "<div class='linha-porte linha-uf' data-uf='" + uf +
        "' title='Clique: pista da maior cidade que falta'><span>" + uf + "</span>" +
        "<span class='top-uf" + (t.achados === t.total ? " completo" : "") +
        "' id='mar-top-" + uf + "'>★" + t.achados + "/" + t.total + "</span>" +
        contadorHtml("mar-cont-" + uf, c) + "</div>";
    });
    itemUF.innerHTML = "<div class='titulo-faixa'><span>Progresso por UF</span>" +
      "<span>★ = 10 maiores</span></div><div class='portes portes-mar'>" +
      linhasUF.join("") + "</div>";
    itemUF.addEventListener("click", cliqueLinhaUF);
    alvo.appendChild(itemUF);
  }

  // Posição (no ranking do estado) da maior cidade que ainda falta.
  function textoDetalheUF(uf) {
    var pos = 0;
    for (var i = 0; i < jogo.universo.length; i++) {
      var m = jogo.universo[i];
      if (m.uf !== uf) continue;
      pos++;
      if (!jogo.achados.has(m.idx)) {
        return "Maior que falta: a <b>" + pos + "ª</b> do estado · " + fmtPop(m.pop) + " hab.";
      }
    }
    return "✓ Todos os municípios do estado!";
  }

  function fecharDetalheUF() {
    var det = document.getElementById("mar-det");
    if (det) det.remove();
    maratonaDetalheUF = null;
  }

  function cliqueLinhaUF(ev) {
    var linha = ev.target.closest(".linha-uf");
    if (!linha || !jogo) return;
    var uf = linha.dataset.uf;
    var estavaAberto = maratonaDetalheUF;
    fecharDetalheUF();
    if (estavaAberto === uf) return; // segundo clique na mesma UF só fecha
    var det = document.createElement("div");
    det.className = "detalhe-uf";
    det.id = "mar-det";
    det.innerHTML = textoDetalheUF(uf);
    linha.insertAdjacentElement("afterend", det);
    maratonaDetalheUF = uf;
  }

  function bumpContadorMaratona(chave) {
    var c = maratonaContadores[chave];
    if (!c) return;
    c.achados++;
    var el = document.getElementById("mar-cont-" + chave);
    if (el) {
      el.textContent = c.achados + "/" + c.total;
      el.classList.toggle("completo", c.achados === c.total);
    }
  }

  function atualizarContadorMaratona(mun) {
    if (!maratonaContadores) return;
    for (var i = 0; i < FAIXAS_POP.length; i++) {
      if (mun.pop >= FAIXAS_POP[i].min) { bumpContadorMaratona("porte" + i); break; }
    }
    if (!jogo.cfg.uf) bumpContadorMaratona(mun.uf);
    var t = maratonaTop && maratonaTop[mun.uf];
    if (t && t.idxs.has(mun.idx)) {
      t.achados++;
      var el = document.getElementById("mar-top-" + mun.uf);
      if (el) {
        el.textContent = (jogo.cfg.uf ? "" : "★") + t.achados + "/" + t.total;
        el.classList.toggle("completo", t.achados === t.total);
      }
    }
    // a pista aberta acompanha os acertos da própria UF
    if (maratonaDetalheUF === mun.uf) {
      var det = document.getElementById("mar-det");
      if (det) det.innerHTML = textoDetalheUF(mun.uf);
    }
  }

  function fimSessaoMaratona(completou) {
    clearInterval(timerInt);
    salvarProgressoMaratona();
    jogo.encerrado = true;
    atualizarPlacar();
    $("input-palpite").disabled = true;
    $("btn-palpitar").disabled = true;
    $("btn-encerrar").hidden = true;
    $("btn-dica").hidden = true;
    setConfigTravada(false);
    $("btn-iniciar").textContent = "▶ Continuar maratona";
    var el = $("fim-jogo");
    el.hidden = false;
    el.className = completou ? "recorde" : "";
    el.innerHTML = completou
      ? "🏆 <b>MARATONA COMPLETA!</b> Você citou todos os " + fmtInt(jogo.alvosTotal) +
        " municípios da região em " + fmtTempo(tempoDecorrido()) + ". Lenda."
      : "⏸ <b>Sessão pausada.</b> Progresso salvo: <b>" + fmtInt(jogo.achados.size) +
        "</b> de " + fmtInt(jogo.alvosTotal) + " (<b>" + fmtPct(jogo.pct()) + "</b>)" +
        " — <b>+" + fmtInt(jogo.achadosSessao) + "</b> nesta sessão. Volte quando quiser.";
    atualizarRecordeUI();
  }

  // ---------------- modos de divisas (Caminho, Cerco, Mancha, Ponte) ----------------
  function rotularMun(mun, classe) {
    elSvg("text", {
      x: proj.x(mun.lng).toFixed(1),
      y: proj.y(mun.lat).toFixed(1),
      "class": "rotulo-cidade" + (classe ? " " + classe : ""),
    }, gMarcas).textContent = mun.nome;
  }

  // elo entre dois municípios adjacentes citados (a corrente da viagem/ponte)
  function linhaCadeia(a, b) {
    elSvg("line", {
      x1: proj.x(a.lng).toFixed(1), y1: proj.y(a.lat).toFixed(1),
      x2: proj.x(b.lng).toFixed(1), y2: proj.y(b.lat).toFixed(1),
      "class": "linha-cadeia",
    }, gMarcas);
  }

  // traçado de um caminho mínimo (revelado no fim da partida)
  function desenharCaminhoMinimo(caminho, faltante) {
    var d = caminho.map(function (m, i) {
      return (i === 0 ? "M" : "L") + proj.x(m.lng).toFixed(1) + " " + proj.y(m.lat).toFixed(1);
    }).join("");
    elSvg("path", { d: d, "class": "linha-minima" + (faltante ? " faltante" : "") }, gMarcas);
  }

  // caixa de missão (mesmo elemento da pergunta do modo clique)
  function atualizarMissao() {
    var el = $("alvo-clique");
    if (!jogo || !MODOS_COM_VIZINHOS[jogoModo]) return;
    if (jogoModo === "caminho") {
      el.innerHTML = "🚗 De <b>" + nomeUF(jogo.origem) + "</b> a <b>" + nomeUF(jogo.destino) +
        "</b>, por divisas.<br>Você está em: <b>" + nomeUF(jogo.atual) + "</b>" +
        (jogo.venceu ? " 🏁" : "");
    } else if (jogoModo === "cerco") {
      el.innerHTML = "⭕ Nomeie os <b>" + jogo.alvosTotal +
        "</b> municípios que fazem divisa com <b>" + nomeUF(jogo.alvo) + "</b>.";
    } else if (jogoModo === "mancha") {
      el.innerHTML = jogo.mancha.size === 0
        ? "🌱 Comece nomeando <b>qualquer</b> município da região."
        : "🟢 Sua mancha tem <b>" + fmtInt(jogo.mancha.size) +
          "</b> município" + (jogo.mancha.size === 1 ? "" : "s") +
          " — cresça pelas divisas.";
    } else if (jogoModo === "ponte") {
      el.innerHTML = "🌉 Ligue <b>" + nomeUF(jogo.a) + "</b> a <b>" + nomeUF(jogo.b) +
        "</b> — cada palpite precisa fazer divisa com algo já marcado.";
    }
    el.hidden = false;
  }

  // mensagens de erro comuns aos quatro modos; devolve true se já tratou
  function feedbackDivisas(r) {
    if (r.tipo === "vazio" || r.tipo === "encerrado") return true;
    if (r.tipo === "nao_encontrado") {
      feedback(r.ufErrada
        ? "Esse município existe, mas não nessa UF."
        : "Não encontrei nenhum município com esse nome.", "erro");
      return true;
    }
    if (r.tipo === "fora_regiao") {
      registrarCitadas(r.municipios);
      feedback(r.municipios[0].nome + " fica fora da região do jogo (só " +
        NOMES_UF[jogo.cfg.uf] + ").", "erro");
      return true;
    }
    if (r.tipo === "ambiguo") {
      var ufs = r.municipios.map(function (m) { return m.uf; }).join(", ");
      feedback("Há " + r.municipios.length + " municípios com esse nome (" + ufs +
        "). Especifique: " + r.municipios[0].nome + ", UF.", "erro");
      return true;
    }
    return false;
  }

  function palpitarCaminho(texto) {
    var r = jogo.palpitar(texto);
    if (feedbackDivisas(r)) return;
    if (r.tipo === "atual") {
      feedback("Você já está em " + nomeUF(r.mun) + ".", "erro");
      return;
    }
    if (r.tipo === "nao_vizinho") {
      registrarCitadas(r.municipios);
      feedback(r.municipios.length === 1
        ? nomeUF(r.municipios[0]) + " não faz divisa com " + nomeUF(r.atual) + "."
        : "Nenhum município chamado " + r.municipios[0].nome + " faz divisa com " + nomeUF(r.atual) + ".", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo !== "ok") return;
    registrarCitadas([r.mun]);
    linhaCadeia(r.anterior, r.mun);
    pintarPonto(r.mun, r.venceu ? "centro-palpite" : "achada");
    if (!r.venceu) destacarRecentes([r.mun]);
    var rest = jogo.saltosRestantes();
    var item = document.createElement("div");
    item.className = "item-jogada";
    item.innerHTML = "<b>" + jogo.saltos + ". " + nomeUF(r.mun) + "</b><br><small>" +
      (r.venceu ? "🏁 chegou!" : "a " + rest + (rest === 1 ? " salto" : " saltos") + " do destino") +
      "</small>";
    $("lista-jogo").prepend(item);
    feedback("✔ " + nomeUF(r.mun) + (r.repetido ? " (de novo)" : "") +
      (r.venceu ? " — 🏁 você chegou!" : ""), "ok");
    $("input-palpite").value = "";
    atualizarMissao();
    atualizarPlacar();
    if (r.venceu) fimDeJogo(false);
  }

  function palpitarCerco(texto) {
    var r = jogo.palpitar(texto);
    if (feedbackDivisas(r)) return;
    if (r.tipo === "repetido") {
      registrarCitadas([r.mun]);
      feedback("Você já acertou " + nomeUF(r.mun) + ".", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo === "alvo") {
      feedback(jogo.alvo.nome + " é o município cercado — queremos os vizinhos dele.", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo === "nao_alvo") {
      registrarCitadas(r.municipios);
      feedback(r.municipios.length === 1
        ? nomeUF(r.municipios[0]) + " não faz divisa com " + nomeUF(jogo.alvo) + "."
        : "Nenhum município chamado " + r.municipios[0].nome + " faz divisa com " + nomeUF(jogo.alvo) + ".", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo !== "ok") return;
    registrarCitadas(r.revelados.map(function (par) { return par.mun; }));
    r.revelados.forEach(function (par) { revelarAlvo(par.mun, null, false); });
    feedback("✔ " + r.revelados.map(function (par) {
      return nomeUF(par.mun) + " · " + fmtPop(par.mun.pop) + " hab.";
    }).join(" · "), "ok");
    $("input-palpite").value = "";
    atualizarPlacar();
    if (r.completo) fimDeJogo(false);
  }

  function palpitarMancha(texto) {
    var r = jogo.palpitar(texto);
    if (feedbackDivisas(r)) return;
    if (r.tipo === "isolado") {
      feedback(nomeUF(r.mun) + " não faz divisa com nenhum município" +
        (jogo.cfg.uf ? " de " + NOMES_UF[jogo.cfg.uf] : "") +
        " — comece por outro.", "erro");
      return;
    }
    if (r.tipo === "repetido") {
      registrarCitadas([r.mun]);
      feedback(nomeUF(r.mun) + " já faz parte da sua mancha.", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo === "nao_vizinho") {
      registrarCitadas(r.municipios);
      feedback(r.municipios.length === 1
        ? nomeUF(r.municipios[0]) + " não faz divisa com a sua mancha."
        : "Nenhum município chamado " + r.municipios[0].nome + " faz divisa com a sua mancha.", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo !== "ok") return;
    registrarCitadas(r.revelados.map(function (par) { return par.mun; }));
    r.revelados.forEach(function (par) { pintarPonto(par.mun, "achada"); });
    destacarRecentes(r.revelados.map(function (par) { return par.mun; }));
    feedback(r.semente
      ? "🌱 Mancha começada em " + nomeUF(r.revelados[0].mun) +
        " — agora só vale quem faz divisa com ela."
      : "✔ " + r.revelados.map(function (par) { return nomeUF(par.mun); }).join(" · ") +
        " — mancha com " + fmtInt(jogo.mancha.size) + " municípios.", "ok");
    $("input-palpite").value = "";
    atualizarMissao();
    atualizarPlacar();
    if (r.completo) fimDeJogo(false);
  }

  function palpitarPonte(texto) {
    var r = jogo.palpitar(texto);
    if (feedbackDivisas(r)) return;
    if (r.tipo === "repetido") {
      registrarCitadas([r.mun]);
      feedback(nomeUF(r.mun) + " já está marcado.", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo === "nao_vizinho") {
      registrarCitadas(r.municipios);
      feedback(r.municipios.length === 1
        ? nomeUF(r.municipios[0]) + " não faz divisa com o que já está marcado."
        : "Nenhum município chamado " + r.municipios[0].nome + " faz divisa com o que já está marcado.", "erro");
      $("input-palpite").select();
      return;
    }
    if (r.tipo !== "ok") return;
    registrarCitadas(r.revelados.map(function (par) { return par.mun; }));
    var aceitos = jogo.aceitos;
    r.revelados.forEach(function (par) {
      pintarPonto(par.mun, "achada");
      rotularMun(par.mun);
      // elo com cada município já marcado que faz divisa com o novo
      MODOS.vizinhosDe(par.mun).forEach(function (v) {
        if (aceitos.has(v.idx) && v.idx !== par.mun.idx) linhaCadeia(par.mun, v);
      });
    });
    feedback("✔ " + r.revelados.map(function (par) { return nomeUF(par.mun); }).join(" · ") +
      (r.venceu ? " — 🌉 ligou!" : ""), "ok");
    $("input-palpite").value = "";
    atualizarPlacar();
    if (r.venceu) fimDeJogo(false);
  }

  // ---------------- modo Onde fica? (clique no mapa) ----------------
  var TELA_DE_TOQUE = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  function mostrarAlvoClique() {
    var alvo = jogo.alvoAtual();
    if (!alvo) return;
    $("alvo-clique").innerHTML = (TELA_DE_TOQUE
      ? "👆 Toque no mapa onde fica:<br><b>"
      : "🖱️ Clique no mapa onde fica:<br><b>") + nomeUF(alvo) +
      "</b> <small>· " + fmtPop(alvo.pop) + " hab." +
      (alvo.capital ? " · capital" : "") + "</small>";
  }

  function responderClique(lat, lng) {
    var r = jogo.responder(lat, lng);
    if (!r) return;
    // marca o clique (X), o lugar certo e a linha entre os dois
    var cx = proj.x(lng), cy = proj.y(lat);
    var vx = proj.x(r.mun.lng), vy = proj.y(r.mun.lat);
    elSvg("line", { x1: cx - 4, y1: cy - 4, x2: cx + 4, y2: cy + 4, "class": "marca-clique" }, gMarcas);
    elSvg("line", { x1: cx - 4, y1: cy + 4, x2: cx + 4, y2: cy - 4, "class": "marca-clique" }, gMarcas);
    elSvg("line", { x1: cx.toFixed(1), y1: cy.toFixed(1), x2: vx.toFixed(1), y2: vy.toFixed(1), "class": "linha-clique" }, gMarcas);
    pintarPonto(r.mun, "achada");
    elSvg("text", {
      x: vx.toFixed(1), y: vy.toFixed(1), "class": "rotulo-cidade",
    }, gMarcas).textContent = r.mun.nome;

    var rodada = jogo.resultados.length;
    var item = document.createElement("div");
    item.className = "item-jogada";
    item.innerHTML = "<b>" + rodada + ". " + nomeUF(r.mun) + "</b><br><small>erro de " +
      fmtInt(Math.round(r.distKm)) + " km · " + fmtPct(r.score) + "</small>";
    $("lista-jogo").prepend(item);
    feedback((r.score >= 0.995 ? "🎯 " : "") + r.mun.nome + ": erro de " +
      fmtInt(Math.round(r.distKm)) + " km — rodada vale " + fmtPct(r.score) + ".",
      r.score >= 0.6 ? "ok" : "erro");
    atualizarPlacar();
    if (jogo.encerrado) {
      fimDeJogo(false);
    } else {
      mostrarAlvoClique();
    }
  }

  // ---------------- dicas ----------------
  function pedirDica() {
    if (!jogo || jogo.encerrado) return;
    var caixa = $("dica-atual");
    if (jogoModo === "ondestou") {
      var d = jogo.dica();
      if (!d) return;
      dicasUsadas = jogo.dicasDadas;
      var texto = d.tipo === "uf" ? "o município secreto fica em <b>" + NOMES_UF[d.valor] + " (" + d.valor + ")</b>"
        : d.tipo === "letra" ? "o nome começa com <b>«" + d.valor + "»</b>"
        : "tem <b>" + fmtPop(d.valor) + " hab.</b>";
      caixa.innerHTML = "💡 Dica " + d.etapa + "/3 (+1 palpite): " + texto + ".";
      caixa.hidden = false;
    } else if (jogoModo === "maratona") {
      var dm = jogo.dica();
      if (!dm) return;
      caixa.innerHTML = "💡 O maior que falta: começa com <b>«" + dm.mun.nome.charAt(0) +
        "»</b>, fica em <b>" + dm.mun.uf + "</b> e tem <b>" + fmtPop(dm.mun.pop) + " hab.</b>";
      caixa.hidden = false;
    } else if (jogoModo === "caminho" || jogoModo === "ponte" || jogoModo === "mancha") {
      var dv = jogo.dica(); // caminho e ponte já contam o custo no motor
      if (!dv) return;
      dicasUsadas++;        // na mancha o desconto sai daqui no fim da partida
      var custo = jogoModo === "caminho" ? "+1 salto"
        : jogoModo === "ponte" ? "+1 município"
        : "−1 município no resultado";
      var quem = jogoModo === "caminho" ? "O próximo passo de um caminho mínimo"
        : jogoModo === "ponte" ? "Um bom próximo elo"
        : "O maior vizinho da sua mancha";
      caixa.innerHTML = "💡 (" + custo + ") " + quem + ": começa com <b>«" +
        dv.mun.nome.charAt(0) + "»</b>, fica em <b>" + dv.mun.uf + "</b> e tem <b>" +
        fmtPop(dv.mun.pop) + " hab.</b>";
      caixa.hidden = false;
    } else {
      if (dicasUsadas >= 3) return;
      var df = jogo.dica();
      if (!df) return;
      dicasUsadas++;
      var onde = df.rank !== undefined
        ? "é o <b>" + df.rank + "º</b> do ranking"
        : jogoModo === "cerco"
        ? "fica em <b>" + df.mun.uf + "</b>"
        : "está na " + (jogo.cfg.tipo === "grade" ? "célula" : "faixa") + " <b>" + df.faixa.rotulo + "</b>";
      caixa.innerHTML = "💡 Dica " + dicasUsadas + "/3 (−1 acerto): o maior " +
        (jogoModo === "cerco" ? "vizinho" : "alvo") + " que falta começa com <b>«" +
        df.mun.nome.charAt(0) + "»</b>, tem <b>" + fmtPop(df.mun.pop) + " hab.</b> e " + onde + ".";
      caixa.hidden = false;
    }
    atualizarBotaoDica();
    atualizarPlacar();
    $("input-palpite").focus();
  }

  function fimDeJogo(desistiu, porTempo) {
    clearInterval(timerInt);
    var tempoSeg = tempoDecorrido();
    if (limiteSeg !== null && tempoSeg > limiteSeg) tempoSeg = limiteSeg;
    var faltantes = null;
    if (jogoModo === "faixas" || jogoModo === "topn" || jogoModo === "cerco") {
      faltantes = jogo.encerrar();
      if (desistiu) {
        faltantes.forEach(function (par) {
          revelarAlvo(par.mun, par.faixa || null, true, par.rank);
        });
      }
    } else if (jogoModo === "caminho" || jogoModo === "ponte") {
      // revela um caminho mínimo: pontilhado azul quando venceu (compare com
      // o seu), vermelho com os municípios que faltaram quando desistiu
      var minC = jogo.encerrar();
      if (minC) {
        desenharCaminhoMinimo(minC, !jogo.venceu);
        if (!jogo.venceu) {
          minC.forEach(function (m) {
            var p = pontos[m.idx];
            if (!MARCA_FORMA.test(p.getAttribute("class"))) {
              p.setAttribute("class", "cidade faltante");
              sincronizarForma(m);
            }
          });
        }
      }
    } else if (jogoModo === "ondestou") {
      var secreto = jogo.encerrar();
      if (!jogo.venceu) {
        pontos[secreto.idx].setAttribute("class", "cidade faltante");
        pontos[secreto.idx].style.fill = "";
        sincronizarForma(secreto);
        elSvg("text", {
          x: proj.x(secreto.lng).toFixed(1),
          y: proj.y(secreto.lat).toFixed(1),
          "class": "rotulo-cidade faltante",
        }, gMarcas).textContent = secreto.nome;
      }
    } else {
      jogo.encerrado = true;
    }
    atualizarPlacar();
    $("input-palpite").disabled = true;
    $("btn-palpitar").disabled = true;
    $("btn-encerrar").hidden = true;
    $("btn-dica").hidden = true;
    $("alvo-clique").hidden = true;
    svg.classList.remove("modo-clique"); // fim da partida: os pontos podem voltar
    setConfigTravada(false);
    $("btn-iniciar").textContent = "▶ Jogar de novo";

    var pct = jogo.pct();
    var placar;
    if (jogoModo === "faixas" || jogoModo === "topn" || jogoModo === "cerco") {
      // cada dica pedida desconta um acerto do resultado final
      pct = Math.max(0, (jogo.achadosTotal - dicasUsadas) / jogo.alvosTotal);
      placar = jogo.achadosTotal + "/" + jogo.alvosTotal +
        (jogoModo === "faixas" ? " respostas" : jogoModo === "cerco" ? " vizinhos" : " cidades") +
        (dicasUsadas > 0 ? " (" + dicasUsadas + (dicasUsadas === 1 ? " dica" : " dicas") + ")" : "");
    } else if (jogoModo === "caminho") {
      placar = jogo.venceu
        ? jogo.saltos + (jogo.saltos === 1 ? " salto" : " saltos") + " (mínimo " + jogo.minSaltos + ")" +
          (jogo.dicasDadas > 0 ? " · " + jogo.dicasDadas + " em dicas" : "")
        : "desistiu a " + jogo.saltosRestantes() + " saltos do destino";
    } else if (jogoModo === "mancha") {
      // cada dica pedida desconta um município do resultado final
      pct = Math.max(0, (jogo.mancha.size - dicasUsadas) / jogo.alvosTotal);
      placar = fmtInt(jogo.mancha.size) + " municípios · " + fmtPop(jogo.popMancha) + " hab." +
        (dicasUsadas > 0 ? " (" + dicasUsadas + (dicasUsadas === 1 ? " dica" : " dicas") + ")" : "");
    } else if (jogoModo === "ponte") {
      placar = jogo.venceu
        ? "ligou com " + jogo.usados + (jogo.usados === 1 ? " município" : " municípios") +
          " (mínimo " + jogo.minMeio + ")" +
          (jogo.dicasDadas > 0 ? " · " + jogo.dicasDadas + " em dicas" : "")
        : "desistiu com " + jogo.usados + " municípios marcados";
    } else if (jogoModo === "ondestou") {
      placar = jogo.venceu
        ? "acertou em " + jogo.totalPalpites() +
          (jogo.totalPalpites() === 1 ? " palpite" : " palpites") +
          (jogo.dicasDadas > 0 ? " (" + jogo.dicasDadas + " em dicas)" : "")
        : "desistiu após " + jogo.palpites.length + " palpites";
    } else if (jogoModo === "clique") {
      placar = "erro médio " + fmtInt(Math.round(jogo.erroMedioKm())) + " km em " +
        jogo.resultados.length + " rodadas";
    } else if (jogoModo === "dist" && jogo.cfg.metrica === "cidades") {
      placar = fmtInt(jogo.cobertos.size) + " cidades";
    } else if (jogoModo === "dist" && jogo.cfg.metrica === "area") {
      placar = fmtArea(jogo.areaCoberta);
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
    if (jogoModo === "ondestou") {
      var s = jogo.secreto;
      return "<div class='relatorio'>" +
        (jogo.venceu ? "O município era " : "O município era <b>") + nomeUF(s) +
        (jogo.venceu ? "" : "</b>") + " — " + fmtPop(s.pop) + " hab." +
        (s.capital ? " (capital)" : "") + "</div>";
    }
    if (jogoModo === "clique") {
      if (jogo.resultados.length === 0) return "";
      var piores = jogo.resultados.slice().sort(function (a, b) { return b.distKm - a.distKm; });
      itens = piores.slice(0, 3).map(function (r) {
        return nomeUF(r.mun) + " (" + fmtInt(Math.round(r.distKm)) + " km)";
      });
      var acertos = jogo.resultados.filter(function (r) { return r.score >= 0.995; }).length;
      return "<div class='relatorio'>" +
        (acertos > 0 ? "🎯 Na mosca (até 15 km): <b>" + acertos + "</b>. " : "") +
        "Piores erros: " + itens.join(" · ") + ".</div>";
    }
    if (jogoModo === "caminho") {
      if (!jogo.venceu) {
        return "<div class='relatorio'>Você parou em <b>" + nomeUF(jogo.atual) +
          "</b> — o traçado pontilhado mostra um caminho mínimo (" +
          jogo.minSaltos + " saltos).</div>";
      }
      return "<div class='relatorio'>" + (jogo.saltos + jogo.dicasDadas <= jogo.minSaltos
        ? "🏆 Caminho perfeito — impossível fazer em menos saltos!"
        : "O mínimo eram " + jogo.minSaltos + " saltos — o traçado pontilhado mostra um caminho ótimo.") +
        "</div>";
    }
    if (jogoModo === "ponte") {
      return "<div class='relatorio'>" + (!jogo.venceu
        ? "O traçado pontilhado mostra uma ligação mínima (" + jogo.minMeio + " municípios no meio)."
        : jogo.usados + jogo.dicasDadas <= jogo.minMeio
        ? "🏆 Ponte perfeita — impossível ligar com menos municípios!"
        : "Dava para ligar com " + jogo.minMeio + " municípios — o traçado pontilhado mostra como.") +
        "</div>";
    }
    if (jogoModo === "mancha") {
      var foraM = jogo.maioresDeFora(5);
      if (foraM.length === 0) return "";
      return "<div class='relatorio'>Maiores vizinhos da mancha que ficaram de fora: " +
        foraM.map(function (m) { return nomeUF(m) + " — " + fmtPop(m.pop); }).join(" · ") +
        ".</div>";
    }
    if (jogoModo === "dist" || jogoModo === "pop") {
      // no objetivo de área, "maior" é por território; nos demais, por população
      var porArea = jogoModo === "dist" && jogo.cfg.metrica === "area";
      var fora = jogo.universo.filter(function (m) { return !jogo.cobertos.has(m.idx); });
      if (fora.length === 0) return "";
      var maiores = porArea
        ? fora.slice().sort(function (a, b) { return b.area - a.area; }).slice(0, 5)
        : fora.slice(0, 5);
      itens = maiores.map(function (m) {
        return nomeUF(m) + " — " + (porArea ? fmtArea(m.area) : fmtPop(m.pop));
      });
      return "<div class='relatorio'>Ficou na mesa: <b>" +
        (porArea ? fmtArea(jogo.uniArea - jogo.areaCoberta)
          : fmtPop(jogo.uniPop - jogo.popCoberta) + " hab.") + "</b> em " +
        fmtInt(fora.length) + " cidades.<br>" +
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
    // Os rótulos ("A1 0/2") têm tamanho fixo na tela; numa faixa estreita
    // demais (grade de 50 km no Brasil inteiro, por exemplo) eles cobririam
    // o mapa. Até que fração visível o rótulo cabe no espaço da faixa? Além
    // dela, aplicarViewBox esconde os rótulos até o zoom aproximar.
    var f0 = jogo.faixas[0];
    if (!f0) zoomMaxRotulos = Infinity;
    else if (cfg.tipo === "lat") zoomMaxRotulos = (proj.y(f0.latInf) - proj.y(f0.latSup)) / 16;
    else if (cfg.tipo === "lng") zoomMaxRotulos = (proj.x(f0.lngLeste) - proj.x(f0.lngOeste)) / 34;
    else if (cfg.tipo === "grade") zoomMaxRotulos = Math.min(
      (proj.x(f0.lngLeste) - proj.x(f0.lngOeste)) / 60,
      (proj.y(f0.latInf) - proj.y(f0.latSup)) / 16);
    else zoomMaxRotulos = ((proj.y(0) - proj.y(1)) / GEO.KM_POR_GRAU) * cfg.largura / 16;
    atualizarRotulosFaixas();
    jogo.faixas.forEach(function (f) {
      var cx, cy;
      if (cfg.tipo === "lat") {
        var y1 = proj.y(Math.min(f.latSup, ext.latMax));
        var y2 = proj.y(Math.max(f.latInf, ext.latMin));
        f._elArea = elSvg("rect", { x: exX1.toFixed(1), y: y1.toFixed(1), width: (exX2 - exX1).toFixed(1), height: (y2 - y1).toFixed(1), "class": "faixa-area" }, gFaixas);
        elSvg("line", { x1: exX1.toFixed(1), y1: y2.toFixed(1), x2: exX2.toFixed(1), y2: y2.toFixed(1), "class": "linha-faixa" }, gFaixas);
        cx = exX1 + 8; cy = (y1 + y2) / 2 + 4;
      } else if (cfg.tipo === "lng") {
        var x1 = proj.x(Math.max(f.lngOeste, ext.lngMin));
        var x2 = proj.x(Math.min(f.lngLeste, ext.lngMax));
        f._elArea = elSvg("rect", { x: x1.toFixed(1), y: exY1.toFixed(1), width: (x2 - x1).toFixed(1), height: (exY2 - exY1).toFixed(1), "class": "faixa-area" }, gFaixas);
        elSvg("line", { x1: x2.toFixed(1), y1: exY1.toFixed(1), x2: x2.toFixed(1), y2: exY2.toFixed(1), "class": "linha-faixa" }, gFaixas);
        cx = (x1 + x2) / 2 - 8; cy = exY1 + 14;
      } else if (cfg.tipo === "grade") {
        var gx1 = proj.x(Math.max(f.lngOeste, ext.lngMin));
        var gx2 = proj.x(Math.min(f.lngLeste, ext.lngMax));
        var gy1 = proj.y(Math.min(f.latSup, ext.latMax));
        var gy2 = proj.y(Math.max(f.latInf, ext.latMin));
        f._elArea = elSvg("rect", { x: gx1.toFixed(1), y: gy1.toFixed(1), width: (gx2 - gx1).toFixed(1), height: (gy2 - gy1).toFixed(1), "class": "faixa-area" }, gFaixas);
        elSvg("rect", { x: gx1.toFixed(1), y: gy1.toFixed(1), width: (gx2 - gx1).toFixed(1), height: (gy2 - gy1).toFixed(1), "class": "linha-faixa" }, gFaixas);
        cx = gx1 + 3; cy = gy1 + 12;
      } else {
        // anel: a área é a coroa entre os dois raios (fill-rule evenodd faz o
        // círculo interno virar buraco)
        var dAnel = caminhoGeodesico(cfg.centro.lat, cfg.centro.lng, f.kmExterno) +
          (f.kmInterno > 0 ? caminhoGeodesico(cfg.centro.lat, cfg.centro.lng, f.kmInterno) : "");
        f._elArea = elSvg("path", { d: dAnel, "fill-rule": "evenodd", "class": "faixa-area" }, gFaixas);
        elSvg("path", { d: caminhoGeodesico(cfg.centro.lat, cfg.centro.lng, f.kmExterno), "class": "linha-faixa" }, gFaixas);
        var pMeio = GEO.destino(cfg.centro.lat, cfg.centro.lng, 0, (f.kmInterno + f.kmExterno) / 2);
        cx = proj.x(pMeio[1]) - 8; cy = proj.y(pMeio[0]) + 4;
      }
      atualizarAreaFaixa(f);
      f._elContador = elSvg("text", { x: cx.toFixed(1), y: cy.toFixed(1), "class": "contador-faixa" }, gFaixas);
      f._elContador.textContent = rotuloContador(f);
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
  // Faixas de tamanho para o placar "quantas já acertei desse porte"
  var FAIXAS_POP = [
    { min: 1e6, rotulo: "1 mi ou mais" },
    { min: 5e5, rotulo: "500 mil a 1 mi" },
    { min: 2e5, rotulo: "200 a 500 mil" },
    { min: 1e5, rotulo: "100 a 200 mil" },
    { min: 5e4, rotulo: "50 a 100 mil" },
    { min: 0, rotulo: "menos de 50 mil" },
  ];
  var topnPorte = null; // linhas de contagem por faixa de população

  function montarListaTopN(jogo) {
    var alvo = $("lista-jogo");
    alvo.innerHTML = "";
    var item = document.createElement("div");
    item.className = "item-faixa";
    var chips = jogo.alvos.map(function (m, i) {
      return '<span class="chip" data-rank="' + (i + 1) + '">' + (i + 1) + " •••</span>";
    }).join("");
    var portes = FAIXAS_POP.map(function (fx) {
      return { min: fx.min, rotulo: fx.rotulo, total: 0, achados: 0 };
    });
    // cada alvo cai na primeira faixa (de cima para baixo) que a população alcança
    jogo.alvos.forEach(function (m) {
      for (var i = 0; i < portes.length; i++) {
        if (m.pop >= portes[i].min) { portes[i].total++; break; }
      }
    });
    var htmlPortes = portes.map(function (p, i) {
      if (p.total === 0) return "";
      return "<div class='linha-porte'><span>" + p.rotulo +
        "</span><b id='topn-porte-" + i + "'>0/" + p.total + "</b></div>";
    }).join("");
    item.innerHTML = "<div class='titulo-faixa'><span>As " + jogo.alvosTotal +
      " maiores</span><span id='topn-contador'>0/" + jogo.alvosTotal +
      "</span></div><div class='portes'>" + htmlPortes +
      "</div><div class='chips'>" + chips + "</div>";
    alvo.appendChild(item);
    topnChips = {};
    item.querySelectorAll(".chip").forEach(function (c) {
      topnChips[c.dataset.rank] = c;
    });
    topnPorte = portes.map(function (p, i) {
      p.el = document.getElementById("topn-porte-" + i);
      return p;
    });
  }

  function atualizarChipTopN(rank, mun, faltante) {
    var chip = topnChips && topnChips[rank];
    if (!chip) return;
    chip.textContent = rank + ". " + nomeUF(mun);
    chip.className = "chip " + (faltante ? "faltante" : "achado");
    var cont = document.getElementById("topn-contador");
    if (cont) cont.textContent = jogo.achadosTotal + "/" + jogo.alvosTotal;
    if (!faltante && topnPorte) {
      for (var i = 0; i < topnPorte.length; i++) {
        var p = topnPorte[i];
        if (mun.pop >= p.min) {
          p.achados++;
          if (p.el) {
            p.el.textContent = p.achados + "/" + p.total;
            p.el.classList.toggle("completo", p.achados === p.total);
          }
          break;
        }
      }
    }
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
    // preenche um campo de cidade ("Nome, UF") a partir do id do IBGE na chave
    function setCidade(id, idIbge) {
      if (idIbge === undefined) return;
      DADOS.municipios.forEach(function (m) {
        if (String(m.id) === idIbge) $(id).value = m.nome + ", " + m.uf;
      });
    }
    $("cfg-regiao").value = p.uf && NOMES_UF[p.uf] ? p.uf : "BR";
    if (modo === "dist" || modo === "pop") {
      if (modo === "dist") {
        setVal("cfg-dist-raio", p.raio);
        if (p.metrica) $("cfg-dist-metrica").value = p.metrica;
      } else {
        setVal("cfg-pop-alvo", p.alvo);
      }
      $("cfg-" + modo + "-homonimos").checked = p.homonimos === "1";
      $("cfg-" + modo + "-bloqueio").checked = p.bloqueio === "1";
      $("cfg-" + modo + "-limite").value = p.tempo ? "tempo" : "palpites";
      setVal("cfg-" + modo + "-tempo", p.tempo);
      setVal("cfg-" + modo + "-palpites", p.palpites);
    } else if (modo === "ondestou") {
      setVal("cfg-onde-pool", p.pool);
    } else if (modo === "clique") {
      setVal("cfg-clique-pool", p.pool);
      setVal("cfg-clique-rodadas", p.rodadas);
    } else if (modo === "maratona") {
      // maratona não tem parâmetros além da região
    } else if (modo === "caminho") {
      setCidade("cfg-caminho-origem", p.de);
      setCidade("cfg-caminho-destino", p.para);
    } else if (modo === "cerco") {
      $("cfg-cerco-alvo").value = "";
      setCidade("cfg-cerco-alvo", p.alvo);
      setVal("cfg-cerco-pool", p.pool);
    } else if (modo === "mancha") {
      $("cfg-mancha-limite").value = p.tempo ? "tempo" : "livre";
      setVal("cfg-mancha-tempo", p.tempo);
    } else if (modo === "ponte") {
      setVal("cfg-ponte-pool", p.pool);
    } else if (modo === "faixas") {
      if (p.tipo) $("cfg-faixas-tipo").value = p.tipo;
      $("rotulo-centro").hidden = $("cfg-faixas-tipo").value !== "aneis";
      setVal("cfg-faixas-largura", p.largura);
      setVal("cfg-faixas-topn", p.top);
      setCidade("cfg-faixas-centro", p.centro);
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
  // O tooltip responde ao ponto da sede e, com ⬡ Formas ligado, ao polígono
  // inteiro do município. Só elementos marcados têm pointer-events no CSS,
  // então um alvo com data-idx aqui nunca entrega cidade não descoberta.
  svg.addEventListener("mousemove", function (ev) {
    var t = ev.target;
    if (t.dataset && t.dataset.idx !== undefined &&
        (t.tagName === "path" || t.getAttribute("class") !== "cidade")) {
      var m = DADOS.municipios[+t.dataset.idx];
      tooltip.innerHTML = "<b>" + nomeUF(m) + "</b> · " + fmtInt(m.pop) + " hab. · " + fmtArea(m.area);
      tooltip.hidden = false;
      var wrap = $("mapa-wrap").getBoundingClientRect();
      tooltip.style.left = ev.clientX - wrap.left + 14 + "px";
      tooltip.style.top = ev.clientY - wrap.top + 10 + "px";
    } else {
      tooltip.hidden = true;
    }
  });
  svg.addEventListener("mouseleave", function () { tooltip.hidden = true; });

  // aplica um fator de zoom mantendo o ponto (fx, fy) — frações 0..1 da área
  // visível — parado na tela
  function zoomEm(fator, fx, fy) {
    var novoW = Math.min(vbBase.w, Math.max(vbBase.w / 40, vb.w * fator));
    var novoH = novoW * (vbBase.h / vbBase.w);
    vb.x = Math.max(0, Math.min(vbBase.w - novoW, vb.x + fx * (vb.w - novoW)));
    vb.y = Math.max(0, Math.min(vbBase.h - novoH, vb.y + fy * (vb.h - novoH)));
    vb.w = novoW;
    vb.h = novoH;
    aplicarViewBox();
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

  // Arrasto, toque e pinça via Pointer Events: mouse e dedo seguem o mesmo
  // caminho — um ponteiro arrasta (ou clica), dois fazem pinça (zoom). O
  // touch-action: none no CSS impede o navegador de rolar/ampliar a página
  // por cima do mapa; o setPointerCapture garante o pointerup mesmo quando o
  // dedo sai do mapa no meio do gesto.
  var arrasto = null;
  var ponteiros = [];    // ponteiros (dedos/mouse) ativos sobre o mapa
  var pinca = null;      // distância e centro da pinça no quadro anterior
  var ultimoToque = null; // para o toque duplo (restaura o mapa inteiro)

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
      cliqueInicio = { x: ev.clientX, y: ev.clientY };
      svg.classList.add("arrastando");
    } else if (ponteiros.length === 2) {
      // entrou o segundo dedo: vira pinça — e deixa de poder ser um clique
      arrasto = null;
      cliqueInicio = null;
      tooltip.hidden = true;
      pinca = medidaPinca();
    } else {
      pinca = null; // 3+ dedos: espera sobrarem dois
    }
  });

  svg.addEventListener("pointermove", function (ev) {
    var i = acharPonteiro(ev.pointerId);
    if (i === -1) return;
    ponteiros[i].x = ev.clientX;
    ponteiros[i].y = ev.clientY;
    if (ponteiros.length === 2 && pinca) {
      var agora = medidaPinca();
      // zoom em torno do centro dos dedos…
      var p = pontoDoMapa(agora.cx, agora.cy);
      zoomEm(pinca.d / agora.d,
        Math.max(0, Math.min(1, (p.x - vb.x) / vb.w)),
        Math.max(0, Math.min(1, (p.y - vb.y) / vb.h)));
      // …mais o deslocamento do próprio centro (pinça também arrasta)
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

  function soltarPonteiro(ev, cancelado) {
    var i = acharPonteiro(ev.pointerId);
    if (i === -1) return;
    ponteiros.splice(i, 1);
    if (ponteiros.length === 1) {
      // da pinça sobrou um dedo: recomeça o arrasto de onde ele está
      arrasto = { x: ponteiros[0].x, y: ponteiros[0].y, vbx: vb.x, vby: vb.y };
      pinca = null;
      return;
    }
    if (ponteiros.length > 0) return;
    svg.classList.remove("arrastando");
    arrasto = null;
    pinca = null;
    var inicio = cliqueInicio;
    cliqueInicio = null;
    if (cancelado || !inicio) return;
    // tolerância maior no dedo: ninguém toca a tela com precisão de mouse
    var moveu = Math.abs(ev.clientX - inicio.x) + Math.abs(ev.clientY - inicio.y);
    if (moveu > (ev.pointerType === "mouse" ? 5 : 12)) {
      ultimoToque = null;
      return;
    }
    // toque duplo faz as vezes do duplo clique do mouse: restaura o zoom
    // (fora de uma partida de clique, em que dois toques são duas respostas)
    if (ev.pointerType !== "mouse") {
      var agoraMs = Date.now();
      var emClique = jogoModo === "clique" && jogo && !jogo.encerrado;
      if (!emClique && ultimoToque && agoraMs - ultimoToque.t < 350 &&
          Math.abs(ev.clientX - ultimoToque.x) + Math.abs(ev.clientY - ultimoToque.y) < 50) {
        ultimoToque = null;
        vb = { x: vbBase.x, y: vbBase.y, w: vbBase.w, h: vbBase.h };
        aplicarViewBox();
        return;
      }
      ultimoToque = { t: agoraMs, x: ev.clientX, y: ev.clientY };
    }
    // clique/toque (sem arrasto) no modo "Onde fica?": vira a resposta da rodada
    if (jogoModo !== "clique" || !jogo || jogo.encerrado) return;
    var p = pontoDoMapa(ev.clientX, ev.clientY);
    responderClique(proj.latDe(p.y), proj.lngDe(p.x));
  }
  svg.addEventListener("pointerup", function (ev) { soltarPonteiro(ev, false); });
  svg.addEventListener("pointercancel", function (ev) { soltarPonteiro(ev, true); });
  svg.addEventListener("dblclick", function () {
    // no meio de uma partida de clique, dois cliques são duas respostas — não
    // podem também resetar o zoom
    if (jogoModo === "clique" && jogo && !jogo.encerrado) return;
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
      // já deixa o grafo de divisas baixando em segundo plano
      if (MODOS_COM_VIZINHOS[modoAtual]) carregarVizinhos(null, true);
      // trocar de modo abandona a partida em andamento (a maratona salva antes)
      if (jogo && !jogo.encerrado) {
        salvarProgressoMaratona();
        clearInterval(timerInt);
        jogo = null;
      }
      $("area-jogo").hidden = true;
      document.body.classList.remove("jogo-ativo");
      $("legenda-pop").hidden = true;
      $("legenda-dist").hidden = true;
      $("btn-desafio").hidden = modoAtual === "maratona";
      svg.classList.remove("modo-clique");
      $("linha-palpite").hidden = false;
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
    $("rotulo-mancha-tempo").hidden = $("cfg-mancha-limite").value !== "tempo";
  }
  document.querySelectorAll(".sel-limite").forEach(function (s) {
    s.addEventListener("change", atualizarCamposLimite);
  });
  document.querySelectorAll("#config input, #config select").forEach(function (c) {
    c.addEventListener("change", atualizarRecordeUI);
  });

  $("btn-iniciar").addEventListener("click", iniciar);
  // o pointerdown cancelado impede o botão de roubar o foco do campo de
  // texto — no celular isso manteria o teclado fechando e abrindo a cada OK
  $("btn-palpitar").addEventListener("pointerdown", function (ev) { ev.preventDefault(); });
  $("btn-palpitar").addEventListener("click", function () {
    palpitar();
    if (jogo && !jogo.encerrado && !$("linha-palpite").hidden) $("input-palpite").focus();
  });
  $("input-palpite").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") { ev.preventDefault(); palpitar(); }
  });
  $("btn-encerrar").addEventListener("click", function () {
    if (!jogo || jogo.encerrado) return;
    if (jogoModo === "maratona") fimSessaoMaratona(false);
    else fimDeJogo(true);
  });
  $("btn-dica").addEventListener("pointerdown", function (ev) { ev.preventDefault(); });
  $("btn-dica").addEventListener("click", pedirDica);
  // atalho das telas pequenas para voltar à configuração: reclicar a aba
  // ativa encerra/pausa a partida e reabre o painel de modos
  $("btn-config-mobile").addEventListener("click", function () {
    document.querySelector("#abas-modo .aba.ativa").click();
  });
  $("btn-zerar-maratona").addEventListener("click", function () {
    var regiao = ufDoJogo() || "BR";
    var nome = regiao === "BR" ? "do Brasil inteiro" : "de " + NOMES_UF[regiao];
    if (!confirm("Apagar TODO o progresso da maratona " + nome + "? Isso não tem volta.")) return;
    zerarMaratona(regiao);
    if (jogo && jogoModo === "maratona") {
      clearInterval(timerInt);
      jogo = null;
      $("area-jogo").hidden = true;
      document.body.classList.remove("jogo-ativo");
      limparCamadasDeJogo();
      setConfigTravada(false);
      $("btn-iniciar").textContent = "▶ Iniciar jogo";
    }
    atualizarRecordeUI();
  });
  $("config").addEventListener("submit", function (ev) { ev.preventDefault(); });

  $("btn-satelite").addEventListener("click", function () {
    setSatelite(!svg.classList.contains("satelite"));
  });

  $("btn-pontos").addEventListener("click", function () {
    setPontosOcultos(!svg.classList.contains("sem-pontos"));
  });

  $("btn-formas").addEventListener("click", function () {
    setFormas(!formasLigadas);
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
  // em tela de toque, a dica de navegação fala de dedos, não de mouse
  if (TELA_DE_TOQUE) {
    $("dica-zoom").textContent = "pinça: zoom · arraste: mover · toque duplo: mapa inteiro";
  }
  $("descricao-modo").textContent = DESCRICOES[modoAtual];
  atualizarCamposLimite();
  atualizarRecordeUI();
  aplicarDesafioDaURL();
  // um link de desafio colado na aba já aberta também vale
  window.addEventListener("hashchange", aplicarDesafioDaURL);
  try {
    if (localStorage.getItem(LS_SATELITE) === "1") setSatelite(true);
    if (localStorage.getItem(LS_FORMAS) === "1") setFormas(true);
    setPontosOcultos(localStorage.getItem(LS_PONTOS) === "1");
  } catch (e) {
    setPontosOcultos(false);
  }
})();
