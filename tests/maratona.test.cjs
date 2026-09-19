"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./_carregar.cjs");
const { DADOS, MODOS } = carregar(["data/municipios.js", "js/dados.js", "js/modos.js"]);

test("Maratona por 3 letras: ita revela os municípios pelo início do nome", () => {
  const jogo = new MODOS.JogoMaratona({ prefixo: true });
  const r = jogo.palpitar("  ÍTA  ");
  assert.equal(r.tipo, "ok");
  assert.equal(r.termo, "ita");
  const nomes = new Set(r.revelados.map(p => p.mun.nome));
  for (const nome of ["Itaúna", "Itabira", "Itatinga", "Itá"]) assert.ok(nomes.has(nome), nome);
  assert.ok(!nomes.has("Santa Rita"));
  assert.ok(r.revelados.every(p => p.mun.chave.startsWith("ita")));
  assert.equal(jogo.achados.size, r.revelados.length);
  assert.equal(jogo.popAchada, r.revelados.reduce((s, p) => s + p.mun.pop, 0));
  assert.equal(jogo.pibAchado, r.revelados.reduce((s, p) => s + p.mun.pib, 0));
  assert.equal(jogo.areaAchada, r.revelados.reduce((s, p) => s + p.mun.area, 0));
  assert.equal(jogo.palpitar("ita").tipo, "repetido");
  assert.equal(jogo.achadosSessao, r.revelados.length);
});

test("Maratona por 3 letras: rejeita palpites curtos e inexistentes sem alterar progresso", () => {
  const jogo = new MODOS.JogoMaratona({ prefixo: true });
  for (const texto of ["i", "it", "it mg", "i t", "1 2 3", "s p"]) {
    assert.equal(jogo.palpitar(texto).tipo, "prefixo_curto", texto);
  }
  assert.equal(jogo.palpitar("  ").tipo, "vazio");
  assert.equal(jogo.palpitar("zzzz").tipo, "nao_encontrado");
  assert.equal(jogo.achados.size, 0);
  assert.equal(jogo.popAchada, 0);
});

test("Maratona por 3 letras: respeita região, sufixo de UF e prefixos maiores", () => {
  const brasil = new MODOS.JogoMaratona({ prefixo: true });
  const r = brasil.palpitar("ita, MG");
  assert.equal(r.tipo, "ok");
  assert.ok(r.revelados.every(p => p.mun.uf === "MG"));
  const minas = new MODOS.JogoMaratona({ prefixo: true, uf: "MG" });
  assert.equal(minas.palpitar("ita sp").tipo, "nao_encontrado");
  assert.equal(minas.achados.size, 0);
  assert.equal(minas.palpitar("ita").revelados.length, r.revelados.length);
  const especifico = new MODOS.JogoMaratona({ prefixo: true });
  const longo = especifico.palpitar("itab");
  assert.equal(longo.tipo, "ok");
  assert.ok(longo.revelados.some(p => p.mun.nome === "Itabira"));
  assert.ok(!longo.revelados.some(p => p.mun.nome === "Itaúna"));
  const rio = especifico.palpitar("rio de");
  assert.ok(rio.revelados.some(p => p.mun.nome === "Rio de Janeiro"));
  const ji = especifico.palpitar("jip");
  assert.ok(ji.revelados.some(p => p.mun.nome === "Ji-Paraná"));
  assert.equal(especifico.palpitar("ji-p").tipo, "repetido");
});

test("Maratona por 3 letras: retoma progresso e completa todos os 5.571 municípios", () => {
  const anterior = new MODOS.JogoMaratona({ prefixo: true });
  anterior.palpitar("ita mg");
  const jogo = new MODOS.JogoMaratona({ prefixo: true, idsIniciais: anterior.idsAchados() });
  assert.equal(jogo.achados.size, anterior.achados.size);
  assert.equal(jogo.areaAchada, anterior.areaAchada);
  assert.equal(jogo.palpitar("ita mg").tipo, "repetido");
  const prefixos = new Set(DADOS.municipios.map(m => m.chave.replace(/ /g, "").slice(0, 3)));
  for (const prefixo of prefixos) {
    const r = jogo.palpitar(prefixo);
    assert.ok(r.tipo === "ok" || r.tipo === "repetido", prefixo + ": " + r.tipo);
  }
  assert.equal(jogo.achados.size, 5571);
  assert.equal(jogo.pct(), 1);
  assert.equal(jogo.encerrado, true);
  assert.equal(jogo.achadosSessao, 5571 - anterior.achados.size);
  assert.equal(jogo.palpitar("ita").tipo, "encerrado");
});

test("Maratona: nome completo e palavra mantêm suas regras", () => {
  const completa = new MODOS.JogoMaratona({});
  assert.equal(completa.palpitar("itab").tipo, "nao_encontrado");
  assert.equal(completa.palpitar("Itabira").revelados.length, 1);
  const palavra = new MODOS.JogoMaratona({ palavra: true });
  assert.equal(palavra.palpitar("itab").tipo, "nao_encontrado");
  assert.equal(palavra.palpitar("do").tipo, "generico");
  const r = palavra.palpitar("são josé sp");
  assert.equal(r.tipo, "ok");
  assert.ok(r.revelados.some(p => p.mun.nome === "São José dos Campos"));
  assert.ok(r.revelados.every(p => p.mun.uf === "SP"));
  assert.equal(palavra.palpitar("ita").revelados.length, 1); // Itá/SC, sem prefixos
});

test("Maratona: a emenda do topo só anda quando cai a maior que falta", () => {
  const jogo = new MODOS.JogoMaratona({ uf: "RJ" });
  const [maior, segunda, terceira] = jogo.universo;
  assert.equal(jogo.topoSeguido(0), 0);
  // acertar a 2ª antes da 1ª não emenda nada: a fila para na primeira que falta
  assert.equal(jogo.palpitar(segunda.nome + " RJ").tipo, "ok");
  assert.equal(jogo.topoSeguido(0), 0);
  assert.equal(jogo.palpitar(maior.nome + " RJ").tipo, "ok");
  assert.equal(jogo.topoSeguido(0), 2); // a 1ª destrava a 2ª que já estava lá
  assert.equal(jogo.palpitar(terceira.nome + " RJ").tipo, "ok");
  // retomar de onde parou dá o mesmo que varrer desde o começo
  assert.equal(jogo.topoSeguido(2), 3);
  assert.equal(jogo.topoSeguido(0), 3);
  assert.equal(jogo.topoSeguido(), 3);
});

test("Maratona: a emenda do topo chega ao universo inteiro quando tudo sai", () => {
  const jogo = new MODOS.JogoMaratona({ uf: "RR", prefixo: true });
  const prefixos = new Set(jogo.universo.map(m => m.chave.replace(/ /g, "").slice(0, 3)));
  for (const prefixo of prefixos) jogo.palpitar(prefixo + " rr");
  assert.equal(jogo.achados.size, jogo.alvosTotal);
  assert.equal(jogo.topoSeguido(0), jogo.alvosTotal);
});
