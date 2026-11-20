import { describe, expect, it } from 'vitest';
import { parseValorBR } from '../src/util/moeda.js';

describe('parseValorBR', () => {
  it('lê os formatos que a pessoa digita no pedido', () => {
    expect(parseValorBR('4500')).toBe(4500);
    expect(parseValorBR('4.500')).toBe(4500);
    expect(parseValorBR('4.500,00')).toBe(4500);
    expect(parseValorBR('4,50')).toBe(4.5);
    expect(parseValorBR('R$ 4.500')).toBe(4500);
    expect(parseValorBR('R$ 4.500,00')).toBe(4500);
    expect(parseValorBR('1.234.567,89')).toBe(1234567.89);
    expect(parseValorBR('12.000')).toBe(12000);
  });

  it('aceita espaços, espaço fino e sinal de menos', () => {
    expect(parseValorBR('  R$ 12.000,50  ')).toBe(12000.5);
    expect(parseValorBR('R$\u00a04.500')).toBe(4500);
    expect(parseValorBR('-4.500,00')).toBe(-4500);
  });

  it('trata ponto com 1 ou 2 dígitos como decimal', () => {
    expect(parseValorBR('4.5')).toBe(4.5);
    expect(parseValorBR('1.23')).toBe(1.23);
  });

  it('devolve null para vazio, lixo ou formato ambíguo', () => {
    expect(parseValorBR('')).toBeNull();
    expect(parseValorBR('   ')).toBeNull();
    expect(parseValorBR(null)).toBeNull();
    expect(parseValorBR(undefined)).toBeNull();
    expect(parseValorBR('lixo')).toBeNull();
    expect(parseValorBR('4.500 reais')).toBeNull();
    expect(parseValorBR('1.23.456')).toBeNull();
    expect(parseValorBR('1,234')).toBeNull();
    expect(parseValorBR(',50')).toBeNull();
    expect(parseValorBR('R$')).toBeNull();
  });
});
