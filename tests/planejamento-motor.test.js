import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calcular, conservacao, alvoNoMes, alocar } from '../frontend/js/planejamento-motor.js';

/* ============================================================
   O fixture é a saída de .claude/refazer_mapa_referencia.py para os
   dados mascarados: o motor do site tem de dar exatamente os mesmos
   números. Tolerância de meio centavo por valor.
   ============================================================ */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const CASO = JSON.parse(
  fs.readFileSync(path.join(aqui, 'fixtures/planejamento/caso-mascarado.json'), 'utf8')
);
const TOL = 0.005;

function conferirValor(real, esperado, onde) {
  if (typeof real !== 'number' || Math.abs(real - esperado) > TOL) {
    throw new Error(`${onde}: motor deu ${real}, Python deu ${esperado}`);
  }
}

function conferirValores(real, esperado, onde) {
  expect(Object.keys(real).sort(), `${onde}: fontes`).toEqual(Object.keys(esperado).sort());
  for (const k of Object.keys(esperado)) conferirValor(real[k], esperado[k], `${onde}.${k}`);
}

const resultado = calcular(CASO.dados, CASO.premissas);

describe('calcular: fixture mascarado contra o Python', () => {
  it('meses', () => {
    expect(resultado.meses).toEqual(CASO.esperado.meses);
  });

  it('pessoas, na mesma ordem, com nome, grupo, alvo e desde', () => {
    const esperado = CASO.esperado.pessoas;
    expect(resultado.pessoas).toHaveLength(esperado.length);
    esperado.forEach((e, i) => {
      const p = resultado.pessoas[i];
      expect(p.nome, `pessoa ${i}`).toBe(e.nome);
      expect(p.grupo, `${e.nome}: grupo`).toBe(e.grupo);
      expect(p.desde, `${e.nome}: desde`).toBe(e.desde);
      conferirValor(p.alvo, e.alvo, `${e.nome}: alvo`);
    });
  });

  it('fontes: valor_hoje, de_hoje e ate_hoje', () => {
    const esperado = CASO.esperado.fontes;
    expect(Object.keys(resultado.fontes).sort()).toEqual(Object.keys(esperado).sort());
    for (const k of Object.keys(esperado)) {
      const f = resultado.fontes[k];
      conferirValor(f.valor_hoje, esperado[k].valor_hoje, `fonte ${k}: valor_hoje`);
      expect(f.de_hoje, `fonte ${k}: de_hoje`).toBe(esperado[k].de_hoje);
      expect(f.ate_hoje, `fonte ${k}: ate_hoje`).toBe(esperado[k].ate_hoje);
    }
  });

  for (const cod of ['A', 'B', 'C', 'A0', 'D']) {
    it(`cenário ${cod}: totais, faltas por mês/grupo, usado, sobra, para_gc e mapa inteiro`, () => {
      const r = resultado.cenarios[cod];
      const e = CASO.esperado.cenarios[cod];
      expect(r, `cenário ${cod} não foi calculado`).toBeTruthy();

      conferirValor(r.total_sem, e.total_sem, `${cod}: total_sem`);
      conferirValores(r.sem_mes, e.sem_mes, `${cod}: sem_mes`);
      conferirValores(r.sem_grupo, e.sem_grupo, `${cod}: sem_grupo`);
      conferirValores(r.usado, e.usado, `${cod}: usado`);
      conferirValores(r.sobra, e.sobra, `${cod}: sobra`);
      conferirValores(r.para_gc, e.para_gc, `${cod}: para_gc`);

      expect(Object.keys(r.mapa).sort(), `${cod}: células do mapa`).toEqual(
        Object.keys(e.mapa).sort()
      );
      for (const chave of Object.keys(e.mapa)) {
        const cel = r.mapa[chave] || [];
        const esperada = e.mapa[chave];
        expect(
          cel.map(([k]) => k),
          `${cod} ${chave}: ordem dos pagadores`
        ).toEqual(esperada.map(([k]) => k));
        cel.forEach(([, v], i) => conferirValor(v, esperada[i][1], `${cod} ${chave} ${esperada[i][0]}`));
      }
    });
  }
});

describe('conservacao', () => {
  const pessoa = {
    nome: 'P01',
    grupo: '30.099',
    alvo: 1000,
    desde: '2026-11',
    linhas: [],
    base_linhas: [['30.099', 1000]],
  };
  const cens = { A: { codigo: 'A', fontes: [] } };
  const M = ['2026-11'];

  it('aceita o mapa que fecha', () => {
    const res = { A: { mapa: { 'P01|2026-11': [['30.099', 1000]] }, usado: {} } };
    expect(() => conservacao([pessoa], res, M, cens)).not.toThrow();
  });

  it('dispara erro quando o mapa foi adulterado', () => {
    const res = { A: { mapa: { 'P01|2026-11': [['30.099', 900]] }, usado: {} } };
    expect(() => conservacao([pessoa], res, M, cens)).toThrow(
      'conservação falhou no cenário A: necessidade 1000.00 ≠ 900.00 + 0.00 + 0.00'
    );
  });

  it('dispara erro quando o usado não bate com as fontes', () => {
    const res = {
      A: { mapa: { 'P01|2026-11': [['30.099', 900], ['→X', 100]] }, usado: { X: 50 } },
    };
    expect(() => conservacao([pessoa], res, M, cens)).toThrow(/conservação falhou no cenário A/);
  });
});

describe('alvoNoMes', () => {
  const pessoa = { alvo: 18000, base_linhas: [['30.099', 14000], ['30.113', 4000]] };
  const cen = { encerra_com_cc: ['30.113'], _fins: { '30.099': '2027-01', '30.113': '2027-05' } };

  it('corta só a parte do centro que encerra, e só depois do fim dele', () => {
    expect(alvoNoMes(pessoa, '2027-05', cen)).toBe(18000);
    expect(alvoNoMes(pessoa, '2027-06', cen)).toBe(14000);
  });

  it('não corta nada do outro centro nem sem a opção', () => {
    expect(alvoNoMes(pessoa, '2027-06', { ...cen, encerra_com_cc: [] })).toBe(18000);
    expect(alvoNoMes(pessoa, '2027-06', { ...cen, encerra_com_cc: ['30.099'] })).toBe(4000);
  });
});

describe('alocar com teto mensal', () => {
  it('não paga acima do teto no mês e manda o resto para SEM', () => {
    const pessoa = {
      nome: 'P01',
      grupo: '30.099',
      alvo: 2500,
      desde: '2026-11',
      linhas: [],
      base_linhas: [['30.099', 2500]],
    };
    const fontes = {
      F: { valor_hoje: 10000, de_hoje: '2026-11', ate_hoje: '2027-12', teto_mes: 1000 },
    };
    const r = alocar([pessoa], fontes, { fontes: ['F'] }, ['2026-11', '2026-12']);
    expect(r.mapa['P01|2026-11']).toEqual([['→F', 1000], ['SEM', 1500]]);
    expect(r.mapa['P01|2026-12']).toEqual([['→F', 1000], ['SEM', 1500]]);
    expect(r.total_sem).toBe(3000);
    expect(r.sobra.F).toBe(8000);
  });
});
