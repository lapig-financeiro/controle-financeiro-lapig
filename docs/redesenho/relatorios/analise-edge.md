# Análise na Edge Function do Supabase — 25/11/2026

> Executor: DeepSeek V4.1 Flash max, no worktree `C:/Users/amara/dev/cf-edge`
> (branch `redesenho/analise-edge`). Tarefa: `docs/redesenho/tarefas/analise-edge.md`.
> Nada foi publicado nem aplicado em produção.

## O que mudou

- **Núcleo sem plataforma.** `worker/src/nucleo.js` passou a ter
  `tratar(request, env, deps)`, com a regra inteira (rotas, CORS, prazo único de
  120 s, watchdog, tetos, SSE, encerrador, corpo, máscara e mensagens). O
  contador entra por `deps.contador.consumir({ userId, jwt, prazo, sinal })`;
  o `waitUntil` entra por `deps.waitUntil` (sem ele, a promessa roda solta com a
  rejeição tratada). Nada no núcleo conhece Cloudflare.
- **Worker da Cloudflare continua igual por fora.** `worker/src/index.js`
  virou uma entrada fina: monta o contador de KV (`criarContadorKv`, o mesmo
  `consumir` de `limite.js`) e o `ctx.waitUntil`. O `export default { fetch }`
  e as rotas são os mesmos.
- **Contador por RPC.** `worker/src/contador-rpc.js` chama
  `POST /rest/v1/rpc/analise_consumir` com o JWT de quem perguntou e o
  `apikey` público, dentro do prazo/sinal do pedido. Compara `usadas` com o
  teto; falha de RPC, corpo inválido, HTTP != 200, rede ou prazo recusam com a
  mensagem genérica de hoje — nunca "permitido" por padrão.
- **Migração 071.** `database/071_analise_uso.sql` cria `analise_uso`
  (`user_id`, `dia`, `usadas`, PK `(user_id, dia)`), RLS ligado **sem policy**,
  `revoke all` de `public`/`anon`/`authenticated` e `trg_bloqueia_agente` de
  statement sem WHEN. Helper interno `_analise_dia_brasilia(timestamptz)`
  (SQL puro, `immutable`, sem grant) resolve o dia civil de Brasília. RPC
  `analise_consumir()` `security definer`, `search_path` fixo, guarda
  `auth.uid()` não nulo e `not is_agente()`; upsert atômico
  `usadas = usadas + 1` do dia, retorno `{ dia, usadas }` e limpeza das linhas
  do próprio usuário mais antigas que ontem. **O teto não é parâmetro**; quem
  compara é a Edge Function.
- **Entrada Deno.** `supabase/functions/analise/index.ts` chama `tratar` com
  `Deno.env`, cria o contador por RPC e usa `EdgeRuntime.waitUntil` quando
  existir. `supabase/functions/analise/README.md` tem o deploy sem Docker, como
  a `assistente`.
- **Bundle.** `npm --prefix worker run build:edge` (script em
  `worker/src/build-edge.mjs`) empacota `worker/src/edge.js` +
  `shared/ai-tools` num único ESM em
  `supabase/functions/analise/nucleo.gerado.js` (140.438 bytes nesta execução).
  O arquivo é gerado antes do deploy e **não é versionado** (`.gitignore`).
- **Bancada.** `worker/bancada/` roda o `tratar` com o contador por RPC; o
  roteador responde `analise_consumir` com um contador em memória. O relatório
  ganhou a coluna **Chamadas externas** (modelo + RPC + auth + contador) e um
  aviso acima de 40, no console e no relatório (o aviso não reprova).
- **Docs.** Linha da 071 em `docs/migracoes.md`; `worker/README.md` com o
  núcleo, as duas entradas, o contador por RPC, o build e a bancada.

## O que **não** mudou

- O contrato §7: eventos `passo`, `bloco`, `texto`, `fim`, `erro`; os mesmos
  códigos de erro e as mesmas mensagens; auth recusada como evento dentro do
  stream; corpo inválido como 400 antes do stream; 413/408 do corpo; CORS só
  para o Pages e `localhost`; nenhum log de pergunta, argumento, resultado,
  bloco ou texto.
- O prazo único de 120 s (timestamp passado a auth, contador, RPCs e modelo), o
  watchdog, o encerrador único do `fim`, o teto de 8 rodadas, 30 ferramentas e
  60.000 caracteres por resultado.
- O laço continua no servidor: máscara, blocos, `calcular` e tetos não foram
  para o navegador.
- As RPCs continuam sendo chamadas com o JWT da pessoa; o núcleo não tem
  `service_role`, não lê tabela direto e não faz conta financeira.
- O Worker publicado continua no ar; a Edge Function é aditiva até provar uma
  pergunta real.
- A regra de 50 perguntas por login por dia continua. A diferença de mecânica
  está abaixo.

### Duas diferenças de mecânica (deliberadas)

- No Worker, o KV não é atômico e uma recusa não incrementa (a 51ª tentativa
  deixa o KV em 50). Na Edge Function, a RPC é atômica e **sempre incrementa**:
  a 51ª pergunta é recusada, mas o contador vai a 51 (e a 52ª a 52). O modelo
  não é chamado; é freio de fatura, não segurança.
- O Worker usa o KV (`uso:<user_id>:<AAAA-MM-DD>`, TTL de 48 h); a Edge usa a
  tabela da 071, que mantém ontem e apaga o mais antigo que ontem.

## Testes (números)

- `npm --prefix worker test`: **13 arquivos, 150 testes, todos verdes**. Inclui
  `nucleo.test.js` (interface do contador, contador ausente, contador que
  lança), `contador-rpc.test.js` (51ª, HTTP 500, corpo inválido, rede, sem JWT,
  prazo) e `build-edge.test.js` (roda o build e importa o bundle).
- `npm test`: **52 arquivos, 858 passaram, 5 pulados (863)**. Para o backfill da
  064 rodar, foi necessário `npm --prefix mcp ci` (o `mcp/node_modules` não
  existia neste worktree; nada foi alterado em `mcp/`).
- `npm run lint`: **0 erros** em `frontend/js/`, `mcp/`, `app/`, `shared/`,
  `worker/src/` e `worker/tests/`.
- `node tools/replica-local/rodar-071-pglite.mjs`: **verde**, com:
  ausência antes (`42P01: relation "public.analise_uso" does not exist`),
  migração, roteiro, idempotência (reaplicar a 071 e o roteiro), ACL/atributos
  de `pg_proc`, BLOCO 1 da 051 (barreira em toda tabela de `public`) e
  **6 mutantes pegos**.
- `npm --prefix worker run build:edge`: gera
  `supabase/functions/analise/nucleo.gerado.js` (140.438 bytes) exportando
  `tratar`, `criarContadorRpc` e `tetoDoAmbiente`.
- Bancada em modo roteiro com o retrato de exemplo:
  **4/4 passaram**, com **9, 8, 8 e 9 chamadas externas** por pergunta
  (3 modelo + 3/2 RPC + 2 auth + 1 contador). O relatório mostra a coluna e a
  decomposição.
- **Deno rodou.** `npx -y deno@2` (2.9.6) executou a entrada
  `supabase/functions/analise/index.ts` com `fetch` falso para
  auth/app_users/`analise_consumir`/Ollama: `GET /saude` 200, `POST /analise`
  200 com `event: texto` e `event: fim`, sem `erro`, e `analise_consumir`
  chamada uma vez. O Deno avisou que, no comportamento legado, `request.signal`
  aborta em resposta bem-sucedida; o stream chegou inteiro no teste, mas isso
  é um dos pontos que só a publicação confirma.

### Mutantes da 071 (todos pegos)

1. **Sem RLS** (`disable row level security`) → `071 FALHOU: RLS desligado em analise_uso`.
2. **Grant de EXECUTE para anon** → `071 FALHOU: anon possui EXECUTE em analise_consumir`.
3. **Sem guarda do agente** (remove `not is_agente()`) → o gatilho ainda barra a
   escrita, mas a RPC teria gastado a cota; o roteiro exige que a recusa venha
   da guarda (`Acesso negado.`) e falha com o motivo certo.
4. **Dia em UTC** (troca `America/Sao_Paulo` por `UTC`) → falha na virada do
   dia (02:59 UTC ainda é 25/11 em Brasília).
5. **Teto como parâmetro** (`analise_consumir(p_teto integer default 50)`) →
   falha por não existir a assinatura de zero parâmetros.
6. **Delete da linha de outro usuário** (`where user_id <> v_user`) → o
   roteiro vê a linha antiga de B apagada por A.

## O que só se prova publicando

- **Limite de chamadas da Edge Function**: o desenho assume 150 s por
  requisição e 2 s de CPU (espera de rede não conta), sem teto documentado de
  `fetch`. A bancada mede as chamadas por pergunta (8–9 no exemplo, até 34 numa
  pergunta "em todos os centros" na medição que motivou a mudança), mas o
  limite real do Supabase só aparece com uma pergunta publicada.
- **`request.signal` na desconexão**: o núcleo trata o sinal como desconexão
  do cliente e aborta todos os `fetch`. No workerd isso dependia de
  `enable_request_signal`; no Deno 2.9.6 o modo legado aborta o sinal também no
  fim de uma resposta bem-sucedida. Só o runtime do Supabase (e um teste com a
  aba fechada no meio) diz qual comportamento vale.
- **SSE pelo gateway do Supabase**: o teste Deno prova o formato no processo,
  não que o gateway entregue os eventos sem buffer. Uma pergunta real com
  passos ao vivo é o teste.
- **CORS/preflight do gateway**: a função responde o preflight, mas o gateway
  pode acrescentar ou reescrever cabeçalhos; a tela real confirma.
- **Deploy**: `npx supabase functions deploy analise --project-ref <ref>` não
  foi rodado; o README tem o passo a passo e o `build:edge` obrigatório antes.
- **Ollama de verdade**: nenhuma chamada real ao modelo foi feita nesta tarefa;
  o `think: 'high'` e o tool calling continuam sendo os do Worker.

## O que ficou em aberto

- **Nada foi aplicado nem publicado**: a 071 não passou pelo cofre, a Edge
  Function não foi publicada e o Worker não foi alterado em produção.
- Os achados da revisão pré-Etapa 2 (`relatorios/revisao-pre-etapa2.md`) não
  foram corrigidos, conforme a tarefa.
- A 51ª pergunta na Edge incrementa o contador (documentado acima); se o Victor
  quiser o contador parado no teto, é uma mudança pequena na RPC ou no
  comparador, em outra rodada.
- O `mcp/node_modules` precisou ser instalado para o `npm test` da raiz passar;
  é ambiente, não mudança de código.
- A tela (`app/`) ainda não consome a Edge Function; isso é a Etapa 2, fora
  desta tarefa.
