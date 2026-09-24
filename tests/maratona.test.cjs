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

test("Maratona: dicas de palavra e prefixo mostram só inicial e cidades novas", () => {
  for (const cfg of [{ palavra: true }, { prefixo: true }]) {
    const jogo = maratonaPequena(cfg);
    const dica = jogo.dica();
    assert.deepEqual(Object.keys(dica).sort(), ["inicial", "restantes"]);
    assert.equal(dica.inicial, "S");
    assert.equal(dica.restantes, 3); // São São conta só uma cidade
    assert.equal(jogo.achados.size, 0);
    assert.equal(jogo.placarTermos().acertados, 0);
    jogo.palpitar("sao");
    assert.equal(jogo.placarTermos().primeira, true);
    assert.equal(jogo.placarTermos().seguidas, 1);
    assert.equal(jogo.rankingTermos()[0].termo, "sao"); // posição não muda
    assert.equal(jogo.rankingTermos()[0].restantes, 0);
    assert.notEqual(jogo.dica().inicial, "S");
  }
  const completa = maratonaPequena({});
  assert.equal(completa.dica().mun.nome, "Capital Gigante");
  assert.equal(completa.rankingTermos().length, 0);
});

test("Maratona: placar conta os termos digitados, sem dar crédito por sobreposição", () => {
  const jogo = maratonaPequena({ palavra: true });
  jogo.palpitar("sao");
  const bento = jogo.rankingTermos().find(p => p.termo === "bento");
  assert.equal(bento.restantes, 0);
  assert.equal(bento.acertado, false);
  assert.equal(jogo.placarTermos().acertados, 1);
  const r = jogo.palpitar("bento");
  assert.equal(r.tipo, "repetido");
  assert.equal(r.termoNovo, true); // ainda vale como palavra acertada
  assert.equal(jogo.placarTermos().acertados, 2);
  assert.equal(jogo.palpitar("bento").termoNovo, false);
});

test("Maratona: oito das dez primeiras, nº 1 e sequência têm posições fixas", () => {
  for (const cfg of [{ palavra: true }, { prefixo: true }]) {
    const jogo = new MODOS.JogoMaratona(cfg);
    const primeiras = jogo.rankingTermos().slice(0, 10).map(p => p.termo);
    for (const termo of primeiras.slice(1, 9)) jogo.palpitar(termo);
    let p = jogo.placarTermos();
    assert.equal(p.primeira, false);
    assert.equal(p.seguidas, 0);
    assert.equal(p.faixas[0].total, 10);
    assert.equal(p.faixas[0].acertados, 8);
    jogo.palpitar(primeiras[0]);
    p = jogo.placarTermos();
    assert.equal(p.primeira, true);
    assert.equal(p.seguidas, 9);
    assert.equal(p.faixas[0].acertados, 9);
    assert.equal(JSON.stringify(jogo.rankingTermos().slice(0, 10).map(p => p.termo)), JSON.stringify(primeiras));
    assert.ok(!JSON.stringify(p).includes(primeiras[0])); // saída do placar não contém resposta
  }
});

test("Maratona: conectivos afetam palpites, posições e dicas, preservando acertos", () => {
  const jogo = maratonaPequena({ palavra: true });
  assert.equal(jogo.palpitar("do").tipo, "generico");
  assert.equal(jogo.termosAchados.size, 0);
  jogo.cfg.incluirConectivos = true;
  assert.equal(jogo.dica().inicial, "D");
  assert.equal(jogo.dica().restantes, 3);
  assert.equal(jogo.palpitar("DO, SP").revelados.length, 2);
  assert.equal(jogo.placarTermos().primeira, true);
  assert.equal(jogo.placarTermos().acertados, 1);
  jogo.cfg.incluirConectivos = false;
  assert.equal(jogo.placarTermos().acertados, 0);
  assert.equal(jogo.achados.size, 2);
  assert.equal(jogo.palpitar("do").tipo, "generico");
  assert.equal(jogo.dica().inicial, "S");
  assert.equal(jogo.dica().restantes, 2);
  jogo.cfg.incluirConectivos = true;
  assert.equal(jogo.placarTermos().acertados, 1);
});

test("Maratona: UF, normalização e expressões não inventam acertos de termos", () => {
  const jogo = maratonaPequena({ palavra: true, uf: "SP" });
  assert.equal(jogo.rankingTermos()[0].total, 2);
  assert.equal(jogo.palpitar("sao mg").tipo, "nao_encontrado");
  assert.equal(jogo.palpitar("são josé").tipo, "ok");
  assert.equal(jogo.placarTermos().acertados, 0); // não digitou são isoladamente
  assert.equal(jogo.palpitar(" SÃO, SP ").tipo, "ok");
  assert.equal(jogo.placarTermos().acertados, 1);
  const prefixo = maratonaPequena({ prefixo: true });
  prefixo.palpitar("sao b");
  assert.equal(prefixo.placarTermos().acertados, 0);
  prefixo.palpitar(" JÍ-P ");
  assert.equal(prefixo.rankingTermos().find(p => p.termo === "jip").acertado, true);
  assert.equal(prefixo.rankingTermos().find(p => p.termo === "ita").total, 1); // sem Santa Rita
});

test("Maratona: placar persiste além de oito palpites e absorve só termos da região", () => {
  for (const cfg of [{ palavra: true }, { prefixo: true }]) {
    const anterior = new MODOS.JogoMaratona(cfg);
    anterior.rankingTermos().slice(0, 15).forEach(p => anterior.palpitar(p.termo));
    const jogo = new MODOS.JogoMaratona({ ...cfg, idsIniciais: anterior.idsAchados(), termosIniciais: Array.from(anterior.termosAchados) });
    assert.equal(jogo.placarTermos().acertados, 15);
    assert.equal(jogo.achados.size, anterior.achados.size);
    jogo.absorverTermos([null, 1, {}, "zzzzzzz"]);
    assert.equal(jogo.placarTermos().acertados, 15); // termo inexistente não pontua
    const termo = jogo.rankingTermos()[15].termo;
    assert.equal(jogo.absorverTermos([termo]), true);
    assert.equal(jogo.absorverTermos([termo]), false);
    assert.equal(jogo.placarTermos().acertados, 16);
  }
});

test("Maratona: migração só recupera termos comprovados pelos últimos palpites", () => {
  const antigos = { ids: [1, 2], ultimos: [{ t: "“são” → 3 municípios" }, { t: "São Paulo (SP)" }, null] };
  const termos = MODOS.JogoMaratona.termosSalvos(antigos);
  assert.equal(JSON.stringify(termos), JSON.stringify(["são"]));
  const jogo = maratonaPequena({ palavra: true, idsIniciais: [2], termosIniciais: termos });
  assert.equal(jogo.placarTermos().acertados, 1);
  assert.equal(jogo.placarTermos().primeira, true);
  assert.equal(JSON.stringify(MODOS.JogoMaratona.termosSalvos({ termos: ["vale"], ultimos: antigos.ultimos })), JSON.stringify(["vale"]));
});

test("Maratona: dicas terminam quando todas as cidades estão cobertas", () => {
  for (const cfg of [{ palavra: true }, { prefixo: true }]) {
    const jogo = maratonaPequena(cfg);
    jogo.absorver(jogo.universo.map(m => m.id));
    assert.equal(jogo.dica(), null);
    assert.equal(jogo.placarTermos().acertados, 0); // sincronizar cidades não inventa palpites
  }
});

test("Maratona: contagens internas conferem com as buscas reais do Brasil", () => {
  for (const cfg of [{ palavra: true }, { palavra: true, incluirConectivos: true }, { prefixo: true }]) {
    const jogo = new MODOS.JogoMaratona(cfg);
    jogo.palpitar("sao sp");
    const ranking = jogo.rankingTermos();
    for (let i = 0; i < ranking.length; i++) {
      const item = ranking[i];
      const busca = cfg.prefixo ? jogo.buscarPorPrefixo(item.termo) : jogo.buscarPorPalavra(item.termo);
      assert.equal(busca.status, "ok", item.termo);
      assert.equal(item.total, busca.municipios.length, item.termo);
      assert.equal(item.restantes, busca.municipios.filter(m => !jogo.achados.has(m.idx)).length, item.termo);
      if (i) assert.ok(ranking[i - 1].total >= item.total);
    }
    const candidatos = ranking.filter(r => !r.acertado && r.restantes > 0);
    assert.equal(jogo.dica().restantes, Math.max(...candidatos.map(r => r.restantes)));
    assert.deepEqual(Object.keys(jogo.dica()).sort(), ["inicial", "restantes"]);
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
