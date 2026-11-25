// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  saldoLivreMock,
  situacaoCentroMock,
  repassesMock,
  balancetesMock,
  planosMock,
  pendenciasMock,
  resolverPendenciaMock,
  explicarLivreMock,
  origemMock,
  arquivoDeOrigemMock,
  termosContratoMock,
  conferirTermoContratoMock,
  usarVigenciaDoContratoMock,
} = vi.hoisted(() => ({
  saldoLivreMock: vi.fn(),
  situacaoCentroMock: vi.fn(),
  repassesMock: vi.fn(),
  balancetesMock: vi.fn(),
  planosMock: vi.fn(),
  pendenciasMock: vi.fn(),
  resolverPendenciaMock: vi.fn(),
  explicarLivreMock: vi.fn(),
  origemMock: vi.fn(),
  arquivoDeOrigemMock: vi.fn(),
  termosContratoMock: vi.fn(),
  conferirTermoContratoMock: vi.fn(),
  usarVigenciaDoContratoMock: vi.fn(),
}));

vi.mock('../src/servicos/dados.js', () => ({
  saldoLivre: saldoLivreMock,
  situacaoCentro: situacaoCentroMock,
  repasses: repassesMock,
  balancetes: balancetesMock,
  planos: planosMock,
  pendencias: pendenciasMock,
  resolverPendencia: resolverPendenciaMock,
  explicarLivre: explicarLivreMock,
  origem: origemMock,
  arquivoDeOrigem: arquivoDeOrigemMock,
  termosContrato: termosContratoMock,
  conferirTermoContrato: conferirTermoContratoMock,
  usarVigenciaDoContrato: usarVigenciaDoContratoMock,
}));

vi.mock('../src/servicos/leitoresDocumento.js', () => ({
  carregarPdfJs: vi.fn(async () => ({
    Util: { transform: (m1, m2) => [1, 0, 0, 1, m2[4], m2[5]] },
    getDocument: vi.fn(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => ({
          getViewport: ({ scale }) => ({
            width: 595 * scale,
            height: 842 * scale,
            transform: [scale, 0, 0, -scale, 0, 842 * scale],
          }),
          getTextContent: vi.fn(async () => ({ items: [] })),
          render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
        })),
        destroy: vi.fn(),
      }),
    })),
  })),
  carregarMammoth: vi.fn(async () => ({
    convertToHtml: vi.fn(async () => ({ value: '<p>Plano de trabalho</p>' })),
  })),
}));

import { Projeto } from '../src/paginas/Projeto.jsx';
import { GraficoProjecao } from '../src/componentes/GraficoProjecao.jsx';

const HOJE = '2026-11-23';
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

beforeEach(() => {
  for (const mock of [
    saldoLivreMock,
    situacaoCentroMock,
    repassesMock,
    balancetesMock,
    planosMock,
    pendenciasMock,
    resolverPendenciaMock,
    explicarLivreMock,
    origemMock,
    arquivoDeOrigemMock,
    termosContratoMock,
    conferirTermoContratoMock,
    usarVigenciaDoContratoMock,
  ]) {
    mock.mockReset();
  }
});

function configurarPadrao() {
  situacaoCentroMock.mockResolvedValue({ dados: null, erro: null });
  const saldo = {
    has_plano: true,
      has_balancete: true,
      project_id: 'p-1',
      project_name: 'Centro Fictício',
      end_date: '2027-09-30',
      data_referencia: '2026-11-17',
      compromissos_inicio: '2026-12-01',
      compromissos_fim: '2027-09-30',
      saldo_disponivel_caixa: 250000,
      rendimento_liquido: 30000,
      compromissos_bolsas: 500000,
      bolsas_ativas: Array.from({ length: 10 }, (_, indice) => ({
        scholarship_id: `b-${indice + 1}`,
        bolsista: `Bolsista ${indice + 1}`,
        valor_mensal: 5000,
        meses: 10,
        end_date: '2027-09-30',
      })),
      grupos: [
        {
          grupo_code: 'a',
          grupo_name: 'Pessoal',
          previsto: 560000,
          realizado: 0,
          compromissos: 500000,
          saldo_livre: 60000,
          compromissos_cobertura: 'bolsas',
        },
        {
          grupo_code: 'b',
          grupo_name: 'Serviços',
          previsto: 100000,
          realizado: 20000,
          compromissos: 0,
          saldo_livre: 80000,
          compromissos_cobertura: 'nenhuma',
        },
      ],
      rubricas: [
        {
          rubrica_code: 'a.bolsas',
          rubrica_name: 'Bolsas de pesquisa',
          grupo_code: 'a',
          previsto: 560000,
          realizado: 0,
          saldo: 560000,
          compromissos: 500000,
          saldo_livre: 60000,
          compromisso_tipo: 'bolsas',
        },
        {
          rubrica_code: 'b.servicos',
          rubrica_name: 'Serviços técnicos',
          grupo_code: 'b',
          previsto: 100000,
          realizado: 20000,
          saldo: 80000,
          compromissos: 0,
          saldo_livre: 80000,
          compromisso_tipo: null,
        },
        {
          rubrica_code: 'cip_ufg',
          rubrica_name: 'Custos Indiretos (CIP) — UFG',
          grupo_code: 'cip_ufg',
          previsto: 150000,
          realizado: 0,
          saldo: 150000,
          compromissos: 150000,
          saldo_livre: 0,
          compromisso_tipo: 'taxa',
        },
        {
          rubrica_code: 'dao',
          rubrica_name: 'Despesas Adm e Operacionais (DAO)',
          grupo_code: 'dao',
          previsto: 150000,
          realizado: 0,
          saldo: 150000,
          compromissos: 150000,
          saldo_livre: 0,
          compromisso_tipo: 'taxa',
        },
        {
          rubrica_code: 'outros',
          rubrica_name: 'Outras despesas',
          grupo_code: 'b',
          previsto: 1040000,
          realizado: 0,
          saldo: 1040000,
          compromissos: 0,
          saldo_livre: 1040000,
          compromisso_tipo: null,
        },
      ],
      avisos: [],
  };
  saldoLivreMock.mockResolvedValue({ dados: saldo, erro: null });

  const repasses = {
    parcelas: [
      { parcela: 1, data_prevista: '2026-01-15', data_texto: null, valor: 500000, valor_texto: null },
      { parcela: 2, data_prevista: '2026-06-15', data_texto: null, valor: 500000, valor_texto: null },
      { parcela: 3, data_prevista: '2026-10-10', data_texto: null, valor: 500000, valor_texto: null },
      { parcela: 4, data_prevista: '2027-04-10', data_texto: null, valor: 500000, valor_texto: null },
    ],
    valor_total_plano: 2000000,
    data_balancete: '2026-11-17',
    recursos: { recebido: 1000000, a_receber: 0 },
  };
  repassesMock.mockResolvedValue({ dados: repasses, erro: null });

  balancetesMock.mockResolvedValue({
    dados: [
      {
        id: 'bal-1',
        data_referencia: '2026-11-17',
        arquivo_nome: 'balancete-ficticio.pdf',
        saldo_disponivel: 250000,
        rendimento_liquido: 30000,
      },
    ],
    erro: null,
  });
  planosMock.mockResolvedValue({ dados: [], erro: null });
  pendenciasMock.mockResolvedValue({ dados: [], erro: null });
  termosContratoMock.mockResolvedValue({ dados: null, erro: null });
  explicarLivreMock.mockResolvedValue({ dados: null, erro: null });
  origemMock.mockResolvedValue({ dados: null, erro: null });
  arquivoDeOrigemMock.mockResolvedValue({ dados: null, erro: null });
  conferirTermoContratoMock.mockResolvedValue({ dados: null, erro: null });
  usarVigenciaDoContratoMock.mockResolvedValue({ dados: null, erro: null });
  return { saldo, repasses };
}

function cartaoBolsas() {
  return Array.from(document.querySelectorAll('.destaque')).find((destaque) =>
    destaque.textContent.includes('Bolsas por mês')
  );
}

describe('Projeto — projeção das bolsas na tela', () => {
  it('mostra "Cabem até" no cartão e só na linha do grupo com rubrica de bolsas', async () => {
    configurarPadrao();
    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const cartao = cartaoBolsas();
    expect(cartao).toBeTruthy();
    expect(cartao.classList.contains('destaque--clicavel')).toBe(true);
    expect(cartao.textContent).toContain('Cabem até mar/27');
    expect(cartao.textContent).toContain('abr/27 depende do desembolso 4');

    const linhas = Array.from(document.querySelectorAll('.abas__painel tbody tr'));
    const linhaPessoal = linhas.find((linha) => linha.textContent.includes('Pessoal'));
    const linhaServicos = linhas.find((linha) => linha.textContent.includes('Serviços'));
    expect(linhaPessoal.querySelector('.projeto__cabe-ate').textContent).toContain('mar/27');
    expect(linhaServicos.querySelector('.projeto__cabe-ate--vazio').textContent).toBe('—');

    const cabecalho = Array.from(document.querySelectorAll('.abas__painel th')).map(
      (th) => th.textContent
    );
    expect(cabecalho).toContain('Cabe até');
  });

  it('trocar "Rendimento" recalcula o cartão e a frase', async () => {
    configurarPadrao();
    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const cartao = cartaoBolsas();
    expect(cartao.textContent).toContain('Cabem até mar/27');
    const legenda = document.querySelector('.grafico-projecao__legenda').textContent;
    expect(legenda).toContain('falta para a folha');
    expect(legenda).toContain('mês em que falta');
    expect(document.querySelector('.grafico-projecao__tabela').textContent).toContain('145.000');

    const botaoRendimento = Array.from(
      document.querySelectorAll('.projeto__contar .chip')
    ).find((botao) => botao.textContent.includes('Rendimento'));
    expect(botaoRendimento).toBeTruthy();
    expect(botaoRendimento.getAttribute('aria-pressed')).toBe('false');

    botaoRendimento.click();
    await tick();

    const cartaoDepois = cartaoBolsas();
    expect(cartaoDepois.textContent).toContain('Cabem até set/27');
    expect(cartaoDepois.textContent).toContain('fim das bolsas cadastradas');

    const frase = document.querySelector('.projeto__projecao-frase');
    expect(frase.textContent).toContain('cabem até set/27');
    const botaoRendimentoDepois = Array.from(
      document.querySelectorAll('.projeto__contar .chip')
    ).find((botao) => botao.textContent.includes('Rendimento'));
    expect(botaoRendimentoDepois.getAttribute('aria-pressed')).toBe('true');

    const linhaPessoalDepois = Array.from(
      document.querySelectorAll('.abas__painel tbody tr')
    ).find((linha) => linha.textContent.includes('Pessoal'));
    expect(linhaPessoalDepois.querySelector('.projeto__cabe-ate').textContent).toContain(
      'set/27'
    );
    expect(document.querySelector('.grafico-projecao__tabela').textContent).toContain('175.000');
    expect(document.querySelector('.grafico-projecao__tabela').textContent).toContain('60.000');

    const legendaDepois = document.querySelector('.grafico-projecao__legenda').textContent;
    expect(legendaDepois).not.toContain('falta para a folha');
    expect(legendaDepois).not.toContain('mês em que falta');
  });

  it('mostra AvisoFalha e nenhuma data quando o saldo ou os desembolsos falham', async () => {
    configurarPadrao();
    saldoLivreMock.mockResolvedValue({ dados: null, erro: 'Falha no saldo fictício.' });

    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    expect(document.querySelector('.aviso-falha').textContent).toContain('Falha no saldo fictício.');
    expect(document.body.textContent).not.toContain('Cabem até');
    expect(document.querySelector('.projeto__projecao')).toBeNull();

    configurarPadrao();
    repassesMock.mockResolvedValue({ dados: null, erro: 'Falha nos desembolsos fictícios.' });
    render(null, document.body);
    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    expect(document.body.textContent).toContain('Falha nos desembolsos fictícios.');
    expect(document.body.textContent).not.toContain('Cabem até');
    expect(document.querySelector('.projeto__projecao')).toBeNull();
  });

  it('avisa por desembolso atrasado e diz se ele está contado', async () => {
    configurarPadrao();
    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const aviso = document.querySelector('.projeto__aviso-atrasado');
    expect(aviso).toBeTruthy();
    expect(aviso.textContent).toContain('Desembolso 3 atrasado');
    expect(aviso.textContent).toContain('500.000');
    expect(aviso.textContent).toContain('10/10/2026');
    expect(aviso.textContent).toContain('17/11/2026');
    expect(aviso.textContent).toContain('Não está contado acima.');

    const botaoAtrasado = Array.from(
      document.querySelectorAll('.projeto__contar .chip')
    ).find((botao) => botao.textContent.includes('Desembolso atrasado'));
    botaoAtrasado.click();
    await tick();

    expect(document.querySelector('.projeto__aviso-atrasado').textContent).toContain(
      'Está contado acima'
    );
  });

  it('usa o rótulo "Desembolsos" e não mostra mais "Repasses"', async () => {
    configurarPadrao();
    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    expect(document.body.textContent).not.toContain('Repasses');
    const cartao = Array.from(document.querySelectorAll('.destaque')).find((destaque) =>
      destaque.textContent.includes('Desembolsos')
    );
    expect(cartao).toBeTruthy();
  });

  it('traz no details a tabela mês a mês com os mesmos números do gráfico', async () => {
    configurarPadrao();
    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const grafico = document.querySelector('.grafico-projecao svg[role="img"]');
    expect(grafico).toBeTruthy();
    expect(grafico.getAttribute('aria-label')).toContain('A tabela abaixo traz os mesmos números');

    const detalhes = Array.from(document.querySelectorAll('details')).find(
      (item) => item.querySelector('summary')?.textContent === 'Ver mês a mês em tabela'
    );
    expect(detalhes).toBeTruthy();
    detalhes.open = true;
    await tick();

    const tabela = detalhes.querySelector('table');
    expect(tabela.textContent).toContain('dez/26');
    expect(tabela.textContent).toContain('170.000');
    expect(tabela.textContent).toContain('425.000');
    expect(tabela.textContent).toContain('\u221230.000');
    expect(tabela.textContent).toContain('60.000');
  });

  it('clicar no cartão abre a aba Dinheiro e leva o foco à seção', async () => {
    configurarPadrao();
    render(<Projeto projectId="p-1" hoje={HOJE} abaInicial="bolsas" />, document.body);
    await tick();

    const cartao = cartaoBolsas();
    cartao.click();
    await tick();
    await tick();

    const abaAtiva = document.querySelector('[role="tab"][aria-selected="true"]');
    expect(abaAtiva.textContent).toContain('Dinheiro');

    const secao = document.querySelector('.projeto__projecao');
    expect(secao).toBeTruthy();
    expect(secao.textContent).toContain('Até quando as bolsas cabem');
    expect(secao.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(secao);

    const titulo = secao.querySelector('.projeto__projecao-titulo');
    expect(titulo.id).toBeTruthy();
    expect(titulo.id).not.toBe('projecao-titulo');
    expect(secao.getAttribute('aria-labelledby')).toBe(titulo.id);
  });

  it('repete o "Cabe até" no painel "Rubricas deste grupo", na rubrica de bolsas', async () => {
    configurarPadrao();
    explicarLivreMock.mockResolvedValue({ dados: null, erro: 'Sem árvore no teste.' });
    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const linhaPessoal = Array.from(
      document.querySelectorAll('.abas__painel tbody tr')
    ).find((linha) => linha.textContent.includes('Pessoal'));
    linhaPessoal.querySelector('.tabela__gatilho').click();
    await tick();

    const painel = document.querySelector('.painel-lateral');
    expect(painel.textContent).toContain('Rubricas deste grupo');
    expect(painel.textContent).toContain('Cabe até');
    expect(painel.textContent).toContain('mar/27');
    expect(painel.textContent).toContain('abr/27 depende do desembolso 4');
  });

  it('sem balancete, mostra o motivo no lugar do gráfico e mantém a data pelo orçamento', async () => {
    const { saldo, repasses } = configurarPadrao();
    saldo.has_balancete = false;
    saldo.saldo_disponivel_caixa = null;
    saldo.rendimento_liquido = null;
    repasses.recursos = null;
    repasses.data_balancete = null;

    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const cartao = cartaoBolsas();
    expect(cartao.textContent).toContain('Cabem até set/27');
    expect(cartao.textContent).toContain('sem balancete: só o orçamento de Bolsas');

    const motivo = document.querySelector('.projeto__projecao-motivo');
    expect(motivo).toBeTruthy();
    expect(motivo.textContent).toContain('Sem balancete: a conta mostra só o orçamento de Bolsas.');
    expect(motivo.textContent).toContain('até set/27');
    expect(document.querySelector('.grafico-projecao')).toBeNull();
  });

  it('mostra a taxa em porcentagem certa no "Como a conta é feita"', async () => {
    configurarPadrao();
    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const detalhes = document.querySelector('.projeto__projecao-detalhes');
    expect(detalhes.textContent).toContain('15% =');
    expect(detalhes.textContent).toContain('300.000');
    expect(detalhes.textContent).toContain('2.000.000');
    expect(detalhes.textContent).not.toContain('0,15%');
  });

  it('mostra o "Cabe até" no painel também com a árvore do DeOndeVem', async () => {
    configurarPadrao();
    explicarLivreMock.mockResolvedValue({
      dados: {
        valor: 60000,
        motivo: null,
        data_referencia: '2026-11-17',
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
            valor: 60000,
            tipo: 'calculo',
            chave: 'grupo:a',
            conta: null,
            sinal: 1,
            ref: null,
            nota: null,
            partes: [],
          },
        ],
      },
      erro: null,
    });
    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const linhaPessoal = Array.from(
      document.querySelectorAll('.abas__painel tbody tr')
    ).find((linha) => linha.textContent.includes('Pessoal'));
    linhaPessoal.querySelector('.tabela__gatilho').click();
    await tick();

    const painel = document.querySelector('.painel-lateral');
    expect(painel.querySelector('.de-onde-vem')).toBeTruthy();
    expect(painel.querySelector('.projeto__cabe-ate-painel')).toBeTruthy();
    expect(painel.textContent).toContain('Cabe até');
    expect(painel.textContent).toContain('mar/27');
    expect(painel.textContent).toContain('abr/27 depende do desembolso 4');
  });

  it('com orçamento depois do desembolso, a frase do depende para no mês anterior ao limite', async () => {
    const { saldo, repasses } = configurarPadrao();
    saldo.saldo_disponivel_caixa = 220000;
    saldo.rendimento_liquido = 0;
    saldo.compromissos_inicio = '2026-12-01';
    saldo.compromissos_fim = '2027-09-30';
    saldo.end_date = '2027-09-30';
    saldo.compromissos_bolsas = 500000;
    saldo.rubricas = [
      {
        rubrica_code: 'a.bolsas',
        rubrica_name: 'Bolsas de pesquisa',
        grupo_code: 'a',
        previsto: 410000,
        realizado: 0,
        saldo: 410000,
        compromissos: 500000,
        saldo_livre: -90000,
        compromisso_tipo: 'bolsas',
      },
    ];
    repasses.parcelas = [
      {
        parcela: 4,
        data_prevista: '2027-04-10',
        data_texto: null,
        valor: 500000,
        valor_texto: null,
      },
    ];
    repasses.valor_total_plano = 500000;
    repasses.recursos = { recebido: 0, a_receber: 0 };

    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const frase = document.querySelector('.projeto__projecao-frase');
    expect(frase.textContent).toContain('segue até jul/27');
    expect(frase.textContent).not.toContain('segue até set/27');
    expect(cartaoBolsas().textContent).toContain('abr/27 depende do desembolso 4');
  });

  it('usa o rótulo certo no aviso de confirmar, parcial e nota emitida', async () => {
    const casos = [
      {
        parcelas: [
          {
            parcela: 1,
            data_prevista: '2026-11-20',
            data_texto: null,
            valor: 500000,
            valor_texto: null,
          },
        ],
        recursos: { recebido: 0, a_receber: 0 },
        total: 500000,
        trecho: 'venceu depois do último balancete: confirmar',
      },
      {
        parcelas: [
          {
            parcela: 1,
            data_prevista: '2026-01-15',
            data_texto: null,
            valor: 100000,
            valor_texto: null,
          },
          {
            parcela: 2,
            data_prevista: '2026-08-15',
            data_texto: null,
            valor: 100000,
            valor_texto: null,
          },
        ],
        recursos: { recebido: 150000, a_receber: 0 },
        total: 200000,
        trecho: 'entrou em parte; falta',
      },
      {
        parcelas: [
          {
            parcela: 1,
            data_prevista: '2027-01-10',
            data_texto: null,
            valor: 500000,
            valor_texto: null,
          },
        ],
        recursos: { recebido: 0, a_receber: 500000 },
        total: 500000,
        trecho: 'nota emitida, não paga',
      },
    ];

    for (const caso of casos) {
      render(null, document.body);
      const { repasses } = configurarPadrao();
      repasses.parcelas = caso.parcelas;
      repasses.recursos = caso.recursos;
      repasses.valor_total_plano = caso.total;
      render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
      await tick();
      expect(document.querySelector('.projeto__aviso-atrasado').textContent).toContain(
        caso.trecho
      );
    }

    expect(document.querySelector('.projeto__aviso-atrasado').textContent).toContain(
      '500.000'
    );
  });

  it('não projeta com dados de outro centro e deixa o cartão sem destino', async () => {
    configurarPadrao();
    render(<Projeto projectId="p-outro" hoje={HOJE} />, document.body);
    await tick();

    expect(document.body.textContent).not.toContain('Cabem até');
    expect(document.querySelector('.destaque--clicavel')).toBeNull();
    expect(document.querySelector('.projeto__projecao')).toBeNull();

    render(null, document.body);
    const { saldo, repasses } = configurarPadrao();
    saldo.project_id = 'p-2';
    repasses.project_id = 'p-1';
    render(<Projeto projectId="p-2" hoje={HOJE} />, document.body);
    await tick();

    expect(document.body.textContent).not.toContain('Cabem até');
    expect(document.querySelector('.projeto__projecao')).toBeNull();
  });

  it('explica a folha maior no primeiro mês e usa "folha de até" quando ela cai', async () => {
    const { saldo } = configurarPadrao();
    saldo.compromissos_inicio = '2026-09-01';
    saldo.compromissos_fim = '2027-01-31';
    saldo.end_date = '2027-01-31';
    saldo.saldo_disponivel_caixa = 300000;
    saldo.rendimento_liquido = 0;
    saldo.compromissos_bolsas = 230000;
    saldo.bolsas_ativas = [
      {
        scholarship_id: 'b-encerrada',
        bolsista: 'Bolsista que terminou',
        valor_mensal: 5000,
        meses: 1,
        end_date: '2026-09-30',
      },
      ...Array.from({ length: 9 }, (_, indice) => ({
        scholarship_id: `b-ativa-${indice + 1}`,
        bolsista: `Bolsista ativo ${indice + 1}`,
        valor_mensal: 5000,
        meses: 5,
        end_date: '2027-01-31',
      })),
    ];

    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const cabecalho = document.querySelector('.projeto__projecao-cabecalho').textContent;
    expect(cabecalho).toContain('folha de até');
    expect(cabecalho).toContain('50.000');
    expect(cabecalho).toContain(
      'inclui bolsa que termina antes de hoje e o balancete ainda não mostra paga'
    );
    expect(cartaoBolsas().textContent).toContain('45.000');
  });

  it('mostra a folha atrasada no 1º mês, explica a saída e não repete o aviso do banco', async () => {
    const { saldo } = configurarPadrao();
    saldo.compromissos_bolsas = 520000;
    saldo.folha_atrasada = {
      valor: 20000,
      esperado: 20000,
      visto: 0,
      desde_balancete: '2026-10-15',
      balancete: '2026-11-17',
      mes_inicio: '2026-11-01',
      mes_fim: '2026-11-01',
    };
    const avisoBanco =
      'A folha de nov/26 foi paga depois do balancete de 17/11/2026 e não aparece nele: R$ 20.000,00 somados aos compromissos de bolsas.';
    saldo.avisos = [avisoBanco];
    explicarLivreMock.mockResolvedValue({ dados: null, erro: 'Sem árvore no teste.' });

    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const ocorrencias = document.body.textContent.split(avisoBanco).length - 1;
    expect(ocorrencias).toBe(1);

    const detalhes = Array.from(document.querySelectorAll('details')).find(
      (item) => item.querySelector('summary')?.textContent === 'Ver mês a mês em tabela'
    );
    detalhes.open = true;
    await tick();

    const cabecalhoTabela = Array.from(detalhes.querySelectorAll('th')).map(
      (th) => th.textContent
    );
    expect(cabecalhoTabela).toContain('Folha atrasada (R$)');
    const indiceAtrasada = cabecalhoTabela.indexOf('Folha atrasada (R$)');
    const linhas = detalhes.querySelectorAll('tbody tr');
    const celulasPrimeira = linhas[0].querySelectorAll('td');
    const celulasSegunda = linhas[1].querySelectorAll('td');
    expect(celulasPrimeira[indiceAtrasada].textContent.trim()).toBe('20.000');
    expect(celulasSegunda[indiceAtrasada].textContent.trim()).toBe('—');

    const detalhesConta = Array.from(document.querySelectorAll('details')).find(
      (item) => item.querySelector('summary')?.textContent === 'Como a conta é feita'
    );
    const regras = detalhesConta.textContent;
    expect(regras).toContain('A folha atrasada de');
    expect(regras).toContain('20.000,00');
    expect(regras).toContain('17/11/2026');
    expect(regras).toContain('abate o orçamento de Bolsas');

    const linhaPessoal = Array.from(
      document.querySelectorAll('.abas__painel tbody tr')
    ).find((linha) => linha.textContent.includes('Pessoal'));
    linhaPessoal.querySelector('.tabela__gatilho').click();
    await tick();

    const painel = document.querySelector('.painel-lateral');
    expect(painel.textContent).toContain('Cabe até');
    const rubricaBolsas = Array.from(
      painel.querySelectorAll('.projeto__subrubricas .projeto__par-conta')
    ).find((item) => item.textContent.includes('a.bolsas'));
    expect(rubricaBolsas).toBeTruthy();
    const fraseRubrica = rubricaBolsas.querySelector('.projeto__folha-atrasada-painel');
    expect(fraseRubrica).toBeTruthy();
    expect(fraseRubrica.textContent).toContain('20.000,00');
    expect(fraseRubrica.textContent).toContain(
      'de folha que ainda não apareceu no balancete de 17/11/2026'
    );
  });

  it('sem folha atrasada, não cria a coluna nem a frase no painel', async () => {
    configurarPadrao();
    explicarLivreMock.mockResolvedValue({ dados: null, erro: 'Sem árvore no teste.' });

    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const detalhes = Array.from(document.querySelectorAll('details')).find(
      (item) => item.querySelector('summary')?.textContent === 'Ver mês a mês em tabela'
    );
    detalhes.open = true;
    await tick();
    const cabecalhoTabela = Array.from(detalhes.querySelectorAll('th')).map(
      (th) => th.textContent
    );
    expect(cabecalhoTabela).not.toContain('Folha atrasada (R$)');

    const detalhesConta = Array.from(document.querySelectorAll('details')).find(
      (item) => item.querySelector('summary')?.textContent === 'Como a conta é feita'
    );
    expect(detalhesConta.textContent).not.toContain('A folha atrasada');

    const linhaPessoal = Array.from(
      document.querySelectorAll('.abas__painel tbody tr')
    ).find((linha) => linha.textContent.includes('Pessoal'));
    linhaPessoal.querySelector('.tabela__gatilho').click();
    await tick();

    const painel = document.querySelector('.painel-lateral');
    expect(painel.textContent).not.toContain('ainda não apareceu no balancete');
  });

  it('sem bolsas ativas, o cartão e o motivo mostram a folha atrasada com centavos', async () => {
    const { saldo } = configurarPadrao();
    saldo.bolsas_ativas = [];
    saldo.compromissos_bolsas = 8000;
    saldo.folha_atrasada = {
      valor: 8000,
      esperado: 8000,
      visto: 0,
      desde_balancete: '2026-10-15',
      balancete: '2026-11-17',
      mes_inicio: '2026-11-01',
      mes_fim: '2026-11-01',
    };

    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const cartao = cartaoBolsas();
    expect(cartao.textContent).toContain('8.000,00');
    expect(cartao.textContent).toContain('folha atrasada');

    const motivo = document.querySelector('.projeto__projecao-motivo');
    expect(motivo).toBeTruthy();
    expect(motivo.textContent).toContain('8.000,00');
    expect(motivo.textContent).toContain(
      'folha atrasada que ainda vai sair do caixa'
    );
    expect(document.querySelector('.grafico-projecao')).toBeNull();
  });

  it('com desembolso antes da folha, a frase diz que a falta é da folha atrasada', async () => {
    const { saldo, repasses } = configurarPadrao();
    saldo.compromissos_inicio = '2026-12-01';
    saldo.compromissos_fim = '2026-12-31';
    saldo.end_date = '2026-12-31';
    saldo.saldo_disponivel_caixa = 5000;
    saldo.rendimento_liquido = 0;
    saldo.compromissos_bolsas = 16000;
    saldo.folha_atrasada = {
      valor: 8000,
      esperado: 8000,
      visto: 0,
      desde_balancete: '2026-10-15',
      balancete: '2026-11-17',
      mes_inicio: '2026-11-01',
      mes_fim: '2026-11-01',
    };
    saldo.bolsas_ativas = [
      {
        scholarship_id: 'b-1',
        bolsista: 'Bolsista Único',
        valor_mensal: 8000,
        meses: 1,
        end_date: '2026-12-31',
      },
    ];
    saldo.rubricas = [
      {
        rubrica_code: 'a.bolsas',
        rubrica_name: 'Bolsas de pesquisa',
        grupo_code: 'a',
        previsto: 100000,
        realizado: 0,
        saldo: 100000,
        compromissos: 16000,
        saldo_livre: 84000,
        compromisso_tipo: 'bolsas',
      },
    ];
    repasses.parcelas = [
      {
        parcela: 1,
        data_prevista: '2026-12-05',
        data_texto: null,
        valor: 30000,
        valor_texto: null,
      },
    ];
    repasses.valor_total_plano = 30000;
    repasses.recursos = { recebido: 0, a_receber: 0 };

    render(<Projeto projectId="p-1" hoje={HOJE} />, document.body);
    await tick();

    const frase = document.querySelector('.projeto__projecao-frase');
    expect(frase.textContent).toContain('3.000,00');
    expect(frase.textContent).toContain('para a folha atrasada');
    expect(frase.textContent).toContain('antes da folha');
    expect(cartaoBolsas().textContent).toContain('dez/26 depende do desembolso 1');
  });
});

describe('GraficoProjecao', () => {
  it('com 30 meses usa 56 px por mês e mostra só janeiro e julho no eixo', () => {
    const meses = Array.from({ length: 30 }, (_, indice) => {
      const ano = 2026 + Math.floor(indice / 12);
      const mes = String((indice % 12) + 1).padStart(2, '0');
      return {
        mes: `${ano}-${mes}`,
        folha: 10000,
        entra_antes: 0,
        entra_depois: 0,
        desembolsos: [],
        em_conta_apos_folha: 50000,
        em_conta_fim: 50000,
        orcamento_resta: 100000,
      };
    });

    render(<GraficoProjecao meses={meses} />, document.body);

    const svg = document.querySelector('.grafico-projecao__svg');
    // 30 meses × 56 px + margens: desenhado em pixels reais, sem escalar o texto.
    expect(svg.getAttribute('width')).toBe(String(30 * 56 + 64 + 12));
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${30 * 56 + 64 + 12} 320`);
    const rotulos = Array.from(svg.querySelectorAll('.grafico-projecao__mes')).map(
      (elemento) => elemento.textContent
    );
    expect(rotulos).toEqual(['jan/26', 'jul/26', 'jan/27', 'jul/27', 'jan/28']);
  });

  it('não mostra "falta para a folha" nem "mês em que falta" quando não há nenhum', () => {
    const meses = [
      {
        mes: '2026-12',
        folha: 10000,
        entra_antes: 0,
        entra_depois: 0,
        desembolsos: [],
        em_conta_apos_folha: 20000,
        em_conta_fim: 20000,
        orcamento_resta: 50000,
      },
    ];

    render(<GraficoProjecao meses={meses} />, document.body);

    const legenda = document.querySelector('.grafico-projecao__legenda').textContent;
    expect(legenda).not.toContain('falta para a folha');
    expect(legenda).not.toContain('mês em que falta');
  });
});
