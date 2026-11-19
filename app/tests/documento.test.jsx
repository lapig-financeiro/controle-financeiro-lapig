// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calcularRetanguloFaixa,
  Documento,
  sanitizarHtmlDocx,
} from '../src/componentes/Documento.jsx';

const tick = () => new Promise((r) => setTimeout(r, 30));

let getContextOriginal;

beforeEach(() => {
  getContextOriginal = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = getContextOriginal;
  render(null, document.body);
  document.body.innerHTML = '';
});

function criarPdfMock(paginasItens) {
  const destroyMock = vi.fn();
  const getPageMock = vi.fn((numero) => {
    const itens = paginasItens[numero - 1] || [];
    return Promise.resolve({
      getViewport: vi.fn(({ scale }) => ({
        width: 600 * scale,
        height: 800 * scale,
        transform: [scale, 0, 0, -scale, 0, 800 * scale],
      })),
      getTextContent: vi.fn().mockResolvedValue({ items: itens }),
      render: vi.fn(() => ({
        promise: Promise.resolve(),
        cancel: vi.fn(),
      })),
    });
  });

  const getDocumentMock = vi.fn(() => ({
    promise: Promise.resolve({
      numPages: paginasItens.length,
      getPage: getPageMock,
      destroy: destroyMock,
    }),
  }));

  const transformMock = (m1, m2) => [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];

  return {
    pdfjs: {
      Util: { transform: transformMock },
      getDocument: getDocumentMock,
    },
    getDocumentMock,
    getPageMock,
    destroyMock,
  };
}

describe('Documento', () => {
  it('calcula coordenadas da faixa com viewport.transform conhecido e dpr 1 e 2', () => {
    // Escala 1.5, página 800pt de altura -> transform [1.5, 0, 0, -1.5, 0, 1200]
    const viewport1 = {
      width: 900,
      height: 1200,
      transform: [1.5, 0, 0, -1.5, 0, 1200],
    };
    const ret1 = calcularRetanguloFaixa(
      { x0: 40, x1: 300, yMin: 680, yMax: 700 },
      viewport1,
      1
    );
    // topo y = (1200 - 1.5*700) - 1 = 149; altura = 1.5*20 + 2 = 32; x = 1.5*40 - 4 = 56; w = 1.5*260 + 8 = 398
    expect(ret1).toEqual({ x: 56, y: 149, width: 398, height: 32 });

    // Com dpr = 2, viewport está em escala 1.5 * 2 = 3, e os pixels CSS precisam permanecer idênticos!
    const viewport2 = {
      width: 1800,
      height: 2400,
      transform: [3, 0, 0, -3, 0, 2400],
    };
    const ret2 = calcularRetanguloFaixa(
      { x0: 40, x1: 300, yMin: 680, yMax: 700 },
      viewport2,
      2
    );
    expect(ret2).toEqual(ret1);
  });

  it('abre PDF de documento na página do fato, posiciona faixa por bbox, navega páginas e muda zoom', async () => {
    const { pdfjs, getDocumentMock, destroyMock } = criarPdfMock([
      [{ str: 'Pagina 1', transform: [1, 0, 0, 1, 42, 700], width: 100, height: 10 }],
      [{ str: '7.1.3.05.01.08110 SERVICOS 64.350,75', transform: [1, 0, 0, 1, 42, 700], width: 320, height: 10 }],
    ]);

    const doc = {
      id: 'd1',
      tipo: 'balancete',
      titulo: 'Balancete out/26',
      arquivo_nome: 'balancete.pdf',
      formato: 'pdf',
      bucket: 'balancete-pdfs',
      caminho: 'p/balancete.pdf',
    };

    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={doc}
        tipoOrigem="documento"
        valor={64350.75}
        parte="Serviços de processamento"
        fato={{
          pagina: 2,
          trecho: '7.1.3.05.01.08110 SERVICOS 64.350,75',
          bbox: { x0: 42, x1: 362, yMin: 698, yMax: 710 },
          parser: 'balancete-parser',
          parser_versao: '1.0',
        }}
        carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([37, 80, 68, 70]).buffer, erro: null })}
        carregadorPdf={async () => pdfjs}
      />,
      document.body
    );
    await tick();

    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    expect(getDocumentMock.mock.calls[0][0].isEvalSupported).toBe(false);

    // Aberto na página 2 com critério e trecho literal abaixo do valor.
    expect(document.querySelector('.documento__pagina-texto').textContent).toBe('Página 2 de 2');
    expect(document.querySelector('.documento__criterio').textContent).toBe(
      'lido na página 2 (leitor balancete-parser 1.0)'
    );
    expect(document.querySelector('.documento__trecho-lateral').textContent).toBe(
      '7.1.3.05.01.08110 SERVICOS 64.350,75'
    );

    const faixa = document.querySelector('.documento__faixa');
    expect(faixa).not.toBeNull();
    const xAntes = faixa.style.getPropertyValue('--faixa-x');
    expect(xAntes).toMatch(/px$/);

    // Troca zoom para 150% -> recalcula posição da faixa.
    const seletorZoom = document.querySelector('select[aria-label="Zoom do documento"]');
    seletorZoom.value = '1.5';
    seletorZoom.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    const faixaDepoisZoom = document.querySelector('.documento__faixa');
    expect(faixaDepoisZoom.style.getPropertyValue('--faixa-x')).not.toBe(xAntes);

    // Navega para página 1 e verifica botões desabilitados nos limites.
    const btnAnt = document.querySelector('button[aria-label="Página anterior"]');
    const btnProx = document.querySelector('button[aria-label="Próxima página"]');
    expect(btnProx.disabled).toBe(true);
    expect(btnAnt.disabled).toBe(false);

    btnAnt.click();
    await tick();
    expect(document.querySelector('.documento__pagina-texto').textContent).toBe('Página 1 de 2');
    expect(document.querySelector('.documento__faixa')).toBeNull();
    expect(btnAnt.disabled).toBe(true);
    expect(btnProx.disabled).toBe(false);

    // Desmontar destrói o PDF.
    render(null, document.body);
    expect(destroyMock).toHaveBeenCalled();
  });

  it('trata documento sem página e sem bbox procurando fato.trecho com acharAlvo', async () => {
    const { pdfjs } = criarPdfMock([
      [{ str: 'Cabecalho pagina 1', transform: [1, 0, 0, 1, 42, 700], width: 200, height: 10 }],
      [{ str: 'Linha do fato encontrado na pagina 2', transform: [1, 0, 0, 1, 42, 650], width: 280, height: 10 }],
    ]);

    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'd2', formato: 'pdf', arquivo_nome: 'plano.pdf', bucket: 'b', caminho: 'c' }}
        tipoOrigem="documento"
        valor={1000}
        parte="Parte sem bbox"
        fato={{
          pagina: null,
          trecho: 'fato encontrado na pagina 2',
          bbox: null,
          parser: 'pt-pdf',
          parser_versao: '2.1',
        }}
        carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([1, 2]).buffer, erro: null })}
        carregadorPdf={async () => pdfjs}
      />,
      document.body
    );
    await tick();

    expect(document.querySelector('.documento__criterio').textContent).toBe(
      'lido no documento (leitor pt-pdf 2.1)'
    );
    expect(document.querySelector('.documento__pagina-texto').textContent).toBe('Página 2 de 2');
    expect(document.querySelector('.documento__faixa')).not.toBeNull();
  });

  it('usa acharAlvo no legado (achado e não achado abrindo página 1 sem faixa)', async () => {
    const { pdfjs } = criarPdfMock([
      [{ str: 'Pagina 1 sem alvo', transform: [1, 0, 0, 1, 42, 700], width: 150, height: 10 }],
      [{ str: '7.1.3.05.01.08124 CONSULTORIA 41.549,25', transform: [1, 0, 0, 1, 42, 676], width: 320, height: 10 }],
    ]);
    const onResultado = vi.fn();

    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'd3', formato: 'pdf', arquivo_nome: 'legado.pdf', bucket: 'b', caminho: 'c' }}
        tipoOrigem="legado"
        busca={{ conta_codigo: '7.1.3.05.01.08124', valor: 41549.25 }}
        valor={41549.25}
        parte="Consultoria"
        carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([1, 2]).buffer, erro: null })}
        carregadorPdf={async () => pdfjs}
        onResultadoBusca={onResultado}
      />,
      document.body
    );
    await tick();

    expect(document.querySelector('.documento__pagina-texto').textContent).toBe('Página 2 de 2');
    expect(document.querySelector('.documento__criterio').textContent).toBe('achado pelo código');
    expect(document.querySelector('.documento__faixa')).not.toBeNull();
    expect(onResultado).toHaveBeenCalledWith({
      achado: true,
      texto: 'achado pelo código',
      motivo: 'codigo',
    });

    // Quando a busca falha -> abre na página 1 sem faixa e mostra "não achado no documento".
    render(null, document.body);
    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'd4', formato: 'pdf', arquivo_nome: 'legado.pdf', bucket: 'b', caminho: 'c2' }}
        tipoOrigem="legado"
        busca={{ conta_codigo: '9.9.9.99.99999', valor: 999999 }}
        valor={999999}
        parte="Inexistente"
        carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([1, 2]).buffer, erro: null })}
        carregadorPdf={async () => pdfjs}
      />,
      document.body
    );
    await tick();

    expect(document.querySelector('.documento__pagina-texto').textContent).toBe('Página 1 de 2');
    expect(document.querySelector('.documento__criterio').textContent).toBe('não achado no documento');
    expect(document.querySelector('.documento__faixa')).toBeNull();
  });

  it('carrega DOCX com mammoth simulado, sanitiza HTML inseguro e destaca termos com origem-mark', async () => {
    const htmlInseguro =
      '<p>Bolsas de pesquisa: R$ 780.000,00</p>' +
      '<script>window.__xss = true;</script>' +
      '<a href="javascript:alert(1)" onclick="alert(2)">Link</a>';

    const sujo = sanitizarHtmlDocx(htmlInseguro);
    expect(sujo).not.toContain('<script');
    expect(sujo).not.toContain('onclick');
    expect(sujo).not.toContain('javascript:');

    const convertToHtml = vi.fn().mockResolvedValue({ value: htmlInseguro });

    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{
          id: 'doc-docx',
          formato: 'docx',
          arquivo_nome: 'plano.docx',
          bucket: 'plano-trabalho-docs',
          caminho: 'p/plano.docx',
        }}
        tipoOrigem="legado"
        busca={{ texto: 'Bolsas de pesquisa', valor: 780000 }}
        valor={780000}
        parte="Bolsas de pesquisa"
        carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([80, 75]).buffer, erro: null })}
        carregadorMammoth={async () => ({ convertToHtml })}
      />,
      document.body
    );
    await tick();

    expect(convertToHtml).toHaveBeenCalledTimes(1);
    const docxWrap = document.querySelector('.documento__docx');
    expect(docxWrap).not.toBeNull();
    expect(docxWrap.querySelector('script')).toBeNull();
    expect(docxWrap.querySelector('a').getAttribute('href')).toBeNull();
    expect(docxWrap.querySelector('a').getAttribute('onclick')).toBeNull();

    const marcas = docxWrap.querySelectorAll('mark.origem-mark');
    expect(marcas.length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.documento__criterio').textContent).toBe('achado pelo valor');
  });

  it('exibe estado de carregamento e erro de download como AvisoFalha com Tentar de novo', async () => {
    let resolverDownload;
    const carregarArquivo = vi.fn(
      () =>
        new Promise((r) => {
          resolverDownload = r;
        })
    );

    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'd5', formato: 'pdf', arquivo_nome: 'x.pdf', bucket: 'b', caminho: 'c' }}
        valor={100}
        carregarArquivo={carregarArquivo}
      />,
      document.body
    );
    await tick();

    expect(document.querySelector('.documento__visao [role="status"]')).not.toBeNull();

    resolverDownload({ dados: null, erro: 'Falha ao baixar o arquivo de origem.' });
    await tick();

    const aviso = document.querySelector('.documento__visao .aviso-falha');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('Falha ao baixar o arquivo de origem.');

    // Clicar em Tentar de novo dispara nova tentativa de download.
    aviso.querySelector('button').click();
    await tick();
    expect(carregarArquivo).toHaveBeenCalledTimes(2);
  });
});
