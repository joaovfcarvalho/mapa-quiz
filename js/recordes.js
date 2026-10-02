"use strict";
// Recordes pessoais por configuração, guardados no localStorage do navegador.
var RECORDES = (function () {
  var CHAVE_LS = "mapaquiz_recordes_v1";
  // Marcas de "apagado em" por configuração ("*" = limpar tudo). Viajam no
  // backup/sincronização: um recorde de outro aparelho feito antes da marca
  // não volta (a mesclagem é por união — sem a marca, apagar não pegava).
  var CHAVE_ZERADOS = "mapaquiz_recordes_zerados_v1";
  var CHAVE_ZERADOS_BACKUP = "_zerados"; // chave reservada dentro de "recordes" no backup
  // Versão das regras de pontuação. Suba quando uma fórmula de pct mudar:
  // recordes de versões antigas continuam guardados, mas ficam marcados na
  // lista (e uma comparação nova contra eles é avisada como incomparável).
  var VERSAO_REGRAS = 1;
  // versão dos dados (Censo/PIB) — vem do cabeçalho de data/municipios.js
  function versaoDados() {
    var meta = typeof window !== "undefined" && window.MUNICIPIOS_META;
    return meta && meta.versao ? meta.versao : null;
  }

  function carregarTudo() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_LS)) || {};
    } catch (e) {
      return {};
    }
  }

  // Chave que pode virar propriedade de objeto sem mexer no protótipo.
  function chaveSegura(k) {
    return typeof k === "string" && k.length > 0 && k.length <= 300 &&
      k !== "__proto__" && k !== "constructor" && k !== "prototype" &&
      k !== CHAVE_ZERADOS_BACKUP;
  }
  function tem(obj, k) {
    return Object.prototype.hasOwnProperty.call(obj, k);
  }
  function ehDataIso(v) {
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v);
  }

  // Texto pronto para entrar em innerHTML (placar/rótulo vêm de backups e do
  // Drive — não dá para confiar que não tragam marcação).
  function escaparHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Só os campos conhecidos, com os tipos certos; null se não servir.
  function limparRecorde(r) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    if (typeof r.pct !== "number" || !isFinite(r.pct) || r.pct < 0) return null;
    if (typeof r.tempoSeg !== "number" || !isFinite(r.tempoSeg) || r.tempoSeg < 0) return null;
    var out = { pct: r.pct, tempoSeg: r.tempoSeg };
    ["placar", "rotulo", "data", "versaoDados"].forEach(function (c) {
      if (typeof r[c] === "string") out[c] = r[c].slice(0, 500);
    });
    out.jogos = typeof r.jogos === "number" && isFinite(r.jogos) && r.jogos >= 1 ? Math.floor(r.jogos) : 1;
    if (typeof r.versaoRegras === "number" && isFinite(r.versaoRegras)) out.versaoRegras = r.versaoRegras;
    return out;
  }

  // ---- marcas de apagado ----
  function limparZerados(z) {
    var out = {};
    if (!z || typeof z !== "object") return out;
    Object.keys(z).forEach(function (k) {
      if ((k === "*" || chaveSegura(k)) && ehDataIso(z[k])) out[k] = z[k];
    });
    return out;
  }
  function lerZerados() {
    var z;
    try { z = JSON.parse(localStorage.getItem(CHAVE_ZERADOS)); } catch (e) { z = null; }
    return limparZerados(z);
  }
  function gravarZerados(z) {
    try { localStorage.setItem(CHAVE_ZERADOS, JSON.stringify(z)); } catch (e) {}
  }
  // Quando esta configuração foi apagada pela última vez ("" = nunca).
  function zeradoEm(z, chave) {
    var a = tem(z, chave) ? z[chave] : "";
    var b = z["*"] || "";
    return a > b ? a : b;
  }
  // O recorde é de depois do último "apagar"? (sem data: só vale sem marca)
  function sobreviveu(r, z, chave) {
    var marca = zeradoEm(z, chave);
    return !marca || String(r.data || "") > marca;
  }

  // Aviso genérico de "os dados locais mudaram" (a sincronização da conta
  // escuta este evento para agendar o envio do backup).
  function avisarMudanca() {
    try {
      if (typeof document !== "undefined" && document.dispatchEvent) {
        document.dispatchEvent(new CustomEvent("mapaquiz:dados", { detail: { origem: "recordes" } }));
      }
    } catch (e) {}
  }

  function salvarTudo(tudo) {
    try {
      localStorage.setItem(CHAVE_LS, JSON.stringify(tudo));
    } catch (e) {
      /* armazenamento indisponível: o jogo segue sem recordes */
    }
    avisarMudanca();
  }

  // O recorde foi feito com as regras/dados de hoje? (recordes antigos não
  // trazem versão: valem como da versão 1)
  function ehAtual(r) {
    if (!r) return true;
    var regras = r.versaoRegras || 1;
    if (regras !== VERSAO_REGRAS) return false;
    var dados = versaoDados();
    return !dados || !r.versaoDados || r.versaoDados === dados;
  }

  function obter(chave) {
    var tudo = carregarTudo();
    return (tem(tudo, chave) && tudo[chave]) || null;
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
    // um recorde de regras/dados antigos não é comparável: o resultado novo
    // o substitui (e a interface avisa que a marca anterior era de outra versão)
    var incomparavel = !!atual && !ehAtual(atual);
    if (incomparavel) melhor = true;
    if (melhor) {
      tudo[chave] = {
        pct: resultado.pct,
        placar: resultado.placar,
        rotulo: resultado.rotulo,
        tempoSeg: resultado.tempoSeg,
        data: resultado.data,
        jogos: jogos,
        versaoRegras: VERSAO_REGRAS,
        versaoDados: versaoDados() || undefined,
      };
    } else {
      atual.jogos = jogos;
    }
    salvarTudo(tudo);
    return { melhor: melhor, recorde: tudo[chave], incomparavel: incomparavel };
  }

  function listar() {
    var tudo = carregarTudo();
    return Object.keys(tudo)
      .filter(function (chave) {
        return chaveSegura(chave) && tudo[chave] && typeof tudo[chave] === "object";
      })
      .map(function (chave) {
        return { chave: chave, recorde: tudo[chave] };
      })
      .sort(function (a, b) {
        return String(b.recorde.data || "").localeCompare(String(a.recorde.data || ""));
      });
  }

  function apagar(chave) {
    var tudo = carregarTudo();
    delete tudo[chave];
    if (chaveSegura(chave)) {
      var z = lerZerados();
      z[chave] = new Date().toISOString();
      gravarZerados(z);
    }
    salvarTudo(tudo);
  }

  function limparTudo() {
    // a marca geral cobre (e substitui) as marcas por configuração
    gravarZerados({ "*": new Date().toISOString() });
    salvarTudo({});
  }

  function exportarJson() {
    var recs = carregarTudo();
    var z = lerZerados();
    if (Object.keys(z).length) {
      recs = Object.assign({}, recs);
      recs[CHAVE_ZERADOS_BACKUP] = z; // versões antigas ignoram (não tem pct)
    }
    return JSON.stringify({
      formato: "mapaquiz-recordes",
      versao: 1,
      exportadoEm: new Date().toISOString(),
      recordes: recs,
    }, null, 2);
  }

  // Mescla um backup exportado: entra o que for configuração nova ou recorde
  // melhor que o local (mesmo critério do registrar). Um recorde das regras/
  // dados atuais nunca é trocado por um de versão antiga — e o contrário
  // sempre acontece. Apagados: vale a marca mais recente dos dois lados; um
  // recorde feito antes dela some daqui e não entra de lá.
  function importarJson(texto) {
    var obj;
    try {
      obj = JSON.parse(texto);
    } catch (e) {
      return { ok: false, msg: "Arquivo inválido: não é um JSON." };
    }
    var recs = obj && obj.recordes;
    if (!recs || typeof recs !== "object" || Array.isArray(recs)) {
      return { ok: false, msg: "Arquivo não parece um backup de recordes deste jogo." };
    }
    var tudo = carregarTudo();
    var novos = 0;
    var melhorados = 0;
    var apagados = 0;
    var z = lerZerados();
    var zDeles = limparZerados(tem(recs, CHAVE_ZERADOS_BACKUP) ? recs[CHAVE_ZERADOS_BACKUP] : null);
    var mudouZ = false;
    Object.keys(zDeles).forEach(function (k) {
      if (zDeles[k] > (tem(z, k) ? z[k] : "")) { z[k] = zDeles[k]; mudouZ = true; }
    });
    if (mudouZ) {
      gravarZerados(z);
      Object.keys(tudo).forEach(function (chave) {
        if (!sobreviveu(tudo[chave] || {}, z, chave)) { delete tudo[chave]; apagados++; }
      });
    }
    Object.keys(recs).forEach(function (chave) {
      if (!chaveSegura(chave)) return;
      var r = limparRecorde(recs[chave]);
      if (!r || !sobreviveu(r, z, chave)) return;
      var atual = tem(tudo, chave) ? tudo[chave] : null;
      if (!atual) {
        tudo[chave] = r;
        novos++;
        return;
      }
      var atualVale = ehAtual(atual);
      var delesVale = ehAtual(r);
      var melhor = atualVale !== delesVale ? delesVale
        : r.pct > atual.pct + 1e-9 ||
          (Math.abs(r.pct - atual.pct) <= 1e-9 && r.tempoSeg < atual.tempoSeg);
      if (melhor) {
        r.jogos = Math.max(r.jogos || 1, atual.jogos || 1);
        tudo[chave] = r;
        melhorados++;
      }
    });
    salvarTudo(tudo);
    return {
      ok: true,
      msg: "Backup importado: " + novos + " configuração(ões) nova(s), " +
        melhorados + " recorde(s) melhorado(s)" +
        (apagados ? ", " + apagados + " recorde(s) apagado(s) em outro aparelho" : "") + ".",
    };
  }

  return {
    VERSAO_REGRAS: VERSAO_REGRAS,
    versaoDados: versaoDados,
    ehAtual: ehAtual,
    obter: obter,
    registrar: registrar,
    listar: listar,
    apagar: apagar,
    limparTudo: limparTudo,
    exportarJson: exportarJson,
    importarJson: importarJson,
    escaparHtml: escaparHtml,
  };
})();
