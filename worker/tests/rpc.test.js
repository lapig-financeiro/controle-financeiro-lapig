import { describe, it, expect, vi } from 'vitest';
import { criarRpc } from '../src/rpc.js';

const SUPABASE = 'https://proj.supabase.co';
const ANON = 'chave-publica';
const JWT = 'jwt-da-pessoa';

function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchFalso(resposta) {
  const chamadas = [];
  const fn = async (url, init = {}) => {
    chamadas.push({ url, init });
    if (typeof resposta === 'function') return resposta(url, init);
    return resposta ?? json({ ok: true });
  };
  fn.chamadas = chamadas;
  return fn;
}

function rpcCom(fetchImpl, extra = {}) {
  return criarRpc({
    supabaseUrl: SUPABASE,
    anonKey: ANON,
    jwt: JWT,
    fetchImpl,
    ...extra,
  });
}

describe('rpc', () => {
  it('chama a RPC com o JWT da pessoa, nunca outra chave no Authorization', async () => {
    const fetchImpl = fetchFalso(json({ projetos: [] }));
    const rpc = rpcCom(fetchImpl);

    const r = await rpc('resumo_projetos_v2', { p_ids: ['a'] });

    expect(r).toEqual({ data: { projetos: [] }, error: null });
    expect(fetchImpl.chamadas).toHaveLength(1);
    const { url, init } = fetchImpl.chamadas[0];
    expect(url).toBe(`${SUPABASE}/rest/v1/rpc/resumo_projetos_v2`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${JWT}`);
    expect(init.headers.apikey).toBe(ANON);
    expect(JSON.parse(init.body)).toEqual({ p_ids: ['a'] });
  });

  it('devolve error em 4xx sem lançar', async () => {
    const fetchImpl = fetchFalso(
      json({ code: 'P0001', message: 'acesso negado ao centro de custo' }, 400),
    );
    const rpc = rpcCom(fetchImpl);

    const r = await rpc('situacao_centro_v2', { p_project_id: 'x' });

    expect(r.data).toBeNull();
    expect(r.error).toMatchObject({
      codigo: 'P0001',
      mensagem: 'acesso negado ao centro de custo',
      status: 400,
    });
  });

  it('devolve error em 5xx sem lançar', async () => {
    const rpc = rpcCom(fetchFalso(new Response('', { status: 503 })));
    const r = await rpc('listar_pendencias_v2', {});
    expect(r.data).toBeNull();
    expect(r.error.status).toBe(503);
    expect(r.error.mensagem).toContain('HTTP 503');
  });

  it('rede fora vira error de rede, sem lançar', async () => {
    const rpc = rpcCom(async () => {
      throw new TypeError('fetch failed');
    });
    const r = await rpc('resumo_projetos_v2', {});
    expect(r.data).toBeNull();
    expect(r.error.codigo).toBe('rede');
  });

  it('200 com corpo que não é JSON é resposta_invalida', async () => {
    const rpc = rpcCom(fetchFalso(new Response('<html>oi</html>', { status: 200 })));
    const r = await rpc('resumo_projetos_v2', {});
    expect(r.data).toBeNull();
    expect(r.error.codigo).toBe('resposta_invalida');
  });

  it('sem JWT não chama o banco', async () => {
    const fetchImpl = fetchFalso(json({}));
    const rpc = criarRpc({ supabaseUrl: SUPABASE, anonKey: ANON, jwt: null, fetchImpl });
    const r = await rpc('resumo_projetos_v2', {});
    expect(r.data).toBeNull();
    expect(r.error.codigo).toBe('sem_login');
    expect(fetchImpl.chamadas).toHaveLength(0);
  });

  it('manda um AbortSignal no fetch', async () => {
    const fetchImpl = fetchFalso(json({ ok: true }));
    await rpcCom(fetchImpl)('resumo_projetos_v2', {});
    expect(fetchImpl.chamadas[0].init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('corpo da resposta e desconexão', () => {
  it('200 com corpo vazio é resposta_invalida', async () => {
    const rpc = rpcCom(fetchFalso(new Response('', { status: 200 })));
    const r = await rpc('resumo_projetos_v2', {});
    expect(r.data).toBeNull();
    expect(r.error.codigo).toBe('resposta_invalida');
  });

  it('200 com leitura interrompida devolve rede, nunca error null', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new TypeError('terminated');
      },
    });
    const r = await rpcCom(fetchImpl)('resumo_projetos_v2', {});
    expect(r.data).toBeNull();
    expect(r.error.codigo).toBe('rede');
  });

  it('timeout na leitura do corpo devolve tempo', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = async () => ({
        ok: true,
        status: 200,
        text: () => new Promise(() => {}),
      });
      const rpc = criarRpc({
        supabaseUrl: SUPABASE,
        anonKey: ANON,
        jwt: JWT,
        fetchImpl,
        prazo: Date.now() + 50,
      });
      const promessa = rpc('resumo_projetos_v2', {});
      await vi.advanceTimersByTimeAsync(60);
      const r = await promessa;
      expect(r.data).toBeNull();
      expect(r.error.codigo).toBe('tempo');
    } finally {
      vi.useRealTimers();
    }
  });

  it('desconexão aborta o fetch e devolve abortado', async () => {
    const controle = new AbortController();
    let sinalDoFetch;
    const fetchImpl = async (_url, init) => {
      sinalDoFetch = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    };
    const rpc = criarRpc({
      supabaseUrl: SUPABASE,
      anonKey: ANON,
      jwt: JWT,
      fetchImpl,
      sinal: controle.signal,
    });

    const promessa = rpc('resumo_projetos_v2', {});
    await vi.waitFor(() => expect(sinalDoFetch).toBeDefined());
    controle.abort();
    expect(sinalDoFetch.aborted).toBe(true);

    const r = await promessa;
    expect(r.data).toBeNull();
    expect(r.error.codigo).toBe('abortado');
  });
});
