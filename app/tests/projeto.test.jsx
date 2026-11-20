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
          getViewport: ({ scale }) => ({ width: 595 * scale, height: 842 * scale, transform: [scale, 0, 0, -scale, 0, 842 * scale] }),
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

const tick = () => new Promise((r) => setTimeout(r, 25));

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

beforeEach(() => {
  saldoLivreMock.mockReset();
  situacaoCentroMock.mockReset();
  repassesMock.mockReset();
  balancetesMock.mockReset();
  planosMock.mockReset();
  pendenciasMock.mockReset();
  resolverPendenciaMock.mockReset();
  explicarLivreMock.mockReset();
  origemMock.mockReset();
  arquivoDeOrigemMock.mockReset();
  termosContratoMock.mockReset();
  conferirTermoContratoMock.mockReset();
  usarVigenciaDoContratoMock.mockReset();
});

function configurarPadrao({
  grupos = [
    {
      grupo_code: 'a',
      grupo_name: 'Pessoal',
      previsto: 800000,
      realizado: 600000,
      compromissos: 140000,
      saldo_livre: 60000,
      compromissos_cobertura: 'bolsas',
    },
    {
      grupo_code: 'b',
      grupo_name: 'Serviços',
      previsto: 100000,
      realizado: 75700,
      compromissos: 0,
      saldo_livre: 24300,
      compromissos_cobertura: 'nenhuma',
    },
  ],
  bolsas = [
    { scholarship_id: 'b1', bolsista: 'Bolsista 1', valor_mensal: 6000, end_date: '2027-08-31' },
    { scholarship_id: 'b2', bolsista: 'Bolsista 2', valor_mensal: 4000, end_date: '2027-06-30' },
    { scholarship_id: 'b3', bolsista: 'Bolsista Encerrada', valor_mensal: 3500, end_date: '2026-10-31' },
  ],
  avisos = [],
} = {}) {
  // Sem a RPC nova (produção antes da 069), a página fica na regra de hoje.
  situacaoCentroMock.mockResolvedValue({ dados: null, erro: null });
  saldoLivreMock.mockResolvedValue({
    dados: {
      has_plano: true,
      has_balancete: true,
      project_id: 'p-1',
      project_name: 'Bacia do Cerrado',
      end_date: '2027-08-31',
      data_referencia: '2026-10-15',
      bolsas_ativas: bolsas,
      grupos,
      rubricas: [],
      avisos,
    },
    erro: null,
  });

  repassesMock.mockResolvedValue({
    dados: {
      parcelas: [
        { parcela: 1, data_prevista: '2026-01-15', data_texto: null, valor: 250000, valor_texto: null },
        { parcela: 2, data_prevista: '2026-06-15', data_texto: null, valor: 250000, valor_texto: null },
        { parcela: 3, data_prevista: '2027-01-20', data_texto: null, valor: 250000, valor_texto: null },
      ],
      valor_total_plano: 750000,
      data_balancete: '2026-10-15',
      recursos: { recebido: 500000, a_receber: 0 },
    },
    erro: null,
  });

  balancetesMock.mockResolvedValue({
    dados: [
      { id: 'bal-1', data_referencia: '2026-10-15', arquivo_nome: 'balancete-out.pdf' },
    ],
    erro: null,
  });

  planosMock.mockResolvedValue({
    dados: [
      { id: 'pl-2', versao: 2, ativo: true, data_documento: '2026-06-10', arquivo_nome: 'plano-v2.docx' },
      { id: 'pl-1', versao: 1, ativo: false, data_documento: '2025-11-01', arquivo_nome: 'plano-v1.docx' },
    ],
    erro: null,
  });

  pendenciasMock.mockResolvedValue({
    dados: [
      {
        id: 'pend-1',
        project_id: 'p-1',
        code: '30.901',
        tipo: 'balancete',
        titulo: 'Conta sem rubrica vinculada',
        detalhe: { conta: '7.1.3.99' },
        situacao: 'aberta',
        origem: 'sistema',
        criada_em: '2026-11-18T17:00:00Z',
      },
    ],
    erro: null,
  });

  explicarLivreMock.mockResolvedValue({
    dados: {
      valor: 84300,
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
          valor: 60000,
          tipo: 'calculo',
          chave: 'grupo:a',
          conta: 'previsto − realizado − comprometido',
          sinal: 1,
          ref: null,
          nota: null,
          partes: [
            {
              rotulo: 'Previsto — Bolsas',
              valor: 800000,
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
              valor: 600000,
              tipo: 'documento',
              chave: 'rubrica:a:realizado',
              conta: null,
              sinal: -1,
              ref: { alvo_tabela: 'balancete_lancamentos', alvo_id: 'bl-1', campo: 'saldo_atual' },
              nota: null,
              partes: [],
            },
            {
              rotulo: 'Comprometido — Bolsas',
              valor: 140000,
              tipo: 'digitado',
              chave: 'rubrica:a:comprometido',
              conta: null,
              sinal: -1,
              ref: { alvo_tabela: 'scholarships', alvo_id: 'b1', campo: 'amount' },
              nota: null,
              partes: [],
            },
          ],
        },
        {
          rotulo: 'Serviços',
          valor: 24300,
          tipo: 'calculo',
          chave: 'grupo:b',
          conta: 'previsto − realizado',
          sinal: 1,
          ref: null,
          nota: 'compromissos fora de bolsas não são rastreados',
          partes: [
            {
              rotulo: 'Previsto — Serviços',
              valor: 100000,
              tipo: 'legado',
              chave: 'rubrica:b:previsto',
              conta: null,
              sinal: 1,
              ref: null,
              nota: null,
              partes: [],
            },
            {
              rotulo: 'Realizado — Serviços',
              valor: 75700,
              tipo: 'legado',
              chave: 'rubrica:b:realizado',
              conta: null,
              sinal: -1,
              ref: null,
              nota: null,
              partes: [],
            },
          ],
        },
      ],
    },
    erro: null,
  });

  termosContratoMock.mockResolvedValue({
    dados: {
      termos: {},
      start_date_cadastro: null,
      end_date_cadastro: null,
      vigencia_situacao: 'sem_contrato',
      vigencia_confere: null,
    },
    erro: null,
  });
  conferirTermoContratoMock.mockResolvedValue({
    dados: { id: 'termo-1', conferido_em: '2026-11-18T17:00:00Z', ja_estava: false },
    erro: null,
  });
  usarVigenciaDoContratoMock.mockResolvedValue({
    dados: {
      project_id: 'p-1',
      antes: { start_date: null, end_date: '2027-08-31' },
      depois: { start_date: null, end_date: '2027-08-31' },
      mudou: false,
    },
    erro: null,
  });

  origemMock.mockResolvedValue({ dados: null, erro: 'Não configurado no teste.' });
  arquivoDeOrigemMock.mockResolvedValue({ dados: new Uint8Array([37, 80, 68, 70]).buffer, erro: null });
}

describe('página do Projeto', () => {
  it('usa o livre do resumo sem recalcular, soma partes no painel, filtra bolsas ativas e exibe Drive só para admin', async () => {
    configurarPadrao({ avisos: ['Balancete defasado: última referência de out/26.'] });
    render(
      <Projeto
        projectId="p-1"
        hoje="2026-11-18"
        isAdmin
        resumoCentro={{
          id: 'p-1',
          code: '30.901',
          name: 'Bacia do Cerrado',
          end_date: '2027-08-31',
          drive_folder_url: 'https://drive.google.com/drive/folders/teste',
          livre: 84300,
          situacao: 'em dia',
          data_referencia: '2026-10-15',
        }}
      />,
      document.body
    );
    await tick();

    const destaques = Array.from(document.querySelectorAll('.destaque'));
    expect(destaques[0].textContent).toContain('84.300');
    expect(destaques[0].textContent).toContain('balancete de out/26');

    // Bolsas por mês soma só end_date >= 2026-11-18 (6000 + 4000 = 10.000; ignora 3500 encerrada).
    expect(destaques[2].textContent).toContain('10.000');
    expect(destaques[2].textContent).toContain('2 bolsistas ativos');

    // Repasses via situacaoDasParcelas: 2 recebidas de 3, próxima em jan/27.
    expect(destaques[3].textContent).toContain('2 de 3');
    expect(destaques[3].textContent).toContain('próximo em jan/27');

    // Aviso vindo da RPC é exibido no topo da aba Dinheiro.
    expect(document.querySelector('.abas__painel .aviso-falha').textContent).toContain(
      'Balancete defasado'
    );

    // Botão Pasta no Drive visível para admin com URL.
    const linkDrive = Array.from(document.querySelectorAll('a.botao')).find((a) =>
      a.textContent.includes('Pasta no Drive')
    );
    expect(linkDrive).toBeTruthy();
    expect(linkDrive.getAttribute('href')).toBe('https://drive.google.com/drive/folders/teste');

    // Aba Bolsas lista todas as bolsas (inclusive encerrada com marcação "encerrada em out/26").
    const abaBolsas = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
      t.textContent.includes('Bolsas')
    );
    abaBolsas.click();
    await tick();
    expect(abaBolsas.textContent).toContain('3');
    expect(document.querySelector('.abas__painel').textContent).toContain('Bolsista Encerrada');
    expect(document.querySelector('.abas__painel').textContent).toContain('encerrada em out/26');

    // Abre painel "De onde vem este valor" (árvore DeOndeVem) ao clicar no destaque principal.
    destaques[0].querySelector('button.valor--origem').click();
    await tick();
    const painel = document.querySelector('.painel-lateral');
    expect(painel.textContent).toContain('De onde vem este valor');
    expect(painel.textContent).toContain('84.300,00');
    expect(painel.textContent).toContain('Pessoal');
    expect(painel.textContent).toContain('Serviços');
    expect(painel.querySelector('.aviso-falha')).toBeNull();
    document.querySelector('.painel-lateral__fechar').click();
    await tick();

    // Aba Dinheiro: clicar na linha de grupo abre DeOndeVem no nó do grupo.
    Array.from(document.querySelectorAll('[role="tab"]'))
      .find((t) => t.textContent.includes('Dinheiro'))
      .click();
    await tick();
    document.querySelector('.abas__painel .tabela__gatilho').click();
    await tick();
    const painelGrupo = document.querySelector('.painel-lateral');
    expect(painelGrupo.textContent).toContain('Pessoal');
    expect(painelGrupo.textContent).toContain('60.000,00');
    expect(painelGrupo.textContent).toContain('Realizado — Bolsas');
  });

  it('oculta Pasta no Drive para professor mesmo com URL preenchida e acusa divergência na árvore DeOndeVem', async () => {
    configurarPadrao({
      grupos: [
        {
          grupo_code: 'a',
          grupo_name: 'Pessoal',
          previsto: 500000,
          realizado: 400000,
          compromissos: 50000,
          saldo_livre: 50000,
          compromissos_cobertura: 'bolsas',
        },
      ],
    });
    explicarLivreMock.mockResolvedValue({
      dados: {
        valor: 50000,
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
            valor: 50000,
            tipo: 'calculo',
            chave: 'grupo:a',
            conta: 'previsto − realizado − comprometido',
            sinal: 1,
            ref: null,
            nota: null,
            partes: [],
          },
        ],
      },
      erro: null,
    });

    render(
      <Projeto
        projectId="p-1"
        hoje="2026-11-18"
        isAdmin={false}
        resumoCentro={{
          id: 'p-1',
          code: '30.901',
          name: 'Bacia do Cerrado',
          end_date: '2027-08-31',
          drive_folder_url: 'https://drive.google.com/drive/folders/nao-deve-aparecer',
          livre: 84300,
          situacao: 'em dia',
          data_referencia: '2026-10-15',
        }}
      />,
      document.body
    );
    await tick();

    expect(document.body.textContent).not.toContain('Pasta no Drive');

    const destaquePrincipal = document.querySelector('.destaque--principal');
    destaquePrincipal.querySelector('button.valor--origem').click();
    await tick();

    const painel = document.querySelector('.painel-lateral');
    expect(painel.querySelector('.aviso-falha')).not.toBeNull();
    expect(painel.textContent).toContain('50.000,00');
  });

  it('descarta resposta atrasada ao trocar rapidamente de projeto (corrida entre promessas)', async () => {
    let resolverSaldoA;
    saldoLivreMock.mockImplementation((id) => {
      if (id === 'p-A') {
        return new Promise((r) => {
          resolverSaldoA = r;
        });
      }
      return Promise.resolve({
        dados: {
          has_plano: true,
          has_balancete: true,
          project_id: 'p-B',
          project_name: 'Projeto B',
          end_date: '2027-10-31',
          data_referencia: '2026-10-15',
          bolsas_ativas: [{ scholarship_id: 'bB', bolsista: 'Bolsista B', valor_mensal: 7000, end_date: '2027-10-31' }],
          grupos: [{ grupo_code: 'a', grupo_name: 'Pessoal', previsto: 100000, realizado: 50000, compromissos: 0, saldo_livre: 50000, compromissos_cobertura: 'bolsas' }],
          rubricas: [],
          avisos: [],
        },
        erro: null,
      });
    });
    repassesMock.mockResolvedValue({ dados: { parcelas: [], valor_total_plano: null, data_balancete: null, recursos: null }, erro: null });
    balancetesMock.mockResolvedValue({ dados: [], erro: null });
    planosMock.mockResolvedValue({ dados: [], erro: null });
    pendenciasMock.mockResolvedValue({ dados: [], erro: null });

    render(
      <Projeto
        projectId="p-A"
        hoje="2026-11-18"
        resumoCentro={{ id: 'p-A', code: '30.901', name: 'Projeto A', livre: 10000, situacao: 'em dia' }}
      />,
      document.body
    );

    render(
      <Projeto
        projectId="p-B"
        hoje="2026-11-18"
        resumoCentro={{ id: 'p-B', code: '30.902', name: 'Projeto B', livre: 50000, situacao: 'em dia' }}
      />,
      document.body
    );
    await tick();

    expect(document.querySelector('h1').textContent).toContain('Projeto B');
    expect(document.querySelectorAll('.destaque')[2].textContent).toContain('7.000');

    // Resposta atrasada de p-A chega depois e NÃO pode sobrescrever p-B.
    resolverSaldoA({
      dados: {
        has_plano: true,
        has_balancete: true,
        project_id: 'p-A',
        project_name: 'Projeto A',
        bolsas_ativas: [{ scholarship_id: 'bA', bolsista: 'Bolsista A', valor_mensal: 1111, end_date: '2027-10-31' }],
        grupos: [],
        rubricas: [],
        avisos: [],
      },
      erro: null,
    });
    await tick();

    expect(document.querySelector('h1').textContent).toContain('Projeto B');
    expect(document.querySelectorAll('.destaque')[2].textContent).toContain('7.000');
    expect(document.querySelectorAll('.destaque')[2].textContent).not.toContain('1.111');
  });

  it('nunca converte nulo em zero em bolsas/grupos/recursos, separa bolsa sem data e prioriza parcela a conferir', async () => {
    configurarPadrao({
      grupos: [
        { grupo_code: 'a', grupo_name: 'Pessoal', previsto: 100000, realizado: 40000, compromissos: 0, saldo_livre: 60000, compromissos_cobertura: 'bolsas' },
        { grupo_code: 'b', grupo_name: 'Serviços', previsto: 50000, realizado: 20000, compromissos: 0, saldo_livre: null, compromissos_cobertura: 'nenhuma' },
      ],
      bolsas: [
        { scholarship_id: 'b1', bolsista: 'Sem Valor', valor_mensal: null, end_date: '2027-08-31' },
        { scholarship_id: 'b2', bolsista: 'Sem Data', valor_mensal: 4000, end_date: null },
      ],
    });
    repassesMock.mockResolvedValue({
      dados: {
        parcelas: [
          { parcela: 1, data_prevista: '2026-01-15', data_texto: null, valor: 100000, valor_texto: null },
          { parcela: 2, data_prevista: '2026-08-15', data_texto: null, valor: 100000, valor_texto: null },
          { parcela: 3, data_prevista: '2027-02-15', data_texto: null, valor: 100000, valor_texto: null },
        ],
        valor_total_plano: 300000,
        data_balancete: '2026-10-15',
        recursos: { recebido: 150000, a_receber: 0 },
      },
      erro: null,
    });

    render(
      <Projeto
        projectId="p-1"
        hoje="2026-11-18"
        resumoCentro={{
          id: 'p-1',
          code: '30.901',
          name: 'Centro Nulo',
          end_date: 'data-invalida',
          livre: 60000,
          situacao: 'em dia',
          data_referencia: '2026-10-15',
        }}
      />,
      document.body
    );
    await tick();

    // Sem "faltam null meses" para end_date inválida.
    const cabecalhoContexto = document.querySelector('.cabecalho-pagina__contexto').textContent;
    expect(cabecalhoContexto).not.toContain('null');

    // Bolsa vigente com valor_mensal null -> "—" e "valor incompleto" (não zero).
    const destaques = Array.from(document.querySelectorAll('.destaque'));
    expect(destaques[2].textContent).toContain('—');
    expect(destaques[2].textContent).toContain('valor incompleto');

    // Parcela 2 é parcial (150k recebido para 100k + 100k): "1 parcela parcial" tem prioridade sobre "próximo em fev/27".
    expect(destaques[3].textContent).toContain('1 de 3');
    expect(destaques[3].textContent).toContain('1 parcela parcial');
    expect(destaques[3].textContent).not.toContain('próximo em fev/27');

    // Aba Dinheiro: grupo com saldo_livre null quando has_balancete=true mostra situação e título "sem dado".
    const linhasGrupos = Array.from(document.querySelectorAll('.abas__painel tbody tr'));
    const linhaServicos = linhasGrupos.find((tr) => tr.textContent.includes('Serviços'));
    expect(linhaServicos.querySelector('.situacao').textContent).toBe('sem dado');
    expect(linhaServicos.querySelector('.valor[title="sem dado"]')).not.toBeNull();

    explicarLivreMock.mockResolvedValue({
      dados: {
        valor: 60000,
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
            valor: 60000,
            tipo: 'calculo',
            chave: 'grupo:a',
            conta: null,
            sinal: 1,
            ref: null,
            nota: null,
            partes: [],
          },
          {
            rotulo: 'Serviços',
            valor: null,
            tipo: 'calculo',
            chave: 'grupo:b',
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

    // Painel acusa nó sem valor válido na árvore DeOndeVem.
    destaques[0].querySelector('button.valor--origem').click();
    await tick();
    const painel = document.querySelector('.painel-lateral');
    expect(painel.querySelector('.aviso-falha').textContent).toContain('sem valor válido');
    document.querySelector('.painel-lateral__fechar').click();
    await tick();

    // Aba Bolsas exibe aviso e seção de bolsa sem data (não marcada como encerrada).
    Array.from(document.querySelectorAll('[role="tab"]')).find((t) => t.textContent.includes('Bolsas')).click();
    await tick();
    const painelBolsas = document.querySelector('.abas__painel');
    expect(painelBolsas.textContent).toContain('Bolsas sem data de término');
    expect(painelBolsas.textContent).toContain('Sem Data');
    expect(painelBolsas.textContent).not.toContain('encerrada em');

    // Recursos com recebido: null -> "sem dados de recurso".
    repassesMock.mockResolvedValueOnce({
      dados: {
        parcelas: [{ parcela: 1, data_prevista: '2026-01-15', data_texto: null, valor: 100000, valor_texto: null }],
        valor_total_plano: 100000,
        data_balancete: '2026-10-15',
        recursos: { recebido: null },
      },
      erro: null,
    });
    render(null, document.body);
    render(
      <Projeto
        projectId="p-rec"
        hoje="2026-11-18"
        resumoCentro={{ id: 'p-rec', code: '30.999', name: 'Rec Nulo', livre: 10, situacao: 'em dia' }}
      />,
      document.body
    );
    await tick();
    const repSemDado = Array.from(document.querySelectorAll('.destaque'))[3];
    expect(repSemDado.textContent).toContain('—');
    expect(repSemDado.textContent).toContain('sem dados de recurso');
  });

  it('mostra Vazio específico quando centro está oculto pelo filtro de visão', async () => {
    const mostrarCentro = vi.fn().mockResolvedValue({ erro: null });
    render(
      <Projeto
        projectId="p-oculto"
        centroOculto
        centroOcultoInfo={{ id: 'p-oculto', code: '30.907', name: 'Corredor Oculto' }}
        onMostrarEsteCentro={mostrarCentro}
      />,
      document.body
    );
    await tick();

    expect(saldoLivreMock).not.toHaveBeenCalled();
    expect(document.querySelector('h1').textContent).toBe('Corredor Oculto · 30.907');
    expect(document.querySelector('.vazio').textContent).toContain(
      'Este centro está oculto pelo seu filtro de visão.'
    );
    const btn = document.querySelector('.vazio button');
    expect(btn.textContent).toBe('Mostrar este centro');
    btn.click();
    expect(mostrarCentro).toHaveBeenCalledTimes(1);
  });

  it('trata centro sem plano e centro sem balancete sem mostrar zeros', async () => {
    saldoLivreMock.mockResolvedValue({
      dados: {
        has_plano: false,
        has_balancete: true,
        project_id: 'p-sem-plano',
        project_name: 'Inventário Sem Plano',
        message: 'Sem plano ativo.',
      },
      erro: null,
    });
    repassesMock.mockResolvedValue({
      dados: { parcelas: [], valor_total_plano: null, data_balancete: '2026-10-10', recursos: { recebido: 0 } },
      erro: null,
    });
    balancetesMock.mockResolvedValue({ dados: [], erro: null });
    planosMock.mockResolvedValue({ dados: [], erro: null });
    pendenciasMock.mockResolvedValue({ dados: [], erro: null });

    render(
      <Projeto
        projectId="p-sem-plano"
        hoje="2026-11-18"
        resumoCentro={{
          id: 'p-sem-plano',
          code: '30.905',
          name: 'Inventário Sem Plano',
          end_date: '2027-09-30',
          livre: null,
          situacao: 'sem plano',
          data_referencia: '2026-10-10',
        }}
      />,
      document.body
    );
    await tick();

    const destaques = Array.from(document.querySelectorAll('.destaque'));
    expect(destaques[0].textContent).toContain('—');
    expect(destaques[0].textContent).toContain('sem plano');
    expect(destaques[1].textContent).toContain('—');
    expect(destaques[1].textContent).toContain('sem balancete');
    expect(destaques[2].textContent).toContain('—');
    expect(destaques[2].textContent).toContain('sem plano');
    expect(destaques[2].textContent).not.toContain('0 bolsas');
    expect(document.querySelector('.abas__painel .vazio').textContent).toContain('não tem plano de trabalho ativo');

    saldoLivreMock.mockResolvedValue({
      dados: {
        has_plano: true,
        has_balancete: false,
        project_id: 'p-sem-bal',
        project_name: 'Veredas Sem Balancete',
        end_date: '2027-12-31',
        bolsas_ativas: [],
        grupos: [
          {
            grupo_code: 'a',
            grupo_name: 'Pessoal',
            previsto: 300000,
            realizado: 0,
            compromissos: 0,
            saldo_livre: 300000,
            compromissos_cobertura: 'bolsas',
          },
        ],
        rubricas: [],
        avisos: ['Sem balancete importado: realizado igual a zero.'],
      },
      erro: null,
    });
    repassesMock.mockResolvedValue({
      dados: {
        parcelas: [{ parcela: 1, data_prevista: '2027-02-01', data_texto: null, valor: 150000, valor_texto: null }],
        valor_total_plano: 300000,
        data_balancete: null,
        recursos: null,
      },
      erro: null,
    });

    render(null, document.body);
    render(
      <Projeto
        projectId="p-sem-bal"
        hoje="2026-11-18"
        resumoCentro={{
          id: 'p-sem-bal',
          code: '30.904',
          name: 'Veredas Sem Balancete',
          end_date: '2027-12-31',
          livre: null,
          situacao: 'sem balancete',
          data_referencia: null,
        }}
      />,
      document.body
    );
    await tick();

    const destaquesSemBal = Array.from(document.querySelectorAll('.destaque'));
    expect(destaquesSemBal[0].textContent).toContain('—');
    expect(destaquesSemBal[0].textContent).toContain('sem balancete');
    expect(destaquesSemBal[0].querySelector('button.valor--origem')).toBeNull();
    expect(destaquesSemBal[3].textContent).toContain('—');
    expect(destaquesSemBal[3].textContent).toContain('sem balancete');
    expect(destaquesSemBal[3].textContent).not.toContain('0 de 1');

    // Centro com plano e balancete mas sem números: destaque fica — e não abre árvore.
    saldoLivreMock.mockResolvedValue({
      dados: {
        has_plano: true,
        has_balancete: true,
        project_id: 'p-sem-num',
        project_name: 'Centro Sem Números',
        end_date: '2027-12-31',
        bolsas_ativas: [],
        grupos: [],
        rubricas: [],
        avisos: [],
      },
      erro: null,
    });
    render(null, document.body);
    render(
      <Projeto
        projectId="p-sem-num"
        hoje="2026-11-18"
        resumoCentro={{
          id: 'p-sem-num',
          code: '30.910',
          name: 'Centro Sem Números',
          end_date: '2027-12-31',
          livre: null,
          situacao: 'sem números',
          data_referencia: '2026-10-15',
        }}
      />,
      document.body
    );
    await tick();

    const destaqueSemNum = document.querySelector('.destaque--principal');
    expect(destaqueSemNum.textContent).toContain('—');
    expect(destaqueSemNum.textContent).toContain('sem números');
    expect(destaqueSemNum.querySelector('button.valor--origem')).toBeNull();
    expect(explicarLivreMock).not.toHaveBeenCalled();
  });

  it('abre na aba pendencias, confirma inline sem window.confirm e trata erro parcial em Documentos', async () => {
    configurarPadrao();
    balancetesMock.mockResolvedValue({ dados: null, erro: 'Falha ao carregar balancetes.' });
    planosMock.mockResolvedValue({ dados: [], erro: null });
    resolverPendenciaMock.mockResolvedValue({ dados: { id: 'pend-1', situacao: 'resolvida' }, erro: null });
    const confirmOriginal = window.confirm;
    const confirmSpy = vi.fn();
    window.confirm = confirmSpy;
    const aoMudarPendencias = vi.fn();

    try {
      render(
        <Projeto
          projectId="p-1"
          abaInicial="pendencias"
          hoje="2026-11-18"
          onMudarPendencias={aoMudarPendencias}
          resumoCentro={{
            id: 'p-1',
            code: '30.901',
            name: 'Bacia do Cerrado',
            end_date: '2027-08-31',
            livre: 84300,
            situacao: 'em dia',
            data_referencia: '2026-10-15',
          }}
        />,
        document.body
      );
      await tick();

      expect(document.body.textContent).toContain('Conta sem rubrica vinculada');
      const btnResolvida = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Resolvida'
      );
      btnResolvida.click();
      await tick();

      expect(document.body.textContent).toContain('Confirmar que esta pendência foi resolvida?');
      const btnConfirmar = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Confirmar'
      );
      btnConfirmar.click();
      await tick();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(resolverPendenciaMock).toHaveBeenCalledWith('pend-1', 'resolvida');
      expect(aoMudarPendencias).toHaveBeenCalledTimes(1);

      const abaDocs = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
        t.textContent.includes('Documentos')
      );
      // Com erro parcial nos balancetes, contagem da aba é "—" e Vazio não aparece.
      expect(abaDocs.querySelector('.abas__contagem').textContent).toBe('—');
      abaDocs.click();
      await tick();

      const painelDocs = document.querySelector('.abas__painel');
      expect(painelDocs.querySelector('.aviso-falha').textContent).toContain('Falha ao carregar balancetes.');
      expect(painelDocs.querySelector('.vazio')).toBeNull();
    } finally {
      window.confirm = confirmOriginal;
    }
  });

  it('mostra carregamento, usa o painel por grupo como fallback quando explicarLivre falha e recarrega com Tentar de novo', async () => {
    configurarPadrao({
      grupos: [
        {
          grupo_code: 'a',
          grupo_name: 'Pessoal',
          previsto: 800000,
          realizado: 600000,
          compromissos: 140000,
          saldo_livre: 60000,
          compromissos_cobertura: 'bolsas',
        },
        {
          grupo_code: 'b',
          grupo_name: 'Serviços',
          previsto: 100000,
          realizado: 75700,
          compromissos: 0,
          saldo_livre: null,
          compromissos_cobertura: 'nenhuma',
        },
      ],
    });

    let resolverExplicar;
    explicarLivreMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolverExplicar = r;
        })
    );

    render(
      <Projeto
        projectId="p-1"
        hoje="2026-11-18"
        resumoCentro={{
          id: 'p-1',
          code: '30.901',
          name: 'Bacia do Cerrado',
          end_date: '2027-08-31',
          livre: 84300,
          situacao: 'em dia',
          data_referencia: '2026-10-15',
        }}
      />,
      document.body
    );
    await tick();

    // Clica no destaque principal -> exibe esqueleto enquanto explicarLivre carrega.
    document.querySelector('.destaque--principal button.valor--origem').click();
    await tick();
    const painel = document.querySelector('.painel-lateral');
    expect(painel.querySelector('[role="status"]')).not.toBeNull();

    // Quando explicarLivre falha (ex. 064 ainda não no ar) -> AvisoFalha + painel de grupos reserva.
    resolverExplicar({ dados: null, erro: 'Função explicar_livre_v2 indisponível.' });
    await tick();
    expect(painel.querySelector('.aviso-falha').textContent).toContain('indisponível');
    expect(painel.querySelector('.projeto__par--total').textContent).toContain('—');
    expect(painel.textContent).toContain('Pessoal');

    // Fecha e clica na linha do grupo Pessoal -> também exibe AvisoFalha + detalhe reserva do grupo.
    document.querySelector('.painel-lateral__fechar').click();
    await tick();
    document.querySelector('.abas__painel .tabela__gatilho').click();
    await tick();
    const painelGrupo = document.querySelector('.painel-lateral');
    expect(painelGrupo.querySelector('.aviso-falha').textContent).toContain('indisponível');
    expect(painelGrupo.textContent).toContain('Compromissos de bolsas incluídos até o fim da vigência.');

    // "Tentar de novo" recarrega explicarLivre e substitui pelo DeOndeVem quando responder.
    explicarLivreMock.mockResolvedValueOnce({
      dados: {
        valor: 84300,
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
            valor: 60000,
            tipo: 'calculo',
            chave: 'grupo:a',
            conta: 'previsto − realizado − comprometido',
            sinal: 1,
            ref: null,
            nota: null,
            partes: [],
          },
        ],
      },
      erro: null,
    });
    painelGrupo.querySelector('.aviso-falha button').click();
    await tick();
    expect(painelGrupo.querySelector('.de-onde-vem')).not.toBeNull();
  });

  it('aba Documentos abre balancete e plano preservando o id do banco na chamada de origem', async () => {
    configurarPadrao();
    origemMock
      .mockResolvedValueOnce({
        dados: {
          tipo: 'documento',
          valor: 184250.4,
          documento: {
            id: 'doc-bal',
            tipo: 'balancete',
            titulo: 'Balancete out',
            arquivo_nome: 'balancete-out.pdf',
            formato: 'pdf',
            bucket: 'balancete-pdfs',
            caminho: 'p-1/balancete-out.pdf',
          },
          fato: { pagina: 1, trecho: 'SALDO DISPONIVEL: 184.250,40', bbox: null, parser: 'bp', parser_versao: '1' },
          busca: null,
          nota: null,
        },
        erro: null,
      })
      .mockResolvedValueOnce({
        dados: {
          tipo: 'legado',
          valor: 750000,
          documento: null,
          fato: null,
          busca: null,
          nota: 'Plano sem arquivo disponível para visualização.',
        },
        erro: null,
      });

    render(
      <Projeto
        projectId="p-1"
        abaInicial="documentos"
        hoje="2026-11-18"
        resumoCentro={{
          id: 'p-1',
          code: '30.901',
          name: 'Bacia do Cerrado',
          end_date: '2027-08-31',
          livre: 84300,
          situacao: 'em dia',
          data_referencia: '2026-10-15',
        }}
      />,
      document.body
    );
    await tick();

    const botoesDocs = Array.from(document.querySelectorAll('.abas__painel .tabela__gatilho'));
    expect(botoesDocs).toHaveLength(3);

    // Ordem mais recente primeiro: bal-1 (2026-10-15), pl-2 (2026-06-10), pl-1 (2025-11-01).
    botoesDocs[0].click();
    await tick();
    expect(origemMock).toHaveBeenNthCalledWith(1, {
      alvo_tabela: 'balancetes',
      alvo_id: 'bal-1',
      campo: 'saldo_disponivel',
    });
    expect(document.querySelector('.documento')).not.toBeNull();

    document.querySelector('.documento__fechar').click();
    await tick();

    botoesDocs[1].click();
    await tick();
    expect(origemMock).toHaveBeenNthCalledWith(2, {
      alvo_tabela: 'planos_trabalho',
      alvo_id: 'pl-2',
      campo: 'valor_total_plano',
    });
    expect(document.querySelector('.documento')).toBeNull();
    expect(document.querySelector('.abas__painel .aviso-falha')).toBeNull();
    expect(document.querySelector('.abas__painel .projeto__nota-discreta').textContent).toContain(
      'Plano sem arquivo disponível'
    );
  });

  it('2ª rodada: rejeições com catch, a_receber ausente, Destaque sem grupos, árvore sem partes, grupo ausente e centavos no reserva', async () => {
    // Item 7: a_receber ausente não vira 0 e não classifica parcela como nota_emitida/parcial.
    configurarPadrao({ grupos: [] });
    repassesMock.mockResolvedValueOnce({
      dados: {
        parcelas: [
          { parcela: 1, data_prevista: '2026-01-15', data_texto: null, valor: 100000, valor_texto: null },
          { parcela: 2, data_prevista: '2026-06-15', data_texto: null, valor: 100000, valor_texto: null },
        ],
        valor_total_plano: 200000,
        data_balancete: '2026-10-15',
        recursos: { recebido: 150000 },
      },
      erro: null,
    });

    render(
      <Projeto
        projectId="p-rec-sem-ar"
        hoje="2026-11-18"
        resumoCentro={{ id: 'p-rec-sem-ar', code: '30.911', name: 'Sem a_receber', livre: 50000, situacao: 'em dia' }}
      />,
      document.body
    );
    await tick();

    const destaquesSemAr = Array.from(document.querySelectorAll('.destaque'));
    expect(destaquesSemAr[3].textContent).toContain('—');
    expect(destaquesSemAr[3].textContent).toContain('sem dados de recurso');
    expect(destaquesSemAr[3].textContent).not.toContain('parcial');
    expect(destaquesSemAr[3].textContent).not.toContain('nota');

    // Item 5a (clicabilidade): com resumoCentro.livre finito mas grupos=[], Destaque NÃO abre árvore.
    expect(destaquesSemAr[0].querySelector('button.valor--origem')).toBeNull();

    // Itens 3 & 10: rejeições com try/catch + comparação em centavos (diferença de 0,01 acusa divergência).
    render(null, document.body);
    configurarPadrao({
      grupos: [
        { grupo_code: 'a', grupo_name: 'Pessoal', previsto: 200, realizado: 100, compromissos: 0, saldo_livre: 100.01, compromissos_cobertura: 'bolsas' },
      ],
    });
    explicarLivreMock.mockRejectedValueOnce(new Error('rede caiu'));
    origemMock.mockRejectedValueOnce(new Error('erro inesperado'));

    render(
      <Projeto
        projectId="p-r2"
        hoje="2026-11-18"
        resumoCentro={{ id: 'p-r2', code: '30.912', name: 'Projeto R2', livre: 100.0, situacao: 'em dia' }}
      />,
      document.body
    );
    await tick();

    document.querySelector('.destaque--principal button.valor--origem').click();
    await tick();
    const painel = document.querySelector('.painel-lateral');
    expect(painel.querySelector('[role="status"]')).toBeNull();
    const avisosReserva = painel.querySelectorAll('.aviso-falha');
    // 1º AvisoFalha do erro em explicarLivre + 2º AvisoFalha da divergência exata de R$ 0,01!
    expect(avisosReserva.length).toBeGreaterThanOrEqual(2);
    expect(painel.textContent).toContain('difere do valor exibido');

    // Item 5a (árvore vazia enquanto resumo tem número -> mostra motivo + fallback por grupo, não Vazio)
    // e Item 5b (grupo ausente da árvore -> nota neutra + reserva sem AvisoFalha e sem Tentar de novo).
    explicarLivreMock.mockResolvedValueOnce({
      dados: {
        valor: 100,
        motivo: null,
        data_referencia: '2026-10-15',
        rotulo: 'Livre para gastar',
        tipo: 'calculo',
        conta: null,
        chave: 'livre',
        sinal: 1,
        ref: null,
        nota: null,
        partes: [],
      },
      erro: null,
    });
    painel.querySelector('.aviso-falha button').click();
    await tick();
    expect(painel.querySelector('.vazio')).toBeNull();
    expect(painel.querySelector('.projeto__nota-discreta').textContent).toContain('sem partes');
    expect(painel.textContent).toContain('Pessoal');

    // Fecha e clica na linha do grupo Pessoal (ausente de partes: []): nota neutra, sem AvisoFalha e sem "Tentar de novo".
    document.querySelector('.painel-lateral__fechar').click();
    await tick();
    document.querySelector('.abas__painel .tabela__gatilho').click();
    await tick();
    const painelGrupoAusente = document.querySelector('.painel-lateral');
    expect(painelGrupoAusente.querySelector('.aviso-falha')).toBeNull();
    expect(painelGrupoAusente.textContent).not.toContain('Tentar de novo');
    expect(painelGrupoAusente.querySelector('.projeto__nota-discreta').textContent).toContain(
      'não está disponível'
    );
    expect(painelGrupoAusente.textContent).toContain('Previsto');

    // Item 3 (abrirDocumentoDaAba rejeitado via try/catch -> libera carregando e mostra AvisoFalha).
    document.querySelector('.painel-lateral__fechar').click();
    await tick();
    Array.from(document.querySelectorAll('[role="tab"]')).find((t) => t.textContent.includes('Documentos')).click();
    await tick();
    document.querySelector('.abas__painel .tabela__gatilho').click();
    await tick();
    expect(document.querySelector('.abas__painel [role="status"]')).toBeNull();
    expect(document.querySelector('.abas__painel .aviso-falha').textContent).toContain(
      'Não foi possível consultar o documento.'
    );

    // Item 5a (valor: null + motivo enquanto resumoCentro.livre tem número -> mostra motivo + reserva, não Vazio).
    render(null, document.body);
    explicarLivreMock.mockResolvedValueOnce({
      dados: {
        valor: null,
        motivo: 'leitura parcial pendente',
        data_referencia: '2026-10-15',
        rotulo: 'Livre para gastar',
        tipo: 'calculo',
        conta: null,
        chave: 'livre',
        sinal: 1,
        ref: null,
        nota: null,
        partes: [],
      },
      erro: null,
    });
    render(
      <Projeto
        projectId="p-r2"
        hoje="2026-11-18"
        resumoCentro={{ id: 'p-r2', code: '30.912', name: 'Projeto R2', livre: 100.0, situacao: 'em dia' }}
      />,
      document.body
    );
    await tick();
    document.querySelector('.destaque--principal button.valor--origem').click();
    await tick();
    const painelRaizMotivo = document.querySelector('.painel-lateral');
    expect(painelRaizMotivo.querySelector('.vazio')).toBeNull();
    expect(painelRaizMotivo.querySelector('.projeto__nota-discreta').textContent).toContain(
      'leitura parcial pendente'
    );
    expect(painelRaizMotivo.textContent).toContain('Pessoal');
  });
});

describe('destaque Dinheiro em conta', () => {
  const resumoCentro = {
    id: 'p-1',
    code: '30.901',
    name: 'Bacia do Cerrado',
    end_date: '2027-08-31',
    livre: 84300,
    situacao: 'em dia',
    data_referencia: '2026-10-15',
  };

  const renderizarCentro = async () => {
    render(<Projeto projectId="p-1" hoje="2026-11-18" resumoCentro={resumoCentro} />, document.body);
    await tick();
  };

  const dinheiroEmConta = () => document.querySelectorAll('.destaque')[1];

  const balancetePadrao = {
    id: 'bal-novo',
    data_referencia: '2026-10-15',
    saldo_disponivel: 184250.4,
    rendimento_liquido: 11240.15,
    created_at: '2026-10-16T14:00:00Z',
  };

  it('usa o balancete mais recente por data_referencia, mesmo fora de ordem, sem somar o rendimento', async () => {
    configurarPadrao();
    balancetesMock.mockResolvedValue({
      dados: [
        {
          id: 'bal-antigo',
          data_referencia: '2026-09-15',
          saldo_disponivel: 210400,
          rendimento_liquido: 9800.5,
          created_at: '2026-09-16T14:00:00Z',
        },
        {
          id: 'bal-novo',
          data_referencia: '2026-10-15',
          saldo_disponivel: 184250.4,
          rendimento_liquido: 11240.15,
          created_at: '2026-10-16T14:00:00Z',
        },
      ],
      erro: null,
    });

    await renderizarCentro();

    expect(document.querySelectorAll('.destaque')).toHaveLength(5);
    const dinheiro = dinheiroEmConta();
    expect(dinheiro.querySelector('.destaque__rotulo').textContent).toBe('Dinheiro em conta');
    expect(
      dinheiro
        .querySelector('.destaque__valor button.valor--origem')
        .textContent.replace(/\u00a0/g, ' ')
    ).toBe('R$ 184.250');
    expect(dinheiro.textContent).toContain('balancete de 15/10/2026');
    expect(dinheiro.textContent).toContain('inclui');
    expect(dinheiro.textContent).toContain('11.240,15');
    expect(dinheiro.textContent).toContain('de rendimento');
    expect(
      dinheiro.querySelector('.destaque__contexto').textContent.replace(/\u00a0/g, ' ')
    ).toBe('balancete de 15/10/2026 · inclui R$ 11.240,15 de rendimento');

    // O rendimento já está dentro do saldo: nunca aparece a soma dos dois.
    // 184.250,40 + 11.240,15 = 195.490,55 (arredondado para cima: 195.491).
    expect(dinheiro.textContent).not.toContain('195.490');
    expect(dinheiro.textContent).not.toContain('195.491');
    // Nunca cai para o balancete anterior.
    expect(dinheiro.textContent).not.toContain('210.400');
    expect(dinheiro.textContent).not.toContain('9.800');
  });

  it('escolhe pela data_referencia, não pela posição da lista, e trata rendimento zero', async () => {
    configurarPadrao();
    balancetesMock.mockResolvedValue({
      dados: [
        {
          id: 'bal-out',
          data_referencia: '2026-10-15',
          saldo_disponivel: 333,
          rendimento_liquido: 0,
          created_at: '2026-10-16T10:00:00Z',
        },
        {
          id: 'bal-set',
          data_referencia: '2026-09-15',
          saldo_disponivel: 222,
          rendimento_liquido: 99,
          created_at: '2026-09-16T10:00:00Z',
        },
        {
          id: 'bal-ago',
          data_referencia: '2026-08-15',
          saldo_disponivel: 111,
          rendimento_liquido: 88,
          created_at: '2026-08-16T10:00:00Z',
        },
      ],
      erro: null,
    });

    await renderizarCentro();

    const dinheiro = dinheiroEmConta();
    expect(dinheiro.textContent).toContain('333');
    expect(dinheiro.textContent).not.toContain('222');
    expect(dinheiro.textContent).not.toContain('111');
    expect(dinheiro.textContent).toContain('sem rendimento');
  });

  it('saldo_disponivel null no balancete mais recente vira — com saldo não lido, sem fallback', async () => {
    configurarPadrao();
    balancetesMock.mockResolvedValue({
      dados: [
        {
          id: 'bal-antigo',
          data_referencia: '2026-09-15',
          saldo_disponivel: 210400,
          rendimento_liquido: 9800.5,
          created_at: '2026-09-16T14:00:00Z',
        },
        {
          id: 'bal-novo',
          data_referencia: '2026-10-15',
          saldo_disponivel: null,
          rendimento_liquido: null,
          created_at: '2026-10-16T14:00:00Z',
        },
      ],
      erro: null,
    });

    await renderizarCentro();

    const dinheiro = dinheiroEmConta();
    expect(dinheiro.textContent).toContain('—');
    expect(dinheiro.querySelector('.valor[title="saldo não lido"]')).not.toBeNull();
    expect(dinheiro.textContent).toContain('rendimento não lido');
    expect(dinheiro.textContent).not.toContain('210.400');
    expect(dinheiro.textContent).not.toContain('9.800');
  });

  it('erro ao carregar balancetes vira — com o motivo e nunca R$ 0,00', async () => {
    configurarPadrao();
    balancetesMock.mockResolvedValue({ dados: null, erro: 'Falha ao carregar balancetes.' });

    await renderizarCentro();

    const dinheiro = dinheiroEmConta();
    expect(dinheiro.textContent).toContain('—');
    expect(dinheiro.textContent).toContain('indisponível');
    expect(dinheiro.textContent).not.toContain('0,00');
    expect(dinheiro.textContent).not.toContain('R$ 0');
    expect(dinheiro.querySelector('.valor').getAttribute('title')).toBe(
      'Falha ao carregar balancetes.'
    );
  });

  it('centro sem balancete mostra sem balancete', async () => {
    configurarPadrao();
    balancetesMock.mockResolvedValue({ dados: [], erro: null });

    await renderizarCentro();

    const dinheiro = dinheiroEmConta();
    expect(dinheiro.textContent).toContain('sem balancete');
    expect(dinheiro.querySelector('.valor[title="sem balancete"]')).not.toBeNull();
  });

  it('mostra consultando enquanto os balancetes não chegam', async () => {
    configurarPadrao();
    balancetesMock.mockImplementation(() => new Promise(() => {}));

    await renderizarCentro();

    const dinheiro = dinheiroEmConta();
    expect(dinheiro.textContent).toContain('consultando');
    expect(dinheiro.querySelector('.valor[title="consultando"]')).not.toBeNull();
  });

  it('clicar no valor abre o documento; sem documento ou com erro, leva à aba Documentos', async () => {
    configurarPadrao();
    balancetesMock.mockResolvedValue({ dados: [balancetePadrao], erro: null });
    origemMock
      .mockResolvedValueOnce({
        dados: {
          tipo: 'documento',
          valor: 184250.4,
          documento: {
            id: 'doc-bal',
            tipo: 'balancete',
            titulo: 'Balancete out',
            arquivo_nome: 'balancete-out.pdf',
            formato: 'pdf',
            bucket: 'balancete-pdfs',
            caminho: 'p-1/balancete-out.pdf',
          },
          fato: {
            pagina: 1,
            trecho: 'SALDO DISPONIVEL: 184.250,40',
            bbox: null,
            parser: 'balancete-parser',
            parser_versao: '1.0',
          },
          busca: null,
          nota: null,
        },
        erro: null,
      })
      .mockResolvedValueOnce({
        dados: {
          tipo: 'legado',
          valor: 11240.15,
          documento: null,
          fato: null,
          busca: { texto: 'rendimento liquido', valor: 11240.15 },
          nota: 'Sem arquivo do rendimento no modo teste.',
        },
        erro: null,
      })
      .mockResolvedValueOnce({
        dados: null,
        erro: 'Falha na origem do teste.',
      });

    await renderizarCentro();

    const dinheiro = dinheiroEmConta();
    expect(dinheiro.querySelector('.destaque__rotulo').getAttribute('title')).toContain(
      'O livre é outra conta'
    );
    expect(dinheiro.getAttribute('title')).toBeNull();

    const botaoSaldo = dinheiro.querySelector('.destaque__valor button.valor--origem');
    const idAjuda = botaoSaldo.getAttribute('aria-describedby');
    expect(idAjuda).toBeTruthy();
    expect(document.getElementById(idAjuda).textContent).toContain('O livre é outra conta');
    botaoSaldo.click();
    await tick();
    expect(origemMock).toHaveBeenNthCalledWith(1, {
      alvo_tabela: 'balancetes',
      alvo_id: 'bal-novo',
      campo: 'saldo_disponivel',
    });
    expect(document.querySelector('.documento')).not.toBeNull();
    expect(document.querySelector('.documento__titulo').textContent).toContain('Balancete out');
    document.querySelector('.documento__fechar').click();
    await tick();
    expect(document.querySelector('.documento')).toBeNull();

    const botaoRendimento = dinheiro.querySelector('.destaque__contexto button.valor--origem');
    expect(botaoRendimento.getAttribute('aria-label')).toBe('Ver origem do rendimento');
    const idAjudaRendimento = botaoRendimento.getAttribute('aria-describedby');
    expect(document.getElementById(idAjudaRendimento).textContent).toContain(
      'Já está dentro do dinheiro em conta.'
    );
    botaoRendimento.click();
    await tick();
    expect(origemMock).toHaveBeenNthCalledWith(2, {
      alvo_tabela: 'balancetes',
      alvo_id: 'bal-novo',
      campo: 'rendimento_liquido',
    });
    const abaDocs = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
      t.textContent.includes('Documentos')
    );
    expect(abaDocs.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.abas__painel').textContent).toContain(
      'Sem arquivo do rendimento no modo teste.'
    );

    dinheiro.querySelector('.destaque__valor button.valor--origem').click();
    await tick();
    expect(origemMock).toHaveBeenNthCalledWith(3, {
      alvo_tabela: 'balancetes',
      alvo_id: 'bal-novo',
      campo: 'saldo_disponivel',
    });
    expect(document.querySelector('.abas__painel .aviso-falha').textContent).toContain(
      'Falha na origem do teste.'
    );
  });

  it('enquanto a origem carrega, o destaque mostra abrindo documento… e fica aria-busy', async () => {
    configurarPadrao();
    balancetesMock.mockResolvedValue({ dados: [balancetePadrao], erro: null });
    let resolverOrigem;
    origemMock.mockImplementation(
      () =>
        new Promise((r) => {
          resolverOrigem = r;
        })
    );

    await renderizarCentro();

    const dinheiro = dinheiroEmConta();
    const botaoSaldo = dinheiro.querySelector('.destaque__valor button.valor--origem');
    botaoSaldo.click();
    await tick();

    expect(dinheiro.querySelector('.destaque__contexto').textContent).toBe('abrindo documento…');
    expect(botaoSaldo.getAttribute('aria-busy')).toBe('true');

    resolverOrigem({
      dados: {
        tipo: 'legado',
        valor: 184250.4,
        documento: null,
        fato: null,
        busca: null,
        nota: 'Sem arquivo neste teste.',
      },
      erro: null,
    });
    await tick();

    const abaDocs = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
      t.textContent.includes('Documentos')
    );
    expect(abaDocs.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.abas__painel').textContent).toContain('Sem arquivo neste teste.');
  });

  it('mostra o dinheiro quando os balancetes chegam, mesmo com planos pendentes', async () => {
    configurarPadrao();
    planosMock.mockImplementation(() => new Promise(() => {}));
    balancetesMock.mockResolvedValue({ dados: [balancetePadrao], erro: null });

    await renderizarCentro();

    const dinheiro = dinheiroEmConta();
    expect(dinheiro.textContent).toContain('184.250');
    expect(dinheiro.textContent).not.toContain('consultando');

    const abaDocs = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
      t.textContent.includes('Documentos')
    );
    expect(abaDocs.querySelector('.abas__contagem')).toBeNull();
  });

  it('mostra o erro dos balancetes no topo, sem duplicar na aba, e tenta de novo', async () => {
    configurarPadrao();
    balancetesMock
      .mockResolvedValueOnce({ dados: null, erro: 'Falha ao carregar balancetes.' })
      .mockResolvedValue({ dados: [balancetePadrao], erro: null });

    await renderizarCentro();

    const avisosTopo = () => Array.from(document.querySelectorAll('.conteudo > .aviso-falha'));
    expect(avisosTopo().some((a) => a.textContent.includes('Falha ao carregar balancetes.'))).toBe(
      true
    );

    const abaDocs = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
      t.textContent.includes('Documentos')
    );
    abaDocs.click();
    await tick();
    expect(avisosTopo().some((a) => a.textContent.includes('Falha ao carregar balancetes.'))).toBe(
      false
    );
    expect(document.querySelector('.abas__painel .aviso-falha').textContent).toContain(
      'Falha ao carregar balancetes.'
    );

    const abaDinheiro = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
      t.textContent.includes('Dinheiro')
    );
    abaDinheiro.click();
    await tick();
    const avisoTopo = avisosTopo().find((a) =>
      a.textContent.includes('Falha ao carregar balancetes.')
    );
    expect(avisoTopo).toBeTruthy();
    avisoTopo.querySelector('button').click();
    await tick();

    expect(balancetesMock).toHaveBeenCalledTimes(2);
    expect(avisosTopo().some((a) => a.textContent.includes('Falha ao carregar balancetes.'))).toBe(
      false
    );
    expect(dinheiroEmConta().textContent).toContain('184.250');
  });

  it('ao trocar de centro, não mostra o dinheiro do centro anterior', async () => {
    configurarPadrao();
    balancetesMock.mockResolvedValueOnce({
      dados: [
        {
          ...balancetePadrao,
          id: 'bal-centro-a',
          saldo_disponivel: 111111.11,
          rendimento_liquido: 0,
        },
      ],
      erro: null,
    });

    render(
      <Projeto
        projectId="p-A"
        hoje="2026-11-18"
        resumoCentro={{ ...resumoCentro, id: 'p-A', name: 'Projeto A', livre: 111111 }}
      />,
      document.body
    );
    await tick();
    expect(document.querySelectorAll('.destaque')[1].textContent).toContain('111.111');

    balancetesMock.mockImplementationOnce(() => new Promise(() => {}));
    render(
      <Projeto
        projectId="p-B"
        hoje="2026-11-18"
        resumoCentro={{ ...resumoCentro, id: 'p-B', name: 'Projeto B', livre: 222222 }}
      />,
      document.body
    );

    // Sem esperar efeito/ticks: o centro novo não pode pintar o dinheiro do anterior.
    const dinheiro = document.querySelectorAll('.destaque')[1];
    expect(dinheiro.textContent).not.toContain('111.111');
    expect(dinheiro.textContent).toContain('consultando');
  });

  it('selo da rubrica usa a tarifa da RPC nova e volta à regra de hoje sem ela', async () => {
    const grupos = [
      {
        grupo_code: 'a',
        grupo_name: 'Pessoal',
        previsto: 60000,
        realizado: 30000,
        compromissos: 0,
        saldo_livre: 30000,
        compromissos_cobertura: 'nenhuma',
      },
      {
        grupo_code: 'b',
        grupo_name: 'Serviços de Terceiros P. Jurídica',
        previsto: 0,
        realizado: 14.34,
        compromissos: 0,
        saldo_livre: -14.34,
        compromissos_cobertura: 'nenhuma',
      },
    ];
    configurarPadrao({ grupos });
    situacaoCentroMock.mockResolvedValue({
      dados: {
        situacao: 'atenção',
        motivos: [
          {
            codigo: 'tarifa_bancaria',
            nivel: 'atenção',
            texto:
              'Rubrica b — Serviços de Terceiros P. Jurídica: R$ 14,34 de tarifa bancária sem previsão no plano.',
            grupo_code: 'b',
            valor: 14.34,
          },
        ],
      },
      erro: null,
    });

    const montar = async (resumo) => {
      render(
        <Projeto projectId="p-1" hoje="2026-11-18" resumoCentro={resumo} />,
        document.body
      );
      await tick();
      await tick();
    };
    const linhaServicos = () =>
      Array.from(document.querySelectorAll('.tabela__linha')).find((tr) =>
        tr.textContent.includes('Serviços de Terceiros P. Jurídica')
      );

    await montar({ ...resumoCentro, livre: 29985.66, situacao: 'atenção' });

    const linha = linhaServicos();
    expect(linha).toBeTruthy();
    const selo = linha.querySelector('.situacao');
    expect(selo.textContent).toContain('atenção');
    expect(selo.getAttribute('tabindex')).toBe('0');
    const idBalao = selo.getAttribute('aria-describedby');
    expect(idBalao).toBeTruthy();
    const balao = document.getElementById(idBalao);
    expect(balao.textContent).toContain('tarifa bancária');

    render(null, document.body);
    document.body.innerHTML = '';

    // Sem a RPC nova, o selo continua como hoje: grupo negativo = problema,
    // sem balão.
    situacaoCentroMock.mockResolvedValue({ dados: null, erro: null });
    await montar({ ...resumoCentro, livre: -14.34, situacao: 'problema' });

    const seloAntigo = linhaServicos().querySelector('.situacao');
    expect(seloAntigo.textContent).toContain('problema');
    expect(seloAntigo.hasAttribute('aria-describedby')).toBe(false);
    expect(seloAntigo.hasAttribute('tabindex')).toBe(false);
    expect(document.querySelector('.situacao__balao')).toBeNull();
  });
});
