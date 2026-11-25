// situacao_centro — situacao_centro_v2 (contrato §4).
//
// Texto dos motivos é origem `sem_documento` (motivo literal). Quando o motivo
// traz um valor que casa com um nó da árvore do livre, o número usa `no` com a
// própria árvore; é o único jeito de o clique chegar ao documento.

import {
  chamarRpc,
  formatoInesperado,
  mini,
  origemNo,
  registrarMoeda,
  registrarTexto,
  sanitizarArvore,
  semDocumento,
} from './comum.js';

export const nome = 'situacao_centro';

function perto(a, b) {
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) <= 0.005;
}

function procurarNo(no, predicado) {
  if (!no || typeof no !== 'object') return null;
  if (predicado(no)) return no;
  const partes = Array.isArray(no.partes) ? no.partes : [];
  for (const parte of partes) {
    const achado = procurarNo(parte, predicado);
    if (achado) return achado;
  }
  return null;
}

function acharNoDoMotivo(arvore, motivo) {
  const valor = typeof motivo.valor === 'number' ? motivo.valor : null;
  if (valor === null || !arvore) return null;

  if (motivo.codigo === 'folha_atrasada') {
    return procurarNo(
      arvore,
      (no) => no.chave === 'rubrica:a.bolsas:folha_atrasada' && perto(no.valor, valor)
    );
  }

  if (motivo.grupo_code) {
    return procurarNo(
      arvore,
      (no) => no.chave === `grupo:${motivo.grupo_code}` && perto(Math.abs(Number(no.valor)), Math.abs(valor))
    );
  }

  return null;
}

export async function executar(ctx, args) {
  const resolvido = await ctx.resolverCentro(args && args.project_id);
  if (resolvido.erro) return resolvido;
  const centro = resolvido.centro;

  const resposta = await chamarRpc(ctx, 'situacao_centro_v2', { p_project_id: centro.id });
  if (resposta.erro) return { erro: resposta.erro };
  const dados = resposta.dados;
  if (!dados || typeof dados !== 'object' || typeof dados.situacao !== 'string' || !Array.isArray(dados.motivos)) {
    return formatoInesperado('situacao_centro_v2');
  }

  await ctx.mascara.garantirDicionario();

  let arvore = null;
  try {
    arvore = await ctx.obterArvore(centro.id);
  } catch {
    arvore = null;
  }

  const nos = [];
  const situacao = registrarTexto(
    ctx,
    dados.situacao,
    `Situação — ${centro.code ?? centro.id}`,
    semDocumento('situação calculada pela RPC', 'situacao_centro_v2')
  );
  nos.push(situacao);

  const motivos = [];
  for (const motivo of dados.motivos) {
    if (!motivo || typeof motivo !== 'object') continue;
    const textoLimpo = ctx.mascara.texto(String(motivo.texto ?? ''));
    const noTexto = registrarTexto(
      ctx,
      textoLimpo,
      `Motivo — ${centro.code ?? centro.id}`,
      semDocumento(textoLimpo || 'motivo literal da RPC', 'situacao_centro_v2')
    );
    const noNivel = registrarTexto(
      ctx,
      String(motivo.nivel ?? ''),
      `Nível do motivo — ${centro.code ?? centro.id}`,
      semDocumento('nível literal da RPC', 'situacao_centro_v2')
    );
    nos.push(noTexto, noNivel);

    const saida = { texto: noTexto.id, nivel: noNivel.id, valor: null };
    if (typeof motivo.valor === 'number' && Number.isFinite(motivo.valor)) {
      const casado = acharNoDoMotivo(arvore, motivo);
      if (casado) {
        const valorCasado = Number(casado.valor);
        const noValor = ctx.registro.registrar({
          valor: valorCasado,
          unidade: 'moeda',
          rotulo: ctx.mascara.texto(String(casado.rotulo ?? 'Valor do motivo')),
          origem: origemNo(sanitizarArvore(casado, ctx.mascara)),
        });
        saida.valor = noValor.id;
        nos.push(noValor);
      } else {
        const noValor = registrarMoeda(
          ctx,
          motivo.valor,
          `Valor do motivo — ${centro.code ?? centro.id}`,
          semDocumento(textoLimpo || 'valor literal da RPC', 'situacao_centro_v2')
        );
        if (noValor) {
          saida.valor = noValor.id;
          nos.push(noValor);
        }
      }
    }
    motivos.push(saida);
  }

  return {
    paraModelo: {
      situacao: situacao.id,
      motivos,
      nos: nos.map(mini),
    },
  };
}
