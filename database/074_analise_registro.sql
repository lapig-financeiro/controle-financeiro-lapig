-- ============================================================
-- 074_analise_registro.sql
--
-- REGISTRO DAS PERGUNTAS DA ANÁLISE (F5) E FEEDBACK.
--
-- A Análise roda numa Edge Function do Supabase. Até aqui ela não
-- guardava nada: pergunta, resposta e passos morriam com a
-- requisição, e a pessoa não tinha como dizer que a resposta veio
-- errada ou cortada. O Victor pediu (26/11/2026) que as perguntas
-- e o que a pessoa viu ficassem no banco para estudar o uso e
-- conferir a qualidade — e que o corte deixasse de ser silencioso.
--
-- O registro vai para o BANCO, atrás de RLS. Continua sem log na
-- Edge Function e no Worker: nada de pergunta, argumento, resultado
-- ou texto no log.
--
--   analise_registro   uma linha por pergunta
--   analise_feedback   uma linha por feedback (nota/motivo/comentário)
--
-- QUEM ESCREVE: só as RPCs desta migração, sempre com
-- `user_id = auth.uid()`. Ninguém escreve direto nas tabelas
-- (revoke all de public/anon/authenticated). QUEM LÊ: o admin pela
-- `analise_registros_admin()`; o próprio usuário não tem RPC de
-- leitura nesta etapa, e a tabela é fechada também para ele.
--
-- RETENÇÃO: 180 dias, apagados pela própria `analise_registro_iniciar()`
-- e somente as linhas do próprio usuário. O `on delete cascade` da
-- `analise_feedback` limpa os feedbacks antigos junto.
--
-- DESFECHO CALCULADO: `terminada_em` nulo não distingue "ainda
-- rodando" de "o runtime matou a função". A RPC do admin devolve
-- `desfecho_calculado`: `cortada` quando a linha passou de 3 minutos
-- sem terminar (o prazo do núcleo é 120 s), `em_andamento` dentro dos
-- 3 minutos e, depois de terminada, o `desfecho` gravado.
--
-- A barreira é a de sempre: RLS ligado SEM policy, sem grant de
-- tabela para ninguém, `trg_bloqueia_agente` de statement sem WHEN e
-- as RPCs `security definer` com `search_path` fixo e guarda
-- (`auth.uid()` não nulo e `not is_agente()`). A RPC do admin tem a
-- guarda extra `is_admin()`. Só `authenticated` executa as RPCs;
-- `anon` e `PUBLIC` não.
--
-- Conferência: tests/sql/test_074_analise_registro.sql
-- Executor:    tools/replica-local/rodar-074-pglite.mjs
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Tabela analise_registro
-- ------------------------------------------------------------

create table if not exists public.analise_registro (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  iniciada_em  timestamptz not null default now(),
  terminada_em timestamptz,
  pergunta     text not null,
  anteriores   integer not null default 0,
  modelo       text,
  resposta     jsonb,
  passos       jsonb,
  rodadas      integer,
  ms           integer,
  chamadas     integer,
  desfecho     text,
  codigo_erro  text,
  constraint analise_registro_pergunta_check
    check (char_length(btrim(pergunta)) >= 1 and char_length(pergunta) <= 2000),
  constraint analise_registro_anteriores_check
    check (anteriores between 0 and 5),
  constraint analise_registro_modelo_check
    check (modelo is null or char_length(modelo) <= 200),
  constraint analise_registro_resposta_check
    check (resposta is null or octet_length(resposta::text) <= 262144),
  constraint analise_registro_passos_check
    check (passos is null or octet_length(passos::text) <= 262144),
  constraint analise_registro_rodadas_check
    check (rodadas is null or rodadas >= 0),
  constraint analise_registro_ms_check
    check (ms is null or ms >= 0),
  constraint analise_registro_chamadas_check
    check (chamadas is null or chamadas >= 0),
  constraint analise_registro_desfecho_check
    check (desfecho is null or desfecho in ('ok', 'erro', 'incompleta', 'tempo', 'limite', 'desconectado')),
  constraint analise_registro_codigo_erro_check
    check (codigo_erro is null or char_length(codigo_erro) <= 64)
);

comment on table public.analise_registro is
  'Registro da Análise (F5): uma linha por pergunta, com o que a pessoa viu. Escrita só pelas RPCs da 074; leitura direta fechada e leitura do admin pela analise_registros_admin().';
comment on column public.analise_registro.resposta is
  'Texto e blocos como a pessoa os viu (reidratados). Limite de 256 KB em octet_length.';
comment on column public.analise_registro.passos is
  'Passos do laço com as ferramentas e os argumentos mascarados que o modelo usou. Limite de 256 KB.';
comment on column public.analise_registro.desfecho is
  'ok/erro/incompleta/tempo/limite/desconectado; nulo enquanto a análise não terminou (ver desfecho_calculado na RPC do admin).';

create index if not exists analise_registro_user_iniciada_idx
  on public.analise_registro (user_id, iniciada_em desc);
create index if not exists analise_registro_iniciada_idx
  on public.analise_registro (iniciada_em desc);

-- ------------------------------------------------------------
-- 2. Tabela analise_feedback
-- ------------------------------------------------------------

create table if not exists public.analise_feedback (
  id          uuid primary key default gen_random_uuid(),
  registro_id uuid not null references public.analise_registro(id) on delete cascade,
  user_id     uuid not null,
  criado_em   timestamptz not null default now(),
  nota        smallint,
  comentario  text,
  motivo      text,
  constraint analise_feedback_nota_check
    check (nota is null or nota in (-1, 1)),
  constraint analise_feedback_comentario_check
    check (comentario is null or char_length(comentario) <= 2000),
  constraint analise_feedback_motivo_check
    check (motivo is null or motivo in ('errado', 'cortada', 'incompleta', 'melhorar', 'outro')),
  constraint analise_feedback_conteudo_check
    check (nota is not null or motivo is not null or (comentario is not null and btrim(comentario) <> ''))
);

comment on table public.analise_feedback is
  'Feedback da Análise (F5): nota (-1/1), motivo e comentário, sempre no registro do próprio usuário. Leitura direta fechada; o admin recebe os feedbacks dentro da analise_registros_admin().';
comment on column public.analise_feedback.motivo is
  'errado/cortada/incompleta/melhorar/outro, ou nulo quando só há nota/comentário.';

create index if not exists analise_feedback_registro_criado_idx
  on public.analise_feedback (registro_id, criado_em desc);

-- ------------------------------------------------------------
-- 3. Barreiras de tabela
-- ------------------------------------------------------------

alter table public.analise_registro enable row level security;
revoke all on public.analise_registro from public, anon, authenticated;

alter table public.analise_feedback enable row level security;
revoke all on public.analise_feedback from public, anon, authenticated;

-- Sem policy de propósito: a ACL e o default deny do RLS fecham as
-- tabelas. Se alguém conceder SELECT no futuro, nada vaza.

drop trigger if exists trg_bloqueia_agente on public.analise_registro;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.analise_registro
  for each statement execute function public.bloqueia_escrita_do_agente();

drop trigger if exists trg_bloqueia_agente on public.analise_feedback;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.analise_feedback
  for each statement execute function public.bloqueia_escrita_do_agente();

-- ------------------------------------------------------------
-- 4. RPC: abrir o registro (e aplicar a retenção de 180 dias)
-- ------------------------------------------------------------

create or replace function public.analise_registro_iniciar(
  p_pergunta text,
  p_anteriores integer default 0,
  p_modelo text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := auth.uid();
  v_anteriores integer := coalesce(p_anteriores, 0);
  v_id         uuid;
begin
  -- Guarda: só pessoa logada e que não é o agente (Buriti).
  if v_user is null or public.is_agente() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_pergunta is null
     or char_length(btrim(p_pergunta)) < 1
     or char_length(p_pergunta) > 2000 then
    raise exception 'Pergunta inválida.' using errcode = '22023';
  end if;

  if v_anteriores < 0 or v_anteriores > 5 then
    raise exception 'Anteriores fora do intervalo.' using errcode = '22023';
  end if;

  if p_modelo is not null and char_length(p_modelo) > 200 then
    raise exception 'Modelo longo demais.' using errcode = '22023';
  end if;

  -- Retenção: só as linhas do próprio usuário. O cascade da
  -- analise_feedback leva os feedbacks antigos junto.
  delete from public.analise_registro
   where user_id = v_user
     and iniciada_em < now() - interval '180 days';

  -- Freio de inundação no banco: impede que uma chamada direta à RPC
  -- por fora da Edge Function encha o banco (teto folgado de 200 em 24 h).
  if (
    select count(*)
      from public.analise_registro
     where user_id = v_user
       and iniciada_em >= now() - interval '24 hours'
  ) >= 200 then
    raise exception 'Limite diário de registros atingido.' using errcode = '54000';
  end if;

  insert into public.analise_registro (user_id, pergunta, anteriores, modelo)
  values (v_user, p_pergunta, v_anteriores, p_modelo)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.analise_registro_iniciar(text, integer, text) is
  'Abre o registro de uma pergunta da Análise para auth.uid() e apaga as linhas do próprio usuário com mais de 180 dias. Guard: auth.uid() não nulo e not is_agente().';

revoke all on function public.analise_registro_iniciar(text, integer, text) from public, anon;
grant execute on function public.analise_registro_iniciar(text, integer, text) to authenticated;

-- ------------------------------------------------------------
-- 5. RPC: concluir o registro (uma vez, só o dono)
-- ------------------------------------------------------------

create or replace function public.analise_registro_concluir(
  p_id uuid,
  p_resposta jsonb,
  p_passos jsonb,
  p_rodadas integer,
  p_ms integer,
  p_chamadas integer,
  p_desfecho text,
  p_codigo_erro text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or public.is_agente() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'Registro inválido.' using errcode = '22023';
  end if;

  if p_desfecho is null
     or p_desfecho not in ('ok', 'erro', 'incompleta', 'tempo', 'limite', 'desconectado') then
    raise exception 'Desfecho inválido.' using errcode = '22023';
  end if;

  if p_resposta is not null and octet_length(p_resposta::text) > 262144 then
    raise exception 'Resposta acima de 256 KB.' using errcode = '22023';
  end if;

  if p_passos is not null and octet_length(p_passos::text) > 262144 then
    raise exception 'Passos acima de 256 KB.' using errcode = '22023';
  end if;

  if p_codigo_erro is not null and char_length(p_codigo_erro) > 64 then
    raise exception 'Código de erro longo demais.' using errcode = '22023';
  end if;

  -- Somente a linha do próprio usuário e somente uma vez.
  update public.analise_registro
     set terminada_em = now(),
         resposta     = p_resposta,
         passos       = p_passos,
         rodadas      = p_rodadas,
         ms           = p_ms,
         chamadas     = p_chamadas,
         desfecho     = p_desfecho,
         codigo_erro  = p_codigo_erro
   where id = p_id
     and user_id = v_user
     and terminada_em is null;

  if not found then
    -- Distinguir "já concluído" de "não é seu / não existe": os dois
    -- são erro, nunca no-op silencioso.
    if exists (
      select 1 from public.analise_registro
       where id = p_id and user_id = v_user and terminada_em is not null
    ) then
      raise exception 'Registro já concluído.' using errcode = '22023';
    end if;
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
end;
$$;

comment on function public.analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text) is
  'Conclui uma vez o registro do próprio auth.uid(): grava terminada_em e os campos da resposta. Registro de outro usuário/inexistente = 42501; já concluído = 22023.';

revoke all on function public.analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text) from public, anon;
grant execute on function public.analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text) to authenticated;

-- ------------------------------------------------------------
-- 6. RPC: enviar feedback (só no registro do próprio usuário)
-- ------------------------------------------------------------

create or replace function public.analise_feedback_enviar(
  p_registro_id uuid,
  p_nota smallint default null,
  p_motivo text default null,
  p_comentario text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  if v_user is null or public.is_agente() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  -- O registro tem de existir E ser do usuário; os dois casos dão o
  -- mesmo 42501, sem oráculo de existência.
  if not exists (
    select 1 from public.analise_registro
     where id = p_registro_id and user_id = v_user
  ) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_nota is not null and p_nota not in (-1, 1) then
    raise exception 'Nota inválida.' using errcode = '22023';
  end if;

  if p_motivo is not null
     and p_motivo not in ('errado', 'cortada', 'incompleta', 'melhorar', 'outro') then
    raise exception 'Motivo inválido.' using errcode = '22023';
  end if;

  if p_comentario is not null and char_length(p_comentario) > 2000 then
    raise exception 'Comentário acima de 2000 caracteres.' using errcode = '22023';
  end if;

  if p_nota is null
     and p_motivo is null
     and (p_comentario is null or btrim(p_comentario) = '') then
    raise exception 'Feedback vazio.' using errcode = '22023';
  end if;

  insert into public.analise_feedback (registro_id, user_id, nota, motivo, comentario)
  values (p_registro_id, v_user, p_nota, p_motivo, p_comentario)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.analise_feedback_enviar(uuid, smallint, text, text) is
  'Grava nota (-1/1), motivo e/ou comentário no registro do próprio auth.uid(). Registro alheio/inexistente = 42501; feedback vazio = 22023.';

revoke all on function public.analise_feedback_enviar(uuid, smallint, text, text) from public, anon;
grant execute on function public.analise_feedback_enviar(uuid, smallint, text, text) to authenticated;

-- ------------------------------------------------------------
-- 7. RPC: leitura do admin (registros + feedbacks + desfecho calculado)
-- ------------------------------------------------------------

create or replace function public.analise_registros_admin(
  p_desde timestamptz default null,
  p_limite integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_limite integer := p_limite;
  v_out    jsonb;
begin
  if v_user is null or public.is_agente() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if not public.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if v_limite is null then
    v_limite := 50;
  end if;
  if v_limite < 1 then
    raise exception 'Limite inválido.' using errcode = '22023';
  end if;
  if v_limite > 200 then
    v_limite := 200;
  end if;

  select coalesce(
           jsonb_agg(
             to_jsonb(t) || jsonb_build_object(
               'desfecho_calculado',
                 case
                   when t.terminada_em is null
                        and t.iniciada_em < now() - interval '3 minutes' then 'cortada'
                   when t.terminada_em is null then 'em_andamento'
                   else t.desfecho
                 end,
               'feedbacks',
                 (select coalesce(jsonb_agg(to_jsonb(f) order by f.criado_em asc, f.id asc), '[]'::jsonb)
                    from public.analise_feedback f
                   where f.registro_id = t.id)
             )
             order by t.iniciada_em desc, t.id desc
           ),
           '[]'::jsonb
         )
    into v_out
    from (
      select r.*
        from public.analise_registro r
       where p_desde is null or r.iniciada_em >= p_desde
       order by r.iniciada_em desc, r.id desc
       limit v_limite
    ) t;

  return v_out;
end;
$$;

comment on function public.analise_registros_admin(timestamptz, integer) is
  'Leitura do admin: registros (filtro p_desde, no máximo 200 por chamada), todos os campos, feedbacks em ordem de criação e desfecho_calculado (cortada/em_andamento/desfecho). Guard extra is_admin().';

revoke all on function public.analise_registros_admin(timestamptz, integer) from public, anon;
grant execute on function public.analise_registros_admin(timestamptz, integer) to authenticated;

-- ------------------------------------------------------------
-- Asserções — abortam a transação se o efeito não for o pretendido
-- ------------------------------------------------------------

do $asserts$
declare
  v_reg  oid := 'public.analise_registro'::regclass;
  v_fb   oid := 'public.analise_feedback'::regclass;
  v_cols text;
  v_pk   text;
  v_def  text;
  v_fn   oid;
  v_c    record;
  v_f    record;
  v_tok  text;
begin
  -- Tabelas: RLS ligado e nenhuma policy (default deny).
  if not (select relrowsecurity from pg_class where oid = v_reg) then
    raise exception '074: RLS desligado em analise_registro';
  end if;
  if not (select relrowsecurity from pg_class where oid = v_fb) then
    raise exception '074: RLS desligado em analise_feedback';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename in ('analise_registro', 'analise_feedback')
  ) then
    raise exception '074: analise_registro/analise_feedback não devem ter policy; a ACL é a barreira';
  end if;

  -- Colunas e tipos exatos.
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_reg
     and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from
     'id:uuid, user_id:uuid, iniciada_em:timestamp with time zone, terminada_em:timestamp with time zone, '
     'pergunta:text, anteriores:integer, modelo:text, resposta:jsonb, passos:jsonb, '
     'rodadas:integer, ms:integer, chamadas:integer, desfecho:text, codigo_erro:text' then
    raise exception '074: colunas/tipos inesperados em analise_registro: %', v_cols;
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_fb
     and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from
     'id:uuid, registro_id:uuid, user_id:uuid, criado_em:timestamp with time zone, '
     'nota:smallint, comentario:text, motivo:text' then
    raise exception '074: colunas/tipos inesperados em analise_feedback: %', v_cols;
  end if;

  -- PK de cada tabela é o id.
  select string_agg(a.attname, ',' order by k.ord)
    into v_pk
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = v_reg and c.contype = 'p';
  if v_pk is distinct from 'id' then
    raise exception '074: PK de analise_registro deveria ser (id), veio %', v_pk;
  end if;

  select string_agg(a.attname, ',' order by k.ord)
    into v_pk
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = v_fb and c.contype = 'p';
  if v_pk is distinct from 'id' then
    raise exception '074: PK de analise_feedback deveria ser (id), veio %', v_pk;
  end if;

  -- FK do feedback: registro_id -> analise_registro(id) on delete cascade.
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = v_fb
       and c.contype = 'f'
       and c.confrelid = v_reg
       and c.confdeltype = 'c'
       and c.conkey = array[(select attnum from pg_attribute
                              where attrelid = v_fb and attname = 'registro_id')]
       and c.confkey = array[(select attnum from pg_attribute
                               where attrelid = v_reg and attname = 'id')]
  ) then
    raise exception '074: FK analise_feedback.registro_id sem on delete cascade';
  end if;

  -- Constraints: quantidade, validação e conteúdo.
  if exists (
    select 1 from pg_constraint
     where conrelid in (v_reg, v_fb) and not convalidated
  ) then
    raise exception '074: constraint não validada nas tabelas do registro';
  end if;
  if (select count(*) from pg_constraint where conrelid = v_reg and contype = 'c') <> 10 then
    raise exception '074: analise_registro deveria ter 10 checks';
  end if;
  if (select count(*) from pg_constraint where conrelid = v_fb and contype = 'c') <> 4 then
    raise exception '074: analise_feedback deveria ter 4 checks';
  end if;

  for v_c in
    select * from (values
      ('analise_registro', 'analise_registro_pergunta_check',
       array['char_length(btrim(pergunta))', '2000']),
      ('analise_registro', 'analise_registro_anteriores_check',
       array['>= 0', '<= 5']),
      ('analise_registro', 'analise_registro_modelo_check',
       array['is null', '200']),
      ('analise_registro', 'analise_registro_resposta_check',
       array['octet_length', '262144']),
      ('analise_registro', 'analise_registro_passos_check',
       array['octet_length', '262144']),
      ('analise_registro', 'analise_registro_rodadas_check',
       array['>= 0']),
      ('analise_registro', 'analise_registro_ms_check',
       array['>= 0']),
      ('analise_registro', 'analise_registro_chamadas_check',
       array['>= 0']),
      ('analise_registro', 'analise_registro_desfecho_check',
       array['''ok''', '''erro''', '''incompleta''', '''tempo''', '''limite''', '''desconectado''']),
      ('analise_registro', 'analise_registro_codigo_erro_check',
       array['64']),
      ('analise_feedback', 'analise_feedback_nota_check',
       array['-1', '1']),
      ('analise_feedback', 'analise_feedback_comentario_check',
       array['2000']),
      ('analise_feedback', 'analise_feedback_motivo_check',
       array['''errado''', '''cortada''', '''incompleta''', '''melhorar''', '''outro''']),
      ('analise_feedback', 'analise_feedback_conteudo_check',
       array['nota is not null', 'motivo is not null', 'btrim(comentario)'])
    ) as t(tabela, nome, tokens)
  loop
    select lower(pg_get_constraintdef(c.oid))
      into v_def
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = v_c.tabela
       and c.conname = v_c.nome;
    if v_def is null then
      raise exception '074: constraint % ausente em %', v_c.nome, v_c.tabela;
    end if;
    foreach v_tok in array v_c.tokens loop
      if position(v_tok in v_def) = 0 then
        raise exception '074: constraint % sem "%"', v_c.nome, v_tok;
      end if;
    end loop;
  end loop;

  -- Índices de consulta.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'analise_registro'
       and lower(indexdef) like '%(user_id, iniciada_em desc)%'
  ) then
    raise exception '074: falta índice (user_id, iniciada_em desc)';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'analise_registro'
       and lower(indexdef) like '%(iniciada_em desc)%'
  ) then
    raise exception '074: falta índice (iniciada_em desc)';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'analise_feedback'
       and lower(indexdef) like '%(registro_id, criado_em desc)%'
  ) then
    raise exception '074: falta índice (registro_id, criado_em desc)';
  end if;

  -- Barreira do agente: statement, sem WHEN, INSERT/UPDATE/DELETE.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = v_reg
       and t.tgname = 'trg_bloqueia_agente'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and t.tgqual is null
       and (t.tgtype & 1) = 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|8|16)) = (4|8|16)
       and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
  ) then
    raise exception '074: trg_bloqueia_agente ausente ou incorreto em analise_registro';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = v_fb
       and t.tgname = 'trg_bloqueia_agente'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and t.tgqual is null
       and (t.tgtype & 1) = 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|8|16)) = (4|8|16)
       and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
  ) then
    raise exception '074: trg_bloqueia_agente ausente ou incorreto em analise_feedback';
  end if;

  -- Tabelas fechadas para anon e authenticated (só as definer escrevem).
  if has_table_privilege('anon', v_reg, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', v_reg, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '074: analise_registro deveria estar fechada a anon/authenticated';
  end if;
  if has_table_privilege('anon', v_fb, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', v_fb, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '074: analise_feedback deveria estar fechada a anon/authenticated';
  end if;

  -- Exatamente as 4 RPCs, sem overload extra.
  if (select count(*) from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname in ('analise_registro_iniciar', 'analise_registro_concluir',
                         'analise_feedback_enviar', 'analise_registros_admin')) <> 4 then
    raise exception '074: deveria existir exatamente uma função de cada RPC do registro';
  end if;

  for v_f in
    select * from (values
      ('public.analise_registro_iniciar(text, integer, text)', 3, 'uuid'::regtype, 2),
      ('public.analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text)',
       8, 'void'::regtype, 1),
      ('public.analise_feedback_enviar(uuid, smallint, text, text)', 4, 'uuid'::regtype, 3),
      ('public.analise_registros_admin(timestamp with time zone, integer)', 2, 'jsonb'::regtype, 2)
    ) as t(sig, nargs, ret, ndef)
  loop
    v_fn := to_regprocedure(v_f.sig);
    if v_fn is null then
      raise exception '074: função % ausente', v_f.sig;
    end if;
    if (select pronargs from pg_proc where oid = v_fn) <> v_f.nargs then
      raise exception '074: % com número de parâmetros inesperado', v_f.sig;
    end if;
    if (select pronargdefaults from pg_proc where oid = v_fn) <> v_f.ndef then
      raise exception '074: % com defaults inesperados', v_f.sig;
    end if;
    if (select prorettype from pg_proc where oid = v_fn) <> v_f.ret then
      raise exception '074: % com tipo de retorno inesperado', v_f.sig;
    end if;
    if not (select prosecdef from pg_proc where oid = v_fn) then
      raise exception '074: % sem security definer', v_f.sig;
    end if;
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '074: % sem search_path exato', v_f.sig;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '074: authenticated perdeu EXECUTE em %', v_f.sig;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (
         select 1 from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '074: anon/PUBLIC possui EXECUTE em %', v_f.sig;
    end if;
  end loop;

  -- A retenção só pode tocar o próprio usuário e o desfecho é calculado.
  v_def := lower(pg_get_functiondef('public.analise_registro_iniciar(text, integer, text)'::regprocedure));
  if position('user_id = v_user' in v_def) = 0
     or position('interval ''180 days''' in v_def) = 0 then
    raise exception '074: analise_registro_iniciar sem retenção de 180 dias do próprio usuário';
  end if;
  v_def := lower(pg_get_functiondef('public.analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text)'::regprocedure));
  if position('terminada_em is null' in v_def) = 0
     or position('user_id = v_user' in v_def) = 0 then
    raise exception '074: analise_registro_concluir sem dono/terminada_em nulo';
  end if;
  v_def := lower(pg_get_functiondef('public.analise_registros_admin(timestamptz, integer)'::regprocedure));
  if position('public.is_admin()' in v_def) = 0
     or position('''cortada''' in v_def) = 0
     or position('interval ''3 minutes''' in v_def) = 0 then
    raise exception '074: analise_registros_admin sem is_admin()/cortada';
  end if;
end
$asserts$;

commit;
