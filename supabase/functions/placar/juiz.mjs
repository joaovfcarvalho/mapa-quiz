// Juiz do placar geral: refaz uma partida a partir do diário de eventos com
// o MESMO motor do jogo (js/modos.js, js/dados.js, js/geo.js, js/rios_motor.js
// e os dados), que a Edge Function baixa do próprio site — assim a regra que
// vale no navegador é exatamente a que vale aqui, sem cópia para envelhecer.
//
// Módulo sem dependência de Deno/Node: recebe uma função que lê os arquivos
// (por URL no servidor, do disco nos testes) e devolve o motor montado.

export const ARQUIVOS_MUNICIPIOS = [
  "data/municipios.js", "data/vizinhos.js", "js/geo.js", "js/dados.js", "js/modos.js",
];
export const ARQUIVOS_RIOS = ["data/rios.js", "js/rios_motor.js"];

export const MAX_EVENTOS = 8000;
export const MAX_TEXTO = 80;
const FOLGA_TEMPO_SEG = 60;   // além do limite da partida (latência, relógio do cliente)
const MIN_SEG_POR_ACAO = 0.5; // ninguém digita/clica mais rápido que isso por muito tempo

export function ehRios(chave) {
  return String(chave || "").indexOf("rios|") === 0;
}

// Monta o motor a partir dos arquivos do site. Os scripts são "clássicos"
// (declaram globais com var), então entram concatenados numa função só:
// cada var vira local dela e o objeto devolvido expõe o que o juiz usa.
export async function carregarMotor(lerTexto, rios) {
  const arquivos = rios ? ARQUIVOS_RIOS : ARQUIVOS_MUNICIPIOS;
  const partes = await Promise.all(arquivos.map((a) => lerTexto(a)));
  const fim = rios
    ? "\n;return { RIOS_MOTOR: RIOS_MOTOR };"
    : "\n;var window = { VIZINHOS: VIZINHOS };\n;return { DADOS: DADOS, GEO: GEO, MODOS: MODOS };";
  return new Function(partes.join("\n;\n") + fim)();
}

// Valida a chave e devolve {modo, cfg, chave} ou {erro}.
export function interpretarChave(motor, chave) {
  if (typeof chave !== "string" || chave.length > 200) return { erro: "chave" };
  if (ehRios(chave)) {
    const r = motor.RIOS_MOTOR.configDeChave(chave);
    return r.erro ? r : { modo: "rios", cfg: r.cfg, chave: r.chave };
  }
  return motor.MODOS.configDeChave(chave);
}

// Sanitiza o diário vindo do cliente. Devolve a lista limpa ou null.
export function limparEventos(eventos) {
  if (!Array.isArray(eventos) || eventos.length > MAX_EVENTOS) return null;
  const limpos = [];
  for (const e of eventos) {
    if (!Array.isArray(e)) return null;
    if (e[0] === "p") {
      if (typeof e[1] !== "string" || e[1].length > MAX_TEXTO) return null;
      limpos.push(["p", e[1]]);
    } else if (e[0] === "d") {
      limpos.push(["d"]);
    } else if (e[0] === "c") {
      const lat = Number(e[1]), lng = Number(e[2]);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      limpos.push(["c", lat, lng]);
    } else {
      return null;
    }
  }
  return limpos;
}

// Refaz a partida. `decorridoSeg` é o tempo medido pelo servidor entre o
// início e o envio do diário. Devolve {ok, pct, tempo_seg, modo, acoes} ou
// {ok:false, erro}.
export function julgar(motor, chave, semente, eventos, decorridoSeg) {
  const lida = interpretarChave(motor, chave);
  if (lida.erro) return { ok: false, erro: "chave" };
  const evs = limparEventos(eventos);
  if (!evs) return { ok: false, erro: "replay" };

  const acoes = evs.filter((e) => e[0] !== "d").length;
  const limiteSeg = lida.cfg.tempoMin ? lida.cfg.tempoMin * 60 : null;
  if (!(decorridoSeg >= 0)) return { ok: false, erro: "tempo" };
  if (limiteSeg !== null && decorridoSeg > limiteSeg + FOLGA_TEMPO_SEG) return { ok: false, erro: "tempo" };
  if (acoes * MIN_SEG_POR_ACAO > decorridoSeg + 1) return { ok: false, erro: "ritmo" };

  let pct;
  try {
    pct = lida.modo === "rios"
      ? refazerRios(motor, lida.cfg, evs)
      : refazerMunicipios(motor, lida.modo, lida.cfg, semente, evs);
  } catch (e) {
    return { ok: false, erro: "replay" };
  }
  if (!(pct >= 0 && pct <= 1)) return { ok: false, erro: "replay" };

  let tempo = Math.floor(decorridoSeg);
  if (limiteSeg !== null && tempo > limiteSeg) tempo = limiteSeg;
  return { ok: true, pct: pct, tempo_seg: tempo, modo: lida.modo, acoes: acoes };
}

// Mesmas regras de js/app.js: os motores fazem a própria busca, exceto os de
// círculos (que recebem a lista de municípios já resolvida, com a regra de
// homônimos), e as dicas descontam do resultado em faixas/topn/cerco/mancha.
function refazerMunicipios(motor, modo, cfg, semente, evs) {
  const { DADOS, MODOS } = motor;
  const cfgJogo = Object.assign({}, cfg, { rng: MODOS.geradorAleatorio(semente) });
  const jogo = MODOS.criarJogo(modo, cfgJogo);
  if (!jogo || jogo.erroInicial) throw new Error("motor");
  let dicas = 0; // desconto no fim (faixas/topn/cerco/mancha)
  const circulos = modo === "dist" || modo === "pop";
  const descontaDica = modo === "faixas" || modo === "topn" || modo === "cerco" || modo === "mancha";
  const limiteDicas = modo === "faixas" || modo === "topn" || modo === "cerco";

  for (const e of evs) {
    if (jogo.encerrado) break;
    if (e[0] === "p") {
      if (modo === "clique") continue;
      if (circulos) {
        const res = DADOS.buscar(e[1]);
        if (res.status !== "ok" && res.status !== "ambiguo") continue;
        let muns = res.municipios;
        if (cfg.uf) muns = muns.filter((m) => m.uf === cfg.uf);
        if (muns.length === 0) continue;
        if (muns.length > 1 && !cfg.homonimos) continue;
        jogo.palpitar(muns);
      } else {
        jogo.palpitar(e[1]);
      }
    } else if (e[0] === "c") {
      if (modo !== "clique") continue;
      jogo.responder(e[1], e[2]);
    } else if (e[0] === "d") {
      if (typeof jogo.dica !== "function") continue;
      if (limiteDicas && dicas >= 3) continue;
      const d = jogo.dica();
      if (d && descontaDica) dicas++;
    }
  }

  if (modo === "faixas" || modo === "topn" || modo === "cerco") {
    return Math.max(0, (jogo.achadosTotal - dicas) / jogo.alvosTotal);
  }
  if (modo === "mancha") {
    return Math.max(0, (jogo.mancha.size - dicas) / jogo.alvosTotal);
  }
  return jogo.pct();
}

function refazerRios(motor, cfg, evs) {
  const { RIOS_MOTOR } = motor;
  const m = RIOS_MOTOR.montarAlvos(cfg.conjunto);
  let kmTotal = 0;
  m.alvos.forEach((a) => { kmTotal += a.km; });
  let kmFeito = 0;
  let achados = 0;
  for (const e of evs) {
    if (e[0] !== "p") continue;
    if (achados >= m.alvos.length) break;
    const lista = RIOS_MOTOR.buscar(m.indice, e[1]);
    for (const alvo of lista) {
      if (alvo.achado) continue;
      alvo.achado = true;
      achados++;
      kmFeito += alvo.km;
    }
  }
  return kmTotal ? kmFeito / kmTotal : 0;
}
