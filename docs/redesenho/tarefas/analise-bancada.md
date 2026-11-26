# Tarefa: bancada de testes da Análise (`worker/bancada/`)

> Escrita pelo Claude em 25/11/2026. Executor: DeepSeek V4.1 Flash max, no worktree
> `C:/Users/amara/dev/cf-bancada` (branch `redesenho/analise-bancada`). Leia antes: `AGENTS.md`,
> `worker/README.md`, `docs/redesenho/analise-contrato.md` (§4, §5, §7) e `docs/redesenho/analise-plano.md`
> (§5, a bateria de 20 perguntas).

## Por quê

Hoje o único teste de ponta a ponta da Análise é o Victor colar um `.js` no console do navegador logado
(`NãoColocarNoGit/analise/teste-console.js`, no checkout principal). Queremos que uma IA rode a bateria
sozinha, quantas vezes precisar, **com o modelo de verdade** (DeepSeek V4.1 Flash, `think: 'high'`) e
**sem login nem banco de produção**: o Supabase é simulado a partir de um retrato das RPCs.

## O que construir

Um script Node, `worker/bancada/rodar.mjs`, que roda o **próprio `worker/src/index.js`** (o `fetch` do
export default, sem `wrangler`) dentro do Node, com:

1. **`env` montado pela bancada**: `SUPABASE_URL = 'https://bancada.invalid'`, `SUPABASE_ANON_KEY`
   qualquer, `ANALISE_MODELO` (padrão `deepseek-v4.1-flash:cloud`, `--modelo` troca), `ANALISE_PAPEIS =
   'admin'`, `ANALISE_LIMITE_DIA = '100000'`, `ANALISE_USO` = KV em memória (`get`/`put` com as opções que
   `limite.js` usa), `OLLAMA_API_KEY` (ver item 3).
2. **`globalThis.fetch` trocado por um roteador** durante a execução (restaurar no fim):
   - `https://bancada.invalid/auth/v1/user` → usuário fixo do cenário (`{ id, email }`); token
     `Bearer bancada-<papel>`; outro token → 401.
   - `.../rest/v1/app_users?select=role...` → `[{ role: <papel do cenário> }]`.
   - `.../rest/v1/rpc/<nome>` → resposta do **retrato** (item 4), pelo nome e pelo `p_project_id` do corpo.
     RPC sem resposta no retrato → 404 com corpo de erro do PostgREST. Cenário pode mandar uma RPC
     **falhar** (500, ou `rede` lançando `TypeError`) para a pergunta 20.
   - `https://ollama.com/api/chat` → o modelo (item 3).
   - Qualquer outro endereço → lança erro ("bancada: rede fora da lista"). Nada além disso sai do PC.
3. **Modelo**, três modos:
   - **local (padrão)**: repassa o corpo para `http://localhost:11434/api/chat` (o Ollama deste PC, logado
     no Ollama Cloud), **sem** o cabeçalho `Authorization`. `OLLAMA_API_KEY = 'bancada-local'`.
   - **chave**: `--chave <arquivo>` lê a chave de um arquivo (uma linha) e chama `https://ollama.com/api/chat`
     de verdade, como em produção. A chave nunca é impressa, gravada em log nem em relatório.
   - **roteiro**: `--roteiro <arquivo.json>` responde com mensagens prontas (lista de respostas do
     `/api/chat`), para os testes da própria bancada, sem rede.
   Em todos os modos a bancada **guarda cada corpo enviado ao modelo** para a checagem de vazamento.
4. **Retrato** (`--retrato <arquivo.json>`): o formato é o do oráculo
   `C:/Users/amara/OneDrive/Documentos/Antigravity/ControleFinanceiro/NãoColocarNoGit/analise/oraculo-2026-11-25.json`
   (gerado por `oraculo.mjs`, ao lado; leia os dois). `resumo` → `resumo_projetos_v2`; `centros[code].
   situacao|arvore|desembolsos|termos|pendencias` → `situacao_centro_v2|explicar_livre_v2|get_repasses_v2|
   get_termos_contrato_v2|listar_pendencias_v2` (o `project_id` de cada código sai do `resumo`); `bolsas`
   → `get_pedido_bolsas_v2`. O oráculo **tirou os nomes**: a bancada reconstrói `bolsistas` com nomes
   sintéticos determinísticos (ex. `Bolsista Bancada 001`, um por `pessoa`) e o formato que
   `shared/ai-tools/ferramentas/bolsas.js` valida (leia o validador; `holder_id` sintético estável). Se o
   oráculo não tiver um campo que o validador exige, complete com valor neutro e anote no relatório.
   Escopo de professor (pergunta 16): o cenário diz `centros_visiveis: ['30.109', ...]`; o roteador filtra
   `resumo_projetos_v2` e `get_pedido_bolsas_v2` e devolve o erro do guard (`400`, `P0001`, "Acesso
   negado") para centro fora da lista, como a RPC real.
   **Versione também** um retrato sintético pequeno, `worker/bancada/exemplo/retrato.json` (2 ou 3 centros
   fictícios, códigos `30.9xx`, sem nenhum número ou nome real), para a bancada rodar sem o
   `NãoColocarNoGit`. O retrato real **nunca** é copiado para o worktree.
5. **Bateria** (`--perguntas <arquivo.json>`): lista de `{ id, pergunta, cenario?, anteriores?, espera }`.
   `espera` aceita:
   - `numeros`: valores que precisam aparecer em algum bloco (`valor` do nó, tolerância 0,005);
   - `sem_erro` (padrão `true`), ou `erro: '<codigo>'` quando o erro é o esperado;
   - `max_segundos`;
   - `texto_contem` / `texto_nao_contem` (regex, no texto final);
   - `sem_lista_markdown` (texto final sem linha começando com `-`, `*` ou `1.`).
   Checagens **sempre** feitas, além do `espera`: exatamente um `fim`; no máximo um `erro`; todo nó de
   bloco numérico (`moeda|numero|percentual|data`) com `origem`; **nenhum nome sintético do retrato em
   nenhum corpo enviado ao modelo** (vazamento); o texto final sem a marca de "número sem origem" que
   `marcarTexto` produz (leia `shared/ai-tools/texto.js` para saber qual é).
   Versione `worker/bancada/exemplo/perguntas.json` com 4 perguntas sobre o retrato sintético. A bateria
   real das 20 perguntas, com os números do oráculo, **o Claude escreve depois**, fora do git.
6. **Saída** (`--saida <pasta>`, padrão `worker/bancada/saida/`, que vai no `.gitignore`): `eventos.jsonl`
   (um registro por pergunta: eventos SSE na ordem, tempos, rodadas de modelo, ferramentas chamadas),
   `relatorio.md` (tabela pergunta → passou / falhou e por quê, tempo, rodadas; depois o texto final e os
   blocos de cada pergunta legíveis) e o código de saída 0 só se todas passarem. `--so 3,8` roda só essas
   perguntas. As perguntas rodam **uma de cada vez** (nunca em paralelo).
7. A requisição ao Worker sai com `Origin: http://localhost:5173`, `Authorization: Bearer bancada-<papel>`
   e `{ pergunta, anteriores }`; `ctx.waitUntil` guarda as promessas e a bancada espera todas antes da
   próxima pergunta. Ler o SSE como a tela vai ler (parser próprio, sem dependência nova).

## Testes da bancada

`worker/tests/bancada.test.js` (vitest, **sem rede**, modo roteiro): o roteador recusa endereço fora da
lista; o retrato vira as respostas certas; a pergunta com bloco válido passa; um roteiro que escreve um
nome sintético no pedido ao modelo é pego como vazamento (para isso o teste injeta o nome no retrato de um
campo que a máscara **não** cobre, ou chama a checagem direto); falta de `fim` falha; número esperado
ausente falha; RPC configurada para falhar chega como falha no relatório. Mutante: desligue a checagem de
vazamento e confirme que o teste quebra; anote no relatório.

## Arquivos

Pode criar/editar só: `worker/bancada/**`, `worker/tests/bancada.test.js`, `worker/package.json` (script
`"bancada": "node bancada/rodar.mjs"`), `.gitignore` (a linha de `worker/bancada/saida/`),
`worker/README.md` (seção curta "Bancada"), `docs/redesenho/relatorios/analise-bancada.md`. **Não mexa em
`worker/src/` nem em `shared/ai-tools/`**: se a bancada precisar de algo deles, descreva no relatório.

## O que não fazer

- Não chamar o Ollama de verdade (nem local nem `ollama.com`): só o modo roteiro. Quem roda a bateria
  real é o Claude, depois.
- Não fazer push, deploy, login, nem tocar no banco de produção. Não chamar outras IAs.
- Não gravar dado do oráculo em arquivo versionado.

## Pronto quando

- `npm --prefix worker test` e `npm run lint` verdes (a raiz cobre `worker/`).
- `node worker/bancada/rodar.mjs --roteiro <um roteiro de exemplo versionado> --retrato
  worker/bancada/exemplo/retrato.json --perguntas worker/bancada/exemplo/perguntas.json` termina com o
  relatório e saída 0.
- Relatório `docs/redesenho/relatorios/analise-bancada.md`: o que fez, como rodar os três modos, testes
  (números), mutante, limitações (o que a bancada não simula: CSP do navegador, KV eventual, runtime real
  do Workers).
- Um commit `feat(analise): bancada de testes do Worker com Supabase simulado`.
