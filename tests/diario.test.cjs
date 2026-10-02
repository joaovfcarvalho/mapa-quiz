"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./_carregar.cjs");

const ctx = carregar(["data/municipios.js", "js/geo.js", "js/dados.js", "js/modos.js", "js/diario.js"]);
const DIARIO = ctx.DIARIO;
const MODOS = ctx.MODOS;
const DADOS = ctx.DADOS;

// ---- dia em Brasília (UTC−3), não no relógio do aparelho ----
test("a chave e o número do dia viram à meia-noite de Brasília", () => {
  const antes = DIARIO.agoraBrasilia(Date.UTC(2026, 8, 1, 2, 59, 59)); // 23:59:59 de 31/08 em Brasília
  assert.equal(DIARIO.chaveDia(antes), "2026-08-31");
  assert.equal(DIARIO.numeroDia(antes), 0);
  const depois = DIARIO.agoraBrasilia(Date.UTC(2026, 8, 1, 3, 0, 0)); // 00:00 de 01/09 em Brasília
  assert.equal(DIARIO.chaveDia(depois), "2026-09-01");
  assert.equal(DIARIO.numeroDia(depois), 1);
  const outubro = DIARIO.agoraBrasilia(Date.UTC(2026, 9, 2, 12, 0, 0));
  assert.equal(DIARIO.chaveDia(outubro), "2026-10-02");
  assert.equal(DIARIO.numeroDia(outubro), 32);
});

test("dia anterior, dd/mm e contagem até a meia-noite de Brasília", () => {
  const d = DIARIO.agoraBrasilia(Date.UTC(2026, 9, 1, 3, 0, 0));
  assert.equal(DIARIO.chaveDia(DIARIO.diaAnterior(d)), "2026-09-30");
  assert.equal(DIARIO.chaveDia(d), "2026-10-01"); // não altera a data recebida
  assert.equal(DIARIO.ddmm("2026-09-01"), "01/09");
  assert.equal(DIARIO.segundosAteAmanha(Date.UTC(2026, 9, 2, 2, 59, 59)), 1);
  assert.equal(DIARIO.segundosAteAmanha(Date.UTC(2026, 9, 2, 3, 0, 0)), 86400);
  assert.equal(DIARIO.segundosAteAmanha(Date.UTC(2026, 9, 2, 15, 0, 0)), 12 * 3600);
});

// ---- conjunto congelado do sorteio ----
test("o conjunto do diário é fixo, ordenado e existe nos dados", () => {
  const ids = DIARIO.POOL_IDS;
  assert.equal(ids.length, 319);
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i] > ids[i - 1], "ordem crescente sem repetição");
  const porId = new Map(DADOS.municipios.map((m) => [m.id, m]));
  ids.forEach((id) => assert.ok(porId.has(id), "código " + id + " existe nos dados"));
});

test("os secretos de dias conhecidos não mudam", () => {
  const secreto = (n) => DIARIO.idSecreto(n, MODOS.rngSemente);
  assert.equal(secreto(1), 2914802);
  assert.equal(secreto(2), 4100400);
  assert.equal(secreto(32), 1502400); // 02/10/2026: Castanhal (PA)
  assert.equal(secreto(100), 3303500);
});
