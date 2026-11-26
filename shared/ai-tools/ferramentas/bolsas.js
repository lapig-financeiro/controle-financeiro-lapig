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

/** Rótulo em pt-BR da situação da bolsa (M14); valor desconhecido segue cru. */
const STATUS_PT = Object.freeze({
  active: 'ativa',
  ended: 'encerrada',
  cancelled: 'cancelada',
  pending: 'pendente',
});

/**
 * Teto do JSON que volta ao modelo, abaixo do teto de 60.000 do Worker: acima
 * disso a lista de bolsistas é cortada, com aviso explícito (M4).
 */
const TETO_PARA_MODELO_CHARS = 55_000;
const AVISO_CORTE =
  'Resultado cortado para caber no limite; filtre por project_id para ver todas as bolsas de um centro.';

function idsCitados(valor, alvo = new Set()) {
  if (typeof valor === 'string') {
    if (/^(?:r\d+|c\d+)(?:\.\d+)?$/.test(valor)) alvo.add(valor);
  } else if (Array.isArray(valor)) {
    for (const item of valor) idsCitados(item, alvo);
  } else if (valor && typeof valor === 'object') {
    for (const item of Object.values(valor)) idsCitados(item, alvo);
  }
  return alvo;
}

/**
 * Corta a lista de bolsistas por prefixo (determinístico) até o JSON caber no
 * teto e mantém só os nós citados pelos itens que ficaram. Os campos `total`,
 * `caixas` e os avisos continuam inteiros.
 */
function cortarParaCaber(paraModelo) {
  if (JSON.stringify(paraModelo).length <= TETO_PARA_MODELO_CHARS) return paraModelo;

  const totalBolsistas = paraModelo.bolsistas.length;

  function montarCorte(manter) {
    const candidato = {
      ...paraModelo,
      bolsistas: paraModelo.bolsistas.slice(0, manter),
      parcial: true,
      bolsistas_retornados: manter,
      bolsistas_total: totalBolsistas,
      aviso_corte: AVISO_CORTE,
    };
    const semNos = { ...candidato };
    delete semNos.nos;
    const usados = idsCitados(semNos);
    candidato.nos = paraModelo.nos.filter((no) => usados.has(no.id));
    return candidato;
  }

  let baixo = 0;
  let alto = totalBolsistas;
  let melhor = montarCorte(0);
  while (baixo <= alto) {
    const meio = Math.floor((baixo + alto) / 2);
    const candidato = montarCorte(meio);
    if (JSON.stringify(candidato).length <= TETO_PARA_MODELO_CHARS) {
      melhor = candidato;
      baixo = meio + 1;
    } else {
      alto = meio - 1;
    }
  }
  return melhor;
}

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

/**
 * Registrador com memo por (unidade, rótulo, valor): a mesma informação repetida
 * em bolsas diferentes vira um nó só. O valor e a origem são idênticos; o modelo
 * cita o mesmo id em duas linhas sem ganhar nem perder nada.
 */
function criarRegistradorUnico(ctx) {
  const feitos = new Map();

  function unico(unidade, valor, rotulo, origem, registrar) {
    const motivo = origem && typeof origem === 'object' ? String(origem.motivo ?? '') : '';
    const chave = `${unidade}\u0000${rotulo}\u0000${String(valor)}\u0000${motivo}`;
    if (feitos.has(chave)) return feitos.get(chave);
    const no = registrar();
    if (no) feitos.set(chave, no);
    return no;
  }

  return {
    texto: (valor, rotulo, origem) =>
      unico('texto', valor, rotulo, origem, () => registrarTexto(ctx, valor, rotulo, origem)),
    data: (valor, rotulo, origem) =>
      unico('data', valor, rotulo, origem, () => registrarData(ctx, valor, rotulo, origem)),
    moeda: (valor, rotulo, origem) =>
      unico('moeda', valor, rotulo, origem, () => registrarMoeda(ctx, valor, rotulo, origem)),
    numero: (valor, rotulo, origem) =>
      unico('numero', valor, rotulo, origem, () => registrarNumero(ctx, valor, rotulo, origem)),
  };
}

/**
 * Bolsa que ainda vai começar (início depois de hoje) e não foi cancelada nem
 * encerrada: é compromisso, então entra no recorte padrão junto das vigentes.
 */
function comecaDepois(bolsa, hoje) {
  if (typeof hoje !== 'string' || typeof bolsa.inicio !== 'string') return false;
  if (bolsa.status === 'cancelled' || bolsa.status === 'ended') return false;
  return bolsa.inicio.slice(0, 10) > hoje;
}

/** AAAA-MM-DD + n dias, em UTC (sem fuso nem horário de verão no meio). */
function somarDias(dia, n) {
  const data = new Date(`${dia}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + n);
  return data.toISOString().slice(0, 10);
}

export async function executar(ctx, args) {
  let centro = null;
  if (args && args.project_id !== undefined && args.project_id !== null && args.project_id !== '') {
    const resolvido = await ctx.resolverCentro(args.project_id);
    if (resolvido.erro) return resolvido;
    centro = resolvido.centro;
  }

  let incluirEncerradas = false;
  if (args && args.incluir_encerradas !== undefined) {
    if (typeof args.incluir_encerradas !== 'boolean') {
      return { erro: 'O parâmetro incluir_encerradas deve ser true ou false.' };
    }
    incluirEncerradas = args.incluir_encerradas;
  }

  // "Quais terminam nos próximos N dias": o corte por data é feito aqui, não
  // pelo modelo (na bancada de 26/11 ele leu 31/12 e escreveu "nenhuma").
  let limiteFim = null;
  let diasPedidos = null;
  if (args && args.terminam_em_dias !== undefined && args.terminam_em_dias !== null) {
    const dias = args.terminam_em_dias;
    if (!Number.isInteger(dias) || dias < 1 || dias > 366) {
      return { erro: 'O parâmetro terminam_em_dias deve ser um inteiro de 1 a 366.' };
    }
    if (typeof ctx.hoje !== 'string') {
      return { erro: 'Sem a data de hoje não dá para filtrar por fim. (interno)' };
    }
    limiteFim = somarDias(ctx.hoje, dias);
    diasPedidos = dias;
  }
  const terminaNoPeriodo = (bolsa) => {
    if (!limiteFim) return true;
    if (bolsa.status === 'cancelled' || typeof bolsa.fim !== 'string') return false;
    const fim = bolsa.fim.slice(0, 10);
    return fim >= ctx.hoje && fim <= limiteFim;
  };

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
  const registrar = criarRegistradorUnico(ctx);
  const nos = [];
  const bolsistas = [];
  const bolsistaPorId = new Map(dados.bolsistas.map((bolsista) => [bolsista.holder_id, bolsista]));

  for (const bolsista of dados.bolsistas) {
    const bolsas = bolsista.bolsas.filter(
      (bolsa) =>
        visiveis.has(bolsa.project_id) &&
        (centro ? bolsa.project_id === centro.id : true) &&
        (incluirEncerradas || bolsa.vigente_hoje === true || comecaDepois(bolsa, ctx.hoje)) &&
        terminaNoPeriodo(bolsa)
    );
    if (bolsas.length === 0) continue;

    const nomeMascarado = ctx.mascara.nome(bolsista.nome);
    if (!nomeMascarado) continue;
    const noNome = registrar.texto(nomeMascarado, 'Bolsista', origemBolsa);
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
      const noAviso = registrar.texto(
        'inclui centros fora da sua visão; veja as bolsas uma a uma',
        'Aviso',
        semDocumento('total inclui centros fora da visão', consulta)
      );
      saida.aviso = noAviso.id;
      nos.push(noAviso);
    } else {
      const totalGlobal = registrar.moeda(
        bolsista.valor_vigente,
        'Total vigente',
        origemBolsa
      );
      if (totalGlobal) {
        if (centro) saida.total_global = totalGlobal.id;
        else saida.valor_vigente = totalGlobal.id;
        nos.push(totalGlobal);
      }
    }

    if (typeof bolsista.equipe === 'string' && bolsista.equipe) {
      const noEquipe = registrar.texto(bolsista.equipe, 'Equipe', origemBolsa);
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
      };

      const noCentro = registrar.texto(bolsa.code, 'Centro', origemBolsa);
      item.centro = noCentro.id;
      nos.push(noCentro);

      const noValor = registrar.moeda(bolsa.valor, 'Valor', origemBolsa);
      if (noValor) {
        item.valor = noValor.id;
        nos.push(noValor);
      }

      const noInicio = registrar.data(bolsa.inicio, 'Início', origemBolsa);
      if (noInicio) {
        item.inicio = noInicio.id;
        nos.push(noInicio);
      }
      const noFim = registrar.data(bolsa.fim, 'Fim', origemBolsa);
      if (noFim) {
        item.fim = noFim.id;
        nos.push(noFim);
      }

      const noStatus = registrar.texto(
        STATUS_PT[bolsa.status] ?? bolsa.status,
        'Situação',
        origemBolsa
      );
      item.status = noStatus.id;
      nos.push(noStatus);

      // Por padrão entram vigentes e as que ainda vão começar; o campo diz
      // qual é qual sempre que a bolsa não for vigente hoje.
      if (incluirEncerradas || bolsa.vigente_hoje !== true) {
        const noVigente = registrar.texto(
          bolsa.vigente_hoje ? 'sim' : 'não',
          'Vigente hoje',
          origemBolsa
        );
        item.vigente_hoje = noVigente.id;
        nos.push(noVigente);
      }

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

    const noNome = registrar.texto(caixa.nome, 'Caixa', origemCaixa);
    item.nome = noNome.id;
    nos.push(noNome);

    const meses = registrar.numero(caixa.meses, 'Meses', origemCaixa);
    if (meses) {
      item.meses = meses.id;
      nos.push(meses);
    }
    const pessoas = registrar.numero(caixa.pessoas, 'Pessoas', origemCaixa);
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
      const noAviso = registrar.texto(
        'inclui centros fora da sua visão; veja as bolsas uma a uma',
        'Aviso',
        semDocumento('total da caixa inclui centros fora da visão', consulta)
      );
      item.aviso = noAviso.id;
      nos.push(noAviso);
    } else {
      const totalMensal = registrar.moeda(caixa.total_mensal, 'Total mensal', origemCaixa);
      if (totalMensal) {
        item.total_mensal = totalMensal.id;
        nos.push(totalMensal);
      }
      const totalPeriodo = registrar.moeda(caixa.total_periodo, 'Total do período', origemCaixa);
      if (totalPeriodo) {
        item.total_periodo = totalPeriodo.id;
        nos.push(totalPeriodo);
      }
    }

    const ocultos = registrar.numero(caixa.itens_ocultos, 'Itens ocultos', origemCaixa);
    if (ocultos) {
      item.itens_ocultos = ocultos.id;
      nos.push(ocultos);
    }

    caixas.push(item);
  }

  const total = registrar.numero(
    bolsistas.length,
    'Bolsistas',
    semDocumento('contagem da lista', consulta)
  );
  if (total) nos.push(total);

  let periodo = null;
  if (limiteFim) {
    const origemPeriodo = semDocumento('filtro de fim aplicado pela ferramenta', consulta);
    const noLimite = registrar.data(limiteFim, 'Terminam até', origemPeriodo);
    const qtd = bolsistas.reduce((soma, b) => soma + b.bolsas.length, 0);
    const noQtd = registrar.numero(qtd, 'Bolsas que terminam no período', origemPeriodo);
    const noDias = registrar.numero(diasPedidos, 'Dias a partir de hoje', origemPeriodo);
    periodo = {
      dias: noDias ? noDias.id : null,
      termina_ate: noLimite ? noLimite.id : null,
      bolsas: noQtd ? noQtd.id : null,
    };
    if (noDias) nos.push(noDias);
    if (noLimite) nos.push(noLimite);
    if (noQtd) nos.push(noQtd);
  }

  const nosUnicos = [...new Map(nos.map((no) => [no.id, no])).values()];

  return {
    paraModelo: cortarParaCaber({
      total: total ? total.id : null,
      ...(periodo ? { periodo } : {}),
      bolsistas,
      caixas,
      nos: nosUnicos.map(mini),
    }),
  };
}
