// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-068-pglite.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';
import { montarBase064, carregarArquivo } from './rodar-064-pglite.mjs';

const sql068 = 'database/068_pedido_bolsas.sql';
const test068 = 'tests/sql/test_068_pedido_bolsas.sql';

export function conferirRegrasCofre068(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 068 excede 90 KB (${bytes} bytes).`);
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
      throw new Error(`Cofre: termo proibido encontrado na 068: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 068.');
  }
  // A migração não insere linha; os INSERTs dentro das funções são
  // corpo de RPC, não dado da migração.
  const semFuncoes = miolo.replace(/create or replace function[\s\S]*?\$\$;/gi, '');
  if (/\binsert\s+into\s+public\.(bolsista_equipes|caixas_pedido|caixa_pedido_itens)\b/i.test(semFuncoes)) {
    throw new Error('Cofre: a 068 não pode inserir linha nas tabelas do pedido.');
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
  if (!m) throw new Error(`Não foi possível extrair ${nome} da 068.`);
  return m[0];
}

async function main() {
  const db = new PGlite();
  const sql = (text) => db.exec(text, { onNotice: (n) => console.log('  [NOTICE]', n.message) });
  const arquivo = (path, opcoes = {}) => carregarArquivo(db, path, opcoes);
  const q = (text, params) => db.query(text, params);

  async function rodarTeste(path) {
    try {
      await arquivo(path);
    } catch (e) {
      try { await sql('rollback;'); } catch { /* a transação pode já ter sido desfeita */ }
      throw e;
    }
  }

  async function esperarFalhaTest068(rotulo, aplicarMutante, trechoEsperado) {
    await aplicarMutante();
    let falhou = false;
    let msg = '';
    try {
      await rodarTeste(test068);
    } catch (e) {
      falhou = true;
      msg = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
      await arquivo(sql068, { quiet: true });
    }
    if (!falhou) {
      throw new Error(`Mutante NÃO foi detectado por test_068: ${rotulo}`);
    }
    if (trechoEsperado && !msg.includes(trechoEsperado)) {
      throw new Error(`Mutante detectado pelo motivo errado (${rotulo}): ${msg}`);
    }
    console.log(`  [MUTANTE OK] ${rotulo} -> ${msg}`);
  }

  try {
    console.log('1. Montando base real (025 + 026 + 051/052/054/053/056/062 + 038/048 + 063 + 064/stub-064)...');
    await montarBase064(db, { quiet: true });
    await arquivo('database/064_rastreabilidade.sql', { quiet: true });
    await arquivo('tools/replica-local/sintetico/stub-064.sql', { quiet: true });
    console.log('  [BASE] 064 + stub-064 aplicados.');

    const helpersAntes = (await q(helpersQuery)).rows;

    console.log('2. Conferindo que test_068 FALHA antes da 068...');
    let falhouAntes = false;
    let msgAntes = '';
    try {
      await rodarTeste(test068);
    } catch (e) {
      if (e.code !== '42P01') {
        throw new Error(`ANTES da 068 falhou com código inesperado (${e.code}): ${e.message}`);
      }
      falhouAntes = true;
      msgAntes = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
    }
    if (!falhouAntes) throw new Error('test_068 passou antes da migração 068!');
    console.log(`  [ANTES OK] ${msgAntes}`);

    console.log('3. Conferindo o cofre e aplicando a 068 (1ª vez)...');
    const texto068 = await readFile(new URL('../../' + sql068, import.meta.url), 'utf8');
    const bytes = conferirRegrasCofre068(texto068);
    console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
    await arquivo(sql068, { quiet: true });

    console.log('4. Executando test_068...');
    await rodarTeste(test068);

    console.log('5. Testando idempotência (reaplicando 068 e o roteiro)...');
    await arquivo(sql068, { quiet: true });
    await rodarTeste(test068);

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
    if (semBarreira) throw new Error('Tabela sem trg_bloqueia_agente válido depois da 068: ' + semBarreira);
    console.log('  [BARREIRA OK]');

    const helpersDepois = (await q(helpersQuery)).rows;
    if (JSON.stringify(helpersAntes) !== JSON.stringify(helpersDepois)) {
      throw new Error('068 alterou algum helper protegido!');
    }
    console.log('  [HELPERS OK] os 6 helpers protegidos não mudaram.');

    console.log('7. Provando mutantes da 068...');

    await esperarFalhaTest068(
      '1) get_pedido_bolsas_v2 devolvendo bolsa de centro fora do escopo',
      async () => {
        const fn = extrairFuncao(texto068, 'get_pedido_bolsas_v2');
        const alvo = `     where s.holder_id in (select id from pessoas)
       and s.end_date >= current_date - 180
       and (v_admin or s.project_id = any(public.allowed_project_ids()))`;
        const mut = fn.replace(
          alvo,
          `     where s.holder_id in (select id from pessoas)
       and s.end_date >= current_date - 180`,
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 1.');
        await sql(mut);
      },
      'b1 recebeu bolsa de centro fora do escopo',
    );

    await esperarFalhaTest068(
      '2) _bolsista_no_pedido listando pessoa com bolsa cancelada',
      async () => {
        const fn = extrairFuncao(texto068, '_bolsista_no_pedido');
        const alvo = `          and s.status <> 'cancelled'`;
        const mut = fn.replace(
          alvo,
          `          and (s.status <> 'cancelled' or true)`,
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 2.');
        await sql(mut);
      },
      'admin não lista quem só tem bolsa cancelada',
    );

    await esperarFalhaTest068(
      '3) salvar_equipe_bolsista_v2 sem checar visibilidade',
      async () => {
        const fn = extrairFuncao(texto068, 'salvar_equipe_bolsista_v2');
        const alvo = `  if not public._bolsista_visivel(p_holder_id) then
    raise exception 'Pessoa fora do seu escopo.' using errcode = '42501';
  end if;`;
        const mut = fn.replace(alvo, '');
        if (mut === fn) throw new Error('Falha ao montar mutante 3.');
        await sql(mut);
      },
      'deveria falhar',
    );

    await esperarFalhaTest068(
      '4) get_pedido_bolsas_v2 somando bolsa que não está vigente hoje',
      async () => {
        const fn = extrairFuncao(texto068, 'get_pedido_bolsas_v2');
        const alvo = `    select b.holder_id, sum(b.valor) as valor_vigente
      from bolsas b
     where b.vigente_hoje
     group by b.holder_id`;
        const mut = fn.replace(
          alvo,
          `    select b.holder_id, sum(b.valor) as valor_vigente
      from bolsas b
     group by b.holder_id`,
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 4.');
        await sql(mut);
      },
      'Davi (ended no passado) deveria valer 0 hoje',
    );

    await esperarFalhaTest068(
      '5) colocar_na_caixa_v2 não tirando a pessoa das outras caixas',
      async () => {
        const fn = extrairFuncao(texto068, 'colocar_na_caixa_v2');
        const alvo = `    delete from public.caixa_pedido_itens i
     using public.caixas_pedido c
     where i.caixa_id = c.id
       and c.dono = v_caixa.dono
       and c.id <> p_caixa_id
       and i.holder_id = p_holder_id;`;
        const mut = fn.replace(alvo, '');
        if (mut === fn) throw new Error('Falha ao montar mutante 5.');
        await sql(mut);
      },
      'caixa 1 deveria ficar com 1 pessoa',
    );

    await esperarFalhaTest068(
      '6) salvar_caixa_pedido_v2 sem o limite de 10 caixas',
      async () => {
        const fn = extrairFuncao(texto068, 'salvar_caixa_pedido_v2');
        const alvo = `    if v_count >= 10 then
      raise exception 'Limite de 10 caixas por usuário.' using errcode = '22023';
    end if;`;
        const mut = fn.replace(alvo, '');
        if (mut === fn) throw new Error('Falha ao montar mutante 6.');
        await sql(mut);
      },
      'deveria falhar',
    );

    await esperarFalhaTest068(
      '7) get_pedido_bolsas_v2 contando item de pessoa não visível',
      async () => {
        const fn = extrairFuncao(texto068, 'get_pedido_bolsas_v2');
        const alvo = '      join pessoas_json pj on pj.holder_id = i.holder_id';
        const mut = fn.replace(alvo, '      left join pessoas_json pj on pj.holder_id = i.holder_id');
        if (mut === fn) throw new Error('Falha ao montar mutante 7.');
        await sql(mut);
      },
      'caixa 1 deveria contar 1 item oculto',
    );

    await esperarFalhaTest068(
      '8) salvar_caixa_pedido_v2 sem a pré-checagem de CPF',
      async () => {
        const fn = extrairFuncao(texto068, 'salvar_caixa_pedido_v2');
        const alvo = `  if public._tem_cpf(v_nome) then
    raise exception 'Nome de caixa contém sequência no formato de CPF e não pode ser gravado.'
      using errcode = '22023';
  end if;`;
        const mut = fn.replace(alvo, '');
        if (mut === fn) throw new Error('Falha ao montar mutante 8.');
        await sql(mut);
      },
      'esperado SQLSTATE 22023',
    );

    await esperarFalhaTest068(
      '9) grant select direto para authenticated',
      async () => {
        await sql('grant select on public.caixas_pedido to authenticated;');
      },
      'deveria falhar',
    );

    await esperarFalhaTest068(
      '10) apagar_caixa_pedido_v2 sem checar o dono',
      async () => {
        const fn = extrairFuncao(texto068, 'apagar_caixa_pedido_v2');
        const alvo = `  if not found or v_caixa.dono <> auth.uid() then
    raise exception 'Caixa do pedido não encontrada.' using errcode = 'P0002';
  end if;`;
        const mut = fn.replace(alvo, '');
        if (mut === fn) throw new Error('Falha ao montar mutante 10.');
        await sql(mut);
      },
      'deveria falhar',
    );

    await esperarFalhaTest068(
      '11) salvar_caixa_pedido_v2 sem o advisory lock por dono',
      async () => {
        const fn = extrairFuncao(texto068, 'salvar_caixa_pedido_v2');
        const alvo = `    perform pg_advisory_xact_lock(hashtextextended('caixas_pedido:' || v_dono::text, 0));
`;
        const mut = fn.replace(alvo, '');
        if (mut === fn) throw new Error('Falha ao montar mutante 11.');
        await sql(mut);
      },
      'salvar_caixa_pedido_v2 sem pg_advisory_xact_lock',
    );

    await esperarFalhaTest068(
      '12) colocar_na_caixa_v2 sem o advisory lock por dono',
      async () => {
        const fn = extrairFuncao(texto068, 'colocar_na_caixa_v2');
        const alvo = `  perform pg_advisory_xact_lock(hashtextextended('caixas_pedido:' || v_caixa.dono::text, 0));
`;
        const mut = fn.replace(alvo, '');
        if (mut === fn) throw new Error('Falha ao montar mutante 12.');
        await sql(mut);
      },
      'colocar_na_caixa_v2 sem pg_advisory_xact_lock',
    );

    await esperarFalhaTest068(
      '13) caixas_pedido sem trg_bloqueia_automacao',
      async () => {
        await sql('drop trigger trg_bloqueia_automacao on public.caixas_pedido;');
      },
      'trg_bloqueia_automacao ausente ou incorreto',
    );

    await esperarFalhaTest068(
      '14) caixas_pedido sem PK',
      async () => {
        await sql('alter table public.caixas_pedido drop constraint caixas_pedido_pkey cascade;');
      },
      'PK de caixas_pedido ausente ou errada',
    );

    await esperarFalhaTest068(
      '15) FK de caixa_pedido_itens apontando para outra tabela',
      async () => {
        await sql(`
          alter table public.caixa_pedido_itens
            drop constraint caixa_pedido_itens_holder_id_fkey;
          alter table public.caixa_pedido_itens
            add constraint caixa_pedido_itens_holder_id_fkey
            foreign key (holder_id) references public.projects(id) on delete cascade;
        `);
      },
      'caixa_pedido_itens_holder_id_fkey ausente, alvo/colunas errados',
    );

    await esperarFalhaTest068(
      '16) colocar_na_caixa_v2 sem levar valor e nota ao mover',
      async () => {
        const fn = extrairFuncao(texto068, 'colocar_na_caixa_v2');
        const alvo = `    insert into public.caixa_pedido_itens (caixa_id, holder_id, valor_mensal, nota, criado_em)
    values (p_caixa_id, p_holder_id, v_origem.valor_mensal, v_origem.nota, now());`;
        const mut = fn.replace(
          alvo,
          `    insert into public.caixa_pedido_itens (caixa_id, holder_id, valor_mensal, nota, criado_em)
    values (p_caixa_id, p_holder_id, null, null, now());`,
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 16.');
        await sql(mut);
      },
      'Bruno deveria levar 4500 para a caixa 2',
    );

    await esperarFalhaTest068(
      '17) editar_item_caixa_v2 sem recusar a automação',
      async () => {
        const fn = extrairFuncao(texto068, 'editar_item_caixa_v2');
        const alvo = `  if public.is_agente() or public.is_automacao(null) then
    raise exception 'O agente e a automação não leem nem gravam o pedido de bolsas.' using errcode = '42501';
  end if;`;
        const mut = fn.replace(
          alvo,
          `  if public.is_agente() then
    raise exception 'O agente e a automação não leem nem gravam o pedido de bolsas.' using errcode = '42501';
  end if;`,
        );
        if (mut === fn) throw new Error('Falha ao montar mutante 17.');
        await sql(mut);
      },
      'esperado SQLSTATE 42501',
    );

    console.log('8. Conferência final depois dos mutantes...');
    await arquivo(sql068, { quiet: true });
    await rodarTeste(test068);

    const helpersFinal = (await q(helpersQuery)).rows;
    if (JSON.stringify(helpersAntes) !== JSON.stringify(helpersFinal)) {
      throw new Error('Mutantes deixaram helper protegido alterado!');
    }

    console.log('068 OK em PGlite: base real + 064/stub-064 + test_068 falhando antes + test_068 + idempotência + barreira 051 + helpers intactos + 17 mutantes + roteiro final.');
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
