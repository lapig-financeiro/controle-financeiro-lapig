-- Stub para validar a migração 062 num Postgres descartável.
-- Ordem: stub.sql -> stub-051.sql -> stub-054.sql -> 051 -> stub-052.sql -> 052 -> 054 -> stub-062.sql -> 062 -> test_062
-- NÃO faz parte do projeto.
--
-- Reproduz o estado de produção pré-062 para os três buckets:
--   • plano-trabalho-docs (mig. 025: 4 policies abertas a qualquer authenticated)
--   • balancete-pdfs      (mig. 026: 4 policies abertas a qualquer authenticated)
--   • bolsa-planilhas     (mig. 031: 4 policies abertas a qualquer authenticated)
-- e acrescenta um segundo professor (b2, escopo 51.Y) + objetos em 51.X, 51.Y e na raiz.

insert into auth.users values
  ('00000000-0000-0000-0000-0000000000b2')
on conflict do nothing;

insert into public.app_users (user_id, role)
values ('00000000-0000-0000-0000-0000000000b2', 'professor')
on conflict (user_id) do update set role = 'professor';

insert into public.user_projects (user_id, project_id)
select '00000000-0000-0000-0000-0000000000b2'::uuid, id
  from public.projects
 where code = '51.Y'
on conflict do nothing;

insert into storage.buckets (id, name, public)
values ('plano-trabalho-docs', 'plano-trabalho-docs', false),
       ('balancete-pdfs',      'balancete-pdfs',      false),
       ('bolsa-planilhas',     'bolsa-planilhas',     false)
on conflict (id) do nothing;

-- Remove os nomes abreviados dos stubs anteriores para recriar as policies exatas das migrações 025/026/031.
drop policy if exists bal_insert        on storage.objects;
drop policy if exists bal_select        on storage.objects;
drop policy if exists bolsa_auth_select on storage.objects;

drop policy if exists plano_docs_auth_select on storage.objects;
drop policy if exists plano_docs_auth_insert on storage.objects;
drop policy if exists plano_docs_auth_update on storage.objects;
drop policy if exists plano_docs_auth_delete on storage.objects;
create policy plano_docs_auth_select on storage.objects for select to authenticated using (bucket_id = 'plano-trabalho-docs');
create policy plano_docs_auth_insert on storage.objects for insert to authenticated with check (bucket_id = 'plano-trabalho-docs');
create policy plano_docs_auth_update on storage.objects for update to authenticated using (bucket_id = 'plano-trabalho-docs') with check (bucket_id = 'plano-trabalho-docs');
create policy plano_docs_auth_delete on storage.objects for delete to authenticated using (bucket_id = 'plano-trabalho-docs');

drop policy if exists balancete_auth_select on storage.objects;
drop policy if exists balancete_auth_insert on storage.objects;
drop policy if exists balancete_auth_update on storage.objects;
drop policy if exists balancete_auth_delete on storage.objects;
create policy balancete_auth_select on storage.objects for select to authenticated using (bucket_id = 'balancete-pdfs');
create policy balancete_auth_insert on storage.objects for insert to authenticated with check (bucket_id = 'balancete-pdfs');
create policy balancete_auth_update on storage.objects for update to authenticated using (bucket_id = 'balancete-pdfs') with check (bucket_id = 'balancete-pdfs');
create policy balancete_auth_delete on storage.objects for delete to authenticated using (bucket_id = 'balancete-pdfs');

drop policy if exists bolsa_auth_insert on storage.objects;
drop policy if exists bolsa_auth_update on storage.objects;
drop policy if exists bolsa_auth_delete on storage.objects;
create policy bolsa_auth_select on storage.objects for select to authenticated using (bucket_id = 'bolsa-planilhas');
create policy bolsa_auth_insert on storage.objects for insert to authenticated with check (bucket_id = 'bolsa-planilhas');
create policy bolsa_auth_update on storage.objects for update to authenticated using (bucket_id = 'bolsa-planilhas') with check (bucket_id = 'bolsa-planilhas');
create policy bolsa_auth_delete on storage.objects for delete to authenticated using (bucket_id = 'bolsa-planilhas');

do $$
declare
  x uuid := (select id from public.projects where code = '51.X');
  y uuid := (select id from public.projects where code = '51.Y');
begin
  insert into storage.objects (bucket_id, name)
  select b, n
    from (values
      ('plano-trabalho-docs', x::text || '/plano.docx'),
      ('plano-trabalho-docs', y::text || '/plano.docx'),
      ('plano-trabalho-docs', 'solto.docx'),
      ('balancete-pdfs',      x::text || '/bal.pdf'),
      ('balancete-pdfs',      y::text || '/bal.pdf'),
      ('balancete-pdfs',      'solto.pdf'),
      ('bolsa-planilhas',     x::text || '/planilha.xlsx'),
      ('bolsa-planilhas',     y::text || '/planilha.xlsx'),
      ('bolsa-planilhas',     'solto.xlsx'),
      ('propostas-agente',    x::text || '/prop.pdf'),
      ('propostas-agente',    y::text || '/prop.pdf')
    ) as v(b, n)
   where not exists (
     select 1 from storage.objects o where o.bucket_id = v.b and o.name = v.n
   );
end $$;
