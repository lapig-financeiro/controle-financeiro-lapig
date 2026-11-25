// termos_contrato — get_termos_contrato_v2 (contrato §4).
//
// Vigência, taxa e demais termos viram origem `termo`, que a tela abre no
// painel "Do contrato" com o trecho literal e o documento. O texto do trecho
// não vai ao modelo; a tela o lê pelo id do termo.

import {
  chamarRpc,
  ehDataIso,
  formatoInesperado,
  mini,
  origemTermo,
  registrarData,
  registrarTexto,
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

export async function executar(ctx, args) {
  const resolvido = await ctx.resolverCentro(args && args.project_id);
  if (resolvido.erro) return resolvido;
  const centro = resolvido.centro;

  const resposta = await chamarRpc(ctx, 'get_termos_contrato_v2', { p_project_id: centro.id });
  if (resposta.erro) return { erro: resposta.erro };
  const dados = resposta.dados;
  if (
    !dados ||
    typeof dados !== 'object' ||
    Array.isArray(dados) ||
    !dados.termos ||
    typeof dados.termos !== 'object' ||
    Array.isArray(dados.termos) ||
    typeof dados.vigencia_situacao !== 'string' ||
    (dados.start_date_cadastro !== undefined &&
      dados.start_date_cadastro !== null &&
      typeof dados.start_date_cadastro !== 'string') ||
    (dados.end_date_cadastro !== undefined &&
      dados.end_date_cadastro !== null &&
      typeof dados.end_date_cadastro !== 'string') ||
    !Object.values(dados.termos).every(
      (termo) =>
        termo &&
        typeof termo === 'object' &&
        !Array.isArray(termo) &&
        typeof termo.id === 'string' &&
        termo.id !== '' &&
        (typeof termo.valor === 'string' || Number.isFinite(termo.valor))
    )
  ) {
    return formatoInesperado('get_termos_contrato_v2');
  }

  const nos = [];
  const termos = {};

  for (const [chave, termo] of Object.entries(dados.termos)) {
    const unidade = unidadeDoTermo(chave, termo);
    let valor;
    if (unidade === 'data') valor = String(termo.valor).slice(0, 10);
    else if (unidade === 'texto') valor = ctx.mascara.texto(String(termo.valor ?? ''));
    else valor = Number(termo.valor);

    const no = ctx.registro.registrar({
      valor,
      unidade,
      rotulo: rotuloDoTermo(chave),
      origem: origemTermo(centro.id, termo.id),
    });
    termos[chave] = no.id;
    nos.push(no);
  }

  const situacao = registrarTexto(
    ctx,
    String(dados.vigencia_situacao ?? ''),
    'Vigência do contrato × cadastro',
    semDocumento('comparação entre contrato e cadastro', 'get_termos_contrato_v2')
  );
  nos.push(situacao);

  const inicio = registrarData(
    ctx,
    dados.start_date_cadastro,
    'Início no cadastro',
    semDocumento('cadastro do projeto', 'get_termos_contrato_v2')
  );
  if (inicio) nos.push(inicio);

  const fim = registrarData(
    ctx,
    dados.end_date_cadastro,
    'Fim no cadastro',
    semDocumento('cadastro do projeto', 'get_termos_contrato_v2')
  );
  if (fim) nos.push(fim);

  return {
    paraModelo: {
      termos,
      vigencia_situacao: situacao.id,
      cadastro: { inicio: inicio ? inicio.id : null, fim: fim ? fim.id : null },
      nos: nos.map(mini),
    },
  };
}
