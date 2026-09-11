// Carrega os scripts do jogo (IIFEs com globais) num contexto isolado do
// node, como o navegador faria — sem DOM. Devolve o contexto com DADOS,
// GEO, MODOS, RECORDES, CONHECIMENTO etc.
"use strict";
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function memoriaLocal() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

function carregar(arquivos, extras) {
  const ctx = { console, Math, Date, JSON, Map, Set, Number, String, Object, Array };
  ctx.window = ctx;
  ctx.localStorage = memoriaLocal();
  ctx.sessionStorage = memoriaLocal();
  ctx.document = { addEventListener() {}, dispatchEvent() {} };
  ctx.CustomEvent = function (tipo, init) { this.type = tipo; this.detail = init && init.detail; };
  Object.assign(ctx, extras || {});
  vm.createContext(ctx);
  arquivos.forEach((f) => {
    const p = path.join(__dirname, "..", f);
    vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: f });
  });
  return ctx;
}

module.exports = { carregar };
