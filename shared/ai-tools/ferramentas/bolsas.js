// bolsas — get_pedido_bolsas_v2 (contrato §4).
//
// Nome de pessoa é campo fechado: vira ⟦Pn⟧ e nunca entra no paraModelo.
// CPF e e-mail não são lidos, mesmo que a RPC passe a devolvê-los. A origem é
// sem_documento ("bolsa digitada, ainda sem documento") até a F3.

import {
  chamarRpc,
  formatoInesperado,
  mini,
  registrarData,
  registrarMoeda,
  registrarNumero,
  registrarTexto,
  semDocumento,
} from './comum.js';

export const nome = 'bolsas';

export async function executar(ctx, args) {
  let centro = null;
  if (args && args.project_id !== undefined && args.project_id !== null && args.project_id !== '') {
    const resolvido = await ctx.resolverCentro(args.project_id);
    if (resolvido.erro) return resolvido;
    centro = resolvido.centro;
  }

  const resposta = await chamarRpc(ctx, 'get_pedido_bolsas_v2');
  if (resposta.erro) return { erro: resposta.erro };
  const dados = resposta.dados;
  if (!dados || typeof dados !== 'object' || !Array.isArray(dados.bolsistas)) {
    return formatoInesperado('get_pedido_bolsas_v2');
  }

  ctx.mascara.carregarNomes(dados.bolsistas);
  ctx.mascara.marcarDicionarioCarregado();

  const consulta = 'get_pedido_bolsas_v2';
  const origemBolsa = semDocumento('bolsa digitada, ainda sem documento', consulta);
  const nos = [];
  const bolsistas = [];

  for (const bolsista of dados.bolsistas) {
    if (!bolsista || typeof bolsista !== 'object') continue;
    const todas = Array.isArray(bolsista.bolsas) ? bolsista.bolsas : [];
    const bolsas = centro ? todas.filter((bolsa) => bolsa && bolsa.project_id === centro.id) : todas;
    if (centro && bolsas.length === 0) continue;

    const nomeMascarado = ctx.mascara.nome(bolsista.nome);
    if (!nomeMascarado) continue;
    const noNome = registrarTexto(ctx, nomeMascarado, 'Bolsista (mascarado)', origemBolsa);
    nos.push(noNome);

    const saida = { nome: noNome.id, valor_vigente: null, equipe: null, bolsas: [] };

    const noValorVigente = registrarMoeda(
      ctx,
      bolsista.valor_vigente,
      centro ? 'Valor vigente total (todos os centros)' : 'Valor vigente',
      origemBolsa
    );
    if (noValorVigente) {
      saida.valor_vigente = noValorVigente.id;
      nos.push(noValorVigente);
    }

    if (typeof bolsista.equipe === 'string' && bolsista.equipe) {
      const noEquipe = registrarTexto(ctx, bolsista.equipe, 'Equipe', origemBolsa);
      saida.equipe = noEquipe.id;
      nos.push(noEquipe);
    }

    for (const bolsa of bolsas) {
      if (!bolsa || typeof bolsa !== 'object') continue;
      const item = {
        centro: null,
        valor: null,
        inicio: null,
        fim: null,
        status: null,
        vigente_hoje: null,
      };

      if (bolsa.code) {
        const no = registrarTexto(ctx, bolsa.code, 'Centro da bolsa', origemBolsa);
        item.centro = no.id;
        nos.push(no);
      }
      if (typeof bolsa.valor === 'number' && Number.isFinite(bolsa.valor)) {
        const no = registrarMoeda(ctx, bolsa.valor, 'Valor mensal da bolsa', origemBolsa);
        item.valor = no.id;
        nos.push(no);
      }
      if (bolsa.inicio) {
        const no = registrarData(ctx, bolsa.inicio, 'Início da bolsa', origemBolsa);
        if (no) {
          item.inicio = no.id;
          nos.push(no);
        }
      }
      if (bolsa.fim) {
        const no = registrarData(ctx, bolsa.fim, 'Fim da bolsa', origemBolsa);
        if (no) {
          item.fim = no.id;
          nos.push(no);
        }
      }
      if (bolsa.status) {
        const no = registrarTexto(ctx, bolsa.status, 'Situação da bolsa', origemBolsa);
        item.status = no.id;
        nos.push(no);
      }
      if (typeof bolsa.vigente_hoje === 'boolean') {
        const no = registrarTexto(
          ctx,
          bolsa.vigente_hoje ? 'sim' : 'não',
          'Vigente hoje',
          origemBolsa
        );
        item.vigente_hoje = no.id;
        nos.push(no);
      }

      saida.bolsas.push(item);
    }

    bolsistas.push(saida);
  }

  const caixas = [];
  if (!centro && Array.isArray(dados.caixas)) {
    for (const caixa of dados.caixas) {
      if (!caixa || typeof caixa !== 'object') continue;
      const item = { nome: null, meses: null, pessoas: null, total_mensal: null, total_periodo: null };
      const origemCaixa = semDocumento('caixa do pedido de bolsas', consulta);

      if (typeof caixa.nome === 'string') {
        const no = registrarTexto(ctx, caixa.nome, 'Nome da caixa', origemCaixa);
        item.nome = no.id;
        nos.push(no);
      }
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
      caixas.push(item);
    }
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
