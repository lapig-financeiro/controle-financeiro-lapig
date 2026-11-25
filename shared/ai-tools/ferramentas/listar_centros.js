// listar_centros — resumo_projetos_v2 (contrato §4).
//
// Livre de cada centro vem de resumo_projetos_v2, sem árvore no resultado:
// a origem honesta é `livre` (a tela chama explicar_livre_v2 ao clicar).
// Vigência, situação e motivos não têm documento melhor: `sem_documento`.

import {
  formatoInesperado,
  mini,
  origemLivre,
  registrarData,
  registrarMoeda,
  registrarNumero,
  registrarTexto,
  semDocumento,
} from './comum.js';

export const nome = 'listar_centros';

export async function executar(ctx) {
  let dados;
  try {
    dados = await ctx.carregarCentros();
  } catch (erro) {
    return { erro: erro && erro.message ? erro.message : 'Não foi possível carregar os centros.' };
  }
  if (!dados || !Array.isArray(dados.centros)) return formatoInesperado('resumo_projetos_v2');

  await ctx.mascara.garantirDicionario();

  const nos = [];
  const centros = [];

  for (const centro of dados.centros) {
    if (!centro || typeof centro !== 'object') continue;
    const codigo = String(centro.code ?? '');
    const nomeCentro = ctx.mascara.texto(String(centro.name ?? ''));
    const consulta = 'resumo_projetos_v2';
    const origemCadastro = semDocumento('cadastro do projeto', consulta);

    const noCodigo = registrarTexto(ctx, codigo, `Código — ${nomeCentro}`, origemCadastro);
    const noNome = registrarTexto(ctx, nomeCentro, `Nome do centro ${codigo}`, origemCadastro);
    const noSituacao = registrarTexto(
      ctx,
      String(centro.situacao ?? ''),
      `Situação — ${codigo}`,
      semDocumento('situação calculada pela RPC a partir do saldo e das pendências', consulta)
    );
    nos.push(noCodigo, noNome, noSituacao);

    const item = {
      codigo: noCodigo.id,
      nome: noNome.id,
      situacao: noSituacao.id,
      livre: null,
      vigencia: null,
      data_referencia: null,
      pendencias_abertas: null,
      motivos: [],
    };

    if (typeof centro.livre === 'number' && Number.isFinite(centro.livre)) {
      const noLivre = registrarMoeda(
        ctx,
        centro.livre,
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

    if (typeof centro.pendencias_abertas === 'number' && Number.isFinite(centro.pendencias_abertas)) {
      const noPendencias = registrarNumero(
        ctx,
        centro.pendencias_abertas,
        `Pendências abertas — ${codigo}`,
        semDocumento('contagem de pendências abertas', consulta)
      );
      if (noPendencias) {
        item.pendencias_abertas = noPendencias.id;
        nos.push(noPendencias);
      }
    }

    for (const motivo of Array.isArray(centro.motivos) ? centro.motivos : []) {
      if (!motivo || typeof motivo !== 'object') continue;
      const noTexto = registrarTexto(
        ctx,
        String(motivo.texto ?? ''),
        `Motivo — ${codigo}`,
        semDocumento('motivo literal da RPC', consulta)
      );
      const noNivel = registrarTexto(
        ctx,
        String(motivo.nivel ?? ''),
        `Nível do motivo — ${codigo}`,
        semDocumento('nível literal da RPC', consulta)
      );
      nos.push(noTexto, noNivel);
      const saida = { texto: noTexto.id, nivel: noNivel.id, valor: null };
      if (typeof motivo.valor === 'number' && Number.isFinite(motivo.valor)) {
        const noValor = registrarMoeda(
          ctx,
          motivo.valor,
          `Valor do motivo — ${codigo}`,
          semDocumento('valor literal da RPC', consulta)
        );
        if (noValor) {
          saida.valor = noValor.id;
          nos.push(noValor);
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
