import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('../src/servicos/supabase.js', () => ({
  supabase: { rpc: rpcMock },
}));

import {
  editarItemCaixa,
  situacaoCentro,
  validarMotivos,
  validarResumoProjetos,
  validarSituacaoCentro,
} from '../src/servicos/dados.js';
import * as dadosExemplo from '../src/servicos/dadosExemplo.js';

beforeEach(() => {
  rpcMock.mockReset();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('motivos e situação do centro', () => {
  it('aceita motivos ausentes (produção antes da 069) e recusa nível inválido', () => {
    expect(validarMotivos(undefined)).toBe(true);
    expect(validarMotivos(null)).toBe(true);
    expect(validarMotivos([])).toBe(true);
    expect(
      validarMotivos([{ codigo: 'tarifa_bancaria', nivel: 'atenção', texto: 'R$ 14,34' }])
    ).toBe(true);
    expect(validarMotivos([{ codigo: 'x', nivel: 'grave', texto: 'x' }])).toBe(false);
    expect(validarMotivos([{ codigo: '', nivel: 'info', texto: 'x' }])).toBe(false);
    expect(validarMotivos([{ codigo: 'x', nivel: 'info', texto: '   ' }])).toBe(false);
    expect(validarMotivos('x')).toBe(false);

    expect(
      validarResumoProjetos({ centros: [{ id: 'c1', situacao: 'em dia' }], todos: [] })
    ).toBe(true);
    expect(
      validarResumoProjetos({
        centros: [{ id: 'c1', motivos: [{ codigo: 'x', nivel: 'grave', texto: 'x' }] }],
        todos: [],
      })
    ).toBe(false);
  });

  it('situacaoCentro sem a RPC nova devolve dados nulos sem erro', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '42883', message: 'function public.situacao_centro_v2 does not exist' },
    });
    const semFuncao = await situacaoCentro('p-1');
    expect(semFuncao).toEqual({ dados: null, erro: null });

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });
    const semSchemaCache = await situacaoCentro('p-1');
    expect(semSchemaCache).toEqual({ dados: null, erro: null });

    rpcMock.mockResolvedValueOnce({
      data: {
        situacao: 'atenção',
        motivos: [
          { codigo: 'tarifa_bancaria', nivel: 'atenção', texto: 'R$ 14,34', grupo_code: 'b', valor: 14.34 },
        ],
      },
      error: null,
    });
    const comDados = await situacaoCentro('p-1');
    expect(comDados.erro).toBeNull();
    expect(comDados.dados.situacao).toBe('atenção');
    expect(validarSituacaoCentro(comDados.dados)).toBe(true);
    expect(validarSituacaoCentro({ situacao: 'em dia' })).toBe(false);

    rpcMock.mockResolvedValueOnce({
      data: { situacao: 'atenção', motivos: [{ codigo: 'x', nivel: 'grave', texto: 'x' }] },
      error: null,
    });
    const invalido = await situacaoCentro('p-1');
    expect(invalido.dados).toBeNull();
    expect(invalido.erro).toContain('Não foi possível');
  });

  it('editarItemCaixa("4.500") manda 4500 e número continua número', async () => {
    rpcMock.mockResolvedValue({
      data: { caixa_id: 'c1', holder_id: 'h1', valor_mensal: 4500, valor_usado: 4500, nota: null },
      error: null,
    });

    const comTexto = await editarItemCaixa('c1', 'h1', '4.500');
    expect(comTexto.erro).toBeNull();
    expect(rpcMock).toHaveBeenLastCalledWith('editar_item_caixa_v2', {
      p_caixa_id: 'c1',
      p_holder_id: 'h1',
      p_valor_mensal: 4500,
      p_nota: null,
    });

    const comNumero = await editarItemCaixa('c1', 'h1', 4500);
    expect(comNumero.erro).toBeNull();
    expect(rpcMock).toHaveBeenLastCalledWith('editar_item_caixa_v2', {
      p_caixa_id: 'c1',
      p_holder_id: 'h1',
      p_valor_mensal: 4500,
      p_nota: null,
    });

    const invalido = await editarItemCaixa('c1', 'h1', 'quatro mil');
    expect(invalido.dados).toBeNull();
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it('modo exemplo: centro com tarifa, resumo com motivos e valor digitado em pt-BR', async () => {
    vi.stubEnv('VITE_DADOS', 'exemplo');

    const resumo = await dadosExemplo.resumoProjetos();
    const tarifa = resumo.dados.centros.find((centro) => centro.code === '30.909');
    expect(tarifa).toBeTruthy();
    expect(tarifa.situacao).toBe('atenção');
    expect(Array.isArray(tarifa.motivos)).toBe(true);
    expect(tarifa.motivos[0].codigo).toBe('tarifa_bancaria');
    expect(validarMotivos(tarifa.motivos)).toBe(true);

    const situacao = await dadosExemplo.situacaoCentro(tarifa.id);
    expect(situacao.erro).toBeNull();
    expect(situacao.dados.situacao).toBe('atenção');
    expect(validarSituacaoCentro(situacao.dados)).toBe(true);

    const pedido = await dadosExemplo.pedidoBolsas();
    const caixa = pedido.dados.caixas.find((c) => c.itens.length > 0);
    const item = caixa.itens[0];
    const editado = await dadosExemplo.editarItemCaixa(caixa.id, item.holder_id, '4.500');
    expect(editado.erro).toBeNull();
    expect(editado.dados.valor_mensal).toBe(4500);
  });
});
