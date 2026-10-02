"use strict";
// Backups/sincronização vêm de fora (arquivo importado, Drive): escape,
// validação de campos, chaves venenosas e marcas de apagado.
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./_carregar.cjs");

function novoContexto() {
  return carregar(["data/municipios.js", "js/geo.js", "js/dados.js", "js/recordes.js", "js/conhecimento.js"]);
}
const ISO = (d) => new Date(d).toISOString();
// o Object.prototype que importa é o do contexto onde os scripts rodam
const vm = require("node:vm");
const noProto = (ctx, k) => vm.runInContext("({})[" + JSON.stringify(k) + "]", ctx);

// ---- escape ----
test("escaparHtml: neutraliza marcação e aspas", () => {
  const { RECORDES } = novoContexto();
  assert.equal(RECORDES.escaparHtml("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(RECORDES.escaparHtml(`a&b "c" 'd'`), "a&amp;b &quot;c&quot; &#39;d&#39;");
  assert.equal(RECORDES.escaparHtml(null), "");
  assert.equal(RECORDES.escaparHtml(3), "3");
});

// ---- importarJson: validação ----
test("recordes: importar só aceita campos conhecidos com os tipos certos", () => {
  const { RECORDES } = novoContexto();
  const r = RECORDES.importarJson(JSON.stringify({
    recordes: {
      ok: { pct: 0.5, tempoSeg: 10, placar: "5/10", rotulo: "r", data: ISO("2026-01-01"), jogos: 3, extra: "x" },
      dataNumero: { pct: 0.5, tempoSeg: 10, data: 12345, placar: { html: 1 } },
      semPct: { tempoSeg: 10 },
      pctTexto: { pct: "0.9", tempoSeg: 10 },
      tempoInfinito: { pct: 0.5, tempoSeg: null },
      lista: [1, 2],
    },
  }));
  assert.equal(r.ok, true);
  const ok = RECORDES.obter("ok");
  assert.equal(ok.extra, undefined);
  assert.equal(ok.jogos, 3);
  const dn = RECORDES.obter("dataNumero");
  assert.equal(dn.data, undefined); // tipo errado: o campo cai
  assert.equal(dn.placar, undefined);
  assert.equal(RECORDES.obter("semPct"), null);
  assert.equal(RECORDES.obter("pctTexto"), null);
  assert.equal(RECORDES.obter("tempoInfinito"), null);
  assert.equal(RECORDES.obter("lista"), null);
  // listar não quebra com data de tipo errado já gravada
  assert.doesNotThrow(() => RECORDES.listar());
  assert.equal(RECORDES.importarJson(JSON.stringify({ recordes: [] })).ok, false);
});

test("recordes: listar ordena mesmo com data numérica no armazenamento", () => {
  const ctx = novoContexto();
  ctx.localStorage.setItem("mapaquiz_recordes_v1", JSON.stringify({
    a: { pct: 1, tempoSeg: 1, data: 5 }, b: { pct: 1, tempoSeg: 1, data: ISO("2026-01-01") },
  }));
  assert.equal(ctx.RECORDES.listar().length, 2);
});

test("recordes: importar respeita a versão (ehAtual)", () => {
  const { RECORDES } = novoContexto();
  const atual = { pct: 0.4, tempoSeg: 30, placar: "", rotulo: "", data: ISO("2026-01-01") };
  RECORDES.registrar("k", atual);
  // de versão antiga, mesmo melhor, não troca um atual
  RECORDES.importarJson(JSON.stringify({ recordes: { k: { pct: 0.9, tempoSeg: 1, versaoRegras: 999 } } }));
  assert.equal(RECORDES.obter("k").pct, 0.4);
  // um atual (mesmo pior) troca o de versão antiga guardado aqui
  RECORDES.importarJson(JSON.stringify({ recordes: { v: { pct: 0.9, tempoSeg: 1, versaoRegras: 999 } } }));
  RECORDES.importarJson(JSON.stringify({ recordes: { v: { pct: 0.2, tempoSeg: 50, versaoRegras: RECORDES.VERSAO_REGRAS } } }));
  assert.equal(RECORDES.obter("v").pct, 0.2);
  assert.equal(RECORDES.ehAtual(RECORDES.obter("v")), true);
});

// ---- chaves venenosas ----
test("recordes: __proto__ no backup não polui nada", () => {
  const ctx = novoContexto();
  const { RECORDES } = ctx;
  const texto = '{"recordes":{"__proto__":{"pct":1,"tempoSeg":1,"poluido":true},"constructor":{"pct":1,"tempoSeg":1}}}';
  assert.equal(RECORDES.importarJson(texto).ok, true);
  assert.equal(noProto(ctx, "poluido"), undefined);
  assert.equal(noProto(ctx, "pct"), undefined);
  assert.equal(RECORDES.listar().length, 0);
  assert.equal(RECORDES.obter("__proto__"), null);
});

test("conhecimento: __proto__ e ids que não são do IBGE são ignorados", () => {
  const ctx = novoContexto();
  const { CONHECIMENTO, DADOS } = ctx;
  const sp = DADOS.municipios[0];
  const texto = '{"__proto__":{"c":5,"poluido":1},"constructor":{"c":2},"abc":{"c":1},"' + sp.id + '":{"c":3}}';
  CONHECIMENTO.mesclar(JSON.parse(texto), JSON.parse('{"__proto__":9,"123":4}'));
  assert.equal(noProto(ctx, "c"), undefined);
  assert.equal(noProto(ctx, "poluido"), undefined);
  assert.equal(CONHECIMENTO.vezesCitou(sp), 3);
  assert.deepEqual(Object.keys(CONHECIMENTO.tudo()), [String(sp.id)]);
  // evento com id inválido não grava nada (antes: Object.prototype.l = 1)
  CONHECIMENTO.localizou({ id: "__proto__" }, 1);
  assert.equal(noProto(ctx, "l"), undefined);
  assert.equal(noProto(ctx, "lp"), undefined);
  assert.deepEqual(Object.keys(CONHECIMENTO.tudo()), [String(sp.id)]);
});

// ---- marcas de apagado (sincronização não ressuscita) ----
test("recordes: apagar uma configuração não volta pela mesclagem", () => {
  const A = novoContexto().RECORDES;
  A.registrar("k", { pct: 0.5, tempoSeg: 10, placar: "", rotulo: "", data: ISO(Date.now() - 60000) });
  const antes = A.exportarJson(); // o "Drive" ainda tem o recorde
  A.apagar("k");
  A.importarJson(antes);
  assert.equal(A.obter("k"), null);
  // a marca viaja: outro aparelho com o recorde antigo o apaga ao mesclar
  const B = novoContexto().RECORDES;
  B.importarJson(antes);
  assert.equal(B.obter("k").pct, 0.5);
  const r = B.importarJson(A.exportarJson());
  assert.equal(B.obter("k"), null);
  assert.match(r.msg, /apagado/);
  // recorde novo, feito depois do apagar, entra normalmente
  const C = novoContexto().RECORDES;
  C.registrar("k", { pct: 0.3, tempoSeg: 10, placar: "", rotulo: "", data: ISO(Date.now() + 60000) });
  A.importarJson(C.exportarJson());
  assert.equal(A.obter("k").pct, 0.3);
});

test("recordes: limpar tudo também vale na mesclagem", () => {
  const A = novoContexto().RECORDES;
  A.registrar("a", { pct: 0.5, tempoSeg: 10, placar: "", rotulo: "", data: ISO(Date.now() - 60000) });
  A.registrar("b", { pct: 0.5, tempoSeg: 10, placar: "", rotulo: "", data: ISO(Date.now() - 60000) });
  const antes = A.exportarJson();
  A.limparTudo();
  A.importarJson(antes);
  assert.equal(A.listar().length, 0);
  // backup antigo, sem marcas: lido normalmente por quem nunca apagou
  const B = novoContexto().RECORDES;
  B.importarJson(antes);
  assert.equal(B.listar().length, 2);
});

test("conhecimento: zerar não volta pela mesclagem; a marca mais nova ganha", () => {
  const A = novoContexto();
  const sp = A.DADOS.municipios[0];
  A.CONHECIMENTO.novaPartida();
  A.CONHECIMENTO.citou([sp]);
  const antes = JSON.parse(JSON.stringify(A.CONHECIMENTO.tudo()));
  const citadasAntes = A.CONHECIMENTO.comoCitadas();
  A.CONHECIMENTO.zerar();
  assert.equal(A.CONHECIMENTO.mesclar(antes, citadasAntes), false);
  assert.equal(A.CONHECIMENTO.vezesCitou(sp), 0);
  const depois = JSON.parse(JSON.stringify(A.CONHECIMENTO.tudo()));
  assert.ok(depois._zeradoEm);
  // outro aparelho com os dados antigos: a marca nova de lá apaga os daqui
  const B = novoContexto();
  B.CONHECIMENTO.mesclar(antes, citadasAntes);
  assert.equal(B.CONHECIMENTO.vezesCitou(sp), 1);
  assert.equal(B.CONHECIMENTO.mesclar(depois), true);
  assert.equal(B.CONHECIMENTO.vezesCitou(sp), 0);
  // depois de zerado, o que foi jogado com a mesma marca mescla normalmente
  A.CONHECIMENTO.novaPartida();
  A.CONHECIMENTO.citou([sp]);
  B.CONHECIMENTO.mesclar(JSON.parse(JSON.stringify(A.CONHECIMENTO.tudo())));
  assert.equal(B.CONHECIMENTO.vezesCitou(sp), 1);
});
