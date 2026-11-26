import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('../src/servicos/supabase.js', () => ({
  SUPABASE_URL: 'https://exemplo.supabase.co',
  SUPABASE_KEY: 'chave-publica',
  supabase: {
    auth: { getSession: vi.fn() },
    rpc: rpcMock,
  },
}));

import {
  excluirConversa,
  lerConversa,
  listarConversas,
  renomearConversa,
} from '../src/servicos/analiseHistorico.js';

const CONV_A = '00000000-0000-4000-8000-000000000a01';
const REG_1 = '00000000-0000-4000-8000-000000000b01';

function meta(id, titulo) {
  return {
    id,
    titulo,
    criada_em: '2026-11-26T10:00:00-03:00',
    atualizada_em: '2026-11-26T14:32:00-03:00',
    turnos: 1,
  };
}

function turno() {
  return {
    registro: REG_1,
    ordem: 1,
    pergunta: 'Quanto o 30.910 tem livre?',
    resposta: {
      texto: { texto: 'R$ 52.000,00.', semOrigem: [] },
      blocos: [],
    },
    desfecho: 'ok',
    desfecho_calculado: 'ok',
    iniciada_em: '2026-11-26T14:30:00-03:00',
    terminada_em: '2026-11-26T14:32:00-03:00',
    rodadas: 2,
    ms: 1200,
    feedback: null,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('serviços reais do histórico (075)', () => {
  it('listarConversas chama a RPC com limite e antes e devolve a lista validada', async () => {
    rpcMock.mockResolvedValue({ data: [meta(CONV_A, 'Saldo')], error: null });
    const r = await listarConversas({ limite: 10, antes: '2026-11-26T15:00:00-03:00' });

    expect(r).toEqual({ dados: [meta(CONV_A, 'Saldo')], erro: null });
    expect(rpcMock).toHaveBeenCalledWith('analise_conversas_listar', {
      p_limite: 10,
      p_antes: '2026-11-26T15:00:00-03:00',
    });
  });

  it('falha da lista nunca vira lista vazia', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '42501' } });
    const r = await listarConversas();
    expect(r.dados).toBeNull();
    expect(r.erro).toBe('Não foi possível carregar as conversas.');
  });

  it('item malformado da lista também é falha, não lista parcial', async () => {
    rpcMock.mockResolvedValue({
      data: [meta(CONV_A, 'Ok'), { id: 'não é uuid', titulo: '', turnos: -1 }],
      error: null,
    });
    const r = await listarConversas();
    expect(r.dados).toBeNull();
    expect(r.erro).toBe('Não foi possível carregar as conversas.');
  });

  it('lerConversa valida o id e devolve os turnos; falha vira erro', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: CONV_A,
        titulo: 'Saldo',
        criada_em: '2026-11-26T10:00:00-03:00',
        atualizada_em: '2026-11-26T14:32:00-03:00',
        turnos: [turno()],
      },
      error: null,
    });
    const r = await lerConversa(CONV_A);
    expect(r.erro).toBeNull();
    expect(r.dados.turnos).toHaveLength(1);
    expect(rpcMock).toHaveBeenCalledWith('analise_conversa_ler', { p_conversa: CONV_A });

    rpcMock.mockClear();
    const invalido = await lerConversa('não é uuid');
    expect(invalido.dados).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();

    rpcMock.mockResolvedValue({
      data: { id: CONV_A, titulo: 'Saldo', turnos: [{}] },
      error: null,
    });
    const malformado = await lerConversa(CONV_A);
    expect(malformado.dados).toBeNull();
    expect(malformado.erro).toBe('Não foi possível carregar esta conversa.');
  });

  it('renomearConversa faz btrim, recusa título vazio e trata 42501', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const ok = await renomearConversa(CONV_A, '  Novo título  ');
    expect(ok).toEqual({ dados: null, erro: null });
    expect(rpcMock).toHaveBeenCalledWith('analise_conversa_renomear', {
      p_conversa: CONV_A,
      p_titulo: 'Novo título',
    });

    rpcMock.mockClear();
    const vazio = await renomearConversa(CONV_A, '   ');
    expect(vazio.erro).toBe('O título precisa ter entre 1 e 120 caracteres.');
    expect(rpcMock).not.toHaveBeenCalled();

    rpcMock.mockResolvedValue({ data: null, error: { code: '42501' } });
    const alheia = await renomearConversa(CONV_A, 'Título');
    expect(alheia.erro).toBe('Esta conversa não está mais disponível.');
  });

  it('excluirConversa chama a RPC e trata 42501', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const ok = await excluirConversa(CONV_A);
    expect(ok).toEqual({ dados: null, erro: null });
    expect(rpcMock).toHaveBeenCalledWith('analise_conversa_excluir', {
      p_conversa: CONV_A,
    });

    rpcMock.mockResolvedValue({ data: null, error: { code: '42501' } });
    const alheia = await excluirConversa(CONV_A);
    expect(alheia.erro).toBe('Esta conversa não está mais disponível.');
  });
});

describe('histórico no modo exemplo', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DADOS', 'exemplo');
    rpcMock.mockReset();
  });

  it('lista duas conversas (uma de hoje, uma de ontem) sem tocar a rede', async () => {
    const r = await listarConversas();
    expect(r.erro).toBeNull();
    expect(r.dados).toHaveLength(2);
    expect(r.dados[0].titulo).toBe('Saldo livre do 30.910');
    expect(r.dados[1].titulo).toBe('Bolsas do 30.901');
    expect(rpcMock).not.toHaveBeenCalled();

    const lida = await lerConversa(r.dados[0].id);
    expect(lida.erro).toBeNull();
    expect(lida.dados.turnos).toHaveLength(2);
    expect(lida.dados.turnos[0].ordem).toBe(1);
    expect(lida.dados.turnos[1].ordem).toBe(2);
  });

  it('renomeia e exclui a conversa de exemplo', async () => {
    const lista = (await listarConversas()).dados;
    const alvo = lista[0];

    const renomeada = await renomearConversa(alvo.id, 'Título de exemplo');
    expect(renomeada).toEqual({ dados: null, erro: null });
    expect((await lerConversa(alvo.id)).dados.titulo).toBe('Título de exemplo');

    const excluida = await excluirConversa(alvo.id);
    expect(excluida).toEqual({ dados: null, erro: null });
    const depois = await listarConversas();
    expect(depois.dados.map((item) => item.id)).not.toContain(alvo.id);
    expect(depois.dados).toHaveLength(1);

    const inexistente = await lerConversa('00000000-0000-4000-8000-000000000aff');
    expect(inexistente.dados).toBeNull();
  });
});
