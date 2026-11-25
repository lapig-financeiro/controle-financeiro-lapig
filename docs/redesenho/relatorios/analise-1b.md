# Análise 1b — Cloudflare Worker (`worker/`)

Data: 25/11/2026. Branch `redesenho/analise-1-b`, worktree `cf-analise-b`.
Contrato seguido: [`analise-contrato.md`](../analise-contrato.md) §4, §6 e §7. Plano:
[`analise-plano.md`](../analise-plano.md). Nada de push, deploy, `wrangler login` ou chamada à
produção/Ollama real.

## O que foi feito

O Worker da Análise em `worker/`:

- `src/index.js` — rotas, CORS, validação do corpo, montagem da sessão e do chamador do modelo,
  `TransformStream` + `ctx.waitUntil` para o SSE.
- `src/auth.js` — `GET /auth/v1/user` com o JWT da pessoa e leitura do papel em `app_users` com o
  mesmo JWT.
- `src/limite.js` — KV `ANALISE_USO`, chave `uso:<user_id>:<AAAA-MM-DD>` no fuso de Brasília, TTL de
  48 h, 50/dia por padrão.
- `src/laco.js` — o laço; sessão, chamador do modelo e emissor são injetados.
- `src/sse.js` — `event:`/`data:` e o emissor que para quando o cliente desconecta.
- `src/rpc.js` — `POST <SUPABASE_URL>/rest/v1/rpc/<nome>` com `Authorization: Bearer <JWT da pessoa>`
  e `apikey` pública; devolve `{ data, error }` sem lançar.
- `tests/*.test.js` (6 arquivos, 71 testes) e `README.md`.
- `package.json` próprio (`wrangler` e `vitest` como devDependencies, scripts `dev` e `test`),
  `wrangler.toml`, `.gitignore` e `.dev.vars.exemplo` (só nomes).

## Decisões

**Autenticação recusada sai como evento SSE, não como 401/403.** O contrato §7 já lista
`sem_login` e `sem_permissao` como códigos de `erro`; assim a tela tem um caminho só para ler erro.
JWT ausente, inválido ou vencido → `erro` `sem_login`; papel fora de `ANALISE_PAPEIS` → `erro`
`sem_permissao`. Corpo inválido (JSON quebrado, pergunta vazia ou > 2.000 caracteres, `anteriores`
com mais de 5) continua sendo **400 antes de abrir o stream**, porque aí não há resposta para
transmitir.

**O `user_id` vem sempre do `/auth/v1/user`.** `validarCorpo` só devolve `pergunta` e `anteriores`; o
que vier em `user_id` no corpo é descartado. O `rpc` do laço é criado com o JWT do header, nunca com
a chave pública no `Authorization` — a chave pública vai no `apikey`, como no frontend.

**Papel padrão `admin`.** `ANALISE_PAPEIS` é lista separada por vírgula; vazia ou ausente → `admin`
(decisão do Victor: só ele por enquanto). O Worker não tem `service_role`.

**Limite.** `ANALISE_LIMITE_DIA` (padrão 50), contado no começo da pergunta — uma análise que
estoura o tempo também gastou modelo. Falha de KV devolve `erro` `interno` em vez de liberar: uma
contagem que não foi gravada não pode virar "pode". O KV não é atômico; duas requisições simultâneas
podem ler o mesmo contador e gravar o mesmo `+1`, então o número real pode ficar levemente abaixo do
teto. É freio de fatura, não segurança, e está registrado abaixo.

**Laço.** System com `INSTRUCOES` + data de hoje; as `anteriores` resumidas entram no mesmo system
(pergunta até 500 chars, resumo até 1.000, no máximo 5), para a pergunta atual ser a única mensagem
`user`. A cada rodada, o modelo recebe `tools`; cada `tool_call` gera `passo` `inicio`, a execução e
`passo` `fim`/`erro`; `criar_bloco` vai para `sessao.criarBloco` + `sessao.reidratar` e emite `bloco`;
`calcular` vai para `sessao.calcular`; o resto vai para `sessao.executar`. O resultado volta como
`{ role: 'tool', tool_name, content }`, com `tool_call_id` quando o modelo manda `id`. Sem
`tool_calls`: `sessao.marcarTexto(content)` → `texto` + `fim`.

Tetos: 8 rodadas, 30 ferramentas, 60.000 chars por resultado, 120 s no total. Estourar rodadas ou
ferramentas → `erro` `interno`; tempo → `erro` `tempo`; em ambos, `fim` depois. Resultado acima de
60.000 chars não é truncado (JSON cortado vira objeto inválido): é trocado por um erro curto com
`teto_chars` e a dica de restringir a consulta. Erro de ferramenta volta como `{ erro }` ao modelo e
não derruba a análise. O recibo do bloco para o modelo é `{ id }` (sem o conteúdo do bloco).

**Texto.** O texto do modelo nunca é emitido sem `sessao.marcarTexto`; o texto não é reidratado (só o
bloco, via `reidratar`), como o contrato manda. O `texto` emitido usa `marcado.texto` e
`marcado.semOrigem`, com guarda para sessão que devolva formato inesperado.

**SSE e desconexão.** `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`,
escrita chunk a chunk num `TransformStream`; a tarefa é segurada com `ctx.waitUntil`. O laço para
quando o `request.signal` aborta ou quando uma escrita falha (o emissor devolve `false` e o
`index.js` aborta o controlador). Nesse caso não há evento de erro: a tela já não está lá.

**Sem log.** Nenhum `console.*` no Worker, nem com código de erro: a mensagem que vai à tela é
genérica e o conteúdo (pergunta, argumento, resultado, bloco, texto) não passa por log em nenhum
caminho. O teste espiona `console.log/info/warn/error/debug` num laço completo e falha se qualquer
trecho aparecer.

**CORS.** Só `https://lapig-financeiro.github.io` e `http://localhost:<porta>`. `OPTIONS` responde
204 sem autenticar; origem fora da lista recebe 403 sem `Access-Control-Allow-Origin`. Requisição
sem `Origin` (curl, `wrangler dev`) segue normalmente.

**CPU.** O laço não re-serializa resultados grandes: `paraModelo` já chega string e é devolvido como
está; o único `JSON.stringify` grande é o corpo do `/api/chat`, que cresce a cada rodada porque o
histórico inteiro vai junto. A medição está abaixo.

## Testes

```
npm --prefix worker test
```
→ **6 arquivos, 71 testes, todos verdes**.

Cobertura por área:

- **CORS** — origem permitida, origem recusada (403, sem cabeçalho), `OPTIONS` permitido e recusado,
  `localhost:porta`, rota desconhecida 404.
- **Auth** — JWT ausente, inválido (401) e vencido (403) → `sem_login`; professor recusado; `admin`
  aceito; `ANALISE_PAPEIS` com professor aceita; sem linha em `app_users` recusa; erro de Supabase e
  rede viram `interno`, não `sem_login`; `user_id` do corpo ignorado (a chave do KV é `uso:u1:...`,
  não a do corpo); o rpc entregue à sessão usa `Bearer jwt-bom`.
- **Limite** — 50ª passa, 51ª recusa; dia seguinte zera; virada às 03:00 UTC (00:00 de Brasília),
  incluindo 01:00 UTC ainda sendo o dia anterior; separação por usuário; TTL de 48 h; falha de KV
  não libera; `ANALISE_LIMITE_DIA` respeitada.
- **Laço** — pergunta → `listar_centros` → `criar_bloco` → texto, com a ordem exata dos eventos;
  `arguments` como string JSON e `tool_call_id`; `arguments` inválido volta ao modelo; ferramenta
  com erro volta e a análise segue; bloco recusado volta como erro e não vira evento `bloco`;
  `calcular` volta ao modelo e só `criar_bloco` emite bloco; laço infinito para em 8 rodadas;
  resultado de 60.001 chars vira erro curto; `ErroModelo` 500/JSON inválido/sem `message` → `erro`
  `modelo`; timeout → `tempo`; estouro do total → `tempo` + `fim`; desconexão para o laço.
- **rpc.js** — JWT da pessoa no `Authorization` (e chave pública no `apikey`), 4xx e 5xx devolvem
  `error` sem lançar, rede vira `rede`, 200 não-JSON vira `resposta_invalida`, sem JWT não chama.
- **Sem log** — teste de laço completo e teste de fluxo completo pelo `index.js`, com pergunta,
  argumento, resultado, bloco e texto secretos; nenhum aparece em `console.*`.
- **index.js** — com `vi.mock` do pacote `shared/ai-tools` (que ainda não existe nesta branch),
  rotas, CORS, auth, limite, SSE, 400 de corpo e os erros reais do Ollama (500 e JSON inválido).

Raiz:

```
npm run lint   → limpo
npm test       → 44 arquivos passando + 1 pulado; 692 testes passando + 19 pulados (711)
```

`wrangler dev`: subiu em `127.0.0.1:8801` com `.dev.vars` de exemplo (valores falsos) e um stub
temporário do pacote; `GET /saude` respondeu **200 `{"ok":true}`**. O log do Wrangler marcou
`GET /saude 200 OK (22ms)` e o span local, `duration_ms: 5` — tempo de parede, não CPU.

## Mutantes

Cada mutante foi aplicado de verdade, rodado contra o teste indicado e revertido; os hashes dos
arquivos restaurados foram conferidos e a suíte voltou a 71/71.

| Mutante | O que mudou | Teste que pega | O que falhou |
|---|---|---|---|
| Aceitar `user_id` do corpo | `validarCorpo` passa a devolver `user_id` e o limite usa `corpo.user_id \|\| auth.usuario.id` | `index.test.js` › "ignora user_id do corpo: o id é o do /auth/v1/user" | a chave `uso:u1:<dia>` não existia; o teste esperava `true` e recebeu `false` |
| Pular o papel | removida a checagem `if (!papeis.includes(papel))` | `auth.test.js` › "professor é recusado" | `autenticar` devolveu `ok: true` para `professor` |
| Logar a pergunta | `console.log('MUTANTE pergunta:', pergunta)` no início do laço | `laco.test.js` › "nenhum conteúdo no console" | o texto do console continha `PERGUNTA-SECRETA` |
| Não contar o limite | `consumir` trocado por `{ permitido: true }` | `index.test.js` › "a 51ª é recusada antes de chamar o modelo" | veio `erro` `modelo` + `fim` em vez de `erro` `limite`, e o Ollama foi chamado |
| Repassar texto sem `marcarTexto` | emitido `{ texto: conteudo, semOrigem: [] }` direto | `laco.test.js` › "pergunta → listar_centros → criar_bloco → texto, na ordem" | o texto saiu sem `marcado(...)` e `semOrigem` vazio; `marcarTexto` não foi chamado |

## Medidas de CPU

O `wrangler dev` **não expõe CPU**: o Local Explorer só tem `duration_ms` (parede) no span, e o log
mostra o tempo total da requisição. Para ter um número do caminho quente, medi o próprio
`src/laco.js` (o mesmo arquivo, sem dublê de lógica) com `process.cpuUsage()` no Node 26 deste PC,
incluindo o `JSON.stringify` do corpo que iria ao `/api/chat` a cada rodada e a formatação real dos
eventos SSE. Não é CPU do Workers — é a melhor aproximação possível sem deploy. Valores por
requisição, 200 rodadas (100 na última linha), depois de aquecer:

| Cenário | CPU | Parede |
|---|---|---|
| 1 consulta, resultado de 1 KB | ~0,000 ms | 0,016 ms |
| 1 consulta, resultado de 10 KB | ~0,000 ms | 0,036 ms |
| 7 consultas, resultado de 1 KB | 0,075 ms | 0,072 ms |
| 7 consultas, resultado de 10 KB | 0,390 ms | 0,331 ms |
| 7 consultas, resultado de 60 KB | 2,500 ms | 2,520 ms |
| `formatarEvento` de um bloco de ~1,4 KB | 3,15 µs/evento | — |

Leitura: no cenário realista (7 consultas, resultados de ~10 KB) o laço fica bem abaixo dos 10 ms
de CPU do plano gratuito; no pior caso permitido (60 KB por resultado, 7 rodadas) chega a ~2,5 ms
neste PC, ainda com margem, mas sem folga confortável se o Workers for mais lento. O custo dominante
é o `JSON.stringify` do histórico crescente, não a formatação dos eventos. A mitigação já está no
código: o teto de 60.000 chars por resultado e a dica de filtro; se a bateria real mostrar CPU alta,
o caminho é enxugar os resultados das ferramentas, como o plano §6 previa. O `/saude` não tem laço e
ficou em 5 ms de parede (22 ms no log do Wrangler).

## Desvios e o que ficou em aberto

1. **`shared/ai-tools/index.js` não existe nesta branch.** O `index.js` importa
   `criarSessao`, `especificacoes` e `INSTRUCOES` de lá, como o contrato manda, mas o pacote é do
   outro executor. Os testes do `index.js` usam `vi.mock`; para o teste de `wrangler dev` foi
   preciso um **stub temporário** (só os três nomes, sem lógica), que foi removido antes do commit.
   Consequência honesta: nesta branch isolada, `npm --prefix worker run dev` só monta depois que o
   pacote real chegar (ou com um stub). Depois da junção das duas branches, funciona direto.
2. **`think: 'high'` não foi verificado contra a API real** — a tarefa proíbe chamar o Ollama de
   verdade. O contrato §7 prevê `think: true` se o modelo recusar o nível; o Claude deve fazer essa
   conferência na chamada real do fim da Etapa 1.
3. **KV não atômico.** Duas requisições simultâneas do mesmo login podem contar uma a menos. Para o
   uso atual (só admin, 50/dia) é aceitável; se virar problema, o caminho é um Durable Object por
   usuário, não um `get`/`put` mais esperto.
4. **A escolha de SSE para `sem_login`/`sem_permissao`** é uma decisão de interface, não do
   contrato fechado: o `POST /analise` responde 200 com `text/event-stream` mesmo quando recusa o
   login. Está documentada no README e aqui; se a Etapa 2 preferir 401/403, é uma troca localizada no
   `index.js` e no cliente.
5. **Nada de produção.** Não houve `wrangler login`, `wrangler deploy`, chamada ao Supabase real nem
   ao Ollama. O `.dev.vars` usado no teste tinha valores falsos e foi removido; o
   `.dev.vars.exemplo` versionado só tem nomes.
6. **Sem `package-lock.json`.** O `npm install` foi rodado com `--no-package-lock` para não criar
   arquivo fora da lista da tarefa. Quem for montar o ambiente roda `npm install` normalmente.
7. **`[vars]` do `wrangler.toml`** traz a URL e a chave publicável reais do Supabase (as mesmas que
   o frontend já carrega; são públicas). O segredo `OLLAMA_API_KEY` não está em lugar nenhum do
   repositório. Se o time preferir placeholders até o deploy, é só trocar antes de publicar.
8. **`docs/redesenho/ESTADO.md` não foi tocado**: a lista de arquivos da tarefa não o inclui; o fecho
   e a atualização do ESTADO são do Claude, conforme o plano §4.

## 2ª rodada (revisão)

Data: 25/11/2026. Branch `redesenho/analise-1-b`. Commit novo:
`fix(analise): Worker — 2ª rodada da revisão`. Só `worker/` e este relatório foram tocados.

### O que mudou

1. **Prazo único de 120 s desde o começo do `POST /analise`.** O `index.js` cria
   `inicio = Date.now()` e `prazo = inicio + 120_000` antes de ler o corpo e de autenticar. O `prazo`
   (timestamp) desce para `autenticar`, `consumir`, `criarRpc`, `chamarModelo` e `executarLaco`. Cada
   um usa `timeoutEfetivo(prazo, tetoPróprio)`: o menor entre o teto da chamada (10 s auth/limite,
   30 s RPC, 90 s modelo) e o tempo que falta — inclusive a leitura do corpo das respostas, que
   antes escapava do relógio no `auth.js`. Um watchdog no `analisar` fecha o stream com `erro`
   `tempo` + `fim` no prazo, mesmo que uma chamada pendurada ignore o `AbortSignal`; as escritas
   passam por uma fila no `sse.js` para o `erro`/`fim` do watchdog não intercalar com um `passo`.
   O `fim.ms` agora conta do começo do POST, não do começo do laço.
2. **Cancelamento real.** O `AbortSignal` da requisição chega a todos os `fetch`: o `sinalComPrazo`
   combina a desconexão do cliente, o prazo e o teto da chamada; `corrida` desiste de uma promessa
   pendurada assim que o sinal aborta. Auth, RPC, KV (que não aceita signal, por isso é corrido
   contra o relógio) e modelo usam o mesmo caminho. **Compatibilidade:** o `wrangler.toml` passou de
   `compatibility_date = "2026-11-01"` para **`"2026-11-17"`**. Fonte: o registro de compatibilidade
   embutido no binário do workerd instalado em
   `worker/node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe` (workerd `1.20261123.1`)
   lista `enable_request_signal` / `disable_request_signal` sob a data `2026-11-17`; antes dela o
   `request.signal` não é ligado por padrão. Não chutei o nome: ele está no próprio binário e o
   `worker/tests/config.test.js` trava a data.
3. **Corpo de resposta.** `rpc.js` mantém o sinal vivo durante `resposta.text()`: 200 vazio →
   `resposta_invalida`; stream interrompido → `rede`; timeout → `tempo`; desconexão → `abortado`.
   Nunca `{ data: null, error: null }`. `auth.js` e o chamador do modelo seguem a mesma regra
   (200 vazio/inválido → `interno`/`modelo`; interrupção → `interno`/`modelo`; timeout → `tempo`).
4. **Teto do corpo de 100.000 bytes contado durante a leitura.** `lerCorpoComTeto` lê o
   `ReadableStream` do `request` em pedaços, soma `byteLength` e, ao passar do teto, cancela o
   leitor e responde **413 antes de `JSON.parse`**. O `Content-Length` não é mais consultado.
5. **Resposta final vazia e `marcarTexto` inválido.** `content` vazio ou só espaços, sem
   `tool_calls`, vira `erro` `modelo` ("O modelo não respondeu."), não `texto: ""`. Se
   `marcarTexto` devolver algo fora do contrato §4 (`texto` não-string, `semOrigem` não-lista ou
   faixa com `inicio`/`fim` inválidos), vira `erro` `interno`, sem `texto`/`fim` de sucesso.
6. **Erro de ferramenta limitado a 500 caracteres.** `cortarErro` vale para erro devolvido,
   exceção, argumento inválido e chamada sem nome, tanto no evento `passo` quanto no
   `{ role: 'tool', content }` que volta ao modelo (com `…` no fim, exatamente 500).

### Testes

```
npm --prefix worker test   → 8 arquivos, 99 testes, todos verdes
npm run lint               → limpo
npm test                   → 44 arquivos passando + 1 pulado; 692 testes passando + 19 pulados (711)
```

Novos testes desta rodada:

- `prazo.test.js`: menor entre teto e restante, sinal que dispara no prazo, desconexão, `corrida`
  que desiste de promessa pendurada.
- `config.test.js`: `compatibility_date >= 2026-11-17` (ou a flag `enable_request_signal`).
- `auth.test.js`: 200 vazio/JSON inválido/leitura interrompida → `interno`; timeout na leitura →
  `tempo`; desconexão → `abortado` e o `init.signal` do fetch abortado.
- `rpc.test.js`: 200 vazio → `resposta_invalida`; leitura interrompida → `rede`; timeout na leitura
  → `tempo`; desconexão → `abortado`; `init.signal` presente.
- `limite.test.js`: prazo vencido e desconexão não esperam o KV.
- `laco.test.js`: resposta do modelo depois do prazo não gera `texto`; `content` vazio vira
  `erro` `modelo`; `marcarTexto` inválido vira `erro` `interno`; erro de ferramenta (inclusive
  exceção) cortado em 500 no `passo` e no modelo.
- `index.test.js`: corpo de 120 KB em stream → 413 (JSON quebrado, provando que não desserializou);
  watchdog fecha o stream com `erro` `tempo` + `fim` com a sessão pendurada; desconectar durante o
  modelo aborta o `fetch` e não emite `texto`; desconectar durante uma RPC aborta o `fetch` e para o
  laço; corpo vazio/interrompido do Ollama → `erro` `modelo`.

`wrangler dev` com o novo `compatibility_date` subiu em `127.0.0.1:8802` (stub temporário do
`shared/ai-tools` + `.dev.vars` com valores falsos) e `GET /saude` respondeu **200
`{"ok":true}`**, sem aviso de data; o Wrangler marcou `GET /saude 200 OK (25ms)`. O stub e o
`.dev.vars` foram removidos.

### Mutantes

Cada um foi aplicado de verdade, rodado contra o teste indicado e revertido; os hashes dos
arquivos restaurados foram conferidos e a suíte voltou a 99/99.

| # | Item | Mutante | Teste que pega | O que falhou |
|---|---|---|---|---|
| 1 | Prazo | removida a checagem `expirado()` depois da resposta do modelo | `laco.test.js` › "resposta do modelo que chega depois do prazo não vira texto" | emitiu `texto atrasado` e chamou `marcarTexto` |
| 2a | Cancelamento (config) | `compatibility_date` de volta para `2026-11-01` | `config.test.js` › "liga o sinal de desconexão do cliente" | `data >= 2026-11-17` falso |
| 2b | Cancelamento (auth) | `pedirJson` sem `sinal` no `sinalComPrazo` | `auth.test.js` › "desconexão aborta o fetch de login" | `sinalDoFetch.aborted` ficou `false` |
| 3 | Corpo de resposta | 200 vazio devolvendo `{ data: null, error: null }` | `rpc.test.js` › "200 com corpo vazio é resposta_invalida" | `r.error` era `null` |
| 4 | Teto do corpo | `lerCorpoComTeto` voltando a `request.json()` | `index.test.js` › "corpo acima de 100.000 bytes em stream é 413" | respondeu 400 em vez de 413 |
| 5a | Texto vazio | removida a checagem `if (!conteudo)` | `laco.test.js` › "content vazio ou só espaços vira erro modelo" | `ok: true`, com `texto: ""` |
| 5b | Formato de `marcarTexto` | removida a checagem `textoMarcadoValido` | `laco.test.js` › "marcarTexto com formato inválido vira erro interno" | `ok: true`, sem erro |
| 6 | Erro de ferramenta | `cortarErro` devolvendo o texto inteiro | `laco.test.js` › "erro de ferramenta ... 500 caracteres" | erro com 1.000 caracteres no `passo` |

### Fica de fora, de propósito

- **KV → Durable Object.** Fica para depois, como decidido. O KV é eventualmente consistente: a
  leitura do contador pode vir de cache de outra região por até ~60 s. Com um único usuário admin,
  isso aceita passar de 50 por poucas perguntas; é freio de fatura, não segurança. O README foi
  atualizado com essa ressalva.
- O **stub do `shared/ai-tools`** continua sendo o motivo de `wrangler dev` não montar nesta
  branch isolada; foi usado só no teste e removido. Depois da junção, o comando funciona direto.
- O teste do watchdog usa **timers falsos**; não há espera real de 120 s na suíte. A desconexão real
  do cliente no workerd não foi exercitada no `wrangler dev` (não há como simular a queda da aba
  pelo `curl`); a evidência é o registro de `enable_request_signal` no binário + o teste de config
  + os testes de sinal em auth/RPC/modelo/índice.
- `think: 'high'` continua sem conferência contra a API real, como na 1ª rodada (proibido chamar o
  Ollama).
- As medidas de CPU da 1ª rodada seguem valendo como aproximação; a 2ª rodada acrescenta um
  relógio/`AbortSignal` por chamada (custo desprezível) e não repetiu a medição no `wrangler dev`,
  que continua sem expor CPU.
