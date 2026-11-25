import { describe, expect, it } from 'vitest';
import { projetarBolsas } from '../src/servicos/projecao.js';
import * as dadosExemplo from '../src/servicos/dadosExemplo.js';

const HOJE = '2026-11-23';

function rubricasDoCenario({ bolsas = 560000, taxa = 300000, total = 2000000 } = {}) {
  return [
    {
      rubrica_code: 'a.bolsas',
      grupo_code: 'a',
      previsto: bolsas,
      realizado: 0,
      saldo: bolsas,
      compromisso_tipo: 'bolsas',
    },
    {
      rubrica_code: 'cip',
      grupo_code: 'cip',
      previsto: taxa,
      realizado: 0,
      saldo: taxa,
      compromisso_tipo: 'taxa',
    },
    {
      rubrica_code: 'outros',
      grupo_code: 'b',
      previsto: total - bolsas - taxa,
      realizado: 0,
      saldo: total - bolsas - taxa,
      compromisso_tipo: null,
    },
  ];
}

function cenario({
  caixa = 250000,
  rendimento = 30000,
  orcamentoBolsas = 560000,
  previstoTaxa = 300000,
} = {}) {
  return {
    saldo: {
      has_plano: true,
      has_balancete: caixa !== null,
      project_id: 'p-teste',
      end_date: '2027-09-30',
      data_referencia: '2026-11-17',
      compromissos_inicio: '2026-12-01',
      compromissos_fim: '2027-09-30',
      saldo_disponivel_caixa: caixa,
      rendimento_liquido: rendimento,
      compromissos_bolsas: 500000,
      bolsas_ativas: Array.from({ length: 10 }, (_, indice) => ({
        scholarship_id: `b-${indice + 1}`,
        bolsista: `Bolsista ${indice + 1}`,
        valor_mensal: 5000,
        meses: 10,
        end_date: '2027-09-30',
      })),
      rubricas: rubricasDoCenario({ bolsas: orcamentoBolsas, taxa: previstoTaxa }),
    },
    repasses: {
      parcelas: [
        { parcela: 1, data_prevista: '2026-01-15', data_texto: null, valor: 500000, valor_texto: null },
        { parcela: 2, data_prevista: '2026-06-15', data_texto: null, valor: 500000, valor_texto: null },
        { parcela: 3, data_prevista: '2026-10-10', data_texto: null, valor: 500000, valor_texto: null },
        { parcela: 4, data_prevista: '2027-04-10', data_texto: null, valor: 500000, valor_texto: null },
      ],
      valor_total_plano: 2000000,
      data_balancete: '2026-11-17',
      recursos: { recebido: 1000000, a_receber: 0 },
    },
  };
}

describe('projetarBolsas — cenário obrigatório', () => {
  it('conta mês a mês só com o desembolso futuro: cabe até mar/27 e depende do desembolso 4', () => {
    const { saldo, repasses } = cenario();
    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('ok');
    expect(projecao.taxa_fracao).toBeCloseTo(0.15, 10);
    expect(projecao.meses.map((mes) => mes.mes)).toEqual([
      '2026-12', '2027-01', '2027-02', '2027-03', '2027-04',
      '2027-05', '2027-06', '2027-07', '2027-08', '2027-09',
    ]);
    expect(projecao.meses.map((mes) => mes.em_conta_apos_folha)).toEqual([
      170000, 120000, 70000, 20000, -30000, 345000, 295000, 245000, 195000, 145000,
    ]);
    expect(projecao.meses[4]).toMatchObject({
      mes: '2027-04',
      folha: 50000,
      entra_depois: 425000,
      em_conta_fim: 395000,
      desembolsos: [{ parcela: 4, liquido: 425000 }],
    });
    expect(projecao.meses[9].orcamento_resta).toBe(60000);
    expect(projecao.cabe_ate).toBe('2027-03');
    expect(projecao.ate_o_fim).toBe(false);
    expect(projecao.limite).toBe('caixa');
    expect(projecao.mes_falta).toBe('2027-04');
    expect(projecao.falta_valor).toBe(30000);
    expect(projecao.depende_de).toEqual({ parcela: 4, mes: '2027-04' });
    expect(projecao.mes_mais_apertado).toBe('2027-04');
    expect(projecao.sobra_orcamento).toBe(60000);
    expect(projecao.atrasados).toEqual([
      { parcela: 3, valor: 500000, quando: '10/10/2026', situacao: 'atrasada' },
    ]);
    expect(projecao.fora).toEqual([]);
  });

  it('com o rendimento conta com os 250.000: abril fica em zero, sem falta, e cabe até set/27', () => {
    const { saldo, repasses } = cenario();
    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: true },
    });

    expect(projecao.meses[4].em_conta_apos_folha).toBe(0);
    expect(projecao.meses[9].em_conta_apos_folha).toBe(175000);
    expect(projecao.mes_falta).toBeNull();
    expect(projecao.depende_de).toBeNull();
    expect(projecao.ate_o_fim).toBe(true);
    expect(projecao.cabe_ate).toBe('2027-09');
    expect(projecao.limite).toBeNull();
    expect(projecao.mes_mais_apertado).toBe('2027-04');
    expect(projecao.sobra_orcamento).toBe(60000);
  });

  it('sem o desembolso futuro a falta começa em abr/27 e o negativo segue', () => {
    const { saldo, repasses } = cenario();
    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: false, atrasado: false, rendimento: false },
    });

    expect(projecao.meses.map((mes) => mes.em_conta_apos_folha)).toEqual([
      170000, 120000, 70000, 20000, -30000, -80000, -130000, -180000, -230000, -280000,
    ]);
    expect(projecao.mes_falta).toBe('2027-04');
    expect(projecao.falta_valor).toBe(30000);
    expect(projecao.cabe_ate).toBe('2027-03');
    expect(projecao.limite).toBe('caixa');
    expect(projecao.depende_de).toBeNull();
  });

  it('com o atrasado contado, ele entra em dez/26 antes da folha e nenhum mês falta', () => {
    const { saldo, repasses } = cenario();
    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: true, rendimento: false },
    });

    expect(projecao.meses[0]).toMatchObject({
      mes: '2026-12',
      entra_antes: 425000,
      em_conta_apos_folha: 595000,
      desembolsos: [{ parcela: 3, liquido: 425000 }],
    });
    expect(projecao.mes_falta).toBeNull();
    expect(projecao.ate_o_fim).toBe(true);
    expect(projecao.atrasados).toHaveLength(1);
  });

  it('com o rendimento e 300.000 de orçamento, o limite é a rubrica em jun/27 e cabe até mai/27', () => {
    const { saldo, repasses } = cenario({ orcamentoBolsas: 300000 });
    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: true },
    });

    expect(projecao.limite).toBe('orcamento');
    expect(projecao.cabe_ate).toBe('2027-05');
    expect(projecao.ate_o_fim).toBe(false);
    expect(projecao.mes_falta).toBeNull();
    expect(projecao.meses[6].orcamento_resta).toBe(-50000);
  });
});

describe('projetarBolsas — dia do vencimento e folha', () => {
  it('entra antes da folha até o dia 07, depois do dia 07 e no fim do mês quando a data é só de mês', () => {
    const { saldo, repasses } = cenario();
    saldo.compromissos_inicio = '2026-12-01';
    saldo.compromissos_fim = '2026-12-31';
    saldo.compromissos_bolsas = 10000;
    saldo.end_date = '2026-12-31';
    saldo.saldo_disponivel_caixa = 10000;
    saldo.rendimento_liquido = 0;
    saldo.bolsas_ativas = [
      { scholarship_id: 'b-1', valor_mensal: 10000, meses: 1, end_date: '2026-12-31' },
    ];
    saldo.rubricas = [
      { rubrica_code: 'a.bolsas', previsto: 100000, realizado: 0, saldo: 100000, compromisso_tipo: 'bolsas' },
    ];
    repasses.parcelas = [
      { parcela: 1, data_prevista: '2026-12-07', data_texto: null, valor: 1000, valor_texto: null },
      { parcela: 2, data_prevista: '2026-12-08', data_texto: null, valor: 1000, valor_texto: null },
      { parcela: 3, data_prevista: '2026-12-01', data_texto: 'Dezembro/2026', valor: 1000, valor_texto: null },
    ];
    repasses.valor_total_plano = 3000;
    repasses.recursos = { recebido: 0, a_receber: 0 };

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.meses).toHaveLength(1);
    expect(projecao.meses[0]).toMatchObject({
      entra_antes: 1000,
      entra_depois: 2000,
      em_conta_apos_folha: 1000,
      em_conta_fim: 3000,
      folha: 10000,
    });
  });

  it('a folha cai quando uma bolsa termina antes da mais longa', () => {
    const { saldo, repasses } = cenario();
    saldo.compromissos_inicio = '2026-12-01';
    saldo.compromissos_fim = '2027-02-28';
    saldo.compromissos_bolsas = 35000;
    saldo.end_date = '2027-02-28';
    saldo.saldo_disponivel_caixa = 100000;
    saldo.rendimento_liquido = 0;
    saldo.bolsas_ativas = [
      { scholarship_id: 'b-1', valor_mensal: 10000, meses: 3, end_date: '2027-02-28' },
      { scholarship_id: 'b-2', valor_mensal: 5000, meses: 1, end_date: '2026-12-31' },
    ];
    saldo.rubricas = [
      { rubrica_code: 'a.bolsas', previsto: 100000, realizado: 0, saldo: 100000, compromisso_tipo: 'bolsas' },
    ];
    repasses.parcelas = [];
    repasses.valor_total_plano = null;
    repasses.recursos = { recebido: 0, a_receber: 0 };

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.meses.map((mes) => mes.mes)).toEqual([
      '2026-12', '2027-01', '2027-02',
    ]);
    expect(projecao.meses.map((mes) => mes.folha)).toEqual([15000, 10000, 10000]);
  });
});

describe('projetarBolsas — o que entra e o que fica de fora', () => {
  it('põe sem_valor em fora e nunca o trata como zero', () => {
    const { saldo, repasses } = cenario();
    repasses.parcelas.push({
      parcela: 5,
      data_prevista: '2026-12-20',
      data_texto: null,
      valor: null,
      valor_texto: 'a definir',
    });

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.fora).toContainEqual({
      parcela: 5,
      motivo: 'o plano não diz o valor',
    });
    expect(projecao.meses[4].entra_depois).toBe(425000);
  });

  it('trata nota_emitida como atrasado e não a conta sem a opção', () => {
    const { saldo, repasses } = cenario();
    repasses.parcelas = [
      { parcela: 1, data_prevista: '2027-01-10', data_texto: null, valor: 500000, valor_texto: null },
    ];
    repasses.valor_total_plano = 500000;
    repasses.recursos = { recebido: 0, a_receber: 500000 };

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.atrasados).toEqual([
      { parcela: 1, valor: 500000, quando: '10/01/2027', situacao: 'nota_emitida' },
    ]);
    expect(projecao.meses.every((mes) => mes.entra_antes === 0)).toBe(true);
  });

  it('manda para fora o desembolso que chega depois da última bolsa', () => {
    const { saldo, repasses } = cenario();
    repasses.parcelas.push({
      parcela: 5,
      data_prevista: '2027-12-10',
      data_texto: null,
      valor: 500000,
      valor_texto: null,
    });

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.fora).toContainEqual({
      parcela: 5,
      motivo: 'chega depois da última bolsa',
    });
  });

  it('sem valor de parcela no plano inteiro devolve repoe_gasto e só o limite pelo orçamento', () => {
    const { saldo, repasses } = cenario();
    for (const parcela of repasses.parcelas) {
      parcela.valor = null;
      parcela.valor_texto = 'a definir';
    }

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('repoe_gasto');
    expect(projecao.motivo).toContain('repõe o gasto');
    expect(projecao.limite).toBeNull();
    expect(projecao.meses.every((mes) => mes.em_conta_apos_folha === null)).toBe(true);
    expect(projecao.fora.map((item) => item.motivo)).toContain('o plano não diz o valor');
  });
});

describe('projetarBolsas — estados e avisos', () => {
  it('bolsa sem valor mensal ou sem meses vira dado_incompleto, nunca zero', () => {
    const { saldo, repasses } = cenario();
    saldo.bolsas_ativas[0].valor_mensal = null;

    const semValor = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });
    expect(semValor.estado).toBe('dado_incompleto');
    expect(semValor.meses).toEqual([]);

    saldo.bolsas_ativas[0].valor_mensal = 5000;
    saldo.bolsas_ativas[0].meses = 0;
    const semMeses = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });
    expect(semMeses.estado).toBe('dado_incompleto');
  });

  it('sem balancete só dá o limite pelo orçamento e não inventa dinheiro em conta', () => {
    const { saldo, repasses } = cenario({ caixa: null, rendimento: null, orcamentoBolsas: 300000 });
    saldo.has_balancete = false;
    repasses.recursos = null;
    repasses.data_balancete = null;

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('sem_balancete');
    expect(projecao.meses.every((mes) => mes.em_conta_apos_folha === null)).toBe(true);
    expect(projecao.limite).toBe('orcamento');
    expect(projecao.cabe_ate).toBe('2027-05');
    expect(projecao.mes_falta).toBeNull();
    expect(projecao.depende_de).toBeNull();
  });

  it('sem bolsas cadastradas devolve sem_bolsas', () => {
    const { saldo, repasses } = cenario();
    saldo.bolsas_ativas = [];

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('sem_bolsas');
    expect(projecao.motivo).toContain('Nenhuma bolsa');
    expect(projecao.cabe_ate).toBeNull();
  });

  it('avisa quando a soma das bolsas não bate com o compromisso da janela', () => {
    const { saldo, repasses } = cenario();
    saldo.compromissos_bolsas = 600000;

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.avisos.some((aviso) => aviso.includes('difere'))).toBe(true);
  });

  it('avisa quando o balancete não separa o rendimento e não o soma de volta', () => {
    const { saldo, repasses } = cenario({ rendimento: null });

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.avisos).toContain('o balancete não separa o rendimento');
    expect(projecao.meses[0].em_conta_apos_folha).toBe(200000);
  });
});

describe('projetarBolsas — 2ª rodada', () => {
  function cenarioDePosicionamento({ bolsas, compromissosBolsas, caixa = 100000 }) {
    return {
      saldo: {
        has_plano: true,
        has_balancete: true,
        project_id: 'p-posicao',
        end_date: '2027-08-31',
        data_referencia: '2026-11-17',
        compromissos_inicio: '2026-12-01',
        compromissos_fim: '2027-08-31',
        saldo_disponivel_caixa: caixa,
        rendimento_liquido: 0,
        compromissos_bolsas: compromissosBolsas,
        bolsas_ativas: bolsas,
        rubricas: [
          {
            rubrica_code: 'a.bolsas',
            grupo_code: 'a',
            previsto: 100000,
            realizado: 0,
            saldo: 100000,
            compromisso_tipo: 'bolsas',
          },
        ],
      },
      repasses: {
        parcelas: [],
        valor_total_plano: null,
        data_balancete: '2026-11-17',
        recursos: { recebido: 0, a_receber: 0 },
      },
    };
  }

  it('posiciona a bolsa pelo fim: quem começa em mar/27 paga só mar..ago', () => {
    const { saldo, repasses } = cenarioDePosicionamento({
      bolsas: [
        {
          scholarship_id: 'b-1',
          valor_mensal: 10000,
          meses: 6,
          end_date: '2027-08-31',
        },
      ],
      compromissosBolsas: 60000,
    });

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.meses.map((mes) => mes.mes)).toEqual([
      '2026-12', '2027-01', '2027-02', '2027-03',
      '2027-04', '2027-05', '2027-06', '2027-07', '2027-08',
    ]);
    expect(projecao.meses.map((mes) => mes.folha)).toEqual([
      0, 0, 0, 10000, 10000, 10000, 10000, 10000, 10000,
    ]);
  });

  it('posiciona a bolsa pelo fim: quem termina em fev/27 paga só dez..fev', () => {
    const { saldo, repasses } = cenarioDePosicionamento({
      bolsas: [
        {
          scholarship_id: 'b-1',
          valor_mensal: 10000,
          meses: 3,
          end_date: '2027-02-28',
        },
        {
          scholarship_id: 'b-2',
          valor_mensal: 5000,
          meses: 6,
          end_date: '2027-08-31',
        },
      ],
      compromissosBolsas: 60000,
    });

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.meses.map((mes) => mes.folha)).toEqual([
      10000, 10000, 10000, 5000, 5000, 5000, 5000, 5000, 5000,
    ]);
  });

  it('dado faltando vira dado_incompleto: saldo da rubrica de bolsas nulo', () => {
    const { saldo, repasses } = cenario();
    saldo.rubricas.find((rubrica) => rubrica.compromisso_tipo === 'bolsas').saldo = null;

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('dado_incompleto');
    expect(projecao.motivo).toContain('saldo');
  });

  it('dado faltando vira dado_incompleto: previsto nulo numa rubrica', () => {
    const { saldo, repasses } = cenario();
    saldo.rubricas.find((rubrica) => rubrica.compromisso_tipo === 'taxa').previsto = null;

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('dado_incompleto');
    expect(projecao.motivo).toContain('previsto');
  });

  it('com orçamento de 410.000 o desembolso salva abril, mas a conta segue só até jul/27', () => {
    const { saldo, repasses } = cenario({ orcamentoBolsas: 410000, rendimento: 0 });
    saldo.saldo_disponivel_caixa = 220000;
    saldo.rubricas = [
      {
        rubrica_code: 'a.bolsas',
        grupo_code: 'a',
        previsto: 410000,
        realizado: 0,
        saldo: 410000,
        compromisso_tipo: 'bolsas',
      },
    ];
    repasses.parcelas = [
      {
        parcela: 4,
        data_prevista: '2027-04-10',
        data_texto: null,
        valor: 500000,
        valor_texto: null,
      },
    ];
    repasses.valor_total_plano = 500000;
    repasses.recursos = { recebido: 0, a_receber: 0 };

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.limite).toBe('caixa');
    expect(projecao.cabe_ate).toBe('2027-03');
    expect(projecao.mes_falta).toBe('2027-04');
    expect(projecao.depende_de).toEqual({ parcela: 4, mes: '2027-04' });
    expect(projecao.meses.find((mes) => mes.mes === '2027-08').orcamento_resta).toBe(-40000);
  });

  it('desembolso futuro desligado vai para fora como "desligado em Contar"', () => {
    const { saldo, repasses } = cenario();
    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: false, atrasado: false, rendimento: false },
    });

    expect(projecao.fora).toContainEqual({
      parcela: 4,
      motivo: 'desligado em Contar',
    });
    expect(projecao.meses[4].entra_depois).toBe(0);
  });

  it('sem balancete, desembolso futuro não entra em meses e vai para fora', () => {
    const { saldo, repasses } = cenario({ caixa: null, rendimento: null });
    saldo.has_balancete = false;
    repasses.recursos = null;
    repasses.data_balancete = null;

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('sem_balancete');
    expect(projecao.fora).toContainEqual({
      parcela: 4,
      motivo: 'sem balancete para receber',
    });
    expect(
      projecao.meses.every(
        (mes) => mes.entra_antes === 0 && mes.entra_depois === 0 && mes.desembolsos.length === 0
      )
    ).toBe(true);
  });

  it('balancete existe mas não informa o dinheiro em conta', () => {
    const { saldo, repasses } = cenario({ caixa: null, rendimento: null });
    saldo.has_balancete = true;
    saldo.saldo_disponivel_caixa = null;

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('sem_balancete');
    expect(projecao.motivo).toContain('não informa o dinheiro em conta');
  });

  it('guarda a situação de cada atrasado: confirmar', () => {
    const { saldo, repasses } = cenario();
    repasses.parcelas = [
      {
        parcela: 1,
        data_prevista: '2026-11-20',
        data_texto: null,
        valor: 500000,
        valor_texto: null,
      },
    ];
    repasses.valor_total_plano = 500000;
    repasses.recursos = { recebido: 0, a_receber: 0 };

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.atrasados).toEqual([
      {
        parcela: 1,
        valor: 500000,
        quando: '20/11/2026',
        situacao: 'confirmar',
      },
    ]);
  });

  it('guarda a situação de cada atrasado: parcial só com o que falta', () => {
    const { saldo, repasses } = cenario();
    repasses.parcelas = [
      {
        parcela: 1,
        data_prevista: '2026-01-15',
        data_texto: null,
        valor: 100000,
        valor_texto: null,
      },
      {
        parcela: 2,
        data_prevista: '2026-08-15',
        data_texto: null,
        valor: 100000,
        valor_texto: null,
      },
    ];
    repasses.valor_total_plano = 200000;
    repasses.recursos = { recebido: 150000, a_receber: 0 };

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.atrasados).toEqual([
      {
        parcela: 2,
        valor: 50000,
        quando: '15/08/2026',
        situacao: 'parcial',
      },
    ]);
  });

  it('desembolso sem data vai para fora e não entra na conta', () => {
    const { saldo, repasses } = cenario();
    repasses.parcelas = [
      {
        parcela: 1,
        data_prevista: null,
        data_texto: null,
        valor: 100000,
        valor_texto: null,
      },
    ];
    repasses.valor_total_plano = 100000;
    repasses.recursos = { recebido: 0, a_receber: 0 };

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.fora).toContainEqual({
      parcela: 1,
      motivo: 'sem data prevista no plano',
    });
    expect(projecao.atrasados).toEqual([]);
  });

  it('empate entre caixa e orçamento no mesmo mês fica com o caixa', () => {
    const { saldo, repasses } = cenario({
      caixa: 250000,
      rendimento: 0,
      orcamentoBolsas: 250000,
    });

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: false, atrasado: false, rendimento: false },
    });

    expect(projecao.mes_falta).toBe('2027-05');
    expect(projecao.limite).toBe('caixa');
    expect(projecao.cabe_ate).toBe('2027-04');
  });

  it('sem o fim da janela, com vigência inválida ou sem fim de bolsa vira dado_incompleto', () => {
    const base = cenarioDePosicionamento({
      bolsas: [
        {
          scholarship_id: 'b-1',
          valor_mensal: 10000,
          meses: 6,
          end_date: '2027-08-31',
        },
      ],
      compromissosBolsas: 60000,
    });

    const semFimDaJanela = structuredClone(base);
    delete semFimDaJanela.saldo.compromissos_fim;
    expect(
      projetarBolsas({
        ...semFimDaJanela,
        hoje: HOJE,
        contar: { futuro: true, atrasado: false, rendimento: false },
      }).estado
    ).toBe('dado_incompleto');

    const vigenciaInvalida = structuredClone(base);
    vigenciaInvalida.saldo.end_date = 'data-invalida';
    expect(
      projetarBolsas({
        ...vigenciaInvalida,
        hoje: HOJE,
        contar: { futuro: true, atrasado: false, rendimento: false },
      }).estado
    ).toBe('dado_incompleto');

    const bolsaSemFim = structuredClone(base);
    bolsaSemFim.saldo.bolsas_ativas[0].end_date = null;
    expect(
      projetarBolsas({
        ...bolsaSemFim,
        hoje: HOJE,
        contar: { futuro: true, atrasado: false, rendimento: false },
      }).estado
    ).toBe('dado_incompleto');
  });
});

describe('projetarBolsas — folha atrasada (070)', () => {
  function cenarioComAtrasada({
    valor = 30000,
    caixa = 220000,
    orcamentoBolsas = 560000,
  } = {}) {
    const base = cenario({ caixa, orcamentoBolsas, rendimento: 0 });
    base.saldo.folha_atrasada = {
      valor,
      esperado: valor,
      visto: 0,
      desde_balancete: '2026-10-15',
      balancete: '2026-11-17',
      mes_inicio: '2026-11-01',
      mes_fim: '2026-11-01',
    };
    // A 070 já soma a folha atrasada no compromisso da janela.
    base.saldo.compromissos_bolsas = 500000 + valor;
    return base;
  }

  it('sai do caixa antes de tudo no 1º mês e antecipa a falta de abril para março', () => {
    const { saldo, repasses } = cenarioComAtrasada();
    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('ok');
    expect(projecao.folha_atrasada).toBe(30000);
    expect(projecao.meses[0]).toMatchObject({
      mes: '2026-12',
      folha: 50000,
      folha_atrasada: 30000,
      entra_antes: 0,
      em_conta_apos_folha: 140000,
      em_conta_fim: 140000,
      orcamento_resta: 480000,
    });
    expect(projecao.meses.slice(1).every((linha) => linha.folha_atrasada === 0)).toBe(
      true
    );
    expect(projecao.mes_falta).toBe('2027-03');
    expect(projecao.falta_valor).toBe(10000);
    expect(projecao.cabe_ate).toBe('2027-02');
    expect(projecao.limite).toBe('caixa');
    expect(projecao.depende_de).toBeNull();
    expect(projecao.mes_mais_apertado).toBe('2027-04');
    expect(projecao.sobra_orcamento).toBe(30000);
    expect(projecao.avisos.some((aviso) => aviso.includes('difere'))).toBe(false);
  });

  it('desembolso no dia 05 cobre a folha atrasada: falta de 3.000 no 1º mês e depende_de antes da folha', () => {
    const { saldo, repasses } = cenario({
      caixa: 5000,
      rendimento: 0,
      orcamentoBolsas: 100000,
    });
    saldo.compromissos_inicio = '2026-12-01';
    saldo.compromissos_fim = '2026-12-31';
    saldo.end_date = '2026-12-31';
    saldo.compromissos_bolsas = 16000;
    saldo.folha_atrasada = {
      valor: 8000,
      esperado: 8000,
      visto: 0,
      desde_balancete: '2026-10-15',
      balancete: '2026-11-17',
      mes_inicio: '2026-11-01',
      mes_fim: '2026-11-01',
    };
    saldo.bolsas_ativas = [
      {
        scholarship_id: 'b-1',
        valor_mensal: 8000,
        meses: 1,
        end_date: '2026-12-31',
      },
    ];
    saldo.rubricas = [
      {
        rubrica_code: 'a.bolsas',
        grupo_code: 'a',
        previsto: 100000,
        realizado: 0,
        saldo: 100000,
        compromisso_tipo: 'bolsas',
      },
    ];
    repasses.parcelas = [
      {
        parcela: 1,
        data_prevista: '2026-12-05',
        data_texto: null,
        valor: 30000,
        valor_texto: null,
      },
    ];
    repasses.valor_total_plano = 30000;
    repasses.recursos = { recebido: 0, a_receber: 0 };

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.meses).toHaveLength(1);
    expect(projecao.meses[0]).toMatchObject({
      mes: '2026-12',
      folha: 8000,
      folha_atrasada: 8000,
      entra_antes: 30000,
      em_conta_apos_folha: 19000,
      em_conta_fim: 19000,
    });
    expect(projecao.mes_falta).toBe('2026-12');
    expect(projecao.falta_valor).toBe(3000);
    expect(projecao.depende_de).toEqual({
      parcela: 1,
      mes: '2026-12',
      antes_da_folha: true,
    });
    expect(projecao.cabe_ate).toBe('2026-11');
    expect(projecao.limite).toBe('caixa');
    expect(projecao.mes_mais_apertado).toBe('2026-12');
  });

  it('sem bolsas ativas, mantém sem_bolsas e diz que há folha atrasada com centavos', () => {
    const { saldo, repasses } = cenario();
    saldo.bolsas_ativas = [];
    saldo.folha_atrasada = {
      valor: 8000,
      esperado: 8000,
      visto: 0,
      desde_balancete: '2026-10-15',
      balancete: '2026-11-17',
      mes_inicio: '2026-11-01',
      mes_fim: '2026-11-01',
    };

    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('sem_bolsas');
    expect(projecao.folha_atrasada).toBe(8000);
    expect(projecao.motivo).toContain('8.000,00');
    expect(projecao.motivo).toContain('folha atrasada que ainda vai sair do caixa');
  });

  it('abate o orçamento no 1º mês e antecipa o limite da rubrica de junho para maio', () => {
    const { saldo, repasses } = cenarioComAtrasada({
      caixa: 2000000,
      orcamentoBolsas: 310000,
    });
    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.mes_falta).toBeNull();
    expect(projecao.limite).toBe('orcamento');
    expect(projecao.cabe_ate).toBe('2027-04');
    expect(projecao.ate_o_fim).toBe(false);
    expect(projecao.meses[0].orcamento_resta).toBe(230000);
    expect(projecao.sobra_orcamento).toBe(-220000);
  });

  it('continua avisando quando a soma com a folha atrasada não bate com o compromisso', () => {
    const { saldo, repasses } = cenarioComAtrasada();
    saldo.compromissos_bolsas += 1000;
    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(
      projecao.avisos.some(
        (aviso) => aviso.includes('difere') && aviso.includes('folha atrasada')
      )
    ).toBe(true);
  });

  it('sem a chave, com null e com valor inválido os números são idênticos aos de hoje', () => {
    const { saldo, repasses } = cenario();
    const conta = (folha) =>
      projetarBolsas({
        saldo: folha === undefined ? saldo : { ...saldo, folha_atrasada: folha },
        repasses,
        hoje: HOJE,
        contar: { futuro: true, atrasado: false, rendimento: false },
      });

    const semChave = conta(undefined);
    const comNull = conta(null);
    const comZero = conta({ valor: 0 });
    const comTexto = conta({ valor: 'sem valor' });
    const comBoolean = conta({ valor: true });
    const comArray = conta({ valor: [8000] });

    expect(comNull).toEqual(semChave);
    expect(comZero).toEqual(semChave);
    expect(comTexto).toEqual(semChave);
    expect(comBoolean).toEqual(semChave);
    expect(comArray).toEqual(semChave);
    expect(semChave.folha_atrasada).toBe(0);
    expect(semChave.meses.every((linha) => linha.folha_atrasada === 0)).toBe(true);
    expect(semChave.cabe_ate).toBe('2027-03');
    expect(semChave.mes_falta).toBe('2027-04');
    expect(semChave.falta_valor).toBe(30000);
  });
});

describe('projetarBolsas — modo exemplo coerente com a 066', () => {
  it('cada centro com bolsas tem fim de janela, fim de bolsa e compromisso igual à soma', async () => {
    const resumo = await dadosExemplo.resumoProjetos();
    expect(resumo.erro).toBeNull();

    for (const centro of resumo.dados.todos) {
      const resposta = await dadosExemplo.saldoLivre(centro.id);
      if (resposta.erro || !resposta.dados) continue;
      const saldo = resposta.dados;
      if (!Array.isArray(saldo.bolsas_ativas) || saldo.bolsas_ativas.length === 0) continue;

      expect(saldo.compromissos_fim).toBe(saldo.end_date);
      const soma = saldo.bolsas_ativas.reduce(
        (total, bolsa) => total + bolsa.valor_mensal * bolsa.meses,
        0
      );
      const atrasada = Number(saldo.folha_atrasada?.valor) || 0;
      expect(Math.abs(soma + atrasada - saldo.compromissos_bolsas)).toBeLessThanOrEqual(
        1
      );

      for (const bolsa of saldo.bolsas_ativas) {
        expect(bolsa.end_date).toBeTruthy();
        expect(bolsa.meses).toBeGreaterThan(0);
        expect(bolsa.end_date.slice(0, 7) >= saldo.compromissos_inicio.slice(0, 7)).toBe(true);
        expect(bolsa.end_date.slice(0, 7) <= saldo.compromissos_fim.slice(0, 7)).toBe(true);
      }
    }
  });

  it('tem uma bolsa encerrada dentro da janela e uma que começa no meio', async () => {
    const cerrado = (await dadosExemplo.saldoLivre('00000000-0000-4000-8000-000000030901'))
      .dados;
    const encerrada = cerrado.bolsas_ativas.find(
      (bolsa) =>
        bolsa.end_date < '2026-11-23' &&
        bolsa.end_date.slice(0, 7) >= cerrado.compromissos_inicio.slice(0, 7) &&
        bolsa.meses >= 1
    );
    expect(encerrada).toBeTruthy();

    const corredor = (await dadosExemplo.saldoLivre('00000000-0000-4000-8000-000000030907'))
      .dados;
    const [anoInicio, mesInicio] = corredor.compromissos_inicio
      .slice(0, 7)
      .split('-')
      .map(Number);
    const inicioEmMeses = anoInicio * 12 + (mesInicio - 1);
    const comecaNoMeio = corredor.bolsas_ativas.some((bolsa) => {
      const [ano, mes] = bolsa.end_date.slice(0, 7).split('-').map(Number);
      return ano * 12 + (mes - 1) - (bolsa.meses - 1) > inicioEmMeses;
    });
    expect(comecaNoMeio).toBe(true);
  });

  it('o centro com folha atrasada tem o valor somado no compromisso e no livre, e a conta o desconta no 1º mês', async () => {
    const id = '00000000-0000-4000-8000-000000030910';
    const saldo = (await dadosExemplo.saldoLivre(id)).dados;
    const atrasada = saldo.folha_atrasada.valor;
    const rubrica = saldo.rubricas.find((item) => item.compromisso_tipo === 'bolsas');
    const grupo = saldo.grupos.find((item) => item.grupo_code === rubrica.grupo_code);
    const somaBolsas = saldo.bolsas_ativas.reduce(
      (total, bolsa) => total + bolsa.valor_mensal * bolsa.meses,
      0
    );

    expect(atrasada).toBe(8000);
    expect(saldo.compromissos_bolsas).toBe(somaBolsas + atrasada);
    expect(rubrica.compromissos).toBe(somaBolsas + atrasada);
    expect(rubrica.saldo_livre).toBe(rubrica.saldo - rubrica.compromissos);
    expect(grupo.compromissos).toBe(rubrica.compromissos);
    expect(grupo.saldo_livre).toBe(rubrica.saldo_livre);

    const resumo = await dadosExemplo.resumoProjetos();
    const centro = resumo.dados.centros.find((item) => item.id === id);
    expect(centro.livre).toBe(52000);
    expect(grupo.saldo_livre).toBe(52000);

    const arvore = await dadosExemplo.explicarLivre(id);
    expect(arvore.erro).toBeNull();
    expect(arvore.dados.valor).toBe(52000);

    const repasses = (await dadosExemplo.repasses(id)).dados;
    const projecao = projetarBolsas({
      saldo,
      repasses,
      hoje: HOJE,
      contar: { futuro: true, atrasado: false, rendimento: false },
    });

    expect(projecao.estado).toBe('ok');
    expect(projecao.folha_atrasada).toBe(8000);
    expect(projecao.meses[0].folha_atrasada).toBe(8000);
    expect(projecao.meses[0].em_conta_apos_folha).toBe(44000);
    expect(projecao.mes_falta).toBe('2027-05');
    expect(projecao.falta_valor).toBe(4000);
    expect(projecao.cabe_ate).toBe('2027-04');
    expect(projecao.avisos.some((aviso) => aviso.includes('difere'))).toBe(false);
  });
});
