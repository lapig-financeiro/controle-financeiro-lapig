import { describe, it, expect, vi } from 'vitest';
import { criarRegistradorRpc } from '../src/registro-rpc.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const CONVERSA = '22222222-2222-4222-8222-222222222222';
const CHAVE_FALSA = 'chave-de-servidor-falsa-do-teste-123';

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

function registrador(fetchImpl, opcoes = {}) {
  return criarRegistradorRpc({
    supabaseUrl: 'https://proj.supabase.co/',
    anonKey: 'chave-publica',
    serviceRoleKey: CHAVE_FALSA,
    fetchImpl,
    ...opcoes,
  });
}

describe('registro por RPC (074/075)', () => {
  it('iniciar chama a RPC com o JWT da pessoa e devolve { id, conversa, ordem }', async () => {
    const fetch = fetchFalso(
      json({ registro: UUID, conversa: CONVERSA, ordem: 2 }),
    );
    const r = await registrador(fetch).iniciar({
      jwt: 'jwt-da-pessoa',
      pergunta: 'Quanto o 30.901 tem livre?',
      anteriores: 2,
      modelo: 'modelo-teste',
      conversa: CONVERSA,
    });

    expect(r).toEqual({ id: UUID, conversa: CONVERSA, ordem: 2 });
    expect(fetch.chamadas).toHaveLength(1);
    expect(fetch.chamadas[0].url).toBe(
      'https://proj.supabase.co/rest/v1/rpc/analise_registro_iniciar',
    );
    expect(fetch.chamadas[0].init.method).toBe('POST');
    expect(fetch.chamadas[0].init.headers.apikey).toBe('chave-publica');
    expect(fetch.chamadas[0].init.headers.Authorization).toBe('Bearer jwt-da-pessoa');
    expect(JSON.parse(fetch.chamadas[0].init.body)).toEqual({
      p_pergunta: 'Quanto o 30.901 tem livre?',
      p_anteriores: 2,
      p_modelo: 'modelo-teste',
      p_conversa: CONVERSA,
    });
  });

  it('iniciar sem conversa continua aceitando a resposta uuid da 074', async () => {
    const fetch = fetchFalso(json(UUID));
    const r = await registrador(fetch).iniciar({
      jwt: 'j',
      pergunta: 'pergunta',
      anteriores: 0,
      modelo: 'm',
    });

    expect(r).toEqual({ id: UUID, conversa: null, ordem: null });
    expect(JSON.parse(fetch.chamadas[0].init.body)).toEqual({
      p_pergunta: 'pergunta',
      p_anteriores: 0,
      p_modelo: 'm',
    });
  });

  it('iniciar falha vira tudo nulo e cancela o corpo no HTTP de erro', async () => {
    const cancelar = vi.fn(() => Promise.resolve());
    const fetch = fetchFalso(async () => ({
      ok: false,
      status: 500,
      body: { cancel: cancelar },
    }));

    const r = await registrador(fetch).iniciar({
      jwt: 'j',
      pergunta: 'pergunta',
      anteriores: 0,
      modelo: 'm',
    });

    expect(r).toEqual({ id: null, conversa: null, ordem: null });
    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  it('iniciar recusa JSON inválido, texto que não é uuid, rede e prazo vencido', async () => {
    const casos = [
      fetchFalso(new Response('não é json', { status: 200 })),
      fetchFalso(json('resposta qualquer')),
      fetchFalso(json({ registro: 'não é uuid', conversa: CONVERSA, ordem: 1 })),
      fetchFalso(async () => {
        throw new TypeError('rede caiu');
      }),
    ];

    for (const fetch of casos) {
      const r = await registrador(fetch).iniciar({
        jwt: 'j',
        pergunta: 'pergunta',
        anteriores: 0,
        modelo: 'm',
      });
      expect(r).toEqual({ id: null, conversa: null, ordem: null });
    }

    const semRede = fetchFalso(() => new Promise(() => {}));
    const prazoVencido = await registrador(semRede).iniciar({
      jwt: 'j',
      pergunta: 'pergunta',
      anteriores: 0,
      modelo: 'm',
      prazo: Date.now() - 1,
    });
    expect(prazoVencido).toEqual({ id: null, conversa: null, ordem: null });
  });

  it('concluir grava pela RPC de servidor, com a credencial de servidor e o p_user', async () => {
    const fetch = fetchFalso(new Response(null, { status: 204 }));
    const resposta = {
      texto: { texto: 'Pronto.', semOrigem: [] },
      blocos: [{ id: 'b1', tipo: 'texto' }],
    };
    const passos = [
      {
        ferramenta: 'listar_centros',
        argumentos: { project_id: '30.901' },
        estado: 'fim',
      },
    ];

    const r = await registrador(fetch).concluir({
      user: UUID,
      id: CONVERSA,
      resposta,
      passos,
      rodadas: 3,
      ms: 1234,
      chamadas: 2,
      desfecho: 'ok',
      codigoErro: null,
    });

    expect(r).toEqual({ ok: true });
    expect(fetch.chamadas).toHaveLength(1);
    expect(fetch.chamadas[0].url).toBe(
      'https://proj.supabase.co/rest/v1/rpc/analise_registro_concluir_servidor',
    );
    expect(fetch.chamadas[0].init.headers.apikey).toBe(CHAVE_FALSA);
    expect(fetch.chamadas[0].init.headers.Authorization).toBe(`Bearer ${CHAVE_FALSA}`);
    expect(JSON.parse(fetch.chamadas[0].init.body)).toEqual({
      p_user: UUID,
      p_id: CONVERSA,
      p_resposta: resposta,
      p_passos: passos,
      p_rodadas: 3,
      p_ms: 1234,
      p_chamadas: 2,
      p_desfecho: 'ok',
      p_codigo_erro: null,
    });
    // A chave não volta no resultado nem em nada que a tela veria.
    expect(JSON.stringify(r)).not.toContain(CHAVE_FALSA);
  });

  it('sem a chave de servidor o fechamento é pulado em silêncio (sem rede)', async () => {
    const fetch = fetchFalso(new Response(null, { status: 204 }));
    const r = await registrador(fetch, { serviceRoleKey: undefined }).concluir({
      user: UUID,
      id: CONVERSA,
      resposta: { texto: null, blocos: [] },
      passos: [],
      desfecho: 'ok',
    });

    expect(r).toEqual({ ok: false, pulado: true });
    expect(fetch.chamadas).toHaveLength(0);
  });

  it('sem p_user o fechamento também é pulado, sem rede', async () => {
    const fetch = fetchFalso(new Response(null, { status: 204 }));
    const r = await registrador(fetch).concluir({
      user: null,
      id: CONVERSA,
      resposta: { texto: null, blocos: [] },
      passos: [],
      desfecho: 'ok',
    });
    expect(r).toEqual({ ok: false, pulado: true });
    expect(fetch.chamadas).toHaveLength(0);
  });

  it('concluir falha é silenciosa (rede, HTTP e id inválido)', async () => {
    const resposta = { texto: null, blocos: [] };

    const rede = await registrador(
      fetchFalso(async () => {
        throw new TypeError('rede caiu');
      }),
    ).concluir({ user: UUID, id: CONVERSA, resposta, passos: [], desfecho: 'erro' });
    expect(rede).toEqual({ ok: false });

    const cancelar = vi.fn(() => Promise.resolve());
    const http = await registrador(
      fetchFalso(async () => ({ ok: false, status: 500, body: { cancel: cancelar } })),
    ).concluir({ user: UUID, id: CONVERSA, resposta, passos: [], desfecho: 'erro' });
    expect(http).toEqual({ ok: false });
    expect(cancelar).toHaveBeenCalledTimes(1);

    const fetch = fetchFalso(new Response(null, { status: 204 }));
    const invalido = await registrador(fetch).concluir({
      user: UUID,
      id: 'não é uuid',
      resposta,
      passos: [],
      desfecho: 'erro',
    });
    expect(invalido).toEqual({ ok: false, pulado: true });
    expect(fetch.chamadas).toHaveLength(0);
  });

  it('trunca resposta e passos acima de 240 KB com a marca { truncado: true }', async () => {
    const fetch = fetchFalso(new Response(null, { status: 204 }));
    const resposta = {
      texto: { texto: 'x'.repeat(300_000), semOrigem: [] },
      blocos: [{ id: 'b1', tipo: 'texto', texto: { texto: 'y'.repeat(1_000) } }],
    };
    const passos = [
      {
        ferramenta: 'listar_centros',
        argumentos: { texto: 'a'.repeat(300_000) },
        estado: 'fim',
      },
    ];

    const r = await registrador(fetch).concluir({
      user: UUID,
      id: CONVERSA,
      resposta,
      passos,
      rodadas: 1,
      ms: 1,
      chamadas: 1,
      desfecho: 'ok',
    });

    expect(r).toEqual({ ok: true });
    const corpo = JSON.parse(fetch.chamadas[0].init.body);
    expect(corpo.p_resposta.truncado).toBe(true);
    expect(corpo.p_passos).toEqual([{ truncado: true }]);
    expect(Buffer.byteLength(JSON.stringify(corpo.p_resposta), 'utf8')).toBeLessThan(262144);
    expect(Buffer.byteLength(JSON.stringify(corpo.p_passos), 'utf8')).toBeLessThan(262144);
  });

  it('não loga nada e nunca devolve a chave de servidor', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = fetchFalso(new Response(null, { status: 204 }));
    const r = await registrador(fetch).concluir({
      user: UUID,
      id: CONVERSA,
      resposta: { texto: { texto: 'segredo?', semOrigem: [] }, blocos: [] },
      passos: [],
      desfecho: 'ok',
    });

    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain(CHAVE_FALSA);
    expect(JSON.stringify(JSON.parse(fetch.chamadas[0].init.body))).not.toContain(CHAVE_FALSA);
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });
});
