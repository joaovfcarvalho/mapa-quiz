"use strict";
// Separate dataset and record keys: municipalities and rivers stay independent.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function normalizar(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ''); }
  function fmtTempo(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  var alvos = BAIRROS_RIO.map(function (b) { return Object.assign({}, b); });
  var metricas = BAIRROS_METRICAS.criar(alvos, BAIRROS_RIO_META);
  var objetivos = { bairros: 'Bairros', populacao: 'População', area: 'Área' };
  function numero(n, casas) { return n.toLocaleString('pt-BR', { maximumFractionDigits: casas || 0 }); }
  function percentual(n) { return n.toFixed(1).replace('.', ',') + '%'; }
  function resumo() { return metricas.resumo(new Set(alvos.filter(function (b) { return b.achado; }).map(function (b) { return b.id; }))); }
  function info(b) {
    var pop = b.populacao === null ? 'população incluída em Brás de Pina' : numero(b.populacao) + ' hab.' + (b.id === '045' ? ' (com Argentino)' : '');
    return pop + ' · ' + numero(b.area, 2) + ' km²';
  }
  function resultadoMetrica(r, objetivo) {
    var valor = objetivo === 'populacao' ? numero(r.populacao) + ' hab.' : objetivo === 'area' ? numero(r.area, 2) + ' km²' : r.bairros + ' de ' + alvos.length + ' bairros';
    return percentual(r.pct[objetivo]) + ' · ' + valor;
  }
  var indice = new Map();
  function indexar(nome, b) {
    var chave = normalizar(nome), lista = indice.get(chave) || [];
    if (!lista.includes(b)) lista.push(b);
    indice.set(chave, lista);
  }
  alvos.forEach(function (b) {
    indexar(b.nome, b);
    // Freguesia is ambiguous: require its location instead of awarding both.
    if (b.nome.startsWith('Freguesia')) {
      var ilha = normalizar(b.ra).includes('ilha');
      b.nome = ilha ? 'Freguesia (Ilha do Governador)' : 'Freguesia (Jacarepaguá)';
      indexar('Freguesia', b);
      indexar(b.nome, b);
      indexar(ilha ? 'Freguesia da Ilha' : 'Freguesia de Jacarepaguá', b);
    }
    if (normalizar(b.nome).includes('saocristovao')) indexar('São Cristóvão', b);
  });
  var bounds = { latMin: 90, latMax: -90, lngMin: 180, lngMax: -180 };
  alvos.forEach(function (b) { b.aneis.forEach(function (r) { r.forEach(function (p) {
    bounds.latMin = Math.min(bounds.latMin, p[1]); bounds.latMax = Math.max(bounds.latMax, p[1]);
    bounds.lngMin = Math.min(bounds.lngMin, p[0]); bounds.lngMax = Math.max(bounds.lngMax, p[0]);
  }); }); });
  bounds.latMin -= .015; bounds.latMax += .015; bounds.lngMin -= .015; bounds.lngMax += .015;
  var proj = GEO.criarProjecao(bounds, 1000), svg = $('mapa');
  var vbBase = { x: 0, y: 0, w: proj.w, h: proj.h }, vb = Object.assign({}, vbBase);
  function aplicarViewBox() { svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].join(' ')); }
  aplicarViewBox();
  var tooltip = $('tooltip');
  function mostrarNome(b) { if (b.achado || (jogo && jogo.encerrado)) feedback(b.nome + ' · ' + info(b) + ' · RA ' + b.ra, 'ok'); }
  alvos.forEach(function (b) {
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', b.aneis.map(function (r) { return r.map(function (p, i) { return (i ? 'L' : 'M') + proj.x(p[0]).toFixed(2) + ' ' + proj.y(p[1]).toFixed(2); }).join('') + 'Z'; }).join(''));
    path.setAttribute('class', 'bairro');
    path.addEventListener('click', function () { mostrarNome(b); });
    path.addEventListener('focus', function () { mostrarNome(b); });
    path.addEventListener('mouseenter', function () {
      if (!b.achado && !(jogo && jogo.encerrado)) return;
      tooltip.textContent = b.nome + ' · ' + info(b); tooltip.hidden = false;
      tooltip.style.left = '12px'; tooltip.style.top = '60px';
    });
    path.addEventListener('mouseleave', function () { tooltip.hidden = true; });
    svg.appendChild(path); b.el = path;
  });
  var jogo = null;
  function config() {
    var minutos = $('cfg-limite').value === 'tempo' ? Math.max(1, Math.min(240, parseInt($('cfg-tempo').value, 10) || 10)) : 0;
    var objetivo = $('cfg-objetivo').value;
    // Keep existing count records; weighted objectives have independent versioned keys.
    var chave = 'bairros-rio|base=2026-09|tempo=' + minutos;
    if (objetivo !== 'bairros') chave += '|objetivo=' + objetivo + '|dados=' + BAIRROS_RIO_META.versaoMetricas;
    return { minutos: minutos, objetivo: objetivo, chave: chave, rotulo: 'Bairros do Rio · ' + objetivos[objetivo] + ' · ' + (minutos ? minutos + ' min' : 'sem limite') };
  }
  function atualizarConfig() {
    var cfg = config(), rec = RECORDES.obter(cfg.chave);
    $('rotulo-tempo').hidden = !cfg.minutos;
    $('resumo-conjunto').textContent = alvos.length + ' bairros · ' + numero(metricas.total.populacao) + ' habitantes · ' + numero(metricas.total.area, 2) + ' km². Seu recorde vale pelo percentual de ' + objetivos[cfg.objetivo].toLowerCase() + '. ' + (cfg.minutos ? cfg.minutos + ' minutos.' : 'Jogue no seu ritmo.');
    $('recorde-atual').hidden = !rec;
    if (rec) $('recorde-atual').textContent = 'Seu recorde: ' + rec.placar + ' em ' + fmtTempo(rec.tempoSeg) + '.';
  }
  function tempo() { return jogo.encerrado ? jogo.tempoFinal : Math.floor((Date.now() - jogo.inicio) / 1000); }
  function expirou() {
    if (jogo && !jogo.encerrado && jogo.cfg.minutos && tempo() >= jogo.cfg.minutos * 60) { encerrar(true); return true; }
    return false;
  }
  function placar() {
    var r = resumo(), t = tempo();
    $('barra-progresso').style.width = r.pct[jogo.cfg.objetivo] + '%';
    $('placar-linhas').replaceChildren();
    var ordem = [jogo.cfg.objetivo].concat(Object.keys(objetivos).filter(function (o) { return o !== jogo.cfg.objetivo; }));
    ordem.forEach(function (o) {
      var linha = document.createElement('span'); linha.dataset.metrica = o;
      linha.className = o === jogo.cfg.objetivo ? 'metrica-principal' : '';
      linha.textContent = objetivos[o] + ': ' + resultadoMetrica(r, o);
      $('placar-linhas').appendChild(linha);
    });
    var top = document.createElement('span'); top.id = 'placar-top10'; top.textContent = '★ Você acertou ' + r.top10 + ' dos 10 bairros mais populosos.';
    var tempoLinha = document.createElement('span'); tempoLinha.textContent = jogo.cfg.minutos && !jogo.encerrado ? 'Restam ' + fmtTempo(Math.max(0, jogo.cfg.minutos * 60 - t)) : 'Tempo: ' + fmtTempo(t);
    $('placar-linhas').append(top, tempoLinha);
  }
  function feedback(s, classe) { $('feedback').textContent = s; $('feedback').className = classe || ''; }
  function iniciar() {
    if (jogo) clearInterval(jogo.timer);
    jogo = { cfg: config(), inicio: Date.now(), achados: 0, dicas: 0, encerrado: false };
    alvos.forEach(function (b) { b.achado = false; b.el.setAttribute('class', 'bairro'); b.el.removeAttribute('tabindex'); b.el.removeAttribute('aria-label'); });
    vb = Object.assign({}, vbBase); aplicarViewBox();
    $('secao-config').hidden = true; $('secao-jogo').hidden = false;
    ['fim-jogo', 'fim-acoes', 'dica-atual'].forEach(function (id) { $(id).hidden = true; });
    ['input-palpite', 'btn-palpitar', 'btn-dica', 'btn-encerrar'].forEach(function (id) { $(id).disabled = false; });
    $('lista-acertos').replaceChildren(); $('input-palpite').value = ''; feedback('');
    $('jogo-titulo').textContent = 'Bairros do Rio';
    $('jogo-subtitulo').textContent = 'Objetivo: ' + objetivos[jogo.cfg.objetivo].toLowerCase() + ' · ' + alvos.length + ' bairros';
    document.body.classList.add('jogo-ativo'); placar(); $('input-palpite').focus();
    jogo.timer = setInterval(function () { if (!expirou()) placar(); }, 1000);
  }
  function palpitar() {
    if (!jogo || jogo.encerrado || expirou()) return;
    var texto = normalizar($('input-palpite').value); if (!texto) return;
    var encontrados = indice.get(texto) || [];
    if (!encontrados.length) { feedback('Não encontrei esse bairro. Vale o nome oficial de um bairro da cidade do Rio.', 'erro'); return; }
    if (encontrados.length > 1) { feedback('Qual Freguesia? Digite Freguesia (Jacarepaguá) ou Freguesia (Ilha do Governador).', 'erro'); return; }
    var b = encontrados[0];
    if (b.achado) { feedback(b.nome + ' já foi encontrado.', 'erro'); $('input-palpite').select(); return; }
    b.achado = true; jogo.achados++;
    alvos.forEach(function (a) { a.el.classList.remove('recente'); });
    b.el.classList.add('acertado', 'recente'); revelar(b);
    var item = document.createElement('div'), nome = document.createElement('b'), detalhe = document.createElement('small');
    nome.textContent = b.nome; detalhe.textContent = info(b); item.append(nome, detalhe); $('lista-acertos').prepend(item);
    var grupoPendente = (b.id === '045' || b.id === '166') && !alvos.filter(function (a) { return a.id === '045' || a.id === '166'; }).every(function (a) { return a.achado; });
    feedback('✓ ' + b.nome + ' · ' + info(b) + (grupoPendente ? '. A população conjunta entra ao acertar Brás de Pina e Argentino.' : ''), 'ok'); $('input-palpite').value = ''; $('input-palpite').focus(); $('dica-atual').hidden = true;
    placar(); if (jogo.achados === alvos.length) encerrar(false);
  }
  function revelar(b) { b.el.setAttribute('tabindex', '0'); b.el.setAttribute('aria-label', b.nome + ' · ' + info(b)); }
  function dica() {
    if (!jogo || jogo.encerrado || expirou()) return;
    var faltam = alvos.filter(function (b) { return !b.achado; });
    var b = faltam[jogo.dicas % faltam.length]; jogo.dicas++;
    $('dica-atual').hidden = false;
    $('dica-atual').textContent = 'Começa com “' + b.nome[0] + '” e fica na região administrativa ' + b.ra + '. Dica gratuita.';
  }
  function encerrar(porTempo) {
    if (!jogo || jogo.encerrado) return;
    jogo.tempoFinal = jogo.cfg.minutos ? Math.min(tempo(), jogo.cfg.minutos * 60) : tempo(); jogo.encerrado = true;
    clearInterval(jogo.timer);
    ['input-palpite', 'btn-palpitar', 'btn-dica', 'btn-encerrar'].forEach(function (id) { $(id).disabled = true; });
    $('dica-atual').hidden = true; tooltip.hidden = true;
    var faltam = alvos.filter(function (b) { return !b.achado; });
    alvos.forEach(function (b) { b.el.classList.remove('recente'); revelar(b); if (!b.achado) b.el.classList.add('faltante'); });
    var r = resumo();
    var resultado = objetivos[jogo.cfg.objetivo] + ': ' + resultadoMetrica(r, jogo.cfg.objetivo);
    var rec = RECORDES.registrar(jogo.cfg.chave, { pct: r.pct[jogo.cfg.objetivo], placar: resultado, rotulo: jogo.cfg.rotulo, tempoSeg: jogo.tempoFinal, data: new Date().toISOString() });
    $('fim-jogo').className = rec.melhor ? 'recorde' : '';
    $('fim-jogo').textContent = (porTempo ? 'Tempo esgotado! ' : !faltam.length ? 'Você completou o Rio! ' : '') + resultado + ' em ' + fmtTempo(jogo.tempoFinal) + ' · ' + jogo.dicas + ' dica(s). Você acertou ' + r.top10 + ' dos 10 bairros mais populosos.' + (rec.melhor ? ' 🏆 Novo recorde pessoal!' : '');
    if (faltam.length) {
      var details = document.createElement('details'), summary = document.createElement('summary'), ul = document.createElement('ul');
      details.className = 'relatorio'; summary.textContent = 'Ver os ' + faltam.length + ' bairros que faltaram (em coral no mapa)';
      faltam.sort(function (a, b) { return jogo.cfg.objetivo === 'bairros' ? a.nome.localeCompare(b.nome, 'pt-BR') : (b[jogo.cfg.objetivo] || 0) - (a[jogo.cfg.objetivo] || 0); });
      faltam.forEach(function (b) { var li = document.createElement('li'); li.textContent = b.nome + ' · ' + info(b); ul.appendChild(li); });
      details.append(summary, ul); $('fim-jogo').appendChild(details);
    }
    $('fim-jogo').hidden = false; $('fim-acoes').hidden = false; placar();
  }
  $('btn-iniciar').onclick = iniciar; $('btn-palpitar').onclick = palpitar; $('btn-dica').onclick = dica;
  $('btn-encerrar').onclick = function () { encerrar(false); };
  $('btn-de-novo').onclick = function () {
    clearInterval(jogo.timer); jogo = null; document.body.classList.remove('jogo-ativo');
    $('secao-jogo').hidden = true; $('secao-config').hidden = false; tooltip.hidden = true;
    alvos.forEach(function (b) { b.achado = false; b.el.setAttribute('class', 'bairro'); b.el.removeAttribute('tabindex'); b.el.removeAttribute('aria-label'); });
    atualizarConfig(); $('btn-iniciar').focus();
  };
  $('input-palpite').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); palpitar(); } });
  ['cfg-objetivo', 'cfg-limite', 'cfg-tempo'].forEach(function (id) { $(id).addEventListener('input', atualizarConfig); });
  $('btn-tracos').onclick = function () { var ocultos = svg.classList.toggle('sem-tracos'); $('btn-tracos').setAttribute('aria-pressed', String(!ocultos)); };
  $('btn-tracos').setAttribute('aria-pressed', 'true');
  $('fonte-data').textContent = 'Base consultada em ' + BAIRROS_RIO_META.consultadoEm.split('-').reverse().join('/') + '.';
  atualizarConfig();
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

})();
