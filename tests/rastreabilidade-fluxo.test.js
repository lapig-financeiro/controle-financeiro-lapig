import { describe, expect, it, vi } from 'vitest';
import { executarBackfill } from '../tools/rastreabilidade/executar.mjs';

const PROJETO = {
  id: '00000000-0000-0000-0000-000000000001',
  code: '99.E2E',
  name: 'Projeto sintético',
};

function clienteMinimo(extra = {}) {
  return {
    lerPapel: vi.fn(async () => 'admin'),
    lerProjetosAtivos: vi.fn(async () => [PROJETO]),
    lerBalancetesDoAno: vi.fn(async () => []),
    lerPlanosAtivos: vi.fn(async () => []),
    lerLancamentos: vi.fn(async () => []),
    lerRubricasDoPlano: vi.fn(async () => []),
    lerDesembolsos: vi.fn(async () => []),
    lerRubricas: vi.fn(async () => []),
    lerDocumentos: vi.fn(async () => []),
    lerVersoesExistentes: vi.fn(async () => []),
    baixarArquivo: vi.fn(async () => Buffer.from('%PDF-1.4')),
    registrarDocumento: vi.fn(async () => ({ criada: true })),
    ...extra,
  };
}

describe('executarBackfill — credencial e escopo', () => {
  it('aborta se o papel não for admin, antes de qualquer leitura de dados', async () => {
    const cliente = clienteMinimo({ lerPapel: vi.fn(async () => 'professor') });
    await expect(executarBackfill({ cliente })).rejects.toThrow(/admin/);
    expect(cliente.lerProjetosAtivos).not.toHaveBeenCalled();
  });

  it('aborta quando --centro não acha exatamente um projeto ativo', async () => {
    const cliente = clienteMinimo();
    await expect(executarBackfill({ cliente, opcoes: { centro: '99.OUTRO', ano: 2026 } }))
      .rejects.toThrow(/--centro 99\.OUTRO/);
  });

  it('sem projetos ativos devolve resumo vazio sem falar com o resto do banco', async () => {
    const cliente = clienteMinimo({ lerProjetosAtivos: vi.fn(async () => []) });
    const resultado = await executarBackfill({ cliente, opcoes: { ano: 2026 } });
    expect(resultado.resumo.documentos).toBe(0);
    expect(resultado.centros).toEqual([]);
    expect(cliente.lerBalancetesDoAno).not.toHaveBeenCalled();
  });

  it('lançamentos de um balancete que tem lançamentos não podem voltar vazios', async () => {
    const balancete = {
      id: '00000000-0000-0000-0000-000000000002',
      project_id: PROJETO.id,
      data_referencia: '2026-10-15',
      saldo_disponivel: 100,
      rendimento_liquido: null,
      total_debitos: null,
      total_creditos: null,
      arquivo_storage_path: `${PROJETO.id}/balancete.pdf`,
      arquivo_nome: 'balancete.pdf',
      raw_extraction: { lancamentos: [{ conta_codigo: '7.1.3.01' }, { conta_codigo: '7.1.3.02' }] },
    };
    const cliente = clienteMinimo({
      lerBalancetesDoAno: vi.fn(async () => [balancete]),
      lerLancamentos: vi.fn(async () => []),
    });

    await expect(executarBackfill({ cliente, opcoes: { ano: 2026 } }))
      .rejects.toThrow(/raw_extraction/);
  });

  it('menos lançamentos do que o raw_extraction indica também aborta', async () => {
    const balancete = {
      id: '00000000-0000-0000-0000-000000000002',
      project_id: PROJETO.id,
      data_referencia: '2026-10-15',
      saldo_disponivel: 100,
      rendimento_liquido: null,
      total_debitos: null,
      total_creditos: null,
      arquivo_storage_path: `${PROJETO.id}/balancete.pdf`,
      arquivo_nome: 'balancete.pdf',
      raw_extraction: { lancamentos: [{}, {}, {}] },
    };
    const cliente = clienteMinimo({
      lerBalancetesDoAno: vi.fn(async () => [balancete]),
      lerLancamentos: vi.fn(async () => [
        { id: '00000000-0000-0000-0000-000000000010', balancete_id: balancete.id, conta_codigo: '7.1.3.01', saldo_atual: 1, rubrica_code: 'b' },
      ]),
    });

    await expect(executarBackfill({ cliente, opcoes: { ano: 2026 } }))
      .rejects.toThrow(/menos linhas/);
  });
});
