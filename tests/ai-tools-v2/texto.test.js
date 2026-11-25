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

function montar(overrides = {}) {
  const respostas = {
    resumo_projetos_v2: { data: fixture('resumo_projetos'), error: null },
    get_termos_contrato_v2: { data: fixture('termos_contrato'), error: null },
    get_pedido_bolsas_v2: { data: fixture('pedido_bolsas'), error: null },
    ...overrides,
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

async function preparar() {
  const sessao = montar();
  const centros = JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
  const termos = JSON.parse(
    (await sessao.executar('termos_contrato', { project_id: '30.901' })).paraModelo
  );
  return { sessao, centros, termos };
}

describe('marcarTexto', () => {
  it('não marca número de bloco citado e marca o inventado', async () => {
    const { sessao, centros } = await preparar();
    const livre = acharNo(centros, 'Livre — Centro Exemplo Um');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: livre.id });

    expect(sessao.marcarTexto('O livre é R$ 84.300,00.').semOrigem).toEqual([]);
    const inventado = sessao.marcarTexto('O livre é R$ 99.000,00.');
    expect(inventado.semOrigem).toHaveLength(1);
    const trecho = inventado.texto.slice(inventado.semOrigem[0].inicio, inventado.semOrigem[0].fim);
    expect(trecho).toBe('R$ 99.000,00');
  });

  it('não marca código de centro nem código de conta', async () => {
    const { sessao } = await preparar();
    expect(sessao.marcarTexto('Centro 30.901 e 78.116.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Conta 7.1.3.99 sem rubrica.').semOrigem).toEqual([]);
  });

  it('não marca data citada e marca a diferente', async () => {
    const { sessao, centros } = await preparar();
    const vigencia = acharNo(centros, 'Vigência — 30.901');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: vigencia.id });

    expect(sessao.marcarTexto('Vence em 30/09/2027.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em 2027-09-30.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em set/27.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em 30/09/2028.').semOrigem).toHaveLength(1);
    expect(sessao.marcarTexto('Vence em set/28.').semOrigem).toHaveLength(1);
  });

  it('não marca percentual citado e marca o diferente', async () => {
    const { sessao, termos } = await preparar();
    const taxa = acharNo(termos, 'Taxa total');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: taxa.id });

    expect(sessao.marcarTexto('A taxa é 9,75%.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('A taxa é 9.75%.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('A taxa é 10%.').semOrigem).toHaveLength(1);
  });

  it('reconhece moeda negativa e a marca quando não é nó', async () => {
    const { sessao } = await preparar();
    const marcado = sessao.marcarTexto('O saldo é R$ −4.250,00.');
    expect(marcado.semOrigem).toHaveLength(1);
    const trecho = marcado.texto.slice(marcado.semOrigem[0].inicio, marcado.semOrigem[0].fim);
    expect(trecho).toBe('R$ −4.250,00');
  });

  it('não marca resultado de calcular já citado em bloco', async () => {
    const { sessao, centros } = await preparar();
    const um = acharNo(centros, 'Livre — Centro Exemplo Um');
    const dois = acharNo(centros, 'Livre — Centro Exemplo Dois');
    const calculo = sessao.calcular({ op: 'soma', ids: [um.id, dois.id] });
    expect(calculo.erro).toBeUndefined();
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: calculo.id });
    expect(sessao.marcarTexto('O total é R$ 103.700,00.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('O total é R$ 103.700,01.').semOrigem).toHaveLength(1);
  });

  it('marca um número sem nenhum bloco', async () => {
    const { sessao } = await preparar();
    const marcado = sessao.marcarTexto('São 3 centros e R$ 1.234,56.');
    expect(marcado.semOrigem).toHaveLength(2);
    expect(marcado.semOrigem[0].inicio).toBeLessThan(marcado.semOrigem[1].inicio);
  });

  it('R$ 30.109 é moeda, mas 30.109 sem R$ é código de centro', async () => {
    const resumo = fixture('resumo_projetos');
    resumo.centros[0].livre = 30109;
    const sessao = montar({ resumo_projetos_v2: { data: resumo, error: null } });
    const dados = JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
    const livre = acharNo(dados, 'Livre — Centro Exemplo Um');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: livre.id });

    expect(sessao.marcarTexto('O centro 30.109.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('O valor é R$ 30.109,00.').semOrigem).toEqual([]);

    const semCitacao = montar({ resumo_projetos_v2: { data: resumo, error: null } });
    const marcado = semCitacao.marcarTexto('O valor é R$ 30.109,00.');
    expect(marcado.semOrigem).toHaveLength(1);
    expect(marcado.texto.slice(marcado.semOrigem[0].inicio, marcado.semOrigem[0].fim)).toBe(
      'R$ 30.109,00'
    );
  });

  it('milhar sem ponto em moeda é um único candidato', async () => {
    const resumo = fixture('resumo_projetos');
    resumo.centros[0].livre = 120;
    resumo.centros[0].pendencias_abertas = 0;
    const sessao = montar({ resumo_projetos_v2: { data: resumo, error: null } });
    const dados = JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
    const livre = acharNo(dados, 'Livre — Centro Exemplo Um');
    const pendencias = acharNo(dados, 'Pendências abertas — 30.901');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: livre.id });
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: pendencias.id });

    const marcado = sessao.marcarTexto('O valor é R$ 1200.');
    expect(marcado.semOrigem).toHaveLength(1);
    expect(marcado.texto.slice(marcado.semOrigem[0].inicio, marcado.semOrigem[0].fim)).toBe(
      'R$ 1200'
    );
  });

  it('data completa compara dia, mês e ano', async () => {
    const { sessao, termos } = await preparar();
    const inicio = acharNo(termos, 'Vigência — início');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: inicio.id });

    expect(sessao.marcarTexto('Vence em 31/12/2025.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em dez/25.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em 15/12/2025.').semOrigem).toHaveLength(1);
  });

  it('comparação de moeda respeita unidade e sinal', async () => {
    const resumo = fixture('resumo_projetos');
    resumo.centros[0].livre = -50;
    const sessao = montar({ resumo_projetos_v2: { data: resumo, error: null } });
    const dados = JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
    const negativo = acharNo(dados, 'Livre — Centro Exemplo Um');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: negativo.id });

    expect(sessao.marcarTexto('O saldo é R$ -50,00.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('O saldo é R$ 50,00.').semOrigem).toHaveLength(1);
    expect(sessao.marcarTexto('O saldo é 50,00.').semOrigem).toHaveLength(1);

    const total = dados.nos.find((no) => no.id === dados.total);
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: total.id });
    expect(sessao.marcarTexto('São 3 centros.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('São R$ 3,00.').semOrigem).toHaveLength(1);
  });

  it('sinal negativo entra no candidato e na comparação', async () => {
    const { sessao, centros } = await preparar();
    const total = centros.nos.find((no) => no.id === centros.total);
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: total.id });
    expect(sessao.marcarTexto('-3').semOrigem).toHaveLength(1);
    expect(sessao.marcarTexto('3').semOrigem).toEqual([]);

    const termos = fixture('termos_contrato');
    termos.termos.taxa_total.valor = -7;
    const outra = montar({ get_termos_contrato_v2: { data: termos, error: null } });
    const dadosTaxa = JSON.parse(
      (await outra.executar('termos_contrato', { project_id: '30.901' })).paraModelo
    );
    const taxa = acharNo(dadosTaxa, 'Taxa total');
    outra.criarBloco({ tipo: 'numero', titulo: '', no: taxa.id });
    expect(outra.marcarTexto('-7%').semOrigem).toEqual([]);
    expect(outra.marcarTexto('7%').semOrigem).toHaveLength(1);
  });

  it('reidratar recalcula os intervalos semOrigem', async () => {
    const { sessao } = await preparar();
    const bloco = sessao.criarBloco({
      tipo: 'texto',
      texto: 'Pessoa Exemplo Um deve R$ 500,00.',
    }).bloco;
    expect(bloco.texto.texto).not.toContain('Pessoa Exemplo Um');
    const reidratado = sessao.reidratar(bloco);
    expect(reidratado.texto.texto).toBe('Pessoa Exemplo Um deve R$ 500,00.');
    const trecho = reidratado.texto.texto.slice(
      reidratado.texto.semOrigem[0].inicio,
      reidratado.texto.semOrigem[0].fim
    );
    expect(trecho).toBe('R$ 500,00');
  });
});
