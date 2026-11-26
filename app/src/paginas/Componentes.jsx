import { useRef, useState } from 'preact/hooks';
import { ChevronDown, ExternalLink, FileText, RefreshCw } from 'lucide-preact';
import {
  Abas,
  AvisoFalha,
  BlocoAnalise,
  Botao,
  CabecalhoPagina,
  Campo,
  Cartao,
  Chip,
  DeOndeVem,
  Destaque,
  Documento,
  Esqueleto,
  GraficoProjecao,
  GradeDestaques,
  LinhaDeLista,
  Lista,
  ListaConversas,
  Manutencao,
  MenuSuspenso,
  MenuSuspensoItem,
  MenuSuspensoSeparador,
  MenuUsuario,
  PainelLateral,
  Seletor,
  Sino,
  Situacao,
  Tabela,
  Valor,
  Vazio,
} from '../componentes/index.js';
import { dinheiroCompacto } from '../util/formato.js';
import './Componentes.css';

// Dados fictícios do catálogo: nenhum valor ou nome vem de centro real.
const CONVERSAS_CATALOGO = [
  {
    id: '00000000-0000-4000-8000-000000000c01',
    titulo: 'Saldo livre do 30.910',
    criada_em: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    atualizada_em: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    turnos: 2,
  },
  {
    id: '00000000-0000-4000-8000-000000000c02',
    titulo: 'Bolsas do 30.901',
    criada_em: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    atualizada_em: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    turnos: 1,
  },
];

const MESES_PROJECAO_CATALOGO = [
  { mes: '2026-08', folha: 12000, entra_antes: 0, entra_depois: 0, desembolsos: [], em_conta_apos_folha: 88000, em_conta_fim: 88000, orcamento_resta: 168000 },
  { mes: '2026-09', folha: 12000, entra_antes: 0, entra_depois: 0, desembolsos: [], em_conta_apos_folha: 76000, em_conta_fim: 76000, orcamento_resta: 156000 },
  { mes: '2026-10', folha: 12000, entra_antes: 0, entra_depois: 0, desembolsos: [], em_conta_apos_folha: 64000, em_conta_fim: 64000, orcamento_resta: 144000 },
  { mes: '2026-11', folha: 12000, entra_antes: 0, entra_depois: 0, desembolsos: [], em_conta_apos_folha: 52000, em_conta_fim: 52000, orcamento_resta: 132000 },
  { mes: '2026-12', folha: 12000, entra_antes: 0, entra_depois: 0, desembolsos: [], em_conta_apos_folha: 40000, em_conta_fim: 40000, orcamento_resta: 120000 },
  {
    mes: '2027-01',
    folha: 12000,
    entra_antes: 0,
    entra_depois: 34000,
    desembolsos: [{ parcela: 3, liquido: 34000 }],
    em_conta_apos_folha: -8000,
    em_conta_fim: 26000,
    orcamento_resta: 108000,
  },
];

function criarPdfMinimoCatalogo() {
  const comandos = [
    'BT',
    '/F1 10 Tf',
    '1 0 0 1 42 740 Tm (BALANCETE DE DEMONSTRACAO - PROJETO 30.113) Tj',
    '1 0 0 1 42 700 Tm (7.1.3.04.01.09142 09142 PESSOAL E BOLSAS 612.400,00) Tj',
    '1 0 0 1 42 676 Tm (7.1.3.05.01.08110 08110 CUSTEIO E VIAGENS 168.000,00) Tj',
    'ET',
  ].join('\n');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${comandos.length} >>\nstream\n${comandos}\nendstream`,
  ];
  let texto = '%PDF-1.4\n';
  const offsets = [0];
  objetos.forEach((obj, idx) => {
    offsets.push(texto.length);
    texto += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefInicio = texto.length;
  texto += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objetos.length; i += 1) {
    texto += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  texto += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xrefInicio}\n%%EOF\n`;
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i += 1) {
    bytes[i] = texto.charCodeAt(i) & 0xff;
  }
  return bytes.buffer;
}

const ARVORE_CATALOGO = {
  valor: 84300,
  motivo: null,
  data_referencia: '2026-09-30',
  rotulo: 'Livres para gastar até ago/27',
  tipo: 'calculo',
  conta: 'soma dos grupos',
  chave: 'livre',
  sinal: 1,
  ref: null,
  nota: null,
  partes: [
    {
      rotulo: 'Pessoal',
      valor: 72300,
      tipo: 'calculo',
      chave: 'grupo:a',
      conta: 'previsto − realizado − comprometido',
      sinal: 1,
      ref: null,
      nota: null,
      partes: [
        {
          rotulo: 'Previsto — Bolsas e encargos',
          valor: 864000,
          tipo: 'calculo',
          chave: 'rubrica:a:previsto',
          conta: 'soma das linhas',
          sinal: 1,
          ref: null,
          nota: null,
          partes: [
            {
              rotulo: 'Bolsas de pesquisa',
              valor: 864000,
              tipo: 'legado',
              chave: 'linha:cat-pr-1',
              conta: null,
              sinal: 1,
              ref: null,
              nota: null,
              partes: [],
            },
          ],
        },
        {
          rotulo: 'Realizado — Bolsas e encargos',
          valor: 612400,
          tipo: 'calculo',
          chave: 'rubrica:a:realizado',
          conta: 'soma dos lançamentos',
          sinal: -1,
          ref: null,
          nota: null,
          partes: [
            {
              rotulo: '7.1.3.04.01.09142 — Pessoal e bolsas',
              valor: 612400,
              tipo: 'documento',
              chave: 'linha:cat-bl-1',
              conta: null,
              sinal: 1,
              ref: { alvo_tabela: 'balancete_lancamentos', alvo_id: 'cat-bl-1', campo: 'saldo_atual' },
              nota: null,
              partes: [],
            },
          ],
        },
        {
          rotulo: 'Comprometido — Bolsas ativas',
          valor: 179300,
          tipo: 'calculo',
          chave: 'rubrica:a:comprometido',
          conta: 'soma das bolsas',
          sinal: -1,
          ref: null,
          nota: null,
          partes: [
            {
              rotulo: 'Equipe vigente — 10 meses',
              valor: 179300,
              tipo: 'digitado',
              chave: 'linha:cat-b-1',
              conta: null,
              sinal: 1,
              ref: { alvo_tabela: 'scholarships', alvo_id: 'cat-b-1', campo: 'amount' },
              nota: null,
              partes: [],
            },
          ],
        },
      ],
    },
    {
      rotulo: 'Custeio e viagens',
      valor: 12000,
      tipo: 'calculo',
      chave: 'grupo:b',
      conta: 'previsto − realizado',
      sinal: 1,
      ref: null,
      nota: 'compromissos fora de bolsas não são rastreados',
      partes: [
        {
          rotulo: 'Previsto — Custeio e viagens',
          valor: 180000,
          tipo: 'calculo',
          chave: 'rubrica:b:previsto',
          conta: 'soma das linhas',
          sinal: 1,
          ref: null,
          nota: null,
          partes: [
            {
              rotulo: 'Custeio e viagens',
              valor: 180000,
              tipo: 'legado',
              chave: 'linha:cat-pr-2',
              conta: null,
              sinal: 1,
              ref: null,
              nota: null,
              partes: [],
            },
          ],
        },
        {
          rotulo: 'Realizado — Custeio e viagens',
          valor: 168000,
          tipo: 'calculo',
          chave: 'rubrica:b:realizado',
          conta: 'soma dos lançamentos',
          sinal: -1,
          ref: null,
          nota: null,
          partes: [
            {
              rotulo: '7.1.3.05.01.08110 — Custeio e viagens',
              valor: 168000,
              tipo: 'legado',
              chave: 'linha:cat-bl-2',
              conta: null,
              sinal: 1,
              ref: { alvo_tabela: 'balancete_lancamentos', alvo_id: 'cat-bl-2', campo: 'saldo_atual' },
              nota: null,
              partes: [],
            },
          ],
        },
      ],
    },
  ],
};

const ARVORE_DIGITADO_CATALOGO = {
  valor: 12000,
  motivo: null,
  data_referencia: null,
  rotulo: 'Reserva informada',
  tipo: 'digitado',
  conta: null,
  chave: 'reserva',
  sinal: 1,
  ref: null,
  nota: null,
  partes: [],
};

// Blocos da Análise com dados fictícios, um de cada tipo do contrato §6.
const BLOCO_NUMERO_CATALOGO = {
  id: 'cat-bloco-numero',
  tipo: 'numero',
  titulo: 'Livre do centro de exemplo',
  numero: {
    valor: 84300,
    unidade: 'moeda',
    rotulo: 'Livre — Pessoal (exemplo)',
    origem: { tipo: 'no', no: ARVORE_CATALOGO },
    contexto: { valor: '2026-09-30', unidade: 'data', origem: null },
  },
};

const BLOCO_TABELA_CATALOGO = {
  id: 'cat-bloco-tabela',
  tipo: 'tabela',
  titulo: 'Rubricas do exemplo',
  tabela: {
    colunas: [
      { rotulo: 'Rubrica', unidade: 'texto' },
      { rotulo: 'Previsto (R$)', unidade: 'moeda' },
      { rotulo: 'Percentual', unidade: 'percentual' },
    ],
    linhas: [
      [
        { valor: 'Pessoal', unidade: 'texto', origem: null },
        { valor: 864000, unidade: 'moeda', origem: { tipo: 'no', no: ARVORE_CATALOGO } },
        { valor: 12.5, unidade: 'percentual', origem: { tipo: 'sem_documento', motivo: 'percentual do catálogo, sem documento' } },
      ],
      [
        { valor: 'Custeio', unidade: 'texto', origem: null },
        { valor: null, unidade: 'moeda', origem: { tipo: 'sem_documento', motivo: 'sem balancete no exemplo' } },
        { valor: 7, unidade: 'percentual', origem: { tipo: 'no', no: ARVORE_CATALOGO } },
      ],
    ],
  },
};

const TEXTO_BLOCO_CATALOGO =
  'A reserva cobre 3 meses de folha; o restante está comprometido no exemplo.';
const INICIO_SEM_ORIGEM_CATALOGO = TEXTO_BLOCO_CATALOGO.indexOf('3 meses');

const BLOCO_TEXTO_CATALOGO = {
  id: 'cat-bloco-texto',
  tipo: 'texto',
  titulo: 'Texto com número sem origem',
  texto: {
    texto: TEXTO_BLOCO_CATALOGO,
    semOrigem: [
      { inicio: INICIO_SEM_ORIGEM_CATALOGO, fim: INICIO_SEM_ORIGEM_CATALOGO + '3 meses'.length },
    ],
  },
};


async function buscarOrigemCatalogo(ref) {
  if (ref.alvo_id === 'cat-b-1') {
    return {
      dados: {
        tipo: 'digitado',
        valor: 17930,
        documento: null,
        fato: null,
        busca: null,
        nota: 'Valor do cadastro de bolsas (planilha da FUNAPE), sem documento por linha.',
      },
      erro: null,
    };
  }
  const docPdf = {
    id: 'cat-doc-1',
    tipo: 'balancete',
    titulo: 'Balancete de set/26 · 30.113',
    arquivo_nome: 'balancete-30113-set-26.pdf',
    formato: 'pdf',
    bucket: 'catalogo',
    caminho: 'catalogo/balancete-30113-set-26.pdf',
    versao: 1,
    registrado_em: '2026-10-01T12:00:00Z',
  };
  if (ref.alvo_id === 'cat-bl-2') {
    return {
      dados: {
        tipo: 'legado',
        valor: 168000,
        documento: docPdf,
        fato: null,
        busca: { conta_codigo: '7.1.3.05.01.08110', valor: 168000 },
        nota: null,
      },
      erro: null,
    };
  }
  return {
    dados: {
      tipo: 'documento',
      valor: 612400,
      documento: docPdf,
      fato: {
        pagina: 1,
        trecho: '7.1.3.04.01.09142 09142 PESSOAL E BOLSAS 612.400,00',
        bbox: null,
        parser: 'balancete-parser',
        parser_versao: '1.0',
      },
      busca: null,
      nota: null,
    },
    erro: null,
  };
}

async function carregarArquivoCatalogo() {
  return { dados: criarPdfMinimoCatalogo(), erro: null };
}

// Ordem alfabética conforme §5.
const CENTROS_EXEMPLO = [
  {
    id: '30.113',
    nome: 'Global Methane Hub',
    codigo: '30.113',
    livre: 84300,
    ate: '2027-08-31',
    situacao: 'em dia',
  },
  {
    id: '30.XXX',
    nome: 'Kalungas',
    codigo: '30.XXX',
    livre: null,
    ate: null,
    situacao: 'sem balancete',
  },
  {
    id: '30.105',
    nome: 'Remap',
    codigo: '30.105',
    livre: 12900,
    ate: '2027-03-31',
    situacao: 'atenção',
  },
];

const RUBRICAS_EXEMPLO = [
  {
    id: 'pessoal',
    rubrica: 'Pessoal',
    previsto: 864000,
    realizado: 612400,
    comprometido: 167300,
    livre: 84300,
    situacao: 'em dia',
    detalhe: 'Saldo suficiente até ago/27 considerando 6 bolsas ativas.',
  },
  {
    id: 'custeio',
    rubrica: 'Custeio e viagens',
    previsto: 180000,
    realizado: 149200,
    comprometido: 17900,
    livre: 12900,
    situacao: 'atenção',
    detalhe: 'Reserva abaixo de 10% do previsto para o restante da vigência.',
  },
  {
    id: 'equipamentos',
    rubrica: 'Equipamentos',
    previsto: 95000,
    realizado: 99250,
    comprometido: 0,
    livre: -4250,
    situacao: 'problema',
    detalhe: 'Execução acima do previsto antes de remanejamento.',
  },
  {
    id: 'servicos',
    rubrica: 'Serviços de terceiros',
    previsto: 60000,
    realizado: null,
    comprometido: null,
    livre: null,
    situacao: 'sem balancete',
    detalhe: 'Balancete mais recente ainda não foi importado.',
  },
];

const BOLSAS_EXEMPLO = [
  { id: 'b1', funcao: 'Pesquisador pós-doc', inicio: '2026-03-01', fim: '2027-08-31', mensal: 5200, situacao: 'em dia' },
  { id: 'b2', funcao: 'Analista de geoprocessamento', inicio: '2026-05-01', fim: '2027-08-31', mensal: 3800, situacao: 'em dia' },
];

const DOCUMENTOS_EXEMPLO = [
  { id: 'd1', tipo: 'Balancete de set/26', data: '2026-09-30', situacao: 'em dia' },
  { id: 'd2', tipo: 'Plano de trabalho vigente', data: '2026-01-15', situacao: 'em dia' },
];

const FILTROS_SITUACAO = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'em dia', rotulo: 'Em dia' },
  { valor: 'atenção', rotulo: 'Atenção' },
  { valor: 'problema', rotulo: 'Problema' },
  { valor: 'sem balancete', rotulo: 'Sem balancete' },
];

const OPCOES_SELETOR = [
  { valor: '2026-09', rotulo: 'Balancete de set/26' },
  { valor: '2026-08', rotulo: 'Balancete de ago/26' },
  { valor: '2026-07', rotulo: 'Balancete de jul/26' },
];

/**
 * Catálogo vivo de todos os componentes + telas de referência (§5) com dados fictícios.
 */
export function Componentes({ centrosOcultos = 0, isAdmin = true }) {
  const [filtroCentro, setFiltroCentro] = useState('todas');
  const [abaProjeto, setAbaProjeto] = useState('dinheiro');
  const [busca, setBusca] = useState('');
  const [competencia, setCompetencia] = useState('2026-09');
  const [carregandoBtn, setCarregandoBtn] = useState(false);
  const [painel, setPainel] = useState(null);
  const [documento, setDocumento] = useState(null);
  const [menuDemoAberto, setMenuDemoAberto] = useState(false);
  const [previaManutencao, setPreviaManutencao] = useState(false);
  const [tentativas, setTentativas] = useState(0);
  const [conversaCatalogo, setConversaCatalogo] = useState(CONVERSAS_CATALOGO[0].id);
  const ancoraMenuRef = useRef(null);
  const gatilhoMenuRef = useRef(null);

  const centrosVisiveisLista = CENTROS_EXEMPLO.filter(
    (c) => filtroCentro === 'todas' || c.situacao === filtroCentro
  );

  const rubricasFiltradas = RUBRICAS_EXEMPLO.filter((item) => {
    return !busca.trim() || item.rubrica.toLowerCase().includes(busca.trim().toLowerCase());
  });

  const abrirArvoreOrigem = (titulo, tipoOrigem) => {
    setPainel({
      tipo: 'origem',
      titulo,
      subtitulo: tipoOrigem === 'digitado' ? 'Valor digitado, sem documento' : 'De onde vem este valor',
      arvore: tipoOrigem === 'digitado' ? ARVORE_DIGITADO_CATALOGO : ARVORE_CATALOGO,
    });
  };

  const abrirOrigemDoBloco = () => {
    setPainel({
      tipo: 'origem',
      titulo: 'De onde vem',
      subtitulo: 'Amostra de bloco do catálogo',
      arvore: ARVORE_CATALOGO,
    });
  };

  const abrirLinhaRubrica = (linha) => {
    setPainel({
      tipo: 'linha',
      titulo: linha.rubrica,
      subtitulo: `Situação: ${linha.situacao}`,
      linha,
    });
  };

  const colunasRubricas = [
    {
      chave: 'rubrica',
      titulo: 'Rubrica',
      render: (linha) => <span class="componentes__rubrica">{linha.rubrica}</span>,
    },
    {
      chave: 'previsto',
      titulo: 'Previsto (R$)',
      alinhamento: 'direita',
      render: (linha) => (
        <Valor valor={linha.previsto} centavos={false} semPrefixo alinhadoDireita semOrigem="Amostra de catálogo" />
      ),
    },
    {
      chave: 'realizado',
      titulo: 'Realizado (R$)',
      alinhamento: 'direita',
      render: (linha) => (
        <Valor
          valor={linha.realizado}
          centavos={false}
          semPrefixo
          alinhadoDireita
          motivoSemDado="sem balancete"
          semOrigem="Amostra de catálogo"
        />
      ),
    },
    {
      chave: 'comprometido',
      titulo: 'Comprometido (R$)',
      alinhamento: 'direita',
      render: (linha) => (
        <Valor
          valor={linha.comprometido}
          centavos={false}
          semPrefixo
          alinhadoDireita
          motivoSemDado="sem balancete"
          semOrigem="Amostra de catálogo"
        />
      ),
    },
    {
      chave: 'livre',
      titulo: 'Livre (R$)',
      alinhamento: 'direita',
      render: (linha) => (
        <Valor
          valor={linha.livre}
          centavos={false}
          semPrefixo
          problema={linha.situacao === 'problema'}
          alinhadoDireita
          motivoSemDado="sem balancete"
          semOrigem="Amostra de catálogo"
        />
      ),
    },
    {
      chave: 'situacao',
      titulo: 'Situação',
      render: (linha) => <Situacao estado={linha.situacao} />,
    },
  ];

  const abasProjeto = [
    {
      id: 'dinheiro',
      rotulo: 'Dinheiro',
      conteudo: (
        <>
          <div class="componentes__filtros">
            <Campo
              id="catalogo-busca"
              rotulo="Filtrar rubrica"
              valor={busca}
              aoMudar={setBusca}
              placeholder="Ex.: Pessoal"
              ajuda="Filtra apenas a tabela abaixo."
            />
            <Seletor
              id="catalogo-competencia"
              rotulo="Competência"
              valor={competencia}
              aoMudar={setCompetencia}
              opcoes={OPCOES_SELETOR}
              ajuda="Referência do balancete exibido."
            />
          </div>

          <Tabela
            colunas={colunasRubricas}
            dados={rubricasFiltradas}
            onClicarLinha={abrirLinhaRubrica}
            legenda="Execução por rubrica com dados fictícios"
            vazio={
              <Vazio
                mensagem="Nenhuma rubrica corresponde ao filtro digitado."
                rotuloBotao="Limpar busca"
                aoClicar={() => setBusca('')}
              />
            }
          />
        </>
      ),
    },
    {
      id: 'bolsas',
      rotulo: 'Bolsas',
      contagem: 6,
      conteudo: (
        <Tabela
          legenda="Bolsas vigentes (fictício)"
          colunas={[
            { chave: 'funcao', titulo: 'Função' },
            { chave: 'inicio', titulo: 'Início', render: (b) => <Valor valor={b.inicio} tipo="data" /> },
            { chave: 'fim', titulo: 'Término', render: (b) => <Valor valor={b.fim} tipo="data" /> },
            { chave: 'mensal', titulo: 'Mensal (R$)', alinhamento: 'direita', render: (b) => <Valor valor={b.mensal} semPrefixo alinhadoDireita semOrigem="Amostra de catálogo" /> },
            { chave: 'situacao', titulo: 'Situação', render: (b) => <Situacao estado={b.situacao} /> },
          ]}
          dados={BOLSAS_EXEMPLO}
        />
      ),
    },
    {
      id: 'documentos',
      rotulo: 'Documentos',
      contagem: 4,
      conteudo: (
        <Tabela
          legenda="Documentos do centro (fictício)"
          colunas={[
            { chave: 'tipo', titulo: 'Documento' },
            { chave: 'data', titulo: 'Data', render: (d) => <Valor valor={d.data} tipo="data-completa" /> },
            { chave: 'situacao', titulo: 'Situação', render: (d) => <Situacao estado={d.situacao} /> },
          ]}
          dados={DOCUMENTOS_EXEMPLO}
        />
      ),
    },
    {
      id: 'pendencias',
      rotulo: 'Pendências',
      contagem: 1,
      conteudo: (
        <AvisoFalha
          mensagem="Conta 7.1.3.99 ainda sem rubrica vinculada no balancete de set/26."
          aoTentarNovamente={() => setAbaProjeto('dinheiro')}
        />
      ),
    },
  ];

  const resumoProjetos = [
    '17 centros',
    `${dinheiroCompacto(1240000)} livres no total`,
    centrosOcultos > 0 ? `${centrosOcultos} centros ocultos` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div class="conteudo">
      {/* Referência 1: Tela Projetos (§5) */}
      <section class="componentes__secao" aria-labelledby="secao-projetos">
        <h2 id="secao-projetos" class="componentes__rotulo-secao">
          Tela Projetos
        </h2>

        <CabecalhoPagina
          titulo="Projetos"
          contexto={resumoProjetos}
        />

        <div class="componentes__chips">
          {FILTROS_SITUACAO.map((f) => (
            <Chip
              key={f.valor}
              ativo={filtroCentro === f.valor}
              onClick={() => setFiltroCentro(f.valor)}
            >
              {f.rotulo}
            </Chip>
          ))}
        </div>

        <Lista ariaLabel="Centros de custo (referência)">
          {centrosVisiveisLista.map((centro) => (
            <LinhaDeLista
              key={centro.id}
              href="#/componentes"
              onClick={(e) => {
                e.preventDefault();
                setPainel({
                  tipo: 'linha',
                  titulo: `${centro.nome} · ${centro.codigo}`,
                  subtitulo: 'Prévia de navegação da lista',
                  linha: {
                    previsto: 864000,
                    realizado: 612400,
                    comprometido: 167300,
                    livre: centro.livre,
                    situacao: centro.situacao,
                    detalhe: 'Na tela real, clicar na linha abre #/projetos/:id.',
                  },
                });
              }}
            >
              <span class="componentes__lista-nome">{centro.nome}</span>
              <span class="componentes__lista-codigo">{centro.codigo}</span>
              <span class="componentes__lista-saldo">
                {centro.livre !== null ? (
                  <>
                    <Valor valor={centro.livre} centavos={false} semOrigem="Resumo de lista no catálogo" /> livres até{' '}
                    <Valor valor={centro.ate} tipo="data" />
                  </>
                ) : (
                  <Valor valor={null} motivoSemDado="sem balancete" semOrigem="Centro sem balancete no catálogo" />
                )}
              </span>
              <Situacao estado={centro.situacao} />
            </LinhaDeLista>
          ))}
        </Lista>
      </section>

      {/* Referência 2: Página do projeto (§5) */}
      <section class="componentes__secao" aria-labelledby="secao-pagina-projeto">
        <h2 id="secao-pagina-projeto" class="componentes__rotulo-secao">
          Página do projeto
        </h2>

        <CabecalhoPagina
          voltar={{
            rotulo: 'Projetos',
            href: '#/componentes',
            onClick: (e) => e.preventDefault(),
          }}
          titulo="Global Methane Hub · 30.113"
          contexto={(
            <>
              Vigência até <Valor valor="2027-08-31" tipo="data-completa" /> · faltam 21 meses ·{' '}
              <span class="componentes__nota-discreta">vigência digitada</span>
            </>
          )}
          acoes={isAdmin ? (
            <Botao
              variante="secundario"
              icone={ExternalLink}
              onClick={() =>
                setDocumento({
                  titulo: 'Plano de trabalho · 30.113',
                  arquivo: 'plano-trabalho-30113.docx',
                  pagina: 4,
                  valor: 84300,
                  parte: 'Resumo de saldo livre até ago/27',
                  achadoPor: 'achado pelo código 30.113',
                  trecho: 'Recurso disponível projetado até o término da vigência: R$ 84.300,00.',
                })
              }
            >
              Pasta no Drive
            </Botao>
          ) : null}
        />

        <GradeDestaques>
          <Destaque
            principal
            rotulo="Livres para gastar até ago/27"
            valor={(
              <Valor
                valor={84300}
                centavos={false}
                origem={{ resumo: 'Conta com origem registrada' }}
                onOrigem={() => abrirArvoreOrigem('Livres para gastar até ago/27', 'calculo')}
              />
            )}
            contexto="balancete de set/26"
          />
          <Destaque
            rotulo="Bolsas por mês"
            valor={<Valor valor={18400} centavos={false} semOrigem="Soma das bolsas do catálogo" />}
            contexto="6 bolsistas ativos"
          />
          <Destaque
            rotulo="Desembolsos"
            valor="3 de 4"
            contexto="próximo em jan/27"
          />
          <Destaque
            rotulo="Pendências"
            valor="1"
            contexto="1 aberta neste centro"
          />
        </GradeDestaques>

        <Cartao
          titulo="Execução por rubrica"
          subtitulo="Alterne entre as abas ou clique em qualquer linha da tabela."
        >
          <Abas itens={abasProjeto} ativa={abaProjeto} aoSelecionar={setAbaProjeto} ariaLabel="Blocos do projeto" />
        </Cartao>
      </section>

      {/* Seção 3: Catálogo isolado dos demais componentes */}
      <section class="componentes__secao" aria-labelledby="secao-catalogo">
        <h2 id="secao-catalogo" class="componentes__rotulo-secao">
          Componentes e estados
        </h2>

        <div class="componentes__grade-dupla">
          <Cartao titulo="Valores e datas">
            <dl class="componentes__lista-definicao">
              <div class="componentes__par">
                <dt>Sem centavos (lista/destaque)</dt>
                <dd><Valor valor={84300} centavos={false} semOrigem="Amostra visual do componente" /></dd>
              </div>
              <div class="componentes__par">
                <dt>Com centavos (painel/documento)</dt>
                <dd><Valor valor={84300.45} centavos semOrigem="Amostra visual do componente" /></dd>
              </div>
              <div class="componentes__par">
                <dt>Compacto (total/eixo)</dt>
                <dd><Valor valor={1240000} tipo="moeda-compacta" semOrigem="Amostra visual do componente" /></dd>
              </div>
              <div class="componentes__par">
                <dt>Negativo que é problema</dt>
                <dd><Valor valor={-4250} centavos problema semOrigem="Amostra visual do componente" /></dd>
              </div>
              <div class="componentes__par">
                <dt>Negativo pequeno (preserva sinal)</dt>
                <dd><Valor valor={-0.4} centavos problema semOrigem="Amostra visual do componente" /></dd>
              </div>
              <div class="componentes__par">
                <dt>Ausência de dado</dt>
                <dd><Valor valor={null} motivoSemDado="sem balancete" semOrigem="Amostra visual do componente" /></dd>
              </div>
              <div class="componentes__par">
                <dt>Valor digitado (sem documento)</dt>
                <dd>
                  <Valor
                    valor={12000}
                    centavos={false}
                    origem={{ tipo: 'digitado', resumo: 'Valor digitado' }}
                    onOrigem={() => abrirArvoreOrigem('Reserva informada', 'digitado')}
                  />
                </dd>
              </div>
              <div class="componentes__par">
                <dt>Data compacta e completa</dt>
                <dd>
                  <Valor valor="2026-09-30" tipo="data" /> · <Valor valor="2026-09-30" tipo="data-completa" />
                </dd>
              </div>
            </dl>
          </Cartao>

          <Cartao titulo="Situações, botões e menus">
            <div class="componentes__situacoes">
              <Situacao estado="em dia" />
              <Situacao estado="atenção" />
              <Situacao estado="problema" />
              <Situacao estado="sem balancete" />
              <Situacao estado="sem plano" />
              <Situacao estado="sem dado" />
            </div>

            <div class="componentes__botoes">
              <Botao variante="primario" onClick={() => setCarregandoBtn((v) => !v)}>
                Ação principal
              </Botao>
              <Botao
                variante="secundario"
                icone={RefreshCw}
                carregando={carregandoBtn}
                onClick={() => setCarregandoBtn((v) => !v)}
              >
                {carregandoBtn ? 'Atualizando' : 'Secundário'}
              </Botao>
              <Botao
                variante="fantasma"
                tamanho="compacto"
                icone={FileText}
                onClick={() =>
                  setDocumento({
                    titulo: 'Balancete de set/26 · 30.113',
                    arquivo: 'balancete-30113-set-26.pdf',
                    pagina: 2,
                    valor: 142300.5,
                    parte: 'Saldo disponível em conta movimento',
                    achadoPor: 'achado pelo código 2.1.3.01',
                    trecho: 'Saldo final disponível sem aplicação financeira: R$ 142.300,50 (conta 2.1.3.01).',
                  })
                }
              >
                Abrir documento
              </Botao>
            </div>

            <div class="componentes__menus-amostra">
              <div class="componentes__ancora" ref={ancoraMenuRef}>
                <button
                  ref={gatilhoMenuRef}
                  type="button"
                  class={`chip${menuDemoAberto ? ' chip--ativo' : ''}`}
                  aria-expanded={menuDemoAberto ? 'true' : 'false'}
                  onClick={() => setMenuDemoAberto((v) => !v)}
                >
                  <span>Divulgação</span>
                  <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <MenuSuspenso
                  aberto={menuDemoAberto}
                  aoFechar={() => setMenuDemoAberto(false)}
                  ancoraRef={ancoraMenuRef}
                  gatilhoRef={gatilhoMenuRef}
                  alinhar="esquerda"
                  ariaLabel="Ações de exemplo"
                >
                  <MenuSuspensoItem onClick={() => setMenuDemoAberto(false)}>
                    Mostrar todos os centros
                  </MenuSuspensoItem>
                  <MenuSuspensoItem onClick={() => setMenuDemoAberto(false)}>
                    Só os de um professor
                  </MenuSuspensoItem>
                  <MenuSuspensoSeparador />
                  <MenuSuspensoItem
                    onClick={() => {
                      setMenuDemoAberto(false);
                      setPreviaManutencao(true);
                    }}
                  >
                    Pré-visualizar manutenção
                  </MenuSuspensoItem>
                </MenuSuspenso>
              </div>

              <Sino
                pendencias={[
                  { id: 'p1', titulo: 'Conta sem rubrica', centro: '30.113', tempo: 'há 2 h' },
                ]}
              />
              <MenuUsuario usuario={{ nome: 'Victor Amaral', iniciais: 'VA' }} isAdmin />
            </div>

            <Campo
              id="catalogo-erro"
              rotulo="Campo com erro"
              valor="valor inválido"
              erro="Informe um número maior que zero."
            />
          </Cartao>
        </div>

        <Cartao
          titulo="Blocos da Análise"
          subtitulo="Um exemplo de cada tipo do contrato: número, tabela e texto. Dados fictícios; os números clicáveis abrem a árvore de exemplo."
        >
          <BlocoAnalise bloco={BLOCO_NUMERO_CATALOGO} onOrigem={abrirOrigemDoBloco} />
          <BlocoAnalise bloco={BLOCO_TABELA_CATALOGO} onOrigem={abrirOrigemDoBloco} />
          <BlocoAnalise bloco={BLOCO_TEXTO_CATALOGO} onOrigem={abrirOrigemDoBloco} />
        </Cartao>

        <Cartao
          titulo="Projeção das bolsas"
          subtitulo="Duas barras por mês: dinheiro em conta depois da folha e orçamento de Bolsas que resta. Dados fictícios."
        >
          <GraficoProjecao meses={MESES_PROJECAO_CATALOGO} mesFalta="2027-01" />
        </Cartao>

        <Cartao titulo="Conversas da Análise">
          <ListaConversas
            conversas={CONVERSAS_CATALOGO}
            ativaId={conversaCatalogo}
            onSelecionar={setConversaCatalogo}
            onNova={() => setConversaCatalogo(null)}
            agora={new Date()}
            className="componentes__lista-conversas"
          />
        </Cartao>

        <Cartao titulo="Avisos, estado vazio e tabela vazia">
          <AvisoFalha
            mensagem={`Não foi possível consultar o balancete de set/26${tentativas > 0 ? ` (tentativa ${tentativas})` : ''}.`}
            aoTentarNovamente={() => setTentativas((n) => n + 1)}
          />
          <AvisoFalha
            grave
            mensagem="A leitura automática falhou ao conferir a soma dos lançamentos."
          />
          <Tabela colunas={colunasRubricas} dados={[]} legenda="Tabela sem registros" />
          <Vazio
            mensagem="Em construção."
            rotuloBotao="Pré-visualizar manutenção"
            aoClicar={() => setPreviaManutencao(true)}
          />
        </Cartao>

        <Cartao titulo="Carregamento (esqueleto)">
          <div class="componentes__esqueletos">
            <Esqueleto variante="destaque" />
            <Esqueleto variante="cartao" linhas={3} />
          </div>
          <Esqueleto variante="tabela" linhas={3} />
        </Cartao>
      </section>

      <PainelLateral
        aberto={Boolean(painel)}
        aoFechar={() => setPainel(null)}
        titulo={painel?.titulo || ''}
        subtitulo={painel?.subtitulo || ''}
      >
        {painel?.tipo === 'origem' && (
          <DeOndeVem
            arvore={painel.arvore}
            buscarOrigem={buscarOrigemCatalogo}
            carregarArquivo={carregarArquivoCatalogo}
          />
        )}

        {painel?.tipo === 'linha' && (
          <div class="componentes__painel-bloco">
            <dl class="componentes__lista-definicao">
              <div class="componentes__par">
                <dt>Previsto</dt>
                <dd><Valor valor={painel.linha.previsto} centavos semOrigem="Amostra de catálogo" /></dd>
              </div>
              <div class="componentes__par">
                <dt>Realizado</dt>
                <dd><Valor valor={painel.linha.realizado} centavos motivoSemDado="sem balancete" semOrigem="Amostra de catálogo" /></dd>
              </div>
              <div class="componentes__par">
                <dt>Comprometido</dt>
                <dd><Valor valor={painel.linha.comprometido} centavos motivoSemDado="sem balancete" semOrigem="Amostra de catálogo" /></dd>
              </div>
              <div class="componentes__par">
                <dt>Livre</dt>
                <dd>
                  <Valor
                    valor={painel.linha.livre}
                    centavos
                    problema={painel.linha.situacao === 'problema'}
                    motivoSemDado="sem balancete"
                    semOrigem="Amostra de catálogo"
                  />
                </dd>
              </div>
            </dl>
            <p class="texto-corrido">{painel.linha.detalhe}</p>
          </div>
        )}
      </PainelLateral>

      <Documento
        aberto={Boolean(documento)}
        aoFechar={() => setDocumento(null)}
        titulo={documento?.titulo || ''}
        arquivo={documento?.arquivo || ''}
        pagina={documento?.pagina || null}
        valor={documento?.valor ?? null}
        parte={documento?.parte || ''}
        achadoPor={documento?.achadoPor || ''}
        trecho={documento?.trecho || ''}
      />

      {previaManutencao && (
        <Manutencao
          mensagem="O Controle Financeiro está em atualização. Volte em alguns minutos — não é preciso fazer nada."
          aoFecharPrevia={() => setPreviaManutencao(false)}
        />
      )}
    </div>
  );
}
