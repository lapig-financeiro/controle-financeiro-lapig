// termos_contrato — get_termos_contrato_v2 (contrato §4).
//
// Vigência, taxa e demais termos viram origem `termo`, que a tela abre no
// painel "Do contrato" com o trecho literal e o documento. O texto do trecho
// não vai ao modelo; a tela o lê pelo id do termo.
//
// Com `project_id`, consulta um centro. Sem `project_id`, consulta todos os
// centros visíveis em paralelo e devolve um único `{ centros, nos }`; falha de
// um centro fica registrada nele, nunca vira zero nem derruba os outros.

import {
  chamarRpc,
  ehDataIso,
  formatoInesperado,
  mensagemRpc,
  mini,
  origemTermo,
  registrarData,
  semDocumento,
} from './comum.js';

export const nome = 'termos_contrato';

const ROTULOS = {
  vigencia_inicio: 'Vigência — início',
  vigencia_fim: 'Vigência — fim',
  taxa_total: 'Taxa total',
  taxa_cip_ufg: 'Taxa CIP — UFG',
  taxa_cip_ua: 'Taxa CIP — unidade executora',
  taxa_dao: 'Taxa DAO',
};

function rotuloDoTermo(chave) {
  if (ROTULOS[chave]) return ROTULOS[chave];
  return chave.replace(/_/g, ' ');
}

function unidadeDoTermo(chave, termo) {
  const valor = termo.valor;
  if (typeof valor === 'string') {
    if (ehDataIso(valor)) return 'data';
    const numero = Number(valor);
    if (Number.isFinite(numero) && valor.trim() !== '') {
      const regra = typeof termo.regra === 'string' ? termo.regra : '';
      if (chave.startsWith('taxa') || regra.includes('%')) return 'percentual';
      return 'numero';
    }
    return 'texto';
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    const regra = typeof termo.regra === 'string' ? termo.regra : '';
    if (chave.startsWith('taxa') || regra.includes('%')) return 'percentual';
    return 'numero';
  }
  return 'texto';
}

function dadosValidos(dados) {
  return (
    dados &&
    typeof dados === 'object' &&
    !Array.isArray(dados) &&
    dados.termos &&
    typeof dados.termos === 'object' &&
    !Array.isArray(dados.termos) &&
    typeof dados.vigencia_situacao === 'string' &&
    (dados.start_date_cadastro === undefined ||
      dados.start_date_cadastro === null ||
      typeof dados.start_date_cadastro === 'string') &&
    (dados.end_date_cadastro === undefined ||
      dados.end_date_cadastro === null ||
      typeof dados.end_date_cadastro === 'string') &&
    Object.values(dados.termos).every(
      (termo) =>
        termo &&
        typeof termo === 'object' &&
        !Array.isArray(termo) &&
        typeof termo.id === 'string' &&
        termo.id !== '' &&
        (typeof termo.valor === 'string' || Number.isFinite(termo.valor))
    )
  );
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

/**
 * Um registrador por chamada de ferramenta: o mesmo valor, unidade e rótulo
 * vira um nó só, e todos os centros compartilham a numeração do resultado.
 */
function criarRegistradorUnico(ctx) {
  const feitos = new Map();

  return function unico(unidade, valor, rotulo, origem) {
    const motivo = origem && typeof origem === 'object' ? String(origem.motivo ?? '') : '';
    const chave = `${unidade}\u0000${rotulo}\u0000${String(valor)}\u0000${motivo}`;
    if (feitos.has(chave)) return feitos.get(chave);
    const no = ctx.registro.registrar({ valor, unidade, rotulo, origem });
    feitos.set(chave, no);
    return no;
  };
}

/** Monta os nós de um centro; em modo multi-centro o rótulo leva o código. */
function montarCentro(ctx, centro, dados, { sufixo = null, registrar }) {
  const rotulo = (base) => (sufixo ? `${base} — ${sufixo}` : base);
  const nos = [];
  const termos = {};

  for (const [chave, termo] of Object.entries(dados.termos)) {
    const unidade = unidadeDoTermo(chave, termo);
    let valor;
    if (unidade === 'data') valor = String(termo.valor).slice(0, 10);
    else if (unidade === 'texto') valor = ctx.mascara.texto(String(termo.valor ?? ''));
    else valor = Number(termo.valor);

    const no = registrar(
      unidade,
      valor,
      rotulo(rotuloDoTermo(chave)),
      origemTermo(centro.id, termo.id)
    );
    termos[chave] = no.id;
    nos.push(no);
  }

  const situacao = registrar(
    'texto',
    String(dados.vigencia_situacao ?? ''),
    rotulo('Vigência do contrato × cadastro'),
    semDocumento('comparação entre contrato e cadastro', 'get_termos_contrato_v2')
  );
  nos.push(situacao);

  const inicio = registrarData(
    ctx,
    dados.start_date_cadastro,
    rotulo('Início no cadastro'),
    semDocumento('cadastro do projeto', 'get_termos_contrato_v2')
  );
  if (inicio) nos.push(inicio);

  const fim = registrarData(
    ctx,
    dados.end_date_cadastro,
    rotulo('Fim no cadastro'),
    semDocumento('cadastro do projeto', 'get_termos_contrato_v2')
  );
  if (fim) nos.push(fim);

  return {
    item: {
      termos,
      vigencia_situacao: situacao.id,
      cadastro: { inicio: inicio ? inicio.id : null, fim: fim ? fim.id : null },
    },
    nos,
  };
}

async function executarUmCentro(ctx, projectId) {
  const resolvido = await ctx.resolverCentro(projectId);
  if (resolvido.erro) return resolvido;
  const centro = resolvido.centro;

  const resposta = await chamarRpc(ctx, 'get_termos_contrato_v2', { p_project_id: centro.id });
  if (resposta.erro) return { erro: resposta.erro };
  if (!dadosValidos(resposta.dados)) return formatoInesperado('get_termos_contrato_v2');

  await ctx.mascara.garantirDicionario();

  const registrar = criarRegistradorUnico(ctx);
  const { item, nos } = montarCentro(ctx, centro, resposta.dados, { registrar });
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
      chamarRpc(ctx, 'get_termos_contrato_v2', { p_project_id: centro.id })
    )
  );

  const nos = [];
  const centros = [];
  let falhas = 0;
  let primeiroErro = null;

  for (let indice = 0; indice < dadosCentros.centros.length; indice += 1) {
    const centro = dadosCentros.centros[indice];
    const nomeCentro = ctx.mascara.texto(centro.name);
    const noCodigo = registrar(
      'texto',
      centro.code,
      `Código — ${nomeCentro}`,
      semDocumento('cadastro do projeto', consulta)
    );
    const noNome = registrar(
      'texto',
      nomeCentro,
      `Nome do centro ${centro.code}`,
      semDocumento('cadastro do projeto', consulta)
    );
    nos.push(noCodigo, noNome);

    const resposta = respostas[indice];
    let erro = resposta.erro;
    if (!erro && !dadosValidos(resposta.dados)) {
      erro = `${mensagemRpc('get_termos_contrato_v2')} (formato)`;
    }
    if (erro) {
      falhas += 1;
      if (!primeiroErro) primeiroErro = erro;
      centros.push({ codigo: noCodigo.id, nome: noNome.id, erro });
      continue;
    }

    const { item, nos: nosDoCentro } = montarCentro(ctx, centro, resposta.dados, {
      sufixo: centro.code,
      registrar,
    });
    nos.push(...nosDoCentro);
    centros.push({ codigo: noCodigo.id, nome: noNome.id, ...item });
  }

  if (centros.length > 0 && falhas === centros.length) {
    return { erro: primeiroErro ?? `${mensagemRpc('get_termos_contrato_v2')} (formato)` };
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
