# Tarefa: a Análise passa a rodar numa Edge Function do Supabase

> Escrita pelo Claude em 25/11/2026. Executor: DeepSeek V4.1 Flash max, no worktree `C:/Users/amara/dev/cf-edge`
> (branch `redesenho/analise-edge`, a partir de `redesenho/analise-bancada`). Leia antes: `AGENTS.md`,
> `docs/aplicar-migracao.md` (restrições do cofre), `worker/README.md`, `docs/redesenho/analise-contrato.md` §7,
> `docs/redesenho/analise-plano.md` §1-2 (a decisão de 25/11 está lá), `supabase/functions/assistente/`
> (a Edge Function que já existe, como modelo de Deno.serve, CORS e segredo) e `worker/bancada/`.

## Por quê

O Cloudflare gratuito limita a 50 subrequests por requisição; a bancada mediu até 34 numa pergunta "em
todos os centros" e o Victor não vai pagar o plano. A Edge Function do Supabase gratuita aceita 150 s por
requisição e 2 s de CPU, sem teto de chamadas documentado. **O laço continua no servidor, igual**: só muda
onde ele roda. Nenhuma regra do Worker muda (tetos, prazo de 120 s, encerrador, máscara, eventos SSE,
mensagens de erro, CORS, sem log).

## O que fazer

1. **Núcleo sem plataforma.** Separe de `worker/src/index.js` uma função `tratar(request, env, deps)` (em
   `worker/src/nucleo.js` ou equivalente) que não use nada do Cloudflare: o contador diário entra por
   `deps.contador` (interface `consumir({ userId, jwt, prazo, sinal }) → { permitido, codigo?, usado, teto,
   mensagem? }`, a mesma forma que `limite.js` devolve hoje) e o `waitUntil` entra por `deps.waitUntil`
   (opcional: sem ele, a promessa só é descartada com a rejeição tratada). O `export default { fetch }` do
   Cloudflare continua funcionando, agora como uma entrada fina com o contador de KV de hoje. Todos os testes
   de `worker/tests/` continuam passando (ajuste só o que for importação).
2. **Contador por tabela: migração `database/071_analise_uso.sql`.** Tabela `analise_uso (user_id uuid,
   dia date, usadas int not null, primary key (user_id, dia))`, RLS ligado **sem policy**, `revoke all` de
   `public`/`anon`/`authenticated`, `trg_bloqueia_agente` (molde da 051/068). RPC `analise_consumir()`
   `security definer`, `set search_path = public, pg_temp`, guard (`auth.uid()` não nulo e `not is_agente()`),
   `grant execute` só a `authenticated`: num só comando, faz o upsert `usadas = usadas + 1` do dia de hoje
   **no fuso de Brasília** e devolve `{ dia, usadas }`; apaga as linhas do próprio usuário com `dia` mais
   antigo que ontem. **O teto não é parâmetro** (quem compara com o teto é a Edge Function; chamar a RPC por
   fora só gasta a cota de quem chamou). Asserções no fim do `.sql`; respeite as restrições do cofre
   (`docs/aplicar-migracao.md`). Roteiro `tests/sql/test_071_analise_uso.sql` e
   `tools/replica-local/rodar-071-pglite.mjs` no molde do `rodar-070-pglite.mjs`: prova a ausência antes,
   idempotência, atomicidade (duas chamadas seguidas = 2), virada do dia em Brasília, usuário A não toca a
   linha de B, anon recusado, agente recusado, BLOCO 1 do `tests/sql/test_051_buriti_propostas.sql`, ACL e
   atributos; pelo menos 5 mutantes (sem RLS, grant a anon, sem guard do agente, dia em UTC, teto como
   parâmetro aceito). Acrescente a linha em `docs/migracoes.md`.
   O contador da Edge Function (`worker/src/contador-rpc.js` ou equivalente) chama a RPC com o JWT de quem
   perguntou e o mesmo prazo/sinal; falha da RPC = recusa com a mesma mensagem genérica de hoje, nunca
   "permitido" por padrão.
3. **Entrada da Edge Function: `supabase/functions/analise/`.** `Deno.serve` chamando `tratar` com
   `Deno.env` (`SUPABASE_URL` e `SUPABASE_ANON_KEY` já existem no ambiente das Edge Functions; `OLLAMA_API_KEY`
   é o mesmo segredo que a `assistente` já usa; `ANALISE_MODELO`, `ANALISE_PAPEIS`, `ANALISE_LIMITE_DIA` com os
   padrões de hoje) e `EdgeRuntime.waitUntil` quando existir. O deploy do Supabase empacota só o que está em
   `supabase/functions/`: gere o código num arquivo único com o esbuild que já vem em `worker/node_modules`
   (script `npm --prefix worker run build:edge`, saída em `supabase/functions/analise/`; o arquivo gerado
   **não** é versionado, vai no `.gitignore`) e escreva `supabase/functions/analise/README.md` com o deploy
   (`npx supabase functions deploy analise --project-ref <ref>`, sem Docker, como a `assistente`). Um teste
   confere que o build roda e que o arquivo gerado exporta o que a entrada precisa. Se conseguir rodar Deno
   (`npx -y deno@2`, o pacote oficial), rode a entrada com um `fetch` falso e conte isso no relatório; se não,
   diga que não rodou.
4. **Bancada.** `worker/bancada/` passa a rodar o `tratar` com o contador por RPC (o roteador responde
   `analise_consumir` com um contador em memória) e **conta as chamadas externas por pergunta** (modelo +
   RPC + auth + contador), com a coluna no relatório e um aviso acima de 40. Os modos e checagens de hoje
   continuam.

## Arquivos

Pode criar/editar: `worker/src/**`, `worker/tests/**`, `worker/bancada/**`, `worker/package.json`,
`worker/README.md`, `supabase/functions/analise/**`, `database/071_analise_uso.sql`,
`tests/sql/test_071_analise_uso.sql`, `tools/replica-local/rodar-071-pglite.mjs`, `docs/migracoes.md` (só a
linha da 071), `.gitignore`, `docs/redesenho/relatorios/analise-edge.md`. **Não mexa** em `shared/ai-tools/`,
`supabase/functions/assistente/`, `app/`, `frontend/`, nem nas outras migrações e docs.

## O que não fazer

Não aplicar migração, não publicar (nem Worker nem Edge Function), não fazer login, não chamar a produção
nem o Ollama de verdade, não fazer push, não chamar outras IAs. Não corrigir os achados da revisão
(`relatorios/revisao-pre-etapa2.md`): eles vêm numa rodada própria, depois desta.

## Pronto quando

- `npm --prefix worker test`, `npm test`, `npm run lint` verdes; o roteiro PGlite da 071 verde com os mutantes
  pegos; `npm --prefix worker run build:edge` gera a entrada.
- A bancada em modo roteiro com o retrato de exemplo passa e mostra a contagem de chamadas.
- Relatório `docs/redesenho/relatorios/analise-edge.md`: o que mudou, o que **não** mudou no comportamento,
  testes (números), mutantes, se o Deno rodou, e o que só se prova publicando (limite não documentado de
  fetch, `request.signal` na desconexão, SSE pelo gateway do Supabase).
- Um commit `feat(analise): laço da Análise como Edge Function do Supabase; contador em tabela (071)`.
