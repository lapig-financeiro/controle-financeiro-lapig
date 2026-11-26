import { parseValorBR } from '../util/moeda.js';

export const SENTINELA_EXEMPLO = '__EXEMPLO_CF__';

const IDS = {
  cerrado: '00000000-0000-4000-8000-000000030901',
  atlas: '00000000-0000-4000-8000-000000030902',
  nascentes: '00000000-0000-4000-8000-000000030903',
  veredas: '00000000-0000-4000-8000-000000030904',
  florestal: '00000000-0000-4000-8000-000000030905',
  estacoes: '00000000-0000-4000-8000-000000030906',
  corredor: '00000000-0000-4000-8000-000000030907',
  solos: '00000000-0000-4000-8000-000000030908',
  tarifa: '00000000-0000-4000-8000-000000030909',
  restinga: '00000000-0000-4000-8000-000000030910',
};

const CENTROS_BASE = [
  {
    id: IDS.cerrado,
    code: '30.901',
    name: 'Bacia do Cerrado Norte',
    end_date: '2027-09-30',
    drive_folder_url: 'https://drive.google.com/drive/folders/exemplo-30901',
    livre: 84300,
    situacao: 'em dia',
    data_referencia: '2026-10-15',
    erro: null,
    responsaveis: ['Profa. Clara Mendes'],
  },
  {
    id: IDS.atlas,
    code: '30.902',
    name: 'Atlas Hídrico do Planalto',
    end_date: '2027-03-31',
    drive_folder_url: 'https://drive.google.com/drive/folders/exemplo-30902',
    livre: 19400,
    situacao: 'atenção',
    data_referencia: '2026-08-15',
    erro: null,
    responsaveis: ['Prof. Renato Alves', 'Profa. Clara Mendes'],
    motivos: [
      {
        codigo: 'balancete_atrasado',
        nivel: 'atenção',
        texto: 'O último balancete cobre até 08/2026 (3 meses atrás).',
        grupo_code: null,
        valor: null,
      },
      {
        codigo: 'pendencias_abertas',
        nivel: 'atenção',
        texto:
          '2 pendências abertas: Conta 7.1.3.99 sem rubrica no balancete de ago/26; Aditivo sem data de evento informada',
        grupo_code: null,
        valor: null,
      },
    ],
  },
  {
    id: IDS.nascentes,
    code: '30.903',
    name: 'Monitoramento de Nascentes',
    end_date: '2027-06-30',
    drive_folder_url: null,
    livre: 15750,
    situacao: 'problema',
    data_referencia: '2026-10-20',
    erro: null,
    responsaveis: ['Prof. Renato Alves'],
    motivos: [
      {
        codigo: 'saldo_negativo',
        nivel: 'problema',
        texto:
          'Rubrica f — Equipamentos e material permanente: saldo livre R$ −4.250,00. Gasto R$ 4.250,00 acima do previsto.',
        grupo_code: 'f',
        valor: 4250,
      },
      {
        codigo: 'pendencias_abertas',
        nivel: 'atenção',
        texto: '1 pendência aberta: Equipamentos acima do previsto exige remanejamento',
        grupo_code: null,
        valor: null,
      },
    ],
  },
  {
    id: IDS.veredas,
    code: '30.904',
    name: 'Mapeamento de Veredas',
    end_date: '2027-12-31',
    drive_folder_url: 'https://drive.google.com/drive/folders/exemplo-30904',
    livre: null,
    situacao: 'sem balancete',
    data_referencia: null,
    erro: null,
    responsaveis: ['Profa. Beatriz Cunha'],
    motivos: [
      {
        codigo: 'sem_balancete',
        nivel: 'info',
        texto: 'Este centro não tem balancete importado: falta o realizado por rubrica.',
        grupo_code: null,
        valor: null,
      },
    ],
  },
  {
    id: IDS.florestal,
    code: '30.905',
    name: 'Inventário Florestal Sul',
    end_date: '2027-09-30',
    drive_folder_url: null,
    livre: null,
    situacao: 'sem plano',
    data_referencia: '2026-10-10',
    erro: null,
    responsaveis: [],
    motivos: [
      {
        codigo: 'sem_plano',
        nivel: 'info',
        texto: 'Este centro não tem plano de trabalho ativo: falta o previsto por rubrica.',
        grupo_code: null,
        valor: null,
      },
    ],
  },
  {
    id: IDS.estacoes,
    code: '30.906',
    name: 'Rede de Estações Serra',
    end_date: '2027-05-31',
    drive_folder_url: 'https://drive.google.com/drive/folders/exemplo-30906',
    livre: null,
    situacao: 'sem dado',
    data_referencia: null,
    erro: 'falha_saldo_livre',
    responsaveis: ['Profa. Beatriz Cunha'],
    motivos: [
      {
        codigo: 'falha',
        nivel: 'info',
        texto: 'Não foi possível calcular o saldo deste centro.',
        grupo_code: null,
        valor: null,
      },
    ],
  },
  {
    id: IDS.corredor,
    code: '30.907',
    name: 'Corredor Ecológico Oeste',
    end_date: '2027-11-30',
    drive_folder_url: 'https://drive.google.com/drive/folders/exemplo-30907',
    livre: 34000,
    situacao: 'atenção',
    data_referencia: '2026-10-18',
    erro: null,
    responsaveis: ['Profa. Clara Mendes'],
    motivos: [
      {
        codigo: 'pendencias_abertas',
        nivel: 'atenção',
        texto:
          '1 pendência aberta: Planilha de novembro encerraria duas bolsas antes do previsto',
        grupo_code: null,
        valor: null,
      },
    ],
  },
  {
    id: IDS.solos,
    code: '30.908',
    name: 'Observatório de Solos Leste',
    end_date: '2027-07-31',
    drive_folder_url: null,
    livre: 31500,
    situacao: 'em dia',
    data_referencia: '2026-10-22',
    erro: null,
    responsaveis: ['Prof. Renato Alves'],
  },
  {
    id: IDS.tarifa,
    code: '30.909',
    name: 'Bacia Experimental do Rio Claro',
    end_date: '2027-10-31',
    drive_folder_url: null,
    livre: 29985.66,
    situacao: 'atenção',
    data_referencia: '2026-10-25',
    erro: null,
    responsaveis: ['Prof. Renato Alves'],
    motivos: [
      {
        codigo: 'tarifa_bancaria',
        nivel: 'atenção',
        texto:
          'Rubrica b — Serviços de Terceiros P. Jurídica: saldo livre R$ −14,34 por causa de R$ 14,34 de tarifa bancária sem previsão no plano; sem ela, ficaria dentro do previsto. É cobrança comum da FUNAPE; vale prever no próximo remanejamento.',
        grupo_code: 'b',
        valor: 14.34,
        tarifa: 14.34,
      },
    ],
  },
  {
    id: IDS.restinga,
    code: '30.910',
    name: 'Restinga Costeira Sul',
    end_date: '2027-08-31',
    drive_folder_url: null,
    livre: 52000,
    situacao: 'atenção',
    data_referencia: '2026-10-15',
    erro: null,
    responsaveis: ['Profa. Beatriz Cunha'],
    motivos: [
      {
        codigo: 'folha_atrasada',
        nivel: 'atenção',
        texto:
          'A folha de out/26 foi paga depois do balancete de 15/10/2026 e ainda não aparece no realizado: R$ 8.000,00 somados aos compromissos de bolsas.',
        grupo_code: 'a',
        valor: 8000,
      },
    ],
  },
];

let ocultosAtuais = new Set([IDS.corredor, IDS.solos]);

const agora = Date.now();
const horasAtras = (h) => new Date(agora - h * 3_600_000).toISOString();

let pendenciasEstado = [
  {
    id: 'pend-01',
    project_id: IDS.atlas,
    code: '30.902',
    tipo: 'balancete',
    titulo: 'Conta 7.1.3.99 sem rubrica no balancete de ago/26',
    detalhe: {
      conta: '7.1.3.99',
      competencia: '2026-08-15',
      descricao: 'Lançamento identificado sem vínculo automático com rubrica do plano.',
    },
    situacao: 'aberta',
    origem: 'sistema',
    criada_em: horasAtras(2),
  },
  {
    id: 'pend-02',
    project_id: IDS.atlas,
    code: '30.902',
    tipo: 'contrato',
    titulo: 'Aditivo sem data de evento informada',
    detalhe: {
      documento: 'Segundo termo aditivo',
      descricao: 'Vigência condicionada à entrega de relatório parcial.',
    },
    situacao: 'aberta',
    origem: 'sistema',
    criada_em: horasAtras(26),
  },
  {
    id: 'pend-03',
    project_id: IDS.nascentes,
    code: '30.903',
    tipo: 'plano',
    titulo: 'Equipamentos acima do previsto exige remanejamento',
    detalhe: {
      rubrica: 'Equipamentos e material permanente',
      diferenca: -4250,
    },
    situacao: 'aberta',
    origem: 'sistema',
    criada_em: horasAtras(50),
  },
  {
    id: 'pend-04',
    project_id: IDS.corredor,
    code: '30.907',
    tipo: 'bolsas',
    titulo: 'Planilha de novembro encerraria duas bolsas antes do previsto',
    detalhe: {
      quantidade: 2,
      referencia: 'nov/26',
    },
    situacao: 'aberta',
    origem: 'buriti',
    criada_em: horasAtras(6),
  },
  {
    id: 'pend-05',
    project_id: null,
    code: null,
    tipo: 'cadastro',
    titulo: 'Conferir tabela geral de tetos de bolsas para 2027',
    detalhe: {
      escopo: 'Todos os centros ativos',
    },
    situacao: 'aberta',
    origem: 'claude',
    criada_em: horasAtras(4),
  },
  {
    id: 'pend-06',
    project_id: IDS.cerrado,
    code: '30.901',
    tipo: 'balancete',
    titulo: 'Diferença de centavos conferida no balancete de set/26',
    detalhe: {
      observacao: 'Conferido contra extrato bancário do mês anterior.',
    },
    situacao: 'resolvida',
    origem: 'pessoa',
    criada_em: horasAtras(240),
  },
];

const SALDOS_EXEMPLO = {
  [IDS.cerrado]: {
    has_plano: true,
    has_balancete: true,
    project_id: IDS.cerrado,
    project_name: 'Bacia do Cerrado Norte',
    end_date: '2027-09-30',
    meses_restantes: 11,
    data_referencia: '2026-10-15',
    balancete_cobre_ate: '2026-10-01',
    balancete_defasagem_meses: 1,
    compromissos_inicio: '2026-11-01',
    compromissos_fim: '2027-09-30',
    saldo_disponivel_caixa: 184250.4,
    rendimento_liquido: 11240.15,
    compromissos_bolsas: 193400,
    bolsas_ativas: [
      {
        scholarship_id: 'b-901-1',
        bolsista: 'Bolsista A (Pesquisa)',
        valor_mensal: 6200,
        end_date: '2027-09-30',
        meses: 11,
        compromisso: 68200,
      },
      {
        scholarship_id: 'b-901-2',
        bolsista: 'Bolsista B (Geoprocessamento)',
        valor_mensal: 4800,
        end_date: '2027-09-30',
        meses: 11,
        compromisso: 52800,
      },
      {
        scholarship_id: 'b-901-3',
        bolsista: 'Bolsista C (Sensoriamento)',
        valor_mensal: 8600,
        end_date: '2027-06-30',
        meses: 8,
        compromisso: 68800,
      },
      {
        scholarship_id: 'b-901-4',
        bolsista: 'Bolsista D (Encerrada na janela)',
        valor_mensal: 3600,
        end_date: '2026-11-20',
        meses: 1,
        compromisso: 3600,
      },
    ],
    grupos: [
      {
        grupo_code: 'a',
        grupo_name: 'Pessoal',
        previsto: 864000,
        realizado: 612400,
        saldo: 251600,
        compromissos: 193400,
        saldo_livre: 58200,
        compromissos_cobertura: 'bolsas',
      },
      {
        grupo_code: 'b',
        grupo_name: 'Serviços de terceiros (PJ)',
        previsto: 120000,
        realizado: 105900,
        saldo: 14100,
        compromissos: 0,
        saldo_livre: 14100,
        compromissos_cobertura: 'nenhuma',
      },
      {
        grupo_code: 'f',
        grupo_name: 'Equipamentos e material permanente',
        previsto: 80000,
        realizado: 68000,
        saldo: 12000,
        compromissos: 0,
        saldo_livre: 12000,
        compromissos_cobertura: 'nenhuma',
      },
      {
        grupo_code: 'cip_ufg',
        grupo_name: 'Custos Indiretos (CIP) — UFG',
        previsto: 150000,
        realizado: 120000,
        saldo: 30000,
        compromissos: 30000,
        saldo_livre: 0,
        compromissos_cobertura: 'taxas',
      },
    ],
    rubricas: [
      {
        rubrica_code: 'a.bolsas',
        rubrica_name: 'Bolsas de pesquisa',
        grupo_code: 'a',
        previsto: 780000,
        realizado: 540000,
        saldo: 240000,
        compromissos: 193400,
        saldo_livre: 46600,
        compromisso_tipo: 'bolsas',
      },
      {
        rubrica_code: 'a.estag',
        rubrica_name: 'Auxílio a colaboradores',
        grupo_code: 'a',
        previsto: 84000,
        realizado: 72400,
        saldo: 11600,
        compromissos: 0,
        saldo_livre: 11600,
      },
      {
        rubrica_code: 'b.pj',
        rubrica_name: 'Serviços técnicos especializados',
        grupo_code: 'b',
        previsto: 120000,
        realizado: 105900,
        saldo: 14100,
        compromissos: 0,
        saldo_livre: 14100,
      },
      {
        rubrica_code: 'f.equip',
        rubrica_name: 'Servidores e estações de trabalho',
        grupo_code: 'f',
        previsto: 80000,
        realizado: 68000,
        saldo: 12000,
        compromissos: 0,
        saldo_livre: 12000,
      },
      {
        rubrica_code: 'cip_ufg',
        rubrica_name: 'Custos Indiretos (CIP) — UFG',
        grupo_code: 'cip_ufg',
        previsto: 150000,
        realizado: 120000,
        saldo: 30000,
        compromissos: 30000,
        saldo_livre: 0,
        compromisso_tipo: 'taxa',
      },
    ],
    avisos: [],
    nota: 'Dados sintéticos de demonstração.',
  },
  [IDS.atlas]: {
    has_plano: true,
    has_balancete: true,
    project_id: IDS.atlas,
    project_name: 'Atlas Hídrico do Planalto',
    end_date: '2027-03-31',
    meses_restantes: 5,
    data_referencia: '2026-08-15',
    balancete_cobre_ate: '2026-08-01',
    balancete_defasagem_meses: 3,
    compromissos_inicio: '2026-09-01',
    compromissos_fim: '2027-03-31',
    saldo_disponivel_caixa: 40000,
    rendimento_liquido: 3180,
    compromissos_bolsas: 40000,
    bolsas_ativas: [
      {
        scholarship_id: 'b-902-1',
        bolsista: 'Bolsista E (Hidrologia)',
        valor_mensal: 5000,
        end_date: '2027-01-31',
        meses: 5,
        compromisso: 25000,
      },
      {
        scholarship_id: 'b-902-2',
        bolsista: 'Bolsista F (Cartografia)',
        valor_mensal: 3000,
        end_date: '2027-01-31',
        meses: 5,
        compromisso: 15000,
      },
    ],
    grupos: [
      {
        grupo_code: 'a',
        grupo_name: 'Pessoal',
        previsto: 320000,
        realizado: 267100,
        saldo: 52900,
        compromissos: 40000,
        saldo_livre: 12900,
        compromissos_cobertura: 'bolsas',
      },
      {
        grupo_code: 'd',
        grupo_name: 'Diárias e passagens',
        previsto: 60000,
        realizado: 53500,
        saldo: 6500,
        compromissos: 0,
        saldo_livre: 6500,
        compromissos_cobertura: 'nenhuma',
      },
    ],
    rubricas: [
      {
        rubrica_code: 'a.bolsas',
        rubrica_name: 'Bolsas de pesquisa',
        grupo_code: 'a',
        previsto: 320000,
        realizado: 267100,
        saldo: 52900,
        compromissos: 40000,
        saldo_livre: 12900,
        compromisso_tipo: 'bolsas',
      },
      {
        rubrica_code: 'd.diarias',
        rubrica_name: 'Diárias de campo',
        grupo_code: 'd',
        previsto: 60000,
        realizado: 53500,
        saldo: 6500,
        compromissos: 0,
        saldo_livre: 6500,
      },
    ],
    avisos: ['Balancete defasado: última referência de agosto de 2026.'],
    nota: 'Dados sintéticos de demonstração.',
  },
  [IDS.nascentes]: {
    has_plano: true,
    has_balancete: true,
    project_id: IDS.nascentes,
    project_name: 'Monitoramento de Nascentes',
    end_date: '2027-06-30',
    meses_restantes: 8,
    data_referencia: '2026-10-20',
    balancete_cobre_ate: '2026-10-01',
    balancete_defasagem_meses: 1,
    compromissos_inicio: '2026-11-01',
    compromissos_fim: '2027-06-30',
    saldo_disponivel_caixa: 54000,
    rendimento_liquido: 2100,
    compromissos_bolsas: 32000,
    bolsas_ativas: [
      {
        scholarship_id: 'b-903-1',
        bolsista: 'Bolsista G (Campo)',
        valor_mensal: 4000,
        end_date: '2027-06-30',
        meses: 8,
        compromisso: 32000,
      },
    ],
    grupos: [
      {
        grupo_code: 'a',
        grupo_name: 'Pessoal',
        previsto: 240000,
        realizado: 188000,
        saldo: 52000,
        compromissos: 32000,
        saldo_livre: 20000,
        compromissos_cobertura: 'bolsas',
      },
      {
        grupo_code: 'f',
        grupo_name: 'Equipamentos e material permanente',
        previsto: 95000,
        realizado: 99250,
        saldo: -4250,
        compromissos: 0,
        saldo_livre: -4250,
        compromissos_cobertura: 'nenhuma',
      },
    ],
    rubricas: [
      {
        rubrica_code: 'a.bolsas',
        rubrica_name: 'Bolsas de pesquisa',
        grupo_code: 'a',
        previsto: 240000,
        realizado: 188000,
        saldo: 52000,
        compromissos: 32000,
        saldo_livre: 20000,
        compromisso_tipo: 'bolsas',
      },
      {
        rubrica_code: 'f.sensores',
        rubrica_name: 'Sensores hidrológicos',
        grupo_code: 'f',
        previsto: 95000,
        realizado: 99250,
        saldo: -4250,
        compromissos: 0,
        saldo_livre: -4250,
      },
    ],
    avisos: [],
    nota: 'Dados sintéticos de demonstração.',
  },
  [IDS.veredas]: {
    has_plano: true,
    has_balancete: false,
    project_id: IDS.veredas,
    project_name: 'Mapeamento de Veredas',
    end_date: '2027-12-31',
    meses_restantes: 14,
    data_referencia: null,
    balancete_cobre_ate: null,
    balancete_defasagem_meses: null,
    compromissos_inicio: '2026-11-01',
    compromissos_fim: '2027-12-31',
    saldo_disponivel_caixa: null,
    rendimento_liquido: null,
    compromissos_bolsas: 56000,
    bolsas_ativas: [
      {
        scholarship_id: 'b-904-1',
        bolsista: 'Bolsista H (Sensoriamento)',
        valor_mensal: 4000,
        end_date: '2027-12-31',
        meses: 14,
        compromisso: 56000,
      },
    ],
    grupos: [
      {
        grupo_code: 'a',
        grupo_name: 'Pessoal',
        previsto: 360000,
        realizado: 0,
        saldo: 360000,
        compromissos: 56000,
        saldo_livre: 304000,
        compromissos_cobertura: 'bolsas',
      },
      {
        grupo_code: 'e',
        grupo_name: 'Material de consumo',
        previsto: 45000,
        realizado: 0,
        saldo: 45000,
        compromissos: 0,
        saldo_livre: 45000,
        compromissos_cobertura: 'nenhuma',
      },
    ],
    rubricas: [
      {
        rubrica_code: 'a.bolsas',
        rubrica_name: 'Bolsas de pesquisa',
        grupo_code: 'a',
        previsto: 360000,
        realizado: 0,
        saldo: 360000,
        compromissos: 56000,
        saldo_livre: 304000,
        compromisso_tipo: 'bolsas',
      },
      {
        rubrica_code: 'e.consumo',
        rubrica_name: 'Material de campo',
        grupo_code: 'e',
        previsto: 45000,
        realizado: 0,
        saldo: 45000,
        compromissos: 0,
        saldo_livre: 45000,
      },
    ],
    avisos: ['Sem balancete importado: realizado igual a zero.'],
    nota: 'Dados sintéticos de demonstração.',
  },
  [IDS.florestal]: {
    has_plano: false,
    has_balancete: true,
    project_id: IDS.florestal,
    project_name: 'Inventário Florestal Sul',
    message: 'Sem plano de trabalho ativo: não há previsto por rubrica para descontar.',
  },
  [IDS.corredor]: {
    has_plano: true,
    has_balancete: true,
    project_id: IDS.corredor,
    project_name: 'Corredor Ecológico Oeste',
    end_date: '2027-11-30',
    meses_restantes: 13,
    data_referencia: '2026-10-18',
    balancete_cobre_ate: '2026-10-01',
    balancete_defasagem_meses: 1,
    compromissos_inicio: '2026-11-01',
    compromissos_fim: '2027-11-30',
    saldo_disponivel_caixa: 92000,
    rendimento_liquido: 1850,
    compromissos_bolsas: 44000,
    bolsas_ativas: [
      {
        scholarship_id: 'b-907-1',
        bolsista: 'Bolsista I (Ecologia)',
        valor_mensal: 3000,
        end_date: '2027-10-31',
        meses: 12,
        compromisso: 36000,
      },
      {
        scholarship_id: 'b-907-2',
        bolsista: 'Bolsista J (Sensoriamento)',
        valor_mensal: 2000,
        end_date: '2027-07-31',
        meses: 4,
        compromisso: 8000,
      },
    ],
    grupos: [
      {
        grupo_code: 'a',
        grupo_name: 'Pessoal',
        previsto: 280000,
        realizado: 202000,
        saldo: 78000,
        compromissos: 44000,
        saldo_livre: 34000,
        compromissos_cobertura: 'bolsas',
      },
    ],
    rubricas: [
      {
        rubrica_code: 'a.bolsas',
        rubrica_name: 'Bolsas de pesquisa',
        grupo_code: 'a',
        previsto: 280000,
        realizado: 202000,
        saldo: 78000,
        compromissos: 44000,
        saldo_livre: 34000,
        compromisso_tipo: 'bolsas',
      },
    ],
    avisos: [],
    nota: 'Dados sintéticos de demonstração.',
  },
  [IDS.solos]: {
    has_plano: true,
    has_balancete: true,
    project_id: IDS.solos,
    project_name: 'Observatório de Solos Leste',
    end_date: '2027-07-31',
    meses_restantes: 9,
    data_referencia: '2026-10-22',
    balancete_cobre_ate: '2026-10-01',
    balancete_defasagem_meses: 1,
    compromissos_inicio: '2026-11-01',
    compromissos_fim: '2027-07-31',
    saldo_disponivel_caixa: 78000,
    rendimento_liquido: 1400,
    compromissos_bolsas: 0,
    bolsas_ativas: [],
    grupos: [
      {
        grupo_code: 'c',
        grupo_name: 'Passagens e locomoção',
        previsto: 90000,
        realizado: 58500,
        saldo: 31500,
        compromissos: 0,
        saldo_livre: 31500,
        compromissos_cobertura: 'nenhuma',
      },
    ],
    rubricas: [
      {
        rubrica_code: 'c.passagens',
        rubrica_name: 'Passagens nacionais',
        grupo_code: 'c',
        previsto: 90000,
        realizado: 58500,
        saldo: 31500,
        compromissos: 0,
        saldo_livre: 31500,
      },
    ],
    avisos: [],
    nota: 'Dados sintéticos de demonstração.',
  },
  [IDS.tarifa]: {
    has_plano: true,
    has_balancete: true,
    project_id: IDS.tarifa,
    project_name: 'Bacia Experimental do Rio Claro',
    end_date: '2027-10-31',
    meses_restantes: 11,
    data_referencia: '2026-10-25',
    balancete_cobre_ate: '2026-10-01',
    balancete_defasagem_meses: 1,
    compromissos_inicio: '2026-11-01',
    compromissos_fim: '2027-10-31',
    saldo_disponivel_caixa: 40000,
    rendimento_liquido: 500,
    compromissos_bolsas: 0,
    bolsas_ativas: [],
    grupos: [
      {
        grupo_code: 'a',
        grupo_name: 'Pessoal',
        previsto: 60000,
        realizado: 30000,
        saldo: 30000,
        compromissos: 0,
        saldo_livre: 30000,
        compromissos_cobertura: 'nenhuma',
      },
      {
        grupo_code: 'b',
        grupo_name: 'Serviços de Terceiros P. Jurídica',
        previsto: 0,
        realizado: 14.34,
        saldo: -14.34,
        compromissos: 0,
        saldo_livre: -14.34,
        compromissos_cobertura: 'nenhuma',
      },
    ],
    rubricas: [
      {
        rubrica_code: 'a.bolsas',
        rubrica_name: 'Bolsas de pesquisa',
        grupo_code: 'a',
        previsto: 60000,
        realizado: 30000,
        saldo: 30000,
        compromissos: 0,
        saldo_livre: 30000,
      },
      {
        rubrica_code: 'b.servicos',
        rubrica_name: 'Serviços de terceiros',
        grupo_code: 'b',
        previsto: 0,
        realizado: 14.34,
        saldo: -14.34,
        compromissos: 0,
        saldo_livre: -14.34,
      },
    ],
    avisos: [],
    nota: 'Dados sintéticos de demonstração.',
  },
  [IDS.restinga]: {
    has_plano: true,
    has_balancete: true,
    project_id: IDS.restinga,
    project_name: 'Restinga Costeira Sul',
    end_date: '2027-08-31',
    meses_restantes: 10,
    data_referencia: '2026-10-15',
    balancete_cobre_ate: '2026-10-01',
    balancete_defasagem_meses: 1,
    compromissos_inicio: '2026-11-01',
    compromissos_fim: '2027-08-31',
    saldo_disponivel_caixa: 60000,
    rendimento_liquido: 0,
    compromissos_bolsas: 88000,
    folha_conferencia: 'feita',
    folha_atrasada: {
      valor: 8000,
      esperado: 8000,
      visto: 0,
      desde_balancete: '2026-09-15',
      balancete: '2026-10-15',
      mes_inicio: '2026-10-01',
      mes_fim: '2026-10-01',
    },
    bolsas_ativas: [
      {
        scholarship_id: 'b-910-1',
        bolsista: 'Bolsista K (Campo)',
        valor_mensal: 4000,
        end_date: '2027-08-31',
        meses: 10,
        compromisso: 40000,
      },
      {
        scholarship_id: 'b-910-2',
        bolsista: 'Bolsista L (Laboratório)',
        valor_mensal: 4000,
        end_date: '2027-08-31',
        meses: 10,
        compromisso: 40000,
      },
    ],
    grupos: [
      {
        grupo_code: 'a',
        grupo_name: 'Pessoal',
        previsto: 400000,
        realizado: 260000,
        saldo: 140000,
        compromissos: 88000,
        saldo_livre: 52000,
        compromissos_cobertura: 'bolsas',
      },
    ],
    rubricas: [
      {
        rubrica_code: 'a.bolsas',
        rubrica_name: 'Bolsas de pesquisa',
        grupo_code: 'a',
        previsto: 400000,
        realizado: 260000,
        saldo: 140000,
        compromissos: 88000,
        saldo_livre: 52000,
        compromisso_tipo: 'bolsas',
      },
    ],
    avisos: [
      'A folha de out/26 foi paga depois do balancete de 15/10/2026 e não aparece nele: R$ 8.000,00 somados aos compromissos de bolsas.',
    ],
    nota: 'Dados sintéticos de demonstração.',
  },
};

const REPASSES_EXEMPLO = {
  [IDS.cerrado]: {
    parcelas: [
      { parcela: 1, data_prevista: '2026-01-15', data_texto: null, valor: 250000, valor_texto: null },
      { parcela: 2, data_prevista: '2026-06-15', data_texto: null, valor: 350000, valor_texto: null },
      { parcela: 3, data_prevista: '2027-01-20', data_texto: null, valor: 264000, valor_texto: null },
      { parcela: 4, data_prevista: '2027-05-15', data_texto: null, valor: 200000, valor_texto: null },
    ],
    valor_total_plano: 1064000,
    data_balancete: '2026-10-15',
    recursos: { recebido: 600000, a_receber: 0 },
  },
  [IDS.atlas]: {
    parcelas: [
      { parcela: 1, data_prevista: '2026-02-10', data_texto: null, valor: 140000, valor_texto: null },
      { parcela: 2, data_prevista: '2026-07-15', data_texto: null, valor: 120000, valor_texto: null },
      { parcela: 3, data_prevista: '2027-01-10', data_texto: null, valor: 120000, valor_texto: null },
    ],
    valor_total_plano: 380000,
    data_balancete: '2026-08-15',
    recursos: { recebido: 140000, a_receber: 0 },
  },
  [IDS.nascentes]: {
    parcelas: [
      { parcela: 1, data_prevista: '2026-03-01', data_texto: null, valor: 180000, valor_texto: null },
      { parcela: 2, data_prevista: '2026-09-01', data_texto: null, valor: 155000, valor_texto: null },
    ],
    valor_total_plano: 335000,
    data_balancete: '2026-10-20',
    recursos: { recebido: 335000, a_receber: 0 },
  },
  [IDS.veredas]: {
    parcelas: [
      { parcela: 1, data_prevista: '2026-08-01', data_texto: null, valor: 200000, valor_texto: null },
      { parcela: 2, data_prevista: '2027-02-01', data_texto: null, valor: 205000, valor_texto: null },
    ],
    valor_total_plano: 405000,
    data_balancete: null,
    recursos: null,
  },
  [IDS.florestal]: {
    parcelas: [],
    valor_total_plano: null,
    data_balancete: '2026-10-10',
    recursos: { recebido: 95000, a_receber: 0 },
  },
  [IDS.estacoes]: {
    parcelas: [],
    valor_total_plano: null,
    data_balancete: null,
    recursos: null,
  },
  [IDS.corredor]: {
    parcelas: [
      { parcela: 1, data_prevista: '2026-04-10', data_texto: null, valor: 140000, valor_texto: null },
      { parcela: 2, data_prevista: '2027-03-10', data_texto: null, valor: 140000, valor_texto: null },
    ],
    valor_total_plano: 280000,
    data_balancete: '2026-10-18',
    recursos: { recebido: 140000, a_receber: 0 },
  },
  [IDS.solos]: {
    parcelas: [
      { parcela: 1, data_prevista: '2026-05-01', data_texto: null, valor: 90000, valor_texto: null },
    ],
    valor_total_plano: 90000,
    data_balancete: '2026-10-22',
    recursos: { recebido: 90000, a_receber: 0 },
  },
  [IDS.tarifa]: {
    parcelas: [
      { parcela: 1, data_prevista: '2026-05-01', data_texto: null, valor: 60000, valor_texto: null },
    ],
    valor_total_plano: 60000,
    data_balancete: '2026-10-25',
    recursos: { recebido: 30000, a_receber: 0 },
  },
  [IDS.restinga]: {
    parcelas: [
      { parcela: 1, data_prevista: '2026-03-10', data_texto: null, valor: 200000, valor_texto: null },
      { parcela: 2, data_prevista: '2026-09-10', data_texto: null, valor: 200000, valor_texto: null },
    ],
    valor_total_plano: 400000,
    data_balancete: '2026-10-15',
    recursos: { recebido: 400000, a_receber: 0 },
  },
};

const BALANCETES_EXEMPLO = {
  [IDS.cerrado]: [
    {
      id: '00000000-0000-4000-8000-000000090102',
      data_referencia: '2026-10-15',
      arquivo_nome: 'balancete-30901-out-26.pdf',
      saldo_disponivel: 184250.4,
      rendimento_liquido: 11240.15,
      created_at: '2026-10-16T14:00:00Z',
    },
    {
      id: '00000000-0000-4000-8000-000000090101',
      data_referencia: '2026-09-15',
      arquivo_nome: 'balancete-30901-set-26.pdf',
      saldo_disponivel: 210400,
      rendimento_liquido: 9800.5,
      created_at: '2026-09-16T14:00:00Z',
    },
  ],
  [IDS.atlas]: [
    {
      id: '00000000-0000-4000-8000-000000090201',
      data_referencia: '2026-08-15',
      arquivo_nome: 'balancete-30902-ago-26.pdf',
      saldo_disponivel: 40000,
      rendimento_liquido: 3180,
      created_at: '2026-08-16T10:00:00Z',
    },
  ],
  [IDS.nascentes]: [
    {
      id: '00000000-0000-4000-8000-000000090301',
      data_referencia: '2026-10-20',
      arquivo_nome: 'balancete-30903-out-26.pdf',
      saldo_disponivel: 54000,
      rendimento_liquido: 2100,
      created_at: '2026-10-21T10:00:00Z',
    },
  ],
  [IDS.florestal]: [
    {
      id: '00000000-0000-4000-8000-000000090501',
      data_referencia: '2026-10-10',
      arquivo_nome: 'balancete-30905-out-26.pdf',
      saldo_disponivel: 48000,
      rendimento_liquido: null,
      created_at: '2026-10-11T10:00:00Z',
    },
  ],
  [IDS.corredor]: [
    {
      id: '00000000-0000-4000-8000-000000090701',
      data_referencia: '2026-10-18',
      arquivo_nome: 'balancete-30907-out-26.pdf',
      saldo_disponivel: 92000,
      rendimento_liquido: 1850,
      created_at: '2026-10-19T10:00:00Z',
    },
  ],
  [IDS.solos]: [
    {
      id: '00000000-0000-4000-8000-000000090801',
      data_referencia: '2026-10-22',
      arquivo_nome: 'balancete-30908-out-26.pdf',
      saldo_disponivel: 78000,
      rendimento_liquido: 1400,
      created_at: '2026-10-23T10:00:00Z',
    },
  ],
  [IDS.tarifa]: [
    {
      id: '00000000-0000-4000-8000-000000090901',
      data_referencia: '2026-10-25',
      arquivo_nome: 'balancete-30909-out-26.pdf',
      saldo_disponivel: 40000,
      rendimento_liquido: 500,
      created_at: '2026-10-26T10:00:00Z',
    },
  ],
  [IDS.restinga]: [
    {
      id: '00000000-0000-4000-8000-000000091002',
      data_referencia: '2026-10-15',
      arquivo_nome: 'balancete-30910-out-26.pdf',
      saldo_disponivel: 60000,
      rendimento_liquido: 0,
      created_at: '2026-10-16T10:00:00Z',
    },
    {
      id: '00000000-0000-4000-8000-000000091001',
      data_referencia: '2026-09-15',
      arquivo_nome: 'balancete-30910-set-26.pdf',
      saldo_disponivel: 68000,
      rendimento_liquido: 0,
      created_at: '2026-09-16T10:00:00Z',
    },
  ],
};

const PLANOS_EXEMPLO = {
  [IDS.cerrado]: [
    {
      id: '00000000-0000-4000-8000-000000080102',
      versao: 2,
      tipo: 'remanejamento',
      data_documento: '2026-06-10',
      ativo: true,
      titulo: 'Primeiro remanejamento aprovado',
      valor_total_plano: 1064000,
      arquivo_nome: 'plano-trabalho-30901-v2.docx',
      created_at: '2026-06-11T09:00:00Z',
    },
    {
      id: '00000000-0000-4000-8000-000000080101',
      versao: 1,
      tipo: 'original',
      data_documento: '2025-11-05',
      ativo: false,
      titulo: 'Plano de trabalho inicial',
      valor_total_plano: 1064000,
      arquivo_nome: 'plano-trabalho-30901-v1.docx',
      created_at: '2025-11-06T09:00:00Z',
    },
  ],
  [IDS.atlas]: [
    {
      id: '00000000-0000-4000-8000-000000080201',
      versao: 1,
      tipo: 'original',
      data_documento: '2026-01-20',
      ativo: true,
      titulo: 'Plano de trabalho vigente',
      valor_total_plano: 380000,
      arquivo_nome: 'plano-trabalho-30902.docx',
      created_at: '2026-01-21T09:00:00Z',
    },
  ],
  [IDS.nascentes]: [
    {
      id: '00000000-0000-4000-8000-000000080301',
      versao: 1,
      tipo: 'original',
      data_documento: '2026-02-12',
      ativo: true,
      titulo: 'Plano de trabalho vigente',
      valor_total_plano: 335000,
      arquivo_nome: 'plano-trabalho-30903.pdf',
      created_at: '2026-02-13T09:00:00Z',
    },
  ],
  [IDS.veredas]: [
    {
      id: '00000000-0000-4000-8000-000000080401',
      versao: 1,
      tipo: 'original',
      data_documento: '2026-07-01',
      ativo: true,
      titulo: 'Plano de trabalho inicial',
      valor_total_plano: 405000,
      arquivo_nome: 'plano-trabalho-30904.docx',
      created_at: '2026-07-02T09:00:00Z',
    },
  ],
  [IDS.tarifa]: [
    {
      id: '00000000-0000-4000-8000-000000080901',
      versao: 1,
      tipo: 'original',
      data_documento: '2026-01-10',
      ativo: true,
      titulo: 'Plano de trabalho vigente',
      valor_total_plano: 60000,
      arquivo_nome: 'plano-trabalho-30909.docx',
      created_at: '2026-01-11T09:00:00Z',
    },
  ],
};

const TERMOS_CONTRATO_EXEMPLO = {
  [IDS.cerrado]: {
    termos: {
      vigencia_inicio: {
        id: 'termo-30901-inicio',
        valor: '2025-12-31',
        regra: 'vigência definida no contrato',
        trecho:
          'CLÁUSULA SEGUNDA — a vigência é a definida no instrumento.',
        documento_nome: 'Contrato de prestação de serviços · 30.901',
        documento_url: 'https://drive.google.com/file/d/exemplo-contrato-30901/view',
        pagina: 2,
        nota: null,
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:10:00Z',
        conferido: true,
        conferido_em: '2026-11-18T16:00:00Z',
        versoes_anteriores: [],
      },
      vigencia_fim: {
        id: 'termo-30901-fim',
        valor: '2027-09-30',
        regra: 'vigência definida no contrato',
        trecho:
          'CLÁUSULA SEGUNDA — a vigência é a definida no instrumento.',
        documento_nome: 'Contrato de prestação de serviços · 30.901',
        documento_url: 'https://drive.google.com/file/d/exemplo-contrato-30901/view',
        pagina: 2,
        nota: null,
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:10:00Z',
        conferido: true,
        conferido_em: '2026-11-18T16:00:00Z',
        versoes_anteriores: [],
      },
      taxa_total: {
        id: 'termo-30901-total',
        valor: 9.75,
        regra: 'Project Overhead de 9,75% sobre o valor total do projeto',
        trecho:
          'ANEXO — Project Overhead: 9,75% do valor total do projeto.',
        documento_nome: 'Plano de trabalho · 30.901 v2',
        documento_url: null,
        documento_id: 'documento-plano-30901-v2',
        documento: null,
        pagina: 8,
        nota:
          'O contrato fixa 9,75% no total; a divisão por UFG, unidade e fundação aparece só em reais no plano. O arquivo do plano está no sistema, mas o modo exemplo não tem o PDF para abrir.',
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:12:00Z',
        conferido: false,
        conferido_em: null,
        versoes_anteriores: [],
      },
    },
  },
  [IDS.atlas]: {
    termos: {
      vigencia_inicio: {
        id: 'termo-30902-inicio',
        valor: '2025-08-30',
        regra: 'vigência definida no contrato',
        trecho:
          'CLÁUSULA SEGUNDA — a vigência é a definida no instrumento.',
        documento_nome: 'Contrato de prestação de serviços · 30.902',
        documento_url: 'https://drive.google.com/file/d/exemplo-contrato-30902/view',
        pagina: 3,
        nota: null,
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:20:00Z',
        conferido: true,
        conferido_em: '2026-11-18T16:10:00Z',
        versoes_anteriores: [],
      },
      vigencia_fim: {
        id: 'termo-30902-fim',
        valor: '2027-04-30',
        regra: 'vigência definida no contrato',
        trecho:
          'CLÁUSULA SEGUNDA — a vigência é a definida no instrumento.',
        documento_nome: 'Contrato de prestação de serviços · 30.902',
        documento_url: 'https://drive.google.com/file/d/exemplo-contrato-30902/view',
        pagina: 3,
        nota:
          'O cadastro está com 31/03/2027; a diferença de um mês veio da assinatura posterior do segundo signatário. Conferir com a coordenação antes de trocar a data do projeto.',
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:20:00Z',
        conferido: false,
        conferido_em: null,
        versoes_anteriores: [],
      },
      taxa_total: {
        id: 'termo-30902-total',
        valor: 9.75,
        regra: 'Custos Indiretos limitados a 9,75% pelo financiador',
        trecho: 'CLÁUSULA SÉTIMA — os Custos Indiretos ficam limitados a 9,75%.',
        documento_nome: 'Contrato de prestação de serviços · 30.902',
        documento_url: 'https://drive.google.com/file/d/exemplo-contrato-30902/view',
        pagina: 6,
        nota:
          'O contrato limita 9,75% de Custos Indiretos; o plano divide 5% + 6% + 4% = 15%. A diferença está no plano e não é corrigida aqui; conferir com a coordenação.',
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:22:00Z',
        conferido: false,
        conferido_em: null,
        versoes_anteriores: [],
      },
      taxa_cip_ufg: {
        id: 'termo-30902-cip-ufg',
        valor: 5,
        regra: 'divisão da taxa no plano de trabalho',
        trecho: 'CLÁUSULA QUARTA — taxa de administração de 5% para a UFG.',
        documento_nome: 'Plano de trabalho · 30.902',
        documento_url: 'https://drive.google.com/file/d/exemplo-plano-30902/view',
        pagina: 4,
        nota: null,
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:24:00Z',
        conferido: false,
        conferido_em: null,
        versoes_anteriores: [],
      },
      taxa_cip_ua: {
        id: 'termo-30902-cip-ua',
        valor: 6,
        regra: 'divisão da taxa no plano de trabalho',
        trecho: 'CLÁUSULA QUARTA — taxa de administração de 6% para a unidade executora.',
        documento_nome: 'Plano de trabalho · 30.902',
        documento_url: 'https://drive.google.com/file/d/exemplo-plano-30902/view',
        pagina: 4,
        nota: null,
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:24:00Z',
        conferido: false,
        conferido_em: null,
        versoes_anteriores: [],
      },
      taxa_dao: {
        id: 'termo-30902-dao',
        valor: 4,
        regra: 'divisão da taxa no plano de trabalho',
        trecho: 'CLÁUSULA QUINTA — taxa de 4% para a fundação de apoio.',
        documento_nome: 'Plano de trabalho · 30.902',
        documento_url: 'https://drive.google.com/file/d/exemplo-plano-30902/view',
        pagina: 5,
        nota: null,
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:24:00Z',
        conferido: false,
        conferido_em: null,
        versoes_anteriores: [],
      },
    },
  },
  [IDS.veredas]: {
    termos: {
      vigencia_fim: {
        id: 'termo-30904-fim',
        valor: '2027-12-31',
        regra: 'vigência prorrogada pelo termo aditivo',
        trecho:
          'CLÁUSULA TERCEIRA — fica prorrogada a vigência do instrumento até 31 de dezembro de 2027.',
        documento_nome: 'Termo aditivo · 30.904',
        documento_url: 'https://docs.google.com/document/d/exemplo-aditivo-30904/view',
        pagina: 1,
        nota:
          'A data de início ainda não está no banco; este termo só prorrogou o fim. O aditivo foi lido do Drive e conferido com a coordenação.',
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:30:00Z',
        conferido: true,
        conferido_em: '2026-11-18T16:20:00Z',
        versoes_anteriores: [],
      },
      taxa_cip_ufg: {
        id: 'termo-30904-cip-ufg',
        valor: 3,
        regra: 'divisão da taxa no plano de trabalho',
        trecho: 'CLÁUSULA QUARTA — taxa de administração de 3% para a UFG.',
        documento_nome: 'Termo aditivo · 30.904',
        documento_url: 'https://docs.google.com/document/d/exemplo-aditivo-30904/view',
        pagina: 2,
        nota: null,
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:32:00Z',
        conferido: false,
        conferido_em: null,
        versoes_anteriores: [],
      },
      taxa_cip_ua: {
        id: 'termo-30904-cip-ua',
        valor: 4,
        regra: 'divisão da taxa no plano de trabalho',
        trecho: 'CLÁUSULA QUARTA — taxa de administração de 4% para a unidade executora.',
        documento_nome: 'Termo aditivo · 30.904',
        documento_url: 'https://docs.google.com/document/d/exemplo-aditivo-30904/view',
        pagina: 2,
        nota: null,
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:32:00Z',
        conferido: false,
        conferido_em: null,
        versoes_anteriores: [],
      },
      taxa_dao: {
        id: 'termo-30904-dao',
        valor: 2,
        regra: 'divisão da taxa no plano de trabalho',
        trecho: 'CLÁUSULA QUINTA — taxa de 2% para a fundação de apoio.',
        documento_nome: 'Termo aditivo · 30.904',
        documento_url: 'https://docs.google.com/document/d/exemplo-aditivo-30904/view',
        pagina: 3,
        nota: null,
        origem: 'ia',
        autor: 'Claude',
        criado_em: '2026-11-18T15:32:00Z',
        conferido: false,
        conferido_em: null,
        versoes_anteriores: [],
      },
    },
  },
};

let termosContratoEstado = structuredClone(TERMOS_CONTRATO_EXEMPLO);

function contarPendenciasAbertas(projectId) {
  return pendenciasEstado.filter((p) => p.project_id === projectId && p.situacao === 'aberta').length;
}

export async function resumoProjetos() {
  const todos = CENTROS_BASE.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    responsaveis: [...c.responsaveis],
    oculto: ocultosAtuais.has(c.id),
  }));

  const centros = CENTROS_BASE
    .filter((c) => !ocultosAtuais.has(c.id))
    .map((c) => ({
      ...c,
      responsaveis: [...c.responsaveis],
      motivos: structuredClone(c.motivos || []),
      pendencias_abertas: contarPendenciasAbertas(c.id),
    }));

  return {
    dados: {
      centros,
      ocultos: todos.filter((c) => c.oculto).length,
      todos,
    },
    erro: null,
  };
}

export async function situacaoCentro(projectId) {
  if (ocultosAtuais.has(projectId)) {
    return { dados: null, erro: null };
  }
  const centro = CENTROS_BASE.find((c) => c.id === projectId);
  if (!centro) {
    return { dados: null, erro: 'Centro de custo não encontrado.' };
  }
  return {
    dados: {
      situacao: centro.situacao,
      motivos: structuredClone(centro.motivos || []),
    },
    erro: null,
  };
}

export async function pendencias(projectId = null) {
  const lista = pendenciasEstado
    .filter((p) => {
      if (projectId) return p.project_id === projectId;
      return p.project_id === null || !ocultosAtuais.has(p.project_id);
    })
    .map((p) => ({ ...p, detalhe: { ...p.detalhe } }))
    .sort((a, b) => {
      if (a.situacao === 'aberta' && b.situacao !== 'aberta') return -1;
      if (a.situacao !== 'aberta' && b.situacao === 'aberta') return 1;
      return String(b.criada_em).localeCompare(String(a.criada_em));
    });

  return { dados: lista, erro: null };
}

export async function resolverPendencia(id, situacao) {
  if (situacao !== 'resolvida' && situacao !== 'descartada') {
    return { dados: null, erro: 'Situação inválida.' };
  }
  const alvo = pendenciasEstado.find((p) => p.id === id);
  if (!alvo) {
    return { dados: null, erro: 'Pendência não encontrada.' };
  }
  alvo.situacao = situacao;
  return { dados: { id: alvo.id, situacao: alvo.situacao }, erro: null };
}

export async function filtroVisao() {
  return { dados: { centros_ocultos: Array.from(ocultosAtuais) }, erro: null };
}

export async function salvarFiltroVisao(centrosOcultos) {
  const validos = new Set(CENTROS_BASE.map((c) => c.id));
  const proximo = new Set(
    (Array.isArray(centrosOcultos) ? centrosOcultos : []).filter((id) => validos.has(id))
  );
  ocultosAtuais = proximo;
  return { dados: { centros_ocultos: Array.from(ocultosAtuais) }, erro: null };
}

export async function saldoLivre(projectId) {
  if (projectId === IDS.estacoes) {
    return { dados: null, erro: 'Não foi possível calcular o saldo deste centro.' };
  }
  const dado = SALDOS_EXEMPLO[projectId];
  if (!dado) {
    return { dados: null, erro: 'Centro de custo não encontrado.' };
  }
  return { dados: structuredClone(dado), erro: null };
}

export async function repasses(projectId) {
  const dado = REPASSES_EXEMPLO[projectId];
  if (!dado) {
    return {
      dados: { parcelas: [], valor_total_plano: null, data_balancete: null, recursos: null },
      erro: null,
    };
  }
  return { dados: structuredClone(dado), erro: null };
}

export async function balancetes(projectId) {
  const lista = BALANCETES_EXEMPLO[projectId] || [];
  return { dados: structuredClone(lista), erro: null };
}

export async function planos(projectId) {
  const lista = PLANOS_EXEMPLO[projectId] || [];
  return { dados: structuredClone(lista), erro: null };
}

function normalizarDataCurta(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

export async function termosContrato(projectId) {
  const centro = CENTROS_BASE.find((c) => c.id === projectId);
  if (!centro) {
    return { dados: null, erro: 'Centro de custo não encontrado.' };
  }

  const base = termosContratoEstado[projectId];
  const termos = base?.termos ? structuredClone(base.termos) : {};
  const fim = normalizarDataCurta(termos.vigencia_fim?.valor);
  const cadastro = normalizarDataCurta(centro.end_date);
  const inicio = normalizarDataCurta(centro.start_date);
  const vigenciaConfere = fim && cadastro ? fim === cadastro : null;
  const vigenciaSituacao = !fim
    ? 'sem_contrato'
    : !cadastro
      ? 'sem_cadastro'
      : fim === cadastro
        ? 'confere'
        : 'diverge';

  return {
    dados: {
      termos,
      start_date_cadastro: inicio,
      end_date_cadastro: cadastro,
      vigencia_situacao: vigenciaSituacao,
      vigencia_confere: vigenciaConfere,
    },
    erro: null,
  };
}

export async function conferirTermoContrato(id) {
  for (const base of Object.values(termosContratoEstado)) {
    for (const termo of Object.values(base.termos || {})) {
      if (termo.id !== id) continue;
      const jaEstava = termo.conferido === true;
      if (!jaEstava) {
        termo.conferido = true;
        termo.conferido_em = new Date().toISOString();
      }
      return {
        dados: {
          id: termo.id,
          conferido_em: termo.conferido_em ?? null,
          ja_estava: jaEstava,
        },
        erro: null,
      };
    }
  }
  return { dados: null, erro: 'Termo do contrato não encontrado.' };
}

export async function usarVigenciaDoContrato(projectId) {
  const centro = CENTROS_BASE.find((c) => c.id === projectId);
  if (!centro) {
    return { dados: null, erro: 'Centro de custo não encontrado.' };
  }

  const base = termosContratoEstado[projectId];
  const fim = normalizarDataCurta(base?.termos?.vigencia_fim?.valor);
  if (!fim) {
    return { dados: null, erro: 'Sem vigência final do contrato registrada para este centro.' };
  }

  const inicio = normalizarDataCurta(base?.termos?.vigencia_inicio?.valor);
  const antes = {
    start_date: centro.start_date ?? null,
    end_date: centro.end_date ?? null,
  };

  centro.end_date = fim;
  if (inicio) centro.start_date = inicio;

  const saldo = SALDOS_EXEMPLO[projectId];
  if (saldo && typeof saldo === 'object') {
    saldo.end_date = fim;
  }

  const depois = {
    start_date: centro.start_date ?? null,
    end_date: centro.end_date ?? null,
  };

  return {
    dados: {
      project_id: projectId,
      antes,
      depois,
      mudou: antes.start_date !== depois.start_date || antes.end_date !== depois.end_date,
    },
    erro: null,
  };
}

function dataRelativaExemplo(dias) {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function hojeExemplo() {
  return dataRelativaExemplo(0);
}

function centroDoExemplo(projectId) {
  return CENTROS_BASE.find((c) => c.id === projectId) || null;
}

// 25 pessoas sintéticas em 4 centros fictícios. Nada aqui é nome real.
const BOLSISTAS_PEDIDO_EXEMPLO = [
  {
    holder_id: 'exemplo-bolsista-01',
    nome: 'Bolsista Ana',
    equipe: 'pastagem',
    bolsas: [{ id: 'exemplo-bolsa-01', projeto: IDS.cerrado, valor: 4200, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-02',
    nome: 'Bolsista Bento',
    equipe: 'pastagem',
    bolsas: [
      { id: 'exemplo-bolsa-02a', projeto: IDS.cerrado, valor: 3000, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' },
      { id: 'exemplo-bolsa-02b', projeto: IDS.atlas, valor: 1800, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' },
    ],
  },
  {
    holder_id: 'exemplo-bolsista-03',
    nome: 'Bolsista Carla',
    equipe: 'pastagem',
    bolsas: [{ id: 'exemplo-bolsa-03', projeto: IDS.atlas, valor: 3500, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(200), status: 'ended' }],
  },
  {
    holder_id: 'exemplo-bolsista-04',
    nome: 'Bolsista Caio',
    equipe: 'pastagem',
    bolsas: [
      { id: 'exemplo-bolsa-04a', projeto: IDS.cerrado, valor: 2500, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' },
      { id: 'exemplo-bolsa-04b', projeto: IDS.atlas, valor: 900, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(120), status: 'cancelled' },
    ],
  },
  {
    holder_id: 'exemplo-bolsista-05',
    nome: 'Bolsista Clara',
    equipe: 'pastagem',
    bolsas: [{ id: 'exemplo-bolsa-05', projeto: IDS.nascentes, valor: 2800, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-06',
    nome: 'Bolsista César',
    equipe: 'pastagem',
    bolsas: [{ id: 'exemplo-bolsa-06', projeto: IDS.solos, valor: 3100, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-07',
    nome: 'Bolsista Célia',
    equipe: 'pastagem',
    bolsas: [{ id: 'exemplo-bolsa-07', projeto: IDS.cerrado, valor: 4000, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-08',
    nome: 'Bolsista Ciro',
    equipe: 'pastagem',
    bolsas: [{ id: 'exemplo-bolsa-08', projeto: IDS.atlas, valor: 2600, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-09',
    nome: 'Bolsista Dora',
    equipe: 'alertas',
    bolsas: [{ id: 'exemplo-bolsa-09', projeto: IDS.nascentes, valor: 2200, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-10',
    nome: 'Bolsista Diego',
    equipe: 'alertas',
    bolsas: [{ id: 'exemplo-bolsa-10', projeto: IDS.cerrado, valor: 3900, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-11',
    nome: 'Bolsista Daniela',
    equipe: 'alertas',
    bolsas: [{ id: 'exemplo-bolsa-11', projeto: IDS.solos, valor: 3300, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-12',
    nome: 'Bolsista Davi',
    equipe: 'alertas',
    bolsas: [{ id: 'exemplo-bolsa-12', projeto: IDS.atlas, valor: 2400, inicio: dataRelativaExemplo(-200), fim: dataRelativaExemplo(-40), status: 'ended' }],
  },
  {
    holder_id: 'exemplo-bolsista-13',
    nome: 'Bolsista Diana',
    equipe: 'alertas',
    bolsas: [{ id: 'exemplo-bolsa-13', projeto: IDS.nascentes, valor: 2100, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(45), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-14',
    nome: 'Bolsista Elisa',
    equipe: 'solos',
    bolsas: [{ id: 'exemplo-bolsa-14', projeto: IDS.solos, valor: 3600, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-15',
    nome: 'Bolsista Enzo',
    equipe: 'solos',
    bolsas: [{ id: 'exemplo-bolsa-15', projeto: IDS.cerrado, valor: 2700, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-16',
    nome: 'Bolsista Esther',
    equipe: 'solos',
    bolsas: [{ id: 'exemplo-bolsa-16', projeto: IDS.atlas, valor: 2900, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-17',
    nome: 'Bolsista Eva',
    equipe: 'solos',
    bolsas: [{ id: 'exemplo-bolsa-17', projeto: IDS.nascentes, valor: 2000, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(30), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-18',
    nome: 'Bolsista Fábio',
    equipe: null,
    bolsas: [{ id: 'exemplo-bolsa-18', projeto: IDS.cerrado, valor: 3200, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-19',
    nome: 'Bolsista Flávia',
    equipe: null,
    bolsas: [{ id: 'exemplo-bolsa-19', projeto: IDS.atlas, valor: 2300, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-20',
    nome: 'Bolsista Felipe',
    equipe: null,
    bolsas: [{ id: 'exemplo-bolsa-20', projeto: IDS.nascentes, valor: 4100, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-21',
    nome: 'Bolsista Flora',
    equipe: null,
    bolsas: [{ id: 'exemplo-bolsa-21', projeto: IDS.solos, valor: 3400, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(90), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-22',
    nome: 'Bolsista Gabriel',
    equipe: null,
    bolsas: [{ id: 'exemplo-bolsa-22', projeto: IDS.cerrado, valor: 2500, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-23',
    nome: 'Bolsista Giovana',
    equipe: null,
    bolsas: [{ id: 'exemplo-bolsa-23', projeto: IDS.atlas, valor: 2800, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-24',
    nome: 'Bolsista Guilherme',
    equipe: null,
    bolsas: [{ id: 'exemplo-bolsa-24', projeto: IDS.nascentes, valor: 3000, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
  {
    holder_id: 'exemplo-bolsista-25',
    nome: 'Bolsista Helena',
    equipe: null,
    bolsas: [{ id: 'exemplo-bolsa-25', projeto: IDS.solos, valor: 3800, inicio: dataRelativaExemplo(-60), fim: dataRelativaExemplo(300), status: 'active' }],
  },
];

let caixasPedidoExemplo = [
  {
    id: 'caixa-exemplo-1',
    nome: 'Time Pastagem',
    meses: 12,
    criado_em: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    itens: [
      { holder_id: 'exemplo-bolsista-01', valor_mensal: null, nota: null },
      { holder_id: 'exemplo-bolsista-02', valor_mensal: 4500, nota: 'Valor combinado com a coordenação' },
    ],
  },
  {
    id: 'caixa-exemplo-2',
    nome: 'Reserva',
    meses: 6,
    criado_em: new Date(Date.now() - 86_400_000).toISOString(),
    itens: [
      { holder_id: 'exemplo-bolsista-10', valor_mensal: null, nota: null },
      { holder_id: 'exemplo-bolsista-13', valor_mensal: 3300, nota: 'Termina em 45 dias' },
    ],
  },
];

function bolsaVigenteExemplo(bolsa, hoje = hojeExemplo()) {
  return (
    bolsa.status !== 'cancelled' &&
    bolsa.inicio <= hoje &&
    hoje <= bolsa.fim &&
    (bolsa.status === 'active' || bolsa.status === 'ended')
  );
}

function valorVigenteExemplo(pessoa, hoje = hojeExemplo()) {
  return pessoa.bolsas
    .filter((b) => bolsaVigenteExemplo(b, hoje))
    .reduce((soma, b) => soma + Number(b.valor), 0);
}

function bolsistaPorIdExemplo(holderId) {
  return BOLSISTAS_PEDIDO_EXEMPLO.find((p) => p.holder_id === holderId) || null;
}

function caixaPorIdExemplo(caixaId) {
  return caixasPedidoExemplo.find((c) => c.id === caixaId) || null;
}

function caixaResumoExemplo(caixa) {
  const itens = caixa.itens
    .map((item) => {
      const pessoa = bolsistaPorIdExemplo(item.holder_id);
      if (!pessoa) return null;
      const valorUsado = item.valor_mensal ?? valorVigenteExemplo(pessoa);
      return {
        holder_id: item.holder_id,
        valor_mensal: item.valor_mensal ?? null,
        valor_usado: valorUsado,
        nota: item.nota ?? null,
        nome: pessoa.nome,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' }));

  const totalMensal = itens.reduce((soma, item) => soma + Number(item.valor_usado), 0);
  return {
    id: caixa.id,
    nome: caixa.nome,
    meses: caixa.meses,
    criado_em: caixa.criado_em,
    pessoas: itens.length,
    total_mensal: totalMensal,
    total_periodo: totalMensal * caixa.meses,
    itens_ocultos: 0,
    itens: itens.map(({ nome, ...item }) => item),
  };
}

export async function pedidoBolsas() {
  const hoje = hojeExemplo();
  const centros = [...new Set(
    BOLSISTAS_PEDIDO_EXEMPLO.flatMap((p) => p.bolsas.map((b) => b.projeto))
  )]
    .map((id) => centroDoExemplo(id))
    .filter(Boolean)
    .sort((a, b) => String(a.code).localeCompare(String(b.code), 'pt-BR'));

  const bolsistas = BOLSISTAS_PEDIDO_EXEMPLO
    .map((p) => ({
      holder_id: p.holder_id,
      nome: p.nome,
      equipe: p.equipe ?? null,
      valor_vigente: valorVigenteExemplo(p, hoje),
      bolsas: p.bolsas.map((b) => ({
        scholarship_id: b.id,
        project_id: b.projeto,
        code: centroDoExemplo(b.projeto)?.code || '—',
        valor: b.valor,
        inicio: b.inicio,
        fim: b.fim,
        status: b.status,
        vigente_hoje: bolsaVigenteExemplo(b, hoje),
      })),
    }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' }));

  return {
    dados: structuredClone({
      centros: centros.map((c) => ({ id: c.id, code: c.code, name: c.name })),
      bolsistas,
      caixas: caixasPedidoExemplo.map(caixaResumoExemplo),
    }),
    erro: null,
  };
}

export async function salvarEquipeBolsista(holderId, equipe) {
  const pessoa = bolsistaPorIdExemplo(holderId);
  if (!pessoa) return { dados: null, erro: 'Pessoa não encontrada.' };
  if (!(equipe === null || equipe === undefined || equipe === '' || ['pastagem', 'alertas', 'solos'].includes(equipe))) {
    return { dados: null, erro: 'Equipe inválida.' };
  }
  pessoa.equipe = equipe === '' ? null : equipe;
  return { dados: { holder_id: holderId, equipe: pessoa.equipe ?? null }, erro: null };
}

export async function salvarCaixaPedido(payload) {
  const bruto = payload && typeof payload === 'object' ? payload : {};
  const nome = typeof bruto.nome === 'string' ? bruto.nome.trim() : '';
  const temMeses = bruto.meses !== undefined && bruto.meses !== null;
  const meses = temMeses ? bruto.meses : undefined;
  if (!nome || nome.length > 80) {
    return { dados: null, erro: 'O nome da caixa deve ter de 1 a 80 caracteres.' };
  }
  if (temMeses && (!Number.isInteger(meses) || meses < 1 || meses > 60)) {
    return { dados: null, erro: 'Os meses da caixa devem ser um inteiro entre 1 e 60.' };
  }

  if (bruto.id !== undefined && bruto.id !== null) {
    const caixa = caixaPorIdExemplo(bruto.id);
    if (!caixa) return { dados: null, erro: 'Caixa não encontrada.' };
    caixa.nome = nome;
    if (temMeses) caixa.meses = meses;
    return { dados: { ...caixaResumoExemplo(caixa) }, erro: null };
  }

  if (caixasPedidoExemplo.length >= 10) {
    return { dados: null, erro: 'Limite de 10 caixas por usuário.' };
  }

  const caixa = {
    id: `caixa-exemplo-${Date.now()}`,
    nome,
    meses: temMeses ? meses : 12,
    criado_em: new Date().toISOString(),
    itens: [],
  };
  caixasPedidoExemplo.push(caixa);
  return { dados: { ...caixaResumoExemplo(caixa) }, erro: null };
}

export async function apagarCaixaPedido(id) {
  const indice = caixasPedidoExemplo.findIndex((c) => c.id === id);
  if (indice < 0) return { dados: null, erro: 'Caixa não encontrada.' };
  caixasPedidoExemplo.splice(indice, 1);
  return { dados: { id, apagada: true }, erro: null };
}

export async function colocarNaCaixa(caixaId, holderId) {
  const caixa = caixaPorIdExemplo(caixaId);
  if (!caixa) return { dados: null, erro: 'Caixa não encontrada.' };
  const pessoa = bolsistaPorIdExemplo(holderId);
  if (!pessoa) return { dados: null, erro: 'Pessoa não encontrada.' };

  const jaNesta = caixa.itens.find((i) => i.holder_id === holderId);
  if (jaNesta) {
    return {
      dados: {
        caixa_id: caixaId,
        holder_id: holderId,
        valor_mensal: jaNesta.valor_mensal ?? null,
        valor_usado: jaNesta.valor_mensal ?? valorVigenteExemplo(pessoa),
        nota: jaNesta.nota ?? null,
        saiu_de: [],
      },
      erro: null,
    };
  }

  const saiuDe = [];
  let origem = null;
  for (const outra of caixasPedidoExemplo) {
    if (outra.id === caixaId) continue;
    const indice = outra.itens.findIndex((i) => i.holder_id === holderId);
    if (indice >= 0) {
      origem = outra.itens[indice];
      outra.itens.splice(indice, 1);
      saiuDe.push({ caixa_id: outra.id, nome: outra.nome });
    }
  }

  caixa.itens.push({
    holder_id: holderId,
    valor_mensal: origem?.valor_mensal ?? null,
    nota: origem?.nota ?? null,
  });

  return {
    dados: {
      caixa_id: caixaId,
      holder_id: holderId,
      valor_mensal: origem?.valor_mensal ?? null,
      valor_usado: origem?.valor_mensal ?? valorVigenteExemplo(pessoa),
      nota: origem?.nota ?? null,
      saiu_de: saiuDe,
    },
    erro: null,
  };
}

export async function editarItemCaixa(caixaId, holderId, valorMensal = null, nota = null) {
  const caixa = caixaPorIdExemplo(caixaId);
  if (!caixa) return { dados: null, erro: 'Caixa não encontrada.' };
  const pessoa = bolsistaPorIdExemplo(holderId);
  if (!pessoa) return { dados: null, erro: 'Pessoa não encontrada.' };
  const item = caixa.itens.find((i) => i.holder_id === holderId);
  if (!item) return { dados: null, erro: 'Pessoa não está nesta caixa.' };

  let valor = null;
  if (valorMensal !== null && valorMensal !== undefined) {
    if (typeof valorMensal === 'string') {
      const texto = valorMensal.trim();
      if (texto !== '') {
        valor = parseValorBR(texto);
        if (valor === null) {
          return { dados: null, erro: 'O valor no pedido deve ser um número positivo.' };
        }
      }
    } else {
      valor = Number(valorMensal);
    }
  }
  if (valor !== null) {
    const arredondado = Math.round(valor * 100) / 100;
    if (!Number.isFinite(arredondado) || arredondado <= 0) {
      return { dados: null, erro: 'O valor no pedido deve ser um número positivo.' };
    }
    item.valor_mensal = arredondado;
  } else {
    item.valor_mensal = null;
  }

  const notaTexto = nota === null || nota === undefined || String(nota).trim() === ''
    ? null
    : String(nota).trim();
  if (notaTexto !== null && notaTexto.length > 300) {
    return { dados: null, erro: 'A nota deve ter até 300 caracteres.' };
  }
  item.nota = notaTexto;

  return {
    dados: {
      caixa_id: caixaId,
      holder_id: holderId,
      valor_mensal: item.valor_mensal,
      valor_usado: item.valor_mensal ?? valorVigenteExemplo(pessoa),
      nota: item.nota,
    },
    erro: null,
  };
}

export async function limparOcultosDaCaixa(caixaId) {
  const caixa = caixaPorIdExemplo(caixaId);
  if (!caixa) return { dados: null, erro: 'Caixa não encontrada.' };
  return { dados: { caixa_id: caixaId, removidos: 0 }, erro: null };
}

export async function tirarDaCaixa(caixaId, holderId) {
  const caixa = caixaPorIdExemplo(caixaId);
  if (!caixa) return { dados: null, erro: 'Caixa não encontrada.' };
  const indice = caixa.itens.findIndex((i) => i.holder_id === holderId);
  if (indice < 0) return { dados: null, erro: 'Pessoa não está nesta caixa.' };
  caixa.itens.splice(indice, 1);
  return { dados: { caixa_id: caixaId, holder_id: holderId, removido: true }, erro: null };
}

const DOC_BALANCETE_30901 = {
  id: '00000000-0000-4000-8000-000000090102',
  tipo: 'balancete',
  titulo: 'Balancete de out/26 · 30.901',
  arquivo_nome: 'balancete-30901-out-26.pdf',
  formato: 'pdf',
  bucket: 'balancete-pdfs',
  caminho: `${IDS.cerrado}/${SENTINELA_EXEMPLO}/balancete-30901-out-26.pdf`,
  versao: 1,
  registrado_em: '2026-10-16T14:00:00Z',
};

const MANIFESTO_FALLBACK = {
  arquivo_nome: 'balancete-30901-out-26.pdf',
  paginas: 2,
  fatos: {
    '7.1.3.04.01.09142': {
      pagina: 1,
      trecho: '7.1.3.04.01.09142 09142 BOLSA DOACAO PESQUISA 380.000,00 0,00 380.000,00',
      bbox: null,
    },
    '7.1.3.04.01.09145': {
      pagina: 1,
      trecho: '7.1.3.04.01.09145 09145 BOLSA APOIO TECNICO 160.000,00 0,00 160.000,00',
      bbox: null,
    },
    '7.1.3.04.02.09210': {
      pagina: 1,
      trecho: '7.1.3.04.02.09210 09210 AUXILIO COLABORADORES EXTERNOS 72.400,00 0,00 72.400,00',
      bbox: null,
    },
    '7.1.3.05.01.08110': {
      pagina: 2,
      trecho: '7.1.3.05.01.08110 08110 SERVICOS DE PROCESSAMENTO DE DADOS 64.350,75 0,00 64.350,75',
      bbox: null,
    },
    '7.1.3.05.01.08124': {
      pagina: 2,
      trecho: '7.1.3.05.01.08124 08124 CONSULTORIA TECNICA ESPECIALIZADA 41.549,25 0,00 41.549,25',
      bbox: null,
    },
    '7.1.3.20.01.05012': {
      pagina: 2,
      trecho: '7.1.3.20.01.05012 05012 EQUIPAMENTOS DE PROCESSAMENTO DE DADOS 68.000,00 0,00 68.000,00',
      bbox: null,
    },
    saldo_disponivel: {
      pagina: 2,
      trecho: 'SALDO DISPONIVEL EM CONTA MOVIMENTO: R$ 184.250,40.',
      bbox: null,
    },
    rendimento_liquido: {
      pagina: 2,
      trecho: 'RENDIMENTO LIQUIDO APURADO: R$ 11.240,15.',
      bbox: null,
    },
  },
};

let manifestoCache = null;

async function obterManifestoExemplo() {
  if (manifestoCache) return manifestoCache;
  if (typeof fetch !== 'function') return MANIFESTO_FALLBACK;
  try {
    const base = import.meta.env?.BASE_URL || '/';
    const resp = await fetch(`${base}__exemplo/manifesto.json`);
    if (resp.ok) {
      const json = await resp.json();
      if (json && typeof json === 'object' && json.fatos) {
        manifestoCache = json;
        return manifestoCache;
      }
    }
  } catch {
    /* fallback sintético para testes unitários fora do servidor Vite */
  }
  return MANIFESTO_FALLBACK;
}

function noCalculo({ rotulo, valor, chave, conta = null, sinal = 1, nota = null, partes = [] }) {
  return {
    rotulo,
    valor,
    tipo: 'calculo',
    chave,
    conta,
    sinal,
    ref: null,
    nota,
    partes,
  };
}

function noFolha({ rotulo, valor, tipo, chave, sinal = 1, ref = null, nota = null }) {
  return {
    rotulo,
    valor,
    tipo,
    chave,
    conta: null,
    sinal,
    ref,
    nota,
    partes: [],
  };
}

export const ARVORES_EXEMPLO = {
  [IDS.cerrado]: noCalculo({
    rotulo: 'Livre para gastar',
    valor: 84300,
    chave: 'livre',
    conta: 'soma dos grupos',
    partes: [
      noCalculo({
        rotulo: 'Pessoal',
        valor: 58200,
        chave: 'grupo:a',
        conta: 'previsto − realizado − comprometido',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Bolsas de pesquisa',
            valor: 780000,
            chave: 'rubrica:a.bolsas:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [
              noFolha({
                rotulo: 'Bolsas de pesquisa',
                valor: 780000,
                tipo: 'legado',
                chave: 'linha:pr-901-a1',
                ref: {
                  alvo_tabela: 'plano_rubricas',
                  alvo_id: '00000000-0000-4000-8000-000000060101',
                  campo: 'valor_previsto',
                },
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Realizado — Bolsas de pesquisa',
            valor: 540000,
            chave: 'rubrica:a.bolsas:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: '7.1.3.04.01.09142 — BOLSA DOACAO PESQUISA',
                valor: 380000,
                tipo: 'documento',
                chave: 'linha:bl-901-1',
                ref: {
                  alvo_tabela: 'balancete_lancamentos',
                  alvo_id: '00000000-0000-4000-8000-000000050101',
                  campo: 'saldo_atual',
                },
              }),
              noFolha({
                rotulo: '7.1.3.04.01.09145 — BOLSA APOIO TECNICO',
                valor: 160000,
                tipo: 'documento',
                chave: 'linha:bl-901-2',
                ref: {
                  alvo_tabela: 'balancete_lancamentos',
                  alvo_id: '00000000-0000-4000-8000-000000050102',
                  campo: 'saldo_atual',
                },
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Comprometido — Bolsas de pesquisa',
            valor: 193400,
            chave: 'rubrica:a.bolsas:comprometido',
            conta: 'soma das bolsas',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: 'Bolsista A (Pesquisa) — 11 meses × R$ 6.200',
                valor: 68200,
                tipo: 'digitado',
                chave: 'linha:b-901-1',
                ref: { alvo_tabela: 'scholarships', alvo_id: 'b-901-1', campo: 'amount' },
              }),
              noFolha({
                rotulo: 'Bolsista B (Geoprocessamento) — 11 meses × R$ 4.800',
                valor: 52800,
                tipo: 'digitado',
                chave: 'linha:b-901-2',
                ref: { alvo_tabela: 'scholarships', alvo_id: 'b-901-2', campo: 'amount' },
              }),
              noFolha({
                rotulo: 'Bolsista C (Sensoriamento) — 8 meses × R$ 8.600',
                valor: 68800,
                tipo: 'digitado',
                chave: 'linha:b-901-3',
                ref: { alvo_tabela: 'scholarships', alvo_id: 'b-901-3', campo: 'amount' },
              }),
              noFolha({
                rotulo: 'Bolsista D (Encerrada na janela) — 1 mês × R$ 3.600',
                valor: 3600,
                tipo: 'digitado',
                chave: 'linha:b-901-4',
                ref: { alvo_tabela: 'scholarships', alvo_id: 'b-901-4', campo: 'amount' },
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Previsto — Auxílio a colaboradores',
            valor: 84000,
            chave: 'rubrica:a.estag:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [
              noFolha({
                rotulo: 'Auxílio a colaboradores',
                valor: 84000,
                tipo: 'legado',
                chave: 'linha:pr-901-a2',
                ref: null,
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Realizado — Auxílio a colaboradores',
            valor: 72400,
            chave: 'rubrica:a.estag:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: '7.1.3.04.02.09210 — AUXILIO COLABORADORES EXTERNOS',
                valor: 72400,
                tipo: 'documento',
                chave: 'linha:bl-901-3',
                ref: {
                  alvo_tabela: 'balancete_lancamentos',
                  alvo_id: '00000000-0000-4000-8000-000000050103',
                  campo: 'saldo_atual',
                },
              }),
            ],
          }),
        ],
      }),
      noCalculo({
        rotulo: 'Serviços de terceiros (PJ)',
        valor: 14100,
        chave: 'grupo:b',
        conta: 'previsto − realizado',
        nota: 'compromissos fora de bolsas não são rastreados',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Serviços técnicos especializados',
            valor: 120000,
            chave: 'rubrica:b.pj:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [
              noFolha({
                rotulo: 'Serviços técnicos especializados',
                valor: 120000,
                tipo: 'legado',
                chave: 'linha:pr-901-b1',
                ref: null,
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Realizado — Serviços técnicos especializados',
            valor: 105900,
            chave: 'rubrica:b.pj:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: '7.1.3.05.01.08110 — SERVICOS DE PROCESSAMENTO DE DADOS',
                valor: 64350.75,
                tipo: 'documento',
                chave: 'linha:bl-901-4',
                ref: {
                  alvo_tabela: 'balancete_lancamentos',
                  alvo_id: '00000000-0000-4000-8000-000000050104',
                  campo: 'saldo_atual',
                },
              }),
              noFolha({
                rotulo: '7.1.3.05.01.08124 — CONSULTORIA TECNICA ESPECIALIZADA',
                valor: 41549.25,
                tipo: 'legado',
                chave: 'linha:bl-901-5',
                ref: {
                  alvo_tabela: 'balancete_lancamentos',
                  alvo_id: '00000000-0000-4000-8000-000000050105',
                  campo: 'saldo_atual',
                },
              }),
            ],
          }),
        ],
      }),
      noCalculo({
        rotulo: 'Equipamentos e material permanente',
        valor: 12000,
        chave: 'grupo:f',
        conta: 'previsto − realizado',
        nota: 'compromissos fora de bolsas não são rastreados',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Servidores e estações de trabalho',
            valor: 80000,
            chave: 'rubrica:f.equip:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [
              noFolha({
                rotulo: 'Servidores e estações de trabalho',
                valor: 80000,
                tipo: 'legado',
                chave: 'linha:pr-901-f1',
                ref: null,
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Realizado — Servidores e estações de trabalho',
            valor: 68000,
            chave: 'rubrica:f.equip:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: '7.1.3.20.01.05012 — EQUIPAMENTOS DE PROCESSAMENTO DE DADOS',
                valor: 68000,
                tipo: 'documento',
                chave: 'linha:bl-901-6',
                ref: {
                  alvo_tabela: 'balancete_lancamentos',
                  alvo_id: '00000000-0000-4000-8000-000000050106',
                  campo: 'saldo_atual',
                },
              }),
            ],
          }),
        ],
      }),
      noCalculo({
        rotulo: 'Custos Indiretos (CIP) — UFG',
        valor: 0,
        chave: 'grupo:cip_ufg',
        conta: 'previsto − realizado − comprometido',
        nota: 'taxa a reter pela fundação/universidade: não é livre',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Custos Indiretos (CIP) — UFG',
            valor: 150000,
            chave: 'rubrica:cip_ufg:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [
              noFolha({
                rotulo: 'Custos Indiretos (CIP) — UFG',
                valor: 150000,
                tipo: 'legado',
                chave: 'linha:pr-901-cip1',
                ref: null,
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Realizado — Custos Indiretos (CIP) — UFG',
            valor: 120000,
            chave: 'rubrica:cip_ufg:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: '7.1.3.90.01.00001 — CIP UFG',
                valor: 120000,
                tipo: 'legado',
                chave: 'linha:bl-901-7',
                ref: null,
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Comprometido — Custos Indiretos (CIP) — UFG',
            valor: 30000,
            chave: 'rubrica:cip_ufg:comprometido',
            conta: 'taxa a reter (previsto − realizado)',
            sinal: -1,
            partes: [
              noCalculo({
                rotulo: 'Previsto — Custos Indiretos (CIP) — UFG',
                valor: 150000,
                chave: 'rubrica:cip_ufg:previsto',
                conta: 'soma das linhas',
                sinal: 1,
                partes: [
                  noFolha({
                    rotulo: 'Custos Indiretos (CIP) — UFG',
                    valor: 150000,
                    tipo: 'legado',
                    chave: 'linha:pr-901-cip1',
                    ref: null,
                  }),
                ],
              }),
              noCalculo({
                rotulo: 'Realizado — Custos Indiretos (CIP) — UFG',
                valor: 120000,
                chave: 'rubrica:cip_ufg:realizado',
                conta: 'soma dos lançamentos',
                sinal: -1,
                partes: [
                  noFolha({
                    rotulo: '7.1.3.90.01.00001 — CIP UFG',
                    valor: 120000,
                    tipo: 'legado',
                    chave: 'linha:bl-901-7',
                    ref: null,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  }),
  [IDS.atlas]: noCalculo({
    rotulo: 'Livre para gastar',
    valor: 19400,
    chave: 'livre',
    conta: 'soma dos grupos',
    partes: [
      noCalculo({
        rotulo: 'Pessoal',
        valor: 12900,
        chave: 'grupo:a',
        conta: 'previsto − realizado − comprometido',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Bolsas de pesquisa',
            valor: 320000,
            chave: 'rubrica:a.bolsas:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [
              noFolha({ rotulo: 'Bolsas de pesquisa', valor: 320000, tipo: 'legado', chave: 'linha:pr-902-a1' }),
            ],
          }),
          noCalculo({
            rotulo: 'Realizado — Bolsas de pesquisa',
            valor: 267100,
            chave: 'rubrica:a.bolsas:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [
              noFolha({ rotulo: '7.1.3.04.01.09142 — BOLSA DOACAO', valor: 267100, tipo: 'legado', chave: 'linha:bl-902-1' }),
            ],
          }),
          noCalculo({
            rotulo: 'Comprometido — Bolsas de pesquisa',
            valor: 40000,
            chave: 'rubrica:a.bolsas:comprometido',
            conta: 'soma das bolsas',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: 'Bolsista E (Hidrologia) — 5 meses × R$ 5.000',
                valor: 25000,
                tipo: 'digitado',
                chave: 'linha:b-902-1',
                ref: { alvo_tabela: 'scholarships', alvo_id: 'b-902-1', campo: 'amount' },
              }),
              noFolha({
                rotulo: 'Bolsista F (Cartografia) — 5 meses × R$ 3.000',
                valor: 15000,
                tipo: 'digitado',
                chave: 'linha:b-902-2',
                ref: { alvo_tabela: 'scholarships', alvo_id: 'b-902-2', campo: 'amount' },
              }),
            ],
          }),
        ],
      }),
      noCalculo({
        rotulo: 'Diárias e passagens',
        valor: 6500,
        chave: 'grupo:d',
        conta: 'previsto − realizado',
        nota: 'compromissos fora de bolsas não são rastreados',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Diárias de campo',
            valor: 60000,
            chave: 'rubrica:d.diarias:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [
              noFolha({ rotulo: 'Diárias de campo', valor: 60000, tipo: 'legado', chave: 'linha:pr-902-d1' }),
            ],
          }),
          noCalculo({
            rotulo: 'Realizado — Diárias de campo',
            valor: 53500,
            chave: 'rubrica:d.diarias:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [
              noFolha({ rotulo: '7.1.3.03.02.04011 — DIARIAS DE CAMPO', valor: 53500, tipo: 'legado', chave: 'linha:bl-902-2' }),
            ],
          }),
        ],
      }),
    ],
  }),
  [IDS.nascentes]: noCalculo({
    rotulo: 'Livre para gastar',
    valor: 15750,
    chave: 'livre',
    conta: 'soma dos grupos',
    partes: [
      noCalculo({
        rotulo: 'Pessoal',
        valor: 20000,
        chave: 'grupo:a',
        conta: 'previsto − realizado − comprometido',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Bolsas de pesquisa',
            valor: 240000,
            chave: 'rubrica:a.bolsas:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [noFolha({ rotulo: 'Bolsas de pesquisa', valor: 240000, tipo: 'legado', chave: 'linha:pr-903-a1' })],
          }),
          noCalculo({
            rotulo: 'Realizado — Bolsas de pesquisa',
            valor: 188000,
            chave: 'rubrica:a.bolsas:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [noFolha({ rotulo: '7.1.3.04.01.09142 — BOLSA DOACAO', valor: 188000, tipo: 'legado', chave: 'linha:bl-903-1' })],
          }),
          noCalculo({
            rotulo: 'Comprometido — Bolsas de pesquisa',
            valor: 32000,
            chave: 'rubrica:a.bolsas:comprometido',
            conta: 'soma das bolsas',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: 'Bolsista G (Campo) — 8 meses × R$ 4.000',
                valor: 32000,
                tipo: 'digitado',
                chave: 'linha:b-903-1',
                ref: { alvo_tabela: 'scholarships', alvo_id: 'b-903-1', campo: 'amount' },
              }),
            ],
          }),
        ],
      }),
      noCalculo({
        rotulo: 'Equipamentos e material permanente',
        valor: -4250,
        chave: 'grupo:f',
        conta: 'previsto − realizado',
        nota: 'compromissos fora de bolsas não são rastreados',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Sensores hidrológicos',
            valor: 95000,
            chave: 'rubrica:f.sensores:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [noFolha({ rotulo: 'Sensores hidrológicos', valor: 95000, tipo: 'legado', chave: 'linha:pr-903-f1' })],
          }),
          noCalculo({
            rotulo: 'Realizado — Sensores hidrológicos',
            valor: 99250,
            chave: 'rubrica:f.sensores:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [noFolha({ rotulo: '7.1.3.20.01.05012 — SENSORES HIDROLOGICOS', valor: 99250, tipo: 'legado', chave: 'linha:bl-903-2' })],
          }),
        ],
      }),
    ],
  }),
  [IDS.veredas]: {
    valor: null,
    motivo: 'sem balancete',
    data_referencia: null,
    rotulo: 'Livre para gastar',
    tipo: 'calculo',
    conta: 'soma dos grupos',
    chave: 'livre',
    sinal: 1,
    ref: null,
    nota: null,
    partes: [],
  },
  [IDS.florestal]: {
    valor: null,
    motivo: 'sem plano',
    data_referencia: '2026-10-10',
    rotulo: 'Livre para gastar',
    tipo: 'calculo',
    conta: 'soma dos grupos',
    chave: 'livre',
    sinal: 1,
    ref: null,
    nota: null,
    partes: [],
  },
  [IDS.corredor]: noCalculo({
    rotulo: 'Livre para gastar',
    valor: 34000,
    chave: 'livre',
    conta: 'soma dos grupos',
    partes: [
      noCalculo({
        rotulo: 'Pessoal',
        valor: 34000,
        chave: 'grupo:a',
        conta: 'previsto − realizado − comprometido',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Bolsas de pesquisa',
            valor: 280000,
            chave: 'rubrica:a.bolsas:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [noFolha({ rotulo: 'Bolsas de pesquisa', valor: 280000, tipo: 'legado', chave: 'linha:pr-907-a1' })],
          }),
          noCalculo({
            rotulo: 'Realizado — Bolsas de pesquisa',
            valor: 202000,
            chave: 'rubrica:a.bolsas:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [noFolha({ rotulo: '7.1.3.04.01.09142 — BOLSA DOACAO', valor: 202000, tipo: 'legado', chave: 'linha:bl-907-1' })],
          }),
          noCalculo({
            rotulo: 'Comprometido — Bolsas de pesquisa',
            valor: 44000,
            chave: 'rubrica:a.bolsas:comprometido',
            conta: 'soma das bolsas',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: 'Bolsista I (Ecologia) — 12 meses × R$ 3.000',
                valor: 36000,
                tipo: 'digitado',
                chave: 'linha:b-907-1',
                ref: { alvo_tabela: 'scholarships', alvo_id: 'b-907-1', campo: 'amount' },
              }),
              noFolha({
                rotulo: 'Bolsista J (Sensoriamento) — 4 meses × R$ 2.000',
                valor: 8000,
                tipo: 'digitado',
                chave: 'linha:b-907-2',
                ref: { alvo_tabela: 'scholarships', alvo_id: 'b-907-2', campo: 'amount' },
              }),
            ],
          }),
        ],
      }),
    ],
  }),
  [IDS.solos]: noCalculo({
    rotulo: 'Livre para gastar',
    valor: 31500,
    chave: 'livre',
    conta: 'soma dos grupos',
    partes: [
      noCalculo({
        rotulo: 'Passagens e locomoção',
        valor: 31500,
        chave: 'grupo:c',
        conta: 'previsto − realizado',
        nota: 'compromissos fora de bolsas não são rastreados',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Passagens nacionais',
            valor: 90000,
            chave: 'rubrica:c.passagens:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [noFolha({ rotulo: 'Passagens nacionais', valor: 90000, tipo: 'legado', chave: 'linha:pr-908-c1' })],
          }),
          noCalculo({
            rotulo: 'Realizado — Passagens nacionais',
            valor: 58500,
            chave: 'rubrica:c.passagens:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [noFolha({ rotulo: '7.1.3.03.03.04020 — PASSAGENS', valor: 58500, tipo: 'legado', chave: 'linha:bl-908-1' })],
          }),
        ],
      }),
    ],
  }),
  [IDS.tarifa]: noCalculo({
    rotulo: 'Livre para gastar',
    valor: 29985.66,
    chave: 'livre',
    conta: 'soma dos grupos',
    partes: [
      noCalculo({
        rotulo: 'Pessoal',
        valor: 30000,
        chave: 'grupo:a',
        conta: 'previsto − realizado',
        nota: 'compromissos fora de bolsas não são rastreados',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Bolsas de pesquisa',
            valor: 60000,
            chave: 'rubrica:a.bolsas:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [
              noFolha({
                rotulo: 'Bolsas de pesquisa',
                valor: 60000,
                tipo: 'legado',
                chave: 'linha:pr-909-a1',
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Realizado — Bolsas de pesquisa',
            valor: 30000,
            chave: 'rubrica:a.bolsas:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: '7.1.3.04.01.09142 — BOLSA DOACAO PESQUISA',
                valor: 30000,
                tipo: 'legado',
                chave: 'linha:bl-909-1',
              }),
            ],
          }),
        ],
      }),
      noCalculo({
        rotulo: 'Serviços de Terceiros P. Jurídica',
        valor: -14.34,
        chave: 'grupo:b',
        conta: 'previsto − realizado',
        nota: 'compromissos fora de bolsas não são rastreados',
        partes: [
          noCalculo({
            rotulo: 'Realizado — Serviços de terceiros',
            valor: 14.34,
            chave: 'rubrica:b.servicos:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: '7.1.3.05.01.00054 — DESPESA SERVIÇOS BANCÁRIOS',
                valor: 14.34,
                tipo: 'legado',
                chave: 'linha:bl-909-2',
              }),
            ],
          }),
        ],
      }),
    ],
  }),
  [IDS.restinga]: noCalculo({
    rotulo: 'Livre para gastar',
    valor: 52000,
    chave: 'livre',
    conta: 'soma dos grupos',
    partes: [
      noCalculo({
        rotulo: 'Pessoal',
        valor: 52000,
        chave: 'grupo:a',
        conta: 'previsto − realizado − comprometido',
        partes: [
          noCalculo({
            rotulo: 'Previsto — Bolsas de pesquisa',
            valor: 400000,
            chave: 'rubrica:a.bolsas:previsto',
            conta: 'soma das linhas',
            sinal: 1,
            partes: [
              noFolha({
                rotulo: 'Bolsas de pesquisa',
                valor: 400000,
                tipo: 'legado',
                chave: 'linha:pr-910-a1',
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Realizado — Bolsas de pesquisa',
            valor: 260000,
            chave: 'rubrica:a.bolsas:realizado',
            conta: 'soma dos lançamentos',
            sinal: -1,
            partes: [
              noFolha({
                rotulo: '7.1.3.04.01.09142 — BOLSA DOACAO PESQUISA',
                valor: 260000,
                tipo: 'legado',
                chave: 'linha:bl-910-1',
              }),
            ],
          }),
          noCalculo({
            rotulo: 'Comprometido — Bolsas de pesquisa',
            valor: 88000,
            chave: 'rubrica:a.bolsas:comprometido',
            conta: 'bolsas até o fim da vigência + folha atrasada',
            sinal: -1,
            partes: [
              noCalculo({
                rotulo: 'Bolsas até ago/27',
                valor: 80000,
                chave: 'compromisso:bolsas',
                conta: '2 bolsas × R$ 4.000 × 10 meses',
                sinal: 1,
                partes: [
                  noFolha({
                    rotulo: 'Bolsista K (Campo)',
                    valor: 40000,
                    tipo: 'digitado',
                    chave: 'linha:b-910-1',
                    ref: {
                      alvo_tabela: 'scholarships',
                      alvo_id: 'b-910-1',
                      campo: 'amount',
                    },
                  }),
                  noFolha({
                    rotulo: 'Bolsista L (Laboratório)',
                    valor: 40000,
                    tipo: 'digitado',
                    chave: 'linha:b-910-2',
                    ref: {
                      alvo_tabela: 'scholarships',
                      alvo_id: 'b-910-2',
                      campo: 'amount',
                    },
                  }),
                ],
              }),
              noCalculo({
                rotulo: 'Folha atrasada de out/26',
                valor: 8000,
                chave: 'folha:atrasada',
                conta: 'paga depois do balancete de 15/10/2026, fora do realizado',
                sinal: 1,
                partes: [
                  noFolha({
                    rotulo: 'Folha de out/26 fora do balancete',
                    valor: 8000,
                    tipo: 'digitado',
                    chave: 'linha:folha-atrasada-910',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  }),
};

const ORIGENS_LANCAMENTOS = {
  '00000000-0000-4000-8000-000000050101': {
    tipo: 'documento',
    valor: 380000,
    chaveManifesto: '7.1.3.04.01.09142',
  },
  '00000000-0000-4000-8000-000000050102': {
    tipo: 'documento',
    valor: 160000,
    chaveManifesto: '7.1.3.04.01.09145',
  },
  '00000000-0000-4000-8000-000000050103': {
    tipo: 'documento',
    valor: 72400,
    chaveManifesto: '7.1.3.04.02.09210',
  },
  '00000000-0000-4000-8000-000000050104': {
    tipo: 'documento',
    valor: 64350.75,
    chaveManifesto: '7.1.3.05.01.08110',
  },
  '00000000-0000-4000-8000-000000050105': {
    tipo: 'legado',
    valor: 41549.25,
    busca: { conta_codigo: '7.1.3.05.01.08124', valor: 41549.25 },
  },
  '00000000-0000-4000-8000-000000050106': {
    tipo: 'documento',
    valor: 68000,
    chaveManifesto: '7.1.3.20.01.05012',
  },
};

export async function explicarLivre(projectId) {
  if (projectId === IDS.estacoes) {
    return { dados: null, erro: 'Não foi possível carregar a origem do saldo livre.' };
  }
  const arvore = ARVORES_EXEMPLO[projectId];
  if (!arvore) {
    return { dados: null, erro: 'Centro de custo não encontrado.' };
  }
  const centro = CENTROS_BASE.find((c) => c.id === projectId);
  return {
    dados: {
      ...structuredClone(arvore),
      data_referencia: arvore.valor === null ? arvore.data_referencia : (centro?.data_referencia ?? null),
    },
    erro: null,
  };
}

export async function origem(ref) {
  if (!ref || !ref.alvo_tabela || !ref.alvo_id || !ref.campo) {
    return { dados: null, erro: 'Referência de origem incompleta.' };
  }

  if (ref.alvo_tabela === 'scholarships' && ref.campo === 'amount') {
    for (const saldo of Object.values(SALDOS_EXEMPLO)) {
      const bolsa = (saldo.bolsas_ativas || []).find((b) => b.scholarship_id === ref.alvo_id);
      if (bolsa) {
        return {
          dados: {
            tipo: 'digitado',
            valor: bolsa.valor_mensal,
            documento: null,
            fato: null,
            busca: null,
            nota: 'Valor do cadastro de bolsas (planilha da FUNAPE), sem documento por linha até a F3; a árvore mostra o total dos meses.',
          },
          erro: null,
        };
      }
    }
    return { dados: null, erro: 'Bolsa não encontrada.' };
  }

  if (ref.alvo_tabela === 'plano_rubricas' && ref.campo === 'valor_previsto') {
    return {
      dados: {
        tipo: 'legado',
        valor: 780000,
        documento: null,
        fato: null,
        busca: { texto: 'Bolsas de pesquisa', valor: 780000 },
        nota: 'Valor anterior à rastreabilidade e sem arquivo de plano associado no modo exemplo.',
      },
      erro: null,
    };
  }

  if (ref.alvo_tabela === 'balancete_lancamentos' && ref.campo === 'saldo_atual') {
    const item = ORIGENS_LANCAMENTOS[ref.alvo_id];
    if (!item) {
      return { dados: null, erro: 'Lançamento não encontrado.' };
    }
    if (item.tipo === 'legado') {
      return {
        dados: {
          tipo: 'legado',
          valor: item.valor,
          documento: { ...DOC_BALANCETE_30901 },
          fato: null,
          busca: { ...item.busca },
          nota: null,
        },
        erro: null,
      };
    }
    const manifesto = await obterManifestoExemplo();
    const fatoManifesto = manifesto.fatos?.[item.chaveManifesto];
    return {
      dados: {
        tipo: 'documento',
        valor: item.valor,
        documento: { ...DOC_BALANCETE_30901 },
        fato: {
          pagina: fatoManifesto?.pagina ?? 1,
          trecho: fatoManifesto?.trecho ?? item.chaveManifesto,
          bbox: fatoManifesto?.bbox ?? null,
          parser: 'balancete-parser',
          parser_versao: '1.0',
        },
        busca: null,
        nota: null,
      },
      erro: null,
    };
  }

  if (
    ref.alvo_tabela === 'balancetes' &&
    (ref.campo === 'saldo_disponivel' || ref.campo === 'rendimento_liquido')
  ) {
    const ehRendimento = ref.campo === 'rendimento_liquido';
    const valorDoDocumento = ehRendimento ? 11240.15 : 184250.4;
    const trechoDoDocumento = ehRendimento
      ? 'RENDIMENTO LIQUIDO APURADO: R$ 11.240,15.'
      : 'SALDO DISPONIVEL EM CONTA MOVIMENTO: R$ 184.250,40.';
    const textoDeBusca = ehRendimento ? 'rendimento liquido' : 'saldo disponivel';

    if (ref.alvo_id === DOC_BALANCETE_30901.id) {
      const manifesto = await obterManifestoExemplo();
      const fato = manifesto.fatos?.[ref.campo];
      return {
        dados: {
          tipo: 'documento',
          valor: valorDoDocumento,
          documento: { ...DOC_BALANCETE_30901 },
          fato: {
            pagina: fato?.pagina ?? 2,
            trecho: fato?.trecho ?? trechoDoDocumento,
            bbox: fato?.bbox ?? null,
            parser: 'balancete-parser',
            parser_versao: '1.0',
          },
          busca: null,
          nota: null,
        },
        erro: null,
      };
    }
    for (const lista of Object.values(BALANCETES_EXEMPLO)) {
      const bal = lista.find((b) => b.id === ref.alvo_id);
      if (bal) {
        const valor = ehRendimento ? bal.rendimento_liquido : bal.saldo_disponivel;
        return {
          dados: {
            tipo: 'legado',
            valor,
            documento: null,
            fato: null,
            busca: { texto: textoDeBusca, valor },
            nota: ehRendimento
              ? 'Rendimento lido no balancete, sem PDF sintético gerado para este centro no modo exemplo.'
              : 'Balancete anterior à rastreabilidade, sem PDF sintético gerado para este centro no modo exemplo.',
          },
          erro: null,
        };
      }
    }
    return { dados: null, erro: 'Balancete não encontrado.' };
  }

  if (ref.alvo_tabela === 'planos_trabalho' && ref.campo === 'valor_total_plano') {
    for (const lista of Object.values(PLANOS_EXEMPLO)) {
      const plano = lista.find((p) => p.id === ref.alvo_id);
      if (plano) {
        return {
          dados: {
            tipo: 'legado',
            valor: plano.valor_total_plano,
            documento: null,
            fato: null,
            busca: { texto: plano.titulo, valor: plano.valor_total_plano },
            nota: 'Plano de trabalho sem arquivo anexado no modo exemplo.',
          },
          erro: null,
        };
      }
    }
    return { dados: null, erro: 'Plano de trabalho não encontrado.' };
  }

  return { dados: null, erro: 'Origem não suportada no modo exemplo.' };
}

export async function arquivoDeOrigem(documento) {
  if (!documento || !documento.caminho) {
    return { dados: null, erro: 'Arquivo de origem não informado.' };
  }
  if (documento.arquivo_nome !== DOC_BALANCETE_30901.arquivo_nome) {
    return { dados: null, erro: 'Arquivo não disponível no modo exemplo.' };
  }
  try {
    const base = import.meta.env?.BASE_URL || '/';
    const resposta = await fetch(`${base}__exemplo/${DOC_BALANCETE_30901.arquivo_nome}`);
    if (!resposta.ok) {
      return {
        dados: null,
        erro: `Não foi possível carregar o PDF de exemplo (HTTP ${resposta.status}).`,
      };
    }
    const buffer = await resposta.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) {
      return { dados: null, erro: 'O PDF de exemplo veio vazio.' };
    }
    return { dados: buffer, erro: null };
  } catch {
    return { dados: null, erro: 'Não foi possível buscar o PDF de exemplo.' };
  }
}

const CENTRO_INATIVO_ACESSOS_EXEMPLO = {
  id: '00000000-0000-4000-8000-000000030900',
  code: '30.900',
  name: 'Projeto Piloto Encerrado',
  active: false,
};

let usuariosAcessosExemplo = [
  {
    user_id: 'exemplo-admin',
    nome: 'Ana Exemplo',
    email: 'ana.exemplo@example.org',
    role: 'admin',
    criado_em: '2026-01-10T10:00:00Z',
    centros: [IDS.cerrado, IDS.atlas],
  },
  {
    user_id: 'exemplo-admin-2',
    nome: 'Carlos Exemplo',
    email: 'carlos.exemplo@example.org',
    role: 'admin',
    criado_em: '2026-01-20T10:00:00Z',
    centros: [],
  },
  {
    user_id: 'exemplo-prof-sem-centro',
    nome: 'Bruno Exemplo',
    email: 'bruno.exemplo@example.org',
    role: 'professor',
    criado_em: '2026-11-19T14:30:00Z',
    centros: [],
  },
  {
    user_id: 'exemplo-prof-clara',
    nome: 'Profa. Clara Mendes',
    email: 'clara.exemplo@example.org',
    role: 'professor',
    criado_em: '2026-02-15T09:00:00Z',
    centros: [IDS.cerrado, IDS.atlas, IDS.corredor],
  },
  {
    user_id: 'exemplo-prof-renato',
    nome: 'Prof. Renato Alves',
    email: 'renato.exemplo@example.org',
    role: 'professor',
    criado_em: '2026-03-01T11:00:00Z',
    centros: [IDS.atlas, IDS.nascentes, IDS.veredas, IDS.solos, IDS.tarifa],
  },
  {
    user_id: 'exemplo-agente',
    nome: 'Assistente',
    email: 'buriti.exemplo@example.org',
    role: 'agente',
    criado_em: '2026-04-01T08:00:00Z',
    centros: [IDS.cerrado, IDS.atlas, IDS.nascentes],
  },
  {
    user_id: 'exemplo-automacao',
    nome: 'Robô de Ingestão',
    email: 'automacao.exemplo@example.org',
    role: 'automacao',
    criado_em: '2026-05-01T08:00:00Z',
    centros: [],
  },
];

function centrosAcessosExemplo() {
  const ativos = CENTROS_BASE.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    active: true,
  }));
  return [...ativos, { ...CENTRO_INATIVO_ACESSOS_EXEMPLO }].sort((a, b) =>
    String(a.code).localeCompare(String(b.code), 'pt-BR')
  );
}

export async function acessosUsuarios() {
  return {
    dados: {
      usuarios: structuredClone(usuariosAcessosExemplo),
      centros: centrosAcessosExemplo(),
    },
    erro: null,
  };
}

export async function salvarAcessos(userId, role, projectIds) {
  const usuario = usuariosAcessosExemplo.find((u) => u.user_id === userId);
  if (!usuario) {
    return { dados: null, erro: 'Usuário não encontrado.' };
  }
  if (usuario.role === 'agente' || usuario.role === 'automacao') {
    return { dados: null, erro: 'Sem permissão' };
  }
  if (!['admin', 'professor'].includes(role)) {
    return { dados: null, erro: `Papel inválido: ${role}` };
  }

  const validos = new Set(centrosAcessosExemplo().map((c) => c.id));
  usuario.role = role;
  usuario.centros = Array.from(
    new Set((Array.isArray(projectIds) ? projectIds : []).filter((id) => validos.has(id)))
  );

  return { dados: { ok: true }, erro: null };
}
