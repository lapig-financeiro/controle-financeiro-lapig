const IDS = {
  cerrado: '00000000-0000-4000-8000-000000030901',
  atlas: '00000000-0000-4000-8000-000000030902',
  nascentes: '00000000-0000-4000-8000-000000030903',
  veredas: '00000000-0000-4000-8000-000000030904',
  florestal: '00000000-0000-4000-8000-000000030905',
  estacoes: '00000000-0000-4000-8000-000000030906',
  corredor: '00000000-0000-4000-8000-000000030907',
  solos: '00000000-0000-4000-8000-000000030908',
};

const CENTROS_BASE = [
  {
    id: IDS.cerrado,
    code: '30.901',
    name: 'Bacia do Cerrado Norte',
    end_date: '2027-08-31',
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
  },
  {
    id: IDS.corredor,
    code: '30.907',
    name: 'Corredor Ecológico Oeste',
    end_date: '2027-11-30',
    drive_folder_url: 'https://drive.google.com/drive/folders/exemplo-30907',
    livre: 42000,
    situacao: 'em dia',
    data_referencia: '2026-10-18',
    erro: null,
    responsaveis: ['Profa. Clara Mendes'],
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
    end_date: '2027-08-31',
    meses_restantes: 10,
    data_referencia: '2026-10-15',
    balancete_cobre_ate: '2026-10-01',
    balancete_defasagem_meses: 1,
    saldo_disponivel_caixa: 184250.4,
    rendimento_liquido: 11240.15,
    compromissos_bolsas: 193400,
    bolsas_ativas: [
      {
        scholarship_id: 'b-901-1',
        bolsista: 'Bolsista A (Pesquisa)',
        valor_mensal: 6200,
        end_date: '2027-08-31',
        meses: 11,
        compromisso: 68200,
      },
      {
        scholarship_id: 'b-901-2',
        bolsista: 'Bolsista B (Geoprocessamento)',
        valor_mensal: 4800,
        end_date: '2027-08-31',
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
        end_date: '2026-10-31',
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
    ],
    rubricas: [
      {
        rubrica_code: 'a.bolsas',
        rubrica_name: 'Bolsas de pesquisa',
        grupo_code: 'a',
        previsto: 780000,
        realizado: 540000,
        compromissos: 193400,
        saldo_livre: 46600,
      },
      {
        rubrica_code: 'a.estag',
        rubrica_name: 'Auxílio a colaboradores',
        grupo_code: 'a',
        previsto: 84000,
        realizado: 72400,
        compromissos: 0,
        saldo_livre: 11600,
      },
      {
        rubrica_code: 'b.pj',
        rubrica_name: 'Serviços técnicos especializados',
        grupo_code: 'b',
        previsto: 120000,
        realizado: 105900,
        compromissos: 0,
        saldo_livre: 14100,
      },
      {
        rubrica_code: 'f.equip',
        rubrica_name: 'Servidores e estações de trabalho',
        grupo_code: 'f',
        previsto: 80000,
        realizado: 68000,
        compromissos: 0,
        saldo_livre: 12000,
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
    saldo_disponivel_caixa: 62100,
    rendimento_liquido: 3180,
    compromissos_bolsas: 40000,
    bolsas_ativas: [
      {
        scholarship_id: 'b-902-1',
        bolsista: 'Bolsista E (Hidrologia)',
        valor_mensal: 5000,
        end_date: '2027-03-31',
        meses: 5,
        compromisso: 25000,
      },
      {
        scholarship_id: 'b-902-2',
        bolsista: 'Bolsista F (Cartografia)',
        valor_mensal: 3000,
        end_date: '2027-03-31',
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
        compromissos: 40000,
        saldo_livre: 12900,
      },
      {
        rubrica_code: 'd.diarias',
        rubrica_name: 'Diárias de campo',
        grupo_code: 'd',
        previsto: 60000,
        realizado: 53500,
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
        compromissos: 32000,
        saldo_livre: 20000,
      },
      {
        rubrica_code: 'f.sensores',
        rubrica_name: 'Sensores hidrológicos',
        grupo_code: 'f',
        previsto: 95000,
        realizado: 99250,
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
        compromissos: 56000,
        saldo_livre: 304000,
      },
      {
        rubrica_code: 'e.consumo',
        rubrica_name: 'Material de campo',
        grupo_code: 'e',
        previsto: 45000,
        realizado: 0,
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
    saldo_disponivel_caixa: 92000,
    rendimento_liquido: 1850,
    compromissos_bolsas: 36000,
    bolsas_ativas: [
      {
        scholarship_id: 'b-907-1',
        bolsista: 'Bolsista I (Ecologia)',
        valor_mensal: 3000,
        end_date: '2027-10-31',
        meses: 12,
        compromisso: 36000,
      },
    ],
    grupos: [
      {
        grupo_code: 'a',
        grupo_name: 'Pessoal',
        previsto: 280000,
        realizado: 202000,
        saldo: 78000,
        compromissos: 36000,
        saldo_livre: 42000,
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
        compromissos: 36000,
        saldo_livre: 42000,
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
        compromissos: 0,
        saldo_livre: 31500,
      },
    ],
    avisos: [],
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
      { parcela: 3, data_prevista: '2027-01-15', data_texto: null, valor: 120000, valor_texto: null },
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
};

const BALANCETES_EXEMPLO = {
  [IDS.cerrado]: [
    {
      id: 'bal-901-2',
      data_referencia: '2026-10-15',
      arquivo_nome: 'balancete-30901-out-26.pdf',
      saldo_disponivel: 184250.4,
      created_at: '2026-10-16T14:00:00Z',
    },
    {
      id: 'bal-901-1',
      data_referencia: '2026-09-15',
      arquivo_nome: 'balancete-30901-set-26.pdf',
      saldo_disponivel: 210400,
      created_at: '2026-09-16T14:00:00Z',
    },
  ],
  [IDS.atlas]: [
    {
      id: 'bal-902-1',
      data_referencia: '2026-08-15',
      arquivo_nome: 'balancete-30902-ago-26.pdf',
      saldo_disponivel: 62100,
      created_at: '2026-08-16T10:00:00Z',
    },
  ],
  [IDS.nascentes]: [
    {
      id: 'bal-903-1',
      data_referencia: '2026-10-20',
      arquivo_nome: 'balancete-30903-out-26.pdf',
      saldo_disponivel: 54000,
      created_at: '2026-10-21T10:00:00Z',
    },
  ],
  [IDS.florestal]: [
    {
      id: 'bal-905-1',
      data_referencia: '2026-10-10',
      arquivo_nome: 'balancete-30905-out-26.pdf',
      saldo_disponivel: 48000,
      created_at: '2026-10-11T10:00:00Z',
    },
  ],
};

const PLANOS_EXEMPLO = {
  [IDS.cerrado]: [
    {
      id: 'pl-901-2',
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
      id: 'pl-901-1',
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
      id: 'pl-902-1',
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
      id: 'pl-903-1',
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
      id: 'pl-904-1',
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
};

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
