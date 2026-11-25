# Folha atrasada na projeção — relatório (25/11/2026)

Branch `redesenho/folha-atrasada-tela`, worktree `C:/Users/amara/dev/cf-folha-tela`, a partir do `master`
620f19a. Tarefa: [`docs/redesenho/tarefas/folha-atrasada-tela.md`](../tarefas/folha-atrasada-tela.md).
**Sem push, sem migração e sem chamar outra IA.** Todos os dados de teste e do modo exemplo são fictícios.

## O que foi feito

### Dados (`app/src/servicos/dados.js`)

- `sanitizarFolhaAtrasada`: ausente ou `null` → `null`; objeto com `valor` não numérico, zero ou negativo →
  `null` com `console.warn`, sem derrubar o saldo; valor válido é arredondado ao centavo. `esperado` e `visto`
  viram número ou `null`; `desde_balancete`/`balancete` só aceitam `AAAA-MM-DD`, e `mes_inicio`/`mes_fim` só
  `AAAA-MM-01`.
- `sanitizarFolhaConferencia`: aceita `feita`, `sem_balancete_anterior` e `sem_balancete`; qualquer outra coisa
  vira `null` com aviso.
- `sanitizarSaldoLivre` é aplicado no `saldoLivre` nos dois caminhos (RPC e modo exemplo). Sem as chaves, elas
  viram `null` e nada muda na tela.

### Conta (`app/src/servicos/projecao.js`)

- `lerFolhaAtrasada` é defensivo também aqui: chave ausente, `null`, objeto inválido ou valor ≤ 0 valem zero.
  Com a 070, o banco já somou o valor em `compromissos_bolsas` e no livre; a projeção só precisa saber quanto
  ele tira do caixa e do orçamento.
- A checagem "A soma das bolsas difere do compromisso da janela" passou a comparar
  **soma das bolsas + folha atrasada** com `compromissos_bolsas`. Sem isso, todo centro com 070 acusaria
  diferença à toa; a mensagem do aviso real também diz "e da folha atrasada" quando ela existe.
- No **1º mês**, a folha atrasada sai do dinheiro em conta **antes dos desembolsos que entram antes da folha**
  (`saldoConta = saldoConta − atrasada + antes`) e antes da folha do mês. Ela também abate o orçamento antes
  do teste de limite do mês (`orcamento − atrasada < folha`).
- O mês ganhou `folha_atrasada` (o valor no 1º mês, `0` nos outros) e o retorno ganhou `folha_atrasada`
  (o valor ou `0`, inclusive nos estados `sem_bolsas`/`dado_incompleto`).
- `mes_falta`, `falta_valor`, `cabe_ate`, `limite`, `depende_de`, `mes_mais_apertado`, `sobra_orcamento`,
  `em_conta_apos_folha`, `em_conta_fim` e o orçamento passam a refletir a saída. Sem a chave, os números são
  os de hoje — os testes antigos passaram sem mudança e há um teste comparando o mesmo caso com
  `folha_atrasada: null`, sem a chave e com valor inválido.

### Tela (`Projeto.jsx`, `Projeto.css`, `GraficoProjecao.jsx`)

- A tabela "Ver mês a mês em tabela" ganhou a coluna **"Folha atrasada (R$)"** somente quando algum mês tem
  valor > 0; o 1º mês mostra o valor e os demais `—` (não existe coluna vazia em todos os meses).
- "Como a conta é feita" ganhou a frase da folha atrasada: valor, balancete em que ela não aparece, saída do
  caixa no 1º mês antes dos desembolsos e da folha, e abatimento do orçamento de Bolsas.
- O painel da rubrica de bolsas mostra **"Inclui R$ X de folha que ainda não apareceu no balancete de
  DD/MM/AAAA."** depois do "Cabe até"; o texto de cobertura do grupo (quando a tela explica o compromisso de
  bolsas) e o caminho com a árvore do "De onde vem" mostram a mesma frase. Nada repete o aviso do banco: ele
  continua só em `avisosRpc`.
- `Projeto.css` ganhou `.projeto__folha-atrasada-painel` com `--fs-2`, `--lh-2` e `--cor-texto-2`. Nenhuma
  medida, cor ou peso fora dos tokens.

### Modo exemplo (`dadosExemplo.js`)

- Novo centro sintético **30.910 — Restinga Costeira Sul** (ID `00000000-0000-4000-8000-000000030910`):
  caixa de 60.000, rendimento 0, janela nov/26–ago/27, duas bolsas de 4.000/mês por 10 meses (folha mensal
  de 8.000), orçamento de 140.000 (previsto 400.000 − realizado 260.000), compromissos de 88.000
  (80.000 de bolsas + **8.000 de folha atrasada**), livre de 52.000. `folha_conferencia: 'feita'`;
  `folha_atrasada` de 8.000 paga depois do balancete de 15/10/2026, referente a out/26; aviso da 070 em
  `avisos`; dois balancetes (set e out/26) e cronograma já recebido.
- A projeção do exemplo mostra falta em mai/27 (cabe até abr/27); sem a folha atrasada, a falta seria em
  jun/27. Os outros centros não mudaram.
- O 30.910 ganhou uma árvore em `ARVORES_EXEMPLO` que fecha ao centavo (400.000 − 260.000 − 88.000 =
  52.000; 80.000 + 8.000 = 88.000), para o painel não abrir "Centro de custo não encontrado".

### Testes

- `app/tests/projecao.test.js`: 4 testes novos de folha atrasada (caixa no 1º mês, orçamento, soma sem falso
  aviso + aviso real, e o caso sem a chave/`null`/inválido idêntico ao de hoje) e 1 teste do centro de exemplo
  (valor somado no compromisso e no livre, árvore, projeção e falta em mai/27). O teste geral do exemplo passou
  a somar a folha atrasada na conferência de `compromissos_bolsas`.
- `app/tests/projecao-tela.test.jsx`: 2 testes novos (coluna "Folha atrasada" só no 1º mês, frase no "Como a
  conta é feita", "Inclui R$ ..." no painel e aviso do banco aparecendo uma única vez; e a ausência da coluna
  e da frase quando não há folha atrasada).

## Comandos

- `npm run lint`: sem erro nem aviso.
- `npm test` (raiz): **685 passaram, 19 pulados**; 43 arquivos passaram e 1 foi pulado.
- `npm --prefix app test`: **254 passaram** em 24 arquivos.
- `npm --prefix app run build`: verde; guarda de estilo sem violação e verificação de build sem dado de
  exemplo no bundle.
- `bolsistas.test.jsx` estourou o timeout de 5 s uma vez na primeira execução completa depois de mexer no
  exemplo; passou sozinho e nas execuções completas seguintes. É a instabilidade antiga da suíte, fora desta
  tarefa.

## Conferência visual

Servidor `npm --prefix app run dev:exemplo` (porta 5173) e Chrome headless.

- **1280 px**: centro 30.910 abre com livre de R$ 52.000 (balancete de out/26), dinheiro em conta de
  R$ 60.000, cartão "Bolsas por mês" com "Cabem até abr/27 · falta dinheiro em conta em mai/27", aviso do
  banco no topo da aba Dinheiro, tabela de rubricas com 88.000 comprometidos e 52.000 livres e a seção da
  projeção coerente. Sem erro de layout.
- **390 px** (CDP, `Emulation.setDeviceMetricsOverride`, não recorte): `innerWidth` e `scrollWidth` = 390, sem
  rolagem horizontal da página. A tabela mês a mês mostra o cabeçalho `Mês | Entra (R$) | Folha atrasada (R$)
  | Folha (R$) | Em conta depois da folha (R$) | Orçamento de Bolsas que resta (R$)`, com 8.000 na coluna
  "Folha atrasada" em nov/26 e "—" em dez/26. O painel de Pessoal mostra "Cabe até abr/27 · falta dinheiro em
  conta em mai/27", a árvore fechando em 52.000 e "Inclui R$ 8.000,00 de folha que ainda não apareceu no
  balancete de 15/10/2026".

## 2ª rodada (25/11/2026 — revisão do GPT-6.2 Sol, conferida pelo Claude)

> **A 3ª rodada desfez os dois pontos estruturais abaixo**: `depende_de` voltou a falar só de desembolso
> depois da folha (sem `antes_da_folha`), e `falta_valor` voltou a ser só a falta da folha regular. A
> sanitização também passou a aceitar só `number` finito, sem string. A seção "3ª rodada" descreve o estado
> final.

### Conta (`projecao.js`)

- **A folha atrasada sai antes dos desembolsos do dia 07, e a falta é medida ali.** No 1º mês a conta faz
  `caixa − folha_atrasada`; se o resultado for negativo, registra a falta naquele ponto. Só depois entram os
  desembolsos com vencimento até o dia 07 e, por fim, a folha regular. Antes, o desembolso do dia 05 entrava
  junto e podia esconder a falta da folha atrasada.
- **Caso da revisão** (caixa 5.000, folha atrasada 8.000, desembolso 30.000 no dia 05, folha regular 8.000,
  janela de um mês): `mes_falta` = dez/26, `falta_valor` = 3.000, `em_conta_apos_folha` = 19.000 e
  `depende_de` = `{ parcela: 1, mes: '2026-12', antes_da_folha: true }`. `cabe_ate` = nov/26, como no modelo
  atual de `depende_de` (o mês só fecha com o desembolso).
- **`falta_valor` é o maior entre as duas faltas do mês**: a da folha atrasada (medida logo depois dela) e a da
  folha regular (medida depois dos desembolsos do dia 07). Sem o desembolso de 30.000, o mesmo caso reporta
  11.000 (3.000 da atrasada + 8.000 da folha), não 3.000.
- **`depende_de` ganhou o caso "antes da folha".** O modelo antigo só olhava desembolsos que entram depois da
  folha. Agora, se a falta nasceu na folha atrasada e os desembolsos que entram antes da folha pagam a folha
  regular e não deixam mês seguinte negativo, o primeiro desembolso que fecha essa conta vira
  `depende_de` com `antes_da_folha: true`. Se nenhum desembolso resolve, ou se algum mês seguinte fica
  negativo, continua `null`. A escolha preserva a semântica existente ("com esse desembolso, a conta segue") e
  evita dizer que o mês depende de um dinheiro que não o salva.
- A frase da página para esse caso diz "faltam R$ X,00 para a folha atrasada; o desembolso N entra antes da
  folha e, com ele, a conta segue até ...". O cartão continua com a frase curta "mês depende do desembolso N".

### Dados (`dados.js`)

- `valor`, `esperado` e `visto` só aceitam `number` finito ou string numérica lida pelo `parseValorBR` (o
  mesmo leitor de dinheiro do resto da camada). `true`, array, objeto, `NaN` e `Infinity` invalidam a
  `folha_atrasada` inteira com `console.warn`; nenhum caminho lança exceção que derrube o saldo (a
  sanitização da chave inteira está em `try/catch`).
- O `valor` é arredondado ao centavo **antes** do teste `> 0`: `0.004` vira `0` e é descartado; `0.005` vira
  `0.01` e é aceito. `valor: '8000'` vira `8000` (e `'8.000'` também, pelo `parseValorBR`).
- A conta repete a regra estrita em `lerFolhaAtrasada`, para chamadas diretas sem passar pela camada de dados:
  `true`, array ou objeto viram zero, sem contaminar o saldo.
- Testes em `app/tests/dados.test.js` para `true`, `[8000]`, `{ toString: null }`, `{ valor: 0.004 }`,
  `{ valor: '8000' }`, `{ valor: 0.005 }`, campos `esperado`/`visto` inválidos e objeto que lança ao ler
  `valor`; todos conferem `console.warn` e ausência de exceção.

### Tela

- **`sem_bolsas` não esconde a folha atrasada**: o estado continua `sem_bolsas`, mas o motivo agora diz
  "Há R$ 8.000,00 de folha atrasada que ainda vai sair do caixa." (com centavos). O cartão "Bolsas por mês",
  o motivo da seção e o painel mostram essa frase; o gráfico continua ausente porque não há mês a mês.
- **Centavos nas frases e no painel**: a frase "Inclui R$ X de folha...", a regra do "Como a conta é feita" e
  a frase do caso "desembolso antes da folha" usam `centavos: true`. As frases gerais da projeção e a célula da
  tabela "Folha atrasada (R$)" continuam **sem** centavos, como antes e como manda `estetica.md` para célula de
  tabela; assim, sem `folha_atrasada`, nenhum texto muda. O teste novo confere a célula específica, não a linha
  inteira.
- A frase do painel da rubrica é buscada dentro de `.projeto__subrubricas` (rubrica `a.bolsas`), não no texto
  do painel inteiro, para não passar por causa da frase da cobertura do grupo.
- Testes de tela: célula por `data-rotulo="Folha atrasada (R$)"` e `—` na linha seguinte; frase dentro da
  rubrica com `20.000,00`; motivo de `sem_bolsas` com `8.000,00`; a regra do "Como a conta é feita" com
  centavos; e a frase do caso "desembolso antes da folha" com `3.000,00` e "antes da folha".

### Testes e conferência desta rodada

- `npm run lint`: limpo.
- `npm test` (raiz): **685 passaram, 19 pulados**.
- `npm --prefix app test`: **250 passaram** em 24 arquivos.
- `npm --prefix app run build`: verde, sem violação de estilo e sem dado de exemplo no bundle.
- Nenhuma outra IA foi chamada; nada foi enviado (`sem push`). O `PEDIDO-rev-tela.txt` que apareceu no
  worktree é só o pedido de revisão: não foi versionado.

## 3ª rodada (25/11/2026 — 2ª revisão do GPT-6.2 Sol, conferida pelo Claude)

A 2ª rodada tinha estendido `depende_de` com `antes_da_folha` e feito `falta_valor` guardar a maior das duas
faltas. Isso misturava a falta da folha atrasada com a falta da folha regular e produzia frases erradas (por
exemplo, "faltam X no dia 07" quando a falta era a atrasada, ou "o desembolso resolve" quando o orçamento
estourava no mesmo mês). A 3ª rodada simplificou.

### Conta (`projecao.js`)

- **Desfeitos `antes_da_folha` e a "maior das duas faltas".** `mes_falta`, `falta_valor`, `cabe_ate`,
  `limite` e `depende_de` voltaram a falar **só da folha regular**, exatamente como antes da 2ª rodada.
  `depende_de` volta a olhar apenas desembolsos que entram **depois** da folha no próprio mês da falta.
- **A ordem do 1º mês continua**: sai a folha atrasada → entram os desembolsos com vencimento até o dia 07 →
  sai a folha regular. O caixa pode ficar negativo depois da atrasada e a checagem da folha regular usa esse
  saldo, como hoje.
- **Campo novo `falta_folha_atrasada`** = `max(0, folha_atrasada − dinheiro em conta no início do 1º mês)`,
  arredondado ao centavo. Quando é zero (inclusive sem balancete ou sem bolsas), não há frase nova.
- **Campo de apoio `folha_atrasada_coberta_por`** = `{ parcela, data }` do primeiro desembolso que entra antes
  da folha e deixa o mês capaz de pagar a atrasada **e** a folha regular; `null` quando nenhum cobre. É o dado
  que a frase precisa para citar "desembolso N (data)".
- **Critério da cobertura**: a frase "Ela fica paga…" só aparece quando os desembolsos de antes da folha
  deixam o mês também capaz de pagar a folha regular. No caso (a), o desembolso de 3.000 empata a atrasada de
  3.000, mas deixa a folha regular de 1.000 descoberta; por isso a frase é "Nenhum desembolso previsto antes
  da folha cobre essa falta", como a revisão pediu. Sem essa condição, a tela diria que a atrasada está paga
  enquanto a folha regular do mesmo dia 07 ainda falta.
- **Casos da revisão, conferidos em teste:**
  - (a) caixa 5.000, atrasada 8.000, desembolso 3.000 no dia 05, folha regular 1.000:
    `falta_folha_atrasada` 3.000, cobertura `null`, `mes_falta` dez/26, `falta_valor` 1.000, `cabe_ate`
    nov/26, `limite` caixa; a folha regular fecha com 5.000 − 8.000 + 3.000 = 0 e falta 1.000.
  - (b) caixa 5.000, atrasada 8.000, folha 8.000, desembolso 30.000 no dia 05, orçamento 10.000:
    `falta_folha_atrasada` 3.000, cobertura `{ parcela: 1, data: '2026-12-05' }`, `mes_falta` nulo, `limite`
    orçamento, `cabe_ate` nov/26.
  - (c) caixa 5.000, atrasada 8.000, folha mensal 8.000, desembolso 11.000 no dia 05, dois meses: cobertura
    `{ parcela: 1, data: '2026-12-05' }`, dezembro em `em_conta_apos_folha` 0, `mes_falta` jan/27,
    `falta_valor` 8.000, `cabe_ate` dez/26.

### Tela

- A frase própria da atrasada é um parágrafo separado, acima dos botões "Contar" e **fora** da frase do limite
  das folhas regulares:
  "O dinheiro em conta hoje não paga a folha atrasada: faltam R$ X,00. Ela fica paga se o desembolso N
  (DD/MM/AAAA) entrar antes." ou "… Nenhum desembolso previsto antes da folha cobre essa falta."
- A frase só aparece com `falta_folha_atrasada > 0`; sem a chave, nada muda. A frase regular continua sem
  mencionar a atrasada.

### Dados (`dados.js`)

- `valor` só aceita `number` finito (a RPC manda jsonb numérico). String, boolean, array ou objeto fazem a
  `folha_atrasada` inteira virar `null` com `console.warn`.
- Se só `esperado` ou `visto` forem inválidos, o objeto é mantido com o `valor` e o campo inválido vira
  `null`, com aviso próprio.
- O valor é arredondado ao centavo antes do teste `> 0` (`0.004` → `0`, descartado; `0.005` → `0.01`,
  aceito). Tudo dentro de `try/catch`.
- Testes de `dados.test.js` verificam **um `console.warn` por entrada inválida** (não um aviso qualquer no
  fim), incluindo `true`, `[8000]`, `{ toString: null }`, `{ valor: '8000' }` e o objeto que lança ao ler
  `valor`; e conferem `esperado`/`visto` inválidos mantendo o `valor`.

### Testes desta rodada

- Os três cenários (a), (b) e (c) têm teste de conta em `projecao.test.js` e teste de tela em
  `projecao-tela.test.jsx` (frase da atrasada, frase regular separada e valores).
- O teste de igualdade sem a chave continua: sem `folha_atrasada`, `null`, `0`, string, boolean ou array
  produzem o mesmo resultado de hoje.
- `npm run lint`: limpo.
- `npm test` (raiz): **685 passaram, 19 pulados**.
- `npm --prefix app test`: **254 passaram** em 24 arquivos.
- `npm --prefix app run build`: verde, sem violação de estilo e sem dado de exemplo no bundle.
- Nenhuma outra IA foi chamada; `PEDIDO-rodada3.txt` não foi versionado.

## Desvios do plano da tarefa

- **`docs/redesenho/ESTADO.md`**: fora da lista "Arquivos", atualizado no mesmo commit por exigência do
  `CLAUDE.md` (linha de "Onde está" e "Registro").
- **`app/tests/dados.test.js`**: fora da lista, ganhou os testes de sanitização da `folha_atrasada` e mudou
  a contagem de árvores de exemplo de 8 para 9, por causa da árvore nova do 30.910. Necessário para a árvore
  do exemplo não ficar sem cobertura de fechamento.
- **Centro novo em vez de mexer em um existente**: para cumprir "os outros centros do exemplo não mudam", o
  30.910 foi acrescentado com balancetes e árvore próprios; os 9 centros anteriores ficaram intactos.
- **Nenhuma mudança em `frontend/`, `database/` ou `mcp/`.**

## Em aberto

- A 070 ainda não existe neste worktree; não foi possível rodar a tela contra o payload real da RPC. O código
  é aditivo: sem as chaves, tudo funciona como antes, e a sanitização cobre valor inválido, zero e negativo.
- Não houve teste com login real nem no banco de produção; a conferência foi no modo exemplo.
- Falta a revisão e o "ok" do Victor para juntar/publicar. Nada foi enviado (`sem push`), nada foi aplicado no
  banco e não há migração.
