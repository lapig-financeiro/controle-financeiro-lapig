// Edge Function: analise
//
// O laço de ferramentas da Análise (F5) roda AQUI, não no navegador. A regra
// inteira (rotas, CORS, prazo de 120 s, tetos, SSE, encerrador) está em
// `worker/src/nucleo.js`, empacotada ao lado em `nucleo.gerado.js` por
// `npm --prefix worker run build:edge`. O arquivo gerado não é versionado.
//
// Por que a Edge Function substituiu o Worker da Cloudflare (25/11/2026): o
// plano gratuito da Cloudflare limita a 50 subrequests por requisição, e uma
// pergunta "em todos os centros" chegou a 34. O Supabase aceita 150 s por
// requisição e 2 s de CPU (espera de rede não conta), sem teto de chamadas
// documentado. O servidor continua sendo o único lugar com a OLLAMA_API_KEY.
//
// Contador: a tabela `analise_uso` (migração 071) e a RPC `analise_consumir()`,
// chamada com o JWT de quem perguntou. O teto (ANALISE_LIMITE_DIA, padrão 50)
// é comparado aqui; a RPC só incrementa e devolve { dia, usadas }.
//
// Segredos/variáveis: SUPABASE_URL e SUPABASE_ANON_KEY já existem no ambiente
// das Edge Functions; OLLAMA_API_KEY é o mesmo segredo da `assistente`;
// ANALISE_MODELO, ANALISE_PAPEIS e ANALISE_LIMITE_DIA são opcionais.

import {
  criarContadorRpc,
  normalizarCaminhoEdge,
  tetoDoAmbiente,
  tratar,
} from "./nucleo.gerado.js";

// Dentro do Supabase o caminho chega sem `/functions/v1` e com o nome da
// função (`/analise`, `/analise/saude`). O núcleo continua com `/analise` e
// `/saude`; esta é a única tradução. O resto do caminho fica como está.
function normalizarRequisicao(request: Request): Request {
  const url = new URL(request.url);
  const caminho = normalizarCaminhoEdge(url.pathname);
  if (caminho === url.pathname) return request;

  url.pathname = caminho;
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  };
  // Corpo em stream exige `duplex`; requisições sem corpo (GET/OPTIONS) não.
  if (request.body) init.duplex = "half";
  return new Request(url, init);
}

const env = {
  SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
  SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
  OLLAMA_API_KEY: Deno.env.get("OLLAMA_API_KEY"),
  ANALISE_MODELO: Deno.env.get("ANALISE_MODELO"),
  ANALISE_PAPEIS: Deno.env.get("ANALISE_PAPEIS"),
  ANALISE_LIMITE_DIA: Deno.env.get("ANALISE_LIMITE_DIA"),
};

const teto = tetoDoAmbiente(env.ANALISE_LIMITE_DIA);

Deno.serve(async (request: Request) => {
  const contador = criarContadorRpc({
    supabaseUrl: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    teto,
  });

  // No Supabase o `EdgeRuntime.waitUntil` existe; em Deno puro não. Sem ele, a
  // promessa do laço roda solta (o núcleo trata a rejeição), mas o runtime pode
  // encerrar antes do `fim` — por isso o deploy é sempre no Supabase.
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  const waitUntil =
    runtime && typeof runtime.waitUntil === "function"
      ? (promessa: Promise<unknown>) => runtime.waitUntil!(promessa)
      : undefined;

  return tratar(normalizarRequisicao(request), env, {
    contador,
    waitUntil,
    // Só aparece se o contador não for montado; mantém a mensagem própria da
    // Edge Function (o Worker passa a dele).
    mensagemSemContador: "O limite de uso não está configurado no servidor.",
  });
});
