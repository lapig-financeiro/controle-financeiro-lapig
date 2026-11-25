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
    return respostas[nome] ?? { data: null, error: { message: `sem fixture: ${nome}` } };
  };
  return { sessao: criarSessao({ rpc, hoje: '2026-11-25' }), chamadas };
}

const PII = [
  'Pessoa Exemplo Um',
  'Pessoa Exemplo Dois',
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
    expect(resultado.erro).toContain('bolsistas');
    expect(resultado.paraModelo).toBeUndefined();
  });
});
