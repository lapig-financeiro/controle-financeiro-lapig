import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { criarSessao } from '../../shared/ai-tools/index.js';

const aqui = dirname(fileURLToPath(import.meta.url));

function fixture(nome) {
  return JSON.parse(
    readFileSync(resolve(aqui, '..', 'fixtures', 'ai-tools-v2', `${nome}.json`), 'utf8')
  );
}

function montar(overrides = {}) {
  const respostas = {
    resumo_projetos_v2: { data: fixture('resumo_projetos'), error: null },
    explicar_livre_v2: { data: fixture('explicar_livre'), error: null },
    situacao_centro_v2: { data: fixture('situacao_centro'), error: null },
    get_repasses_v2: { data: fixture('repasses'), error: null },
    get_termos_contrato_v2: { data: fixture('termos_contrato'), error: null },
    listar_pendencias_v2: { data: fixture('pendencias'), error: null },
    get_pedido_bolsas_v2: { data: fixture('pedido_bolsas'), error: null },
    ...overrides,
  };
  const rpc = async (nome) => respostas[nome] ?? { data: null, error: { message: `sem fixture: ${nome}` } };
  return criarSessao({ rpc, hoje: '2026-11-25' });
}

function json(resultado) {
  expect(resultado.erro).toBeUndefined();
  return JSON.parse(resultado.paraModelo);
}

function acharNo(dados, parteDoRotulo) {
  const no = dados.nos.find((item) => item.rotulo.includes(parteDoRotulo));
  expect(no, `nó com rótulo "${parteDoRotulo}"`).toBeTruthy();
  return no;
}

describe('listar_centros', () => {
  it('devolve centros, motivos e origem livre', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('listar_centros', {}));
    expect(dados.centros).toHaveLength(3);
    const livre = acharNo(dados, 'Livre — Centro Exemplo Um');
    expect(livre.valor).toBe(84300);
    expect(livre.unidade).toBe('moeda');
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: livre.id }).bloco;
    expect(bloco.numero.origem.tipo).toBe('livre');
    expect(bloco.numero.origem.project_id).toBe('00000000-0000-4000-8000-000000030901');
  });

  it('centro sem balancete não vira zero', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('listar_centros', {}));
    const centro = dados.centros.find(
      (item) => dados.nos.find((no) => no.id === item.codigo).valor === '30.903'
    );
    expect(centro.livre).toBeNull();
    expect(dados.nos.find((no) => no.id === centro.situacao).valor).toBe('sem balancete');
  });
});

describe('explicar_livre', () => {
  it('registra a árvore inteira e usa origem no com as partes', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('explicar_livre', { project_id: '30.901' }));
    expect(dados.raiz).toMatch(/^r1\./);
    expect(dados.nos.length).toBeGreaterThan(10);
    const raiz = dados.nos.find((no) => no.id === dados.raiz);
    expect(raiz.valor).toBe(84300);
    expect(dados.estrutura[dados.raiz].partes).toHaveLength(3);

    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: dados.raiz }).bloco;
    expect(bloco.numero.origem.tipo).toBe('no');
    expect(bloco.numero.origem.no.rotulo).toBe('Livre para gastar');
    expect(bloco.numero.origem.no.partes).toHaveLength(3);
  });

  it('acima de 200 nós cai para origem livre', async () => {
    const grande = {
      rotulo: 'Livre para gastar',
      valor: 1,
      tipo: 'calculo',
      sinal: 1,
      partes: Array.from({ length: 201 }, (_, indice) => ({
        rotulo: `Parte ${indice + 1}`,
        valor: 1,
        tipo: 'calculo',
        sinal: 1,
        partes: [],
      })),
    };
    const sessao = montar({ explicar_livre_v2: { data: grande, error: null } });
    const dados = json(await sessao.executar('explicar_livre', { project_id: '30.901' }));
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: dados.raiz }).bloco;
    expect(bloco.numero.origem.tipo).toBe('livre');
    expect(bloco.numero.origem.project_id).toBe('00000000-0000-4000-8000-000000030901');
  });
});

describe('situacao_centro', () => {
  it('motivo que casa com a árvore usa origem no', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('situacao_centro', { project_id: '30.901' }));
    const folha = acharNo(dados, 'Comprometido — folha atrasada');
    expect(folha.valor).toBe(8000);
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: folha.id }).bloco;
    expect(bloco.numero.origem.tipo).toBe('no');
    expect(bloco.numero.origem.no.chave).toBe('rubrica:a.bolsas:folha_atrasada');
  });

  it('motivo que não casa fica sem_documento', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('situacao_centro', { project_id: '30.901' }));
    const tarifa = acharNo(dados, 'Valor do motivo');
    expect(tarifa.valor).toBe(14.34);
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: tarifa.id }).bloco;
    expect(bloco.numero.origem.tipo).toBe('sem_documento');
  });

  it('sem árvore, o valor do motivo fica sem_documento sem derrubar a situação', async () => {
    const sessao = montar({
      explicar_livre_v2: { data: null, error: { message: 'árvore indisponível' } },
    });
    const dados = json(await sessao.executar('situacao_centro', { project_id: '30.901' }));
    const folha = acharNo(dados, 'Valor do motivo');
    expect(folha.valor).toBe(8000);
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: folha.id }).bloco;
    expect(bloco.numero.origem.tipo).toBe('sem_documento');
  });
});

describe('desembolsos', () => {
  it('parcela sem ref fica sem_documento e com ref vira ref', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('desembolsos', { project_id: '30.901' }));
    const parcela1 = acharNo(dados, 'Valor — parcela 1');
    const parcela2 = acharNo(dados, 'Valor — parcela 2');
    expect(parcela1.valor).toBe(250000);
    expect(parcela2.valor).toBe(350000);

    const bloco1 = sessao.criarBloco({ tipo: 'numero', titulo: '', no: parcela1.id }).bloco;
    const bloco2 = sessao.criarBloco({ tipo: 'numero', titulo: '', no: parcela2.id }).bloco;
    expect(bloco1.numero.origem.tipo).toBe('sem_documento');
    expect(bloco2.numero.origem.tipo).toBe('ref');
    expect(bloco2.numero.origem.ref.alvo_tabela).toBe('plano_desembolsos');
  });
});

describe('termos_contrato', () => {
  it('vigência é data e taxa é percentual, ambas com origem termo', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('termos_contrato', { project_id: '30.901' }));
    const taxa = acharNo(dados, 'Taxa total');
    expect(taxa.valor).toBe(9.75);
    expect(taxa.unidade).toBe('percentual');
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: taxa.id }).bloco;
    expect(bloco.numero.origem.tipo).toBe('termo');
    expect(bloco.numero.origem.termo_id).toBe('termo-30901-total');
    expect(bloco.numero.origem.project_id).toBe('00000000-0000-4000-8000-000000030901');

    const inicio = acharNo(dados, 'Vigência — início');
    expect(inicio.unidade).toBe('data');
    expect(inicio.valor).toBe('2025-12-31');
  });
});

describe('pendencias', () => {
  it('devolve pendências com origem sem_documento', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('pendencias', { project_id: '30.901' }));
    expect(dados.pendencias).toHaveLength(2);
    const diferenca = acharNo(dados, 'Detalhe — diferenca');
    expect(diferenca.valor).toBe(-4250);
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: diferenca.id }).bloco;
    expect(bloco.numero.origem.tipo).toBe('sem_documento');
  });

  it('sem project_id passa null para a RPC', async () => {
    const chamadas = [];
    const respostas = {
      resumo_projetos_v2: { data: fixture('resumo_projetos'), error: null },
      listar_pendencias_v2: { data: fixture('pendencias'), error: null },
      get_pedido_bolsas_v2: { data: fixture('pedido_bolsas'), error: null },
    };
    const sessao = criarSessao({
      rpc: async (nome, args) => {
        chamadas.push({ nome, args });
        return respostas[nome];
      },
    });
    await sessao.executar('pendencias', {});
    const chamada = chamadas.find((item) => item.nome === 'listar_pendencias_v2');
    expect(chamada.args).toEqual({ p_project_id: null });
  });

  it('lista vazia da RPC é resposta honesta, não erro', async () => {
    const sessao = montar({ listar_pendencias_v2: { data: [], error: null } });
    const dados = json(await sessao.executar('pendencias', { project_id: '30.901' }));
    expect(dados.pendencias).toEqual([]);
    const total = dados.nos.find((no) => no.id === dados.total);
    expect(total.valor).toBe(0);
    expect(total.unidade).toBe('numero');
  });
});

describe('bolsas', () => {
  it('mascara nome e não devolve CPF nem e-mail', async () => {
    const sessao = montar();
    const resultado = await sessao.executar('bolsas', { project_id: '30.901' });
    const dados = json(resultado);
    expect(dados.bolsistas).toHaveLength(1);
    const nome = dados.nos.find((no) => no.id === dados.bolsistas[0].nome);
    expect(nome.valor).toBe('⟦P1⟧');
    expect(resultado.paraModelo).not.toContain('Pessoa Exemplo Um');
    expect(resultado.paraModelo).not.toContain('123.456.789-09');
    expect(resultado.paraModelo).not.toContain('pessoa.exemplo@exemplo.test');
    const valor = acharNo(dados, 'Valor mensal da bolsa');
    expect(valor.valor).toBe(4200);
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: valor.id }).bloco;
    expect(bloco.numero.origem.tipo).toBe('sem_documento');
  });
});

describe('erro de RPC em cada ferramenta', () => {
  const casos = [
    ['listar_centros', {}, 'resumo_projetos_v2'],
    ['explicar_livre', { project_id: '30.901' }, 'explicar_livre_v2'],
    ['situacao_centro', { project_id: '30.901' }, 'situacao_centro_v2'],
    ['desembolsos', { project_id: '30.901' }, 'get_repasses_v2'],
    ['termos_contrato', { project_id: '30.901' }, 'get_termos_contrato_v2'],
    ['pendencias', { project_id: '30.901' }, 'listar_pendencias_v2'],
    ['bolsas', { project_id: '30.901' }, 'get_pedido_bolsas_v2'],
  ];

  for (const [ferramenta, argumentos, rpc] of casos) {
    it(`${ferramenta}: falha de ${rpc} vira erro`, async () => {
      const sessao = montar({ [rpc]: { data: null, error: { message: `falha em ${rpc}` } } });
      const resultado = await sessao.executar(ferramenta, argumentos);
      expect(resultado.id).toMatch(/^r\d+$/);
      expect(resultado.erro).toContain(`falha em ${rpc}`);
      expect(resultado.paraModelo).toBeUndefined();
    });
  }
});

describe('argumento inválido em cada ferramenta', () => {
  const casos = [
    ['explicar_livre', {}],
    ['situacao_centro', {}],
    ['desembolsos', {}],
    ['termos_contrato', {}],
    ['pendencias', { project_id: '30.999' }],
    ['bolsas', { project_id: '30.999' }],
  ];

  for (const [ferramenta, argumentos] of casos) {
    it(`${ferramenta}: recusa argumento inválido`, async () => {
      const sessao = montar();
      const resultado = await sessao.executar(ferramenta, argumentos);
      expect(resultado.erro).toBeTruthy();
      expect(resultado.paraModelo).toBeUndefined();
    });
  }
});
