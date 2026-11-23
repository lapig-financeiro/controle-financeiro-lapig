# Projeção das bolsas — "até quando as bolsas cabem" na página do projeto (23/11, pedido do Victor)

Worktree `C:/Users/amara/dev/cf-projecao`, branch `redesenho/projecao-bolsas` (criada do `master` 8aab090,
`node_modules` já instalados na raiz e em `app/`). Relatório em `docs/redesenho/relatorios/projecao-bolsas.md`,
**um commit no fim** (`feat(redesenho): ...`). **Sem push.** **Não chame outras IAs.** Nenhum dado real (nome de
pessoa, código ou nome de centro real, valor copiado de balancete) em teste, fixture ou modo exemplo.

Leia antes, inteiros: `docs/redesenho/README.md` (§2 e §4), `docs/redesenho/estetica.md` (tokens, gráficos,
"números nunca são verdes", proibições: nada de `style=` inline, hex fora de `tokens.css`, fonte fora da escala —
há teste que reprova), `app/src/paginas/Projeto.jsx` (cartões do topo, aba Dinheiro, `resumirRepasses`),
`app/src/servicos/dados.js` (`saldoLivre`, `repasses`, modo exemplo), `frontend/js/planejamento-dinheiro.js`
(`situacaoDasParcelas`: a situação de cada desembolso já sai dali; a tela antiga de planejamento faz conta parecida
em `dinheiroDoCentro`, leia como referência de regra). O esboço aprovado pelo Victor está em
`NãoColocarNoGit/esbocos/projecao-30109-v2.html` (abra no navegador; é a referência de **organização**, não de
visual: o visual é o do `app/`; os números dele são de um centro real e **não podem ir para teste nem exemplo**).

## Por quê

A página do projeto diz quanto está livre, mas não responde "até quando as bolsas cadastradas cabem?". Há dois
limites e vale o que chega primeiro: o **orçamento da rubrica de bolsas** (previsto − realizado) e o **dinheiro
em conta**, que muda mês a mês com a folha (todo dia 07) e com os **desembolsos** do plano. O Victor escolheu:
a resposta entra **no que já existe** (cartão "Bolsas por mês" e uma coluna na tabela de rubricas) e o **gráfico
mês a mês** fica na aba Dinheiro, com botões para escolher o que conta como entrada.

**Vocabulário:** o dinheiro que o financiador manda, por parcela do cronograma, se chama **desembolso** na tela,
nunca "parcela" nem "repasse". O cartão "Repasses" passa a se chamar **"Desembolsos"**, e as mensagens visíveis
que dizem "repasses" também mudam. Nomes internos (`repasses()`, `get_repasses_v2`, variáveis) ficam.

## Banco: nada muda

Sem migração. A conta é uma função pura no `app/`, alimentada pelo que a página já carrega:
- `saldoLivre(id)` (`get_saldo_livre`): `saldo_disponivel_caixa`, `rendimento_liquido`, `has_balancete`,
  `has_plano`, `compromissos_inicio` (1º mês que o balancete ainda não cobre), `compromissos_bolsas`, `end_date`,
  `bolsas_ativas[]` (`valor_mensal`, `meses`, `end_date`), `rubricas[]` (`compromisso_tipo` `'bolsas'`/`'taxa'`/
  `null`, `previsto`, `saldo`, `grupo_code`).
- `repasses(id)` (`get_repasses_v2`): `parcelas[]`, `recursos`, `data_balancete`, `valor_total_plano`.

## Arquivos que pode mexer

`app/src/servicos/projecao.js` (novo, só funções puras), `app/src/componentes/GraficoProjecao.jsx` e `.css`
(novos), `app/src/componentes/index.js` (exportar), `app/src/componentes/Destaque.jsx` e `.css` (só uma prop
**opcional** para o cartão ser clicável; sem ela, nada muda), `app/src/paginas/Projeto.jsx` e `Projeto.css`,
`app/src/paginas/Componentes.jsx` (catálogo: o gráfico com dados fictícios e o rótulo "Desembolsos"),
`app/src/servicos/dados.js` (só textos "repasses" → "desembolsos"), `app/src/servicos/dadosExemplo.js`,
`frontend/js/planejamento-dinheiro.js` (**só** acrescentar `export` na função `vencimento`; nenhuma outra mudança,
o site antigo não pode mudar), testes novos `app/tests/projecao.test.js` e `app/tests/projecao-tela.test.jsx`,
ajustes nos testes existentes que citam "Repasses", e o relatório. Precisou de outro? Pare e registre no
relatório.

## 1. A conta (`app/src/servicos/projecao.js`)

`projetarBolsas({ saldo, repasses, hoje, contar })`, com `contar = { futuro, atrasado, rendimento }`. Devolve:

```
{ estado: 'ok' | 'sem_bolsas' | 'sem_balancete' | 'repoe_gasto' | 'dado_incompleto',
  motivo,                       // frase para a tela quando estado != 'ok'
  meses: [{ mes: 'AAAA-MM', folha, entra_antes, entra_depois, desembolsos: [{ parcela, liquido }],
            em_conta_apos_folha, em_conta_fim, orcamento_resta }],
  cabe_ate, ate_o_fim, limite: 'caixa' | 'orcamento' | null, mes_falta, falta_valor,
  depende_de: { parcela, mes } | null, sobra_orcamento, mes_mais_apertado, taxa_fracao,
  atrasados: [{ parcela, valor, quando }], fora: [{ parcela, motivo }], avisos: [] }
```

Regras (cada uma com teste):
1. **Folha.** Cada bolsa de `bolsas_ativas` paga `valor_mensal` por `meses` meses a partir de
   `compromissos_inicio` (é a janela da 048). Bolsa sem `valor_mensal` ou `meses` válido → `dado_incompleto`
   (**nunca** tratar como zero). Se a soma de `valor_mensal × meses` diferir de `compromissos_bolsas` em mais de
   R$ 1, aviso em `avisos`.
2. **Meses da conta:** de `compromissos_inicio` até o último mês que alguma bolsa paga, sem passar do mês de
   `end_date` do centro. Nenhuma bolsa a pagar → `sem_bolsas`.
3. **Orçamento:** começa na soma de `saldo` das rubricas com `compromisso_tipo === 'bolsas'`; cada mês desconta a
   folha. O primeiro mês em que o orçamento que resta é menor que a folha é o limite pelo orçamento.
4. **Dinheiro em conta:** começa em `saldo_disponivel_caixa`, menos `rendimento_liquido` quando
   `contar.rendimento` é falso (o rendimento já está dentro do saldo; aqui ele só sai ou fica, **nunca se soma**).
   Sem balancete (`has_balancete` falso ou caixa nulo) → `sem_balancete`: a conta só dá o limite pelo orçamento.
   Rendimento nulo com `contar.rendimento` falso → aviso "o balancete não separa o rendimento".
5. **Desembolsos.** Use `situacaoDasParcelas` (mesma chamada que `resumirRepasses` já faz). Valor que entra =
   `falta` × (1 − `taxa_fracao`), onde `taxa_fracao` = soma do `previsto` das rubricas `compromisso_tipo ===
   'taxa'` ÷ soma do `previsto` de todas as rubricas (0 se não houver): a FUNAPE retém as taxas quando o
   dinheiro chega.
   - `futura`: entra no mês do vencimento (use `vencimento`; data só de mês vence no último dia). Dia ≤ 07 entra
     **antes** da folha; depois do dia 07, **depois**. Conta só se `contar.futuro`.
   - `atrasada`, `confirmar`, `parcial` (só o que falta) e `nota_emitida`: são os **atrasados**. Vão para
     `atrasados` sempre; contam só se `contar.atrasado`, e aí entram no 1º mês da conta, antes da folha.
   - `sem_data`, `sem_valor`, `sem_balancete`: nunca contam; vão para `fora` com o motivo em português.
   - Desembolso depois do último mês da conta → `fora` ("chega depois da última bolsa").
   - Plano sem valor em nenhuma parcela (`sem_valores`, o financiador repõe o gasto) → `repoe_gasto`: a conta do
     dinheiro em conta não se aplica; vale o limite pelo orçamento, com a frase explicando.
6. **Mês a mês:** soma `entra_antes`; se o que há em conta for **menor** que a folha e ainda não houve falta,
   esse é `mes_falta` e `falta_valor` = folha − em conta; desconta a folha (`em_conta_apos_folha`, pode ficar
   negativo e o negativo segue para o mês seguinte); soma `entra_depois` (`em_conta_fim`).
7. **Resposta:** `cabe_ate` = mês anterior ao primeiro limite (caixa ou orçamento); sem limite, o último mês da
   conta e `ate_o_fim = true`. `limite` diz qual chegou primeiro (empate: `caixa`). `depende_de` = o desembolso
   que entra **depois** da folha no próprio `mes_falta`, quando depois dele nenhum mês fica negativo de novo.
   `mes_mais_apertado` = mês de menor `em_conta_apos_folha`. `sobra_orcamento` = orçamento no fim.
8. Centavos: arredonde a 2 casas a cada passo (como `r2` do planejamento). Datas sem fuso: trabalhe com strings
   `AAAA-MM`/`AAAA-MM-DD`, como `planejamento-dinheiro.js`.

Cenário de teste obrigatório (fictício; confira os números à mão no teste): caixa 250.000 com 30.000 de
rendimento; 10 bolsas somando 50.000/mês por 10 meses a partir de 2026-12; orçamento de bolsas 560.000; taxas
300.000 de 2.000.000 de previsto (15%); desembolsos 1 e 2 de 500.000 recebidos (recebido 1.000.000, balancete
de 2026-11-17), 3 de 500.000 previsto para 2026-10-10 (atrasado) e 4 de 500.000 para 2027-04-10.
- Padrão (só futuro): dez 170.000 · jan 120.000 · fev 70.000 · mar 20.000 · abr falta 30.000 na folha, entra
  425.000 depois → 395.000 · ... · set 145.000. `cabe_ate` 2027-03, `limite` caixa, `depende_de` desembolso 4.
- Com rendimento: abr fica 0 depois da folha, sem falta; `ate_o_fim`, cabe até 2027-09; sobra de orçamento 60.000.
- Sem futuro: falta em abr e segue negativo; `depende_de` nulo.
- Com atrasado: entra 425.000 em dez antes da folha; nenhuma falta.
- Com rendimento e orçamento de 300.000: limite pelo orçamento em 2027-06, `cabe_ate` 2027-05.
(Use `hoje` = 2026-11-23 e datas quaisquer, já passadas, para os desembolsos 1 e 2.)
Mais: dia ≤ 07 antes da folha; data só de mês depois; `sem_valor` em `fora`; `nota_emitida` como atrasado;
bolsa sem valor → `dado_incompleto`; sem balancete; plano sem valores → `repoe_gasto`; sem bolsas.

## 2. A tela (`Projeto.jsx`)

Siga a organização do esboço; visual e componentes do `app/`.
- **Cartão "Bolsas por mês"** (já existe): o valor e o contexto ficam; acrescente uma linha com a resposta:
  "Cabem até set/27" + motivo curto ("fim das bolsas cadastradas", "falta dinheiro em conta em abr/27",
  "abr/27 depende do desembolso 4", "acaba o orçamento de Bolsas em jun/27"). A data em `--cor-texto` (números
  nunca são verdes); quando não chega ao fim, a situação vai pelo componente `Situacao` ou pela cor de atenção
  do texto de apoio, como as outras telas fazem. Clicar no cartão abre a aba Dinheiro e leva o foco à seção nova.
- **Cartão "Repasses" vira "Desembolsos"** (mesmo conteúdo).
- **Tabela da aba Dinheiro:** coluna nova **"Cabe até"**, preenchida só na linha do grupo que tem rubrica de
  bolsas (as outras com "—"); a mesma informação no painel "Rubricas deste grupo", na rubrica de bolsas.
- **Seção "Até quando as bolsas cabem"**, na aba Dinheiro, abaixo da tabela:
  - frase de resposta (uma ou duas linhas, como no esboço; texto da seção 6 de `estetica.md`);
  - **"Contar:"** três botões de liga/desliga: "Desembolso futuro no prazo" (ligado), "Desembolso atrasado"
    (desligado) e "Rendimento" (desligado). Mudar um botão recalcula cartão, coluna, frase e gráfico juntos.
    Estado só da página (volta ao padrão ao trocar de centro). Acessível por teclado (`aria-pressed` ou caixa
    de marcar);
  - **gráfico** (`GraficoProjecao`): por mês, duas barras: em conta depois da folha (`--grafico-1`, cheia; o
    negativo em `--cor-problema`) e orçamento de bolsas que resta (`--grafico-2` com contorno de 1,5 px em
    `--grafico-1`); linha tracejada `--grafico-3` no mês em que entra um desembolso, com o rótulo
    "+ desembolso N (R$ X mil)"; faixa `--cor-problema-suave` no mês da falta; grade em `--cor-borda`, sem
    linhas de eixo; eixo em formato compacto ("300 mil"); legenda em cima à esquerda em `--fs-1`. SVG feito em
    Preact, **sem biblioteca nova** (o `estetica.md` cita Chart.js; registre esse desvio no relatório). Cores só
    por classe CSS com tokens. `role="img"` com `aria-label` e, logo abaixo, `<details>` "Ver mês a mês em
    tabela" com os mesmos números. Em tela estreita o gráfico rola dentro da própria caixa; a página não;
  - **desembolsos atrasados**: um aviso em tom de atenção por atrasado, dizendo valor, data prevista e que não
    aparece no balancete de tal data, e se está ou não contado acima. Sem botão (não há pendência automática);
  - `<details>` **"Como a conta é feita"**: as regras em frases curtas, com o `fora` (o que não entrou e por quê)
    e a fração de taxa usada.
- **Estados:** carregando → `Esqueleto`; falha de `saldoLivre` ou de `repasses` → `AvisoFalha` com "Tentar de
  novo", e o cartão sem "Cabem até" (**nunca** uma data inventada); `sem_bolsas`, `sem_balancete`,
  `repoe_gasto`, `dado_incompleto` → a frase de `motivo` no lugar do gráfico (com o limite pelo orçamento quando
  houver).
- Centro oculto pelo filtro de visão ou sem plano: a seção não aparece (siga o que a página já faz).
- 390 px: sem rolagem horizontal da página.

## 3. Modo exemplo e catálogo

`dadosExemplo.js`: ajuste os centros fictícios para mostrar pelo menos um que **aperta e depende de um
desembolso** (com um atrasado), um que **cabe até o fim** e um **sem balancete**. Catálogo `#/componentes`:
`GraficoProjecao` com dados fictícios.

## 4. Testes

`app/tests/projecao.test.js`: as regras da §1, com o cenário obrigatório. `app/tests/projecao-tela.test.jsx`:
cartão com "Cabem até"; coluna "Cabe até" só na linha de bolsas; trocar "Rendimento" muda frase e cartão;
falha de leitura mostra `AvisoFalha` e nenhuma data; atrasado aparece como aviso; rótulo "Desembolsos" no cartão;
tabela do `<details>` com os números do gráfico; clicar no cartão leva à seção. Rode e mostre que pelo menos 2
testes **falham** se você trocar a regra do dia 07 (antes/depois) e se o rendimento for somado em vez de tirado
(mutantes; descreva no relatório e desfaça).

## Verificação (tudo verde antes do commit)

`npx vitest run` (raiz), `npm test --prefix app`, `npm run lint`, `npm run build --prefix app`. Se puder, abra
`npm run dev:exemplo --prefix app` e confira a página do projeto em 1400 px e 390 px; descreva no relatório o que
viu (ou diga que não conseguiu abrir). Relatório: o que fez, testes, mutantes, o que ficou em aberto, desvios
desta tarefa. Não versione nada de `NãoColocarNoGit/`.
