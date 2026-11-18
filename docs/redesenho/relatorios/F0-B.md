# Relatório F0-B — Esqueleto do site novo (`app/`)

## O que foi feito

- Criado o projeto `app/` em Vite + Preact (JavaScript com JSX, sem TypeScript), com `base: '/controle-financeiro-lapig/v2/'`, `package.json` próprio (`preact`, `@supabase/supabase-js`, `lucide-preact`, `@fontsource-variable/inter`; dev: `vite`, `@preact/preset-vite`, `vitest`) e `app/package-lock.json`.
- Implementados `app/src/estilo/tokens.css` (exatamente os tokens de `docs/redesenho/estetica.md` §2, além de `--lh-1..6`, `--fw-400/500/600`, `--fonte-sans`, `--borda`, `--curva`, `--anel-foco`, `--raio-circulo` para manter zero literais nos componentes) e `app/src/estilo/base.css`.
- Implementados os 14 componentes em `app/src/componentes/` com CSS próprio por componente usando apenas tokens: `Valor`, `Cartao`, `Destaque` (`GradeDestaques`), `Situacao`, `Tabela`, `PainelLateral` (com trava de foco, restauração de foco e fechamento por `Esc` e clique no véu), `Botao`, `Campo`, `Seletor`, `Abas`, `AvisoFalha`, `Vazio`, `Esqueleto` e `BarraTopo`.
- Criado `app/src/util/formato.js` (`formatBRL`, `formatDataCompacta`, `formatDataCompleta`, `iniciaisUsuario`).
- Implementadas casca e rotas hash em `app/src/roteador.js` e `app/src/App.jsx` (`#/projetos`, `#/projetos/:id`, `#/analise`, `#/admin` restrito a `app_users.role === 'admin'`, e `#/componentes`), além do login/recuperação de senha via `supabase-js` em `app/src/paginas/Login.jsx` e `app/src/servicos/supabase.js` (compartilhando sessão com `/` por estarem na mesma origem).
- Configurada a CSP em `app/index.html` sem `unsafe-inline` em `script-src` e sem CDNs externos (fonte Inter e ícones empacotados localmente).
- Criado o guarda de estilo `app/scripts/verificar-estilo.mjs`, executado antes do `vite build`, reprovando `style=` inline em JSX (exceto `style={{ '--var': ... }}`), cores literais e `font-size`/`font-weight`/`box-shadow`/`border-radius` literais fora de `tokens.css`.
- Atualizados `.github/workflows/deploy.yml` (monta `_site/` = `frontend/` + `app/dist/` em `v2/`), `.github/workflows/ci.yml` (job `app` com testes e build), `package.json` da raiz (script `lint` cobrindo `app/src/`), `eslint.config.mjs` (bloco para `app/src/**/*.{js,jsx}`) e `.gitignore` (`app/node_modules/`, `app/dist/`).

## Peso do build

Saída do `npm --prefix app run build` (`vite build`):

| Artefato | Tamanho bruto | Gzip |
|---|---:|---:|
| `dist/assets/index-CFNU2bzt.js` | 282,08 kB | **77,31 kB** |
| `dist/assets/index-CI6VY4o9.css` | 24,73 kB | 4,74 kB |
| `dist/index.html` | 0,97 kB | 0,54 kB |
| Fontes Inter Variable (7 arquivos `.woff2`, sob demanda por `unicode-range`) | 218,52 kB total (48,26 kB `latin`) | — |

A abertura de `#/projetos` carrega **77,31 kB** de JS comprimido, abaixo do teto de ~200 kB.

## O que foi testado

- `npm --prefix app ci` — instalado limpo a partir de `app/package-lock.json`.
- `npm --prefix app test` — 2 arquivos, 16 testes passando (`app/tests/formato.test.js` e `app/tests/verificar-estilo.test.js`, incluindo prova de reprovação de arquivo inválido pelo guarda de estilo).
- `npm --prefix app run build` — guarda de estilo sem violações e build concluído com sucesso.
- `npm run lint` (raiz) — ESLint passando sem erros ou avisos em `frontend/js/`, `mcp/` e `app/src/`.
- `npm test` (raiz) — 36 arquivos, 576 testes passando.
- Conferência em navegador headless (`npx vite preview`, Chrome) em 1280×800 e 390×844: tela de login e `#/componentes` renderizam sem erros de console/CSP e sem estouro horizontal; clique em `Valor` abre `PainelLateral`, mantém foco preso dentro, fecha com `Esc` e devolve o foco ao botão.

## Ação manual necessária para o Victor (Supabase)

No painel do Supabase (**Authentication → URL Configuration → Redirect URLs**), adicionar a URL do novo site para que o fluxo de "Esqueci a senha" em `/v2/` funcione:

- `https://lapig-financeiro.github.io/controle-financeiro-lapig/v2/`

(Opcional para testes locais: `http://localhost:4173/controle-financeiro-lapig/v2/` e `http://localhost:5173/controle-financeiro-lapig/v2/`.)

## Desvios e pontos em aberto

- **Rota `#/componentes` aberta sem login**: para permitir revisão estética via `npx vite preview` sem credenciais de produção, `#/componentes` exibe o catálogo com dados fictícios mesmo sem sessão ativa; todas as rotas reais (`#/projetos`, `#/projetos/:id`, `#/analise`, `#/admin`) exigem autenticação Supabase.
- **`vitest` em `devDependencies` de `app/package.json`**: incluído para que `npm --prefix app test` e o job `app` em `.github/workflows/ci.yml` rodem de forma autônoma em `app/`, sem editar `vitest.config.js` nem `tests/` da raiz.
- **`style-src` na CSP de `app/index.html`**: mantido `'unsafe-inline'` em `style-src` apenas para compatibilidade com injeção de `<style>` no modo `vite dev`; `script-src` permanece estritamente `'self'`.
- **Fotos para revisão estética**: não geradas aqui (ficam a cargo do Claude, conforme combinado na tarefa).

## Rodada de correções

- **Tokens e tipografia (`tokens.css` e `base.css`)**: aplicadas as novas cores (`--cor-fundo: #F5F5F2`, `--cor-afundado: #F0F0EC`, `--cor-borda: #DCDAD3`, `--cor-borda-forte: #C9C7BF`, `--cor-borda-controle: #8C8F88`, `--grafico-3: #A87F1E`, `--grafico-4: #6F726B`), todos os tokens de dimensões e camadas (incluindo `--altura-chip: 28px`, `--largura-login: 360px`, `--largura-menu: 320px`, `--largura-documento: min(1100px, 94vw)`, `--altura-documento: 90vh`, `--altura-tela: 100vh` e `--z-*`). Removido `font-feature-settings: "cv11", "ss01"`, aplicado `font-variant-numeric: tabular-nums` direto no `body`, e removida qualquer coloração verde de `Valor` (números nunca são verdes).
- **Formatação e `Valor` (`app/src/util/formato.js` e `Valor.jsx`)**: `dinheiro(valor, { centavos, prefixo })` devolve `—` para vazio/NaN e usa `−` (`U+2212`); adicionado `dinheiroCompacto(valor)`; `dataCompacta` e `dataCompleta`. `Valor` só vira `<button>` clicável quando recebe `origem` + `onOrigem` (usado apenas em `Destaque`, `PainelLateral` e `Documento`, nunca dentro de `LinhaDeLista` ou `Tabela`).
- **Novos componentes e telas**: implementados `LinhaDeLista` (`Lista`), `Chip` (ativo com `--cor-acento-suave` e texto `--cor-texto`), `MenuSuspenso` (`MenuSuspensoItem`, `MenuSuspensoSeparador`), `Sino` (círculo `--cor-texto` com texto branco), `MenuUsuario`, `CabecalhoPagina`, `Documento` (moldura sem `pdf.js`, com faixa `--cor-acento-suave` e coluna `--largura-menu`) e `Manutencao` (lê `/controle-financeiro-lapig/manutencao.json` na abertura e a cada mudança de hash, bloqueando em tela cheia quando `ativo: true`). `BarraTopo` recomposta com `Chip`, `Sino` e `MenuUsuario`. `Login` simplificado conforme `estetica.md` §4 (cartão `--largura-login`, logo `--logo`, título "Entrar", campos E-mail e Senha, erro em `AvisoFalha` acima do botão primário de largura total, sem mais elementos). Papel lido via `supabase.from('app_users').select('role').eq('user_id', usuario.id).maybeSingle()`.
- **Guarda de estilo (`app/scripts/verificar-estilo.mjs`)**: endurecida conforme §8 para reprovar também `px`/`ms`/`vh` literais fora de `tokens.css` (exceto `1px`, `-1px`, `0` e condições `@media`), `font-weight` fora de `400`/`500`/`600` e `var(--x)` inexistente em `tokens.css`.
- **`deploy.yml` desacoplado**: o passo de instalação e build de `app/` usa `continue-on-error: true`, garantindo que falha no `app/` não impeça a publicação de `frontend/`.
- **ESLint (`eslint.config.mjs` e `package.json`)**: `npm run lint` passou a cobrir `app/` inteiro (com `ignores` para `app/node_modules/**` e `app/dist/**`). Desvio técnico: `eslint-plugin-react@7.37.5` declara `peerDependencies` até ESLint 9 (`^3 || ... || ^9.7`) e falha com `ERESOLVE` contra `eslint@^10.2.1` da raiz; para não quebrar `npm ci` nem alterar `package-lock.json` da raiz, foi mantido um plugin local mínimo `react/jsx-uses-vars` em `eslint.config.mjs` usando `context.sourceCode.markVariableAsUsed`, mantendo `no-unused-vars` ativo em `app/**/*.{js,jsx}`.
- **Catálogo `#/componentes`**: atualizado para exibir todos os componentes e as duas telas de referência (§5: `Projetos` com `LinhaDeLista` e `Global Methane Hub · 30.113` com `Destaque`, `Abas`, `Tabela`, `PainelLateral` → `Documento` e prévia de `Manutencao`).
- **Peso atualizado do build (`dist/assets/*.js` na abertura de `#/projetos`)**: `dist/assets/index-DlYNmKay.js` com `289,98 kB` bruto / **79,10 kB gzip** (`index--YWXMb3_.css` com `31,76 kB` / `5,57 kB` gzip; `dist/index.html` com `0,97 kB` / `0,54 kB` gzip).
- **Verificações após a rodada de correções**: `npm --prefix app ci` (ok), `npm --prefix app test` (3 arquivos, 24 testes passando), `npm --prefix app run build` (guarda sem violações + Vite ok), `npm run lint` (0 erros/avisos), `npm test` da raiz (36 arquivos, 576 testes passando), e conferência em Chrome headless sobre `npx vite preview` (login e `#/componentes` em 1280×800 e 390×844 sem erros de console nem estouro horizontal).

## Terceira rodada

- **Decisões da revisão (§6b de `estetica.md`)**:
  - `--cor-texto-3` atualizado para `#696C65`, adicionado `--anel-foco-interno: inset 0 0 0 2px var(--cor-acento)`, tokens de coluna (`--col-codigo`, `--col-valor`, `--col-situacao`), `--z-base: 1` e quebras `--quebra-1`/`--quebra-2` documentadas.
  - CSP injetada via plugin em `app/vite.config.js` somente no build (`app/index.html` livre em dev); catálogo `#/componentes` livre em dev e restrito a `admin` autenticado em produção.
  - `Manutencao` resolve caminho relativo a `import.meta.env.BASE_URL` (`../manutencao.json`), não aparece antes da primeira resposta, verifica a cada 60 s e na troca de rota, e recarrega a página quando desliga.
- **Componentes e comportamento**:
  - `Valor.css`: hover não altera cor do texto (muda só a cor do sublinhado pontilhado) e sublinhado nos `Destaque`s com origem usa `--sublinhado-ativo` para visibilidade. `dinheiro()` preserva o sinal `−` (`U+2212`) mesmo em valores negativos pequenos (`-0.4`, `-0.01`, `-0.001`).
  - `Chip.css`: estado ativo e hover ativo mantêm `color: var(--cor-texto)`.
  - `PainelLateral` e `Documento`: `aoFechar` guardado em `useRef` (efeito de foco não depende da referência da função), IDs via `useId()`, e fechamento por `Esc` controlado por pilha em `app/src/util/pilhaEsc.js` (sem `querySelector` global).
  - `Campo` e `Seletor`: `aria-describedby` conecta erro e ajuda com IDs gerados por `useId()`.
  - `LinhaDeLista` em `<ul><li><a>` com grade fixa e `--anel-foco-interno`; `Tabela` usa botão esticado na primeira célula (sem `role` na `<tr>`), cabeçalho fixo à página, `thead` visualmente oculto abaixo de 640 px, e renderiza `Vazio` quando sem linhas.
  - Menus (`BarraTopo` filtro, `Sino`, `MenuUsuario`, `MenuSuspenso`) convertidos ao padrão de divulgação (`aria-expanded`, sem `role="menu"`/`menuitem`), movendo foco ao primeiro item ao abrir e devolvendo ao gatilho no `Esc`.
  - `Abas`: padrão completo `tablist`/`tab`/`tabpanel`, setas + `Home`/`End` + `tabIndex` itinerante e rolagem horizontal no celular.
  - `GradeDestaques`: no celular, destaque principal em largura total e os 3 menores em 2 colunas; `Esqueleto` com `role="status"` e texto para leitor de tela.
- **Roteador, auth e catálogo**:
  - `roteador.js`: `decodeURIComponent` protegido com `try/catch`.
  - `App.jsx` e `supabase.js`: consultas a `app_users` (`role`, `display_name`, `email` conferidos em `database/033_user_project_scoping.sql`) adiadas com `setTimeout(..., 0)` fora do callback de `onAuthStateChange`; falha ao ler perfil mostra `AvisoFalha` sem rebaixar para `professor`; rota `#/admin` não renderiza antes de o papel ser conhecido.
  - Catálogo `#/componentes`: títulos separando "Tela Projetos", "Página do projeto" e "Componentes e estados"; lista em ordem alfabética (`Global Methane Hub`, `Kalungas`, `Remap`); "Pasta no Drive" só para admin; `Valor` clicável apenas em `Destaque`/`PainelLateral`/`Documento`; abas alternando conteúdo real; negativos com `U+2212` em todo o catálogo.
- **Guarda de estilo e `deploy.yml`**:
  - `verificar-estilo.mjs` passou a reprovar também `z-index` literal e `@media` fora de `640px`/`1024px` (além de `prefers-reduced-motion`).
  - `deploy.yml`: em falha do build de `app/`, grava página estática de indisponibilidade em `_site/v2/index.html` com link de volta ao sistema principal.
- **Peso atualizado do build (`dist/assets/*.js` na abertura de `#/projetos`)**: `dist/assets/index-DYQ2F8C0.js` com `295,72 kB` bruto / **80,83 kB gzip** (`index-D3TnMiGP.css` com `33,21 kB` / `5,81 kB` gzip; `dist/index.html` com `0,97 kB` / `0,54 kB` gzip).
- **Verificações**: `npm --prefix app ci`, `npm --prefix app test` (5 arquivos, 31 testes incluindo `dinheiro` com sinal pequeno, roteador com `%` malformado, pilha de `Esc` e foco estável em re-render), `npm --prefix app run build`, `npm run lint`, `npm test` da raiz (36 arquivos, 576 testes), e Chrome headless a 1280×800, 390×844 e 360×800 sem estouro horizontal na barra do topo nem nas abas.

## 4ª rodada — conferência visual do Claude (18/11, noite)
Executor: **Orchestrator (Neon)** (`gemini-pro-orchestrator-neon`, conversa agy `2a7c3d98-2995-4b3b-9a15-31614763589d`).
- Claude conferiu o catálogo a 800 px e 360 px. Painel "De onde vem", menu de centros, avisos, vazio e esqueleto ok; soma das partes do painel bate com o total.
- Corrigido pelo Claude: `Abas.css` com `overflow-y: hidden` (barra de rolagem vertical de 1 px nas abas).
- Corrigido pelo Neon (só abaixo de 640 px): barra do topo cortava "Admin" (padding/gap menores, logo e links um degrau menores); valor dos destaques secundários estourava o cartão (fs-4 nesses cartões). Conferido pelo Claude a 360 px: sem estouro, três links inteiros. Testes (31), build com guarda de estilo e lint passam.
- Para a F1 (não bloqueia): a 360 px a faixa de abas rola na horizontal e mostra a barra de rolagem do sistema; avaliar esconder a barra ou encurtar rótulos.
