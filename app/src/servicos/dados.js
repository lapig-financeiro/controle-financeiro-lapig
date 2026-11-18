import { supabase } from './supabase.js';

export function modoExemploAtivo(env = import.meta.env) {
  return Boolean(env?.DEV && env?.VITE_DADOS === 'exemplo');
}

let exemploPromise = null;

async function carregarExemplo() {
  if (!(import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo')) {
    return null;
  }
  if (!exemploPromise) {
    exemploPromise = import('./dadosExemplo.js');
  }
  return exemploPromise;
}

async function chamarRpc(nome, params, mensagemErro, { lista = false } = {}) {
  try {
    const { data, error } = params === undefined
      ? await supabase.rpc(nome)
      : await supabase.rpc(nome, params);

    if (error) {
      return { dados: null, erro: mensagemErro };
    }

    if (lista) {
      if (!Array.isArray(data)) {
        return { dados: null, erro: mensagemErro };
      }
      return { dados: data, erro: null };
    }

    if (data === null || data === undefined) {
      return { dados: null, erro: mensagemErro };
    }

    return { dados: data, erro: null };
  } catch {
    return { dados: null, erro: mensagemErro };
  }
}

export async function resumoProjetos() {
  const exemplo = await carregarExemplo();
  if (exemplo) return exemplo.resumoProjetos();
  return chamarRpc(
    'resumo_projetos_v2',
    undefined,
    'Não foi possível carregar os centros de custo.'
  );
}

export async function pendencias(projectId = null) {
  const exemplo = await carregarExemplo();
  if (exemplo) return exemplo.pendencias(projectId);
  return chamarRpc(
    'listar_pendencias_v2',
    { p_project_id: projectId ?? null },
    'Não foi possível carregar as pendências.',
    { lista: true }
  );
}

export async function resolverPendencia(id, situacao) {
  const exemplo = await carregarExemplo();
  if (exemplo) return exemplo.resolverPendencia(id, situacao);
  return chamarRpc(
    'resolver_pendencia_v2',
    { p_id: id, p_situacao: situacao },
    'Não foi possível atualizar a pendência.'
  );
}

export async function filtroVisao() {
  const exemplo = await carregarExemplo();
  if (exemplo) return exemplo.filtroVisao();
  return chamarRpc(
    'get_filtro_visao_v2',
    undefined,
    'Não foi possível carregar o filtro de visão.'
  );
}

export async function salvarFiltroVisao(centrosOcultos) {
  const exemplo = await carregarExemplo();
  if (exemplo) return exemplo.salvarFiltroVisao(centrosOcultos);
  return chamarRpc(
    'set_filtro_visao_v2',
    { p_centros_ocultos: Array.isArray(centrosOcultos) ? centrosOcultos : [] },
    'Não foi possível salvar o filtro de visão.'
  );
}

export async function saldoLivre(projectId) {
  const exemplo = await carregarExemplo();
  if (exemplo) return exemplo.saldoLivre(projectId);
  return chamarRpc(
    'get_saldo_livre',
    { p_project_id: projectId },
    'Não foi possível calcular o saldo deste centro.'
  );
}

export async function repasses(projectId) {
  const exemplo = await carregarExemplo();
  if (exemplo) return exemplo.repasses(projectId);
  return chamarRpc(
    'get_repasses_v2',
    { p_project_id: projectId },
    'Não foi possível carregar os repasses deste centro.'
  );
}

export async function balancetes(projectId) {
  const exemplo = await carregarExemplo();
  if (exemplo) return exemplo.balancetes(projectId);
  return chamarRpc(
    'get_balancetes_by_project',
    { p_project_id: projectId },
    'Não foi possível carregar os balancetes deste centro.',
    { lista: true }
  );
}

export async function planos(projectId) {
  const exemplo = await carregarExemplo();
  if (exemplo) return exemplo.planos(projectId);
  return chamarRpc(
    'get_planos_historico',
    { p_project_id: projectId },
    'Não foi possível carregar os planos deste centro.',
    { lista: true }
  );
}
