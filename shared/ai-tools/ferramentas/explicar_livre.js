// explicar_livre — explicar_livre_v2 (contrato §4).
//
// Cada nó da árvore vira um nó da sessão. Até 200 nós, a origem de cada um é
// `{ tipo: 'no', no: <o próprio nó com as partes> }`, para o clique abrir o
// "De onde vem" sem nova consulta. Acima disso, a origem é `livre` com a chave
// do nó, ou `ref` quando a folha tem referência direta ao documento.
//
// Folha de bolsa (ref.alvo_tabela = 'scholarships') tem o nome trocado por
// ⟦Pn⟧ no rótulo do modelo, estável pelo alvo_id e sem depender do dicionário;
// o nome original fica só na origem, que não entra no paraModelo.

import {
  formatoInesperado,
  mini,
  numeroOuNulo,
  origemNo,
} from './comum.js';

export const nome = 'explicar_livre';

const TIPOS = new Set(['calculo', 'documento', 'legado', 'digitado']);

function refValida(ref) {
  return (
    ref &&
    typeof ref === 'object' &&
    typeof ref.alvo_tabela === 'string' &&
    ref.alvo_tabela.trim() !== '' &&
    typeof ref.alvo_id === 'string' &&
    ref.alvo_id.trim() !== '' &&
    typeof ref.campo === 'string' &&
    ref.campo.trim() !== ''
  );
}

function validarNo(no, { raiz = false, profundidade = 0 } = {}) {
  if (profundidade > 64 || !no || typeof no !== 'object' || Array.isArray(no)) return false;
  if (typeof no.rotulo !== 'string') return false;
  if (!TIPOS.has(no.tipo)) return false;
  if (!Array.isArray(no.partes)) return false;
  if (no.ref !== null && no.ref !== undefined && !refValida(no.ref)) return false;
  if (no.sinal !== undefined && no.sinal !== null && no.sinal !== 1 && no.sinal !== -1) {
    return false;
  }

  if (raiz && no.valor === null) {
    if (typeof no.motivo !== 'string' || no.motivo.trim() === '') return false;
    if (no.partes.length > 0) return false;
  } else if (numeroOuNulo(no.valor) === null) {
    return false;
  }

  return no.partes.every((parte) => validarNo(parte, { profundidade: profundidade + 1 }));
}

function contarNos(no) {
  return 1 + no.partes.reduce((soma, parte) => soma + contarNos(parte), 0);
}

export async function executar(ctx, args) {
  const resolvido = await ctx.resolverCentro(args && args.project_id);
  if (resolvido.erro) return resolvido;
  const centro = resolvido.centro;

  await ctx.mascara.garantirDicionario();

  let arvore;
  try {
    arvore = await ctx.obterArvore(centro.id);
  } catch (erro) {
    return {
      erro: erro && erro.message ? erro.message : 'Não foi possível carregar a origem do saldo livre. (http_4xx)',
    };
  }
  if (!validarNo(arvore, { raiz: true })) return formatoInesperado('explicar_livre_v2');

  const total = contarNos(arvore);
  const modoGrande = total > 200;
  const nos = [];
  const estrutura = {};

  function origemDoNo(no, caminho) {
    if (!modoGrande) return origemNo(no);
    return {
      tipo: 'livre',
      project_id: centro.id,
      chave: typeof no.chave === 'string' ? no.chave : null,
      caminho: [...caminho],
    };
  }

  function registrar(no, caminho = []) {
    const rotulo =
      no.ref && no.ref.alvo_tabela === 'scholarships'
        ? ctx.mascara.rotuloDeBolsa(no.rotulo, no.ref.alvo_id)
        : ctx.mascara.texto(no.rotulo);

    const numero = numeroOuNulo(no.valor);
    const valor = numero === null ? ctx.mascara.texto(String(no.motivo ?? '')) : numero;
    const unidade = numero === null ? 'texto' : 'moeda';

    const registrado = ctx.registro.registrar({
      valor,
      unidade,
      rotulo,
      origem: origemDoNo(no, caminho),
    });
    const ramo = {
      sinal: no.sinal === -1 ? -1 : 1,
      partes: [],
    };
    if (no.motivo) ramo.motivo = ctx.mascara.texto(String(no.motivo));
    estrutura[registrado.id] = ramo;
    nos.push(mini(registrado));

    no.partes.forEach((parte, indice) => {
      const filho = registrar(parte, [...caminho, indice]);
      ramo.partes.push(filho.id);
    });
    return registrado;
  }

  const raiz = registrar(arvore);
  return { paraModelo: { raiz: raiz.id, estrutura, nos } };
}
