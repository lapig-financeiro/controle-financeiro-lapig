import { describe, it, expect, beforeEach, vi } from 'vitest';

const pacote = vi.hoisted(() => ({
  criarSessao: vi.fn(),
  especificacoes: vi.fn(),
  INSTRUCOES: 'INSTRUÇÕES DE TESTE',
}));

vi.mock('../../shared/ai-tools/index.js', () => pacote);

const { tratar } = await import('../src/nucleo.js');

const ORIGEM = 'https://lapig-financeiro.github.io';
const ENV = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'chave-publica',
  ANALISE_MODELO: 'modelo-teste',
  ANALISE_PAPEIS: 'admin',
  OLLAMA_API_KEY: 'segredo',
};

function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchAmbiente() {
  return async (url) => {
    if (url.endsWith('/auth/v1/user')) return json({ id: 'u1', email: 'a@b' });
    if (url.includes('/rest/v1/app_users')) return json([{ role: 'admin' }]);
    if (url === 'https://ollama.com/api/chat') {
      return json({ message: { role: 'assistant', content: 'Pronto.' } });
    }
    throw new Error(`URL inesperada: ${url}`);
  };
}

function sessaoFalsa() {
  return {
    async executar() {
      return { id: 'r1', paraModelo: '{"ok":true}' };
    },
    async criarBloco() {
      return { bloco: { id: 'b1' } };
    },
    async calcular() {
      return { id: 'c1', paraModelo: '{}' };
    },
    async marcarTexto(texto) {
      return { texto, semOrigem: [] };
    },
    async reidratar(bloco) {
      return bloco;
    },
    async mascararEntrada(texto) {
      return texto;
    },
  };
}

function eventos(texto) {
  return String(texto ?? '')
    .split('\n\n')
    .filter(Boolean)
    .map((bloco) => {
      const linhas = bloco.split('\n');
      return {
        nome: linhas.find((l) => l.startsWith('event: '))?.slice(7),
        dados: JSON.parse(linhas.find((l) => l.startsWith('data: '))?.slice(6) ?? 'null'),
      };
    });
}

function pedido() {
  return new Request('https://servidor.local/analise', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-bom',
      Origin: ORIGEM,
    },
    body: JSON.stringify({ pergunta: 'Quanto o 30.109 tem livre?' }),
  });
}

function ctx() {
  return {
    promessas: [],
    waitUntil(promessa) {
      this.promessas.push(Promise.resolve(promessa));
    },
  };
}

const UUID_REGISTRO = '11111111-1111-4111-8111-111111111111';

function registradorFalso({ id = UUID_REGISTRO, iniciar } = {}) {
  const chamadas = { iniciar: [], concluir: [] };
  return {
    chamadas,
    async iniciar(args) {
      chamadas.iniciar.push(args);
      if (typeof iniciar === 'function') return iniciar(args);
      return { id };
    },
    async concluir(args) {
      chamadas.concluir.push(args);
      return { ok: true };
    },
  };
}

async function lerAteFechar(resposta) {
  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let texto = '';
  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      texto += decodificador.decode(value, { stream: true });
    }
  } catch {
    // Aborto proposital do stream na desconexão.
  }
  return texto + decodificador.decode();
}

function pedidoComSinal(sinal) {
  return new Request('https://servidor.local/analise', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-bom',
      Origin: ORIGEM,
    },
    body: JSON.stringify({ pergunta: 'Quanto o 30.109 tem livre?' }),
    signal: sinal,
  });
}

function contadorPermitido() {
  return {
    async consumir() {
      return { permitido: true, usado: 1, teto: 50, dia: '2026-11-25' };
    },
  };
}

beforeEach(() => {
  pacote.criarSessao.mockReset();
  pacote.criarSessao.mockReturnValue(sessaoFalsa());
  pacote.especificacoes.mockReset();
  pacote.especificacoes.mockReturnValue([]);
  vi.stubGlobal('fetch', fetchAmbiente());
});

describe('núcleo sem plataforma', () => {
  it('entrega ao contador o user_id do /auth/v1/user, o JWT, o prazo e o sinal', async () => {
    const recebido = [];
    const contador = {
      async consumir(args) {
        recebido.push(args);
        return { permitido: true, usado: 1, teto: 50, dia: '2026-11-25' };
      },
    };
    const c = ctx();

    const resposta = await tratar(pedido(), ENV, { contador, waitUntil: (p) => c.waitUntil(p) });
    const texto = await resposta.text();
    await Promise.all(c.promessas);

    expect(eventos(texto).map((e) => e.nome)).toEqual(['inicio', 'texto', 'fim']);
    expect(eventos(texto)[0].dados).toEqual({ registro: null });
    expect(recebido).toHaveLength(1);
    expect(recebido[0].userId).toBe('u1');
    expect(recebido[0].jwt).toBe('jwt-bom');
    expect(typeof recebido[0].prazo).toBe('number');
    expect(recebido[0].sinal).toBeInstanceOf(AbortSignal);
  });

  it('corpo da resposta HTTP de erro do modelo é cancelado (G7)', async () => {
    const cancelar = vi.fn(() => Promise.resolve());
    vi.stubGlobal('fetch', async (url, init) => {
      if (url.endsWith('/auth/v1/user')) return json({ id: 'u1', email: 'a@b' });
      if (url.includes('/rest/v1/app_users')) return json([{ role: 'admin' }]);
      if (url === 'https://ollama.com/api/chat') {
        return { ok: false, status: 500, body: { cancel: cancelar } };
      }
      return fetchAmbiente()(url, init);
    });
    const contador = {
      async consumir() {
        return { permitido: true, usado: 1, teto: 50, dia: '2026-11-25' };
      },
    };
    const c = ctx();

    const resposta = await tratar(pedido(), ENV, { contador, waitUntil: (p) => c.waitUntil(p) });
    const texto = await resposta.text();
    await Promise.all(c.promessas);

    const ev = eventos(texto);
    expect(ev.find((e) => e.nome === 'erro')).toMatchObject({
      dados: { codigo: 'modelo' },
    });
    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  it('sem contador emite erro interno e não chama o modelo', async () => {
    const chamadas = [];
    vi.stubGlobal('fetch', async (url, init) => {
      chamadas.push(url);
      return fetchAmbiente()(url, init);
    });
    const c = ctx();

    const resposta = await tratar(pedido(), ENV, { waitUntil: (p) => c.waitUntil(p) });
    const texto = await resposta.text();
    await Promise.all(c.promessas);

    const ev = eventos(texto);
    expect(ev.map((e) => e.nome)).toEqual(['erro', 'fim']);
    expect(ev[0].dados).toMatchObject({
      codigo: 'interno',
      mensagem: 'O limite de uso não está configurado no servidor.',
    });
    expect(chamadas.some((url) => url.includes('ollama'))).toBe(false);
  });

  it('contador que lança vira recusa interna, nunca permissão', async () => {
    const contador = {
      async consumir() {
        throw new Error('RPC caiu');
      },
    };
    const c = ctx();

    const resposta = await tratar(pedido(), ENV, { contador, waitUntil: (p) => c.waitUntil(p) });
    const texto = await resposta.text();
    await Promise.all(c.promessas);

    const ev = eventos(texto);
    expect(ev[0]).toMatchObject({ nome: 'erro', dados: { codigo: 'interno' } });
    expect(ev.at(-1).nome).toBe('fim');
  });

  it('sem waitUntil a tarefa roda solta e o stream termina igual', async () => {
    const contador = {
      async consumir() {
        return { permitido: true, usado: 1, teto: 50, dia: '2026-11-25' };
      },
    };

    const resposta = await tratar(pedido(), ENV, { contador });
    const texto = await resposta.text();
    expect(eventos(texto).map((e) => e.nome)).toEqual(['inicio', 'texto', 'fim']);
  });
});

describe('registro da 074 no núcleo', () => {
  it('abre depois do limite, emite inicio primeiro e conclui uma vez no sucesso', async () => {
    const registrador = registradorFalso();
    const c = ctx();

    const resposta = await tratar(pedido(), ENV, {
      contador: contadorPermitido(),
      registrador,
      waitUntil: (p) => c.waitUntil(p),
    });
    const texto = await resposta.text();
    await Promise.all(c.promessas);

    const ev = eventos(texto);
    expect(ev.map((e) => e.nome)).toEqual(['inicio', 'texto', 'fim']);
    expect(ev[0]).toEqual({ nome: 'inicio', dados: { registro: UUID_REGISTRO } });

    expect(registrador.chamadas.iniciar).toHaveLength(1);
    expect(registrador.chamadas.iniciar[0]).toMatchObject({
      jwt: 'jwt-bom',
      pergunta: 'Quanto o 30.109 tem livre?',
      anteriores: 0,
      modelo: 'modelo-teste',
    });

    expect(registrador.chamadas.concluir).toHaveLength(1);
    const concluir = registrador.chamadas.concluir[0];
    expect(concluir).toMatchObject({
      jwt: 'jwt-bom',
      id: UUID_REGISTRO,
      desfecho: 'ok',
      codigoErro: null,
      rodadas: 1,
      chamadas: 0,
    });
    expect(concluir.resposta).toEqual({
      texto: { texto: 'Pronto.', semOrigem: [] },
      blocos: [],
    });
    expect(concluir.passos).toEqual([]);
    expect(typeof concluir.prazo).toBe('number');
    expect(concluir.sinal).toBeUndefined();
  });

  it('falha do registro não derruba a pergunta e emite inicio com null', async () => {
    const registrador = registradorFalso({
      iniciar: async () => {
        throw new Error('registro fora do ar');
      },
    });
    const c = ctx();

    const resposta = await tratar(pedido(), ENV, {
      contador: contadorPermitido(),
      registrador,
      waitUntil: (p) => c.waitUntil(p),
    });
    const texto = await resposta.text();
    await Promise.all(c.promessas);

    const ev = eventos(texto);
    expect(ev.map((e) => e.nome)).toEqual(['inicio', 'texto', 'fim']);
    expect(ev[0].dados).toEqual({ registro: null });
    expect(registrador.chamadas.concluir).toHaveLength(0);
  });

  it('conclui uma vez com desfecho erro e o código do modelo', async () => {
    vi.stubGlobal('fetch', async (url) => {
      if (url.endsWith('/auth/v1/user')) return json({ id: 'u1', email: 'a@b' });
      if (url.includes('/rest/v1/app_users')) return json([{ role: 'admin' }]);
      if (url === 'https://ollama.com/api/chat') return new Response('', { status: 500 });
      throw new Error(`URL inesperada: ${url}`);
    });

    const registrador = registradorFalso();
    const c = ctx();
    const resposta = await tratar(pedido(), ENV, {
      contador: contadorPermitido(),
      registrador,
      waitUntil: (p) => c.waitUntil(p),
    });
    const texto = await resposta.text();
    await Promise.all(c.promessas);

    expect(eventos(texto).map((e) => e.nome)).toEqual(['inicio', 'erro', 'fim']);
    expect(registrador.chamadas.concluir).toHaveLength(1);
    expect(registrador.chamadas.concluir[0]).toMatchObject({
      desfecho: 'erro',
      codigoErro: 'modelo',
    });
  });

  it('conclui uma vez com desfecho incompleta', async () => {
    const fila = Array.from({ length: 8 }, () => ({
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { function: { name: 'criar_bloco', arguments: { tipo: 'numero', no: 'r1' } } },
        ],
      },
    }));

    vi.stubGlobal('fetch', async (url) => {
      if (url.endsWith('/auth/v1/user')) return json({ id: 'u1', email: 'a@b' });
      if (url.includes('/rest/v1/app_users')) return json([{ role: 'admin' }]);
      if (url === 'https://ollama.com/api/chat') return json(fila.shift());
      throw new Error(`URL inesperada: ${url}`);
    });

    const registrador = registradorFalso();
    const c = ctx();
    const resposta = await tratar(pedido(), ENV, {
      contador: contadorPermitido(),
      registrador,
      waitUntil: (p) => c.waitUntil(p),
    });
    const texto = await resposta.text();
    await Promise.all(c.promessas);

    const ev = eventos(texto);
    expect(ev.find((e) => e.nome === 'erro')).toMatchObject({
      dados: { codigo: 'incompleta' },
    });
    expect(registrador.chamadas.concluir).toHaveLength(1);
    const concluir = registrador.chamadas.concluir[0];
    expect(concluir).toMatchObject({
      desfecho: 'incompleta',
      codigoErro: 'incompleta',
      rodadas: 8,
      chamadas: 7,
    });
    expect(concluir.resposta.blocos).toHaveLength(7);
    expect(concluir.passos).toHaveLength(7);
  });

  it('conclui uma vez com desfecho tempo quando o watchdog fecha', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', async (url, init) => {
        if (url.endsWith('/auth/v1/user')) return json({ id: 'u1', email: 'a@b' });
        if (url.includes('/rest/v1/app_users')) return json([{ role: 'admin' }]);
        if (url === 'https://ollama.com/api/chat') {
          return new Promise((_resolve, reject) => {
            init.signal.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
          });
        }
        throw new Error(`URL inesperada: ${url}`);
      });

      const registrador = registradorFalso();
      const c = ctx();
      const resposta = await tratar(pedido(), ENV, {
        contador: contadorPermitido(),
        registrador,
        waitUntil: (p) => c.waitUntil(p),
      });
      const leitura = resposta.text();
      await vi.advanceTimersByTimeAsync(120_001);
      const texto = await leitura;
      await Promise.all(c.promessas);

      expect(eventos(texto).find((e) => e.nome === 'erro')).toMatchObject({
        dados: { codigo: 'tempo' },
      });
      expect(registrador.chamadas.concluir).toHaveLength(1);
      expect(registrador.chamadas.concluir[0]).toMatchObject({
        desfecho: 'tempo',
        codigoErro: 'tempo',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('conclui uma vez com desfecho desconectado quando o cliente sai', async () => {
    const controle = new AbortController();
    let avisarModelo;
    const modeloIniciou = new Promise((resolve) => {
      avisarModelo = resolve;
    });

    vi.stubGlobal('fetch', async (url, init) => {
      if (url.endsWith('/auth/v1/user')) return json({ id: 'u1', email: 'a@b' });
      if (url.includes('/rest/v1/app_users')) return json([{ role: 'admin' }]);
      if (url === 'https://ollama.com/api/chat') {
        avisarModelo();
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      }
      throw new Error(`URL inesperada: ${url}`);
    });

    const registrador = registradorFalso();
    const c = ctx();
    const resposta = await tratar(pedidoComSinal(controle.signal), ENV, {
      contador: contadorPermitido(),
      registrador,
      waitUntil: (p) => c.waitUntil(p),
    });
    const leitura = lerAteFechar(resposta);

    await modeloIniciou;
    controle.abort();

    const texto = await leitura;
    await Promise.all(c.promessas);

    expect(eventos(texto).map((e) => e.nome)).not.toContain('fim');
    expect(registrador.chamadas.concluir).toHaveLength(1);
    expect(registrador.chamadas.concluir[0]).toMatchObject({
      desfecho: 'desconectado',
      codigoErro: null,
    });
    expect(registrador.chamadas.concluir[0].sinal).toBeUndefined();
  });

  it('não loga conteúdo e mascara os argumentos nos passos do registro', async () => {
    const espioes = ['log', 'info', 'warn', 'error', 'debug'].map((metodo) =>
      vi.spyOn(console, metodo).mockImplementation(() => {}),
    );

    try {
      const sessao = sessaoFalsa();
      sessao.executar = async () => ({
        id: 'r1',
        paraModelo: '{"dado":"RESULTADO-SECRETO"}',
      });
      sessao.mascararEntrada = async (texto) =>
        String(texto).split('NOME-SECRETO').join('⟦P1⟧');
      pacote.criarSessao.mockReturnValue(sessao);

      const fila = [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                function: {
                  name: 'listar_centros',
                  arguments: { q: 'NOME-SECRETO' },
                },
              },
            ],
          },
        },
        { message: { role: 'assistant', content: 'TEXTO-SECRETO' } },
      ];
      vi.stubGlobal('fetch', async (url) => {
        if (url.endsWith('/auth/v1/user')) return json({ id: 'u1', email: 'a@b' });
        if (url.includes('/rest/v1/app_users')) return json([{ role: 'admin' }]);
        if (url === 'https://ollama.com/api/chat') return json(fila.shift());
        throw new Error(`URL inesperada: ${url}`);
      });

      const registrador = registradorFalso();
      const c = ctx();
      const resposta = await tratar(pedido(), ENV, {
        contador: contadorPermitido(),
        registrador,
        waitUntil: (p) => c.waitUntil(p),
      });
      const texto = await resposta.text();
      await Promise.all(c.promessas);

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
        'NOME-SECRETO',
        'RESULTADO-SECRETO',
        'TEXTO-SECRETO',
      ]) {
        expect(tudo).not.toContain(segredo);
      }

      const passos = registrador.chamadas.concluir[0].passos;
      expect(passos[0]).toMatchObject({
        ferramenta: 'listar_centros',
        estado: 'fim',
      });
      expect(passos[0].argumentos).toEqual({ q: '⟦P1⟧' });
      expect(JSON.stringify(passos)).not.toContain('NOME-SECRETO');
    } finally {
      for (const espiao of espioes) espiao.mockRestore();
    }
  });
});
