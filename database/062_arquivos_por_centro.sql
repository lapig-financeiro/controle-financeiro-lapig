-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 062
-- F0-A: Fechar a leitura e escrita dos buckets por centro de custo
-- ============================================================
-- Problema:
--   As migrações 025 (`plano-trabalho-docs`), 026 (`balancete-pdfs`) e
--   031 (`bolsa-planilhas`) criaram policies permissivas em
--   `storage.objects` com `bucket_id = '...'`, sem verificar se o centro
--   de custo pertence ao usuário. Qualquer login autenticado (ex.: um
--   professor de outro projeto) conseguia ler, sobrescrever ou excluir
--   arquivos de qualquer centro — inclusive planilhas da FUNAPE com CPF
--   (`bolsa-planilhas`).
--   A 051, a 052 e a 054 restringiram apenas os papéis `agente` e
--   `automacao`, deixando o acesso entre professores aberto.
--
-- Solução:
--   Nos três buckets (`plano-trabalho-docs`, `balancete-pdfs`,
--   `bolsa-planilhas`), todo upload grava no caminho
--   `<project_id>/<timestamp>_<nome>` (conferido em plano-trabalho.js e
--   holders.js), e o upload no Storage acontece ANTES da inserção da
--   linha na tabela (`planos_trabalho`, `balancetes`, `reconciliacoes`).
--   Por isso, o escopo nas policies usa `(storage.foldername(name))[1]`
--   comparado a `public.allowed_project_ids()::text[]`, mesmo padrão do
--   bucket `propostas-agente` (051).
--   Admins (`public.is_admin()`) mantêm acesso total.
--   As policies restritivas da 051, 052 e 054 permanecem intactas.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Bucket `plano-trabalho-docs` (mig. 025)
-- ------------------------------------------------------------
drop policy if exists plano_docs_auth_select   on storage.objects;
drop policy if exists plano_docs_auth_insert   on storage.objects;
drop policy if exists plano_docs_auth_update   on storage.objects;
drop policy if exists plano_docs_auth_delete   on storage.objects;
drop policy if exists plano_docs_escopo_select on storage.objects;
drop policy if exists plano_docs_escopo_insert on storage.objects;
drop policy if exists plano_docs_escopo_update on storage.objects;
drop policy if exists plano_docs_escopo_delete on storage.objects;

create policy plano_docs_escopo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'plano-trabalho-docs'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

create policy plano_docs_escopo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'plano-trabalho-docs'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

create policy plano_docs_escopo_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'plano-trabalho-docs'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  )
  with check (
    bucket_id = 'plano-trabalho-docs'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

create policy plano_docs_escopo_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'plano-trabalho-docs'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

-- ------------------------------------------------------------
-- 2. Bucket `balancete-pdfs` (mig. 026)
-- ------------------------------------------------------------
drop policy if exists balancete_auth_select   on storage.objects;
drop policy if exists balancete_auth_insert   on storage.objects;
drop policy if exists balancete_auth_update   on storage.objects;
drop policy if exists balancete_auth_delete   on storage.objects;
drop policy if exists balancete_escopo_select on storage.objects;
drop policy if exists balancete_escopo_insert on storage.objects;
drop policy if exists balancete_escopo_update on storage.objects;
drop policy if exists balancete_escopo_delete on storage.objects;

create policy balancete_escopo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'balancete-pdfs'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

create policy balancete_escopo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'balancete-pdfs'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

create policy balancete_escopo_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'balancete-pdfs'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  )
  with check (
    bucket_id = 'balancete-pdfs'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

create policy balancete_escopo_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'balancete-pdfs'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

-- ------------------------------------------------------------
-- 3. Bucket `bolsa-planilhas` (mig. 031)
-- ------------------------------------------------------------
drop policy if exists bolsa_auth_select   on storage.objects;
drop policy if exists bolsa_auth_insert   on storage.objects;
drop policy if exists bolsa_auth_update   on storage.objects;
drop policy if exists bolsa_auth_delete   on storage.objects;
drop policy if exists bolsa_escopo_select on storage.objects;
drop policy if exists bolsa_escopo_insert on storage.objects;
drop policy if exists bolsa_escopo_update on storage.objects;
drop policy if exists bolsa_escopo_delete on storage.objects;

create policy bolsa_escopo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'bolsa-planilhas'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

create policy bolsa_escopo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'bolsa-planilhas'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

create policy bolsa_escopo_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'bolsa-planilhas'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  )
  with check (
    bucket_id = 'bolsa-planilhas'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

create policy bolsa_escopo_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'bolsa-planilhas'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])
    )
  );

-- ------------------------------------------------------------
-- 3b. Restritivas do agente (051/052), recriadas com o texto idêntico ao original.
--     O primeiro ensaio no cofre (18/11/2026) falhou na asserção abaixo: na produção elas não estão
--     (ou não com estes nomes). Como a 062 abre janela permissiva por centro, elas precisam existir:
--     o agente só escreve no bucket dele e só lê o dele e os balancetes.
-- ------------------------------------------------------------
drop policy if exists agente_so_no_bucket_dele_ins on storage.objects;
create policy agente_so_no_bucket_dele_ins on storage.objects
  as restrictive for insert to authenticated
  with check (not public.is_agente() or bucket_id = 'propostas-agente');

drop policy if exists agente_so_no_bucket_dele_upd on storage.objects;
create policy agente_so_no_bucket_dele_upd on storage.objects
  as restrictive for update to authenticated
  using (not public.is_agente() or bucket_id = 'propostas-agente')
  with check (not public.is_agente() or bucket_id = 'propostas-agente');

drop policy if exists agente_so_no_bucket_dele_del on storage.objects;
create policy agente_so_no_bucket_dele_del on storage.objects
  as restrictive for delete to authenticated
  using (not public.is_agente() or bucket_id = 'propostas-agente');

drop policy if exists agente_le_so_buckets_sem_pii on storage.objects;
create policy agente_le_so_buckets_sem_pii on storage.objects
  as restrictive for select to authenticated
  using (not public.is_agente() or bucket_id in ('propostas-agente', 'balancete-pdfs'));

-- ------------------------------------------------------------
-- 4. Asserções dentro da transação
-- ------------------------------------------------------------
do $$
declare
  v_antigas text;
  v_novas   int;
  v_rls     boolean;
begin
  select c.relrowsecurity
    into v_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage' and c.relname = 'objects';

  if v_rls is distinct from true then
    raise exception '062: RLS desligado em storage.objects';
  end if;

  select string_agg(policyname, ', ' order by policyname)
    into v_antigas
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and policyname in (
       'plano_docs_auth_select', 'plano_docs_auth_insert', 'plano_docs_auth_update', 'plano_docs_auth_delete',
       'balancete_auth_select',  'balancete_auth_insert',  'balancete_auth_update',  'balancete_auth_delete',
       'bolsa_auth_select',      'bolsa_auth_insert',      'bolsa_auth_update',      'bolsa_auth_delete'
     );

  if v_antigas is not null then
    raise exception '062: policies antigas abertas ainda existem: %', v_antigas;
  end if;

  select count(*)
    into v_novas
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and permissive = 'PERMISSIVE'
     and 'authenticated' = any(roles)
     and policyname in (
       'plano_docs_escopo_select', 'plano_docs_escopo_insert', 'plano_docs_escopo_update', 'plano_docs_escopo_delete',
       'balancete_escopo_select',  'balancete_escopo_insert',  'balancete_escopo_update',  'balancete_escopo_delete',
       'bolsa_escopo_select',      'bolsa_escopo_insert',      'bolsa_escopo_update',      'bolsa_escopo_delete'
     );

  if v_novas <> 12 then
    raise exception '062: esperado 12 policies escopadas, encontrado %', v_novas;
  end if;

  -- Nenhuma OUTRA policy permissiva pode abrir esses buckets (ex.: criada pelo painel com outro nome),
  -- nem existir policy permissiva sem filtro de bucket: permissivas somam por OR.
  select string_agg(policyname, ', ' order by policyname)
    into v_antigas
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and permissive = 'PERMISSIVE'
     and policyname not like 'plano\_docs\_escopo\_%'
     and policyname not like 'balancete\_escopo\_%'
     and policyname not like 'bolsa\_escopo\_%'
     and (
       coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '(plano-trabalho-docs|balancete-pdfs|bolsa-planilhas)'
       or coalesce(qual, '') || ' ' || coalesce(with_check, '') !~ 'bucket_id'
     );

  if v_antigas is not null then
    raise exception '062: outra policy permissiva ainda alcança os buckets: %', v_antigas;
  end if;

  -- Os três buckets continuam privados: bucket público entrega o arquivo por URL, sem passar por policy.
  if exists (
    select 1 from storage.buckets
     where id in ('plano-trabalho-docs', 'balancete-pdfs', 'bolsa-planilhas') and public
  ) then
    raise exception '062: algum dos três buckets está público';
  end if;

  -- As 12 policies novas carregam de fato o escopo (uma "using (true)" com o nome certo passaria na contagem).
  select string_agg(policyname, ', ' order by policyname)
    into v_antigas
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and (policyname like 'plano\_docs\_escopo\_%' or policyname like 'balancete\_escopo\_%' or policyname like 'bolsa\_escopo\_%')
     and coalesce(qual, '') || ' ' || coalesce(with_check, '') !~ 'allowed_project_ids';

  if v_antigas is not null then
    raise exception '062: policy escopada sem allowed_project_ids: %', v_antigas;
  end if;

  -- As restritivas de escrita do agente (051) seguem de pé: a 062 abre janela permissiva nos três buckets.
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and permissive = 'RESTRICTIVE'
         and policyname in ('agente_so_no_bucket_dele_ins', 'agente_so_no_bucket_dele_upd', 'agente_so_no_bucket_dele_del')) <> 3 then
    raise exception '062: restritivas de escrita do agente (051) ausentes';
  end if;

  -- Restrição do agente (051/052) preservada.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and policyname = 'agente_le_so_buckets_sem_pii'
       and permissive = 'RESTRICTIVE'
  ) then
    raise exception '062: policy agente_le_so_buckets_sem_pii (052) ausente';
  end if;
end $$;

commit;
