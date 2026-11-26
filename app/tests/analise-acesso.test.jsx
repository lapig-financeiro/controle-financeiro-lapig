// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  carregarPerfilMock,
  sairMock,
  resumoProjetosMock,
  pendenciasMock,
  salvarFiltroVisaoMock,
  consultarManutencaoMock,
  explicarLivreMock,
  origemMock,
  termosContratoMock,
  arquivoDeOrigemMock,
  ouvinteAuth,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  carregarPerfilMock: vi.fn(),
  sairMock: vi.fn(),
  resumoProjetosMock: vi.fn(),
  pendenciasMock: vi.fn(),
  salvarFiltroVisaoMock: vi.fn(),
  consultarManutencaoMock: vi.fn(),
  explicarLivreMock: vi.fn(),
  origemMock: vi.fn(),
  termosContratoMock: vi.fn(),
  arquivoDeOrigemMock: vi.fn(),
  ouvinteAuth: { atual: null },
}));

vi.mock('../src/servicos/supabase.js', () => ({
  SUPABASE_URL: 'https://exemplo.supabase.co',
  SUPABASE_KEY: 'chave-publica',
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: vi.fn((callback) => {
        ouvinteAuth.atual = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  },
  carregarPerfil: carregarPerfilMock,
  sair: sairMock,
}));

vi.mock('../src/servicos/dados.js', () => ({
  resumoProjetos: resumoProjetosMock,
  pendencias: pendenciasMock,
  salvarFiltroVisao: salvarFiltroVisaoMock,
  explicarLivre: explicarLivreMock,
  origem: origemMock,
  termosContrato: termosContratoMock,
  arquivoDeOrigem: arquivoDeOrigemMock,
}));

vi.mock('../src/servicos/manutencao.js', () => ({
  consultarManutencao: consultarManutencaoMock,
}));

import { App } from '../src/App.jsx';

const tick = () => new Promise((resolver) => setTimeout(resolver, 25));

async function esperarPor(condicao, tentativas = 120) {
  for (let i = 0; i < tentativas; i += 1) {
    const valor = condicao();
    if (valor) return valor;
    await tick();
  }
  return condicao();
}

function clienteFalso() {
  getSessionMock.mockResolvedValue({
    data: {
      session: {
        user: { id: 'u-1', email: 'pessoa@example.org' },
      },
    },
    error: null,
  });
  resumoProjetosMock.mockResolvedValue({
    dados: { centros: [], todos: [] },
    erro: null,
  });
  pendenciasMock.mockResolvedValue({ dados: [], erro: null });
  salvarFiltroVisaoMock.mockResolvedValue({ dados: { ok: true }, erro: null });
  consultarManutencaoMock.mockResolvedValue({ ativo: false, mensagem: '' });
  arquivoDeOrigemMock.mockResolvedValue({ dados: null, erro: 'sem arquivo no teste' });
}

beforeEach(() => {
  window.location.hash = '';
  getSessionMock.mockReset();
  carregarPerfilMock.mockReset();
  sairMock.mockReset();
  resumoProjetosMock.mockReset();
  pendenciasMock.mockReset();
  salvarFiltroVisaoMock.mockReset();
  consultarManutencaoMock.mockReset();
  explicarLivreMock.mockReset();
  origemMock.mockReset();
  termosContratoMock.mockReset();
  arquivoDeOrigemMock.mockReset();
  clienteFalso();
});

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
  window.location.hash = '';
});

describe('acesso à Análise', () => {
  it('professor não vê o item no menu e a rota #/analise navega para #/projetos', async () => {
    carregarPerfilMock.mockResolvedValue({
      erro: null,
      role: 'professor',
      nome: 'Pessoa Professora',
      email: 'pessoa@example.org',
    });
    window.location.hash = '#/analise';

    render(<App />, document.body);

    await esperarPor(() => window.location.hash === '#/projetos');
    expect(window.location.hash).toBe('#/projetos');
    expect(document.querySelector('a[href="#/analise"]')).toBeNull();
    expect(document.querySelector('.analise')).toBeNull();
  });

  it('admin vê o item no menu e a rota #/analise renderiza a página', async () => {
    carregarPerfilMock.mockResolvedValue({
      erro: null,
      role: 'admin',
      nome: 'Pessoa Admin',
      email: 'admin@example.org',
    });
    window.location.hash = '#/analise';

    render(<App />, document.body);

    const pagina = await esperarPor(() => document.querySelector('.analise'));
    expect(pagina).not.toBeNull();
    expect(document.querySelector('a[href="#/analise"]')).not.toBeNull();
    expect(document.querySelector('.analise__campo')).not.toBeNull();
    expect(document.querySelector('.cabecalho-pagina__titulo').textContent).toBe('Análise');
  });

  it('enquanto o papel carrega, a página não renderiza', async () => {
    let resolverPerfil;
    const perfilPendente = new Promise((resolver) => {
      resolverPerfil = resolver;
    });
    carregarPerfilMock.mockReturnValue(perfilPendente);
    window.location.hash = '#/analise';

    render(<App />, document.body);

    await esperarPor(() => getSessionMock.mock.calls.length > 0);
    await tick();
    await tick();

    expect(document.querySelector('.analise')).toBeNull();
    expect(document.querySelector('.analise__campo')).toBeNull();
    expect(document.querySelector('h1')).toBeNull();

    resolverPerfil({
      erro: null,
      role: 'professor',
      nome: 'Pessoa Professora',
      email: 'pessoa@example.org',
    });
    await tick();
  });

  it('a pergunta digitada sobrevive à troca de aba do site e à volta da aba do navegador', async () => {
    carregarPerfilMock.mockResolvedValue({
      erro: null,
      role: 'admin',
      nome: 'Pessoa Admin',
      email: 'admin@example.org',
    });
    window.location.hash = '#/analise';

    render(<App />, document.body);

    const campo = await esperarPor(() => document.querySelector('.analise__campo'));
    campo.value = 'Quanto o 30.910 tem livre?';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    // Troca de aba do site: a Análise fica escondida, não desmontada.
    window.location.hash = '#/projetos';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await esperarPor(() => document.querySelector('.analise')?.closest('[hidden]'));
    expect(document.querySelector('.analise').closest('[hidden]')).not.toBeNull();

    window.location.hash = '#/analise';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await esperarPor(() => !document.querySelector('.analise')?.closest('[hidden]'));
    expect(document.querySelector('.analise__campo').value).toBe('Quanto o 30.910 tem livre?');

    // Volta da aba do navegador: o Supabase repete SIGNED_IN do mesmo usuário.
    const chamadasPerfil = carregarPerfilMock.mock.calls.length;
    ouvinteAuth.atual('SIGNED_IN', { user: { id: 'u-1', email: 'pessoa@example.org' } });
    await tick();
    await tick();
    expect(carregarPerfilMock.mock.calls.length).toBe(chamadasPerfil);
    expect(document.querySelector('.analise__campo').value).toBe('Quanto o 30.910 tem livre?');
  });
});
