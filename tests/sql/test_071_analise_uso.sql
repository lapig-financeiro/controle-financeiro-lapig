-- ============================================================
-- Roteiro de conferência da migração 071 (cota da Análise)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-071-pglite.mjs
-- Antes da 071, o roteiro falha já no TRUNCATE:
--   relation "public.analise_uso" does not exist
--
-- Identidades da base 064: a1 = admin ('Victor'),
-- b1 = professor, c1 = agente (Buriti).
--
-- O roteiro inteiro roda numa transação e termina em ROLLBACK: as
-- contagens não vazam para a próxima execução. As asserções são
-- inline (sem função em pg_temp) porque o roteiro troca de papel
-- com `set local role`.
-- ============================================================
\set ON_ERROR_STOP on

begin;

-- Prova a existência da tabela cedo: antes da 071 isto aborta o roteiro.
truncate public.analise_uso;

-- ------------------------------------------------------------
-- BLOCO 1 — estrutura, ACL e atributos
-- ------------------------------------------------------------
do $$
declare
  v_tab    oid := 'public.analise_uso'::regclass;
  v_fn     oid;
  v_dia_fn oid := 'public._analise_dia_brasilia(timestamptz)'::regprocedure;
  v_cols   text;
  v_pk     text;
  v_def    text;
begin
  -- A assinatura é zero parâmetros. Conferir por pg_proc antes do cast evita
  -- que um mutante com `p_teto integer default 50` passe como "função não
  -- existe" em vez de "assinatura errada".
  if (select count(*) from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname = 'analise_consumir'
         and pronargs = 0) <> 1 then
    raise exception '071 FALHOU: analise_consumir deveria ter zero parâmetros';
  end if;
  v_fn := 'public.analise_consumir()'::regprocedure;

  if not (select relrowsecurity from pg_class where oid = v_tab) then
    raise exception '071 FALHOU: RLS desligado em analise_uso';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'analise_uso') then
    raise exception '071 FALHOU: analise_uso não deve ter policy';
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_tab and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from 'user_id:uuid, dia:date, usadas:integer' then
    raise exception '071 FALHOU: colunas/tipos inesperados: %', v_cols;
  end if;

  select string_agg(a.attname, ',' order by k.ord)
    into v_pk
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = v_tab and c.contype = 'p';
  if v_pk is distinct from 'user_id,dia' then
    raise exception '071 FALHOU: PK deveria ser (user_id, dia), veio %', v_pk;
  end if;

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
    raise exception '071 FALHOU: trg_bloqueia_agente ausente ou incorreto';
  end if;

  if has_table_privilege('anon', v_tab, 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '071 FALHOU: anon possui acesso à tabela';
  end if;
  if has_table_privilege('authenticated', v_tab, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '071 FALHOU: authenticated possui acesso direto à tabela';
  end if;

  if (select pronargs from pg_proc where oid = v_fn) <> 0 then
    raise exception '071 FALHOU: analise_consumir deveria ter zero parâmetros';
  end if;
  if not (select prosecdef from pg_proc where oid = v_fn) then
    raise exception '071 FALHOU: analise_consumir sem security definer';
  end if;
  if (select prorettype from pg_proc where oid = v_fn) <> 'jsonb'::regtype then
    raise exception '071 FALHOU: analise_consumir deveria devolver jsonb';
  end if;
  if (select provolatile from pg_proc where oid = v_fn) <> 'v' then
    raise exception '071 FALHOU: analise_consumir deveria ser volatile';
  end if;
  if not exists (
    select 1 from pg_proc p
     where p.oid = v_fn
       and p.proconfig = array['search_path=public, pg_temp']::text[]
  ) then
    raise exception '071 FALHOU: analise_consumir sem search_path exato';
  end if;
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception '071 FALHOU: authenticated perdeu EXECUTE em analise_consumir';
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or exists (
       select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     ) then
    raise exception '071 FALHOU: anon possui EXECUTE em analise_consumir';
  end if;

  if has_function_privilege('authenticated', v_dia_fn, 'EXECUTE')
     or has_function_privilege('anon', v_dia_fn, 'EXECUTE')
     or exists (
       select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = v_dia_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     ) then
    raise exception '071 FALHOU: _analise_dia_brasilia tem EXECUTE público';
  end if;

  v_def := pg_get_functiondef(v_fn);
  if position('usadas + 1' in v_def) = 0 then
    raise exception '071 FALHOU: analise_consumir não incrementa usadas';
  end if;
  if position('dia < v_dia - 1' in v_def) = 0 then
    raise exception '071 FALHOU: analise_consumir não apaga o mais antigo que ontem';
  end if;
  if position('_analise_dia_brasilia(now())' in v_def) = 0 then
    raise exception '071 FALHOU: analise_consumir não usa o dia de Brasília';
  end if;

  raise notice '071 BLOCO 1 ok: estrutura, ACL, atributos e barreira';
end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — virada do dia em Brasília (instantes fixos)
-- ------------------------------------------------------------
do $$
begin
  if public._analise_dia_brasilia(timestamptz '2026-11-26 02:59:00+00') <> date '2026-11-25' then
    raise exception '071 FALHOU: 02:59 UTC deveria ser 25/11 em Brasília';
  end if;
  if public._analise_dia_brasilia(timestamptz '2026-11-26 03:00:00+00') <> date '2026-11-26' then
    raise exception '071 FALHOU: 03:00 UTC deveria ser 26/11 em Brasília';
  end if;
  if public._analise_dia_brasilia(timestamptz '2026-11-25 03:00:00+00') <> date '2026-11-25' then
    raise exception '071 FALHOU: 00:00 BRT de 25/11 deveria ser 25/11';
  end if;
  raise notice '071 BLOCO 2 ok: virada do dia em Brasília';
end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — recusas: anon, authenticated sem JWT, agente e escrita direta
-- ------------------------------------------------------------
set local role anon;
do $$
begin
  begin
    perform public.analise_consumir();
    raise exception '071 FALHOU: anon conseguiu consumir';
  exception when insufficient_privilege then null;
  end;
  raise notice '071 BLOCO 3 ok: anon recusado';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.analise_consumir();
    raise exception '071 FALHOU: authenticated sem JWT conseguiu consumir';
  exception when insufficient_privilege then null;
  end;
  raise notice '071 BLOCO 3 ok: sem JWT recusado';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$
begin
  begin
    perform public.analise_consumir();
    raise exception '071 FALHOU: agente conseguiu consumir';
  exception
    when insufficient_privilege then
      -- A recusa tem de vir da guarda da RPC ('Acesso negado.'), não do
      -- gatilho de tabela: sem a guarda, o gatilho ainda barraria a escrita,
      -- mas a RPC teria gastado a cota antes de falhar.
      if sqlerrm <> 'Acesso negado.' then
        raise exception '071 FALHOU: agente barrado pelo motivo errado (%)', sqlerrm;
      end if;
  end;
  raise notice '071 BLOCO 3 ok: agente recusado';
end $$;

-- Escrita direta na tabela também é recusada para authenticated.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
begin
  begin
    insert into public.analise_uso (user_id, dia, usadas)
    values ('00000000-0000-0000-0000-0000000000a1', current_date, 999);
    raise exception '071 FALHOU: authenticated gravou direto na tabela';
  exception when insufficient_privilege then null;
  end;
  raise notice '071 BLOCO 3 ok: escrita direta recusada';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 4 — contagem atômica, separação por usuário e retenção
-- ------------------------------------------------------------
do $$
declare
  v_hoje date := public._analise_dia_brasilia(now());
  a1 uuid := '00000000-0000-0000-0000-0000000000a1';
  b1 uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  insert into public.analise_uso (user_id, dia, usadas) values
    (a1, v_hoje - 1, 7),
    (a1, v_hoje - 2, 9),
    (a1, v_hoje - 9, 4),
    (b1, v_hoje - 2, 5),
    (b1, v_hoje, 3);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

do $$
declare
  r jsonb;
begin
  r := public.analise_consumir();
  if (r ->> 'usadas')::integer <> 1 then
    raise exception '071 FALHOU: primeira chamada deveria dar 1, veio %', r ->> 'usadas';
  end if;
  if r ->> 'dia' <> (now() at time zone 'America/Sao_Paulo')::date::text then
    raise exception '071 FALHOU: a RPC devolveu outro dia (%)', r ->> 'dia';
  end if;

  r := public.analise_consumir();
  if (r ->> 'usadas')::integer <> 2 then
    raise exception '071 FALHOU: duas chamadas seguidas deveriam dar 2, veio %', r ->> 'usadas';
  end if;
  raise notice '071 BLOCO 4 ok: contagem atômica';
end $$;
reset role;

-- A ainda não tocou a linha de B (B só tem a linha de hoje e a antiga de 5).
do $$
declare
  v_hoje date := public._analise_dia_brasilia(now());
  a1 uuid := '00000000-0000-0000-0000-0000000000a1';
  b1 uuid := '00000000-0000-0000-0000-0000000000b1';
  v_usadas integer;
begin
  select usadas into v_usadas from public.analise_uso where user_id = a1 and dia = v_hoje;
  if v_usadas is distinct from 2 then
    raise exception '071 FALHOU: A deveria estar com 2 hoje, veio %', v_usadas;
  end if;

  -- B primeiro: o mutante que apaga a linha de outro usuário falha aqui, com
  -- o motivo certo, antes da checagem da retenção de A.
  select usadas into v_usadas from public.analise_uso where user_id = b1 and dia = v_hoje;
  if v_usadas is distinct from 3 then
    raise exception '071 FALHOU: A não pode tocar a linha de B (hoje), veio %', v_usadas;
  end if;

  select usadas into v_usadas from public.analise_uso where user_id = b1 and dia = v_hoje - 2;
  if v_usadas is distinct from 5 then
    raise exception '071 FALHOU: A não pode apagar a linha antiga de B, veio %', v_usadas;
  end if;

  select usadas into v_usadas from public.analise_uso where user_id = a1 and dia = v_hoje - 1;
  if v_usadas is distinct from 7 then
    raise exception '071 FALHOU: ontem de A deveria continuar em 7, veio %', v_usadas;
  end if;

  if exists (
    select 1 from public.analise_uso where user_id = a1 and dia < v_hoje - 1
  ) then
    raise exception '071 FALHOU: A ainda tem linha mais antiga que ontem';
  end if;
  raise notice '071 BLOCO 4 ok: A não toca a linha de B; retenção de ontem';
end $$;

-- B conta na própria linha: 3 -> 4, e A continua 2.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
declare
  r jsonb;
begin
  r := public.analise_consumir();
  if (r ->> 'usadas')::integer <> 4 then
    raise exception '071 FALHOU: B deveria ir de 3 para 4, veio %', r ->> 'usadas';
  end if;
end $$;
reset role;

do $$
declare
  v_hoje date := public._analise_dia_brasilia(now());
  a1 uuid := '00000000-0000-0000-0000-0000000000a1';
  b1 uuid := '00000000-0000-0000-0000-0000000000b1';
  v_usadas integer;
begin
  select usadas into v_usadas from public.analise_uso where user_id = a1 and dia = v_hoje;
  if v_usadas is distinct from 2 then
    raise exception '071 FALHOU: B não pode mexer na linha de A, veio %', v_usadas;
  end if;
  select usadas into v_usadas from public.analise_uso where user_id = b1 and dia = v_hoje;
  if v_usadas is distinct from 4 then
    raise exception '071 FALHOU: B deveria estar com 4 hoje, veio %', v_usadas;
  end if;
  raise notice '071 BLOCO 4 ok: contas separadas por usuário';
end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — assinatura única, sem parâmetro de teto
-- ------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname = 'analise_consumir') <> 1 then
    raise exception '071 FALHOU: deveria existir exatamente uma analise_consumir';
  end if;
  raise notice '071 BLOCO 5 ok: assinatura única, sem parâmetro de teto';
end $$;

rollback;
