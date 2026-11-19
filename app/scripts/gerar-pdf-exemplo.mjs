import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acharAlvo, linhasDaPagina } from '../../frontend/js/origem-busca.js';

export const NOME_PDF_EXEMPLO = 'balancete-30901-out-26.pdf';

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

  // 1: Catalog, 2: Pages (preenchidos depois que soubermos os ids das páginas)
  adicionarObjeto('');
  adicionarObjeto('');
  const idFonteNormal = adicionarObjeto(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  const idFonteNegrito = adicionarObjeto(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );

  const idsPaginas = [];
  for (const linhas of paginasLinhas) {
    const stream = construirStreamPagina(linhas);
    const bytesStream = Buffer.byteLength(stream, 'latin1');
    const idConteudo = adicionarObjeto(
      `<< /Length ${bytesStream} >>\nstream\n${stream}\nendstream`
    );
    const idPagina = adicionarObjeto(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 ${idFonteNormal} 0 R /F2 ${idFonteNegrito} 0 R >> >> ` +
        `/Contents ${idConteudo} 0 R >>`
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
  const trailer =
    `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${inicioXref}\n%%EOF\n`;

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

function definicaoPaginasExemplo() {
  const cabecalhoTabela = (y) =>
    linhaContabil(y, 'Conta', 'Reduz.', 'Descricao', 'Debitos', 'Creditos', 'Saldo Atual', true);

  const pagina1 = [
    { x: 42, y: 790, tamanho: 12, negrito: true, texto: 'BALANCETE CONTABIL ANALITICO (EXEMPLO SINTETICO)' },
    { x: 42, y: 770, tamanho: 10, texto: 'Projeto: 30.901 - Bacia do Cerrado Norte' },
    { x: 42, y: 754, tamanho: 10, texto: 'Periodo: 01/01/2025 a 15/10/2026   Emissao: 16/10/2026 09:30' },
    { x: 42, y: 730, tamanho: 9, negrito: true, texto: '1.1.1.02.02.97401  97401  30.901  10001-1 BB/FU BACIA CERRADO NORTE' },
    cabecalhoTabela(695),
    linhaContabil(670, '7.1.3.04', '09100', 'PESSOAL', '612.400,00', '0,00', '612.400,00', true),
    linhaContabil(646, '7.1.3.04.01.09142', '09142', 'BOLSA DOACAO PESQUISA', '380.000,00', '0,00', '380.000,00'),
    linhaContabil(622, '7.1.3.04.01.09145', '09145', 'BOLSA APOIO TECNICO', '160.000,00', '0,00', '160.000,00'),
    linhaContabil(598, '7.1.3.04.02.09210', '09210', 'AUXILIO COLABORADORES EXTERNOS', '72.400,00', '0,00', '72.400,00'),
    { x: 42, y: 60, tamanho: 9, texto: 'Balancete sintetico de demonstracao - Pagina 1 de 2' },
  ];

  const pagina2 = [
    { x: 42, y: 790, tamanho: 12, negrito: true, texto: 'BALANCETE CONTABIL ANALITICO - CONTINUACAO (30.901)' },
    cabecalhoTabela(752),
    linhaContabil(726, '7.1.3.05', '08100', 'SERVICOS DE TERCEIROS (PJ)', '105.900,00', '0,00', '105.900,00', true),
    linhaContabil(702, '7.1.3.05.01.08110', '08110', 'SERVICOS DE PROCESSAMENTO DE DADOS', '64.350,75', '0,00', '64.350,75'),
    linhaContabil(678, '7.1.3.05.01.08124', '08124', 'CONSULTORIA TECNICA ESPECIALIZADA', '41.549,25', '0,00', '41.549,25'),
    linhaContabil(644, '7.1.3.20', '05000', 'EQUIPAMENTOS E MATERIAL PERMANENTE', '68.000,00', '0,00', '68.000,00', true),
    linhaContabil(620, '7.1.3.20.01.05012', '05012', 'EQUIPAMENTOS DE PROCESSAMENTO DE DADOS', '68.000,00', '0,00', '68.000,00'),
    { x: 42, y: 560, tamanho: 10, negrito: true, texto: 'TOTAL DE DEBITOS: 786.300,00   TOTAL DE CREDITOS: 0,00' },
    { x: 42, y: 536, tamanho: 10, negrito: true, texto: 'SALDO DISPONIVEL EM CONTA MOVIMENTO: R$ 184.250,40.' },
    { x: 42, y: 514, tamanho: 10, texto: 'RENDIMENTO LIQUIDO APURADO: R$ 11.240,15.' },
    { x: 42, y: 60, tamanho: 9, texto: 'Balancete sintetico de demonstracao - Pagina 2 de 2' },
  ];

  return [pagina1, pagina2];
}

const ALVOS_MANIFESTO = [
  { chave: '7.1.3.04.01.09142', alvo: { conta_codigo: '7.1.3.04.01.09142', valor: 380000 } },
  { chave: '7.1.3.04.01.09145', alvo: { conta_codigo: '7.1.3.04.01.09145', valor: 160000 } },
  { chave: '7.1.3.04.02.09210', alvo: { conta_codigo: '7.1.3.04.02.09210', valor: 72400 } },
  { chave: '7.1.3.05.01.08110', alvo: { conta_codigo: '7.1.3.05.01.08110', valor: 64350.75 } },
  { chave: '7.1.3.05.01.08124', alvo: { conta_codigo: '7.1.3.05.01.08124', valor: 41549.25 } },
  { chave: '7.1.3.20.01.05012', alvo: { conta_codigo: '7.1.3.20.01.05012', valor: 68000 } },
  { chave: 'saldo_disponivel', alvo: { texto: 'SALDO DISPONIVEL EM CONTA MOVIMENTO', valor: 184250.4 } },
];

export async function gerarPdfExemploEmMemoria() {
  const bytes = montarPdfBytes(definicaoPaginasExemplo());
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const tarefa = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  });
  const doc = await tarefa.promise;

  try {
    const paginas = [];
    for (let numero = 1; numero <= doc.numPages; numero += 1) {
      const pagina = await doc.getPage(numero);
      const conteudo = await pagina.getTextContent();
      paginas.push(linhasDaPagina(conteudo.items));
    }

    const fatos = {};
    for (const item of ALVOS_MANIFESTO) {
      const achados = acharAlvo(paginas, item.alvo);
      if (!achados.length) {
        throw new Error(`Alvo não encontrado no PDF de exemplo: ${item.chave}`);
      }
      const primeiro = achados[0];
      const linha = paginas[primeiro.pagina - 1][primeiro.linha];
      fatos[item.chave] = {
        pagina: primeiro.pagina,
        linha: primeiro.linha,
        trecho: linha.texto,
        bbox: {
          x0: Number(linha.x0.toFixed(2)),
          x1: Number(linha.x1.toFixed(2)),
          yMin: Number(linha.yMin.toFixed(2)),
          yMax: Number(linha.yMax.toFixed(2)),
        },
      };
    }

    const manifesto = {
      arquivo_nome: NOME_PDF_EXEMPLO,
      paginas: doc.numPages,
      fatos,
    };

    return { bytes, manifesto };
  } finally {
    await doc.destroy();
  }
}

export async function garantirPdfExemplo(diretorioSaida) {
  const { bytes, manifesto } = await gerarPdfExemploEmMemoria();
  fs.mkdirSync(diretorioSaida, { recursive: true });
  const caminhoPdf = path.join(diretorioSaida, NOME_PDF_EXEMPLO);
  const caminhoManifesto = path.join(diretorioSaida, 'manifesto.json');
  fs.writeFileSync(caminhoPdf, bytes);
  fs.writeFileSync(caminhoManifesto, `${JSON.stringify(manifesto, null, 2)}\n`, 'utf8');
  return { caminhoPdf, caminhoManifesto, bytes, manifesto };
}

const ehPrincipal =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (ehPrincipal) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const diretorioSaida = path.resolve(__dirname, '../.exemplo');
  const resultado = await garantirPdfExemplo(diretorioSaida);
  console.log(
    `PDF de exemplo gerado em ${resultado.caminhoPdf} (${resultado.bytes.length} bytes, ${resultado.manifesto.paginas} páginas, ${Object.keys(resultado.manifesto.fatos).length} fatos).`
  );
}
