-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 067
-- F3-A: termos do contrato com procedência (vigência e taxas)
-- ============================================================
-- Pedido do Victor em 19/11/2026: a vigência digitada não diz de
-- onde veio. O contrato é a fonte; a data pode ter sido lida pela
-- IA (e isso precisa ficar indicado) ou digitada por uma pessoa.
-- O mesmo registra a taxa (%) de CIP/UFG, CIP/unidade e DAO.
--
-- Decisões:
--   1. `termos_contrato` é histórico **só insert**. O vigente é o
--      registro mais recente por `(project_id, termo)`; nada é
--      apagado nem editado. O único UPDATE é a conferência humana,
--      feita pela RPC `conferir_termo_contrato_v2`.
--   2. A vigência que vale para as contas continua sendo
--      `projects.end_date`. A do contrato só entra lá pela RPC
--      `usar_vigencia_do_contrato_v2`, por decisão humana e com o
--      antes/depois devolvido. `get_saldo_livre` e as árvores não
--      mudam nesta migração.
--   3. `trecho` é o texto do contrato que sustenta o valor. CPF é
--      barrado por CHECK com `public.contem_cpf` (só chamada; a
--      função não é alterada) e por pré-checagem na RPC. O CHECK
--      roda como dono da função definer, nunca como `authenticated`
--      (a tabela não tem INSERT direto para ninguém).
--   4. `nota` é análise/comentário livre; só o admin humano a lê
--      pela RPC. Professor e agente recebem `null`.
--   5. Nada de linha nova com `now()`/`gen_random_uuid()`: esta
--      migração não insere dados.
--
-- Conferência: tests/sql/test_067_termos_contrato.sql
-- Executor:    tools/replica-local/rodar-067-pglite.mjs
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Tabela `public.termos_contrato`
-- ------------------------------------------------------------
create table if not exists public.termos_contrato (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  termo          text not null,
  valor_data     date,
  valor_pct      numeric(6,3),
  regra          text,
  trecho         text not null,
  documento_nome text not null,
  documento_url  text,
  pagina         integer,
  nota           text,
  origem         text not null,
  autor          text not null,
  criado_em      timestamptz not null default now(),
  criado_por     uuid default auth.uid(),
  conferido_em   timestamptz,
  conferido_por  uuid
);

-- Idempotência: se a tabela já existir de uma execução anterior,
-- acrescenta o que faltar sem derrubar dados.
alter table public.termos_contrato add column if not exists id             uuid default gen_random_uuid();
alter table public.termos_contrato add column if not exists project_id     uuid;
alter table public.termos_contrato add column if not exists termo          text;
alter table public.termos_contrato add column if not exists valor_data     date;
alter table public.termos_contrato add column if not exists valor_pct      numeric(6,3);
alter table public.termos_contrato add column if not exists regra          text;
alter table public.termos_contrato add column if not exists trecho         text;
alter table public.termos_contrato add column if not exists documento_nome text;
alter table public.termos_contrato add column if not exists documento_url  text;
alter table public.termos_contrato add column if not exists pagina         integer;
alter table public.termos_contrato add column if not exists nota           text;
alter table public.termos_contrato add column if not exists origem         text;
alter table public.termos_contrato add column if not exists autor          text;
alter table public.termos_contrato add column if not exists criado_em      timestamptz default now();
alter table public.termos_contrato add column if not exists criado_por     uuid default auth.uid();
alter table public.termos_contrato add column if not exists conferido_em   timestamptz;
alter table public.termos_contrato add column if not exists conferido_por  uuid;

alter table public.termos_contrato drop constraint if exists termos_contrato_project_id_fkey;
alter table public.termos_contrato
  add constraint termos_contrato_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete cascade;

alter table public.termos_contrato drop constraint if exists termos_contrato_criado_por_fkey;
alter table public.termos_contrato
  add constraint termos_contrato_criado_por_fkey
  foreign key (criado_por) references auth.users(id) on delete set null;

alter table public.termos_contrato drop constraint if exists termos_contrato_conferido_por_fkey;
alter table public.termos_contrato
  add constraint termos_contrato_conferido_por_fkey
  foreign key (conferido_por) references auth.users(id) on delete set null;

alter table public.termos_contrato drop constraint if exists termos_contrato_termo_check;
alter table public.termos_contrato
  add constraint termos_contrato_termo_check
  check (termo in ('vigencia_inicio', 'vigencia_fim', 'taxa_cip_ufg', 'taxa_cip_ua', 'taxa_dao'));

-- Vigência só tem data; taxa só tem percentual entre 0 e 100.
alter table public.termos_contrato drop constraint if exists termos_contrato_valor_check;
alter table public.termos_contrato
  add constraint termos_contrato_valor_check
  check (
    (
      termo in ('vigencia_inicio', 'vigencia_fim')
      and valor_data is not null
      and valor_pct is null
    )
    or
    (
      termo in ('taxa_cip_ufg', 'taxa_cip_ua', 'taxa_dao')
      and valor_pct is not null
      and valor_pct >= 0
      and valor_pct <= 100
      and valor_data is null
    )
  );

alter table public.termos_contrato drop constraint if exists termos_contrato_regra_check;
alter table public.termos_contrato
  add constraint termos_contrato_regra_check
  check (regra is null or (btrim(regra) <> '' and char_length(regra) <= 300));

-- O trecho é obrigatório, não pode ser só espaço e não pode conter
-- CPF. `contem_cpf` é chamada, nunca recriada/alterada aqui.
alter table public.termos_contrato drop constraint if exists termos_contrato_trecho_check;
alter table public.termos_contrato
  add constraint termos_contrato_trecho_check
  check (
    btrim(trecho) <> ''
    and char_length(trecho) <= 600
    and not public.contem_cpf(trecho)
  );

alter table public.termos_contrato drop constraint if exists termos_contrato_documento_nome_check;
alter table public.termos_contrato
  add constraint termos_contrato_documento_nome_check
  check (btrim(documento_nome) <> '');

-- Só links do Drive/Docs (o documento de origem mora lá).
alter table public.termos_contrato drop constraint if exists termos_contrato_documento_url_check;
alter table public.termos_contrato
  add constraint termos_contrato_documento_url_check
  check (
    documento_url is null
    or documento_url ~ '^https://(drive|docs)\.google\.com/'
  );

alter table public.termos_contrato drop constraint if exists termos_contrato_pagina_check;
alter table public.termos_contrato
  add constraint termos_contrato_pagina_check
  check (pagina is null or pagina >= 1);

alter table public.termos_contrato drop constraint if exists termos_contrato_nota_check;
alter table public.termos_contrato
  add constraint termos_contrato_nota_check
  check (nota is null or (btrim(nota) <> '' and char_length(nota) <= 2000));

alter table public.termos_contrato drop constraint if exists termos_contrato_origem_check;
alter table public.termos_contrato
  add constraint termos_contrato_origem_check
  check (origem in ('ia', 'pessoa'));

alter table public.termos_contrato drop constraint if exists termos_contrato_autor_check;
alter table public.termos_contrato
  add constraint termos_contrato_autor_check
  check (btrim(autor) <> '' and char_length(autor) <= 60);

-- `conferido_por` pode virar null se a conta for apagada; a data
-- permanece. O contrário (quem sem quando) não é permitido.
alter table public.termos_contrato drop constraint if exists termos_contrato_conferido_check;
alter table public.termos_contrato
  add constraint termos_contrato_conferido_check
  check (conferido_por is null or conferido_em is not null);

comment on table public.termos_contrato is
  'Histórico só insert dos termos do contrato (vigência e taxas). O vigente é o mais recente por (project_id, termo); escrita só pelas RPCs v2 (mig. 067).';
comment on column public.termos_contrato.termo is
  'vigencia_inicio, vigencia_fim, taxa_cip_ufg, taxa_cip_ua ou taxa_dao (os códigos de taxa são os das rubricas da 066).';
comment on column public.termos_contrato.regra is
  'Como o valor foi obtido, ex.: "20 meses contados da última assinatura" (até 300 caracteres).';
comment on column public.termos_contrato.trecho is
  'Texto do contrato que sustenta o valor, sem CPF (1 a 600 caracteres).';
comment on column public.termos_contrato.nota is
  'Análise/comentário livre de quem registrou: divergência com o banco, aditivo, dúvida. Só o admin lê pela RPC.';
comment on column public.termos_contrato.origem is
  'ia quando o valor foi lido por IA; pessoa quando foi digitado por uma pessoa.';
comment on column public.termos_contrato.conferido_em is
  'Quando um humano confirmou o registro. Único UPDATE permitido, só pela RPC conferir_termo_contrato_v2.';

create index if not exists idx_termos_contrato_project_termo
  on public.termos_contrato (project_id, termo, criado_em desc, id desc);

alter table public.termos_contrato enable row level security;
revoke all on public.termos_contrato from public, anon, authenticated;
grant select on public.termos_contrato to authenticated;

drop policy if exists termos_contrato_select_escopo on public.termos_contrato;
create policy termos_contrato_select_escopo on public.termos_contrato
  for select to authenticated
  using (
    public.is_admin()
    or (project_id is not null and project_id = any(public.allowed_project_ids()))
  );

drop trigger if exists trg_bloqueia_agente on public.termos_contrato;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.termos_contrato
  for each statement execute function public.bloqueia_escrita_do_agente();

-- ------------------------------------------------------------
-- 2. RPCs
-- ------------------------------------------------------------

-- 2.1 get_termos_contrato_v2(p_project_id)
-- Devolve o vigente de cada termo. `nota` só para admin humano.
create or replace function public.get_termos_contrato_v2(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_end      date;
  v_fim      date;
  v_admin    boolean := public.is_admin() and not public.is_agente();
  v_termos   jsonb;
begin
  if p_project_id is null then
    raise exception 'project_id é obrigatório.' using errcode = '22023';
  end if;

  perform public.assert_project_allowed(p_project_id);

  select p.end_date into v_end
    from public.projects p
   where p.id = p_project_id;

  if not found then
    raise exception 'Projeto não encontrado: %', p_project_id using errcode = 'P0002';
  end if;

  select coalesce(jsonb_object_agg(x.termo, x.obj), '{}'::jsonb)
    into v_termos
    from (
      select distinct on (t.termo)
        t.termo,
        jsonb_build_object(
          'id',                 t.id,
          'valor',              case
                                  when t.valor_data is not null then to_jsonb(t.valor_data)
                                  else to_jsonb(t.valor_pct)
                                end,
          'regra',              t.regra,
          'trecho',             t.trecho,
          'documento_nome',     t.documento_nome,
          'documento_url',      t.documento_url,
          'pagina',             t.pagina,
          'nota',               case when v_admin then t.nota else null end,
          'origem',             t.origem,
          'autor',              t.autor,
          'criado_em',          t.criado_em,
          'conferido',          (t.conferido_em is not null),
          'conferido_em',       t.conferido_em,
          'versoes_anteriores', coalesce(
            (
              select jsonb_agg(
                       jsonb_build_object(
                         'id',           a.id,
                         'valor',        case
                                           when a.valor_data is not null then to_jsonb(a.valor_data)
                                           else to_jsonb(a.valor_pct)
                                         end,
                         'regra',        a.regra,
                         'criado_em',    a.criado_em,
                         'autor',        a.autor,
                         'origem',       a.origem,
                         'conferido_em', a.conferido_em
                       )
                       order by a.criado_em desc, a.id desc
                     )
                from public.termos_contrato a
               where a.project_id = t.project_id
                 and a.termo = t.termo
                 and (a.criado_em, a.id) < (t.criado_em, t.id)
            ),
            '[]'::jsonb
          )
        ) as obj
        from public.termos_contrato t
       where t.project_id = p_project_id
       order by t.termo, t.criado_em desc, t.id desc
    ) x;

  v_fim := nullif((v_termos -> 'vigencia_fim' ->> 'valor'), '')::date;

  return jsonb_build_object(
    'termos',            v_termos,
    'end_date_cadastro', v_end,
    'vigencia_confere',  case
                           when v_fim is null or v_end is null then null
                           else (v_fim = v_end)
                         end
  );
end;
$$;

comment on function public.get_termos_contrato_v2(uuid) is
  'Lê o registro vigente de cada termo do contrato (mais recente por termo) e diz se a vigência final confere com projects.end_date. `nota` só para admin humano (mig. 067).';

revoke all on function public.get_termos_contrato_v2(uuid) from public, anon;
grant execute on function public.get_termos_contrato_v2(uuid) to authenticated;

-- 2.2 registrar_termo_contrato_v2(p jsonb)
-- Só admin humano. Insere uma linha nova; idempotente quando o
-- último registro do mesmo termo tem o mesmo conteúdo.
create or replace function public.registrar_termo_contrato_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chaves_invalidas text;
  v_project_txt      text;
  v_project_id       uuid;
  v_termo            text;
  v_valor_data_txt   text;
  v_valor_data       date;
  v_valor_pct        numeric(6,3);
  v_pagina_num       numeric;
  v_regra            text;
  v_trecho           text;
  v_doc_nome         text;
  v_doc_url          text;
  v_pagina           integer;
  v_nota             text;
  v_origem           text;
  v_autor            text;
  v_id               uuid;
  v_ultimo           public.termos_contrato;
begin
  if not public.is_admin() or public.is_agente() then
    raise exception 'Só admin humano registra termos do contrato.' using errcode = '42501';
  end if;

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Payload deve ser um objeto JSON.' using errcode = '22023';
  end if;

  select string_agg(k, ', ' order by k)
    into v_chaves_invalidas
    from jsonb_object_keys(p) as k
   where k not in (
     'project_id', 'termo', 'valor_data', 'valor_pct', 'regra', 'trecho',
     'documento_nome', 'documento_url', 'pagina', 'nota', 'origem', 'autor'
   );

  if v_chaves_invalidas is not null then
    raise exception 'Campos não permitidos em registrar_termo_contrato_v2: %', v_chaves_invalidas
      using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'project_id') is distinct from 'string' then
    raise exception 'Campo project_id é obrigatório.' using errcode = '22023';
  end if;
  v_project_txt := nullif(btrim(p ->> 'project_id'), '');
  if v_project_txt is null
     or v_project_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Campo project_id inválido.' using errcode = '22023';
  end if;
  begin
    v_project_id := v_project_txt::uuid;
  exception when invalid_text_representation then
    raise exception 'Campo project_id inválido.' using errcode = '22023';
  end;

  if not exists (select 1 from public.projects pr where pr.id = v_project_id) then
    raise exception 'Projeto não encontrado.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'termo') is distinct from 'string' then
    raise exception 'Campo termo é obrigatório.' using errcode = '22023';
  end if;
  v_termo := nullif(btrim(p ->> 'termo'), '');
  if v_termo is null or v_termo not in (
    'vigencia_inicio', 'vigencia_fim', 'taxa_cip_ufg', 'taxa_cip_ua', 'taxa_dao'
  ) then
    raise exception 'Termo inválido.' using errcode = '22023';
  end if;

  if v_termo in ('vigencia_inicio', 'vigencia_fim') then
    if jsonb_typeof(p -> 'valor_data') is distinct from 'string' then
      raise exception 'Campo valor_data é obrigatório para termos de vigência.' using errcode = '22023';
    end if;
    v_valor_data_txt := nullif(btrim(p ->> 'valor_data'), '');
    if v_valor_data_txt is null or v_valor_data_txt !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Campo valor_data inválido.' using errcode = '22023';
    end if;
    begin
      v_valor_data := v_valor_data_txt::date;
    exception when others then
      raise exception 'Campo valor_data inválido.' using errcode = '22023';
    end;

    if p ? 'valor_pct' and jsonb_typeof(p -> 'valor_pct') <> 'null' then
      raise exception 'Termo de vigência não aceita valor_pct.' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(p -> 'valor_pct') is distinct from 'number' then
      raise exception 'Campo valor_pct é obrigatório para termos de taxa.' using errcode = '22023';
    end if;
    v_valor_pct := round((p ->> 'valor_pct')::numeric, 3);
    if v_valor_pct < 0 or v_valor_pct > 100 then
      raise exception 'Campo valor_pct deve estar entre 0 e 100.' using errcode = '22023';
    end if;

    if p ? 'valor_data' and jsonb_typeof(p -> 'valor_data') <> 'null' then
      raise exception 'Termo de taxa não aceita valor_data.' using errcode = '22023';
    end if;
  end if;

  if p ? 'regra' and jsonb_typeof(p -> 'regra') not in ('string', 'null') then
    raise exception 'Campo regra deve ser texto.' using errcode = '22023';
  end if;
  v_regra := nullif(btrim(p ->> 'regra'), '');
  if v_regra is not null and char_length(v_regra) > 300 then
    raise exception 'Campo regra tem mais de 300 caracteres.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'trecho') is distinct from 'string' then
    raise exception 'Campo trecho é obrigatório.' using errcode = '22023';
  end if;
  v_trecho := btrim(p ->> 'trecho');
  if v_trecho = '' or char_length(v_trecho) > 600 then
    raise exception 'Campo trecho deve ter de 1 a 600 caracteres.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'documento_nome') is distinct from 'string'
     or btrim(p ->> 'documento_nome') = '' then
    raise exception 'Campo documento_nome é obrigatório.' using errcode = '22023';
  end if;
  v_doc_nome := btrim(p ->> 'documento_nome');

  if p ? 'documento_url' and jsonb_typeof(p -> 'documento_url') not in ('string', 'null') then
    raise exception 'Campo documento_url deve ser texto.' using errcode = '22023';
  end if;
  v_doc_url := nullif(btrim(p ->> 'documento_url'), '');
  if v_doc_url is not null
     and v_doc_url !~ '^https://(drive|docs)\.google\.com/' then
    raise exception 'Campo documento_url deve apontar para drive.google.com ou docs.google.com.' using errcode = '22023';
  end if;

  if p ? 'pagina' and jsonb_typeof(p -> 'pagina') not in ('number', 'null') then
    raise exception 'Campo pagina deve ser um inteiro.' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'pagina') = 'number' then
    v_pagina_num := (p ->> 'pagina')::numeric;
    if v_pagina_num <> trunc(v_pagina_num) or v_pagina_num < 1 then
      raise exception 'Campo pagina deve ser um inteiro maior ou igual a 1.' using errcode = '22023';
    end if;
    v_pagina := v_pagina_num::integer;
  end if;

  if p ? 'nota' and jsonb_typeof(p -> 'nota') not in ('string', 'null') then
    raise exception 'Campo nota deve ser texto.' using errcode = '22023';
  end if;
  v_nota := nullif(btrim(p ->> 'nota'), '');
  if v_nota is not null and char_length(v_nota) > 2000 then
    raise exception 'Campo nota tem mais de 2000 caracteres.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'origem') is distinct from 'string' then
    raise exception 'Campo origem é obrigatório.' using errcode = '22023';
  end if;
  v_origem := nullif(btrim(p ->> 'origem'), '');
  if v_origem is null or v_origem not in ('ia', 'pessoa') then
    raise exception 'Campo origem deve ser ia ou pessoa.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'autor') is distinct from 'string' then
    raise exception 'Campo autor é obrigatório.' using errcode = '22023';
  end if;
  v_autor := nullif(btrim(p ->> 'autor'), '');
  if v_autor is null or char_length(v_autor) > 60 then
    raise exception 'Campo autor deve ter de 1 a 60 caracteres.' using errcode = '22023';
  end if;

  -- Pré-checagem: o CHECK da tabela cobre o trecho; aqui os demais
  -- textos também são barrados antes de chegar ao banco.
  if public.contem_cpf(
       coalesce(v_trecho, '') || ' ' || coalesce(v_regra, '') || ' ' ||
       coalesce(v_nota, '') || ' ' || coalesce(v_doc_nome, '') || ' ' ||
       coalesce(v_doc_url, '') || ' ' || coalesce(v_autor, '')
     ) then
    raise exception 'Termo do contrato contém sequência no formato de CPF e não pode ser gravado.'
      using errcode = '22023';
  end if;

  -- Idempotência: mesmo valor, trecho, documento, nota e regra do
  -- último registro do termo não gera linha nova.
  select * into v_ultimo
    from public.termos_contrato t
   where t.project_id = v_project_id
     and t.termo = v_termo
   order by t.criado_em desc, t.id desc
   limit 1;

  if found
     and v_ultimo.valor_data is not distinct from v_valor_data
     and v_ultimo.valor_pct is not distinct from v_valor_pct
     and v_ultimo.regra is not distinct from v_regra
     and v_ultimo.trecho is not distinct from v_trecho
     and v_ultimo.documento_nome is not distinct from v_doc_nome
     and v_ultimo.documento_url is not distinct from v_doc_url
     and v_ultimo.pagina is not distinct from v_pagina
     and v_ultimo.nota is not distinct from v_nota then
    return jsonb_build_object(
      'id',     v_ultimo.id,
      'termo',  v_ultimo.termo,
      'criado', false
    );
  end if;

  -- `clock_timestamp()` e não `now()`: uma mesma sessão pode registrar
  -- vários termos na mesma transação; `now()` seria o início da
  -- transação e empataria duas versões do mesmo termo, deixando a
  -- ordem do histórico para o id. O default da tabela continua `now()`.
  insert into public.termos_contrato (
    project_id, termo, valor_data, valor_pct, regra, trecho,
    documento_nome, documento_url, pagina, nota, origem, autor, criado_em, criado_por
  ) values (
    v_project_id, v_termo, v_valor_data, v_valor_pct, v_regra, v_trecho,
    v_doc_nome, v_doc_url, v_pagina, v_nota, v_origem, v_autor,
    clock_timestamp(), auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object(
    'id',     v_id,
    'termo',  v_termo,
    'criado', true
  );
end;
$$;

comment on function public.registrar_termo_contrato_v2(jsonb) is
  'Só admin humano. Registra uma versão nova de um termo do contrato; se o último registro do mesmo termo tem o mesmo conteúdo, devolve o id existente sem inserir (mig. 067).';

revoke all on function public.registrar_termo_contrato_v2(jsonb) from public, anon;
grant execute on function public.registrar_termo_contrato_v2(jsonb) to authenticated;

-- 2.3 conferir_termo_contrato_v2(p_id)
-- Só admin humano; marca uma vez. É o único UPDATE da tabela.
create or replace function public.conferir_termo_contrato_v2(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row        public.termos_contrato;
  v_conf_em    timestamptz;
  v_conf_por   uuid;
begin
  if not public.is_admin() or public.is_agente() then
    raise exception 'Só admin humano confere termos do contrato.' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'id é obrigatório.' using errcode = '22023';
  end if;

  select * into v_row
    from public.termos_contrato t
   where t.id = p_id
     for update;

  if not found then
    raise exception 'Termo do contrato não encontrado.' using errcode = '42501';
  end if;

  if v_row.conferido_em is not null then
    return jsonb_build_object(
      'id',            v_row.id,
      'conferido_em',  v_row.conferido_em,
      'conferido_por', v_row.conferido_por,
      'ja_estava',     true
    );
  end if;

  update public.termos_contrato
     set conferido_em  = now(),
         conferido_por = auth.uid()
   where id = p_id
   returning conferido_em, conferido_por into v_conf_em, v_conf_por;

  return jsonb_build_object(
    'id',            p_id,
    'conferido_em',  v_conf_em,
    'conferido_por', v_conf_por,
    'ja_estava',     false
  );
end;
$$;

comment on function public.conferir_termo_contrato_v2(uuid) is
  'Só admin humano. Marca conferido_em/conferido_por uma única vez; repetir devolve a mesma marcação (mig. 067).';

revoke all on function public.conferir_termo_contrato_v2(uuid) from public, anon;
grant execute on function public.conferir_termo_contrato_v2(uuid) to authenticated;

-- 2.4 usar_vigencia_do_contrato_v2(p_project_id)
-- Só admin humano. Copia a vigência final vigente para end_date (e
-- a inicial para start_date, se existir). Não toca em mais nada.
create or replace function public.usar_vigencia_do_contrato_v2(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects;
  v_fim     date;
  v_inicio  date;
  v_antes   jsonb;
  v_depois  jsonb;
  v_active  boolean;
  v_mudou   boolean;
begin
  if not public.is_admin() or public.is_agente() then
    raise exception 'Só admin humano usa a vigência do contrato.' using errcode = '42501';
  end if;

  if p_project_id is null then
    raise exception 'project_id é obrigatório.' using errcode = '22023';
  end if;

  select * into v_project
    from public.projects p
   where p.id = p_project_id
     for update;

  if not found then
    raise exception 'Projeto não encontrado: %', p_project_id using errcode = 'P0002';
  end if;

  select t.valor_data into v_fim
    from public.termos_contrato t
   where t.project_id = p_project_id
     and t.termo = 'vigencia_fim'
   order by t.criado_em desc, t.id desc
   limit 1;

  if v_fim is null then
    raise exception 'Sem vigência final do contrato registrada para este projeto.'
      using errcode = '22023';
  end if;

  select t.valor_data into v_inicio
    from public.termos_contrato t
   where t.project_id = p_project_id
     and t.termo = 'vigencia_inicio'
   order by t.criado_em desc, t.id desc
   limit 1;

  v_antes  := jsonb_build_object(
    'start_date', v_project.start_date,
    'end_date',   v_project.end_date
  );
  v_active := v_project.active;

  update public.projects
     set end_date   = v_fim,
         start_date = coalesce(v_inicio, start_date)
   where id = p_project_id;

  -- O gatilho da 020 reativa projeto inativo quando end_date vira
  -- futuro. Aqui a vigência do contrato não decide atividade: o
  -- centro continua como estava. O segundo UPDATE não mexe em
  -- end_date, então o gatilho da 020 não dispara de novo.
  if v_active is distinct from (select p.active from public.projects p where p.id = p_project_id) then
    update public.projects
       set active = v_active
     where id = p_project_id;
  end if;

  select jsonb_build_object(
           'start_date', p.start_date,
           'end_date',   p.end_date
         )
    into v_depois
    from public.projects p
   where p.id = p_project_id;

  v_mudou := (v_antes is distinct from v_depois);

  return jsonb_build_object(
    'project_id', p_project_id,
    'antes',      v_antes,
    'depois',     v_depois,
    'mudou',      v_mudou
  );
end;
$$;

comment on function public.usar_vigencia_do_contrato_v2(uuid) is
  'Só admin humano. Copia a vigência final (e a inicial, se houver) do contrato para projects.end_date/start_date e devolve antes/depois. Não altera active; updated_at muda pelo gatilho da 001 (mig. 067).';

revoke all on function public.usar_vigencia_do_contrato_v2(uuid) from public, anon;
grant execute on function public.usar_vigencia_do_contrato_v2(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Asserções dentro da transação
-- ------------------------------------------------------------
do $$
declare
  v_tab  oid := 'public.termos_contrato'::regclass;
  v_fn   oid;
  v_sig  text;
  v_cols text;
begin
  if not (select relrowsecurity from pg_class where oid = v_tab) then
    raise exception '067: RLS desligado em termos_contrato';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'termos_contrato') <> 1 then
    raise exception '067: esperada exatamente 1 policy em termos_contrato';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'termos_contrato'
       and policyname = 'termos_contrato_select_escopo'
       and cmd = 'SELECT'
       and coalesce(qual, '') ~ 'is_admin'
       and coalesce(qual, '') ~ 'allowed_project_ids'
  ) then
    raise exception '067: policy termos_contrato_select_escopo ausente ou sem escopo';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'termos_contrato'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception '067: termos_contrato possui policy de escrita';
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = v_tab
       and t.tgname = 'trg_bloqueia_agente'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and t.tgqual is null
       and (t.tgtype & 1) = 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|8|16)) = (4|8|16)
       and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
  ) then
    raise exception '067: trg_bloqueia_agente ausente ou incorreto em termos_contrato';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = v_tab and contype = 'f'
       and conname = 'termos_contrato_project_id_fkey' and confdeltype = 'c'
  ) then
    raise exception '067: termos_contrato_project_id_fkey ausente ou sem ON DELETE CASCADE';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = v_tab and contype = 'c'
       and conname = 'termos_contrato_trecho_check'
       and pg_get_constraintdef(oid) ~ 'contem_cpf'
  ) then
    raise exception '067: CHECK do trecho sem contem_cpf';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = v_tab and contype = 'c'
       and conname = 'termos_contrato_valor_check'
  ) then
    raise exception '067: CHECK de valor_data/valor_pct ausente';
  end if;

  if exists (
    select 1 from pg_constraint
     where conrelid = v_tab and contype = 'c'
       and conname not in (
         'termos_contrato_termo_check',
         'termos_contrato_valor_check',
         'termos_contrato_regra_check',
         'termos_contrato_trecho_check',
         'termos_contrato_documento_nome_check',
         'termos_contrato_documento_url_check',
         'termos_contrato_pagina_check',
         'termos_contrato_nota_check',
         'termos_contrato_origem_check',
         'termos_contrato_autor_check',
         'termos_contrato_conferido_check'
       )
  ) then
    raise exception '067: CHECK inesperado em termos_contrato';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'termos_contrato'
       and indexname = 'idx_termos_contrato_project_termo'
  ) then
    raise exception '067: índice idx_termos_contrato_project_termo ausente';
  end if;

  if has_table_privilege('anon', v_tab, 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '067: anon possui acesso a termos_contrato';
  end if;
  if not has_table_privilege('authenticated', v_tab, 'SELECT')
     or has_table_privilege('authenticated', v_tab, 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '067: ACL incorreta para authenticated em termos_contrato';
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_tab and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'id:uuid, project_id:uuid, termo:text, valor_data:date, valor_pct:numeric(6,3), regra:text, trecho:text, documento_nome:text, documento_url:text, pagina:integer, nota:text, origem:text, autor:text, criado_em:timestamp with time zone, criado_por:uuid, conferido_em:timestamp with time zone, conferido_por:uuid' then
    raise exception '067: colunas/tipos inesperados em termos_contrato: %', v_cols;
  end if;

  foreach v_sig in array array[
    'public.get_termos_contrato_v2(uuid)',
    'public.registrar_termo_contrato_v2(jsonb)',
    'public.conferir_termo_contrato_v2(uuid)',
    'public.usar_vigencia_do_contrato_v2(uuid)'
  ] loop
    v_fn := v_sig::regprocedure;

    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '067: % sem security definer ou search_path exato', v_sig;
    end if;

    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '067: authenticated perdeu EXECUTE em %', v_sig;
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
      raise exception '067: ACL incorreta em %', v_sig;
    end if;
  end loop;

  if not exists (
    select 1 from pg_proc
     where oid = 'public.get_termos_contrato_v2(uuid)'::regprocedure
       and provolatile = 's'
  ) then
    raise exception '067: get_termos_contrato_v2 não é STABLE';
  end if;
end $$;

commit;
