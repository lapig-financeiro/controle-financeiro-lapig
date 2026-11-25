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

function montar(livres = [84300, 19400]) {
  const resumo = fixture('resumo_projetos');
  resumo.centros = resumo.centros.map((centro, indice) => ({
    ...centro,
    livre: livres[indice] ?? centro.livre,
  }));
  const respostas = {
    resumo_projetos_v2: { data: resumo, error: null },
    explicar_livre_v2: { data: fixture('explicar_livre'), error: null },
    termos_contrato_v2: { data: fixture('termos_contrato'), error: null },
    get_termos_contrato_v2: { data: fixture('termos_contrato'), error: null },
    get_pedido_bolsas_v2: { data: fixture('pedido_bolsas'), error: null },
  };
  return criarSessao({
    rpc: async (nome) => respostas[nome] ?? { data: null, error: { message: `sem fixture: ${nome}` } },
    hoje: '2026-11-25',
  });
}

function acharNo(dados, parte) {
  const no = dados.nos.find((item) => item.rotulo.includes(parte));
  expect(no, `nó "${parte}"`).toBeTruthy();
  return no;
}

async function livrosDosCentros(sessao) {
  const dados = JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
  return {
    dados,
    um: acharNo(dados, 'Livre — Centro Exemplo Um'),
    dois: acharNo(dados, 'Livre — Centro Exemplo Dois'),
  };
}

describe('calcular', () => {
  it('soma ao centavo, sem erro de ponto flutuante', async () => {
    const sessao = montar([0.1, 0.2]);
    const { um, dois } = await livrosDosCentros(sessao);
    const resultado = sessao.calcular({ op: 'soma', ids: [um.id, dois.id] });
    expect(resultado.id).toBe('c1');
    const dados = JSON.parse(resultado.paraModelo);
    expect(dados.resultado).toEqual({
      id: 'c1',
      valor: 0.3,
      rotulo: 'Soma de 2 valores',
      unidade: 'moeda',
    });
    expect(dados.partes).toEqual([
      { id: um.id, sinal: 1 },
      { id: dois.id, sinal: 1 },
    ]);
  });

  it('diferença é o primeiro menos os outros', async () => {
    const sessao = montar([10, 0.1, 0.2]);
    const { dados, um, dois } = await livrosDosCentros(sessao);
    const tres = acharNo(dados, 'Livre — Centro Exemplo Três');
    const resultado = sessao.calcular({ op: 'diferenca', ids: [um.id, dois.id, tres.id] });
    expect(resultado.erro).toBeUndefined();
    expect(JSON.parse(resultado.paraModelo).resultado.valor).toBe(9.7);
  });

  it('aceita sinais explícitos', async () => {
    const sessao = montar([10, 0.1, 0.2]);
    const { um, dois } = await livrosDosCentros(sessao);
    const resultado = sessao.calcular({
      op: 'soma',
      ids: [um.id, dois.id],
      sinais: [1, -1],
    });
    expect(JSON.parse(resultado.paraModelo).resultado.valor).toBe(9.9);
  });

  it('origem calculo fecha ao centavo e cada parte tem a própria origem', async () => {
    const sessao = montar([0.1, 0.2]);
    const { um, dois } = await livrosDosCentros(sessao);
    sessao.calcular({ op: 'soma', ids: [um.id, dois.id] });
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: 'c1' }).bloco;
    expect(bloco.numero.valor).toBe(0.3);
    expect(bloco.numero.origem.tipo).toBe('calculo');
    expect(bloco.numero.origem.op).toBe('soma');
    const soma = bloco.numero.origem.partes.reduce(
      (total, parte) => total + Math.round(parte.valor * 100) * parte.sinal,
      0
    );
    expect(soma).toBe(30);
    for (const parte of bloco.numero.origem.partes) {
      expect(parte.origem.tipo).toBe('livre');
    }
  });

  it('recusa unidades diferentes', async () => {
    const sessao = montar();
    const { dados, um } = await livrosDosCentros(sessao);
    const total = dados.nos.find((no) => no.id === dados.total);
    const resultado = sessao.calcular({ op: 'soma', ids: [um.id, total.id] });
    expect(resultado.erro).toContain('mesma unidade');
  });

  it('soma nós de numero com a mesma unidade', async () => {
    const sessao = montar();
    const { dados } = await livrosDosCentros(sessao);
    const total = dados.nos.find((no) => no.id === dados.total);
    const pendencias = acharNo(dados, 'Pendências abertas — 30.902');
    const resultado = sessao.calcular({ op: 'soma', ids: [total.id, pendencias.id] });
    const corpo = JSON.parse(resultado.paraModelo);
    expect(corpo.resultado.unidade).toBe('numero');
    expect(corpo.resultado.valor).toBe(5);
  });

  it('recusa percentual', async () => {
    const sessao = montar();
    const { um } = await livrosDosCentros(sessao);
    const dados = JSON.parse(
      (await sessao.executar('termos_contrato', { project_id: '30.901' })).paraModelo
    );
    const taxa = acharNo(dados, 'Taxa total');
    const resultado = sessao.calcular({ op: 'soma', ids: [um.id, taxa.id] });
    expect(resultado.erro).toContain('moeda ou numero');
  });

  it('moeda com mais de 2 casas é recusada', async () => {
    const sessao = montar([1.005, 0.2]);
    const { um } = await livrosDosCentros(sessao);
    const resultado = sessao.calcular({ op: 'soma', ids: [um.id, um.id] });
    expect(resultado.erro).toContain('2 casas');
  });

  it('numero usa a maior escala e as partes fecham o total', async () => {
    const resumo = fixture('resumo_projetos');
    resumo.centros[0].pendencias_abertas = 1.005;
    resumo.centros[1].pendencias_abertas = 1.005;
    const sessao = criarSessao({
      rpc: async (nome) => {
        if (nome === 'resumo_projetos_v2') return { data: resumo, error: null };
        if (nome === 'get_pedido_bolsas_v2') return { data: fixture('pedido_bolsas'), error: null };
        return { data: null, error: { message: 'sem fixture' } };
      },
    });
    const dados = JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
    const um = acharNo(dados, 'Pendências abertas — 30.901');
    const dois = acharNo(dados, 'Pendências abertas — 30.902');
    const resultado = sessao.calcular({ op: 'soma', ids: [um.id, dois.id] });
    const corpo = JSON.parse(resultado.paraModelo);
    expect(corpo.resultado.unidade).toBe('numero');
    expect(corpo.resultado.valor).toBe(2.01);

    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: resultado.id }).bloco;
    expect(bloco.numero.origem.partes.map((parte) => parte.valor)).toEqual([1.005, 1.005]);
    expect(bloco.numero.origem.partes.reduce((soma, parte) => soma + parte.valor, 0)).toBeCloseTo(
      2.01,
      10
    );
  });

  it('BigInt mantém o intermediário e o resultado dentro da faixa segura', async () => {
    const resumo = fixture('resumo_projetos');
    resumo.centros[0].pendencias_abertas = 9007199254740991;
    resumo.centros[1].pendencias_abertas = 2;
    resumo.centros[2].pendencias_abertas = 9007199254740991;
    const sessao = criarSessao({
      rpc: async (nome) => {
        if (nome === 'resumo_projetos_v2') return { data: resumo, error: null };
        if (nome === 'get_pedido_bolsas_v2') return { data: fixture('pedido_bolsas'), error: null };
        return { data: null, error: { message: 'sem fixture' } };
      },
    });
    const dados = JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
    const um = acharNo(dados, 'Pendências abertas — 30.901');
    const dois = acharNo(dados, 'Pendências abertas — 30.902');
    const tres = acharNo(dados, 'Pendências abertas — 30.903');
    const resultado = sessao.calcular({
      op: 'soma',
      ids: [um.id, dois.id, tres.id],
      sinais: [1, 1, -1],
    });
    expect(resultado.erro).toBeUndefined();
    expect(JSON.parse(resultado.paraModelo).resultado.valor).toBe(2);

    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: resultado.id }).bloco;
    expect(bloco.numero.origem.partes.map((parte) => parte.valor)).toEqual([
      9007199254740991,
      2,
      9007199254740991,
    ]);
  });

  it('resultado fora da faixa segura é erro', async () => {
    const resumo = fixture('resumo_projetos');
    resumo.centros[0].pendencias_abertas = 9007199254740991;
    resumo.centros[1].pendencias_abertas = 2;
    const sessao = criarSessao({
      rpc: async (nome) => {
        if (nome === 'resumo_projetos_v2') return { data: resumo, error: null };
        if (nome === 'get_pedido_bolsas_v2') return { data: fixture('pedido_bolsas'), error: null };
        return { data: null, error: { message: 'sem fixture' } };
      },
    });
    const dados = JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
    const um = acharNo(dados, 'Pendências abertas — 30.901');
    const dois = acharNo(dados, 'Pendências abertas — 30.902');
    const resultado = sessao.calcular({ op: 'soma', ids: [um.id, dois.id] });
    expect(resultado.erro).toContain('faixa segura');
  });

  it('recusa id inexistente', async () => {
    const sessao = montar();
    const { um } = await livrosDosCentros(sessao);
    const resultado = sessao.calcular({ op: 'soma', ids: [um.id, 'r9.9'] });
    expect(resultado.erro).toContain('nó não encontrado');
  });

  it('recusa op inválida, ids vazio e diferença com um id', async () => {
    const sessao = montar();
    const { um } = await livrosDosCentros(sessao);
    expect(sessao.calcular({ op: 'razao', ids: [um.id] }).erro).toContain('op inválido');
    expect(sessao.calcular({ op: 'soma', ids: [] }).erro).toContain('ids');
    expect(sessao.calcular({ op: 'diferenca', ids: [um.id] }).erro).toContain('dois nós');
  });

  it('número do cálculo já citado não é marcado no texto', async () => {
    const sessao = montar([0.1, 0.2]);
    const { um, dois } = await livrosDosCentros(sessao);
    sessao.calcular({ op: 'soma', ids: [um.id, dois.id] });
    const marcado = sessao.marcarTexto('O total é R$ 0,30.');
    expect(marcado.semOrigem).toEqual([]);
    const inventado = sessao.marcarTexto('O total é R$ 0,31.');
    expect(inventado.semOrigem).toHaveLength(1);
  });
});
