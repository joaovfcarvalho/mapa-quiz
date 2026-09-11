"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./_carregar.cjs");

const ctx = carregar(["js/geo.js"]);
const GEO = ctx.GEO;

test("haversine: São Paulo → Rio de Janeiro ≈ 357 km", () => {
  const d = GEO.haversineKm(-23.5329, -46.6395, -22.9129, -43.2003);
  assert.ok(d > 350 && d < 365, `distância ${d}`);
});

test("haversine: mesmo ponto = 0", () => {
  assert.equal(GEO.haversineKm(-10, -50, -10, -50), 0);
});

test("rumo: norte = 0°, leste = 90°", () => {
  assert.ok(Math.abs(GEO.rumo(-10, -50, -9, -50)) < 0.01);
  assert.ok(Math.abs(GEO.rumo(-10, -50, -10, -49) - 90) < 0.5);
});

test("destino inverte a distância e o rumo", () => {
  const [lat, lng] = GEO.destino(-15.78, -47.93, 45, 300);
  const d = GEO.haversineKm(-15.78, -47.93, lat, lng);
  assert.ok(Math.abs(d - 300) < 0.01, `voltou ${d}`);
  assert.ok(Math.abs(GEO.rumo(-15.78, -47.93, lat, lng) - 45) < 0.5);
});

test("círculo geodésico: todos os pontos à mesma distância do centro", () => {
  const pts = GEO.circuloGeodesico(-20, -45, 150, 24);
  assert.equal(pts.length, 24);
  pts.forEach(([lat, lng]) => {
    assert.ok(Math.abs(GEO.haversineKm(-20, -45, lat, lng) - 150) < 0.01);
  });
});

test("projeção: inversas devolvem as coordenadas", () => {
  const proj = GEO.criarProjecao({ latMin: -34, latMax: 6, lngMin: -74, lngMax: -34 }, 1000);
  assert.ok(Math.abs(proj.lngDe(proj.x(-46.6)) - -46.6) < 1e-9);
  assert.ok(Math.abs(proj.latDe(proj.y(-23.5)) - -23.5) < 1e-9);
});
