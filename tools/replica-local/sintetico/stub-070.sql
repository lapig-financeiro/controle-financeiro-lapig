-- Stub sintético da migração 070 (base descartável; nada de produção).
--
-- Centros (todos com datas fixas, bolsistas fictícios):
--   70.SEM_ATRASO   — D 17/11/2026, k 03/10/2026; a folha de out/nov
--                     está no realizado => falta 0.
--   70.UM_MES       — D 03/11/2026 (cobre 10/2026), k 03/10/2026;
--                     folha de outubro paga depois => falta 8.000
--                     (5.000 ativa + 3.000 encerrada; 7.000 cancelada
--                     não conta).
--   70.DOIS_MESES   — D 17/11/2026, k 03/10 e 03/11; out e nov
--                     faltando => o par de 03/10 vê as duas (10.000).
--   70.DIA_MAIOR_07 — D 17/11/2026 (cobre 11/2026), k 03/11; a folha
--                     do próprio mês não veio => 5.000.
--   70.BOLSA_ANTIGA — D 17/11, k 03/11; o realizado de D subiu 10.000
--                     sem folha cadastrada => falta negativa vira 0.
--   70.UM_BALANCETE — só D => sem_balancete_anterior.
--   70.SEM_BALANCETE— plano e nenhum balancete => sem_balancete.
--   70.CANCELADA    — ativa 5.000 + cancelada 7.000 => esperado 5.000.
--   70.JANELA       — k 20/05/2026, exatamente 6 meses antes de 11/2026.
--   70.FORA_JANELA  — k 20/03/2026, fora dos 6 meses => sem anterior.
--   70.EMPATE       — k 03/10 e 03/09 dão a mesma falta; vence 03/10.
--   70.FIM_MEIO_MES — bolsa encerrada em 15/10/2026: entra inteira no
--                     esperado de outubro (4.000), pelo critério de
--                     sobreposição, mesmo sem cobrir o mês inteiro.
--   70.BAIXA_ANTIGA — limite (a): baixa/pagamento de bolsa antiga no
--                     balancete de D infla o visto e esconde a folha de
--                     novembro; o teste prova o comportamento atual.
--   70.VALOR_ALTERADO— limite (b): valor da bolsa mudado na própria
--                     linha; meses já pagos são recalculados pelo valor
--                     novo e criam falta fictícia de 2.000.
--
-- Deve ser carregado depois de 038/048/063/064/065/066 e antes do teste.
-- Pode ser recarregado: apaga somente os centros 70.* antes de inserir.

begin;

do $stub$
declare
  v_sem_atraso uuid := md5('lapig:070:sem-atraso')::uuid;
  v_um_mes     uuid := md5('lapig:070:um-mes')::uuid;
  v_dois       uuid := md5('lapig:070:dois-meses')::uuid;
  v_dia_maior  uuid := md5('lapig:070:dia-maior-07')::uuid;
  v_antiga     uuid := md5('lapig:070:bolsa-antiga')::uuid;
  v_um_bal     uuid := md5('lapig:070:um-balancete')::uuid;
  v_sem_bal    uuid := md5('lapig:070:sem-balancete')::uuid;
  v_cancelada  uuid := md5('lapig:070:cancelada')::uuid;
  v_janela     uuid := md5('lapig:070:janela')::uuid;
  v_fora       uuid := md5('lapig:070:fora-janela')::uuid;
  v_empate     uuid := md5('lapig:070:empate')::uuid;
  v_meio_mes   uuid := md5('lapig:070:fim-meio-mes')::uuid;
  v_baixa      uuid := md5('lapig:070:baixa-antiga')::uuid;
  v_valor_alt  uuid := md5('lapig:070:valor-alterado')::uuid;

  v_fim date := date '2027-12-31';
begin
  delete from public.balancete_lancamentos
   where balancete_id in (select id from public.balancetes
                           where project_id in (
                             v_sem_atraso, v_um_mes, v_dois, v_dia_maior, v_antiga,
                             v_um_bal, v_sem_bal, v_cancelada, v_janela, v_fora, v_empate,
     v_meio_mes, v_baixa, v_valor_alt));
  delete from public.balancetes
   where project_id in (
     v_sem_atraso, v_um_mes, v_dois, v_dia_maior, v_antiga,
     v_um_bal, v_sem_bal, v_cancelada, v_janela, v_fora, v_empate,
     v_meio_mes, v_baixa, v_valor_alt);
  delete from public.plano_desembolsos
   where plano_id in (select id from public.planos_trabalho
                       where project_id in (
                         v_sem_atraso, v_um_mes, v_dois, v_dia_maior, v_antiga,
                         v_um_bal, v_sem_bal, v_cancelada, v_janela, v_fora, v_empate,
     v_meio_mes, v_baixa, v_valor_alt));
  delete from public.plano_rubricas
   where plano_id in (select id from public.planos_trabalho
                       where project_id in (
                         v_sem_atraso, v_um_mes, v_dois, v_dia_maior, v_antiga,
                         v_um_bal, v_sem_bal, v_cancelada, v_janela, v_fora, v_empate,
     v_meio_mes, v_baixa, v_valor_alt));
  delete from public.planos_trabalho
   where project_id in (
     v_sem_atraso, v_um_mes, v_dois, v_dia_maior, v_antiga,
     v_um_bal, v_sem_bal, v_cancelada, v_janela, v_fora, v_empate,
     v_meio_mes, v_baixa, v_valor_alt);
  delete from public.scholarships
   where project_id in (
     v_sem_atraso, v_um_mes, v_dois, v_dia_maior, v_antiga,
     v_um_bal, v_sem_bal, v_cancelada, v_janela, v_fora, v_empate,
     v_meio_mes, v_baixa, v_valor_alt);
  delete from public.scholarship_holders
   where full_name like 'Bolsista Sintético 70%';
  delete from public.projects
   where id in (
     v_sem_atraso, v_um_mes, v_dois, v_dia_maior, v_antiga,
     v_um_bal, v_sem_bal, v_cancelada, v_janela, v_fora, v_empate,
     v_meio_mes, v_baixa, v_valor_alt);

  insert into public.projects (id, name, code, start_date, end_date) values
    (v_sem_atraso, 'Stub 070 Sem Atraso',    '70.SEM_ATRASO',   '2025-01-01', v_fim),
    (v_um_mes,     'Stub 070 Um Mes',        '70.UM_MES',       '2025-01-01', v_fim),
    (v_dois,       'Stub 070 Dois Meses',    '70.DOIS_MESES',   '2025-01-01', v_fim),
    (v_dia_maior,  'Stub 070 Dia Maior 07',  '70.DIA_MAIOR_07', '2025-01-01', v_fim),
    (v_antiga,     'Stub 070 Bolsa Antiga',  '70.BOLSA_ANTIGA', '2025-01-01', v_fim),
    (v_um_bal,     'Stub 070 Um Balancete',  '70.UM_BALANCETE', '2025-01-01', v_fim),
    (v_sem_bal,    'Stub 070 Sem Balancete', '70.SEM_BALANCETE','2025-01-01', v_fim),
    (v_cancelada,  'Stub 070 Cancelada',     '70.CANCELADA',    '2025-01-01', v_fim),
    (v_janela,     'Stub 070 Janela',        '70.JANELA',       '2025-01-01', v_fim),
    (v_fora,       'Stub 070 Fora Janela',   '70.FORA_JANELA',  '2025-01-01', v_fim),
    (v_empate,     'Stub 070 Empate',        '70.EMPATE',       '2025-01-01', v_fim),
    (v_meio_mes,   'Stub 070 Fim Meio Mes',  '70.FIM_MEIO_MES', '2025-01-01', v_fim),
    (v_baixa,      'Stub 070 Baixa Antiga',  '70.BAIXA_ANTIGA', '2025-01-01', v_fim),
    (v_valor_alt,  'Stub 070 Valor Alterado','70.VALOR_ALTERADO','2025-01-01', v_fim);

  -- Plano de cada centro: a.bolsas 100.000 e b 10.000.
  insert into public.planos_trabalho
    (project_id, ativo, versao, tipo, valor_total_plano)
  select p.id, true, 0, 'original', 110000.00
    from public.projects p
   where p.id in (
     v_sem_atraso, v_um_mes, v_dois, v_dia_maior, v_antiga,
     v_um_bal, v_sem_bal, v_cancelada, v_janela, v_fora, v_empate,
     v_meio_mes, v_baixa, v_valor_alt);

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto)
  select pl.id, 'a.bolsas', 100000.00
    from public.planos_trabalho pl
   where pl.project_id in (
     v_sem_atraso, v_um_mes, v_dois, v_dia_maior, v_antiga,
     v_um_bal, v_sem_bal, v_cancelada, v_janela, v_fora, v_empate,
     v_meio_mes, v_baixa, v_valor_alt)
  union all
  select pl.id, 'b', 10000.00
    from public.planos_trabalho pl
   where pl.project_id in (
     v_sem_atraso, v_um_mes, v_dois, v_dia_maior, v_antiga,
     v_um_bal, v_sem_bal, v_cancelada, v_janela, v_fora, v_empate,
     v_meio_mes, v_baixa, v_valor_alt);

  -- Bolsistas fictícios, um por centro.
  insert into public.scholarship_holders (full_name) values
    ('Bolsista Sintético 70 Sem Atraso'),
    ('Bolsista Sintético 70 Um Mes'),
    ('Bolsista Sintético 70 Dois Meses'),
    ('Bolsista Sintético 70 Dia Maior'),
    ('Bolsista Sintético 70 Antiga'),
    ('Bolsista Sintético 70 Um Balancete'),
    ('Bolsista Sintético 70 Sem Balancete'),
    ('Bolsista Sintético 70 Cancelada'),
    ('Bolsista Sintético 70 Janela'),
    ('Bolsista Sintético 70 Fora Janela'),
    ('Bolsista Sintético 70 Empate'),
    ('Bolsista Sintético 70 Fim Meio Mes'),
    ('Bolsista Sintético 70 Baixa Antiga'),
    ('Bolsista Sintético 70 Valor Alterado');

  -- 70.SEM_ATRASO: out e nov ja no realizado de D.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_sem_atraso, 5000.00, date '2025-01-01', v_fim, 'active'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Sem Atraso';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_sem_atraso, date '2026-10-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_sem_atraso, date '2026-11-17', 200000.00, 0.00, 0.00, 200000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  select b.id, '7.1.3.04.01.09142', 'BOLSA SINTETICA', 10000.00, 0.00, 10000.00, 'a.bolsas'
    from public.balancetes b
   where b.project_id = v_sem_atraso and b.data_referencia = date '2026-11-17';

  -- 70.UM_MES: D 03/11 cobre out/2026; outubro pago depois.
  -- ativa 5.000 (out), encerrada 3.000 (out, encerrou em 31/10),
  -- cancelada 7.000 (nao conta).
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_um_mes, v.amount, v.ini, v.fim, v.st
    from public.scholarship_holders h
    join (values
      (5000.00, date '2025-01-01', date '2027-12-31', 'active'),
      (3000.00, date '2025-01-01', date '2026-10-31', 'ended'),
      (7000.00, date '2025-01-01', date '2027-12-31', 'cancelled')
    ) as v(amount, ini, fim, st) on true
   where h.full_name = 'Bolsista Sintético 70 Um Mes';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_um_mes, date '2026-10-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_um_mes, date '2026-11-03', 200000.00, 0.00, 0.00, 200000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  select b.id, '7.1.3.04.01.09142', 'BOLSA SINTETICA', 5000.00, 0.00, 5000.00, 'a.bolsas'
    from public.balancetes b
   where b.project_id = v_um_mes;

  -- 70.DOIS_MESES: D 17/11, k 03/10 e 03/11; out e nov faltando.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_dois, 5000.00, date '2025-01-01', v_fim, 'active'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Dois Meses';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_dois, date '2026-10-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_dois, date '2026-11-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_dois, date '2026-11-17', 200000.00, 0.00, 0.00, 200000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  select b.id, '7.1.3.04.01.09142', 'BOLSA SINTETICA', 5000.00, 0.00, 5000.00, 'a.bolsas'
    from public.balancetes b
   where b.project_id = v_dois;

  -- 70.DIA_MAIOR_07: D 17/11 cobre nov, mas a folha de nov nao veio.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_dia_maior, 5000.00, date '2025-01-01', v_fim, 'active'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Dia Maior';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_dia_maior, date '2026-11-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_dia_maior, date '2026-11-17', 200000.00, 0.00, 0.00, 200000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  select b.id, '7.1.3.04.01.09142', 'BOLSA SINTETICA', 10000.00, 0.00, 10000.00, 'a.bolsas'
    from public.balancetes b
   where b.project_id = v_dia_maior;

  -- 70.BOLSA_ANTIGA: realizado de D 50.000, de k 40.000, folha 1.000.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_antiga, 1000.00, date '2025-01-01', v_fim, 'active'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Antiga';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_antiga, date '2026-11-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_antiga, date '2026-11-17', 200000.00, 0.00, 0.00, 200000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  select b.id, '7.1.3.04.01.09142', 'BOLSA SINTETICA',
         case when b.data_referencia = date '2026-11-17' then 50000.00 else 40000.00 end,
         0.00,
         case when b.data_referencia = date '2026-11-17' then 50000.00 else 40000.00 end,
         'a.bolsas'
    from public.balancetes b
   where b.project_id = v_antiga;

  -- 70.UM_BALANCETE: so D.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_um_bal, 5000.00, date '2025-01-01', v_fim, 'active'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Um Balancete';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values (v_um_bal, date '2026-11-17', 200000.00, 0.00, 0.00, 200000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  select b.id, '7.1.3.04.01.09142', 'BOLSA SINTETICA', 10000.00, 0.00, 10000.00, 'a.bolsas'
    from public.balancetes b
   where b.project_id = v_um_bal;

  -- 70.SEM_BALANCETE: so plano e bolsa.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_sem_bal, 5000.00, date '2025-01-01', v_fim, 'active'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Sem Balancete';

  -- 70.CANCELADA: ativa 5.000 + cancelada 7.000; esperado 5.000.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_cancelada, v.amount, date '2025-01-01', v_fim, v.st
    from public.scholarship_holders h
    join (values
      (5000.00, 'active'),
      (7000.00, 'cancelled')
    ) as v(amount, st) on true
   where h.full_name = 'Bolsista Sintético 70 Cancelada';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_cancelada, date '2026-10-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_cancelada, date '2026-11-03', 200000.00, 0.00, 0.00, 200000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  select b.id, '7.1.3.04.01.09142', 'BOLSA SINTETICA', 5000.00, 0.00, 5000.00, 'a.bolsas'
    from public.balancetes b
   where b.project_id = v_cancelada;

  -- 70.JANELA: k 20/05/2026 cobre 05/2026, exatamente 6 meses antes.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_janela, 1000.00, date '2025-01-01', v_fim, 'active'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Janela';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_janela, date '2026-05-20', 200000.00, 0.00, 0.00, 200000.00),
    (v_janela, date '2026-11-17', 200000.00, 0.00, 0.00, 200000.00);

  -- 70.FORA_JANELA: k 20/03/2026 cobre 03/2026, fora dos 6 meses.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_fora, 1000.00, date '2025-01-01', v_fim, 'active'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Fora Janela';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_fora, date '2026-03-20', 200000.00, 0.00, 0.00, 200000.00),
    (v_fora, date '2026-11-17', 200000.00, 0.00, 0.00, 200000.00);

  -- 70.EMPATE: k 03/09 e k 03/10 dao a mesma falta; vence o mais recente.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_empate, 1000.00, date '2025-01-01', v_fim, 'active'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Empate';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_empate, date '2026-09-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_empate, date '2026-10-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_empate, date '2026-11-17', 200000.00, 0.00, 0.00, 200000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  select b.id, '7.1.3.04.01.09142', 'BOLSA SINTETICA',
         case b.data_referencia
           when date '2026-09-03' then 0.00
           when date '2026-10-03' then 1000.00
           else 2000.00
         end,
         0.00,
         case b.data_referencia
           when date '2026-09-03' then 0.00
           when date '2026-10-03' then 1000.00
           else 2000.00
         end,
         'a.bolsas'
    from public.balancetes b
   where b.project_id = v_empate;

  -- 70.FIM_MEIO_MES: a bolsa acaba em 15/10/2026 (no meio do mes).
  -- O criterio de sobreposicao conta a folha de outubro inteira (4.000),
  -- como no bloco de compromissos; nao exige cobrir o mes todo.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_meio_mes, 4000.00, date '2025-01-01', date '2026-10-15', 'ended'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Fim Meio Mes';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_meio_mes, date '2026-10-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_meio_mes, date '2026-11-03', 200000.00, 0.00, 0.00, 200000.00);

  -- 70.BAIXA_ANTIGA (limite a): a bolsa antiga terminou em 30/09 e nao
  -- entra no esperado de novembro, mas o pagamento/baixa dela em D entra
  -- no realizado e infla o visto. A folha de novembro da bolsa corrente
  -- fica escondida (falta 0) no comportamento atual.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_baixa, v.amount, v.ini, v.fim, v.st
    from public.scholarship_holders h
    join (values
      (5000.00, date '2025-01-01', date '2027-12-31', 'active'),
      (5000.00, date '2025-01-01', date '2026-09-30', 'ended')
    ) as v(amount, ini, fim, st) on true
   where h.full_name = 'Bolsista Sintético 70 Baixa Antiga';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_baixa, date '2026-11-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_baixa, date '2026-11-17', 200000.00, 0.00, 0.00, 200000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  select b.id, '7.1.3.04.01.09142', 'BAIXA DE BOLSA ANTIGA', 5000.00, 0.00, 5000.00, 'a.bolsas'
    from public.balancetes b
   where b.project_id = v_baixa and b.data_referencia = date '2026-11-17';

  -- 70.VALOR_ALTERADO (limite b): o valor da bolsa foi mudado na propria
  -- linha de 5.000 para 7.000. Os meses ja pagos (out e nov a 5.000)
  -- estao no realizado, mas o esperado de novembro usa 7.000: falta
  -- ficticia de 2.000 no comportamento atual.
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_valor_alt, 7000.00, date '2025-01-01', v_fim, 'active'
    from public.scholarship_holders h
   where h.full_name = 'Bolsista Sintético 70 Valor Alterado';

  insert into public.balancetes
    (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
     total_debitos, total_creditos)
  values
    (v_valor_alt, date '2026-11-03', 200000.00, 0.00, 0.00, 200000.00),
    (v_valor_alt, date '2026-11-17', 200000.00, 0.00, 0.00, 200000.00);

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
  select b.id, '7.1.3.04.01.09142', 'BOLSA SINTETICA',
         case when b.data_referencia = date '2026-11-17' then 10000.00 else 5000.00 end,
         0.00,
         case when b.data_referencia = date '2026-11-17' then 10000.00 else 5000.00 end,
         'a.bolsas'
    from public.balancetes b
   where b.project_id = v_valor_alt;
end
$stub$;

commit;
