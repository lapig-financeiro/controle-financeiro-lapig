// Utilidades comuns das ferramentas da Análise.
//
// Nada aqui calcula regra de negócio: só normaliza formato, monta origem e
// chama a RPC injetada. A conta financeira mora no Postgres.

export function ehObjeto(valor) {
  return Boolean(valor && typeof valor === 'object' && !Array.isArray(valor));
}

export function textoOuNulo(valor) {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

export function numeroOuNulo(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const numero = Number(valor.trim().replace(',', '.'));
    if (Number.isFinite(numero)) return numero;
  }
  return null;
}

export function ehDataIso(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor);
}

export function clonar(valor) {
  if (valor === undefined) return undefined;
  return JSON.parse(JSON.stringify(valor));
}

export function semDocumento(motivo, consulta) {
  return { tipo: 'sem_documento', motivo: String(motivo || ''), consulta: String(consulta || '') };
}

export function origemLivre(projectId) {
  return { tipo: 'livre', project_id: projectId };
}

export function origemNo(no) {
  return { tipo: 'no', no: clonar(no) };
}

export function origemRef(ref, nome) {
  return { tipo: 'ref', ref: clonar(ref), nome: String(nome || '') };
}

export function origemTermo(projectId, termoId) {
  return { tipo: 'termo', project_id: projectId, termo_id: termoId };
}

/** A forma que o modelo vê de um nó; sem origem, sem ref, sem uuid. */
export function mini(no) {
  return { id: no.id, valor: no.valor, rotulo: no.rotulo, unidade: no.unidade };
}

const MENSAGENS_RPC = Object.freeze({
  resumo_projetos_v2: 'Não foi possível carregar os centros.',
  explicar_livre_v2: 'Não foi possível carregar a origem do saldo livre.',
  situacao_centro_v2: 'Não foi possível carregar a situação do centro.',
  get_repasses_v2: 'Não foi possível carregar os desembolsos.',
  get_termos_contrato_v2: 'Não foi possível carregar os termos do contrato.',
  listar_pendencias_v2: 'Não foi possível carregar as pendências.',
  get_pedido_bolsas_v2: 'Não foi possível carregar o pedido de bolsas.',
});

export function mensagemRpc(nome) {
  return MENSAGENS_RPC[nome] ?? 'Não foi possível concluir a consulta.';
}

/** Código curto e estável; o texto bruto da RPC nunca sai do pacote. */
export function codigoDoErro(erro) {
  const nome = String(erro?.name ?? '').toLowerCase();
  const mensagem = String(erro?.message ?? erro ?? '').toLowerCase();
  if (
    nome.includes('abort') ||
    nome.includes('timeout') ||
    mensagem.includes('timeout') ||
    mensagem.includes('timed out') ||
    mensagem.includes('abort') ||
    mensagem.includes('tempo esgotado')
  ) {
    return 'tempo';
  }
  const status = Number(erro?.status ?? erro?.statusCode ?? 0);
  if (status === 408 || status === 504 || status === 524) return 'tempo';
  return 'http_4xx';
}

/**
 * Chama a RPC injetada e normaliza { data, error }, exceção e retorno vazio.
 * A mensagem devolvida é fixa por consulta + código; o texto bruto do banco
 * não chega ao modelo. Falha nunca vira zero nem lista vazia.
 */
export async function chamarRpc(ctx, nome, args) {
  try {
    const resposta = await ctx.rpc(nome, args);
    if (!resposta || typeof resposta !== 'object') {
      return { dados: null, erro: `${mensagemRpc(nome)} (formato)` };
    }
    if (resposta.error) {
      return { dados: null, erro: `${mensagemRpc(nome)} (${codigoDoErro(resposta.error)})` };
    }
    if (resposta.data === null || resposta.data === undefined) {
      return { dados: null, erro: `${mensagemRpc(nome)} (formato)` };
    }
    return { dados: resposta.data, erro: null };
  } catch (erro) {
    return { dados: null, erro: `${mensagemRpc(nome)} (${codigoDoErro(erro)})` };
  }
}

export function formatoInesperado(nome) {
  return { erro: `${mensagemRpc(nome)} (formato)` };
}

/** Registra texto já mascarado; o modelo não vê o valor original. */
export function registrarTexto(ctx, valor, rotulo, origem) {
  return ctx.registro.registrar({
    valor: ctx.mascara.texto(String(valor ?? '')),
    unidade: 'texto',
    rotulo,
    origem,
  });
}

/** Registra data ISO curta. */
export function registrarData(ctx, valor, rotulo, origem) {
  const data = String(valor ?? '').slice(0, 10);
  if (!ehDataIso(data)) return null;
  return ctx.registro.registrar({ valor: data, unidade: 'data', rotulo, origem });
}

export function registrarMoeda(ctx, valor, rotulo, origem) {
  const numero = numeroOuNulo(valor);
  if (numero === null) return null;
  return ctx.registro.registrar({ valor: numero, unidade: 'moeda', rotulo, origem });
}

export function registrarNumero(ctx, valor, rotulo, origem) {
  const numero = numeroOuNulo(valor);
  if (numero === null) return null;
  return ctx.registro.registrar({ valor: numero, unidade: 'numero', rotulo, origem });
}

/** Resolve o argumento de centro e devolve { centro } ou { erro }. */
export async function exigirCentro(ctx, args, { opcional = false } = {}) {
  const bruto = args && args.project_id;
  if (bruto === undefined || bruto === null || bruto === '') {
    if (opcional) return { centro: null };
    return { erro: 'Informe o centro pelo código (30.901) ou pelo id.' };
  }
  return ctx.resolverCentro(bruto);
}
