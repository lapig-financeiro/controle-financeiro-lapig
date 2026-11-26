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
  const chamadas = [];
  const rpc = async (nome, args) => {
    chamadas.push({ nome, args });
    const resposta = respostas[nome];
    if (typeof resposta === 'function') return resposta(args);
    return resposta ?? { data: null, error: { message: `sem fixture: ${nome}` } };
  };
  return { sessao: criarSessao({ rpc, hoje: '2026-11-25' }), chamadas };
}

const PII = [
  'Pessoa Exemplo Um',
  'Pessoa Exemplo Dois',
  'Pessoa Exemplo Fora',
  'Pessoa Um',
  'Pessoa Dois',
  '123.456.789-09',
  '12345678909',
  '98765432100',
  '987.654.321-00',
  'pessoa.exemplo@exemplo.test',
  'pessoa.dois@exemplo.test',
];

describe('máscara de nomes', () => {
  it('marca nome completo e primeiro + último com o mesmo ⟦Pn⟧', async () => {
    const { sessao } = montar();
    await sessao.executar('pendencias', { project_id: '30.901' });
    const marcado = sessao.marcarTexto('Pessoa Exemplo Um e Pessoa Um.');
    expect(marcado.texto).not.toContain('Pessoa Exemplo Um');
    expect(marcado.texto).not.toContain('Pessoa Um');
    expect(marcado.texto).toContain('⟦P1⟧ e ⟦P1⟧');
  });

  it('nomes diferentes recebem marcadores diferentes e estáveis', async () => {
    const { sessao } = montar();
    await sessao.executar('pendencias', { project_id: '30.901' });
    const um = sessao.marcarTexto('Pessoa Exemplo Um');
    const dois = sessao.marcarTexto('Pessoa Exemplo Dois');
    const outraVez = sessao.marcarTexto('Pessoa Exemplo Um');
    expect(um.texto).toBe('⟦P1⟧');
    expect(dois.texto).toBe('⟦P2⟧');
    expect(outraVez.texto).toBe('⟦P1⟧');
  });

  it('normaliza NBSP, tab, dois espaços, maiúsculas e acentos', async () => {
    const { sessao } = montar();
    await sessao.executar('pendencias', { project_id: '30.901' });
    const marcado = sessao.marcarTexto(
      'PESSOA\u00a0EXEMPLO\tUM e Pessoa  Exemplo Um; pessoa exemplo um'
    );
    expect(marcado.texto).not.toContain('Pessoa');
    expect(marcado.texto).not.toContain('PESSOA');
    expect(marcado.texto.match(/⟦P\d+⟧/g)).toHaveLength(3);
  });

  it('compara sem acento nos dois sentidos', async () => {
    const pedido = fixture('pedido_bolsas');
    pedido.bolsistas[0].nome = 'João Exemplo';
    const { sessao } = montar({ get_pedido_bolsas_v2: { data: pedido, error: null } });
    await sessao.executar('pendencias', { project_id: '30.901' });
    const exato = sessao.marcarTexto('João Exemplo').texto;
    const marcado = sessao.marcarTexto('JOAO EXEMPLO');
    expect(exato).toMatch(/^⟦P\d+⟧$/);
    expect(marcado.texto).toBe(exato);
  });
});

describe('máscara — conferência final da 4ª rodada', () => {
  it('emoji antes do nome não desloca o corte', async () => {
    const { sessao } = montar();
    await sessao.executar('pendencias', { project_id: '30.901' });
    const marcado = sessao.marcarTexto('📋 Pessoa Exemplo Um 📋 e 👩‍🔬 Pessoa Exemplo Dois');
    expect(marcado.texto).toBe('📋 ⟦P1⟧ 📋 e 👩‍🔬 ⟦P2⟧');
  });

  it('acento decomposto antes do nome não deixa pedaço do nome', async () => {
    const { sessao } = montar();
    await sessao.executar('pendencias', { project_id: '30.901' });
    const marcado = sessao.marcarTexto('Café com Pessoa Exemplo Um.');
    expect(marcado.texto).not.toMatch(/Pessoa|Exemplo|Um/);
    expect(marcado.texto).toContain('⟦P1⟧.');
  });

  it('nome curto de outra pessoa dentro do nome completo sem acento não deixa pedaço', async () => {
    const pedido = fixture('pedido_bolsas');
    pedido.bolsistas[0].nome = 'João Pedro Silva';
    pedido.bolsistas[1].nome = 'Pedro Silva';
    const { sessao } = montar({ get_pedido_bolsas_v2: { data: pedido, error: null } });
    await sessao.executar('pendencias', { project_id: '30.901' });
    const comAcento = sessao.marcarTexto('Caixa de João Pedro Silva.').texto;
    const um = sessao.marcarTexto('Caixa de Joao Pedro Silva.').texto;
    expect(um).toBe(comAcento);
    expect(um).toMatch(/^Caixa de ⟦P\d+⟧\.$/);
    const dois = sessao.marcarTexto('Pedro Silva').texto;
    expect(dois).toMatch(/^⟦P\d+⟧$/);
    expect(dois).not.toBe(um.match(/⟦P\d+⟧/)[0]);
  });

  it('nome entre chaves é mascarado (bordas por classe Unicode)', async () => {
    const { sessao } = montar();
    await sessao.executar('pendencias', { project_id: '30.901' });
    expect(sessao.marcarTexto('Caixa {Pessoa Exemplo Um}').texto).toBe('Caixa {⟦P1⟧}');
  });

  it('trecho mais longo que cruza dois nomes não deixa pedaço do primeiro', async () => {
    const pedido = fixture('pedido_bolsas');
    pedido.bolsistas[0].nome = 'Maria Inês';
    pedido.bolsistas[1].nome = 'Ana Paula';
    pedido.bolsistas.push({ ...pedido.bolsistas[1], nome: 'Ines Ana Paula' });
    const { sessao } = montar({ get_pedido_bolsas_v2: { data: pedido, error: null } });
    await sessao.executar('pendencias', { project_id: '30.901' });
    const marcado = sessao.marcarTexto('Maria Inês' + String.fromCharCode(10) + 'Ana Paula').texto;
    expect(marcado).not.toMatch(/Maria|Inês|Ines|Ana|Paula/);
    const marcadores = marcado.match(/⟦P\d+⟧/g);
    expect(marcadores).toHaveLength(2);
    expect(marcadores[0]).not.toBe(marcadores[1]);
  });

  it('sobra de nome que perdeu a disputa também é mascarada', async () => {
    const pedido = fixture('pedido_bolsas');
    pedido.bolsistas[0].nome = 'Ana Paula Souza';
    pedido.bolsistas[1].nome = 'Paula Souza Lima';
    const { sessao } = montar({ get_pedido_bolsas_v2: { data: pedido, error: null } });
    await sessao.executar('pendencias', { project_id: '30.901' });
    const marcado = sessao.marcarTexto('Ana Paula Souza Lima').texto;
    expect(marcado).not.toMatch(/Ana|Paula|Souza|Lima/);
  });

  it('nomes que só diferem no acento são duas pessoas', async () => {
    const pedido = fixture('pedido_bolsas');
    pedido.bolsistas[0].nome = 'Joao Exemplo';
    pedido.bolsistas[1].nome = 'João Exemplo';
    const { sessao } = montar({ get_pedido_bolsas_v2: { data: pedido, error: null } });
    await sessao.executar('pendencias', { project_id: '30.901' });
    const sem = sessao.marcarTexto('Joao Exemplo').texto;
    const com = sessao.marcarTexto('João Exemplo').texto;
    expect(sem).toMatch(/^⟦P\d+⟧$/);
    expect(com).toMatch(/^⟦P\d+⟧$/);
    expect(sem).not.toBe(com);
    expect(sessao.reidratar({ tipo: 'texto', texto: `${sem} e ${com}`, semOrigem: [] }).texto).toBe(
      'Joao Exemplo e João Exemplo'
    );
  });
});

describe('CPF e e-mail', () => {
  it('saem do texto com e sem pontuação', async () => {
    const { sessao } = montar();
    const marcado = sessao.marcarTexto(
      'CPF 123.456.789-09, CPF 12345678909, e-mail pessoa.exemplo@exemplo.test.'
    );
    expect(marcado.texto).not.toContain('123.456.789-09');
    expect(marcado.texto).not.toContain('12345678909');
    expect(marcado.texto).not.toContain('pessoa.exemplo@exemplo.test');
  });

  it('mascara CPF com espaço, ponto, hífen e barra', async () => {
    const { sessao } = montar();
    for (const cpf of ['123.456.789-09', '12345678909', '123 456 789 09', '123/456/789/09', '123-456-789-09']) {
      const marcado = sessao.marcarTexto(`CPF ${cpf}.`);
      expect(marcado.texto, cpf).not.toContain('123');
      expect(marcado.texto, cpf).toContain('***.***.***-**');
    }
  });
});

describe('árvore de bolsas', () => {
  it('mascara o nome pelo alvo_id mesmo com dicionário vazio', async () => {
    const { sessao } = montar({
      get_pedido_bolsas_v2: { data: { bolsistas: [] }, error: null },
    });
    const resultado = await sessao.executar('explicar_livre', { project_id: '30.901' });
    expect(resultado.erro).toBeUndefined();
    expect(resultado.paraModelo).not.toContain('Pessoa Exemplo Um');
    expect(resultado.paraModelo).not.toContain('Pessoa Exemplo Dois');

    const dados = JSON.parse(resultado.paraModelo);
    const compromisso = dados.nos.find((no) => no.rotulo.includes('11 meses × R$ 4.200,00'));
    const folha = dados.nos.find((no) => no.rotulo.includes('1 mês × R$ 4.000,00'));
    expect(compromisso.rotulo).toMatch(/^⟦P\d+⟧ — 11 meses/);
    expect(folha.rotulo).toMatch(/^⟦P\d+⟧ — 1 mês/);
    expect(compromisso.rotulo.split(' — ')[0]).toBe(folha.rotulo.split(' — ')[0]);
  });

  it('reconstrói o rótulo pelo sufixo e não vaza nome com " — "', async () => {
    const arvore = {
      rotulo: 'Livre',
      valor: 1,
      tipo: 'calculo',
      chave: 'livre',
      partes: [
        {
          rotulo: 'Pessoa — Exemplo Um — 11 meses × R$ 4.200,00',
          valor: 46200,
          tipo: 'digitado',
          chave: 'linha:b-1',
          ref: { alvo_tabela: 'scholarships', alvo_id: 'alvo-1', campo: 'amount' },
          partes: [],
        },
        {
          rotulo: 'Pessoa — Exemplo Dois',
          valor: 1,
          tipo: 'digitado',
          chave: 'linha:b-2',
          ref: { alvo_tabela: 'scholarships', alvo_id: 'alvo-2', campo: 'amount' },
          partes: [],
        },
      ],
    };
    const { sessao } = montar({
      get_pedido_bolsas_v2: { data: { bolsistas: [] }, error: null },
      explicar_livre_v2: { data: arvore, error: null },
    });
    const resultado = await sessao.executar('explicar_livre', { project_id: '30.901' });
    expect(resultado.erro).toBeUndefined();
    expect(resultado.paraModelo).not.toContain('Exemplo Um');
    expect(resultado.paraModelo).not.toContain('Exemplo Dois');

    const dados = JSON.parse(resultado.paraModelo);
    const primeiro = dados.nos.find((no) => no.rotulo.includes('11 meses × R$ 4.200,00'));
    const marcaPrimeiro = primeiro.rotulo.split(' — ')[0];
    const segundo = dados.nos.find(
      (no) => /^⟦P\d+⟧$/.test(no.rotulo) && no.rotulo !== marcaPrimeiro
    );
    expect(primeiro.rotulo).toMatch(/^⟦P\d+⟧ — 11 meses × R\$ 4\.200,00$/);
    expect(segundo).toBeTruthy();
  });
});

describe('reidratar', () => {
  it('troca ⟦Pn⟧ só no bloco e não mexe no paraModelo', async () => {
    const { sessao } = montar();
    const resultado = await sessao.executar('bolsas', { project_id: '30.901' });
    expect(resultado.paraModelo).toContain('⟦P1⟧');
    expect(resultado.paraModelo).not.toContain('Pessoa Exemplo Um');

    const bloco = {
      id: 'b1',
      tipo: 'texto',
      titulo: '',
      texto: { texto: 'Bolsista ⟦P1⟧', semOrigem: [] },
    };
    const reidratado = sessao.reidratar(bloco);
    expect(reidratado.texto.texto).toBe('Bolsista Pessoa Exemplo Um');
    expect(bloco.texto.texto).toBe('Bolsista ⟦P1⟧');
  });
});

describe('todo paraModelo', () => {
  it('não contém nome, CPF nem e-mail dos fixtures', async () => {
    const { sessao } = montar();
    const saidas = [];
    const chamadas = [
      ['listar_centros', {}],
      ['explicar_livre', { project_id: '30.901' }],
      ['situacao_centro', { project_id: '30.901' }],
      ['desembolsos', { project_id: '30.901' }],
      ['termos_contrato', { project_id: '30.901' }],
      ['pendencias', { project_id: '30.902' }],
      ['bolsas', { project_id: '30.901' }],
    ];
    for (const [nome, argumentos] of chamadas) {
      const resultado = await sessao.executar(nome, argumentos);
      expect(resultado.erro, nome).toBeUndefined();
      saidas.push({ nome, texto: resultado.paraModelo });
    }

    const listar = JSON.parse(saidas[0].texto);
    const livro = listar.nos.find((no) => no.rotulo.includes('Livre — Centro Exemplo Um'));
    const calculo = sessao.calcular({ op: 'soma', ids: [livro.id, livro.id] });
    saidas.push({ nome: 'calcular', texto: calculo.paraModelo });

    for (const pii of PII) {
      for (const saida of saidas) {
        expect(saida.texto, `${saida.nome} vazou ${pii}`).not.toContain(pii);
      }
    }
    expect(saidas.find((saida) => saida.nome === 'bolsas').texto).toContain('⟦P1⟧');
  });

  it('carrega o dicionário uma vez por sessão', async () => {
    const { sessao, chamadas } = montar();
    await sessao.executar('pendencias', { project_id: '30.901' });
    await sessao.executar('listar_centros', {});
    await sessao.executar('explicar_livre', { project_id: '30.901' });
    const pedidos = chamadas.filter((chamada) => chamada.nome === 'get_pedido_bolsas_v2');
    expect(pedidos).toHaveLength(1);
  });

  it('a ferramenta bolsas já carrega o dicionário e evita a segunda chamada', async () => {
    const { sessao, chamadas } = montar();
    await sessao.executar('bolsas', { project_id: '30.901' });
    await sessao.executar('pendencias', { project_id: '30.901' });
    const pedidos = chamadas.filter((chamada) => chamada.nome === 'get_pedido_bolsas_v2');
    expect(pedidos).toHaveLength(1);
  });

  it('falha fechada quando o dicionário não carrega', async () => {
    const { sessao } = montar({
      get_pedido_bolsas_v2: { data: null, error: { message: 'sem acesso ao pedido' } },
    });
    const resultado = await sessao.executar('pendencias', { project_id: '30.901' });
    expect(resultado.erro).toBe(
      'Não foi possível carregar a lista de pessoas para proteger os nomes. (http_4xx)'
    );
    expect(resultado.paraModelo).toBeUndefined();
  });

  it('erro de RPC não leva PII ao modelo, mesmo sem dicionário', async () => {
    const { sessao } = montar({
      get_termos_contrato_v2: {
        data: null,
        error: { status: 400, message: 'Falha para Pessoa Exemplo Um, CPF 123.456.789-09' },
      },
    });
    const resultado = await sessao.executar('termos_contrato', { project_id: '30.901' });
    expect(resultado.erro).toBe('Não foi possível carregar os termos do contrato. (http_4xx)');
    expect(resultado.erro).not.toContain('Pessoa');
    expect(resultado.erro).not.toContain('123');
  });

  it('timeout vira código tempo, sem texto bruto', async () => {
    const { sessao } = montar({
      listar_pendencias_v2: { data: null, error: { name: 'AbortError', message: 'timeout de 120s' } },
    });
    const resultado = await sessao.executar('pendencias', { project_id: '30.901' });
    expect(resultado.erro).toBe('Não foi possível carregar as pendências. (tempo)');
  });

  it('rejeição externa do dicionário não passa código nem mensagem', async () => {
    const { sessao } = montar({
      get_pedido_bolsas_v2: () => {
        const erro = new Error('Nome Sintético Fora');
        erro.codigo = 'http_4xx';
        erro.mensagemFixa = 'Nome Sintético Fora';
        return Promise.reject(erro);
      },
    });
    const resultado = await sessao.executar('pendencias', { project_id: '30.901' });
    expect(resultado.erro).toBe(
      'Não foi possível carregar a lista de pessoas para proteger os nomes. (http_4xx)'
    );
    expect(resultado.erro).not.toContain('Nome Sintético Fora');
    expect(resultado.erro).not.toContain('http_4xx (http_4xx)');
  });

  it('a varredura de PII vale começando por termos_contrato', async () => {
    const { sessao } = montar();
    const saidas = [];
    for (const [nome, argumentos] of [
      ['termos_contrato', { project_id: '30.901' }],
      ['pendencias', { project_id: '30.902' }],
      ['bolsas', { project_id: '30.901' }],
      ['explicar_livre', { project_id: '30.901' }],
    ]) {
      const resultado = await sessao.executar(nome, argumentos);
      expect(resultado.erro, nome).toBeUndefined();
      saidas.push({ nome, texto: resultado.paraModelo });
    }
    for (const pii of PII) {
      for (const saida of saidas) {
        expect(saida.texto, `${saida.nome} vazou ${pii}`).not.toContain(pii);
      }
    }
  });
});

describe('máscara — nenhum pedaço de nome fica à vista', () => {
  function semAcento(palavra) {
    return palavra.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  async function sessaoCom(nomes) {
    const pedido = fixture('pedido_bolsas');
    const base = pedido.bolsistas[0];
    pedido.bolsistas = nomes.map((nome, indice) => ({ ...base, id: `pessoa-${indice}`, nome }));
    const { sessao } = montar({ get_pedido_bolsas_v2: { data: pedido, error: null } });
    await sessao.executar('pendencias', { project_id: '30.901' });
    return sessao;
  }

  it('cadeia de três nomes sobrepostos (caso da 4ª conferência curta)', async () => {
    const sessao = await sessaoCom([
      'Ana Beatriz Camila Daniela Elisa Fernanda',
      'Camila Daniela Elisa Fernanda Gabriela',
      'Fernanda Gabriela Helena',
    ]);
    const marcado = sessao.marcarTexto(
      'Ana Beatriz Camila Daniela Elisa Fernanda Gabriela Helena'
    ).texto;
    expect(marcado.replace(/⟦P\d+⟧/g, '')).not.toMatch(/[A-Za-z]/);
  });

  it('dicionários e textos aleatórios: só sobra palavra que não faz parte de nome achado', async () => {
    const POOL = ['Ana', 'Inês', 'Ines', 'Paula', 'João', 'Joao', 'Lima', 'Souza', 'Maria'];
    let semente = 20261125;
    const sorteio = (n) => {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      return semente % n;
    };
    for (let rodada = 0; rodada < 1500; rodada += 1) {
      const nomes = [];
      const quantos = 1 + sorteio(4);
      for (let i = 0; i < quantos; i += 1) {
        const tamanho = 2 + sorteio(3);
        nomes.push(Array.from({ length: tamanho }, () => POOL[sorteio(POOL.length)]).join(' '));
      }
      const sessao = await sessaoCom(nomes);
      const palavras = Array.from({ length: 4 + sorteio(8) }, () => POOL[sorteio(POOL.length)]);

      // Referência: o dicionário inteiro (nome completo e primeiro + último de
      // nome com 3+ palavras), comparado sem acento e por palavra inteira.
      const chaves = new Set();
      for (const nome of nomes) {
        const partes = nome.split(' ');
        chaves.add(partes.map(semAcento).join(' '));
        if (partes.length > 2) chaves.add(`${semAcento(partes[0])} ${semAcento(partes[partes.length - 1])}`);
      }
      const marcada = new Array(palavras.length).fill(false);
      for (const chave of chaves) {
        const n = chave.split(' ').length;
        for (let i = 0; i + n <= palavras.length; i += 1) {
          if (palavras.slice(i, i + n).map(semAcento).join(' ') === chave) {
            for (let j = i; j < i + n; j += 1) marcada[j] = true;
          }
        }
      }
      const esperado = palavras.filter((_, i) => !marcada[i]).sort();
      const saida = sessao.marcarTexto(palavras.join(' ')).texto;
      const restantes = saida.replace(/⟦P\d+⟧/g, ' ').split(/\s+/).filter(Boolean).sort();
      expect(restantes, `nomes=${JSON.stringify(nomes)} texto="${palavras.join(' ')}" saída="${saida}"`).toEqual(esperado);
    }
   }, 30000);
});
