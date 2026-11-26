import { describe, expect, it, vi } from 'vitest';
import {
  ARVORES_EXEMPLO,
  explicarLivre,
  origem,
  termosContrato,
} from '../src/servicos/dadosExemplo.js';
import {
  criarEventosAnaliseExemplo,
  executarAnaliseExemplo,
  identificarCenario,
} from '../src/servicos/analiseExemplo.js';

const MENSAGEM_INTERROMPIDA_EXEMPLO =
  'A análise foi interrompida pelo servidor antes de terminar. O que chegou até aqui está abaixo, incompleto. Tente de novo ou faça uma pergunta mais específica.';

function coletarOrigens(valor, saida = []) {
  if (!valor || typeof valor !== 'object') return saida;
  if (Array.isArray(valor)) {
    for (const item of valor) coletarOrigens(item, saida);
    return saida;
  }
  if (typeof valor.tipo === 'string' && ['no', 'livre', 'ref', 'termo', 'calculo', 'sem_documento'].includes(valor.tipo)) {
    saida.push(valor);
  }
  if (valor.origem) coletarOrigens(valor.origem, saida);
  if (valor.numero?.origem) coletarOrigens(valor.numero.origem, saida);
  if (valor.numero?.contexto?.origem) coletarOrigens(valor.numero.contexto.origem, saida);
  if (valor.tabela) {
    for (const linha of valor.tabela.linhas || []) {
      for (const celula of linha || []) coletarOrigens(celula, saida);
    }
  }
  for (const parte of valor.partes || []) coletarOrigens(parte, saida);
  return saida;
}

function acharNoPorChave(no, chave) {
  if (!no || typeof no !== 'object') return null;
  if (no.chave === chave) return no;
  for (const parte of no.partes || []) {
    const achado = acharNoPorChave(parte, chave);
    if (achado) return achado;
  }
  return null;
}

function existeNoEmAlgumaArvore(no) {
  return Object.values(ARVORES_EXEMPLO).some((arvore) => Boolean(acharNoPorChave(arvore, no?.chave)));
}

describe('cenários do modo exemplo', () => {
  it('escolhe o cenário por palavra-chave, sem acento e sem caixa', () => {
    expect(identificarCenario('LIMITE de hoje')).toBe('limite');
    expect(identificarCenario('me mostra o córte')).toBe('corte');
    expect(identificarCenario('resposta incompleta')).toBe('incompleta');
    expect(identificarCenario('bloco inválido')).toBe('invalido');
    expect(identificarCenario('SEM REGISTRO por favor')).toBe('sem-registro');
    expect(identificarCenario('Quanto o 30.910 tem livre?')).toBe('padrao');
  });

  it('cenário padrão: inicio, 3 passos (um com erro recuperado), 4 blocos, texto e fim', async () => {
    const { cenario, eventos } = criarEventosAnaliseExemplo('Quanto o 30.910 tem livre?');
    expect(cenario).toBe('padrao');
    expect(eventos[0]).toEqual({
      nome: 'inicio',
      dados: { registro: expect.any(String) },
    });
    expect(eventos.at(-1).nome).toBe('fim');

    const passos = eventos.filter((evento) => evento.nome === 'passo');
    const chaves = new Set(passos.map((evento) => `${evento.dados.ferramenta}|${evento.dados.rotulo}`));
    expect(chaves.size).toBe(4);
    expect(passos.some((evento) => evento.dados.estado === 'erro')).toBe(true);
    expect(passos.at(-1).dados.estado).toBe('fim');

    const deTermos = passos.filter((evento) => evento.dados.ferramenta === 'termos_contrato');
    expect(deTermos.some((evento) => evento.dados.estado === 'erro')).toBe(true);
    expect(deTermos.some((evento) => evento.dados.estado === 'fim')).toBe(false);

    const blocos = eventos.filter((evento) => evento.nome === 'bloco');
    expect(blocos.map((evento) => evento.dados.tipo)).toEqual([
      'numero',
      'tabela',
      'numero',
      'texto',
    ]);

    const origens = coletarOrigens(blocos.map((evento) => evento.dados));
    const tipos = new Set(origens.map((origemItem) => origemItem.tipo));
    for (const tipo of ['no', 'livre', 'ref', 'termo', 'calculo', 'sem_documento']) {
      expect(tipos.has(tipo)).toBe(true);
    }

    const onInicio = vi.fn();
    const onPasso = vi.fn();
    const onBloco = vi.fn();
    const onTexto = vi.fn();
    const onFim = vi.fn();
    const onErro = vi.fn();
    const resultado = await executarAnaliseExemplo({
      pergunta: 'Quanto o 30.910 tem livre?',
      atraso: 0,
      onInicio,
      onPasso,
      onBloco,
      onTexto,
      onFim,
      onErro,
    });

    expect(resultado).toMatchObject({
      ok: true,
      erro: null,
      registro: expect.any(String),
      blocos: expect.any(Array),
      texto: { texto: expect.any(String) },
      fim: { rodadas: 4, ms: 12000 },
    });
    expect(resultado.blocos).toHaveLength(4);
    expect(onInicio).toHaveBeenCalledTimes(1);
    expect(onPasso).toHaveBeenCalledTimes(passos.length);
    expect(onBloco).toHaveBeenCalledTimes(4);
    expect(onTexto).toHaveBeenCalledTimes(1);
    expect(onFim).toHaveBeenCalledTimes(1);
    expect(onErro).not.toHaveBeenCalled();
  });

  it('limite: erro sem inicio e sem fim', async () => {
    const { eventos } = criarEventosAnaliseExemplo('limite');
    expect(eventos).toHaveLength(1);
    expect(eventos[0].nome).toBe('erro');
    expect(eventos.some((evento) => evento.nome === 'inicio')).toBe(false);

    const onInicio = vi.fn();
    const onErro = vi.fn();
    const resultado = await executarAnaliseExemplo({
      pergunta: 'limite',
      atraso: 0,
      onInicio,
      onErro,
    });
    expect(resultado.ok).toBe(false);
    expect(resultado.erro.codigo).toBe('limite');
    expect(resultado.registro).toBeNull();
    expect(onInicio).not.toHaveBeenCalled();
    expect(onErro).toHaveBeenCalledTimes(1);
  });

  it('corte: stream fecha sem fim e o parcial vira interrompida', async () => {
    const { eventos } = criarEventosAnaliseExemplo('corte');
    expect(eventos.some((evento) => evento.nome === 'inicio')).toBe(true);
    expect(eventos.some((evento) => evento.nome === 'fim')).toBe(false);
    expect(eventos.filter((evento) => evento.nome === 'bloco').length).toBeGreaterThan(0);

    const onErro = vi.fn();
    const resultado = await executarAnaliseExemplo({
      pergunta: 'corte',
      atraso: 0,
      onErro,
    });
    expect(resultado).toMatchObject({
      ok: false,
      interrompida: true,
      erro: { codigo: 'interrompida', mensagem: MENSAGEM_INTERROMPIDA_EXEMPLO },
    });
    expect(resultado.blocos.length).toBeGreaterThan(0);
    expect(onErro).toHaveBeenCalledWith({
      codigo: 'interrompida',
      mensagem: MENSAGEM_INTERROMPIDA_EXEMPLO,
    });
  });

  it('incompleta: blocos antes do erro e fim continuam no resultado', async () => {
    const { eventos } = criarEventosAnaliseExemplo('incompleta');
    expect(eventos.some((evento) => evento.dados?.codigo === 'incompleta')).toBe(true);
    expect(eventos.at(-1).nome).toBe('fim');

    const resultado = await executarAnaliseExemplo({ pergunta: 'incompleta', atraso: 0 });
    expect(resultado.ok).toBe(false);
    expect(resultado.erro.codigo).toBe('incompleta');
    expect(resultado.blocos).toHaveLength(2);
    expect(resultado.blocos.map((bloco) => bloco.tipo)).toEqual(['numero', 'tabela']);
  });

  it('invalido: um bloco malformado entre dois bons', async () => {
    const { eventos } = criarEventosAnaliseExemplo('invalido');
    const blocos = eventos.filter((evento) => evento.nome === 'bloco').map((evento) => evento.dados);
    expect(blocos).toHaveLength(3);
    expect(blocos[1].tabela.colunas).toBeNull();
    expect(blocos[1].tabela.linhas).not.toBeInstanceOf(Array);

    const resultado = await executarAnaliseExemplo({ pergunta: 'invalido', atraso: 0 });
    expect(resultado.ok).toBe(true);
    expect(resultado.blocos).toHaveLength(3);
    expect(resultado.blocos.filter((bloco) => bloco.id !== 'b-invalido')).toHaveLength(2);
  });

  it('sem registro: inicio com registro nulo, sem feedback', async () => {
    const { eventos } = criarEventosAnaliseExemplo('sem registro');
    expect(eventos[0]).toEqual({ nome: 'inicio', dados: { registro: null } });

    const resultado = await executarAnaliseExemplo({ pergunta: 'sem registro', atraso: 0 });
    expect(resultado.ok).toBe(true);
    expect(resultado.registro).toBeNull();
    expect(resultado.blocos).toHaveLength(1);
  });

  it('respeita o signal antes do primeiro evento', async () => {
    const controlador = new AbortController();
    controlador.abort();
    const onInicio = vi.fn();
    const resultado = await executarAnaliseExemplo({
      pergunta: 'Quanto o 30.910 tem livre?',
      atraso: 0,
      signal: controlador.signal,
      onInicio,
    });
    expect(resultado).toEqual({
      ok: false,
      abortada: true,
      registro: null,
      blocos: [],
      texto: null,
    });
    expect(onInicio).not.toHaveBeenCalled();
  });
});

describe('origens do modo exemplo', () => {
  it('todas as origens apontam para project_id, nós, refs e termos que existem em dadosExemplo.js', async () => {
    const { eventos } = criarEventosAnaliseExemplo('Quanto o 30.910 tem livre?');
    const dados = eventos
      .filter((evento) => evento.nome === 'bloco')
      .map((evento) => evento.dados);
    const origens = coletarOrigens(dados);

    let temCalculo = false;
    for (const origemItem of origens) {
      if (origemItem.tipo === 'sem_documento') {
        expect(typeof origemItem.motivo).toBe('string');
        expect(origemItem.motivo.length).toBeGreaterThan(0);
        continue;
      }

      if (origemItem.tipo === 'no') {
        expect(existeNoEmAlgumaArvore(origemItem.no)).toBe(true);
        continue;
      }

      if (origemItem.tipo === 'livre') {
        expect(typeof origemItem.project_id).toBe('string');
        const arvore = await explicarLivre(origemItem.project_id);
        expect(arvore.erro).toBeNull();
        expect(arvore.dados).toBeTruthy();
        if (Array.isArray(origemItem.caminho)) {
          let atual = arvore.dados;
          for (const indice of origemItem.caminho) {
            expect(Array.isArray(atual?.partes)).toBe(true);
            atual = atual.partes[indice];
            expect(atual).toBeTruthy();
          }
        }
        continue;
      }

      if (origemItem.tipo === 'ref') {
        const resposta = await origem(origemItem.ref);
        expect(resposta.erro).toBeNull();
        expect(resposta.dados).toBeTruthy();
        continue;
      }

      if (origemItem.tipo === 'termo') {
        const resposta = await termosContrato(origemItem.project_id);
        expect(resposta.erro).toBeNull();
        const termos = Object.values(resposta.dados.termos || {});
        expect(termos.some((termo) => termo.id === origemItem.termo_id)).toBe(true);
        continue;
      }

      if (origemItem.tipo === 'calculo') {
        temCalculo = true;
        const partes = origemItem.partes || [];
        const soma = partes.reduce(
          (total, parte) => total + Math.round(Number(parte.valor) * 100) * (parte.sinal === -1 ? -1 : 1),
          0
        );
        const blocoComConta = dados.find(
          (bloco) => bloco.numero?.origem === origemItem
        );
        expect(soma).toBe(Math.round(Number(blocoComConta.numero.valor) * 100));
      }
    }
    expect(temCalculo).toBe(true);
  });
});
