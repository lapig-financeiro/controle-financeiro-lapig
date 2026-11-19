# F3-B — migração 068 e tela "Bolsistas": montar pedido de bolsas (19/11, pedido do Victor, urgente)

Worktree `C:/Users/amara/dev/cf-f3-b`, branch nova `redesenho/f3-b-pedido` a partir do `master` (já criada). Relatório
em `docs/redesenho/relatorios/F3-B.md`, commit novo. Sem push, sem aplicar, sem `CF_*` reais. Leia antes o `CLAUDE.md`
(regras do cofre e de migração), `docs/migracoes.md` (linhas 063 a 067), `database/067_termos_contrato.sql` (molde
mais recente: tabela sem policy e sem grant, leitura e escrita só por RPC definer, helper definer de CPF com
`_tem_cpf`, gatilho do agente, asserções) e `docs/redesenho/tarefas/F3-A-rodada4.md` (o que as revisões cobraram na
067 — não repita esses erros).

## Por quê (palavras do Victor)

Uma pessoa da equipe vai montar o pedido de bolsas da renovação de um contrato. Ela quer "olhar todos os bolsistas dos
projetos do professor e ver quem se encaixa nesse projeto para pedir a bolsa por lá". Não quer contar "ninguém do
[centro X], pois é um projeto que não se sobrepõe", nem quem é das equipes de Alertas e de Solos, "pois eles têm que se
resolver". Ela quer "montar o time Pastagem", "precisa desses filtros e de ter como colocar essas pessoas numa caixa ou
duas". O login dela será professor, com os centros do professor; o RLS/escopo já filtra o que ela vê.

## Banco: `database/068_pedido_bolsas.sql`

Nada muda em bolsas, saldo, `get_saldo_livre`, `explicar_livre_v2`, `resumo_projetos_v2`. A migração não insere dados.

1. **`public.bolsista_equipes`** (uma equipe por pessoa, compartilhada entre quem enxerga a pessoa):
   `holder_id uuid primary key references scholarship_holders(id) on delete cascade`, `equipe text not null check in
   ('pastagem', 'alertas', 'solos')`, `atualizado_em timestamptz not null default now()`, `atualizado_por uuid default
   auth.uid()`. Sem linha = "sem equipe".
2. **`public.caixas_pedido`** (as caixas de quem monta o pedido): `id uuid pk default gen_random_uuid()`, `nome text
   not null` (1 a 80, trim), `meses int not null default 12 check between 1 and 60`, `dono uuid not null default
   auth.uid()`, `criado_em`, `atualizado_em timestamptz not null default now()`.
3. **`public.caixa_pedido_itens`**: `caixa_id uuid references caixas_pedido(id) on delete cascade`, `holder_id uuid
   references scholarship_holders(id) on delete cascade`, `valor_mensal numeric(14,2)` (null = usar o valor atual;
   > 0 e finito quando preenchido), `nota text` (até 300), `criado_em`; `primary key (caixa_id, holder_id)`.
4. As três: RLS ligado, **nenhuma policy**, `revoke all ... from public, anon, authenticated` (como a 067 final),
   `trg_bloqueia_agente` BEFORE INSERT OR UPDATE OR DELETE FOR EACH STATEMENT sem WHEN. CPF: helper definer próprio
   chamando `public._tem_cpf` sobre `caixas_pedido.nome` e `caixa_pedido_itens.nota` (gatilho por linha, molde
   `_pendencias_sem_cpf`/067), e a mesma checagem dentro das RPCs.
5. **Visibilidade de uma pessoa** (helper definer interno, sem EXECUTE para `authenticated`): admin vê todas; os
   outros veem a pessoa que tem pelo menos uma bolsa `status <> 'cancelled'` em `allowed_project_ids()`. Nunca devolva
   bolsa de centro fora do escopo, nem para dizer que existe.

### RPCs (todas `security definer`, `set search_path = public, pg_temp`, `revoke ... from public, anon`, `grant execute ... to authenticated`)

Guarda comum: usuário autenticado, com linha em `app_users`, `not is_agente()` (o agente não lê nem grava aqui).

- **`get_pedido_bolsas_v2() returns jsonb`**:
  - `centros`: `[{ id, code, name }]` dos centros com bolsa listada, ordem por `code`.
  - `bolsistas`: pessoas visíveis com bolsa `status <> 'cancelled'` e `end_date >= current_date - 180`, cada uma com
    `{ holder_id, nome, equipe (null = sem equipe), valor_vigente (soma de `amount` das bolsas do escopo vigentes hoje:
    `start_date <= current_date <= end_date` e status `active` ou `ended`, regra da 048), bolsas: [{ scholarship_id,
    project_id, code, valor, inicio, fim, status, vigente_hoje }] }`. Só bolsas do escopo. Ordem por nome.
  - `caixas`: as do usuário (admin: as dele; não liste as de outros nesta rodada), `[{ id, nome, meses, criado_em,
    pessoas, total_mensal, total_periodo, itens: [{ holder_id, valor_mensal, valor_usado, nota }] }]`, onde
    `valor_usado = coalesce(valor_mensal, valor_vigente)`, `total_mensal = soma de valor_usado`,
    `total_periodo = total_mensal * meses`. Item de pessoa que deixou de ser visível sai da lista e da soma (e conte
    quantos saíram em `itens_ocultos`). As contas ficam aqui; o app só mostra.
- **`salvar_equipe_bolsista_v2(p_holder_id uuid, p_equipe text) returns jsonb`**: pessoa visível; `p_equipe` null ou
  `''` apaga; valor fora da lista → 22023. Devolve `{ holder_id, equipe }`.
- **`salvar_caixa_pedido_v2(p jsonb) returns jsonb`**: chaves permitidas `id`, `nome`, `meses` (outras → 22023). Sem
  `id` cria (no máximo 10 caixas por dono); com `id` só o dono altera. Devolve a caixa.
- **`apagar_caixa_pedido_v2(p_id uuid) returns jsonb`**: só o dono.
- **`colocar_na_caixa_v2(p_caixa_id uuid, p_holder_id uuid, p_valor_mensal numeric default null, p_nota text default
  null) returns jsonb`**: só o dono da caixa; pessoa visível; upsert do item. **Tira a pessoa das outras caixas do mesmo
  dono** (uma pessoa fica numa caixa só) e devolve de quais saiu.
- **`tirar_da_caixa_v2(p_caixa_id uuid, p_holder_id uuid) returns jsonb`**: só o dono.

Erros: sem permissão → `42501`; parâmetro inválido → `22023`; não encontrado → `P0002`. Nada de mensagem com nome de
pessoa de outro escopo.

### Asserções e teste

- Asserções no fim do arquivo, dentro de `begin/commit`, no nível da 067 final: RLS ligado e zero policy nas três;
  ACL (anon e authenticated sem nada nas tabelas; authenticated só EXECUTE nas RPCs públicas; helpers sem EXECUTE);
  gatilho do agente no formato exato; `pg_get_constraintdef` de cada CHECK; `prosecdef` e `proconfig` exatos.
- Regras do cofre: até 90 KB, BEGIN só na primeira linha e COMMIT só na última, nenhuma palavra proibida.
- `tests/sql/test_068_pedido_bolsas.sql` autoconferido + `tools/replica-local/rodar-068-pglite.mjs` (molde do 067),
  com passo "antes da 068" exigindo `42P01`. Casos: professor só vê pessoas e bolsas do escopo (pessoa com bolsa em
  centro dentro e fora: a de fora não aparece); professor não põe na caixa pessoa fora do escopo; outro professor não
  vê nem mexe na caixa alheia; agente barrado nas RPCs e nas tabelas; anon sem nada; CPF em nome de caixa e em nota
  recusado (`529 982 247 25`, `529-982-247-25`, `529.982.247/25`, com quebra de linha), pela RPC e por INSERT direto do
  dono da tabela; equipe inválida; mover de caixa; totais (com e sem `valor_mensal`, pessoa com duas bolsas vigentes,
  bolsa `ended` com fim futuro conta, `cancelled` não); limite de 10 caixas.
- Linha da 068 em `docs/migracoes.md` ("ainda não aplicada").

## App v2 (`app/`)

1. Rota `#/bolsistas` em `roteador.js`, item "Bolsistas" no menu, para admin e professor. Página nova
   `paginas/Bolsistas.jsx` (+ `.css`), no visual das outras telas (componentes de `componentes/`, nada de cara de
   rascunho). Título "Bolsistas"; subtítulo "Monte o pedido de bolsas: filtre e coloque as pessoas nas caixas".
2. `servicos/dados.js` + `dadosExemplo.js`: `pedidoBolsas()`, `salvarEquipeBolsista()`, `salvarCaixaPedido()`,
   `apagarCaixaPedido()`, `colocarNaCaixa()`, `tirarDaCaixa()`, com validador do payload (molde dos outros). Modo
   exemplo com nomes **sintéticos** (nada de nome real), uns 25 bolsistas em 4 centros fictícios, das três equipes e
   sem equipe, uma pessoa com duas bolsas, uma encerrada com fim futuro, e duas caixas.
3. **Lista (esquerda)**, uma linha por pessoa: nome, equipe (chip clicável que abre um seletor Pastagem / Alertas /
   Solos / sem equipe), bolsas (`código · R$ x/mês · até mm/aaaa`, a que não está vigente hoje em tom apagado),
   `valor_vigente`, e botões para pôr em cada caixa (quem já está numa caixa mostra em qual). Arrastar para a caixa é
   bônus; os botões são obrigatórios (teclado e celular).
4. **Filtros (topo da lista)**, todos só de exibição, lembrados por usuário em `localStorage` com prefixo `cf_`:
   - Centros: uma caixa de marcar por centro, todos marcados no início. A pessoa aparece se tiver bolsa num centro
     marcado; as bolsas dos desmarcados não aparecem na linha.
   - Equipe: Pastagem, Sem equipe, Alertas, Solos; no início só Pastagem e Sem equipe.
   - Situação: "vigente hoje" (padrão) ou "termina até" uma data.
   - Busca por nome. Contador "N pessoas na lista".
5. **Caixas (direita)**: botão "Nova caixa" (nome e meses); cada caixa com nome e meses editáveis, apagar com
   confirmação, e o resumo da RPC: "N pessoas · R$ x por mês · R$ y em M meses". Em cada pessoa da caixa: valor usado
   (editável: "valor no pedido", vazio = o atual), nota curta, "tirar". Depois de cada ação, recarregar pela RPC (não
   somar no app).
6. Falha de consulta nunca vira zero: banner e `—` (regra do projeto). Erro de gravação mostra a mensagem e mantém o
   estado anterior.
7. Testes em `app/tests/`: filtros (centro desmarcado esconde quem só tem bolsa nele; equipe padrão), colocar/mover/
   tirar chamando os serviços certos, totais vindos da RPC, falha sem zero, validador.

## Verificação

`npx vitest run`, `npm run lint`, testes e build de `app/` verdes; o runner do pglite não pode ser pulado neste
worktree. Nenhum dado real em teste ou fixture.
