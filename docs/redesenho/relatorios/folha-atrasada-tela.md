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
- `npm --prefix app test`: **245 passaram** em 24 arquivos.
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
  conta em mai/27", a árvore fechando em 52.000 e "Inclui R$ 8.000 de folha que ainda não apareceu no
  balancete de 15/10/2026".

## Desvios do plano da tarefa

- **`docs/redesenho/ESTADO.md`**: fora da lista "Arquivos", atualizado no mesmo commit por exigência do
  `CLAUDE.md` (linha de "Onde está" e "Registro").
- **`app/tests/dados.test.js`**: fora da lista, mudou só a contagem de árvores de exemplo de 8 para 9, por
  causa da árvore nova do 30.910. Necessário para a árvore do exemplo não ficar sem cobertura de fechamento.
- **Centro novo em vez de mexer em um existente**: para cumprir "os outros centros do exemplo não mudam", o
  30.910 foi acrescentado com balancetes e árvore próprios; os 9 centros anteriores ficaram intactos.
- **Nenhuma mudança em `frontend/`, `database/` ou `mcp/`.**

## Em aberto

- A 070 ainda não existe neste worktree; não foi possível rodar a tela contra o payload real da RPC. O código
  é aditivo: sem as chaves, tudo funciona como antes, e a sanitização cobre valor inválido, zero e negativo.
- Não houve teste com login real nem no banco de produção; a conferência foi no modo exemplo.
- Falta a revisão e o "ok" do Victor para juntar/publicar. Nada foi enviado (`sem push`), nada foi aplicado no
  banco e não há migração.
