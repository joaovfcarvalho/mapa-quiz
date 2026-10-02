"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./_carregar.cjs");

const ctx = carregar(["data/municipios.js", "js/geo.js", "js/dados.js"]);
const DADOS = ctx.DADOS;
const muns = DADOS.municipios;

// Invariantes dos dados de que os motores dependem em silêncio.
test("5.571 municípios com ids únicos", () => {
  assert.equal(muns.length, 5571);
  assert.equal(ctx.MUNICIPIOS_META.municipios, 5571);
  assert.equal(new Set(muns.map((m) => m.id)).size, 5571);
});

test("ordenados por população decrescente", () => {
  for (let i = 1; i < muns.length; i++) {
    assert.ok(muns[i - 1].pop >= muns[i].pop, `posição ${i}`);
  }
});

test("só Boa Esperança do Norte (MT) sem população, área e PIB", () => {
  const zero = muns.filter((m) => m.pop === 0 || m.area === 0);
  assert.equal(zero.length, 1);
  assert.equal(zero[0].nome, "Boa Esperança do Norte");
  assert.equal(zero[0].uf, "MT");
});

test("27 UFs, 27 capitais, coordenadas dentro do Brasil", () => {
  assert.equal(new Set(muns.map((m) => m.uf)).size, 27);
  assert.equal(muns.filter((m) => m.capital).length, 27);
  muns.forEach((m) => {
    assert.ok(m.lat > -34 && m.lat < 6 && m.lng > -74.5 && m.lng < -32, m.nome); // Fernando de Noronha fica a 32°O
  });
});

test("versão dos dados presente", () => {
  assert.equal(typeof ctx.MUNICIPIOS_META.versao, "string");
});

// Normalização e busca dos palpites digitados.
test("buscar: acento, maiúscula e espaço não importam", () => {
  assert.equal(DADOS.buscar("SÃO PAULO").municipios[0].id, 3550308);
  assert.equal(DADOS.buscar("riodejaneiro").status, "ok");
  assert.equal(DADOS.buscar("sao jose dos campos").municipios[0].uf, "SP");
});

test("buscar: homônimos são ambíguos e a UF resolve", () => {
  const r = DADOS.buscar("bom jesus");
  assert.equal(r.status, "ambiguo");
  assert.ok(r.municipios.length > 1);
  assert.equal(DADOS.buscar("Bom Jesus, RS").status, "ok");
  assert.equal(DADOS.buscar("bom jesus rs").municipios[0].uf, "RS");
  const errada = DADOS.buscar("campinas rj");
  assert.equal(errada.status, "nao_encontrado");
  assert.equal(errada.ufErrada, true);
});

function umMunicipio(t) {
  const r = DADOS.buscar(t);
  assert.equal(r.status, "ok", t);
  return r.municipios[0].nome + "/" + r.municipios[0].uf;
}

test("buscar: sufixo de UF vale antes do nome sem espaços", () => {
  assert.equal(umMunicipio("Aracatu, BA"), "Aracatu/BA");
  assert.equal(umMunicipio("aracatu ba"), "Aracatu/BA");
  assert.equal(umMunicipio("Itagi, BA"), "Itagi/BA");
  // sem UF, o índice sem espaços continua valendo
  assert.equal(umMunicipio("aracatuba"), "Araçatuba/SP");
  assert.equal(umMunicipio("itagiba"), "Itagibá/BA");
});

test("buscar: com UF, junta os índices com e sem espaços", () => {
  assert.equal(umMunicipio("santa luz ba"), "Santaluz/BA");
  assert.equal(umMunicipio("santa luz pi"), "Santa Luz/PI");
  assert.equal(umMunicipio("montenegro ro"), "Monte Negro/RO");
  assert.equal(umMunicipio("monte negro rs"), "Montenegro/RS");
  assert.equal(umMunicipio("montenegro rs"), "Montenegro/RS");
  assert.equal(umMunicipio("Sento Sé"), "Sento Sé/BA");
  assert.equal(DADOS.buscar("santa luz sp").ufErrada, true);
});

test("buscar: vazio e desconhecido", () => {
  assert.equal(DADOS.buscar("   ").status, "vazio");
  assert.equal(DADOS.buscar("cidade que nao existe").status, "nao_encontrado");
});
