# Relatório F1-A — Banco da Fase 1 (migração 063)

Branch: `redesenho/f1-a-banco` (worktree fora do OneDrive).

## 1. O que foi feito

- **Migração `database/063_redesenho_f1.sql`** (36.573 bytes, `begin;` no primeiro comando e `commit;` no último, sem inserção de dados, sem alterações nos 6 helpers protegidos e totalmente idempotente):
  - **`public.pendencias`**: lista única de pendências (por projeto ou gerais com `project_id = null`), `unique (chave)` com documentação da convenção `<tipo>:<code do centro|geral>:` (+ período quando recorrente), índice parcial `idx_pendencias_project_abertas` em `(project_id) where situacao = 'aberta'`, RLS ligado, `revoke all ... from public, anon, authenticated` + `grant select ... to authenticated`, policy de leitura `pendencias_select_escopo` (`is_admin() or (project_id is not null and project_id = any(allowed_project_ids()))`), **nenhuma** policy de escrita e gatilho `trg_bloqueia_agente` (051). CPF é barrado dentro de `criar_pendencia_v2` (`security definer`), nunca em CHECK (pois `contem_cpf` foi revogada de `authenticated` na 052).
  - **`public.filtro_visao`**: preferência de apresentação exclusiva do admin (`user_id` PK, `centros_ocultos uuid[]`, `atualizado_em`), RLS `user_id = auth.uid() and is_admin()` (leitura e escrita), `revoke ... from public, anon`, gatilho `trg_bloqueia_agente`. Nunca autoriza nem nega permissão, e o site antigo não a lê.
  - **`public.centros_visiveis()`**: `returns setof uuid`, `stable`, `security definer` (`set search_path = public, pg_temp`), `revoke ... from public, anon`, `grant execute ... to authenticated`. Universo único de centros com `projects.active = true`, aplicando `filtro_visao` **somente** quando `is_admin()` e `allowed_project_ids()` para não-admin.
  - **`public.v_balancete_vigente`**: view `with (security_invoker = true)`, `distinct on (project_id) ... where data_referencia is not null order by project_id, data_referencia desc` (aproveitando `unique (project_id, data_referencia)` da 026), colunas `project_id, balancete_id, data_referencia, saldo_disponivel, rendimento_liquido`, `revoke ... from public, anon`, `grant select ... to authenticated`.
  - **7 RPCs `_v2`** (todas `security definer`, `set search_path = public, pg_temp`, `revoke ... from public, anon`, `grant execute ... to authenticated`):
    - `resumo_projetos_v2()`: percorre `centros_visiveis()`, agrega `responsaveis` (apenas `role = 'professor'` com `display_name` preenchido, apenas para admin) e `pendencias_abertas` em uma consulta agregada cada; chama `get_saldo_livre(id)` dentro de `begin ... exception` devolvendo `'sem dado'`, `livre = null` e `erro = 'falha_saldo_livre'` (código fixo, `SQLERRM` vai só para `raise warning`) sem derrubar a lista; `livre = sum(grupos[].saldo_livre)` ignorando nulos (`null` sem grupos, sem plano ou sem balancete); situação na ordem `'sem dado'` → `'sem plano'` → `'sem balancete'` → `'problema'` → `'atenção'` → `'em dia'`; `drive_folder_url` vem `null` para não-admin; `todos` e `ocultos` trazem todos os centros ativos para admin (`[]` e `0` para não-admin).
    - `listar_pendencias_v2(p_project_id uuid default null)`: abertas primeiro, depois resolvidas/descartadas dos últimos 90 dias; com `p_project_id` usa `assert_project_allowed`; sem ele lê `centros_visiveis()` mais pendências sem centro (`is_admin()`).
    - `resolver_pendencia_v2(p_id uuid, p_situacao text)`: bloqueia agente; valida `'resolvida'`|`'descartada'`; sem centro exige admin, com centro usa `assert_project_allowed` (independente do filtro de visão); idempotente ao repetir a mesma situação; erro em transição a partir de já fechada; grava `resolvida_em = now()` e `resolvida_por = auth.uid()`.
    - `criar_pendencia_v2(p jsonb)`: só admin humano na F1; recusa chaves fora de `{chave, project_id, tipo, titulo, detalhe, origem}`; valida `contem_cpf(chave || ' ' || titulo || ' ' || detalhe::text)`; faz upsert idempotente atualizando título/detalhe apenas se `aberta` e devolvendo a existente sem reabrir se fechada (`criada = true` só no insert).
    - `get_filtro_visao_v2()`: lê direto de `filtro_visao` (sem passar por `centros_visiveis()`); devolve `{ centros_ocultos: [] }` quando vazio ou não-admin.
    - `set_filtro_visao_v2(p_centros_ocultos uuid[])`: erro (`42501`) para não-admin; normaliza (`distinct`, sem nulos) filtrando apenas ids existentes de `projects` com `active = true`.
    - `get_repasses_v2(p_project_id uuid)`: leitura pura com `assert_project_allowed`; devolve `parcelas` em ordem do plano ativo, `valor_total_plano`, `data_balancete` e `recursos` lidos via `v_balancete_vigente`.
  - **Asserções dentro da transação** (`do $$ ... $$`): RLS, `trg_bloqueia_agente`, ausência de policy de escrita e de CHECK com `contem_cpf` em `pendencias`, `security_invoker = true` em `v_balancete_vigente`, privilégios de `anon`/`authenticated`, colunas e tipos exatos nas tabelas/view e conferência por nome de todas as 8 funções novas (definer, `search_path`, `authenticated` com EXECUTE, `anon`/`PUBLIC` sem EXECUTE).
- **Testes e ambiente sintético**:
  - `tools/replica-local/sintetico/stub-063.sql`: complementa `stub.sql` com colunas reais ausentes (`drive_folder_url`, `valor_total_plano`, `data_texto`, `valor_texto`), RLS admin-only em `plano_desembolsos`, e cenários sintéticos para `51.X` (`em dia`, 2 balancetes, parcelas fora de ordem), `51.Y` (`problema` por grupo negativo real com total positivo e dois responsáveis), `63.SB` (`sem balancete`, parcela sem valor), `63.SP` (`sem plano`), `63.DEF` (`atenção` por defasagem ≥ 2) e `63.INAT` (`active = false` no escopo do professor `b1`).
  - `tests/sql/test_063_redesenho_f1.sql`: roteiro autoconferido em 7 blocos cobrindo todas as regras e casos de borda.
  - `tools/replica-local/rodar-063-pglite.mjs`: sobe a base sintética com `stub`, `stub-051`, `stub-054`, `051`, `stub-052`, `052`, `054`, `stub-062`, `062`, `038`, `048`, `stub-063`; prova a falha antes da 063; valida regras do cofre; roda a 063 e `test_063` duas vezes (idempotência); valida BLOCO 1 da 051 e MD5 dos 6 helpers protegidos.
- **Documentação**:
  - Adicionada a linha da `063_redesenho_f1.sql` em `docs/migracoes.md`.

## 2. Como foi testado

1. **`npm.cmd ci`** na raiz e instalação do PGlite em `.cache/pglite-063` (`@electric-sql/pglite`).
2. **`node tools/replica-local/rodar-063-pglite.mjs`** — **verde (exit 0)**:
   - Roteiro `tests/sql/test_063_redesenho_f1.sql` falhou antes da 063 (`42883` em `public.criar_pendencia_v2(jsonb)`).
   - Verificação estática do cofre passou (`36573` bytes < 90 KB, `begin;`/`commit;` válidos, sem termos proibidos).
   - Todos os 7 blocos do `test_063_redesenho_f1.sql` passaram (incluindo escrita direta em `pendencias`/`filtro_visao` para professor e agente com grant de teste, invólucro de erro em `get_saldo_livre` no id sentinela `51.X` sem vazar `SQLERRM`, grupo negativo real em `51.Y`, projeto inativo `63.INAT`, normalização e ocultação cumulativa de 1 e 2 centros no filtro).
   - Reaplicar `database/063_redesenho_f1.sql` e reexecutar `test_063_redesenho_f1.sql` passou (idempotência).
   - BLOCO 1 da 051 (`trg_bloqueia_agente` em todas as tabelas de `public`, exceto `propostas_agente`) passou; MD5 dos 6 helpers protegidos permaneceu idêntico.
3. **`npm.cmd run lint`** (`eslint frontend/js/ mcp/ app/`) — **verde (exit 0)**.
4. **`npm.cmd test`** (`vitest run`) — **verde (exit 0)**: 36 arquivos passaram, 571 testes passaram e 5 testes pulados (fixtures opcionais locais ausentes em `tests/fixtures/pt-html/`).

## 3. Desvios do contrato e notas para a F2

- **Sem desvios do contrato**: assinaturas, nomes e chaves de retorno de `resumo_projetos_v2`, `listar_pendencias_v2`, `resolver_pendencia_v2`, `criar_pendencia_v2`, `get_filtro_visao_v2`, `set_filtro_visao_v2`, `get_repasses_v2`, `centros_visiveis`, `v_balancete_vigente`, `pendencias` e `filtro_visao` seguem integralmente a especificação e as 17 correções de `docs/redesenho/tarefas/F1-A-banco.md`.
- **Nota obrigatória para a F2**: `get_repasses_v2` lê o balancete vigente pela view `public.v_balancete_vigente`, mas **`get_saldo_livre` (038/048) continua lendo `public.balancetes` direto** na F1. Quando a F2 versionar os balancetes e trocar o corpo de `v_balancete_vigente`, terá de atualizar `get_saldo_livre` também.

## 4. O que ficou em aberto

- **Aplicação em produção pelo cofre**: não executada (regra da tarefa). Ficam para o fluxo normal (`docs/aplicar-migracao.md`): revisão do SQL por outra IA, `ensaiar` no cofre, aprovação explícita do Victor no chat e `aplicar` com o site em manutenção.
- **Limitação do ambiente local**: PGlite valida Postgres, PL/pgSQL e RLS puros, sem a camada HTTP do PostgREST.
