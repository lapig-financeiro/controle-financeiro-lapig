// explicar_livre — explicar_livre_v2 (contrato §4).
//
// Cada nó da árvore vira um nó da sessão. Até 200 nós, a origem de cada um é
// `{ tipo: 'no', no: <o próprio nó com as partes> }`, para o clique abrir o
// "De onde vem" sem nova consulta. Acima disso, a origem é `livre`.

import { formatoInesperado, mini, origemLivre, origemNo, sanitizarArvore } from './comum.js';

export const nome = 'explicar_livre';

function contarNos(no) {
  if (!no || typeof no !== 'object') return 0;
  const partes = Array.isArray(no.partes) ? no.partes : [];
  return 1 + partes.reduce((soma, parte) => soma + contarNos(parte), 0);
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
    return { erro: erro && erro.message ? erro.message : 'Não foi possível carregar a origem do saldo livre.' };
  }
  if (!arvore || typeof arvore !== 'object' || !Array.isArray(arvore.partes)) {
    return formatoInesperado('explicar_livre_v2');
  }

  const total = contarNos(arvore);
  const origemFixa = total > 200 ? origemLivre(centro.id) : null;
  const nos = [];
  const estrutura = {};

  function registrar(no) {
    if (!no || typeof no !== 'object') return null;
    const partes = Array.isArray(no.partes) ? no.partes : [];
    const rotulo = ctx.mascara.texto(String(no.rotulo ?? ''));
    let valor;
    let unidade;
    if (typeof no.valor === 'number' && Number.isFinite(no.valor)) {
      valor = no.valor;
      unidade = 'moeda';
    } else if (typeof no.valor === 'string') {
      valor = ctx.mascara.texto(no.valor);
      unidade = 'texto';
    } else {
      valor = ctx.mascara.texto(String(no.motivo ?? no.rotulo ?? 'sem dado'));
      unidade = 'texto';
    }

    const origem = origemFixa ?? origemNo(sanitizarArvore(no, ctx.mascara));
    const registrado = ctx.registro.registrar({ valor, unidade, rotulo, origem });
    const ramo = {
      sinal: no.sinal === -1 ? -1 : 1,
      partes: [],
    };
    if (no.motivo) ramo.motivo = ctx.mascara.texto(String(no.motivo));
    estrutura[registrado.id] = ramo;
    nos.push(mini(registrado));

    for (const parte of partes) {
      const filho = registrar(parte);
      if (filho) ramo.partes.push(filho.id);
    }
    return registrado;
  }

  const raiz = registrar(arvore);
  if (!raiz) return formatoInesperado('explicar_livre_v2');
  return { paraModelo: { raiz: raiz.id, estrutura, nos } };
}
