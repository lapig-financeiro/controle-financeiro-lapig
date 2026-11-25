/* ============================================================
   Worker da Análise (F5) — contrato §7
   ============================================================
   Rotas:
     OPTIONS *      → CORS, sem autenticar
     GET  /saude    → { ok: true }
     POST /analise  → text/event-stream com passo/bloco/texto/fim/erro

   O Worker é o único lugar onde a OLLAMA_API_KEY existe. Ele valida
   o JWT no Supabase, confere o papel em `app_users`, conta o uso no
   KV e roda o laço. As RPCs são chamadas com o JWT de quem
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
import { consumir, diaBrasilia, tetoDoAmbiente } from './limite.js';
import { criarRpc } from './rpc.js';
import { ErroModelo, executarLaco } from './laco.js';
import { CABECALHOS_SSE, criarEmissor } from './sse.js';
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
    headers['Access-Control-Allow-Headers'] = 'authorization, content-type';
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

  let total = 0;
  const partes = [];

  try {
    while (true) {
      if (sinal?.aborted) {
        await leitor.cancel().catch(() => {});
        return { cancelado: true };
      }
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await leitor.cancel().catch(() => {});
        return { excedeu: true };
      }
      partes.push(value);
    }
  } catch {
    return { erro: 'A leitura do corpo falhou.' };
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
async function rodarAnalise({
  corpo,
  env,
  jwt,
  inicio,
  prazo,
  estado,
  emitir,
  finalizar,
  sinal,
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
    if (auth.codigo === 'abortado') return;
    if (auth.codigo === 'tempo') {
      await finalizar('tempo', MENSAGEM_TEMPO);
      return;
    }
    await emitir('erro', { codigo: auth.codigo, mensagem: auth.mensagem });
    return;
  }

  // ── Limite do dia ───────────────────────────────────────────────────────
  if (!env.ANALISE_USO) {
    await emitir('erro', {
      codigo: 'interno',
      mensagem: 'O limite de uso não está configurado no Worker.',
    });
    return;
  }

  const uso = await consumir({
    kv: env.ANALISE_USO,
    userId: auth.usuario.id,
    teto: tetoDoAmbiente(env.ANALISE_LIMITE_DIA),
    prazo,
    sinal,
  });
  if (!uso.permitido) {
    if (uso.codigo === 'abortado') return;
    if (uso.codigo === 'tempo') {
      await finalizar('tempo', MENSAGEM_TEMPO);
      return;
    }
    await emitir('erro', {
      codigo: uso.codigo === 'limite' ? 'limite' : 'interno',
      mensagem: uso.mensagem,
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
    if (sinal?.aborted) return;
    if (Date.now() >= prazo) {
      await finalizar('tempo', MENSAGEM_TEMPO);
      return;
    }
    await emitir('erro', {
      codigo: 'interno',
      mensagem: 'O pacote de ferramentas da Análise não carregou.',
    });
    return;
  }

  return executarLaco({
    sessao,
    chamarModelo: criarChamador(env),
    emitir,
    instrucoes: INSTRUCOES,
    pergunta: corpo.pergunta,
    anteriores: corpo.anteriores,
    hoje,
    tools,
    inicio,
    prazo,
    estado,
    sinal,
  });
}

async function analisar(request, env, ctx, origem) {
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
  const emissor = criarEmissor(fluxo.writable);
  const controle = new AbortController();

  // Cliente que fecha a aba aborta o laço; a escrita também derruba (o emissor
  // chama `abortar` quando o write rejeita). Duas detecções porque no Worker
  // nem sempre a primeira chega antes do próximo fetch.
  if (request.signal) {
    if (request.signal.aborted) controle.abort();
    else request.signal.addEventListener('abort', () => controle.abort(), { once: true });
  }

  const estado = { rodadas: 0, ferramentas: 0 };
  let terminal = false;

  const emitir = async (nome, dados) => {
    if (terminal) return false;
    const ok = await emissor.emitir(nome, dados);
    if (!ok) {
      controle.abort();
      terminal = true;
    }
    return ok;
  };

  const finalizar = async (codigo, mensagem) => {
    if (terminal) return false;
    terminal = true;
    controle.abort();
    await emissor.emitir('erro', { codigo, mensagem });
    await emissor.emitir('fim', { rodadas: estado.rodadas, ms: Date.now() - inicio });
    await emissor.fechar();
    return true;
  };

  // Watchdog do prazo: fecha o stream mesmo que a chamada pendurada ignore o
  // AbortSignal. Os timeouts por chamada são o primeiro freio; este é o último.
  const relogioPrazo = setTimeout(
    () => {
      void finalizar('tempo', MENSAGEM_TEMPO);
    },
    Math.max(0, prazo - Date.now()),
  );

  const tarefa = rodarAnalise({
    corpo: validado,
    env,
    jwt: extrairJwt(request.headers.get('Authorization')),
    inicio,
    prazo,
    estado,
    emitir,
    finalizar,
    sinal: controle.signal,
  })
    .catch(async () => {
      // Última barreira. Sem detalhe da exceção: ela pode carregar conteúdo.
      await finalizar('interno', 'A análise falhou por um erro interno. Tente de novo.');
    })
    .finally(async () => {
      clearTimeout(relogioPrazo);
      await emissor.fechar();
    });

  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(tarefa);
  else void tarefa; // teste isolado sem ctx: a promessa roda, só não é segurada

  return new Response(fluxo.readable, {
    status: 200,
    headers: { ...CABECALHOS_SSE, ...cabecalhosCors(origem) },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origem = request.headers.get('Origin');

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
      return analisar(request, env, ctx, origem);
    }

    return json({ erro: 'Não encontrado.' }, 404, origem);
  },
};
