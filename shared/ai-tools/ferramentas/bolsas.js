// bolsas — get_pedido_bolsas_v2 (contrato §4).
//
// O filtro de visão é o mesmo em toda forma da chamada: só bolsas de centros
// que `listar_centros` conhece. Com centro filtrado, `valor_vigente` global
// não aparece como se fosse do centro; as bolsas do centro vêm à parte do
// total global da pessoa. Nenhuma soma nova é feita no pacote.
//
// Nome de pessoa é campo fechado: vira ⟦Pn⟧ e nunca entra no paraModelo. CPF e
// e-mail não são lidos, mesmo que a RPC passe a devolvê-los.

import {
  chamarRpc,
  formatoInesperado,
  mini,
  numeroOuNulo,
  registrarData,
  registrarMoeda,
  registrarNumero,
  registrarTexto,
  semDocumento,
} from './comum.js';

export const nome = 'bolsas';

function bolsaValida(bolsa) {
  return (
    bolsa &&
    typeof bolsa === 'object' &&
    !Array.isArray(bolsa) &&
    typeof bolsa.project_id === 'string' &&
    bolsa.project_id !== '' &&
    typeof bolsa.code === 'string' &&
    numeroOuNulo(bolsa.valor) !== null &&
    typeof bolsa.inicio === 'string' &&
    typeof bolsa.fim === 'string' &&
    typeof bolsa.status === 'string' &&
    typeof bolsa.vigente_hoje === 'boolean'
  );
}

function bolsistaValido(bolsista) {
  return (
    bolsista &&
    typeof bolsista === 'object' &&
    !Array.isArray(bolsista) &&
    typeof bolsista.holder_id === 'string' &&
    bolsista.holder_id !== '' &&
    typeof bolsista.nome === 'string' &&
    numeroOuNulo(bolsista.valor_vigente) !== null &&
    (bolsista.equipe === undefined || bolsista.equipe === null || typeof bolsista.equipe === 'string') &&
    Array.isArray(bolsista.bolsas) &&
    bolsista.bolsas.every(bolsaValida)
  );
}

function caixaValida(caixa) {
  return (
    caixa &&
    typeof caixa === 'object' &&
    !Array.isArray(caixa) &&
    typeof caixa.nome === 'string' &&
    Number.isInteger(caixa.meses) &&
    Number.isInteger(caixa.pessoas) &&
    numeroOuNulo(caixa.total_mensal) !== null &&
    numeroOuNulo(caixa.total_periodo) !== null &&
    Number.isInteger(caixa.itens_ocultos) &&
    (caixa.itens === undefined || (Array.isArray(caixa.itens) && caixa.itens.every((item) => item && typeof item === 'object')))
  );
}

export async function executar(ctx, args) {
  let centro = null;
  if (args && args.project_id !== undefined && args.project_id !== null && args.project_id !== '') {
    const resolvido = await ctx.resolverCentro(args.project_id);
    if (resolvido.erro) return resolvido;
    centro = resolvido.centro;
  }

  let dadosCentros;
  try {
    dadosCentros = await ctx.carregarCentros();
  } catch (erro) {
    return {
      erro: erro && erro.message ? erro.message : 'Não foi possível carregar os centros. (http_4xx)',
    };
  }
  if (!dadosCentros || !Array.isArray(dadosCentros.centros)) {
    return formatoInesperado('resumo_projetos_v2');
  }
  const visiveis = new Set(dadosCentros.centros.map((item) => item.id));

  const resposta = await chamarRpc(ctx, 'get_pedido_bolsas_v2');
  if (resposta.erro) return { erro: resposta.erro };
  const dados = resposta.dados;
  if (
    !dados ||
    typeof dados !== 'object' ||
    !Array.isArray(dados.bolsistas) ||
    !dados.bolsistas.every(bolsistaValido) ||
    (dados.caixas !== undefined && (!Array.isArray(dados.caixas) || !dados.caixas.every(caixaValida)))
  ) {
    return formatoInesperado('get_pedido_bolsas_v2');
  }

  ctx.mascara.carregarNomes(dados.bolsistas);
  ctx.mascara.marcarDicionarioCarregado();

  const consulta = 'get_pedido_bolsas_v2';
  const origemBolsa = semDocumento('bolsa digitada, ainda sem documento', consulta);
  const nos = [];
  const bolsistas = [];
  const bolsistaPorId = new Map(dados.bolsistas.map((bolsista) => [bolsista.holder_id, bolsista]));

  for (const bolsista of dados.bolsistas) {
    const bolsas = bolsista.bolsas.filter(
      (bolsa) =>
        visiveis.has(bolsa.project_id) && (centro ? bolsa.project_id === centro.id : true)
    );
    if (bolsas.length === 0) continue;

    const nomeMascarado = ctx.mascara.nome(bolsista.nome);
    if (!nomeMascarado) continue;
    const noNome = registrarTexto(ctx, nomeMascarado, 'Bolsista (mascarado)', origemBolsa);
    nos.push(noNome);

    const ocultas = bolsista.bolsas.some(
      (bolsa) => !visiveis.has(bolsa.project_id) && bolsa.vigente_hoje === true
    );
    const saida = {
      nome: noNome.id,
      valor_vigente: null,
      total_global: null,
      aviso: null,
      equipe: null,
      bolsas: [],
    };

    if (ocultas) {
      const noAviso = registrarTexto(
        ctx,
        'inclui centros fora da sua visão; veja as bolsas uma a uma',
        'Aviso — total',
        semDocumento('total inclui centros fora da visão', consulta)
      );
      saida.aviso = noAviso.id;
      nos.push(noAviso);
    } else {
      const totalGlobal = registrarMoeda(
        ctx,
        bolsista.valor_vigente,
        centro
          ? 'Total vigente da pessoa (todos os centros)'
          : 'Valor vigente (todos os centros)',
        origemBolsa
      );
      if (totalGlobal) {
        if (centro) saida.total_global = totalGlobal.id;
        else saida.valor_vigente = totalGlobal.id;
        nos.push(totalGlobal);
      }
    }

    if (typeof bolsista.equipe === 'string' && bolsista.equipe) {
      const noEquipe = registrarTexto(ctx, bolsista.equipe, 'Equipe', origemBolsa);
      saida.equipe = noEquipe.id;
      nos.push(noEquipe);
    }

    for (const bolsa of bolsas) {
      const item = {
        centro: null,
        valor: null,
        inicio: null,
        fim: null,
        status: null,
        vigente_hoje: null,
      };

      const noCentro = registrarTexto(ctx, bolsa.code, 'Centro da bolsa', origemBolsa);
      item.centro = noCentro.id;
      nos.push(noCentro);

      const noValor = registrarMoeda(ctx, bolsa.valor, 'Valor mensal da bolsa', origemBolsa);
      if (noValor) {
        item.valor = noValor.id;
        nos.push(noValor);
      }

      const noInicio = registrarData(ctx, bolsa.inicio, 'Início da bolsa', origemBolsa);
      if (noInicio) {
        item.inicio = noInicio.id;
        nos.push(noInicio);
      }
      const noFim = registrarData(ctx, bolsa.fim, 'Fim da bolsa', origemBolsa);
      if (noFim) {
        item.fim = noFim.id;
        nos.push(noFim);
      }

      const noStatus = registrarTexto(ctx, bolsa.status, 'Situação da bolsa', origemBolsa);
      item.status = noStatus.id;
      nos.push(noStatus);

      const noVigente = registrarTexto(
        ctx,
        bolsa.vigente_hoje ? 'sim' : 'não',
        'Vigente hoje',
        origemBolsa
      );
      item.vigente_hoje = noVigente.id;
      nos.push(noVigente);

      saida.bolsas.push(item);
    }

    bolsistas.push(saida);
  }

  const caixas = [];
  for (const caixa of dados.caixas ?? []) {
    const item = {
      nome: null,
      meses: null,
      pessoas: null,
      total_mensal: null,
      total_periodo: null,
      itens_ocultos: null,
      aviso: null,
    };
    const origemCaixa = semDocumento('caixa do pedido de bolsas', consulta);

    const noNome = registrarTexto(ctx, caixa.nome, 'Nome da caixa', origemCaixa);
    item.nome = noNome.id;
    nos.push(noNome);

    const meses = registrarNumero(ctx, caixa.meses, 'Meses da caixa', origemCaixa);
    if (meses) {
      item.meses = meses.id;
      nos.push(meses);
    }
    const pessoas = registrarNumero(ctx, caixa.pessoas, 'Pessoas na caixa', origemCaixa);
    if (pessoas) {
      item.pessoas = pessoas.id;
      nos.push(pessoas);
    }

    const incluiFora = (caixa.itens ?? []).some((entrada) => {
      if (entrada.valor_mensal !== null && entrada.valor_mensal !== undefined) return false;
      const pessoa = bolsistaPorId.get(entrada.holder_id);
      if (!pessoa) return true;
      return pessoa.bolsas.some(
        (bolsa) => !visiveis.has(bolsa.project_id) && bolsa.vigente_hoje === true
      );
    });

    if (incluiFora) {
      const noAviso = registrarTexto(
        ctx,
        'inclui centros fora da sua visão; veja as bolsas uma a uma',
        'Aviso — total da caixa',
        semDocumento('total da caixa inclui centros fora da visão', consulta)
      );
      item.aviso = noAviso.id;
      nos.push(noAviso);
    } else {
      const totalMensal = registrarMoeda(ctx, caixa.total_mensal, 'Total mensal da caixa', origemCaixa);
      if (totalMensal) {
        item.total_mensal = totalMensal.id;
        nos.push(totalMensal);
      }
      const totalPeriodo = registrarMoeda(ctx, caixa.total_periodo, 'Total do período da caixa', origemCaixa);
      if (totalPeriodo) {
        item.total_periodo = totalPeriodo.id;
        nos.push(totalPeriodo);
      }
    }

    const ocultos = registrarNumero(ctx, caixa.itens_ocultos, 'Itens ocultos da caixa', origemCaixa);
    if (ocultos) {
      item.itens_ocultos = ocultos.id;
      nos.push(ocultos);
    }

    caixas.push(item);
  }

  const total = registrarNumero(
    ctx,
    bolsistas.length,
    'Bolsistas listados',
    semDocumento('contagem da lista', consulta)
  );
  if (total) nos.push(total);

  return {
    paraModelo: {
      total: total ? total.id : null,
      bolsistas,
      caixas,
      nos: nos.map(mini),
    },
  };
}
