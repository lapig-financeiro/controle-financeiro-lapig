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

  it('centro com erro de consulta é marcado como falhou, sem livre', async () => {
    const resumo = fixture('resumo_projetos');
    const alvo = resumo.centros.find((centro) => centro.code === '30.902');
    alvo.erro = 'falha_saldo_livre';
    alvo.livre = null;
    alvo.situacao = 'sem dado';
    alvo.motivos = [
      {
        codigo: 'falha',
        nivel: 'info',
        texto: 'Não foi possível calcular o saldo deste centro.',
        grupo_code: null,
        valor: null,
      },
    ];
    const sessao = montar({ resumo_projetos_v2: { data: resumo, error: null } });
    const dados = json(await sessao.executar('listar_centros', {}));
    const centro = dados.centros.find(
      (item) => dados.nos.find((no) => no.id === item.codigo).valor === '30.902'
    );
    expect(centro.falhou).toBe(true);
    expect(centro.livre).toBeNull();
    expect(dados.nos.find((no) => no.id === centro.falha).valor).toBe('consulta falhou');
    expect(dados.nos.some((no) => no.id === centro.livre)).toBe(false);
  });

  it('preserva valor e tarifa do motivo como campos distintos', async () => {
    const resumo = fixture('resumo_projetos');
    const alvo = resumo.centros.find((centro) => centro.code === '30.902');
    alvo.motivos = [
      {
        codigo: 'tarifa_bancaria',
        nivel: 'atenção',
        texto: 'Saldo de −50,00 por causa de 60,00 de tarifa bancária.',
        grupo_code: 'b',
        valor: 50,
        tarifa: 60,
      },
    ];
    const sessao = montar({ resumo_projetos_v2: { data: resumo, error: null } });
    const dados = json(await sessao.executar('listar_centros', {}));
    const centro = dados.centros.find(
      (item) => dados.nos.find((no) => no.id === item.codigo).valor === '30.902'
    );
    const motivo = centro.motivos[0];
    const valor = dados.nos.find((no) => no.id === motivo.valor);
    const tarifa = dados.nos.find((no) => no.id === motivo.tarifa);
    expect(valor.valor).toBe(50);
    expect(tarifa.valor).toBe(60);
    expect(valor.rotulo).toContain('Déficit');
    expect(tarifa.rotulo).toContain('Tarifa');
    const blocoValor = sessao.criarBloco({ tipo: 'numero', titulo: '', no: valor.id }).bloco;
    const blocoTarifa = sessao.criarBloco({ tipo: 'numero', titulo: '', no: tarifa.id }).bloco;
    expect(blocoValor.numero.origem.tipo).toBe('sem_documento');
    expect(blocoTarifa.numero.origem.tipo).toBe('sem_documento');
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

  it('acima de 200 nós usa origem livre com chave e ref direta da folha', async () => {
    const grande = {
      rotulo: 'Livre para gastar',
      valor: 1,
      tipo: 'calculo',
      chave: 'livre',
      sinal: 1,
      partes: Array.from({ length: 201 }, (_, indice) => ({
        rotulo: `Parte ${indice + 1}`,
        valor: 1,
        tipo: 'calculo',
        chave: `parte:${indice + 1}`,
        sinal: 1,
        partes: [],
        ...(indice === 1
          ? {
              ref: {
                alvo_tabela: 'plano_desembolsos',
                alvo_id: '00000000-0000-4000-8000-000000060201',
                campo: 'valor',
              },
            }
          : {}),
      })),
    };
    const sessao = montar({ explicar_livre_v2: { data: grande, error: null } });
    const dados = json(await sessao.executar('explicar_livre', { project_id: '30.901' }));
    const raiz = sessao.criarBloco({ tipo: 'numero', titulo: '', no: dados.raiz }).bloco;
    expect(raiz.numero.origem.tipo).toBe('livre');
    expect(raiz.numero.origem.project_id).toBe('00000000-0000-4000-8000-000000030901');
    expect(raiz.numero.origem.chave).toBe('livre');

    const parte1 = dados.nos.find((no) => no.rotulo === 'Parte 1');
    const parte2 = dados.nos.find((no) => no.rotulo === 'Parte 2');
    const bloco1 = sessao.criarBloco({ tipo: 'numero', titulo: '', no: parte1.id }).bloco;
    const bloco2 = sessao.criarBloco({ tipo: 'numero', titulo: '', no: parte2.id }).bloco;
    expect(bloco1.numero.origem).toMatchObject({ tipo: 'livre', chave: 'parte:1' });
    expect(bloco2.numero.origem.tipo).toBe('ref');
    expect(bloco2.numero.origem.ref).toEqual({
      alvo_tabela: 'plano_desembolsos',
      alvo_id: '00000000-0000-4000-8000-000000060201',
      campo: 'valor',
    });
  });

  it('recusa nó inválido na árvore', async () => {
    const sessao = montar({
      explicar_livre_v2: {
        data: {
          rotulo: 'Livre para gastar',
          valor: 1,
          tipo: 'calculo',
          sinal: 1,
          partes: [null],
        },
        error: null,
      },
    });
    const resultado = await sessao.executar('explicar_livre', { project_id: '30.901' });
    expect(resultado.erro).toBe('Não foi possível carregar a origem do saldo livre. (formato)');
  });
});

describe('situacao_centro', () => {
  it('preserva déficit e tarifa e liga o saldo do grupo pela chave', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('situacao_centro', { project_id: '30.901' }));

    const deficitFolha = acharNo(dados, 'Déficit (magnitude) — folha_atrasada');
    expect(deficitFolha.valor).toBe(8000);
    const blocoDeficit = sessao.criarBloco({ tipo: 'numero', titulo: '', no: deficitFolha.id }).bloco;
    expect(blocoDeficit.numero.origem.tipo).toBe('sem_documento');

    const saldoPessoal = acharNo(dados, 'Saldo do grupo — Pessoal');
    expect(saldoPessoal.valor).toBe(58200);
    const blocoSaldo = sessao.criarBloco({ tipo: 'numero', titulo: '', no: saldoPessoal.id }).bloco;
    expect(blocoSaldo.numero.origem.tipo).toBe('no');
    expect(blocoSaldo.numero.origem.no.chave).toBe('grupo:a');

    const deficitTarifa = acharNo(dados, 'Déficit (magnitude) — tarifa_bancaria');
    const tarifa = acharNo(dados, 'Tarifa bancária — tarifa_bancaria');
    expect(deficitTarifa.valor).toBe(14.34);
    expect(tarifa.valor).toBe(14.34);
    const blocoTarifa = sessao.criarBloco({ tipo: 'numero', titulo: '', no: tarifa.id }).bloco;
    expect(blocoTarifa.numero.origem.tipo).toBe('sem_documento');
  });

  it('motivo real de déficit e tarifa mantém magnitude, saldo assinado e tarifa', async () => {
    const arvore = fixture('explicar_livre');
    const grupoB = arvore.partes.find((parte) => parte.chave === 'grupo:b');
    grupoB.valor = -50;
    const sessao = montar({
      explicar_livre_v2: { data: arvore, error: null },
      situacao_centro_v2: {
        data: {
          situacao: 'atenção',
          motivos: [
            {
              codigo: 'tarifa_bancaria',
              nivel: 'atenção',
              texto: 'Saldo de −50,00 por causa de 60,00 de tarifa bancária.',
              grupo_code: 'b',
              valor: 50,
              tarifa: 60,
            },
          ],
        },
        error: null,
      },
    });
    const dados = json(await sessao.executar('situacao_centro', { project_id: '30.901' }));

    const deficit = acharNo(dados, 'Déficit (magnitude) — tarifa_bancaria');
    const saldo = acharNo(dados, 'Saldo do grupo — Serviços de terceiros (PJ)');
    const tarifa = acharNo(dados, 'Tarifa bancária — tarifa_bancaria');
    expect(deficit.valor).toBe(50);
    expect(saldo.valor).toBe(-50);
    expect(tarifa.valor).toBe(60);

    const blocoSaldo = sessao.criarBloco({ tipo: 'numero', titulo: '', no: saldo.id }).bloco;
    expect(blocoSaldo.numero.origem.tipo).toBe('no');
    expect(blocoSaldo.numero.origem.no.chave).toBe('grupo:b');
    expect(blocoSaldo.numero.origem.no.valor).toBe(-50);
  });

  it('sem árvore, avisa que a árvore faltou e deixa o valor sem_documento', async () => {
    const sessao = montar({
      explicar_livre_v2: { data: null, error: { message: 'árvore indisponível' } },
    });
    const dados = json(await sessao.executar('situacao_centro', { project_id: '30.901' }));
    expect(dados.arvore_indisponivel).toBe(true);
    const folha = acharNo(dados, 'Déficit (magnitude) — folha_atrasada');
    expect(folha.valor).toBe(8000);
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: folha.id }).bloco;
    expect(bloco.numero.origem.tipo).toBe('sem_documento');
  });

  it('árvore inválida na situação é erro, não clique inventado', async () => {
    const sessao = montar({
      explicar_livre_v2: {
        data: { rotulo: 'Livre', valor: 1, tipo: 'calculo', partes: [null] },
        error: null,
      },
    });
    const resultado = await sessao.executar('situacao_centro', { project_id: '30.901' });
    expect(resultado.erro).toBe('Não foi possível carregar a origem do saldo livre. (formato)');
    expect(resultado.paraModelo).toBeUndefined();
  });

  it('situação sem dado com motivo falha é erro explícito', async () => {
    const sessao = montar({
      situacao_centro_v2: {
        data: {
          situacao: 'sem dado',
          motivos: [
            { codigo: 'falha', nivel: 'info', texto: 'Não foi possível calcular o saldo.', grupo_code: null, valor: null },
          ],
        },
        error: null,
      },
    });
    const resultado = await sessao.executar('situacao_centro', { project_id: '30.901' });
    expect(resultado.erro).toBe('Não foi possível carregar a situação do centro. (formato)');
    expect(resultado.paraModelo).toBeUndefined();
  });
});

describe('desembolsos', () => {
  it('fiel à 063: parcela sem ref fica sem_documento', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('desembolsos', { project_id: '30.901' }));
    const parcela1 = acharNo(dados, 'Valor — parcela 1');
    const parcela2 = acharNo(dados, 'Valor — parcela 2');
    expect(parcela1.valor).toBe(250000);
    expect(parcela2.valor).toBe(350000);

    const bloco1 = sessao.criarBloco({ tipo: 'numero', titulo: '', no: parcela1.id }).bloco;
    const bloco2 = sessao.criarBloco({ tipo: 'numero', titulo: '', no: parcela2.id }).bloco;
    expect(bloco1.numero.origem.tipo).toBe('sem_documento');
    expect(bloco2.numero.origem.tipo).toBe('sem_documento');
  });

  it('com ref completa, a origem leva alvo_tabela, alvo_id e campo', async () => {
    const sessao = montar({
      get_repasses_v2: { data: fixture('repasses_ref'), error: null },
    });
    const dados = json(await sessao.executar('desembolsos', { project_id: '30.901' }));
    const parcela2 = acharNo(dados, 'Valor — parcela 2');
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: parcela2.id }).bloco;
    expect(bloco.numero.origem.tipo).toBe('ref');
    expect(bloco.numero.origem.ref).toEqual({
      alvo_tabela: 'plano_desembolsos',
      alvo_id: '00000000-0000-4000-8000-000000060201',
      campo: 'valor',
    });
    expect(bloco.numero.origem.nome).toBe('Parcela 2');
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

    const fim = acharNo(dados, 'Vigência — fim');
    const blocoContexto = sessao.criarBloco({
      tipo: 'numero',
      titulo: '',
      no: taxa.id,
      contexto: fim.id,
    }).bloco;
    expect(blocoContexto.numero.contexto.valor).toBe('2027-09-30');
    expect(blocoContexto.numero.contexto.origem.tipo).toBe('termo');
    expect(blocoContexto.numero.contexto.origem.termo_id).toBe('termo-30901-fim');
  });
});

describe('pendencias', () => {
  it('devolve pendências com origem sem_documento e descarta detalhe sensível/desconhecido', async () => {
    const sessao = montar();
    const resultado = await sessao.executar('pendencias', { project_id: '30.901' });
    const dados = json(resultado);
    expect(dados.pendencias).toHaveLength(2);
    const diferenca = acharNo(dados, 'Detalhe — diferenca');
    expect(diferenca.valor).toBe(-4250);
    const bloco = sessao.criarBloco({ tipo: 'numero', titulo: '', no: diferenca.id }).bloco;
    expect(bloco.numero.origem.tipo).toBe('sem_documento');

    expect(dados.nos.some((no) => no.valor === 12345678909)).toBe(false);
    expect(resultado.paraModelo).not.toContain('Pessoa Exemplo Fora');
    expect(resultado.paraModelo).not.toContain('12345678909');
    expect(resultado.paraModelo).not.toContain('98765432100');
    expect(resultado.paraModelo).not.toContain('pessoa.dois@exemplo.test');
    const detalhe = dados.pendencias[0].detalhe;
    expect(Object.keys(detalhe).sort()).toEqual(['competencia', 'conta', 'descricao', 'diferenca']);
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

  it('item nulo na lista é erro, não lista vazia', async () => {
    const sessao = montar({ listar_pendencias_v2: { data: [null], error: null } });
    const resultado = await sessao.executar('pendencias', { project_id: '30.901' });
    expect(resultado.erro).toBe('Não foi possível carregar as pendências. (formato)');
    expect(resultado.paraModelo).toBeUndefined();
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

  it('o filtro de visão vale também sem project_id, e o total global fica separado', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('bolsas', {}));
    expect(dados.bolsistas).toHaveLength(2);

    const pessoaUm = dados.bolsistas.find(
      (bolsista) => dados.nos.find((no) => no.id === bolsista.nome).valor === '⟦P1⟧'
    );
    expect(pessoaUm.bolsas).toHaveLength(1);
    const centro = dados.nos.find((no) => no.id === pessoaUm.bolsas[0].centro);
    expect(centro.valor).toBe('30.901');
    const vigente = dados.nos.find((no) => no.id === pessoaUm.valor_vigente);
    expect(vigente.valor).toBe(5000);
    expect(pessoaUm.total_global).toBeNull();

    const caixas = dados.caixas[0];
    const ocultos = dados.nos.find((no) => no.id === caixas.itens_ocultos);
    expect(ocultos.valor).toBe(2);
  });

  it('com centro filtrado, não chama o total global de valor do centro', async () => {
    const sessao = montar();
    const dados = json(await sessao.executar('bolsas', { project_id: '30.901' }));
    const pessoa = dados.bolsistas[0];
    expect(pessoa.valor_vigente).toBeNull();
    const total = dados.nos.find((no) => no.id === pessoa.total_global);
    expect(total.valor).toBe(5000);
    expect(total.rotulo).toContain('todos os centros');
    const centro = dados.nos.find((no) => no.id === pessoa.bolsas[0].centro);
    expect(centro.valor).toBe('30.901');
  });

  it('centro oculto não pode ser consultado', async () => {
    const sessao = montar();
    const resultado = await sessao.executar('bolsas', { project_id: '30.904' });
    expect(resultado.erro).toBe('Centro não encontrado no seu acesso.');
  });
});

describe('erro de RPC em cada ferramenta', () => {
  const MENSAGENS = {
    resumo_projetos_v2: 'Não foi possível carregar os centros.',
    explicar_livre_v2: 'Não foi possível carregar a origem do saldo livre.',
    situacao_centro_v2: 'Não foi possível carregar a situação do centro.',
    get_repasses_v2: 'Não foi possível carregar os desembolsos.',
    get_termos_contrato_v2: 'Não foi possível carregar os termos do contrato.',
    listar_pendencias_v2: 'Não foi possível carregar as pendências.',
    get_pedido_bolsas_v2: 'Não foi possível carregar o pedido de bolsas.',
  };
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
    it(`${ferramenta}: falha de ${rpc} vira erro fixo`, async () => {
      const sessao = montar({ [rpc]: { data: null, error: { message: `falha em ${rpc}` } } });
      const resultado = await sessao.executar(ferramenta, argumentos);
      expect(resultado.id).toMatch(/^r\d+$/);
      expect(resultado.erro).toBe(`${MENSAGENS[rpc]} (http_4xx)`);
      expect(resultado.erro).not.toContain('falha em');
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
