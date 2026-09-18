"use strict";
// Painel, legenda, busca e carregamento das duas páginas do Censo 2022.
// O desenho do mapa em si está em js/censo-mapa.js; aqui fica tudo que é
// interface. A página passa um `recorte` descrevendo de onde vêm os dados e
// como nomear uma unidade.
var CENSO_PAGINA = (function () {
  var num = CENSO_MAPA.numero;

  function $(id) { return document.getElementById(id); }

  function iniciar(recorte) {
    var mapa = CENSO_MAPA.criar({
      canvas: $("mapa"),
      aoPassar: mostrarTooltip,
      aoSelecionar: mostrarDetalhe,
      aoRedesenhar: function () { $("pintando").hidden = true; },
    });
    mapa.redimensionar();
    if (window.BRASIL_UF) mapa.definirContorno(BRASIL_UF);

    var elCarregando = $("carregando");
    var elBarra = $("barra-progresso");
    var elCarregandoTexto = $("carregando-texto");

    // ------------------------------------------------------------ carregamento
    // Um <script> por arquivo (e não fetch) porque o site inteiro roda também
    // aberto direto do disco, onde fetch de arquivo local é bloqueado.
    function carregarSequencia(lista, pronto) {
      var i = 0;
      (function proximo() {
        if (i >= lista.length) return pronto();
        var item = lista[i];
        elCarregandoTexto.textContent = "Carregando " + item.rotulo +
          " (" + (i + 1) + " de " + lista.length + ")…";
        elBarra.style.width = (100 * i / lista.length) + "%";
        var tag = document.createElement("script");
        tag.src = item.arquivo;
        tag.onload = function () {
          var fonte = window[item.variavel];
          if (fonte) {
            var bloco = recorte.montarBloco(fonte, item);
            bloco.malha = CENSO_TOPO.decodificar(fonte);
            mapa.adicionarBloco(bloco);
            // a fonte crua chega a 15 MB de texto já virado array; sem soltar
            // aqui, o Brasil inteiro em setores não cabe na memória
            try { delete window[item.variavel]; } catch (erro) { window[item.variavel] = null; }
          }
          i++;
          mapa.recalcular();
          atualizarPainel();
          mapa.redesenhar();
          setTimeout(proximo, 0);
        };
        tag.onerror = function () {
          elCarregandoTexto.textContent = "Falhou ao carregar " + item.arquivo;
          i++;
          setTimeout(proximo, 0);
        };
        document.head.appendChild(tag);
      })();
    }

    // -------------------------------------------------------------- controles
    var elMetrica = document.getElementsByName("metrica");
    var elEscala = document.getElementsByName("escala");
    var el3d = $("chk-3d");
    var elExagero = $("cfg-exagero");
    var elBordas = $("chk-bordas");
    var elContorno = $("chk-contorno");

    function porNome(lista) {
      for (var i = 0; i < lista.length; i++) if (lista[i].checked) return lista[i].value;
      return null;
    }

    for (var i = 0; i < elMetrica.length; i++) {
      elMetrica[i].addEventListener("change", function () {
        mapa.metrica = porNome(elMetrica);
        mapa.recalcular();
        atualizarPainel();
        mapa.redesenhar();
      });
    }
    for (var j = 0; j < elEscala.length; j++) {
      elEscala[j].addEventListener("change", function () {
        mapa.escalaCor = porNome(elEscala);
        mapa.recalcular();
        atualizarPainel();
        mapa.redesenhar();
      });
    }
    el3d.addEventListener("change", function () {
      mapa.modo3d = el3d.checked;
      $("controles-3d").hidden = !mapa.modo3d;
      $("dica-3d").hidden = !mapa.modo3d;
      mapa.redesenhar();
    });
    var elAltura = document.getElementsByName("altura");
    for (var a = 0; a < elAltura.length; a++) {
      elAltura[a].addEventListener("change", function () {
        mapa.escalaAltura = porNome(elAltura);
        mapa.redesenhar();
      });
    }
    elExagero.addEventListener("input", function () {
      mapa.exagero = +elExagero.value;
      $("exagero-valor").textContent = (+elExagero.value).toFixed(1) + "×";
      mapa.redesenhar();
    });
    elBordas.addEventListener("change", function () {
      mapa.bordas = elBordas.checked;
      mapa.redesenhar();
    });
    elContorno.addEventListener("change", function () {
      mapa.contorno = elContorno.checked;
      mapa.redesenhar();
    });
    $("btn-enquadrar").addEventListener("click", function () { mapa.enquadrar(); });
    $("btn-girar").addEventListener("click", function () {
      mapa.giro += Math.PI / 6;
      mapa.redesenhar();
    });

    // --------------------------------------------------------------- busca
    var elBusca = $("busca");
    var elBuscaResultado = $("busca-resultado");
    elBusca.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var r = DADOS.buscar(elBusca.value);
      if (r.status !== "ok" && r.status !== "ambiguo") {
        elBuscaResultado.textContent = r.status === "vazio" ? "" : "Município não encontrado.";
        return;
      }
      var m = r.municipios[0];
      elBuscaResultado.textContent = "→ " + m.nome + " (" + m.uf + ")" +
        (r.status === "ambiguo" ? " — há outros com esse nome" : "");
      // enquadra algo em torno de 25 km de largura
      mapa.irPara(m.lng, m.lat, Math.max(2200, 900 / 0.25));
    });

    // -------------------------------------------------------------- tooltip
    var elTooltip = $("tooltip");
    function mostrarTooltip(alvo, x, y) {
      if (!alvo) { elTooltip.hidden = true; return; }
      var bl = mapa.blocos[alvo.bloco];
      var d = recorte.descrever(bl, alvo.i);
      elTooltip.innerHTML =
        '<b>' + escapar(d.titulo) + '</b>' +
        '<div class="sub">' + escapar(d.sub) + '</div>' +
        '<div class="val">' + num(bl.pop[alvo.i]) + ' hab. · ' +
        num(bl.pop[alvo.i] / Math.max(1e-9, bl.aream2[alvo.i] / 1e6), 0) + ' hab/km²</div>';
      elTooltip.hidden = false;
      var caixa = elTooltip.getBoundingClientRect();
      var px = x + 16, py = y + 16;
      if (px + caixa.width > window.innerWidth - 8) px = x - caixa.width - 16;
      if (py + caixa.height > window.innerHeight - 8) py = y - caixa.height - 16;
      elTooltip.style.left = px + "px";
      elTooltip.style.top = py + "px";
    }

    function mostrarDetalhe(alvo) {
      var caixa = $("detalhe");
      if (!alvo) { caixa.hidden = true; return; }
      var bl = mapa.blocos[alvo.bloco];
      var d = recorte.descrever(bl, alvo.i);
      var km2 = bl.aream2[alvo.i] / 1e6;
      var linhas = [
        ["População", num(bl.pop[alvo.i]) + " hab."],
        ["Área", km2 >= 1 ? num(km2, 2) + " km²" : num(km2 * 100, 1) + " ha"],
        ["Densidade", num(bl.pop[alvo.i] / Math.max(1e-9, km2), 0) + " hab/km²"],
      ].concat(d.linhas || []);
      caixa.innerHTML = '<h3>' + escapar(d.titulo) + '</h3>' +
        '<p class="sub">' + escapar(d.sub) + '</p>' +
        '<dl>' + linhas.map(function (l) {
          return '<dt>' + escapar(l[0]) + '</dt><dd>' + l[1] + '</dd>';
        }).join("") + '</dl>' +
        '<button id="btn-limpar-detalhe" class="botao-sec" type="button">✕ Limpar seleção</button>';
      caixa.hidden = false;
      $("btn-limpar-detalhe").addEventListener("click", function () {
        mapa.selecionar(null);
        caixa.hidden = true;
      });
    }

    function escapar(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // ---------------------------------------------------- legenda e resumo
    var elLegenda = $("legenda-canvas");
    var ctxLegenda = elLegenda.getContext("2d");

    function desenharLegenda() {
      var L = elLegenda.width, A = elLegenda.height;
      ctxLegenda.clearRect(0, 0, L, A);
      // primeiro quadradinho: as unidades sem ninguém morando
      ctxLegenda.fillStyle = mapa.corVazio;
      ctxLegenda.fillRect(0, 0, 14, A);
      for (var x = 16; x < L; x++) {
        var f = (x - 16) / (L - 17);
        ctxLegenda.fillStyle = mapa.cores[Math.min(mapa.cores.length - 1,
          Math.round(f * (mapa.cores.length - 1)))];
        ctxLegenda.fillRect(x, 0, 1, A);
      }
      var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
        var v = mapa.valorDaFracao(f);
        return "<span>" + (v >= 1000 ? num(Math.round(v / 100) * 100) : num(v, v < 10 ? 1 : 0)) + "</span>";
      });
      $("legenda-ticks").innerHTML = ticks.join("");
      $("legenda-titulo").textContent = mapa.metrica === "densidade"
        ? "Densidade (hab/km²)" : "População da unidade (hab.)";
      $("legenda-vazio").textContent = "▉ sem moradores";
    }

    function atualizarPainel() {
      desenharLegenda();
      resumo();
      ranking();
    }

    function resumo() {
      var unidades = 0, pop = 0, area = 0, b, i, bl;
      for (b = 0; b < mapa.blocos.length; b++) {
        bl = mapa.blocos[b];
        unidades += bl.n;
        for (i = 0; i < bl.n; i++) { pop += bl.pop[i]; area += bl.aream2[i]; }
      }
      area /= 1e6;
      var meia = concentracao(pop);
      $("stats").innerHTML =
        '<dl>' +
        '<dt>' + recorte.plural + '</dt><dd>' + num(unidades) + '</dd>' +
        '<dt>População</dt><dd>' + num(pop) + '</dd>' +
        '<dt>Área</dt><dd>' + num(area, 0) + ' km²</dd>' +
        '<dt>Densidade média</dt><dd>' + num(pop / Math.max(1, area), 1) + ' hab/km²</dd>' +
        '</dl>' +
        (meia ? '<p class="destaque">Metade dessa população mora em <b>' +
          num(meia.areaPct, 2) + '%</b> da área — ' + num(meia.area, 0) + ' km² em ' +
          num(meia.unidades) + ' ' + (meia.unidades === 1 ? recorte.singular : recorte.plural).toLowerCase() +
          '.</p>' : '');
    }

    // Ordena por densidade e acumula até metade da população: dá a fração do
    // território onde vive metade da gente.
    function concentracao(popTotal) {
      if (!popTotal) return null;
      var total = 0, b, i, bl;
      for (b = 0; b < mapa.blocos.length; b++) total += mapa.blocos[b].n;
      var chave = new Float64Array(total), pop = new Float64Array(total), ar = new Float64Array(total);
      var k = 0;
      for (b = 0; b < mapa.blocos.length; b++) {
        bl = mapa.blocos[b];
        for (i = 0; i < bl.n; i++) {
          var km2 = bl.aream2[i] / 1e6;
          chave[k] = km2 > 0 ? bl.pop[i] / km2 : 0;
          pop[k] = bl.pop[i];
          ar[k] = km2;
          k++;
        }
      }
      var ordem = Array.from({ length: total }, function (_, n) { return n; });
      ordem.sort(function (a, c) { return chave[c] - chave[a]; });
      var acumPop = 0, acumArea = 0, areaTotal = 0, n = 0;
      for (i = 0; i < total; i++) areaTotal += ar[i];
      for (i = 0; i < total; i++) {
        acumPop += pop[ordem[i]];
        acumArea += ar[ordem[i]];
        n++;
        if (acumPop >= popTotal / 2) break;
      }
      return { area: acumArea, areaPct: 100 * acumArea / Math.max(1e-9, areaTotal), unidades: n };
    }

    function ranking() {
      var melhores = [];
      for (var b = 0; b < mapa.blocos.length; b++) {
        var bl = mapa.blocos[b];
        for (var i = 0; i < bl.n; i++) {
          var v = bl.valor[i];
          if (melhores.length < 12) {
            melhores.push({ b: b, i: i, v: v });
            if (melhores.length === 12) melhores.sort(function (x, y) { return y.v - x.v; });
          } else if (v > melhores[11].v) {
            melhores[11] = { b: b, i: i, v: v };
            melhores.sort(function (x, y) { return y.v - x.v; });
          }
        }
      }
      melhores.sort(function (x, y) { return y.v - x.v; });
      $("ranking-titulo").textContent = mapa.metrica === "densidade"
        ? "Mais densas" : "Mais populosas";
      $("ranking").innerHTML = melhores.map(function (m, pos) {
        var bl = mapa.blocos[m.b];
        var d = recorte.descrever(bl, m.i);
        return '<li data-b="' + m.b + '" data-i="' + m.i + '">' +
          '<span class="pos">' + (pos + 1) + '</span>' +
          '<span class="nome">' + escapar(d.titulo) + '<small>' + escapar(d.sub) + '</small></span>' +
          '<span class="valor">' + num(m.v, 0) + '</span></li>';
      }).join("");
    }

    $("ranking").addEventListener("click", function (e) {
      var li = e.target.closest("li");
      if (!li) return;
      var alvo = { bloco: +li.dataset.b, i: +li.dataset.i };
      var bl = mapa.blocos[alvo.bloco], m = bl.malha;
      mapa.selecionar(alvo);
      mostrarDetalhe(alvo);
      // deixa a unidade com ~150 px de largura: perto o bastante para achar,
      // longe o bastante para ver onde ela fica
      var largura = Math.max(m.maxX[alvo.i] - m.minX[alvo.i], 1e-4);
      mapa.irPara(m.cx[alvo.i], m.cy[alvo.i], Math.min(2e5, 150 / largura));
    });

    // ------------------------------------------------------------------ vai
    $("pintando").hidden = false;
    carregarSequencia(recorte.arquivos, function () {
      elCarregando.hidden = true;
      mapa.recalcular();
      atualizarPainel();
      mapa.enquadrar();
    });

    // enquanto pinta, avisa
    var relogio = setInterval(function () {
      $("pintando").hidden = !mapa.pintando();
    }, 120);
    window.addEventListener("beforeunload", function () { clearInterval(relogio); });

    return mapa;
  }

  return { iniciar: iniciar };
})();
