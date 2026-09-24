"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./_carregar.cjs");
const { DADOS, MODOS } = carregar(["data/municipios.js", "js/dados.js", "js/modos.js"]);

function maratonaPequena(cfg) {
  const nomes = [
    ["Capital Gigante", "SP", 1000000],
    ["São Bento", "SP", 1000],
    ["São José do Vale", "SP", 900],
    ["São São do Sul", "MG", 800],
    ["Vale do Sol", "SP", 700],
    ["Dois Irmãos", "SP", 600],
    ["Ji-Paraná", "RO", 500],
    ["Santa Rita", "MG", 400],
    ["Itá", "SC", 300],
  ];
  const ctx = carregar(["js/dados.js", "js/modos.js"], {
    MUNICIPIOS: nomes.map(([nome, uf, pop], i) => [i + 1, nome, uf, 0, 0, pop, 0, 1, 1]),
  });
  return new ctx.MODOS.JogoMaratona(cfg);
}

test("Maratona: dica prioriza cidades novas por termo, não população nem repetições no nome", () => {
  for (const cfg of [{ palavra: true }, { prefixo: true }]) {
    const jogo = maratonaPequena(cfg);
    assert.equal(jogo.dica().termo, "sao");
    assert.equal(jogo.dica().restantes, 3); // São São conta uma cidade, não duas
    assert.equal(jogo.achados.size, 0); // pedir ajuda não joga pelo usuário
    assert.equal(jogo.palpitar(jogo.dica().termo).revelados.length, 3);
    assert.ok(!jogo.rankingTermos().some(p => p.termo === "sao"));
  }
  const completa = maratonaPequena({});
  assert.equal(completa.dica().mun.nome, "Capital Gigante");
  assert.equal(completa.rankingTermos().length, 0);
});

test("Maratona por palavra: ranking geral inclui jogadas ainda não usadas e desconta sobreposição", () => {
  const jogo = maratonaPequena({ palavra: true });
  assert.equal(jogo.rankingTermos().find(p => p.termo === "vale").restantes, 2);
  jogo.palpitar("são sp");
  assert.equal(jogo.rankingTermos().find(p => p.termo === "vale").restantes, 1);
  assert.equal(jogo.rankingTermos().find(p => p.termo === "sao").restantes, 1);
  assert.equal(jogo.palpitar("vale").revelados.length, 1);
  assert.ok(!jogo.rankingTermos().some(p => p.termo === "vale"));
});

test("Maratona por palavra: conectivos afetam palpite, ranking e dica, sem desfazer progresso", () => {
  const jogo = maratonaPequena({ palavra: true });
  assert.equal(jogo.palpitar("do").tipo, "generico");
  assert.ok(!jogo.rankingTermos().some(p => p.termo === "do"));
  jogo.cfg.incluirConectivos = true;
  assert.equal(jogo.dica().termo, "do"); // empate com são, resolvido alfabeticamente
  assert.equal(jogo.dica().restantes, 3);
  const r = jogo.palpitar("DO, SP");
  assert.equal(r.revelados.length, 2);
  assert.ok(!r.revelados.some(p => p.mun.nome === "Dois Irmãos"));
  jogo.cfg.incluirConectivos = false;
  assert.equal(jogo.achados.size, 2);
  assert.equal(jogo.palpitar("do").tipo, "generico");
  assert.ok(!jogo.rankingTermos().some(p => p.termo === "do"));
  assert.equal(jogo.dica().termo, "sao");
  assert.equal(jogo.dica().restantes, 2);
  assert.equal(jogo.palpitar("do sul").tipo, "ok"); // expressões continuam valendo
});

test("Maratona: ranking respeita UF, retomada, sincronização e fim do jogo", () => {
  for (const variante of [{ palavra: true }, { prefixo: true }]) {
    const jogo = maratonaPequena({ ...variante, uf: "SP", idsIniciais: [2] });
    assert.equal(jogo.rankingTermos().find(p => p.termo === "sao").restantes, 1);
    assert.ok(!jogo.rankingTermos().some(p => p.termo === "jip" || p.termo === "parana"));
    jogo.absorver([3, 4]); // o id 4 é de MG e não entra
    assert.equal(jogo.achados.size, 2);
    assert.ok(!jogo.rankingTermos().some(p => p.termo === "sao"));
    while (jogo.dica()) {
      const d = jogo.dica();
      assert.equal(jogo.palpitar(d.termo).revelados.length, d.restantes);
    }
    assert.equal(jogo.encerrado, true);
    assert.equal(jogo.rankingTermos().length, 0);
    assert.equal(jogo.dica(), null);
  }
});

test("Maratona por 3 letras: ranking segue o início normalizado, incluindo hífens e acentos", () => {
  const jogo = maratonaPequena({ prefixo: true });
  assert.equal(jogo.rankingTermos().find(p => p.termo === "jip").restantes, 1);
  assert.equal(jogo.rankingTermos().find(p => p.termo === "ita").restantes, 1); // só Itá, não Santa Rita
  const ranking = JSON.stringify(jogo.rankingTermos());
  jogo.cfg.incluirConectivos = true;
  assert.equal(JSON.stringify(jogo.rankingTermos()), ranking);
  assert.equal(jogo.palpitar("  JÍ-P  ").revelados.length, 1);
  assert.ok(!jogo.rankingTermos().some(p => p.termo === "jip"));
});

test("Maratona: todo termo sugerido é jogável e tem a contagem correta nos dados do Brasil", () => {
  for (const cfg of [{ palavra: true }, { palavra: true, incluirConectivos: true }, { prefixo: true }]) {
    const jogo = new MODOS.JogoMaratona(cfg);
    jogo.palpitar("sao sp");
    const ranking = jogo.rankingTermos();
    for (let i = 0; i < ranking.length; i++) {
      const item = ranking[i];
      const busca = cfg.prefixo ? jogo.buscarPorPrefixo(item.termo) : jogo.buscarPorPalavra(item.termo);
      assert.equal(busca.status, "ok", item.termo);
      assert.equal(item.restantes, busca.municipios.filter(m => !jogo.achados.has(m.idx)).length, item.termo);
      if (i) assert.ok(ranking[i - 1].restantes >= item.restantes);
    }
    const dica = jogo.dica();
    assert.equal(jogo.palpitar(dica.termo).revelados.length, dica.restantes);
  }
});

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
