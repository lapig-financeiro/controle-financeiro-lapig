import { describe, it, expect } from 'vitest';
import { situacaoDasParcelas, dinheiroDoCentro, premissasPeloDinheiro } from '../frontend/js/planejamento-dinheiro.js';

// Cronogramas no formato dos planos conferidos em 18/11/2026 (valores dos documentos, sem dado pessoal).
const P = (parcela, data_prevista, valor, data_texto = null) => ({ parcela, data_prevista, data_texto, valor, valor_texto: valor == null ? '210.00,00' : null });
const HOJE = '2026-11-18';

describe('situação das parcelas, cruzando com o balancete', () => {
  it('WRI: recebida, nota emitida e não paga, atrasada e futuras', () => {
    const s = situacaoDasParcelas({
      parcelas: [P(1, '2026-07-01', 80000), P(2, '2026-08-01', 350000), P(3, '2026-11-01', 300000),
        P(4, '2026-12-01', 60000), P(5, '2026-12-01', 30000), P(6, '2027-01-01', 30000)],
      recursos: { recebido: 80000, a_receber: 350000 }, dataBalancete: '2026-11-03', hoje: HOJE,
    });
    expect(s.itens.map(i => i.situacao)).toEqual(['recebida', 'nota_emitida', 'atrasada', 'futura', 'futura', 'futura']);
    expect(s.recebido).toBe(80000);
  });

  it('Acelen: a soma decide, não a data escrita (a 3ª está como nov/26, mas já entrou)', () => {
    const s = situacaoDasParcelas({
      parcelas: [P(1, '2025-07-01', 138600), P(2, '2025-10-01', 34650), P(3, '2026-11-01', 138600),
        P(4, '2026-02-01', 207900), P(5, '2026-07-01', 69300), P(6, '2026-09-01', 103950)],
      recursos: { recebido: 589050, a_receber: 103950 }, dataBalancete: '2026-11-03', hoje: HOJE,
    });
    expect(s.itens.map(i => i.situacao)).toEqual(['recebida', 'recebida', 'recebida', 'recebida', 'recebida', 'nota_emitida']);
  });

  it('MapBiomas: parcela sem valor fica de fora; a que venceu depois do balancete pede confirmação', () => {
    const s = situacaoDasParcelas({
      parcelas: [P(1, null, 290000, 'Assinatura do contrato'), P(2, '2026-03-02', 470000), P(3, '2026-07-06', 470000),
        P(4, '2026-09-01', null), P(5, '2026-11-16', 40000)],
      recursos: { recebido: 1230000, a_receber: 0 }, dataBalancete: '2026-10-05', hoje: HOJE,
    });
    expect(s.itens.map(i => i.situacao)).toEqual(['recebida', 'recebida', 'recebida', 'sem_valor', 'confirmar']);
  });

  it('entrada que cobre só parte de uma parcela', () => {
    const s = situacaoDasParcelas({ parcelas: [P(1, '2026-01-01', 100), P(2, '2026-03-01', 100)],
      recursos: { recebido: 150, a_receber: 0 }, dataBalancete: '2026-10-01', hoje: HOJE });
    expect(s.itens[1]).toMatchObject({ situacao: 'parcial', recebido: 50, falta: 50 });
  });

  it('GMH: plano sem valor por parcela, só o total que falta receber', () => {
    const s = situacaoDasParcelas({ parcelas: [P(1, '2026-01-01', null), P(2, '2026-04-01', null)],
      recursos: { recebido: 1524745.95, a_receber: 0 }, dataBalancete: '2026-10-01', hoje: HOJE, totalPlano: 2033719.16 });
    expect(s.sem_valores).toBe(true);
    expect(s.falta_sem_cronograma).toBe(508973.21);
  });

  it('sem balancete com recursos: não inventa situação', () => {
    const s = situacaoDasParcelas({ parcelas: [P(1, '2026-01-01', 100), P(2, '2027-01-01', 100)], recursos: null, dataBalancete: null, hoje: HOJE });
    expect(s.itens.map(i => i.situacao)).toEqual(['sem_balancete', 'futura']);
  });
});

const centro = (over = {}) => ({
  fim: '2027-01-30', balancete: '2026-11-03', caixa: 146093.26, compromissos_bolsas: 20000,
  grupos: { a: { livre: 164000 }, b: { livre: 10000 }, e: { livre: -5 } }, ...over,
});

describe('dinheiro de um centro', () => {
  const parcelas = situacaoDasParcelas({
    parcelas: [P(1, '2026-07-01', 80000), P(2, '2026-08-01', 350000), P(3, '2027-03-01', 300000)],
    recursos: { recebido: 80000, a_receber: 350000 }, dataBalancete: '2026-11-03', hoje: HOJE,
  });

  it('caixa sem rendimento, menos bolsas cadastradas e reserva das outras rubricas; parcela atrasada no mês seguinte', () => {
    const d = dinheiroDoCentro({ modo: 'pessoal', centro: centro(), rendimento: 1502.38, parcelas, opcoes: {}, ref: '2026-11', horizonte: '2027-12' });
    // 146.093,26 − 1.502,38 − 20.000 − 10.000 = 114.590,88
    expect(d.caixa_livre).toBe(114590.88);
    expect(d.hoje).toBe(114590.88);
    expect(d.tranches.map(t => [t.chave, t.de, t.valor])).toEqual([
      ['hoje', '2026-11', 114590.88],
      ['p2', '2026-12', 49409.12], // até o livre de Pessoal (164.000)
    ]);
    // a 3ª parcela chega depois do fim do centro
    expect(d.fora.map(f => [f.parcela, f.motivo])).toEqual([[3, 'chega depois do fim do centro']]);
    expect(d.total).toBe(164000);
  });

  it('todas as rubricas: sem reserva, teto maior; rendimento contado quando pedido', () => {
    const d = dinheiroDoCentro({ modo: 'total', centro: centro(), rendimento: 1502.38, parcelas,
      opcoes: { contarRendimento: true }, ref: '2026-11', horizonte: '2027-12' });
    expect(d.teto).toBe(174000);
    expect(d.hoje).toBe(126093.26);
  });

  it('parcelas atrasadas desligadas: ficam de fora e o total cai', () => {
    const d = dinheiroDoCentro({ modo: 'pessoal', centro: centro(), rendimento: 1502.38, parcelas,
      opcoes: { contarAtrasadas: false }, ref: '2026-11', horizonte: '2027-12' });
    // nota emitida continua contando (a cobrança já foi feita); só a "atrasada: perguntar" sai
    expect(d.tranches.map(t => t.chave)).toEqual(['hoje', 'p2']);
  });

  it('caixa que não cobre as bolsas cadastradas: a parcela tapa o buraco antes de virar fonte', () => {
    const d = dinheiroDoCentro({ modo: 'pessoal', centro: centro({ caixa: 10000 }), rendimento: 0,
      parcelas, opcoes: {}, ref: '2026-11', horizonte: '2027-12' });
    // 10.000 − 20.000 − 10.000 = −20.000: a parcela 2 (350.000) paga isso primeiro
    expect(d.hoje).toBe(0);
    expect(d.tranches).toEqual([expect.objectContaining({ chave: 'p2', valor: 164000, tapa: 20000 })]);
  });

  it('plano que repõe o gasto (sem valor por parcela): vale o livre do plano, o caixa não limita', () => {
    const gmh = situacaoDasParcelas({ parcelas: [P(1, '2026-01-01', null), P(2, '2027-01-01', null)],
      recursos: { recebido: 1000, a_receber: 0 }, dataBalancete: '2026-10-01', hoje: HOJE, totalPlano: 5000 });
    const d = dinheiroDoCentro({ modo: 'pessoal', centro: centro({ caixa: 1 }), rendimento: 0, parcelas: gmh, opcoes: {}, ref: '2026-11', horizonte: '2027-12' });
    expect(d.total).toBe(164000);
    expect(d.caixa_livre).toBeNull();
    expect(d.fora).toHaveLength(2);
  });

  it('sem balancete: vale o livre do plano, como antes', () => {
    const d = dinheiroDoCentro({ modo: 'pessoal', centro: centro({ caixa: null }), parcelas, opcoes: {}, ref: '2026-11', horizonte: '2027-12' });
    expect(d.total).toBe(164000);
    expect(d.tranches).toHaveLength(1);
  });
});

describe('premissas para o motor', () => {
  it('troca a fonte do centro pelos pedaços, na mesma ordem, e expande os cenários', () => {
    const prem = {
      fontes: { itens: [
        { codigo: '118', nome: 'WRI', cc: '30.118', base: 'livre_pessoal', de: 'ref', ate: 'fim_do_cc', certeza: 'media', situacao: 'em_caixa' },
        { codigo: 'GC', nome: 'Guarda-chuva', base: 'fixo', valor: 132000, de: '2027-01', ate: '2027-12', teto_mes: 5500, situacao: 'em_caixa' },
      ] },
      cenarios: [{ codigo: 'B', fontes: ['118', 'GC'], sobras_para_gc: ['118'] }],
    };
    const porFonte = { 118: { tranches: [
      { chave: 'hoje', de: '2026-11', ate: '2027-01', valor: 100, situacao: 'em_caixa' },
      { chave: 'p2', de: '2026-12', ate: '2027-01', valor: 50, situacao: 'nota_emitida' },
    ] } };
    const out = premissasPeloDinheiro(prem, porFonte);
    expect(out.fontes.itens.map(f => [f.codigo, f.base, f.valor, f.de, f.situacao])).toEqual([
      ['118', 'fixo', 100, '2026-11', 'em_caixa'],
      ['118·p2', 'fixo', 50, '2026-12', 'a_entrar'],
      ['GC', 'fixo', 132000, '2027-01', 'em_caixa'],
    ]);
    expect(out.cenarios[0]).toMatchObject({ fontes: ['118', '118·p2', 'GC'], sobras_para_gc: ['118', '118·p2'] });
  });
});

// Achados da revisão do Gemini 4 Hydrogen (18/11/2026), um teste por defeito.
describe('revisão de 18/11', () => {
  const sit = (parcelas, recebido = 0, a_receber = 0, dataBalancete = '2026-11-03') =>
    situacaoDasParcelas({ parcelas, recursos: { recebido, a_receber }, dataBalancete, hoje: HOJE });
  const base = { modo: 'pessoal', rendimento: 0, opcoes: {}, ref: '2026-11', horizonte: '2027-12' };

  it('parcela depois do fim do centro não gasta o buraco do caixa', () => {
    const parcelas = sit([P(1, '2027-03-01', 50000), P(2, null, 50000, 'Entrega 2')]);
    const d = dinheiroDoCentro({ ...base, centro: centro({ caixa: 0, compromissos_bolsas: 10000, grupos: { a: { livre: 164000 } } }), parcelas, opcoes: { contarSemData: true } });
    expect(d.tranches).toEqual([expect.objectContaining({ chave: 'p2', valor: 40000, tapa: 10000 })]);
  });

  it('balancete sem a conta do que entrou: parcela vencida não é somada ao caixa', () => {
    const parcelas = situacaoDasParcelas({ parcelas: [P(1, '2026-06-01', 100000)], recursos: null, dataBalancete: '2026-11-03', hoje: HOJE });
    const d = dinheiroDoCentro({ ...base, centro: centro({ caixa: 130000, compromissos_bolsas: 0, grupos: { a: { livre: 200000 } } }), parcelas });
    expect(d.total).toBe(130000);
    expect(d.fora[0].motivo).toMatch(/não diz o que entrou/);
  });

  it('livre de Pessoal negativo com bolsa pausada devolvida: soma antes de cortar no zero', () => {
    const d = dinheiroDoCentro({ ...base, centro: centro({ caixa: null, grupos: { a: { livre: -5000 } } }), devolver: 10000, parcelas: sit([]) });
    expect(d.teto).toBe(5000);
  });

  it('centro que vai além do horizonte: parcela depois do horizonte fica de fora', () => {
    const parcelas = sit([P(1, '2028-03-01', 100000)]);
    const d = dinheiroDoCentro({ ...base, centro: centro({ fim: '2028-06-30', caixa: 0, compromissos_bolsas: 0, grupos: { a: { livre: 200000 } } }), parcelas });
    expect(d.ate).toBe('2027-12');
    expect(d.total).toBe(0);
    expect(d.fora[0].motivo).toBe('chega depois do fim da conta');
  });

  it('centro que já acabou não paga nada', () => {
    const d = dinheiroDoCentro({ ...base, centro: centro({ fim: '2026-10-31' }), parcelas: sit([P(1, '2026-12-01', 1000)]) });
    expect(d.total).toBe(0);
    expect(d.tranches).toEqual([]);
  });

  it('data só de mês vence no fim do mês: "Novembro 2026" não está atrasada no começo de novembro', () => {
    const s = sit([P(1, '2026-11-01', 300000, 'NOVEMBRO 2026')]);
    expect(s.itens[0].situacao).toBe('futura');
    const d = dinheiroDoCentro({ ...base, centro: centro({ caixa: 0, compromissos_bolsas: 0, grupos: { a: { livre: 300000 } } }), parcelas: s });
    expect(d.tranches[0].de).toBe('2026-12'); // vence no mês de hoje: conta a partir do seguinte
  });

  it('nota fiscal que cobre só parte da parcela também marca nota emitida', () => {
    expect(sit([P(1, '2026-01-01', 100000), P(2, '2026-06-01', 100000)], 100000, 50000).itens[1].situacao).toBe('nota_emitida');
  });
});
