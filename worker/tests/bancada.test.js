import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { carregarRetrato, prepararRetrato } from '../bancada/retrato.mjs';
import { criarRoteador } from '../bancada/roteador.mjs';
import { executarPergunta } from '../bancada/executor.mjs';
import { verificar } from '../bancada/bateria.mjs';
import { carregarRoteiro } from '../bancada/modelo.mjs';
import { formatarRelatorio } from '../bancada/relatorio.mjs';
import { lerEventos } from '../bancada/sse.mjs';

const RETRATO = fileURLToPath(new URL('../bancada/exemplo/retrato.json', import.meta.url));
const ROTEIRO = fileURLToPath(new URL('../bancada/exemplo/roteiro.json', import.meta.url));
const PERGUNTAS = fileURLToPath(new URL('../bancada/exemplo/perguntas.json', import.meta.url));

const AUTH = {
  Authorization: 'Bearer bancada-admin',
  'Content-Type': 'application/json',
};

const ID_901 = '11111111-1111-4111-8111-111111111901';
const ID_902 = '11111111-1111-4111-8111-111111111902';

function semRede() {
  const fn = async () => {
    throw new Error('o teste não pode chamar a rede');
  };
  fn.chamadas = [];
  return fn;
}

async function chamarRpc(roteador, nome, args = {}, headers = AUTH) {
  const resposta = await roteador.fetch(`https://bancada.invalid/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });
  return { status: resposta.status, corpo: await resposta.json() };
}

let retrato;
let respostas;
let perguntas;

beforeAll(async () => {
  retrato = await carregarRetrato(RETRATO);
  respostas = await carregarRoteiro(ROTEIRO);
  perguntas = JSON.parse(await readFile(PERGUNTAS, 'utf8'));
});

describe('roteador da bancada', () => {
  it('recusa qualquer endereço fora da lista', async () => {
    const roteador = criarRoteador({
      retrato,
      modo: 'roteiro',
      respostasRoteiro: [],
      fetchOriginal: semRede(),
    });

    await expect(roteador.fetch('https://exemplo.invalid/api', {})).rejects.toThrow(
      'bancada: rede fora da lista',
    );
    await expect(roteador.fetch('https://ollama.com/outro', {})).rejects.toThrow(
      'bancada: rede fora da lista',
    );
  });

  it('transforma o retrato nas respostas certas de cada RPC', async () => {
    const roteador = criarRoteador({
      retrato,
      modo: 'roteiro',
      respostasRoteiro: [],
      fetchOriginal: semRede(),
    });

    const resumo = await chamarRpc(roteador, 'resumo_projetos_v2');
    expect(resumo.status).toBe(200);
    expect(resumo.corpo.centros).toHaveLength(3);
    expect(resumo.corpo.centros[0].code).toBe('30.901');

    const situacao = await chamarRpc(roteador, 'situacao_centro_v2', { p_project_id: ID_901 });
    expect(situacao.status).toBe(200);
    expect(situacao.corpo.situacao).toBe('em dia');

    const arvore = await chamarRpc(roteador, 'explicar_livre_v2', { p_project_id: ID_901 });
    expect(arvore.status).toBe(200);
    expect(arvore.corpo.valor).toBe(120000.5);

    const desembolsos = await chamarRpc(roteador, 'get_repasses_v2', { p_project_id: ID_901 });
    expect(desembolsos.status).toBe(200);
    expect(desembolsos.corpo.parcelas).toHaveLength(2);

    const termos = await chamarRpc(roteador, 'get_termos_contrato_v2', { p_project_id: ID_901 });
    expect(termos.status).toBe(200);
    expect(termos.corpo.termos.taxa_cip_ufg.valor).toBe(4.5);

    const pendencias = await chamarRpc(roteador, 'listar_pendencias_v2', {
      p_project_id: ID_902,
    });
    expect(pendencias.status).toBe(200);
    expect(pendencias.corpo).toHaveLength(1);

    const todas = await chamarRpc(roteador, 'listar_pendencias_v2', { p_project_id: null });
    expect(todas.status).toBe(200);
    expect(todas.corpo).toHaveLength(1);

    const bolsas = await chamarRpc(roteador, 'get_pedido_bolsas_v2');
    expect(bolsas.status).toBe(200);
    expect(bolsas.corpo.bolsistas).toHaveLength(3);
    expect(bolsas.corpo.bolsistas[0]).toMatchObject({
      nome: 'Bolsista Bancada 001',
      holder_id: 'bancada-p1',
    });
  });

  it('devolve 404 de PostgREST para RPC fora do retrato', async () => {
    const roteador = criarRoteador({
      retrato,
      modo: 'roteiro',
      respostasRoteiro: [],
      fetchOriginal: semRede(),
    });

    const resposta = await chamarRpc(roteador, 'rpc_que_nao_existe_v2');
    expect(resposta.status).toBe(404);
    expect(resposta.corpo.code).toBe('PGRST202');
  });

  it('recusa token fora do cenário', async () => {
    const roteador = criarRoteador({
      retrato,
      modo: 'roteiro',
      respostasRoteiro: [],
      fetchOriginal: semRede(),
    });

    const resposta = await chamarRpc(roteador, 'resumo_projetos_v2', {}, {
      Authorization: 'Bearer outro-token',
    });
    expect(resposta.status).toBe(401);
  });

  it('professor só vê os centros do cenário e leva Acesso negado fora deles', async () => {
    const roteador = criarRoteador({
      retrato,
      cenario: { papel: 'professor', centros_visiveis: ['30.901'] },
      modo: 'roteiro',
      respostasRoteiro: [],
      fetchOriginal: semRede(),
    });
    const authProfessor = {
      Authorization: 'Bearer bancada-professor',
      'Content-Type': 'application/json',
    };

    const resumo = await chamarRpc(roteador, 'resumo_projetos_v2', {}, authProfessor);
    expect(resumo.corpo.centros).toHaveLength(1);
    expect(resumo.corpo.centros[0].code).toBe('30.901');

    const bolsas = await chamarRpc(roteador, 'get_pedido_bolsas_v2', {}, authProfessor);
    expect(bolsas.corpo.bolsistas).toHaveLength(1);
    expect(bolsas.corpo.bolsistas[0].bolsas[0].code).toBe('30.901');

    const fora = await chamarRpc(
      roteador,
      'situacao_centro_v2',
      { p_project_id: ID_902 },
      authProfessor,
    );
    expect(fora.status).toBe(400);
    expect(fora.corpo.code).toBe('P0001');
    expect(fora.corpo.message).toBe('Acesso negado');
  });
});

describe('retrato', () => {
  it('troca o [nome] da folha de bolsa pelo nome sintético da scholarship', () => {
    const preparado = prepararRetrato({
      resumo: {
        centros: [
          {
            id: 'centro-999',
            code: '30.999',
            name: 'Centro Exemplo',
            situacao: 'em dia',
            livre: 1000,
            motivos: [],
            end_date: null,
            data_referencia: null,
            pendencias_abertas: 0,
          },
        ],
      },
      centros: {
        '30.999': {
          situacao: { situacao: 'em dia', motivos: [] },
          arvore: {
            rotulo: 'Livre',
            tipo: 'calculo',
            chave: 'livre',
            conta: null,
            sinal: 1,
            valor: 1000,
            motivo: null,
            ref: null,
            nota: null,
            partes: [
              {
                rotulo: '[nome] — 5 meses × R$ 1.000,00',
                tipo: 'digitado',
                chave: 'linha:bolsa-1',
                conta: null,
                sinal: 1,
                valor: 1000,
                motivo: null,
                ref: {
                  campo: 'amount',
                  alvo_id: 'bolsa-1',
                  alvo_tabela: 'scholarships',
                },
                nota: null,
                partes: [],
              },
            ],
          },
          desembolsos: {
            parcelas: [],
            recursos: null,
            data_balancete: null,
            valor_total_plano: null,
          },
          termos: {
            termos: {},
            vigencia_situacao: 'confere',
            start_date_cadastro: null,
            end_date_cadastro: null,
          },
          pendencias: [],
        },
      },
      bolsas: [
        {
          pessoa: 'P1',
          equipe: null,
          valor_vigente: 1000,
          bolsas: [
            {
              project_id: 'centro-999',
              code: '30.999',
              valor: 1000,
              inicio: '2026-01-01',
              fim: '2026-12-31',
              status: 'active',
              vigente_hoje: true,
              scholarship_id: 'bolsa-1',
            },
          ],
        },
      ],
    });

    expect(preparado.nomesSinteticos).toEqual(['Bolsista Bancada 001']);
    expect(preparado.centros['30.999'].arvore.partes[0].rotulo).toContain(
      'Bolsista Bancada 001',
    );
    expect(preparado.centros['30.999'].arvore.partes[0].rotulo).not.toContain('[nome]');
  });
});

describe('pergunta de ponta a ponta (modo roteiro)', () => {
  it('passa com um bloco válido e confere o número esperado', async () => {
    const resultado = await executarPergunta({
      definicao: perguntas[0],
      retrato,
      modo: 'roteiro',
      respostasRoteiro: respostas.slice(0, 3),
      fetchOriginal: semRede(),
    });

    expect(resultado.ok).toBe(true);
    expect(resultado.motivos).toEqual([]);
    expect(resultado.rodadas).toBe(3);
    expect(resultado.chamadasModelo).toBe(3);
    expect(resultado.blocos).toHaveLength(1);
    expect(resultado.blocos[0].numero.valor).toBe(120000.5);
    expect(resultado.textoFinal).toBe('O saldo livre está no bloco acima.');
  });

  it('pega nome sintético escrito pelo roteiro no pedido seguinte ao modelo', async () => {
    const roteiroComNome = [
      {
        message: {
          role: 'assistant',
          content: 'Vou consultar Bolsista Bancada 001.',
          tool_calls: [
            { function: { name: 'listar_centros', arguments: {} } },
          ],
        },
      },
      {
        message: {
          role: 'assistant',
          content: 'Pronto.',
        },
      },
    ];

    const resultado = await executarPergunta({
      definicao: { id: 'vazamento', pergunta: 'Quem é o bolsista?', espera: {} },
      retrato,
      modo: 'roteiro',
      respostasRoteiro: roteiroComNome,
      fetchOriginal: semRede(),
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.motivos.some((motivo) => motivo.includes('vazamento'))).toBe(true);
  });

  it('aceita o cenário de professor (o papel do cenário vira ANALISE_PAPEIS)', async () => {
    const resultado = await executarPergunta({
      definicao: {
        id: 'professor',
        pergunta: 'Quais centros eu vejo?',
        cenario: { papel: 'professor', centros_visiveis: ['30.901'] },
        espera: { texto_contem: 'centro' },
      },
      retrato,
      modo: 'roteiro',
      respostasRoteiro: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ function: { name: 'listar_centros', arguments: {} } }],
          },
        },
        {
          message: {
            role: 'assistant',
            content: 'Só o centro do seu acesso está na lista.',
          },
        },
      ],
      fetchOriginal: semRede(),
    });

    expect(resultado.ok).toBe(true);
    expect(resultado.motivos).toEqual([]);
  });

  it('registra a RPC configurada para falhar como falha de ferramenta no relatório', async () => {
    const resultado = await executarPergunta({
      definicao: {
        id: 20,
        pergunta: 'Qual o saldo livre do centro?',
        cenario: { rpc: { resumo_projetos_v2: { status: 500, message: 'fora do ar' } } },
        espera: {},
      },
      retrato,
      modo: 'roteiro',
      respostasRoteiro: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ function: { name: 'listar_centros', arguments: {} } }],
          },
        },
        {
          message: {
            role: 'assistant',
            content: 'A consulta aos centros não respondeu.',
          },
        },
      ],
      fetchOriginal: semRede(),
    });

    expect(resultado.ok).toBe(true);
    expect(resultado.falhas).toHaveLength(1);
    expect(resultado.falhas[0].ferramenta).toBe('listar_centros');
    expect(resultado.falhas[0].erro).toContain('Não foi possível carregar os centros');

    const relatorio = formatarRelatorio({
      resultados: [resultado],
      meta: { data: 'teste', modo: 'roteiro', modelo: 'modelo-teste', retrato: 'exemplo' },
    });
    expect(relatorio).toContain('Falhas de ferramenta');
    expect(relatorio).toContain('listar_centros');
    expect(relatorio).toContain('passou (1 falha(s) de ferramenta)');
  });
});

describe('checagens sempre feitas', () => {
  const blocoValido = {
    id: 'b1',
    tipo: 'numero',
    titulo: 'Livre',
    numero: {
      valor: 10,
      unidade: 'moeda',
      rotulo: 'Livre',
      origem: { tipo: 'sem_documento', motivo: 'teste', consulta: 'teste' },
      contexto: null,
    },
  };

  it('falta de "fim" falha', () => {
    const resultado = verificar(
      [{ evento: 'texto', dados: { texto: 'ok', semOrigem: [] } }],
      {},
      {},
    );
    expect(resultado.ok).toBe(false);
    expect(resultado.motivos.some((motivo) => motivo.includes('exatamente um "fim"'))).toBe(true);
  });

  it('número esperado ausente falha', () => {
    const resultado = verificar(
      [
        { evento: 'bloco', dados: blocoValido },
        { evento: 'texto', dados: { texto: 'ok', semOrigem: [] } },
        { evento: 'fim', dados: { rodadas: 1 } },
      ],
      { numeros: [20] },
      {},
    );
    expect(resultado.ok).toBe(false);
    expect(resultado.motivos.some((motivo) => motivo.includes('número esperado ausente'))).toBe(
      true,
    );
  });

  it('bloco numérico sem origem falha', () => {
    const semOrigem = JSON.parse(JSON.stringify(blocoValido));
    delete semOrigem.numero.origem;
    const resultado = verificar(
      [
        { evento: 'bloco', dados: semOrigem },
        { evento: 'texto', dados: { texto: 'ok', semOrigem: [] } },
        { evento: 'fim', dados: { rodadas: 1 } },
      ],
      {},
      {},
    );
    expect(resultado.ok).toBe(false);
    expect(resultado.motivos.some((motivo) => motivo.includes('sem origem'))).toBe(true);
  });

  it('texto final com número sem origem falha', () => {
    const resultado = verificar(
      [
        { evento: 'texto', dados: { texto: 'São 42.', semOrigem: [{ inicio: 4, fim: 6 }] } },
        { evento: 'fim', dados: { rodadas: 1 } },
      ],
      {},
      {},
    );
    expect(resultado.ok).toBe(false);
    expect(resultado.motivos.some((motivo) => motivo.includes('sem origem'))).toBe(true);
  });
});

describe('leitor de SSE', () => {
  it('junta pedaços cortados no meio de um evento', async () => {
    const codificador = new TextEncoder();
    const partes = [
      'event: passo\ndata: {"ferramenta":"x"',
      '}\n\nevent: fim\ndata: {"rodadas":1}\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const parte of partes) controller.enqueue(codificador.encode(parte));
        controller.close();
      },
    });

    const eventos = await lerEventos(stream, { inicio: 0, agora: () => 5 });
    expect(eventos).toHaveLength(2);
    expect(eventos[0]).toMatchObject({
      evento: 'passo',
      dados: { ferramenta: 'x' },
      ms: 5,
    });
    expect(eventos[1].evento).toBe('fim');
  });
});
