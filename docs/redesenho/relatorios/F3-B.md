# Relatório F3-B — Migração 068 e tela "Bolsistas": montar pedido de bolsas

Branch: `redesenho/f3-b-pedido` (worktree `C:/Users/amara/dev/cf-f3-b`). Commit novo, **sem push**.
**Nada foi aplicado em produção**, nenhuma variável `CF_*` real foi usada e **nenhuma outra IA foi chamada**.
O runner do PGlite rodou só em memória.

## 1. O que foi entregue

| Arquivo | Mudança |
|---|---|
| `database/068_pedido_bolsas.sql` | Migração: `bolsista_equipes`, `caixas_pedido`, `caixa_pedido_itens`, helper de visibilidade, seis RPCs, barreiras e asserções |
| `tests/sql/test_068_pedido_bolsas.sql` | Roteiro autoconferido (blocos 0–7) |
| `tools/replica-local/rodar-068-pglite.mjs` | Executor PGlite: `42P01` antes, idempotência, barreira 051, helpers e 10 mutantes |
| `docs/migracoes.md` | Linha da 068 ("ainda não aplicada") |
| `app/src/roteador.js` | Rota `#/bolsistas` |
| `app/src/componentes/BarraTopo.jsx` | Item "Bolsistas" para admin e professor |
| `app/src/App.jsx` | Página, guarda de papel e `podeBolsistas` |
| `app/src/paginas/Bolsistas.jsx` / `.css` | Tela nova: lista, filtros e caixas |
| `app/src/servicos/dados.js` | `pedidoBolsas`, `salvarEquipeBolsista`, `salvarCaixaPedido`, `apagarCaixaPedido`, `colocarNaCaixa`, `tirarDaCaixa` e validadores |
| `app/src/servicos/dadosExemplo.js` | Modo exemplo: 25 pessoas sintéticas em 4 centros, 2 caixas |
| `app/tests/bolsistas.test.jsx` | 10 testes da tela |
| `app/tests/bolsistas-exemplo.test.jsx` | 1 teste de integração no modo exemplo (sem banco) |
| `app/tests/pedido-bolsas.test.js` | 9 testes de serviços/validador/Modo exemplo |
| `app/tests/roteador.test.js` | Caso `#/bolsistas` |
| `docs/redesenho/tarefas/F3-B-pedido-bolsas.md` | Arquivo da tarefa, incluído no commit |

## 2. Tamanho dos arquivos

| Arquivo | Bytes | Linhas |
|---|---:|---:|
| `database/068_pedido_bolsas.sql` | **45.167** | 1.197 |
| `tests/sql/test_068_pedido_bolsas.sql` | **36.518** | 838 |
| `tools/replica-local/rodar-068-pglite.mjs` | **13.186** | 350 |
| `app/src/paginas/Bolsistas.jsx` | 25.250 | 713 |
| `app/src/paginas/Bolsistas.css` | 6.799 | 374 |
| `app/src/servicos/dados.js` | 28.246 | 933 |
| `app/src/servicos/dadosExemplo.js` | 85.976 | 2.640 |
| `app/tests/bolsistas.test.jsx` | 12.872 | 371 |
| `app/tests/bolsistas-exemplo.test.jsx` | 1.866 | 54 |
| `app/tests/pedido-bolsas.test.js` | 8.670 | 244 |

A migração está abaixo de 90 KB, começa com `begin;` como primeiro comando SQL e termina com `commit;` como
último; não tem `commit`/`savepoint` no meio nem os termos proibidos do cofre (`password`, `service_role`,
`net.`, `http(`, `dblink`, `cron.`, `vault.`, `create extension`, `concurrently`, `vacuum`, `copy`,
`set role`, `alter default privileges`…). **Não insere linha**: as únicas linhas novas são criadas depois,
pelas RPCs, com valores do chamador.

## 3. Banco: `database/068_pedido_bolsas.sql`

### 3.1. Tabelas

- **`public.bolsista_equipes`** — uma equipe por pessoa:
  - `holder_id uuid primary key references scholarship_holders(id) on delete cascade`;
  - `equipe text not null check in ('pastagem', 'alertas', 'solos')` — sem linha = "sem equipe";
  - `atualizado_em timestamptz not null default now()`;
  - `atualizado_por uuid default auth.uid() references auth.users(id) on delete set null`.
- **`public.caixas_pedido`** — caixas de quem monta o pedido:
  - `id uuid primary key default gen_random_uuid()`;
  - `nome text not null` (1–80 depois do `btrim`);
  - `meses integer not null default 12 check (meses between 1 and 60)`;
  - `dono uuid not null default auth.uid() references auth.users(id) on delete cascade`;
  - `criado_em` e `atualizado_em timestamptz not null default now()`.
- **`public.caixa_pedido_itens`** — pessoas de cada caixa:
  - `caixa_id uuid references caixas_pedido(id) on delete cascade`;
  - `holder_id uuid references scholarship_holders(id) on delete cascade`;
  - `valor_mensal numeric(14,2)` nulo (nulo = valor atual) ou positivo e finito;
  - `nota text` até 300 (sem `btrim` vazio);
  - `criado_em timestamptz not null default now()`;
  - `primary key (caixa_id, holder_id)`.

Índices: `idx_caixas_pedido_dono (dono, criado_em, id)` e `idx_caixa_pedido_itens_holder (holder_id)`.

### 3.2. Barreiras

As três tabelas têm **RLS ligado, nenhuma policy** e `revoke all ... from public, anon, authenticated`:
o default deny do RLS e a ACL fecham a tabela mesmo se alguém conceder `SELECT` no futuro. A leitura e a
escrita são só pelas RPCs (definer). Cada uma tem `trg_bloqueia_agente`
**BEFORE INSERT OR UPDATE OR DELETE FOR EACH STATEMENT**, sem `WHEN`.

CPF: a regra única é `public._tem_cpf` (064/065), chamada por dois gatilhos definer por linha —
`_caixas_pedido_sem_cpf()` em `caixas_pedido.nome` e `_caixa_pedido_itens_sem_cpf()` em
`caixa_pedido_itens.nota` (molde `_pendencias_sem_cpf`/063 e `_termos_sem_cpf`/067). **Nenhum CHECK chama
helper de CPF**: CHECK com função sem `EXECUTE` para `authenticated` falharia por permissão em vez de
`23514`. As RPCs repetem a checagem antes de gravar, devolvendo `22023`.

### 3.3. Visibilidade

`public._bolsista_visivel(p_holder_id uuid) returns boolean` é `stable`, `security definer`, sem `EXECUTE`
para ninguém. Admin vê todas as pessoas; os demais veem quem tem pelo menos uma bolsa
`status <> 'cancelled'` em `allowed_project_ids()`. Nunca devolve bolsa de centro fora do escopo, nem para
dizer que existe. Para a lista, a RPC acrescenta a janela `end_date >= current_date - 180` exigida pelo
pedido.

### 3.4. RPCs

Todas `security definer`, `set search_path = public, pg_temp`, `revoke ... from public, anon` e
`grant execute ... to authenticated`. Guarda comum: `auth.uid()` não nulo, linha em `app_users` e
`not is_agente()`.

- **`get_pedido_bolsas_v2()`** (`stable`):
  - `centros`: `[{ id, code, name }]` dos centros com bolsa listada, ordem por `code`;
  - `bolsistas`: pessoas visíveis com bolsa não cancelada e `end_date >= current_date - 180`, com
    `{ holder_id, nome, equipe, valor_vigente, bolsas: [{ scholarship_id, project_id, code, valor, inicio,
    fim, status, vigente_hoje }] }`. `valor_vigente` soma as bolsas do escopo com
    `start_date <= current_date <= end_date` e status `active`/`ended` (regra da 048). `vigente_hoje` usa a
    mesma regra. Só bolsas do escopo; ordem por nome;
  - `caixas`: só as do próprio usuário (`dono = auth.uid()`), com `{ id, nome, meses, criado_em, pessoas,
    total_mensal, total_periodo, itens_ocultos, itens: [{ holder_id, valor_mensal, valor_usado, nota }] }`.
    `valor_usado = coalesce(valor_mensal, valor_vigente)`, `total_mensal = soma` e
    `total_periodo = total_mensal * meses`. Item de pessoa que deixou de ser visível sai da lista e da
    soma; `itens_ocultos` conta quantos saíram. **As contas ficam no banco; o app só mostra.**
- **`salvar_equipe_bolsista_v2(p_holder_id, p_equipe)`**: pessoa visível; `null`/`''` apaga; valor fora da
  lista devolve `22023`; devolve `{ holder_id, equipe }`.
- **`salvar_caixa_pedido_v2(p jsonb)`**: chaves permitidas `id`, `nome`, `meses` (outras → `22023`). Sem
  `id` cria, no máximo 10 caixas por dono; com `id` só o dono altera (caixa inexistente → `P0002`, de
  outra pessoa → `42501`). Nome obrigatório (1–80) e sem CPF; devolve a caixa.
- **`apagar_caixa_pedido_v2(p_id)`**: só o dono; devolve `{ id, apagada: true }`; os itens caem por
  cascade.
- **`colocar_na_caixa_v2(p_caixa_id, p_holder_id, p_valor_mensal, p_nota)`**: só o dono da caixa; pessoa
  visível; valor positivo e finito quando preenchido; nota até 300 e sem CPF; upsert do item. **Tira a
  pessoa das outras caixas do mesmo dono** e devolve `saiu_de: [{ caixa_id, nome }]`. Uma pessoa fica em
  uma caixa só por dono.
- **`tirar_da_caixa_v2(p_caixa_id, p_holder_id)`**: só o dono; item inexistente → `P0002`.

Erros: sem permissão → `42501`; parâmetro inválido → `22023`; não encontrado → `P0002`. Nenhuma mensagem
inclui nome de pessoa de outro escopo.

### 3.5. O que **não** muda

`get_saldo_livre`, `explicar_livre_v2`, `resumo_projetos_v2`, `scholarships`, saldos e a tela do projeto
continuam iguais. A migração não cria linha em tabela existente e não toca em `projects`.

### 3.6. Decisões e limites conhecidos

- **Caixas são por dono.** Admin vê as dele, não as dos outros nesta rodada — exatamente o pedido.
- **Uma pessoa por caixa por dono**: `colocar_na_caixa` remove das outras caixas do mesmo dono. As caixas
  de outro professor não são mexidas.
- **Item oculto não é apagado**: quando a pessoa deixa de ser visível (escopo perdido, bolsa cancelada ou
  fim há mais de 180 dias), o item sai da lista e da soma e entra em `itens_ocultos`. Isso preserva o
  trabalho de quem montou o pedido e deixa o número auditável.
- **Bolsas canceladas aparecem na linha?** Sim, se a pessoa também tem uma bolsa não cancelada recente: a
  bolsa cancelada vai em `bolsas` com `status: 'cancelled'` e `vigente_hoje: false`, para a pessoa poder
  ver o histórico; ela **não** entra em `valor_vigente` nem nos totais. Quem só tem bolsa cancelada não é
  listado.
- **Janela de 180 dias** é a mesma da lista: bolsas mais antigas não inflam a linha nem os centros. A RPC
  continua devolvendo a pessoa que tem uma bolsa recente e outra antiga, mas só a recente aparece.
- **`nome` é obrigatório também na alteração** (o app envia nome e meses juntos). A API não faz update
  parcial de caixa nesta rodada.
- **Pessoa visível mas fora da janela de 180 dias** pode receber equipe (a regra de visibilidade não tem
  janela), mas não entra na lista enquanto não tiver bolsa recente. `colocar_na_caixa` também usa a
  visibilidade, então um item assim aparece como oculto até a pessoa voltar à lista.
- **Sem arrastar e soltar**: era bônus; os botões (teclado e celular) estão presentes e são o caminho
  obrigatório.

## 4. App v2 (`app/`)

### 4.1. Rota e menu

- `roteador.js` interpreta `#/bolsistas` como `{ pagina: 'bolsistas', menu: 'bolsistas' }`; `urlProjeto`
  não muda.
- `BarraTopo` ganhou `podeBolsistas`; o item "Bolsistas" aparece para **admin e professor**. Agente,
  automação e papel desconhecido não veem o item; se entrarem pela URL, `App` redireciona para
  `#/projetos`.
- `App` renderiza `Bolsistas` e passa `usuarioId` para a chave de `localStorage`.

### 4.2. Camada de dados

`servicos/dados.js`:

- `pedidoBolsas()` → `get_pedido_bolsas_v2`; valida centros, bolsistas, bolsas, caixas, itens, totais e
  `itens_ocultos` com `validarPedidoBolsas`. Falha de RPC vira `{ dados: null, erro }`, nunca zero nem
  lista vazia.
- `salvarEquipeBolsista(holderId, equipe)` → valida equipe e envia `p_holder_id`/`p_equipe` (vazio vira
  `null`).
- `salvarCaixaPedido({ id?, nome, meses })` → valida nome 1–80 e meses inteiro 1–60; envia dentro de `p`.
- `apagarCaixaPedido(id)`, `colocarNaCaixa(caixaId, holderId, valorMensal, nota)` e
  `tirarDaCaixa(caixaId, holderId)` com validação local de ids, valor positivo e nota até 300.
- `validarPedidoBolsas` e `validarCaixaPedido` exportados para teste.

`servicos/dadosExemplo.js` (só em desenvolvimento): 25 pessoas **sintéticas** ("Bolsista Ana" etc.) em
quatro centros fictícios (30.901, 30.902, 30.903 e 30.908), nas três equipes e sem equipe; uma pessoa com
duas bolsas ativas, uma `ended` com fim futuro, uma `ended` no passado, uma bolsa cancelada no histórico, e
duas caixas iniciais. As contas do modo exemplo seguem a mesma regra do banco. Nenhum nome real e nenhum
dado de produção.

### 4.3. Tela `paginas/Bolsistas.jsx`

- Cabeçalho: título **Bolsistas** e subtítulo **"Monte o pedido de bolsas: filtre e coloque as pessoas nas
  caixas"**; a linha de contexto mostra o total de pessoas e centros.
- **Filtros no topo da lista**, só de exibição, lembrados em `localStorage` com prefixo `cf_`
  (`cf_bolsistas_filtros_<id do usuário>`):
  - centros: uma caixa de marcar por centro, todas marcadas na primeira visita;
  - equipe: chips Pastagem, Sem equipe, Alertas e Solos; começa com Pastagem e Sem equipe;
  - situação: "Vigente hoje" (padrão) ou "Termina até" com data;
  - busca por nome, sem acento e sem caixa;
  - contador "N pessoas na lista".
- **Lista (esquerda)**: uma linha por pessoa com nome, chip de equipe (abre seletor
  Pastagem/Sem equipe/Alertas/Solos), bolsas no formato `código · R$ x/mês · até mm/aaaa` (a não vigente
  em tom apagado), `valor_vigente` e um botão por caixa. Quem já está numa caixa vê "Em <caixa>" em
  destaque; clicar noutra caixa move.
- **Caixas (direita)**: "Nova caixa" (nome e meses), cada caixa com nome e meses editáveis, apagar com
  confirmação em dois passos e resumo vindo da RPC: "N pessoas · R$ x por mês · R$ y em M meses". Cada
  pessoa da caixa tem "valor no pedido" (vazio = valor atual), nota curta, "Salvar pessoa" e "Tirar".
- **Depois de cada ação com sucesso a tela recarrega pela RPC**; o app não soma valores localmente.
- **Falha de consulta**: banner (`AvisoFalha`) e `—`, nunca `R$ 0`. **Falha de gravação**: mostra a
  mensagem e mantém o estado anterior.
- Visual: componentes de `componentes/` (`CabecalhoPagina`, `Botao`, `Campo`, `Seletor`, `Chip`,
  `AvisoFalha`, `Esqueleto`, `Vazio`), tokens de `estilo/tokens.css`, CSS próprio com os breakpoints
  640/1024 e sem cor/medida literal.

## 5. Testes

### 5.1. Roteiro SQL (`tests/sql/test_068_pedido_bolsas.sql`)

Blocos:

- **0** — tabelas existem; base 064 no lugar; fixture sintética (10 pessoas, bolsas em 51.X, 51.Y, 63.INAT,
  com duas bolsas, `ended` futuro, `ended` passado, cancelada, sem bolsa e fim há 200 dias). Antes da
  migração o bloco falha com `42P01`.
- **1** — professor só vê pessoas e bolsas do escopo (Gabi tem 51.X e 51.Y: cada professor vê só o seu);
  centro fora do escopo não aparece nem como existência; admin vê tudo; automação lê mas não vê nada;
  agente recebe `42501` nas seis RPCs; usuário sem `app_users` recebe `42501`; anon não lê tabela nem RPC;
  `authenticated` (inclusive admin) não faz `SELECT` direto.
- **2** — equipe válida, inválida (`22023`), vazio/null apaga, pessoa fora do escopo (`42501`), agente
  (`42501`) e compartilhamento: b2 classifica Gabi e b1 enxerga a mesma equipe.
- **3** — criar/alterar caixas; chaves extras, nome vazio/81, meses 0/61/1,5/texto e id inválido
  (`22023`); caixa inexistente (`P0002`); caixa de outro professor não é alterada nem apagada (`42501`);
  b2 não vê as caixas de b1; apagar caixa vazia.
- **4** — totais com e sem `valor_mensal`; duas bolsas vigentes somam; `ended` com fim futuro conta;
  `ended` no passado vale 0; cancelada e fora do escopo não entram; valor zero/negativo/NaN/Infinity
  (`22023`); nota longa e CPF (`22023`); mover de caixa devolve `saiu_de` e a caixa de origem perde a
  pessoa; tirar; item de pessoa não visível sai da lista/soma e conta em `itens_ocultos`; b2 não coloca
  pessoa na caixa de b1.
- **5** — limite de 10 caixas (`22023` na 11ª); cascade ao apagar caixa.
- **6** — CPF em nome de caixa e em nota, nos quatro formatos (`529 982 247 25`, `529-982-247-25`,
  `529.982.247/25` e com quebra de linha): pela RPC (`22023`) e por `INSERT` direto do dono da tabela
  (`23514`). O gatilho do agente também barra o dono (`42501`).
- **7** — estado final das equipes e da caixa de b1.

### 5.2. Runner PGlite (`tools/replica-local/rodar-068-pglite.mjs`)

Fluxo:

1. base real 025 + 026 + 051/052/054/053/056/062 + 038/048 + 063 + 064/stub-064;
2. `test_068` **falha antes com `42P01`**;
3. confere o cofre (45.167 bytes, `begin;`/`commit;`, sem termos proibidos, sem INSERT de dado);
4. aplica a 068 e roda o roteiro;
5. reaplica a 068 e roda de novo (idempotência);
6. confere o BLOCO 1 da 051 em todas as tabelas de `public`;
7. confere que os 6 helpers protegidos não mudaram;
8. prova **10 mutantes**:

| # | Mutante | Motivo que o roteiro acusou |
|---:|---|---|
| 1 | bolsa de centro fora do escopo | `b1 recebeu bolsa de centro fora do escopo` |
| 2 | pessoa com bolsa cancelada listada | `admin não lista quem só tem bolsa cancelada` |
| 3 | `salvar_equipe` sem visibilidade | `operação deveria falhar mas passou` |
| 4 | `valor_vigente` somando bolsa não vigente | `Davi (ended no passado) deveria valer 0 hoje` |
| 5 | não tirar das outras caixas | `caixa 1 deveria ficar com 1 pessoa` |
| 6 | sem limite de 10 caixas | `operação deveria falhar mas passou` |
| 7 | item não visível contado na caixa | `caixa 1 deveria contar 1 item oculto` |
| 8 | sem pré-checagem de CPF na RPC | `esperado SQLSTATE 22023, veio 23514` |
| 9 | `grant select` para `authenticated` | `operação deveria falhar mas passou` |
| 10 | apagar caixa sem checar o dono | `operação deveria falhar mas passou` |

9. reaplica a 068 e roda o roteiro final; helpers continuam intactos.

### 5.3. App

`app/tests/bolsistas.test.jsx` (happy-dom, serviços mockados): filtro padrão (centros todos, equipes
Pastagem/Sem equipe, só vigentes), centro desmarcado escondendo quem só tem bolsa nele, chips de equipe com
persistência em `localStorage`, busca sem acento e contador singular, totais vindos da RPC (sem soma
local), colocar/mover/tirar chamando os serviços certos, chip de equipe, criação de caixa, erro de gravação
mantendo o estado e falha de consulta com banner + `—` (sem `R$ 0`).

`app/tests/bolsistas-exemplo.test.jsx`: renderiza a tela sem mocks, com `VITE_DADOS=exemplo`, e confere os
25 bolsistas sintéticos, os 4 centros e as 2 caixas; ao marcar as quatro equipes, ficam 24 na lista (a
pessoa com bolsa só `ended` no passado fica fora do filtro "vigente hoje").

`app/tests/pedido-bolsas.test.js`: validador do payload (incluindo caixa sem `itens_ocultos`, status
inválido, equipe inválida e total não numérico); RPCs com parâmetros e validação local; falha de RPC; modo
exemplo com 25 pessoas, 4 centros, as três equipes + sem equipe, pessoa com duas bolsas, `ended` futura e
duas caixas; mover entre caixas no modo exemplo.

### 5.4. Verificação executada

| Comando | Resultado |
|---|---|
| `npx vitest run` (raiz) | **44 arquivos, 699 testes passando, 5 pulados** |
| `npm run lint` | **sem saída** (0 erros/warnings) |
| `cd app && npx vitest run` | **18 arquivos, 135 testes passando** |
| `cd app && npm run verificar-estilo` | **nenhuma violação** |
| `cd app && npm run build` | **build ok**; `verificar-build`: nenhum dado de exemplo no bundle |
| `node tools/replica-local/rodar-068-pglite.mjs` | **OK**: antes `42P01`, idempotência, barreira 051, helpers intactos, 10 mutantes e roteiro final |

Observação de ambiente: o `mcp/node_modules` não existia neste worktree e a suíte da raiz tentava carregar
`pdfjs-dist` de lá. Rodei `npm ci --prefix mcp` (dependências declaradas no `mcp/package.json`) para a
suíte da raiz ficar verde; isso é ambiente, não mudança de código.

## 6. O que não foi feito

- **Sem push, sem aplicar migração, sem cofre, sem `CF_*` reais.**
- Sem arrastar e soltar (era bônus); os botões cobrem teclado e celular.
- Sem página de admin para as caixas dos outros: por decisão do pedido, admin vê só as próprias nesta
  rodada.
- Sem alteração em `frontend/` (site antigo), `mcp/` ou nas tools da IA.

## 2ª rodada (19/11/2026 — revisões MiniMax max/DeepSeek max de `f0cebde` + teste da tela)

Esta seção registra o que mudou depois da 1ª rodada; onde as duas divergirem, vale esta.
Nada foi publicado, aplicado ou testado contra produção, e nenhuma variável `CF_*` real foi usada.
O PGlite rodou só em memória.

### 2.1. Banco: operações separadas

`colocar_na_caixa_v2` mudou de assinatura para **`(p_caixa_id uuid, p_holder_id uuid)`** e agora só
**coloca ou move**. Se a pessoa já está numa caixa do mesmo dono, o `valor_mensal` e a `nota` do item de
origem vão junto; se já está na caixa de destino, nada muda. A função devolve `saiu_de` com as caixas de
onde saiu. A sobrecarga antiga de 4 argumentos é removida com `drop function if exists` (a 068 ainda não
foi aplicada em produção) e uma asserção recusa qualquer sobrecarga que sobreviva.

A edição passou a ser **`editar_item_caixa_v2(p_caixa_id, p_holder_id, p_valor_mensal, p_nota)`**: grava
exatamente o que veio (`null` limpa), exige que o item exista (`P0002`) e arredonda o valor **antes** de
validar — `0,004` vira `0,00` e devolve `22023`, não `23514`. O editor do item usa só essa RPC; a lista e os
botões de caixa usam só a de colocar. Na tela, a caixa onde a pessoa já está virou marcador não clicável
("Na caixa X").

### 2.2. Banco: advisory lock por dono

`salvar_caixa_pedido_v2` (criação) e `colocar_na_caixa_v2` tomam, antes de contar/apagar/inserir:

```sql
perform pg_advisory_xact_lock(hashtextextended('caixas_pedido:' || v_dono::text, 0));
```

Isso impede duas abas de criarem a 11ª caixa ou de deixarem a mesma pessoa em duas caixas. **O PGlite não
prova concorrência**: a garantia provada em teste é textual — `pg_get_functiondef` tem de conter
`pg_advisory_xact_lock`, e os mutantes 11 e 12 removem a chamada e falham a asserção. A correção de
concorrência de verdade depende do lock do Postgres em produção.

### 2.3. Banco: automação, PKs, FKs e itens ocultos

- A guarda comum das oito RPCs passou a ser `auth.uid()` + linha em `app_users` + `not is_agente() and
  not is_automacao(null)`. O papel `automacao` (Vigia) recebe `42501` em todas.
- As três tabelas ganharam **`trg_bloqueia_automacao`** no formato da 054: BEFORE INSERT OR UPDATE OR
  DELETE **FOR EACH STATEMENT**, sem WHEN, chamando `_bloquear_financeiro_automacao()`. O agente continua
  com `trg_bloqueia_agente`; os dois gatilhos são conferidos no formato exato.
- As PKs são adicionadas de forma idempotente se faltarem (sem derrubar FKs que já apontam para elas) e as
  asserções conferem `contype = 'p'` com `conkey` exato. As FKs são conferidas por `confrelid`, `conkey`,
  `confkey` e ação de delete, não só pelo nome: alvos `scholarship_holders(id)`, `caixas_pedido(id)` e
  `auth.users(id)`.
- RPC nova **`limpar_ocultos_da_caixa_v2(p_caixa_id)`**: só o dono, apaga os itens de quem saiu da lista
  pela **mesma regra da `get_pedido_bolsas_v2`** (helper `_bolsista_no_pedido` = visibilidade + bolsa não
  cancelada nos últimos 180 dias), não devolve nomes e retorna `{ caixa_id, removidos }`.
- Caixa de outro dono responde **`P0002` igual à inexistente** em `salvar` (update), `apagar`, `colocar`,
  `editar`, `tirar` e `limpar`. O nome da caixa alheia não serve de oráculo.
- O gatilho de CPF foi conferido como estritamente BEFORE INSERT OR UPDATE por linha (sem DELETE nem
  TRUNCATE, sem WHEN).

### 2.4. App: dados, parser e validação

- `servicos/dados.js` ganhou `editarItemCaixa()` e `limparOcultosDaCaixa()`, e `colocarNaCaixa()` passou a
  receber só caixa e pessoa. `salvarCaixaPedido()` só manda `meses` quando ele foi definido.
- As RPCs desta tela devolvem a mensagem do banco quando o SQLSTATE é `22023`, `P0002` ou `42501` e a
  mensagem é uma das escritas pela 068 (erros de ACL/constraint do Postgres continuam genéricos). Os
  testes cobrem mensagem de limite, caixa inexistente, código desconhecido e `permission denied`.
- `validarCaixaPedido` passou a conferir `pessoas === itens.length`, `total_mensal` igual à soma de
  `valor_usado` e `total_periodo === total_mensal × meses`, com tolerância de `0,005`. Salvar caixa e
  salvar item conferem que o devolvido bate com o enviado; se não bater, viram erro, não dado meio certo.
- `util/moeda.js` (`parseValorBR`) resolve o bug de `4.500` virar R$ 4,50: ponto seguido de exatamente três
  dígitos é milhar, vírgula é decimal. Cobre `4500`, `4.500`, `4.500,00`, `4,50`, `R$ 4.500`,
  `1.234.567,89`, `12.000`, vazio, lixo e formatos ambíguos.
- O modo exemplo acompanha: duas caixas, 25 pessoas sintéticas, mover leva valor/nota, editar grava
  exatamente e `limparOcultos` devolve zero (não há pessoa oculta no exemplo).

### 2.5. App: filtros e tela

- O filtro de centros passou a guardar os **desmarcados** (`centrosDesmarcados`), então centro novo entra
  marcado. Se o formato antigo (`centros` = marcados) só tiver centros que não existem mais, a tela volta
  para todos em vez de começar vazia.
- O rótulo da soma virou **"soma vigente hoje (todos os seus centros): R$ x"** e, quando alguma bolsa
  vigente da pessoa é de centro desmarcado, aparece ao lado **"inclui bolsa de centro desmarcado"**. O
  valor continua vindo da RPC; o app não soma.
- Mudar a equipe para uma fora do filtro mostra **"Fulano agora está em Alertas (fora do filtro)."**;
  mover mostra **"Fulano saiu de Time Pastagem."**.
- A lista ficou densa no desktop (nome/equipe | bolsas | soma | botões), quebrando em 640/1024; filtros e
  contador ficam fixos no topo da coluna ao rolar no desktop.
- Cada pessoa da caixa ocupa **uma linha**: nome · valor usado (com "editado" quando há `valor_mensal`) ·
  ícone de nota · Editar · Tirar. "Editar" abre valor e nota na própria linha. O resumo da caixa
  ("12 pessoas · R$ 24.600/mês · R$ 295.200 em 12 meses") fica em destaque no topo. O aviso de item oculto
  ganhou o botão **"Tirar quem saiu da lista"**.

### 2.6. Testes e mutantes

`tests/sql/test_068_pedido_bolsas.sql` foi reescrito para o novo contrato (blocos 0–7): esquema (PK/FK,
gatilhos, assinatura e lock), visibilidade, equipe, caixas, itens/edição/movimento entre três caixas,
limite/cascade, CPF por RPC + INSERT e UPDATE do dono, agente/automação e estado final. Os casos novos
incluem: `colocar` de novo sem apagar valor/nota, `editar` com `0,004`, nota de 300, nome de 80, meses 1 e
60, caixa alheia em todas as operações (`P0002`), limpar ocultos (1 e depois 0), e apagar caixa com item
pelo id guardado.

O runner agora prova **17 mutantes**:

| # | Mutante | Motivo que o roteiro acusou |
|---:|---|---|
| 1 | bolsa de centro fora do escopo | `b1 recebeu bolsa de centro fora do escopo` |
| 2 | pessoa com bolsa cancelada listada | `admin não lista quem só tem bolsa cancelada` |
| 3 | `salvar_equipe` sem visibilidade | `operação deveria falhar mas passou` |
| 4 | `valor_vigente` somando bolsa não vigente | `Davi (ended no passado) deveria valer 0 hoje` |
| 5 | não tirar das outras caixas | `caixa 1 deveria ficar com 1 pessoa` |
| 6 | sem limite de 10 caixas | `operação deveria falhar mas passou` |
| 7 | item não visível contado na caixa | `caixa 1 deveria contar 1 item oculto` |
| 8 | sem pré-checagem de CPF na RPC | `esperado SQLSTATE 22023, veio 23514` |
| 9 | `grant select` para `authenticated` | `operação deveria falhar mas passou` |
| 10 | apagar caixa sem checar o dono | `operação deveria falhar mas passou` |
| 11 | `salvar_caixa` sem `pg_advisory_xact_lock` | `sem pg_advisory_xact_lock` |
| 12 | `colocar` sem `pg_advisory_xact_lock` | `sem pg_advisory_xact_lock` |
| 13 | `caixas_pedido` sem `trg_bloqueia_automacao` | `trg_bloqueia_automacao ausente ou incorreto` |
| 14 | `caixas_pedido` sem PK | `PK de caixas_pedido ausente ou errada` |
| 15 | FK de item apontando para `projects` | `alvo/colunas errados` |
| 16 | `colocar` sem levar valor/nota | `Bruno deveria levar 4500 para a caixa 2` |
| 17 | `editar` sem recusar a automação | `esperado SQLSTATE 42501` |

No app, `app/tests/moeda.test.js` cobre o parser; `bolsistas.test.jsx` cobre centro desmarcado, centro
novo marcado, formato antigo que sumiu, chips, busca, totais da RPC, marcador da caixa atual, mover/tirar
com dois parâmetros, editar valor/nota pela RPC certa, valor inválido sem RPC, aviso de equipe fora do
filtro, aviso de "saiu de", limpar ocultos e falha sem zero; `pedido-bolsas.test.js` cobre os validadores
(contas da caixa), o envio condicional de `meses`, a mensagem do banco nos três SQLSTATEs, o encaixe do
devolvido com o enviado e o modo exemplo.

### 2.7. Verificação executada nesta rodada

| Comando | Resultado |
|---|---|
| `node tools/replica-local/rodar-068-pglite.mjs` | **OK**: `42P01` antes, 68 aplicada e reaplicada, BLOCO 1 da 051, 6 helpers intactos, **17 mutantes** e roteiro final |
| `npx vitest run` (raiz) | **44 arquivos, 699 testes passando, 5 pulados** |
| `npm run lint` | **sem saída** (0 erros/warnings) |
| `cd app && npx vitest run` | **19 arquivos, 147 testes passando** |
| `cd app && npm run verificar-estilo` | **nenhuma violação** |
| `cd app && npm run build` | **build ok**; `verificar-build`: nenhum dado de exemplo no bundle |

### 2.8. O que não mudou / não foi feito

- **Sem push, sem aplicar migração, sem cofre, sem `CF_*` reais.** A 068 continua "ainda não aplicada".
- Nada mudou em `scholarships`, saldos, `get_saldo_livre`, `explicar_livre_v2`, `resumo_projetos_v2`,
  `frontend/`, `mcp/` ou tools da IA.
- O PGlite não prova concorrência real; os mutantes provam que o advisory lock está no texto das funções.
- Sem arrastar e soltar; os botões seguem sendo o caminho de teclado e celular.
