import { useEffect, useId, useRef, useState } from 'preact/hooks';
import {
  AvisoFalha,
  Botao,
  CabecalhoPagina,
  Cartao,
  Chip,
  DeOndeVem,
  Documento,
  Esqueleto,
  PainelLateral,
  Valor,
  Vazio,
} from '../componentes/index.js';
import {
  BlocoAnalise,
  TextoComSemOrigem,
  ValorAnalise,
  blocoValido,
  origemAbribel,
} from '../componentes/BlocoAnalise.jsx';
import {
  enviarFeedback as enviarFeedbackPadrao,
  executarAnalise as executarAnalisePadrao,
} from '../servicos/analise.js';
import {
  explicarLivre as carregarExplicacaoPadrao,
  origem as consultarOrigemPadrao,
  termosContrato as carregarTermosPadrao,
} from '../servicos/dados.js';
import { dataCompleta } from '../util/formato.js';
import './Analise.css';

const LIMITE_PERGUNTA = 2000;
const LIMITE_ANTERIORES = 5;
const CORTE_PERGUNTA_ANTERIOR = 500;
const CORTE_RESUMO_ANTERIOR = 1000;
const LIMITE_COMENTARIO = 2000;
const CONTADOR_A_PARTIR_DE = 1800;

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

function acharPorChave(no, chave) {
  if (!chave || !no || typeof no !== 'object') return null;
  if (no.chave === chave) return no;
  const partes = Array.isArray(no.partes) ? no.partes : [];
  for (const parte of partes) {
    const achado = acharPorChave(parte, chave);
    if (achado) return achado;
  }
  return null;
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
 * Tela `#/analise`: área de trabalho com pergunta, passos ao vivo, blocos
 * e origem clicável em todo número. As funções de serviço são props para os
 * testes injetarem um stream falso sem rede.
 */
export function Analise({
  executarAnalise = executarAnalisePadrao,
  enviarFeedback = enviarFeedbackPadrao,
  carregarExplicacao = carregarExplicacaoPadrao,
  consultarOrigem = consultarOrigemPadrao,
  carregarTermos = carregarTermosPadrao,
} = {}) {
  const campoId = useId();
  const [pergunta, setPergunta] = useState('');
  const [analises, setAnalises] = useState([]);
  const [correndoId, setCorrendoId] = useState(null);
  const [painel, setPainel] = useState(null);
  const [voltarConta, setVoltarConta] = useState(null);
  const [documento, setDocumento] = useState(null);

  const montadoRef = useRef(true);
  const sequenciaRef = useRef(0);
  const execucaoGenRef = useRef(0);
  const abortRef = useRef(null);
  const correndoRef = useRef(null);
  const timerRef = useRef(null);
  const painelGenRef = useRef(0);
  const campoRef = useRef(null);

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

  const atualizarAnalise = (id, atualizador) => {
    if (!montadoRef.current) return;
    setAnalises((prev) =>
      prev.map((analise) => (analise.id === id ? atualizador(analise) : analise))
    );
  };

  const limparTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const parar = () => {
    const id = correndoRef.current || correndoId;
    execucaoGenRef.current += 1;
    limparTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    correndoRef.current = null;
    setCorrendoId(null);
    if (id) {
      atualizarAnalise(id, (analise) => ({ ...analise, status: 'parada' }));
    }
  };

  const novaAnalise = () => {
    execucaoGenRef.current += 1;
    painelGenRef.current += 1;
    limparTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    correndoRef.current = null;
    setCorrendoId(null);
    setPainel(null);
    setVoltarConta(null);
    setDocumento(null);
    setAnalises([]);
    setPergunta('');
  };

  const rodarAnalise = async (analise) => {
    const gen = ++execucaoGenRef.current;
    const inicioEm = Date.now();
    const controlador = new AbortController();
    abortRef.current = controlador;
    correndoRef.current = analise.id;

    setCorrendoId(analise.id);
    atualizarAnalise(analise.id, (atual) => ({
      ...atual,
      status: 'correndo',
      passos: [],
      blocos: [],
      blocoInvalido: false,
      texto: null,
      fim: null,
      erro: null,
      registro: null,
      segundos: 0,
      feedback: feedbackVazio(),
    }));

    limparTimer();
    timerRef.current = setInterval(() => {
      if (!montadoRef.current || execucaoGenRef.current !== gen) return;
      const segundos = Math.floor((Date.now() - inicioEm) / 1000);
      setAnalises((prev) =>
        prev.map((item) =>
          item.id === analise.id && item.status === 'correndo'
            ? { ...item, segundos }
            : item
        )
      );
    }, 1000);

    const atualizarSeAtual = (atualizador) => {
      if (!montadoRef.current || execucaoGenRef.current !== gen) return;
      atualizarAnalise(analise.id, atualizador);
    };

    let resultado;
    try {
      resultado = await executarAnalise({
        pergunta: analise.pergunta,
        anteriores: analise.anteriores || [],
        signal: controlador.signal,
        onInicio: (dados) => {
          atualizarSeAtual((atual) => ({
            ...atual,
            registro: dados?.registro ?? null,
          }));
        },
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

    const segundos =
      resultado?.fim?.ms !== undefined
        ? Math.max(0, Math.round(Number(resultado.fim.ms) / 1000))
        : Math.floor((Date.now() - inicioEm) / 1000);

    setAnalises((prev) =>
      prev.map((atual) => {
        if (atual.id !== analise.id) return atual;

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
          blocos: validos,
          blocoInvalido: atual.blocoInvalido || validos.length !== blocos.length,
          texto: resultado?.texto ?? atual.texto,
          fim: resultado?.fim ?? atual.fim,
          erro: resultado?.abortada ? null : resultado?.erro ?? atual.erro,
          status,
          segundos,
        };
      })
    );
    setCorrendoId(null);
  };

  const enviar = (textoForcado) => {
    if (correndoRef.current) return;
    const textoBruto = typeof textoForcado === 'string' ? textoForcado : pergunta;
    const texto = String(textoBruto || '').trim();
    if (!texto || texto.length > LIMITE_PERGUNTA) return;

    const anteriores = analises
      .filter(
        (analise) =>
          analise.status === 'ok' &&
          typeof analise.texto?.texto === 'string' &&
          analise.texto.texto.trim() !== ''
      )
      .slice(0, LIMITE_ANTERIORES)
      .reverse()
      .map((analise) => ({
        pergunta: analise.pergunta.slice(0, CORTE_PERGUNTA_ANTERIOR),
        resumo: analise.texto.texto.slice(0, CORTE_RESUMO_ANTERIOR),
      }));

    const id = `analise-${++sequenciaRef.current}`;
    const nova = {
      id,
      pergunta: texto,
      anteriores,
      registro: null,
      passos: [],
      blocos: [],
      blocoInvalido: false,
      texto: null,
      fim: null,
      erro: null,
      status: 'correndo',
      segundos: 0,
      feedback: feedbackVazio(),
    };

    setAnalises((prev) => [nova, ...prev]);
    setPergunta('');
    rodarAnalise(nova);
  };

  const tentarDeNovo = (analise) => {
    if (correndoRef.current) return;
    rodarAnalise(analise);
  };

  const registrarFeedback = (id, campos) => {
    atualizarAnalise(id, (analise) => ({
      ...analise,
      feedback: { ...analise.feedback, ...campos },
    }));
  };

  const mandarFeedback = async (analise, nota, comentario = null) => {
    if (!analise.registro || analise.feedback.enviando) return;
    registrarFeedback(analise.id, { enviando: true, erro: null });

    let resultado;
    try {
      resultado = await enviarFeedback(analise.registro, { nota, comentario });
    } catch {
      resultado = { id: null, erro: 'Não foi possível enviar o feedback.' };
    }
    if (!montadoRef.current) return;

    if (resultado?.erro) {
      registrarFeedback(analise.id, { enviando: false, erro: resultado.erro });
      return;
    }
    registrarFeedback(analise.id, {
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

  const carregarLivre = async (origemEscolhida, gen, valorEsperado, conta = null) => {
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
        const porChave = acharPorChave(raiz, origemEscolhida.chave);
        if (porChave) {
          arvore = porChave;
        } else {
          nota = 'Não achei o item exato; mostrando a origem do livre do centro.';
        }
      }
    }

    setPainel({
      tipo: 'livre',
      titulo: 'De onde vem',
      origem: origemEscolhida,
      valorEsperado,
      conta,
      carregando: false,
      erro: null,
      arvore,
      parteDe: arvore !== raiz ? raiz.rotulo || 'Livre' : '',
      nota,
    });
  };

  const carregarRef = async (origemEscolhida, gen, valorEsperado, conta = null) => {
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
      nota: dados.nota || '',
      valor: dados.valor ?? null,
      parte: origemEscolhida.nome || '',
    });
  };

  const carregarTermo = async (origemEscolhida, gen, valorEsperado, conta = null) => {
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
      });
      return;
    }

    setPainel({
      tipo: 'termo',
      titulo: 'Do contrato',
      origem: origemEscolhida,
      valorEsperado,
      conta,
      carregando: false,
      erro: null,
      chave: encontrado.chave,
      termo: encontrado.termo,
    });
  };

  const abrirOrigem = (origemEscolhida, opcoes = {}) => {
    if (!origemAbribel(origemEscolhida)) return;
    const { valorEsperado = null, conta = null } = opcoes;
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
        carregando: true,
        erro: null,
        arvore: null,
      });
      carregarLivre(origemEscolhida, gen, valorEsperado, conta);
      return;
    }

    if (origemEscolhida.tipo === 'ref') {
      setPainel({
        tipo: 'ref',
        titulo: 'De onde vem',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        carregando: true,
        erro: null,
      });
      carregarRef(origemEscolhida, gen, valorEsperado, conta);
      return;
    }

    if (origemEscolhida.tipo === 'termo') {
      setPainel({
        tipo: 'termo',
        titulo: 'Do contrato',
        origem: origemEscolhida,
        valorEsperado,
        conta,
        carregando: true,
        erro: null,
      });
      carregarTermo(origemEscolhida, gen, valorEsperado, conta);
      return;
    }

    if (origemEscolhida.tipo === 'calculo') {
      setPainel({
        tipo: 'calculo',
        titulo: 'Conta',
        origem: origemEscolhida,
        valorEsperado,
        conta,
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
    !correndoId &&
    pergunta.trim().length > 0 &&
    pergunta.length <= LIMITE_PERGUNTA;

  const aoTeclar = (evento) => {
    if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey)) {
      evento.preventDefault();
      enviar();
    }
  };

  const renderPassos = (analise) => {
    if (analise.passos.length === 0) return null;
    return (
      <div class="analise__passos" aria-live="polite" aria-label="Passos da análise">
        <ul class="analise__passos-lista">
          {analise.passos.map((passo) => (
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

  const renderConta = (conta) => {
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

    if (painel.carregando) {
      return <Esqueleto variante="linha" linhas={4} rotulo="Carregando origem" />;
    }

    if (painel.erro) {
      return (
        <AvisoFalha
          mensagem={painel.erro}
          aoTentarNovamente={painel.origem ? tentarPainel : null}
        />
      );
    }

    if (painel.tipo === 'no') {
      return <DeOndeVem arvore={painel.arvore} />;
    }

    if (painel.tipo === 'livre') {
      return (
        <>
          {painel.parteDe && (
            <p class="analise__parte-de">Parte de: {painel.parteDe}</p>
          )}
          {painel.nota && <p class="analise__nota">{painel.nota}</p>}
          <DeOndeVem arvore={painel.arvore} />
        </>
      );
    }

    if (painel.tipo === 'nota') {
      return <Vazio mensagem={painel.nota} />;
    }

    if (painel.tipo === 'termo-vazio') {
      return <Vazio mensagem="Este termo não está mais registrado." />;
    }

    if (painel.tipo === 'termo') {
      return renderTermo(painel);
    }

    if (painel.tipo === 'calculo') {
      return renderConta(painel);
    }

    return null;
  };

  const renderAviso = (analise) => {
    if (analise.status === 'correndo' || analise.status === 'parada' || !analise.erro) {
      return null;
    }
    const codigo = analise.erro?.codigo || '';
    const mensagem =
      typeof analise.erro?.mensagem === 'string' && analise.erro.mensagem.trim()
        ? analise.erro.mensagem
        : 'Não foi possível concluir a análise.';
    const comRetentativa = CODIGOS_COM_RETENTATIVA.has(codigo);
    return (
      <AvisoFalha
        grave={codigo === 'interno' || codigo === 'sem_permissao'}
        mensagem={mensagem}
        aoTentarNovamente={comRetentativa ? () => tentarDeNovo(analise) : null}
      />
    );
  };

  const renderFeedback = (analise) => {
    if (!analise.registro || analise.status === 'correndo') return null;
    const feedback = analise.feedback;

    if (feedback.enviado) {
      return <p class="analise__feedback-obrigado">Obrigado, anotado.</p>;
    }

    if (feedback.modo === 'comentario') {
      return (
        <div class="analise__feedback">
          <label class="analise__feedback-pergunta" for={`${analise.id}-comentario`}>
            O que faltou ou veio errado?
          </label>
          <textarea
            id={`${analise.id}-comentario`}
            class="analise__comentario"
            rows={3}
            maxLength={LIMITE_COMENTARIO}
            value={feedback.comentario}
            disabled={feedback.enviando}
            onInput={(evento) =>
              registrarFeedback(analise.id, { comentario: evento.currentTarget.value })
            }
          />
          <div class="analise__feedback-acoes">
            <Botao
              variante="secundario"
              tamanho="compacto"
              desabilitado={feedback.enviando}
              carregando={feedback.enviando}
              onClick={() =>
                mandarFeedback(analise, -1, feedback.comentario.trim() || null)
              }
            >
              Enviar
            </Botao>
            <Botao
              variante="fantasma"
              tamanho="compacto"
              desabilitado={feedback.enviando}
              onClick={() => registrarFeedback(analise.id, { modo: 'inicial', erro: null })}
            >
              Cancelar
            </Botao>
          </div>
          {feedback.erro && <AvisoFalha mensagem={feedback.erro} />}
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
            onClick={() => mandarFeedback(analise, 1, null)}
          >
            Sim
          </Botao>
          <Botao
            variante="fantasma"
            tamanho="compacto"
            desabilitado={feedback.enviando}
            onClick={() => registrarFeedback(analise.id, { modo: 'comentario', erro: null })}
          >
            Não
          </Botao>
        </div>
        {feedback.erro && <AvisoFalha mensagem={feedback.erro} />}
      </div>
    );
  };

  const renderAnalise = (analise) => {
    const textoFinal =
      typeof analise.texto?.texto === 'string' && analise.texto.texto ? analise.texto : null;
    const metadados = [];
    if (analise.fim && Number.isFinite(Number(analise.fim.rodadas))) {
      metadados.push(textoRodadas(analise.fim.rodadas));
    }
    if (analise.fim && Number.isFinite(Number(analise.fim.ms))) {
      metadados.push(textoSegundos(analise.fim.ms));
    }

    return (
      <Cartao key={analise.id} titulo={analise.pergunta} className="analise__cartao">
        {renderPassos(analise)}

        {analise.status === 'correndo' && analise.blocos.length === 0 && !textoFinal && (
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

        {analise.blocos.map((bloco, indice) => (
          <BlocoAnalise
            key={bloco?.id || `bloco-${indice}`}
            bloco={bloco}
            onOrigem={abrirOrigem}
          />
        ))}

        {analise.blocoInvalido && (
          <p class="analise__bloco-invalido">
            Um bloco veio em formato inválido e foi omitido.
          </p>
        )}

        {analise.status === 'parada' && (
          <p class="analise__nota">Você parou a análise.</p>
        )}

        {analise.status === 'correndo' && (
          <p class="analise__tempo">{textoTempoDecorrido(analise.segundos)}</p>
        )}

        {renderAviso(analise)}

        {analise.status !== 'correndo' && (
          <footer class="analise__rodape">
            {metadados.length > 0 && (
              <p class="analise__meta">{metadados.join(' · ')}</p>
            )}
            {renderFeedback(analise)}
          </footer>
        )}
      </Cartao>
    );
  };

  return (
    <div class="conteudo analise">
      <CabecalhoPagina
        titulo="Análise"
        contexto="Pergunte sobre os centros. Todo número abre a origem."
        acoes={
          analises.length > 0 ? (
            <Botao variante="secundario" onClick={novaAnalise}>
              Nova análise
            </Botao>
          ) : null
        }
      />

      <Cartao className="analise__pergunta-cartao">
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
            disabled={Boolean(correndoId)}
            onInput={(evento) => setPergunta(evento.currentTarget.value)}
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
            As perguntas ficam guardadas para melhorar a Análise. Limite de 50 perguntas por dia.
          </p>

          <div class="analise__acoes">
            {correndoId ? (
              <Botao variante="secundario" onClick={parar}>
                Parar
              </Botao>
            ) : (
              <Botao variante="primario" tipo="submit" desabilitado={!podeEnviar}>
                Perguntar
              </Botao>
            )}
          </div>

          {analises.length === 0 && (
            <div class="analise__sugestoes" aria-label="Sugestões de pergunta">
              {SUGESTOES.map((sugestao) => (
                <Chip
                  key={sugestao}
                  onClick={() => {
                    setPergunta(sugestao);
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

      {analises.length === 0 && (
        <Vazio mensagem="Faça a primeira pergunta para ver os números com a origem de cada um." />
      )}

      <div class="analise__lista">{analises.map(renderAnalise)}</div>

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
