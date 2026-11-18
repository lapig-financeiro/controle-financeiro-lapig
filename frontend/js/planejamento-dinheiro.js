/* ============================================================
   planejamento-dinheiro.js
   "Quanto dinheiro cada centro tem para as bolsas, e a partir de quando."
   Pedido do Victor em 18/11/2026: enxergar o dinheiro disponível e até
   quando ele pode ser usado, com os desembolsos e auditável.

   Duas leituras do mesmo centro, e vale a menor:
   • pelo plano: o livre do saldo_livre (só Pessoal, ou todas as rubricas
     — usar outra rubrica exige remanejamento);
   • pelo dinheiro: o caixa do último balancete, sem o rendimento (a FUNAPE
     aplica o que entra; o rendimento não é do plano), menos as bolsas já
     cadastradas até o fim do centro (e, no modo "só Pessoal", menos o que o
     plano ainda reserva para as outras rubricas), mais as parcelas do
     cronograma de desembolso que ainda vão entrar, cada uma no seu mês.

   Situação de cada parcela: as parcelas do plano são somadas em ordem e
   comparadas com o que o balancete diz que entrou desde o início
   (conta 2.1.3.01, lida por balancete-parser.js em `recursos`).

   O resultado vira fontes "fixo" com data de início (uma por parcela) que
   o PlanejamentoMotor consome sem mudança nenhuma. Funções puras: sem DOM
   e sem rede. ES module e window.PlanejamentoDinheiro.
   ============================================================ */

const r2 = x => Number(Number(x).toFixed(2));
const mesDe = d => (d ? String(d).slice(0, 7) : null);
// Data só de mês ("Novembro/2026", gravada como dia 1º com o texto em data_texto) vence no fim do mês.
function vencimento(p) {
  if (!p.data_prevista) return null;
  if (!p.data_texto) return p.data_prevista;
  const [y, m] = p.data_prevista.split('-').map(Number);
  return `${p.data_prevista.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
function mesSeguinte(m) {
  let y = Number(m.slice(0, 4)), mm = Number(m.slice(5, 7)) + 1;
  if (mm === 13) { y += 1; mm = 1; }
  return `${y}-${String(mm).padStart(2, '0')}`;
}

export const SITUACOES = {
  recebida:      { rotulo: 'recebida', conta: false },
  parcial:       { rotulo: 'entrou em parte', conta: true },
  nota_emitida:  { rotulo: 'nota emitida, não paga', conta: true },
  atrasada:      { rotulo: 'atrasada: perguntar', conta: true },
  confirmar:     { rotulo: 'venceu depois do último balancete', conta: true },
  futura:        { rotulo: 'futura', conta: true },
  sem_data:      { rotulo: 'sem data (por entrega)', conta: true },
  sem_valor:     { rotulo: 'sem valor no plano', conta: false },
  sem_balancete: { rotulo: 'sem balancete para conferir', conta: true },
};

/**
 * Situação de cada parcela do cronograma, cruzando com o balancete.
 * @param {object} a
 * @param {Array} a.parcelas  plano_desembolsos: { parcela, data_prevista, data_texto, valor, valor_texto }
 * @param {object|null} a.recursos  balancete.raw_extraction.data.recursos ({ recebido, a_receber, ... })
 * @param {string|null} a.dataBalancete  'AAAA-MM-DD'
 * @param {string} a.hoje  'AAAA-MM-DD'
 * @param {number|null} a.totalPlano  para o plano sem valores por parcela (GMH)
 */
export function situacaoDasParcelas({ parcelas, recursos, dataBalancete, hoje, totalPlano = null }) {
  const ps = [...(parcelas || [])].sort((x, y) => x.parcela - y.parcela);
  const R = recursos ? Number(recursos.recebido || 0) : null;
  const A = recursos ? Number(recursos.a_receber || 0) : 0;
  const tol = 1;
  let acum = 0;
  const itens = ps.map(p => {
    const valor = p.valor == null ? null : Number(p.valor);
    const quando = p.data_texto || (p.data_prevista ? p.data_prevista.split('-').reverse().join('/') : '');
    const base = { parcela: p.parcela, quando, mes: mesDe(p.data_prevista), valor, valor_texto: p.valor_texto || null,
      falta: valor, recebido: 0 };
    if (valor == null) return { ...base, situacao: 'sem_valor', falta: null };
    const ini = acum;
    acum += valor;
    const vence = vencimento(p);
    if (R === null) return { ...base, situacao: vence && vence > hoje ? 'futura' : 'sem_balancete' };
    if (acum <= R + tol) return { ...base, situacao: 'recebida', falta: 0, recebido: valor };
    if (ini + tol < R) return { ...base, situacao: 'parcial', falta: r2(acum - R), recebido: r2(R - ini) };
    // nota fiscal emitida e não paga cobrindo a parcela inteira ou parte dela
    if (ini + tol < R + A) return { ...base, situacao: 'nota_emitida' };
    if (!vence) return { ...base, situacao: 'sem_data' };
    if (dataBalancete && vence <= dataBalancete) return { ...base, situacao: 'atrasada' };
    if (vence <= hoje) return { ...base, situacao: 'confirmar' };
    return { ...base, situacao: 'futura' };
  });
  const comValor = itens.filter(i => i.valor != null);
  const somaPlano = r2(comValor.reduce((s, i) => s + i.valor, 0));
  const semValores = itens.length > 0 && comValor.length === 0;
  // Plano sem valor por parcela (GMH: "mediante cálculo de gastos"): só dá para dizer quanto falta no total.
  const faltaSemCronograma = semValores && R !== null && totalPlano != null ? r2(Math.max(0, totalPlano - R)) : null;
  return {
    itens,
    recebido: R,
    a_receber: recursos ? A : null,
    soma_plano: somaPlano,
    sem_valores: semValores,
    falta_sem_cronograma: faltaSemCronograma,
    recebido_alem_do_plano: R !== null && comValor.length && R > somaPlano + tol ? r2(R - somaPlano) : 0,
  };
}

/**
 * O dinheiro de um centro para as bolsas: o que dá para usar hoje e o que chega com cada parcela.
 * @param {object} a
 * @param {'pessoal'|'total'} a.modo
 * @param {object} a.centro  dados.centros[cc] do planejamento (grupos, caixa, compromissos_bolsas, fim, balancete)
 * @param {number} a.devolver  bolsas pausadas que o banco desconta e a conta devolve (motor.devolverExcluidas)
 * @param {number|null} a.rendimento  rendimento líquido do balancete
 * @param {object} a.parcelas  saída de situacaoDasParcelas
 * @param {object} a.opcoes  { contarRendimento, contarAtrasadas, contarSemData }
 * @param {string} a.ref  'AAAA-MM'
 * @param {string} a.horizonte  'AAAA-MM'
 */
export function dinheiroDoCentro({ modo, centro, devolver = 0, rendimento = null, parcelas, opcoes = {}, ref, horizonte }) {
  const grupos = centro.grupos || {};
  const pos = v => Math.max(Number(v || 0), 0);
  const livrePessoal = pos(Number((grupos.a || {}).livre || 0) + devolver);
  const livreOutras = Object.entries(grupos).filter(([g]) => g !== 'a').reduce((s, [, g]) => s + pos(g.livre), 0);
  const teto = r2(modo === 'total' ? livrePessoal + livreOutras : livrePessoal);
  const fimCentro = mesDe(centro.fim);
  const ate = fimCentro && fimCentro < horizonte ? fimCentro : horizonte;
  const acabou = ate < ref;

  const passos = [];
  passos.push({ chave: 'teto', rotulo: modo === 'total' ? 'Livre no plano, todas as rubricas' : 'Livre no plano, rubrica Pessoal', valor: teto });

  // Plano sem valor por parcela (GMH: "mediante cálculo de gastos p/ trimestre subsequente"): o financiador
  // repõe o que se gasta, então o caixa de hoje não limita. Vale o livre do plano, com o aviso.
  const repoeOGasto = !!(parcelas && parcelas.sem_valores);
  const temCaixa = centro.caixa !== null && centro.caixa !== undefined && !repoeOGasto;
  let hoje, caixaLivre = null;
  if (acabou) {
    hoje = 0;
    passos.push({ chave: 'acabou', rotulo: `O centro acabou em ${ate.slice(5, 7)}/${ate.slice(0, 4)}: não paga mais bolsa`, valor: null });
  } else if (repoeOGasto) {
    hoje = teto;
    passos.push({ chave: 'repoe', rotulo: 'O plano não fixa parcelas: o financiador repõe o que se gasta a cada trimestre. Vale o livre do plano.', valor: null });
  } else if (!temCaixa) {
    hoje = teto;
    passos.push({ chave: 'sem_caixa', rotulo: 'Sem balancete: vale o livre do plano, sem conferir o caixa', valor: null });
  } else {
    const caixa = Number(centro.caixa);
    const rend = opcoes.contarRendimento || rendimento == null ? 0 : Number(rendimento);
    const compromissos = Number(centro.compromissos_bolsas || 0) - devolver;
    const reserva = modo === 'total' ? 0 : livreOutras;
    caixaLivre = r2(caixa - rend - compromissos - reserva);
    passos.push({ chave: 'caixa', rotulo: `Caixa no balancete de ${String(centro.balancete || '').split('-').reverse().join('/')}`, valor: r2(caixa) });
    if (rend) passos.push({ chave: 'rendimento', rotulo: 'menos o rendimento da aplicação (não é do plano)', valor: -r2(rend) });
    else if (rendimento != null) passos.push({ chave: 'rendimento', rotulo: 'rendimento da aplicação: contado', valor: 0 });
    passos.push({ chave: 'compromissos', rotulo: 'menos as bolsas já cadastradas no centro até o fim', valor: -r2(compromissos) });
    if (reserva) passos.push({ chave: 'reserva', rotulo: 'menos o que o plano ainda reserva para as outras rubricas', valor: -r2(reserva) });
    hoje = r2(Math.min(teto, Math.max(caixaLivre, 0)));
  }
  passos.push({ chave: 'hoje', rotulo: 'Dá para usar a partir de agora', valor: hoje });

  // Parcelas que ainda vão entrar: cada uma libera mais dinheiro no seu mês, até o livre do plano.
  // Se o caixa de hoje já não cobre as bolsas cadastradas, as primeiras parcelas tapam esse buraco.
  const tranches = [];
  if (hoje > 0) tranches.push({ chave: 'hoje', rotulo: 'em caixa', de: ref, ate, valor: hoje, situacao: 'em_caixa' });
  let restante = r2(teto - hoje);
  let buraco = temCaixa ? Math.max(0, -caixaLivre) : 0;
  const fora = [];
  const conta = i => {
    if (!SITUACOES[i.situacao].conta) return false;
    if ((i.situacao === 'atrasada' || i.situacao === 'confirmar' || i.situacao === 'parcial') && opcoes.contarAtrasadas === false) return false;
    if (i.situacao === 'sem_data' && !opcoes.contarSemData) return false;
    return true;
  };
  for (const i of parcelas ? parcelas.itens : []) {
    if (i.situacao === 'recebida') continue;
    if (acabou) { fora.push({ ...i, motivo: 'o centro já acabou' }); continue; }
    if (repoeOGasto) { fora.push({ ...i, motivo: 'o financiador repõe o gasto: o livre do plano já conta com ela' }); continue; }
    if (!temCaixa) { fora.push({ ...i, motivo: 'sem balancete: o livre do plano já conta com ela' }); continue; }
    if (i.situacao === 'sem_balancete') { fora.push({ ...i, motivo: 'o balancete não diz o que entrou: pode já estar no caixa' }); continue; }
    if (!conta(i)) { fora.push({ ...i, motivo: i.situacao === 'sem_valor' ? 'o plano não diz o valor' : 'desligada nas opções' }); continue; }
    // Futura conta no seu mês (no mês de hoje, só a partir do seguinte); atrasada, nota emitida e sem data, do mês que vem.
    const de = i.situacao === 'futura' && i.mes && i.mes > ref ? i.mes : mesSeguinte(ref);
    if (de > ate) { fora.push({ ...i, motivo: ate < (fimCentro || ate) ? 'chega depois do fim da conta' : 'chega depois do fim do centro' }); continue; }
    const falta = Number(i.falta || 0);
    const tapa = Math.min(buraco, falta);
    buraco -= tapa;
    const v = r2(Math.min(restante, falta - tapa));
    if (v <= 0) { fora.push({ ...i, motivo: tapa > 0 ? 'vai para o que o centro já tem de pagar' : 'o livre do plano já foi todo contado' }); continue; }
    restante = r2(restante - v);
    tranches.push({ chave: `p${i.parcela}`, rotulo: `parcela ${i.parcela} (${SITUACOES[i.situacao].rotulo})`, de, ate, valor: v,
      situacao: i.situacao, parcela: i.parcela, tapa: r2(tapa) });
  }
  const total = r2(tranches.reduce((s, t) => s + t.valor, 0));
  return { modo, teto, caixa_livre: caixaLivre, hoje, tranches, fora, total, ate, passos, nao_chega: r2(Math.max(0, restante)) };
}

/**
 * Premissas para o motor: cada fonte de centro vira uma fonte fixa por pedaço (em caixa + uma por parcela),
 * no lugar dela e na mesma ordem; os cenários passam a citar os pedaços.
 * @param {object} premissas
 * @param {Object<string, object>} porFonte  código da fonte → saída de dinheiroDoCentro
 */
export function premissasPeloDinheiro(premissas, porFonte) {
  const itens = [];
  const filhos = {};
  for (const f of premissas.fontes.itens) {
    const d = porFonte[f.codigo];
    if (!d) { itens.push(f); filhos[f.codigo] = [f.codigo]; continue; }
    filhos[f.codigo] = [];
    for (const t of d.tranches) {
      const codigo = t.chave === 'hoje' ? f.codigo : `${f.codigo}·${t.chave}`;
      filhos[f.codigo].push(codigo);
      itens.push({ ...f, codigo, base: 'fixo', valor: t.valor, de: t.de, ate: t.ate, teto_mes: null,
        situacao: t.situacao === 'em_caixa' ? 'em_caixa' : 'a_entrar', _pai: f.codigo, _pedaco: t });
    }
  }
  const expandir = lista => (lista || []).flatMap(k => filhos[k] || [k]);
  const cenarios = premissas.cenarios.map(c => ({
    ...c,
    fontes: expandir(c.fontes),
    ...(c.sobras_para_gc ? { sobras_para_gc: expandir(c.sobras_para_gc) } : {}),
  }));
  return { ...premissas, fontes: { ...premissas.fontes, itens }, cenarios, _filhos: filhos };
}

if (typeof window !== 'undefined') {
  window.PlanejamentoDinheiro = { SITUACOES, situacaoDasParcelas, dinheiroDoCentro, premissasPeloDinheiro };
}
