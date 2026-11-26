// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-071-pglite.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';
import { montarBase064, carregarArquivo } from './rodar-064-pglite.mjs';

const sql071 = 'database/071_analise_uso.sql';
const test071 = 'tests/sql/test_071_analise_uso.sql';

export function conferirRegrasCofre071(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 071 excede 90 KB (${bytes} bytes).`);
  }

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
    'net.', 'http(', 'dblink', 'cron.', 'vault.', 'password', 'service_role',
    'event trigger', 'deferr', 'alter default privileges', 'set role',
    'create role', 'alter role', 'create extension', 'concurrently', 'vacuum',
  ];
  const lower = texto.toLowerCase();
  for (const termo of proibidos) {
    if (lower.includes(termo)) {
      throw new Error(`Cofre: termo proibido encontrado na 071: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 071.');
  }
  return bytes;
}

function extrairFuncao(texto, nome) {
  const m = texto.match(
    new RegExp('create or replace function public\\.' + nome + '\\b[\\s\\S]*?\\n\\$\\$;'),
  );
  if (!m) throw new Error(`Não foi possível extrair ${nome} da 071.`);
  return m[0];
}

function exigir(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const db = new PGlite();
  const sql = (text) => db.exec(text, { onNotice: (n) => console.log('  [NOTICE]', n.message) });
  const arquivo = (path) => carregarArquivo(db, path);
  const q = (text, params) => db.query(text, params);

  async function rodarTeste(path) {
    try {
      await arquivo(path);
    } catch (e) {
      try { await sql('rollback;'); } catch { /* a transação já pode ter sido desfeita */ }
      throw e;
    }
  }

  async function restaurar071() {
    // O mutante do teto troca a assinatura; o overload não some com
    // `create or replace` do arquivo original.
    try { await sql('drop function if exists public.analise_consumir(integer);'); } catch { /* idem */ }
    await arquivo(sql071);
  }

  async function esperarFalhaTest071(rotulo, aplicarMutante, trechoEsperado) {
    await aplicarMutante();
    let falhou = false;
    let msg = '';
    try {
      await rodarTeste(test071);
    } catch (e) {
      falhou = true;
      msg = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
      await restaurar071();
    }
    if (!falhou) {
      throw new Error(`Mutante NÃO foi detectado por test_071: ${rotulo}`);
    }
    if (trechoEsperado && !msg.includes(trechoEsperado)) {
      throw new Error(`Mutante detectado pelo motivo errado (${rotulo}): ${msg}`);
    }
    console.log(`  [MUTANTE OK] ${rotulo} -> ${msg}`);
  }

  try {
    console.log('1. Montando base real (até 064, com 051/052/053/054/056/062/038/048)...');
    await montarBase064(db, { quiet: true });

    console.log('2. Provando a ausência da 071: o roteiro falha com 42P01...');
    let falhouAntes = false;
    let msgAntes = '';
    let codigoAntes = '';
    try {
      await rodarTeste(test071);
    } catch (e) {
      falhouAntes = true;
      msgAntes = e.message;
      codigoAntes = e.code ?? '';
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
    }
    if (!falhouAntes) throw new Error('test_071 passou antes da migração 071!');
    if (!(codigoAntes === '42P01' || msgAntes.includes('analise_uso'))) {
      throw new Error(`ANTES da 071 falhou pelo motivo errado: ${codigoAntes} ${msgAntes}`);
    }
    console.log(`  [ANTES OK] ${codigoAntes || 'sem código'}: ${msgAntes}`);

    console.log('3. Conferindo o cofre e aplicando a 071 (1ª vez)...');
    const texto071Bruto = await readFile(new URL('../../' + sql071, import.meta.url), 'utf8');
    const bytes = conferirRegrasCofre071(texto071Bruto);
    console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
    await arquivo(sql071);

    console.log('4. Roteiro da 071 depois da migração...');
    await rodarTeste(test071);

    console.log('5. Idempotência: reaplicando a 071 e o roteiro...');
    await arquivo(sql071);
    await rodarTeste(test071);

    console.log('6. Conferindo ACL e atributos de pg_proc...');
    const attrs = (await q(`
      select p.oid::regprocedure::text as assinatura,
             p.pronargs,
             p.prosecdef,
             p.proconfig,
             p.provolatile,
             coalesce(p.proacl::text, '') as acl
        from pg_proc p
       where p.oid in ('public.analise_consumir()'::regprocedure,
                       'public._analise_dia_brasilia(timestamptz)'::regprocedure)
       order by 1
    `)).rows;
    exigir(attrs.length === 2, 'faltou função depois da 071');
    const rpc = attrs.find((a) => a.assinatura === 'analise_consumir()');
    const dia = attrs.find((a) => a.assinatura === '_analise_dia_brasilia(timestamp with time zone)');
    exigir(rpc, 'analise_consumir() não existe');
    exigir(dia, '_analise_dia_brasilia(timestamptz) não existe');
    exigir(rpc.pronargs === 0, 'analise_consumir ganhou parâmetro');
    exigir(rpc.prosecdef === true, 'analise_consumir sem security definer');
    exigir(rpc.provolatile === 'v', 'analise_consumir deveria ser volatile');
    exigir(
      JSON.stringify(rpc.proconfig) === JSON.stringify(['search_path=public, pg_temp']),
      `search_path inesperado: ${JSON.stringify(rpc.proconfig)}`,
    );
    exigir(dia.provolatile === 'i', '_analise_dia_brasilia não é immutable');
    exigir(!dia.acl.includes('authenticated'), '_analise_dia_brasilia tem grant para authenticated');
    exigir(!dia.acl.includes('anon'), '_analise_dia_brasilia tem grant para anon');
    const aclTabela = (await q(`
      select has_table_privilege('anon', 'public.analise_uso', 'SELECT,INSERT,UPDATE,DELETE') as anon,
             has_table_privilege('authenticated', 'public.analise_uso', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as autenticado,
             (select relrowsecurity from pg_class where oid = 'public.analise_uso'::regclass) as rls,
             (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'analise_uso') as policies
    `)).rows[0];
    exigir(aclTabela.anon === false, 'anon tem acesso à tabela');
    exigir(aclTabela.autenticado === false, 'authenticated tem acesso direto à tabela');
    exigir(aclTabela.rls === true, 'RLS desligado');
    exigir(aclTabela.policies === 0, 'tabela ganhou policy');
    console.log('  [ACL/ATRIBUTOS OK]');

    console.log('7. Conferindo o BLOCO 1 da 051 (trg_bloqueia_agente em toda tabela de public)...');
    const semBarreira = (await q(`
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
    if (semBarreira) throw new Error('Tabela sem trg_bloqueia_agente válido depois da 071: ' + semBarreira);
    console.log('  [BARREIRA OK]');

    console.log('8. Provando os mutantes da 071...');
    const texto071 = texto071Bruto.replace(/\r\n/g, '\n');

    await esperarFalhaTest071(
      '1) sem RLS',
      async () => {
        await sql('alter table public.analise_uso disable row level security;');
      },
      '071 FALHOU: RLS desligado em analise_uso',
    );

    await esperarFalhaTest071(
      '2) grant de EXECUTE para anon',
      async () => {
        await sql('grant execute on function public.analise_consumir() to anon;');
      },
      '071 FALHOU: anon possui EXECUTE em analise_consumir',
    );

    await esperarFalhaTest071(
      '3) sem guarda do agente',
      async () => {
        const fn = extrairFuncao(texto071, 'analise_consumir');
        const mut = fn.replace(
          'if v_user is null or public.is_agente() then',
          'if v_user is null then',
        );
        if (mut === fn) throw new Error('Falha ao montar o mutante 3.');
        await sql(mut);
      },
      '071 FALHOU: agente barrado pelo motivo errado',
    );

    await esperarFalhaTest071(
      '4) dia em UTC no lugar de Brasília',
      async () => {
        const fn = extrairFuncao(texto071, '_analise_dia_brasilia');
        const mut = fn.replace(
          "at time zone 'America/Sao_Paulo'",
          "at time zone 'UTC'",
        );
        if (mut === fn) throw new Error('Falha ao montar o mutante 4.');
        await sql(mut);
      },
      '071 FALHOU: 02:59 UTC deveria ser 25/11 em Brasília',
    );

    await esperarFalhaTest071(
      '5) teto aceito como parâmetro',
      async () => {
        const fn = extrairFuncao(texto071, 'analise_consumir');
        const mut = fn.replace(
          'create or replace function public.analise_consumir()',
          'create function public.analise_consumir(p_teto integer default 50)',
        );
        if (mut === fn) throw new Error('Falha ao montar o mutante 5.');
        await sql('drop function public.analise_consumir();');
        await sql(mut);
      },
      '071 FALHOU: analise_consumir deveria ter zero parâmetros',
    );

    await esperarFalhaTest071(
      '6) delete da linha de outro usuário',
      async () => {
        const fn = extrairFuncao(texto071, 'analise_consumir');
        const mut = fn.replace(
          'where user_id = v_user',
          'where user_id <> v_user',
        );
        if (mut === fn) throw new Error('Falha ao montar o mutante 6.');
        await sql(mut);
      },
      '071 FALHOU: A não pode apagar a linha antiga de B',
    );

    console.log('9. Conferência final depois dos mutantes...');
    await restaurar071();
    await rodarTeste(test071);

    console.log('071 OK em PGlite: ausência antes (42P01) + migração + roteiro + idempotência + ACL/atributos + barreira 051 + 6 mutantes.');
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
