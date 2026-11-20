// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  acessosUsuariosMock,
  salvarAcessosMock,
  fromMock,
  rpcMock,
} = vi.hoisted(() => ({
  acessosUsuariosMock: vi.fn(),
  salvarAcessosMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock('../src/servicos/supabase.js', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
  },
}));

vi.mock('../src/servicos/dados.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    acessosUsuarios: acessosUsuariosMock,
    salvarAcessos: salvarAcessosMock,
    _realAcessosUsuarios: original.acessosUsuarios,
    _realSalvarAcessos: original.salvarAcessos,
  };
});

import { Admin } from '../src/paginas/Admin.jsx';
import {
  _realAcessosUsuarios,
  _realSalvarAcessos,
  validarAcessosUsuarios,
} from '../src/servicos/dados.js';
import * as dadosExemplo from '../src/servicos/dadosExemplo.js';

const tick = () => new Promise((r) => setTimeout(r, 30));

async function esperarPor(condicao, tentativas = 100) {
  for (let i = 0; i < tentativas; i += 1) {
    const valor = condicao();
    if (valor) return valor;
    await tick();
  }
  return condicao();
}

const CENTROS_TESTE = [
  { id: 'c-1', code: '30.901', name: 'Centro Alpha', active: true },
  { id: 'c-2', code: '30.902', name: 'Centro Beta', active: true },
  { id: 'c-3', code: '30.903', name: 'Centro Gama', active: true },
  { id: 'c-4', code: '30.904', name: 'Centro Delta', active: true },
  { id: 'c-5', code: '30.905', name: 'Centro Épsilon', active: true },
  { id: 'c-inativo', code: '30.900', name: 'Centro Encerrado', active: false },
];

const USUARIOS_TESTE = [
  {
    user_id: 'u-admin-1',
    nome: 'Ana Admin',
    email: 'ana@example.org',
    role: 'admin',
    criado_em: '2026-01-10T10:00:00Z',
    centros: ['c-1'],
  },
  {
    user_id: 'u-agente',
    nome: 'Buriti',
    email: 'buriti@example.org',
    role: 'agente',
    criado_em: '2026-02-10T10:00:00Z',
    centros: ['c-1', 'c-2'],
  },
  {
    user_id: 'u-prof-cheio',
    nome: 'Carla Professora',
    email: 'carla@example.org',
    role: 'professor',
    criado_em: '2026-03-10T10:00:00Z',
    centros: ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'],
  },
  {
    user_id: 'u-automacao',
    nome: 'Robô Ingestão',
    email: 'robo@example.org',
    role: 'automacao',
    criado_em: '2026-04-10T10:00:00Z',
    centros: [],
  },
  {
    user_id: 'u-prof-um',
    nome: 'Bruno Professor',
    email: 'bruno@example.org',
    role: 'professor',
    criado_em: '2026-05-10T10:00:00Z',
    centros: ['c-1'],
  },
  {
    user_id: 'u-prof-novo',
    nome: 'Daniel Novo',
    email: 'daniel@example.org',
    role: 'professor',
    criado_em: '2026-11-20T10:00:00Z',
    centros: [],
  },
];

function payloadBase() {
  return structuredClone({ usuarios: USUARIOS_TESTE, centros: CENTROS_TESTE });
}

function linhasTabela() {
  return Array.from(document.querySelectorAll('.admin__tabela tbody tr'));
}

function botaoPorTexto(escopo, texto) {
  return Array.from(escopo.querySelectorAll('button')).find(
    (b) => b.textContent.trim() === texto
  );
}

function linhaPorNome(nome) {
  return linhasTabela().find((tr) => tr.querySelector('.admin__usuario-nome')?.textContent === nome);
}

beforeEach(() => {
  acessosUsuariosMock.mockReset();
  salvarAcessosMock.mockReset();
  fromMock.mockReset();
  rpcMock.mockReset();
  acessosUsuariosMock.mockResolvedValue({ dados: payloadBase(), erro: null });
  salvarAcessosMock.mockResolvedValue({ dados: { ok: true }, erro: null });
});

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
});

describe('página Admin — lista, ordem e rótulos', () => {
  it('ordena professores sem centro primeiro, depois professores, admins e agente/automação, com rótulos corretos', async () => {
    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 6);

    const nomes = linhasTabela().map(
      (tr) => tr.querySelector('.admin__usuario-nome')?.textContent
    );
    expect(nomes).toEqual([
      'Daniel Novo',
      'Bruno Professor',
      'Carla Professora',
      'Ana Admin',
      'Buriti',
      'Robô Ingestão',
    ]);

    const linhaNovo = linhaPorNome('Daniel Novo');
    expect(linhaNovo.textContent).toContain('Professor');
    expect(linhaNovo.querySelector('.admin__sem-centro')?.textContent).toBe('nenhum centro');

    const linhaBruno = linhaPorNome('Bruno Professor');
    expect(linhaBruno.textContent).toContain('1 centro · 30.901');

    const linhaCarla = linhaPorNome('Carla Professora');
    expect(linhaCarla.textContent).toContain('5 centros · 30.901, 30.902, 30.903, 30.904 +1');
    expect(linhaCarla.textContent).not.toContain('30.905');

    const linhaAna = linhaPorNome('Ana Admin');
    expect(linhaAna.textContent).toContain('Admin');
    expect(linhaAna.textContent).toContain('todos os centros');

    const linhaBuriti = linhaPorNome('Buriti');
    expect(linhaBuriti.textContent).toContain('Buriti (IA)');
    expect(linhaBuriti.textContent).toContain('2 centros · 30.901, 30.902');
    expect(linhaBuriti.querySelector('button')).toBeNull();
    expect(linhaBuriti.textContent).toContain('Muda só pelo banco, de propósito');

    const linhaRobo = linhaPorNome('Robô Ingestão');
    expect(linhaRobo.textContent).toContain('Automação');
    expect(linhaRobo.querySelector('button')).toBeNull();
    expect(linhaRobo.textContent).toContain('Muda só pelo banco, de propósito');

    expect(document.querySelector('.admin__busca-login')).toBeNull();
  });

  it('exibe busca por nome ou e-mail apenas quando há mais de 8 logins', async () => {
    const d = payloadBase();
    for (let i = 1; i <= 4; i += 1) {
      d.usuarios.push({
        user_id: `u-extra-${i}`,
        nome: `Extra ${i}`,
        email: `extra${i}@example.org`,
        role: 'professor',
        criado_em: null,
        centros: ['c-1'],
      });
    }
    acessosUsuariosMock.mockResolvedValueOnce({ dados: d, erro: null });

    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 10);

    const busca = document.querySelector('.admin__busca-login input');
    expect(busca).not.toBeNull();

    busca.value = 'carla@example.org';
    busca.dispatchEvent(new Event('input', { bubbles: true }));
    await esperarPor(() => linhasTabela().length === 1);
    expect(linhaPorNome('Carla Professora')).toBeDefined();
  });

  it('falha de leitura mostra AvisoFalha com Tentar de novo e não mostra nenhum centro', async () => {
    acessosUsuariosMock
      .mockResolvedValueOnce({ dados: null, erro: 'Não foi possível carregar os acessos.' })
      .mockResolvedValueOnce({ dados: payloadBase(), erro: null });

    render(<Admin usuarioId="u-admin-1" />, document.body);
    const aviso = await esperarPor(() => document.querySelector('.aviso-falha'));
    expect(aviso.textContent).toContain('Não foi possível carregar os acessos.');
    expect(document.querySelector('.admin__lista')).toBeNull();
    expect(document.querySelector('table')).toBeNull();
    expect(document.querySelector('.vazio')).toBeNull();
    expect(document.querySelector('.admin__sem-centro')).toBeNull();
    expect(document.body.textContent).not.toContain('0 centros');

    botaoPorTexto(aviso, 'Tentar de novo').click();
    await esperarPor(() => linhasTabela().length === 6);
    expect(acessosUsuariosMock).toHaveBeenCalledTimes(2);
  });
});

describe('página Admin — painel lateral e gravação', () => {
  it('impede o próprio admin de virar professor e permite editar outro admin', async () => {
    const d = payloadBase();
    d.usuarios.push({
      user_id: 'u-admin-2',
      nome: 'Beatriz Admin',
      email: 'beatriz@example.org',
      role: 'admin',
      criado_em: null,
      centros: ['c-2'],
    });
    acessosUsuariosMock.mockResolvedValue({ dados: d, erro: null });

    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 7);

    botaoPorTexto(linhaPorNome('Ana Admin'), 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));

    const select = painel.querySelector('select');
    const opcProfessor = select.querySelector('option[value="professor"]');
    expect(opcProfessor.disabled).toBe(true);
    expect(painel.textContent).toContain('Peça a outro administrador');
    expect(painel.textContent).toContain(
      'Admin vê todos os centros; a lista abaixo fica guardada caso ele volte a professor.'
    );

    const btnSalvar = botaoPorTexto(painel, 'Salvar');
    expect(btnSalvar.disabled).toBe(true);

    botaoPorTexto(painel, 'Cancelar').click();
    await esperarPor(() => !document.querySelector('.painel-lateral'));

    botaoPorTexto(linhaPorNome('Beatriz Admin'), 'Editar').click();
    const painelOutro = await esperarPor(() => document.querySelector('.painel-lateral'));
    const selectOutro = painelOutro.querySelector('select');
    expect(selectOutro.querySelector('option[value="professor"]').disabled).toBe(false);

    selectOutro.value = 'professor';
    selectOutro.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(painelOutro.querySelector('.admin__resumo').textContent).toContain(
      'Papel: Admin → Professor'
    );
  });

  it('mostra Encerrados fechado por padrão, busca, Marcar todos/Limpar só nos visíveis, resumo e salva lista completa', async () => {
    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 6);

    botaoPorTexto(linhaPorNome('Bruno Professor'), 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));

    const encerrados = painel.querySelector('details.admin__encerrados');
    expect(encerrados).not.toBeNull();
    expect(encerrados.open).toBe(false);
    expect(encerrados.querySelector('summary').textContent).toBe('Encerrados (1)');

    expect(botaoPorTexto(painel, 'Salvar').disabled).toBe(true);
    expect(painel.querySelector('.admin__centros-contador').textContent).toBe('1 centro marcado');

    const buscaCentro = painel.querySelector('.admin__busca-centro input');
    buscaCentro.value = 'Beta';
    buscaCentro.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    // "Marcar todos" marca apenas Beta (visível na busca), preservando Alpha (c-1).
    botaoPorTexto(painel, 'Marcar todos').click();
    await tick();
    expect(painel.querySelector('.admin__centros-contador').textContent).toBe('2 centros marcados');

    // "Limpar" com busca "Beta" limpa apenas Beta, mantendo Alpha (c-1) marcado!
    botaoPorTexto(painel, 'Limpar').click();
    await tick();
    expect(painel.querySelector('.admin__centros-contador').textContent).toBe('1 centro marcado');
    expect(botaoPorTexto(painel, 'Salvar').disabled).toBe(true);

    // Marca Beta novamente e muda papel para Admin.
    botaoPorTexto(painel, 'Marcar todos').click();
    await tick();
    const select = painel.querySelector('select');
    select.value = 'admin';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    const resumo = painel.querySelector('.admin__resumo').textContent;
    expect(resumo).toContain('Papel: Professor → Admin');
    expect(resumo).toContain('Passa a ver: 30.902');
    expect(painel.textContent).toContain(
      'Admin vê todos os centros; a lista abaixo fica guardada caso ele volte a professor.'
    );

    const atualizado = payloadBase();
    const brunoAtualizado = atualizado.usuarios.find((u) => u.user_id === 'u-prof-um');
    brunoAtualizado.role = 'admin';
    brunoAtualizado.centros = ['c-1', 'c-2'];
    acessosUsuariosMock.mockResolvedValueOnce({ dados: atualizado, erro: null });

    botaoPorTexto(painel, 'Salvar').click();
    await esperarPor(() => !document.querySelector('.painel-lateral'));

    expect(salvarAcessosMock).toHaveBeenCalledTimes(1);
    expect(salvarAcessosMock).toHaveBeenCalledWith('u-prof-um', 'admin', ['c-1', 'c-2']);
    expect(acessosUsuariosMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.admin__aviso').textContent).toBe(
      'Acessos de Bruno Professor salvos'
    );
  });

  it('tirar centro pede confirmação em dois passos antes de salvar', async () => {
    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 6);

    botaoPorTexto(linhaPorNome('Bruno Professor'), 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));

    const checkC1 = painel.querySelector('input[type="checkbox"][value="c-1"]');
    checkC1.checked = false;
    checkC1.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    expect(painel.querySelector('.admin__resumo').textContent).toContain('Deixa de ver: 30.901');

    botaoPorTexto(painel, 'Salvar').click();
    await tick();

    expect(salvarAcessosMock).not.toHaveBeenCalled();
    const confirmacao = painel.querySelector('.admin__confirmacao');
    expect(confirmacao).not.toBeNull();
    expect(confirmacao.textContent).toContain('30.901');

    botaoPorTexto(confirmacao, 'Cancelar').click();
    await tick();
    expect(painel.querySelector('.admin__confirmacao')).toBeNull();
    expect(salvarAcessosMock).not.toHaveBeenCalled();

    botaoPorTexto(painel, 'Salvar').click();
    await tick();
    botaoPorTexto(painel.querySelector('.admin__confirmacao'), 'Confirmar e salvar').click();
    await esperarPor(() => !document.querySelector('.painel-lateral'));

    expect(salvarAcessosMock).toHaveBeenCalledWith('u-prof-um', 'professor', []);
  });

  it('erro de gravação mantém as marcações no painel e mostra a mensagem', async () => {
    salvarAcessosMock.mockResolvedValueOnce({ dados: null, erro: 'Sem permissão' });

    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 6);

    botaoPorTexto(linhaPorNome('Daniel Novo'), 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));

    const checkC2 = painel.querySelector('input[type="checkbox"][value="c-2"]');
    checkC2.checked = true;
    checkC2.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    botaoPorTexto(painel, 'Salvar').click();
    const erro = await esperarPor(() => painel.querySelector('.aviso-falha'));

    expect(erro.textContent).toContain('Sem permissão');
    expect(document.querySelector('.painel-lateral')).not.toBeNull();
    expect(painel.querySelector('input[type="checkbox"][value="c-2"]').checked).toBe(true);
    expect(acessosUsuariosMock).toHaveBeenCalledTimes(1);
  });

  it('aceita centro sem código (null ou espaços) exibindo "sem código" sem mostrar UUID', async () => {
    const d = payloadBase();
    d.centros.push(
      { id: 'c-sem-uuid', code: null, name: 'Centro Sem Código', active: true },
      { id: 'c-espaco-uuid', code: '  ', name: 'Centro Espaço', active: true }
    );
    d.usuarios[5].centros = ['c-sem-uuid', 'c-espaco-uuid'];
    acessosUsuariosMock.mockResolvedValueOnce({ dados: d, erro: null });

    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 6);

    const linhaDaniel = linhaPorNome('Daniel Novo');
    expect(linhaDaniel.textContent).toContain('2 centros · sem código, sem código');
    expect(linhaDaniel.textContent).not.toContain('c-sem-uuid');
    expect(linhaDaniel.textContent).not.toContain('c-espaco-uuid');

    botaoPorTexto(linhaDaniel, 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.textContent).toContain('sem código — Centro Sem Código');
    expect(painel.textContent).toContain('sem código — Centro Espaço');

    const checkSem = painel.querySelector('input[type="checkbox"][value="c-sem-uuid"]');
    checkSem.checked = false;
    checkSem.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    expect(painel.querySelector('.admin__resumo').textContent).toContain('Deixa de ver: sem código');
    expect(painel.querySelector('.admin__resumo').textContent).not.toContain('c-sem-uuid');

    botaoPorTexto(painel, 'Salvar').click();
    await tick();
    expect(painel.querySelector('.admin__confirmacao').textContent).toContain(
      'Deixa de ver sem código. Confirmar?'
    );
    expect(painel.querySelector('.admin__confirmacao').textContent).not.toContain('c-sem-uuid');
  });

  it('rebaixar admin para professor exige confirmação mesmo sem remover centros e mostra resumo completo', async () => {
    const d = payloadBase();
    d.usuarios.push({
      user_id: 'u-admin-2',
      nome: 'Beatriz Admin',
      email: 'beatriz@example.org',
      role: 'admin',
      criado_em: null,
      centros: [],
    });
    acessosUsuariosMock.mockResolvedValue({ dados: d, erro: null });

    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 7);

    botaoPorTexto(linhaPorNome('Beatriz Admin'), 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));

    const select = painel.querySelector('select');
    select.value = 'professor';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    const resumo = painel.querySelector('.admin__resumo').textContent;
    expect(resumo).toContain('Papel: Admin → Professor');
    expect(resumo).toContain('Passa a ver: nenhum centro');
    expect(resumo).toContain('Deixa de ver: todos os centros');

    botaoPorTexto(painel, 'Salvar').click();
    await tick();

    expect(salvarAcessosMock).not.toHaveBeenCalled();
    const confirmacao = painel.querySelector('.admin__confirmacao');
    expect(confirmacao).not.toBeNull();
    expect(confirmacao.getAttribute('role')).toBe('alert');
    expect(confirmacao.textContent).toContain('Deixa de ver todos os centros. Confirmar?');

    botaoPorTexto(confirmacao, 'Confirmar e salvar').click();
    await esperarPor(() => !document.querySelector('.painel-lateral'));
    expect(salvarAcessosMock).toHaveBeenCalledWith('u-admin-2', 'professor', []);
  });

  it('Limpar com Encerrados fechado preserva centro encerrado marcado e envia na lista; abrir permite limpar', async () => {
    const d = payloadBase();
    const bruno = d.usuarios.find((u) => u.user_id === 'u-prof-um');
    bruno.centros = ['c-1', 'c-inativo'];
    acessosUsuariosMock.mockResolvedValue({ dados: d, erro: null });

    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 6);

    botaoPorTexto(linhaPorNome('Bruno Professor'), 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));

    const encerrados = painel.querySelector('details.admin__encerrados');
    expect(encerrados.open).toBe(false);
    expect(painel.querySelector('.admin__centros-contador').textContent).toBe('2 centros marcados');

    botaoPorTexto(painel, 'Limpar').click();
    await tick();
    expect(painel.querySelector('.admin__centros-contador').textContent).toBe('1 centro marcado');
    expect(painel.querySelector('input[type="checkbox"][value="c-inativo"]').checked).toBe(true);

    botaoPorTexto(painel, 'Salvar').click();
    await tick();
    botaoPorTexto(painel.querySelector('.admin__confirmacao'), 'Confirmar e salvar').click();
    await esperarPor(() => !document.querySelector('.painel-lateral'));
    expect(salvarAcessosMock).toHaveBeenCalledWith('u-prof-um', 'professor', ['c-inativo']);

    // Reabre, abre Encerrados e limpa também o inativo.
    botaoPorTexto(linhaPorNome('Bruno Professor'), 'Editar').click();
    const painel2 = await esperarPor(() => document.querySelector('.painel-lateral'));
    const detalhes2 = painel2.querySelector('details.admin__encerrados');
    detalhes2.querySelector('summary').click();
    await tick();
    expect(detalhes2.open).toBe(true);

    botaoPorTexto(painel2, 'Limpar').click();
    await tick();
    expect(painel2.querySelector('.admin__centros-contador').textContent).toBe('0 centros marcados');
    expect(painel2.querySelector('input[type="checkbox"][value="c-inativo"]').checked).toBe(false);
  });

  it('desabilita Editar durante recarga, mostra Atualizando…, usa dados atualizados e limpa aviso ao abrir outro painel', async () => {
    let resolverRecarga;
    const recargaControlada = new Promise((resolve) => {
      resolverRecarga = resolve;
    });

    acessosUsuariosMock
      .mockResolvedValueOnce({ dados: payloadBase(), erro: null })
      .mockReturnValueOnce(recargaControlada);

    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 6);

    botaoPorTexto(linhaPorNome('Bruno Professor'), 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    const checkC2 = painel.querySelector('input[type="checkbox"][value="c-2"]');
    checkC2.checked = true;
    checkC2.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    botaoPorTexto(painel, 'Salvar').click();
    await esperarPor(() => !document.querySelector('.painel-lateral'));

    expect(document.querySelector('.admin__atualizando')?.textContent).toContain('Atualizando…');
    expect(document.querySelector('.admin__aviso')?.textContent).toBe(
      'Acessos de Bruno Professor salvos'
    );
    const botoesEditar = Array.from(document.querySelectorAll('.admin__tabela button'));
    expect(botoesEditar.length).toBeGreaterThan(0);
    expect(botoesEditar.every((b) => b.disabled)).toBe(true);

    const atualizado = payloadBase();
    atualizado.usuarios.find((u) => u.user_id === 'u-prof-um').centros = ['c-1', 'c-2'];
    resolverRecarga({ dados: atualizado, erro: null });

    await esperarPor(() => !document.querySelector('.admin__atualizando'));
    expect(
      Array.from(document.querySelectorAll('.admin__tabela button')).every((b) => !b.disabled)
    ).toBe(true);

    botaoPorTexto(linhaPorNome('Bruno Professor'), 'Editar').click();
    const painelReaberto = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(document.querySelector('.admin__aviso')).toBeNull();
    expect(painelReaberto.querySelector('input[type="checkbox"][value="c-2"]').checked).toBe(true);
  });

  it('mantém a lista anterior e mostra AvisoFalha se a recarga pós-salvamento falhar', async () => {
    acessosUsuariosMock
      .mockResolvedValueOnce({ dados: payloadBase(), erro: null })
      .mockResolvedValueOnce({ dados: null, erro: 'Falha de rede' })
      .mockResolvedValueOnce({ dados: payloadBase(), erro: null });

    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 6);

    botaoPorTexto(linhaPorNome('Daniel Novo'), 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    const checkC1 = painel.querySelector('input[type="checkbox"][value="c-1"]');
    checkC1.checked = true;
    checkC1.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    botaoPorTexto(painel, 'Salvar').click();
    const avisoFalha = await esperarPor(() => document.querySelector('.aviso-falha'));
    expect(avisoFalha.textContent).toContain(
      'Os acessos foram salvos, mas a lista não recarregou.'
    );
    expect(linhasTabela()).toHaveLength(6);

    botaoPorTexto(avisoFalha, 'Tentar de novo').click();
    await esperarPor(() => !document.querySelector('.aviso-falha'));
    expect(acessosUsuariosMock).toHaveBeenCalledTimes(3);
  });

  it('move foco para Confirmar e salvar ao entrar no segundo passo e devolve foco para Salvar ao cancelar', async () => {
    render(<Admin usuarioId="u-admin-1" />, document.body);
    await esperarPor(() => linhasTabela().length === 6);

    botaoPorTexto(linhaPorNome('Bruno Professor'), 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));

    const checkC1 = painel.querySelector('input[type="checkbox"][value="c-1"]');
    checkC1.checked = false;
    checkC1.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    botaoPorTexto(painel, 'Salvar').click();
    const confirmacao = await esperarPor(() => painel.querySelector('.admin__confirmacao'));
    expect(confirmacao.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(botaoPorTexto(confirmacao, 'Confirmar e salvar'));

    botaoPorTexto(confirmacao, 'Cancelar').click();
    await esperarPor(() => !painel.querySelector('.admin__confirmacao'));
    expect(document.activeElement).toBe(botaoPorTexto(painel, 'Salvar'));
  });

  it('guarda de próprio admin falha fechada quando usuarioId não é informado', async () => {
    render(<Admin />, document.body);
    await esperarPor(() => linhasTabela().length === 6);

    botaoPorTexto(linhaPorNome('Ana Admin'), 'Editar').click();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    const select = painel.querySelector('select');
    expect(select.querySelector('option[value="professor"]').disabled).toBe(true);
    expect(painel.textContent).toContain('Peça a outro administrador');
  });
});

describe('serviço de acessos e modo exemplo', () => {
  it('validador recusa payload sem usuarios ou sem centros ou com campos inválidos, e aceita code nulo ou em branco', () => {
    expect(validarAcessosUsuarios(null)).toBe(false);
    expect(validarAcessosUsuarios({ centros: [] })).toBe(false);
    expect(validarAcessosUsuarios({ usuarios: [] })).toBe(false);
    expect(
      validarAcessosUsuarios({
        usuarios: [{ user_id: 'u1', nome: 'Ana', email: 'a@example.org', role: 'invalido', centros: [] }],
        centros: [],
      })
    ).toBe(false);
    expect(
      validarAcessosUsuarios({
        usuarios: [],
        centros: [{ id: 'c1', code: '30.901', name: 'Centro', active: 'sim' }],
      })
    ).toBe(false);
    expect(
      validarAcessosUsuarios({
        usuarios: [],
        centros: [{ id: 'c1', code: 123, name: 'Centro', active: true }],
      })
    ).toBe(false);
    expect(
      validarAcessosUsuarios({
        usuarios: [{ user_id: 'u1', nome: 'Ana', email: 'a@example.org', role: 'professor', centros: [] }],
        centros: [
          { id: 'c1', code: null, name: 'Centro Sem Código', active: true },
          { id: 'c2', code: '  ', name: 'Centro Espaço', active: false },
        ],
      })
    ).toBe(true);
  });

  it('acessosUsuarios falha quando qualquer uma das 3 leituras falha, normaliza code e salvarAcessos barra agente e erros crus', async () => {
    const montarFrom = ({ usersRes, upRes, projRes }) => {
      fromMock.mockImplementation((tabela) => {
        if (tabela === 'app_users') {
          return { select: () => Promise.resolve(usersRes) };
        }
        if (tabela === 'user_projects') {
          return { select: () => Promise.resolve(upRes) };
        }
        if (tabela === 'projects') {
          return { select: () => ({ order: () => Promise.resolve(projRes) }) };
        }
        throw new Error(`Tabela inesperada: ${tabela}`);
      });
    };

    montarFrom({
      usersRes: {
        data: [
          {
            user_id: 'u-1',
            role: 'professor',
            display_name: '',
            email: 'visitante@example.org',
            created_at: '2026-11-20T00:00:00Z',
          },
        ],
        error: null,
      },
      upRes: { data: [{ user_id: 'u-1', project_id: 'c-1' }], error: null },
      projRes: {
        data: [
          { id: 'c-1', code: null, name: 'Centro Um', active: true },
          { id: 'c-2', code: '  ', name: 'Centro Dois', active: false },
        ],
        error: null,
      },
    });

    const ok = await _realAcessosUsuarios();
    expect(ok.erro).toBeNull();
    expect(ok.dados.usuarios[0].nome).toBe('visitante');
    expect(ok.dados.usuarios[0].centros).toEqual(['c-1']);
    expect(ok.dados.centros).toEqual([
      { id: 'c-1', code: '', name: 'Centro Um', active: true },
      { id: 'c-2', code: '', name: 'Centro Dois', active: false },
    ]);

    montarFrom({
      usersRes: { data: null, error: { message: 'falha app_users' } },
      upRes: { data: [], error: null },
      projRes: { data: [], error: null },
    });
    const falhaUsers = await _realAcessosUsuarios();
    expect(falhaUsers.dados).toBeNull();
    expect(falhaUsers.erro).toBe('Não foi possível carregar os acessos.');

    montarFrom({
      usersRes: { data: [], error: null },
      upRes: { data: null, error: { message: 'falha user_projects' } },
      projRes: { data: [], error: null },
    });
    const falhaUp = await _realAcessosUsuarios();
    expect(falhaUp.dados).toBeNull();
    expect(falhaUp.erro).toBe('Não foi possível carregar os acessos.');

    montarFrom({
      usersRes: { data: [], error: null },
      upRes: { data: [], error: null },
      projRes: { data: null, error: { message: 'falha projects' } },
    });
    const falhaProj = await _realAcessosUsuarios();
    expect(falhaProj.dados).toBeNull();
    expect(falhaProj.erro).toBe('Não foi possível carregar os acessos.');

    const recusaAgente = await _realSalvarAcessos('u-1', 'agente', ['c-1']);
    expect(recusaAgente).toEqual({ dados: null, erro: 'Papel inválido.' });
    expect(rpcMock).not.toHaveBeenCalled();

    rpcMock.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });
    const semPerm = await _realSalvarAcessos('u-1', 'professor', ['c-1']);
    expect(semPerm).toEqual({ dados: null, erro: 'Sem permissão' });

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23503',
        message: 'insert or update on table "user_projects" violates foreign key constraint "fk_proj"',
      },
    });
    const fkCru = await _realSalvarAcessos('u-1', 'professor', ['c-1']);
    expect(fkCru).toEqual({ dados: null, erro: 'Não foi possível salvar os acessos.' });

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'P0001',
        message: 'duplicate key value violates unique constraint "pk_user_projects"',
      },
    });
    const constraintCru = await _realSalvarAcessos('u-1', 'professor', ['c-1']);
    expect(constraintCru).toEqual({ dados: null, erro: 'Não foi possível salvar os acessos.' });

    rpcMock.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Papel inválido no banco' } });
    const msgBanco = await _realSalvarAcessos('u-1', 'admin', ['c-1']);
    expect(msgBanco).toEqual({ dados: null, erro: 'Papel inválido no banco' });

    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const salvo = await _realSalvarAcessos('u-1', 'professor', ['c-1']);
    expect(salvo).toEqual({ dados: { ok: true }, erro: null });
    expect(rpcMock).toHaveBeenLastCalledWith('save_user_assignments', {
      p_user_id: 'u-1',
      p_role: 'professor',
      p_project_ids: ['c-1'],
    });
  });

  it('modo exemplo não tem @ fora de example.org, inclui segundo admin e salvarAcessos altera a memória do módulo', async () => {
    const fonteExemplo = fs.readFileSync(
      path.resolve('src/servicos/dadosExemplo.js'),
      'utf8'
    );
    const arrobas = fonteExemplo.match(/[^\s"'`<>]+@[^\s"'`<>]+/g) || [];
    expect(arrobas.length).toBeGreaterThanOrEqual(7);
    for (const email of arrobas) {
      expect(email.toLowerCase()).toMatch(/@example\.org$/);
    }

    const antes = await dadosExemplo.acessosUsuarios();
    expect(antes.erro).toBeNull();
    expect(antes.dados.usuarios).toHaveLength(7);
    expect(
      antes.dados.usuarios.filter((u) => u.role === 'admin' && u.user_id !== 'exemplo-admin')
    ).toHaveLength(1);
    expect(antes.dados.centros.some((c) => c.active === false)).toBe(true);

    const profSemCentro = antes.dados.usuarios.find(
      (u) => u.role === 'professor' && u.centros.length === 0
    );
    expect(profSemCentro).toBeDefined();

    const recusaAgenteExemplo = await dadosExemplo.salvarAcessos(profSemCentro.user_id, 'agente', []);
    expect(recusaAgenteExemplo.dados).toBeNull();
    expect(recusaAgenteExemplo.erro).toContain('Papel inválido');

    const primeiroCentro = antes.dados.centros.find((c) => c.active).id;
    const gravou = await dadosExemplo.salvarAcessos(profSemCentro.user_id, 'professor', [
      primeiroCentro,
    ]);
    expect(gravou).toEqual({ dados: { ok: true }, erro: null });

    const depois = await dadosExemplo.acessosUsuarios();
    expect(
      depois.dados.usuarios.find((u) => u.user_id === profSemCentro.user_id).centros
    ).toEqual([primeiroCentro]);

    // Restaura estado inicial em memória do módulo de exemplo.
    await dadosExemplo.salvarAcessos(profSemCentro.user_id, 'professor', []);
  });
});
