// desembolsos — get_repasses_v2 (contrato §4).
//
// A parcela do plano não carrega ref hoje; a origem honesta é sem_documento.
// Se uma linha trouxer ref (formato previsto no contrato), ela vira `ref`.

import {
  chamarRpc,
  formatoInesperado,
  mini,
  origemRef,
  registrarData,
  registrarMoeda,
  registrarNumero,
  registrarTexto,
  semDocumento,
} from './comum.js';

export const nome = 'desembolsos';

function refValida(ref) {
  return (
    ref &&
    typeof ref === 'object' &&
    typeof ref.alvo_tabela === 'string' &&
    typeof ref.alvo_id === 'string' &&
    typeof ref.campo === 'string'
  );
}

export async function executar(ctx, args) {
  const resolvido = await ctx.resolverCentro(args && args.project_id);
  if (resolvido.erro) return resolvido;
  const centro = resolvido.centro;

  const resposta = await chamarRpc(ctx, 'get_repasses_v2', { p_project_id: centro.id });
  if (resposta.erro) return { erro: resposta.erro };
  const dados = resposta.dados;
  if (!dados || typeof dados !== 'object' || !Array.isArray(dados.parcelas)) {
    return formatoInesperado('get_repasses_v2');
  }

  await ctx.mascara.garantirDicionario();

  const nos = [];
  const parcelas = [];

  for (const parcela of dados.parcelas) {
    if (!parcela || typeof parcela !== 'object') continue;
    const numeroParcela = parcela.parcela;
    const origemParcela = semDocumento('parcela do plano de trabalho', 'get_repasses_v2');
    const origemValor = refValida(parcela.ref)
      ? origemRef(parcela.ref, `Parcela ${parcela.parcela ?? '?'}`)
      : semDocumento('parcela do plano sem referência de documento', 'get_repasses_v2');

    const saida = { parcela: null, data: null, data_texto: null, valor: null, valor_texto: null };

    if (typeof numeroParcela === 'number' && Number.isFinite(numeroParcela)) {
      const no = registrarNumero(ctx, numeroParcela, `Parcela ${numeroParcela}`, origemParcela);
      if (no) {
        saida.parcela = no.id;
        nos.push(no);
      }
    }

    if (parcela.data_prevista) {
      const no = registrarData(
        ctx,
        parcela.data_prevista,
        `Data prevista — parcela ${numeroParcela ?? '?'}`,
        origemParcela
      );
      if (no) {
        saida.data = no.id;
        nos.push(no);
      }
    }

    if (parcela.data_texto) {
      const no = registrarTexto(
        ctx,
        parcela.data_texto,
        `Data descrita — parcela ${numeroParcela ?? '?'}`,
        origemParcela
      );
      saida.data_texto = no.id;
      nos.push(no);
    }

    if (typeof parcela.valor === 'number' && Number.isFinite(parcela.valor)) {
      const no = registrarMoeda(
        ctx,
        parcela.valor,
        `Valor — parcela ${numeroParcela ?? '?'}`,
        origemValor
      );
      if (no) {
        saida.valor = no.id;
        nos.push(no);
      }
    }

    if (parcela.valor_texto) {
      const no = registrarTexto(
        ctx,
        parcela.valor_texto,
        `Valor descrito — parcela ${numeroParcela ?? '?'}`,
        origemValor
      );
      saida.valor_texto = no.id;
      nos.push(no);
    }

    parcelas.push(saida);
  }

  const total = registrarMoeda(
    ctx,
    dados.valor_total_plano,
    'Valor total do plano',
    semDocumento('valor total do plano ativo', 'get_repasses_v2')
  );
  if (total) nos.push(total);

  const dataBalancete = registrarData(
    ctx,
    dados.data_balancete,
    'Balancete de referência',
    semDocumento('data do balancete vigente', 'get_repasses_v2')
  );
  if (dataBalancete) nos.push(dataBalancete);

  let recebido = null;
  let aReceber = null;
  if (dados.recursos && typeof dados.recursos === 'object') {
    const noRecebido = registrarMoeda(
      ctx,
      dados.recursos.recebido,
      'Recursos recebidos',
      semDocumento('recursos lidos do balancete vigente', 'get_repasses_v2')
    );
    const noAReceber = registrarMoeda(
      ctx,
      dados.recursos.a_receber,
      'Recursos a receber',
      semDocumento('recursos lidos do balancete vigente', 'get_repasses_v2')
    );
    if (noRecebido) {
      recebido = noRecebido.id;
      nos.push(noRecebido);
    }
    if (noAReceber) {
      aReceber = noAReceber.id;
      nos.push(noAReceber);
    }
  }

  return {
    paraModelo: {
      parcelas,
      valor_total_plano: total ? total.id : null,
      data_balancete: dataBalancete ? dataBalancete.id : null,
      recursos: dados.recursos && typeof dados.recursos === 'object' ? { recebido, a_receber: aReceber } : null,
      nos: nos.map(mini),
    },
  };
}
