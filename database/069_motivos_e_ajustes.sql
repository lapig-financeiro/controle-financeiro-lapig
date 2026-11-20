-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 069
-- F3-C: motivo dos selos, tarifa bancária e ajustes da revisão da 068
-- ============================================================
-- Pedido do Victor em 20/11/2026:
--   1. O selo "problema"/"atenção" precisa dizer o motivo (passar o
--      mouse ou focar e ver o porquê).
--   2. Tarifa bancária (R$ 14,34 na conta 7.1.3.05.01.00054) é
--      cobrança comum da FUNAPE, não gasto fora do plano: quando o
--      negativo de um grupo é explicado só por tarifa, ele vira
--      "atenção" com o motivo escrito, e não "problema". Se o
--      negativo passar da tarifa, continua "problema" e o texto diz
--      as duas coisas.
--   3. Fechar os achados da revisão final da 068: colocar só quem
--      está na lista do pedido, travar apenas a caixa do próprio
--      dono, mesma ordem na origem e em saiu_de, lock ao apagar e a
--      confirmação em dois passos da tela.
--
-- Nada muda em get_saldo_livre, explicar_livre_v2, calc_project_monthly
-- nem nos helpers protegidos. Esta migração não insere nem altera
-- dados: só cria/recria funções.
--
-- Conferência: tests/sql/test_069_motivos_e_ajustes.sql
-- Executor:    tools/replica-local/rodar-069-pglite.mjs
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Situação do centro com motivos
-- ------------------------------------------------------------
-- Helper interno: recebe o retorno de get_saldo_livre já calculado e
-- devolve { situacao, motivos }. A regra é a da 063, com a exceção da
-- tarifa bancária: um grupo negativo coberto por linhas de tarifa do
-- balancete usado por get_saldo_livre fica em "atenção".
create or replace function public._situacao_centro(
  p_project_id   uuid,
  p_sl           jsonb,
  p_pend_abertas integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_plano     boolean;
  v_has_balancete boolean;
  v_data_ref      date;
  v_cobre         date;
  v_defasagem     integer;
  v_balancete_id  uuid;
  v_grupos        jsonb;
  v_g             jsonb;
  v_g_code        text;
  v_g_name        text;
  v_livre         numeric;
  v_abs           numeric;
  v_tarifa        numeric;
  v_tem_negativo  boolean := false;
  v_tem_tarifa    boolean := false;
  v_situacao      text;
  v_problemas     jsonb := '[]'::jsonb;
  v_atencoes      jsonb := '[]'::jsonb;
  v_motivos       jsonb := '[]'::jsonb;
  v_titulos       text[];
  v_qtd           integer;
  v_mes           text;
begin
  -- Caminho do exception dos chamadores: a situação vira "sem dado" e
  -- o motivo diz o que aconteceu, sem inventar número.
  if p_sl is null or jsonb_typeof(p_sl) <> 'object' then
    return jsonb_build_object(
      'situacao', 'sem dado',
      'motivos', jsonb_build_array(jsonb_build_object(
        'codigo',     'falha',
        'nivel',      'info',
        'texto',      'Não foi possível calcular o saldo deste centro.',
        'grupo_code', null,
        'valor',      null
      ))
    );
  end if;

  v_has_plano     := coalesce((p_sl ->> 'has_plano')::boolean, false);
  v_has_balancete := coalesce((p_sl ->> 'has_balancete')::boolean, false);
  v_data_ref      := nullif(p_sl ->> 'data_referencia', '')::date;
  v_cobre         := nullif(p_sl ->> 'balancete_cobre_ate', '')::date;
  v_defasagem     := nullif(p_sl ->> 'balancete_defasagem_meses', '')::integer;
  v_grupos        := case
                       when jsonb_typeof(p_sl -> 'grupos') = 'array'
                         then p_sl -> 'grupos'
                       else '[]'::jsonb
                     end;

  if not v_has_plano then
    return jsonb_build_object(
      'situacao', 'sem plano',
      'motivos', jsonb_build_array(jsonb_build_object(
        'codigo',     'sem_plano',
        'nivel',      'info',
        'texto',      'Este centro não tem plano de trabalho ativo: falta o previsto por rubrica.',
        'grupo_code', null,
        'valor',      null
      ))
    );
  end if;

  if not v_has_balancete then
    return jsonb_build_object(
      'situacao', 'sem balancete',
      'motivos', jsonb_build_array(jsonb_build_object(
        'codigo',     'sem_balancete',
        'nivel',      'info',
        'texto',      'Este centro não tem balancete importado: falta o realizado por rubrica.',
        'grupo_code', null,
        'valor',      null
      ))
    );
  end if;

  -- Mesma escolha de get_saldo_livre: o balancete mais recente do centro.
  select b.id
    into v_balancete_id
    from public.balancetes b
   where b.project_id = p_project_id
   order by b.data_referencia desc
   limit 1;

  for v_g in select value from jsonb_array_elements(v_grupos) loop
    v_livre := (v_g ->> 'saldo_livre')::numeric;

    if v_livre is null or v_livre >= 0 then
      continue;
    end if;

    v_g_code := v_g ->> 'grupo_code';
    v_g_name := coalesce(nullif(v_g ->> 'grupo_name', ''), v_g_code);
    v_abs    := abs(v_livre);
    v_tarifa := 0;

    -- Rubrica da linha (balancete_lancamentos.rubrica_code) e grupo da
    -- rubrica (coalesce(parent_code, code)), como a 066. Tarifa é a
    -- conta fixa ou a descrição sem acento, em maiúsculas.
    select coalesce(sum(bl.saldo_atual), 0)
      into v_tarifa
      from public.balancete_lancamentos bl
      join public.rubricas r on r.code = bl.rubrica_code
     where bl.balancete_id = v_balancete_id
       and coalesce(r.parent_code, r.code) = v_g_code
       and (
         bl.conta_codigo = '7.1.3.05.01.00054'
         or upper(translate(coalesce(bl.conta_descricao, ''),
              'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
              'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
            like '%SERVICOS BANCARIOS%'
         or upper(translate(coalesce(bl.conta_descricao, ''),
              'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
              'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
            like '%TARIFA BANCARIA%'
       );

    if v_abs <= v_tarifa then
      -- O negativo cabe inteiro na tarifa: atenção, com o valor escrito.
      v_tem_tarifa := true;
      v_atencoes := v_atencoes || jsonb_build_array(jsonb_build_object(
        'codigo',     'tarifa_bancaria',
        'nivel',      'atenção',
        'texto',      format(
          'Rubrica %s — %s: R$ %s de tarifa bancária sem previsão no plano. É cobrança comum da FUNAPE; vale prever no próximo remanejamento.',
          v_g_code, v_g_name, public._fmt_brl_num(v_tarifa)
        ),
        'grupo_code', v_g_code,
        'valor',      v_tarifa
      ));
    else
      -- O negativo passa da tarifa: continua problema; o texto diz as
      -- duas coisas quando há tarifa no grupo.
      v_tem_negativo := true;
      v_problemas := v_problemas || jsonb_build_array(jsonb_build_object(
        'codigo',     'saldo_negativo',
        'nivel',      'problema',
        'texto',      format(
          'Rubrica %s — %s: gasto R$ %s acima do previsto.%s',
          v_g_code, v_g_name, public._fmt_brl_num(v_abs),
          case
            when v_tarifa > 0
              then format(' R$ %s disso é tarifa bancária sem previsão no plano.',
                          public._fmt_brl_num(v_tarifa))
            else ''
          end
        ),
        'grupo_code', v_g_code,
        'valor',      v_abs
      ));
    end if;
  end loop;

  if v_defasagem is not null and v_defasagem >= 2 then
    v_mes := to_char(coalesce(v_cobre, v_data_ref), 'MM/YYYY');
    v_atencoes := v_atencoes || jsonb_build_array(jsonb_build_object(
      'codigo',     'balancete_atrasado',
      'nivel',      'atenção',
      'texto',      format('O último balancete cobre até %s (%s meses atrás).', v_mes, v_defasagem),
      'grupo_code', null,
      'valor',      null
    ));
  end if;

  if coalesce(p_pend_abertas, 0) > 0 then
    -- Até 3 títulos, os mais antigos primeiro; o resto vira "e mais K".
    select coalesce(array_agg(t.titulo order by t.criada_em, t.id), '{}')
      into v_titulos
      from (
        select pe.titulo, pe.criada_em, pe.id
          from public.pendencias pe
         where pe.project_id = p_project_id
           and pe.situacao = 'aberta'
         order by pe.criada_em, pe.id
         limit 3
      ) t;

    v_qtd := coalesce(p_pend_abertas, 0);
    v_atencoes := v_atencoes || jsonb_build_array(jsonb_build_object(
      'codigo',     'pendencias_abertas',
      'nivel',      'atenção',
      'texto',      format(
        '%s %s: %s%s',
        v_qtd,
        case when v_qtd = 1 then 'pendência aberta' else 'pendências abertas' end,
        array_to_string(v_titulos, '; '),
        case when v_qtd > 3 then format(' e mais %s', v_qtd - 3) else '' end
      ),
      'grupo_code', null,
      'valor',      null
    ));
  end if;

  if v_tem_negativo then
    v_situacao := 'problema';
  elsif v_tem_tarifa
     or (v_defasagem is not null and v_defasagem >= 2)
     or coalesce(p_pend_abertas, 0) > 0 then
    v_situacao := 'atenção';
  else
    v_situacao := 'em dia';
    v_motivos := jsonb_build_array(jsonb_build_object(
      'codigo',     'em_dia',
      'nivel',      'info',
      'texto',      format(
        'Balancete até %s, nenhuma rubrica acima do previsto e nenhuma pendência aberta.',
        to_char(coalesce(v_cobre, v_data_ref), 'MM/YYYY')
      ),
      'grupo_code', null,
      'valor',      null
    ));
  end if;

  if v_situacao <> 'em dia' then
    v_motivos := v_problemas || v_atencoes;
  end if;

  return jsonb_build_object('situacao', v_situacao, 'motivos', v_motivos);
end;
$$;

comment on function public._situacao_centro(uuid, jsonb, integer) is
  'Situação e motivos de um centro a partir do get_saldo_livre já calculado; grupo negativo coberto por tarifa bancária vira atenção (mig. 069).';

revoke all on function public._situacao_centro(uuid, jsonb, integer)
  from public, anon, authenticated;

-- resumo_projetos_v2: mesmas chaves e valores de hoje, mais `motivos`.
-- A situação de cada centro sai do helper, não de uma regra paralela.
create or replace function public.resumo_projetos_v2()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_admin      boolean := public.is_admin();
  v_visiveis      uuid[];
  v_resp_map      jsonb := '{}'::jsonb;
  v_pend_map      jsonb := '{}'::jsonb;
  v_centros       jsonb := '[]'::jsonb;
  v_todos         jsonb := '[]'::jsonb;
  v_ocultos       integer := 0;
  v_proj          record;
  v_sl            jsonb;
  v_sit           jsonb;
  v_erro          text;
  v_has_plano     boolean;
  v_has_balancete boolean;
  v_data_ref      date;
  v_defasagem     integer;
  v_livre         numeric;
  v_pend_abertas  integer;
  v_situacao      text;
  v_motivos       jsonb := '[]'::jsonb;
begin
  select coalesce(array_agg(cv), '{}'::uuid[])
    into v_visiveis
    from public.centros_visiveis() as cv;

  if v_is_admin then
    select coalesce(jsonb_object_agg(x.project_id::text, x.nomes), '{}'::jsonb)
      into v_resp_map
      from (
        select up.project_id,
               jsonb_agg(
                 btrim(au.display_name)
                 order by lower(btrim(au.display_name)), btrim(au.display_name)
               ) as nomes
          from public.user_projects up
          join public.app_users au on au.user_id = up.user_id
          join public.projects p on p.id = up.project_id
         where p.active = true
           and au.role = 'professor'
           and nullif(btrim(au.display_name), '') is not null
         group by up.project_id
      ) x;
  end if;

  select coalesce(jsonb_object_agg(x.project_id::text, x.total), '{}'::jsonb)
    into v_pend_map
    from (
      select pe.project_id, count(*)::integer as total
        from public.pendencias pe
       where pe.situacao = 'aberta'
         and pe.project_id = any(v_visiveis)
       group by pe.project_id
    ) x;

  for v_proj in
    select p.id, p.code, p.name, p.end_date, p.drive_folder_url
      from public.projects p
     where p.id = any(v_visiveis)
     order by lower(p.name), p.name, p.code nulls last, p.id
  loop
    v_sl           := null;
    v_sit          := null;
    v_erro         := null;
    v_livre        := null;
    v_data_ref     := null;
    v_defasagem    := null;
    v_situacao     := 'sem dado';
    v_motivos      := '[]'::jsonb;
    v_pend_abertas := coalesce((v_pend_map ->> v_proj.id::text)::integer, 0);

    begin
      v_sl := public.get_saldo_livre(v_proj.id);

      if v_sl is null or jsonb_typeof(v_sl) <> 'object' then
        raise exception 'Retorno inválido de get_saldo_livre';
      end if;

      v_has_plano     := coalesce((v_sl ->> 'has_plano')::boolean, false);
      v_has_balancete := coalesce((v_sl ->> 'has_balancete')::boolean, false);
      v_data_ref      := nullif(v_sl ->> 'data_referencia', '')::date;
      v_defasagem     := nullif(v_sl ->> 'balancete_defasagem_meses', '')::integer;

      if v_has_plano and v_has_balancete and jsonb_typeof(v_sl -> 'grupos') = 'array' then
        select sum((g ->> 'saldo_livre')::numeric)
          into v_livre
          from jsonb_array_elements(v_sl -> 'grupos') as g
         where g ->> 'saldo_livre' is not null;
      end if;

      if not v_has_plano then
        v_livre := null;
      elsif not v_has_balancete then
        v_livre := null;
      end if;

      v_sit      := public._situacao_centro(v_proj.id, v_sl, v_pend_abertas);
      v_situacao := coalesce(v_sit ->> 'situacao', 'sem dado');
      v_motivos  := coalesce(v_sit -> 'motivos', '[]'::jsonb);
    exception when others then
      v_erro     := 'falha_saldo_livre';
      v_situacao := 'sem dado';
      v_livre    := null;
      v_data_ref := null;
      v_motivos  := public._situacao_centro(v_proj.id, null, 0) -> 'motivos';
      raise warning 'resumo_projetos_v2: falha ao calcular centro % [%]: %',
        v_proj.id, sqlstate, sqlerrm;
    end;

    v_centros := v_centros || jsonb_build_array(
      jsonb_build_object(
        'id',                 v_proj.id,
        'code',               v_proj.code,
        'name',               v_proj.name,
        'end_date',           v_proj.end_date,
        'drive_folder_url',   case when v_is_admin then v_proj.drive_folder_url else null end,
        'livre',              v_livre,
        'situacao',           v_situacao,
        'data_referencia',    v_data_ref,
        'pendencias_abertas', v_pend_abertas,
        'erro',               v_erro,
        'responsaveis',       case when v_is_admin
                                then coalesce(v_resp_map -> v_proj.id::text, '[]'::jsonb)
                                else '[]'::jsonb
                              end,
        'motivos',            v_motivos
      )
    );
  end loop;

  if v_is_admin then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'id',           p.id,
                 'code',         p.code,
                 'name',         p.name,
                 'responsaveis', coalesce(v_resp_map -> p.id::text, '[]'::jsonb),
                 'oculto',       not (p.id = any(v_visiveis))
               )
               order by lower(p.name), p.name, p.code nulls last, p.id
             ),
             '[]'::jsonb
           ),
           count(*) filter (where not (p.id = any(v_visiveis)))::integer
      into v_todos, v_ocultos
      from public.projects p
     where p.active = true;
  end if;

  return jsonb_build_object(
    'centros', v_centros,
    'ocultos', coalesce(v_ocultos, 0),
    'todos',   coalesce(v_todos, '[]'::jsonb)
  );
end;
$$;

comment on function public.resumo_projetos_v2() is
  'Lista dos centros ativos visíveis com saldo livre, situação, motivos, pendências abertas e responsáveis (migs. 063/069).';

revoke all on function public.resumo_projetos_v2() from public, anon;
grant execute on function public.resumo_projetos_v2() to authenticated;

-- RPC de leitura do selo de um centro. Mesma guarda de leitura da 063
-- (ACL só para authenticated) e a checagem de escopo de get_saldo_livre,
-- com 42501 explícito para centro fora do escopo do professor.
create or replace function public.situacao_centro_v2(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sl   jsonb;
  v_pend integer;
begin
  if p_project_id is null then
    raise exception 'project_id é obrigatório.' using errcode = '22023';
  end if;

  if not public.is_admin()
     and not (p_project_id = any(public.allowed_project_ids())) then
    raise exception 'Acesso negado ao centro.' using errcode = '42501';
  end if;

  perform public.assert_project_allowed(p_project_id);

  begin
    v_sl := public.get_saldo_livre(p_project_id);
  exception when others then
    return public._situacao_centro(p_project_id, null, 0);
  end;

  select count(*)::integer
    into v_pend
    from public.pendencias pe
   where pe.project_id = p_project_id
     and pe.situacao = 'aberta';

  return public._situacao_centro(p_project_id, v_sl, v_pend);
end;
$$;

comment on function public.situacao_centro_v2(uuid) is
  'Situação e motivos de um centro, pela mesma regra de resumo_projetos_v2; professor só lê o próprio escopo (mig. 069).';

revoke all on function public.situacao_centro_v2(uuid) from public, anon;
grant execute on function public.situacao_centro_v2(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. Ajustes da revisão final da 068
-- ------------------------------------------------------------
-- As seis RPCs que fazem select ... for update na caixa passam a
-- filtrar o dono no próprio select: nunca travam a linha de outro
-- dono. A resposta para caixa alheia continua P0002, igual à
-- inexistente.

-- 2.1 salvar_caixa_pedido_v2(p jsonb)
create or replace function public.salvar_caixa_pedido_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chaves      text;
  v_id_txt      text;
  v_id          uuid;
  v_nome        text;
  v_meses_num   numeric;
  v_meses       integer;
  v_caixa       public.caixas_pedido;
  v_count       integer;
  v_dono        uuid := auth.uid();
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() or public.is_automacao(null) then
    raise exception 'O agente e a automação não leem nem gravam o pedido de bolsas.' using errcode = '42501';
  end if;

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Payload deve ser um objeto JSON.' using errcode = '22023';
  end if;

  select string_agg(k, ', ' order by k)
    into v_chaves
    from jsonb_object_keys(p) as k
   where k not in ('id', 'nome', 'meses');

  if v_chaves is not null then
    raise exception 'Campos não permitidos em salvar_caixa_pedido_v2: %', v_chaves
      using errcode = '22023';
  end if;

  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    if jsonb_typeof(p -> 'id') <> 'string' then
      raise exception 'Campo id deve ser UUID.' using errcode = '22023';
    end if;
    v_id_txt := nullif(btrim(p ->> 'id'), '');
    if v_id_txt is null
       or v_id_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Campo id inválido.' using errcode = '22023';
    end if;
    begin
      v_id := v_id_txt::uuid;
    exception when invalid_text_representation then
      raise exception 'Campo id inválido.' using errcode = '22023';
    end;
  end if;

  if jsonb_typeof(p -> 'nome') is distinct from 'string' then
    raise exception 'Campo nome é obrigatório.' using errcode = '22023';
  end if;
  v_nome := nullif(btrim(p ->> 'nome'), '');
  if v_nome is null or char_length(v_nome) > 80 then
    raise exception 'Campo nome deve ter de 1 a 80 caracteres.' using errcode = '22023';
  end if;

  if p ? 'meses' and jsonb_typeof(p -> 'meses') <> 'null' then
    if jsonb_typeof(p -> 'meses') <> 'number' then
      raise exception 'Campo meses deve ser um inteiro.' using errcode = '22023';
    end if;
    v_meses_num := (p ->> 'meses')::numeric;
    if v_meses_num is null
       or v_meses_num = 'NaN'::numeric
       or v_meses_num in ('Infinity'::numeric, '-Infinity'::numeric)
       or v_meses_num <> trunc(v_meses_num)
       or v_meses_num < 1
       or v_meses_num > 60 then
      raise exception 'Campo meses deve ser um inteiro entre 1 e 60.' using errcode = '22023';
    end if;
    v_meses := v_meses_num::integer;
  end if;

  if public._tem_cpf(v_nome) then
    raise exception 'Nome de caixa contém sequência no formato de CPF e não pode ser gravado.'
      using errcode = '22023';
  end if;

  if v_id is null then
    -- Duas abas criando ao mesmo tempo não podem passar do limite de 10.
    perform pg_advisory_xact_lock(hashtextextended('caixas_pedido:' || v_dono::text, 0));

    select count(*) into v_count
      from public.caixas_pedido c
     where c.dono = v_dono;

    if v_count >= 10 then
      raise exception 'Limite de 10 caixas por usuário.' using errcode = '22023';
    end if;

    insert into public.caixas_pedido (nome, meses, dono, criado_em, atualizado_em)
    values (v_nome, coalesce(v_meses, 12), v_dono, now(), now())
    returning * into v_caixa;

    return jsonb_build_object(
      'id',            v_caixa.id,
      'nome',          v_caixa.nome,
      'meses',         v_caixa.meses,
      'criado_em',     v_caixa.criado_em,
      'atualizado_em', v_caixa.atualizado_em
    );
  end if;

  select * into v_caixa
    from public.caixas_pedido c
   where c.id = v_id
     and c.dono = auth.uid()
     for update;

  -- Caixa de outro dono responde igual à inexistente: não serve de oráculo.
  if not found or v_caixa.dono <> v_dono then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;

  update public.caixas_pedido
     set nome          = v_nome,
         meses         = coalesce(v_meses, v_caixa.meses),
         atualizado_em = now()
   where id = v_id
     and dono = v_dono
   returning * into v_caixa;

  return jsonb_build_object(
    'id',            v_caixa.id,
    'nome',          v_caixa.nome,
    'meses',         v_caixa.meses,
    'criado_em',     v_caixa.criado_em,
    'atualizado_em', v_caixa.atualizado_em
  );
end;
$$;

comment on function public.salvar_caixa_pedido_v2(jsonb) is
  'Cria sem id (até 10 caixas por dono) ou altera com id (só o dono, com o dono no próprio for update); aceita apenas id, nome e meses. Recusa CPF no nome (mig. 068/069).';

revoke all on function public.salvar_caixa_pedido_v2(jsonb) from public, anon;
grant execute on function public.salvar_caixa_pedido_v2(jsonb) to authenticated;

-- 2.2 apagar_caixa_pedido_v2(p_id)
create or replace function public.apagar_caixa_pedido_v2(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caixa public.caixas_pedido;
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() or public.is_automacao(null) then
    raise exception 'O agente e a automação não leem nem gravam o pedido de bolsas.' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'Informe a caixa.' using errcode = '22023';
  end if;

  select * into v_caixa
    from public.caixas_pedido c
   where c.id = p_id
     and c.dono = auth.uid()
     for update;

  if not found or v_caixa.dono <> auth.uid() then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;

  -- Mesmo lock por dono das outras operações de caixa.
  perform pg_advisory_xact_lock(hashtextextended('caixas_pedido:' || v_caixa.dono::text, 0));

  delete from public.caixas_pedido where id = p_id and dono = auth.uid();

  return jsonb_build_object('id', p_id, 'apagada', true);
end;
$$;

comment on function public.apagar_caixa_pedido_v2(uuid) is
  'Apaga uma caixa do próprio usuário (itens caem por cascade), com o dono no for update e o lock por dono. Caixa inexistente e de outra pessoa devolvem P0002 (mig. 068/069).';

revoke all on function public.apagar_caixa_pedido_v2(uuid) from public, anon;
grant execute on function public.apagar_caixa_pedido_v2(uuid) to authenticated;

-- 2.3 colocar_na_caixa_v2(p_caixa_id, p_holder_id)
-- Só coloca ou move. Exige a mesma lista do pedido que a tela usa
-- (_bolsista_no_pedido), não só a visibilidade. Se mover, leva valor e
-- nota do item de origem; origem e saiu_de usam a mesma ordem
-- (c.criado_em, c.id).
create or replace function public.colocar_na_caixa_v2(
  p_caixa_id  uuid,
  p_holder_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caixa      public.caixas_pedido;
  v_item       public.caixa_pedido_itens%rowtype;
  v_origem     public.caixa_pedido_itens%rowtype;
  v_saiu       jsonb := '[]'::jsonb;
  v_valor_uso  numeric;
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() or public.is_automacao(null) then
    raise exception 'O agente e a automação não leem nem gravam o pedido de bolsas.' using errcode = '42501';
  end if;

  if p_caixa_id is null or p_holder_id is null then
    raise exception 'Informe a caixa e a pessoa.' using errcode = '22023';
  end if;

  select * into v_caixa
    from public.caixas_pedido c
   where c.id = p_caixa_id
     and c.dono = auth.uid()
     for update;

  -- Caixa de outro dono responde igual à inexistente: não serve de oráculo.
  if not found or v_caixa.dono <> auth.uid() then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;

  if not public._bolsista_visivel(p_holder_id) then
    raise exception 'Pessoa fora do seu escopo.' using errcode = '42501';
  end if;

  if not public._bolsista_no_pedido(p_holder_id) then
    raise exception 'Essa pessoa não está na lista do pedido.' using errcode = '22023';
  end if;

  -- Serializa por dono para duas abas não deixarem a pessoa em duas caixas.
  perform pg_advisory_xact_lock(hashtextextended('caixas_pedido:' || v_caixa.dono::text, 0));

  select * into v_item
    from public.caixa_pedido_itens i
   where i.caixa_id = p_caixa_id
     and i.holder_id = p_holder_id;

  if not found then
    -- Item de origem em outra caixa do mesmo dono (se houver).
    select i.* into v_origem
      from public.caixa_pedido_itens i
      join public.caixas_pedido c on c.id = i.caixa_id
     where c.dono = v_caixa.dono
       and i.holder_id = p_holder_id
     order by c.criado_em, c.id
     limit 1;

    select coalesce(
             jsonb_agg(
               jsonb_build_object('caixa_id', c.id, 'nome', c.nome)
               order by c.criado_em, c.id
             ),
             '[]'::jsonb
           )
      into v_saiu
      from public.caixas_pedido c
     where c.dono = v_caixa.dono
       and c.id <> p_caixa_id
       and exists (
         select 1 from public.caixa_pedido_itens i
          where i.caixa_id = c.id and i.holder_id = p_holder_id
       );

    delete from public.caixa_pedido_itens i
     using public.caixas_pedido c
     where i.caixa_id = c.id
       and c.dono = v_caixa.dono
       and c.id <> p_caixa_id
       and i.holder_id = p_holder_id;

    insert into public.caixa_pedido_itens (caixa_id, holder_id, valor_mensal, nota, criado_em)
    values (p_caixa_id, p_holder_id, v_origem.valor_mensal, v_origem.nota, now());
  end if;

  select * into v_item
    from public.caixa_pedido_itens i
   where i.caixa_id = p_caixa_id
     and i.holder_id = p_holder_id;

  select coalesce(
           v_item.valor_mensal,
           (
             select sum(s.amount)
               from public.scholarships s
              where s.holder_id = p_holder_id
                and s.status in ('active', 'ended')
                and s.start_date <= current_date
                and current_date <= s.end_date
                and (public.is_admin() or s.project_id = any(public.allowed_project_ids()))
           ),
           0
         )
    into v_valor_uso;

  return jsonb_build_object(
    'caixa_id',     p_caixa_id,
    'holder_id',    p_holder_id,
    'valor_mensal', v_item.valor_mensal,
    'valor_usado',  v_valor_uso,
    'nota',         v_item.nota,
    'saiu_de',      v_saiu
  );
end;
$$;

comment on function public.colocar_na_caixa_v2(uuid, uuid) is
  'Coloca uma pessoa da lista do pedido na caixa do próprio usuário; se mover, leva valor e nota do item de origem, com a mesma ordem em origem e saiu_de. Caixa alheia responde P0002 (mig. 068/069).';

revoke all on function public.colocar_na_caixa_v2(uuid, uuid) from public, anon;
grant execute on function public.colocar_na_caixa_v2(uuid, uuid) to authenticated;

-- 2.4 editar_item_caixa_v2(p_caixa_id, p_holder_id, p_valor_mensal, p_nota)
create or replace function public.editar_item_caixa_v2(
  p_caixa_id     uuid,
  p_holder_id    uuid,
  p_valor_mensal numeric default null,
  p_nota         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caixa      public.caixas_pedido;
  v_valor      numeric;
  v_nota       text;
  v_valor_uso  numeric;
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() or public.is_automacao(null) then
    raise exception 'O agente e a automação não leem nem gravam o pedido de bolsas.' using errcode = '42501';
  end if;

  if p_caixa_id is null or p_holder_id is null then
    raise exception 'Informe a caixa e a pessoa.' using errcode = '22023';
  end if;

  select * into v_caixa
    from public.caixas_pedido c
   where c.id = p_caixa_id
     and c.dono = auth.uid()
     for update;

  if not found or v_caixa.dono <> auth.uid() then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;

  perform 1
    from public.caixa_pedido_itens i
   where i.caixa_id = p_caixa_id
     and i.holder_id = p_holder_id
     for update;

  if not found then
    raise exception 'Pessoa não está nesta caixa.' using errcode = 'P0002';
  end if;

  if p_valor_mensal is not null then
    if p_valor_mensal = 'NaN'::numeric
       or p_valor_mensal in ('Infinity'::numeric, '-Infinity'::numeric) then
      raise exception 'Valor mensal deve ser um número positivo e finito.' using errcode = '22023';
    end if;
    -- Arredonda antes de validar: 0,004 vira 0,00 e é 22023, não 23514.
    v_valor := round(p_valor_mensal, 2);
    if v_valor <= 0 or v_valor > 999999999999.99 then
      raise exception 'Valor mensal deve ser um número positivo e finito.' using errcode = '22023';
    end if;
    v_valor := v_valor::numeric(14,2);
  end if;

  if p_nota is not null then
    v_nota := nullif(btrim(p_nota), '');
    if v_nota is not null and char_length(v_nota) > 300 then
      raise exception 'Nota deve ter até 300 caracteres.' using errcode = '22023';
    end if;
    if v_nota is not null and public._tem_cpf(v_nota) then
      raise exception 'Nota contém sequência no formato de CPF e não pode ser gravada.'
        using errcode = '22023';
    end if;
  end if;

  update public.caixa_pedido_itens
     set valor_mensal = v_valor,
         nota         = v_nota
   where caixa_id = p_caixa_id
     and holder_id = p_holder_id;

  select coalesce(
           v_valor,
           (
             select sum(s.amount)
               from public.scholarships s
              where s.holder_id = p_holder_id
                and s.status in ('active', 'ended')
                and s.start_date <= current_date
                and current_date <= s.end_date
                and (public.is_admin() or s.project_id = any(public.allowed_project_ids()))
           ),
           0
         )
    into v_valor_uso;

  return jsonb_build_object(
    'caixa_id',     p_caixa_id,
    'holder_id',    p_holder_id,
    'valor_mensal', v_valor,
    'valor_usado',  v_valor_uso,
    'nota',         v_nota
  );
end;
$$;

comment on function public.editar_item_caixa_v2(uuid, uuid, numeric, text) is
  'Grava valor e nota exatamente como vieram (null limpa) num item que já existe na caixa do próprio usuário, com o dono no for update; caixa alheia e item ausente respondem P0002 (mig. 068/069).';

revoke all on function public.editar_item_caixa_v2(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.editar_item_caixa_v2(uuid, uuid, numeric, text) to authenticated;

-- 2.5 tirar_da_caixa_v2(p_caixa_id, p_holder_id)
create or replace function public.tirar_da_caixa_v2(p_caixa_id uuid, p_holder_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caixa public.caixas_pedido;
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() or public.is_automacao(null) then
    raise exception 'O agente e a automação não leem nem gravam o pedido de bolsas.' using errcode = '42501';
  end if;

  if p_caixa_id is null or p_holder_id is null then
    raise exception 'Informe a caixa e a pessoa.' using errcode = '22023';
  end if;

  select * into v_caixa
    from public.caixas_pedido c
   where c.id = p_caixa_id
     and c.dono = auth.uid()
     for update;

  if not found or v_caixa.dono <> auth.uid() then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;

  delete from public.caixa_pedido_itens i
   where i.caixa_id = p_caixa_id
     and i.holder_id = p_holder_id;

  if not found then
    raise exception 'Pessoa não está nesta caixa.' using errcode = 'P0002';
  end if;

  return jsonb_build_object('caixa_id', p_caixa_id, 'holder_id', p_holder_id, 'removido', true);
end;
$$;

comment on function public.tirar_da_caixa_v2(uuid, uuid) is
  'Tira uma pessoa da caixa do próprio usuário, com o dono no for update. Item inexistente e caixa de outra pessoa devolvem P0002 (mig. 068/069).';

revoke all on function public.tirar_da_caixa_v2(uuid, uuid) from public, anon;
grant execute on function public.tirar_da_caixa_v2(uuid, uuid) to authenticated;

-- 2.6 limpar_ocultos_da_caixa_v2(p_caixa_id)
create or replace function public.limpar_ocultos_da_caixa_v2(p_caixa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caixa     public.caixas_pedido;
  v_removidos integer := 0;
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() or public.is_automacao(null) then
    raise exception 'O agente e a automação não leem nem gravam o pedido de bolsas.' using errcode = '42501';
  end if;

  if p_caixa_id is null then
    raise exception 'Informe a caixa.' using errcode = '22023';
  end if;

  select * into v_caixa
    from public.caixas_pedido c
   where c.id = p_caixa_id
     and c.dono = auth.uid()
     for update;

  if not found or v_caixa.dono <> auth.uid() then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('caixas_pedido:' || v_caixa.dono::text, 0));

  delete from public.caixa_pedido_itens i
   where i.caixa_id = p_caixa_id
     and not public._bolsista_no_pedido(i.holder_id);

  get diagnostics v_removidos = row_count;

  return jsonb_build_object('caixa_id', p_caixa_id, 'removidos', v_removidos);
end;
$$;

comment on function public.limpar_ocultos_da_caixa_v2(uuid) is
  'Apaga os itens de pessoas que deixaram de aparecer na lista do pedido, só na caixa do próprio usuário, com o dono no for update; devolve quantos removeu (mig. 068/069).';

revoke all on function public.limpar_ocultos_da_caixa_v2(uuid) from public, anon;
grant execute on function public.limpar_ocultos_da_caixa_v2(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Asserções dentro da transação
-- ------------------------------------------------------------
do $asserts$
declare
  v_sig text;
  v_fn  oid;
  v_def text;
begin
  -- Atributos e ACL das funções tocadas.
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

    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '069: % sem security definer ou search_path exato', v_sig;
    end if;
  end loop;

  -- O helper não é executável por ninguém; as duas RPCs de leitura só
  -- para authenticated.
  if has_function_privilege('anon', 'public._situacao_centro(uuid, jsonb, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._situacao_centro(uuid, jsonb, integer)', 'EXECUTE')
     or exists (
       select 1
         from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = 'public._situacao_centro(uuid, jsonb, integer)'::regprocedure
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
     ) then
    raise exception '069: helper _situacao_centro com EXECUTE para anon/authenticated/PUBLIC';
  end if;

  foreach v_sig in array array[
    'public.resumo_projetos_v2()',
    'public.situacao_centro_v2(uuid)'
  ] loop
    v_fn := v_sig::regprocedure;

    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '069: authenticated perdeu EXECUTE em %', v_sig;
    end if;

    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (
         select 1
           from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn
            and a.grantee = 0
            and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '069: ACL incorreta em %', v_sig;
    end if;
  end loop;

  -- resumo usa o helper; colocar usa a mesma lista do pedido.
  if position('_situacao_centro' in pg_get_functiondef('public.resumo_projetos_v2()'::regprocedure)) = 0 then
    raise exception '069: resumo_projetos_v2 não usa _situacao_centro';
  end if;
  if position('_bolsista_no_pedido' in pg_get_functiondef('public.colocar_na_caixa_v2(uuid, uuid)'::regprocedure)) = 0 then
    raise exception '069: colocar_na_caixa_v2 não exige _bolsista_no_pedido';
  end if;

  -- As seis RPCs de caixa filtram o dono no próprio for update.
  foreach v_sig in array array[
    'public.salvar_caixa_pedido_v2(jsonb)',
    'public.apagar_caixa_pedido_v2(uuid)',
    'public.colocar_na_caixa_v2(uuid, uuid)',
    'public.editar_item_caixa_v2(uuid, uuid, numeric, text)',
    'public.tirar_da_caixa_v2(uuid, uuid)',
    'public.limpar_ocultos_da_caixa_v2(uuid)'
  ] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    if v_def !~* 'dono\s*=\s*auth\.uid\(\)\s+for update' then
      raise exception '069: % sem dono = auth.uid() na caixa em for update', v_sig;
    end if;
  end loop;

  if pg_get_functiondef('public.apagar_caixa_pedido_v2(uuid)'::regprocedure)
       not like '%pg_advisory_xact_lock%' then
    raise exception '069: apagar_caixa_pedido_v2 sem pg_advisory_xact_lock';
  end if;
end
$asserts$;

commit;
