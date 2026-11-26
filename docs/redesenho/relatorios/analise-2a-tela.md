# Análise, Etapa 2-A — relatório da tela `#/analise`

Branch: `redesenho/analise-2a-tela`. Executor: DeepSeek V4.1 Flash max (opencode).
Data: 26/11/2026. Sem push, sem deploy, sem chamar a Edge Function ou o banco de produção.

## 2ª rodada

Correção dos 9 achados da revisão do MiniMax, conferidos pelo Claude no código e no modo exemplo.
Cada item tem teste; os testes marcados com "falhou antes" foram rodados antes da correção e
reprovados. A execução de controle antes das correções deu 15 falhas (13 em `analise-tela`, 1 em
`analise-exemplo` e 1 em `chip`). O único teste que já passava no código atual é o do item 1: ele
existe para matar o mutante do sinal, e o mutante foi rodado e reprovado; o item 5 é um teste
reforçado, e um mutante que limpa os blocos no "Parar" também foi reprovado.

| Item | Correção | Teste que pega |
|---|---|---|
| 1. `calculo` sem teste positivo | A conta que fecha agora exige ausência de `.aviso-falha`; entrou o caso 5.000,30 = 7.000,40 − 2.000,10 | `analise-tela.test.jsx` — "calculo: lista as partes..." e "calculo com parte de sinal -1..." |
| 2. `livre` só com `chave` | Sem `caminho`, `carregarLivre` procura a `chave` na árvore; se não acha, usa a mesma nota de fallback | `analise-tela.test.jsx` — "livre sem caminho, mas com chave..." e "livre sem caminho e com chave inexistente..." (falharam antes) |
| 3. Prefixo `R$` na célula | `BlocoAnalise` só passa `semPrefixo` para `moeda` quando o rótulo da coluna contém `(R$)`; sem isso, mantém `R$` | `analise-tela.test.jsx` — "renderiza número..." e "célula de moeda só perde o R$..." (falharam antes) |
| 4. `valorEsperado` no `DeOndeVem` | `no` e `livre` recebem o valor numérico clicado; o `Documento` de `ref` usa `dados.valor ?? valorEsperado` | `analise-tela.test.jsx` — "no: árvore com valor diferente...", "livre: subárvore com valor diferente..." e "ref: Documento usa o valor clicado..." (falharam antes) |
| 5. Teste de "Parar" vazio | O teste passou a emitir um bloco antes do clique e confere que ele continua na tela | `analise-tela.test.jsx` — "o botão vira Parar... mantém o bloco..." (mutante que limpa `blocos` no `parar` foi reprovado) |
| 6. "Parar" perde a pergunta | Cartão `parada` ganhou "Tentar de novo", que reusa a mesma pergunta e os mesmos `anteriores` | `analise-tela.test.jsx` — "cartão parado oferece Tentar de novo..." (falhou antes) |
| 7. Acessibilidade | "Obrigado, anotado." e o erro do feedback têm `role="status"`; `Chip` só emite `aria-pressed` quando `ativo` é passado | `analise-tela.test.jsx` — testes de feedback e chips; `app/tests/chip.test.jsx` (falharam antes) |
| 8. Aviso de corte embaixo dos blocos | `renderAviso` foi movido para logo depois dos passos, antes do texto final e dos blocos | `analise-tela.test.jsx` — "aviso de corte fica antes do texto final e dos blocos" (falhou antes) |
| 9. Passo com erro no exemplo | O cenário padrão ganhou `termos_contrato` com `estado: 'erro'` ("tempo"), sem `fim` para essa ferramenta | `analise-exemplo.test.js` e `analise-tela.test.jsx` — "mostra o passo de termos que terminou em erro" (falharam antes) |

Antes do ajuste do `Chip`, rodei `grep -rn "<Chip" app/src`: os usos de `Bolsistas`, `Componentes`,
`Projetos` e `Projeto` passam `ativo={...}` booleano; só as sugestões da Análise não passam, que é
justamente o caso que não deve anunciar "não pressionado". Os testes existentes de filtro/chip
continuam verdes.

### Por que o `npm test` da raiz deu 912 + 19 antes

Na primeira execução, os 19 pulos eram:

- **5** de `tests/pt-parser.test.js`, bloco `parsePtFromHtml — DOCX reais`: as fixtures são planos
  reais com nome, telefone, e-mail e CPF, por isso não são versionadas (o próprio teste explica
  em `tests/pt-parser.test.js:12-18`).
- **13** de `tests/rastreabilidade-backfill-064.test.js`, bloco `backfill F2-B — ponta a ponta com
  a 064 no pglite`: o `describe.runIf(temPglite)` não encontrava `.cache/pglite-064`.
- **1** de `tests/origem-busca-064.test.js`, bloco `origem-busca (064) — integração real
  get_origem_v2 -> acharAlvo`: o mesmo PGlite ausente.

Instalei o PGlite com
`npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite`.
Os 14 testes de PGlite então rodaram, mas falharam porque o `mcp/node_modules` não existia e o
`tools/rastreabilidade/documento.mjs` usa o `pdfjs-dist` resolvido a partir do `mcp/package.json`.
Rodei `npm ci --prefix mcp`; a raiz voltou a **926 passados + 5 pulados**, que é o número do
master. Os 5 pulos que restam são só as fixtures reais de DOCX, por decisão de privacidade; não há
mais pulo por falta de dependência no worktree.

## O que foi feito

A tela `#/analise` deixou de ser `EmConstrucao` e virou a área de trabalho pedida:

- cabeçalho e campo de pergunta com limite de 2.000 caracteres, contador a partir de 1.800,
  Ctrl/Cmd+Enter para enviar, Enter para quebrar linha, sugestões em chips e o aviso literal
  "As perguntas ficam guardadas para melhorar a Análise." com o limite diário;
- uma pergunta por vez, botão "Parar" durante o stream, `AbortController` passado em `signal`
  e nota "Você parou a análise." sem banner de erro;
- passos ao vivo com `aria-live="polite"`, linha única por `ferramenta`+`rotulo`, estado
  `inicio`/`fim`/`erro`, tempo decorrido e metadado `N rodadas · N s`;
- análises acumuladas com a mais nova em cima, texto final, blocos `numero`, `tabela` e `texto`,
  bloco inválido omitido com uma única nota discreta, e "Nova análise" limpando a página;
- origem tratada nos seis tipos do contrato: `no`, `livre`, `ref`, `termo`, `calculo` e
  `sem_documento`; `sem_documento` sai sem botão, com o motivo no título, e origem
  ausente/desconhecida também não vira botão e leva o título "Origem não informada";
- painel lateral único, documento único no nível da página, contador de geração para a corrida
  entre cliques e cancelamento do carregamento ao fechar o painel;
- `anteriores` com as até 5 análises `ok` mais recentes, da mais antiga para a mais nova, com os
  cortes de 500/1.000 caracteres;
- feedback com `Sim`, `Não` + comentário opcional, estados de envio/sucesso/erro e nada no
  rodapé quando `registro` é nulo;
- modo exemplo com stream sintético, cenários por palavra-chave e `enviarFeedback` local;
- correção do `enviarFeedback` da §6 (`supabase.rpc` chamado como método do cliente), coberta por
  `analise-feedback-this.test.js`: o cliente falso usa `this` no `rpc`, então o teste falha se o
  método for descolado do objeto.

## Arquivos

Novos:

- `app/src/paginas/Analise.jsx` e `app/src/paginas/Analise.css`
- `app/src/componentes/BlocoAnalise.jsx` e `app/src/componentes/BlocoAnalise.css`
- `app/src/servicos/analiseExemplo.js`
- `app/tests/analise-tela.test.jsx`
- `app/tests/analise-acesso.test.jsx`
- `app/tests/analise-exemplo.test.js`
- `app/tests/analise-exemplo-servico.test.js`
- `app/tests/analise-feedback-this.test.js`
- `docs/redesenho/relatorios/analise-2a-tela.md` (este arquivo)

Alterados:

- `app/src/servicos/analise.js` (modo exemplo e correção do feedback)
- `app/src/App.jsx` (rota e guarda de admin)
- `app/src/componentes/BarraTopo.jsx` (item Análise só para admin)
- `app/src/componentes/Chip.jsx` (ajuste de `aria-pressed` pedido no item 7 da 2ª rodada)
- `app/src/componentes/index.js` (exporta `BlocoAnalise`, `TextoComSemOrigem` e `ValorAnalise`)
- `app/src/paginas/Componentes.jsx` (exemplo dos três blocos com dados sintéticos)
- `app/tests/chip.test.jsx` (novo, 2ª rodada)

A alteração em `Chip.jsx` foi pedida explicitamente no item 7 da 2ª rodada; foi a única mudança
fora da lista original da §2, além dos testes novos. Não editei `ESTADO.md`.

Não editei `worker/`, `shared/`, `supabase/`, `database/`, `frontend/`, `mcp/`, `Projeto.jsx`,
`DeOndeVem.jsx`, `Documento.jsx`, `vite.config.js`, `tokens.css` nem os documentos do contrato e do
plano.

## Decisões onde a tarefa deixou espaço

- **Campo de pergunta**: `Campo` é `input` de uma linha. Usei um `textarea` próprio em
  `Analise.css`, com os mesmos tokens, altura de controle, borda, raio e anel de foco. Não foi
  preciso mudar `Campo.jsx`.
- **Número e percentual**: `Valor` formata moeda e data, não percentual/número. Criei
  `ValorAnalise` em `BlocoAnalise.jsx`, que usa `Valor` para moeda/data e o mesmo visual de
  `Valor` (`.valor`, `.valor--origem`, sublinhado pontilhado) para os demais. O clique continua
  entregando a origem e, nas contas, o `valorEsperado` do bloco.
- **Sem origem**: a estética não tem classe para "sem origem". Usei
  `.bloco-analise__sem-origem` com sublinhado pontilhado de 1 px em `--cor-atencao` e
  `title="Número sem origem: não veio de um bloco"`, como a tarefa autoriza.
- **Passos depois do fim**: mantive a lista de passos visível depois da resposta; o tempo
  decorrido some e o rodapé passa a mostrar o metadado do `fim`, como pedido. A tarefa não manda
  apagar o histórico de passos.
- **Tentar de novo**: só aparece para `modelo`, `tempo`, `interno` e `rede`, os códigos listados
  na §4.4. `interrompida` mostra `MENSAGEM_INTERROMPIDA` sem botão; a mensagem já sugere tentar de
  novo. `limite`, `sem_login` e `sem_permissao` não têm retentativa.
- **Retentativa**: reaproveita o mesmo cartão e os mesmos `anteriores`, em vez de criar uma
  segunda análise repetida. Ao começar de novo, o parcial anterior é limpo.
- **Parar**: além de abortar o `signal`, marca a análise como `parada` na hora; o resultado que
  chegar depois do aborto é ignorado pelo contador de geração. O parcial que já estava na tela
  permanece.
- **Feedback**: além de "Enviar", o campo de comentário tem "Cancelar" para voltar a "Sim/Não"
  sem enviar. O erro mantém o comentário digitado e devolve o botão de envio (ou "Sim/Não", no
  caso do "Sim").
- **Modo exemplo**: `executarAnalise` ganhou um parâmetro interno `atraso` (padrão do módulo:
  300 ms) usado só pelo modo exemplo e pelos testes com atraso zero. Em produção ele não existe
  no fluxo real. O módulo de exemplo usa somente centros sintéticos de `dadosExemplo.js`; a
  origem `ref` aponta para um lançamento de balancete sintético que o `origem` de exemplo resolve
  e abre o `Documento`.
- **Bundle**: não editei `verificar-build.mjs`. Acrescentei um teste que lê `analise.js` e
  confirma que o `import('./analiseExemplo.js')` está sob
  `import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo'`. O build também não gerou
  nenhum chunk com `analiseExemplo`.

## Os 4 mutantes

Cada mutante foi aplicado, os testes rodaram, algum teste falhou e o código foi desfeito. Depois
de desfazer, a suíte inteira voltou a passar.

| Mutante | Teste que pegou |
|---|---|
| Troquei `apenasAdmin: true` por `false` no item Análise da `BarraTopo` | `analise-acesso.test.jsx` — "professor não vê o item no menu..." (o link `#/analise` apareceu) |
| Troquei o `valor` de moeda por `valor ?? 0` no `ValorAnalise` | `analise-tela.test.jsx` — "renderiza número com centavos... null como —" (a célula nula virou `R$ 0,00`) |
| Removi `signal: controlador.signal` da chamada de `executarAnalise` | `analise-tela.test.jsx` — "envia pergunta... AbortSignal" e "o botão vira Parar, aborta o signal..." |
| Fiz o tipo `ref` abrir um painel sem chamar `consultarOrigem` | `analise-tela.test.jsx` — "ref: chama origem com a ref e abre o Documento" (`origemMock` com 0 chamadas) |

## Saída resumida dos comandos da §8

### `npm --prefix app test`

```
Test Files  31 passed (31)
Tests       332 passed (332)
```

### `npm --prefix app run build`

```
Guarda de estilo: nenhuma violação encontrada.
vite v6.4.6 building for production...
✓ 1703 modules transformed.
✓ built in 2.62s
Verificação de build: nenhum dado de exemplo no bundle de produção.
```

O Vite avisou que o chunk principal passou de 500 kB (512,43 kB). É aviso, não falha; o build e o
`verificar-build` terminaram verdes. Nenhum chunk `analiseExemplo` foi emitido (busca em `dist`
não encontrou o nome).

### `npm run lint`

```
> eslint frontend/js/ mcp/ app/ shared/ worker/src/ worker/tests/
```

Sem erros e sem avisos.

### `npm test` (raiz)

```
Test Files  54 passed (54)
Tests       926 passed | 5 skipped (931)
```

## Servidor de exemplo

Subi `npm --prefix app run dev:exemplo` (`vite --mode exemplo`), que ficou pronto em 417 ms em
`http://localhost:5173/controle-financeiro-lapig/v2/`. Conferi sem navegador:

- `GET /controle-financeiro-lapig/v2/` → HTTP 200 (632 bytes);
- `GET /controle-financeiro-lapig/v2/src/paginas/Analise.jsx` → HTTP 200 (151.942 bytes
  transformados);
- `GET /controle-financeiro-lapig/v2/__exemplo/manifesto.json` → HTTP 200 (2.261 bytes).

O terminal do Vite não mostrou erro durante essas requisições. Derrubei o servidor no fim e a
porta 5173 ficou livre. **Não tenho navegador nesta sessão**: a conferência visual de `#/analise`
(1280 px e 390 px, tabela virando cartões, foco preso no painel, chips quebrando linha) fica para
o Claude.

## CSP

Li `app/vite.config.js`. A CSP do build continua com
`connect-src 'self' https://skxiivmkhpegefafdlty.supabase.co`, que é a origem da Edge Function
`https://skxiivmkhpegefafdlty.supabase.co/functions/v1/analise`. A CSP não mudou.

## O que não foi testado

- A Edge Function `analise` de verdade, o SSE real do Worker/Edge, o login real, o limite diário
  real e o RLS do Supabase. Nada disso foi chamado.
- A gravação real do feedback (`analise_feedback_enviar`); os testes usam `enviarFeedback`
  falso ou o modo exemplo.
- A leitura real de PDF/DOCX pelo `Documento` disparada por uma origem `ref`; os testes montam o
  `Documento` e param no carregamento, que é coberto pelos testes existentes de documento.
- A aparência visual, o comportamento em 390 px, as fotos e a leitura "de quem abre pela
  primeira vez" — não há navegador nesta sessão.
- `prefers-reduced-motion` de verdade no navegador.
- A navegação de teclado no painel com foco preso em um navegador real (o teste de DOM não
  substitui isso).

## Pedidos de mudança em arquivo proibido

Nenhum. `DeOndeVem` já aceitava `arvore` e abria as folhas com `ref`; não foi preciso prop nova.
`Campo` não aceita `textarea`, mas isso foi resolvido sem editá-lo. Não alterei
`verificar-build.mjs`; a prova do bundle ficou em teste.

## Fecho do Claude (26/11/2026)

**Revisões.** MiniMax 3.1 Flash max revisou as duas rodadas (só leitura, mutantes numa cópia fora do
worktree). 1ª revisão: 8 achados (nenhum alto), todos conferidos no código; o do `ESTADO.md` ficou com o
Claude, os outros 7 e mais 2 vistos pelo Claude no navegador (aviso de corte depois dos blocos; passo com
erro que não aparecia no exemplo) foram para a 2ª rodada. 2ª revisão: os 9 itens corrigidos, 16 mutantes
mortos, 7 observações novas de gravidade baixa.

**Ajustes do Claude depois da 2ª revisão** (com teste e mutante morto):
- `livre` com `chave` repetida (a 070 repete `linha:<id>`, contrato §3): com várias ocorrências, a tela
  abre só a que tem o valor clicado ao centavo; empate ou nenhuma → árvore inteira com a nota, em vez de
  abrir um nó que pode ser o errado. Mutante "devolve a primeira" pego por 2 testes.
- Erro do feedback com `role="alert"` (assertivo) nos dois caminhos, e teste para o caminho do
  comentário, que não tinha. "Obrigado, anotado." segue `role="status"`.
- Exemplo com os rótulos e o nome de ferramenta que o Worker emite (`worker/src/laco.js`): "lendo os
  termos do contrato", "montando o bloco", `explicar_livre`, e o erro com a mensagem da ferramenta.

**Fica anotado, sem mudança** (não acontece hoje): a conferência de divergência do `DeOndeVem` compara
centavos sem olhar a unidade (só nós de moeda chegam lá hoje); cabeçalho como "(R$ mil)" não tira o
prefixo da célula.

**Conferido no navegador** (modo exemplo, 1280 e 390 px): pergunta por Ctrl+Enter e por sugestão, passos
ao vivo com o erro em âmbar, número, tabela (vira cartões no celular), conta, texto com "sem origem";
cada origem abre o que deve (`no` e `livre` no "De onde vem", com "Parte de"; `termo` em "Do contrato";
`ref` no PDF de exemplo na linha certa; `calculo` com as partes); cenários de corte (aviso antes dos
blocos, parcial preservado), limite e bloco inválido. Console sem erro além do `manutencao.json`, que não
existe no servidor de desenvolvimento.

**Testes no fim**: app 335 passados; build com `verificar-estilo` e `verificar-build` verdes; lint limpo;
raiz 926 passados + 5 pulados (fixtures DOCX reais fora do git).

**Não testado**: a Edge Function de verdade com o login do Victor (pergunta real, feedback gravado no
banco, PDF real de produção). É o "pronto quando" da Etapa 2: o Victor faz 5 perguntas com o próprio login.
