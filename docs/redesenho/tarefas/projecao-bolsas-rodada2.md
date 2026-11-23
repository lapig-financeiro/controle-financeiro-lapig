# Projeção das bolsas — 2ª rodada (revisões MiniMax max e DeepSeek max de 4ead369, conferidas pelo Claude, 23/11)

Mesmo worktree e branch. Seção "2ª rodada" no relatório `docs/redesenho/relatorios/projecao-bolsas.md`, **commit
novo**. Sem push. Não chame outras IAs. Mesmas listas de arquivos da 1ª rodada (pode também `app/src/componentes/
Tabela.css` só para o item 11). Não versione `PEDIDO-rev-projecao.txt` (apague-o). Cada correção de conta ganha um
teste que **falha sem ela**.

## Conta (`projecao.js`)

1. **(alta) Bolsa que não começa no início da janela.** Na 066, `meses` é quantos meses da janela a bolsa cobre
   (sobreposição de `start_date..end_date` com `compromissos_inicio..compromissos_fim`). Posicione cada bolsa pelo
   **fim**: último mês = o menor entre o mês de `end_date` da bolsa e o mês de `saldo.compromissos_fim`; primeiro
   mês = último − `meses` + 1. A folha de cada mês soma só as bolsas que cobrem aquele mês; os meses da conta vão
   de `compromissos_inicio` até o último mês de alguma bolsa (sem passar do `end_date` do centro). `end_date`
   inválido ou `compromissos_fim` ausente → `dado_incompleto`. Testes: bolsa que começa em mar/27 numa janela de
   dez/26 (paga só mar..ago); bolsa encerrada dentro da janela (paga só os primeiros meses).
2. **(média) Dado faltando vira zero.** Rubrica de bolsas com `saldo` nulo → `dado_incompleto`. Rubrica com
   `previsto` nulo → `dado_incompleto` (não dá para calcular a taxa). Testes.
3. **(média) `depende_de` e frase ignoram o orçamento.** Se houver limite de orçamento depois do mês salvo pelo
   desembolso, `cabe_ate` já é o menor; a frase do "depende" não pode dizer "segue até <último mês>": diga até onde
   segue de fato (mês anterior ao limite de orçamento). Teste com o cenário: 10 meses, folha 50.000, caixa
   220.000, desembolso 500.000 depois da folha em abril (sem taxa), orçamento 410.000.
4. **(baixa) O que some sem registro.** Desembolso futuro com o botão desligado → `fora` com "desligado em Contar";
   em `sem_balancete` os desembolsos futuros **não** entram em `meses` e vão para `fora` ("sem balancete para
   receber"). Sem balancete × balancete sem saldo: `has_balancete` verdadeiro com caixa nulo → motivo "o balancete
   não informa o dinheiro em conta".
5. **(baixa) Situação no aviso.** Guarde `situacao` em `atrasados`; o aviso usa o rótulo certo: atrasada
   ("atrasado: não aparece no balancete de …"), `confirmar` ("venceu depois do último balancete: confirmar"),
   `parcial` ("entrou em parte; falta R$ X"), `nota_emitida` ("nota emitida, não paga"). O botão continua
   "Desembolso atrasado" e cobre os quatro.

## Tela

6. **(média) Percentual da taxa 100× menor** em "Como a conta é feita" (`Projeto.jsx` ~1875): `textoPct` espera
   milésimos de ponto percentual; use `taxa_fracao * 100` antes de converter (15% e não 0,15%). Teste abrindo o
   `<details>`.
7. **(média) "Cabe até" no painel só aparece no caminho de erro.** Mostre a linha também no caminho normal (com a
   árvore do `DeOndeVem`), acima ou abaixo dela, sem mexer no `DeOndeVem`. Teste com `explicarLivre` funcionando.
8. **(média) Gráfico fluido.** Hoje são 900 px fixos e, em tela larga, sobra espaço vazio à direita (o Claude viu
   em 1400 px). O SVG ocupa 100% da largura do cartão; largura mínima = número de meses × 56 px (rola dentro da
   caixa só quando não couber). Com mais de 14 meses, rótulo do eixo só em meses alternados (ou só janeiro e
   julho com o ano quando passar de 24); nunca rótulos sobrepostos. Teste com 30 meses.
9. **(média) Troca de centro mostra a data do centro anterior** por um render: só calcule a projeção quando
   `saldoSt.dados.project_id` (e o centro dos desembolsos) for o centro atual; senão, estado "consultando".
10. **(baixa) Duas folhas diferentes na tela.** O cartão soma as vigentes; a seção soma a janela. Na nota da seção,
    quando a folha do 1º mês for maior que a do cartão, diga "inclui bolsa que termina antes de hoje e o balancete
    ainda não mostra paga" (texto curto); quando a folha cai ao longo da conta, "folha de até R$ X".
11. **(baixa)** Legenda: "falta para a folha" só quando há negativo; acrescente a faixa do mês da falta como item
    ("mês em que falta"), também só quando existe. Classe morta `projeto__aviso-atrasado`: remova ou dê regra.
    `id="projecao-titulo"` com `useId`. Cartão sem destino quando a seção não aparece: sem `onClick` nesse caso.
    `scroll-margin-top` da seção = `--altura-topo` + `--esp-4`. Tabela de rubricas entre 641 e ~750 px: rolagem
    dentro do envoltório da tabela (não da página). `font-size`/`rx` literais no SVG: use classes com tokens
    (`--fs-1`, `--fw-semi`, `--raio-1`).
12. **Exemplos coerentes com a 066.** Refaça os centros fictícios do modo exemplo para que `meses`,
    `compromissos_inicio`, `compromissos_fim`, `end_date` das bolsas e `compromissos_bolsas` sejam o que a RPC
    devolveria (inclua uma bolsa encerrada dentro da janela e uma que começa no meio). Mantenha os três casos
    (aperta e depende de desembolso com um atrasado; cabe até o fim; sem balancete). Corrija a frase do relatório
    que diz que bolsa encerrada na janela "não é da produção" (ela é: comentário B da 066).
13. **Testes que não provam:** ao ligar "Rendimento", verifique também a coluna "Cabe até" e a tabela do gráfico;
    acrescente `confirmar`, `parcial`, `sem_data` e empate caixa × orçamento. Registre no relatório que
    `documento.test.jsx` falhou uma vez numa execução completa e passou nas seguintes (instabilidade antiga, fora
    desta tarefa).

`npx vitest run` (raiz), `npm test --prefix app`, `npm run lint`, `npm run build --prefix app`: verdes. Confira de
novo no navegador em 1400 e 390 px e descreva.
