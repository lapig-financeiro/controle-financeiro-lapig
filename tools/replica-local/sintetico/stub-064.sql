-- Stub para validar a migração 064 num Postgres descartável.
-- Registra documentos e fatos sintéticos EXCLUSIVAMENTE via `registrar_documento_v2`
-- como admin (a1), sem PII. Deve ser carregado depois de `064_rastreabilidade.sql`.

begin;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;

do $$
declare
  v_x        uuid := (select id from public.projects where code = '51.X');
  v_y        uuid := (select id from public.projects where code = '51.Y');
  v_bal_x    uuid;
  v_ref_x    date;
  v_bl_x_bol uuid;
  v_bl_x_srv uuid;
  v_pl_x     uuid;
  v_pr_x_bol uuid;
  v_pr_x_srv uuid;
  v_pd_x_p1  uuid;
  v_bal_y    uuid;
  v_ref_y    date;
  v_bl_y_bol uuid;
begin
  select b.id, b.data_referencia
    into v_bal_x, v_ref_x
    from public.balancetes b
   where b.project_id = v_x
   order by b.data_referencia desc
   limit 1;

  select id into v_bl_x_bol
    from public.balancete_lancamentos
   where balancete_id = v_bal_x and conta_codigo = '7.1.3.04.01.09142';

  select id into v_bl_x_srv
    from public.balancete_lancamentos
   where balancete_id = v_bal_x and conta_codigo = '7.1.3.05.01.00027';

  select id into v_pl_x
    from public.planos_trabalho
   where project_id = v_x and ativo = true
   order by versao desc
   limit 1;

  select id into v_pr_x_bol
    from public.plano_rubricas
   where plano_id = v_pl_x and rubrica_code = 'a.bolsas'
   limit 1;

  select id into v_pr_x_srv
    from public.plano_rubricas
   where plano_id = v_pl_x and rubrica_code = 'b'
     and descricao_livre = 'Serviços técnicos especializados';

  select id into v_pd_x_p1
    from public.plano_desembolsos
   where plano_id = v_pl_x and parcela = 1;

  -- 1. Balancete PDF de 51.X (deixa 7.1.3.05.01.00014 sem fato para exercitar legado na árvore)
  perform public.registrar_documento_v2(jsonb_build_object(
    'project_id',    v_x,
    'tipo',          'balancete',
    'chave',         'balancete:' || v_x::text || ':' || to_char(v_ref_x, 'YYYY-MM-DD'),
    'titulo',        'Balancete sintético 51.X (' || to_char(v_ref_x, 'MM/YYYY') || ')',
    'sha256',        repeat('a', 64),
    'bucket',        'balancete-pdfs',
    'caminho',       v_x::text || '/balancete_atual.pdf',
    'arquivo_nome',  'balancete_atual.pdf',
    'formato',       'pdf',
    'paginas',       2,
    'parser',        'balancete-parser',
    'parser_versao', '2.1.0',
    'origem',        'backfill',
    'fatos',         jsonb_build_array(
      jsonb_build_object(
        'alvo_tabela', 'balancetes',
        'alvo_id',     v_bal_x,
        'campo',       'saldo_disponivel',
        'valor',       195000.00,
        'pagina',      2,
        'trecho',      'SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO == >> R$ 195.000,00',
        'bbox',        jsonb_build_object('x0', 40, 'x1', 420, 'yMin', 120.2, 'yMax', 131.5)
      ),
      jsonb_build_object(
        'alvo_tabela', 'balancetes',
        'alvo_id',     v_bal_x,
        'campo',       'rendimento_liquido',
        'valor',       3500.00,
        'pagina',      2,
        'trecho',      'RENDIMENTO LÍQUIDO APURADO ==>> R$ 3.500,00',
        'bbox',        jsonb_build_object('x0', 40, 'x1', 360, 'yMin', 104.0, 'yMax', 115.3)
      ),
      jsonb_build_object(
        'alvo_tabela', 'balancete_lancamentos',
        'alvo_id',     v_bl_x_bol,
        'campo',       'saldo_atual',
        'valor',       50000.00,
        'pagina',      1,
        'trecho',      '7.1.3.04.01.09142 2579142 BOLSA DOAÇÃO 0,00 50.000,00 0,00 50.000,00 50.000,00',
        'bbox',        jsonb_build_object('x0', 40, 'x1', 540, 'yMin', 510.5, 'yMax', 521.5)
      ),
      jsonb_build_object(
        'alvo_tabela', 'balancete_lancamentos',
        'alvo_id',     v_bl_x_srv,
        'campo',       'saldo_atual',
        'valor',       15000.00,
        'pagina',      1,
        'trecho',      '7.1.3.05.01.00027 2506027 SERVIÇOS ANÁLISE PESQ. CIENTÍFICA 0,00 15.000,00 0,00 15.000,00 15.000,00',
        'bbox',        jsonb_build_object('x0', 40, 'x1', 545, 'yMin', 482.5, 'yMax', 493.5)
      )
    )
  ));

  -- 2. Plano DOCX de 51.X (deixa "Participação em congressos" e parcelas 2/3 sem fato -> legado)
  perform public.registrar_documento_v2(jsonb_build_object(
    'project_id',    v_x,
    'tipo',          'plano',
    'chave',         'plano:' || v_x::text || ':' || v_pl_x::text,
    'titulo',        'Plano de Trabalho sintético 51.X v1',
    'sha256',        repeat('b', 64),
    'bucket',        'plano-trabalho-docs',
    'caminho',       v_x::text || '/plano_v1.docx',
    'arquivo_nome',  'plano_v1.docx',
    'formato',       'docx',
    'paginas',       null,
    'parser',        'pt-parser',
    'parser_versao', '1.4.0',
    'origem',        'site',
    'fatos',         jsonb_build_array(
      jsonb_build_object(
        'alvo_tabela', 'planos_trabalho',
        'alvo_id',     v_pl_x,
        'campo',       'valor_total_plano',
        'valor',       260000.00,
        'pagina',      null,
        'trecho',      'Valor Total do Plano: R$ 260.000,00',
        'bbox',        null
      ),
      jsonb_build_object(
        'alvo_tabela', 'plano_rubricas',
        'alvo_id',     v_pr_x_bol,
        'campo',       'valor_previsto',
        'valor',       200000.00,
        'pagina',      null,
        'trecho',      'a.bolsas — Bolsas: R$ 200.000,00',
        'bbox',        null
      ),
      jsonb_build_object(
        'alvo_tabela', 'plano_rubricas',
        'alvo_id',     v_pr_x_srv,
        'campo',       'valor_previsto',
        'valor',       45000.00,
        'pagina',      null,
        'trecho',      'Serviços técnicos especializados — R$ 45.000,00',
        'bbox',        null
      ),
      jsonb_build_object(
        'alvo_tabela', 'plano_desembolsos',
        'alvo_id',     v_pd_x_p1,
        'campo',       'valor',
        'valor',       100000.00,
        'pagina',      null,
        'trecho',      'Parcela 1 — R$ 100.000,00',
        'bbox',        null
      )
    )
  ));

  -- 3. Balancete PDF de 51.Y (para testar isolamento de leitura do professor b1)
  select b.id, b.data_referencia
    into v_bal_y, v_ref_y
    from public.balancetes b
   where b.project_id = v_y
   order by b.data_referencia desc
   limit 1;

  select id into v_bl_y_bol
    from public.balancete_lancamentos
   where balancete_id = v_bal_y and conta_codigo = '7.1.3.04.01.09142';

  perform public.registrar_documento_v2(jsonb_build_object(
    'project_id',    v_y,
    'tipo',          'balancete',
    'chave',         'balancete:' || v_y::text || ':' || to_char(v_ref_y, 'YYYY-MM-DD'),
    'titulo',        'Balancete sintético 51.Y (' || to_char(v_ref_y, 'MM/YYYY') || ')',
    'sha256',        repeat('c', 64),
    'bucket',        'balancete-pdfs',
    'caminho',       v_y::text || '/balancete_y.pdf',
    'arquivo_nome',  'balancete_y.pdf',
    'formato',       'pdf',
    'paginas',       1,
    'parser',        'balancete-parser',
    'parser_versao', '2.1.0',
    'origem',        'ingestao',
    'fatos',         jsonb_build_array(
      jsonb_build_object(
        'alvo_tabela', 'balancete_lancamentos',
        'alvo_id',     v_bl_y_bol,
        'campo',       'saldo_atual',
        'valor',       65000.00,
        'pagina',      1,
        'trecho',      '7.1.3.04.01.09142 2579142 BOLSA DOAÇÃO 0,00 65.000,00 0,00 65.000,00 65.000,00',
        'bbox',        jsonb_build_object('x0', 40, 'x1', 540, 'yMin', 500.0, 'yMax', 511.0)
      )
    )
  ));
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

commit;
