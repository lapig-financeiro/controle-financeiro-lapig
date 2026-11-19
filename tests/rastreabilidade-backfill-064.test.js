import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { lerPdf } from '../tools/rastreabilidade/documento.mjs';
import { VERSAO, executarBackfill } from '../tools/rastreabilidade/executar.mjs';

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1';
const CODIGO_CENTRO = '99.E2E';

// ── PDF sintético (mesma ideia de app/scripts/gerar-pdf-exemplo.mjs) ──

function escaparTextoPdf(texto) {
  return String(texto)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function construirStreamPagina(linhas) {
  const comandos = ['BT'];
  for (const item of linhas) {
    const fonte = item.negrito ? '/F2' : '/F1';
    const tamanho = item.tamanho || 10;
    comandos.push(`${fonte} ${tamanho} Tf`);
    if (Array.isArray(item.colunas)) {
      for (const col of item.colunas) {
        comandos.push(`1 0 0 1 ${col.x} ${item.y} Tm (${escaparTextoPdf(col.texto)}) Tj`);
      }
    } else {
      comandos.push(`1 0 0 1 ${item.x ?? 42} ${item.y} Tm (${escaparTextoPdf(item.texto)}) Tj`);
    }
  }
  comandos.push('ET');
  return comandos.join('\n');
}

function montarPdfBytes(paginasLinhas) {
  const objetos = [];
  const adicionarObjeto = (corpo) => {
    objetos.push(corpo);
    return objetos.length;
  };

  adicionarObjeto('');
  adicionarObjeto('');
  const idFonteNormal = adicionarObjeto(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const idFonteNegrito = adicionarObjeto(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  const idsPaginas = [];
  for (const linhas of paginasLinhas) {
    const stream = construirStreamPagina(linhas);
    const bytesStream = Buffer.byteLength(stream, 'latin1');
    const idConteudo = adicionarObjeto(`<< /Length ${bytesStream} >>\nstream\n${stream}\nendstream`);
    const idPagina = adicionarObjeto(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + `/Resources << /Font << /F1 ${idFonteNormal} 0 R /F2 ${idFonteNegrito} 0 R >> >> `
      + `/Contents ${idConteudo} 0 R >>`,
    );
    idsPaginas.push(idPagina);
  }

  objetos[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[1] = `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(' ')}] /Count ${idsPaginas.length} >>`;

  const partes = ['%PDF-1.4\n'];
  const offsets = [0];
  let cursor = Buffer.byteLength(partes[0], 'latin1');

  for (let i = 0; i < objetos.length; i += 1) {
    offsets.push(cursor);
    const bloco = `${i + 1} 0 obj\n${objetos[i]}\nendobj\n`;
    partes.push(bloco);
    cursor += Buffer.byteLength(bloco, 'latin1');
  }

  const inicioXref = cursor;
  const xrefLinhas = [`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`];
  for (let i = 1; i <= objetos.length; i += 1) {
    xrefLinhas.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  const trailer = `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\n`
    + `startxref\n${inicioXref}\n%%EOF\n`;

  partes.push(xrefLinhas.join(''), trailer);
  return Buffer.from(partes.join(''), 'latin1');
}

function linhaContabil(y, conta, reduzido, descricao, debitos, creditos, saldo, negrito = false) {
  return {
    y,
    tamanho: 9,
    negrito,
    colunas: [
      { x: 42, texto: conta },
      { x: 145, texto: reduzido },
      { x: 190, texto: descricao },
      { x: 392, texto: debitos },
      { x: 454, texto: creditos },
      { x: 512, texto: saldo },
    ],
  };
}

function definicaoPaginas() {
  const cabecalho = (y) => linhaContabil(y, 'Conta', 'Reduz.', 'Descricao', 'Debitos', 'Creditos', 'Saldo Atual', true);

  const pagina1 = [
    { x: 42, y: 790, tamanho: 12, negrito: true, texto: 'BALANCETE CONTABIL ANALITICO (E2E SINTETICO)' },
    { x: 42, y: 770, tamanho: 10, texto: 'Projeto: 99.E2E' },
    cabecalho(720),
    linhaContabil(696, '7.1.3.04.01.09142', '09142', 'BOLSA DOACAO PESQUISA', '380.000,00', '0,00', '380.000,00'),
    linhaContabil(672, '7.1.3.04.01.09145', '09145', 'BOLSA APOIO TECNICO', '160.000,00', '0,00', '160.000,00'),
    linhaContabil(648, '7.1.3.04.02.09210', '09210', 'AUXILIO COLABORADORES EXTERNOS', '72.400,00', '0,00', '72.400,00'),
    { x: 42, y: 60, tamanho: 9, texto: 'Balancete sintetico - Pagina 1 de 2' },
  ];

  const pagina2 = [
    { x: 42, y: 790, tamanho: 12, negrito: true, texto: 'BALANCETE CONTABIL ANALITICO - CONTINUACAO (99.E2E)' },
    cabecalho(752),
    linhaContabil(726, '7.1.3.05', '08100', 'SERVICOS DE TERCEIROS (PJ)', '105.900,00', '0,00', '105.900,00', true),
    linhaContabil(702, '7.1.3.05.01.08110', '08110', 'SERVICOS DE PROCESSAMENTO DE DADOS', '64.350,75', '0,00', '64.350,75'),
    linhaContabil(678, '7.1.3.05.01.08124', '08124', 'CONSULTORIA TECNICA ESPECIALIZADA', '41.549,25', '0,00', '41.549,25'),
    linhaContabil(644, '7.1.3.20', '05000', 'EQUIPAMENTOS E MATERIAL PERMANENTE', '68.000,00', '0,00', '68.000,00', true),
    linhaContabil(620, '7.1.3.20.01.05012', '05012', 'EQUIPAMENTOS DE PROCESSAMENTO DE DADOS', '68.000,00', '0,00', '68.000,00'),
    { x: 42, y: 560, tamanho: 10, negrito: true, texto: 'TOTAL DE DEBITOS: 786.300,00   TOTAL DE CREDITOS: 0,00' },
    { x: 42, y: 536, tamanho: 10, negrito: true, texto: 'SALDO DISPONIVEL EM CONTA MOVIMENTO: R$ 184.250,40.' },
    { x: 42, y: 514, tamanho: 10, texto: 'RENDIMENTO LIQUIDO APURADO: R$ 11.240,15.' },
    { x: 42, y: 60, tamanho: 9, texto: 'Balancete sintetico - Pagina 2 de 2' },
  ];

  return [pagina1, pagina2];
}

const LANCAMENTOS = [
  { conta_codigo: '7.1.3.04.01.09142', descricao: 'BOLSA DOACAO PESQUISA', valor: 380000, rubrica: 'a.bolsas' },
  { conta_codigo: '7.1.3.04.01.09145', descricao: 'BOLSA APOIO TECNICO', valor: 160000, rubrica: 'a.bolsas' },
  { conta_codigo: '7.1.3.04.02.09210', descricao: 'AUXILIO COLABORADORES EXTERNOS', valor: 72400, rubrica: 'a.bolsas' },
  { conta_codigo: '7.1.3.05.01.08110', descricao: 'SERVICOS DE PROCESSAMENTO DE DADOS', valor: 64350.75, rubrica: 'b' },
  { conta_codigo: '7.1.3.05.01.08124', descricao: 'CONSULTORIA TECNICA ESPECIALIZADA', valor: 41549.25, rubrica: 'b' },
  { conta_codigo: '7.1.3.20.01.05012', descricao: 'EQUIPAMENTOS DE PROCESSAMENTO DE DADOS', valor: 68000, rubrica: 'b' },
  // Linha sem rubrica: o backfill não procura (correção 3), mas ela conta
  // para a conferência de "lançamentos que existem".
  { conta_codigo: '7.1.1.01.00001', descricao: 'RECEITA', valor: 999.99, rubrica: null },
];

function listaSql(ids) {
  return ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(', ');
}

function numeroOuNulo(valor) {
  return valor == null ? null : Number(valor);
}

function criarClientePglite(db, { pdfBytes, chamadas }) {
  return {
    async lerPapel() {
      return 'admin';
    },
    async lerProjetosAtivos() {
      const { rows } = await db.query('select id, code, name from public.projects where active = true');
      return rows;
    },
    async lerBalancetesDoAno(projectIds, ano) {
      if (!projectIds.length) return [];
      const { rows } = await db.query(`
        select id, project_id, data_referencia, saldo_disponivel, rendimento_liquido,
               total_debitos, total_creditos, arquivo_storage_path, arquivo_nome, raw_extraction
          from public.balancetes
         where project_id in (${listaSql(projectIds)})
           and data_referencia >= $1::date and data_referencia <= $2::date
           and arquivo_storage_path is not null
           and btrim(arquivo_storage_path) <> ''
      `, [`${ano}-01-01`, `${ano}-12-31`]);
      return rows.map((linha) => ({
        ...linha,
        saldo_disponivel: numeroOuNulo(linha.saldo_disponivel),
        rendimento_liquido: numeroOuNulo(linha.rendimento_liquido),
        total_debitos: numeroOuNulo(linha.total_debitos),
        total_creditos: numeroOuNulo(linha.total_creditos),
      }));
    },
    async lerLancamentos(balanceteIds) {
      if (!balanceteIds.length) return [];
      const { rows } = await db.query(`
        select id, balancete_id, conta_codigo, saldo_atual, rubrica_code
          from public.balancete_lancamentos
         where balancete_id in (${listaSql(balanceteIds)})
         order by conta_codigo, id
      `);
      return rows.map((linha) => ({ ...linha, saldo_atual: numeroOuNulo(linha.saldo_atual) }));
    },
    async lerPlanosAtivos(projectIds) {
      if (!projectIds.length) return [];
      const { rows } = await db.query(`
        select id, project_id, versao, ativo, valor_total_plano, arquivo_storage_path, arquivo_nome
          from public.planos_trabalho
         where project_id in (${listaSql(projectIds)})
           and ativo = true
           and arquivo_storage_path is not null
           and btrim(arquivo_storage_path) <> ''
      `);
      return rows.map((linha) => ({ ...linha, valor_total_plano: numeroOuNulo(linha.valor_total_plano) }));
    },
    async lerRubricasDoPlano(planoIds) {
      if (!planoIds.length) return [];
      const { rows } = await db.query(`
        select id, plano_id, rubrica_code, descricao_livre, valor_previsto
          from public.plano_rubricas
         where plano_id in (${listaSql(planoIds)})
      `);
      return rows.map((linha) => ({ ...linha, valor_previsto: numeroOuNulo(linha.valor_previsto) }));
    },
    async lerDesembolsos(planoIds) {
      if (!planoIds.length) return [];
      const { rows } = await db.query(`
        select id, plano_id, parcela, valor
          from public.plano_desembolsos
         where plano_id in (${listaSql(planoIds)})
      `);
      return rows.map((linha) => ({ ...linha, valor: numeroOuNulo(linha.valor) }));
    },
    async lerRubricas() {
      const { rows } = await db.query('select code, name from public.rubricas order by code');
      return rows;
    },
    async lerDocumentos(chaves) {
      if (!chaves.length) return [];
      const { rows } = await db.query(`
        select id, chave, titulo from public.documentos where chave in (${listaSql(chaves)})
      `);
      return rows;
    },
    async lerVersoesExistentes(documentoIds) {
      if (!documentoIds.length) return [];
      const { rows } = await db.query(`
        select documento_id, sha256 from public.documento_versoes
         where documento_id in (${listaSql(documentoIds)})
      `);
      return rows;
    },
    async baixarArquivo(bucket, caminho) {
      if (bucket !== 'balancete-pdfs' || !caminho.endsWith('/balancete.pdf')) {
        throw new Error('caminho inesperado no teste');
      }
      return pdfBytes;
    },
    async registrarDocumento(payload) {
      chamadas.push(payload);
      await db.exec('begin;');
      try {
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [ADMIN_ID]);
        await db.exec('set local role authenticated;');
        const resposta = await db.query(
          'select public.registrar_documento_v2($1::jsonb) as r',
          [JSON.stringify(payload)],
        );
        await db.exec('commit;');
        return resposta.rows[0].r;
      } catch (erro) {
        await db.exec('rollback;');
        throw erro;
      }
    },
  };
}

async function origemComoAdmin(db, tabela, id, campo) {
  await db.exec('begin;');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [ADMIN_ID]);
    await db.exec('set local role authenticated;');
    const resposta = await db.query(
      'select public.get_origem_v2($1, $2::uuid, $3) as o',
      [tabela, id, campo],
    );
    await db.exec('rollback;');
    return resposta.rows[0].o;
  } catch (erro) {
    await db.exec('rollback;');
    throw erro;
  }
}

const pgliteEntryUrl = new URL(
  '../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js',
  import.meta.url,
);
const temPglite = existsSync(fileURLToPath(pgliteEntryUrl));

if (!temPglite) {
  console.warn('[rastreabilidade] pglite não instalado em .cache/pglite-064; ponta a ponta pulado.');
}

describe.runIf(temPglite)('backfill F2-B — ponta a ponta com a 064 no pglite', () => {
  let db;
  let pdfBytes;
  let projetoId;
  let balanceteId;
  let ano;

  beforeAll(async () => {
    const { PGlite } = await import(pgliteEntryUrl.href);
    const { montarBase064, carregarArquivo } = await import(
      '../tools/replica-local/rodar-064-pglite.mjs'
    );

    db = new PGlite();
    await montarBase064(db, { quiet: true });
    await carregarArquivo(db, 'database/064_rastreabilidade.sql', { quiet: true });

    ano = new Date().getFullYear();
    const dataReferencia = `${ano}-10-15`;

    const projeto = await db.query(`
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Projeto E2E Backfill', $1, '2025-01-01', '2027-12-31', true)
      returning id
    `, [CODIGO_CENTRO]);
    projetoId = projeto.rows[0].id;

    const raw = { lancamentos: LANCAMENTOS.map((l) => ({ conta_codigo: l.conta_codigo })) };
    const balancete = await db.query(`
      insert into public.balancetes (
        project_id, data_referencia, saldo_disponivel, rendimento_liquido,
        total_debitos, total_creditos, arquivo_storage_path, arquivo_nome, raw_extraction
      ) values ($1, $2::date, 184250.40, 11240.15, 786300.00, 0.00, $3, 'balancete.pdf', $4::jsonb)
      returning id
    `, [projetoId, dataReferencia, `${projetoId}/balancete.pdf`, JSON.stringify(raw)]);
    balanceteId = balancete.rows[0].id;

    for (const lancamento of LANCAMENTOS) {
      await db.query(`
        insert into public.balancete_lancamentos (
          balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code
        ) values ($1, $2, $3, $4, $5)
      `, [balanceteId, lancamento.conta_codigo, lancamento.descricao, lancamento.valor, lancamento.rubrica]);
    }

    pdfBytes = montarPdfBytes(definicaoPaginas());
    const lido = await lerPdf(pdfBytes);
    expect(lido.totalPaginas).toBe(2);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it('simulação baixa, acha 9 fatos e não chama a RPC', async () => {
    const chamadas = [];
    const cliente = criarClientePglite(db, { pdfBytes, chamadas });
    const detalhe = await executarBackfill({
      cliente,
      opcoes: { aplicar: false, centro: CODIGO_CENTRO, ano },
    });

    expect(detalhe.resumo.documentos).toBe(1);
    expect(detalhe.resumo.achados).toBe(9);
    expect(detalhe.resumo.zeros).toBe(1);
    expect(detalhe.resumo.nao_achados).toBe(0);
    expect(detalhe.resumo.ambiguos).toBe(0);
    expect(detalhe.resumo.com_cpf).toBe(0);
    expect(detalhe.resumo.documentos_recusados).toBe(0);
    expect(chamadas).toHaveLength(0);

    const documento = detalhe.centros[0].documentos[0];
    expect(documento.status).toBe('simulado');
    expect(documento.formato).toBe('pdf');
    expect(documento.paginas).toBe(2);

    const versoes = await db.query('select count(*)::int as n from public.documento_versoes');
    expect(versoes.rows[0].n).toBe(0);
  }, 30000);

  it('aplicar registra a versão e get_origem_v2 devolve documento com a página certa', async () => {
    const chamadas = [];
    const cliente = criarClientePglite(db, { pdfBytes, chamadas });
    const detalhe = await executarBackfill({
      cliente,
      opcoes: { aplicar: true, centro: CODIGO_CENTRO, ano },
    });

    expect(detalhe.resumo.aplicados).toBe(1);
    expect(detalhe.resumo.achados).toBe(9);
    expect(chamadas).toHaveLength(1);

    const payload = chamadas[0];
    expect(payload.origem).toBe('backfill');
    expect(payload.parser).toBe('backfill-acharAlvo');
    expect(payload.parser_versao).toBe(VERSAO);
    expect(payload.paginas).toBe(2);
    expect(payload.fatos).toHaveLength(9);
    expect(payload.fatos.every((fato) => !('alvo_pai_id' in fato) && !('alvo_chave' in fato))).toBe(true);

    const versoes = await db.query('select count(*)::int as n from public.documento_versoes');
    expect(versoes.rows[0].n).toBe(1);
    const fatos = await db.query('select count(*)::int as n from public.fatos');
    expect(fatos.rows[0].n).toBe(9);

    const saldo = await origemComoAdmin(db, 'balancetes', balanceteId, 'saldo_disponivel');
    expect(saldo.tipo).toBe('documento');
    expect(saldo.fato.pagina).toBe(2);
    expect(saldo.fato.trecho).toContain('184.250,40');
    expect(Object.keys(saldo.fato.bbox).sort()).toEqual(['x0', 'x1', 'yMax', 'yMin']);

    const lancamento = await db.query(`
      select id from public.balancete_lancamentos
       where balancete_id = $1 and conta_codigo = '7.1.3.05.01.08110'
    `, [balanceteId]);
    const origem = await origemComoAdmin(db, 'balancete_lancamentos', lancamento.rows[0].id, 'saldo_atual');
    expect(origem.tipo).toBe('documento');
    expect(origem.fato.pagina).toBe(2);
    expect(origem.fato.trecho).toContain('64.350,75');
  }, 30000);

  it('rodar de novo não cria versão nova (mesmo sha256)', async () => {
    const chamadas = [];
    const cliente = criarClientePglite(db, { pdfBytes, chamadas });
    const detalhe = await executarBackfill({
      cliente,
      opcoes: { aplicar: true, centro: CODIGO_CENTRO, ano },
    });

    expect(detalhe.resumo.aplicados).toBe(0);
    expect(detalhe.resumo.ja_registrados).toBe(1);
    expect(chamadas).toHaveLength(1);
    expect(detalhe.centros[0].documentos[0].status).toBe('ja_registrado');
    expect(detalhe.centros[0].documentos[0].fatos_ignorados).toBe(9);

    const versoes = await db.query('select count(*)::int as n from public.documento_versoes');
    expect(versoes.rows[0].n).toBe(1);
    const fatos = await db.query('select count(*)::int as n from public.fatos');
    expect(fatos.rows[0].n).toBe(9);
  }, 30000);

  it('simulação depois de registrado avisa que os fatos seriam ignorados', async () => {
    const chamadas = [];
    const cliente = criarClientePglite(db, { pdfBytes, chamadas });
    const detalhe = await executarBackfill({
      cliente,
      opcoes: { aplicar: false, centro: CODIGO_CENTRO, ano },
    });

    expect(detalhe.centros[0].documentos[0].status).toBe('ja_registrado');
    expect(detalhe.centros[0].documentos[0].fatos_ignorados).toBe(9);
    expect(chamadas).toHaveLength(0);
  }, 30000);

  it('--centro que não acha exatamente um projeto aborta', async () => {
    const cliente = criarClientePglite(db, { pdfBytes, chamadas: [] });
    await expect(executarBackfill({
      cliente,
      opcoes: { centro: '99.NAO.EXISTE', ano },
    })).rejects.toThrow(/--centro/);
  }, 30000);
});
