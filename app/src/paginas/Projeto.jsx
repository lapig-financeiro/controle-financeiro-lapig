import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ExternalLink } from 'lucide-preact';
import { situacaoDasParcelas } from '../../../frontend/js/planejamento-dinheiro.js';
import {
  Abas,
  AvisoFalha,
  Botao,
  CabecalhoPagina,
  Cartao,
  DeOndeVem,
  Destaque,
  Documento,
  Esqueleto,
  GradeDestaques,
  PainelLateral,
  Situacao,
  Tabela,
  Valor,
  Vazio,
} from '../componentes/index.js';
import { ehCliqueNavegacaoSimples, urlProjeto } from '../roteador.js';
import {
  balancetes,
  conferirTermoContrato,
  explicarLivre,
  origem,
  pendencias,
  planos,
  repasses,
  resolverPendencia,
  saldoLivre,
  situacaoCentro,
  termosContrato,
  usarVigenciaDoContrato,
} from '../servicos/dados.js';
import {
  dataCompacta,
  dataCompleta,
  dinheiro,
  hojeISO,
  mesesRestantes,
  tempoRelativo,
} from '../util/formato.js';
import './Projeto.css';

const ROTULOS_ORIGEM = {
  sistema: 'Sistema',
  buriti: 'Buriti',
  claude: 'Claude',
  pessoa: 'Pessoa',
};

const ROTULOS_TIPO_PENDENCIA = {
  balancete: 'Balancete',
  plano: 'Plano de trabalho',
  bolsas: 'Bolsas',
  contrato: 'Contrato',
  cadastro: 'Cadastro',
  outro: 'Outro',
};

const ROTULOS_TERMO_CONTRATO = {
  vigencia_inicio: 'Início da vigência',
  vigencia_fim: 'Fim da vigência',
  taxa_total: 'Taxa total do contrato',
  taxa_cip_ufg: 'Taxa CIP — UFG',
  taxa_cip_ua: 'Taxa CIP — unidade acadêmica',
  taxa_dao: 'Taxa DAO — fundação',
};

const ORDEM_TERMOS_CONTRATO = [
  'vigencia_inicio',
  'vigencia_fim',
  'taxa_total',
  'taxa_cip_ufg',
  'taxa_cip_ua',
  'taxa_dao',
];

const ROTULOS_TAXA_CONTRATO = [
  { chave: 'taxa_cip_ufg', rotulo: 'UFG' },
  { chave: 'taxa_cip_ua', rotulo: 'unidade' },
  { chave: 'taxa_dao', rotulo: 'fundação' },
];

function milesimosDePct(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

/**
 * Texto de percentual a partir de milésimos, sem arredondar: a coluna
 * `valor_pct` é `numeric(6,3)` e o valor exibido é o mesmo que está no
 * banco (8 -> "8", 8.5 -> "8,5", 8.125 -> "8,125").
 */
function textoPct(milesimos) {
  if (milesimos === null || milesimos === undefined) return '—';
  const negativo = milesimos < 0;
  const abs = Math.abs(milesimos);
  const inteiro = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${negativo ? '\u2212' : ''}${inteiro}${frac ? `,${frac}` : ''}`;
}

function dataDoTermo(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.slice(0, 10);
  return DATA_ISO_RE.test(texto) ? texto : null;
}

function valorDoTermoContrato(chave, termo) {
  if (chave.startsWith('vigencia_')) {
    const data = dataDoTermo(termo?.valor);
    return data ? dataCompleta(data) : '—';
  }
  return `${textoPct(milesimosDePct(termo?.valor))}%`;
}

function posicaoTermoContrato(chave) {
  const indice = ORDEM_TERMOS_CONTRATO.indexOf(chave);
  return indice === -1 ? ORDEM_TERMOS_CONTRATO.length : indice;
}

const DATA_ISO_RE = /^\d{4}-\d{2}-\d{2}/;

const AJUDA_DINHEIRO_CONTA =
  'Tudo o que está na conta do projeto, pelo último balancete. O livre é outra conta: o previsto no plano menos o que já foi gasto e o que já está comprometido (bolsas, taxas).';
const AJUDA_RENDIMENTO =
  'Já está dentro do dinheiro em conta. Rendimento tem regras próprias de uso.';
const AJUDA_DINHEIRO_CONTA_ID = 'destaque-dinheiro-em-conta-ajuda';
const AJUDA_RENDIMENTO_ID = 'destaque-dinheiro-em-conta-rendimento-ajuda';

/**
 * Balancete mais recente por `data_referencia` (a mesma regra de
 * `v_balancete_vigente`). `balancetes` tem `unique (project_id,
 * data_referencia)` e `data_referencia not null` na 026, então não há
 * empate; a checagem de data é só defesa contra entrada incompleta.
 */
function balanceteMaisRecente(lista) {
  if (!Array.isArray(lista)) return null;
  let maisRecente = null;
  let maiorData = '';

  for (const balancete of lista) {
    const data = String(balancete?.data_referencia || '').slice(0, 10);
    if (!DATA_ISO_RE.test(data)) continue;
    if (!maisRecente || data > maiorData) {
      maisRecente = balancete;
      maiorData = data;
    }
  }

  return maisRecente;
}

function docsVazios(projectId) {
  return {
    projectId,
    carregandoBalancetes: true,
    carregandoPlanos: true,
    balancetes: [],
    planos: [],
    erroBalancetes: null,
    erroPlanos: null,
  };
}

function numeroFinito(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function somarGrupos(grupos) {
  if (!Array.isArray(grupos) || grupos.length === 0) {
    return { soma: null, somaCentavos: null, invalida: false };
  }
  let totalCentavos = 0;
  for (const g of grupos) {
    const v = numeroFinito(g?.saldo_livre);
    if (v === null) {
      return { soma: null, somaCentavos: null, invalida: true };
    }
    totalCentavos += Math.round(v * 100);
  }
  return { soma: totalCentavos / 100, somaCentavos: totalCentavos, invalida: false };
}

export function situacaoGrupo(grupo, hasBalancete, defasagemMeses, motivos = null) {
  if (!hasBalancete) return 'sem balancete';
  const livre = numeroFinito(grupo?.saldo_livre);
  if (livre === null) return 'sem dado';
  const lista = Array.isArray(motivos) ? motivos : [];
  const tarifa = lista.some((motivo) => motivo?.codigo === 'tarifa_bancaria');
  if (livre < 0 && tarifa) return 'atenção';
  if (livre < 0) return 'problema';
  const defasagem = numeroFinito(defasagemMeses);
  if (defasagem !== null && defasagem >= 2) {
    return 'atenção';
  }
  return 'em dia';
}

function resumirRepasses(repassesDados, hasPlano, hoje) {
  if (!repassesDados) {
    return {
      valor: <Valor valor={null} motivoSemDado="indisponível" semOrigem="Parcelas do cronograma" />,
      contexto: 'indisponível',
    };
  }

  const recebidoValido = repassesDados.recursos
    ? numeroFinito(repassesDados.recursos.recebido)
    : null;
  const aReceberValido = repassesDados.recursos
    ? numeroFinito(repassesDados.recursos.a_receber)
    : null;
  const recursosValidos =
    recebidoValido !== null && aReceberValido !== null
      ? {
          ...repassesDados.recursos,
          recebido: recebidoValido,
          a_receber: aReceberValido,
        }
      : null;

  const calc = situacaoDasParcelas({
    parcelas: repassesDados.parcelas || [],
    recursos: recursosValidos,
    dataBalancete: repassesDados.data_balancete || null,
    hoje,
    totalPlano: numeroFinito(repassesDados.valor_total_plano),
  });

  if (calc.itens.length === 0) {
    const motivo = hasPlano === false ? 'sem plano' : 'sem cronograma';
    return {
      valor: <Valor valor={null} motivoSemDado={motivo} semOrigem="Parcelas do cronograma" />,
      contexto: motivo,
    };
  }

  if (calc.recebido === null) {
    const motivo = repassesDados.data_balancete || repassesDados.recursos
      ? 'sem dados de recurso'
      : 'sem balancete';
    return {
      valor: <Valor valor={null} motivoSemDado={motivo} semOrigem="Parcelas do cronograma" />,
      contexto: motivo,
    };
  }

  if (calc.sem_valores) {
    return {
      valor: (
        <Valor
          valor={calc.recebido}
          centavos={false}
          semOrigem="Total recebido acumulado no balancete"
        />
      ),
      contexto:
        calc.falta_sem_cronograma != null
          ? `faltam ${dinheiro(calc.falta_sem_cronograma, { centavos: false })}`
          : 'recebido até agora',
    };
  }

  const total = calc.itens.length;
  const recebidas = calc.itens.filter((i) => i.situacao === 'recebida').length;
  const contar = (sit) => calc.itens.filter((i) => i.situacao === sit).length;
  const atrasadas = contar('atrasada');
  const parciais = contar('parcial');
  const notasEmitidas = contar('nota_emitida');
  const aConfirmar = contar('confirmar');
  const semData = contar('sem_data');
  const proximaFutura = calc.itens.find((i) => i.situacao === 'futura' && i.mes);

  let contexto;
  if (atrasadas > 0) {
    contexto = atrasadas === 1 ? '1 parcela atrasada' : `${atrasadas} parcelas atrasadas`;
  } else if (parciais > 0) {
    contexto = parciais === 1 ? '1 parcela parcial' : `${parciais} parcelas parciais`;
  } else if (notasEmitidas > 0) {
    contexto = notasEmitidas === 1 ? '1 nota emitida' : `${notasEmitidas} notas emitidas`;
  } else if (aConfirmar > 0) {
    contexto = aConfirmar === 1 ? '1 parcela a confirmar' : `${aConfirmar} parcelas a confirmar`;
  } else if (semData > 0) {
    contexto = semData === 1 ? '1 parcela sem data' : `${semData} parcelas sem data`;
  } else if (proximaFutura) {
    contexto = `próximo em ${dataCompacta(proximaFutura.mes)}`;
  } else if (recebidas === total) {
    contexto = 'todas recebidas';
  } else {
    contexto = 'cronograma em dia';
  }

  return {
    valor: `${recebidas} de ${total}`,
    contexto,
  };
}

function resumirDetalhePendencia(detalhe) {
  if (!detalhe || typeof detalhe !== 'object') return [];
  const pares = [];
  if (detalhe.descricao) pares.push({ rotulo: 'Detalhe', valor: String(detalhe.descricao) });
  if (detalhe.observacao) pares.push({ rotulo: 'Observação', valor: String(detalhe.observacao) });
  if (detalhe.conta) pares.push({ rotulo: 'Conta', valor: String(detalhe.conta) });
  if (detalhe.rubrica) pares.push({ rotulo: 'Rubrica', valor: String(detalhe.rubrica) });
  if (detalhe.documento) pares.push({ rotulo: 'Documento', valor: String(detalhe.documento) });
  if (detalhe.competencia) {
    pares.push({ rotulo: 'Competência', valor: dataCompacta(detalhe.competencia) });
  }
  return pares;
}

function validarUrlDrive(url) {
  if (typeof url !== 'string') return null;
  const limpa = url.trim();
  return /^https?:\/\//i.test(limpa) ? limpa : null;
}

function validarUrlDocumentoContrato(url) {
  if (typeof url !== 'string') return null;
  const limpa = url.trim();
  return /^https:\/\/(drive|docs)\.google\.com\//.test(limpa) ? limpa : null;
}

/**
 * Página individual do centro de custo (`#/projeto/<id>[/<aba>]`).
 */
export function Projeto({
  projectId,
  abaInicial = null,
  resumoCentro = null,
  centroOculto = false,
  centroOcultoInfo = null,
  carregandoResumo = false,
  erroResumo = null,
  isAdmin = false,
  hoje = hojeISO(),
  onNavegar = null,
  onMudarPendencias = null,
  onRecarregarResumo = null,
  onMostrarEsteCentro = null,
}) {
  const [abaAtiva, setAbaAtiva] = useState(abaInicial || 'dinheiro');
  const [saldoSt, setSaldoSt] = useState({ carregando: true, dados: null, erro: null });
  const [situacaoSt, setSituacaoSt] = useState({ carregando: true, dados: null, erro: null });
  const [repassesSt, setRepassesSt] = useState({ carregando: true, dados: null, erro: null });
  const [docsSt, setDocsSt] = useState(() => docsVazios(null));
  const [pendenciasSt, setPendenciasSt] = useState({ carregando: true, dados: [], erro: null });
  const [termosSt, setTermosSt] = useState({ carregando: true, dados: null, erro: null });
  const [painelContrato, setPainelContrato] = useState(false);
  const [salvandoTermoId, setSalvandoTermoId] = useState(null);
  const [erroTermo, setErroTermo] = useState(null);
  const [confirmacaoContrato, setConfirmacaoContrato] = useState(false);
  const [usandoVigencia, setUsandoVigencia] = useState(false);

  const [painelOrigem, setPainelOrigem] = useState(null);
  const [explicarSt, setExplicarSt] = useState({
    carregando: false,
    dados: null,
    erro: null,
    consultado: false,
  });
  const [docAbaSt, setDocAbaSt] = useState({
    carregandoId: null,
    erro: null,
    nota: null,
    refPendente: null,
    doc: null,
  });
  const [confirmacao, setConfirmacao] = useState(null);
  const [salvandoPendenciaId, setSalvandoPendenciaId] = useState(null);
  const [erroResolucao, setErroResolucao] = useState(null);
  const [mostrandoCentro, setMostrandoCentro] = useState(false);
  const [erroMostrarCentro, setErroMostrarCentro] = useState(null);

  const montadoRef = useRef(true);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const abaAtivaRef = useRef(abaAtiva);
  abaAtivaRef.current = abaAtiva;
  const docsBlocoRef = useRef(null);
  const rolarParaDocumentosRef = useRef(false);

  const genSaldoRef = useRef(0);
  const genSituacaoRef = useRef(0);
  const genRepassesRef = useRef(0);
  const genDocsRef = useRef(0);
  const genPendenciasRef = useRef(0);
  const genResolucaoRef = useRef(0);
  const genExplicarRef = useRef(0);
  const genDocAbaRef = useRef(0);
  const genTermosRef = useRef(0);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  useEffect(() => {
    setAbaAtiva(abaInicial || 'dinheiro');
  }, [projectId, abaInicial]);

  useEffect(() => {
    setPainelOrigem(null);
    setExplicarSt({ carregando: false, dados: null, erro: null, consultado: false });
    setDocAbaSt({ carregandoId: null, erro: null, nota: null, refPendente: null, doc: null });
    setDocsSt(docsVazios(projectId));
    rolarParaDocumentosRef.current = false;
    setConfirmacao(null);
    setErroResolucao(null);
    setErroMostrarCentro(null);
    setSalvandoPendenciaId(null);
    setTermosSt({ carregando: true, dados: null, erro: null });
    setSituacaoSt({ carregando: true, dados: null, erro: null });
    setPainelContrato(false);
    setSalvandoTermoId(null);
    setErroTermo(null);
    setConfirmacaoContrato(false);
    setUsandoVigencia(false);
  }, [projectId]);

  useEffect(() => {
    if (abaAtiva !== 'documentos' || !rolarParaDocumentosRef.current) return;
    rolarParaDocumentosRef.current = false;
    docsBlocoRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [abaAtiva]);

  const carregarExplicar = useCallback(async () => {
    const id = projectId;
    const gen = ++genExplicarRef.current;
    setExplicarSt((prev) => ({ ...prev, carregando: true, erro: null }));
    let res;
    try {
      res = await explicarLivre(id);
    } catch {
      res = { dados: null, erro: 'Não foi possível carregar a origem do saldo livre.' };
    }
    if (!montadoRef.current || projectIdRef.current !== id || gen !== genExplicarRef.current) {
      return;
    }
    if (res?.erro || !res?.dados) {
      setExplicarSt({
        carregando: false,
        dados: null,
        erro: res?.erro || 'Não foi possível carregar a origem do saldo livre.',
        consultado: true,
      });
      return;
    }
    setExplicarSt({ carregando: false, dados: res.dados, erro: null, consultado: true });
  }, [projectId]);

  const carregarSaldo = useCallback(async () => {
    const id = projectId;
    const gen = ++genSaldoRef.current;
    setSaldoSt({ carregando: true, dados: null, erro: null });
    const res = await saldoLivre(id);
    if (!montadoRef.current || projectIdRef.current !== id || gen !== genSaldoRef.current) {
      return;
    }
    setSaldoSt({ carregando: false, dados: res.dados, erro: res.erro });
  }, [projectId]);

  const carregarSituacao = useCallback(async () => {
    const id = projectId;
    const gen = ++genSituacaoRef.current;
    setSituacaoSt({ carregando: true, dados: null, erro: null });
    let res;
    try {
      res = await situacaoCentro(id);
    } catch {
      res = { dados: null, erro: null };
    }
    if (!montadoRef.current || projectIdRef.current !== id || gen !== genSituacaoRef.current) {
      return;
    }
    // Sem dado (RPC ainda não aplicada ou falha) a página fica com a
    // regra de hoje; o selo não inventa motivo.
    setSituacaoSt({ carregando: false, dados: res?.dados || null, erro: res?.erro || null });
  }, [projectId]);

  const carregarRepasses = useCallback(async () => {
    const id = projectId;
    const gen = ++genRepassesRef.current;
    setRepassesSt({ carregando: true, dados: null, erro: null });
    const res = await repasses(id);
    if (!montadoRef.current || projectIdRef.current !== id || gen !== genRepassesRef.current) {
      return;
    }
    setRepassesSt({ carregando: false, dados: res.dados, erro: res.erro });
  }, [projectId]);

  const carregarDocumentos = useCallback(async () => {
    const id = projectId;
    const gen = ++genDocsRef.current;
    setDocsSt(docsVazios(id));

    const carregarBalancetesDoCentro = (async () => {
      let res;
      try {
        res = await balancetes(id);
      } catch {
        res = { dados: null, erro: 'Não foi possível carregar os balancetes deste centro.' };
      }
      if (!montadoRef.current || projectIdRef.current !== id || gen !== genDocsRef.current) {
        return;
      }
      setDocsSt((prev) =>
        prev.projectId === id
          ? {
              ...prev,
              carregandoBalancetes: false,
              balancetes: Array.isArray(res.dados) ? res.dados : [],
              erroBalancetes: res.erro,
            }
          : prev
      );
    })();

    const carregarPlanosDoCentro = (async () => {
      let res;
      try {
        res = await planos(id);
      } catch {
        res = { dados: null, erro: 'Não foi possível carregar os planos deste centro.' };
      }
      if (!montadoRef.current || projectIdRef.current !== id || gen !== genDocsRef.current) {
        return;
      }
      setDocsSt((prev) =>
        prev.projectId === id
          ? {
              ...prev,
              carregandoPlanos: false,
              planos: Array.isArray(res.dados) ? res.dados : [],
              erroPlanos: res.erro,
            }
          : prev
      );
    })();

    await Promise.all([carregarBalancetesDoCentro, carregarPlanosDoCentro]);
  }, [projectId]);

  const carregarPendencias = useCallback(async () => {
    const id = projectId;
    const gen = ++genPendenciasRef.current;
    setPendenciasSt({ carregando: true, dados: [], erro: null });
    const res = await pendencias(id);
    if (!montadoRef.current || projectIdRef.current !== id || gen !== genPendenciasRef.current) {
      return;
    }
    setPendenciasSt({
      carregando: false,
      dados: Array.isArray(res.dados) ? res.dados : [],
      erro: res.erro,
    });
  }, [projectId]);

  const carregarTermos = useCallback(async () => {
    const id = projectId;
    const gen = ++genTermosRef.current;
    setTermosSt((prev) => ({ ...prev, carregando: true, erro: null }));
    let res;
    try {
      res = await termosContrato(id);
    } catch {
      res = { dados: null, erro: 'Não foi possível carregar os termos do contrato.' };
    }
    if (!montadoRef.current || projectIdRef.current !== id || gen !== genTermosRef.current) {
      return;
    }
    setTermosSt({ carregando: false, dados: res?.dados || null, erro: res?.erro || null });
  }, [projectId]);

  useEffect(() => {
    const saldoRef = genSaldoRef;
    const situacaoRef = genSituacaoRef;
    const repassesRef = genRepassesRef;
    const docsRef = genDocsRef;
    const pendenciasRef = genPendenciasRef;
    const resolucaoRef = genResolucaoRef;
    const explicarRef = genExplicarRef;
    const docAbaRef = genDocAbaRef;
    const termosRef = genTermosRef;

    if (!projectId || centroOculto) {
      return () => {
        saldoRef.current += 1;
        situacaoRef.current += 1;
        repassesRef.current += 1;
        docsRef.current += 1;
        pendenciasRef.current += 1;
        resolucaoRef.current += 1;
        explicarRef.current += 1;
        docAbaRef.current += 1;
        termosRef.current += 1;
      };
    }

    carregarSaldo();
    carregarSituacao();
    carregarRepasses();
    carregarDocumentos();
    carregarPendencias();
    carregarTermos();

    return () => {
      saldoRef.current += 1;
      situacaoRef.current += 1;
      repassesRef.current += 1;
      docsRef.current += 1;
      pendenciasRef.current += 1;
      resolucaoRef.current += 1;
      explicarRef.current += 1;
      docAbaRef.current += 1;
      termosRef.current += 1;
    };
  }, [projectId, centroOculto, carregarSaldo, carregarSituacao, carregarRepasses, carregarDocumentos, carregarPendencias, carregarTermos]);

  const voltarProps = {
    rotulo: 'Projetos',
    href: '#/projetos',
    onClick: onNavegar
      ? (e) => {
          if (!ehCliqueNavegacaoSimples(e)) return;
          e.preventDefault();
          onNavegar('#/projetos');
        }
      : undefined,
  };

  const lidarMostrarEsteCentro = async () => {
    if (!onMostrarEsteCentro || mostrandoCentro) return;
    setMostrandoCentro(true);
    setErroMostrarCentro(null);
    try {
      const res = await onMostrarEsteCentro();
      if (montadoRef.current && res?.erro) {
        setErroMostrarCentro(res.erro);
      }
    } catch {
      if (montadoRef.current) {
        setErroMostrarCentro('Não foi possível reexibir este centro.');
      }
    } finally {
      if (montadoRef.current) {
        setMostrandoCentro(false);
      }
    }
  };

  if (centroOculto && !carregandoResumo) {
    const tituloOculto = centroOcultoInfo?.name
      ? (centroOcultoInfo.code ? `${centroOcultoInfo.name} · ${centroOcultoInfo.code}` : centroOcultoInfo.name)
      : 'Centro oculto';

    return (
      <div class="conteudo">
        <CabecalhoPagina voltar={voltarProps} titulo={tituloOculto} />
        {erroMostrarCentro && (
          <AvisoFalha mensagem={erroMostrarCentro} aoTentarNovamente={lidarMostrarEsteCentro} />
        )}
        <Vazio
          mensagem="Este centro está oculto pelo seu filtro de visão."
          rotuloBotao={onMostrarEsteCentro ? 'Mostrar este centro' : ''}
          aoClicar={onMostrarEsteCentro ? lidarMostrarEsteCentro : null}
        />
      </div>
    );
  }

  const docsDoCentro = docsSt.projectId === projectId ? docsSt : docsVazios(projectId);

  const nomeProjeto = resumoCentro?.name || saldoSt.dados?.project_name || 'Centro de custo';
  const codigoProjeto = resumoCentro?.code || '';
  const tituloPagina = codigoProjeto ? `${nomeProjeto} · ${codigoProjeto}` : nomeProjeto;
  const endDate = resumoCentro?.end_date || saldoSt.dados?.end_date || null;
  const meses = endDate ? mesesRestantes(endDate, hoje) : null;

  const abrirPainelContrato = () => {
    setPainelOrigem(null);
    setPainelContrato(true);
    setErroTermo(null);
    setConfirmacaoContrato(false);
  };

  const termosDados = termosSt.dados;
  const termosMapa =
    termosDados && termosDados.termos && typeof termosDados.termos === 'object' &&
    !Array.isArray(termosDados.termos)
      ? termosDados.termos
      : {};
  const termoFimContrato = termosMapa.vigencia_fim || null;
  const dataFimContrato = dataDoTermo(termoFimContrato?.valor);
  const dataInicioContrato = dataDoTermo(termosMapa.vigencia_inicio?.valor);
  const dataInicioCadastro = dataDoTermo(termosDados?.start_date_cadastro);
  const vigenciaConfere = termosDados ? termosDados.vigencia_confere : null;
  const inicioContratoMuda =
    Boolean(dataInicioContrato) && dataInicioContrato !== dataInicioCadastro;
  const vigenciaSituacao =
    termosDados?.vigencia_situacao ||
    (!dataFimContrato
      ? 'sem_contrato'
      : !endDate
        ? 'sem_cadastro'
        : vigenciaConfere === true
          ? 'confere'
          : 'diverge');
  const termosIndisponiveis = Boolean(termosSt.erro);

  const taxasContrato = ROTULOS_TAXA_CONTRATO
    .map(({ chave, rotulo }) => {
      const termo = termosMapa[chave];
      const milesimos = milesimosDePct(termo?.valor);
      return milesimos === null ? null : { chave, rotulo, milesimos };
    })
    .filter(Boolean);
  const somaTaxasMilesimos = taxasContrato.reduce((soma, t) => soma + t.milesimos, 0);
  const totalContratoMilesimos = milesimosDePct(termosMapa.taxa_total?.valor);
  const divisaoTaxasTexto =
    taxasContrato.length > 0
      ? `${textoPct(somaTaxasMilesimos)}% (${taxasContrato
          .map((t) => `${t.rotulo} ${textoPct(t.milesimos)}`)
          .join(' · ')})`
      : null;

  let textoTaxas = null;
  if (totalContratoMilesimos !== null && divisaoTaxasTexto) {
    textoTaxas = `Taxas do contrato: ${textoPct(totalContratoMilesimos)}% no total · por rubrica: ${divisaoTaxasTexto}`;
  } else if (totalContratoMilesimos !== null) {
    textoTaxas = `Taxas do contrato: ${textoPct(totalContratoMilesimos)}% no total`;
  } else if (divisaoTaxasTexto) {
    textoTaxas = `Taxas do contrato: ${divisaoTaxasTexto}`;
  }
  const contextoTaxas = textoTaxas ? (
    <button type="button" class="projeto__link-contrato" onClick={abrirPainelContrato}>
      {textoTaxas}
    </button>
  ) : null;

  const rotuloVigenciaDigitada = termosIndisponiveis ? (
    <span
      class="projeto__nota-discreta"
      title="Não foi possível carregar os termos do contrato"
    >
      —
    </span>
  ) : (
    <span class="projeto__nota-discreta">vigência digitada</span>
  );

  let contextoVigencia = null;
  if (dataFimContrato && vigenciaSituacao === 'sem_cadastro') {
    contextoVigencia = (
      <>
        Vigência do contrato:{' '}
        <button type="button" class="projeto__link-contrato" onClick={abrirPainelContrato}>
          {dataCompleta(dataFimContrato)}
        </button>{' '}
        · não está no cadastro
      </>
    );
  } else if (endDate) {
    const textoMeses =
      meses === null
        ? null
        : meses === 0
          ? 'vigência encerrada'
          : meses === 1
            ? 'falta 1 mês'
            : `faltam ${meses} meses`;

    if (dataFimContrato && vigenciaSituacao === 'confere') {
      contextoVigencia = (
        <>
          Vigência até{' '}
          <button type="button" class="projeto__link-contrato" onClick={abrirPainelContrato}>
            {dataCompleta(dataFimContrato)}
          </button>
          {textoMeses ? ` · ${textoMeses}` : ''} ·{' '}
          <span class="projeto__selo-contrato">do contrato</span>
        </>
      );
    } else if (dataFimContrato && vigenciaSituacao === 'diverge') {
      contextoVigencia = (
        <>
          Vigência até <Valor valor={endDate} tipo="data-completa" />
          {textoMeses ? ` · ${textoMeses}` : ''} ·{' '}
          <span class="projeto__atencao-contrato">
            contrato diz{' '}
            <button type="button" class="projeto__link-contrato" onClick={abrirPainelContrato}>
              {dataCompleta(dataFimContrato)}
            </button>
          </span>
        </>
      );
    } else {
      contextoVigencia = (
        <>
          Vigência até <Valor valor={endDate} tipo="data-completa" />
          {textoMeses ? ` · ${textoMeses}` : ''} · {rotuloVigenciaDigitada}
        </>
      );
    }
  } else if (!carregandoResumo && !saldoSt.carregando) {
    contextoVigencia = (
      <>
        Vigência não informada · {rotuloVigenciaDigitada}
      </>
    );
  }

  const contextoPagina =
    contextoVigencia || contextoTaxas ? (
      <>
        {contextoVigencia}
        {contextoVigencia && contextoTaxas ? ' · ' : null}
        {contextoTaxas}
      </>
    ) : null;

  const driveUrl = isAdmin ? validarUrlDrive(resumoCentro?.drive_folder_url) : null;

  const hasPlano = saldoSt.dados ? saldoSt.dados.has_plano !== false : resumoCentro?.situacao !== 'sem plano';
  const hasBalancete = saldoSt.dados
    ? Boolean(saldoSt.dados.has_balancete)
    : resumoCentro?.situacao !== 'sem balancete';
  const defasagemMeses = saldoSt.dados?.balancete_defasagem_meses ?? null;
  const dataRef = resumoCentro?.data_referencia || saldoSt.dados?.data_referencia || null;
  const avisosRpc = Array.isArray(saldoSt.dados?.avisos)
    ? saldoSt.dados.avisos.filter((a) => typeof a === 'string' && a.trim())
    : [];

  const grupos = Array.isArray(saldoSt.dados?.grupos) ? saldoSt.dados.grupos : [];
  const rubricas = Array.isArray(saldoSt.dados?.rubricas) ? saldoSt.dados.rubricas : [];
  const semNumeros =
    resumoCentro?.situacao === 'sem números' ||
    (hasPlano &&
      hasBalancete &&
      !saldoSt.carregando &&
      !saldoSt.erro &&
      grupos.length === 0 &&
      numeroFinito(resumoCentro?.livre) === null);
  const podeAbrirOrigem =
    numeroFinito(resumoCentro?.livre) !== null &&
    !resumoCentro?.erro &&
    !erroResumo &&
    hasPlano &&
    hasBalancete &&
    grupos.length > 0 &&
    !semNumeros;

  const abrirPainelRaiz = () => {
    setPainelContrato(false);
    setPainelOrigem({ modo: 'raiz' });
    if (!explicarSt.consultado && !explicarSt.carregando) {
      carregarExplicar();
    }
  };

  const abrirPainelGrupo = (grupo) => {
    setPainelContrato(false);
    setPainelOrigem({ modo: 'grupo', grupo });
    if (!explicarSt.consultado && !explicarSt.carregando) {
      carregarExplicar();
    }
  };

  const marcarTermoConferido = async (termo) => {
    if (!termo?.id || salvandoTermoId) return;
    const idProjeto = projectId;
    setSalvandoTermoId(termo.id);
    setErroTermo(null);
    let res;
    try {
      res = await conferirTermoContrato(termo.id);
    } catch {
      res = { dados: null, erro: 'Não foi possível marcar o termo como conferido.' };
    }
    if (!montadoRef.current || projectIdRef.current !== idProjeto) return;
    setSalvandoTermoId(null);
    if (res?.erro) {
      setErroTermo(res.erro);
      return;
    }
    await carregarTermos();
  };

  const usarVigenciaContrato = async () => {
    if (usandoVigencia) return;
    const idProjeto = projectId;
    setUsandoVigencia(true);
    setErroTermo(null);
    let res;
    try {
      res = await usarVigenciaDoContrato(idProjeto);
    } catch {
      res = { dados: null, erro: 'Não foi possível usar a vigência do contrato.' };
    }
    if (!montadoRef.current || projectIdRef.current !== idProjeto) return;
    setUsandoVigencia(false);
    if (res?.erro) {
      setErroTermo(res.erro);
      return;
    }
    setConfirmacaoContrato(false);
    await carregarTermos();
    await carregarSaldo();
    await carregarSituacao();
    await carregarExplicar();
    if (onRecarregarResumo) {
      try {
        await onRecarregarResumo();
      } catch {
        // O aviso do resumo aparece no topo da página; o painel não fecha.
      }
    }
  };

  // Selo do topo: a RPC nova manda situação e motivos; sem ela, fica a
  // regra de hoje (resumo_projetos_v2).
  const situacaoDados = situacaoSt.dados;
  const situacaoTopo = situacaoDados?.situacao || resumoCentro?.situacao || 'sem dado';
  const motivosTopo = situacaoDados
    ? situacaoDados.motivos
    : (Array.isArray(resumoCentro?.motivos) ? resumoCentro.motivos : null);
  const temSituacaoTopo = Boolean(situacaoDados || resumoCentro);
  const motivosDoGrupo = (grupoCode) =>
    Array.isArray(motivosTopo)
      ? motivosTopo.filter((motivo) => motivo?.grupo_code === grupoCode)
      : [];

  // Destaque principal: sempre o `livre` do resumo (nunca recalculado).
  let valorPrincipal = (
    <Valor valor={null} motivoSemDado="sem dado" semOrigem="Sem valor disponível" />
  );
  let contextoPrincipal = 'sem dado';

  if (resumoCentro?.erro === 'falha_saldo_livre' || erroResumo) {
    valorPrincipal = (
      <Valor
        valor={null}
        motivoSemDado="Não foi possível calcular o saldo deste centro"
        semOrigem="Falha ao calcular saldo"
      />
    );
    contextoPrincipal = 'Não foi possível calcular o saldo deste centro';
  } else if (resumoCentro?.situacao === 'sem plano' || saldoSt.dados?.has_plano === false) {
    valorPrincipal = (
      <Valor valor={null} motivoSemDado="sem plano" semOrigem="Centro sem plano de trabalho ativo" />
    );
    contextoPrincipal = 'sem plano';
  } else if (resumoCentro?.situacao === 'sem balancete' || saldoSt.dados?.has_balancete === false) {
    valorPrincipal = (
      <Valor valor={null} motivoSemDado="sem balancete" semOrigem="Centro sem balancete importado" />
    );
    contextoPrincipal = 'sem balancete';
  } else if (semNumeros) {
    valorPrincipal = (
      <Valor
        valor={null}
        motivoSemDado="sem números"
        semOrigem="Centro sem números suficientes para calcular o saldo"
      />
    );
    contextoPrincipal = 'sem números';
  } else if (carregandoResumo && !resumoCentro) {
    valorPrincipal = (
      <Valor valor={null} motivoSemDado="consultando" semOrigem="Consultando saldo livre" />
    );
    contextoPrincipal = 'consultando';
  } else if (resumoCentro && numeroFinito(resumoCentro.livre) !== null) {
    valorPrincipal = podeAbrirOrigem ? (
      <Valor
        valor={resumoCentro.livre}
        centavos={false}
        problema={situacaoTopo === 'problema'}
        origem={{ resumo: 'Ver origem deste valor' }}
        onOrigem={abrirPainelRaiz}
      />
    ) : (
      <Valor
        valor={resumoCentro.livre}
        centavos={false}
        problema={situacaoTopo === 'problema'}
        semOrigem="Saldo livre sem detalhamento disponível"
      />
    );
    contextoPrincipal = dataRef ? `balancete de ${dataCompacta(dataRef)}` : 'balancete vigente';
  }

  const rotuloPrincipal = endDate
    ? `Livres para gastar até ${dataCompacta(endDate)}`
    : 'Livres para gastar';

  // Bolsas por mês (Correções #2, #3 e 2ª rodada itens 4 e 10).
  const temArrayBolsas = Boolean(saldoSt.dados && hasPlano && Array.isArray(saldoSt.dados.bolsas_ativas));
  const bolsasTodas = temArrayBolsas ? saldoSt.dados.bolsas_ativas : [];
  const bolsasVigentes = [];
  const bolsasEncerradas = [];
  const bolsasSemData = [];

  for (const bolsa of bolsasTodas) {
    const raw = typeof bolsa?.end_date === 'string' ? bolsa.end_date.slice(0, 10) : '';
    if (!DATA_ISO_RE.test(raw)) {
      bolsasSemData.push(bolsa);
    } else if (raw >= hoje) {
      bolsasVigentes.push(bolsa);
    } else {
      bolsasEncerradas.push(bolsa);
    }
  }

  let valorBolsas = (
    <Valor valor={null} motivoSemDado="sem dado" semOrigem="Soma das bolsas ativas desta tela" />
  );
  let contextoBolsas = 'sem dado';
  if (saldoSt.carregando) {
    valorBolsas = (
      <Valor valor={null} motivoSemDado="consultando" semOrigem="Consultando bolsas ativas" />
    );
    contextoBolsas = 'consultando';
  } else if (saldoSt.erro) {
    valorBolsas = (
      <Valor valor={null} motivoSemDado={saldoSt.erro} semOrigem="Falha ao consultar bolsas ativas" />
    );
    contextoBolsas = 'indisponível';
  } else if (!hasPlano || !temArrayBolsas) {
    valorBolsas = (
      <Valor valor={null} motivoSemDado="sem plano" semOrigem="Centro sem plano de trabalho ativo" />
    );
    contextoBolsas = 'sem plano';
  } else {
    let somaBolsasMes = 0;
    let valorIncompleto = false;
    for (const b of bolsasVigentes) {
      const mensal = numeroFinito(b?.valor_mensal);
      if (mensal === null) {
        valorIncompleto = true;
        break;
      }
      somaBolsasMes += mensal;
    }

    if (valorIncompleto) {
      valorBolsas = (
        <Valor
          valor={null}
          motivoSemDado="Há bolsa ativa sem valor mensal válido"
          semOrigem="Soma das bolsas ativas desta tela"
        />
      );
      contextoBolsas = 'valor incompleto';
    } else {
      valorBolsas = (
        <Valor
          valor={somaBolsasMes}
          centavos={false}
          semOrigem="Soma das bolsas ativas desta tela"
        />
      );
      if (bolsasVigentes.length === 0) {
        contextoBolsas = 'nenhum bolsista ativo';
      } else if (bolsasVigentes.length === 1) {
        contextoBolsas = '1 bolsista ativo';
      } else {
        contextoBolsas = `${bolsasVigentes.length} bolsistas ativos`;
      }
    }
  }

  // Repasses (Correção #4 e 2ª rodada itens 4 e 9).
  const resumoRep = repassesSt.carregando
    ? {
        valor: (
          <Valor valor={null} motivoSemDado="consultando" semOrigem="Parcelas do cronograma" />
        ),
        contexto: 'consultando',
      }
    : repassesSt.erro
      ? {
          valor: (
            <Valor valor={null} motivoSemDado={repassesSt.erro} semOrigem="Parcelas do cronograma" />
          ),
          contexto: 'indisponível',
        }
      : resumirRepasses(repassesSt.dados, hasPlano, hoje);

  // Pendências do centro.
  const listaPendencias = [...(pendenciasSt.dados || [])].sort((a, b) => {
    if (a.situacao === 'aberta' && b.situacao !== 'aberta') return -1;
    if (a.situacao !== 'aberta' && b.situacao === 'aberta') return 1;
    return String(b.criada_em || '').localeCompare(String(a.criada_em || ''));
  });
  const pendenciasAbertas = listaPendencias.filter((p) => p.situacao === 'aberta').length;

  let valorPendencias = String(pendenciasAbertas);
  let contextoPendencias = pendenciasAbertas === 0
    ? 'nenhuma aberta'
    : pendenciasAbertas === 1
      ? '1 aberta neste centro'
      : `${pendenciasAbertas} abertas neste centro`;

  if (pendenciasSt.carregando) {
    valorPendencias = (
      <Valor valor={null} motivoSemDado="consultando" semOrigem="Contagem de pendências" />
    );
    contextoPendencias = 'consultando';
  } else if (pendenciasSt.erro) {
    valorPendencias = (
      <Valor valor={null} motivoSemDado={pendenciasSt.erro} semOrigem="Contagem de pendências" />
    );
    contextoPendencias = 'indisponível';
  }

  const selecionarAba = (novaAba) => {
    setAbaAtiva(novaAba);
    if (onNavegar && projectId) {
      onNavegar(urlProjeto(projectId, novaAba));
    }
  };

  const irParaDocumentos = () => {
    if (abaAtivaRef.current === 'documentos') {
      docsBlocoRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    rolarParaDocumentosRef.current = true;
    selecionarAba('documentos');
  };

  const confirmarResolucao = async (item, situacao) => {
    const idProjeto = projectId;
    const gen = ++genResolucaoRef.current;
    setSalvandoPendenciaId(item.id);
    setErroResolucao(null);
    const res = await resolverPendencia(item.id, situacao);
    if (!montadoRef.current || projectIdRef.current !== idProjeto || gen !== genResolucaoRef.current) {
      return;
    }
    setSalvandoPendenciaId(null);

    if (res.erro) {
      setErroResolucao(res.erro);
      return;
    }

    setConfirmacao(null);
    await carregarPendencias();
    if (montadoRef.current && projectIdRef.current === idProjeto && gen === genResolucaoRef.current) {
      onMudarPendencias?.();
    }
  };

  const {
    soma: somaGrupos,
    somaCentavos: somaGruposCentavos,
    invalida: somaGruposInvalida,
  } = somarGrupos(grupos);
  const livreResumoNum = numeroFinito(resumoCentro?.livre);
  const livreResumoCentavos =
    livreResumoNum !== null ? Math.round(livreResumoNum * 100) : null;
  const divergeDoResumo =
    grupos.length > 0 &&
    (somaGruposInvalida ||
      (livreResumoCentavos !== null && somaGruposCentavos !== livreResumoCentavos));

  const carregandoDocumentos =
    docsDoCentro.carregandoBalancetes || docsDoCentro.carregandoPlanos;
  const temErroDocs = Boolean(docsDoCentro.erroBalancetes || docsDoCentro.erroPlanos);
  const documentosUnificados = [
    ...docsDoCentro.balancetes.map((b, idx) => ({
      id: `bal-${b.id ?? idx}`,
      registroId: b.id ?? null,
      tipo: 'Balancete',
      nome: b.arquivo_nome || `Balancete de ${dataCompacta(b.data_referencia)}`,
      data: b.data_referencia || null,
      valor: numeroFinito(b.saldo_disponivel),
      ref: b.id
        ? { alvo_tabela: 'balancetes', alvo_id: b.id, campo: 'saldo_disponivel' }
        : null,
    })),
    ...docsDoCentro.planos.map((p, idx) => ({
      id: `pl-${p.id ?? idx}`,
      registroId: p.id ?? null,
      tipo: p.ativo ? 'Plano de trabalho (ativo)' : 'Plano de trabalho',
      nome: p.arquivo_nome || p.titulo || `Versão ${p.versao || ''}`.trim(),
      data: p.data_documento || (p.created_at ? String(p.created_at).slice(0, 10) : null),
      valor: numeroFinito(p.valor_total_plano),
      ref: p.id
        ? { alvo_tabela: 'planos_trabalho', alvo_id: p.id, campo: 'valor_total_plano' }
        : null,
    })),
  ].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

  const abrirDocumentoDoTermo = (termo) => {
    const documento = termo?.documento;
    if (!documento || !documento.bucket || !documento.caminho) return;
    setDocAbaSt({
      carregandoId: null,
      erro: null,
      nota: null,
      refPendente: null,
      doc: {
        titulo: termo.documento_nome || documento.arquivo_nome || 'Documento do contrato',
        documento,
        tipoOrigem: 'documento',
        fato: null,
        busca: null,
        nota: null,
        valor: null,
        parte: termo.documento_nome || '',
      },
    });
  };

  const abrirDocumentoDaAba = async (docItem) => {
    if (!docItem?.ref) {
      setDocAbaSt({
        carregandoId: null,
        erro: null,
        nota: 'Este documento não possui registro de origem disponível.',
        refPendente: null,
        doc: null,
      });
      irParaDocumentos();
      return;
    }
    const idProjeto = projectId;
    const gen = ++genDocAbaRef.current;
    setDocAbaSt({
      carregandoId: docItem.id,
      erro: null,
      nota: null,
      refPendente: docItem,
      doc: null,
    });

    let res;
    try {
      res = await origem(docItem.ref);
    } catch {
      res = { dados: null, erro: 'Não foi possível consultar o documento.' };
    }
    if (!montadoRef.current || projectIdRef.current !== idProjeto || gen !== genDocAbaRef.current) {
      return;
    }

    if (res?.erro || !res?.dados) {
      setDocAbaSt({
        carregandoId: null,
        erro: res?.erro || 'Não foi possível consultar o documento.',
        nota: null,
        refPendente: docItem,
        doc: null,
      });
      irParaDocumentos();
      return;
    }

    if (!res.dados.documento) {
      setDocAbaSt({
        carregandoId: null,
        erro: null,
        nota: res.dados.nota || 'Este documento não possui arquivo disponível para visualização.',
        refPendente: null,
        doc: null,
      });
      irParaDocumentos();
      return;
    }

    setDocAbaSt({
      carregandoId: null,
      erro: null,
      nota: null,
      refPendente: null,
      doc: {
        titulo: res.dados.documento.titulo || docItem.nome,
        documento: res.dados.documento,
        tipoOrigem: res.dados.tipo,
        fato: res.dados.fato,
        busca: res.dados.busca,
        nota: res.dados.nota,
        valor: res.dados.valor ?? docItem.valor,
        parte: docItem.nome,
      },
    });
  };

  // Destaque "Dinheiro em conta" (F2-H): o saldo_disponivel do balancete mais
  // recente, sem recálculo. O rendimento_liquido é só contexto: ele já está
  // dentro do saldo (rodapé da FUNAPE), então nunca é somado de novo.
  // O topo mostra reais inteiros (como o destaque principal); o rendimento
  // no contexto mantém os centavos.
  const balanceteDinheiro = balanceteMaisRecente(docsDoCentro.balancetes);
  const saldoDinheiro = numeroFinito(balanceteDinheiro?.saldo_disponivel);
  const rendimentoDinheiro = numeroFinito(balanceteDinheiro?.rendimento_liquido);
  const abrindoDocumentoDinheiro = Boolean(
    balanceteDinheiro?.id && docAbaSt.carregandoId === `bal-${balanceteDinheiro.id}`
  );

  let valorDinheiro = (
    <Valor valor={null} motivoSemDado="consultando" semOrigem="Consultando balancetes" />
  );
  let contextoDinheiro = 'consultando';

  if (!docsDoCentro.carregandoBalancetes) {
    if (docsDoCentro.erroBalancetes) {
      valorDinheiro = (
        <Valor
          valor={null}
          motivoSemDado={docsDoCentro.erroBalancetes}
          semOrigem="Falha ao consultar os balancetes"
        />
      );
      contextoDinheiro = 'indisponível';
    } else if (!balanceteDinheiro) {
      valorDinheiro = (
        <Valor
          valor={null}
          motivoSemDado="sem balancete"
          semOrigem="Centro sem balancete importado"
        />
      );
      contextoDinheiro = 'sem balancete';
    } else {
      const dataBalancete = dataCompleta(balanceteDinheiro.data_referencia);
      const podeAbrirOrigemDoBalancete = Boolean(balanceteDinheiro.id);
      const itemOrigemDoBalancete = (campo, valor) => ({
        // Mesmo id da linha da tabela de Documentos (bal-<id>), para o
        // carregamento aparecer também na linha.
        id: `bal-${balanceteDinheiro.id}`,
        nome:
          balanceteDinheiro.arquivo_nome ||
          `Balancete de ${dataCompleta(balanceteDinheiro.data_referencia)}`,
        valor,
        ref: {
          alvo_tabela: 'balancetes',
          alvo_id: balanceteDinheiro.id,
          campo,
        },
      });

      if (saldoDinheiro === null) {
        valorDinheiro = (
          <Valor
            valor={null}
            motivoSemDado="saldo não lido"
            semOrigem="Saldo não lido no balancete mais recente"
          />
        );
      } else {
        valorDinheiro = (
          <Valor
            valor={saldoDinheiro}
            centavos={false}
            problema={saldoDinheiro < 0}
            origem={{}}
            onOrigem={
              podeAbrirOrigemDoBalancete
                ? () =>
                    abrirDocumentoDaAba(
                      itemOrigemDoBalancete('saldo_disponivel', saldoDinheiro)
                    )
                : null
            }
            rotuloOrigem={`Ver origem do saldo em conta de ${dinheiro(saldoDinheiro, {
              centavos: false,
            })} no balancete de ${dataBalancete}`}
            ariaDescritoPor={AJUDA_DINHEIRO_CONTA_ID}
            ariaBusy={abrindoDocumentoDinheiro}
            semOrigem="Saldo em conta sem origem disponível"
          />
        );
      }

      const prefixoContexto = `balancete de ${dataBalancete} · `;
      if (rendimentoDinheiro === null) {
        contextoDinheiro = `${prefixoContexto}rendimento não lido`;
      } else if (rendimentoDinheiro === 0) {
        contextoDinheiro = `${prefixoContexto}sem rendimento`;
      } else {
        contextoDinheiro = (
          <>
            {prefixoContexto}inclui{' '}
            <Valor
              valor={rendimentoDinheiro}
              centavos
              origem={{}}
              onOrigem={
                podeAbrirOrigemDoBalancete
                  ? () =>
                      abrirDocumentoDaAba(
                        itemOrigemDoBalancete('rendimento_liquido', rendimentoDinheiro)
                      )
                  : null
              }
              rotuloOrigem="Ver origem do rendimento"
              ariaDescritoPor={AJUDA_RENDIMENTO_ID}
              ariaBusy={abrindoDocumentoDinheiro}
              semOrigem="Rendimento sem origem disponível"
            />{' '}
            de rendimento
          </>
        );
      }
    }
  }

  if (abrindoDocumentoDinheiro) {
    contextoDinheiro = 'abrindo documento…';
  }

  const colunasGrupos = [
    {
      chave: 'grupo_name',
      titulo: 'Rubrica',
      render: (g) => <span class="projeto__rubrica">{g.grupo_name}</span>,
    },
    {
      chave: 'previsto',
      titulo: 'Previsto (R$)',
      alinhamento: 'direita',
      render: (g) => (
        <Valor
          valor={g.previsto}
          centavos={false}
          semPrefixo
          alinhadoDireita
          semOrigem="Previsto do grupo no plano ativo (clique na linha para ver a origem)"
        />
      ),
    },
    {
      chave: 'realizado',
      titulo: 'Realizado (R$)',
      alinhamento: 'direita',
      render: (g) => (
        <Valor
          valor={hasBalancete ? g.realizado : null}
          centavos={false}
          semPrefixo
          alinhadoDireita
          motivoSemDado={hasBalancete ? 'sem dado' : 'sem balancete'}
          semOrigem="Realizado do grupo no balancete (clique na linha para ver a origem)"
        />
      ),
    },
    {
      chave: 'compromissos',
      titulo: 'Comprometido (R$)',
      alinhamento: 'direita',
      render: (g) => (
        <Valor
          valor={hasBalancete ? g.compromissos : null}
          centavos={false}
          semPrefixo
          alinhadoDireita
          motivoSemDado={hasBalancete ? 'sem dado' : 'sem balancete'}
          semOrigem="Compromissos do grupo (clique na linha para ver a origem)"
        />
      ),
    },
    {
      chave: 'saldo_livre',
      titulo: 'Livre (R$)',
      alinhamento: 'direita',
      render: (g) => (
        <Valor
          valor={hasBalancete ? g.saldo_livre : null}
          centavos={false}
          semPrefixo
          problema={
            hasBalancete &&
            numeroFinito(g.saldo_livre) !== null &&
            Number(g.saldo_livre) < 0
          }
          alinhadoDireita
          motivoSemDado={hasBalancete ? 'sem dado' : 'sem balancete'}
          semOrigem="Saldo livre do grupo (clique na linha para ver a origem)"
        />
      ),
    },
    {
      chave: 'situacao',
      titulo: 'Situação',
      render: (g) => (
        <Situacao
          estado={situacaoGrupo(g, hasBalancete, defasagemMeses, motivosDoGrupo(g.grupo_code))}
          motivos={motivosDoGrupo(g.grupo_code)}
        />
      ),
    },
  ];

  const bolsasComData = [
    ...bolsasVigentes.map((b) => ({ ...b, _encerrada: false })),
    ...bolsasEncerradas.map((b) => ({ ...b, _encerrada: true })),
  ];

  const itensAbas = [
    {
      id: 'dinheiro',
      rotulo: 'Dinheiro',
      conteudo: saldoSt.carregando ? (
        <Esqueleto variante="tabela" linhas={4} rotulo="Carregando grupos de rubricas" />
      ) : saldoSt.erro ? (
        <AvisoFalha mensagem={saldoSt.erro} aoTentarNovamente={carregarSaldo} />
      ) : !hasPlano || grupos.length === 0 ? (
        <>
          {avisosRpc.map((aviso, idx) => (
            <AvisoFalha key={idx} mensagem={aviso} />
          ))}
          <Vazio mensagem="Este centro ainda não tem plano de trabalho ativo." />
        </>
      ) : (
        <>
          {avisosRpc.map((aviso, idx) => (
            <AvisoFalha key={idx} mensagem={aviso} />
          ))}
          <Tabela
            colunas={colunasGrupos}
            dados={grupos}
            chaveLinha={(g) => g.grupo_code}
            onClicarLinha={(g) => abrirPainelGrupo(g)}
            rotuloLinha={(g) => `Abrir detalhe de ${g.grupo_name}`}
            legenda="Execução por grupo de rubrica"
          />
        </>
      ),
    },
    {
      id: 'bolsas',
      rotulo: 'Bolsas',
      contagem: !saldoSt.carregando && temArrayBolsas ? bolsasTodas.length : null,
      conteudo: saldoSt.carregando ? (
        <Esqueleto variante="tabela" linhas={3} rotulo="Carregando bolsas" />
      ) : saldoSt.erro ? (
        <AvisoFalha mensagem={saldoSt.erro} aoTentarNovamente={carregarSaldo} />
      ) : !hasPlano || !temArrayBolsas ? (
        <Vazio mensagem="Sem plano de trabalho ativo para listar as bolsas deste centro." />
      ) : bolsasTodas.length === 0 ? (
        <Vazio mensagem="Nenhuma bolsa ativa neste centro." />
      ) : (
        <>
          {bolsasSemData.length > 0 && (
            <div class="projeto__subsecao-bolsas">
              <AvisoFalha mensagem="Há bolsas sem data de término informada; elas não entram no total mensal de bolsas ativas." />
              <h3 class="projeto__subtitulo-painel">Bolsas sem data de término</h3>
              <Tabela
                legenda="Bolsas sem data de término"
                chaveLinha={(b, idx) => b.scholarship_id ?? `sd-${idx}`}
                colunas={[
                  { chave: 'bolsista', titulo: 'Bolsista' },
                  {
                    chave: 'valor_mensal',
                    titulo: 'Valor por mês (R$)',
                    alinhamento: 'direita',
                    render: (b) => (
                      <Valor
                        valor={numeroFinito(b.valor_mensal)}
                        centavos={false}
                        semPrefixo
                        alinhadoDireita
                        motivoSemDado="sem valor"
                        semOrigem="Valor mensal no cadastro de bolsas"
                      />
                    ),
                  },
                  {
                    chave: 'end_date',
                    titulo: 'Até quando',
                    render: () => <Valor valor={null} tipo="data" motivoSemDado="sem data" />,
                  },
                ]}
                dados={bolsasSemData}
              />
            </div>
          )}

          {bolsasComData.length > 0 && (
            <Tabela
              legenda="Bolsas do centro"
              chaveLinha={(b, idx) => b.scholarship_id ?? idx}
              colunas={[
                { chave: 'bolsista', titulo: 'Bolsista' },
                {
                  chave: 'valor_mensal',
                  titulo: 'Valor por mês (R$)',
                  alinhamento: 'direita',
                  render: (b) => (
                    <Valor
                      valor={numeroFinito(b.valor_mensal)}
                      centavos={false}
                      semPrefixo
                      alinhadoDireita
                      motivoSemDado="sem valor"
                      semOrigem="Valor mensal no cadastro de bolsas"
                    />
                  ),
                },
                {
                  chave: 'end_date',
                  titulo: 'Até quando',
                  render: (b) =>
                    b._encerrada ? (
                      <span class="projeto__bolsa-encerrada">
                        encerrada em <Valor valor={b.end_date} tipo="data" />
                      </span>
                    ) : (
                      <Valor valor={b.end_date} tipo="data" />
                    ),
                },
              ]}
              dados={bolsasComData}
            />
          )}
        </>
      ),
    },
    {
      id: 'documentos',
      rotulo: 'Documentos',
      contagem: carregandoDocumentos
        ? null
        : temErroDocs
          ? '—'
          : documentosUnificados.length,
      conteudo: carregandoDocumentos ? (
        <Esqueleto variante="tabela" linhas={4} rotulo="Carregando documentos" />
      ) : docsDoCentro.erroBalancetes && docsDoCentro.erroPlanos ? (
        <AvisoFalha
          mensagem="Não foi possível carregar os documentos deste centro."
          aoTentarNovamente={carregarDocumentos}
        />
      ) : (
        <div class="projeto__docs-bloco" ref={docsBlocoRef}>
          {docsDoCentro.erroBalancetes && (
            <AvisoFalha
              mensagem={docsDoCentro.erroBalancetes}
              aoTentarNovamente={carregarDocumentos}
            />
          )}
          {docsDoCentro.erroPlanos && (
            <AvisoFalha mensagem={docsDoCentro.erroPlanos} aoTentarNovamente={carregarDocumentos} />
          )}
          {docAbaSt.erro && (
            <AvisoFalha
              mensagem={docAbaSt.erro}
              aoTentarNovamente={
                docAbaSt.refPendente ? () => abrirDocumentoDaAba(docAbaSt.refPendente) : null
              }
            />
          )}
          {docAbaSt.nota && (
            <p class="projeto__nota-discreta" role="status">
              {docAbaSt.nota}
            </p>
          )}
          {documentosUnificados.length > 0 ? (
            <Tabela
              legenda="Planos e balancetes do centro"
              colunas={[
                { chave: 'tipo', titulo: 'Tipo' },
                {
                  chave: 'nome',
                  titulo: 'Documento',
                  render: (d) =>
                    docAbaSt.carregandoId === d.id ? (
                      <span role="status">
                        {d.nome}{' '}
                        <span class="projeto__nota-discreta">· consultando…</span>
                      </span>
                    ) : (
                      d.nome
                    ),
                },
                {
                  chave: 'data',
                  titulo: 'Data',
                  render: (d) => <Valor valor={d.data} tipo="data-completa" />,
                },
              ]}
              dados={documentosUnificados}
              chaveCarregando={docAbaSt.carregandoId}
              onClicarLinha={abrirDocumentoDaAba}
              rotuloLinha={(d) => `Abrir ${d.tipo}: ${d.nome}`}
            />
          ) : !temErroDocs ? (
            <Vazio mensagem="Nenhum documento registrado neste centro." />
          ) : null}
        </div>
      ),
    },
    {
      id: 'pendencias',
      rotulo: 'Pendências',
      contagem: !pendenciasSt.carregando && !pendenciasSt.erro ? pendenciasAbertas : null,
      conteudo: pendenciasSt.carregando ? (
        <Esqueleto variante="linha" linhas={3} rotulo="Carregando pendências" />
      ) : pendenciasSt.erro ? (
        <AvisoFalha mensagem={pendenciasSt.erro} aoTentarNovamente={carregarPendencias} />
      ) : listaPendencias.length === 0 ? (
        <Vazio mensagem="Nenhuma pendência neste centro." />
      ) : (
        <div class="projeto__lista-pendencias">
          {listaPendencias.map((item) => {
            const emConfirmacao = confirmacao?.id === item.id;
            const aberta = item.situacao === 'aberta';
            const tipoTexto = ROTULOS_TIPO_PENDENCIA[item.tipo] || 'Outro';
            const origemTexto = ROTULOS_ORIGEM[item.origem] || item.origem;
            const meta = [tipoTexto, origemTexto, tempoRelativo(item.criada_em)]
              .filter(Boolean)
              .join(' · ');
            const detalhes = resumirDetalhePendencia(item.detalhe);

            return (
              <Cartao
                key={item.id}
                titulo={item.titulo}
                subtitulo={meta}
                acao={
                  !aberta ? (
                    <span class="projeto__pendencia-situacao">
                      {item.situacao === 'resolvida' ? 'Resolvida' : 'Descartada'}
                    </span>
                  ) : null
                }
              >
                {detalhes.length > 0 && (
                  <dl class="projeto__lista-definicao">
                    {detalhes.map((par) => (
                      <div key={par.rotulo} class="projeto__par">
                        <dt>{par.rotulo}</dt>
                        <dd>{par.valor}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {aberta && !emConfirmacao && (
                  <div class="projeto__pendencia-acoes">
                    <Botao
                      variante="secundario"
                      tamanho="compacto"
                      onClick={() => {
                        setErroResolucao(null);
                        setConfirmacao({ id: item.id, situacao: 'resolvida' });
                      }}
                    >
                      Resolvida
                    </Botao>
                    <Botao
                      variante="fantasma"
                      tamanho="compacto"
                      onClick={() => {
                        setErroResolucao(null);
                        setConfirmacao({ id: item.id, situacao: 'descartada' });
                      }}
                    >
                      Descartar
                    </Botao>
                  </div>
                )}

                {aberta && emConfirmacao && (
                  <div class="projeto__pendencia-confirmacao">
                    <p class="projeto__pendencia-pergunta">
                      {confirmacao.situacao === 'resolvida'
                        ? 'Confirmar que esta pendência foi resolvida?'
                        : 'Confirmar o descarte desta pendência?'}
                    </p>
                    {erroResolucao && <AvisoFalha mensagem={erroResolucao} />}
                    <div class="projeto__pendencia-acoes">
                      <Botao
                        variante="primario"
                        tamanho="compacto"
                        carregando={salvandoPendenciaId === item.id}
                        onClick={() => confirmarResolucao(item, confirmacao.situacao)}
                      >
                        Confirmar
                      </Botao>
                      <Botao
                        variante="fantasma"
                        tamanho="compacto"
                        desabilitado={salvandoPendenciaId === item.id}
                        onClick={() => {
                          setConfirmacao(null);
                          setErroResolucao(null);
                        }}
                      >
                        Cancelar
                      </Botao>
                    </div>
                  </div>
                )}
              </Cartao>
            );
          })}
        </div>
      ),
    },
  ];

  const termosContratoLista = Object.entries(termosMapa)
    .sort(
      ([a], [b]) =>
        posicaoTermoContrato(a) - posicaoTermoContrato(b) || a.localeCompare(b)
    )
    .map(([chave, termo]) => ({ chave, termo }));

  const renderTermoContrato = ({ chave, termo }) => {
    const rotulo = ROTULOS_TERMO_CONTRATO[chave] || chave;
    const conferidoTexto = termo.conferido_em
      ? ` · conferido em ${dataCompleta(termo.conferido_em)}`
      : termo.conferido
        ? ' · conferido'
        : '';
    const registroTexto = `Registrado por ${termo.autor}${termo.origem === 'ia' ? ' (IA)' : ''} em ${dataCompleta(termo.criado_em)}${conferidoTexto}`;
    const url = validarUrlDocumentoContrato(termo.documento_url);
    const emConfirmacao = confirmacaoContrato && chave === 'vigencia_fim';

    return (
      <Cartao key={chave} titulo={rotulo} subtitulo={valorDoTermoContrato(chave, termo)}>
        {termo.regra && (
          <p class="texto-corrido">
            <strong>Como foi obtido:</strong> {termo.regra}
          </p>
        )}

        <blockquote class="projeto__trecho-contrato">{termo.trecho}</blockquote>

        <div class="projeto__documento-contrato">
          <span>{termo.documento_nome}</span>
          <span class="projeto__documento-contrato-acoes">
            {url && (
              <a
                class="projeto__link-documento"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir no Drive
                <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
              </a>
            )}
            {termo.documento_id && termo.documento?.bucket && termo.documento?.caminho ? (
              <button
                type="button"
                class="projeto__link-documento"
                onClick={() => abrirDocumentoDoTermo(termo)}
              >
                {termo.documento?.tipo === 'plano' ? 'Abrir o plano' : 'Abrir o documento'}
              </button>
            ) : null}
            {termo.pagina ? <span class="projeto__nota-discreta">p. {termo.pagina}</span> : null}
          </span>
        </div>

        <p class="projeto__nota-discreta">{registroTexto}</p>

        {isAdmin && termo.nota ? (
          <div class="projeto__nota-contrato">
            <h3 class="projeto__subtitulo-painel">Análise de quem registrou</h3>
            <p class="texto-corrido">{termo.nota}</p>
          </div>
        ) : null}

        {isAdmin && (
          <div class="projeto__acoes-contrato">
            {!termo.conferido && (
              <Botao
                variante="secundario"
                tamanho="compacto"
                carregando={salvandoTermoId === termo.id}
                onClick={() => marcarTermoConferido(termo)}
              >
                Marcar como conferido
              </Botao>
            )}
            {chave === 'vigencia_fim' &&
              (vigenciaSituacao === 'diverge' || vigenciaSituacao === 'sem_cadastro') &&
              !emConfirmacao && (
                <Botao
                  variante="secundario"
                  tamanho="compacto"
                  onClick={() => {
                    setErroTermo(null);
                    setConfirmacaoContrato(true);
                  }}
                >
                  Usar a data do contrato
                </Botao>
              )}
          </div>
        )}

        {isAdmin && emConfirmacao && (
          <div class="projeto__confirmacao-contrato">
            <p class="projeto__pendencia-pergunta">
              Usar a data do contrato?{' '}
              {inicioContratoMuda ? (
                <>
                  Início:{' '}
                  <strong>{dataInicioCadastro ? dataCompleta(dataInicioCadastro) : 'sem data'}</strong>
                  {' → '}
                  <strong>{dataCompleta(dataInicioContrato)}</strong>.{' '}
                </>
              ) : null}
              Fim:{' '}
              <strong>{endDate ? dataCompleta(endDate) : 'sem data'}</strong>
              {' → '}
              <strong>{dataCompleta(termo.valor)}</strong>.
            </p>
            <div class="projeto__acoes-contrato">
              <Botao
                variante="primario"
                tamanho="compacto"
                carregando={usandoVigencia}
                onClick={usarVigenciaContrato}
              >
                Usar a data do contrato
              </Botao>
              <Botao
                variante="fantasma"
                tamanho="compacto"
                onClick={() => setConfirmacaoContrato(false)}
              >
                Cancelar
              </Botao>
            </div>
          </div>
        )}
      </Cartao>
    );
  };

  const renderPainelContrato = () => {
    if (termosSt.carregando && !termosSt.dados) {
      return <Esqueleto variante="linha" linhas={4} rotulo="Carregando termos do contrato" />;
    }
    if (termosSt.erro) {
      return <AvisoFalha mensagem={termosSt.erro} aoTentarNovamente={carregarTermos} />;
    }
    if (termosContratoLista.length === 0) {
      return <Vazio mensagem="Nenhum termo do contrato registrado para este centro." />;
    }
    return (
      <div class="projeto__termos-contrato">
        {erroTermo && <AvisoFalha mensagem={erroTermo} />}
        {termosContratoLista.map(renderTermoContrato)}
      </div>
    );
  };

  const grupoPainel = painelOrigem?.modo === 'grupo' ? painelOrigem.grupo : null;
  const rubricasGrupo = grupoPainel
    ? rubricas.filter((r) => r.grupo_code === grupoPainel.grupo_code)
    : [];
  const noGrupoArvore =
    grupoPainel && Array.isArray(explicarSt.dados?.partes)
      ? explicarSt.dados.partes.find(
          (p) => p && typeof p === 'object' && p.chave === `grupo:${grupoPainel.grupo_code}`
        ) || null
      : null;

  const renderPainelGruposFallback = () => (
    <>
      <Destaque
        rotulo={rotuloPrincipal}
        valor={
          <Valor
            valor={livreResumoNum}
            centavos
            semOrigem="Total do resumo (composição reserva por grupo)"
          />
        }
        contexto={dataRef ? `balancete de ${dataCompacta(dataRef)}` : 'soma dos grupos abaixo'}
      />

      {divergeDoResumo && (
        <AvisoFalha
          mensagem={
            somaGruposInvalida
              ? 'Não foi possível somar as partes porque há grupo sem valor válido.'
              : `A soma dos grupos (${dinheiro(somaGrupos, { centavos: true })}) difere do valor exibido (${dinheiro(livreResumoNum, { centavos: true })}).`
          }
        />
      )}

      <dl class="projeto__lista-definicao">
        {grupos.map((g) => (
          <div key={g.grupo_code} class="projeto__par-conta">
            <div class="projeto__par">
              <dt>
                {g.grupo_name} <span class="projeto__codigo-discreto">({g.grupo_code})</span>
              </dt>
              <dd>
                <Valor
                  valor={numeroFinito(g.saldo_livre)}
                  centavos
                  problema={numeroFinito(g.saldo_livre) !== null && Number(g.saldo_livre) < 0}
                  motivoSemDado="valor indisponível"
                  semOrigem="Saldo livre do grupo na composição reserva"
                />
              </dd>
            </div>
            <span class="projeto__formula">
              Previsto{' '}
              <Valor
                valor={numeroFinito(g.previsto)}
                centavos
                motivoSemDado="sem dado"
                semOrigem="Previsto do grupo na composição reserva"
              />{' '}
              − Realizado{' '}
              <Valor
                valor={numeroFinito(g.realizado)}
                centavos
                motivoSemDado="sem dado"
                semOrigem="Realizado do grupo na composição reserva"
              />{' '}
              − Comprometido{' '}
              <Valor
                valor={numeroFinito(g.compromissos)}
                centavos
                motivoSemDado="sem dado"
                semOrigem="Comprometido do grupo na composição reserva"
              />
            </span>
          </div>
        ))}
      </dl>

      <div class="projeto__par projeto__par--total">
        <span>Soma das partes</span>
        <Valor
          valor={somaGruposInvalida ? null : somaGrupos}
          centavos
          motivoSemDado="Há grupo sem valor válido"
          semOrigem="Soma dos grupos desta tela"
        />
      </div>
    </>
  );

  const renderPainelGrupoDetalheFallback = (grupo) => (
    <>
      <dl class="projeto__lista-definicao">
        <div class="projeto__par">
          <dt>Previsto</dt>
          <dd>
            <Valor
              valor={grupo.previsto}
              centavos
              semOrigem="Previsto do grupo na composição reserva"
            />
          </dd>
        </div>
        <div class="projeto__par">
          <dt>Realizado</dt>
          <dd>
            <Valor
              valor={hasBalancete ? grupo.realizado : null}
              centavos
              motivoSemDado={hasBalancete ? 'sem dado' : 'sem balancete'}
              semOrigem="Realizado do grupo na composição reserva"
            />
          </dd>
        </div>
        <div class="projeto__par">
          <dt>Comprometido</dt>
          <dd>
            <Valor
              valor={hasBalancete ? grupo.compromissos : null}
              centavos
              motivoSemDado={hasBalancete ? 'sem dado' : 'sem balancete'}
              semOrigem="Comprometido do grupo na composição reserva"
            />
          </dd>
        </div>
        <div class="projeto__par">
          <dt>Livre</dt>
          <dd>
            <Valor
              valor={hasBalancete ? grupo.saldo_livre : null}
              centavos
              problema={
                hasBalancete &&
                numeroFinito(grupo.saldo_livre) !== null &&
                Number(grupo.saldo_livre) < 0
              }
              motivoSemDado={hasBalancete ? 'sem dado' : 'sem balancete'}
              semOrigem="Saldo livre do grupo na composição reserva"
            />
          </dd>
        </div>
      </dl>

      <p class="texto-corrido projeto__cobertura">
        {grupo.compromissos_cobertura === 'bolsas'
          ? 'Compromissos de bolsas incluídos até o fim da vigência.'
          : grupo.compromissos_cobertura === 'taxas'
            ? Number(grupo.compromissos) > 0
              ? 'Taxas da fundação e da universidade ainda a reter contam como comprometidas: não são dinheiro livre.'
              : 'Taxa da fundação e da universidade já cobrada; o que passou do previsto sai do livre.'
            : grupo.compromissos_cobertura === 'bolsas e taxas'
              ? 'Compromissos de bolsas e taxas da fundação e da universidade ainda a reter contam como comprometidos.'
              : 'Nenhum compromisso futuro descontado neste grupo além do já realizado.'}
      </p>

      {rubricasGrupo.length > 0 && (
        <div class="projeto__subrubricas">
          <h3 class="projeto__subtitulo-painel">Rubricas deste grupo</h3>
          <dl class="projeto__lista-definicao">
            {rubricasGrupo.map((r) => (
              <div key={r.rubrica_code} class="projeto__par-conta">
                <div class="projeto__par">
                  <dt>
                    {r.rubrica_name}{' '}
                    <span class="projeto__codigo-discreto">({r.rubrica_code})</span>
                  </dt>
                  <dd>
                    <Valor
                      valor={hasBalancete ? r.saldo_livre : null}
                      centavos
                      problema={
                        hasBalancete &&
                        numeroFinito(r.saldo_livre) !== null &&
                        Number(r.saldo_livre) < 0
                      }
                      motivoSemDado={hasBalancete ? 'sem dado' : 'sem balancete'}
                      semOrigem="Saldo livre da rubrica na composição reserva"
                    />
                  </dd>
                </div>
                <span class="projeto__formula">
                  Previsto{' '}
                  <Valor
                    valor={r.previsto}
                    centavos
                    semOrigem="Previsto da rubrica na composição reserva"
                  />{' '}
                  · Realizado{' '}
                  <Valor
                    valor={hasBalancete ? r.realizado : null}
                    centavos
                    motivoSemDado={hasBalancete ? 'sem dado' : 'sem balancete'}
                    semOrigem="Realizado da rubrica na composição reserva"
                  />{' '}
                  · Comprometido{' '}
                  <Valor
                    valor={hasBalancete ? r.compromissos : null}
                    centavos
                    motivoSemDado={hasBalancete ? 'sem dado' : 'sem balancete'}
                    semOrigem="Comprometido da rubrica na composição reserva"
                  />
                </span>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );

  const arvoreDados = explicarSt.dados;
  const arvoreRaizNula = Boolean(
    arvoreDados && (arvoreDados.valor === null || arvoreDados.valor === undefined)
  );
  const arvoreSemPartes = Boolean(
    arvoreDados && (!Array.isArray(arvoreDados.partes) || arvoreDados.partes.length === 0)
  );
  const arvoreSemDetalhesComResumo = (arvoreRaizNula || arvoreSemPartes) && livreResumoNum !== null;
  const motivoSemDetalhes = arvoreDados?.motivo
    ? `Sem árvore detalhada (${arvoreDados.motivo}); exibindo a composição por grupo.`
    : arvoreRaizNula
      ? 'A árvore detalhada veio sem valor; exibindo a composição por grupo.'
      : 'A árvore detalhada veio sem partes; exibindo a composição por grupo.';

  return (
    <div class="conteudo">
      <CabecalhoPagina
        voltar={voltarProps}
        titulo={tituloPagina}
        contexto={contextoPagina}
        acoes={
          <>
            {temSituacaoTopo && (
              <Situacao estado={situacaoTopo} motivos={motivosTopo} />
            )}
            {driveUrl ? (
              <Botao variante="secundario" icone={ExternalLink} href={driveUrl} externo>
                Pasta no Drive
              </Botao>
            ) : null}
          </>
        }
      />

      {erroResumo && (
        <AvisoFalha mensagem={erroResumo} aoTentarNovamente={onRecarregarResumo} />
      )}

      {docsDoCentro.erroBalancetes &&
        (abaAtiva !== 'documentos' || carregandoDocumentos) && (
          <AvisoFalha
            mensagem={docsDoCentro.erroBalancetes}
            aoTentarNovamente={carregarDocumentos}
          />
        )}

      <GradeDestaques className="grade-destaques--cinco">
        <Destaque
          principal
          rotulo={rotuloPrincipal}
          valor={valorPrincipal}
          contexto={contextoPrincipal}
        />
        <Destaque
          className="destaque--largo"
          rotulo="Dinheiro em conta"
          valor={valorDinheiro}
          contexto={contextoDinheiro}
          ajuda={AJUDA_DINHEIRO_CONTA}
          ajudasOcultas={[
            { id: AJUDA_DINHEIRO_CONTA_ID, texto: AJUDA_DINHEIRO_CONTA },
            { id: AJUDA_RENDIMENTO_ID, texto: AJUDA_RENDIMENTO },
          ]}
        />
        <Destaque
          rotulo="Bolsas por mês"
          valor={valorBolsas}
          contexto={contextoBolsas}
        />
        <Destaque
          rotulo="Repasses"
          valor={resumoRep.valor}
          contexto={resumoRep.contexto}
        />
        <Destaque
          rotulo="Pendências"
          valor={valorPendencias}
          contexto={contextoPendencias}
        />
      </GradeDestaques>

      <Cartao titulo="Detalhes do centro">
        <Abas
          itens={itensAbas}
          ativa={abaAtiva}
          aoSelecionar={selecionarAba}
          ariaLabel="Seções do centro de custo"
        />
      </Cartao>

      <PainelLateral
        aberto={Boolean(painelOrigem)}
        aoFechar={() => setPainelOrigem(null)}
        titulo={grupoPainel ? grupoPainel.grupo_name : 'De onde vem este valor'}
        subtitulo={grupoPainel ? `Código ${grupoPainel.grupo_code}` : tituloPagina}
      >
        {painelOrigem?.modo === 'raiz' && (
          explicarSt.carregando ? (
            <DeOndeVem carregando />
          ) : explicarSt.erro ? (
            <div class="projeto__painel-reserva">
              <AvisoFalha mensagem={explicarSt.erro} aoTentarNovamente={carregarExplicar} />
              {grupos.length > 0 && renderPainelGruposFallback()}
            </div>
          ) : arvoreSemDetalhesComResumo ? (
            <div class="projeto__painel-reserva">
              <p class="projeto__nota-discreta">{motivoSemDetalhes}</p>
              {grupos.length > 0 && renderPainelGruposFallback()}
            </div>
          ) : arvoreRaizNula ? (
            <Vazio
              mensagem={
                arvoreDados.motivo
                  ? `Sem dados para explicar: ${arvoreDados.motivo}.`
                  : 'Sem dados de origem.'
              }
            />
          ) : arvoreDados ? (
            <DeOndeVem arvore={arvoreDados} valorEsperado={livreResumoNum} />
          ) : null
        )}

        {painelOrigem?.modo === 'grupo' && grupoPainel && (
          explicarSt.carregando ? (
            <DeOndeVem carregando />
          ) : explicarSt.erro ? (
            <div class="projeto__painel-reserva">
              <AvisoFalha mensagem={explicarSt.erro} aoTentarNovamente={carregarExplicar} />
              {renderPainelGrupoDetalheFallback(grupoPainel)}
            </div>
          ) : noGrupoArvore ? (
            <DeOndeVem
              arvore={noGrupoArvore}
              valorEsperado={numeroFinito(grupoPainel.saldo_livre)}
            />
          ) : arvoreRaizNula ? (
            <div class="projeto__painel-reserva">
              <p class="projeto__nota-discreta">
                {arvoreDados.motivo
                  ? `Sem árvore detalhada (${arvoreDados.motivo}); exibindo a composição por rubrica.`
                  : 'Sem árvore detalhada; exibindo a composição por rubrica.'}
              </p>
              {renderPainelGrupoDetalheFallback(grupoPainel)}
            </div>
          ) : explicarSt.consultado ? (
            <div class="projeto__painel-reserva">
              <p class="projeto__nota-discreta">
                A árvore detalhada deste grupo não está disponível; exibindo a composição por rubrica.
              </p>
              {renderPainelGrupoDetalheFallback(grupoPainel)}
            </div>
          ) : null
        )}
      </PainelLateral>

      <PainelLateral
        aberto={painelContrato}
        aoFechar={() => setPainelContrato(false)}
        titulo="Do contrato"
        subtitulo={tituloPagina}
      >
        {renderPainelContrato()}
      </PainelLateral>

      <Documento
        aberto={Boolean(docAbaSt.doc)}
        aoFechar={() => setDocAbaSt((prev) => ({ ...prev, doc: null }))}
        titulo={docAbaSt.doc?.titulo || ''}
        documento={docAbaSt.doc?.documento || null}
        tipoOrigem={docAbaSt.doc?.tipoOrigem || 'documento'}
        fato={docAbaSt.doc?.fato || null}
        busca={docAbaSt.doc?.busca || null}
        nota={docAbaSt.doc?.nota || ''}
        valor={docAbaSt.doc?.valor ?? null}
        parte={docAbaSt.doc?.parte || ''}
      />
    </div>
  );
}
