import { describe, it, expect, vi } from 'vitest';
import {
  CABECALHOS_SSE,
  COMENTARIO_PING,
  INTERVALO_PING_MS,
  criarEmissor,
  formatarEvento,
} from '../src/sse.js';

function escritorFalso() {
  const escritos = [];
  return {
    escritos,
    getWriter: () => ({
      async write(pedaço) {
        escritos.push(new TextDecoder().decode(pedaço));
      },
      async close() {},
      async abort() {},
    }),
  };
}

describe('formatação SSE', () => {
  it('usa event/data e termina com linha em branco', () => {
    expect(formatarEvento('passo', { ferramenta: 'listar_centros' })).toBe(
      'event: passo\ndata: {"ferramenta":"listar_centros"}\n\n',
    );
  });

  it('escapa quebra de linha do texto, sem partir o evento no meio', () => {
    const bruto = formatarEvento('texto', { texto: 'linha 1\nlinha 2' });
    expect(bruto).toContain('data: {"texto":"linha 1\\nlinha 2"}');
    // Só existem as quebras estruturais: depois do event, depois do data e a
    // linha em branco que fecha o evento. A quebra do texto virou `\n`.
    expect(bruto.split('\n')).toHaveLength(4);
    expect(bruto).not.toContain('linha 1\nlinha 2');
  });

  it('mantém os cabeçalhos do contrato', () => {
    expect(CABECALHOS_SSE['Content-Type']).toContain('text/event-stream');
    expect(CABECALHOS_SSE['Cache-Control']).toBe('no-store');
  });
});

describe('emissor', () => {
  it('entrega os eventos na ordem em que foram escritos', async () => {
    const fluxo = new TransformStream();
    const emissor = criarEmissor(fluxo.writable);
    const leitura = new Response(fluxo.readable).text();

    expect(await emissor.emitir('passo', { estado: 'inicio' })).toBe(true);
    expect(await emissor.emitir('fim', { rodadas: 1 })).toBe(true);
    await emissor.fechar();

    expect(await leitura).toBe(
      'event: passo\ndata: {"estado":"inicio"}\n\n' +
        'event: fim\ndata: {"rodadas":1}\n\n',
    );
  });

  it('devolve false depois de fechado', async () => {
    const fluxo = new TransformStream();
    const emissor = criarEmissor(fluxo.writable);
    await emissor.fechar();
    expect(await emissor.emitir('texto', { texto: 'x' })).toBe(false);
  });

  it('não lança quando o cliente desconectou', async () => {
    const quebrado = {
      getWriter: () => ({
        write: () => Promise.reject(new Error('cliente foi embora')),
        close: () => Promise.reject(new Error('cliente foi embora')),
      }),
    };
    const emissor = criarEmissor(quebrado);
    expect(await emissor.emitir('passo', { estado: 'inicio' })).toBe(false);
    expect(await emissor.emitir('fim', {})).toBe(false);
    await expect(emissor.fechar()).resolves.toBeUndefined();
  });

  it('manda ping a cada 15 s, começando 15 s depois de abrir, e para no fim', async () => {
    vi.useFakeTimers();
    try {
      const escritor = escritorFalso();
      const emissor = criarEmissor(escritor);

      await vi.advanceTimersByTimeAsync(INTERVALO_PING_MS - 1);
      expect(escritor.escritos).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(escritor.escritos).toEqual([COMENTARIO_PING]);

      await vi.advanceTimersByTimeAsync(INTERVALO_PING_MS);
      expect(escritor.escritos).toEqual([COMENTARIO_PING, COMENTARIO_PING]);

      await emissor.encerrar({ fim: { rodadas: 0 } });
      expect(escritor.escritos.at(-1)).toBe('event: fim\ndata: {"rodadas":0}\n\n');

      const depoisDoFim = escritor.escritos.length;
      await vi.advanceTimersByTimeAsync(INTERVALO_PING_MS * 3);
      expect(escritor.escritos).toHaveLength(depoisDoFim);
      expect(escritor.escritos.slice(depoisDoFim).join('')).not.toContain(COMENTARIO_PING);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('não manda ping depois do encerramento por erro', async () => {
    vi.useFakeTimers();
    try {
      const escritor = escritorFalso();
      const emissor = criarEmissor(escritor);
      await emissor.encerrar({
        erro: { codigo: 'tempo', mensagem: 'estourou' },
        fim: { rodadas: 0 },
      });

      const depoisDoFim = escritor.escritos.length;
      await vi.advanceTimersByTimeAsync(INTERVALO_PING_MS * 2);
      expect(escritor.escritos).toHaveLength(depoisDoFim);
      expect(escritor.escritos.join('')).not.toContain(COMENTARIO_PING);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['fim', async (emissor) => emissor.encerrar({ fim: { rodadas: 0 } })],
    [
      'erro',
      async (emissor) =>
        emissor.encerrar({
          erro: { codigo: 'tempo', mensagem: 'estourou' },
          fim: { rodadas: 0 },
        }),
    ],
    ['desconexão', async (emissor) => emissor.abortar()],
    ['fechamento', async (emissor) => emissor.fechar()],
  ])('limpa o timer do ping no encerramento por %s', async (_rotulo, fechar) => {
    vi.useFakeTimers();
    try {
      const emissor = criarEmissor(escritorFalso());
      await fechar(emissor);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(INTERVALO_PING_MS * 2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falha de escrita do ping conta como desconexão', async () => {
    vi.useFakeTimers();
    try {
      let desconectou = 0;
      const quebrado = {
        getWriter: () => ({
          write: () => Promise.reject(new Error('cliente foi embora')),
          close: () => Promise.resolve(),
          abort: () => Promise.resolve(),
        }),
      };
      const emissor = criarEmissor(quebrado, {
        aoDesconectar: () => {
          desconectou += 1;
        },
      });

      await vi.advanceTimersByTimeAsync(INTERVALO_PING_MS);
      await vi.advanceTimersByTimeAsync(0);

      expect(desconectou).toBe(1);
      expect(emissor.encerrado).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
