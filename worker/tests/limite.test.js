import { describe, it, expect } from 'vitest';
import {
  TTL_SEGUNDOS,
  chaveUso,
  consumir,
  diaBrasilia,
  tetoDoAmbiente,
} from '../src/limite.js';

function kvFalsa(inicial = {}) {
  const mapa = new Map(Object.entries(inicial));
  const puts = [];
  return {
    mapa,
    puts,
    async get(chave) {
      return mapa.has(chave) ? mapa.get(chave) : null;
    },
    async put(chave, valor, opcoes) {
      puts.push({ chave, valor, opcoes });
      mapa.set(chave, valor);
    },
  };
}

// 25/11/2026, 12:00 em Brasília (15:00 UTC).
const MEIO_DIA = Date.UTC(2026, 10, 25, 15, 0, 0);

describe('dia de Brasília', () => {
  it('vira o dia às 03:00 UTC, não à meia-noite UTC', () => {
    // 01:00 UTC de 26/11 ainda é 22:00 de 25/11 em Brasília.
    expect(diaBrasilia(Date.UTC(2026, 10, 26, 1, 0, 0))).toBe('2026-11-25');
    // 02:59 UTC ainda é 23:59 de 25/11.
    expect(diaBrasilia(Date.UTC(2026, 10, 26, 2, 59, 0))).toBe('2026-11-25');
    // 03:00 UTC já é 00:00 de 26/11.
    expect(diaBrasilia(Date.UTC(2026, 10, 26, 3, 0, 0))).toBe('2026-11-26');
  });
});

describe('limite diário', () => {
  it('deixa passar a 50ª e recusa a 51ª', async () => {
    const kv = kvFalsa();
    for (let i = 1; i <= 50; i += 1) {
      const r = await consumir({ kv, userId: 'u1', agora: MEIO_DIA });
      expect(r.permitido).toBe(true);
      expect(r.usado).toBe(i);
    }

    const r51 = await consumir({ kv, userId: 'u1', agora: MEIO_DIA });
    expect(r51.permitido).toBe(false);
    expect(r51.codigo).toBe('limite');
    expect(r51.usado).toBe(50);
    expect(r51.mensagem).toContain('50 perguntas');
    // A recusa não incrementa: o contador continua em 50.
    expect(kv.mapa.get(chaveUso('u1', '2026-11-25'))).toBe('50');
  });

  it('zera no dia seguinte, mesmo perto da meia-noite UTC', async () => {
    const kv = kvFalsa();
    for (let i = 0; i < 50; i += 1) {
      await consumir({ kv, userId: 'u1', agora: MEIO_DIA });
    }
    expect((await consumir({ kv, userId: 'u1', agora: MEIO_DIA })).codigo).toBe('limite');

    // 00:30 de 26/11 em Brasília = 03:30 UTC de 26/11.
    const diaSeguinte = Date.UTC(2026, 10, 26, 3, 30, 0);
    const r = await consumir({ kv, userId: 'u1', agora: diaSeguinte });
    expect(r.permitido).toBe(true);
    expect(r.usado).toBe(1);
    expect(r.dia).toBe('2026-11-26');
    expect(kv.mapa.get(chaveUso('u1', '2026-11-26'))).toBe('1');
  });

  it('separa o uso por usuário', async () => {
    const kv = kvFalsa();
    for (let i = 0; i < 50; i += 1) {
      await consumir({ kv, userId: 'u1', agora: MEIO_DIA });
    }
    const outro = await consumir({ kv, userId: 'u2', agora: MEIO_DIA });
    expect(outro.permitido).toBe(true);
    expect(outro.usado).toBe(1);
  });

  it('expira a chave em 48 h', async () => {
    const kv = kvFalsa();
    await consumir({ kv, userId: 'u1', agora: MEIO_DIA });
    expect(kv.puts).toHaveLength(1);
    expect(kv.puts[0].opcoes).toEqual({ expirationTtl: TTL_SEGUNDOS });
    expect(TTL_SEGUNDOS).toBe(172_800);
  });

  it('falha de KV não vira "pode"', async () => {
    const semGet = {
      get: async () => {
        throw new Error('KV fora');
      },
      put: async () => {},
    };
    const r = await consumir({ kv: semGet, userId: 'u1', agora: MEIO_DIA });
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe('interno');

    const semPut = {
      get: async () => null,
      put: async () => {
        throw new Error('KV fora');
      },
    };
    const r2 = await consumir({ kv: semPut, userId: 'u1', agora: MEIO_DIA });
    expect(r2.permitido).toBe(false);
    expect(r2.codigo).toBe('interno');
  });

  it('teto do ambiente inválido cai no padrão de 50', () => {
    expect(tetoDoAmbiente(undefined)).toBe(50);
    expect(tetoDoAmbiente('')).toBe(50);
    expect(tetoDoAmbiente('0')).toBe(50);
    expect(tetoDoAmbiente('abc')).toBe(50);
    expect(tetoDoAmbiente('10')).toBe(10);
  });
});

describe('prazo e desconexão', () => {
  it('prazo vencido devolve tempo sem esperar o KV', async () => {
    const kv = {
      get: () => new Promise(() => {}),
      put: () => new Promise(() => {}),
    };
    const r = await consumir({ kv, userId: 'u1', agora: () => 1_000, prazo: 500 });
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe('tempo');
  });

  it('desconexão devolve abortado sem esperar o KV', async () => {
    const controle = new AbortController();
    controle.abort();
    const kv = {
      get: () => new Promise(() => {}),
      put: () => new Promise(() => {}),
    };
    const r = await consumir({
      kv,
      userId: 'u1',
      agora: () => 1_000,
      sinal: controle.signal,
    });
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe('abortado');
  });

  it('KV rejeitada com sinal já abortado não deixa unhandled rejection', async () => {
    const rejeicoes = [];
    const aoRejeitar = (motivo) => rejeicoes.push(motivo);
    process.on('unhandledRejection', aoRejeitar);

    try {
      const controle = new AbortController();
      controle.abort();
      const kv = {
        get: () => Promise.reject(new Error('kv quebrou')),
        put: () => Promise.resolve(),
      };
      const r = await consumir({
        kv,
        userId: 'u1',
        agora: () => 1_000,
        sinal: controle.signal,
      });
      expect(r.permitido).toBe(false);
      expect(r.codigo).toBe('abortado');

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rejeicoes).toHaveLength(0);
    } finally {
      process.removeListener('unhandledRejection', aoRejeitar);
    }
  });
});
