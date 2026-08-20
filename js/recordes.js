"use strict";
// Recordes pessoais por configuração, guardados no localStorage do navegador.
var RECORDES = (function () {
  var CHAVE_LS = "mapaquiz_recordes_v1";

  function carregarTudo() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_LS)) || {};
    } catch (e) {
      return {};
    }
  }

  function salvarTudo(tudo) {
    try {
      localStorage.setItem(CHAVE_LS, JSON.stringify(tudo));
    } catch (e) {
      /* armazenamento indisponível: o jogo segue sem recordes */
    }
  }

  function obter(chave) {
    return carregarTudo()[chave] || null;
  }

  // resultado: {pct, placar, rotulo, tempoSeg, data}
  // Melhor = maior %; empate no % → menor tempo.
  function registrar(chave, resultado) {
    var tudo = carregarTudo();
    var atual = tudo[chave];
    var melhor =
      !atual ||
      resultado.pct > atual.pct + 1e-9 ||
      (Math.abs(resultado.pct - atual.pct) <= 1e-9 && resultado.tempoSeg < atual.tempoSeg);
    var jogos = (atual ? atual.jogos || 0 : 0) + 1;
    if (melhor) {
      tudo[chave] = {
        pct: resultado.pct,
        placar: resultado.placar,
        rotulo: resultado.rotulo,
        tempoSeg: resultado.tempoSeg,
        data: resultado.data,
        jogos: jogos,
      };
    } else {
      atual.jogos = jogos;
    }
    salvarTudo(tudo);
    return { melhor: melhor, recorde: tudo[chave] };
  }

  function listar() {
    var tudo = carregarTudo();
    return Object.keys(tudo)
      .map(function (chave) {
        return { chave: chave, recorde: tudo[chave] };
      })
      .sort(function (a, b) {
        return (b.recorde.data || "").localeCompare(a.recorde.data || "");
      });
  }

  function apagar(chave) {
    var tudo = carregarTudo();
    delete tudo[chave];
    salvarTudo(tudo);
  }

  function limparTudo() {
    salvarTudo({});
  }

  return {
    obter: obter,
    registrar: registrar,
    listar: listar,
    apagar: apagar,
    limparTudo: limparTudo,
  };
})();
