import { describe, expect, it, vi } from 'vitest';
import { caminhoManutencao, consultarManutencao, interpretarManutencao } from '../src/servicos/manutencao.js';

describe('manutencao', () => {
  it('resolve o caminho de manutencao.json relativo a BASE_URL', () => {
    expect(caminhoManutencao('/controle-financeiro-lapig/v2/')).toBe('/controle-financeiro-lapig/manutencao.json');
  });

  it('ativa somente quando ativo === true', () => {
    expect(interpretarManutencao(null)).toEqual({ ativo: false, mensagem: '' });
    expect(interpretarManutencao({ ativo: false, mensagem: 'x' })).toEqual({ ativo: false, mensagem: '' });
    expect(interpretarManutencao({ ativo: true, mensagem: '  Em migração  ' })).toEqual({
      ativo: true,
      mensagem: 'Em migração',
    });
  });

  it('usa mensagem padrão quando ativo=true sem texto', () => {
    const res = interpretarManutencao({ ativo: true, mensagem: '' });
    expect(res.ativo).toBe(true);
    expect(res.mensagem).toBe('O Buriti está em atualização. Volte em alguns minutos — não é preciso fazer nada.');
  });

  it('distingue falha de rede, arquivo ausente e resposta inválida da liberação confirmada', async () => {
    const falha = { ativo: false, mensagem: '', falhou: true };
    const falhaRede = await consultarManutencao(async () => {
      throw new Error('offline');
    });
    expect(falhaRede).toEqual(falha);

    const naoEncontrado = await consultarManutencao(async () => ({ ok: false }));
    expect(naoEncontrado).toEqual(falha);

    const respostaInvalida = await consultarManutencao(async () => ({ ok: true, json: async () => ({}) }));
    expect(respostaInvalida).toEqual(falha);

    const respostaLiberada = await consultarManutencao(async () => ({ ok: true, json: async () => ({ ativo: false }) }));
    expect(respostaLiberada).toEqual({ ativo: false, mensagem: '' });
  });

  it('encerra uma consulta sem resposta após cinco segundos', async () => {
    vi.useFakeTimers();
    try {
      const pendente = consultarManutencao((_, { signal }) => new Promise((_resolver, rejeitar) => {
        signal.addEventListener('abort', () => rejeitar(signal.reason), { once: true });
      }));
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pendente).toMatchObject({ falhou: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
