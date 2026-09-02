"use strict";
// Tutorial guiado: um holofote sobre cada parte da tela com um cartão de
// explicação. Abre sozinho na primeira visita e pelo botão ❔ do topo.
var TUTORIAL = (function () {
  var LS_VISTO = "mapaquiz.tutorial.v1";
  var $ = function (id) { return document.getElementById(id); };
  var TOQUE = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  var PASSOS = [
    {
      alvo: "#card-diario",
      titulo: "Um desafio novo todo dia",
      texto: "O <b>Desafio do dia</b> sorteia um município secreto — o mesmo para todo " +
        "mundo. Cada palpite responde com a distância e a direção até ele. Acerte em " +
        "poucos palpites, mantenha a sequência e compartilhe o resultado em emojis.",
    },
    {
      alvo: "#tela-modos .grupo-modos",
      titulo: "Doze jeitos de jogar",
      texto: "Cubra o mapa com círculos, cite as maiores cidades, viaje por divisas " +
        "municipais, ache o município secreto… Não conhece muitas cidades ainda? " +
        "Comece pelo <b>Modo estudo</b>: o mapa abre todo revelado, sem relógio.",
    },
    {
      alvo: "#botoes-mapa",
      titulo: "Os três botões do mapa",
      texto: "<b>🛰️ Satélite</b> troca o fundo de papel pela imagem real da NASA. " +
        "<b>● Pontos</b> esconde os municípios que você ainda não descobriu (mais difícil). " +
        "<b>⬡ Formas</b> pinta o <i>território inteiro</i> de cada acerto, não só a sede — " +
        "fica lindo na Mancha e no Caminho. Todos ficam ligados entre partidas.",
    },
    {
      alvo: "#botoes-zoom",
      titulo: "Chegue perto",
      texto: (TOQUE
        ? "Pinça para dar zoom, arraste para mover e toque duas vezes para ver o Brasil inteiro. "
        : "Roda do mouse ou +/− para zoom, arraste para mover, duplo clique (ou ⌂) volta ao Brasil inteiro. ") +
        "Passe o mouse (ou toque) numa cidade revelada para ver população, área e PIB.",
    },
    {
      alvo: null,
      titulo: "Digite do seu jeito",
      texto: "Acentos, maiúsculas e hífens não importam: <code>sao jose dos campos</code> " +
        "vale. Se houver mais de um município com o mesmo nome, acrescente a UF: " +
        "<code>Bom Jesus, RS</code>. Aperte Enter para chutar. Nos modos com alvo, o " +
        "botão 💡 dá pistas — mas cada dica tem um custo no resultado.",
    },
    {
      alvo: "#btn-recordes",
      titulo: "Seus recordes ficam com você",
      texto: "Cada configuração de jogo tem o próprio recorde, salvo neste navegador. " +
        "Em 🏆 Recordes você exporta um backup para levar tudo a outro aparelho. " +
        "📊 Pontos cegos mostra o mapa do que você nunca citou. E este tutorial volta " +
        "pelo botão ❔ no topo.",
    },
  ];

  var passo = 0;
  var overlay = null;
  var holofote = null;
  var cartao = null;

  function visto() {
    try { return localStorage.getItem(LS_VISTO) === "1"; } catch (e) { return true; }
  }
  function marcarVisto() {
    try { localStorage.setItem(LS_VISTO, "1"); } catch (e) {}
  }

  function montar() {
    overlay = document.createElement("div");
    overlay.id = "tutorial";
    overlay.innerHTML =
      "<div class='tutorial-holofote'></div>" +
      "<div class='tutorial-cartao' role='dialog' aria-live='polite'>" +
      "<small class='tutorial-passo'></small>" +
      "<h3></h3><p></p>" +
      "<div class='tutorial-botoes'>" +
      "<button type='button' class='botao-sec' data-acao='pular'>Pular</button>" +
      "<span class='tutorial-espaco'></span>" +
      "<button type='button' class='botao-sec' data-acao='anterior'>‹</button>" +
      "<button type='button' class='botao-pri' data-acao='proximo'>Próximo ›</button>" +
      "</div></div>";
    document.body.appendChild(overlay);
    holofote = overlay.querySelector(".tutorial-holofote");
    cartao = overlay.querySelector(".tutorial-cartao");
    overlay.addEventListener("click", function (ev) {
      var acao = ev.target.dataset && ev.target.dataset.acao;
      if (acao === "pular") fechar();
      else if (acao === "anterior") ir(passo - 1);
      else if (acao === "proximo") ir(passo + 1);
    });
    document.addEventListener("keydown", function (ev) {
      if (overlay.hidden) return;
      if (ev.key === "Escape") fechar();
      if (ev.key === "ArrowRight" || ev.key === "Enter") ir(passo + 1);
      if (ev.key === "ArrowLeft") ir(passo - 1);
    });
    window.addEventListener("resize", function () { if (!overlay.hidden) posicionar(); });
  }

  function alvoDo(p) {
    return p.alvo ? document.querySelector(p.alvo) : null;
  }

  function posicionar() {
    var p = PASSOS[passo];
    var alvo = alvoDo(p);
    var M = 8;
    if (alvo && alvo.offsetParent !== null) {
      var r = alvo.getBoundingClientRect();
      holofote.hidden = false;
      holofote.style.left = r.left - M + "px";
      holofote.style.top = r.top - M + "px";
      holofote.style.width = r.width + 2 * M + "px";
      holofote.style.height = r.height + 2 * M + "px";
      // cartão embaixo do alvo se couber, senão em cima; em tela estreita
      // ele fica fixo no rodapé (o CSS cuida)
      var cr = cartao.getBoundingClientRect();
      var abaixo = r.bottom + M + 12;
      var top = abaixo + cr.height <= window.innerHeight - 12
        ? abaixo
        : Math.max(12, r.top - M - 12 - cr.height);
      var left = Math.min(Math.max(12, r.left), window.innerWidth - cr.width - 12);
      cartao.style.top = top + "px";
      cartao.style.left = left + "px";
      cartao.classList.remove("centro");
      // em tela estreita o cartão fica fixo embaixo (CSS) — se o alvo está
      // na metade de baixo, o cartão sobe para o topo para não cobri-lo
      cartao.classList.toggle("topo", (r.top + r.bottom) / 2 > window.innerHeight / 2);
    } else {
      holofote.hidden = true;
      cartao.classList.add("centro");
      cartao.classList.remove("topo");
      cartao.style.top = "";
      cartao.style.left = "";
    }
  }

  function ir(n) {
    if (n < 0) return;
    if (n >= PASSOS.length) { fechar(); return; }
    passo = n;
    var p = PASSOS[passo];
    cartao.querySelector(".tutorial-passo").textContent = (passo + 1) + " de " + PASSOS.length;
    cartao.querySelector("h3").textContent = p.titulo;
    cartao.querySelector("p").innerHTML = p.texto;
    cartao.querySelector("[data-acao='anterior']").disabled = passo === 0;
    cartao.querySelector("[data-acao='proximo']").textContent =
      passo === PASSOS.length - 1 ? "Jogar!" : "Próximo ›";
    var alvo = alvoDo(p);
    if (alvo) alvo.scrollIntoView({ block: "center", inline: "nearest" });
    // depois da rolagem, mede de novo
    requestAnimationFrame(posicionar);
    setTimeout(posicionar, 250);
  }

  function abrir() {
    if (!overlay) montar();
    overlay.hidden = false;
    document.body.classList.add("com-tutorial");
    ir(0);
    if (window.SITE) SITE.rastrear("tutorial_abriu");
  }

  function fechar() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove("com-tutorial");
    marcarVisto();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = $("btn-tutorial");
    if (btn) btn.addEventListener("click", abrir);
    // primeira visita: só quando a tela de modos está à vista (um link de
    // desafio ou o modo diário pulam direto para o jogo)
    var telaModos = $("tela-modos");
    if (!visto() && telaModos && !telaModos.hidden && location.hash.indexOf("#d=") !== 0 && location.hash !== "#diario") {
      setTimeout(abrir, 700);
    }
  });

  return { abrir: abrir, fechar: fechar, visto: visto };
})();
