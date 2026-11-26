import { describe, it, expect } from 'vitest';

import { codigoDoErro } from '../../shared/ai-tools/ferramentas/comum.js';
import { criarSessao } from '../../shared/ai-tools/index.js';

describe('codigoDoErro reconhece o { codigo, mensagem } do worker/src/rpc.js', () => {
  it('tempo e abortado viram tempo', () => {
    expect(codigoDoErro({ codigo: 'tempo', mensagem: 'A consulta demorou demais.' })).toBe(
      'tempo'
    );
    expect(codigoDoErro({ codigo: 'abortado', mensagem: 'A consulta foi cancelada.' })).toBe(
      'tempo'
    );
  });

  it('rede vira rede', () => {
    expect(codigoDoErro({ codigo: 'rede', mensagem: 'A consulta não chegou ao banco.' })).toBe(
      'rede'
    );
  });

  it('resposta_invalida vira formato', () => {
    expect(
      codigoDoErro({ codigo: 'resposta_invalida', mensagem: 'devolveu corpo vazio' })
    ).toBe('formato');
  });

  it('http_5xx e status >= 500 viram rede', () => {
    expect(codigoDoErro({ codigo: 'http_500', mensagem: 'falhou' })).toBe('rede');
    expect(codigoDoErro({ codigo: 'http_503', mensagem: 'falhou' })).toBe('rede');
    expect(codigoDoErro({ mensagem: 'falhou', status: 500 })).toBe('rede');
    expect(codigoDoErro({ mensagem: 'falhou', status: 502 })).toBe('rede');
  });

  it('408/504/524 continuam tempo, com status ou com código http_', () => {
    expect(codigoDoErro({ mensagem: 'falhou', status: 408 })).toBe('tempo');
    expect(codigoDoErro({ mensagem: 'falhou', status: 504 })).toBe('tempo');
    expect(codigoDoErro({ mensagem: 'falhou', status: 524 })).toBe('tempo');
    expect(codigoDoErro({ codigo: 'http_504', mensagem: 'falhou' })).toBe('tempo');
    expect(codigoDoErro({ codigo: 'http_524', mensagem: 'falhou' })).toBe('tempo');
  });

  it('mensagem de timeout vira tempo mesmo sem codigo', () => {
    expect(codigoDoErro({ message: 'Timed out depois de 30s' })).toBe('tempo');
    expect(codigoDoErro({ name: 'AbortError' })).toBe('tempo');
    expect(codigoDoErro('request timeout')).toBe('tempo');
  });

  it('erro comum continua http_4xx', () => {
    expect(codigoDoErro({ message: 'permission denied' })).toBe('http_4xx');
    expect(codigoDoErro({ status: 400, message: 'ruim' })).toBe('http_4xx');
    expect(codigoDoErro(null)).toBe('http_4xx');
  });
});

describe('a sessão usa o código novo no erro fixo', () => {
  function sessaoComErro(error) {
    return criarSessao({
      rpc: async () => ({ data: null, error }),
      hoje: '2026-11-25',
    });
  }

  it('tempo e rede não chegam ao modelo como http_4xx', async () => {
    const tempo = await sessaoComErro({
      codigo: 'tempo',
      mensagem: 'A consulta resumo_projetos_v2 demorou demais.',
    }).executar('listar_centros', {});
    expect(tempo.erro).toBe('Não foi possível carregar os centros. (tempo)');

    const rede = await sessaoComErro({
      codigo: 'http_502',
      mensagem: 'Bad gateway',
      status: 502,
    }).executar('listar_centros', {});
    expect(rede.erro).toBe('Não foi possível carregar os centros. (rede)');
  });

  it('resposta_invalida chega ao modelo como formato', async () => {
    const formato = await sessaoComErro({
      codigo: 'resposta_invalida',
      mensagem: 'A consulta devolveu corpo vazio.',
    }).executar('listar_centros', {});
    expect(formato.erro).toBe('Não foi possível carregar os centros. (formato)');
  });
});
