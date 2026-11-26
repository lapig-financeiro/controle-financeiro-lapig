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

function montar() {
  const respostas = {
    resumo_projetos_v2: { data: fixture('resumo_projetos'), error: null },
    explicar_livre_v2: { data: fixture('explicar_livre'), error: null },
    get_pedido_bolsas_v2: { data: fixture('pedido_bolsas'), error: null },
  };
  return criarSessao({
    rpc: async (nome) => respostas[nome] ?? { data: null, error: { message: `sem fixture: ${nome}` } },
    hoje: '2026-11-25',
  });
}

async function dadosDosCentros(sessao) {
  return JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
}

function porRotulo(dados, parte) {
  const no = dados.nos.find((item) => item.rotulo.includes(parte));
  expect(no, `nó "${parte}"`).toBeTruthy();
  return no;
}

describe('criarBloco numero', () => {
  it('monta o bloco com valor, unidade, rotulo, origem e contexto', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const nome = porRotulo(dados, 'Nome do centro 30.901');
    const bloco = sessao.criarBloco({
      tipo: 'numero',
      titulo: 'Livre do 30.901',
      no: livre.id,
      contexto: nome.id,
    }).bloco;
    expect(bloco.id).toBe('b1');
    expect(bloco.tipo).toBe('numero');
    expect(bloco.numero.valor).toBe(84300);
    expect(bloco.numero.unidade).toBe('moeda');
    expect(bloco.numero.rotulo).toBe('Livre — Centro Exemplo Um (30.901)');
    expect(bloco.numero.origem.tipo).toBe('livre');
    expect(bloco.numero.contexto.valor).toBe('Centro Exemplo Um');
    expect(bloco.numero.contexto.unidade).toBe('texto');
    expect(bloco.numero.contexto.origem.tipo).toBe('sem_documento');
  });

  it('recusa id inexistente', async () => {
    const sessao = montar();
    const resultado = sessao.criarBloco({ tipo: 'numero', titulo: '', no: 'r9.9' });
    expect(resultado.erro).toContain('nó não encontrado');
    expect(resultado.bloco).toBeUndefined();
  });

  it('recusa nó de texto no bloco numero', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const nome = porRotulo(dados, 'Nome do centro 30.901');
    const resultado = sessao.criarBloco({ tipo: 'numero', titulo: '', no: nome.id });
    expect(resultado.erro).toMatch(/numérico|texto/);
  });

  it('recusa contexto que não é texto nem data', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const resultado = sessao.criarBloco({
      tipo: 'numero',
      titulo: '',
      no: livre.id,
      contexto: livre.id,
    });
    expect(resultado.erro).toContain('texto ou data');
  });

  it('exige título sem número inventado', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const comInventado = sessao.criarBloco({
      tipo: 'numero',
      titulo: 'Livre de R$ 99.000,00',
      no: livre.id,
    });
    expect(comInventado.erro).toContain('número');
    const comProprio = sessao.criarBloco({
      tipo: 'numero',
      titulo: 'Livre de R$ 84.300,00',
      no: livre.id,
    });
    expect(comProprio.erro).toBeUndefined();
  });

  it('código de centro com sinal no título é número, não exceção', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const resultado = sessao.criarBloco({
      tipo: 'numero',
      titulo: 'Desconto -30.109',
      no: livre.id,
    });
    expect(resultado.erro).toContain('número');
  });
});

describe('criarBloco tabela', () => {
  it('monta colunas com unidade e células com origem', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const codigo = porRotulo(dados, 'Código — Centro Exemplo Um');
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const bloco = sessao.criarBloco({
      tipo: 'tabela',
      titulo: 'Centros',
      colunas: ['Centro', 'Livre'],
      linhas: [[codigo.id, livre.id]],
    }).bloco;
    expect(bloco.tabela.colunas).toEqual([
      { rotulo: 'Centro', unidade: 'texto' },
      { rotulo: 'Livre', unidade: 'moeda' },
    ]);
    expect(bloco.tabela.linhas[0][0].valor).toBe('30.901');
    expect(bloco.tabela.linhas[0][1].valor).toBe(84300);
    expect(bloco.tabela.linhas[0][1].origem.tipo).toBe('livre');
  });

  it('recusa célula literal', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const codigo = porRotulo(dados, 'Código — Centro Exemplo Um');
    expect(
      sessao.criarBloco({ tipo: 'tabela', titulo: '', colunas: ['x'], linhas: [[123]] }).erro
    ).toContain('id de um nó');
    expect(
      sessao.criarBloco({ tipo: 'tabela', titulo: '', colunas: ['x'], linhas: [['123']] }).erro
    ).toContain('número');
    expect(
      sessao.criarBloco({ tipo: 'tabela', titulo: '', colunas: ['x'], linhas: [['r9.9']] }).erro
    ).toContain('nó não encontrado');
    expect(
      sessao.criarBloco({ tipo: 'tabela', titulo: '', colunas: ['x'], linhas: [[codigo.id, codigo.id]] }).erro
    ).toContain('mesmo número de colunas');
  });

  it('recusa coluna com unidades misturadas', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const total = dados.nos.find((no) => no.id === dados.total);
    const resultado = sessao.criarBloco({
      tipo: 'tabela',
      titulo: '',
      colunas: ['Valor'],
      linhas: [[livre.id], [total.id]],
    });
    expect(resultado.erro).toContain('mistura unidades');
  });

  it('recusa 51 linhas e 9 colunas', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const linhas = Array.from({ length: 51 }, () => [livre.id]);
    expect(sessao.criarBloco({ tipo: 'tabela', titulo: '', colunas: ['x'], linhas }).erro).toContain(
      '1 a 50 linhas'
    );
    const colunas = Array.from({ length: 9 }, () => 'x');
    const linha = Array.from({ length: 9 }, () => livre.id);
    expect(
      sessao.criarBloco({ tipo: 'tabela', titulo: '', colunas, linhas: [linha] }).erro
    ).toContain('1 a 8 colunas');
  });

  it('recusa cabeçalho de coluna com qualquer dígito', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const codigo = porRotulo(dados, 'Código — Centro Exemplo Um');

    const inventado = sessao.criarBloco({
      tipo: 'tabela',
      titulo: '',
      colunas: ['Total R$ 500,00'],
      linhas: [[livre.id]],
    });
    expect(inventado.erro).toContain('cabeçalho');

    const centro = sessao.criarBloco({
      tipo: 'tabela',
      titulo: '',
      colunas: ['Centro 30.901'],
      linhas: [[codigo.id]],
    });
    expect(centro.erro).toContain('cabeçalho');
  });

  it('aceita 50 linhas e 8 colunas', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const colunas = Array.from({ length: 8 }, () => 'x');
    const linhas = Array.from({ length: 50 }, () => Array.from({ length: 8 }, () => livre.id));
    const resultado = sessao.criarBloco({ tipo: 'tabela', titulo: '', colunas, linhas });
    expect(resultado.erro).toBeUndefined();
    expect(resultado.bloco.tabela.linhas).toHaveLength(50);
  });
});

describe('criarBloco tabela — rótulo de linha (A8)', () => {
  it('primeira coluna pode ser texto literal e as demais citam nós', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const pessoal = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const total = dados.nos.find((no) => no.id === dados.total);
    const resultado = sessao.criarBloco({
      tipo: 'tabela',
      titulo: 'Comparação',
      colunas: ['Rubrica', 'Livre', 'Centros'],
      linhas: [
        ['Pessoal', pessoal.id, total.id],
        ['Serviços PJ', pessoal.id, total.id],
      ],
    });
    expect(resultado.erro).toBeUndefined();
    const { bloco } = resultado;
    expect(bloco.tabela.colunas).toEqual([
      { rotulo: 'Rubrica', unidade: 'texto' },
      { rotulo: 'Livre', unidade: 'moeda' },
      { rotulo: 'Centros', unidade: 'numero' },
    ]);
    expect(bloco.tabela.linhas[0][0]).toEqual({
      valor: 'Pessoal',
      unidade: 'texto',
      origem: null,
    });
    expect(bloco.tabela.linhas[0][1].valor).toBe(84300);
    expect(bloco.tabela.linhas[0][1].origem.tipo).toBe('livre');
    // O rótulo literal não virou nó: não dá para citar "Pessoal" como id.
    expect(sessao.criarBloco({ tipo: 'numero', titulo: '', no: 'Pessoal' }).erro).toContain(
      'nó não encontrado'
    );
  });

  it('aceita código de centro e nome de centro da sessão como rótulo', async () => {
    const resumo = fixture('resumo_projetos');
    resumo.centros[0].name = 'GPW fase 2';
    const sessao = criarSessao({
      rpc: async (nome) => {
        if (nome === 'resumo_projetos_v2') return { data: resumo, error: null };
        if (nome === 'get_pedido_bolsas_v2') return { data: fixture('pedido_bolsas'), error: null };
        return { data: null, error: { message: `sem fixture: ${nome}` } };
      },
      hoje: '2026-11-25',
    });
    // `listar_centros` carrega os nomes da sessão antes do bloco.
    const centros = JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
    const livre = porRotulo(centros, 'Livre — GPW fase 2');
    const codigo = porRotulo(centros, 'Código — GPW fase 2');
    const resultado = sessao.criarBloco({
      tipo: 'tabela',
      titulo: '',
      colunas: ['Linha', 'Código', 'Livre'],
      linhas: [
        ['GPW fase 2', codigo.id, livre.id],
        ['30.109', codigo.id, livre.id],
      ],
    });
    expect(resultado.erro).toBeUndefined();
    expect(resultado.bloco.tabela.linhas[0][0].valor).toBe('GPW fase 2');
    expect(resultado.bloco.tabela.linhas[1][0].valor).toBe('30.109');
  });

  it('recusa rótulo vazio, id inexistente e valor inventado', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const montarLinha = (rotulo) =>
      sessao.criarBloco({
        tipo: 'tabela',
        titulo: '',
        colunas: ['Linha', 'Livre'],
        linhas: [[rotulo, livre.id]],
      });
    expect(montarLinha('   ').erro).toContain('vazio');
    expect(montarLinha('r9.9').erro).toContain('nó não encontrado');
    expect(montarLinha('c12.3').erro).toContain('nó não encontrado');
    expect(montarLinha('R$ 500,00').erro).toContain('número');
  });

  it('não mistura texto literal com unidade numérica na primeira coluna', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const texto = porRotulo(dados, 'Nome do centro 30.901');
    expect(
      sessao.criarBloco({
        tipo: 'tabela',
        titulo: '',
        colunas: ['Linha', 'Livre'],
        linhas: [
          ['Pessoal', livre.id],
          [livre.id, livre.id],
        ],
      }).erro
    ).toContain('mistura');
    expect(
      sessao.criarBloco({
        tipo: 'tabela',
        titulo: '',
        colunas: ['Linha', 'Livre'],
        linhas: [
          [livre.id, livre.id],
          ['Pessoal', livre.id],
        ],
      }).erro
    ).toContain('mistura');
    // Texto literal combina com nó de texto: a coluna continua sendo texto.
    expect(
      sessao.criarBloco({
        tipo: 'tabela',
        titulo: '',
        colunas: ['Linha', 'Nome'],
        linhas: [
          [texto.id, texto.id],
          ['Pessoal', texto.id],
        ],
      }).erro
    ).toBeUndefined();
  });

  it('texto literal nas colunas 2+ continua recusado', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const resultado = sessao.criarBloco({
      tipo: 'tabela',
      titulo: '',
      colunas: ['Linha', 'Livre'],
      linhas: [['Pessoal', 'Serviços PJ']],
    });
    expect(resultado.erro).toContain('nó não encontrado');
  });

  it('reidratar funciona com célula de origem null', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    const bloco = sessao.criarBloco({
      tipo: 'tabela',
      titulo: '',
      colunas: ['Linha', 'Livre'],
      linhas: [
        ['Pessoa Exemplo Um', livre.id],
        ['Pessoal', livre.id],
      ],
    }).bloco;
    expect(bloco.tabela.linhas[0][0].valor).toBe('⟦P1⟧');
    const reidratado = sessao.reidratar(bloco);
    expect(reidratado.tabela.linhas[0][0]).toEqual({
      valor: 'Pessoa Exemplo Um',
      unidade: 'texto',
      origem: null,
    });
    expect(reidratado.tabela.linhas[1][0].origem).toBeNull();
  });
});

describe('criarBloco texto', () => {
  it('marca número inventado e não marca código de centro', async () => {
    const sessao = montar();
    const bloco = sessao.criarBloco({
      tipo: 'texto',
      texto: 'O livre é R$ 99.000,00 no centro 30.901.',
    }).bloco;
    expect(bloco.texto.texto).toBe('O livre é R$ 99.000,00 no centro 30.901.');
    expect(bloco.texto.semOrigem).toHaveLength(1);
    const trecho = bloco.texto.texto.slice(
      bloco.texto.semOrigem[0].inicio,
      bloco.texto.semOrigem[0].fim
    );
    expect(trecho).toBe('R$ 99.000,00');
  });

  it('número de bloco já citado não é marcado', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: livre.id });
    const bloco = sessao.criarBloco({
      tipo: 'texto',
      texto: 'O livre é R$ 84.300,00 no centro 30.901.',
    }).bloco;
    expect(bloco.texto.semOrigem).toEqual([]);
  });

  it('recusa texto vazio', async () => {
    const sessao = montar();
    expect(sessao.criarBloco({ tipo: 'texto', texto: '  ' }).erro).toBeTruthy();
  });
});

describe('ids dos blocos', () => {
  it('não consome id quando o bloco é recusado', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const livre = porRotulo(dados, 'Livre — Centro Exemplo Um');
    expect(sessao.criarBloco({ tipo: 'numero', titulo: '', no: 'r9.9' }).erro).toBeTruthy();
    const primeiro = sessao.criarBloco({ tipo: 'numero', titulo: '', no: livre.id }).bloco;
    const segundo = sessao.criarBloco({ tipo: 'numero', titulo: '', no: livre.id }).bloco;
    expect(primeiro.id).toBe('b1');
    expect(segundo.id).toBe('b2');
  });

  it('aceita célula de texto que reproduz o motivo da RPC sem remarcar', async () => {
    const sessao = montar();
    const dados = await dadosDosCentros(sessao);
    const motivo = porRotulo(dados, 'Motivo — 30.902');
    const bloco = sessao.criarBloco({
      tipo: 'tabela',
      titulo: '',
      colunas: ['Motivo'],
      linhas: [[motivo.id]],
    }).bloco;
    expect(bloco.tabela.linhas[0][0].valor).toBe(motivo.valor);
    expect(bloco.tabela.linhas[0][0].origem.tipo).toBe('sem_documento');
  });
});
