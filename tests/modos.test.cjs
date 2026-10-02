"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./_carregar.cjs");

const ctx = carregar(["data/municipios.js", "data/vizinhos.js", "js/geo.js", "js/dados.js", "js/modos.js"]);
const MODOS = ctx.MODOS;
const DADOS = ctx.DADOS;

function jogar(jogo, nomes) {
  return nomes.map((n) => jogo.palpitar(n));
}

// ---- semente: a mesma semente dá a mesma partida ----
test("rngSemente é determinístico e a semente 0 não trava", () => {
  const a = MODOS.rngSemente(123), b = MODOS.rngSemente(123);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const z = MODOS.rngSemente(0);
  const v = z();
  assert.ok(v >= 0 && v < 1);
});

test("Onde estou? com semente: mesmo secreto; sem semente: sorteio livre", () => {
  const a = new MODOS.JogoOndeEstou({ minPop: 100000, semente: 42 });
  const b = new MODOS.JogoOndeEstou({ minPop: 100000, semente: 42 });
  assert.equal(a.secreto.id, b.secreto.id);
  const c = new MODOS.JogoOndeEstou({ minPop: 100000, semente: 43 });
  assert.notEqual(a.secreto.id, c.secreto.id);
  const livre = new MODOS.JogoOndeEstou({ minPop: 100000 });
  assert.ok(livre.secreto.pop >= 100000);
});

test("Onde estou? respeita o secreto fixo (Desafio do dia) e a região", () => {
  const sp = DADOS.buscar("São Paulo").municipios[0];
  const j = new MODOS.JogoOndeEstou({ minPop: 100000, secreto: sp, semente: 1 });
  assert.equal(j.secreto.id, sp.id);
  const mg = new MODOS.JogoOndeEstou({ minPop: 50000, uf: "MG", semente: 7 });
  assert.equal(mg.secreto.uf, "MG");
});

test("Onde fica? com semente: mesma sequência de alvos", () => {
  const a = new MODOS.JogoClique({ minPop: 100000, rodadas: 8, semente: 99 });
  const b = new MODOS.JogoClique({ minPop: 100000, rodadas: 8, semente: 99 });
  assert.deepEqual(a.alvos.map((m) => m.id), b.alvos.map((m) => m.id));
  assert.equal(new Set(a.alvos.map((m) => m.id)).size, 8);
});

test("Cerco e Ponte com semente: mesmo alvo e mesmo par", () => {
  const c1 = new MODOS.JogoCerco({ minPop: 100000, semente: 5 });
  const c2 = new MODOS.JogoCerco({ minPop: 100000, semente: 5 });
  assert.equal(c1.alvo.id, c2.alvo.id);
  const p1 = new MODOS.JogoPonte({ minPop: 100000, semente: 5 });
  const p2 = new MODOS.JogoPonte({ minPop: 100000, semente: 5 });
  assert.equal(p1.a.id, p2.a.id);
  assert.equal(p1.b.id, p2.b.id);
  assert.ok(p1.minMeio >= 2);
});

// ---- pontuação ----
test("Onde estou?: 100% de primeira, −4 pontos por palpite ou dica extra", () => {
  const sp = DADOS.buscar("São Paulo").municipios[0];
  const j = new MODOS.JogoOndeEstou({ minPop: 100000, secreto: sp });
  const r1 = j.palpitar("Campinas");
  assert.equal(r1.tipo, "ok");
  assert.ok(r1.distKm > 80 && r1.distKm < 100);
  j.dica();
  const r2 = j.palpitar("São Paulo");
  assert.equal(r2.acertou, true);
  assert.ok(Math.abs(j.pct() - 0.92) < 1e-9); // 3 "palpites": 1 − 0,04·2
});

test("Onde fica?: 100% até 15 km, 0 a partir de 500 km", () => {
  const j = new MODOS.JogoClique({ minPop: 100000, rodadas: 3, semente: 1 });
  const alvo = j.alvoAtual();
  assert.equal(j.responder(alvo.lat, alvo.lng).score, 1);
  const a2 = j.alvoAtual();
  const longe = ctx.GEO.destino(a2.lat, a2.lng, 90, 600);
  assert.equal(j.responder(longe[0], longe[1]).score, 0);
  assert.ok(Math.abs(j.pct() - 1 / 3) < 1e-9); // a terceira rodada, não jogada, vale 0
});

test("Top N: acerto, repetido, não alvo, dica e faltantes", () => {
  const j = new MODOS.JogoTopN({ n: 5 });
  assert.equal(j.alvos[0].nome, "São Paulo");
  assert.equal(jogar(j, ["são paulo"])[0].revelados[0].rank, 1);
  assert.equal(j.palpitar("sao paulo").tipo, "repetido");
  assert.equal(j.palpitar("Campinas").tipo, "nao_alvo");
  assert.equal(j.dica().rank, 2);
  assert.equal(j.encerrar().length, 4);
  assert.equal(j.pct(), 0.2);
});

test("Top N: orçamento de palpites conta só as cidades novas nomeadas", () => {
  const j = new MODOS.JogoTopN({ n: 10, palpites: 3 });
  assert.equal(j.palpitesRestantes(), 3);

  // nome inexistente e cidade fora do ranking: só o segundo gasta palpite
  assert.equal(j.palpitar("Xanadu").tipo, "nao_encontrado");
  assert.equal(j.palpitesRestantes(), 3);
  assert.equal(j.palpitar("Campinas").tipo, "nao_alvo");
  assert.equal(j.palpitesRestantes(), 2);

  // acerto gasta palpite; repetir o mesmo acerto não
  const ok = j.palpitar("São Paulo");
  assert.equal(ok.tipo, "ok");
  assert.equal(ok.semPalpites, false);
  assert.equal(j.palpitesRestantes(), 1);
  assert.equal(j.palpitar("sao paulo").tipo, "repetido");
  assert.equal(j.palpitesRestantes(), 1);

  // o último palpite encerra a partida, com os alvos restantes por revelar
  const fim = j.palpitar("Rio de Janeiro");
  assert.equal(fim.semPalpites, true);
  assert.equal(fim.completo, false);
  assert.equal(j.encerrado, true);
  assert.equal(j.palpitesRestantes(), 0);
  assert.equal(j.palpitar("Brasília").tipo, "encerrado");
  assert.equal(j.encerrar().length, 8);
});

test("Top N sem orçamento: palpitesRestantes é nulo e nada encerra antes do fim", () => {
  const j = new MODOS.JogoTopN({ n: 5 });
  assert.equal(j.palpitesRestantes(), null);
  assert.equal(j.palpitar("Campinas").semPalpites, false);
  assert.equal(j.encerrado, false);
});

test("Círculos por distância: cobre e bloqueia cidade coberta", () => {
  const j = new MODOS.JogoCirculosDistancia({ raio: 100, metrica: "pop", palpites: 2, bloqueio: true });
  const sp = DADOS.buscar("São Paulo").municipios;
  const r = j.palpitar(sp);
  assert.equal(r.tipo, "ok");
  assert.ok(j.cobertos.has(DADOS.buscar("Campinas").municipios[0].idx));
  assert.equal(j.palpitar(DADOS.buscar("Campinas").municipios).tipo, "coberto");
  assert.ok(j.pct() > 0.1);
});

test("Caminho: pontua contra o mínimo por BFS", () => {
  const nit = DADOS.buscar("Niterói").municipios[0];
  const viz = MODOS.vizinhosDe(nit)[0]; // São Gonçalo (Rio fica do outro lado da baía)
  const j = new MODOS.JogoCaminho({ origem: nit, destino: viz });
  assert.equal(j.minSaltos, 1);
  assert.equal(j.palpitar(viz.nome + ", " + viz.uf).venceu, true);
  assert.equal(j.pct(), 1);
  const rio = DADOS.buscar("Rio de Janeiro").municipios[0];
  const k = new MODOS.JogoCaminho({ origem: rio, destino: nit });
  assert.equal(k.palpitar("Niterói").tipo, "nao_vizinho");
  assert.ok(k.minSaltos >= 2);
});

test("Maratona absorve ids de outro aparelho sem repetir", () => {
  const j = new MODOS.JogoMaratona({ uf: "RJ" });
  j.palpitar("Niterói");
  const ids = [DADOS.buscar("Niterói").municipios[0].id, DADOS.buscar("Rio de Janeiro").municipios[0].id];
  const novos = j.absorver(ids);
  assert.equal(novos.length, 1);
  assert.equal(novos[0].nome, "Rio de Janeiro");
  assert.equal(j.achados.size, 2);
});

// ---- Maior ou menor? ----
test("Maior ou menor?: pares válidos, determinismo e pontuação", () => {
  const a = new MODOS.JogoMaiorMenor({ metrica: "pop", rodadas: 10, minPop: 50000, semente: 7 });
  const b = new MODOS.JogoMaiorMenor({ metrica: "pop", rodadas: 10, minPop: 50000, semente: 7 });
  assert.equal(a.atual.a.id, b.atual.a.id);
  let acertos = 0;
  while (!a.encerrado) {
    const p = a.atual;
    assert.notEqual(p.va, p.vb);
    assert.ok(p.a.pop >= 50000 && p.b.pop >= 50000);
    const certo = p.va > p.vb ? "a" : "b";
    const r = a.responder(certo);
    assert.equal(r.acertou, true);
    acertos++;
  }
  assert.equal(acertos, 10);
  assert.equal(a.pct(), 1);
  assert.equal(a.melhorSequencia, 10);
});

test("Maior ou menor?: os pares apertam ao longo da partida", () => {
  const j = new MODOS.JogoMaiorMenor({ metrica: "pop", rodadas: 10, minPop: 0, semente: 3 });
  const razoes = [];
  while (!j.encerrado) {
    const p = j.atual;
    razoes.push(Math.max(p.va, p.vb) / Math.min(p.va, p.vb));
    j.responder("a");
  }
  // a mediana das últimas rodadas é menor que a das primeiras
  const med = (l) => l.slice().sort((x, y) => x - y)[Math.floor(l.length / 2)];
  assert.ok(med(razoes.slice(5)) <= med(razoes.slice(0, 5)), razoes.join(","));
});

test("Maior ou menor?: a razão cai aos poucos e nunca vira cara ou coroa", () => {
  for (let semente = 1; semente <= 30; semente++) {
    [["pop", 50000, undefined], ["pop", 20000, "RJ"], ["pibpc", 50000, undefined]].forEach(([metrica, minPop, uf]) => {
      const j = new MODOS.JogoMaiorMenor({ metrica, rodadas: 10, minPop, uf, semente });
      const razoes = [];
      while (!j.encerrado) {
        const p = j.atual;
        razoes.push(Math.max(p.va, p.vb) / Math.min(p.va, p.vb));
        j.responder("a");
      }
      const rot = metrica + "/" + (uf || "BR") + "/" + semente + ": " + razoes.map((r) => r.toFixed(2)).join(" ");
      assert.ok(razoes[0] >= 2 && razoes[0] <= 6, "primeira rodada folgada — " + rot);
      assert.ok(razoes[9] >= 1.08 && razoes[9] <= 1.8, "última rodada apertada, não empate — " + rot);
      razoes.forEach((r) => assert.ok(r >= 1.08, "nunca abaixo de 8% — " + rot));
    });
  }
});

test("Maior ou menor?: métricas derivadas e região", () => {
  ["area", "pib", "densidade", "pibpc", "lat", "lng"].forEach((metrica) => {
    const j = new MODOS.JogoMaiorMenor({ metrica, rodadas: 3, minPop: 20000, uf: "BA", semente: 1 });
    assert.ok(!j.erroInicial, metrica);
    assert.equal(j.atual.a.uf, "BA");
    assert.equal(j.atual.b.uf, "BA");
  });
  const pequeno = new MODOS.JogoMaiorMenor({ metrica: "pop", rodadas: 3, minPop: 500000, uf: "AC" });
  assert.ok(pequeno.erroInicial);
});

test("Ordene: pontua pela fração de pares certos", () => {
  const j = new MODOS.JogoOrdene({ metrica: "pop", rodadas: 2, minPop: 50000, semente: 11 });
  const certa = j.atual.itens.slice().sort((x, y) => x.v - y.v).map((p) => p.m.idx);
  const r1 = j.responder(certa);
  assert.equal(r1.score, 1);
  assert.equal(r1.perfeita, true);
  const invertida = j.atual.itens.slice().sort((x, y) => y.v - x.v).map((p) => p.m.idx);
  const r2 = j.responder(invertida);
  assert.equal(r2.score, 0);
  assert.equal(j.encerrado, true);
  assert.equal(j.pct(), 0.5);
});

test("Ordene: ordem inválida é recusada", () => {
  const j = new MODOS.JogoOrdene({ metrica: "area", rodadas: 1, minPop: 50000, semente: 2 });
  assert.equal(j.responder([1, 2, 3]), null);
  assert.equal(j.encerrado, false);
});

test("Ordene: cidade repetida na resposta é recusada", () => {
  const j = new MODOS.JogoOrdene({ metrica: "pop", rodadas: 1, minPop: 50000, semente: 4 });
  const certa = j.atual.itens.slice().sort((x, y) => x.v - y.v).map((p) => p.m.idx);
  const repetida = certa.slice();
  repetida[1] = repetida[0];
  assert.equal(j.responder(repetida), null);
  assert.equal(j.encerrado, false);
  assert.equal(j.responder(certa).score, 1);
});

test("Ordene: a maior cidade do pool também é sorteada", () => {
  [["pop", undefined, 50000], ["pop", "RJ", 20000], ["area", "SP", 50000]].forEach(([metrica, uf, minPop]) => {
    let apareceu = false;
    for (let semente = 1; semente <= 400 && !apareceu; semente++) {
      const j = new MODOS.JogoOrdene({ metrica, uf, minPop, rodadas: 5, semente });
      const topo = j.pool[j.pool.length - 1].m.idx;
      while (!j.encerrado && !apareceu) {
        apareceu = j.atual.itens.some((p) => p.m.idx === topo);
        j.responder(j.atual.itens.map((p) => p.m.idx));
      }
    }
    assert.ok(apareceu, metrica + "/" + (uf || "BR"));
  });
});

// ---- toda configuração começa com erro claro ou joga todas as rodadas ----
const UFS = [undefined].concat(Array.from(new Set(DADOS.municipios.map((m) => m.uf))));
const PORTES = [0, 20000, 50000, 100000];

test("Maior ou menor? e Ordene: toda métrica × UF × porte dá erroInicial ou partida completa", () => {
  Object.keys(MODOS.METRICAS).forEach((metrica) => UFS.forEach((uf) => PORTES.forEach((minPop) => {
    const rot = metrica + "/" + (uf || "BR") + "/" + minPop;
    const d = new MODOS.JogoMaiorMenor({ metrica, uf, minPop, rodadas: 10, semente: 1 });
    if (!d.erroInicial) {
      assert.ok(d.atual && !d.encerrado, "duelo " + rot);
      while (!d.encerrado) { const p = d.atual; d.responder(p.va > p.vb ? "a" : "b"); }
      assert.equal(d.resultados.length, 10, "duelo " + rot);
      assert.equal(d.pct(), 1, "duelo " + rot);
    }
    const o = new MODOS.JogoOrdene({ metrica, uf, minPop, rodadas: 5, semente: 1 });
    if (!o.erroInicial) {
      assert.ok(o.atual && !o.encerrado, "ordene " + rot);
      while (!o.encerrado) o.responder(o.atual.itens.slice().sort((x, y) => x.v - y.v).map((p) => p.m.idx));
      assert.equal(o.resultados.length, 5, "ordene " + rot);
      assert.equal(o.pct(), 1, "ordene " + rot);
    }
  })));
});

test("Maior ou menor? e Ordene: regiões apertadas afrouxam a faixa em vez de começar encerradas", () => {
  [{ metrica: "pibpc", uf: "RO", minPop: 50000 }, { metrica: "lat", uf: "AL", minPop: 20000 }].forEach((cfg) => {
    const j = new MODOS.JogoMaiorMenor(Object.assign({ rodadas: 10, semente: 1 }, cfg));
    assert.ok(!j.erroInicial && j.atual, cfg.metrica + "/" + cfg.uf);
  });
  [{ metrica: "lat", uf: "AL", minPop: 0 }, { metrica: "lat", uf: "PE", minPop: 50000 }].forEach((cfg) => {
    const j = new MODOS.JogoOrdene(Object.assign({ rodadas: 5, semente: 1 }, cfg));
    assert.ok(!j.erroInicial && j.atual, cfg.metrica + "/" + cfg.uf);
  });
});

test("Maior ou menor? e Ordene: pool que acaba no meio pontua pelas rodadas jogadas", () => {
  const d = new MODOS.JogoMaiorMenor({ metrica: "pop", rodadas: 10, minPop: 50000, semente: 2 });
  const p = d.atual;
  // empates não são comparáveis: não sai mais nenhum par
  d.pool = [{ m: p.a, v: 1 }, { m: p.b, v: 1 }];
  d.responder(p.va > p.vb ? "a" : "b");
  assert.equal(d.encerrado, true);
  assert.equal(d.rodadas, 1);
  assert.equal(d.pct(), 1);

  const o = new MODOS.JogoOrdene({ metrica: "pop", rodadas: 5, minPop: 50000, semente: 2 });
  const certa = o.atual.itens.slice().sort((x, y) => x.v - y.v).map((q) => q.m.idx);
  o.pool = [];
  o.responder(certa);
  assert.equal(o.encerrado, true);
  assert.equal(o.rodadas, 1);
  assert.equal(o.pct(), 1);
});

test("Maior ou menor?: diferença mínima de 8% (0,25°) em todas as UFs, mesmo com a faixa aberta", () => {
  Object.keys(MODOS.METRICAS).forEach((metrica) => UFS.forEach((uf) => [50000, 100000].forEach((minPop) => {
    for (let semente = 1; semente <= 5; semente++) {
      const j = new MODOS.JogoMaiorMenor({ metrica, uf, minPop, rodadas: 10, semente });
      if (j.erroInicial) return;
      while (!j.encerrado) {
        const p = j.atual;
        const rot = metrica + "/" + (uf || "BR") + "/" + minPop + "/" + semente;
        if (metrica === "lat" || metrica === "lng") assert.ok(Math.abs(p.va - p.vb) >= 0.25, rot);
        else assert.ok(Math.max(p.va, p.vb) / Math.min(p.va, p.vb) >= 1.08, rot);
        j.responder("a");
      }
    }
  })));
});

// ---- Top N: repetir um erro não gasta palpite ----
test("Top N: repetir a mesma cidade fora do ranking não gasta palpite", () => {
  const j = new MODOS.JogoTopN({ n: 10, palpites: 3 });
  assert.equal(j.palpitar("Campinas").tipo, "nao_alvo");
  assert.equal(j.palpitesRestantes(), 2);
  assert.equal(j.palpitar("campinas").tipo, "repetido");
  assert.equal(j.palpitar("Campinas, SP").tipo, "repetido");
  assert.equal(j.palpitesRestantes(), 2);
  assert.equal(j.palpitar("Guarulhos").tipo, "nao_alvo");
  assert.equal(j.palpitesRestantes(), 1);
});

// ---- Mancha: só conta quem a mancha alcança ----
test("Mancha: ilhas sem divisa ficam fora do total; o DF não tem jogo", () => {
  assert.equal(new MODOS.JogoMancha({}).alvosTotal, 5568);
  assert.equal(new MODOS.JogoMancha({ uf: "SP" }).alvosTotal, 644);
  assert.equal(new MODOS.JogoMancha({ uf: "PE" }).alvosTotal, 184);
  assert.equal(new MODOS.JogoMancha({ uf: "MT" }).alvosTotal, 141);
  assert.equal(new MODOS.JogoMancha({ uf: "RJ" }).alvosTotal, 92);
  assert.ok(new MODOS.JogoMancha({ uf: "DF" }).erroInicial);
  assert.ok(!new MODOS.JogoMancha({ uf: "SP" }).erroInicial);
  assert.equal(new MODOS.JogoMancha({ uf: "SP" }).palpitar("Ilhabela").tipo, "isolado");
});

test("Mancha: cobrir todo município alcançável vale 100%", () => {
  const j = new MODOS.JogoMancha({ uf: "SE" });
  j.palpitar(j.universo[0].nome + ", SE");
  while (j.fronteira.size) {
    const idx = j.fronteira.values().next().value;
    j.palpitar(DADOS.municipios[idx].nome + ", SE");
  }
  assert.equal(j.encerrado, true);
  assert.equal(j.pct(), 1);
});

// ---- Onde estou?: máscara do nome ----
test("Onde estou?: a máscara mostra a inicial depois do apóstrofo", () => {
  const sbo = DADOS.buscar("Santa Bárbara d'Oeste").municipios[0];
  const j = new MODOS.JogoOndeEstou({ minPop: 0, secreto: sbo });
  j.dica(); j.dica();
  assert.equal(j.dica().mascara, "S____ B______ d'O____");
  const sj = new MODOS.JogoOndeEstou({ minPop: 0, secreto: DADOS.buscar("São José dos Campos").municipios[0] });
  sj.dica(); sj.dica();
  assert.equal(sj.dica().mascara, "S__ J___ dos C_____");
});
