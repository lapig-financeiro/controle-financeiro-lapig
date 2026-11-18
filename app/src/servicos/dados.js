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
    exemploPromise = import('./dadosExemplo.js').catch((err) => {
      exemploPromise = null;
      throw err;
    });
  }
  try {
    const modulo = await exemploPromise;
    return { modulo, erro: null };
  } catch {
    exemploPromise = null;
    return { modulo: null, erro: 'Não foi possível carregar os dados de exemplo.' };
  }
}

async function chamarRpc(nome, params, mensagemErro, { lista = false, validar = null } = {}) {
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

    if (validar && !validar(data)) {
      return { dados: null, erro: mensagemErro };
    }

    return { dados: data, erro: null };
  } catch {
    return { dados: null, erro: mensagemErro };
  }
}

export async function resumoProjetos() {
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.resumoProjetos();
  return chamarRpc(
    'resumo_projetos_v2',
    undefined,
    'Não foi possível carregar os centros de custo.',
    {
      validar: (d) =>
        Boolean(d && typeof d === 'object' && Array.isArray(d.centros) && Array.isArray(d.todos)),
    }
  );
}

export async function pendencias(projectId = null) {
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.pendencias(projectId);
  return chamarRpc(
    'listar_pendencias_v2',
    { p_project_id: projectId ?? null },
    'Não foi possível carregar as pendências.',
    { lista: true }
  );
}

export async function resolverPendencia(id, situacao) {
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.resolverPendencia(id, situacao);
  return chamarRpc(
    'resolver_pendencia_v2',
    { p_id: id, p_situacao: situacao },
    'Não foi possível atualizar a pendência.',
    {
      validar: (d) => Boolean(d && typeof d === 'object' && d.id && typeof d.situacao === 'string'),
    }
  );
}

export async function filtroVisao() {
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.filtroVisao();
  return chamarRpc(
    'get_filtro_visao_v2',
    undefined,
    'Não foi possível carregar o filtro de visão.',
    {
      validar: (d) => Boolean(d && typeof d === 'object' && Array.isArray(d.centros_ocultos)),
    }
  );
}

export async function salvarFiltroVisao(centrosOcultos) {
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.salvarFiltroVisao(centrosOcultos);
  return chamarRpc(
    'set_filtro_visao_v2',
    { p_centros_ocultos: Array.isArray(centrosOcultos) ? centrosOcultos : [] },
    'Não foi possível salvar o filtro de visão.',
    {
      validar: (d) => Boolean(d && typeof d === 'object' && Array.isArray(d.centros_ocultos)),
    }
  );
}

export async function saldoLivre(projectId) {
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.saldoLivre(projectId);
  return chamarRpc(
    'get_saldo_livre',
    { p_project_id: projectId },
    'Não foi possível calcular o saldo deste centro.',
    {
      validar: (d) =>
        Boolean(
          d &&
            typeof d === 'object' &&
            typeof d.has_plano === 'boolean' &&
            typeof d.has_balancete === 'boolean'
        ),
    }
  );
}

export async function repasses(projectId) {
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.repasses(projectId);
  return chamarRpc(
    'get_repasses_v2',
    { p_project_id: projectId },
    'Não foi possível carregar os repasses deste centro.',
    {
      validar: (d) => Boolean(d && typeof d === 'object' && Array.isArray(d.parcelas)),
    }
  );
}

export async function balancetes(projectId) {
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.balancetes(projectId);
  return chamarRpc(
    'get_balancetes_by_project',
    { p_project_id: projectId },
    'Não foi possível carregar os balancetes deste centro.',
    { lista: true }
  );
}

export async function planos(projectId) {
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.planos(projectId);
  return chamarRpc(
    'get_planos_historico',
    { p_project_id: projectId },
    'Não foi possível carregar os planos deste centro.',
    { lista: true }
  );
}
