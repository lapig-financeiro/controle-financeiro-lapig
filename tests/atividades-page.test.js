// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeAttr, escapeAttrJs } from '../frontend/js/pure-fns.js';
import * as f from '../frontend/js/components/buriti-tarefas.js';

const controlador = readFileSync(resolve('frontend/js/pages/buriti-tarefas.js'), 'utf8');
const pagina = readFileSync(resolve('frontend/js/pages/atividades.js'), 'utf8');
let db, erros, chamadas, root, admin, eu;
const hoje = new Date();
const dia = n => { const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const passo = (id, estado = 'pendente', descricao = 'Fazer') => ({ id: 'p-' + id, ordem: 1, descricao, quem: null, executor: 'pessoa', estado });
const tarefa = (id, extra = {}) => ({ id, titulo: 'Tarefa ' + id, status: 'em_andamento', prazo: null, situacao: null,
  precisa_atencao: false, aviso_responsavel: null, responsavel: 'Victor Amaral', responsavel_id: 'victor',
  projects: { code: '30.068', name: 'CEMPA FAPEG' }, tarefa_passos: [passo(id)], eventos: [], criada_em: '2026-10-01',
  atualizacao: null, ...extra });

function from(tabela) {
  const filtros = [], log = [tabela]; chamadas.push(log);
  let single = false, inicio = 0, fim = Infinity;
  const q = {};
  for (const nome of ['select', 'order', 'limit', 'eq', 'neq', 'in', 'gte', 'not', 'range', 'single']) {
    q[nome] = (...args) => {
      log.push([nome, ...args]);
      if (['eq', 'neq', 'in', 'gte', 'not'].includes(nome)) filtros.push([nome, ...args]);
      if (nome === 'single') single = true;
      if (nome === 'range') [inicio, fim] = args;
      return q;
    };
  }
  q.then = (resolve, reject) => {
    let rows = db[tabela] || [];
    for (const [op, campo, valor] of filtros) {
      if (op === 'eq') rows = rows.filter(r => r[campo] === valor);
      if (op === 'neq') rows = rows.filter(r => r[campo] !== valor);
      if (op === 'in') rows = rows.filter(r => valor.includes(r[campo]));
      if (op === 'gte') rows = rows.filter(r => r[campo] >= valor);
      if (op === 'not') rows = rows.filter(r => r[campo] != null);
    }
    return Promise.resolve({ data: single ? rows[0] : rows.slice(inicio, fim + 1), error: erros[tabela] || null }).then(resolve, reject);
  };
  return q;
}

beforeEach(() => {
  db = {
    tarefas: [
      tarefa('vencida', { prazo: dia(-2), titulo: 'Prorrogação', responsavel: 'arthurpietro.lapig', responsavel_id: 'arthur',
        precisa_atencao: true, motivo_atencao: 'Prazo estourado' }),
      tarefa('minha', { titulo: 'Remanejamento de rubricas', tarefa_passos: [passo('minha', 'pendente', 'Remanejar rubricas')] }),
      tarefa('fora', { status: 'aguardando_terceiro', titulo: 'Ofício da FAPEG', projects: { code: '30.110', name: 'CEMPA SECTI' } }),
      tarefa('outra', { titulo: 'Comprar passagens', responsavel: 'arthurpietro.lapig', responsavel_id: 'arthur' }),
      tarefa('feita', { status: 'concluida', titulo: 'Prestação enviada', concluida_em: new Date().toISOString() }),
    ],
    projects: [{ id: 'p106', code: '30.106', name: 'Parques Urbanos' }, { id: 'p68', code: '30.068', name: 'CEMPA FAPEG' }],
    app_users: [{ user_id: 'victor', display_name: 'Victor Amaral', role: 'admin' }, { user_id: 'arthur', display_name: 'arthurpietro.lapig', role: 'professor' }],
  };
  erros = {}; chamadas = []; admin = true; eu = 'victor';
  document.body.innerHTML = '<li data-minhas-tarefas hidden></li><li data-minhas-status hidden></li>';
  root = document.createElement('div'); document.body.append(root);
  window.BuritiTarefas = f;
  vi.stubGlobal('escapeAttr', escapeAttr); vi.stubGlobal('escapeAttrJs', escapeAttrJs);
  vi.stubGlobal('Auth', { isAdmin: () => admin, getUser: () => ({ id: eu }) });
  vi.stubGlobal('Router', { register: vi.fn() });
  vi.stubGlobal('lucide', { createIcons: vi.fn() }); vi.stubGlobal('showToast', vi.fn());
  vi.stubGlobal('detalheTecnico', html => html);
  vi.stubGlobal('confirmAction', vi.fn().mockResolvedValue(true));
  vi.stubGlobal('createModal', vi.fn());
  vi.stubGlobal('supabaseClient', { from, rpc: vi.fn(async (nome, args) => {
    if (nome === 'concluir_tarefa') {
      const t = db.tarefas.find(x => x.id === args.p_tarefa);
      t.status = 'concluida'; t.concluida_em = new Date().toISOString();
    }
    if (nome === 'confirmar_passo') db.tarefas.flatMap(t => t.tarefa_passos).find(s => s.id === args.p_passo).estado = 'confirmado';
    if (nome === 'criar_tarefa_na_tela') {
      db.tarefas.push(tarefa('nova', { titulo: args.p.titulo, prazo: args.p.prazo, responsavel_id: args.p_responsavel,
        responsavel: args.p_responsavel === 'arthur' ? 'arthurpietro.lapig' : 'Victor Amaral',
        tarefa_passos: args.p.passos.map((s, i) => ({ ...passo('nova' + i), descricao: s.descricao, quem: s.quem || null, ordem: i + 1 })) }));
      return { data: 'nova', error: null };
    }
    return { data: null, error: null };
  }) });
  new Function(controlador)();
  new Function(pagina)();
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const faixas = () => [...root.querySelectorAll('.ativ__faixa')].map(g => [g.querySelector('.ativ__cabeca').textContent.trim(),
  [...g.querySelectorAll('.ativ__titulo')].map(t => t.textContent.trim())]);

describe('tela de Atividades', () => {
  it('Minhas tarefas abre nas faixas por tempo e a linha é curta', async () => {
    await window.AtividadesPage.render(root);
    expect(faixas()).toEqual([
      ['Atrasadas e hoje', ['Prorrogação']],
      ['Sem prazo', ['Remanejamento de rubricas']],
      ['Esperando', ['Ofício da FAPEG']],
    ]);
    // A tarefa de outra pessoa sem atenção fica só na Equipe.
    expect(root.querySelector('[data-id="outra"]')).toBeNull();
    // A encerrada não aparece na vista principal.
    expect(root.querySelector('[data-id="feita"]')).toBeNull();

    const vencida = root.querySelector('[data-id="vencida"]');
    expect(vencida.querySelector('.ativ__prazo').textContent).toBe('há 2 dias');
    expect(vencida.querySelector('.ativ__prazo').className).toContain('ativ__prazo--atrasado');
    expect(vencida.querySelector('.ativ__quem').textContent).toBe('Arthurpietro');
    expect(vencida.querySelector('.ativ__sinal').textContent).toBe('precisa de você');
    // Na sua, a linha não repete "Você".
    expect(root.querySelector('[data-id="minha"] .ativ__quem')).toBeNull();
    expect(root.querySelector('[data-vista="minha"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('Equipe agrupa por pessoa e volta para Minhas tarefas', async () => {
    await window.AtividadesPage.render(root);
    root.querySelector('[data-vista="equipe"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-pessoa="arthur"]')).not.toBeNull());
    expect([...root.querySelectorAll('.ativ__pessoa-nome')].map(n => n.firstChild.textContent.trim()))
      .toEqual(['Arthurpietro', 'Victor Amaral']);
    expect(root.querySelector('[data-pessoa="arthur"] [data-id="outra"]')).not.toBeNull();
    expect(root.querySelector('[data-pessoa="arthur"] [data-id="vencida"]')).not.toBeNull();
    // Cada bloco repete as faixas.
    expect([...root.querySelectorAll('[data-pessoa="arthur"] .ativ__cabeca')].map(h => h.textContent.trim()))
      .toEqual(['Atrasadas e hoje', 'Sem prazo']);
    root.querySelector('[data-vista="minha"]').click();
    expect(root.querySelector('[data-id="outra"]')).toBeNull();
  });

  it('abre o cartão completo, conclui e tira da lista', async () => {
    await window.AtividadesPage.render(root);
    root.querySelector('[data-id="minha"] [data-abrir]').click();
    const detalhe = root.querySelector('[data-id="minha"] .ativ__detalhe');
    expect(detalhe.hidden).toBe(false);
    expect(detalhe.querySelector('.buriti-cartao__topo')).toBeNull();
    detalhe.querySelector('[data-acao="concluir"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-id="minha"]')).toBeNull());
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining('O passo em aberto será confirmado'));
    const nomes = supabaseClient.rpc.mock.calls.map(c => c[0]).filter(n => n !== 'centros_das_tarefas');
    expect(nomes).toEqual(['confirmar_passo', 'concluir_tarefa']);
  });

  it('anota numa linha só e mostra a prévia antes', async () => {
    await window.AtividadesPage.render(root);
    const campo = root.querySelector('[data-anotar-texto]');
    expect(root.querySelector('[data-anotar-previa]').hidden).toBe(true);
    campo.value = '30.106 pedido de salgados até 31/10 @Arthur';
    campo.dispatchEvent(new Event('input'));
    expect(root.querySelector('[data-anotar-previa]').textContent).toBe('30.106 · Pedido de salgados · até 31/10 · com arthurpietro.lapig');
    root.querySelector('[data-anotar]').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(supabaseClient.rpc.mock.calls.some(c => c[0] === 'criar_tarefa_na_tela')).toBe(true));
    const [, args] = supabaseClient.rpc.mock.calls.find(c => c[0] === 'criar_tarefa_na_tela');
    expect(args.p).toMatchObject({ project_id: 'p106', titulo: 'Pedido de salgados', passos: [{ descricao: 'Pedido de salgados', quem: 'arthurpietro.lapig' }] });
    expect(args.p.prazo).toMatch(/-10-31$/);
    expect(args.p_responsavel).toBe('arthur');
    await vi.waitFor(() => expect(campo.value).toBe(''));
    // Foi para a Equipe (é do Arthur), não para a minha lista.
    root.querySelector('[data-vista="equipe"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-id="nova"]')).not.toBeNull());
  });

  it('login sem nome no sistema anota para si mesmo', async () => {
    db.app_users[0].display_name = null;
    await window.AtividadesPage.render(root);
    const campo = root.querySelector('[data-anotar-texto]');
    campo.value = '30.068 remanejar rubricas';
    campo.dispatchEvent(new Event('input'));
    expect(root.querySelector('[data-anotar-previa]').textContent).toBe('30.068 · Remanejar rubricas · sem prazo · com você');
    root.querySelector('[data-anotar]').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.querySelector('[data-id="nova"]')).not.toBeNull());
    const [, args] = supabaseClient.rpc.mock.calls.find(c => c[0] === 'criar_tarefa_na_tela');
    expect(args.p_responsavel).toBe('victor');
    expect(args.p.passos).toEqual([{ descricao: 'Remanejar rubricas' }]);
  });

  it('entrada inválida não chama o banco', async () => {
    await window.AtividadesPage.render(root);
    root.querySelector('[data-anotar-texto]').value = 'remanejar sem centro';
    root.querySelector('[data-anotar]').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(root.querySelector('[data-anotar-previa]').classList.contains('ativ__previa--erro')).toBe(true);
    expect(supabaseClient.rpc.mock.calls.some(c => c[0] === 'criar_tarefa_na_tela')).toBe(false);
  });

  it('quem não é admin não anota e a Minhas tarefas mostra só o que é dele', async () => {
    admin = false; eu = 'arthur';
    db.tarefas = db.tarefas.filter(t => t.responsavel_id === 'arthur');
    await window.AtividadesPage.render(root);
    expect(root.querySelector('[data-anotar]')).toBeNull();
    expect(faixas()).toEqual([['Atrasadas e hoje', ['Prorrogação']], ['Sem prazo', ['Comprar passagens']]]);
    // A linha da própria pessoa não traz o selo "quem".
    expect(root.querySelector('[data-id="vencida"] .ativ__quem')).toBeNull();
    // Sem admin, nada de "precisa de você".
    expect(root.querySelector('[data-id="vencida"] .ativ__sinal')).toBeNull();
  });

  it('encerradas ficam num acesso discreto, fora da vista principal', async () => {
    await window.AtividadesPage.render(root);
    expect(root.querySelector('[data-id="feita"]')).toBeNull();
    root.querySelector('[data-encerradas]').click();
    await vi.waitFor(() => expect(faixas()).toEqual([['Encerradas', ['Prestação enviada']]]));
    expect(root.querySelector('[data-voltar]').hidden).toBe(false);
    root.querySelector('[data-voltar]').click();
    await vi.waitFor(() => expect(faixas()[0][0]).toBe('Atrasadas e hoje'));
  });

  it('falha na consulta vira aviso, não lista vazia', async () => {
    erros.tarefas = { message: 'rede' };
    await window.AtividadesPage.render(root);
    expect(root.textContent).toContain('Não foi possível consultar as atividades');
    expect(root.textContent).not.toContain('Nada com você agora');
  });
});
