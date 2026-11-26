/* ============================================================
   Histórico de conversas da Análise (migração 075)
   ============================================================
   Porta única da tela para as quatro RPCs da 075, no mesmo padrão
   `{ dados, erro }` de `dados.js`:

     listarConversas({ limite, antes }) → { dados: [...], erro }
     lerConversa(id)                    → { dados: {...}, erro }
     renomearConversa(id, titulo)       → { dados: null, erro }
     excluirConversa(id)                → { dados: null, erro }

   Falha de consulta nunca vira lista vazia: `dados` fica nulo e a
   tela mostra o aviso com "Tentar de novo". No modo exemplo
   (`npm run dev:exemplo`), as funções equivalentes de
   `analiseExemplo.js` entram no lugar do Supabase.
   ============================================================ */

import { supabase } from './supabase.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MENSAGEM_LISTAR = 'Não foi possível carregar as conversas.';
const MENSAGEM_LER = 'Não foi possível carregar esta conversa.';
const MENSAGEM_RENOMEAR = 'Não foi possível renomear a conversa.';
const MENSAGEM_EXCLUIR = 'Não foi possível excluir a conversa.';
const MENSAGEM_NAO_DISPONIVEL = 'Esta conversa não está mais disponível.';
const MENSAGEM_TITULO = 'O título precisa ter entre 1 e 120 caracteres.';

function modoExemplo(env = import.meta.env) {
  return Boolean(env?.DEV && env?.VITE_DADOS === 'exemplo');
}

function dataValida(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return false;
  const data = new Date(valor);
  return !Number.isNaN(data.getTime());
}

function conversaValida(item) {
  return Boolean(
    item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      UUID.test(item.id) &&
      typeof item.titulo === 'string' &&
      item.titulo.trim() !== '' &&
      item.titulo.length <= 120 &&
      dataValida(item.criada_em) &&
      dataValida(item.atualizada_em) &&
      Number.isInteger(item.turnos) &&
      item.turnos >= 0,
  );
}

function turnoValido(turno) {
  if (!turno || typeof turno !== 'object') return false;
  if (typeof turno.registro !== 'string' || !UUID.test(turno.registro)) return false;
  if (!Number.isInteger(turno.ordem) || turno.ordem < 1) return false;
  if (typeof turno.pergunta !== 'string') return false;
  if (!dataValida(turno.iniciada_em)) return false;
  if (turno.terminada_em !== null && turno.terminada_em !== undefined && !dataValida(turno.terminada_em)) {
    return false;
  }
  if (turno.resposta !== null && turno.resposta !== undefined && typeof turno.resposta !== 'object') {
    return false;
  }
  if (turno.feedback !== null && turno.feedback !== undefined && typeof turno.feedback !== 'object') {
    return false;
  }
  return true;
}

function validarConversa(dados) {
  return Boolean(
    dados &&
      typeof dados === 'object' &&
      typeof dados.id === 'string' &&
      UUID.test(dados.id) &&
      typeof dados.titulo === 'string' &&
      dataValida(dados.criada_em) &&
      dataValida(dados.atualizada_em) &&
      Array.isArray(dados.turnos) &&
      dados.turnos.every(turnoValido),
  );
}

function mensagemDaRpc(error, padrao) {
  const codigo = String(error?.code || '');
  const mensagem = typeof error?.message === 'string' ? error.message.trim() : '';
  if (codigo === '42501') return MENSAGEM_NAO_DISPONIVEL;
  if (codigo === '22023' && mensagem) return mensagem;
  return padrao;
}

/**
 * Lista as conversas do próprio usuário, mais recentes primeiro. `p_antes`
 * é o `atualizada_em` do último item da página anterior.
 */
export async function listarConversas({ limite = 30, antes = null } = {}) {
  if (modoExemplo()) {
    const modulo = await import('./analiseExemplo.js');
    return modulo.listarConversasExemplo({ limite, antes });
  }

  try {
    const { data, error } = await supabase.rpc('analise_conversas_listar', {
      p_limite: limite,
      p_antes: antes,
    });
    if (error) return { dados: null, erro: MENSAGEM_LISTAR };
    if (!Array.isArray(data) || !data.every(conversaValida)) {
      return { dados: null, erro: MENSAGEM_LISTAR };
    }
    return { dados: data, erro: null };
  } catch {
    return { dados: null, erro: MENSAGEM_LISTAR };
  }
}

/**
 * Lê uma conversa com os turnos em ordem. A resposta é o retrato que a pessoa
 * viu, sem os passos; `feedback` é o último `{ nota, motivo }` do turno.
 */
export async function lerConversa(id) {
  if (typeof id !== 'string' || !UUID.test(id)) {
    return { dados: null, erro: MENSAGEM_LER };
  }
  if (modoExemplo()) {
    const modulo = await import('./analiseExemplo.js');
    return modulo.lerConversaExemplo(id);
  }

  try {
    const { data, error } = await supabase.rpc('analise_conversa_ler', {
      p_conversa: id,
    });
    if (error) return { dados: null, erro: mensagemDaRpc(error, MENSAGEM_LER) };
    if (!validarConversa(data)) return { dados: null, erro: MENSAGEM_LER };
    return { dados: data, erro: null };
  } catch {
    return { dados: null, erro: MENSAGEM_LER };
  }
}

/** Renomeia a conversa (1–120 caracteres depois do btrim). */
export async function renomearConversa(id, titulo) {
  const limpo = typeof titulo === 'string' ? titulo.trim() : '';
  if (typeof id !== 'string' || !UUID.test(id)) {
    return { dados: null, erro: MENSAGEM_RENOMEAR };
  }
  if (limpo.length < 1 || limpo.length > 120) {
    return { dados: null, erro: MENSAGEM_TITULO };
  }
  if (modoExemplo()) {
    const modulo = await import('./analiseExemplo.js');
    return modulo.renomearConversaExemplo(id, limpo);
  }

  try {
    const { error } = await supabase.rpc('analise_conversa_renomear', {
      p_conversa: id,
      p_titulo: limpo,
    });
    if (error) return { dados: null, erro: mensagemDaRpc(error, MENSAGEM_RENOMEAR) };
    return { dados: null, erro: null };
  } catch {
    return { dados: null, erro: MENSAGEM_RENOMEAR };
  }
}

/** Exclui a conversa; o cascade do banco leva os turnos e os feedbacks. */
export async function excluirConversa(id) {
  if (typeof id !== 'string' || !UUID.test(id)) {
    return { dados: null, erro: MENSAGEM_EXCLUIR };
  }
  if (modoExemplo()) {
    const modulo = await import('./analiseExemplo.js');
    return modulo.excluirConversaExemplo(id);
  }

  try {
    const { error } = await supabase.rpc('analise_conversa_excluir', {
      p_conversa: id,
    });
    if (error) return { dados: null, erro: mensagemDaRpc(error, MENSAGEM_EXCLUIR) };
    return { dados: null, erro: null };
  } catch {
    return { dados: null, erro: MENSAGEM_EXCLUIR };
  }
}
