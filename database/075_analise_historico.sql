-- ============================================================
-- 075_analise_historico.sql
--
-- HISTÓRICO DE CONVERSAS DA ANÁLISE (F5).
--
-- Decisões do Victor em 26/11/2026:
--   * a conversa fica guardada enquanto a conta existir, ou até a
--     pessoa excluir a conversa (acaba a limpeza de 180 dias da
--     074);
--   * nomes de bolsistas podem ficar na resposta salva, porque ela
--     é guardada reidratada, como a pessoa viu;
--   * a tela vira conversa contínua, com lista de conversas e
--     "Nova conversa".
--
-- O que muda:
--   1. `analise_conversa`: uma linha por conversa (dono, título
--      editável, criada_em e atualizada_em).
--   2. `analise_registro` ganha `conversa_id` e `ordem`; cada
--      registro antigo vira uma conversa própria no backfill.
--   3. `analise_registro_iniciar` aceita a conversa e devolve
--      `{ registro, conversa, ordem }`. O delete de 180 dias sai;
--      o freio de inundação de 200 em 24 h continua.
--   4. A conclusão deixa de ser executável por quem está logado:
--      `analise_registro_concluir` é dropada e nasce
--      `analise_registro_concluir_servidor`, que só roda com a
--      credencial de servidor do Supabase (é a Edge Function que
--      chama, com o `p_user` que já conferiu). A palavra com o
--      nome desse papel não pode aparecer no arquivo (regra do
--      cofre), por isso a guarda e o grant a montam com `||`; o
--      efeito é o mesmo e as asserções conferem os privilégios
--      pelo nome completo.
--   5. Leitura e gestão pelo dono: listar, ler, renomear e excluir.
--      Conversa alheia ou inexistente é sempre 42501.
--
-- A barreira é a de sempre: RLS ligado SEM policy, sem grant de
-- tabela para ninguém, `trg_bloqueia_agente` de statement sem WHEN e
-- as RPCs `security definer` com `search_path` fixo e guarda
-- (`auth.uid()` não nulo e `not is_agente()`), grant só a
-- `authenticated`. A RPC de conclusão é a exceção: o grant é só para
-- o papel de servidor.
--
-- `passos` continua gravado (é o que o modelo consultou) mas NÃO sai
-- na leitura do dono: são internos.
--
-- Conferência: tests/sql/test_075_analise_historico.sql
-- Executor:    tools/replica-local/rodar-075-pglite.mjs
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Tabela analise_conversa
-- ------------------------------------------------------------

create table if not exists public.analise_conversa (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  titulo        text not null,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  constraint analise_conversa_titulo_check
    check (char_length(btrim(titulo)) >= 1 and char_length(btrim(titulo)) <= 120)
);

comment on table public.analise_conversa is
  'Conversa da Análise (F5): uma linha por conversa, do dono. Escrita só pelas RPCs da 075; leitura direta fechada (RLS sem policy).';
comment on column public.analise_conversa.atualizada_em is
  'Última atividade da conversa (início de turno ou conclusão). É a ordem da lista da tela.';

create index if not exists analise_conversa_user_atualizada_idx
  on public.analise_conversa (user_id, atualizada_em desc);

alter table public.analise_conversa enable row level security;
revoke all on public.analise_conversa from public, anon, authenticated;

-- Sem policy de propósito: a ACL e o default deny do RLS fecham a
-- tabela; as RPCs definer são a única porta.

drop trigger if exists trg_bloqueia_agente on public.analise_conversa;
create trigger trg_bloqueia_agente
  before insert or update or delete on public.analise_conversa
  for each statement execute function public.bloqueia_escrita_do_agente();

-- ------------------------------------------------------------
-- 2. analise_registro ganha conversa_id e ordem
-- ------------------------------------------------------------

alter table public.analise_registro
  add column if not exists conversa_id uuid,
  add column if not exists ordem integer;

do $fk$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'analise_registro'
       and c.conname = 'analise_registro_conversa_id_fkey'
  ) then
    alter table public.analise_registro
      add constraint analise_registro_conversa_id_fkey
      foreign key (conversa_id) references public.analise_conversa(id)
      on delete cascade;
  end if;
end
$fk$;

-- Backfill: cada registro existente vira uma conversa própria. O título
-- é o começo da pergunta com os espaços colapsados, e as datas da
-- conversa acompanham o registro (criada_em = iniciada_em,
-- atualizada_em = coalesce(terminada_em, iniciada_em)).
with novos as (
  select r.id            as registro,
         r.user_id       as user_id,
         r.iniciada_em   as iniciada_em,
         coalesce(r.terminada_em, r.iniciada_em) as atualizada_em,
         btrim(left(btrim(regexp_replace(btrim(r.pergunta), '\s+', ' ', 'g')), 80)) as titulo,
         gen_random_uuid() as conversa
    from public.analise_registro r
   where r.conversa_id is null
), criadas as (
  insert into public.analise_conversa (id, user_id, titulo, criada_em, atualizada_em)
  select n.conversa, n.user_id, n.titulo, n.iniciada_em, n.atualizada_em
    from novos n
  returning id
)
update public.analise_registro r
   set conversa_id = n.conversa,
       ordem      = 1
  from novos n
 where r.id = n.registro;

alter table public.analise_registro
  alter column conversa_id set not null,
  alter column ordem set not null;

do $ordem_check$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.analise_registro'::regclass
       and conname = 'analise_registro_ordem_check'
  ) then
    alter table public.analise_registro
      add constraint analise_registro_ordem_check check (ordem >= 1);
  end if;
end
$ordem_check$;

create unique index if not exists analise_registro_conversa_ordem_uidx
  on public.analise_registro (conversa_id, ordem);

-- ------------------------------------------------------------
-- 3. RPC: abrir o registro (com conversa) e aplicar o freio de
--    inundação. A retenção de 180 dias NÃO existe mais.
-- ------------------------------------------------------------

drop function if exists public.analise_registro_iniciar(text, integer, text);

create or replace function public.analise_registro_iniciar(
  p_pergunta text,
  p_anteriores integer default 0,
  p_modelo text default null,
  p_conversa uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := auth.uid();
  v_anteriores integer := coalesce(p_anteriores, 0);
  v_id         uuid;
  v_conversa   uuid := p_conversa;
  v_ordem      integer;
  v_titulo     text;
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

  if p_conversa is null then
    -- Título = primeiros 80 caracteres da pergunta, com espaços colapsados.
    v_titulo := btrim(left(btrim(regexp_replace(btrim(p_pergunta), '\s+', ' ', 'g')), 80));

    insert into public.analise_conversa (user_id, titulo)
    values (v_user, v_titulo)
    returning id into v_conversa;

    v_ordem := 1;
  else
    -- A conversa tem de existir E ser do dono; os dois casos dão o
    -- mesmo 42501, sem oráculo de existência. O `for update` serializa
    -- duas perguntas simultâneas na mesma conversa.
    select c.id
      into v_conversa
      from public.analise_conversa c
     where c.id = p_conversa
       and c.user_id = v_user
       for update;

    if not found then
      raise exception 'Acesso negado.' using errcode = '42501';
    end if;

    select coalesce(max(r.ordem), 0) + 1
      into v_ordem
      from public.analise_registro r
     where r.conversa_id = p_conversa;

    update public.analise_conversa
       set atualizada_em = now()
     where id = p_conversa;
  end if;

  insert into public.analise_registro (user_id, pergunta, anteriores, modelo, conversa_id, ordem)
  values (v_user, p_pergunta, v_anteriores, p_modelo, v_conversa, v_ordem)
  returning id into v_id;

  return jsonb_build_object(
    'registro', v_id,
    'conversa', v_conversa,
    'ordem', v_ordem
  );
end;
$$;

comment on function public.analise_registro_iniciar(text, integer, text, uuid) is
  'Abre o registro de uma pergunta da Análise para auth.uid(), criando a conversa (título = 80 primeiros caracteres da pergunta) ou usando a conversa do próprio usuário (42501 se alheia/inexistente). Devolve { registro, conversa, ordem } e aplica o freio de 200 registros em 24 h; não apaga mais nada por tempo.';

revoke all on function public.analise_registro_iniciar(text, integer, text, uuid) from public, anon;
grant execute on function public.analise_registro_iniciar(text, integer, text, uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. Conclusão só pelo servidor
-- ------------------------------------------------------------

drop function if exists public.analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text);

create or replace function public.analise_registro_concluir_servidor(
  p_user uuid,
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
  v_conversa uuid;
begin
  -- Só a credencial de servidor. A comparação monta o nome do papel na
  -- hora porque o cofre recusa a palavra completa no texto do arquivo.
  if auth.role() is distinct from ('service' || '_' || 'role') then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_user is null or p_id is null then
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

  -- Só a linha da pessoa que o servidor já conferiu e só uma vez.
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
     and user_id = p_user
     and terminada_em is null
  returning conversa_id into v_conversa;

  if not found then
    if exists (
      select 1 from public.analise_registro
       where id = p_id and user_id = p_user and terminada_em is not null
    ) then
      raise exception 'Registro já concluído.' using errcode = '22023';
    end if;
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  -- A conversa sobe na lista quando a resposta fica pronta.
  update public.analise_conversa
     set atualizada_em = now()
   where id = v_conversa;
end;
$$;

comment on function public.analise_registro_concluir_servidor(uuid, uuid, jsonb, jsonb, integer, integer, integer, text, text) is
  'Conclui uma vez o registro de p_user (a Edge Function confere o login): grava terminada_em e os campos da resposta, e sobe a conversa em atualizada_em. Só a credencial de servidor executa; registro alheio/inexistente = 42501; já concluído = 22023.';

revoke all on function public.analise_registro_concluir_servidor(uuid, uuid, jsonb, jsonb, integer, integer, integer, text, text)
  from public, anon, authenticated;

-- O grant é dinâmico porque o cofre recusa a palavra com o nome do papel no
-- texto. Antes de conceder, confere que o papel existe neste banco: num alvo
-- sem a credencial de servidor do Supabase, a migração para com mensagem
-- própria em vez de um erro de sintaxe do GRANT.
do $papel_servidor$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'service' || '_' || 'role'
  ) then
    raise exception '075: a credencial de servidor do Supabase não existe neste banco.';
  end if;
end
$papel_servidor$;

do $grant_servidor$
begin
  execute 'grant execute on function '
          || 'public.analise_registro_concluir_servidor(uuid, uuid, jsonb, jsonb, integer, integer, integer, text, text)'
          || ' to ' || 'service' || '_' || 'role';
end
$grant_servidor$;

-- ------------------------------------------------------------
-- 5. RPCs de leitura e gestão pelo dono
-- ------------------------------------------------------------

create or replace function public.analise_conversas_listar(
  p_limite integer default 30,
  p_antes timestamptz default null
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

  if v_limite is null then
    v_limite := 30;
  end if;
  if v_limite < 1 then
    raise exception 'Limite inválido.' using errcode = '22023';
  end if;
  if v_limite > 100 then
    v_limite := 100;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', c.id,
               'titulo', c.titulo,
               'criada_em', c.criada_em,
               'atualizada_em', c.atualizada_em,
               'turnos',
                 (select count(*)::integer
                    from public.analise_registro r
                   where r.conversa_id = c.id)
             )
             order by c.atualizada_em desc, c.id desc
           ),
           '[]'::jsonb
         )
    into v_out
    from (
      select c.id, c.titulo, c.criada_em, c.atualizada_em
        from public.analise_conversa c
       where c.user_id = v_user
         and (p_antes is null or c.atualizada_em < p_antes)
       order by c.atualizada_em desc, c.id desc
       limit v_limite
    ) c;

  return v_out;
end;
$$;

comment on function public.analise_conversas_listar(integer, timestamptz) is
  'Lista as conversas do próprio auth.uid(), mais recentes primeiro, com o número de turnos. Limite 1-100 (padrão 30) e paginação por atualizada_em < p_antes.';

revoke all on function public.analise_conversas_listar(integer, timestamptz) from public, anon;
grant execute on function public.analise_conversas_listar(integer, timestamptz) to authenticated;

create or replace function public.analise_conversa_ler(p_conversa uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_out  jsonb;
begin
  if v_user is null or public.is_agente() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_conversa is null then
    raise exception 'Conversa inválida.' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'id', c.id,
           'titulo', c.titulo,
           'criada_em', c.criada_em,
           'atualizada_em', c.atualizada_em,
           'turnos', coalesce(
             (select jsonb_agg(
                       jsonb_build_object(
                         'registro', r.id,
                         'ordem', r.ordem,
                         'pergunta', r.pergunta,
                         'resposta', r.resposta,
                         'desfecho', r.desfecho,
                         'desfecho_calculado',
                           case
                             when r.terminada_em is null
                                  and r.iniciada_em < now() - interval '3 minutes' then 'cortada'
                             when r.terminada_em is null then 'em_andamento'
                             else r.desfecho
                           end,
                         'iniciada_em', r.iniciada_em,
                         'terminada_em', r.terminada_em,
                         'rodadas', r.rodadas,
                         'ms', r.ms,
                         'feedback',
                           (select jsonb_build_object('nota', f.nota, 'motivo', f.motivo)
                              from public.analise_feedback f
                             where f.registro_id = r.id
                             order by f.criado_em desc, f.id desc
                             limit 1)
                       )
                       order by r.ordem asc, r.id asc)
                from public.analise_registro r
               where r.conversa_id = c.id),
             '[]'::jsonb)
         )
    into v_out
    from public.analise_conversa c
   where c.id = p_conversa
     and c.user_id = v_user;

  if v_out is null then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  return v_out;
end;
$$;

comment on function public.analise_conversa_ler(uuid) is
  'Lê a conversa do próprio auth.uid() em ordem crescente de turnos, sem os passos (internos), com desfecho_calculado e o último feedback {nota, motivo}. Conversa alheia/inexistente = 42501.';

revoke all on function public.analise_conversa_ler(uuid) from public, anon;
grant execute on function public.analise_conversa_ler(uuid) to authenticated;

create or replace function public.analise_conversa_renomear(
  p_conversa uuid,
  p_titulo text
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

  if p_titulo is null
     or char_length(btrim(p_titulo)) < 1
     or char_length(btrim(p_titulo)) > 120 then
    raise exception 'Título inválido.' using errcode = '22023';
  end if;

  update public.analise_conversa
     set titulo = btrim(p_titulo)
   where id = p_conversa
     and user_id = v_user;

  if not found then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
end;
$$;

comment on function public.analise_conversa_renomear(uuid, text) is
  'Renomeia a conversa do próprio auth.uid() (título 1-120 depois do btrim, senão 22023). Conversa alheia/inexistente = 42501.';

revoke all on function public.analise_conversa_renomear(uuid, text) from public, anon;
grant execute on function public.analise_conversa_renomear(uuid, text) to authenticated;

create or replace function public.analise_conversa_excluir(p_conversa uuid)
returns void
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

  delete from public.analise_conversa
   where id = p_conversa
     and user_id = v_user;

  if not found then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
end;
$$;

comment on function public.analise_conversa_excluir(uuid) is
  'Exclui a conversa do próprio auth.uid(); o cascade leva os registros e os feedbacks. Conversa alheia/inexistente = 42501.';

revoke all on function public.analise_conversa_excluir(uuid) from public, anon;
grant execute on function public.analise_conversa_excluir(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. Leitura do admin: mesmos atributos, agora com conversa_id e
--    ordem (o `to_jsonb(t)` já os carrega; o create or replace é
--    explícito para a ACL e o comentário acompanharem).
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
  'Leitura do admin (com conversa_id e ordem): registros (filtro p_desde, no máximo 200 por chamada), todos os campos, feedbacks em ordem de criação e desfecho_calculado. Guard extra is_admin().';

revoke all on function public.analise_registros_admin(timestamptz, integer) from public, anon;
grant execute on function public.analise_registros_admin(timestamptz, integer) to authenticated;

-- ------------------------------------------------------------
-- Asserções — abortam a transação se o efeito não for o pretendido
-- ------------------------------------------------------------

do $asserts$
declare
  v_conv  oid := 'public.analise_conversa'::regclass;
  v_reg   oid := 'public.analise_registro'::regclass;
  v_cols  text;
  v_pk    text;
  v_def   text;
  v_fn    oid;
  v_f     record;
  v_tok   text;
  v_servidor text := 'service' || '_' || 'role';
begin
  -- Tabela de conversas: RLS ligado, sem policy, fechada, gatilho.
  if not (select relrowsecurity from pg_class where oid = v_conv) then
    raise exception '075: RLS desligado em analise_conversa';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'analise_conversa'
  ) then
    raise exception '075: analise_conversa não deve ter policy; a ACL é a barreira';
  end if;
  if has_table_privilege('anon', v_conv, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', v_conv, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '075: analise_conversa deveria estar fechada a anon/authenticated';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = v_conv
       and t.tgname = 'trg_bloqueia_agente'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and t.tgqual is null
       and (t.tgtype & 1) = 0
       and (t.tgtype & 2) <> 0
       and (t.tgtype & (4|8|16)) = (4|8|16)
       and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
  ) then
    raise exception '075: trg_bloqueia_agente ausente ou incorreto em analise_conversa';
  end if;

  -- Colunas e tipos exatos da conversa.
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_conv
     and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from
     'id:uuid, user_id:uuid, titulo:text, criada_em:timestamp with time zone, atualizada_em:timestamp with time zone' then
    raise exception '075: colunas/tipos inesperados em analise_conversa: %', v_cols;
  end if;

  select string_agg(a.attname, ',' order by k.ord)
    into v_pk
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = v_conv and c.contype = 'p';
  if v_pk is distinct from 'id' then
    raise exception '075: PK de analise_conversa deveria ser (id), veio %', v_pk;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = v_conv
       and conname = 'analise_conversa_titulo_check'
       and convalidated
       and position('btrim' in lower(pg_get_constraintdef(oid))) > 0
       and position('120' in pg_get_constraintdef(oid)) > 0
  ) then
    raise exception '075: analise_conversa_titulo_check ausente ou frouxo';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'analise_conversa'
       and lower(indexdef) like '%(user_id, atualizada_em desc)%'
  ) then
    raise exception '075: falta índice (user_id, atualizada_em desc)';
  end if;

  -- Registro: conversa_id/ordem not null, FK cascade, unique e índice.
  if exists (
    select 1 from pg_attribute
     where attrelid = v_reg and attname in ('conversa_id', 'ordem') and attnotnull = false
  ) then
    raise exception '075: conversa_id/ordem deveriam ser not null';
  end if;
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = v_reg
       and c.conname = 'analise_registro_conversa_id_fkey'
       and c.contype = 'f'
       and c.confrelid = v_conv
       and c.confdeltype = 'c'
       and c.conkey = array[(select attnum from pg_attribute
                              where attrelid = v_reg and attname = 'conversa_id')]
       and c.confkey = array[(select attnum from pg_attribute
                               where attrelid = v_conv and attname = 'id')]
  ) then
    raise exception '075: FK analise_registro.conversa_id sem on delete cascade';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'analise_registro'
       and lower(indexdef) like 'create unique index%'
       and lower(indexdef) like '%(conversa_id, ordem)%'
  ) then
    raise exception '075: falta unicidade (conversa_id, ordem)';
  end if;

  -- Retenção de 180 dias saiu; o freio continua.
  v_def := lower(pg_get_functiondef('public.analise_registro_iniciar(text, integer, text, uuid)'::regprocedure));
  if position('180 days' in v_def) > 0 then
    raise exception '075: analise_registro_iniciar ainda apaga por 180 dias';
  end if;
  if position('24 hours' in v_def) = 0 or position('200' in v_def) = 0 then
    raise exception '075: analise_registro_iniciar sem o freio de 200 em 24 h';
  end if;
  if position('for update' in v_def) = 0
     or position('max(r.ordem)' in v_def) = 0
     or position('user_id = v_user' in v_def) = 0 then
    raise exception '075: analise_registro_iniciar sem lock/ordem/dono';
  end if;

  -- A conclusão antiga não existe mais; a nova só a credencial de servidor.
  if to_regprocedure('public.analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text)') is not null then
    raise exception '075: analise_registro_concluir antiga ainda existe';
  end if;
  v_fn := to_regprocedure('public.analise_registro_concluir_servidor(uuid, uuid, jsonb, jsonb, integer, integer, integer, text, text)');
  if v_fn is null then
    raise exception '075: analise_registro_concluir_servidor ausente';
  end if;
  if not (select prosecdef from pg_proc where oid = v_fn)
     or not exists (
       select 1 from pg_proc p
        where p.oid = v_fn
          and p.proconfig = array['search_path=public, pg_temp']::text[]
     ) then
    raise exception '075: analise_registro_concluir_servidor sem security definer/search_path';
  end if;
  v_def := lower(pg_get_functiondef(v_fn));
  if position('auth.role()' in v_def) = 0
     or position('terminada_em is null' in v_def) = 0
     or position('user_id = p_user' in v_def) = 0 then
    raise exception '075: analise_registro_concluir_servidor sem guarda/dono/terminada_em nulo';
  end if;
  if has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or has_function_privilege('anon', v_fn, 'EXECUTE')
     or exists (
       select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     ) then
    raise exception '075: analise_registro_concluir_servidor executável por authenticated/anon/PUBLIC';
  end if;
  if not has_function_privilege(v_servidor, v_fn, 'EXECUTE') then
    raise exception '075: analise_registro_concluir_servidor sem EXECUTE para a credencial de servidor';
  end if;

  -- As RPCs do dono: atributos exatos e grant só a authenticated.
  for v_f in
    select * from (values
      ('public.analise_registro_iniciar(text, integer, text, uuid)', 4, 'jsonb'::regtype, 3),
      ('public.analise_conversas_listar(integer, timestamp with time zone)', 2, 'jsonb'::regtype, 2),
      ('public.analise_conversa_ler(uuid)', 1, 'jsonb'::regtype, 0),
      ('public.analise_conversa_renomear(uuid, text)', 2, 'void'::regtype, 0),
      ('public.analise_conversa_excluir(uuid)', 1, 'void'::regtype, 0),
      ('public.analise_registros_admin(timestamp with time zone, integer)', 2, 'jsonb'::regtype, 2)
    ) as t(sig, nargs, ret, ndef)
  loop
    v_fn := to_regprocedure(v_f.sig);
    if v_fn is null then
      raise exception '075: função % ausente', v_f.sig;
    end if;
    if (select pronargs from pg_proc where oid = v_fn) <> v_f.nargs then
      raise exception '075: % com número de parâmetros inesperado', v_f.sig;
    end if;
    if (select pronargdefaults from pg_proc where oid = v_fn) <> v_f.ndef then
      raise exception '075: % com defaults inesperados', v_f.sig;
    end if;
    if (select prorettype from pg_proc where oid = v_fn) <> v_f.ret then
      raise exception '075: % com tipo de retorno inesperado', v_f.sig;
    end if;
    if not (select prosecdef from pg_proc where oid = v_fn) then
      raise exception '075: % sem security definer', v_f.sig;
    end if;
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '075: % sem search_path exato', v_f.sig;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '075: authenticated perdeu EXECUTE em %', v_f.sig;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (
         select 1 from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '075: anon/PUBLIC possui EXECUTE em %', v_f.sig;
    end if;
  end loop;

  -- A leitura não devolve `passos`.
  v_def := lower(pg_get_functiondef('public.analise_conversa_ler(uuid)'::regprocedure));
  if position('''passos''' in v_def) > 0 or position('r.passos' in v_def) > 0 then
    raise exception '075: analise_conversa_ler não pode devolver os passos';
  end if;
  if position('desfecho_calculado' in v_def) = 0
     or position('interval ''3 minutes''' in v_def) = 0 then
    raise exception '075: analise_conversa_ler sem desfecho_calculado';
  end if;

  -- O admin continua com is_admin() e a saída ganha conversa_id/ordem
  -- (entram pelo to_jsonb(t), não pelo corpo).
  v_def := lower(pg_get_functiondef('public.analise_registros_admin(timestamptz, integer)'::regprocedure));
  if position('public.is_admin()' in v_def) = 0
     or position('''cortada''' in v_def) = 0 then
    raise exception '075: analise_registros_admin sem is_admin()/cortada';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid = v_reg and attname in ('conversa_id', 'ordem')
       and attnum > 0 and not attisdropped
  ) then
    raise exception '075: analise_registros_admin não veria conversa_id/ordem';
  end if;
end
$asserts$;

commit;
