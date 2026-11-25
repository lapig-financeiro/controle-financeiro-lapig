// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-070-pglite.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';
import { montarBase064, carregarArquivo } from './rodar-064-pglite.mjs';

const sql070 = 'database/070_folha_atrasada.sql';
const test070 = 'tests/sql/test_070_folha_atrasada.sql';
const test066 = 'tests/sql/test_066_taxas_comprometidas.sql';
const test065 = 'tests/sql/test_065_rastreabilidade_ajustes.sql';
const test064 = 'tests/sql/test_064_rastreabilidade.sql';
const stub066 = 'tools/replica-local/sintetico/stub-066.sql';
const stub070 = 'tools/replica-local/sintetico/stub-070.sql';
const a1 = '00000000-0000-0000-0000-0000000000a1';

const centrosSemAtraso = [
  '70.SEM_ATRASO',
  '70.BOLSA_ANTIGA',
  '70.UM_BALANCETE',
  '70.SEM_BALANCETE',
  '70.FORA_JANELA',
];
const centrosComAtraso = ['70.UM_MES', '70.DOIS_MESES', '70.DIA_MAIOR_07', '70.CANCELADA', '70.JANELA', '70.EMPATE'];

export function conferirRegrasCofre070(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 070 excede 90 KB (${bytes} bytes).`);
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
      throw new Error(`Cofre: termo proibido encontrado na 070: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 070.');
  }
  return bytes;
}

function extrairFuncao(texto, nome) {
  const m = texto.match(new RegExp('create or replace function public\\.' + nome + '\\b[\\s\\S]*?\\n\\$\\$;'));
  if (!m) throw new Error(`Não foi possível extrair ${nome} da 070.`);
  return m[0];
}

function centavos(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function exigir(cond, msg) {
  if (!cond) throw new Error(msg);
}

function buscarNo(no, chave) {
  if (!no || typeof no !== 'object') return null;
  if (no.chave === chave) return no;
  for (const filho of no.partes || []) {
    const achado = buscarNo(filho, chave);
    if (achado) return achado;
  }
  return null;
}

function verificarArvore(no, rotulo, raiz = true) {
  exigir(no && typeof no === 'object', `${rotulo}: nó inválido`);
  const chave = no.chave || '<sem-chave>';

  if (typeof no.valor !== 'number') {
    if (raiz && (no.partes || []).length === 0) return;
    throw new Error(`${rotulo}: nó ${chave} com valor não numérico`);
  }
  exigir(['calculo', 'documento', 'legado', 'digitado'].includes(no.tipo),
    `${rotulo}: tipo inválido ${no.tipo} em ${chave}`);
  exigir(no.sinal === 1 || no.sinal === -1, `${rotulo}: sinal inválido em ${chave}`);

  if (no.tipo === 'calculo') {
    exigir(Array.isArray(no.partes) && no.partes.length > 0, `${rotulo}: nó ${chave} sem partes`);
    const soma = no.partes.reduce((s, f) => s + (f.sinal === -1 ? -1 : 1) * Number(f.valor || 0), 0);
    exigir(centavos(soma) === centavos(no.valor),
      `${rotulo}: nó ${chave} não fecha (valor ${no.valor}, soma ${soma})`);
    for (const filho of no.partes) verificarArvore(filho, rotulo, false);
  } else {
    exigir((no.partes || []).length === 0, `${rotulo}: folha ${chave} tem partes`);
  }
}

function compararProfundo(antes, depois, caminho = '', ignorar = new Set(), difs = []) {
  if (caminho && ignorar.has(caminho)) return difs;
  if (antes === depois) return difs;

  if (
    antes === null || depois === null ||
    typeof antes !== 'object' || typeof depois !== 'object'
  ) {
    difs.push(`${caminho || '<raiz>'}: ${JSON.stringify(antes)} -> ${JSON.stringify(depois)}`);
    return difs;
  }

  if (Array.isArray(antes) !== Array.isArray(depois)) {
    difs.push(`${caminho || '<raiz>'}: array != objeto`);
    return difs;
  }

  if (Array.isArray(antes)) {
    if (antes.length !== depois.length) {
      difs.push(`${caminho || '<raiz>'}: tamanho ${antes.length} -> ${depois.length}`);
    }
    for (let i = 0; i < Math.min(antes.length, depois.length); i += 1) {
      compararProfundo(antes[i], depois[i], `${caminho}[${i}]`, ignorar, difs);
    }
    return difs;
  }

  for (const k of Object.keys(antes)) {
    const p = caminho ? `${caminho}.${k}` : k;
    if (ignorar.has(p)) continue;
    if (!(k in depois)) {
      difs.push(`${p}: só antes`);
      continue;
    }
    compararProfundo(antes[k], depois[k], p, ignorar, difs);
  }
  for (const k of Object.keys(depois)) {
    const p = caminho ? `${caminho}.${k}` : k;
    if (ignorar.has(p)) continue;
    if (!(k in antes)) difs.push(`${p}: só depois`);
  }
  return difs;
}

async function main() {
  const db = new PGlite();
  const sql = (text) => db.exec(text, { onNotice: (n) => console.log('  [NOTICE]', n.message) });
  const arquivo = (path) => carregarArquivo(db, path);
  const q = (text, params) => db.query(text, params);

  async function emTransacao(fn) {
    await sql('begin;');
    try {
      return await fn();
    } finally {
      try { await sql('rollback;'); } catch { /* a transação já pode ter sido desfeita */ }
    }
  }

  async function rodarTeste(path) {
    try {
      await arquivo(path);
    } catch (e) {
      try { await sql('rollback;'); } catch { /* idem */ }
      throw e;
    }
  }

  async function comoAdmin(fn) {
    return emTransacao(async () => {
      await sql(`select set_config('request.jwt.claim.sub', '${a1}', true); set local role authenticated;`);
      return fn();
    });
  }

  async function saldoLivre(code) {
    return comoAdmin(async () => {
      const r = await q(`select public.get_saldo_livre(p.id) as sl
                           from public.projects p where p.code = $1`, [code]);
      return r.rows[0]?.sl ?? null;
    });
  }

  async function arvore(code) {
    return comoAdmin(async () => {
      const r = await q(`select public.explicar_livre_v2(p.id) as ex
                           from public.projects p where p.code = $1`, [code]);
      return r.rows[0]?.ex ?? null;
    });
  }

  async function capturarSaldos(codes) {
    const out = {};
    for (const code of codes) out[code] = await saldoLivre(code);
    return out;
  }

  async function capturarArvores(codes) {
    const out = {};
    for (const code of codes) out[code] = await arvore(code);
    return out;
  }

  async function capturarAtributos() {
    const r = await q(`
      select p.oid::regprocedure::text as assinatura,
             p.prosecdef, p.proconfig, p.provolatile,
             coalesce(p.proacl::text, '') as acl
        from pg_proc p
       where p.oid in ('public.get_saldo_livre(uuid)'::regprocedure,
                       'public.explicar_livre_v2(uuid)'::regprocedure)
       order by 1
    `);
    return r.rows;
  }

  async function esperarFalhaTest070(rotulo, aplicarMutante, trechoEsperado) {
    await aplicarMutante();
    let falhou = false;
    let msg = '';
    try {
      await rodarTeste(test070);
    } catch (e) {
      falhou = true;
      msg = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
      await arquivo(sql070);
    }
    if (!falhou) {
      throw new Error(`Mutante NÃO foi detectado por test_070: ${rotulo}`);
    }
    if (trechoEsperado && !msg.includes(trechoEsperado)) {
      throw new Error(`Mutante detectado pelo motivo errado (${rotulo}): ${msg}`);
    }
    console.log(`  [MUTANTE OK] ${rotulo} -> ${msg}`);
  }

  async function conferirArvoreEResumo(codes) {
    let conferidos = 0;
    for (const code of codes) {
      const sl = await saldoLivre(code);
      const ex = await arvore(code);
      if (!sl || sl.has_plano !== true) continue;

      const grupos = Array.isArray(sl.grupos) ? sl.grupos : [];
      const soma = grupos.reduce((s, g) => s + Number(g.saldo_livre || 0), 0);

      if (grupos.length > 0 && typeof ex?.valor === 'number') {
        exigir(centavos(ex.valor) === centavos(soma),
          `${code}: raiz da árvore ${ex?.valor} != soma dos grupos ${soma}`);
        for (const grupo of grupos) {
          const noGrupo = buscarNo(ex, 'grupo:' + grupo.grupo_code);
          exigir(noGrupo, `${code}: árvore sem grupo:${grupo.grupo_code}`);
          exigir(centavos(noGrupo.valor) === centavos(grupo.saldo_livre),
            `${code}: grupo ${grupo.grupo_code} da árvore != get_saldo_livre`);
        }
      }
      verificarArvore(ex, code);
      conferidos += 1;
    }
    return conferidos;
  }

  try {
    console.log('1. Montando base real (025 + 026 + 051/052/054/053/056/062 + 038/048 + 063)...');
    await montarBase064(db, { quiet: true });

    console.log('2. Aplicando 064, stub-064, 065, 066, stub-066 e o stub-070...');
    await arquivo('database/064_rastreabilidade.sql');
    await arquivo('tools/replica-local/sintetico/stub-064.sql');
    await arquivo('database/065_rastreabilidade_ajustes.sql');
    await arquivo('database/066_taxas_comprometidas.sql');
    await arquivo(stub066);
    await arquivo(stub070);

    console.log('3. Capturando saldos e árvores ANTES da 070 nos centros sem atraso...');
    const saldosAntes = await capturarSaldos(centrosSemAtraso);
    const arvoresAntes = await capturarArvores(centrosSemAtraso);
    const atributosAntes = await capturarAtributos();
    console.log(`  centros capturados: ${centrosSemAtraso.join(', ')}`);

    console.log('4. Conferindo que test_070 FALHA antes da 070, pela folha de outubro livre...');
    let falhouAntes = false;
    let msgAntes = '';
    try {
      await rodarTeste(test070);
    } catch (e) {
      falhouAntes = true;
      msgAntes = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
    }
    if (!falhouAntes) throw new Error('test_070 passou antes da migração 070!');
    if (!msgAntes.includes('070 FALHOU: 70.UM_MES deveria conferir a folha')) {
      throw new Error(`ANTES da 070 falhou pelo motivo errado: ${msgAntes}`);
    }
    console.log(`  [ANTES OK] ${msgAntes}`);

    console.log('5. Conferindo o cofre e aplicando a 070 (1ª vez)...');
    const texto070Bruto = await readFile(new URL('../../' + sql070, import.meta.url), 'utf8');
    const texto070 = texto070Bruto.replace(/\r\n/g, '\n');
    const bytes = conferirRegrasCofre070(texto070Bruto);
    console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
    await arquivo(sql070);

    console.log('6. Comparando o retorno ANTES e DEPOIS (só as chaves novas e a nota podem mudar)...');
    const saldosDepois = await capturarSaldos(centrosSemAtraso);
    const ignorarNoSaldo = new Set(['folha_conferencia', 'folha_atrasada', 'nota']);
    for (const code of centrosSemAtraso) {
      const difs = compararProfundo(saldosAntes[code], saldosDepois[code], '', ignorarNoSaldo);
      if (difs.length > 0) {
        throw new Error(`${code}: o retorno mudou além das chaves novas/nota:\n  ${difs.join('\n  ')}`);
      }
      const novo = saldosDepois[code];
      exigir(novo.folha_atrasada === null, `${code}: sem atraso deveria ter folha_atrasada null`);
      exigir(['feita', 'sem_balancete_anterior', 'sem_balancete'].includes(novo.folha_conferencia),
        `${code}: folha_conferencia inesperada (${novo.folha_conferencia})`);
    }
    console.log(`  [RETORNO OK] ${centrosSemAtraso.length} centros idênticos fora as chaves novas e a nota.`);

    console.log('7. Comparando as árvores ANTES e DEPOIS (têm de ser idênticas sem atraso)...');
    const arvoresDepois = await capturarArvores(centrosSemAtraso);
    for (const code of centrosSemAtraso) {
      const difs = compararProfundo(arvoresAntes[code], arvoresDepois[code]);
      if (difs.length > 0) {
        throw new Error(`${code}: árvore mudou sem folha atrasada:\n  ${difs.join('\n  ')}`);
      }
    }
    console.log(`  [ÁRVORE OK] ${centrosSemAtraso.length} árvores idênticas à 066.`);

    console.log('8. Executando test_064, test_065, test_066 e test_070 depois da 070...');
    await rodarTeste(test064);
    await rodarTeste(test065);
    await rodarTeste(test066);
    await rodarTeste(test070);

    console.log('9. Testando idempotência (reaplicando 070 e os roteiros)...');
    await arquivo(sql070);
    await rodarTeste(test064);
    await rodarTeste(test065);
    await rodarTeste(test066);
    await rodarTeste(test070);

    console.log('10. Conferindo árvore = get_saldo_livre nos centros com e sem atraso...');
    const qtd = await conferirArvoreEResumo([...centrosSemAtraso, ...centrosComAtraso]);
    console.log(`  [FECHAMENTO OK] ${qtd} centros com raiz = soma dos grupos e todos os nós fechando.`);

    console.log('11. Conferindo os atributos de pg_proc e a ACL antes/depois...');
    const atributosDepois = await capturarAtributos();
    if (JSON.stringify(atributosAntes) !== JSON.stringify(atributosDepois)) {
      throw new Error('070 alterou prosecdef/proconfig/ACL das funções.');
    }
    console.log('  [ATRIBUTOS OK]');

    console.log('12. Conferindo BLOCO 1 da 051 (trg_bloqueia_agente em todas as tabelas de public)...');
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
    if (semBarreira) throw new Error('Tabela sem trg_bloqueia_agente válido depois da 070: ' + semBarreira);
    console.log('  [BARREIRA OK]');

    console.log('13. Provando os mutantes da 070...');
    await esperarFalhaTest070(
      '1) sem greatest(..., 0)',
      async () => {
        const fn = extrairFuncao(texto070, 'get_saldo_livre');
        const mut = fn.replace(
          'v_falta := round(greatest(coalesce(v_max_falta, 0), 0), 2);',
          'v_falta := round(coalesce(v_max_falta, 0), 2);',
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 1.');
        await sql(mut);
      },
      '070 FALHOU: 70.BOLSA_ANTIGA não pode diminuir o compromisso',
    );

    await esperarFalhaTest070(
      '2) só o par imediato (mais recente, sem o máximo)',
      async () => {
        const fn = extrairFuncao(texto070, 'get_saldo_livre');
        const mut = fn.replace(
          'select count(*), max(p.falta),',
          'select count(*), (array_agg(p.falta order by p.data_referencia desc))[1],',
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 2.');
        await sql(mut);
      },
      '070 FALHOU: 70.DOIS_MESES deveria ver as duas folhas',
    );

    await esperarFalhaTest070(
      "3) status = 'active' no lugar de <> 'cancelled'",
      async () => {
        const fn = extrairFuncao(texto070, 'get_saldo_livre');
        const alvo = `where s.project_id = p_project_id
                  and s.status <> 'cancelled'
             ), 0) as esperado,`;
        const mut = fn.replace(alvo, `where s.project_id = p_project_id
                  and s.status = 'active'
             ), 0) as esperado,`);
        if (mut === fn) throw new Error('Falha ao montar mutante 3.');
        await sql(mut);
      },
      '070 FALHOU: 70.UM_MES falta deveria ser 8000',
    );

    await esperarFalhaTest070(
      '4) >= trocado por > na janela de 6 meses',
      async () => {
        const fn = extrairFuncao(texto070, 'get_saldo_livre');
        const mut = fn.replace(
          'and c.cober >= (v_ultimo_cober - make_interval(months => c_meses_conferencia))::date',
          'and c.cober > (v_ultimo_cober - make_interval(months => c_meses_conferencia))::date',
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 4.');
        await sql(mut);
      },
      '070 FALHOU: 70.JANELA (exatamente 6 meses) deveria conferir',
    );

    await esperarFalhaTest070(
      '5) soma sem arredondar (guarda estrutural; o schema só guarda centavos)',
      async () => {
        const fn = extrairFuncao(texto070, 'get_saldo_livre');
        const mut = fn.replace(
          'v_falta := round(greatest(coalesce(v_max_falta, 0), 0), 2);',
          'v_falta := greatest(coalesce(v_max_falta, 0), 0);',
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 5.');
        await sql(mut);
      },
      '070 FALHOU: get_saldo_livre deveria arredondar a falta a centavos',
    );

    await esperarFalhaTest070(
      '6) explicar_livre_v2 sem separar a folha (duplicaria)',
      async () => {
        const fn = extrairFuncao(texto070, 'explicar_livre_v2');
        const mut = fn.replace(
          "'valor', v_r_comp - v_folha_valor, 'tipo', 'calculo',",
          "'valor', v_r_comp, 'tipo', 'calculo',",
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 6.');
        await sql(mut);
      },
      '070 FALHOU: nó grupo:a não fecha',
    );

    console.log('14. Conferência final depois dos mutantes...');
    await arquivo(sql070);
    await rodarTeste(test064);
    await rodarTeste(test065);
    await rodarTeste(test066);
    await rodarTeste(test070);

    console.log('070 OK em PGlite: base real + 064/065/066 + stubs + retorno e árvores idênticos sem atraso + test_070 falhando antes + test_064/test_065/test_066/test_070 + idempotência + fechamento da árvore + atributos/ACL + barreira 051 + 6 mutantes.');
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
