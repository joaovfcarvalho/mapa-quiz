"use strict";
// Nomes das regiões administrativas do Rio (js/bairros-ra.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const RA = require("../js/bairros-ra.js");

test("grafia correta, sem espaço sobrando", () => {
  assert.equal(RA.formatar("MEIER                   "), "Méier");
  assert.equal(RA.formatar("JACAREPAGUA             "), "Jacarepaguá");
  assert.equal(RA.formatar("ILHA DO GOVERNADOR      "), "Ilha do Governador");
  assert.equal(RA.formatar("INHAUMA"), "Inhaúma");
  assert.equal(RA.formatar("COMPLEXO DO ALEMÃO      "), "Complexo do Alemão");
  assert.equal(RA.formatar("SANTA TEREZA"), "Santa Teresa");
  assert.equal(RA.formatar("PAQUETA "), "Paquetá");
});

test("RA desconhecida cai na regra geral", () => {
  assert.equal(RA.formatar("  NOVA  REGIAO DOS TESTES "), "Nova Regiao dos Testes");
  assert.equal(RA.formatar(""), "");
  assert.equal(RA.formatar(null), "");
});

test("toda RA da base tem nome mapeado", () => {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "data", "bairros_rio.js"), "utf8"), ctx);
  const nomes = new Set(RA.NOMES);
  for (const b of ctx.BAIRROS_RIO) {
    assert.ok(nomes.has(RA.formatar(b.ra)), "RA sem grafia fixa: " + JSON.stringify(b.ra));
  }
});
