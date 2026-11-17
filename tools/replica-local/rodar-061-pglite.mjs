// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-056 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-061-pglite.mjs (base 051→054 e então prova a 061)
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
  for (const path of ['tools/replica-local/sintetico/stub.sql',
    'tools/replica-local/sintetico/stub-051.sql', 'tools/replica-local/sintetico/stub-054.sql',
    'database/051_buriti_propostas_do_agente.sql', 'tools/replica-local/sintetico/stub-052.sql',
    'database/052_privacidade_bolsistas_agente.sql', 'database/054_buriti_tarefas.sql']) await arquivo(path);
  // Antes da 061 o roteiro tem de falhar: a tabela não existe.
  let lacuna = false;
  try { await arquivo('tests/sql/test_061_planejamento_premissas.sql'); }
  catch (e) {
    if (e.code !== '42P01' || !e.message.includes('planejamento_versoes')) throw e;
    lacuna = true;
    console.log('ANTES da 061: roteiro detectou a falta de planejamento_versoes (42P01).');
  } finally { await sql('rollback;'); }
  if (!lacuna) throw new Error('Roteiro não detectou a lacuna antes da 061.');
  const antes = (await db.query(helpers)).rows;
  await arquivo('database/061_planejamento_premissas.sql');
  await arquivo('tests/sql/test_061_planejamento_premissas.sql');
  // BLOCO 1 do roteiro da 051: toda tabela de public (exceto propostas_agente) tem a barreira do agente.
  const sem = (await db.query(`select string_agg(c.relname, ', ') v from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relname<>'propostas_agente'
      and not exists (select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='trg_bloqueia_agente')`)).rows[0].v;
  if (sem) throw new Error('Tabela sem barreira do agente depois da 061: ' + sem);
  const depois = (await db.query(helpers)).rows;
  if (JSON.stringify(antes) !== JSON.stringify(depois)) throw new Error('061 alterou helper protegido.');
  // Repetir a 061 tem de falhar (a tabela já existe), sem estragar nada.
  let repetiu = false;
  try { await arquivo('database/061_planejamento_premissas.sql'); } catch { repetiu = true; await sql('rollback;'); }
  if (!repetiu) throw new Error('061 aplicada duas vezes sem erro.');
  console.log('061 OK');
} finally { await db.close(); }
