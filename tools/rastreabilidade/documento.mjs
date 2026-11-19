/* ============================================================
   documento.mjs
   Leitura dos arquivos do backfill: PDF (pdf.js de `mcp/`, laço
   página a página como origem-documento.js) e DOCX (mammoth +
   linkedom), mais a conferência de formato pelos primeiros bytes.

   Só texto e coordenadas aqui; nada fala com o Supabase.
   ============================================================ */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { linhasDaPagina } from '../../frontend/js/origem-busca.js';

const requireMcp = createRequire(new URL('../../mcp/package.json', import.meta.url));

export class ErroFormato extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroFormato';
    this.motivo = 'formato';
  }
}

let pdfjsPromessa = null;

/**
 * Carrega o pdf.js instalado em `mcp/node_modules`. O import imprime
 * avisos de polyfill (canvas/DOMMatrix) que não interessam ao usuário;
 * ficam suprimidos só durante o import.
 */
async function carregarPdfjs() {
  if (!pdfjsPromessa) {
    pdfjsPromessa = (async () => {
      const caminho = requireMcp.resolve('pdfjs-dist/legacy/build/pdf.js');
      const warnOriginal = console.warn;
      const logOriginal = console.log;
      const silenciarPolyfill = (original) => (...args) => {
        if (String(args[0] || '').includes('Cannot polyfill')) return;
        original(...args);
      };
      console.warn = silenciarPolyfill(warnOriginal);
      console.log = silenciarPolyfill(logOriginal);
      try {
        const modulo = await import(pathToFileURL(caminho).href);
        return modulo.default || modulo;
      } finally {
        console.warn = warnOriginal;
        console.log = logOriginal;
      }
    })().catch((erro) => {
      pdfjsPromessa = null;
      throw erro;
    });
  }
  return pdfjsPromessa;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function iniciaCom(bytes, texto) {
  if (!bytes || bytes.length < texto.length) return false;
  return Buffer.from(bytes.subarray(0, texto.length)).toString('latin1') === texto;
}

/**
 * Formato pela extensão (como a 064) conferido pelos primeiros bytes.
 * `.pdf`/`.docx` precisam casar com o conteúdo; sem extensão, os bytes
 * decidem. Balancete só aceita PDF; plano aceita PDF ou DOCX.
 */
export function detectarFormato(caminho, bytes, tipo) {
  const extensao = path.extname(String(caminho || '')).toLowerCase();
  const porExtensao = extensao === '.pdf' ? 'pdf'
    : extensao === '.docx' ? 'docx'
      : null;

  let porBytes = null;
  if (iniciaCom(bytes, '%PDF')) porBytes = 'pdf';
  else if (iniciaCom(bytes, 'PK')) porBytes = 'docx';

  if (!porBytes) {
    throw new ErroFormato('o arquivo não começa com %PDF nem com PK');
  }
  if (porExtensao && porExtensao !== porBytes) {
    throw new ErroFormato('a extensão e o conteúdo do arquivo divergem');
  }
  if (tipo === 'balancete' && porBytes !== 'pdf') {
    throw new ErroFormato('balancete exige PDF');
  }
  if (tipo === 'plano' && porBytes !== 'pdf' && porBytes !== 'docx') {
    throw new ErroFormato('plano exige PDF ou DOCX');
  }
  return porBytes;
}

/** PDF → { paginas: [[linhasDaPagina]], totalPaginas }. */
export async function lerPdf(bytes) {
  const pdfjs = await carregarPdfjs();
  const tarefa = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  });
  const documento = await tarefa.promise;

  try {
    const paginas = [];
    for (let numero = 1; numero <= documento.numPages; numero += 1) {
      const pagina = await documento.getPage(numero);
      const conteudo = await pagina.getTextContent();
      paginas.push(linhasDaPagina(conteudo.items));
    }
    return { paginas, totalPaginas: documento.numPages };
  } finally {
    await documento.destroy();
  }
}

function normalizarLinhaHtml(texto) {
  return String(texto == null ? '' : texto)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * HTML do mammoth → linhas no MESMO formato de `linhasDaPagina`
 * (`{ texto }`), que é o que `escolherLinha`/`acharAlvo` leem. Cada
 * `<tr>` é uma linha (células juntas por espaço) e cada `<p>` FORA de
 * tabela é uma linha. `<p>` dentro de `<td>` não vira linha própria:
 * ele repetiria o conteúdo da célula.
 */
export function linhasDoHtmlDocx(html) {
  const entrada = typeof html === 'string' ? html : '';
  if (!entrada.trim()) return [];

  const { document } = parseHTML(`<div id="raiz">${entrada}</div>`);
  const raiz = document.getElementById('raiz');
  if (!raiz) return [];

  const linhas = [];
  for (const elemento of raiz.querySelectorAll('tr, p')) {
    const tag = String(elemento.tagName || '').toUpperCase();
    if (tag === 'P' && elemento.closest('tr')) continue;

    let texto = '';
    if (tag === 'TR') {
      const celulas = Array.from(elemento.children)
        .filter((filho) => ['TD', 'TH'].includes(String(filho.tagName || '').toUpperCase()));
      texto = celulas.map((celula) => celula.textContent).join(' ');
    } else {
      texto = elemento.textContent;
    }

    const normalizado = normalizarLinhaHtml(texto);
    if (normalizado) linhas.push({ texto: normalizado });
  }
  return linhas;
}

/** DOCX → { paginas: [[{ texto }]], totalPaginas: null }. */
export async function lerDocx(bytes) {
  const importado = await import('mammoth');
  const mammoth = importado.default || importado;
  if (!mammoth || typeof mammoth.convertToHtml !== 'function') {
    throw new Error('mammoth não disponível para ler DOCX');
  }

  const resultado = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const html = resultado && typeof resultado.value === 'string' ? resultado.value : '';
  return { paginas: [linhasDoHtmlDocx(html)], totalPaginas: null };
}

/** Lê o arquivo já baixado, conforme o formato. */
export async function lerDocumento(bytes, formato) {
  if (formato === 'pdf') return lerPdf(bytes);
  if (formato === 'docx') return lerDocx(bytes);
  throw new ErroFormato(`formato não suportado: ${formato}`);
}
