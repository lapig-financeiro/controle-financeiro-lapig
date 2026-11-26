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
  pedidoBolsasMock,
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
  pedidoBolsasMock: vi.fn(),
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
  pedidoBolsas: pedidoBolsasMock,
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
const botao = (texto) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === texto);

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
  pedidoBolsasMock.mockReset();
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
  it('usa apenas um centro visível no exemplo e na sugestão', async () => {
    carregarPerfilMock.mockResolvedValue({ erro: null, role: 'professor' });
    const visivel = { id: 'visivel', code: '30.901' };
    resumoProjetosMock.mockResolvedValue({
      dados: { centros: [visivel], todos: [visivel, { id: 'oculto', code: '30.109' }] },
      erro: null,
    });
    window.location.hash = '#/analise';
    render(<App />, document.body);
    const campo = await esperarPor(() => {
      const elemento = document.querySelector('.analise__campo');
      return elemento?.placeholder.includes('30.901') && elemento;
    });
    expect(campo.placeholder).toContain('30.901');
    expect(document.querySelector('.analise__sugestoes').textContent).not.toContain('30.109');
    botao('Quanto o centro 30.901 tem livre hoje, e de onde vem?').click();
    await esperarPor(() => campo.value.includes('30.901'));
    expect(campo.value).toContain('30.901');
  });

  it('ignora o perfil de uma sessão anterior que terminou de carregar após a troca de conta', async () => {
    let resolverPerfilAntigo;
    carregarPerfilMock.mockReturnValueOnce(new Promise((resolver) => { resolverPerfilAntigo = resolver; }));
    carregarPerfilMock.mockResolvedValue({ erro: null, role: 'professor', nome: 'Conta nova' });
    window.location.hash = '#/analise';
    render(<App />, document.body);
    await esperarPor(() => carregarPerfilMock.mock.calls.length === 1);
    ouvinteAuth.atual('SIGNED_IN', { user: { id: 'u-2' } });
    const avatarNovo = await esperarPor(() => document.querySelector('[aria-label="Menu do usuário Conta nova"]'));
    expect(avatarNovo).not.toBeNull();
    resolverPerfilAntigo({ erro: null, role: 'admin', nome: 'Conta antiga', podeBolsistas: true });
    await tick();
    expect(document.querySelector('a[href="#/admin"]')).toBeNull();
    expect(document.querySelector('a[href="#/bolsistas"]')).toBeNull();
    expect(document.querySelector('[aria-label="Menu do usuário Conta nova"]')).not.toBeNull();
  });

  it('espera a primeira consulta de manutenção antes de mostrar a aplicação', async () => {
    let resolverManutencao;
    consultarManutencaoMock.mockReturnValue(new Promise((resolver) => { resolverManutencao = resolver; }));
    carregarPerfilMock.mockResolvedValue({ erro: null, role: 'professor' });
    window.location.hash = '#/projetos';
    render(<App />, document.body);
    await esperarPor(() => carregarPerfilMock.mock.calls.length === 1 && resolverManutencao);
    expect(document.querySelector('.barra-topo')).toBeNull();
    resolverManutencao({ ativo: true, mensagem: 'Atualização em andamento' });
    expect(await esperarPor(() => document.body.textContent.includes('Atualização em andamento'))).toBe(true);
    expect(document.querySelector('.barra-topo')).toBeNull();
  });

  it('não recarrega durante manutenção quando uma nova consulta falha', async () => {
    carregarPerfilMock.mockResolvedValue({ erro: null, role: 'professor' });
    consultarManutencaoMock.mockResolvedValue({ ativo: true, mensagem: 'Manutenção confirmada' });
    window.location.hash = '#/projetos';
    render(<App />, document.body);
    expect(await esperarPor(() => document.body.textContent.includes('Manutenção confirmada'))).toBe(true);

    const recarregar = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    try {
      const consultasAntes = consultarManutencaoMock.mock.calls.length;
      consultarManutencaoMock.mockResolvedValue({ ativo: false, mensagem: '', falhou: true });
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      expect(await esperarPor(() => consultarManutencaoMock.mock.calls.length > consultasAntes)).toBe(true);
      expect(recarregar).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain('Manutenção confirmada');
    } finally {
      recarregar.mockRestore();
    }
  });
  it('professor vê o item no menu e a rota #/analise renderiza a página', async () => {
    carregarPerfilMock.mockResolvedValue({
      erro: null,
      role: 'professor',
      nome: 'Pessoa Professora',
      email: 'pessoa@example.org',
    });
    window.location.hash = '#/analise';

    render(<App />, document.body);

    const pagina = await esperarPor(() => document.querySelector('.analise'));
    expect(pagina).not.toBeNull();
    expect(window.location.hash).toBe('#/analise');
    expect(document.querySelector('a[href="#/analise"]')).not.toBeNull();
    expect(document.querySelector('.analise__campo')).not.toBeNull();
  });

  it('agente não vê o item no menu e a rota #/analise navega para #/projetos', async () => {
    carregarPerfilMock.mockResolvedValue({
      erro: null,
      role: 'agente',
      nome: 'Buriti',
      email: 'agente@example.org',
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

describe('acesso à aba Bolsistas', () => {
  it.each(['admin', 'professor'])('oculta o menu e bloqueia o link direto para %s sem permissão', async (role) => {
    carregarPerfilMock.mockResolvedValue({ erro: null, role, podeBolsistas: false });
    window.location.hash = '#/bolsistas';
    render(<App />, document.body);
    expect(await esperarPor(() => window.location.hash === '#/projetos')).toBe(true);
    expect(document.querySelector('a[href="#/bolsistas"]')).toBeNull();
    expect(document.querySelector('.bolsistas')).toBeNull();
    expect(pedidoBolsasMock).not.toHaveBeenCalled();
  });

  it('abre a aba para a conta autorizada e inclui o passo no guia', async () => {
    carregarPerfilMock.mockResolvedValue({ erro: null, role: 'professor', podeBolsistas: true });
    pedidoBolsasMock.mockResolvedValue({ dados: { centros: [], bolsistas: [], caixas: [] }, erro: null });
    window.localStorage.clear();
    window.location.hash = '#/bolsistas';
    render(<App />, document.body);
    expect(await esperarPor(() => pedidoBolsasMock.mock.calls.length === 1)).toBe(true);
    expect(window.location.hash).toBe('#/bolsistas');
    expect(document.querySelector('a[href="#/bolsistas"]')).not.toBeNull();
    (await esperarPor(() => botao('Iniciar tour'))).click();
    expect(await esperarPor(() => document.body.textContent.includes('Passo 1 de 5'))).toBe(true);
  });
});

describe('guia de primeiro acesso', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('percorre as telas, pode ser concluído e reabre pelo menu', async () => {
    carregarPerfilMock.mockResolvedValue({
      erro: null,
      role: 'professor',
      nome: 'Pessoa Professora',
      email: 'pessoa@example.org',
    });
    window.location.hash = '#/projetos';

    render(<App />, document.body);
    const guia = await esperarPor(() => document.querySelector('.boas-vindas'));
    expect(guia).not.toBeNull();
    botao('Iniciar tour').click();
    await esperarPor(() => document.body.textContent.includes('Passo 1 de 4'));
    expect(window.location.hash).toBe('#/projetos');
    for (const titulo of ['Confira de onde vem o saldo livre', 'Acompanhe as pendências', 'Faça uma pergunta ao Assistente']) {
      botao('Próximo').click();
      expect(await esperarPor(() => document.querySelector('.boas-vindas h2')?.textContent === titulo)).toBe(true);
    }
    expect(window.location.hash).toBe('#/analise');
    botao('Voltar').click();
    await esperarPor(() => document.body.textContent.includes('Passo 3 de 4'));
    botao('Próximo').click();
    const concluir = await esperarPor(() => botao('Concluir'));
    concluir.click();
    await esperarPor(() => !document.querySelector('.boas-vindas'));
    expect(document.querySelector('.boas-vindas')).toBeNull();
    expect(window.localStorage.getItem('cf_boas_vindas_u-1')).toBe('visto');

    // Novo carregamento do site: o guia não abre de novo.
    render(null, document.body);
    render(<App />, document.body);
    await esperarPor(() => document.querySelector('.menu-usuario__avatar'));
    await tick();
    expect(document.querySelector('.boas-vindas')).toBeNull();

    // Pelo menu do usuário, "Como usar o site" abre o guia.
    document.querySelector('.menu-usuario__avatar').click();
    const item = await esperarPor(() =>
      Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Como usar o site'))
    );
    item.click();
    expect(await esperarPor(() => document.querySelector('.boas-vindas'))).not.toBeNull();
    botao('Agora não').click();
    expect(await esperarPor(() => !document.querySelector('.boas-vindas'))).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.menu-usuario__avatar'));
  });

  it('admin vê o passo extra de Admin', async () => {
    carregarPerfilMock.mockResolvedValue({
      erro: null,
      role: 'admin',
      nome: 'Pessoa Admin',
      email: 'admin@example.org',
    });
    window.location.hash = '#/projetos';
    render(<App />, document.body);
    (await esperarPor(() => botao('Iniciar tour'))).click();
    expect(await esperarPor(() => document.body.textContent.includes('Passo 1 de 5'))).toBe(true);
  });

  it('agente não recebe o guia', async () => {
    carregarPerfilMock.mockResolvedValue({ erro: null, role: 'agente', nome: 'Buriti', email: 'a@example.org' });
    window.location.hash = '#/projetos';
    render(<App />, document.body);
    await esperarPor(() => carregarPerfilMock.mock.calls.length > 0);
    await tick();
    await tick();
    expect(document.querySelector('.boas-vindas')).toBeNull();
    // A regra é "nunca", não "ainda não": nada foi gravado e o menu não oferece o guia.
    expect(Object.keys(window.localStorage).some((k) => k.startsWith('cf_boas_vindas_'))).toBe(false);
    const avatar = document.querySelector('.menu-usuario__avatar');
    if (avatar) {
      avatar.click();
      await tick();
      expect(
        Array.from(document.querySelectorAll('button')).some((b) => b.textContent.includes('Como usar o site'))
      ).toBe(false);
    }
  });
});
