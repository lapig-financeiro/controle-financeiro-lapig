/**
 * @vitest-environment happy-dom
 */
// Cronograma de desembolso (II.b): ficou sempre vazio desde que a leitura do plano
// passou a ser determinística (241d4b8). Tabelas sintéticas no formato dos planos
// do Drive conferidos em 18/11/2026 (30.111 com datas, 30.116 com entregas).
import { describe, it, expect } from 'vitest';
import { parsePtFromHtml } from '../frontend/js/parsers/pt-parser.js';

const linha = celulas => '<tr>' + celulas.map(c => '<td>' + c + '</td>').join('') + '</tr>';
const desembolso = linhas => '<table>' + linha(['II.b. Cronograma de desembolso dos recursos'])
  + linha(['Parcela', 'Data', 'Valor']) + linhas + '</table>';
const aplicacao = '<table>' + linha(['Plano de Aplicação dos Recursos Financeiros', 'Valor (R$)'])
  + linha(['a-Pessoal', '1.000,00']) + linha(['Bolsas', '1.000,00']) + '</table>';

describe('quadro com datas', () => {
  const ex = parsePtFromHtml(desembolso(
    linha(['1', 'Assinatura do contrato', '290.000,00']) +
    linha(['2', '02/03/2026', '470.000,00']) +
    linha(['3', '06/07/2026', 'R$ 470.000,00']) +
    linha(['4', '01/09/2026', '210.00,00']) +
    linha(['5', '16/11/2026', '40.000,00'])) + aplicacao);

  it('lê as parcelas, com data quando é data e texto quando não é', () => {
    expect(ex.data.desembolsos).toEqual([
      { parcela: 1, data_prevista: null, data_texto: 'Assinatura do contrato', valor: 290000, valor_texto: null },
      { parcela: 2, data_prevista: '2026-03-02', data_texto: null, valor: 470000, valor_texto: null },
      { parcela: 3, data_prevista: '2026-07-06', data_texto: null, valor: 470000, valor_texto: null },
      { parcela: 4, data_prevista: '2026-09-01', data_texto: null, valor: null, valor_texto: '210.00,00' },
      { parcela: 5, data_prevista: '2026-11-16', data_texto: null, valor: 40000, valor_texto: null },
    ]);
  });
  it('valor fora do formato não vira palpite: fica o texto e um aviso', () => {
    expect(ex.warnings.filter(w => /parcela 4/.test(w))).toHaveLength(1);
  });
  it('as rubricas saem iguais às do plano sem o quadro', () => {
    const sem = parsePtFromHtml(aplicacao + '<p>' + 'texto '.repeat(30) + '</p>');
    expect(ex.data.rubricas).toEqual(sem.data.rubricas);
  });
});

describe('quadro por entrega, sem data', () => {
  it('guarda a entrega como texto da data', () => {
    const ex = parsePtFromHtml(desembolso(
      linha(['1', 'Assinatura do contrato', '66.816,00']) +
      linha(['2', 'Pré-processamento / Extração de variáveis', '50.112,00'])) + aplicacao);
    expect(ex.data.desembolsos.map(d => [d.parcela, d.data_prevista, d.data_texto, d.valor])).toEqual([
      [1, null, 'Assinatura do contrato', 66816],
      [2, null, 'Pré-processamento / Extração de variáveis', 50112],
    ]);
    expect(ex.warnings.filter(w => /desembolso/i.test(w))).toEqual([]);
  });
});

describe('datas em outros formatos dos planos (ICS, Acelen, WRI)', () => {
  it('ano com 2 dígitos é data exata; mês por extenso vira o dia 1º e guarda o texto', () => {
    const ex = parsePtFromHtml(desembolso(
      linha(['1', '10/04/26', '1,00']) +
      linha(['2', 'Julho/25', '1,00']) +
      linha(['3', 'JULHO 2026', '1,00']) +
      linha(['4', 'Março de 2027', '1,00']) +
      linha(['5', '31/02/2026', '1,00'])) + aplicacao);
    expect(ex.data.desembolsos.map(d => [d.data_prevista, d.data_texto])).toEqual([
      ['2026-04-10', null],
      ['2025-07-01', 'Julho/25'],
      ['2026-07-01', 'JULHO 2026'],
      ['2027-03-01', 'Março de 2027'],
      [null, '31/02/2026'],
    ]);
  });
});

describe('quadro na mesma tabela da receita (o Word junta)', () => {
  it('para na primeira linha que não é parcela', () => {
    const ex = parsePtFromHtml('<table>' + linha(['II.b. Cronograma de desembolso dos recursos'])
      + linha(['Parcela', 'Data', 'Valor']) + linha(['1', '31/01/2027', '10.000,00'])
      + linha(['1- Receita', '10.000,00']) + linha(['2', 'qualquer coisa', '5,00']) + '</table>' + aplicacao);
    expect(ex.data.desembolsos).toEqual([
      { parcela: 1, data_prevista: '2027-01-31', data_texto: null, valor: 10000, valor_texto: null },
    ]);
  });
});

describe('plano sem quadro de desembolso', () => {
  it('lista vazia e sem aviso', () => {
    const ex = parsePtFromHtml(aplicacao + '<p>' + 'texto '.repeat(30) + '</p>');
    expect(ex.data.desembolsos).toEqual([]);
    expect(ex.warnings.filter(w => /desembolso/i.test(w))).toEqual([]);
  });
});

describe('revisão de 18/11: formatos de tabela', () => {
  it('célula de valor vazia não puxa a data para o lugar do valor', () => {
    const ex = parsePtFromHtml(desembolso(linha(['4', '01/09/2026', ''])) + aplicacao);
    expect(ex.data.desembolsos).toEqual([{ parcela: 4, data_prevista: '2026-09-01', data_texto: null, valor: null, valor_texto: null }]);
    expect(ex.warnings.some(w => /parcela 4: sem valor/.test(w))).toBe(true);
  });
  it('quatro colunas (Parcela | Entrega | Data | Valor): pega a data da célula certa', () => {
    const ex = parsePtFromHtml(desembolso(linha(['2', 'Relatório parcial', '15/03/2027', '10.000,00'])) + aplicacao);
    expect(ex.data.desembolsos[0]).toMatchObject({ data_prevista: '2027-03-15', valor: 10000 });
  });
  it('título num parágrafo acima da tabela', () => {
    const ex = parsePtFromHtml('<p>II.b. Cronograma de desembolso dos recursos</p><table>'
      + linha(['Parcela', 'Data', 'Valor']) + linha(['1', '01/02/2027', '5.000,00']) + '</table>' + aplicacao);
    expect(ex.data.desembolsos).toHaveLength(1);
  });
  it('uma célula que só cita o cronograma antes do quadro não esconde o quadro real', () => {
    const ex = parsePtFromHtml('<table>' + linha(['Ver o cronograma de desembolso abaixo']) + '</table>'
      + desembolso(linha(['1', '01/02/2027', '5.000,00'])) + aplicacao);
    expect(ex.data.desembolsos).toHaveLength(1);
  });
});
