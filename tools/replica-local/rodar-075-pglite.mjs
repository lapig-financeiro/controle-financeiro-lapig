// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-075-pglite.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';
import { montarBase064, carregarArquivo } from './rodar-064-pglite.mjs';

const sql074 = 'database/074_analise_registro.sql';
const test074 = 'tests/sql/test_074_analise_registro.sql';
const sql075 = 'database/075_analise_historico.sql';
const test075 = 'tests/sql/test_075_analise_historico.sql';

const A1 = '00000000-0000-0000-0000-0000000000a1';
const B1 = '00000000-0000-0000-0000-0000000000b1';

const FUNCOES = [
  'public.analise_registro_iniciar(text, integer, text, uuid)',
  'public.analise_conversas_listar(integer, timestamp with time zone)',
  'public.analise_conversa_ler(uuid)',
  'public.analise_conversa_renomear(uuid, text)',
  'public.analise_conversa_excluir(uuid)',
  'public.analise_feedback_enviar(uuid, smallint, text, text)',
  'public.analise_registros_admin(timestamp with time zone, integer)',
];

export function conferirRegrasCofre075(texto) {
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > 90 * 1024) {
    throw new Error(`Cofre: 075 excede 90 KB (${bytes} bytes).`);
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
      throw new Error(`Cofre: termo proibido encontrado na 075: "${termo}".`);
    }
  }
  if (/\bcopy\s+/i.test(miolo)) {
    throw new Error('Cofre: comando COPY proibido na 075.');
  }
  return bytes;
}

function extrairFuncao(texto, nome) {
  const m = texto.match(
    new RegExp('create or replace function public\\.' + nome + '\\b[\\s\\S]*?\\n\\$\\$;'),
  );
  if (!m) throw new Error(`Não foi possível extrair ${nome} da 075.`);
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

  async function arquivoTexto(texto) {
    await db.exec(texto, { onNotice: (n) => console.log('  [NOTICE]', n.message) });
  }

  async function restaurar075() {
    await arquivo(sql075);
  }

  async function esperarFalhaTest075(rotulo, aplicarMutante, trechoEsperado) {
    await aplicarMutante();
    let falhou = false;
    let msg = '';
    try {
      await rodarTeste(test075);
    } catch (e) {
      falhou = true;
      msg = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
      await restaurar075();
    }
    if (!falhou) {
      throw new Error(`Mutante NÃO foi detectado por test_075: ${rotulo}`);
    }
    if (trechoEsperado && !msg.includes(trechoEsperado)) {
      throw new Error(`Mutante detectado pelo motivo errado (${rotulo}): ${msg}`);
    }
    console.log(`  [MUTANTE OK] ${rotulo} -> ${msg}`);
  }

  async function autenticar(userId) {
    await sql('set role authenticated;');
    await q(`select set_config('request.jwt.claim.sub', $1, false)`, [userId || '']);
  }

  async function voltarAoDono() {
    await sql('reset role;');
  }

  try {
    console.log('1. Montando base real (até 064, com 051/052/053/054/056/062/038/048)...');
    await montarBase064(db, { quiet: true });

    console.log('2. Criando o papel de servidor e o auth.role() do ambiente de teste...');
    // Em produção o Supabase já tem os dois; o PGlite precisa dos stubs.
    await sql(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'service' || '_' || 'role') then
          execute 'create role ' || 'service' || '_' || 'role';
        end if;
      end $$;
      grant usage on schema public, auth to "service_role";
      create or replace function auth.role() returns text
      language sql stable as $$
        select coalesce(
          nullif(current_setting('request.jwt.claim.role', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
        )
      $$;
    `);

    console.log('3. Aplicando a 074 e provando o comportamento antigo...');
    await arquivo(sql074);

    // 3a. Pelo caminho antigo: a pessoa logada abre e conclui o próprio registro.
    await autenticar(A1);
    const legadoA = (
      await q(
        `select public.analise_registro_iniciar($1, $2, $3)`,
        [
          '  Quanto   o 30.910 tem   livre hoje, e de onde vem? (pergunta legada com espaços e mais de oitenta caracteres)  ',
          1,
          'modelo-legado',
        ],
      )
    ).rows[0].analise_registro_iniciar;
    await q(
      `select public.analise_registro_concluir($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7)`,
      [
        legadoA,
        JSON.stringify({ texto: { texto: 'Resposta legada de A.', semOrigem: [] }, blocos: [] }),
        JSON.stringify([{ ferramenta: 'listar_centros', estado: 'fim' }]),
        2, 1500, 3, 'ok',
      ],
    );
    await voltarAoDono();

    const antigo = (await q(
      `select terminada_em is not null as concluido, desfecho from public.analise_registro where id = $1`,
      [legadoA],
    )).rows[0];
    exigir(antigo.concluido === true, '074: o comportamento antigo de concluir pela pessoa logada não foi provado');
    exigir(antigo.desfecho === 'ok', `074: desfecho antigo inesperado ${antigo.desfecho}`);
    console.log('  [ANTES OK] iniciar/concluir pela pessoa logada funcionam na 074');

    // 3b. Um segundo registro legado, de B, concluído e com feedback.
    await q(
      `insert into public.analise_registro
         (id, user_id, iniciada_em, terminada_em, pergunta, anteriores, modelo, resposta, passos, rodadas, ms, chamadas, desfecho)
       values
         ($1, $2, now() - interval '2 days', now() - interval '2 days' + interval '1 minute',
          'Pergunta legada de B', 0, 'modelo-legado',
          $3::jsonb, '[]'::jsonb, 1, 60000, 2, 'ok')`,
      [
        '00000000-0000-0000-0000-0000000000b2',
        B1,
        JSON.stringify({ texto: { texto: 'Resposta legada de B.', semOrigem: [] }, blocos: [] }),
      ],
    );
    await q(
      `insert into public.analise_feedback (registro_id, user_id, nota)
       values ('00000000-0000-0000-0000-0000000000b2', $1, 1::smallint)`,
      [B1],
    );
    await voltarAoDono();

    const antes = (await q(
      `select count(*)::int as registros,
              count(distinct user_id)::int as usuarios,
              count(*) filter (where terminada_em is not null)::int as concluidos
         from public.analise_registro`,
    )).rows[0];
    exigir(antes.registros === 2 && antes.usuarios === 2 && antes.concluidos === 2,
      `074: base legada inesperada ${JSON.stringify(antes)}`);

    console.log('4. Provando a ausência da 075: o roteiro falha com 42P01...');
    let falhouAntes = false;
    let msgAntes = '';
    let codigoAntes = '';
    try {
      await rodarTeste(test075);
    } catch (e) {
      falhouAntes = true;
      msgAntes = e.message;
      codigoAntes = e.code ?? '';
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
    }
    if (!falhouAntes) throw new Error('test_075 passou antes da migração 075!');
    if (codigoAntes !== '42P01') {
      throw new Error(`ANTES da 075 falhou pelo motivo errado: ${codigoAntes} ${msgAntes}`);
    }
    if (!msgAntes.includes('analise_conversa')) {
      throw new Error(`ANTES da 075 falhou na tabela errada: ${msgAntes}`);
    }
    console.log(`  [ANTES OK] ${codigoAntes || 'sem código'}: ${msgAntes}`);

    console.log('5. Conferindo o cofre e aplicando a 075 (1ª vez)...');
    const texto075Bruto = await readFile(new URL('../../' + sql075, import.meta.url), 'utf8');
    const bytes = conferirRegrasCofre075(texto075Bruto);
    console.log(`Cofre OK: ${bytes} bytes, begin;/commit; válidos, sem termos proibidos.`);
    await arquivo(sql075);

    console.log('6. Conferindo o backfill: cada registro legado ganhou uma conversa própria...');
    const backfill = (await q(`
      select r.id,
             r.conversa_id,
             r.ordem,
             c.user_id,
             c.titulo,
             c.criada_em,
             c.atualizada_em,
             r.iniciada_em,
             r.terminada_em,
             length(c.titulo) as titulo_chars,
             (r.conversa_id = md5('lapig:analise_conversa:' || r.id::text)::uuid) as id_deterministico
        from public.analise_registro r
        join public.analise_conversa c on c.id = r.conversa_id
       order by r.id
    `)).rows;
    exigir(backfill.length === 2, `backfill: esperava 2 registros ligados, vieram ${backfill.length}`);
    for (const linha of backfill) {
      exigir(linha.ordem === 1, `backfill: registro ${linha.id} ficou com ordem ${linha.ordem}`);
      // Regra do cofre: o ensaio e a produção têm de gerar a mesma conversa.
      exigir(linha.id_deterministico === true,
        `backfill: conversa de ${linha.id} sem id determinístico (gen_random_uuid quebra o cofre)`);
      exigir(linha.titulo_chars <= 80, `backfill: título com ${linha.titulo_chars} caracteres`);
      exigir(linha.user_id === (linha.id === '00000000-0000-0000-0000-0000000000b2' ? B1 : A1),
        `backfill: conversa de ${linha.id} com dono errado`);
      exigir(!/\s{2,}/.test(linha.titulo), `backfill: título com espaços repetidos: ${linha.titulo}`);
      const quando = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
      exigir(quando(linha.criada_em) === quando(linha.iniciada_em),
        `backfill: criada_em diferente de iniciada_em em ${linha.id}`);
      const esperada = quando(linha.terminada_em ?? linha.iniciada_em);
      exigir(quando(linha.atualizada_em) === esperada,
        `backfill: atualizada_em diferente de coalesce(terminada_em, iniciada_em) em ${linha.id}`);
    }
    const tituloA = backfill.find((l) => l.user_id === A1)?.titulo || '';
    exigir(tituloA.startsWith('Quanto o 30.910 tem livre hoje, e de onde vem?'),
      `backfill: título de A inesperado: ${tituloA}`);
    const orfas = (await q(`
      select count(*)::int as n
        from public.analise_registro r
       where r.conversa_id is null
          or not exists (select 1 from public.analise_conversa c where c.id = r.conversa_id)
    `)).rows[0].n;
    exigir(orfas === 0, `backfill: ${orfas} registro(s) sem conversa`);
    const conversasVazias = (await q(`
      select count(*)::int as n
        from public.analise_conversa c
       where not exists (select 1 from public.analise_registro r where r.conversa_id = c.id)
    `)).rows[0].n;
    exigir(conversasVazias === 0, `backfill: ${conversasVazias} conversa(s) sem registro`);
    console.log('  [BACKFILL OK] 2 conversas próprias, títulos e datas certos, nada órfão');

    console.log('7. Roteiro da 075 depois da migração...');
    await rodarTeste(test075);

    console.log('8. Idempotência: reaplicando a 075 e o roteiro...');
    await arquivo(sql075);
    await rodarTeste(test075);

    console.log('9. Conferindo ACL e atributos de pg_proc...');
    const attrs = (await q(`
      select p.oid::regprocedure::text as assinatura,
             p.pronargs,
             p.pronargdefaults,
             p.prosecdef,
             p.proconfig,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
             has_function_privilege('service' || '_' || 'role', p.oid, 'EXECUTE') as servidor_exec,
             exists (
               select 1
                 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE'
             ) as public_exec
        from pg_proc p
       where p.oid in (${FUNCOES.map((f) => `'${f}'::regprocedure`).join(', ')})
       order by 1
    `)).rows;
    exigir(attrs.length === FUNCOES.length, `esperava ${FUNCOES.length} RPCs, vieram ${attrs.length}`);

    const esperado = [
      { nome: 'analise_registro_iniciar(text,integer,text,uuid)', args: 4, defaults: 3 },
      {
        nome: 'analise_conversas_listar(integer,timestamp with time zone)',
        args: 2,
        defaults: 2,
      },
      { nome: 'analise_conversa_ler(uuid)', args: 1, defaults: 0 },
      { nome: 'analise_conversa_renomear(uuid,text)', args: 2, defaults: 0 },
      { nome: 'analise_conversa_excluir(uuid)', args: 1, defaults: 0 },
      { nome: 'analise_feedback_enviar(uuid,smallint,text,text)', args: 4, defaults: 3 },
      {
        nome: 'analise_registros_admin(timestamp with time zone,integer)',
        args: 2,
        defaults: 2,
      },
    ];
    for (const e of esperado) {
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

    const servidor = (await q(`
      select has_function_privilege(
               'service' || '_' || 'role',
               'public.analise_registro_concluir_servidor(uuid, uuid, jsonb, jsonb, integer, integer, integer, text, text)'::regprocedure,
               'EXECUTE') as executar,
             has_function_privilege(
               'authenticated',
               'public.analise_registro_concluir_servidor(uuid, uuid, jsonb, jsonb, integer, integer, integer, text, text)'::regprocedure,
               'EXECUTE') as autenticado,
             has_function_privilege(
               'anon',
               'public.analise_registro_concluir_servidor(uuid, uuid, jsonb, jsonb, integer, integer, integer, text, text)'::regprocedure,
               'EXECUTE') as anonimo
    `)).rows[0];
    exigir(servidor.executar === true, 'concluir_servidor sem EXECUTE para a credencial de servidor');
    exigir(servidor.autenticado === false, 'concluir_servidor com EXECUTE para authenticated');
    exigir(servidor.anonimo === false, 'concluir_servidor com EXECUTE para anon');
    const antiga = (await q(
      `select count(*)::int as n from pg_proc
        where pronamespace = 'public'::regnamespace and proname = 'analise_registro_concluir'`,
    )).rows[0].n;
    exigir(antiga === 0, 'a analise_registro_concluir antiga ainda existe');
    console.log('  [ACL/ATRIBUTOS OK]');

    const aclTabelas = (await q(`
      select c.relname,
             has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon,
             has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as autenticado,
             c.relrowsecurity as rls,
             (select count(*)::int from pg_policies
               where schemaname = 'public' and tablename = c.relname) as policies
        from pg_class c
       where c.oid in ('public.analise_conversa'::regclass, 'public.analise_registro'::regclass, 'public.analise_feedback'::regclass)
       order by c.relname
    `)).rows;
    exigir(aclTabelas.length === 3, 'faltou tabela depois da 075');
    for (const t of aclTabelas) {
      exigir(t.anon === false, `anon tem acesso a ${t.relname}`);
      exigir(t.autenticado === false, `authenticated tem acesso direto a ${t.relname}`);
      exigir(t.rls === true, `RLS desligado em ${t.relname}`);
      exigir(t.policies === 0, `${t.relname} ganhou policy`);
    }
    console.log('  [TABELAS OK]');

    console.log('10. Conferindo o BLOCO 1 da 051 (trg_bloqueia_agente em toda tabela de public)...');
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
    if (semBarreira) throw new Error('Tabela sem trg_bloqueia_agente válido depois da 075: ' + semBarreira);
    console.log('  [BARREIRA OK]');

    console.log('11. Provando os mutantes da 075...');
    const texto075 = texto075Bruto.replace(/\r\n/g, '\n');

    await esperarFalhaTest075(
      '1) sem RLS em analise_conversa',
      async () => {
        await sql('alter table public.analise_conversa disable row level security;');
      },
      '075 FALHOU: RLS desligado em analise_conversa',
    );

    await esperarFalhaTest075(
      '2) grant de EXECUTE para anon',
      async () => {
        await sql('grant execute on function public.analise_conversa_ler(uuid) to anon;');
      },
      '075 FALHOU: anon/PUBLIC possui EXECUTE',
    );

    await esperarFalhaTest075(
      '3) iniciar aceitando conversa alheia',
      async () => {
        const fn = extrairFuncao(texto075, 'analise_registro_iniciar');
        const mut = fn.replace('and c.user_id = v_user', 'and true');
        if (mut === fn) throw new Error('Falha ao montar o mutante 3.');
        await sql(mut);
      },
      '075 FALHOU: B continuou a conversa de A',
    );

    await esperarFalhaTest075(
      '4) ler sem filtro de dono',
      async () => {
        const fn = extrairFuncao(texto075, 'analise_conversa_ler');
        const mut = fn.replace('and c.user_id = v_user', 'and true');
        if (mut === fn) throw new Error('Falha ao montar o mutante 4.');
        await sql(mut);
      },
      '075 FALHOU: B leu a conversa de A',
    );

    await esperarFalhaTest075(
      '5) excluir sem filtro de dono',
      async () => {
        const fn = extrairFuncao(texto075, 'analise_conversa_excluir');
        const mut = fn.replace('and user_id = v_user', 'and true');
        if (mut === fn) throw new Error('Falha ao montar o mutante 5.');
        await sql(mut);
      },
      '075 FALHOU: B excluiu a conversa de A',
    );

    await esperarFalhaTest075(
      '6) concluir_servidor com grant a authenticated',
      async () => {
        await sql(`grant execute on function public.analise_registro_concluir_servidor(
          uuid, uuid, jsonb, jsonb, integer, integer, integer, text, text) to authenticated;`);
      },
      '075 FALHOU: concluir_servidor executável por authenticated/anon/PUBLIC',
    );

    await esperarFalhaTest075(
      '7) delete de 180 dias de volta',
      async () => {
        const fn = extrairFuncao(texto075, 'analise_registro_iniciar');
        const mut = fn.replace(
          '  -- Freio de inundação no banco',
          `  delete from public.analise_registro
    where user_id = v_user
      and iniciada_em < now() - interval '180 days';

  -- Freio de inundação no banco`,
        );
        if (mut === fn) throw new Error('Falha ao montar o mutante 7.');
        await sql(mut);
      },
      '075 FALHOU: iniciar ainda apaga por 180 dias',
    );

    console.log('12. Provando o mutante do backfill (registro legado fica sem conversa)...');
    await sql('truncate public.analise_conversa, public.analise_registro, public.analise_feedback cascade;');
    await sql(`
      alter table public.analise_registro alter column conversa_id drop not null;
      alter table public.analise_registro alter column ordem drop not null;
      insert into public.analise_registro (id, user_id, pergunta)
      values ('00000000-0000-0000-0000-0000000000e9', '${A1}', 'Registro sem conversa');
    `);
    const mutBackfill = texto075.replace(
      'set conversa_id = n.conversa,',
      'set conversa_id = null,',
    );
    if (mutBackfill === texto075) throw new Error('Falha ao montar o mutante do backfill.');
    let falhouBackfill = false;
    let msgBackfill = '';
    try {
      await arquivoTexto(mutBackfill);
    } catch (e) {
      falhouBackfill = true;
      msgBackfill = e.message;
    } finally {
      try { await sql('rollback;'); } catch { /* idem */ }
    }
    if (!falhouBackfill) {
      throw new Error('Mutante NÃO foi detectado: backfill deixando registro sem conversa');
    }
    if (!/conversa_id/i.test(msgBackfill) || !/null/i.test(msgBackfill)) {
      throw new Error(`Mutante do backfill falhou pelo motivo errado: ${msgBackfill}`);
    }
    console.log(`  [MUTANTE OK] 8) backfill deixando registro sem conversa -> ${msgBackfill}`);
    await restaurar075();
    const reparado = (await q(`
      select r.conversa_id is not null as ligado, r.ordem
        from public.analise_registro r
       where r.id = '00000000-0000-0000-0000-0000000000e9'
    `)).rows[0];
    exigir(reparado?.ligado === true && reparado.ordem === 1,
      'o backfill real não reparou o registro deixado pelo mutante');

    console.log('13. Conferência final depois dos mutantes...');
    await restaurar075();
    await rodarTeste(test075);

    console.log('075 OK em PGlite: ausência antes (42P01) + comportamento antigo + migração + backfill + roteiro + idempotência + ACL/atributos + barreira 051 + 8 mutantes.');
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
