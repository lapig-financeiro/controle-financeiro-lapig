import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Pencil } from 'lucide-preact';
import {
  AvisoFalha,
  Botao,
  CabecalhoPagina,
  Cartao,
  Chip,
  DeOndeVem,
  Documento,
  Esqueleto,
  ListaConversas,
  PainelLateral,
  Valor,
  Vazio,
} from '../componentes/index.js';
import {
  BlocoAnalise,
  TextoComSemOrigem,
  ValorAnalise,
  blocoValido,
  formatarValorAnalise,
  origemAbribel,
} from '../componentes/BlocoAnalise.jsx';
import {
  enviarFeedback as enviarFeedbackPadrao,
  executarAnalise as executarAnalisePadrao,
} from '../servicos/analise.js';
import {
  excluirConversa as excluirConversaPadrao,
  lerConversa as lerConversaPadrao,
  listarConversas as listarConversasPadrao,
  renomearConversa as renomearConversaPadrao,
} from '../servicos/analiseHistorico.js';
import {
  explicarLivre as carregarExplicacaoPadrao,
  origem as consultarOrigemPadrao,
  termosContrato as carregarTermosPadrao,
} from '../servicos/dados.js';
import { dataBrasilia, dataCurtaBrasilia, dataHoraBrasilia, mesmoDiaBrasilia } from '../util/conversas.js';
import { dataCompleta } from '../util/formato.js';
import './Analise.css';

const LIMITE_PERGUNTA = 2000;
const LIMITE_ANTERIORES = 2;
const CORTE_PERGUNTA_ANTERIOR = 500;
const CORTE_RESUMO_ANTERIOR = 1000;
const CORTE_BLOCOS_ANTERIOR = 600;
const LIMITE_COMENTARIO = 2000;
const CONTADOR_A_PARTIR_DE = 1800;
const CHAVE_NOVA = 'nova';
const TITULO_MAX = 120;

const SUGESTOES = [
  'Quanto o 30.109 tem livre hoje, e de onde vem?',
  'Quais centros estão em atenção ou problema, e por quê?',
  'Onde há folha atrasada hoje, e quanto?',
  'Quais bolsas terminam nos próximos 60 dias?',
];

const ROTULOS_TERMO_CONTRATO = {
  vigencia_inicio: 'Início da vigência',
  vigencia_fim: 'Fim da vigência',
  taxa_total: 'Taxa total do contrato',
  taxa_cip_ufg: 'Taxa CIP — UFG',
  taxa_cip_ua: 'Taxa CIP — unidade acadêmica',
  taxa_dao: 'Taxa DAO — fundação',
};

const CODIGOS_COM_RETENTATIVA = new Set(['modelo', 'tempo', 'interno', 'rede']);

function feedbackVazio() {
  return {
    modo: 'inicial',
    enviando: false,
    erro: null,
    enviado: false,
    comentario: '',
  };
}

function chaveDoPasso(passo) {
  return `${passo?.ferramenta || ''}|${passo?.rotulo || ''}`;
}

function aplicarPasso(passos, passo) {
  const chave = chaveDoPasso(passo);
  const indice = passos.findIndex((item) => item.chave === chave);
  const estado =
    passo?.estado === 'fim' || passo?.estado === 'erro' ? passo.estado : 'inicio';
  const novo = {
    chave,
    ferramenta: passo?.ferramenta || '',
    rotulo: passo?.rotulo || passo?.ferramenta || 'passo',
    estado,
    erro: estado === 'erro' ? passo?.erro || 'falhou' : '',
  };

  if (indice === -1) return [...passos, novo];
  const copia = passos.slice();
  copia[indice] = { ...copia[indice], ...novo };
  return copia;
}

function descerCaminho(raiz, caminho) {
  if (!Array.isArray(caminho)) return null;
  let atual = raiz;
  for (const indice of caminho) {
    if (!Number.isInteger(indice)) return null;
    const partes = atual?.partes;
    if (!Array.isArray(partes) || indice < 0 || indice >= partes.length) return null;
    atual = partes[indice];
    if (!atual || typeof atual !== 'object') return null;
  }
  return atual || null;
}

function acharTodosPorChave(no, chave, achados = []) {
  if (!chave || !no || typeof no !== 'object') return achados;
  if (no.chave === chave) achados.push(no);
  const partes = Array.isArray(no.partes) ? no.partes : [];
  for (const parte of partes) acharTodosPorChave(parte, chave, achados);
  return achados;
}

/**
 * A chave não é única (a 070 repete `linha:<id>` no compromisso e na folha
 * atrasada, contrato §3). Com uma só ocorrência, ela; com várias, só a que
 * tem o valor clicado, ao centavo; empate ou nenhuma → null (a tela mostra a
 * árvore inteira com a nota, em vez de um nó que pode ser o errado).
 */
function acharPorChave(raiz, chave, valorEsperado) {
  const achados = acharTodosPorChave(raiz, chave);
  if (achados.length === 1) return achados[0];
  if (achados.length === 0) return null;
  const esperado = Number(valorEsperado);
  if (!Number.isFinite(esperado)) return null;
  const centavos = Math.round(esperado * 100);
  const mesmos = achados.filter((no) => {
    const valor = Number(no?.valor);
    return Number.isFinite(valor) && Math.round(valor * 100) === centavos;
  });
  return mesmos.length === 1 ? mesmos[0] : null;
}

function textoSegundos(ms) {
  const segundos = Math.max(0, Math.round(Number(ms) / 1000));
  return `${segundos} s`;
}

function textoTempoDecorrido(segundos) {
  return `${Math.max(0, Math.round(Number(segundos) || 0))} s`;
}

function textoRodadas(rodadas) {
  if (!Number.isFinite(Number(rodadas))) return '';
  const total = Number(rodadas);
  return `${total} ${total === 1 ? 'rodada' : 'rodadas'}`;
}

function textoValorDoTermo(chave, termo) {
  if (String(chave).startsWith('vigencia_')) return dataCompleta(termo?.valor);
  const numero = Number(termo?.valor);
  if (!Number.isFinite(numero)) return '—';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(numero)}%`;
}

/**
 * Projeção pequena dos blocos número/tabela para o campo `blocos` dos
 * `anteriores` (≤ 600 caracteres): linhas "título: valor formatado".
 * É o que dá referente para "e se eu descontar aquele valor?".
 */
export function resumirBlocosParaAnteriores(blocos) {
  if (!Array.isArray(blocos)) return '';
  const linhas = [];
  for (const bloco of blocos) {
    if (!blocoValido(bloco)) continue;
    if (bloco.tipo === 'numero') {
      const numero = bloco.numero || {};
      const valor = formatarValorAnalise(numero.valor, numero.unidade);
      linhas.push(`${bloco.titulo || 'Número'}: ${valor}`);
      continue;
    }
    if (bloco.tipo === 'tabela') {
      const colunas = Array.isArray(bloco.tabela?.colunas) ? bloco.tabela.colunas : [];
      const linhasTabela = Array.isArray(bloco.tabela?.linhas) ? bloco.tabela.linhas : [];
      for (const linha of linhasTabela) {
        if (!Array.isArray(linha) || linha.length === 0) continue;
        const rotulo = formatarValorAnalise(linha[0]?.valor, 'texto');
        const valores = [];
        for (let indice = 1; indice < linha.length; indice += 1) {
          const celula = linha[indice];
          if (!celula || celula.valor === null || celula.valor === undefined) continue;
          const unidade = celula.unidade || colunas[indice]?.unidade || 'texto';
          const cabecalho = colunas[indice]?.rotulo || `coluna ${indice + 1}`;
          valores.push(`${cabecalho}: ${formatarValorAnalise(celula.valor, unidade)}`);
        }
        if (rotulo !== '—' && valores.length > 0) {
          linhas.push(`${bloco.titulo || 'Tabela'} — ${rotulo}: ${valores.join('; ')}`);
        }
      }
    }
  }
  return linhas.join('\n').slice(0, CORTE_BLOCOS_ANTERIOR);
}

/** O turno carregado do banco vira o mesmo formato do turno ao vivo, sem passos. */
export function mapearTurnoCarregado(turno, conversaId) {
  const resposta =
    turno?.resposta && typeof turno.resposta === 'object' ? turno.resposta : null;
  const texto =
    resposta?.texto && typeof resposta.texto === 'object' ? resposta.texto : null;
  const blocos = Array.isArray(resposta?.blocos) ? resposta.blocos : [];
  const calculado = String(turno?.desfecho_calculado || '');
  let status = 'ok';
  if (calculado === 'em_andamento') status = 'andamento';
  else if (calculado === 'cortada') status = 'cortada';
  else if (calculado && calculado !== 'ok') status = 'erro';
  if (!texto?.texto && blocos.length === 0) status = 'sem_resposta';

  return {
    id: `carregado-${turno.registro}`,
    carregado: true,
    registro: turno.registro,
    conversa: conversaId,
    ordem: turno.ordem,
    pergunta: turno.pergunta,
    passos: [],
    blocos: blocos.filter(blocoValido),
    blocoInvalido: blocos.some((bloco) => !blocoValido(bloco)),
    texto,
    fim:
      Number.isFinite(Number(turno.rodadas)) || Number.isFinite(Number(turno.ms))
        ? { rodadas: turno.rodadas, ms: turno.ms }
        : null,
    erro: null,
    status,
    segundos: 0,
    feedback: feedbackVazio(),
    feedbackSalvo: turno.feedback || null,
    recebeuInicio: true,
    salvo: true,
    iniciadaEm: turno.iniciada_em,
    terminadaEm: turno.terminada_em || null,
    desfecho: turno.desfecho,
    desfechoCalculado: turno.desfecho_calculado,
    anteriores: [],
  };
}

function turnoAoVivo({ id, pergunta, anteriores }) {
  return {
    id,
    carregado: false,
    registro: null,
    conversa: null,
    ordem: null,
    pergunta,
    anteriores,
    passos: [],
    blocos: [],
    blocoInvalido: false,
    texto: null,
    fim: null,
    erro: null,
    status: 'correndo',
    segundos: 0,
    feedback: feedbackVazio(),
    feedbackSalvo: null,
    recebeuInicio: false,
    salvo: false,
    iniciadaEm: new Date().toISOString(),
    terminadaEm: null,
    desfecho: null,
    desfechoCalculado: null,
  };
}

function notaDeOrigemDoTurno(turno, hoje = new Date()) {
  if (!turno?.carregado || !turno.terminadaEm) return null;
  if (mesmoDiaBrasilia(turno.terminadaEm, hoje)) return null;
  return `Este valor é de ${dataBrasilia(turno.terminadaEm)}; a origem abaixo é a de hoje.`;
}

/**
 * Tela `#/analise`: conversa contínua. A lista de conversas (075) fica na
 * coluna da esquerda a partir de 1024 px e no `PainelLateral` no celular.
 * As funções de serviço são props para os testes injetarem streams e RPCs
 * falsos sem rede.
 */
export function Analise({
  executarAnalise = executarAnalisePadrao,
  enviarFeedback = enviarFeedbackPadrao,
  carregarExplicacao = carregarExplicacaoPadrao,
  consultarOrigem = consultarOrigemPadrao,
  carregarTermos = carregarTermosPadrao,
  listarConversas = listarConversasPadrao,
  lerConversa = lerConversaPadrao,
  renomearConversa = renomearConversaPadrao,
  excluirConversa = excluirConversaPadrao,
  ativa = true,
  agora = () => new Date(),
} = {}) {
  const campoId = useId();
  const [rascunhos, setRascunhos] = useState({});
  const [turnosPorConversa, setTurnosPorConversa] = useState({ [CHAVE_NOVA]: [] });
  const [conversas, setConversas] = useState([]);
  const [listaSt, setListaSt] = useState({ carregando: true, erro: null });
  const [ativaChave, setAtivaChave] = useState(CHAVE_NOVA);
  const [carregandoConversa, setCarregandoConversa] = useState(null);
  const [erroConversa, setErroConversa] = useState(null);
  const [carregadas, setCarregadas] = useState({ [CHAVE_NOVA]: true });
  const [anterior, setAnterior] = useState(null);
  const [painelConversas, setPainelConversas] = useState(false);
  const [renomeando, setRenomeando] = useState(false);
  const [tituloRascunho, setTituloRascunho] = useState('');
  const [erroTitulo, setErroTitulo] = useState(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState(null);
  const [correndo, setCorrendo] = useState(null);
  const [painel, setPainel] = useState(null);
  const [voltarConta, setVoltarConta] = useState(null);
  const [documento, setDocumento] = useState(null);
  const [scrollSeq, setScrollSeq] = useState(0);

  const montadoRef = useRef(true);
  const sequenciaRef = useRef(0);
  const execucaoGenRef = useRef(0);
  const abortRef = useRef(null);
  const correndoRef = useRef(null);
  const timerRef = useRef(null);
  const painelGenRef = useRef(0);
  const campoRef = useRef(null);
  const fimListaRef = useRef(null);
  const agoraRef = useRef(agora);
  agoraRef.current = agora;

  const pergunta = rascunhos[ativaChave] || '';
  const turnosAtivos = turnosPorConversa[ativaChave] || [];
  const conversaAberta =
    ativaChave === CHAVE_NOVA
      ? null
      : conversas.find((item) => item.id === ativaChave) || null;
  const tituloAtivo =
    ativaChave === CHAVE_NOVA
      ? 'Nova conversa'
      : conversaAberta?.titulo ||
        (turnosAtivos[0]?.pergunta ? turnosAtivos[0].pergunta.slice(0, 80) : 'Conversa');

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      execucaoGenRef.current += 1;
      painelGenRef.current += 1;
      correndoRef.current = null;
      abortRef.current?.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // O App deixa a tela montada (escondida) quando se troca de aba do site;
  // ao sair, fecha painéis e documento. Rascunhos, conversas e análise em
  // curso seguem intactos.
  useEffect(() => {
    if (ativa) return;
    painelGenRef.current += 1;
    setPainel(null);
    setVoltarConta(null);
    setDocumento(null);
    setPainelConversas(false);
  }, [ativa]);

  useEffect(() => {
    if (!scrollSeq) return;
    fimListaRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [scrollSeq]);

  const atualizarTurno = (chave, id, atualizador) => {
    if (!montadoRef.current) return;
    setTurnosPorConversa((prev) => {
      const lista = prev[chave] || [];
      if (!lista.some((turno) => turno.id === id)) return prev;
      return {
        ...prev,
        [chave]: lista.map((turno) => (turno.id === id ? atualizador(turno) : turno)),
      };
    });
  };

  const atualizarTurnoAtual = (chaveRef, id, atualizador) => {
    atualizarTurno(chaveRef.current, id, atualizador);
  };

  const limparTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const parar = () => {
    const alvo = correndoRef.current;
    execucaoGenRef.current += 1;
    limparTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    correndoRef.current = null;
    setCorrendo(null);
    if (alvo?.id) {
      atualizarTurno(alvo.chave, alvo.id, (turno) => ({ ...turno, status: 'parada' }));
    }
  };

  async function recarregarLista() {
    const res = await listarConversas();
    if (!montadoRef.current) return;
    if (res.erro) {
      setListaSt({ carregando: false, erro: res.erro });
      return;
    }
    setConversas(Array.isArray(res.dados) ? res.dados : []);
    setListaSt({ carregando: false, erro: null });
  }

  async function abrirConversa(chave, { forcar = false } = {}) {
    if (!chave || chave === CHAVE_NOVA) {
      setAtivaChave(CHAVE_NOVA);
      setPainelConversas(false);
      return;
    }
    setAtivaChave(chave);
    setPainelConversas(false);
    setRenomeando(false);
    setConfirmandoExclusao(false);
    setErroTitulo(null);
    setErroExclusao(null);
    if (!forcar && carregadas[chave]) return;

    setCarregandoConversa(chave);
    setErroConversa(null);
    let resultado;
    try {
      resultado = await lerConversa(chave);
    } catch {
      resultado = { dados: null, erro: 'Não foi possível carregar esta conversa.' };
    }
    if (!montadoRef.current) return;
    setCarregandoConversa((atual) => (atual === chave ? null : atual));
    if (resultado?.erro || !resultado?.dados) {
      setErroConversa({
        chave,
        mensagem: resultado?.erro || 'Não foi possível carregar esta conversa.',
      });
      return;
    }

    const dados = resultado.dados;
    setTurnosPorConversa((prev) => ({
      ...prev,
      [chave]: (dados.turnos || [])
        .slice()
        .sort((a, b) => a.ordem - b.ordem)
        .map((turno) => mapearTurnoCarregado(turno, chave)),
    }));
    setCarregadas((prev) => ({ ...prev, [chave]: true }));
    setConversas((prev) => {
      const item = {
        id: chave,
        titulo: dados.titulo,
        criada_em: dados.criada_em,
        atualizada_em: dados.atualizada_em,
        turnos: Array.isArray(dados.turnos) ? dados.turnos.length : 0,
      };
      return prev.some((conversa) => conversa.id === chave)
        ? prev.map((conversa) => (conversa.id === chave ? { ...conversa, ...item } : conversa))
        : [item, ...prev];
    });
  }

  useEffect(() => {
    let ativo = true;
    (async () => {
      setListaSt({ carregando: true, erro: null });
      let resultado;
      try {
        resultado = await listarConversas();
      } catch {
        resultado = { dados: null, erro: 'Não foi possível carregar as conversas.' };
      }
      if (!ativo || !montadoRef.current) return;
      if (resultado.erro) {
        setListaSt({ carregando: false, erro: resultado.erro });
        return;
      }
      const lista = Array.isArray(resultado.dados) ? resultado.dados : [];
      setConversas(lista);
      setListaSt({ carregando: false, erro: null });

      const recente = lista[0];
      if (!recente) return;
      if (mesmoDiaBrasilia(recente.atualizada_em, agoraRef.current())) {
        await abrirConversa(recente.id, { forcar: true });
      } else {
        setAnterior(recente);
        setAtivaChave(CHAVE_NOVA);
      }
    })();
    return () => {
      ativo = false;
    };
    // `abrirConversa` é a função da primeira renderização; os serviços são props.
  }, [listarConversas, lerConversa]);

  const tentarLista = async () => {
    setListaSt({ carregando: true, erro: null });
    let resultado;
    try {
      resultado = await listarConversas();
    } catch {
      resultado = { dados: null, erro: 'Não foi possível carregar as conversas.' };
    }
    if (!montadoRef.current) return;
    if (resultado.erro) {
      setListaSt({ carregando: false, erro: resultado.erro });
      return;
    }
    const lista = Array.isArray(resultado.dados) ? resultado.dados : [];
    setConversas(lista);
    setListaSt({ carregando: false, erro: null });
    const recente = lista[0];
    if (recente && mesmoDiaBrasilia(recente.atualizada_em, agoraRef.current())) {
      await abrirConversa(recente.id, { forcar: true });
    } else if (recente) {
      setAnterior(recente);
      setAtivaChave(CHAVE_NOVA);
    }
  };

  const novaConversa = () => {
    setAtivaChave(CHAVE_NOVA);
    setTurnosPorConversa((prev) => {
      // A conversa nova ainda não tem id; limpa a área, menos quando há uma
      // análise em curso nela (ela continua e o resultado não pode sumir).
      if (correndoRef.current?.chave === CHAVE_NOVA) {
        return Array.isArray(prev[CHAVE_NOVA]) ? prev : { ...prev, [CHAVE_NOVA]: [] };
      }
      return { ...prev, [CHAVE_NOVA]: [] };
    });
    setCarregadas((prev) => ({ ...prev, [CHAVE_NOVA]: true }));
    setAnterior(null);
    setPainelConversas(false);
    setRenomeando(false);
    setConfirmandoExclusao(false);
    setErroTitulo(null);
    setErroExclusao(null);
    setErroConversa(null);
    setCarregandoConversa(null);
  };

  const rodarAnalise = async (turno, chaveInicial) => {
    const gen = ++execucaoGenRef.current;
    const inicioEm = Date.now();
    const controlador = new AbortController();
    const chaveRef = { current: chaveInicial };
    abortRef.current = controlador;
    correndoRef.current = { chave: chaveRef.current, id: turno.id };
    setCorrendo({ chave: chaveRef.current, id: turno.id });

    atualizarTurnoAtual(chaveRef, turno.id, (atual) => ({
      ...atual,
      status: 'correndo',
      passos: [],
      blocos: [],
      blocoInvalido: false,
      texto: null,
      fim: null,
      erro: null,
      registro: null,
      conversa: null,
      ordem: null,
      recebeuInicio: false,
      salvo: false,
      terminadaEm: null,
      segundos: 0,
      feedback: feedbackVazio(),
    }));

    limparTimer();
    timerRef.current = setInterval(() => {
      if (!montadoRef.current || execucaoGenRef.current !== gen) return;
      const segundos = Math.floor((Date.now() - inicioEm) / 1000);
      setTurnosPorConversa((prev) => {
        const lista = prev[chaveRef.current] || [];
        return {
          ...prev,
          [chaveRef.current]: lista.map((item) =>
            item.id === turno.id && item.status === 'correndo'
              ? { ...item, segundos }
              : item
          ),
        };
      });
    }, 1000);

    const atualizarSeAtual = (atualizador) => {
      if (!montadoRef.current || execucaoGenRef.current !== gen) return;
      atualizarTurnoAtual(chaveRef, turno.id, atualizador);
    };

    const aplicarInicio = (dados) => {
      if (!montadoRef.current || execucaoGenRef.current !== gen) return;
      const conversa = typeof dados?.conversa === 'string' ? dados.conversa : null;
      const registro = typeof dados?.registro === 'string' ? dados.registro : null;
      const ordem = Number.isInteger(dados?.ordem) ? dados.ordem : null;

      if (chaveRef.current === CHAVE_NOVA && conversa) {
        const destino = conversa;
        setTurnosPorConversa((prev) => ({
          ...prev,
          [destino]: (prev[CHAVE_NOVA] || []).map((item) =>
            item.id === turno.id
              ? {
                  ...item,
                  registro,
                  conversa: destino,
                  ordem,
                  recebeuInicio: true,
                  salvo: Boolean(registro),
                }
              : item
          ),
          [CHAVE_NOVA]: [],
        }));
        setRascunhos((prev) => {
          const copia = { ...prev };
          if (copia[CHAVE_NOVA] !== undefined) {
            copia[destino] = copia[CHAVE_NOVA];
            delete copia[CHAVE_NOVA];
          }
          return copia;
        });
        setCarregadas((prev) => ({ ...prev, [destino]: true }));
        chaveRef.current = destino;
        correndoRef.current = { chave: destino, id: turno.id };
        setCorrendo({ chave: destino, id: turno.id });
        setAtivaChave((atual) => (atual === CHAVE_NOVA ? destino : atual));
        setAnterior(null);
        void recarregarLista();
        return;
      }

      atualizarTurnoAtual(chaveRef, turno.id, (atual) => ({
        ...atual,
        registro,
        conversa,
        ordem,
        recebeuInicio: true,
        salvo: Boolean(registro),
      }));
    };

    let resultado;
    try {
      resultado = await executarAnalise({
        pergunta: turno.pergunta,
        anteriores: turno.anteriores || [],
        conversa: chaveRef.current === CHAVE_NOVA ? null : chaveRef.current,
        signal: controlador.signal,
        onInicio: aplicarInicio,
        onPasso: (dados) => {
          atualizarSeAtual((atual) => ({
            ...atual,
            passos: aplicarPasso(atual.passos, dados),
          }));
        },
        onBloco: (dados) => {
          atualizarSeAtual((atual) => {
            if (!blocoValido(dados)) {
              return { ...atual, blocoInvalido: true };
            }
            return { ...atual, blocos: [...atual.blocos, dados] };
          });
        },
        onTexto: (dados) => {
          atualizarSeAtual((atual) => ({ ...atual, texto: dados }));
        },
        onFim: (dados) => {
          atualizarSeAtual((atual) => ({ ...atual, fim: dados }));
        },
        onErro: (dados) => {
          atualizarSeAtual((atual) => ({ ...atual, erro: dados }));
        },
      });
    } catch {
      resultado = {
        ok: false,
        erro: { codigo: 'interno', mensagem: 'Não foi possível concluir a análise. Tente de novo.' },
        registro: null,
        blocos: [],
        texto: null,
      };
    }

    if (!montadoRef.current || execucaoGenRef.current !== gen) return;
    limparTimer();
    abortRef.current = null;
    correndoRef.current = null;
    setCorrendo(null);

    const segundos =
      resultado?.fim?.ms !== undefined
        ? Math.max(0, Math.round(Number(resultado.fim.ms) / 1000))
        : Math.floor((Date.now() - inicioEm) / 1000);

    atualizarTurnoAtual(chaveRef, turno.id, (atual) => {
      const blocos = Array.isArray(resultado?.blocos) ? resultado.blocos : atual.blocos;
      const validos = blocos.filter(blocoValido);
      let status = 'ok';
      if (resultado?.abortada) status = 'parada';
      else if (resultado?.interrompida) status = 'interrompida';
      else if (resultado?.erro) {
        status = resultado.erro?.codigo === 'incompleta' ? 'incompleta' : 'erro';
      }

      return {
        ...atual,
        registro: resultado?.registro ?? atual.registro,
        conversa: resultado?.conversa ?? atual.conversa,
        ordem: resultado?.ordem ?? atual.ordem,
        blocos: validos,
        blocoInvalido: atual.blocoInvalido || validos.length !== blocos.length,
        texto: resultado?.texto ?? atual.texto,
        fim: resultado?.fim ?? atual.fim,
        erro: resultado?.abortada ? null : resultado?.erro ?? atual.erro,
        status,
        segundos,
        terminadaEm: new Date().toISOString(),
      };
    });
  };

  const montarAnteriores = (lista) => {
    return lista
      .filter(
        (turno) =>
          turno.status === 'ok' &&
          typeof turno.texto?.texto === 'string' &&
          turno.texto.texto.trim() !== ''
      )
      .slice(-LIMITE_ANTERIORES)
      .map((turno) => {
        const blocos = resumirBlocosParaAnteriores(turno.blocos);
        return {
          pergunta: turno.pergunta.slice(0, CORTE_PERGUNTA_ANTERIOR),
          resumo: turno.texto.texto.slice(0, CORTE_RESUMO_ANTERIOR),
          ...(blocos ? { blocos } : {}),
        };
      });
  };

  const enviar = (textoForcado) => {
    if (correndoRef.current) return;
    if (ativaChave !== CHAVE_NOVA && !carregadas[ativaChave]) return;
    const textoBruto = typeof textoForcado === 'string' ? textoForcado : pergunta;
    const texto = String(textoBruto || '').trim();
    if (!texto || texto.length > LIMITE_PERGUNTA) return;

    const anteriores = montarAnteriores(turnosAtivos);
    const id = `analise-${++sequenciaRef.current}`;
    const nova = turnoAoVivo({ id, pergunta: texto, anteriores });

    setTurnosPorConversa((prev) => ({
      ...prev,
      [ativaChave]: [...(prev[ativaChave] || []), nova],
    }));
    setRascunhos((prev) => ({ ...prev, [ativaChave]: '' }));
    setScrollSeq((seq) => seq + 1);
    void rodarAnalise(nova, ativaChave);
  };

  const tentarDeNovo = (turno, chave) => {
    if (correndoRef.current) return;
    void rodarAnalise(turno, chave);
  };

  const registrarFeedback = (chave, id, campos) => {
    atualizarTurno(chave, id, (turno) => ({
      ...turno,
      feedback: { ...turno.feedback, ...campos },
    }));
  };

  const mandarFeedback = async (turno, chave, nota, comentario = null) => {
    if (!turno.registro || turno.feedback.enviando) return;
    registrarFeedback(chave, turno.id, { enviando: true, erro: null });

    let resultado;
    try {
      resultado = await enviarFeedback(turno.registro, { nota, comentario });
    } catch {
      resultado = { id: null, erro: 'Não foi possível enviar o feedback.' };
    }
    if (!montadoRef.current) return;

    if (resultado?.erro) {
      registrarFeedback(chave, turno.id, { enviando: false, erro: resultado.erro });
      return;
    }
    registrarFeedback(chave, turno.id, {
      enviando: false,
      erro: null,
      enviado: true,
      modo: 'inicial',
      comentario: '',
    });
  };

  const fecharPainel = () => {
    painelGenRef.current += 1;
    setPainel(null);
    setVoltarConta(null);
  };

  const voltarParaConta = () => {
    if (!voltarConta) return;
    painelGenRef.current += 1;
    setPainel(voltarConta);
    setVoltarConta(null);
  };

  const carregarLivre = async (origemEscolhida, gen, valorEsperado, conta = null, notaOrigem = null) => {
    let resultado;
    try {
      resultado = await carregarExplicacao(origemEscolhida.project_id);
    } catch {
      resultado = {
        dados: null,
        erro: 'Não foi possível carregar a origem do saldo livre.',
      };
    }
    if (!montadoRef.current || painelGenRef.current !== gen) return;

    if (resultado?.erro || !resultado?.dados) {
      setPainel({
        tipo: 'livre',
        titulo: 'De onde vem',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        notaOrigem,
        carregando: false,
        arvore: null,
        erro: resultado?.erro || 'Não foi possível carregar a origem do saldo livre.',
      });
      return;
    }

    const raiz = resultado.dados;
    let arvore = raiz;
    let nota = '';
    const temCaminho =
      origemEscolhida.caminho !== null && origemEscolhida.caminho !== undefined;

    if (temCaminho) {
      const descida = descerCaminho(raiz, origemEscolhida.caminho);
      if (descida) {
        arvore = descida;
      } else {
        const porChave = acharPorChave(raiz, origemEscolhida.chave, valorEsperado);
        if (porChave) {
          arvore = porChave;
        } else {
          nota = 'Não achei o item exato; mostrando a origem do livre do centro.';
        }
      }
    } else if (origemEscolhida.chave) {
      const porChave = acharPorChave(raiz, origemEscolhida.chave, valorEsperado);
      if (porChave) {
        arvore = porChave;
      } else {
        nota = 'Não achei o item exato; mostrando a origem do livre do centro.';
      }
    }

    setPainel({
      tipo: 'livre',
      titulo: 'De onde vem',
      origem: origemEscolhida,
      valorEsperado,
      conta,
      notaOrigem,
      carregando: false,
      erro: null,
      arvore,
      parteDe: arvore !== raiz ? raiz.rotulo || 'Livre' : '',
      nota,
    });
  };

  const carregarRef = async (origemEscolhida, gen, valorEsperado, conta = null, notaOrigem = null) => {
    let resultado;
    try {
      resultado = await consultarOrigem(origemEscolhida.ref);
    } catch {
      resultado = { dados: null, erro: 'Não foi possível consultar o documento.' };
    }
    if (!montadoRef.current || painelGenRef.current !== gen) return;

    if (resultado?.erro || !resultado?.dados) {
      setPainel({
        tipo: 'ref',
        titulo: 'De onde vem',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        notaOrigem,
        carregando: false,
        erro: resultado?.erro || 'Não foi possível consultar o documento.',
      });
      return;
    }

    const dados = resultado.dados;
    if (!dados.documento) {
      setPainel({
        tipo: 'nota',
        titulo: 'De onde vem',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        notaOrigem,
        nota:
          dados.nota ||
          'Este documento não possui arquivo disponível para visualização.',
      });
      return;
    }

    setPainel(null);
    setDocumento({
      titulo: dados.documento.titulo || origemEscolhida.nome || 'Documento de origem',
      documento: dados.documento,
      tipoOrigem: dados.tipo || 'documento',
      fato: dados.fato || null,
      busca: dados.busca || null,
      nota: [notaOrigem, dados.nota].filter(Boolean).join(' '),
      valor: dados.valor ?? valorEsperado,
      parte: origemEscolhida.nome || '',
    });
  };

  const carregarTermo = async (origemEscolhida, gen, valorEsperado, conta = null, notaOrigem = null) => {
    let resultado;
    try {
      resultado = await carregarTermos(origemEscolhida.project_id);
    } catch {
      resultado = {
        dados: null,
        erro: 'Não foi possível carregar os termos do contrato.',
      };
    }
    if (!montadoRef.current || painelGenRef.current !== gen) return;

    if (resultado?.erro || !resultado?.dados) {
      setPainel({
        tipo: 'termo',
        titulo: 'Do contrato',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        notaOrigem,
        carregando: false,
        erro: resultado?.erro || 'Não foi possível carregar os termos do contrato.',
      });
      return;
    }

    const termos =
      resultado.dados.termos && typeof resultado.dados.termos === 'object'
        ? resultado.dados.termos
        : {};
    let encontrado = null;
    for (const [chave, termo] of Object.entries(termos)) {
      if (termo?.id === origemEscolhida.termo_id) {
        encontrado = { chave, termo };
        break;
      }
    }

    if (!encontrado) {
      setPainel({
        tipo: 'termo-vazio',
        titulo: 'Do contrato',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        notaOrigem,
      });
      return;
    }

    setPainel({
      tipo: 'termo',
      titulo: 'Do contrato',
      origem: origemEscolhida,
      valorEsperado,
      conta,
      notaOrigem,
      carregando: false,
      erro: null,
      chave: encontrado.chave,
      termo: encontrado.termo,
    });
  };

  const abrirOrigem = (origemEscolhida, opcoes = {}) => {
    if (!origemAbribel(origemEscolhida)) return;
    const { valorEsperado = null, conta = null, notaOrigem = null } = opcoes;
    const gen = ++painelGenRef.current;
    setDocumento(null);
    setVoltarConta(conta);

    if (origemEscolhida.tipo === 'no') {
      setPainel({
        tipo: 'no',
        titulo: 'De onde vem',
        origem: origemEscolhida,
        valorEsperado,
        arvore: origemEscolhida.no,
      });
      return;
    }

    if (origemEscolhida.tipo === 'livre') {
      setPainel({
        tipo: 'livre',
        titulo: 'De onde vem',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        notaOrigem,
        carregando: true,
        erro: null,
        arvore: null,
      });
      void carregarLivre(origemEscolhida, gen, valorEsperado, conta, notaOrigem);
      return;
    }

    if (origemEscolhida.tipo === 'ref') {
      setPainel({
        tipo: 'ref',
        titulo: 'De onde vem',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        notaOrigem,
        carregando: true,
        erro: null,
      });
      void carregarRef(origemEscolhida, gen, valorEsperado, conta, notaOrigem);
      return;
    }

    if (origemEscolhida.tipo === 'termo') {
      setPainel({
        tipo: 'termo',
        titulo: 'Do contrato',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        notaOrigem,
        carregando: true,
        erro: null,
      });
      void carregarTermo(origemEscolhida, gen, valorEsperado, conta, notaOrigem);
      return;
    }

    if (origemEscolhida.tipo === 'calculo') {
      setPainel({
        tipo: 'calculo',
        titulo: 'Conta',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        notaOrigem,
        op: origemEscolhida.op || null,
        partes: Array.isArray(origemEscolhida.partes) ? origemEscolhida.partes : [],
      });
    }
  };

  const tentarPainel = () => {
    if (!painel?.origem) return;
    abrirOrigem(painel.origem, {
      valorEsperado: painel.valorEsperado,
      conta: painel.conta || null,
      notaOrigem: painel.notaOrigem || null,
    });
  };

  const abrirDocumentoDoTermo = (termo) => {
    const doc = termo?.documento;
    if (!doc?.bucket || !doc?.caminho) return;
    painelGenRef.current += 1;
    setPainel(null);
    setVoltarConta(null);
    setDocumento({
      titulo: termo.documento_nome || doc.arquivo_nome || 'Documento do contrato',
      documento: doc,
      tipoOrigem: 'documento',
      fato: null,
      busca: null,
      nota: '',
      valor: null,
      parte: termo.documento_nome || '',
    });
  };

  const podeEnviar =
    !correndo &&
    !(ativaChave !== CHAVE_NOVA && !carregadas[ativaChave]) &&
    pergunta.trim().length > 0 &&
    pergunta.length <= LIMITE_PERGUNTA;

  const aoTeclar = (evento) => {
    // Enter envia, como nas outras IAs; Shift+Enter quebra a linha. Durante a
    // composição de acento (IME) o Enter confirma o caractere, não envia.
    if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
      evento.preventDefault();
      enviar();
    }
  };

  const salvarTitulo = async (evento) => {
    evento?.preventDefault?.();
    if (ativaChave === CHAVE_NOVA) return;
    const limpo = tituloRascunho.trim();
    if (limpo.length < 1 || limpo.length > TITULO_MAX) {
      setErroTitulo(`O título precisa ter entre 1 e ${TITULO_MAX} caracteres.`);
      return;
    }
    setErroTitulo(null);
    let resultado;
    try {
      resultado = await renomearConversa(ativaChave, limpo);
    } catch {
      resultado = { erro: 'Não foi possível renomear a conversa.' };
    }
    if (!montadoRef.current) return;
    if (resultado?.erro) {
      setErroTitulo(resultado.erro);
      return;
    }
    setConversas((prev) =>
      prev.map((conversa) =>
        conversa.id === ativaChave ? { ...conversa, titulo: limpo } : conversa
      )
    );
    setRenomeando(false);
    setErroTitulo(null);
  };

  const confirmarExclusao = async () => {
    if (ativaChave === CHAVE_NOVA || excluindo) return;
    setExcluindo(true);
    setErroExclusao(null);
    let resultado;
    try {
      resultado = await excluirConversa(ativaChave);
    } catch {
      resultado = { erro: 'Não foi possível excluir a conversa.' };
    }
    if (!montadoRef.current) return;
    setExcluindo(false);
    if (resultado?.erro) {
      setErroExclusao(resultado.erro);
      return;
    }

    const chaveExcluida = ativaChave;
    if (correndoRef.current?.chave === chaveExcluida) parar();
    setConversas((prev) => prev.filter((conversa) => conversa.id !== chaveExcluida));
    setTurnosPorConversa((prev) => {
      const copia = { ...prev };
      delete copia[chaveExcluida];
      return copia;
    });
    setCarregadas((prev) => {
      const copia = { ...prev };
      delete copia[chaveExcluida];
      return copia;
    });
    setConfirmandoExclusao(false);
    setErroExclusao(null);
    novaConversa();
  };

  const renderPassos = (turno) => {
    if (turno.passos.length === 0) return null;
    return (
      <div class="analise__passos" aria-live="polite" aria-label="Passos da análise">
        <ul class="analise__passos-lista">
          {turno.passos.map((passo) => (
            <li
              key={passo.chave}
              class={`analise__passo${passo.estado === 'erro' ? ' analise__passo--erro' : ''}`}
            >
              <span class="analise__passo-estado" aria-hidden="true">
                {passo.estado === 'inicio' ? '…' : passo.estado === 'fim' ? '✓' : '!'}
              </span>
              <span class="analise__passo-rotulo">{passo.rotulo}</span>
              {passo.estado === 'fim' && <span class="analise__passo-nota">concluído</span>}
              {passo.estado === 'erro' && (
                <span class="analise__passo-erro">{passo.erro}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderConta = (conta, notaOrigem) => {
    const partes = Array.isArray(conta.partes) ? conta.partes : [];
    let somaCentavos = 0;
    let somaValida = true;
    for (const parte of partes) {
      const numero = Number(parte?.valor);
      if (!Number.isFinite(numero)) {
        somaValida = false;
        break;
      }
      const sinal = parte?.sinal === -1 ? -1 : 1;
      somaCentavos += sinal * Math.round(numero * 100);
    }
    const totalNumero = Number(conta.valorEsperado);
    const totalValido = Number.isFinite(totalNumero);
    const totalCentavos = totalValido ? Math.round(totalNumero * 100) : null;
    const falha = !somaValida || !totalValido || somaCentavos !== totalCentavos;

    return (
      <div class="analise__conta">
        {falha && <AvisoFalha mensagem="A soma das partes difere do total." />}

        <ul class="analise__conta-partes">
          {partes.map((parte, indice) => (
            <li key={parte?.id || `parte-${indice}`} class="analise__conta-parte">
              <span class="analise__sinal" aria-label={parte?.sinal === -1 ? 'subtrai' : 'soma'}>
                {parte?.sinal === -1 ? '−' : '+'}
              </span>
              <span class="analise__conta-rotulo">{parte?.rotulo || 'Parte'}</span>
              <ValorAnalise
                valor={parte?.valor}
                unidade="moeda"
                origem={parte?.origem}
                valorEsperado={parte?.valor}
                onOrigem={(origemDaParte) =>
                  abrirOrigem(origemDaParte, {
                    valorEsperado: parte?.valor,
                    conta,
                    notaOrigem,
                  })
                }
              />
            </li>
          ))}
        </ul>

        <div class="analise__conta-total">
          <span>Total</span>
          <Valor
            valor={totalValido ? totalNumero : null}
            centavos
            motivoSemDado="sem total"
            semOrigem="Total da conta"
          />
        </div>
      </div>
    );
  };

  const renderTermo = (dadosTermo) => {
    const rotulo = ROTULOS_TERMO_CONTRATO[dadosTermo.chave] || dadosTermo.chave;
    const termo = dadosTermo.termo || {};
    const temDocumento = Boolean(termo.documento?.bucket && termo.documento?.caminho);

    return (
      <div class="analise__termo">
        <p class="analise__termo-rotulo">{rotulo}</p>
        <p class="analise__termo-valor">{textoValorDoTermo(dadosTermo.chave, termo)}</p>
        {termo.trecho && <blockquote class="analise__trecho">{termo.trecho}</blockquote>}
        {termo.nota && <p class="analise__nota">{termo.nota}</p>}
        {temDocumento && (
          <Botao variante="secundario" onClick={() => abrirDocumentoDoTermo(termo)}>
            Abrir o documento
          </Botao>
        )}
      </div>
    );
  };

  const renderPainel = () => {
    if (!painel) return null;

    const valorEsperadoDaArvore =
      typeof painel.valorEsperado === 'number' && Number.isFinite(painel.valorEsperado)
        ? painel.valorEsperado
        : undefined;
    const tiposComNota = new Set(['livre', 'ref', 'nota', 'termo', 'termo-vazio']);
    const notaOrigem =
      painel.notaOrigem && tiposComNota.has(painel.tipo) ? painel.notaOrigem : null;

    let conteudo = null;
    if (painel.carregando) {
      conteudo = <Esqueleto variante="linha" linhas={4} rotulo="Carregando origem" />;
    } else if (painel.erro) {
      conteudo = (
        <AvisoFalha
          mensagem={painel.erro}
          aoTentarNovamente={painel.origem ? tentarPainel : null}
        />
      );
    } else if (painel.tipo === 'no') {
      conteudo = <DeOndeVem arvore={painel.arvore} valorEsperado={valorEsperadoDaArvore} />;
    } else if (painel.tipo === 'livre') {
      conteudo = (
        <>
          {painel.parteDe && (
            <p class="analise__parte-de">Parte de: {painel.parteDe}</p>
          )}
          {painel.nota && <p class="analise__nota">{painel.nota}</p>}
          <DeOndeVem arvore={painel.arvore} valorEsperado={valorEsperadoDaArvore} />
        </>
      );
    } else if (painel.tipo === 'nota') {
      conteudo = <Vazio mensagem={painel.nota} />;
    } else if (painel.tipo === 'termo-vazio') {
      conteudo = <Vazio mensagem="Este termo não está mais registrado." />;
    } else if (painel.tipo === 'termo') {
      conteudo = renderTermo(painel);
    } else if (painel.tipo === 'calculo') {
      conteudo = renderConta(painel, painel.notaOrigem || null);
    }

    if (!notaOrigem) return conteudo;
    return (
      <>
        <p class="analise__nota">{notaOrigem}</p>
        {conteudo}
      </>
    );
  };

  const renderAviso = (turno, chave) => {
    if (turno.status === 'correndo' || turno.status === 'parada' || !turno.erro) {
      return null;
    }
    const codigo = turno.erro?.codigo || '';
    const mensagem =
      typeof turno.erro?.mensagem === 'string' && turno.erro.mensagem.trim()
        ? turno.erro.mensagem
        : 'Não foi possível concluir a análise.';
    const comRetentativa = CODIGOS_COM_RETENTATIVA.has(codigo);
    return (
      <AvisoFalha
        grave={codigo === 'interno' || codigo === 'sem_permissao'}
        mensagem={mensagem}
        aoTentarNovamente={comRetentativa ? () => tentarDeNovo(turno, chave) : null}
      />
    );
  };

  const renderFeedback = (turno, chave) => {
    if (!turno.registro || turno.status === 'correndo') return null;
    const feedback = turno.feedback;

    if (feedback.enviado) {
      return (
        <p class="analise__feedback-obrigado" role="status">
          Obrigado, anotado.
        </p>
      );
    }

    if (feedback.modo === 'comentario') {
      return (
        <div class="analise__feedback">
          <label class="analise__feedback-pergunta" for={`${turno.id}-comentario`}>
            O que faltou ou veio errado?
          </label>
          <textarea
            id={`${turno.id}-comentario`}
            class="analise__comentario"
            rows={3}
            maxLength={LIMITE_COMENTARIO}
            value={feedback.comentario}
            disabled={feedback.enviando}
            onInput={(evento) =>
              registrarFeedback(chave, turno.id, { comentario: evento.currentTarget.value })
            }
          />
          <div class="analise__feedback-acoes">
            <Botao
              variante="secundario"
              tamanho="compacto"
              desabilitado={feedback.enviando}
              carregando={feedback.enviando}
              onClick={() =>
                mandarFeedback(turno, chave, -1, feedback.comentario.trim() || null)
              }
            >
              Enviar
            </Botao>
            <Botao
              variante="fantasma"
              tamanho="compacto"
              desabilitado={feedback.enviando}
              onClick={() => registrarFeedback(chave, turno.id, { modo: 'inicial', erro: null })}
            >
              Cancelar
            </Botao>
          </div>
          {feedback.erro && (
            <p class="analise__feedback-erro" role="alert">
              {feedback.erro}
            </p>
          )}
        </div>
      );
    }

    return (
      <div class="analise__feedback">
        <span class="analise__feedback-pergunta">Esta resposta ajudou?</span>
        <div class="analise__feedback-acoes">
          <Botao
            variante="secundario"
            tamanho="compacto"
            desabilitado={feedback.enviando}
            carregando={feedback.enviando}
            onClick={() => mandarFeedback(turno, chave, 1, null)}
          >
            Sim
          </Botao>
          <Botao
            variante="fantasma"
            tamanho="compacto"
            desabilitado={feedback.enviando}
            onClick={() => registrarFeedback(chave, turno.id, { modo: 'comentario', erro: null })}
          >
            Não
          </Botao>
        </div>
        {feedback.erro && (
          <p class="analise__feedback-erro" role="alert">
            {feedback.erro}
          </p>
        )}
      </div>
    );
  };

  const renderTurno = (turno, chave) => {
    const carregado = Boolean(turno.carregado);
    const textoFinal =
      typeof turno.texto?.texto === 'string' && turno.texto.texto ? turno.texto : null;
    const metadados = [];
    if (!carregado && turno.fim && Number.isFinite(Number(turno.fim.rodadas))) {
      metadados.push(textoRodadas(turno.fim.rodadas));
    }
    if (!carregado && turno.fim && Number.isFinite(Number(turno.fim.ms))) {
      metadados.push(textoSegundos(turno.fim.ms));
    }
    const notaOrigem = notaDeOrigemDoTurno(turno, agora());
    const semRespostaSalva =
      carregado && !textoFinal && turno.blocos.length === 0 && !turno.terminadaEm;
    const naoSalvo = !carregado && turno.recebeuInicio && !turno.registro && turno.status !== 'correndo';

    return (
      <Cartao key={turno.id} titulo={turno.pergunta} className="analise__cartao">
        {!carregado && renderPassos(turno)}
        {!carregado && renderAviso(turno, chave)}

        {semRespostaSalva && (
          <p class="analise__nota">A resposta desta pergunta não foi salva.</p>
        )}

        {!carregado && turno.status === 'correndo' && turno.blocos.length === 0 && !textoFinal && (
          <Esqueleto variante="cartao" linhas={3} rotulo="Montando a análise" />
        )}

        {textoFinal && (
          <p class="analise__texto-final texto-corrido">
            <TextoComSemOrigem
              texto={textoFinal.texto}
              semOrigem={textoFinal.semOrigem}
            />
          </p>
        )}

        {turno.blocos.map((bloco, indice) => (
          <BlocoAnalise
            key={bloco?.id || `bloco-${indice}`}
            bloco={bloco}
            onOrigem={(origem, opcoes) =>
              abrirOrigem(origem, {
                ...(opcoes || {}),
                notaOrigem,
              })
            }
          />
        ))}

        {turno.blocoInvalido && (
          <p class="analise__bloco-invalido">
            Um bloco veio em formato inválido e foi omitido.
          </p>
        )}

        {!carregado && turno.status === 'parada' && (
          <>
            <p class="analise__nota">Você parou a análise.</p>
            <div class="analise__acoes">
              <Botao
                variante="fantasma"
                tamanho="compacto"
                onClick={() => tentarDeNovo(turno, chave)}
              >
                Tentar de novo
              </Botao>
            </div>
          </>
        )}

        {!carregado && turno.status === 'correndo' && (
          <p class="analise__tempo">{textoTempoDecorrido(turno.segundos)}</p>
        )}

        <footer class="analise__rodape">
          {carregado && turno.terminadaEm && (
            <p class="analise__meta">
              Respondida em {dataHoraBrasilia(turno.terminadaEm)}
            </p>
          )}
          {!carregado && metadados.length > 0 && (
            <p class="analise__meta">{metadados.join(' · ')}</p>
          )}
          {!carregado && renderFeedback(turno, chave)}
          {naoSalvo && (
            <p class="analise__nao-salvo">Não foi possível salvar no histórico.</p>
          )}
        </footer>
      </Cartao>
    );
  };

  const lista = (
    <ListaConversas
      conversas={conversas}
      ativaId={ativaChave === CHAVE_NOVA ? null : ativaChave}
      onSelecionar={(id) => abrirConversa(id)}
      onNova={novaConversa}
      agora={agora()}
      carregando={listaSt.carregando && conversas.length === 0}
    />
  );

  const mostrarErroLista = Boolean(listaSt.erro);
  const conversaEmCarregamento = carregandoConversa === ativaChave;
  const conversaComErro = erroConversa?.chave === ativaChave ? erroConversa : null;
  const podeDigitar =
    !correndo &&
    !conversaEmCarregamento &&
    !conversaComErro &&
    (ativaChave === CHAVE_NOVA || Boolean(carregadas[ativaChave]));

  return (
    <div class="conteudo analise">
      <CabecalhoPagina
        titulo="Análise"
        contexto="Pergunte sobre os centros. Todo número abre a origem."
      />

      <div class="analise__layout">
        <aside class="analise__coluna-conversas" aria-label="Conversas">
          {lista}
        </aside>

        <div class="analise__conversa">
          <div class="analise__barra-conversas">
            <Botao variante="secundario" onClick={() => setPainelConversas(true)}>
              Conversas
            </Botao>
          </div>

          <div class="analise__cabecalho-conversa">
            {renomeando && ativaChave !== CHAVE_NOVA ? (
              <form class="analise__renomear" onSubmit={salvarTitulo}>
                <label class="analise__rotulo" for={`${campoId}-titulo`}>
                  Título da conversa
                </label>
                <input
                  id={`${campoId}-titulo`}
                  class="analise__titulo-campo"
                  value={tituloRascunho}
                  maxLength={TITULO_MAX}
                  onInput={(evento) => setTituloRascunho(evento.currentTarget.value)}
                />
                <div class="analise__renomear-acoes">
                  <Botao tipo="submit" variante="secundario" tamanho="compacto">
                    Salvar
                  </Botao>
                  <Botao
                    variante="fantasma"
                    tamanho="compacto"
                    onClick={() => {
                      setRenomeando(false);
                      setErroTitulo(null);
                    }}
                  >
                    Cancelar
                  </Botao>
                </div>
                {erroTitulo && (
                  <p class="analise__nota analise__nota--erro" role="alert">
                    {erroTitulo}
                  </p>
                )}
              </form>
            ) : (
              <div class="analise__titulo-linha">
                <h2 class="analise__titulo-conversa">{tituloAtivo}</h2>
                {ativaChave !== CHAVE_NOVA && (
                  <div class="analise__titulo-acoes">
                    <Botao
                      variante="fantasma"
                      tamanho="compacto"
                      icone={Pencil}
                      onClick={() => {
                        setRenomeando(true);
                        setTituloRascunho(conversaAberta?.titulo || tituloAtivo);
                        setErroTitulo(null);
                      }}
                    >
                      Renomear
                    </Botao>
                    <Botao
                      variante="fantasma"
                      tamanho="compacto"
                      onClick={() => {
                        setConfirmandoExclusao(true);
                        setErroExclusao(null);
                      }}
                    >
                      Excluir
                    </Botao>
                  </div>
                )}
              </div>
            )}

            {confirmandoExclusao && ativaChave !== CHAVE_NOVA && (
              <div class="analise__confirmar-exclusao" role="alertdialog" aria-label="Excluir conversa">
                <p>Excluir esta conversa? Não dá para desfazer.</p>
                <div class="analise__renomear-acoes">
                  <Botao
                    variante="secundario"
                    tamanho="compacto"
                    carregando={excluindo}
                    onClick={confirmarExclusao}
                  >
                    Excluir
                  </Botao>
                  <Botao
                    variante="fantasma"
                    tamanho="compacto"
                    desabilitado={excluindo}
                    onClick={() => {
                      setConfirmandoExclusao(false);
                      setErroExclusao(null);
                    }}
                  >
                    Cancelar
                  </Botao>
                </div>
                {erroExclusao && (
                  <p class="analise__feedback-erro" role="alert">
                    {erroExclusao}
                  </p>
                )}
              </div>
            )}
          </div>

          {mostrarErroLista && (
            <AvisoFalha mensagem={listaSt.erro} aoTentarNovamente={tentarLista} />
          )}

          <div class="analise__rolagem">
            {anterior && ativaChave === CHAVE_NOVA && turnosAtivos.length === 0 && (
              <div class="analise__anterior">
                <p class="analise__nota">
                  Sua última conversa foi em {dataCurtaBrasilia(anterior.atualizada_em)}: «
                  {anterior.titulo}»
                </p>
                <Botao
                  variante="secundario"
                  tamanho="compacto"
                  onClick={() => abrirConversa(anterior.id, { forcar: true })}
                >
                  Continuar
                </Botao>
              </div>
            )}

            {conversaEmCarregamento && (
              <Esqueleto variante="cartao" linhas={4} rotulo="Carregando conversa" />
            )}

            {conversaComErro && (
              <AvisoFalha
                mensagem={conversaComErro.mensagem}
                aoTentarNovamente={() => abrirConversa(ativaChave, { forcar: true })}
              />
            )}

            {!conversaEmCarregamento && !conversaComErro && turnosAtivos.length === 0 && (
              <Vazio mensagem="Faça a primeira pergunta para ver os números com a origem de cada um." />
            )}

            <div class="analise__lista">
              {!conversaEmCarregamento &&
                !conversaComErro &&
                turnosAtivos.map((turno) => renderTurno(turno, ativaChave))}
            </div>
            <div ref={fimListaRef} class="analise__fim" aria-hidden="true" />

            <Cartao className="analise__pergunta-cartao analise__pergunta-fixa">
              <form
                class="analise__form"
                onSubmit={(evento) => {
                  evento.preventDefault();
                  enviar();
                }}
              >
                <label class="analise__rotulo" for={campoId}>
                  Pergunta
                </label>
                <textarea
                  ref={campoRef}
                  id={campoId}
                  class="analise__campo"
                  rows={3}
                  value={pergunta}
                  placeholder="Ex.: Quanto o 30.109 tem livre hoje, e de onde vem?"
                  disabled={!podeDigitar}
                  onInput={(evento) =>
                    setRascunhos((prev) => ({
                      ...prev,
                      [ativaChave]: evento.currentTarget.value,
                    }))
                  }
                  onKeyDown={aoTeclar}
                  aria-describedby={`${campoId}-aviso`}
                />

                {pergunta.length >= CONTADOR_A_PARTIR_DE && (
                  <span
                    class={`analise__contador${
                      pergunta.length > LIMITE_PERGUNTA ? ' analise__contador--excedido' : ''
                    }`}
                  >
                    {pergunta.length > LIMITE_PERGUNTA
                      ? `${pergunta.length - LIMITE_PERGUNTA} ${
                          pergunta.length - LIMITE_PERGUNTA === 1 ? 'caractere' : 'caracteres'
                        } acima do limite de 2.000.`
                      : `${pergunta.length} de 2.000 caracteres`}
                  </span>
                )}

                <p id={`${campoId}-aviso`} class="analise__aviso">
                  As conversas ficam no seu histórico e ajudam a melhorar a Análise. Limite de 50
                  perguntas por dia.
                </p>

                <div class="analise__acoes">
                  {correndo?.chave === ativaChave ? (
                    <Botao variante="secundario" onClick={parar}>
                      Parar
                    </Botao>
                  ) : (
                    <Botao variante="primario" tipo="submit" desabilitado={!podeEnviar}>
                      Perguntar
                    </Botao>
                  )}
                </div>

                {turnosAtivos.length === 0 && (
                  <div class="analise__sugestoes" aria-label="Sugestões de pergunta">
                    {SUGESTOES.map((sugestao) => (
                      <Chip
                        key={sugestao}
                        onClick={() => {
                          setRascunhos((prev) => ({ ...prev, [ativaChave]: sugestao }));
                          campoRef.current?.focus?.();
                        }}
                      >
                        {sugestao}
                      </Chip>
                    ))}
                  </div>
                )}
              </form>
            </Cartao>
          </div>
        </div>
      </div>

      <PainelLateral
        aberto={painelConversas}
        aoFechar={() => setPainelConversas(false)}
        titulo="Conversas"
      >
        {lista}
      </PainelLateral>

      <PainelLateral
        aberto={Boolean(painel)}
        aoFechar={fecharPainel}
        titulo={painel?.titulo || 'De onde vem'}
      >
        {voltarConta && (
          <div class="analise__voltar-conta">
            <Botao variante="fantasma" tamanho="compacto" onClick={voltarParaConta}>
              Voltar à conta
            </Botao>
          </div>
        )}
        {renderPainel()}
      </PainelLateral>

      <Documento
        aberto={Boolean(documento)}
        aoFechar={() => setDocumento(null)}
        titulo={documento?.titulo || ''}
        documento={documento?.documento || null}
        tipoOrigem={documento?.tipoOrigem || 'documento'}
        fato={documento?.fato || null}
        busca={documento?.busca || null}
        nota={documento?.nota || ''}
        valor={documento?.valor ?? null}
        parte={documento?.parte || ''}
      />
    </div>
  );
}
