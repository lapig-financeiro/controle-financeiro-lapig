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
  carregarPdfJs: vi.fn(async () => ({})),
  carregarMammoth: vi.fn(async () => ({})),
}));

import { Projeto } from '../src/paginas/Projeto.jsx';

const tick = () => new Promise((r) => setTimeout(r, 25));

const RESUMO = {
  id: 'p-1',
  code: '30.901',
  name: 'Centro do contrato',
  end_date: '2027-01-15',
  livre: 1000,
  situacao: 'em dia',
  data_referencia: '2026-10-15',
};

const TERMO_INICIO = {
  id: 'termo-inicio-1',
  valor: '2025-11-15',
  regra: 'vigência definida no contrato',
  trecho: 'CLÁUSULA SEGUNDA — a vigência é a definida no instrumento.',
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
  valor: '2027-01-15',
  regra: 'vigência definida no contrato',
  trecho: 'CLÁUSULA SEGUNDA — a vigência é a definida no instrumento.',
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

const TERMO_TOTAL = {
  id: 'termo-total-1',
  valor: 9.75,
  regra: 'Project Overhead de 9,75% sobre o valor total do projeto',
  trecho: 'ANEXO — Project Overhead: 9,75% do valor total do projeto.',
  documento_nome: 'Plano de trabalho · 30.901 v2',
  documento_url: null,
  documento_id: 'documento-plano-30901-v2',
  documento: {
    id: 'documento-plano-30901-v2',
    titulo: 'Plano de trabalho · 30.901 v2',
    tipo: 'plano',
    bucket: 'plano-trabalho-docs',
    caminho: 'p-1/__EXEMPLO_CF__/plano-trabalho-30901-v2.docx',
    arquivo_nome: 'plano-trabalho-30901-v2.docx',
    formato: 'docx',
    versao: 2,
    registrado_em: '2026-11-18T15:05:00Z',
  },
  pagina: 8,
  nota: null,
  origem: 'ia',
  autor: 'Claude',
  criado_em: '2026-11-18T15:12:00Z',
  conferido: false,
  conferido_em: null,
  versoes_anteriores: [],
};

const TAXAS = {
  taxa_cip_ufg: {
    id: 'termo-cip-ufg',
    valor: 5,
    regra: 'percentual sobre o valor do projeto',
    trecho: 'CLÁUSULA QUARTA — taxa de administração de 5% para a UFG.',
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
    valor: 6,
    regra: 'percentual sobre o valor do projeto',
    trecho: 'CLÁUSULA QUARTA — taxa de administração de 6% para a unidade executora.',
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
    valor: 4,
    regra: 'percentual sobre o valor do projeto',
    trecho: 'CLÁUSULA QUINTA — taxa de 4% para a fundação de apoio.',
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
    start_date_cadastro: '2025-11-15',
    end_date_cadastro: '2027-01-15',
    vigencia_situacao: 'confere',
    vigencia_confere: true,
  },
  erro: null,
};

const TERMOS_DIVERGE = {
  dados: {
    termos: {
      vigencia_inicio: { ...TERMO_INICIO, valor: '2025-11-15' },
      vigencia_fim: {
        ...TERMO_FIM,
        valor: '2027-01-15',
        nota: 'O cadastro está com 15/12/2026; a diferença veio da última assinatura.',
      },
    },
    start_date_cadastro: '2025-11-01',
    end_date_cadastro: '2026-12-15',
    vigencia_situacao: 'diverge',
    vigencia_confere: false,
  },
  erro: null,
};

const TERMOS_SO_TOTAL = {
  dados: {
    termos: {
      vigencia_fim: TERMO_FIM,
      taxa_total: TERMO_TOTAL,
    },
    start_date_cadastro: '2025-11-15',
    end_date_cadastro: '2027-01-15',
    vigencia_situacao: 'confere',
    vigencia_confere: true,
  },
  erro: null,
};

const TERMOS_TOTAL_E_DIVISAO = {
  dados: {
    termos: {
      vigencia_fim: TERMO_FIM,
      taxa_total: { ...TERMO_TOTAL, valor: 9.75 },
      ...TAXAS,
    },
    start_date_cadastro: '2025-11-15',
    end_date_cadastro: '2027-01-15',
    vigencia_situacao: 'confere',
    vigencia_confere: true,
  },
  erro: null,
};

const TERMOS_SEM_CADASTRO = {
  dados: {
    termos: {
      vigencia_inicio: { ...TERMO_INICIO, valor: '2025-06-01' },
      vigencia_fim: TERMO_FIM,
    },
    start_date_cadastro: '2025-01-01',
    end_date_cadastro: null,
    vigencia_situacao: 'sem_cadastro',
    vigencia_confere: null,
  },
  erro: null,
};

function configurarBase({ termos = TERMOS_CONFERE, resumo = RESUMO } = {}) {
  situacaoCentroMock.mockResolvedValue({ dados: null, erro: null });
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
      antes: { start_date: '2025-11-01', end_date: '2026-12-15' },
      depois: { start_date: '2025-11-15', end_date: '2027-01-15' },
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
  situacaoCentroMock.mockReset();
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

    expect(contexto().textContent).toContain('Vigência até 15/01/2027');
    expect(contexto().textContent).toContain('do contrato');
    expect(contexto().textContent).not.toContain('vigência digitada');

    const dataContrato = Array.from(contexto().querySelectorAll('button')).find(
      (b) => b.textContent.trim() === '15/01/2027'
    );
    expect(dataContrato).toBeDefined();
    dataContrato.click();
    await tick();

    expect(document.querySelector('.painel-lateral__titulo').textContent).toBe('Do contrato');
  });

  it('mantém a data do cadastro e destaca a do contrato quando diverge', async () => {
    configurarBase({ termos: TERMOS_DIVERGE, resumo: { ...RESUMO, end_date: '2026-12-15' } });
    renderizar({ resumo: { ...RESUMO, end_date: '2026-12-15' } });
    await tick();

    expect(contexto().textContent).toContain('Vigência até 15/12/2026');
    expect(contexto().textContent).toContain('contrato diz');
    expect(contexto().textContent).toContain('15/01/2027');
    expect(contexto().querySelector('.projeto__atencao-contrato')).not.toBeNull();
  });

  it('mostra a vigência do contrato quando o cadastro não tem data', async () => {
    configurarBase({ termos: TERMOS_SEM_CADASTRO, resumo: { ...RESUMO, end_date: null } });
    renderizar({ isAdmin: true, resumo: { ...RESUMO, end_date: null } });
    await tick();

    expect(contexto().textContent).toContain('Vigência do contrato: 15/01/2027');
    expect(contexto().textContent).toContain('não está no cadastro');
    botaoComTexto('15/01/2027').click();
    await tick();
    expect(botaoComTexto('Usar a data do contrato')).toBeDefined();
  });

  it('sem termos e com falha ao carregar mantém a vigência digitada (falha vira — discreto)', async () => {
    configurarBase({
      termos: {
        dados: {
          termos: {},
          start_date_cadastro: null,
          end_date_cadastro: '2027-01-15',
          vigencia_situacao: 'sem_contrato',
          vigencia_confere: null,
        },
        erro: null,
      },
    });
    renderizar();
    await tick();
    expect(contexto().textContent).toContain('vigência digitada');
    expect(contexto().textContent).toContain('15/01/2027');

    render(null, document.body);
    document.body.innerHTML = '';
    termosContratoMock.mockReset();
    termosContratoMock.mockResolvedValue({
      dados: null,
      erro: 'Não foi possível carregar os termos do contrato.',
    });
    renderizar();
    await tick();

    expect(contexto().textContent).toContain('Vigência até 15/01/2027');
    expect(contexto().textContent).not.toContain('vigência digitada');
    expect(contexto().querySelector('.projeto__nota-discreta').textContent).toContain('—');
  });

  it('soma as taxas sem arredondar e abre o painel ao clicar', async () => {
    const termos = {
      dados: {
        termos: {
          vigencia_fim: TERMO_FIM,
          taxa_cip_ufg: { ...TAXAS.taxa_cip_ufg, valor: 5.125 },
          taxa_cip_ua: { ...TAXAS.taxa_cip_ua, valor: 5.125 },
          taxa_dao: TAXAS.taxa_dao,
        },
        start_date_cadastro: '2025-11-15',
        end_date_cadastro: '2027-01-15',
        vigencia_situacao: 'confere',
        vigencia_confere: true,
      },
      erro: null,
    };
    configurarBase({ termos });
    renderizar();
    await tick();

    expect(contexto().textContent).toContain(
      'Taxas do contrato: 14,25% (UFG 5,125 · unidade 5,125 · fundação 4)'
    );
    botaoComTexto('Taxas do contrato').click();
    await tick();
    expect(document.querySelector('.painel-lateral__titulo').textContent).toBe('Do contrato');
  });

  it('mostra só o total quando o contrato não divide a taxa por rubrica', async () => {
    configurarBase({ termos: TERMOS_SO_TOTAL });
    renderizar();
    await tick();

    expect(contexto().textContent).toContain('Taxas do contrato: 9,75% no total');
    expect(contexto().textContent).not.toContain('por rubrica');
  });

  it('mostra total e divisão quando os dois existem e não corrige a diferença', async () => {
    configurarBase({ termos: TERMOS_TOTAL_E_DIVISAO });
    renderizar();
    await tick();

    expect(contexto().textContent).toContain('Taxas do contrato: 9,75% no total');
    expect(contexto().textContent).toContain(
      'por rubrica: 15% (UFG 5 · unidade 6 · fundação 4)'
    );
  });
});

describe('painel Do contrato', () => {
  it('professor de um caso divergente vê os termos, mas não a nota nem os botões', async () => {
    configurarBase({ termos: TERMOS_DIVERGE, resumo: { ...RESUMO, end_date: '2026-12-15' } });
    renderizar({ isAdmin: false, resumo: { ...RESUMO, end_date: '2026-12-15' } });
    await tick();
    botaoComTexto('15/01/2027').click();
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
    botaoComTexto('15/01/2027').click();
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

  it('abre o plano do sistema no mesmo visualizador da aba Documentos', async () => {
    configurarBase({ termos: TERMOS_SO_TOTAL });
    renderizar({ isAdmin: true });
    await tick();
    botaoComTexto('15/01/2027').click();
    await tick();

    const abrirPlano = botaoComTexto('Abrir o plano');
    expect(abrirPlano).toBeDefined();
    abrirPlano.click();
    await tick();

    expect(arquivoDeOrigemMock).toHaveBeenCalledWith(TERMO_TOTAL.documento);
    expect(document.querySelector('.documento__titulo').textContent).toBe(
      'Plano de trabalho · 30.901 v2'
    );
  });

  it('admin usa a data do contrato com início e fim antes → depois e recarrega tudo', async () => {
    configurarBase({ termos: TERMOS_DIVERGE, resumo: { ...RESUMO, end_date: '2026-12-15' } });
    const { onRecarregarResumo } = renderizar({
      isAdmin: true,
      resumo: { ...RESUMO, end_date: '2026-12-15' },
    });
    await tick();

    botaoComTexto('15/01/2027').click();
    await tick();
    botaoComTexto('Usar a data do contrato').click();
    await tick();

    const confirmacao = document.querySelector('.projeto__confirmacao-contrato');
    expect(confirmacao).not.toBeNull();
    expect(confirmacao.textContent).toContain(
      'Início: 01/11/2025 → 15/11/2025'
    );
    expect(confirmacao.textContent).toContain(
      'Fim: 15/12/2026 → 15/01/2027'
    );

    botaoComTexto('Usar a data do contrato').click();
    await tick();

    expect(usarVigenciaDoContratoMock).toHaveBeenCalledWith('p-1');
    expect(onRecarregarResumo).toHaveBeenCalledTimes(1);
    expect(saldoLivreMock).toHaveBeenCalledTimes(2);
    expect(termosContratoMock).toHaveBeenCalledTimes(2);
    expect(explicarLivreMock).toHaveBeenCalledTimes(1);
  });
});
