# Análise 1b — Cloudflare Worker `worker/` (25/11)

Worktree `C:/Users/amara/dev/cf-analise-b`, branch `redesenho/analise-1-b` (já criada a partir do `master`).
Relatório em `docs/redesenho/relatorios/analise-1b.md`, commit novo. **Sem push, sem `wrangler deploy`, sem
`wrangler login`, sem segredo real, sem chamar a produção nem o Ollama de verdade.** Outro executor faz em
paralelo o pacote `shared/ai-tools/`: não toque lá.

Leia antes, inteiros: `AGENTS.md`, `docs/redesenho/analise-plano.md` e **`docs/redesenho/analise-contrato.md`** (é a
especificação; §7 é o Worker, §4 e §6 a interface do pacote que você consome). Se algo do contrato estiver errado
ou impossível, pare e escreva no relatório em vez de inventar outra interface. Leia também
`supabase/functions/assistente/index.ts` (o proxy que existe hoje: tetos, CORS, formato do `/api/chat`) e
`frontend/js/ai/agent.js` (o laço de hoje: aceita `arguments` como objeto ou string, sem `id`).

## Para quê

A Análise do site novo manda a pergunta ao Worker com o JWT de quem está logado. O Worker roda o laço com o
DeepSeek no Ollama Cloud, chama as ferramentas do pacote (que chamam as RPCs **com o JWT da pessoa**, então o RLS
vale) e devolve passos e blocos por SSE. A chave do Ollama só existe no Worker.

## Arquivos (só estes)

- `worker/package.json` (próprio: `wrangler` e `vitest` como devDependencies; scripts `dev`, `test`),
  `worker/wrangler.toml` (nome `analise-lapig`, `main = "src/index.js"`, `compatibility_date` recente, KV
  `ANALISE_USO` com id de exemplo comentado, `[vars]` do contrato §7 sem segredo), `worker/.gitignore`
  (`.dev.vars`, `node_modules`, `.wrangler`), `worker/.dev.vars.exemplo` (só nomes, sem valor).
- `worker/src/index.js` — `export default { fetch }`: rotas, CORS, montagem.
- `worker/src/auth.js` — JWT (`/auth/v1/user`) e papel (`app_users`), contrato §7.
- `worker/src/limite.js` — KV por usuário e dia (fuso de Brasília).
- `worker/src/laco.js` — o laço; recebe `sessao`, `chamarModelo` e `emitir` **injetados** (é o que os testes usam).
- `worker/src/sse.js` — formatação dos eventos.
- `worker/src/rpc.js` — `rpc(nome, args)` com `fetch` em `<SUPABASE_URL>/rest/v1/rpc/<nome>` e o JWT da pessoa;
  devolve `{ data, error }` sem lançar.
- `worker/tests/*.test.js` e `worker/README.md` (rodar local, variáveis, o que o Worker não faz).
- `docs/redesenho/relatorios/analise-1b.md`.

O `index.js` importa `criarSessao`, `especificacoes` e `INSTRUCOES` de `../../shared/ai-tools/index.js`. Esse arquivo
**ainda não existe na sua branch** (o outro executor está fazendo); o Claude junta as duas depois. Por isso os
testes importam `laco.js`, `auth.js`, `limite.js`, `rpc.js` e `sse.js` diretamente, com uma sessão falsa que segue o
contrato §4, e não importam `index.js`. Teste o `index.js` só com `vi.mock` do pacote.

## O que fazer

1. **Rotas**: `OPTIONS *` (CORS, sem autenticar); `GET /saude` → `{ ok: true }`; `POST /analise` (contrato §7);
   o resto 404. CORS só para as origens do contrato.
2. **Autenticação e papel**: sem `Authorization` ou JWT inválido/vencido → evento `erro` `sem_login` (ou 401 antes de
   abrir o stream; escolha um e documente); papel fora de `ANALISE_PAPEIS` → `sem_permissao`. O `user_id` vem do
   `/auth/v1/user`, nunca do corpo.
3. **Limite**: 50 por dia (variável `ANALISE_LIMITE_DIA`, padrão 50), contado no início; acima → `limite`.
4. **Laço** (`laco.js`): mensagens `system` (`INSTRUCOES` + data de hoje), `anteriores` resumidas, pergunta. A cada
   rodada chama o modelo com `tools`; para cada `tool_call` (aceitar `arguments` objeto ou string JSON), emite
   `passo` início, executa (`criar_bloco` e `calcular` vão para a sessão; o resto para `sessao.executar`), emite
   `passo` fim/erro e, se for bloco aceito, `bloco` com `sessao.reidratar(bloco)`; o resultado (ou o erro) volta ao
   modelo como `{ role: 'tool', tool_name, content }`. Sem `tool_calls`: `sessao.marcarTexto(content)` → `texto`, e
   `fim`. Tetos do contrato §7; estourar → `erro` `tempo` ou `interno` com mensagem clara, e `fim`.
5. **Modelo**: `chamarModelo` faz `POST https://ollama.com/api/chat` com `Authorization: Bearer <OLLAMA_API_KEY>`,
   corpo do contrato §7, timeout por chamada. Erro HTTP ou JSON inválido → `erro` `modelo`. O texto do modelo
   nunca é repassado sem passar pela sessão.
6. **SSE**: `Content-Type: text/event-stream`, `Cache-Control: no-store`; o laço roda com `ctx.waitUntil` ou um
   `TransformStream`, sem bufferizar a resposta inteira. Se o cliente desconectar, pare o laço.
7. **Sem log de conteúdo**: nenhum `console.*` com pergunta, argumentos, resultado, bloco ou texto. Um teste
   espiona o `console` num laço completo e falha se aparecer qualquer trecho deles.
8. **CPU**: o plano gratuito da Cloudflare dá 10 ms de CPU por requisição (esperar `fetch` não conta). Evite
   `JSON.stringify` repetido de resultados grandes; meça no `wrangler dev` e anote no relatório.

## Testes exigidos (vitest, sem rede: `fetch` falso)

- CORS: origem permitida, origem recusada, `OPTIONS`.
- JWT ausente, inválido, vencido; papel `professor` recusado; `admin` aceito; `user_id` do corpo ignorado.
- Limite: 50ª passa, 51ª recusa; dia seguinte (fuso de Brasília, perto da meia-noite UTC) zera.
- Laço com modelo falso: pergunta → `listar_centros` → `criar_bloco` → texto final; ordem dos eventos;
  `arguments` como string; ferramenta com erro volta ao modelo e não derruba; bloco recusado volta como erro;
  modelo em laço infinito para no teto; resultado acima de 60.000 caracteres volta erro ao modelo; Ollama 500 e
  JSON inválido → `erro` `modelo`.
- `rpc.js`: manda o JWT da pessoa (nunca outra chave como `Authorization`), devolve `error` em 4xx/5xx sem lançar.
- Nada de conteúdo no `console` (item 7).
- **Mutantes** (descreva no relatório cada um e o teste que o pega): aceitar `user_id` do corpo; pular o papel;
  logar a pergunta; não contar o limite; repassar texto do modelo sem `marcarTexto`.

## Pronto quando

`npm --prefix worker test` verde; `npm --prefix worker run dev` sobe (com `.dev.vars` de exemplo, sem segredo real)
e `GET /saude` responde; `npm run lint` e `npm test` da raiz seguem verdes; relatório com decisões, medidas de CPU,
mutantes e desvios. Commit `feat(analise): Worker da Análise`.
