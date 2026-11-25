# Worker da Análise (`worker/`)

O Worker que roda o laço de ferramentas da Análise (F5) e devolve os eventos por
SSE. O contrato está em [`docs/redesenho/analise-contrato.md`](../docs/redesenho/analise-contrato.md)
§7; o plano, em [`docs/redesenho/analise-plano.md`](../docs/redesenho/analise-plano.md).

Ele existe para guardar a `OLLAMA_API_KEY` fora do browser e para rodar um laço
que passa fácil do tempo de uma Edge Function. Tudo o que ele consulta passa
pelas RPCs do site, **com o JWT de quem perguntou** — o RLS e os guards valem
como na tela. O Worker não tem `service_role` e não escreve no banco.

## Rotas

| Rota | O que faz |
|---|---|
| `OPTIONS *` | Preflight de CORS, sem autenticar |
| `GET /saude` | `{ ok: true }` |
| `POST /analise` | `Authorization: Bearer <JWT>` + `{ pergunta, anteriores? }` → `text/event-stream` |

Eventos do `/analise`: `passo`, `bloco`, `texto`, `fim`, `erro` (contrato §7).
Autenticação recusada chega como evento `erro` (`sem_login` / `sem_permissao`)
dentro do stream, não como 401/403: a tela tem um caminho só para ler erro.
Corpo inválido (JSON quebrado, pergunta vazia ou acima de 2.000 caracteres)
responde 400 antes de abrir o stream. O corpo é lido com teto de **100.000
bytes contados durante a leitura** (sem confiar em `Content-Length`): acima
disso, a leitura é cancelada e a resposta é 413 antes de desserializar.

CORS: só `https://lapig-financeiro.github.io` e `http://localhost:<porta>`.
Qualquer outra origem recebe 403, sem cabeçalho de liberação.

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

## Testes

```bash
npm --prefix worker test
```

Vitest, sem rede: `fetch`, KV, sessão e modelo são dublês. O `index.js` é
testado com `vi.mock` do pacote `shared/ai-tools`, que é do outro executor e
pode ainda não existir na branch; os outros módulos são testados direto.

## Tetos e o que o Worker NÃO faz

- **Um prazo só, de 120 s**, contado do início do `POST /analise` (antes da
  autenticação). Ele é um timestamp passado a auth, limite, cada RPC e cada
  chamada ao modelo; cada um usa o menor entre o próprio teto e o restante. Um
  watchdog fecha o stream com `erro` `tempo` + `fim` mesmo que uma chamada
  pendure e ignore o `AbortSignal`.
- 8 rodadas de modelo, 30 chamadas de ferramenta e 60.000 caracteres por
  resultado (acima disso volta erro curto ao modelo pedindo filtro). Estourar
  vira `erro` (`tempo` ou `interno`) e `fim`.
- 50 perguntas por login por dia, contadas no começo. Acima disso, `erro`
  `limite`. O KV não é atômico (duas requisições simultâneas podem contar uma a
  menos) e a leitura pode vir de cache de outra região por até ~60 s. Com um
  único admin, isso pode deixar passar algumas perguntas acima de 50. É freio
  de fatura, não segurança.
- Não loga pergunta, argumento, resultado, bloco nem texto. `console.*` não é
  usado nem em erro; a mensagem que chega à tela é genérica.
- Não tem `service_role`, não escreve no banco, não faz cálculo financeiro e
  não decide número: todo valor vem de RPC, e o bloco só sai depois de
  `sessao.criarBloco` + `sessao.reidratar`.
- O texto do modelo sempre passa por `sessao.marcarTexto`; o texto não é
  reidratado (só o bloco é). `content` vazio ou só espaços vira `erro` `modelo`
  ("o modelo não respondeu"), não `texto: ""`; formato inválido de
  `marcarTexto` vira `erro` `interno`.
- Erro de ferramenta (inclusive exceção) é cortado em **500 caracteres** tanto
  no evento `passo` quanto no que volta ao modelo.
- Se o cliente desconectar, o `AbortSignal` da requisição chega a **todos** os
  fetch (auth, RPC e modelo) e o laço para; a falha de escrita no stream é a
  segunda detecção.
- Não publica: deploy é do Claude, com o ok do Victor.
