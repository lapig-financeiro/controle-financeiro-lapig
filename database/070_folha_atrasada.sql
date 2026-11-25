-- ============================================================
-- 070_folha_atrasada.sql
--
-- FOLHA PAGA DEPOIS DO BALANCETE NÃO É DINHEIRO LIVRE.
--
-- `get_saldo_livre` supõe que o balancete de data D já contém a
-- folha de bolsas de todo mês até o mês que ele cobre (cober(D):
-- o mês de D se o dia passou do dia 07, senão o anterior). Quando
-- a FUNAPE paga uma folha ATRASADA, depois da data do balancete,
-- esse dinheiro não está no realizado nem nos compromissos (a
-- janela começa no mês seguinte a cober(D)): aparece como livre,
-- mas já tem dono.
--
-- Exemplo sintético: balancete em 03/11/2026 (cobre 10/2026),
-- folha de outubro paga em 13/11/2026. O realizado de 03/11 não a
-- tem, a janela começa em 11/2026 e ela não é compromisso. A
-- conferência abaixo a encontra comparando com o balancete de
-- 03/10/2026 e a desconta do livre.
--
-- A REGRA (conferir a folha contra os balancetes anteriores):
--
--   c_meses_conferencia = 6
--   real(x)     = sum(balancete_lancamentos.saldo_atual) de a.bolsas
--   cober(x)    = mês de x se o dia > 07, senão o anterior
--   candidatos k: balancetes anteriores do projeto com
--                 cober(D) − 6 meses <= cober(k) < cober(D)
--   esperado_k  = soma da folha de cada mês em (cober(k), cober(D)]
--                 (bolsas não canceladas que se sobrepõem ao mês,
--                 o mesmo critério da janela de compromissos)
--   visto_k     = real(D) − real(k)
--   falta_k     = esperado_k − visto_k
--   falta       = greatest(max(falta_k), 0), arredondada a centavos
--
-- Só o par mais longo vê duas folhas atrasadas; por isso o MÁXIMO,
-- não só o balancete imediatamente anterior. O `greatest(..., 0)`
-- protege o caso de bolsa antiga não cadastrada, em que o esperado
-- fica abaixo do visto: a conferência só ACRESCENTA compromisso,
-- errando para "cabe menos", como a 048.
--
-- `get_saldo_livre`: a conferência roda depois do bloco de
-- compromissos de bolsas e soma `falta` a `v_compromissos`. O resto
-- do corpo é o da 066 (janela do dia 07, taxas, rollup). Duas
-- chaves novas, aditivas: `folha_conferencia` ('feita',
-- 'sem_balancete_anterior' ou 'sem_balancete') e `folha_atrasada`
-- (null ou o detalhe do par que deu o máximo). Sem plano ativo, o
-- retorno antecipado é o de hoje. A `nota` ganha uma frase.
--
-- `explicar_livre_v2`: o nó `Comprometido — Bolsas` passa a valer só
-- a janela, e a folha atrasada vira um nó próprio, sinal −1,
-- `conta = 'folha esperada que o balancete ainda não mostra'`, com
-- o esperado (sinal +1) e o já visto (sinal −1) como partes. Sem
-- duplicar: a soma da árvore continua igual ao `saldo_livre`.
--
-- O QUE NÃO MUDA: assinatura, o guard `assert_project_allowed`, a
-- ACL da 035, a janela do dia 07, as taxas da 066 e o rollup. Nenhum
-- consumidor é alterado nesta tarefa: eles passam a ver o livre
-- menor quando houver folha atrasada, como nas 048 e 066.
--
-- Conferência: tests/sql/test_070_folha_atrasada.sql
-- Executor:    tools/replica-local/rodar-070-pglite.mjs
-- ============================================================

begin;

create or replace function public.get_saldo_livre(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Dia em que a FUNAPE paga as bolsas. Fato de negocio, nao convencao:
  -- se mudar, esta constante e o unico lugar a mexer.
  c_dia_pagamento constant integer := 7;

  -- Rubricas de taxa a reter (CIP/DAO). Lista unica: a regra do
  -- comprometido por taxa e o rotulo do grupo saem daqui; nao espalhar
  -- os codigos pelo corpo.
  c_rubricas_taxa constant text[] := array['cip_ufg', 'cip_ua', 'dao'];

  -- Quantos meses de balancetes anteriores a conferencia da folha
  -- atrasada olha. Seis cobrem uma folha atrasada dentro de um
  -- semestre; aumentar so estende a busca, nunca muda o que ja foi
  -- conferido no intervalo.
  c_meses_conferencia constant integer := 6;

  v_project       record;
  v_plano_id      uuid;
  v_balancete_id  uuid;
  v_data_ref      date;
  v_saldo_disp    numeric;
  v_rend          numeric;
  v_inicio_comp   date;
  v_ultimo_cober  date;
  v_fim_comp      date;
  v_meses_rest    integer;
  v_defasagem     integer;
  v_compromissos  numeric := 0;
  v_bolsas_det    jsonb   := '[]'::jsonb;
  v_rubricas      jsonb;
  v_grupos        jsonb;
  v_avisos        text[]  := '{}';

  -- Conferencia da folha atrasada (070).
  v_folha_conferencia text;
  v_folha_atrasada    jsonb;
  v_falta             numeric := 0;
  v_max_falta         numeric;
  v_esperado          numeric;
  v_visto             numeric;
  v_real_d            numeric;
  v_cober_k           date;
  v_data_k            date;
  v_qtd_bal_ant       integer;
begin
  perform public.assert_project_allowed(p_project_id);

  select * into v_project
    from public.projects
   where id = p_project_id;

  if not found then
    raise exception 'Projeto não encontrado: %', p_project_id;
  end if;

  -- Plano ativo (o previsto vem daqui)
  select id into v_plano_id
    from public.planos_trabalho
   where project_id = p_project_id and ativo = true
   limit 1;

  -- Balancete mais recente (o realizado vem daqui)
  select id, data_referencia, saldo_disponivel, rendimento_liquido
    into v_balancete_id, v_data_ref, v_saldo_disp, v_rend
    from public.balancetes
   where project_id = p_project_id
   order by data_referencia desc
   limit 1;

  if v_plano_id is null then
    return jsonb_build_object(
      'has_plano',     false,
      'has_balancete', v_balancete_id is not null,
      'project_id',    p_project_id,
      'project_name',  v_project.name,
      'message',       'Sem plano de trabalho ativo: não há previsto por rubrica para descontar. Cadastre/ative um plano antes de decidir alocação.'
    );
  end if;

  -- NB: usar array_append, não `||`. Com um literal sem tipo à direita,
  -- o Postgres resolve `anyarray || anyarray` e tenta ler a string como
  -- array literal ("malformed array literal").
  if v_balancete_id is null then
    v_avisos := array_append(v_avisos,
      'Sem balancete importado: realizado = 0. O saldo mostrado é o previsto do plano, não a execução real.');
  end if;

  -- ---------- Janela de compromissos ----------
  -- (A) O balancete de data D so contem a folha do mes de D se D
  -- passou do dia do pagamento; senao cobre ate o mes ANTERIOR. A 038
  -- supunha sempre coberto, e a folha do mes caia no vao entre o
  -- realizado (que nao a tinha) e os compromissos (que comecavam no
  -- mes seguinte). No limite exato do dia 07 assume-se NAO coberta:
  -- erra para "cabe menos", o lado seguro numa decisao de gasto.
  if v_data_ref is not null then
    v_ultimo_cober := case
      when extract(day from v_data_ref) > c_dia_pagamento
        then date_trunc('month', v_data_ref)::date
      else (date_trunc('month', v_data_ref) - interval '1 month')::date
    end;
    v_inicio_comp := (v_ultimo_cober + interval '1 month')::date;
  else
    v_ultimo_cober := null;
    v_inicio_comp := date_trunc('month', current_date)::date;
  end if;

  -- Termina no fim da vigência: depois disso o recurso não é mais
  -- deste projeto (e o não gasto volta ao financiador).
  v_fim_comp := v_project.end_date;

  if v_fim_comp is null then
    select max(s.end_date) into v_fim_comp
      from public.scholarships s
     where s.project_id = p_project_id and s.status <> 'cancelled';
    v_avisos := array_append(v_avisos,
      'Projeto sem data de término cadastrada: vigência desconhecida. Compromissos contados até o fim da última bolsa ativa, e não há como estimar risco de devolução.');
  end if;

  -- Meses restantes de vigência (inclusivo, a partir do mês corrente)
  if v_project.end_date is not null then
    v_meses_rest := greatest(0, (
        (date_part('year',  v_project.end_date) - date_part('year',  current_date)) * 12
      + (date_part('month', v_project.end_date) - date_part('month', current_date))
    )::integer + 1);

    if v_meses_rest = 0 then
      v_avisos := array_append(v_avisos,
        'Vigência encerrada: o saldo não gasto já é objeto de devolução ao financiador.');
    end if;
  end if;

  -- (C) Defasagem medida do ultimo mes COBERTO, nao da data do
  -- documento: um balancete de 03/08 nao cobre agosto, e a 038
  -- devolvia 0 justamente escondendo o mes que faltava.
  if v_ultimo_cober is not null then
    v_defasagem := greatest(0, (
        (date_part('year',  current_date) - date_part('year',  v_ultimo_cober)) * 12
      + (date_part('month', current_date) - date_part('month', v_ultimo_cober))
    )::integer);

    if v_defasagem >= 3 then
      v_avisos := array_append(v_avisos,
        format('Balancete cobre ate %s (%s meses atras): os compromissos incluem bolsas provavelmente já pagas. O saldo livre está subestimado.', to_char(v_ultimo_cober, 'MM/YYYY'), v_defasagem));
    end if;
  end if;

  -- ---------- Compromissos de bolsas ----------
  if v_fim_comp is not null and v_fim_comp >= v_inicio_comp then
    with bolsas as (
      select s.id,
             h.full_name,
             s.amount,
             s.start_date,
             s.end_date,
             count(*)::integer as meses
        from public.scholarships s
        join public.scholarship_holders h on h.id = s.holder_id
        join public.generate_month_series(v_inicio_comp, v_fim_comp) m
          on s.start_date <= m.month_end
         and s.end_date   >= m.month_start
       -- (B) A janela pode comecar no passado; bolsa ENCERRADA dentro
       -- dela teve pagamento que o balancete nao viu. Cancelada e a
       -- unica que de fato nao gera pagamento. A sobreposicao de datas
       -- continua excluindo o que terminou antes da janela.
       where s.project_id = p_project_id
         and s.status <> 'cancelled'
       group by s.id, h.full_name, s.amount, s.start_date, s.end_date
    )
    select coalesce(sum(b.amount * b.meses), 0),
           coalesce(jsonb_agg(
             jsonb_build_object(
               'scholarship_id', b.id,
               'bolsista',       b.full_name,
               'valor_mensal',   b.amount,
               'end_date',       b.end_date,
               'meses',          b.meses,
               'compromisso',    b.amount * b.meses
             ) order by (b.amount * b.meses) desc
           ), '[]'::jsonb)
      into v_compromissos, v_bolsas_det
      from bolsas b;
  end if;

  -- ---------- Conferência da folha atrasada (070) ----------
  -- A janela acima comeca no mes seguinte a cober(D) e o realizado
  -- so tem o que o balancete de D mostra. Uma folha paga DEPOIS de
  -- D, mas de mes que D ja deveria cobrir, cai no vao entre as duas
  -- fontes. Compara o realizado de a.bolsas de D com cada balancete
  -- anterior dos ultimos c_meses_conferencia meses: o que faltar
  -- para a folha esperada no intervalo e compromisso, nao livre.
  if v_balancete_id is null then
    v_folha_conferencia := 'sem_balancete';
  else
    select coalesce(sum(bl.saldo_atual), 0)
      into v_real_d
      from public.balancete_lancamentos bl
     where bl.balancete_id = v_balancete_id
       and bl.rubrica_code = 'a.bolsas';

    with candidatos as (
      select b.id, b.data_referencia,
             case when extract(day from b.data_referencia) > c_dia_pagamento
                  then date_trunc('month', b.data_referencia)::date
                  else (date_trunc('month', b.data_referencia) - interval '1 month')::date
             end as cober
        from public.balancetes b
       where b.project_id = p_project_id
         and b.id <> v_balancete_id
    ), filtrados as (
      select c.*
        from candidatos c
       where c.cober < v_ultimo_cober
         and c.cober >= (v_ultimo_cober - make_interval(months => c_meses_conferencia))::date
    ), reais as (
      select bl.balancete_id, sum(bl.saldo_atual) as v
        from public.balancete_lancamentos bl
       where bl.balancete_id in (select id from filtrados)
         and bl.rubrica_code = 'a.bolsas'
       group by bl.balancete_id
    ), avaliados as (
      select f.id, f.data_referencia, f.cober,
             coalesce((
               select sum(s.amount)
                 from public.scholarships s
                 join public.generate_month_series(
                        (f.cober + interval '1 month')::date, v_ultimo_cober) m
                   on s.start_date <= m.month_end
                  and s.end_date   >= m.month_start
                where s.project_id = p_project_id
                  and s.status <> 'cancelled'
             ), 0) as esperado,
             v_real_d - coalesce(r.v, 0) as visto
        from filtrados f
        left join reais r on r.balancete_id = f.id
    ), pontuados as (
      select a.*, a.esperado - a.visto as falta
        from avaliados a
    )
    select count(*), max(p.falta),
           (array_agg(p.esperado        order by p.falta desc, p.data_referencia desc))[1],
           (array_agg(p.visto           order by p.falta desc, p.data_referencia desc))[1],
           (array_agg(p.cober           order by p.falta desc, p.data_referencia desc))[1],
           (array_agg(p.data_referencia order by p.falta desc, p.data_referencia desc))[1]
      into v_qtd_bal_ant, v_max_falta,
           v_esperado, v_visto, v_cober_k, v_data_k
      from pontuados p;

    if v_qtd_bal_ant = 0 then
      v_folha_conferencia := 'sem_balancete_anterior';
    else
      v_folha_conferencia := 'feita';
      -- Nunca negativo: bolsa antiga que nao esta cadastrada faz o
      -- esperado ficar abaixo do visto, e isso nao pode virar
      -- dinheiro livre. Abaixo de R$ 0,01 e zero.
      v_falta := round(greatest(coalesce(v_max_falta, 0), 0), 2);
      if v_falta > 0 and v_falta < 0.01 then
        v_falta := 0;
      end if;

      v_compromissos := v_compromissos + v_falta;

      if v_falta > 0 then
        v_folha_atrasada := jsonb_build_object(
          'valor',           v_falta,
          'esperado',        v_esperado,
          'visto',           v_visto,
          'desde_balancete', v_data_k,
          'balancete',       v_data_ref,
          'mes_inicio',      (v_cober_k + interval '1 month')::date,
          'mes_fim',         v_ultimo_cober
        );

        v_avisos := array_append(v_avisos,
          format('A folha de bolsas de %s não aparece toda no balancete de %s: faltam R$ %s (esperado R$ %s desde o balancete de %s, visto R$ %s). A diferença conta como compromisso até aparecer.',
            case when (v_cober_k + interval '1 month')::date = v_ultimo_cober
                 then to_char(v_ultimo_cober, 'MM/YYYY')
                 else to_char((v_cober_k + interval '1 month')::date, 'MM/YYYY')
                      || ' a ' || to_char(v_ultimo_cober, 'MM/YYYY')
            end,
            to_char(v_data_ref, 'DD/MM/YYYY'),
            public._fmt_brl_num(v_falta),
            public._fmt_brl_num(v_esperado),
            to_char(v_data_k, 'DD/MM/YYYY'),
            public._fmt_brl_num(v_visto)));
      end if;
    end if;
  end if;

  -- ---------- Por rubrica e por grupo ----------
  with previsto as (
    select pr.rubrica_code, sum(pr.valor_previsto) as v
      from public.plano_rubricas pr
     where pr.plano_id = v_plano_id
     group by pr.rubrica_code
  ), realizado as (
    select bl.rubrica_code, sum(bl.saldo_atual) as v
      from public.balancete_lancamentos bl
     where bl.balancete_id = v_balancete_id
       and bl.rubrica_code is not null
     group by bl.rubrica_code
  ), base as (
    select r.code,
           r.name,
           r.parent_code,
           r.ordem,
           coalesce(r.parent_code, r.code)      as grupo_code,
           coalesce(p.v,  0)                    as previsto,
           coalesce(rr.v, 0)                    as realizado,
           -- Bolsas: compromisso da janela. Taxas (CIP/DAO): a taxa a
           -- reter e sempre compromisso; se a cobranca passou do
           -- previsto, sobra negativo no livre em vez de compromisso.
           case
             when r.code = 'a.bolsas' then v_compromissos
             when r.code = any(c_rubricas_taxa)
               then greatest(coalesce(p.v, 0) - coalesce(rr.v, 0), 0)
             else 0
           end as compromissos,
           (r.code = 'a.bolsas')                as rastreia_compromissos,
           case
             when r.code = 'a.bolsas' then 'bolsas'
             when r.code = any(c_rubricas_taxa) then 'taxa'
             else null
           end as compromisso_tipo
      from public.rubricas r
      left join previsto  p  on p.rubrica_code  = r.code
      left join realizado rr on rr.rubrica_code = r.code
     where coalesce(p.v, 0) > 0
        or coalesce(rr.v, 0) > 0
        or (r.code = 'a.bolsas' and v_compromissos > 0)
  )
  select
    -- detalhe por rubrica
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'rubrica_code',  b.code,
          'rubrica_name',  b.name,
          'grupo_code',    b.grupo_code,
          'previsto',      b.previsto,
          'realizado',     b.realizado,
          'saldo',         b.previsto - b.realizado,
          'compromissos',  b.compromissos,
          'saldo_livre',   b.previsto - b.realizado - b.compromissos,
          'compromisso_tipo', b.compromisso_tipo
        ) order by b.ordem
      ) from base b
    ), '[]'::jsonb),
    -- rollup por grupo (superfície de decisão)
    coalesce((
      select jsonb_agg(g.obj order by g.ordem)
        from (
          select min(b.ordem) as ordem,
                 jsonb_build_object(
                   'grupo_code',   b.grupo_code,
                   'grupo_name',   coalesce(gr.name, b.grupo_code),
                   'previsto',     sum(b.previsto),
                   'realizado',    sum(b.realizado),
                   'saldo',        sum(b.previsto) - sum(b.realizado),
                   'compromissos', sum(b.compromissos),
                   'saldo_livre',  sum(b.previsto) - sum(b.realizado) - sum(b.compromissos),
                   'compromissos_cobertura',
                     case
                       when coalesce(bool_or(b.compromisso_tipo = 'bolsas'), false)
                        and coalesce(bool_or(b.compromisso_tipo = 'taxa'), false)
                         then 'bolsas e taxas'
                       when coalesce(bool_or(b.compromisso_tipo = 'bolsas'), false)
                         then 'bolsas'
                       when coalesce(bool_or(b.compromisso_tipo = 'taxa'), false)
                         then 'taxas'
                       else 'nenhuma'
                     end
                 ) as obj
            from base b
            left join public.rubricas gr on gr.code = b.grupo_code
           group by b.grupo_code, gr.name
        ) g
    ), '[]'::jsonb)
    into v_rubricas, v_grupos;

  return jsonb_build_object(
    'has_plano',        true,
    'has_balancete',    v_balancete_id is not null,
    'project_id',       p_project_id,
    'project_name',     v_project.name,
    'end_date',         v_project.end_date,
    'meses_restantes',  v_meses_rest,
    'balancete_id',           v_balancete_id,
    'data_referencia',        v_data_ref,
    'balancete_cobre_ate',    v_ultimo_cober,
    'balancete_defasagem_meses', v_defasagem,
    'saldo_disponivel_caixa', v_saldo_disp,
    'rendimento_liquido',     v_rend,
    'compromissos_inicio',    v_inicio_comp,
    'compromissos_fim',       v_fim_comp,
    'compromissos_bolsas',    v_compromissos,
    'folha_conferencia',      v_folha_conferencia,
    'folha_atrasada',         v_folha_atrasada,
    'bolsas_ativas',          v_bolsas_det,
    'grupos',                 v_grupos,
    'rubricas',               v_rubricas,
    'avisos',                 to_jsonb(v_avisos),
    'nota',
      'saldo_livre = previsto − realizado − compromissos. Compromissos de BOLSAS são rastreados na janela até o fim da vigência (as bolsas são pagas no dia 07); nas rubricas de TAXA a reter (cip_ufg, cip_ua, dao), compromissos = greatest(previsto − realizado, 0): o que falta cobrar não é livre e cobrança acima do previsto continua abatendo o livre. Onde compromissos_cobertura = ''nenhuma'', saldo_livre é apenas previsto − realizado e não foi verificado contra compromissos assumidos. A janela de compromissos comeca no mes seguinte ao ultimo que o balancete cobre (`balancete_cobre_ate`), porque as bolsas sao pagas no dia 07 e um balancete emitido antes disso nao contem a folha do proprio mes. A folha de bolsas dos meses que o balancete ja cobre e conferida contra os balancetes anteriores dos ultimos 6 meses (`folha_conferencia`): o que o realizado nao mostra entra em compromissos como `folha_atrasada`, para nao aparecer como livre. Remanejamento entre letras exige aprovação do financiador e não está considerado.'
  );
end;
$$;

comment on function public.get_saldo_livre is
  'Saldo realmente livre por grupo de rubrica até o fim da vigência. Compromissos de bolsas na janela do dia 07 (048), nas rubricas de taxa a reter (CIP/DAO) o que ainda falta cobrar: greatest(previsto − realizado, 0) (066), e a folha atrasada conferida contra os balancetes anteriores de 6 meses (070). Guard: assert_project_allowed.';

create or replace function public.explicar_livre_v2(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_sl jsonb; v_has_plano boolean; v_has_balancete boolean; v_data_ref text; v_motivo text; v_mascarar boolean;
  v_balancete_id uuid; v_plano_id uuid; v_grupos jsonb; v_rubricas jsonb; v_bolsas jsonb;
  v_livre_total numeric; v_partes_grupos jsonb := '[]'::jsonb;
  v_alvos_prev jsonb; v_alvos_real jsonb; v_alvos_comp jsonb;
  v_origens_prev jsonb := '{}'::jsonb; v_origens_real jsonb := '{}'::jsonb; v_origens_comp jsonb := '{}'::jsonb;
  v_g jsonb; v_g_code text; v_g_name text; v_g_saldo numeric; v_g_cob text; v_g_partes jsonb;
  v_r jsonb; v_r_code text; v_r_name text; v_r_prev numeric; v_r_real numeric; v_r_comp numeric; v_r_tipo text;
  v_no_prev jsonb; v_no_real jsonb;
  v_prev_folhas jsonb; v_real_folhas jsonb; v_comp_folhas jsonb;
  v_folha jsonb; v_folha_valor numeric := 0;
  v_folha_esperado numeric; v_folha_visto numeric;
  v_folha_mes_ini date; v_folha_mes_fim date; v_folha_desde date; v_folha_bal date;
  v_alvos_folha jsonb; v_origens_folha jsonb := '{}'::jsonb;
  v_folha_esp jsonb := '[]'::jsonb; v_folha_visto_det jsonb := '[]'::jsonb;
  v_folha_partes jsonb := '[]'::jsonb;
begin
  if p_project_id is null then raise exception 'project_id é obrigatório.' using errcode = '22023'; end if;
  perform public.assert_project_allowed(p_project_id);
  v_mascarar := (not public.is_admin()) or public.is_agente();

  v_sl := public.get_saldo_livre(p_project_id);
  v_has_plano := coalesce((v_sl ->> 'has_plano')::boolean, false);
  v_has_balancete := coalesce((v_sl ->> 'has_balancete')::boolean, false);
  v_data_ref := nullif(v_sl ->> 'data_referencia', '');
  v_grupos := coalesce(v_sl -> 'grupos', '[]'::jsonb);

  if not v_has_plano then v_motivo := 'sem plano'; v_data_ref := null;
  elsif not v_has_balancete then v_motivo := 'sem balancete'; v_data_ref := null;
  elsif jsonb_typeof(v_grupos) <> 'array' or jsonb_array_length(v_grupos) = 0 then v_motivo := 'sem números';
  end if;

  if v_motivo is not null then
    return jsonb_build_object(
      'valor', null, 'motivo', v_motivo, 'data_referencia', v_data_ref, 'rotulo', 'Livre para gastar',
      'tipo', 'calculo', 'conta', 'soma dos grupos', 'chave', 'livre', 'sinal', 1, 'ref', null, 'nota', null, 'partes', '[]'::jsonb
    );
  end if;

  v_balancete_id := nullif(v_sl ->> 'balancete_id', '')::uuid;
  v_rubricas := coalesce(v_sl -> 'rubricas', '[]'::jsonb);
  v_bolsas := coalesce(v_sl -> 'bolsas_ativas', '[]'::jsonb);

  select pt.id into v_plano_id from public.planos_trabalho pt
   where pt.project_id = p_project_id and pt.ativo = true order by pt.versao desc limit 1;

  -- 065: os alvos das folhas viram conjuntos; a origem sai em uma consulta por tabela.
  select coalesce(jsonb_agg(jsonb_build_object(
           'alvo_tabela', 'plano_rubricas', 'alvo_id', pr.id, 'campo', 'valor_previsto')), '[]'::jsonb)
    into v_alvos_prev
    from public.plano_rubricas pr
   where pr.plano_id = v_plano_id and pr.valor_previsto <> 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'alvo_tabela', 'balancete_lancamentos', 'alvo_id', bl.id, 'campo', 'saldo_atual')), '[]'::jsonb)
    into v_alvos_real
    from public.balancete_lancamentos bl
   where bl.balancete_id = v_balancete_id and bl.saldo_atual <> 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'alvo_tabela', 'scholarships', 'alvo_id', (b.elem ->> 'scholarship_id')::uuid, 'campo', 'amount')), '[]'::jsonb)
    into v_alvos_comp
    from jsonb_array_elements(v_bolsas) as b(elem)
   where coalesce((b.elem ->> 'compromisso')::numeric, 0) <> 0;

  -- 065 (2ª rodada): uma chamada por tabela, fora do laço das rubricas; o resultado
  -- fica indexado por (alvo_tabela, alvo_id, campo) e é consultado a cada folha.
  select coalesce(jsonb_object_agg(
           o.alvo_tabela || '|' || coalesce(o.alvo_id::text, '') || '|' || o.campo, o.origem),
         '{}'::jsonb)
    into v_origens_prev
    from public._resolver_origens_v2(v_alvos_prev, v_mascarar) o;

  select coalesce(jsonb_object_agg(
           o.alvo_tabela || '|' || coalesce(o.alvo_id::text, '') || '|' || o.campo, o.origem),
         '{}'::jsonb)
    into v_origens_real
    from public._resolver_origens_v2(v_alvos_real, v_mascarar) o;

  select coalesce(jsonb_object_agg(
           o.alvo_tabela || '|' || coalesce(o.alvo_id::text, '') || '|' || o.campo, o.origem),
         '{}'::jsonb)
    into v_origens_comp
    from public._resolver_origens_v2(v_alvos_comp, v_mascarar) o;

  -- 070: a folha atrasada e a parte do compromisso de bolsas que o
  -- balancete ainda nao mostra. O valor ja entrou em
  -- compromissos_bolsas; na arvore ele e separado do no da janela
  -- (`Comprometido — Bolsas` passa a valer so a janela) para a soma
  -- continuar fechando, sem duplicar. As partes do no novo sao o
  -- esperado (sinal +1) e o ja visto nos dois balancetes (sinal -1).
  v_folha := v_sl -> 'folha_atrasada';
  if v_folha is not null and jsonb_typeof(v_folha) = 'object' then
    v_folha_valor    := coalesce((v_folha ->> 'valor')::numeric, 0);
    v_folha_esperado := coalesce((v_folha ->> 'esperado')::numeric, 0);
    v_folha_visto    := coalesce((v_folha ->> 'visto')::numeric, 0);
    v_folha_mes_ini  := (v_folha ->> 'mes_inicio')::date;
    v_folha_mes_fim  := (v_folha ->> 'mes_fim')::date;
    v_folha_desde    := (v_folha ->> 'desde_balancete')::date;
    v_folha_bal      := (v_folha ->> 'balancete')::date;

    -- Alvos das folhas novas: as bolsas que se sobrepoem aos meses
    -- atrasados e as linhas de a.bolsas dos dois balancetes.
    select coalesce(jsonb_agg(jsonb_build_object(
             'alvo_tabela', 'scholarships', 'alvo_id', b.id, 'campo', 'amount')), '[]'::jsonb)
      into v_alvos_folha
      from (
        select s.id
          from public.scholarships s
          join public.generate_month_series(v_folha_mes_ini, v_folha_mes_fim) m
            on s.start_date <= m.month_end
           and s.end_date   >= m.month_start
         where s.project_id = p_project_id
           and s.status <> 'cancelled'
         group by s.id
      ) b;

    v_alvos_folha := v_alvos_folha || coalesce((
      select jsonb_agg(jsonb_build_object(
               'alvo_tabela', 'balancete_lancamentos', 'alvo_id', bl.id, 'campo', 'saldo_atual'))
        from public.balancete_lancamentos bl
        join public.balancetes b on b.id = bl.balancete_id
       where bl.rubrica_code = 'a.bolsas'
         and bl.saldo_atual <> 0
         and b.project_id = p_project_id
         and b.data_referencia in (v_folha_bal, v_folha_desde)
    ), '[]'::jsonb);

    select coalesce(jsonb_object_agg(
             o.alvo_tabela || '|' || coalesce(o.alvo_id::text, '') || '|' || o.campo, o.origem),
           '{}'::jsonb)
      into v_origens_folha
      from public._resolver_origens_v2(v_alvos_folha, v_mascarar) o;

    -- Folha esperada: uma folha por bolsa e por mes do intervalo,
    -- mesmo criterio de sobreposicao do bloco de compromissos.
    select coalesce(jsonb_agg(jsonb_build_object(
      'rotulo', b.nome || ' — ' || b.meses || case when b.meses = 1 then ' mês' else ' meses' end
                || ' × R$ ' || public._fmt_brl_num(b.amount),
      'valor', b.amount * b.meses,
      'tipo', coalesce(v_origens_folha -> ('scholarships|' || b.id::text || '|amount') ->> 'tipo', 'digitado'),
      'chave', 'linha:' || b.id::text, 'conta', null, 'sinal', 1,
      'ref', jsonb_build_object('alvo_tabela', 'scholarships', 'alvo_id', b.id, 'campo', 'amount'),
      'nota', case when v_mascarar
                   then public._mascarar_cpf(v_origens_folha -> ('scholarships|' || b.id::text || '|amount') ->> 'nota')
                   else v_origens_folha -> ('scholarships|' || b.id::text || '|amount') ->> 'nota' end,
      'partes', '[]'::jsonb
    ) order by (b.amount * b.meses) desc, b.id), '[]'::jsonb)
      into v_folha_esp
      from (
        select s.id,
               case when v_mascarar then public._mascarar_cpf(h.full_name) else h.full_name end as nome,
               s.amount,
               count(*)::integer as meses
          from public.scholarships s
          join public.scholarship_holders h on h.id = s.holder_id
          join public.generate_month_series(v_folha_mes_ini, v_folha_mes_fim) m
            on s.start_date <= m.month_end
           and s.end_date   >= m.month_start
         where s.project_id = p_project_id
           and s.status <> 'cancelled'
         group by s.id, h.full_name, s.amount
      ) b;

    -- Ja visto: a diferenca de realizado de a.bolsas entre D e o
    -- balancete de comparacao. As linhas de D somam +1 e as de k -1.
    select coalesce(jsonb_agg(jsonb_build_object(
      'rotulo', case when v_mascarar
                     then public._mascarar_cpf(case when nullif(btrim(bl.conta_descricao, E' \t\n\r'), '') is not null then bl.conta_codigo || ' — ' || btrim(bl.conta_descricao, E' \t\n\r') else bl.conta_codigo end)
                     else case when nullif(btrim(bl.conta_descricao, E' \t\n\r'), '') is not null then bl.conta_codigo || ' — ' || btrim(bl.conta_descricao, E' \t\n\r') else bl.conta_codigo end end,
      'valor', bl.saldo_atual,
      'tipo', coalesce(v_origens_folha -> ('balancete_lancamentos|' || bl.id::text || '|saldo_atual') ->> 'tipo', 'legado'),
      'chave', 'linha:' || bl.id::text, 'conta', null,
      'sinal', case when bl.balancete_id = v_balancete_id then 1 else -1 end,
      'ref', jsonb_build_object('alvo_tabela', 'balancete_lancamentos', 'alvo_id', bl.id, 'campo', 'saldo_atual'),
      'nota', case when v_mascarar
                   then public._mascarar_cpf(v_origens_folha -> ('balancete_lancamentos|' || bl.id::text || '|saldo_atual') ->> 'nota')
                   else v_origens_folha -> ('balancete_lancamentos|' || bl.id::text || '|saldo_atual') ->> 'nota' end,
      'partes', '[]'::jsonb
    ) order by (bl.balancete_id = v_balancete_id) desc, bl.saldo_atual desc, bl.conta_codigo, bl.id), '[]'::jsonb)
      into v_folha_visto_det
      from public.balancete_lancamentos bl
      join public.balancetes b on b.id = bl.balancete_id
     where bl.rubrica_code = 'a.bolsas'
       and bl.saldo_atual <> 0
       and b.project_id = p_project_id
       and b.data_referencia in (v_folha_bal, v_folha_desde);

    if v_folha_esperado <> 0 and jsonb_array_length(v_folha_esp) > 0 then
      v_folha_partes := v_folha_partes || jsonb_build_array(jsonb_build_object(
        'rotulo', 'Folha esperada de ' || case when v_folha_mes_ini = v_folha_mes_fim
                    then to_char(v_folha_mes_ini, 'MM/YYYY')
                    else to_char(v_folha_mes_ini, 'MM/YYYY') || ' a ' || to_char(v_folha_mes_fim, 'MM/YYYY') end,
        'valor', v_folha_esperado, 'tipo', 'calculo',
        'chave', 'rubrica:a.bolsas:folha_esperada:comprometido',
        'conta', 'bolsas cadastradas nos meses que o balancete não mostra',
        'sinal', 1, 'ref', null, 'nota', null, 'partes', v_folha_esp));
    end if;

    if v_folha_visto <> 0 and jsonb_array_length(v_folha_visto_det) > 0 then
      v_folha_partes := v_folha_partes || jsonb_build_array(jsonb_build_object(
        'rotulo', 'Folha já no balancete de ' || to_char(v_folha_bal, 'DD/MM/YYYY'),
        'valor', v_folha_visto, 'tipo', 'calculo',
        'chave', 'rubrica:a.bolsas:folha_vista:realizado',
        'conta', 'diferença de realizado de bolsas entre os dois balancetes',
        'sinal', -1, 'ref', null, 'nota', null, 'partes', v_folha_visto_det));
    end if;
  end if;

  for v_g in select value from jsonb_array_elements(v_grupos) loop
    v_g_code := v_g ->> 'grupo_code'; v_g_name := v_g ->> 'grupo_name';
    v_g_saldo := (v_g ->> 'saldo_livre')::numeric; v_g_cob := v_g ->> 'compromissos_cobertura'; v_g_partes := '[]'::jsonb;

    for v_r in select value from jsonb_array_elements(v_rubricas) where value ->> 'grupo_code' = v_g_code loop
      v_r_code := v_r ->> 'rubrica_code'; v_r_name := v_r ->> 'rubrica_name';
      v_r_prev := coalesce((v_r ->> 'previsto')::numeric, 0);
      v_r_real := coalesce((v_r ->> 'realizado')::numeric, 0);
      v_r_comp := coalesce((v_r ->> 'compromissos')::numeric, 0);
      v_r_tipo := v_r ->> 'compromisso_tipo';

      select coalesce(jsonb_agg(jsonb_build_object(
        'rotulo', case when v_mascarar then public._mascarar_cpf(coalesce(nullif(btrim(pr.descricao_livre, E' \t\n\r"'), ''), v_r_name))
                  else coalesce(nullif(btrim(pr.descricao_livre, E' \t\n\r"'), ''), v_r_name) end,
        'valor', pr.valor_previsto,
        'tipo', coalesce(v_origens_prev -> ('plano_rubricas|' || pr.id::text || '|valor_previsto') ->> 'tipo', 'legado'),
        'chave', 'linha:' || pr.id::text,
        'conta', null, 'sinal', 1, 'ref', jsonb_build_object('alvo_tabela', 'plano_rubricas', 'alvo_id', pr.id, 'campo', 'valor_previsto'),
        'nota', case when v_mascarar
                     then public._mascarar_cpf(v_origens_prev -> ('plano_rubricas|' || pr.id::text || '|valor_previsto') ->> 'nota')
                     else v_origens_prev -> ('plano_rubricas|' || pr.id::text || '|valor_previsto') ->> 'nota' end,
        'partes', '[]'::jsonb
      ) order by pr.valor_previsto desc, pr.descricao_livre nulls last, pr.id), '[]'::jsonb)
        into v_prev_folhas
        from public.plano_rubricas pr
       where pr.plano_id = v_plano_id and pr.rubrica_code = v_r_code and pr.valor_previsto <> 0;

      v_no_prev := jsonb_build_object(
        'rotulo', 'Previsto — ' || v_r_name, 'valor', v_r_prev, 'tipo', 'calculo',
        'chave', 'rubrica:' || v_r_code || ':previsto', 'conta', 'soma das linhas do plano',
        'sinal', 1, 'ref', null, 'nota', null, 'partes', v_prev_folhas
      );

      if v_r_prev <> 0 or jsonb_array_length(v_prev_folhas) > 0 then
        v_g_partes := v_g_partes || jsonb_build_array(v_no_prev);
      end if;

      select coalesce(jsonb_agg(jsonb_build_object(
        'rotulo', case when v_mascarar then public._mascarar_cpf(case when nullif(btrim(bl.conta_descricao, E' \t\n\r'), '') is not null then bl.conta_codigo || ' — ' || btrim(bl.conta_descricao, E' \t\n\r') else bl.conta_codigo end)
                  else case when nullif(btrim(bl.conta_descricao, E' \t\n\r'), '') is not null then bl.conta_codigo || ' — ' || btrim(bl.conta_descricao, E' \t\n\r') else bl.conta_codigo end end,
        'valor', bl.saldo_atual,
        'tipo', coalesce(v_origens_real -> ('balancete_lancamentos|' || bl.id::text || '|saldo_atual') ->> 'tipo', 'legado'),
        'chave', 'linha:' || bl.id::text,
        'conta', null, 'sinal', 1, 'ref', jsonb_build_object('alvo_tabela', 'balancete_lancamentos', 'alvo_id', bl.id, 'campo', 'saldo_atual'),
        'nota', case when v_mascarar
                     then public._mascarar_cpf(v_origens_real -> ('balancete_lancamentos|' || bl.id::text || '|saldo_atual') ->> 'nota')
                     else v_origens_real -> ('balancete_lancamentos|' || bl.id::text || '|saldo_atual') ->> 'nota' end,
        'partes', '[]'::jsonb
      ) order by bl.saldo_atual desc, bl.conta_codigo, bl.id), '[]'::jsonb)
        into v_real_folhas
        from public.balancete_lancamentos bl
       where bl.balancete_id = v_balancete_id and bl.rubrica_code = v_r_code and bl.saldo_atual <> 0;

      v_no_real := jsonb_build_object(
        'rotulo', 'Realizado — ' || v_r_name, 'valor', v_r_real, 'tipo', 'calculo',
        'chave', 'rubrica:' || v_r_code || ':realizado', 'conta', 'soma das contas do balancete',
        'sinal', -1, 'ref', null, 'nota', null, 'partes', v_real_folhas
      );

      if v_r_real <> 0 or jsonb_array_length(v_real_folhas) > 0 then
        v_g_partes := v_g_partes || jsonb_build_array(v_no_real);
      end if;

      if v_r_code = 'a.bolsas' then
        select coalesce(jsonb_agg(jsonb_build_object(
          'rotulo', case when v_mascarar then public._mascarar_cpf((b.elem ->> 'bolsista') || ' — ' || (b.elem ->> 'meses') || case when (b.elem ->> 'meses')::integer = 1 then ' mês' else ' meses' end || ' × R$ ' || public._fmt_brl_num((b.elem ->> 'valor_mensal')::numeric))
                    else (b.elem ->> 'bolsista') || ' — ' || (b.elem ->> 'meses') || case when (b.elem ->> 'meses')::integer = 1 then ' mês' else ' meses' end || ' × R$ ' || public._fmt_brl_num((b.elem ->> 'valor_mensal')::numeric) end,
          'valor', (b.elem ->> 'compromisso')::numeric,
          'tipo', coalesce(v_origens_comp -> ('scholarships|' || (b.elem ->> 'scholarship_id') || '|amount') ->> 'tipo', 'digitado'),
          'chave', 'linha:' || (b.elem ->> 'scholarship_id'), 'conta', null, 'sinal', 1,
          'ref', jsonb_build_object('alvo_tabela', 'scholarships', 'alvo_id', (b.elem ->> 'scholarship_id')::uuid, 'campo', 'amount'),
          'nota', case when v_mascarar
                       then public._mascarar_cpf(v_origens_comp -> ('scholarships|' || (b.elem ->> 'scholarship_id') || '|amount') ->> 'nota')
                       else v_origens_comp -> ('scholarships|' || (b.elem ->> 'scholarship_id') || '|amount') ->> 'nota' end,
          'partes', '[]'::jsonb
        ) order by (b.elem ->> 'compromisso')::numeric desc, b.ord), '[]'::jsonb)
          into v_comp_folhas
          from jsonb_array_elements(v_bolsas) with ordinality as b(elem, ord)
         where coalesce((b.elem ->> 'compromisso')::numeric, 0) <> 0;

        -- 070: v_r_comp ja inclui a folha atrasada. O no da janela
        -- vale so as bolsas da janela (v_comp_folhas) e a folha
        -- atrasada vira um no proprio logo abaixo.
        if v_r_comp - v_folha_valor <> 0 or jsonb_array_length(v_comp_folhas) > 0 then
          v_g_partes := v_g_partes || jsonb_build_array(jsonb_build_object(
            'rotulo', 'Comprometido — ' || v_r_name, 'valor', v_r_comp - v_folha_valor, 'tipo', 'calculo',
            'chave', 'rubrica:' || v_r_code || ':comprometido', 'conta', 'soma das bolsas na janela',
            'sinal', -1, 'ref', null, 'nota', null, 'partes', v_comp_folhas
          ));
        end if;

        if v_folha_valor > 0 then
          v_g_partes := v_g_partes || jsonb_build_array(jsonb_build_object(
            'rotulo', 'Comprometido — folha atrasada', 'valor', v_folha_valor, 'tipo', 'calculo',
            'chave', 'rubrica:a.bolsas:folha_atrasada',
            'conta', 'folha esperada que o balancete ainda não mostra',
            'sinal', -1, 'ref', null, 'nota', null, 'partes', v_folha_partes
          ));
        end if;
      end if;

      -- 066: taxa a reter com compromisso > 0. As partes são os nós de
      -- previsto e realizado já montados acima; o nó só existe quando
      -- previsto > realizado, então a soma (previsto − realizado) é
      -- exatamente o compromisso. Sem nó de realizado (realizado = 0),
      -- o previsto sozinho fecha a conta.
      if v_r_tipo = 'taxa' and v_r_comp > 0 then
        v_g_partes := v_g_partes || jsonb_build_array(jsonb_build_object(
          'rotulo', 'Comprometido — ' || v_r_name, 'valor', v_r_comp, 'tipo', 'calculo',
          'chave', 'rubrica:' || v_r_code || ':comprometido',
          'conta', 'taxa a reter (previsto − realizado)', 'sinal', -1, 'ref', null, 'nota', null,
          'partes', jsonb_build_array(v_no_prev) || case
            when v_r_real <> 0 or jsonb_array_length(v_real_folhas) > 0 then jsonb_build_array(v_no_real)
            else '[]'::jsonb
          end
        ));
      end if;
    end loop;

    v_partes_grupos := v_partes_grupos || jsonb_build_array(jsonb_build_object(
      'rotulo', v_g_name, 'valor', v_g_saldo, 'tipo', 'calculo', 'chave', 'grupo:' || v_g_code,
      'conta', case when v_g_cob in ('bolsas', 'taxas', 'bolsas e taxas')
                    then 'previsto − realizado − comprometido'
                    else 'previsto − realizado' end,
      'sinal', 1, 'ref', null,
      'nota', case
                when v_g_cob = 'nenhuma' then 'compromissos fora de bolsas não são rastreados'
                when v_g_cob = 'taxas' then 'taxa a reter pela fundação/universidade: não é livre'
                when v_g_cob = 'bolsas e taxas' then 'taxa a reter pela fundação/universidade: não é livre; bolsas contratadas também entram'
                else null
              end,
      'partes', v_g_partes
    ));
  end loop;

  select sum((g ->> 'saldo_livre')::numeric) into v_livre_total
    from jsonb_array_elements(v_grupos) as g where g ->> 'saldo_livre' is not null;

  return jsonb_build_object(
    'valor', v_livre_total, 'motivo', null, 'data_referencia', v_data_ref, 'rotulo', 'Livre para gastar',
    'tipo', 'calculo', 'conta', 'soma dos grupos', 'chave', 'livre', 'sinal', 1, 'ref', null, 'nota', null, 'partes', v_partes_grupos
  );
end;
$$;

comment on function public.explicar_livre_v2(uuid) is
  'Monta a árvore do saldo livre por centro a partir de get_saldo_livre, resolvendo a origem das folhas em lote e mascarando CPF para não-admin/agente. Separa a folha atrasada do compromisso da janela (070).';

revoke all on function public.explicar_livre_v2(uuid) from public, anon;
grant execute on function public.explicar_livre_v2(uuid) to authenticated;

revoke all on function public.get_saldo_livre(uuid) from public, anon;
grant execute on function public.get_saldo_livre(uuid) to authenticated;

-- ------------------------------------------------------------
-- Asserções — abortam a transação se o efeito não for o pretendido
-- ------------------------------------------------------------
do $asserts$
declare
  v_sig text;
  v_fn  oid;
  v_def text;
  v_cobre date;
begin
  foreach v_sig in array array[
    'public.get_saldo_livre(uuid)',
    'public.explicar_livre_v2(uuid)'
  ] loop
    v_fn := v_sig::regprocedure;

    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig is not null
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '070: % sem security definer ou search_path exato', v_sig;
    end if;

    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '070: authenticated perdeu EXECUTE em %', v_sig;
    end if;

    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (
         select 1 from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '070: anon/PUBLIC possui EXECUTE em %', v_sig;
    end if;
  end loop;

  -- A regra da janela (048) continua a mesma, isolada para ficar
  -- explícito que a conferência usa exatamente o mesmo cober().
  v_cobre := (case when extract(day from date '2026-11-03') > 7
                   then date_trunc('month', date '2026-11-03')
                   else date_trunc('month', date '2026-11-03') - interval '1 month' end)::date;
  if v_cobre is distinct from date '2026-10-01' then
    raise exception '070: balancete de 03/11 deveria cobrir até 10/2026, deu %.', v_cobre;
  end if;
  v_cobre := (case when extract(day from date '2026-11-17') > 7
                   then date_trunc('month', date '2026-11-17')
                   else date_trunc('month', date '2026-11-17') - interval '1 month' end)::date;
  if v_cobre is distinct from date '2026-11-01' then
    raise exception '070: balancete de 17/11 deveria cobrir até 11/2026, deu %.', v_cobre;
  end if;

  v_def := pg_get_functiondef('public.get_saldo_livre(uuid)'::regprocedure);
  if position('c_meses_conferencia' in v_def) = 0
     or position('folha_conferencia' in v_def) = 0
     or position('folha_atrasada' in v_def) = 0
     or position('greatest(coalesce(v_max_falta, 0), 0)' in v_def) = 0 then
    raise exception '070: get_saldo_livre não contém a conferência da folha atrasada.';
  end if;
  if position('cip_ufg' in v_def) = 0
     or position('cip_ua' in v_def) = 0
     or position('dao' in v_def) = 0 then
    raise exception '070: get_saldo_livre não contém as três rubricas de taxa na constante.';
  end if;

  v_def := pg_get_functiondef('public.explicar_livre_v2(uuid)'::regprocedure);
  if position('Comprometido — folha atrasada' in v_def) = 0
     or position('folha esperada que o balancete ainda não mostra' in v_def) = 0 then
    raise exception '070: explicar_livre_v2 não separa a folha atrasada.';
  end if;
  if position('taxa a reter (previsto − realizado)' in v_def) = 0 then
    raise exception '070: explicar_livre_v2 não contém a conta da taxa a reter.';
  end if;
end
$asserts$;

commit;
