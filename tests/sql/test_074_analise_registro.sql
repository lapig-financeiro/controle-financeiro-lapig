-- ============================================================
-- Roteiro de conferência da migração 074 (registro e feedback da Análise)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-074-pglite.mjs
-- Antes da 074, o roteiro falha já no TRUNCATE:
--   relation "public.analise_registro" does not exist
--
-- Identidades da base 064: a1 = admin ('Victor'),
-- b1 = professor, c1 = agente (Buriti). Todos os UUIDs são sintéticos.
--
-- O roteiro inteiro roda numa transação e termina em ROLLBACK: as
-- contagens não vazam para a próxima execução. As asserções são
-- inline (sem função em pg_temp) porque o roteiro troca de papel
-- com `set local role`.
-- ============================================================
\set ON_ERROR_STOP on

begin;

-- Prova a existência das tabelas cedo: antes da 074 isto aborta o roteiro.
truncate public.analise_registro, public.analise_feedback;

-- ------------------------------------------------------------
-- BLOCO 1 — estrutura, constraints, índices, ACL e atributos
-- ------------------------------------------------------------
do $$
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
  if not (select relrowsecurity from pg_class where oid = v_reg) then
    raise exception '074 FALHOU: RLS desligado em analise_registro';
  end if;
  if not (select relrowsecurity from pg_class where oid = v_fb) then
    raise exception '074 FALHOU: RLS desligado em analise_feedback';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename in ('analise_registro', 'analise_feedback')
  ) then
    raise exception '074 FALHOU: as tabelas do registro não devem ter policy';
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_reg and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from
     'id:uuid, user_id:uuid, iniciada_em:timestamp with time zone, terminada_em:timestamp with time zone, '
     'pergunta:text, anteriores:integer, modelo:text, resposta:jsonb, passos:jsonb, '
     'rodadas:integer, ms:integer, chamadas:integer, desfecho:text, codigo_erro:text' then
    raise exception '074 FALHOU: colunas/tipos inesperados em analise_registro: %', v_cols;
  end if;

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = v_fb and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from
     'id:uuid, registro_id:uuid, user_id:uuid, criado_em:timestamp with time zone, '
     'nota:smallint, comentario:text, motivo:text' then
    raise exception '074 FALHOU: colunas/tipos inesperados em analise_feedback: %', v_cols;
  end if;

  select string_agg(a.attname, ',' order by k.ord)
    into v_pk
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = v_reg and c.contype = 'p';
  if v_pk is distinct from 'id' then
    raise exception '074 FALHOU: PK de analise_registro deveria ser (id), veio %', v_pk;
  end if;

  select string_agg(a.attname, ',' order by k.ord)
    into v_pk
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = v_fb and c.contype = 'p';
  if v_pk is distinct from 'id' then
    raise exception '074 FALHOU: PK de analise_feedback deveria ser (id), veio %', v_pk;
  end if;

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
    raise exception '074 FALHOU: FK do feedback sem on delete cascade';
  end if;

  if exists (
    select 1 from pg_constraint
     where conrelid in (v_reg, v_fb) and not convalidated
  ) then
    raise exception '074 FALHOU: constraint não validada';
  end if;
  if (select count(*) from pg_constraint where conrelid = v_reg and contype = 'c') <> 10 then
    raise exception '074 FALHOU: analise_registro deveria ter 10 checks';
  end if;
  if (select count(*) from pg_constraint where conrelid = v_fb and contype = 'c') <> 4 then
    raise exception '074 FALHOU: analise_feedback deveria ter 4 checks';
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
      raise exception '074 FALHOU: constraint % ausente em %', v_c.nome, v_c.tabela;
    end if;
    foreach v_tok in array v_c.tokens loop
      if position(v_tok in v_def) = 0 then
        raise exception '074 FALHOU: constraint % sem "%"', v_c.nome, v_tok;
      end if;
    end loop;
  end loop;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'analise_registro'
       and lower(indexdef) like '%(user_id, iniciada_em desc)%'
  ) then
    raise exception '074 FALHOU: falta índice (user_id, iniciada_em desc)';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'analise_registro'
       and lower(indexdef) like '%(iniciada_em desc)%'
  ) then
    raise exception '074 FALHOU: falta índice (iniciada_em desc)';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'analise_feedback'
       and lower(indexdef) like '%(registro_id, criado_em desc)%'
  ) then
    raise exception '074 FALHOU: falta índice (registro_id, criado_em desc)';
  end if;

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
    raise exception '074 FALHOU: trg_bloqueia_agente ausente ou incorreto em analise_registro';
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
    raise exception '074 FALHOU: trg_bloqueia_agente ausente ou incorreto em analise_feedback';
  end if;

  if has_table_privilege('anon', v_reg, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', v_reg, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '074 FALHOU: analise_registro deveria estar fechada a anon/authenticated';
  end if;
  if has_table_privilege('anon', v_fb, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', v_fb, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '074 FALHOU: analise_feedback deveria estar fechada a anon/authenticated';
  end if;

  if (select count(*) from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname in ('analise_registro_iniciar', 'analise_registro_concluir',
                         'analise_feedback_enviar', 'analise_registros_admin')) <> 4 then
    raise exception '074 FALHOU: deveria existir exatamente uma função de cada RPC';
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
      raise exception '074 FALHOU: função % ausente', v_f.sig;
    end if;
    if (select pronargs from pg_proc where oid = v_fn) <> v_f.nargs then
      raise exception '074 FALHOU: % com parâmetros inesperados', v_f.sig;
    end if;
    if (select pronargdefaults from pg_proc where oid = v_fn) <> v_f.ndef then
      raise exception '074 FALHOU: % com defaults inesperados', v_f.sig;
    end if;
    if (select prorettype from pg_proc where oid = v_fn) <> v_f.ret then
      raise exception '074 FALHOU: % com retorno inesperado', v_f.sig;
    end if;
    if not (select prosecdef from pg_proc where oid = v_fn) then
      raise exception '074 FALHOU: % sem security definer', v_f.sig;
    end if;
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '074 FALHOU: % sem search_path exato', v_f.sig;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '074 FALHOU: authenticated perdeu EXECUTE em %', v_f.sig;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (
         select 1 from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '074 FALHOU: anon possui EXECUTE em %', v_f.sig;
    end if;
  end loop;

  v_def := lower(pg_get_functiondef('public.analise_registro_iniciar(text, integer, text)'::regprocedure));
  if position('user_id = v_user' in v_def) = 0
     or position('interval ''180 days''' in v_def) = 0 then
    raise exception '074 FALHOU: iniciar sem retenção de 180 dias do próprio usuário';
  end if;
  v_def := lower(pg_get_functiondef('public.analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text)'::regprocedure));
  if position('terminada_em is null' in v_def) = 0
     or position('user_id = v_user' in v_def) = 0 then
    raise exception '074 FALHOU: concluir sem dono/terminada_em nulo';
  end if;
  v_def := lower(pg_get_functiondef('public.analise_registros_admin(timestamptz, integer)'::regprocedure));
  if position('public.is_admin()' in v_def) = 0
     or position('''cortada''' in v_def) = 0
     or position('interval ''3 minutes''' in v_def) = 0 then
    raise exception '074 FALHOU: admin sem is_admin()/cortada';
  end if;

  raise notice '074 BLOCO 1 ok: estrutura, constraints, índices, ACL e atributos';
end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — recusas: anon, sem JWT e agente
-- ------------------------------------------------------------
set local role anon;
do $$
begin
  begin
    perform public.analise_registro_iniciar('pergunta');
    raise exception '074 FALHOU: anon abriu registro';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analise_registro_concluir('00000000-0000-0000-0000-000000000001'::uuid,
                                             null, null, null, null, null, 'ok');
    raise exception '074 FALHOU: anon concluiu registro';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analise_feedback_enviar('00000000-0000-0000-0000-000000000001'::uuid, 1::smallint, null, null);
    raise exception '074 FALHOU: anon enviou feedback';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analise_registros_admin();
    raise exception '074 FALHOU: anon leu o admin';
  exception when insufficient_privilege then null;
  end;
  raise notice '074 BLOCO 2 ok: anon recusado nas 4 RPCs';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.analise_registro_iniciar('pergunta sem login');
    raise exception '074 FALHOU: authenticated sem JWT abriu registro';
  exception when insufficient_privilege then
    if sqlerrm <> 'Acesso negado.' then
      raise exception '074 FALHOU: sem JWT barrado pelo motivo errado (%)', sqlerrm;
    end if;
  end;
  raise notice '074 BLOCO 2 ok: sem JWT recusado';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$
begin
  begin
    perform public.analise_registro_iniciar('pergunta do agente');
    raise exception '074 FALHOU: agente abriu registro';
  exception when insufficient_privilege then
    -- A recusa tem de vir da guarda da RPC ('Acesso negado.'), não do
    -- gatilho de tabela: sem a guarda, o gatilho ainda barraria a
    -- escrita, mas a RPC teria chegado ao banco.
    if sqlerrm <> 'Acesso negado.' then
      raise exception '074 FALHOU: agente barrado pelo motivo errado (%)', sqlerrm;
    end if;
  end;
  begin
    perform public.analise_registros_admin();
    raise exception '074 FALHOU: agente leu o admin';
  exception when insufficient_privilege then
    if sqlerrm <> 'Acesso negado.' then
      raise exception '074 FALHOU: agente barrado pelo motivo errado na leitura (%)', sqlerrm;
    end if;
  end;
  raise notice '074 BLOCO 2 ok: agente recusado';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 3 — leitura e escrita diretas recusadas para authenticated
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  v uuid := '00000000-0000-0000-0000-000000000001';
begin
  begin
    perform 1 from public.analise_registro where id = v;
    raise exception '074 FALHOU: authenticated leu analise_registro direto';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.analise_feedback where registro_id = v;
    raise exception '074 FALHOU: authenticated leu analise_feedback direto';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.analise_registro (user_id, pergunta)
    values ('00000000-0000-0000-0000-0000000000a1', 'escrita direta');
    raise exception '074 FALHOU: authenticated gravou direto em analise_registro';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.analise_feedback (registro_id, user_id, comentario)
    values (v, '00000000-0000-0000-0000-0000000000a1', 'escrita direta');
    raise exception '074 FALHOU: authenticated gravou direto em analise_feedback';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.analise_registro where user_id = '00000000-0000-0000-0000-0000000000a1';
    raise exception '074 FALHOU: authenticated apagou direto de analise_registro';
  exception when insufficient_privilege then null;
  end;
  raise notice '074 BLOCO 3 ok: leitura/escrita diretas recusadas';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 4 — A e B: dono, conclusão única e feedback
-- ------------------------------------------------------------
delete from public.analise_registro;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('teste.reg_a',
                  public.analise_registro_iniciar('pergunta A', 2, 'modelo-sintetico')::text,
                  true);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select set_config('teste.reg_b',
                  public.analise_registro_iniciar('pergunta B')::text,
                  true);

-- A não conclui nem dá feedback no registro de B.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  v_b uuid := current_setting('teste.reg_b')::uuid;
begin
  begin
    perform public.analise_registro_concluir(v_b, '{"texto":"invasao"}'::jsonb, '[]'::jsonb,
                                             0, 1, 0, 'ok');
    raise exception '074 FALHOU: A concluiu o registro de B';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.analise_feedback_enviar(v_b, (-1)::smallint, 'errado', null);
    raise exception '074 FALHOU: A deu feedback no registro de B';
  exception when sqlstate '42501' then null;
  end;
  raise notice '074 BLOCO 4 ok: A não toca o registro de B';
end $$;

do $$
declare
  v_a uuid := current_setting('teste.reg_a')::uuid;
begin
  perform public.analise_registro_concluir(
    v_a,
    jsonb_build_object('texto', 'resposta A', 'blocos', jsonb_build_array()),
    jsonb_build_array(jsonb_build_object('ferramenta', 'situacao_centro', 'estado', 'ok')),
    3, 1234, 5, 'ok');

  begin
    perform public.analise_registro_concluir(v_a, null, null, null, null, null, 'ok');
    raise exception '074 FALHOU: A concluiu duas vezes';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.analise_registro_concluir(
      '00000000-0000-0000-0000-0000000000ff', null, null, null, null, null, 'ok');
    raise exception '074 FALHOU: A concluiu registro inexistente';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.analise_feedback_enviar(v_a, null, null, null);
    raise exception '074 FALHOU: feedback vazio aceito';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_feedback_enviar(v_a, null, null, '   ');
    raise exception '074 FALHOU: feedback em branco aceito';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_feedback_enviar(v_a, 0::smallint, null, null);
    raise exception '074 FALHOU: nota 0 aceita';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_feedback_enviar(v_a, null, 'talvez', null);
    raise exception '074 FALHOU: motivo inválido aceito';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_feedback_enviar(v_a, null, null, repeat('x', 2001));
    raise exception '074 FALHOU: comentário acima de 2000 aceito';
  exception when sqlstate '22023' then null;
  end;

  perform public.analise_feedback_enviar(v_a, (-1)::smallint, 'cortada', null);
  raise notice '074 BLOCO 4 ok: conclusão única e validação do feedback';
end $$;
reset role;

do $$
declare
  v_a   uuid := current_setting('teste.reg_a')::uuid;
  v_b   uuid := current_setting('teste.reg_b')::uuid;
  r     public.analise_registro;
  v_n   integer;
  v_fim timestamptz;
begin
  select * into r from public.analise_registro where id = v_a;
  if r.terminada_em is null then
    raise exception '074 FALHOU: terminada_em não gravado';
  end if;
  if r.desfecho <> 'ok' or r.rodadas <> 3 or r.ms <> 1234 or r.chamadas <> 5 then
    raise exception '074 FALHOU: campos da conclusão errados';
  end if;
  if r.resposta->>'texto' <> 'resposta A' then
    raise exception '074 FALHOU: resposta não gravada';
  end if;
  if jsonb_array_length(r.passos) <> 1 then
    raise exception '074 FALHOU: passos não gravados';
  end if;
  if r.anteriores <> 2 or r.modelo <> 'modelo-sintetico' then
    raise exception '074 FALHOU: anteriores/modelo não gravados';
  end if;

  select terminada_em into v_fim from public.analise_registro where id = v_b;
  if v_fim is not null then
    raise exception '074 FALHOU: B foi concluído por A';
  end if;

  select count(*) into v_n from public.analise_feedback
   where registro_id = v_a and user_id = '00000000-0000-0000-0000-0000000000a1';
  if v_n <> 1 then
    raise exception '074 FALHOU: feedback válido deveria ser 1, veio %', v_n;
  end if;
  raise notice '074 BLOCO 4 ok: linha de A gravada, linha de B intacta';
end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — retenção de 180 dias só do próprio usuário
-- ------------------------------------------------------------
delete from public.analise_registro;

insert into public.analise_registro (id, user_id, iniciada_em, pergunta) values
  ('00000000-0000-0000-0000-000000000f01',
   '00000000-0000-0000-0000-0000000000a1', now() - interval '200 days', 'antiga de A'),
  ('00000000-0000-0000-0000-000000000f02',
   '00000000-0000-0000-0000-0000000000a1', now() - interval '179 days', 'quase antiga de A'),
  ('00000000-0000-0000-0000-000000000f03',
   '00000000-0000-0000-0000-0000000000b1', now() - interval '200 days', 'antiga de B');

insert into public.analise_feedback (registro_id, user_id, comentario) values
  ('00000000-0000-0000-0000-000000000f01',
   '00000000-0000-0000-0000-0000000000a1', 'feedback antigo de A'),
  ('00000000-0000-0000-0000-000000000f03',
   '00000000-0000-0000-0000-0000000000b1', 'feedback antigo de B');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('teste.reg_nova',
                  public.analise_registro_iniciar('pergunta nova')::text,
                  true);
reset role;

do $$
declare
  v_nova uuid := current_setting('teste.reg_nova')::uuid;
begin
  if exists (select 1 from public.analise_registro
              where id = '00000000-0000-0000-0000-000000000f01') then
    raise exception '074 FALHOU: A não apagou a própria linha antiga';
  end if;
  if not exists (select 1 from public.analise_registro
                  where id = '00000000-0000-0000-0000-000000000f02') then
    raise exception '074 FALHOU: A apagou a própria linha de 179 dias';
  end if;
  if not exists (select 1 from public.analise_registro
                  where id = '00000000-0000-0000-0000-000000000f03') then
    raise exception '074 FALHOU: A apagou as linhas antigas de B';
  end if;
  if exists (select 1 from public.analise_feedback
              where registro_id = '00000000-0000-0000-0000-000000000f01') then
    raise exception '074 FALHOU: feedback antigo de A não caiu junto';
  end if;
  if not exists (select 1 from public.analise_feedback
                  where registro_id = '00000000-0000-0000-0000-000000000f03') then
    raise exception '074 FALHOU: A apagou o feedback antigo de B';
  end if;
  if not exists (select 1 from public.analise_registro
                  where id = v_nova
                    and user_id = '00000000-0000-0000-0000-0000000000a1'
                    and pergunta = 'pergunta nova'
                    and anteriores = 0) then
    raise exception '074 FALHOU: registro novo não nasceu do usuário certo';
  end if;
  raise notice '074 BLOCO 5 ok: retenção de 180 dias só do próprio usuário';
end $$;

-- ------------------------------------------------------------
-- BLOCO 6 — admin: professor recusado, teto, filtro e cortada
-- ------------------------------------------------------------
delete from public.analise_registro;

-- 210 linhas para provar o teto de 200 e o padrão de 50.
insert into public.analise_registro (user_id, iniciada_em, pergunta)
select '00000000-0000-0000-0000-0000000000a1',
       now() - interval '10 minutes' + make_interval(secs => i),
       'teto ' || i
  from generate_series(1, 210) as i;

set local role authenticated;

-- professor não chama a leitura do admin
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
begin
  begin
    perform public.analise_registros_admin();
    raise exception '074 FALHOU: professor chamou analise_registros_admin';
  exception when insufficient_privilege then null;
  end;
  raise notice '074 BLOCO 6 ok: professor recusado no admin';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  n integer;
begin
  n := jsonb_array_length(public.analise_registros_admin(null, 1000));
  if n <> 200 then
    raise exception '074 FALHOU: teto de 200 não respeitado (%)', n;
  end if;
  n := jsonb_array_length(public.analise_registros_admin());
  if n <> 50 then
    raise exception '074 FALHOU: padrão de 50 não respeitado (%)', n;
  end if;
  begin
    perform public.analise_registros_admin(null, 0);
    raise exception '074 FALHOU: limite 0 aceito';
  exception when sqlstate '22023' then null;
  end;
  raise notice '074 BLOCO 6 ok: teto de 200, padrão de 50 e limite 0 recusado';
end $$;
reset role;

delete from public.analise_registro;

insert into public.analise_registro (id, user_id, iniciada_em, terminada_em, pergunta, desfecho) values
  ('00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-0000000000a1', now() - interval '4 minutes', null, 'cortada', null),
  ('00000000-0000-0000-0000-000000000c02',
   '00000000-0000-0000-0000-0000000000a1', now() - interval '1 minute', null, 'em andamento', null),
  ('00000000-0000-0000-0000-000000000c03',
   '00000000-0000-0000-0000-0000000000a1', now() - interval '10 minutes',
   now() - interval '9 minutes', 'terminada', 'ok');

insert into public.analise_feedback (registro_id, user_id, criado_em, comentario) values
  ('00000000-0000-0000-0000-000000000c03',
   '00000000-0000-0000-0000-0000000000a1', now() - interval '8 minutes', 'primeiro feedback'),
  ('00000000-0000-0000-0000-000000000c03',
   '00000000-0000-0000-0000-0000000000a1', now() - interval '7 minutes', 'segundo feedback');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  v jsonb;
  r jsonb;
  n integer;
begin
  v := public.analise_registros_admin(now() - interval '5 minutes');
  n := jsonb_array_length(v);
  if n <> 2 then
    raise exception '074 FALHOU: p_desde devolveu % linhas', n;
  end if;
  if v->0->>'id' <> '00000000-0000-0000-0000-000000000c02' then
    raise exception '074 FALHOU: ordem por iniciada_em desc errada';
  end if;
  if v->1->>'id' <> '00000000-0000-0000-0000-000000000c01' then
    raise exception '074 FALHOU: filtro p_desde errado';
  end if;

  v := public.analise_registros_admin();

  select e.item into r
    from jsonb_array_elements(v) as e(item)
   where e.item->>'id' = '00000000-0000-0000-0000-000000000c01';
  if r->>'desfecho_calculado' <> 'cortada' then
    raise exception '074 FALHOU: cortada calculada errada (%)', r->>'desfecho_calculado';
  end if;

  select e.item into r
    from jsonb_array_elements(v) as e(item)
   where e.item->>'id' = '00000000-0000-0000-0000-000000000c02';
  if r->>'desfecho_calculado' <> 'em_andamento' then
    raise exception '074 FALHOU: em_andamento errado (%)', r->>'desfecho_calculado';
  end if;

  select e.item into r
    from jsonb_array_elements(v) as e(item)
   where e.item->>'id' = '00000000-0000-0000-0000-000000000c03';
  if r->>'desfecho_calculado' <> 'ok' then
    raise exception '074 FALHOU: desfecho gravado não devolvido';
  end if;
  if jsonb_array_length(r->'feedbacks') <> 2 then
    raise exception '074 FALHOU: feedbacks deveriam ser 2';
  end if;
  if r->'feedbacks'->0->>'comentario' <> 'primeiro feedback'
     or r->'feedbacks'->1->>'comentario' <> 'segundo feedback' then
    raise exception '074 FALHOU: feedbacks fora de ordem';
  end if;
  if not (r ? 'pergunta' and r ? 'anteriores' and r ? 'modelo'
          and r ? 'resposta' and r ? 'passos' and r ? 'rodadas'
          and r ? 'ms' and r ? 'chamadas' and r ? 'codigo_erro') then
    raise exception '074 FALHOU: faltou campo no registro devolvido';
  end if;

  raise notice '074 BLOCO 6 ok: cortada, em_andamento, filtro e feedbacks em ordem';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 7 — validações de entrada e limite de 256 KB
-- ------------------------------------------------------------
delete from public.analise_registro;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  v uuid;
begin
  begin
    perform public.analise_registro_iniciar('');
    raise exception '074 FALHOU: pergunta vazia aceita';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_registro_iniciar('   ');
    raise exception '074 FALHOU: pergunta em branco aceita';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_registro_iniciar(repeat('p', 2001));
    raise exception '074 FALHOU: pergunta acima de 2000 aceita';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_registro_iniciar('ok', 6);
    raise exception '074 FALHOU: anteriores 6 aceito';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_registro_iniciar('ok', -1);
    raise exception '074 FALHOU: anteriores -1 aceito';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_registro_iniciar('ok', 0, repeat('m', 201));
    raise exception '074 FALHOU: modelo acima de 200 aceito';
  exception when sqlstate '22023' then null;
  end;

  v := public.analise_registro_iniciar(repeat('p', 2000), 5, repeat('m', 200));
  if v is null then
    raise exception '074 FALHOU: limites de 2000/200 recusados';
  end if;

  begin
    perform public.analise_registro_concluir(
      v, jsonb_build_object('texto', repeat('a', 300000)), '[]'::jsonb, 1, 2, 3, 'ok');
    raise exception '074 FALHOU: resposta acima de 256 KB aceita';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_registro_concluir(
      v, '{"texto":"ok"}'::jsonb, jsonb_build_array(repeat('a', 300000)), 1, 2, 3, 'ok');
    raise exception '074 FALHOU: passos acima de 256 KB aceitos';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_registro_concluir(v, null, null, null, null, null, 'talvez');
    raise exception '074 FALHOU: desfecho inválido aceito';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analise_registro_concluir(v, null, null, null, null, null, null);
    raise exception '074 FALHOU: desfecho nulo aceito';
  exception when sqlstate '22023' then null;
  end;

  perform public.analise_registro_concluir(
    v, jsonb_build_object('texto', 'ok'), '[]'::jsonb, 0, 0, 0, 'ok');

  raise notice '074 BLOCO 7 ok: validações e limite de 256 KB';
end $$;
reset role;

do $$
declare
  v uuid := (select id from public.analise_registro where pergunta = repeat('p', 2000));
begin
  if v is null then
    raise exception '074 FALHOU: registro do limite de 2000 não existe';
  end if;
  if (select terminada_em from public.analise_registro where id = v) is null then
    raise exception '074 FALHOU: conclusão válida não gravou terminada_em';
  end if;
  if (select desfecho from public.analise_registro where id = v) <> 'ok' then
    raise exception '074 FALHOU: desfecho válido não gravado';
  end if;
  raise notice '074 BLOCO 7 ok: erros de tamanho não concluíram o registro';
end $$;

rollback;
