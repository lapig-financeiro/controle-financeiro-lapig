# F2-E (065) — 2ª rodada (revisão MiniMax max do commit 45f1b15, 19/11, conferida pelo Claude)

Mesmo worktree, branch e arquivos da `F2-E-065.md`. Seção "2ª rodada" no relatório, commit novo. Sem push,
sem aplicar. Nenhum achado alto; corrigir:

1. **Lote de verdade**: em `explicar_livre_v2`, chame `_resolver_origens_v2` **uma vez por tabela, fora do laço
   das rubricas** (no máximo 3 chamadas por árvore), guarde o resultado e consulte por
   `(alvo_tabela, alvo_id, campo)` ao montar as folhas. Troque o subselect correlacionado da ambiguidade de
   `plano_rubricas` por um `group by (plano_id, rubrica_code, coalesce(descricao_livre,''))`. A árvore continua
   idêntica (o runner já compara). Meça no relatório o tempo antes/depois num centro sintético grande (ex.:
   320 rubricas, 960 lançamentos): não pode ficar mais lento que a 064.
2. **Caminho no ramo `documento`**: para não-admin e agente, `documento.caminho` também vira `null` (com
   `documento.nota`) quando tiver CPF, como no ramo `legado`. Teste e mutante.
3. **`search_path` exato** nas asserções: `proconfig = array['search_path=public, pg_temp']` (ou o texto
   exato que o Postgres grava), não `like 'search_path=%'`.
4. **Registrar no relatório** (sem mudar): a concatenação entre campos pode formar um CPF que não existe em
   nenhum campo (risco medido zero em linhas de balancete; mantido de propósito para pegar CPF partido); a 064
   não pode ser reaplicada depois da 065; `_cpfs` varre todas as posições e `_mascarar_cpf` é gulosa (diferença
   intencional, nenhum escape).
