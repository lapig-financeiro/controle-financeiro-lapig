import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { criarSessao } from '../../shared/ai-tools/index.js';
import { marcarNumeros } from '../../shared/ai-tools/texto.js';

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

  it('data não é número a conferir, nem a citada nem a diferente', async () => {
    const { sessao, centros } = await preparar();
    const vigencia = acharNo(centros, 'Vigência — 30.901');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: vigencia.id });

    expect(sessao.marcarTexto('Vence em 30/09/2027.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em 2027-09-30.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em set/27.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em 30/09/2028.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em set/28.').semOrigem).toEqual([]);
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

  it('data completa não é conferida contra nó de data', async () => {
    const { sessao, termos } = await preparar();
    const inicio = acharNo(termos, 'Vigência — início');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: inicio.id });

    expect(sessao.marcarTexto('Vence em 31/12/2025.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em dez/25.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em 15/12/2025.').semOrigem).toEqual([]);
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

describe('números — conferência final da 4ª rodada', () => {
  const moeda = (valor) => ({ unidade: 'moeda', valor });
  const numero = (valor) => ({ unidade: 'numero', valor });

  it('sinal colado antes de R$ faz parte do valor', () => {
    expect(marcarNumeros('Desconto -R$ 1200', [moeda(1200)])).toEqual([{ inicio: 9, fim: 17 }]);
    expect(marcarNumeros('Desconto -R$ 1200', [moeda(-1200)])).toEqual([]);
    expect(marcarNumeros('Desconto R$ -1200', [moeda(-1200)])).toEqual([]);
  });

  it('sinal colado depois de letra também conta; letra antes de R$ não esconde moeda', () => {
    expect(marcarNumeros('Desconto-R$ 1200', [moeda(1200)])).toEqual([{ inicio: 8, fim: 16 }]);
    expect(marcarNumeros('Desconto-R$ 1200', [moeda(-1200)])).toEqual([]);
    expect(marcarNumeros('TotalR$ 1200', [numero(1200)])).toEqual([{ inicio: 5, fim: 12 }]);
    expect(marcarNumeros('TotalR$ 1200', [moeda(1200)])).toEqual([]);
    expect(marcarNumeros('1200-R$ 300', [numero(1200), moeda(300)])).toEqual([]);
  });

  it('subtração com espaço não gruda o sinal no valor seguinte', () => {
    expect(marcarNumeros('R$ 1.200 - R$ 300', [moeda(1200), moeda(300)])).toEqual([]);
  });

  it('código de centro seguido de decimal é número', () => {
    expect(marcarNumeros('30.109,50', [numero(50)])).toEqual([{ inicio: 0, fim: 9 }]);
    expect(marcarNumeros('30.109,50', [numero(30109.5)])).toEqual([]);
    expect(marcarNumeros('O centro 30.109 tem saldo.', [])).toEqual([]);
  });
});

describe('data mês/ano (MM/AAAA)', () => {
  const data = (valor) => ({ unidade: 'data', valor });
  function trechos(texto, semOrigem) {
    return semOrigem.map((faixa) => texto.slice(faixa.inicio, faixa.fim));
  }

  it('MM/AAAA com percentual ou decimal colado não é data e não encobre o número', () => {
    expect(marcarNumeros('11/2026%', [data('2026-11-30')])).not.toEqual([]);
    expect(marcarNumeros('11/2026,5', [data('2026-11-30')])).not.toEqual([]);
    expect(marcarNumeros('11/2026  %', [data('2026-11-30')])).not.toEqual([]);
  });

  it('MM/AAAA é data e não se confere, com ou sem nó de data', () => {
    expect(marcarNumeros('Vence em 09/2027.', [data('2027-09-30')])).toEqual([]);
    expect(marcarNumeros('Vence em 10/2027.', [data('2027-09-30')])).toEqual([]);
    expect(marcarNumeros('Vence em 10/2027.', [])).toEqual([]);
  });

  it('11/2026 sem nó de data também é data, não número', () => {
    expect(marcarNumeros('O balancete cobre até 11/2026.', [])).toEqual([]);
  });

  it('não quebra dd/mm/aaaa, 1/2 nem 30.109', () => {
    expect(marcarNumeros('15/12/2025', [data('2025-12-15')])).toEqual([]);
    expect(marcarNumeros('15/12/2025', [data('2025-12-16')])).toEqual([]);
    expect(trechos('32/01/2026', marcarNumeros('32/01/2026', [data('2026-01-15')]))).toEqual([
      '32',
      '01',
    ]);
    expect(marcarNumeros('1/2', [data('2001-02-01')])).toHaveLength(2);
    expect(marcarNumeros('O centro 30.109 tem saldo.', [])).toEqual([]);
  });
});

describe('A7 — nome de centro, ano sozinho e valor em R$', () => {
  const nomes = ['GPW fase 2', 'Centro Exemplo Um'];
  function trechos(texto, semOrigem) {
    return semOrigem.map((faixa) => texto.slice(faixa.inicio, faixa.fim));
  }

  it('dígito dentro do nome do centro listado não é sem origem', () => {
    expect(marcarNumeros('O GPW fase 2 está em dia.', [], { nomesCentros: nomes })).toEqual([]);
    expect(trechos('O GPW fase 2 está em dia.', marcarNumeros('O GPW fase 2 está em dia.'))).toEqual([
      '2',
    ]);
  });

  it('nome do centro compara sem acento e sem maiúsculas, com fronteira de palavra', () => {
    expect(marcarNumeros('O gpw FÁSE 2 está em dia.', [], { nomesCentros: nomes })).toEqual([]);
    expect(
      trechos('O GPW fase 27 tem saldo.', marcarNumeros('O GPW fase 27 tem saldo.', [], { nomesCentros: nomes }))
    ).toEqual(['27']);
  });

  // Frases representativas das perguntas 2, 11, 13, 14, 15 e 16 da bateria
  // real (nome de projeto "GPW fase 2", ano sozinho e data no texto).
  it.each([
    'O GPW fase 2 e o Centro Exemplo Um estão em dia.',
    'Os maiores livres são do GPW fase 2.',
    'O balancete do GPW fase 2 cobre até 10/2026.',
    'O contrato do GPW fase 2 vence em março de 2027.',
    'A folha do GPW fase 2 está atrasada desde 2026.',
    'Em 2026, o GPW fase 2 recebeu a primeira parcela.',
    'O GPW fase 2 vence em 30/09/2027.',
  ])('frase com nome/ano/data não gera sem origem: %s', (texto) => {
    expect(marcarNumeros(texto, [], { nomesCentros: nomes })).toEqual([]);
  });

  it('ano sozinho não é número; ano em R$ ou com %/decimal continua sendo', () => {
    expect(marcarNumeros('em 2026', [])).toEqual([]);
    expect(marcarNumeros('fim de 2026', [])).toEqual([]);
    expect(marcarNumeros('março de 2027', [])).toEqual([]);
    expect(marcarNumeros('R$ 2026', [])).toHaveLength(1);
    expect(trechos('R$ 2026', marcarNumeros('R$ 2026', []))).toEqual(['R$ 2026']);
    expect(trechos('R$ -2026', marcarNumeros('R$ -2026', []))).toEqual(['R$ -2026']);
    expect(trechos('-2026', marcarNumeros('-2026', []))).toEqual(['-2026']);
    expect(trechos('R$ 2.026,00', marcarNumeros('R$ 2.026,00', []))).toEqual(['R$ 2.026,00']);
    expect(trechos('2026%', marcarNumeros('2026%', []))).toEqual(['2026%']);
    expect(trechos('2026,5', marcarNumeros('2026,5', []))).toEqual(['2026,5']);
    expect(trechos('2026.5', marcarNumeros('2026.5', []))).toEqual(['2026.5']);
  });

  it('R$ 500,00 sem nó continua sem origem', () => {
    expect(trechos('O custo é R$ 500,00.', marcarNumeros('O custo é R$ 500,00.', []))).toEqual([
      'R$ 500,00',
    ]);
  });

  it('todos os formatos de data são ignorados, inclusive os dígitos internos', () => {
    expect(marcarNumeros('15/12/2025', [])).toEqual([]);
    expect(marcarNumeros('12/2025', [])).toEqual([]);
    expect(marcarNumeros('2025-12-15', [])).toEqual([]);
    expect(marcarNumeros('jan/2027', [])).toEqual([]);
    expect(marcarNumeros('dez/2027', [])).toEqual([]);
  });
});

describe('semMarkdownDeEnfase', () => {
  it('tira negrito e título de markdown sem mexer em asterisco solto', async () => {
    const { semMarkdownDeEnfase } = await import('../../shared/ai-tools/texto.js');
    expect(semMarkdownDeEnfase('O ICS tem **R$ 514.864,60** livres.')).toBe('O ICS tem R$ 514.864,60 livres.');
    expect(semMarkdownDeEnfase('## Leitura\nfim')).toBe('Leitura\nfim');
    expect(semMarkdownDeEnfase('a*b e 2*3')).toBe('a*b e 2*3');
  });
});

