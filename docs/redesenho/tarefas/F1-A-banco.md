# F1-A — Banco da fase 1 (migração 063)

Executor: **Orchestrator (Neon)**, num worktree próprio **fora do OneDrive** (branch `redesenho/f1-a-banco`).
Roda em paralelo com a F1-B (telas): as duas tarefas **não têm arquivo em comum**. O contrato entre elas é a
seção "Contrato" abaixo, igual nas duas tarefas; não mude nome, parâmetro ou campo sem registrar no relatório.

Antes de começar, leia: `CLAUDE.md` (seção de migrações: regras do cofre), `docs/migracoes.md` (linhas 033,
038, 048, 051, 054, 062), `docs/redesenho/README.md` §4, §6 (F1) e §7b, e `database/062_arquivos_por_centro.sql`
+ `tools/replica-local/rodar-062-pglite.mjs` como modelo de forma e de teste.

**Você não aplica nada em produção.** Escreve, testa localmente e para. A aplicação é do Claude, com o ok do
Victor, pelo cofre.

## Arquivos (só estes)
- `database/063_redesenho_f1.sql` (novo)
- `tests/sql/test_063_redesenho_f1.sql` (novo)
- `tools/replica-local/sintetico/stub-063.sql` (novo, se precisar de tabelas/funções que o stub base não tem)
- `tools/replica-local/rodar-063-pglite.mjs` (novo)
- `docs/migracoes.md` (uma linha nova para a 063)
- `docs/redesenho/relatorios/F1-A.md` (novo)

## O que a 063 cria

### 1. `pendencias` (lista única: por projeto + sino global)
Colunas: `id uuid pk default gen_random_uuid()`, `chave text not null unique` (idempotência: quem cria
pendência usa uma chave estável, ex. `bolsista-dois-planos:<cpf_hash>:<ano>`), `project_id uuid null
references projects(id) on delete cascade` (null = pendência geral), `tipo text not null` (check em
`'balancete','plano','bolsas','contrato','cadastro','outro'`), `titulo text not null` (frase curta, sem CPF),
`detalhe jsonb not null default '{}'`, `situacao text not null default 'aberta'` (check `'aberta','resolvida',
'descartada'`), `origem text not null default 'sistema'` (check `'sistema','buriti','claude','pessoa'`),
`criada_em timestamptz not null default now()`, `resolvida_em timestamptz`, `resolvida_por uuid references
auth.users(id)`.
- RLS ligado; `revoke all ... from anon`; policy de SELECT para `authenticated`:
  `is_admin() or (project_id is not null and project_id = any(allowed_project_ids()))`.
  Pendência sem centro só o admin vê. **Nenhuma** policy de escrita: só pelas RPCs abaixo.
- Gatilho `trg_bloqueia_agente` BEFORE INSERT OR UPDATE OR DELETE FOR EACH STATEMENT, sem WHEN (padrão 051).
- Índice em `(project_id) where situacao = 'aberta'`.
- `contem_cpf(titulo)` não pode ser verdadeiro: check ou validação na RPC de criação.
- Sem linha inicial (a migração não insere pendência nenhuma).

### 2. `filtro_visao` (filtro da própria visão do admin; é apresentação, não permissão)
`user_id uuid pk references auth.users(id) on delete cascade`, `centros_ocultos uuid[] not null default '{}'`,
`atualizado_em timestamptz not null default now()`.
- RLS: cada um lê e grava só a própria linha (`user_id = auth.uid()`); `revoke ... from anon`; gatilho do
  agente como acima.
- O site antigo **não** lê esta tabela.

### 3. `centros_visiveis() returns setof uuid`
`security definer`, `set search_path = public, pg_temp`, `stable`. Devolve os centros que o usuário pode ver
(admin: todos de `projects`; professor: `allowed_project_ids()`), **menos** os de `filtro_visao.centros_ocultos`
do próprio usuário. Ponto único de aplicação do filtro: as RPCs abaixo usam esta função, nunca a tabela direto.

### 4. `v_balancete_vigente`
View `with (security_invoker = true)`: para cada `project_id`, o balancete de `data_referencia` mais recente
(empate: `created_at` mais recente). Colunas: `project_id, balancete_id, data_referencia, saldo_disponivel,
rendimento_liquido`. Existe para a F2 trocar o corpo (balancete versionado) sem mudar quem lê.
`revoke ... from anon`; `grant select ... to authenticated`.

### 5. RPCs (todas `security definer` + `set search_path = public, pg_temp`; `revoke execute ... from public,
anon`; `grant execute ... to authenticated`)

Ver o contrato exato abaixo. Regras de cada uma:
- `resumo_projetos_v2()`: percorre `centros_visiveis()` (só `projects.active`), chama `get_saldo_livre(id)`
  para cada um **dentro de um bloco com exception**: se falhar, o centro vem com `situacao = 'sem dado'`,
  `livre = null` e `erro` preenchido — uma falha nunca derruba a lista nem vira zero.
  `livre` = soma de `grupos[].saldo_livre` (critério do oráculo, README §7b.3) **só quando** `has_plano` e
  `has_balancete`; senão `null`. Situação, nesta ordem: `'sem plano'` (sem plano), `'sem balancete'` (sem
  balancete), `'problema'` (algum grupo com `saldo_livre < 0`), `'atenção'` (`balancete_defasagem_meses >= 2`
  ou pendência aberta no centro), `'em dia'`. `ocultos` = quantos centros o usuário poderia ver e escondeu.
  `responsaveis` = nomes (`app_users`) dos professores com o centro em `user_projects`, em ordem alfabética;
  para professor, a lista vem vazia (só o admin agrupa o filtro por professor). `todos` (só admin) = a mesma
  forma de cada centro **sem** o filtro aplicado, só com `id, code, name, responsaveis, oculto: bool` — é o
  que o menu do filtro lista.
- `listar_pendencias_v2(p_project_id uuid default null)`: abertas primeiro, depois as outras dos últimos 90
  dias; com `p_project_id` filtra o centro (com `assert_project_allowed`); sem ele devolve as dos
  `centros_visiveis()` **mais** as sem centro (só admin). O filtro de visão nunca esconde pendência sem centro.
- `resolver_pendencia_v2(p_id uuid, p_situacao text)`: só `'resolvida'` ou `'descartada'`; admin, ou
  professor do centro da pendência; grava `resolvida_em = now()`, `resolvida_por = auth.uid()`.
- `criar_pendencia_v2(p jsonb)`: **só admin** nesta fase (o Buriti ganha a dele na F3). Upsert por `chave`:
  se já existe aberta, atualiza `titulo/detalhe`; se existe resolvida/descartada, não reabre (devolve a
  existente). Recusa `titulo` com CPF.
- `get_filtro_visao_v2()` → `{ centros_ocultos: uuid[] }` (vazio se não houver linha).
- `set_filtro_visao_v2(p_centros_ocultos uuid[])`: grava só ids que o usuário pode ver (ignora o resto).
- `get_repasses_v2(p_project_id uuid)`: **só leitura, sem conta**. `assert_project_allowed`. Devolve as
  parcelas do plano ativo (`plano_desembolsos`: `parcela, data_prevista, data_texto, valor, valor_texto`, em
  ordem) e, do balancete vigente, `data_referencia` e `raw_extraction->'data'->'recursos'`. A conta da
  situação de cada parcela é feita no site pelo `frontend/js/planejamento-dinheiro.js` (mesma implementação do
  site antigo). Professor não lê `plano_desembolsos` direto (RLS admin-only da 033): por isso a RPC.

## Contrato (igual na F1-B)
```
resumo_projetos_v2() → jsonb
{ "centros": [ { "id", "code", "name", "end_date", "drive_folder_url" (null para não-admin),
                 "livre": number|null, "situacao": "em dia"|"atenção"|"problema"|"sem balancete"|"sem plano"|"sem dado",
                 "data_referencia": "AAAA-MM-DD"|null, "pendencias_abertas": int, "erro": "falha_saldo_livre"|null,
                 "responsaveis": [string] } ],
  "ocultos": int,
  "todos": [ { "id","code","name","responsaveis","oculto": bool } ] }   -- só admin; professor recebe []
listar_pendencias_v2(p_project_id uuid default null) → jsonb  [ { "id","project_id","code","tipo","titulo","detalhe","situacao","origem","criada_em" } ]
resolver_pendencia_v2(p_id uuid, p_situacao text) → jsonb  { "id","situacao" }
criar_pendencia_v2(p jsonb) → jsonb  { "id","chave","situacao","criada": bool }   -- só admin; a F1-B não usa (sem tela de criar na F1)
get_filtro_visao_v2() → jsonb  { "centros_ocultos": [uuid] }
set_filtro_visao_v2(p_centros_ocultos uuid[]) → jsonb  { "centros_ocultos": [uuid] }
get_repasses_v2(p_project_id uuid) → jsonb
{ "parcelas": [ { "parcela","data_prevista","data_texto","valor","valor_texto" } ],
  "valor_total_plano": number|null, "data_balancete": "AAAA-MM-DD"|null, "recursos": object|null }
get_saldo_livre(p_project_id uuid)  -- já existe (038/048), não mexer
```

## Regras do cofre (o arquivo é recusado se quebrar uma)
`begin;` na primeira linha de comando e `commit;` na última; nada de papéis, extensões, `alter default
privileges`, `set role`, palavras proibidas (`net.`, `http(`, `dblink`, `cron.`, `vault.`, `password`,
`service_role`); não tocar `is_agente`, `is_admin`, `allowed_project_ids`, `assert_project_allowed`,
`contem_cpf`, `bloqueia_escrita_do_agente`; nenhuma linha nova com `now()`/`gen_random_uuid()` gravado (a
migração não insere dado); até 90 KB. Asserções no fim do arquivo, num `do $$ ... $$` dentro da transação:
RLS ligado nas duas tabelas, gatilho do agente presente, nenhuma policy de escrita em `pendencias`, anon sem
EXECUTE nas 7 RPCs, `centros_visiveis` definer com search_path.

## Testes (pglite, como a 062)
`tools/replica-local/rodar-063-pglite.mjs` sobe a base sintética (stub + 051/052/054 + stub-063) e roda
`tests/sql/test_063_redesenho_f1.sql`, que confere com dois professores (A e B) e um admin:
1. Professor A não vê pendência do centro B nem a sem centro; admin vê tudo.
2. Insert/update/delete direto em `pendencias` por professor falha; pelo agente também (051).
3. `criar_pendencia_v2` por professor falha; por admin cria; repetir a mesma chave não duplica; resolvida não
   reabre; título com CPF é recusado.
4. Filtro: admin oculta o centro B → `resumo_projetos_v2` não traz B e `ocultos = 1`; `listar_pendencias_v2`
   sem centro some com B mas mantém a sem centro; `set_filtro_visao_v2` de professor com id de centro alheio
   ignora esse id.
5. `resumo_projetos_v2`: centro sem balancete → `livre = null`, `'sem balancete'`; centro com grupo negativo →
   `'problema'`; `get_saldo_livre` que lança erro (stub) → `'sem dado'` e os outros centros continuam.
6. `get_repasses_v2` de centro alheio falha; do próprio devolve parcelas em ordem e os `recursos`.
7. Rodar a 063 duas vezes não quebra (idempotência: `create ... if not exists`, `create or replace`,
   `drop policy if exists`).
Antes da 063 o roteiro tem de falhar (prova que testa algo); depois, passar. Imprima os passos.

## Pronto quando
- `node tools/replica-local/rodar-063-pglite.mjs` verde; `npm run lint` e `npm test` verdes.
- Linha da 063 em `docs/migracoes.md` (o que cria, semântica, gotcha).
- Relatório `docs/redesenho/relatorios/F1-A.md`: o que fez, como testou, desvios do contrato, dúvidas.
- Commit na branch do worktree (conventional commit). **Sem push, sem aplicar.**

## Correções depois da revisão (18/11, dois DeepSeek, conferidas pelo Claude) — valem por cima do texto acima
1. **Filtro só do admin.** Policy de `filtro_visao`: `using (user_id = auth.uid() and is_admin())` e o mesmo
   `with check`. `set_filtro_visao_v2` levanta erro para não-admin; `centros_visiveis()` aplica o filtro só
   quando `is_admin()`. O filtro nunca autoriza nem nega nada (resolver pendência continua valendo pelo centro).
2. **`allowed_project_ids()` é vazio para admin** (033). Nunca use essa lista sozinha para admin; o critério é
   sempre `is_admin() or id = any(allowed_project_ids())`. `get_filtro_visao_v2`/`set_filtro_visao_v2` leem e
   gravam a tabela **direto** (não via `centros_visiveis`, que já subtrai os ocultos). O setter normaliza
   (`distinct`, sem `null`) e guarda só ids de projetos ativos existentes.
3. **Universo único = centros ativos**, para os dois papéis: `centros_visiveis()` já filtra `projects.active`;
   `todos` = ativos que o usuário pode ver, sem o filtro; `ocultos = count(todos) − count(centros)` (0 para
   professor). Teste com um projeto inativo.
4. **`drive_folder_url` vem `null` para não-admin** (esconder o botão não é permissão).
5. **Chave da pendência**: `unique (chave)`, e a chave sempre começa por `<tipo>:<code do centro|geral>:` e
   inclui o período quando a pendência é recorrente (ex. `bolsas:30.113:dois-planos:<hash>:2026`). Escreva isso
   no comentário da coluna.
6. **`criar_pendencia_v2(p)`** aceita `{chave, project_id, tipo, titulo, detalhe, origem}` (outras chaves são
   recusadas). `insert ... on conflict (chave) do update set titulo = excluded.titulo, detalhe =
   excluded.detalhe where pendencias.situacao = 'aberta' returning ...`; se não voltar linha, relê a existente.
   `criada = true` só no insert. CPF: `contem_cpf(chave || ' ' || titulo || ' ' || detalhe::text)` **dentro da
   RPC definer**; **nunca CHECK** (`contem_cpf` é revogada de `authenticated`, 052:208 — o erro da 061).
7. **`resolver_pendencia_v2`**: sem centro, só admin; com centro, admin ou professor do centro. Só `aberta →
   resolvida|descartada`; repetir a mesma situação devolve o estado atual; outra transição é erro.
8. **`v_balancete_vigente`**: `distinct on (project_id) ... where data_referencia is not null order by
   project_id, data_referencia desc` (sem regra de empate: `balancetes` tem `unique (project_id,
   data_referencia)`, 026). `get_repasses_v2` lê o balancete **pela view**. Registre no relatório que
   `get_saldo_livre` continua lendo `balancetes` direto e que a F2 terá de mexer nela também.
9. **`resumo_projetos_v2`**: `responsaveis` e `pendencias_abertas` saem de uma consulta agregada cada (nada de
   consulta por linha). Na falha de `get_saldo_livre`, `erro = 'falha_saldo_livre'` (código fixo, nunca
   `SQLERRM` para o navegador) e `raise warning` com o detalhe. Ordem da situação: **`'sem dado'` primeiro**,
   depois a do texto. `livre = sum(saldo_livre)` dos grupos (ignora nulos); `null` se não houver grupo.
10. **`get_repasses_v2` devolve `valor_total_plano`** (o site antigo passa `totalPlano` a
    `situacaoDasParcelas`; sem ele, plano sem valor por parcela fica todo `sem_valor`).
11. **ACL de todas as funções novas** (inclusive `centros_visiveis` e qualquer função de gatilho): `revoke
    execute ... from public, anon` + `grant ... to authenticated`; a asserção final confere por nome, não por
    contagem.
12. **Defaults de coluna** com `now()`/`gen_random_uuid()` são permitidos (a regra do cofre é sobre INSERT de
    linha com esses valores; a migração não insere linha).
13. **Idempotência de verdade**: `add column if not exists` por coluna, `drop trigger if exists` antes de
    `create trigger`, `drop constraint if exists` antes de `add constraint`; asserção de colunas e tipos no
    `do $$` final.
14. **Testes — base**: o runner instala o pglite num cache próprio (`npm install --prefix .cache/pglite-063
    --no-save @electric-sql/pglite`; o worktree não tem o `.cache` do OneDrive) e carrega `stub.sql`,
    `stub-051`, `stub-054`, 051, `stub-052`, 052, 054, **`stub-062` (professor B)**, 062, **038 e 048** (com os
    stubs que elas pedirem), e então a 063. Assim `get_saldo_livre` é a real e o "livre" é testado de verdade.
15. **Testes — falha de `get_saldo_livre`**: dentro do roteiro, numa transação desfeita no fim, troque
    `get_saldo_livre` por um invólucro que levanta erro para um id sentinela e chama a real para os outros;
    confira `'sem dado'` no sentinela e os demais intactos. **Grupo negativo** usa dados (plano + balancete
    sintéticos), não o invólucro.
16. **Testes — escrita direta**: insert em `pendencias` por professor espera SQLSTATE `42501`; update/delete
    esperam `row_count = 0` (`get diagnostics`). Para o agente, confira o gatilho no catálogo **e** tente a
    escrita com grant de teste, esperando o erro do 051.
17. **Testes do filtro**: admin oculta 1 centro, depois 2 (o primeiro continua oculto); `null` e duplicata no
    array são ignorados; professor chamando o setter recebe erro.
