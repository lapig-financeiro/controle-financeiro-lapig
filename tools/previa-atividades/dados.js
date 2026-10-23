// Dados de mentira para a prévia da tela de Atividades.
// Nomes, centros e projetos são inventados: nada aqui vem de pessoa ou projeto real.
// A data é fixa (23/10/2026, sexta) para as faixas caírem sempre nos mesmos lugares.

export const HOJE_FIXO = new Date(2026, 9, 23, 10, 0, 0).getTime();

export const PROJETOS = [
  { id: 'p101', code: '30.101', name: 'Cerrado Vivo' },
  { id: 'p102', code: '30.102', name: 'Rede de Sementes' },
  { id: 'p103', code: '30.103', name: 'Atlas das Águas' },
  { id: 'p104', code: '30.104', name: 'Formação Continuada' },
];

export const USUARIOS = [
  { user_id: 'ana', display_name: 'Ana Ribeiro', role: 'admin' },
  { user_id: 'bruno', display_name: 'Bruno Tavares', role: 'professor' },
  { user_id: 'carla', display_name: 'Carla Nunes', role: 'professor' },
  { user_id: 'diego', display_name: 'Diego Alves', role: 'admin' },
];

const nomeDe = id => (USUARIOS.find(u => u.user_id === id) || {}).display_name || null;
const centroDe = codigo => PROJETOS.find(p => p.code === codigo) || null;

function tarefa({ id, titulo, centro, prazo = null, dono = null, status = 'em_andamento', situacao = null,
  precisa = false, motivo = null, passos = [], concluida = null }) {
  const projeto = centroDe(centro);
  return {
    id,
    titulo,
    status,
    situacao,
    prazo,
    precisa_atencao: precisa,
    motivo_atencao: motivo,
    aviso_responsavel: null,
    responsavel: nomeDe(dono),
    responsavel_id: dono,
    criada_em: '2026-09-30T12:00:00Z',
    concluida_em: concluida,
    projects: projeto ? { code: projeto.code, name: projeto.name } : null,
    atualizacao: null,
    eventos: [],
    tarefa_passos: passos.map((p, i) => ({
      id: `${id}-p${i + 1}`,
      ordem: i + 1,
      descricao: p.descricao,
      quem: p.quem || null,
      executor: p.executor || 'pessoa',
      estado: p.estado || 'pendente',
      feito: null,
      evento: null,
    })),
  };
}

export function criarBanco() {
  return {
    projects: PROJETOS.map(p => ({ ...p })),
    app_users: USUARIOS.map(u => ({ ...u })),
    vigia_execucoes: [],
    tarefa_eventos: [],
    tarefas: [
      // Atrasada (4 dias) com você.
      tarefa({ id: 't1', titulo: 'Prestação de contas do Cerrado Vivo', centro: '30.101', prazo: '2026-10-19', dono: 'ana',
        passos: [{ descricao: 'Fechar a conciliação bancária' }] }),
      // Vence hoje.
      tarefa({ id: 't2', titulo: 'Revisar orçamento do Atlas das Águas', centro: '30.103', prazo: '2026-10-23', dono: 'ana' }),
      // Esta semana (sábado e domingo).
      tarefa({ id: 't3', titulo: 'Enviar relatório parcial à fundação', centro: '30.102', prazo: '2026-10-24', dono: 'ana',
        passos: [{ descricao: 'Consolidar os números de setembro' }] }),
      tarefa({ id: 't4', titulo: 'Publicar edital de bolsas', centro: '30.104', prazo: '2026-10-25', dono: 'ana' }),
      // Depois.
      tarefa({ id: 't5', titulo: 'Renovar o seguro do veículo do projeto', centro: '30.101', prazo: '2026-11-06', dono: 'ana' }),
      // Sem prazo.
      tarefa({ id: 't6', titulo: 'Organizar a pasta de documentos do convênio', centro: '30.103', dono: 'ana' }),
      // Esperando terceiro, mesmo com data velha: fica na faixa Esperando.
      tarefa({ id: 't7', titulo: 'Retorno da fundação sobre a emenda', centro: '30.102', prazo: '2026-10-20', dono: 'ana',
        status: 'aguardando_terceiro' }),
      // Passo marcado como feito esperando confirmação do admin (é do Bruno).
      tarefa({ id: 't8', titulo: 'Prestar contas da oficina de campo', centro: '30.104', prazo: '2026-10-26', dono: 'bruno',
        passos: [
          { descricao: 'Reunir as notas fiscais' },
          { descricao: 'Anexar o comprovante de transferência', quem: 'Bruno Tavares', estado: 'sugerido' },
        ] }),
      // De outra pessoa, sem pedir atenção: aparece na Equipe, não na Minha vez do admin.
      tarefa({ id: 't9', titulo: 'Reservar o auditório para a reunião', centro: '30.104', prazo: '2026-10-24', dono: 'carla' }),
      // Sem responsável.
      tarefa({ id: 't10', titulo: 'Definir quem cuida do novo convênio', centro: '30.102', prazo: '2026-10-28', dono: null }),
      // Pedido de atenção de outra pessoa: entra na Minha vez do admin.
      tarefa({ id: 't11', titulo: 'Assinatura do termo de cooperação', centro: '30.101', prazo: '2026-10-27', dono: 'diego',
        precisa: true, motivo: 'Travou na assinatura do termo' }),
      // Outra atrasada, de outra pessoa.
      tarefa({ id: 't12', titulo: 'Conferir notas fiscais de setembro', centro: '30.102', prazo: '2026-10-16', dono: 'bruno' }),
      // Vence hoje, de outra pessoa.
      tarefa({ id: 't13', titulo: 'Confirmar a sala da reunião de equipe', centro: '30.103', prazo: '2026-10-23', dono: 'carla' }),
      // Sem prazo, de outra pessoa.
      tarefa({ id: 't14', titulo: 'Atualizar os contatos dos parceiros', centro: '30.104', dono: 'bruno' }),
      // Esperando outro órgão.
      tarefa({ id: 't15', titulo: 'Aguardando parecer jurídico', centro: '30.101', dono: 'carla', status: 'aguardando_terceiro' }),
      // Encerrada (só no acesso discreto).
      tarefa({ id: 't16', titulo: 'Pagamento da bolsa de outubro', centro: '30.103', dono: 'ana', status: 'concluida',
        concluida: '2026-10-20T15:00:00Z' }),
    ],
  };
}
