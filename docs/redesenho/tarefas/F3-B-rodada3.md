# F3-B — 3ª rodada (tela, conferida pelo Claude no modo exemplo em 1400 px, e pedido do Victor, 19/11)

Mesmo worktree e branch. Seção "3ª rodada" no relatório, commit novo. Sem push. Só app; o banco não muda.

## Defeitos de layout (vistos na tela, 1400×900, modo exemplo)

1. **Linha da lista quebrada**: a coluna das bolsas ficou estreita (~55 px) e o texto se sobrepõe — o chip
   "30.901 · R$ 4.200/mês · até set/27" quebra em várias linhas e o texto "soma vigente hoje (todos os seus centros):
   R$ x" fica desenhado **por cima** do chip. Refaça a grade da linha: nome + equipe (≈ 30%), bolsas (o resto, chips
   em linha que quebram inteiros, `white-space: nowrap` em cada chip), e abaixo das bolsas, numa linha própria, a soma
   vigente; botões à direita. Nada com `position: absolute` nesse conteúdo. Em tela estreita (< 900 px), empilhar.
2. **Nome cortado na caixa**: "Bolsista ..." com nomes curtos. O nome tem de aparecer inteiro (quebra em duas linhas se
   preciso); o valor e as ações encolhem antes.
3. Teste de regressão de layout simples (ex.: a linha não usa `position: absolute`; as classes de grade existem) e
   confira manualmente com `npm run dev:exemplo` em 1400 px e 390 px descrevendo no relatório o que viu.

## Deixar autoexplicativo (pedido do Victor)

"As caixas só vêm bem embaixo, pode ser que a pessoa quando abra não entenda que ela pode criar as caixas."

4. **Passo a passo no topo** (abaixo do subtítulo, discreto, uma linha com três passos numerados):
   "1. Filtre quem entra · 2. Crie uma caixa (ex.: Time Pastagem) · 3. Ponha as pessoas na caixa". Com botão
   "Nova caixa" ao lado (o mesmo da coluna das caixas). Pode ser fechado ("Entendi"), lembrado em `localStorage` `cf_`.
5. **Sem nenhuma caixa**: no lugar dos botões "Pôr em…" de cada pessoa, um cartão de destaque logo abaixo dos filtros:
   "Crie sua primeira caixa para começar a separar as pessoas" + botão "Nova caixa". A coluna das caixas também mostra
   esse estado vazio com o botão.
6. **Tela estreita (< 900 px, caixas abaixo da lista)**: barra fixa no rodapé com o resumo das caixas ("Time
   Pastagem: 12 · R$ 24.600/mês | Reserva: 3 · …", vindo da RPC) e "Ver caixas" que rola até elas. Sem caixa: "Nova
   caixa".
7. Testes para 4, 5 e 6 (estado vazio, passo a passo fechável, barra presente quando estreito ou ao menos renderizada
   com a classe de mídia).

`npx vitest run`, `npm run lint`, testes e build de `app/`: verdes.
