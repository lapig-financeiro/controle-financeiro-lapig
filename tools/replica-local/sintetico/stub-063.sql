-- Stub para validar a migração 063 num Postgres descartável.
-- Ordem: stub -> stub-051 -> stub-054 -> 051 -> stub-052 -> 052 -> 054
--        -> stub-062 -> 062 -> 038 -> 048 -> stub-063 -> 063 -> test_063.
-- NÃO faz parte do projeto. Dados puramente sintéticos, sem PII.

alter table public.projects
  add column if not exists drive_folder_url text;

alter table public.planos_trabalho
  add column if not exists versao integer not null default 0,
  add column if not exists valor_total_plano numeric(14,2);

alter table public.plano_desembolsos
  add column if not exists data_texto text,
  add column if not exists valor_texto text;

-- Como na 033: professor não lê plano_desembolsos direto (admin-only no RLS).
alter table public.plano_desembolsos enable row level security;
grant select on public.plano_desembolsos to authenticated;
drop policy if exists "Admin lê plano_desembolsos" on public.plano_desembolsos;
create policy "Admin lê plano_desembolsos" on public.plano_desembolsos
  for select to authenticated using (public.is_admin());

-- Ajusta identidades sintéticas:
--   a1 = admin ('Victor')
--   b1 = professor A, escopo 51.X ('Professor do projeto')
--   b2 = professor B, escopo 51.Y ('Prof. Bruno')
--   e1 = professor C, escopo 51.Y ('Arthur Pietro')
--   c1 = agente (Buriti), escopo 51.X ('Buriti Agente')
--   d1 = automação (Vigia), sem centros
delete from public.user_projects
 where user_id = '00000000-0000-0000-0000-0000000000d1';

update public.app_users
   set role = 'automacao',
       display_name = 'Vigia'
 where user_id = '00000000-0000-0000-0000-0000000000d1';

update public.app_users
   set display_name = 'Buriti Agente'
 where user_id = '00000000-0000-0000-0000-0000000000c1';

update public.app_users
   set display_name = 'Prof. Bruno'
 where user_id = '00000000-0000-0000-0000-0000000000b2';

do $$
declare
  v_x      uuid := (select id from public.projects where code = '51.X');
  v_y      uuid := (select id from public.projects where code = '51.Y');
  v_sb     uuid;
  v_sp     uuid;
  v_def    uuid;
  v_inat   uuid;
  v_pl_x   uuid;
  v_pl_y   uuid;
  v_pl_sb  uuid;
  v_pl_def uuid;
  v_pl_in  uuid;
  v_bal_x1 uuid;
  v_bal_x2 uuid;
  v_bal_y  uuid;
  v_bal_df uuid;
  v_bal_in uuid;
  v_hol_x  uuid;
  v_mes_atual date := date_trunc('month', current_date)::date;
  v_fim_futuro date := (date_trunc('month', current_date) + interval '12 months' - interval '1 day')::date;
  v_ref_atual  date := (date_trunc('month', current_date) + interval '14 days')::date;
  v_ref_antigo date := (date_trunc('month', current_date) - interval '2 months' + interval '14 days')::date;
  v_ref_defas  date := (date_trunc('month', current_date) - interval '3 months' + interval '14 days')::date;
begin
  -- 51.X: em dia (plano + balancete atual + 2 balancetes + 3 parcelas fora de ordem)
  update public.projects
     set drive_folder_url = 'https://drive.google.com/drive/folders/stub-51x',
         end_date = v_fim_futuro
   where id = v_x;

  insert into public.planos_trabalho (project_id, ativo, versao, valor_total_plano)
  values (v_x, true, 1, 260000.00)
  returning id into v_pl_x;

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
    (v_pl_x, 'a.bolsas', 200000.00),
    (v_pl_x, 'b',        60000.00);

  -- Parcelas inseridas fora de ordem para testar ordenação por parcela
  insert into public.plano_desembolsos (plano_id, parcela, data_prevista, data_texto, valor, valor_texto) values
    (v_pl_x, 3, (v_mes_atual + interval '3 months')::date, 'Parcela 3', 60000.00, '60.000,00'),
    (v_pl_x, 1, (v_mes_atual - interval '1 month')::date,  null,        100000.00, null),
    (v_pl_x, 2, (v_mes_atual + interval '1 month')::date,  'Próximo mês', 100000.00, '100.000,00');

  -- Balancete antigo (não deve vencer na view nem em get_repasses_v2)
  insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido, raw_extraction)
  values (
    v_x, v_ref_antigo, 110000.00, 1000.00,
    '{"data":{"recursos":{"recebido":100000,"a_receber":0}}}'::jsonb
  )
  returning id into v_bal_x1;

  -- Balancete vigente (dia 15 do mês atual -> defasagem = 0)
  insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido, raw_extraction)
  values (
    v_x, v_ref_atual, 195000.00, 3500.00,
    '{"data":{"recursos":{"recebido":150000,"a_receber":50000}}}'::jsonb
  )
  returning id into v_bal_x2;

  insert into public.balancete_lancamentos (balancete_id, conta_codigo, rubrica_code, saldo_atual) values
    (v_bal_x1, '7.1.3.04.01', 'a.bolsas', 20000.00),
    (v_bal_x2, '7.1.3.04.01', 'a.bolsas', 50000.00),
    (v_bal_x2, '7.1.3.05.01', 'b',        20000.00);

  insert into public.scholarship_holders (full_name)
  values ('Bolsista Sintético 63X')
  returning id into v_hol_x;

  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  values (v_hol_x, v_x, 4000.00, v_mes_atual, v_fim_futuro, 'active');

  -- 51.Y: problema por grupo negativo real (grupo a = -15000, grupo e = +20000, soma = +5000)
  update public.projects
     set drive_folder_url = 'https://drive.google.com/drive/folders/stub-51y',
         end_date = v_fim_futuro
   where id = v_y;

  insert into public.planos_trabalho (project_id, ativo, valor_total_plano)
  values (v_y, true, 80000.00)
  returning id into v_pl_y;

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
    (v_pl_y, 'a.bolsas', 50000.00),
    (v_pl_y, 'e',        30000.00);

  insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido, raw_extraction)
  values (
    v_y, v_ref_atual, 12000.00, 200.00,
    '{"data":{"recursos":{"recebido":80000,"a_receber":0}}}'::jsonb
  )
  returning id into v_bal_y;

  insert into public.balancete_lancamentos (balancete_id, conta_codigo, rubrica_code, saldo_atual) values
    (v_bal_y, '7.1.3.04.01', 'a.bolsas', 65000.00),
    (v_bal_y, '7.1.3.03.01', 'e',        10000.00);

  -- 63.SB: sem balancete (com plano e parcela sem valor estilo GMH)
  insert into public.projects (name, code, start_date, end_date, active)
  values ('Stub 063 Sem Balancete', '63.SB', '2025-01-01', v_fim_futuro, true)
  returning id into v_sb;

  insert into public.planos_trabalho (project_id, ativo, valor_total_plano)
  values (v_sb, true, 150000.00)
  returning id into v_pl_sb;

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
    (v_pl_sb, 'b', 150000.00);

  insert into public.plano_desembolsos (plano_id, parcela, data_prevista, data_texto, valor, valor_texto) values
    (v_pl_sb, 1, null, 'Por entrega', null, 'mediante cálculo de gastos');

  -- 63.SP: sem plano
  insert into public.projects (name, code, start_date, end_date, active)
  values ('Stub 063 Sem Plano', '63.SP', '2025-01-01', v_fim_futuro, true)
  returning id into v_sp;

  -- 63.DEF: balancete defasado (>= 2 meses -> 'atenção')
  insert into public.projects (name, code, start_date, end_date, active)
  values ('Stub 063 Balancete Defasado', '63.DEF', '2025-01-01', v_fim_futuro, true)
  returning id into v_def;

  insert into public.planos_trabalho (project_id, ativo, valor_total_plano)
  values (v_def, true, 100000.00)
  returning id into v_pl_def;

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
    (v_pl_def, 'b', 100000.00);

  insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
  values (v_def, v_ref_defas, 80000.00, 0.00)
  returning id into v_bal_df;

  insert into public.balancete_lancamentos (balancete_id, conta_codigo, rubrica_code, saldo_atual) values
    (v_bal_df, '7.1.3.05.01', 'b', 20000.00);

  -- 63.INAT: projeto inativo (também no user_projects de b1)
  insert into public.projects (name, code, start_date, end_date, active)
  values ('Stub 063 Inativo', '63.INAT', '2024-01-01', v_fim_futuro, false)
  returning id into v_inat;

  insert into public.user_projects (user_id, project_id)
  values ('00000000-0000-0000-0000-0000000000b1', v_inat);

  insert into public.planos_trabalho (project_id, ativo, valor_total_plano)
  values (v_inat, true, 50000.00)
  returning id into v_pl_in;

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
    (v_pl_in, 'b', 50000.00);

  insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
  values (v_inat, v_ref_atual, 50000.00, 0.00)
  returning id into v_bal_in;

  insert into public.balancete_lancamentos (balancete_id, conta_codigo, rubrica_code, saldo_atual) values
    (v_bal_in, '7.1.3.05.01', 'b', 10000.00);
end $$;
