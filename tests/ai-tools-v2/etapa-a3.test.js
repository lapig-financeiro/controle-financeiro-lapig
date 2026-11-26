import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { criarSessao } from '../../shared/ai-tools/index.js';

const aqui = dirname(fileURLToPath(import.meta.url));

const ID_901 = '00000000-0000-4000-8000-000000030901';
const ID_902 = '00000000-0000-4000-8000-000000030902';
const ID_903 = '00000000-0000-4000-8000-000000030903';

function fixture(nome) {
  return JSON.parse(
    readFileSync(resolve(aqui, '..', 'fixtures', 'ai-tools-v2', `${nome}.json`), 'utf8')
  );
}

function respostasPadrao() {
  return {
    resumo_projetos_v2: { data: fixture('resumo_projetos'), error: null },
    get_repasses_v2: { data: fixture('repasses'), error: null },
    get_termos_contrato_v2: { data: fixture('termos_contrato'), error: null },
    get_pedido_bolsas_v2: { data: fixture('pedido_bolsas'), error: null },
  };
}

function montar(overrides = {}) {
  const respostas = { ...respostasPadrao(), ...overrides };
  const chamadas = [];
  const rpc = async (nome, args) => {
    chamadas.push({ nome, args });
    const resposta = respostas[nome];
    if (typeof resposta === 'function') return resposta(args);
    return resposta ?? { data: null, error: { message: `sem fixture: ${nome}` } };
  };
  return { sessao: criarSessao({ rpc, hoje: '2026-11-25' }), chamadas };
}

function json(resultado) {
  expect(resultado.erro).toBeUndefined();
  return JSON.parse(resultado.paraModelo);
}

function centroPorCodigo(dados, codigo) {
  const centro = dados.centros.find((item) => {
    const no = dados.nos.find((candidato) => candidato.id === item.codigo);
    return no && no.valor === codigo;
  });
  expect(centro, `centro ${codigo}`).toBeTruthy();
  return centro;
}

function idsUsados(valor, alvo = new Set()) {
  if (typeof valor === 'string') {
    if (/^(?:r\d+|c\d+)(?:\.\d+)?$/.test(valor)) alvo.add(valor);
  } else if (Array.isArray(valor)) {
    for (const item of valor) idsUsados(item, alvo);
  } else if (valor && typeof valor === 'object') {
    for (const item of Object.values(valor)) idsUsados(item, alvo);
  }
  return alvo;
}

/** 240 bolsistas sintéticos com 2 bolsas cada, todas no 30.901. */
function pedidoMuitoGrande() {
  const valores = [4200, 5200, 1500, 800, 1040];
  const bolsistas = Array.from({ length: 240 }, (_, indice) => {
    const bolsas = [0, 1].map((posicao) => ({
      scholarship_id: `00000000-0000-4000-8000-00000009${String(indice).padStart(2, '0')}${posicao}`,
      project_id: ID_901,
      code: '30.901',
      valor: valores[(indice + posicao) % valores.length],
      inicio: '2026-03-01',
      fim: '2027-02-28',
      status: 'active',
      vigente_hoje: true,
    }));
    return {
      holder_id: `00000000-0000-4000-8000-00000010${String(indice).padStart(4, '0')}`,
      nome: `Pessoa Sintética ${String(indice + 1).padStart(3, '0')}`,
      equipe: 'pastagem',
      valor_vigente: bolsas[0].valor + bolsas[1].valor,
      bolsas,
    };
  });
  return { centros: [], bolsistas, caixas: [] };
}

describe('A9 — responsáveis mascarados em listar_centros', () => {
  it('cada responsável vira nó de texto com ⟦Pn⟧, rótulo e origem sem_documento', async () => {
    const { sessao } = montar();
    const resultado = await sessao.executar('listar_centros', {});
    const dados = json(resultado);
    const centro = centroPorCodigo(dados, '30.901');
    expect(centro.responsaveis).toHaveLength(1);

    const no = dados.nos.find((item) => item.id === centro.responsaveis[0]);
    expect(no.valor).toMatch(/^⟦P\d+⟧$/);
    expect(no.unidade).toBe('texto');
    expect(no.rotulo).toBe('Responsável — 30.901');
    expect(resultado.paraModelo).not.toContain('Pessoa Exemplo Um');

    const bloco = sessao.criarBloco({
      tipo: 'tabela',
      colunas: ['Responsável'],
      linhas: [[no.id]],
    }).bloco;
    expect(bloco.tabela.linhas[0][0]).toEqual({
      valor: no.valor,
      unidade: 'texto',
      origem: {
        tipo: 'sem_documento',
        motivo: 'responsável cadastrado no projeto',
        consulta: 'resumo_projetos_v2',
      },
    });
  });

  it('responsáveis ausentes, nulos ou vazios são aceitos e viram lista vazia', async () => {
    const resumo = fixture('resumo_projetos');
    delete resumo.centros[0].responsaveis;
    resumo.centros[1].responsaveis = null;
    resumo.centros[2].responsaveis = [];
    const { sessao } = montar({ resumo_projetos_v2: { data: resumo, error: null } });
    const dados = json(await sessao.executar('listar_centros', {}));
    for (const centro of dados.centros) expect(centro.responsaveis).toEqual([]);
  });

  it('responsável que não é string é erro de formato, nunca nome cru', async () => {
    const resumo = fixture('resumo_projetos');
    resumo.centros[0].responsaveis = [{ nome: 'Pessoa Exemplo Um' }];
    const { sessao } = montar({ resumo_projetos_v2: { data: resumo, error: null } });
    const resultado = await sessao.executar('listar_centros', {});
    expect(resultado.erro).toBe('Não foi possível carregar os centros. (formato)');
    expect(resultado.paraModelo).toBeUndefined();
  });

  it('o ⟦Pn⟧ da pergunta é o mesmo do responsável em listar_centros', async () => {
    const resumo = fixture('resumo_projetos');
    const alvo = resumo.centros.find((centro) => centro.code === '30.902');
    alvo.responsaveis = ['Responsável Exemplo'];
    const { sessao } = montar({ resumo_projetos_v2: { data: resumo, error: null } });

    const entrada = await sessao.mascararEntrada(
      'Quais são os centros da Responsável Exemplo?'
    );
    const resultado = await sessao.executar('listar_centros', {});
    const dados = json(resultado);
    const centro = centroPorCodigo(dados, '30.902');
    const no = dados.nos.find((item) => item.id === centro.responsaveis[0]);

    expect(entrada).toContain(no.valor);
    expect(entrada).not.toContain('Responsável Exemplo');
    expect(resultado.paraModelo).not.toContain('Responsável Exemplo');
  });

  it('resumo fora do ar não derruba a pergunta: segue com o dicionário de bolsistas', async () => {
    const { sessao } = montar({
      resumo_projetos_v2: { data: null, error: { message: 'fora do ar' } },
    });
    const entrada = await sessao.mascararEntrada('Pessoa Exemplo Um');
    expect(entrada).toBe('⟦P1⟧');
  });
});

describe('A10 — desembolsos sem project_id', () => {
  it('consulta todos os centros visíveis em paralelo e devolve uma única resposta', async () => {
    const { sessao, chamadas } = montar();
    const resultado = await sessao.executar('desembolsos', {});
    const dados = json(resultado);

    expect(chamadas.filter((chamada) => chamada.nome === 'get_repasses_v2')).toHaveLength(3);
    expect(dados.centros).toHaveLength(3);
    for (const centro of dados.centros) {
      expect(centro.erro).toBeUndefined();
      expect(centro.parcelas).toHaveLength(2);
      expect(centro.valor_total_plano).toMatch(/^r\d+\.\d+$/);
      expect(centro.data_balancete).toMatch(/^r\d+\.\d+$/);
      expect(centro.recursos.recebido).toMatch(/^r\d+\.\d+$/);
    }
    const um = centroPorCodigo(dados, '30.901');
    expect(dados.nos.find((no) => no.id === um.valor_total_plano).rotulo).toBe(
      'Valor total do plano — 30.901'
    );
  });

  it('com project_id mantém uma chamada e o resultado do centro único', async () => {
    const { sessao, chamadas } = montar();
    const dados = json(await sessao.executar('desembolsos', { project_id: '30.901' }));
    expect(chamadas.filter((chamada) => chamada.nome === 'get_repasses_v2')).toHaveLength(1);
    expect(dados.centros).toBeUndefined();
    expect(dados.parcelas).toHaveLength(2);
    expect(dados.nos.find((no) => no.rotulo === 'Valor — parcela 1').valor).toBe(250000);
  });

  it('falha de um centro fica registrada nele, sem derrubar os outros', async () => {
    const { sessao } = montar({
      get_repasses_v2: (args) => {
        if (args.p_project_id === ID_902) {
          return { data: null, error: { codigo: 'http_502', status: 502 } };
        }
        return { data: fixture('repasses'), error: null };
      },
    });
    const dados = json(await sessao.executar('desembolsos', {}));

    const falho = centroPorCodigo(dados, '30.902');
    expect(falho.codigo).toMatch(/^r\d+\.\d+$/);
    expect(falho.nome).toMatch(/^r\d+\.\d+$/);
    expect(falho.erro).toBe('Não foi possível carregar os desembolsos. (rede)');
    expect(falho.parcelas).toBeUndefined();
    expect(falho.valor_total_plano).toBeUndefined();
    expect(dados.centros.filter((centro) => centro.parcelas)).toHaveLength(2);
  });

  it('se todos os centros falharem, devolve { erro } e não publica nada', async () => {
    const { sessao } = montar({
      get_repasses_v2: { data: null, error: { status: 500 } },
    });
    const resultado = await sessao.executar('desembolsos', {});
    expect(resultado.erro).toBe('Não foi possível carregar os desembolsos. (rede)');
    expect(resultado.paraModelo).toBeUndefined();
  });

  it('M15 no modo multi-centro: campo malformado de um centro não derruba a resposta', async () => {
    const { sessao } = montar({
      get_repasses_v2: (args) => {
        const repasses = fixture('repasses');
        if (args.p_project_id === ID_903) repasses.recursos.rendimento_bruto = {};
        return { data: repasses, error: null };
      },
    });
    const dados = json(await sessao.executar('desembolsos', {}));
    const tres = centroPorCodigo(dados, '30.903');
    expect(tres.erro).toBeUndefined();
    expect(tres.recursos.rendimento_bruto).toBeNull();
    expect(tres.recursos.a_receber).toMatch(/^r\d+\.\d+$/);
  });
});

describe('A10 — termos_contrato sem project_id', () => {
  it('consulta todos os centros visíveis e devolve termos e vigência por centro', async () => {
    const { sessao, chamadas } = montar();
    const dados = json(await sessao.executar('termos_contrato', {}));

    expect(chamadas.filter((chamada) => chamada.nome === 'get_termos_contrato_v2')).toHaveLength(
      3
    );
    expect(dados.centros).toHaveLength(3);
    const um = centroPorCodigo(dados, '30.901');
    expect(um.erro).toBeUndefined();
    expect(Object.keys(um.termos).sort()).toEqual([
      'taxa_total',
      'vigencia_fim',
      'vigencia_inicio',
    ]);
    const taxa = dados.nos.find((no) => no.id === um.termos.taxa_total);
    expect(taxa.valor).toBe(9.75);
    expect(taxa.unidade).toBe('percentual');
    expect(taxa.rotulo).toBe('Taxa total — 30.901');
    expect(um.cadastro.inicio).toMatch(/^r\d+\.\d+$/);
  });

  it('com project_id mantém o formato de um centro', async () => {
    const { sessao, chamadas } = montar();
    const dados = json(await sessao.executar('termos_contrato', { project_id: '30.901' }));
    expect(chamadas.filter((chamada) => chamada.nome === 'get_termos_contrato_v2')).toHaveLength(
      1
    );
    expect(dados.centros).toBeUndefined();
    expect(dados.nos.find((no) => no.rotulo === 'Taxa total').valor).toBe(9.75);
  });

  it('falha de um centro fica registrada nele, sem virar zero', async () => {
    const { sessao } = montar({
      get_termos_contrato_v2: (args) => {
        if (args.p_project_id === ID_903) {
          return { data: null, error: { status: 400 } };
        }
        return { data: fixture('termos_contrato'), error: null };
      },
    });
    const dados = json(await sessao.executar('termos_contrato', {}));
    const falho = centroPorCodigo(dados, '30.903');
    expect(falho.erro).toBe('Não foi possível carregar os termos do contrato. (http_4xx)');
    expect(falho.termos).toBeUndefined();
    expect(dados.centros.filter((centro) => centro.termos)).toHaveLength(2);
  });

  it('se todos os centros falharem, devolve { erro }', async () => {
    const { sessao } = montar({
      get_termos_contrato_v2: { data: null, error: { status: 400 } },
    });
    const resultado = await sessao.executar('termos_contrato', {});
    expect(resultado.erro).toBe('Não foi possível carregar os termos do contrato. (http_4xx)');
    expect(resultado.paraModelo).toBeUndefined();
  });
});

describe('M4 — corte de bolsas acima do teto', () => {
  it('corta a lista acima de 55.000 caracteres com aviso explícito e nós usados', async () => {
    const pedido = pedidoMuitoGrande();
    const { sessao } = montar({ get_pedido_bolsas_v2: { data: pedido, error: null } });
    const resultado = await sessao.executar('bolsas', {});
    expect(resultado.erro).toBeUndefined();
    expect(resultado.paraModelo.length).toBeLessThanOrEqual(55_000);

    const dados = JSON.parse(resultado.paraModelo);
    expect(dados.parcial).toBe(true);
    expect(dados.bolsistas_total).toBe(240);
    expect(dados.bolsistas_retornados).toBe(dados.bolsistas.length);
    expect(dados.bolsistas_retornados).toBeGreaterThan(0);
    expect(dados.bolsistas_retornados).toBeLessThan(240);
    expect(dados.aviso_corte).toBe(
      'Resultado cortado para caber no limite; filtre por project_id para ver todas as bolsas de um centro.'
    );

    const usados = idsUsados({
      total: dados.total,
      bolsistas: dados.bolsistas,
      caixas: dados.caixas,
    });
    for (const no of dados.nos) {
      expect(usados.has(no.id), `nó ${no.id} não citado pelos itens mantidos`).toBe(true);
    }
  });

  it('o corte é por prefixo e determinístico', async () => {
    const pedido = pedidoMuitoGrande();
    const primeira = await montar({
      get_pedido_bolsas_v2: { data: pedido, error: null },
    }).sessao.executar('bolsas', {});
    const segunda = await montar({
      get_pedido_bolsas_v2: { data: pedido, error: null },
    }).sessao.executar('bolsas', {});
    expect(segunda.paraModelo).toBe(primeira.paraModelo);
  });

  it('abaixo do teto não mexe na resposta (sem parcial nem aviso)', async () => {
    const { sessao } = montar();
    const dados = json(await sessao.executar('bolsas', { project_id: '30.901' }));
    expect(dados.parcial).toBeUndefined();
    expect(dados.bolsistas_retornados).toBeUndefined();
    expect(dados.bolsistas_total).toBeUndefined();
    expect(dados.aviso_corte).toBeUndefined();
  });
});

describe('M9 — falha de cálculo da situação', () => {
  it.each([
    [
      'situação sem dado',
      { situacao: 'sem dado', motivos: [] },
    ],
    [
      'motivo falha',
      {
        situacao: 'atenção',
        motivos: [
          {
            codigo: 'falha',
            nivel: 'info',
            texto: 'Não foi possível calcular o saldo.',
            grupo_code: null,
            valor: null,
          },
        ],
      },
    ],
  ])('%s devolve erro de cálculo, não (formato)', async (_, dados) => {
    const { sessao } = montar({ situacao_centro_v2: { data: dados, error: null } });
    const resultado = await sessao.executar('situacao_centro', { project_id: '30.901' });
    expect(resultado.erro).toBe('Não foi possível calcular a situação do centro.');
    expect(resultado.erro).not.toContain('(formato)');
    expect(resultado.paraModelo).toBeUndefined();
  });
});

describe('M14 — situação da bolsa em pt-BR', () => {
  it.each([
    ['active', 'ativa'],
    ['ended', 'encerrada'],
    ['cancelled', 'cancelada'],
    ['pending', 'pendente'],
    ['suspensa', 'suspensa'],
  ])('%s vira %s no nó de situação', async (status, esperado) => {
    const pedido = fixture('pedido_bolsas');
    pedido.bolsistas[0].bolsas[0].status = status;
    pedido.bolsistas[0].bolsas[0].vigente_hoje = status === 'active';
    const { sessao } = montar({ get_pedido_bolsas_v2: { data: pedido, error: null } });
    const resultado = await sessao.executar('bolsas', {
      project_id: '30.901',
      incluir_encerradas: true,
    });
    const dados = json(resultado);
    const bolsa = dados.bolsistas[0].bolsas[0];
    const no = dados.nos.find((item) => item.id === bolsa.status);
    expect(no.valor).toBe(esperado);
  });
});
