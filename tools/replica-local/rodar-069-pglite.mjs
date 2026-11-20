// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-069-pglite.mjs
import { readFile } from 'node:fs/promises';
import { deepStrictEqual } from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';
import { montarBase064, carregarArquivo } from './rodar-064-pglite.mjs';

const sql069 = 'database/069_motivos_e_ajustes.sql';
const test069 = 'tests/sql/test_069_motivos_e_ajustes.sql';
const test068 = 'tests/sql/test_068_pedido_bolsas.sql';

const ADMIN = '00000000-0000-0000-0000-0000000000a1';

export function conferirRegrasCofre069(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 069 excede 90 KB (${bytes} bytes).`);
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
      throw new Error(`Cofre: termo proibido encontrado na 069: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 069.');
  }

  // A 069 troca funções e não insere nem altera dados: os INSERTs que
  // aparecem no corpo das RPCs não contam.
  const semFuncoes = miolo.replace(/create or replace function[\s\S]*?\$\$;/gi, '');
  if (/\binsert\s+into\s+public\./i.test(semFuncoes)
      || /\bupdate\s+public\./i.test(semFuncoes)
      || /\bdelete\s+from\s+public\./i.test(semFuncoes)) {
    throw new Error('Cofre: a 069 não pode inserir, alterar nem apagar dados.');
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
  const m = new RegExp(
    'create or replace function public\\.' + nome + '\\b[\\s\\S]*?\\n\\$\\$;'
  ).exec(texto);
  if (!m) throw new Error(`Não foi possível extrair ${nome} da 069.`);
  return m[0];
}

async function main() {
  const db = new PGlite();
  const sql = (text) => db.exec(text, { onNotice: (n) => console.log('  [NOTICE]', n.message) });
  const arquivo = (path, opcoes = {}) => carregarArquivo(db, path, opcoes);
  const q = (text, params) => db.query(text, params);

  async function limparSessao() {
    try { await sql('rollback;'); } catch { /* a transação pode já ter sido desfeita */ }
    try {
      await sql(`
        reset role;
        select set_config('request.jwt.claim.sub', '', false);
      `);
    } catch { /* sessão limpa pela metade não impede o próximo passo */ }
  }

  async function rodarTeste(path) {
    try {
      await arquivo(path);
    } catch (e) {
      await limparSessao();
      throw e;
    }
  }

  async function esperarFalhaTest069(rotulo, aplicarMutante, trechoEsperado) {
    await aplicarMutante();
    let falhou = false;
    let msg = '';
    try {
      await rodarTeste(test069);
    } catch (e) {
      falhou = true;
      msg = e.message;
    } finally {
      await limparSessao();
      await arquivo(sql069, { quiet: true });
    }
    if (!falhou) {
      throw new Error(`Mutante NÃO foi detectado por test_069: ${rotulo}`);
    }
    if (trechoEsperado && !msg.includes(trechoEsperado)) {
      throw new Error(`Mutante detectado pelo motivo errado (${rotulo}): ${msg}`);
    }
    console.log(`  [MUTANTE OK] ${rotulo} -> ${msg}`);
  }

  async function conferirFallbackHelperQuebrado(resumoBase) {
    await sql(`
      create or replace function public._situacao_centro(
        p_project_id uuid, p_sl jsonb, p_pend_abertas integer
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = public, pg_temp
      as $$
      begin
        raise exception 'helper quebrado 069';
      end;
      $$;
    `);

    try {
      await sql(`select set_config('request.jwt.claim.sub', '${ADMIN}', false);`);
      const resumo = (await q('select public.resumo_projetos_v2() as r')).rows[0].r;
      const base = resumoBase.centros.find((centro) => centro.code === '51.X');
      const atual = resumo.centros.find((centro) => centro.code === '51.X');
      if (!base || !atual) throw new Error('51.X desapareceu do resumo com o helper quebrado.');

      deepStrictEqual(atual.livre, base.livre);
      deepStrictEqual(atual.data_referencia, base.data_referencia);
      if (atual.situacao !== base.situacao) {
        throw new Error(
          `Helper quebrado mudou a situação do 51.X: ${atual.situacao} (esperado ${base.situacao}).`
        );
      }
      if (!Array.isArray(atual.motivos) || atual.motivos.length !== 1) {
        throw new Error('Helper quebrado não devolveu um único motivo de falha.');
      }
      if (atual.motivos[0].codigo !== 'falha'
          || atual.motivos[0].nivel !== 'info'
          || atual.motivos[0].texto !== 'Não foi possível calcular o saldo deste centro.') {
        throw new Error(`Motivo de falha inesperado: ${JSON.stringify(atual.motivos[0])}`);
      }
      console.log(
        '  [MUTANTE OK] 10) helper quebrado -> resumo manteve livre, data e situação, com motivo falha'
      );
    } finally {
      await limparSessao();
      await arquivo(sql069, { quiet: true });
    }
  }

  try {
    console.log('1. Montando base real (025 + 026 + 051/052/054/053/056/062 + 038/048 + 063 + 064/stub-064 + 065..068)...');
    await montarBase064(db, { quiet: true });
    await arquivo('database/064_rastreabilidade.sql', { quiet: true });
    await arquivo('tools/replica-local/sintetico/stub-064.sql', { quiet: true });
    await arquivo('database/065_rastreabilidade_ajustes.sql', { quiet: true });
    await arquivo('database/066_taxas_comprometidas.sql', { quiet: true });
    await arquivo('database/067_termos_contrato.sql', { quiet: true });
    await arquivo('database/068_pedido_bolsas.sql', { quiet: true });
    await limparSessao();
    console.log('  [BASE] 063..068 aplicadas.');

    const helpersAntes = (await q(helpersQuery)).rows;

    console.log('2. Provando o defeito antes da 069 (centro só com tarifa sai problema)...');
    await sql(`
      insert into public.projects (id, name, code, start_date, end_date, active)
      values ('00000000-0000-4000-8000-000000069e01', 'Teste 069 Antes',
              '69.ANTES', current_date - 30, current_date + 365, true);

      insert into public.planos_trabalho (id, project_id, versao, tipo, ativo, valor_total_plano)
      values ('00000000-0000-4000-8000-000000069e02',
              '00000000-0000-4000-8000-000000069e01', 0, 'original', true, 0);

      insert into public.balancetes (id, project_id, data_referencia)
      values ('00000000-0000-4000-8000-000000069e03',
              '00000000-0000-4000-8000-000000069e01', current_date);

      insert into public.balancete_lancamentos
        (id, balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code)
      values ('00000000-0000-4000-8000-000000069e04',
              '00000000-0000-4000-8000-000000069e03',
              '7.1.3.05.01.00054', 'DESPESA SERVIÇOS BANCÁRIOS', 14.34, 'b');

      select set_config('request.jwt.claim.sub', '${ADMIN}', false);
    `);

    const resumoAntesDoDefeito = (await q('select public.resumo_projetos_v2() as r')).rows[0].r;
    const centroAntes = resumoAntesDoDefeito.centros.find((c) => c.code === '69.ANTES');
    if (!centroAntes) throw new Error('Fixture 69.ANTES não apareceu no resumo antes da 069.');
    if (centroAntes.situacao !== 'problema') {
      throw new Error(`Antes da 069 o centro só com tarifa deveria sair "problema"; veio "${centroAntes.situacao}".`);
    }
    if ('motivos' in centroAntes) {
      throw new Error('Antes da 069 o resumo não deveria ter a chave motivos.');
    }
    let semRpc = false;
    try {
      await q(`select public.situacao_centro_v2('00000000-0000-4000-8000-000000069e01'::uuid)`);
    } catch (e) {
      if (e.code !== '42883') {
        throw new Error(`Antes da 069, situacao_centro_v2 falhou com código inesperado (${e.code}): ${e.message}`);
      }
      semRpc = true;
    }
    if (!semRpc) throw new Error('situacao_centro_v2 existia antes da 069!');
    console.log(`  [ANTES OK] 69.ANTES saiu "${centroAntes.situacao}" e situacao_centro_v2 deu 42883.`);

    await sql(`
      delete from public.balancetes where project_id = '00000000-0000-4000-8000-000000069e01';
      delete from public.planos_trabalho where project_id = '00000000-0000-4000-8000-000000069e01';
      delete from public.projects where id = '00000000-0000-4000-8000-000000069e01';
    `);

    console.log('2b. Guardando o resumo de hoje para comparar depois...');
    const resumoAntes = (await q('select public.resumo_projetos_v2() as r')).rows[0].r;
    await limparSessao();

    console.log('3. Conferindo que test_069 FALHA antes da 069...');
    let falhouAntes = false;
    let msgAntes = '';
    try {
      await rodarTeste(test069);
    } catch (e) {
      if (e.code !== '42883') {
        throw new Error(`ANTES da 069 falhou com código inesperado (${e.code}): ${e.message}`);
      }
      falhouAntes = true;
      msgAntes = e.message;
    } finally {
      await limparSessao();
    }
    if (!falhouAntes) throw new Error('test_069 passou antes da migração 069!');
    console.log(`  [ANTES OK] ${msgAntes}`);

    console.log('4. Conferindo o cofre e aplicando a 069 (1ª vez)...');
    const texto069 = await readFile(new URL('../../' + sql069, import.meta.url), 'utf8');
    const bytes = conferirRegrasCofre069(texto069);
    console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
    await arquivo(sql069, { quiet: true });
    await limparSessao();

    console.log('5. Executando test_069...');
    await rodarTeste(test069);

    console.log('6. Testando idempotência (reaplicando 069 e o roteiro)...');
    await arquivo(sql069, { quiet: true });
    await rodarTeste(test069);

    console.log('7. Conferindo que o roteiro da 068 continua passando depois da 069...');
    await rodarTeste(test068);

    console.log('8. Conferindo BLOCO 1 da 051 (trg_bloqueia_agente em todas as tabelas de public)...');
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
    if (semBarreira) throw new Error('Tabela sem trg_bloqueia_agente válido depois da 069: ' + semBarreira);
    console.log('  [BARREIRA OK]');

    const helpersDepois = (await q(helpersQuery)).rows;
    if (JSON.stringify(helpersAntes) !== JSON.stringify(helpersDepois)) {
      throw new Error('069 alterou algum helper protegido!');
    }
    console.log('  [HELPERS OK] os 6 helpers protegidos não mudaram.');

    console.log('9. Comparando o resumo antes/depois (tudo igual, mais motivos)...');
    await sql(`select set_config('request.jwt.claim.sub', '${ADMIN}', false);`);
    const resumoDepois = (await q('select public.resumo_projetos_v2() as r')).rows[0].r;
    await limparSessao();

    const semMotivos = JSON.parse(JSON.stringify(resumoDepois));
    for (const centro of semMotivos.centros) {
      if (!Array.isArray(centro.motivos)) {
        throw new Error(`Centro ${centro.code} veio sem array de motivos depois da 069.`);
      }
      delete centro.motivos;
    }
    deepStrictEqual(semMotivos, resumoAntes);
    console.log(`  [RESUMO OK] ${semMotivos.centros.length} centros iguais ao antes, só com motivos a mais.`);

    console.log('10. Provando mutantes da 069...');

    await esperarFalhaTest069(
      '1) helper sem a exceção da tarifa',
      async () => {
        const fn = extrairFuncao(texto069, '_situacao_centro');
        const mut = fn.replace('    if v_abs <= v_tarifa then', '    if false then');
        if (mut === fn) throw new Error('Falha ao montar mutante 1.');
        await sql(mut);
      },
      '69.TARIFA deveria ficar em atenção pela tarifa',
    );

    await esperarFalhaTest069(
      '2) tarifa explicando mais do que o valor (>= trocado)',
      async () => {
        const fn = extrairFuncao(texto069, '_situacao_centro');
        const mut = fn.replace('    if v_abs <= v_tarifa then', '    if v_abs >= v_tarifa then');
        if (mut === fn) throw new Error('Falha ao montar mutante 2.');
        await sql(mut);
      },
      '69.MISTO deveria ser problema',
    );

    await esperarFalhaTest069(
      '3) colocar só com _bolsista_visivel, sem a lista do pedido',
      async () => {
        const fn = extrairFuncao(texto069, 'colocar_na_caixa_v2');
        const alvo = `  if not public._bolsista_no_pedido(p_holder_id) then
    raise exception 'Essa pessoa não está na lista do pedido.' using errcode = '22023';
  end if;

`;
        const mut = fn.replace(alvo, '');
        if (mut === fn) throw new Error('Falha ao montar mutante 3.');
        await sql(mut);
      },
      'operação deveria falhar mas passou',
    );

    await esperarFalhaTest069(
      '4) salvar_caixa_pedido_v2 sem dono = auth.uid() no for update',
      async () => {
        const fn = extrairFuncao(texto069, 'salvar_caixa_pedido_v2');
        const alvo = `   where c.id = v_id
     and c.dono = auth.uid()
     for update;`;
        const mut = fn.replace(alvo, `   where c.id = v_id
     for update;`);
        if (mut === fn) throw new Error('Falha ao montar mutante 4.');
        await sql(mut);
      },
      'deveria filtrar dono = auth.uid() no select',
    );

    await esperarFalhaTest069(
      '5) colocar_na_caixa_v2 sem dono = auth.uid() no for update',
      async () => {
        const fn = extrairFuncao(texto069, 'colocar_na_caixa_v2');
        const alvo = `   where c.id = p_caixa_id
     and c.dono = auth.uid()
     for update;`;
        const mut = fn.replace(alvo, `   where c.id = p_caixa_id
     for update;`);
        if (mut === fn) throw new Error('Falha ao montar mutante 5.');
        await sql(mut);
      },
      'colocar_na_caixa_v2(uuid, uuid) deveria filtrar dono = auth.uid() no select',
    );

    await esperarFalhaTest069(
      '6) saiu_de de volta para c.nome, c.id',
      async () => {
        const fn = extrairFuncao(texto069, 'colocar_na_caixa_v2');
        const alvo = `               jsonb_build_object('caixa_id', c.id, 'nome', c.nome)
               order by c.criado_em, c.id`;
        const mut = fn.replace(
          alvo,
          `               jsonb_build_object('caixa_id', c.id, 'nome', c.nome)
               order by c.nome, c.id`,
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 6.');
        await sql(mut);
      },
      'saiu_de deveria começar pela caixa antiga',
    );

    await esperarFalhaTest069(
      '7) helper tratando grupos não-array como lista vazia',
      async () => {
        const fn = extrairFuncao(texto069, '_situacao_centro');
        const alvo = "  if jsonb_typeof(p_sl -> 'grupos') is distinct from 'array' then";
        const mut = fn.replace(alvo, '  if false then');
        if (mut === fn) throw new Error('Falha ao montar mutante 7.');
        await sql(mut);
      },
      'grupos malformado deveria dar sem dado',
    );

    await esperarFalhaTest069(
      '8) apagar_caixa_pedido_v2 sem o lock por dono',
      async () => {
        const fn = extrairFuncao(texto069, 'apagar_caixa_pedido_v2');
        const mut = fn.replace(
          /  perform pg_advisory_xact_lock\(hashtextextended\('caixas_pedido:' \|\| v_caixa\.dono::text, 0\)\);\r?\n/,
          '',
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 8.');
        await sql(mut);
      },
      'apagar_caixa_pedido_v2 deveria tomar o lock por dono antes do delete',
    );

    await esperarFalhaTest069(
      '9) helper com EXECUTE para authenticated',
      async () => {
        await sql('grant execute on function public._situacao_centro(uuid, jsonb, integer) to authenticated;');
      },
      'o helper _situacao_centro não pode ter EXECUTE para anon/authenticated',
    );

    await conferirFallbackHelperQuebrado(resumoAntes);

    console.log('11. Conferência final depois dos mutantes...');
    await arquivo(sql069, { quiet: true });
    await rodarTeste(test069);
    await rodarTeste(test068);

    const helpersFinal = (await q(helpersQuery)).rows;
    if (JSON.stringify(helpersAntes) !== JSON.stringify(helpersFinal)) {
      throw new Error('Mutantes deixaram helper protegido alterado!');
    }

    console.log(
      '069 OK em PGlite: base 063..068 + defeito antes (problema/42883) + cofre + test_069 + idempotência + test_068 + barreira 051 + helpers intactos + resumo antes/depois + 10 mutantes (9 pelo roteiro + helper quebrado) + roteiro final.'
    );
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
