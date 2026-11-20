# Admin mínimo — 2ª rodada (revisões MiniMax max e DeepSeek max de 7c34031, conferidas pelo Claude, 20/11)

Mesmo worktree e branch. Seção "2ª rodada" no relatório `docs/redesenho/relatorios/admin-minimo.md`, **commit novo**.
Sem push. Não chame outras IAs. Mesmas listas de arquivos da 1ª rodada. Não versione `PEDIDO-rev-admin.txt` (apague-o).
Cada correção ganha um teste que **falha sem ela**.

## Serviço (`dados.js`)

1. **Centro sem código derruba a tela** (alto). `projects.code` pode ser nulo (o banco aceita; centros antigos nasceram
   assim). Em `validarCentroAcesso`, `code` é opcional (`string` ou `null`); no mapa, `code: typeof c.code === 'string' ?
   c.code.trim() : ''`. Na tela, onde aparece o código use `code || 'sem código'` (lista "O que vê", painel, resumo,
   confirmação). Nunca mostre o uuid. `name` segue obrigatório (é `not null` no banco). Teste com `code: null` e `'  '`.
2. `PAPEIS_EDITAVEIS` só `admin` e `professor` (a RPC aceitaria transformar alguém em `agente`, que é a IA).
3. Erro de gravação: passe pela mesma tradução que as outras RPCs usam (`mensagemDaRpc` ou equivalente), mantendo
   "Sem permissão" para 42501; nada de mensagem crua de constraint/FK na tela.
4. Testes de falha separados para cada uma das três leituras (`app_users`, `user_projects`, `projects`).

## Tela (`Admin.jsx`)

5. **Rebaixar admin para professor sem confirmação** (médio). Admin → Professor é perda de acesso: entra no segundo passo
   mesmo sem centro removido, e o resumo diz "Deixa de ver: todos os centros" e, se a lista marcada estiver vazia,
   "Passa a ver: nenhum centro". O exemplo ganha um segundo admin (não o usuário logado) para isso aparecer na tela.
6. **"Marcar todos"/"Limpar" mexem em encerrados escondidos** (médio). Agem só nos centros **visíveis**: os ativos que a
   busca mostra e os encerrados só se o grupo "Encerrados" estiver aberto (controle o `open` do `<details>` por estado).
   Teste: professor com um centro encerrado marcado + "Limpar" com o grupo fechado mantém o encerrado; a lista enviada
   ao salvar inclui o encerrado (fixture com `c-inativo` atribuído).
7. **Reabrir durante a recarga** (médio). Enquanto `salvando` ou a recarga depois de salvar estiverem em curso, os botões
   "Editar" ficam desabilitados; ao abrir o painel, use sempre o usuário de `dados.usuarios` atual. Teste com a 2ª
   chamada de `acessosUsuarios()` atrasada (promessa controlada).
8. **Recarga que falha apaga a lista** (baixo). Se a recarga falhar e já havia dados, mantenha a lista anterior e mostre
   o `AvisoFalha` acima dela ("Os acessos foram salvos, mas a lista não recarregou." + Tentar de novo). Sinalize a
   recarga em curso (texto discreto "Atualizando…"). O aviso "Acessos de X salvos" some ao abrir outro painel.
9. **Foco na confirmação** (médio, acessibilidade): ao entrar no segundo passo, foco em "Confirmar e salvar"; ao
   cancelar, foco de volta em "Salvar"; o bloco com `role="alert"`.
10. Guarda do próprio admin falha fechada: sem `usuarioId`, nenhum admin pode ser rebaixado pela tela. Registre no
    relatório que a guarda é só de tela (a RPC aceitaria).
11. `carregar()` no `useEffect` com `.catch` que vira erro na tela; tire a prop morta `onNavegar` do `App.jsx` (ou use-a).

## Relatório

12. Registre como **aberto** (não corrigir agora): a lista gravada é o retrato de quando o painel abriu (dois admins ao
    mesmo tempo podem se sobrescrever; hoje há um admin só); clicar na linha não abre o painel (só "Editar"); medidas
    `rem` literais no CSS seguem a prática do `Bolsistas.css`, mas `estetica.md` pede tokens — corrija a frase do
    relatório que diz não haver medida literal.

`npx vitest run` (raiz), `npm test --prefix app`, `npm run lint`, `npm run build --prefix app`: verdes.
