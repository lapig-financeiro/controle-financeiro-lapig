# Relatório — Admin mínimo (`#/admin` em `/v2/`)

Branch: `redesenho/admin-minimo` (a partir do `master` `4b32a5e`, worktree `C:/Users/amara/dev/cf-admin`).
Nenhuma outra IA foi chamada, nenhuma migração foi criada ou tocada, nenhum dado real foi usado e não houve `push`.

## 1. O que foi feito

| Arquivo | Mudança |
|---|---|
| `app/src/servicos/dados.js` | Adicionados `validarAcessosUsuarios`, `acessosUsuarios()` (leituras paralelas de `app_users`, `user_projects` e `projects`; falha em qualquer uma devolve erro explícito; `nome` usa `display_name` ou a parte antes do `@`) e `salvarAcessos(userId, role, projectIds)` (chama `save_user_assignments`, traduz `42501` para `"Sem permissão"` e devolve a mensagem do banco nos demais erros). |
| `app/src/servicos/dadosExemplo.js` | Adicionados `acessosUsuarios()` e `salvarAcessos()` em memória com 6 logins sintéticos (`*@example.org`: 1 admin `exemplo-admin`, 3 professores sendo 1 sem centro, 1 `agente` "Buriti" e 1 `automacao`) e os centros fictícios do exemplo mais 1 centro sintético inativo (`30.900 — Projeto Piloto Encerrado`), sem alterar `CENTROS_BASE` nem `resumoProjetos()`. |
| `app/src/paginas/Admin.jsx` | Tela `#/admin` com `CabecalhoPagina` ("Admin" / "Quem vê qual centro de custo"), nota discreta de cadastro via Supabase, `Tabela` ordenada (professores sem centro, professores, admins, `agente`, `automacao`), busca de logins acima de 8 entradas, `agente`/`automacao` somente leitura ("Muda só pelo banco, de propósito"), `PainelLateral` para editar papel e centros (ativos primeiro, `Encerrados` fechado por padrão, busca por código/nome, `Marcar todos`/`Limpar` atuando só nos visíveis pela busca, contador, bloqueio para o próprio admin deixar de ser admin com `"Peça a outro administrador"`, nota ao escolher `Admin`, resumo de mudanças, botão `Salvar` desabilitado sem mudança, confirmação em dois passos ao remover centros, erro preservando marcações e recarga por `acessosUsuarios()` no sucesso), além de `AvisoFalha` com `"Tentar de novo"` em falha de leitura. |
| `app/src/paginas/Admin.css` | Estilos da tela e do painel usando apenas tokens de `tokens.css` (sem `style=` inline, sem cores ou medidas literais fora de `tokens.css`). |
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
