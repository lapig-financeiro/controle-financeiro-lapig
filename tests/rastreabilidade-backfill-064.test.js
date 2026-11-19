import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { linhaContabil, linhaContabilCincoColunas, montarPdfBytes } from './helpers/balancete-pdf.js';
import { docxSintetico } from './helpers/plano-sintetico.js';
import { lerDocx, lerPdf } from '../tools/rastreabilidade/documento.mjs';
import { VERSAO, executarBackfill } from '../tools/rastreabilidade/executar.mjs';

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1';
const CODIGO_CENTRO = '99.E2E';
const CODIGO_CENTRO_PLANO = '99.E2D';
const CODIGO_CENTRO_TOTAL_AMBIGUO = '99.E2T';
const CODIGO_CENTRO_TOTAL_VALOR = '99.E2V';
const CODIGO_CENTRO_REDUZIDO = '99.E2R';
const CODIGO_CENTRO_SINONIMO = '99.E2S';

function paginaTotalAmbigua() {
  return [[
    { x: 42, y: 790, tamanho: 12, negrito: true, texto: 'BALANCETE SINTETICO - TOTAL REPETE CODIGO E VALOR' },
    linhaContabil(760, '7.1.3.04.01.09142', '09142', 'BOLSA DOACAO', '380.000,00', '0,00', '380.000,00'),
    { x: 42, y: 736, tamanho: 9, negrito: true, texto: 'TOTAL DA CONTA 7.1.3.04.01.09142 BOLSA DOACAO 380.000,00' },
  ]];
}

function paginaTotalSoValor() {
  return [[
    { x: 42, y: 790, tamanho: 12, negrito: true, texto: 'BALANCETE SINTETICO - TOTAL REPETE SO O VALOR' },
    linhaContabil(760, '7.1.3.04.01.09142', '09142', 'BOLSA DOACAO', '380.000,00', '0,00', '380.000,00'),
    { x: 42, y: 736, tamanho: 9, negrito: true, texto: 'TOTAL DO PROJETO 380.000,00' },
  ]];
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

function criarClientePglite(db, { arquivos, chamadas }) {
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
               total_debitos, total_creditos, arquivo_storage_path, arquivo_nome
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
    async lerRawExtraction(balanceteId) {
      const { rows } = await db.query(
        'select raw_extraction from public.balancetes where id = $1',
        [balanceteId],
      );
      return rows.length ? rows[0].raw_extraction : null;
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
      const bytes = arquivos.get(caminho);
      if (!bytes) throw new Error(`arquivo inesperado no teste: ${bucket}`);
      return bytes;
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
  let docxBytes;
  let projetoId;
  let balanceteId;
  let planoProjetoId;
  let planoId;
  let rubricaBolsasId;
  let rubricaServicoId;
  let projetoTotalAmbiguaId;
  let balanceteTotalAmbiguaId;
  let lancamentoTotalAmbiguaId;
  let projetoTotalSoValorId;
  let balanceteTotalSoValorId;
  let lancamentoTotalSoValorId;
  let projetoReduzidoId;
  let balanceteReduzidoId;
  let lancamentoReduzidoId;
  let projetoSinonimoId;
  let planoSinonimoId;
  let rubricaUfgId;
  let rubricaUaId;
  let rubricaDaoId;
  let ano;
  const arquivos = new Map();

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
    arquivos.set(`${projetoId}/balancete.pdf`, pdfBytes);
    const lido = await lerPdf(pdfBytes);
    expect(lido.totalPaginas).toBe(2);

    // Plano em DOCX, gerado no teste — sem dado real.
    const projetoPlano = await db.query(`
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Projeto E2E Plano', $1, '2025-01-01', '2027-12-31', true)
      returning id
    `, [CODIGO_CENTRO_PLANO]);
    planoProjetoId = projetoPlano.rows[0].id;

    const plano = await db.query(`
      insert into public.planos_trabalho (
        project_id, versao, tipo, ativo, valor_total_plano, arquivo_storage_path, arquivo_nome
      ) values ($1, 1, 'original', true, 1200.00, $2, 'plano.docx')
      returning id
    `, [planoProjetoId, `${planoProjetoId}/plano.docx`]);
    planoId = plano.rows[0].id;

    const rubricaBolsas = await db.query(`
      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre)
      values ($1, 'a.bolsas', 800.00, 'Bolsas')
      returning id
    `, [planoId]);
    rubricaBolsasId = rubricaBolsas.rows[0].id;

    const rubricaServico = await db.query(`
      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre)
      values ($1, 'b', 400.00, 'Serviço sintético')
      returning id
    `, [planoId]);
    rubricaServicoId = rubricaServico.rows[0].id;

    docxBytes = docxSintetico({ total: '1.200,00', totalLabel: 'Valor total' });
    arquivos.set(`${planoProjetoId}/plano.docx`, docxBytes);
    const lidoDocx = await lerDocx(docxBytes);
    expect(lidoDocx.totalPaginas).toBeNull();
    expect(lidoDocx.paginas[0].some((linha) => linha.texto.includes('Bolsas') && linha.texto.includes('800,00'))).toBe(true);

    // Linha de total: mesmo código e valor (ambíguo) e só o valor (fato
    // na linha certa). Centros próprios para não mexer nas contagens
    // acima; o primeiro também prova o formato `{ data: { lancamentos } }`.
    const projetoTotalAmbigua = await db.query(`
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Projeto E2E Total Ambiguo', $1, '2025-01-01', '2027-12-31', true)
      returning id
    `, [CODIGO_CENTRO_TOTAL_AMBIGUO]);
    projetoTotalAmbiguaId = projetoTotalAmbigua.rows[0].id;
    const balanceteTotalAmbigua = await db.query(`
      insert into public.balancetes (
        project_id, data_referencia, arquivo_storage_path, arquivo_nome, raw_extraction
      ) values ($1, $2::date, $3, 'balancete.pdf', $4::jsonb)
      returning id
    `, [
      projetoTotalAmbigua.rows[0].id,
      `${ano}-09-15`,
      `${projetoTotalAmbigua.rows[0].id}/balancete.pdf`,
      JSON.stringify({ data: { lancamentos: [{ conta_codigo: '7.1.3.04.01.09142' }] } }),
    ]);
    balanceteTotalAmbiguaId = balanceteTotalAmbigua.rows[0].id;
    const lancamentoTotalAmbigua = await db.query(`
      insert into public.balancete_lancamentos (
        balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code
      ) values ($1, '7.1.3.04.01.09142', 'BOLSA DOACAO', 380000.00, 'a.bolsas')
      returning id
    `, [balanceteTotalAmbiguaId]);
    lancamentoTotalAmbiguaId = lancamentoTotalAmbigua.rows[0].id;
    arquivos.set(
      `${projetoTotalAmbigua.rows[0].id}/balancete.pdf`,
      montarPdfBytes(paginaTotalAmbigua()),
    );

    const projetoTotalSoValor = await db.query(`
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Projeto E2E Total So Valor', $1, '2025-01-01', '2027-12-31', true)
      returning id
    `, [CODIGO_CENTRO_TOTAL_VALOR]);
    projetoTotalSoValorId = projetoTotalSoValor.rows[0].id;
    const balanceteTotalSoValor = await db.query(`
      insert into public.balancetes (
        project_id, data_referencia, arquivo_storage_path, arquivo_nome, raw_extraction
      ) values ($1, $2::date, $3, 'balancete.pdf', $4::jsonb)
      returning id
    `, [
      projetoTotalSoValor.rows[0].id,
      `${ano}-08-15`,
      `${projetoTotalSoValor.rows[0].id}/balancete.pdf`,
      JSON.stringify({ lancamentos: [{ conta_codigo: '7.1.3.04.01.09142' }] }),
    ]);
    balanceteTotalSoValorId = balanceteTotalSoValor.rows[0].id;
    const lancamentoTotalSoValor = await db.query(`
      insert into public.balancete_lancamentos (
        balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code
      ) values ($1, '7.1.3.04.01.09142', 'BOLSA DOACAO', 380000.00, 'a.bolsas')
      returning id
    `, [balanceteTotalSoValorId]);
    lancamentoTotalSoValorId = lancamentoTotalSoValor.rows[0].id;
    arquivos.set(
      `${projetoTotalSoValor.rows[0].id}/balancete.pdf`,
      montarPdfBytes(paginaTotalSoValor()),
    );

    // Código cortado no PDF: só o reduzido do raw_extraction acha a
    // linha. As duas agregações começam pelo mesmo prefixo e têm o
    // mesmo valor; nenhuma pode virar fato.
    const projetoReduzido = await db.query(`
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Projeto E2E Reduzido', $1, '2025-01-01', '2027-12-31', true)
      returning id
    `, [CODIGO_CENTRO_REDUZIDO]);
    projetoReduzidoId = projetoReduzido.rows[0].id;
    const balanceteReduzido = await db.query(`
      insert into public.balancetes (
        project_id, data_referencia, arquivo_storage_path, arquivo_nome, raw_extraction
      ) values ($1, $2::date, $3, 'balancete.pdf', $4::jsonb)
      returning id
    `, [
      projetoReduzidoId,
      `${ano}-07-15`,
      `${projetoReduzidoId}/balancete.pdf`,
      JSON.stringify({
        lancamentos: [{
          conta_codigo: '7.1.3.02.01.00002',
          conta_reduzido: '2503002',
          conta_incompleta: false,
        }],
      }),
    ]);
    balanceteReduzidoId = balanceteReduzido.rows[0].id;
    const lancamentoReduzido = await db.query(`
      insert into public.balancete_lancamentos (
        balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code
      ) values ($1, '7.1.3.02.01.00002', 'BOLSA PESQUISA', 21496.58, 'a.bolsas')
      returning id
    `, [balanceteReduzidoId]);
    lancamentoReduzidoId = lancamentoReduzido.rows[0].id;
    const paginaReduzido = [[
      { x: 42, y: 790, tamanho: 12, negrito: true, texto: 'BALANCETE SINTETICO - CODIGO CORTADO' },
      linhaContabilCincoColunas(
        760, '7.1.3.02.01.0', '2503002', 'BOLSA PESQUISA',
        ['0,00', '21.496,58', '0,00', '21.496,58', '21.496,58'],
      ),
      linhaContabil(736, '7.1.3.02', '2521323', 'TOTAL DA CONTA', '0,00', '21.496,58', '21.496,58'),
      linhaContabil(712, '7.1.3.02.01', '25213231', 'TOTAL DA CONTA', '0,00', '21.496,58', '21.496,58'),
    ]];
    arquivos.set(`${projetoReduzidoId}/balancete.pdf`, montarPdfBytes(paginaReduzido));

    // Rubricas cujo nome no documento difere do catálogo (4ª rodada).
    const projetoSinonimo = await db.query(`
      insert into public.projects (name, code, start_date, end_date, active)
      values ('Projeto E2E Sinonimo', $1, '2025-01-01', '2027-12-31', true)
      returning id
    `, [CODIGO_CENTRO_SINONIMO]);
    projetoSinonimoId = projetoSinonimo.rows[0].id;
    const planoSinonimo = await db.query(`
      insert into public.planos_trabalho (
        project_id, versao, tipo, ativo, valor_total_plano, arquivo_storage_path, arquivo_nome
      ) values ($1, 1, 'original', true, null, $2, 'plano.docx')
      returning id
    `, [projetoSinonimoId, `${projetoSinonimoId}/plano.docx`]);
    planoSinonimoId = planoSinonimo.rows[0].id;

    const rubricaUfg = await db.query(`
      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre)
      values ($1, 'cip_ufg', 1000.00, null)
      returning id
    `, [planoSinonimoId]);
    rubricaUfgId = rubricaUfg.rows[0].id;

    const rubricaUa = await db.query(`
      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre)
      values ($1, 'cip_ua', 1000.00, null)
      returning id
    `, [planoSinonimoId]);
    rubricaUaId = rubricaUa.rows[0].id;

    const rubricaDao = await db.query(`
      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre)
      values ($1, 'dao', 600.00, null)
      returning id
    `, [planoSinonimoId]);
    rubricaDaoId = rubricaDao.rows[0].id;

    const docxSinonimo = docxSintetico({
      total: '2.600,00',
      totalLabel: 'Total geral',
      linhasExtras: [
        ['Custos indiretos para a UFG', '1.000,00'],
        ['Custos indiretos para a UA/Órgão', '1.000,00'],
        ['D.A.O da Fundação', '600,00'],
      ],
    });
    arquivos.set(`${projetoSinonimoId}/plano.docx`, docxSinonimo);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it('simulação baixa, acha 9 fatos e não chama a RPC', async () => {
    const chamadas = [];
    const cliente = criarClientePglite(db, { arquivos, chamadas });
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
    const cliente = criarClientePglite(db, { arquivos, chamadas });
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
    const cliente = criarClientePglite(db, { arquivos, chamadas });
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
    const cliente = criarClientePglite(db, { arquivos, chamadas });
    const detalhe = await executarBackfill({
      cliente,
      opcoes: { aplicar: false, centro: CODIGO_CENTRO, ano },
    });

    expect(detalhe.centros[0].documentos[0].status).toBe('ja_registrado');
    expect(detalhe.centros[0].documentos[0].fatos_ignorados).toBe(9);
    expect(chamadas).toHaveLength(0);
  }, 30000);

  it('--centro que não acha exatamente um projeto aborta', async () => {
    const cliente = criarClientePglite(db, { arquivos, chamadas: [] });
    await expect(executarBackfill({
      cliente,
      opcoes: { centro: '99.NAO.EXISTE', ano },
    })).rejects.toThrow(/--centro/);
  }, 30000);

  describe('linha de total', () => {
    it('total que repete código e valor não vira fato (ambíguo)', async () => {
      const chamadas = [];
      const cliente = criarClientePglite(db, { arquivos, chamadas });
      const detalhe = await executarBackfill({
        cliente,
        opcoes: { aplicar: true, centro: CODIGO_CENTRO_TOTAL_AMBIGUO, ano },
      });

      expect(detalhe.resumo.documentos).toBe(1);
      expect(detalhe.resumo.achados).toBe(0);
      expect(detalhe.resumo.ambiguos).toBe(1);
      expect(detalhe.resumo.sem_fatos).toBe(1);
      expect(detalhe.centros[0].documentos[0].status).toBe('sem_fatos');
      expect(chamadas).toHaveLength(0);

      const versoes = await db.query(`
        select count(*)::int as n
          from public.documento_versoes dv
          join public.documentos d on d.id = dv.documento_id
         where d.chave = $1
      `, [`balancete:${projetoTotalAmbiguaId}:${ano}-09-15`]);
      expect(versoes.rows[0].n).toBe(0);
    }, 30000);

    it('total que repete só o valor deixa o fato na linha do lançamento', async () => {
      const chamadas = [];
      const cliente = criarClientePglite(db, { arquivos, chamadas });
      const detalhe = await executarBackfill({
        cliente,
        opcoes: { aplicar: true, centro: CODIGO_CENTRO_TOTAL_VALOR, ano },
      });

      expect(detalhe.resumo.documentos).toBe(1);
      expect(detalhe.resumo.achados).toBe(1);
      expect(detalhe.resumo.ambiguos).toBe(0);
      expect(chamadas).toHaveLength(1);

      const documento = detalhe.centros[0].documentos[0];
      expect(documento.status).toBe('aplicado');
      expect(documento.fatos).toHaveLength(1);
      expect(documento.fatos[0].alvo_tabela).toBe('balancete_lancamentos');
      expect(documento.fatos[0].alvo_id).toBe(String(lancamentoTotalSoValorId));
      expect(documento.fatos[0].trecho).toContain('7.1.3.04.01.09142');
      expect(documento.fatos[0].trecho).not.toContain('TOTAL DO PROJETO');

      const origem = await origemComoAdmin(
        db,
        'balancete_lancamentos',
        lancamentoTotalSoValorId,
        'saldo_atual',
      );
      expect(origem.tipo).toBe('documento');
      expect(origem.fato.trecho).toContain('7.1.3.04.01.09142');
      expect(origem.fato.pagina).toBe(1);

      const versoes = await db.query(`
        select count(*)::int as n
          from public.documento_versoes dv
          join public.documentos d on d.id = dv.documento_id
         where d.chave = $1
      `, [`balancete:${projetoTotalSoValorId}:${ano}-08-15`]);
      expect(versoes.rows[0].n).toBe(1);
    }, 30000);
  });

  describe('código cortado no PDF (4ª rodada)', () => {
    it('acha pelo reduzido, conta por_reduzido e a 064 aceita', async () => {
      const chamadas = [];
      const cliente = criarClientePglite(db, { arquivos, chamadas });
      const detalhe = await executarBackfill({
        cliente,
        opcoes: { aplicar: true, centro: CODIGO_CENTRO_REDUZIDO, ano },
      });

      expect(detalhe.resumo.documentos).toBe(1);
      expect(detalhe.resumo.achados).toBe(1);
      expect(detalhe.resumo.por_reduzido).toBe(1);
      expect(detalhe.resumo.nao_achados).toBe(0);
      expect(detalhe.resumo.ambiguos).toBe(0);
      expect(chamadas).toHaveLength(1);

      const documento = detalhe.centros[0].documentos[0];
      expect(documento.status).toBe('aplicado');
      expect(documento.contagens.achados).toBe(1);
      expect(documento.contagens.por_reduzido).toBe(1);
      expect(documento.fatos).toHaveLength(1);
      expect(documento.fatos[0].alvo_tabela).toBe('balancete_lancamentos');
      expect(documento.fatos[0].alvo_id).toBe(String(lancamentoReduzidoId));
      expect(documento.fatos[0].trecho).toContain('2503002');
      expect(documento.fatos[0].trecho).not.toContain('2521323');
      expect(documento.fatos[0].trecho).not.toContain('25213231');

      const origem = await origemComoAdmin(
        db,
        'balancete_lancamentos',
        lancamentoReduzidoId,
        'saldo_atual',
      );
      expect(origem.tipo).toBe('documento');
      expect(origem.fato.pagina).toBe(1);
      expect(origem.fato.trecho).toContain('21.496,58');
    }, 30000);

    it('rodar de novo não cria versão nova', async () => {
      const chamadas = [];
      const cliente = criarClientePglite(db, { arquivos, chamadas });
      const detalhe = await executarBackfill({
        cliente,
        opcoes: { aplicar: true, centro: CODIGO_CENTRO_REDUZIDO, ano },
      });

      expect(detalhe.resumo.aplicados).toBe(0);
      expect(detalhe.resumo.ja_registrados).toBe(1);
      expect(detalhe.centros[0].documentos[0].status).toBe('ja_registrado');
      expect(chamadas).toHaveLength(1);

      const versoes = await db.query(`
        select count(*)::int as n
          from public.documento_versoes dv
          join public.documentos d on d.id = dv.documento_id
         where d.chave = $1
      `, [`balancete:${projetoReduzidoId}:${ano}-07-15`]);
      expect(versoes.rows[0].n).toBe(1);
    }, 30000);
  });

  describe('sinônimos de rubrica no plano (4ª rodada)', () => {
    it('cip_ufg, cip_ua e dao acham cada um a sua linha; a 064 aceita', async () => {
      const chamadas = [];
      const cliente = criarClientePglite(db, { arquivos, chamadas });
      const detalhe = await executarBackfill({
        cliente,
        opcoes: { aplicar: true, centro: CODIGO_CENTRO_SINONIMO, ano },
      });

      expect(detalhe.resumo.documentos).toBe(1);
      expect(detalhe.resumo.achados).toBe(3);
      expect(detalhe.resumo.por_reduzido).toBe(0);
      expect(detalhe.resumo.ambiguos).toBe(0);
      expect(chamadas).toHaveLength(1);

      const documento = detalhe.centros[0].documentos[0];
      expect(documento.status).toBe('aplicado');
      expect(documento.fatos).toHaveLength(3);
      expect(documento.fatos.every((fato) => fato.alvo_tabela === 'plano_rubricas')).toBe(true);

      const ufg = await origemComoAdmin(db, 'plano_rubricas', rubricaUfgId, 'valor_previsto');
      expect(ufg.tipo).toBe('documento');
      expect(ufg.fato.trecho).toContain('para a UFG');
      expect(ufg.fato.trecho).not.toContain('UA/');

      const ua = await origemComoAdmin(db, 'plano_rubricas', rubricaUaId, 'valor_previsto');
      expect(ua.tipo).toBe('documento');
      expect(ua.fato.trecho).toContain('para a UA/Órgão');

      const dao = await origemComoAdmin(db, 'plano_rubricas', rubricaDaoId, 'valor_previsto');
      expect(dao.tipo).toBe('documento');
      expect(dao.fato.trecho).toContain('D.A.O da Fundação');
      expect(dao.fato.trecho).toContain('600,00');
    }, 30000);
  });

  describe('plano em DOCX', () => {
    it('simulação passa pela saída real do lerDocx e acha 3 fatos sem RPC', async () => {
      const chamadas = [];
      const cliente = criarClientePglite(db, { arquivos, chamadas });
      const detalhe = await executarBackfill({
        cliente,
        opcoes: { aplicar: false, centro: CODIGO_CENTRO_PLANO, ano },
      });

      expect(detalhe.resumo.documentos).toBe(1);
      expect(detalhe.resumo.achados).toBe(3);
      expect(detalhe.resumo.sem_fatos).toBe(0);
      expect(chamadas).toHaveLength(0);

      const documento = detalhe.centros[0].documentos[0];
      expect(documento.tipo).toBe('plano');
      expect(documento.formato).toBe('docx');
      expect(documento.paginas).toBeNull();
      expect(documento.status).toBe('simulado');
      expect(documento.fatos.every((fato) => fato.pagina === null && fato.bbox === null)).toBe(true);
      expect(documento.fatos.every((fato) => typeof fato.trecho === 'string' && fato.trecho.length > 0)).toBe(true);
    }, 30000);

    it('aplicar é aceito pela 064 e get_origem_v2 devolve documento (pagina nula)', async () => {
      const chamadas = [];
      const cliente = criarClientePglite(db, { arquivos, chamadas });
      const detalhe = await executarBackfill({
        cliente,
        opcoes: { aplicar: true, centro: CODIGO_CENTRO_PLANO, ano },
      });

      expect(detalhe.resumo.aplicados).toBe(1);
      expect(chamadas).toHaveLength(1);

      const payload = chamadas[0];
      expect(payload.tipo).toBe('plano');
      expect(payload.formato).toBe('docx');
      expect(payload.paginas).toBeNull();
      expect(payload.fatos).toHaveLength(3);
      expect(payload.fatos.every((fato) => fato.pagina === null && fato.bbox === null)).toBe(true);

      const total = await origemComoAdmin(db, 'planos_trabalho', planoId, 'valor_total_plano');
      expect(total.tipo).toBe('documento');
      expect(total.fato.pagina).toBeNull();
      expect(total.fato.trecho).toContain('1.200,00');

      const bolsas = await origemComoAdmin(db, 'plano_rubricas', rubricaBolsasId, 'valor_previsto');
      expect(bolsas.tipo).toBe('documento');
      expect(bolsas.fato.trecho).toContain('800,00');

      const servico = await origemComoAdmin(db, 'plano_rubricas', rubricaServicoId, 'valor_previsto');
      expect(servico.tipo).toBe('documento');
      expect(servico.fato.trecho).toContain('400,00');
    }, 30000);

    it('rodar de novo no DOCX não cria versão nova', async () => {
      const chamadas = [];
      const cliente = criarClientePglite(db, { arquivos, chamadas });
      const detalhe = await executarBackfill({
        cliente,
        opcoes: { aplicar: true, centro: CODIGO_CENTRO_PLANO, ano },
      });

      expect(detalhe.resumo.aplicados).toBe(0);
      expect(detalhe.resumo.ja_registrados).toBe(1);
      expect(chamadas).toHaveLength(1);
      expect(detalhe.centros[0].documentos[0].status).toBe('ja_registrado');
      expect(detalhe.centros[0].documentos[0].fatos_ignorados).toBe(3);

      const versoes = await db.query(`
        select count(*)::int as n
          from public.documento_versoes dv
          join public.documentos d on d.id = dv.documento_id
         where d.chave = $1
      `, [`plano:${planoProjetoId}:${planoId}`]);
      expect(versoes.rows[0].n).toBe(1);
    }, 30000);
  });
});
