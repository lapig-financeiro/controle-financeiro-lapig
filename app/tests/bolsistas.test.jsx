// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  pedidoBolsasMock,
  salvarEquipeBolsistaMock,
  salvarCaixaPedidoMock,
  apagarCaixaPedidoMock,
  colocarNaCaixaMock,
  editarItemCaixaMock,
  tirarDaCaixaMock,
  limparOcultosDaCaixaMock,
} = vi.hoisted(() => ({
  pedidoBolsasMock: vi.fn(),
  salvarEquipeBolsistaMock: vi.fn(),
  salvarCaixaPedidoMock: vi.fn(),
  apagarCaixaPedidoMock: vi.fn(),
  colocarNaCaixaMock: vi.fn(),
  editarItemCaixaMock: vi.fn(),
  tirarDaCaixaMock: vi.fn(),
  limparOcultosDaCaixaMock: vi.fn(),
}));

vi.mock('../src/servicos/dados.js', () => ({
  pedidoBolsas: pedidoBolsasMock,
  salvarEquipeBolsista: salvarEquipeBolsistaMock,
  salvarCaixaPedido: salvarCaixaPedidoMock,
  apagarCaixaPedido: apagarCaixaPedidoMock,
  colocarNaCaixa: colocarNaCaixaMock,
  editarItemCaixa: editarItemCaixaMock,
  tirarDaCaixa: tirarDaCaixaMock,
  limparOcultosDaCaixa: limparOcultosDaCaixaMock,
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
    bolsas: [bolsa('s-ana', 'c1', 4000), bolsa('s-ana-2', 'c2', 1200)],
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

function marcadorDe(holderId, caixaId) {
  return document.querySelector(
    `.bolsistas__marcador[data-holder-id="${holderId}"][data-caixa-id="${caixaId}"]`
  );
}

function botaoPorTexto(escopo, texto) {
  return Array.from(escopo.querySelectorAll('button')).find(
    (el) => el.textContent.trim() === texto
  );
}

beforeEach(() => {
  for (const mock of [
    pedidoBolsasMock,
    salvarEquipeBolsistaMock,
    salvarCaixaPedidoMock,
    apagarCaixaPedidoMock,
    colocarNaCaixaMock,
    editarItemCaixaMock,
    tirarDaCaixaMock,
    limparOcultosDaCaixaMock,
  ]) {
    mock.mockReset();
  }
  window.localStorage.clear();
  pedidoBolsasMock.mockResolvedValue({ dados: dados(), erro: null });
  salvarEquipeBolsistaMock.mockResolvedValue({ dados: { holder_id: 'h-ana', equipe: 'alertas' }, erro: null });
  salvarCaixaPedidoMock.mockResolvedValue({ dados: { id: 'k3', nome: 'Nova', meses: 9 }, erro: null });
  apagarCaixaPedidoMock.mockResolvedValue({ dados: { id: 'k1', apagada: true }, erro: null });
  colocarNaCaixaMock.mockResolvedValue({
    dados: {
      caixa_id: 'k2',
      holder_id: 'h-ana',
      valor_mensal: null,
      valor_usado: 4000,
      nota: null,
      saiu_de: [{ caixa_id: 'k1', nome: 'Time Pastagem' }],
    },
    erro: null,
  });
  editarItemCaixaMock.mockResolvedValue({
    dados: {
      caixa_id: 'k1',
      holder_id: 'h-diego',
      valor_mensal: 4500,
      valor_usado: 4500,
      nota: 'nota da caixa',
    },
    erro: null,
  });
  tirarDaCaixaMock.mockResolvedValue({
    dados: { caixa_id: 'k1', holder_id: 'h-ana', removido: true },
    erro: null,
  });
  limparOcultosDaCaixaMock.mockResolvedValue({
    dados: { caixa_id: 'k1', removidos: 1 },
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

  it('centro desmarcado esconde quem só tem bolsa nele e guarda o desmarcado', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    const c2 = document.querySelector('.bolsistas__filtro-centro[value="c2"]');
    c2.checked = false;
    c2.dispatchEvent(new Event('change', { bubbles: true }));
    await esperarPor(() => !nomesNaLista().includes('Bento Teste'));

    // Ana tem bolsa em c1 e c2: continua na lista, mas só mostra a de c1.
    expect(nomesNaLista()).toEqual(['Ana Teste', 'Diego Teste']);
    expect(document.querySelector('.bolsistas__contador').textContent).toBe('2 pessoas na lista');
    const linhaAna = document.querySelector('.bolsistas__pessoa[data-holder-id="h-ana"]');
    expect(linhaAna.querySelectorAll('.bolsistas__bolsa')).toHaveLength(1);
    expect(linhaAna.textContent).toContain('inclui bolsa de centro desmarcado');

    await esperarPor(() => {
      const salvo = JSON.parse(window.localStorage.getItem('cf_bolsistas_filtros_u1') || '{}');
      return Array.isArray(salvo.centrosDesmarcados) && salvo.centrosDesmarcados.includes('c2');
    });
    const salvo = JSON.parse(window.localStorage.getItem('cf_bolsistas_filtros_u1'));
    expect(salvo.centrosDesmarcados).toEqual(['c2']);
  });

  it('centro novo entra marcado e lista antiga que sumiu volta para todos', async () => {
    window.localStorage.setItem(
      'cf_bolsistas_filtros_u1',
      JSON.stringify({ centrosDesmarcados: ['c2'], equipes: ['pastagem', 'sem'] })
    );
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    const marcados = Array.from(document.querySelectorAll('.bolsistas__filtro-centro')).map(
      (el) => el.checked
    );
    expect(marcados).toEqual([true, false, true]);

    render(null, document.body);
    window.localStorage.setItem(
      'cf_bolsistas_filtros_u1',
      JSON.stringify({ centros: ['centro-que-nao-existe'], equipes: ['pastagem', 'sem'] })
    );
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);
    expect(
      Array.from(document.querySelectorAll('.bolsistas__filtro-centro')).every((el) => el.checked)
    ).toBe(true);
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
    expect(texto).toBe('2 pessoas · R$ 1.234/mês · R$ 14.808 em 12 meses');
    expect(texto).not.toContain('4.500');
  });

  it('mostra a caixa atual como marcador e move/chama colocar com dois parâmetros', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    expect(marcadorDe('h-ana', 'k1').textContent).toBe('Na caixa Time Pastagem');
    expect(botaoDe('h-ana', 'k1')).toBeNull();
    expect(botaoDe('h-ana', 'k2').textContent).toBe('Pôr em Reserva');

    botaoDe('h-ana', 'k2').click();
    await tick();
    expect(colocarNaCaixaMock).toHaveBeenCalledWith('k2', 'h-ana');
    expect(pedidoBolsasMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.bolsistas__aviso').textContent).toContain(
      'Ana Teste saiu de Time Pastagem.'
    );

    botaoDe('h-bento', 'k1').click();
    await tick();
    expect(colocarNaCaixaMock).toHaveBeenLastCalledWith('k1', 'h-bento');

    const linhaAna = document.querySelector('.bolsistas__item[data-holder-id="h-ana"]');
    botaoPorTexto(linhaAna, 'Tirar').click();
    await tick();
    expect(tirarDaCaixaMock).toHaveBeenCalledWith('k1', 'h-ana');
  });

  it('edita valor e nota pela RPC de editar, sem passar por colocar', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelector('[data-caixa-id="k1"]'));

    const linhaDiego = document.querySelector('.bolsistas__item[data-holder-id="h-diego"]');
    expect(linhaDiego.querySelector('.bolsistas__item-editado').textContent).toBe('editado');
    botaoPorTexto(linhaDiego, 'Editar').click();
    await tick();

    const editor = linhaDiego.querySelector('.bolsistas__item-editor');
    const [valor, nota] = editor.querySelectorAll('input');
    valor.value = '4.500';
    valor.dispatchEvent(new InputEvent('input', { bubbles: true, data: '4.500' }));
    nota.value = 'nota da caixa';
    nota.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'nota da caixa' }));
    await tick();
    botaoPorTexto(editor, 'Salvar pessoa').click();
    await tick();

    expect(editarItemCaixaMock).toHaveBeenCalledWith('k1', 'h-diego', 4500, 'nota da caixa');
    expect(colocarNaCaixaMock).not.toHaveBeenCalled();
  });

  it('valor em formato inválido não chama a RPC', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelector('[data-caixa-id="k1"]'));

    const linhaDiego = document.querySelector('.bolsistas__item[data-holder-id="h-diego"]');
    botaoPorTexto(linhaDiego, 'Editar').click();
    await tick();
    const editor = linhaDiego.querySelector('.bolsistas__item-editor');
    const valor = editor.querySelector('input');
    valor.value = 'lixo';
    valor.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'lixo' }));
    await tick();
    botaoPorTexto(editor, 'Salvar pessoa').click();
    await tick();

    expect(editarItemCaixaMock).not.toHaveBeenCalled();
    expect(linhaDiego.querySelector('.bolsistas__item-erro').textContent).toContain('valor positivo');
  });

  it('o chip de equipe salva a equipe e avisa quando ela sai do filtro', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelector('.bolsistas__pessoa[data-holder-id="h-ana"]'));

    const linhaAna = document.querySelector('.bolsistas__pessoa[data-holder-id="h-ana"]');
    const opcaoAlertas = Array.from(linhaAna.querySelectorAll('.bolsistas__equipe-opcao')).find(
      (b) => b.textContent === 'Alertas'
    );
    opcaoAlertas.click();
    await tick();

    expect(salvarEquipeBolsistaMock).toHaveBeenCalledWith('h-ana', 'alertas');
    expect(document.querySelector('.bolsistas__aviso').textContent).toBe(
      'Ana Teste agora está em Alertas (fora do filtro).'
    );
  });

  it('tira quem saiu da lista pela RPC de limpar e recarrega', async () => {
    const comOcultos = dados();
    comOcultos.caixas[0].itens_ocultos = 1;
    pedidoBolsasMock.mockResolvedValueOnce({ dados: comOcultos, erro: null });
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelector('.bolsistas__caixa-ocultos'));

    const aviso = document.querySelector('.bolsistas__caixa-ocultos');
    expect(aviso.textContent).toContain('1 pessoa saiu da lista');
    botaoPorTexto(aviso, 'Tirar quem saiu da lista').click();
    await tick();

    expect(limparOcultosDaCaixaMock).toHaveBeenCalledWith('k1');
    expect(document.querySelector('.bolsistas__aviso').textContent).toBe(
      '1 pessoa que saiu da lista foi tirada da caixa.'
    );
    expect(pedidoBolsasMock).toHaveBeenCalledTimes(2);
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

  it('monta as caixas Alertas e Solos com quem é da equipe, está vigente e ainda não está em caixa', async () => {
    salvarCaixaPedidoMock
      .mockResolvedValueOnce({ dados: { id: 'k-al', nome: 'Alertas', meses: 12 }, erro: null })
      .mockResolvedValueOnce({ dados: { id: 'k-so', nome: 'Solos', meses: 12 }, erro: null });
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    const cartao = document.querySelector('.bolsistas__caixas-equipes');
    // Davi (Alertas) só tem bolsa encerrada: não entra.
    expect(cartao.textContent).toContain('1 de Alertas e 1 de Solos');
    botaoPorTexto(cartao, 'Montar caixas Alertas e Solos').click();
    await esperarPor(() => colocarNaCaixaMock.mock.calls.length === 2);
    await tick();

    expect(salvarCaixaPedidoMock.mock.calls).toEqual([[{ nome: 'Alertas' }], [{ nome: 'Solos' }]]);
    expect(colocarNaCaixaMock.mock.calls).toEqual([
      ['k-al', 'h-carla'],
      ['k-so', 'h-elisa'],
    ]);
    expect(document.querySelector('.bolsistas__aviso').textContent).toContain(
      'Alertas: 1 pessoa · Solos: 1 pessoa'
    );
  });

  it('usa a caixa da equipe que já existe em vez de criar outra', async () => {
    const d = dados();
    d.caixas.push({ ...CAIXA_RESERVA, id: 'k-al', nome: 'alertas', itens: [] });
    pedidoBolsasMock.mockResolvedValue({ dados: d, erro: null });
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelector('.bolsistas__caixas-equipes'));

    botaoPorTexto(
      document.querySelector('.bolsistas__caixas-equipes'),
      'Montar caixas Alertas e Solos'
    ).click();
    await esperarPor(() => colocarNaCaixaMock.mock.calls.length === 2);

    expect(salvarCaixaPedidoMock.mock.calls).toEqual([[{ nome: 'Solos' }]]);
    expect(colocarNaCaixaMock.mock.calls[0]).toEqual(['k-al', 'h-carla']);
  });

  it('erro de gravação mostra a mensagem e mantém o estado anterior, sem chamar a RPC de novo', async () => {
    colocarNaCaixaMock.mockResolvedValueOnce({ dados: null, erro: 'Falha ao gravar a caixa.' });
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    botaoDe('h-bento', 'k1').click();
    await tick();

    expect(document.querySelector('.aviso-falha').textContent).toContain('Falha ao gravar a caixa.');
    expect(botaoDe('h-bento', 'k1').textContent).toBe('Pôr em Time Pastagem');
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

describe('página Bolsistas — layout e orientação', () => {
  const css = fs.readFileSync(path.resolve('src/paginas/Bolsistas.css'), 'utf8');

  function blocoCss(seletor) {
    const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const encontrado = css.match(new RegExp(`${escapado}\\s*\\{([^}]*)\\}`));
    return encontrado ? encontrado[1] : '';
  }

  it('a linha da pessoa tem grade e não usa position: absolute', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);

    const linha = document.querySelector('.bolsistas__pessoa[data-holder-id="h-ana"]');
    expect(linha.querySelector('.bolsistas__pessoa-identidade')).not.toBeNull();
    expect(linha.querySelector('.bolsistas__pessoa-conteudo .bolsistas__bolsas')).not.toBeNull();
    expect(linha.querySelector('.bolsistas__pessoa-conteudo .bolsistas__pessoa-soma')).not.toBeNull();
    expect(linha.querySelector('.bolsistas__pessoa-acoes')).not.toBeNull();
    expect(linha.getAttribute('style')).toBeNull();

    // A soma fica numa linha própria, depois das bolsas, e não por cima do chip.
    const conteudo = linha.querySelector('.bolsistas__pessoa-conteudo');
    const filhos = Array.from(conteudo.children).map((el) => el.className);
    expect(filhos).toEqual(['bolsistas__bolsas', 'bolsistas__pessoa-soma']);

    const regraLinha = blocoCss('.bolsistas__pessoa');
    expect(regraLinha).toMatch(/grid-template-columns/);
    expect(regraLinha).not.toMatch(/position\s*:\s*absolute/);
    expect(blocoCss('.bolsistas__bolsa')).toMatch(/white-space\s*:\s*nowrap/);
  });

  it('o filtro não fica fixo no topo ao rolar a lista', () => {
    expect(css).not.toMatch(/\.bolsistas__filtros\s*\{[^}]*position\s*:\s*sticky/);
  });

  it('o nome na caixa não é cortado: quebra em vez de reticências', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelector('[data-caixa-id="k1"]'));

    const nome = document.querySelector(
      '[data-caixa-id="k1"] .bolsistas__item[data-holder-id="h-ana"] .bolsistas__item-nome'
    );
    expect(nome.textContent).toBe('Ana Teste');
    const regraNome = blocoCss('.bolsistas__item-nome');
    expect(regraNome).toMatch(/overflow-wrap\s*:\s*anywhere/);
    expect(regraNome).toMatch(/white-space\s*:\s*normal/);
    expect(regraNome).not.toMatch(/text-overflow\s*:\s*ellipsis/);
    expect(regraNome).not.toMatch(/overflow\s*:\s*hidden/);
  });

  it('mostra o passo a passo e fecha com Entendi, lembrando no localStorage', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    const passos = await esperarPor(() => document.querySelector('.bolsistas__passos'));
    const texto = passos.textContent.replace(/\s+/g, ' ');
    expect(texto).toContain('1. Filtre quem entra');
    expect(texto).toContain('2. Crie uma caixa (ex.: Time Pastagem)');
    expect(texto).toContain('3. Ponha as pessoas na caixa');
    expect(botaoPorTexto(passos, 'Nova caixa')).not.toBeNull();

    botaoPorTexto(passos, 'Entendi').click();
    await esperarPor(() => !document.querySelector('.bolsistas__passos'));
    expect(window.localStorage.getItem('cf_bolsistas_passos_u1')).toBe('fechado');

    render(null, document.body);
    document.body.innerHTML = '';
    render(<Bolsistas usuarioId="u1" />, document.body);
    await esperarPor(() => document.querySelectorAll('.bolsistas__pessoa').length === 3);
    expect(document.querySelector('.bolsistas__passos')).toBeNull();
  });

  it('sem caixas, o cartão de primeira caixa aparece e não há botões “Pôr em”', async () => {
    const semCaixas = dados();
    semCaixas.caixas = [];
    pedidoBolsasMock.mockResolvedValueOnce({ dados: semCaixas, erro: null });

    render(<Bolsistas usuarioId="u1" />, document.body);
    const cartao = await esperarPor(() => document.querySelector('.bolsistas__primeira-caixa'));
    expect(cartao.textContent).toContain(
      'Crie sua primeira caixa para começar a separar as pessoas'
    );
    expect(document.querySelectorAll('.bolsistas__botao-colocar')).toHaveLength(0);
    expect(document.querySelectorAll('.bolsistas__marcador')).toHaveLength(0);
    expect(
      document
        .querySelector('.bolsistas__pessoa')
        .classList.contains('bolsistas__pessoa--sem-caixas')
    ).toBe(true);
    expect(document.querySelector('.bolsistas__caixas .vazio').textContent).toContain(
      'Nenhuma caixa ainda'
    );

    botaoPorTexto(cartao, 'Nova caixa').click();
    await esperarPor(() => document.querySelector('.bolsistas__nova-caixa'));
    expect(document.querySelector('.bolsistas__nova-caixa')).not.toBeNull();
  });

  it('a barra do rodapé mostra o resumo vindo da RPC e o botão de caixas', async () => {
    render(<Bolsistas usuarioId="u1" />, document.body);
    const barra = await esperarPor(() => document.querySelector('.bolsistas__barra-caixas'));
    const texto = barra.textContent.replace(/\s+/g, ' ');
    expect(texto).toContain('Time Pastagem: 2 · R$ 1.234/mês');
    expect(texto).toContain('Reserva: 0 · R$ 0/mês');
    expect(botaoPorTexto(barra, 'Ver caixas')).not.toBeNull();

    // Fica no CSS como barra fixa só abaixo de 900 px; no desktop continua no DOM, escondida.
    expect(blocoCss('.bolsistas__barra-caixas')).toMatch(/display\s*:\s*none/);
    const inicio900 = css.indexOf('@media (max-width: 900px)');
    expect(inicio900).toBeGreaterThan(-1);
    const trecho900 = css.slice(inicio900, css.indexOf('@media (max-width: 640px)'));
    expect(trecho900).toContain('.bolsistas__barra-caixas');
    expect(trecho900).toMatch(/position\s*:\s*fixed/);
    expect(trecho900).toContain('display: flex');
  });

  it('sem caixas, a barra do rodapé mostra o estado vazio com Nova caixa', async () => {
    const semCaixas = dados();
    semCaixas.caixas = [];
    pedidoBolsasMock.mockResolvedValueOnce({ dados: semCaixas, erro: null });

    render(<Bolsistas usuarioId="u1" />, document.body);
    const barra = await esperarPor(() => document.querySelector('.bolsistas__barra-caixas'));
    expect(barra.textContent).toContain('Nenhuma caixa ainda.');
    expect(botaoPorTexto(barra, 'Nova caixa')).not.toBeNull();
  });
});
