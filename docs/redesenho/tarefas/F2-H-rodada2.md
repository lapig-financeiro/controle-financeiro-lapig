# F2-H — 2ª rodada (revisões MiniMax max e DeepSeek max do b446459, 19/11, conferidas pelo Claude)

Mesmo worktree e branch. Seção "2ª rodada" no relatório, commit novo. Sem push. Nenhum achado alto; corrigir:

1. **Frase de ajuda errada** (MiniMax 1). O livre NÃO é a conta menos o comprometido: vem do plano (previsto −
   realizado − comprometido). Novo texto: "Tudo o que está na conta do projeto, pelo último balancete. O livre é
   outra conta: o previsto no plano menos o que já foi gasto e o que já está comprometido (bolsas, taxas)."
   Rendimento: "Já está dentro do dinheiro em conta. Rendimento tem regras próprias de uso."
2. **Ajuda acessível e sem repetição** (MiniMax 3, DeepSeek 8): um único `title` (no rótulo do destaque); retire o
   do `div` e o `dica` repetido; ligue a ajuda ao botão do valor por `aria-describedby` (texto visualmente oculto,
   use a classe utilitária que o app já tiver; se não houver, crie uma `.visualmente-oculto` no CSS global).
   Retire o `origem.resumo` morto quando há `rotuloOrigem`.
3. **Rótulo curto do rendimento** (MiniMax 2): `aria-label` "Ver origem do rendimento" (a frase em volta já diz o
   valor e a data).
4. **Clique no topo sem retorno** (MiniMax 4, DeepSeek 1): ao clicar no saldo ou no rendimento do topo, enquanto a
   origem carrega o destaque mostra que está abrindo (ex.: o contexto vira "abrindo documento…" ou o botão fica
   `aria-busy`); se a origem não trouxer documento (nota) ou falhar, selecione a aba Documentos, onde a nota/erro já
   aparecem, e role até ela. Use o mesmo id de carregamento da linha da tabela (`bal-<id>`) para a linha também
   mostrar o estado.
5. **"Consultando" depende dos planos** (DeepSeek 2): estado de carregamento separado para balancetes e planos em
   `docsSt` (ou derivado), e o destaque olha só o dos balancetes. Teste: planos pendentes para sempre, balancetes
   respondidos → o destaque mostra o saldo.
6. **Falha só no `title`** (DeepSeek 3): com `erroBalancetes`, mostre o `AvisoFalha` (com "tentar novamente" →
   `carregarDocumentos`) também no topo, junto do aviso que já existe para o resumo. Não duplique o da aba.
7. **Troca de centro mostra o dinheiro do anterior** (MiniMax 6): zere `docsSt` (carregando, listas vazias) no mesmo
   efeito de `[projectId]`, antes do primeiro paint do centro novo. Teste com rerender trocando o `projectId`.
8. **Número longo transborda em 375 px** (MiniMax 5, DeepSeek 7): `min-width: 0` no destaque e `overflow-wrap:
   anywhere` no valor (vale para os cinco destaques). Teste/registro com R$ 12.345.679 e negativo.
9. **Empate impossível** (MiniMax 7, DeepSeek 5): `balancetes` tem `unique (project_id, data_referencia)` e
   `data_referencia not null` (026). Simplifique `balanceteMaisRecente` (maior `data_referencia`, ignorando entrada
   sem data só por defesa) e troque o teste de empate por um de ordem.
10. **Testes que não provam** (DeepSeek 4 e 6, MiniMax 8): compare o texto exato do valor ("R$ 184.250") e proíba
    "195.491"; no erro, proíba "R$ 0"; o teste de clique tem de provar o efeito (modal aberto com documento, ou aba
    Documentos selecionada com a nota visível quando `documento: null`); um `app/tests/valor.test.jsx` para
    `rotuloOrigem` (com e sem) e `aria-describedby`.
11. **Relatório** (MiniMax 9): o valor do topo sai sem centavos (arredondado), diga isso; corrija a contagem de
    `title`.

`npm test` e `npm run build` em `app/`, `npm run lint` e `npx vitest run` na raiz, verdes.
