-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 064
-- F2-A: Banco da Fase 2 — rastreabilidade (documentos, versões, fatos)
--       + melhorias de pendências (revisão da 063)
-- ============================================================
-- Cria de forma aditiva e idempotente o registro de origem dos números:
--   1. `documentos` e `documento_versoes` (catálogo de PDFs/DOCX por projeto).
--   2. `fatos` (número lido em um documento, página, trecho literal, bbox),
--      identificando o alvo por chave estável `(alvo_tabela, alvo_pai_id, alvo_chave)`,
--      pois `upsert_plano_trabalho` e `upsert_balancete` recriam linhas a cada gravação.
--   3. Funções auxiliares internas `_tem_cpf`, `_mascarar_cpf`, `_fmt_brl_num` e
--      `_resolver_origem_alvo` (fonte única da regra `documento`/`legado`/`digitado`).
--   4. 3 RPCs `_v2`: `registrar_documento_v2` (admin), `get_origem_v2` (escopo +
--      máscara de CPF no trecho para não-admin) e `explicar_livre_v2` (árvore do
--      saldo livre a partir de `get_saldo_livre`).
--   5. Ajustes em `pendencias` da revisão da 063 (`_tem_cpf`, revalidação só de
--      colunas alteradas no UPDATE, centro inativo permitido ao atualizar aberta,
--      `project_id: ""` recusado, `detalhe: null` -> `{}`, `btrim` com whitespace,
--      `resolver_pendencia_v2(null, ...)` claro, índice em `resolvida_por`).
--
-- Notas de segurança e escopo:
--   • As RPCs antigas (`upsert_balancete`, `upsert_plano_trabalho`, `get_saldo_livre`…)
--     não mudam nesta fase; `balancetes` e `planos_trabalho` não recebem coluna nova.
--   • A máscara protege `fatos.trecho` entregue por `get_origem_v2` para não-admin;
--     o arquivo inteiro continua com o escopo da migração 062 (professor do centro
--     já abre o documento no site hoje). A policy admin-only de `fatos` isola a
--     leitura direta da tabela sem ser tratada como barreira de CPF.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Tabela `public.documentos`
-- ------------------------------------------------------------
create table if not exists public.documentos (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  tipo       text not null,
  chave      text not null,
  titulo     text not null,
  criado_em  timestamptz not null default now()
);

alter table public.documentos add column if not exists id         uuid default gen_random_uuid();
alter table public.documentos add column if not exists project_id uuid;
alter table public.documentos add column if not exists tipo       text;
alter table public.documentos add column if not exists chave      text;
alter table public.documentos add column if not exists titulo     text;
alter table public.documentos add column if not exists criado_em  timestamptz default now();

alter table public.documentos drop constraint if exists documentos_project_id_fkey;
alter table public.documentos
  add constraint documentos_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete restrict;

alter table public.documentos drop constraint if exists documentos_tipo_check;
alter table public.documentos
  add constraint documentos_tipo_check
  check (tipo in ('balancete', 'plano'));

alter table public.documentos drop constraint if exists documentos_chave_unique;
alter table public.documentos
  add constraint documentos_chave_unique unique (chave);

alter table public.documentos drop constraint if exists documentos_chave_nao_vazia;
alter table public.documentos
  add constraint documentos_chave_nao_vazia
  check (btrim(chave, E' \t\n\r') <> '');

alter table public.documentos drop constraint if exists documentos_titulo_nao_vazio;
alter table public.documentos
  add constraint documentos_titulo_nao_vazio
  check (btrim(titulo, E' \t\n\r') <> '');

create index if not exists idx_documentos_project
  on public.documentos (project_id);

comment on table public.documentos is
  'Documentos rastreados por centro de custo (balancete ou plano). Escrita exclusiva via registrar_documento_v2 (mig. 064).';

comment on column public.documentos.chave is
  'Chave estável do documento por project_id: balancete:<project_id>:<AAAA-MM-DD> ou plano:<project_id>:<plano_id> (mig. 064).';

alter table public.documentos enable row level security;
revoke all on public.documentos from public, anon, authenticated;
grant select on public.documentos to authenticated;

drop policy if exists documentos_select_escopo on public.documentos;
create policy documentos_select_escopo on public.documentos
  for select to authenticated
  using (
    public.is_admin()
    or project_id = any(public.allowed_project_ids())
  );

drop trigger if exists trg_bloqueia_agente on public.documentos;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.documentos
  for each statement execute function public.bloqueia_escrita_do_agente();

-- ------------------------------------------------------------
-- 2. Tabela `public.documento_versoes`
-- ------------------------------------------------------------
create table if not exists public.documento_versoes (
  id             uuid primary key default gen_random_uuid(),
  documento_id   uuid not null,
  versao         integer not null,
  sha256         text not null,
  bucket         text not null,
  caminho        text not null,
  arquivo_nome   text,
  formato        text not null,
  paginas        integer,
  parser         text not null,
  parser_versao  text not null,
  origem         text not null,
  registrado_em  timestamptz not null default now(),
  registrado_por uuid
);

alter table public.documento_versoes add column if not exists id             uuid default gen_random_uuid();
alter table public.documento_versoes add column if not exists documento_id   uuid;
alter table public.documento_versoes add column if not exists versao         integer;
alter table public.documento_versoes add column if not exists sha256         text;
alter table public.documento_versoes add column if not exists bucket         text;
alter table public.documento_versoes add column if not exists caminho        text;
alter table public.documento_versoes add column if not exists arquivo_nome   text;
alter table public.documento_versoes add column if not exists formato        text;
alter table public.documento_versoes add column if not exists paginas        integer;
alter table public.documento_versoes add column if not exists parser         text;
alter table public.documento_versoes add column if not exists parser_versao  text;
alter table public.documento_versoes add column if not exists origem         text;
alter table public.documento_versoes add column if not exists registrado_em  timestamptz default now();
alter table public.documento_versoes add column if not exists registrado_por uuid;

alter table public.documento_versoes drop constraint if exists documento_versoes_documento_id_fkey;
alter table public.documento_versoes
  add constraint documento_versoes_documento_id_fkey
  foreign key (documento_id) references public.documentos(id) on delete restrict;

alter table public.documento_versoes drop constraint if exists documento_versoes_registrado_por_fkey;
alter table public.documento_versoes
  add constraint documento_versoes_registrado_por_fkey
  foreign key (registrado_por) references auth.users(id) on delete set null;

alter table public.documento_versoes drop constraint if exists documento_versoes_versao_check;
alter table public.documento_versoes
  add constraint documento_versoes_versao_check
  check (versao >= 1);

alter table public.documento_versoes drop constraint if exists documento_versoes_sha256_check;
alter table public.documento_versoes
  add constraint documento_versoes_sha256_check
  check (sha256 ~ '^[0-9a-f]{64}$');

alter table public.documento_versoes drop constraint if exists documento_versoes_bucket_check;
alter table public.documento_versoes
  add constraint documento_versoes_bucket_check
  check (bucket in ('balancete-pdfs', 'plano-trabalho-docs'));

alter table public.documento_versoes drop constraint if exists documento_versoes_caminho_nao_vazio;
alter table public.documento_versoes
  add constraint documento_versoes_caminho_nao_vazio
  check (btrim(caminho, E' \t\n\r') <> '');

alter table public.documento_versoes drop constraint if exists documento_versoes_formato_check;
alter table public.documento_versoes
  add constraint documento_versoes_formato_check
  check (formato in ('pdf', 'docx'));

alter table public.documento_versoes drop constraint if exists documento_versoes_formato_paginas_check;
alter table public.documento_versoes
  add constraint documento_versoes_formato_paginas_check
  check (
    (formato = 'docx' and paginas is null)
    or (formato = 'pdf' and (paginas is null or paginas >= 1))
  );

alter table public.documento_versoes drop constraint if exists documento_versoes_parser_nao_vazio;
alter table public.documento_versoes
  add constraint documento_versoes_parser_nao_vazio
  check (btrim(parser, E' \t\n\r') <> '');

alter table public.documento_versoes drop constraint if exists documento_versoes_parser_versao_nao_vazia;
alter table public.documento_versoes
  add constraint documento_versoes_parser_versao_nao_vazia
  check (btrim(parser_versao, E' \t\n\r') <> '');

alter table public.documento_versoes drop constraint if exists documento_versoes_origem_check;
alter table public.documento_versoes
  add constraint documento_versoes_origem_check
  check (origem in ('backfill', 'site', 'ingestao'));

alter table public.documento_versoes drop constraint if exists documento_versoes_doc_versao_unique;
alter table public.documento_versoes
  add constraint documento_versoes_doc_versao_unique unique (documento_id, versao);

alter table public.documento_versoes drop constraint if exists documento_versoes_doc_sha256_unique;
alter table public.documento_versoes
  add constraint documento_versoes_doc_sha256_unique unique (documento_id, sha256);

create index if not exists idx_documento_versoes_doc_rec
  on public.documento_versoes (documento_id, registrado_em desc, versao desc);

create index if not exists idx_documento_versoes_registrado_por
  on public.documento_versoes (registrado_por);

comment on table public.documento_versoes is
  'Versões imutáveis de cada documento (deduplicadas por sha256 dentro do documento). Escrita exclusiva via registrar_documento_v2 (mig. 064).';

alter table public.documento_versoes enable row level security;
revoke all on public.documento_versoes from public, anon, authenticated;
grant select on public.documento_versoes to authenticated;

drop policy if exists documento_versoes_select_escopo on public.documento_versoes;
create policy documento_versoes_select_escopo on public.documento_versoes
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
        from public.documentos d
       where d.id = documento_versoes.documento_id
         and d.project_id = any(public.allowed_project_ids())
    )
  );

drop trigger if exists trg_bloqueia_agente on public.documento_versoes;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.documento_versoes
  for each statement execute function public.bloqueia_escrita_do_agente();

-- ------------------------------------------------------------
-- 3. Tabela `public.fatos` (chave estável sem alvo_id)
-- ------------------------------------------------------------
create table if not exists public.fatos (
  id          uuid primary key default gen_random_uuid(),
  versao_id   uuid not null,
  alvo_tabela text not null,
  alvo_pai_id uuid not null,
  alvo_chave  text not null,
  campo       text not null,
  valor       numeric(14,2) not null,
  pagina      integer,
  trecho      text not null,
  bbox        jsonb,
  criado_em   timestamptz not null default now()
);

alter table public.fatos add column if not exists id          uuid default gen_random_uuid();
alter table public.fatos add column if not exists versao_id   uuid;
alter table public.fatos add column if not exists alvo_tabela text;
alter table public.fatos add column if not exists alvo_pai_id uuid;
alter table public.fatos add column if not exists alvo_chave  text;
alter table public.fatos add column if not exists campo       text;
alter table public.fatos add column if not exists valor       numeric(14,2);
alter table public.fatos add column if not exists pagina      integer;
alter table public.fatos add column if not exists trecho      text;
alter table public.fatos add column if not exists bbox        jsonb;
alter table public.fatos add column if not exists criado_em   timestamptz default now();

alter table public.fatos drop constraint if exists fatos_versao_id_fkey;
alter table public.fatos
  add constraint fatos_versao_id_fkey
  foreign key (versao_id) references public.documento_versoes(id) on delete cascade;

alter table public.fatos drop constraint if exists fatos_alvo_tabela_campo_check;
alter table public.fatos
  add constraint fatos_alvo_tabela_campo_check
  check (
    (alvo_tabela = 'balancetes'            and campo in ('saldo_disponivel', 'rendimento_liquido', 'total_debitos', 'total_creditos') and alvo_chave = '')
    or (alvo_tabela = 'balancete_lancamentos' and campo in ('saldo_atual', 'valor_debito', 'valor_credito') and alvo_chave <> '')
    or (alvo_tabela = 'planos_trabalho'       and campo in ('valor_total_plano') and alvo_chave = '')
    or (alvo_tabela = 'plano_rubricas'        and campo in ('valor_previsto') and alvo_chave <> '')
    or (alvo_tabela = 'plano_desembolsos'     and campo in ('valor') and alvo_chave <> '')
  );

alter table public.fatos drop constraint if exists fatos_pagina_check;
alter table public.fatos
  add constraint fatos_pagina_check
  check (pagina is null or pagina >= 1);

alter table public.fatos drop constraint if exists fatos_trecho_check;
alter table public.fatos
  add constraint fatos_trecho_check
  check (char_length(trecho) between 1 and 500 and btrim(trecho, E' \t\n\r') <> '');

alter table public.fatos drop constraint if exists fatos_bbox_check;
alter table public.fatos
  add constraint fatos_bbox_check
  check (
    bbox is null or (
      jsonb_typeof(bbox) = 'object'
      and bbox ?& array['x0', 'x1', 'yMin', 'yMax']
      and (bbox - array['x0', 'x1', 'yMin', 'yMax']) = '{}'::jsonb
      and jsonb_typeof(bbox -> 'x0') = 'number'
      and jsonb_typeof(bbox -> 'x1') = 'number'
      and jsonb_typeof(bbox -> 'yMin') = 'number'
      and jsonb_typeof(bbox -> 'yMax') = 'number'
      and (bbox ->> 'x0')::numeric <= (bbox ->> 'x1')::numeric
      and (bbox ->> 'yMin')::numeric <= (bbox ->> 'yMax')::numeric
    )
  );

alter table public.fatos drop constraint if exists fatos_versao_alvo_campo_unique;
alter table public.fatos
  add constraint fatos_versao_alvo_campo_unique
  unique (versao_id, alvo_tabela, alvo_pai_id, alvo_chave, campo);

create index if not exists idx_fatos_alvo
  on public.fatos (alvo_tabela, alvo_pai_id, alvo_chave, campo);

comment on table public.fatos is
  'Fatos numéricos extraídos de documento_versoes com alvo estável (alvo_pai_id + alvo_chave). Leitura direta apenas admin; professor consulta via get_origem_v2 com trecho mascarado (o arquivo em storage segue o escopo da 062). Escrita exclusiva via registrar_documento_v2 (mig. 064).';

alter table public.fatos enable row level security;
revoke all on public.fatos from public, anon, authenticated;
grant select on public.fatos to authenticated;

drop policy if exists fatos_select_admin on public.fatos;
create policy fatos_select_admin on public.fatos
  for select to authenticated
  using (public.is_admin());

drop trigger if exists trg_bloqueia_agente on public.fatos;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.fatos
  for each statement execute function public.bloqueia_escrita_do_agente();

-- ------------------------------------------------------------
-- 4. Funções auxiliares internas (sem grant para ninguém)
-- ------------------------------------------------------------

-- 4.1 _tem_cpf: contem_cpf direto, após colapsar espaço/ponto/traço entre
--     dígitos e por blocos 3-3-3-2 (preserva o dígito verificador da 052).
create or replace function public._tem_cpf(t text)
returns boolean
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  m text[];
begin
  if t is null or t = '' then
    return false;
  end if;

  if public.contem_cpf(t) then
    return true;
  end if;

  if public.contem_cpf(regexp_replace(t, '(?<=[0-9])[ \t\n\r.-]+(?=[0-9])', '', 'g')) then
    return true;
  end if;

  for m in
    select regexp_matches(
      t,
      '(?<![0-9])([0-9]{3}(?:[ \t\n\r.-]?[0-9]{3}){2}[ \t\n\r.-]?[0-9]{2})(?![0-9])',
      'g'
    )
  loop
    if public.contem_cpf(regexp_replace(m[1], '[^0-9]', '', 'g')) then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

comment on function public._tem_cpf(text) is
  'Invólucro local sobre contem_cpf (052): detecta também CPF com espaços/traços/quebras entre dígitos mantendo o dígito verificador (mig. 064).';

revoke all on function public._tem_cpf(text) from public, anon, authenticated;

-- 4.2 _mascarar_cpf: substitui sequências no formato de CPF por ***.***.***-**
create or replace function public._mascarar_cpf(t text)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case
    when t is null then null
    else regexp_replace(
      t,
      '(?<![0-9])[0-9]{3}[ \t\n\r.-]{0,3}[0-9]{3}[ \t\n\r.-]{0,3}[0-9]{3}[ \t\n\r.-]{0,3}[0-9]{2}(?![0-9])',
      '***.***.***-**',
      'g'
    )
  end;
$$;

comment on function public._mascarar_cpf(text) is
  'Mascara sequências no formato de CPF em trechos entregues a usuários não-admin (mig. 064).';

revoke all on function public._mascarar_cpf(text) from public, anon, authenticated;

-- 4.3 _fmt_brl_num: formata numeric para exibição pt-BR sem prefixo R$
create or replace function public._fmt_brl_num(p_val numeric)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_val is null then ''
    else (case when p_val < 0 then '-' else '' end)
      || translate(
           btrim(to_char(abs(round(p_val, 2)), 'FM999,999,999,999,990.00')),
           ',.',
           '.,'
         )
  end;
$$;

comment on function public._fmt_brl_num(numeric) is
  'Formata número decimal no padrão 1.234,50 para mensagens e rótulos internos (mig. 064).';

revoke all on function public._fmt_brl_num(numeric) from public, anon, authenticated;

-- 4.4 _resolver_origem_alvo: fonte única para get_origem_v2 e explicar_livre_v2
--     Assume alvo e campo validados e assert_project_allowed já verificado pelo chamador.
create or replace function public._resolver_origem_alvo(
  p_alvo_tabela text,
  p_alvo_id     uuid,
  p_campo       text,
  p_mascarar    boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id   uuid;
  v_alvo_pai_id  uuid;
  v_alvo_chave   text;
  v_valor        numeric(14,2);
  v_doc_tipo     text;
  v_bucket       text;
  v_storage_path text;
  v_arquivo_nome text;
  v_data_ref     date;
  v_plano_versao integer;
  v_busca        jsonb;
  v_fato         record;
  v_doc_json     jsonb;
  v_meses_pt     constant text[] := array[
    'jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'
  ];
begin
  if p_alvo_tabela = 'scholarships' and p_campo = 'amount' then
    select s.amount
      into v_valor
      from public.scholarships s
     where s.id = p_alvo_id;

    if not found then
      return null;
    end if;

    return jsonb_build_object(
      'tipo',      'digitado',
      'valor',     v_valor,
      'documento', null,
      'fato',      null,
      'busca',     null,
      'nota',      'Valor mensal do cadastro de bolsas (planilha da FUNAPE), sem documento por linha até a F3; na árvore do livre aparece o total dos meses da janela.'
    );
  end if;

  if p_alvo_tabela = 'balancetes' then
    select b.project_id,
           b.id,
           '',
           case p_campo
             when 'saldo_disponivel'   then b.saldo_disponivel
             when 'rendimento_liquido' then b.rendimento_liquido
             when 'total_debitos'      then b.total_debitos
             when 'total_creditos'     then b.total_creditos
           end,
           'balancete',
           'balancete-pdfs',
           b.arquivo_storage_path,
           b.arquivo_nome,
           b.data_referencia,
           null::integer
      into v_project_id, v_alvo_pai_id, v_alvo_chave, v_valor,
           v_doc_tipo, v_bucket, v_storage_path, v_arquivo_nome, v_data_ref, v_plano_versao
      from public.balancetes b
     where b.id = p_alvo_id;

    if not found then
      return null;
    end if;

    v_busca := jsonb_strip_nulls(jsonb_build_object(
      'texto', case p_campo
                 when 'saldo_disponivel'   then 'saldo disponivel'
                 when 'rendimento_liquido' then 'rendimento liquido'
                 when 'total_debitos'      then 'total de debitos'
                 when 'total_creditos'     then 'total de creditos'
               end,
      'valor', v_valor
    ));

  elsif p_alvo_tabela = 'balancete_lancamentos' then
    select b.project_id,
           bl.balancete_id,
           bl.conta_codigo,
           case p_campo
             when 'saldo_atual'   then bl.saldo_atual
             when 'valor_debito'  then bl.valor_debito
             when 'valor_credito' then bl.valor_credito
           end,
           'balancete',
           'balancete-pdfs',
           b.arquivo_storage_path,
           b.arquivo_nome,
           b.data_referencia,
           null::integer
      into v_project_id, v_alvo_pai_id, v_alvo_chave, v_valor,
           v_doc_tipo, v_bucket, v_storage_path, v_arquivo_nome, v_data_ref, v_plano_versao
      from public.balancete_lancamentos bl
      join public.balancetes b on b.id = bl.balancete_id
     where bl.id = p_alvo_id;

    if not found then
      return null;
    end if;

    v_busca := jsonb_strip_nulls(jsonb_build_object(
      'conta_codigo', v_alvo_chave,
      'valor',        v_valor
    ));

  elsif p_alvo_tabela = 'planos_trabalho' then
    select pt.project_id,
           pt.id,
           '',
           pt.valor_total_plano,
           'plano',
           'plano-trabalho-docs',
           pt.arquivo_storage_path,
           pt.arquivo_nome,
           null::date,
           pt.versao
      into v_project_id, v_alvo_pai_id, v_alvo_chave, v_valor,
           v_doc_tipo, v_bucket, v_storage_path, v_arquivo_nome, v_data_ref, v_plano_versao
      from public.planos_trabalho pt
     where pt.id = p_alvo_id;

    if not found then
      return null;
    end if;

    v_busca := jsonb_strip_nulls(jsonb_build_object(
      'texto', 'valor total',
      'valor', v_valor
    ));

  elsif p_alvo_tabela = 'plano_rubricas' then
    select pt.project_id,
           pr.plano_id,
           pr.rubrica_code || '|' || coalesce(pr.descricao_livre, ''),
           pr.valor_previsto,
           'plano',
           'plano-trabalho-docs',
           pt.arquivo_storage_path,
           pt.arquivo_nome,
           null::date,
           pt.versao,
           jsonb_strip_nulls(jsonb_build_object(
             'texto', coalesce(
                        nullif(btrim(pr.descricao_livre, E' \t\n\r"'), ''),
                        r.name
                      ),
             'valor', pr.valor_previsto
           ))
      into v_project_id, v_alvo_pai_id, v_alvo_chave, v_valor,
           v_doc_tipo, v_bucket, v_storage_path, v_arquivo_nome, v_data_ref, v_plano_versao, v_busca
      from public.plano_rubricas pr
      join public.planos_trabalho pt on pt.id = pr.plano_id
      join public.rubricas r         on r.code = pr.rubrica_code
     where pr.id = p_alvo_id;

    if not found then
      return null;
    end if;

  elsif p_alvo_tabela = 'plano_desembolsos' then
    select pt.project_id,
           pd.plano_id,
           pd.parcela::text,
           pd.valor,
           'plano',
           'plano-trabalho-docs',
           pt.arquivo_storage_path,
           pt.arquivo_nome,
           null::date,
           pt.versao,
           jsonb_strip_nulls(jsonb_build_object(
             'texto', 'Parcela ' || pd.parcela::text,
             'valor', pd.valor
           ))
      into v_project_id, v_alvo_pai_id, v_alvo_chave, v_valor,
           v_doc_tipo, v_bucket, v_storage_path, v_arquivo_nome, v_data_ref, v_plano_versao, v_busca
      from public.plano_desembolsos pd
      join public.planos_trabalho pt on pt.id = pd.plano_id
     where pd.id = p_alvo_id;

    if not found then
      return null;
    end if;
  else
    return null;
  end if;

  select f.valor,
         f.pagina,
         f.trecho,
         f.bbox,
         d.id            as documento_id,
         d.tipo          as documento_tipo,
         d.titulo        as documento_titulo,
         dv.arquivo_nome,
         dv.formato,
         dv.bucket,
         dv.caminho,
         dv.versao,
         dv.registrado_em,
         dv.parser,
         dv.parser_versao
    into v_fato
    from public.fatos f
    join public.documento_versoes dv on dv.id = f.versao_id
    join public.documentos d         on d.id = dv.documento_id
   where f.alvo_tabela = p_alvo_tabela
     and f.alvo_pai_id = v_alvo_pai_id
     and f.alvo_chave  = v_alvo_chave
     and f.campo       = p_campo
     and d.project_id  = v_project_id
   order by dv.registrado_em desc, dv.versao desc, dv.id desc
   limit 1;

  if found then
    v_doc_json := jsonb_build_object(
      'id',            v_fato.documento_id,
      'tipo',          v_fato.documento_tipo,
      'titulo',        v_fato.documento_titulo,
      'arquivo_nome',  v_fato.arquivo_nome,
      'formato',       v_fato.formato,
      'bucket',        v_fato.bucket,
      'caminho',       v_fato.caminho,
      'versao',        v_fato.versao,
      'registrado_em', v_fato.registrado_em
    );

    if v_valor is not null and round(v_valor, 2) = round(v_fato.valor, 2) then
      return jsonb_build_object(
        'tipo',      'documento',
        'valor',     v_valor,
        'documento', v_doc_json,
        'fato',      jsonb_build_object(
                       'pagina',        v_fato.pagina,
                       'trecho',        case
                                          when p_mascarar then public._mascarar_cpf(v_fato.trecho)
                                          else v_fato.trecho
                                        end,
                       'bbox',          v_fato.bbox,
                       'parser',        v_fato.parser,
                       'parser_versao', v_fato.parser_versao
                     ),
        'busca',     null,
        'nota',      null
      );
    end if;

    return jsonb_build_object(
      'tipo',      'legado',
      'valor',     v_valor,
      'documento', v_doc_json,
      'fato',      null,
      'busca',     v_busca,
      'nota',      'o valor mudou depois da leitura do documento (lido R$ ' || public._fmt_brl_num(v_fato.valor) || ')'
    );
  end if;

  if nullif(btrim(v_storage_path, E' \t\n\r'), '') is not null then
    v_doc_json := jsonb_build_object(
      'id',            null,
      'tipo',          v_doc_tipo,
      'titulo',        case
                         when v_doc_tipo = 'balancete' then
                           case
                             when v_data_ref is not null then
                               'Balancete de '
                               || v_meses_pt[extract(month from v_data_ref)::integer]
                               || '/' || to_char(v_data_ref, 'YY')
                             else 'Balancete'
                           end
                         else
                           'Plano de trabalho v' || coalesce(v_plano_versao::text, '0')
                       end,
      'arquivo_nome',  coalesce(
                         nullif(btrim(v_arquivo_nome, E' \t\n\r'), ''),
                         nullif(regexp_replace(v_storage_path, '^.*/', ''), '')
                       ),
      'formato',       case
                         when lower(v_storage_path) ~ '\.pdf$' then 'pdf'
                         when lower(v_storage_path) ~ '\.docx$' then 'docx'
                         when v_doc_tipo = 'balancete' then 'pdf'
                         else 'docx'
                       end,
      'bucket',        v_bucket,
      'caminho',       v_storage_path,
      'versao',        null,
      'registrado_em', null
    );
  else
    v_doc_json := null;
  end if;

  return jsonb_build_object(
    'tipo',      'legado',
    'valor',     v_valor,
    'documento', v_doc_json,
    'fato',      null,
    'busca',     v_busca,
    'nota',      null
  );
end;
$$;

comment on function public._resolver_origem_alvo(text, uuid, text, boolean) is
  'Resolve a origem de um alvo/campo (documento, legado ou digitado) usando chave estável; compartilhada por get_origem_v2 e explicar_livre_v2 (mig. 064).';

revoke all on function public._resolver_origem_alvo(text, uuid, text, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. RPCs v2 da Fase 2
-- ------------------------------------------------------------

-- 5.1 registrar_documento_v2(p jsonb)
create or replace function public.registrar_documento_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chaves_inv    text;
  v_project_txt   text;
  v_project_id    uuid;
  v_tipo          text;
  v_chave         text;
  v_titulo        text;
  v_sha256        text;
  v_bucket        text;
  v_caminho       text;
  v_arquivo_nome  text;
  v_formato       text;
  v_paginas_num   numeric;
  v_paginas       integer;
  v_parser        text;
  v_parser_versao text;
  v_origem        text;
  v_fatos_arr     jsonb;

  v_doc_id        uuid;
  v_doc_proj      uuid;
  v_doc_tipo      text;
  v_versao_id     uuid;
  v_versao        integer;
  v_trechos_cat   text;

  v_f             record;
  v_f_chaves_inv  text;
  v_f_tabela      text;
  v_f_id_txt      text;
  v_f_id          uuid;
  v_f_campo       text;
  v_f_valor       numeric(14,2);
  v_f_pag_num     numeric;
  v_f_pagina      integer;
  v_f_trecho      text;
  v_f_bbox        jsonb;

  v_alvo_proj     uuid;
  v_alvo_pai_id   uuid;
  v_alvo_chave    text;
  v_atual         numeric(14,2);
  v_divergencias  jsonb := '[]'::jsonb;
  v_qtd_fatos     integer := 0;
begin
  if not public.is_admin() or public.is_agente() then
    raise exception 'Só admin humano registra documentos nesta fase.' using errcode = '42501';
  end if;

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Payload deve ser um objeto JSON.' using errcode = '22023';
  end if;

  select string_agg(k, ', ' order by k)
    into v_chaves_inv
    from jsonb_object_keys(p) as k
   where k not in (
     'project_id', 'tipo', 'chave', 'titulo', 'sha256', 'bucket', 'caminho',
     'arquivo_nome', 'formato', 'paginas', 'parser', 'parser_versao', 'origem', 'fatos'
   );

  if v_chaves_inv is not null then
    raise exception 'Campos não permitidos em registrar_documento_v2: %', v_chaves_inv
      using errcode = '22023';
  end if;

  -- project_id
  if jsonb_typeof(p -> 'project_id') is distinct from 'string' then
    raise exception 'Campo project_id é obrigatório.' using errcode = '22023';
  end if;
  v_project_txt := nullif(btrim(p ->> 'project_id', E' \t\n\r'), '');
  if v_project_txt is null
     or v_project_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Campo project_id inválido.' using errcode = '22023';
  end if;
  v_project_id := v_project_txt::uuid;

  if not exists (select 1 from public.projects pr where pr.id = v_project_id) then
    raise exception 'Projeto não encontrado.' using errcode = '22023';
  end if;

  -- tipo
  if jsonb_typeof(p -> 'tipo') is distinct from 'string' then
    raise exception 'Campo tipo é obrigatório.' using errcode = '22023';
  end if;
  v_tipo := btrim(p ->> 'tipo', E' \t\n\r');
  if v_tipo not in ('balancete', 'plano') then
    raise exception 'Campo tipo inválido.' using errcode = '22023';
  end if;

  -- chave e titulo
  if jsonb_typeof(p -> 'chave') is distinct from 'string' then
    raise exception 'Campo chave é obrigatório.' using errcode = '22023';
  end if;
  v_chave := nullif(btrim(p ->> 'chave', E' \t\n\r'), '');
  if v_chave is null then
    raise exception 'Campo chave não pode ser vazio.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'titulo') is distinct from 'string' then
    raise exception 'Campo titulo é obrigatório.' using errcode = '22023';
  end if;
  v_titulo := nullif(btrim(p ->> 'titulo', E' \t\n\r'), '');
  if v_titulo is null then
    raise exception 'Campo titulo não pode ser vazio.' using errcode = '22023';
  end if;

  -- sha256
  if jsonb_typeof(p -> 'sha256') is distinct from 'string' then
    raise exception 'Campo sha256 é obrigatório.' using errcode = '22023';
  end if;
  v_sha256 := lower(btrim(p ->> 'sha256', E' \t\n\r'));
  if v_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Campo sha256 deve ter 64 dígitos hexadecimais.' using errcode = '22023';
  end if;

  -- bucket e matriz tipo x bucket
  if jsonb_typeof(p -> 'bucket') is distinct from 'string' then
    raise exception 'Campo bucket é obrigatório.' using errcode = '22023';
  end if;
  v_bucket := btrim(p ->> 'bucket', E' \t\n\r');
  if not (
    (v_tipo = 'balancete' and v_bucket = 'balancete-pdfs')
    or (v_tipo = 'plano' and v_bucket = 'plano-trabalho-docs')
  ) then
    raise exception 'Bucket incompatível com o tipo do documento.' using errcode = '22023';
  end if;

  -- caminho (deve começar por <project_id>/)
  if jsonb_typeof(p -> 'caminho') is distinct from 'string' then
    raise exception 'Campo caminho é obrigatório.' using errcode = '22023';
  end if;
  v_caminho := p ->> 'caminho';
  if btrim(v_caminho, E' \t\n\r') <> v_caminho
     or split_part(v_caminho, '/', 1) is distinct from v_project_id::text
     or nullif(substr(v_caminho, length(v_project_id::text) + 2), '') is null
     or position('\' in v_caminho) > 0
     or v_caminho ~ '(^|/)\.\.(/|$)' then
    raise exception 'Campo caminho deve começar com <project_id>/ e conter o nome do arquivo.'
      using errcode = '22023';
  end if;

  -- arquivo_nome
  if p ? 'arquivo_nome' and jsonb_typeof(p -> 'arquivo_nome') not in ('string', 'null') then
    raise exception 'Campo arquivo_nome deve ser texto ou nulo.' using errcode = '22023';
  end if;
  v_arquivo_nome := case
    when jsonb_typeof(p -> 'arquivo_nome') = 'string' then nullif(btrim(p ->> 'arquivo_nome', E' \t\n\r'), '')
    else null
  end;

  -- formato e paginas
  if jsonb_typeof(p -> 'formato') is distinct from 'string' then
    raise exception 'Campo formato é obrigatório.' using errcode = '22023';
  end if;
  v_formato := lower(btrim(p ->> 'formato', E' \t\n\r'));
  if v_formato not in ('pdf', 'docx') then
    raise exception 'Campo formato inválido.' using errcode = '22023';
  end if;
  if v_tipo = 'balancete' and v_formato <> 'pdf' then
    raise exception 'Documento do tipo balancete exige formato pdf.' using errcode = '22023';
  end if;

  if v_formato = 'docx' then
    if p ? 'paginas' and jsonb_typeof(p -> 'paginas') <> 'null' then
      raise exception 'Documento docx deve ter paginas nulo.' using errcode = '22023';
    end if;
    v_paginas := null;
  else
    if not (p ? 'paginas') or jsonb_typeof(p -> 'paginas') = 'null' then
      v_paginas := null;
    elsif jsonb_typeof(p -> 'paginas') = 'number' then
      v_paginas_num := (p ->> 'paginas')::numeric;
      if v_paginas_num <> trunc(v_paginas_num) or v_paginas_num < 1 then
        raise exception 'Campo paginas deve ser inteiro >= 1.' using errcode = '22023';
      end if;
      v_paginas := v_paginas_num::integer;
    else
      raise exception 'Campo paginas inválido.' using errcode = '22023';
    end if;
  end if;

  -- parser, parser_versao, origem
  if jsonb_typeof(p -> 'parser') is distinct from 'string' then
    raise exception 'Campo parser é obrigatório.' using errcode = '22023';
  end if;
  v_parser := nullif(btrim(p ->> 'parser', E' \t\n\r'), '');
  if v_parser is null then
    raise exception 'Campo parser não pode ser vazio.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'parser_versao') is distinct from 'string' then
    raise exception 'Campo parser_versao é obrigatório.' using errcode = '22023';
  end if;
  v_parser_versao := nullif(btrim(p ->> 'parser_versao', E' \t\n\r'), '');
  if v_parser_versao is null then
    raise exception 'Campo parser_versao não pode ser vazio.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'origem') is distinct from 'string' then
    raise exception 'Campo origem é obrigatório.' using errcode = '22023';
  end if;
  v_origem := btrim(p ->> 'origem', E' \t\n\r');
  if v_origem not in ('backfill', 'site', 'ingestao') then
    raise exception 'Campo origem inválido.' using errcode = '22023';
  end if;

  -- fatos
  if not (p ? 'fatos') or jsonb_typeof(p -> 'fatos') = 'null' then
    v_fatos_arr := '[]'::jsonb;
  elsif jsonb_typeof(p -> 'fatos') = 'array' then
    v_fatos_arr := p -> 'fatos';
  else
    raise exception 'Campo fatos deve ser um array JSON.' using errcode = '22023';
  end if;

  -- Valida forma de cada fato e checa CPF antes de gravar qualquer coisa
  for v_f in
    select el.elem, el.ord
      from jsonb_array_elements(v_fatos_arr) with ordinality as el(elem, ord)
  loop
    if jsonb_typeof(v_f.elem) <> 'object' then
      raise exception 'Cada fato deve ser um objeto JSON.' using errcode = '22023';
    end if;

    select string_agg(k, ', ' order by k)
      into v_f_chaves_inv
      from jsonb_object_keys(v_f.elem) as k
     where k not in ('alvo_tabela', 'alvo_id', 'campo', 'valor', 'pagina', 'trecho', 'bbox');

    if v_f_chaves_inv is not null then
      raise exception 'Campos não permitidos em fato: %', v_f_chaves_inv using errcode = '22023';
    end if;

    if jsonb_typeof(v_f.elem -> 'alvo_tabela') is distinct from 'string'
       or jsonb_typeof(v_f.elem -> 'campo') is distinct from 'string' then
      raise exception 'Campos alvo_tabela e campo são obrigatórios em cada fato.' using errcode = '22023';
    end if;

    v_f_tabela := btrim(v_f.elem ->> 'alvo_tabela', E' \t\n\r');
    v_f_campo  := btrim(v_f.elem ->> 'campo', E' \t\n\r');

    if not (
      (v_tipo = 'balancete' and v_f_tabela in ('balancetes', 'balancete_lancamentos'))
      or (v_tipo = 'plano' and v_f_tabela in ('planos_trabalho', 'plano_rubricas', 'plano_desembolsos'))
    ) then
      raise exception 'Tabela alvo % incompatível com documento do tipo %.', v_f_tabela, v_tipo
        using errcode = '22023';
    end if;

    if not (
      (v_f_tabela = 'balancetes'            and v_f_campo in ('saldo_disponivel', 'rendimento_liquido', 'total_debitos', 'total_creditos'))
      or (v_f_tabela = 'balancete_lancamentos' and v_f_campo in ('saldo_atual', 'valor_debito', 'valor_credito'))
      or (v_f_tabela = 'planos_trabalho'       and v_f_campo in ('valor_total_plano'))
      or (v_f_tabela = 'plano_rubricas'        and v_f_campo in ('valor_previsto'))
      or (v_f_tabela = 'plano_desembolsos'     and v_f_campo in ('valor'))
    ) then
      raise exception 'Campo % não é aceito para a tabela %.', v_f_campo, v_f_tabela
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_f.elem -> 'alvo_id') is distinct from 'string' then
      raise exception 'Campo alvo_id é obrigatório em cada fato.' using errcode = '22023';
    end if;
    v_f_id_txt := nullif(btrim(v_f.elem ->> 'alvo_id', E' \t\n\r'), '');
    if v_f_id_txt is null
       or v_f_id_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Campo alvo_id inválido em fato.' using errcode = '22023';
    end if;

    if jsonb_typeof(v_f.elem -> 'valor') is distinct from 'number' then
      raise exception 'Campo valor do fato deve ser numérico.' using errcode = '22023';
    end if;

    if jsonb_typeof(v_f.elem -> 'trecho') is distinct from 'string' then
      raise exception 'Campo trecho é obrigatório em cada fato.' using errcode = '22023';
    end if;
    v_f_trecho := v_f.elem ->> 'trecho';
    if char_length(v_f_trecho) < 1 or char_length(v_f_trecho) > 500
       or btrim(v_f_trecho, E' \t\n\r') = '' then
      raise exception 'Campo trecho do fato deve ter entre 1 e 500 caracteres não vazios.'
        using errcode = '22023';
    end if;

    if public._tem_cpf(v_f_trecho) then
      raise exception 'Trecho do fato contém CPF e não pode ser gravado.' using errcode = '22023';
    end if;

    if v_formato = 'docx' then
      if v_f.elem ? 'pagina' and jsonb_typeof(v_f.elem -> 'pagina') <> 'null' then
        raise exception 'Fato de documento docx exige pagina nula.' using errcode = '22023';
      end if;
      if v_f.elem ? 'bbox' and jsonb_typeof(v_f.elem -> 'bbox') <> 'null' then
        raise exception 'Fato de documento docx exige bbox nulo.' using errcode = '22023';
      end if;
    else
      if v_f.elem ? 'pagina' and jsonb_typeof(v_f.elem -> 'pagina') <> 'null' then
        if jsonb_typeof(v_f.elem -> 'pagina') <> 'number' then
          raise exception 'Campo pagina do fato deve ser inteiro >= 1.' using errcode = '22023';
        end if;
        v_f_pag_num := (v_f.elem ->> 'pagina')::numeric;
        if v_f_pag_num <> trunc(v_f_pag_num) or v_f_pag_num < 1 then
          raise exception 'Campo pagina do fato deve ser inteiro >= 1.' using errcode = '22023';
        end if;
      end if;

      if v_f.elem ? 'bbox' and jsonb_typeof(v_f.elem -> 'bbox') <> 'null' then
        v_f_bbox := v_f.elem -> 'bbox';
        if jsonb_typeof(v_f_bbox) <> 'object'
           or not (v_f_bbox ?& array['x0', 'x1', 'yMin', 'yMax'])
           or (v_f_bbox - array['x0', 'x1', 'yMin', 'yMax']) <> '{}'::jsonb
           or jsonb_typeof(v_f_bbox -> 'x0') <> 'number'
           or jsonb_typeof(v_f_bbox -> 'x1') <> 'number'
           or jsonb_typeof(v_f_bbox -> 'yMin') <> 'number'
           or jsonb_typeof(v_f_bbox -> 'yMax') <> 'number'
           or (v_f_bbox ->> 'x0')::numeric > (v_f_bbox ->> 'x1')::numeric
           or (v_f_bbox ->> 'yMin')::numeric > (v_f_bbox ->> 'yMax')::numeric then
          raise exception 'Campo bbox inválido em fato.' using errcode = '22023';
        end if;
      end if;
    end if;
  end loop;

  -- CPF em titulo, arquivo_nome ou partido entre múltiplos trechos
  if public._tem_cpf(v_titulo)
     or (v_arquivo_nome is not null and public._tem_cpf(v_arquivo_nome)) then
    raise exception 'Metadados do documento contêm CPF e não podem ser gravados.' using errcode = '22023';
  end if;

  select string_agg(el.elem ->> 'trecho', ' ' order by el.ord)
    into v_trechos_cat
    from jsonb_array_elements(v_fatos_arr) with ordinality as el(elem, ord);

  if public._tem_cpf(concat_ws(' ', v_titulo, v_arquivo_nome, v_trechos_cat)) then
    raise exception 'Conteúdo do documento contém CPF e não pode ser gravado.' using errcode = '22023';
  end if;

  -- 1. Upsert de documentos por chave (mesmo project_id e tipo, senão erro)
  select d.id, d.project_id, d.tipo
    into v_doc_id, v_doc_proj, v_doc_tipo
    from public.documentos d
   where d.chave = v_chave
     for update;

  if not found then
    insert into public.documentos (project_id, tipo, chave, titulo)
    values (v_project_id, v_tipo, v_chave, v_titulo)
    on conflict (chave) do nothing
    returning id into v_doc_id;

    if v_doc_id is null then
      select d.id, d.project_id, d.tipo
        into v_doc_id, v_doc_proj, v_doc_tipo
        from public.documentos d
       where d.chave = v_chave
         for update;
    else
      v_doc_proj := v_project_id;
      v_doc_tipo := v_tipo;
    end if;
  end if;

  if v_doc_proj is distinct from v_project_id or v_doc_tipo is distinct from v_tipo then
    raise exception 'Conflito de chave: documento existente pertence a outro projeto ou tipo.'
      using errcode = '22023';
  end if;

  -- 2. Deduplicação por sha256 dentro do documento
  select dv.id, dv.versao
    into v_versao_id, v_versao
    from public.documento_versoes dv
   where dv.documento_id = v_doc_id
     and dv.sha256 = v_sha256;

  if found then
    return jsonb_build_object(
      'documento_id', v_doc_id,
      'versao_id',    v_versao_id,
      'versao',       v_versao,
      'criada',       false,
      'fatos',        0
    );
  end if;

  -- Nova versão
  select coalesce(max(dv.versao), 0) + 1
    into v_versao
    from public.documento_versoes dv
   where dv.documento_id = v_doc_id;

  insert into public.documento_versoes (
    documento_id, versao, sha256, bucket, caminho, arquivo_nome,
    formato, paginas, parser, parser_versao, origem, registrado_por
  ) values (
    v_doc_id, v_versao, v_sha256, v_bucket, v_caminho, v_arquivo_nome,
    v_formato, v_paginas, v_parser, v_parser_versao, v_origem, auth.uid()
  )
  returning id into v_versao_id;

  -- 3. Conferência de existência, projeto e valor vigente + gravação dos fatos
  for v_f in
    select el.elem, el.ord
      from jsonb_array_elements(v_fatos_arr) with ordinality as el(elem, ord)
  loop
    v_f_tabela := btrim(v_f.elem ->> 'alvo_tabela', E' \t\n\r');
    v_f_id     := btrim(v_f.elem ->> 'alvo_id', E' \t\n\r')::uuid;
    v_f_campo  := btrim(v_f.elem ->> 'campo', E' \t\n\r');
    v_f_valor  := round((v_f.elem ->> 'valor')::numeric, 2);
    v_f_pagina := case
                    when v_formato = 'docx' then null
                    when v_f.elem ? 'pagina' and jsonb_typeof(v_f.elem -> 'pagina') = 'number'
                      then (v_f.elem ->> 'pagina')::integer
                    else null
                  end;
    v_f_trecho := v_f.elem ->> 'trecho';
    v_f_bbox   := case
                    when v_formato = 'docx' then null
                    when v_f.elem ? 'bbox' and jsonb_typeof(v_f.elem -> 'bbox') = 'object'
                      then v_f.elem -> 'bbox'
                    else null
                  end;

    v_alvo_proj   := null;
    v_alvo_pai_id := null;
    v_alvo_chave  := null;
    v_atual       := null;

    if v_f_tabela = 'balancetes' then
      select b.project_id,
             b.id,
             '',
             case v_f_campo
               when 'saldo_disponivel'   then b.saldo_disponivel
               when 'rendimento_liquido' then b.rendimento_liquido
               when 'total_debitos'      then b.total_debitos
               when 'total_creditos'     then b.total_creditos
             end
        into v_alvo_proj, v_alvo_pai_id, v_alvo_chave, v_atual
        from public.balancetes b
       where b.id = v_f_id;
    elsif v_f_tabela = 'balancete_lancamentos' then
      select b.project_id,
             bl.balancete_id,
             bl.conta_codigo,
             case v_f_campo
               when 'saldo_atual'   then bl.saldo_atual
               when 'valor_debito'  then bl.valor_debito
               when 'valor_credito' then bl.valor_credito
             end
        into v_alvo_proj, v_alvo_pai_id, v_alvo_chave, v_atual
        from public.balancete_lancamentos bl
        join public.balancetes b on b.id = bl.balancete_id
       where bl.id = v_f_id;
    elsif v_f_tabela = 'planos_trabalho' then
      select pt.project_id, pt.id, '', pt.valor_total_plano
        into v_alvo_proj, v_alvo_pai_id, v_alvo_chave, v_atual
        from public.planos_trabalho pt
       where pt.id = v_f_id;
    elsif v_f_tabela = 'plano_rubricas' then
      select pt.project_id,
             pr.plano_id,
             pr.rubrica_code || '|' || coalesce(pr.descricao_livre, ''),
             pr.valor_previsto
        into v_alvo_proj, v_alvo_pai_id, v_alvo_chave, v_atual
        from public.plano_rubricas pr
        join public.planos_trabalho pt on pt.id = pr.plano_id
       where pr.id = v_f_id;
    elsif v_f_tabela = 'plano_desembolsos' then
      select pt.project_id, pd.plano_id, pd.parcela::text, pd.valor
        into v_alvo_proj, v_alvo_pai_id, v_alvo_chave, v_atual
        from public.plano_desembolsos pd
        join public.planos_trabalho pt on pt.id = pd.plano_id
       where pd.id = v_f_id;
    end if;

    if not found then
      raise exception 'Alvo não encontrado: %.%', v_f_tabela, v_f_id using errcode = '22023';
    end if;

    if v_alvo_proj is distinct from v_project_id then
      raise exception 'Alvo %.% pertence a outro centro de custo.', v_f_tabela, v_f_id
        using errcode = '22023';
    end if;

    if v_atual is null or v_atual is distinct from v_f_valor then
      v_divergencias := v_divergencias || jsonb_build_array(jsonb_build_object(
        'tabela',   v_f_tabela,
        'id',       v_f_id,
        'campo',    v_f_campo,
        'esperado', v_atual,
        'lido',     v_f_valor
      ));
      continue;
    end if;

    begin
      insert into public.fatos (
        versao_id, alvo_tabela, alvo_pai_id, alvo_chave, campo,
        valor, pagina, trecho, bbox
      ) values (
        v_versao_id, v_f_tabela, v_alvo_pai_id, v_alvo_chave, v_f_campo,
        v_f_valor, v_f_pagina, v_f_trecho, v_f_bbox
      );
    exception when unique_violation then
      raise exception 'Fato duplicado no payload para % (%) campo %.', v_f_tabela, v_f_id, v_f_campo
        using errcode = '22023';
    end;

    v_qtd_fatos := v_qtd_fatos + 1;
  end loop;

  if jsonb_array_length(v_divergencias) > 0 then
    raise exception 'Fatos divergem dos valores gravados no banco (% divergência(s)).',
      jsonb_array_length(v_divergencias)
      using errcode = '22023', detail = v_divergencias::text;
  end if;

  return jsonb_build_object(
    'documento_id', v_doc_id,
    'versao_id',    v_versao_id,
    'versao',       v_versao,
    'criada',       true,
    'fatos',        v_qtd_fatos
  );
end;
$$;

comment on function public.registrar_documento_v2(jsonb) is
  'Registra documento, versão (dedup por sha256) e fatos numéricos conferidos ao centavo contra o estado atual do banco, traduzindo alvo_id para chave estável e bloqueando CPF (só admin, mig. 064).';

revoke all on function public.registrar_documento_v2(jsonb) from public, anon;
grant execute on function public.registrar_documento_v2(jsonb) to authenticated;

-- 5.2 get_origem_v2(p_alvo_tabela text, p_alvo_id uuid, p_campo text)
create or replace function public.get_origem_v2(
  p_alvo_tabela text,
  p_alvo_id     uuid,
  p_campo       text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tabela     text;
  v_campo      text;
  v_project_id uuid;
  v_res        jsonb;
begin
  if p_alvo_tabela is null or p_alvo_id is null or p_campo is null then
    raise exception 'alvo_tabela, alvo_id e campo são obrigatórios.' using errcode = '22023';
  end if;

  v_tabela := btrim(p_alvo_tabela, E' \t\n\r');
  v_campo  := btrim(p_campo, E' \t\n\r');

  if not (
    (v_tabela = 'balancetes'            and v_campo in ('saldo_disponivel', 'rendimento_liquido', 'total_debitos', 'total_creditos'))
    or (v_tabela = 'balancete_lancamentos' and v_campo in ('saldo_atual', 'valor_debito', 'valor_credito'))
    or (v_tabela = 'planos_trabalho'       and v_campo in ('valor_total_plano'))
    or (v_tabela = 'plano_rubricas'        and v_campo in ('valor_previsto'))
    or (v_tabela = 'plano_desembolsos'     and v_campo in ('valor'))
    or (v_tabela = 'scholarships'          and v_campo in ('amount'))
  ) then
    raise exception 'Alvo ou campo não suportado em get_origem_v2.' using errcode = '22023';
  end if;

  if v_tabela = 'balancetes' then
    select b.project_id into v_project_id from public.balancetes b where b.id = p_alvo_id;
  elsif v_tabela = 'balancete_lancamentos' then
    select b.project_id into v_project_id
      from public.balancete_lancamentos bl
      join public.balancetes b on b.id = bl.balancete_id
     where bl.id = p_alvo_id;
  elsif v_tabela = 'planos_trabalho' then
    select pt.project_id into v_project_id from public.planos_trabalho pt where pt.id = p_alvo_id;
  elsif v_tabela = 'plano_rubricas' then
    select pt.project_id into v_project_id
      from public.plano_rubricas pr
      join public.planos_trabalho pt on pt.id = pr.plano_id
     where pr.id = p_alvo_id;
  elsif v_tabela = 'plano_desembolsos' then
    select pt.project_id into v_project_id
      from public.plano_desembolsos pd
      join public.planos_trabalho pt on pt.id = pd.plano_id
     where pd.id = p_alvo_id;
  elsif v_tabela = 'scholarships' then
    select s.project_id into v_project_id from public.scholarships s where s.id = p_alvo_id;
  end if;

  if not found or v_project_id is null then
    if public.is_admin() then
      raise exception 'Alvo não encontrado.' using errcode = 'P0002';
    end if;
    raise exception 'Acesso negado ao alvo.' using errcode = '42501';
  end if;

  perform public.assert_project_allowed(v_project_id);

  v_res := public._resolver_origem_alvo(v_tabela, p_alvo_id, v_campo, not public.is_admin());
  if v_res is null then
    raise exception 'Alvo não encontrado.' using errcode = 'P0002';
  end if;

  return v_res;
end;
$$;

comment on function public.get_origem_v2(text, uuid, text) is
  'Devolve a origem de um valor (documento, legado com busca ou digitado), com assert_project_allowed e máscara de CPF no trecho para não-admin (mig. 064).';

revoke all on function public.get_origem_v2(text, uuid, text) from public, anon;
grant execute on function public.get_origem_v2(text, uuid, text) to authenticated;

-- 5.3 explicar_livre_v2(p_project_id uuid)
create or replace function public.explicar_livre_v2(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_sl            jsonb;
  v_has_plano     boolean;
  v_has_balancete boolean;
  v_data_ref      text;
  v_balancete_id  uuid;
  v_plano_id      uuid;
  v_grupos        jsonb;
  v_rubricas      jsonb;
  v_bolsas        jsonb;
  v_livre_total   numeric;
  v_partes_grupos jsonb := '[]'::jsonb;

  v_g             jsonb;
  v_g_code        text;
  v_g_name        text;
  v_g_saldo       numeric;
  v_g_cob         text;
  v_g_partes      jsonb;

  v_r             jsonb;
  v_r_code        text;
  v_r_name        text;
  v_r_prev        numeric;
  v_r_real        numeric;
  v_r_comp        numeric;

  v_prev_folhas   jsonb;
  v_real_folhas   jsonb;
  v_comp_folhas   jsonb;
begin
  if p_project_id is null then
    raise exception 'project_id é obrigatório.' using errcode = '22023';
  end if;

  perform public.assert_project_allowed(p_project_id);

  v_sl := public.get_saldo_livre(p_project_id);

  v_has_plano     := coalesce((v_sl ->> 'has_plano')::boolean, false);
  v_has_balancete := coalesce((v_sl ->> 'has_balancete')::boolean, false);
  v_data_ref      := nullif(v_sl ->> 'data_referencia', '');

  if not v_has_plano then
    return jsonb_build_object(
      'valor',           null,
      'motivo',          'sem plano',
      'data_referencia', null,
      'rotulo',          'Livre para gastar',
      'tipo',            'calculo',
      'conta',           'soma dos grupos',
      'chave',           'livre',
      'sinal',           1,
      'ref',             null,
      'nota',            null,
      'partes',          '[]'::jsonb
    );
  end if;

  if not v_has_balancete then
    return jsonb_build_object(
      'valor',           null,
      'motivo',          'sem balancete',
      'data_referencia', null,
      'rotulo',          'Livre para gastar',
      'tipo',            'calculo',
      'conta',           'soma dos grupos',
      'chave',           'livre',
      'sinal',           1,
      'ref',             null,
      'nota',            null,
      'partes',          '[]'::jsonb
    );
  end if;

  v_grupos := coalesce(v_sl -> 'grupos', '[]'::jsonb);
  if jsonb_typeof(v_grupos) <> 'array' or jsonb_array_length(v_grupos) = 0 then
    return jsonb_build_object(
      'valor',           null,
      'motivo',          'sem números',
      'data_referencia', v_data_ref,
      'rotulo',          'Livre para gastar',
      'tipo',            'calculo',
      'conta',           'soma dos grupos',
      'chave',           'livre',
      'sinal',           1,
      'ref',             null,
      'nota',            null,
      'partes',          '[]'::jsonb
    );
  end if;

  v_balancete_id := nullif(v_sl ->> 'balancete_id', '')::uuid;
  v_rubricas     := coalesce(v_sl -> 'rubricas', '[]'::jsonb);
  v_bolsas       := coalesce(v_sl -> 'bolsas_ativas', '[]'::jsonb);

  select pt.id
    into v_plano_id
    from public.planos_trabalho pt
   where pt.project_id = p_project_id
     and pt.ativo = true
   order by pt.versao desc
   limit 1;

  for v_g in select value from jsonb_array_elements(v_grupos) loop
    v_g_code   := v_g ->> 'grupo_code';
    v_g_name   := v_g ->> 'grupo_name';
    v_g_saldo  := (v_g ->> 'saldo_livre')::numeric;
    v_g_cob    := v_g ->> 'compromissos_cobertura';
    v_g_partes := '[]'::jsonb;

    for v_r in
      select value
        from jsonb_array_elements(v_rubricas)
       where value ->> 'grupo_code' = v_g_code
    loop
      v_r_code := v_r ->> 'rubrica_code';
      v_r_name := v_r ->> 'rubrica_name';
      v_r_prev := coalesce((v_r ->> 'previsto')::numeric, 0);
      v_r_real := coalesce((v_r ->> 'realizado')::numeric, 0);
      v_r_comp := coalesce((v_r ->> 'compromissos')::numeric, 0);

      -- Previsto da rubrica
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'rotulo', coalesce(nullif(btrim(pr.descricao_livre, E' \t\n\r"'), ''), v_r_name),
          'valor',  pr.valor_previsto,
          'tipo',   coalesce(
                      public._resolver_origem_alvo('plano_rubricas', pr.id, 'valor_previsto', false) ->> 'tipo',
                      'legado'
                    ),
          'chave',  'linha:' || pr.id::text,
          'conta',  null,
          'sinal',  1,
          'ref',    jsonb_build_object(
                      'alvo_tabela', 'plano_rubricas',
                      'alvo_id',     pr.id,
                      'campo',       'valor_previsto'
                    ),
          'nota',   null,
          'partes', '[]'::jsonb
        )
        order by pr.valor_previsto desc, pr.descricao_livre nulls last, pr.id
      ), '[]'::jsonb)
        into v_prev_folhas
        from public.plano_rubricas pr
       where pr.plano_id = v_plano_id
         and pr.rubrica_code = v_r_code
         and pr.valor_previsto <> 0;

      if v_r_prev <> 0 or jsonb_array_length(v_prev_folhas) > 0 then
        v_g_partes := v_g_partes || jsonb_build_array(jsonb_build_object(
          'rotulo', 'Previsto — ' || v_r_name,
          'valor',  v_r_prev,
          'tipo',   'calculo',
          'chave',  'rubrica:' || v_r_code || ':previsto',
          'conta',  'soma das linhas do plano',
          'sinal',  1,
          'ref',    null,
          'nota',   null,
          'partes', v_prev_folhas
        ));
      end if;

      -- Realizado da rubrica
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'rotulo', case
                      when nullif(btrim(bl.conta_descricao, E' \t\n\r'), '') is not null
                        then bl.conta_codigo || ' — ' || btrim(bl.conta_descricao, E' \t\n\r')
                      else bl.conta_codigo
                    end,
          'valor',  bl.saldo_atual,
          'tipo',   coalesce(
                      public._resolver_origem_alvo('balancete_lancamentos', bl.id, 'saldo_atual', false) ->> 'tipo',
                      'legado'
                    ),
          'chave',  'linha:' || bl.id::text,
          'conta',  null,
          'sinal',  1,
          'ref',    jsonb_build_object(
                      'alvo_tabela', 'balancete_lancamentos',
                      'alvo_id',     bl.id,
                      'campo',       'saldo_atual'
                    ),
          'nota',   null,
          'partes', '[]'::jsonb
        )
        order by bl.saldo_atual desc, bl.conta_codigo, bl.id
      ), '[]'::jsonb)
        into v_real_folhas
        from public.balancete_lancamentos bl
       where bl.balancete_id = v_balancete_id
         and bl.rubrica_code = v_r_code
         and bl.saldo_atual <> 0;

      if v_r_real <> 0 or jsonb_array_length(v_real_folhas) > 0 then
        v_g_partes := v_g_partes || jsonb_build_array(jsonb_build_object(
          'rotulo', 'Realizado — ' || v_r_name,
          'valor',  v_r_real,
          'tipo',   'calculo',
          'chave',  'rubrica:' || v_r_code || ':realizado',
          'conta',  'soma das contas do balancete',
          'sinal',  -1,
          'ref',    null,
          'nota',   null,
          'partes', v_real_folhas
        ));
      end if;

      -- Comprometido (bolsas ativas na janela)
      if v_r_code = 'a.bolsas' then
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'rotulo', (b.elem ->> 'bolsista')
                      || ' — '
                      || (b.elem ->> 'meses')
                      || case when (b.elem ->> 'meses')::integer = 1 then ' mês' else ' meses' end
                      || ' × R$ '
                      || public._fmt_brl_num((b.elem ->> 'valor_mensal')::numeric),
            'valor',  (b.elem ->> 'compromisso')::numeric,
            'tipo',   coalesce(
                        public._resolver_origem_alvo(
                          'scholarships',
                          (b.elem ->> 'scholarship_id')::uuid,
                          'amount',
                          false
                        ) ->> 'tipo',
                        'digitado'
                      ),
            'chave',  'linha:' || (b.elem ->> 'scholarship_id'),
            'conta',  null,
            'sinal',  1,
            'ref',    jsonb_build_object(
                        'alvo_tabela', 'scholarships',
                        'alvo_id',     (b.elem ->> 'scholarship_id')::uuid,
                        'campo',       'amount'
                      ),
            'nota',   null,
            'partes', '[]'::jsonb
          )
          order by (b.elem ->> 'compromisso')::numeric desc, b.ord
        ), '[]'::jsonb)
          into v_comp_folhas
          from jsonb_array_elements(v_bolsas) with ordinality as b(elem, ord)
         where coalesce((b.elem ->> 'compromisso')::numeric, 0) <> 0;

        if v_r_comp <> 0 or jsonb_array_length(v_comp_folhas) > 0 then
          v_g_partes := v_g_partes || jsonb_build_array(jsonb_build_object(
            'rotulo', 'Comprometido — ' || v_r_name,
            'valor',  v_r_comp,
            'tipo',   'calculo',
            'chave',  'rubrica:' || v_r_code || ':comprometido',
            'conta',  'soma das bolsas na janela',
            'sinal',  -1,
            'ref',    null,
            'nota',   null,
            'partes', v_comp_folhas
          ));
        end if;
      end if;
    end loop;

    v_partes_grupos := v_partes_grupos || jsonb_build_array(jsonb_build_object(
      'rotulo', v_g_name,
      'valor',  v_g_saldo,
      'tipo',   'calculo',
      'chave',  'grupo:' || v_g_code,
      'conta',  case
                  when v_g_cob = 'bolsas' then 'previsto − realizado − comprometido'
                  else 'previsto − realizado'
                end,
      'sinal',  1,
      'ref',    null,
      'nota',   case
                  when v_g_cob = 'nenhuma' then 'compromissos fora de bolsas não são rastreados'
                  else null
                end,
      'partes', v_g_partes
    ));
  end loop;

  select sum((g ->> 'saldo_livre')::numeric)
    into v_livre_total
    from jsonb_array_elements(v_grupos) as g
   where g ->> 'saldo_livre' is not null;

  return jsonb_build_object(
    'valor',           v_livre_total,
    'motivo',          null,
    'data_referencia', v_data_ref,
    'rotulo',          'Livre para gastar',
    'tipo',            'calculo',
    'conta',           'soma dos grupos',
    'chave',           'livre',
    'sinal',           1,
    'ref',             null,
    'nota',            null,
    'partes',          v_partes_grupos
  );
end;
$$;

comment on function public.explicar_livre_v2(uuid) is
  'Monta a árvore completa do saldo livre por centro a partir de get_saldo_livre, fechando ao centavo em cada nó de cálculo (mig. 064).';

revoke all on function public.explicar_livre_v2(uuid) from public, anon;
grant execute on function public.explicar_livre_v2(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. Pendências (achados da revisão max da 063)
-- ------------------------------------------------------------

alter table public.pendencias drop constraint if exists pendencias_chave_nao_vazia;
alter table public.pendencias
  add constraint pendencias_chave_nao_vazia
  check (btrim(chave, E' \t\n\r') <> '');

alter table public.pendencias drop constraint if exists pendencias_titulo_nao_vazio;
alter table public.pendencias
  add constraint pendencias_titulo_nao_vazio
  check (btrim(titulo, E' \t\n\r') <> '');

create index if not exists idx_pendencias_resolvida_por
  on public.pendencias (resolvida_por);

create or replace function public._pendencias_sem_cpf()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_texto text;
begin
  v_texto := concat_ws(
    ' ',
    case when tg_op = 'INSERT' or new.chave   is distinct from old.chave   then new.chave end,
    case when tg_op = 'INSERT' or new.titulo  is distinct from old.titulo  then new.titulo end,
    case when tg_op = 'INSERT' or new.detalhe is distinct from old.detalhe then new.detalhe::text end
  );

  if v_texto <> '' and public._tem_cpf(v_texto) then
    raise exception 'Pendência com CPF não pode ser gravada.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public._pendencias_sem_cpf() from public, anon, authenticated;

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
  v_ex_id            uuid;
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
  v_chave := nullif(btrim(p ->> 'chave', E' \t\n\r'), '');
  if v_chave is null then
    raise exception 'Campo chave não pode ser vazio.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'tipo') is distinct from 'string' then
    raise exception 'Campo tipo é obrigatório.' using errcode = '22023';
  end if;
  v_tipo := nullif(btrim(p ->> 'tipo', E' \t\n\r'), '');
  if v_tipo is null or v_tipo not in ('balancete', 'plano', 'bolsas', 'contrato', 'cadastro', 'outro') then
    raise exception 'Tipo de pendência inválido.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'titulo') is distinct from 'string' then
    raise exception 'Campo titulo é obrigatório.' using errcode = '22023';
  end if;
  v_titulo := nullif(btrim(p ->> 'titulo', E' \t\n\r'), '');
  if v_titulo is null then
    raise exception 'Campo titulo não pode ser vazio.' using errcode = '22023';
  end if;

  if p ? 'origem' and jsonb_typeof(p -> 'origem') not in ('string', 'null') then
    raise exception 'Campo origem deve ser texto.' using errcode = '22023';
  end if;
  v_origem := coalesce(nullif(btrim(p ->> 'origem', E' \t\n\r'), ''), 'sistema');
  if v_origem not in ('sistema', 'buriti', 'claude', 'pessoa') then
    raise exception 'Origem de pendência inválida.' using errcode = '22023';
  end if;

  v_project_id := null;
  if p ? 'project_id' and jsonb_typeof(p -> 'project_id') <> 'null' then
    if jsonb_typeof(p -> 'project_id') <> 'string' then
      raise exception 'Campo project_id deve ser UUID ou nulo.' using errcode = '22023';
    end if;
    v_project_id_txt := nullif(btrim(p ->> 'project_id', E' \t\n\r'), '');
    if v_project_id_txt is null then
      raise exception 'Campo project_id não pode ser vazio; use null para pendência geral.'
        using errcode = '22023';
    end if;
    if v_project_id_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Campo project_id inválido.' using errcode = '22023';
    end if;
    begin
      v_project_id := v_project_id_txt::uuid;
    exception when invalid_text_representation then
      raise exception 'Campo project_id inválido.' using errcode = '22023';
    end;
  end if;

  if p ? 'detalhe' and jsonb_typeof(p -> 'detalhe') not in ('object', 'null') then
    raise exception 'Campo detalhe deve ser um objeto JSON.' using errcode = '22023';
  end if;
  v_detalhe := case
    when not (p ? 'detalhe') or jsonb_typeof(p -> 'detalhe') = 'null' then '{}'::jsonb
    else p -> 'detalhe'
  end;

  if public._tem_cpf(v_chave || ' ' || v_titulo || ' ' || v_detalhe::text) then
    raise exception 'Pendência contém sequência no formato de CPF e não pode ser gravada.'
      using errcode = '22023';
  end if;

  -- Se já existe pela chave, mantém idempotência mesmo que o centro tenha sido inativado.
  select pe.id, pe.chave, pe.situacao, pe.project_id, pe.tipo
    into v_ex_id, v_chave_ret, v_situacao, v_ex_project_id, v_ex_tipo
    from public.pendencias pe
   where pe.chave = v_chave
     for update;

  if found then
    if v_ex_project_id is distinct from v_project_id or v_ex_tipo is distinct from v_tipo then
      raise exception 'Conflito de chave: já existe pendência com esta chave para outro centro ou tipo.'
        using errcode = '22023';
    end if;

    if v_situacao = 'aberta' then
      update public.pendencias
         set titulo  = v_titulo,
             detalhe = v_detalhe
       where id = v_ex_id;
    end if;

    return jsonb_build_object(
      'id',       v_ex_id,
      'chave',    v_chave_ret,
      'situacao', v_situacao,
      'criada',   false
    );
  end if;

  if v_project_id is not null and not exists (
    select 1 from public.projects pr where pr.id = v_project_id and pr.active = true
  ) then
    raise exception 'Projeto não encontrado ou inativo.' using errcode = '22023';
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
  'Cria pendência idempotente por chave (só admin). Recusa project_id vazio, valida CPF com _tem_cpf e só recusa centro inativo quando a pendência é nova (migs. 063/064).';

revoke all on function public.criar_pendencia_v2(jsonb) from public, anon;
grant execute on function public.criar_pendencia_v2(jsonb) to authenticated;

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

  if p_id is null then
    raise exception 'p_id é obrigatório.' using errcode = '22023';
  end if;

  if p_situacao is null or p_situacao not in ('resolvida', 'descartada') then
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
  'Resolve ou descarta pendência aberta (admin ou professor do centro). Erro próprio para p_id nulo (migs. 063/064).';

revoke all on function public.resolver_pendencia_v2(uuid, text) from public, anon;
grant execute on function public.resolver_pendencia_v2(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 7. Asserções dentro da transação
-- ------------------------------------------------------------
do $$
declare
  v_doc    oid := 'public.documentos'::regclass;
  v_ver    oid := 'public.documento_versoes'::regclass;
  v_fat    oid := 'public.fatos'::regclass;
  v_pend   oid := 'public.pendencias'::regclass;
  v_tbl    oid;
  v_tname  text;
  v_pol    text;
  v_fn_sig text;
  v_fn     oid;
  v_cols   text;
begin
  -- RLS, 1 policy SELECT só, ACL exata e trg_bloqueia_agente ativo nas 4 tabelas
  for v_tname, v_pol in
    select * from (values
      ('documentos',        'documentos_select_escopo'),
      ('documento_versoes', 'documento_versoes_select_escopo'),
      ('fatos',             'fatos_select_admin'),
      ('pendencias',        'pendencias_select_escopo')
    ) as x(tname, pol)
  loop
    v_tbl := ('public.' || v_tname)::regclass;

    if not (select relrowsecurity from pg_class where oid = v_tbl) then
      raise exception '064: RLS desligado em %', v_tname;
    end if;

    if has_table_privilege('anon', v_tbl, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception '064: anon possui privilégio em %', v_tname;
    end if;
    if exists (
      select 1
        from pg_class c
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = v_tbl
         and a.grantee = 0
    ) then
      raise exception '064: PUBLIC possui privilégio em %', v_tname;
    end if;
    if not has_table_privilege('authenticated', v_tbl, 'SELECT')
       or has_table_privilege('authenticated', v_tbl, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception '064: ACL incorreta para authenticated em %', v_tname;
    end if;

    if (select count(*) from pg_policies where schemaname = 'public' and tablename = v_tname) <> 1
       or not exists (
         select 1 from pg_policies
          where schemaname = 'public'
            and tablename = v_tname
            and policyname = v_pol
            and permissive = 'PERMISSIVE'
            and cmd = 'SELECT'
            and 'authenticated' = any(roles)
       ) then
      raise exception '064: % deve ter exatamente 1 policy SELECT (%) para authenticated', v_tname, v_pol;
    end if;

    if not exists (
      select 1 from pg_trigger t
       where t.tgrelid = v_tbl
         and t.tgname = 'trg_bloqueia_agente'
         and not t.tgisinternal
         and t.tgenabled = 'O'
         and t.tgqual is null
         and (t.tgtype & 1) = 0
         and (t.tgtype & 2) <> 0
         and (t.tgtype & (4|8|16)) = (4|8|16)
         and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
    ) then
      raise exception '064: trg_bloqueia_agente ausente, desabilitado ou alterado em %', v_tname;
    end if;
  end loop;

  -- Policy de fatos é estritamente admin-only (sem allowed_project_ids)
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fatos'
       and (coalesce(qual, '') !~ 'is_admin' or coalesce(qual, '') ~ 'allowed_project_ids')
  ) then
    raise exception '064: policy de fatos deve ser estritamente admin-only';
  end if;

  -- Gatilho de CPF em pendencias habilitado e usando _tem_cpf
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = v_pend
       and t.tgname = 'trg_pendencias_sem_cpf'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and (t.tgtype & 1) <> 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|16)) = (4|16)
       and t.tgfoid = 'public._pendencias_sem_cpf()'::regprocedure
  ) then
    raise exception '064: trg_pendencias_sem_cpf ausente ou desabilitado';
  end if;

  if position('_tem_cpf' in pg_get_functiondef('public._pendencias_sem_cpf()'::regprocedure)) = 0 then
    raise exception '064: _pendencias_sem_cpf não usa _tem_cpf';
  end if;

  -- Colunas e tipos exatos das 3 tabelas novas
  select string_agg(a.attname || ':' || format_type(a.atttypid, -1), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_doc and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'id:uuid, project_id:uuid, tipo:text, chave:text, titulo:text, criado_em:timestamp with time zone' then
    raise exception '064: colunas/tipos inesperados em documentos: %', v_cols;
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, -1), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_ver and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'id:uuid, documento_id:uuid, versao:integer, sha256:text, bucket:text, caminho:text, arquivo_nome:text, formato:text, paginas:integer, parser:text, parser_versao:text, origem:text, registrado_em:timestamp with time zone, registrado_por:uuid' then
    raise exception '064: colunas/tipos inesperados em documento_versoes: %', v_cols;
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, -1), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_fat and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'id:uuid, versao_id:uuid, alvo_tabela:text, alvo_pai_id:uuid, alvo_chave:text, campo:text, valor:numeric, pagina:integer, trecho:text, bbox:jsonb, criado_em:timestamp with time zone' then
    raise exception '064: colunas/tipos inesperados em fatos: %', v_cols;
  end if;

  -- Nenhuma coluna documento_versao_id criada em balancetes ou planos_trabalho
  if exists (
    select 1 from pg_attribute a
     where a.attrelid in ('public.balancetes'::regclass, 'public.planos_trabalho'::regclass)
       and a.attname = 'documento_versao_id'
       and not a.attisdropped
  ) then
    raise exception '064: documento_versao_id não deve existir em balancetes/planos_trabalho';
  end if;

  -- FKs, constraints únicas e índices
  if not exists (
    select 1 from pg_constraint
     where conrelid = v_doc and contype = 'f' and conname = 'documentos_project_id_fkey' and confdeltype = 'r'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = v_ver and contype = 'f' and conname = 'documento_versoes_documento_id_fkey' and confdeltype = 'r'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = v_ver and contype = 'f' and conname = 'documento_versoes_registrado_por_fkey' and confdeltype = 'n'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = v_fat and contype = 'f' and conname = 'fatos_versao_id_fkey' and confdeltype = 'c'
  ) then
    raise exception '064: FK ou regra ON DELETE incorreta nas tabelas novas';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = v_doc and contype = 'u' and conname = 'documentos_chave_unique'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = v_ver and contype = 'u' and conname = 'documento_versoes_doc_versao_unique'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = v_ver and contype = 'u' and conname = 'documento_versoes_doc_sha256_unique'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = v_fat and contype = 'u' and conname = 'fatos_versao_alvo_campo_unique'
  ) then
    raise exception '064: constraint unique ausente';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'fatos' and indexname = 'idx_fatos_alvo'
  ) or not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'pendencias' and indexname = 'idx_pendencias_resolvida_por'
  ) then
    raise exception '064: índice idx_fatos_alvo ou idx_pendencias_resolvida_por ausente';
  end if;

  -- Funções internas: definer, search_path, sem EXECUTE para public/anon/authenticated
  foreach v_fn_sig in array array[
    'public._tem_cpf(text)',
    'public._mascarar_cpf(text)',
    'public._fmt_brl_num(numeric)',
    'public._resolver_origem_alvo(text, uuid, text, boolean)',
    'public._pendencias_sem_cpf()'
  ] loop
    v_fn := v_fn_sig::regprocedure;
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig is not null
         and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
    ) then
      raise exception '064: função interna % sem security definer ou search_path', v_fn_sig;
    end if;

    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or exists (
         select 1
           from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '064: ACL incorreta na função interna %', v_fn_sig;
    end if;
  end loop;

  -- RPCs públicas: definer, search_path, EXECUTE para authenticated, sem anon/PUBLIC
  foreach v_fn_sig in array array[
    'public.registrar_documento_v2(jsonb)',
    'public.get_origem_v2(text, uuid, text)',
    'public.explicar_livre_v2(uuid)',
    'public.criar_pendencia_v2(jsonb)',
    'public.resolver_pendencia_v2(uuid, text)'
  ] loop
    v_fn := v_fn_sig::regprocedure;
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig is not null
         and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
    ) then
      raise exception '064: RPC % sem security definer ou search_path', v_fn_sig;
    end if;

    if not has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (
         select 1
           from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '064: ACL incorreta na RPC %', v_fn_sig;
    end if;
  end loop;

  -- Sanidade de _tem_cpf e _mascarar_cpf
  if not public._tem_cpf('529 982 247 25')
     or not public._tem_cpf('529 982 247 25 - 100,00')
     or not public._tem_cpf('529.982' || E'\n' || '247-25')
     or public._tem_cpf('123.456.789-00')
     or public._tem_cpf('7.1.3.05.01.00042 2506042') then
    raise exception '064: _tem_cpf não se comportou como esperado';
  end if;

  if public._mascarar_cpf('CPF 529 982 247 25 ok') <> 'CPF ***.***.***-** ok' then
    raise exception '064: _mascarar_cpf falhou';
  end if;
end $$;

commit;
