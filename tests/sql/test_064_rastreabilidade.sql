-- ============================================================
-- Roteiro de conferência da migração 064 (F2-A — rastreabilidade)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-064-pglite.mjs
-- Antes da 064, o BLOCO 1 falha (tabelas/funções da 064 não existem).
--
-- Identidades dos stubs:
--   a1 = admin ('Victor')
--   b1 = professor A, escopo 51.X + 63.INAT ('Professor do projeto')
--   b2 = professor B, escopo 51.Y ('Prof. Bruno')
--   c1 = agente (Buriti), escopo 51.X ('Buriti Agente')
--   d1 = automação (Vigia), sem centros
-- ============================================================
\set ON_ERROR_STOP on

create or replace function pg_temp.ok(p boolean, p_motivo text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception '064 FALHOU: %', p_motivo;
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
      raise exception '064 FALHOU: esperado SQLSTATE %, veio % (%): %', p_code, v_state, v_msg, p_sql;
    end if;
    if p_msg_like is not null and v_msg not like p_msg_like then
      raise exception '064 FALHOU: mensagem "%" não casa com "%": %', v_msg, p_msg_like, p_sql;
    end if;
    return;
  end;
  raise exception '064 FALHOU: operação deveria falhar mas passou: %', p_sql;
end $$;

create or replace function pg_temp.verificar_arvore(
  p_no jsonb,
  p_raiz boolean default true,
  p_pai_chave text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tipo      text := p_no ->> 'tipo';
  v_chave     text := coalesce(p_no ->> 'chave', '<sem-chave>');
  v_valor     numeric;
  v_soma      numeric;
  v_filho     jsonb;
  v_ref       jsonb;
  v_ref_keys  text[];
  v_alvo_tab  text;
  v_alvo_id_t text;
  v_alvo_id   uuid;
  v_alvo_cmp  text;
begin
  if p_no is null or jsonb_typeof(p_no) <> 'object' then
    raise exception '064 FALHOU: nó inválido na árvore: %', p_no;
  end if;

  if not p_raiz and jsonb_typeof(p_no -> 'valor') <> 'number' then
    raise exception '064 FALHOU: nó % abaixo da raiz tem valor não numérico: %', v_chave, p_no -> 'valor';
  end if;

  if jsonb_typeof(p_no -> 'valor') <> 'number' then
    return;
  end if;
  v_valor := (p_no ->> 'valor')::numeric;

  if v_tipo not in ('calculo', 'documento', 'legado', 'digitado') then
    raise exception '064 FALHOU: tipo inválido % no nó %', v_tipo, v_chave;
  end if;

  if (p_no ->> 'sinal')::integer not in (1, -1) then
    raise exception '064 FALHOU: sinal inválido % no nó %', p_no ->> 'sinal', v_chave;
  end if;

  if v_tipo = 'calculo' then
    if p_no -> 'ref' <> 'null'::jsonb then
      raise exception '064 FALHOU: nó de cálculo % não pode ter ref', v_chave;
    end if;
    if coalesce(btrim(p_no ->> 'conta', E' \t\n\r'), '') = '' then
      raise exception '064 FALHOU: nó de cálculo % sem conta', v_chave;
    end if;
    if jsonb_typeof(p_no -> 'partes') <> 'array' or jsonb_array_length(p_no -> 'partes') = 0 then
      raise exception '064 FALHOU: nó de cálculo % sem partes', v_chave;
    end if;

    select coalesce(sum((f ->> 'sinal')::numeric * (f ->> 'valor')::numeric), 0)
      into v_soma
      from jsonb_array_elements(p_no -> 'partes') as f;

    if round(v_soma, 2) is distinct from round(v_valor, 2) then
      raise exception '064 FALHOU: nó % não fecha (valor %, soma dos filhos %)', v_chave, v_valor, v_soma;
    end if;

    for v_filho in select value from jsonb_array_elements(p_no -> 'partes') loop
      perform pg_temp.verificar_arvore(v_filho, false, v_chave);
    end loop;
  else
    if jsonb_typeof(p_no -> 'partes') <> 'array' or jsonb_array_length(p_no -> 'partes') <> 0 then
      raise exception '064 FALHOU: folha % deve ter partes vazio', v_chave;
    end if;
    if p_no -> 'conta' <> 'null'::jsonb then
      raise exception '064 FALHOU: folha % não deve ter conta', v_chave;
    end if;
    v_ref := p_no -> 'ref';
    if jsonb_typeof(v_ref) <> 'object' then
      raise exception '064 FALHOU: folha % sem ref válida: %', v_chave, v_ref;
    end if;
    select array_agg(k order by k) into v_ref_keys from jsonb_object_keys(v_ref) as k;
    if v_ref_keys is distinct from array['alvo_id', 'alvo_tabela', 'campo']::text[] then
      raise exception '064 FALHOU: folha % com chaves de ref inesperadas: %', v_chave, v_ref;
    end if;
    v_alvo_tab  := coalesce(v_ref ->> 'alvo_tabela', '');
    v_alvo_id_t := coalesce(v_ref ->> 'alvo_id', '');
    v_alvo_cmp  := coalesce(v_ref ->> 'campo', '');
    if v_alvo_id_t !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception '064 FALHOU: folha % com alvo_id inválido: %', v_chave, v_alvo_id_t;
    end if;
    v_alvo_id := v_alvo_id_t::uuid;

    if p_pai_chave like '%:previsto' then
      if v_alvo_tab <> 'plano_rubricas' or v_alvo_cmp <> 'valor_previsto'
         or not exists (select 1 from public.plano_rubricas where id = v_alvo_id) then
        raise exception '064 FALHOU: folha % com ref inválida para previsto: %', v_chave, v_ref;
      end if;
    elsif p_pai_chave like '%:realizado' then
      if v_alvo_tab <> 'balancete_lancamentos' or v_alvo_cmp <> 'saldo_atual'
         or not exists (select 1 from public.balancete_lancamentos where id = v_alvo_id) then
        raise exception '064 FALHOU: folha % com ref inválida para realizado: %', v_chave, v_ref;
      end if;
    elsif p_pai_chave like '%:comprometido' then
      if v_alvo_tab <> 'scholarships' or v_alvo_cmp <> 'amount'
         or not exists (select 1 from public.scholarships where id = v_alvo_id) then
        raise exception '064 FALHOU: folha % com ref inválida para comprometido: %', v_chave, v_ref;
      end if;
    else
      raise exception '064 FALHOU: pai inesperado % para folha %', p_pai_chave, v_chave;
    end if;
  end if;
end $$;

begin;

select set_config('test064.x',    (select id::text from public.projects where code = '51.X'), true);
select set_config('test064.y',    (select id::text from public.projects where code = '51.Y'), true);
select set_config('test064.bal_y',(select id::text from public.balancetes where project_id = current_setting('test064.y')::uuid order by data_referencia desc limit 1), true);
select set_config('test064.edge', (select id::text from public.projects where code = '64.EDGE'), true);
select set_config('test064.sb',   (select id::text from public.projects where code = '63.SB'), true);
select set_config('test064.sp',   (select id::text from public.projects where code = '63.SP'), true);
select set_config('test064.sn',   (select id::text from public.projects where code = '64.SN'), true);
select set_config('test064.inat', (select id::text from public.projects where code = '63.INAT'), true);

-- ------------------------------------------------------------
-- BLOCO 1 — ACL, RLS por centro/admin e barreira do agente
-- ------------------------------------------------------------
do $$
declare
  fn text;
  tb text;
begin
  foreach tb in array array['public.documentos', 'public.documento_versoes', 'public.fatos', 'public.pendencias'] loop
    perform pg_temp.ok(
      not exists (
        select 1 from pg_class c
         cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         where c.oid = tb::regclass
           and a.grantee in (0::oid, 'anon'::regrole::oid)
      )
      and coalesce((
        select array_agg(a.privilege_type order by a.privilege_type)
          from pg_class c
          cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         where c.oid = tb::regclass
           and a.grantee = 'authenticated'::regrole::oid
      ), '{}'::text[]) = array['SELECT']::text[],
      'ACL exata de tabela via aclexplode em ' || tb
    );
  end loop;

  foreach fn in array array[
    'public.registrar_documento_v2(jsonb)',
    'public.get_origem_v2(text, uuid, text)',
    'public.explicar_livre_v2(uuid)',
    'public.criar_pendencia_v2(jsonb)',
    'public.resolver_pendencia_v2(uuid, text)'
  ] loop
    perform pg_temp.ok(
      not has_function_privilege('anon', fn::regprocedure, 'EXECUTE')
      and has_function_privilege('authenticated', fn::regprocedure, 'EXECUTE'),
      'ACL de RPC correta em ' || fn
    );
  end loop;

  foreach fn in array array[
    'public._tem_cpf(text)',
    'public._mascarar_cpf(text)',
    'public._cpfs(text)',
    'public._fmt_brl_num(numeric)',
    'public._texto_pendencia(text, text, jsonb)',
    'public._resolver_origem_alvo(text, uuid, text, boolean)',
    'public._pendencias_sem_cpf()'
  ] loop
    perform pg_temp.ok(
      not has_function_privilege('anon', fn::regprocedure, 'EXECUTE')
      and not has_function_privilege('authenticated', fn::regprocedure, 'EXECUTE'),
      'função interna fechada em ' || fn
    );
  end loop;
end $$;

-- Professor A (b1): lê documentos/versoes de 51.X, nunca de 51.Y; lê 0 linhas de fatos.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  y uuid := current_setting('test064.y')::uuid;
begin
  perform pg_temp.ok(
    exists (select 1 from public.documentos where project_id = x)
    and not exists (select 1 from public.documentos where project_id = y),
    'b1 lê documentos apenas de 51.X'
  );
  perform pg_temp.ok(
    exists (
      select 1 from public.documento_versoes dv
      join public.documentos d on d.id = dv.documento_id
      where d.project_id = x
    )
    and not exists (
      select 1 from public.documento_versoes dv
      join public.documentos d on d.id = dv.documento_id
      where d.project_id = y
    ),
    'b1 lê documento_versoes apenas de 51.X'
  );
  perform pg_temp.ok((select count(*) = 0 from public.fatos), 'b1 não lê nenhuma linha direta de fatos');

  -- Escrita direta falha por falta de grant
  perform pg_temp.falha_com(
    format($q$insert into public.documentos (project_id, tipo, chave, titulo) values (%L::uuid, 'balancete', 'k:b1', 'T')$q$, x),
    '42501'
  );
  perform pg_temp.falha_com($q$update public.documentos set titulo = 'X'$q$, '42501');
  perform pg_temp.falha_com($q$delete from public.documentos$q$, '42501');
  perform pg_temp.falha_com($q$delete from public.documento_versoes$q$, '42501');
  perform pg_temp.falha_com($q$delete from public.fatos$q$, '42501');
end $$;
reset role;

-- Com grant temporário de teste: professor esbarra no RLS; agente esbarra em trg_bloqueia_agente (051).
grant insert, update, delete on public.documentos, public.documento_versoes, public.fatos to authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  doc_id uuid := (select id from public.documentos where project_id = x limit 1);
  n int;
begin
  perform pg_temp.falha_com(
    format($q$insert into public.documentos (project_id, tipo, chave, titulo) values (%L::uuid, 'balancete', 'k:rls', 'T')$q$, x),
    '42501'
  );
  update public.documentos set titulo = 'hack';
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'update direto em documentos por professor atinge 0 linhas');
  delete from public.documentos;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'delete direto em documentos por professor atinge 0 linhas');

  perform pg_temp.falha_com(
    format($q$insert into public.documento_versoes (documento_id, versao, sha256, bucket, caminho, formato, parser, parser_versao, origem) values (%L::uuid, 99, repeat('9',64), 'balancete-pdfs', 'x/a.pdf', 'pdf', 'p', '1', 'site')$q$, doc_id),
    '42501'
  );
  update public.documento_versoes set parser_versao = '0';
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'update direto em documento_versoes por professor atinge 0 linhas');

  perform pg_temp.falha_com(
    $q$insert into public.fatos (versao_id, alvo_tabela, alvo_pai_id, alvo_chave, campo, valor, trecho) values ('00000000-0000-0000-0000-000000000001', 'balancetes', '00000000-0000-0000-0000-000000000001', '', 'saldo_disponivel', 1, 'x')$q$,
    '42501'
  );
  update public.fatos set trecho = 'hack';
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'update direto em fatos por professor atinge 0 linhas');
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set local role authenticated;
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
begin
  perform pg_temp.ok((select count(*) = 0 from public.fatos), 'agente c1 não lê nenhuma linha direta de fatos');
  perform pg_temp.falha_com(
    format($q$insert into public.documentos (project_id, tipo, chave, titulo) values (%L::uuid, 'balancete', %L, 'T')$q$, x, 'balancete:' || x::text || ':2020-01-01'),
    '42501', 'O agente não grava em documentos%'
  );
  perform pg_temp.falha_com($q$update public.documento_versoes set parser_versao = '0'$q$, '42501', 'O agente não grava em documento_versoes%');
  perform pg_temp.falha_com($q$delete from public.fatos$q$, '42501', 'O agente não grava em fatos%');
end $$;
reset role;

revoke insert, update, delete on public.documentos, public.documento_versoes, public.fatos from authenticated;

do $$ begin raise notice 'BLOCO 1 ok: ACL, RLS por centro, fatos admin-only e barreira do agente'; end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — registrar_documento_v2 (guard, validações, atomicidade, dedup, CPF)
-- ------------------------------------------------------------
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
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
      format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
        jsonb_build_object(
          'project_id', x, 'tipo', 'balancete', 'chave', 'balancete:teste:neg',
          'titulo', 'Negado', 'sha256', repeat('1', 64), 'bucket', 'balancete-pdfs',
          'caminho', x::text || '/neg.pdf', 'formato', 'pdf', 'parser', 'p', 'parser_versao', '1',
          'origem', 'site', 'fatos', '[]'::jsonb
        )::text),
      '42501'
    );
    reset role;
  end loop;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x        uuid := current_setting('test064.x')::uuid;
  y        uuid := current_setting('test064.y')::uuid;
  edge     uuid := current_setting('test064.edge')::uuid;
  bal_x    uuid := (select id from public.balancetes where project_id = x order by data_referencia desc limit 1);
  bal_x1   uuid := (select id from public.balancetes where project_id = x order by data_referencia asc limit 1);
  ref_x1   date := (select data_referencia from public.balancetes where id = bal_x1);
  bal_y    uuid := (select id from public.balancetes where project_id = y order by data_referencia desc limit 1);
  bal_ed   uuid := (select id from public.balancetes where project_id = edge order by data_referencia desc limit 1);
  ref_ed   date := (select data_referencia from public.balancetes where id = bal_ed);
  pl_x     uuid := (select id from public.planos_trabalho where project_id = x and ativo = true limit 1);
  chave_b2 text := 'balancete:' || x::text || ':' || to_char(ref_x1, 'YYYY-MM-DD');
  base_b   jsonb;
  r1       jsonb;
  r2       jsonb;
  r3       jsonb;
  v_st     text;
  v_mg     text;
  v_det    text;
  v_dup_pr uuid;
begin
  base_b := jsonb_build_object(
    'project_id', x, 'tipo', 'balancete', 'chave', chave_b2,
    'titulo', 'Teste bloco 2 v1', 'sha256', repeat('d', 64), 'bucket', 'balancete-pdfs',
    'caminho', x::text || '/teste_b2.pdf', 'arquivo_nome', 'teste_b2.pdf',
    'formato', 'pdf', 'paginas', 2, 'parser', 'balancete-parser', 'parser_versao', '2.1',
    'origem', 'site', 'fatos', jsonb_build_array(
      jsonb_build_object('alvo_tabela', 'balancetes', 'alvo_id', bal_x1, 'campo', 'saldo_disponivel',
        'valor', 110000.00, 'pagina', 2, 'trecho', 'Saldo 110.000,00', 'bbox', null)
    )
  );

  -- Chave desconhecida e 'vincular' (removida pela correção #3) são recusadas
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('extra', 1))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('vincular', jsonb_build_object('tabela', 'balancetes', 'id', bal_x1)))::text),
    '22023'
  );

  -- Item 5: chave fora do formato canônico, data inválida e fato de data/plano diferente da chave são recusados
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('chave', 'balancete:' || x::text || ':livre', 'fatos', '[]'::jsonb))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('chave', 'balancete:' || x::text || ':2026-02-31', 'fatos', '[]'::jsonb))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_set(base_b, '{fatos}', jsonb_build_array(
        jsonb_build_object('alvo_tabela', 'balancetes', 'alvo_id', bal_x, 'campo', 'saldo_disponivel', 'valor', 195000.00, 'pagina', 2, 'trecho', 'Data errada', 'bbox', null)
      ))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_build_object(
        'project_id', x, 'tipo', 'plano', 'chave', 'plano:' || x::text || ':99999999-9999-9999-9999-999999999999',
        'titulo', 'Plano errado', 'sha256', repeat('e', 64), 'bucket', 'plano-trabalho-docs',
        'caminho', x::text || '/p.docx', 'formato', 'docx', 'paginas', null, 'parser', 'pt-parser', 'parser_versao', '1',
        'origem', 'site', 'fatos', jsonb_build_array(
          jsonb_build_object('alvo_tabela', 'planos_trabalho', 'alvo_id', pl_x, 'campo', 'valor_total_plano', 'valor', 260000.00, 'pagina', null, 'trecho', 'Total', 'bbox', null)
        )
      )::text),
    '22023'
  );

  -- Item 6 (3ª rodada): a chave exige plano/balancete existente mesmo com fatos: []
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_build_object(
        'project_id', x, 'tipo', 'plano', 'chave', 'plano:' || x::text || ':99999999-9999-4999-8999-999999999998',
        'titulo', 'Plano inexistente sem fatos', 'sha256', repeat('e', 64), 'bucket', 'plano-trabalho-docs',
        'caminho', x::text || '/sem_plano.docx', 'formato', 'docx', 'paginas', null, 'parser', 'pt-parser', 'parser_versao', '1',
        'origem', 'site', 'fatos', '[]'::jsonb
      )::text),
    '22023', 'Plano % não encontrado%'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_build_object(
        'project_id', x, 'tipo', 'balancete', 'chave', 'balancete:' || x::text || ':2020-01-01',
        'titulo', 'Balancete sem data', 'sha256', repeat('e', 64), 'bucket', 'balancete-pdfs',
        'caminho', x::text || '/sem_balancete.pdf', 'formato', 'pdf', 'paginas', 1, 'parser', 'p', 'parser_versao', '1',
        'origem', 'site', 'fatos', '[]'::jsonb
      )::text),
    '22023', 'Não existe balancete%'
  );

  -- Matriz tipo x bucket x formato x caminho x tabela x campo
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('bucket', 'plano-trabalho-docs'))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('formato', 'docx', 'paginas', null, 'fatos', '[]'::jsonb))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('caminho', 'sem-pasta.pdf'))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('caminho', y::text || '/outro.pdf'))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('sha256', 'abc'))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_set(base_b, '{fatos}', jsonb_build_array(
        jsonb_build_object('alvo_tabela', 'planos_trabalho', 'alvo_id', pl_x, 'campo', 'valor_total_plano', 'valor', 260000.00, 'pagina', 1, 'trecho', 'Total', 'bbox', null)
      ))::text),
    '22023'
  );

  -- Item 10: PDF sem paginas, bbox sem pagina, e x0 string com erro 22023 (não 22P02)
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('paginas', null, 'fatos', '[]'::jsonb))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_set(base_b, '{fatos,0}', jsonb_build_object(
        'alvo_tabela', 'balancetes', 'alvo_id', bal_x1, 'campo', 'saldo_disponivel', 'valor', 110000.00,
        'pagina', null, 'trecho', 'Saldo', 'bbox', jsonb_build_object('x0', 10, 'x1', 20, 'yMin', 10, 'yMax', 20)
      ))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_set(base_b, '{fatos,0,bbox}', jsonb_build_object('x0', 'abc', 'x1', 20, 'yMin', 10, 'yMax', 20))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_set(base_b, '{fatos,0,bbox}', jsonb_build_object('x0', '40', 'x1', 20, 'yMin', 10, 'yMax', 20))::text),
    '22023'
  );

  -- DOCX não aceita paginas/pagina/bbox
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_build_object(
        'project_id', x, 'tipo', 'plano', 'chave', 'plano:' || x::text || ':' || pl_x::text,
        'titulo', 'Plano docx', 'sha256', repeat('e', 64), 'bucket', 'plano-trabalho-docs',
        'caminho', x::text || '/p.docx', 'formato', 'docx', 'paginas', 1, 'parser', 'pt-parser', 'parser_versao', '1',
        'origem', 'site', 'fatos', '[]'::jsonb
      )::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_build_object(
        'project_id', x, 'tipo', 'plano', 'chave', 'plano:' || x::text || ':' || pl_x::text,
        'titulo', 'Plano docx', 'sha256', repeat('e', 64), 'bucket', 'plano-trabalho-docs',
        'caminho', x::text || '/p.docx', 'formato', 'docx', 'paginas', null, 'parser', 'pt-parser', 'parser_versao', '1',
        'origem', 'site', 'fatos', jsonb_build_array(
          jsonb_build_object('alvo_tabela', 'planos_trabalho', 'alvo_id', pl_x, 'campo', 'valor_total_plano', 'valor', 260000.00, 'pagina', 1, 'trecho', 'Total', 'bbox', null)
        )
      )::text),
    '22023'
  );

  -- Item 6: plano_rubricas com 2 linhas de descricao_livre nula -> registrar_documento_v2 recusa
  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre)
  values (pl_x, 'a.bolsas', 1000.00, null)
  returning id into v_dup_pr;
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_build_object(
        'project_id', x, 'tipo', 'plano', 'chave', 'plano:' || x::text || ':' || pl_x::text,
        'titulo', 'Plano ambíguo', 'sha256', repeat('e', 64), 'bucket', 'plano-trabalho-docs',
        'caminho', x::text || '/amb.docx', 'formato', 'docx', 'paginas', null, 'parser', 'pt-parser', 'parser_versao', '1',
        'origem', 'site', 'fatos', jsonb_build_array(
          jsonb_build_object('alvo_tabela', 'plano_rubricas', 'alvo_id', v_dup_pr, 'campo', 'valor_previsto', 'valor', 1000.00, 'pagina', null, 'trecho', 'Bolsas 1000', 'bbox', null)
        )
      )::text),
    '22023', 'Linha ambígua no plano%'
  );
  delete from public.plano_rubricas where id = v_dup_pr;

  -- Fato com valor diferente do gravado falha com detail JSON e NÃO grava nada (atomicidade)
  begin
    perform public.registrar_documento_v2(
      jsonb_set(base_b, '{fatos}', jsonb_build_array(
        jsonb_build_object('alvo_tabela', 'balancetes', 'alvo_id', bal_x1, 'campo', 'saldo_disponivel',
          'valor', 110000.00, 'pagina', 2, 'trecho', 'Saldo ok', 'bbox', null),
        jsonb_build_object('alvo_tabela', 'balancetes', 'alvo_id', bal_x1, 'campo', 'rendimento_liquido',
          'valor', 9999.99, 'pagina', 2, 'trecho', 'Rendimento errado', 'bbox', null)
      ))
    );
    raise exception '064 FALHOU: valor divergente passou';
  exception when others then
    get stacked diagnostics v_st = returned_sqlstate, v_mg = message_text, v_det = pg_exception_detail;
    perform pg_temp.ok(
      v_st = '22023'
      and (v_det::jsonb -> 0 ->> 'tabela') = 'balancetes'
      and (v_det::jsonb -> 0 ->> 'campo') = 'rendimento_liquido'
      and (v_det::jsonb -> 0 ->> 'esperado')::numeric = 1000.00
      and (v_det::jsonb -> 0 ->> 'lido')::numeric = 9999.99,
      'divergência de valor falha com 22023 e detail em JSON'
    );
  end;
  perform pg_temp.ok(
    not exists (select 1 from public.documentos where chave = chave_b2),
    'falha em um fato desfaz a chamada inteira (documento não criado)'
  );

  -- Correção #6: fato para campo NULL no alvo (64.EDGE saldo_disponivel é NULL) é recusado
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_build_object(
        'project_id', edge, 'tipo', 'balancete', 'chave', 'balancete:' || edge::text || ':' || to_char(ref_ed, 'YYYY-MM-DD'),
        'titulo', 'Saldo nulo', 'sha256', repeat('f', 64), 'bucket', 'balancete-pdfs',
        'caminho', edge::text || '/nulo.pdf', 'formato', 'pdf', 'paginas', 1, 'parser', 'p', 'parser_versao', '1',
        'origem', 'site', 'fatos', jsonb_build_array(
          jsonb_build_object('alvo_tabela', 'balancetes', 'alvo_id', bal_ed, 'campo', 'saldo_disponivel', 'valor', 0, 'pagina', 1, 'trecho', '0,00', 'bbox', null)
        )
      )::text),
    '22023'
  );

  -- Alvo de outro projeto é recusado
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_set(base_b, '{fatos}', jsonb_build_array(
        jsonb_build_object('alvo_tabela', 'balancetes', 'alvo_id', bal_y, 'campo', 'saldo_disponivel', 'valor', 12000.00, 'pagina', 1, 'trecho', 'Y', 'bbox', null)
      ))::text),
    '22023'
  );

  -- Itens 1 e 7: CPF em trecho (pontuado, corrido, espaços, barra, NBSP, en dash, 4+ espaços/quebras, JSON separado, partido entre 2 trechos), titulo, arquivo_nome, caminho e chave
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, jsonb_set(base_b, '{fatos,0,trecho}', '"Linha 529.982.247-25 saldo"'::jsonb)::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, jsonb_set(base_b, '{fatos,0,trecho}', '"Linha 52998224725 saldo"'::jsonb)::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, jsonb_set(base_b, '{fatos,0,trecho}', '"Linha 529 982 247 25 saldo"'::jsonb)::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, jsonb_set(base_b, '{fatos,0,trecho}', '"Linha 529/982/247/25 saldo"'::jsonb)::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, jsonb_set(base_b, '{fatos,0,trecho}', to_jsonb('Linha 529' || chr(160) || '982' || chr(160) || '247' || chr(160) || '25 saldo'))::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, jsonb_set(base_b, '{fatos,0,trecho}', to_jsonb('Linha 529' || chr(8211) || '982' || chr(8211) || '247' || chr(8211) || '25 saldo'))::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, jsonb_set(base_b, '{fatos,0,trecho}', to_jsonb('Linha 529    ' || E'\n' || '    982     247     25'))::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, jsonb_set(base_b, '{fatos,0,trecho}', '"Valores [\"529.982\",\"247-25\"]"'::jsonb)::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, jsonb_set(base_b, '{fatos,0,trecho}', '"Par {\"529.982\": \"247-25\"}"'::jsonb)::text), '22023');
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_set(base_b, '{fatos}', jsonb_build_array(
        jsonb_build_object('alvo_tabela', 'balancetes', 'alvo_id', bal_x1, 'campo', 'saldo_disponivel', 'valor', 110000.00, 'pagina', 2, 'trecho', 'Parte 1: 529.982', 'bbox', null),
        jsonb_build_object('alvo_tabela', 'balancetes', 'alvo_id', bal_x1, 'campo', 'rendimento_liquido', 'valor', 1000.00, 'pagina', 2, 'trecho', '247-25 Parte 2', 'bbox', null)
      ))::text),
    '22023'
  );
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('titulo', 'Doc 529 982 247 25'))::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('arquivo_nome', 'arq_52998224725.pdf'))::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('caminho', x::text || '/sub/529_982_247_25.pdf'))::text), '22023');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('chave', 'balancete:529.982.247-25', 'fatos', '[]'::jsonb))::text), '22023');
  -- Item 7 (3ª rodada): parser e parser_versao também passam por _tem_cpf
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('parser', 'parser 529.982.247-25'))::text), '22023', 'Metadados do documento contêm CPF%');
  perform pg_temp.falha_com(format($q$select public.registrar_documento_v2(%L::jsonb)$q$, (base_b || jsonb_build_object('parser_versao', 'v1 529 982 247 25'))::text), '22023', 'Metadados do documento contêm CPF%');

  -- DV inválido (123.456.789-00) NÃO é CPF e é aceito
  r1 := public.registrar_documento_v2(
    jsonb_set(base_b, '{fatos,0,trecho}', '"Ref protocolo 123.456.789-00 saldo 110.000,00"'::jsonb)
  );
  perform pg_temp.ok(
    (r1 ->> 'criada')::boolean = true and (r1 ->> 'versao')::int = 1 and (r1 ->> 'fatos')::int = 1,
    'registrou v1 aceitando número não-CPF 123.456.789-00'
  );

  -- Repetir o mesmo sha256 não cria versão, não duplica fatos e não muda titulo
  r2 := public.registrar_documento_v2(
    jsonb_set(base_b || jsonb_build_object('titulo', 'Titulo ignorado no dedup'), '{fatos,0,trecho}', '"Ref protocolo 123.456.789-00 saldo 110.000,00"'::jsonb)
  );
  perform pg_temp.ok(
    (r2 ->> 'criada')::boolean = false
    and (r2 ->> 'versao')::int = 1
    and (r2 ->> 'versao_id') = (r1 ->> 'versao_id')
    and (r2 ->> 'fatos')::int = 0
    and (select titulo from public.documentos where id = (r1 ->> 'documento_id')::uuid) = 'Teste bloco 2 v1',
    'repetir sha256 devolve criada=false sem duplicar versão ou fatos'
  );

  -- Itens 8 e 11: sha novo atualiza documentos.titulo; caminho exige o UUID minúsculo
  r3 := public.registrar_documento_v2(
    base_b || jsonb_build_object(
      'sha256', repeat('1', 64),
      'titulo', 'Titulo atualizado v2',
      'caminho', x::text || '/v2.pdf'
    )
  );
  perform pg_temp.ok(
    (r3 ->> 'criada')::boolean = true
    and (r3 ->> 'versao')::int = 2
    and (r3 ->> 'documento_id') = (r1 ->> 'documento_id')
    and (select titulo from public.documentos where id = (r1 ->> 'documento_id')::uuid) = 'Titulo atualizado v2',
    'sha256 novo cria versao 2 e atualiza titulo'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      (base_b || jsonb_build_object('sha256', repeat('6', 64), 'caminho', upper(x::text) || '/MAIUSCULO_v3.pdf'))::text),
    '22023', 'Primeiro segmento do caminho deve ser o project_id em minúsculas%'
  );

  -- Conflito de chave com outro projeto ou outro tipo falha
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      (base_b || jsonb_build_object('project_id', y, 'caminho', y::text || '/y.pdf', 'sha256', repeat('2', 64), 'fatos', '[]'::jsonb))::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      (base_b || jsonb_build_object('tipo', 'plano', 'bucket', 'plano-trabalho-docs', 'sha256', repeat('3', 64), 'fatos', '[]'::jsonb))::text),
    '22023'
  );
end $$;
reset role;

do $$ begin raise notice 'BLOCO 2 ok: registrar_documento_v2 (guard, validações, atomicidade, dedup, CPF)'; end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — get_origem_v2 (chave estável, valor alterado, ordem, máscara CPF, legado, digitado)
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x        uuid := current_setting('test064.x')::uuid;
  y        uuid := current_setting('test064.y')::uuid;
  edge     uuid := current_setting('test064.edge')::uuid;
  bal_x    uuid := (select id from public.balancetes where project_id = x order by data_referencia desc limit 1);
  ref_x    date := (select data_referencia from public.balancetes where id = bal_x);
  pl_x     uuid := (select id from public.planos_trabalho where project_id = x and ativo = true limit 1);
  bol_x    uuid := (select id from public.scholarships where project_id = x limit 1);
  bl_srv   uuid := (select id from public.balancete_lancamentos where balancete_id = bal_x and conta_codigo = '7.1.3.05.01.00027');
  bl_leg   uuid := (select id from public.balancete_lancamentos where balancete_id = bal_x and conta_codigo = '7.1.3.05.01.00014');
  pr_srv   uuid := (select id from public.plano_rubricas where plano_id = pl_x and rubrica_code = 'b' and descricao_livre = 'Serviços técnicos especializados');
  pr_leg   uuid := (select id from public.plano_rubricas where plano_id = pl_x and rubrica_code = 'b' and descricao_livre = 'Participação em congressos');
  pd_p1    uuid := (select id from public.plano_desembolsos where plano_id = pl_x and parcela = 1);
  pd_p2    uuid := (select id from public.plano_desembolsos where plano_id = pl_x and parcela = 2);
  bl_ed    uuid := (select id from public.balancete_lancamentos where rubrica_code = 'c' and balancete_id in (select id from public.balancetes where project_id = edge) limit 1);
  o        jsonb;
begin
  -- Documento PDF com pagina/trecho/bbox
  o := public.get_origem_v2('balancete_lancamentos', bl_srv, 'saldo_atual');
  perform pg_temp.ok(
    o ->> 'tipo' = 'documento'
    and (o ->> 'valor')::numeric = 15000.00
    and (o -> 'fato' ->> 'pagina')::int = 1
    and o -> 'fato' ->> 'trecho' like '7.1.3.05.01.00027%'
    and (o -> 'fato' -> 'bbox' ->> 'x0')::numeric = 40
    and o -> 'documento' ->> 'formato' = 'pdf'
    and o -> 'busca' = 'null'::jsonb,
    'get_origem_v2 retorna documento PDF completo para lançamento rastreado'
  );

  -- Documento DOCX (pagina e bbox nulos)
  o := public.get_origem_v2('plano_rubricas', pr_srv, 'valor_previsto');
  perform pg_temp.ok(
    o ->> 'tipo' = 'documento'
    and (o ->> 'valor')::numeric = 45000.00
    and o -> 'documento' ->> 'formato' = 'docx'
    and o -> 'fato' -> 'pagina' = 'null'::jsonb
    and o -> 'fato' -> 'bbox' = 'null'::jsonb,
    'get_origem_v2 retorna documento DOCX sem pagina/bbox'
  );

  -- Correção #1: regrava plano por upsert_plano_trabalho e balancete por upsert_balancete com mesmos números;
  -- os ids das linhas mudam mas a origem continua 'documento'.
  perform public.upsert_plano_trabalho(jsonb_build_object(
    'id', pl_x,
    'project_id', x,
    'tipo', 'remanejamento',
    'titulo', 'Plano 51.X regravado',
    'valor_total_plano', 260000.00,
    'rubricas', jsonb_build_array(
      jsonb_build_object('rubrica_code', 'a.bolsas', 'valor_previsto', 200000.00, 'descricao_livre', null),
      jsonb_build_object('rubrica_code', 'b', 'valor_previsto', 45000.00, 'descricao_livre', 'Serviços técnicos especializados'),
      jsonb_build_object('rubrica_code', 'b', 'valor_previsto', 15000.00, 'descricao_livre', 'Participação em congressos')
    ),
    'desembolsos', jsonb_build_array(
      jsonb_build_object('parcela', 1, 'valor', 100000.00),
      jsonb_build_object('parcela', 2, 'valor', 100000.00),
      jsonb_build_object('parcela', 3, 'valor', 60000.00)
    )
  ));

  perform public.upsert_balancete(jsonb_build_object(
    'project_id', x,
    'data_referencia', ref_x,
    'saldo_disponivel', 195000.00,
    'rendimento_liquido', 3500.00,
    'total_debitos', 120000.00,
    'total_creditos', 315000.00,
    'lancamentos', jsonb_build_array(
      jsonb_build_object('conta_codigo', '7.1.3.04.01.09142', 'conta_descricao', 'BOLSA DOAÇÃO', 'saldo_atual', 50000.00, 'rubrica_code', 'a.bolsas'),
      jsonb_build_object('conta_codigo', '7.1.3.05.01.00027', 'conta_descricao', 'SERVIÇOS ANÁLISE PESQ. CIENTÍFICA', 'saldo_atual', 15000.00, 'rubrica_code', 'b'),
      jsonb_build_object('conta_codigo', '7.1.3.05.01.00014', 'conta_descricao', 'INSCRIÇÃO CONGRESSO', 'saldo_atual', 5000.00, 'rubrica_code', 'b')
    )
  ));

  declare
    v_novo_pr uuid := (select id from public.plano_rubricas where plano_id = pl_x and rubrica_code = 'b' and descricao_livre = 'Serviços técnicos especializados');
    v_novo_pd uuid := (select id from public.plano_desembolsos where plano_id = pl_x and parcela = 1);
    v_novo_bl uuid := (select id from public.balancete_lancamentos where balancete_id = bal_x and conta_codigo = '7.1.3.05.01.00027');
  begin
    perform pg_temp.ok(
      v_novo_pr <> pr_srv and v_novo_pd <> pd_p1 and v_novo_bl <> bl_srv,
      'upsert_plano_trabalho e upsert_balancete geraram novos ids para as linhas'
    );
    perform pg_temp.ok(
      (public.get_origem_v2('plano_rubricas', v_novo_pr, 'valor_previsto') ->> 'tipo') = 'documento'
      and (public.get_origem_v2('plano_desembolsos', v_novo_pd, 'valor') ->> 'tipo') = 'documento'
      and (public.get_origem_v2('balancete_lancamentos', v_novo_bl, 'saldo_atual') ->> 'tipo') = 'documento',
      'após regravar plano e balancete pelas RPCs antigas, a origem continua documento (chave estável)'
    );
    bl_srv := v_novo_bl;
    pr_leg := (select id from public.plano_rubricas where plano_id = pl_x and rubrica_code = 'b' and descricao_livre = 'Participação em congressos');
    pd_p2  := (select id from public.plano_desembolsos where plano_id = pl_x and parcela = 2);
    bl_leg := (select id from public.balancete_lancamentos where balancete_id = bal_x and conta_codigo = '7.1.3.05.01.00014');
  end;

  -- Legado com arquivo (lançamento, rubrica, desembolso, cabeçalho balancete) e sem arquivo (64.EDGE)
  o := public.get_origem_v2('balancete_lancamentos', bl_leg, 'saldo_atual');
  perform pg_temp.ok(
    o ->> 'tipo' = 'legado'
    and (o -> 'documento' ->> 'bucket') = 'balancete-pdfs'
    and (o -> 'documento' ->> 'formato') = 'pdf'
    and (o -> 'documento' ->> 'titulo') like 'Balancete de %'
    and (o -> 'busca' ->> 'conta_codigo') = '7.1.3.05.01.00014'
    and (o -> 'busca' ->> 'valor')::numeric = 5000.00
    and o -> 'fato' = 'null'::jsonb,
    'get_origem_v2 legado de lançamento traz documento e busca {conta_codigo, valor}'
  );

  o := public.get_origem_v2('plano_rubricas', pr_leg, 'valor_previsto');
  perform pg_temp.ok(
    o ->> 'tipo' = 'legado'
    and (o -> 'documento' ->> 'bucket') = 'plano-trabalho-docs'
    and (o -> 'documento' ->> 'formato') = 'docx'
    and (o -> 'documento' ->> 'titulo') = 'Plano de trabalho v1'
    and (o -> 'busca' ->> 'texto') = 'Participação em congressos'
    and (o -> 'busca' ->> 'valor')::numeric = 15000.00,
    'get_origem_v2 legado de rubrica traz busca {texto, valor}'
  );

  o := public.get_origem_v2('plano_desembolsos', pd_p2, 'valor');
  perform pg_temp.ok(
    o ->> 'tipo' = 'legado'
    and (o -> 'busca' ->> 'texto') = 'Parcela 2'
    and (o -> 'busca' ->> 'valor')::numeric = 100000.00,
    'get_origem_v2 legado de desembolso traz busca {texto: Parcela N, valor}'
  );

  o := public.get_origem_v2('balancetes', bal_x, 'total_creditos');
  perform pg_temp.ok(
    o ->> 'tipo' = 'legado'
    and (o -> 'busca' ->> 'texto') = 'total de creditos'
    and (o -> 'busca' ->> 'valor')::numeric = 315000.00,
    'get_origem_v2 legado de cabeçalho traz texto e valor'
  );

  o := public.get_origem_v2('balancete_lancamentos', bl_ed, 'saldo_atual');
  perform pg_temp.ok(
    o ->> 'tipo' = 'legado'
    and o -> 'documento' = 'null'::jsonb
    and (o -> 'busca' ->> 'conta_codigo') = '7.1.3.05.01.00042',
    'get_origem_v2 legado sem arquivo traz documento=null e busca preenchida'
  );

  -- Digitado (bolsa): valor = amount mensal (4000), nota explicando total dos meses na árvore
  o := public.get_origem_v2('scholarships', bol_x, 'amount');
  perform pg_temp.ok(
    o ->> 'tipo' = 'digitado'
    and (o ->> 'valor')::numeric = 4000.00
    and o -> 'documento' = 'null'::jsonb
    and o ->> 'nota' like '%meses%',
    'get_origem_v2 de bolsa retorna digitado com valor mensal e nota'
  );

  -- Tabela/campo fora da lista falha
  perform pg_temp.falha_com($q$select public.get_origem_v2('projects', current_setting('test064.x')::uuid, 'name')$q$, '22023');
  perform pg_temp.falha_com(format($q$select public.get_origem_v2('balancetes', %L::uuid, 'campo_fake')$q$, bal_x), '22023');
end $$;
reset role;

-- Item 1 (3ª rodada): busca.texto vindo de descricao_livre também passa pela máscara de CPF
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  v_pl uuid;
  v_pr uuid;
begin
  insert into public.planos_trabalho (project_id, ativo, versao, tipo, valor_total_plano)
  values (x, false, 9, 'remanejamento', 1000.00)
  returning id into v_pl;

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre)
  values (v_pl, 'b', 1000.00, 'Consultoria 529.982.247-25')
  returning id into v_pr;

  perform set_config('test064.pl_cpf', v_pl::text, true);
  perform set_config('test064.pr_cpf', v_pr::text, true);
end $$;

do $$
declare
  u text;
  v_pr uuid := current_setting('test064.pr_cpf')::uuid;
  o jsonb;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  o := public.get_origem_v2('plano_rubricas', v_pr, 'valor_previsto');
  perform pg_temp.ok(
    o ->> 'tipo' = 'legado'
    and (o -> 'busca' ->> 'texto') = 'Consultoria 529.982.247-25',
    'admin lê busca.texto livre sem máscara'
  );
  reset role;

  foreach u in array array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1'] loop
    perform set_config('request.jwt.claim.sub', u, true);
    set local role authenticated;
    o := public.get_origem_v2('plano_rubricas', v_pr, 'valor_previsto');
    perform pg_temp.ok(
      o ->> 'tipo' = 'legado'
      and (o -> 'busca' ->> 'texto') = 'Consultoria ***.***.***-**'
      and o -> 'documento' = 'null'::jsonb,
      u || ' recebe busca.texto de rubrica mascarado'
    );
    reset role;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Correção #14 + Item 7: legado sem extensão no caminho, sem arquivo_nome e máscara em arquivo_nome
update public.balancetes
   set arquivo_storage_path = current_setting('test064.x') || '/sem_extensao_bal',
       arquivo_nome = null
 where id = (select id from public.balancetes where project_id = current_setting('test064.x')::uuid order by data_referencia desc limit 1);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  bal_x uuid := (select id from public.balancetes where project_id = x order by data_referencia desc limit 1);
  bl_leg uuid := (select id from public.balancete_lancamentos where balancete_id = bal_x and conta_codigo = '7.1.3.05.01.00014');
  o jsonb := public.get_origem_v2('balancete_lancamentos', bl_leg, 'saldo_atual');
begin
  perform pg_temp.ok(
    (o -> 'documento' ->> 'formato') = 'pdf'
    and (o -> 'documento' ->> 'arquivo_nome') = 'sem_extensao_bal',
    'legado sem extensão no caminho usa pdf para balancete e extrai arquivo_nome do fim do caminho'
  );
end $$;
reset role;

update public.balancetes
   set arquivo_storage_path = current_setting('test064.x') || '/rel_52998224725.pdf',
       arquivo_nome = 'bal_529/982/247/25.pdf'
 where id = (select id from public.balancetes where project_id = current_setting('test064.x')::uuid order by data_referencia desc limit 1);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  bal_x uuid := (select id from public.balancetes where project_id = x order by data_referencia desc limit 1);
  bl_leg uuid := (select id from public.balancete_lancamentos where balancete_id = bal_x and conta_codigo = '7.1.3.05.01.00014');
  o jsonb := public.get_origem_v2('balancete_lancamentos', bl_leg, 'saldo_atual');
begin
  perform pg_temp.ok(
    (o -> 'documento' ->> 'arquivo_nome') = 'bal_529/982/247/25.pdf'
    and (o -> 'documento' ->> 'caminho') = x::text || '/rel_52998224725.pdf',
    'admin lê arquivo_nome legado sem máscara'
  );
end $$;
reset role;

do $$
declare
  u text;
  x uuid := current_setting('test064.x')::uuid;
  bal_x uuid := (select id from public.balancetes where project_id = x order by data_referencia desc limit 1);
  bl_leg uuid := (select id from public.balancete_lancamentos where balancete_id = bal_x and conta_codigo = '7.1.3.05.01.00014');
  o jsonb;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1'] loop
    perform set_config('request.jwt.claim.sub', u, true);
    set local role authenticated;
    o := public.get_origem_v2('balancete_lancamentos', bl_leg, 'saldo_atual');
    perform pg_temp.ok(
      (o -> 'documento' ->> 'arquivo_nome') = 'bal_***.***.***-**.pdf'
      and (o -> 'documento' ->> 'caminho') = x::text || '/rel_52998224725.pdf',
      'legado mascara arquivo_nome e preserva caminho para ' || u
    );
    reset role;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

update public.balancetes
   set arquivo_storage_path = current_setting('test064.x') || '/balancete_atual.pdf',
       arquivo_nome = 'balancete_atual.pdf'
 where id = (select id from public.balancetes where project_id = current_setting('test064.x')::uuid order by data_referencia desc limit 1);

-- Correção #2 + Itens 9 e 12: valor mudou após leitura -> nota na origem e na folha, independente de lc_numeric
update public.balancete_lancamentos
   set saldo_atual = 15500.00
 where conta_codigo = '7.1.3.05.01.00027'
   and balancete_id = (select id from public.balancetes where project_id = current_setting('test064.x')::uuid order by data_referencia desc limit 1);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  bal_x uuid := (select id from public.balancetes where project_id = x order by data_referencia desc limit 1);
  bl_srv uuid := (select id from public.balancete_lancamentos where balancete_id = bal_x and conta_codigo = '7.1.3.05.01.00027');
  o jsonb := public.get_origem_v2('balancete_lancamentos', bl_srv, 'saldo_atual');
  ex jsonb := public.explicar_livre_v2(x);
  v_folha jsonb;
  v_loc text;
begin
  perform pg_temp.ok(
    o ->> 'tipo' = 'legado'
    and (o ->> 'valor')::numeric = 15500.00
    and o ->> 'nota' = 'o valor mudou depois da leitura do documento (lido R$ 15.000,00)'
    and o -> 'documento' ->> 'id' is not null
    and (o -> 'busca' ->> 'conta_codigo') = '7.1.3.05.01.00027'
    and (o -> 'busca' ->> 'valor')::numeric = 15500.00
    and o -> 'fato' = 'null'::jsonb,
    'valor alterado após leitura devolve legado com nota do valor lido, documento e busca'
  );

  select l
    into v_folha
    from jsonb_array_elements(ex -> 'partes') g,
         jsonb_array_elements(g -> 'partes') r,
         jsonb_array_elements(r -> 'partes') l
   where l ->> 'chave' = 'linha:' || bl_srv::text;
  perform pg_temp.ok(
    v_folha ->> 'tipo' = 'legado'
    and v_folha ->> 'nota' = 'o valor mudou depois da leitura do documento (lido R$ 15.000,00)',
    'explicar_livre_v2 rebaixa a folha modificada para legado e copia a nota'
  );

  declare
    v_lc_orig text := current_setting('lc_numeric');
  begin
    foreach v_loc in array array['C', 'pt_BR.UTF-8', 'de_DE.UTF-8'] loop
      perform set_config('lc_numeric', v_loc, true);
      perform pg_temp.ok(
        (public.get_origem_v2('balancete_lancamentos', bl_srv, 'saldo_atual') ->> 'nota')
          = 'o valor mudou depois da leitura do documento (lido R$ 15.000,00)',
        'formatação pt-BR independente de lc_numeric=' || v_loc
      );
    end loop;
    perform set_config('lc_numeric', v_lc_orig, true);
  end;
end $$;
reset role;

update public.balancete_lancamentos
   set saldo_atual = 15000.00
 where conta_codigo = '7.1.3.05.01.00027'
   and balancete_id = (select id from public.balancetes where project_id = current_setting('test064.x')::uuid order by data_referencia desc limit 1);

-- Itens 6 e 9: plano_rubricas ambígua (duas nulas e null/'') devolve legado com nota e explicar_livre_v2 copia nota
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  pl_x uuid := (select id from public.planos_trabalho where project_id = x and ativo = true limit 1);
  pr_bol uuid := (select id from public.plano_rubricas where plano_id = pl_x and rubrica_code = 'a.bolsas' limit 1);
  pr_extra uuid;
  o jsonb;
  ex jsonb;
begin
  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre)
  values (pl_x, 'a.bolsas', 1000.00, null)
  returning id into pr_extra;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  o := public.get_origem_v2('plano_rubricas', pr_bol, 'valor_previsto');
  ex := public.explicar_livre_v2(x);
  perform pg_temp.ok(
    o ->> 'tipo' = 'legado'
    and o ->> 'nota' = 'linha ambígua no plano'
    and o -> 'fato' = 'null'::jsonb,
    'get_origem_v2 de plano_rubricas duplicada (duas nulas) devolve legado com nota de ambiguidade'
  );
  perform pg_temp.ok(
    exists (
      select 1
        from jsonb_array_elements(ex -> 'partes') g,
             jsonb_array_elements(g -> 'partes') r,
             jsonb_array_elements(r -> 'partes') l
       where l ->> 'chave' = 'linha:' || pr_bol::text
         and l ->> 'tipo' = 'legado'
         and l ->> 'nota' = 'linha ambígua no plano'
    ),
    'explicar_livre_v2 propaga linha ambígua no plano para a folha'
  );
  reset role;

  update public.plano_rubricas set descricao_livre = '' where id = pr_extra;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  perform pg_temp.ok(
    (public.get_origem_v2('plano_rubricas', pr_bol, 'valor_previsto') ->> 'nota') = 'linha ambígua no plano',
    'get_origem_v2 também trata null + "" como linha ambígua no plano'
  );
  reset role;

  delete from public.plano_rubricas where id = pr_extra;
end $$;

-- Correção #13 + Item 5: duas versões/documentos -> vence registrado_em mais recente (desempate versao desc)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  bal_x uuid := (select id from public.balancetes where project_id = x order by data_referencia desc limit 1);
  ref_x date := (select data_referencia from public.balancetes where id = bal_x);
  ch_x text := 'balancete:' || x::text || ':' || to_char(ref_x, 'YYYY-MM-DD');
  r_v2 jsonb;
  r_v3 jsonb;
  o    jsonb;
begin
  r_v2 := public.registrar_documento_v2(jsonb_build_object(
    'project_id', x, 'tipo', 'balancete', 'chave', ch_x,
    'titulo', 'Balancete 51.X v2', 'sha256', repeat('4', 64), 'bucket', 'balancete-pdfs',
    'caminho', x::text || '/ord2.pdf', 'formato', 'pdf', 'paginas', 2, 'parser', 'p1', 'parser_versao', '2',
    'origem', 'site', 'fatos', jsonb_build_array(
      jsonb_build_object('alvo_tabela', 'balancetes', 'alvo_id', bal_x, 'campo', 'total_debitos', 'valor', 120000.00, 'pagina', 1, 'trecho', 'Trecho V2', 'bbox', null)
    )
  ));
  r_v3 := public.registrar_documento_v2(jsonb_build_object(
    'project_id', x, 'tipo', 'balancete', 'chave', ch_x,
    'titulo', 'Balancete 51.X v3', 'sha256', repeat('5', 64), 'bucket', 'balancete-pdfs',
    'caminho', x::text || '/ord3.pdf', 'formato', 'pdf', 'paginas', 2, 'parser', 'p2', 'parser_versao', '3',
    'origem', 'site', 'fatos', jsonb_build_array(
      jsonb_build_object('alvo_tabela', 'balancetes', 'alvo_id', bal_x, 'campo', 'total_debitos', 'valor', 120000.00, 'pagina', 1, 'trecho', 'Trecho V3', 'bbox', null)
    )
  ));

  -- Força v2 com registrado_em mais recente que v3 para provar ordem por registrado_em desc
  reset role;
  update public.documento_versoes set registrado_em = now() + interval '1 hour' where id = (r_v2 ->> 'versao_id')::uuid;
  set local role authenticated;
  o := public.get_origem_v2('balancetes', bal_x, 'total_debitos');
  perform pg_temp.ok(o -> 'fato' ->> 'trecho' = 'Trecho V2', 'entre leituras, vence registrado_em mais recente');

  -- Empate de registrado_em -> desempata por versao desc (v3 vence v2)
  reset role;
  update public.documento_versoes
     set registrado_em = '2026-11-18 12:00:00+00'::timestamptz
   where id in ((r_v2 ->> 'versao_id')::uuid, (r_v3 ->> 'versao_id')::uuid);
  set local role authenticated;
  o := public.get_origem_v2('balancetes', bal_x, 'total_debitos');
  perform pg_temp.ok(o -> 'fato' ->> 'trecho' = 'Trecho V3', 'empate em registrado_em desempata por versao desc');
end $$;
reset role;

-- Itens 1 e 2: máscara de CPF ampliada (professor e agente mascarados; admin sem máscara)
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  bal_x uuid := (select id from public.balancetes where project_id = x order by data_referencia desc limit 1);
  ver_x uuid;
begin
  select dv.id into ver_x
    from public.documento_versoes dv
    join public.documentos d on d.id = dv.documento_id
   where d.chave = 'balancete:' || x::text || ':' || (select to_char(data_referencia, 'YYYY-MM-DD') from public.balancetes where id = bal_x)
     and dv.versao = 1
   limit 1;

  insert into public.fatos (versao_id, alvo_tabela, alvo_pai_id, alvo_chave, campo, valor, pagina, trecho, bbox)
  values (
    ver_x, 'balancetes', bal_x, '', 'total_creditos', 315000.00, 2,
    'CRÉD 315.000,00 ref 529.982.247-25 | 529 982 247 25 | 529/982/247/25 | 529'
      || chr(160) || '982' || chr(160) || '247' || chr(160) || '25 | 529'
      || chr(8211) || '982' || chr(8211) || '247' || chr(8211) || '25 | 529    '
      || E'\n' || '    982     247     25 | 52998224725 | 5299 8224 725',
    null
  );
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
select pg_temp.ok(
  (public.get_origem_v2(
     'balancetes',
     (select id from public.balancetes where project_id = current_setting('test064.x')::uuid order by data_referencia desc limit 1),
     'total_creditos'
   ) -> 'fato' ->> 'trecho') like '%529.982.247-25%',
  'admin recebe o trecho sem máscara'
);
reset role;

do $$
declare
  u text;
  x uuid := current_setting('test064.x')::uuid;
  bal_x uuid := (select id from public.balancetes where project_id = x order by data_referencia desc limit 1);
  tr text;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1'] loop
    perform set_config('request.jwt.claim.sub', u, true);
    set local role authenticated;
    tr := public.get_origem_v2('balancetes', bal_x, 'total_creditos') -> 'fato' ->> 'trecho';
    perform pg_temp.ok(
      tr = 'CRÉD 315.000,00 ref ***.***.***-** | ***.***.***-** | ***.***.***-** | ***.***.***-** | ***.***.***-** | ***.***.***-** | ***.***.***-** | ***.***.***-**',
      u || ' recebe todas as variantes de CPF mascaradas no trecho: ' || coalesce(tr, '<null>')
    );
    reset role;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Item 4: não-admin recebe SQLSTATE e mensagem idênticos para alvo de outro centro e UUID inexistente
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  bal_y uuid := current_setting('test064.bal_y')::uuid;
  st1 text; mg1 text;
  st2 text; mg2 text;
begin
  begin
    perform public.get_origem_v2('balancetes', bal_y, 'saldo_disponivel');
  exception when others then
    get stacked diagnostics st1 = returned_sqlstate, mg1 = message_text;
  end;
  begin
    perform public.get_origem_v2('balancetes', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'saldo_disponivel');
  exception when others then
    get stacked diagnostics st2 = returned_sqlstate, mg2 = message_text;
  end;

  perform pg_temp.ok(
    st1 = '42501' and st2 = '42501' and mg1 = 'Acesso negado ao alvo.' and mg2 = 'Acesso negado ao alvo.',
    format('sem oráculo de existência: alheio=(%s,%s) inexistente=(%s,%s)', st1, mg1, st2, mg2)
  );
end $$;
reset role;

-- Item 2: explicar_livre_v2 mascara CPF para agente (c1) e professor (b1) nos rótulos
update public.balancete_lancamentos
   set conta_descricao = 'INSCRIÇÃO REF 529.982.247-25'
 where conta_codigo = '7.1.3.05.01.00014'
   and balancete_id = (select id from public.balancetes where project_id = current_setting('test064.x')::uuid order by data_referencia desc limit 1);

do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  ex_ag jsonb;
  ex_adm jsonb;
  rot_ag text;
  rot_adm text;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
  set local role authenticated;
  ex_ag := public.explicar_livre_v2(x);
  reset role;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  ex_adm := public.explicar_livre_v2(x);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  select l ->> 'rotulo' into rot_ag
    from jsonb_array_elements(ex_ag -> 'partes') g, jsonb_array_elements(g -> 'partes') r, jsonb_array_elements(r -> 'partes') l
   where l ->> 'rotulo' like '7.1.3.05.01.00014%';
  select l ->> 'rotulo' into rot_adm
    from jsonb_array_elements(ex_adm -> 'partes') g, jsonb_array_elements(g -> 'partes') r, jsonb_array_elements(r -> 'partes') l
   where l ->> 'rotulo' like '7.1.3.05.01.00014%';

  perform pg_temp.ok(
    rot_ag = '7.1.3.05.01.00014 — INSCRIÇÃO REF ***.***.***-**'
    and rot_adm like '%529.982.247-25%',
    'explicar_livre_v2 mascara CPF no rótulo para agente e mantém para admin'
  );
end $$;

update public.balancete_lancamentos
   set conta_descricao = 'INSCRIÇÃO CONGRESSO'
 where conta_codigo = '7.1.3.05.01.00014'
   and balancete_id = (select id from public.balancetes where project_id = current_setting('test064.x')::uuid order by data_referencia desc limit 1);

do $$ begin raise notice 'BLOCO 3 ok: get_origem_v2 (documento, chave estável, valor alterado, ordem, máscara CPF, legado, digitado)'; end $$;

-- ------------------------------------------------------------
-- BLOCO 4 — explicar_livre_v2 (oráculo resumo_projetos_v2, árvore recursiva, casos de borda)
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  res    jsonb := public.resumo_projetos_v2();
  c      jsonb;
  cid    uuid;
  ex     jsonb;
  x      uuid := current_setting('test064.x')::uuid;
  edge   uuid := current_setting('test064.edge')::uuid;
  sb     uuid := current_setting('test064.sb')::uuid;
  sp     uuid := current_setting('test064.sp')::uuid;
  sn     uuid := current_setting('test064.sn')::uuid;
  inat   uuid := current_setting('test064.inat')::uuid;
  ex_x   jsonb;
  ex_ed  jsonb;
  ex_in  jsonb;
  sl_in  jsonb;
  sum_in numeric;
  v_ga   jsonb;
  v_gb   jsonb;
  v_gd   jsonb;
  v_gf   jsonb;
  v_ge   jsonb;
begin
  -- Oráculo: todo centro ativo em resumo_projetos_v2.centros[] bate ao centavo e fecha em toda a árvore
  for c in select value from jsonb_array_elements(res -> 'centros') loop
    cid := (c ->> 'id')::uuid;
    ex  := public.explicar_livre_v2(cid);

    if c -> 'livre' = 'null'::jsonb then
      perform pg_temp.ok(
        ex -> 'valor' = 'null'::jsonb
        and jsonb_array_length(ex -> 'partes') = 0
        and ex ->> 'motivo' is not null,
        'centro sem números/plano/balancete tem valor null, partes [] e motivo: ' || (c ->> 'code')
      );
    else
      perform pg_temp.ok(
        round((ex ->> 'valor')::numeric, 2) = round((c ->> 'livre')::numeric, 2)
        and ex -> 'motivo' = 'null'::jsonb,
        'explicar_livre_v2 bate ao centavo com resumo_projetos_v2 para ' || (c ->> 'code')
      );
      perform pg_temp.verificar_arvore(ex, true);
    end if;
  end loop;

  -- Motivos específicos para sem balancete, sem plano e sem números
  perform pg_temp.ok(public.explicar_livre_v2(sb) ->> 'motivo' = 'sem balancete', '63.SB motivo = sem balancete');
  perform pg_temp.ok(public.explicar_livre_v2(sp) ->> 'motivo' = 'sem plano', '63.SP motivo = sem plano');
  perform pg_temp.ok(
    (public.explicar_livre_v2(sn) ->> 'motivo') = 'sem números'
    and (public.explicar_livre_v2(sn) -> 'valor') = 'null'::jsonb
    and (public.explicar_livre_v2(sn) -> 'data_referencia') <> 'null'::jsonb,
    '64.SN motivo = sem números com data_referencia preenchida'
  );

  -- Detalhes da árvore de 51.X (documento + legado + digitado, nota no grupo sem bolsas)
  ex_x := public.explicar_livre_v2(x);
  select g into v_ga from jsonb_array_elements(ex_x -> 'partes') g where g ->> 'chave' = 'grupo:a';
  select g into v_gb from jsonb_array_elements(ex_x -> 'partes') g where g ->> 'chave' = 'grupo:b';

  perform pg_temp.ok(
    v_ga ->> 'conta' = 'previsto − realizado − comprometido'
    and v_ga -> 'nota' = 'null'::jsonb
    and v_gb ->> 'conta' = 'previsto − realizado'
    and v_gb ->> 'nota' = 'compromissos fora de bolsas não são rastreados',
    'conta e nota corretas em grupo com e sem bolsas'
  );

  perform pg_temp.ok(
    exists (
      select 1 from jsonb_array_elements(v_ga -> 'partes') r, jsonb_array_elements(r -> 'partes') l
       where r ->> 'chave' = 'rubrica:a.bolsas:previsto' and l ->> 'tipo' = 'documento'
    ) and exists (
      select 1 from jsonb_array_elements(v_ga -> 'partes') r, jsonb_array_elements(r -> 'partes') l
       where r ->> 'chave' = 'rubrica:a.bolsas:comprometido'
         and l ->> 'tipo' = 'digitado'
         and l ->> 'rotulo' like 'Bolsista Sintético 64X — % × R$ 4.000,00'
         and (l -> 'ref' ->> 'alvo_tabela') = 'scholarships'
         and (l -> 'ref' ->> 'campo') = 'amount'
    ) and exists (
      select 1 from jsonb_array_elements(v_gb -> 'partes') r, jsonb_array_elements(r -> 'partes') l
       where r ->> 'chave' = 'rubrica:b:previsto' and l ->> 'tipo' = 'documento'
    ) and exists (
      select 1 from jsonb_array_elements(v_gb -> 'partes') r, jsonb_array_elements(r -> 'partes') l
       where r ->> 'chave' = 'rubrica:b:previsto' and l ->> 'tipo' = 'legado'
    ) and exists (
      select 1 from jsonb_array_elements(v_gb -> 'partes') r, jsonb_array_elements(r -> 'partes') l
       where r ->> 'chave' = 'rubrica:b:realizado' and l ->> 'tipo' = 'documento'
    ) and exists (
      select 1 from jsonb_array_elements(v_gb -> 'partes') r, jsonb_array_elements(r -> 'partes') l
       where r ->> 'chave' = 'rubrica:b:realizado' and l ->> 'tipo' = 'legado'
    ),
    '51.X mistura folhas documento, legado e digitado na mesma árvore'
  );

  -- Detalhes de 64.EDGE (previsto 0 sem nó vazio, previsto negativo, estorno negativo)
  ex_ed := public.explicar_livre_v2(edge);
  perform pg_temp.ok(
    not exists (
      select 1 from jsonb_array_elements(ex_ed -> 'partes') g,
                    jsonb_array_elements(g -> 'partes') r
       where r ->> 'chave' = 'rubrica:c:previsto'
    ),
    'rubrica c com previsto 0 não gera nó de previsto vazio'
  );

  select g into v_gd from jsonb_array_elements(ex_ed -> 'partes') g where g ->> 'chave' = 'grupo:d';
  select g into v_gf from jsonb_array_elements(ex_ed -> 'partes') g where g ->> 'chave' = 'grupo:f';
  select g into v_ge from jsonb_array_elements(ex_ed -> 'partes') g where g ->> 'chave' = 'grupo:e';

  perform pg_temp.ok(
    (v_gd ->> 'valor')::numeric = -2500.00
    and exists (
      select 1 from jsonb_array_elements(v_gd -> 'partes') r
       where r ->> 'chave' = 'rubrica:d:previsto' and (r ->> 'valor')::numeric = -2000.00
    ),
    'rubrica d com previsto negativo e realizado positivo (incluída pela 048) entra na árvore e fecha (-2000 - 500 = -2500)'
  );
  perform pg_temp.ok(
    (v_gf ->> 'valor')::numeric = 65000.00
    and exists (
      select 1 from jsonb_array_elements(v_gf -> 'partes') r
       where r ->> 'chave' = 'rubrica:f:realizado' and (r ->> 'valor')::numeric = -15000.00
    )
    and (v_ge ->> 'valor')::numeric = 13000.00
    and exists (
      select 1 from jsonb_array_elements(v_ge -> 'partes') r
       where r ->> 'chave' = 'rubrica:e:realizado' and (r ->> 'valor')::numeric = -3000.00
    ),
    'lançamentos negativos (estorno) preservam sinal negativo e fecham com sinal=-1'
  );

  -- Correção #12: centro inativo funciona à parte para admin
  sl_in := public.get_saldo_livre(inat);
  select sum((g ->> 'saldo_livre')::numeric) into sum_in from jsonb_array_elements(sl_in -> 'grupos') g;
  ex_in := public.explicar_livre_v2(inat);
  perform pg_temp.ok(
    round((ex_in ->> 'valor')::numeric, 2) = round(sum_in, 2),
    'explicar_livre_v2 de centro inativo funciona para admin'
  );
  perform pg_temp.verificar_arvore(ex_in, true);
end $$;
reset role;

-- Professor b1 lê explicar_livre_v2 do próprio centro e é barrado no centro alheio
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x uuid := current_setting('test064.x')::uuid;
  y uuid := current_setting('test064.y')::uuid;
begin
  perform pg_temp.verificar_arvore(public.explicar_livre_v2(x), true);
  perform pg_temp.falha_com(format($q$select public.explicar_livre_v2(%L::uuid)$q$, y), null, 'Acesso negado%');
end $$;
reset role;

do $$ begin raise notice 'BLOCO 4 ok: explicar_livre_v2 (oráculo, árvore recursiva, bordas e inativo)'; end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — Pendências (§8 + correções #15 e #16)
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x    uuid := current_setting('test064.x')::uuid;
  inat uuid := current_setting('test064.inat')::uuid;
  p_ok jsonb;
  p_up jsonb;
begin
  -- CPF com espaços / traços / partido entre campos é barrado; DV inválido é aceito
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:51.X:cpf-esp', 'project_id', x, 'tipo', 'outro', 'titulo', 'Bolsista 529 982 247 25')::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:51.X:529.982', 'project_id', x, 'tipo', 'outro', 'titulo', '247-25 partido')::text),
    '22023'
  );

  -- project_id "" e só whitespace falham (não vira geral)
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:geral:vazio', 'project_id', '', 'tipo', 'outro', 'titulo', 'Vazio')::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:geral:ws', 'project_id', E' \t\n ', 'tipo', 'outro', 'titulo', 'WS')::text),
    '22023'
  );

  -- titulo e chave com apenas \n/\t/\r/espaços falham
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:51.X:ws', 'project_id', x, 'tipo', 'outro', 'titulo', E' \n\t\r ')::text),
    '22023'
  );
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', E'\t\n\r ', 'project_id', x, 'tipo', 'outro', 'titulo', 'Ok')::text),
    '22023'
  );

  -- resolver_pendencia_v2(null, ...) dá erro claro (22023), não 'não encontrada'
  perform pg_temp.falha_com($q$select public.resolver_pendencia_v2(null, 'resolvida')$q$, '22023', 'p_id é obrigatório%');

  -- Nova pendência em centro inativo falha; existente aberta em centro que ficou inativo atualiza
  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:63.INAT:nova', 'project_id', inat, 'tipo', 'outro', 'titulo', 'Inativo')::text),
    '22023'
  );

  p_ok := public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'outro:51.X:fica-inativo',
    'project_id', x,
    'tipo', 'outro',
    'titulo', 'Aberta antes de inativar (ref 123.456.789-00)',
    'detalhe', null
  ));
  perform pg_temp.ok((p_ok ->> 'criada')::boolean = true, 'criou pendência aberta com detalhe null e DV inválido');
  perform pg_temp.ok(
    (select detalhe = '{}'::jsonb from public.pendencias where id = (p_ok ->> 'id')::uuid),
    'detalhe null gravado como {}'
  );

  reset role;
  update public.projects set active = false where id = x;
  set local role authenticated;

  p_up := public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'outro:51.X:fica-inativo',
    'project_id', x,
    'tipo', 'outro',
    'titulo', 'Atualizada após centro inativar',
    'detalhe', jsonb_build_object('step', 2)
  ));
  perform pg_temp.ok(
    (p_up ->> 'criada')::boolean = false and (p_up ->> 'id') = (p_ok ->> 'id'),
    'repetir chave aberta em centro que ficou inativo atualiza sem falhar'
  );

  reset role;
  update public.projects set active = true where id = x;
  set local role authenticated;

  -- Item 3: CPF partido em duas gravações e em duas chaves do detalhe numa gravação
  p_ok := public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'outro:51.X:2grav',
    'project_id', x,
    'tipo', 'outro',
    'titulo', 'Pendência parte 529.982',
    'detalhe', null
  ));
  perform pg_temp.ok((p_ok ->> 'criada')::boolean = true, '1ª gravação sem CPF completo aceita');

  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object(
        'chave', 'outro:51.X:2grav', 'project_id', x, 'tipo', 'outro',
        'titulo', 'Pendência parte 529.982', 'detalhe', jsonb_build_object('fim', '247-25')
      )::text),
    '22023'
  );
  reset role;
  perform pg_temp.falha_com(
    format($q$update public.pendencias set detalhe = '{"fim":"247-25"}'::jsonb where id = %L::uuid$q$, (p_ok ->> 'id')),
    '23514', 'Pendência com CPF%'
  );
  set local role authenticated;

  perform pg_temp.falha_com(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object(
        'chave', 'outro:51.X:2chaves', 'project_id', x, 'tipo', 'outro',
        'titulo', 'Duas chaves detalhe',
        'detalhe', jsonb_build_object('a', '529.982', 'b', '247-25')
      )::text),
    '22023'
  );
end $$;
reset role;

-- Gatilho de CPF no UPDATE: bloqueia CPF novo no detalhe/titulo e permite limpar legado + campo alheio
do $$
declare
  v_id uuid;
begin
  perform pg_temp.falha_com(
    $q$insert into public.pendencias (chave, project_id, tipo, titulo, detalhe) values ('outro:geral:2chaves', null, 'outro', 'Ok', '{"a":"529.982","b":"247-25"}'::jsonb)$q$,
    '23514', 'Pendência com CPF%'
  );

  alter table public.pendencias disable trigger trg_pendencias_sem_cpf;
  insert into public.pendencias (chave, project_id, tipo, titulo, detalhe)
  values ('outro:geral:legado-cpf', null, 'outro', 'Sem cpf no titulo', '{"obs":"529 982 247 25"}'::jsonb)
  returning id into v_id;
  alter table public.pendencias enable trigger trg_pendencias_sem_cpf;

  -- Atualizar apenas titulo limpo NÃO dispara falha pelo detalhe antigo intacto
  update public.pendencias set titulo = 'Titulo limpo atualizado' where id = v_id;
  perform pg_temp.ok(
    (select titulo = 'Titulo limpo atualizado' from public.pendencias where id = v_id),
    'UPDATE que não altera detalhe legado não falha'
  );

  -- Alterar titulo para CPF espaçado falha
  perform pg_temp.falha_com(
    format($q$update public.pendencias set titulo = 'Agora com 529 982 247 25' where id = %L::uuid$q$, v_id),
    '23514', 'Pendência com CPF%'
  );

  -- Item 4 (3ª rodada): trocar um CPF por outro no detalhe também falha
  perform pg_temp.falha_com(
    format($q$update public.pendencias set detalhe = '{"obs":"111.444.777-35"}'::jsonb where id = %L::uuid$q$, v_id),
    '23514', 'Pendência com CPF%'
  );

  -- Limpar CPF legado no detalhe é permitido
  update public.pendencias set detalhe = '{}'::jsonb where id = v_id;
  perform pg_temp.ok(
    (select detalhe = '{}'::jsonb from public.pendencias where id = v_id),
    'limpar CPF legado em pendencias é permitido'
  );

  -- CHECK da tabela barra titulo ou chave só com \t/\n/\r
  perform pg_temp.falha_com(
    $q$insert into public.pendencias (chave, project_id, tipo, titulo) values ('outro:geral:chk-ws', null, 'outro', E'\t\n\r ')$q$,
    '23514'
  );
  perform pg_temp.falha_com(
    $q$insert into public.pendencias (chave, project_id, tipo, titulo) values (E'\n\t ', null, 'outro', 'Ok')$q$,
    '23514'
  );
end $$;

-- Índice em resolvida_por e conferência exata de policies/ACL/gatilhos nas 4 tabelas
do $$
declare
  tb text;
  pol_q text;
  exp_q text;
begin
  perform pg_temp.ok(
    exists (
      select 1 from pg_indexes
       where schemaname = 'public' and tablename = 'pendencias' and indexname = 'idx_pendencias_resolvida_por'
    ),
    'idx_pendencias_resolvida_por presente'
  );
  perform pg_temp.ok(
    exists (
      select 1 from pg_indexes
       where schemaname = 'public' and tablename = 'fatos' and indexname = 'idx_fatos_versao'
    ),
    'idx_fatos_versao presente'
  );

  for tb, exp_q in
    select * from (values
      ('documentos',        '(is_admin() OR (project_id = ANY (allowed_project_ids())))'),
      ('documento_versoes', '(is_admin() OR (EXISTS ( SELECT 1 FROM documentos d WHERE ((d.id = documento_versoes.documento_id) AND (d.project_id = ANY (allowed_project_ids()))))))'),
      ('fatos',             '(is_admin() AND (NOT is_agente()))'),
      ('pendencias',        '(is_admin() OR ((project_id IS NOT NULL) AND (project_id = ANY (allowed_project_ids()))))')
    ) as x(t, q)
  loop
    select replace(regexp_replace(lower(coalesce(qual, '')), '[\s()]', '', 'g'), 'public.', '')
      into pol_q
      from pg_policies
     where schemaname = 'public' and tablename = tb and cmd = 'SELECT';

    perform pg_temp.ok(
      (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = tb)
      and pol_q = replace(regexp_replace(lower(exp_q), '[\s()]', '', 'g'), 'public.', '')
      and exists (
        select 1 from pg_trigger t
         where t.tgrelid = ('public.' || tb)::regclass
           and t.tgname = 'trg_bloqueia_agente'
           and t.tgenabled = 'O'
           and t.tgqual is null
           and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
      ),
      'policy SELECT exata e trg_bloqueia_agente ativo/sem WHEN/função certa em ' || tb
    );
  end loop;
end $$;

do $$ begin raise notice 'BLOCO 5 ok: pendencias (§8) e invariantes de catalogo'; end $$;

select set_config('request.jwt.claim.sub', '', false);
rollback;
