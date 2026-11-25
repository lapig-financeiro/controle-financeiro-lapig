import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { criarSessao } from '../../shared/ai-tools/index.js';

const aqui = dirname(fileURLToPath(import.meta.url));

function fixture(nome) {
  return JSON.parse(
    readFileSync(resolve(aqui, '..', 'fixtures', 'ai-tools-v2', `${nome}.json`), 'utf8')
  );
}

function respostasPadrao() {
  return {
    resumo_projetos_v2: { data: fixture('resumo_projetos'), error: null },
    explicar_livre_v2: { data: fixture('explicar_livre'), error: null },
    situacao_centro_v2: { data: fixture('situacao_centro'), error: null },
    get_repasses_v2: { data: fixture('repasses'), error: null },
    get_termos_contrato_v2: { data: fixture('termos_contrato'), error: null },
    listar_pendencias_v2: { data: fixture('pendencias'), error: null },
    get_pedido_bolsas_v2: { data: fixture('pedido_bolsas'), error: null },
  };
}

function montar(overrides = {}) {
  const respostas = { ...respostasPadrao(), ...overrides };
  const chamadas = [];
  const rpc = async (nome, args) => {
    chamadas.push({ nome, args });
    const resposta = respostas[nome];
    if (typeof resposta === 'function') return resposta(args);
    return resposta ?? { data: null, error: { message: `sem fixture: ${nome}` } };
  };
  const sessao = criarSessao({ rpc, hoje: '2026-11-25' });
  return { sessao, chamadas, respostas };
}

function json(resultado) {
  return JSON.parse(resultado.paraModelo);
}

describe('criarSessao', () => {
  it('exige a RPC injetada', () => {
    expect(() => criarSessao({})).toThrow(/rpc/);
  });

  it('executa listar_centros e devolve id e paraModelo', async () => {
    const { sessao } = montar();
    const resultado = await sessao.executar('listar_centros', {});
    expect(resultado.id).toBe('r1');
    const dados = json(resultado);
    expect(dados.centros).toHaveLength(3);
    expect(dados.total).toMatch(/^r1\./);
    expect(dados.nos.length).toBeGreaterThan(0);
    for (const no of dados.nos) {
      expect(Object.keys(no).sort()).toEqual(['id', 'rotulo', 'unidade', 'valor']);
    }
  });

  it('numera resultados em sequência', async () => {
    const { sessao } = montar();
    expect((await sessao.executar('listar_centros', {})).id).toBe('r1');
    expect((await sessao.executar('explicar_livre', { project_id: '30.901' })).id).toBe('r2');
    expect((await sessao.executar('situacao_centro', { project_id: '30.901' })).id).toBe('r3');
  });

  it('ferramenta desconhecida volta como erro', async () => {
    const { sessao } = montar();
    const resultado = await sessao.executar('nao_existe', {});
    expect(resultado.erro).toMatch(/desconhecida/);
  });

  it('erro da RPC volta como { id, erro }, nunca zero nem lista vazia', async () => {
    const { sessao } = montar({
      resumo_projetos_v2: { data: null, error: { message: 'falhou de propósito' } },
    });
    const resultado = await sessao.executar('listar_centros', {});
    expect(resultado.id).toBe('r1');
    expect(resultado.erro).toContain('falhou de propósito');
    expect(resultado.paraModelo).toBeUndefined();
  });

  it('exceção da RPC também vira erro', async () => {
    const { sessao } = montar({
      explicar_livre_v2: () => {
        throw new Error('sem rede');
      },
    });
    const resultado = await sessao.executar('explicar_livre', { project_id: '30.901' });
    expect(resultado.id).toBe('r1');
    expect(resultado.erro).toContain('sem rede');
  });

  it('formato inesperado vira erro, não resultado vazio', async () => {
    const { sessao } = montar({ explicar_livre_v2: { data: { foo: 1 }, error: null } });
    const resultado = await sessao.executar('explicar_livre', { project_id: '30.901' });
    expect(resultado.erro).toMatch(/Formato inesperado/);
    expect(resultado.paraModelo).toBeUndefined();
  });
});

describe('resolução do centro', () => {
  it('aceita código e id', async () => {
    const { sessao } = montar();
    const porCodigo = await sessao.executar('explicar_livre', { project_id: '30.901' });
    const porId = await sessao.executar('explicar_livre', {
      project_id: '00000000-0000-4000-8000-000000030901',
    });
    expect(porCodigo.erro).toBeUndefined();
    expect(porId.erro).toBeUndefined();
  });

  it('centro oculto da lista não é encontrado no acesso', async () => {
    const { sessao } = montar();
    const resultado = await sessao.executar('explicar_livre', { project_id: '30.904' });
    expect(resultado.erro).toBe('Centro não encontrado no seu acesso.');
  });

  it('centro inexistente é o mesmo erro, sem oráculo', async () => {
    const { sessao } = montar();
    const resultado = await sessao.executar('explicar_livre', { project_id: '30.999' });
    expect(resultado.erro).toBe('Centro não encontrado no seu acesso.');
  });

  it('argumento vazio explica o formato aceito', async () => {
    const { sessao } = montar();
    const resultado = await sessao.executar('explicar_livre', { project_id: '' });
    expect(resultado.erro).toMatch(/código \(30\.901\) ou pelo id/);
  });

  it('carrega a lista uma vez e reaproveita nos outros tools', async () => {
    const { sessao, chamadas } = montar();
    await sessao.executar('explicar_livre', { project_id: '30.901' });
    await sessao.executar('listar_centros', {});
    await sessao.executar('pendencias', { project_id: '30.902' });
    const resumos = chamadas.filter((chamada) => chamada.nome === 'resumo_projetos_v2');
    expect(resumos).toHaveLength(1);
  });
});
