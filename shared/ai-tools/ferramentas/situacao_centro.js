// situacao_centro — situacao_centro_v2 (contrato §4).
//
// A 069 devolve a magnitude do déficit em `valor` e, quando há tarifa
// bancária, o montante em `tarifa`. Os dois campos são preservados e ficam
// separados do saldo assinado do grupo. O saldo é ligado à árvore pelo
// `grupo_code` (nunca por igualdade de valor) e ganha origem `no`; déficit e
// tarifa ficam `sem_documento` com o motivo literal.
//
// `situacao: 'sem dado'` com motivo `falha` é falha explícita, não sucesso.

import {
  chamarRpc,
  formatoInesperado,
  mini,
  numeroOuNulo,
  origemNo,
  registrarMoeda,
  registrarTexto,
  semDocumento,
} from './comum.js';

export const nome = 'situacao_centro';

function procurarNo(no, predicado) {
  if (!no || typeof no !== 'object') return null;
  if (predicado(no)) return no;
  const partes = Array.isArray(no.partes) ? no.partes : [];
  for (const parte of partes) {
    const achado = procurarNo(parte, predicado);
    if (achado) return achado;
  }
  return null;
}

function motivoValido(motivo) {
  return (
    motivo &&
    typeof motivo === 'object' &&
    !Array.isArray(motivo) &&
    typeof motivo.codigo === 'string' &&
    motivo.codigo.trim() !== '' &&
    typeof motivo.nivel === 'string' &&
    typeof motivo.texto === 'string' &&
    (motivo.grupo_code === undefined || motivo.grupo_code === null || typeof motivo.grupo_code === 'string') &&
    (motivo.valor === undefined || motivo.valor === null || numeroOuNulo(motivo.valor) !== null) &&
    (motivo.tarifa === undefined || motivo.tarifa === null || numeroOuNulo(motivo.tarifa) !== null)
  );
}

function arvoreValida(no, profundidade = 0) {
  if (profundidade > 64 || !no || typeof no !== 'object' || Array.isArray(no)) return false;
  if (typeof no.rotulo !== 'string') return false;
  if (!['calculo', 'documento', 'legado', 'digitado'].includes(no.tipo)) return false;
  if (!Array.isArray(no.partes)) return false;
  return no.partes.every((parte) => arvoreValida(parte, profundidade + 1));
}

function normalizarConta(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function ehLinhaTarifa(no) {
  if (!no || !no.ref || no.ref.alvo_tabela !== 'balancete_lancamentos') return false;
  if (no.ref.campo !== 'saldo_atual') return false;
  const rotulo = normalizarConta(no.rotulo);
  return (
    rotulo.includes('7.1.3.05.01.00054') ||
    rotulo.includes('SERVICOS BANCARIOS') ||
    rotulo.includes('TARIFA BANCARIA')
  );
}

function tarifaDaArvore(grupo, valor) {
  if (!grupo || !Array.isArray(grupo.partes)) return null;
  const encontrados = [];
  const visitar = (no) => {
    if (!no || typeof no !== 'object') return;
    const valorNo = numeroOuNulo(no.valor);
    if (ehLinhaTarifa(no) && valorNo !== null && Math.abs(valorNo - valor) <= 0.005) {
      encontrados.push(no);
    }
    for (const parte of Array.isArray(no.partes) ? no.partes : []) visitar(parte);
  };
  visitar(grupo);
  return encontrados.length === 1 ? encontrados[0] : null;
}

export async function executar(ctx, args) {
  const resolvido = await ctx.resolverCentro(args && args.project_id);
  if (resolvido.erro) return resolvido;
  const centro = resolvido.centro;

  const resposta = await chamarRpc(ctx, 'situacao_centro_v2', { p_project_id: centro.id });
  if (resposta.erro) return { erro: resposta.erro };
  const dados = resposta.dados;
  if (
    !dados ||
    typeof dados !== 'object' ||
    Array.isArray(dados) ||
    typeof dados.situacao !== 'string' ||
    !Array.isArray(dados.motivos) ||
    !dados.motivos.every(motivoValido)
  ) {
    return formatoInesperado('situacao_centro_v2');
  }

  if (dados.situacao === 'sem dado' || dados.motivos.some((motivo) => motivo.codigo === 'falha')) {
    return { erro: 'Não foi possível carregar a situação do centro. (formato)' };
  }

  await ctx.mascara.garantirDicionario();

  let arvore = null;
  let arvoreIndisponivel = false;
  try {
    arvore = await ctx.obterArvore(centro.id);
  } catch {
    arvoreIndisponivel = true;
  }
  if (arvore && !arvoreValida(arvore)) {
    return formatoInesperado('explicar_livre_v2');
  }

  const nos = [];
  const situacao = registrarTexto(
    ctx,
    dados.situacao,
    `Situação — ${centro.code ?? centro.id}`,
    semDocumento('situação calculada pela RPC', 'situacao_centro_v2')
  );
  nos.push(situacao);

  const motivos = [];
  for (const motivo of dados.motivos) {
    const codigo = motivo.codigo.trim();
    const textoLimpo = ctx.mascara.texto(motivo.texto);
    const origemLiteral = semDocumento(
      textoLimpo || 'motivo literal da RPC',
      'situacao_centro_v2'
    );

    const noTexto = registrarTexto(ctx, textoLimpo, `Motivo — ${codigo}`, origemLiteral);
    const noNivel = registrarTexto(
      ctx,
      motivo.nivel,
      `Nível do motivo — ${codigo}`,
      semDocumento('nível literal da RPC', 'situacao_centro_v2')
    );
    nos.push(noTexto, noNivel);

    const saida = { texto: noTexto.id, nivel: noNivel.id, valor: null, saldo: null, tarifa: null };

    const valor = numeroOuNulo(motivo.valor);
    if (valor !== null) {
      const noValor = registrarMoeda(
        ctx,
        valor,
        `Déficit (magnitude) — ${codigo}`,
        origemLiteral
      );
      if (noValor) {
        saida.valor = noValor.id;
        nos.push(noValor);
      }
    }

    const grupo =
      motivo.grupo_code && arvore
        ? procurarNo(
            arvore,
            (no) => no.tipo === 'calculo' && no.chave === `grupo:${motivo.grupo_code}`
          )
        : null;

    const tarifa = numeroOuNulo(motivo.tarifa);
    if (tarifa !== null) {
      const linhaTarifa = grupo ? tarifaDaArvore(grupo, tarifa) : null;
      if (linhaTarifa) {
        const noTarifa = ctx.registro.registrar({
          valor: numeroOuNulo(linhaTarifa.valor),
          unidade: 'moeda',
          rotulo: `Tarifa bancária — ${codigo}`,
          origem: origemNo(linhaTarifa),
        });
        saida.tarifa = noTarifa.id;
        nos.push(noTarifa);
      } else {
        const noTarifa = registrarMoeda(
          ctx,
          tarifa,
          `Tarifa bancária — ${codigo}`,
          origemLiteral
        );
        if (noTarifa) {
          saida.tarifa = noTarifa.id;
          nos.push(noTarifa);
        }
      }
    }

    if (grupo) {
      const valorGrupo = numeroOuNulo(grupo.valor);
      if (valorGrupo !== null) {
        const noSaldo = ctx.registro.registrar({
          valor: valorGrupo,
          unidade: 'moeda',
          rotulo: `Saldo do grupo — ${ctx.mascara.texto(String(grupo.rotulo ?? motivo.grupo_code))}`,
          origem: origemNo(grupo),
        });
        saida.saldo = noSaldo.id;
        nos.push(noSaldo);
      }
    }

    motivos.push(saida);
  }

  return {
    paraModelo: {
      situacao: situacao.id,
      motivos,
      arvore_indisponivel: arvoreIndisponivel,
      nos: nos.map(mini),
    },
  };
}
