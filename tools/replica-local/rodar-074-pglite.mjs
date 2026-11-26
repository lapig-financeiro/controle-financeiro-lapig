// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-074-pglite.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';
import { montarBase064, carregarArquivo } from './rodar-064-pglite.mjs';

const sql074 = 'database/074_analise_registro.sql';
const test074 = 'tests/sql/test_074_analise_registro.sql';

const FUNCOES = [
  'public.analise_registro_iniciar(text, integer, text)',
  'public.analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text)',
  'public.analise_feedback_enviar(uuid, smallint, text, text)',
  'public.analise_registros_admin(timestamp with time zone, integer)',
];

export function conferirRegrasCofre074(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 074 excede 90 KB (${bytes} bytes).`);
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
      throw new Error(`Cofre: termo proibido encontrado na 074: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 074.');
  }
  return bytes;
}

function extrairFuncao(texto, nome) {
  const m = texto.match(
    new RegExp('create or replace function public\\.' + nome + '\\b[\\s\\S]*?\\n\\$\\$;'),
  );
  if (!m) throw new Error(`Não foi possível extrair ${nome} da 074.`);
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

  async function restaurar074() {
    await arquivo(sql074);
  }

  async function esperarFalhaTest074(rotulo, aplicarMutante, trechoEsperado) {
    await aplicarMutante();
    let falhou = false;
    let msg = '';
    try {
      await rodarTeste(test074);
    } catch (e) {
      falhou = true;
      msg = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
      await restaurar074();
    }
    if (!falhou) {
      throw new Error(`Mutante NÃO foi detectado por test_074: ${rotulo}`);
    }
    if (trechoEsperado && !msg.includes(trechoEsperado)) {
      throw new Error(`Mutante detectado pelo motivo errado (${rotulo}): ${msg}`);
    }
    console.log(`  [MUTANTE OK] ${rotulo} -> ${msg}`);
  }

  try {
    console.log('1. Montando base real (até 064, com 051/052/053/054/056/062/038/048)...');
    await montarBase064(db, { quiet: true });

    console.log('2. Provando a ausência da 074: o roteiro falha com 42P01...');
    let falhouAntes = false;
    let msgAntes = '';
    let codigoAntes = '';
    try {
      await rodarTeste(test074);
    } catch (e) {
      falhouAntes = true;
      msgAntes = e.message;
      codigoAntes = e.code ?? '';
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
    }
    if (!falhouAntes) throw new Error('test_074 passou antes da migração 074!');
    if (codigoAntes !== '42P01') {
      throw new Error(`ANTES da 074 falhou pelo motivo errado: ${codigoAntes} ${msgAntes}`);
    }
    console.log(`  [ANTES OK] ${codigoAntes || 'sem código'}: ${msgAntes}`);

    console.log('3. Conferindo o cofre e aplicando a 074 (1ª vez)...');
    const texto074Bruto = await readFile(new URL('../../' + sql074, import.meta.url), 'utf8');
    const bytes = conferirRegrasCofre074(texto074Bruto);
    console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
    await arquivo(sql074);

    console.log('4. Roteiro da 074 depois da migração...');
    await rodarTeste(test074);

    console.log('5. Idempotência: reaplicando a 074 e o roteiro...');
    await arquivo(sql074);
    await rodarTeste(test074);

    console.log('6. Conferindo ACL e atributos de pg_proc...');
    const attrs = (await q(`
      select p.oid::regprocedure::text as assinatura,
             p.pronargs,
             p.pronargdefaults,
             p.prosecdef,
             p.proconfig,
             p.provolatile,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
             exists (
               select 1
                 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE'
             ) as public_exec
        from pg_proc p
       where p.oid in (${FUNCOES.map((f) => `'${f}'::regprocedure`).join(', ')})
       order by 1
    `)).rows;
    exigir(attrs.length === 4, `esperava 4 RPCs, vieram ${attrs.length}`);

    const esperado = [
      { nome: 'analise_registro_iniciar(text,integer,text)', args: 3, defaults: 2 },
      {
        nome: 'analise_registro_concluir(uuid,jsonb,jsonb,integer,integer,integer,text,text)',
        args: 8,
        defaults: 1,
      },
      { nome: 'analise_feedback_enviar(uuid,smallint,text,text)', args: 4, defaults: 3 },
      { nome: 'analise_registros_admin(timestamp with time zone,integer)', args: 2, defaults: 2 },
    ];    for (const e of esperado) {
      const a = attrs.find((x) => x.assinatura === e.nome);
      exigir(a, `${e.nome} não existe`);
      exigir(a.pronargs === e.args, `${e.nome}: ${a.pronargs} parâmetros`);
      exigir(a.pronargdefaults === e.defaults, `${e.nome}: defaults inesperados`);
      exigir(a.prosecdef === true, `${e.nome} sem security definer`);
      exigir(
        JSON.stringify(a.proconfig) === JSON.stringify(['search_path=public, pg_temp']),
        `${e.nome}: search_path inesperado ${JSON.stringify(a.proconfig)}`,
      );
      exigir(a.auth_exec === true, `${e.nome} sem EXECUTE para authenticated`);
      exigir(a.anon_exec === false, `${e.nome} com EXECUTE para anon`);
      exigir(a.public_exec === false, `${e.nome} com EXECUTE para PUBLIC`);
    }

    const aclTabelas = (await q(`
      select c.relname,
             has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon,
             has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as autenticado,
             c.relrowsecurity as rls,
             (select count(*)::int from pg_policies
               where schemaname = 'public' and tablename = c.relname) as policies
        from pg_class c
       where c.oid in ('public.analise_registro'::regclass, 'public.analise_feedback'::regclass)
       order by c.relname
    `)).rows;
    exigir(aclTabelas.length === 2, 'faltou tabela depois da 074');
    for (const t of aclTabelas) {
      exigir(t.anon === false, `anon tem acesso a ${t.relname}`);
      exigir(t.autenticado === false, `authenticated tem acesso direto a ${t.relname}`);
      exigir(t.rls === true, `RLS desligado em ${t.relname}`);
      exigir(t.policies === 0, `${t.relname} ganhou policy`);
    }
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
    if (semBarreira) throw new Error('Tabela sem trg_bloqueia_agente válido depois da 074: ' + semBarreira);
    console.log('  [BARREIRA OK]');

    console.log('8. Provando os mutantes da 074...');
    const texto074 = texto074Bruto.replace(/\r\n/g, '\n');

    await esperarFalhaTest074(
      '1) sem RLS em analise_registro',
      async () => {
        await sql('alter table public.analise_registro disable row level security;');
      },
      '074 FALHOU: RLS desligado em analise_registro',
    );

    await esperarFalhaTest074(
      '2) grant de EXECUTE para anon',
      async () => {
        await sql('grant execute on function public.analise_registro_iniciar(text, integer, text) to anon;');
      },
      '074 FALHOU: anon possui EXECUTE',
    );

    await esperarFalhaTest074(
      '3) sem guarda do agente',
      async () => {
        const fn = extrairFuncao(texto074, 'analise_registro_iniciar');
        const mut = fn.replace(
          'if v_user is null or public.is_agente() then',
          'if v_user is null then',
        );
        if (mut === fn) throw new Error('Falha ao montar o mutante 3.');
        await sql(mut);
      },
      '074 FALHOU: agente barrado pelo motivo errado',
    );

    await esperarFalhaTest074(
      '4) concluir sem checar dono',
      async () => {
        const fn = extrairFuncao(texto074, 'analise_registro_concluir');
        const mut = fn.replace('and user_id = v_user', 'and true');
        if (mut === fn) throw new Error('Falha ao montar o mutante 4.');
        await sql(mut);
      },
      '074 FALHOU: A concluiu o registro de B',
    );

    await esperarFalhaTest074(
      '5) concluir duas vezes',
      async () => {
        const fn = extrairFuncao(texto074, 'analise_registro_concluir');
        const mut = fn.replace(
          'and terminada_em is null',
          'and (terminada_em is null or true)',
        );
        if (mut === fn) throw new Error('Falha ao montar o mutante 5.');
        await sql(mut);
      },
      '074 FALHOU: A concluiu duas vezes',
    );

    await esperarFalhaTest074(
      '6) analise_registros_admin sem is_admin()',
      async () => {
        const fn = extrairFuncao(texto074, 'analise_registros_admin');
        const mut = fn.replace(
          'if not public.is_admin() then',
          'if not public.is_admin() and false then',
        );
        if (mut === fn) throw new Error('Falha ao montar o mutante 6.');
        await sql(mut);
      },
      '074 FALHOU: professor chamou analise_registros_admin',
    );

    await esperarFalhaTest074(
      '7) retenção apagando linha de outro usuário',
      async () => {
        const fn = extrairFuncao(texto074, 'analise_registro_iniciar');
        const mut = fn.replace(
          'where user_id = v_user',
          'where (user_id = v_user or true)',
        );
        if (mut === fn) throw new Error('Falha ao montar o mutante 7.');
        await sql(mut);
      },
      '074 FALHOU: A apagou as linhas antigas de B',
    );

    console.log('9. Conferência final depois dos mutantes...');
    await restaurar074();
    await rodarTeste(test074);

    console.log('074 OK em PGlite: ausência antes (42P01) + migração + roteiro + idempotência + ACL/atributos + barreira 051 + 7 mutantes.');
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
