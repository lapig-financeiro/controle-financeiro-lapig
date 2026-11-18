-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 063
-- F1-A: Banco da Fase 1 do redesenho
-- ============================================================
-- Cria de forma aditiva e idempotente a camada de banco usada
-- pelo site novo (/v2/) na Fase 1, mantendo o site atual e as
-- funções anteriores intactos até o corte:
--   1. `pendencias` (lista única: por projeto + sino global).
--   2. `filtro_visao` (apresentação do admin, nunca permissão).
--   3. `centros_visiveis()` (ponto único de filtro, só ativos).
--   4. `v_balancete_vigente` (view invoker para a F2 evoluir).
--   5. 7 RPCs `_v2` (resumo, pendências, filtro e repasses).
--
-- Regras importantes (conferidas contra 033/038/048/051/052):
--   • `allowed_project_ids()` é vazio para admin (033); todo
--     critério usa `is_admin() or ...`.
--   • Filtro de visão é exclusivo do admin; nunca autoriza nem
--     nega ações e nunca oculta pendência sem centro.
--   • CPF em `pendencias` é barrado em `criar_pendencia_v2`
--     e no gatilho `trg_pendencias_sem_cpf` (definer), nunca por
--     CHECK (052 revogou `contem_cpf`).
--   • `get_saldo_livre` segue lendo `balancetes` direto na F1.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Tabela `public.pendencias`
-- ------------------------------------------------------------
create table if not exists public.pendencias (
  id            uuid primary key default gen_random_uuid(),
  chave         text not null,
  project_id    uuid,
  tipo          text not null,
  titulo        text not null,
  detalhe       jsonb not null default '{}'::jsonb,
  situacao      text not null default 'aberta',
  origem        text not null default 'sistema',
  criada_em     timestamptz not null default now(),
  resolvida_em  timestamptz,
  resolvida_por uuid
);

alter table public.pendencias add column if not exists id            uuid default gen_random_uuid();
alter table public.pendencias add column if not exists chave         text;
alter table public.pendencias add column if not exists project_id    uuid;
alter table public.pendencias add column if not exists tipo          text;
alter table public.pendencias add column if not exists titulo        text;
alter table public.pendencias add column if not exists detalhe       jsonb default '{}'::jsonb;
alter table public.pendencias add column if not exists situacao      text default 'aberta';
alter table public.pendencias add column if not exists origem        text default 'sistema';
alter table public.pendencias add column if not exists criada_em     timestamptz default now();
alter table public.pendencias add column if not exists resolvida_em  timestamptz;
alter table public.pendencias add column if not exists resolvida_por uuid;

alter table public.pendencias drop constraint if exists pendencias_chave_unique;
alter table public.pendencias
  add constraint pendencias_chave_unique unique (chave);

alter table public.pendencias drop constraint if exists pendencias_project_id_fkey;
alter table public.pendencias
  add constraint pendencias_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete restrict;

alter table public.pendencias drop constraint if exists pendencias_resolvida_por_fkey;
alter table public.pendencias
  add constraint pendencias_resolvida_por_fkey
  foreign key (resolvida_por) references auth.users(id) on delete set null;

alter table public.pendencias drop constraint if exists pendencias_tipo_check;
alter table public.pendencias
  add constraint pendencias_tipo_check
  check (tipo in ('balancete', 'plano', 'bolsas', 'contrato', 'cadastro', 'outro'));

alter table public.pendencias drop constraint if exists pendencias_situacao_check;
alter table public.pendencias
  add constraint pendencias_situacao_check
  check (situacao in ('aberta', 'resolvida', 'descartada'));

alter table public.pendencias drop constraint if exists pendencias_origem_check;
alter table public.pendencias
  add constraint pendencias_origem_check
  check (origem in ('sistema', 'buriti', 'claude', 'pessoa'));

alter table public.pendencias drop constraint if exists pendencias_chave_nao_vazia;
alter table public.pendencias
  add constraint pendencias_chave_nao_vazia
  check (btrim(chave) <> '');

alter table public.pendencias drop constraint if exists pendencias_titulo_nao_vazio;
alter table public.pendencias
  add constraint pendencias_titulo_nao_vazio
  check (btrim(titulo) <> '');

alter table public.pendencias drop constraint if exists pendencias_detalhe_objeto_check;
alter table public.pendencias
  add constraint pendencias_detalhe_objeto_check
  check (jsonb_typeof(detalhe) = 'object');

create or replace function public._pendencias_sem_cpf()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.contem_cpf(
    coalesce(new.chave, '') || ' ' || coalesce(new.titulo, '') || ' ' || coalesce(new.detalhe::text, '')
  ) then
    raise exception 'Pendência com CPF não pode ser gravada.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public._pendencias_sem_cpf() from public, anon, authenticated;

drop trigger if exists trg_pendencias_sem_cpf on public.pendencias;
create trigger trg_pendencias_sem_cpf
  before insert or update on public.pendencias
  for each row execute function public._pendencias_sem_cpf();

comment on table public.pendencias is
  'Lista única de pendências do sistema (por centro de custo ou gerais). Escrita exclusiva pelas RPCs v2 (mig. 063).';

comment on column public.pendencias.chave is
  'Chave estável de idempotência. Sempre começa por <tipo>:<code do centro|geral>: e inclui o período quando a pendência é recorrente (ex.: bolsas:30.113:dois-planos:<hash>:2026).';

create index if not exists idx_pendencias_project_abertas
  on public.pendencias (project_id)
  where situacao = 'aberta';

alter table public.pendencias enable row level security;
revoke all on public.pendencias from public, anon, authenticated;
grant select on public.pendencias to authenticated;

drop policy if exists pendencias_select_escopo on public.pendencias;
create policy pendencias_select_escopo on public.pendencias
  for select to authenticated
  using (
    public.is_admin()
    or (project_id is not null and project_id = any(public.allowed_project_ids()))
  );

drop trigger if exists trg_bloqueia_agente on public.pendencias;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.pendencias
  for each statement execute function public.bloqueia_escrita_do_agente();

-- ------------------------------------------------------------
-- 2. Tabela `public.filtro_visao`
-- ------------------------------------------------------------
create table if not exists public.filtro_visao (
  user_id         uuid primary key,
  centros_ocultos uuid[] not null default '{}'::uuid[],
  atualizado_em   timestamptz not null default now()
);

alter table public.filtro_visao add column if not exists user_id         uuid;
alter table public.filtro_visao add column if not exists centros_ocultos uuid[] default '{}'::uuid[];
alter table public.filtro_visao add column if not exists atualizado_em   timestamptz default now();

alter table public.filtro_visao drop constraint if exists filtro_visao_user_id_fkey;
alter table public.filtro_visao
  add constraint filtro_visao_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

comment on table public.filtro_visao is
  'Preferência de centros ocultos na própria visão do admin no site novo (/v2/). Apresentação apenas, nunca permissão; o site antigo não lê esta tabela (mig. 063).';

alter table public.filtro_visao enable row level security;
revoke all on public.filtro_visao from public, anon, authenticated;
grant select, insert, update, delete on public.filtro_visao to authenticated;

drop policy if exists filtro_visao_proprio_admin on public.filtro_visao;
create policy filtro_visao_proprio_admin on public.filtro_visao
  for all to authenticated
  using (user_id = auth.uid() and public.is_admin())
  with check (user_id = auth.uid() and public.is_admin());

drop trigger if exists trg_bloqueia_agente on public.filtro_visao;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.filtro_visao
  for each statement execute function public.bloqueia_escrita_do_agente();

-- ------------------------------------------------------------
-- 3. Função `public.centros_visiveis()`
-- ------------------------------------------------------------
create or replace function public.centros_visiveis()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
    from public.projects p
   where p.active = true
     and (
       (
         public.is_admin()
         and not exists (
           select 1
             from public.filtro_visao fv
            where fv.user_id = auth.uid()
              and p.id = any(fv.centros_ocultos)
         )
       )
       or (
         not public.is_admin()
         and p.id = any(public.allowed_project_ids())
       )
     );
$$;

comment on function public.centros_visiveis() is
  'Ponto único de universo + filtro de visão: retorna ids de centros ativos que o usuário pode ver, subtraindo filtro_visao apenas quando é admin (mig. 063).';

revoke all on function public.centros_visiveis() from public, anon;
grant execute on function public.centros_visiveis() to authenticated;

-- ------------------------------------------------------------
-- 4. View `public.v_balancete_vigente`
-- ------------------------------------------------------------
create or replace view public.v_balancete_vigente
with (security_invoker = true) as
  select distinct on (b.project_id)
    b.project_id,
    b.id as balancete_id,
    b.data_referencia,
    b.saldo_disponivel,
    b.rendimento_liquido
  from public.balancetes b
  where b.data_referencia is not null
  order by b.project_id, b.data_referencia desc;

comment on view public.v_balancete_vigente is
  'Balancete mais recente de cada centro de custo (security_invoker = true protege leituras diretas da view). Separada para a F2 versionar balancetes sem alterar os leitores; em RPCs definer, a guarda real de escopo é assert_project_allowed (mig. 063).';

revoke all on public.v_balancete_vigente from public, anon, authenticated;
grant select on public.v_balancete_vigente to authenticated;

-- ------------------------------------------------------------
-- 5. RPCs v2
-- ------------------------------------------------------------

-- 5.1 resumo_projetos_v2()
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
  v_erro          text;
  v_has_plano     boolean;
  v_has_balancete boolean;
  v_data_ref      date;
  v_defasagem     integer;
  v_livre         numeric;
  v_tem_negativo  boolean;
  v_pend_abertas  integer;
  v_situacao      text;
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
    v_erro         := null;
    v_livre        := null;
    v_data_ref     := null;
    v_defasagem    := null;
    v_tem_negativo := false;
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
        select sum((g ->> 'saldo_livre')::numeric),
               coalesce(bool_or((g ->> 'saldo_livre')::numeric < 0), false)
          into v_livre, v_tem_negativo
          from jsonb_array_elements(v_sl -> 'grupos') as g
         where g ->> 'saldo_livre' is not null;
      end if;

      if not v_has_plano then
        v_situacao := 'sem plano';
        v_livre    := null;
      elsif not v_has_balancete then
        v_situacao := 'sem balancete';
        v_livre    := null;
      elsif v_tem_negativo then
        v_situacao := 'problema';
      elsif coalesce(v_defasagem, 0) >= 2 or v_pend_abertas > 0 then
        v_situacao := 'atenção';
      else
        v_situacao := 'em dia';
      end if;
    exception when others then
      v_erro     := 'falha_saldo_livre';
      v_situacao := 'sem dado';
      v_livre    := null;
      v_data_ref := null;
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
                              end
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
  'Lista dos centros ativos visíveis com saldo livre, situação, pendências abertas e responsáveis (mig. 063).';

revoke all on function public.resumo_projetos_v2() from public, anon;
grant execute on function public.resumo_projetos_v2() to authenticated;

-- 5.2 listar_pendencias_v2(p_project_id uuid default null)
create or replace function public.listar_pendencias_v2(p_project_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_project_id is not null then
    perform public.assert_project_allowed(p_project_id);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',         pe.id,
        'project_id', pe.project_id,
        'code',       p.code,
        'tipo',       pe.tipo,
        'titulo',     pe.titulo,
        'detalhe',    pe.detalhe,
        'situacao',   pe.situacao,
        'origem',     pe.origem,
        'criada_em',  pe.criada_em
      )
      order by
        case when pe.situacao = 'aberta' then 0 else 1 end,
        case when pe.situacao = 'aberta' then pe.criada_em else coalesce(pe.resolvida_em, pe.criada_em) end desc,
        pe.criada_em desc,
        pe.id
    ),
    '[]'::jsonb
  )
    into v_result
    from public.pendencias pe
    left join public.projects p on p.id = pe.project_id
   where (
           (p_project_id is not null and pe.project_id = p_project_id)
           or (
             p_project_id is null
             and (
               pe.project_id in (select public.centros_visiveis())
               or (
                 public.is_admin()
                 and (
                   pe.project_id is null
                   or (pe.situacao = 'aberta' and p.active = false)
                 )
               )
             )
           )
         )
     and (
           pe.situacao = 'aberta'
           or coalesce(pe.resolvida_em, pe.criada_em) >= now() - interval '90 days'
         );

  return v_result;
end;
$$;

comment on function public.listar_pendencias_v2(uuid) is
  'Lista pendências abertas primeiro e resolvidas/descartadas dos últimos 90 dias. Sem project_id, respeita centros_visiveis() e, para admin, mantém sem centro e abertas de centros inativos (mig. 063).';

revoke all on function public.listar_pendencias_v2(uuid) from public, anon;
grant execute on function public.listar_pendencias_v2(uuid) to authenticated;

-- 5.3 resolver_pendencia_v2(p_id uuid, p_situacao text)
create or replace function public.resolver_pendencia_v2(p_id uuid, p_situacao text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.pendencias;
begin
  if public.is_agente() then
    raise exception 'O agente não resolve pendências.' using errcode = '42501';
  end if;

  if p_id is null or p_situacao is null or p_situacao not in ('resolvida', 'descartada') then
    raise exception 'Situação inválida: %. Use resolvida ou descartada.', coalesce(p_situacao, '<null>')
      using errcode = '22023';
  end if;

  select pe.*
    into v_row
    from public.pendencias pe
   where pe.id = p_id
     and (
       public.is_admin()
       or (pe.project_id is not null and pe.project_id = any(public.allowed_project_ids()))
     )
     for update;

  if not found then
    raise exception 'Pendência não encontrada ou sem permissão.'
      using errcode = '42501';
  end if;

  if v_row.situacao = p_situacao then
    return jsonb_build_object(
      'id',       v_row.id,
      'situacao', v_row.situacao
    );
  end if;

  if v_row.situacao <> 'aberta' then
    raise exception 'Pendência % já está % e não pode mudar para %.', p_id, v_row.situacao, p_situacao
      using errcode = '22023';
  end if;

  update public.pendencias
     set situacao      = p_situacao,
         resolvida_em  = now(),
         resolvida_por = auth.uid()
   where id = p_id;

  return jsonb_build_object(
    'id',       p_id,
    'situacao', p_situacao
  );
end;
$$;

comment on function public.resolver_pendencia_v2(uuid, text) is
  'Resolve ou descarta pendência aberta (admin ou professor do centro; sem centro só admin; filtro de visão não nega). Idempotente para mesma situação; outra transição falha (mig. 063).';

revoke all on function public.resolver_pendencia_v2(uuid, text) from public, anon;
grant execute on function public.resolver_pendencia_v2(uuid, text) to authenticated;

-- 5.4 criar_pendencia_v2(p jsonb)
create or replace function public.criar_pendencia_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chaves_invalidas text;
  v_chave            text;
  v_project_id_txt   text;
  v_project_id       uuid;
  v_tipo             text;
  v_titulo           text;
  v_detalhe          jsonb;
  v_origem           text;
  v_id               uuid;
  v_chave_ret        text;
  v_situacao         text;
  v_criada           boolean;
  v_ex_project_id    uuid;
  v_ex_tipo          text;
begin
  if not public.is_admin() or public.is_agente() then
    raise exception 'Só admin humano cria pendências nesta fase.' using errcode = '42501';
  end if;

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Payload deve ser um objeto JSON.' using errcode = '22023';
  end if;

  select string_agg(k, ', ' order by k)
    into v_chaves_invalidas
    from jsonb_object_keys(p) as k
   where k not in ('chave', 'project_id', 'tipo', 'titulo', 'detalhe', 'origem');

  if v_chaves_invalidas is not null then
    raise exception 'Campos não permitidos em criar_pendencia_v2: %', v_chaves_invalidas
      using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'chave') is distinct from 'string' then
    raise exception 'Campo chave é obrigatório.' using errcode = '22023';
  end if;
  v_chave := nullif(btrim(p ->> 'chave'), '');
  if v_chave is null then
    raise exception 'Campo chave não pode ser vazio.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'tipo') is distinct from 'string' then
    raise exception 'Campo tipo é obrigatório.' using errcode = '22023';
  end if;
  v_tipo := nullif(btrim(p ->> 'tipo'), '');
  if v_tipo is null or v_tipo not in ('balancete', 'plano', 'bolsas', 'contrato', 'cadastro', 'outro') then
    raise exception 'Tipo de pendência inválido.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'titulo') is distinct from 'string' then
    raise exception 'Campo titulo é obrigatório.' using errcode = '22023';
  end if;
  v_titulo := nullif(btrim(p ->> 'titulo'), '');
  if v_titulo is null then
    raise exception 'Campo titulo não pode ser vazio.' using errcode = '22023';
  end if;

  if p ? 'origem' and jsonb_typeof(p -> 'origem') not in ('string', 'null') then
    raise exception 'Campo origem deve ser texto.' using errcode = '22023';
  end if;
  v_origem := coalesce(nullif(btrim(p ->> 'origem'), ''), 'sistema');
  if v_origem not in ('sistema', 'buriti', 'claude', 'pessoa') then
    raise exception 'Origem de pendência inválida.'
      using errcode = '22023';
  end if;

  if p ? 'project_id' and jsonb_typeof(p -> 'project_id') not in ('string', 'null') then
    raise exception 'Campo project_id deve ser UUID ou nulo.' using errcode = '22023';
  end if;
  v_project_id := null;
  if p ? 'project_id' and jsonb_typeof(p -> 'project_id') = 'string' then
    v_project_id_txt := nullif(btrim(p ->> 'project_id'), '');
    if v_project_id_txt is not null then
      if v_project_id_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Campo project_id inválido.' using errcode = '22023';
      end if;
      begin
        v_project_id := v_project_id_txt::uuid;
      exception when invalid_text_representation then
        raise exception 'Campo project_id inválido.' using errcode = '22023';
      end;
    end if;
  end if;

  if v_project_id is not null and not exists (
    select 1 from public.projects pr where pr.id = v_project_id and pr.active = true
  ) then
    raise exception 'Projeto não encontrado ou inativo.'
      using errcode = '22023';
  end if;

  if p ? 'detalhe' and jsonb_typeof(p -> 'detalhe') not in ('object', 'null') then
    raise exception 'Campo detalhe deve ser um objeto JSON.'
      using errcode = '22023';
  end if;
  v_detalhe := case
    when not (p ? 'detalhe') or jsonb_typeof(p -> 'detalhe') = 'null' then '{}'::jsonb
    else p -> 'detalhe'
  end;

  if public.contem_cpf(v_chave || ' ' || v_titulo || ' ' || v_detalhe::text) then
    raise exception 'Pendência contém sequência no formato de CPF e não pode ser gravada.'
      using errcode = '22023';
  end if;

  insert into public.pendencias (chave, project_id, tipo, titulo, detalhe, origem)
  values (v_chave, v_project_id, v_tipo, v_titulo, v_detalhe, v_origem)
  on conflict (chave) do update
     set titulo  = excluded.titulo,
         detalhe = excluded.detalhe
   where public.pendencias.situacao = 'aberta'
     and public.pendencias.project_id is not distinct from excluded.project_id
     and public.pendencias.tipo = excluded.tipo
  returning id, chave, situacao, (xmax = 0)
    into v_id, v_chave_ret, v_situacao, v_criada;

  if not found then
    select pe.id, pe.chave, pe.situacao, pe.project_id, pe.tipo
      into v_id, v_chave_ret, v_situacao, v_ex_project_id, v_ex_tipo
      from public.pendencias pe
     where pe.chave = v_chave;

    if v_ex_project_id is distinct from v_project_id or v_ex_tipo is distinct from v_tipo then
      raise exception 'Conflito de chave: já existe pendência com esta chave para outro centro ou tipo.'
        using errcode = '22023';
    end if;

    v_criada := false;
  end if;

  return jsonb_build_object(
    'id',       v_id,
    'chave',    v_chave_ret,
    'situacao', v_situacao,
    'criada',   v_criada
  );
end;
$$;

comment on function public.criar_pendencia_v2(jsonb) is
  'Cria pendência idempotente por chave (só admin na F1). Atualiza título/detalhe se aberta; não reabre resolvida/descartada; recusa CPF (mig. 063).';

revoke all on function public.criar_pendencia_v2(jsonb) from public, anon;
grant execute on function public.criar_pendencia_v2(jsonb) to authenticated;

-- 5.5 get_filtro_visao_v2()
create or replace function public.get_filtro_visao_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ocultos uuid[];
begin
  if not public.is_admin() then
    return jsonb_build_object('centros_ocultos', '[]'::jsonb);
  end if;

  select fv.centros_ocultos
    into v_ocultos
    from public.filtro_visao fv
   where fv.user_id = auth.uid();

  return jsonb_build_object(
    'centros_ocultos', to_jsonb(coalesce(v_ocultos, '{}'::uuid[]))
  );
end;
$$;

comment on function public.get_filtro_visao_v2() is
  'Lê diretamente filtro_visao do usuário admin autenticado; retorna lista vazia se não houver linha ou para não-admin (mig. 063).';

revoke all on function public.get_filtro_visao_v2() from public, anon;
grant execute on function public.get_filtro_visao_v2() to authenticated;

-- 5.6 set_filtro_visao_v2(p_centros_ocultos uuid[])
create or replace function public.set_filtro_visao_v2(p_centros_ocultos uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_limpo uuid[];
begin
  if v_uid is null or not public.is_admin() or public.is_agente() then
    raise exception 'Só admin pode alterar o filtro de visão.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct p.id order by p.id), '{}'::uuid[])
    into v_limpo
    from unnest(coalesce(p_centros_ocultos, '{}'::uuid[])) as u(id)
    join public.projects p on p.id = u.id
   where u.id is not null
     and p.active = true;

  insert into public.filtro_visao (user_id, centros_ocultos, atualizado_em)
  values (v_uid, v_limpo, now())
  on conflict (user_id) do update
     set centros_ocultos = excluded.centros_ocultos,
         atualizado_em   = now();

  return jsonb_build_object('centros_ocultos', to_jsonb(v_limpo));
end;
$$;

comment on function public.set_filtro_visao_v2(uuid[]) is
  'Grava os centros ocultos do admin (distinct, sem nulos, somente ids de projetos ativos existentes). Erro para não-admin (mig. 063).';

revoke all on function public.set_filtro_visao_v2(uuid[]) from public, anon;
grant execute on function public.set_filtro_visao_v2(uuid[]) to authenticated;

-- 5.7 get_repasses_v2(p_project_id uuid)
create or replace function public.get_repasses_v2(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_plano_id       uuid;
  v_valor_total    numeric;
  v_parcelas       jsonb := '[]'::jsonb;
  v_data_balancete date;
  v_recursos       jsonb;
begin
  if p_project_id is null then
    raise exception 'project_id é obrigatório.' using errcode = '22023';
  end if;

  perform public.assert_project_allowed(p_project_id);

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Projeto não encontrado: %', p_project_id
      using errcode = 'P0002';
  end if;

  select pt.id, pt.valor_total_plano
    into v_plano_id, v_valor_total
    from public.planos_trabalho pt
   where pt.project_id = p_project_id
     and pt.ativo = true
   order by pt.versao desc
   limit 1;

  if v_plano_id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'parcela',       pd.parcela,
          'data_prevista', pd.data_prevista,
          'data_texto',    pd.data_texto,
          'valor',         pd.valor,
          'valor_texto',   pd.valor_texto
        )
        order by pd.parcela
      ),
      '[]'::jsonb
    )
      into v_parcelas
      from public.plano_desembolsos pd
     where pd.plano_id = v_plano_id;
  end if;

  select v.data_referencia,
         case
           when jsonb_typeof(b.raw_extraction -> 'data' -> 'recursos') = 'object'
             then b.raw_extraction -> 'data' -> 'recursos'
           else null
         end
    into v_data_balancete, v_recursos
    from public.v_balancete_vigente v
    join public.balancetes b on b.id = v.balancete_id
   where v.project_id = p_project_id
   limit 1;

  return jsonb_build_object(
    'parcelas',          coalesce(v_parcelas, '[]'::jsonb),
    'valor_total_plano', v_valor_total,
    'data_balancete',    v_data_balancete,
    'recursos',          v_recursos
  );
end;
$$;

comment on function public.get_repasses_v2(uuid) is
  'Leitura pura de parcelas do plano ativo, valor_total_plano e recursos do balancete vigente (lido via v_balancete_vigente; dentro desta RPC definer a guarda real de escopo é assert_project_allowed) para o frontend calcular situacaoDasParcelas (mig. 063).';

revoke all on function public.get_repasses_v2(uuid) from public, anon;
grant execute on function public.get_repasses_v2(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. Asserções dentro da transação
-- ------------------------------------------------------------
do $$
declare
  v_pend   oid := 'public.pendencias'::regclass;
  v_filt   oid := 'public.filtro_visao'::regclass;
  v_view   oid := 'public.v_balancete_vigente'::regclass;
  v_fn_sig text;
  v_fn     oid;
  v_cols   text;
begin
  -- RLS ligado nas duas tabelas
  if not (select relrowsecurity from pg_class where oid = v_pend) then
    raise exception '063: RLS desligado em pendencias';
  end if;
  if not (select relrowsecurity from pg_class where oid = v_filt) then
    raise exception '063: RLS desligado em filtro_visao';
  end if;

  -- Gatilho do agente nas duas tabelas (BEFORE INSERT OR UPDATE OR DELETE FOR EACH STATEMENT sem WHEN)
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = v_pend
       and t.tgname = 'trg_bloqueia_agente'
       and not t.tgisinternal
       and t.tgqual is null
       and (t.tgtype & 1) = 0        -- statement-level
       and (t.tgtype & 2) <> 0       -- BEFORE
       and (t.tgtype & (4|8|16)) = (4|8|16) -- INSERT | DELETE | UPDATE
       and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
  ) then
    raise exception '063: trg_bloqueia_agente ausente ou incorreto em pendencias';
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = v_filt
       and t.tgname = 'trg_bloqueia_agente'
       and not t.tgisinternal
       and t.tgqual is null
       and (t.tgtype & 1) = 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|8|16)) = (4|8|16)
       and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
  ) then
    raise exception '063: trg_bloqueia_agente ausente ou incorreto em filtro_visao';
  end if;

  -- Gatilho de CPF na tabela pendencias (BEFORE INSERT OR UPDATE FOR EACH ROW)
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = v_pend
       and t.tgname = 'trg_pendencias_sem_cpf'
       and not t.tgisinternal
       and (t.tgtype & 1) <> 0        -- row-level
       and (t.tgtype & 2) <> 0        -- BEFORE
       and (t.tgtype & (4|16)) = (4|16) -- INSERT | UPDATE
       and t.tgfoid = 'public._pendencias_sem_cpf()'::regprocedure
  ) then
    raise exception '063: trg_pendencias_sem_cpf ausente ou incorreto em pendencias';
  end if;

  v_fn := 'public._pendencias_sem_cpf()'::regprocedure;
  if not exists (
    select 1 from pg_proc p
     where p.oid = v_fn
       and p.prosecdef
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
  ) then
    raise exception '063: _pendencias_sem_cpf sem security definer ou search_path';
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or exists (
       select 1
         from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = v_fn
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
     ) then
    raise exception '063: ACL incorreta em _pendencias_sem_cpf';
  end if;

  -- Nenhuma policy de escrita em pendencias; apenas a policy de SELECT esperada
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'pendencias'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception '063: pendencias possui policy de escrita';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'pendencias'
       and policyname = 'pendencias_select_escopo' and cmd = 'SELECT'
  ) then
    raise exception '063: policy pendencias_select_escopo ausente';
  end if;

  -- Policy de filtro_visao só para o próprio admin, sem nenhuma outra policy de escrita
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'filtro_visao'
       and policyname = 'filtro_visao_proprio_admin' and cmd = 'ALL'
       and coalesce(qual, '') ~ 'is_admin'
       and coalesce(with_check, '') ~ 'is_admin'
  ) then
    raise exception '063: policy filtro_visao_proprio_admin ausente ou sem is_admin';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'filtro_visao'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and policyname <> 'filtro_visao_proprio_admin'
  ) then
    raise exception '063: filtro_visao possui policy de escrita inesperada';
  end if;

  -- FKs com regras de deleção corretas (restrict em project_id; set null em resolvida_por)
  if not exists (
    select 1 from pg_constraint
     where conrelid = v_pend and contype = 'f'
       and conname = 'pendencias_project_id_fkey' and confdeltype = 'r'
  ) then
    raise exception '063: pendencias_project_id_fkey ausente ou sem ON DELETE RESTRICT';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = v_pend and contype = 'f'
       and conname = 'pendencias_resolvida_por_fkey' and confdeltype = 'n'
  ) then
    raise exception '063: pendencias_resolvida_por_fkey ausente ou sem ON DELETE SET NULL';
  end if;

  -- Check de detalhe objeto e nenhum CHECK em pendencias usando contem_cpf
  if not exists (
    select 1 from pg_constraint
     where conrelid = v_pend and contype = 'c'
       and conname = 'pendencias_detalhe_objeto_check'
  ) then
    raise exception '063: pendencias_detalhe_objeto_check ausente';
  end if;
  if exists (
    select 1 from pg_constraint
     where conrelid = v_pend and contype = 'c'
       and pg_get_constraintdef(oid) ~ 'contem_cpf'
  ) then
    raise exception '063: CHECK em pendencias não pode chamar contem_cpf';
  end if;

  -- Índice e constraint única em pendencias
  if not exists (
    select 1 from pg_constraint
     where conrelid = v_pend and contype = 'u' and conname = 'pendencias_chave_unique'
  ) then
    raise exception '063: constraint pendencias_chave_unique ausente';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'pendencias'
       and indexname = 'idx_pendencias_project_abertas'
  ) then
    raise exception '063: índice idx_pendencias_project_abertas ausente';
  end if;

  -- View com security_invoker = true
  if not exists (
    select 1 from pg_class
     where oid = v_view and relkind = 'v'
       and reloptions @> array['security_invoker=true']
  ) then
    raise exception '063: v_balancete_vigente sem security_invoker=true';
  end if;

  -- Privilégios de anon / authenticated em tabelas e view
  if has_table_privilege('anon', v_pend, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', v_filt, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', v_view, 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '063: anon possui acesso a tabela ou view nova';
  end if;
  if not has_table_privilege('authenticated', v_pend, 'SELECT')
     or has_table_privilege('authenticated', v_pend, 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '063: ACL incorreta para authenticated em pendencias';
  end if;
  if not has_table_privilege('authenticated', v_view, 'SELECT')
     or has_table_privilege('authenticated', v_view, 'INSERT,UPDATE,DELETE') then
    raise exception '063: ACL incorreta para authenticated em v_balancete_vigente';
  end if;

  -- Colunas e tipos exatos (idempotência / contrato de esquema)
  select string_agg(a.attname || ':' || format_type(a.atttypid, -1), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_pend and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'id:uuid, chave:text, project_id:uuid, tipo:text, titulo:text, detalhe:jsonb, situacao:text, origem:text, criada_em:timestamp with time zone, resolvida_em:timestamp with time zone, resolvida_por:uuid' then
    raise exception '063: colunas/tipos inesperados em pendencias: %', v_cols;
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, -1), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_filt and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'user_id:uuid, centros_ocultos:uuid[], atualizado_em:timestamp with time zone' then
    raise exception '063: colunas/tipos inesperados em filtro_visao: %', v_cols;
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, -1), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_view and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'project_id:uuid, balancete_id:uuid, data_referencia:date, saldo_disponivel:numeric, rendimento_liquido:numeric' then
    raise exception '063: colunas/tipos inesperados em v_balancete_vigente: %', v_cols;
  end if;

  -- Conferência por nome de todas as 8 funções novas (definer, search_path, ACL)
  foreach v_fn_sig in array array[
    'public.centros_visiveis()',
    'public.resumo_projetos_v2()',
    'public.listar_pendencias_v2(uuid)',
    'public.resolver_pendencia_v2(uuid, text)',
    'public.criar_pendencia_v2(jsonb)',
    'public.get_filtro_visao_v2()',
    'public.set_filtro_visao_v2(uuid[])',
    'public.get_repasses_v2(uuid)'
  ] loop
    v_fn := v_fn_sig::regprocedure;
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig is not null
         and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
    ) then
      raise exception '063: função % sem security definer ou search_path', v_fn_sig;
    end if;

    if not has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (
         select 1
           from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn
            and a.grantee = 0
            and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '063: ACL incorreta em %', v_fn_sig;
    end if;
  end loop;

  if not exists (
    select 1 from pg_proc
     where oid = 'public.centros_visiveis()'::regprocedure
       and provolatile = 's'
  ) then
    raise exception '063: centros_visiveis() não é STABLE';
  end if;
end $$;

commit;
