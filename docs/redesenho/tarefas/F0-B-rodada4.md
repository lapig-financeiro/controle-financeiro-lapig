# F0-B — 4ª rodada (conferência do Claude a 360 px)

Executor: Orchestrator (Neon). Mexa **só** em `app/src/` (CSS/JSX dos componentes citados). Siga `docs/redesenho/estetica.md` à risca (tokens, só @media 640/1024, nada de cor nova). Não faça commit.

## Defeitos achados (largura 360 px, catálogo `#/componentes` no `npm --prefix app run dev`)
1. **Barra do topo corta o menu.** Os links "Projetos · Análise · Admin" ficam escondidos atrás do botão de filtro; "Admin" aparece como "Adr". Arquivos: `app/src/componentes/BarraTopo.css` (e `.jsx` se precisar). Os três itens têm de caber inteiros a 360 px sem rolagem horizontal da página — por exemplo, reduzir o gap da nav e o padding lateral abaixo de 640 px, ou o logo menor. Não esconda itens de menu.
2. **Valor estoura o cartão na grade de destaques.** A 360 px os destaques ficam em duas colunas e "R$ 18.400" (fs-5) passa da borda direita do cartão "Bolsas por mês". Arquivos: `app/src/componentes/Destaque.css`. Abaixo de 640 px, o valor dos destaques secundários tem de caber (ex.: fonte um degrau menor da escala, fs-4, só nesses cartões, ou uma coluna só). Nunca cortar o número nem usar reticências.
3. (já corrigido pelo Claude, não mexer) `Abas.css` ganhou `overflow-y: hidden`.

## Pronto quando
- A 360 px: `document.documentElement.scrollWidth === 360`, os três links visíveis por inteiro e nenhum valor passando da borda do cartão (confira com `getBoundingClientRect` do valor contra o do cartão).
- A 1280 px nada mudou.
- `npm --prefix app test`, `npm --prefix app run build` e `npm run lint` passam.
- Responda com a lista do que mudou (arquivo + regra) e o resultado das conferências.
