import { describe, it, expect } from 'vitest';
import {
  linhasDaPagina,
  formatarValor,
  acharAlvo,
  marcarNoHtml,
} from '../frontend/js/origem-busca.js';
import { textoDaPagina } from '../frontend/js/parsers/pdf-texto.js';

/* ============================================================
   Fixtures:
   - LINHAS_30113 e LINHAS_30076 são as linhas de exemplo do topo
     de tests/balancete-parser.test.js (o texto que o pdf.js extrai
     do PDF real da FUNAPE);
   - `itensDeLinhas` monta `page.getTextContent().items` como o
     pdf.js faz: uma palavra por item, X crescendo dentro da linha
     e Y caindo 14 pontos a cada linha.
   ============================================================ */

const LINHAS_30113 = `FUNDACAO DE APOIO A PESQUISA - CNPJ 00.799.205/0001-89 Balancete Contábil Analítico 01/01/2000 a 13/04/2026 Pág.: 1
00.799.205/0001-89 Emissão: 15/04/2026 11:44
Conta Reduzido Descrição Anterior Débitos Créditos Movimento Saldo Atual
1 1 A T I V O 0,00 837.793,60 (655.992,51) 181.801,09 181.801,09
1.1.1.02.02 3224 BANCOS CONTA MOVIMENTO - PROJETO 0,00 496.182,96 (496.182,96) 0,00 0,00
1.1.1.02.02.98491 98491 30.113 24036-2 BB/FU PROJ CIRAND 0,00 496.182,96 (496.182,96) 0,00 0,00
7 2592167 RESULTADO DE RECURSOS COM RESTRI 0,00 (197.530,40) 0,00 (197.530,40) (197.530,40)
7.1.3 25213222 CUSTOS/DESPESAS RECURSOS C/ REST 0,00 197.530,40 0,00 197.530,40 197.530,40
7.1.3.03 2521324 MATERIAL DE CONSUMO 0,00 225,80 0,00 225,80 225,80
7.1.3.03.01 25213241 MATERIAL DE CONSUMO 0,00 225,80 0,00 225,80 225,80
7.1.3.03.01.00006 2504006 MATERIAL DE CONSUMO 0,00 225,80 0,00 225,80 225,80
7.1.3.04 2521325 SERVIÇOS TERCEIROS PESSOA FISICA 0,00 158.000,00 0,00 158.000,00 158.000,00
7.1.3.04.01 25213251 SERVIÇOS TERCEIROS PESSOA FISICA 0,00 158.000,00 0,00 158.000,00 158.000,00
7.1.3.04.01.09142 2579142 BOLSA DOAÇÃO 0,00 158.000,00 0,00 158.000,00 158.000,00
7.1.3.05 2521326 SERVIÇOS TERCEIROS PESSOA JURIDI 0,00 38.293,53 0,00 38.293,53 38.293,53
7.1.3.05.01 25213261 SERVIÇOS TERCEIROS PESSOA JURIDI 0,00 38.293,53 0,00 38.293,53 38.293,53
7.1.3.05.01.00027 2506027 SERVIÇOS ANALISE PESQU CIENTIFI 0,00 345,00 0,00 345,00 345,00
7.1.3.05.01.00051 252475 DESPESA ADM E OPERACIONAL (DAO) 0,00 19.678,48 0,00 19.678,48 19.678,48
7.1.3.05.01.00054 2506054 DESPESA SERVIÇOS BANCÁRIOS 0,00 126,28 0,00 126,28 126,28
7.1.3.05.01.99520 2599520 FUNDO LOCAL CIP 0,00 6.036,56 0,00 6.036,56 6.036,56
7.1.3.05.01.99521 2599521 FUNDO INSTITUCIONAL CIP 0,00 12.107,21 0,00 12.107,21 12.107,21
7.1.3.60 2599328 DESPESAS TRIBUTARIAS 0,00 461,07 0,00 461,07 461,07
7.1.3.60.01.00001 2599330 IR S/APLICAÇÃO FINANCEIRA 0,00 296,74 0,00 296,74 296,74
7.1.3.60.01.00002 2599331 IOF S/APLICAÇÃO FINANCEIRA 0,00 164,33 0,00 164,33 164,33
7.1.3.62.01.98298 2598298 DESPESA COM IOF S/ RECEBIMENTO D 0,00 550,00 0,00 550,00 550,00
TOTAL DE DÉBITOS : 1.194.120,60
TOTAL DE CRÉDITOS: 1.194.120,60
SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ 143.260,76
RENDIMENTO LÍQUIDO APURADO ==>> R$ 4.213,69
GOIÂNIA, 15 de Abril de 2026`.split('\n');

const LINHAS_30076 = `FUNDACAO DE APOIO A PESQUISA Balancete Contábil Analítico 01/01/2000 a 10/05/2026 Pág.: 1
00.799.205/0001-89 Emissão: 12/05/2026 08:20
Conta Reduzido Descrição Anterior Débitos Créditos Movimento Saldo Atual
1.1.1.02.02 3224 BANCOS CONTA MOVIMENTO - PROJETO 0,00 1.238.314,65 (1.238.314,65) 0,00 0,00
1.1.1.02.02.93627 93627 30.076 21258-X BB/FU LAPIG/HOLAN 0,00 1.238.314,65 (1.238.314,65) 0,00 0,00
7.1.3.04.01.09142 2579142 BOLSA DOAÇÃO 0,00 292.650,00 0,00 292.650,00 292.650,00
7.1.3.05.01.00017 2506017 PROGRAMA ALIMENTAÇÃO TRABALHADOR 0,00 520,08 (5,00) 515,08 515,08
7.1.3.05.01.00042 2506042 PASSAGENS E DEPESAS COM LOCOMOÇÃ 0,00 20.255,80 0,00 20.255,80 20.255,80
7.1.3.05.01.00051 252475 DESPESA ADM E OPERACIONAL (DAO) 0,00 28.742,75 (76,62) 28.666,13 28.666,13
7.1.3.05.01.00062 252476 FUNDO INSTITUCIONAL 0,00 8.444,94 0,00 8.444,94 8.444,94
7.1.3.05.01.99521 2599521 FUNDO INSTITUCIONAL CIP 0,00 508,60 (19,26) 489,34 489,34
TOTAL DE DÉBITOS : 3.631.397,10
TOTAL DE CRÉDITOS: 3.631.397,10
SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ 278.735,05
RENDIMENTO LÍQUIDO APURADO ==>> R$ 48.808,00
GOIÂNIA, 12 de Maio de 2026`.split('\n');

const Y_INICIAL = 780;
const PASSO_ENTRE_LINHAS = 14;
const ALTURA_DO_ITEM = 9;
const LARGURA_POR_LETRA = 4.5;

/**
 * `page.getTextContent().items` sintéticos: uma palavra por item,
 * com o Y caindo a cada linha (no PDF o Y cresce para cima, então
 * a linha de baixo tem o Y menor).
 */
function itensDeLinhas(linhas, yInicial = Y_INICIAL) {
  const itens = [];
  linhas.forEach((linha, indiceLinha) => {
    const y = yInicial - indiceLinha * PASSO_ENTRE_LINHAS;
    let x = 40;
    for (const palavra of linha.split(/\s+/)) {
      const largura = palavra.length * LARGURA_POR_LETRA;
      itens.push({
        str: palavra,
        transform: [1, 0, 0, 1, x, y],
        width: largura,
        height: ALTURA_DO_ITEM,
      });
      x += largura + 3;
    }
  });
  return itens;
}

function paginasDe(linhas) {
  return [linhasDaPagina(itensDeLinhas(linhas))];
}

describe('linhasDaPagina — agrupamento e coordenadas', () => {
  it('reconstrói as linhas do balancete na ordem dos itens', () => {
    const linhas = linhasDaPagina(itensDeLinhas(LINHAS_30113));
    expect(linhas).toHaveLength(LINHAS_30113.length);
    expect(linhas.map((l) => l.texto)).toEqual(LINHAS_30113);
  });

  it('usa a MESMA quebra de linha de textoDaPagina (Y muda mais de 2 pontos)', () => {
    const itens = [
      { str: 'A', transform: [1, 0, 0, 1, 10, 100], width: 5, height: 9 },
      { str: 'B', transform: [1, 0, 0, 1, 20, 101.9], width: 5, height: 9 },
      { str: 'C', transform: [1, 0, 0, 1, 10, 90], width: 5, height: 9 },
    ];
    const linhas = linhasDaPagina(itens);
    expect(linhas.map((l) => l.texto)).toEqual(['A B', 'C']);
    expect(
      textoDaPagina(itens).split('\n').map((l) => l.trim()),
    ).toEqual(['A B', 'C']);
  });

  it('devolve coordenadas do PDF e os índices dos itens de cada linha', () => {
    const itens = itensDeLinhas(LINHAS_30113);
    const linhas = linhasDaPagina(itens);
    const linha = linhas[15]; // "7.1.3.05.01 25213261 …"

    expect(linha.texto.startsWith('7.1.3.05.01 25213261')).toBe(true);
    expect(linha.x0).toBe(40);
    // Base da linha menos 20% da altura (letras que descem) até base + altura.
    const base = Y_INICIAL - 15 * PASSO_ENTRE_LINHAS;
    expect(linha.yMin).toBeCloseTo(base - 0.2 * ALTURA_DO_ITEM, 9);
    expect(linha.yMax).toBeCloseTo(base + ALTURA_DO_ITEM, 9);
  });

  it('valor zero não é alvo (marcaria toda linha com 0,00)', () => {
    const linhas = linhasDaPagina([
      { str: 'A 0,00', transform: [1, 0, 0, 1, 0, 100], width: 10, height: 6 },
      { str: 'SALDO DISPONÍVEL', transform: [1, 0, 0, 1, 0, 80], width: 10, height: 6 },
    ]);
    expect(acharAlvo([linhas], { valor: 0, texto: 'saldo disponivel' })).toEqual([{ pagina: 1, linha: 1, motivo: 'texto' }]);
  });

  it('item de altura 0 (célula vazia) não aumenta a altura da linha', () => {
    const itens = [
      { str: '7.1.3', transform: [1, 0, 0, 1, 40, 100], width: 20, height: 6 },
      { str: '', transform: [1, 0, 0, 1, 70, 100], width: 0, height: 0 },
    ];
    const [linha] = linhasDaPagina(itens);
    expect(linha.yMax).toBeCloseTo(106, 9);
    expect(linha.yMin).toBeCloseTo(98.8, 9);
  });

  it('linhas sem nenhuma altura usam a altura mínima', () => {
    const [linha] = linhasDaPagina([{ str: 'x', transform: [1, 0, 0, 1, 0, 50], width: 5, height: 0 }]);
    expect(linha.yMax).toBeGreaterThan(50);
  });

  it('mantém os índices dos itens', () => {
    const itens = itensDeLinhas(LINHAS_30113);
    const linha = linhasDaPagina(itens)[15];
    expect(linha.itens).toHaveLength(LINHAS_30113[15].split(' ').length);
    expect(itens[linha.itens[0]].str).toBe('7.1.3.05.01');

    const ultimo = itens[linha.itens[linha.itens.length - 1]];
    expect(linha.x1).toBeCloseTo(ultimo.transform[4] + ultimo.width, 5);
  });

  it('aguenta lista vazia ou inválida', () => {
    expect(linhasDaPagina([])).toEqual([]);
    expect(linhasDaPagina(null)).toEqual([]);
  });
});

describe('formatarValor', () => {
  it('formata no padrão do balancete', () => {
    expect(formatarValor(1234.5)).toBe('1.234,50');
    expect(formatarValor(0)).toBe('0,00');
    expect(formatarValor(1000000)).toBe('1.000.000,00');
    expect(formatarValor(345)).toBe('345,00');
  });

  it('negativo sai entre parênteses', () => {
    expect(formatarValor(-1234.5)).toBe('(1.234,50)');
    expect(formatarValor(-0.05)).toBe('(0,05)');
  });

  it('valor inválido vira string vazia, não "NaN"', () => {
    expect(formatarValor(null)).toBe('');
    expect(formatarValor('abc')).toBe('');
  });
});

describe('acharAlvo — código da conta', () => {
  const paginas = paginasDe(LINHAS_30113);

  it('acha o código inteiro como palavra', () => {
    expect(acharAlvo(paginas, { conta_codigo: '7.1.3.05.01.00027' })).toEqual([
      { pagina: 1, linha: 16, motivo: 'codigo' },
    ]);
  });

  it('não casa o código dentro de um código maior', () => {
    // 7.1.3.05.01 aparece dentro de 7.1.3.05.01.00027, mas a linha
    // do subgrupo é a única que tem o código sozinho.
    expect(acharAlvo(paginas, { conta_codigo: '7.1.3.05.01' })).toEqual([
      { pagina: 1, linha: 15, motivo: 'codigo' },
    ]);
  });

  it('também não casa um prefixo do código', () => {
    expect(acharAlvo(paginas, { conta_codigo: '7.1.3.05.01.0002' })).toEqual([]);
  });

  it('código com # usa o prefixo no começo da linha e o reduzido inteiro', () => {
    const paginas30076 = paginasDe(LINHAS_30076);

    expect(acharAlvo(paginas30076, {
      conta_codigo: '7.1.3.05.01.0#2506042',
    })).toEqual([{ pagina: 1, linha: 7, motivo: 'reduzido' }]);

    // Mesmo prefixo, outro reduzido: a linha é outra.
    expect(acharAlvo(paginas30076, {
      conta_codigo: '7.1.3.05.01.0#252475',
    })).toEqual([{ pagina: 1, linha: 8, motivo: 'reduzido' }]);

    // Reduzido que não existe no documento.
    expect(acharAlvo(paginas30076, {
      conta_codigo: '7.1.3.05.01.0#9999999',
    })).toEqual([]);
  });

  it('tolera espaço em volta do ponto quando o extrator quebra o código', () => {
    const paginasQuebradas = paginasDe([
      '7.1.3.05.01 .00042 2506042 PASSAGENS 0,00 20.255,80 0,00 20.255,80 20.255,80',
    ]);
    expect(acharAlvo(paginasQuebradas, {
      conta_codigo: '7.1.3.05.01.00042',
    })).toEqual([{ pagina: 1, linha: 0, motivo: 'codigo' }]);
    expect(acharAlvo(paginasQuebradas, {
      conta_codigo: '7.1.3.05.01.0#2506042',
    })).toEqual([{ pagina: 1, linha: 0, motivo: 'reduzido' }]);
  });

  it('o código tem prioridade sobre o valor quando os dois casam', () => {
    const achado = acharAlvo(paginas, {
      conta_codigo: '7.1.3.05.01.00027',
      valor: 345,
    });
    expect(achado).toEqual([{ pagina: 1, linha: 16, motivo: 'codigo' }]);
  });
});

describe('acharAlvo — valor', () => {
  const paginas = paginasDe(LINHAS_30113);

  it('devolve todas as linhas em que o valor aparece', () => {
    // 158.000,00 aparece na conta-mãe, no subgrupo e na folha.
    expect(acharAlvo(paginas, { valor: 158000 })).toEqual([
      { pagina: 1, linha: 11, motivo: 'valor' },
      { pagina: 1, linha: 12, motivo: 'valor' },
      { pagina: 1, linha: 13, motivo: 'valor' },
    ]);
  });

  it('com texto, prefere as linhas que também têm o texto (sem acento/caixa)', () => {
    expect(acharAlvo(paginas, { valor: 158000, texto: 'BOLSA DOAÇÃO' })).toEqual([
      { pagina: 1, linha: 13, motivo: 'valor' },
    ]);
    expect(acharAlvo(paginas, { valor: 158000, texto: 'bolsa doacao' })).toEqual([
      { pagina: 1, linha: 13, motivo: 'valor' },
    ]);
  });

  it('"345,00" não casa dentro de "1.345,00" e vice-versa', () => {
    const paginasExtras = paginasDe([
      '7.1.3.99.01.00001 999 TESTE 0,00 1.345,00 0,00 1.345,00 1.345,00',
      '7.1.3.05.01.00027 2506027 SERVIÇOS ANALISE PESQU CIENTIFI 0,00 345,00 0,00 345,00 345,00',
    ]);
    expect(acharAlvo(paginasExtras, { valor: 345 })).toEqual([
      { pagina: 1, linha: 1, motivo: 'valor' },
    ]);
    expect(acharAlvo(paginasExtras, { valor: 1345 })).toEqual([
      { pagina: 1, linha: 0, motivo: 'valor' },
    ]);
  });

  it('valor negativo acha parênteses e sinal de menos', () => {
    const paginasExtras = paginasDe([
      '7.1.3.98.01.00001 999 REDUTORA 0,00 0,00 (1.234,50) (1.234,50) (1.234,50)',
      '7.1.3.98.01.00002 999 OUTRA 0,00 0,00 0,00 0,00 -1.234,50',
      '7.1.3.98.01.00003 999 POSITIVA 0,00 0,00 0,00 0,00 1.234,50',
    ]);
    expect(acharAlvo(paginasExtras, { valor: -1234.5 })).toEqual([
      { pagina: 1, linha: 0, motivo: 'valor' },
      { pagina: 1, linha: 1, motivo: 'valor' },
    ]);
  });

  it('aceita o ponto final de frase depois do valor do rodapé', () => {
    const paginasRodape = paginasDe([
      'SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO == >> R$ 143.260,76.',
    ]);
    expect(acharAlvo(paginasRodape, { valor: 143260.76 })).toEqual([
      { pagina: 1, linha: 0, motivo: 'valor' },
    ]);
  });
});

describe('acharAlvo — texto e ordem das regras', () => {
  const paginas = paginasDe(LINHAS_30113);

  it('acha texto sem acento e sem caixa', () => {
    expect(acharAlvo(paginas, { texto: 'bolsa doacao' })).toEqual([
      { pagina: 1, linha: 13, motivo: 'texto' },
    ]);
    expect(acharAlvo(paginas, { texto: 'SERVIÇOS TERCEIROS PESSOA FÍSICA' }).length).toBe(2);
  });

  it('cai do código para o valor quando o código não está no documento', () => {
    expect(acharAlvo(paginas, {
      conta_codigo: '9.9.9.9.9',
      valor: 158000,
      texto: 'BOLSA DOAÇÃO',
    })).toEqual([{ pagina: 1, linha: 13, motivo: 'valor' }]);
  });

  it('devolve [] quando não acha nada', () => {
    expect(acharAlvo(paginas, { conta_codigo: '9.9.9.9' })).toEqual([]);
    expect(acharAlvo(paginas, { valor: 42 })).toEqual([]);
    expect(acharAlvo(paginas, { texto: 'coisa que não existe' })).toEqual([]);
    expect(acharAlvo(paginas, {})).toEqual([]);
    expect(acharAlvo([], { valor: 1 })).toEqual([]);
    expect(acharAlvo(null, { valor: 1 })).toEqual([]);
  });

  it('numera as páginas a partir de 1 e mantém a ordem', () => {
    const paginasDuas = [
      linhasDaPagina(itensDeLinhas(['PÁGINA UM COM BOLSA DOAÇÃO'], 900)),
      linhasDaPagina(itensDeLinhas(['PÁGINA DOIS COM BOLSA DOAÇÃO'], 900)),
    ];
    expect(acharAlvo(paginasDuas, { texto: 'bolsa doacao' })).toEqual([
      { pagina: 1, linha: 0, motivo: 'texto' },
      { pagina: 2, linha: 0, motivo: 'texto' },
    ]);
  });
});

describe('marcarNoHtml — DOCX', () => {
  it('marca texto com acento e caixa diferentes, preservando o original', () => {
    const resultado = marcarNoHtml(
      '<p>BOLSA DOAÇÃO — 1.234,50</p>',
      ['bolsa doacao', '1.234,50'],
    );
    expect(resultado.total).toBe(2);
    expect(resultado.html).toContain('<mark class="origem-mark">BOLSA DOAÇÃO</mark>');
    expect(resultado.html).toContain('<mark class="origem-mark">1.234,50</mark>');
  });

  it('não marca dentro de atributo nem de nome de tag', () => {
    const html = '<p><a href="1.234,50" title="1.234,50">1.234,50</a></p>';
    const resultado = marcarNoHtml(html, ['1.234,50']);
    expect(resultado.total).toBe(1);
    expect(resultado.html).toBe(
      '<p><a href="1.234,50" title="1.234,50"><mark class="origem-mark">1.234,50</mark></a></p>',
    );

    expect(marcarNoHtml('<strong>345,00</strong>', ['strong'])).toEqual({
      html: '<strong>345,00</strong>',
      total: 0,
    });
  });

  it('não marca "345,00" dentro de "1.345,00"', () => {
    expect(marcarNoHtml('<p>1.345,00</p>', ['345,00'])).toEqual({
      html: '<p>1.345,00</p>',
      total: 0,
    });
  });

  it('aceita valor seguido do ponto final de frase', () => {
    const resultado = marcarNoHtml('<p>R$ 1.107.372,93.</p>', ['1.107.372,93']);
    expect(resultado.total).toBe(1);
    expect(resultado.html).toBe(
      '<p>R$ <mark class="origem-mark">1.107.372,93</mark>.</p>',
    );
  });

  it('trata &nbsp; como espaço entre as palavras do termo', () => {
    const resultado = marcarNoHtml(
      '<p>MATERIAL&nbsp;DE CONSUMO</p>',
      ['MATERIAL DE CONSUMO'],
    );
    expect(resultado.total).toBe(1);
    expect(resultado.html).toContain('<mark class="origem-mark">MATERIAL&nbsp;DE CONSUMO</mark>');
  });

  it('marca texto com & escapado pelo mammoth', () => {
    const resultado = marcarNoHtml(
      '<p>PESQUISA &amp; DESENVOLVIMENTO</p>',
      ['PESQUISA & DESENVOLVIMENTO'],
    );
    expect(resultado.total).toBe(1);
    expect(resultado.html).toContain('<mark class="origem-mark">PESQUISA &amp; DESENVOLVIMENTO</mark>');
  });

  it('prefere o termo mais longo quando um contém o outro', () => {
    const resultado = marcarNoHtml(
      '<p>MATERIAL DE CONSUMO</p>',
      ['MATERIAL', 'MATERIAL DE CONSUMO'],
    );
    expect(resultado.total).toBe(1);
    expect(resultado.html).toBe(
      '<p><mark class="origem-mark">MATERIAL DE CONSUMO</mark></p>',
    );
  });

  it('marca todas as ocorrências e devolve o total', () => {
    const resultado = marcarNoHtml(
      '<p>DAO 1,00</p><p>DAO 2,00</p>',
      ['DAO'],
    );
    expect(resultado.total).toBe(2);
    expect(resultado.html.match(/<mark class="origem-mark">/g)).toHaveLength(2);
  });

  it('sem termos ou sem correspondência devolve o HTML intacto', () => {
    const html = '<p>Qualquer coisa</p>';
    expect(marcarNoHtml(html, [])).toEqual({ html, total: 0 });
    expect(marcarNoHtml(html, ['inexistente'])).toEqual({ html, total: 0 });
    expect(marcarNoHtml('', ['x'])).toEqual({ html: '', total: 0 });
  });
});
