/* ============================================================
   Núcleo da Análise (F5) — contrato §7
   ============================================================
   Rotas:
     OPTIONS *      → CORS, sem autenticar
     GET  /saude    → { ok: true }
     POST /analise  → text/event-stream com passo/bloco/texto/fim/erro

   Este módulo não conhece Cloudflare nem Edge Function: o contador
   diário entra por `deps.contador` e o `waitUntil` por
   `deps.waitUntil`. As entradas finas (worker/src/index.js e
   supabase/functions/analise/) só montam essas duas peças.

   A OLLAMA_API_KEY existe no servidor, nunca no browser. O núcleo
   valida o JWT no Supabase, confere o papel em `app_users`, conta o
   uso e roda o laço. As RPCs são chamadas com o JWT de quem
   perguntou — o RLS vale exatamente como no site.

   Autenticação recusada sai como evento `erro` (`sem_login` /
   `sem_permissao`) dentro do stream, não como 401/403. Foi a
   escolha: a tela tem um caminho só para ler erro (o SSE), e o
   contrato §7 já lista esses dois códigos como eventos. Corpo
   inválido (JSON quebrado, pergunta vazia) continua sendo 400
   antes de abrir o stream, porque aí não há o que transmitir.

   2ª rodada: o prazo de 120 s começa no início do POST, antes da
   autenticação, e é um timestamp (`prazo`) passado a tudo. Um
   watchdog fecha o stream com `erro tempo` + `fim` mesmo se uma
   chamada pendurar; o AbortSignal da desconexão chega a todos os
   fetch. O corpo é lido com teto de 100.000 bytes durante a
   leitura, sem confiar no Content-Length.

   Nada aqui loga pergunta, argumento, resultado, bloco ou texto.
   ============================================================ */

import { criarSessao, especificacoes, INSTRUCOES } from '../../shared/ai-tools/index.js';
import { autenticar, extrairJwt, papeisPermitidos } from './auth.js';
import { diaBrasilia } from './limite.js';
import { criarRpc } from './rpc.js';
import { ErroModelo, executarLaco } from './laco.js';
import { CABECALHOS_SSE } from './sse.js';
import { criarEncerrador } from './encerrador.js';
import {
  PRAZO_PADRAO_MS,
  corrida,
  motivoDoAborto,
  sinalComPrazo,
} from './prazo.js';

const MAX_PERGUNTA = 2_000;
const MAX_ANTERIORES = 5;
const MAX_CORPO_BYTES = 100_000;
const TETO_MODELO_MS = 90_000;
const OLLAMA_ENDPOINT = 'https://ollama.com/api/chat';
const MODELO_PADRAO = 'deepseek-v4.1-flash:cloud';
const MENSAGEM_TEMPO =
  'A análise passou de 120 s e foi interrompida. Tente uma pergunta mais específica.';

// CORS do contrato §7, sem curinga: o Pages do projeto e o localhost de dev.
const ORIGENS_PERMITIDAS = Object.freeze([
  /^https:\/\/lapig-financeiro\.github\.io$/,
  /^http:\/\/localhost(?::\d{1,5})?$/,
]);

export function origemPermitida(origem) {
  return ORIGENS_PERMITIDAS.some((regex) => regex.test(origem));
}

function cabecalhosCors(origem) {
  const headers = { Vary: 'Origin' };
  if (origem && origemPermitida(origem)) {
    headers['Access-Control-Allow-Origin'] = origem;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] =
      'authorization, apikey, content-type, x-client-info';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function json(corpo, status, origem, extras = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...cabecalhosCors(origem),
      ...extras,
    },
  });
}

/** Valida o corpo sem olhar para nada além de `pergunta` e `anteriores`. */
function validarCorpo(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { erro: 'O corpo precisa ser um objeto JSON.' };
  }
  if (typeof corpo.pergunta !== 'string') {
    return { erro: 'Falta a pergunta.' };
  }
  const pergunta = corpo.pergunta.trim();
  if (!pergunta) return { erro: 'A pergunta está vazia.' };
  if (pergunta.length > MAX_PERGUNTA) {
    return { erro: `A pergunta passa de ${MAX_PERGUNTA} caracteres.` };
  }

  let anteriores = [];
  if (corpo.anteriores != null) {
    if (!Array.isArray(corpo.anteriores)) {
      return { erro: '"anteriores" precisa ser uma lista.' };
    }
    if (corpo.anteriores.length > MAX_ANTERIORES) {
      return { erro: `"anteriores" tem mais de ${MAX_ANTERIORES} itens.` };
    }
    anteriores = corpo.anteriores.map((item) => ({
      pergunta: typeof item?.pergunta === 'string' ? item.pergunta.slice(0, 500) : '',
      resumo: typeof item?.resumo === 'string' ? item.resumo.slice(0, 1_000) : '',
    }));
  }

  return { pergunta, anteriores };
}

/**
 * Lê o corpo com teto contado DURANTE a leitura. Não olha Content-Length:
 * um cabeçalho mentiroso (ou ausente, em chunked) não pode furar o teto.
 */
async function lerCorpoComTeto(request, maxBytes, sinal) {
  const leitor = request.body?.getReader?.();
  if (!leitor) return { erro: 'JSON inválido.' };

  // Corpo parado em `read()`: o aborto do prazo precisa cancelar o leitor, não
  // só fazer o `corrida` desistir da promessa.
  const aoCancelar = () => {
    void leitor.cancel().catch(() => {});
  };
  if (sinal) {
    if (sinal.aborted) aoCancelar();
    else sinal.addEventListener('abort', aoCancelar, { once: true });
  }

  let total = 0;
  const partes = [];

  try {
    while (true) {
      if (sinal?.aborted) {
        aoCancelar();
        return { cancelado: true };
      }
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Dispara o cancelamento e responde já; não espera o stream fechar.
        aoCancelar();
        return { excedeu: true };
      }
      partes.push(value);
    }
  } catch {
    return { erro: 'A leitura do corpo falhou.' };
  } finally {
    if (sinal) sinal.removeEventListener('abort', aoCancelar);
  }

  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) {
    bytes.set(parte, posicao);
    posicao += parte.byteLength;
  }

  let texto;
  try {
    texto = new TextDecoder().decode(bytes);
  } catch {
    return { erro: 'A leitura do corpo falhou.' };
  }

  try {
    return { corpo: JSON.parse(texto) };
  } catch {
    return { erro: 'JSON inválido.' };
  }
}

/** O único lugar que fala com o Ollama. Não loga nem repassa texto. */
function criarChamador(env, { fetchImpl = fetch, agora = Date.now } = {}) {
  const modelo = env.ANALISE_MODELO || MODELO_PADRAO;

  return async function chamarModelo({
    mensagens,
    tools,
    timeoutMs = TETO_MODELO_MS,
    prazo,
    sinal,
  }) {
    if (!env.OLLAMA_API_KEY) {
      throw new ErroModelo('A chave do modelo não está configurada no Worker.', 'interno');
    }

    const combo = sinalComPrazo({ sinal, prazo, tetoMs: timeoutMs, agora });

    const falhaDeSinal = () => {
      const codigo = motivoDoAborto({ sinal, prazo, agora });
      return codigo === 'abortado'
        ? new ErroModelo('A chamada ao modelo foi cancelada.', 'abortado')
        : new ErroModelo('O modelo não respondeu a tempo.', 'tempo');
    };

    try {
      const chamada = await corrida(
        Promise.resolve().then(() =>
          fetchImpl(OLLAMA_ENDPOINT, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: modelo,
              think: 'high',
              stream: false,
              messages: mensagens,
              tools,
            }),
            signal: combo.signal,
          }),
        ),
        { sinal: combo.signal },
      );

      if (chamada.erro === 'sinal') throw falhaDeSinal();
      if (chamada.erro) {
        if (combo.signal.aborted || chamada.causa?.name === 'AbortError') {
          throw falhaDeSinal();
        }
        throw new ErroModelo('Não foi possível falar com o modelo.', 'modelo');
      }

      const resposta = chamada.valor;
      if (!resposta.ok) {
        // Não lê o corpo do erro: ele pode repetir trecho do pedido, e este
        // caminho não tem para onde mandar isso. O status basta para a tela.
        throw new ErroModelo(`O modelo respondeu HTTP ${resposta.status}.`, 'modelo');
      }

      const leitura = await corrida(
        Promise.resolve().then(() => resposta.text()),
        { sinal: combo.signal },
      );
      if (leitura.erro === 'sinal') throw falhaDeSinal();
      if (leitura.erro) {
        if (combo.signal.aborted || leitura.causa?.name === 'AbortError') {
          throw falhaDeSinal();
        }
        throw new ErroModelo('A resposta do modelo foi interrompida.', 'modelo');
      }

      const texto = leitura.valor;
      if (typeof texto !== 'string' || !texto.trim()) {
        throw new ErroModelo('A resposta do modelo veio vazia.', 'modelo');
      }

      let dados;
      try {
        dados = JSON.parse(texto);
      } catch {
        throw new ErroModelo('A resposta do modelo não é JSON válido.', 'modelo');
      }

      if (!dados || typeof dados !== 'object' || !dados.message) {
        throw new ErroModelo('A resposta do modelo veio sem "message".', 'modelo');
      }

      if (sinal?.aborted) throw falhaDeSinal();
      if (prazo != null && agora() >= prazo) throw falhaDeSinal();
      return dados;
    } finally {
      combo.limpar();
    }
  };
}

/** Executa uma pergunta já validada, emitindo eventos até o fim ou o erro. */
// O sinal interno aborta por desconexão do cliente OU pelo watchdog do prazo.
// Só é desconexão quando o cliente saiu de verdade; senão o watchdog já está
// encerrando com `erro tempo` e esta chamada só se junta a ele (sem cortar o
// `fim` de quem ainda está lendo). Achado da conferência da 4ª rodada (Sol).
function encerrarAbortado(encerrar, sinalCliente) {
  if (sinalCliente?.aborted) return encerrar({ desconectado: true });
  return encerrar({ erro: { codigo: 'tempo', mensagem: MENSAGEM_TEMPO } });
}

async function rodarAnalise({
  corpo,
  env,
  jwt,
  inicio,
  prazo,
  estado,
  emitir,
  encerrar,
  sinal,
  sinalCliente,
  contador,
  mensagemSemContador,
}) {
  // ── Login e papel ───────────────────────────────────────────────────────
  const auth = await autenticar({
    jwt,
    supabaseUrl: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    papeis: papeisPermitidos(env.ANALISE_PAPEIS),
    prazo,
    sinal,
  });
  if (!auth.ok) {
    if (auth.codigo === 'abortado') {
      await encerrarAbortado(encerrar, sinalCliente);
      return;
    }
    if (auth.codigo === 'tempo') {
      await encerrar({ erro: { codigo: 'tempo', mensagem: MENSAGEM_TEMPO } });
      return;
    }
    await encerrar({ erro: { codigo: auth.codigo, mensagem: auth.mensagem } });
    return;
  }

  // ── Limite do dia ───────────────────────────────────────────────────────
  // `deps.contador` é a única porta: KV no Worker, RPC na Edge Function.
  // A interface é a mesma de `limite.js`; falha do contador nunca vira
  // "permitido" por padrão.
  if (!contador || typeof contador.consumir !== 'function') {
    await encerrar({
      erro: {
        codigo: 'interno',
        mensagem:
          typeof mensagemSemContador === 'string' && mensagemSemContador
            ? mensagemSemContador
            : 'O limite de uso não está configurado no servidor.',
      },
    });
    return;
  }

  let uso;
  try {
    uso = await contador.consumir({
      userId: auth.usuario.id,
      jwt,
      prazo,
      sinal,
    });
  } catch {
    uso = {
      permitido: false,
      codigo: 'interno',
      mensagem: 'Não foi possível contar o uso agora. Tente de novo em instantes.',
    };
  }
  if (!uso || typeof uso !== 'object' || typeof uso.permitido !== 'boolean') {
    uso = {
      permitido: false,
      codigo: 'interno',
      mensagem: 'Não foi possível contar o uso agora. Tente de novo em instantes.',
    };
  }
  if (!uso.permitido) {
    if (uso.codigo === 'abortado') {
      await encerrarAbortado(encerrar, sinalCliente);
      return;
    }
    if (uso.codigo === 'tempo') {
      await encerrar({ erro: { codigo: 'tempo', mensagem: MENSAGEM_TEMPO } });
      return;
    }
    await encerrar({
      erro: {
        codigo: uso.codigo === 'limite' ? 'limite' : 'interno',
        mensagem: uso.mensagem,
      },
    });
    return;
  }

  // ── Sessão do pacote e modelo ────────────────────────────────────────────
  const hoje = diaBrasilia();
  let sessao;
  let tools;
  try {
    const rpc = criarRpc({
      supabaseUrl: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      jwt,
      prazo,
      sinal,
    });
    sessao = criarSessao({ rpc, hoje });
    tools = especificacoes();
  } catch {
    if (sinal?.aborted) {
      await encerrarAbortado(encerrar, sinalCliente);
      return;
    }
    if (Date.now() >= prazo) {
      await encerrar({ erro: { codigo: 'tempo', mensagem: MENSAGEM_TEMPO } });
      return;
    }
    await encerrar({
      erro: {
        codigo: 'interno',
        mensagem: 'O pacote de ferramentas da Análise não carregou.',
      },
    });
    return;
  }

  return executarLaco({
    sessao,
    chamarModelo: criarChamador(env),
    emitir,
    encerrar,
    instrucoes: INSTRUCOES,
    pergunta: corpo.pergunta,
    anteriores: corpo.anteriores,
    hoje,
    tools,
    inicio,
    prazo,
    estado,
    sinal,
    sinalCliente,
  });
}

async function analisar(request, env, deps, origem) {
  // O prazo começa aqui, antes de ler o corpo e de autenticar.
  const inicio = Date.now();
  const prazo = inicio + PRAZO_PADRAO_MS;

  // ── Corpo, com teto contado durante a leitura ────────────────────────────
  const comboCorpo = sinalComPrazo({
    sinal: request.signal,
    prazo,
    tetoMs: PRAZO_PADRAO_MS,
  });

  let lido;
  try {
    lido = await corrida(lerCorpoComTeto(request, MAX_CORPO_BYTES, comboCorpo.signal), {
      sinal: comboCorpo.signal,
    });
  } finally {
    comboCorpo.limpar();
  }

  if (lido.erro === 'sinal') {
    return json({ erro: 'A requisição demorou demais ou foi cancelada.' }, 408, origem);
  }
  if (lido.erro) {
    return json({ erro: 'A leitura do corpo falhou.' }, 400, origem);
  }

  const corpoLido = lido.valor;
  if (corpoLido.cancelado) {
    return json({ erro: 'A requisição foi cancelada.' }, 408, origem);
  }
  if (corpoLido.excedeu) {
    return json(
      {
        erro:
          `O corpo da requisição passa de ` +
          `${MAX_CORPO_BYTES.toLocaleString('pt-BR')} bytes.`,
      },
      413,
      origem,
    );
  }
  if (corpoLido.erro) {
    return json({ erro: corpoLido.erro }, 400, origem);
  }

  const validado = validarCorpo(corpoLido.corpo);
  if (validado.erro) return json({ erro: validado.erro }, 400, origem);

  // ── SSE ──────────────────────────────────────────────────────────────────
  const fluxo = new TransformStream();
  const controle = new AbortController();
  const estado = { rodadas: 0, ferramentas: 0 };
  const encerrador = criarEncerrador({
    writable: fluxo.writable,
    estado,
    inicio,
    prazo,
    abortar: () => controle.abort(),
  });

  // Cliente que fecha a aba chama o encerrador no modo desconexão: nada mais
  // é escrito. A falha de escrita no emissor faz o mesmo caminho.
  if (request.signal) {
    if (request.signal.aborted) {
      void encerrador.encerrar({ desconectado: true });
    } else {
      request.signal.addEventListener(
        'abort',
        () => {
          void encerrador.encerrar({ desconectado: true });
        },
        { once: true },
      );
    }
  }

  // Watchdog do prazo: o encerrador é o dono único do fim, então este é só
  // mais um candidato; se o laço já encerrou, a chamada é ignorada.
  const relogioPrazo = setTimeout(
    () => {
      void encerrador.encerrar({
        erro: { codigo: 'tempo', mensagem: MENSAGEM_TEMPO },
      });
    },
    Math.max(0, prazo - Date.now()),
  );

  // A promessa entregue ao waitUntil resolve até prazo + 1 s, mesmo que a
  // sessão/marcarTexto/modelo pendure.
  let estourou = false;
  let relogioTarefa;
  const esperaTarefa = new Promise((resolve) => {
    relogioTarefa = setTimeout(
      () => {
        estourou = true;
        resolve();
      },
      Math.max(0, prazo + 1_000 - Date.now()),
    );
  });

  const tarefa = Promise.race([
    rodarAnalise({
      corpo: validado,
      env,
      jwt: extrairJwt(request.headers.get('Authorization')),
      inicio,
      prazo,
      estado,
      emitir: encerrador.emitir,
      encerrar: encerrador.encerrar,
      sinal: controle.signal,
      sinalCliente: request.signal,
      contador: deps.contador,
      mensagemSemContador: deps.mensagemSemContador,
    }),
    esperaTarefa,
  ])
    .catch(async () => {
      // Última barreira. Sem detalhe da exceção: ela pode carregar conteúdo.
      await encerrador.encerrar({
        erro: {
          codigo: 'interno',
          mensagem: 'A análise falhou por um erro interno. Tente de novo.',
        },
      });
    })
    .finally(async () => {
      clearTimeout(relogioPrazo);
      clearTimeout(relogioTarefa);
      await encerrador.encerrar(
        estourou ? { erro: { codigo: 'tempo', mensagem: MENSAGEM_TEMPO } } : {},
      );
    });

  if (typeof deps.waitUntil === 'function') deps.waitUntil(tarefa);
  else void tarefa; // sem waitUntil: a promessa roda, só não é segurada

  return new Response(fluxo.readable, {
    status: 200,
    headers: { ...CABECALHOS_SSE, ...cabecalhosCors(origem) },
  });
}

/**
 * Roteia a requisição. Só usa APIs web (Request/Response/TransformStream) e o
 * que vier em `deps`: `contador` (obrigatório para /analise), `waitUntil`
 * (opcional) e `mensagemSemContador` (opcional; padrão "no servidor", o Worker
 * passa a dele). Nada aqui depende do runtime que chamou.
 */
export async function tratar(request, env, deps = {}) {
  const url = new URL(request.url);
  const origem = request.headers.get('Origin');
  const dependencias = deps && typeof deps === 'object' ? deps : {};

  // Preflight não autentica; origem fora da lista é recusada sem chegar perto
  // do login.
  if (request.method === 'OPTIONS') {
    if (origem && !origemPermitida(origem)) {
      return json({ erro: 'Origem não permitida.' }, 403, origem);
    }
    return new Response(null, { status: 204, headers: cabecalhosCors(origem) });
  }

  if (origem && !origemPermitida(origem)) {
    return json({ erro: 'Origem não permitida.' }, 403, origem);
  }

  if (url.pathname === '/saude') {
    if (request.method !== 'GET') {
      return json({ erro: 'Use GET.' }, 405, origem, { Allow: 'GET' });
    }
    return json({ ok: true }, 200, origem);
  }

  if (url.pathname === '/analise') {
    if (request.method !== 'POST') {
      return json({ erro: 'Use POST.' }, 405, origem, { Allow: 'POST' });
    }
    return analisar(request, env, dependencias, origem);
  }

  return json({ erro: 'Não encontrado.' }, 404, origem);
}
