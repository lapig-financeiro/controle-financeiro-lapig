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

function numeroValidoOuNulo(valor) {
  if (valor === null || valor === undefined) return true;
  if (valor === '') return false;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n);
}

function validarArvoreExplicacao(d) {
  if (!d || typeof d !== 'object') return false;
  if (typeof d.rotulo !== 'string' || typeof d.tipo !== 'string') return false;
  if (!Array.isArray(d.partes)) return false;
  if (d.valor === null) {
    return typeof d.motivo === 'string' && d.motivo.trim().length > 0 && d.partes.length === 0;
  }
  if (d.valor === undefined || d.valor === '') return false;
  return Number.isFinite(Number(d.valor));
}

function validarOrigem(d) {
  if (!d || typeof d !== 'object') return false;
  if (!['documento', 'legado', 'digitado'].includes(d.tipo)) return false;
  if (!numeroValidoOuNulo(d.valor)) return false;
  if (d.documento !== null && d.documento !== undefined && typeof d.documento !== 'object') {
    return false;
  }
  return true;
}

export async function explicarLivre(projectId) {
  if (!projectId) {
    return { dados: null, erro: 'Centro de custo não informado.' };
  }
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.explicarLivre(projectId);
  return chamarRpc(
    'explicar_livre_v2',
    { p_project_id: projectId },
    'Não foi possível carregar a origem do saldo livre.',
    { validar: validarArvoreExplicacao }
  );
}

export async function origem(ref) {
  if (!ref || typeof ref !== 'object' || !ref.alvo_tabela || !ref.alvo_id || !ref.campo) {
    return { dados: null, erro: 'Referência de origem incompleta.' };
  }
  const ex = await carregarExemplo();
  if (ex) return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.origem(ref);
  return chamarRpc(
    'get_origem_v2',
    {
      p_alvo_tabela: ref.alvo_tabela,
      p_alvo_id: ref.alvo_id,
      p_campo: ref.campo,
    },
    'Não foi possível consultar a origem deste valor.',
    { validar: validarOrigem }
  );
}

export async function arquivoDeOrigem(documento) {
  if (!documento || typeof documento !== 'object' || !documento.bucket || !documento.caminho) {
    return { dados: null, erro: 'Arquivo de origem não informado.' };
  }
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro ? { dados: null, erro: ex.erro } : ex.modulo.arquivoDeOrigem(documento);
  }
  try {
    const { data, error } = await supabase.storage
      .from(documento.bucket)
      .createSignedUrl(documento.caminho, 300);

    if (error || !data?.signedUrl) {
      return { dados: null, erro: 'Não foi possível obter acesso ao arquivo de origem.' };
    }

    const resposta = await fetch(data.signedUrl);
    if (!resposta.ok) {
      return {
        dados: null,
        erro: `Não foi possível baixar o arquivo de origem (HTTP ${resposta.status}).`,
      };
    }

    const buffer = await resposta.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) {
      return { dados: null, erro: 'O arquivo de origem veio vazio.' };
    }

    return { dados: buffer, erro: null };
  } catch {
    return { dados: null, erro: 'Não foi possível baixar o arquivo de origem.' };
  }
}
