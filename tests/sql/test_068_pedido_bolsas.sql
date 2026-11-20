-- ============================================================
-- Roteiro de conferência da migração 068 (F3-B — pedido de bolsas)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-068-pglite.mjs
-- Antes da 068, o BLOCO 0 falha com 42P01 (tabela ausente). O
-- runner valida esse motivo.
--
-- Base: montarBase064() + 064 + stub-064 do rodar-067-pglite.mjs.
-- Identidades:
--   a1 = admin humano ('Victor')
--   b1 = professor, escopo 51.X e 63.INAT ('Professor do projeto')
--   b2 = professor, escopo 51.Y ('Prof. Bruno')
--   c1 = agente (Buriti), escopo 51.X
--   d1 = automação (Vigia), sem centros
--
-- Todos os dados são sintéticos e a transação termina em rollback.
-- ============================================================
\set ON_ERROR_STOP on

create or replace function pg_temp.ok068(p boolean, p_motivo text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception '068 FALHOU: %', p_motivo;
  end if;
end $$;

create or replace function pg_temp.falha_com068(p_sql text, p_code text, p_msg_like text default null)
returns void
language plpgsql as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if p_code is not null and v_state <> p_code then
      raise exception '068 FALHOU: esperado SQLSTATE %, veio % (%): %', p_code, v_state, v_msg, p_sql;
    end if;
    if p_msg_like is not null and v_msg not like p_msg_like then
      raise exception '068 FALHOU: mensagem "%" não casa com "%": %', v_msg, p_msg_like, p_sql;
    end if;
    return;
  end;
  raise exception '068 FALHOU: operação deveria falhar mas passou: %', p_sql;
end $$;

create or replace function pg_temp.pessoa068(p jsonb, p_nome text) returns jsonb
language sql immutable as $$
  select value
    from jsonb_array_elements(coalesce(p -> 'bolsistas', '[]'::jsonb))
   where value ->> 'nome' = p_nome
   limit 1
$$;

create or replace function pg_temp.tem068(p jsonb, p_nome text) returns boolean
language sql immutable as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p -> 'bolsistas', '[]'::jsonb)) b
     where b ->> 'nome' = p_nome
  )
$$;

create or replace function pg_temp.caixa068(p jsonb, p_id uuid) returns jsonb
language sql immutable as $$
  select value
    from jsonb_array_elements(coalesce(p -> 'caixas', '[]'::jsonb))
   where (value ->> 'id')::uuid = p_id
   limit 1
$$;

create or replace function pg_temp.item068(p_caixa jsonb, p_holder uuid) returns jsonb
language sql immutable as $$
  select value
    from jsonb_array_elements(coalesce(p_caixa -> 'itens', '[]'::jsonb))
   where (value ->> 'holder_id')::uuid = p_holder
   limit 1
$$;

create or replace function pg_temp.codigos068(p jsonb) returns text[]
language sql immutable as $$
  select array_agg(value ->> 'code' order by value ->> 'code')
    from jsonb_array_elements(coalesce(p -> 'centros', '[]'::jsonb))
$$;

begin;

-- ------------------------------------------------------------
-- BLOCO 0 — tabelas existentes, esquema e base sintética
-- ------------------------------------------------------------
do $$
declare
  v_fn oid;
begin
  if to_regclass('public.bolsista_equipes') is null
     or to_regclass('public.caixas_pedido') is null
     or to_regclass('public.caixa_pedido_itens') is null then
    raise exception '068 FALHOU: tabelas da 068 ausentes' using errcode = '42P01';
  end if;

  if to_regclass('public.scholarships') is null
     or to_regclass('public.scholarship_holders') is null then
    raise exception '068 FALHOU: base sem scholarships/scholarship_holders' using errcode = '42P01';
  end if;

  if (select count(*) from public.projects where code in ('51.X', '51.Y', '63.INAT')) <> 3 then
    raise exception '068 FALHOU: base 064 incompleta (faltam 51.X/51.Y/63.INAT)';
  end if;

  -- PKs: contype 'p' com as colunas certas.
  perform pg_temp.ok068(exists (
    select 1 from pg_constraint
     where conrelid = 'public.bolsista_equipes'::regclass
       and contype = 'p'
       and conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = 'public.bolsista_equipes'::regclass
                              and a.attname = 'holder_id')]
  ), 'PK de bolsista_equipes ausente ou errada');

  perform pg_temp.ok068(exists (
    select 1 from pg_constraint
     where conrelid = 'public.caixas_pedido'::regclass
       and contype = 'p'
       and conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = 'public.caixas_pedido'::regclass
                              and a.attname = 'id')]
  ), 'PK de caixas_pedido ausente ou errada');

  perform pg_temp.ok068(exists (
    select 1 from pg_constraint
     where conrelid = 'public.caixa_pedido_itens'::regclass
       and contype = 'p'
       and conkey = array[
         (select a.attnum from pg_attribute a
           where a.attrelid = 'public.caixa_pedido_itens'::regclass and a.attname = 'caixa_id'),
         (select a.attnum from pg_attribute a
           where a.attrelid = 'public.caixa_pedido_itens'::regclass and a.attname = 'holder_id')
       ]
  ), 'PK de caixa_pedido_itens ausente ou errada');

  -- FKs: alvo e colunas, não só o nome.
  perform pg_temp.ok068(exists (
    select 1 from pg_constraint
     where conrelid = 'public.bolsista_equipes'::regclass and contype = 'f'
       and conname = 'bolsista_equipes_holder_id_fkey'
       and confrelid = 'public.scholarship_holders'::regclass
       and conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = 'public.bolsista_equipes'::regclass
                              and a.attname = 'holder_id')]
       and confkey = array[(select a.attnum from pg_attribute a
                             where a.attrelid = 'public.scholarship_holders'::regclass
                               and a.attname = 'id')]
       and confdeltype = 'c'
  ), 'bolsista_equipes_holder_id_fkey ausente, alvo/colunas errados ou sem CASCADE');

  perform pg_temp.ok068(exists (
    select 1 from pg_constraint
     where conrelid = 'public.caixas_pedido'::regclass and contype = 'f'
       and conname = 'caixas_pedido_dono_fkey'
       and confrelid = 'auth.users'::regclass
       and conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = 'public.caixas_pedido'::regclass
                              and a.attname = 'dono')]
       and confkey = array[(select a.attnum from pg_attribute a
                             where a.attrelid = 'auth.users'::regclass
                               and a.attname = 'id')]
       and confdeltype = 'c'
  ), 'caixas_pedido_dono_fkey ausente, alvo/colunas errados ou sem CASCADE');

  perform pg_temp.ok068(exists (
    select 1 from pg_constraint
     where conrelid = 'public.caixa_pedido_itens'::regclass and contype = 'f'
       and conname = 'caixa_pedido_itens_caixa_id_fkey'
       and confrelid = 'public.caixas_pedido'::regclass
       and conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = 'public.caixa_pedido_itens'::regclass
                              and a.attname = 'caixa_id')]
       and confkey = array[(select a.attnum from pg_attribute a
                             where a.attrelid = 'public.caixas_pedido'::regclass
                               and a.attname = 'id')]
       and confdeltype = 'c'
  ), 'caixa_pedido_itens_caixa_id_fkey ausente, alvo/colunas errados ou sem CASCADE');

  perform pg_temp.ok068(exists (
    select 1 from pg_constraint
     where conrelid = 'public.caixa_pedido_itens'::regclass and contype = 'f'
       and conname = 'caixa_pedido_itens_holder_id_fkey'
       and confrelid = 'public.scholarship_holders'::regclass
       and conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = 'public.caixa_pedido_itens'::regclass
                              and a.attname = 'holder_id')]
       and confkey = array[(select a.attnum from pg_attribute a
                             where a.attrelid = 'public.scholarship_holders'::regclass
                               and a.attname = 'id')]
       and confdeltype = 'c'
  ), 'caixa_pedido_itens_holder_id_fkey ausente, alvo/colunas errados ou sem CASCADE');

  -- Gatilhos de statement: agente e automação, sem WHEN.
  perform pg_temp.ok068((
    select count(*) = 3
      from pg_trigger t
     where t.tgrelid in (
             'public.bolsista_equipes'::regclass,
             'public.caixas_pedido'::regclass,
             'public.caixa_pedido_itens'::regclass
           )
       and t.tgname = 'trg_bloqueia_agente'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and t.tgqual is null
       and (t.tgtype & 1) = 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|8|16)) = (4|8|16)
       and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
  ), 'trg_bloqueia_agente ausente ou incorreto');

  perform pg_temp.ok068((
    select count(*) = 3
      from pg_trigger t
     where t.tgrelid in (
             'public.bolsista_equipes'::regclass,
             'public.caixas_pedido'::regclass,
             'public.caixa_pedido_itens'::regclass
           )
       and t.tgname = 'trg_bloqueia_automacao'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and t.tgqual is null
       and (t.tgtype & 1) = 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|8|16)) = (4|8|16)
       and t.tgfoid = 'public._bloquear_financeiro_automacao()'::regprocedure
  ), 'trg_bloqueia_automacao ausente ou incorreto');

  -- Assinatura nova de colocar (2 argumentos) e nenhuma sobrecarga antiga.
  perform pg_temp.ok068(
    to_regprocedure('public.colocar_na_caixa_v2(uuid, uuid)') is not null,
    'colocar_na_caixa_v2(uuid, uuid) ausente');
  perform pg_temp.ok068(not exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'colocar_na_caixa_v2'
       and p.pronargs <> 2
  ), 'sobrecarga antiga de colocar_na_caixa_v2 sobreviveu');

  -- Editar e limpar existem.
  perform pg_temp.ok068(
    to_regprocedure('public.editar_item_caixa_v2(uuid, uuid, numeric, text)') is not null,
    'editar_item_caixa_v2 ausente');
  perform pg_temp.ok068(
    to_regprocedure('public.limpar_ocultos_da_caixa_v2(uuid)') is not null,
    'limpar_ocultos_da_caixa_v2 ausente');

  -- O lock por dono está no texto das duas funções que contam/apagam/inserem.
  v_fn := 'public.salvar_caixa_pedido_v2(jsonb)'::regprocedure;
  perform pg_temp.ok068(
    pg_get_functiondef(v_fn) like '%pg_advisory_xact_lock%',
    'salvar_caixa_pedido_v2 sem pg_advisory_xact_lock');
  v_fn := 'public.colocar_na_caixa_v2(uuid, uuid)'::regprocedure;
  perform pg_temp.ok068(
    pg_get_functiondef(v_fn) like '%pg_advisory_xact_lock%',
    'colocar_na_caixa_v2 sem pg_advisory_xact_lock');
end $$;

-- Retira o bolsista sintético da base 064 para o roteiro ter um
-- conjunto fechado de pessoas. É dado de base, não de produção.
delete from public.scholarships
 where holder_id = (
   select id from public.scholarship_holders where full_name = 'Bolsista Sintético 64X'
 );
delete from public.scholarship_holders where full_name = 'Bolsista Sintético 64X';

insert into public.scholarship_holders (id, full_name) values
  ('00000000-0000-4000-8000-000000068001', 'Ana Pastagem'),
  ('00000000-0000-4000-8000-000000068002', 'Bruno Dupla'),
  ('00000000-0000-4000-8000-000000068003', 'Carla Encerrada'),
  ('00000000-0000-4000-8000-000000068004', 'Davi Antigo'),
  ('00000000-0000-4000-8000-000000068005', 'Elisa Cancelada'),
  ('00000000-0000-4000-8000-000000068006', 'Fábio Outro'),
  ('00000000-0000-4000-8000-000000068007', 'Gabi Dois Centros'),
  ('00000000-0000-4000-8000-000000068008', 'Helena Longe'),
  ('00000000-0000-4000-8000-000000068009', 'Igor Sem Bolsa'),
  ('00000000-0000-4000-8000-000000068010', 'Joana Inativa');

-- Datas relativas a current_date para o roteiro não envelhecer.
insert into public.scholarships (id, holder_id, project_id, amount, start_date, end_date, status)
values
  ('00000000-0000-4000-8000-0000000680a1'::uuid, '00000000-0000-4000-8000-000000068001'::uuid,
   (select id from public.projects where code = '51.X'), 4000, current_date - 30, current_date + 300, 'active'),
  ('00000000-0000-4000-8000-0000000680a2'::uuid, '00000000-0000-4000-8000-000000068002'::uuid,
   (select id from public.projects where code = '51.X'), 3000, current_date - 30, current_date + 300, 'active'),
  ('00000000-0000-4000-8000-0000000680a3'::uuid, '00000000-0000-4000-8000-000000068002'::uuid,
   (select id from public.projects where code = '51.X'), 2000, current_date - 30, current_date + 300, 'active'),
  ('00000000-0000-4000-8000-0000000680a4'::uuid, '00000000-0000-4000-8000-000000068003'::uuid,
   (select id from public.projects where code = '51.X'), 1000, current_date - 30, current_date + 200, 'ended'),
  ('00000000-0000-4000-8000-0000000680a5'::uuid, '00000000-0000-4000-8000-000000068004'::uuid,
   (select id from public.projects where code = '51.X'), 800, current_date - 120, current_date - 60, 'ended'),
  ('00000000-0000-4000-8000-0000000680a6'::uuid, '00000000-0000-4000-8000-000000068005'::uuid,
   (select id from public.projects where code = '51.X'), 900, current_date - 30, current_date + 100, 'cancelled'),
  ('00000000-0000-4000-8000-0000000680a7'::uuid, '00000000-0000-4000-8000-000000068006'::uuid,
   (select id from public.projects where code = '51.Y'), 1200, current_date - 30, current_date + 100, 'active'),
  ('00000000-0000-4000-8000-0000000680a8'::uuid, '00000000-0000-4000-8000-000000068007'::uuid,
   (select id from public.projects where code = '51.X'), 2500, current_date - 30, current_date + 300, 'active'),
  ('00000000-0000-4000-8000-0000000680a9'::uuid, '00000000-0000-4000-8000-000000068007'::uuid,
   (select id from public.projects where code = '51.Y'), 1800, current_date - 30, current_date + 300, 'active'),
  ('00000000-0000-4000-8000-0000000680b1'::uuid, '00000000-0000-4000-8000-000000068008'::uuid,
   (select id from public.projects where code = '51.X'), 700, current_date - 300, current_date - 200, 'ended'),
  ('00000000-0000-4000-8000-0000000680b2'::uuid, '00000000-0000-4000-8000-000000068010'::uuid,
   (select id from public.projects where code = '63.INAT'), 700, current_date - 30, current_date + 300, 'active');

select set_config('test068.x',    (select id::text from public.projects where code = '51.X'),    true);
select set_config('test068.y',    (select id::text from public.projects where code = '51.Y'),    true);
select set_config('test068.inat', (select id::text from public.projects where code = '63.INAT'), true);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;

-- ------------------------------------------------------------
-- BLOCO 1 — visibilidade: professor só vê o próprio escopo
-- ------------------------------------------------------------
do $$
declare
  r jsonb;
  p jsonb;
  v_codes text[];
begin
  r := public.get_pedido_bolsas_v2();

  -- Nenhuma bolsa de centro fora do escopo, nem para dizer que existe.
  perform pg_temp.ok068(
    not exists (
      select 1
        from jsonb_array_elements(coalesce(r -> 'bolsistas', '[]'::jsonb)) bp
       cross join lateral jsonb_array_elements(bp -> 'bolsas') bb
       where (bb ->> 'project_id') not in (current_setting('test068.x'), current_setting('test068.inat'))
    ),
    'b1 recebeu bolsa de centro fora do escopo'
  );

  v_codes := pg_temp.codigos068(r);
  perform pg_temp.ok068(v_codes = array['51.X', '63.INAT'],
    format('b1 deveria ver os centros 51.X/63.INAT, veio %s', v_codes));

  perform pg_temp.ok068(pg_temp.tem068(r, 'Ana Pastagem'), 'b1 deveria ver Ana');
  perform pg_temp.ok068(pg_temp.tem068(r, 'Bruno Dupla'), 'b1 deveria ver Bruno');
  perform pg_temp.ok068(pg_temp.tem068(r, 'Carla Encerrada'), 'b1 deveria ver Carla (ended com fim futuro)');
  perform pg_temp.ok068(pg_temp.tem068(r, 'Davi Antigo'), 'b1 deveria ver Davi (fim nos últimos 180 dias)');
  perform pg_temp.ok068(pg_temp.tem068(r, 'Gabi Dois Centros'), 'b1 deveria ver Gabi');
  perform pg_temp.ok068(pg_temp.tem068(r, 'Joana Inativa'), 'b1 deveria ver Joana (centro inativo do escopo)');
  perform pg_temp.ok068(not pg_temp.tem068(r, 'Elisa Cancelada'), 'b1 não deveria ver Elisa (só bolsa cancelada)');
  perform pg_temp.ok068(not pg_temp.tem068(r, 'Fábio Outro'), 'b1 não deveria ver Fábio (só 51.Y)');
  perform pg_temp.ok068(not pg_temp.tem068(r, 'Helena Longe'), 'b1 não deveria ver Helena (fim há 200 dias)');
  perform pg_temp.ok068(not pg_temp.tem068(r, 'Igor Sem Bolsa'), 'b1 não deveria ver Igor (sem bolsa)');

  p := pg_temp.pessoa068(r, 'Ana Pastagem');
  perform pg_temp.ok068((p ->> 'valor_vigente')::numeric = 4000, 'valor_vigente de Ana deveria ser 4000');
  perform pg_temp.ok068(jsonb_array_length(p -> 'bolsas') = 1, 'Ana deveria ter 1 bolsa');
  perform pg_temp.ok068((p -> 'bolsas' -> 0 ->> 'vigente_hoje')::boolean, 'a bolsa de Ana é vigente hoje');

  p := pg_temp.pessoa068(r, 'Bruno Dupla');
  perform pg_temp.ok068((p ->> 'valor_vigente')::numeric = 5000, 'Bruno deveria somar 3000+2000=5000');
  perform pg_temp.ok068(jsonb_array_length(p -> 'bolsas') = 2, 'Bruno deveria ter 2 bolsas');

  p := pg_temp.pessoa068(r, 'Carla Encerrada');
  perform pg_temp.ok068((p ->> 'valor_vigente')::numeric = 1000, 'Carla (ended com fim futuro) deveria contar 1000');
  perform pg_temp.ok068((p -> 'bolsas' -> 0 ->> 'vigente_hoje')::boolean, 'a bolsa ended de Carla é vigente hoje');

  p := pg_temp.pessoa068(r, 'Davi Antigo');
  perform pg_temp.ok068((p ->> 'valor_vigente')::numeric = 0, 'Davi (ended no passado) deveria valer 0 hoje');
  perform pg_temp.ok068(not (p -> 'bolsas' -> 0 ->> 'vigente_hoje')::boolean, 'a bolsa de Davi não é vigente hoje');

  p := pg_temp.pessoa068(r, 'Gabi Dois Centros');
  perform pg_temp.ok068((p ->> 'valor_vigente')::numeric = 2500,
    'Gabi deveria valer só o 51.X (2500) para b1');
  perform pg_temp.ok068(jsonb_array_length(p -> 'bolsas') = 1,
    'Gabi deveria mostrar só a bolsa do 51.X para b1');
  perform pg_temp.ok068(p -> 'bolsas' -> 0 ->> 'code' = '51.X',
    'a bolsa visível de Gabi para b1 deveria ser a do 51.X');

  p := pg_temp.pessoa068(r, 'Joana Inativa');
  perform pg_temp.ok068((p ->> 'valor_vigente')::numeric = 700, 'Joana deveria valer 700');

  -- Equipe ainda não cadastrada.
  perform pg_temp.ok068((p -> 'equipe') = 'null'::jsonb, 'equipe começa nula');
end $$;

-- b2 só vê o 51.Y.
do $$
declare
  r jsonb;
  p jsonb;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
  r := public.get_pedido_bolsas_v2();

  perform pg_temp.ok068(pg_temp.codigos068(r) = array['51.Y'],
    format('b2 deveria ver só 51.Y, veio %s', pg_temp.codigos068(r)));
  perform pg_temp.ok068(pg_temp.tem068(r, 'Fábio Outro'), 'b2 deveria ver Fábio');
  perform pg_temp.ok068(pg_temp.tem068(r, 'Gabi Dois Centros'), 'b2 deveria ver Gabi');
  perform pg_temp.ok068(not pg_temp.tem068(r, 'Ana Pastagem'), 'b2 não deveria ver Ana');

  p := pg_temp.pessoa068(r, 'Gabi Dois Centros');
  perform pg_temp.ok068((p ->> 'valor_vigente')::numeric = 1800,
    'Gabi deveria valer só o 51.Y (1800) para b2');
  perform pg_temp.ok068(jsonb_array_length(p -> 'bolsas') = 1,
    'Gabi deveria mostrar só a bolsa do 51.Y para b2');
end $$;

-- Admin vê tudo; automação e agente recebem 42501 nas oito RPCs.
do $$
declare
  r jsonb;
  p jsonb;
  v_holder uuid := '00000000-0000-4000-8000-000000068001';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  r := public.get_pedido_bolsas_v2();
  perform pg_temp.ok068(pg_temp.codigos068(r) = array['51.X', '51.Y', '63.INAT'],
    format('admin deveria ver os três centros, veio %s', pg_temp.codigos068(r)));
  perform pg_temp.ok068(pg_temp.tem068(r, 'Fábio Outro'), 'admin deveria ver Fábio');
  perform pg_temp.ok068(not pg_temp.tem068(r, 'Elisa Cancelada'), 'admin não lista quem só tem bolsa cancelada');
  perform pg_temp.ok068(not pg_temp.tem068(r, 'Igor Sem Bolsa'), 'admin não lista quem não tem bolsa');

  p := pg_temp.pessoa068(r, 'Gabi Dois Centros');
  perform pg_temp.ok068((p ->> 'valor_vigente')::numeric = 4300,
    'Gabi deveria somar 2500+1800=4300 para o admin');
  perform pg_temp.ok068(jsonb_array_length(p -> 'bolsas') = 2,
    'Gabi deveria ter 2 bolsas para o admin');

  -- Automação: 42501 em todas as RPCs.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
  perform pg_temp.falha_com068('select public.get_pedido_bolsas_v2()', '42501');
  perform pg_temp.falha_com068(
    format($q$select public.salvar_equipe_bolsista_v2(%L::uuid, 'pastagem')$q$, v_holder),
    '42501');
  perform pg_temp.falha_com068(
    $q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'x'))$q$, '42501');
  perform pg_temp.falha_com068(
    format($q$select public.apagar_caixa_pedido_v2(%L::uuid)$q$, gen_random_uuid()::text),
    '42501');
  perform pg_temp.falha_com068(
    format($q$select public.colocar_na_caixa_v2(%L::uuid, %L::uuid)$q$,
      gen_random_uuid()::text, v_holder),
    '42501');
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, null, null)$q$,
      gen_random_uuid()::text, v_holder),
    '42501');
  perform pg_temp.falha_com068(
    format($q$select public.tirar_da_caixa_v2(%L::uuid, %L::uuid)$q$,
      gen_random_uuid()::text, v_holder),
    '42501');
  perform pg_temp.falha_com068(
    format($q$select public.limpar_ocultos_da_caixa_v2(%L::uuid)$q$, gen_random_uuid()::text),
    '42501');

  -- Agente: 42501 em todas as RPCs.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
  perform pg_temp.falha_com068('select public.get_pedido_bolsas_v2()', '42501');
  perform pg_temp.falha_com068(
    format($q$select public.salvar_equipe_bolsista_v2(%L::uuid, 'pastagem')$q$, v_holder),
    '42501');
  perform pg_temp.falha_com068(
    $q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'x'))$q$, '42501');
  perform pg_temp.falha_com068(
    format($q$select public.apagar_caixa_pedido_v2(%L::uuid)$q$, gen_random_uuid()::text),
    '42501');
  perform pg_temp.falha_com068(
    format($q$select public.colocar_na_caixa_v2(%L::uuid, %L::uuid)$q$,
      gen_random_uuid()::text, v_holder),
    '42501');
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, null, null)$q$,
      gen_random_uuid()::text, v_holder),
    '42501');
  perform pg_temp.falha_com068(
    format($q$select public.tirar_da_caixa_v2(%L::uuid, %L::uuid)$q$,
      gen_random_uuid()::text, v_holder),
    '42501');
  perform pg_temp.falha_com068(
    format($q$select public.limpar_ocultos_da_caixa_v2(%L::uuid)$q$, gen_random_uuid()::text),
    '42501');

  -- Sem linha em app_users: 42501.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', true);
  perform pg_temp.falha_com068('select public.get_pedido_bolsas_v2()', '42501');

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
end $$;

-- Tabelas fechadas para anon e para authenticated (inclusive admin).
reset role;
set local role anon;
select pg_temp.falha_com068('select count(*) from public.bolsista_equipes', '42501');
select pg_temp.falha_com068('select count(*) from public.caixas_pedido', '42501');
select pg_temp.falha_com068('select count(*) from public.caixa_pedido_itens', '42501');
select pg_temp.falha_com068('select public.get_pedido_bolsas_v2()', '42501');
reset role;
set local role authenticated;

do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  perform pg_temp.falha_com068('select count(*) from public.bolsista_equipes', '42501');
  perform pg_temp.falha_com068('select count(*) from public.caixas_pedido', '42501');
  perform pg_temp.falha_com068('select count(*) from public.caixa_pedido_itens', '42501');
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  perform pg_temp.falha_com068('select count(*) from public.bolsista_equipes', '42501');
  perform pg_temp.falha_com068('select count(*) from public.caixas_pedido', '42501');
  perform pg_temp.falha_com068('select count(*) from public.caixa_pedido_itens', '42501');
end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — equipe: válida, inválida, vazio apaga e compartilhamento
-- ------------------------------------------------------------
do $$
declare
  r jsonb;
  p jsonb;
begin
  r := public.salvar_equipe_bolsista_v2('00000000-0000-4000-8000-000000068001'::uuid, 'pastagem');
  perform pg_temp.ok068(r ->> 'equipe' = 'pastagem', 'equipe salva deveria ser pastagem');

  r := public.get_pedido_bolsas_v2();
  perform pg_temp.ok068(pg_temp.pessoa068(r, 'Ana Pastagem') ->> 'equipe' = 'pastagem',
    'get deveria devolver a equipe de Ana');

  perform pg_temp.falha_com068(
    format($q$select public.salvar_equipe_bolsista_v2(%L::uuid, 'qualquer')$q$,
      '00000000-0000-4000-8000-000000068001'),
    '22023');

  perform pg_temp.falha_com068(
    format($q$select public.salvar_equipe_bolsista_v2(%L::uuid, 'pastagem')$q$,
      '00000000-0000-4000-8000-000000068006'),
    '42501');

  perform pg_temp.falha_com068(
    format($q$select public.salvar_equipe_bolsista_v2(%L::uuid, 'pastagem')$q$,
      '00000000-0000-4000-8000-000000068009'),
    '42501');

  perform pg_temp.falha_com068(
    'select public.salvar_equipe_bolsista_v2(null, ''pastagem'')',
    '22023');

  -- Vazio e null apagam.
  r := public.salvar_equipe_bolsista_v2('00000000-0000-4000-8000-000000068001'::uuid, '');
  perform pg_temp.ok068(r -> 'equipe' = 'null'::jsonb, 'equipe vazia deveria apagar');
  r := public.salvar_equipe_bolsista_v2('00000000-0000-4000-8000-000000068001'::uuid, null);
  perform pg_temp.ok068(r -> 'equipe' = 'null'::jsonb, 'equipe nula deveria apagar');

  perform public.salvar_equipe_bolsista_v2('00000000-0000-4000-8000-000000068001'::uuid, 'solos');
end $$;

-- b2 classifica Gabi; b1, que também vê Gabi, enxerga a mesma equipe.
do $$
declare
  r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
  perform public.salvar_equipe_bolsista_v2('00000000-0000-4000-8000-000000068007'::uuid, 'alertas');

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  r := public.get_pedido_bolsas_v2();
  perform pg_temp.ok068(pg_temp.pessoa068(r, 'Gabi Dois Centros') ->> 'equipe' = 'alertas',
    'a equipe de Gabi deveria ser compartilhada entre b1 e b2');
end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — caixas: criar, validar, alterar, apagar e isolamento
-- ------------------------------------------------------------
do $$
declare
  r jsonb;
  c1 uuid;
  c2 uuid;
  c3 uuid;
  ctmp uuid;
begin
  -- Payload inválido.
  perform pg_temp.falha_com068(
    $q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'x', 'extra', 1))$q$,
    '22023');
  perform pg_temp.falha_com068(
    $q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', '  '))$q$,
    '22023');
  perform pg_temp.falha_com068(
    format($q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', %L))$q$, repeat('n', 81)),
    '22023');
  perform pg_temp.falha_com068(
    $q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'x', 'meses', 0))$q$,
    '22023');
  perform pg_temp.falha_com068(
    $q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'x', 'meses', 61))$q$,
    '22023');
  perform pg_temp.falha_com068(
    $q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'x', 'meses', 1.5))$q$,
    '22023');
  perform pg_temp.falha_com068(
    $q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'x', 'meses', '12'))$q$,
    '22023');
  perform pg_temp.falha_com068(
    $q$select public.salvar_caixa_pedido_v2(jsonb_build_object('id', 'nao-e-uuid', 'nome', 'x'))$q$,
    '22023');

  -- Nome de 80 caracteres, meses 1 e 60, e sem meses (padrão 12).
  r := public.salvar_caixa_pedido_v2(jsonb_build_object('nome', repeat('n', 80), 'meses', 1));
  ctmp := (r ->> 'id')::uuid;
  perform pg_temp.ok068((r ->> 'meses')::integer = 1, 'meses 1 deveria ser aceito');
  perform public.apagar_caixa_pedido_v2(ctmp);

  r := public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'Mesmo 60', 'meses', 60));
  ctmp := (r ->> 'id')::uuid;
  perform pg_temp.ok068((r ->> 'meses')::integer = 60, 'meses 60 deveria ser aceito');
  perform public.apagar_caixa_pedido_v2(ctmp);

  r := public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'Padrão'));
  ctmp := (r ->> 'id')::uuid;
  perform pg_temp.ok068((r ->> 'meses')::integer = 12, 'caixa sem meses deveria usar 12');
  perform public.apagar_caixa_pedido_v2(ctmp);

  -- Cria três caixas.
  r := public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'Time Pastagem', 'meses', 12));
  c1 := (r ->> 'id')::uuid;
  perform pg_temp.ok068(r ->> 'nome' = 'Time Pastagem', 'nome da caixa 1');
  perform pg_temp.ok068((r ->> 'meses')::integer = 12, 'meses da caixa 1');

  r := public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'Reserva', 'meses', 18));
  c2 := (r ->> 'id')::uuid;
  perform pg_temp.ok068((r ->> 'meses')::integer = 18, 'meses da caixa 2');

  r := public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'Terceira', 'meses', 6));
  c3 := (r ->> 'id')::uuid;

  perform set_config('test068.caixa1', c1::text, true);
  perform set_config('test068.caixa2', c2::text, true);
  perform set_config('test068.caixa3', c3::text, true);

  r := public.get_pedido_bolsas_v2();
  perform pg_temp.ok068(jsonb_array_length(r -> 'caixas') = 3, 'b1 deveria ter 3 caixas');

  -- Atualiza a caixa 1.
  r := public.salvar_caixa_pedido_v2(jsonb_build_object('id', c1, 'nome', 'Time Pastagem 2027', 'meses', 10));
  perform pg_temp.ok068(r ->> 'nome' = 'Time Pastagem 2027', 'nome atualizado');
  perform pg_temp.ok068((r ->> 'meses')::integer = 10, 'meses atualizados');

  -- Atualizar sem meses mantém os meses atuais.
  r := public.salvar_caixa_pedido_v2(jsonb_build_object('id', c2, 'nome', 'Reserva 2027'));
  perform pg_temp.ok068(r ->> 'nome' = 'Reserva 2027', 'nome atualizado sem meses');
  perform pg_temp.ok068((r ->> 'meses')::integer = 18, 'meses antigos deveriam ser mantidos');

  -- Id inexistente.
  perform pg_temp.falha_com068(
    format($q$select public.salvar_caixa_pedido_v2(jsonb_build_object('id', %L, 'nome', 'x'))$q$,
      gen_random_uuid()::text),
    'P0002');

  -- Caixa de outro professor responde P0002 em todas as operações.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
  perform pg_temp.falha_com068(
    format($q$select public.salvar_caixa_pedido_v2(jsonb_build_object('id', %L, 'nome', 'x'))$q$, c1::text),
    'P0002');
  perform pg_temp.falha_com068(
    format($q$select public.apagar_caixa_pedido_v2(%L::uuid)$q$, c1::text),
    'P0002');
  perform pg_temp.falha_com068(
    format($q$select public.colocar_na_caixa_v2(%L::uuid, %L::uuid)$q$,
      c1::text, '00000000-0000-4000-8000-000000068007'),
    'P0002');
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, 100, null)$q$,
      c1::text, '00000000-0000-4000-8000-000000068007'),
    'P0002');
  perform pg_temp.falha_com068(
    format($q$select public.tirar_da_caixa_v2(%L::uuid, %L::uuid)$q$,
      c1::text, '00000000-0000-4000-8000-000000068007'),
    'P0002');
  perform pg_temp.falha_com068(
    format($q$select public.limpar_ocultos_da_caixa_v2(%L::uuid)$q$, c1::text),
    'P0002');

  r := public.get_pedido_bolsas_v2();
  perform pg_temp.ok068(r -> 'caixas' = '[]'::jsonb, 'b2 não pode ver as caixas de b1');

  -- b2 cria a própria caixa.
  r := public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'Do Bruno', 'meses', 12));
  ctmp := (r ->> 'id')::uuid;
  perform set_config('test068.caixa_b2', ctmp::text, true);
  r := public.get_pedido_bolsas_v2();
  perform pg_temp.ok068(jsonb_array_length(r -> 'caixas') = 1, 'b2 deveria ter 1 caixa');
  perform pg_temp.ok068((r -> 'caixas' -> 0 ->> 'nome') = 'Do Bruno', 'nome da caixa de b2');

  -- b1 não vê a caixa de b2.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  r := public.get_pedido_bolsas_v2();
  perform pg_temp.ok068(jsonb_array_length(r -> 'caixas') = 3, 'b1 deveria continuar com 3 caixas');
end $$;

-- ------------------------------------------------------------
-- BLOCO 4 — itens, valores, editar, mover entre três caixas, ocultos
-- ------------------------------------------------------------
do $$
declare
  r jsonb;
  c1 uuid := current_setting('test068.caixa1')::uuid;
  c2 uuid := current_setting('test068.caixa2')::uuid;
  c3 uuid := current_setting('test068.caixa3')::uuid;
  cx jsonb;
  it jsonb;
begin
  -- Ana sem valor_mensal usa o vigente (4000).
  r := public.colocar_na_caixa_v2(c1, '00000000-0000-4000-8000-000000068001'::uuid);
  perform pg_temp.ok068((r ->> 'valor_usado')::numeric = 4000,
    'Ana deveria usar 4000 (valor vigente)');
  perform pg_temp.ok068(r -> 'saiu_de' = '[]'::jsonb, 'primeira caixa não deveria ter saída');

  -- Bruno tem duas bolsas vigentes: 3000 + 2000 = 5000.
  r := public.colocar_na_caixa_v2(c1, '00000000-0000-4000-8000-000000068002'::uuid);
  perform pg_temp.ok068((r ->> 'valor_usado')::numeric = 5000,
    'Bruno deveria usar 5000 (duas bolsas)');

  r := public.get_pedido_bolsas_v2();
  cx := pg_temp.caixa068(r, c1);
  perform pg_temp.ok068((cx ->> 'pessoas')::integer = 2, 'caixa 1 deveria ter 2 pessoas');
  perform pg_temp.ok068((cx ->> 'total_mensal')::numeric = 9000, 'caixa 1 deveria somar 9000/mês');
  perform pg_temp.ok068((cx ->> 'total_periodo')::numeric = 90000, 'caixa 1 deveria somar 90000 em 10 meses');
  perform pg_temp.ok068(jsonb_array_length(cx -> 'itens') = 2, 'caixa 1 deveria ter 2 itens');

  -- Carla: ended com fim futuro conta 1000.
  r := public.colocar_na_caixa_v2(c2, '00000000-0000-4000-8000-000000068003'::uuid);
  perform pg_temp.ok068((r ->> 'valor_usado')::numeric = 1000,
    'Carla deveria entrar com 1000');

  -- Davi: ended no passado entra com 0 (não vira erro nem some da caixa).
  r := public.colocar_na_caixa_v2(c2, '00000000-0000-4000-8000-000000068004'::uuid);
  perform pg_temp.ok068((r ->> 'valor_usado')::numeric = 0,
    'Davi deveria entrar com 0 (não vigente hoje)');

  -- Cancelada não é visível.
  perform pg_temp.falha_com068(
    format($q$select public.colocar_na_caixa_v2(%L::uuid, %L::uuid)$q$,
      c1::text, '00000000-0000-4000-8000-000000068005'),
    '42501');

  -- Fora do escopo não é visível.
  perform pg_temp.falha_com068(
    format($q$select public.colocar_na_caixa_v2(%L::uuid, %L::uuid)$q$,
      c1::text, '00000000-0000-4000-8000-000000068006'),
    '42501');

  -- Editar: valor 0, negativo, NaN, infinito e 0,004 (arredonda para 0).
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, 0, null)$q$,
      c1::text, '00000000-0000-4000-8000-000000068001'),
    '22023');
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, -1, null)$q$,
      c1::text, '00000000-0000-4000-8000-000000068001'),
    '22023');
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, %L::numeric, null)$q$,
      c1::text, '00000000-0000-4000-8000-000000068001', 'NaN'),
    '22023');
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, %L::numeric, null)$q$,
      c1::text, '00000000-0000-4000-8000-000000068001', 'Infinity'),
    '22023');
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, 0.004, null)$q$,
      c1::text, '00000000-0000-4000-8000-000000068001'),
    '22023');

  -- Nota longa e CPF.
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, null, %L)$q$,
      c1::text, '00000000-0000-4000-8000-000000068001', repeat('n', 301)),
    '22023');
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, null, %L)$q$,
      c1::text, '00000000-0000-4000-8000-000000068001', 'CPF 529-982-247-25'),
    '22023');

  -- Item inexistente e caixa inexistente.
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, 100, null)$q$,
      c1::text, '00000000-0000-4000-8000-000000068003'),
    'P0002');
  perform pg_temp.falha_com068(
    format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, 100, null)$q$,
      gen_random_uuid()::text, '00000000-0000-4000-8000-000000068001'),
    'P0002');

  -- Edita Ana; chamar colocar de novo não pode apagar o que foi editado.
  r := public.editar_item_caixa_v2(
    c1, '00000000-0000-4000-8000-000000068001'::uuid, 4200, 'Nota da Ana');
  perform pg_temp.ok068((r ->> 'valor_usado')::numeric = 4200, 'Ana editada deveria usar 4200');
  perform pg_temp.ok068(r ->> 'nota' = 'Nota da Ana', 'Ana deveria manter a nota');

  r := public.colocar_na_caixa_v2(c1, '00000000-0000-4000-8000-000000068001'::uuid);
  perform pg_temp.ok068((r ->> 'valor_mensal')::numeric = 4200,
    'colocar de novo não pode zerar o valor editado');
  perform pg_temp.ok068(r ->> 'nota' = 'Nota da Ana',
    'colocar de novo não pode apagar a nota');
  perform pg_temp.ok068(r -> 'saiu_de' = '[]'::jsonb, 'já na caixa não deveria ter saída');

  r := public.get_pedido_bolsas_v2();
  cx := pg_temp.caixa068(r, c1);
  perform pg_temp.ok068((cx ->> 'total_mensal')::numeric = 9200,
    'caixa 1 deveria somar 4200+5000=9200');

  -- Nota de 300 caracteres é aceita; null limpa valor e nota.
  r := public.editar_item_caixa_v2(
    c1, '00000000-0000-4000-8000-000000068001'::uuid, null, repeat('n', 300));
  perform pg_temp.ok068(char_length(r ->> 'nota') = 300, 'nota de 300 deveria ser aceita');
  r := public.editar_item_caixa_v2(
    c1, '00000000-0000-4000-8000-000000068001'::uuid, null, null);
  perform pg_temp.ok068(r -> 'valor_mensal' = 'null'::jsonb, 'null deveria limpar o valor');
  perform pg_temp.ok068(r -> 'nota' = 'null'::jsonb, 'null deveria limpar a nota');

  -- Bruno com valor próprio e nota; mover para a caixa 2 leva os dois.
  r := public.editar_item_caixa_v2(
    c1, '00000000-0000-4000-8000-000000068002'::uuid, 4500, 'Nota curta do pedido');
  r := public.colocar_na_caixa_v2(c2, '00000000-0000-4000-8000-000000068002'::uuid);
  perform pg_temp.ok068((r ->> 'valor_usado')::numeric = 4500,
    'Bruno deveria levar 4500 para a caixa 2');
  perform pg_temp.ok068((r ->> 'valor_mensal')::numeric = 4500,
    'mover deveria levar o valor_mensal');
  perform pg_temp.ok068(r ->> 'nota' = 'Nota curta do pedido',
    'mover deveria levar a nota');
  perform pg_temp.ok068(jsonb_array_length(r -> 'saiu_de') = 1,
    'mover deveria devolver de qual caixa saiu');
  perform pg_temp.ok068((r -> 'saiu_de' -> 0 ->> 'caixa_id')::uuid = c1,
    'a saída deveria ser da caixa 1');

  r := public.get_pedido_bolsas_v2();
  cx := pg_temp.caixa068(r, c1);
  perform pg_temp.ok068((cx ->> 'pessoas')::integer = 1, 'caixa 1 deveria ficar com 1 pessoa');
  perform pg_temp.ok068((cx ->> 'total_mensal')::numeric = 4000, 'caixa 1 deveria ficar em 4000');

  cx := pg_temp.caixa068(r, c2);
  perform pg_temp.ok068((cx ->> 'pessoas')::integer = 3, 'caixa 2 deveria ter 3 pessoas');
  perform pg_temp.ok068((cx ->> 'total_mensal')::numeric = 5500,
    'caixa 2 deveria somar 1000 + 0 + 4500 = 5500');
  perform pg_temp.ok068((cx ->> 'total_periodo')::numeric = 99000,
    'caixa 2 deveria somar 5500 em 18 meses');
  it := pg_temp.item068(cx, '00000000-0000-4000-8000-000000068002'::uuid);
  perform pg_temp.ok068((it ->> 'valor_mensal')::numeric = 4500,
    'o item na caixa 2 deveria guardar 4500');
  perform pg_temp.ok068(it ->> 'nota' = 'Nota curta do pedido',
    'o item na caixa 2 deveria guardar a nota');

  -- Colocar de novo na mesma caixa não muda nada nem devolve saída.
  r := public.colocar_na_caixa_v2(c2, '00000000-0000-4000-8000-000000068002'::uuid);
  perform pg_temp.ok068((r ->> 'valor_mensal')::numeric = 4500, 'item estável no valor');
  perform pg_temp.ok068(r ->> 'nota' = 'Nota curta do pedido', 'item estável na nota');
  perform pg_temp.ok068(r -> 'saiu_de' = '[]'::jsonb, 'item estável sem saída');

  -- Mover entre três caixas: c2 -> c3 -> c1.
  r := public.colocar_na_caixa_v2(c3, '00000000-0000-4000-8000-000000068002'::uuid);
  perform pg_temp.ok068((r -> 'saiu_de' -> 0 ->> 'caixa_id')::uuid = c2,
    'mover da caixa 2 para a 3 deveria devolver c2');
  r := public.colocar_na_caixa_v2(c1, '00000000-0000-4000-8000-000000068002'::uuid);
  perform pg_temp.ok068((r -> 'saiu_de' -> 0 ->> 'caixa_id')::uuid = c3,
    'mover da caixa 3 para a 1 deveria devolver c3');
  perform pg_temp.ok068((r ->> 'valor_mensal')::numeric = 4500,
    'o terceiro movimento deveria manter o valor');
  perform pg_temp.ok068(r ->> 'nota' = 'Nota curta do pedido',
    'o terceiro movimento deveria manter a nota');

  r := public.get_pedido_bolsas_v2();
  cx := pg_temp.caixa068(r, c1);
  perform pg_temp.ok068((cx ->> 'total_mensal')::numeric = 8500,
    'caixa 1 deveria somar 4000+4500=8500 depois dos três movimentos');
  cx := pg_temp.caixa068(r, c3);
  perform pg_temp.ok068((cx ->> 'pessoas')::integer = 0, 'caixa 3 deveria ficar vazia');

  -- Tirar Carla e Davi.
  r := public.tirar_da_caixa_v2(c2, '00000000-0000-4000-8000-000000068003'::uuid);
  perform pg_temp.ok068((r ->> 'removido')::boolean, 'tirar Carla');
  perform public.tirar_da_caixa_v2(c2, '00000000-0000-4000-8000-000000068004'::uuid);

  r := public.get_pedido_bolsas_v2();
  cx := pg_temp.caixa068(r, c2);
  perform pg_temp.ok068((cx ->> 'pessoas')::integer = 0, 'caixa 2 deveria ficar vazia');
  perform pg_temp.ok068((cx ->> 'total_mensal')::numeric = 0, 'caixa 2 deveria ficar em 0');

  perform pg_temp.falha_com068(
    format($q$select public.tirar_da_caixa_v2(%L::uuid, %L::uuid)$q$,
      c2::text, '00000000-0000-4000-8000-000000068003'),
    'P0002');
end $$;

-- Item de pessoa que deixou de ser visível sai da lista e da soma; o
-- botão da tela chama limpar_ocultos_da_caixa_v2.
reset role;
insert into public.caixa_pedido_itens (caixa_id, holder_id, nota)
values (current_setting('test068.caixa1')::uuid,
        '00000000-0000-4000-8000-000000068006'::uuid,
        'item fora do escopo');
set local role authenticated;

do $$
declare
  r jsonb;
  c1 uuid := current_setting('test068.caixa1')::uuid;
  cx jsonb;
begin
  r := public.get_pedido_bolsas_v2();
  cx := pg_temp.caixa068(r, c1);
  perform pg_temp.ok068((cx ->> 'itens_ocultos')::integer = 1,
    'caixa 1 deveria contar 1 item oculto');
  perform pg_temp.ok068(jsonb_array_length(cx -> 'itens') = 2,
    'o item fora do escopo não deveria aparecer');
  perform pg_temp.ok068((cx ->> 'pessoas')::integer = 2,
    'o item fora do escopo não deveria contar como pessoa');
  perform pg_temp.ok068((cx ->> 'total_mensal')::numeric = 8500,
    'o item fora do escopo não deveria entrar na soma');

  r := public.limpar_ocultos_da_caixa_v2(c1);
  perform pg_temp.ok068((r ->> 'removidos')::integer = 1,
    'limpar_ocultos deveria remover o item fora do escopo');
  perform pg_temp.ok068(not (r ? 'itens'), 'limpar_ocultos não deveria devolver nomes');

  r := public.get_pedido_bolsas_v2();
  cx := pg_temp.caixa068(r, c1);
  perform pg_temp.ok068((cx ->> 'itens_ocultos')::integer = 0,
    'depois de limpar não deveria sobrar item oculto');

  r := public.limpar_ocultos_da_caixa_v2(c1);
  perform pg_temp.ok068((r ->> 'removidos')::integer = 0,
    'limpar de novo não deveria remover ninguém');
end $$;

do $$
declare
  r jsonb;
  c1 uuid := current_setting('test068.caixa1')::uuid;
begin
  -- b2 não coloca ninguém na caixa de b1 (P0002, igual à inexistente).
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
  perform pg_temp.falha_com068(
    format($q$select public.colocar_na_caixa_v2(%L::uuid, %L::uuid)$q$,
      c1::text, '00000000-0000-4000-8000-000000068006'),
    'P0002');

  -- b2 coloca Gabi na própria caixa.
  r := public.colocar_na_caixa_v2(
    current_setting('test068.caixa_b2')::uuid,
    '00000000-0000-4000-8000-000000068007'::uuid);
  perform pg_temp.ok068((r ->> 'valor_usado')::numeric = 1800,
    'Gabi deveria usar 1800 no escopo de b2');

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — limite de 10 caixas e cascade ao apagar
-- ------------------------------------------------------------
do $$
declare
  r jsonb;
  i integer;
  c_extra uuid;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);

  -- b2 já tem 1 caixa (Do Bruno). Completa 10.
  for i in 1..9 loop
    perform public.salvar_caixa_pedido_v2(
      jsonb_build_object('nome', 'Reserva ' || i, 'meses', 6));
  end loop;

  r := public.get_pedido_bolsas_v2();
  perform pg_temp.ok068(jsonb_array_length(r -> 'caixas') = 10,
    format('b2 deveria ter 10 caixas, tem %s', jsonb_array_length(r -> 'caixas')));

  perform pg_temp.falha_com068(
    $q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'Décima primeira'))$q$,
    '22023');

  -- Apaga a caixa que tem Gabi; o cascade é conferido como dono.
  -- O id foi guardado antes, não escolhido pela posição na resposta.
  c_extra := current_setting('test068.caixa_b2')::uuid;
  perform public.apagar_caixa_pedido_v2(c_extra);
  perform set_config('test068.caixa_extra', c_extra::text, true);
end $$;

reset role;
do $$
begin
  perform pg_temp.ok068(
    not exists (
      select 1 from public.caixa_pedido_itens
       where caixa_id = current_setting('test068.caixa_extra')::uuid
    ),
    'apagar a caixa deveria apagar os itens'
  );
  perform pg_temp.ok068(
    not exists (select 1 from public.caixas_pedido
                 where id = current_setting('test068.caixa_extra')::uuid),
    'a caixa apagada não deveria existir'
  );
end $$;
set local role authenticated;

do $$
declare
  r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);

  -- b1 apaga as caixas 1 e 3 e confere que a 2 ficou.
  perform public.apagar_caixa_pedido_v2(current_setting('test068.caixa1')::uuid);
  perform public.apagar_caixa_pedido_v2(current_setting('test068.caixa3')::uuid);
  r := public.get_pedido_bolsas_v2();
  perform pg_temp.ok068(jsonb_array_length(r -> 'caixas') = 1, 'b1 deveria ficar com 1 caixa');
  perform pg_temp.ok068(pg_temp.caixa068(r, current_setting('test068.caixa2')::uuid) is not null,
    'a caixa 2 deveria continuar');
end $$;

-- ------------------------------------------------------------
-- BLOCO 6 — CPF em nome/nota: RPC, gatilho do dono, INSERT e UPDATE
-- ------------------------------------------------------------
reset role;
select set_config(
  'test068.boxes_antes',
  (select count(*)::text from public.caixas_pedido),
  true
);
set local role authenticated;

do $$
declare
  v_sample text;
  v_caixa uuid := current_setting('test068.caixa2')::uuid;
  v_ana uuid := '00000000-0000-4000-8000-000000068001';
begin
  -- Deixa a Ana na caixa 2 para os testes de nota.
  perform public.colocar_na_caixa_v2(v_caixa, v_ana);

  foreach v_sample in array array[
    'CPF 529 982 247 25',
    'CPF 529-982-247-25',
    'CPF 529.982.247/25',
    E'CPF 529     \n982     247     25'
  ] loop
    perform pg_temp.falha_com068(
      format($q$select public.salvar_caixa_pedido_v2(jsonb_build_object('nome', %L))$q$, v_sample),
      '22023');

    perform pg_temp.falha_com068(
      format($q$select public.editar_item_caixa_v2(%L::uuid, %L::uuid, null, %L)$q$,
        v_caixa, v_ana, v_sample),
      '22023');
  end loop;
end $$;

reset role;
do $$
begin
  perform pg_temp.ok068(
    (select count(*)::text from public.caixas_pedido) = current_setting('test068.boxes_antes'),
    'CPF no nome não pode criar caixa'
  );
end $$;

-- O gatilho barra o dono da tabela (não é só a RPC), no INSERT e no UPDATE.
do $$
declare
  v_sample text;
  v_caixa uuid := current_setting('test068.caixa2')::uuid;
  v_ana uuid := '00000000-0000-4000-8000-000000068001';
  v_gabi uuid := '00000000-0000-4000-8000-000000068007';
begin
  foreach v_sample in array array[
    'CPF 529 982 247 25',
    'CPF 529-982-247-25',
    'CPF 529.982.247/25',
    E'CPF 529     \n982     247     25'
  ] loop
    perform pg_temp.falha_com068(
      format($q$insert into public.caixas_pedido (nome) values (%L)$q$, v_sample),
      '23514');

    perform pg_temp.falha_com068(
      format($q$insert into public.caixa_pedido_itens (caixa_id, holder_id, nota)
               values (%L::uuid, %L::uuid, %L)$q$,
        v_caixa, v_gabi, v_sample),
      '23514');

    perform pg_temp.falha_com068(
      format($q$update public.caixas_pedido set nome = %L where id = %L::uuid$q$,
        v_sample, v_caixa),
      '23514');

    perform pg_temp.falha_com068(
      format($q$update public.caixa_pedido_itens set nota = %L
                where caixa_id = %L::uuid and holder_id = %L::uuid$q$,
        v_sample, v_caixa, v_ana),
      '23514');
  end loop;

  -- Um UPDATE limpo continua funcionando e a nota volta a ser nula.
  update public.caixa_pedido_itens set nota = 'nota limpa'
   where caixa_id = v_caixa and holder_id = v_ana;
  perform pg_temp.ok068(
    (select nota from public.caixa_pedido_itens
      where caixa_id = v_caixa and holder_id = v_ana) = 'nota limpa',
    'UPDATE de nota sem CPF deveria passar');
  update public.caixa_pedido_itens set nota = null
   where caixa_id = v_caixa and holder_id = v_ana;
end $$;

-- Agente e automação barrados como dono (prova de que o gatilho é de statement).
do $$
declare
  v_caixa uuid := current_setting('test068.caixa2')::uuid;
  v_holder uuid := '00000000-0000-4000-8000-000000068001';
begin
  -- Agente.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
  perform pg_temp.falha_com068(
    $q$insert into public.caixas_pedido (nome) values ('x')$q$, '42501');
  perform pg_temp.falha_com068(
    format($q$insert into public.bolsista_equipes (holder_id, equipe) values (%L::uuid, 'solos')$q$,
      v_holder),
    '42501');
  perform pg_temp.falha_com068(
    format($q$insert into public.caixa_pedido_itens (caixa_id, holder_id) values (%L::uuid, %L::uuid)$q$,
      v_caixa, v_holder),
    '42501');
  perform pg_temp.falha_com068(
    $q$update public.caixas_pedido set nome = nome where true$q$, '42501');
  perform pg_temp.falha_com068(
    $q$delete from public.caixa_pedido_itens where false$q$, '42501');
  perform pg_temp.falha_com068(
    $q$delete from public.bolsista_equipes where false$q$, '42501');

  -- Automação (Vigia).
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
  perform pg_temp.falha_com068(
    $q$insert into public.caixas_pedido (nome) values ('x')$q$, '42501');
  perform pg_temp.falha_com068(
    format($q$insert into public.bolsista_equipes (holder_id, equipe) values (%L::uuid, 'solos')$q$,
      v_holder),
    '42501');
  perform pg_temp.falha_com068(
    format($q$insert into public.caixa_pedido_itens (caixa_id, holder_id) values (%L::uuid, %L::uuid)$q$,
      v_caixa, v_holder),
    '42501');
  perform pg_temp.falha_com068(
    $q$update public.caixas_pedido set nome = nome where true$q$, '42501');
  perform pg_temp.falha_com068(
    $q$delete from public.caixa_pedido_itens where false$q$, '42501');
  perform pg_temp.falha_com068(
    $q$delete from public.bolsista_equipes where false$q$, '42501');

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
end $$;
set local role authenticated;

-- ------------------------------------------------------------
-- BLOCO 7 — contagem final e estado das equipes
-- ------------------------------------------------------------
do $$
declare
  r jsonb;
  p jsonb;
  cx jsonb;
  c2 uuid := current_setting('test068.caixa2')::uuid;
begin
  r := public.get_pedido_bolsas_v2();
  p := pg_temp.pessoa068(r, 'Ana Pastagem');
  perform pg_temp.ok068(p ->> 'equipe' = 'solos', 'Ana deveria ter ficado em solos');

  p := pg_temp.pessoa068(r, 'Gabi Dois Centros');
  perform pg_temp.ok068(p ->> 'equipe' = 'alertas', 'Gabi deveria estar em alertas');

  -- b1 ficou só com a caixa 2, com Ana (o Bruno estava na caixa 1, apagada).
  perform pg_temp.ok068(jsonb_array_length(r -> 'caixas') = 1, 'b1 deveria ter 1 caixa no fim');
  cx := pg_temp.caixa068(r, c2);
  perform pg_temp.ok068((cx ->> 'pessoas')::integer = 1, 'caixa 2 deveria ter 1 pessoa no fim');
  perform pg_temp.ok068((cx ->> 'total_mensal')::numeric = 4000,
    'caixa 2 deveria somar 4000 no fim');
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
rollback;
