import { describe, expect, it } from 'vitest';
import {
  dataCompacta,
  dataCompleta,
  dinheiro,
  dinheiroCompacto,
  iniciaisUsuario,
} from '../src/util/formato.js';

describe('dinheiro', () => {
  it('formata inteiro sem centavos quando centavos=false', () => {
    expect(dinheiro(84300, { centavos: false })).toBe('R$\u00a084.300');
  });

  it('formata detalhe com dois dígitos decimais quando centavos=true', () => {
    expect(dinheiro(84300.45, { centavos: true })).toBe('R$\u00a084.300,45');
  });

  it('permite omitir o prefixo R$ para células de tabela', () => {
    expect(dinheiro(864000, { centavos: false, prefixo: false })).toBe('864.000');
    expect(dinheiro(-4250, { centavos: false, prefixo: false })).toBe('\u22124.250');
  });

  it('usa sinal tipográfico U+2212 para negativos e preserva sinal de valores pequenos', () => {
    expect(dinheiro(-4250, { centavos: true })).toBe('\u2212R$\u00a04.250,00');
    expect(dinheiro(-4250, { centavos: false })).toBe('\u2212R$\u00a04.250');
    expect(dinheiro(-0.4, { centavos: true })).toBe('\u2212R$\u00a00,40');
    expect(dinheiro(-0.4, { centavos: false })).toBe('\u2212R$\u00a00');
    expect(dinheiro(-0.01, { centavos: true })).toBe('\u2212R$\u00a00,01');
    expect(dinheiro(-0.001, { centavos: true })).toBe('\u2212R$\u00a00,00');
  });

  it('trata zero (inclusive -0) sem sinal negativo', () => {
    expect(dinheiro(0, { centavos: true })).toBe('R$\u00a00,00');
    expect(dinheiro(-0, { centavos: true })).toBe('R$\u00a00,00');
    expect(dinheiro(0, { centavos: false })).toBe('R$\u00a00');
  });

  it('devolve travessão para ausência de dado (nunca R$ 0,00)', () => {
    expect(dinheiro(null)).toBe('—');
    expect(dinheiro(undefined)).toBe('—');
    expect(dinheiro('')).toBe('—');
    expect(dinheiro(Number.NaN)).toBe('—');
  });
});

describe('dinheiroCompacto', () => {
  it('formata milhões e milhares em formato compacto', () => {
    expect(dinheiroCompacto(1240000)).toBe('R$ 1,24 mi');
    expect(dinheiroCompacto(84300)).toBe('R$ 84,3 mil');
    expect(dinheiroCompacto(-1500000)).toBe('\u2212R$ 1,5 mi');
    expect(dinheiroCompacto(-0.4)).toBe('\u2212R$\u00a00');
    expect(dinheiroCompacto(500)).toBe('R$\u00a0500');
  });

  it('devolve travessão para ausência de dado', () => {
    expect(dinheiroCompacto(null)).toBe('—');
    expect(dinheiroCompacto(undefined)).toBe('—');
  });
});

describe('dataCompacta e dataCompleta', () => {
  it('formata ISO YYYY-MM-DD como mmm/aa sem desvio de fuso', () => {
    expect(dataCompacta('2026-09-30')).toBe('set/26');
    expect(dataCompacta('2027-08-01')).toBe('ago/27');
    expect(dataCompacta('2026-01-15')).toBe('jan/26');
  });

  it('formata ISO YYYY-MM-DD completo como dd/mm/aaaa', () => {
    expect(dataCompleta('2026-09-30')).toBe('30/09/2026');
    expect(dataCompleta('2027-08-01')).toBe('01/08/2027');
  });

  it('aceita objetos Date', () => {
    const data = new Date(2026, 8, 30);
    expect(dataCompacta(data)).toBe('set/26');
    expect(dataCompleta(data)).toBe('30/09/2026');
  });

  it('devolve travessão para data ausente ou inválida', () => {
    expect(dataCompacta(null)).toBe('—');
    expect(dataCompacta('')).toBe('—');
    expect(dataCompleta('2026-13-01')).toBe('—');
  });
});

describe('iniciaisUsuario', () => {
  it('extrai iniciais de nome completo ou e-mail', () => {
    expect(iniciaisUsuario('Victor Amaral')).toBe('VA');
    expect(iniciaisUsuario('maria.silva@ufg.br')).toBe('MS');
    expect(iniciaisUsuario('lapig')).toBe('LA');
    expect(iniciaisUsuario('')).toBe('?');
  });
});
