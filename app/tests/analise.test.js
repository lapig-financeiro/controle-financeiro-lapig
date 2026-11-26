import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, rpcMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock('../src/servicos/supabase.js', () => ({
  SUPABASE_URL: 'https://exemplo.supabase.co',
  SUPABASE_KEY: 'chave-publica',
  supabase: {
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
  },
}));

import {
  MENSAGEM_INTERROMPIDA,
  URL_EDGE_ANALISE,
  enviarFeedback,
  executarAnalise,
} from '../src/servicos/analise.js';

const codificador = new TextEncoder();

function bytes(texto) {
  return codificador.encode(texto);
}

/** Um evento SSE no formato do servidor (`worker/src/sse.js`). */
function evento(nome, dados) {
  return `event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`;
}

function respostaSse(pedacos) {
  const stream = new ReadableStream({
    start(controller) {
      for (const pedaco of pedacos) {
        controller.enqueue(typeof pedaco === 'string' ? bytes(pedaco) : pedaco);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

function respostaComFalha(pedacos) {
  let indice = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (indice < pedacos.length) {
        const pedaco = pedacos[indice];
        indice += 1;
        controller.enqueue(typeof pedaco === 'string' ? bytes(pedaco) : pedaco);
        return;
      }
      controller.error(new Error('a rede caiu'));
    },
  });
  return new Response(stream, { status: 200 });
}

/** Fatia a string em bytes para quebrar eventos e caracteres UTF-8 no meio. */
function fatiasDeBytes(texto, tamanho) {
  const todos = bytes(texto);
  const fatias = [];
  for (let inicio = 0; inicio < todos.length; inicio += tamanho) {
    fatias.push(todos.slice(inicio, inicio + tamanho));
  }
  return fatias;
}

const BLOCO = {
  id: 'b1',
  tipo: 'numero',
  titulo: 'Livre do 30.109',
  numero: {
    valor: 12345.67,
    unidade: 'moeda',
    rotulo: 'Livre — Pessoal (30.109)',
    origem: { tipo: 'sem_documento', motivo: 'teste', consulta: 'explicar_livre_v2' },
    contexto: null,
  },
};

const TEXTO = {
  texto: 'O livre do 30.109 é R$ 12.345,67; veja a análise acima.',
  semOrigem: [],
};

const PASSO = {
  ferramenta: 'listar_centros',
  rotulo: 'consultando os centros',
  estado: 'inicio',
};

beforeEach(() => {
  getSessionMock.mockReset();
  rpcMock.mockReset();
});

describe('executarAnalise — stream SSE', () => {
  it('lê o stream completo quebrado em chunks, com \r\n, ping, evento desconhecido e data multilinha', async () => {
    const fluxo =
      'event: inicio\r\ndata: {"registro":"reg-1"}\r\n\r\n' +
      ': ping\n\n' +
      evento('passo', PASSO) +
      evento('futuro', { algo: 'de uma versão nova' }) +
      evento('bloco', BLOCO) +
      // JSON válido dividido em duas linhas `data:` (o parser junta com \n).
      `event: texto\ndata: {"texto":"${TEXTO.texto}",\ndata: "semOrigem":[]}\n\n` +
      evento('fim', { rodadas: 2, ms: 1234 });

    // 7 bytes por chunk: quebra no meio de eventos e de caracteres (é, ç, —).
    const fetchImpl = vi.fn(async () => respostaSse(fatiasDeBytes(fluxo, 7)));
    const onInicio = vi.fn();
    const onPasso = vi.fn();
    const onBloco = vi.fn();
    const onTexto = vi.fn();
    const onFim = vi.fn();
    const onErro = vi.fn();

    const resultado = await executarAnalise({
      pergunta: 'Quanto o 30.109 tem livre?',
      token: 'jwt-1',
      fetchImpl,
      onInicio,
      onPasso,
      onBloco,
      onTexto,
      onFim,
      onErro,
    });

    expect(getSessionMock).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [chamadaUrl, init] = fetchImpl.mock.calls[0];
    expect(chamadaUrl).toBe(URL_EDGE_ANALISE);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer jwt-1',
      apikey: 'chave-publica',
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    });
    expect(JSON.parse(init.body)).toEqual({
      pergunta: 'Quanto o 30.109 tem livre?',
      anteriores: [],
    });
    expect(init.signal).toBeUndefined();

    expect(onInicio).toHaveBeenCalledTimes(1);
    expect(onInicio).toHaveBeenCalledWith({ registro: 'reg-1' });
    expect(onPasso).toHaveBeenCalledWith(PASSO);
    expect(onBloco).toHaveBeenCalledWith(BLOCO);
    expect(onTexto).toHaveBeenCalledWith(TEXTO);
    expect(onFim).toHaveBeenCalledWith({ rodadas: 2, ms: 1234 });
    expect(onErro).not.toHaveBeenCalled();

    expect(resultado).toEqual({
      ok: true,
      erro: null,
      registro: 'reg-1',
      blocos: [BLOCO],
      texto: TEXTO,
      fim: { rodadas: 2, ms: 1234 },
    });
  });

  it('stream que fecha sem `fim` emite interrompida e preserva registro, blocos e texto', async () => {
    const fluxo =
      evento('inicio', { registro: 'reg-2' }) +
      evento('passo', PASSO) +
      evento('bloco', BLOCO) +
      evento('texto', TEXTO);
    const fetchImpl = vi.fn(async () => respostaSse([fluxo]));
    const onErro = vi.fn();
    const onFim = vi.fn();
    const onBloco = vi.fn();

    const resultado = await executarAnalise({
      pergunta: 'Quanto o 30.109 tem livre?',
      token: 'jwt-1',
      fetchImpl,
      onErro,
      onFim,
      onBloco,
    });

    expect(MENSAGEM_INTERROMPIDA).toBe(
      'A análise foi interrompida pelo servidor antes de terminar. O que chegou até aqui está abaixo, incompleto. Tente de novo ou faça uma pergunta mais específica.'
    );
    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro).toHaveBeenCalledWith({
      codigo: 'interrompida',
      mensagem: MENSAGEM_INTERROMPIDA,
    });
    expect(onFim).not.toHaveBeenCalled();
    expect(onBloco).toHaveBeenCalledWith(BLOCO);

    expect(resultado).toEqual({
      ok: false,
      interrompida: true,
      erro: { codigo: 'interrompida', mensagem: MENSAGEM_INTERROMPIDA },
      registro: 'reg-2',
      blocos: [BLOCO],
      texto: TEXTO,
    });
  });

  it('falha de leitura no meio do stream também vira interrompida, sem perder o que chegou', async () => {
    const fluxo = evento('inicio', { registro: 'reg-3' }) + evento('bloco', BLOCO);
    const fetchImpl = vi.fn(async () => respostaComFalha([fluxo]));
    const onErro = vi.fn();

    const resultado = await executarAnalise({
      pergunta: 'Quanto o 30.109 tem livre?',
      token: 'jwt-1',
      fetchImpl,
      onErro,
    });

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro).toHaveBeenCalledWith({
      codigo: 'interrompida',
      mensagem: MENSAGEM_INTERROMPIDA,
    });
    expect(resultado).toMatchObject({
      ok: false,
      interrompida: true,
      registro: 'reg-3',
      blocos: [BLOCO],
    });
  });

  it('erro + fim do servidor não emite interrompida', async () => {
    const erroServidor = {
      codigo: 'tempo',
      mensagem: 'A análise passou do tempo limite. Tente uma pergunta mais específica.',
    };
    const fluxo =
      evento('inicio', { registro: 'reg-4' }) +
      evento('erro', erroServidor) +
      evento('fim', { rodadas: 1, ms: 61000 });
    const fetchImpl = vi.fn(async () => respostaSse([fluxo]));
    const onErro = vi.fn();
    const onFim = vi.fn();

    const resultado = await executarAnalise({
      pergunta: 'Quanto o 30.109 tem livre?',
      token: 'jwt-1',
      fetchImpl,
      onErro,
      onFim,
    });

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro).toHaveBeenCalledWith(erroServidor);
    expect(onFim).toHaveBeenCalledWith({ rodadas: 1, ms: 61000 });
    expect(resultado).toEqual({
      ok: false,
      erro: erroServidor,
      registro: 'reg-4',
      blocos: [],
      texto: null,
    });
    expect(resultado.interrompida).toBeUndefined();
  });

  it('ignora comentário `: ping` no meio do stream', async () => {
    const fluxo =
      ': ping\n\n' +
      evento('inicio', { registro: 'reg-5' }) +
      ': sinal de vida\n\n' +
      evento('fim', { rodadas: 0, ms: 10 });
    const fetchImpl = vi.fn(async () => respostaSse([fluxo]));
    const onInicio = vi.fn();
    const onFim = vi.fn();
    const onErro = vi.fn();

    const resultado = await executarAnalise({
      pergunta: 'oi',
      token: 'jwt-1',
      fetchImpl,
      onInicio,
      onFim,
      onErro,
    });

    expect(onInicio).toHaveBeenCalledWith({ registro: 'reg-5' });
    expect(onFim).toHaveBeenCalledWith({ rodadas: 0, ms: 10 });
    expect(onErro).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(true);
  });

  it('ignora evento desconhecido sem erro e segue até o fim', async () => {
    const fluxo =
      evento('inicio', { registro: 'reg-6' }) +
      evento('futuro', { formato: 'novo' }) +
      evento('fim', { rodadas: 0, ms: 20 });
    const fetchImpl = vi.fn(async () => respostaSse([fluxo]));
    const onErro = vi.fn();
    const onFim = vi.fn();

    const resultado = await executarAnalise({
      pergunta: 'oi',
      token: 'jwt-1',
      fetchImpl,
      onErro,
      onFim,
    });

    expect(onErro).not.toHaveBeenCalled();
    expect(onFim).toHaveBeenCalledWith({ rodadas: 0, ms: 20 });
    expect(resultado.ok).toBe(true);
    expect(resultado.registro).toBe('reg-6');
  });

  it('aborto do chamador não emite interrompida e devolve o parcial', async () => {
    const abortador = new AbortController();
    let etapa = 0;
    const fluxo = new ReadableStream({
      pull(controller) {
        if (etapa === 0) {
          controller.enqueue(bytes(evento('inicio', { registro: 'reg-7' })));
          etapa = 1;
          return;
        }
        abortador.abort();
        controller.error(new Error('abortado pela pessoa'));
      },
    });
    const fetchImpl = vi.fn(async () => new Response(fluxo, { status: 200 }));
    const onInicio = vi.fn();
    const onErro = vi.fn();

    const resultado = await executarAnalise({
      pergunta: 'oi',
      token: 'jwt-1',
      fetchImpl,
      signal: abortador.signal,
      onInicio,
      onErro,
    });

    expect(onInicio).toHaveBeenCalledWith({ registro: 'reg-7' });
    expect(onErro).not.toHaveBeenCalled();
    expect(resultado).toEqual({
      ok: false,
      abortada: true,
      registro: 'reg-7',
      blocos: [],
      texto: null,
    });
  });

  it('sem token na sessão emite sem_login e não chama a rede', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    const fetchImpl = vi.fn();
    const onErro = vi.fn();

    const resultado = await executarAnalise({ pergunta: 'oi', fetchImpl, onErro });

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onErro).toHaveBeenCalledWith({
      codigo: 'sem_login',
      mensagem: 'Faça login para usar a Análise.',
    });
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toEqual({
      codigo: 'sem_login',
      mensagem: 'Faça login para usar a Análise.',
    });
  });

  it('usa o token da sessão quando não recebe um', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'jwt-sessao' } },
      error: null,
    });
    const fetchImpl = vi.fn(async () => respostaSse([evento('fim', { rodadas: 0, ms: 5 })]));

    const resultado = await executarAnalise({ pergunta: 'oi', fetchImpl });

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-sessao');
    expect(resultado.ok).toBe(true);
  });

  it('HTTP fora de 2xx vira erro coerente, sem lançar', async () => {
    const onErro = vi.fn();

    const semLogin = await executarAnalise({
      pergunta: 'oi',
      token: 'jwt-1',
      fetchImpl: vi.fn(async () => new Response('', { status: 401 })),
      onErro,
    });
    expect(onErro).toHaveBeenLastCalledWith({
      codigo: 'sem_login',
      mensagem: 'Faça login para usar a Análise.',
    });
    expect(semLogin).toMatchObject({ ok: false, registro: null, blocos: [], texto: null });

    const interno = await executarAnalise({
      pergunta: 'oi',
      token: 'jwt-1',
      fetchImpl: vi.fn(async () => new Response('', { status: 500 })),
      onErro,
    });
    expect(onErro).toHaveBeenLastCalledWith({
      codigo: 'interno',
      mensagem: 'A Análise não respondeu agora (HTTP 500). Tente de novo.',
    });
    expect(interno.ok).toBe(false);
  });

  it('resposta 2xx sem corpo legível emite erro interno, sem lançar', async () => {
    const onErro = vi.fn();

    const resultado = await executarAnalise({
      pergunta: 'oi',
      token: 'jwt-1',
      fetchImpl: vi.fn(async () => new Response(null, { status: 200 })),
      onErro,
    });

    expect(onErro).toHaveBeenCalledWith({
      codigo: 'interno',
      mensagem: 'A Análise respondeu sem corpo para ler. Tente de novo.',
    });
    expect(resultado).toMatchObject({ ok: false, registro: null, blocos: [], texto: null });

    // Corpo existente, mas já travado por outro leitor: também não lança.
    const travada = respostaSse([evento('fim', { rodadas: 0, ms: 5 })]);
    travada.body.getReader();
    const semLeitor = await executarAnalise({
      pergunta: 'oi',
      token: 'jwt-1',
      fetchImpl: vi.fn(async () => travada),
      onErro,
    });

    expect(onErro).toHaveBeenLastCalledWith({
      codigo: 'interno',
      mensagem: 'A Análise respondeu sem corpo para ler. Tente de novo.',
    });
    expect(semLeitor.ok).toBe(false);
  });

  it('falha de rede antes da resposta vira erro `rede`, sem lançar', async () => {
    const onErro = vi.fn();
    const resultado = await executarAnalise({
      pergunta: 'oi',
      token: 'jwt-1',
      fetchImpl: vi.fn(async () => {
        throw new Error('offline');
      }),
      onErro,
    });

    expect(onErro).toHaveBeenCalledWith({
      codigo: 'rede',
      mensagem: 'Não foi possível falar com a Análise. Verifique a conexão e tente de novo.',
    });
    expect(resultado.ok).toBe(false);
  });
});

describe('enviarFeedback', () => {
  it('chama a RPC com os parâmetros e devolve o id', async () => {
    const id = '6f1b0e5e-1f3a-4f1b-9b0e-2f4a1c3d5e6f';
    const rpc = vi.fn().mockResolvedValue({ data: id, error: null });

    const resultado = await enviarFeedback(
      'reg-1',
      { nota: 1, motivo: 'cortada', comentario: 'faltou o final' },
      { rpc }
    );

    expect(rpc).toHaveBeenCalledWith('analise_feedback_enviar', {
      p_registro_id: 'reg-1',
      p_nota: 1,
      p_motivo: 'cortada',
      p_comentario: 'faltou o final',
    });
    expect(resultado).toEqual({ id, erro: null });
  });

  it('usa supabase.rpc quando não recebe um injetado', async () => {
    rpcMock.mockResolvedValue({ data: 'uuid-2', error: null });

    const resultado = await enviarFeedback('reg-2', { comentario: 'ok' });

    expect(rpcMock).toHaveBeenCalledWith('analise_feedback_enviar', {
      p_registro_id: 'reg-2',
      p_nota: null,
      p_motivo: null,
      p_comentario: 'ok',
    });
    expect(resultado).toEqual({ id: 'uuid-2', erro: null });
  });

  it('devolve mensagem em falha da RPC e nunca lança', async () => {
    const rpcAcesso = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '42501', message: 'Acesso negado.' } });
    expect(await enviarFeedback('reg-1', { nota: -1 }, { rpc: rpcAcesso })).toEqual({
      id: null,
      erro: 'Acesso negado.',
    });

    const rpcGenerica = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX000', message: 'permission denied' } });
    expect(await enviarFeedback('reg-1', { nota: -1 }, { rpc: rpcGenerica })).toEqual({
      id: null,
      erro: 'Não foi possível enviar o feedback.',
    });

    const rpcLancando = vi.fn().mockRejectedValue(new Error('boom'));
    expect(await enviarFeedback('reg-1', { nota: -1 }, { rpc: rpcLancando })).toEqual({
      id: null,
      erro: 'Não foi possível enviar o feedback.',
    });
  });

  it('recusa registro vazio sem chamar a RPC', async () => {
    const rpc = vi.fn();

    expect(await enviarFeedback('', { nota: 1 }, { rpc })).toEqual({
      id: null,
      erro: 'Registro da análise não informado.',
    });
    expect(await enviarFeedback('   ', { nota: 1 }, { rpc })).toEqual({
      id: null,
      erro: 'Registro da análise não informado.',
    });
    expect(await enviarFeedback(null, { nota: 1 }, { rpc })).toEqual({
      id: null,
      erro: 'Registro da análise não informado.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
