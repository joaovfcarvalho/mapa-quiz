"use strict";
// Nomes das regiões administrativas do Rio. A base da Prefeitura traz o campo
// em maiúsculas, sem acento e com espaços sobrando ("MEIER        "); aqui ele
// vira o nome como se escreve. As 33 RAs têm grafia fixa; qualquer outra que
// apareça numa base futura cai na regra geral de maiúsculas.
var BAIRROS_RA = (function () {
  var NOMES = [
    "Portuária", "Centro", "Rio Comprido", "Botafogo", "Copacabana", "Lagoa",
    "São Cristóvão", "Tijuca", "Vila Isabel", "Ramos", "Penha", "Inhaúma",
    "Méier", "Irajá", "Madureira", "Jacarepaguá", "Bangu", "Campo Grande",
    "Santa Cruz", "Ilha do Governador", "Paquetá", "Anchieta", "Santa Teresa",
    "Barra da Tijuca", "Pavuna", "Guaratiba", "Rocinha", "Jacarezinho",
    "Complexo do Alemão", "Complexo da Maré", "Vigário Geral", "Realengo",
    "Cidade de Deus",
  ];
  var MINUSCULAS = { da: 1, das: 1, de: 1, do: 1, dos: 1, e: 1 };

  function chave(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toUpperCase().replace(/\s+/g, " ").trim();
  }
  var porChave = Object.create(null);
  NOMES.forEach(function (n) { porChave[chave(n)] = n; });
  porChave["SANTA TEREZA"] = "Santa Teresa";   // grafia antiga, como vem na base
  porChave["ILHA DE PAQUETA"] = "Paquetá";

  function formatar(ra) {
    if (ra == null) return "";
    var k = chave(ra);
    if (!k) return "";
    if (porChave[k]) return porChave[k];
    return String(ra).replace(/\s+/g, " ").trim().toLowerCase()
      .split(" ").map(function (p, i) {
        return i && MINUSCULAS[p] ? p : p.charAt(0).toUpperCase() + p.slice(1);
      }).join(" ");
  }

  return { formatar: formatar, NOMES: NOMES };
})();
if (typeof module !== "undefined") module.exports = BAIRROS_RA;
