# F2-H — bloco "Dinheiro em conta" no topo do projeto (19/11, pedido do Victor)

Worktree `C:/Users/amara/dev/cf-f2-c`, branch `redesenho/f2-h-dinheiro` (já criada a partir do `master` 49cbc2c).
Relatório em `docs/redesenho/relatorios/F2-H.md`, commit novo. Sem push. **Sem migração**: nada muda no banco.

## O problema (palavras do Victor)

"Tive dificuldade de achar onde está o saldo em conta e rendimentos. Só precisa tomar cuidado com essa questão de
deixar as informações fáceis." Hoje o saldo do balancete só aparece como valor de uma linha na aba Documentos, e o
rendimento não aparece em lugar nenhum do `/v2/`.

## O que fazer (`app/src/paginas/Projeto.jsx`, fileira `GradeDestaques`, perto da linha 1487)

1. Um `Destaque` novo, **"Dinheiro em conta"**, logo depois do principal (o livre). O valor é o `saldo_disponivel` do
   balancete **mais recente por `data_referencia`** (mesma regra da `v_balancete_vigente`; empate → `created_at` mais
   novo), tirado de `docsSt.balancetes`, que a página já carrega com `get_balancetes_by_project`. Nada é recalculado
   nem somado.
2. Contexto do destaque: `balancete de dd/mm/aaaa · inclui R$ X de rendimento`. O rendimento é o
   `rendimento_liquido` do mesmo balancete. **O rendimento já está dentro do saldo** (o rodapé da FUNAPE é "saldo
   disponível pós IR/IOF estimado s/ rend. apl. financeira"): nunca somar os dois, nunca mostrar "saldo + rendimento".
   Se `rendimento_liquido` for `null`: `rendimento não lido` (null não é zero). Se for 0: `sem rendimento`.
3. Clicar no valor abre o documento de origem já na linha, pelo mesmo caminho da aba Documentos
   (`abrirDocumentoDaAba` com ref `{ alvo_tabela: 'balancetes', alvo_id, campo: 'saldo_disponivel' }`). O rendimento
   no contexto também é clicável (mesmo caminho, `campo: 'rendimento_liquido'`, que o `get_origem_v2` já aceita),
   com rótulo acessível próprio.
4. Uma frase curta de ajuda (title/tooltip ou o padrão de ajuda que os outros destaques já usam, se houver), dizendo
   a diferença para o livre: "Tudo o que está na conta do projeto hoje. O livre desconta o que já está comprometido
   (bolsas, taxas)." Rendimento: "Rendimento tem regras próprias de uso." Não invente outro padrão visual.
5. Estados, seguindo a convenção "falha de consulta nunca vira zero":
   - consultando → `Valor` com motivo `consultando`;
   - erro ao carregar balancetes → `—` com o motivo (`docsSt.erroBalancetes`);
   - centro sem balancete → `sem balancete`;
   - `saldo_disponivel` null no balancete mais recente → `—` com `saldo não lido`, sem cair num balancete mais antigo.
6. A grade passa de 4 para 5 destaques: confira no CSS do `GradeDestaques`/`Destaque` que fica bem em desktop e em
   375 px (sem rolagem horizontal), nos dois temas. Se 5 numa linha apertar, deixe a grade quebrar de forma regular.
7. `app/src/servicos/dadosExemplo.js`: os balancetes de exemplo já têm `rendimento_liquido`; garanta que exista um
   centro com rendimento `null` e o `get_origem_v2` de exemplo responda para `rendimento_liquido` também (hoje só
   trata `saldo_disponivel`, perto da linha 1768).
8. Ajuste o rótulo da linha de balancete na aba Documentos só se ficar redundante; não remova nada dela.

## Testes

Em `app/tests/` (vitest + testing-library, no molde dos testes da `Projeto.jsx` que já existem): escolhe o balancete
mais recente por `data_referencia` mesmo vindo fora de ordem; mostra o rendimento sem somar; `null` → "rendimento não
lido"; erro → `—` e nunca R$ 0,00; sem balancete; clique no valor e no rendimento chama a origem com o campo certo.
`npm test` e `npm run build` em `app/`, `npm run lint` e `npx vitest run` na raiz, verdes. Nenhum dado real em teste.

## Não fazer

Nada no banco, nada em `frontend/` (o site antigo), nada de somar rendimento, nenhum outro destaque novo.
