import { describe, it, expect, vi } from 'vitest';
import { criarContadorRpc } from '../src/contador-rpc.js';

function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchFalso(resposta) {
  const chamadas = [];
  const fn = async (url, init) => {
    chamadas.push({ url, init });
    if (typeof resposta === 'function') return resposta(url, init);
    return resposta;
  };
  fn.chamadas = chamadas;
  return fn;
}

const TETO = 50;

describe('contador por RPC (Edge Function)', () => {
  it('chama analise_consumir com o JWT de quem perguntou e devolve a cota', async () => {
    const fetch = fetchFalso(json({ dia: '2026-11-25', usadas: 7 }));
    const contador = criarContadorRpc({
      supabaseUrl: 'https://proj.supabase.co/',
      anonKey: 'chave-publica',
      teto: TETO,
      fetchImpl: fetch,
    });

    const r = await contador.consumir({ jwt: 'jwt-da-pessoa' });

    expect(r).toEqual({ permitido: true, usado: 7, teto: TETO, dia: '2026-11-25' });
    expect(fetch.chamadas).toHaveLength(1);
    expect(fetch.chamadas[0].url).toBe(
      'https://proj.supabase.co/rest/v1/rpc/analise_consumir',
    );
    expect(fetch.chamadas[0].init.method).toBe('POST');
    expect(fetch.chamadas[0].init.headers.apikey).toBe('chave-publica');
    expect(fetch.chamadas[0].init.headers.Authorization).toBe('Bearer jwt-da-pessoa');
  });

  it('a 50ª passa e a 51ª recusa com a mesma mensagem de hoje, sem chamar o modelo', async () => {
    const contadorDe = (usadas) =>
      criarContadorRpc({
        supabaseUrl: 'https://proj.supabase.co',
        anonKey: 'anon',
        teto: TETO,
        fetchImpl: fetchFalso(json({ dia: '2026-11-25', usadas })),
      });

    const r50 = await contadorDe(50).consumir({ jwt: 'j' });
    expect(r50.permitido).toBe(true);
    expect(r50.usado).toBe(50);

    const r51 = await contadorDe(51).consumir({ jwt: 'j' });
    expect(r51.permitido).toBe(false);
    expect(r51.codigo).toBe('limite');
    expect(r51.usado).toBe(51);
    expect(r51.teto).toBe(TETO);
    expect(r51.mensagem).toContain('50 perguntas');
  });

  it('HTTP 500 recusa como interno — nunca "permitido" por padrão', async () => {
    const contador = criarContadorRpc({
      supabaseUrl: 'https://proj.supabase.co',
      anonKey: 'anon',
      teto: TETO,
      fetchImpl: fetchFalso(new Response('', { status: 500 })),
    });

    const r = await contador.consumir({ jwt: 'j' });
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe('interno');
    expect(r.mensagem).toContain('Não foi possível contar o uso');
  });

  it('corpo do erro HTTP que não é lido é cancelado (G7)', async () => {
    const cancelar = vi.fn(() => Promise.resolve());
    const contador = criarContadorRpc({
      supabaseUrl: 'https://proj.supabase.co',
      anonKey: 'anon',
      teto: TETO,
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        body: { cancel: cancelar },
      }),
    });

    const r = await contador.consumir({ jwt: 'j' });
    expect(r.codigo).toBe('interno');
    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  it('corpo inválido (sem usadas/dia) recusa como interno', async () => {
    for (const corpo of [{}, { usadas: 0, dia: '2026-11-25' }, { usadas: 3, dia: 'hoje' }]) {
      const contador = criarContadorRpc({
        supabaseUrl: 'https://proj.supabase.co',
        anonKey: 'anon',
        teto: TETO,
        fetchImpl: fetchFalso(json(corpo)),
      });
      const r = await contador.consumir({ jwt: 'j' });
      expect(r.permitido).toBe(false);
      expect(r.codigo).toBe('interno');
    }
  });

  it('falha de rede recusa como interno', async () => {
    const contador = criarContadorRpc({
      supabaseUrl: 'https://proj.supabase.co',
      anonKey: 'anon',
      teto: TETO,
      fetchImpl: async () => {
        throw new TypeError('rede caiu');
      },
    });

    const r = await contador.consumir({ jwt: 'j' });
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe('interno');
  });

  it('sem JWT não chama a rede e recusa', async () => {
    const fetch = fetchFalso(json({ dia: '2026-11-25', usadas: 1 }));
    const contador = criarContadorRpc({
      supabaseUrl: 'https://proj.supabase.co',
      anonKey: 'anon',
      teto: TETO,
      fetchImpl: fetch,
    });

    const r = await contador.consumir({});
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe('interno');
    expect(fetch.chamadas).toHaveLength(0);
  });

  it('prazo vencido vira tempo, não permissão', async () => {
    const contador = criarContadorRpc({
      supabaseUrl: 'https://proj.supabase.co',
      anonKey: 'anon',
      teto: TETO,
      fetchImpl: () => new Promise(() => {}),
    });

    const r = await contador.consumir({ jwt: 'j', prazo: Date.now() - 1 });
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe('tempo');
  });
});
