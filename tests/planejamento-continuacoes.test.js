import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calcular, meses } from '../frontend/js/planejamento-motor.js';
import { continuacoes, fontesDosPedacos, pagamentosDe, razao, distribuir, comoCenario } from '../frontend/js/planejamento-continuacoes.js';

// Pessoas e fontes sintéticas no formato do motor (montarPessoas / fontesDoDia).
const pessoa = (nome, linhas, alvo) => ({ nome, grupo: [...new Set(linhas.map(l => l.cc))].join(' + '), alvo: alvo ?? linhas.reduce((s, l) => s + l.valor, 0), desde: '2027-01', linhas, base_linhas: linhas.map(l => [l.cc, l.valor]) });
const cen = { _fins: {}, encerra_com_cc: [] };
const M = meses('2027-01', '2027-12');
const fonte = (codigo, valor, de, ate, extra = {}) => [codigo, { codigo, valor_hoje: valor, de_hoje: de, ate_hoje: ate, ...extra }];
const itens = cods => cods.map(c => ({ codigo: c, teto_mes: c === 'GC' ? 5500 : null }));

describe('continuações', () => {
  it('nasce no mês seguinte ao fim da bolsa e vai até o fim do período', () => {
    const [c] = continuacoes({ pessoas: [pessoa('P1', [{ cc: 'A', valor: 2000, de: '2027-01', ate: '2027-04' }])], cen, ref: '2027-01', inicio: '2027-01', fim: '2027-12' });
    expect([c.de, c.ate, c.meses.length, c.total]).toEqual(['2027-05', '2027-12', 8, 16000]);
  });
  it('pessoa em dois projetos que acabam em datas diferentes: valor em degraus', () => {
    const [c] = continuacoes({ pessoas: [pessoa('P2', [
      { cc: 'A', valor: 4000, de: '2027-01', ate: '2027-03' }, { cc: 'B', valor: 3000, de: '2027-01', ate: '2027-06' }])], cen, ref: '2027-01', inicio: '2027-01', fim: '2027-12' });
    expect([c.de, c.nec['2027-04'], c.nec['2027-07']]).toEqual(['2027-04', 4000, 7000]);
  });
  it('o que falta antes do início escolhido fica à parte, fora da continuação', () => {
    const [c] = continuacoes({ pessoas: [pessoa('P3', [{ cc: 'A', valor: 1000, de: '2027-01', ate: '2027-02' }])], cen, ref: '2027-01', inicio: '2027-05', fim: '2027-12' });
    expect([c.de, Object.keys(c.antes)]).toEqual(['2027-05', ['2027-03', '2027-04']]);
  });
});

describe('razão de cada fonte', () => {
  const fontes = fontesDosPedacos({ pedacos: Object.fromEntries([fonte('X', 3000, '2027-01', '2027-12'), fonte('X·p2', 3000, '2027-04', '2027-12')]), itens: itens(['X']), ligadas: ['X'], cen, ref: '2027-01' });
  it('a parcela chega no mês dela; o saldo não pode ficar negativo antes', () => {
    const rz = razao(fontes, { X: { '2027-01': 2000, '2027-02': 2000 } }, { M });
    expect(rz.X.estouro).toEqual([{ m: '2027-02', motivo: 'saldo' }]);
    expect(rz.X.saldo['2027-04']).toBe(2000);
  });
  it('pagamento depois do fim da fonte é estouro "fora"', () => {
    const curta = fontesDosPedacos({ pedacos: Object.fromEntries([fonte('X', 9000, '2027-01', '2027-03')]), itens: itens(['X']), ligadas: ['X'], cen, ref: '2027-01' });
    expect(razao(curta, { X: { '2027-04': 100 } }, { M }).X.estouro).toEqual([{ m: '2027-04', motivo: 'fora' }]);
  });
  it('a sobra de uma fonte que acabou passa ao guarda-chuva no mês seguinte', () => {
    const f = fontesDosPedacos({ pedacos: Object.fromEntries([fonte('A', 5000, '2027-01', '2027-03'), fonte('GC', 0.01, '2027-01', '2027-12')]), itens: itens(['A', 'GC']), ligadas: ['A', 'GC'], cen, ref: '2027-01' });
    const rz = razao(f, {}, { M, sobrasParaGC: ['A'] });
    expect([rz.A.para_gc, rz.GC.entra['2027-04']]).toEqual([5000, 5000]);
  });
});

describe('distribuir', () => {
  const p = (nome, valor, ate) => pessoa(nome, [{ cc: 'Z', valor, de: '2027-01', ate }]);
  const montar = (pessoas, pedacos, cods, extra = {}) => {
    const conts = continuacoes({ pessoas, cen, ref: '2027-01', inicio: '2027-01', fim: '2027-12' });
    const fontes = fontesDosPedacos({ pedacos: Object.fromEntries(pedacos), itens: itens(cods), ligadas: cods, cen, ref: '2027-01' });
    return { conts, fontes, d: distribuir({ conts, fontes, M, ...extra }) };
  };

  it('uma fonte o período inteiro, nunca troca mês a mês', () => {
    const { d } = montar([p('P1', 1000, '2027-06')], [fonte('A', 3000, '2027-01', '2027-08'), fonte('B', 99999, '2027-01', '2027-12')], ['A', 'B']);
    // A acaba antes, mas não cobre até dez/27; vai inteira para B.
    expect(d.destinos.P1.segmentos).toEqual([{ fonte: 'B', de: '2027-07', ate: '2027-12' }]);
  });
  it('duas fontes em sequência, cada pedaço com pelo menos 3 meses', () => {
    const { d } = montar([p('P1', 1000, '2027-03')], [fonte('A', 5000, '2027-01', '2027-08'), fonte('B', 4000, '2027-01', '2027-12')], ['A', 'B']);
    expect(d.destinos.P1.segmentos).toEqual([{ fonte: 'A', de: '2027-04', ate: '2027-08' }, { fonte: 'B', de: '2027-09', ate: '2027-12' }]);
  });
  it('quantos pedaços forem precisos, cada um com pelo menos 3 meses', () => {
    const { d } = montar([p('P1', 1000, '2027-01')], [fonte('A', 3000, '2027-01', '2027-04'), fonte('B', 4000, '2027-01', '2027-08'), fonte('C', 9000, '2027-01', '2027-12')], ['A', 'B', 'C']);
    expect(d.destinos.P1.segmentos.map(s => [s.fonte, s.de, s.ate])).toEqual([
      ['A', '2027-02', '2027-04'], ['B', '2027-05', '2027-08'], ['C', '2027-09', '2027-12']]);
  });
  it('fonte que só pagaria 1 ou 2 meses no meio não entra', () => {
    const { d } = montar([p('P1', 1000, '2027-03')], [fonte('A', 2000, '2027-01', '2027-12'), fonte('B', 99999, '2027-01', '2027-12')], ['A', 'B']);
    expect(d.destinos.P1.segmentos).toEqual([{ fonte: 'B', de: '2027-04', ate: '2027-12' }]);
  });
  it('o último pedaço pode ser menor que 3 meses quando fecha a continuação', () => {
    const { d } = montar([p('P1', 1000, '2027-07')], [fonte('A', 4000, '2027-01', '2027-11'), fonte('B', 1000, '2027-01', '2027-12')], ['A', 'B']);
    expect(d.destinos.P1.segmentos).toEqual([{ fonte: 'A', de: '2027-08', ate: '2027-11' }, { fonte: 'B', de: '2027-12', ate: '2027-12' }]);
  });
  it('cobre até onde der; o resto fica sem dinheiro, com o motivo', () => {
    const { d } = montar([p('P1', 1000, '2027-06')], [fonte('A', 3000, '2027-01', '2027-12')], ['A']);
    expect(d.destinos.P1).toMatchObject({ situacao: 'sem_fonte', motivo: 'dinheiro', ateCoberto: '2027-09' });
  });
  it('respeita o teto mensal do guarda-chuva', () => {
    const { d } = montar([p('P1', 7000, '2027-06')], [fonte('GC', 999999, '2027-01', '2027-12')], ['GC']);
    expect(d.destinos.P1).toMatchObject({ situacao: 'sem_fonte', ateCoberto: null });
  });
  it('sem fonte vigente no mês seguinte: motivo "alcance"', () => {
    const { d } = montar([p('P1', 100, '2027-06')], [fonte('A', 99999, '2027-01', '2027-09')], ['A']);
    expect(d.destinos.P1).toMatchObject({ situacao: 'sem_fonte', motivo: 'alcance', ateCoberto: '2027-09' });
  });
  it('quem compete pelo mesmo dinheiro fica em disputa, inclusive quem levou o último bloco', () => {
    const { d } = montar([p('P1', 1000, '2027-06'), p('P2', 1000, '2027-06'), p('P3', 1000, '2027-06')],
      [fonte('A', 12000, '2027-01', '2027-12')], ['A']);
    expect(['P1', 'P2', 'P3'].map(x => [d.destinos[x].situacao, d.destinos[x].ateCoberto])).toEqual([
      ['disputa', '2027-12'], ['disputa', '2027-09'], ['disputa', '2027-09']]);
    expect(d.disputas[0]).toMatchObject({ desde: '2027-10', ids: ['P1', 'P2', 'P3'], comEspaco: [] });
  });
  it('o dinheiro se espalha em blocos: quem começa depois também ganha o primeiro bloco', () => {
    const { d } = montar([p('P1', 1000, '2027-03'), p('P2', 1000, '2027-03'), p('P3', 1000, '2027-04')],
      [fonte('A', 15000, '2027-01', '2027-12')], ['A']);
    expect(['P1', 'P2', 'P3'].map(x => [d.destinos[x].situacao, d.destinos[x].ateCoberto])).toEqual([
      ['disputa', '2027-09'], ['disputa', '2027-09'], ['disputa', '2027-07']]);
  });
  it('decisão manual entra antes e resolve a disputa', () => {
    const pessoas = [p('P1', 1000, '2027-06'), p('P2', 1000, '2027-06'), p('P3', 1000, '2027-06')];
    const { d } = montar(pessoas, [fonte('A', 12000, '2027-01', '2027-12')], ['A'], { manuais: { P3: { tipo: 'nao' } } });
    expect(['P1', 'P2', 'P3'].map(x => d.destinos[x].situacao)).toEqual(['sugestao', 'sugestao', 'nao']);
  });
  it('fonte estourada por decisão manual não recebe mais ninguém na sugestão', () => {
    const pessoas = [p('P1', 1000, '2027-06'), p('P2', 1000, '2027-06')];
    const manual = { P1: { tipo: 'fonte', segmentos: [{ fonte: 'A', de: '2027-07', ate: '2027-12' }] } };
    const { d } = montar(pessoas, [fonte('A', 3000, '2027-01', '2027-12'), fonte('B', 99999, '2027-01', '2027-12')], ['A', 'B'], { manuais: manual });
    expect(d.destinos.P2.segmentos.map(s => s.fonte)).toEqual(['B']);
  });
  it('complemento manual: o guarda-chuva completa uma bolsa maior que o teto', () => {
    const c = { meses: ['2027-07'], nec: { '2027-07': 7000 } };
    expect(pagamentosDe(c, { tipo: 'fonte', segmentos: [{ fonte: 'A', de: '2027-07', ate: '2027-07' }], complemento: { fonte: 'GC', valor: 5500 } }).pag)
      .toEqual({ GC: { '2027-07': 5500 }, A: { '2027-07': 1500 } });
  });
});

describe('caso mascarado de 17/11', () => {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const CASO = JSON.parse(fs.readFileSync(path.join(aqui, 'fixtures/planejamento/caso-mascarado.json'), 'utf8'));
  const r = calcular(CASO.dados, CASO.premissas);
  const A = CASO.premissas.cenarios[0];
  const cenA = { ...A, _fins: Object.fromEntries(Object.entries(CASO.dados.centros).filter(([, c]) => c.existe).map(([cc, c]) => [cc, String(c.fim || '').slice(0, 7)])) };
  const ref = CASO.dados.ref, fim = CASO.premissas.horizonte_ate;
  const conts = continuacoes({ pessoas: r.pessoas, cen: cenA, ref, inicio: ref, fim });
  const fontes = fontesDosPedacos({ pedacos: r.fontes, itens: CASO.premissas.fontes.itens, ligadas: A.fontes, cen: cenA, ref });
  const Mt = meses(ref, fim);
  const t0 = Date.now();
  const d = distribuir({ conts, fontes, M: Mt });
  const ms = Date.now() - t0;
  const res = comoCenario({ pessoas: r.pessoas, conts, dist: d, fontes, Mvista: Mt, M: Mt });

  it('nenhum pedaço de bolsa com menos de 3 meses, salvo o último quando fecha a continuação', () => {
    const porId = Object.fromEntries(conts.map(c => [c.id, c]));
    for (const [id, x] of Object.entries(d.destinos)) {
      (x.segmentos || []).forEach((s, i, ss) => {
        const fecha = i === ss.length - 1 && s.ate === porId[id].ate;
        if (!fecha || porId[id].meses.length >= 3) expect(meses(s.de, s.ate).length >= 3 || fecha).toBe(true);
      });
    }
  });
  it('nenhuma fonte estoura com a sugestão automática', () => {
    expect(Object.entries(res.razao).filter(([, x]) => x.estouro.length)).toEqual([]);
  });
  it('a conta fecha: o que as fontes pagam + o que falta = o que as continuações pedem', () => {
    const pede = conts.reduce((s, c) => s + c.total, 0);
    const pago = Object.values(res.usado).reduce((s, v) => s + v, 0);
    expect(Math.abs(pede - pago - res.total_sem)).toBeLessThan(0.05);
  });
  it('exigir bolsa inteira não sai mais barato que trocar de fonte todo mês', () => {
    expect(res.total_sem).toBeGreaterThanOrEqual(r.cenarios.A.total_sem - 0.01);
  });
  it('é rápido o bastante para recalcular a cada clique', () => {
    expect(ms).toBeLessThan(1500);
  });
});

describe('revisão do Hydrogen (18/11, noite)', () => {
  const p = (nome, valor, ate) => pessoa(nome, [{ cc: 'Z', valor, de: '2027-01', ate }]);
  const montar = (pessoas, pedacos, cods, extra = {}) => {
    const conts = continuacoes({ pessoas, cen, ref: '2027-01', inicio: '2027-01', fim: '2027-12' });
    const fontes = fontesDosPedacos({ pedacos: Object.fromEntries(pedacos), itens: itens(cods), ligadas: cods, cen, ref: '2027-01' });
    return { conts, fontes, d: distribuir({ conts, fontes, M, ...extra }) };
  };
  it('quem usa outra fonte não entra na disputa', () => {
    // P3 precisa de jan–mar e fica com B; P1 e P2 disputam A de jul em diante.
    const p3 = pessoa('P3', [{ cc: 'Z', valor: 1000, de: '2027-04', ate: '2027-12' }]);
    p3.desde = '2027-01';
    const { d } = montar([p('P1', 1000, '2027-06'), p('P2', 1000, '2027-06'), p3],
      [fonte('B', 3000, '2027-01', '2027-03'), fonte('A', 9000, '2027-01', '2027-12')], ['B', 'A']);
    expect(d.destinos.P3).toMatchObject({ situacao: 'sugestao', segmentos: [{ fonte: 'B', de: '2027-01', ate: '2027-03' }] });
    expect([d.destinos.P1.situacao, d.destinos.P2.situacao]).toEqual(['disputa', 'disputa']);
  });
  it('quem pegou numa rodada anterior o dinheiro que faltou depois também entra na disputa', () => {
    // P2 começa em out/27 e leva A logo na primeira rodada; P1 chega em out/27 na terceira e não cabe mais.
    const { d } = montar([p('P1', 1000, '2027-03'), p('P2', 1000, '2027-09')], [fonte('A', 9000, '2027-01', '2027-12')], ['A']);
    expect([d.destinos.P1.situacao, d.destinos.P2.situacao]).toEqual(['disputa', 'disputa']);
    expect(d.disputas[0]).toMatchObject({ desde: '2027-10', fontes: ['A'], comEspaco: [] });
  });
  it('fonte que acabou antes do primeiro mês passa a sobra ao guarda-chuva já no primeiro mês', () => {
    const f = fontesDosPedacos({ pedacos: Object.fromEntries([fonte('A', 5000, '2027-01', '2026-12'), fonte('GC', 0.01, '2027-01', '2027-12')]), itens: itens(['A', 'GC']), ligadas: ['A', 'GC'], cen, ref: '2027-01' });
    expect(razao(f, {}, { M, sobrasParaGC: ['A'] }).GC.entra['2027-01']).toBe(5000.01);
  });
  it('continuação com buraco no meio: só os meses que precisam', () => {
    const [c] = continuacoes({ pessoas: [pessoa('P9', [{ cc: 'A', valor: 1000, de: '2027-01', ate: '2027-03' }, { cc: 'B', valor: 1000, de: '2027-05', ate: '2027-07' }], 1000)], cen, ref: '2027-01', inicio: '2027-01', fim: '2027-12' });
    expect(c.meses).toEqual(['2027-04', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12']);
    expect(Object.values(c.nec).every(v => v === 1000)).toBe(true);
  });
  it('estouro de teto numa decisão manual só bloqueia aquele mês', () => {
    const manual = { P1: { tipo: 'fonte', segmentos: [{ fonte: 'GC', de: '2027-07', ate: '2027-09' }] } };
    const { d } = montar([p('P1', 7000, '2027-06'), p('P2', 1000, '2027-09')], [fonte('GC', 999999, '2027-01', '2027-12')], ['GC'], { manuais: manual });
    expect(d.destinos.P2.segmentos).toEqual([{ fonte: 'GC', de: '2027-10', ate: '2027-12' }]);
  });
});
