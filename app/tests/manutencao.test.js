import { describe, expect, it } from 'vitest';
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

  it('não bloqueia quando fetch falha ou arquivo não existe', async () => {
    const falhaRede = await consultarManutencao(async () => {
      throw new Error('offline');
    });
    expect(falhaRede).toEqual({ ativo: false, mensagem: '' });

    const naoEncontrado = await consultarManutencao(async () => ({ ok: false }));
    expect(naoEncontrado).toEqual({ ativo: false, mensagem: '' });
  });
});
