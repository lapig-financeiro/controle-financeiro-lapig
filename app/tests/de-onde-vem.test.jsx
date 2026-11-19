// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeOndeVem, verificarFechamentoArvore } from '../src/componentes/DeOndeVem.jsx';

const tick = () => new Promise((r) => setTimeout(r, 25));

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

function criarPdfjsSimulado(paginasTexto = [['7.1.3.05.01.08124 CONSULTORIA 41.549,25']]) {
  const paginas = paginasTexto.map((linhas) => ({
    getViewport: ({ scale }) => ({
      width: 595 * scale,
      height: 842 * scale,
      transform: [scale, 0, 0, -scale, 0, 842 * scale],
    }),
    getTextContent: vi.fn().mockResolvedValue({
      items: linhas.map((str, idx) => ({
        str,
        transform: [1, 0, 0, 1, 42, 700 - idx * 24],
        width: 300,
        height: 10,
      })),
    }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  }));

  return {
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
        numPages: paginas.length,
        getPage: vi.fn((n) => Promise.resolve(paginas[n - 1])),
        destroy: vi.fn(),
      }),
    })),
  };
}

const ARVORE_COMPLETA = {
  valor: 400,
  motivo: null,
  data_referencia: '2026-10-15',
  rotulo: 'Livre para gastar',
  tipo: 'calculo',
  conta: 'soma dos grupos',
  chave: 'livre',
  sinal: 1,
  ref: null,
  nota: null,
  partes: [
    {
      rotulo: 'Pessoal',
      valor: 450,
      tipo: 'calculo',
      chave: 'grupo:a',
      conta: 'previsto − realizado − comprometido',
      sinal: 1,
      ref: null,
      nota: null,
      partes: [
        {
          rotulo: 'Previsto — Bolsas',
          valor: 1000,
          tipo: 'legado',
          chave: 'rubrica:a:previsto',
          conta: null,
          sinal: 1,
          ref: null,
          nota: null,
          partes: [],
        },
        {
          rotulo: 'Realizado — Bolsas',
          valor: 450,
          tipo: 'calculo',
          chave: 'rubrica:a:realizado',
          conta: 'soma dos lançamentos',
          sinal: -1,
          ref: null,
          nota: null,
          partes: [
            {
              rotulo: '7.1.3.04.01.09142 — Bolsa pesquisa',
              valor: 500,
              tipo: 'documento',
              chave: 'linha:bl-1',
              conta: null,
              sinal: 1,
              ref: { alvo_tabela: 'balancete_lancamentos', alvo_id: 'bl-1', campo: 'saldo_atual' },
              nota: null,
              partes: [],
            },
            {
              rotulo: '7.1.3.04.99.00001 — Estorno',
              valor: -50,
              tipo: 'legado',
              chave: 'linha:bl-2',
              conta: null,
              sinal: 1,
              ref: { alvo_tabela: 'balancete_lancamentos', alvo_id: 'bl-2', campo: 'saldo_atual' },
              nota: null,
              partes: [],
            },
          ],
        },
        {
          rotulo: 'Comprometido — Bolsista A — 1 mês × R$ 100',
          valor: 100,
          tipo: 'digitado',
          chave: 'linha:b-1',
          conta: null,
          sinal: -1,
          ref: { alvo_tabela: 'scholarships', alvo_id: 'b-1', campo: 'amount' },
          nota: null,
          partes: [],
        },
      ],
    },
    {
      rotulo: 'Equipamentos',
      valor: -50,
      tipo: 'calculo',
      chave: 'grupo:f',
      conta: 'previsto − realizado',
      sinal: 1,
      ref: null,
      nota: 'compromissos fora de bolsas não são rastreados',
      partes: [
        {
          rotulo: 'Previsto — Equipamentos',
          valor: 100,
          tipo: 'legado',
          chave: 'rubrica:f:previsto',
          conta: null,
          sinal: 1,
          ref: null,
          nota: null,
          partes: [],
        },
        {
          rotulo: 'Realizado — Equipamentos',
          valor: 150,
          tipo: 'legado',
          chave: 'rubrica:f:realizado',
          conta: null,
          sinal: -1,
          ref: { alvo_tabela: 'balancete_lancamentos', alvo_id: 'bl-legado', campo: 'saldo_atual' },
          nota: null,
          partes: [],
        },
      ],
    },
  ],
};

describe('DeOndeVem', () => {
  it('renderiza os quatro tipos, sinal de subtração, problema só em raiz/grupo negativo e alterna aria-expanded', async () => {
    render(<DeOndeVem arvore={ARVORE_COMPLETA} />, document.body);
    await tick();

    // Primeiro nível aberto mostra os dois grupos.
    expect(document.body.textContent).toContain('Pessoal');
    expect(document.body.textContent).toContain('Equipamentos');
    expect(document.body.textContent).toContain('previsto − realizado − comprometido');
    expect(document.body.textContent).toContain('compromissos fora de bolsas não são rastreados');

    // Grupo negativo tem classe valor--problema.
    const botoesToggle = Array.from(document.querySelectorAll('.de-onde-vem__alternar'));
    expect(botoesToggle).toHaveLength(2);
    expect(botoesToggle[0].getAttribute('aria-expanded')).toBe('false');

    // Expande Pessoal -> vê Previsto (legado sem ref), Realizado (subtrai), Comprometido (digitado, subtrai).
    botoesToggle[0].click();
    await tick();
    expect(botoesToggle[0].getAttribute('aria-expanded')).toBe('true');

    const sinais = Array.from(document.querySelectorAll('.de-onde-vem__sinal'));
    expect(sinais.length).toBeGreaterThanOrEqual(2);
    expect(sinais[0].getAttribute('aria-label')).toBe('subtrai');

    // Folha sem ref ("Previsto — Bolsas") não é botão, e é marcada como legado sem arquivo.
    const itemPrevisto = Array.from(document.querySelectorAll('.de-onde-vem__rotulo'))
      .find((el) => el.textContent.includes('Previsto — Bolsas'))
      .closest('.de-onde-vem__item');
    expect(itemPrevisto.querySelector('button.valor--origem')).toBeNull();
    expect(itemPrevisto.textContent).toContain('anterior à rastreabilidade, sem arquivo');

    // Folha digitado mostra "valor digitado, sem documento".
    expect(document.body.textContent).toContain('valor digitado, sem documento');

    // Expande Realizado — Bolsas e verifica que folha negativa (-50 estorno) NÃO recebe valor--problema.
    const btnRealizado = Array.from(document.querySelectorAll('.de-onde-vem__alternar')).find((b) =>
      b.getAttribute('aria-label').includes('Realizado — Bolsas')
    );
    btnRealizado.click();
    await tick();

    const itemEstorno = Array.from(document.querySelectorAll('.de-onde-vem__rotulo'))
      .find((el) => el.textContent.includes('Estorno'))
      .closest('.de-onde-vem__item');
    expect(itemEstorno.querySelector('.valor--problema')).toBeNull();

    // Grupo negativo Equipamentos TEM valor--problema; subtração positiva Realizado NÃO tem.
    const problemas = Array.from(document.querySelectorAll('.valor--problema'));
    expect(problemas).toHaveLength(1);
    expect(problemas[0].textContent).toContain('50,00');
  });

  it('abre ancestrais automaticamente e exibe AvisoFalha quando algum nó não fecha ou diverge do esperado', async () => {
    const arvoreQuebrada = structuredClone(ARVORE_COMPLETA);
    // Estraga o nó aninhado "Realizado — Bolsas" (500 + (-50) = 450, mas declaramos 999).
    arvoreQuebrada.partes[0].partes[1].valor = 999;

    const { falhas, caminhosAbrir } = verificarFechamentoArvore(arvoreQuebrada, 400);
    expect(falhas.size).toBeGreaterThanOrEqual(2);
    expect(caminhosAbrir.has('0/0')).toBe(true);
    expect(caminhosAbrir.has('0/0/1')).toBe(true);

    render(<DeOndeVem arvore={arvoreQuebrada} valorEsperado={399} />, document.body);
    await tick();

    // Ancestral Pessoal (0/0) e nó Realizado — Bolsas (0/0/1) abriram sozinhos.
    const togglePessoal = document.querySelector('button[aria-label*="Pessoal"]');
    expect(togglePessoal.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.textContent).toContain('Estorno');

    const avisos = document.querySelectorAll('.aviso-falha');
    expect(avisos.length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).toContain('difere do valor do painel');
  });

  it('chama origem ao clicar em folha, abre Documento para arquivo, exibe nota no painel sem arquivo e trata falha/carregamento', async () => {
    let resolverDigitado;
    const buscarOrigem = vi.fn((ref) => {
      if (ref.alvo_id === 'b-1') {
        return new Promise((r) => {
          resolverDigitado = r;
        });
      }
      if (ref.alvo_id === 'bl-1') {
        return Promise.resolve({
          dados: {
            tipo: 'documento',
            valor: 500,
            documento: {
              id: 'doc-1',
              tipo: 'balancete',
              titulo: 'Balancete out/26',
              arquivo_nome: 'balancete.pdf',
              formato: 'pdf',
              bucket: 'balancete-pdfs',
              caminho: 'p/balancete.pdf',
            },
            fato: {
              pagina: 1,
              trecho: '7.1.3.04.01.09142 BOLSA 500,00',
              bbox: { x0: 40, x1: 300, yMin: 680, yMax: 695 },
              parser: 'balancete-parser',
              parser_versao: '1.0',
            },
            busca: null,
            nota: null,
          },
          erro: null,
        });
      }
      if (ref.alvo_id === 'bl-legado') {
        return Promise.resolve({
          dados: {
            tipo: 'legado',
            valor: 150,
            documento: {
              id: 'doc-2',
              tipo: 'balancete',
              titulo: 'Balancete antigo',
              arquivo_nome: 'balancete-antigo.pdf',
              formato: 'pdf',
              bucket: 'balancete-pdfs',
              caminho: 'p/antigo.pdf',
            },
            fato: null,
            busca: { conta_codigo: '7.1.3.05.01.08124', valor: 41549.25 },
            nota: null,
          },
          erro: null,
        });
      }
      return Promise.resolve({ dados: null, erro: 'Falha ao consultar origem.' });
    });

    const carregarArquivo = vi.fn().mockResolvedValue({
      dados: new Uint8Array([1, 2, 3]).buffer,
      erro: null,
    });
    const pdfjsMock = criarPdfjsSimulado([['7.1.3.05.01.08124 CONSULTORIA 41.549,25']]);

    // Estado carregando mostra esqueleto.
    render(<DeOndeVem carregando />, document.body);
    expect(document.querySelector('[role="status"]')).not.toBeNull();

    render(null, document.body);
    render(
      <DeOndeVem
        arvore={ARVORE_COMPLETA}
        buscarOrigem={buscarOrigem}
        carregarArquivo={carregarArquivo}
        carregadorPdf={async () => pdfjsMock}
      />,
      document.body
    );
    await tick();

    // Expande Pessoal e clica na folha digitado b-1.
    document.querySelector('button[aria-label*="Pessoal"]').click();
    await tick();

    const btnBolsa = document.querySelector('button[aria-label*="Bolsista A"]');
    btnBolsa.click();
    await tick();

    // Enquanto aguarda, mostra status de carregamento na folha.
    expect(document.querySelector('.de-onde-vem__status-folha').textContent).toContain(
      'Consultando origem'
    );

    // Resolve digitado sem documento -> mostra nota no painel e NÃO abre Documento.
    resolverDigitado({
      dados: {
        tipo: 'digitado',
        valor: 100,
        documento: null,
        fato: null,
        busca: null,
        nota: 'Valor do cadastro de bolsas até a F3.',
      },
      erro: null,
    });
    await tick();

    expect(buscarOrigem).toHaveBeenCalledWith({
      alvo_tabela: 'scholarships',
      alvo_id: 'b-1',
      campo: 'amount',
    });
    expect(document.querySelector('.documento')).toBeNull();
    expect(document.querySelector('.de-onde-vem__nota-folha').textContent).toContain(
      'Valor do cadastro de bolsas até a F3.'
    );

    // Expande Equipamentos -> legado com ref mostra texto "a linha é procurada ao abrir", clica -> abre Documento e atualiza status.
    document.querySelector('button[aria-label*="Equipamentos"]').click();
    await tick();
    const itemLegado = Array.from(document.querySelectorAll('.de-onde-vem__rotulo'))
      .find((el) => el.textContent.includes('Realizado — Equipamentos'))
      .closest('.de-onde-vem__item');
    expect(itemLegado.textContent).toContain('anterior à rastreabilidade: a linha é procurada ao abrir');

    itemLegado.querySelector('button.valor--origem').click();
    await tick();
    await tick();

    expect(document.querySelector('.documento')).not.toBeNull();
    expect(itemLegado.textContent).toContain('achado pelo código');

    // Fecha Documento e testa erro ao clicar em bl-2.
    document.querySelector('.documento__fechar').click();
    await tick();

    document.querySelector('button[aria-label*="Realizado — Bolsas"]').click();
    await tick();
    const btnEstorno = document.querySelector('button[aria-label*="Estorno"]');
    btnEstorno.click();
    await tick();

    expect(document.querySelector('.documento')).toBeNull();
    expect(document.querySelector('.de-onde-vem__aviso-no .aviso-falha').textContent).toContain(
      'Falha ao consultar origem.'
    );
  });
});
