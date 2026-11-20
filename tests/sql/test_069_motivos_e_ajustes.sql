-- ============================================================
-- Roteiro de conferência da migração 069 (F3-C)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-069-pglite.mjs
-- Antes da 069, o BLOCO 0 falha com 42883 (situacao_centro_v2
-- ausente). O runner valida esse motivo e prova o defeito antigo.
--
-- Base: montarBase064() + 064 + stub-064 + 065 + 066 + 067 + 068.
-- Identidades (criadas por montarBase064):
--   a1 = admin humano (Victor)
--   b1 = professor, escopo 51.X e 63.INAT
--   b2 = professor, escopo 51.Y
--   c1 = agente (Buriti), escopo 51.X
--   d1 = automação (Vigia), sem centros
--
-- Todos os dados são sintéticos e a transação termina em rollback.
-- ============================================================
\set ON_ERROR_STOP on

create or replace function pg_temp.ok069(p boolean, p_motivo text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception '069 FALHOU: %', p_motivo;
  end if;
end $$;

create or replace function pg_temp.falha_com069(p_sql text, p_code text, p_msg_like text default null)
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
      raise exception '069 FALHOU: esperado SQLSTATE %, veio % (%): %', p_code, v_state, v_msg, p_sql;
    end if;
    if p_msg_like is not null and v_msg not like p_msg_like then
      raise exception '069 FALHOU: mensagem "%" não casa com "%": %', v_msg, p_msg_like, p_sql;
    end if;
    return;
  end;
  raise exception '069 FALHOU: operação deveria falhar mas passou: %', p_sql;
end $$;

create or replace function pg_temp.centro069(p_resumo jsonb, p_code text) returns jsonb
language sql immutable as $$
  select value
    from jsonb_array_elements(coalesce(p_resumo -> 'centros', '[]'::jsonb))
   where value ->> 'code' = p_code
   limit 1
$$;

create or replace function pg_temp.motivo069(p_sit jsonb, p_codigo text) returns jsonb
language sql immutable as $$
  select value
    from jsonb_array_elements(coalesce(p_sit -> 'motivos', '[]'::jsonb))
   where value ->> 'codigo' = p_codigo
   limit 1
$$;

create or replace function pg_temp.codigos_motivos069(p_sit jsonb) returns text[]
language sql immutable as $$
  select array_agg(m.value ->> 'codigo' order by m.ord)
    from jsonb_array_elements(coalesce(p_sit -> 'motivos', '[]'::jsonb))
         with ordinality as m(value, ord)
$$;

create or replace function pg_temp.tem_motivo069(p_sit jsonb, p_codigo text) returns boolean
language sql immutable as $$
  select exists (
    select 1
      from jsonb_array_elements(coalesce(p_sit -> 'motivos', '[]'::jsonb)) m
     where m ->> 'codigo' = p_codigo
  )
$$;

create or replace function pg_temp.texto_motivo069(p_sit jsonb, p_codigo text) returns text
language sql immutable as $$
  select value ->> 'texto'
    from jsonb_array_elements(coalesce(p_sit -> 'motivos', '[]'::jsonb))
   where value ->> 'codigo' = p_codigo
   limit 1
$$;

begin;

-- ------------------------------------------------------------
-- BLOCO 0 — a migração existe (antes dela, 42883)
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.situacao_centro_v2(uuid)') is null then
    raise exception '069 FALHOU: situacao_centro_v2 ausente' using errcode = '42883';
  end if;
  if to_regprocedure('public._situacao_centro(uuid, jsonb, integer)') is null then
    raise exception '069 FALHOU: _situacao_centro ausente' using errcode = '42883';
  end if;
  perform pg_temp.ok069(
    to_regprocedure('public.resumo_projetos_v2()') is not null,
    'resumo_projetos_v2 ausente'
  );
end $$;

-- ------------------------------------------------------------
-- BLOCO 1 — massa sintética da 069 (dono da tabela)
-- ------------------------------------------------------------
insert into public.projects (id, name, code, start_date, end_date, active) values
  ('00000000-0000-4000-8000-000000069001', 'Teste 069 Tarifa',        '69.TARIFA',   current_date - 30, current_date + 365, true),
  ('00000000-0000-4000-8000-000000069002', 'Teste 069 Misto',         '69.MISTO',    current_date - 30, current_date + 365, true),
  ('00000000-0000-4000-8000-000000069003', 'Teste 069 Tarifa Desc',   '69.DESC',     current_date - 30, current_date + 365, true),
  ('00000000-0000-4000-8000-000000069004', 'Teste 069 Despesa Comum', '69.COMUM',    current_date - 30, current_date + 365, true),
  ('00000000-0000-4000-8000-000000069005', 'Teste 069 Atrasado',      '69.ATRASADO', current_date - 30, current_date + 365, true),
  ('00000000-0000-4000-8000-000000069006', 'Teste 069 Ordem',         '69.ORDEM',    current_date - 30, current_date + 365, true);

insert into public.planos_trabalho (id, project_id, versao, tipo, ativo, valor_total_plano) values
  ('00000000-0000-4000-8000-000000069101', '00000000-0000-4000-8000-000000069001', 0, 'original', true, 0),
  ('00000000-0000-4000-8000-000000069102', '00000000-0000-4000-8000-000000069002', 0, 'original', true, 50),
  ('00000000-0000-4000-8000-000000069103', '00000000-0000-4000-8000-000000069003', 0, 'original', true, 0),
  ('00000000-0000-4000-8000-000000069104', '00000000-0000-4000-8000-000000069004', 0, 'original', true, 0),
  ('00000000-0000-4000-8000-000000069105', '00000000-0000-4000-8000-000000069005', 0, 'original', true, 1000),
  ('00000000-0000-4000-8000-000000069106', '00000000-0000-4000-8000-000000069006', 0, 'original', true, 0);

insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
  ('00000000-0000-4000-8000-000000069102', 'b', 50.00),
  ('00000000-0000-4000-8000-000000069105', 'b', 1000.00);

insert into public.balancetes (id, project_id, data_referencia) values
  ('00000000-0000-4000-8000-000000069201', '00000000-0000-4000-8000-000000069001', current_date),
  ('00000000-0000-4000-8000-000000069202', '00000000-0000-4000-8000-000000069002', current_date),
  ('00000000-0000-4000-8000-000000069203', '00000000-0000-4000-8000-000000069003', current_date),
  ('00000000-0000-4000-8000-000000069204', '00000000-0000-4000-8000-000000069004', current_date),
  ('00000000-0000-4000-8000-000000069205', '00000000-0000-4000-8000-000000069005', (current_date - interval '2 months')::date),
  ('00000000-0000-4000-8000-000000069206', '00000000-0000-4000-8000-000000069006', (current_date - interval '2 months')::date);

insert into public.balancete_lancamentos (id, balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code) values
  ('00000000-0000-4000-8000-000000069301', '00000000-0000-4000-8000-000000069201', '7.1.3.05.01.00054', 'DESPESA SERVIÇOS BANCÁRIOS',       14.34, 'b'),
  ('00000000-0000-4000-8000-000000069302', '00000000-0000-4000-8000-000000069202', '7.1.3.05.01.00054', 'DESPESA SERVIÇOS BANCÁRIOS',       14.34, 'b'),
  ('00000000-0000-4000-8000-000000069303', '00000000-0000-4000-8000-000000069202', '7.1.3.05.01.00014', 'INSCRIÇÃO CONGRESSO',             100.00, 'b'),
  ('00000000-0000-4000-8000-000000069304', '00000000-0000-4000-8000-000000069203', '7.9.9.99.99999',    'Tarifa bancária mensal',           14.34, 'b'),
  ('00000000-0000-4000-8000-000000069305', '00000000-0000-4000-8000-000000069204', '7.1.3.05.01.00027', 'SERVIÇOS ANÁLISE PESQ. CIENTÍFICA', 100.00, 'b'),
  ('00000000-0000-4000-8000-000000069306', '00000000-0000-4000-8000-000000069205', '7.1.3.05.01.00027', 'SERVIÇOS ANÁLISE PESQ. CIENTÍFICA', 100.00, 'b'),
  ('00000000-0000-4000-8000-000000069307', '00000000-0000-4000-8000-000000069206', '7.1.3.05.01.00054', 'DESPESA SERVIÇOS BANCÁRIOS',       14.34, 'b'),
  ('00000000-0000-4000-8000-000000069308', '00000000-0000-4000-8000-000000069206', '7.1.3.20.50.00003', 'APARELHOS E EQUIPAMENTOS',        100.00, 'f');

-- Quatro pendências abertas no 69.ORDEM: três mais antigas + "e mais 1".
insert into public.pendencias (id, chave, project_id, tipo, titulo, detalhe, situacao, origem, criada_em) values
  ('00000000-0000-4000-8000-000000069401', 'teste069:ordem:1', '00000000-0000-4000-8000-000000069006', 'balancete', 'Pendência mais antiga', '{}'::jsonb, 'aberta', 'sistema', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000069402', 'teste069:ordem:2', '00000000-0000-4000-8000-000000069006', 'plano',     'Segunda pendência',     '{}'::jsonb, 'aberta', 'sistema', now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000069403', 'teste069:ordem:3', '00000000-0000-4000-8000-000000069006', 'bolsas',    'Terceira pendência',    '{}'::jsonb, 'aberta', 'sistema', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000069404', 'teste069:ordem:4', '00000000-0000-4000-8000-000000069006', 'contrato',  'Pendência mais nova',   '{}'::jsonb, 'aberta', 'sistema', now() - interval '1 day');

-- Pessoa visível fora da janela de 180 dias: entra na visibilidade, mas
-- não na lista do pedido.
insert into public.scholarship_holders (id, full_name) values
  ('00000000-0000-4000-8000-000000069901', 'Pessoa fora da janela 069'),
  ('00000000-0000-4000-8000-000000069902', 'Pessoa na janela 069');

insert into public.scholarships (id, holder_id, project_id, amount, start_date, end_date, status) values
  ('00000000-0000-4000-8000-000000069a01', '00000000-0000-4000-8000-000000069901',
   (select id from public.projects where code = '51.X'), 100.00,
   current_date - 500, current_date - 200, 'ended'),
  ('00000000-0000-4000-8000-000000069a02', '00000000-0000-4000-8000-000000069902',
   (select id from public.projects where code = '51.X'), 100.00,
   current_date - 30, current_date + 100, 'active');

-- Duas caixas de origem do b1, com a pessoa repetida (dado montado pelo
-- dono da tabela, fora das RPCs), e uma caixa de destino.
insert into public.caixas_pedido (id, nome, meses, dono, criado_em) values
  ('00000000-0000-4000-8000-000000069b01', 'Origem antiga 069', 12, '00000000-0000-0000-0000-0000000000b1', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000069b02', 'Origem nova 069',   12, '00000000-0000-0000-0000-0000000000b1', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000069b03', 'Destino 069',       12, '00000000-0000-0000-0000-0000000000b1', now());

insert into public.caixa_pedido_itens (caixa_id, holder_id, valor_mensal, nota) values
  ('00000000-0000-4000-8000-000000069b01', '00000000-0000-4000-8000-000000069902', 111.00, 'nota da origem antiga'),
  ('00000000-0000-4000-8000-000000069b02', '00000000-0000-4000-8000-000000069902', 222.00, 'nota da origem nova');

select set_config('test069.tarifa',   (select id::text from public.projects where code = '69.TARIFA'),   true);
select set_config('test069.misto',    (select id::text from public.projects where code = '69.MISTO'),    true);
select set_config('test069.desc',     (select id::text from public.projects where code = '69.DESC'),     true);
select set_config('test069.comum',    (select id::text from public.projects where code = '69.COMUM'),    true);
select set_config('test069.atrasado', (select id::text from public.projects where code = '69.ATRASADO'), true);
select set_config('test069.ordem',    (select id::text from public.projects where code = '69.ORDEM'),    true);
select set_config('test069.x',        (select id::text from public.projects where code = '51.X'),        true);
select set_config('test069.sb',       (select id::text from public.projects where code = '63.SB'),       true);
select set_config('test069.sp',       (select id::text from public.projects where code = '63.SP'),       true);

set local role authenticated;

-- ------------------------------------------------------------
-- BLOCO 2 — resumo_projetos_v2: tarifa, problema, descrição, comum,
-- atraso, ordem dos motivos, em dia, sem plano e sem balancete
-- ------------------------------------------------------------
do $$
declare
  r      jsonb;
  c      jsonb;
  s      jsonb;
  m      jsonb;
  v_keys text[];
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  r := public.resumo_projetos_v2();

  -- Centro só com tarifa: atenção, motivo com o valor escrito.
  c := pg_temp.centro069(r, '69.TARIFA');
  perform pg_temp.ok069(c is not null, '69.TARIFA deveria aparecer no resumo do admin');
  perform pg_temp.ok069(c ->> 'situacao' = 'atenção',
    format('69.TARIFA deveria ficar em atenção pela tarifa, veio %s', c ->> 'situacao'));
  perform pg_temp.ok069((c ->> 'pendencias_abertas')::integer = 0,
    '69.TARIFA não deveria ter pendência aberta');
  perform pg_temp.ok069(c -> 'erro' = 'null'::jsonb, '69.TARIFA não deveria ter erro');
  perform pg_temp.ok069(jsonb_array_length(c -> 'motivos') = 1,
    format('69.TARIFA deveria ter 1 motivo, veio %s', jsonb_array_length(c -> 'motivos')));
  m := pg_temp.motivo069(c, 'tarifa_bancaria');
  perform pg_temp.ok069(m is not null, '69.TARIFA deveria ter o motivo tarifa_bancaria');
  perform pg_temp.ok069(m ->> 'nivel' = 'atenção', 'tarifa_bancaria deveria ser atenção');
  perform pg_temp.ok069(m ->> 'grupo_code' = 'b', 'tarifa_bancaria deveria apontar o grupo b');
  perform pg_temp.ok069((m ->> 'valor')::numeric = 14.34,
    format('tarifa_bancaria deveria valer 14,34, veio %s', m ->> 'valor'));
  perform pg_temp.ok069(m ->> 'texto' like '%R$ 14,34 de tarifa bancária%',
    format('o texto da tarifa deveria citar R$ 14,34: %s', m ->> 'texto'));
  perform pg_temp.ok069(m ->> 'texto' like '%FUNAPE%',
    'o texto da tarifa deveria explicar a cobrança da FUNAPE');

  -- Tarifa + outra despesa que passa do previsto: problema com os dois fatos.
  c := pg_temp.centro069(r, '69.MISTO');
  perform pg_temp.ok069(c ->> 'situacao' = 'problema',
    format('69.MISTO deveria ser problema, veio %s', c ->> 'situacao'));
  perform pg_temp.ok069(jsonb_array_length(c -> 'motivos') = 1,
    '69.MISTO deveria ter um único motivo (o problema já diz a tarifa)');
  m := pg_temp.motivo069(c, 'saldo_negativo');
  perform pg_temp.ok069(m is not null, '69.MISTO deveria ter saldo_negativo');
  perform pg_temp.ok069(m ->> 'texto' like '%gasto R$ 64,34 acima do previsto%',
    format('o problema do 69.MISTO deveria citar 64,34: %s', m ->> 'texto'));
  perform pg_temp.ok069(m ->> 'texto' like '%R$ 14,34 disso é tarifa bancária%',
    format('o problema do 69.MISTO deveria citar a tarifa: %s', m ->> 'texto'));

  -- Tarifa reconhecida pela descrição, com código diferente.
  c := pg_temp.centro069(r, '69.DESC');
  perform pg_temp.ok069(c ->> 'situacao' = 'atenção',
    format('69.DESC deveria ser atenção pela descrição, veio %s', c ->> 'situacao'));
  perform pg_temp.ok069(pg_temp.tem_motivo069(c, 'tarifa_bancaria'),
    '69.DESC deveria ter o motivo tarifa_bancaria');
  perform pg_temp.ok069(
    pg_temp.texto_motivo069(c, 'tarifa_bancaria') like '%R$ 14,34%',
    'o motivo do 69.DESC deveria citar R$ 14,34'
  );

  -- Despesa comum sem previsão: continua problema.
  c := pg_temp.centro069(r, '69.COMUM');
  perform pg_temp.ok069(c ->> 'situacao' = 'problema',
    format('69.COMUM deveria continuar problema, veio %s', c ->> 'situacao'));
  perform pg_temp.ok069(pg_temp.tem_motivo069(c, 'saldo_negativo'),
    '69.COMUM deveria ter saldo_negativo');
  perform pg_temp.ok069(not pg_temp.tem_motivo069(c, 'tarifa_bancaria'),
    'despesa comum não pode virar tarifa');
  perform pg_temp.ok069(
    pg_temp.texto_motivo069(c, 'saldo_negativo') like '%gasto R$ 100,00 acima do previsto%',
    'o problema do 69.COMUM deveria citar 100,00'
  );

  -- Balancete atrasado.
  c := pg_temp.centro069(r, '69.ATRASADO');
  perform pg_temp.ok069(c ->> 'situacao' = 'atenção',
    format('69.ATRASADO deveria ser atenção, veio %s', c ->> 'situacao'));
  m := pg_temp.motivo069(c, 'balancete_atrasado');
  perform pg_temp.ok069(m is not null, '69.ATRASADO deveria ter balancete_atrasado');
  perform pg_temp.ok069(m ->> 'texto' ~ '^O último balancete cobre até [0-9]{2}/[0-9]{4} \([23] meses atrás\)\.$',
    format('texto do balancete atrasado inesperado: %s', m ->> 'texto'));

  -- Ordem de gravidade: problema, tarifa, atraso e pendências.
  c := pg_temp.centro069(r, '69.ORDEM');
  perform pg_temp.ok069(c ->> 'situacao' = 'problema',
    format('69.ORDEM deveria ser problema, veio %s', c ->> 'situacao'));
  perform pg_temp.ok069(
    pg_temp.codigos_motivos069(c) = array[
      'saldo_negativo', 'tarifa_bancaria', 'balancete_atrasado', 'pendencias_abertas'
    ],
    format('ordem dos motivos do 69.ORDEM inesperada: %s', pg_temp.codigos_motivos069(c))
  );
  m := pg_temp.motivo069(c, 'pendencias_abertas');
  perform pg_temp.ok069(m ->> 'texto' like '4 pendências abertas:%',
    format('texto das pendências inesperado: %s', m ->> 'texto'));
  perform pg_temp.ok069(m ->> 'texto' like '%Pendência mais antiga; Segunda pendência; Terceira pendência%',
    format('os três títulos mais antigos deveriam aparecer na ordem: %s', m ->> 'texto'));
  perform pg_temp.ok069(m ->> 'texto' like '%e mais 1%',
    format('o texto deveria fechar com "e mais 1": %s', m ->> 'texto'));
  perform pg_temp.ok069(m ->> 'texto' not like '%Pendência mais nova%',
    'o quarto título (mais novo) não deveria aparecer');
  perform pg_temp.ok069(
    pg_temp.motivo069(c, 'saldo_negativo') ->> 'grupo_code' = 'f',
    'o problema do 69.ORDEM deveria ser do grupo f'
  );

  -- Todos os motivos têm exatamente as cinco chaves e nível válido.
  for m in select value from jsonb_array_elements(c -> 'motivos') loop
    select array_agg(k order by k) into v_keys from jsonb_object_keys(m) k;
    perform pg_temp.ok069(
      v_keys = array['codigo', 'grupo_code', 'nivel', 'texto', 'valor'],
      format('chaves de motivo inesperadas: %s', v_keys)
    );
    perform pg_temp.ok069(m ->> 'nivel' in ('problema', 'atenção', 'info'),
      format('nível de motivo inválido: %s', m ->> 'nivel'));
    perform pg_temp.ok069(
      nullif(btrim(m ->> 'texto'), '') is not null,
      'todo motivo precisa de texto'
    );
  end loop;

  -- Chaves do centro: tudo o que já existia mais o motivos.
  select array_agg(k order by k) into v_keys
    from jsonb_object_keys(c) k;
  perform pg_temp.ok069(
    v_keys = array[
      'code', 'data_referencia', 'drive_folder_url', 'end_date', 'erro', 'id',
      'livre', 'motivos', 'name', 'pendencias_abertas', 'responsaveis', 'situacao'
    ],
    format('chaves do centro inesperadas: %s', v_keys)
  );

  -- Em dia, sem plano e sem balancete.
  c := pg_temp.centro069(r, '51.X');
  perform pg_temp.ok069(c ->> 'situacao' = 'em dia',
    format('51.X deveria estar em dia, veio %s', c ->> 'situacao'));
  m := pg_temp.motivo069(c, 'em_dia');
  perform pg_temp.ok069(m is not null, '51.X deveria ter o motivo em_dia');
  perform pg_temp.ok069(
    m ->> 'texto' like 'Balancete até %' and m ->> 'texto' like '%nenhuma pendência aberta.%',
    format('texto de em dia inesperado: %s', m ->> 'texto')
  );

  c := pg_temp.centro069(r, '63.SP');
  perform pg_temp.ok069(c ->> 'situacao' = 'sem plano',
    format('63.SP deveria ficar sem plano, veio %s', c ->> 'situacao'));
  perform pg_temp.ok069(pg_temp.tem_motivo069(c, 'sem_plano'),
    '63.SP deveria ter o motivo sem_plano');

  c := pg_temp.centro069(r, '63.SB');
  perform pg_temp.ok069(c ->> 'situacao' = 'sem balancete',
    format('63.SB deveria ficar sem balancete, veio %s', c ->> 'situacao'));
  perform pg_temp.ok069(pg_temp.tem_motivo069(c, 'sem_balancete'),
    '63.SB deveria ter o motivo sem_balancete');
end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — situacao_centro_v2: mesma resposta, escopo e anon
-- ------------------------------------------------------------
do $$
declare
  r jsonb;
  c jsonb;
  s jsonb;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  r := public.resumo_projetos_v2();
  c := pg_temp.centro069(r, '69.TARIFA');

  s := public.situacao_centro_v2(current_setting('test069.tarifa')::uuid);
  perform pg_temp.ok069(s ->> 'situacao' = c ->> 'situacao',
    'situacao_centro_v2 e resumo deveriam concordar na situação');
  perform pg_temp.ok069(s -> 'motivos' = c -> 'motivos',
    'situacao_centro_v2 e resumo deveriam concordar nos motivos');

  c := pg_temp.centro069(r, '69.ORDEM');
  s := public.situacao_centro_v2(current_setting('test069.ordem')::uuid);
  perform pg_temp.ok069(
    pg_temp.codigos_motivos069(s) = array[
      'saldo_negativo', 'tarifa_bancaria', 'balancete_atrasado', 'pendencias_abertas'
    ],
    format('ordem dos motivos em situacao_centro_v2 inesperada: %s', pg_temp.codigos_motivos069(s))
  );

  -- Falha de cálculo vira sem dado com o motivo "falha", sem erro para a tela.
  s := public.situacao_centro_v2(gen_random_uuid());
  perform pg_temp.ok069(s ->> 'situacao' = 'sem dado',
    format('id inexistente deveria virar sem dado, veio %s', s ->> 'situacao'));
  perform pg_temp.ok069(
    pg_temp.texto_motivo069(s, 'falha') = 'Não foi possível calcular o saldo deste centro.',
    'o motivo falha deveria explicar o cálculo'
  );

  perform pg_temp.falha_com069('select public.situacao_centro_v2(null)', '22023');

  -- Professor do 51.X não lê centro fora do escopo (42501), nem o resumo
  -- por engano; centro do escopo funciona.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  perform pg_temp.falha_com069(
    format('select public.situacao_centro_v2(%L::uuid)', current_setting('test069.tarifa')),
    '42501'
  );
  s := public.situacao_centro_v2(current_setting('test069.x')::uuid);
  perform pg_temp.ok069(s ->> 'situacao' = 'em dia',
    format('b1 deveria ler o 51.X em dia, veio %s', s ->> 'situacao'));

  -- Caixa alheia: b2 recebe P0002 em todas as seis RPCs.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
  perform pg_temp.falha_com069(
    format($q$select public.salvar_caixa_pedido_v2(jsonb_build_object('id', %L, 'nome', 'x'))$q$,
      current_setting('test069.x')),
    'P0002'
  );
  perform pg_temp.falha_com069(
    $q$select public.apagar_caixa_pedido_v2('00000000-0000-4000-8000-000000069b01'::uuid)$q$,
    'P0002'
  );
  perform pg_temp.falha_com069(
    $q$select public.colocar_na_caixa_v2(
         '00000000-0000-4000-8000-000000069b01'::uuid,
         '00000000-0000-4000-8000-000000069902'::uuid)$q$,
    'P0002'
  );
  perform pg_temp.falha_com069(
    $q$select public.editar_item_caixa_v2(
         '00000000-0000-4000-8000-000000069b01'::uuid,
         '00000000-0000-4000-8000-000000069902'::uuid, 100, null)$q$,
    'P0002'
  );
  perform pg_temp.falha_com069(
    $q$select public.tirar_da_caixa_v2(
         '00000000-0000-4000-8000-000000069b01'::uuid,
         '00000000-0000-4000-8000-000000069902'::uuid)$q$,
    'P0002'
  );
  perform pg_temp.falha_com069(
    $q$select public.limpar_ocultos_da_caixa_v2('00000000-0000-4000-8000-000000069b01'::uuid)$q$,
    'P0002'
  );

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
end $$;

reset role;
set local role anon;
select pg_temp.falha_com069(
  format('select public.situacao_centro_v2(%L::uuid)', current_setting('test069.tarifa')),
  '42501'
);
select pg_temp.falha_com069('select public.resumo_projetos_v2()', '42501');
reset role;
set local role authenticated;

-- ------------------------------------------------------------
-- BLOCO 4 — colocar: lista do pedido, janela de 180 dias e ordem
-- origem/saiu_de
-- ------------------------------------------------------------
do $$
declare
  r jsonb;
  v_saiu jsonb;
  v_caixa uuid := '00000000-0000-4000-8000-000000069b03';
  v_pessoa uuid := '00000000-0000-4000-8000-000000069902';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);

  -- Visível mas fora da janela de 180 dias: 22023, sem inventar caixa.
  perform pg_temp.falha_com069(
    format($q$select public.colocar_na_caixa_v2(%L::uuid, %L::uuid)$q$,
      v_caixa, '00000000-0000-4000-8000-000000069901'),
    '22023',
    'Essa pessoa não está na lista do pedido.'
  );

  -- Mover a partir de duas caixas de origem: origem e saiu_de na mesma
  -- ordem por criado_em/id; valor e nota vêm da caixa mais antiga.
  r := public.colocar_na_caixa_v2(v_caixa, v_pessoa);
  perform pg_temp.ok069((r ->> 'valor_mensal')::numeric = 111.00,
    format('a origem deveria ser a caixa antiga (111), veio %s', r ->> 'valor_mensal'));
  perform pg_temp.ok069(r ->> 'nota' = 'nota da origem antiga',
    format('a nota deveria vir da caixa antiga, veio %s', r ->> 'nota'));
  v_saiu := r -> 'saiu_de';
  perform pg_temp.ok069(jsonb_array_length(v_saiu) = 2,
    format('saiu_de deveria listar as duas caixas de origem, veio %s', v_saiu));
  perform pg_temp.ok069(
    (v_saiu -> 0 ->> 'caixa_id')::uuid = '00000000-0000-4000-8000-000000069b01',
    'saiu_de deveria começar pela caixa antiga'
  );
  perform pg_temp.ok069(
    (v_saiu -> 1 ->> 'caixa_id')::uuid = '00000000-0000-4000-8000-000000069b02',
    'saiu_de deveria seguir para a caixa nova'
  );

  -- O item ficou só no destino (lido pela RPC: a tabela é fechada).
  r := public.get_pedido_bolsas_v2();
  perform pg_temp.ok069(
    (select count(*)
       from jsonb_array_elements(coalesce(r -> 'caixas', '[]'::jsonb)) c
      where (c ->> 'id')::uuid = v_caixa
        and exists (
          select 1
            from jsonb_array_elements(coalesce(c -> 'itens', '[]'::jsonb)) i
           where (i ->> 'holder_id')::uuid = v_pessoa
        )) = 1,
    'a pessoa deveria ficar só na caixa de destino'
  );
  perform pg_temp.ok069(
    (select coalesce(sum((c ->> 'pessoas')::integer), 0)
       from jsonb_array_elements(coalesce(r -> 'caixas', '[]'::jsonb)) c
      where (c ->> 'id')::uuid in (
        '00000000-0000-4000-8000-000000069b01'::uuid,
        '00000000-0000-4000-8000-000000069b02'::uuid
      )) = 0,
    'as caixas de origem deveriam ficar vazias'
  );
end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — texto das seis RPCs: dono no for update e lock ao apagar
-- ------------------------------------------------------------
do $$
declare
  v_sig text;
  v_def text;
begin
  foreach v_sig in array array[
    'public.salvar_caixa_pedido_v2(jsonb)',
    'public.apagar_caixa_pedido_v2(uuid)',
    'public.colocar_na_caixa_v2(uuid, uuid)',
    'public.editar_item_caixa_v2(uuid, uuid, numeric, text)',
    'public.tirar_da_caixa_v2(uuid, uuid)',
    'public.limpar_ocultos_da_caixa_v2(uuid)'
  ] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    perform pg_temp.ok069(
      v_def ~* 'dono\s*=\s*auth\.uid\(\)\s+for update',
      format('%s deveria filtrar dono = auth.uid() no for update', v_sig)
    );
  end loop;

  v_def := pg_get_functiondef('public.apagar_caixa_pedido_v2(uuid)'::regprocedure);
  perform pg_temp.ok069(v_def like '%pg_advisory_xact_lock%',
    'apagar_caixa_pedido_v2 deveria tomar o lock por dono');

  v_def := pg_get_functiondef('public.colocar_na_caixa_v2(uuid, uuid)'::regprocedure);
  perform pg_temp.ok069(v_def like '%_bolsista_no_pedido%',
    'colocar_na_caixa_v2 deveria exigir _bolsista_no_pedido');
end $$;

-- ------------------------------------------------------------
-- BLOCO 6 — ACL e atributos
-- ------------------------------------------------------------
do $$
declare
  v_sig text;
  v_fn  oid;
begin
  foreach v_sig in array array[
    'public._situacao_centro(uuid, jsonb, integer)',
    'public.resumo_projetos_v2()',
    'public.situacao_centro_v2(uuid)',
    'public.salvar_caixa_pedido_v2(jsonb)',
    'public.apagar_caixa_pedido_v2(uuid)',
    'public.colocar_na_caixa_v2(uuid, uuid)',
    'public.editar_item_caixa_v2(uuid, uuid, numeric, text)',
    'public.tirar_da_caixa_v2(uuid, uuid)',
    'public.limpar_ocultos_da_caixa_v2(uuid)'
  ] loop
    v_fn := v_sig::regprocedure;
    perform pg_temp.ok069(exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ), format('%s sem security definer ou search_path exato', v_sig));
  end loop;

  perform pg_temp.ok069(
    not has_function_privilege('anon', 'public._situacao_centro(uuid, jsonb, integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._situacao_centro(uuid, jsonb, integer)', 'EXECUTE'),
    'o helper _situacao_centro não pode ter EXECUTE para anon/authenticated'
  );

  foreach v_sig in array array['public.resumo_projetos_v2()', 'public.situacao_centro_v2(uuid)'] loop
    v_fn := v_sig::regprocedure;
    perform pg_temp.ok069(
      has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      format('authenticated perdeu EXECUTE em %s', v_sig)
    );
    perform pg_temp.ok069(
      not has_function_privilege('anon', v_fn, 'EXECUTE'),
      format('anon não pode ter EXECUTE em %s', v_sig)
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- BLOCO 7 — as RPCs antigas da caixa continuam funcionando
-- ------------------------------------------------------------
do $$
declare
  r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);

  r := public.salvar_caixa_pedido_v2(jsonb_build_object('nome', 'Caixa 069', 'meses', 12));
  perform pg_temp.ok069(r ->> 'nome' = 'Caixa 069', 'salvar_caixa_pedido_v2 deveria criar');
  perform public.apagar_caixa_pedido_v2((r ->> 'id')::uuid);
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
rollback;
