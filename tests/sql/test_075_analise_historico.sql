-- ============================================================
-- Roteiro de conferência da migração 075 (histórico de conversas)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-075-pglite.mjs
-- Antes da 075, o roteiro falha já no TRUNCATE:
--   relation "public.analise_conversa" does not exist
--
-- Identidades da base 064: a1 = admin ('Victor'),
-- b1 = professor, c1 = agente (Buriti), d1 = usuário sintético
-- sem cadastro (para as conversas de paginação). Todos os UUIDs são
-- sintéticos.
--
-- O roteiro inteiro roda numa transação e termina em ROLLBACK: as
-- contagens não vazam para a próxima execução. As asserções são
-- inline (sem função em pg_temp) porque o roteiro troca de papel
-- com `set local role`. As leituras diretas nas tabelas só rodam
-- depois de `reset role`: authenticated não tem SELECT (é o que a
-- ACL prova nos BLOCOS 1 e 3).
-- ============================================================
\set ON_ERROR_STOP on

begin;

-- Prova a existência das tabelas cedo: antes da 075 isto aborta o roteiro.
truncate public.analise_conversa, public.analise_registro, public.analise_feedback cascade;

-- ------------------------------------------------------------
-- BLOCO 1 — estrutura, constraints, índices, ACL e atributos
-- ------------------------------------------------------------
do $$
declare
  v_conv oid := 'public.analise_conversa'::regclass;
  v_reg  oid := 'public.analise_registro'::regclass;
  v_cols text;
  v_pk   text;
  v_def  text;
  v_fn   oid;
  v_f    record;
  v_servidor text := 'service' || '_' || 'role';
begin
  if not (select relrowsecurity from pg_class where oid = v_conv) then
    raise exception '075 FALHOU: RLS desligado em analise_conversa';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'analise_conversa'
  ) then
    raise exception '075 FALHOU: analise_conversa não deve ter policy';
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_conv and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from
     'id:uuid, user_id:uuid, titulo:text, criada_em:timestamp with time zone, atualizada_em:timestamp with time zone' then
    raise exception '075 FALHOU: colunas/tipos inesperados em analise_conversa: %', v_cols;
  end if;

  select string_agg(a.attname, ',' order by k.ord)
    into v_pk
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = v_conv and c.contype = 'p';
  if v_pk is distinct from 'id' then
    raise exception '075 FALHOU: PK de analise_conversa deveria ser (id), veio %', v_pk;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = v_conv
       and conname = 'analise_conversa_titulo_check'
       and convalidated
  ) then
    raise exception '075 FALHOU: analise_conversa_titulo_check ausente';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'analise_conversa'
       and lower(indexdef) like '%(user_id, atualizada_em desc)%'
  ) then
    raise exception '075 FALHOU: falta índice (user_id, atualizada_em desc)';
  end if;

  if exists (
    select 1 from pg_attribute
     where attrelid = v_reg and attname in ('conversa_id', 'ordem') and attnotnull = false
  ) then
    raise exception '075 FALHOU: conversa_id/ordem deveriam ser not null';
  end if;

  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = v_reg
       and c.conname = 'analise_registro_conversa_id_fkey'
       and c.contype = 'f'
       and c.confrelid = v_conv
       and c.confdeltype = 'c'
  ) then
    raise exception '075 FALHOU: FK conversa_id sem on delete cascade';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'analise_registro'
       and lower(indexdef) like 'create unique index%'
       and lower(indexdef) like '%(conversa_id, ordem)%'
  ) then
    raise exception '075 FALHOU: falta unicidade (conversa_id, ordem)';
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
    raise exception '075 FALHOU: trg_bloqueia_agente ausente ou incorreto em analise_conversa';
  end if;

  if has_table_privilege('anon', v_conv, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', v_conv, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '075 FALHOU: analise_conversa deveria estar fechada a anon/authenticated';
  end if;

  if (select count(*) from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname in ('analise_registro_iniciar', 'analise_registro_concluir',
                         'analise_registro_concluir_servidor', 'analise_conversas_listar',
                         'analise_conversa_ler', 'analise_conversa_renomear',
                         'analise_conversa_excluir', 'analise_feedback_enviar',
                         'analise_registros_admin')) <> 8 then
    raise exception '075 FALHOU: conjunto de funções inesperado (deveria haver 8)';
  end if;
  if to_regprocedure('public.analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text)') is not null then
    raise exception '075 FALHOU: analise_registro_concluir antiga ainda existe';
  end if;

  for v_f in
    select * from (values
      ('public.analise_registro_iniciar(text, integer, text, uuid)', 4, 'jsonb'::regtype, 3),
      ('public.analise_conversas_listar(integer, timestamp with time zone)', 2, 'jsonb'::regtype, 2),
      ('public.analise_conversa_ler(uuid)', 1, 'jsonb'::regtype, 0),
      ('public.analise_conversa_renomear(uuid, text)', 2, 'void'::regtype, 0),
      ('public.analise_conversa_excluir(uuid)', 1, 'void'::regtype, 0),
      ('public.analise_feedback_enviar(uuid, smallint, text, text)', 4, 'uuid'::regtype, 3),
      ('public.analise_registros_admin(timestamp with time zone, integer)', 2, 'jsonb'::regtype, 2)
    ) as t(sig, nargs, ret, ndef)
  loop
    v_fn := to_regprocedure(v_f.sig);
    if v_fn is null then
      raise exception '075 FALHOU: função % ausente', v_f.sig;
    end if;
    if (select pronargs from pg_proc where oid = v_fn) <> v_f.nargs then
      raise exception '075 FALHOU: % com parâmetros inesperados', v_f.sig;
    end if;
    if (select pronargdefaults from pg_proc where oid = v_fn) <> v_f.ndef then
      raise exception '075 FALHOU: % com defaults inesperados', v_f.sig;
    end if;
    if (select prorettype from pg_proc where oid = v_fn) <> v_f.ret then
      raise exception '075 FALHOU: % com retorno inesperado', v_f.sig;
    end if;
    if not (select prosecdef from pg_proc where oid = v_fn) then
      raise exception '075 FALHOU: % sem security definer', v_f.sig;
    end if;
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '075 FALHOU: % sem search_path exato', v_f.sig;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '075 FALHOU: authenticated perdeu EXECUTE em %', v_f.sig;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (
         select 1 from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '075 FALHOU: anon/PUBLIC possui EXECUTE em %', v_f.sig;
    end if;
  end loop;

  v_fn := to_regprocedure('public.analise_registro_concluir_servidor(uuid, uuid, jsonb, jsonb, integer, integer, integer, text, text)');
  if v_fn is null then
    raise exception '075 FALHOU: analise_registro_concluir_servidor ausente';
  end if;
  if has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or has_function_privilege('anon', v_fn, 'EXECUTE')
     or exists (
       select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     ) then
    raise exception '075 FALHOU: concluir_servidor executável por authenticated/anon/PUBLIC';
  end if;
  if not has_function_privilege(v_servidor, v_fn, 'EXECUTE') then
    raise exception '075 FALHOU: concluir_servidor sem EXECUTE para a credencial de servidor';
  end if;

  v_def := lower(pg_get_functiondef('public.analise_registro_iniciar(text, integer, text, uuid)'::regprocedure));
  if position('180 days' in v_def) > 0 then
    raise exception '075 FALHOU: iniciar ainda apaga por 180 dias';
  end if;
  if position('24 hours' in v_def) = 0
     or position('for update' in v_def) = 0
     or position('max(r.ordem)' in v_def) = 0
     or position('user_id = v_user' in v_def) = 0 then
    raise exception '075 FALHOU: iniciar sem freio, lock, ordem ou dono';
  end if;

  v_def := lower(pg_get_functiondef('public.analise_registro_concluir_servidor(uuid, uuid, jsonb, jsonb, integer, integer, integer, text, text)'::regprocedure));
  if position('auth.role()' in v_def) = 0
     or position('terminada_em is null' in v_def) = 0
     or position('user_id = p_user' in v_def) = 0 then
    raise exception '075 FALHOU: concluir_servidor sem guarda, dono ou terminada_em nulo';
  end if;

  v_def := lower(pg_get_functiondef('public.analise_conversa_ler(uuid)'::regprocedure));
  if position('r.passos' in v_def) > 0 or position('''passos''' in v_def) > 0 then
    raise exception '075 FALHOU: analise_conversa_ler devolve passos';
  end if;
  if position('desfecho_calculado' in v_def) = 0
     or position('interval ''3 minutes''' in v_def) = 0 then
    raise exception '075 FALHOU: analise_conversa_ler sem desfecho_calculado';
  end if;

  raise notice '075 BLOCO 1 ok: estrutura, constraints, índices, ACL e atributos';
end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — recusas: anon, sem JWT e agente
-- ------------------------------------------------------------
set local role anon;
do $$
begin
  begin
    perform public.analise_registro_iniciar('pergunta');
    raise exception '075 FALHOU: anon abriu registro';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analise_conversas_listar();
    raise exception '075 FALHOU: anon listou conversas';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analise_conversa_ler('00000000-0000-0000-0000-000000000001'::uuid);
    raise exception '075 FALHOU: anon leu conversa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analise_conversa_renomear('00000000-0000-0000-0000-000000000001'::uuid, 'x');
    raise exception '075 FALHOU: anon renomeou conversa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analise_conversa_excluir('00000000-0000-0000-0000-000000000001'::uuid);
    raise exception '075 FALHOU: anon excluiu conversa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analise_registro_concluir_servidor(
      '00000000-0000-0000-0000-0000000000a1'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      null, null, null, null, null, 'ok');
    raise exception '075 FALHOU: anon concluiu registro';
  exception when insufficient_privilege then null;
  end;
  raise notice '075 BLOCO 2 ok: anon recusado';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.analise_registro_iniciar('pergunta sem login');
    raise exception '075 FALHOU: authenticated sem JWT abriu registro';
  exception when insufficient_privilege then
    if sqlerrm <> 'Acesso negado.' then
      raise exception '075 FALHOU: sem JWT barrado pelo motivo errado (%)', sqlerrm;
    end if;
  end;
  begin
    perform public.analise_conversas_listar();
    raise exception '075 FALHOU: authenticated sem JWT listou';
  exception when insufficient_privilege then
    if sqlerrm <> 'Acesso negado.' then
      raise exception '075 FALHOU: sem JWT listou pelo motivo errado (%)', sqlerrm;
    end if;
  end;
  raise notice '075 BLOCO 2 ok: sem JWT recusado';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$
begin
  begin
    perform public.analise_registro_iniciar('pergunta do agente');
    raise exception '075 FALHOU: agente abriu registro';
  exception when insufficient_privilege then
    if sqlerrm <> 'Acesso negado.' then
      raise exception '075 FALHOU: agente barrado pelo motivo errado (%)', sqlerrm;
    end if;
  end;
  begin
    perform public.analise_conversas_listar();
    raise exception '075 FALHOU: agente listou conversas';
  exception when insufficient_privilege then
    if sqlerrm <> 'Acesso negado.' then
      raise exception '075 FALHOU: agente listou pelo motivo errado (%)', sqlerrm;
    end if;
  end;
  raise notice '075 BLOCO 2 ok: agente recusado';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 3 — leitura e escrita diretas recusadas
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
begin
  begin
    perform 1 from public.analise_conversa;
    raise exception '075 FALHOU: authenticated leu analise_conversa direto';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.analise_conversa (user_id, titulo)
    values ('00000000-0000-0000-0000-0000000000a1', 'direto');
    raise exception '075 FALHOU: authenticated gravou direto em analise_conversa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.analise_registro;
    raise exception '075 FALHOU: authenticated leu analise_registro direto';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analise_registro_concluir_servidor(
      '00000000-0000-0000-0000-0000000000a1'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      null, null, null, null, null, 'ok');
    raise exception '075 FALHOU: authenticated executou concluir_servidor';
  exception when insufficient_privilege then null;
  end;
  raise notice '075 BLOCO 3 ok: leitura/escrita diretas e conclusão recusadas';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 4 — conversa do dono: criação, ordem, lista, leitura e renome
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  v jsonb;
begin
  v := public.analise_registro_iniciar('  Quanto   o 30.910 tem livre?  ', 2, 'modelo-sintetico');
  if v->>'registro' is null or v->>'conversa' is null or (v->>'ordem')::integer <> 1 then
    raise exception '075 FALHOU: iniciar sem conversa não devolveu {registro, conversa, ordem=1}: %', v;
  end if;
  perform set_config('teste.conv_a', v->>'conversa', true);
  perform set_config('teste.reg_a1', v->>'registro', true);

  v := public.analise_registro_iniciar('Segunda pergunta', 0, null, (v->>'conversa')::uuid);
  if (v->>'conversa')::uuid <> current_setting('teste.conv_a')::uuid
     or (v->>'ordem')::integer <> 2 then
    raise exception '075 FALHOU: segundo turno não entrou na mesma conversa com ordem 2: %', v;
  end if;
  perform set_config('teste.reg_a2', v->>'registro', true);

  v := public.analise_conversas_listar();
  if jsonb_array_length(v) <> 1 then
    raise exception '075 FALHOU: listar deveria devolver 1 conversa de A: %', v;
  end if;
  if (v->0->>'id')::uuid <> current_setting('teste.conv_a')::uuid
     or (v->0->>'turnos')::integer <> 2
     or v->0->>'titulo' <> 'Quanto o 30.910 tem livre?'
     or v->0->'criada_em' is null
     or v->0->'atualizada_em' is null then
    raise exception '075 FALHOU: item da lista com campos errados: %', v->0;
  end if;

  v := public.analise_conversa_ler(current_setting('teste.conv_a')::uuid);
  if v->>'id' is null or v->>'titulo' is null then
    raise exception '075 FALHOU: ler não devolveu o cabeçalho';
  end if;
  if jsonb_array_length(v->'turnos') <> 2 then
    raise exception '075 FALHOU: ler deveria devolver 2 turnos, veio %', jsonb_array_length(v->'turnos');
  end if;
  if (v->'turnos'->0->>'ordem')::integer <> 1
     or (v->'turnos'->1->>'ordem')::integer <> 2
     or v->'turnos'->0->>'pergunta' <> '  Quanto   o 30.910 tem livre?  ' then
    raise exception '075 FALHOU: turnos fora de ordem ou pergunta errada: %', v->'turnos';
  end if;
  if v->'turnos'->0 ? 'passos' or v->'turnos'->1 ? 'passos' then
    raise exception '075 FALHOU: ler devolveu passos';
  end if;
  if v->'turnos'->0->>'desfecho_calculado' <> 'em_andamento'
     or v->'turnos'->0->>'resposta' is not null
     or v->'turnos'->0->>'feedback' is not null then
    raise exception '075 FALHOU: turno em andamento com resposta/feedback/desfecho errado: %', v->'turnos'->0;
  end if;

  perform public.analise_conversa_renomear(current_setting('teste.conv_a')::uuid, '  Contas do 30.910  ');
  begin
    perform public.analise_conversa_renomear(current_setting('teste.conv_a')::uuid, '   ');
    raise exception '075 FALHOU: título em branco aceito';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_conversa_renomear(current_setting('teste.conv_a')::uuid, repeat('t', 121));
    raise exception '075 FALHOU: título acima de 120 aceito';
  exception when sqlstate '22023' then null;
  end;

  raise notice '075 BLOCO 4 ok: criação, ordem, lista, leitura e renome';
end $$;
reset role;

do $$
declare
  v_titulo text;
begin
  if not exists (
    select 1 from public.analise_conversa
     where id = current_setting('teste.conv_a')::uuid
       and user_id = '00000000-0000-0000-0000-0000000000a1'
  ) then
    raise exception '075 FALHOU: conversa criada com dono errado';
  end if;
  select titulo into v_titulo
    from public.analise_conversa where id = current_setting('teste.conv_a')::uuid;
  if v_titulo <> 'Contas do 30.910' then
    raise exception '075 FALHOU: renomear não gravou o btrim (%)', v_titulo;
  end if;
  if not exists (
    select 1 from public.analise_registro
     where id = current_setting('teste.reg_a1')::uuid
       and conversa_id = current_setting('teste.conv_a')::uuid
       and ordem = 1
       and anteriores = 2
       and modelo = 'modelo-sintetico'
  ) then
    raise exception '075 FALHOU: registro novo sem conversa/ordem/anteriores/modelo';
  end if;
  raise notice '075 BLOCO 4 ok: linha e conversa gravadas';
end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — A não lê/renomeia/exclui/continua a conversa de B
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
declare
  v_conv uuid := current_setting('teste.conv_a')::uuid;
  v_b    jsonb;
begin
  v_b := public.analise_registro_iniciar('Pergunta de B');
  perform set_config('teste.conv_b', v_b->>'conversa', true);
  perform set_config('teste.reg_b', v_b->>'registro', true);

  if jsonb_array_length(public.analise_conversas_listar()) <> 1 then
    raise exception '075 FALHOU: B não deveria ver a conversa de A';
  end if;
  if (public.analise_conversas_listar()->0->>'id')::uuid = v_conv then
    raise exception '075 FALHOU: listar de B devolveu a conversa de A';
  end if;

  begin
    perform public.analise_conversa_ler(v_conv);
    raise exception '075 FALHOU: B leu a conversa de A';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.analise_conversa_renomear(v_conv, 'invadida');
    raise exception '075 FALHOU: B renomeou a conversa de A';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.analise_conversa_excluir(v_conv);
    raise exception '075 FALHOU: B excluiu a conversa de A';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.analise_registro_iniciar('invasão', 0, null, v_conv);
    raise exception '075 FALHOU: B continuou a conversa de A';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.analise_registro_iniciar('invasão', 0, null,
      '00000000-0000-0000-0000-0000000000ff'::uuid);
    raise exception '075 FALHOU: conversa inexistente aceita';
  exception when sqlstate '42501' then null;
  end;

  raise notice '075 BLOCO 5 ok: B não toca a conversa de A';
end $$;
reset role;

do $$
begin
  if (select count(*) from public.analise_registro
       where conversa_id = current_setting('teste.conv_a')::uuid) <> 2 then
    raise exception '075 FALHOU: a conversa de A mudou depois das tentativas de B';
  end if;
  if (select titulo from public.analise_conversa
       where id = current_setting('teste.conv_a')::uuid) <> 'Contas do 30.910' then
    raise exception '075 FALHOU: B renomeou a conversa de A';
  end if;
  raise notice '075 BLOCO 5 ok: conversa de A intacta';
end $$;

-- ------------------------------------------------------------
-- BLOCO 6 — conclusão só pela credencial de servidor
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service' || '_' || 'role') then
    raise exception '075 FALHOU: o ambiente de teste não criou a credencial de servidor';
  end if;
end $$;

set local role service_role;
select set_config('request.jwt.claim.role', 'service' || '_' || 'role', true);
do $$
declare
  v_resp jsonb := jsonb_build_object(
    'texto', jsonb_build_object('texto', 'Resposta salva.', 'semOrigem', '[]'::jsonb),
    'blocos', jsonb_build_array(jsonb_build_object('id', 'b1', 'tipo', 'numero'))
  );
begin
  perform public.analise_registro_concluir_servidor(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    current_setting('teste.reg_a1')::uuid,
    v_resp,
    jsonb_build_array(jsonb_build_object('ferramenta', 'listar_centros', 'estado', 'fim')),
    2, 1234, 3, 'ok');

  begin
    perform public.analise_registro_concluir_servidor(
      '00000000-0000-0000-0000-0000000000a1'::uuid,
      current_setting('teste.reg_a1')::uuid,
      null, null, null, null, null, 'ok');
    raise exception '075 FALHOU: A concluiu duas vezes';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.analise_registro_concluir_servidor(
      '00000000-0000-0000-0000-0000000000b1'::uuid,
      current_setting('teste.reg_a1')::uuid,
      null, null, null, null, null, 'ok');
    raise exception '075 FALHOU: servidor concluiu o registro com outro p_user';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.analise_registro_concluir_servidor(
      '00000000-0000-0000-0000-0000000000a1'::uuid,
      '00000000-0000-0000-0000-0000000000ff'::uuid,
      null, null, null, null, null, 'ok');
    raise exception '075 FALHOU: servidor concluiu registro inexistente';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.analise_registro_concluir_servidor(
      '00000000-0000-0000-0000-0000000000a1'::uuid,
      current_setting('teste.reg_a2')::uuid,
      null, null, null, null, null, 'talvez');
    raise exception '075 FALHOU: desfecho inválido aceito';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.analise_registro_concluir_servidor(
      '00000000-0000-0000-0000-0000000000a1'::uuid,
      current_setting('teste.reg_a2')::uuid,
      jsonb_build_object('texto', repeat('a', 300000)),
      null, 0, 0, 0, 'ok');
    raise exception '075 FALHOU: resposta acima de 256 KB aceita';
  exception when sqlstate '22023' then null;
  end;

  raise notice '075 BLOCO 6 ok: só o servidor conclui, uma vez, no registro certo';
end $$;
reset role;

select set_config('request.jwt.claim.role', '', true);

do $$
declare
  r public.analise_registro;
begin
  select * into r from public.analise_registro
   where id = current_setting('teste.reg_a1')::uuid;
  if r.terminada_em is null then
    raise exception '075 FALHOU: terminada_em não gravado';
  end if;
  if r.desfecho <> 'ok' or r.rodadas <> 2 or r.ms <> 1234 or r.chamadas <> 3 then
    raise exception '075 FALHOU: campos da conclusão errados';
  end if;
  if r.resposta->'texto'->>'texto' <> 'Resposta salva.' then
    raise exception '075 FALHOU: resposta não gravada';
  end if;
  if jsonb_array_length(r.passos) <> 1 then
    raise exception '075 FALHOU: passos não gravados';
  end if;

  if (select terminada_em from public.analise_registro
       where id = current_setting('teste.reg_a2')::uuid) is not null then
    raise exception '075 FALHOU: as validações concluíram o segundo registro';
  end if;

  raise notice '075 BLOCO 6 ok: linha concluída';
end $$;

-- Leitura do dono depois da conclusão: sem passos, com desfecho e feedback.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  v jsonb;
begin
  v := public.analise_conversa_ler(current_setting('teste.conv_a')::uuid);
  if v->'turnos'->0->>'desfecho_calculado' <> 'ok'
     or v->'turnos'->0->>'desfecho' <> 'ok'
     or v->'turnos'->0->'resposta'->'texto'->>'texto' <> 'Resposta salva.'
     or (v->'turnos'->0->>'rodadas')::integer <> 2
     or (v->'turnos'->0->>'ms')::integer <> 1234 then
    raise exception '075 FALHOU: ler não devolveu o turno concluído: %', v->'turnos'->0;
  end if;
  if v->'turnos'->0 ? 'passos' or v->'turnos'->0 ? 'codigo_erro' then
    raise exception '075 FALHOU: ler devolveu campo interno';
  end if;

  perform public.analise_feedback_enviar(current_setting('teste.reg_a1')::uuid, 1::smallint, null, null);
  perform public.analise_feedback_enviar(current_setting('teste.reg_a1')::uuid, (-1)::smallint, 'errado', null);

  v := public.analise_conversa_ler(current_setting('teste.conv_a')::uuid);
  if v->'turnos'->0->'feedback'->>'nota' <> '-1'
     or v->'turnos'->0->'feedback'->>'motivo' <> 'errado' then
    raise exception '075 FALHOU: ler não devolveu o último feedback {nota, motivo}: %', v->'turnos'->0->'feedback';
  end if;

  raise notice '075 BLOCO 6 ok: leitura com desfecho e último feedback';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 7 — retenção: nada antigo é apagado
-- ------------------------------------------------------------
do $$
declare
  v_conv uuid := '00000000-0000-0000-0000-0000000000e1';
begin
  insert into public.analise_conversa (id, user_id, titulo, criada_em, atualizada_em)
  values (v_conv, '00000000-0000-0000-0000-0000000000a1', 'Conversa antiga',
          now() - interval '200 days', now() - interval '200 days');
  insert into public.analise_registro
    (id, user_id, iniciada_em, terminada_em, pergunta, conversa_id, ordem, desfecho)
  values
    ('00000000-0000-0000-0000-0000000000e2',
     '00000000-0000-0000-0000-0000000000a1',
     now() - interval '200 days', now() - interval '200 days',
     'Pergunta antiga', v_conv, 1, 'ok');
  insert into public.analise_feedback (registro_id, user_id, comentario)
  values ('00000000-0000-0000-0000-0000000000e2',
          '00000000-0000-0000-0000-0000000000a1', 'feedback antigo');
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  v jsonb;
begin
  v := public.analise_registro_iniciar('Pergunta nova depois de 200 dias');
  if v->>'registro' is null then
    raise exception '075 FALHOU: registro novo não abriu';
  end if;
  perform set_config('teste.reg_novo', v->>'registro', true);

  v := public.analise_conversa_ler('00000000-0000-0000-0000-0000000000e1'::uuid);
  if jsonb_array_length(v->'turnos') <> 1 then
    raise exception '075 FALHOU: a conversa antiga de A foi apagada';
  end if;
  raise notice '075 BLOCO 7 ok: o delete de 180 dias não existe mais (pela leitura)';
end $$;
reset role;

do $$
begin
  if not exists (select 1 from public.analise_conversa
                  where id = '00000000-0000-0000-0000-0000000000e1') then
    raise exception '075 FALHOU: a conversa antiga de A foi apagada';
  end if;
  if not exists (select 1 from public.analise_registro
                  where id = '00000000-0000-0000-0000-0000000000e2') then
    raise exception '075 FALHOU: o registro antigo de A foi apagado';
  end if;
  if not exists (select 1 from public.analise_feedback
                  where registro_id = '00000000-0000-0000-0000-0000000000e2') then
    raise exception '075 FALHOU: o feedback antigo caiu junto';
  end if;
  raise notice '075 BLOCO 7 ok: nada antigo é apagado';
end $$;

-- ------------------------------------------------------------
-- BLOCO 8 — lista: limite, teto, paginação e conversa sem turnos
-- (usuário d1 sintético, para não misturar com as conversas de A)
-- ------------------------------------------------------------
do $$
begin
  insert into public.analise_conversa (id, user_id, titulo, criada_em, atualizada_em) values
    ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1',
     'Mais recente', now() - interval '1 hour', now() - interval '1 hour'),
    ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
     'Do meio', now() - interval '2 hours', now() - interval '2 hours'),
    ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d1',
     'Mais antiga', now() - interval '3 hours', now() - interval '3 hours'),
    ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d1',
     'Sem turnos', now() - interval '4 hours', now() - interval '4 hours');
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
do $$
declare
  v jsonb;
begin
  v := public.analise_conversas_listar(2);
  if jsonb_array_length(v) <> 2
     or v->0->>'titulo' <> 'Mais recente'
     or v->1->>'titulo' <> 'Do meio' then
    raise exception '075 FALHOU: lista com limite 2/ordem errada: %', v;
  end if;

  v := public.analise_conversas_listar(50, now() - interval '90 minutes');
  if jsonb_array_length(v) <> 3
     or v->0->>'titulo' <> 'Do meio' then
    raise exception '075 FALHOU: paginação por p_antes errada: %', v;
  end if;

  begin
    perform public.analise_conversas_listar(0);
    raise exception '075 FALHOU: limite 0 aceito';
  exception when sqlstate '22023' then null;
  end;

  v := public.analise_conversas_listar(1000);
  if jsonb_array_length(v) <> 4 then
    raise exception '075 FALHOU: teto de 100 recusou conversas reais (%)', jsonb_array_length(v);
  end if;

  v := public.analise_conversa_ler('00000000-0000-0000-0000-0000000000d4'::uuid);
  if v->'turnos' is distinct from '[]'::jsonb then
    raise exception '075 FALHOU: conversa sem turnos deveria devolver []';
  end if;

  begin
    perform public.analise_conversa_ler(null);
    raise exception '075 FALHOU: conversa nula aceita';
  exception when sqlstate '22023' then null;
  end;

  raise notice '075 BLOCO 8 ok: limite, teto, paginação e conversa vazia';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 9 — exclusão pelo dono leva registros e feedbacks (cascade)
-- ------------------------------------------------------------
do $$
declare
  v_conv uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  insert into public.analise_conversa (id, user_id, titulo)
  values (v_conv, '00000000-0000-0000-0000-0000000000a1', 'Para excluir');
  insert into public.analise_registro
    (id, user_id, pergunta, conversa_id, ordem, terminada_em, desfecho)
  values ('00000000-0000-0000-0000-0000000000f2',
          '00000000-0000-0000-0000-0000000000a1', 'Pergunta para excluir',
          v_conv, 1, now(), 'ok');
  insert into public.analise_feedback (registro_id, user_id, nota)
  values ('00000000-0000-0000-0000-0000000000f2',
          '00000000-0000-0000-0000-0000000000a1', 1::smallint);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
begin
  perform public.analise_conversa_excluir('00000000-0000-0000-0000-0000000000f1'::uuid);
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.analise_conversa
              where id = '00000000-0000-0000-0000-0000000000f1') then
    raise exception '075 FALHOU: a conversa não foi excluída';
  end if;
  if exists (select 1 from public.analise_registro
              where id = '00000000-0000-0000-0000-0000000000f2') then
    raise exception '075 FALHOU: o registro da conversa não caiu';
  end if;
  if exists (select 1 from public.analise_feedback
              where registro_id = '00000000-0000-0000-0000-0000000000f2') then
    raise exception '075 FALHOU: o feedback do registro não caiu';
  end if;
  raise notice '075 BLOCO 9 ok: excluir leva registros e feedbacks';
end $$;

-- ------------------------------------------------------------
-- BLOCO 10 — admin: professor recusado e conversa_id/ordem na saída
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
begin
  begin
    perform public.analise_registros_admin();
    raise exception '075 FALHOU: professor chamou analise_registros_admin';
  exception when insufficient_privilege then null;
  end;
  raise notice '075 BLOCO 10 ok: professor recusado no admin';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  v jsonb;
  r jsonb;
begin
  v := public.analise_registros_admin();
  if jsonb_array_length(v) < 1 then
    raise exception '075 FALHOU: admin não viu registros';
  end if;
  select e.item into r
    from jsonb_array_elements(v) as e(item)
   where e.item->>'id' = current_setting('teste.reg_a1');
  if r is null then
    raise exception '075 FALHOU: admin não achou o registro concluído';
  end if;
  if not (r ? 'conversa_id' and r ? 'ordem') then
    raise exception '075 FALHOU: admin sem conversa_id/ordem';
  end if;
  if r->>'conversa_id' is null or (r->>'ordem')::integer <> 1 then
    raise exception '075 FALHOU: conversa_id/ordem do admin errados: %', r;
  end if;
  raise notice '075 BLOCO 10 ok: admin vê conversa_id e ordem';
end $$;
reset role;

do $$
begin
  raise notice '075: o roteiro inteiro passou; rollback abaixo devolve a base ao estado anterior';
end $$;

rollback;
