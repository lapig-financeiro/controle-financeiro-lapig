# Relatório — Admin mínimo (`#/admin` em `/v2/`)

Branch: `redesenho/admin-minimo` (a partir do `master` `4b32a5e`, worktree `C:/Users/amara/dev/cf-admin`).
Nenhuma outra IA foi chamada, nenhuma migração foi criada ou tocada, nenhum dado real foi usado e não houve `push`.

## 1. O que foi feito

| Arquivo | Mudança |
|---|---|
| `app/src/servicos/dados.js` | Adicionados `validarAcessosUsuarios`, `acessosUsuarios()` (leituras paralelas de `app_users`, `user_projects` e `projects`; falha em qualquer uma devolve erro explícito; `nome` usa `display_name` ou a parte antes do `@`) e `salvarAcessos(userId, role, projectIds)` (chama `save_user_assignments`, traduz `42501` para `"Sem permissão"` e devolve a mensagem do banco nos demais erros). |
| `app/src/servicos/dadosExemplo.js` | Adicionados `acessosUsuarios()` e `salvarAcessos()` em memória com 6 logins sintéticos (`*@example.org`: 1 admin `exemplo-admin`, 3 professores sendo 1 sem centro, 1 `agente` "Buriti" e 1 `automacao`) e os centros fictícios do exemplo mais 1 centro sintético inativo (`30.900 — Projeto Piloto Encerrado`), sem alterar `CENTROS_BASE` nem `resumoProjetos()`. |
| `app/src/paginas/Admin.jsx` | Tela `#/admin` com `CabecalhoPagina` ("Admin" / "Quem vê qual centro de custo"), nota discreta de cadastro via Supabase, `Tabela` ordenada (professores sem centro, professores, admins, `agente`, `automacao`), busca de logins acima de 8 entradas, `agente`/`automacao` somente leitura ("Muda só pelo banco, de propósito"), `PainelLateral` para editar papel e centros (ativos primeiro, `Encerrados` fechado por padrão, busca por código/nome, `Marcar todos`/`Limpar` atuando só nos visíveis pela busca, contador, bloqueio para o próprio admin deixar de ser admin com `"Peça a outro administrador"`, nota ao escolher `Admin`, resumo de mudanças, botão `Salvar` desabilitado sem mudança, confirmação em dois passos ao remover centros, erro preservando marcações e recarga por `acessosUsuarios()` no sucesso), além de `AvisoFalha` com `"Tentar de novo"` em falha de leitura. |
| `app/src/paginas/Admin.css` | Estilos da tela e do painel usando tokens de `tokens.css` e medidas `rem` literais pontuais (`24rem`, `22rem`, `1.125rem`) no molde de `Bolsistas.css` (sem `style=` inline, sem cores literais e sem medidas `px`/`ms`/`vh` fora de `tokens.css`). |
| `app/src/App.jsx` | Rota `admin` trocada de `EmConstrucao` para `<Admin usuarioId={usuario?.id || null} onNavegar={navegarPara} />`. |
| `app/tests/admin.test.jsx` | 10 testes cobrindo ordem, rótulos, busca >8, bloqueio de `agente`/`automacao`, regra do próprio admin, `Encerrados` fechado, `Marcar todos`/`Limpar` sobre busca, resumo, confirmação em 2 passos ao tirar centro, envio da lista completa de IDs, erro de gravação mantendo marcações, falha de leitura sem "nenhum centro"/"0 centros", validador/serviços e modo exemplo sem `@` fora de `example.org`. |
| `docs/redesenho/tarefas/admin-minimo.md` | Arquivo de definição da tarefa, incluído no commit deste worktree. |

## 2. Desvios e composição de componentes

- **Composição do seletor de papel sem alterar `componentes/Seletor.jsx`**: o componente `Seletor.jsx` não possui suporte para `disabled` em uma `<option>` específica (`Professor` precisa ficar desabilitada quando o próprio admin edita seu usuário, mantendo `Admin` e o `<select>` legíveis). Para não editar arquivos de `componentes/`, `Admin.jsx` compôs o `<select>` nativo diretamente com as classes existentes `.seletor`, `.seletor__rotulo`, `.seletor__controle`, `.seletor__entrada`, `.seletor__seta` e `.seletor__ajuda`, acompanhado do ícone `ChevronDown`.
- **Execução no Windows PowerShell**: `npm.ps1`/`npx.ps1` são bloqueados pela política de execução local; os comandos foram rodados via `npm.cmd` e `npx.cmd`.

## 3. Verificação

Todos os comandos abaixo foram executados após a última edição de código (`app/src/paginas/Admin.css`):

| Verificação | Resultado |
|---|---|
| `npx.cmd vitest run` (raiz) | **43 arquivos passaram, 1 pulado (44)** — 685 testes passaram, 19 pulados (704) |
| `npm.cmd test --prefix app` | **22 arquivos passaram (22)** — 183 testes passaram (183), sendo 10 em `tests/admin.test.jsx` |
| `npm.cmd run lint` | **limpo** (0 erros, 0 avisos) |
| `npm.cmd run build --prefix app` | **verde**: `Guarda de estilo: nenhuma violação encontrada`, build Vite concluído e `Verificação de build: nenhum dado de exemplo no bundle de produção` |

### Conferência na tela (`vite --mode exemplo`)

Rodado servidor `vite --mode exemplo` (`http://127.0.0.1:5198/controle-financeiro-lapig/v2/#/admin`) e inspecionado via Chrome headless (CDP) em **1400 × 900** e **390 × 844**:

- **1400 × 900**: sem rolagem horizontal (`scrollWidth: 1400`, `innerWidth: 1400`), cabeçalho `"Admin"` / `"Quem vê qual centro de custo"`, nota discreta acima da tabela, 6 linhas na ordem esperada (Bruno Exemplo com `"nenhum centro"` em âmbar no topo; Prof. Renato Alves com `"5 centros · 30.902, 30.903, 30.904, 30.908 +1"`; Profa. Clara Mendes; Ana Exemplo com `"todos os centros"`; Buriti com `"Buriti (IA)"` e Robô de Ingestão com `"Automação"`, ambos sem botão Editar e com `"Muda só pelo banco, de propósito"`). Ao editar Bruno Exemplo, o `PainelLateral` abre com `480 px` de largura, `"Salvar"` desabilitado, `"0 centros marcados"` e `"Encerrados (1)"` fechado por padrão.
- **390 × 844**: linhas empilhadas em cartões (`display: flex; flex-direction: column`), sem rolagem horizontal (`scrollWidth: 390`, `innerWidth: 390`), rótulo `"O que vê"` em linha única após ajuste em `Admin.css`, e o painel lateral ocupa os `390 px` inteiros de largura.

## 4. O que ficou em aberto

- **Conferência com banco real**: o fluxo completo (leitura de `app_users`, `user_projects`, `projects` e gravação via RPC `save_user_assignments`) foi testado com mocks em `admin.test.jsx` e no modo exemplo; falta conferir com sessão real de admin em `/v2/#/admin` após publicação/merge.
- **Barra do topo em 390 px (`BarraTopo.css`, fora do escopo desta tarefa)**: na captura em 390 px, o chip do filtro de visão encosta/sobrepõe o final do item `"Admin"` na barra do topo por causa da largura acumulada dos 4 itens de navegação (`Projetos`, `Bolsistas`, `Análise`, `Admin`). Não foi alterado por estar fora da lista de arquivos desta tarefa.

## 2ª rodada

Correções das revisões cegas/contextuais (MiniMax max e DeepSeek max) conferidas pelo Claude em 20/11:

### O que mudou

| Arquivo | Mudança |
|---|---|
| `app/src/servicos/dados.js` | `validarCentroAcesso` passou a aceitar `code` nulo ou ausente (`string`, `null` ou `undefined`) e `acessosUsuarios()` normaliza para `''`; `PAPEIS_EDITAVEIS` restrito a `['admin', 'professor']` (recusa `agente`); `salvarAcessos()` mantém `"Sem permissão"` para `42501` e passa os demais erros por `mensagemDaRpc` (com `P0001`, `22023`, `P0002`), filtrando mensagens cruas de constraint/FK/ACL (`violates`, `foreign key`, `insert or update`, `duplicate key`, etc.). |
| `app/src/servicos/dadosExemplo.js` | Adicionado segundo admin (`exemplo-admin-2` — Carlos Exemplo) para permitir testar rebaixamento `Admin → Professor` no exemplo; `salvarAcessos()` no exemplo também recusa converter para `agente`. |
| `app/src/paginas/Admin.jsx` | (a) `codigoCentro()` exibe `'sem código'` quando `code` é vazio/nulo ou quando um centro não está no mapa (nunca mostra UUID) na lista, painel, resumo e confirmação; (b) rebaixar `Admin → Professor` mostra `"Deixa de ver: todos os centros"` e `"Passa a ver: nenhum centro"` (se lista vazia) e exige confirmação em dois passos mesmo sem remoção de checkbox; (c) `<details>` de `"Encerrados"` controlado por estado `encerradosAberto`, e `"Marcar todos"`/`"Limpar"` agem só nos centros visíveis (encerrados só entram quando abertos); (d) botões `"Editar"` ficam desabilitados durante `salvando || st.carregando` e `abrirPainel()` lê sempre de `st.dados.usuarios` atual; (e) falha na recarga mantém os dados anteriores na tela com `AvisoFalha` (`"Os acessos foram salvos, mas a lista não recarregou."` + `"Tentar de novo"`), exibe `"Atualizando…"` durante a recarga e limpa `"Acessos de <nome> salvos"` ao abrir outro painel; (f) bloco de confirmação ganhou `role="alert"`, foco automático em `"Confirmar e salvar"` e devolução de foco para `"Salvar"` ao cancelar; (g) guarda de próprio admin falha fechada quando `usuarioId` está ausente; (h) `carregar()` no `useEffect` protegido com `.catch`. |
| `app/src/paginas/Admin.css` | Adicionada classe `.admin__atualizando` para o indicador de recarga em curso. |
| `app/src/App.jsx` | Removida a prop morta `onNavegar` de `<Admin usuarioId={usuario?.id || null} />`. |
| `app/tests/admin.test.jsx` | 7 testes novos (17 no total no arquivo), cobrindo centro sem código (`null`/`'  '`), recusa de `agente`, tradução de erros crus de FK/constraint, falhas separadas das 3 leituras (`app_users`, `user_projects`, `projects`), confirmação ao rebaixar admin, `"Limpar"` com `"Encerrados"` fechado/aberto, bloqueio de `"Editar"` e `"Atualizando…"` durante recarga controlada, falha de recarga preservando a lista, foco + `role="alert"` na confirmação e guarda falha-fechada sem `usuarioId`. |
| `docs/redesenho/tarefas/admin-minimo-rodada2.md` | Arquivo da 2ª rodada incluído no commit; `PEDIDO-rev-admin.txt` removido sem versionar. |

### Verificação final (2ª rodada)

| Verificação | Resultado |
|---|---|
| `npx.cmd vitest run` (raiz) | **43 arquivos passaram, 1 pulado (44)** — 685 testes passaram, 19 pulados (704) |
| `npm.cmd test --prefix app` | **22 arquivos passaram (22)** — 190 testes passaram (190), sendo 17 em `tests/admin.test.jsx` |
| `npm.cmd run lint` | **limpo** (0 erros, 0 avisos) |
| `npm.cmd run build --prefix app` | **verde**: `Guarda de estilo: nenhuma violação encontrada`, build Vite concluído e `Verificação de build: nenhum dado de exemplo no bundle de produção` |
| `vite --mode exemplo` (CDP, `#/admin`) | **1400 × 900** e **390 × 844** conferidos sem rolagem horizontal; 7 logins incluindo o segundo admin (`Carlos Exemplo`), painel com `480 px` (1400) e `390 px` (390). |

### Em aberto após a 2ª rodada

- **Concorrência de edição**: a lista gravada corresponde ao retrato carregado quando o painel abriu; dois administradores editando o mesmo usuário ao mesmo tempo podem sobrescrever a lista (hoje há apenas um administrador operando).
- **Clique na linha**: clicar na linha da tabela não abre o painel lateral; a abertura continua pelo botão `"Editar"`.
- **Medidas `rem` literais em `Admin.css`**: segue a prática de `Bolsistas.css` e passa na guarda de estilo, embora `estetica.md` peça tokens para medidas.
- **Guarda apenas de tela**: impedir que um admin rebaixe a si mesmo (inclusive em falha fechada quando `usuarioId` não é informado) é proteção de interface; a RPC `save_user_assignments` aceitaria o rebaixamento.
- **Produção e barra do topo em 390 px**: conferência com sessão real de admin após merge/publicação e ajuste responsivo de `BarraTopo.css` (fora do escopo).
