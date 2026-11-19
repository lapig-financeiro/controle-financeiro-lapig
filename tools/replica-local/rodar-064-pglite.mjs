// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-064-pglite.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';

export function conferirRegrasCofre(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 064 excede 90 KB (${bytes} bytes).`);
  }

  // Remove comentários de linha (-- ...) e blocos (/* ... */) apenas para conferir início/fim com begin;/commit;
  const semComentarios = texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();

  if (!/^begin\s*;/i.test(semComentarios)) {
    throw new Error('Cofre: primeira linha de comando SQL deve ser begin;.');
  }
  if (!/commit\s*;$/i.test(semComentarios)) {
    throw new Error('Cofre: última linha de comando SQL deve ser commit;.');
  }

  const miolo = semComentarios
    .replace(/^begin\s*;/i, '')
    .replace(/commit\s*;$/i, '');
  if (/\bcommit\b|\bsavepoint\b/i.test(miolo)) {
    throw new Error('Cofre: commit ou savepoint proibido no meio da migração.');
  }

  const proibidos = [
    'net.',
    'http(',
    'dblink',
    'cron.',
    'vault.',
    'password',
    'service_role',
    'event trigger',
    'deferr',
    'alter default privileges',
    'set role',
    'create role',
    'alter role',
    'create extension',
    'concurrently',
    'vacuum',
  ];
  const lower = texto.toLowerCase();
  for (const termo of proibidos) {
    if (lower.includes(termo)) {
      throw new Error(`Cofre: termo proibido encontrado na 064: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 064.');
  }
  return bytes;
}

export async function carregarArquivo(db, path, { quiet = false } = {}) {
  if (!quiet) console.log('Carregando ' + path);
  const content = await readFile(new URL('../../' + path, import.meta.url), 'utf8');
  return db.exec(
    content.replace(/^\\set ON_ERROR_STOP on\r?$/m, ''),
    { onNotice: (n) => { if (!quiet) console.log('  [NOTICE]', n.message); } },
  );
}

export async function montarBase064(db, { quiet = false } = {}) {
  const execSql = (text) => db.exec(text, { onNotice: (n) => { if (!quiet) console.log('  [NOTICE]', n.message); } });
  const arquivo = (path) => carregarArquivo(db, path, { quiet });

  // 1. Bootstrap pré-025 (papéis, auth, storage, tabelas base)
  await execSql(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    end $$;

    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create schema if not exists storage;
    create table if not exists storage.buckets (id text primary key, name text, public boolean);
    create table if not exists storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id),
      name text not null
    );
    create or replace function storage.foldername(name text) returns text[]
    language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
    $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant usage on schema public, auth to authenticated;

    create or replace function public.update_updated_at() returns trigger
    language plpgsql as $$
    begin
      new.updated_at := now();
      return new;
    end $$;

    create or replace function public.generate_month_series(p_start date, p_end date)
    returns table (month_start date, month_end date)
    language plpgsql stable set search_path = public, pg_temp as $$
    begin
      return query
      select d::date, (d + interval '1 month' - interval '1 day')::date
        from generate_series(date_trunc('month', p_start)::date,
                             date_trunc('month', p_end)::date,
                             interval '1 month') as d;
    end $$;

    create table public.projects (
      id               uuid primary key default gen_random_uuid(),
      name             text not null unique,
      code             text,
      start_date       date,
      end_date         date,
      report_dates     text,
      notes            text,
      active           boolean not null default true,
      drive_folder_url text,
      created_at       timestamptz not null default now(),
      updated_at       timestamptz not null default now()
    );

    create table public.dashboard_settings (
      project_id         uuid primary key references public.projects(id) on delete cascade,
      include_in_general boolean not null default false
    );

    create table public.expenses (
      id         uuid primary key default gen_random_uuid(),
      project_id uuid not null references public.projects(id)
    );

    create table public.scholarship_holders (
      id         uuid primary key default gen_random_uuid(),
      full_name  text not null,
      cpf        text,
      email      text,
      created_by uuid references auth.users(id)
    );

    create table public.scholarships (
      id         uuid primary key default gen_random_uuid(),
      holder_id  uuid not null references public.scholarship_holders(id),
      project_id uuid not null references public.projects(id),
      amount     numeric(14,2) not null,
      start_date date not null,
      end_date   date not null,
      status     text not null default 'active'
    );

    create or replace function public.save_project(
      text, uuid, text, date, date, text, text, boolean, boolean
    ) returns uuid language sql as $$ select null::uuid $$;
  `);

  // 2. Carrega 025 e 026 REAIS
  await arquivo('database/025_plano_trabalho.sql');
  await arquivo('database/026_balancetes.sql');

  // 3. Reproduz 032 + 033 + 031 (bucket) + 035 + identidades base antes de 051..063
  await execSql(`
    drop table public.expenses cascade;
    drop function if exists public.save_project(text, uuid, text, date, date, text, text, boolean, boolean, boolean);
    alter table public.projects drop column if exists funape_managed;

    create table public.app_users (
      user_id      uuid primary key references auth.users(id) on delete cascade,
      role         text not null default 'professor' check (role in ('admin','professor')),
      display_name text,
      email        text,
      created_at   timestamptz not null default now()
    );
    create table public.user_projects (
      user_id    uuid not null references auth.users(id) on delete cascade,
      project_id uuid not null references public.projects(id) on delete cascade,
      primary key (user_id, project_id)
    );

    create or replace function public.is_admin() returns boolean
    language sql security definer set search_path = public, pg_temp as $$
      select exists (select 1 from public.app_users where user_id = auth.uid() and role = 'admin');
    $$;
    create or replace function public.allowed_project_ids() returns uuid[]
    language sql security definer set search_path = public, pg_temp as $$
      select coalesce(array_agg(project_id), '{}'::uuid[]) from public.user_projects where user_id = auth.uid();
    $$;
    create or replace function public.assert_project_allowed(p_project_id uuid) returns void
    language plpgsql security definer set search_path = public, pg_temp as $$
    begin
      if public.is_admin() then return; end if;
      if not exists (select 1 from unnest(public.allowed_project_ids()) as id where id = p_project_id) then
        raise exception 'Acesso negado ao projeto %', p_project_id;
      end if;
    end $$;

    -- Policies 033/037
    create policy escopo_projects on public.projects for all to authenticated
      using (public.is_admin() or id = any(public.allowed_project_ids()))
      with check (public.is_admin() or id = any(public.allowed_project_ids()));

    create policy escopo_scholarships on public.scholarships for all to authenticated
      using (public.is_admin() or project_id = any(public.allowed_project_ids()))
      with check (public.is_admin() or project_id = any(public.allowed_project_ids()));

    alter table public.scholarship_holders enable row level security;
    create policy "Escopo lê bolsistas" on public.scholarship_holders for select to authenticated
      using (
        public.is_admin()
        or created_by = auth.uid()
        or exists (
          select 1 from public.scholarships s
           where s.holder_id = scholarship_holders.id
             and s.project_id = any(public.allowed_project_ids())
        )
      );

    drop policy if exists "Autenticado lê planos"     on public.planos_trabalho;
    drop policy if exists "Autenticado insere planos" on public.planos_trabalho;
    drop policy if exists "Autenticado edita planos"  on public.planos_trabalho;
    drop policy if exists "Autenticado exclui planos" on public.planos_trabalho;
    create policy "Escopo planos" on public.planos_trabalho for all to authenticated
      using (public.is_admin() or project_id = any(public.allowed_project_ids()))
      with check (public.is_admin() or project_id = any(public.allowed_project_ids()));

    drop policy if exists "Autenticado lê plano_rubricas"     on public.plano_rubricas;
    drop policy if exists "Autenticado insere plano_rubricas" on public.plano_rubricas;
    drop policy if exists "Autenticado edita plano_rubricas"  on public.plano_rubricas;
    drop policy if exists "Autenticado exclui plano_rubricas" on public.plano_rubricas;
    create policy "Admin plano_rubricas" on public.plano_rubricas for all to authenticated
      using (public.is_admin()) with check (public.is_admin());

    drop policy if exists "Autenticado lê plano_desembolsos"     on public.plano_desembolsos;
    drop policy if exists "Autenticado insere plano_desembolsos" on public.plano_desembolsos;
    drop policy if exists "Autenticado edita plano_desembolsos"  on public.plano_desembolsos;
    drop policy if exists "Autenticado exclui plano_desembolsos" on public.plano_desembolsos;
    create policy "Admin lê plano_desembolsos" on public.plano_desembolsos for all to authenticated
      using (public.is_admin()) with check (public.is_admin());

    drop policy if exists "Autenticado lê balancetes"     on public.balancetes;
    drop policy if exists "Autenticado insere balancetes" on public.balancetes;
    drop policy if exists "Autenticado edita balancetes"  on public.balancetes;
    drop policy if exists "Autenticado exclui balancetes" on public.balancetes;
    create policy "Escopo balancetes" on public.balancetes for all to authenticated
      using (public.is_admin() or project_id = any(public.allowed_project_ids()))
      with check (public.is_admin() or project_id = any(public.allowed_project_ids()));

    drop policy if exists "Autenticado lê lancamentos"     on public.balancete_lancamentos;
    drop policy if exists "Autenticado insere lancamentos" on public.balancete_lancamentos;
    drop policy if exists "Autenticado edita lancamentos"  on public.balancete_lancamentos;
    drop policy if exists "Autenticado exclui lancamentos" on public.balancete_lancamentos;
    create policy "Admin lancamentos" on public.balancete_lancamentos for all to authenticated
      using (public.is_admin()) with check (public.is_admin());

    alter table public.app_users enable row level security;
    create policy perfil on public.app_users for select to authenticated
      using (user_id = auth.uid() or public.is_admin());
    alter table public.user_projects enable row level security;
    create policy escopo on public.user_projects for select to authenticated
      using (user_id = auth.uid() or public.is_admin());

    grant select, insert, update, delete on
      public.projects, public.balancetes, public.planos_trabalho, public.scholarships,
      public.plano_rubricas, public.plano_desembolsos, public.balancete_lancamentos
      to authenticated;
    grant select on
      public.app_users, public.user_projects, public.scholarship_holders,
      public.rubricas, public.conta_rubrica_map
      to authenticated;

    -- Bucket 031 (antes da 062)
    insert into storage.buckets (id, name, public)
    values ('bolsa-planilhas', 'bolsa-planilhas', false)
    on conflict (id) do nothing;
    create policy bolsa_auth_select on storage.objects for select to authenticated using (bucket_id = 'bolsa-planilhas');
    create policy bolsa_auth_insert on storage.objects for insert to authenticated with check (bucket_id = 'bolsa-planilhas');
    create policy bolsa_auth_update on storage.objects for update to authenticated using (bucket_id = 'bolsa-planilhas') with check (bucket_id = 'bolsa-planilhas');
    create policy bolsa_auth_delete on storage.objects for delete to authenticated using (bucket_id = 'bolsa-planilhas');

    -- Lockdown 035/037 em todas as funções criadas até aqui
    revoke execute on all functions in schema public from public, anon;
    grant execute on all functions in schema public to authenticated;
    revoke execute on function public.assert_project_allowed(uuid) from public, anon, authenticated;
    revoke execute on function public.resolve_rubrica_for_conta(text) from public, anon;

    create function public.stub_escrita_sem_guard(p_id uuid) returns void
    language plpgsql security definer set search_path = public, pg_temp as $$
    begin update public.projects set name = name where id = p_id; end $$;
    revoke all on function public.stub_escrita_sem_guard(uuid) from public, anon;
    grant execute on function public.stub_escrita_sem_guard(uuid) to authenticated;

    -- Identidades e projetos iniciais (antes da 051)
    insert into auth.users values
      ('00000000-0000-0000-0000-0000000000a1'),
      ('00000000-0000-0000-0000-0000000000b1'),
      ('00000000-0000-0000-0000-0000000000b2'),
      ('00000000-0000-0000-0000-0000000000c1'),
      ('00000000-0000-0000-0000-0000000000d1'),
      ('00000000-0000-0000-0000-0000000000e1')
    on conflict do nothing;

    insert into public.projects (name, code, start_date, end_date) values
      ('Stub 064 X', '51.X', '2025-01-01', '2027-12-31'),
      ('Stub 064 Y', '51.Y', '2025-01-01', '2027-12-31');

    insert into public.app_users (user_id, role, display_name) values
      ('00000000-0000-0000-0000-0000000000a1', 'admin',     'Victor'),
      ('00000000-0000-0000-0000-0000000000b1', 'professor', 'Professor do projeto'),
      ('00000000-0000-0000-0000-0000000000b2', 'professor', 'Prof. Bruno'),
      ('00000000-0000-0000-0000-0000000000d1', 'professor', 'Vigia'),
      ('00000000-0000-0000-0000-0000000000e1', 'professor', 'Arthur Pietro');

    insert into public.user_projects (user_id, project_id)
    select u, p.id
      from (values
        ('00000000-0000-0000-0000-0000000000b1'::uuid, '51.X'),
        ('00000000-0000-0000-0000-0000000000c1'::uuid, '51.X'),
        ('00000000-0000-0000-0000-0000000000d1'::uuid, '51.X'),
        ('00000000-0000-0000-0000-0000000000b2'::uuid, '51.Y'),
        ('00000000-0000-0000-0000-0000000000e1'::uuid, '51.Y')
      ) as v(u, code)
      join public.projects p on p.code = v.code;
  `);

  // 4. Migrações reais 051, 052, 054, 053, 056, 062, 038, 048
  await arquivo('database/051_buriti_propostas_do_agente.sql');

  await execSql(`
    insert into public.app_users (user_id, role, display_name)
    values ('00000000-0000-0000-0000-0000000000c1', 'agente', 'Buriti Agente')
    on conflict (user_id) do update set role = 'agente', display_name = 'Buriti Agente';
  `);

  await arquivo('database/052_privacidade_bolsistas_agente.sql');
  await arquivo('database/054_buriti_tarefas.sql');
  await arquivo('database/053_item_do_plano.sql');
  await arquivo('database/056_buriti_propoe_plano.sql');
  await arquivo('database/062_arquivos_por_centro.sql');
  await arquivo('database/038_saldo_livre.sql');
  await arquivo('database/048_janela_compromissos_dia_pagamento.sql');

  // 5. Dados sintéticos base (063 + bordas 064) sobre as tabelas reais de 025/026
  await execSql(`
    delete from public.user_projects where user_id = '00000000-0000-0000-0000-0000000000d1';
    update public.app_users
       set role = 'automacao', display_name = 'Vigia'
     where user_id = '00000000-0000-0000-0000-0000000000d1';

    do $$
    declare
      v_x      uuid := (select id from public.projects where code = '51.X');
      v_y      uuid := (select id from public.projects where code = '51.Y');
      v_edge   uuid;
      v_sb     uuid;
      v_sp     uuid;
      v_sn     uuid;
      v_inat   uuid;

      v_pl_x   uuid;
      v_pl_y   uuid;
      v_pl_ed  uuid;
      v_pl_sb  uuid;
      v_pl_sn  uuid;
      v_pl_in  uuid;

      v_bal_x1 uuid;
      v_bal_x2 uuid;
      v_bal_y  uuid;
      v_bal_ed uuid;
      v_bal_sn uuid;
      v_bal_in uuid;

      v_hol_x  uuid;

      v_mes_atual  date := date_trunc('month', current_date)::date;
      v_fim_futuro date := (date_trunc('month', current_date) + interval '12 months' - interval '1 day')::date;
      v_ref_atual  date := (date_trunc('month', current_date) + interval '14 days')::date;
      v_ref_antigo date := (date_trunc('month', current_date) - interval '2 months' + interval '14 days')::date;
    begin
      -- 51.X: em dia (plano v1, 2 balancetes, 3 rubricas sendo 2 em b, 3 parcelas, 1 bolsa ativa)
      update public.projects
         set drive_folder_url = 'https://drive.google.com/drive/folders/stub-51x',
             end_date = v_fim_futuro
       where id = v_x;

      insert into public.planos_trabalho (
        project_id, ativo, versao, tipo, valor_total_plano,
        arquivo_storage_path, arquivo_nome
      ) values (
        v_x, true, 1, 'remanejamento', 260000.00,
        v_x::text || '/plano_v1.docx', 'plano_v1.docx'
      ) returning id into v_pl_x;

      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre) values
        (v_pl_x, 'a.bolsas', 200000.00, null),
        (v_pl_x, 'b',         45000.00, 'Serviços técnicos especializados'),
        (v_pl_x, 'b',         15000.00, 'Participação em congressos');

      insert into public.plano_desembolsos (plano_id, parcela, data_prevista, data_texto, valor, valor_texto) values
        (v_pl_x, 1, (v_mes_atual - interval '1 month')::date, 'Parcela 1', 100000.00, '100.000,00'),
        (v_pl_x, 2, (v_mes_atual + interval '1 month')::date, 'Parcela 2', 100000.00, '100.000,00'),
        (v_pl_x, 3, (v_mes_atual + interval '3 months')::date, 'Parcela 3', 60000.00, '60.000,00');

      insert into public.balancetes (
        project_id, data_referencia, saldo_disponivel, rendimento_liquido,
        total_debitos, total_creditos, raw_extraction
      ) values (
        v_x, v_ref_antigo, 110000.00, 1000.00, 25000.00, 135000.00,
        '{"data":{"recursos":{"recebido":100000,"a_receber":0}}}'::jsonb
      ) returning id into v_bal_x1;

      insert into public.balancetes (
        project_id, data_referencia, saldo_disponivel, rendimento_liquido,
        total_debitos, total_creditos, arquivo_storage_path, arquivo_nome, raw_extraction
      ) values (
        v_x, v_ref_atual, 195000.00, 3500.00, 120000.00, 315000.00,
        v_x::text || '/balancete_atual.pdf', 'balancete_atual.pdf',
        '{"data":{"recursos":{"recebido":150000,"a_receber":50000}}}'::jsonb
      ) returning id into v_bal_x2;

      insert into public.balancete_lancamentos (balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code) values
        (v_bal_x1, '7.1.3.04.01.09142', 'BOLSA DOAÇÃO',                    20000.00, 'a.bolsas'),
        (v_bal_x2, '7.1.3.04.01.09142', 'BOLSA DOAÇÃO',                    50000.00, 'a.bolsas'),
        (v_bal_x2, '7.1.3.05.01.00027', 'SERVIÇOS ANÁLISE PESQ. CIENTÍFICA', 15000.00, 'b'),
        (v_bal_x2, '7.1.3.05.01.00014', 'INSCRIÇÃO CONGRESSO',              5000.00, 'b');

      insert into public.scholarship_holders (full_name)
      values ('Bolsista Sintético 64X')
      returning id into v_hol_x;

      insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
      values (v_hol_x, v_x, 4000.00, v_mes_atual, v_fim_futuro, 'active');

      -- 51.Y: problema por grupo negativo real
      update public.projects set end_date = v_fim_futuro where id = v_y;

      insert into public.planos_trabalho (project_id, ativo, versao, tipo, valor_total_plano)
      values (v_y, true, 0, 'original', 80000.00)
      returning id into v_pl_y;

      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
        (v_pl_y, 'a.bolsas', 50000.00),
        (v_pl_y, 'e',        30000.00);

      insert into public.balancetes (
        project_id, data_referencia, saldo_disponivel, rendimento_liquido,
        arquivo_storage_path, arquivo_nome
      ) values (
        v_y, v_ref_atual, 12000.00, 200.00,
        v_y::text || '/balancete_y.pdf', 'balancete_y.pdf'
      ) returning id into v_bal_y;

      insert into public.balancete_lancamentos (balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code) values
        (v_bal_y, '7.1.3.04.01.09142', 'BOLSA DOAÇÃO',       65000.00, 'a.bolsas'),
        (v_bal_y, '7.1.3.03.01.00006', 'MATERIAL DE CONSUMO', 10000.00, 'e');

      -- 64.EDGE: previsto 0 (c), previsto negativo (d), estornos negativos (f, e), saldo_disponivel null, sem arquivo
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Stub 064 Bordas', '64.EDGE', '2025-01-01', v_fim_futuro, true)
      returning id into v_edge;

      insert into public.planos_trabalho (project_id, ativo, versao, tipo, valor_total_plano)
      values (v_edge, true, 0, 'original', 58000.00)
      returning id into v_pl_ed;

      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre) values
        (v_pl_ed, 'c',     0.00, 'Passagens zeradas'),
        (v_pl_ed, 'd', -2000.00, 'Ajuste negativo de diárias'),
        (v_pl_ed, 'f', 50000.00, 'Equipamentos'),
        (v_pl_ed, 'e', 10000.00, 'Material de consumo');

      insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
      values (v_edge, v_ref_atual, null, 0.00)
      returning id into v_bal_ed;

      insert into public.balancete_lancamentos (balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code) values
        (v_bal_ed, '7.1.3.05.01.00042', 'PASSAGENS E LOCOMOÇÃO',   1000.00, 'c'),
        (v_bal_ed, '7.1.3.02.01.00001', 'DIÁRIAS NO PAÍS',           500.00, 'd'),
        (v_bal_ed, '7.1.3.20.50.00003', 'APARELHOS E EQUIPAMENTOS', 5000.00, 'f'),
        (v_bal_ed, '7.1.1.08.22.98672', 'RECUPERAÇÃO DESP EQUIP', -20000.00, 'f'),
        (v_bal_ed, '7.1.3.03.01.00009', 'ESTORNO MATERIAL',        -3000.00, 'e');

      -- 63.SB: sem balancete
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Stub 064 Sem Balancete', '63.SB', '2025-01-01', v_fim_futuro, true)
      returning id into v_sb;

      insert into public.planos_trabalho (project_id, ativo, versao, tipo, valor_total_plano)
      values (v_sb, true, 0, 'original', 150000.00)
      returning id into v_pl_sb;

      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
        (v_pl_sb, 'b', 150000.00);

      insert into public.plano_desembolsos (plano_id, parcela, data_prevista, data_texto, valor, valor_texto) values
        (v_pl_sb, 1, null, 'Por entrega', null, 'mediante cálculo de gastos');

      -- 63.SP: sem plano
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Stub 064 Sem Plano', '63.SP', '2025-01-01', v_fim_futuro, true)
      returning id into v_sp;

      -- 64.SN: plano e balancete existem mas tudo zero -> grupos = [] -> 'sem números'
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Stub 064 Sem Números', '64.SN', '2025-01-01', v_fim_futuro, true)
      returning id into v_sn;

      insert into public.planos_trabalho (project_id, ativo, versao, tipo, valor_total_plano)
      values (v_sn, true, 0, 'original', 0.00)
      returning id into v_pl_sn;

      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
        (v_pl_sn, 'b', 0.00);

      insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
      values (v_sn, v_ref_atual, 0.00, 0.00)
      returning id into v_bal_sn;

      insert into public.balancete_lancamentos (balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code) values
        (v_bal_sn, '7.1.3.05.01.00004', 'SERVIÇOS', 0.00, 'b');

      -- 63.INAT: projeto inativo (também no user_projects de b1)
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Stub 064 Inativo', '63.INAT', '2024-01-01', v_fim_futuro, false)
      returning id into v_inat;

      insert into public.user_projects (user_id, project_id)
      values ('00000000-0000-0000-0000-0000000000b1', v_inat);

      insert into public.planos_trabalho (project_id, ativo, versao, tipo, valor_total_plano)
      values (v_inat, true, 0, 'original', 50000.00)
      returning id into v_pl_in;

      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
        (v_pl_in, 'b', 50000.00);

      insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
      values (v_inat, v_ref_atual, 50000.00, 0.00)
      returning id into v_bal_in;

      insert into public.balancete_lancamentos (balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code) values
        (v_bal_in, '7.1.3.05.01', 'SERVIÇOS', 10000.00, 'b');
    end $$;

    -- Como o Supabase: objeto novo nasce com privilégios para anon/authenticated
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);

  // 6. Carrega 063 real
  await arquivo('database/063_redesenho_f1.sql');
}

const helpersQuery = `
  select proname, md5(pg_get_functiondef(oid)) as assinatura
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in (
       'is_agente', 'is_admin', 'allowed_project_ids',
       'assert_project_allowed', 'contem_cpf', 'bloqueia_escrita_do_agente'
     )
   order by proname
`;

async function main() {
  const db = new PGlite();
  const sql = (text) => db.exec(text, { onNotice: (n) => console.log('  [NOTICE]', n.message) });
  const arquivo = (path) => carregarArquivo(db, path);

  try {
    console.log('1. Montando base real (025 + 026 + 051/052/054/053/056/062 + 038/048 + 063)...');
    await montarBase064(db);

    console.log('2. Conferindo que test_064 falha ANTES da 064...');
    let falhouAntes = false;
    try {
      await arquivo('tests/sql/test_064_rastreabilidade.sql');
    } catch (e) {
      const esperado = ['42883', '42P01', '42704'].includes(e.code)
        || (e.code === 'P0001' && (e.message.includes('documentos') || e.message.includes('registrar_documento_v2')));
      if (!esperado) {
        throw new Error(`ANTES da 064 falhou com código inesperado (${e.code}): ${e.message}`);
      }
      falhouAntes = true;
      console.log(`ANTES da 064: roteiro detectou a falta da 064 (${e.code}) -> ${e.message}`);
    } finally {
      await sql('rollback;');
    }
    if (!falhouAntes) {
      throw new Error('Roteiro test_064 passou antes da migração 064!');
    }

    const antes = (await db.query(helpersQuery)).rows;

    console.log('3. Conferindo regras estáticas do cofre e aplicando 064 (1ª vez)...');
    const sql064 = await readFile(new URL('../../database/064_rastreabilidade.sql', import.meta.url), 'utf8');
    const bytes = conferirRegrasCofre(sql064);
    console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
    await arquivo('database/064_rastreabilidade.sql');

    console.log('4. Carregando stub-064.sql (apenas via registrar_documento_v2 como admin)...');
    await arquivo('tools/replica-local/sintetico/stub-064.sql');

    console.log('5. Executando roteiro test_064_rastreabilidade.sql...');
    await arquivo('tests/sql/test_064_rastreabilidade.sql');

    console.log('6. Testando idempotência (reaplicando 064 e reexecutando test_064)...');
    await arquivo('database/064_rastreabilidade.sql');
    await arquivo('tests/sql/test_064_rastreabilidade.sql');

    console.log('7. Conferindo BLOCO 1 da 051 (trg_bloqueia_agente em todas as tabelas de public)...');
    const semBarreira = (await db.query(`
      select string_agg(c.relname, ', ') as v
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('r', 'p')
         and c.relname <> 'propostas_agente'
         and not exists (
           select 1 from pg_trigger t
            where t.tgrelid = c.oid
              and t.tgname = 'trg_bloqueia_agente'
              and t.tgenabled = 'O'
              and t.tgqual is null
              and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
         )
    `)).rows[0].v;
    if (semBarreira) {
      throw new Error('Tabela sem trg_bloqueia_agente válido depois da 064: ' + semBarreira);
    }

    console.log('8. Conferindo integridade dos 6 helpers protegidos...');
    const depois = (await db.query(helpersQuery)).rows;
    if (JSON.stringify(antes) !== JSON.stringify(depois)) {
      throw new Error('064 alterou algum helper protegido!');
    }

    console.log('9. Provando 5 mutantes da 064...');
    async function esperarFalhaTest064(rotulo, fnMutacao, fnRestaura) {
      await fnMutacao();
      let falhou = false;
      let msg = '';
      try {
        await arquivo('tests/sql/test_064_rastreabilidade.sql');
      } catch (e) {
        falhou = true;
        msg = e.message;
      } finally {
        await sql('rollback;');
        await fnRestaura();
      }
      if (!falhou) {
        throw new Error(`Mutante NÃO foi detectado por test_064: ${rotulo}`);
      }
      console.log(`  [MUTANTE OK] ${rotulo} -> ${msg}`);
    }

    // Mutante 1: registrar_documento_v2 sem conferência de valor
    const matchReg = sql064.match(/create or replace function public\.registrar_documento_v2[\s\S]*?\$\$;/);
    if (!matchReg) throw new Error('Não foi possível extrair registrar_documento_v2.');
    const regOrig = matchReg[0];
    const regMut1 = regOrig.replace(
      'if v_atual is null or v_atual is distinct from v_f_valor then',
      'if false and (v_atual is null or v_atual is distinct from v_f_valor) then',
    );
    if (regMut1 === regOrig) throw new Error('Falha ao montar mutante 1.');
    await esperarFalhaTest064(
      '1) registrar_documento_v2 sem conferência de valor',
      async () => sql(regMut1),
      async () => arquivo('database/064_rastreabilidade.sql'),
    );

    // Mutante 2: policy de fatos aberta a authenticated (using true) -> asserção da 064 + test_064 barram
    await esperarFalhaTest064(
      '2) policy permissiva extra em fatos aberta a authenticated',
      async () => {
        await sql(`create policy mutante_fatos_aberto on public.fatos for select to authenticated using (true);`);
        let barrouAssercao = false;
        try {
          await arquivo('database/064_rastreabilidade.sql');
        } catch (e) {
          barrouAssercao = e.message.includes('policy SELECT');
        } finally {
          await sql('rollback;');
        }
        if (!barrouAssercao) {
          throw new Error('Asserção da 064 não recusou policy extra em fatos!');
        }
      },
      async () => sql(`drop policy if exists mutante_fatos_aberto on public.fatos;`),
    );

    // Mutante 3: _resolver_origem_alvo sem _mascarar_cpf
    const matchRes = sql064.match(/create or replace function public\._resolver_origem_alvo[\s\S]*?\$\$;/);
    if (!matchRes) throw new Error('Não foi possível extrair _resolver_origem_alvo.');
    const resOrig = matchRes[0];
    const resMut3 = resOrig.replace(
      'when p_mascarar then public._mascarar_cpf(v_fato.trecho)',
      'when false then public._mascarar_cpf(v_fato.trecho)',
    );
    if (resMut3 === resOrig) throw new Error('Falha ao montar mutante 3.');
    await esperarFalhaTest064(
      '3) get_origem_v2/_resolver_origem_alvo sem máscara de CPF',
      async () => sql(resMut3),
      async () => arquivo('database/064_rastreabilidade.sql'),
    );

    // Mutante 4 (correção #16): trg_bloqueia_agente em pendencias mantendo o nome mas trocando a função do gatilho
    await esperarFalhaTest064(
      '4) trg_bloqueia_agente em pendencias apontando para função dummy (mesmo nome)',
      async () => {
        await sql(`
          create or replace function public._mutante_noop_agente() returns trigger
          language plpgsql as $$ begin return null; end $$;
          drop trigger trg_bloqueia_agente on public.pendencias;
          create trigger trg_bloqueia_agente
            before insert or update or delete on public.pendencias
            for each statement execute function public._mutante_noop_agente();
        `);
        let barrouAssercao = false;
        try {
          await arquivo('database/064_rastreabilidade.sql');
        } catch (e) {
          barrouAssercao = e.message.includes('trg_bloqueia_agente');
        } finally {
          await sql('rollback;');
        }
        if (!barrouAssercao) {
          throw new Error('Asserção da 064 não detectou troca de função em trg_bloqueia_agente!');
        }
      },
      async () => {
        await sql(`
          drop trigger if exists trg_bloqueia_agente on public.pendencias;
          create trigger trg_bloqueia_agente
            before insert or update or delete on public.pendencias
            for each statement execute function public.bloqueia_escrita_do_agente();
          drop function if exists public._mutante_noop_agente();
        `);
      },
    );

    // Mutante 5 (correção #2): _resolver_origem_alvo devolvendo 'documento' mesmo após valor mudar
    const resMut5 = resOrig.replace(
      'if v_valor is not null and round(v_valor, 2) = round(v_fato.valor, 2) then',
      'if true then',
    );
    if (resMut5 === resOrig) throw new Error('Falha ao montar mutante 5.');
    await esperarFalhaTest064(
      '5) get_origem_v2/_resolver_origem_alvo não rebaixando para legado quando valor muda',
      async () => sql(resMut5),
      async () => arquivo('database/064_rastreabilidade.sql'),
    );

    console.log('10. Conferência final após restauração dos mutantes...');
    await arquivo('tests/sql/test_064_rastreabilidade.sql');
    const finalHelpers = (await db.query(helpersQuery)).rows;
    if (JSON.stringify(antes) !== JSON.stringify(finalHelpers)) {
      throw new Error('064 alterou algum helper protegido após restauração!');
    }

    console.log('064 OK em PGlite: falha provada antes; base real (025/026/053/056) + test_064 (5 blocos) + idempotência + barreira 051 + cofre + 5 mutantes + helpers protegidos verdes.');
  } catch (e) {
    console.error('ERRO:', e.message, e.detail || '', e.where || '');
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
