import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { acharAlvo, linhasDaPagina } from '../frontend/js/origem-busca.js';

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

const BALANCETE_SINTETICO = [
  'FUNDACAO DE APOIO A PESQUISA Balancete Contábil Analítico 01/01/2000 a 15/11/2026 Pág.: 1',
  'Conta Reduzido Descrição Anterior Débitos Créditos Movimento Saldo Atual',
  '7.1.3.04.01.09142 2579142 BOLSA DOAÇÃO 0,00 50.000,00 0,00 50.000,00 50.000,00',
  '7.1.3.05.01.00027 2506027 SERVIÇOS ANÁLISE PESQ. CIENTÍFICA 0,00 15.000,00 0,00 15.000,00 15.000,00',
  '7.1.3.05.01.00014 2506014 INSCRIÇÃO CONGRESSO 0,00 5.000,00 0,00 5.000,00 5.000,00',
  'TOTAL DE DÉBITOS : 120.000,00',
  'TOTAL DE CRÉDITOS: 315.000,00',
  'SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ 195.000,00',
  'RENDIMENTO LÍQUIDO APURADO ==>> R$ 3.500,00',
];

const PLANO_SINTETICO = [
  'PLANO DE TRABALHO — PROJETO SINTÉTICO',
  'Valor Total do Plano: R$ 80.000,00',
  'a.bolsas — Bolsas 50.000,00',
  'b — Serviços de Terceiros PJ 60.000,00',
  'Serviços técnicos especializados 45.000,00',
  'Participação em congressos 15.000,00',
  'Cronograma de desembolso',
  'Parcela 1 — 100.000,00',
  'Parcela 2 — 100.000,00',
  'Parcela 3 — 60.000,00',
];

describe('origem-busca (064) — busca de origem legado com acharAlvo', () => {
  const pagBal = paginasDe(BALANCETE_SINTETICO);
  const pagPlano = paginasDe(PLANO_SINTETICO);

  it('acha lançamento do balancete por { conta_codigo, valor }', () => {
    expect(acharAlvo(pagBal, { conta_codigo: '7.1.3.05.01.00014', valor: 5000 })).toEqual([
      { pagina: 1, linha: 4, motivo: 'codigo' },
    ]);
  });

  it('acha cabeçalhos do balancete por { texto, valor }', () => {
    expect(acharAlvo(pagBal, { texto: 'saldo disponivel', valor: 195000 })).toEqual([
      { pagina: 1, linha: 7, motivo: 'valor' },
    ]);
    expect(acharAlvo(pagBal, { texto: 'rendimento liquido', valor: 3500 })).toEqual([
      { pagina: 1, linha: 8, motivo: 'valor' },
    ]);
    expect(acharAlvo(pagBal, { texto: 'total de debitos', valor: 120000 })).toEqual([
      { pagina: 1, linha: 5, motivo: 'valor' },
    ]);
    expect(acharAlvo(pagBal, { texto: 'total de creditos', valor: 315000 })).toEqual([
      { pagina: 1, linha: 6, motivo: 'valor' },
    ]);
  });

  it('acha total do plano, rubrica (com ou sem descrição livre) e parcela de desembolso', () => {
    expect(acharAlvo(pagPlano, { texto: 'valor total', valor: 80000 })).toEqual([
      { pagina: 1, linha: 1, motivo: 'valor' },
    ]);
    expect(acharAlvo(pagPlano, { texto: 'Bolsas', valor: 50000 })).toEqual([
      { pagina: 1, linha: 2, motivo: 'valor' },
    ]);
    expect(acharAlvo(pagPlano, { texto: 'Participação em congressos', valor: 15000 })).toEqual([
      { pagina: 1, linha: 5, motivo: 'valor' },
    ]);
    expect(acharAlvo(pagPlano, { texto: 'Parcela 2', valor: 100000 })).toEqual([
      { pagina: 1, linha: 8, motivo: 'valor' },
    ]);
  });
});

const pgliteEntryUrl = new URL(
  '../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js',
  import.meta.url,
);
const temPglite = existsSync(fileURLToPath(pgliteEntryUrl));

describe.runIf(temPglite)('origem-busca (064) — integração real get_origem_v2 -> acharAlvo', () => {
  let db;
  const pagBal = paginasDe(BALANCETE_SINTETICO);
  const pagPlano = paginasDe(PLANO_SINTETICO);

  beforeAll(async () => {
    const { PGlite } = await import(pgliteEntryUrl.href);
    const { montarBase064, carregarArquivo } = await import(
      '../tools/replica-local/rodar-064-pglite.mjs'
    );
    db = new PGlite();
    await montarBase064(db, { quiet: true });
    await carregarArquivo(db, 'database/064_rastreabilidade.sql', { quiet: true });
    await carregarArquivo(db, 'tools/replica-local/sintetico/stub-064.sql', { quiet: true });
  }, 20000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it('busca devolvida por get_origem_v2 (legado) encontra a linha certa em acharAlvo para todas as 5 tabelas', async () => {
    const ids = (await db.query(`
      select
        (select id from public.projects where code = '51.X') as x_id,
        (select id from public.projects where code = '51.Y') as y_id,
        (select bl.id
           from public.balancete_lancamentos bl
           join public.balancetes b on b.id = bl.balancete_id
           join public.projects p on p.id = b.project_id
          where p.code = '51.X' and bl.conta_codigo = '7.1.3.05.01.00014'
          limit 1) as bl_leg_id,
        (select b.id
           from public.balancetes b
           join public.projects p on p.id = b.project_id
          where p.code = '51.X'
          order by b.data_referencia desc
          limit 1) as bal_x_id,
        (select pt.id
           from public.planos_trabalho pt
           join public.projects p on p.id = pt.project_id
          where p.code = '51.Y' and pt.ativo = true
          limit 1) as pl_y_id,
        (select pr.id
           from public.plano_rubricas pr
           join public.planos_trabalho pt on pt.id = pr.plano_id
           join public.projects p on p.id = pt.project_id
          where p.code = '51.X' and pr.rubrica_code = 'b' and pr.descricao_livre = 'Participação em congressos'
          limit 1) as pr_x_leg_id,
        (select pr.id
           from public.plano_rubricas pr
           join public.planos_trabalho pt on pt.id = pr.plano_id
           join public.projects p on p.id = pt.project_id
          where p.code = '51.Y' and pr.rubrica_code = 'a.bolsas'
          limit 1) as pr_y_sem_desc_id,
        (select pd.id
           from public.plano_desembolsos pd
           join public.planos_trabalho pt on pt.id = pd.plano_id
           join public.projects p on p.id = pt.project_id
          where p.code = '51.X' and pd.parcela = 2
          limit 1) as pd_x_p2_id
    `)).rows[0];

    async function chamarOrigem(userId, tabela, id, campo) {
      const res = await db.query(
        `select public.get_origem_v2($1, $2::uuid, $3) as origem`,
        [tabela, id, campo],
      );
      return res.rows[0].origem;
    }

    await db.exec(`
      begin;
      select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
      set local role authenticated;
    `);
    try {
      const oLanc = await chamarOrigem('b1', 'balancete_lancamentos', ids.bl_leg_id, 'saldo_atual');
      expect(oLanc.tipo).toBe('legado');
      expect(acharAlvo(pagBal, oLanc.busca)).toEqual([{ pagina: 1, linha: 4, motivo: 'codigo' }]);

      const oDeb = await chamarOrigem('b1', 'balancetes', ids.bal_x_id, 'total_debitos');
      expect(oDeb.tipo).toBe('legado');
      expect(acharAlvo(pagBal, oDeb.busca)).toEqual([{ pagina: 1, linha: 5, motivo: 'valor' }]);

      const oRubComDesc = await chamarOrigem('b1', 'plano_rubricas', ids.pr_x_leg_id, 'valor_previsto');
      expect(oRubComDesc.tipo).toBe('legado');
      expect(acharAlvo(pagPlano, oRubComDesc.busca)).toEqual([{ pagina: 1, linha: 5, motivo: 'valor' }]);

      const oDesemb = await chamarOrigem('b1', 'plano_desembolsos', ids.pd_x_p2_id, 'valor');
      expect(oDesemb.tipo).toBe('legado');
      expect(acharAlvo(pagPlano, oDesemb.busca)).toEqual([{ pagina: 1, linha: 8, motivo: 'valor' }]);
    } finally {
      await db.exec('rollback;');
    }

    await db.exec(`
      begin;
      select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
      set local role authenticated;
    `);
    try {
      const oPlano = await chamarOrigem('a1', 'planos_trabalho', ids.pl_y_id, 'valor_total_plano');
      expect(oPlano.tipo).toBe('legado');
      expect(acharAlvo(pagPlano, oPlano.busca)).toEqual([{ pagina: 1, linha: 1, motivo: 'valor' }]);

      const oRubSemDesc = await chamarOrigem('a1', 'plano_rubricas', ids.pr_y_sem_desc_id, 'valor_previsto');
      expect(oRubSemDesc.tipo).toBe('legado');
      expect(acharAlvo(pagPlano, oRubSemDesc.busca)).toEqual([{ pagina: 1, linha: 2, motivo: 'valor' }]);
    } finally {
      await db.exec('rollback;');
    }
  });
});
