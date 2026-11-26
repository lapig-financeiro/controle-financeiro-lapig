# Estética do site novo — regras para seguir à risca

> Vale para tudo em `app/`. Quem implementa **não cria** cor, tamanho, sombra ou componente novo: usa o que
> está aqui. Se faltar algo, pare e registre no relatório da tarefa. Há um teste (`app/scripts/verificar-estilo.mjs`)
> que reprova o build quando a regra é quebrada.

## 1. Princípios

1. **Calmo e limpo.** Fundo quase branco, superfícies brancas, bordas finas, nenhuma sombra em cartão.
   O espaço vazio organiza; não a cor.
2. **O número é o protagonista.** Tipografia de números tabular, alinhada, grande quando é a resposta.
3. **Cor só com significado.** Verde = interação/positivo; âmbar = atenção; vermelho = problema. Nada de
   cor decorativa, fundo colorido de cartão, gradiente ou brilho.
4. **Uma resposta por bloco.** Cada cartão responde uma pergunta. Detalhe vai para o painel lateral.
5. **Leve.** Nada de biblioteca carregada sem uso: PDF, Word, planilha e gráfico entram sob demanda.

## 2. Tokens (`app/src/estilo/tokens.css` — único lugar com valores literais)

### Cores
| Token | Valor | Uso |
|---|---|---|
| `--cor-fundo` | `#F5F5F2` | fundo da página (precisa separar do cartão branco sem sombra) |
| `--cor-superficie` | `#FFFFFF` | cartões, barra do topo, painel lateral, tabelas |
| `--cor-afundado` | `#F0F0EC` | hover de linha, skeleton, área de código |
| `--cor-borda` | `#DCDAD3` | bordas de cartão, divisórias de tabela |
| `--cor-borda-forte` | `#C9C7BF` | separador de cabeçalho de tabela, sublinhado pontilhado do Valor |
| `--cor-borda-controle` | `#8C8F88` | borda de campo, seletor e caixa de seleção (≥ 3:1, WCAG 1.4.11) |
| `--cor-texto` | `#1D1F1C` | texto principal e números |
| `--cor-texto-2` | `#545750` | rótulos, contexto, texto secundário |
| `--cor-texto-3` | `#6F726B` | metadado (datas de atualização, "via balancete") — mínimo 12 px |
| `--cor-acento` | `#2E7D3B` | botão primário, link, foco, aba ativa, ponto "em dia" (5,1:1) e símbolo do Buriti |
| `--cor-acento-hover` | `#256632` | hover do primário |
| `--cor-acento-suave` | `#E8F2EA` | fundo de seleção e de chip ativo — o texto em cima é `--cor-texto`, nunca o acento |
| `--cor-marca` | `#429B4D` | **só** logo e marcas gráficas (barra de gráfico). Nunca em texto (3,5:1) |
| `--cor-atencao` | `#A15C07` | palavra/ponto de atenção |
| `--cor-atencao-suave` | `#FDF4E3` | fundo do aviso de falha/atenção |
| `--cor-problema` | `#B42318` | palavra/ponto de problema, valor negativo que é problema |
| `--cor-problema-suave` | `#FDECEA` | fundo de erro |
| `--cor-veu` | `rgba(29, 31, 28, 0.24)` | fundo atrás de painel lateral/modal |

**Números nunca são verdes.** Valor positivo é `--cor-texto`. Só o negativo que significa problema vai para
`--cor-problema`. O verde é da interação; a situação de um centro é dita pela Situação (ponto + palavra).

Gráficos (no máximo 4 séries): `--grafico-1 #2E7D3B`, `--grafico-2 #9CC9A2`, `--grafico-3 #A87F1E`,
`--grafico-4 #6F726B`. Séries claras (`--grafico-2`) levam contorno de 1,5 px em `--grafico-1` para
chegar a 3:1. Previsto = clara com contorno; realizado = cheia (`--grafico-1`). Grade em `--cor-borda`, sem
linhas de eixo; legenda em cima à esquerda, `--fs-1`, só com 2+ séries; eixo de dinheiro em formato compacto
(§6). Biblioteca: Chart.js, carregada sob demanda.

Modo escuro: **não agora**. Os tokens existem para que um dia ele seja só outra tabela de valores.

### Tipografia
Família única: **Inter** (variável, auto-hospedada via `@fontsource-variable/inter`; nada de Google Fonts).
Sem `font-feature-settings` além do padrão. Números sempre com `font-variant-numeric: tabular-nums`
(aplicado no `body`, para não depender de quem implementa).
Pesos permitidos: **400, 500, 600**. Nada de 300, 700, itálico decorativo ou caixa alta.

| Token | Tamanho / altura | Peso | Uso |
|---|---|---|---|
| `--fs-1` | 12 / 16 px | 400–500 | metadado, rótulo de cabeçalho de tabela, legenda |
| `--fs-2` | 14 / 20 px | 400–500 | **padrão da interface**: tabelas, botões, menus, corpo de cartão, painel |
| `--fs-3` | 16 / 24 px | 600 (título) / 400 | título de cartão/bloco; parágrafo longo de explicação (raro) |
| `--fs-4` | 20 / 28 px | 600 | título da página, título do painel lateral |
| `--fs-5` | 28 / 34 px | 600 | número de destaque de um cartão |
| `--fs-6` | 40 / 44 px | 600 | número-resposta da página (no máximo **um** por tela) |

Tamanhos ≥ `--fs-4` levam `letter-spacing: -0.01em`. Texto corrido com no máximo 72 caracteres por linha.

### Espaço, forma, movimento
- Espaçamento (só estes): `--esp-1 4px`, `--esp-2 8px`, `--esp-3 12px`, `--esp-4 16px`, `--esp-5 24px`,
  `--esp-6 32px`, `--esp-7 48px`, `--esp-8 64px`.
- Raio: `--raio-1 6px` (chip, input, badge), `--raio-2 10px` (botão, cartão), `--raio-3 14px` (painel, modal).
- Borda: sempre `1px solid var(--cor-borda)`.
- Sombra: **uma só**, `--sombra-sobreposta: 0 12px 32px rgba(29,31,28,.12)`, para painel lateral, menu
  suspenso e modal. Cartão não tem sombra.
- Movimento: `--rapido 150ms`, `--medio 200ms`, curva `cubic-bezier(.2,0,0,1)`. Hover só muda cor/fundo.
  Painel lateral entra deslizando 200 ms. Com `prefers-reduced-motion`, nenhuma animação.
- Foco: anel `0 0 0 2px var(--cor-superficie), 0 0 0 4px var(--cor-acento)` sempre visível no teclado.

### Dimensões e camadas (também tokens; nenhuma medida literal fora de `tokens.css`, exceto `1px` de borda e `0`)
`--altura-topo 56px`, `--altura-controle 36px`, `--altura-controle-compacto 32px`, `--altura-linha 44px`,
`--largura-conteudo 1120px`, `--largura-painel 480px`, `--largura-documento min(1100px, 94vw)`,
`--largura-login 360px`, `--largura-menu 320px`, `--avatar 28px`, `--ponto 6px`, `--icone-1 16px`,
`--icone-2 20px`, `--traco-icone 1.75`, `--logo 24px`, `--logo-login 40px`, `--sublinhado-ativo 2px`,
`--medida-texto 72ch`.
Camadas: `--z-topo 10`, `--z-veu 40`, `--z-painel 50`, `--z-documento 60`, `--z-menu 70`, `--z-aviso 80`.
Logo do Buriti em `app/public/marca/`. Consulte as versões e as regras de uso em [Marca](marca.md).

## 3. Layout

- **Barra do topo** (56 px, `--cor-superficie`, borda inferior): à esquerda o logo (24 px de altura) e os três
  itens — Projetos, Análise, Admin (Admin só para admin); item ativo em `--cor-texto` 500 com sublinhado de
  2 px `--cor-acento`; inativos `--cor-texto-2`. À direita: filtro de visão (só admin, ver §5), sino de
  pendências, menu do usuário (iniciais num círculo de 28 px). **Não há barra lateral.**
- **Conteúdo**: largura máxima 1120 px, centralizado; margem lateral 32 px (16 px abaixo de 640 px); entre
  blocos `--esp-6`; dentro de cartão `--esp-5` de preenchimento.
- Pontos de quebra: 640 px e 1024 px. Abaixo de 640 px, grades viram uma coluna e tabelas viram lista.
- Cabeçalho de página: título `--fs-4`, uma linha de contexto `--fs-2 --cor-texto-2`, ações à direita.

## 4. Componentes (em `app/src/componentes/`; nenhuma tela cria variação própria)

**Valor** — todo número monetário ou data que vem do banco.
- Formatação: `app/src/util/formato.js` (não copie `formatBRL` do site antigo: ela transforma vazio em zero).
  `dinheiro(v, { centavos })` devolve `—` para `null`/`undefined`/`NaN`; negativo com `−` (U+2212).
  **Sem centavos**: linha de lista, célula de tabela, Destaque. **Com centavos**: painel lateral e documento.
  `dinheiroCompacto(v)` (`R$ 1,24 mi`, `R$ 84,3 mil`) só em total de cabeçalho e eixo de gráfico.
  Em tabela, o cabeçalho da coluna diz "(R$)" e as células vêm sem o prefixo.
- Clicável **só** no Destaque e dentro do painel lateral/documento (onde ele é um `<button>`). Em linha de
  lista e célula de tabela o Valor é texto: a linha é que é clicável (não há botão dentro de botão).
- Clicável quando a consulta devolveu origem; sem origem é texto comum (nunca sublinhado falso).
- Com origem: sublinhado pontilhado de 1 px em `--cor-borda-forte` que vira `--cor-acento` no hover; cursor
  pointer; clique abre **De onde vem**.
- Sem dado: `—` em `--cor-texto-3`, com `title` dizendo o motivo ("sem balancete"). **Nunca `R$ 0,00` por falta
  de dado.**
- Digitado (sem documento): exibe normalmente e, no painel, diz "valor digitado, sem documento".

**Cartão** — fundo `--cor-superficie`, borda, raio 2, preenchimento `--esp-5`. Título `--fs-3` 600 opcional.
Sem ícone no título, sem fundo colorido, sem sombra.

**Destaque (stat)** — rótulo `--fs-2 --cor-texto-2` em cima; valor `--fs-5` (ou `--fs-6` se for a resposta da
página); contexto `--fs-1 --cor-texto-3` embaixo ("balancete de set/26"). No máximo 4 lado a lado.

**Situação** — ponto de 6 px + uma palavra, `--fs-2`, sem fundo. Palavras fixas: `em dia` (acento),
`atenção` (atenção), `problema` (problema), `sem balancete` / `sem plano` / `sem dado` (texto-3).
Uma por linha de tabela.

**LinhaDeLista** — para listas de navegação (Projetos): a linha inteira é um link para outra página, altura
`--altura-linha`, colunas fixas por tela, hover `--cor-afundado`, nada clicável dentro dela.

**Tabela** — para dados dentro de uma página; a linha abre o painel lateral. Cabeçalho `--fs-1` 500 `--cor-texto-2`, sem caixa alta, borda inferior `--cor-borda-forte`;
linhas de 44 px, borda inferior `--cor-borda`, sem zebra; hover `--cor-afundado`; números à direita; linha
clicável abre o painel lateral; cabeçalho fixo ao rolar. Abaixo de 640 px vira lista de cartões compactos.

**Painel lateral** — da direita, 480 px (100% no celular), `--cor-superficie`, `--sombra-sobreposta`, véu
`--cor-veu`. Título `--fs-4`, botão fechar (ícone X 20 px) no topo, Esc fecha, foco preso dentro.
É onde mora todo detalhe: rubricas, lançamentos, parcelas, versões, origem.

**De onde vem** — no painel lateral: a conta em árvore (cada parte é um Valor clicável). Clicar numa folha
abre o **Documento**: janela larga (`--largura-documento`, altura 90vh, `--raio-3`, `--sombra-sobreposta`,
`--z-documento`) com o documento à esquerda e, à direita (coluna de `--largura-menu`), o valor, a parte
e "achado pelo código/valor/texto". O trecho fica numa faixa `--cor-acento-suave`. Reaproveita a busca de
`frontend/js/origem-busca.js`; pdf.js, mammoth e SheetJS carregam só aqui.

**Chip** — altura `--altura-chip` (28px, acrescentar aos tokens), raio 1, borda `--cor-borda`, `--fs-2` 500, ícone opcional 16 px; ativo com fundo
`--cor-acento-suave` e texto `--cor-texto`. Usado no filtro de visão e em filtros rápidos.

**MenuSuspenso** — `--largura-menu`, `--cor-superficie`, raio 2, `--sombra-sobreposta`, `--z-menu`; itens de
`--altura-controle`, `--fs-2`; separadores `--cor-borda`; fecha com Esc e clique fora.

**Sino** — ícone 20 px; com pendência, número em `--fs-1` 600 dentro de um círculo `--cor-texto` com texto
branco (não vermelho). Abre um MenuSuspenso com as pendências (título curto + centro + há quanto tempo).

**MenuUsuario** — avatar (iniciais, `--avatar`, fundo `--cor-afundado`, texto `--cor-texto-2`, `--fs-1` 600);
abre MenuSuspenso com nome, papel e "Sair".

**CabecalhoPagina** — link de volta opcional (`--fs-2`, `--cor-texto-2`, ícone seta 16 px); título `--fs-4`;
linha de contexto `--fs-2 --cor-texto-2`; ações à direita. `--esp-6` abaixo.

**Login** — fundo `--cor-fundo`, cartão central `--largura-login` com preenchimento `--esp-6`. No cartão,
logo horizontal em `--logo-login`, título "Entrar" em `--fs-4`, campos E-mail e Senha empilhados com
rótulo em `--fs-2` 500 e botão primário de largura total. Erro num AvisoFalha acima do botão. Abaixo do
cartão, "LAPIG · UFG" em `--fs-1` e `--cor-texto-3`.

**Manutenção** — o app lê `/controle-financeiro-lapig/manutencao.json` (o mesmo do site antigo) na abertura
e a cada navegação. Em manutenção, a tela cheia exibe o logo horizontal em `--logo` e bloqueia
gravações. Usa o texto do arquivo quando preenchido e a mensagem padrão do Buriti nos demais casos.

**Botão** — altura 36 px (32 compacto), raio 2, `--fs-2` 500. Primário: fundo `--cor-acento`, texto branco
(**um por tela**). Secundário: fundo branco, borda. Fantasma: só texto `--cor-acento`. Ícone opcional à
esquerda, 16 px.

**Campo e seletor** — `--altura-controle`, borda `--cor-borda-controle`, raio 1, `--fs-2`; rótulo acima
(`--fs-2` 500); foco com o anel. Seletor = `<select>` nativo estilizado (nada de listbox próprio).

**Abas** — texto `--fs-2` 500; ativa com sublinhado de 2 px `--cor-acento`; sem caixas.

**Aviso de falha** — faixa `--cor-atencao-suave`, texto `--cor-texto`, uma frase do que falhou e o botão
fantasma "Tentar de novo". Erro grave: `--cor-problema-suave`.

**Vazio** — uma frase em `--cor-texto-2` e, se fizer sentido, um botão. Sem ilustração.

**Carregando** — esqueleto (blocos `--cor-afundado` com pulso de 1,2 s) no formato do conteúdo. Girador só
dentro de botão.

**Ícones** — `lucide-preact`, importados um a um; 16 px em linha, 20 px na barra do topo; traço 1,75;
`currentColor`. Só onde ajudam: navegação, fechar, sino, link externo, origem, filtro. Nenhum ícone decorativo.

## 5. Telas de referência

**Projetos** (início):
```
Projetos                                        [Todos os centros ▾]  (sino) 3   VA
17 centros · R$ 1,24 mi livres no total · 2 centros ocultos

  Global Methane Hub          30.113    R$ 84.300 livres até ago/27     ● em dia
  Remap                       30.105    R$ 12.900 livres até mar/27     ● atenção
  Kalungas                    30.XXX    —                               ● sem balancete
```
Componente: LinhaDeLista (a linha leva à página do projeto). Ordem alfabética, chips de filtro rápido por
situação. Com centros ocultos, o chip mostra "15 de 17 centros" e a linha de contexto diz "2 centros ocultos".
O total do cabeçalho é o único lugar com `dinheiroCompacto`.

**Página do projeto**:
```
← Projetos
Global Methane Hub · 30.113                                      Pasta no Drive ↗
Vigência até 31/08/2027 · faltam 21 meses

R$ 84.300                         [Bolsas/mês R$ 18.400] [Repasses 3 de 4] [Pendências 1]
livres para gastar até ago/27
balancete de set/26

Dinheiro | Bolsas | Documentos | Pendências           (abas)
  rubrica           previsto      realizado    comprometido     livre
  Pessoal          864.000       612.400       167.300       84.300
  ...
```
"R$ 84.300 livres" é o `--fs-6` da página (Destaque, clicável se tiver origem). Os três destaques menores são
`--fs-5`. A tabela usa Tabela (linha abre painel; cabeçalhos "previsto (R$)" etc.). "Pasta no Drive" só para
admin. Vigência vinda de campo digitado diz "vigência digitada" em `--fs-1 --cor-texto-3` até a F4.

**Filtro de visão (admin)**: chip na barra do topo, "Todos os centros" ou "12 de 17 centros". Abre um menu com
a lista de centros agrupada por professor responsável, caixas de seleção, atalhos "Só os de <professor>" e
"Mostrar todos". Enquanto houver centro oculto, o chip fica em `--cor-acento-suave` e os totais dizem
"N centros ocultos". Vale para todas as telas, o sino e a Análise.

## 6. Escrita

- Português do Brasil, frase com só a primeira maiúscula, sem caixa alta, sem emoji, sem ponto de exclamação.
- Palavras, não códigos: "Pessoal", não "a-"; o código aparece no painel lateral. Centros pelo nome + código.
- Datas: compacto `set/26`; completo `30/09/2026`. Períodos: "até ago/27".
- Dinheiro: `formatBRL`; nunca "R$ 0,00" por falta de dado.
- Toda ressalva que muda a decisão aparece junto do número, numa linha curta ("sem balancete desde ago/26").

## 6b. Decisões da revisão da F0 (18/11) — valem por cima do resto
- `--cor-texto-3` passa a `#696C65` (4,6:1 também sobre `--cor-afundado`).
- Foco dentro de contêiner com rolagem (linha de lista, linha de tabela, aba) usa
  `--anel-foco-interno: inset 0 0 0 2px var(--cor-acento)`, para não ser cortado; o resto usa o anel normal.
- Valor com origem: no hover muda **só** a cor do sublinhado. O texto nunca muda de cor.
- LinhaDeLista: `<ul><li><a>`, grade CSS com colunas fixas que a página declara (ex.: nome 1fr · código
  `--col-codigo` · valor `--col-valor` · situação `--col-situacao`, todos tokens), altura `--altura-linha`.
- Tabela: linha clicável pelo padrão "link esticado" (um `<button>` na primeira célula cobre a linha), sem
  `role` na `<tr>`; cabeçalho fixo em relação à página (sem rolagem horizontal no desktop); no celular o
  `thead` fica visualmente oculto, não removido.
- Menus (filtro, sino, usuário) seguem o padrão de **divulgação** (botão com `aria-expanded` + lista de links
  ou botões), não `role="menu"`; ao abrir, foco no primeiro item; Esc fecha e devolve o foco ao botão.
- Abas: `tablist`/`tab`/`tabpanel` completos, setas e tabindex itinerante; rolagem horizontal no celular.
- Os quatro destaques da página do projeto ficam numa grade de cartões (1 grande + 3 menores); no celular,
  2 colunas para os menores.
- Barra do topo até 640 px: logo só com o símbolo em `--logo`, chip do filtro com ícone e número de ocultos
  e espaçamento reduzido entre os controles e os links. Tudo cabe na largura de 360 px.
- De 641 a 1024 px, o espaçamento da barra diminui para acomodar o logo horizontal e o texto do filtro.
- `@media` só com 640 px e 1024 px (tokens `--quebra-1`/`--quebra-2` documentados; a guarda confere).
- CSP só no build (o modo dev do Vite injeta script). Catálogo `#/componentes`: livre em dev, só para admin
  logado em produção.
- Manutenção: igual ao site antigo; a tela não aparece antes da primeira consulta ao `manutencao.json`
  responder; caminho via `import.meta.env.BASE_URL` (`../manutencao.json`).

## 7. Proibido

Gradiente; brilho/glow; vidro fosco; sombra em cartão; fundo colorido de cartão; mais de uma cor de acento;
caixa alta em rótulo; ícone em todo título; `style=` inline; cor ou tamanho fora dos tokens; peso 700+;
texto centralizado em corpo; tabela com zebra; gráfico de pizza ou 3D; mais de 4 séries num gráfico;
carregar PDF/Word/planilha/gráfico na abertura; barra lateral.

## 8. Conferência

- `app/scripts/verificar-estilo.mjs` (roda no `npm --prefix app run build` e no CI) reprova: `style=` em JSX
  (exceto `style={{ '--var': … }}` para variável CSS — por isso a CSP tem `style-src 'self' 'unsafe-inline'`;
  script continua sem inline), hex/rgb fora de `tokens.css`, qualquer `px`/`ms`/`vh` literal fora de
  `tokens.css` (exceto `1px` e `0`), `font-weight` fora de 400/500/600, e `var(--x)` que não existe em
  `tokens.css`.
- Toda tela nova passa por foto (Chrome headless, 1280 e 390 px) e leitura "de quem abre pela primeira vez"
  pelo Gemini antes de ser dada como pronta.
