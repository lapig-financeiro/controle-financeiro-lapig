-- ============================================================
-- Roteiro de conferência da migração 063 (F1-A — banco da fase 1)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-063-pglite.mjs
-- Antes da 063, o BLOCO 1 falha (as tabelas/RPCs não existem).
--
-- Identidades dos stubs:
--   a1 = admin ('Victor')
--   b1 = professor A, escopo 51.X + 63.INAT ('Professor do projeto')
--   b2 = professor B, escopo 51.Y ('Prof. Bruno')
--   e1 = professor C, escopo 51.Y ('Arthur Pietro')
--   c1 = agente (Buriti), escopo 51.X ('Buriti Agente')
--   d1 = automação (Vigia), sem centros
-- ============================================================
\set ON_ERROR_STOP on

create or replace function pg_temp.ok(p boolean, p_motivo text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception '063 FALHOU: %', p_motivo;
  end if;
end $$;

create or replace function pg_temp.falha_com(p_sql text, p_code text, p_msg_like text default null) returns void language plpgsql as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if p_code is not null and v_state <> p_code then
      raise exception '063 FALHOU: esperado SQLSTATE %, veio % (%): %', p_code, v_state, v_msg, p_sql;
    end if;
    if p_msg_like is not null and v_msg not like p_msg_like then
      raise exception '063 FALHOU: mensagem "%" não casa com "%": %', v_msg, p_msg_like, p_sql;
    end if;
    return;
  end;
  raise exception '063 FALHOU: operação deveria falhar mas passou: %', p_sql;
end $$;

begin;

select set_config('test063.x',    (select id::text from public.projects where code = '51.X'), true);
select set_config('test063.y',    (select id::text from public.projects where code = '51.Y'), true);
select set_config('test063.sb',   (select id::text from public.projects where code = '63.SB'), true);
select set_config('test063.sp',   (select id::text from public.projects where code = '63.SP'), true);
select set_config('test063.def',  (select id::text from public.projects where code = '63.DEF'), true);
select set_config('test063.inat', (select id::text from public.projects where code = '63.INAT'), true);

-- ------------------------------------------------------------
-- BLOCO 1 — criar_pendencia_v2, idempotência, CPF, recência e isolamento SELECT
-- ------------------------------------------------------------
-- Professor A (b1), agente (c1) e automação (d1) não criam pendências.
do $$
declare
  x text := current_setting('test063.x');
  u text;
begin
  foreach u in array array[
    '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000d1'
  ] loop
    perform set_config('request.jwt.claim.sub', u, true);
    set local role authenticated;
    perform pg_temp.falha_com(
      format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
        jsonb_build_object('chave', 'outro:51.X:nao-pode', 'project_id', x, 'tipo', 'outro', 'titulo', 'Teste')::text),
      '42501'
    );
    reset role;
  end loop;
end $$;

-- Item 14: get_filtro_visao_v2 de admin sem linha devolve [] (não null), antes de qualquer set.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  fv jsonb := public.get_filtro_visao_v2();
begin
  perform pg_temp.ok(
    jsonb_typeof(fv -> 'centros_ocultos') = 'array'
    and jsonb_array_length(fv -> 'centros_ocultos') = 0,
    'get_filtro_visao_v2 de admin sem linha devolve [] (não null)'
  );
end $$;

-- Admin (a1): validações, criação, atualização de aberta, conflitos e não reabertura de resolvida.
do $$
declare
  x    uuid := current_setting('test063.x')::uuid;
  y    uuid := current_setting('test063.y')::uuid;
  inat uuid := current_setting('test063.inat')::uuid;
  r1   jsonb;
  r2   jsonb;
  r_x2 jsonb;
  r_x3 jsonb;
  r_y  jsonb;
  r_g  jsonb;
  v_st text;
  v_mg text;
begin
  -- Chave desconhecida no payload é recusada
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:51.X:k1', 'project_id', x, 'tipo', 'outro', 'titulo', 'Ok', 'extra', 1)::text),
    '22023'
  );

  -- Projeto inativo é recusado (22023)
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:63.INAT:inat', 'project_id', inat, 'tipo', 'outro', 'titulo', 'Inativo')::text),
    '22023'
  );

  -- UUID inválido falha com 22023 sem ecoar o payload
  begin
    perform public.criar_pendencia_v2(jsonb_build_object(
      'chave', 'outro:51.X:uuid-ruim', 'project_id', 'invalido-52998224725', 'tipo', 'outro', 'titulo', 'Teste'
    ));
    raise exception '063 FALHOU: project_id inválido foi aceito';
  exception when others then
    get stacked diagnostics v_st = returned_sqlstate, v_mg = message_text;
    perform pg_temp.ok(v_st = '22023' and position('invalido-52998224725' in v_mg) = 0,
      'project_id inválido falha com 22023 sem ecoar o payload');
  end;

  -- detalhe precisa ser objeto JSON (nulo -> '{}')
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:51.X:det-arr', 'project_id', x, 'tipo', 'outro', 'titulo', 'Det array', 'detalhe', '[1,2]'::jsonb)::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:51.X:det-txt', 'project_id', x, 'tipo', 'outro', 'titulo', 'Det texto', 'detalhe', 'texto')::text),
    '22023'
  );

  -- CPF em título, chave ou detalhe é recusado (52998224725 é CPF de teste válido no DV)
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:51.X:cpf1', 'project_id', x, 'tipo', 'outro', 'titulo', 'Bolsista 529.982.247-25 sem plano')::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'bolsas:51.X:52998224725', 'project_id', x, 'tipo', 'bolsas', 'titulo', 'Duplicidade')::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:51.X:cpf3', 'project_id', x, 'tipo', 'outro', 'titulo', 'Sem CPF no título',
        'detalhe', jsonb_build_object('doc', '529.982.247-25'))::text),
    '22023'
  );

  -- Cria em 51.X e repete com mesma chave: não duplica, atualiza título/detalhe e retorna criada=false
  r1 := public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'balancete:51.X:conta-sem-rubrica:2026-10',
    'project_id', x,
    'tipo', 'balancete',
    'titulo', 'Conta sem rubrica (inicial)',
    'detalhe', null,
    'origem', 'sistema'
  ));
  perform pg_temp.ok((r1 ->> 'criada')::boolean = true and r1 ->> 'situacao' = 'aberta', 'criou pendência 1 com detalhe null -> {}');

  r2 := public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'balancete:51.X:conta-sem-rubrica:2026-10',
    'project_id', x,
    'tipo', 'balancete',
    'titulo', 'Conta sem rubrica (atualizada)',
    'detalhe', jsonb_build_object('conta', '7.1.3.99.01', 'saldo', 1107372.93, 'qtd', 2),
    'origem', 'sistema'
  ));
  perform pg_temp.ok(
    (r2 ->> 'criada')::boolean = false and r2 ->> 'id' = r1 ->> 'id' and r2 ->> 'situacao' = 'aberta',
    'repetir chave aberta não duplica e devolve criada=false'
  );
  perform pg_temp.ok(
    (select count(*) = 1 and max(titulo) = 'Conta sem rubrica (atualizada)'
       and max(detalhe ->> 'qtd') = '2'
       from public.pendencias where chave = 'balancete:51.X:conta-sem-rubrica:2026-10'),
    'aberta teve título e detalhe atualizados sem duplicar'
  );

  -- Mesma chave com project_id ou tipo diferente é recusada (22023)
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'balancete:51.X:conta-sem-rubrica:2026-10', 'project_id', y, 'tipo', 'balancete', 'titulo', 'Outro centro')::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'balancete:51.X:conta-sem-rubrica:2026-10', 'project_id', x, 'tipo', 'plano', 'titulo', 'Outro tipo')::text),
    '22023'
  );

  -- Cria outra em 51.X, resolve e tenta recriar pela mesma chave -> NÃO reabre; e conflito de tipo/centro também falha
  r_x2 := public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'plano:51.X:fechada-nao-reabre',
    'project_id', x,
    'tipo', 'plano',
    'titulo', 'Título original resolvido',
    'detalhe', jsonb_build_object('v', 1)
  ));
  perform public.resolver_pendencia_v2((r_x2 ->> 'id')::uuid, 'resolvida');

  r_x3 := public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'plano:51.X:fechada-nao-reabre',
    'project_id', x,
    'tipo', 'plano',
    'titulo', 'Tentativa de reabrir',
    'detalhe', jsonb_build_object('v', 2)
  ));
  perform pg_temp.ok(
    (r_x3 ->> 'criada')::boolean = false
    and r_x3 ->> 'id' = r_x2 ->> 'id'
    and r_x3 ->> 'situacao' = 'resolvida',
    'pendência resolvida não reabre por upsert'
  );
  perform pg_temp.ok(
    (select titulo = 'Título original resolvido' from public.pendencias where id = (r_x2 ->> 'id')::uuid),
    'pendência resolvida manteve título original'
  );
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'plano:51.X:fechada-nao-reabre', 'project_id', y, 'tipo', 'plano', 'titulo', 'Conflito')::text),
    '22023'
  );

  -- Cria em 51.Y e uma pendência geral (sem centro)
  r_y := public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'bolsas:51.Y:revisao:2026',
    'project_id', y,
    'tipo', 'bolsas',
    'titulo', 'Revisar bolsa encerrada em 51.Y',
    'origem', 'buriti'
  ));
  perform pg_temp.ok((r_y ->> 'criada')::boolean = true, 'criou pendência em 51.Y');

  r_g := public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'cadastro:geral:dois-planos:2026',
    'project_id', null,
    'tipo', 'cadastro',
    'titulo', 'Mesmo bolsista em dois planos distintos',
    'origem', 'claude'
  ));
  perform pg_temp.ok((r_g ->> 'criada')::boolean = true, 'criou pendência geral sem centro');

  perform set_config('test063.px1', r1 ->> 'id', true);
  perform set_config('test063.py1', r_y ->> 'id', true);
  perform set_config('test063.pg1', r_g ->> 'id', true);
end $$;

reset role;

-- Insere via superuser casos de recência e de centro inativo:
--   • aberta antiga (120d) em 51.X (aparece)
--   • resolvida há 91d em 51.X (fica fora)
--   • criada há 200d e resolvida há 5d em 51.X (aparece - item 12)
--   • aberta e resolvida em 63.INAT (só a aberta aparece para admin; nenhuma para b1 - itens 4 e 15)
do $$
declare
  x    uuid := current_setting('test063.x')::uuid;
  inat uuid := current_setting('test063.inat')::uuid;
  v_old_open uuid;
begin
  insert into public.pendencias (chave, project_id, tipo, titulo, situacao, origem, criada_em)
  values ('contrato:51.X:antiga-aberta', x, 'contrato', 'Pendência aberta há 120 dias', 'aberta', 'sistema', now() - interval '120 days')
  returning id into v_old_open;

  insert into public.pendencias (chave, project_id, tipo, titulo, situacao, origem, criada_em, resolvida_em)
  values ('contrato:51.X:antiga-resolvida', x, 'contrato', 'Resolvida há 91 dias', 'resolvida', 'sistema', now() - interval '100 days', now() - interval '91 days');

  insert into public.pendencias (chave, project_id, tipo, titulo, situacao, origem, criada_em, resolvida_em)
  values ('contrato:51.X:200d-res5d', x, 'contrato', 'Criada há 200d, resolvida há 5d', 'resolvida', 'sistema', now() - interval '200 days', now() - interval '5 days');

  insert into public.pendencias (chave, project_id, tipo, titulo, situacao, origem, criada_em)
  values ('outro:63.INAT:aberta', inat, 'outro', 'Aberta de centro inativo', 'aberta', 'sistema', now() - interval '10 days');

  insert into public.pendencias (chave, project_id, tipo, titulo, situacao, origem, criada_em, resolvida_em)
  values ('outro:63.INAT:resolvida', inat, 'outro', 'Resolvida de centro inativo', 'resolvida', 'sistema', now() - interval '10 days', now() - interval '2 days');

  perform set_config('test063.px_old_open', v_old_open::text, true);
end $$;

-- Professor A (b1): vê só 51.X (abertas primeiro, incluindo a de 200d resolvida há 5d; sem inativo, sem 91d, sem 51.Y, sem geral).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;

do $$
declare
  x    uuid := current_setting('test063.x')::uuid;
  y    uuid := current_setting('test063.y')::uuid;
  inat uuid := current_setting('test063.inat')::uuid;
  l    jsonb;
  lx   jsonb;
begin
  perform pg_temp.ok(
    not exists (select 1 from public.pendencias where project_id = y or project_id is null),
    'professor A não lê pendência de 51.Y nem sem centro na tabela'
  );
  perform pg_temp.ok(
    exists (select 1 from public.pendencias where project_id = x),
    'professor A lê pendência do próprio centro na tabela'
  );

  l := public.listar_pendencias_v2();
  perform pg_temp.ok(
    jsonb_array_length(l) = 4
    and (l -> 0 ->> 'situacao') = 'aberta'
    and (l -> 1 ->> 'situacao') = 'aberta'
    and (l -> 2 ->> 'situacao') = 'resolvida'
    and (l -> 3 ->> 'situacao') = 'resolvida'
    and exists (select 1 from jsonb_array_elements(l) el where el ->> 'titulo' = 'Criada há 200d, resolvida há 5d'),
    'professor A vê 2 abertas + 2 resolvidas recentes (incl. criada 200d/resolvida 5d), sem 91d nem 63.INAT'
  );
  perform pg_temp.ok(
    not exists (
      select 1 from jsonb_array_elements(l) el
       where el ->> 'project_id' in (y::text, inat::text)
          or el -> 'project_id' = 'null'::jsonb
          or el ->> 'titulo' = 'Resolvida há 91 dias'
    ),
    'listar_pendencias_v2() de b1 não vaza 51.Y, 63.INAT, geral nem resolvida > 90d'
  );

  -- Item 11: caso positivo de listar_pendencias_v2(<centro>) para professor
  lx := public.listar_pendencias_v2(x);
  perform pg_temp.ok(
    jsonb_array_length(lx) = 4
    and not exists (
      select 1 from jsonb_array_elements(lx) el
       where el ->> 'project_id' is distinct from x::text
          or el ->> 'code' is distinct from '51.X'
    )
    and exists (select 1 from jsonb_array_elements(lx) el where el ->> 'titulo' = 'Criada há 200d, resolvida há 5d'),
    'listar_pendencias_v2(x) devolve apenas as 4 pendências válidas de 51.X para b1'
  );

  perform pg_temp.falha_com(format('select public.listar_pendencias_v2(%L::uuid)', y), null, 'Acesso negado%');
end $$;

reset role;

-- Professor B (b2): vê só 51.Y (geral e por centro). Admin (a1): vê abertas (incl. geral e 63.INAT aberta) + resolvidas recentes.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
set local role authenticated;
select pg_temp.ok(
  jsonb_array_length(public.listar_pendencias_v2()) = 1
  and (public.listar_pendencias_v2() -> 0 ->> 'project_id') = current_setting('test063.y')
  and jsonb_array_length(public.listar_pendencias_v2(current_setting('test063.y')::uuid)) = 1
  and (public.listar_pendencias_v2(current_setting('test063.y')::uuid) -> 0 ->> 'code') = '51.Y',
  'professor B vê só a pendência de 51.Y (geral e com p_project_id)'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  l jsonb := public.listar_pendencias_v2();
begin
  perform pg_temp.ok(
    jsonb_array_length(l) = 7
    and exists (select 1 from jsonb_array_elements(l) el where el -> 'project_id' = 'null'::jsonb)
    and exists (select 1 from jsonb_array_elements(l) el where el ->> 'titulo' = 'Aberta de centro inativo')
    and not exists (select 1 from jsonb_array_elements(l) el where el ->> 'titulo' = 'Resolvida de centro inativo')
    and exists (select 1 from jsonb_array_elements(l) el where el ->> 'titulo' = 'Criada há 200d, resolvida há 5d'),
    'admin vê 7 pendências (5 abertas incl. sem centro e inativo aberto + 2 resolvidas recentes; exclui 91d e inativo fechado)'
  );
  perform pg_temp.ok(
    (l -> 0 ->> 'situacao') = 'aberta'
    and (l -> 4 ->> 'situacao') = 'aberta'
    and (l -> 5 ->> 'situacao') = 'resolvida'
    and (l -> 6 ->> 'situacao') = 'resolvida',
    'abertas vêm antes das resolvidas'
  );
end $$;
reset role;

do $$ begin raise notice 'BLOCO 1 ok: criação, conflitos, CPF, recência 90d, inativo e isolamento por centro'; end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — Escrita direta bloqueada em pendencias e filtro_visao + gatilho de CPF
-- ------------------------------------------------------------
do $$
begin
  perform pg_temp.ok(
    exists (
      select 1 from pg_trigger t
       where t.tgrelid = 'public.pendencias'::regclass
         and t.tgname = 'trg_bloqueia_agente'
         and t.tgqual is null
         and (t.tgtype & 1) = 0 and (t.tgtype & 2) <> 0 and (t.tgtype & (4|8|16)) = (4|8|16)
    ) and exists (
      select 1 from pg_trigger t
       where t.tgrelid = 'public.pendencias'::regclass
         and t.tgname = 'trg_pendencias_sem_cpf'
         and (t.tgtype & 1) <> 0 and (t.tgtype & 2) <> 0 and (t.tgtype & (4|16)) = (4|16)
    ) and exists (
      select 1 from pg_trigger t
       where t.tgrelid = 'public.filtro_visao'::regclass
         and t.tgname = 'trg_bloqueia_agente'
         and t.tgqual is null
         and (t.tgtype & 1) = 0 and (t.tgtype & 2) <> 0 and (t.tgtype & (4|8|16)) = (4|8|16)
    ),
    'gatilhos trg_bloqueia_agente e trg_pendencias_sem_cpf presentes no catálogo'
  );
end $$;

-- ACL de produção: professor A falha com 42501 em insert, update e delete em pendencias.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x text := current_setting('test063.x');
begin
  perform pg_temp.falha_com(
    format($q$insert into public.pendencias (chave, project_id, tipo, titulo) values ('outro:51.X:acl', %L::uuid, 'outro', 'X')$q$, x),
    '42501'
  );
  perform pg_temp.falha_com($q$update public.pendencias set titulo = 'hack'$q$, '42501');
  perform pg_temp.falha_com($q$delete from public.pendencias$q$, '42501');
end $$;
reset role;

-- Com grant temporário de teste:
--   • professor: insert 42501 (RLS), update/delete row_count=0
--   • agente: insert/update/delete bloqueados por trg_bloqueia_agente (051)
--   • admin: insert direto com CPF barrado por trg_pendencias_sem_cpf (23514) antes do RLS
grant insert, update, delete on public.pendencias to authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x text := current_setting('test063.x');
  n int;
begin
  perform pg_temp.falha_com(
    format($q$insert into public.pendencias (chave, project_id, tipo, titulo) values ('outro:51.X:rls', %L::uuid, 'outro', 'X')$q$, x),
    '42501'
  );
  update public.pendencias set titulo = 'alterado';
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'update direto em pendencias por professor atinge 0 linhas');

  delete from public.pendencias;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'delete direto em pendencias por professor atinge 0 linhas');
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set local role authenticated;
do $$
declare
  x text := current_setting('test063.x');
begin
  perform pg_temp.falha_com(
    format($q$insert into public.pendencias (chave, project_id, tipo, titulo) values ('outro:51.X:ag', %L::uuid, 'outro', 'X')$q$, x),
    '42501', 'O agente não grava em pendencias%'
  );
  perform pg_temp.falha_com($q$update public.pendencias set titulo = 'ag'$q$, '42501', 'O agente não grava em pendencias%');
  perform pg_temp.falha_com($q$delete from public.pendencias$q$, '42501', 'O agente não grava em pendencias%');
end $$;
reset role;

-- Item 15: gatilho de CPF na tabela barra escrita direta com CPF (admin e superuser update)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x text := current_setting('test063.x');
begin
  perform pg_temp.falha_com(
    format($q$insert into public.pendencias (chave, project_id, tipo, titulo) values ('outro:51.X:cpf-trig', %L::uuid, 'outro', 'Bolsista 529.982.247-25')$q$, x),
    '23514', 'Pendência com CPF%'
  );
end $$;
reset role;

select pg_temp.falha_com(
  format($q$update public.pendencias set detalhe = '{"cpf":"52998224725"}'::jsonb where id = %L::uuid$q$, current_setting('test063.px1')),
  '23514', 'Pendência com CPF%'
);

revoke insert, update, delete on public.pendencias from authenticated;

-- Item 10: Admin grava linha em filtro_visao ANTES da tentativa do professor; linha sobrevive intacta.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
select public.set_filtro_visao_v2(array[current_setting('test063.y')::uuid]);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  n int;
begin
  perform pg_temp.ok((select count(*) = 0 from public.filtro_visao), 'professor vê 0 linhas em filtro_visao');
  perform pg_temp.falha_com(
    $q$insert into public.filtro_visao (user_id, centros_ocultos) values ('00000000-0000-0000-0000-0000000000b1', '{}')$q$,
    '42501'
  );
  update public.filtro_visao set centros_ocultos = '{}';
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'update direto em filtro_visao por professor atinge 0 linhas');
  delete from public.filtro_visao;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'delete direto em filtro_visao por professor atinge 0 linhas');
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set local role authenticated;
do $$
begin
  perform pg_temp.falha_com(
    $q$insert into public.filtro_visao (user_id, centros_ocultos) values ('00000000-0000-0000-0000-0000000000c1', '{}')$q$,
    '42501', 'O agente não grava em filtro_visao%'
  );
  perform pg_temp.falha_com($q$update public.filtro_visao set centros_ocultos = '{}'$q$, '42501', 'O agente não grava em filtro_visao%');
  perform pg_temp.falha_com($q$delete from public.filtro_visao$q$, '42501', 'O agente não grava em filtro_visao%');
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  y uuid := current_setting('test063.y')::uuid;
begin
  perform pg_temp.ok(
    (public.get_filtro_visao_v2() -> 'centros_ocultos' ->> 0) = y::text
    and jsonb_array_length(public.get_filtro_visao_v2() -> 'centros_ocultos') = 1,
    'linha do admin em filtro_visao sobreviveu intacta às tentativas do professor e agente'
  );
  perform public.set_filtro_visao_v2('{}'::uuid[]);
end $$;
reset role;

do $$ begin raise notice 'BLOCO 2 ok: escrita direta bloqueada, linha do admin preservada e gatilho de CPF'; end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — resolver_pendencia_v2 (escopo, sem oráculo, transições, idempotência)
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set local role authenticated;
select pg_temp.falha_com(
  format($q$select public.resolver_pendencia_v2(%L::uuid, 'resolvida')$q$, current_setting('test063.px1')),
  '42501'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  px1 uuid := current_setting('test063.px1')::uuid;
  py1 uuid := current_setting('test063.py1')::uuid;
  pg1 uuid := current_setting('test063.pg1')::uuid;
  res jsonb;
  s_inex text; m_inex text;
  s_alh  text; m_alh  text;
  s_ger  text; m_ger  text;
begin
  -- Item 15 (5): id inexistente, centro alheio e pendência geral devolvem exatamente o mesmo erro (sem oráculo)
  begin
    perform public.resolver_pendencia_v2('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'resolvida');
    raise exception '063 FALHOU: id inexistente passou';
  exception when others then
    get stacked diagnostics s_inex = returned_sqlstate, m_inex = message_text;
  end;
  begin
    perform public.resolver_pendencia_v2(py1, 'resolvida');
    raise exception '063 FALHOU: centro alheio passou';
  exception when others then
    get stacked diagnostics s_alh = returned_sqlstate, m_alh = message_text;
  end;
  begin
    perform public.resolver_pendencia_v2(pg1, 'resolvida');
    raise exception '063 FALHOU: pendência geral por professor passou';
  exception when others then
    get stacked diagnostics s_ger = returned_sqlstate, m_ger = message_text;
  end;
  perform pg_temp.ok(
    s_inex = '42501' and s_alh = '42501' and s_ger = '42501'
    and m_inex = m_alh and m_inex = m_ger,
    'resolver_pendencia_v2 devolve o mesmo erro/SQLSTATE para inexistente, centro alheio e sem centro'
  );

  perform pg_temp.falha_com(format($q$select public.resolver_pendencia_v2(%L::uuid, 'aberta')$q$, px1), '22023');

  -- Professor resolve pendência do próprio centro; repetir mesma situação é idempotente; trocar é erro
  res := public.resolver_pendencia_v2(px1, 'resolvida');
  perform pg_temp.ok(res ->> 'id' = px1::text and res ->> 'situacao' = 'resolvida', 'b1 resolveu px1');

  res := public.resolver_pendencia_v2(px1, 'resolvida');
  perform pg_temp.ok(res ->> 'situacao' = 'resolvida', 'repetir resolvida devolve estado atual');

  perform pg_temp.falha_com(format($q$select public.resolver_pendencia_v2(%L::uuid, 'descartada')$q$, px1), '22023');
end $$;
reset role;

-- Conferir resolvida_em e resolvida_por gravados
select pg_temp.ok(
  (select situacao = 'resolvida' and resolvida_em is not null
      and resolvida_por = '00000000-0000-0000-0000-0000000000b1'::uuid
     from public.pendencias where id = current_setting('test063.px1')::uuid),
  'resolvida_em e resolvida_por gravados corretamente'
);

-- Admin oculta 51.Y no filtro e ainda consegue descartar py1; resolve também pg1 e px_old_open.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  y    uuid := current_setting('test063.y')::uuid;
  py1  uuid := current_setting('test063.py1')::uuid;
  pg1  uuid := current_setting('test063.pg1')::uuid;
  pxo  uuid := current_setting('test063.px_old_open')::uuid;
  res  jsonb;
begin
  perform public.set_filtro_visao_v2(array[y]);
  res := public.resolver_pendencia_v2(py1, 'descartada');
  perform pg_temp.ok(res ->> 'situacao' = 'descartada', 'admin descarta pendência mesmo com centro oculto no filtro');
  perform pg_temp.falha_com(format($q$select public.resolver_pendencia_v2(%L::uuid, 'resolvida')$q$, py1), '22023');

  res := public.resolver_pendencia_v2(pg1, 'resolvida');
  perform pg_temp.ok(res ->> 'situacao' = 'resolvida', 'admin resolve pendência sem centro');

  perform public.resolver_pendencia_v2(pxo, 'descartada');
  perform public.set_filtro_visao_v2('{}'::uuid[]);
end $$;
reset role;

do $$ begin raise notice 'BLOCO 3 ok: resolver_pendencia_v2, sem oráculo, transições e independência do filtro'; end $$;

-- ------------------------------------------------------------
-- BLOCO 4 — filtro_visao (só admin, normalização, ocultos, getter guardado, pendência sem centro)
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  y uuid := current_setting('test063.y')::uuid;
begin
  perform public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'bolsas:51.Y:filtro-teste:2026', 'project_id', y, 'tipo', 'bolsas', 'titulo', 'Aberta em 51.Y para filtro'
  ));
  perform public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'outro:geral:filtro-teste:2026', 'project_id', null, 'tipo', 'outro', 'titulo', 'Geral aberta sempre visível'
  ));
end $$;
reset role;

-- Professor chamando set_filtro_visao_v2 recebe erro 42501.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  y uuid := current_setting('test063.y')::uuid;
begin
  perform pg_temp.falha_com(format($q$select public.set_filtro_visao_v2(array[%L::uuid])$q$, y), '42501');
  perform pg_temp.ok(public.get_filtro_visao_v2() -> 'centros_ocultos' = '[]'::jsonb, 'get_filtro_visao_v2 de professor devolve []');
end $$;
reset role;

-- Admin: oculta 1 centro (normalizando); depois oculta 2; depois limpa.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  y    uuid := current_setting('test063.y')::uuid;
  sb   uuid := current_setting('test063.sb')::uuid;
  inat uuid := current_setting('test063.inat')::uuid;
  f1   jsonb;
  f2   jsonb;
  res  jsonb;
  pnd  jsonb;
begin
  f1 := public.set_filtro_visao_v2(array[y, null, y, '99999999-9999-9999-9999-999999999999'::uuid, inat]);
  perform pg_temp.ok(
    jsonb_array_length(f1 -> 'centros_ocultos') = 1
    and (f1 -> 'centros_ocultos' ->> 0) = y::text,
    'set_filtro_visao_v2 normalizou null, duplicata, inexistente e inativo'
  );
  perform pg_temp.ok(public.get_filtro_visao_v2() = f1, 'get_filtro_visao_v2 devolve o gravado');

  res := public.resumo_projetos_v2();
  perform pg_temp.ok((res ->> 'ocultos')::int = 1, 'ocultos = 1 após ocultar 51.Y');
  perform pg_temp.ok(
    jsonb_array_length(res -> 'centros') = 4 and jsonb_array_length(res -> 'todos') = 5,
    '5 ativos no total (63.INAT excluído), 4 visíveis em centros'
  );
  perform pg_temp.ok(
    not exists (select 1 from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = y::text),
    '51.Y ausente de centros quando oculto'
  );
  perform pg_temp.ok(
    exists (select 1 from jsonb_array_elements(res -> 'todos') t where t ->> 'id' = y::text and (t ->> 'oculto')::boolean = true),
    '51.Y presente em todos com oculto = true'
  );

  pnd := public.listar_pendencias_v2();
  perform pg_temp.ok(
    not exists (select 1 from jsonb_array_elements(pnd) pe where pe ->> 'project_id' = y::text)
    and exists (select 1 from jsonb_array_elements(pnd) pe where pe -> 'project_id' = 'null'::jsonb),
    'listar_pendencias_v2 sem project_id omite centro oculto mas mantém pendência sem centro'
  );

  f2 := public.set_filtro_visao_v2(array[y, sb]);
  res := public.resumo_projetos_v2();
  perform pg_temp.ok(
    jsonb_array_length(f2 -> 'centros_ocultos') = 2
    and (res ->> 'ocultos')::int = 2
    and jsonb_array_length(res -> 'centros') = 3
    and not exists (select 1 from jsonb_array_elements(res -> 'centros') c where c ->> 'id' in (y::text, sb::text)),
    'ocultar 2 centros mantém o 1º oculto e reduz centros para 3'
  );

  -- Item 13: grava direto como admin ocultando 63.SB, desativa 63.SB e garante que get_filtro_visao_v2 devolve a lista guardada
  insert into public.filtro_visao (user_id, centros_ocultos)
  values (auth.uid(), array[sb])
  on conflict (user_id) do update
     set centros_ocultos = excluded.centros_ocultos;
end $$;
reset role;

update public.projects set active = false where id = current_setting('test063.sb')::uuid;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  sb  uuid := current_setting('test063.sb')::uuid;
  fv  jsonb := public.get_filtro_visao_v2();
  res jsonb := public.resumo_projetos_v2();
begin
  perform pg_temp.ok(
    jsonb_array_length(fv -> 'centros_ocultos') = 1
    and (fv -> 'centros_ocultos' ->> 0) = sb::text,
    'get_filtro_visao_v2 devolve a lista guardada mesmo após desativar centro oculto'
  );
  perform pg_temp.ok(
    (res ->> 'ocultos')::int = 0
    and not exists (select 1 from jsonb_array_elements(res -> 'todos') t where t ->> 'id' = sb::text),
    'centro desativado sai de todos e não infla ocultos'
  );
end $$;
reset role;

update public.projects set active = true where id = current_setting('test063.sb')::uuid;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
select public.set_filtro_visao_v2('{}'::uuid[]);
reset role;

do $$ begin raise notice 'BLOCO 4 ok: filtro de visão exclusivo do admin, normalização, ocultos e getter guardado'; end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — resumo_projetos_v2 (estados, valores reais de get_saldo_livre, falha e cast quebrado)
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x    uuid := current_setting('test063.x')::uuid;
  y    uuid := current_setting('test063.y')::uuid;
  sb   uuid := current_setting('test063.sb')::uuid;
  sp   uuid := current_setting('test063.sp')::uuid;
  def  uuid := current_setting('test063.def')::uuid;
  inat uuid := current_setting('test063.inat')::uuid;
  res  jsonb;
  sl_x jsonb;
  sl_y jsonb;
  cx   jsonb;
  cy   jsonb;
  csb  jsonb;
  csp  jsonb;
  cdef jsonb;
  sum_x numeric;
  sum_y numeric;
begin
  res  := public.resumo_projetos_v2();
  sl_x := public.get_saldo_livre(x);
  sl_y := public.get_saldo_livre(y);

  select sum((g ->> 'saldo_livre')::numeric) into sum_x from jsonb_array_elements(sl_x -> 'grupos') g;
  select sum((g ->> 'saldo_livre')::numeric) into sum_y from jsonb_array_elements(sl_y -> 'grupos') g;

  select c into cx   from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = x::text;
  select c into cy   from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = y::text;
  select c into csb  from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = sb::text;
  select c into csp  from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = sp::text;
  select c into cdef from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = def::text;

  perform pg_temp.ok(
    not exists (select 1 from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = inat::text)
    and not exists (select 1 from jsonb_array_elements(res -> 'todos') t where t ->> 'id' = inat::text),
    'projeto inativo fica fora de centros e todos'
  );

  perform pg_temp.ok(
    cx ->> 'situacao' = 'em dia'
    and (cx ->> 'livre')::numeric = sum_x
    and cx ->> 'drive_folder_url' = 'https://drive.google.com/drive/folders/stub-51x'
    and (cx ->> 'pendencias_abertas')::int = 0
    and cx -> 'erro' = 'null'::jsonb
    and cx -> 'responsaveis' = '["Professor do projeto"]'::jsonb,
    '51.X em dia bate com get_saldo_livre e traz só professores (sem agente)'
  );

  perform pg_temp.ok(
    cy ->> 'situacao' = 'problema'
    and (cy ->> 'livre')::numeric = sum_y
    and cy -> 'responsaveis' = '["Arthur Pietro", "Prof. Bruno"]'::jsonb,
    '51.Y problema por grupo negativo real + responsáveis em ordem alfabética'
  );

  perform pg_temp.ok(
    csb ->> 'situacao' = 'sem balancete' and csb -> 'livre' = 'null'::jsonb,
    '63.SB sem balancete e livre = null'
  );
  perform pg_temp.ok(
    csp ->> 'situacao' = 'sem plano' and csp -> 'livre' = 'null'::jsonb,
    '63.SP sem plano e livre = null'
  );
  perform pg_temp.ok(
    cdef ->> 'situacao' = 'atenção',
    '63.DEF em atenção por defasagem >= 2'
  );

  -- Pendência aberta em 51.X muda situação para atenção
  perform public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'balancete:51.X:abre-atencao:2026', 'project_id', x, 'tipo', 'balancete', 'titulo', 'Conferir lançamento'
  ));
  res := public.resumo_projetos_v2();
  select c into cx from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = x::text;
  perform pg_temp.ok(
    cx ->> 'situacao' = 'atenção' and (cx ->> 'pendencias_abertas')::int = 1,
    '51.X com pendência aberta vira atenção'
  );
end $$;
reset role;

-- Professor A (b1): vê só 51.X (sem inativo 63.INAT), drive_folder_url = null, responsaveis = [], todos = [], ocultos = 0.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  res jsonb := public.resumo_projetos_v2();
  cx  jsonb;
begin
  perform pg_temp.ok(
    jsonb_array_length(res -> 'centros') = 1
    and (res ->> 'ocultos')::int = 0
    and res -> 'todos' = '[]'::jsonb,
    'professor A vê só 1 centro ativo, ocultos=0 e todos=[]'
  );
  cx := res -> 'centros' -> 0;
  perform pg_temp.ok(
    cx ->> 'id' = current_setting('test063.x')
    and cx -> 'drive_folder_url' = 'null'::jsonb
    and cx -> 'responsaveis' = '[]'::jsonb,
    'professor recebe drive_folder_url=null e responsaveis=[]'
  );
end $$;
reset role;

-- Falha de get_saldo_livre (exceção no 51.X + cast quebrado no 63.DEF): ambos viram 'sem dado' sem vazar SQLERRM; outros intactos.
alter function public.get_saldo_livre(uuid) rename to _get_saldo_livre_real_063;
create function public.get_saldo_livre(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sentinela uuid := (select id from public.projects where code = '51.X');
  v_quebrado  uuid := (select id from public.projects where code = '63.DEF');
begin
  if p_project_id = v_sentinela then
    raise exception 'Detalhe interno secreto XYZ-999';
  end if;
  if p_project_id = v_quebrado then
    return '{"has_plano": true, "has_balancete": true, "data_referencia": "data-invalida", "balancete_defasagem_meses": "nao-int", "grupos": [{"saldo_livre": "nao-num"}]}'::jsonb;
  end if;
  return public._get_saldo_livre_real_063(p_project_id);
end $$;
revoke all on function public.get_saldo_livre(uuid) from public, anon;
grant execute on function public.get_saldo_livre(uuid) to authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x    uuid := current_setting('test063.x')::uuid;
  def  uuid := current_setting('test063.def')::uuid;
  y    uuid := current_setting('test063.y')::uuid;
  res  jsonb := public.resumo_projetos_v2();
  cx   jsonb;
  cdef jsonb;
  cy   jsonb;
begin
  select c into cx   from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = x::text;
  select c into cdef from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = def::text;
  select c into cy   from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = y::text;

  perform pg_temp.ok(
    cx ->> 'situacao' = 'sem dado'
    and cx -> 'livre' = 'null'::jsonb
    and cx -> 'data_referencia' = 'null'::jsonb
    and cx ->> 'erro' = 'falha_saldo_livre'
    and position('XYZ-999' in res::text) = 0,
    'sentinela com erro devolve sem dado, erro fixo falha_saldo_livre e sem vazar SQLERRM'
  );
  perform pg_temp.ok(
    cdef ->> 'situacao' = 'sem dado'
    and cdef -> 'livre' = 'null'::jsonb
    and cdef -> 'data_referencia' = 'null'::jsonb
    and cdef ->> 'erro' = 'falha_saldo_livre',
    'cast quebrado dentro de resumo_projetos_v2 vira sem dado sem derrubar a lista'
  );
  perform pg_temp.ok(
    cy ->> 'situacao' = 'problema' and cy -> 'erro' = 'null'::jsonb,
    'outros centros seguem intactos após falha e cast quebrado'
  );
end $$;
reset role;

drop function public.get_saldo_livre(uuid);
alter function public._get_saldo_livre_real_063(uuid) rename to get_saldo_livre;

do $$ begin raise notice 'BLOCO 5 ok: resumo_projetos_v2 com situações reais, falha e cast quebrado'; end $$;

-- ------------------------------------------------------------
-- BLOCO 6 — v_balancete_vigente e get_repasses_v2 (inclusive desempate por versao desc)
-- ------------------------------------------------------------
-- Insere um segundo plano ativo de versao = 0 em 51.X para provar que order by versao desc escolhe versao = 1.
insert into public.planos_trabalho (project_id, ativo, versao, valor_total_plano)
values (current_setting('test063.x')::uuid, true, 0, 99999.00);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x   uuid := current_setting('test063.x')::uuid;
  sb  uuid := current_setting('test063.sb')::uuid;
  sp  uuid := current_setting('test063.sp')::uuid;
  rsb jsonb;
  rsp jsonb;
begin
  perform pg_temp.ok(
    (select count(*) = 1 and max(saldo_disponivel) = 195000.00
       from public.v_balancete_vigente where project_id = x),
    'v_balancete_vigente traz apenas o balancete mais recente de 51.X'
  );

  rsb := public.get_repasses_v2(sb);
  perform pg_temp.ok(
    (rsb ->> 'valor_total_plano')::numeric = 150000.00
    and jsonb_array_length(rsb -> 'parcelas') = 1
    and (rsb -> 'parcelas' -> 0 ->> 'valor_texto') = 'mediante cálculo de gastos'
    and rsb -> 'data_balancete' = 'null'::jsonb
    and rsb -> 'recursos' = 'null'::jsonb,
    'get_repasses_v2 de 63.SB devolve valor_total_plano e parcela sem valor/balancete'
  );

  rsp := public.get_repasses_v2(sp);
  perform pg_temp.ok(
    rsp -> 'parcelas' = '[]'::jsonb and rsp -> 'valor_total_plano' = 'null'::jsonb,
    'get_repasses_v2 de 63.SP sem plano devolve parcelas=[] e valor_total_plano=null'
  );
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x  uuid := current_setting('test063.x')::uuid;
  y  uuid := current_setting('test063.y')::uuid;
  rx jsonb;
begin
  -- v_balancete_vigente respeita RLS (security_invoker): b1 não vê 51.Y
  perform pg_temp.ok(
    not exists (select 1 from public.v_balancete_vigente where project_id = y)
    and exists (select 1 from public.v_balancete_vigente where project_id = x),
    'v_balancete_vigente escopada para professor'
  );

  -- get_repasses_v2 de centro alheio falha
  perform pg_temp.falha_com(format('select public.get_repasses_v2(%L::uuid)', y), null, 'Acesso negado%');

  -- get_repasses_v2 do próprio centro escolhe versao=1 (260000, não 99999), devolve parcelas em ordem e recursos vigentes
  rx := public.get_repasses_v2(x);
  perform pg_temp.ok(
    (rx ->> 'valor_total_plano')::numeric = 260000.00
    and jsonb_array_length(rx -> 'parcelas') = 3
    and (rx -> 'parcelas' -> 0 ->> 'parcela')::int = 1
    and (rx -> 'parcelas' -> 1 ->> 'parcela')::int = 2
    and (rx -> 'parcelas' -> 2 ->> 'parcela')::int = 3
    and (rx -> 'recursos' ->> 'recebido')::numeric = 150000
    and (rx -> 'recursos' ->> 'a_receber')::numeric = 50000
    and (rx ->> 'data_balancete')::date = (date_trunc('month', current_date) + interval '14 days')::date,
    'get_repasses_v2 de b1 em 51.X devolve versao maior, parcelas em ordem e recursos vigentes'
  );
end $$;
reset role;

do $$ begin raise notice 'BLOCO 6 ok: v_balancete_vigente e get_repasses_v2'; end $$;

-- ------------------------------------------------------------
-- BLOCO 7 — anon sem privilégios em tabelas, view e funções da 063
-- ------------------------------------------------------------
do $$
declare
  fn text;
begin
  perform pg_temp.ok(
    not has_table_privilege('anon', 'public.pendencias', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('anon', 'public.filtro_visao', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('anon', 'public.v_balancete_vigente', 'SELECT,INSERT,UPDATE,DELETE'),
    'anon sem acesso às tabelas e view da 063'
  );

  foreach fn in array array[
    'public._pendencias_sem_cpf()',
    'public.centros_visiveis()',
    'public.resumo_projetos_v2()',
    'public.listar_pendencias_v2(uuid)',
    'public.resolver_pendencia_v2(uuid, text)',
    'public.criar_pendencia_v2(jsonb)',
    'public.get_filtro_visao_v2()',
    'public.set_filtro_visao_v2(uuid[])',
    'public.get_repasses_v2(uuid)'
  ] loop
    perform pg_temp.ok(
      not has_function_privilege('anon', fn::regprocedure, 'EXECUTE'),
      'anon sem EXECUTE em ' || fn
    );
  end loop;

  perform pg_temp.ok(
    not has_function_privilege('authenticated', 'public._pendencias_sem_cpf()'::regprocedure, 'EXECUTE'),
    'authenticated sem EXECUTE em _pendencias_sem_cpf()'
  );
end $$;

do $$ begin raise notice 'BLOCO 7 ok: anon sem privilégios e _pendencias_sem_cpf fechada'; end $$;

select set_config('request.jwt.claim.sub', '', false);
rollback;
