# Folha atrasada — o que muda no `/v2/` (25/11, pedido do Victor)

Worktree `C:/Users/amara/dev/cf-folha-tela`, branch `redesenho/folha-atrasada-tela` (do `master` 620f19a,
`node_modules` instalados na raiz e em `app/`). Relatório em `docs/redesenho/relatorios/folha-atrasada-tela.md`,
**um commit no fim** (`fix(redesenho): ...`). **Sem push. Não chame outras IAs.** Nenhum dado real (nome de pessoa,
código ou nome de centro real, valor copiado de balancete) em teste, fixture ou modo exemplo.

Leia antes, inteiros: `docs/redesenho/estetica.md` (tokens, "números nunca são verdes", proibições: nada de
`style=` inline, hex fora de `tokens.css`, fonte fora da escala — o build reprova), `app/src/servicos/projecao.js`,
`app/tests/projecao.test.js`, `app/tests/projecao-tela.test.jsx`, a aba Dinheiro e os avisos do saldo em
`app/src/paginas/Projeto.jsx` (`avisosRpc`, seção "Até quando as bolsas cabem"), `app/src/servicos/dados.js`
(`saldoLivre` e o modo exemplo), `app/src/servicos/dadosExemplo.js`, e o relatório
`docs/redesenho/relatorios/projecao-bolsas.md` (como a projeção foi decidida).

## O defeito e o que o banco vai passar a mandar

`get_saldo_livre` supõe que o balancete já contém a folha de bolsas de todo mês até `balancete_cobre_ate`. Quando a
FUNAPE paga uma folha **atrasada** (depois da data do balancete), esse dinheiro não está no realizado nem nos
compromissos e aparece como livre. Outra tarefa, em paralelo, escreve a migração 070, que confere a folha contra os
balancetes anteriores e passa a mandar (chaves **aditivas**; podem não existir enquanto a 070 não estiver aplicada):

```
folha_conferencia: 'feita' | 'sem_balancete_anterior' | 'sem_balancete'
folha_atrasada: null | {
  valor, esperado, visto,          // números; valor > 0 quando presente
  desde_balancete, balancete,      // 'AAAA-MM-DD'
  mes_inicio, mes_fim              // 'AAAA-MM-01': os meses conferidos
}
```

Quando `folha_atrasada` existe, `valor` **já está somado** em `compromissos_bolsas`, no `compromissos` e no
`saldo_livre` da rubrica `a.bolsas` (e portanto no livre do grupo e do total), e o banco acrescenta uma frase em
`avisos` (que a tela já mostra). Os meses da janela (`compromissos_inicio`…) **não mudam**: a folha atrasada é
dinheiro que já devia ter saído e ainda está na conta.

## O que fazer

1. **`dados.js`**: aceitar e sanitizar `folha_atrasada` (ausente ou `null` → `null`; objeto com `valor` não numérico
   ou ≤ 0 → `null` com `console.warn`, sem derrubar o saldo) e `folha_conferencia`. Sem a chave, tudo como hoje.
2. **`projecao.js`**:
   - A checagem da linha 172–182 ("A soma das bolsas difere do compromisso da janela") tem de descontar
     `folha_atrasada.valor` de `compromissos_bolsas` antes de comparar; senão ela dispara à toa.
   - No **1º mês** da conta, a folha atrasada sai do dinheiro em conta **antes** de tudo (antes dos desembolsos que
     entram antes da folha e antes da folha do mês) e também abate o `orcamento_resta`, porque o orçamento hoje parte
     de previsto − realizado e o realizado não a tem. Novo campo no mês: `folha_atrasada` (0 nos outros meses). Novo
     campo no retorno: `folha_atrasada` (o valor ou 0).
   - O limite, `cabe_ate`, `mes_falta`, `falta_valor`, `depende_de` e o resto passam a considerar esse valor. Sem a
     chave, os números são **idênticos** aos de hoje (prove com os testes existentes passando sem mudança e com um
     teste que roda o mesmo caso com `folha_atrasada: null` e sem a chave).
3. **Tela (`Projeto.jsx`)**:
   - Tabela mês a mês da projeção: no 1º mês, mostrar a folha atrasada numa linha/coluna própria com o rótulo
     "Folha atrasada" (só quando > 0; não criar coluna vazia em todos os meses).
   - "Como a conta é feita": uma frase quando houver folha atrasada.
   - Painel da rubrica de bolsas (e onde a tela explica o compromisso de bolsas): "inclui R$ X de folha que ainda não
     apareceu no balancete de DD/MM" quando houver.
   - Não repetir o aviso do banco: ele já aparece em `avisosRpc`.
4. **Modo exemplo (`dadosExemplo.js`)**: um centro sintético com folha atrasada, coerente (o `valor` somado em
   `compromissos_bolsas`, no compromisso e no livre de `a.bolsas` e no livre do grupo/total; um aviso no texto que a
   070 vai mandar). Os outros centros do exemplo não mudam.
5. **Testes**: em `app/tests/projecao.test.js` (1º mês, orçamento, limite que muda por causa da folha atrasada,
   checagem da soma sem aviso falso, sem a chave = idêntico) e em `app/tests/projecao-tela.test.jsx` (rótulo
   "Folha atrasada" só quando > 0; frase no painel).

## Arquivos que pode mexer

`app/src/servicos/projecao.js`, `app/src/servicos/dados.js`, `app/src/servicos/dadosExemplo.js`,
`app/src/paginas/Projeto.jsx` e `Projeto.css`, `app/src/componentes/GraficoProjecao.jsx` (só se precisar mostrar a
saída do 1º mês; sem biblioteca nova), os dois testes acima e o relatório. Precisou de outro? Pare e registre no
relatório. **Não toque** em `frontend/`, `database/`, `mcp/`.

Antes de terminar: `npm run lint`, `npm test`, `npm --prefix app test` e `npm --prefix app run build` verdes.
