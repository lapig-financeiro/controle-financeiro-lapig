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
-- BLOCO 1 — criar_pendencia_v2, idempotência, CPF e isolamento SELECT
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

-- Admin (a1): validações, criação, atualização de aberta, não reabertura de resolvida.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;

do $$
declare
  x    uuid := current_setting('test063.x')::uuid;
  y    uuid := current_setting('test063.y')::uuid;
  r1   jsonb;
  r2   jsonb;
  r_x2 jsonb;
  r_x3 jsonb;
  r_y  jsonb;
  r_g  jsonb;
begin
  -- Chave desconhecida no payload é recusada
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:51.X:k1', 'project_id', x, 'tipo', 'outro', 'titulo', 'Ok', 'extra', 1)::text),
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
    'detalhe', jsonb_build_object('conta', '7.1.3.99.01'),
    'origem', 'sistema'
  ));
  perform pg_temp.ok((r1 ->> 'criada')::boolean = true and r1 ->> 'situacao' = 'aberta', 'criou pendência 1');

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

  -- Cria outra em 51.X, resolve e tenta recriar pela mesma chave -> NÃO reabre
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

-- Insere via superuser uma resolvida há 91 dias (fora da janela) e uma aberta antiga (dentro).
do $$
declare
  x uuid := current_setting('test063.x')::uuid;
  v_old_open uuid;
begin
  insert into public.pendencias (chave, project_id, tipo, titulo, situacao, origem, criada_em)
  values ('contrato:51.X:antiga-aberta', x, 'contrato', 'Pendência aberta há 120 dias', 'aberta', 'sistema', now() - interval '120 days')
  returning id into v_old_open;

  insert into public.pendencias (chave, project_id, tipo, titulo, situacao, origem, criada_em, resolvida_em)
  values ('contrato:51.X:antiga-resolvida', x, 'contrato', 'Resolvida há 91 dias', 'resolvida', 'sistema', now() - interval '100 days', now() - interval '91 days');

  perform set_config('test063.px_old_open', v_old_open::text, true);
end $$;

-- Professor A (b1): vê só 51.X (abertas primeiro); não vê 51.Y nem geral; listar_pendencias_v2(y) falha.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;

do $$
declare
  x uuid := current_setting('test063.x')::uuid;
  y uuid := current_setting('test063.y')::uuid;
  l jsonb;
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
    jsonb_array_length(l) = 3
    and (l -> 0 ->> 'situacao') = 'aberta'
    and (l -> 1 ->> 'situacao') = 'aberta'
    and (l -> 2 ->> 'situacao') = 'resolvida',
    'professor A vê 2 abertas (inclusive >90d) antes da resolvida recente, sem a de 91 dias nem 51.Y/geral'
  );
  perform pg_temp.ok(
    not exists (
      select 1 from jsonb_array_elements(l) el
       where el ->> 'project_id' = y::text or el -> 'project_id' = 'null'::jsonb
          or el ->> 'titulo' = 'Resolvida há 91 dias'
    ),
    'listar_pendencias_v2 de b1 não vaza 51.Y, geral nem resolvida > 90d'
  );

  perform pg_temp.falha_com(format('select public.listar_pendencias_v2(%L::uuid)', y), null, 'Acesso negado%');
end $$;

reset role;

-- Professor B (b2): vê só 51.Y; Admin (a1): vê todas (abertas + resolvidas recentes, exclui > 90d).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
set local role authenticated;
select pg_temp.ok(
  jsonb_array_length(public.listar_pendencias_v2()) = 1
  and (public.listar_pendencias_v2() -> 0 ->> 'project_id') = current_setting('test063.y'),
  'professor B vê só a pendência de 51.Y'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  l jsonb := public.listar_pendencias_v2();
begin
  perform pg_temp.ok(
    jsonb_array_length(l) = 5
    and exists (select 1 from jsonb_array_elements(l) el where el -> 'project_id' = 'null'::jsonb),
    'admin vê 5 pendências (4 abertas incl. sem centro + 1 resolvida recente; exclui 91d)'
  );
  perform pg_temp.ok(
    (l -> 4 ->> 'situacao') = 'resolvida'
    and (l -> 0 ->> 'situacao') = 'aberta'
    and (l -> 3 ->> 'situacao') = 'aberta',
    'abertas vêm antes das resolvidas'
  );
end $$;
reset role;

do $$ begin raise notice 'BLOCO 1 ok: criação, upsert, não reabertura, CPF, recência 90d e isolamento por centro'; end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — Escrita direta bloqueada em pendencias e filtro_visao (professor e agente)
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
       where t.tgrelid = 'public.filtro_visao'::regclass
         and t.tgname = 'trg_bloqueia_agente'
         and t.tgqual is null
         and (t.tgtype & 1) = 0 and (t.tgtype & 2) <> 0 and (t.tgtype & (4|8|16)) = (4|8|16)
    ),
    'trg_bloqueia_agente presente no catálogo para pendencias e filtro_visao'
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

-- Com grant temporário de teste, testa RLS (professor: insert 42501, update/delete row_count=0)
-- e o gatilho da 051 para o agente (insert/update/delete bloqueados pelo gatilho).
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

revoke insert, update, delete on public.pendencias from authenticated;

-- filtro_visao: professor falha no RLS e agente falha no gatilho 051.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  n int;
begin
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

do $$ begin raise notice 'BLOCO 2 ok: escrita direta bloqueada em pendencias e filtro_visao (RLS + gatilho 051)'; end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — resolver_pendencia_v2 (escopo, transições, idempotência, filtro não nega)
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
begin
  -- Centro alheio, pendência geral e situação inválida falham
  perform pg_temp.falha_com(format($q$select public.resolver_pendencia_v2(%L::uuid, 'resolvida')$q$, py1), null, 'Acesso negado%');
  perform pg_temp.falha_com(format($q$select public.resolver_pendencia_v2(%L::uuid, 'resolvida')$q$, pg1), '42501');
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

do $$ begin raise notice 'BLOCO 3 ok: resolver_pendencia_v2, transições e independência do filtro de visão'; end $$;

-- ------------------------------------------------------------
-- BLOCO 4 — filtro_visao (só admin, normalização, ocultos, pendência sem centro)
-- ------------------------------------------------------------
-- Reabre uma pendência em 51.Y e outra sem centro para testar listar_pendencias_v2 com filtro ativo.
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

-- Professor chamando set_filtro_visao_v2 recebe erro 42501 (inclusive com centro alheio).
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

-- Admin: oculta 1 centro (com null, duplicata, inexistente e inativo ignorados); depois oculta 2; depois limpa.
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

  -- Oculta 2 centros (o 1º continua oculto)
  f2 := public.set_filtro_visao_v2(array[y, sb]);
  res := public.resumo_projetos_v2();
  perform pg_temp.ok(
    jsonb_array_length(f2 -> 'centros_ocultos') = 2
    and (res ->> 'ocultos')::int = 2
    and jsonb_array_length(res -> 'centros') = 3
    and not exists (select 1 from jsonb_array_elements(res -> 'centros') c where c ->> 'id' in (y::text, sb::text)),
    'ocultar 2 centros mantém o 1º oculto e reduz centros para 3'
  );

  -- Limpa o filtro
  perform public.set_filtro_visao_v2('{}'::uuid[]);
  res := public.resumo_projetos_v2();
  perform pg_temp.ok((res ->> 'ocultos')::int = 0 and jsonb_array_length(res -> 'centros') = 5, 'limpar filtro restaura 5 ativos');
end $$;
reset role;

do $$ begin raise notice 'BLOCO 4 ok: filtro de visão exclusivo do admin, normalização, ocultos e pendência sem centro'; end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — resumo_projetos_v2 (estados, valores reais de get_saldo_livre e falha sentinela)
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

-- Falha de get_saldo_livre num id sentinela (51.X): vira 'sem dado' / 'falha_saldo_livre' sem vazar SQLERRM; outros intactos.
alter function public.get_saldo_livre(uuid) rename to _get_saldo_livre_real_063;
create function public.get_saldo_livre(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sentinela uuid := (select id from public.projects where code = '51.X');
begin
  if p_project_id = v_sentinela then
    raise exception 'Detalhe interno secreto XYZ-999';
  end if;
  return public._get_saldo_livre_real_063(p_project_id);
end $$;
revoke all on function public.get_saldo_livre(uuid) from public, anon;
grant execute on function public.get_saldo_livre(uuid) to authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x   uuid := current_setting('test063.x')::uuid;
  y   uuid := current_setting('test063.y')::uuid;
  res jsonb := public.resumo_projetos_v2();
  cx  jsonb;
  cy  jsonb;
begin
  select c into cx from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = x::text;
  select c into cy from jsonb_array_elements(res -> 'centros') c where c ->> 'id' = y::text;

  perform pg_temp.ok(
    cx ->> 'situacao' = 'sem dado'
    and cx -> 'livre' = 'null'::jsonb
    and cx -> 'data_referencia' = 'null'::jsonb
    and cx ->> 'erro' = 'falha_saldo_livre'
    and position('XYZ-999' in res::text) = 0,
    'sentinela com erro devolve sem dado, erro fixo falha_saldo_livre e sem vazar SQLERRM'
  );
  perform pg_temp.ok(
    cy ->> 'situacao' = 'problema' and cy -> 'erro' = 'null'::jsonb,
    'outros centros seguem intactos após falha no sentinela'
  );
end $$;
reset role;

drop function public.get_saldo_livre(uuid);
alter function public._get_saldo_livre_real_063(uuid) rename to get_saldo_livre;

do $$ begin raise notice 'BLOCO 5 ok: resumo_projetos_v2 com situações reais e tolerância a falha'; end $$;

-- ------------------------------------------------------------
-- BLOCO 6 — v_balancete_vigente e get_repasses_v2
-- ------------------------------------------------------------
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

  -- get_repasses_v2 do próprio centro devolve parcelas em ordem, valor_total_plano e recursos do balancete vigente
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
    'get_repasses_v2 de b1 em 51.X devolve parcelas em ordem, valor_total_plano e recursos vigentes'
  );
end $$;
reset role;

do $$ begin raise notice 'BLOCO 6 ok: v_balancete_vigente e get_repasses_v2'; end $$;

-- ------------------------------------------------------------
-- BLOCO 7 — anon sem privilégios em tabelas, view e 8 funções novas
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
end $$;

do $$ begin raise notice 'BLOCO 7 ok: anon sem privilégios nas tabelas, view e 8 funções da 063'; end $$;

select set_config('request.jwt.claim.sub', '', false);
rollback;
