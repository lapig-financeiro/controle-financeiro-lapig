// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-067-pglite.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';
import { montarBase064, carregarArquivo } from './rodar-064-pglite.mjs';

const sql067 = 'database/067_termos_contrato.sql';
const test067 = 'tests/sql/test_067_termos_contrato.sql';

export function conferirRegrasCofre067(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 067 excede 90 KB (${bytes} bytes).`);
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
      throw new Error(`Cofre: termo proibido encontrado na 067: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 067.');
  }
  // Inserts de dados pela própria migração são proibidos; os que estão
  // dentro de CREATE FUNCTION são o corpo das RPCs, não linha nova.
  const semFuncoes = miolo.replace(/create or replace function[\s\S]*?\$\$;/gi, '');
  if (/\binsert\s+into\s+public\.termos_contrato\b/i.test(semFuncoes)) {
    throw new Error('Cofre: a 067 não pode inserir linha em termos_contrato.');
  }
  return bytes;
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

function extrairFuncao(texto, nome) {
  const m = texto.match(new RegExp('create or replace function public\\.' + nome + '\\b[\\s\\S]*?\\n\\$\\$;'));
  if (!m) throw new Error(`Não foi possível extrair ${nome} da 067.`);
  return m[0];
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
      try { await sql('rollback;'); } catch { /* a transação pode já ter sido desfeita */ }
      throw e;
    }
  }

  async function esperarFalhaTest067(rotulo, aplicarMutante, trechoEsperado) {
    await aplicarMutante();
    let falhou = false;
    let msg = '';
    try {
      await rodarTeste(test067);
    } catch (e) {
      falhou = true;
      msg = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
      await arquivo(sql067);
    }
    if (!falhou) {
      throw new Error(`Mutante NÃO foi detectado por test_067: ${rotulo}`);
    }
    if (trechoEsperado && !msg.includes(trechoEsperado)) {
      throw new Error(`Mutante detectado pelo motivo errado (${rotulo}): ${msg}`);
    }
    console.log(`  [MUTANTE OK] ${rotulo} -> ${msg}`);
  }

  try {
    console.log('1. Montando base real (025 + 026 + 051/052/054/053/056/062 + 038/048 + 063 + 064/stub-064)...');
    await montarBase064(db, { quiet: true });
    // A 067 referencia public.documentos (064) e o roteiro usa o plano
    // sintético do 51.X como fonte de um termo.
    await arquivo('database/064_rastreabilidade.sql');
    await arquivo('tools/replica-local/sintetico/stub-064.sql');
    // A base 064 pára antes da 020 e não tem a coluna active em
    // scholarship_holders; para o teste de "não reativa o centro",
    // aplica só o gatilho de projetos da 020, que é o que a 067 usa.
    const texto020 = await readFile(new URL('../../database/020_toggle_active.sql', import.meta.url), 'utf8');
    const gatilho020 = texto020.match(
      /create or replace function public\.auto_reactivate_project\(\)[\s\S]*?execute function public\.auto_reactivate_project\(\);/,
    );
    if (!gatilho020) throw new Error('Não foi possível extrair o gatilho de projetos da 020.');
    await sql(gatilho020[0]);
    console.log('  [BASE] 064 + stub-064 + gatilho auto_reactivate_project (020) aplicados.');

    const helpersAntes = (await q(helpersQuery)).rows;

    console.log('2. Conferindo que test_067 FALHA antes da 067...');
    let falhouAntes = false;
    let msgAntes = '';
    try {
      await rodarTeste(test067);
    } catch (e) {
      if (e.code !== '42P01' && e.code !== '42883') {
        throw new Error(`ANTES da 067 falhou com código inesperado (${e.code}): ${e.message}`);
      }
      falhouAntes = true;
      msgAntes = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
    }
    if (!falhouAntes) throw new Error('test_067 passou antes da migração 067!');
    console.log(`  [ANTES OK] ${msgAntes}`);

    console.log('3. Conferindo o cofre e aplicando a 067 (1ª vez)...');
    const texto067 = await readFile(new URL('../../' + sql067, import.meta.url), 'utf8');
    const bytes = conferirRegrasCofre067(texto067);
    console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
    await arquivo(sql067);

    console.log('4. Executando test_067...');
    await rodarTeste(test067);

    console.log('5. Testando idempotência (reaplicando 067 e o roteiro)...');
    await arquivo(sql067);
    await rodarTeste(test067);

    console.log('6. Conferindo BLOCO 1 da 051 (trg_bloqueia_agente em todas as tabelas de public)...');
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
    if (semBarreira) throw new Error('Tabela sem trg_bloqueia_agente válido depois da 067: ' + semBarreira);
    console.log('  [BARREIRA OK]');

    const helpersDepois = (await q(helpersQuery)).rows;
    if (JSON.stringify(helpersAntes) !== JSON.stringify(helpersDepois)) {
      throw new Error('067 alterou algum helper protegido!');
    }
    console.log('  [HELPERS OK] os 6 helpers protegidos não mudaram.');

    console.log('7. Provando mutantes da 067...');

    await esperarFalhaTest067(
      '1) get_termos_contrato_v2 devolvendo a nota para professor',
      async () => {
        const fn = extrairFuncao(texto067, 'get_termos_contrato_v2');
        const mut = fn.replace(
          "'nota',               case when v_admin then t.nota else null end,",
          "'nota',               t.nota,",
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 1.');
        await sql(mut);
      },
      'professor não pode receber a nota',
    );

    await esperarFalhaTest067(
      '2) usar_vigencia_do_contrato_v2 mexendo em todos os centros',
      async () => {
        const fn = extrairFuncao(texto067, 'usar_vigencia_do_contrato_v2');
        const alvo = `  update public.projects
     set end_date   = v_fim,
         start_date = coalesce(v_inicio, start_date)
   where id = p_project_id;`;
        const mut = fn.replace(
          alvo,
          `  update public.projects
     set end_date   = v_fim,
         start_date = coalesce(v_inicio, start_date)
   where true;`,
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 2.');
        await sql(mut);
      },
      'não pode tocar no 51.X',
    );

    await esperarFalhaTest067(
      '3) registrar_termo_contrato_v2 sem idempotência',
      async () => {
        const fn = extrairFuncao(texto067, 'registrar_termo_contrato_v2');
        const mut = fn.replace('  if found\n     and', '  if false and');
        if (mut === fn) throw new Error('Falha ao montar mutante 3.');
        await sql(mut);
      },
      'idempotência deveria devolver o mesmo id',
    );

    await esperarFalhaTest067(
      '4) get_termos_contrato_v2 devolvendo o caminho do documento para o agente',
      async () => {
        const fn = extrairFuncao(texto067, 'get_termos_contrato_v2');
        const mut = fn.replace(
          'or public.is_agente()',
          'or false',
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 4.');
        await sql(mut);
      },
      'agente não pode receber o caminho do documento do plano',
    );

    await esperarFalhaTest067(
      '5) usar_vigencia_do_contrato_v2 reativando centro inativo',
      async () => {
        const fn = extrairFuncao(texto067, 'usar_vigencia_do_contrato_v2');
        const alvo = `  if v_active is distinct from (select p.active from public.projects p where p.id = p_project_id) then
    update public.projects
       set active = v_active
     where id = p_project_id;
  end if;`;
        const mut = fn.replace(alvo, '');
        if (mut === fn) throw new Error('Falha ao montar mutante 5.');
        await sql(mut);
      },
      'não pode reativar o centro inativo',
    );

    await esperarFalhaTest067(
      '6) termo sem taxa_total no CHECK da tabela',
      async () => {
        await sql(`
          alter table public.termos_contrato drop constraint termos_contrato_termo_check;
          alter table public.termos_contrato
            add constraint termos_contrato_termo_check
            check (termo in ('vigencia_inicio', 'vigencia_fim', 'taxa_cip_ufg', 'taxa_cip_ua', 'taxa_dao'));
        `);
      },
      'termos_contrato_termo_check',
    );

    await esperarFalhaTest067(
      '7) registrar_termo_contrato_v2 sem exigir documento_url/documento_id',
      async () => {
        const fn = extrairFuncao(texto067, 'registrar_termo_contrato_v2');
        const alvo = `  if v_doc_url is null and v_doc_id is null then
    raise exception 'Informe documento_url ou documento_id.' using errcode = '22023';
  end if;`;
        const mut = fn.replace(alvo, '');
        if (mut === fn) throw new Error('Falha ao montar mutante 7.');
        await sql(mut);
      },
      'termos_contrato_documento_fonte_check',
    );

    await esperarFalhaTest067(
      '8) grant select direto para authenticated',
      async () => {
        await sql('grant select on public.termos_contrato to authenticated;');
      },
      'operação deveria falhar',
    );

    console.log('8. Conferência final depois dos mutantes...');
    await arquivo(sql067);
    await rodarTeste(test067);

    const helpersFinal = (await q(helpersQuery)).rows;
    if (JSON.stringify(helpersAntes) !== JSON.stringify(helpersFinal)) {
      throw new Error('Mutantes deixaram helper protegido alterado!');
    }

    console.log('067 OK em PGlite: base real + 064/stub-064 + test_067 falhando antes + test_067 + idempotência + barreira 051 + helpers intactos + 8 mutantes + roteiro final.');
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
