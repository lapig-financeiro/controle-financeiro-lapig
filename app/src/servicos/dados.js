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

function validarPayload(data, mensagemErro, { lista = false, validar = null } = {}) {
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
}

async function responderExemplo(chamada, mensagemErro, opcoes = {}) {
  try {
    const res = await chamada();
    if (!res || res.erro) {
      return { dados: null, erro: res?.erro || mensagemErro };
    }
    return validarPayload(res.dados, mensagemErro, opcoes);
  } catch {
    return { dados: null, erro: mensagemErro };
  }
}

async function chamarRpc(nome, params, mensagemErro, opcoes = {}) {
  try {
    const { data, error } = params === undefined
      ? await supabase.rpc(nome)
      : await supabase.rpc(nome, params);

    if (error) {
      return { dados: null, erro: mensagemErro };
    }

    return validarPayload(data, mensagemErro, opcoes);
  } catch {
    return { dados: null, erro: mensagemErro };
  }
}

export async function resumoProjetos() {
  const opcoes = {
    validar: (d) =>
      Boolean(d && typeof d === 'object' && Array.isArray(d.centros) && Array.isArray(d.todos)),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.resumoProjetos(),
          'Não foi possível carregar os centros de custo.',
          opcoes
        );
  }
  return chamarRpc(
    'resumo_projetos_v2',
    undefined,
    'Não foi possível carregar os centros de custo.',
    opcoes
  );
}

export async function pendencias(projectId = null) {
  const opcoes = { lista: true };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.pendencias(projectId),
          'Não foi possível carregar as pendências.',
          opcoes
        );
  }
  return chamarRpc(
    'listar_pendencias_v2',
    { p_project_id: projectId ?? null },
    'Não foi possível carregar as pendências.',
    opcoes
  );
}

export async function resolverPendencia(id, situacao) {
  const opcoes = {
    validar: (d) => Boolean(d && typeof d === 'object' && d.id && typeof d.situacao === 'string'),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.resolverPendencia(id, situacao),
          'Não foi possível atualizar a pendência.',
          opcoes
        );
  }
  return chamarRpc(
    'resolver_pendencia_v2',
    { p_id: id, p_situacao: situacao },
    'Não foi possível atualizar a pendência.',
    opcoes
  );
}

export async function filtroVisao() {
  const opcoes = {
    validar: (d) => Boolean(d && typeof d === 'object' && Array.isArray(d.centros_ocultos)),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.filtroVisao(),
          'Não foi possível carregar o filtro de visão.',
          opcoes
        );
  }
  return chamarRpc(
    'get_filtro_visao_v2',
    undefined,
    'Não foi possível carregar o filtro de visão.',
    opcoes
  );
}

export async function salvarFiltroVisao(centrosOcultos) {
  const opcoes = {
    validar: (d) => Boolean(d && typeof d === 'object' && Array.isArray(d.centros_ocultos)),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.salvarFiltroVisao(centrosOcultos),
          'Não foi possível salvar o filtro de visão.',
          opcoes
        );
  }
  return chamarRpc(
    'set_filtro_visao_v2',
    { p_centros_ocultos: Array.isArray(centrosOcultos) ? centrosOcultos : [] },
    'Não foi possível salvar o filtro de visão.',
    opcoes
  );
}

export async function saldoLivre(projectId) {
  const opcoes = {
    validar: (d) =>
      Boolean(
        d &&
          typeof d === 'object' &&
          typeof d.has_plano === 'boolean' &&
          typeof d.has_balancete === 'boolean'
      ),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.saldoLivre(projectId),
          'Não foi possível calcular o saldo deste centro.',
          opcoes
        );
  }
  return chamarRpc(
    'get_saldo_livre',
    { p_project_id: projectId },
    'Não foi possível calcular o saldo deste centro.',
    opcoes
  );
}

export async function repasses(projectId) {
  const opcoes = {
    validar: (d) => Boolean(d && typeof d === 'object' && Array.isArray(d.parcelas)),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.repasses(projectId),
          'Não foi possível carregar os repasses deste centro.',
          opcoes
        );
  }
  return chamarRpc(
    'get_repasses_v2',
    { p_project_id: projectId },
    'Não foi possível carregar os repasses deste centro.',
    opcoes
  );
}

export async function balancetes(projectId) {
  const opcoes = { lista: true };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.balancetes(projectId),
          'Não foi possível carregar os balancetes deste centro.',
          opcoes
        );
  }
  return chamarRpc(
    'get_balancetes_by_project',
    { p_project_id: projectId },
    'Não foi possível carregar os balancetes deste centro.',
    opcoes
  );
}

export async function planos(projectId) {
  const opcoes = { lista: true };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.planos(projectId),
          'Não foi possível carregar os planos deste centro.',
          opcoes
        );
  }
  return chamarRpc(
    'get_planos_historico',
    { p_project_id: projectId },
    'Não foi possível carregar os planos deste centro.',
    opcoes
  );
}

const TIPOS_NO_ARVORE = ['calculo', 'documento', 'legado', 'digitado'];

function ehObjetoSimples(valor) {
  return Boolean(valor && typeof valor === 'object' && !Array.isArray(valor));
}

function numeroFinitoEstrito(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor);
  if (typeof valor === 'string') {
    const trimmed = valor.trim();
    if (!trimmed) return false;
    return Number.isFinite(Number(trimmed));
  }
  return false;
}

function numeroValidoOuNulo(valor) {
  return valor === null || valor === undefined || numeroFinitoEstrito(valor);
}

function validarRefOrigem(ref) {
  if (ref === null || ref === undefined) return true;
  if (!ehObjetoSimples(ref)) return false;
  return (
    typeof ref.alvo_tabela === 'string' &&
    ref.alvo_tabela.trim().length > 0 &&
    typeof ref.alvo_id === 'string' &&
    ref.alvo_id.trim().length > 0 &&
    typeof ref.campo === 'string' &&
    ref.campo.trim().length > 0
  );
}

function validarNoArvore(no, ehRaiz = false, profundidade = 0) {
  if (profundidade > 32 || !ehObjetoSimples(no)) return false;
  if (typeof no.rotulo !== 'string') return false;
  if (!TIPOS_NO_ARVORE.includes(no.tipo)) return false;
  if (!Array.isArray(no.partes)) return false;
  if (!validarRefOrigem(no.ref)) return false;
  if (no.sinal !== undefined && no.sinal !== null && no.sinal !== 1 && no.sinal !== -1) {
    return false;
  }

  if (ehRaiz && no.valor === null) {
    return typeof no.motivo === 'string' && no.motivo.trim().length > 0 && no.partes.length === 0;
  }

  if (!numeroFinitoEstrito(no.valor)) return false;

  for (const filho of no.partes) {
    if (!validarNoArvore(filho, false, profundidade + 1)) {
      return false;
    }
  }
  return true;
}

export function validarArvoreExplicacao(d) {
  return validarNoArvore(d, true, 0);
}

export function validarOrigem(d) {
  if (!ehObjetoSimples(d)) return false;
  if (!['documento', 'legado', 'digitado'].includes(d.tipo)) return false;
  if (!numeroValidoOuNulo(d.valor)) return false;
  if (d.documento !== null && d.documento !== undefined && !ehObjetoSimples(d.documento)) {
    return false;
  }
  if (d.fato !== null && d.fato !== undefined && !ehObjetoSimples(d.fato)) {
    return false;
  }
  if (d.busca !== null && d.busca !== undefined && !ehObjetoSimples(d.busca)) {
    return false;
  }
  return true;
}

export async function explicarLivre(projectId) {
  if (!projectId) {
    return { dados: null, erro: 'Centro de custo não informado.' };
  }
  const opcoes = { validar: validarArvoreExplicacao };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.explicarLivre(projectId),
          'Não foi possível carregar a origem do saldo livre.',
          opcoes
        );
  }
  return chamarRpc(
    'explicar_livre_v2',
    { p_project_id: projectId },
    'Não foi possível carregar a origem do saldo livre.',
    opcoes
  );
}

export async function origem(ref) {
  if (!ref || typeof ref !== 'object' || !ref.alvo_tabela || !ref.alvo_id || !ref.campo) {
    return { dados: null, erro: 'Referência de origem incompleta.' };
  }
  const opcoes = { validar: validarOrigem };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.origem(ref),
          'Não foi possível consultar a origem deste valor.',
          opcoes
        );
  }
  return chamarRpc(
    'get_origem_v2',
    {
      p_alvo_tabela: ref.alvo_tabela,
      p_alvo_id: ref.alvo_id,
      p_campo: ref.campo,
    },
    'Não foi possível consultar a origem deste valor.',
    opcoes
  );
}

export async function arquivoDeOrigem(documento) {
  if (!documento || typeof documento !== 'object' || !documento.bucket || !documento.caminho) {
    return { dados: null, erro: 'Arquivo de origem não informado.' };
  }
  const ex = await carregarExemplo();
  if (ex) {
    if (ex.erro) return { dados: null, erro: ex.erro };
    try {
      const res = await ex.modulo.arquivoDeOrigem(documento);
      if (!res || res.erro) {
        return { dados: null, erro: res?.erro || 'Não foi possível baixar o arquivo de origem.' };
      }
      const okBuffer =
        res.dados instanceof ArrayBuffer
          ? res.dados.byteLength > 0
          : ArrayBuffer.isView(res.dados) && res.dados.byteLength > 0;
      if (!okBuffer) {
        return { dados: null, erro: 'O arquivo de origem veio vazio.' };
      }
      return { dados: res.dados, erro: null };
    } catch {
      return { dados: null, erro: 'Não foi possível baixar o arquivo de origem.' };
    }
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
