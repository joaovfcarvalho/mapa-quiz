"use strict";
// Indexação dos municípios e interpretação dos palpites digitados.
var DADOS = (function () {
  function normalizar(s) {
    return String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’´`]/g, "")
      .replace(/-/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  var municipios = MUNICIPIOS.map(function (m, i) {
    return {
      idx: i,
      id: m[0],
      nome: m[1],
      uf: m[2],
      lat: m[3],
      lng: m[4],
      pop: m[5],
      capital: m[6] === 1,
      area: m[7], // km² (IBGE 2022)
      chave: normalizar(m[1]),
    };
  });

  var porChave = new Map();
  municipios.forEach(function (m) {
    var lista = porChave.get(m.chave);
    if (!lista) porChave.set(m.chave, (lista = []));
    lista.push(m);
  });

  // índice sem espaços, para aceitar "riodejaneiro" como "rio de janeiro"
  var porChaveJunta = new Map();
  porChave.forEach(function (lista, chave) {
    var junta = chave.replace(/ /g, "");
    var acum = porChaveJunta.get(junta);
    if (!acum) porChaveJunta.set(junta, (acum = []));
    lista.forEach(function (m) { acum.push(m); });
  });

  var siglasUF = new Set(municipios.map(function (m) { return m.uf.toLowerCase(); }));
  var popTotal = municipios.reduce(function (s, m) { return s + m.pop; }, 0);

  // Interpreta o texto digitado. Aceita "nome", "nome, uf" e "nome uf";
  // espaços são opcionais ("riodejaneiro" vale por "rio de janeiro").
  // Retorna {status: 'vazio'|'nao_encontrado'|'ok'|'ambiguo', municipios, texto}
  function buscar(texto) {
    var t = normalizar(texto);
    if (!t) return { status: "vazio", municipios: [] };

    // 1) o texto inteiro é um nome de município conhecido
    var exato = porChave.get(t) || porChaveJunta.get(t.replace(/ /g, ""));
    if (exato) {
      return exato.length === 1
        ? { status: "ok", municipios: exato }
        : { status: "ambiguo", municipios: exato };
    }

    // 2) o texto termina com uma sigla de UF ("campinas sp" / "bom jesus, pi")
    var partes = t.split(" ");
    if (partes.length >= 2) {
      var sigla = partes[partes.length - 1];
      if (sigla.length === 2 && siglasUF.has(sigla)) {
        var nome = partes.slice(0, -1).join(" ");
        var lista = porChave.get(nome) || porChaveJunta.get(nome.replace(/ /g, "")) || [];
        var candidatos = lista.filter(function (m) {
          return m.uf.toLowerCase() === sigla;
        });
        if (candidatos.length >= 1) {
          return { status: "ok", municipios: [candidatos[0]] };
        }
        if (lista.length > 0) {
          return { status: "nao_encontrado", municipios: [], ufErrada: true };
        }
      }
    }

    return { status: "nao_encontrado", municipios: [] };
  }

  return {
    municipios: municipios,
    porChave: porChave,
    popTotal: popTotal,
    total: municipios.length,
    normalizar: normalizar,
    buscar: buscar,
  };
})();
