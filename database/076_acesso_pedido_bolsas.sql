-- A aba de montagem do pedido de bolsas fica disponível por conta.
-- A Análise usa get_pedido_bolsas_v2 para consultar bolsas e mascarar nomes.
-- Contas sem a permissão seguem recebendo as bolsas do seu escopo, com
-- equipes nulas e caixas vazias. As sete gravações exigem a permissão.
-- A concessão inicial é feita pelo admin após a migração, por ID de login.
-- Não há IDs de contas reais nesta migração.

begin;

alter table public.app_users
  add column if not exists pode_bolsistas boolean not null default false;

create or replace function public._pode_montar_pedido_bolsas()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.app_users u
     where u.user_id = auth.uid()
       and u.role in ('professor', 'admin')
       and u.pode_bolsistas
  );
$$;

revoke all on function public._pode_montar_pedido_bolsas() from public, anon, authenticated;

create or replace function public.definir_acesso_bolsistas_v2(p_user_id uuid, p_permitir boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin() or public.is_agente() or public.is_automacao(null) then
    raise exception 'Só um administrador pode mudar o acesso a Bolsistas.' using errcode = '42501';
  end if;
  if p_permitir is null then
    raise exception 'Informe se a conta pode acessar Bolsistas.' using errcode = '22023';
  end if;

  update public.app_users
     set pode_bolsistas = p_permitir
   where user_id = p_user_id and role in ('professor', 'admin');
  if not found then
    raise exception 'Conta elegível não encontrada.' using errcode = 'P0002';
  end if;
  return p_permitir;
end;
$$;

revoke all on function public.definir_acesso_bolsistas_v2(uuid, boolean) from public, anon;
grant execute on function public.definir_acesso_bolsistas_v2(uuid, boolean) to authenticated;

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
  v_pode_pedido boolean := public._pode_montar_pedido_bolsas();
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_users u where u.user_id = auth.uid()) then
    raise exception 'Acesso negado ao pedido de bolsas.' using errcode = '42501';
  end if;

  if public.is_agente() or public.is_automacao(null) then
    raise exception 'O agente e a automação não leem nem gravam o pedido de bolsas.' using errcode = '42501';
  end if;

  with pessoas as (
    select h.id, h.full_name
      from public.scholarship_holders h
     where public._bolsista_no_pedido(h.id)
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
     where v_pode_pedido and c.dono = auth.uid()
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
                 left join public.bolsista_equipes e on v_pode_pedido and e.holder_id = p.holder_id
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

revoke all on function public.get_pedido_bolsas_v2() from public, anon;
grant execute on function public.get_pedido_bolsas_v2() to authenticated;

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

  if public.is_agente() or public.is_automacao(null) then
    raise exception 'O agente e a automação não leem nem gravam o pedido de bolsas.' using errcode = '42501';
  end if;

  if not public._pode_montar_pedido_bolsas() then
    raise exception 'Esta conta não tem acesso ao pedido de bolsas.' using errcode = '42501';
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

revoke all on function public.salvar_equipe_bolsista_v2(uuid, text) from public, anon;
grant execute on function public.salvar_equipe_bolsista_v2(uuid, text) to authenticated;

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

  if not public._pode_montar_pedido_bolsas() then
    raise exception 'Esta conta não tem acesso ao pedido de bolsas.' using errcode = '42501';
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

revoke all on function public.salvar_caixa_pedido_v2(jsonb) from public, anon;
grant execute on function public.salvar_caixa_pedido_v2(jsonb) to authenticated;

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

  if not public._pode_montar_pedido_bolsas() then
    raise exception 'Esta conta não tem acesso ao pedido de bolsas.' using errcode = '42501';
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

revoke all on function public.apagar_caixa_pedido_v2(uuid) from public, anon;
grant execute on function public.apagar_caixa_pedido_v2(uuid) to authenticated;

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

  if not public._pode_montar_pedido_bolsas() then
    raise exception 'Esta conta não tem acesso ao pedido de bolsas.' using errcode = '42501';
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

revoke all on function public.colocar_na_caixa_v2(uuid, uuid) from public, anon;
grant execute on function public.colocar_na_caixa_v2(uuid, uuid) to authenticated;

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

  if not public._pode_montar_pedido_bolsas() then
    raise exception 'Esta conta não tem acesso ao pedido de bolsas.' using errcode = '42501';
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

revoke all on function public.editar_item_caixa_v2(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.editar_item_caixa_v2(uuid, uuid, numeric, text) to authenticated;

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

  if not public._pode_montar_pedido_bolsas() then
    raise exception 'Esta conta não tem acesso ao pedido de bolsas.' using errcode = '42501';
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

revoke all on function public.tirar_da_caixa_v2(uuid, uuid) from public, anon;
grant execute on function public.tirar_da_caixa_v2(uuid, uuid) to authenticated;

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

  if not public._pode_montar_pedido_bolsas() then
    raise exception 'Esta conta não tem acesso ao pedido de bolsas.' using errcode = '42501';
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

revoke all on function public.limpar_ocultos_da_caixa_v2(uuid) from public, anon;
grant execute on function public.limpar_ocultos_da_caixa_v2(uuid) to authenticated;

comment on function public.get_pedido_bolsas_v2() is
  'Centros e bolsas do escopo da conta. Equipes e caixas só para quem tem acesso ao pedido.';

do $$
declare
  v_assinatura text;
  v_funcao regprocedure;
begin
  foreach v_assinatura in array array[
    'public.get_pedido_bolsas_v2()',
    'public.salvar_equipe_bolsista_v2(uuid, text)',
    'public.salvar_caixa_pedido_v2(jsonb)',
    'public.apagar_caixa_pedido_v2(uuid)',
    'public.colocar_na_caixa_v2(uuid, uuid)',
    'public.editar_item_caixa_v2(uuid, uuid, numeric, text)',
    'public.tirar_da_caixa_v2(uuid, uuid)',
    'public.limpar_ocultos_da_caixa_v2(uuid)',
    'public.definir_acesso_bolsistas_v2(uuid, boolean)'
  ] loop
    v_funcao := v_assinatura::regprocedure;
    if has_function_privilege('anon', v_funcao, 'execute')
       or not has_function_privilege('authenticated', v_funcao, 'execute')
       or not exists (
         select 1 from pg_proc
          where oid = v_funcao and prosecdef
            and proconfig @> array['search_path=public, pg_temp']
       ) then
      raise exception '076: ACL ou atributos inesperados em %', v_assinatura;
    end if;
  end loop;
  if has_function_privilege('anon', 'public._pode_montar_pedido_bolsas()', 'execute')
     or has_function_privilege('authenticated', 'public._pode_montar_pedido_bolsas()', 'execute') then
    raise exception '076: helper interno exposto';
  end if;
end;
$$;

commit;
