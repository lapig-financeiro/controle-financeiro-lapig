# Relatório F1-B — Telas da fase 1 (Projetos, página do projeto, filtro de visão, pendências)

## O que foi feito

- **Modo exemplo e build (`app/package.json`, `app/.env.exemplo`, `app/vite.config.js`)**:
  - Adicionado script `"dev:exemplo": "vite --mode exemplo"` em `app/package.json` e criado `app/.env.exemplo` (`VITE_DADOS=exemplo`).
  - Configurado `server.fs.allow: ['..']` em `app/vite.config.js` para liberar o import direto de `../frontend/js/planejamento-dinheiro.js` sem copiá-lo nem editá-lo.
- **Roteador e utilitários (`app/src/roteador.js`, `app/src/util/formato.js`)**:
  - `parsearRota` e `urlProjeto` suportam `#/projeto/<id>` e `#/projeto/<id>/<aba>` (aba opcional em `dinheiro | bolsas | documentos | pendencias`), preservando compatibilidade com `#/projetos/<id>`.
  - Adicionados `hojeISO`, `mesesRestantes` (mesma fórmula inclusiva de `get_saldo_livre`, migração 048) e `tempoRelativo` em `app/src/util/formato.js`.
- **Camada de dados (`app/src/servicos/dados.js`, `app/src/servicos/dadosExemplo.js`)**:
  - Implementadas todas as funções do contrato devolvendo `{ dados, erro }`: `resumoProjetos`, `pendencias`, `resolverPendencia`, `filtroVisao`, `salvarFiltroVisao`, `saldoLivre`, `repasses`, além das duas funções separadas `balancetes` (`get_balancetes_by_project`) e `planos` (`get_planos_historico`). Falha ou retorno inválido nunca vira zero nem lista vazia silenciosa.
  - Modo exemplo sem login carregado via `import('./dadosExemplo.js')` exclusivamente dentro do guard `import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo'`, com 8 centros sintéticos (cobrindo `em dia`, `atenção`, `problema` com grupo negativo, `sem balancete`, `sem plano` no shape mínimo da 048, `sem dado` com `erro: 'falha_saldo_livre'`, 2 centros ocultos iniciais e pendência sem centro).
- **Componentes (`BarraTopo`, `FiltroVisao`, `Sino`, `Botao`, `Abas.css`)**:
  - Criado `FiltroVisao` (somente para `admin`): exibe `"Todos os centros"` ou `"N de M centros"`, agrupa visualmente por `responsaveis[0]` com `"Sem responsável"` por último, atalho `"Só os de <professor>"` inclui todo centro em que o professor está em `responsaveis`, e `"Mostrar todos"` grava lista vazia via `set_filtro_visao_v2`.
  - Atualizado `Sino`: três estados (`consultando`, `indisponivel` com `AvisoFalha` e `"Tentar de novo"`, `pronto`), abre `MenuSuspenso`, leva pendências com centro a `#/projeto/<id>/pendencias` e mantém pendências sem centro no menu sem link.
  - Ajustados `Botao` (suporte a `href`/`externo` para "Pasta no Drive"), `Abas.css` (oculta barra de rolagem horizontal no celular) e `BarraTopo.css` (posiciona `MenuSuspenso` dentro da viewport abaixo de 640 px).
- **Telas (`app/src/paginas/Projetos.jsx`, `Projeto.jsx`, `Componentes.jsx`, `App.jsx`)**:
  - **Projetos** (`#/projetos`): cabeçalho com soma apenas de `livre` não nulo, contagem de centros sem número e centros ocultos; chips dinâmicos só para situações presentes; `LinhaDeLista` em ordem alfabética; `"Não foi possível calcular o saldo deste centro"` e `—` quando `erro === 'falha_saldo_livre'`.
  - **Página do projeto** (`#/projeto/<id>[/<aba>]`): `livre` vindo do resumo sem recálculo; painel `"De onde vem este valor"` somando grupos e acusando com `AvisoFalha` se divergir; `Pasta no Drive` visível apenas para `admin` quando há URL; `Bolsas por mês` somando só `bolsas_ativas` com `end_date >= hoje`; `Repasses` calculado com `situacaoDasParcelas` importado de `frontend/js/planejamento-dinheiro.js`; centro sem plano tratado com `—` e `"sem plano"`; abas `Dinheiro` (painel por grupo com rubricas e `compromissos_cobertura`), `Bolsas`, `Documentos` (`balancetes` + `planos` ordenados por data) e `Pendências` (confirmação inline no próprio cartão, sem `window.confirm()`, e vazio `"Nenhuma pendência neste centro."`).
  - **Catálogo** (`app/src/paginas/Componentes.jsx`): 4º destaque trocado para `"Pendências"` na seção da página de referência, mantendo `"Valor digitado (sem documento)"` no cartão de valores.

## Como conferi

### Testes, guarda de estilo, lint e build
- `npm --prefix app test` (via `npm.cmd --prefix app test`): **9 arquivos, 47 testes passando** (`formato`, `roteador`, `manutencao`, `verificar-estilo`, `interacao`, `dados`, `projetos`, `projeto`, `filtro`).
- `npm --prefix app run build` (via `npm.cmd --prefix app run build`): **guarda de estilo sem violações** + build concluído (`dist/assets/index-Cb1cwtwz.js`: `331,65 kB` / `91,65 kB` gzip; `dist/assets/index-Cp7OflmM.css`: `38,83 kB` / `6,47 kB` gzip; `dist/index.html`: `0,98 kB` / `0,55 kB` gzip).
- Conferência no bundle gerado (`Select-String` em `app/dist/assets/*`): **0 ocorrências** de termos de `dadosExemplo.js` (`Bacia do Cerrado`, `Atlas Hídrico`, `Clara Mendes`, `Renato Alves`, `Beatriz Cunha`, `dadosExemplo`).
- `npm run lint` (via `npm.cmd run lint`): **0 erros, 0 avisos** em `frontend/js/`, `mcp/` e `app/`.
- `npm test` na raiz (via `npm.cmd test`): **36 arquivos, 571 testes passando e 5 ignorados (576 no total)**.

### Navegador headless (`npm --prefix app run dev:exemplo`, Chrome via CDP)
- **0 erros de console** e **0 exceções de página**.
- Medidas a **1280×800**:
  - Todas as rotas (`#/projetos`, projetos `30.901`..`30.906`, `#/componentes`) e as 4 abas do projeto `30.901`: `scrollWidth` entre `1265` e `1280` (`estouroX: false`), `destaquesFora: []`, `itensBarraFora: []`.
  - Menus `FiltroVisao` (`734..1054`) e `Sino` (`808..1128`) dentro da viewport (`vazaViewport: false`).
- Medidas a **360×800**:
  - Todas as rotas (`#/projetos`, projetos `30.901`..`30.906`, `#/componentes`) e todas as 4 abas do projeto `30.901`: `scrollWidth = 360`, `innerWidth = 360` (`estouroX: false`), `destaquesFora: []`, `itensBarraFora: []`.
  - Menus `FiltroVisao` e `Sino` abertos: `menuLeft = 16`, `menuRight = 344` (`vazaViewport: false`).
- Estados e interações conferidos ao vivo no Chrome:
  - `#/projetos` exibiu os 6 centros visíveis e os 2 ocultos no contexto (`"6 centros · R$ 119,5 mil livres no total · 3 centros sem número · 2 centros ocultos"`) e as 6 situações (`em dia`, `atenção`, `problema`, `sem balancete`, `sem plano`, `sem dado`).
  - `#/projeto/...30901`: painel `"De onde vem este valor"` sem divergência; painel do grupo `"Pessoal"` com cobertura de bolsas; bolsas vigentes ignorando a bolsa já encerrada.
  - `#/projeto/...30902/pendencias`: abriu direto na aba `Pendências`; confirmação inline exibida ao clicar em `"Resolvida"`.
  - `#/projeto/...30904`, `30905` e `30906`: `—` sem `R$ 0` nos destaques correspondentes a `sem balancete`, `sem plano` e `falha_saldo_livre`.

## Desvios do contrato e pontos em aberto

- **Desvios do contrato**: nenhum. Todos os nomes de RPCs, parâmetros, campos de retorno e regras das correções 1–11 foram seguidos exatamente como especificados.
- **Uso de `npm.cmd` no ambiente Windows PowerShell**: a execução de `npm.ps1` estava bloqueada pela ExecutionPolicy local, então os mesmos comandos de `npm` foram executados via `npm.cmd`.
- **Pendência para fases seguintes**: se um administrador abrir diretamente a URL `#/projeto/<id>` de um centro que esteja oculto no filtro de visão atual, `resumo_projetos_v2()` só traz `livre` dentro de `centros` (não em `todos`), então o destaque principal mostra `—` (`sem dado`) até o centro voltar a ficar visível no filtro. Caso queiram exibir o saldo também ao abrir centro oculto por link direto, seria necessário um endpoint ou campo adicional na F2.

## 2ª rodada

### Correções aplicadas (itens 1–19)
- **Corridas de requisição (`Projeto.jsx`, `App.jsx`)**: cada carga assíncrona (`carregarSaldo`, `carregarRepasses`, `carregarDocumentos`, `carregarPendencias`, `confirmarResolucao`, `carregarResumo`, `carregarSino`) guarda a geração e o `projectId` de origem e descarta respostas atrasadas se o usuário trocou de centro ou se o componente desmontou. Em `App.jsx`, falhas ao recarregar resumo preservam os dados anteriores apenas quando não havia erro; `limpar` sessão incrementa as gerações pendentes.
- **Filtro com dois cliques e sem truncamento (`FiltroVisao.jsx`, `FiltroVisao.css`, `App.jsx`)**: estado otimista `ocultosOtimista` sincronizado com `todos`; trava contra cliques duplos simultâneos com reversão automática em erro; `salvarFiltro` no `App.jsx` libera `filtroSalvando` somente no `finally` após o recarregamento global. Botões e caixas usam `aria-disabled` no lugar de `disabled` para manter o foco estável. Cabeçalho de grupo mostra o nome completo do professor com quebra de linha e botão `"Só estes"` alinhado à direita.
- **Validação de forma e exemplo (`dados.js`)**: `resumoProjetos` exige `Array.isArray(centros)` e `Array.isArray(todos)`; `saldoLivre` exige `has_plano` e `has_balancete` booleanos; `repasses` exige `Array.isArray(parcelas)`; `filtroVisao`/`salvarFiltroVisao` exigem `Array.isArray(centros_ocultos)`; `resolverPendencia` exige `id` e `situacao`. Falha no `import('./dadosExemplo.js')` limpa o cache da promessa e retorna `{ dados: null, erro }`.
- **Somas sem nulo→zero, bolsa sem data e recursos (`Projeto.jsx`, `Projeto.css`)**: número não finito em `bolsasVigentes` ou em `grupos[].saldo_livre` resulta em `—` com motivo explícito e `AvisoFalha` no painel (nunca vira zero). Bolsas sem `end_date` válido vão para a seção separada `"Bolsas sem data de término"` com `AvisoFalha` (sem contar como encerradas). Em `repasses`, `recursos` só é repassado a `situacaoDasParcelas` quando `recebido` é número finito; caso contrário mostra `—` e `"sem dados de recurso"`.
- **Avisos da RPC e vigência (`Projeto.jsx`)**: `saldo_livre.avisos` renderizado em `AvisoFalha` no topo da aba `Dinheiro`, sem duplicar avisos no frontend; quando `mesesRestantes` retorna `null`, o trecho `"faltam N meses"` é omitido.
- **Prioridade de repasses e aba Bolsas (`Projeto.jsx`)**: situações que exigem conferência (`atrasada`, `parcial`, `nota_emitida`, `confirmar`, `sem_data`) têm prioridade sobre `"próximo em …"`. Aba `Bolsas` lista todas as bolsas de `bolsas_ativas`, marcando as anteriores a hoje com `"encerrada em mm/aa"`, mantendo o filtro `end_date >= hoje` apenas no destaque `"Bolsas por mês"` e na contagem `"N bolsistas ativos"`.
- **Documentos, centro oculto e lista (`Projeto.jsx`, `Projetos.jsx`, `App.jsx`, `roteador.js`)**:
  - `Documentos`: erro em qualquer das duas consultas define contagem `"—"` e exibe `AvisoFalha`, exibindo `"Nenhum documento registrado neste centro."` somente quando ambas respondem vazias sem erro.
  - Centro oculto aberto por link (ou ocultado com a página aberta) exibe `Vazio` `"Este centro está oculto pelo seu filtro de visão."` com o botão `"Mostrar este centro"`, sem chamar `saldoLivre` nem mostrar `"sem dado"`.
  - Linha de contexto de `Projetos` soma o total real (`centros.length + ocultos`, ex.: `"8 centros · R$ 119,5 mil livres no total · 3 centros sem número · 2 centros ocultos"`), mantém lista e contexto visíveis durante recarregamentos (sem piscar esqueleto) e mostra `AvisoFalha` junto ao `Vazio` se `"Mostrar todos"` falhar.
  - Helper `ehCliqueNavegacaoSimples` em `roteador.js` aplicado a todos os links SPA (`BarraTopo`, `Sino`, `Projetos`, `Projeto`) para preservar abertura em nova aba via ctrl/cmd/shift/clique do meio.
- **Desvio aceito da `estetica.md` §5**: os chips `"Sem plano"` e `"Sem dado"` na página `Projetos` foram mantidos (exibidos apenas quando há centros nessa situação).
- **Verificação automática de build (`app/scripts/verificar-build.mjs`)**: adicionado script conectado ao `npm --prefix app run build` e `"verificar-build"`, reprovando caso algum marcador de `dadosExemplo.js` apareça em `app/dist`.

### Conferência da 2ª rodada
- `npm --prefix app test`: **9 arquivos, 54 testes passando**.
- `npm --prefix app run build` (`verificar-estilo` + `vite build` + `verificar-build`): **0 violações de estilo**, **0 dados de exemplo no bundle**, `dist/assets/index-Da_Nrp7a.js` (`337,53 kB` / `93,38 kB` gzip), `dist/assets/index-CuXT3UYB.css` (`39,03 kB` / `6,51 kB` gzip).
- `npm run lint`: **0 erros, 0 avisos**.
- `npm test` (raiz): **36 arquivos, 571 testes passando e 5 ignorados (576 no total)**.
- **Chrome headless** (`npm --prefix app run dev:exemplo`, **1280×800** e **360×800**): **0 erros de console**, **0 exceções de página**, **0 estouros horizontais** em todas as 10 rotas (incluindo `#/projeto/...30907` oculto e `#/componentes`) e nas 4 abas do `30.901` (`scrollWidth = 360` a 360 px); cabeçalho do `FiltroVisao` com nome completo + `"Só estes"` dentro da viewport (`16..344` a 360 px; `734..1054` a 1280 px); aba `Bolsas4` exibindo todas as 4 bolsas inclusive `"encerrada em out/26"`; aba `Dinheiro` do `30.902` exibindo o aviso da RPC.

