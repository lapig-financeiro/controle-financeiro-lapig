/* ============================================================
   projecao.js
   "Até quando as bolsas cadastradas cabem?" — a conta pura que a
   página do projeto usa no cartão "Bolsas por mês", na coluna
   "Cabe até" e no gráfico da aba Dinheiro.

   Dois limites, e vale o que chega primeiro:
   • o orçamento da rubrica de bolsas (previsto − realizado);
   • o dinheiro em conta, que anda mês a mês com a folha do dia 07
     e com os desembolsos do plano.

   Sem DOM, sem rede e sem `new Date()`: as datas são strings
   `AAAA-MM`/`AAAA-MM-DD` e `hoje` vem de fora, para o teste ser
   determinístico. A situação de cada desembolso é a mesma de
   `situacaoDasParcelas` (planejamento-dinheiro.js), cruzada com o
   balancete pela RPC `get_repasses_v2`.
   ============================================================ */

import { situacaoDasParcelas, vencimento } from '../../../frontend/js/planejamento-dinheiro.js';
import { dinheiro } from '../util/formato.js';

const DATA_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/;

const r2 = (valor) => Math.round(Number(valor) * 100) / 100;

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function mesDeData(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.slice(0, 10);
  if (!DATA_RE.test(texto)) return null;
  return texto.slice(0, 7);
}

function mesSeguinte(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const total = ano * 12 + (m - 1) + 1;
  const novoAno = Math.floor(total / 12);
  const novoMes = total - novoAno * 12 + 1;
  return `${novoAno}-${String(novoMes).padStart(2, '0')}`;
}

function mesAnterior(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const total = ano * 12 + (m - 1) - 1;
  const novoAno = Math.floor(total / 12);
  const novoMes = total - novoAno * 12 + 1;
  return `${novoAno}-${String(novoMes).padStart(2, '0')}`;
}

function somarMeses(mes, quantidade) {
  const [ano, m] = mes.split('-').map(Number);
  const total = ano * 12 + (m - 1) + quantidade;
  const novoAno = Math.floor(total / 12);
  const novoMes = total - novoAno * 12 + 1;
  return `${novoAno}-${String(novoMes).padStart(2, '0')}`;
}

/** Resposta de um estado em que não há conta mês a mês para mostrar. */
function respostaSemConta(estado, motivo) {
  return {
    estado,
    motivo,
    meses: [],
    cabe_ate: null,
    ate_o_fim: false,
    limite: null,
    mes_falta: null,
    falta_valor: null,
    depende_de: null,
    sobra_orcamento: null,
    mes_mais_apertado: null,
    taxa_fracao: 0,
    atrasados: [],
    fora: [],
    avisos: [],
  };
}

/**
 * @param {object} a
 * @param {object} a.saldo       saída de get_saldo_livre (`bolsas_ativas`, `rubricas`, caixa…)
 * @param {object} a.repasses    saída de get_repasses_v2 (`parcelas`, `recursos`, `data_balancete`)
 * @param {string} a.hoje        'AAAA-MM-DD'
 * @param {{futuro?:boolean, atrasado?:boolean, rendimento?:boolean}} [a.contar]
 */
export function projetarBolsas({ saldo, repasses, hoje, contar } = {}) {
  const opcoes = {
    futuro: contar?.futuro !== false,
    atrasado: contar?.atrasado === true,
    rendimento: contar?.rendimento === true,
  };

  if (!saldo || typeof saldo !== 'object') {
    return respostaSemConta('dado_incompleto', 'Não foi possível ler o saldo deste centro.');
  }
  if (saldo.has_plano === false) {
    return respostaSemConta('dado_incompleto', 'Este centro não tem plano de trabalho ativo.');
  }
  if (!Array.isArray(saldo.bolsas_ativas)) {
    return respostaSemConta('dado_incompleto', 'O saldo não trouxe as bolsas ativas.');
  }
  if (typeof hoje !== 'string' || !DATA_RE.test(hoje)) {
    return respostaSemConta('dado_incompleto', 'A data de hoje não foi informada para a conta.');
  }
  if (!repasses || typeof repasses !== 'object') {
    return respostaSemConta('dado_incompleto', 'Não foi possível ler os desembolsos do plano.');
  }

  // ---------- Folha ----------
  // Cada bolsa paga valor_mensal por `meses` meses a partir de
  // compromissos_inicio (a janela da 048). Valor ou meses inválidos
  // nunca viram zero: sem eles a conta inteira mentiria.
  const bolsas = [];
  for (const bolsa of saldo.bolsas_ativas) {
    const valorMensal = numero(bolsa?.valor_mensal);
    const meses = numero(bolsa?.meses);
    if (
      valorMensal === null ||
      valorMensal <= 0 ||
      meses === null ||
      !Number.isInteger(meses) ||
      meses < 1
    ) {
      return respostaSemConta(
        'dado_incompleto',
        'Há bolsa ativa sem valor mensal ou sem número de meses; a conta não pode tratar isso como zero.'
      );
    }
    bolsas.push({ valor_mensal: valorMensal, meses });
  }

  if (bolsas.length === 0) {
    return respostaSemConta('sem_bolsas', 'Nenhuma bolsa ativa para pagar na janela do balancete.');
  }

  const inicio = mesDeData(saldo.compromissos_inicio);
  if (!inicio) {
    return respostaSemConta(
      'dado_incompleto',
      'O balancete não diz a partir de quando as bolsas contam; a projeção não pode começar.'
    );
  }

  const avisos = [];

  const somaBolsas = r2(
    bolsas.reduce((soma, bolsa) => soma + bolsa.valor_mensal * bolsa.meses, 0)
  );
  const compromissoBolsas = numero(saldo.compromissos_bolsas);
  if (compromissoBolsas === null) {
    avisos.push('O saldo não trouxe o compromisso de bolsas da janela.');
  } else if (Math.abs(somaBolsas - compromissoBolsas) > 1) {
    avisos.push(
      `A soma das bolsas (${dinheiro(somaBolsas, { centavos: false })}) difere do compromisso da janela (${dinheiro(compromissoBolsas, { centavos: false })}).`
    );
  }

  const ultimoMesBolsa = somarMeses(
    inicio,
    bolsas.reduce((maior, bolsa) => Math.max(maior, bolsa.meses), 0) - 1
  );
  const fimCentro = mesDeData(saldo.end_date);
  if (!fimCentro) {
    avisos.push('O centro não tem vigência cadastrada: a conta vai até a última bolsa.');
  }
  const fim = fimCentro && fimCentro < ultimoMesBolsa ? fimCentro : ultimoMesBolsa;

  if (fim < inicio) {
    return respostaSemConta(
      'sem_bolsas',
      'As bolsas cadastradas começam depois do fim da vigência do centro.'
    );
  }

  const mesesConta = [];
  for (let mes = inicio; mes <= fim; mes = mesSeguinte(mes)) {
    mesesConta.push(mes);
    // Defesa contra um `meses` absurdo vindo do cadastro: a tela não
    // trava e o problema aparece como aviso, não como conta infinita.
    if (mesesConta.length > 600) {
      avisos.push('A janela das bolsas passa de 600 meses; a conta foi cortada.');
      break;
    }
  }

  // Folha de cada mês: cada bolsa continua até o seu `meses`; depois
  // disso deixa de pesar. O mês mais distante define o fim da conta.
  const folhas = mesesConta.map((_, indice) =>
    r2(
      bolsas.reduce(
        (soma, bolsa) => soma + (indice < bolsa.meses ? bolsa.valor_mensal : 0),
        0
      )
    )
  );

  // ---------- Orçamento da rubrica de bolsas ----------
  const rubricas = Array.isArray(saldo.rubricas) ? saldo.rubricas : [];
  const rubricasBolsas = rubricas.filter((rubrica) => rubrica?.compromisso_tipo === 'bolsas');
  if (rubricasBolsas.length === 0) {
    return respostaSemConta(
      'dado_incompleto',
      'O saldo não trouxe a rubrica de bolsas; o orçamento não pode ser lido.'
    );
  }
  let orcamento = r2(
    rubricasBolsas.reduce((soma, rubrica) => soma + (numero(rubrica?.saldo) ?? 0), 0)
  );

  const somaPrevisto = r2(
    rubricas.reduce((soma, rubrica) => soma + (numero(rubrica?.previsto) ?? 0), 0)
  );
  const somaPrevistoTaxa = r2(
    rubricas
      .filter((rubrica) => rubrica?.compromisso_tipo === 'taxa')
      .reduce((soma, rubrica) => soma + (numero(rubrica?.previsto) ?? 0), 0)
  );
  const taxaFracao = somaPrevisto > 0 ? somaPrevistoTaxa / somaPrevisto : 0;

  // ---------- Situação dos desembolsos ----------
  const parcelas = Array.isArray(repasses.parcelas) ? repasses.parcelas : [];
  const recebido = numero(repasses.recursos?.recebido);
  const aReceber = numero(repasses.recursos?.a_receber);
  const recursos =
    recebido !== null && aReceber !== null
      ? { ...repasses.recursos, recebido, a_receber: aReceber }
      : null;

  const calcParcelas = situacaoDasParcelas({
    parcelas,
    recursos,
    dataBalancete:
      typeof repasses.data_balancete === 'string' ? repasses.data_balancete : null,
    hoje,
    totalPlano: numero(repasses.valor_total_plano),
  });

  const brutosPorParcela = new Map(
    parcelas
      .filter((parcela) => parcela && parcela.parcela !== undefined)
      .map((parcela) => [parcela.parcela, parcela])
  );

  const antesPorMes = new Map();
  const depoisPorMes = new Map();
  const atrasados = [];
  const fora = [];

  const guardar = (mapa, mes, desembolso) => {
    if (!mapa.has(mes)) mapa.set(mes, []);
    mapa.get(mes).push(desembolso);
  };

  for (const item of calcParcelas.itens) {
    if (item.situacao === 'recebida') continue;

    if (item.situacao === 'sem_valor') {
      fora.push({ parcela: item.parcela, motivo: 'o plano não diz o valor' });
      continue;
    }
    if (item.situacao === 'sem_data') {
      fora.push({ parcela: item.parcela, motivo: 'sem data prevista no plano' });
      continue;
    }
    if (item.situacao === 'sem_balancete') {
      fora.push({ parcela: item.parcela, motivo: 'o balancete não diz o que entrou' });
      continue;
    }

    const bruto = brutosPorParcela.get(item.parcela) || null;
    const venc = bruto ? vencimento(bruto) : null;
    const mesVenc = mesDeData(venc);
    const faltaParcela = numero(item.falta) ?? numero(item.valor) ?? 0;
    const liquido = r2(faltaParcela * (1 - taxaFracao));

    const ehAtrasado =
      item.situacao === 'atrasada' ||
      item.situacao === 'confirmar' ||
      item.situacao === 'parcial' ||
      item.situacao === 'nota_emitida';

    if (ehAtrasado) {
      // Atrasados sempre aparecem na lista de avisos; só entram na
      // conta se a pessoa pedir, e então no primeiro mês, antes da folha.
      atrasados.push({
        parcela: item.parcela,
        valor: r2(faltaParcela),
        quando: item.quando,
      });
      if (opcoes.atrasado) {
        guardar(antesPorMes, mesesConta[0], { parcela: item.parcela, liquido });
      }
      continue;
    }

    if (item.situacao !== 'futura') continue;

    if (!mesVenc) {
      fora.push({ parcela: item.parcela, motivo: 'sem data prevista no plano' });
      continue;
    }
    if (mesVenc > fim) {
      fora.push({ parcela: item.parcela, motivo: 'chega depois da última bolsa' });
      continue;
    }
    if (!opcoes.futuro) continue;

    let mesEntrada = mesVenc;
    if (mesEntrada < inicio) {
      // Desembolso que vence antes da janela ainda não está no caixa do
      // balancete; entra no primeiro mês, para não sumir da conta.
      mesEntrada = inicio;
      avisos.push(
        `O desembolso ${item.parcela} vence antes do primeiro mês da conta; entrou em ${inicio}.`
      );
    }
    const dia = Number(venc.slice(8, 10));
    const antesDaFolha = dia <= 7;
    guardar(antesDaFolha ? antesPorMes : depoisPorMes, mesEntrada, {
      parcela: item.parcela,
      liquido,
    });
  }

  // ---------- Dinheiro em conta ----------
  const temCaixa =
    saldo.has_balancete !== false && numero(saldo.saldo_disponivel_caixa) !== null;
  const repoeGasto = calcParcelas.sem_valores;
  const usarCaixa = temCaixa && !repoeGasto;

  let saldoConta = null;
  if (usarCaixa) {
    saldoConta = r2(numero(saldo.saldo_disponivel_caixa));
    const rendimento = numero(saldo.rendimento_liquido);
    if (!opcoes.rendimento) {
      // O rendimento já está dentro do saldo: aqui ele só sai ou fica,
      // nunca é somado de novo.
      if (rendimento === null) {
        avisos.push('o balancete não separa o rendimento');
      } else {
        saldoConta = r2(saldoConta - rendimento);
      }
    }
  }

  // ---------- Mês a mês ----------
  const meses = [];
  let mesFalta = null;
  let faltaValor = null;
  let mesOrcamento = null;

  for (let indice = 0; indice < mesesConta.length; indice += 1) {
    const mes = mesesConta[indice];
    const folha = folhas[indice];
    const antes = r2(
      (antesPorMes.get(mes) || []).reduce((soma, d) => soma + d.liquido, 0)
    );
    const depois = r2(
      (depoisPorMes.get(mes) || []).reduce((soma, d) => soma + d.liquido, 0)
    );

    let emContaAposFolha = null;
    let emContaFim = null;
    if (saldoConta !== null) {
      saldoConta = r2(saldoConta + antes);
      if (saldoConta < folha && mesFalta === null) {
        mesFalta = mes;
        faltaValor = r2(folha - saldoConta);
      }
      emContaAposFolha = r2(saldoConta - folha);
      saldoConta = r2(emContaAposFolha + depois);
      emContaFim = saldoConta;
    }

    // Orçamento: o limite é o mês em que o que sobrou do mês anterior
    // não paga mais uma folha. Um resto menor que a folha depois da
    // ÚLTIMA bolsa não é limite: não há outra folha para pagar.
    if (orcamento < folha && mesOrcamento === null) {
      mesOrcamento = mes;
    }
    orcamento = r2(orcamento - folha);

    meses.push({
      mes,
      folha,
      entra_antes: antes,
      entra_depois: depois,
      desembolsos: [
        ...(antesPorMes.get(mes) || []),
        ...(depoisPorMes.get(mes) || []),
      ],
      em_conta_apos_folha: emContaAposFolha,
      em_conta_fim: emContaFim,
      orcamento_resta: orcamento,
    });
  }

  const ultimoMes = mesesConta[mesesConta.length - 1];
  const mesMaisApertado = meses.reduce((apertado, linha) => {
    if (linha.em_conta_apos_folha === null) return apertado;
    if (!apertado || linha.em_conta_apos_folha < apertado.em_conta_apos_folha) return linha;
    return apertado;
  }, null)?.mes ?? null;

  let limite = null;
  if (mesFalta && mesOrcamento) {
    limite = mesFalta <= mesOrcamento ? 'caixa' : 'orcamento';
  } else if (mesFalta) {
    limite = 'caixa';
  } else if (mesOrcamento) {
    limite = 'orcamento';
  }

  const mesLimite =
    limite === 'caixa' ? mesFalta : limite === 'orcamento' ? mesOrcamento : null;
  const cabeAte = mesLimite ? mesAnterior(mesLimite) : ultimoMes;
  const ateOFim = !mesLimite;

  let dependeDe = null;
  if (mesFalta) {
    const indiceFalta = meses.findIndex((linha) => linha.mes === mesFalta);
    const linhaFalta = meses[indiceFalta];
    const depoisDaFolha = depoisPorMes.get(mesFalta) || [];
    const negativoDepois = meses
      .slice(indiceFalta + 1)
      .some(
        (linha) =>
          linha.em_conta_apos_folha !== null && linha.em_conta_apos_folha < 0
      );
    if (
      !negativoDepois &&
      depoisDaFolha.length > 0 &&
      linhaFalta.em_conta_apos_folha !== null
    ) {
      let acumulado = linhaFalta.em_conta_apos_folha;
      for (const desembolso of depoisDaFolha) {
        acumulado = r2(acumulado + desembolso.liquido);
        if (acumulado >= 0) {
          dependeDe = { parcela: desembolso.parcela, mes: mesFalta };
          break;
        }
      }
    }
  }

  let estado = 'ok';
  let motivo = null;
  if (repoeGasto) {
    estado = 'repoe_gasto';
    motivo =
      'O plano não fixa parcelas: o financiador repõe o gasto, então o dinheiro em conta não limita. Vale o orçamento de Bolsas.';
  } else if (!temCaixa) {
    estado = 'sem_balancete';
    motivo = 'Sem balancete: a conta mostra só o orçamento de Bolsas.';
  }

  return {
    estado,
    motivo,
    meses,
    cabe_ate: cabeAte,
    ate_o_fim: ateOFim,
    limite,
    mes_falta: mesFalta,
    falta_valor: faltaValor,
    depende_de: dependeDe,
    sobra_orcamento: r2(orcamento),
    mes_mais_apertado: mesMaisApertado,
    taxa_fracao: taxaFracao,
    atrasados,
    fora,
    avisos,
  };
}
