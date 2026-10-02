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
    //
    // Os pedidos entram numa fila: no modo leve o usuário pode pedir outro
    // estado enquanto um ainda baixa.
    var fila = [], ocupado = false;
    var carregados = Object.create(null);   // arquivo -> true
    var falhas = [];                        // itens que não vieram
    var cacheMeia = null;                   // concentracao() até mudar o conjunto

    function carregar(itens, depois) {
      itens = itens.filter(function (it) { return !carregados[it.arquivo]; });
      fila.push({ itens: itens, depois: depois });
      if (!ocupado) rodarFila();
    }

    function rodarFila() {
      var pedido = fila.shift();
      if (!pedido) { ocupado = false; return; }
      ocupado = true;
      elCarregando.hidden = false;
      elCarregando.classList.remove("erro");
      $("pintando").hidden = false;
      carregarSequencia(pedido.itens, function (novos) {
        if (novos) cacheMeia = null;
        if (mapa.blocos.length) {
          elCarregando.hidden = true;
          mapa.recalcular();
          atualizarPainel();
        } else {
          // nada no mapa: o aviso fica por cima, em vez do "Carregando…" eterno
          elCarregando.classList.add("erro");
          elCarregandoTexto.textContent = "Não foi possível carregar os dados do mapa. " +
            "Verifique a conexão e tente de novo.";
          elBarra.style.width = "0";
        }
        mostrarFalhas();
        if (pedido.depois) pedido.depois();
        rodarFila();
      });
    }

    function carregarSequencia(lista, pronto) {
      var i = 0, novos = 0;
      (function proximo() {
        if (i >= lista.length) {
          elBarra.style.width = "100%";
          return pronto(novos);
        }
        var item = lista[i];
        elCarregandoTexto.textContent = "Carregando " + item.rotulo +
          (lista.length > 1 ? " (" + (i + 1) + " de " + lista.length + ")" : "") + "…";
        elBarra.style.width = (100 * i / lista.length) + "%";
        var tag = document.createElement("script");
        tag.src = item.arquivo;
        tag.onload = function () {
          var fonte = window[item.variavel];
          if (fonte) {
            var bloco = recorte.montarBloco(fonte, item);
            bloco.malha = CENSO_TOPO.decodificar(fonte);
            mapa.adicionarBloco(bloco);
            carregados[item.arquivo] = true;
            tirarFalha(item);
            novos++;
            // a fonte crua chega a 15 MB de texto já virado array; sem soltar
            // aqui, o Brasil inteiro em setores não cabe na memória
            try { delete window[item.variavel]; } catch (erro) { window[item.variavel] = null; }
            // durante a carga só a escala de cor e a legenda acompanham; o
            // resumo e o ranking (que ordenam tudo) saem uma vez no fim
            mapa.recalcular();
            desenharLegenda();
            mapa.redesenhar();
          } else {
            anotarFalha(item);
          }
          tag.remove();
          i++;
          setTimeout(proximo, 0);
        };
        tag.onerror = function () {
          anotarFalha(item);
          tag.remove();
          i++;
          setTimeout(proximo, 0);
        };
        document.head.appendChild(tag);
      })();
    }

    function anotarFalha(item) {
      if (falhas.indexOf(item) < 0) falhas.push(item);
    }
    function tirarFalha(item) {
      var k = falhas.indexOf(item);
      if (k >= 0) falhas.splice(k, 1);
    }

    // Aviso que fica até o usuário tentar de novo: lista o que faltou.
    var elFalhas = $("aviso-falhas");
    function mostrarFalhas() {
      if (!falhas.length) { elFalhas.hidden = true; return; }
      var nomes = falhas.map(function (f) { return f.uf || f.rotulo; });
      elFalhas.innerHTML = "";
      var texto = document.createElement("span");
      texto.textContent = (falhas.length === 1 ? "Não carregou: " :
        "Não carregaram (" + falhas.length + "): ") + nomes.join(", ") + ".";
      var botao = document.createElement("button");
      botao.type = "button";
      botao.className = "botao-sec";
      botao.textContent = "↻ Tentar de novo";
      botao.addEventListener("click", function () {
        elFalhas.hidden = true;
        carregar(falhas.slice(), function () { atualizarUFs(); });
      });
      elFalhas.append(texto, botao);
      elFalhas.hidden = false;
    }

    // --------------------------------------------------------- modo leve
    // Os setores do Brasil somam 76 MB de malha e passam de 1 GB de memória
    // depois de decodificados: em celular ou aparelho com pouca memória o
    // mapa abre só com um estado, e o resto vem a pedido.
    function aparelhoLeve() {
      var c = navigator.connection;
      if (c && c.saveData) return true;
      if (navigator.deviceMemory && navigator.deviceMemory <= 4) return true;
      return Math.min(screen.width || 9999, screen.height || 9999) < 768;
    }

    var lista = recorte.arquivos || [];
    var porUF = lista.length > 1 && lista.every(function (it) { return it.uf; });
    var leve = porUF && aparelhoLeve();

    function itemDaUF(uf) {
      for (var k = 0; k < lista.length; k++) if (lista[k].uf === uf) return lista[k];
      return null;
    }

    function atualizarUFs() {
      if (!leve) return;
      var no = lista.filter(function (it) { return carregados[it.arquivo]; });
      $("ufs-carregadas").textContent = no.length
        ? "No mapa: " + no.map(function (it) { return it.rotulo; }).join(", ") + "."
        : "Nenhum estado carregado ainda.";
      var sel = $("sel-uf");
      var antes = sel.value;
      sel.innerHTML = "";
      lista.forEach(function (it) {
        if (carregados[it.arquivo]) return;
        var op = document.createElement("option");
        op.value = it.uf;
        op.textContent = it.rotulo + (it.n ? " · " + num(Math.max(1, Math.round(it.n / 1000))) + " mil setores" : "");
        sel.appendChild(op);
      });
      if (antes && itemDaUF(antes) && !carregados[itemDaUF(antes).arquivo]) sel.value = antes;
      var todos = no.length === lista.length;
      sel.disabled = $("btn-uf").disabled = $("btn-brasil").disabled = todos;
    }

    if (leve) {
      $("bloco-ufs").hidden = false;
      $("nota-peso").innerHTML = "<b>Modo leve:</b> neste aparelho o mapa abre " +
        "com um estado só. Adicione outros logo abaixo — ou o país inteiro, se " +
        "o aparelho aguentar.";
      $("btn-enquadrar").textContent = "⤢ Enquadrar";
      $("btn-uf").addEventListener("click", function () {
        var it = itemDaUF($("sel-uf").value);
        if (it) carregar([it], function () { atualizarUFs(); mapa.enquadrar(); });
      });
      $("btn-brasil").addEventListener("click", function () {
        if (!window.confirm("O Brasil inteiro são cerca de 76 MB de dados e mais de " +
            "1 GB de memória. Em celular, a página pode travar ou recarregar. Continuar?")) return;
        carregar(lista, function () { atualizarUFs(); mapa.enquadrar(); });
      });
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
      $("btn-zoom-girar").hidden = $("btn-zoom-inclinar").hidden = !mapa.modo3d;
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
    function girar() {
      mapa.giro += Math.PI / 6;
      mapa.redesenhar();
    }
    $("btn-girar").addEventListener("click", girar);

    // botões sobre o mapa: zoom para quem não tem roda nem pinça, e no 3D
    // giro e inclinação sem precisar de Shift ou botão direito
    $("btn-zoom-mais").addEventListener("click", function () { mapa.aproximar(1.6); });
    $("btn-zoom-menos").addEventListener("click", function () { mapa.aproximar(1 / 1.6); });
    $("btn-zoom-zerar").addEventListener("click", function () { mapa.enquadrar(); });
    $("btn-zoom-girar").addEventListener("click", girar);
    var INCLINACOES = [0.35, 0.62, 0.95, 1.25];
    $("btn-zoom-inclinar").addEventListener("click", function () {
      var k = 0;
      while (k < INCLINACOES.length && INCLINACOES[k] <= mapa.inclinacao + 0.01) k++;
      mapa.inclinacao = INCLINACOES[k % INCLINACOES.length];
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
      var ir = function () { mapa.irPara(m.lng, m.lat, Math.max(2200, 900 / 0.25)); };
      var it = leve ? itemDaUF(m.uf) : null;
      if (it && !carregados[it.arquivo]) {
        elBuscaResultado.textContent += " — carregando " + it.rotulo + "…";
        carregar([it], function () { atualizarUFs(); ir(); });
      } else {
        ir();
      }
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
      if (!cacheMeia) cacheMeia = { r: concentracao(pop) };
      var meia = cacheMeia.r;
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
    if (!lista.length) {
      // o índice dos arquivos não veio (data/censo_setores_indice.js)
      elCarregando.classList.add("erro");
      elCarregandoTexto.textContent = "Não foi possível carregar o índice dos dados. " +
        "Recarregue a página para tentar de novo.";
    } else if (leve) {
      var pedida = (/[?&]uf=([a-z]{2})/i.exec(location.search) || [])[1];
      var inicial = itemDaUF((pedida || recorte.ufInicial || "RJ").toUpperCase()) || lista[0];
      atualizarUFs();
      carregar([inicial], function () { atualizarUFs(); mapa.enquadrar(); });
    } else {
      carregar(lista, function () { mapa.enquadrar(); });
    }

    // enquanto pinta, avisa
    var relogio = setInterval(function () {
      $("pintando").hidden = !mapa.pintando();
    }, 120);
    window.addEventListener("beforeunload", function () { clearInterval(relogio); });

    return mapa;
  }

  return { iniciar: iniciar };
})();
