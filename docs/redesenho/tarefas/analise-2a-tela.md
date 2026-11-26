# Análise, Etapa 2 — A: a tela `#/analise`

Executor: **DeepSeek V4.1 Flash max** (opencode), no worktree `C:/Users/amara/dev/cf-analise-tela`, branch
`redesenho/analise-2a-tela`, criada a partir do `master` de 26/11/2026. Revisor: **MiniMax 3.1 Flash max**.
Quem escreveu esta tarefa e confere tudo no fim é o Claude. Pedido do Victor (26/11): "faça com que eles
testem bem tudo antes de devolver".

**Não use outras IAs** (não chame agy, Codex, claude nem outro opencode). Não faça push, deploy nem
publicação de nada. Não toque no banco de produção nem chame a Edge Function de verdade.

## 0. Leia antes de começar (nesta ordem)

1. `docs/redesenho/analise-contrato.md` **inteiro**: §3 (origens), §6 (blocos), §7 (eventos SSE). É a
   interface que a tela consome. Não mude o contrato.
2. `docs/redesenho/analise-plano.md` §2 e §3 "Etapa 2".
3. `docs/redesenho/estetica.md` **inteiro**, e siga à risca: só tokens de `app/src/estilo/tokens.css`,
   sem `style=` inline, sem hex, sem fonte fora da escala, sem sombra em cartão, número nunca verde. O build
   reprova (`app/scripts/verificar-estilo.mjs`).
4. `app/src/servicos/analise.js` (o cliente SSE já pronto, com 16 testes em `app/tests/analise.test.js`).
5. Como a página do projeto abre origens: `app/src/paginas/Projeto.jsx` (procure `PainelLateral`,
   `DeOndeVem`, `abrirDocumentoDaAba`, `abrirDocumentoDoTermo`, `renderTermoContrato`,
   `itemOrigemDoBalancete`) e os componentes `DeOndeVem`, `Documento`, `Valor`, `Tabela`, `PainelLateral`,
   `AvisoFalha`, `Vazio`, `Esqueleto`, `Botao`, `Campo`, `CabecalhoPagina`, `Cartao`, `Destaque`.
6. Modo exemplo: `carregarExemplo()` em `app/src/servicos/dados.js`, `app/src/servicos/dadosExemplo.js`
   (centros sintéticos e `ARVORES_EXEMPLO`) e `app/scripts/verificar-build.mjs` (garante que nenhum dado de
   exemplo vai para o bundle de produção).

## 1. O que a tela é

A Análise **não é um chat**. É uma área de trabalho: a pessoa faz uma pergunta, vê os passos ao vivo e
recebe **blocos** (número, tabela, texto) em que **todo número abre a origem**: o mesmo "De onde vem" e o
mesmo documento da página do projeto. Requisito do Victor: a origem clicável não é enfeite.

Só o admin vê a Análise por enquanto (decisão do Victor, 25/11). A Edge Function já recusa outros papéis.

## 2. Arquivos (só estes)

- `app/src/paginas/Analise.jsx` e `Analise.css` (novos)
- componentes novos em `app/src/componentes/` **só se** forem reaproveitáveis e pequenos (ex.:
  `BlocoAnalise.jsx`); exporte por `index.js`
- `app/src/servicos/analise.js` (correção da §6 e o desvio para o modo exemplo)
- `app/src/servicos/analiseExemplo.js` (novo, só carregado no modo exemplo)
- `app/src/App.jsx` (rota e guarda), `app/src/componentes/BarraTopo.jsx` (menu só para admin)
- `app/src/paginas/Componentes.jsx` (um exemplo de cada bloco no catálogo, com dados sintéticos)
- `app/tests/**`
- `docs/redesenho/relatorios/analise-2a-tela.md` (novo: o seu relatório)

**Não edite**: `worker/`, `shared/`, `supabase/`, `database/`, `frontend/`, `mcp/`, `Projeto.jsx`,
`DeOndeVem.jsx`, `Documento.jsx`, `vite.config.js`, `tokens.css`, nem os documentos do contrato e do plano.
Se precisar de uma prop nova num componente existente (ex.: `DeOndeVem`), **pare e registre no relatório**
como pedido; resolva sem ela (ver §4.5).

A CSP **não muda**: a Edge Function está em `https://skxiivmkhpegefafdlty.supabase.co/functions/v1/analise`,
na mesma origem já liberada em `connect-src`. Confirme isso lendo `app/vite.config.js` e diga no relatório.

## 3. Acesso

- `BarraTopo.jsx`: o item Análise passa a `apenasAdmin: true`. Teste: professor não vê o item; admin vê.
- `App.jsx`: rota `analise` renderiza `<Analise />` só com `papelConhecido && isAdmin`; quem não é admin vai
  para `#/projetos` (mesmo padrão do `admin`). Enquanto o papel não é conhecido, não renderize a página.
- Se a Edge Function responder `sem_permissao` ou `sem_login`, a tela mostra a mensagem e não oferece "tentar
  de novo" em laço.

## 4. A tela

### 4.1 Cabeçalho e pergunta
- `CabecalhoPagina` com título "Análise" e uma linha de contexto curta (ex.: "Pergunte sobre os centros. Todo
  número abre a origem.").
- Campo de pergunta de várias linhas (`textarea`, use `Campo` se ele aceitar; senão o mesmo estilo),
  rótulo visível "Pergunta", máximo **2.000** caracteres (contador aparece só a partir de 1.800; acima de
  2.000 o botão desabilita e o texto diz quanto passou). Pergunta só com espaços não envia.
- Botão primário "Perguntar". **Ctrl+Enter** (e Cmd+Enter) envia; Enter sozinho quebra linha.
- Logo abaixo do campo, em `--fs-1 --cor-texto-3`, o aviso **literal**: "As perguntas ficam guardadas para
  melhorar a Análise." (decisão do Victor, 26/11). Na mesma linha ou na seguinte: "Limite de 50 perguntas por
  dia."
- Sugestões de pergunta, como `Chip`s clicáveis que só preenchem o campo (não enviam), quando ainda não há
  nenhuma análise na página: "Quanto o 30.109 tem livre hoje, e de onde vem?", "Quais centros estão em atenção
  ou problema, e por quê?", "Onde há folha atrasada hoje, e quanto?", "Quais bolsas terminam nos próximos 60
  dias?". Nada de nome de pessoa.

### 4.2 Enquanto responde
- Uma pergunta por vez: enquanto corre, o botão vira **"Parar"** (secundário). Parar aborta o `fetch` pelo
  `AbortController` passado em `signal`; o que já chegou fica na tela com a nota "Você parou a análise." (sem
  banner de erro: `executarAnalise` devolve `abortada: true`).
- **Passos ao vivo**: uma lista curta, na ordem de chegada, com o `rotulo` em pt-BR que vem no evento `passo`
  ("consultando os centros"). Estados: `inicio` → "…" (indicador discreto, não spinner chamativo), `fim` →
  concluído, `erro` → em `--cor-atencao` com o texto do erro curto. O mesmo `ferramenta`+`rotulo` com
  `inicio` e depois `fim` é **uma** linha que muda de estado, não duas. Região `aria-live="polite"`.
- Tempo decorrido ("12 s"), atualizado a cada segundo enquanto corre; some quando termina e dá lugar ao
  metadado do `fim`: "4 rodadas · 12 s" em `--fs-1 --cor-texto-3`.
- Esqueleto discreto até o primeiro bloco chegar.

### 4.3 Resposta
Ordem na página, para cada análise: pergunta (como título da análise, `--fs-4` ou o que a estética mandar
para título de cartão), **texto final** (evento `texto`) quando chegar, depois os **blocos** na ordem em que
chegaram, depois o rodapé (metadado e feedback). Cada análise é um `Cartao`.

**Bloco `numero`**: `Destaque` (ou o mesmo visual) com o `titulo`, o `numero.valor` grande e clicável pela
origem, o `numero.rotulo` como contexto e, se houver, `numero.contexto` (data ou texto) em linha menor.

**Bloco `tabela`**: `Tabela` com as colunas de `tabela.colunas` (`rotulo`; alinhar à direita as de unidade
`moeda`/`numero`/`percentual`). Cada célula é `Valor` clicável pela origem. Célula com `origem: null` (rótulo
de linha da 1ª coluna) é texto comum, sem botão. Abaixo de 640 px a `Tabela` já vira cartões: confira.

**Bloco `texto`** e **texto final**: parágrafo. Cada intervalo de `semOrigem: [{ inicio, fim }]` (índices em
UTF-16 do JavaScript, sobre o texto já reidratado) é envolvido num `<mark>`/`span` com a classe da estética
para "sem origem" (se a estética não tiver, use sublinhado pontilhado em `--cor-atencao` com
`title="Número sem origem: não veio de um bloco"` e registre no relatório). Intervalos fora do texto,
invertidos ou sobrepostos são ignorados sem quebrar a página. Se sobrar um marcador `⟦P3⟧` no texto (não
devia, o servidor reidrata), mostre "pessoa 3".

**Formatação por `unidade`**: `moeda` → `Valor tipo="moeda"` **com centavos** (a Análise confere ao
centavo); `data` → data completa pt-BR; `percentual` → "12,5%"; `numero` → inteiro/decimal pt-BR; `texto` →
como veio. Valor `null`/não finito → "—" com o motivo (nunca 0).

**Bloco inválido** (sem `tipo` conhecido, tabela sem `colunas`, `linhas` que não são listas, número sem
`valor`): não renderiza, e a análise mostra uma vez, discreto: "Um bloco veio em formato inválido e foi
omitido." Nunca renderize JSON cru.

### 4.4 Erros e cortes (evento `erro` e resultado de `executarAnalise`)
- `limite`, `sem_login`, `sem_permissao`: `AvisoFalha` com a mensagem do servidor; sem "tentar de novo".
- `modelo`, `tempo`, `interno`, `rede`: `AvisoFalha` com a mensagem e "Tentar de novo" (repete a mesma
  pergunta com os mesmos `anteriores`).
- `incompleta`: aviso de **atenção** (não de problema) com a mensagem do servidor; os blocos ficam.
- `interrompida` (corte silencioso, local): aviso com `MENSAGEM_INTERROMPIDA`; o parcial fica.
- Em todos os casos, os blocos e o texto que chegaram **continuam na tela**.

### 4.5 A origem: o clique (contrato §3)
Um só `PainelLateral` e um só `Documento` na página. O clique num valor abre conforme `origem.tipo`:

| `tipo` | O que abrir |
|---|---|
| `no` | `PainelLateral` com `<DeOndeVem arvore={origem.no} />`. Folhas com `ref` já abrem o documento sozinhas dentro do `DeOndeVem`. |
| `livre` | carrega `explicarLivre(origem.project_id)` (de `servicos/dados.js`) com `Esqueleto`, e mostra `DeOndeVem`. Com `caminho` (índices das `partes` desde a raiz): desça a árvore por ele e passe **a subárvore** como `arvore`, com uma linha acima "Parte de: <rótulo da raiz>". Caminho inválido → tente achar a 1ª parte com `chave === origem.chave`; não achou → árvore inteira com a nota "Não achei o item exato; mostrando a origem do livre do centro." Falha da RPC → `AvisoFalha` com "Tentar de novo". |
| `ref` | `origem(origem.ref)` → abre o `Documento` como `abrirDocumentoDaAba` faz no `Projeto.jsx` (título, `documento`, `tipoOrigem`, `fato`, `busca`, `nota`, `valor`, `parte`). Sem `documento` na resposta → `PainelLateral` com a `nota`. Erro → `AvisoFalha`. |
| `termo` | carrega `termosContrato(origem.project_id)`, acha o termo pelo `termo_id` e mostra no `PainelLateral` "Do contrato": rótulo do termo, valor, **trecho literal** e, se houver documento, botão "Abrir o documento" (como `abrirDocumentoDoTermo`). Termo não achado → `Vazio` com "Este termo não está mais registrado." Faça um componente de leitura pequeno; **não** mexa no `Projeto.jsx`. |
| `calculo` | `PainelLateral` "Conta": lista das `partes` com o sinal (+/−), o rótulo e o `Valor` de cada uma, **cada parte clicável pela própria origem** (troca o conteúdo do painel; ofereça "Voltar à conta"), e o total. Confira ao centavo `Σ sinal × valor === valor do bloco`; se não fechar, `AvisoFalha` "A soma das partes difere do total." |
| `sem_documento` | sem botão: o `Valor` sai com `semOrigem={origem.motivo}` (balão/título com o motivo). |
| ausente ou desconhecido | sem botão, com o título "Origem não informada". Nunca quebra. |

Cuidados: corrida entre cliques (clicou em A, depois em B antes de A carregar: só B aparece; use contador de
geração como o `Projeto.jsx`); fechar o painel cancela a exibição do que ainda carrega; desmontar a página no
meio não dá `setState` em componente desmontado.

### 4.6 Várias perguntas na mesma página (`anteriores`)
- As análises se acumulam na página, a mais nova **em cima**. O campo fica sempre no topo.
- A cada pergunta nova, envie `anteriores` = as **até 5** análises anteriores terminadas com `ok`, da mais
  antiga para a mais nova, cada uma `{ pergunta: até 500 caracteres, resumo: texto final até 1.000 caracteres
  }` (são os cortes do servidor, `worker/src/nucleo.js`). Análise sem texto final não entra.
- Botão "Nova análise" (secundário, só aparece com ao menos uma análise) limpa a página e o contexto.
- Nada disso é salvo: recarregar a página começa do zero (análises salvas são a Etapa 4).

### 4.7 Feedback
- No rodapé de cada análise com `registro` não nulo (evento `inicio`), depois de terminar (qualquer
  desfecho): "Esta resposta ajudou?" com dois botões pequenos, "Sim" e "Não".
- "Não" abre um campo opcional "O que faltou ou veio errado?" (até 2.000 caracteres) com "Enviar".
  "Sim" envia direto com `nota: 1`. Use `enviarFeedback(registro, { nota, comentario })`.
- Enviando: botões desabilitados. Sucesso: "Obrigado, anotado." e os botões somem. Erro: a mensagem que
  `enviarFeedback` devolve, com os botões de volta.
- `registro` nulo: o rodapé não mostra o feedback (não há onde gravar).

## 5. Modo exemplo (`npm --prefix app run dev:exemplo`)

- `executarAnalise`, no modo exemplo (`import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo'`),
  carrega `analiseExemplo.js` por `import()` dinâmico (mesmo padrão de `carregarExemplo`) e simula o stream
  chamando os mesmos callbacks, com atrasos curtos (200–600 ms) entre eventos e respeitando o `signal`.
  `enviarFeedback` no modo exemplo responde sucesso sem chamar o banco.
- O módulo usa **só dados sintéticos**, dos centros que já existem em `dadosExemplo.js` (ex.: 30.910), com
  origens que **funcionam** no modo exemplo: `no` com um nó de `ARVORES_EXEMPLO`, `livre` com o
  `project_id` de um centro de exemplo (o `explicarLivre` de exemplo responde), `ref` que o `origem` de
  exemplo resolve, `termo` de um termo de exemplo, `calculo` que fecha ao centavo, `sem_documento`.
- Cenários escolhidos pela pergunta (palavra-chave, sem acento e sem caixa), para o Claude testar no
  navegador:
  - padrão: `inicio`, 3 passos (um com `erro` no meio, recuperado), um bloco `numero` (origem `no`), uma
    `tabela` com 3 linhas (1ª coluna rótulo literal; células com origens `livre`, `ref`, `termo`,
    `sem_documento`), um bloco `calculo`, um `texto` com um intervalo `semOrigem`, `texto` final e `fim`;
  - "limite" → `erro limite` logo depois de nada (sem `inicio`);
  - "corte" → alguns blocos e o stream fecha sem `fim` (deve virar `interrompida`);
  - "incompleta" → blocos e depois `erro incompleta` e `fim`;
  - "invalido" → um bloco malformado entre dois bons;
  - "sem registro" → `inicio` com `registro: null` (sem feedback no rodapé).
- `npm --prefix app run build` continua passando no `verificar-build.mjs` (nada do exemplo no bundle). Se o
  `verificar-build` não pegar o seu módulo, acrescente o teste em `app/tests/` que prove que o bundle de
  produção não importa `analiseExemplo.js` (pode ser pela checagem de `import.meta.env` no código, como os
  testes existentes do exemplo).

## 6. Correção no `analise.js` (achada pelo Claude, 26/11)

`enviarFeedback` faz `const chamar = typeof rpc === 'function' ? rpc : supabase.rpc;` e depois
`chamar(...)`. Isso tira o `rpc` do objeto: dentro do supabase-js o `this` fica indefinido e a chamada quebra
em produção (os testes não pegam porque sempre injetam `rpc`). Corrija para
`(nome, args) => supabase.rpc(nome, args)` e escreva o teste que **falha antes da correção**: um objeto falso
cujo `rpc` usa `this` (ex.: `const cliente = { base: 'x', rpc(n, a) { return this.base ? ok : boom } }`),
injetado no lugar do `supabase` real (por `vi.mock('../src/servicos/supabase.js', ...)`).

## 7. Testes exigidos (vitest + happy-dom, em `app/tests/`)

Use `executarAnalise` falso (injetado por prop ou `vi.mock`) que dispara os callbacks na ordem que o teste
mandar. Nada de rede. Cada item abaixo vira pelo menos um teste:

1. Acesso: professor não vê o item "Análise" no menu; admin vê; a rota `#/analise` para professor navega para
   `#/projetos`; com o papel ainda carregando, a página não renderiza.
2. Pergunta: vazia/só espaços não envia; 2.001 caracteres desabilita; Ctrl+Enter envia; Enter não envia;
   chip de sugestão preenche sem enviar; o aviso "As perguntas ficam guardadas para melhorar a Análise." está
   na tela.
3. Envio: `executarAnalise` recebe a `pergunta` (com `trim`), `anteriores` e um `signal`.
4. Passos: `inicio` e `fim` do mesmo passo viram uma linha; passo com `erro` aparece com o erro; a região é
   `aria-live`.
5. Blocos: renderiza `numero`, `tabela` e `texto`; unidade `moeda` com centavos (`514.864,60` →
   "R$ 514.864,60"); `null` vira "—" e nunca "R$ 0,00"; rótulo literal da tabela sem botão; bloco inválido é
   omitido com a nota, e os vizinhos aparecem.
6. `semOrigem`: o intervalo certo é marcado; intervalo fora do texto ou invertido não quebra; `⟦P3⟧` vira
   "pessoa 3".
7. Origem, um teste por `tipo` da tabela da §4.5: `no` abre `DeOndeVem` com o nó; `livre` chama
   `explicarLivre` com o `project_id` e desce pelo `caminho` (e cai na `chave`, e cai na raiz com a nota);
   `ref` chama `origem` com a ref e abre o `Documento`; `termo` acha o termo pelo id (e o caso "não achado");
   `calculo` lista as partes com sinal, a parte é clicável, "Voltar à conta" volta, e a soma que não fecha
   mostra o aviso; `sem_documento` não tem botão e mostra o motivo; origem desconhecida não quebra.
8. Corrida: clique em A (lento) e depois em B (rápido): só B fica no painel.
9. Erros: cada código da §4.4 mostra o aviso certo, com ou sem "Tentar de novo"; "Tentar de novo" reenvia a
   mesma pergunta e os mesmos `anteriores`; `incompleta` e `interrompida` mantêm os blocos.
10. Parar: o botão vira "Parar" durante a análise, aborta o `signal`, e a nota "Você parou a análise." aparece
    sem banner de erro.
11. `anteriores`: depois de 6 análises `ok`, a 7ª envia só as 5 últimas, da mais antiga para a mais nova, com
    os cortes de 500/1.000; análise com erro e sem texto não entra; "Nova análise" zera.
12. Feedback: "Sim" envia `nota: 1`; "Não" + comentário envia `nota: -1` e o comentário; erro mostra a
    mensagem e devolve os botões; `registro: null` não mostra o feedback.
13. A correção da §6, com o teste que falha sem ela.
14. Modo exemplo: o módulo `analiseExemplo.js` produz, para cada cenário da §5, a sequência de eventos
    esperada (teste direto do módulo, com atrasos zerados), e todas as origens dele apontam para
    `project_id`/nós/termos que existem em `dadosExemplo.js`.

**Prove que os testes mordem**: escolha **4 mutantes** no seu código (ex.: tirar o `apenasAdmin`; trocar o
"—" de `null` por 0; não passar o `signal`; abrir `ref` sem chamar `origem`), rode os testes com cada um,
confirme que algum teste falha, desfaça, e registre no relatório qual teste pegou cada mutante.

## 8. Antes de devolver (obrigatório)

O worktree está fora do OneDrive e começa sem `node_modules`: rode `npm ci` na raiz e `npm ci --prefix app`
(e o que o `npm test` da raiz pedir, ex. `npm ci --prefix worker` e `--prefix mcp`, sem editar nada nessas
pastas). Depois, todos verdes, e cole o resumo de cada um no relatório:

- `npm --prefix app test`
- `npm --prefix app run build` (inclui `verificar-estilo` e `verificar-build`)
- `npm run lint` (raiz)
- `npm test` (raiz)

Também: suba `npm --prefix app run dev:exemplo` e confira que o servidor responde em `#/analise` sem erro no
terminal (você não tem navegador: diga isso no relatório; a conferência visual é do Claude). Derrube o
servidor no fim.

Relatório em `docs/redesenho/relatorios/analise-2a-tela.md`: o que foi feito, arquivos, decisões que você
tomou onde esta tarefa deixou espaço, os 4 mutantes, a saída resumida dos 4 comandos, o que **não** foi
testado, e qualquer pedido de mudança em arquivo proibido (§2). Um commit no fim, na branch
`redesenho/analise-2a-tela`, mensagem `feat(analise): tela #/analise com blocos, origem clicável e feedback`,
com a linha `Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>`. **Sem push.**

Não escreva nada no relatório, nos testes ou nos exemplos que seja dado real: nenhum nome de pessoa, CPF,
valor real de centro, trecho de contrato real. O repositório é público.
