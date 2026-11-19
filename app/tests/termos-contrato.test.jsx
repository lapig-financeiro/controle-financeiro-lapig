// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  saldoLivreMock,
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
  carregarPdfJs: vi.fn(async () => ({})),
  carregarMammoth: vi.fn(async () => ({})),
}));

import { Projeto } from '../src/paginas/Projeto.jsx';

const tick = () => new Promise((r) => setTimeout(r, 25));

const RESUMO = {
  id: 'p-1',
  code: '30.901',
  name: 'Centro do contrato',
  end_date: '2027-08-31',
  livre: 1000,
  situacao: 'em dia',
  data_referencia: '2026-10-15',
};

const TERMO_INICIO = {
  id: 'termo-inicio-1',
  valor: '2025-12-31',
  regra: '20 meses contados da última assinatura (31/12/2025)',
  trecho: 'CLÁUSULA SEGUNDA — vigência de 20 (vinte) meses, contados da última assinatura.',
  documento_nome: 'Contrato de prestação de serviços · 30.901',
  documento_url: 'https://drive.google.com/file/d/exemplo-contrato-30901/view',
  pagina: 2,
  nota: null,
  origem: 'ia',
  autor: 'Claude',
  criado_em: '2026-11-18T15:10:00Z',
  conferido: true,
  conferido_em: '2026-11-18T16:00:00Z',
  versoes_anteriores: [],
};

const TERMO_FIM = {
  id: 'termo-fim-1',
  valor: '2027-08-31',
  regra: '20 meses contados da última assinatura (31/12/2025)',
  trecho: 'CLÁUSULA SEGUNDA — vigência de 20 (vinte) meses, contados da última assinatura.',
  documento_nome: 'Contrato de prestação de serviços · 30.901',
  documento_url: 'https://drive.google.com/file/d/exemplo-contrato-30901/view',
  pagina: 2,
  nota: 'Nota interna do admin: conferir o aditivo antes de trocar a data.',
  origem: 'ia',
  autor: 'Claude',
  criado_em: '2026-11-18T15:10:00Z',
  conferido: false,
  conferido_em: null,
  versoes_anteriores: [],
};

const TAXAS = {
  taxa_cip_ufg: {
    id: 'termo-cip-ufg',
    valor: 8,
    regra: 'percentual sobre o valor do projeto',
    trecho: 'CLÁUSULA QUARTA — taxa de administração de 8% para a UFG.',
    documento_nome: 'Contrato de prestação de serviços · 30.901',
    documento_url: 'https://drive.google.com/file/d/exemplo-contrato-30901/view',
    pagina: 4,
    nota: null,
    origem: 'ia',
    autor: 'Claude',
    criado_em: '2026-11-18T15:12:00Z',
    conferido: false,
    conferido_em: null,
    versoes_anteriores: [],
  },
  taxa_cip_ua: {
    id: 'termo-cip-ua',
    valor: 8,
    regra: 'percentual sobre o valor do projeto',
    trecho: 'CLÁUSULA QUARTA — taxa de administração de 8% para a unidade executora.',
    documento_nome: 'Contrato de prestação de serviços · 30.901',
    documento_url: 'https://drive.google.com/file/d/exemplo-contrato-30901/view',
    pagina: 4,
    nota: null,
    origem: 'ia',
    autor: 'Claude',
    criado_em: '2026-11-18T15:12:00Z',
    conferido: false,
    conferido_em: null,
    versoes_anteriores: [],
  },
  taxa_dao: {
    id: 'termo-dao',
    valor: 10,
    regra: 'percentual sobre o valor do projeto',
    trecho: 'CLÁUSULA QUINTA — taxa de 10% para a fundação de apoio.',
    documento_nome: 'Contrato de prestação de serviços · 30.901',
    documento_url: 'https://drive.google.com/file/d/exemplo-contrato-30901/view',
    pagina: 5,
    nota: null,
    origem: 'ia',
    autor: 'Claude',
    criado_em: '2026-11-18T15:12:00Z',
    conferido: false,
    conferido_em: null,
    versoes_anteriores: [],
  },
};

const TERMOS_CONFERE = {
  dados: {
    termos: { vigencia_inicio: TERMO_INICIO, vigencia_fim: TERMO_FIM, ...TAXAS },
    end_date_cadastro: '2027-08-31',
    vigencia_confere: true,
  },
  erro: null,
};

const TERMOS_DIVERGE = {
  dados: {
    termos: {
      vigencia_inicio: { ...TERMO_INICIO, valor: '2025-08-30' },
      vigencia_fim: {
        ...TERMO_FIM,
        valor: '2027-04-30',
        nota: 'O cadastro está com 31/03/2027; a diferença veio da última assinatura.',
      },
    },
    end_date_cadastro: '2027-03-31',
    vigencia_confere: false,
  },
  erro: null,
};

function configurarBase({ termos = TERMOS_CONFERE, resumo = RESUMO } = {}) {
  saldoLivreMock.mockResolvedValue({
    dados: {
      has_plano: true,
      has_balancete: true,
      project_id: 'p-1',
      project_name: resumo.name,
      end_date: resumo.end_date,
      data_referencia: '2026-10-15',
      bolsas_ativas: [],
      grupos: [
        {
          grupo_code: 'a',
          grupo_name: 'Pessoal',
          previsto: 1000,
          realizado: 500,
          compromissos: 0,
          saldo_livre: 500,
          compromissos_cobertura: 'nenhuma',
        },
      ],
      rubricas: [],
      avisos: [],
    },
    erro: null,
  });
  repassesMock.mockResolvedValue({
    dados: { parcelas: [], valor_total_plano: null, data_balancete: null, recursos: null },
    erro: null,
  });
  balancetesMock.mockResolvedValue({ dados: [], erro: null });
  planosMock.mockResolvedValue({ dados: [], erro: null });
  pendenciasMock.mockResolvedValue({ dados: [], erro: null });
  explicarLivreMock.mockResolvedValue({ dados: null, erro: 'Não configurado.' });
  origemMock.mockResolvedValue({ dados: null, erro: 'Não configurado.' });
  arquivoDeOrigemMock.mockResolvedValue({ dados: null, erro: 'Não configurado.' });
  termosContratoMock.mockResolvedValue(termos);
  conferirTermoContratoMock.mockResolvedValue({
    dados: { id: TERMO_FIM.id, conferido_em: '2026-11-18T17:00:00Z', ja_estava: false },
    erro: null,
  });
  usarVigenciaDoContratoMock.mockResolvedValue({
    dados: {
      project_id: 'p-1',
      antes: { start_date: null, end_date: '2027-03-31' },
      depois: { start_date: '2025-08-30', end_date: '2027-04-30' },
      mudou: true,
    },
    erro: null,
  });
}

function renderizar({ isAdmin = false, resumo = RESUMO, onRecarregarResumo = vi.fn() } = {}) {
  render(
    <Projeto
      projectId="p-1"
      hoje="2026-11-18"
      isAdmin={isAdmin}
      resumoCentro={resumo}
      onRecarregarResumo={onRecarregarResumo}
    />,
    document.body
  );
  return { onRecarregarResumo };
}

function contexto() {
  return document.querySelector('.cabecalho-pagina__contexto');
}

function botaoComTexto(texto) {
  return Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent.includes(texto)
  );
}

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

beforeEach(() => {
  saldoLivreMock.mockReset();
  repassesMock.mockReset();
  balancetesMock.mockReset();
  planosMock.mockReset();
  pendenciasMock.mockReset();
  explicarLivreMock.mockReset();
  origemMock.mockReset();
  arquivoDeOrigemMock.mockReset();
  termosContratoMock.mockReset();
  conferirTermoContratoMock.mockReset();
  usarVigenciaDoContratoMock.mockReset();
});

describe('termos do contrato no cabeçalho', () => {
  it('mostra a data do contrato como botão quando ela confere com o cadastro', async () => {
    configurarBase({ termos: TERMOS_CONFERE });
    renderizar();
    await tick();

    expect(contexto().textContent).toContain('Vigência até 31/08/2027');
    expect(contexto().textContent).toContain('do contrato');
    expect(contexto().textContent).not.toContain('vigência digitada');

    const dataContrato = Array.from(contexto().querySelectorAll('button')).find(
      (b) => b.textContent.trim() === '31/08/2027'
    );
    expect(dataContrato).toBeDefined();
    dataContrato.click();
    await tick();

    expect(document.querySelector('.painel-lateral__titulo').textContent).toBe('Do contrato');
  });

  it('mantém a data do cadastro e destaca a do contrato quando diverge', async () => {
    configurarBase({ termos: TERMOS_DIVERGE, resumo: { ...RESUMO, end_date: '2027-03-31' } });
    renderizar({ resumo: { ...RESUMO, end_date: '2027-03-31' } });
    await tick();

    expect(contexto().textContent).toContain('Vigência até 31/03/2027');
    expect(contexto().textContent).toContain('contrato diz');
    expect(contexto().textContent).toContain('30/04/2027');
    expect(contexto().querySelector('.projeto__atencao-contrato')).not.toBeNull();
  });

  it('sem termos e com falha ao carregar mantém a vigência digitada (falha vira — discreto)', async () => {
    configurarBase({
      termos: {
        dados: { termos: {}, end_date_cadastro: '2027-08-31', vigencia_confere: null },
        erro: null,
      },
    });
    renderizar();
    await tick();
    expect(contexto().textContent).toContain('vigência digitada');
    expect(contexto().textContent).toContain('31/08/2027');

    render(null, document.body);
    document.body.innerHTML = '';
    termosContratoMock.mockReset();
    termosContratoMock.mockResolvedValue({
      dados: null,
      erro: 'Não foi possível carregar os termos do contrato.',
    });
    renderizar();    await tick();

    expect(contexto().textContent).toContain('Vigência até 31/08/2027');
    expect(contexto().textContent).not.toContain('vigência digitada');
    expect(contexto().querySelector('.projeto__nota-discreta').textContent).toContain('—');
  });

  it('soma as taxas sem arredondar e abre o painel ao clicar', async () => {
    const termos = {
      dados: {
        termos: {
          vigencia_fim: TERMO_FIM,
          taxa_cip_ufg: { ...TAXAS.taxa_cip_ufg, valor: 8.125 },
          taxa_cip_ua: { ...TAXAS.taxa_cip_ua, valor: 8.125 },
          taxa_dao: TAXAS.taxa_dao,
        },
        end_date_cadastro: '2027-08-31',
        vigencia_confere: true,
      },
      erro: null,
    };
    configurarBase({ termos });
    renderizar();
    await tick();

    expect(contexto().textContent).toContain(
      'Taxas do contrato: 26,25% (UFG 8,125 · unidade 8,125 · fundação 10)'
    );
    botaoComTexto('Taxas do contrato').click();
    await tick();
    expect(document.querySelector('.painel-lateral__titulo').textContent).toBe('Do contrato');
  });
});

describe('painel Do contrato', () => {
  it('professor vê os termos e o trecho, mas não a nota nem os botões', async () => {
    configurarBase({ termos: TERMOS_CONFERE });
    renderizar({ isAdmin: false });
    await tick();
    botaoComTexto('31/08/2027').click();
    await tick();

    const painel = document.querySelector('.painel-lateral');
    expect(painel.textContent).toContain('Fim da vigência');
    expect(painel.textContent).toContain('CLÁUSULA SEGUNDA');
    expect(painel.textContent).toContain('Registrado por Claude (IA) em 18/11/2026');
    expect(painel.textContent).toContain('conferido em 18/11/2026');
    expect(painel.textContent).not.toContain('Nota interna do admin');
    expect(painel.textContent).not.toContain('Análise de quem registrou');
    expect(botaoComTexto('Marcar como conferido')).toBeUndefined();
    expect(botaoComTexto('Usar a data do contrato')).toBeUndefined();

    const link = painel.querySelector('a[href*="drive.google.com"]');
    expect(link).not.toBeNull();
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(painel.textContent).toContain('p. 2');
  });

  it('admin vê a nota, marca como conferido e recarrega os termos', async () => {
    configurarBase({ termos: TERMOS_CONFERE });
    renderizar({ isAdmin: true });
    await tick();
    botaoComTexto('31/08/2027').click();
    await tick();

    const painel = document.querySelector('.painel-lateral');
    expect(painel.textContent).toContain('Nota interna do admin');
    expect(painel.textContent).toContain('Análise de quem registrou');
    expect(botaoComTexto('Marcar como conferido')).toBeDefined();

    botaoComTexto('Marcar como conferido').click();
    await tick();

    expect(conferirTermoContratoMock).toHaveBeenCalledWith(TERMO_FIM.id);
    expect(termosContratoMock).toHaveBeenCalledTimes(2);
  });

  it('admin usa a data do contrato com confirmação antes → depois e recarrega resumo e saldo', async () => {
    configurarBase({ termos: TERMOS_DIVERGE, resumo: { ...RESUMO, end_date: '2027-03-31' } });
    const { onRecarregarResumo } = renderizar({
      isAdmin: true,
      resumo: { ...RESUMO, end_date: '2027-03-31' },
    });
    await tick();

    botaoComTexto('30/04/2027').click();
    await tick();
    botaoComTexto('Usar a data do contrato').click();
    await tick();

    const confirmacao = document.querySelector('.projeto__confirmacao-contrato');
    expect(confirmacao).not.toBeNull();
    expect(confirmacao.textContent).toContain('passa de 31/03/2027 para 30/04/2027');

    botaoComTexto('Usar a data do contrato').click();
    await tick();

    expect(usarVigenciaDoContratoMock).toHaveBeenCalledWith('p-1');
    expect(onRecarregarResumo).toHaveBeenCalledTimes(1);
    expect(saldoLivreMock).toHaveBeenCalledTimes(2);
    expect(termosContratoMock).toHaveBeenCalledTimes(2);
  });
});
