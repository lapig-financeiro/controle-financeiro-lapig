import { describe, expect, it } from 'vitest';
import { linhasDaPagina } from '../frontend/js/origem-busca.js';
import {
  alvoDaRubrica,
  alvoDoCabecalho,
  alvoDoDesembolso,
  alvoDoLancamento,
  alvoDoTotalPlano,
  contaNaLinha,
  escolherLinha,
  linhaServe,
  montarFato,
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
