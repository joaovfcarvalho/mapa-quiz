"use strict";
// Decodificador da malha do Censo (js/censo-topo.js) e conferência dos dados
// gerados por tools/build_censo.py contra os totais publicados pelo IBGE.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { carregar } = require("./_carregar.cjs");

const tipados = {
  Int8Array, Int32Array, Float32Array, Float64Array, Uint8Array, Infinity, NaN,
};
const ctx = carregar(["js/censo-topo.js"], tipados);
const TOPO = ctx.CENSO_TOPO;

// Topologia de brinquedo: dois quadrados lado a lado que dividem a mesma
// aresta (o arco 0, percorrido ao contrário pelo segundo) e um terceiro
// quadrado com um buraco no meio.
//   A = (0,0)-(10,10)   B = (10,0)-(20,10)   C = (30,0)-(40,10) com vazio interno
const BRINQUEDO = {
  escala: [1, 1],
  translada: [0, 0],
  arcos: [
    10, 0, 0, 10,                                  // arco 0: (10,0) → (10,10)
    10, 10, -10, 0, 0, -10, 10, 0,                 // arco 1: (10,10) → (0,10) → (0,0) → (10,0)
    10, 0, 10, 0, 0, 10, -10, 0,                   // arco 2: (10,0) → (20,0) → (20,10) → (10,10)
    30, 0, 10, 0, 0, 10, -10, 0, 0, -10,           // arco 3: contorno de C
    32, 2, 6, 0, 0, 6, -6, 0, 0, -6,               // arco 4: buraco de C
  ],
  arcosIni: [0, 2, 6, 10, 15, 20],
  unidadeNAnel: [1, 1, 2],
  anelTam: [2, 2, 1, 1],
  anelIds: [0, 1, -1, 2, 3, 4],
};

test("decodifica os arcos compartilhados e mede cada unidade", () => {
  const m = TOPO.decodificar(BRINQUEDO);
  assert.equal(m.n, 3);
  assert.deepEqual([m.minX[0], m.minY[0], m.maxX[0], m.maxY[0]], [0, 0, 10, 10]);
  assert.deepEqual([m.minX[1], m.minY[1], m.maxX[1], m.maxY[1]], [10, 0, 20, 10]);
  assert.deepEqual([m.minX[2], m.minY[2], m.maxX[2], m.maxY[2]], [30, 0, 40, 10]);
  // centroide do quadrado é o centro
  assert.ok(Math.abs(m.cx[0] - 5) < 1e-4 && Math.abs(m.cy[0] - 5) < 1e-4);
  assert.ok(Math.abs(m.cx[1] - 15) < 1e-4 && Math.abs(m.cy[1] - 5) < 1e-4);
});

test("acha a unidade sob um ponto, e o buraco não conta", () => {
  const m = TOPO.decodificar(BRINQUEDO);
  assert.equal(TOPO.unidadeEm(m, 5, 5), 0);
  assert.equal(TOPO.unidadeEm(m, 15, 5), 1);
  assert.equal(TOPO.unidadeEm(m, 31, 5), 2);   // dentro de C, fora do buraco
  assert.equal(TOPO.unidadeEm(m, 35, 5), -1);  // dentro do buraco de C
  assert.equal(TOPO.unidadeEm(m, -5, 5), -1);  // fora de tudo
  assert.equal(TOPO.unidadeEm(m, 25, 5), -1);  // no vão entre B e C
});

test("percorrer fecha cada anel e não repete o vértice de emenda", () => {
  const m = TOPO.decodificar(BRINQUEDO);
  const aneis = [];
  let atual = null;
  TOPO.percorrer(m, 0,
    (p) => { atual = [[m.arcoX[p], m.arcoY[p]]]; aneis.push(atual); },
    (p) => { atual.push([m.arcoX[p], m.arcoY[p]]); });
  assert.equal(aneis.length, 1);
  // (10,0) (10,10) (0,10) (0,0) (10,0): cinco vértices, o último fecha
  assert.equal(aneis[0].length, 5);
  assert.deepEqual(aneis[0][0], aneis[0][4]);

  const aneisC = [];
  TOPO.percorrer(m, 2,
    (p) => { aneisC.push([[m.arcoX[p], m.arcoY[p]]]); },
    (p) => { aneisC[aneisC.length - 1].push([m.arcoX[p], m.arcoY[p]]); });
  assert.equal(aneisC.length, 2, "C tem contorno e buraco");
});

test("o arco invertido é percorrido ao contrário", () => {
  const m = TOPO.decodificar(BRINQUEDO);
  const pontos = [];
  TOPO.percorrer(m, 1,
    (p) => pontos.push([m.arcoX[p], m.arcoY[p]]),
    (p) => pontos.push([m.arcoX[p], m.arcoY[p]]));
  // B começa no arco 0 invertido: (10,10) → (10,0)
  assert.deepEqual(pontos[0], [10, 10]);
  assert.deepEqual(pontos[1], [10, 0]);
});

// ------------------------------------------------- dados gerados de verdade

function lerDados(arquivo, variavel) {
  const p = path.join(__dirname, "..", arquivo);
  if (!fs.existsSync(p)) return null;
  const alvo = Object.assign({}, tipados, { console });
  const vm = require("node:vm");
  vm.createContext(alvo);
  vm.runInContext(fs.readFileSync(p, "utf8"), alvo, { filename: arquivo });
  return alvo[variavel];
}

const POP_BRASIL_2022 = 203080756;

test("áreas de ponderação: 14.406 unidades e a população do Censo 2022", () => {
  const ap = lerDados("data/censo_ap.js", "CENSO_AP");
  if (!ap) return; // dados não gerados neste checkout
  assert.equal(ap.pop.length, 14406);
  assert.equal(ap.pop.reduce((s, v) => s + v, 0), POP_BRASIL_2022);
  assert.equal(ap.nome.length, ap.pop.length);
  assert.equal(ap.aream2.length, ap.pop.length);
  assert.equal(ap.mun.length, ap.pop.length);
  assert.ok(ap.pop.every((v) => v >= 0));
  assert.ok(ap.aream2.every((v) => v > 0), "toda área de ponderação tem área");
});

test("áreas de ponderação: a malha decodifica dentro do Brasil", () => {
  const ap = lerDados("data/censo_ap.js", "CENSO_AP");
  if (!ap) return;
  const m = TOPO.decodificar(ap);
  assert.equal(m.n, ap.pop.length);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < m.n; i++) {
    assert.ok(m.minX[i] <= m.maxX[i] && m.minY[i] <= m.maxY[i], `caixa inválida em ${i}`);
    assert.ok(Number.isFinite(m.cx[i]) && Number.isFinite(m.cy[i]), `centroide NaN em ${i}`);
    minX = Math.min(minX, m.minX[i]); maxX = Math.max(maxX, m.maxX[i]);
    minY = Math.min(minY, m.minY[i]); maxY = Math.max(maxY, m.maxY[i]);
  }
  // extremos do território brasileiro, com folga
  assert.ok(minX > -74.5 && maxX < -28, `longitudes ${minX}..${maxX}`);
  assert.ok(minY > -34.5 && maxY < 5.5, `latitudes ${minY}..${maxY}`);
});

test("setores: o índice bate com os arquivos por UF", () => {
  const idx = lerDados("data/censo_setores_indice.js", "CENSO_SETORES_INDICE");
  if (!idx) return;
  assert.equal(idx.ufs.length, 27);
  const soma = idx.ufs.reduce((s, uf) => s + uf.pop, 0);
  // 38 setores perdem a geometria na limpeza topológica (8.116 habitantes)
  assert.ok(POP_BRASIL_2022 - soma >= 0 && POP_BRASIL_2022 - soma < 20000,
    `população dos setores ${soma} vs ${POP_BRASIL_2022}`);
  const total = idx.ufs.reduce((s, uf) => s + uf.n, 0);
  assert.ok(total > 460000 && total <= 468097, `total de setores ${total}`);

  // uma UF inteira, para conferir o formato
  const sp = idx.ufs.find((uf) => uf.uf === "SP");
  const dados = lerDados(sp.arquivo, sp.variavel);
  if (!dados) return;
  assert.equal(dados.pop.length, sp.n);
  assert.equal(dados.pop.reduce((s, v) => s + v, 0), sp.pop);
  assert.equal(dados.locais.length > 1, true, "tem nomes de bairro/distrito");
  assert.equal(TOPO.decodificar(dados).n, sp.n);
});
