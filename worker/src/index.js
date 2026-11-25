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

   Nada aqui loga pergunta, argumento, resultado, bloco ou texto.
   ============================================================ */

import { criarSessao, especificacoes, INSTRUCOES } from '../../shared/ai-tools/index.js';
import { autenticar, extrairJwt, papeisPermitidos } from './auth.js';
import { consumir, diaBrasilia, tetoDoAmbiente } from './limite.js';
import { criarRpc } from './rpc.js';
import { ErroModelo, executarLaco } from './laco.js';
import { CABECALHOS_SSE, criarEmissor } from './sse.js';

const MAX_PERGUNTA = 2_000;
const MAX_ANTERIORES = 5;
const MAX_CORPO_BYTES = 100_000;
const OLLAMA_ENDPOINT = 'https://ollama.com/api/chat';
const MODELO_PADRAO = 'deepseek-v4.1-flash:cloud';

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

/** O único lugar que fala com o Ollama. Não loga nem repassa texto. */
function criarChamador(env, fetchImpl = fetch) {
  const modelo = env.ANALISE_MODELO || MODELO_PADRAO;

  return async function chamarModelo({ mensagens, tools, timeoutMs = 90_000 }) {
    if (!env.OLLAMA_API_KEY) {
      throw new ErroModelo('A chave do modelo não está configurada no Worker.', 'interno');
    }

    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), timeoutMs);

    try {
      const resposta = await fetchImpl(OLLAMA_ENDPOINT, {
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
        signal: controle.signal,
      });

      if (!resposta.ok) {
        // Não lê o corpo do erro: ele pode repetir trecho do pedido, e este
        // caminho não tem para onde mandar isso. O status basta para a tela.
        throw new ErroModelo(`O modelo respondeu HTTP ${resposta.status}.`, 'modelo');
      }

      let dados;
      try {
        dados = await resposta.json();
      } catch {
        throw new ErroModelo('A resposta do modelo não é JSON válido.', 'modelo');
      }

      if (!dados || typeof dados !== 'object' || !dados.message) {
        throw new ErroModelo('A resposta do modelo veio sem "message".', 'modelo');
      }
      return dados;
    } catch (e) {
      if (e instanceof ErroModelo) throw e;
      if (e?.name === 'AbortError') {
        throw new ErroModelo('O modelo não respondeu a tempo.', 'tempo');
      }
      throw new ErroModelo('Não foi possível falar com o modelo.', 'modelo');
    } finally {
      clearTimeout(relogio);
    }
  };
}

/** Executa uma pergunta já validada, emitindo eventos até o fim ou o erro. */
async function rodarAnalise({ corpo, env, jwt, emissor, abortar, sinal }) {
  const emitir = async (nome, dados) => {
    const ok = await emissor.emitir(nome, dados);
    if (!ok) abortar();
    return ok;
  };

  // ── Login e papel ───────────────────────────────────────────────────────
  const auth = await autenticar({
    jwt,
    supabaseUrl: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    papeis: papeisPermitidos(env.ANALISE_PAPEIS),
  });
  if (!auth.ok) {
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
  });
  if (!uso.permitido) {
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
    });
    sessao = criarSessao({ rpc, hoje });
    tools = especificacoes();
  } catch {
    await emitir('erro', {
      codigo: 'interno',
      mensagem: 'O pacote de ferramentas da Análise não carregou.',
    });
    return;
  }

  await executarLaco({
    sessao,
    chamarModelo: criarChamador(env),
    emitir,
    instrucoes: INSTRUCOES,
    pergunta: corpo.pergunta,
    anteriores: corpo.anteriores,
    hoje,
    tools,
    sinal,
  });
}

async function analisar(request, env, ctx, origem) {
  const declarado = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declarado) && declarado > MAX_CORPO_BYTES) {
    return json({ erro: 'O corpo da requisição é grande demais.' }, 413, origem);
  }

  let corpoBruto;
  try {
    corpoBruto = await request.json();
  } catch {
    return json({ erro: 'JSON inválido.' }, 400, origem);
  }

  const validado = validarCorpo(corpoBruto);
  if (validado.erro) return json({ erro: validado.erro }, 400, origem);

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

  const tarefa = rodarAnalise({
    corpo: validado,
    env,
    jwt: extrairJwt(request.headers.get('Authorization')),
    emissor,
    abortar: () => controle.abort(),
    sinal: controle.signal,
  })
    .catch(async () => {
      // Última barreira. Sem detalhe da exceção: ela pode carregar conteúdo.
      await emissor.emitir('erro', {
        codigo: 'interno',
        mensagem: 'A análise falhou por um erro interno. Tente de novo.',
      });
    })
    .finally(async () => {
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
