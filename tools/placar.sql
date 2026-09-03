-- Placar geral do Mapa Quiz — esquema para o Supabase (Postgres + PostgREST).
--
-- Cole este arquivo inteiro no SQL Editor do projeto (Dashboard → SQL Editor →
-- New query → Run). Rodar de novo é seguro (tudo é "if not exists"/"or replace").
-- Depois publique a Edge Function `placar` (supabase/functions/placar) e copie
-- a URL do projeto e a chave pública (Settings → API) para `placar` em
-- js/config.js.
--
-- Modelo:
--   partidas — uma linha por partida iniciada. A Edge Function cria a linha
--              ao começar o jogo (com a semente dos sorteios), refaz a partida
--              pelo diário de eventos ao fim e grava a nota DELA (pct, tempo).
--   placar   — uma linha por (configuração, apelido) com o melhor resultado.
--              Só a Edge Function escreve (via registrar_placar, com a chave
--              de serviço); a chave pública (anon) só LÊ as colunas públicas.
-- Não há login: cada navegador gera um "passe" (UUID) que acompanha o apelido
-- — só quem tem o passe atualiza a linha daquele apelido.

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------- partidas
create table if not exists public.partidas (
  id            uuid        primary key default gen_random_uuid(),
  chave         text        not null,
  semente       bigint      not null,            -- semente dos sorteios (0..2^32-1)
  iniciada_em   timestamptz not null default now(),
  encerrada_em  timestamptz,                     -- preenchida quando o diário foi conferido
  pct           double precision check (pct >= 0 and pct <= 1),
  placar        text,                            -- texto curto do resultado (só exibição)
  tempo_seg     integer     check (tempo_seg >= 0),
  eventos       jsonb,                           -- diário conferido (auditoria/moderação)
  registrada    boolean     not null default false,
  nome          text                             -- apelido com que foi registrada
);
create index if not exists partidas_limpeza_idx on public.partidas (registrada, iniciada_em);

-- ninguém além do serviço (Edge Function) toca nas partidas
alter table public.partidas enable row level security;
revoke all on table public.partidas from anon, authenticated;
grant all on table public.partidas to service_role;

-- ------------------------------------------------------------------ placar
create table if not exists public.placar (
  id            bigint generated always as identity primary key,
  chave         text        not null,            -- ex.: "topn|n=100|tempo=10|uf=SP"
  nome          text        not null,            -- apelido como foi digitado
  nome_norm     text        not null,            -- apelido normalizado (minúsculo, sem acento)
  pct           double precision not null check (pct >= 0 and pct <= 1),
  placar        text,                            -- texto curto do resultado ("87/100 cidades")
  tempo_seg     integer     not null check (tempo_seg >= 0 and tempo_seg <= 10000000),
  passe         uuid        not null,            -- nunca exposto pela API
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (chave, nome_norm)
);

create index if not exists placar_ranking_idx
  on public.placar (chave, pct desc, tempo_seg asc, atualizado_em asc);
create index if not exists placar_passe_idx
  on public.placar (passe, atualizado_em desc);

-- Leitura pública das colunas públicas; nenhuma escrita direta.
alter table public.placar enable row level security;
revoke all on table public.placar from anon, authenticated;
grant all on table public.placar to service_role;
grant select (chave, nome, pct, placar, tempo_seg, atualizado_em)
  on table public.placar to anon, authenticated;
drop policy if exists "placar: leitura publica" on public.placar;
create policy "placar: leitura publica"
  on public.placar for select to anon, authenticated using (true);

-- Registra (ou melhora) o resultado de um apelido numa configuração. Chamada
-- só pela Edge Function (chave de serviço), depois de conferir a partida.
-- Devolve {ok, melhorou, posicao, total, pct, tempo_seg} ou {ok:false, erro}.
create or replace function public.registrar_placar(
  p_chave     text,
  p_nome      text,
  p_pct       double precision,
  p_placar    text,
  p_tempo_seg integer,
  p_passe     uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nome     text;
  v_norm     text;
  v_atual    public.placar%rowtype;
  v_melhorou boolean := false;
  v_pct      double precision;
  v_tempo    integer;
  v_posicao  integer;
  v_total    integer;
  v_recentes integer;
begin
  -- configuração: "modo|param=valor|param=valor" (mesmo formato das chaves
  -- de recorde do jogo)
  if p_chave is null or length(p_chave) > 200
     or p_chave !~ '^[a-z]+(\|[a-z]+=[^|]{1,40}){0,12}$' then
    return jsonb_build_object('ok', false, 'erro', 'chave');
  end if;

  -- apelido: 2 a 20 caracteres, letras/números/espaço/ponto/hífen/sublinhado
  v_nome := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  if length(v_nome) < 2 or length(v_nome) > 20
     or v_nome !~ '^[[:alnum:] _.-]+$' then
    return jsonb_build_object('ok', false, 'erro', 'nome');
  end if;
  v_norm := lower(extensions.unaccent(v_nome));

  if p_pct is null or p_pct < 0 or p_pct > 1
     or p_tempo_seg is null or p_tempo_seg < 0 or p_tempo_seg > 10000000
     or p_passe is null then
    return jsonb_build_object('ok', false, 'erro', 'dados');
  end if;

  -- freio simples: no máximo 20 escritas por passe por minuto
  select count(*) into v_recentes
    from public.placar
   where passe = p_passe and atualizado_em > now() - interval '1 minute';
  if v_recentes >= 20 then
    return jsonb_build_object('ok', false, 'erro', 'limite');
  end if;

  select * into v_atual
    from public.placar
   where chave = p_chave and nome_norm = v_norm
   for update;

  if found then
    if v_atual.passe <> p_passe then
      return jsonb_build_object('ok', false, 'erro', 'nome_em_uso');
    end if;
    v_melhorou := p_pct > v_atual.pct + 1e-9
      or (abs(p_pct - v_atual.pct) <= 1e-9 and p_tempo_seg < v_atual.tempo_seg);
    if v_melhorou then
      update public.placar
         set pct = p_pct, placar = left(coalesce(p_placar, ''), 80),
             tempo_seg = p_tempo_seg, nome = v_nome, atualizado_em = now()
       where id = v_atual.id;
      v_pct := p_pct; v_tempo := p_tempo_seg;
    else
      v_pct := v_atual.pct; v_tempo := v_atual.tempo_seg;
    end if;
  else
    insert into public.placar (chave, nome, nome_norm, pct, placar, tempo_seg, passe)
    values (p_chave, v_nome, v_norm, p_pct, left(coalesce(p_placar, ''), 80), p_tempo_seg, p_passe);
    v_melhorou := true;
    v_pct := p_pct; v_tempo := p_tempo_seg;
  end if;

  -- posição pelo melhor resultado do apelido (maior %, empate → menor tempo)
  select count(*) + 1 into v_posicao
    from public.placar p
   where p.chave = p_chave
     and (p.pct > v_pct + 1e-9 or (abs(p.pct - v_pct) <= 1e-9 and p.tempo_seg < v_tempo));
  select count(*) into v_total from public.placar where chave = p_chave;

  return jsonb_build_object(
    'ok', true, 'melhorou', v_melhorou,
    'posicao', v_posicao, 'total', v_total,
    'pct', v_pct, 'tempo_seg', v_tempo
  );
end;
$$;

-- só o serviço chama a função: a interface não tem como inventar uma nota
revoke all on function public.registrar_placar(text, text, double precision, text, integer, uuid) from public;
revoke all on function public.registrar_placar(text, text, double precision, text, integer, uuid) from anon, authenticated;
grant execute on function public.registrar_placar(text, text, double precision, text, integer, uuid) to service_role;

-- Moderação: para tirar um apelido ou um resultado suspeito, basta apagar a
-- linha pelo Table Editor (ou: delete from public.placar where nome_norm = '...').
-- O diário da partida fica em partidas.eventos para conferência.
