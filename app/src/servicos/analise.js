/* ============================================================
   Análise (F5) — cliente do stream SSE e do feedback
   ============================================================
   A tela da Análise (Etapa 2) ainda não existe: este serviço é a
   porta única para ela. Faz o POST na Edge Function com o JWT da
   sessão, lê o SSE do começo ao fim e dispara um callback por
   evento (contrato §7 de docs/redesenho/analise-contrato.md):

     inicio  { registro }
     passo   { ferramenta, rotulo, estado, erro? }
     bloco   { id, tipo, ... }
     texto   { texto, semOrigem }
     erro    { codigo, mensagem }
     fim     { rodadas, ms }

   O ponto delicado é o corte silencioso: se o runtime matar a
   função, a rede cair ou o stream fechar sem `fim`, o que chegou
   não pode sumir. Nesse caso o serviço emite um erro local
   `interrompida` com a mensagem fixa e devolve o parcial
   (`registro`, `blocos`, `texto`) já recebido. Se foi a própria
   pessoa que parou (signal abortado), não há aviso de corte.

   Comentários `: ping`, linhas em branco, `\r\n`, eventos quebrados
   em vários chunks (inclusive no meio de um caractere UTF-8) e
   eventos desconhecidos são tolerados sem erro. Evento com JSON
   malformado é descartado: um defeito de rede no meio de um evento
   não pode derrubar a tela.

   Nada aqui vai para log: `console.*` continua sem pergunta,
   argumento, resultado ou texto.
   ============================================================ */

import { SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase.js';

export const MENSAGEM_INTERROMPIDA =
  'A análise foi interrompida pelo servidor antes de terminar. O que chegou até aqui está abaixo, incompleto. Tente de novo ou faça uma pergunta mais específica.';

export const URL_EDGE_ANALISE = `${SUPABASE_URL}/functions/v1/analise`;

const MENSAGEM_SEM_LOGIN = 'Faça login para usar a Análise.';
const MENSAGEM_REDE =
  'Não foi possível falar com a Análise. Verifique a conexão e tente de novo.';
const MENSAGEM_SEM_RESPOSTA = 'A Análise não respondeu. Tente de novo.';
const MENSAGEM_SEM_CORPO = 'A Análise respondeu sem corpo para ler. Tente de novo.';
const MENSAGEM_FEEDBACK = 'Não foi possível enviar o feedback.';

function erroHttp(status) {
  if (status === 401) return { codigo: 'sem_login', mensagem: MENSAGEM_SEM_LOGIN };
  if (status === 403) {
    return { codigo: 'sem_permissao', mensagem: 'Seu login não tem acesso à Análise.' };
  }
  if (status === 429) {
    return {
      codigo: 'limite',
      mensagem: 'Você chegou ao limite de perguntas de hoje. Tente de novo amanhã.',
    };
  }
  return {
    codigo: 'interno',
    mensagem: `A Análise não respondeu agora (HTTP ${status}). Tente de novo.`,
  };
}

async function resolverToken(token) {
  if (typeof token === 'string' && token.trim()) return token.trim();
  try {
    const { data } = await supabase.auth.getSession();
    const daSessao = data?.session?.access_token;
    return typeof daSessao === 'string' && daSessao.trim() ? daSessao.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Parser SSE incremental. Cada linha completa vai para `linha`; a linha em
 * branco fecha o evento. `fim` descarrega o que sobrou quando o stream fecha
 * sem a linha em branco final (evento completo, mas sem o delimitador).
 */
function criarParserSse(aoEvento) {
  let nome = '';
  let dados = [];

  function limpar() {
    nome = '';
    dados = [];
  }

  function despachar() {
    const evento = nome || 'message';
    const conteudo = dados.join('\n');
    limpar();
    if (conteudo !== '') aoEvento(evento, conteudo);
  }

  function linha(texto) {
    if (texto === '') {
      despachar();
      return;
    }
    if (texto.startsWith(':')) return; // comentário de sinal de vida

    const separador = texto.indexOf(':');
    const campo = separador === -1 ? texto : texto.slice(0, separador);
    let valor = separador === -1 ? '' : texto.slice(separador + 1);
    if (valor.startsWith(' ')) valor = valor.slice(1);

    if (campo === 'event') nome = valor;
    else if (campo === 'data') dados.push(valor);
    // `id` e `retry` não fazem parte do contrato: ignorados.
  }

  function fim() {
    if (nome !== '' || dados.length > 0) despachar();
  }

  return { linha, fim };
}

function criarProcessadorLinhas(parser) {
  let buffer = '';

  return {
    acrescentar(texto) {
      buffer += texto;
      let indice;
      while ((indice = buffer.indexOf('\n')) !== -1) {
        let linha = buffer.slice(0, indice);
        buffer = buffer.slice(indice + 1);
        if (linha.endsWith('\r')) linha = linha.slice(0, -1);
        parser.linha(linha);
      }
    },
    finalizar() {
      if (buffer) {
        const linha = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
        buffer = '';
        parser.linha(linha);
      }
      parser.fim();
    },
  };
}

function despacharEvento(nome, conteudo, estado, callbacks) {
  let dados;
  try {
    dados = JSON.parse(conteudo);
  } catch {
    return; // evento truncado ou com JSON inválido: descartado sem erro
  }

  switch (nome) {
    case 'inicio':
      estado.registro = dados?.registro ?? null;
      callbacks.onInicio?.(dados);
      break;
    case 'passo':
      callbacks.onPasso?.(dados);
      break;
    case 'bloco':
      estado.blocos.push(dados);
      callbacks.onBloco?.(dados);
      break;
    case 'texto':
      estado.texto = dados;
      callbacks.onTexto?.(dados);
      break;
    case 'erro':
      estado.erro = dados;
      callbacks.onErro?.(dados);
      break;
    case 'fim':
      estado.recebeuFim = true;
      estado.fim = dados;
      callbacks.onFim?.(dados);
      break;
    default:
      // Evento novo de uma versão futura do servidor: ignorado sem erro.
      break;
  }
}

/**
 * Executa uma pergunta na Edge Function da Análise e acompanha o stream.
 *
 * @param {object} opcoes
 * @param {string} opcoes.pergunta
 * @param {Array<{pergunta: string, resumo: string}>} [opcoes.anteriores]
 * @param {string} [opcoes.token] JWT; ausente, vem da sessão do Supabase.
 * @param {string} [opcoes.url]
 * @param {string} [opcoes.apikey]
 * @param {typeof fetch} [opcoes.fetchImpl]
 * @param {AbortSignal} [opcoes.signal]
 * @param {(dados: object) => void} [opcoes.onInicio]
 * @param {(dados: object) => void} [opcoes.onPasso]
 * @param {(dados: object) => void} [opcoes.onBloco]
 * @param {(dados: object) => void} [opcoes.onTexto]
 * @param {(dados: object) => void} [opcoes.onFim]
 * @param {(dados: object) => void} [opcoes.onErro] erro do servidor ou local
 *   (`sem_login`, `rede`, `interno`, `interrompida`)
 * @returns {Promise<{
 *   ok: boolean,
 *   erro?: object | null,
 *   interrompida?: boolean,
 *   abortada?: boolean,
 *   registro: string | null,
 *   blocos: object[],
 *   texto: object | null,
 *   fim?: object | null,
 * }>} `registro`, `blocos` e `texto` mantêm o que chegou mesmo no corte e no
 *   aborto; `texto` é o último evento `texto` (`{ texto, semOrigem }`).
 */
export async function executarAnalise({
  pergunta,
  anteriores = [],
  token,
  url = URL_EDGE_ANALISE,
  apikey = SUPABASE_KEY,
  fetchImpl = fetch,
  signal,
  atraso,
  onInicio,
  onPasso,
  onBloco,
  onTexto,
  onFim,
  onErro,
} = {}) {
  // Modo exemplo (`npm run dev:exemplo`): o mesmo stream, simulado pelo
  // módulo sintético carregado sob demanda. Em produção o `import()` é
  // eliminado pelo Vite, então nada do exemplo entra no bundle.
  if (import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo') {
    let modulo = null;
    try {
      modulo = await import('./analiseExemplo.js');
    } catch {
      const erro = {
        codigo: 'interno',
        mensagem: 'Não foi possível carregar a Análise de exemplo.',
      };
      onErro?.(erro);
      return { ok: false, erro, registro: null, blocos: [], texto: null };
    }
    return modulo.executarAnaliseExemplo({
      pergunta,
      anteriores,
      signal,
      atraso,
      onInicio,
      onPasso,
      onBloco,
      onTexto,
      onFim,
      onErro,
      mensagemInterrompida: MENSAGEM_INTERROMPIDA,
    });
  }

  const jwt = await resolverToken(token);
  if (!jwt) {
    const erro = { codigo: 'sem_login', mensagem: MENSAGEM_SEM_LOGIN };
    onErro?.(erro);
    return { ok: false, erro, registro: null, blocos: [], texto: null };
  }

  const estado = {
    registro: null,
    blocos: [],
    texto: null,
    erro: null,
    fim: null,
    recebeuFim: false,
  };
  const callbacks = { onInicio, onPasso, onBloco, onTexto, onFim, onErro };
  const parser = criarParserSse((nome, conteudo) =>
    despacharEvento(nome, conteudo, estado, callbacks)
  );
  const processador = criarProcessadorLinhas(parser);

  const parcial = () => ({
    registro: estado.registro,
    blocos: estado.blocos,
    texto: estado.texto,
  });

  let resposta;
  try {
    resposta = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ pergunta, anteriores }),
      signal,
    });
  } catch {
    if (signal?.aborted) {
      return { ok: false, abortada: true, ...parcial() };
    }
    const erro = { codigo: 'rede', mensagem: MENSAGEM_REDE };
    onErro?.(erro);
    return { ok: false, erro, ...parcial() };
  }

  if (!resposta || !resposta.ok) {
    const status = Number.isInteger(resposta?.status) ? resposta.status : 0;
    const erro = status ? erroHttp(status) : { codigo: 'interno', mensagem: MENSAGEM_SEM_RESPOSTA };
    if (status >= 400 && status < 500 && typeof resposta?.json === 'function') {
      try {
        const corpo = await resposta.json();
        if (typeof corpo?.erro === 'string' && corpo.erro.trim()) {
          erro.mensagem = corpo.erro.trim();
        }
      } catch {
        // Corpo não é JSON: mantém a mensagem padrão por status.
      }
    }
    onErro?.(erro);
    return { ok: false, erro, ...parcial() };
  }

  if (!resposta.body || typeof resposta.body.getReader !== 'function') {
    const erro = { codigo: 'interno', mensagem: MENSAGEM_SEM_CORPO };
    onErro?.(erro);
    return { ok: false, erro, ...parcial() };
  }

  let leitor;
  try {
    leitor = resposta.body.getReader();
  } catch {
    const erro = { codigo: 'interno', mensagem: MENSAGEM_SEM_CORPO };
    onErro?.(erro);
    return { ok: false, erro, ...parcial() };
  }

  const decodificador = new TextDecoder('utf-8');
  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      processador.acrescentar(decodificador.decode(value, { stream: true }));
    }
    processador.acrescentar(decodificador.decode());
    processador.finalizar();
  } catch {
    // Falha de leitura: abaixo vira `interrompida` (ou nada, se foi aborto).
  } finally {
    try {
      leitor.releaseLock();
    } catch {
      // O stream já estava fechado/abortado; não há o que liberar.
    }
  }

  if (estado.recebeuFim) {
    if (estado.erro) {
      return { ok: false, erro: estado.erro, ...parcial() };
    }
    return { ok: true, erro: null, ...parcial(), fim: estado.fim };
  }

  if (signal?.aborted) {
    return { ok: false, abortada: true, ...parcial() };
  }

  const erro = { codigo: 'interrompida', mensagem: MENSAGEM_INTERROMPIDA };
  onErro?.(erro);
  return { ok: false, interrompida: true, erro, ...parcial() };
}

/**
 * Mensagem de erro da RPC do feedback. Só os códigos escritos para a pessoa
 * (`22023` validação e `42501` acesso) passam; erro de infraestrutura vira a
 * mensagem genérica, como em `dados.js`.
 */
function mensagemDoErroFeedback(error) {
  const codigo = String(error?.code || '');
  const mensagem = typeof error?.message === 'string' ? error.message.trim() : '';
  if ((codigo === '22023' || codigo === '42501') && mensagem) return mensagem;
  return MENSAGEM_FEEDBACK;
}

/**
 * Envia nota (-1/1), motivo e/ou comentário para o registro da pergunta,
 * pela RPC `analise_feedback_enviar` (migração 074). Nunca lança erro de
 * banco: devolve `{ id, erro }`.
 *
 * @param {string} registro id do evento `inicio`
 * @param {{nota?: -1|1|null, motivo?: string|null, comentario?: string|null}} [feedback]
 * @param {{rpc?: Function}} [opcoes] `rpc` injetado nos testes
 * @returns {Promise<{id: string|null, erro: string|null}>}
 */
export async function enviarFeedback(
  registro,
  { nota = null, motivo = null, comentario = null } = {},
  { rpc } = {}
) {
  if (typeof registro !== 'string' || !registro.trim()) {
    return { id: null, erro: 'Registro da análise não informado.' };
  }

  // No modo exemplo o feedback é aceito localmente e não toca o banco.
  if (import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo') {
    return { id: registro.trim(), erro: null };
  }

  const chamar =
    typeof rpc === 'function' ? rpc : (nome, args) => supabase.rpc(nome, args);
  try {
    const { data, error } = await chamar('analise_feedback_enviar', {
      p_registro_id: registro.trim(),
      p_nota: nota,
      p_motivo: motivo,
      p_comentario: comentario,
    });

    if (error) {
      return { id: null, erro: mensagemDoErroFeedback(error) };
    }
    if (data === null || data === undefined) {
      return { id: null, erro: MENSAGEM_FEEDBACK };
    }
    return { id: data, erro: null };
  } catch {
    return { id: null, erro: MENSAGEM_FEEDBACK };
  }
}
