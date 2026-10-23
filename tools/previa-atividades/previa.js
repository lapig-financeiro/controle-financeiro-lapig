// Prévia da tela de Atividades sem Supabase: Auth, dados e RPCs falsos.
// Serve só para ver a tela com dados de mentira — não fala com o banco nem grava nada.

import { HOJE_FIXO, PROJETOS, criarBanco } from './dados.js';

// "Hoje" fixo: a prévia mostra as mesmas faixas em qualquer dia.
const DateReal = Date;
class DateDaPrevia extends DateReal {
  constructor(...args) {
    if (args.length === 0) super(HOJE_FIXO);
    else super(...args);
  }
  static now() { return HOJE_FIXO; }
}
window.Date = DateDaPrevia;

let db = criarBanco();
let seq = 0;
let sessao = 'admin';

const CONTAS = {
  admin: { id: 'ana', admin: true },
  professor: { id: 'bruno', admin: false },
};

window.Auth = {
  isAdmin: () => CONTAS[sessao].admin,
  getUser: () => ({ id: CONTAS[sessao].id }),
  getRole: () => (CONTAS[sessao].admin ? 'admin' : 'professor'),
  getAllowedProjectIds: () => PROJETOS.map(p => p.id),
};

window.Router = {
  register: () => {},
  getCurrent: () => 'atividades',
  navigate: () => {},
};

window.showToast = (texto) => {
  const el = document.createElement('div');
  el.className = 'previa-toast';
  el.textContent = texto;
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
};

window.detalheTecnico = html => html;
window.confirmAction = mensagem => Promise.resolve(window.confirm(mensagem));

window.createModal = ({ title, bodyHTML, saveLabel = 'Salvar', onSave, maxWidth = '560px' }) => {
  const caixa = document.createElement('div');
  caixa.className = 'previa-modal';
  caixa.innerHTML = `<div class="previa-modal__caixa" role="dialog" aria-modal="true" style="max-width:${maxWidth}">
    <h2 class="previa-modal__titulo">${title}</h2>
    <div class="previa-modal__corpo">${bodyHTML}</div>
    <div class="previa-modal__erro" data-erro></div>
    <div class="previa-modal__acoes">
      <button type="button" class="btn btn--secondary" data-fechar>Cancelar</button>
      <button type="button" class="btn btn--primary" data-salvar>${saveLabel}</button>
    </div>
  </div>`;
  const fechar = () => caixa.remove();
  caixa.querySelector('[data-fechar]').addEventListener('click', fechar);
  caixa.querySelector('[data-salvar]').addEventListener('click', async () => {
    try {
      await onSave();
      fechar();
    } catch (e) {
      caixa.querySelector('[data-erro]').textContent = e.message;
    }
  });
  caixa.addEventListener('click', e => { if (e.target === caixa) fechar(); });
  document.body.append(caixa);
  if (window.lucide) window.lucide.createIcons();
  return caixa;
};

// ---------- Supabase falso ----------
function filtrar(rows, filtros) {
  return rows.filter(r => filtros.every(([op, campo, valor]) => {
    if (op === 'eq') return r[campo] === valor;
    if (op === 'in') return valor.includes(r[campo]);
    if (op === 'gte') return r[campo] >= valor;
    if (op === 'not') return r[campo] != null;
    return true;
  }));
}

function from(tabela) {
  const filtros = [];
  let single = false, inicio = 0, fim = Infinity;
  const q = {};
  for (const nome of ['select', 'order', 'neq']) q[nome] = () => q;
  q.eq = (campo, valor) => { filtros.push(['eq', campo, valor]); return q; };
  q.in = (campo, valor) => { filtros.push(['in', campo, valor]); return q; };
  q.gte = (campo, valor) => { filtros.push(['gte', campo, valor]); return q; };
  q.not = (campo) => { filtros.push(['not', campo]); return q; };
  q.range = (a, b) => { inicio = a; fim = b; return q; };
  // O limit do cartão é o dos eventos aninhados (limit(10, { referencedTable })), não o da lista.
  q.limit = () => q;
  q.single = () => { single = true; return q; };
  q.then = (ok, falha) => {
    const rows = filtrar(db[tabela] || [], filtros);
    const visiveis = tabela === 'tarefas' ? rows.filter(podeVer) : rows;
    const data = single ? (visiveis[0] || null) : visiveis.slice(inicio, fim + 1);
    return Promise.resolve({ data, error: null }).then(ok, falha);
  };
  return q;
}

const achar = id => db.tarefas.find(t => t.id === id);
const nomeDe = id => (db.app_users.find(u => u.user_id === id) || {}).display_name || null;

// O RLS do app decide o que cada login vê. Aqui, o professor só enxerga os centros dele.
const CENTROS_DO_PROFESSOR = ['30.102', '30.104'];
const podeVer = t => sessao === 'admin' || t.responsavel_id === 'bruno' || CENTROS_DO_PROFESSOR.includes(t.projects?.code);

const rpc = async (nome, args = {}) => {
  if (nome === 'criar_tarefa_na_tela') {
    const id = 'nova' + (++seq);
    const projeto = db.projects.find(p => p.id === args.p.project_id);
    db.tarefas.push({
      id,
      titulo: args.p.titulo,
      status: 'em_andamento',
      situacao: null,
      prazo: args.p.prazo || null,
      precisa_atencao: false,
      motivo_atencao: null,
      aviso_responsavel: null,
      responsavel_id: args.p_responsavel || null,
      responsavel: nomeDe(args.p_responsavel),
      criada_em: new Date().toISOString(),
      concluida_em: null,
      projects: projeto ? { code: projeto.code, name: projeto.name } : null,
      atualizacao: null,
      eventos: [],
      tarefa_passos: (args.p.passos || []).map((p, i) => ({
        id: `${id}-p${i + 1}`, ordem: i + 1, descricao: p.descricao, quem: p.quem || null,
        executor: 'pessoa', estado: 'pendente', feito: null, evento: null,
      })),
    });
    return { data: id, error: null };
  }
  if (nome === 'concluir_tarefa') {
    const t = achar(args.p_tarefa);
    if (t) { t.status = 'concluida'; t.concluida_em = new Date().toISOString(); }
  }
  if (nome === 'confirmar_passo' || nome === 'dispensar_passo') {
    const passo = db.tarefas.flatMap(t => t.tarefa_passos).find(s => s.id === args.p_passo);
    if (passo) passo.estado = nome === 'confirmar_passo' ? 'confirmado' : 'dispensado';
  }
  if (nome === 'atribuir_tarefa') {
    const t = achar(args.p_tarefa);
    if (t) { t.responsavel_id = args.p_user || null; t.responsavel = nomeDe(args.p_user); }
  }
  if (nome === 'atualizar_prazo') {
    const t = achar(args.p_tarefa);
    if (t) t.prazo = args.p_prazo || null;
  }
  if (nome === 'registrar_atualizacao') {
    const t = achar(args.p_tarefa);
    if (t) {
      t.situacao = args.p_situacao;
      t.atualizacao = {
        tipo: 'atualizacao', origem: 'humano', ocorrido_em: new Date().toISOString(),
        detalhe: { situacao: args.p_situacao, texto: args.p_texto, por: nomeDe(t.responsavel_id) || 'Pessoa', link: args.p_link || null },
      };
      if (args.p_situacao === 'feito') { t.status = 'concluida'; t.concluida_em = new Date().toISOString(); }
    }
  }
  if (nome === 'registrar_nota') {
    const t = achar(args.p_tarefa);
    if (t) {
      t.eventos.unshift({ id: 'ev' + (++seq), tipo: 'nota', origem: 'humano', resumo: args.p_texto,
        detalhe: { por: 'Ana Ribeiro' }, ocorrido_em: new Date().toISOString() });
    }
  }
  if (nome === 'centros_das_tarefas') {
    return { data: (args.p_ids || []).map(id => ({ tarefa_id: id, centro_custo: (achar(id)?.projects || {}).code || '' })), error: null };
  }
  return { data: null, error: null };
};

window.supabaseClient = { from, rpc };

// ---------- Carregar a tela real e trocar de login ----------
function carregarScript(src) {
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => falha(new Error('Falha ao carregar ' + src));
    document.head.append(s);
  });
}

async function desenhar() {
  const container = document.getElementById('page-content');
  if (!container) return;
  await window.AtividadesPage.render(container);
  window.scrollTo({ top: 0 });
}

const seletor = document.querySelector('[data-login]');
const params = new URLSearchParams(window.location.search);
if (params.get('login') === 'professor') {
  sessao = 'professor';
  if (seletor) seletor.value = 'professor';
}
if (['minha', 'equipe'].includes(params.get('vista'))) {
  try { localStorage.setItem('atividades:vista', params.get('vista')); } catch { /* sem armazenamento */ }
}
seletor?.addEventListener('change', async () => {
  sessao = seletor.value;
  await desenhar();
});

document.querySelector('[data-hoje]').textContent = new Date().toLocaleDateString('pt-BR');

await carregarScript('../../frontend/js/pages/buriti-tarefas.js');
await carregarScript('../../frontend/js/pages/atividades.js');
await desenhar();
if (params.get('abrir')) {
  document.querySelector(`[data-id="${CSS.escape(params.get('abrir'))}"] [data-abrir]`)?.click();
}
