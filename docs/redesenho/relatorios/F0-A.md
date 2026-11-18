# Relatório F0-A — Fechar a leitura dos arquivos por centro de custo

## 1. Levantamento dos três buckets (`.sql`, `frontend/js/`, `mcp/src/`)

Todos os três buckets são privados (`public = false`) e possuem RLS habilitado em `storage.objects`. Até a migração `061`, nenhuma migração havia restringido o acesso humano por centro de custo nas policies permissivas desses buckets:

| Bucket | Criação / policies pré-062 | Quem faz upload / leitura / remoção | Ordem upload × tabela | Formato do caminho |
|---|---|---|---|---|
| `plano-trabalho-docs` | `database/025_plano_trabalho.sql` (linhas 296–323): `plano_docs_auth_select`, `_insert`, `_update`, `_delete` com `bucket_id = 'plano-trabalho-docs'` para qualquer `authenticated`. `052` barrou leitura do `agente` (`agente_le_so_buckets_sem_pii`); `051` barrou escrita do `agente`; `054` barrou tudo da `automacao`. | **Upload:** humano (`admin`/`professor`) em `frontend/js/pages/plano-trabalho.js` (`salvarPlano`, linhas 1317–1323). **Leitura:** `plano-trabalho.js` (`docPlano` linha 468; `baixar` linha 1049) e `planejamento.js` (`abrirCronograma`, linha 1199). **Remoção:** `plano-trabalho.js` (`excluir` linha 1038 e rollback de falha de RPC na linha 1327). **MCP:** não sobe aqui (usa `propostas-agente`, `mcp/src/buriti.js:135`). | Upload no Storage acontece **antes** de `upsert_plano_trabalho`. | `` `${targetProjectId}/${Date.now()}_${safeName}` `` — começa com `<project_id>/`. |
| `balancete-pdfs` | `database/026_balancetes.sql` (linhas 224–244): `balancete_auth_select`, `_insert`, `_update`, `_delete` com `bucket_id = 'balancete-pdfs'` para qualquer `authenticated`. `051` barrou escrita do `agente`; `052` manteve `SELECT` do `agente` neste bucket (ainda sem escopo de centro); `054` barrou tudo da `automacao`. | **Upload:** humano (`admin`/`professor`) em `frontend/js/pages/plano-trabalho.js` (`salvarBalancete`, linhas 1436–1442). **Leitura:** `plano-trabalho.js` (`docBalancete` linha 458; `baixarBalancete` linha 1133) e `planejamento.js` (linhas 1106 e 1184). **Remoção:** `plano-trabalho.js` (`excluirBalancete` linha 1122 e rollback de falha de RPC na linha 1446). **MCP:** não sobe aqui (usa `propostas-agente`, `mcp/src/buriti.js:82`). | Upload no Storage acontece **antes** de `upsert_balancete`. | `` `${targetProjectId}/${Date.now()}_${safeName}` `` — começa com `<project_id>/`. |
| `bolsa-planilhas` | `database/031_reconciliacoes.sql` (linhas 60–80): `bolsa_auth_select`, `_insert`, `_update`, `_delete` com `bucket_id = 'bolsa-planilhas'` para qualquer `authenticated`. `052` barrou leitura do `agente` (planilha tem CPF); `051` barrou escrita do `agente`; `054` barrou tudo da `automacao`. | **Upload:** humano (`admin`/`professor`) em `frontend/js/pages/holders.js` (linhas 1538–1544). **Leitura:** `planejamento.js` (`abrirPlanilha`, linha 1235). **MCP:** não acessa (barrado por `051`/`052`). | Upload no Storage acontece **antes** do `insert` em `reconciliacoes` (linhas 1540–1561). | `` `${projectId}/${Date.now()}_${safeName}` `` — começa com `<project_id>/`. |

**Observação sobre `propostas-agente`:** criado na `051_buriti_propostas_do_agente.sql` (linhas 182–200), já nasceu escopado com `(public.is_admin() or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[]))`.

## 2. O que foi feito

- Criada a migração `database/062_arquivos_por_centro.sql`:
  - Remove as 12 policies permissivas abertas da `025`, `026` e `031` (`plano_docs_auth_*`, `balancete_auth_*`, `bolsa_auth_*`).
  - Cria 12 policies escopadas (`plano_docs_escopo_*`, `balancete_escopo_*`, `bolsa_escopo_*`) para `SELECT`, `INSERT`, `UPDATE` (`using` e `with check`) e `DELETE` em `storage.objects` para `authenticated`, exigindo `public.is_admin() or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])`.
  - Como o caminho nos três buckets começa por `<project_id>/` e o upload precede a inserção na tabela, o escopo por `(storage.foldername(name))[1]` preserva integralmente o upload de professores no próprio centro sem depender de linha prévia em `planos_trabalho`, `balancetes` ou `reconciliacoes`.
  - Não altera `is_admin`, `allowed_project_ids`, `assert_project_allowed`, `is_agente`, `contem_cpf` ou `bloqueia_escrita_do_agente`.
  - Mantém intactas as policies restritivas `051` (`agente_so_no_bucket_dele_*`), `052` (`agente_le_so_buckets_sem_pii`) e `054` (`automacao_sem_storage`). Como efeito colateral desejado, o agente também deixa de enxergar `balancete-pdfs` de centros fora do seu `allowed_project_ids()`.
  - Segue as regras do cofre (`begin;` na primeira linha de comando, `commit;` na última, asserções dentro da transação, sem palavras proibidas).
- Criado o roteiro autoconferido `tests/sql/test_062_arquivos_por_centro.sql` (7 blocos em `begin`/`rollback`).
- Criados o stub `tools/replica-local/sintetico/stub-062.sql` (reproduzindo as 12 policies abertas da `025`/`026`/`031` e objetos em `51.X`, `51.Y` e raiz) e o executor descartável `tools/replica-local/rodar-062-pglite.mjs`.
- Atualizado `docs/migracoes.md` com o resumo da `062_arquivos_por_centro.sql`.

## 3. O que foi testado

1. **Banco sintético em PGlite (`node tools/replica-local/rodar-062-pglite.mjs`):**
   - Base carregada: `stub.sql`, `stub-051.sql`, `stub-054.sql`, `051`, `stub-052.sql`, `052`, `054`, `stub-062.sql`.
   - **Antes da 062:** `tests/sql/test_062_arquivos_por_centro.sql` falhou no BLOCO 1 (`062 FALHOU: professor A leu arquivo do centro B no bucket bolsa-planilhas`), provando o defeito.
   - **Depois da 062:** todos os 7 blocos do `test_062_arquivos_por_centro.sql` passaram:
     - BLOCO 1: professor A (`51.X`) lê só `51.X`; não lê `51.Y` nem objetos na raiz nos 3 buckets.
     - BLOCO 2: upload sem linha prévia em tabela, troca (`update`) e exclusão (`delete`) do professor A funcionam em `51.X`; `insert`, `update` (mover `51.X -> 51.Y` ou alterar `51.Y`), `delete` em `51.Y` e upload na raiz falham.
     - BLOCO 3: professor B (`51.Y`) lê só `51.Y`, não lê `51.X`.
     - BLOCO 4: admin continua lendo, inserindo, trocando e excluindo em `51.X`, `51.Y` e raiz nos 3 buckets.
     - BLOCO 5: agente (`c1`, escopo `51.X`) segue bloqueado em `bolsa-planilhas` e `plano-trabalho-docs` (`052`), lê `balancete-pdfs` só de `51.X` (não de `51.Y`), segue sem escrita nos 3 buckets (`051`) e mantém `propostas-agente` escopado.
     - BLOCO 6: automação (`d1`) segue barrada em `storage.objects` (`054`).
     - BLOCO 7: `anon` sem privilégios em `storage.objects`.
   - **Regressão e integridade:** `tests/sql/test_052_privacidade_bolsistas.sql` passou após a `062`; os 6 helpers protegidos permaneceram com MD5 idêntico; reaplicar `database/062_arquivos_por_centro.sql` e reexecutar `test_062` passou (idempotência).
   - *Limitação conhecida do ambiente local:* PGlite testa Postgres/RLS puro (não testa a camada HTTP do Storage API / PostgREST).
2. **Lint e testes Node:**
   - `npm.cmd run lint` (ESLint em `frontend/js/` e `mcp/`): verde (exit 0).
   - `npm.cmd test` (Vitest): 36 arquivos, 576 testes passando.
3. **Regras do cofre em `database/062_arquivos_por_centro.sql`:**
   - Conferido tamanho (9.562 bytes, limite 90 KB) e ausência de tokens proibidos.

## 4. O que ficou em aberto e desvios

- **Em aberto:** revisão técnica por outra IA, `ensaiar` no cofre, aprovação explícita do Victor no chat, manutenção ligada e aplicação em produção (`aplicar`), conforme fluxo de `docs/aplicar-migracao.md` (não executados por regra da tarefa). Também não foi feito commit nem alterada nenhuma linha em `app/`.
- **Desvios:** além de `tools/replica-local/sintetico/stub-062.sql`, foi criado `tools/replica-local/rodar-062-pglite.mjs` em `tools/replica-local/` seguindo exatamente o padrão das migrações `054`–`061` para executar o stub e o roteiro no PGlite.

## Conferência do Claude e revisão de dois DeepSeek V4.1 high (18/11/2026)

- Os dois revisores (um com o projeto, um cego) **não acharam caminho** para um professor ler, gravar, mover ou
  apagar arquivo de outro centro.
- Inventário em produção (só leitura, login admin): `plano-trabalho-docs` 17 pastas de projeto, `balancete-pdfs` 19,
  `bolsa-planilhas` 9; **nenhum item fora do padrão `<id-do-projeto>/…`**. O risco de arquivo antigo sumir não existe.
- Asserções reforçadas pelo Claude: nenhuma outra policy permissiva alcança os três buckets (nem sem filtro de bucket);
  os três buckets seguem privados; as 12 policies novas contêm `allowed_project_ids`; as três restritivas de escrita
  do agente (051) existem. Teste em PGlite verde depois disso.
- Aceito sem mudança: troca de bucket dentro do mesmo centro pelo `update` (não cruza centro; o Storage API não faz);
  `is_admin`/`allowed_project_ids` voláteis (custo pequeno; são funções protegidas pelo cofre); a asserção de policy
  sem `bucket_id` pode abortar por policy alheia — falha segura, aparece no ensaio.
- O MCP lê com login de usuário (anon + JWT), não com credencial que ignora RLS. O Buriti lê o PDF do disco local,
  não do bucket.
