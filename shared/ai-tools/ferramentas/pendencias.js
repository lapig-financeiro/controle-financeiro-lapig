// pendencias — listar_pendencias_v2 (contrato §4).
//
// Pendência não tem documento: a origem é sem_documento com o próprio motivo.
// Texto livre (título, detalhe) passa pela máscara de nomes/CPF/e-mail.

import {
  chamarRpc,
  ehDataIso,
  formatoInesperado,
  mini,
  registrarData,
  registrarNumero,
  registrarTexto,
  semDocumento,
} from './comum.js';

export const nome = 'pendencias';

function registrarDetalhe(ctx, chave, valor, consulta) {
  const motivo = `detalhe da pendência (${chave})`;
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    const unidade = /valor|diferenca|saldo|montante/i.test(chave) ? 'moeda' : 'numero';
    return ctx.registro.registrar({
      valor,
      unidade,
      rotulo: `Detalhe — ${chave}`,
      origem: semDocumento(motivo, consulta),
    });
  }
  if (typeof valor === 'string') {
    if (ehDataIso(valor)) {
      return registrarData(ctx, valor, `Detalhe — ${chave}`, semDocumento(motivo, consulta));
    }
    return registrarTexto(ctx, valor, `Detalhe — ${chave}`, semDocumento(motivo, consulta));
  }
  if (typeof valor === 'boolean') {
    return registrarTexto(ctx, valor ? 'sim' : 'não', `Detalhe — ${chave}`, semDocumento(motivo, consulta));
  }
  return null;
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
  if (!Array.isArray(resposta.dados)) return formatoInesperado('listar_pendencias_v2');

  await ctx.mascara.garantirDicionario();

  const nos = [];
  const pendencias = [];

  for (const pendencia of resposta.dados) {
    if (!pendencia || typeof pendencia !== 'object') continue;
    const consulta = 'listar_pendencias_v2';
    const motivoPendencia = semDocumento('pendência; o texto é o registro', consulta);

    const titulo = registrarTexto(ctx, String(pendencia.titulo ?? ''), 'Título da pendência', motivoPendencia);
    const tipo = registrarTexto(ctx, String(pendencia.tipo ?? ''), 'Tipo da pendência', motivoPendencia);
    const situacao = registrarTexto(
      ctx,
      String(pendencia.situacao ?? ''),
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
    if (pendencia.detalhe && typeof pendencia.detalhe === 'object' && !Array.isArray(pendencia.detalhe)) {
      for (const [chave, valor] of Object.entries(pendencia.detalhe)) {
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
