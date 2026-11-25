import { describe, it, expect } from 'vitest';
import {
  PRAZO_PADRAO_MS,
  corrida,
  motivoDoAborto,
  restanteMs,
  sinalComPrazo,
  timeoutEfetivo,
} from '../src/prazo.js';

describe('prazo', () => {
  it('o timeout é o menor entre o teto próprio e o restante', () => {
    const base = 1_000_000;
    expect(timeoutEfetivo(base + 120_000, 30_000, () => base)).toBe(30_000);
    expect(timeoutEfetivo(base + 20_000, 30_000, () => base)).toBe(20_000);
    expect(timeoutEfetivo(base + 20_000, 30_000, () => base + 25_000)).toBe(0);
    expect(restanteMs(base + 20_000, () => base + 5_000)).toBe(15_000);
    expect(restanteMs(undefined)).toBe(Number.POSITIVE_INFINITY);
  });

  it('o sinal dispara no prazo e distingue desconexão de tempo', () => {
    const base = 1_000_000;
    const porPrazo = sinalComPrazo({ prazo: base + 50, tetoMs: 1_000, agora: () => base });
    try {
      expect(porPrazo.signal.aborted).toBe(false);
    } finally {
      porPrazo.limpar();
    }

    const vencido = sinalComPrazo({ prazo: base - 1, agora: () => base });
    expect(vencido.signal.aborted).toBe(true);
    vencido.limpar();

    const controle = new AbortController();
    const porCliente = sinalComPrazo({ sinal: controle.signal, tetoMs: 1_000, agora: () => base });
    expect(porCliente.signal.aborted).toBe(false);
    controle.abort();
    expect(porCliente.signal.aborted).toBe(true);
    expect(motivoDoAborto({ sinal: controle.signal, agora: () => base })).toBe('abortado');
    expect(motivoDoAborto({ agora: () => base, prazo: base - 1 })).toBe('tempo');
    porCliente.limpar();
  });

  it('corrida desiste quando o sinal aborta, mesmo com promessa pendurada', async () => {
    const controle = new AbortController();
    const promessa = corrida(new Promise(() => {}), { sinal: controle.signal });
    controle.abort();
    await expect(promessa).resolves.toEqual({ erro: 'sinal' });
  });

  it('corrida devolve valor e falha sem lançar', async () => {
    await expect(corrida(Promise.resolve(42))).resolves.toEqual({ valor: 42 });
    const boom = new TypeError('quebrou');
    await expect(corrida(Promise.reject(boom))).resolves.toEqual({ erro: 'falhou', causa: boom });
  });

  it('sinal já abortado trata a rejeição da promessa abandonada', async () => {
    const rejeicoes = [];
    const aoRejeitar = (motivo) => rejeicoes.push(motivo);
    process.on('unhandledRejection', aoRejeitar);

    try {
      const controle = new AbortController();
      controle.abort();

      const r = await corrida(Promise.reject(new Error('boom')), {
        sinal: controle.signal,
      });
      expect(r).toEqual({ erro: 'sinal' });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rejeicoes).toHaveLength(0);
    } finally {
      process.removeListener('unhandledRejection', aoRejeitar);
    }
  });

  it('PRAZO_PADRAO_MS é 120 s', () => {
    expect(PRAZO_PADRAO_MS).toBe(120_000);
  });
});
