// desembolsos — get_repasses_v2 (contrato §4).
//
// A parcela do plano não carrega ref hoje; a origem honesta é sem_documento.
// Se uma linha trouxer ref (formato previsto no contrato), ela vira `ref`.

import {
  chamarRpc,
  formatoInesperado,
  mini,
  numeroOuNulo,
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
    !Array.isArray(ref) &&
    typeof ref.alvo_tabela === 'string' &&
    ref.alvo_tabela.trim() !== '' &&
    typeof ref.alvo_id === 'string' &&
    ref.alvo_id.trim() !== '' &&
    typeof ref.campo === 'string' &&
    ref.campo.trim() !== ''
  );
}

function parcelaValida(parcela) {
  return (
    parcela &&
    typeof parcela === 'object' &&
    !Array.isArray(parcela) &&
    typeof parcela.parcela === 'number' &&
    Number.isFinite(parcela.parcela) &&
    (parcela.data_prevista === undefined ||
      parcela.data_prevista === null ||
      typeof parcela.data_prevista === 'string') &&
    (parcela.data_texto === undefined ||
      parcela.data_texto === null ||
      typeof parcela.data_texto === 'string') &&
    (parcela.valor === undefined || parcela.valor === null || numeroOuNulo(parcela.valor) !== null) &&
    (parcela.valor_texto === undefined ||
      parcela.valor_texto === null ||
      typeof parcela.valor_texto === 'string') &&
    (parcela.ref === undefined || parcela.ref === null || refValida(parcela.ref))
  );
}

function recursosValidos(recursos) {
  if (recursos === undefined || recursos === null) return true;
  if (typeof recursos !== 'object' || Array.isArray(recursos)) return false;
  return (
    (recursos.recebido === undefined || recursos.recebido === null || numeroOuNulo(recursos.recebido) !== null) &&
    (recursos.a_receber === undefined || recursos.a_receber === null || numeroOuNulo(recursos.a_receber) !== null) &&
    (recursos.rendimento_bruto === undefined ||
      recursos.rendimento_bruto === null ||
      numeroOuNulo(recursos.rendimento_bruto) !== null) &&
    (recursos.rendimento_liquido === undefined ||
      recursos.rendimento_liquido === null ||
      numeroOuNulo(recursos.rendimento_liquido) !== null)
  );
}

export async function executar(ctx, args) {
  const resolvido = await ctx.resolverCentro(args && args.project_id);
  if (resolvido.erro) return resolvido;
  const centro = resolvido.centro;

  const resposta = await chamarRpc(ctx, 'get_repasses_v2', { p_project_id: centro.id });
  if (resposta.erro) return { erro: resposta.erro };
  const dados = resposta.dados;
  if (
    !dados ||
    typeof dados !== 'object' ||
    !Array.isArray(dados.parcelas) ||
    !dados.parcelas.every(parcelaValida) ||
    (dados.valor_total_plano !== undefined &&
      dados.valor_total_plano !== null &&
      numeroOuNulo(dados.valor_total_plano) === null) ||
    (dados.data_balancete !== undefined &&
      dados.data_balancete !== null &&
      typeof dados.data_balancete !== 'string') ||
    !recursosValidos(dados.recursos)
  ) {
    return formatoInesperado('get_repasses_v2');
  }

  await ctx.mascara.garantirDicionario();

  const nos = [];
  const parcelas = [];

  for (const parcela of dados.parcelas) {
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

    const valorParcela = numeroOuNulo(parcela.valor);
    if (valorParcela !== null) {
      const no = registrarMoeda(
        ctx,
        valorParcela,
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
  let rendimentoBruto = null;
  let rendimentoLiquido = null;
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
    const noRendimentoBruto = registrarMoeda(
      ctx,
      dados.recursos.rendimento_bruto,
      'Rendimento bruto de aplicação',
      semDocumento(
        'rendimento bruto de aplicação lido do balancete vigente',
        'get_repasses_v2'
      )
    );
    const noRendimentoLiquido = registrarMoeda(
      ctx,
      dados.recursos.rendimento_liquido,
      'Rendimento líquido de aplicação',
      semDocumento(
        'rendimento líquido lido do balancete vigente; já incluído no saldo disponível, não somar',
        'get_repasses_v2'
      )
    );
    if (noRecebido) {
      recebido = noRecebido.id;
      nos.push(noRecebido);
    }
    if (noAReceber) {
      aReceber = noAReceber.id;
      nos.push(noAReceber);
    }
    if (noRendimentoBruto) {
      rendimentoBruto = noRendimentoBruto.id;
      nos.push(noRendimentoBruto);
    }
    if (noRendimentoLiquido) {
      rendimentoLiquido = noRendimentoLiquido.id;
      nos.push(noRendimentoLiquido);
    }
  }

  return {
    paraModelo: {
      parcelas,
      valor_total_plano: total ? total.id : null,
      data_balancete: dataBalancete ? dataBalancete.id : null,
      recursos:
        dados.recursos && typeof dados.recursos === 'object'
          ? {
              recebido,
              a_receber: aReceber,
              rendimento_bruto: rendimentoBruto,
              rendimento_liquido: rendimentoLiquido,
            }
          : null,
      nos: nos.map(mini),
    },
  };
}
