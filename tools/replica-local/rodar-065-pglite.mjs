// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-065-pglite.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';
import { montarBase064, carregarArquivo } from './rodar-064-pglite.mjs';

const sql065 = 'database/065_rastreabilidade_ajustes.sql';
const test065 = 'tests/sql/test_065_rastreabilidade_ajustes.sql';
const test064 = 'tests/sql/test_064_rastreabilidade.sql';
const stub064 = 'tools/replica-local/sintetico/stub-064.sql';
const a1 = '00000000-0000-0000-0000-0000000000a1';
const b1 = '00000000-0000-0000-0000-0000000000b1';
const c1 = '00000000-0000-0000-0000-0000000000c1';

export function conferirRegrasCofre065(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 065 excede 90 KB (${bytes} bytes).`);
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
      throw new Error(`Cofre: termo proibido encontrado na 065: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 065.');
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
  if (!m) throw new Error(`Não foi possível extrair ${nome} da 065.`);
  return m[0];
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
    const x = projetos.find((p) => p.code === '51.X');
    const inat = projetos.find((p) => p.code === '63.INAT');
    for (const p of projetos) out['admin:' + p.code] = await arvoreComo(a1, p.id);
    out['professor:51.X'] = await arvoreComo(b1, x.id);
    out['agente:51.X'] = await arvoreComo(c1, x.id);
    out['professor:63.INAT'] = await arvoreComo(b1, inat.id);
    return out;
  }

  function compararArvores(antes, depois) {
    const chaves = Object.keys(antes);
    for (const k of chaves) {
      const a = JSON.stringify(antes[k]);
      const d = JSON.stringify(depois[k]);
      if (a !== d) {
        throw new Error(`Árvore de ${k} mudou depois da 065 (${Buffer.byteLength(a)} -> ${Buffer.byteLength(d)} bytes).`);
      }
    }
    if (JSON.stringify(Object.keys(antes)) !== JSON.stringify(Object.keys(depois))) {
      throw new Error('Conjunto de árvores capturadas mudou depois da 065.');
    }
    return chaves.length;
  }

  async function idsBase() {
    const x = (await q(`select id from public.projects where code = '51.X'`)).rows[0].id;
    const bal = (await q(`select id from public.balancetes where project_id = $1 order by data_referencia desc limit 1`, [x])).rows[0].id;
    const bl = (await q(`select id from public.balancete_lancamentos where balancete_id = $1 and conta_codigo = '7.1.3.05.01.00014'`, [bal])).rows[0].id;
    return { x, bal, bl };
  }

  // Centro sintético grande (320 rubricas, 960 lançamentos), criado e desfeito
  // dentro de uma transação; mede só a chamada de explicar_livre_v2.
  async function criarCentroGrande() {
    const id = (await q(`
      insert into public.projects (name, code, start_date, end_date)
      values ('Bench 065 (sintético)', '99.BENCH', '2025-01-01', '2030-12-31')
      returning id`)).rows[0].id;

    await sql(`
      insert into public.rubricas (code, parent_code, name, ordem)
      values ('bench.065', null, 'Bench 065', 900)
      on conflict (code) do nothing;
      insert into public.rubricas (code, parent_code, name, ordem)
        select 'bench.065.' || lpad(g::text, 3, '0'), 'bench.065',
               'Rubrica bench ' || g, 900 + g
          from generate_series(1, 320) g
        on conflict (code) do nothing;
    `);

    const planoId = (await q(`
      insert into public.planos_trabalho
        (project_id, versao, tipo, ativo, valor_total_plano, arquivo_storage_path, arquivo_nome)
      values ($1, 0, 'original', true, 320000, '99.BENCH/bench_plano.docx', 'bench_plano.docx')
      returning id`, [id])).rows[0].id;

    await sql(`
      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto)
        select '${planoId}'::uuid, 'bench.065.' || lpad(g::text, 3, '0'), 1000
          from generate_series(1, 320) g;
    `);

    const balId = (await q(`
      insert into public.balancetes
        (project_id, data_referencia, saldo_disponivel, rendimento_liquido,
         arquivo_storage_path, arquivo_nome)
      values ($1, date '2026-10-31', 500000, 0,
              '99.BENCH/bench_balancete.pdf', 'bench_balancete.pdf')
      returning id`, [id])).rows[0].id;

    await sql(`
      insert into public.balancete_lancamentos
        (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
        select '${balId}'::uuid,
               '9.9.9.' || lpad(g::text, 3, '0') || '.' || k::text,
               'Conta bench ' || g || '-' || k,
               case when k = 2 then 100 else 0 end,
               case when k = 3 then 100 else 0 end,
               100,
               'bench.065.' || lpad(g::text, 3, '0')
          from generate_series(1, 320) g
         cross join generate_series(1, 3) k;
    `);

    return id;
  }

  async function medirCentroGrande(rotulo) {
    await sql('begin;');
    try {
      const id = await criarCentroGrande();
      await sql(`select set_config('request.jwt.claim.sub', '${a1}', true); set local role authenticated;`);
      const t0 = performance.now();
      const ex = (await q('select public.explicar_livre_v2($1) as ex', [id])).rows[0].ex;
      const ms = performance.now() - t0;
      if (!ex || !Array.isArray(ex.partes) || ex.partes.length === 0) {
        throw new Error(`bench ${rotulo}: árvore vazia`);
      }
      return { ms, bytes: Buffer.byteLength(JSON.stringify(ex)) };
    } finally {
      try { await sql('rollback;'); } catch { /* a transação já pode ter sido desfeita */ }
    }
  }

  async function medirMediana(rotulo, repeticoes) {
    const medidas = [];
    for (let i = 0; i < repeticoes; i += 1) {
      medidas.push(await medirCentroGrande(rotulo));
    }
    medidas.sort((a, b) => a.ms - b.ms);
    const meio = Math.floor(medidas.length / 2);
    return { ...medidas[meio], todas: medidas.map((m) => Math.round(m.ms)) };
  }

  async function criarColisao() {
    await sql(`
      create or replace function pg_temp.colide065() returns trigger
      language plpgsql as $$
      begin
        if new.sha256 = repeat('7', 64) then
          insert into public.documento_versoes
            (documento_id, versao, sha256, bucket, caminho, formato, paginas, parser, parser_versao, origem)
          values
            (new.documento_id, new.versao, repeat('8', 64), new.bucket, new.caminho,
             new.formato, new.paginas, new.parser, new.parser_versao, new.origem);
        end if;
        return new;
      end $$;
      create trigger trg_colide065 before insert on public.documento_versoes
        for each row execute function pg_temp.colide065();
    `);
  }

  async function payloadVersao(x, bal, sha, sufixo) {
    const ref = (await q(`select data_referencia from public.balancetes where id = $1`, [bal])).rows[0].data_referencia;
    const data = ref instanceof Date ? ref.toISOString().slice(0, 10) : String(ref).slice(0, 10);
    return {
      project_id: x,
      tipo: 'balancete',
      chave: `balancete:${x}:${data}`,
      titulo: `Probe 065 ${sufixo}`,
      sha256: sha,
      bucket: 'balancete-pdfs',
      caminho: `${x}/probe_${sufixo}.pdf`,
      formato: 'pdf',
      paginas: 1,
      parser: 'p',
      parser_versao: '1',
      origem: 'site',
      fatos: [],
    };
  }

  async function probeItem1() {
    const v = (await q(`select public._tem_cpf('529,,,,,982,,,,,247,,,,,25') as v`)).rows[0].v;
    if (v !== false) throw new Error('item 1 já estava corrigido antes da 065 (esperado falso na 064).');
    return v;
  }

  async function probeItem2() {
    const v = (await q(`select public._mascarar_cpf('123.456.789-00') as v`)).rows[0].v;
    if (v !== '***.***.***-**') throw new Error(`item 2 já estava corrigido antes da 065 (veio "${v}").`);
    return v;
  }

  async function probeItem3() {
    const { x, bal, bl } = await idsBase();
    return emTransacao(async () => {
      await q(`update public.balancetes set arquivo_storage_path = $1, arquivo_nome = $2 where id = $3`,
        [`${x}/rel_52998224725.pdf`, 'bal_529/982/247/25.pdf', bal]);
      await sql(`select set_config('request.jwt.claim.sub', '${b1}', true); set local role authenticated;`);
      const o = (await q(`select public.get_origem_v2('balancete_lancamentos', $1, 'saldo_atual') as o`, [bl])).rows[0].o;
      if (o.documento.caminho === null) throw new Error('item 3 já estava corrigido antes da 065.');
      return o.documento.caminho;
    });
  }

  async function probeItem4() {
    const x = (await q(`select id from public.projects where code = '51.X'`)).rows[0].id;
    return emTransacao(async () => {
      await sql('alter table public.pendencias disable trigger trg_pendencias_sem_cpf;');
      const id = (await q(
        `insert into public.pendencias (chave, project_id, tipo, titulo, detalhe)
         values ('outro:65:probe', $1, 'outro', 'Probe com 529.982.247-25', '{"obs":"529.982.247-25"}'::jsonb)
         returning id`, [x])).rows[0].id;
      await sql('alter table public.pendencias enable trigger trg_pendencias_sem_cpf;');
      await sql(`select set_config('request.jwt.claim.sub', '${a1}', true); set local role authenticated;`);
      let code = null;
      try {
        await q(`select public.criar_pendencia_v2($1::jsonb)`, [JSON.stringify({
          chave: 'outro:65:probe', project_id: x, tipo: 'outro',
          titulo: 'Probe com 529.982.247-25', detalhe: {},
        })]);
      } catch (e) {
        code = e.code;
      }
      if (code !== '22023') throw new Error(`item 4 já estava corrigido antes da 065 (veio ${code}, id ${id}).`);
      return code;
    });
  }

  async function probeItem5() {
    const r = await q(`select to_regprocedure('public._resolver_origens_v2(jsonb, boolean)') as f`);
    if (r.rows[0].f !== null) throw new Error('item 5: _resolver_origens_v2 já existia antes da 065.');
    return r.rows[0].f;
  }

  async function probeItem6() {
    const { x, bal } = await idsBase();
    return emTransacao(async () => {
      await criarColisao();
      await sql(`select set_config('request.jwt.claim.sub', '${a1}', true); set local role authenticated;`);
      let code = null;
      try {
        const payload = await payloadVersao(x, bal, '7'.repeat(64), 'colisao');
        await q(`select public.registrar_documento_v2($1::jsonb)`, [JSON.stringify(payload)]);
      } catch (e) {
        code = e.code;
      }
      if (code !== '23505') throw new Error(`item 6 já estava corrigido antes da 065 (veio ${code}).`);
      return code;
    });
  }

  async function probeItem7() {
    return emTransacao(async () => {
      await sql(`select set_config('request.jwt.claim.sub', '${b1}', true); set local role authenticated;`);
      let code = null;
      let msg = '';
      try {
        await q(`select public.get_origem_v2(null, null::uuid, null)`);
      } catch (e) {
        code = e.code;
        msg = e.message;
      }
      if (code !== '22023' || !msg.includes('alvo_tabela, alvo_id e campo são obrigatórios.')) {
        throw new Error(`item 7 já estava corrigido antes da 065 (veio ${code}: ${msg}).`);
      }
      return `${code}: ${msg}`;
    });
  }

  async function probeItem8() {
    return emTransacao(async () => {
      await sql(`create policy probe_extra_065 on public.documentos for select to authenticated using (true);`);
      let msg = '';
      try {
        await carregarArquivo(db, 'database/064_rastreabilidade.sql', { quiet: true });
      } catch (e) {
        msg = e.message;
      }
      if (!msg.includes('064: documentos deve ter exatamente 1 policy')) {
        throw new Error(`item 8: a asserção da 064 não falhou como esperado (${msg || 'passou'}).`);
      }
      if (msg.includes('probe_extra_065')) {
        throw new Error('item 8 já estava corrigido antes da 065 (a mensagem da 064 lista a policy).');
      }
      return msg;
    });
  }

  async function esperarFalhaTest065(rotulo, aplicarMutante, trechoEsperado) {
    await aplicarMutante();
    let falhou = false;
    let msg = '';
    try {
      await rodarTeste(test065);
    } catch (e) {
      falhou = true;
      msg = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
      await arquivo(sql065);
    }
    if (!falhou) {
      throw new Error(`Mutante NÃO foi detectado por test_065: ${rotulo}`);
    }
    if (trechoEsperado && !msg.includes(trechoEsperado)) {
      throw new Error(`Mutante detectado pelo motivo errado (${rotulo}): ${msg}`);
    }
    console.log(`  [MUTANTE OK] ${rotulo} -> ${msg}`);
  }

  try {
    console.log('1. Montando base real (025 + 026 + 051/052/054/053/056/062 + 038/048 + 063)...');
    await montarBase064(db, { quiet: true });

    console.log('2. Aplicando a 064 (já em produção) e o stub-064...');
    await arquivo('database/064_rastreabilidade.sql');
    await arquivo(stub064);

    console.log('3. Capturando a árvore de cada centro sintético ANTES da 065...');
    const arvoresAntes = await capturarArvores();
    console.log(`Árvores capturadas: ${Object.keys(arvoresAntes).join(', ')}`);

    console.log('4. Conferindo o defeito de cada item antes da 065...');
    console.log(`  [ITEM 1] _tem_cpf('529,,,,,982,,,,,247,,,,,25') = ${await probeItem1()} (esperado falso na 064)`);
    console.log(`  [ITEM 2] _mascarar_cpf('123.456.789-00') = "${await probeItem2()}" (DV inválido mascarado na 064)`);
    console.log(`  [ITEM 3] caminho legado com CPF sai cru para b1: ${await probeItem3()}`);
    console.log(`  [ITEM 4] pendência existente com CPF repetido: ${await probeItem4()} (recusa da 064)`);
    console.log(`  [ITEM 5] _resolver_origens_v2 ausente: ${await probeItem5()}`);
    console.log(`  [ITEM 6] colisão de versão devolve: ${await probeItem6()} (unique_violation cru na 064)`);
    console.log(`  [ITEM 7] alvo nulo de b1 devolve: ${await probeItem7()}`);
    console.log(`  [ITEM 8] asserção da 064 sem nomes: ${await probeItem8()}`);

    console.log('4.1. Medindo explicar_livre_v2 na 064 num centro grande (320 rubricas, 960 lançamentos)...');
    const bench064 = await medirMediana('064', 3);
    console.log(`  [BENCH 064] ${bench064.ms.toFixed(1)} ms (3 medidas: ${bench064.todas.join(', ')} ms; árvore ${bench064.bytes} bytes)`);

    console.log('5. Conferindo que test_065 FALHA antes da 065, pelo motivo do item 1...');
    let falhouAntes = false;
    let msgAntes = '';
    try {
      await arquivo(test065);
    } catch (e) {
      falhouAntes = true;
      msgAntes = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
    }
    if (!falhouAntes) throw new Error('test_065 passou antes da migração 065!');
    if (!msgAntes.includes('065 FALHOU: item 1')) {
      throw new Error(`ANTES da 065 falhou pelo motivo errado: ${msgAntes}`);
    }
    console.log(`  [ANTES OK] ${msgAntes}`);

    const helpersAntes = (await q(helpersQuery)).rows;

    console.log('6. Conferindo o cofre e aplicando a 065 (1ª vez)...');
    const texto065 = await readFile(new URL('../../' + sql065, import.meta.url), 'utf8');
    const bytes = conferirRegrasCofre065(texto065);
    console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
    await arquivo(sql065);

    console.log('7. Comparando as árvores com as da 064 (têm de ser idênticas)...');
    const arvoresDepois = await capturarArvores();
    const qtdArvores = compararArvores(arvoresAntes, arvoresDepois);
    console.log(`  [ÁRVORE OK] ${qtdArvores} árvores idênticas (admin por centro, professor e agente em 51.X/63.INAT).`);

    console.log('7.1. Medindo explicar_livre_v2 na 065 no mesmo centro grande...');
    const bench065 = await medirMediana('065', 3);
    console.log(`  [BENCH 065] ${bench065.ms.toFixed(1)} ms (3 medidas: ${bench065.todas.join(', ')} ms; árvore ${bench065.bytes} bytes)`);
    if (bench065.ms > bench064.ms) {
      throw new Error(`065 ficou mais lenta que a 064 no centro grande (${bench064.ms.toFixed(1)} -> ${bench065.ms.toFixed(1)} ms).`);
    }

    console.log('8. Executando test_064 e test_065 depois da 065...');
    await rodarTeste(test064);
    await rodarTeste(test065);

    console.log('9. Testando idempotência (reaplicando 065 e os dois roteiros)...');
    await arquivo(sql065);
    await rodarTeste(test064);
    await rodarTeste(test065);

    console.log('10. Conferindo BLOCO 1 da 051 (trg_bloqueia_agente em todas as tabelas de public)...');
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
    if (semBarreira) throw new Error('Tabela sem trg_bloqueia_agente válido depois da 065: ' + semBarreira);

    console.log('11. Provando os mutantes (itens 1, 2, 3, 4, 5, 6, 7 e 2b), a asserção do item 8 e o search_path exato...');

    // Mutante 1: _tem_cpf sem o candidato (só contem_cpf)
    await esperarFalhaTest065(
      '1) _tem_cpf sem a regra de candidato',
      async () => {
        const fn = extrairFuncao(texto065, '_tem_cpf');
        const mut = fn.replace('v_fim := public._cpf_candidato(t, v_pos);', 'v_fim := null;');
        if (mut === fn) throw new Error('Falha ao montar mutante 1.');
        await sql(mut);
      },
      '065 FALHOU: item 1',
    );

    // Mutante 2: máscara sem conferir o DV
    await esperarFalhaTest065(
      '2) _mascarar_cpf sem o dígito verificador',
      async () => {
        const fn = extrairFuncao(texto065, '_mascarar_cpf');
        const mut = fn.replace('if public.contem_cpf(v_dig) then', 'if true then');
        if (mut === fn) throw new Error('Falha ao montar mutante 2.');
        await sql(mut);
      },
      '065 FALHOU: item 2',
    );

    // Mutante 3: caminho legado com CPF volta cru
    await esperarFalhaTest065(
      '3) caminho legado com CPF sem anulação',
      async () => {
        const fn = extrairFuncao(texto065, '_resolver_origens_v2');
        const alvo = `'caminho', case when p_mascarar and public._tem_cpf(a.storage_path) then null
                          else a.storage_path end,`;
        const mut = fn.replace(alvo, `'caminho', a.storage_path,`);
        if (mut === fn) throw new Error('Falha ao montar mutante 3.');
        await sql(mut);
      },
      '065 FALHOU: item 3',
    );

    // Mutante 2b (2ª rodada): caminho do ramo documento com CPF volta cru
    await esperarFalhaTest065(
      '2b) caminho do ramo documento com CPF sem anulação',
      async () => {
        const fn = extrairFuncao(texto065, '_resolver_origens_v2');
        const alvo = `'caminho', case when p_mascarar and public._tem_cpf(fa.doc_caminho) then null
                      else fa.doc_caminho end,`;
        const mut = fn.replace(alvo, `'caminho', fa.doc_caminho,`);
        if (mut === fn) throw new Error('Falha ao montar mutante 2b.');
        await sql(mut);
      },
      '065 FALHOU: item 2b',
    );

    // Mutante 4: criar_pendencia_v2 com a checagem prévia da 064
    await esperarFalhaTest065(
      '4) criar_pendencia_v2 com checagem prévia (não limpa CPF legado)',
      async () => {
        const fn = extrairFuncao(texto065, 'criar_pendencia_v2');
        const alvo = '  select pe.id, pe.chave, pe.situacao, pe.project_id, pe.tipo';
        const mut = fn.replace(
          alvo,
          `  if public._tem_cpf(public._texto_pendencia(v_chave, v_titulo, v_detalhe)) then
    raise exception 'Pendência contém sequência no formato de CPF e não pode ser gravada.'
      using errcode = '22023';
  end if;

  select pe.id, pe.chave, pe.situacao, pe.project_id, pe.tipo`,
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 4.');
        await sql(mut);
      },
      '065 FALHOU: item 4',
    );

    // Mutante 5: explicar_livre_v2 com a folha de previsto trocada para legado
    await esperarFalhaTest065(
      '5) explicar_livre_v2 com folha de previsto trocada de tipo',
      async () => {
        const fn = extrairFuncao(texto065, 'explicar_livre_v2');
        const alvo = `        'tipo', coalesce(v_origens_prev -> ('plano_rubricas|' || pr.id::text || '|valor_previsto') ->> 'tipo', 'legado'),`;
        const mut = fn.replace(alvo, `        'tipo', 'legado',`);
        if (mut === fn) throw new Error('Falha ao montar mutante 5.');
        await sql(mut);
      },
      '065 FALHOU: item 5',
    );

    // Mutante 6: registrar_documento_v2 sem o tratamento de unique_violation
    await esperarFalhaTest065(
      '6) registrar_documento_v2 sem mensagem de conflito',
      async () => {
        const fn = extrairFuncao(texto065, 'registrar_documento_v2');
        const alvo = `  begin
    insert into public.documento_versoes (
      documento_id, versao, sha256, bucket, caminho, arquivo_nome,
      formato, paginas, parser, parser_versao, origem, registrado_por
    ) values (
      v_doc_id, v_versao, v_sha256, v_bucket, v_caminho, v_arquivo_nome,
      v_formato, v_paginas, v_parser, v_parser_versao, v_origem, auth.uid()
    )
    returning id into v_versao_id;
  exception when unique_violation then
    raise exception 'Conflito ao gravar a versão % do documento; tente novamente.', v_versao
      using errcode = '40001';
  end;`;
        const novo = `  insert into public.documento_versoes (
    documento_id, versao, sha256, bucket, caminho, arquivo_nome,
    formato, paginas, parser, parser_versao, origem, registrado_por
  ) values (
    v_doc_id, v_versao, v_sha256, v_bucket, v_caminho, v_arquivo_nome,
    v_formato, v_paginas, v_parser, v_parser_versao, v_origem, auth.uid()
  )
  returning id into v_versao_id;`;
        const mut = fn.replace(alvo, novo);
        if (mut === fn) throw new Error('Falha ao montar mutante 6.');
        await sql(mut);
      },
      'veio 23505',
    );

    // Mutante 7: get_origem_v2 com a mensagem antiga de alvo nulo para não-admin
    await esperarFalhaTest065(
      '7) get_origem_v2 com 22023 para alvo nulo de não-admin',
      async () => {
        const fn = extrairFuncao(texto065, 'get_origem_v2');
        const alvo = `  if p_alvo_tabela is null or p_alvo_id is null or p_campo is null then
    if public.is_admin() then
      raise exception 'alvo_tabela, alvo_id e campo são obrigatórios.' using errcode = '22023';
    else
      raise exception 'Acesso negado ao alvo.' using errcode = '42501';
    end if;
  end if;`;
        const mut = fn.replace(
          alvo,
          `  if p_alvo_tabela is null or p_alvo_id is null or p_campo is null then
    raise exception 'alvo_tabela, alvo_id e campo são obrigatórios.' using errcode = '22023';
  end if;`,
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 7.');
        await sql(mut);
      },
      'veio 22023',
    );

    // Item 8: com uma policy extra, a asserção da 065 lista o nome que sobrou
    await emTransacao(async () => {
      await sql(`create policy policy_extra_065 on public.documentos for select to authenticated using (true);`);
      let msg = '';
      try {
        await carregarArquivo(db, sql065, { quiet: true });
      } catch (e) {
        msg = e.message;
      }
      if (!msg.includes('065: documentos deve ter exatamente 1 policy')) {
        throw new Error(`item 8: a asserção da 065 não falhou como esperado (${msg || 'passou'}).`);
      }
      if (!msg.includes('policy_extra_065')) {
        throw new Error(`item 8: a mensagem não lista a policy que sobrou (${msg}).`);
      }
      console.log(`  [ASSERÇÃO OK] item 8 -> ${msg}`);
    });

    // Item 3 da 2ª rodada: a asserção de search_path é exata; um search_path mais
    // frouxo numa função interna faz a própria 065 falhar.
    await emTransacao(async () => {
      const fn = extrairFuncao(texto065, '_resolver_origens_v2');
      const mutFn = fn.replace('set search_path = public, pg_temp', 'set search_path = public');
      if (mutFn === fn) throw new Error('Falha ao montar a sonda de search_path.');
      const mut = texto065.replace(fn, () => mutFn);
      let msg = '';
      try {
        await sql(mut);
      } catch (e) {
        msg = e.message;
      }
      if (!msg.includes('sem security definer ou search_path')) {
        throw new Error(`item 3 (2ª rodada): search_path frouxo não foi recusado (${msg || 'passou'}).`);
      }
      console.log(`  [SEARCH_PATH OK] ${msg}`);
    });

    console.log('12. Conferência final depois dos mutantes...');
    await arquivo(sql065);
    await rodarTeste(test064);
    await rodarTeste(test065);

    const helpersDepois = (await q(helpersQuery)).rows;
    if (JSON.stringify(helpersAntes) !== JSON.stringify(helpersDepois)) {
      throw new Error('065 alterou algum helper protegido!');
    }

    console.log('065 OK em PGlite: base real + 064 + stub + test_065 falhando antes + árvores idênticas + centro grande mais rápido que a 064 + test_064/test_065 + idempotência + barreira 051 + cofre + 8 mutantes + asserção do item 8 + search_path exato + helpers protegidos.');
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
