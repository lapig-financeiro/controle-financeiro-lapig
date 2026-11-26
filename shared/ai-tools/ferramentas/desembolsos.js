// desembolsos — get_repasses_v2 (contrato §4).
//
// A parcela do plano não carrega ref hoje; a origem honesta é sem_documento.
// Se uma linha trouxer ref (formato previsto no contrato), ela vira `ref`.
//
// Com `project_id`, consulta um centro (comportamento original). Sem
// `project_id`, consulta todos os centros visíveis em paralelo e devolve um
// único `{ centros, nos }`: a falha de um centro fica registrada nele e nunca
// vira zero nem derruba os outros.

import {
  chamarRpc,
  formatoInesperado,
  mensagemRpc,
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

/**
 * `recursos` em si precisa ser objeto (ou ausente). Campo individual
 * malformado (`recebido: "N/A"`, `rendimento_bruto: {}`) é ignorado na hora de
 * registrar e fica `null`, nunca `0`, sem derrubar a ferramenta inteira (M15).
 */
function recursosValidos(recursos) {
  return (
    recursos === undefined ||
    recursos === null ||
    (typeof recursos === 'object' && !Array.isArray(recursos))
  );
}

function dadosValidos(dados) {
  return (
    dados &&
    typeof dados === 'object' &&
    !Array.isArray(dados) &&
    Array.isArray(dados.parcelas) &&
    dados.parcelas.every(parcelaValida) &&
    (dados.valor_total_plano === undefined ||
      dados.valor_total_plano === null ||
      numeroOuNulo(dados.valor_total_plano) !== null) &&
    (dados.data_balancete === undefined ||
      dados.data_balancete === null ||
      typeof dados.data_balancete === 'string') &&
    recursosValidos(dados.recursos)
  );
}

/**
 * Um registrador por chamada de ferramenta: o mesmo valor com o mesmo rótulo
 * vira um nó só, e todos os centros compartilham a numeração do resultado.
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

function centroValido(centro) {
  return (
    centro &&
    typeof centro === 'object' &&
    !Array.isArray(centro) &&
    typeof centro.id === 'string' &&
    centro.id !== '' &&
    typeof centro.code === 'string' &&
    typeof centro.name === 'string'
  );
}

/** Monta os nós de um centro; em modo multi-centro o rótulo leva o código. */
function montarCentro(ctx, dados, { sufixo = null, registrar }) {
  const rotulo = (base) => (sufixo ? `${base} — ${sufixo}` : base);
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
      const no = registrar.numero(numeroParcela, rotulo(`Parcela ${numeroParcela}`), origemParcela);
      if (no) {
        saida.parcela = no.id;
        nos.push(no);
      }
    }

    if (parcela.data_prevista) {
      const no = registrar.data(
        parcela.data_prevista,
        rotulo(`Data prevista — parcela ${numeroParcela ?? '?'}`),
        origemParcela
      );
      if (no) {
        saida.data = no.id;
        nos.push(no);
      }
    }

    if (parcela.data_texto) {
      const no = registrar.texto(
        parcela.data_texto,
        rotulo(`Data descrita — parcela ${numeroParcela ?? '?'}`),
        origemParcela
      );
      saida.data_texto = no.id;
      nos.push(no);
    }

    const valorParcela = numeroOuNulo(parcela.valor);
    if (valorParcela !== null) {
      const no = registrar.moeda(
        valorParcela,
        rotulo(`Valor — parcela ${numeroParcela ?? '?'}`),
        origemValor
      );
      if (no) {
        saida.valor = no.id;
        nos.push(no);
      }
    }

    if (parcela.valor_texto) {
      const no = registrar.texto(
        parcela.valor_texto,
        rotulo(`Valor descrito — parcela ${numeroParcela ?? '?'}`),
        origemValor
      );
      saida.valor_texto = no.id;
      nos.push(no);
    }

    parcelas.push(saida);
  }

  const total = registrar.moeda(
    dados.valor_total_plano,
    rotulo('Valor total do plano'),
    semDocumento('valor total do plano ativo', 'get_repasses_v2')
  );
  if (total) nos.push(total);

  const dataBalancete = registrar.data(
    dados.data_balancete,
    rotulo('Balancete de referência'),
    semDocumento('data do balancete vigente', 'get_repasses_v2')
  );
  if (dataBalancete) nos.push(dataBalancete);

  let recebido = null;
  let aReceber = null;
  let rendimentoBruto = null;
  let rendimentoLiquido = null;
  if (dados.recursos && typeof dados.recursos === 'object') {
    const noRecebido = registrar.moeda(
      dados.recursos.recebido,
      rotulo('Recursos recebidos'),
      semDocumento('recursos lidos do balancete vigente', 'get_repasses_v2')
    );
    const noAReceber = registrar.moeda(
      dados.recursos.a_receber,
      rotulo('Recursos a receber'),
      semDocumento('recursos lidos do balancete vigente', 'get_repasses_v2')
    );
    const noRendimentoBruto = registrar.moeda(
      dados.recursos.rendimento_bruto,
      rotulo('Rendimento bruto de aplicação'),
      semDocumento('rendimento bruto de aplicação lido do balancete vigente', 'get_repasses_v2')
    );
    const noRendimentoLiquido = registrar.moeda(
      dados.recursos.rendimento_liquido,
      rotulo('Rendimento líquido de aplicação'),
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
    item: {
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
    },
    nos,
  };
}

async function executarUmCentro(ctx, projectId) {
  const resolvido = await ctx.resolverCentro(projectId);
  if (resolvido.erro) return resolvido;
  const centro = resolvido.centro;

  const resposta = await chamarRpc(ctx, 'get_repasses_v2', { p_project_id: centro.id });
  if (resposta.erro) return { erro: resposta.erro };
  if (!dadosValidos(resposta.dados)) return formatoInesperado('get_repasses_v2');

  await ctx.mascara.garantirDicionario();

  const registrar = criarRegistradorUnico(ctx);
  const { item, nos } = montarCentro(ctx, resposta.dados, { registrar });
  return { paraModelo: { ...item, nos: nos.map(mini) } };
}

async function executarTodosCentros(ctx) {
  let dadosCentros;
  try {
    dadosCentros = await ctx.carregarCentros();
  } catch (erro) {
    return {
      erro: erro && erro.message ? erro.message : 'Não foi possível carregar os centros. (http_4xx)',
    };
  }
  if (
    !dadosCentros ||
    !Array.isArray(dadosCentros.centros) ||
    !dadosCentros.centros.every(centroValido)
  ) {
    return formatoInesperado('resumo_projetos_v2');
  }

  await ctx.mascara.garantirDicionario();

  const registrar = criarRegistradorUnico(ctx);
  const consulta = 'resumo_projetos_v2';
  const respostas = await Promise.all(
    dadosCentros.centros.map((centro) =>
      chamarRpc(ctx, 'get_repasses_v2', { p_project_id: centro.id })
    )
  );

  const nos = [];
  const centros = [];
  let falhas = 0;
  let primeiroErro = null;

  for (let indice = 0; indice < dadosCentros.centros.length; indice += 1) {
    const centro = dadosCentros.centros[indice];
    const nomeCentro = ctx.mascara.texto(centro.name);
    const sufixo = centro.code;
    const noCodigo = registrar.texto(
      centro.code,
      `Código — ${nomeCentro}`,
      semDocumento('cadastro do projeto', consulta)
    );
    const noNome = registrar.texto(
      nomeCentro,
      `Nome do centro ${centro.code}`,
      semDocumento('cadastro do projeto', consulta)
    );
    nos.push(noCodigo, noNome);

    const resposta = respostas[indice];
    let erro = resposta.erro;
    if (!erro && !dadosValidos(resposta.dados)) {
      erro = `${mensagemRpc('get_repasses_v2')} (formato)`;
    }
    if (erro) {
      falhas += 1;
      if (!primeiroErro) primeiroErro = erro;
      centros.push({ codigo: noCodigo.id, nome: noNome.id, erro });
      continue;
    }

    const { item, nos: nosDoCentro } = montarCentro(ctx, resposta.dados, {
      sufixo,
      registrar,
    });
    nos.push(...nosDoCentro);
    centros.push({ codigo: noCodigo.id, nome: noNome.id, ...item });
  }

  if (centros.length > 0 && falhas === centros.length) {
    return { erro: primeiroErro ?? `${mensagemRpc('get_repasses_v2')} (formato)` };
  }

  const nosUnicos = [...new Map(nos.map((no) => [no.id, no])).values()];
  return { paraModelo: { centros, nos: nosUnicos.map(mini) } };
}

export async function executar(ctx, args) {
  const projectId = args && args.project_id;
  if (projectId === undefined || projectId === null || projectId === '') {
    return executarTodosCentros(ctx);
  }
  return executarUmCentro(ctx, projectId);
}
