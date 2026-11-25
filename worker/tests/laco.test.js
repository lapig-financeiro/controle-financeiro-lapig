import { describe, it, expect, vi } from 'vitest';
import { ErroModelo, TETOS, executarLaco } from '../src/laco.js';

const BASE = {
  instrucoes: 'INSTRUÇÕES DE TESTE',
  pergunta: 'Quanto o 30.109 tem livre?',
  hoje: '2026-11-25',
  tools: [{ type: 'function', function: { name: 'listar_centros' } }],
  agora: () => 1_000,
};

function sessaoFalsa(opcoes = {}) {
  const chamadas = {
    executar: [],
    criarBloco: [],
    calcular: [],
    marcarTexto: [],
    reidratar: [],
  };
  const sessao = {
    async executar(nome, args) {
      chamadas.executar.push({ nome, args });
      return opcoes.executar
        ? opcoes.executar(nome, args)
        : { id: 'r1', paraModelo: '{"ok":true}' };
    },
    async criarBloco(args) {
      chamadas.criarBloco.push(args);
      return opcoes.criarBloco
        ? opcoes.criarBloco(args)
        : { bloco: { id: 'b1', tipo: 'numero', titulo: 'Livre' } };
    },
    async calcular(args) {
      chamadas.calcular.push(args);
      return opcoes.calcular
        ? opcoes.calcular(args)
        : { id: 'c1', paraModelo: '{"total":1}' };
    },
    async marcarTexto(texto) {
      chamadas.marcarTexto.push(texto);
      return opcoes.marcarTexto ? opcoes.marcarTexto(texto) : { texto, semOrigem: [] };
    },
    async reidratar(bloco) {
      chamadas.reidratar.push(bloco);
      return opcoes.reidratar ? opcoes.reidratar(bloco) : bloco;
    },
  };
  return { sessao, chamadas };
}

function modeloFalso(respostas) {
  const chamadas = [];
  const fn = async (pedido) => {
    chamadas.push(structuredClone(pedido));
    if (!respostas.length) throw new Error('modelo falso sem resposta na fila');
    const proxima = respostas.shift();
    if (proxima instanceof Error) throw proxima;
    return structuredClone(proxima);
  };
  fn.chamadas = chamadas;
  return fn;
}

function emissorFalso() {
  const eventos = [];
  const fn = async (nome, dados) => {
    eventos.push({ nome, dados });
    return true;
  };
  fn.eventos = eventos;
  return fn;
}

const chamada = (nome, args = {}, id) => {
  const fn = { name: nome, arguments: args };
  return id ? { id, function: fn } : { function: fn };
};

const texto = (conteudo) => ({ message: { role: 'assistant', content: conteudo } });

describe('tetos do contrato', () => {
  it('são 8 rodadas, 30 ferramentas, 60.000 chars e 120 s', () => {
    expect(TETOS).toEqual({
      rodadas: 8,
      ferramentas: 30,
      resultadoChars: 60_000,
      ms: 120_000,
    });
  });
});

describe('laço completo', () => {
  it('pergunta → listar_centros → criar_bloco → texto, na ordem', async () => {
    const respostas = [
      { message: { role: 'assistant', content: '', tool_calls: [chamada('listar_centros')] } },
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [chamada('criar_bloco', { tipo: 'numero', titulo: 'Livre', no: 'r1.1' })],
        },
      },
      texto('O livre cobre dois meses.'),
    ];

    const { sessao, chamadas } = sessaoFalsa({
      marcarTexto: (t) => ({ texto: `marcado(${t})`, semOrigem: [{ inicio: 0, fim: 4 }] }),
      criarBloco: () => ({ bloco: { id: 'b1', tipo: 'numero' } }),
      reidratar: (b) => ({ ...b, reidratado: true }),
    });
    const emitir = emissorFalso();
    const modelo = modeloFalso(respostas);

    const r = await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir });

    expect(r).toMatchObject({ ok: true, rodadas: 3, ms: 0 });
    expect(emitir.eventos.map((e) => e.nome)).toEqual([
      'passo',
      'passo',
      'passo',
      'passo',
      'bloco',
      'texto',
      'fim',
    ]);
    expect(
      emitir.eventos.filter((e) => e.nome === 'passo').map((e) => e.dados.estado),
    ).toEqual(['inicio', 'fim', 'inicio', 'fim']);

    const bloco = emitir.eventos.find((e) => e.nome === 'bloco');
    expect(bloco.dados).toMatchObject({ id: 'b1', reidratado: true });

    const textoFinal = emitir.eventos.find((e) => e.nome === 'texto');
    expect(textoFinal.dados).toEqual({
      texto: 'marcado(O livre cobre dois meses.)',
      semOrigem: [{ inicio: 0, fim: 4 }],
    });
    expect(chamadas.marcarTexto).toEqual(['O livre cobre dois meses.']);

    // O system leva as instruções e a data; a pergunta é a única mensagem user.
    expect(modelo.chamadas[0].mensagens[0].role).toBe('system');
    expect(modelo.chamadas[0].mensagens[0].content).toContain('INSTRUÇÕES DE TESTE');
    expect(modelo.chamadas[0].mensagens[0].content).toContain('Hoje é 2026-11-25');
    expect(modelo.chamadas[0].mensagens[1]).toEqual({
      role: 'user',
      content: BASE.pergunta,
    });
    expect(modelo.chamadas[0].tools).toEqual(BASE.tools);

    // O resultado da ferramenta volta como role tool, com o nome certo.
    const segunda = modelo.chamadas[1].mensagens;
    expect(segunda.at(-1)).toMatchObject({
      role: 'tool',
      tool_name: 'listar_centros',
      content: '{"ok":true}',
    });
    expect(segunda.at(-2).role).toBe('assistant');
    expect(segunda.at(-2).tool_calls).toHaveLength(1);

    // O recibo do bloco volta ao modelo sem o conteúdo do bloco.
    const terceira = modelo.chamadas[2].mensagens;
    expect(terceira.at(-1)).toMatchObject({
      role: 'tool',
      tool_name: 'criar_bloco',
      content: '{"id":"b1"}',
    });
  });

  it('aceita arguments como string JSON e preserva o tool_call_id', async () => {
    const respostas = [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [chamada('listar_centros', '{"project_id":"30.109"}', 'call_1')],
        },
      },
      texto('ok'),
    ];
    const { sessao, chamadas } = sessaoFalsa();
    const modelo = modeloFalso(respostas);

    await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir: emissorFalso() });

    expect(chamadas.executar[0]).toEqual({
      nome: 'listar_centros',
      args: { project_id: '30.109' },
    });
    expect(modelo.chamadas[1].mensagens.at(-1).tool_call_id).toBe('call_1');
  });

  it('arguments inválido vira erro para o modelo, sem derrubar a conversa', async () => {
    const respostas = [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [chamada('listar_centros', '{quebrado')],
        },
      },
      texto('Não consegui consultar.'),
    ];
    const { sessao, chamadas } = sessaoFalsa();
    const emitir = emissorFalso();
    const modelo = modeloFalso(respostas);

    const r = await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir });

    expect(r.ok).toBe(true);
    expect(chamadas.executar).toHaveLength(0);
    expect(emitir.eventos.map((e) => e.nome)).toEqual(['passo', 'texto', 'fim']);
    expect(emitir.eventos[0].dados.estado).toBe('erro');
    expect(modelo.chamadas[1].mensagens.at(-1).content).toContain('JSON válido');
  });

  it('ferramenta com erro volta ao modelo e a análise segue', async () => {
    const respostas = [
      { message: { role: 'assistant', content: '', tool_calls: [chamada('listar_centros')] } },
      texto('O centro não está no seu acesso.'),
    ];

    const { sessao } = sessaoFalsa({
      executar: () => ({ id: 'r1', erro: 'Centro não encontrado no seu acesso.' }),
    });
    const emitir = emissorFalso();
    const modelo = modeloFalso(respostas);

    const r = await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir });

    expect(r.ok).toBe(true);
    expect(emitir.eventos.map((e) => e.nome)).toEqual([
      'passo',
      'passo',
      'texto',
      'fim',
    ]);
    expect(emitir.eventos[1].dados.estado).toBe('erro');
    expect(emitir.eventos[1].dados.erro).toContain('não encontrado');
    expect(modelo.chamadas[1].mensagens.at(-1).content).toContain('não encontrado');
  });

  it('bloco recusado volta como erro e não vira evento bloco', async () => {
    const respostas = [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [chamada('criar_bloco', { tipo: 'numero', no: 'r9.1' })],
        },
      },
      texto('Não há esse dado.'),
    ];
    const { sessao, chamadas } = sessaoFalsa({
      criarBloco: () => ({ erro: 'A ref r9.1 não existe.' }),
    });
    const emitir = emissorFalso();
    const modelo = modeloFalso(respostas);

    const r = await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir });

    expect(r.ok).toBe(true);
    expect(emitir.eventos.map((e) => e.nome)).not.toContain('bloco');
    expect(emitir.eventos[1].dados.estado).toBe('erro');
    expect(chamadas.reidratar).toHaveLength(0);
    expect(modelo.chamadas[1].mensagens.at(-1).content).toContain('não existe');
  });

  it('calcular volta para o modelo e só o criar_bloco gera bloco', async () => {
    const respostas = [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [chamada('calcular', { op: 'soma', refs: ['r1.1'] })],
        },
      },
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [chamada('criar_bloco', { tipo: 'numero', no: 'c1.1' })],
        },
      },
      texto('A soma está no bloco.'),
    ];
    const { sessao, chamadas } = sessaoFalsa({
      calcular: () => ({ id: 'c1', paraModelo: '{"total":123}' }),
    });
    const emitir = emissorFalso();
    const modelo = modeloFalso(respostas);

    await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir });

    expect(chamadas.calcular).toEqual([{ op: 'soma', refs: ['r1.1'] }]);
    expect(modelo.chamadas[1].mensagens.at(-1)).toMatchObject({
      role: 'tool',
      tool_name: 'calcular',
      content: '{"total":123}',
    });
    expect(emitir.eventos.filter((e) => e.nome === 'bloco')).toHaveLength(1);
  });

  it('resumo das perguntas anteriores entra no system, limitado a 5', async () => {
    const { sessao } = sessaoFalsa();
    const modelo = modeloFalso([texto('ok')]);
    const anteriores = Array.from({ length: 6 }, (_, i) => ({
      pergunta: `pergunta ${i + 1}`,
      resumo: `resumo ${i + 1}`,
    }));

    await executarLaco({
      ...BASE,
      sessao,
      chamarModelo: modelo,
      emitir: emissorFalso(),
      anteriores,
    });

    const sistema = modelo.chamadas[0].mensagens[0].content;
    expect(sistema).toContain('pergunta 1');
    expect(sistema).toContain('resumo 5');
    expect(sistema).not.toContain('pergunta 6');
    expect(modelo.chamadas[0].mensagens).toHaveLength(2);
  });
});

describe('tetos e falhas', () => {
  it('modelo em laço infinito para no teto de rodadas', async () => {
    const respostas = Array.from({ length: 20 }, () => ({
      message: { role: 'assistant', content: '', tool_calls: [chamada('listar_centros')] },
    }));
    const { sessao } = sessaoFalsa();
    const emitir = emissorFalso();
    const modelo = modeloFalso(respostas);

    const r = await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir });

    expect(modelo.chamadas).toHaveLength(8);
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('interno');
    const nomes = emitir.eventos.map((e) => e.nome);
    expect(nomes.at(-2)).toBe('erro');
    expect(nomes.at(-1)).toBe('fim');
    expect(nomes).not.toContain('texto');
    expect(emitir.eventos.at(-2).dados.mensagem).toContain('8 rodadas');
  });

  it('com bloco emitido, esgotar as rodadas vira erro incompleta com a mensagem fixa', async () => {
    const respostas = [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [chamada('criar_bloco', { tipo: 'texto', texto: 'ok' })],
        },
      },
      ...Array.from({ length: 20 }, () => ({
        message: { role: 'assistant', content: '', tool_calls: [chamada('listar_centros')] },
      })),
    ];
    const { sessao } = sessaoFalsa();
    const emitir = emissorFalso();
    const modelo = modeloFalso(respostas);

    const r = await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir });

    expect(modelo.chamadas).toHaveLength(8);
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('incompleta');
    const nomes = emitir.eventos.map((e) => e.nome);
    expect(nomes).toContain('bloco');
    expect(nomes).not.toContain('texto');
    expect(emitir.eventos.at(-2)).toEqual({
      nome: 'erro',
      dados: {
        codigo: 'incompleta',
        mensagem:
          'A resposta ficou incompleta: parei em 8 rodadas. Os blocos acima estão certos; ' +
          'para o resto, faça uma pergunta mais específica.',
      },
    });
    expect(nomes.at(-1)).toBe('fim');
  });

  it('bloco que o emissor recusou não conta: esgotar as rodadas continua interno', async () => {
    const respostas = [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [chamada('criar_bloco', { tipo: 'texto', texto: 'ok' })],
        },
      },
      ...Array.from({ length: 20 }, () => ({
        message: { role: 'assistant', content: '', tool_calls: [chamada('listar_centros')] },
      })),
    ];
    const { sessao } = sessaoFalsa();
    const eventos = [];
    const emitir = async (nome, dados) => {
      eventos.push({ nome, dados });
      return nome !== 'bloco';
    };
    const modelo = modeloFalso(respostas);

    const r = await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir });

    expect(r.codigo).toBe('interno');
    expect(eventos.find((e) => e.nome === 'erro').dados.codigo).toBe('interno');
  });

  it('resultado acima de 60.000 chars volta erro curto ao modelo', async () => {
    const gigante = 'x'.repeat(60_001);
    const respostas = [
      { message: { role: 'assistant', content: '', tool_calls: [chamada('listar_centros')] } },
      texto('Pedirei um recorte menor.'),
    ];
    const { sessao } = sessaoFalsa({
      executar: () => ({ id: 'r1', paraModelo: gigante }),
    });
    const emitir = emissorFalso();
    const modelo = modeloFalso(respostas);

    const r = await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir });

    expect(r.ok).toBe(true);
    expect(emitir.eventos[1].dados.estado).toBe('erro');
    expect(emitir.eventos[1].dados.erro).toContain('Resultado grande demais');
    const devolvido = modelo.chamadas[1].mensagens.at(-1).content;
    expect(devolvido).toContain('"teto_chars":60000');
    expect(devolvido.length).toBeLessThan(1_000);
    expect(JSON.stringify(modelo.chamadas[1].mensagens)).not.toContain('x'.repeat(1_000));
  });

  it('erro do modelo vira evento erro modelo e fim', async () => {
    const { sessao } = sessaoFalsa();
    const emitir = emissorFalso();

    const r = await executarLaco({
      ...BASE,
      sessao,
      chamarModelo: async () => {
        throw new ErroModelo('O modelo respondeu HTTP 500.', 'modelo');
      },
      emitir,
    });

    expect(r.ok).toBe(false);
    expect(emitir.eventos.map((e) => e.nome)).toEqual(['erro', 'fim']);
    expect(emitir.eventos[0].dados.codigo).toBe('modelo');
  });

  it('timeout do modelo vira erro tempo', async () => {
    const { sessao } = sessaoFalsa();
    const emitir = emissorFalso();

    await executarLaco({
      ...BASE,
      sessao,
      chamarModelo: async () => {
        throw new ErroModelo('demorou', 'tempo');
      },
      emitir,
    });

    expect(emitir.eventos[0].dados.codigo).toBe('tempo');
  });

  it('estouro do tempo total vira erro tempo e fim', async () => {
    let relogio = 0;
    const agora = () => {
      const valor = relogio;
      relogio += 61_000;
      return valor;
    };
    const { sessao } = sessaoFalsa();
    const emitir = emissorFalso();
    const modelo = modeloFalso([
      { message: { role: 'assistant', content: '', tool_calls: [chamada('listar_centros')] } },
    ]);

    const r = await executarLaco({
      ...BASE,
      agora,
      sessao,
      chamarModelo: modelo,
      emitir,
    });

    expect(r.ok).toBe(false);
    expect(emitir.eventos[0].dados.codigo).toBe('tempo');
    expect(emitir.eventos.at(-1).nome).toBe('fim');
  });

  it('cliente que desconectou para o laço sem erro na tela', async () => {
    const { sessao, chamadas } = sessaoFalsa();
    const controle = new AbortController();
    const eventos = [];
    const emitir = async (nome) => {
      eventos.push(nome);
      controle.abort();
      return false;
    };
    const modelo = modeloFalso([
      { message: { role: 'assistant', content: '', tool_calls: [chamada('listar_centros')] } },
    ]);

    const r = await executarLaco({
      ...BASE,
      sessao,
      chamarModelo: modelo,
      emitir,
      sinal: controle.signal,
    });

    expect(r.abortado).toBe(true);
    expect(chamadas.executar).toHaveLength(0);
    expect(eventos).not.toContain('texto');
    expect(eventos).not.toContain('fim');
  });
});

describe('2ª rodada: prazo, texto vazio e erros longos', () => {
  it('resposta do modelo que chega depois do prazo não vira texto', async () => {
    let relogio = 1_000;
    const { sessao, chamadas } = sessaoFalsa();
    const emitir = emissorFalso();

    const r = await executarLaco({
      ...BASE,
      inicio: 1_000,
      prazo: 121_000,
      agora: () => relogio,
      sessao,
      chamarModelo: async () => {
        relogio = 125_000; // a resposta chegou depois do prazo
        return { message: { role: 'assistant', content: 'texto atrasado' } };
      },
      emitir,
    });

    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('tempo');
    expect(emitir.eventos.map((e) => e.nome)).toEqual(['erro', 'fim']);
    expect(emitir.eventos.some((e) => e.nome === 'texto')).toBe(false);
    expect(chamadas.marcarTexto).toHaveLength(0);
  });

  it('content vazio ou só espaços vira erro modelo, não texto vazio', async () => {
    const { sessao, chamadas } = sessaoFalsa();
    const emitir = emissorFalso();

    const r = await executarLaco({
      ...BASE,
      sessao,
      chamarModelo: modeloFalso([texto('   ')]),
      emitir,
    });

    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('modelo');
    expect(emitir.eventos.map((e) => e.nome)).toEqual(['erro', 'fim']);
    expect(emitir.eventos[0].dados.mensagem).toContain('não respondeu');
    expect(chamadas.marcarTexto).toHaveLength(0);
  });

  it('content que não é string vira erro modelo, não [object Object]', async () => {
    for (const valor of [{}, 42, []]) {
      const { sessao, chamadas } = sessaoFalsa();
      const emitir = emissorFalso();

      const r = await executarLaco({
        ...BASE,
        sessao,
        chamarModelo: modeloFalso([texto(valor)]),
        emitir,
      });

      expect(r.ok).toBe(false);
      expect(r.codigo).toBe('modelo');
      expect(emitir.eventos.some((e) => e.nome === 'texto')).toBe(false);
      expect(chamadas.marcarTexto).toHaveLength(0);
    }
  });

  it('content inválido com tool_calls vira erro modelo antes de executar', async () => {
    const { sessao, chamadas } = sessaoFalsa();
    const emitir = emissorFalso();

    const r = await executarLaco({
      ...BASE,
      sessao,
      chamarModelo: modeloFalso([
        {
          message: {
            role: 'assistant',
            content: {},
            tool_calls: [chamada('listar_centros')],
          },
        },
      ]),
      emitir,
    });

    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('modelo');
    expect(chamadas.executar).toHaveLength(0);
    expect(emitir.eventos.some((e) => e.nome === 'passo')).toBe(false);
  });

  it('content nulo com tool_calls continua válido', async () => {
    const { sessao, chamadas } = sessaoFalsa();
    const emitir = emissorFalso();

    const r = await executarLaco({
      ...BASE,
      sessao,
      chamarModelo: modeloFalso([
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [chamada('listar_centros')],
          },
        },
        texto('ok'),
      ]),
      emitir,
    });

    expect(r.ok).toBe(true);
    expect(chamadas.executar).toHaveLength(1);
  });

  it('marcarTexto com formato inválido vira erro interno', async () => {
    const { sessao } = sessaoFalsa({
      marcarTexto: () => ({ texto: 'ok', semOrigem: 'nada' }),
    });
    const emitir = emissorFalso();

    const r = await executarLaco({
      ...BASE,
      sessao,
      chamarModelo: modeloFalso([texto('ok')]),
      emitir,
    });

    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('interno');
    expect(emitir.eventos.map((e) => e.nome)).toEqual(['erro', 'fim']);
    expect(emitir.eventos.some((e) => e.nome === 'texto')).toBe(false);
  });

  it('erro de ferramenta (inclusive exceção) é cortado em 500 caracteres', async () => {
    const longo = 'e'.repeat(1_000);
    const { sessao } = sessaoFalsa({
      executar: (nome) => {
        if (nome === 'listar_centros') throw new Error(longo);
        return { id: 'r2', erro: longo };
      },
    });
    const emitir = emissorFalso();
    const modelo = modeloFalso([
      { message: { role: 'assistant', content: '', tool_calls: [chamada('listar_centros')] } },
      { message: { role: 'assistant', content: '', tool_calls: [chamada('explicar_livre')] } },
      texto('ok'),
    ]);

    const r = await executarLaco({ ...BASE, sessao, chamarModelo: modelo, emitir });

    expect(r.ok).toBe(true);
    const passosErro = emitir.eventos.filter(
      (e) => e.nome === 'passo' && e.dados.estado === 'erro',
    );
    expect(passosErro).toHaveLength(2);
    for (const passo of passosErro) {
      expect(passo.dados.erro.length).toBeLessThanOrEqual(500);
      expect(passo.dados.erro.endsWith('…')).toBe(true);
    }
    for (const chamadaModelo of [modelo.chamadas[1], modelo.chamadas[2]]) {
      const erroDevolvido = JSON.parse(chamadaModelo.mensagens.at(-1).content).erro;
      expect(erroDevolvido.length).toBeLessThanOrEqual(500);
      expect(erroDevolvido.endsWith('…')).toBe(true);
    }
  });
});

describe('nenhum conteúdo no console', () => {
  it('pergunta, argumentos, resultado, bloco e texto não aparecem em console.*', async () => {
    const espioes = ['log', 'info', 'warn', 'error', 'debug'].map((metodo) =>
      vi.spyOn(console, metodo).mockImplementation(() => {}),
    );

    try {
      const respostas = [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [chamada('listar_centros', { q: 'ARGUMENTO-SECRETO' })],
          },
        },
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [chamada('criar_bloco', { titulo: 'BLOCO-SECRETO' })],
          },
        },
        texto('TEXTO-SECRETO'),
      ];
      const { sessao } = sessaoFalsa({
        executar: () => ({ id: 'r1', paraModelo: '{"dado":"RESULTADO-SECRETO"}' }),
        criarBloco: () => ({ bloco: { id: 'b1', titulo: 'BLOCO-SECRETO' } }),
        marcarTexto: (t) => ({ texto: t, semOrigem: [] }),
      });

      const r = await executarLaco({
        ...BASE,
        pergunta: 'PERGUNTA-SECRETA',
        sessao,
        chamarModelo: modeloFalso(respostas),
        emitir: emissorFalso(),
      });
      expect(r.ok).toBe(true);

      const tudo = espioes
        .flatMap((espiao) => espiao.mock.calls)
        .flat()
        .map((valor) => {
          if (typeof valor === 'string') return valor;
          try {
            return JSON.stringify(valor);
          } catch {
            return String(valor);
          }
        })
        .join('\n');

      for (const segredo of [
        'PERGUNTA-SECRETA',
        'ARGUMENTO-SECRETO',
        'RESULTADO-SECRETO',
        'BLOCO-SECRETO',
        'TEXTO-SECRETO',
      ]) {
        expect(tudo).not.toContain(segredo);
      }
    } finally {
      for (const espiao of espioes) espiao.mockRestore();
    }
  });
});
