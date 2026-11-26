-- ============================================================
-- 071_analise_uso.sql
--
-- COTA DIÁRIA DA ANÁLISE (F5) FORA DO KV.
--
-- A Análise passou a rodar numa Edge Function do Supabase
-- (25/11/2026). O plano gratuito da Cloudflare limitava a 50
-- subrequests por requisição e a bancada mediu até 34 numa
-- pergunta "em todos os centros". O Supabase não tem KV, então o
-- contador diário vira tabela:
--
--   analise_uso (user_id, dia, usadas)  PK (user_id, dia)
--
-- `dia` é o dia de Brasília (UTC-3), como no KV de hoje, e a
-- RPC `analise_consumir()` faz o upsert atômico:
--
--   insert ... values (uid, hoje, 1)
--   on conflict (uid, hoje) do update set usadas = usadas + 1
--   returning usadas
--
-- e apaga as linhas do PRÓPRIO usuário com dia mais antigo que
-- ontem. Duas chamadas simultâneas contam 2: é o upsert que
-- resolve, não um select seguido de insert.
--
-- O TETO NÃO É PARÂMETRO. A RPC sempre incrementa e devolve
-- { dia, usadas }; quem compara com `ANALISE_LIMITE_DIA` (50) é a
-- Edge Function. Chamar a RPC por fora só gasta a cota de quem
-- chamou — nunca aumenta o teto de ninguém.
--
-- A barreira é a de sempre: RLS ligado SEM policy, sem grant de
-- tabela para ninguém, `trg_bloqueia_agente` de statement sem WHEN
-- e a RPC `security definer` com `search_path` fixo e guarda
-- (`auth.uid()` não nulo e `not is_agente()`). Só `authenticated`
-- pode executar a RPC; `anon` e `PUBLIC` não.
--
-- O fuso fica numa função pura `_analise_dia_brasilia(timestamptz)`
-- para o roteiro provar a virada do dia com instantes fixos sem
-- mexer no relógio do banco. Ela não tem grant para ninguém: só a
-- definer a chama.
--
-- Conferência: tests/sql/test_071_analise_uso.sql
-- Executor:    tools/replica-local/rodar-071-pglite.mjs
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Tabela
-- ------------------------------------------------------------

create table if not exists public.analise_uso (
  user_id uuid not null,
  dia     date not null,
  usadas  integer not null,
  constraint analise_uso_pkey primary key (user_id, dia)
);

comment on table public.analise_uso is
  'Cota diária da Análise (F5): uma linha por usuário e dia de Brasília. Escrita só pela RPC analise_consumir(); leitura direta fechada (mig. 071).';
comment on column public.analise_uso.usadas is
  'Perguntas contadas no dia. A Edge Function compara com ANALISE_LIMITE_DIA; a RPC não conhece o teto.';

-- ------------------------------------------------------------
-- 2. Barreiras de tabela
-- ------------------------------------------------------------

alter table public.analise_uso enable row level security;
revoke all on public.analise_uso from public, anon, authenticated;

-- Sem policy de propósito: a ACL e o default deny do RLS fecham a tabela.
-- Se alguém conceder SELECT no futuro, nada vaza.

drop trigger if exists trg_bloqueia_agente on public.analise_uso;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.analise_uso
  for each statement execute function public.bloqueia_escrita_do_agente();

-- ------------------------------------------------------------
-- 3. Dia de Brasília (função pura, sem grant)
-- ------------------------------------------------------------

create or replace function public._analise_dia_brasilia(p_instante timestamptz)
returns date
language sql
immutable
as $$
  select (p_instante at time zone 'America/Sao_Paulo')::date
$$;

comment on function public._analise_dia_brasilia(timestamptz) is
  'Dia civil de Brasília (UTC-3) de um instante. Interna da 071: sem grant para authenticated/anon.';

revoke all on function public._analise_dia_brasilia(timestamptz)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. RPC do contador
-- ------------------------------------------------------------

create or replace function public.analise_consumir()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_dia    date := public._analise_dia_brasilia(now());
  v_usadas integer;
begin
  -- Guarda: só pessoa logada e que não é o agente (Buriti).
  if v_user is null or public.is_agente() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  -- Upsert atômico: duas chamadas simultâneas somam 2, não 1.
  insert into public.analise_uso (user_id, dia, usadas)
  values (v_user, v_dia, 1)
  on conflict (user_id, dia)
  do update set usadas = analise_uso.usadas + 1
  returning usadas into v_usadas;

  -- Retenção mínima: ontem fica, mais antigo que ontem sai.
  delete from public.analise_uso
   where user_id = v_user
     and dia < v_dia - 1;

  return jsonb_build_object('dia', v_dia, 'usadas', v_usadas);
end;
$$;

comment on function public.analise_consumir() is
  'Conta uma pergunta da Análise no dia de Brasília e devolve { dia, usadas }. Teto não é parâmetro: quem compara é a Edge Function. Guard: auth.uid() não nulo e not is_agente().';

revoke all on function public.analise_consumir() from public, anon;
grant execute on function public.analise_consumir() to authenticated;

-- ------------------------------------------------------------
-- Asserções — abortam a transação se o efeito não for o pretendido
-- ------------------------------------------------------------
do $asserts$
declare
  v_tab   oid := 'public.analise_uso'::regclass;
  v_fn    oid := 'public.analise_consumir()'::regprocedure;
  v_dia_fn oid := 'public._analise_dia_brasilia(timestamptz)'::regprocedure;
  v_cols  text;
  v_pk    text;
  v_def   text;
begin
  -- Tabela: RLS ligado, nenhuma policy.
  if not (select relrowsecurity from pg_class where oid = v_tab) then
    raise exception '071: RLS desligado em analise_uso';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'analise_uso'
  ) then
    raise exception '071: analise_uso não deve ter policy; a ACL é a barreira';
  end if;

  -- Colunas e tipos exatos.
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_tab
     and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'user_id:uuid, dia:date, usadas:integer' then
    raise exception '071: colunas/tipos inesperados em analise_uso: %', v_cols;
  end if;

  -- PK exatamente (user_id, dia).
  select string_agg(a.attname, ',' order by k.ord)
    into v_pk
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = v_tab and c.contype = 'p';
  if v_pk <> 'user_id,dia' then
    raise exception '071: PK de analise_uso deveria ser (user_id, dia), veio %', v_pk;
  end if;

  -- Barreira do agente: statement, sem WHEN, INSERT/UPDATE/DELETE.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = v_tab
       and t.tgname = 'trg_bloqueia_agente'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and t.tgqual is null
       and (t.tgtype & 1) = 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|8|16)) = (4|8|16)
       and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
  ) then
    raise exception '071: trg_bloqueia_agente ausente ou incorreto em analise_uso';
  end if;

  -- Tabela fechada para anon e authenticated (só a definer escreve).
  if has_table_privilege('anon', v_tab, 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '071: anon possui acesso a analise_uso';
  end if;
  if has_table_privilege('authenticated', v_tab, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '071: authenticated não pode ter acesso direto a analise_uso';
  end if;

  -- RPC: sem parâmetros, definer, search_path exato e ACL só para authenticated.
  if (select pronargs from pg_proc where oid = v_fn) <> 0 then
    raise exception '071: analise_consumir deveria ter zero parâmetros';
  end if;
  if not (select prosecdef from pg_proc where oid = v_fn) then
    raise exception '071: analise_consumir sem security definer';
  end if;
  if not exists (
    select 1 from pg_proc p
     where p.oid = v_fn
       and p.proconfig = array['search_path=public, pg_temp']::text[]
  ) then
    raise exception '071: analise_consumir sem search_path exato';
  end if;
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception '071: authenticated perdeu EXECUTE em analise_consumir';
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or exists (
       select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     ) then
    raise exception '071: anon/PUBLIC possui EXECUTE em analise_consumir';
  end if;

  -- Helper do dia: puro, sem grant.
  if (select provolatile from pg_proc where oid = v_dia_fn) <> 'i' then
    raise exception '071: _analise_dia_brasilia deveria ser immutable';
  end if;
  if has_function_privilege('authenticated', v_dia_fn, 'EXECUTE')
     or has_function_privilege('anon', v_dia_fn, 'EXECUTE')
     or exists (
       select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = v_dia_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     ) then
    raise exception '071: _analise_dia_brasilia não pode ter EXECUTE para authenticated/anon/PUBLIC';
  end if;

  -- Definição: incremento atômico, retenção e fuso de Brasília.
  v_def := pg_get_functiondef(v_fn);
  if position('usadas + 1' in v_def) = 0 then
    raise exception '071: analise_consumir não incrementa usadas';
  end if;
  if position('dia < v_dia - 1' in v_def) = 0 then
    raise exception '071: analise_consumir não apaga o mais antigo que ontem';
  end if;
  if position('_analise_dia_brasilia(now())' in v_def) = 0 then
    raise exception '071: analise_consumir não usa o dia de Brasília';
  end if;

  -- Virada do dia em Brasília (03:00 UTC = 00:00 BRT).
  if public._analise_dia_brasilia(timestamptz '2026-11-26 02:59:00+00') <> date '2026-11-25' then
    raise exception '071: 02:59 UTC deveria ser 25/11 em Brasília';
  end if;
  if public._analise_dia_brasilia(timestamptz '2026-11-26 03:00:00+00') <> date '2026-11-26' then
    raise exception '071: 03:00 UTC deveria ser 26/11 em Brasília';
  end if;
  if public._analise_dia_brasilia(timestamptz '2026-11-25 03:00:00+00') <> date '2026-11-25' then
    raise exception '071: 00:00 BRT de 25/11 deveria ser 25/11';
  end if;
end
$asserts$;

commit;
