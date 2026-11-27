import { describe, expect, it } from 'vitest';
import {
  chaveItemPlano, execucaoConferida, execucaoDoItem, indexarExecucaoRubricas,
} from '../src/servicos/subrubricas.js';

// Rubrica sintética no formato de get_previsto_vs_realizado (053).
function rubricaExecucao(extra = {}) {
  return {
    rubrica_code: 'e', previsto: 180, realizado: 125,
    previsto_sem_descricao: 0, realizado_sem_item: 0,
    detalhes: [
      { descricao: 'Material gráfico', previsto: 100, realizado: 125, saldo: -25 },
      { descricao: 'Peças', previsto: 80, realizado: 0, saldo: 80 },
    ],
    contas: [{ item: 'MATERIAL GRAFICO', realizado: 125 }],
    ...extra,
  };
}

const rubricaSaldo = (extra = {}) => ({ rubrica_code: 'e', previsto: 180, realizado: 125, compromissos: 0, ...extra });
const linha = (rotulo, valor) => ({ rotulo, valor });

describe('chaveItemPlano', () => {
  it('reproduz public.norm_item: sem acento, sem caixa e sem pontuação', () => {
    expect(chaveItemPlano('  "Serviços técnicos especializaos "')).toBe('servicos tecnicos especializaos');
    expect(chaveItemPlano('ÇÃO-Ê/Peças')).toBe('cao e pecas');
    expect(chaveItemPlano(null)).toBe('');
  });
});

describe('indexarExecucaoRubricas', () => {
  it('fecha quando contas, itens e valor sem item batem com o total', () => {
    const detalhe = indexarExecucaoRubricas([rubricaExecucao()]).get('e');
    expect(detalhe.fecha).toBe(true);
    expect(detalhe.temSemItem).toBe(false);
    expect(detalhe.itens.get('material grafico').vinculado).toBe(true);
    expect(detalhe.itens.get('pecas').vinculado).toBe(false);
    expect(execucaoConferida(detalhe, rubricaSaldo())).toBe(true);
  });

  it('não fecha quando a soma das contas difere do realizado da rubrica', () => {
    const detalhe = indexarExecucaoRubricas([rubricaExecucao({ realizado: 135 })]).get('e');
    expect(detalhe.fecha).toBe(false);
    expect(execucaoConferida(detalhe, rubricaSaldo({ realizado: 135 }))).toBe(false);
  });

  it('marca valor sem item quando uma conta não casa com nenhum item', () => {
    const detalhe = indexarExecucaoRubricas([rubricaExecucao({
      realizado: 150, realizado_sem_item: 25,
      contas: [{ item: 'Material gráfico', realizado: 125 }, { item: null, realizado: 25 }],
    })]).get('e');
    expect(detalhe.fecha).toBe(true);
    expect(detalhe.temSemItem).toBe(true);
  });

  it('não confere quando o previsto do getSaldoLivre diverge', () => {
    const detalhe = indexarExecucaoRubricas([rubricaExecucao()]).get('e');
    expect(execucaoConferida(detalhe, rubricaSaldo({ previsto: 181 }))).toBe(false);
  });
});

describe('execucaoDoItem', () => {
  const detalhe = () => indexarExecucaoRubricas([rubricaExecucao()]).get('e');

  it('devolve realizado e livre do item quando tudo confere', () => {
    expect(execucaoDoItem(detalhe(), rubricaSaldo(), linha('Material gráfico', 100), true, false))
      .toEqual({ realizado: 125, compromissos: 0, saldo_livre: -25 });
  });

  it('recusa rótulo que aparece duas vezes na rubrica (ambíguo)', () => {
    expect(execucaoDoItem(detalhe(), rubricaSaldo(), linha('Material gráfico', 100), false, false)).toBeNull();
  });

  it('recusa rótulo com CPF mascarado', () => {
    expect(execucaoDoItem(detalhe(), rubricaSaldo(), linha('Material gráfico ***.***.***-**', 100), true, false)).toBeNull();
  });

  it('recusa quando o previsto da linha não é o do item', () => {
    expect(execucaoDoItem(detalhe(), rubricaSaldo(), linha('Material gráfico', 90), true, false)).toBeNull();
  });

  it('não reparte compromissos entre vários itens', () => {
    expect(execucaoDoItem(detalhe(), rubricaSaldo({ compromissos: 40 }), linha('Peças', 80), true, false))
      .toEqual({ realizado: 0, compromissos: null, saldo_livre: null });
  });

  it('item único leva os compromissos da rubrica inteira', () => {
    const unico = indexarExecucaoRubricas([rubricaExecucao({
      previsto: 100,
      detalhes: [{ descricao: 'Material gráfico', previsto: 100, realizado: 125, saldo: -25 }],
    })]).get('e');
    expect(execucaoDoItem(unico, rubricaSaldo({ previsto: 100, compromissos: 10 }), linha('Material gráfico', 100), true, true))
      .toEqual({ realizado: 125, compromissos: 10, saldo_livre: -35 });
  });

  it('esconde o realizado de item sem vínculo quando há valor sem item', () => {
    const comSemItem = indexarExecucaoRubricas([rubricaExecucao({
      realizado: 150, realizado_sem_item: 25,
      contas: [{ item: 'Material gráfico', realizado: 125 }, { item: null, realizado: 25 }],
    })]).get('e');
    const rubrica = rubricaSaldo({ realizado: 150 });
    expect(execucaoDoItem(comSemItem, rubrica, linha('Peças', 80), true, false))
      .toEqual({ realizado: null, compromissos: 0, saldo_livre: null });
    expect(execucaoDoItem(comSemItem, rubrica, linha('Material gráfico', 100), true, false).realizado).toBe(125);
  });
});
