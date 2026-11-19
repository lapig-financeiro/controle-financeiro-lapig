-- Stub sintético da migração 066 (base descartável; nada de produção).
--
-- Cria quatro centros:
--   * 66.TAXA     — cip_ufg com saldo positivo, cip_ua estourada e b normal.
--   * 66.MISTO    — a.bolsas + dao (o teste reparenta dao para 'a' dentro
--                   da própria transação e desfaz).
--   * 66.SEMPLANO — balancete e nenhum plano (retorno antecipado da 048).
--   * 66.SEMBAL   — plano e nenhum balancete (retorno com has_balancete=false).
--
-- Deve ser carregado depois de 038/048/063/064/065 e antes do teste.
-- Pode ser recarregado: apaga somente os centros 66.* antes de inserir.

begin;

do $stub$
declare
  v_taxa     uuid := md5('lapig:066:taxa')::uuid;
  v_misto    uuid := md5('lapig:066:misto')::uuid;
  v_semplano uuid := md5('lapig:066:semplano')::uuid;
  v_sembal   uuid := md5('lapig:066:sembal')::uuid;

  v_pl_taxa  uuid := md5('lapig:066:plano:taxa')::uuid;
  v_pl_misto uuid := md5('lapig:066:plano:misto')::uuid;
  v_pl_semb  uuid := md5('lapig:066:plano:sembal')::uuid;

  v_ba_taxa  uuid := md5('lapig:066:bal:taxa')::uuid;
  v_ba_misto uuid := md5('lapig:066:bal:misto')::uuid;
  v_ba_semp  uuid := md5('lapig:066:bal:semplano')::uuid;

  v_holder   uuid := md5('lapig:066:bolsista')::uuid;

  v_mes      date := date_trunc('month', current_date)::date;
  v_ref      date := (date_trunc('month', current_date) + interval '14 days')::date;
  v_fim      date := (date_trunc('month', current_date) + interval '12 months' - interval '1 day')::date;
begin
  delete from public.balancete_lancamentos
   where balancete_id in (select id from public.balancetes
                           where project_id in (v_taxa, v_misto, v_semplano, v_sembal));
  delete from public.balancetes
   where project_id in (v_taxa, v_misto, v_semplano, v_sembal);
  delete from public.plano_desembolsos
   where plano_id in (select id from public.planos_trabalho
                       where project_id in (v_taxa, v_misto, v_semplano, v_sembal));
  delete from public.plano_rubricas
   where plano_id in (select id from public.planos_trabalho
                       where project_id in (v_taxa, v_misto, v_semplano, v_sembal));
  delete from public.planos_trabalho
   where project_id in (v_taxa, v_misto, v_semplano, v_sembal);
  delete from public.scholarships
   where project_id in (v_taxa, v_misto, v_semplano, v_sembal);
  delete from public.scholarship_holders where id = v_holder;
  delete from public.projects where id in (v_taxa, v_misto, v_semplano, v_sembal);

  insert into public.projects (id, name, code, start_date, end_date)
  values
    (v_taxa,     'Stub 066 Taxas',        '66.TAXA',     '2025-01-01', v_fim),
    (v_misto,    'Stub 066 Misto',        '66.MISTO',    '2025-01-01', v_fim),
    (v_semplano, 'Stub 066 Sem Plano',    '66.SEMPLANO', '2025-01-01', v_fim),
    (v_sembal,   'Stub 066 Sem Balancete','66.SEMBAL',   '2025-01-01', v_fim);

  -- 66.TAXA: taxa positiva, taxa estourada e rubrica comum.
  insert into public.planos_trabalho
    (id, project_id, ativo, versao, tipo, valor_total_plano)
  values (v_pl_taxa, v_taxa, true, 0, 'original', 180000.00);

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
    (v_pl_taxa, 'cip_ufg', 100000.00),
    (v_pl_taxa, 'cip_ua',   10000.00),
    (v_pl_taxa, 'dao',      20000.00),
    (v_pl_taxa, 'b',        50000.00);

  insert into public.balancetes
    (id, project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values (v_ba_taxa, v_taxa, v_ref, 180000.00, 0.00, 95000.00, 275000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  values
    (v_ba_taxa, '7.1.3.90.01.00001', 'CIP UFG',           85000.00, 0.00, 85000.00, 'cip_ufg'),
    (v_ba_taxa, '7.1.3.90.01.00002', 'CIP UA',            12000.00, 0.00, 12000.00, 'cip_ua'),
    (v_ba_taxa, '7.1.3.05.01.00027', 'SERVICOS TECNICOS', 10000.00, 0.00, 10000.00, 'b');

  -- 66.MISTO: bolsa + DAO (o teste reparenta dao para 'a' na transação).
  insert into public.planos_trabalho
    (id, project_id, ativo, versao, tipo, valor_total_plano)
  values (v_pl_misto, v_misto, true, 0, 'original', 150000.00);

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
    (v_pl_misto, 'a.bolsas', 100000.00),
    (v_pl_misto, 'dao',       20000.00),
    (v_pl_misto, 'b',         30000.00);

  insert into public.balancetes
    (id, project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values (v_ba_misto, v_misto, v_ref, 90000.00, 0.00, 65000.00, 155000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  values
    (v_ba_misto, '7.1.3.04.01.09142', 'BOLSA DOACAO',       40000.00, 0.00, 40000.00, 'a.bolsas'),
    (v_ba_misto, '7.1.3.90.02.00001', 'DAO DA FUNDACAO',    15000.00, 0.00, 15000.00, 'dao'),
    (v_ba_misto, '7.1.3.05.01.00027', 'SERVICOS TECNICOS',  10000.00, 0.00, 10000.00, 'b');

  insert into public.scholarship_holders (id, full_name)
  values (v_holder, 'Bolsista Sintético 66');

  insert into public.scholarships
    (holder_id, project_id, amount, start_date, end_date, status)
  values (v_holder, v_misto, 5000.00, v_mes, v_fim, 'active');

  -- 66.SEMPLANO: balancete, nenhum plano.
  insert into public.balancetes
    (id, project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values (v_ba_semp, v_semplano, v_ref, 10000.00, 0.00, 10000.00, 20000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  values
    (v_ba_semp, '7.1.3.05.01.00027', 'SERVICOS TECNICOS', 10000.00, 0.00, 10000.00, 'b');

  -- 66.SEMBAL: plano, nenhum balancete.
  insert into public.planos_trabalho
    (id, project_id, ativo, versao, tipo, valor_total_plano)
  values (v_pl_semb, v_sembal, true, 0, 'original', 50000.00);

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
    (v_pl_semb, 'b', 50000.00);
end
$stub$;

commit;
