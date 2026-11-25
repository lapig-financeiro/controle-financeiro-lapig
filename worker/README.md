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
responde 400 antes de abrir o stream.

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

- 8 rodadas de modelo, 30 chamadas de ferramenta, 60.000 caracteres por
  resultado (acima disso volta erro curto ao modelo pedindo filtro) e 120 s no
  total. Estourar vira `erro` (`tempo` ou `interno`) e `fim`.
- 50 perguntas por login por dia, contadas no começo. Acima disso, `erro`
  `limite`. O KV não é atômico: duas requisições simultâneas podem contar uma
  a menos. É freio de fatura, não segurança.
- Não loga pergunta, argumento, resultado, bloco nem texto. `console.*` não é
  usado nem em erro; a mensagem que chega à tela é genérica.
- Não tem `service_role`, não escreve no banco, não faz cálculo financeiro e
  não decide número: todo valor vem de RPC, e o bloco só sai depois de
  `sessao.criarBloco` + `sessao.reidratar`.
- O texto do modelo sempre passa por `sessao.marcarTexto`; o texto não é
  reidratado (só o bloco é).
- Se o cliente desconectar, o laço para (sinal da requisição + falha de
  escrita no stream).
- Não publica: deploy é do Claude, com o ok do Victor.
