// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  explicarLivreMock,
  origemMock,
  termosContratoMock,
  arquivoDeOrigemMock,
} = vi.hoisted(() => ({
  explicarLivreMock: vi.fn(),
  origemMock: vi.fn(),
  termosContratoMock: vi.fn(),
  arquivoDeOrigemMock: vi.fn(),
}));

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
import { TITULO_SEM_ORIGEM } from '../src/componentes/BlocoAnalise.jsx';
import { executarAnaliseExemplo } from '../src/servicos/analiseExemplo.js';

const tick = () => new Promise((resolver) => setTimeout(resolver, 20));

async function esperarPor(condicao, tentativas = 120) {
  for (let i = 0; i < tentativas; i += 1) {
    const valor = condicao();
    if (valor) return valor;
    await tick();
  }
  return condicao();
}

const semNbsp = (texto) => String(texto || '').replace(/\u00a0/g, ' ');

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

async function esperarAnalises(quantidade) {
  await esperarPor(
    () =>
      document.querySelectorAll('.analise__cartao').length === quantidade &&
      !encontrarBotao('Parar')
  );
}

function criarBlocoNumero({
  valor = 100,
  unidade = 'moeda',
  rotulo = 'Livre',
  origem = null,
  contexto = null,
  id = `numero-${Math.random().toString(36).slice(2)}`,
  titulo = 'Número de teste',
} = {}) {
  return {
    id,
    tipo: 'numero',
    titulo,
    numero: { valor, unidade, rotulo, origem, contexto },
  };
}

function criarBlocoTabela({ id = 'tabela-teste', titulo = 'Tabela de teste', colunas, linhas }) {
  return { id, tipo: 'tabela', titulo, tabela: { colunas, linhas } };
}

function criarBlocoTexto({ id = 'texto-teste', titulo = 'Texto de teste', texto, semOrigem = [] }) {
  return { id, tipo: 'texto', titulo, texto: { texto, semOrigem } };
}

function criarExecucao({
  inicio = { registro: 'reg-1' },
  passos = [],
  blocos = [],
  texto = { texto: 'Resposta final de teste.', semOrigem: [] },
  fim = { rodadas: 4, ms: 12000 },
  erro = null,
  retorno = null,
} = {}) {
  return vi.fn(async (opcoes) => {
    if (inicio) opcoes.onInicio?.(inicio);
    for (const passo of passos) opcoes.onPasso?.(passo);
    for (const bloco of blocos) opcoes.onBloco?.(bloco);
    if (texto) opcoes.onTexto?.(texto);
    if (erro) opcoes.onErro?.(erro);
    if (fim) opcoes.onFim?.(fim);

    const base = {
      ok: !erro,
      erro: erro || null,
      registro: inicio?.registro ?? null,
      blocos,
      texto,
      ...(erro || !fim ? {} : { fim }),
    };
    return retorno ? { ...base, ...retorno } : base;
  });
}

function renderizar(executarAnalise, props = {}) {
  render(
    <Analise
      executarAnalise={executarAnalise}
      enviarFeedback={vi.fn().mockResolvedValue({ id: 'feedback-1', erro: null })}
      carregarExplicacao={explicarLivreMock}
      consultarOrigem={origemMock}
      carregarTermos={termosContratoMock}
      {...props}
    />,
    document.body
  );
}

beforeEach(() => {
  explicarLivreMock.mockReset();
  origemMock.mockReset();
  termosContratoMock.mockReset();
  arquivoDeOrigemMock.mockReset();
  arquivoDeOrigemMock.mockResolvedValue({
    dados: null,
    erro: 'Documento indisponível no teste.',
  });
});

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

describe('pergunta e envio', () => {
  it('vazia ou só espaços não envia; 2.001 desabilita; Enter não envia; Ctrl+Enter envia', async () => {
    const executarAnalise = criarExecucao();
    renderizar(executarAnalise);

    const botaoInicial = encontrarBotao('Perguntar');
    expect(botaoInicial.disabled).toBe(true);

    const campo = await digitar('   ');
    expect(encontrarBotao('Perguntar').disabled).toBe(true);
    campo.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await tick();
    expect(executarAnalise).not.toHaveBeenCalled();

    await digitar('a'.repeat(2001));
    expect(document.querySelector('.analise__contador').textContent).toContain(
      '1 caractere acima do limite de 2.000.'
    );
    expect(encontrarBotao('Perguntar').disabled).toBe(true);

    await digitar('Quanto o 30.910 tem livre?');
    campo.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await tick();
    expect(executarAnalise).not.toHaveBeenCalled();

    campo.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await tick();
    expect(executarAnalise).toHaveBeenCalledTimes(1);
  });

  it('chip de sugestão preenche sem enviar e o aviso literal está na tela', async () => {
    const executarAnalise = criarExecucao();
    renderizar(executarAnalise);

    const aviso = document.querySelector('.analise__aviso');
    expect(aviso.textContent).toContain(
      'As perguntas ficam guardadas para melhorar a Análise.'
    );
    expect(aviso.textContent).toContain('Limite de 50 perguntas por dia.');

    const chips = Array.from(document.querySelectorAll('.analise__sugestoes .chip'));
    expect(chips).toHaveLength(4);
    expect(chips.every((chip) => !chip.hasAttribute('aria-pressed'))).toBe(true);
    chips[0].click();
    await tick();

    expect(document.querySelector('.analise__campo').value).toBe(
      'Quanto o 30.109 tem livre hoje, e de onde vem?'
    );
    expect(executarAnalise).not.toHaveBeenCalled();
  });

  it('envia pergunta com trim, anteriores e um AbortSignal', async () => {
    const executarAnalise = criarExecucao();
    renderizar(executarAnalise);

    await digitar('  Quanto o 30.910 tem livre?  ');
    encontrarBotao('Perguntar').click();
    await tick();

    expect(executarAnalise).toHaveBeenCalledTimes(1);
    const opcoes = executarAnalise.mock.calls[0][0];
    expect(opcoes.pergunta).toBe('Quanto o 30.910 tem livre?');
    expect(opcoes.anteriores).toEqual([]);
    expect(opcoes.signal).toBeTruthy();
    expect(typeof opcoes.signal.addEventListener).toBe('function');
  });
});

describe('passos ao vivo', () => {
  it('inicio e fim do mesmo passo viram uma linha; erro mostra o texto e a região é aria-live', async () => {
    const passos = [
      { ferramenta: 'listar_centros', rotulo: 'consultando os centros', estado: 'inicio' },
      { ferramenta: 'listar_centros', rotulo: 'consultando os centros', estado: 'fim' },
      { ferramenta: 'explicar_livre_v2', rotulo: 'explicando o saldo livre', estado: 'inicio' },
      {
        ferramenta: 'explicar_livre_v2',
        rotulo: 'explicando o saldo livre',
        estado: 'erro',
        erro: 'a origem demorou a responder',
      },
    ];
    const executarAnalise = criarExecucao({ passos });
    renderizar(executarAnalise);

    await enviarPergunta('Pergunta com passos');
    await esperarAnalises(1);

    const regiao = document.querySelector('.analise__passos');
    expect(regiao.getAttribute('aria-live')).toBe('polite');
    const linhas = Array.from(regiao.querySelectorAll('.analise__passo'));
    expect(linhas).toHaveLength(2);
    expect(linhas[0].textContent).toContain('consultando os centros');
    expect(linhas[0].textContent).toContain('concluído');
    expect(linhas[1].classList.contains('analise__passo--erro')).toBe(true);
    expect(linhas[1].textContent).toContain('a origem demorou a responder');
  });
});

describe('blocos', () => {
  it('renderiza número com centavos, tabela com unidades, rótulo literal sem botão e null como —', async () => {
    const blocoNumero = criarBlocoNumero({
      valor: 514864.6,
      titulo: 'Livre do centro',
      rotulo: 'Livre — Pessoal (30.910)',
      origem: { tipo: 'sem_documento', motivo: 'valor digitado' },
    });
    const blocoTabela = criarBlocoTabela({
      colunas: [
        { rotulo: 'Centro', unidade: 'texto' },
        { rotulo: 'Livre (R$)', unidade: 'moeda' },
        { rotulo: 'Percentual', unidade: 'percentual' },
        { rotulo: 'Data', unidade: 'data' },
      ],
      linhas: [
        [
          { valor: 'Centro A', unidade: 'texto', origem: null },
          {
            valor: 1000.5,
            unidade: 'moeda',
            origem: { tipo: 'sem_documento', motivo: 'valor de teste' },
          },
          {
            valor: 12.5,
            unidade: 'percentual',
            origem: { tipo: 'sem_documento', motivo: 'percentual de teste' },
          },
          {
            valor: '2026-09-30',
            unidade: 'data',
            origem: { tipo: 'sem_documento', motivo: 'data de teste' },
          },
        ],
        [
          { valor: 'Centro B', unidade: 'texto', origem: null },
          {
            valor: null,
            unidade: 'moeda',
            origem: { tipo: 'sem_documento', motivo: 'sem balancete' },
          },
          { valor: 7, unidade: 'percentual', origem: null },
          { valor: '2026-10-01', unidade: 'data', origem: null },
        ],
      ],
    });
    const blocoTexto = criarBlocoTexto({
      texto: 'Um parágrafo de teste.',
    });
    const textoFinal = { texto: 'Texto final da resposta.', semOrigem: [] };
    const executarAnalise = criarExecucao({
      blocos: [blocoNumero, blocoTabela, blocoTexto],
      texto: textoFinal,
    });
    renderizar(executarAnalise);

    await enviarPergunta('Pergunta com blocos');
    await esperarAnalises(1);

    const destaque = document.querySelector('.destaque');
    expect(semNbsp(destaque.querySelector('.destaque__valor').textContent)).toBe(
      'R$ 514.864,60'
    );

    const tabela = document.querySelector('.tabela');
    expect(tabela).not.toBeNull();
    const primeiraCelula = tabela.querySelector('tbody tr:first-child td:first-child');
    expect(primeiraCelula.textContent).toBe('Centro A');
    expect(primeiraCelula.querySelector('button')).toBeNull();

    const linhas = Array.from(tabela.querySelectorAll('tbody tr'));
    const celulaNula = linhas[1].querySelectorAll('td')[1];
    expect(celulaNula.textContent.trim()).toBe('—');
    expect(celulaNula.querySelector('.valor').getAttribute('title')).toBe('sem balancete');
    expect(semNbsp(document.body.textContent)).not.toContain('R$ 0,00');

    expect(linhas[0].textContent).toContain('12,5%');
    expect(linhas[0].textContent).toContain('30/09/2026');
    expect(semNbsp(linhas[0].textContent)).toContain('1.000,50');
    expect(semNbsp(linhas[0].textContent)).not.toContain('R$ 1.000,50');
    expect(document.querySelector('.analise__texto-final').textContent).toContain(
      'Texto final da resposta.'
    );
  });

  it('célula de moeda só perde o R$ quando o cabeçalho da coluna tem (R$)', async () => {
    const bloco = criarBlocoTabela({
      colunas: [
        { rotulo: 'Centro', unidade: 'texto' },
        { rotulo: 'Livre (R$)', unidade: 'moeda' },
        { rotulo: 'Comprometido', unidade: 'moeda' },
      ],
      linhas: [
        [
          { valor: 'Centro A', unidade: 'texto', origem: null },
          { valor: 1000.5, unidade: 'moeda', origem: null },
          { valor: 2000.25, unidade: 'moeda', origem: null },
        ],
      ],
    });
    renderizar(criarExecucao({ blocos: [bloco], texto: null }));
    await enviarPergunta('Pergunta com cabeçalhos de moeda');
    await esperarAnalises(1);

    const celulas = Array.from(document.querySelectorAll('.tabela tbody tr:first-child td'));
    expect(semNbsp(celulas[1].textContent).trim()).toBe('1.000,50');
    expect(semNbsp(celulas[2].textContent).trim()).toBe('R$ 2.000,25');
  });

  it('bloco inválido é omitido com uma nota e os vizinhos aparecem', async () => {
    const bom1 = criarBlocoNumero({ valor: 10, id: 'bom-1' });
    const invalido = {
      id: 'invalido',
      tipo: 'tabela',
      titulo: 'Sem colunas',
      tabela: { colunas: null, linhas: {} },
    };
    const bom2 = criarBlocoTexto({ id: 'bom-2', texto: 'Texto que ficou.' });
    const executarAnalise = criarExecucao({ blocos: [bom1, invalido, bom2] });
    renderizar(executarAnalise);

    await enviarPergunta('Pergunta com bloco inválido');
    await esperarAnalises(1);

    expect(document.querySelectorAll('.bloco-analise')).toHaveLength(2);
    const notas = Array.from(document.querySelectorAll('.analise__bloco-invalido'));
    expect(notas).toHaveLength(1);
    expect(notas[0].textContent).toBe(
      'Um bloco veio em formato inválido e foi omitido.'
    );
    expect(document.body.textContent).toContain('Texto que ficou.');
    expect(document.body.textContent).not.toContain('"colunas"');
  });

  it('marca o intervalo certo de semOrigem, ignora inválidos e troca ⟦P3⟧ por pessoa 3', async () => {
    const texto = 'O valor é 12.345 e ⟦P3⟧ confirma o total.';
    const inicio = texto.indexOf('12.345');
    const bloco = criarBlocoTexto({
      texto,
      semOrigem: [
        { inicio, fim: inicio + '12.345'.length },
        { inicio: 999, fim: 1000 },
        { inicio: 5, fim: 3 },
        { inicio: inicio + 2, fim: inicio + 4 },
      ],
    });
    const executarAnalise = criarExecucao({
      blocos: [bloco],
      texto: null,
    });
    renderizar(executarAnalise);

    await enviarPergunta('Pergunta com sem origem');
    await esperarAnalises(1);

    const marcas = Array.from(document.querySelectorAll('.bloco-analise__sem-origem'));
    expect(marcas).toHaveLength(1);
    expect(semNbsp(marcas[0].textContent)).toBe('12.345');
    expect(marcas[0].getAttribute('title')).toBe(TITULO_SEM_ORIGEM);
    expect(document.body.textContent).toContain('pessoa 3');
    expect(document.body.textContent).not.toContain('⟦P3⟧');
  });
});

describe('origem clicável', () => {
  async function abrirComBloco(bloco, props = {}) {
    const executarAnalise = criarExecucao({ blocos: [bloco], texto: null });
    renderizar(executarAnalise, props);
    await enviarPergunta('Pergunta com origem');
    await esperarAnalises(1);
    const botao = document.querySelector('.destaque button.valor--origem');
    expect(botao).not.toBeNull();
    botao.click();
    await tick();
    return botao;
  }

  it('no: abre o DeOndeVem com o nó', async () => {
    const no = {
      rotulo: 'Nó de teste',
      valor: 100,
      tipo: 'calculo',
      chave: 'livre',
      partes: [{ rotulo: 'Parte do nó', valor: 100, tipo: 'legado', chave: 'parte', partes: [] }],
    };
    await abrirComBloco(
      criarBlocoNumero({ valor: 100, origem: { tipo: 'no', no } })
    );

    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.querySelector('.de-onde-vem')).not.toBeNull();
    expect(painel.textContent).toContain('Nó de teste');
    expect(painel.textContent).toContain('Parte do nó');
    expect(painel.querySelector('.aviso-falha')).toBeNull();
  });

  it('no: árvore com valor diferente do número clicado mostra o aviso de divergência', async () => {
    const no = {
      rotulo: 'Nó divergente',
      valor: 90,
      tipo: 'legado',
      chave: 'no-divergente',
      partes: [],
    };
    await abrirComBloco(
      criarBlocoNumero({ valor: 100, origem: { tipo: 'no', no } })
    );

    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    const aviso = painel.querySelector('.aviso-falha');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('O total da árvore');
    expect(aviso.textContent).toContain('difere do valor do painel');
  });

  it('livre sem caminho, mas com chave, desce até a chave e mostra "Parte de"', async () => {
    const arvore = {
      rotulo: 'Livre raiz',
      valor: 100,
      tipo: 'calculo',
      chave: 'livre',
      partes: [
        {
          rotulo: 'Pessoal',
          valor: 100,
          tipo: 'calculo',
          chave: 'grupo:a',
          partes: [],
        },
      ],
    };
    explicarLivreMock.mockResolvedValue({ dados: arvore, erro: null });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: { tipo: 'livre', project_id: 'projeto-1', chave: 'grupo:a' },
      })
    );

    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.textContent).toContain('Parte de: Livre raiz');
    expect(painel.querySelector('.de-onde-vem .destaque__rotulo').textContent).toBe('Pessoal');
  });

  function arvoreChaveRepetida() {
    // A 070 repete `linha:<id>` no compromisso e na folha atrasada (contrato §3).
    return {
      rotulo: 'Livre raiz',
      valor: 2100,
      tipo: 'calculo',
      chave: 'livre',
      partes: [
        { rotulo: 'Compromisso', valor: 3000, tipo: 'calculo', chave: 'linha:42', partes: [] },
        { rotulo: 'Folha atrasada', valor: 900, tipo: 'calculo', chave: 'linha:42', partes: [] },
      ],
    };
  }

  it('livre com chave repetida e caminho inválido abre a ocorrência com o valor clicado', async () => {
    explicarLivreMock.mockResolvedValue({ dados: arvoreChaveRepetida(), erro: null });
    await abrirComBloco(
      criarBlocoNumero({
        valor: 900,
        origem: { tipo: 'livre', project_id: 'projeto-1', chave: 'linha:42', caminho: [7] },
      })
    );
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.querySelector('.de-onde-vem .destaque__rotulo').textContent).toBe(
      'Folha atrasada'
    );
    expect(painel.textContent).not.toContain('difere do valor do painel');
  });

  it('livre com chave repetida sem valor que desempate mostra a árvore inteira com a nota', async () => {
    explicarLivreMock.mockResolvedValue({ dados: arvoreChaveRepetida(), erro: null });
    await abrirComBloco(
      criarBlocoNumero({
        valor: 123,
        origem: { tipo: 'livre', project_id: 'projeto-1', chave: 'linha:42' },
      })
    );
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.textContent).toContain(
      'Não achei o item exato; mostrando a origem do livre do centro.'
    );
    expect(painel.querySelector('.de-onde-vem .destaque__rotulo').textContent).toBe('Livre raiz');
  });

  it('livre sem caminho e com chave inexistente mostra a árvore inteira com a nota', async () => {
    const arvore = {
      rotulo: 'Livre raiz',
      valor: 100,
      tipo: 'calculo',
      chave: 'livre',
      partes: [
        {
          rotulo: 'Pessoal',
          valor: 100,
          tipo: 'calculo',
          chave: 'grupo:a',
          partes: [],
        },
      ],
    };
    explicarLivreMock.mockResolvedValue({ dados: arvore, erro: null });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: { tipo: 'livre', project_id: 'projeto-1', chave: 'nao-existe' },
      })
    );

    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.textContent).toContain(
      'Não achei o item exato; mostrando a origem do livre do centro.'
    );
    expect(painel.querySelector('.de-onde-vem .destaque__rotulo').textContent).toBe(
      'Livre raiz'
    );
  });

  it('livre: chama explicarLivre com o project_id, desce pelo caminho e mostra "Parte de"', async () => {
    const arvore = {
      rotulo: 'Livre raiz',
      valor: 100,
      tipo: 'calculo',
      chave: 'livre',
      partes: [
        {
          rotulo: 'Pessoal',
          valor: 100,
          tipo: 'calculo',
          chave: 'grupo:a',
          partes: [
            { rotulo: 'Filho', valor: 100, tipo: 'legado', chave: 'filho', partes: [] },
          ],
        },
      ],
    };
    explicarLivreMock.mockResolvedValue({ dados: arvore, erro: null });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: {
          tipo: 'livre',
          project_id: 'projeto-1',
          chave: 'grupo:a',
          caminho: [0],
        },
      })
    );

    expect(explicarLivreMock).toHaveBeenCalledWith('projeto-1');
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.textContent).toContain('Parte de: Livre raiz');
    expect(painel.textContent).toContain('Pessoal');
    expect(painel.textContent).toContain('Filho');
    expect(painel.querySelector('.aviso-falha')).toBeNull();
  });

  it('livre: subárvore com valor diferente do número clicado mostra o aviso de divergência', async () => {
    const arvore = {
      rotulo: 'Livre raiz',
      valor: 100,
      tipo: 'calculo',
      chave: 'livre',
      partes: [
        {
          rotulo: 'Pessoal',
          valor: 90,
          tipo: 'calculo',
          chave: 'grupo:a',
          partes: [],
        },
      ],
    };
    explicarLivreMock.mockResolvedValue({ dados: arvore, erro: null });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: {
          tipo: 'livre',
          project_id: 'projeto-1',
          chave: 'grupo:a',
          caminho: [0],
        },
      })
    );

    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    const aviso = painel.querySelector('.aviso-falha');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('difere do valor do painel');
  });

  it('livre: caminho inválido cai na chave do nó', async () => {
    const arvore = {
      rotulo: 'Livre raiz',
      valor: 100,
      tipo: 'calculo',
      chave: 'livre',
      partes: [
        {
          rotulo: 'Pessoal',
          valor: 100,
          tipo: 'calculo',
          chave: 'grupo:a',
          partes: [{ rotulo: 'Filho', valor: 100, tipo: 'legado', chave: 'filho', partes: [] }],
        },
      ],
    };
    explicarLivreMock.mockResolvedValue({ dados: arvore, erro: null });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: {
          tipo: 'livre',
          project_id: 'projeto-1',
          chave: 'grupo:a',
          caminho: [99],
        },
      })
    );

    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.textContent).toContain('Pessoal');
    expect(painel.textContent).toContain('Parte de: Livre raiz');
  });

  it('livre: sem chave no caminho inválido mostra a árvore inteira com a nota', async () => {
    const arvore = {
      rotulo: 'Livre raiz',
      valor: 100,
      tipo: 'calculo',
      chave: 'livre',
      partes: [
        {
          rotulo: 'Pessoal',
          valor: 100,
          tipo: 'calculo',
          chave: 'grupo:a',
          partes: [{ rotulo: 'Filho', valor: 100, tipo: 'legado', chave: 'filho', partes: [] }],
        },
      ],
    };
    explicarLivreMock.mockResolvedValue({ dados: arvore, erro: null });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: {
          tipo: 'livre',
          project_id: 'projeto-1',
          chave: 'nao-existe',
          caminho: [99],
        },
      })
    );

    const painel = await esperarPor(() =>
      document.querySelector('.painel-lateral')?.textContent.includes('Não achei o item exato')
        ? document.querySelector('.painel-lateral')
        : null
    );
    expect(painel.textContent).toContain('Não achei o item exato');
    expect(painel.textContent).toContain('Livre raiz');
    expect(painel.textContent).toContain('Pessoal');
  });

  it('ref: chama origem com a ref e abre o Documento', async () => {
    const ref = {
      alvo_tabela: 'balancetes',
      alvo_id: 'alvo-1',
      campo: 'saldo_disponivel',
    };
    origemMock.mockResolvedValue({
      dados: {
        tipo: 'documento',
        valor: 100,
        documento: {
          id: 'doc-1',
          titulo: 'Balancete de teste',
          arquivo_nome: 'balancete-teste.pdf',
          formato: 'pdf',
          bucket: 'teste',
          caminho: 'pasta/arquivo.pdf',
        },
        fato: { pagina: 2, trecho: 'saldo de teste' },
        busca: null,
        nota: '',
      },
      erro: null,
    });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: { tipo: 'ref', ref, nome: 'Saldo do balancete' },
      }),
      { arquivoDeOrigem: arquivoDeOrigemMock }
    );

    expect(origemMock).toHaveBeenCalledWith(ref);
    const documento = await esperarPor(() => document.querySelector('.documento'));
    expect(documento.querySelector('.documento__titulo').textContent).toBe(
      'Balancete de teste'
    );
  });

  it('ref: Documento usa o valor clicado quando a resposta não traz valor', async () => {
    origemMock.mockResolvedValue({
      dados: {
        tipo: 'legado',
        valor: undefined,
        documento: {
          id: 'doc-sem-valor',
          titulo: 'Documento sem valor na resposta',
          formato: 'pdf',
          bucket: 'teste',
          caminho: 'pasta/sem-valor.pdf',
        },
        fato: null,
        busca: { texto: 'saldo', valor: 123.45 },
        nota: '',
      },
      erro: null,
    });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 123.45,
        origem: {
          tipo: 'ref',
          ref: {
            alvo_tabela: 'balancetes',
            alvo_id: 'alvo-sem-valor',
            campo: 'saldo_disponivel',
          },
          nome: 'Saldo sem valor na resposta',
        },
      })
    );

    const documento = await esperarPor(() => document.querySelector('.documento'));
    expect(semNbsp(documento.querySelector('.documento__valor').textContent)).toContain(
      'R$ 123,45'
    );
  });

  it('termo: acha o termo pelo id e mostra rótulo, valor e trecho; termo sumido vira Vazio', async () => {
    termosContratoMock.mockResolvedValue({
      dados: {
        termos: {
          vigencia_fim: {
            id: 'termo-1',
            valor: '2027-08-31',
            trecho: 'Trecho literal sintético do contrato.',
            documento_nome: 'Contrato sintético',
            documento: { bucket: 'teste', caminho: 'contrato.pdf' },
          },
        },
      },
      erro: null,
    });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: { tipo: 'termo', project_id: 'projeto-1', termo_id: 'termo-1' },
      })
    );

    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(termosContratoMock).toHaveBeenCalledWith('projeto-1');
    expect(painel.textContent).toContain('Do contrato');
    expect(painel.textContent).toContain('Fim da vigência');
    expect(painel.textContent).toContain('31/08/2027');
    expect(painel.textContent).toContain('Trecho literal sintético do contrato.');

    encontrarBotao('Abrir o documento', painel).click();
    const documento = await esperarPor(() => document.querySelector('.documento'));
    expect(documento.textContent).toContain('Contrato sintético');
  });

  it('termo não encontrado mostra "Este termo não está mais registrado."', async () => {
    termosContratoMock.mockResolvedValue({
      dados: { termos: {} },
      erro: null,
    });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: { tipo: 'termo', project_id: 'projeto-1', termo_id: 'sumiu' },
      })
    );

    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.textContent).toContain('Este termo não está mais registrado.');
  });

  it('calculo: lista as partes com sinal, cada parte abre a própria origem e "Voltar à conta" retorna', async () => {
    const noA = {
      rotulo: 'Nó A',
      valor: 3000.1,
      tipo: 'legado',
      chave: 'no-a',
      partes: [],
    };
    const noB = {
      rotulo: 'Nó B',
      valor: 2000.2,
      tipo: 'legado',
      chave: 'no-b',
      partes: [],
    };
    const bloco = criarBlocoNumero({
      valor: 5000.3,
      origem: {
        tipo: 'calculo',
        op: 'soma',
        partes: [
          { id: 'p1', sinal: 1, valor: 3000.1, rotulo: 'Parte A', origem: { tipo: 'no', no: noA } },
          { id: 'p2', sinal: 1, valor: 2000.2, rotulo: 'Parte B', origem: { tipo: 'no', no: noB } },
        ],
      },
    });
    await abrirComBloco(bloco);

    let painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.textContent).toContain('Conta');
    expect(painel.querySelectorAll('.analise__conta-parte')).toHaveLength(2);
    expect(painel.textContent).toContain('Parte A');
    expect(painel.textContent).toContain('Parte B');
    expect(semNbsp(painel.textContent)).toContain('R$ 3.000,10');
    expect(semNbsp(painel.querySelector('.analise__conta-total').textContent)).toContain(
      'R$ 5.000,30'
    );
    expect(painel.querySelector('.aviso-falha')).toBeNull();

    const botaoParteA = painel.querySelector('.analise__conta-parte button.valor--origem');
    expect(botaoParteA).not.toBeNull();
    botaoParteA.click();

    painel = await esperarPor(() =>
      document.querySelector('.painel-lateral')?.textContent.includes('Nó A')
        ? document.querySelector('.painel-lateral')
        : null
    );
    expect(painel.textContent).toContain('Voltar à conta');

    encontrarBotao('Voltar à conta', painel).click();
    painel = await esperarPor(() =>
      document.querySelector('.painel-lateral')?.textContent.includes('Conta')
        ? document.querySelector('.painel-lateral')
        : null
    );
    expect(painel.querySelectorAll('.analise__conta-parte')).toHaveLength(2);
  });

  it('calculo com parte de sinal -1 que fecha ao centavo não mostra aviso', async () => {
    await abrirComBloco(
      criarBlocoNumero({
        valor: 5000.3,
        origem: {
          tipo: 'calculo',
          op: 'soma',
          partes: [
            { id: 'p1', sinal: 1, valor: 7000.4, rotulo: 'Receita', origem: null },
            { id: 'p2', sinal: -1, valor: 2000.1, rotulo: 'Despesa', origem: null },
          ],
        },
      })
    );

    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.querySelectorAll('.analise__conta-parte')).toHaveLength(2);
    expect(painel.textContent).toContain('Receita');
    expect(painel.textContent).toContain('Despesa');
    expect(painel.textContent).toContain('−');
    expect(semNbsp(painel.querySelector('.analise__conta-total').textContent)).toContain(
      'R$ 5.000,30'
    );
    expect(painel.querySelector('.aviso-falha')).toBeNull();
  });

  it('calculo que não fecha ao centavo mostra "A soma das partes difere do total."', async () => {    await abrirComBloco(
      criarBlocoNumero({
        valor: 5001,
        origem: {
          tipo: 'calculo',
          op: 'soma',
          partes: [
            { id: 'p1', sinal: 1, valor: 3000, rotulo: 'Parte A', origem: null },
            { id: 'p2', sinal: 1, valor: 2000, rotulo: 'Parte B', origem: null },
          ],
        },
      })
    );

    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    expect(painel.querySelector('.aviso-falha').textContent).toContain(
      'A soma das partes difere do total.'
    );
  });

  it('ref sem documento abre o PainelLateral com a nota', async () => {
    origemMock.mockResolvedValue({
      dados: {
        tipo: 'legado',
        valor: 100,
        documento: null,
        fato: null,
        busca: null,
        nota: 'Valor anterior à rastreabilidade, sem arquivo.',
      },
      erro: null,
    });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: {
          tipo: 'ref',
          ref: { alvo_tabela: 'balancetes', alvo_id: 'alvo-2', campo: 'saldo_disponivel' },
          nome: 'Saldo antigo',
        },
      })
    );

    const painel = await esperarPor(() =>
      document.querySelector('.painel-lateral')?.textContent.includes('anterior à rastreabilidade')
        ? document.querySelector('.painel-lateral')
        : null
    );
    expect(painel.textContent).toContain('Valor anterior à rastreabilidade, sem arquivo.');
    expect(document.querySelector('.documento')).toBeNull();
  });

  it('falha de explicarLivre mostra AvisoFalha com Tentar de novo', async () => {
    explicarLivreMock.mockResolvedValue({
      dados: null,
      erro: 'Falha de teste ao carregar o livre.',
    });

    await abrirComBloco(
      criarBlocoNumero({
        valor: 100,
        origem: { tipo: 'livre', project_id: 'projeto-1', chave: 'livre' },
      })
    );

    const aviso = await esperarPor(() => document.querySelector('.painel-lateral .aviso-falha'));
    expect(aviso.textContent).toContain('Falha de teste ao carregar o livre.');
    expect(encontrarBotao('Tentar de novo', aviso)).toBeTruthy();
  });

  it('fechar o painel cancela a exibição do que ainda carrega', async () => {
    let resolver;
    const pendente = new Promise((res) => {
      resolver = res;
    });
    explicarLivreMock.mockReturnValue(pendente);

    const executarAnalise = criarExecucao({
      blocos: [
        criarBlocoNumero({
          valor: 100,
          origem: { tipo: 'livre', project_id: 'projeto-lento', chave: 'livre' },
        }),
      ],
      texto: null,
    });
    renderizar(executarAnalise);
    await enviarPergunta('Pergunta para cancelar o painel');
    await esperarAnalises(1);

    document.querySelector('.destaque button.valor--origem').click();
    await tick();
    const painel = await esperarPor(() => document.querySelector('.painel-lateral'));
    painel.querySelector('.painel-lateral__fechar').click();
    await esperarPor(() => !document.querySelector('.painel-lateral'));

    resolver({
      dados: { rotulo: 'Árvore tardia', valor: 100, tipo: 'legado', chave: 'livre', partes: [] },
      erro: null,
    });
    await tick();
    await tick();

    expect(document.querySelector('.painel-lateral')).toBeNull();
  });

  it('sem_documento não tem botão e mostra o motivo; origem desconhecida não quebra', async () => {
    const executarAnalise = criarExecucao({
      blocos: [
        criarBlocoNumero({
          valor: 100,
          id: 'sem-doc',
          origem: { tipo: 'sem_documento', motivo: 'bolsa digitada, ainda sem documento' },
        }),
        criarBlocoNumero({
          valor: 200,
          id: 'desconhecida',
          origem: { tipo: 'tipo-novo', motivo: 'x' },
        }),
      ],
      texto: null,
    });
    renderizar(executarAnalise);
    await enviarPergunta('Pergunta com origens sem documento');
    await esperarAnalises(1);

    const destaques = Array.from(document.querySelectorAll('.destaque'));
    expect(destaques[0].querySelector('button.valor--origem')).toBeNull();
    expect(destaques[0].querySelector('.valor').getAttribute('title')).toBe(
      'bolsa digitada, ainda sem documento'
    );
    expect(destaques[1].querySelector('button.valor--origem')).toBeNull();
    expect(destaques[1].querySelector('.valor').getAttribute('title')).toBe(
      'Origem não informada'
    );
  });

  it('corrida: clique em A (lento) e depois em B (rápido) deixa só B no painel', async () => {
    const criarAdiado = () => {
      let resolver;
      const promessa = new Promise((res) => {
        resolver = res;
      });
      return { promessa, resolver };
    };
    const lento = criarAdiado();
    const rapido = criarAdiado();
    explicarLivreMock.mockImplementation((projectId) =>
      projectId === 'projeto-a' ? lento.promessa : rapido.promessa
    );

    const executarAnalise = criarExecucao({
      blocos: [
        criarBlocoNumero({
          valor: 100,
          id: 'a',
          rotulo: 'Valor A',
          origem: { tipo: 'livre', project_id: 'projeto-a', chave: 'livre' },
        }),
        criarBlocoNumero({
          valor: 200,
          id: 'b',
          rotulo: 'Valor B',
          origem: { tipo: 'livre', project_id: 'projeto-b', chave: 'livre' },
        }),
      ],
      texto: null,
    });
    renderizar(executarAnalise);
    await enviarPergunta('Pergunta da corrida');
    await esperarAnalises(1);

    const botoes = Array.from(document.querySelectorAll('.destaque button.valor--origem'));
    expect(botoes).toHaveLength(2);
    botoes[0].click();
    await tick();
    botoes[1].click();
    await tick();

    rapido.resolver({
      dados: { rotulo: 'Árvore B', valor: 200, tipo: 'legado', chave: 'livre', partes: [] },
      erro: null,
    });
    await tick();
    lento.resolver({
      dados: { rotulo: 'Árvore A', valor: 100, tipo: 'legado', chave: 'livre', partes: [] },
      erro: null,
    });
    await tick();
    await tick();

    const painel = document.querySelector('.painel-lateral');
    expect(painel.textContent).toContain('Árvore B');
    expect(painel.textContent).not.toContain('Árvore A');
  });
});

describe('erros e cortes', () => {
  it('limite, sem_login e sem_permissao não oferecem Tentar de novo', async () => {
    for (const codigo of ['limite', 'sem_login', 'sem_permissao']) {
      const erro = { codigo, mensagem: `Mensagem de ${codigo}` };
      const executarAnalise = criarExecucao({ erro, inicio: null, texto: null, fim: null });
      renderizar(executarAnalise);
      await enviarPergunta(`Pergunta ${codigo}`);
      await esperarAnalises(1);

      const aviso = document.querySelector('.aviso-falha');
      expect(aviso.textContent).toContain(erro.mensagem);
      expect(encontrarBotao('Tentar de novo', aviso)).toBeUndefined();

      render(null, document.body);
      document.body.innerHTML = '';
    }
  });

  it('modelo, tempo, interno e rede oferecem Tentar de novo; incompleta e interrompida mantêm os blocos', async () => {
    for (const codigo of ['modelo', 'tempo', 'interno', 'rede']) {
      const erro = { codigo, mensagem: `Mensagem de ${codigo}` };
      const bloco = criarBlocoNumero({ valor: 10, id: `bloco-${codigo}` });
      const executarAnalise = criarExecucao({
        erro,
        blocos: [bloco],
        texto: null,
        fim: { rodadas: 2, ms: 3000 },
      });
      renderizar(executarAnalise);
      await enviarPergunta(`Pergunta ${codigo}`);
      await esperarAnalises(1);

      const aviso = document.querySelector('.aviso-falha');
      expect(aviso.textContent).toContain(erro.mensagem);
      expect(encontrarBotao('Tentar de novo', aviso)).toBeTruthy();
      expect(document.querySelectorAll('.bloco-analise').length).toBeGreaterThan(0);

      render(null, document.body);
      document.body.innerHTML = '';
    }

    for (const codigo of ['incompleta', 'interrompida']) {
      const erro = { codigo, mensagem: `Mensagem de ${codigo}` };
      const bloco = criarBlocoNumero({ valor: 10, id: `bloco-${codigo}` });
      const executarAnalise = criarExecucao({
        erro,
        blocos: [bloco],
        texto: null,
        fim: codigo === 'incompleta' ? { rodadas: 8, ms: 42000 } : null,
        retorno: codigo === 'interrompida' ? { interrompida: true } : null,
      });
      renderizar(executarAnalise);
      await enviarPergunta(`Pergunta ${codigo}`);
      await esperarAnalises(1);

      const aviso = document.querySelector('.aviso-falha');
      expect(aviso.textContent).toContain(erro.mensagem);
      expect(document.querySelectorAll('.bloco-analise')).toHaveLength(1);

      render(null, document.body);
      document.body.innerHTML = '';
    }
  });

  it('Tentar de novo reenvia a mesma pergunta e os mesmos anteriores', async () => {
    let chamadas = 0;
    const executarAnalise = vi.fn(async (opcoes) => {
      chamadas += 1;
      opcoes.onInicio?.({ registro: 'reg-1' });
      if (chamadas === 1) {
        const erro = { codigo: 'tempo', mensagem: 'Tempo esgotado.' };
        opcoes.onErro?.(erro);
        return { ok: false, erro, registro: 'reg-1', blocos: [], texto: null };
      }
      const bloco = criarBlocoNumero({ valor: 10, id: 'depois' });
      opcoes.onBloco?.(bloco);
      opcoes.onFim?.({ rodadas: 1, ms: 1000 });
      return {
        ok: true,
        erro: null,
        registro: 'reg-2',
        blocos: [bloco],
        texto: null,
        fim: { rodadas: 1, ms: 1000 },
      };
    });

    renderizar(executarAnalise);
    await enviarPergunta('Pergunta para repetir');
    await esperarAnalises(1);

    const primeiro = executarAnalise.mock.calls[0][0];
    encontrarBotao('Tentar de novo').click();
    await esperarPor(() => executarAnalise.mock.calls.length === 2);
    await esperarPor(() => !document.querySelector('.aviso-falha'));

    const segundo = executarAnalise.mock.calls[1][0];
    expect(segundo.pergunta).toBe(primeiro.pergunta);
    expect(segundo.anteriores).toEqual(primeiro.anteriores);
    expect(document.querySelectorAll('.analise__cartao')).toHaveLength(1);
  });

  it('aviso de corte fica antes do texto final e dos blocos', async () => {
    const bloco = criarBlocoNumero({ valor: 10, id: 'ordem-bloco' });
    const texto = { texto: 'Texto que chegou antes do corte.', semOrigem: [] };
    const executarAnalise = criarExecucao({
      inicio: { registro: 'reg-1' },
      blocos: [bloco],
      texto,
      fim: null,
      erro: { codigo: 'interrompida', mensagem: 'A análise foi interrompida.' },
      retorno: { interrompida: true },
    });

    renderizar(executarAnalise);
    await enviarPergunta('Pergunta com corte');
    await esperarAnalises(1);

    const corpo = document.querySelector('.analise__cartao .cartao__corpo');
    const filhos = Array.from(corpo.children);
    const aviso = corpo.querySelector('.aviso-falha');
    const textoEl = corpo.querySelector('.analise__texto-final');
    const blocoEl = corpo.querySelector('.bloco-analise');

    expect(aviso).not.toBeNull();
    expect(filhos.indexOf(aviso)).toBeLessThan(filhos.indexOf(textoEl));
    expect(filhos.indexOf(aviso)).toBeLessThan(filhos.indexOf(blocoEl));
  });
});

describe('parar a análise', () => {
  it('o botão vira Parar, aborta o signal, mantém o bloco que já chegou e deixa a nota sem banner de erro', async () => {
    let capturado;
    let resolver;
    const blocoParcial = criarBlocoNumero({ valor: 10, id: 'parcial' });
    const executarAnalise = vi.fn(
      (opcoes) =>
        new Promise((res) => {
          capturado = opcoes.signal;
          opcoes.onInicio?.({ registro: 'reg-1' });
          opcoes.onBloco?.(blocoParcial);
          resolver = () =>
            res({
              ok: false,
              abortada: true,
              registro: 'reg-1',
              blocos: [blocoParcial],
              texto: null,
            });
        })
    );

    renderizar(executarAnalise);
    await enviarPergunta('Pergunta para parar');

    const parar = await esperarPor(() => encontrarBotao('Parar'));
    expect(parar).toBeTruthy();
    expect(capturado.aborted).toBe(false);
    expect(document.querySelectorAll('.bloco-analise')).toHaveLength(1);
    parar.click();
    await tick();

    expect(capturado.aborted).toBe(true);
    expect(document.body.textContent).toContain('Você parou a análise.');
    expect(document.querySelector('.aviso-falha')).toBeNull();
    expect(document.querySelectorAll('.bloco-analise')).toHaveLength(1);

    resolver();
    await tick();
  });

  it('cartão parado oferece Tentar de novo com a mesma pergunta e os mesmos anteriores', async () => {
    let resolverPrimeira;
    let chamadas = 0;
    const blocoParcial = criarBlocoNumero({ valor: 10, id: 'parcial-retry' });
    const blocoFinal = criarBlocoNumero({ valor: 20, id: 'final-retry' });
    const executarAnalise = vi.fn((opcoes) => {
      chamadas += 1;
      opcoes.onInicio?.({ registro: `reg-${chamadas}` });
      if (chamadas === 1) {
        opcoes.onBloco?.(blocoParcial);
        return new Promise((resolver) => {
          resolverPrimeira = () =>
            resolver({
              ok: false,
              abortada: true,
              registro: 'reg-1',
              blocos: [blocoParcial],
              texto: null,
            });
        });
      }
      opcoes.onBloco?.(blocoFinal);
      opcoes.onFim?.({ rodadas: 1, ms: 1000 });
      return Promise.resolve({
        ok: true,
        erro: null,
        registro: 'reg-2',
        blocos: [blocoFinal],
        texto: null,
        fim: { rodadas: 1, ms: 1000 },
      });
    });

    renderizar(executarAnalise);
    await enviarPergunta('Pergunta que vai ser parada');
    await esperarPor(() => encontrarBotao('Parar'));
    encontrarBotao('Parar').click();
    await tick();

    const primeira = executarAnalise.mock.calls[0][0];
    const tentar = await esperarPor(() => encontrarBotao('Tentar de novo'));
    expect(tentar).toBeTruthy();
    tentar.click();

    await esperarPor(() => executarAnalise.mock.calls.length === 2);
    const segunda = executarAnalise.mock.calls[1][0];
    expect(segunda.pergunta).toBe(primeira.pergunta);
    expect(segunda.anteriores).toEqual(primeira.anteriores);
    expect(document.querySelectorAll('.analise__cartao')).toHaveLength(1);

    resolverPrimeira();
    await tick();
  });
});

describe('modo exemplo na tela', () => {
  it('mostra o passo de termos que terminou em erro', async () => {
    const executar = (opcoes) => executarAnaliseExemplo({ ...opcoes, atraso: 0 });
    renderizar(executar);

    await enviarPergunta('Quanto o 30.910 tem livre?');
    await esperarAnalises(1);

    const erro = document.querySelector('.analise__passo--erro');
    expect(erro).not.toBeNull();
    expect(erro.textContent).toContain('lendo os termos do contrato');
    expect(erro.querySelector('.analise__passo-erro').textContent).toContain('tempo');
  });
});

describe('várias perguntas e anteriores', () => {
  function executarComTexto() {
    return vi.fn(async (opcoes) => {
      opcoes.onInicio?.({ registro: `reg-${opcoes.pergunta}` });
      const texto = { texto: `Resumo de ${opcoes.pergunta}`, semOrigem: [] };
      opcoes.onTexto?.(texto);
      opcoes.onFim?.({ rodadas: 1, ms: 1000 });
      return {
        ok: true,
        erro: null,
        registro: `reg-${opcoes.pergunta}`,
        blocos: [],
        texto,
        fim: { rodadas: 1, ms: 1000 },
      };
    });
  }

  it('depois de 6 análises ok, a 7ª envia só as 5 últimas, da mais antiga para a mais nova', async () => {
    const executarAnalise = executarComTexto();
    renderizar(executarAnalise);

    for (let i = 1; i <= 6; i += 1) {
      await enviarPergunta(`Pergunta ${i}`);
      await esperarAnalises(i);
    }

    await enviarPergunta('Pergunta 7');
    await esperarPor(() => executarAnalise.mock.calls.length === 7);

    const anteriores = executarAnalise.mock.calls[6][0].anteriores;
    expect(anteriores).toHaveLength(5);
    expect(anteriores.map((item) => item.pergunta)).toEqual([
      'Pergunta 2',
      'Pergunta 3',
      'Pergunta 4',
      'Pergunta 5',
      'Pergunta 6',
    ]);
  });

  it('corta pergunta em 500 e resumo em 1.000, e ignora análise com erro sem texto', async () => {
    let chamada = 0;
    const executarAnalise = vi.fn(async (opcoes) => {
      chamada += 1;
      opcoes.onInicio?.({ registro: `reg-${chamada}` });
      if (chamada === 2) {
        const erro = { codigo: 'tempo', mensagem: 'Tempo esgotado.' };
        opcoes.onErro?.(erro);
        return { ok: false, erro, registro: `reg-${chamada}`, blocos: [], texto: null };
      }
      const texto = { texto: 'x'.repeat(1200), semOrigem: [] };
      opcoes.onTexto?.(texto);
      opcoes.onFim?.({ rodadas: 1, ms: 1000 });
      return {
        ok: true,
        erro: null,
        registro: `reg-${chamada}`,
        blocos: [],
        texto,
        fim: { rodadas: 1, ms: 1000 },
      };
    });

    renderizar(executarAnalise);
    await enviarPergunta('p'.repeat(600));
    await esperarAnalises(1);

    await enviarPergunta('Pergunta com erro');
    await esperarAnalises(2);

    await enviarPergunta('Pergunta depois do erro');
    await esperarAnalises(3);

    const anteriores = executarAnalise.mock.calls[2][0].anteriores;
    expect(anteriores).toHaveLength(1);
    expect(anteriores[0].pergunta).toHaveLength(500);
    expect(anteriores[0].resumo).toHaveLength(1000);
  });

  it('Nova análise limpa a página e o contexto', async () => {
    const executarAnalise = executarComTexto();
    renderizar(executarAnalise);

    await enviarPergunta('Primeira pergunta');
    await esperarAnalises(1);
    expect(document.querySelectorAll('.analise__cartao')).toHaveLength(1);

    encontrarBotao('Nova análise').click();
    await tick();
    expect(document.querySelectorAll('.analise__cartao')).toHaveLength(0);
    expect(document.querySelector('.analise__campo').value).toBe('');

    await enviarPergunta('Depois de limpar');
    await esperarAnalises(1);
    expect(executarAnalise.mock.calls[1][0].anteriores).toEqual([]);
  });
});

describe('feedback', () => {
  it('Sim envia nota 1 e some com os botões; Não envia nota -1 com comentário', async () => {
    const enviarFeedback = vi.fn().mockResolvedValue({ id: 'feedback-1', erro: null });
    const executarAnalise = criarExecucao({
      blocos: [criarBlocoNumero({ valor: 10, id: 'b-feedback' })],
    });
    renderizar(executarAnalise, { enviarFeedback });

    await enviarPergunta('Pergunta com feedback');
    await esperarAnalises(1);
    expect(document.body.textContent).toContain('Esta resposta ajudou?');

    encontrarBotao('Sim').click();
    await esperarPor(() => document.body.textContent.includes('Obrigado, anotado.'));
    const obrigado = document.querySelector('.analise__feedback-obrigado');
    expect(obrigado.getAttribute('role')).toBe('status');
    expect(enviarFeedback).toHaveBeenCalledWith('reg-1', {
      nota: 1,
      comentario: null,
    });
    expect(encontrarBotao('Sim')).toBeUndefined();
    expect(encontrarBotao('Não')).toBeUndefined();

    render(null, document.body);
    document.body.innerHTML = '';

    const enviarFeedback2 = vi.fn().mockResolvedValue({ id: 'feedback-2', erro: null });
    renderizar(criarExecucao({ blocos: [] }), { enviarFeedback: enviarFeedback2 });
    await enviarPergunta('Pergunta com comentário');
    await esperarAnalises(1);

    encontrarBotao('Não').click();
    await tick();
    const campoComentario = document.querySelector('.analise__comentario');
    expect(campoComentario).not.toBeNull();
    campoComentario.value = 'faltou o detalhe do centro';
    campoComentario.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    encontrarBotao('Enviar').click();
    await esperarPor(() => document.body.textContent.includes('Obrigado, anotado.'));
    expect(enviarFeedback2).toHaveBeenCalledWith('reg-1', {
      nota: -1,
      comentario: 'faltou o detalhe do centro',
    });
  });

  it('erro no feedback mostra a mensagem e devolve os botões', async () => {
    const enviarFeedback = vi.fn().mockResolvedValue({
      id: null,
      erro: 'Não foi possível anotar agora.',
    });
    renderizar(criarExecucao({ blocos: [] }), { enviarFeedback });

    await enviarPergunta('Pergunta com feedback que falha');
    await esperarAnalises(1);

    encontrarBotao('Sim').click();
    const aviso = await esperarPor(() =>
      document.querySelector('.analise__feedback-erro')
    );
    expect(aviso.getAttribute('role')).toBe('alert');
    expect(aviso.textContent).toContain('Não foi possível anotar agora.');
    expect(encontrarBotao('Sim')).toBeTruthy();
    expect(encontrarBotao('Não')).toBeTruthy();
  });

  it('erro no envio do comentário é anunciado (role="alert") e o campo continua', async () => {
    const enviarFeedback = vi.fn().mockResolvedValue({
      id: null,
      erro: 'Não foi possível anotar o comentário.',
    });
    renderizar(criarExecucao({ blocos: [] }), { enviarFeedback });
    await enviarPergunta('Pergunta com comentário que falha');
    await esperarAnalises(1);

    encontrarBotao('Não').click();
    await tick();
    const campo = document.querySelector('.analise__comentario');
    campo.value = 'faltou o centro';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    encontrarBotao('Enviar').click();

    const aviso = await esperarPor(() => document.querySelector('.analise__feedback-erro'));
    expect(aviso.getAttribute('role')).toBe('alert');
    expect(aviso.textContent).toContain('Não foi possível anotar o comentário.');
    expect(document.querySelector('.analise__comentario')).not.toBeNull();
  });

  it('registro nulo não mostra o feedback', async () => {
    renderizar(
      criarExecucao({
        inicio: { registro: null },
        blocos: [criarBlocoNumero({ valor: 10, id: 'b-sem-registro' })],
      })
    );

    await enviarPergunta('Pergunta sem registro');
    await esperarAnalises(1);

    expect(document.body.textContent).not.toContain('Esta resposta ajudou?');
    expect(document.querySelector('.analise__feedback')).toBeNull();
  });
});
