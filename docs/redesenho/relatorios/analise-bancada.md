# Bancada de testes da Análise (`worker/bancada/`)

> Executor: DeepSeek V4.1 Flash max, no worktree `C:/Users/amara/dev/cf-bancada`,
> branch `redesenho/analise-bancada`, em 25/11/2026. Tarefa:
> `docs/redesenho/tarefas/analise-bancada.md` (escrita pelo Claude).

## O que foi feito

A bancada roda o **próprio `worker/src/index.js`** no Node — o `fetch` do
`export default`, sem `wrangler` — com o Supabase simulado e o modelo em um dos
três modos. Nada de login, produção, banco real ou `service_role`.

- `worker/bancada/rodar.mjs`: CLI, seleção das perguntas (`--so`), execução
  sequencial, escrita de `eventos.jsonl` e `relatorio.md`, código de saída 0 só
  com todas as perguntas aprovadas.
- `worker/bancada/roteador.mjs`: troca `globalThis.fetch` durante a pergunta.
  Só aceita `https://bancada.invalid` (auth, `app_users` e RPCs) e o
  `POST /api/chat` do Ollama; outro endereço lança
  `bancada: rede fora da lista`. Guarda cada corpo enviado ao modelo e cada RPC
  chamada.
- `worker/bancada/retrato.mjs`: lê o formato do oráculo, monta as respostas das
  sete RPCs do contrato e reconstrói `bolsistas` com nomes sintéticos
  (`Bolsista Bancada 001`, um por `pessoa`) e `holder_id` estável
  (`bancada-p1`, …). A folha de bolsa da árvore, que o oráculo deixou como
  `[nome]`, recebe o mesmo nome sintético da `scholarship`, para o `⟦Pn⟧` ser
  o mesmo em `bolsas` e em `explicar_livre`.
- `worker/bancada/sse.mjs`: leitor de SSE próprio, sem dependência nova,
  juntando pedaços cortados no meio do evento.
- `worker/bancada/bateria.mjs`: checagens do `espera` e as checagens sempre
  feitas (um `fim`, no máximo um `erro`, origem em nó numérico, vazamento de
  nome sintético, texto final sem número sem origem, `sem_lista_markdown`).
- `worker/bancada/relatorio.mjs`: relatório legível e `eventos.jsonl`.
- `worker/bancada/executor.mjs`: env da bancada, KV em memória, `ctx.waitUntil`
  aguardado antes da pergunta seguinte e restauração do `fetch` original.
- Exemplo versionado: `worker/bancada/exemplo/retrato.json` (três centros
  fictícios, `30.9xx`, sem nome ou número real), `perguntas.json` (4 perguntas)
  e `roteiro.json` (12 respostas do `/api/chat`, sem rede).
- Script `npm --prefix worker run bancada` (`node bancada/rodar.mjs`), linha
  `worker/bancada/saida/` no `.gitignore` e seção curta no `worker/README.md`.

O retrato real (fora do git) foi lido **só em memória** para conferir a
preparação: nenhuma observação de campo faltante e as sete RPCs do contrato
abriram; os validadores do pacote aceitaram os resultados. Nada do oráculo foi
copiado para o worktree.

## Como rodar

### 1. Roteiro (sem rede — o usado nos testes)

```bash
node worker/bancada/rodar.mjs \
  --roteiro worker/bancada/exemplo/roteiro.json \
  --retrato worker/bancada/exemplo/retrato.json \
  --perguntas worker/bancada/exemplo/perguntas.json
```

O roteiro é consumido em ordem pelas perguntas selecionadas. Para a bateria
real, o roteiro não é usado.

### 2. Local (Ollama deste PC)

```bash
node worker/bancada/rodar.mjs \
  --retrato <retrato.json> \
  --perguntas <perguntas.json>
```

Sem `--roteiro` e sem `--chave`, o corpo do `/api/chat` é repassado para
`http://localhost:11434/api/chat`, **sem** `Authorization`; o
`OLLAMA_API_KEY` do Worker é o valor fictício `bancada-local`. O Ollama deste PC
precisa estar logado no Ollama Cloud.

### 3. Chave (`ollama.com` de verdade)

```bash
node worker/bancada/rodar.mjs \
  --chave <arquivo-com-uma-linha> \
  --retrato <retrato.json> \
  --perguntas <perguntas.json>
```

A chave é lida de uma linha e vai só no cabeçalho do `fetch` para
`https://ollama.com/api/chat`; nunca é impressa, gravada em log ou no relatório.
O `OLLAMA_API_KEY` do Worker é o valor fictício `bancada-chave` e o roteador o
substitui pela chave real apenas no repasse.

Em todos os modos: `--modelo <nome>` (padrão `deepseek-v4.1-flash:cloud`),
`--saida <pasta>` (padrão `worker/bancada/saida/`) e `--so 3,8` (só esses ids).
A saída é `eventos.jsonl` (um registro por pergunta, com eventos na ordem,
tempos, rodadas, ferramentas e chamadas de RPC) e `relatorio.md` (tabela de
resultado e, por pergunta, texto final, blocos e falhas). Com o retrato real, a
saída carrega dado financeiro; por isso a pasta é ignorada pelo git.

## O que a bateria confere

Além de `espera.numeros`, `espera.sem_erro` / `espera.erro`, `max_segundos`,
`texto_contem` / `texto_nao_contem` e `sem_lista_markdown`:

- exatamente um evento `fim` e no máximo um `erro`;
- todo nó de bloco `moeda`, `numero`, `percentual` ou `data` (inclusive contexto
  e células de tabela) com `origem`;
- nenhum nome sintético do retrato em nenhum corpo enviado ao modelo;
- texto final existente e com `semOrigem` vazio (a marca que `marcarTexto`
  produz);
- `sem_lista_markdown` olha linha começando com `-`, `*` ou `N.`.

O cenário aceita `papel`, `usuario`, `centros_visiveis` e `rpc`. `rpc` configura
uma RPC para falhar (`{ "status": 500 }`) ou para lançar `TypeError`
(`{ "rede": true }`), usado na pergunta 20. Com `centros_visiveis`, o roteador
filtra `resumo_projetos_v2` e `get_pedido_bolsas_v2` e responde ao centro fora
da lista com `400`, `P0001`, `"Acesso negado"`, como o guard da RPC real. O
papel do cenário também vira `ANALISE_PAPEIS`, senão o próprio Worker recusaria
o professor antes de chegar à RPC.

## Testes

- `npm ci` e `npm --prefix worker ci` rodaram no worktree novo, sem erro.
- `npm --prefix worker test`: **10 arquivos, 134 testes, todos verdes**. O
  arquivo novo `worker/tests/bancada.test.js` tem 15 testes: roteador (5),
  retrato (1), pergunta de ponta a ponta no modo roteiro (4), checagens sempre
  feitas (4) e leitor de SSE (1). Sem rede.
- `npm run lint`: **0 erro** (a configuração da raiz cobre `worker/src/` e
  `worker/tests/`; `worker/bancada/` não está na lista do ESLint).
- `node worker/bancada/rodar.mjs --roteiro worker/bancada/exemplo/roteiro.json
  --retrato worker/bancada/exemplo/retrato.json --perguntas
  worker/bancada/exemplo/perguntas.json`: **4/4 passaram**, saída 0, relatório
  e `eventos.jsonl` gerados.

O teste de vazamento escreve `Bolsista Bancada 001` na resposta do roteiro que
pede uma ferramenta; o nome entra na mensagem `assistant` do pedido seguinte ao
modelo e a checagem o pega. Há também testes diretos de falta de `fim`, número
esperado ausente, bloco sem origem, texto com número sem origem, RPC
configurada para falhar (a falha de ferramenta aparece no relatório) e SSE
cortado em pedaços.

## Mutante

Desliguei a checagem de vazamento (`verificarVazamento` com `return` no começo),
rodei

```bash
npx vitest run tests/bancada.test.js -t "pega nome sintético"
```

e o teste quebrou como esperado: **1 falhou, 14 pulados**, com
`expected true to be false` em `resultado.ok`. Restaurei a checagem e
`npm --prefix worker test` voltou a **134/134**.

## Limitações (o que a bancada não simula)

- **CSP do navegador**: a bancada chama o `fetch` do Worker direto no Node; não
  há CSP, preflight de browser, nem a política de CORS sendo aplicada pelo
  navegador. O `Origin: http://localhost:5173` é enviado, mas quem valida é o
  código do Worker.
- **KV eventual**: o `ANALISE_USO` é um `Map` em memória, consistente na hora e
  sem TTL real. Não simula o cache de outra região (~60 s) nem o get/put não
  atômico do KV do Workers.
- **Runtime real do Workers**: é Node, não `workerd`; não há teto de CPU,
  `compatibility_date`, `request.signal` com a semântica do workerd nem
  cobrança de tempo. O prazo de 120 s e o `AbortSignal` são os do código, mas o
  relógio é o do PC.
- **RLS/PostgREST**: o retrato é um retrato. O RLS e os guards são aproximados
  por `centros_visiveis` (professor) e pelos 404/400 do roteador; não há JWT,
  login nem banco. Centros que o oráculo não capturou respondem 404.
- **Modelo**: os testes usam roteiro, então não exercitam o DeepSeek de
  verdade. Os modos local e chave existem, mas não foram chamados nesta tarefa.
  O retrato também não reproduz o comportamento de tool calling do modelo.
- **Tela**: o parser de SSE da bancada é próprio; o parser da tela da Etapa 2
  não é o mesmo código (a tela ainda não existe nesta etapa).
- **Filtro de professor**: `valor_vigente` das bolsas não é recalculado quando
  `centros_visiveis` esconde bolsas; as bolsas em si são filtradas.
- **Texto livre com `[nome]`**: o oráculo trocou nomes por `[nome]`; fora das
  folhas de bolsa da árvore (que recebem o nome sintético), o marcador continua
  como veio. Nenhum nome real entra no worktree.

## O que ficou em aberto

- A **bateria real das 20 perguntas**, com os números do oráculo, é escrita pelo
  Claude depois e fica fora do git. A bancada está pronta para rodá-la com
  `--retrato <oraculo.json> --perguntas <bateria.json>` (local ou `--chave`).
- A pergunta 16 precisa de um cenário com `centros_visiveis`; o exemplo dos
  testes mostra o formato, mas a bateria real ainda não foi escrita.
- Não houve push, deploy, login, produção nem chamada real ao Ollama, conforme a
  tarefa.
