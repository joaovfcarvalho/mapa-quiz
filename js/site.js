"use strict";
// Camada de site compartilhada pelas páginas: aviso de privacidade (LGPD),
// carregamento de analytics e anúncios só depois do consentimento, eventos
// de uso, espaços de anúncio e o modal de apoio via Pix. Sem nenhum ID em
// js/config.js nada disso aparece — o jogo continua 100% local.
var SITE = (function () {
  var CFG = window.MAPAQUIZ_CONFIG || {};
  var ADS = CFG.adsense || {};
  var PIX = CFG.pix || {};
  var LS_CONSENT = "mapaquiz.consentimento.v1";
  var $ = function (id) { return document.getElementById(id); };

  function lerConsent() {
    try { return localStorage.getItem(LS_CONSENT); } catch (e) { return null; }
  }
  function gravarConsent(v) {
    try { localStorage.setItem(LS_CONSENT, v); } catch (e) {}
  }
  var temServicos = !!(CFG.ga4 || ADS.cliente);
  function consentiu() { return lerConsent() === "aceito"; }

  // ---------------- analytics ----------------
  var gaCarregado = false;
  function carregarGA() {
    if (gaCarregado || !CFG.ga4) return;
    gaCarregado = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", CFG.ga4, { anonymize_ip: true });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(CFG.ga4);
    document.head.appendChild(s);
  }

  // Evento de uso (modo iniciado, partida encerrada, compartilhou…). Sem
  // consentimento ou sem GA4 configurado é um no-op.
  function rastrear(nome, params) {
    if (!gaCarregado || typeof window.gtag !== "function") return;
    try { window.gtag("event", nome, params || {}); } catch (e) {}
  }

  // ---------------- anúncios ----------------
  var adsCarregado = false;
  function carregarAds() {
    if (adsCarregado || !ADS.cliente) return;
    adsCarregado = true;
    var s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" +
      encodeURIComponent(ADS.cliente);
    document.head.appendChild(s);
  }

  // Preenche um contêiner <div class="anuncio" data-slot="resultado"> com um
  // bloco do AdSense. Cada contêiner recebe o bloco uma vez só; sem
  // configuração ou sem consentimento o contêiner fica escondido.
  function mostrarAnuncio(el) {
    if (!el) return;
    if (!adsCarregado || !ADS.cliente) { el.hidden = true; return; }
    el.hidden = false;
    if (el.dataset.pronto) return;
    el.dataset.pronto = "1";
    var ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.setAttribute("data-ad-client", ADS.cliente);
    var slot = (ADS.slots || {})[el.dataset.slot];
    if (slot) ins.setAttribute("data-ad-slot", slot);
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "true");
    el.innerHTML = "<small class='anuncio-rotulo'>publicidade</small>";
    el.appendChild(ins);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
  }
  function mostrarAnuncios(nomeSlot) {
    document.querySelectorAll(".anuncio[data-slot='" + nomeSlot + "']").forEach(mostrarAnuncio);
  }

  function ligarServicos() {
    if (!consentiu()) return;
    carregarGA();
    carregarAds();
  }

  // ---------------- aviso de privacidade ----------------
  function montarBanner() {
    if (!temServicos || lerConsent()) return;
    var b = document.createElement("div");
    b.id = "aviso-privacidade";
    b.setAttribute("role", "dialog");
    b.setAttribute("aria-label", "Aviso de privacidade");
    b.innerHTML =
      "<p>Este site usa cookies de <b>estatísticas de uso</b>" +
      (ADS.cliente ? " e de <b>anúncios</b> (Google AdSense), que pagam a hospedagem" : "") +
      ". Seus recordes e progresso ficam só no seu navegador. " +
      "<a href='privacidade.html'>Saiba mais</a></p>" +
      "<div class='aviso-botoes'>" +
      "<button type='button' class='botao-sec' id='aviso-recusar'>Só o essencial</button>" +
      "<button type='button' class='botao-pri' id='aviso-aceitar'>Aceitar</button></div>";
    document.body.appendChild(b);
    $("aviso-aceitar").addEventListener("click", function () {
      gravarConsent("aceito");
      b.remove();
      ligarServicos();
      mostrarAnuncios("modos");
    });
    $("aviso-recusar").addEventListener("click", function () {
      gravarConsent("recusado");
      b.remove();
    });
  }

  // Permite mudar de ideia (link na política de privacidade).
  function redefinirConsent() {
    try { localStorage.removeItem(LS_CONSENT); } catch (e) {}
  }

  // ---------------- apoio via Pix ----------------
  // Monta o payload "Pix copia e cola" (BR Code estático do Banco Central):
  // TLV com a chave, nome e cidade do recebedor e CRC16-CCITT no fim.
  function tlv(id, valor) {
    var v = String(valor);
    return id + (v.length < 10 ? "0" : "") + v.length + v;
  }
  function crc16(str) {
    var crc = 0xffff;
    for (var i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return ("0000" + crc.toString(16).toUpperCase()).slice(-4);
  }
  function semAcentos(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, "");
  }
  function payloadPix() {
    if (!PIX.chave) return "";
    var nome = semAcentos(PIX.nome || "Mapa Quiz").slice(0, 25);
    var cidade = semAcentos(PIX.cidade || "Brasil").slice(0, 15);
    var s = tlv("00", "01") +
      tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", PIX.chave)) +
      tlv("52", "0000") + tlv("53", "986") + tlv("58", "BR") +
      tlv("59", nome) + tlv("60", cidade) +
      tlv("62", tlv("05", "***")) + "6304";
    return s + crc16(s);
  }
  function temApoio() {
    return !!(PIX.chave || (CFG.apoioLinks && CFG.apoioLinks.length));
  }

  function copiar(texto, botao, rotuloOk) {
    function ok() {
      var antes = botao.textContent;
      botao.textContent = rotuloOk || "✔ Copiado!";
      setTimeout(function () { botao.textContent = antes; }, 2200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(ok, function () { prompt("Copie:", texto); });
    } else {
      prompt("Copie:", texto);
    }
  }

  function abrirApoio() {
    var m = $("modal-apoio");
    if (!m) {
      m = document.createElement("div");
      m.id = "modal-apoio";
      m.className = "modal";
      var links = (CFG.apoioLinks || []).map(function (l) {
        return "<a class='botao-sec' target='_blank' rel='noopener' href='" + l.url + "'>" + l.rotulo + "</a>";
      }).join("");
      m.innerHTML = "<div class='modal-caixa modal-apoio'>" +
        "<div class='modal-topo'><h2>☕ Apoie o Mapa Quiz</h2>" +
        "<button class='botao-sec' type='button' id='btn-fechar-apoio'>✕</button></div>" +
        "<p class='modal-nota'>O jogo é gratuito, sem cadastro e feito por uma pessoa só. " +
        "Se ele te divertiu, qualquer valor ajuda a pagar domínio e hospedagem — e a manter " +
        "os dados do IBGE atualizados.</p>" +
        (PIX.chave
          ? "<div class='bloco pix'><h3>Pix</h3>" +
            "<div class='pix-chave'><code>" + PIX.chave + "</code>" +
            "<button class='botao-sec' type='button' id='btn-copiar-chave'>Copiar chave</button></div>" +
            "<button class='botao-pri' type='button' id='btn-copiar-pix'>Copiar Pix copia e cola</button>" +
            "<small>Cole no app do seu banco, escolha o valor e pronto.</small></div>"
          : "") +
        (links ? "<div class='modal-acoes'>" + links + "</div>" : "") +
        "</div>";
      document.body.appendChild(m);
      $("btn-fechar-apoio").addEventListener("click", function () { m.hidden = true; });
      m.addEventListener("click", function (ev) { if (ev.target === m) m.hidden = true; });
      if (PIX.chave) {
        $("btn-copiar-chave").addEventListener("click", function () {
          copiar(PIX.chave, this);
          rastrear("apoio_copiou_chave");
        });
        $("btn-copiar-pix").addEventListener("click", function () {
          copiar(payloadPix(), this);
          rastrear("apoio_copiou_pix");
        });
      }
    }
    m.hidden = false;
    rastrear("apoio_abriu");
  }

  // ---------------- compartilhar ----------------
  // Compartilha um texto pelo menu nativo (celular) ou copia (desktop).
  function compartilhar(texto, botao, url) {
    rastrear("compartilhou", { origem: botao && botao.id });
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      var dados = { text: texto };
      if (url) dados.url = url;
      navigator.share(dados).catch(function () {});
      return;
    }
    copiar(url ? texto + "\n" + url : texto, botao, "✔ Copiado!");
  }

  // ---------------- inicialização ----------------
  document.addEventListener("DOMContentLoaded", function () {
    montarBanner();
    ligarServicos();
    mostrarAnuncios("modos");
    var btn = $("btn-apoiar");
    if (btn) {
      btn.hidden = !temApoio();
      btn.addEventListener("click", abrirApoio);
    }
  });

  return {
    rastrear: rastrear,
    mostrarAnuncios: mostrarAnuncios,
    abrirApoio: abrirApoio,
    temApoio: temApoio,
    compartilhar: compartilhar,
    copiar: copiar,
    redefinirConsent: redefinirConsent,
    consentiu: consentiu,
    dominio: CFG.dominio || (location.origin + location.pathname.replace(/[^/]*$/, "")),
  };
})();
