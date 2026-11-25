import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const pacote = vi.hoisted(() => ({
  criarSessao: vi.fn(),
  especificacoes: vi.fn(),
  INSTRUCOES: 'INSTRUÇÕES DE TESTE',
}));

// O pacote `shared/ai-tools` é do outro executor e ainda não existe nesta
// branch. O `index.js` é testado só com ele mockado; os outros módulos são
// testados direto, com sessão falsa.
vi.mock('../../shared/ai-tools/index.js', () => pacote);

import worker from '../src/index.js';
import { chaveUso, diaBrasilia } from '../src/limite.js';

const ORIGEM = 'https://lapig-financeiro.github.io';

const ENV = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'chave-publica',
  ANALISE_MODELO: 'modelo-teste',
  ANALISE_PAPEIS: 'admin',
  ANALISE_LIMITE_DIA: '50',
  OLLAMA_API_KEY: 'segredo-de-teste',
};

const TOOLS = [{ type: 'function', function: { name: 'listar_centros' } }];

function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function kvFalsa(inicial = {}) {
  const mapa = new Map(Object.entries(inicial));
  return {
    mapa,
    async get(chave) {
      return mapa.has(chave) ? mapa.get(chave) : null;
    },
    async put(chave, valor) {
      mapa.set(chave, valor);
    },
  };
}

function fetchAmbiente({
  usuario = { id: 'u1', email: 'admin@lapig' },
  statusUsuario = 200,
  papel = 'admin',
  rpc,
  ollama = [],
  statusOllama = 200,
  corpoOllama,
  ollamaResposta,
  ollamaPendente,
} = {}) {
  const chamadas = [];
  const fila = ollama.slice();
  const fn = async (url, init = {}) => {
    chamadas.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      if (statusUsuario !== 200) return new Response('', { status: statusUsuario });
      return json(usuario);
    }
    if (url.includes('/rest/v1/app_users')) return json([{ role: papel }]);
    if (url.includes('/rest/v1/rpc/')) {
      if (typeof rpc === 'function') return rpc(url, init);
      return json({ ok: true });
    }
    if (url === 'https://ollama.com/api/chat') {
      if (statusOllama !== 200) return new Response('', { status: statusOllama });
      if (ollamaPendente) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      }
      if (ollamaResposta !== undefined) return ollamaResposta;
      if (corpoOllama !== undefined) {
        return typeof corpoOllama === 'string'
          ? new Response(corpoOllama, { status: 200 })
          : json(corpoOllama);
      }
      if (!fila.length) throw new Error('fila do Ollama vazia no teste');
      return json(fila.shift());
    }
    throw new Error(`URL inesperada no teste: ${url}`);
  };
  fn.chamadas = chamadas;
  return fn;
}

function sessaoFalsa(opcoes = {}) {
  const chamadas = { executar: [], criarBloco: [], calcular: [], marcarTexto: [], reidratar: [] };
  const sessao = {
    async executar(nome, args) {
      chamadas.executar.push({ nome, args });
      return opcoes.executar
        ? opcoes.executar(nome, args)
        : { id: 'r1', paraModelo: '{"ok":true}' };
    },
    async criarBloco(args) {
      chamadas.criarBloco.push(args);
      return opcoes.criarBloco
        ? opcoes.criarBloco(args)
        : { bloco: { id: 'b1', tipo: 'numero', titulo: 'Livre' } };
    },
    async calcular(args) {
      chamadas.calcular.push(args);
      return opcoes.calcular ? opcoes.calcular(args) : { id: 'c1', paraModelo: '{"total":1}' };
    },
    async marcarTexto(texto) {
      chamadas.marcarTexto.push(texto);
      return opcoes.marcarTexto ? opcoes.marcarTexto(texto) : { texto, semOrigem: [] };
    },
    async reidratar(bloco) {
      chamadas.reidratar.push(bloco);
      return opcoes.reidratar ? opcoes.reidratar(bloco) : bloco;
    },
  };
  return { sessao, chamadas };
}

function eventos(texto) {
  return String(texto || '')
    .split('\n\n')
    .filter(Boolean)
    .map((bloco) => {
      const linhas = bloco.split('\n');
      const nome = linhas.find((l) => l.startsWith('event: '))?.slice(7);
      const dados = JSON.parse(linhas.find((l) => l.startsWith('data: '))?.slice(6) ?? 'null');
      return { nome, dados };
    });
}

const chamada = (nome, args = {}) => ({ function: { name: nome, arguments: args } });

let kv;
let sessaoPadrao;

beforeEach(() => {
  kv = kvFalsa();
  sessaoPadrao = sessaoFalsa();
  pacote.criarSessao.mockReset();
  pacote.criarSessao.mockReturnValue(sessaoPadrao.sessao);
  pacote.especificacoes.mockReset();
  pacote.especificacoes.mockReturnValue(TOOLS);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function chamarWorker({
  corpo,
  corpoBruto,
  corpoStream,
  metodo = 'POST',
  caminho = '/analise',
  jwt = 'jwt-bom',
  origem = ORIGEM,
  env = {},
  fetchFalso,
  sinalRequisicao,
} = {}) {
  const dublê = fetchFalso ?? fetchAmbiente();
  vi.stubGlobal('fetch', dublê);

  const ctx = {
    promessas: [],
    waitUntil(promessa) {
      this.promessas.push(promessa);
    },
  };

  const headers = {};
  if (corpo !== undefined || corpoBruto !== undefined || corpoStream !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (origem) headers.Origin = origem;

  let body;
  if (metodo === 'POST') {
    if (corpoStream !== undefined) body = corpoStream;
    else if (corpoBruto !== undefined) body = corpoBruto;
    else body = JSON.stringify(corpo ?? {});
  }

  const init = { method: metodo, headers, body };
  if (corpoStream !== undefined) init.duplex = 'half';
  if (sinalRequisicao) init.signal = sinalRequisicao;

  const request = new Request(`https://worker.local${caminho}`, init);

  const resposta = await worker.fetch(request, { ...ENV, ANALISE_USO: kv, ...env }, ctx);

  let texto = null;
  const tipo = resposta.headers.get('Content-Type') || '';
  if (tipo.includes('text/event-stream')) {
    // Começa a ler ANTES de esperar a tarefa: o TransformStream tem
    // contrapressão e o laço travaria na segunda escrita sem leitor.
    const leitura = resposta.text();
    await Promise.all(ctx.promessas);
    texto = await leitura;
  }

  return { resposta, texto, ctx, fetchFalso: dublê };
}

describe('rotas e CORS', () => {
  it('GET /saude responde ok com a origem permitida', async () => {
    const { resposta } = await chamarWorker({ metodo: 'GET', caminho: '/saude' });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true });
    expect(resposta.headers.get('Access-Control-Allow-Origin')).toBe(ORIGEM);
    expect(resposta.headers.get('Vary')).toBe('Origin');
  });

  it('origem fora da lista é recusada sem autenticar', async () => {
    const fetchFalso = fetchAmbiente();
    const { resposta } = await chamarWorker({
      metodo: 'GET',
      caminho: '/saude',
      origem: 'https://evil.example',
      fetchFalso,
    });
    expect(resposta.status).toBe(403);
    expect(resposta.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(fetchFalso.chamadas).toHaveLength(0);
  });

  it('OPTIONS responde 204 com CORS e sem autenticar', async () => {
    const fetchFalso = fetchAmbiente();
    const { resposta } = await chamarWorker({
      metodo: 'OPTIONS',
      caminho: '/analise',
      jwt: null,
      fetchFalso,
    });
    expect(resposta.status).toBe(204);
    expect(resposta.headers.get('Access-Control-Allow-Origin')).toBe(ORIGEM);
    expect(resposta.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(resposta.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect(fetchFalso.chamadas).toHaveLength(0);
  });

  it('OPTIONS de origem recusada responde 403', async () => {
    const { resposta } = await chamarWorker({
      metodo: 'OPTIONS',
      caminho: '/analise',
      jwt: null,
      origem: 'http://192.168.0.10:5173',
    });
    expect(resposta.status).toBe(403);
    expect(resposta.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('localhost com porta é aceito', async () => {
    const { resposta } = await chamarWorker({
      metodo: 'GET',
      caminho: '/saude',
      origem: 'http://localhost:5173',
    });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('rota desconhecida é 404', async () => {
    const { resposta } = await chamarWorker({ metodo: 'GET', caminho: '/nada' });
    expect(resposta.status).toBe(404);
  });
});

describe('autenticação no /analise', () => {
  it('sem Authorization emite erro sem_login e não chama Supabase nem Ollama', async () => {
    const fetchFalso = fetchAmbiente();
    const { resposta, texto } = await chamarWorker({
      corpo: { pergunta: 'x' },
      jwt: null,
      fetchFalso,
    });

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('Content-Type')).toContain('text/event-stream');
    expect(eventos(texto)).toEqual([
      { nome: 'erro', dados: { codigo: 'sem_login', mensagem: expect.any(String) } },
    ]);
    expect(fetchFalso.chamadas).toHaveLength(0);
  });

  it('JWT inválido emite sem_login e não chama o modelo', async () => {
    const fetchFalso = fetchAmbiente({ statusUsuario: 401 });
    const { texto } = await chamarWorker({ corpo: { pergunta: 'x' }, fetchFalso });

    expect(eventos(texto)[0]).toMatchObject({ nome: 'erro', dados: { codigo: 'sem_login' } });
    expect(fetchFalso.chamadas.filter((c) => c.url.includes('ollama'))).toHaveLength(0);
  });

  it('professor é recusado com sem_permissao', async () => {
    const fetchFalso = fetchAmbiente({ papel: 'professor' });
    const { texto } = await chamarWorker({ corpo: { pergunta: 'x' }, fetchFalso });

    expect(eventos(texto)[0]).toMatchObject({
      nome: 'erro',
      dados: { codigo: 'sem_permissao' },
    });
    expect(fetchFalso.chamadas.filter((c) => c.url.includes('ollama'))).toHaveLength(0);
  });

  it('admin passa e a sessão recebe o JWT de quem pediu', async () => {
    const sessao = sessaoFalsa();
    pacote.criarSessao.mockReturnValue(sessao.sessao);
    const fetchFalso = fetchAmbiente({
      ollama: [{ message: { role: 'assistant', content: 'Pronto.' } }],
    });

    const { texto } = await chamarWorker({
      corpo: { pergunta: 'Quanto o 30.109 tem livre?' },
      fetchFalso,
    });

    expect(eventos(texto).map((e) => e.nome)).toEqual(['texto', 'fim']);
    expect(eventos(texto)[0].dados.texto).toBe('Pronto.');

    const pedidoOllama = fetchFalso.chamadas.find((c) => c.url === 'https://ollama.com/api/chat');
    const corpoOllama = JSON.parse(pedidoOllama.init.body);
    expect(corpoOllama).toMatchObject({ model: 'modelo-teste', think: 'high', stream: false });
    expect(corpoOllama.tools).toEqual(TOOLS);
    expect(corpoOllama.messages[0].content).toContain('INSTRUÇÕES DE TESTE');
    expect(corpoOllama.messages[0].content).toContain('Hoje é');
    expect(corpoOllama.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Quanto o 30.109 tem livre?',
    });
    expect(pedidoOllama.init.headers.Authorization).toBe('Bearer segredo-de-teste');

    const contexto = pacote.criarSessao.mock.calls[0][0];
    expect(contexto.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const r = await contexto.rpc('resumo_projetos_v2', {});
    expect(r.error).toBeNull();
    const chamadaRpc = fetchFalso.chamadas.find((c) => c.url.includes('/rest/v1/rpc/'));
    expect(chamadaRpc.init.headers.Authorization).toBe('Bearer jwt-bom');
    expect(chamadaRpc.init.headers.apikey).toBe('chave-publica');
  });

  it('ignora user_id do corpo: o id é o do /auth/v1/user', async () => {
    const fetchFalso = fetchAmbiente({
      ollama: [{ message: { role: 'assistant', content: 'ok' } }],
    });

    await chamarWorker({
      corpo: { pergunta: 'x', user_id: 'outro-usuario' },
      fetchFalso,
    });

    const dia = diaBrasilia();
    expect(kv.mapa.has(chaveUso('u1', dia))).toBe(true);
    expect(kv.mapa.has(chaveUso('outro-usuario', dia))).toBe(false);
    expect(pacote.criarSessao).toHaveBeenCalledTimes(1);
  });
});

describe('limite diário no fluxo', () => {
  it('a 50ª passa e grava 50', async () => {
    const dia = diaBrasilia();
    kv = kvFalsa({ [chaveUso('u1', dia)]: '49' });
    const fetchFalso = fetchAmbiente({
      ollama: [{ message: { role: 'assistant', content: 'ok' } }],
    });

    const { texto } = await chamarWorker({ corpo: { pergunta: 'x' }, fetchFalso });

    expect(eventos(texto).some((e) => e.dados?.codigo === 'limite')).toBe(false);
    expect(kv.mapa.get(chaveUso('u1', dia))).toBe('50');
    expect(fetchFalso.chamadas.some((c) => c.url.includes('ollama'))).toBe(true);
  });

  it('a 51ª é recusada antes de chamar o modelo', async () => {
    const dia = diaBrasilia();
    kv = kvFalsa({ [chaveUso('u1', dia)]: '50' });
    const fetchFalso = fetchAmbiente();

    const { texto } = await chamarWorker({ corpo: { pergunta: 'x' }, fetchFalso });

    expect(eventos(texto)).toEqual([
      { nome: 'erro', dados: { codigo: 'limite', mensagem: expect.any(String) } },
    ]);
    expect(fetchFalso.chamadas.some((c) => c.url.includes('ollama'))).toBe(false);
    expect(kv.mapa.get(chaveUso('u1', dia))).toBe('50');
  });

  it('respeita ANALISE_LIMITE_DIA', async () => {
    const dia = diaBrasilia();
    kv = kvFalsa({ [chaveUso('u1', dia)]: '10' });
    const fetchFalso = fetchAmbiente();

    const { texto } = await chamarWorker({
      corpo: { pergunta: 'x' },
      env: { ANALISE_LIMITE_DIA: '10' },
      fetchFalso,
    });

    expect(eventos(texto)[0]).toMatchObject({ nome: 'erro', dados: { codigo: 'limite' } });
    expect(fetchFalso.chamadas.some((c) => c.url.includes('ollama'))).toBe(false);
  });
});

describe('fluxo do modelo', () => {
  it('resposta é SSE, sem cache, e o laço é segurado por waitUntil', async () => {
    const fetchFalso = fetchAmbiente({
      ollama: [{ message: { role: 'assistant', content: 'ok' } }],
    });
    const { resposta, ctx } = await chamarWorker({ corpo: { pergunta: 'x' }, fetchFalso });

    expect(resposta.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(resposta.headers.get('Cache-Control')).toBe('no-store');
    expect(resposta.headers.get('Access-Control-Allow-Origin')).toBe(ORIGEM);
    expect(ctx.promessas).toHaveLength(1);
  });

  it('Ollama 500 vira erro modelo e fim', async () => {
    const fetchFalso = fetchAmbiente({ statusOllama: 500 });
    const { texto } = await chamarWorker({ corpo: { pergunta: 'x' }, fetchFalso });
    expect(eventos(texto).map((e) => e.nome)).toEqual(['erro', 'fim']);
    expect(eventos(texto)[0].dados.codigo).toBe('modelo');
  });

  it('Ollama com JSON inválido vira erro modelo', async () => {
    const fetchFalso = fetchAmbiente({ corpoOllama: '<html>fora do ar</html>' });
    const { texto } = await chamarWorker({ corpo: { pergunta: 'x' }, fetchFalso });
    expect(eventos(texto)[0]).toMatchObject({ nome: 'erro', dados: { codigo: 'modelo' } });
  });

  it('Ollama sem message vira erro modelo', async () => {
    const fetchFalso = fetchAmbiente({ corpoOllama: { done: true } });
    const { texto } = await chamarWorker({ corpo: { pergunta: 'x' }, fetchFalso });
    expect(eventos(texto)[0]).toMatchObject({ nome: 'erro', dados: { codigo: 'modelo' } });
  });
});

describe('validação do corpo', () => {
  it('sem pergunta é 400 antes de abrir o stream', async () => {
    const fetchFalso = fetchAmbiente();
    const { resposta } = await chamarWorker({ corpo: {}, fetchFalso });
    expect(resposta.status).toBe(400);
    expect(resposta.headers.get('Content-Type')).toContain('application/json');
    expect(fetchFalso.chamadas).toHaveLength(0);
  });

  it('pergunta vazia é 400', async () => {
    const { resposta } = await chamarWorker({ corpo: { pergunta: '   ' } });
    expect(resposta.status).toBe(400);
  });

  it('pergunta acima de 2.000 caracteres é 400', async () => {
    const { resposta } = await chamarWorker({ corpo: { pergunta: 'a'.repeat(2_001) } });
    expect(resposta.status).toBe(400);
  });

  it('mais de 5 anteriores é 400', async () => {
    const anteriores = Array.from({ length: 6 }, () => ({ pergunta: 'p', resumo: 'r' }));
    const { resposta } = await chamarWorker({ corpo: { pergunta: 'x', anteriores } });
    expect(resposta.status).toBe(400);
  });

  it('JSON quebrado é 400', async () => {
    const { resposta } = await chamarWorker({ corpoBruto: '{quebrado' });
    expect(resposta.status).toBe(400);
  });
});

describe('2ª rodada: corpo, prazo e cancelamento', () => {
  function contextoFalso() {
    return {
      promessas: [],
      waitUntil(promessa) {
        this.promessas.push(promessa);
      },
    };
  }

  function requisicaoAnalise({ corpo = { pergunta: 'x' }, sinal } = {}) {
    return new Request('https://worker.local/analise', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt-bom',
        Origin: ORIGEM,
      },
      body: JSON.stringify(corpo),
      signal: sinal,
    });
  }

  it('corpo acima de 100.000 bytes em stream é 413 antes de desserializar', async () => {
    const fetchFalso = fetchAmbiente();
    const fluxo = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"pergunta":"'));
        controller.enqueue(new TextEncoder().encode('a'.repeat(120_000)));
        // Sem fechar o JSON: se o código tentasse desserializar, seria 400.
        controller.close();
      },
    });

    const { resposta } = await chamarWorker({ corpoStream: fluxo, fetchFalso });

    expect(resposta.status).toBe(413);
    expect(await resposta.json()).toMatchObject({
      erro: expect.stringContaining('100.000'),
    });
    expect(fetchFalso.chamadas).toHaveLength(0);
  });

  it('fecha o stream com erro tempo e fim mesmo com a sessão pendurada', async () => {
    vi.useFakeTimers();
    try {
      const sessao = sessaoFalsa();
      sessao.sessao.executar = () => new Promise(() => {});
      pacote.criarSessao.mockReturnValue(sessao.sessao);

      const fetchFalso = fetchAmbiente({
        ollama: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [chamada('listar_centros')],
            },
          },
        ],
      });
      vi.stubGlobal('fetch', fetchFalso);

      const ctx = contextoFalso();
      const resposta = await worker.fetch(
        requisicaoAnalise(),
        { ...ENV, ANALISE_USO: kv },
        ctx,
      );
      const leitura = resposta.text();

      await vi.advanceTimersByTimeAsync(120_001);

      const texto = await leitura;
      const ev = eventos(texto);
      expect(ev.map((e) => e.nome)).toEqual(['passo', 'erro', 'fim']);
      expect(ev[1].dados.codigo).toBe('tempo');
      expect(ev[2].dados.rodadas).toBe(1);
      expect(ev[2].dados.ms).toBeGreaterThanOrEqual(120_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('desconectar durante a chamada ao modelo aborta o fetch e encerra o laço', async () => {
    const controle = new AbortController();
    const fetchFalso = fetchAmbiente({ ollamaPendente: true });
    vi.stubGlobal('fetch', fetchFalso);

    const ctx = contextoFalso();
    const resposta = await worker.fetch(
      requisicaoAnalise({ sinal: controle.signal }),
      { ...ENV, ANALISE_USO: kv },
      ctx,
    );
    const leitura = resposta.text();

    await vi.waitFor(() => {
      expect(
        fetchFalso.chamadas.some((c) => c.url === 'https://ollama.com/api/chat'),
      ).toBe(true);
    });
    controle.abort();

    const texto = await leitura;
    await Promise.all(ctx.promessas);

    expect(texto).toBe('');
    const pedido = fetchFalso.chamadas.find(
      (c) => c.url === 'https://ollama.com/api/chat',
    );
    expect(pedido.init.signal.aborted).toBe(true);
  });

  it('desconectar durante uma RPC aborta o fetch e encerra o laço', async () => {
    const controle = new AbortController();
    let contexto;
    const sessao = sessaoFalsa();
    sessao.sessao.executar = async (nome, args) => {
      const r = await contexto.rpc(nome, args);
      return r.error
        ? { id: 'r1', erro: r.error.mensagem }
        : { id: 'r1', paraModelo: JSON.stringify(r.data) };
    };
    pacote.criarSessao.mockImplementation((ctx) => {
      contexto = ctx;
      return sessao.sessao;
    });

    const fetchFalso = fetchAmbiente({
      ollama: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [chamada('listar_centros')],
          },
        },
      ],
      rpc: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    });
    vi.stubGlobal('fetch', fetchFalso);

    const ctx = contextoFalso();
    const resposta = await worker.fetch(
      requisicaoAnalise({ sinal: controle.signal }),
      { ...ENV, ANALISE_USO: kv },
      ctx,
    );
    const leitura = resposta.text();

    await vi.waitFor(() => {
      expect(fetchFalso.chamadas.some((c) => c.url.includes('/rest/v1/rpc/'))).toBe(true);
    });
    controle.abort();

    const texto = await leitura;
    await Promise.all(ctx.promessas);

    const ev = eventos(texto);
    expect(ev.map((e) => e.nome)).toEqual(['passo']);
    expect(ev[0].dados).toMatchObject({ ferramenta: 'listar_centros', estado: 'inicio' });
    const chamadaRpc = fetchFalso.chamadas.find((c) => c.url.includes('/rest/v1/rpc/'));
    expect(chamadaRpc.init.signal.aborted).toBe(true);
  });

  it('Ollama com corpo vazio vira erro modelo', async () => {
    const fetchFalso = fetchAmbiente({ corpoOllama: '' });
    const { texto } = await chamarWorker({ corpo: { pergunta: 'x' }, fetchFalso });
    expect(eventos(texto).map((e) => e.nome)).toEqual(['erro', 'fim']);
    expect(eventos(texto)[0].dados.codigo).toBe('modelo');
  });

  it('Ollama com corpo interrompido vira erro modelo', async () => {
    const fetchFalso = fetchAmbiente({
      ollamaResposta: {
        ok: true,
        status: 200,
        text: async () => {
          throw new TypeError('terminated');
        },
      },
    });
    const { texto } = await chamarWorker({ corpo: { pergunta: 'x' }, fetchFalso });
    expect(eventos(texto)[0]).toMatchObject({ nome: 'erro', dados: { codigo: 'modelo' } });
  });
});

describe('nenhum conteúdo no console', () => {
  it('pergunta, argumentos, resultado, bloco e texto não aparecem em console.*', async () => {
    const espioes = ['log', 'info', 'warn', 'error', 'debug'].map((metodo) =>
      vi.spyOn(console, metodo).mockImplementation(() => {}),
    );

    try {
      pacote.criarSessao.mockReturnValue(
        sessaoFalsa({
          executar: () => ({ id: 'r1', paraModelo: '{"dado":"RESULTADO-SECRETO"}' }),
          criarBloco: () => ({ bloco: { id: 'b1', titulo: 'BLOCO-SECRETO' } }),
          marcarTexto: (t) => ({ texto: t, semOrigem: [] }),
        }).sessao,
      );

      const fetchFalso = fetchAmbiente({
        ollama: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [chamada('listar_centros', { q: 'ARGUMENTO-SECRETO' })],
            },
          },
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [chamada('criar_bloco', { titulo: 'BLOCO-SECRETO' })],
            },
          },
          { message: { role: 'assistant', content: 'TEXTO-SECRETO' } },
        ],
      });

      const { texto } = await chamarWorker({
        corpo: { pergunta: 'PERGUNTA-SECRETA' },
        fetchFalso,
      });
      expect(eventos(texto).some((e) => e.nome === 'erro')).toBe(false);

      const tudo = espioes
        .flatMap((espiao) => espiao.mock.calls)
        .flat()
        .map((valor) => {
          if (typeof valor === 'string') return valor;
          try {
            return JSON.stringify(valor);
          } catch {
            return String(valor);
          }
        })
        .join('\n');

      for (const segredo of [
        'PERGUNTA-SECRETA',
        'ARGUMENTO-SECRETO',
        'RESULTADO-SECRETO',
        'BLOCO-SECRETO',
        'TEXTO-SECRETO',
      ]) {
        expect(tudo).not.toContain(segredo);
      }
    } finally {
      for (const espiao of espioes) espiao.mockRestore();
    }
  });
});
