// pendencias — listar_pendencias_v2 (contrato §4).
//
// Pendência não tem documento: a origem é sem_documento com o próprio motivo.
// `detalhe` passa por uma lista fechada de chaves conhecidas (as que o app e as
// migrações gravam) e nunca vira nó quando a chave fala de pessoa ou o valor é
// um número de 11 dígitos (CPF antigo).

import { ehNumeroOnzeDigitos } from '../cpf.js';

import {
  chamarRpc,
  formatoInesperado,
  mini,
  registrarData,
  registrarNumero,
  registrarTexto,
  semDocumento,
} from './comum.js';

export const nome = 'pendencias';

const CHAVES_DETALHE = new Set([
  'conta',
  'competencia',
  'descricao',
  'documento',
  'rubrica',
  'diferenca',
  'quantidade',
  'referencia',
  'escopo',
  'observacao',
  'valor',
  'tarifa',
]);

const CHAVE_SENSIVEL = /nome|cpf|e-?mail|pessoa|bolsista/i;

function pendenciaValida(pendencia) {
  return (
    pendencia &&
    typeof pendencia === 'object' &&
    !Array.isArray(pendencia) &&
    typeof pendencia.titulo === 'string' &&
    typeof pendencia.tipo === 'string' &&
    typeof pendencia.situacao === 'string' &&
    (pendencia.code === undefined || pendencia.code === null || typeof pendencia.code === 'string') &&
    (pendencia.criada_em === undefined ||
      pendencia.criada_em === null ||
      typeof pendencia.criada_em === 'string') &&
    (pendencia.detalhe === undefined ||
      pendencia.detalhe === null ||
      (typeof pendencia.detalhe === 'object' && !Array.isArray(pendencia.detalhe)))
  );
}

function registrarDetalhe(ctx, chave, valor, consulta) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  const motivo = `detalhe da pendência (${chave})`;
  const unidade = /valor|diferenca|saldo|montante|tarifa/i.test(chave) ? 'moeda' : 'numero';
  return ctx.registro.registrar({
    valor,
    unidade,
    rotulo: `Detalhe — ${chave}`,
    origem: semDocumento(motivo, consulta),
  });
}

export async function executar(ctx, args) {
  let centro = null;
  if (args && args.project_id !== undefined && args.project_id !== null && args.project_id !== '') {
    const resolvido = await ctx.resolverCentro(args.project_id);
    if (resolvido.erro) return resolvido;
    centro = resolvido.centro;
  }

  const resposta = await chamarRpc(ctx, 'listar_pendencias_v2', {
    p_project_id: centro ? centro.id : null,
  });
  if (resposta.erro) return { erro: resposta.erro };
  if (!Array.isArray(resposta.dados) || !resposta.dados.every(pendenciaValida)) {
    return formatoInesperado('listar_pendencias_v2');
  }

  await ctx.mascara.garantirDicionario();

  const nos = [];
  const pendencias = [];

  for (const pendencia of resposta.dados) {
    const consulta = 'listar_pendencias_v2';
    const motivoPendencia = semDocumento('pendência; o texto é o registro', consulta);

    const titulo = registrarTexto(ctx, pendencia.titulo, 'Título da pendência', motivoPendencia);
    const tipo = registrarTexto(ctx, pendencia.tipo, 'Tipo da pendência', motivoPendencia);
    const situacao = registrarTexto(
      ctx,
      pendencia.situacao,
      'Situação da pendência',
      motivoPendencia
    );
    nos.push(titulo, tipo, situacao);

    let centroNo = null;
    if (typeof pendencia.code === 'string' && pendencia.code) {
      centroNo = registrarTexto(
        ctx,
        pendencia.code,
        'Centro da pendência',
        semDocumento('código do centro da pendência', consulta)
      );
      nos.push(centroNo);
    }

    let criadaEm = null;
    if (pendencia.criada_em) {
      criadaEm = registrarData(
        ctx,
        pendencia.criada_em,
        'Criada em',
        semDocumento('data de criação da pendência', consulta)
      );
      if (criadaEm) nos.push(criadaEm);
    }

    const detalhe = {};
    if (pendencia.detalhe && typeof pendencia.detalhe === 'object') {
      for (const [chave, valor] of Object.entries(pendencia.detalhe)) {
        if (!CHAVES_DETALHE.has(chave) || CHAVE_SENSIVEL.test(chave)) continue;
        if (ehNumeroOnzeDigitos(valor)) continue;
        const chaveSegura = ctx.mascara.texto(chave);
        if (!chaveSegura) continue;
        const no = registrarDetalhe(ctx, chaveSegura, valor, consulta);
        if (no) {
          detalhe[chaveSegura] = no.id;
          nos.push(no);
        }
      }
    }

    pendencias.push({
      titulo: titulo.id,
      tipo: tipo.id,
      situacao: situacao.id,
      centro: centroNo ? centroNo.id : null,
      criada_em: criadaEm ? criadaEm.id : null,
      detalhe,
    });
  }

  const total = registrarNumero(
    ctx,
    pendencias.length,
    'Pendências listadas',
    semDocumento('contagem da lista', 'listar_pendencias_v2')
  );
  if (total) nos.push(total);

  return {
    paraModelo: {
      pendencias,
      total: total ? total.id : null,
      nos: nos.map(mini),
    },
  };
}
