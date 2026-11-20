import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('../src/servicos/supabase.js', () => ({
  supabase: { rpc: rpcMock },
}));

import {
  apagarCaixaPedido,
  colocarNaCaixa,
  editarItemCaixa,
  limparOcultosDaCaixa,
  pedidoBolsas,
  salvarCaixaPedido,
  salvarEquipeBolsista,
  tirarDaCaixa,
  validarCaixaPedido,
  validarPedidoBolsas,
} from '../src/servicos/dados.js';
import * as dadosExemplo from '../src/servicos/dadosExemplo.js';

const BOLSA = {
  scholarship_id: 's1',
  project_id: 'c1',
  code: '30.901',
  valor: 4000,
  inicio: '2026-01-01',
  fim: '2027-01-01',
  status: 'active',
  vigente_hoje: true,
};

const PEDIDO = {
  centros: [{ id: 'c1', code: '30.901', name: 'Centro Um' }],
  bolsistas: [
    {
      holder_id: 'h1',
      nome: 'Pessoa Um',
      equipe: 'pastagem',
      valor_vigente: 4000,
      bolsas: [BOLSA],
    },
  ],
  caixas: [
    {
      id: 'k1',
      nome: 'Caixa Um',
      meses: 12,
      criado_em: '2026-11-19T12:00:00Z',
      pessoas: 1,
      total_mensal: 4000,
      total_periodo: 48000,
      itens_ocultos: 0,
      itens: [{ holder_id: 'h1', valor_mensal: null, valor_usado: 4000, nota: null }],
    },
  ],
};

beforeEach(() => {
  rpcMock.mockReset();
});

describe('validador do pedido de bolsas', () => {
  it('aceita o payload completo da RPC', () => {
    expect(validarPedidoBolsas(PEDIDO)).toBe(true);
    expect(validarCaixaPedido(PEDIDO.caixas[0])).toBe(true);
  });

  it('recusa caixa sem itens_ocultos, bolsa com status inválido, equipe inválida e total não numérico', () => {
    const semOcultos = structuredClone(PEDIDO);
    delete semOcultos.caixas[0].itens_ocultos;
    expect(validarPedidoBolsas(semOcultos)).toBe(false);

    const statusRuim = structuredClone(PEDIDO);
    statusRuim.bolsistas[0].bolsas[0].status = 'suspensa';
    expect(validarPedidoBolsas(statusRuim)).toBe(false);

    const equipeRuim = structuredClone(PEDIDO);
    equipeRuim.bolsistas[0].equipe = 'nenhuma';
    expect(validarPedidoBolsas(equipeRuim)).toBe(false);

    const totalRuim = structuredClone(PEDIDO);
    totalRuim.caixas[0].total_mensal = 'muito';
    expect(validarPedidoBolsas(totalRuim)).toBe(false);

    expect(validarPedidoBolsas(null)).toBe(false);
    expect(validarPedidoBolsas({ centros: [], bolsistas: [] })).toBe(false);
  });

  it('confere pessoas, soma dos itens e total do período (tolerância de meio centavo)', () => {
    const pessoasErradas = structuredClone(PEDIDO);
    pessoasErradas.caixas[0].pessoas = 2;
    expect(validarCaixaPedido(pessoasErradas.caixas[0])).toBe(false);

    const somaErrada = structuredClone(PEDIDO);
    somaErrada.caixas[0].total_mensal = 4001;
    expect(validarCaixaPedido(somaErrada.caixas[0])).toBe(false);

    const periodoErrado = structuredClone(PEDIDO);
    periodoErrado.caixas[0].total_periodo = 48001;
    expect(validarCaixaPedido(periodoErrado.caixas[0])).toBe(false);

    const tolerado = structuredClone(PEDIDO);
    tolerado.caixas[0].total_mensal = 4000.004;
    tolerado.caixas[0].total_periodo = 48000.048;
    expect(validarCaixaPedido(tolerado.caixas[0])).toBe(true);
  });
});

describe('serviços do pedido de bolsas', () => {
  it('pedidoBolsas chama get_pedido_bolsas_v2 e valida o payload', async () => {
    rpcMock.mockResolvedValueOnce({ data: PEDIDO, error: null });
    const res = await pedidoBolsas();
    expect(rpcMock).toHaveBeenCalledWith('get_pedido_bolsas_v2');
    expect(res.erro).toBeNull();
    expect(res.dados).toEqual(PEDIDO);

    rpcMock.mockResolvedValueOnce({ data: { centros: [] }, error: null });
    const invalido = await pedidoBolsas();
    expect(invalido.dados).toBeNull();
    expect(invalido.erro).toContain('Não foi possível');
  });

  it('mostra a mensagem do banco para 22023/P0002/42501 e mantém genérica nos demais', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '22023', message: 'Limite de 10 caixas por usuário.' },
    });
    const limitada = await salvarCaixaPedido({ nome: 'Nova' });
    expect(limitada.erro).toBe('Limite de 10 caixas por usuário.');

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'Caixa do pedido não encontrada.' },
    });
    const semCaixa = await apagarCaixaPedido('k1');
    expect(semCaixa.erro).toBe('Caixa do pedido não encontrada.');

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'erro interno' },
    });
    const generica = await salvarCaixaPedido({ nome: 'Nova' });
    expect(generica.erro).toBe('Não foi possível salvar a caixa.');

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied for function salvar_caixa_pedido_v2' },
    });
    const acl = await salvarCaixaPedido({ nome: 'Nova' });
    expect(acl.erro).toBe('Não foi possível salvar a caixa.');
  });

  it('salvarEquipeBolsista valida a equipe e envia o parâmetro certo', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { holder_id: 'h1', equipe: 'alertas' },
      error: null,
    });
    const res = await salvarEquipeBolsista('h1', 'alertas');
    expect(rpcMock).toHaveBeenCalledWith('salvar_equipe_bolsista_v2', {
      p_holder_id: 'h1',
      p_equipe: 'alertas',
    });
    expect(res.dados).toEqual({ holder_id: 'h1', equipe: 'alertas' });

    const antes = rpcMock.mock.calls.length;
    const invalida = await salvarEquipeBolsista('h1', 'outra');
    expect(invalida.erro).toBe('Equipe inválida.');
    expect(rpcMock.mock.calls.length).toBe(antes);

    rpcMock.mockResolvedValueOnce({ data: { holder_id: 'h1', equipe: null }, error: null });
    const vazia = await salvarEquipeBolsista('h1', '');
    expect(rpcMock).toHaveBeenLastCalledWith('salvar_equipe_bolsista_v2', {
      p_holder_id: 'h1',
      p_equipe: null,
    });
    expect(vazia.erro).toBeNull();
  });

  it('salvarCaixaPedido só manda meses quando definido e confere o devolvido', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { id: 'k1', nome: 'Time', meses: 10 },
      error: null,
    });
    const res = await salvarCaixaPedido({ id: 'k1', nome: ' Time ', meses: 10 });
    expect(rpcMock).toHaveBeenCalledWith('salvar_caixa_pedido_v2', {
      p: { nome: 'Time', meses: 10, id: 'k1' },
    });
    expect(res.erro).toBeNull();

    rpcMock.mockResolvedValueOnce({
      data: { id: 'k9', nome: 'Nova', meses: 12 },
      error: null,
    });
    const nova = await salvarCaixaPedido({ nome: 'Nova' });
    expect(rpcMock).toHaveBeenLastCalledWith('salvar_caixa_pedido_v2', { p: { nome: 'Nova' } });
    expect(nova.erro).toBeNull();

    rpcMock.mockResolvedValueOnce({
      data: { id: 'k9', nome: 'Outra', meses: 12 },
      error: null,
    });
    const divergente = await salvarCaixaPedido({ nome: 'Nova' });
    expect(divergente.dados).toBeNull();
    expect(divergente.erro).toContain('Não foi possível');

    const antes = rpcMock.mock.calls.length;
    expect((await salvarCaixaPedido({ nome: '   ' })).erro).toContain('nome da caixa');
    expect((await salvarCaixaPedido({ nome: 'x', meses: 0 })).erro).toContain('meses');
    expect((await salvarCaixaPedido({ nome: 'x', meses: 61 })).erro).toContain('meses');
    expect((await salvarCaixaPedido({ nome: 'x', meses: 1.5 })).erro).toContain('meses');
    expect(rpcMock.mock.calls.length).toBe(antes);
  });

  it('apagar, colocar e tirar chamam as RPCs com os parâmetros certos', async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: 'k1', apagada: true }, error: null });
    await apagarCaixaPedido('k1');
    expect(rpcMock).toHaveBeenLastCalledWith('apagar_caixa_pedido_v2', { p_id: 'k1' });

    rpcMock.mockResolvedValueOnce({
      data: {
        caixa_id: 'k1',
        holder_id: 'h1',
        valor_mensal: null,
        valor_usado: 4000,
        nota: null,
        saiu_de: [{ caixa_id: 'k0', nome: 'Antiga' }],
      },
      error: null,
    });
    await colocarNaCaixa('k1', 'h1');
    expect(rpcMock).toHaveBeenLastCalledWith('colocar_na_caixa_v2', {
      p_caixa_id: 'k1',
      p_holder_id: 'h1',
    });

    rpcMock.mockResolvedValueOnce({
      data: { caixa_id: 'k1', holder_id: 'h1', removido: true },
      error: null,
    });
    await tirarDaCaixa('k1', 'h1');
    expect(rpcMock).toHaveBeenLastCalledWith('tirar_da_caixa_v2', {
      p_caixa_id: 'k1',
      p_holder_id: 'h1',
    });

    const antes = rpcMock.mock.calls.length;
    expect((await colocarNaCaixa('', 'h1')).erro).toContain('obrigatórias');
    expect((await colocarNaCaixa('k1', '')).erro).toContain('obrigatórias');
    expect(rpcMock.mock.calls.length).toBe(antes);
  });

  it('editarItemCaixa envia valor e nota e confere o devolvido', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        caixa_id: 'k1',
        holder_id: 'h1',
        valor_mensal: 4500,
        valor_usado: 4500,
        nota: 'nota',
      },
      error: null,
    });
    await editarItemCaixa('k1', 'h1', 4500, 'nota');
    expect(rpcMock).toHaveBeenLastCalledWith('editar_item_caixa_v2', {
      p_caixa_id: 'k1',
      p_holder_id: 'h1',
      p_valor_mensal: 4500,
      p_nota: 'nota',
    });

    rpcMock.mockResolvedValueOnce({
      data: {
        caixa_id: 'k1',
        holder_id: 'h1',
        valor_mensal: 4000,
        valor_usado: 4000,
        nota: 'nota',
      },
      error: null,
    });
    const divergente = await editarItemCaixa('k1', 'h1', 4500, 'nota');
    expect(divergente.dados).toBeNull();
    expect(divergente.erro).toContain('Não foi possível');

    const antes = rpcMock.mock.calls.length;
    expect((await editarItemCaixa('k1', 'h1', 0)).erro).toContain('valor');
    expect((await editarItemCaixa('k1', 'h1', -1)).erro).toContain('valor');
    expect((await editarItemCaixa('k1', 'h1', 0.004)).erro).toContain('valor');
    expect((await editarItemCaixa('k1', 'h1', 1, 'x'.repeat(301))).erro).toContain('nota');
    expect(rpcMock.mock.calls.length).toBe(antes);
  });

  it('limparOcultosDaCaixa chama a RPC e exige contagem inteira', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { caixa_id: 'k1', removidos: 2 },
      error: null,
    });
    const res = await limparOcultosDaCaixa('k1');
    expect(rpcMock).toHaveBeenLastCalledWith('limpar_ocultos_da_caixa_v2', {
      p_caixa_id: 'k1',
    });
    expect(res.dados.removidos).toBe(2);

    rpcMock.mockResolvedValueOnce({
      data: { caixa_id: 'k1', removidos: 1.5 },
      error: null,
    });
    const invalido = await limparOcultosDaCaixa('k1');
    expect(invalido.dados).toBeNull();
    expect(invalido.erro).toContain('Não foi possível');
  });

  it('falha de RPC vira erro explícito, nunca zero', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'sem rede' } });
    const res = await pedidoBolsas();
    expect(res.dados).toBeNull();
    expect(res.erro).toContain('Não foi possível');
  });
});

describe('modo exemplo do pedido de bolsas', () => {
  it('tem 25 pessoas sintéticas em 4 centros, as três equipes, duas bolsas, ended futura e duas caixas', async () => {
    const res = await dadosExemplo.pedidoBolsas();
    const dados = res.dados;
    expect(validarPedidoBolsas(dados)).toBe(true);
    expect(dados.bolsistas).toHaveLength(25);
    expect(dados.centros).toHaveLength(4);
    expect(dados.caixas).toHaveLength(2);
    expect(new Set(dados.bolsistas.map((p) => p.equipe ?? 'sem'))).toEqual(
      new Set(['pastagem', 'alertas', 'solos', 'sem'])
    );
    expect(dados.bolsistas.some((p) => p.bolsas.length >= 2)).toBe(true);
    expect(
      dados.bolsistas.some((p) =>
        p.bolsas.some((b) => b.status === 'ended' && b.vigente_hoje)
      )
    ).toBe(true);

    const caixa = dados.caixas[0];
    expect(caixa.pessoas).toBe(caixa.itens.length);
    expect(caixa.total_mensal).toBe(
      caixa.itens.reduce((soma, item) => soma + item.valor_usado, 0)
    );
    expect(caixa.total_periodo).toBe(caixa.total_mensal * caixa.meses);
  });

  it('edita a pessoa e move entre caixas levando valor e nota', async () => {
    const inicial = await dadosExemplo.pedidoBolsas();
    const origem = inicial.dados.caixas[0];
    const destino = inicial.dados.caixas[1];
    const pessoa = origem.itens[0];

    const editado = await dadosExemplo.editarItemCaixa(
      origem.id,
      pessoa.holder_id,
      1234,
      'teste'
    );
    expect(editado.erro).toBeNull();
    expect(editado.dados.valor_mensal).toBe(1234);
    expect(editado.dados.nota).toBe('teste');

    const res = await dadosExemplo.colocarNaCaixa(destino.id, pessoa.holder_id);
    expect(res.erro).toBeNull();
    expect(res.dados.valor_mensal).toBe(1234);
    expect(res.dados.nota).toBe('teste');
    expect(res.dados.saiu_de).toEqual([{ caixa_id: origem.id, nome: origem.nome }]);

    const depois = await dadosExemplo.pedidoBolsas();
    const caixaOrigem = depois.dados.caixas.find((c) => c.id === origem.id);
    const caixaDestino = depois.dados.caixas.find((c) => c.id === destino.id);
    expect(caixaOrigem.itens.some((i) => i.holder_id === pessoa.holder_id)).toBe(false);
    expect(caixaDestino.itens.some((i) => i.holder_id === pessoa.holder_id)).toBe(true);

    // Colocar de novo na mesma caixa não apaga o que foi editado.
    const repetido = await dadosExemplo.colocarNaCaixa(destino.id, pessoa.holder_id);
    expect(repetido.dados.valor_mensal).toBe(1234);
    expect(repetido.dados.nota).toBe('teste');
    expect(repetido.dados.saiu_de).toEqual([]);

    await dadosExemplo.tirarDaCaixa(destino.id, pessoa.holder_id);
    const final = await dadosExemplo.pedidoBolsas();
    expect(final.dados.caixas.find((c) => c.id === destino.id).itens.some(
      (i) => i.holder_id === pessoa.holder_id
    )).toBe(false);

    const limpo = await dadosExemplo.limparOcultosDaCaixa(destino.id);
    expect(limpo.dados).toEqual({ caixa_id: destino.id, removidos: 0 });
  });
});
