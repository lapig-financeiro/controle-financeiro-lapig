import { describe, expect, it, vi } from 'vitest';
import { docxSintetico } from './helpers/plano-sintetico.js';
import { ClienteSupabase } from '../tools/rastreabilidade/cliente.mjs';
import { ErroFatal, ErroRpc } from '../tools/rastreabilidade/erros.mjs';
import { executarBackfill } from '../tools/rastreabilidade/executar.mjs';

const PROJETO = {
  id: '00000000-0000-0000-0000-000000000001',
  code: '99.E2E',
  name: 'Projeto sintético',
};

const PLANO_ID = '00000000-0000-0000-0000-000000000003';

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

function clienteComPlano({ rubricas = [], registrarDocumento, arquivo = docxSintetico() } = {}) {
  return clienteMinimo({
    lerPlanosAtivos: vi.fn(async () => [{
      id: PLANO_ID,
      project_id: PROJETO.id,
      versao: 1,
      ativo: true,
      valor_total_plano: null,
      arquivo_storage_path: `${PROJETO.id}/plano.docx`,
      arquivo_nome: 'plano.docx',
    }]),
    lerRubricasDoPlano: vi.fn(async () => rubricas),
    baixarArquivo: vi.fn(async () => arquivo),
    ...(registrarDocumento ? { registrarDocumento } : {}),
  });
}

function lancamento(id, balanceteId, conta, valor = 100) {
  return {
    id,
    balancete_id: balanceteId,
    conta_codigo: conta,
    saldo_atual: valor,
    rubrica_code: 'b',
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

  function clienteComBalanceteInconsistente({ raw, lancamentos }) {
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
      raw_extraction: raw,
    };
    const cliente = clienteMinimo({
      lerBalancetesDoAno: vi.fn(async () => [balancete]),
      lerLancamentos: vi.fn(async () => lancamentos),
    });
    return { cliente, balancete };
  }

  function conferirRecusaPorInconsistencia(resultado, cliente) {
    expect(resultado.resumo.documentos).toBe(1);
    expect(resultado.resumo.documentos_recusados).toBe(1);
    const documento = resultado.centros[0].documentos[0];
    expect(documento.status).toBe('recusado');
    expect(documento.motivo).toBe('lancamentos_inconsistentes');
    expect(cliente.baixarArquivo).not.toHaveBeenCalled();
    expect(cliente.registrarDocumento).not.toHaveBeenCalled();
  }

  it('lançamentos de um balancete que tem lançamentos não podem voltar vazios', async () => {
    const { cliente } = clienteComBalanceteInconsistente({
      raw: { lancamentos: [{ conta_codigo: '7.1.3.01' }, { conta_codigo: '7.1.3.02' }] },
      lancamentos: [],
    });

    const resultado = await executarBackfill({ cliente, opcoes: { ano: 2026 } });
    conferirRecusaPorInconsistencia(resultado, cliente);
  });

  it('menos lançamentos do que o raw_extraction indica recusa só aquele documento', async () => {
    const { cliente, balancete } = clienteComBalanceteInconsistente({
      raw: { lancamentos: [{}, {}, {}] },
      lancamentos: [lancamento('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002', '7.1.3.01')],
    });

    const resultado = await executarBackfill({ cliente, opcoes: { ano: 2026 } });
    conferirRecusaPorInconsistencia(resultado, cliente);
    expect(resultado.centros[0].documentos[0].id).toBe(balancete.id);
  });
});

describe('executarBackfill — zero fatos, retentativa e sessão', () => {
  it('documento sem nenhum fato vira sem_fatos e não chama a RPC', async () => {
    const cliente = clienteComPlano({
      rubricas: [{
        id: '00000000-0000-0000-0000-000000000011',
        plano_id: PLANO_ID,
        rubrica_code: 'a',
        descricao_livre: 'Rubrica que nao aparece no documento sintetico',
        valor_previsto: 1234.56,
      }],
    });

    const resultado = await executarBackfill({
      cliente,
      opcoes: { aplicar: true, ano: 2026 },
    });

    expect(resultado.resumo.sem_fatos).toBe(1);
    expect(resultado.centros[0].documentos[0].status).toBe('sem_fatos');
    expect(resultado.centros[0].documentos[0].fatos).toEqual([]);
    expect(cliente.registrarDocumento).not.toHaveBeenCalled();
  }, 20000);

  it('recusa por CPF sem suspeito pula o documento sem segunda chamada', async () => {
    const registrarDocumento = vi.fn(async () => {
      throw new ErroRpc('Trecho do fato contém CPF e não pode ser gravado.');
    });
    const cliente = clienteComPlano({
      rubricas: [{
        id: '00000000-0000-0000-0000-000000000012',
        plano_id: PLANO_ID,
        rubrica_code: 'a.bolsas',
        descricao_livre: 'Bolsas',
        valor_previsto: 800,
      }],
      registrarDocumento,
    });

    const resultado = await executarBackfill({
      cliente,
      opcoes: { aplicar: true, ano: 2026 },
    });

    const documento = resultado.centros[0].documentos[0];
    expect(documento.status).toBe('recusado');
    expect(documento.motivo).toBe('cpf');
    expect(documento.removidos).toEqual([]);
    expect(registrarDocumento).toHaveBeenCalledTimes(1);
  }, 20000);

  it('retentativa por CPF que esvazia os fatos vira sem_fatos sem segunda chamada', async () => {
    const registrarDocumento = vi.fn(async () => {
      throw new ErroRpc('Trecho do fato contém CPF e não pode ser gravado.');
    });
    const cliente = clienteComPlano({
      rubricas: [{
        id: '00000000-0000-0000-0000-000000000014',
        plano_id: PLANO_ID,
        rubrica_code: 'a.bolsas',
        descricao_livre: 'Linha sintetica com documento',
        valor_previsto: 800,
      }],
      // A regra da 065 não vê CPF (letras nos vãos); a larga da 064 vê.
      arquivo: docxSintetico({
        linhasExtras: [['Linha sintetica com documento', '800,00 529abcd982efgh247ijkl25']],
      }),
      registrarDocumento,
    });

    const resultado = await executarBackfill({
      cliente,
      opcoes: { aplicar: true, ano: 2026 },
    });

    const documento = resultado.centros[0].documentos[0];
    expect(documento.status).toBe('sem_fatos');
    expect(documento.fatos).toEqual([]);
    expect(documento.contagens.com_cpf).toBe(1);
    expect(registrarDocumento).toHaveBeenCalledTimes(1);
  }, 20000);

  it('401/403 no meio da corrida aborta com "login expirou"', async () => {
    const registrarDocumento = vi.fn(async () => {
      throw new ErroFatal('login expirou: rode de novo');
    });
    const cliente = clienteComPlano({
      rubricas: [{
        id: '00000000-0000-0000-0000-000000000013',
        plano_id: PLANO_ID,
        rubrica_code: 'a.bolsas',
        descricao_livre: 'Bolsas',
        valor_previsto: 800,
      }],
      registrarDocumento,
    });

    await expect(executarBackfill({ cliente, opcoes: { aplicar: true, ano: 2026 } }))
      .rejects.toThrow(/login expirou: rode de novo/);
  }, 20000);

  it('o cliente HTTP trata 401 como sessão expirada, não como recusa', async () => {
    const respostas = [
      { ok: true, status: 200, json: async () => ({ access_token: 'token-sintetico', user: { id: 'u' } }) },
      { ok: false, status: 401, json: async () => ({}) },
    ];
    const fetchImpl = vi.fn(async () => respostas.shift());
    const cliente = new ClienteSupabase({
      url: 'https://exemplo.invalido',
      anonKey: 'chave-sintetica',
      email: 'admin@exemplo.invalido',
      senha: 'senha-sintetica',
      fetchImpl,
    });

    await expect(cliente.lerProjetosAtivos()).rejects.toThrow(/login expirou: rode de novo/);
  });
});
