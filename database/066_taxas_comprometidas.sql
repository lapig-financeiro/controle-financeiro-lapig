-- ============================================================
-- 066_taxas_comprometidas.sql
--
-- A TAXA A RETER NÃO É DINHEIRO LIVRE.
--
-- Decisão do Victor em 19/11/2026: "O que falta pagar para o CIP e
-- DAO não pode ser considerado como valor a ser usado. A taxa pode
-- variar (ex.: 15%). Todo desembolso que entrar, normalmente a
-- FUNAPE separa os 15% e leva para outra conta. Alguns casos a
-- FUNAPE só desconta no final, mas no geral não precisamos pensar
-- nisso. O ponto é não considerarmos o valor da taxa como um valor
-- que podemos usar: FUNAPE/UFG/IESA sempre vão receber o que lhes
-- é devido."
--
-- O saldo positivo das rubricas `cip_ufg`, `cip_ua` e `dao`
-- (previsto − realizado) entrava no livre. No 30.109 são ~R$ 137
-- mil medidos na produção em 19/11. A partir desta migração:
--
--   compromissos (rubrica de taxa) = greatest(previsto − realizado, 0)
--   saldo_livre                     = least(previsto − realizado, 0)
--
-- O que falta cobrar vira comprometido; cobrança acima do previsto
-- (negativo) continua abatendo o livre, porque é dinheiro que já
-- saiu. As bolsas (`a.bolsas`) não mudam: continuam com a janela do
-- dia 7 da 048.
--
-- `get_saldo_livre`: só o bloco de rubricas muda (constante
-- `c_rubricas_taxa`, `compromisso_tipo` por rubrica e
-- `compromissos_cobertura` do grupo). A janela, os avisos e o
-- retorno são os da 048; `create or replace` repete `security
-- definer`, `search_path` e o guard `assert_project_allowed`.
--
-- `explicar_livre_v2`: cópia da 065 com uma parte nova nas rubricas
-- de taxa com compromisso > 0 — `Comprometido — <rubrica>`, sinal
-- -1, `conta = 'taxa a reter (previsto − realizado)'`. As partes são
-- os nós de previsto e realizado que já existem na árvore; como só
-- se acrescenta o nó quando previsto > realizado, a soma fecha
-- (previsto + (−realizado) = compromisso). A nota do grupo `taxas`
-- diz que a taxa não é livre.
--
-- Nada mais muda no banco: `resumo_projetos_v2` (063) já soma o
-- `saldo_livre` dos grupos. `simular_alocacao` (039) continua
-- excluindo `cip_ufg`, `cip_ua` e `dao` do pool remanejável.
--
-- Conferência: tests/sql/test_066_taxas_comprometidas.sql
-- Executor:    tools/replica-local/rodar-066-pglite.mjs
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
    'bolsas_ativas',          v_bolsas_det,
    'grupos',                 v_grupos,
    'rubricas',               v_rubricas,
    'avisos',                 to_jsonb(v_avisos),
    'nota',
      'saldo_livre = previsto − realizado − compromissos. Compromissos de BOLSAS são rastreados na janela até o fim da vigência (as bolsas são pagas no dia 07); nas rubricas de TAXA a reter (cip_ufg, cip_ua, dao), compromissos = greatest(previsto − realizado, 0): o que falta cobrar não é livre e cobrança acima do previsto continua abatendo o livre. Onde compromissos_cobertura = ''nenhuma'', saldo_livre é apenas previsto − realizado e não foi verificado contra compromissos assumidos. A janela de compromissos comeca no mes seguinte ao ultimo que o balancete cobre (`balancete_cobre_ate`), porque as bolsas sao pagas no dia 07 e um balancete emitido antes disso nao contem a folha do proprio mes. Remanejamento entre letras exige aprovação do financiador e não está considerado.'
  );
end;
$$;

comment on function public.get_saldo_livre is
  'Saldo realmente livre por grupo de rubrica até o fim da vigência. Compromissos de bolsas na janela do dia 07 (048) e taxas a reter (CIP/DAO) sempre comprometidas como greatest(previsto − realizado, 0) (066). Guard: assert_project_allowed.';

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

        if v_r_comp <> 0 or jsonb_array_length(v_comp_folhas) > 0 then
          v_g_partes := v_g_partes || jsonb_build_array(jsonb_build_object(
            'rotulo', 'Comprometido — ' || v_r_name, 'valor', v_r_comp, 'tipo', 'calculo',
            'chave', 'rubrica:' || v_r_code || ':comprometido', 'conta', 'soma das bolsas na janela',
            'sinal', -1, 'ref', null, 'nota', null, 'partes', v_comp_folhas
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
  'Monta a árvore do saldo livre por centro a partir de get_saldo_livre, resolvendo a origem das folhas em lote e mascarando CPF para não-admin/agente (migs. 064/065/066).';

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
      raise exception '066: % sem security definer ou search_path exato', v_sig;
    end if;

    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '066: authenticated perdeu EXECUTE em %', v_sig;
    end if;

    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (
         select 1 from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '066: anon/PUBLIC possui EXECUTE em %', v_sig;
    end if;
  end loop;

  if position('cip_ufg' in pg_get_functiondef('public.get_saldo_livre(uuid)'::regprocedure)) = 0
     or position('cip_ua' in pg_get_functiondef('public.get_saldo_livre(uuid)'::regprocedure)) = 0
     or position('dao' in pg_get_functiondef('public.get_saldo_livre(uuid)'::regprocedure)) = 0 then
    raise exception '066: get_saldo_livre não contém as três rubricas de taxa na constante.';
  end if;

  if position('taxa a reter (previsto − realizado)' in pg_get_functiondef('public.explicar_livre_v2(uuid)'::regprocedure)) = 0 then
    raise exception '066: explicar_livre_v2 não contém a conta da taxa a reter.';
  end if;
end
$asserts$;

commit;
