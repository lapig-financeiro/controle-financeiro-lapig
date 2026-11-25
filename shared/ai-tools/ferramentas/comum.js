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

/** Copia a árvore mascarando rótulos/notas soltos, sem tocar em ref/chave. */
export function sanitizarArvore(no, mascara) {
  if (!no || typeof no !== 'object') return no;
  const saida = { ...no };
  for (const campo of ['rotulo', 'nota', 'conta']) {
    if (typeof saida[campo] === 'string') saida[campo] = mascara.texto(saida[campo]);
  }
  if (Array.isArray(saida.partes)) {
    saida.partes = saida.partes.map((parte) => sanitizarArvore(parte, mascara));
  }
  return saida;
}

/** A forma que o modelo vê de um nó; sem origem, sem ref, sem uuid. */
export function mini(no) {
  return { id: no.id, valor: no.valor, rotulo: no.rotulo, unidade: no.unidade };
}

export function mensagemDeErro(erro) {
  if (typeof erro === 'string') return erro.trim();
  if (erro && typeof erro.message === 'string') return erro.message.trim();
  return '';
}

/**
 * Chama a RPC injetada e normaliza { data, error }, exceção e retorno vazio.
 * Falha nunca vira zero nem lista vazia: vira `erro` para o modelo.
 */
export async function chamarRpc(ctx, nome, args) {
  try {
    const resposta = await ctx.rpc(nome, args);
    if (!resposta || typeof resposta !== 'object') {
      return { dados: null, erro: `Não foi possível consultar ${nome}.` };
    }
    if (resposta.error) {
      const detalhe = ctx.mascara ? ctx.mascara.texto(mensagemDeErro(resposta.error)) : mensagemDeErro(resposta.error);
      return {
        dados: null,
        erro: detalhe
          ? `Não foi possível consultar ${nome}: ${detalhe}`
          : `Não foi possível consultar ${nome}.`,
      };
    }
    if (resposta.data === null || resposta.data === undefined) {
      return { dados: null, erro: `A consulta ${nome} não devolveu dados.` };
    }
    return { dados: resposta.data, erro: null };
  } catch (erro) {
    const detalhe = ctx.mascara ? ctx.mascara.texto(mensagemDeErro(erro)) : mensagemDeErro(erro);
    return {
      dados: null,
      erro: detalhe
        ? `Não foi possível consultar ${nome}: ${detalhe}`
        : `Não foi possível consultar ${nome}.`,
    };
  }
}

export function formatoInesperado(nome) {
  return { erro: `Formato inesperado em ${nome}.` };
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
