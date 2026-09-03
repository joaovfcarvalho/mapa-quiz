// Edge Function `placar` — o juiz do placar geral do Mapa Quiz.
//
//   POST {acao:"iniciar",   chave}                      → {ok, partida, semente}
//   POST {acao:"encerrar",  partida, eventos, placar}   → {ok, pct, placar, tempo_seg}
//   POST {acao:"registrar", partida, nome, passe}       → {ok, melhorou, posicao, total, …}
//
// A interface nunca manda uma pontuação: manda o diário do que o jogador fez
// e este código refaz a partida com o motor do próprio site (ver juiz.mjs),
// medindo o tempo pelo relógio do servidor. Só a nota daqui entra no placar.
//
// Publicar: `supabase functions deploy placar --no-verify-jwt` (ou pelo
// painel). Variáveis: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm do
// Supabase; MAPAQUIZ_SITE (opcional) aponta para onde baixar o motor.
import { createClient } from "npm:@supabase/supabase-js@2";
import { carregarMotor, ehRios, interpretarChave, julgar, MAX_EVENTOS } from "./juiz.mjs";

const SITE = (Deno.env.get("MAPAQUIZ_SITE") || "https://mapaquiz.com.br").replace(/\/+$/, "");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// O motor (código + dados do site) fica em memória enquanto a instância
// viver; municípios e rios são carregados separadamente, sob demanda.
// deno-lint-ignore no-explicit-any
const motores: Record<string, Promise<any>> = {};
async function lerDoSite(caminho: string): Promise<string> {
  const r = await fetch(`${SITE}/${caminho}`);
  if (!r.ok) throw new Error(`não consegui baixar ${caminho}: HTTP ${r.status}`);
  return await r.text();
}
function motor(rios: boolean) {
  const k = rios ? "rios" : "municipios";
  if (!motores[k]) {
    motores[k] = carregarMotor(lerDoSite, rios).catch((e) => {
      delete motores[k];
      throw e;
    });
  }
  return motores[k];
}

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
async function iniciar(corpo: any) {
  const chave = corpo.chave;
  if (typeof chave !== "string" || chave.length > 200) return { ok: false, erro: "chave" };
  const m = await motor(ehRios(chave));
  const lida = interpretarChave(m, chave);
  if (lida.erro) return { ok: false, erro: "chave" };
  const semente = crypto.getRandomValues(new Uint32Array(1))[0];
  const { data, error } = await db
    .from("partidas")
    .insert({ chave: lida.chave, semente })
    .select("id")
    .single();
  if (error) throw error;
  // limpeza ocasional: partidas nunca registradas somem depois de 2 dias
  if (Math.random() < 0.02) {
    const corte = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    await db.from("partidas").delete().eq("registrada", false).lt("iniciada_em", corte);
  }
  return { ok: true, partida: data.id, semente };
}

// deno-lint-ignore no-explicit-any
async function encerrar(corpo: any) {
  if (typeof corpo.partida !== "string" || !RE_UUID.test(corpo.partida)) return { ok: false, erro: "partida" };
  if (!Array.isArray(corpo.eventos) || corpo.eventos.length > MAX_EVENTOS) return { ok: false, erro: "replay" };
  const { data: p, error } = await db
    .from("partidas")
    .select("id, chave, semente, iniciada_em, encerrada_em")
    .eq("id", corpo.partida)
    .maybeSingle();
  if (error) throw error;
  if (!p) return { ok: false, erro: "partida" };
  if (p.encerrada_em) return { ok: false, erro: "ja_encerrada" };

  const agora = Date.now();
  const decorrido = (agora - Date.parse(p.iniciada_em)) / 1000;
  const m = await motor(ehRios(p.chave));
  const julg = julgar(m, p.chave, Number(p.semente), corpo.eventos, decorrido);
  if (!julg.ok) return julg;

  const placar = String(corpo.placar || "").replace(/[<>]/g, "").slice(0, 80);
  const { data: atual, error: erroUpd } = await db
    .from("partidas")
    .update({
      encerrada_em: new Date(agora).toISOString(),
      pct: julg.pct,
      tempo_seg: julg.tempo_seg,
      placar,
      eventos: corpo.eventos,
    })
    .eq("id", p.id)
    .is("encerrada_em", null)
    .select("id");
  if (erroUpd) throw erroUpd;
  if (!atual || atual.length === 0) return { ok: false, erro: "ja_encerrada" };
  return { ok: true, pct: julg.pct, placar, tempo_seg: julg.tempo_seg };
}

// deno-lint-ignore no-explicit-any
async function registrar(corpo: any) {
  if (typeof corpo.partida !== "string" || !RE_UUID.test(corpo.partida)) return { ok: false, erro: "partida" };
  if (typeof corpo.passe !== "string" || !RE_UUID.test(corpo.passe)) return { ok: false, erro: "dados" };
  if (typeof corpo.nome !== "string" || corpo.nome.length > 40) return { ok: false, erro: "nome" };
  const { data: p, error } = await db
    .from("partidas")
    .select("id, chave, encerrada_em, pct, placar, tempo_seg, registrada")
    .eq("id", corpo.partida)
    .maybeSingle();
  if (error) throw error;
  if (!p || !p.encerrada_em) return { ok: false, erro: "partida" };
  if (p.registrada) return { ok: false, erro: "ja_registrada" };

  const { data: r, error: erroRpc } = await db.rpc("registrar_placar", {
    p_chave: p.chave,
    p_nome: corpo.nome,
    p_pct: p.pct,
    p_placar: p.placar,
    p_tempo_seg: p.tempo_seg,
    p_passe: corpo.passe,
  });
  if (erroRpc) throw erroRpc;
  if (r && r.ok) {
    await db.from("partidas").update({ registrada: true, nome: corpo.nome }).eq("id", p.id);
  }
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta({ ok: false, erro: "metodo" }, 405);
  // deno-lint-ignore no-explicit-any
  let corpo: any;
  try {
    corpo = await req.json();
  } catch {
    return resposta({ ok: false, erro: "json" }, 400);
  }
  try {
    if (corpo.acao === "iniciar") return resposta(await iniciar(corpo));
    if (corpo.acao === "encerrar") return resposta(await encerrar(corpo));
    if (corpo.acao === "registrar") return resposta(await registrar(corpo));
    return resposta({ ok: false, erro: "acao" }, 400);
  } catch (e) {
    console.error(e);
    return resposta({ ok: false, erro: "servidor" }, 500);
  }
});
