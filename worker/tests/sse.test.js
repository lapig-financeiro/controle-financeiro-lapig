import { describe, it, expect } from 'vitest';
import { CABECALHOS_SSE, criarEmissor, formatarEvento } from '../src/sse.js';

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
});
