"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./_carregar.cjs");

function novoContexto() {
  return carregar(["data/municipios.js", "js/geo.js", "js/dados.js", "js/recordes.js", "js/conhecimento.js"]);
}

// ---- recordes ----
test("recordes: melhor %, empate pelo tempo, contagem de jogos", () => {
  const { RECORDES } = novoContexto();
  const base = { placar: "x", rotulo: "r", data: "2026-01-01" };
  assert.equal(RECORDES.registrar("k", { ...base, pct: 0.5, tempoSeg: 30 }).melhor, true);
  assert.equal(RECORDES.registrar("k", { ...base, pct: 0.4, tempoSeg: 10 }).melhor, false);
  assert.equal(RECORDES.registrar("k", { ...base, pct: 0.5, tempoSeg: 20 }).melhor, true);
  const r = RECORDES.obter("k");
  assert.equal(r.tempoSeg, 20);
  assert.equal(r.jogos, 3);
});

test("recordes: guardam versão das regras e dos dados", () => {
  const ctx = novoContexto();
  const { RECORDES } = ctx;
  RECORDES.registrar("k", { pct: 0.5, tempoSeg: 30, placar: "", rotulo: "", data: "" });
  const r = RECORDES.obter("k");
  assert.equal(r.versaoRegras, RECORDES.VERSAO_REGRAS);
  assert.equal(r.versaoDados, ctx.MUNICIPIOS_META.versao);
  assert.equal(RECORDES.ehAtual(r), true);
  // recorde antigo sem versão vale como versão 1 (comparável enquanto as regras forem a 1)
  assert.equal(RECORDES.ehAtual({ pct: 1 }), RECORDES.VERSAO_REGRAS === 1);
  // de outra versão: o resultado seguinte substitui, mesmo pior
  assert.equal(RECORDES.ehAtual({ pct: 1, versaoRegras: 999 }), false);
  RECORDES.importarJson(JSON.stringify({ recordes: { v: { pct: 0.9, tempoSeg: 5, versaoRegras: 999 } } }));
  const res = RECORDES.registrar("v", { pct: 0.3, tempoSeg: 30, placar: "", rotulo: "", data: "" });
  assert.equal(res.incomparavel, true);
  assert.equal(RECORDES.obter("v").pct, 0.3);
});

test("recordes: importar mescla pelo melhor e nunca piora", () => {
  const { RECORDES } = novoContexto();
  RECORDES.registrar("a", { pct: 0.5, tempoSeg: 30, placar: "", rotulo: "", data: "" });
  const r = RECORDES.importarJson(JSON.stringify({
    recordes: { a: { pct: 0.4, tempoSeg: 1 }, b: { pct: 0.7, tempoSeg: 9 } },
  }));
  assert.equal(r.ok, true);
  assert.equal(RECORDES.obter("a").pct, 0.5);
  assert.equal(RECORDES.obter("b").pct, 0.7);
  assert.equal(RECORDES.importarJson("{").ok, false);
});

// ---- conhecimento ----
test("conhecimento: citou conta uma vez por partida; dimensões separadas", () => {
  const { CONHECIMENTO, DADOS } = novoContexto();
  const [sp, rj, bsb] = DADOS.municipios;
  CONHECIMENTO.novaPartida();
  CONHECIMENTO.citou([sp, rj]);
  CONHECIMENTO.citou([sp]);
  assert.equal(CONHECIMENTO.vezesCitou(sp), 1);
  CONHECIMENTO.novaPartida();
  CONHECIMENTO.citou([sp]);
  assert.equal(CONHECIMENTO.vezesCitou(sp), 2);
  CONHECIMENTO.localizou(bsb, 0.8);
  CONHECIMENTO.localizou(bsb, 0.2);
  assert.deepEqual(JSON.parse(JSON.stringify(CONHECIMENTO.de(bsb))), { l: 2, lp: 1 });
  CONHECIMENTO.faltou([rj]);
  CONHECIMENTO.faltou([rj]); // mesma partida: não dobra
  assert.equal(CONHECIMENTO.de(rj).f, 1);
  CONHECIMENTO.dica(rj);
  CONHECIMENTO.comparou([sp, rj], true);
  assert.equal(CONHECIMENTO.de(rj).d, 1);
  assert.equal(CONHECIMENTO.de(rj).k, 1);
  assert.equal(CONHECIMENTO.de(rj).ka, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(CONHECIMENTO.comoCitadas())), { [sp.id]: 2, [rj.id]: 1 });
});

test("conhecimento: migra a contagem antiga e mescla pelo maior", () => {
  const ctx = novoContexto();
  const { DADOS } = ctx;
  const [sp, rj] = DADOS.municipios;
  ctx.localStorage.setItem("mapaquiz.citadas.v1", JSON.stringify({ [sp.id]: 3 }));
  // um contexto novo lê a chave antiga na primeira consulta
  const { CONHECIMENTO } = carregar(["data/municipios.js", "js/geo.js", "js/dados.js", "js/conhecimento.js"],
    { localStorage: ctx.localStorage });
  assert.equal(CONHECIMENTO.vezesCitou(sp), 3);
  assert.equal(CONHECIMENTO.mesclar({ [sp.id]: { c: 2, f: 1 }, [rj.id]: { c: 1 } }, { [rj.id]: 4 }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(CONHECIMENTO.de(sp))), { c: 3, f: 1 });
  assert.equal(CONHECIMENTO.de(rj).c, 4);
  // importar de novo o mesmo não muda nada
  assert.equal(CONHECIMENTO.mesclar({ [sp.id]: { c: 2, f: 1 } }), false);
});

test("mudanças disparam o evento mapaquiz:dados", () => {
  const eventos = [];
  const ctx = carregar(["data/municipios.js", "js/geo.js", "js/dados.js", "js/recordes.js", "js/conhecimento.js"], {
    document: { addEventListener() {}, dispatchEvent(ev) { eventos.push(ev.type); } },
  });
  ctx.RECORDES.registrar("k", { pct: 1, tempoSeg: 1, placar: "", rotulo: "", data: "" });
  ctx.CONHECIMENTO.citou([ctx.DADOS.municipios[0]]);
  assert.deepEqual(eventos, ["mapaquiz:dados", "mapaquiz:dados"]);
});
