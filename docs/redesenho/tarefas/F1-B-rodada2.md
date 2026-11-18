# F1-B — 2ª rodada (revisão de fase: dois DeepSeek + conferência visual do Claude)

Mesmo worktree e branch. Mesmos arquivos da F1-B (mais este). Commit novo na branch ao fim; sem push.

## Correções
1. **Corrida ao trocar de projeto** (`Projeto.jsx` ~189-235): cada carga guarda o `projectId` com que começou e
   descarta a resposta se ele mudou (contador de geração ou `let ativo` no efeito, como `App.jsx:93`). O mesmo
   para `carregarResumo`/`carregarSino` em `App.jsx` disparados em paralelo.
2. **Filtro com dois cliques seguidos**: `FiltroVisao` mantém um conjunto otimista local (sincronizado quando
   a prop chega); `salvando` só termina depois do recarregamento (`finally`); uma gravação por vez. Em vez de
   `disabled` (que joga o foco no `body`), use `aria-disabled` e ignore o clique enquanto salva.
3. **Validar a forma das respostas** em `dados.js`: `resumoProjetos` exige `Array.isArray(centros)` e
   `Array.isArray(todos)`; `saldoLivre` exige `has_plano`/`has_balancete` booleanos; senão `{ dados: null, erro }`.
   O modo exemplo: se o `import()` falhar, limpe o cache da promessa e devolva `{ erro }` (não trave no esqueleto).
4. **Nada nulo vira zero em soma**: "Bolsas por mês" e a "soma das partes" do painel — se algum valor não for
   número finito, mostram `—` com o motivo, e a divergência é acusada. Bolsa sem `end_date` vai para um grupo
   "sem data" com aviso (não conta como encerrada). Em repasses, só passe `recursos` se `recebido` for número
   finito; senão `null` e o texto "sem dados de recurso".
5. **Avisos da RPC**: renderize `saldo_livre.avisos` (ex.: vigência encerrada, balancete defasado) no topo da
   aba Dinheiro, com AvisoFalha no tom de atenção. Não recrie avisos que a RPC já dá.
6. **"faltam N meses"**: nunca "faltam null meses"; sem dado → omitir o trecho.
7. **Linha de contexto de Projetos**: o primeiro número é o total (`centros.length + ocultos`): "8 centros ·
   R$ 119,5 mil livres no total · 3 centros sem número · 2 centros ocultos". Corrija o teste que fixava o erro.
8. **Centro oculto aberto por link** (ou ocultado com a página aberta): não é "sem dado". Mostre um Vazio
   "Este centro está oculto pelo seu filtro de visão" com o botão "Mostrar este centro" (tira só ele dos ocultos).
9. **Repasses**: parcela que precisa de conferência (`parcial`, `nota_emitida`, `confirmar`, `atrasada`,
   `sem_data`) tem prioridade sobre "próximo em …" no texto do destaque.
10. **Aba Bolsas** lista todas de `bolsas_ativas` (as encerradas dentro da janela com a marca "encerrada em
    mm/aa"); o filtro `end_date >= hoje` vale só para o destaque e o "N bolsistas ativos".
11. **Documentos**: se qualquer das duas consultas falhar, contagem `—` e AvisoFalha; o Vazio "Nenhum documento"
    só quando as duas responderam vazias.
12. **"Mostrar todos" no Vazio da lista**: se falhar, AvisoFalha junto do Vazio (não só dentro do menu fechado).
13. **Recarregar sem piscar**: Esqueleto só quando não há resumo anterior; durante o recarregamento mantenha a
    lista e o contexto.
14. **Links**: não chame `preventDefault()` quando houver ctrl/cmd/shift/clique do meio (nova aba tem de funcionar).
15. **Filtro — cabeçalho do grupo**: hoje sai "Prof. Renato Al…" ao lado de "Só os de Prof. Renato Alves"
    (cortado e repetido). O cabeçalho mostra o nome inteiro (quebra de linha se precisar) e o atalho vira
    "Só estes", alinhado à direita.
16. **Chips "Sem plano" e "Sem dado"**: mantenha (aparecem só quando há centro na situação), e registre no
    relatório como desvio aceito da `estetica.md` §5.

## Testes (fechar os que passariam com o defeito)
17. Drive: caso professor **com** URL preenchida (o botão não aparece) e caso admin com URL (aparece).
18. Modo exemplo fora do build: teste que roda depois do build (ou script `verificar-build`) e procura no
    `dist/assets` os nomes do exemplo; falha se achar. Inclua no `npm --prefix app run build` ou no CI do app.
19. Casos novos para 1, 2, 3, 4, 7, 8 e 9 (troca rápida de projeto com promessas resolvendo fora de ordem; dois
    cliques no filtro; payload sem `centros`; valor nulo na soma; contexto com ocultos; centro oculto aberto
    por link; prioridade da parcela a conferir).

## Pronto quando
`npm --prefix app test`, `npm --prefix app run build`, `npm run lint`, `npm test` verdes; conferência no
headless a 1280 e 360 px como na 1ª rodada; relatório F1-B com seção "2ª rodada"; commit na branch.
