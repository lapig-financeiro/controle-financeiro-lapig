import { describe, it, expect } from 'vitest';
import { agruparAtividades, agruparPorPessoa, minhaVez } from '../frontend/js/components/buriti-tarefas.js';

const hoje = new Date(2026, 9, 9, 15, 0); // sexta-feira, 09/10/2026
const t = (id, extra = {}) => ({ id, titulo: 'Tarefa ' + id, status: 'em_andamento', situacao: null, prazo: null,
  responsavel_id: 'ana', responsavel: 'Ana Ribeiro', precisa_atencao: false, aviso_responsavel: null,
  tarefa_passos: [], criada_em: '2026-10-01T10:00:00Z', ...extra });
const passo = estado => ({ id: 'p' + estado, ordem: 1, descricao: 'Fazer', quem: 'Ana', executor: 'pessoa', estado });
const titulos = faixas => faixas.map(f => [f.chave, f.tarefas.map(x => x.id)]);

describe('faixas da tela em ordem fixa', () => {
  it('só mostra as faixas com atividade, na ordem pedida', () => {
    const lista = [
      t('atrasada', { prazo: '2026-10-05' }),
      t('hoje', { prazo: '2026-10-09' }),
      t('semana', { prazo: '2026-10-10' }),
      t('depois', { prazo: '2026-10-12' }),
      t('sem-prazo'),
      t('esperando', { status: 'aguardando_terceiro', prazo: '2026-10-01' }),
      t('concluida', { status: 'concluida', prazo: '2026-10-05' }),
    ];
    expect(titulos(agruparAtividades(lista, { hoje }))).toEqual([
      ['hoje', ['atrasada', 'hoje']],
      ['semana', ['semana']],
      ['depois', ['depois']],
      ['sem_prazo', ['sem-prazo']],
      ['esperando', ['esperando']],
    ]);
  });
  it('dentro da faixa, o prazo manda: vencida primeiro, a mais antiga antes', () => {
    const faixas = agruparAtividades([t('b', { prazo: '2026-10-09' }), t('a', { prazo: '2026-10-02' })], { hoje });
    expect(faixas[0].tarefas.map(x => x.id)).toEqual(['a', 'b']);
  });
  it('para o admin, confirmar e atenção sobem dentro da faixa; para os outros, fica pela criação', () => {
    const lista = [
      t('normal', { criada_em: '2026-10-01T10:00:00Z' }),
      t('atencao', { criada_em: '2026-10-02T10:00:00Z', precisa_atencao: true }),
      t('confirmar', { criada_em: '2026-10-03T10:00:00Z', tarefa_passos: [passo('sugerido')] }),
    ];
    expect(agruparAtividades(lista, { hoje, admin: true })[0].tarefas.map(x => x.id))
      .toEqual(['confirmar', 'atencao', 'normal']);
    expect(agruparAtividades(lista, { hoje, admin: false })[0].tarefas.map(x => x.id))
      .toEqual(['normal', 'atencao', 'confirmar']);
  });
});

describe('minha vez', () => {
  it('é o que está comigo', () => {
    expect(minhaVez(t('minha', { responsavel_id: 'ana' }), { eu: 'ana' })).toBe(true);
    expect(minhaVez(t('outra', { responsavel_id: 'bruno' }), { eu: 'ana' })).toBe(false);
    expect(minhaVez(t('minha', { responsavel_id: 'ana', status: 'concluida' }), { eu: 'ana' })).toBe(false);
  });
  it('para o admin, inclui confirmar passo e o que pede atenção de outra pessoa', () => {
    const confirmar = t('c', { responsavel_id: 'bruno', tarefa_passos: [passo('sugerido')] });
    const atencao = t('a', { responsavel_id: 'bruno', precisa_atencao: true });
    expect(minhaVez(confirmar, { admin: true, eu: 'ana' })).toBe(true);
    expect(minhaVez(atencao, { admin: true, eu: 'ana' })).toBe(true);
    expect(minhaVez(confirmar, { admin: false, eu: 'ana' })).toBe(false);
  });
});

describe('vista Equipe agrupada por pessoa', () => {
  it('um bloco por responsável, alfabético, sem responsável no fim, cada um com suas faixas', () => {
    const lista = [
      t('ana-hoje', { prazo: '2026-10-09', responsavel_id: 'ana', responsavel: 'Ana Ribeiro' }),
      t('ana-sem', { responsavel_id: 'ana', responsavel: 'Ana Ribeiro' }),
      t('bruno', { prazo: '2026-10-10', responsavel_id: 'bruno', responsavel: 'Bruno Tavares' }),
      t('ninguem', { responsavel_id: null, responsavel: null }),
      t('concluida', { status: 'concluida', responsavel_id: 'ana' }),
    ];
    const grupos = agruparPorPessoa(lista, { hoje, eu: 'bruno' });
    expect(grupos.map(g => g.nome)).toEqual(['Ana Ribeiro', 'Bruno Tavares', 'Sem responsável']);
    expect(grupos.map(g => g.eu)).toEqual([false, true, false]);
    expect(grupos[0].blocos.map(b => b.chave)).toEqual(['hoje', 'sem_prazo']);
    expect(grupos[1].blocos[0]).toMatchObject({ chave: 'semana', titulo: 'Esta semana' });
    expect(grupos[2].blocos[0].chave).toBe('sem_prazo');
    expect(grupos[2].sem).toBe(true);
  });
});
