// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-056 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-062-pglite.mjs (base 051→054 + stub-062, prova o defeito antes, aplica 062 e valida depois)
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.cache/pglite-056/node_modules/@electric-sql/pglite/dist/index.js';
const db = new PGlite();
async function sql(text) { return db.exec(text, { onNotice: n => console.log(n.message) }); }
async function arquivo(path) {
  console.log('Conferindo ' + path);
  await sql((await readFile(new URL('../../' + path, import.meta.url), 'utf8'))
    .replace(/^\\set ON_ERROR_STOP on\r?$/m, ''));
}
const helpers = `select proname,md5(pg_get_functiondef(oid)) assinatura
  from pg_proc where pronamespace='public'::regnamespace and proname in
  ('is_agente','is_admin','allowed_project_ids','assert_project_allowed','contem_cpf','bloqueia_escrita_do_agente')
  order by proname`;
try {
  for (const path of [
    'tools/replica-local/sintetico/stub.sql',
    'tools/replica-local/sintetico/stub-051.sql',
    'tools/replica-local/sintetico/stub-054.sql',
    'database/051_buriti_propostas_do_agente.sql',
    'tools/replica-local/sintetico/stub-052.sql',
    'database/052_privacidade_bolsistas_agente.sql',
    'database/054_buriti_tarefas.sql',
    'tools/replica-local/sintetico/stub-062.sql',
  ]) await arquivo(path);

  // Antes da 062 o roteiro TEM DE FALHAR: professor A lê arquivo do centro B.
  let defeitoProvado = false;
  try { await arquivo('tests/sql/test_062_arquivos_por_centro.sql'); }
  catch (e) {
    if (!e.message.includes('professor A leu arquivo do centro B')) throw e;
    defeitoProvado = true;
    console.log('ANTES da 062: roteiro provou o defeito -> ' + e.message);
  } finally { await sql('rollback;'); }
  if (!defeitoProvado) throw new Error('Roteiro não detectou o vazamento entre centros antes da 062.');

  const antes = (await db.query(helpers)).rows;
  await arquivo('database/062_arquivos_por_centro.sql');
  await arquivo('tests/sql/test_062_arquivos_por_centro.sql');

  // Idempotência: reaplicar a 062 não quebra e os testes continuam passando.
  await arquivo('database/062_arquivos_por_centro.sql');
  await arquivo('tests/sql/test_062_arquivos_por_centro.sql');

  // Reexecução da 052 (storage + bolsistas) para provar que nada da privacidade do agente regrediu.
  await sql('begin;');
  await arquivo('tests/sql/test_052_privacidade_bolsistas.sql');
  await sql('rollback;');

  const depois = (await db.query(helpers)).rows;
  if (JSON.stringify(antes) !== JSON.stringify(depois)) throw new Error('062 alterou helper protegido.');

  console.log('062 OK em PGlite: defeito provado antes; 062 + test_062 + test_052 + idempotência verdes; helpers idênticos.');
} catch (e) {
  console.error(e.message, e.detail || '', e.where || '');
  process.exitCode = 1;
} finally { await db.close(); }
