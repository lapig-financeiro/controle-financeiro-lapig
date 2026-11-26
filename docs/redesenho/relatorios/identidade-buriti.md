# Identidade do Buriti

## A copa em leque ficou legível a 16 px

A copa remete à palmeira das veredas do Cerrado e ainda mostra os recortes entre as
cinco frondes no tamanho de um favicon. Na mesma escala, a trama de escamas perde parte
da leitura como fruto, e a água da vereda disputa espaço com a palmeira. As três propostas
foram exploradas em um moodboard com o ImageGen integrado. Os símbolos da prancha foram
desenhados à mão em SVG. O nome veio dos contornos da Inter 600 que já está no app, com
espaçamento de `−0,015 em`.

Abra `.rascunho-marca/prancha.html` no Edge para ver os três conceitos a 16, 24, 48 e
128 px sobre branco e sobre o fundo do app. O moodboard está em
`.rascunho-marca/moodboard.png`. A prancha e as fotos são locais e ficam de fora do Git.

## O que entrou

- `app/public/marca/` reúne os três SVGs. Em `app/public/` ficam o favicon vetorial, os
  cinco PNGs e o manifesto com escopo e abertura relativos a `/v2/`.
- `app/scripts/gerar-icones.mjs` usa o Edge e o Playwright já disponíveis neste PC.
  `app/index.html` aponta para os ícones e o manifesto pelo `BASE_URL`. A CSP aplica
  `default-src 'self'` ao manifesto, que é servido pela mesma origem.
- O topo mostra o nome em telas largas e só a copa até 640 px. O login usa o logo de
  40 px e a assinatura em texto “LAPIG · UFG”. Manutenção e catálogo usam a mesma
  mensagem padrão.
- O verde vem de `--cor-acento` e o nome de `--cor-texto`. A cor nova, a textura de
  login, a marca-d'água em Projetos e o símbolo no carregamento ficaram de fora.
  A navegação segue com os ícones Lucide. O [guia da marca](../marca.md) documenta
  proporções, cores e regeneração dos PNGs.

## Conferência local

As fotos de login, Projetos, Atlas Hídrico do Planalto e da seção Marca estão em
`.rascunho-marca/fotos/`, a 1280 e 390 px. O login foi aberto sem sessão em uma aba
do servidor local de exemplo, que normalmente já entra com o perfil de demonstração.
O favicon tem uma captura separada a 16 × 16 px.

As quatro telas também foram conferidas a 360 px. A 641 px, a barra e a seção Marca
cabem na tela. A demonstração anterior da página do projeto no catálogo já gerava
rolagem horizontal nessa largura e ficou fora do escopo.

O Edge confirmou que o manifesto e os ícones são servidos em `/v2/` sob a CSP do
build. Os cinco PNGs passaram na conferência de dimensões e transparência. O
desenho do ícone maskable ficou dentro da área segura.

`npm run lint` passou. Na raiz, `npm test` passou com 922 testes e 19 pulados.
No app, passaram os 378 testes e o build, incluindo as guardas de estilo e
de dados de exemplo. Para o app foi preciso usar `--configLoader native` no
Vitest e no Vite, porque as permissões da sessão bloquearam o carregador padrão.

As dependências da raiz e de `app/` foram copiadas de um worktree local com
`package-lock.json` idêntico. O cache npm estava inacessível nesta sessão. Nenhuma
dependência foi adicionada ao projeto.

As mudanças estão no worktree. O Git recusou a gravação do índice no OneDrive,
então o commit ficou pendente. `.rascunho-marca/identidade-buriti.patch` reúne o
diff com os PNGs para aplicação em outro checkout no mesmo ponto de partida.
Mensagem prevista para o commit: `feat(marca): aplica a identidade do Buriti ao v2`.

## Decisões para o Victor

- A copa em leque pode seguir para publicação depois da revisão do Claude?
- Qual nome deve aparecer para a IA quando o sistema se chamar Buriti? Hoje a
  coincidência aparece em “Buriti (IA)” no Admin e em “Buriti” como origem de
  pendências no projeto. O exemplo também usa esse nome para a conta da IA.

## Prompt do moodboard

```text
Use case: logo-brand. A single wide, rigorously art-directed moodboard with three clearly distinct graphic directions for Buriti, a calm, lightweight finance app made by LAPIG/UFG in the Brazilian Cerrado. On a plain white canvas, three equally spaced independent columns, one large symbol each, flat ink green #2E7D3B. Left: the distinctive splayed fan crown of a Mauritia flexuosa (buriti palm), a geometric fan with widely separated blade tips and a short stem, minimal silhouette with purposeful negative space. Center: one buriti fruit, compact tessellation of geometric overlapping scales inside an oval outline suggested by the scales alone. Right: vereda landscape as a tiny bold silhouette combining a fan palm with two horizontal water marks. Strong readable silhouettes for 16 pixels, restrained contemporary institutional identity, optical balance, no text of any kind, no gradients, no shadows, no framing, no coins or finance motifs, no generic leaf mark. This is exploration for hand-drawn SVG work, not an app mockup.
```
