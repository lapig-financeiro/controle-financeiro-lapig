// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  pedidoBolsasMock,
  salvarEquipeBolsistaMock,
  salvarCaixaPedidoMock,
  apagarCaixaPedidoMock,
  colocarNaCaixaMock,
  tirarDaCaixaMock,
} = vi.hoisted(() => ({
  pedidoBolsasMock: vi.fn(),
  salvarEquipeBolsistaMock: vi.fn(),
  salvarCaixaPedidoMock: vi.fn(),
  apagarCaixaPedidoMock: vi.fn(),
  colocarNaCaixaMock: vi.fn(),
  tirarDaCaixaMock: vi.fn(),
}));

vi.mock('../src/servicos/dados.js', () => ({
  pedidoBolsas: pedidoBolsasMock,
  salvarEquipeBolsista: salvarEquipeBolsistaMock,
  salvarCaixaPedido: salvarCaixaPedidoMock,
  apagarCaixaPedido: apagarCaixaPedidoMock,
  colocarNaCaixa: colocarNaCaixaMock,
  tirarDaCaixa: tirarDaCaixaMock,
}));

import { Bolsistas } from '../src/paginas/Bolsistas.jsx';

const tick = () => new Promise((r) => setTimeout(r, 40));

async function esperarPor(condicao, tentativas = 100) {
  for (let i = 0; i < tentativas; i += 1) {
    const valor = condicao();
    if (valor) return valor;
    await tick();
  }
  return condicao();
}

const CENTROS = [
  { id: 'c1', code: '30.901', name: 'Centro Um' },
  { id: 'c2', code: '30.902', name: 'Centro Dois' },
  { id: 'c3', code: '30.903', name: 'Centro Três' },
];

function bolsa(id, projectId, valor, status = 'active', vigente = true, fim = '2027-12-31') {
  return {
    scholarship_id: id,
    project_id: projectId,
    code: CENTROS.find((c) => c.id === projectId)?.code || '—',
    valor,
    inicio: '2026-01-01',
    fim,
    status,
    vigente_hoje: vigente,
  };
}

const BOLSISTAS = [
  {
    holder_id: 'h-ana',
    nome: 'Ana Teste',
    equipe: 'pastagem',
    valor_vigente: 4000,
    bolsas: [bolsa('s-ana', 'c1', 4000)],
  },
  {
    holder_id: 'h-bento',
    nome: 'Bento Teste',
    equipe: 'pastagem',
    valor_vigente: 3000,
    bolsas: [bolsa('s-bento', 'c2', 3000)],
  },
  {
    holder_id: 'h-carla',
    nome: 'Carla Teste',
    equipe: 'alertas',
    valor_vigente: 3500,
    bolsas: [bolsa('s-carla', 'c3', 3500)],
  },
  {
    holder_id: 'h-diego',
    nome: 'Diego Teste',
    equipe: null,
    valor_vigente: 1500,
    bolsas: [bolsa('s-diego', 'c1', 1500)],
  },
  {
    holder_id: 'h-davi',
    nome: 'Davi Teste',
    equipe: 'alertas',
    valor_vigente: 0,
    bolsas: [bolsa('s-davi', 'c1', 800, 'ended', false, '2026-09-20')],
  },
  {
    holder_id: 'h-elisa',
    nome: 'Elisa Teste',
    equipe: 'solos',
    valor_vigente: 2000,
    bolsas: [bolsa('s-elisa', 'c2', 2000)],
  },
];

const CAIXA_TIMES = {
  id: 'k1',
  nome: 'Time Pastagem',
  meses: 12,
  criado_em: '2026-11-18T12:00:00Z',
  pessoas: 2,
  total_mensal: 1234,
  total_periodo: 14808,
  itens_ocultos: 0,
  itens: [
    { holder_id: 'h-ana', valor_mensal: null, valor_usado: 4000, nota: null },
    { holder_id: 'h-diego', valor_mensal: 500, valor_usado: 500, nota: 'nota da caixa' },
  ],
};

const CAIXA_RESERVA = {
  id: 'k2',
  nome: 'Reserva',
  meses: 6,
  criado_em: '2026-11-17T12:00:00Z',
  pessoas: 0,
  total_mensal: 0,
  total_periodo: 0,
  itens_ocultos: 0,
  itens: [],
};

function dados() {
  return structuredClone({
    centros: CENTROS,
    bolsistas: BOLSISTAS,
    caixas: [CAIXA_TIMES, CAIXA_RESERVA],
  });
}

function nomesNaLista() {
  return Array.from(document.querySelectorAll('.bolsistas__pessoa-nome')).map(
    (el) => el.textContent
  );
}

function chipDoFiltro(rotulo) {
  return Array.from(document.querySelectorAll('.bolsistas__filtro-chips .chip')).find(
    (el) => el.textContent === rotulo
  );
}

function botaoDe(holderId, caixaId) {
  return document.querySelector(
    `.bolsistas__botao-colocar[data-holder-id="${holderId}"][data-caixa-id="${caixaId}"]`
  );
}

beforeEach(() => {
  for (const mock of [
    pedidoBolsasMock,
    salvarEquipeBolsistaMock,
    salvarCaixaPedidoMock,
    apagarCaixaPedidoMock,
    colocarNaCaixaMock,
    tirarDaCaixaMock,
  ]) {
    mock.mockReset();
  }
  window.localStorage.clear();
  pedidoBolsasMock.mockResolvedValue({ dados: dados(), erro: null });
  salvarEquipeBolsistaMock.mockResolvedValue({ dados: { holder_id: 'h-ana', equipe: 'alertas' }, erro: null });
  salvarCaixaPedidoMock.mockResolvedValue({ dados: { id: 'k3', nome: 'Nova', meses: 9 }, erro: null });
  apagarCaixaPedidoMock.mockResolvedValue({ dados: { id: 'k1', apagada: true }, erro: null });
  colocarNaCaixaMock.mockResolvedValue({
    dados: { caixa_id: 'k2', holder_id: 'h-ana', valor_usado: 4000, saiu_de: [] },
    erro: null,
  });
  tirarDaCaixaMock.mockResolvedValue({
    dados: { caixa_id: 'k1', holder_id: 'h-ana', removido: true },
    erro: null,
  });
});

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('página Bolsistas — filtros', () => {
  it('começa com todos os centros, equipes Pastagem e Sem equipe e só mostra quem está vigente', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    expect(nomesNaLista()).toEqual(['Ana Teste', 'Bento Teste', 'Diego Teste']);
    expect(document.querySelector('.bolsistas__contador').textContent).toBe('3 pessoas na lista');

    const chips = Array.from(document.querySelectorAll('.bolsistas__filtro-chips .chip'));
    const porRotulo = Object.fromEntries(chips.map((c) => [c.textContent, c.getAttribute('aria-pressed')]));
    expect(porRotulo).toEqual({
      Pastagem: 'true',
      'Sem equipe': 'true',
      Alertas: 'false',
      Solos: 'false',
    });

    const marcados = Array.from(document.querySelectorAll('.bolsistas__filtro-centro')).map(
      (el) => el.checked
    );
    expect(marcados).toEqual([true, true, true]);
  });

  it('centro desmarcado esconde quem só tem bolsa nele e atualiza o localStorage', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    const c2 = document.querySelector('.bolsistas__filtro-centro[value="c2"]');
    c2.checked = false;
    c2.dispatchEvent(new Event('change', { bubbles: true }));
    await esperarPor(() => !nomesNaLista().includes('Bento Teste'));

    expect(nomesNaLista()).toEqual(['Ana Teste', 'Diego Teste']);
    expect(document.querySelector('.bolsistas__contador').textContent).toBe('2 pessoas na lista');

    await esperarPor(() => {
      const salvo = JSON.parse(window.localStorage.getItem('cf_bolsistas_filtros_u1') || '{}');
      return Array.isArray(salvo.centros) && !salvo.centros.includes('c2');
    });
    const salvo = JSON.parse(window.localStorage.getItem('cf_bolsistas_filtros_u1'));
    expect(salvo.centros).not.toContain('c2');
    expect(salvo.centros).toContain('c1');
  });

  it('equipe padrão esconde Alertas e Solos; os chips mudam a lista e são lembrados', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    expect(nomesNaLista()).not.toContain('Carla Teste');
    expect(nomesNaLista()).not.toContain('Elisa Teste');

    chipDoFiltro('Alertas').click();
    await esperarPor(() => nomesNaLista().includes('Carla Teste'));
    expect(nomesNaLista()).not.toContain('Elisa Teste');

    chipDoFiltro('Pastagem').click();
    await esperarPor(() => !nomesNaLista().includes('Ana Teste'));
    expect(nomesNaLista()).not.toContain('Bento Teste');
    expect(nomesNaLista()).toContain('Carla Teste');
    expect(nomesNaLista()).toContain('Diego Teste');

    await esperarPor(() => {
      const salvo = JSON.parse(window.localStorage.getItem('cf_bolsistas_filtros_u1') || '{}');
      return Array.isArray(salvo.equipes) && !salvo.equipes.includes('pastagem');
    });
    const salvo = JSON.parse(window.localStorage.getItem('cf_bolsistas_filtros_u1'));
    expect(salvo.equipes).toContain('alertas');
    expect(salvo.equipes).not.toContain('pastagem');
  });

  it('filtra por nome sem acento e mostra o contador singular', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    const busca = document.querySelector('.bolsistas__busca input');
    busca.value = 'ana';
    busca.dispatchEvent(new Event('input', { bubbles: true }));
    await esperarPor(() => nomesNaLista().length === 1);

    expect(nomesNaLista()).toEqual(['Ana Teste']);
    expect(document.querySelector('.bolsistas__contador').textContent).toBe('1 pessoa na lista');
  });
});

describe('página Bolsistas — caixas e ações', () => {
  it('mostra os totais da RPC, não a soma local dos itens', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelector('[data-caixa-id="k1"]'));

    const resumo = document.querySelector('[data-caixa-id="k1"] .bolsistas__caixa-resumo');
    const texto = resumo.textContent.replace(/\u00a0/g, ' ');
    expect(texto).toBe('2 pessoas · R$ 1.234 por mês · R$ 14.808 em 12 meses');
    expect(texto).not.toContain('4.500');
  });

  it('colocar, mover e tirar chamam os serviços certos e recarregam pela RPC', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    expect(botaoDe('h-ana', 'k1').textContent).toBe('Em Time Pastagem');
    expect(botaoDe('h-ana', 'k2').textContent).toBe('Pôr em Reserva');

    botaoDe('h-ana', 'k2').click();
    await tick();
    expect(colocarNaCaixaMock).toHaveBeenCalledWith('k2', 'h-ana', null, null);
    expect(pedidoBolsasMock).toHaveBeenCalledTimes(2);

    botaoDe('h-bento', 'k1').click();
    await tick();
    expect(colocarNaCaixaMock).toHaveBeenLastCalledWith('k1', 'h-bento', null, null);

    const tirar = document.querySelector(
      '.bolsistas__item[data-holder-id="h-ana"] button'
    );
    tirar.click();
    await tick();
    expect(tirarDaCaixaMock).toHaveBeenCalledWith('k1', 'h-ana');
  });

  it('o chip de equipe salva a equipe da pessoa', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelector('.bolsistas__pessoa[data-holder-id="h-ana"]'));

    const linhaAna = document.querySelector('.bolsistas__pessoa[data-holder-id="h-ana"]');
    const opcaoAlertas = Array.from(linhaAna.querySelectorAll('.bolsistas__equipe-opcao')).find(
      (b) => b.textContent === 'Alertas'
    );
    opcaoAlertas.click();
    await tick();

    expect(salvarEquipeBolsistaMock).toHaveBeenCalledWith('h-ana', 'alertas');
  });

  it('criar caixa envia nome e meses e recarrega', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    const botaoNova = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Nova caixa'
    );
    botaoNova.click();
    await tick();

    const form = document.querySelector('.bolsistas__nova-caixa');
    const [nome, meses] = form.querySelectorAll('input');
    nome.value = 'Time Solos';
    nome.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Time Solos' }));
    meses.value = '9';
    meses.dispatchEvent(new InputEvent('input', { bubbles: true, data: '9' }));
    await tick();
    form.querySelector('button[type="submit"]').click();
    await tick();

    expect(salvarCaixaPedidoMock).toHaveBeenCalledWith({ nome: 'Time Solos', meses: 9 });
    expect(pedidoBolsasMock).toHaveBeenCalledTimes(2);
  });

  it('erro de gravação mostra a mensagem e mantém o estado anterior, sem chamar a RPC de novo', async () => {
    colocarNaCaixaMock.mockResolvedValueOnce({ dados: null, erro: 'Falha ao gravar a caixa.' });
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    botaoDe('h-ana', 'k1').click();
    await tick();

    expect(document.querySelector('.aviso-falha').textContent).toContain('Falha ao gravar a caixa.');
    expect(botaoDe('h-ana', 'k1').textContent).toBe('Em Time Pastagem');
    expect(pedidoBolsasMock).toHaveBeenCalledTimes(1);
  });

  it('falha de consulta nunca vira zero: banner e —', async () => {
    pedidoBolsasMock.mockResolvedValueOnce({ dados: null, erro: 'Falha de consulta.' });
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelector('.aviso-falha'));

    expect(document.querySelector('.aviso-falha').textContent).toContain('Falha de consulta.');
    expect(document.body.textContent).toContain('—');
    expect(document.body.textContent).not.toContain('R$ 0');
  });
});
