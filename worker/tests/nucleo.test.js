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

    expect(eventos(texto).map((e) => e.nome)).toEqual(['texto', 'fim']);
    expect(recebido).toHaveLength(1);
    expect(recebido[0].userId).toBe('u1');
    expect(recebido[0].jwt).toBe('jwt-bom');
    expect(typeof recebido[0].prazo).toBe('number');
    expect(recebido[0].sinal).toBeInstanceOf(AbortSignal);
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
    expect(eventos(texto).map((e) => e.nome)).toEqual(['texto', 'fim']);
  });
});
