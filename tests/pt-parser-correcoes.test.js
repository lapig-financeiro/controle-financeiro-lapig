/**
 * @vitest-environment happy-dom
 */
// Defeitos achados ao conferir os planos do Drive em 29/10/2026, reproduzidos
// com tabelas sintéticas (os DOCX reais têm dados pessoais e não entram aqui).
import { describe, it, expect } from 'vitest';
import { parsePtFromHtml } from '../frontend/js/parsers/pt-parser.js';

const linha = (celulas, forte = false) => '<tr>' + celulas.map(c =>
  '<td>' + (forte ? '<strong>' + c + '</strong>' : c) + '</td>').join('') + '</tr>';
const titulo = linha(['Plano de Aplicação dos Recursos Financeiros', 'Valor (R$)']);
const plano = (linhas, depois = '') => '<p>II.c</p><table>' + titulo + linhas + '</table>' + depois;
const rubricas = ex => ex.data.rubricas.map(r => [r.rubrica_code, r.valor_previsto, r.descricao_livre]);

describe('tabela com colunas de valor atual, acréscimo e soma', () => {
  const ex = parsePtFromHtml(plano(
    linha(['Item', 'Valor Atual (R$)', 'Acréscimo (R$)', 'Soma por Rubrica (R$)']) +
    linha(['1- Previsão de Despesas (a+b+c+d+e+f+g)', 'Total', '1.100,00', '500,00', '1.600,00']) +
    linha(['a-Pessoal', '1.000,00', '500,00', '1.500,00'], true) +
    linha(['Bolsas', '1.000,00', '500,00', '1.500,00']) +
    linha(['b – Serviços de Terceiros P. Jurídica Total', '100,00', '0,00', '100,00'], true) +
    linha(['Outros serviços', '100,00', '0,00', '100,00']) +
    linha(['Total', '1.100,00', '500,00', '1.600,00'])));

  it('usa a coluna da soma e não lê a linha Total como rubrica', () => {
    expect(rubricas(ex)).toEqual([['a.bolsas', 1500, null], ['b', 100, 'Outros serviços']]);
    expect(ex.data.valor_total_plano).toBe(1600);
  });
  it('não leva os números das outras colunas para o nome nem acusa soma divergente', () => {
    expect(ex.warnings.filter(w => /soma das rubricas|grupo/i.test(w))).toEqual([]);
  });
});

describe('total do grupo diferente da soma dos itens', () => {
  it('avisa e fica com a soma dos itens', () => {
    const ex = parsePtFromHtml(plano(
      linha(['e – Material de Consumo Total', '140.000,00'], true) +
      linha(['Material de expediente', '10.000,00']) +
      linha(['Material de manutenção de máquinas e equipamentos', '80.000,00']) +
      linha(['Outros materiais', '30.000,00'])));
    expect(ex.data.valor_total_plano).toBe(120000);
    expect(ex.warnings).toContain('O grupo "e – Material de Consumo" declara 140000.00, mas os itens dele ' +
      'somam 120000.00. Ficou a soma dos itens; confira no documento.');
  });
});

describe('linha "h" do plano', () => {
  it('doação para outro centro vai para revisão, não vira ganho econômico calado', () => {
    const ex = parsePtFromHtml(plano(linha(['h - Doação 30.076', 'R$ 15.270,72'], true)));
    expect(rubricas(ex)).toEqual([['g', 15270.72, 'h - Doação 30.076']]);
    expect(ex.warnings).toContain('Rubrica "h - Doação 30.076" classificada como fallback g — confira.');
  });
  it('"h - Ganho econômico" continua ganho econômico, sem aviso', () => {
    const ex = parsePtFromHtml(plano(linha(['h - Ganho econômico', '100,00'], true)));
    expect(rubricas(ex)).toEqual([['g', 100, null]]);
    expect(ex.warnings.filter(w => /fallback/.test(w))).toEqual([]);
  });
});

describe('CIP e DAO', () => {
  const despesas = linha(['a-Pessoal', '1.000,00'], true) + linha(['Bolsas', '1.000,00']);

  it('lê o DAO da tabela final quando a frase de II.e vem em branco, e 114.000 é milhar', () => {
    const ex = parsePtFromHtml(plano(despesas,
      '<p>a Fundação.......................... aplicará a título de Despesas Administrativas e ' +
      'Operacionais de caráter indivisível (DAO) decorrentes de serviços de gestão.</p>' +
      '<table>' + linha(['Previsão de despesas do projeto', 'R$ 1.000,00']) +
      linha(['Previsão de custos indiretos', '171.000']) +
      linha(['D.A.O da Fundação', '114.000']) + linha(['Total do plano', 'R$ 286.000,00']) + '</table>'));
    expect(ex.data.valor_dao).toBe(114000);
    expect(ex.data.valor_cip).toBe(171000);
    expect(ex.warnings.filter(w => /DAO/.test(w))).toEqual([]);
    // Sem a divisão UFG × UA o CIP não vira rubrica; o DAO vira.
    expect(ex.warnings).toContain('O CIP não traz a divisão entre UFG e UA/Órgão; ficou fora das rubricas. ' +
      'Preencha à mão se souber.');
    expect(rubricas(ex)).toEqual([['a.bolsas', 1000, null], ['dao', 114000, null]]);
    expect(ex.data.valor_total_plano).toBe(1000);
  });
  it('CIP dividido em UFG e UA/Órgão e DAO entram como rubricas, fora do total de despesas', () => {
    const ex = parsePtFromHtml(plano(despesas,
      '<p>IId. Valor dos Custos Indiretos do Projeto (CIP) para a UFG</p><table>' +
      linha(['Custos indiretos para a UFG', 'R$ 33.035,71']) +
      linha(['Custos indiretos para a UA/Órgão', 'R$ 46.250,00']) + linha(['Total', 'R$ 79.285,71']) + '</table>' +
      '<table>' + linha(['Previsão de despesas do projeto', 'R$ 1.000,00']) +
      linha(['Previsão de custos indiretos', 'R$ 79.285,71']) +
      linha(['D.A.O da Fundação', 'R$ 79.285,71']) + linha(['Total do plano', 'R$ 159.571,42']) + '</table>'));
    expect(rubricas(ex)).toEqual([['a.bolsas', 1000, null], ['cip_ufg', 33035.71, null],
      ['cip_ua', 46250, null], ['dao', 79285.71, null]]);
    expect(ex.data.valor_total_plano).toBe(1000);
    expect(ex.warnings.filter(w => /CIP|DAO|soma/.test(w))).toEqual([]);
  });
  it('lê o DAO escrito na frase de II.e', () => {
    const ex = parsePtFromHtml(plano(despesas,
      '<p>Despesas Administrativas e Operacionais de caráter indivisível (DAO) decorrentes de ' +
      'serviços de gestão administrativa e financeira o valor de R$ 23.040,00 (vinte e três mil).</p>'));
    expect(ex.data.valor_dao).toBe(23040);
  });
  it('"participantes" não é CIP: sem a seção, o CIP fica sem valor e avisa', () => {
    const ex = parsePtFromHtml(plano(despesas,
      '<p>III.a. Participantes da UFG</p><table>' + linha(['Total', '202008137']) + '</table>'));
    expect(ex.data.valor_cip).toBeNull();
    expect(ex.warnings).toContain('Valor CIP não detectado — preencha manualmente se aplicável.');
  });
});

describe('linha CLT do plano', () => {
  it('"CLT" vai para Colaboradores CLT, onde o balancete lança a folha; "Encargos s/ CLT" segue encargo', () => {
    const ex = parsePtFromHtml(plano(
      linha(['a-Pessoal', '3.000,00'], true) + linha(['CLT', '2.000,00']) +
      linha(['Encargos s/ CLT', '1.000,00'])));
    expect(rubricas(ex)).toEqual([['a.colab', 2000, null], ['a.enc', 1000, null]]);
    expect(ex.warnings.filter(w => /fallback/.test(w))).toEqual([]);
  });
});
