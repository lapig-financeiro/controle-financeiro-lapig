import { describe, it, expect } from 'vitest';
import { faixaAtividade, sinalAtividade, precisaConfirmar, prazoAtividade, proximoPasso, prazoCurto, lerCaptura } from '../frontend/js/components/buriti-tarefas.js';

const hoje = new Date(2026, 9, 9, 15, 0); // sexta-feira, 09/10/2026
const tarefa = (extra = {}) => ({ id: 't', status: 'em_andamento', prazo: null, situacao: null, precisa_atencao: false,
  aviso_responsavel: null, responsavel_id: 'v', tarefa_passos: [{ id: 'p1', ordem: 1, descricao: 'Ligar para a FUNAPE', quem: 'Arthur', executor: 'pessoa', estado: 'pendente' }], ...extra });

describe('faixas da tela de Atividades', () => {
  it('atrasada e hoje, esta semana (até domingo), depois, sem prazo e encerrada', () => {
    expect(faixaAtividade(tarefa({ prazo: '2026-10-05' }), { hoje })).toBe('hoje');
    expect(faixaAtividade(tarefa({ prazo: '2026-10-09' }), { hoje })).toBe('hoje');
    expect(faixaAtividade(tarefa({ prazo: '2026-10-10' }), { hoje })).toBe('semana');
    expect(faixaAtividade(tarefa({ prazo: '2026-10-11' }), { hoje })).toBe('semana');
    expect(faixaAtividade(tarefa({ prazo: '2026-10-12' }), { hoje })).toBe('depois');
    expect(faixaAtividade(tarefa(), { hoje })).toBe('sem_prazo');
    expect(faixaAtividade(tarefa({ status: 'concluida', prazo: '2026-10-05' }), { hoje })).toBe('encerrada');
  });
  it('esperar alguém de fora vence a data, mesmo atrasada', () => {
    expect(faixaAtividade(tarefa({ status: 'aguardando_terceiro', prazo: '2026-10-01' }), { hoje })).toBe('esperando');
    expect(faixaAtividade(tarefa({ situacao: 'esperando', prazo: '2026-10-09' }), { hoje })).toBe('esperando');
  });
  it('no domingo não existe "esta semana": o que vem depois é "depois"', () => {
    const domingo = new Date(2026, 9, 11, 10, 0);
    expect(faixaAtividade(tarefa({ prazo: '2026-10-11' }), { hoje: domingo })).toBe('hoje');
    expect(faixaAtividade(tarefa({ prazo: '2026-10-12' }), { hoje: domingo })).toBe('depois');
  });
  it('o sinal da linha: confirmar e atenção só para o admin; esperando para todos', () => {
    const sugerido = tarefa({ tarefa_passos: [{ ...tarefa().tarefa_passos[0], estado: 'sugerido' }] });
    expect(precisaConfirmar(sugerido)).toBe(true);
    expect(sinalAtividade(sugerido, { admin: true })).toEqual({ chave: 'confirmar', texto: 'confirmar passo' });
    expect(sinalAtividade(sugerido, { admin: false })).toBeNull();
    expect(sinalAtividade(tarefa({ aviso_responsavel: 'Arthur: travado' }), { admin: true }))
      .toEqual({ chave: 'atencao', texto: 'precisa de você' });
    expect(sinalAtividade(tarefa({ status: 'aguardando_terceiro' }), { admin: false }))
      .toEqual({ chave: 'esperando', texto: 'esperando' });
    expect(sinalAtividade(tarefa({ situacao: 'travado' }), { admin: false }))
      .toEqual({ chave: 'travado', texto: 'travada' });
  });
});

describe('próximo passo e prazo curto', () => {
  const passos = [
    { id: 'a', ordem: 2, descricao: 'Orçamentos', quem: 'Arthur', executor: 'pessoa', estado: 'pendente' },
    { id: 'b', ordem: 1, descricao: 'Falar com o Prof. Manuel', quem: 'Arthur', executor: 'pessoa', estado: 'sugerido' },
    { id: 'c', ordem: 0, descricao: 'Levantar dados', quem: 'Buriti', executor: 'buriti', estado: 'confirmado' },
  ];
  it('admin vê primeiro o que tem para confirmar; os demais, o primeiro pendente', () => {
    expect(proximoPasso({ tarefa_passos: passos }, true)).toEqual({ texto: 'Falar com o Prof. Manuel', confirmar: true, quem: 'Arthur' });
    expect(proximoPasso({ tarefa_passos: passos }, false)).toEqual({ texto: 'Orçamentos', confirmar: false, quem: 'Arthur' });
    expect(proximoPasso({ tarefa_passos: [passos[2]] }, true)).toBeNull();
  });
  it('prazo em palavras perto, data longe', () => {
    expect(prazoCurto(null, hoje)).toEqual({ texto: 'sem prazo', nivel: 'nenhum' });
    expect(prazoCurto('2026-10-09', hoje).texto).toBe('hoje');
    expect(prazoCurto('2026-10-10', hoje).texto).toBe('amanhã');
    expect(prazoCurto('2026-10-14', hoje)).toEqual({ texto: 'em 5 dias', nivel: 'perto' });
    expect(prazoCurto('2026-10-31', hoje)).toEqual({ texto: '31 out', nivel: 'longe' });
    expect(prazoCurto('2026-10-06', hoje)).toEqual({ texto: 'venceu há 3 dias', nivel: 'vencido' });
  });
  it('na linha, atraso é "há N dias" e sem prazo não escreve nada', () => {
    expect(prazoAtividade(null, hoje)).toEqual({ texto: '', nivel: 'nenhum' });
    expect(prazoAtividade('2026-10-06', hoje)).toEqual({ texto: 'há 3 dias', nivel: 'atrasado' });
    expect(prazoAtividade('2026-10-09', hoje)).toEqual({ texto: 'hoje', nivel: 'hoje' });
    expect(prazoAtividade('2026-10-10', hoje)).toEqual({ texto: 'amanhã', nivel: 'perto' });
    expect(prazoAtividade('2026-10-31', hoje)).toEqual({ texto: '31 out', nivel: 'longe' });
  });
});

describe('anotar como no caderno', () => {
  const centros = [{ id: 'p68', code: '30.068', name: 'CEMPA FAPEG' }, { id: 'p106', code: '30.106', name: 'Parques Urbanos' }];
  const pessoas = [{ user_id: 'v', display_name: 'Victor Amaral' }, { user_id: 'a', display_name: 'arthurpietro.lapig' },
    { user_id: 'm', display_name: 'Manuel Ferreira' }, { user_id: 'm2', display_name: 'Marcia Souza' }];
  const ler = texto => lerCaptura(texto, { centros, pessoas, eu: 'v', hoje });

  it('centro, o que fazer, prazo e responsável', () => {
    const r = ler('30.106 pedido de salgados para o evento até 31/10 @Arthur');
    expect(r.centro.id).toBe('p106');
    expect(r.titulo).toBe('Pedido de salgados para o evento');
    expect(r.prazo).toBe('2026-10-31');
    expect(r.responsavel.user_id).toBe('a');
  });
  it('sem @ fica com quem anota; sem data fica sem prazo; acento e caixa não importam', () => {
    const r = ler('Remanejamento de rubricas do 30.068');
    expect(r).toMatchObject({ titulo: 'Remanejamento de rubricas', prazo: null });
    expect(r.responsavel.user_id).toBe('v');
    expect(ler('30.068 x @MANUEL').responsavel.user_id).toBe('m');
    expect(ler('30.068: conferir bolsas — 20/10').prazo).toBe('2026-10-20');
    expect(ler('30.068: conferir bolsas — 20/10').titulo).toBe('Conferir bolsas');
  });
  it('data sem ano já passada há mais de um mês é do ano seguinte; com ano, respeita', () => {
    expect(ler('30.068 renovar até 15/01').prazo).toBe('2027-01-15');
    expect(ler('30.068 renovar até 01/10').prazo).toBe('2026-10-01');
    expect(ler('30.068 renovar até 15/01/26').prazo).toBe('2026-01-15');
  });
  it('recusa em vez de adivinhar', () => {
    expect(() => ler('')).toThrow('Escreva');
    expect(() => ler('remanejar rubricas')).toThrow('código do centro');
    expect(() => ler('30.999 remanejar')).toThrow('30.999');
    expect(() => ler('30.068 e 30.106 remanejar')).toThrow('um centro');
    expect(() => ler('30.068 remanejar até 31/11')).toThrow('não existe');
    expect(() => ler('30.068 remanejar @M')).toThrow('mais de uma pessoa');
    expect(() => ler('30.068 remanejar @Laerte')).toThrow('Não achei');
    expect(() => ler('30.068 @Arthur')).toThrow('o que fazer');
    expect(() => ler('30.068 escrever para fulano@funape.org.br')).toThrow('e-mail');
  });
});
