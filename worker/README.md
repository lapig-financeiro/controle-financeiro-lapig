# Worker da Análise (`worker/`)

O Worker que roda o laço de ferramentas da Análise (F5) e devolve os eventos por
SSE. O contrato está em [`docs/redesenho/analise-contrato.md`](../docs/redesenho/analise-contrato.md)
§7; o plano, em [`docs/redesenho/analise-plano.md`](../docs/redesenho/analise-plano.md).

Ele existe para guardar a `OLLAMA_API_KEY` fora do browser e para rodar um laço
que não cabe no navegador. Tudo o que ele consulta passa pelas RPCs do site,
**com o JWT de quem perguntou** — o RLS e os guards valem como na tela. O Worker
não tem `service_role` e não escreve no banco (só a RPC de cota, quando roda na
Edge Function).

## Onde o laço roda

A regra inteira está em `worker/src/nucleo.js` (`tratar(request, env, deps)`),
sem nada de Cloudflare. Duas entradas finas montam as peças do runtime:

- `worker/src/index.js` — Worker da Cloudflare: contador no KV `ANALISE_USO` e
  `ctx.waitUntil`;
- `supabase/functions/analise/index.ts` — Edge Function do Supabase: contador
  por RPC (`analise_consumir`, migração 071) e `EdgeRuntime.waitUntil`.

O Worker publicado continua até a Edge Function provar uma pergunta real. A
decisão de 25/11 e o motivo (limite de 50 subrequests da Cloudflare gratuita)
estão em `docs/redesenho/analise-plano.md` §2.

## Rotas

| Rota | O que faz |
|---|---|
| `OPTIONS *` | Preflight de CORS, sem autenticar |
| `GET /saude` | `{ ok: true }` |
| `POST /analise` | `Authorization: Bearer <JWT>` + `{ pergunta, anteriores? }` → `text/event-stream` |

Eventos do `/analise`: `passo`, `bloco`, `texto`, `fim`, `erro` (contrato §7).
Enquanto o stream está aberto, um comentário SSE `: ping` sai a cada 15 s
(constante `INTERVALO_PING_MS`) para manter a conexão viva; a tela ignora
comentários, então o contrato de eventos não muda. O ping para em qualquer
encerramento e nunca sai depois do `fim`; falha de escrita dele conta como
desconexão.
Um único **encerrador** é dono do fim: laço, watchdog, desconexão e exceção
chamam `encerrar`; só a primeira chamada vale, sai no máximo um `erro`, sempre
um `fim` e o stream fecha. A exceção é a desconexão do cliente: nada mais é
escrito. Autenticação recusada chega como evento `erro` (`sem_login` /
`sem_permissao`) + `fim` dentro do stream, não como 401/403: a tela tem um
caminho só para ler erro. Corpo inválido (JSON quebrado, pergunta vazia ou acima
de 2.000 caracteres) responde 400 antes de abrir o stream. O corpo é lido com
teto de **100.000 bytes contados durante a leitura** (sem confiar em
`Content-Length`): acima disso, o `cancel()` é disparado sem esperar e a resposta
é 413 antes de desserializar; um corpo parado em `read()` vira **408** no prazo,
cancelando o leitor.

CORS: só `https://lapig-financeiro.github.io` e `http://localhost:<porta>`.
Qualquer outra origem recebe 403, sem cabeçalho de liberação. Os cabeçalhos
liberados são `authorization, apikey, content-type, x-client-info` (o
`apikey`/`x-client-info` são os que o supabase-js manda na Edge Function).

## Rodar local

```bash
npm --prefix worker install
cp worker/.dev.vars.exemplo worker/.dev.vars   # preencha; .dev.vars não é versionado
npm --prefix worker run dev                    # http://localhost:8787
curl http://localhost:8787/saude               # {"ok":true}
```

O `.dev.vars.exemplo` tem só os nomes de propósito. Nenhuma chave real mora no
git. Para exercitar o `/analise` local sem chamar a produção, aponte
`SUPABASE_URL`/`SUPABASE_ANON_KEY` para um projeto de teste; com os valores do
`wrangler.toml` (que são os públicos do site) o Worker consulta a produção, mas
só depois de um login válido e dentro do RLS.

O `compatibility_date` é **2026-11-17**: é a data em que o workerd (1.20261123.1,
instalado em `worker/node_modules`) liga por padrão a compatibilidade
`enable_request_signal`, que faz `request.signal` abortar quando o cliente
desconecta. Sem ela, o fetch continuaria rodando para uma tela que já fechou.

## Variáveis e segredo

| Nome | Onde | Para quê |
|---|---|---|
| `SUPABASE_URL` | `[vars]` | URL do projeto (pública, a mesma do frontend) |
| `SUPABASE_ANON_KEY` | `[vars]` | Chave pública do Supabase (a mesma do frontend) |
| `ANALISE_MODELO` | `[vars]` | Modelo do Ollama; padrão `deepseek-v4.1-flash:cloud` |
| `ANALISE_PAPEIS` | `[vars]` | Papéis aceitos, separados por vírgula; padrão `admin` |
| `ANALISE_LIMITE_DIA` | `[vars]` | Perguntas por login por dia; padrão `50` |
| `OLLAMA_API_KEY` | **segredo** | `wrangler secret put OLLAMA_API_KEY` (quem põe é o Victor) |

O KV `ANALISE_USO` guarda só o contador (`uso:<user_id>:<AAAA-MM-DD>`, fuso de
Brasília, TTL de 48 h). Em produção, crie o namespace com
`wrangler kv namespace create ANALISE_USO` e troque o id de exemplo do
`wrangler.toml`. Em `wrangler dev` o KV é simulado localmente.

Na Edge Function não há KV: a tabela `analise_uso` (071) guarda
`(user_id, dia, usadas)` e a RPC `analise_consumir()` incrementa no dia de
Brasília. A própria RPC não conhece o teto; `worker/src/contador-rpc.js` compara
`usadas > ANALISE_LIMITE_DIA` e recusa. A RPC é atômica, mas conta também a
pergunta recusada (a 51ª grava 51): o freio de fatura continua, o número exibido
não. Falha da RPC recusa com a mensagem genérica — nunca deixa passar.

## Testes

```bash
npm --prefix worker test
```

Vitest, sem rede: `fetch`, KV, sessão e modelo são dublês. O `index.js` é
testado com `vi.mock` do pacote `shared/ai-tools`; os outros módulos são
testados direto. `nucleo.test.js` prova a interface do contador;
`contador-rpc.test.js`, a recusa por RPC; `build-edge.test.js` roda o
`build:edge` de verdade e confere que o bundle exporta o que a entrada Deno
importa.

O bundle da Edge Function é gerado por `npm --prefix worker run build:edge`:
o esbuild (já em `worker/node_modules`) empacota `worker/src/edge.js` e
`shared/ai-tools` num arquivo só em `supabase/functions/analise/`. O arquivo
**não é versionado** — está no `.gitignore` e precisa ser refeito antes de
cada deploy.

## Bancada

`worker/bancada/` roda o próprio `tratar` no Node, sem `wrangler`, com o
Supabase simulado a partir de um retrato das RPCs e o modelo em três modos:
**roteiro** (respostas prontas, sem rede, usado nos testes), **local** (Ollama
deste PC, em `localhost:11434`) e **chave** (`--chave <arquivo>`, chama
`ollama.com` de verdade). O contador entra pela RPC: o roteador responde
`analise_consumir` com um contador em memória. O retrato real fica fora do git;
o exemplo versionado usa três centros fictícios (`30.9xx`).

```bash
node worker/bancada/rodar.mjs \
  --roteiro worker/bancada/exemplo/roteiro.json \
  --retrato worker/bancada/exemplo/retrato.json \
  --perguntas worker/bancada/exemplo/perguntas.json
```

A saída (`eventos.jsonl` e `relatorio.md`) vai para `worker/bancada/saida/`,
ignorada pelo git, e o código de saída é 0 só se todas as perguntas passarem.
`--so 3,8` roda só esses ids; `--modelo` troca o modelo. As perguntas rodam uma
de cada vez e o roteador só deixa sair o que vai para `bancada.invalid` ou para
o `/api/chat` do Ollama.

O relatório mostra, por pergunta, as **chamadas externas** (modelo + RPC +
auth + contador), que são o que a Cloudflare limitava a 50. Acima de 40 a
pergunta ganha um aviso no console e no relatório; o aviso não reprova.

## Tetos e o que o Worker NÃO faz

- **Um prazo só, de 120 s**, contado do início do `POST /analise` (antes da
  autenticação). Ele é um timestamp passado a auth, limite, cada RPC e cada
  chamada ao modelo; cada um usa o menor entre o próprio teto e o restante. Um
  watchdog chama o encerrador, que fecha o stream com `erro` `tempo` + `fim`
  mesmo que uma chamada pendure e ignore o `AbortSignal`. A promessa entregue ao
  `ctx.waitUntil` resolve até **prazo + 1 s**, mesmo com ferramenta,
  `marcarTexto` ou modelo pendurados. Se o cliente parar de ler, o encerramento
  não espera a escrita: chama `writer.abort(motivo)` sem `await` (a rejeição é
  tratada) e libera a promessa. Não usa `readable.cancel()` — com o leitor
  travado ele rejeita e não resolve nada.
- 8 rodadas de modelo, 30 chamadas de ferramenta e 60.000 caracteres por
  resultado (acima disso volta erro curto ao modelo pedindo filtro). Estourar
  vira `erro` (`tempo` ou `interno`) e `fim`.
- 50 perguntas por login por dia, contadas no começo. Acima disso, `erro`
  `limite`. No Worker, o KV não é atômico (duas requisições simultâneas podem
  contar uma a menos) e a leitura pode vir de cache de outra região por até
  ~60 s; com um único admin, isso pode deixar passar algumas perguntas acima de
  50. Na Edge Function, a RPC é atômica e a 51ª grava 51 (a recusa já gastou a
  cota), mas o modelo não é chamado. É freio de fatura, não segurança.
- Não loga pergunta, argumento, resultado, bloco nem texto. `console.*` não é
  usado nem em erro; a mensagem que chega à tela é genérica.
- Não tem `service_role`, não escreve no banco, não faz cálculo financeiro e
  não decide número: todo valor vem de RPC, e o bloco só sai depois de
  `sessao.criarBloco` + `sessao.reidratar`.
- O texto do modelo sempre passa por `sessao.marcarTexto`; o texto não é
  reidratado (só o bloco é). `content` ausente, vazio, só com espaços ou que não
  seja string (objeto, número, array) vira `erro` `modelo` ("o modelo não
  respondeu"), não `texto: ""`; formato inválido de `marcarTexto` vira `erro`
  `interno`. Em resposta **com** `tool_calls`, `content` nulo/ausente é normal;
  qualquer outro tipo (objeto, número, array) também vira `erro` `modelo` antes
  de executar a ferramenta.
- RPC com 200 e JSON literal `null` é `resposta_invalida`: nenhuma das 7 RPCs do
  contrato §4 devolve `null` com sucesso.
- Erro de ferramenta (inclusive exceção) é cortado em **500 caracteres** tanto
  no evento `passo` quanto no que volta ao modelo.
- Se o cliente desconectar, o `AbortSignal` da requisição chega a **todos** os
  fetch (auth, RPC e modelo) e o laço para; a falha de escrita no stream é a
  segunda detecção. A desconexão é processada **mesmo com um `fim` já em
  escrita**: o encerrador aborta o sinal interno e a escrita na hora, sem esperar
  o limite.
- Não publica: deploy é do Claude, com o ok do Victor.
