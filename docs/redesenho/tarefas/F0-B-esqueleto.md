# F0-B — Esqueleto do site novo (`app/`) com a identidade visual

Leia antes, inteiros: `docs/redesenho/README.md` e **`docs/redesenho/estetica.md` (siga à risca)**.
Também: `frontend/js/supabase-config.js` (URL e anon key, que são públicas), `frontend/js/pure-fns.js`
(`formatBRL` e afins), `.github/workflows/deploy.yml` e `ci.yml`.

## O que fazer
1. **Projeto** `app/` com Vite + Preact (JavaScript com JSX, sem TypeScript), `package.json` próprio,
   dependências mínimas: `preact`, `@supabase/supabase-js`, `lucide-preact`, `@fontsource-variable/inter`;
   dev: `vite`, `@preact/preset-vite`. `base` do Vite = `/controle-financeiro-lapig/v2/`. Nada de
   biblioteca de UI pronta (MUI, Tailwind etc.): os componentes são nossos.
2. **Estilo**: `app/src/estilo/tokens.css` com exatamente os tokens de `estetica.md` §2; `base.css` (reset
   leve, tipografia, foco). CSS por componente em arquivos `.css` ao lado do componente, usando só tokens.
3. **Componentes** em `app/src/componentes/`: Valor, Cartao, Destaque, Situacao, Tabela, PainelLateral,
   Botao, Campo, Seletor, Abas, AvisoFalha, Vazio, Esqueleto, BarraTopo. Comportamento e visual como em
   `estetica.md` §4 (acessibilidade: Valor é `<button>`, painel lateral prende o foco e fecha com Esc).
   `formatBRL` e datas `set/26` em `app/src/util/formato.js`, com testes (Vitest, reaproveitando a config
   da raiz ou uma própria em `app/`).
4. **Casca e rotas** (hash): `#/projetos` (início), `#/projetos/:id`, `#/analise`, `#/admin` (só admin;
   papel lido de `app_users.role` do usuário logado), `#/componentes` (catálogo de todos os componentes com
   dados falsos — é por ele que a estética será revisada). As três páginas reais mostram só o componente
   Vazio ("Em construção") por enquanto.
5. **Login** com supabase-js (e-mail e senha), tela limpa seguindo a estética; sessão compartilhada com o site
   antigo é esperada (mesmo endereço).
6. **CSP** no `app/index.html` equivalente à de `frontend/index.html`, sem `unsafe-inline` para script se o
   Vite permitir; nada de CDN (tudo empacotado).
7. **Guarda de estilo** `app/scripts/verificar-estilo.mjs` conforme `estetica.md` §8, rodando antes do build
   (`"build": "node scripts/verificar-estilo.mjs && vite build"`), com um teste que prova que ele reprova um
   arquivo ruim.
8. **Publicação**: em `deploy.yml`, montar o artefato numa pasta temporária = `frontend/` + build de `app/`
   em `v2/` (não grave o build dentro de `frontend/` no repositório). Em `ci.yml`, um job que instala e
   builda `app/`. Lint da raiz passa a cobrir `app/src`. `.gitignore`: `app/node_modules`, `app/dist`.
9. Peso: a abertura de `#/projetos` não pode carregar mais que ~200 KB de JS (comprimido). Registre o número.
10. Relatório em `docs/redesenho/relatorios/F0-B.md`, incluindo: o que o Victor precisa fazer no painel do
    Supabase (Redirect URL de `/v2/`), o peso do build, e fotos? (não precisa; o Claude tira).

## Arquivos (só estes)
`app/**`, `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `package.json` da raiz (só o script de
lint), configuração do ESLint da raiz (só para incluir `app/src`), `.gitignore`,
`docs/redesenho/relatorios/F0-B.md`. **Não mexa em `frontend/`, `database/`, `mcp/`.**

## Correções depois da revisão do plano (18/11, valem por cima do texto acima)
- `estetica.md` foi revisada: releia §2 (cores novas, tokens de dimensão e camadas), §4 (Valor, LinhaDeLista,
  Chip, MenuSuspenso, Sino, MenuUsuario, CabecalhoPagina, Login, Manutenção, Documento) e §8 (guarda mais rígida).
- `app/package-lock.json` é versionado (o `npm ci` precisa dele).
- Testes do app: `app/vitest.config.js` próprio e script `test` em `app/package.json`; o CI roda os dois.
- ESLint: bloco para `app/**/*.{js,jsx}` com `sourceType: module`, `ecmaFeatures.jsx`, `globals.browser` e
  `eslint-plugin-react` só com `react/jsx-uses-vars` (para os imports usados em JSX não virarem erro). Use `.jsx`.
- Deploy: o passo do app não pode impedir a publicação de `frontend/` (README §7b item 8).
- Papel do usuário: `supabaseClient.from('app_users').select('role').eq('user_id', id).maybeSingle()`, como
  `frontend/js/ai/tools.js:566`.
- Peso: some o `gzip` de `dist/assets/*.js` carregados na abertura de `#/projetos` e registre o número.

## Pronto quando
`npm --prefix app ci && npm --prefix app run build` passa; `npm run lint` e `npm test` da raiz passam;
`npx vite preview` (em `app/`) mostra login, casca e `#/componentes` seguindo a estética. **Sem commit.**
