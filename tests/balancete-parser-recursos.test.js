import { describe, it, expect } from 'vitest';
import { parseBalanceteText } from '../frontend/js/parsers/balancete-parser.js';

// Recursos que entraram (2.1.3.01), para cruzar com o cronograma de desembolso
// (18/11/2026). Linhas no formato dos balancetes reais de 30.099 e 30.118, valores sintéticos.
const cabeca = `FUNDACAO DE APOIO A PESQUISA - CNPJ 00.799.205/0001-89 Balancete Contábil Analítico 01/01/2000 a 03/11/2026 Folha: 1
00.799.205/0001-89 Emissão: 04/11/2026 10:00
Conta Reduzido Descrição Anterior Débitos Créditos Movimento Saldo Atual
1.1.1.02.02.97404 97404 30.099 22813-3 BB/FU PROJETO ACE 0,00 100,00 (100,00) 0,00 0,00
`;
const rodape = `
7.1.3.04.01.09142 2579142 BOLSA DOAÇÃO 0,00 1.000,00 0,00 1.000,00 1.000,00
TOTAL DE DÉBITOS : 10,00
TOTAL DE CRÉDITOS: 10,00
SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ 2.000,00.
RENDIMENTO LÍQUIDO APURADO ==>> R$ 150,00.`;

const RECURSOS = `2.1.3.01 213310 ( + ) RECURSOS CONVENIOS E CONTRATOS 0,00 0,00 1.235.775,00 1.235.775,00 1.235.775,00
2.1.3.01.02 213120 ( + ) RECURSOS CONVENIOS E CONTRATOS 0,00 0,00 61.775,00 61.775,00 61.775,00
2.1.3.01.02.0 12002 ( + ) RECURSOS (VIA NOTA FISCAL 0,00 0,00 60.000,00 60.000,00 60.000,00
2.1.3.01.02.0 12006 ( + ) RENDIMENTO BRUTO S/ APLICACAO 0,00 (5,00) 1.780,00 1.775,00 1.775,00
2.1.3.01.03 13000 ( + ) OUTROS RECURSOS 0,00 0,00 74.000,00 74.000,00 74.000,00
2.1.3.01.03.0 13001 ( + ) DOAÇÕES 0,00 0,00 74.000,00 74.000,00 74.000,00
2.1.3.01.05 21315213 ( + ) RECURSOS A RECEBER 0,00 (1.000,00) 351.000,00 350.000,00 350.000,00
2.1.3.01.05.0 15001 (+/-) NOTAS FISCAIS A RECEBER(REC FU 0,00 (1.000,00) 351.000,00 350.000,00 350.000,00
2.1.3.01.99 99508 ( - ) APROPRIACAO RECEITA CONFORME 0,00 38.245,13 0,00 38.245,13 38.245,13
2.1.3.01.99.9 21399508 ( - ) APROPRIACAO RECEITA CONFORME 0,00 38.245,13 0,00 38.245,13 38.245,13
2.1.3.01.02.0 12002 ( + ) RECURSOS (VIA NOTA FISCAL 0,00 0,00 60.000,00 60.000,00 60.000,00`;

describe('recursos que entraram', () => {
  const { data } = parseBalanceteText(cabeca + RECURSOS + rodape);

  it('separa o que o financiador pagou, o rendimento, as doações e as notas a receber', () => {
    const { recebido, rendimento_bruto, doacoes, a_receber } = data.recursos;
    expect({ recebido, rendimento_bruto, doacoes, a_receber })
      .toEqual({ recebido: 60000, rendimento_bruto: 1775, doacoes: 74000, a_receber: 350000 });
  });
  it('ignora a apropriação de receita e a linha repetida na quebra de página', () => {
    expect(data.recursos.contas.map(c => c.reduzido)).toEqual(['12002', '12006', '13001', '15001']);
  });
  it('não mexe nas despesas nem no rodapé', () => {
    expect(data.lancamentos.map(l => l.conta_codigo)).toEqual(['7.1.3.04.01.09142']);
    expect(data.rendimento_liquido).toBe(150);
  });
});

describe('recurso de convênio e do exterior (GMH, ICS)', () => {
  it('soma as duas origens no recebido', () => {
    const { data } = parseBalanceteText(cabeca
      + '2.1.3.01.02.0 12003 ( + ) RECURSOS DE CONVENIO(VIA DEP B 0,00 0,00 445.446,32 445.446,32 445.446,32\n'
      + '2.1.3.01.02.0 12010 ( + ) RECURSO EXTERIOR - RECEITA 0,00 0,00 1.079.299,63 1.079.299,63 1.079.299,63\n'
      + rodape);
    expect(data.recursos.recebido).toBe(1524745.95);
  });
});

describe('balancete sem a seção de recursos', () => {
  it('fica null (ausência não é zero)', () => {
    expect(parseBalanceteText(cabeca + rodape).data.recursos).toBeNull();
  });
});
