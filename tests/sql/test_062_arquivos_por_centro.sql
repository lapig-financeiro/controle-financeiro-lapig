-- ============================================================
-- Roteiro de conferência da migração 062 (buckets por centro de custo)
--
-- Roda no banco descartável depois de stub-062.sql e da 062
-- (tools/replica-local/rodar-062-pglite.mjs).
-- Antes da 062, o BLOCO 1 falha porque o professor A (51.X) lê os
-- arquivos do centro B (51.Y) nos três buckets.
--
-- Identidades dos stubs:
--   a1 = admin
--   b1 = professor do centro X (51.X)
--   b2 = professor do centro Y (51.Y)
--   c1 = agente (Buriti), escopo X (51.X)
--   d1 = automação (Vigia), sem centros
-- ============================================================
\set ON_ERROR_STOP on

create or replace function pg_temp.ok(p boolean, p_motivo text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception '062 FALHOU: %', p_motivo;
  end if;
end $$;

create or replace function pg_temp.negado(p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when insufficient_privilege then return;
  end;
  raise exception '062 FALHOU: operação permitida: %', p_sql;
end $$;

begin;

select set_config('request.jwt.claim.sub', '', false);
delete from public.user_projects where user_id = '00000000-0000-0000-0000-0000000000d1';
update public.app_users set role = 'automacao' where user_id = '00000000-0000-0000-0000-0000000000d1';

select set_config('test062.x', (select id::text from public.projects where code = '51.X'), true);
select set_config('test062.y', (select id::text from public.projects where code = '51.Y'), true);

-- ------------------------------------------------------------
-- BLOCO 1 — Professor A (b1, escopo 51.X): lê o próprio centro,
-- NÃO lê centro B (51.Y) nem objetos soltos na raiz nos 3 buckets.
-- (É aqui que o estado pré-062 falha.)
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;

do $$
declare
  x text := current_setting('test062.x');
  y text := current_setting('test062.y');
  b text;
begin
  foreach b in array array['bolsa-planilhas', 'balancete-pdfs', 'plano-trabalho-docs'] loop
    if exists (select 1 from storage.objects where bucket_id = b and name like y || '/%') then
      raise exception '062 FALHOU: professor A leu arquivo do centro B no bucket %', b;
    end if;
    if exists (select 1 from storage.objects where bucket_id = b and name not like '%/%') then
      raise exception '062 FALHOU: professor A leu arquivo sem pasta no bucket %', b;
    end if;
    if not exists (select 1 from storage.objects where bucket_id = b and name like x || '/%') then
      raise exception '062 FALHOU: professor A não lê arquivo do próprio centro no bucket %', b;
    end if;
  end loop;
  raise notice 'BLOCO 1 ok: professor A lê só o próprio centro nos 3 buckets';
end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — Professor A (b1): upload (antes de existir linha em tabela),
-- troca e exclusão funcionam no próprio centro; centro B e raiz falham.
-- ------------------------------------------------------------
do $$
declare
  x text := current_setting('test062.x');
  y text := current_setting('test062.y');
  b text;
  n int;
begin
  foreach b in array array['bolsa-planilhas', 'balancete-pdfs', 'plano-trabalho-docs'] loop
    -- Upload no próprio centro (sem linha prévia em reconciliacoes/balancetes/planos_trabalho)
    insert into storage.objects (bucket_id, name) values (b, x || '/novo_upload.dat');

    -- Troca dentro do próprio centro
    update storage.objects set name = x || '/trocado.dat'
     where bucket_id = b and name = x || '/novo_upload.dat';
    get diagnostics n = row_count;
    perform pg_temp.ok(n = 1, 'professor A deve conseguir trocar arquivo do próprio centro em ' || b);

    -- Tentar mover o próprio arquivo para dentro do centro B deve ser recusado (with check)
    perform pg_temp.negado(format(
      'update storage.objects set name = %L where bucket_id = %L and name = %L',
      y || '/roubado.dat', b, x || '/trocado.dat'
    ));

    -- Remoção do próprio arquivo (ex.: rollback de falha de RPC ou exclusão de versão)
    delete from storage.objects where bucket_id = b and name = x || '/trocado.dat';
    get diagnostics n = row_count;
    perform pg_temp.ok(n = 1, 'professor A deve conseguir excluir arquivo do próprio centro em ' || b);

    -- Upload no centro alheio e na raiz devem ser recusados
    perform pg_temp.negado(format(
      'insert into storage.objects (bucket_id, name) values (%L, %L)',
      b, y || '/invasao.dat'
    ));
    perform pg_temp.negado(format(
      'insert into storage.objects (bucket_id, name) values (%L, %L)',
      b, 'sem_pasta.dat'
    ));

    -- Update e delete no centro alheio não atingem nenhuma linha
    update storage.objects set name = y || '/adulterado.dat'
     where bucket_id = b and name like y || '/%';
    get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'professor A não pode alterar arquivo do centro B em ' || b);

    delete from storage.objects where bucket_id = b and name like y || '/%';
    get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'professor A não pode excluir arquivo do centro B em ' || b);
  end loop;
  raise notice 'BLOCO 2 ok: escrita/troca/exclusão do professor A restrita ao próprio centro';
end $$;

reset role;

-- ------------------------------------------------------------
-- BLOCO 3 — Professor B (b2, escopo 51.Y): simétrico (lê Y, não lê X).
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
set local role authenticated;

do $$
declare
  x text := current_setting('test062.x');
  y text := current_setting('test062.y');
  b text;
begin
  foreach b in array array['bolsa-planilhas', 'balancete-pdfs', 'plano-trabalho-docs'] loop
    perform pg_temp.ok(
      not exists (select 1 from storage.objects where bucket_id = b and name like x || '/%'),
      'professor B não lê centro A em ' || b
    );
    perform pg_temp.ok(
      exists (select 1 from storage.objects where bucket_id = b and name like y || '/%'),
      'professor B lê próprio centro Y em ' || b
    );
  end loop;
  raise notice 'BLOCO 3 ok: professor B vê só 51.Y';
end $$;

reset role;

-- ------------------------------------------------------------
-- BLOCO 4 — Admin (a1): lê, grava, troca e remove em X, Y e raiz nos 3 buckets;
-- objetos originais de Y continuam intactos após tentativas do BLOCO 2.
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;

do $$
declare
  x text := current_setting('test062.x');
  y text := current_setting('test062.y');
  b text;
begin
  foreach b in array array['bolsa-planilhas', 'balancete-pdfs', 'plano-trabalho-docs'] loop
    perform pg_temp.ok(
      exists (select 1 from storage.objects where bucket_id = b and name like x || '/%')
      and exists (select 1 from storage.objects where bucket_id = b and name like y || '/%')
      and exists (select 1 from storage.objects where bucket_id = b and name not like '%/%'),
      'admin lê tudo (X, Y e raiz) em ' || b
    );
    insert into storage.objects (bucket_id, name) values (b, y || '/admin_novo.dat');
    update storage.objects set name = y || '/admin_trocado.dat' where bucket_id = b and name = y || '/admin_novo.dat';
    delete from storage.objects where bucket_id = b and name = y || '/admin_trocado.dat';
  end loop;
  raise notice 'BLOCO 4 ok: admin continua lendo e gerenciando todos os centros';
end $$;

reset role;

-- ------------------------------------------------------------
-- BLOCO 5 — Agente / Buriti (c1, escopo 51.X): restrições 051/052 preservadas
-- e balancete-pdfs também escopado por centro.
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set local role authenticated;

do $$
declare
  x text := current_setting('test062.x');
  y text := current_setting('test062.y');
  b text;
begin
  -- 052: agente não lê bolsa-planilhas nem plano-trabalho-docs, nem do próprio centro
  perform pg_temp.ok(
    not exists (select 1 from storage.objects where bucket_id = 'bolsa-planilhas'),
    'agente continua bloqueado em bolsa-planilhas (052)'
  );
  perform pg_temp.ok(
    not exists (select 1 from storage.objects where bucket_id = 'plano-trabalho-docs'),
    'agente continua bloqueado em plano-trabalho-docs (052)'
  );

  -- balancete-pdfs: lê 51.X (do escopo), NÃO lê 51.Y
  perform pg_temp.ok(
    exists (select 1 from storage.objects where bucket_id = 'balancete-pdfs' and name like x || '/%'),
    'agente lê balancete-pdfs do próprio escopo'
  );
  perform pg_temp.ok(
    not exists (select 1 from storage.objects where bucket_id = 'balancete-pdfs' and name like y || '/%'),
    'agente não lê balancete-pdfs de centro fora do escopo'
  );

  -- 051: agente não escreve em nenhum dos 3 buckets, nem no próprio centro
  foreach b in array array['bolsa-planilhas', 'balancete-pdfs', 'plano-trabalho-docs'] loop
    perform pg_temp.negado(format(
      'insert into storage.objects (bucket_id, name) values (%L, %L)',
      b, x || '/agente.dat'
    ));
  end loop;

  -- 051: bucket propostas-agente continua funcionando só para o escopo
  perform pg_temp.ok(
    exists (select 1 from storage.objects where bucket_id = 'propostas-agente' and name like x || '/%')
    and not exists (select 1 from storage.objects where bucket_id = 'propostas-agente' and name like y || '/%'),
    'propostas-agente segue escopado para o agente'
  );
  insert into storage.objects (bucket_id, name) values ('propostas-agente', x || '/nova_prop.pdf');
  perform pg_temp.negado(format(
    'insert into storage.objects (bucket_id, name) values (%L, %L)',
    'propostas-agente', y || '/prop_alheia.pdf'
  ));
  raise notice 'BLOCO 5 ok: restrições do agente (051/052) preservadas + balancete escopado';
end $$;

reset role;

-- ------------------------------------------------------------
-- BLOCO 6 — Automação / Vigia (d1): continua sem storage (054).
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set local role authenticated;

do $$
declare
  x text := current_setting('test062.x');
begin
  perform pg_temp.ok((select count(*) = 0 from storage.objects), 'automação continua sem ler storage');
  perform pg_temp.negado(format(
    'insert into storage.objects (bucket_id, name) values (%L, %L)',
    'balancete-pdfs', x || '/vigia.pdf'
  ));
  raise notice 'BLOCO 6 ok: automação segue barrada no storage (054)';
end $$;

reset role;

-- ------------------------------------------------------------
-- BLOCO 7 — Anon sem acesso a storage.objects.
-- ------------------------------------------------------------
select pg_temp.ok(
  not has_table_privilege('anon', 'storage.objects', 'SELECT,INSERT,UPDATE,DELETE'),
  'anon sem privilégios em storage.objects'
);

select set_config('request.jwt.claim.sub', '', false);
rollback;
