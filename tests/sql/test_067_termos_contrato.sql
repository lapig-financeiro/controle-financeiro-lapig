-- ============================================================
-- Roteiro de conferência da migração 067 (F3-A — termos do contrato)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-067-pglite.mjs
-- Antes da 067, o BLOCO 0 falha com 42P01 (tabela ausente). O
-- runner valida esse motivo.
--
-- Base: montarBase064() do rodar-064-pglite.mjs.
-- Identidades:
--   a1 = admin humano ('Victor')
--   b1 = professor, escopo 51.X ('Professor do projeto')
--   b2 = professor, escopo 51.Y ('Prof. Bruno')
--   c1 = agente (Buriti), escopo 51.X
--   d1 = automação (Vigia), sem centros
--
-- Todos os dados são sintéticos e a transação termina em rollback.
-- ============================================================
\set ON_ERROR_STOP on

create or replace function pg_temp.ok067(p boolean, p_motivo text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception '067 FALHOU: %', p_motivo;
  end if;
end $$;

create or replace function pg_temp.falha_com067(p_sql text, p_code text, p_msg_like text default null) returns void
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
      raise exception '067 FALHOU: esperado SQLSTATE %, veio % (%): %', p_code, v_state, v_msg, p_sql;
    end if;
    if p_msg_like is not null and v_msg not like p_msg_like then
      raise exception '067 FALHOU: mensagem "%" não casa com "%": %', v_msg, p_msg_like, p_sql;
    end if;
    return;
  end;
  raise exception '067 FALHOU: operação deveria falhar mas passou: %', p_sql;
end $$;

-- Monta o payload aceito por registrar_termo_contrato_v2. Campo nulo
-- que não se aplica ao termo vai como null (a RPC aceita).
create or replace function pg_temp.corpo067(
  p_project    uuid,
  p_termo      text,
  p_valor_data text,
  p_valor_pct  numeric,
  p_regra      text,
  p_trecho     text,
  p_nota       text default null,
  p_doc        text default 'Contrato sintético 067',
  p_url        text default 'https://drive.google.com/file/d/stub-067/view',
  p_pagina     integer default 2,
  p_origem     text default 'ia',
  p_autor      text default 'Claude',
  p_doc_id     uuid default null
) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'project_id',     p_project::text,
    'termo',          p_termo,
    'valor_data',     p_valor_data,
    'valor_pct',      p_valor_pct,
    'regra',          p_regra,
    'trecho',         p_trecho,
    'documento_nome', p_doc,
    'documento_url',  p_url,
    'documento_id',   p_doc_id,
    'pagina',         p_pagina,
    'nota',           p_nota,
    'origem',         p_origem,
    'autor',          p_autor
  )
$$;

create or replace function pg_temp.total_termos067(p_termos jsonb) returns integer
language sql immutable as $$
  select coalesce(
    sum(1 + coalesce(jsonb_array_length(t.value -> 'versoes_anteriores'), 0)),
    0
  )::integer
    from jsonb_each(coalesce(p_termos, '{}'::jsonb)) as t
$$;

begin;

-- ------------------------------------------------------------
-- BLOCO 0 — a tabela existe e a base sintética está no lugar
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.documentos') is null then
    raise exception '067 FALHOU: base sem a 064 (tabela public.documentos ausente)' using errcode = '42P01';
  end if;

  if to_regclass('public.termos_contrato') is null then
    raise exception '067 FALHOU: tabela public.termos_contrato ausente' using errcode = '42P01';
  end if;

  if (select count(*) from public.projects where code in ('51.X', '51.Y', '63.SB', '63.INAT', '64.EDGE')) <> 5 then
    raise exception '067 FALHOU: base 064 incompleta (faltam projetos 51.X/51.Y/63.SB/63.INAT/64.EDGE)';
  end if;

  if not exists (
    select 1
      from public.documentos d
      join public.projects p on p.id = d.project_id
     where p.code = '51.X' and d.tipo = 'plano'
  ) then
    raise exception '067 FALHOU: stub-064 sem documento de plano no 51.X';
  end if;
end $$;

update public.projects
   set start_date = '2025-12-31', end_date = '2027-08-31', active = true
 where code = '51.X';

update public.projects
   set start_date = '2025-10-01', end_date = '2027-03-31', active = true
 where code = '51.Y';

update public.projects
   set start_date = '2025-01-01', end_date = '2027-01-31', active = true
 where code = '63.SB';

update public.projects
   set start_date = '2024-01-01', end_date = '2026-01-01', active = false
 where code = '63.INAT';

update public.projects
   set start_date = '2025-01-01', end_date = '2027-12-31', active = true
 where code = '64.EDGE';

select set_config(
  'test067.doc_x',
  (select d.id::text
     from public.documentos d
     join public.projects p on p.id = d.project_id
    where p.code = '51.X' and d.tipo = 'plano'
    order by d.criado_em desc
    limit 1),
  true
);
select set_config(
  'test067.doc_y',
  (select d.id::text
     from public.documentos d
     join public.projects p on p.id = d.project_id
    where p.code = '51.Y' and d.tipo = 'balancete'
    order by d.criado_em desc
    limit 1),
  true
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;

-- Guarda os ids antes de trocar para anon (anon não lê projects).
select set_config('test067.x', (select id::text from public.projects where code = '51.X'), true);
select set_config('test067.y', (select id::text from public.projects where code = '51.Y'), true);

-- ------------------------------------------------------------
-- BLOCO 1 — só admin humano escreve; anon não lê nada
-- ------------------------------------------------------------
do $$
declare
  x uuid := (select id from public.projects where code = '51.X');
  u text;
begin
  foreach u in array array[
    '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000d1'
  ] loop
    perform set_config('request.jwt.claim.sub', u, true);
    perform pg_temp.falha_com067(
      format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
        pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', 'trecho')::text),
      '42501'
    );
    perform pg_temp.falha_com067(
      format($q$select public.conferir_termo_contrato_v2(%L::uuid)$q$, gen_random_uuid()::text),
      '42501'
    );
    perform pg_temp.falha_com067(
      format($q$select public.usar_vigencia_do_contrato_v2(%L::uuid)$q$, x::text),
      '42501'
    );
  end loop;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
end $$;

-- anon não tem SELECT na tabela nem EXECUTE nas RPCs
reset role;
set local role anon;
select pg_temp.falha_com067(
  format('select count(*) from public.termos_contrato'),
  '42501'
);
select pg_temp.falha_com067(
  format($q$select public.get_termos_contrato_v2(%L::uuid)$q$, current_setting('test067.x')),
  '42501'
);
reset role;
set local role authenticated;

-- ------------------------------------------------------------
-- BLOCO 2 — validação do payload e barreira no nível da tabela
-- ------------------------------------------------------------
do $$
declare
  x uuid := (select id from public.projects where code = '51.X');
  base jsonb;
begin
  base := pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', 'trecho');

  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$, (base || '{"extra":1}'::jsonb)::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      jsonb_set(base, '{termo}', '"vigencia_qualquer"')::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      jsonb_set(base, '{valor_pct}', '8')::text),
    '22023'
  );

  -- taxa com valor_data (o helper aceita a data e o RPC recusa)
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      (pg_temp.corpo067(x, 'taxa_cip_ufg', '2027-08-31', 8, 'regra', 'trecho'))::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      (pg_temp.corpo067(x, 'taxa_total', '2027-08-31', 12.5, 'regra', 'trecho'))::text),
    '22023'
  );

  -- Fonte: pelo menos um entre documento_url e documento_id.
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', 'trecho',
        p_url => null)::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', 'trecho',
        p_url => null, p_doc_id => current_setting('test067.doc_y')::uuid)::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', 'trecho',
        p_url => null, p_doc_id => gen_random_uuid())::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      jsonb_set(base, '{documento_id}', '"nao-e-uuid"')::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'taxa_cip_ufg', null, 101, 'regra', 'trecho')::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'taxa_cip_ufg', null, -1, 'regra', 'trecho')::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'vigencia_fim', '2027-02-31', null, 'regra', 'trecho')::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', 'trecho',
        null, 'Contrato', 'http://drive.google.com/file/d/x/view')::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', 'trecho',
        null, 'Contrato', 'https://drive.google.com/file/d/x/view', 0)::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      jsonb_set(base, '{pagina}', '1.5')::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', 'CPF 529.982.247-25')::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', 'trecho',
        null, 'Contrato', 'https://drive.google.com/file/d/x/view', 2, 'ia', repeat('a', 61))::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', 'trecho',
        repeat('n', 2001))::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      jsonb_set(base, '{project_id}', '"nao-e-uuid"')::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      jsonb_set(base, '{origem}', '"sistema"')::text),
    '22023'
  );
  perform pg_temp.falha_com067(
    format($q$select public.registrar_termo_contrato_v2(%L::jsonb)$q$,
      pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null, 'regra', '')::text),
    '22023'
  );

  -- Nenhuma dessas tentativas gravou nada.
  perform pg_temp.ok067(
    public.get_termos_contrato_v2(x) -> 'termos' = '{}'::jsonb,
    'validações não podem gravar linha'
  );

  -- INSERT direto como authenticated não existe (só SELECT).
  perform pg_temp.falha_com067(
    format($q$insert into public.termos_contrato
               (project_id, termo, valor_data, trecho, documento_nome, origem, autor)
             values (%L::uuid, 'vigencia_fim', '2027-08-31', 'trecho', 'Contrato', 'pessoa', 'Teste')$q$, x::text),
    '42501'
  );
end $$;

-- O CHECK de CPF também barra o dono da tabela (prova de que está no dado).
reset role;
select pg_temp.falha_com067(
  format($q$insert into public.termos_contrato
             (project_id, termo, valor_data, trecho, documento_nome, origem, autor)
           values (%L::uuid, 'vigencia_fim', '2027-08-31', 'CPF 529.982.247-25', 'Contrato', 'pessoa', 'Teste')$q$,
    (select id from public.projects where code = '51.X')::text),
  '23514'
);
select pg_temp.falha_com067(
  format($q$insert into public.termos_contrato
             (project_id, termo, valor_data, trecho, documento_nome, origem, autor)
           values (%L::uuid, 'vigencia_fim', '2027-08-31', 'trecho', 'Contrato', 'pessoa', 'Teste')$q$,
    (select id from public.projects where code = '51.X')::text),
  '23514'
);
set local role authenticated;

-- ------------------------------------------------------------
-- BLOCO 3 — registros válidos do 51.X, idempotência e conferência
-- ------------------------------------------------------------
do $$
declare
  x       uuid := (select id from public.projects where code = '51.X');
  v_ini   jsonb;
  v_fim   jsonb;
  v_total jsonb;
  v_t1    jsonb;
  v_t2    jsonb;
  v_t3    jsonb;
  v_novo  jsonb;
  v_id_fim uuid;
  v_id_2  uuid;
  v_id_3  uuid;
  v_count integer;
  v_payload jsonb;
  v_antes timestamptz;
  v_depois timestamptz;
  v_conf   jsonb;
begin
  v_ini := public.registrar_termo_contrato_v2(
    pg_temp.corpo067(x, 'vigencia_inicio', '2025-12-31', null,
      '20 meses contados da última assinatura (31/12/2025)',
      'CLÁUSULA SEGUNDA — a vigência é de 20 (vinte) meses, contados da data da última assinatura.'));

  v_fim := public.registrar_termo_contrato_v2(
    pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null,
      '20 meses contados da última assinatura (31/12/2025)',
      'CLÁUSULA SEGUNDA — a vigência é de 20 (vinte) meses, contados da data da última assinatura.',
      'O cadastro estava com a mesma data; a regra veio do contrato. Conferido com a coordenação.'));

  -- Taxa total do financiador, com o plano de trabalho como fonte (064).
  v_total := public.registrar_termo_contrato_v2(
    pg_temp.corpo067(x, 'taxa_total', null, 12.5,
      'percentual total de custos indiretos do financiador',
      'ANEXO — Project Overhead: 12,5% do valor total do projeto.',
      'O contrato fixa 12,5% no total; o plano divide 8+8+10=26%. A diferença está no plano e não é corrigida aqui.',
      p_url => null, p_doc_id => current_setting('test067.doc_x')::uuid));

  v_t1 := public.registrar_termo_contrato_v2(
    pg_temp.corpo067(x, 'taxa_cip_ufg', null, 8,
      'percentual sobre o valor do projeto',
      'CLÁUSULA QUARTA — taxa de administração de 8% (oito por cento) para a UFG.'));
  v_t2 := public.registrar_termo_contrato_v2(
    pg_temp.corpo067(x, 'taxa_cip_ua', null, 8,
      'percentual sobre o valor do projeto',
      'CLÁUSULA QUARTA — taxa de administração de 8% (oito por cento) para a unidade executora.'));
  v_t3 := public.registrar_termo_contrato_v2(
    pg_temp.corpo067(x, 'taxa_dao', null, 10,
      'percentual sobre o valor do projeto',
      'CLÁUSULA QUINTA — taxa de 10% (dez por cento) para a fundação de apoio.'));

  v_id_fim := (v_fim ->> 'id')::uuid;

  perform pg_temp.ok067((v_ini ->> 'criado')::boolean, 'vigencia_inicio deveria ser criada');
  perform pg_temp.ok067((v_total ->> 'criado')::boolean, 'taxa_total deveria ser criada');
  perform pg_temp.ok067((v_t1 ->> 'criado')::boolean, 'taxa_cip_ufg deveria ser criada');
  perform pg_temp.ok067((v_t2 ->> 'criado')::boolean, 'taxa_cip_ua deveria ser criada');
  perform pg_temp.ok067((v_t3 ->> 'criado')::boolean, 'taxa_dao deveria ser criada');

  v_count := pg_temp.total_termos067(public.get_termos_contrato_v2(x) -> 'termos');
  perform pg_temp.ok067(v_count = 6, format('deveriam existir 6 registros no 51.X, há %s', v_count));
  -- Contagem como dono da tabela: authenticated não lê direto (BLOCO 4).
  reset role;
  perform pg_temp.ok067(
    (select count(*) from public.termos_contrato where project_id = x and criado_por = '00000000-0000-0000-0000-0000000000a1') = 6,
    'criado_por deveria ser o admin que registrou'
  );
  set local role authenticated;

  -- Mesmo conteúdo: devolve o mesmo id e não insere.
  v_payload := pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null,
    '20 meses contados da última assinatura (31/12/2025)',
    'CLÁUSULA SEGUNDA — a vigência é de 20 (vinte) meses, contados da data da última assinatura.',
    'O cadastro estava com a mesma data; a regra veio do contrato. Conferido com a coordenação.');
  v_novo := public.registrar_termo_contrato_v2(v_payload);
  v_id_2 := (v_novo ->> 'id')::uuid;
  perform pg_temp.ok067(v_id_2 = v_id_fim, 'idempotência deveria devolver o mesmo id');
  perform pg_temp.ok067(not (v_novo ->> 'criado')::boolean, 'idempotência deveria devolver criado=false');
  v_count := pg_temp.total_termos067(public.get_termos_contrato_v2(x) -> 'termos');
  perform pg_temp.ok067(v_count = 6, format('idempotência não pode inserir (há %s registros)', v_count));

  -- Regra diferente = versão nova (o texto que explica a data mudou).
  v_novo := public.registrar_termo_contrato_v2(
    pg_temp.corpo067(x, 'vigencia_fim', '2027-08-31', null,
      '20 meses contados da última assinatura (02/01/2026) — retificada',
      'CLÁUSULA SEGUNDA — a vigência é de 20 (vinte) meses, contados da data da última assinatura.',
      'O cadastro estava com a mesma data; a regra veio do contrato. Conferido com a coordenação.'));
  v_id_3 := (v_novo ->> 'id')::uuid;
  perform pg_temp.ok067(v_id_3 <> v_id_fim, 'regra diferente deveria criar uma versão nova');
  perform pg_temp.ok067((v_novo ->> 'criado')::boolean, 'versão com regra nova deveria ser criada');
  v_count := pg_temp.total_termos067(public.get_termos_contrato_v2(x) -> 'termos');
  perform pg_temp.ok067(v_count = 7, format('deveriam existir 7 registros no 51.X, há %s', v_count));

  -- Conferência: marca uma vez e não muda a data na segunda chamada.
  -- A versão vigente é a última (v_id_3), não a primeira.
  v_conf := public.conferir_termo_contrato_v2(v_id_3);
  perform pg_temp.ok067(not (v_conf ->> 'ja_estava')::boolean, 'primeira conferência deveria marcar');
  perform pg_temp.ok067((v_conf ->> 'conferido_por')::uuid = '00000000-0000-0000-0000-0000000000a1',
    'conferido_por deveria ser o admin');
  v_antes := (v_conf ->> 'conferido_em')::timestamptz;
  v_conf := public.conferir_termo_contrato_v2(v_id_3);
  perform pg_temp.ok067((v_conf ->> 'ja_estava')::boolean, 'segunda conferência deveria ser idempotente');
  v_depois := (v_conf ->> 'conferido_em')::timestamptz;
  perform pg_temp.ok067(v_antes = v_depois, 'segunda conferência não pode mudar conferido_em');

  -- Professor e agente não conferem.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  perform pg_temp.falha_com067(
    format($q$select public.conferir_termo_contrato_v2(%L::uuid)$q$, v_id_3::text), '42501');
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
  perform pg_temp.falha_com067(
    format($q$select public.conferir_termo_contrato_v2(%L::uuid)$q$, v_id_3::text), '42501');
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
end $$;

-- ------------------------------------------------------------
-- BLOCO 4 — get_termos_contrato_v2: vigência, taxas, nota e escopo
-- ------------------------------------------------------------
do $$
declare
  x uuid := (select id from public.projects where code = '51.X');
  r jsonb;
  t jsonb;
begin
  r := public.get_termos_contrato_v2(x);

  perform pg_temp.ok067(r ->> 'end_date_cadastro' = '2027-08-31',
    format('end_date_cadastro deveria ser 2027-08-31, veio %s', r ->> 'end_date_cadastro'));
  perform pg_temp.ok067((r ->> 'vigencia_confere')::boolean, 'vigencia_confere deveria ser true');

  t := r -> 'termos' -> 'vigencia_fim';
  perform pg_temp.ok067(t ->> 'valor' = '2027-08-31', 'valor da vigencia_fim errado');
  perform pg_temp.ok067(t ->> 'documento_nome' = 'Contrato sintético 067', 'documento_nome errado');
  perform pg_temp.ok067(t ->> 'documento_url' = 'https://drive.google.com/file/d/stub-067/view', 'documento_url errado');
  perform pg_temp.ok067((t ->> 'pagina')::integer = 2, 'pagina errada');
  perform pg_temp.ok067(t ->> 'origem' = 'ia', 'origem errada');
  perform pg_temp.ok067(t ->> 'autor' = 'Claude', 'autor errado');
  perform pg_temp.ok067((t ->> 'conferido')::boolean, 'vigencia_fim deveria estar conferida');
  perform pg_temp.ok067((t ->> 'nota') is not null, 'admin deveria receber a nota');
  perform pg_temp.ok067(jsonb_array_length(t -> 'versoes_anteriores') = 1,
    format('vigencia_fim deveria ter 1 versão anterior, veio %s', jsonb_array_length(t -> 'versoes_anteriores')));
  perform pg_temp.ok067((t -> 'versoes_anteriores' -> 0 ->> 'valor') = '2027-08-31',
    'versão anterior deveria manter o valor');

  -- Taxa total: 12,5%, fonte documento_id (plano), sem URL.
  perform pg_temp.ok067((r -> 'termos' -> 'taxa_total' ->> 'valor')::numeric = 12.5,
    'taxa_total deveria ser 12,5');
  perform pg_temp.ok067((r -> 'termos' -> 'taxa_total' ->> 'documento_id') = current_setting('test067.doc_x'),
    'taxa_total deveria apontar para o documento do plano');
  perform pg_temp.ok067((r -> 'termos' -> 'taxa_total' -> 'documento' ->> 'bucket') = 'plano-trabalho-docs',
    'metadado do documento deveria ter bucket de plano');
  perform pg_temp.ok067((r -> 'termos' -> 'taxa_total' -> 'documento' ->> 'caminho') is not null,
    'metadado do documento deveria ter caminho');
  perform pg_temp.ok067((r -> 'termos' -> 'taxa_total' -> 'documento' ->> 'formato') = 'docx',
    'metadado do documento deveria ter formato docx');
  perform pg_temp.ok067((r -> 'termos' -> 'taxa_total' -> 'documento' ->> 'versao')::integer >= 1,
    'metadado do documento deveria ter versão');

  -- Taxas: 8 + 8 + 10 = 26 (soma só para exibir; nada arredondado aqui).
  -- O total do contrato é 12,5: o banco devolve os dois números e não corrige.
  perform pg_temp.ok067((r -> 'termos' -> 'taxa_cip_ufg' ->> 'valor')::numeric = 8, 'taxa_cip_ufg errada');
  perform pg_temp.ok067((r -> 'termos' -> 'taxa_cip_ua' ->> 'valor')::numeric = 8, 'taxa_cip_ua errada');
  perform pg_temp.ok067((r -> 'termos' -> 'taxa_dao' ->> 'valor')::numeric = 10, 'taxa_dao errada');
  perform pg_temp.ok067(
    (r -> 'termos' -> 'taxa_cip_ufg' ->> 'valor')::numeric +
    (r -> 'termos' -> 'taxa_cip_ua' ->> 'valor')::numeric +
    (r -> 'termos' -> 'taxa_dao' ->> 'valor')::numeric = 26,
    'soma das taxas deveria ser 26'
  );
  perform pg_temp.ok067(
    (r -> 'termos' -> 'taxa_total' ->> 'valor')::numeric is distinct from (
      (r -> 'termos' -> 'taxa_cip_ufg' ->> 'valor')::numeric +
      (r -> 'termos' -> 'taxa_cip_ua' ->> 'valor')::numeric +
      (r -> 'termos' -> 'taxa_dao' ->> 'valor')::numeric
    ),
    'o banco não pode corrigir a diferença entre total e divisão'
  );

  -- Professor do 51.X vê os termos, mas não a nota.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  r := public.get_termos_contrato_v2(x);
  perform pg_temp.ok067((r -> 'termos' -> 'vigencia_fim' ->> 'nota') is null,
    'professor não pode receber a nota');
  perform pg_temp.ok067((r -> 'termos' -> 'vigencia_fim' ->> 'valor') = '2027-08-31',
    'professor deveria ver o valor');
  perform pg_temp.ok067((r ->> 'vigencia_confere')::boolean, 'professor deveria ver vigencia_confere');
  perform pg_temp.ok067((r -> 'termos' -> 'taxa_total' -> 'documento' ->> 'bucket') = 'plano-trabalho-docs',
    'professor deveria ver o metadado do documento do plano');

  -- Professor de outro centro não atravessa o escopo.
  perform pg_temp.falha_com067(
    format($q$select public.get_termos_contrato_v2(%L::uuid)$q$,
      (select id from public.projects where code = '51.Y')::text),
    null,
    'Acesso negado%'
  );

  -- Agente do 51.X lê, mas também sem nota.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
  r := public.get_termos_contrato_v2(x);
  perform pg_temp.ok067((r -> 'termos' -> 'vigencia_fim' ->> 'nota') is null,
    'agente não pode receber a nota');
  perform pg_temp.ok067(r -> 'termos' -> 'taxa_total' -> 'documento' = 'null'::jsonb,
    'agente não pode receber o caminho do documento do plano');

  -- Nenhum papel humano lê a tabela direto: a nota sairia por
  -- GET /rest/v1/termos_contrato?select=nota. Agente, professores e
  -- admin recebem 42501; a leitura é só pela RPC definer.
  perform pg_temp.falha_com067(
    'select count(*) from public.termos_contrato',
    '42501'
  );
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  perform pg_temp.falha_com067(
    'select count(*) from public.termos_contrato',
    '42501'
  );
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
  perform pg_temp.falha_com067(
    'select count(*) from public.termos_contrato',
    '42501'
  );

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  perform pg_temp.falha_com067(
    'select count(*) from public.termos_contrato',
    '42501'
  );

  perform pg_temp.falha_com067(
    'select public.get_termos_contrato_v2(null)',
    '22023'
  );
end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — divergência, usar_vigencia e "não toca em mais nada"
-- ------------------------------------------------------------
do $$
declare
  y uuid := (select id from public.projects where code = '51.Y');
  x uuid := (select id from public.projects where code = '51.X');
  r jsonb;
  u jsonb;
  v_antes_x jsonb;
  v_antes_y jsonb;
  v_depois_y jsonb;
begin
  -- Contrato do 51.Y: fim 30/04/2027; cadastro 31/03/2027.
  perform public.registrar_termo_contrato_v2(
    pg_temp.corpo067(y, 'vigencia_inicio', '2025-10-15', null,
      '20 meses contados da última assinatura (15/10/2025)',
      'CLÁUSULA SEGUNDA — 20 meses contados da última assinatura.',
      'A segunda assinatura foi posterior; o cadastro usa a primeira.'));
  perform public.registrar_termo_contrato_v2(
    pg_temp.corpo067(y, 'vigencia_fim', '2027-04-30', null,
      '20 meses contados da última assinatura (15/10/2025)',
      'CLÁUSULA SEGUNDA — 20 meses contados da última assinatura.',
      'O cadastro está com 31/03/2027; a diferença veio da última assinatura.'));

  r := public.get_termos_contrato_v2(y);
  perform pg_temp.ok067(r ->> 'end_date_cadastro' = '2027-03-31',
    format('end_date_cadastro do 51.Y deveria ser 2027-03-31, veio %s', r ->> 'end_date_cadastro'));
  perform pg_temp.ok067(not (r ->> 'vigencia_confere')::boolean,
    'vigencia_confere do 51.Y deveria ser false');

  select to_jsonb(p) - 'start_date' - 'end_date' - 'updated_at'
    into v_antes_x
    from public.projects p where p.id = x;
  select to_jsonb(p) - 'start_date' - 'end_date' - 'updated_at'
    into v_antes_y
    from public.projects p where p.id = y;

  u := public.usar_vigencia_do_contrato_v2(y);
  perform pg_temp.ok067((u -> 'antes' ->> 'end_date') = '2027-03-31', 'antes.end_date errado');
  perform pg_temp.ok067((u -> 'antes' ->> 'start_date') = '2025-10-01', 'antes.start_date errado');
  perform pg_temp.ok067((u -> 'depois' ->> 'end_date') = '2027-04-30', 'depois.end_date errado');
  perform pg_temp.ok067((u -> 'depois' ->> 'start_date') = '2025-10-15', 'depois.start_date errado');
  perform pg_temp.ok067((u ->> 'mudou')::boolean, 'usar_vigencia deveria dizer que mudou');

  select to_jsonb(p) - 'start_date' - 'end_date' - 'updated_at'
    into v_depois_y
    from public.projects p where p.id = y;
  perform pg_temp.ok067(v_antes_y = v_depois_y,
    'usar_vigencia não pode mudar outra coluna do centro (fora updated_at)');

  perform pg_temp.ok067(
    (select end_date from public.projects where id = x) = '2027-08-31',
    'usar_vigencia do 51.Y não pode tocar no 51.X'
  );
  perform pg_temp.ok067(
    (select to_jsonb(p) - 'start_date' - 'end_date' - 'updated_at' from public.projects p where p.id = x) = v_antes_x,
    'usar_vigencia do 51.Y não pode tocar em outra coluna do 51.X'
  );

  r := public.get_termos_contrato_v2(y);
  perform pg_temp.ok067((r ->> 'vigencia_confere')::boolean,
    'depois de usar, a vigência do 51.Y deveria conferir');

  u := public.usar_vigencia_do_contrato_v2(y);
  perform pg_temp.ok067(not (u ->> 'mudou')::boolean, 'usar_vigencia repetido deveria ser idempotente');

  -- Sem termo de vigência: recusa e não muda a data.
  perform pg_temp.falha_com067(
    format($q$select public.usar_vigencia_do_contrato_v2(%L::uuid)$q$,
      (select id from public.projects where code = '63.SB')::text),
    '22023'
  );
  perform pg_temp.ok067(
    (select end_date from public.projects where code = '63.SB') = '2027-01-31',
    'sem termo não pode mudar a data do 63.SB'
  );

  -- Projeto inativo: usar a vigência não reativa o centro.
  perform public.registrar_termo_contrato_v2(
    pg_temp.corpo067(
      (select id from public.projects where code = '63.INAT'),
      'vigencia_fim', '2027-06-30', null,
      'vigência do contrato', 'CLÁUSULA SEGUNDA — vigência até 30/06/2027.'));
  u := public.usar_vigencia_do_contrato_v2((select id from public.projects where code = '63.INAT'));
  perform pg_temp.ok067((u -> 'depois' ->> 'end_date') = '2027-06-30', 'inativo deveria receber a data');
  perform pg_temp.ok067(
    (select active from public.projects where code = '63.INAT') = false,
    'usar_vigencia não pode reativar o centro inativo'
  );

  -- Professor e agente não usam.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  perform pg_temp.falha_com067(
    format($q$select public.usar_vigencia_do_contrato_v2(%L::uuid)$q$, y::text), '42501');
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
  perform pg_temp.falha_com067(
    format($q$select public.usar_vigencia_do_contrato_v2(%L::uuid)$q$, y::text), '42501');

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
end $$;

-- ------------------------------------------------------------
-- BLOCO 6 — admin lê tudo; updated_at muda só pelo gatilho da 001
-- ------------------------------------------------------------
do $$
declare
  total integer;
begin
  -- Contagem como dono da tabela; o BLOCO 4 prova que authenticated
  -- (inclusive admin) não tem SELECT direto.
  reset role;
  total := (select count(*) from public.termos_contrato);
  set local role authenticated;
  perform pg_temp.ok067(total = 10, format('admin deveria ver 10 linhas (7 do 51.X + 2 do 51.Y + 1 do 63.INAT), viu %s', total));
end $$;

reset role;
rollback;
