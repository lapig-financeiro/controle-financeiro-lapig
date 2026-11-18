// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-063 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-063-pglite.mjs
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.cache/pglite-063/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();

async function sql(text) {
  return db.exec(text, { onNotice: (n) => console.log('  [NOTICE]', n.message) });
}

async function arquivo(path) {
  console.log('Carregando ' + path);
  const content = await readFile(new URL('../../' + path, import.meta.url), 'utf8');
  await sql(content.replace(/^\\set ON_ERROR_STOP on\r?$/m, ''));
}

function conferirRegrasCofre(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 063 excede 90 KB (${bytes} bytes).`);
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
      throw new Error(`Cofre: termo proibido encontrado na 063: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 063.');
  }
  console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
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

try {
  console.log('1. Montando base sintética (stub + 051/052/054/062 + 038/048 + stub-063)...');
  for (const path of [
    'tools/replica-local/sintetico/stub.sql',
    'tools/replica-local/sintetico/stub-051.sql',
    'tools/replica-local/sintetico/stub-054.sql',
    'database/051_buriti_propostas_do_agente.sql',
    'tools/replica-local/sintetico/stub-052.sql',
    'database/052_privacidade_bolsistas_agente.sql',
    'database/054_buriti_tarefas.sql',
    'tools/replica-local/sintetico/stub-062.sql',
    'database/062_arquivos_por_centro.sql',
    'database/038_saldo_livre.sql',
    'database/048_janela_compromissos_dia_pagamento.sql',
    'tools/replica-local/sintetico/stub-063.sql',
  ]) {
    await arquivo(path);
  }

  console.log('2. Conferindo que test_063 falha ANTES da 063...');
  let falhouAntes = false;
  try {
    await arquivo('tests/sql/test_063_redesenho_f1.sql');
  } catch (e) {
    const esperado = ['42883', '42P01'].includes(e.code)
      || (e.code === 'P0001' && e.message.includes('42883') && e.message.includes('criar_pendencia_v2'));
    if (!esperado) {
      throw new Error(`ANTES da 063 falhou com código inesperado (${e.code}): ${e.message}`);
    }
    falhouAntes = true;
    console.log(`ANTES da 063: roteiro detectou a falta da 063 (${e.code}) -> ${e.message}`);
  } finally {
    await sql('rollback;');
  }
  if (!falhouAntes) {
    throw new Error('Roteiro test_063 passou antes da migração 063!');
  }

  const antes = (await db.query(helpersQuery)).rows;

  console.log('3. Conferindo regras estáticas do cofre e aplicando 063 (1ª vez)...');
  const sql063 = await readFile(new URL('../../database/063_redesenho_f1.sql', import.meta.url), 'utf8');
  conferirRegrasCofre(sql063);
  await arquivo('database/063_redesenho_f1.sql');

  console.log('4. Executando roteiro test_063_redesenho_f1.sql...');
  await arquivo('tests/sql/test_063_redesenho_f1.sql');

  console.log('5. Testando idempotência (reaplicando 063 e reexecutando test_063)...');
  await arquivo('database/063_redesenho_f1.sql');
  await arquivo('tests/sql/test_063_redesenho_f1.sql');

  console.log('6. Conferindo BLOCO 1 da 051 (barreira trg_bloqueia_agente em todas as tabelas)...');
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
       )
  `)).rows[0].v;
  if (semBarreira) {
    throw new Error('Tabela sem trg_bloqueia_agente depois da 063: ' + semBarreira);
  }

  console.log('7. Conferindo integridade dos 6 helpers protegidos...');
  const depois = (await db.query(helpersQuery)).rows;
  if (JSON.stringify(antes) !== JSON.stringify(depois)) {
    throw new Error('063 alterou algum helper protegido!');
  }

  console.log('063 OK em PGlite: falha provada antes; test_063 (7 blocos) + idempotência + barreira 051 + cofre + helpers protegidos verdes.');
} catch (e) {
  console.error('ERRO:', e.message, e.detail || '', e.where || '');
  process.exitCode = 1;
} finally {
  await db.close();
}
