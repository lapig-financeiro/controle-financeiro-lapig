// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-066-pglite.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';
import { montarBase064, carregarArquivo } from './rodar-064-pglite.mjs';

const sql066 = 'database/066_taxas_comprometidas.sql';
const test066 = 'tests/sql/test_066_taxas_comprometidas.sql';
const test065 = 'tests/sql/test_065_rastreabilidade_ajustes.sql';
const test064 = 'tests/sql/test_064_rastreabilidade.sql';
const stub066 = 'tools/replica-local/sintetico/stub-066.sql';
const a1 = '00000000-0000-0000-0000-0000000000a1';
const b1 = '00000000-0000-0000-0000-0000000000b1';
const ignorarNaComparacao = new Set(['66.TAXA', '66.MISTO']);

export function conferirRegrasCofre066(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 066 excede 90 KB (${bytes} bytes).`);
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
      throw new Error(`Cofre: termo proibido encontrado na 066: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 066.');
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
  if (!m) throw new Error(`Não foi possível extrair ${nome} da 066.`);
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

  async function arvoreComo(usuario, projectId) {
    return emTransacao(async () => {
      await sql(`select set_config('request.jwt.claim.sub', '${usuario}', true); set local role authenticated;`);
      const r = await q('select public.explicar_livre_v2($1) as ex', [projectId]);
      return r.rows[0].ex;
    });
  }

  async function capturarArvores() {
    const projetos = (await q('select id, code from public.projects order by code')).rows;
    const out = {};
    for (const p of projetos) out['admin:' + p.code] = await arvoreComo(a1, p.id);
    return out;
  }

  function compararArvoresSemTaxa(antes, depois) {
    let comparadas = 0;
    const ignoradas = [];
    for (const k of Object.keys(antes)) {
      const code = k.slice('admin:'.length);
      if (ignorarNaComparacao.has(code)) {
        ignoradas.push(code);
        continue;
      }
      const a = JSON.stringify(antes[k]);
      const d = JSON.stringify(depois[k]);
      if (a !== d) {
        throw new Error(`Árvore de ${k} mudou com a 066 (${Buffer.byteLength(a)} -> ${Buffer.byteLength(d)} bytes).`);
      }
      comparadas += 1;
    }
    if (JSON.stringify(Object.keys(antes)) !== JSON.stringify(Object.keys(depois))) {
      throw new Error('Conjunto de árvores capturadas mudou com a 066.');
    }
    return { comparadas, ignoradas };
  }

  async function saldoLivre(projectId) {
    return comoAdmin(async () => {
      const r = await q('select public.get_saldo_livre($1) as sl', [projectId]);
      return r.rows[0].sl;
    });
  }

  async function resumo() {
    return comoAdmin(async () => {
      const r = await q('select public.resumo_projetos_v2() as r');
      return r.rows[0].r;
    });
  }

  async function conferirGruposERubricas(projectId, code) {
    const sl = await saldoLivre(projectId);
    if (!sl || sl.has_plano !== true) return sl;

    const grupos = Array.isArray(sl.grupos) ? sl.grupos : [];
    const rubricas = Array.isArray(sl.rubricas) ? sl.rubricas : [];

    for (const rub of rubricas) {
      const prev = Number(rub.previsto || 0);
      const real = Number(rub.realizado || 0);
      const comp = Number(rub.compromissos || 0);
      const livre = Number(rub.saldo_livre || 0);

      exigir(centavos(prev - real) === centavos(rub.saldo),
        `${code}: saldo da rubrica ${rub.rubrica_code} não é previsto − realizado`);
      exigir(centavos(prev - real - comp) === centavos(livre),
        `${code}: saldo_livre da rubrica ${rub.rubrica_code} não fecha`);

      if (rub.compromisso_tipo === 'taxa') {
        exigir(centavos(comp) === centavos(Math.max(prev - real, 0)),
          `${code}: compromisso da taxa ${rub.rubrica_code} deveria ser greatest(previsto − realizado, 0)`);
        exigir(centavos(livre) === centavos(Math.min(prev - real, 0)),
          `${code}: livre da taxa ${rub.rubrica_code} deveria ser least(previsto − realizado, 0)`);
      } else if (rub.compromisso_tipo === 'bolsas') {
        exigir(centavos(comp) === centavos(sl.compromissos_bolsas),
          `${code}: compromisso de bolsas da rubrica ${rub.rubrica_code} deveria ser o total da janela`);
      } else {
        exigir(centavos(comp) === 0,
          `${code}: rubrica ${rub.rubrica_code} sem tipo não deveria ter compromisso`);
        exigir(rub.compromisso_tipo === null,
          `${code}: rubrica ${rub.rubrica_code} deveria ter compromisso_tipo null`);
      }
    }

    for (const grupo of grupos) {
      const doGrupo = rubricas.filter((r) => r.grupo_code === grupo.grupo_code);
      const prev = doGrupo.reduce((s, r) => s + Number(r.previsto || 0), 0);
      const real = doGrupo.reduce((s, r) => s + Number(r.realizado || 0), 0);
      const comp = doGrupo.reduce((s, r) => s + Number(r.compromissos || 0), 0);
      const livre = doGrupo.reduce((s, r) => s + Number(r.saldo_livre || 0), 0);

      exigir(centavos(prev) === centavos(grupo.previsto), `${code}: previsto do grupo ${grupo.grupo_code} diverge das rubricas`);
      exigir(centavos(real) === centavos(grupo.realizado), `${code}: realizado do grupo ${grupo.grupo_code} diverge das rubricas`);
      exigir(centavos(comp) === centavos(grupo.compromissos), `${code}: compromissos do grupo ${grupo.grupo_code} diverge das rubricas`);
      exigir(centavos(livre) === centavos(grupo.saldo_livre), `${code}: saldo_livre do grupo ${grupo.grupo_code} diverge das rubricas`);
      exigir(centavos(Number(grupo.previsto) - Number(grupo.realizado)) === centavos(grupo.saldo),
        `${code}: saldo do grupo ${grupo.grupo_code} não é previsto − realizado`);
      exigir(centavos(Number(grupo.saldo) - Number(grupo.compromissos)) === centavos(grupo.saldo_livre),
        `${code}: saldo_livre do grupo ${grupo.grupo_code} não é saldo − compromissos`);

      const temBolsas = doGrupo.some((r) => r.compromisso_tipo === 'bolsas');
      const temTaxas = doGrupo.some((r) => r.compromisso_tipo === 'taxa');
      const cobertura = temBolsas && temTaxas ? 'bolsas e taxas'
        : temBolsas ? 'bolsas'
        : temTaxas ? 'taxas'
        : 'nenhuma';
      exigir(grupo.compromissos_cobertura === cobertura,
        `${code}: cobertura do grupo ${grupo.grupo_code} deveria ser ${cobertura}, veio ${grupo.compromissos_cobertura}`);

      for (const rub of doGrupo) {
        exigir(rub.grupo_code === grupo.grupo_code, `${code}: rubrica ${rub.rubrica_code} em grupo inesperado`);
      }
    }

    return sl;
  }

  async function conferirArvoreEResumo() {
    const res = await resumo();
    const centros = Array.isArray(res.centros) ? res.centros : [];
    const arvores = await capturarArvores();
    let conferidos = 0;

    for (const centro of centros) {
      const arvore = arvores['admin:' + centro.code];
      exigir(arvore, `sem árvore para o centro ${centro.code}`);

      const sl = await conferirGruposERubricas(centro.id, centro.code);
      const grupos = Array.isArray(sl?.grupos) ? sl.grupos : [];

      if (centro.livre === null || centro.livre === undefined) {
        exigir(arvore.valor === null || typeof arvore.valor !== 'number',
          `${centro.code}: resumo sem livre, mas a árvore tem valor ${arvore.valor}`);
      } else {
        const soma = grupos.reduce((s, g) => s + Number(g.saldo_livre || 0), 0);
        exigir(centavos(soma) === centavos(centro.livre),
          `${centro.code}: soma dos grupos ${soma} != resumo ${centro.livre}`);
        exigir(typeof arvore.valor === 'number' && centavos(arvore.valor) === centavos(centro.livre),
          `${centro.code}: raiz da árvore ${arvore.valor} != resumo ${centro.livre}`);

        for (const grupo of grupos) {
          const noGrupo = buscarNo(arvore, 'grupo:' + grupo.grupo_code);
          exigir(noGrupo, `${centro.code}: árvore sem grupo:${grupo.grupo_code}`);
          exigir(centavos(noGrupo.valor) === centavos(grupo.saldo_livre),
            `${centro.code}: grupo ${grupo.grupo_code} da árvore != get_saldo_livre`);
        }
      }

      verificarArvore(arvore, centro.code);
      conferidos += 1;
    }
    return conferidos;
  }

  function conferirNoTaxa(arvoreTaxa) {
    const grupoCip = buscarNo(arvoreTaxa, 'grupo:cip_ufg');
    exigir(grupoCip, '66.TAXA: árvore sem grupo:cip_ufg');
    exigir(grupoCip.nota === 'taxa a reter pela fundação/universidade: não é livre',
      `66.TAXA: nota do grupo cip_ufg inesperada (${grupoCip.nota})`);
    const comp = buscarNo(grupoCip, 'rubrica:cip_ufg:comprometido');
    exigir(comp, '66.TAXA: árvore sem comprometido de cip_ufg');
    exigir(centavos(comp.valor) === 1500000 && comp.sinal === -1,
      '66.TAXA: comprometido de cip_ufg deveria ser 15000 e sinal -1');
    exigir(comp.conta === 'taxa a reter (previsto − realizado)',
      '66.TAXA: conta do comprometido de cip_ufg inesperada');
    exigir((comp.partes || []).length === 2,
      '66.TAXA: comprometido de cip_ufg deveria reusar previsto e realizado');

    const grupoDao = buscarNo(arvoreTaxa, 'grupo:dao');
    const compDao = buscarNo(grupoDao, 'rubrica:dao:comprometido');
    exigir(compDao, '66.TAXA: árvore sem comprometido de dao');
    exigir(centavos(compDao.valor) === 2000000, '66.TAXA: comprometido de dao deveria ser 20000');
    exigir((compDao.partes || []).length === 1,
      '66.TAXA: sem realizado, o comprometido de dao deveria ter só o previsto');

    const grupoUa = buscarNo(arvoreTaxa, 'grupo:cip_ua');
    exigir(!buscarNo(grupoUa, 'rubrica:cip_ua:comprometido'),
      '66.TAXA: taxa estourada não deveria ter comprometido');
  }

  async function conferirMisto() {
    await emTransacao(async () => {
      await sql(`update public.rubricas set parent_code = 'a' where code = 'dao';`);
      await sql(`select set_config('request.jwt.claim.sub', '${a1}', true); set local role authenticated;`);
      const id = (await q(`select id from public.projects where code = '66.MISTO'`)).rows[0].id;
      const sl = (await q('select public.get_saldo_livre($1) as sl', [id])).rows[0].sl;
      const grupo = (sl.grupos || []).find((g) => g.grupo_code === 'a');
      exigir(grupo, '66.MISTO: grupo a ausente');
      exigir(grupo.compromissos_cobertura === 'bolsas e taxas',
        `66.MISTO: cobertura do grupo a deveria ser bolsas e taxas, veio ${grupo.compromissos_cobertura}`);

      const ex = (await q('select public.explicar_livre_v2($1) as ex', [id])).rows[0].ex;
      verificarArvore(ex, '66.MISTO');
      const noGrupo = buscarNo(ex, 'grupo:a');
      exigir(noGrupo?.nota === 'taxa a reter pela fundação/universidade: não é livre; bolsas contratadas também entram',
        `66.MISTO: nota do grupo a inesperada (${noGrupo?.nota})`);
      exigir(buscarNo(noGrupo, 'rubrica:a.bolsas:comprometido'), '66.MISTO: falta o comprometido das bolsas');
      exigir(buscarNo(noGrupo, 'rubrica:dao:comprometido'), '66.MISTO: falta o comprometido da taxa');
      exigir(centavos(ex.valor) === 2500000, `66.MISTO: raiz deveria ser 25000, veio ${ex.valor}`);
    });
  }

  async function esperarFalhaTest066(rotulo, aplicarMutante, trechoEsperado) {
    await aplicarMutante();
    let falhou = false;
    let msg = '';
    try {
      await rodarTeste(test066);
    } catch (e) {
      falhou = true;
      msg = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
      await arquivo(sql066);
    }
    if (!falhou) {
      throw new Error(`Mutante NÃO foi detectado por test_066: ${rotulo}`);
    }
    if (trechoEsperado && !msg.includes(trechoEsperado)) {
      throw new Error(`Mutante detectado pelo motivo errado (${rotulo}): ${msg}`);
    }
    console.log(`  [MUTANTE OK] ${rotulo} -> ${msg}`);
  }

  try {
    console.log('1. Montando base real (025 + 026 + 051/052/054/053/056/062 + 038/048 + 063)...');
    await montarBase064(db, { quiet: true });

    console.log('2. Aplicando 064, stub-064 e 065 (já em produção) e o stub-066...');
    await arquivo('database/064_rastreabilidade.sql');
    await arquivo('tools/replica-local/sintetico/stub-064.sql');
    await arquivo('database/065_rastreabilidade_ajustes.sql');
    await arquivo(stub066);

    console.log('3. Capturando as árvores ANTES da 066...');
    const arvoresAntes = await capturarArvores();
    console.log(`Árvores capturadas: ${Object.keys(arvoresAntes).length} centros (${Object.keys(arvoresAntes).join(', ')})`);

    console.log('4. Conferindo que test_066 FALHA antes da 066, pelo motivo da taxa positiva...');
    let falhouAntes = false;
    let msgAntes = '';
    try {
      await rodarTeste(test066);
    } catch (e) {
      falhouAntes = true;
      msgAntes = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
    }
    if (!falhouAntes) throw new Error('test_066 passou antes da migração 066!');
    if (!msgAntes.includes('066 FALHOU: taxa com saldo positivo')) {
      throw new Error(`ANTES da 066 falhou pelo motivo errado: ${msgAntes}`);
    }
    console.log(`  [ANTES OK] ${msgAntes}`);

    const helpersAntes = (await q(helpersQuery)).rows;

    console.log('5. Conferindo o cofre e aplicando a 066 (1ª vez)...');
    const texto066 = await readFile(new URL('../../' + sql066, import.meta.url), 'utf8');
    const bytes = conferirRegrasCofre066(texto066);
    console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
    await arquivo(sql066);

    console.log('6. Comparando as árvores sem taxa com as da 065 (têm de ser idênticas)...');
    const arvoresDepois = await capturarArvores();
    const { comparadas, ignoradas } = compararArvoresSemTaxa(arvoresAntes, arvoresDepois);
    console.log(`  [ÁRVORE OK] ${comparadas} árvores idênticas; ignoradas de propósito: ${ignoradas.join(', ')}.`);

    console.log('7. Executando test_064, test_065 e test_066 depois da 066...');
    await rodarTeste(test064);
    await rodarTeste(test065);
    await rodarTeste(test066);

    console.log('8. Testando idempotência (reaplicando 066 e os três roteiros)...');
    await arquivo(sql066);
    await rodarTeste(test064);
    await rodarTeste(test065);
    await rodarTeste(test066);

    console.log('9. Conferindo árvore = get_saldo_livre = resumo_projetos_v2 em todos os centros sintéticos...');
    const qtdCentros = await conferirArvoreEResumo();
    console.log(`  [FECHAMENTO OK] ${qtdCentros} centros do resumo com raiz = soma dos grupos, grupos = rubricas e nós fechando.`);

    console.log('10. Conferindo o comprometido das taxas na árvore do 66.TAXA...');
    conferirNoTaxa(arvoresDepois['admin:66.TAXA']);
    console.log('  [TAXA OK] cip_ufg com 2 partes (previsto e realizado), dao com só o previsto, cip_ua estourada sem comprometido.');

    console.log('11. Conferindo o grupo misto (bolsas + taxa) em transação própria...');
    await conferirMisto();
    console.log('  [MISTO OK] cobertura = bolsas e taxas, árvore fecha e os dois comprometidos aparecem.');

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
    if (semBarreira) throw new Error('Tabela sem trg_bloqueia_agente válido depois da 066: ' + semBarreira);
    console.log('  [BARREIRA OK]');

    console.log('13. Provando dois mutantes da 066...');
    await esperarFalhaTest066(
      '1) constante das taxas sem cip_ufg',
      async () => {
        const fn = extrairFuncao(texto066, 'get_saldo_livre');
        const mut = fn.replace(
          "c_rubricas_taxa constant text[] := array['cip_ufg', 'cip_ua', 'dao'];",
          "c_rubricas_taxa constant text[] := array['cip_ua', 'dao'];",
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 1.');
        await sql(mut);
      },
      '066 FALHOU: taxa com saldo positivo',
    );

    await esperarFalhaTest066(
      '2) taxa positiva sem greatest(previsto − realizado, 0)',
      async () => {
        const fn = extrairFuncao(texto066, 'get_saldo_livre');
        const alvo = `when r.code = any(c_rubricas_taxa)
               then greatest(coalesce(p.v, 0) - coalesce(rr.v, 0), 0)`;
        const mut = fn.replace(alvo, `when r.code = any(c_rubricas_taxa)
               then 0::numeric`);
        if (mut === fn) throw new Error('Falha ao montar mutante 2.');
        await sql(mut);
      },
      '066 FALHOU: taxa com saldo positivo',
    );

    console.log('14. Conferência final depois dos mutantes...');
    await arquivo(sql066);
    await rodarTeste(test064);
    await rodarTeste(test065);
    await rodarTeste(test066);

    const helpersDepois = (await q(helpersQuery)).rows;
    if (JSON.stringify(helpersAntes) !== JSON.stringify(helpersDepois)) {
      throw new Error('066 alterou algum helper protegido!');
    }

    console.log('066 OK em PGlite: base real + 064/065 + stub-066 + test_066 falhando antes + árvores sem taxa idênticas + test_064/test_065/test_066 + idempotência + fechamento contra resumo_projetos_v2 + comprometido de taxa + grupo misto + barreira 051 + 2 mutantes + helpers protegidos.');
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
