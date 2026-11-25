import { describe, it, expect, vi } from 'vitest';
import { criarEncerrador } from '../src/encerrador.js';

describe('encerrador', () => {
  it('só a primeira chamada vale: um erro, um fim, erro antes do fim', async () => {
    const fluxo = new TransformStream();
    const leitura = new Response(fluxo.readable).text();

    const encerrador = criarEncerrador({
      writable: fluxo.writable,
      estado: { rodadas: 2 },
      inicio: 0,
      prazo: 1_000,
      agora: () => 10,
    });

    await encerrador.emitir('passo', { estado: 'inicio' });
    const primeira = encerrador.encerrar({
      erro: { codigo: 'tempo', mensagem: 'estourou' },
    });
    const segunda = encerrador.encerrar({
      erro: { codigo: 'interno', mensagem: 'outra' },
    });

    await Promise.all([primeira, segunda]);
    const texto = await leitura;

    expect(texto.match(/event: erro/g)).toHaveLength(1);
    expect(texto.match(/event: fim/g)).toHaveLength(1);
    expect(texto.indexOf('event: erro')).toBeLessThan(texto.indexOf('event: fim'));
    expect(texto).toContain('"codigo":"tempo"');
    expect(texto).not.toContain('"codigo":"interno"');
    expect(texto).toContain('"rodadas":2');
    expect(encerrador.fase).toBe('fechado');
  });

  it('escrita bloqueada é abortada no limite e não segura o encerramento', async () => {
    vi.useFakeTimers();
    try {
      let abortado = false;
      let rejeitarEscrita;
      let iniciouResolver;
      const iniciou = new Promise((resolve) => {
        iniciouResolver = resolve;
      });

      const escritor = {
        write() {
          iniciouResolver();
          return new Promise((_resolve, reject) => {
            rejeitarEscrita = reject;
          });
        },
        abort() {
          abortado = true;
          return Promise.resolve();
        },
        close() {
          return Promise.resolve();
        },
      };
      const legivel = {
        cancel() {
          abortado = true;
          rejeitarEscrita?.(new Error('leitura cancelada'));
          return Promise.resolve();
        },
      };

      const encerrador = criarEncerrador({
        writable: { getWriter: () => escritor },
        readable: legivel,
        estado: { rodadas: 1 },
        inicio: 0,
        prazo: 1_000,
        agora: () => 1_000,
      });

      const texto = encerrador.emitir('texto', { texto: 'x' });
      await iniciou;

      const fechou = encerrador.encerrar({
        erro: { codigo: 'tempo', mensagem: 'estourou' },
      });

      await vi.advanceTimersByTimeAsync(1_001);
      await vi.advanceTimersByTimeAsync(0);

      await expect(fechou).resolves.toBe(true);
      expect(abortado).toBe(true);
      await expect(texto).resolves.toBe(false);
      expect(encerrador.fase).toBe('fechado');
    } finally {
      vi.useRealTimers();
    }
  });

  it('desconexão não escreve nada e fecha', async () => {
    const fluxo = new TransformStream();
    // O aborto do escritor erra o lado legível; para o cliente que caiu, o
    // que importa é que não veio evento nenhum.
    const leitura = new Response(fluxo.readable).text().catch(() => '');

    const encerrador = criarEncerrador({
      writable: fluxo.writable,
      estado: { rodadas: 1 },
      inicio: 0,
      prazo: 1_000,
      agora: () => 10,
    });

    await encerrador.encerrar({ desconectado: true });
    const texto = await leitura;
    expect(texto).toBe('');
    expect(encerrador.fase).toBe('fechado');
  });
});
