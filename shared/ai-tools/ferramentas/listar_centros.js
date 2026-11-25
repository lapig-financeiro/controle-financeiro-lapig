// listar_centros — resumo_projetos_v2 (contrato §4).
//
// Livre de cada centro vem de resumo_projetos_v2, sem árvore no resultado:
// a origem honesta é `livre` (o clique primeiro chama explicar_livre_v2 e
// abre o "De onde vem"). Vigência, situação e motivos não têm documento
// melhor: `sem_documento`.

import {
  formatoInesperado,
  mini,
  numeroOuNulo,
  origemLivre,
  registrarData,
  registrarMoeda,
  registrarNumero,
  registrarTexto,
  semDocumento,
} from './comum.js';

export const nome = 'listar_centros';

function motivoValido(motivo) {
  return (
    motivo &&
    typeof motivo === 'object' &&
    !Array.isArray(motivo) &&
    typeof motivo.codigo === 'string' &&
    typeof motivo.nivel === 'string' &&
    typeof motivo.texto === 'string' &&
    (motivo.grupo_code === undefined || motivo.grupo_code === null || typeof motivo.grupo_code === 'string') &&
    (motivo.valor === undefined || motivo.valor === null || numeroOuNulo(motivo.valor) !== null) &&
    (motivo.tarifa === undefined || motivo.tarifa === null || numeroOuNulo(motivo.tarifa) !== null)
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
    centro.code !== '' &&
    typeof centro.name === 'string' &&
    typeof centro.situacao === 'string' &&
    (centro.erro === undefined || centro.erro === null || typeof centro.erro === 'string') &&
    (centro.livre === undefined || centro.livre === null || numeroOuNulo(centro.livre) !== null) &&
    (centro.end_date === undefined || centro.end_date === null || typeof centro.end_date === 'string') &&
    (centro.data_referencia === undefined ||
      centro.data_referencia === null ||
      typeof centro.data_referencia === 'string') &&
    (centro.pendencias_abertas === undefined ||
      centro.pendencias_abertas === null ||
      numeroOuNulo(centro.pendencias_abertas) !== null) &&
    (centro.motivos === undefined ||
      (Array.isArray(centro.motivos) && centro.motivos.every(motivoValido)))
  );
}

export async function executar(ctx) {
  let dados;
  try {
    dados = await ctx.carregarCentros();
  } catch (erro) {
    return {
      erro: erro && erro.message ? erro.message : 'Não foi possível carregar os centros. (http_4xx)',
    };
  }
  if (!dados || !Array.isArray(dados.centros) || !dados.centros.every(centroValido)) {
    return formatoInesperado('resumo_projetos_v2');
  }

  await ctx.mascara.garantirDicionario();

  const nos = [];
  const centros = [];

  for (const centro of dados.centros) {
    const codigo = centro.code;
    const nomeCentro = ctx.mascara.texto(centro.name);
    const consulta = 'resumo_projetos_v2';
    const origemCadastro = semDocumento('cadastro do projeto', consulta);
    const falhou = centro.erro !== null && centro.erro !== undefined && centro.erro !== '';

    const noCodigo = registrarTexto(ctx, codigo, `Código — ${nomeCentro}`, origemCadastro);
    const noNome = registrarTexto(ctx, nomeCentro, `Nome do centro ${codigo}`, origemCadastro);
    const noSituacao = registrarTexto(
      ctx,
      centro.situacao,
      `Situação — ${codigo}`,
      semDocumento('situação calculada pela RPC a partir do saldo e das pendências', consulta)
    );
    nos.push(noCodigo, noNome, noSituacao);

    const item = {
      codigo: noCodigo.id,
      nome: noNome.id,
      situacao: noSituacao.id,
      falhou,
      falha: null,
      livre: null,
      vigencia: null,
      data_referencia: null,
      pendencias_abertas: null,
      motivos: [],
    };

    if (falhou) {
      const noFalha = registrarTexto(
        ctx,
        'consulta falhou',
        `Falha — ${codigo}`,
        semDocumento('consulta falhou', consulta)
      );
      item.falha = noFalha.id;
      nos.push(noFalha);
    }

    const livre = numeroOuNulo(centro.livre);
    if (!falhou && livre !== null) {
      const noLivre = registrarMoeda(
        ctx,
        livre,
        `Livre — ${nomeCentro} (${codigo})`,
        origemLivre(centro.id)
      );
      if (noLivre) {
        item.livre = noLivre.id;
        nos.push(noLivre);
      }
    }

    if (centro.end_date) {
      const noVigencia = registrarData(
        ctx,
        centro.end_date,
        `Vigência — ${codigo}`,
        semDocumento('vigência do cadastro; o contrato fica em termos_contrato', consulta)
      );
      if (noVigencia) {
        item.vigencia = noVigencia.id;
        nos.push(noVigencia);
      }
    }

    if (centro.data_referencia) {
      const noData = registrarData(
        ctx,
        centro.data_referencia,
        `Balancete até — ${codigo}`,
        semDocumento('data do balancete de referência', consulta)
      );
      if (noData) {
        item.data_referencia = noData.id;
        nos.push(noData);
      }
    }

    const pendencias = numeroOuNulo(centro.pendencias_abertas);
    if (pendencias !== null) {
      const noPendencias = registrarNumero(
        ctx,
        pendencias,
        `Pendências abertas — ${codigo}`,
        semDocumento('contagem de pendências abertas', consulta)
      );
      if (noPendencias) {
        item.pendencias_abertas = noPendencias.id;
        nos.push(noPendencias);
      }
    }

    for (const motivo of centro.motivos ?? []) {
      const noTexto = registrarTexto(
        ctx,
        motivo.texto,
        `Motivo — ${codigo}`,
        semDocumento('motivo literal da RPC', consulta)
      );
      const noNivel = registrarTexto(
        ctx,
        motivo.nivel,
        `Nível do motivo — ${codigo}`,
        semDocumento('nível literal da RPC', consulta)
      );
      nos.push(noTexto, noNivel);
      const saida = {
        texto: noTexto.id,
        nivel: noNivel.id,
        grupo: motivo.grupo_code ?? null,
        valor: null,
        tarifa: null,
      };

      const valor = numeroOuNulo(motivo.valor);
      if (valor !== null) {
        const noValor = registrarMoeda(
          ctx,
          valor,
          `Déficit (magnitude) — ${motivo.codigo}`,
          semDocumento('valor literal da RPC', consulta)
        );
        if (noValor) {
          saida.valor = noValor.id;
          nos.push(noValor);
        }
      }

      const tarifa = numeroOuNulo(motivo.tarifa);
      if (tarifa !== null) {
        const noTarifa = registrarMoeda(
          ctx,
          tarifa,
          `Tarifa bancária — ${motivo.codigo}`,
          semDocumento('tarifa literal da RPC', consulta)
        );
        if (noTarifa) {
          saida.tarifa = noTarifa.id;
          nos.push(noTarifa);
        }
      }

      item.motivos.push(saida);
    }

    centros.push(item);
  }

  const total = registrarNumero(
    ctx,
    centros.length,
    'Centros visíveis',
    semDocumento('contagem da lista', 'resumo_projetos_v2')
  );
  if (total) nos.push(total);

  return { paraModelo: { total: total ? total.id : null, centros, nos: nos.map(mini) } };
}
