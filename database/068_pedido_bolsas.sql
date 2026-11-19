-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 068
-- F3-B: pedido de bolsas (equipes e caixas de quem monta o pedido)
-- ============================================================
-- Pedido do Victor em 19/11/2026: uma pessoa da equipe monta o
-- pedido de bolsas da renovação de um contrato olhando os bolsistas
-- dos centros do professor, filtrando por equipe e colocando as
-- pessoas em uma ou duas caixas de trabalho.
--
-- Decisões:
--   1. `bolsista_equipes` é uma linha por pessoa (Pastagem, Alertas
--      ou Solos); sem linha = "sem equipe". A equipe é compartilhada
--      por quem enxerga a pessoa, então é dado de leitura/escrita
--      exclusiva das RPCs definer desta migração.
--   2. `caixas_pedido` e `caixa_pedido_itens` são as caixas de quem
--      monta o pedido. A caixa tem dono; só o dono lê e altera as
--      suas. Uma pessoa fica em uma caixa só por dono (a RPC de
--      colocar tira das outras caixas do mesmo dono).
--   3. Nada muda em bolsas, saldo, `get_saldo_livre`,
--      `explicar_livre_v2` ou `resumo_projetos_v2`. Esta migração
--      não insere dados.
--   4. CPF é barrado pela regra única `_tem_cpf` (064/065) na RPC e
--      por gatilhos definer próprios, no molde de
--      `_pendencias_sem_cpf` (063) e `_termos_sem_cpf` (067):
--      nenhum CHECK chama helper de CPF, que falharia por ACL em
--      vez de 23514.
--   5. As três tabelas ficam com RLS ligado, sem policy e sem grant
--      para `authenticated`: a leitura e a escrita são só pelas
--      RPCs v2. O default deny é a barreira, e o `revoke` alcança
--      também o que os privilégios padrão do schema concederem.
--   6. O agente (Buriti) não lê nem grava aqui. O gatilho de
--      statement `trg_bloqueia_agente` fecha a escrita de tabela e
--      as RPCs recusam o papel antes de qualquer leitura.
--
-- Conferência: tests/sql/test_068_pedido_bolsas.sql
-- Executor:    tools/replica-local/rodar-068-pglite.mjs
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Tabelas
-- ------------------------------------------------------------

-- Uma equipe por pessoa. Sem linha = sem equipe.
create table if not exists public.bolsista_equipes (
  holder_id      uuid primary key references public.scholarship_holders(id) on delete cascade,
  equipe         text not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

alter table public.bolsista_equipes add column if not exists holder_id      uuid;
alter table public.bolsista_equipes add column if not exists equipe         text;
alter table public.bolsista_equipes add column if not exists atualizado_em  timestamptz default now();
alter table public.bolsista_equipes add column if not exists atualizado_por uuid default auth.uid();

alter table public.bolsista_equipes drop constraint if exists bolsista_equipes_holder_id_fkey;
alter table public.bolsista_equipes
  add constraint bolsista_equipes_holder_id_fkey
  foreign key (holder_id) references public.scholarship_holders(id) on delete cascade;

alter table public.bolsista_equipes drop constraint if exists bolsista_equipes_atualizado_por_fkey;
alter table public.bolsista_equipes
  add constraint bolsista_equipes_atualizado_por_fkey
  foreign key (atualizado_por) references auth.users(id) on delete set null;

alter table public.bolsista_equipes drop constraint if exists bolsista_equipes_equipe_check;
alter table public.bolsista_equipes
  add constraint bolsista_equipes_equipe_check
  check (equipe in ('pastagem', 'alertas', 'solos'));

comment on table public.bolsista_equipes is
  'Uma equipe (pastagem, alertas ou solos) por bolsista; sem linha = sem equipe. Leitura e escrita só pelas RPCs v2 (mig. 068).';
comment on column public.bolsista_equipes.atualizado_por is
  'Quem mudou a equipe por último; nulo se a conta for apagada.';

-- Caixas de quem monta o pedido.
create table if not exists public.caixas_pedido (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  meses         integer not null default 12,
  dono          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.caixas_pedido add column if not exists id            uuid default gen_random_uuid();
alter table public.caixas_pedido add column if not exists nome          text;
alter table public.caixas_pedido add column if not exists meses         integer default 12;
alter table public.caixas_pedido add column if not exists dono          uuid default auth.uid();
alter table public.caixas_pedido add column if not exists criado_em     timestamptz default now();
alter table public.caixas_pedido add column if not exists atualizado_em timestamptz default now();

alter table public.caixas_pedido drop constraint if exists caixas_pedido_dono_fkey;
alter table public.caixas_pedido
  add constraint caixas_pedido_dono_fkey
  foreign key (dono) references auth.users(id) on delete cascade;

alter table public.caixas_pedido drop constraint if exists caixas_pedido_nome_check;
alter table public.caixas_pedido
  add constraint caixas_pedido_nome_check
  check (btrim(nome) <> '' and char_length(btrim(nome)) <= 80);

alter table public.caixas_pedido drop constraint if exists caixas_pedido_meses_check;
alter table public.caixas_pedido
  add constraint caixas_pedido_meses_check
  check (meses >= 1 and meses <= 60);

comment on table public.caixas_pedido is
  'Caixas do pedido de bolsas, uma por dono e com nome próprio; leitura e escrita só pelas RPCs v2 (mig. 068).';
comment on column public.caixas_pedido.meses is
  'Meses do pedido usados no total do período (1 a 60).';

-- Pessoas dentro de cada caixa.
create table if not exists public.caixa_pedido_itens (
  caixa_id     uuid not null references public.caixas_pedido(id) on delete cascade,
  holder_id    uuid not null references public.scholarship_holders(id) on delete cascade,
  valor_mensal numeric(14,2),
  nota         text,
  criado_em    timestamptz not null default now(),
  primary key (caixa_id, holder_id)
);

alter table public.caixa_pedido_itens add column if not exists caixa_id     uuid;
alter table public.caixa_pedido_itens add column if not exists holder_id    uuid;
alter table public.caixa_pedido_itens add column if not exists valor_mensal numeric(14,2);
alter table public.caixa_pedido_itens add column if not exists nota         text;
alter table public.caixa_pedido_itens add column if not exists criado_em    timestamptz default now();

alter table public.caixa_pedido_itens drop constraint if exists caixa_pedido_itens_caixa_id_fkey;
alter table public.caixa_pedido_itens
  add constraint caixa_pedido_itens_caixa_id_fkey
  foreign key (caixa_id) references public.caixas_pedido(id) on delete cascade;

alter table public.caixa_pedido_itens drop constraint if exists caixa_pedido_itens_holder_id_fkey;
alter table public.caixa_pedido_itens
  add constraint caixa_pedido_itens_holder_id_fkey
  foreign key (holder_id) references public.scholarship_holders(id) on delete cascade;

alter table public.caixa_pedido_itens drop constraint if exists caixa_pedido_itens_valor_check;
alter table public.caixa_pedido_itens
  add constraint caixa_pedido_itens_valor_check
  check (
    valor_mensal is null
    or (
      valor_mensal > 0
      and valor_mensal <> 'NaN'::numeric
      and valor_mensal <> 'Infinity'::numeric
      and valor_mensal <> '-Infinity'::numeric
    )
  );

alter table public.caixa_pedido_itens drop constraint if exists caixa_pedido_itens_nota_check;
alter table public.caixa_pedido_itens
  add constraint caixa_pedido_itens_nota_check
  check (nota is null or (btrim(nota) <> '' and char_length(btrim(nota)) <= 300));

comment on table public.caixa_pedido_itens is
  'Pessoas de uma caixa do pedido, com valor opcional (nulo = valor vigente) e nota curta; leitura e escrita só pelas RPCs v2 (mig. 068).';
comment on column public.caixa_pedido_itens.valor_mensal is
  'Valor mensal no pedido; nulo significa usar o valor vigente da pessoa. Precisa ser positivo e finito quando preenchido.';
comment on column public.caixa_pedido_itens.nota is
  'Nota curta de quem monta o pedido (até 300 caracteres), sem CPF.';

create index if not exists idx_caixas_pedido_dono
  on public.caixas_pedido (dono, criado_em, id);

create index if not exists idx_caixa_pedido_itens_holder
  on public.caixa_pedido_itens (holder_id);

-- ------------------------------------------------------------
-- 2. Barreiras de tabela
-- ------------------------------------------------------------
alter table public.bolsista_equipes enable row level security;
revoke all on public.bolsista_equipes from public, anon, authenticated;

alter table public.caixas_pedido enable row level security;
revoke all on public.caixas_pedido from public, anon, authenticated;

alter table public.caixa_pedido_itens enable row level security;
revoke all on public.caixa_pedido_itens from public, anon, authenticated;

-- Sem policy de propósito: a ACL e o default deny do RLS fecham a
-- tabela. Se alguém conceder SELECT no futuro, nada vaza.

drop trigger if exists trg_bloqueia_agente on public.bolsista_equipes;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.bolsista_equipes
  for each statement execute function public.bloqueia_escrita_do_agente();

drop trigger if exists trg_bloqueia_agente on public.caixas_pedido;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.caixas_pedido
  for each statement execute function public.bloqueia_escrita_do_agente();

drop trigger if exists trg_bloqueia_agente on public.caixa_pedido_itens;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.caixa_pedido_itens
  for each statement execute function public.bloqueia_escrita_do_agente();

-- CPF: a regra única é `_tem_cpf` (064/065). O gatilho roda como
-- dono e vale inclusive para INSERT direto do dono da tabela.
create or replace function public._caixas_pedido_sem_cpf()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public._tem_cpf(new.nome) then
    raise exception 'Nome de caixa do pedido contém CPF e não pode ser gravado.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public._caixas_pedido_sem_cpf() from public, anon, authenticated;

drop trigger if exists trg_caixas_pedido_sem_cpf on public.caixas_pedido;
create trigger trg_caixas_pedido_sem_cpf
  before insert or update on public.caixas_pedido
  for each row execute function public._caixas_pedido_sem_cpf();

create or replace function public._caixa_pedido_itens_sem_cpf()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public._tem_cpf(new.nota) then
    raise exception 'Nota de item da caixa contém CPF e não pode ser gravada.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public._caixa_pedido_itens_sem_cpf() from public, anon, authenticated;

drop trigger if exists trg_caixa_pedido_itens_sem_cpf on public.caixa_pedido_itens;
create trigger trg_caixa_pedido_itens_sem_cpf
  before insert or update on public.caixa_pedido_itens
  for each row execute function public._caixa_pedido_itens_sem_cpf();

-- ------------------------------------------------------------
-- 3. Visibilidade e guarda comum
-- ------------------------------------------------------------

-- Admin vê todas as pessoas; os demais veem quem tem pelo menos uma
-- bolsa não cancelada em um centro do próprio escopo. Nunca devolve
-- bolsa de centro fora do escopo, nem para dizer que existe.
create or replace function public._bolsista_visivel(p_holder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_holder_id is null then false
    when public.is_admin() then exists (
      select 1 from public.scholarship_holders h where h.id = p_holder_id
    )
    else exists (
      select 1
        from public.scholarships s
       where s.holder_id = p_holder_id
         and s.status <> 'cancelled'
         and s.project_id = any(public.allowed_project_ids())
    )
  end;
$$;

comment on function public._bolsista_visivel(uuid) is
  'true se o chamador pode ver a pessoa: admin vê todas; os demais só quem tem bolsa não cancelada em allowed_project_ids() (mig. 068).';

revoke all on function public._bolsista_visivel(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. RPCs
-- ------------------------------------------------------------

-- 4.1 get_pedido_bolsas_v2()
-- Devolve centros, bolsistas visíveis e as caixas do próprio usuário.
-- As contas de cada caixa são feitas aqui; o app só mostra.
create or replace function public.get_pedido_bolsas_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin  boolean := public.is_admin();
  v_result jsonb;
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() then
    raise exception 'O agente não lê nem grava o pedido de bolsas.' using errcode = '42501';
  end if;

  with pessoas as (
    select h.id, h.full_name
      from public.scholarship_holders h
     where public._bolsista_visivel(h.id)
       and exists (
         select 1
           from public.scholarships s
          where s.holder_id = h.id
            and s.status <> 'cancelled'
            and s.end_date >= current_date - 180
            and (v_admin or s.project_id = any(public.allowed_project_ids()))
       )
  ),
  bolsas as (
    select s.holder_id,
           s.id          as scholarship_id,
           s.project_id,
           p.code,
           s.amount      as valor,
           s.start_date  as inicio,
           s.end_date    as fim,
           s.status,
           (s.start_date <= current_date
            and current_date <= s.end_date
            and s.status in ('active', 'ended')) as vigente_hoje
      from public.scholarships s
      join public.projects p on p.id = s.project_id
     where s.holder_id in (select id from pessoas)
       and s.end_date >= current_date - 180
       and (v_admin or s.project_id = any(public.allowed_project_ids()))
  ),
  vigentes as (
    select b.holder_id, sum(b.valor) as valor_vigente
      from bolsas b
     where b.vigente_hoje
     group by b.holder_id
  ),
  pessoas_json as (
    select p.id as holder_id,
           p.full_name as nome,
           coalesce((select v.valor_vigente from vigentes v where v.holder_id = p.id), 0) as valor_vigente,
           coalesce(
             (
               select jsonb_agg(
                        jsonb_build_object(
                          'scholarship_id', b.scholarship_id,
                          'project_id',     b.project_id,
                          'code',           b.code,
                          'valor',          b.valor,
                          'inicio',         b.inicio,
                          'fim',            b.fim,
                          'status',         b.status,
                          'vigente_hoje',   b.vigente_hoje
                        )
                        order by b.fim desc, b.inicio desc, b.scholarship_id
                      )
                 from bolsas b
                where b.holder_id = p.id
             ),
             '[]'::jsonb
           ) as bolsas
      from pessoas p
  ),
  centros as (
    select distinct p.id, p.code, p.name
      from public.projects p
     where exists (select 1 from bolsas b where b.project_id = p.id)
  ),
  caixas_usuario as (
    select c.id, c.nome, c.meses, c.criado_em
      from public.caixas_pedido c
     where c.dono = auth.uid()
  ),
  itens as (
    select i.caixa_id,
           i.holder_id,
           i.valor_mensal,
           i.nota,
           pj.nome,
           coalesce(i.valor_mensal, v.valor_vigente, 0) as valor_usado
      from public.caixa_pedido_itens i
      join caixas_usuario c on c.id = i.caixa_id
      join pessoas_json pj on pj.holder_id = i.holder_id
      left join vigentes v on v.holder_id = i.holder_id
  ),
  caixas_json as (
    select c.id,
           c.nome,
           c.meses,
           c.criado_em,
           (select count(*) from itens i where i.caixa_id = c.id) as pessoas,
           (select coalesce(sum(i.valor_usado), 0) from itens i where i.caixa_id = c.id) as total_mensal,
           (select coalesce(sum(i.valor_usado), 0) from itens i where i.caixa_id = c.id) * c.meses as total_periodo,
           (select count(*) from public.caixa_pedido_itens i where i.caixa_id = c.id)
             - (select count(*) from itens i where i.caixa_id = c.id) as itens_ocultos,
           coalesce(
             (
               select jsonb_agg(
                        jsonb_build_object(
                          'holder_id',    i.holder_id,
                          'valor_mensal', i.valor_mensal,
                          'valor_usado',  i.valor_usado,
                          'nota',         i.nota
                        )
                        order by i.nome, i.holder_id
                      )
                 from itens i
                where i.caixa_id = c.id
             ),
             '[]'::jsonb
           ) as itens
      from caixas_usuario c
  )
  select jsonb_build_object(
           'centros', coalesce(
             (
               select jsonb_agg(
                        jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name)
                        order by c.code, c.id
                      )
                 from centros c
             ),
             '[]'::jsonb
           ),
           'bolsistas', coalesce(
             (
               select jsonb_agg(
                        jsonb_build_object(
                          'holder_id',     p.holder_id,
                          'nome',          p.nome,
                          'equipe',        e.equipe,
                          'valor_vigente', p.valor_vigente,
                          'bolsas',        p.bolsas
                        )
                        order by p.nome, p.holder_id
                      )
                 from pessoas_json p
                 left join public.bolsista_equipes e on e.holder_id = p.holder_id
             ),
             '[]'::jsonb
           ),
           'caixas', coalesce(
             (
               select jsonb_agg(
                        jsonb_build_object(
                          'id',            c.id,
                          'nome',          c.nome,
                          'meses',         c.meses,
                          'criado_em',     c.criado_em,
                          'pessoas',       c.pessoas,
                          'total_mensal',  c.total_mensal,
                          'total_periodo', c.total_periodo,
                          'itens_ocultos', c.itens_ocultos,
                          'itens',         c.itens
                        )
                        order by c.criado_em, c.id
                      )
                 from caixas_json c
             ),
             '[]'::jsonb
           )
         )
    into v_result;

  return v_result;
end;
$$;

comment on function public.get_pedido_bolsas_v2() is
  'Centros com bolsa listada, bolsistas visíveis (bolsa não cancelada com fim nos últimos 180 dias) e as caixas do próprio usuário, com totais e itens ocultos calculados no banco (mig. 068).';

revoke all on function public.get_pedido_bolsas_v2() from public, anon;
grant execute on function public.get_pedido_bolsas_v2() to authenticated;

-- 4.2 salvar_equipe_bolsista_v2(p_holder_id, p_equipe)
-- Equipe da pessoa; null ou '' apaga a linha.
create or replace function public.salvar_equipe_bolsista_v2(p_holder_id uuid, p_equipe text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_equipe text := nullif(btrim(coalesce(p_equipe, '')), '');
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() then
    raise exception 'O agente não lê nem grava o pedido de bolsas.' using errcode = '42501';
  end if;

  if p_holder_id is null then
    raise exception 'Informe a pessoa.' using errcode = '22023';
  end if;

  if not public._bolsista_visivel(p_holder_id) then
    raise exception 'Pessoa fora do seu escopo.' using errcode = '42501';
  end if;

  if v_equipe is not null and v_equipe not in ('pastagem', 'alertas', 'solos') then
    raise exception 'Equipe inválida.' using errcode = '22023';
  end if;

  if v_equipe is null then
    delete from public.bolsista_equipes where holder_id = p_holder_id;
  else
    insert into public.bolsista_equipes (holder_id, equipe, atualizado_em, atualizado_por)
    values (p_holder_id, v_equipe, now(), auth.uid())
    on conflict (holder_id) do update
      set equipe         = excluded.equipe,
          atualizado_em  = excluded.atualizado_em,
          atualizado_por = excluded.atualizado_por;
  end if;

  return jsonb_build_object('holder_id', p_holder_id, 'equipe', v_equipe);
end;
$$;

comment on function public.salvar_equipe_bolsista_v2(uuid, text) is
  'Define a equipe de uma pessoa visível; null ou vazio apaga a linha. Valor fora de pastagem/alertas/solos devolve 22023 (mig. 068).';

revoke all on function public.salvar_equipe_bolsista_v2(uuid, text) from public, anon;
grant execute on function public.salvar_equipe_bolsista_v2(uuid, text) to authenticated;

-- 4.3 salvar_caixa_pedido_v2(p jsonb)
-- Cria (sem id) ou altera (com id) uma caixa do próprio usuário.
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
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() then
    raise exception 'O agente não lê nem grava o pedido de bolsas.' using errcode = '42501';
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
    select count(*) into v_count
      from public.caixas_pedido c
     where c.dono = auth.uid();

    if v_count >= 10 then
      raise exception 'Limite de 10 caixas por usuário.' using errcode = '22023';
    end if;

    insert into public.caixas_pedido (nome, meses, dono, criado_em, atualizado_em)
    values (v_nome, coalesce(v_meses, 12), auth.uid(), now(), now())
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
     for update;

  if not found then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;

  if v_caixa.dono <> auth.uid() then
    raise exception 'Só o dono altera esta caixa.' using errcode = '42501';
  end if;

  update public.caixas_pedido
     set nome          = v_nome,
         meses         = coalesce(v_meses, v_caixa.meses),
         atualizado_em = now()
   where id = v_id
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
  'Cria sem id (até 10 caixas por dono) ou altera com id (só o dono); aceita apenas id, nome e meses. Recusa CPF no nome (mig. 068).';

revoke all on function public.salvar_caixa_pedido_v2(jsonb) from public, anon;
grant execute on function public.salvar_caixa_pedido_v2(jsonb) to authenticated;

-- 4.4 apagar_caixa_pedido_v2(p_id)
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

  if public.is_agente() then
    raise exception 'O agente não lê nem grava o pedido de bolsas.' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'Informe a caixa.' using errcode = '22023';
  end if;

  select * into v_caixa
    from public.caixas_pedido c
   where c.id = p_id
     for update;

  if not found then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;

  if v_caixa.dono <> auth.uid() then
    raise exception 'Só o dono apaga esta caixa.' using errcode = '42501';
  end if;

  delete from public.caixas_pedido where id = p_id;

  return jsonb_build_object('id', p_id, 'apagada', true);
end;
$$;

comment on function public.apagar_caixa_pedido_v2(uuid) is
  'Apaga uma caixa do próprio usuário (itens caem por cascade). Caixa inexistente devolve P0002; de outra pessoa, 42501 (mig. 068).';

revoke all on function public.apagar_caixa_pedido_v2(uuid) from public, anon;
grant execute on function public.apagar_caixa_pedido_v2(uuid) to authenticated;

-- 4.5 colocar_na_caixa_v2(p_caixa_id, p_holder_id, p_valor_mensal, p_nota)
-- Upsert do item; tira a pessoa das outras caixas do mesmo dono.
create or replace function public.colocar_na_caixa_v2(
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
  v_valor      numeric(14,2);
  v_nota       text;
  v_saiu       jsonb;
  v_valor_uso  numeric;
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() then
    raise exception 'O agente não lê nem grava o pedido de bolsas.' using errcode = '42501';
  end if;

  if p_caixa_id is null or p_holder_id is null then
    raise exception 'Informe a caixa e a pessoa.' using errcode = '22023';
  end if;

  select * into v_caixa
    from public.caixas_pedido c
   where c.id = p_caixa_id
     for update;

  if not found then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;

  if v_caixa.dono <> auth.uid() then
    raise exception 'Só o dono altera esta caixa.' using errcode = '42501';
  end if;

  if not public._bolsista_visivel(p_holder_id) then
    raise exception 'Pessoa fora do seu escopo.' using errcode = '42501';
  end if;

  if p_valor_mensal is not null then
    if p_valor_mensal = 'NaN'::numeric
       or p_valor_mensal in ('Infinity'::numeric, '-Infinity'::numeric)
       or p_valor_mensal <= 0
       or p_valor_mensal > 999999999999.99 then
      raise exception 'Valor mensal deve ser um número positivo e finito.' using errcode = '22023';
    end if;
    v_valor := round(p_valor_mensal, 2)::numeric(14,2);
  end if;

  if p_nota is not null then
    v_nota := nullif(btrim(p_nota), '');
    if p_nota is not null and btrim(p_nota) <> '' and v_nota is null then
      raise exception 'Nota inválida.' using errcode = '22023';
    end if;
    if v_nota is not null and char_length(v_nota) > 300 then
      raise exception 'Nota deve ter até 300 caracteres.' using errcode = '22023';
    end if;
    if v_nota is not null and public._tem_cpf(v_nota) then
      raise exception 'Nota contém sequência no formato de CPF e não pode ser gravada.'
        using errcode = '22023';
    end if;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('caixa_id', c.id, 'nome', c.nome)
             order by c.nome, c.id
           ),
           '[]'::jsonb
         )
    into v_saiu
    from public.caixas_pedido c
   where c.dono = auth.uid()
     and c.id <> p_caixa_id
     and exists (
       select 1 from public.caixa_pedido_itens i
        where i.caixa_id = c.id and i.holder_id = p_holder_id
     );

  delete from public.caixa_pedido_itens i
   using public.caixas_pedido c
   where i.caixa_id = c.id
     and c.dono = auth.uid()
     and c.id <> p_caixa_id
     and i.holder_id = p_holder_id;

  insert into public.caixa_pedido_itens (caixa_id, holder_id, valor_mensal, nota, criado_em)
  values (p_caixa_id, p_holder_id, v_valor, v_nota, now())
  on conflict (caixa_id, holder_id) do update
    set valor_mensal = excluded.valor_mensal,
        nota         = excluded.nota;

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
    'caixa_id',    p_caixa_id,
    'holder_id',   p_holder_id,
    'valor_mensal', v_valor,
    'valor_usado',  v_valor_uso,
    'nota',         v_nota,
    'saiu_de',      v_saiu
  );
end;
$$;

comment on function public.colocar_na_caixa_v2(uuid, uuid, numeric, text) is
  'Coloca ou atualiza uma pessoa visível na caixa do próprio usuário, tira a pessoa das outras caixas do mesmo dono e devolve de quais saiu. Valor nulo usa o vigente; nota e nome sem CPF (mig. 068).';

revoke all on function public.colocar_na_caixa_v2(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.colocar_na_caixa_v2(uuid, uuid, numeric, text) to authenticated;

-- 4.6 tirar_da_caixa_v2(p_caixa_id, p_holder_id)
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

  if public.is_agente() then
    raise exception 'O agente não lê nem grava o pedido de bolsas.' using errcode = '42501';
  end if;

  if p_caixa_id is null or p_holder_id is null then
    raise exception 'Informe a caixa e a pessoa.' using errcode = '22023';
  end if;

  select * into v_caixa
    from public.caixas_pedido c
   where c.id = p_caixa_id
     for update;

  if not found then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;

  if v_caixa.dono <> auth.uid() then
    raise exception 'Só o dono altera esta caixa.' using errcode = '42501';
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
  'Tira uma pessoa da caixa do próprio usuário. Item inexistente devolve P0002; caixa de outra pessoa, 42501 (mig. 068).';

revoke all on function public.tirar_da_caixa_v2(uuid, uuid) from public, anon;
grant execute on function public.tirar_da_caixa_v2(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. Asserções dentro da transação
-- ------------------------------------------------------------
do $$
declare
  v_tab   oid;
  v_fn    oid;
  v_sig   text;
  v_cols  text;
  v_con   text;
  v_def   text;
  v_def_got text;
begin
  foreach v_sig in array array[
    'public.bolsista_equipes',
    'public.caixas_pedido',
    'public.caixa_pedido_itens'
  ] loop
    v_tab := v_sig::regclass;

    if not (select relrowsecurity from pg_class where oid = v_tab) then
      raise exception '068: RLS desligado em %', v_sig;
    end if;

    if exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = split_part(v_sig, '.', 2)
    ) then
      raise exception '068: % não deve ter policy; a ACL é a barreira', v_sig;
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
      raise exception '068: trg_bloqueia_agente ausente ou incorreto em %', v_sig;
    end if;

    if has_table_privilege('anon', v_tab, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception '068: anon possui acesso a %', v_sig;
    end if;
    if has_table_privilege('authenticated', v_tab, 'SELECT')
       or has_table_privilege('authenticated', v_tab, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception '068: authenticated não pode ter acesso direto a %', v_sig;
    end if;
  end loop;

  -- Colunas e tipos das três tabelas.
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = 'public.bolsista_equipes'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'holder_id:uuid, equipe:text, atualizado_em:timestamp with time zone, atualizado_por:uuid' then
    raise exception '068: colunas/tipos inesperados em bolsista_equipes: %', v_cols;
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = 'public.caixas_pedido'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'id:uuid, nome:text, meses:integer, dono:uuid, criado_em:timestamp with time zone, atualizado_em:timestamp with time zone' then
    raise exception '068: colunas/tipos inesperados em caixas_pedido: %', v_cols;
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = 'public.caixa_pedido_itens'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'caixa_id:uuid, holder_id:uuid, valor_mensal:numeric(14,2), nota:text, criado_em:timestamp with time zone' then
    raise exception '068: colunas/tipos inesperados em caixa_pedido_itens: %', v_cols;
  end if;

  -- Definição normalizada de cada CHECK (não só o nome), como a 067.
  for v_con, v_def in
    select * from (values
      ('bolsista_equipes_equipe_check',
       $def$checkequipe=anyarray['pastagem'::text,'alertas'::text,'solos'::text]$def$),
      ('caixas_pedido_meses_check',
       $def$checkmeses>=1andmeses<=60$def$),
      ('caixas_pedido_nome_check',
       $def$checkbtrimnome<>''::textandchar_lengthbtrimnome<=80$def$),
      ('caixa_pedido_itens_nota_check',
       $def$checknotaisnullorbtrimnota<>''::textandchar_lengthbtrimnota<=300$def$),
      ('caixa_pedido_itens_valor_check',
       $def$checkvalor_mensalisnullorvalor_mensal>0::numericandvalor_mensal<>'nan'::numericandvalor_mensal<>'infinity'::numericandvalor_mensal<>'-infinity'::numeric$def$)
    ) as x(con, def)
  loop
    select replace(regexp_replace(lower(pg_get_constraintdef(oid)), '[\s()]', '', 'g'), 'public.', '')
      into v_def_got
      from pg_constraint
     where conrelid in (
             'public.bolsista_equipes'::regclass,
             'public.caixas_pedido'::regclass,
             'public.caixa_pedido_itens'::regclass
           )
       and contype = 'c'
       and conname = v_con;

    if v_def_got is distinct from v_def then
      raise exception '068: CHECK % inesperado: %', v_con, coalesce(v_def_got, '<ausente>');
    end if;
  end loop;

  -- FKs com a ação esperada.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.bolsista_equipes'::regclass and contype = 'f'
       and conname = 'bolsista_equipes_holder_id_fkey' and confdeltype = 'c'
  ) then
    raise exception '068: bolsista_equipes_holder_id_fkey ausente ou sem ON DELETE CASCADE';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.caixas_pedido'::regclass and contype = 'f'
       and conname = 'caixas_pedido_dono_fkey' and confdeltype = 'c'
  ) then
    raise exception '068: caixas_pedido_dono_fkey ausente ou sem ON DELETE CASCADE';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.caixa_pedido_itens'::regclass and contype = 'f'
       and conname = 'caixa_pedido_itens_caixa_id_fkey' and confdeltype = 'c'
  ) then
    raise exception '068: caixa_pedido_itens_caixa_id_fkey ausente ou sem ON DELETE CASCADE';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.caixa_pedido_itens'::regclass and contype = 'f'
       and conname = 'caixa_pedido_itens_holder_id_fkey' and confdeltype = 'c'
  ) then
    raise exception '068: caixa_pedido_itens_holder_id_fkey ausente ou sem ON DELETE CASCADE';
  end if;

  -- Nenhum CHECK pode chamar helper de CPF: a regra é o gatilho definer.
  if exists (
    select 1 from pg_constraint
     where conrelid in (
             'public.bolsista_equipes'::regclass,
             'public.caixas_pedido'::regclass,
             'public.caixa_pedido_itens'::regclass
           )
       and contype = 'c'
       and pg_get_constraintdef(oid) ~* '(contem_cpf|_tem_cpf)'
  ) then
    raise exception '068: CHECK não pode chamar helper de CPF';
  end if;

  -- Índices.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'caixas_pedido'
       and indexname = 'idx_caixas_pedido_dono'
  ) then
    raise exception '068: índice idx_caixas_pedido_dono ausente';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'caixa_pedido_itens'
       and indexname = 'idx_caixa_pedido_itens_holder'
  ) then
    raise exception '068: índice idx_caixa_pedido_itens_holder ausente';
  end if;

  -- RPCs públicas: definer, search_path exato, EXECUTE só para authenticated.
  foreach v_sig in array array[
    'public.get_pedido_bolsas_v2()',
    'public.salvar_equipe_bolsista_v2(uuid, text)',
    'public.salvar_caixa_pedido_v2(jsonb)',
    'public.apagar_caixa_pedido_v2(uuid)',
    'public.colocar_na_caixa_v2(uuid, uuid, numeric, text)',
    'public.tirar_da_caixa_v2(uuid, uuid)'
  ] loop
    v_fn := v_sig::regprocedure;

    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '068: % sem security definer ou search_path exato', v_sig;
    end if;

    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '068: authenticated perdeu EXECUTE em %', v_sig;
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
      raise exception '068: ACL incorreta em %', v_sig;
    end if;
  end loop;

  -- Helpers internos: definer, search_path e nenhum EXECUTE.
  foreach v_sig in array array[
    'public._bolsista_visivel(uuid)',
    'public._caixas_pedido_sem_cpf()',
    'public._caixa_pedido_itens_sem_cpf()'
  ] loop
    v_fn := v_sig::regprocedure;

    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '068: % sem security definer ou search_path exato', v_sig;
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
      raise exception '068: ACL incorreta em %', v_sig;
    end if;
  end loop;

  -- Triggers de CPF por linha.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.caixas_pedido'::regclass
       and t.tgname = 'trg_caixas_pedido_sem_cpf'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and (t.tgtype & 1) <> 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|16)) = (4|16)
       and t.tgfoid = 'public._caixas_pedido_sem_cpf()'::regprocedure
  ) then
    raise exception '068: trg_caixas_pedido_sem_cpf ausente ou incorreto';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.caixa_pedido_itens'::regclass
       and t.tgname = 'trg_caixa_pedido_itens_sem_cpf'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and (t.tgtype & 1) <> 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|16)) = (4|16)
       and t.tgfoid = 'public._caixa_pedido_itens_sem_cpf()'::regprocedure
  ) then
    raise exception '068: trg_caixa_pedido_itens_sem_cpf ausente ou incorreto';
  end if;

  if not exists (
    select 1 from pg_proc
     where oid = 'public.get_pedido_bolsas_v2()'::regprocedure
       and provolatile = 's'
  ) then
    raise exception '068: get_pedido_bolsas_v2 não é STABLE';
  end if;
end $$;

commit;
