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
let scrollIntoViewOriginal;

beforeEach(() => {
  getContextOriginal = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
  scrollIntoViewOriginal = Element.prototype.scrollIntoView;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = getContextOriginal;
  if (scrollIntoViewOriginal === undefined) {
    delete Element.prototype.scrollIntoView;
  } else {
    Element.prototype.scrollIntoView = scrollIntoViewOriginal;
  }
  vi.unstubAllGlobals();
  render(null, document.body);
  document.body.innerHTML = '';
});

function montarDocx({
  html,
  tipoOrigem = 'documento',
  fato = null,
  busca = null,
  valor = null,
  onResultadoBusca = null,
}) {
  return (
    <Documento
      aberto
      aoFechar={vi.fn()}
      documento={{
        id: 'docx-linha',
        formato: 'docx',
        arquivo_nome: 'plano.docx',
        bucket: 'plano-trabalho-docs',
        caminho: 'p/plano.docx',
      }}
      tipoOrigem={tipoOrigem}
      fato={fato}
      busca={busca}
      valor={valor}
      carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([80, 75]).buffer, erro: null })}
      carregadorMammoth={async () => ({
        convertToHtml: vi.fn().mockResolvedValue({ value: html }),
      })}
      onResultadoBusca={onResultadoBusca}
    />
  );
}

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
    await vi.waitFor(() => expect(document.querySelector('.documento__faixa')).not.toBeNull());

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
    const xAntes = faixa.style.getPropertyValue('--faixa-x');
    expect(xAntes).toMatch(/px$/);

    // Troca zoom para 150% -> recalcula posição da faixa.
    const seletorZoom = document.querySelector('select[aria-label="Zoom do documento"]');
    seletorZoom.value = '1.5';
    seletorZoom.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => {
      const faixaDepoisZoom = document.querySelector('.documento__faixa');
      expect(faixaDepoisZoom).not.toBeNull();
      expect(faixaDepoisZoom.style.getPropertyValue('--faixa-x')).not.toBe(xAntes);
    });

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
      'lido na página 2 (leitor pt-pdf 2.1)'
    );
    expect(document.querySelector('.documento__pagina-texto').textContent).toBe('Página 2 de 2');
    expect(document.querySelector('.documento__faixa')).not.toBeNull();
  });

  it('usa a página efetivamente aberta no critério quando fato.pagina difere da busca', async () => {
    const { pdfjs } = criarPdfMock([
      [{ str: 'Pagina 1 sem trecho', transform: [1, 0, 0, 1, 42, 700], width: 200, height: 10 }],
      [{ str: 'Trecho localizado na pagina 2', transform: [1, 0, 0, 1, 42, 650], width: 280, height: 10 }],
    ]);

    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'd2b', formato: 'pdf', arquivo_nome: 'plano.pdf', bucket: 'b', caminho: 'c' }}
        tipoOrigem="documento"
        valor={1000}
        parte="Mudança de página"
        fato={{
          pagina: 1,
          trecho: 'Trecho localizado na pagina 2',
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

    expect(document.querySelector('.documento__pagina-texto').textContent).toBe('Página 2 de 2');
    expect(document.querySelector('.documento__criterio').textContent).toBe(
      'lido na página 2 (leitor pt-pdf 2.1)'
    );
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

  it('DOCX com fato documento destaca a linha do trecho entre três células e marca o valor', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const htmlTabela =
      '<table>' +
      '<tr><td>07.1.3.04.01</td><td>BOLSA DOACAO PESQUISA</td><td>380.000,00</td></tr>' +
      '<tr><td>07.1.3.05.01</td><td>SERVICOS DE PROCESSAMENTO DE DADOS</td><td>64.350,75</td></tr>' +
      '</table>';

    render(
      montarDocx({
        html: htmlTabela,
        fato: {
          trecho: '07.1.3.05.01 SERVICOS DE PROCESSAMENTO DE DADOS 64.350,75',
          pagina: null,
          bbox: null,
        },
        valor: 64350.75,
      }),
      document.body
    );
    await tick();

    const linhas = document.querySelectorAll('.documento__docx tr.origem-linha');
    expect(linhas).toHaveLength(1);
    expect(linhas[0].textContent).toContain('07.1.3.05.01');
    const marcas = linhas[0].querySelectorAll('mark.origem-mark');
    expect(marcas).toHaveLength(1);
    expect(marcas[0].textContent).toBe('64.350,75');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(marcas[0]);
  });

  it('DOCX com fato documento sem valor na linha destaca e rola a linha mesmo sem marca', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const htmlTabela =
      '<table><tr><td>07.1.3.05.01</td><td>SERVICOS DE PROCESSAMENTO DE DADOS</td><td>64.350,75</td></tr></table>';

    render(
      montarDocx({
        html: htmlTabela,
        fato: {
          trecho: '07.1.3.05.01 SERVICOS DE PROCESSAMENTO DE DADOS',
          pagina: null,
          bbox: null,
        },
        valor: null,
      }),
      document.body
    );
    await tick();

    const linha = document.querySelector('.documento__docx tr.origem-linha');
    expect(linha).not.toBeNull();
    expect(linha.querySelector('mark.origem-mark')).toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(linha);
  });

  it('DOCX de documento com valor negativo marca a forma negativa formatada', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const htmlTabela =
      '<table><tr><td>07.1.3.05.01</td><td>CONSULTORIA</td><td>(1.234,50)</td></tr></table>';

    render(
      montarDocx({
        html: htmlTabela,
        fato: {
          trecho: '07.1.3.05.01 CONSULTORIA (1.234,50)',
          pagina: null,
          bbox: null,
        },
        valor: -1234.5,
      }),
      document.body
    );
    await tick();

    const marcas = document.querySelectorAll('.documento__docx tr.origem-linha mark.origem-mark');
    expect(marcas).toHaveLength(1);
    expect(marcas[0].textContent).toBe('(1.234,50)');
  });

  it('DOCX legado com motivo texto destaca a linha partida entre células e rola até ela', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const onResultado = vi.fn();
    const htmlTabela =
      '<table><tr><td>PESQUISA E</td><td>DESENVOLVIMENTO</td><td>380.000,00</td></tr></table>';

    render(
      montarDocx({
        html: htmlTabela,
        tipoOrigem: 'legado',
        busca: { texto: 'PESQUISA E DESENVOLVIMENTO' },
        onResultadoBusca: onResultado,
      }),
      document.body
    );
    await tick();

    const linha = document.querySelector('.documento__docx tr.origem-linha');
    expect(linha).not.toBeNull();
    expect(linha.querySelector('mark.origem-mark')).toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(linha);
    expect(onResultado).toHaveBeenCalledWith({
      achado: true,
      texto: 'achado pelo texto',
      motivo: 'texto',
    });
  });

  it('sanitizarHtmlDocx preserva a classe origem-linha', () => {
    const limpo = sanitizarHtmlDocx(
      '<table><tr class="origem-linha"><td>64.350,75</td></tr></table>'
    );
    const dom = new DOMParser().parseFromString(`<div>${limpo}</div>`, 'text/html');
    expect(dom.querySelector('tr.origem-linha')).not.toBeNull();
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
    expect(document.querySelector('.documento__criterio').textContent).toBe(
      'não foi possível ler o documento'
    );

    // Clicar em Tentar de novo dispara nova tentativa de download.
    aviso.querySelector('button').click();
    await tick();
    expect(carregarArquivo).toHaveBeenCalledTimes(2);

    // Também limpa "procurando no documento…" no erro em origem legado.
    render(null, document.body);
    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'd6', formato: 'pdf', arquivo_nome: 'leg.pdf', bucket: 'b', caminho: 'c' }}
        tipoOrigem="legado"
        busca={{ conta_codigo: '7.1.3.05' }}
        valor={100}
        carregarArquivo={vi.fn().mockResolvedValue({ dados: null, erro: 'Sem acesso.' })}
      />,
      document.body
    );
    await tick();
    expect(document.querySelector('.documento__criterio').textContent).toBe(
      'não foi possível ler o documento'
    );
  });

  it('renderiza Documento PDF com valores exatos da faixa para dpr 1 e 2 e limpa faixas imediatamente com getPage atrasado', async () => {
    for (const dpr of [1, 2]) {
      vi.stubGlobal('devicePixelRatio', dpr);
      const { pdfjs } = criarPdfMock([
        [{ str: 'Pagina 1', transform: [1, 0, 0, 1, 42, 700], width: 100, height: 10 }],
      ]);

      render(
        <Documento
          aberto
          aoFechar={vi.fn()}
          documento={{ id: `dpr-${dpr}`, formato: 'pdf', arquivo_nome: 'b.pdf', bucket: 'b', caminho: 'c' }}
          tipoOrigem="documento"
          valor={500}
          fato={{
            pagina: 1,
            trecho: 'Pagina 1',
            bbox: { x0: 40, x1: 300, yMin: 680, yMax: 700 },
            parser: 'bp',
            parser_versao: '1.0',
          }}
          carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([1, 2]).buffer, erro: null })}
          carregadorPdf={async () => pdfjs}
        />,
        document.body
      );
      await tick();

      const faixa = document.querySelector('.documento__faixa');
      expect(faixa).not.toBeNull();
      expect(faixa.style.getPropertyValue('--faixa-x')).toBe('46px');
      expect(faixa.style.getPropertyValue('--faixa-y')).toBe('124px');
      expect(faixa.style.getPropertyValue('--faixa-largura')).toBe('333px');
      expect(faixa.style.getPropertyValue('--faixa-altura')).toBe('27px');
      render(null, document.body);
    }

    vi.stubGlobal('devicePixelRatio', 1);

    // getPage(2) atrasado ao clicar em "Próxima página" deve limpar faixas imediatamente.
    let resolverPg2;
    const pag1 = {
      getViewport: ({ scale }) => ({
        width: 600 * scale,
        height: 800 * scale,
        transform: [scale, 0, 0, -scale, 0, 800 * scale],
      }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    };
    const pag2 = {
      getViewport: ({ scale }) => ({
        width: 600 * scale,
        height: 800 * scale,
        transform: [scale, 0, 0, -scale, 0, 800 * scale],
      }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    };
    const pdfjsLento = {
      Util: {
        transform: (m1, m2) => [
          m1[0] * m2[0] + m1[2] * m2[1],
          m1[1] * m2[0] + m1[3] * m2[1],
          m1[0] * m2[2] + m1[2] * m2[3],
          m1[1] * m2[2] + m1[3] * m2[3],
          m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
          m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
        ],
      },
      getDocument: vi.fn(() => ({
        promise: Promise.resolve({
          numPages: 2,
          getPage: vi.fn((n) =>
            n === 1
              ? Promise.resolve(pag1)
              : new Promise((r) => {
                  resolverPg2 = () => r(pag2);
                })
          ),
          destroy: vi.fn(),
        }),
      })),
    };

    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'lento', formato: 'pdf', arquivo_nome: 'b.pdf', bucket: 'b', caminho: 'c' }}
        tipoOrigem="documento"
        valor={500}
        fato={{ pagina: 1, trecho: 'L1', bbox: { x0: 40, x1: 300, yMin: 680, yMax: 700 }, parser: 'bp', parser_versao: '1' }}
        carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([1, 2]).buffer, erro: null })}
        carregadorPdf={async () => pdfjsLento}
      />,
      document.body
    );
    await tick();
    expect(document.querySelectorAll('.documento__faixa')).toHaveLength(1);

    // Clicar em "Próxima página" antes de getPage(2) resolver remove a faixa na hora.
    document.querySelector('button[aria-label="Próxima página"]').click();
    await tick();
    expect(document.querySelector('.documento__pagina-texto').textContent).toBe('Página 2 de 2');
    expect(document.querySelectorAll('.documento__faixa')).toHaveLength(0);

    resolverPg2();
    await tick();
    expect(document.querySelectorAll('.documento__faixa')).toHaveLength(0);
  });

  it('legado sem busca válida não chama getTextContent nem acharAlvo e abre página 1 sem faixa', async () => {
    const getTextContentMock = vi.fn().mockResolvedValue({
      items: [{ str: '0,00 saldo zerado', transform: [1, 0, 0, 1, 42, 700], width: 100, height: 10 }],
    });
    const pdfjsSemBusca = {
      Util: { transform: (m1, m2) => [1, 0, 0, 1, m2[4], m2[5]] },
      getDocument: vi.fn(() => ({
        promise: Promise.resolve({
          numPages: 2,
          getPage: vi.fn(async () => ({
            getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, transform: [scale, 0, 0, -scale, 0, 800 * scale] }),
            getTextContent: getTextContentMock,
            render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
          })),
          destroy: vi.fn(),
        }),
      })),
    };
    const onResultado = vi.fn();

    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'leg-vazio', formato: 'pdf', arquivo_nome: 'leg.pdf', bucket: 'b', caminho: 'c' }}
        tipoOrigem="legado"
        busca={{ conta_codigo: '  ', texto: '', valor: '' }}
        valor={null}
        carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([1, 2]).buffer, erro: null })}
        carregadorPdf={async () => pdfjsSemBusca}
        onResultadoBusca={onResultado}
      />,
      document.body
    );
    await tick();

    expect(getTextContentMock).not.toHaveBeenCalled();
    expect(document.querySelector('.documento__pagina-texto').textContent).toBe('Página 1 de 2');
    expect(document.querySelector('.documento__faixa')).toBeNull();
    expect(document.querySelector('.documento__criterio').textContent).toBe('não achado no documento');
    expect(onResultado).toHaveBeenCalledWith({
      achado: false,
      texto: 'não achado no documento',
      motivo: null,
    });
  });

  it('sanitiza noscript/template/sem DOMParser e exige prefixo#reduzido na mesma linha e valor vazio não vira 0 no DOCX', async () => {
    const xssNoscript = sanitizarHtmlDocx('<noscript><p title="</noscript><img src=x onerror=alert(1)>">');
    expect(xssNoscript).not.toContain('<noscript');
    expect(xssNoscript).not.toContain('onerror');
    expect(xssNoscript).not.toContain('src=');

    const extras = sanitizarHtmlDocx(
      '<p>Seguro</p><template><script>alert(1)</script></template><noembed>a</noembed><noframes>b</noframes><xmp><svg onload=alert(1)></svg></xmp><plaintext>c'
    );
    expect(extras).toContain('<p>Seguro</p>');
    expect(extras).not.toContain('<template');
    expect(extras).not.toContain('<noembed');
    expect(extras).not.toContain('<noframes');
    expect(extras).not.toContain('<xmp');
    expect(extras).not.toContain('<plaintext');

    const parserOrig = globalThis.DOMParser;
    vi.stubGlobal('DOMParser', undefined);
    expect(sanitizarHtmlDocx('<p>ola</p><script>x</script>')).toBe('');
    vi.stubGlobal('DOMParser', parserOrig);

    // prefixo#reduzido em linhas de tabela diferentes NÃO pode casar.
    const htmlLinhasSeparadas =
      '<table><tr><td>7.1.3.05</td><td>SERVICOS</td></tr><tr><td>08124</td><td>CONSULTORIA</td></tr></table>';
    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'dx-sep', formato: 'docx', arquivo_nome: 'p.docx', bucket: 'b', caminho: 'c' }}
        tipoOrigem="legado"
        busca={{ conta_codigo: '7.1.3.05#08124' }}
        valor={41549.25}
        carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([80, 75]).buffer, erro: null })}
        carregadorMammoth={async () => ({
          convertToHtml: vi.fn().mockResolvedValue({ value: htmlLinhasSeparadas }),
        })}
      />,
      document.body
    );
    await tick();
    expect(document.querySelector('.documento__criterio').textContent).toBe('não achado no documento');
    expect(document.querySelectorAll('.documento__docx mark.origem-mark')).toHaveLength(0);

    // prefixo#reduzido na MESMA tr CASA e destaca apenas naquela linha.
    render(null, document.body);
    const htmlMesmaLinha =
      '<p>7.1.3.05 fora da linha</p><table><tr><td>7.1.3.05.01</td><td>08124</td><td>CONSULTORIA</td></tr></table>';
    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'dx-ok', formato: 'docx', arquivo_nome: 'p.docx', bucket: 'b', caminho: 'c' }}
        tipoOrigem="legado"
        busca={{ conta_codigo: '7.1.3.05#08124' }}
        valor={41549.25}
        carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([80, 75]).buffer, erro: null })}
        carregadorMammoth={async () => ({
          convertToHtml: vi.fn().mockResolvedValue({ value: htmlMesmaLinha }),
        })}
      />,
      document.body
    );
    await tick();
    expect(document.querySelector('.documento__criterio').textContent).toBe('achado pelo código');
    const marcasTr = document.querySelectorAll('.documento__docx tr mark.origem-mark');
    const marcasP = document.querySelectorAll('.documento__docx p mark.origem-mark');
    expect(marcasTr.length).toBeGreaterThanOrEqual(2);
    expect(marcasP).toHaveLength(0);

    // valor: '' NÃO vira 0 e NÃO destaca 0,00 no DOCX.
    render(null, document.body);
    render(
      <Documento
        aberto
        aoFechar={vi.fn()}
        documento={{ id: 'dx-vazio', formato: 'docx', arquivo_nome: 'p.docx', bucket: 'b', caminho: 'c' }}
        tipoOrigem="legado"
        busca={{ valor: '' }}
        valor={null}
        carregarArquivo={vi.fn().mockResolvedValue({ dados: new Uint8Array([80, 75]).buffer, erro: null })}
        carregadorMammoth={async () => ({
          convertToHtml: vi.fn().mockResolvedValue({ value: '<p>Total creditos: 0,00</p>' }),
        })}
      />,
      document.body
    );
    await tick();
    expect(document.querySelector('.documento__criterio').textContent).toBe('não achado no documento');
    expect(document.querySelectorAll('.documento__docx mark.origem-mark')).toHaveLength(0);
  });
});
