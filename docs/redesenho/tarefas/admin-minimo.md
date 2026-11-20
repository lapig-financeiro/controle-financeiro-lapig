# Admin mínimo — tela de acessos do `/v2/` (20/11, pedido do Victor)

Worktree `C:/Users/amara/dev/cf-admin`, branch `redesenho/admin-minimo` (já criada a partir do `master` 4b32a5e,
`node_modules` já instalados na raiz e em `app/`). Relatório em `docs/redesenho/relatorios/admin-minimo.md`, **um commit
no fim** (conventional commit, `feat(redesenho): ...`). **Sem push.** **Não chame outras IAs.** Nenhum dado real (nome de
pessoa, e-mail real, CPF, código de centro real) em teste, fixture ou modo exemplo.

Leia antes, inteiros: `docs/redesenho/README.md` (§2 item 4 e §4), `docs/redesenho/estetica.md` (tokens, componentes,
proibições: nada de `style=` inline, hex fora de `tokens.css`, fonte fora da escala — há teste que reprova),
`app/src/App.jsx`, `app/src/servicos/dados.js` (molde `filtroVisao`/`salvarFiltroVisao`, `chamarRpc`, modo exemplo),
`app/src/paginas/Bolsistas.jsx` (tela mais recente: estados de carga, erro, gravação) e `frontend/js/pages/usuarios.js`
(a tela antiga que faz a mesma coisa: é a referência de regras, não de visual).

## Por quê

Hoje, para dar acesso a alguém (ex.: a professora que começou a usar o `/v2/` em 20/11), o Claude grava pelo banco. O
Victor quer fazer isso sozinho pelo site novo. "Admin mínimo" = **quem vê qual centro de custo**. O filtro da própria
visão já existe (botão na barra do topo, `FiltroVisao.jsx`); não refaça.

## Banco: nada muda

Sem migração. Use só o que existe (o RLS deixa o admin ler; a tela antiga faz igual):

- Leitura, em paralelo:
  - `supabase.from('app_users').select('user_id, role, display_name, email, created_at')`
  - `supabase.from('user_projects').select('user_id, project_id')`
  - `supabase.from('projects').select('id, code, name, active').order('code')`
- Gravação: `supabase.rpc('save_user_assignments', { p_user_id, p_role, p_project_ids })` (devolve `void`; só admin;
  aceita papel `admin`, `professor`, `agente`; **substitui** a lista de centros inteira; recusa tirar alguém do papel
  `agente` com 42501).
- Papéis existentes: `admin`, `professor`, `agente` (o Buriti, IA) e `automacao` (login de robô, mig. 054).
- Login novo: o Victor cria no Supabase (Authentication → Users); um gatilho já cria a linha em `app_users` como
  `professor` **sem nenhum centro**. A tela não cria nem apaga login.

## App (`app/`)

### Arquivos que pode mexer
`app/src/paginas/Admin.jsx` e `Admin.css` (novos), `app/src/App.jsx` (só trocar o `EmConstrucao` da rota `admin` pela
página nova e passar o que ela precisar: id do usuário logado, `onNavegar`), `app/src/servicos/dados.js`,
`app/src/servicos/dadosExemplo.js`, `app/tests/admin.test.jsx` (novo) e o relatório. Precisou de outro? Pare e
registre no relatório. Se um componente de `componentes/` precisar de uma prop nova, descreva no relatório e prefira
compor sem mexer nele.

### Serviços (`dados.js` + `dadosExemplo.js`)
1. `acessosUsuarios()` → `{ dados: { usuarios: [{ user_id, nome, email, role, criado_em, centros: [project_id] }],
   centros: [{ id, code, name, active }] }, erro }`. As três leituras em paralelo; **qualquer uma falhar = erro** (nunca
   lista vazia como se não houvesse ninguém). Validador do payload no molde dos outros. `nome` = `display_name` ou a
   parte do e-mail antes do `@`.
2. `salvarAcessos(userId, role, projectIds)` → chama a RPC; erro devolve a mensagem do banco traduzida para algo
   legível ("Sem permissão" para 42501, a mensagem do banco no resto). Depois de gravar, a tela **recarrega** por
   `acessosUsuarios()` (não remenda o estado local).
3. Modo exemplo: uns 6 logins sintéticos (`ana.exemplo@example.org` etc.): 1 admin (o próprio usuário do exemplo), 3
   professores (um sem nenhum centro, como um login recém-criado), 1 `agente` ("Buriti") e 1 `automacao`; usa os
   centros fictícios que o modo exemplo já tem, mais 1 inativo. Gravar no exemplo altera a memória do módulo.

### Tela `#/admin` (só admin; a rota já barra os outros)
- `CabecalhoPagina`: título "Admin"; subtítulo "Quem vê qual centro de custo".
- Uma nota curta (discreta, sem caixa de destaque): "Para dar acesso a alguém novo: crie o login no Supabase
  (Authentication → Users). Ele aparece aqui como professor, sem nenhum centro; marque os centros e salve."
- **Lista de logins** (`LinhaDeLista`/`Tabela`, no visual das outras telas): nome, e-mail, papel (Admin, Professor,
  "Buriti (IA)" para `agente`, "Automação" para `automacao`) e o que vê: "todos os centros" (admin), "N centros" com os
  códigos (professor; até 4 códigos e "+N"), "nenhum centro" em destaque de atenção (professor sem centro). Ordem:
  professores sem centro primeiro, depois professores, admins, e por último agente/automação. Busca por nome ou e-mail
  quando houver mais de 8 logins.
- `agente` e `automacao`: só leitura, sem botão de editar, com a frase "Muda só pelo banco, de propósito".
- **Editar** (professor e admin): abre `PainelLateral` com:
  - Papel: seletor Professor / Admin. **O próprio usuário logado não pode deixar de ser admin** (opção desabilitada e
    frase "Peça a outro administrador"). Ao escolher Admin: "Admin vê todos os centros; a lista abaixo fica guardada
    caso ele volte a professor."
  - Centros: caixas de marcar, uma por centro (`código — nome`), ativos primeiro; inativos num grupo "Encerrados"
    fechado por padrão. Busca por código ou nome; "Marcar todos" / "Limpar" (agem só nos que a busca mostra);
    contador "N centros marcados".
  - Antes de salvar, um resumo da mudança: "Passa a ver: 30.9xx, …" / "Deixa de ver: …" / "Papel: Professor → Admin".
    Sem mudança, o botão Salvar fica desabilitado. Se a mudança tira centros, o Salvar pede confirmação em dois passos
    (como o "Tirar quem saiu da lista" da tela Bolsistas), sem `window.confirm`.
  - Gravando: botões desabilitados; erro mostra a mensagem no painel e **mantém** o que estava marcado; sucesso fecha o
    painel, recarrega a lista e mostra um aviso curto "Acessos de <nome> salvos".
- Falha ao carregar: `AvisoFalha` com "Tentar de novo"; nunca lista vazia nem "0 centros" (regra do projeto).
- Tela estreita (390 px): lista empilhada, painel ocupa a largura; nada de rolagem horizontal da página.

### Testes (`app/tests/admin.test.jsx`)
Lista e ordem (sem centro primeiro); rótulos de papel; agente/automação sem botão de editar; o próprio admin não pode
virar professor; salvar chama `salvarAcessos` com o id, o papel e **a lista completa** de ids marcados; resumo
"passa a ver/deixa de ver"; tirar centro pede o segundo passo; Salvar desabilitado sem mudança; erro de gravação
mantém as marcações e mostra a mensagem; falha de leitura mostra `AvisoFalha` e não "nenhum centro"; validador
recusa payload sem `usuarios`/`centros`; modo exemplo sem `@` fora de `example.org`.

## Verificação (tudo verde antes do commit)
`npx vitest run` (raiz), `npm test --prefix app`, `npm run lint`, `npm run build --prefix app`. Se puder, abra
`npm run dev:exemplo --prefix app` e confira `#/admin` em 1400 px e 390 px; descreva no relatório o que viu (ou diga
que não conseguiu abrir). Relatório: o que fez, testes, o que ficou em aberto, desvios desta tarefa.
