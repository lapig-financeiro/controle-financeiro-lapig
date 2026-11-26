// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { explicarLivreMock, origemMock, termosContratoMock, arquivoDeOrigemMock } = vi.hoisted(
  () => ({
    explicarLivreMock: vi.fn(),
    origemMock: vi.fn(),
    termosContratoMock: vi.fn(),
    arquivoDeOrigemMock: vi.fn(),
  })
);

vi.mock('../src/servicos/dados.js', () => ({
  explicarLivre: explicarLivreMock,
  origem: origemMock,
  termosContrato: termosContratoMock,
  arquivoDeOrigem: arquivoDeOrigemMock,
}));

vi.mock('../src/servicos/supabase.js', () => ({
  SUPABASE_URL: 'https://exemplo.supabase.co',
  SUPABASE_KEY: 'chave-publica',
  supabase: {
    auth: { getSession: vi.fn() },
    rpc: vi.fn(),
  },
}));

import { Analise } from '../src/paginas/Analise.jsx';

const AGORA = new Date('2026-11-26T15:00:00-03:00');
const CONV_A = '00000000-0000-4000-8000-000000000a01';
const CONV_B = '00000000-0000-4000-8000-000000000a02';
const CONV_ANTIGA = '00000000-0000-4000-8000-000000000a03';
const CONV_NOVA = '00000000-0000-4000-8000-000000000a09';
const REG_1 = '00000000-0000-4000-8000-000000000b01';
const REG_2 = '00000000-0000-4000-8000-000000000b02';
const REG_3 = '00000000-0000-4000-8000-000000000b03';
const REG_4 = '00000000-0000-4000-8000-000000000b04';
const REG_5 = '00000000-0000-4000-8000-000000000b05';

const tick = () => new Promise((resolver) => setTimeout(resolver, 20));
const semNbsp = (texto) => String(texto || '').replace(/\u00a0/g, ' ');

async function esperarPor(condicao, tentativas = 150) {
  for (let i = 0; i < tentativas; i += 1) {
    const valor = condicao();
    if (valor) return valor;
    await tick();
  }
  return condicao();
}

function encontrarBotao(texto, escopo = document) {
  return Array.from(escopo.querySelectorAll('button')).find(
    (botao) => botao.textContent.trim() === texto
  );
}

async function digitar(texto) {
  const campo = document.querySelector('.analise__campo');
  expect(campo).not.toBeNull();
  campo.value = texto;
  campo.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  return campo;
}

async function enviarPergunta(texto) {
  await digitar(texto);
  const botao = encontrarBotao('Perguntar');
  expect(botao).toBeTruthy();
  botao.click();
  await tick();
}

function meta({ id, titulo, atualizada_em, turnos = 1 }) {
  return {
    id,
    titulo,
    criada_em: atualizada_em,
    atualizada_em,
    turnos,
  };
}

function turnoCarregado({
  registro,
  ordem,
  pergunta,
  texto,
  blocos = [],
  terminadaEm = '2026-11-26T14:32:00-03:00',
  calculado = 'ok',
  desfecho = 'ok',
}) {
  return {
    registro,
    ordem,
    pergunta,
    resposta: {
      texto: { texto, semOrigem: [] },
      blocos,
    },
    desfecho,
    desfecho_calculado: calculado,
    iniciada_em: terminadaEm,
    terminada_em: terminadaEm,
    rodadas: 2,
    ms: 1500,
    feedback: null,
  };
}

function conversa({ id, titulo, atualizada_em, turnos }) {
  return { id, titulo, criada_em: atualizada_em, atualizada_em, turnos };
}

function renderizar(props = {}) {
  render(
    <Analise
      executarAnalise={vi.fn()}
      enviarFeedback={vi.fn().mockResolvedValue({ id: 'f1', erro: null })}
      carregarExplicacao={explicarLivreMock}
      consultarOrigem={origemMock}
      carregarTermos={termosContratoMock}
      listarConversas={vi.fn().mockResolvedValue({ dados: [], erro: null })}
      lerConversa={vi.fn().mockResolvedValue({ dados: null, erro: 'não usada' })}
      renomearConversa={vi.fn().mockResolvedValue({ dados: null, erro: null })}
      excluirConversa={vi.fn().mockResolvedValue({ dados: null, erro: null })}
      agora={() => AGORA}
      {...props}
    />,
    document.body
  );
}

function limpar() {
  render(null, document.body);
  document.body.innerHTML = '';
}

beforeEach(() => {
  explicarLivreMock.mockReset();
  origemMock.mockReset();
  termosContratoMock.mockReset();
  arquivoDeOrigemMock.mockReset();
  explicarLivreMock.mockResolvedValue({
    dados: { rotulo: 'Livre raiz', valor: 100, tipo: 'calculo', chave: 'livre', partes: [] },
    erro: null,
  });
  origemMock.mockResolvedValue({ dados: null, erro: 'Documento indisponível no teste.' });
  termosContratoMock.mockResolvedValue({ dados: { termos: {} }, erro: null });
  arquivoDeOrigemMock.mockResolvedValue({ dados: null, erro: 'Arquivo indisponível no teste.' });
});

afterEach(() => {
  limpar();
});

describe('lista de conversas', () => {
  it('lista ok mostra título e quando, e a conversa de hoje abre com o turno respondido', async () => {
    const hoje = '2026-11-26T14:32:00-03:00';
    const listar = vi.fn().mockResolvedValue({
      dados: [
        meta({ id: CONV_A, titulo: 'Saldo do 30.910', atualizada_em: hoje, turnos: 1 }),
        meta({
          id: CONV_B,
          titulo: 'Bolsas do 30.901',
          atualizada_em: '2026-11-25T09:15:00-03:00',
        }),
        meta({
          id: CONV_ANTIGA,
          titulo: 'Conversa antiga',
          atualizada_em: '2026-11-18T10:00:00-03:00',
        }),
      ],
      erro: null,
    });
    const ler = vi.fn().mockResolvedValue({
      dados: conversa({
        id: CONV_A,
        titulo: 'Saldo do 30.910',
        atualizada_em: hoje,
        turnos: [
          turnoCarregado({
            registro: REG_1,
            ordem: 1,
            pergunta: 'Quanto o 30.910 tem livre?',
            texto: 'O 30.910 tem R$ 52.000,00 livres.',
          }),
        ],
      }),
      erro: null,
    });

    renderizar({ listarConversas: listar, lerConversa: ler });

    await esperarPor(() => document.querySelectorAll('.lista-conversas__item').length === 3);
    const itens = Array.from(document.querySelectorAll('.lista-conversas__item'));
    expect(itens[0].textContent).toContain('Saldo do 30.910');
    expect(itens[0].textContent).toContain('hoje, 14h32');
    expect(itens[1].textContent).toContain('ontem');
    expect(itens[2].textContent).toContain('18/11');
    expect(itens[0].getAttribute('aria-current')).toBe('true');

    expect(ler).toHaveBeenCalledWith(CONV_A);
    await esperarPor(() => document.body.textContent.includes('Respondida em'));
    expect(document.body.textContent).toContain(
      'Respondida em 26/11/2026, às 14h32'
    );
    expect(document.body.textContent).toContain('O 30.910 tem R$ 52.000,00 livres.');
    expect(document.querySelector('.analise__passos')).toBeNull();
    expect(document.body.textContent).not.toContain('Esta resposta ajudou?');
  });

  it('falha na lista mostra o aviso com Tentar de novo e não vira lista vazia', async () => {
    const listar = vi
      .fn()
      .mockResolvedValueOnce({ dados: null, erro: 'Não foi possível carregar as conversas.' })
      .mockResolvedValueOnce({ dados: [], erro: null });
    renderizar({ listarConversas: listar });

    const aviso = await esperarPor(() => document.querySelector('.aviso-falha'));
    expect(aviso.textContent).toContain('Não foi possível carregar as conversas.');
    const tentar = encontrarBotao('Tentar de novo', aviso);
    expect(tentar).toBeTruthy();
    tentar.click();

    await esperarPor(() => !document.querySelector('.aviso-falha'));
    expect(document.body.textContent).toContain('Nenhuma conversa ainda.');
    expect(listar).toHaveBeenCalledTimes(2);
  });
});

describe('regra de abertura por dia de Brasília', () => {
  it('com a última conversa de hoje, abre essa conversa', async () => {
    const listar = vi.fn().mockResolvedValue({
      dados: [
        meta({
          id: CONV_A,
          titulo: 'Hoje',
          atualizada_em: '2026-11-26T08:00:00-03:00',
        }),
      ],
      erro: null,
    });
    const ler = vi.fn().mockResolvedValue({
      dados: conversa({
        id: CONV_A,
        titulo: 'Hoje',
        atualizada_em: '2026-11-26T08:00:00-03:00',
        turnos: [
          turnoCarregado({
            registro: REG_1,
            ordem: 1,
            pergunta: 'Pergunta de hoje',
            texto: 'Resposta de hoje.',
          }),
        ],
      }),
      erro: null,
    });
    renderizar({ listarConversas: listar, lerConversa: ler });

    await esperarPor(() => document.body.textContent.includes('Resposta de hoje.'));
    expect(ler).toHaveBeenCalledWith(CONV_A);
  });

  it('sem atividade hoje, abre uma conversa nova com «Continuar» para a anterior', async () => {
    const listar = vi.fn().mockResolvedValue({
      dados: [
        meta({
          id: CONV_B,
          titulo: 'Bolsas do 30.901',
          atualizada_em: '2026-11-25T09:15:00-03:00',
        }),
      ],
      erro: null,
    });
    const ler = vi.fn().mockResolvedValue({
      dados: conversa({
        id: CONV_B,
        titulo: 'Bolsas do 30.901',
        atualizada_em: '2026-11-25T09:15:00-03:00',
        turnos: [
          turnoCarregado({
            registro: REG_1,
            ordem: 1,
            pergunta: 'Quais bolsas terminam?',
            texto: 'Duas bolsas.',
            terminadaEm: '2026-11-25T09:15:00-03:00',
          }),
        ],
      }),
      erro: null,
    });
    renderizar({ listarConversas: listar, lerConversa: ler });

    const anterior = await esperarPor(() => document.querySelector('.analise__anterior'));
    expect(anterior.textContent).toContain('Sua última conversa foi em 25/11');
    expect(anterior.textContent).toContain('«Bolsas do 30.901»');
    expect(ler).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      'Faça a primeira pergunta para ver os números com a origem de cada um.'
    );

    const continuar = encontrarBotao('Continuar', anterior);
    expect(continuar).toBeTruthy();
    continuar.click();
    await esperarPor(() => document.body.textContent.includes('Duas bolsas.'));
    expect(ler).toHaveBeenCalledWith(CONV_B);
  });
});

describe('nova conversa e rascunhos', () => {
  it('a conversa nova recebe o id do inicio e vira item da lista', async () => {
    const listar = vi
      .fn()
      .mockResolvedValueOnce({ dados: [], erro: null })
      .mockResolvedValueOnce({
        dados: [
          meta({
            id: CONV_NOVA,
            titulo: 'Qual o saldo?',
            atualizada_em: '2026-11-26T15:00:00-03:00',
          }),
        ],
        erro: null,
      });
    const executar = vi.fn(async (opcoes) => {
      opcoes.onInicio?.({ registro: REG_1, conversa: CONV_NOVA, ordem: 1 });
      opcoes.onTexto?.({ texto: 'Resposta nova.', semOrigem: [] });
      opcoes.onFim?.({ rodadas: 1, ms: 1000 });
      return {
        ok: true,
        erro: null,
        registro: REG_1,
        conversa: CONV_NOVA,
        ordem: 1,
        blocos: [],
        texto: { texto: 'Resposta nova.', semOrigem: [] },
        fim: { rodadas: 1, ms: 1000 },
      };
    });
    const ler = vi.fn().mockResolvedValue({ dados: null, erro: 'não deveria ler' });

    renderizar({ listarConversas: listar, lerConversa: ler, executarAnalise: executar });

    await esperarPor(() => document.body.textContent.includes('Nenhuma conversa ainda.'));
    await enviarPergunta('Qual o saldo?');
    await esperarPor(() => document.body.textContent.includes('Resposta nova.'));
    expect(executar.mock.calls[0][0].conversa).toBeNull();

    await esperarPor(() =>
      Array.from(document.querySelectorAll('.lista-conversas__item')).some((item) =>
        item.textContent.includes('Qual o saldo?')
      )
    );
    expect(document.querySelector('.analise__titulo-conversa').textContent).toBe(
      'Qual o saldo?'
    );
    expect(listar).toHaveBeenCalledTimes(2);
    expect(ler).not.toHaveBeenCalled();

    encontrarBotao('Nova conversa').click();
    await tick();
    expect(document.querySelectorAll('.analise__cartao')).toHaveLength(0);
    await esperarPor(() =>
      Array.from(document.querySelectorAll('.lista-conversas__item')).some((item) =>
        item.textContent.includes('Qual o saldo?')
      )
    );
    const item = Array.from(document.querySelectorAll('.lista-conversas__item')).find(
      (botao) => botao.textContent.includes('Qual o saldo?')
    );
    item.click();
    await esperarPor(() => document.body.textContent.includes('Resposta nova.'));
    expect(ler).not.toHaveBeenCalled();
  });

  it('cada conversa tem o próprio rascunho em memória', async () => {
    const listar = vi.fn().mockResolvedValue({
      dados: [
        meta({
          id: CONV_A,
          titulo: 'Conversa A',
          atualizada_em: '2026-11-26T12:00:00-03:00',
        }),
        meta({
          id: CONV_B,
          titulo: 'Conversa B',
          atualizada_em: '2026-11-26T11:00:00-03:00',
        }),
      ],
      erro: null,
    });
    const ler = vi.fn(async (id) => ({
      dados: conversa({
        id,
        titulo: id === CONV_A ? 'Conversa A' : 'Conversa B',
        atualizada_em: '2026-11-26T12:00:00-03:00',
        turnos: [
          turnoCarregado({
            registro: id === CONV_A ? REG_1 : REG_2,
            ordem: 1,
            pergunta: id === CONV_A ? 'Pergunta A' : 'Pergunta B',
            texto: id === CONV_A ? 'Resposta A.' : 'Resposta B.',
          }),
        ],
      }),
      erro: null,
    }));

    renderizar({ listarConversas: listar, lerConversa: ler });
    await esperarPor(() => document.body.textContent.includes('Resposta A.'));

    await digitar('rascunho A');
    const itemB = Array.from(document.querySelectorAll('.lista-conversas__item')).find(
      (botao) => botao.textContent.includes('Conversa B')
    );
    itemB.click();
    await esperarPor(() => document.body.textContent.includes('Resposta B.'));
    expect(document.querySelector('.analise__campo').value).toBe('');

    await digitar('rascunho B');
    const itemA = Array.from(document.querySelectorAll('.lista-conversas__item')).find(
      (botao) => botao.textContent.includes('Conversa A')
    );
    itemA.click();
    await tick();
    expect(document.querySelector('.analise__campo').value).toBe('rascunho A');

    encontrarBotao('Nova conversa').click();
    await tick();
    expect(document.querySelector('.analise__campo').value).toBe('');
    await digitar('rascunho nova');
    itemB.click();
    await tick();
    expect(document.querySelector('.analise__campo').value).toBe('rascunho B');
    encontrarBotao('Nova conversa').click();
    await tick();
    expect(document.querySelector('.analise__campo').value).toBe('rascunho nova');
  });
});

describe('anteriores da conversa', () => {
  it('manda os 2 últimos turnos ok, sem os erros, com pergunta, resumo e blocos', async () => {
    const atualizada = '2026-11-26T14:32:00-03:00';
    const turnos = [
      turnoCarregado({
        registro: REG_1,
        ordem: 1,
        pergunta: 'Pergunta 1',
        texto: 'Resposta 1.',
        blocos: [
          {
            id: 'n1',
            tipo: 'numero',
            titulo: 'Livre',
            numero: { valor: 10, unidade: 'moeda', rotulo: 'Livre', origem: null },
          },
        ],
      }),
      turnoCarregado({
        registro: REG_2,
        ordem: 2,
        pergunta: 'Pergunta 2',
        texto: 'Resposta 2.',
        calculado: 'erro',
        desfecho: 'erro',
      }),
      turnoCarregado({
        registro: REG_3,
        ordem: 3,
        pergunta: 'Pergunta 3',
        texto: 'Resposta 3.',
        blocos: [
          {
            id: 'n3',
            tipo: 'numero',
            titulo: 'Livre do 30.910',
            numero: { valor: 30, unidade: 'moeda', rotulo: 'Livre', origem: null },
          },
        ],
      }),
      turnoCarregado({
        registro: REG_4,
        ordem: 4,
        pergunta: 'Pergunta 4',
        texto: 'Resposta 4.',
        blocos: [
          {
            id: 't4',
            tipo: 'tabela',
            titulo: 'Tabela',
            tabela: {
              colunas: [
                { rotulo: 'Centro', unidade: 'texto' },
                { rotulo: 'Livre (R$)', unidade: 'moeda' },
              ],
              linhas: [
                [
                  { valor: '30.109', unidade: 'texto', origem: null },
                  { valor: 10, unidade: 'moeda', origem: null },
                ],
              ],
            },
          },
        ],
      }),
    ];
    const listar = vi.fn().mockResolvedValue({
      dados: [meta({ id: CONV_A, titulo: 'Conversa A', atualizada_em: atualizada, turnos: 4 })],
      erro: null,
    });
    const ler = vi.fn().mockResolvedValue({
      dados: conversa({
        id: CONV_A,
        titulo: 'Conversa A',
        atualizada_em: atualizada,
        turnos,
      }),
      erro: null,
    });
    const executar = vi.fn(async (opcoes) => {
      opcoes.onInicio?.({ registro: REG_5, conversa: CONV_A, ordem: 5 });
      opcoes.onTexto?.({ texto: 'Resposta nova.', semOrigem: [] });
      opcoes.onFim?.({ rodadas: 1, ms: 500 });
      return {
        ok: true,
        erro: null,
        registro: REG_5,
        conversa: CONV_A,
        ordem: 5,
        blocos: [],
        texto: { texto: 'Resposta nova.', semOrigem: [] },
        fim: { rodadas: 1, ms: 500 },
      };
    });

    renderizar({ listarConversas: listar, lerConversa: ler, executarAnalise: executar });
    await esperarPor(() => document.body.textContent.includes('Resposta 4.'));
    await enviarPergunta('Pergunta nova');
    await esperarPor(() => executar.mock.calls.length === 1);

    const opcoes = executar.mock.calls[0][0];
    expect(opcoes.conversa).toBe(CONV_A);
    expect(opcoes.anteriores.map((item) => item.pergunta)).toEqual([
      'Pergunta 3',
      'Pergunta 4',
    ]);
    expect(opcoes.anteriores[0].resumo).toBe('Resposta 3.');
    expect(semNbsp(opcoes.anteriores[0].blocos)).toContain('Livre do 30.910: R$ 30,00');
    expect(semNbsp(opcoes.anteriores[1].blocos)).toContain(
      'Tabela — 30.109: Livre (R$): R$ 10,00'
    );
    expect(opcoes.anteriores[1].blocos.length).toBeLessThanOrEqual(600);
  });
});

describe('renomear e excluir', () => {
  const atualizada = '2026-11-26T14:32:00-03:00';
  function prepararConversa() {
    const listar = vi.fn().mockResolvedValue({
      dados: [meta({ id: CONV_A, titulo: 'Título antigo', atualizada_em: atualizada, turnos: 1 })],
      erro: null,
    });
    const ler = vi.fn().mockResolvedValue({
      dados: conversa({
        id: CONV_A,
        titulo: 'Título antigo',
        atualizada_em: atualizada,
        turnos: [
          turnoCarregado({
            registro: REG_1,
            ordem: 1,
            pergunta: 'Pergunta da conversa',
            texto: 'Resposta da conversa.',
          }),
        ],
      }),
      erro: null,
    });
    return { listar, ler };
  }

  it('renomeia pelo lápis, atualiza título, cabeçalho e lista; erro aparece no formulário', async () => {
    const { listar, ler } = prepararConversa();
    const renomear = vi.fn().mockResolvedValue({ dados: null, erro: null });
    renderizar({ listarConversas: listar, lerConversa: ler, renomearConversa: renomear });
    await esperarPor(() => document.body.textContent.includes('Resposta da conversa.'));

    encontrarBotao('Renomear').click();
    await tick();
    const campo = document.querySelector('.analise__titulo-campo');
    expect(campo).not.toBeNull();
    campo.value = '  Novo título  ';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    encontrarBotao('Salvar').click();
    await esperarPor(() => renomear.mock.calls.length === 1);
    expect(renomear).toHaveBeenCalledWith(CONV_A, 'Novo título');
    const titulo = await esperarPor(() =>
      document.querySelector('.analise__titulo-conversa')
    );
    expect(titulo.textContent).toBe('Novo título');
    expect(document.querySelector('.lista-conversas__item').textContent).toContain(
      'Novo título'
    );

    limpar();
    const falha = vi.fn().mockResolvedValue({ dados: null, erro: 'Título recusado pelo banco.' });
    renderizar({ listarConversas: listar, lerConversa: ler, renomearConversa: falha });
    await esperarPor(() => document.body.textContent.includes('Resposta da conversa.'));
    encontrarBotao('Renomear').click();
    await tick();
    const campoErro = document.querySelector('.analise__titulo-campo');
    campoErro.value = 'Outro título';
    campoErro.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    encontrarBotao('Salvar').click();
    const aviso = await esperarPor(() => document.querySelector('.analise__renomear .analise__nota--erro'));
    expect(aviso.getAttribute('role')).toBe('alert');
    expect(aviso.textContent).toContain('Título recusado pelo banco.');
    expect(document.querySelector('.analise__titulo-campo')).not.toBeNull();
  });

  it('excluir pede confirmação, cancelar mantém e confirmar volta para uma conversa nova', async () => {
    const { listar, ler } = prepararConversa();
    const excluir = vi.fn().mockResolvedValue({ dados: null, erro: null });
    renderizar({ listarConversas: listar, lerConversa: ler, excluirConversa: excluir });
    await esperarPor(() => document.body.textContent.includes('Resposta da conversa.'));

    encontrarBotao('Excluir').click();
    await tick();
    const bloco = document.querySelector('.analise__confirmar-exclusao');
    expect(bloco).not.toBeNull();
    expect(bloco.textContent).toContain('Excluir esta conversa? Não dá para desfazer.');

    encontrarBotao('Cancelar', bloco).click();
    await tick();
    expect(document.querySelector('.analise__confirmar-exclusao')).toBeNull();
    expect(excluir).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Resposta da conversa.');

    encontrarBotao('Excluir').click();
    await tick();
    const confirmado = document.querySelector('.analise__confirmar-exclusao');
    encontrarBotao('Excluir', confirmado).click();
    await esperarPor(() => excluir.mock.calls.length === 1);
    expect(excluir).toHaveBeenCalledWith(CONV_A);
    await esperarPor(() =>
      document.querySelector('.analise__titulo-conversa')?.textContent === 'Nova conversa'
    );
    expect(document.body.textContent).not.toContain('Resposta da conversa.');
    expect(document.querySelectorAll('.lista-conversas__item')).toHaveLength(0);
  });
});

describe('origem de turno antigo', () => {
  const atualizada = '2026-11-26T14:32:00-03:00';

  function preparar() {
    const blocoLivre = {
      id: 'numero-livre',
      tipo: 'numero',
      titulo: 'Livre antigo',
      numero: {
        valor: 100,
        unidade: 'moeda',
        rotulo: 'Livre',
        origem: { tipo: 'livre', project_id: 'projeto-1', chave: 'livre' },
      },
    };
    const blocoNo = {
      id: 'numero-no',
      tipo: 'numero',
      titulo: 'Nó antigo',
      numero: {
        valor: 50,
        unidade: 'moeda',
        rotulo: 'Nó',
        origem: {
          tipo: 'no',
          no: { rotulo: 'Nó guardado', valor: 50, tipo: 'legado', chave: 'no-1', partes: [] },
        },
      },
    };
    const blocoRef = {
      id: 'numero-ref',
      tipo: 'numero',
      titulo: 'Saldo antigo',
      numero: {
        valor: 10,
        unidade: 'moeda',
        rotulo: 'Saldo',
        origem: {
          tipo: 'ref',
          ref: {
            alvo_tabela: 'balancetes',
            alvo_id: 'alvo-1',
            campo: 'saldo_disponivel',
          },
          nome: 'Saldo do balancete',
        },
      },
    };
    const listar = vi.fn().mockResolvedValue({
      dados: [meta({ id: CONV_A, titulo: 'Antiga', atualizada_em: atualizada })],
      erro: null,
    });
    const ler = vi.fn().mockResolvedValue({
      dados: conversa({
        id: CONV_A,
        titulo: 'Antiga',
        atualizada_em: atualizada,
        turnos: [
          turnoCarregado({
            registro: REG_1,
            ordem: 1,
            pergunta: 'Pergunta antiga',
            texto: 'Resposta antiga.',
            blocos: [blocoLivre, blocoNo, blocoRef],
          }),
        ],
      }),
      erro: null,
    });
    return { listar, ler };
  }

  it('livre, ref e termo levam a nota de data; o tipo no abre como hoje', async () => {
    explicarLivreMock.mockResolvedValue({
      dados: {
        rotulo: 'Livre raiz',
        valor: 100,
        tipo: 'calculo',
        chave: 'livre',
        partes: [],
      },
      erro: null,
    });
    origemMock.mockResolvedValue({
      dados: {
        tipo: 'documento',
        valor: 10,
        documento: {
          id: 'doc-1',
          titulo: 'Balancete de teste',
          formato: 'pdf',
          bucket: 'teste',
          caminho: 'pasta/arquivo.pdf',
        },
        fato: null,
        busca: null,
        nota: '',
      },
      erro: null,
    });
    const { listar, ler } = preparar();
    renderizar({ listarConversas: listar, lerConversa: ler });
    await esperarPor(() => document.body.textContent.includes('Resposta antiga.'));

    const botoes = Array.from(document.querySelectorAll('.destaque button.valor--origem'));
    expect(botoes).toHaveLength(3);
    botoes[0].click();
    let painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.textContent).toContain(
      'Este valor é de 26/11/2026; a origem abaixo é a de hoje.'
    );
    expect(painel.textContent).toContain('Livre raiz');
    painel.querySelector('.painel-lateral__fechar').click();
    await esperarPor(() => !document.querySelector('.painel-lateral'));

    botoes[1].click();
    painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.textContent).toContain('Nó guardado');
    expect(painel.textContent).not.toContain('Este valor é de 26/11/2026');
    painel.querySelector('.painel-lateral__fechar').click();
    await esperarPor(() => !document.querySelector('.painel-lateral'));

    botoes[2].click();
    const documento = await esperarPor(() => document.querySelector('.documento'));
    expect(documento.textContent).toContain(
      'Este valor é de 26/11/2026; a origem abaixo é a de hoje.'
    );
    expect(documento.textContent).toContain('Balancete de teste');
  });
});

describe('salvar no histórico', () => {
  it('inicio com registro nulo mostra a nota discreta, sem feedback', async () => {
    const executar = vi.fn(async (opcoes) => {
      opcoes.onInicio?.({ registro: null, conversa: null, ordem: null });
      opcoes.onTexto?.({ texto: 'Resposta sem registro.', semOrigem: [] });
      opcoes.onFim?.({ rodadas: 1, ms: 1000 });
      return {
        ok: true,
        erro: null,
        registro: null,
        conversa: null,
        ordem: null,
        blocos: [],
        texto: { texto: 'Resposta sem registro.', semOrigem: [] },
        fim: { rodadas: 1, ms: 1000 },
      };
    });
    renderizar({ executarAnalise: executar });
    await esperarPor(() => document.body.textContent.includes('Nenhuma conversa ainda.'));
    await enviarPergunta('Pergunta sem registro');
    await esperarPor(() => document.body.textContent.includes('Resposta sem registro.'));

    const nota = document.querySelector('.analise__nao-salvo');
    expect(nota).not.toBeNull();
    expect(nota.textContent).toBe('Não foi possível salvar no histórico.');
    expect(document.body.textContent).not.toContain('Esta resposta ajudou?');
  });

  it('sem evento inicio (limite) não mostra a nota de histórico', async () => {
    const executar = vi.fn(async (opcoes) => {
      const erro = { codigo: 'limite', mensagem: 'Limite diário atingido.' };
      opcoes.onErro?.(erro);
      return {
        ok: false,
        erro,
        registro: null,
        conversa: null,
        ordem: null,
        blocos: [],
        texto: null,
      };
    });
    renderizar({ executarAnalise: executar });
    await esperarPor(() => document.body.textContent.includes('Nenhuma conversa ainda.'));
    await enviarPergunta('Pergunta no limite');
    await esperarPor(() => document.body.textContent.includes('Limite diário atingido.'));
    expect(document.querySelector('.analise__nao-salvo')).toBeNull();
  });
});

describe('análise em curso ao trocar de conversa', () => {
  it('o resultado fica na conversa de origem, mesmo com outra aberta', async () => {
    const listar = vi.fn().mockResolvedValue({
      dados: [
        meta({
          id: CONV_A,
          titulo: 'Conversa A',
          atualizada_em: '2026-11-26T13:00:00-03:00',
        }),
        meta({
          id: CONV_B,
          titulo: 'Conversa B',
          atualizada_em: '2026-11-26T12:00:00-03:00',
        }),
      ],
      erro: null,
    });
    const ler = vi.fn(async (id) => ({
      dados: conversa({
        id,
        titulo: id === CONV_A ? 'Conversa A' : 'Conversa B',
        atualizada_em: '2026-11-26T13:00:00-03:00',
        turnos: [
          turnoCarregado({
            registro: id === CONV_A ? REG_1 : REG_2,
            ordem: 1,
            pergunta: id === CONV_A ? 'Pergunta A' : 'Pergunta B',
            texto: id === CONV_A ? 'Resposta A.' : 'Resposta B.',
          }),
        ],
      }),
      erro: null,
    }));
    let resolver;
    let opcoes;
    const executar = vi.fn((dados) => {
      opcoes = dados;
      dados.onInicio?.({ registro: REG_3, conversa: CONV_A, ordem: 2 });
      return new Promise((resolve) => {
        resolver = () => {
          dados.onBloco?.({
            id: 'b-novo',
            tipo: 'numero',
            titulo: 'Livre novo',
            numero: { valor: 123, unidade: 'moeda', rotulo: 'Livre', origem: null },
          });
          dados.onTexto?.({ texto: 'Resposta na origem A.', semOrigem: [] });
          dados.onFim?.({ rodadas: 1, ms: 900 });
          resolve({
            ok: true,
            erro: null,
            registro: REG_3,
            conversa: CONV_A,
            ordem: 2,
            blocos: [
              {
                id: 'b-novo',
                tipo: 'numero',
                titulo: 'Livre novo',
                numero: { valor: 123, unidade: 'moeda', rotulo: 'Livre', origem: null },
              },
            ],
            texto: { texto: 'Resposta na origem A.', semOrigem: [] },
            fim: { rodadas: 1, ms: 900 },
          });
        };
      });
    });

    renderizar({ listarConversas: listar, lerConversa: ler, executarAnalise: executar });
    await esperarPor(() => document.body.textContent.includes('Resposta A.'));
    await enviarPergunta('Pergunta em A');

    const itemB = Array.from(document.querySelectorAll('.lista-conversas__item')).find(
      (botao) => botao.textContent.includes('Conversa B')
    );
    itemB.click();
    await esperarPor(() => document.body.textContent.includes('Resposta B.'));
    expect(document.body.textContent).not.toContain('Resposta na origem A.');

    resolver();
    await esperarPor(() => opcoes && document.querySelectorAll('.analise__cartao').length === 1);
    const itemA = Array.from(document.querySelectorAll('.lista-conversas__item')).find(
      (botao) => botao.textContent.includes('Conversa A')
    );
    itemA.click();
    await esperarPor(() => document.body.textContent.includes('Resposta na origem A.'));
    expect(document.querySelectorAll('.analise__cartao')).toHaveLength(2);
    expect(document.body.textContent).toContain('Livre novo');
  });
});
