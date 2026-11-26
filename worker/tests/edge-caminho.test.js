import { describe, it, expect } from 'vitest';
import { normalizarCaminhoEdge } from '../src/edge-caminho.js';

describe('caminho da Edge Function', () => {
  it.each([
    ['/analise', '/analise'],
    ['/functions/v1/analise', '/analise'],
    ['/analise/saude', '/saude'],
    ['/functions/v1/analise/saude', '/saude'],
  ])('traduz %s para %s', (entrada, esperado) => {
    expect(normalizarCaminhoEdge(entrada)).toBe(esperado);
  });

  it('deixa o resto do caminho como está', () => {
    for (const caminho of ['/saude', '/', '/analise/outra', '/functions/v1/outra']) {
      expect(normalizarCaminhoEdge(caminho)).toBe(caminho);
    }
  });

  it('não quebra com valores não textuais', () => {
    expect(normalizarCaminhoEdge(null)).toBeNull();
    expect(normalizarCaminhoEdge(undefined)).toBeUndefined();
  });
});
