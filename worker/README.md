# Worker da Análise (`worker/`)

O Worker que roda o laço de ferramentas da Análise (F5) e devolve os eventos por
SSE. O contrato está em [`docs/redesenho/analise-contrato.md`](../docs/redesenho/analise-contrato.md)
§7; o plano, em [`docs/redesenho/analise-plano.md`](../docs/redesenho/analise-plano.md).

Ele existe para guardar a `OLLAMA_API_KEY` fora do browser e para rodar um laço
que não cabe no navegador. Tudo o que ele consulta passa pelas RPCs do site,
**com o JWT de quem perguntou** — o RLS e os guards valem como na tela. Escreve no
banco apenas pelas RPCs de cota (`analise_consumir`, 071, só na Edge Function) e
de registro (`analise_registro_iniciar`, 075, com o JWT da pessoa;
`analise_registro_concluir_servidor`, 075, que só a Edge Function assina, com a
credencial de servidor que o Supabase injeta). O Worker da Cloudflare não tem
essa credencial: nele o fechamento do registro é pulado em silêncio.

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
| `POST /analise` | `Authorization: Bearer <JWT>` + `{ pergunta, conversa?, anteriores? }` → `text/event-stream` |

Eventos do `/analise`: `inicio`, `passo`, `bloco`, `texto`, `fim`, `erro` (contrato
§7). O `inicio` é sempre o primeiro e carrega `{ registro, conversa, ordem }`: o id
da linha da migração 074, o id da conversa da 075 e o turno dentro dela, ou três
`null` se o registro falhou. Ele só sai depois de login e limite passarem; por
isso autenticação recusada e cota estourada continuam saindo como `erro` + `fim`,
sem `inicio`. `anteriores` aceita até 5 itens com `pergunta`, `resumo` e `blocos`
(texto ≤ 600, mascarado como a pergunta).
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

### Registro da pergunta e histórico (074/075)

Depois de login e limite, e antes do primeiro `passo`, o núcleo chama
`analise_registro_iniciar` (`worker/src/registro-rpc.js`) com o JWT da pessoa, a
pergunta original, `anteriores.length`, o modelo e a `conversa` (quando há).
Falha de rede, HTTP, prazo ou JSON inválido vira `{ id: null }`; a pergunta
continua e `inicio` sai com `registro: null`, `conversa: null` e `ordem: null`.
No encerramento — `ok`, `incompleta`, `tempo`, `limite`, `erro` ou `desconectado` —
a Edge Function chama `analise_registro_concluir_servidor` **uma única vez**,
agendada no `waitUntil` e sem bloquear a escrita terminal. O `concluir` usa prazo
próprio de 5 s e **não** usa o sinal da requisição: no timeout ou na desconexão
ele já está abortado, e o fechamento ainda precisa chegar ao banco. A chamada é
assinada pela credencial de servidor (`SUPABASE_SERVICE_ROLE_KEY`, que o Supabase
injeta na Edge) e leva o `p_user` que o núcleo conferiu. **Sem a chave** — o
Worker da Cloudflare —, `concluir` devolve `{ ok: false, pulado: true }` sem
tocar a rede; o registro fica sem conclusão. A chave nunca vai para resposta,
SSE, log, erro, registro nem teste com valor real.

O que fica gravado é o que a pessoa viu: a pergunta, a resposta reidratada
(`texto` + `blocos`) e os `passos` com a ferramenta, o estado, o erro (quando há)
e os argumentos **mascarados** que o modelo passou — nome real nunca entra nos
passos. `p_resposta` e `p_passos` acima de 240 KB são truncados com
`{ truncado: true }` para caber no check de 256 KB da 074. A tabela
`analise_registro` fica atrás de RLS, sem policy: só as RPCs da 074/075 escrevem,
e só o admin lê pela `analise_registros_admin()` (que agora devolve também
`conversa_id` e `ordem`). Nada disso vai para `console.*`.

A 075 acrescenta as conversas: `analise_conversa` (dono, título editável, última
atividade) e o backfill de cada registro antigo numa conversa própria. **Não há
mais retenção de 180 dias**; a conversa fica enquanto a conta existir ou até a
pessoa excluí-la. O dono lê os turnos pela `analise_conversa_ler` (em ordem, sem
`passos`), lista, renomeia e exclui; conversa de outra pessoa é 42501.

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
| `SUPABASE_SERVICE_ROLE_KEY` | **só na Edge Function** | injetada pelo Supabase; assina só a conclusão do registro (075). Nunca no Worker, no frontend ou no git. |

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
testados direto. `nucleo.test.js` prova a interface do contador e o registro da
074 (primeiro evento `inicio`, uma abertura/fechamento por desfecho e argumentos
mascarados); `contador-rpc.test.js` e `registro-rpc.test.js` provam as RPCs e o
truncamento; `bancada.test.js` prova o roteador em memória e as checagens da
bateria; `build-edge.test.js` roda o `build:edge` de verdade e confere que o
bundle exporta o que a entrada Deno importa.

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
`ollama.com` de verdade). O contador e o registro entram pela RPC: o roteador
responde `analise_consumir` com um contador em memória e
`analise_registro_iniciar`/`analise_registro_concluir` com um registro em memória
(`roteador.registros`, UUID sintético determinístico, abertura/fechamento únicos
e dono conferido). O retrato real fica fora do git; o exemplo versionado usa
três centros fictícios (`30.9xx`).

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
auth + contador + registro), que são o que a Cloudflare limitava a 50. Acima de
40 a pergunta ganha um aviso no console e no relatório; o aviso não reprova. A
bateria também confere, em toda pergunta em que o login passa, que `inicio` é o
primeiro evento, que o registro abriu e fechou **uma vez** e que nenhum nome
sintético do retrato aparece nos `passos` gravados (na `pergunta` e na
`resposta`, que são reidratadas, ele pode aparecer).

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
  usado nem em erro; a mensagem que chega à tela é genérica. O registro da 074 é
  a exceção deliberada à regra "sem log": ele vai para o **banco**, atrás de RLS,
  não para o console.
- Não tem a credencial de servidor no Worker e não faz cálculo financeiro. Na Edge
  Function ela existe só para a `analise_registro_concluir_servidor` (075); as
  demais RPCs usam o JWT da pessoa. Não decide número: todo valor vem de RPC, e o
  bloco só sai depois de `sessao.criarBloco` + `sessao.reidratar`.
- A pergunta e os `anteriores` (inclusive `blocos`) são mascarados por
  `sessao.mascararEntrada` antes da primeira ida ao modelo: o `⟦Pn⟧` é o mesmo dos
  resultados das ferramentas e CPF/e-mail saem. Se o dicionário de nomes não
  carrega, o Worker encerra com `erro` `interno` e **não** manda a pergunta crua ao
  modelo.
- O texto do modelo passa por `sessao.marcarTexto` (conferência sobre a versão
  mascarada) e depois por `sessao.reidratarTexto` antes do evento `texto`: a tela
  recebe o nome real e `semOrigem` deslocado pelo tamanho de cada substituição.
  `content` ausente, vazio, só com espaços ou que não seja string (objeto,
  número, array) vira `erro` `modelo` ("o modelo não respondeu"), não
  `texto: ""`; formato inválido de `marcarTexto` ou de `reidratarTexto` vira
  `erro` `interno`. Em resposta **com** `tool_calls`, `content` nulo/ausente é
  normal; qualquer outro tipo (objeto, número, array) também vira `erro`
  `modelo` antes de executar a ferramenta.
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
