import { describe, expect, it } from 'vitest';
import { projetarBolsas } from '../src/servicos/projecao.js';

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
      { parcela: 3, valor: 500000, quando: '10/10/2026' },
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
    saldo.compromissos_bolsas = 10000;
    saldo.end_date = '2026-12-31';
    saldo.saldo_disponivel_caixa = 10000;
    saldo.rendimento_liquido = 0;
    saldo.bolsas_ativas = [{ scholarship_id: 'b-1', valor_mensal: 10000, meses: 1 }];
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
    saldo.compromissos_bolsas = 35000;
    saldo.end_date = '2027-02-28';
    saldo.saldo_disponivel_caixa = 100000;
    saldo.rendimento_liquido = 0;
    saldo.bolsas_ativas = [
      { scholarship_id: 'b-1', valor_mensal: 10000, meses: 3 },
      { scholarship_id: 'b-2', valor_mensal: 5000, meses: 1 },
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
      { parcela: 1, valor: 500000, quando: '10/01/2027' },
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
