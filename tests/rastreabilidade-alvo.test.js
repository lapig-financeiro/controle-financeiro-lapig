import { describe, expect, it } from 'vitest';
import { linhasDaPagina } from '../frontend/js/origem-busca.js';
import {
  SINONIMOS_RUBRICA,
  alvoDaRubrica,
  alvoDoCabecalho,
  alvoDoDesembolso,
  alvoDoLancamento,
  alvoDoTotalPlano,
  alvosAlternativosDaRubrica,
  contaComReduzido,
  contaNaLinha,
  cortarTrecho,
  escolherLinha,
  escolherLinhaComAlternativas,
  linhaServe,
  montarFato,
  textoNaLinha,
  valorLidoDoTrecho,
  valorNaLinha,
} from '../tools/rastreabilidade/alvo.mjs';

function itensDeLinhas(linhas, yInicial = 780) {
  const itens = [];
  linhas.forEach((linha, indiceLinha) => {
    const y = yInicial - indiceLinha * 14;
    let x = 40;
    for (const palavra of linha.split(/\s+/)) {
      const largura = palavra.length * 4.5;
      itens.push({
        str: palavra,
        transform: [1, 0, 0, 1, x, y],
        width: largura,
        height: 9,
      });
      x += largura + 3;
    }
  });
  return itens;
}

function paginasDe(linhas) {
  return [linhasDaPagina(itensDeLinhas(linhas))];
}

const BALANCETE = [
  'FUNDACAO DE APOIO A PESQUISA Balancete Contabil Analitico 01/01/2000 a 15/11/2026 Pag.: 1',
  'Conta Reduzido Descricao Anterior Debitos Creditos Movimento Saldo Atual',
  '7.1.3.04.01.09142 2579142 BOLSA DOACAO 0,00 50.000,00 0,00 50.000,00 50.000,00',
  '7.1.3.05.01.00027 2506027 SERVICOS ANALISE PESQ. CIENTIFICA 0,00 15.000,00 0,00 15.000,00 15.000,00',
  'TOTAL DE DEBITOS : 120.000,00',
  'TOTAL DE CREDITOS: 315.000,00',
  'SALDO DISPONIVEL POS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ 195.000,00',
  'RENDIMENTO LIQUIDO APURADO ==>> R$ 3.500,00',
];

describe('alvo — montagem por tipo', () => {
  it('cabeçalho do balancete usa texto sem acento (como a 064)', () => {
    expect(alvoDoCabecalho('saldo_disponivel', 195000)).toEqual({
      texto: 'saldo disponivel',
      valor: 195000,
    });
    expect(alvoDoCabecalho('rendimento_liquido', 3500)).toEqual({
      texto: 'rendimento liquido',
      valor: 3500,
    });
    expect(alvoDoCabecalho('total_debitos', 120000).texto).toBe('total de debitos');
    expect(alvoDoCabecalho('total_creditos', 315000).texto).toBe('total de creditos');
    expect(() => alvoDoCabecalho('outro', 1)).toThrow();
  });

  it('lançamento usa conta_codigo e valor', () => {
    expect(alvoDoLancamento({ conta_codigo: '7.1.3.05.01.00027', saldo_atual: 15000 })).toEqual({
      conta_codigo: '7.1.3.05.01.00027',
      valor: 15000,
    });
  });

  it('total do plano usa o texto "valor total"', () => {
    expect(alvoDoTotalPlano(260000)).toEqual({ texto: 'valor total', valor: 260000 });
  });

  it('rubrica prefere a descrição livre e cai no nome da rubrica', () => {
    expect(alvoDaRubrica({
      rubrica_code: 'b',
      descricao_livre: 'Participação em congressos',
      valor_previsto: 15000,
    }, 'Serviços de Terceiros PJ')).toEqual({
      texto: 'Participação em congressos',
      valor: 15000,
    });

    expect(alvoDaRubrica({
      rubrica_code: 'a.bolsas',
      descricao_livre: null,
      valor_previsto: 200000,
    }, 'Bolsas')).toEqual({ texto: 'Bolsas', valor: 200000 });

    expect(alvoDaRubrica({
      rubrica_code: 'a.bolsas',
      descricao_livre: '  "  "  ',
      valor_previsto: 200000,
    }, 'Bolsas')).toEqual({ texto: 'Bolsas', valor: 200000 });
  });

  it('desembolso usa "Parcela N"', () => {
    expect(alvoDoDesembolso({ parcela: 2, valor: 100000 })).toEqual({
      texto: 'Parcela 2',
      valor: 100000,
    });
  });
});

describe('alvo — escolha da linha', () => {
  const paginas = paginasDe(BALANCETE);

  it('acha lançamento pelo código e valor', () => {
    const selecao = escolherLinha(paginas, alvoDoLancamento({
      conta_codigo: '7.1.3.05.01.00027',
      saldo_atual: 15000,
    }));
    expect(selecao.status).toBe('achado');
    expect(selecao.pagina).toBe(1);
    expect(selecao.linha).toBe(3);
    expect(selecao.trecho).toContain('7.1.3.05.01.00027');
    expect(selecao.trecho).toContain('15.000,00');
  });

  it('acha cabeçalho pelo texto e valor', () => {
    const selecao = escolherLinha(paginas, alvoDoCabecalho('saldo_disponivel', 195000));
    expect(selecao.status).toBe('achado');
    expect(selecao.linha).toBe(6);
  });

  it('valor diferente do código → não achado', () => {
    const selecao = escolherLinha(paginas, alvoDoLancamento({
      conta_codigo: '7.1.3.05.01.00027',
      saldo_atual: 15999.99,
    }));
    expect(selecao.status).toBe('nao_achado');
  });

  it('duas linhas que satisfazem → ambíguo (não é fato)', () => {
    const paginasDuplicadas = paginasDe([
      '7.1.3.04.01.09142 09142 BOLSA DOACAO 0,00 50.000,00 0,00 50.000,00 50.000,00',
      '7.1.3.04.01.09142 09142 BOLSA DOACAO 0,00 50.000,00 0,00 50.000,00 50.000,00',
    ]);
    const selecao = escolherLinha(paginasDuplicadas, alvoDoLancamento({
      conta_codigo: '7.1.3.04.01.09142',
      saldo_atual: 50000,
    }));
    expect(selecao.status).toBe('ambiguo');
    expect(selecao.candidatos).toHaveLength(2);
  });

  it('zero não é procurado', () => {
    expect(escolherLinha(paginas, { texto: 'total de creditos', valor: 0 })).toEqual({ status: 'zero' });
  });

  it('código cortado com # usa prefixo no começo e reduzido inteiro', () => {
    const paginasCortadas = paginasDe([
      '7.1.3.05.01.0 00042 SERVICOS 1.000,00 0,00 1.000,00',
    ]);
    expect(contaNaLinha('7.1.3.05.01.0 00042 SERVICOS 1.000,00 0,00 1.000,00', '7.1.3.05.01.0#00042')).toBe(true);
    const selecao = escolherLinha(paginasCortadas, {
      conta_codigo: '7.1.3.05.01.0#00042',
      valor: 1000,
    });
    expect(selecao.status).toBe('achado');
  });

  it('valor não casa dentro de outro número', () => {
    expect(valorNaLinha('linha 1.345,00', 345)).toBe(false);
    expect(valorNaLinha('linha 345,00', 345)).toBe(true);
    expect(valorNaLinha('linha (1.234,56)', -1234.56)).toBe(true);
    expect(valorNaLinha('linha -1.234,56', -1234.56)).toBe(true);
  });

  it('a pré-validação lê o número do trecho, não o valor do banco', () => {
    expect(valorLidoDoTrecho('BOLSA 380.000,00 0,00 380.000,00', 380000)).toBe(380000);
    expect(valorLidoDoTrecho('APARELHOS (1.234,56)', -1234.56)).toBe(-1234.56);
    // Só o sinal certo passa: o positivo não casa com o parêntese.
    expect(valorLidoDoTrecho('APARELHOS (1.234,56)', 1234.56)).toBeNull();
    expect(valorLidoDoTrecho('linha 1.345,00', 345)).toBeNull();
    expect(valorLidoDoTrecho('TOTAL DE DEBITOS: 786.300,00 TOTAL DE CREDITOS: 0,00', 786300)).toBe(786300);
    expect(valorLidoDoTrecho('sem número nenhum', 100)).toBeNull();
  });

  it('valor negativo com parênteses vira fato', () => {
    const paginasNegativas = paginasDe([
      '7.1.3.20.50.00003 APARELHOS E EQUIPAMENTOS (1.234,56)',
    ]);
    const selecao = escolherLinha(paginasNegativas, alvoDoLancamento({
      conta_codigo: '7.1.3.20.50.00003',
      saldo_atual: -1234.56,
    }));
    expect(selecao.status).toBe('achado');
  });

  it('se o corte de 500 deixa o valor de fora, não é fato', () => {
    const linhaLonga = `SALDO DISPONIVEL ${'X'.repeat(520)} 195.000,00`;
    const paginasLongas = paginasDe([linhaLonga]);
    const selecao = escolherLinha(paginasLongas, alvoDoCabecalho('saldo_disponivel', 195000));
    expect(selecao.status).toBe('corte');
    expect(linhaServe(linhaLonga, alvoDoCabecalho('saldo_disponivel', 195000))).toBe(true);
  });

  it('o corte de 500 conta caracteres reais e não parte par substituto', () => {
    const texto = `${'X'.repeat(499)}😀${'Y'.repeat(20)}`;
    const corte = cortarTrecho(texto);
    expect(Array.from(corte)).toHaveLength(500);
    expect(corte.endsWith('😀')).toBe(true);
    // O antigo slice(0, 500) cortava a metade do par (500 unidades UTF-16).
    expect(corte.length).toBe(501);
  });
});

describe('alvo — código cortado e sinônimos de rubrica (4ª e 5ª rodadas)', () => {
  const LINHAS_CORTADAS = [
    '7.1.3.02.01.0 2503002 BOLSA PESQUISA 0,00 21.496,58 0,00 21.496,58 21.496,58',
    '7.1.3.02 2521323 TOTAL DA CONTA 0,00 21.496,58 0,00 21.496,58 21.496,58',
    '7.1.3.02.01 25213231 TOTAL DA CONTA 0,00 21.496,58 0,00 21.496,58 21.496,58',
  ];
  const CONTA_COMPLETA = '7.1.3.02.01.00002';
  const VALOR = 21496.58;

  it('só a linha do reduzido serve quando o código vem cortado', () => {
    const paginas = paginasDe(LINHAS_CORTADAS);
    const alvo = alvoDoLancamento({ conta_codigo: CONTA_COMPLETA, saldo_atual: VALOR });

    expect(escolherLinha(paginas, alvo).status).toBe('nao_achado');
    expect(contaComReduzido(CONTA_COMPLETA, '2503002')).toBe('7.1.3.02.01.0#2503002');

    const { selecao, alternativa } = escolherLinhaComAlternativas(paginas, alvo, [{
      conta_codigo: contaComReduzido(CONTA_COMPLETA, '2503002'),
      valor: VALOR,
    }]);

    expect(alternativa).toBe(0);
    expect(selecao.status).toBe('achado');
    expect(selecao.linha).toBe(0);
    expect(selecao.trecho).toContain('2503002');
    expect(selecao.trecho).toContain('21.496,58');
    // As duas linhas de agregação começam pelo prefixo e têm o mesmo
    // valor; nenhuma delas vira a linha escolhida.
    expect(selecao.trecho).not.toContain('2521323');
    expect(selecao.trecho).not.toContain('25213231');
  });

  it('não tenta o reduzido quando o código completo já acha a linha', () => {
    const paginas = paginasDe(BALANCETE);
    const alvo = alvoDoLancamento({
      conta_codigo: '7.1.3.05.01.00027',
      saldo_atual: 15000,
    });
    const { selecao, alternativa } = escolherLinhaComAlternativas(paginas, alvo, [{
      conta_codigo: '7.1.3.05.01.0#2506027',
      valor: 15000,
    }]);

    expect(alternativa).toBeNull();
    expect(selecao.status).toBe('achado');
    expect(selecao.trecho).toContain('7.1.3.05.01.00027');
  });

  it('duas linhas com o mesmo prefixo, reduzido e valor continuam ambíguas', () => {
    const paginas = paginasDe([LINHAS_CORTADAS[0], LINHAS_CORTADAS[0]]);
    const { selecao, alternativa } = escolherLinhaComAlternativas(
      paginas,
      alvoDoLancamento({ conta_codigo: CONTA_COMPLETA, saldo_atual: VALOR }),
      [{ conta_codigo: '7.1.3.02.01.0#2503002', valor: VALOR }],
    );

    expect(alternativa).toBe(0);
    expect(selecao.status).toBe('ambiguo');
  });

  it('conta sem sexto segmento não gera alternativa', () => {
    expect(contaComReduzido('7.1.3', '2503002')).toBeNull();
    expect(contaComReduzido('7.1.3.02.01', '2503002')).toBeNull();
    expect(contaComReduzido('7.1.3.02.01.0#2503002', '2503002')).toBeNull();
    expect(contaComReduzido('7.1.3.02.01.00002', '')).toBeNull();
  });

  it('com o prefixo estreito, a agregação e o ramo vizinho não servem', () => {
    const paginas = paginasDe([
      '7.1.3.02.01 25213231 TOTAL DA CONTA 0,00 21.496,58 0,00 21.496,58 21.496,58',
      '7.1.3.02.012 2503002 CONTA VIZINHA 0,00 21.496,58 0,00 21.496,58 21.496,58',
    ]);
    const alvo = {
      conta_codigo: contaComReduzido(CONTA_COMPLETA, '2503002'),
      valor: VALOR,
    };

    expect(alvo.conta_codigo).toBe('7.1.3.02.01.0#2503002');
    expect(escolherLinha(paginas, alvo).status).toBe('nao_achado');
  });

  it('a linha com o sexto segmento começando pelo mesmo dígito serve', () => {
    const paginas = paginasDe([
      '7.1.3.02.01.0 2503002 BOLSA PESQUISA 0,00 21.496,58 0,00 21.496,58 21.496,58',
    ]);
    const selecao = escolherLinha(paginas, {
      conta_codigo: contaComReduzido(CONTA_COMPLETA, '2503002'),
      valor: VALOR,
    });

    expect(selecao.status).toBe('achado');
    expect(selecao.linha).toBe(0);
  });

  it('a linha com o sexto segmento de dois dígitos também serve', () => {
    const paginas = paginasDe([
      '7.1.3.02.01.00 2503002 BOLSA PESQUISA 0,00 21.496,58 0,00 21.496,58 21.496,58',
    ]);
    const selecao = escolherLinha(paginas, {
      conta_codigo: contaComReduzido(CONTA_COMPLETA, '2503002'),
      valor: VALOR,
    });

    expect(selecao.status).toBe('achado');
    expect(selecao.linha).toBe(0);
  });

  it('o mapa de sinônimos tem só as três rubricas medidas', () => {
    expect(Object.keys(SINONIMOS_RUBRICA).sort()).toEqual(['cip_ua', 'cip_ufg', 'dao']);
    expect(alvosAlternativosDaRubrica({
      rubrica_code: 'cip_ufg',
      descricao_livre: null,
      valor_previsto: 1000,
    })).toEqual([{ texto: 'Custos indiretos para a UFG', valor: 1000 }]);
    expect(alvosAlternativosDaRubrica({
      rubrica_code: 'dao',
      descricao_livre: '  ',
      valor_previsto: 600,
    })).toEqual([
      { texto: 'D.A.O da Fundação', valor: 600 },
      { texto: 'D.A.O. da Fundação', valor: 600 },
    ]);
    expect(alvosAlternativosDaRubrica({
      rubrica_code: 'a.bolsas',
      descricao_livre: null,
      valor_previsto: 800,
    })).toEqual([]);
    expect(alvosAlternativosDaRubrica({
      rubrica_code: 'cip_ufg',
      descricao_livre: 'Texto livre do plano',
      valor_previsto: 1000,
    })).toEqual([]);
  });

  it('nenhum sinônimo de cip_ua casa a UFG, nenhum de cip_ufg casa a UA', () => {
    const linhaUfg = 'Custos indiretos para a UFG 1.000,00';
    const linhasUa = [
      'Custos indiretos para a UA/Órgão 1.000,00',
      'Custos indiretos para a UA 1.000,00',
      'Custos indiretos para a Unidade 1.000,00',
    ];

    // O mapa real, não um alvo escrito à mão.
    for (const sinonimo of SINONIMOS_RUBRICA.cip_ua) {
      expect(textoNaLinha(linhaUfg, sinonimo)).toBe(false);
    }
    for (const sinonimo of SINONIMOS_RUBRICA.cip_ufg) {
      for (const linha of linhasUa) {
        expect(textoNaLinha(linha, sinonimo)).toBe(false);
      }
    }
  });

  it('os dois jeitos de escrever o DAO acham cada um a sua linha', () => {
    const dao = { rubrica_code: 'dao', descricao_livre: null, valor_previsto: 600 };
    const semPonto = escolherLinha(
      paginasDe(['D.A.O da Fundação 600,00']),
      alvosAlternativosDaRubrica(dao)[0],
    );
    const comPonto = escolherLinha(
      paginasDe(['D.A.O. da Fundação 600,00']),
      alvosAlternativosDaRubrica(dao)[1],
    );

    expect(semPonto.status).toBe('achado');
    expect(comPonto.status).toBe('achado');
  });

  it('cip_ufg e cip_ua com o mesmo valor acham cada um a sua linha', () => {
    const paginas = paginasDe([
      'Custos indiretos para a UFG 1.000,00',
      'Custos indiretos para a UA/Órgão 1.000,00',
    ]);
    const cipUfg = { rubrica_code: 'cip_ufg', descricao_livre: null, valor_previsto: 1000 };
    const cipUa = { rubrica_code: 'cip_ua', descricao_livre: null, valor_previsto: 1000 };

    const ufg = escolherLinhaComAlternativas(
      paginas,
      alvoDaRubrica(cipUfg, 'Custos Indiretos (CIP) — UFG'),
      alvosAlternativosDaRubrica(cipUfg),
    );
    expect(ufg.alternativa).toBe(0);
    expect(ufg.selecao.status).toBe('achado');
    expect(ufg.selecao.trecho).toContain('para a UFG');

    const ua = escolherLinhaComAlternativas(
      paginas,
      alvoDaRubrica(cipUa, 'Custos Indiretos (CIP) — UA/Órgão'),
      alvosAlternativosDaRubrica(cipUa),
    );
    expect(ua.alternativa).toBe(0);
    expect(ua.selecao.status).toBe('achado');
    expect(ua.selecao.trecho).toContain('para a UA/Órgão');
    expect(ua.selecao.linha).not.toBe(ufg.selecao.linha);
  });

  it('sinônimo que casa nas duas linhas é ambíguo e não vira fato', () => {
    const paginas = paginasDe([
      'Custos indiretos para a UFG 1.000,00',
      'Custos indiretos para a UA/Órgão 1.000,00',
    ]);
    const { selecao } = escolherLinhaComAlternativas(
      paginas,
      { texto: 'nome que nao aparece no documento', valor: 1000 },
      [{ texto: 'Custos indiretos', valor: 1000 }],
    );

    expect(selecao.status).toBe('ambiguo');
    expect(selecao.candidatos).toHaveLength(2);
  });
});

describe('alvo — fato no contrato da 064', () => {
  const paginas = paginasDe(BALANCETE);

  it('PDF leva pagina e bbox só com as quatro chaves', () => {
    const selecao = escolherLinha(paginas, alvoDoLancamento({
      conta_codigo: '7.1.3.05.01.00027',
      saldo_atual: 15000,
    }));
    const fato = montarFato({
      alvoTabela: 'balancete_lancamentos',
      alvoId: '00000000-0000-0000-0000-000000000001',
      campo: 'saldo_atual',
      valor: 15000,
      formato: 'pdf',
      selecao,
    });

    expect(fato).toMatchObject({
      alvo_tabela: 'balancete_lancamentos',
      alvo_id: '00000000-0000-0000-0000-000000000001',
      campo: 'saldo_atual',
      valor: 15000,
      pagina: 1,
    });
    expect(Object.keys(fato.bbox).sort()).toEqual(['x0', 'x1', 'yMax', 'yMin']);
    expect(fato.trecho.length).toBeLessThanOrEqual(500);
  });

  it('DOCX leva pagina e bbox nulos', () => {
    const selecao = escolherLinha([[
      { texto: 'Valor Total do Plano: R$ 260.000,00', x0: 10, x1: 300, yMin: 10, yMax: 20 },
    ]], alvoDoTotalPlano(260000));
    const fato = montarFato({
      alvoTabela: 'planos_trabalho',
      alvoId: '00000000-0000-0000-0000-000000000002',
      campo: 'valor_total_plano',
      valor: 260000,
      formato: 'docx',
      selecao,
    });

    expect(fato.pagina).toBeNull();
    expect(fato.bbox).toBeNull();
    expect(fato.trecho).toContain('260.000,00');
  });

  it('seleção que não é "achado" não vira fato', () => {
    expect(montarFato({
      alvoTabela: 'balancetes',
      alvoId: '00000000-0000-0000-0000-000000000003',
      campo: 'saldo_disponivel',
      valor: 1,
      formato: 'pdf',
      selecao: { status: 'nao_achado' },
    })).toBeNull();
  });
});
