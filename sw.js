// Service worker do Mapa Quiz: o jogo abre sem internet depois da primeira
// visita e o retorno ao site não espera a rede.
//
// - Código (HTML, JS, CSS): rede primeiro, cache como reserva. O site muda
//   com frequência e HTML novo com JS velho (ou o contrário) quebraria a
//   página; online sempre vale a versão publicada.
// - Fontes, imagens e dados (data/*.js): stale-while-revalidate — responde
//   do cache na hora e atualiza em segundo plano.
// - Arquivos grandes de carga sob demanda (satélite, malha HD, Censo) e
//   qualquer coisa de outro domínio (Google, anúncios, analytics) passam
//   direto pela rede, sem cache.
//
// Ao mudar o formato de algum arquivo de dados, suba a VERSAO: a instalação
// nova baixa o pacote inicial inteiro e apaga os caches antigos.
var VERSAO = "v1";
var CACHE = "mapaquiz-" + VERSAO;

// o que o index.html carrega na abertura
var PACOTE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "fonts/sora.css",
  "fonts/sora-latin.woff2",
  "img/icone.svg",
  "img/icone-192.png",
  "js/config.js",
  "js/site.js",
  "data/municipios.js",
  "data/brasil_uf.js",
  "js/geo.js",
  "js/dados.js",
  "js/recordes.js",
  "js/conhecimento.js",
  "js/conta.js",
  "js/modos.js",
  "js/diario.js",
  "js/app.js",
  "js/tutorial.js",
  "js/navegacao.js",
];

// grandes demais para guardar: sempre da rede
var SEM_CACHE = /\/(satelite\.jpg|data\/malha_[^/]*_hd\.js|data\/censo_[^/]*)$/;
var CODIGO = /\.(html|js|css|webmanifest)$/;

self.addEventListener("install", function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // cache: "reload" fura o cache HTTP: o pacote vem fresco do servidor
      return cache.addAll(PACOTE.map(function (u) { return new Request(u, { cache: "reload" }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (ev) {
  ev.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.map(function (n) {
        if (n.indexOf("mapaquiz-") === 0 && n !== CACHE) return caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function guardar(req, resp) {
  // só respostas completas do próprio site (nada de opaco, parcial ou erro)
  if (!resp || resp.status !== 200 || resp.type !== "basic") return;
  var copia = resp.clone();
  caches.open(CACHE).then(function (cache) { cache.put(req, copia); });
}

function doCache(req) {
  // ?fonte=pwa (start_url) e afins não mudam o arquivo
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true });
  });
}

function redePrimeiro(req) {
  return fetch(req).then(function (resp) {
    guardar(req, resp);
    return resp;
  }).catch(function () {
    return doCache(req).then(function (r) {
      if (r) return r;
      // navegação offline para uma página nunca visitada: abre o jogo
      if (req.mode === "navigate") {
        return doCache(new Request("index.html")).then(function (i) { return i || Response.error(); });
      }
      return Response.error();
    });
  });
}

function cacheERevalida(ev, req) {
  return doCache(req).then(function (r) {
    var rede = fetch(req).then(function (resp) {
      guardar(req, resp);
      return resp;
    });
    if (r) {
      ev.waitUntil(rede.catch(function () {}));
      return r;
    }
    return rede;
  });
}

self.addEventListener("fetch", function (ev) {
  var req = ev.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // terceiros: sem SW no meio
  if (SEM_CACHE.test(url.pathname)) return;
  if (req.mode === "navigate" || CODIGO.test(url.pathname) && url.pathname.indexOf("/data/") === -1) {
    ev.respondWith(redePrimeiro(req));
  } else {
    ev.respondWith(cacheERevalida(ev, req));
  }
});
