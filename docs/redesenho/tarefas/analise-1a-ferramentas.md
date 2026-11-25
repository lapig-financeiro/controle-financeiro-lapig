# Análise 1a — pacote de ferramentas `shared/ai-tools/` (25/11)

Worktree `C:/Users/amara/dev/cf-analise-a`, branch `redesenho/analise-1-a` (já criada a partir do `master`).
Relatório em `docs/redesenho/relatorios/analise-1a.md`, commit novo. **Sem push, sem deploy, sem `CF_*` reais,
sem chamar a produção.** Outro executor faz o Worker em paralelo (`worker/`): não toque lá.

Leia antes, inteiros: `AGENTS.md`, `docs/redesenho/analise-plano.md` e **`docs/redesenho/analise-contrato.md`** (é a
especificação desta tarefa; siga à risca, e se algo nele estiver errado ou impossível, pare e escreva no
relatório em vez de inventar outra interface).

## Para quê

A Análise do site novo responde perguntas com blocos (número, tabela, texto) e **todo número precisa abrir o
mesmo "De onde vem" do site**. O modelo de IA nunca escreve número: ele cita ids de nós que as ferramentas
registram. Este pacote é a única ponte entre as RPCs e o modelo. O Worker o importa; a tela recebe os blocos.

## Arquivos (só estes)

- `shared/ai-tools/index.js` — `criarSessao`, `INSTRUCOES`, `especificacoes` (contrato §4 e §8).
- `shared/ai-tools/ferramentas/*.js` — uma por ferramenta do contrato §4.
- `shared/ai-tools/nos.js` — registro de nós, ids, origem (§2 e §3).
- `shared/ai-tools/blocos.js` — `criarBloco`, validação e recusas (§6); `calcular` (§3, `calculo`).
- `shared/ai-tools/mascara.js` — §5.
- `shared/ai-tools/texto.js` — `marcarTexto` (números sem origem).
- `shared/ai-tools/README.md` — curto: o que é, como usar, o que não faz.
- `tests/ai-tools-v2/*.test.js` — testes (a raiz roda `tests/**/*.test.js`).
- `tests/fixtures/ai-tools-v2/*.json` — **só dados sintéticos** (nomes falsos tipo "Pessoa Exemplo 1",
  centros `30.9xx`).
- `package.json` da raiz: **só** acrescentar `shared/` ao script `lint`.
- `docs/redesenho/relatorios/analise-1a.md`.

Precisou de outro arquivo? Pare e registre no relatório.

## O que fazer

1. **Formato dos resultados das RPCs.** Descubra o formato real de cada RPC do contrato §4 lendo as migrações
   (`database/063_*` a `database/070_*`: procure `create or replace function public.<nome>`), os validadores de
   `app/src/servicos/dados.js` e os exemplos sintéticos de `app/src/servicos/dadosExemplo.js`. Monte os fixtures a
   partir de `dadosExemplo.js` (já são sintéticos). Anote no relatório o formato usado de cada RPC.
2. **`criarSessao({ rpc, hoje })`** com `executar`, `criarBloco`, `calcular`, `marcarTexto`, `reidratar`, como no
   contrato. A sessão guarda os resultados e os nós em memória; ids sequenciais (`r1`, `r1.1`…; `c1`…).
3. **Cada ferramenta**: valida os argumentos (centro por código `30.xxx`/`78.xxx` ou uuid; centro que a
   `listar_centros` da sessão não conhece → erro "não encontrado no seu acesso"), chama a RPC pelo `rpc` injetado,
   registra os nós com a **melhor origem que o resultado oferece** (contrato §3; usar `sem_documento` quando há
   `ref`/árvore é defeito), e devolve `paraModelo`: JSON compacto só com `{ id, valor, rotulo, unidade }` dos nós e a
   estrutura mínima para o modelo entender (sem `origem`, sem `ref`, sem uuid que ele não precise citar).
   - Erro da RPC (`error`, exceção, formato inesperado) → `{ id, erro }`. **Nunca** zero, lista vazia ou "sem dado".
   - `explicar_livre`: registre cada nó da árvore; a origem de cada um é `{ tipo: 'no', no: <o próprio nó com as
     partes> }`. Mais de 200 nós → origem `livre` (contrato §3).
   - `listar_centros`: livre → `{ tipo: 'livre', project_id }`.
   - `bolsas`: nome → nó mascarado; CPF e e-mail nunca entram no `paraModelo`.
4. **`criarBloco`** (contrato §6): resolve ids, monta o bloco com `valor`, `unidade` e `origem` de cada nó, aplica
   todas as recusas listadas. Bloco `texto` passa por `marcarTexto`.
5. **`calcular({ op, ids, sinais? })`**: `soma` e `diferenca` (o primeiro menos os outros), só sobre nós
   `moeda`/`numero` de mesma unidade, em centavos inteiros (sem erro de ponto flutuante). Registra um nó `c<n>` com
   origem `calculo` (partes com `sinal` ±1, cada uma com a própria origem). Nada de regra de negócio aqui.
6. **`mascara.js`** (contrato §5): `⟦P<n>⟧` estável na sessão; CPF com e sem pontuação e e-mail saem de todo texto;
   dicionário de nomes dos bolsistas carregado uma vez por sessão (via `rpc('get_pedido_bolsas_v2')`) na primeira
   ferramenta com texto livre. `reidratar` só troca marcadores em blocos.
7. **`marcarTexto(texto)`**: acha números (moeda `R$ 1.234,56`, `1.234`, `12,5%`, datas `dd/mm/aaaa`, `mmm/aa`) e
   marca os que não são o valor de nenhum nó já citado em bloco ou `calcular` da sessão. Código de centro
   (`30.109`) não é número.
8. **`INSTRUCOES`**: copie as quatro regras de `mcp/src/index.js` **palavra por palavra** e acrescente as do
   contrato §8. `especificacoes()` no formato `tools` do `/api/chat` do Ollama
   (`{ type: 'function', function: { name, description, parameters } }`), descrições em pt-BR, curtas.
9. **ESM puro, sem dependências**, sem `node:` (roda no Worker da Cloudflare e no Node). Sem `fetch` próprio: só o
   `rpc` injetado.

## Testes exigidos (vitest, fixtures sintéticos)

Para cada ferramenta: caminho feliz (nós, ids, origem certa por tipo), erro da RPC vira `erro` (nunca zero) e
argumento inválido. E mais:
- origem: valor da árvore sai com `tipo: 'no'` e as partes; livre da lista com `tipo: 'livre'`; termo com `termo`.
- bloco: id inexistente, célula literal, unidades misturadas, 51 linhas e título com número → recusados.
- `calcular`: soma e diferença ao centavo (`0,1 + 0,2`), unidades diferentes recusadas, origem `calculo` fecha.
- máscara: nome em campo de nome, nome completo e "primeiro + último" em texto livre, CPF `123.456.789-09` e
  `12345678909`, e-mail; o `paraModelo` de **todas** as ferramentas, serializado, não contém nenhum nome, CPF ou
  e-mail dos fixtures (um teste varre todos).
- `reidratar` devolve o nome só no bloco; `paraModelo` segue mascarado.
- `marcarTexto`: número citado não marca; número inventado marca; código de centro não marca.
- `INSTRUCOES` contém as quatro regras idênticas às do MCP (leia o fonte do MCP como texto, como faz
  `tests/ai-tools.test.js`).
- **Mutantes** (descreva no relatório cada um e o teste que o pega): tirar a máscara do nome; aceitar id
  inexistente; erro da RPC virar `[]`; `calcular` em ponto flutuante; `sem_documento` no lugar de `no`.

## Pronto quando

`npm run lint` e `npm test` verdes na raiz (os testes antigos inclusive); relatório com o formato de cada RPC,
o que ficou de fora, os mutantes e os desvios. Commit `feat(analise): pacote de ferramentas da Análise`.
