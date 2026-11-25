-- ============================================================
-- Roteiro de conferência da migração 070 (folha atrasada)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-070-pglite.mjs
-- Antes da 070, o BLOCO 2 falha: a folha de outubro paga depois do
-- balancete de 03/11 aparece como livre. O runner valida o motivo.
--
-- Depende do stub sintético:
--   tools/replica-local/sintetico/stub-070.sql
--
-- Identidade usada: a1 = admin ('Victor').
-- ============================================================
\set ON_ERROR_STOP on

create or replace function pg_temp.ok070(p boolean, p_motivo text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception '070 FALHOU: %', p_motivo;
  end if;
end $$;

create or replace function pg_temp.num070(p numeric) returns numeric language sql immutable as $$
  select round(coalesce(p, 0), 2)
$$;

create or replace function pg_temp.rubrica070(p_sl jsonb, p_code text) returns jsonb
language sql immutable as $$
  select value
    from jsonb_array_elements(coalesce(p_sl -> 'rubricas', '[]'::jsonb))
   where value ->> 'rubrica_code' = p_code
   limit 1
$$;

create or replace function pg_temp.grupo070(p_sl jsonb, p_code text) returns jsonb
language sql immutable as $$
  select value
    from jsonb_array_elements(coalesce(p_sl -> 'grupos', '[]'::jsonb))
   where value ->> 'grupo_code' = p_code
   limit 1
$$;

create or replace function pg_temp.no070(p_no jsonb, p_chave text) returns jsonb
language plpgsql immutable as $$
declare
  v_filho jsonb;
  v_achado jsonb;
begin
  if p_no is null or jsonb_typeof(p_no) <> 'object' then
    return null;
  end if;
  if p_no ->> 'chave' = p_chave then
    return p_no;
  end if;
  for v_filho in select value from jsonb_array_elements(coalesce(p_no -> 'partes', '[]'::jsonb)) loop
    v_achado := pg_temp.no070(v_filho, p_chave);
    if v_achado is not null then
      return v_achado;
    end if;
  end loop;
  return null;
end $$;

create or replace function pg_temp.arvore070(p_no jsonb, p_raiz boolean default true) returns void
language plpgsql immutable as $$
declare
  v_tipo  text := p_no ->> 'tipo';
  v_chave text := coalesce(p_no ->> 'chave', '<sem-chave>');
  v_valor numeric;
  v_soma  numeric;
  v_filho jsonb;
begin
  if p_no is null or jsonb_typeof(p_no) <> 'object' then
    raise exception '070 FALHOU: nó inválido na árvore: %', p_no;
  end if;

  -- Raiz sem valor é o retorno dos centros sem plano/sem balancete.
  if jsonb_typeof(p_no -> 'valor') <> 'number' then
    if p_raiz and jsonb_array_length(coalesce(p_no -> 'partes', '[]'::jsonb)) = 0 then
      return;
    end if;
    raise exception '070 FALHOU: nó % com valor não numérico', v_chave;
  end if;
  v_valor := (p_no ->> 'valor')::numeric;

  if v_tipo not in ('calculo', 'documento', 'legado', 'digitado') then
    raise exception '070 FALHOU: tipo inválido % no nó %', v_tipo, v_chave;
  end if;
  if (p_no ->> 'sinal')::integer not in (1, -1) then
    raise exception '070 FALHOU: sinal inválido % no nó %', p_no ->> 'sinal', v_chave;
  end if;

  if v_tipo = 'calculo' then
    if jsonb_typeof(p_no -> 'partes') <> 'array' or jsonb_array_length(p_no -> 'partes') = 0 then
      raise exception '070 FALHOU: nó de cálculo % sem partes', v_chave;
    end if;

    select coalesce(sum((f ->> 'sinal')::numeric * (f ->> 'valor')::numeric), 0)
      into v_soma
      from jsonb_array_elements(p_no -> 'partes') as f;

    if pg_temp.num070(v_soma) is distinct from pg_temp.num070(v_valor) then
      raise exception '070 FALHOU: nó % não fecha (valor %, soma dos filhos %)', v_chave, v_valor, v_soma;
    end if;

    for v_filho in select value from jsonb_array_elements(p_no -> 'partes') loop
      perform pg_temp.arvore070(v_filho, false);
    end loop;
  else
    if jsonb_array_length(coalesce(p_no -> 'partes', '[]'::jsonb)) <> 0 then
      raise exception '070 FALHOU: folha % deve ter partes vazio', v_chave;
    end if;
  end if;
end $$;

create or replace function pg_temp.soma_grupos070(p_sl jsonb) returns numeric
language sql immutable as $$
  select coalesce(sum((g ->> 'saldo_livre')::numeric), 0)
    from jsonb_array_elements(coalesce(p_sl -> 'grupos', '[]'::jsonb)) g
$$;

create or replace function pg_temp.tem_aviso070(p_sl jsonb, p_trecho text) returns boolean
language sql immutable as $$
  select exists (
    select 1 from jsonb_array_elements_text(coalesce(p_sl -> 'avisos', '[]'::jsonb)) a
     where a like '%' || p_trecho || '%'
  )
$$;

begin;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

do $$
begin
  if not exists (select 1 from public.projects where code = '70.UM_MES') then
    raise exception '070 FALHOU: stub ausente; carregue tools/replica-local/sintetico/stub-070.sql antes do roteiro.';
  end if;
end $$;

-- ------------------------------------------------------------
-- BLOCO 1 — sem folha atrasada, o contrato antigo não muda.
-- (Antes da 070 este bloco passa; o defeito aparece no BLOCO 2.)
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.SEM_ATRASO');
  r     jsonb := public.get_saldo_livre(v_id);
  rub   jsonb;
  g     jsonb;
begin
  perform pg_temp.ok070(coalesce((r ->> 'has_plano')::boolean, false), '70.SEM_ATRASO deveria ter plano');
  perform pg_temp.ok070(coalesce((r ->> 'has_balancete')::boolean, false), '70.SEM_ATRASO deveria ter balancete');
  perform pg_temp.ok070(pg_temp.num070((r ->> 'compromissos_bolsas')::numeric) = 65000,
    format('70.SEM_ATRASO compromissos_bolsas deveria ser 65000, veio %s', r ->> 'compromissos_bolsas'));
  perform pg_temp.ok070(r ->> 'folha_atrasada' is null, '70.SEM_ATRASO não deveria ter folha atrasada');
  perform pg_temp.ok070(not pg_temp.tem_aviso070(r, 'A folha de bolsas de'),
    '70.SEM_ATRASO não deveria avisar de folha atrasada');

  rub := pg_temp.rubrica070(r, 'a.bolsas');
  perform pg_temp.ok070(pg_temp.num070((rub ->> 'compromissos')::numeric) = 65000,
    format('70.SEM_ATRASO a.bolsas compromissos deveria ser 65000, veio %s', rub ->> 'compromissos'));
  perform pg_temp.ok070(pg_temp.num070((rub ->> 'saldo_livre')::numeric) = 25000,
    format('70.SEM_ATRASO a.bolsas livre deveria ser 25000, veio %s', rub ->> 'saldo_livre'));

  g := pg_temp.grupo070(r, 'a');
  perform pg_temp.ok070(pg_temp.num070((g ->> 'saldo_livre')::numeric) = 25000,
    format('70.SEM_ATRASO grupo a deveria ter livre 25000, veio %s', g ->> 'saldo_livre'));
end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — um atraso de um mês (03/11 com a folha de outubro
-- paga depois). É o defeito central: antes da 070, 8.000 livres.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.UM_MES');
  r     jsonb := public.get_saldo_livre(v_id);
  f     jsonb := r -> 'folha_atrasada';
  rub   jsonb;
  g     jsonb;
begin
  -- Asserção monetária que falha na 066 por NÚMERO, sem depender de
  -- chave nova: a 066 deixa 8.000 a mais em a.bolsas (25.000 em vez
  -- de 17.000). É a primeira do bloco, de propósito.
  rub := pg_temp.rubrica070(r, 'a.bolsas');
  perform pg_temp.ok070(pg_temp.num070((rub ->> 'saldo_livre')::numeric) = 17000,
    format('70.UM_MES a.bolsas livre deveria ser 17000 (a 066 daria 25000), veio %s', rub ->> 'saldo_livre'));

  perform pg_temp.ok070(r ->> 'folha_conferencia' = 'feita',
    format('70.UM_MES deveria conferir a folha, folha_conferencia = %s', r ->> 'folha_conferencia'));
  perform pg_temp.ok070(f is not null and jsonb_typeof(f) = 'object', '70.UM_MES deveria ter folha_atrasada');

  perform pg_temp.ok070(pg_temp.num070((f ->> 'valor')::numeric) = 8000,
    format('70.UM_MES falta deveria ser 8000, veio %s', f ->> 'valor'));
  perform pg_temp.ok070(pg_temp.num070((f ->> 'esperado')::numeric) = 8000,
    format('70.UM_MES esperado deveria ser 8000 (ativa 5.000 + encerrada 3.000; cancelada fora), veio %s', f ->> 'esperado'));
  perform pg_temp.ok070(pg_temp.num070((f ->> 'visto')::numeric) = 0,
    format('70.UM_MES visto deveria ser 0, veio %s', f ->> 'visto'));
  perform pg_temp.ok070(f ->> 'desde_balancete' = '2026-10-03',
    format('70.UM_MES desde_balancete deveria ser 2026-10-03, veio %s', f ->> 'desde_balancete'));
  perform pg_temp.ok070(f ->> 'balancete' = '2026-11-03',
    format('70.UM_MES balancete deveria ser 2026-11-03, veio %s', f ->> 'balancete'));
  perform pg_temp.ok070(f ->> 'mes_inicio' = '2026-10-01',
    format('70.UM_MES mes_inicio deveria ser 2026-10-01, veio %s', f ->> 'mes_inicio'));
  perform pg_temp.ok070(f ->> 'mes_fim' = '2026-10-01',
    format('70.UM_MES mes_fim deveria ser 2026-10-01, veio %s', f ->> 'mes_fim'));

  perform pg_temp.ok070(pg_temp.num070((r ->> 'compromissos_bolsas')::numeric) = 78000,
    format('70.UM_MES compromissos_bolsas deveria ser 78000 (janela 70000 + falta 8000), veio %s', r ->> 'compromissos_bolsas'));

  perform pg_temp.ok070(pg_temp.num070((rub ->> 'compromissos')::numeric) = 78000,
    '70.UM_MES a.bolsas deveria carregar os 8000 a mais');
  perform pg_temp.ok070(pg_temp.num070((rub ->> 'saldo_livre')::numeric) = 17000,
    format('70.UM_MES a.bolsas livre deveria ser 17000, veio %s', rub ->> 'saldo_livre'));

  g := pg_temp.grupo070(r, 'a');
  perform pg_temp.ok070(pg_temp.num070((g ->> 'saldo_livre')::numeric) = 17000,
    format('70.UM_MES grupo a livre deveria ser 17000, veio %s', g ->> 'saldo_livre'));

  perform pg_temp.ok070(pg_temp.tem_aviso070(r, 'A folha de bolsas de 10/2026'),
    '70.UM_MES deveria avisar a folha de 10/2026');
  perform pg_temp.ok070(pg_temp.tem_aviso070(r, 'balancete de 03/11/2026'),
    '70.UM_MES deveria citar o balancete de 03/11/2026');
  perform pg_temp.ok070(pg_temp.tem_aviso070(r, 'faltam R$ 8.000,00'),
    '70.UM_MES deveria dizer que faltam R$ 8.000,00');
  perform pg_temp.ok070(pg_temp.tem_aviso070(r, 'desde o balancete de 03/10/2026'),
    '70.UM_MES deveria citar o balancete de 03/10/2026');
  perform pg_temp.ok070(pg_temp.tem_aviso070(r, 'visto R$ 0,00'),
    '70.UM_MES deveria mostrar o visto R$ 0,00');
end $$;

-- ------------------------------------------------------------
-- BLOCO 2b — bolsa que termina no meio do mês (15/10) entra inteira
-- no esperado daquele mês, pelo mesmo critério de sobreposição.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.FIM_MEIO_MES');
  r     jsonb := public.get_saldo_livre(v_id);
  f     jsonb := r -> 'folha_atrasada';
begin
  perform pg_temp.ok070(
    pg_temp.num070(coalesce(f ->> 'valor', '0')::numeric) = 4000,
    format('70.FIM_MEIO_MES deveria contar a bolsa que termina em 15/10 inteira (4000), veio %s', coalesce(f ->> 'valor', '0')));
  perform pg_temp.ok070(f is not null, '70.FIM_MEIO_MES deveria ter folha_atrasada');
  perform pg_temp.ok070(pg_temp.num070((f ->> 'esperado')::numeric) = 4000,
    format('70.FIM_MEIO_MES esperado deveria ser 4000, veio %s', f ->> 'esperado'));
  perform pg_temp.ok070(pg_temp.num070((r ->> 'compromissos_bolsas')::numeric) = 4000,
    format('70.FIM_MEIO_MES compromissos_bolsas deveria ser 4000, veio %s', r ->> 'compromissos_bolsas'));
end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — dois meses: só o par mais longo vê as duas folhas.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.DOIS_MESES');
  r     jsonb := public.get_saldo_livre(v_id);
  f     jsonb := r -> 'folha_atrasada';
begin
  perform pg_temp.ok070(r ->> 'folha_conferencia' = 'feita', '70.DOIS_MESES deveria conferir');
  perform pg_temp.ok070(f is not null, '70.DOIS_MESES deveria ter folha_atrasada');
  perform pg_temp.ok070(pg_temp.num070((f ->> 'valor')::numeric) = 10000,
    format('70.DOIS_MESES deveria ver as duas folhas (10000), veio %s', f ->> 'valor'));
  perform pg_temp.ok070(pg_temp.num070((f ->> 'esperado')::numeric) = 10000,
    format('70.DOIS_MESES esperado deveria ser 10000, veio %s', f ->> 'esperado'));
  perform pg_temp.ok070(f ->> 'desde_balancete' = '2026-10-03',
    format('70.DOIS_MESES deveria escolher 03/10, veio %s', f ->> 'desde_balancete'));
  perform pg_temp.ok070(f ->> 'balancete' = '2026-11-17',
    format('70.DOIS_MESES balancete deveria ser 17/11, veio %s', f ->> 'balancete'));
  perform pg_temp.ok070(f ->> 'mes_inicio' = '2026-10-01',
    format('70.DOIS_MESES mes_inicio deveria ser 10/2026, veio %s', f ->> 'mes_inicio'));
  perform pg_temp.ok070(f ->> 'mes_fim' = '2026-11-01',
    format('70.DOIS_MESES mes_fim deveria ser 11/2026, veio %s', f ->> 'mes_fim'));
  perform pg_temp.ok070(pg_temp.num070((r ->> 'compromissos_bolsas')::numeric) = 75000,
    format('70.DOIS_MESES compromissos_bolsas deveria ser 75000, veio %s', r ->> 'compromissos_bolsas'));
end $$;

-- ------------------------------------------------------------
-- BLOCO 4 — balancete com dia > 07 cuja folha do próprio mês não veio.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.DIA_MAIOR_07');
  r     jsonb := public.get_saldo_livre(v_id);
  f     jsonb := r -> 'folha_atrasada';
begin
  perform pg_temp.ok070(r ->> 'folha_conferencia' = 'feita', '70.DIA_MAIOR_07 deveria conferir');
  perform pg_temp.ok070(f is not null, '70.DIA_MAIOR_07 deveria ter folha_atrasada');
  perform pg_temp.ok070(pg_temp.num070((f ->> 'valor')::numeric) = 5000,
    format('70.DIA_MAIOR_07 falta deveria ser 5000, veio %s', f ->> 'valor'));
  perform pg_temp.ok070(f ->> 'desde_balancete' = '2026-11-03',
    format('70.DIA_MAIOR_07 desde_balancete deveria ser 03/11, veio %s', f ->> 'desde_balancete'));
  perform pg_temp.ok070(f ->> 'mes_inicio' = '2026-11-01' and f ->> 'mes_fim' = '2026-11-01',
    '70.DIA_MAIOR_07 o intervalo deveria ser só 11/2026');
  perform pg_temp.ok070(pg_temp.num070((r ->> 'compromissos_bolsas')::numeric) = 70000,
    format('70.DIA_MAIOR_07 compromissos_bolsas deveria ser 70000, veio %s', r ->> 'compromissos_bolsas'));
end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — bolsa antiga não cadastrada: falta negativa vira 0 e
-- não pode DIMINUIR o compromisso.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.BOLSA_ANTIGA');
  r     jsonb := public.get_saldo_livre(v_id);
begin
  perform pg_temp.ok070(r ->> 'folha_conferencia' = 'feita',
    format('70.BOLSA_ANTIGA deveria conferir, folha_conferencia = %s', r ->> 'folha_conferencia'));
  perform pg_temp.ok070(r ->> 'folha_atrasada' is null,
    '70.BOLSA_ANTIGA falta negativa deveria virar 0 (sem folha_atrasada)');
  perform pg_temp.ok070(pg_temp.num070((r ->> 'compromissos_bolsas')::numeric) = 13000,
    format('70.BOLSA_ANTIGA não pode diminuir o compromisso (esperado 13000, veio %s)', r ->> 'compromissos_bolsas'));
  perform pg_temp.ok070(not pg_temp.tem_aviso070(r, 'A folha de bolsas de'),
    '70.BOLSA_ANTIGA não deveria avisar folha atrasada');
end $$;

-- ------------------------------------------------------------
-- BLOCO 6 — só um balancete: não há com o que comparar.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.UM_BALANCETE');
  r     jsonb := public.get_saldo_livre(v_id);
begin
  perform pg_temp.ok070(r ->> 'folha_conferencia' = 'sem_balancete_anterior',
    format('70.UM_BALANCETE deveria ser sem_balancete_anterior, veio %s', r ->> 'folha_conferencia'));
  perform pg_temp.ok070(r ->> 'folha_atrasada' is null, '70.UM_BALANCETE não deveria ter folha_atrasada');
  perform pg_temp.ok070(pg_temp.num070((r ->> 'compromissos_bolsas')::numeric) = 65000,
    '70.UM_BALANCETE não deveria mudar o compromisso da janela');
end $$;

-- ------------------------------------------------------------
-- BLOCO 7 — sem balancete: a conferência não inventa nada.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.SEM_BALANCETE');
  r     jsonb := public.get_saldo_livre(v_id);
  g     jsonb;
begin
  perform pg_temp.ok070(r ->> 'has_balancete' = 'false', '70.SEM_BALANCETE deveria devolver has_balancete=false');
  perform pg_temp.ok070(r ->> 'folha_conferencia' = 'sem_balancete',
    format('70.SEM_BALANCETE deveria ser sem_balancete, veio %s', r ->> 'folha_conferencia'));
  perform pg_temp.ok070(r ->> 'folha_atrasada' is null, '70.SEM_BALANCETE não deveria ter folha_atrasada');
  perform pg_temp.ok070(pg_temp.tem_aviso070(r, 'Sem balancete importado'),
    '70.SEM_BALANCETE deveria manter o aviso de sem balancete');
  g := pg_temp.grupo070(r, 'a');
  perform pg_temp.ok070(
    pg_temp.num070((g ->> 'compromissos')::numeric) = pg_temp.num070((r ->> 'compromissos_bolsas')::numeric),
    '70.SEM_BALANCETE o compromisso do grupo deveria ser só a janela (sem folha atrasada)');
end $$;

-- ------------------------------------------------------------
-- BLOCO 8 — bolsa cancelada não conta.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.CANCELADA');
  r     jsonb := public.get_saldo_livre(v_id);
  f     jsonb := r -> 'folha_atrasada';
begin
  perform pg_temp.ok070(f is not null, '70.CANCELADA deveria ter folha_atrasada');
  perform pg_temp.ok070(pg_temp.num070((f ->> 'valor')::numeric) = 5000,
    format('70.CANCELADA deveria ignorar a bolsa cancelada (esperado 5000, veio %s)', f ->> 'valor'));
  perform pg_temp.ok070(pg_temp.num070((f ->> 'esperado')::numeric) = 5000,
    format('70.CANCELADA esperado deveria ser 5000, veio %s', f ->> 'esperado'));
end $$;

-- ------------------------------------------------------------
-- BLOCO 9 — janela de 6 meses: o candidato no limite entra, o
-- anterior a ele não.
-- ------------------------------------------------------------
do $$
declare
  v_jan  uuid := (select id from public.projects where code = '70.JANELA');
  v_fora uuid := (select id from public.projects where code = '70.FORA_JANELA');
  r      jsonb := public.get_saldo_livre(v_jan);
  f      jsonb := r -> 'folha_atrasada';
  rf     jsonb := public.get_saldo_livre(v_fora);
begin
  perform pg_temp.ok070(r ->> 'folha_conferencia' = 'feita',
    format('70.JANELA (exatamente 6 meses) deveria conferir, veio %s', r ->> 'folha_conferencia'));
  perform pg_temp.ok070(f is not null and pg_temp.num070((f ->> 'valor')::numeric) = 6000,
    format('70.JANELA falta deveria ser 6000 (6 meses), veio %s', f ->> 'valor'));
  perform pg_temp.ok070(f ->> 'desde_balancete' = '2026-05-20',
    format('70.JANELA desde_balancete deveria ser 20/05/2026, veio %s', f ->> 'desde_balancete'));
  perform pg_temp.ok070(f ->> 'mes_inicio' = '2026-06-01',
    format('70.JANELA mes_inicio deveria ser 06/2026, veio %s', f ->> 'mes_inicio'));
  perform pg_temp.ok070(pg_temp.num070((r ->> 'compromissos_bolsas')::numeric) = 19000,
    format('70.JANELA compromissos_bolsas deveria ser 19000, veio %s', r ->> 'compromissos_bolsas'));

  perform pg_temp.ok070(rf ->> 'folha_conferencia' = 'sem_balancete_anterior',
    format('70.FORA_JANELA deveria ignorar o candidato fora da janela, veio %s', rf ->> 'folha_conferencia'));
  perform pg_temp.ok070(rf ->> 'folha_atrasada' is null, '70.FORA_JANELA não deveria ter folha_atrasada');
end $$;

-- ------------------------------------------------------------
-- BLOCO 10 — empate: vence o balancete de comparação mais recente.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.EMPATE');
  r     jsonb := public.get_saldo_livre(v_id);
  f     jsonb := r -> 'folha_atrasada';
begin
  perform pg_temp.ok070(f is not null, '70.EMPATE deveria ter folha_atrasada');
  perform pg_temp.ok070(pg_temp.num070((f ->> 'valor')::numeric) = 1000,
    format('70.EMPATE falta deveria ser 1000, veio %s', f ->> 'valor'));
  perform pg_temp.ok070(f ->> 'desde_balancete' = '2026-10-03',
    format('70.EMPATE no empate deveria escolher o mais recente (03/10), veio %s', f ->> 'desde_balancete'));
  perform pg_temp.ok070(pg_temp.num070((f ->> 'esperado')::numeric) = 2000,
    format('70.EMPATE esperado do par escolhido deveria ser 2000, veio %s', f ->> 'esperado'));
  perform pg_temp.ok070(pg_temp.num070((f ->> 'visto')::numeric) = 1000,
    format('70.EMPATE visto do par escolhido deveria ser 1000, veio %s', f ->> 'visto'));
end $$;

-- ------------------------------------------------------------
-- BLOCO 10b — limite (a), NÃO é correção: baixa/pagamento de bolsa
-- antiga no balancete de D infla o visto e esconde a folha de
-- novembro da bolsa corrente. O teste prova o comportamento atual.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.BAIXA_ANTIGA');
  r     jsonb := public.get_saldo_livre(v_id);
  rub   jsonb;
begin
  perform pg_temp.ok070(r ->> 'folha_conferencia' = 'feita', '70.BAIXA_ANTIGA deveria conferir');
  perform pg_temp.ok070(r ->> 'folha_atrasada' is null,
    '70.BAIXA_ANTIGA (limite a): a baixa de bolsa antiga esconde a folha de novembro — comportamento atual, não correção');
  perform pg_temp.ok070(pg_temp.num070((r ->> 'compromissos_bolsas')::numeric) = 65000,
    format('70.BAIXA_ANTIGA (limite a): o compromisso fica só na janela (65000), veio %s', r ->> 'compromissos_bolsas'));
  rub := pg_temp.rubrica070(r, 'a.bolsas');
  perform pg_temp.ok070(pg_temp.num070((rub ->> 'saldo_livre')::numeric) = 30000,
    format('70.BAIXA_ANTIGA (limite a): o livre esconde os 5000 (30000 em vez de 25000), veio %s', rub ->> 'saldo_livre'));
end $$;

-- ------------------------------------------------------------
-- BLOCO 10c — limite (b), NÃO é correção: mudar o valor da bolsa na
-- própria linha recalcula meses já pagos pelo valor novo e cria
-- falta fictícia. O teste prova o comportamento atual.
-- ------------------------------------------------------------
do $$
declare
  v_id  uuid := (select id from public.projects where code = '70.VALOR_ALTERADO');
  r     jsonb := public.get_saldo_livre(v_id);
  f     jsonb := r -> 'folha_atrasada';
  rub   jsonb;
begin
  perform pg_temp.ok070(f is not null, '70.VALOR_ALTERADO deveria ter folha_atrasada');
  perform pg_temp.ok070(pg_temp.num070((f ->> 'valor')::numeric) = 2000,
    format('70.VALOR_ALTERADO (limite b): o valor novo na mesma linha cria falta fictícia de 2000, veio %s', f ->> 'valor'));
  perform pg_temp.ok070(pg_temp.num070((f ->> 'esperado')::numeric) = 7000,
    format('70.VALOR_ALTERADO (limite b): esperado de novembro usa o valor novo (7000), veio %s', f ->> 'esperado'));
  perform pg_temp.ok070(pg_temp.num070((f ->> 'visto')::numeric) = 5000,
    format('70.VALOR_ALTERADO (limite b): visto é o realizado a 5000 por mês, veio %s', f ->> 'visto'));
  perform pg_temp.ok070(pg_temp.num070((r ->> 'compromissos_bolsas')::numeric) = 93000,
    format('70.VALOR_ALTERADO (limite b): janela 91000 + falta fictícia 2000, veio %s', r ->> 'compromissos_bolsas'));
  rub := pg_temp.rubrica070(r, 'a.bolsas');
  perform pg_temp.ok070(pg_temp.num070((rub ->> 'compromissos')::numeric) = 93000,
    '70.VALOR_ALTERADO (limite b): a rubrica carrega a falta fictícia');
end $$;

-- ------------------------------------------------------------
-- BLOCO 11 — explicar_livre_v2 fecha com e sem folha atrasada e
-- separa o valor dentro do compromisso de bolsas.
-- ------------------------------------------------------------
do $$
declare
  v_sem  uuid := (select id from public.projects where code = '70.SEM_ATRASO');
  v_um   uuid := (select id from public.projects where code = '70.UM_MES');
  v_dois uuid := (select id from public.projects where code = '70.DOIS_MESES');
  v_emp  uuid := (select id from public.projects where code = '70.EMPATE');
  v_meio uuid := (select id from public.projects where code = '70.FIM_MEIO_MES');
  sl     jsonb;
  ex     jsonb;
  g      jsonb;
  no     jsonb;
begin
  -- sem folha atrasada: árvore fecha e não ganha o nó novo.
  sl := public.get_saldo_livre(v_sem);
  ex := public.explicar_livre_v2(v_sem);
  perform pg_temp.arvore070(ex);
  perform pg_temp.ok070(pg_temp.num070((ex ->> 'valor')::numeric) = pg_temp.num070(pg_temp.soma_grupos070(sl)),
    '70.SEM_ATRASO raiz da árvore deveria ser a soma dos grupos');
  perform pg_temp.ok070(pg_temp.num070((ex ->> 'valor')::numeric) = 35000,
    format('70.SEM_ATRASO raiz deveria ser 35000, veio %s', ex ->> 'valor'));
  perform pg_temp.ok070(pg_temp.no070(ex, 'rubrica:a.bolsas:folha_atrasada') is null,
    '70.SEM_ATRASO não deveria ter nó de folha atrasada');
  g := pg_temp.no070(ex, 'grupo:a');
  no := pg_temp.no070(g, 'rubrica:a.bolsas:comprometido');
  perform pg_temp.ok070(no is not null and pg_temp.num070((no ->> 'valor')::numeric) = 65000,
    '70.SEM_ATRASO o comprometido da janela deveria continuar 65000');

  -- um mês: nó novo com 8.000 e o comprometido da janela com 70.000.
  sl := public.get_saldo_livre(v_um);
  ex := public.explicar_livre_v2(v_um);
  perform pg_temp.arvore070(ex);
  perform pg_temp.ok070(pg_temp.num070((ex ->> 'valor')::numeric) = pg_temp.num070(pg_temp.soma_grupos070(sl)),
    '70.UM_MES raiz da árvore deveria ser a soma dos grupos');
  perform pg_temp.ok070(pg_temp.num070((ex ->> 'valor')::numeric) = 27000,
    format('70.UM_MES raiz deveria ser 27000, veio %s', ex ->> 'valor'));
  no := pg_temp.no070(ex, 'rubrica:a.bolsas:folha_atrasada');
  perform pg_temp.ok070(no is not null, '70.UM_MES deveria ter nó de folha atrasada');
  perform pg_temp.ok070(pg_temp.num070((no ->> 'valor')::numeric) = 8000,
    format('70.UM_MES nó da folha atrasada deveria valer 8000, veio %s', no ->> 'valor'));
  perform pg_temp.ok070((no ->> 'sinal')::integer = -1, '70.UM_MES nó da folha atrasada deveria ter sinal -1');
  perform pg_temp.ok070(no ->> 'conta' = 'folha esperada que o balancete ainda não mostra',
    format('70.UM_MES conta do nó inesperada: %s', no ->> 'conta'));
  perform pg_temp.ok070(pg_temp.no070(no, 'rubrica:a.bolsas:folha_esperada:comprometido') is not null,
    '70.UM_MES deveria ter a parte do esperado');
  perform pg_temp.ok070(pg_temp.no070(no, 'rubrica:a.bolsas:folha_vista:realizado') is null,
    '70.UM_MES sem visto não deveria ter a parte do visto');
  g := pg_temp.no070(ex, 'grupo:a');
  no := pg_temp.no070(g, 'rubrica:a.bolsas:comprometido');
  perform pg_temp.ok070(no is not null and pg_temp.num070((no ->> 'valor')::numeric) = 70000,
    format('70.UM_MES o comprometido da janela deveria ser 70000, veio %s', no ->> 'valor'));

  -- dois meses: nó novo com 10.000.
  sl := public.get_saldo_livre(v_dois);
  ex := public.explicar_livre_v2(v_dois);
  perform pg_temp.arvore070(ex);
  perform pg_temp.ok070(pg_temp.num070((ex ->> 'valor')::numeric) = pg_temp.num070(pg_temp.soma_grupos070(sl)),
    '70.DOIS_MESES raiz da árvore deveria ser a soma dos grupos');
  no := pg_temp.no070(ex, 'rubrica:a.bolsas:folha_atrasada');
  perform pg_temp.ok070(no is not null and pg_temp.num070((no ->> 'valor')::numeric) = 10000,
    '70.DOIS_MESES nó da folha atrasada deveria valer 10000');

  -- empate: o nó novo tem esperado e visto como partes.
  sl := public.get_saldo_livre(v_emp);
  ex := public.explicar_livre_v2(v_emp);
  perform pg_temp.arvore070(ex);
  perform pg_temp.ok070(pg_temp.num070((ex ->> 'valor')::numeric) = pg_temp.num070(pg_temp.soma_grupos070(sl)),
    '70.EMPATE raiz da árvore deveria ser a soma dos grupos');
  no := pg_temp.no070(ex, 'rubrica:a.bolsas:folha_atrasada');
  perform pg_temp.ok070(no is not null and pg_temp.num070((no ->> 'valor')::numeric) = 1000,
    '70.EMPATE nó da folha atrasada deveria valer 1000');
  perform pg_temp.ok070(pg_temp.no070(no, 'rubrica:a.bolsas:folha_esperada:comprometido') is not null,
    '70.EMPATE deveria ter a parte do esperado');
  perform pg_temp.ok070(pg_temp.no070(no, 'rubrica:a.bolsas:folha_vista:realizado') is not null,
    '70.EMPATE com visto > 0 deveria ter a parte do visto');

  -- bolsa que termina no meio do mês: o nó novo também fecha.
  sl := public.get_saldo_livre(v_meio);
  ex := public.explicar_livre_v2(v_meio);
  perform pg_temp.arvore070(ex);
  perform pg_temp.ok070(pg_temp.num070((ex ->> 'valor')::numeric) = pg_temp.num070(pg_temp.soma_grupos070(sl)),
    '70.FIM_MEIO_MES raiz da árvore deveria ser a soma dos grupos');
  no := pg_temp.no070(ex, 'rubrica:a.bolsas:folha_atrasada');
  perform pg_temp.ok070(no is not null and pg_temp.num070((no ->> 'valor')::numeric) = 4000,
    '70.FIM_MEIO_MES nó da folha atrasada deveria valer 4000');
  perform pg_temp.ok070(pg_temp.no070(no, 'rubrica:a.bolsas:folha_esperada:comprometido') is not null,
    '70.FIM_MEIO_MES deveria ter a parte do esperado');

  perform pg_temp.ok070(position('folha_atrasada' in coalesce(public.get_saldo_livre(v_um) ->> 'nota', '')) > 0,
    'a nota deveria explicar a conferência da folha atrasada');
end $$;

-- ------------------------------------------------------------
-- BLOCO 12 — atributos e ACL iguais aos da 066 (replace preserva).
-- ------------------------------------------------------------
do $$
declare
  v_sig text;
  v_fn  oid;
begin
  foreach v_sig in array array[
    'public.get_saldo_livre(uuid)',
    'public.explicar_livre_v2(uuid)'
  ] loop
    v_fn := v_sig::regprocedure;

    perform pg_temp.ok070(exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ), format('%s sem security definer ou search_path exato', v_sig));

    perform pg_temp.ok070(has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      format('authenticated perdeu EXECUTE em %s', v_sig));
    perform pg_temp.ok070(not has_function_privilege('anon', v_fn, 'EXECUTE'),
      format('anon não deveria ter EXECUTE em %s', v_sig));
    perform pg_temp.ok070(not exists (
      select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ), format('PUBLIC não deveria ter EXECUTE em %s', v_sig));
  end loop;

  -- O schema guarda centavos, então a soma exata não distingue o
  -- arredondamento: a conferência é estrutural, de propósito.
  perform pg_temp.ok070(
    position('round(greatest(coalesce(v_max_falta, 0), 0), 2)'
             in pg_get_functiondef('public.get_saldo_livre(uuid)'::regprocedure)) > 0,
    'get_saldo_livre deveria arredondar a falta a centavos');
end $$;

-- ------------------------------------------------------------
-- BLOCO 13 — BLOCO 1 da 051: a barreira do agente continua em
-- todas as tabelas de public (a 070 não cria tabela, mas confere).
-- ------------------------------------------------------------
do $$
declare v text;
begin
  select string_agg(c.relname, ', ') into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and c.relname <> 'propostas_agente'
     and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'trg_bloqueia_agente');
  perform pg_temp.ok070(v is null, format('BLOCO 1 da 051: sem barreira em %s', v));
end $$;

reset role;
rollback;
