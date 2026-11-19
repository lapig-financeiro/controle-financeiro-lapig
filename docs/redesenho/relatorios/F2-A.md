# Relatório F2-A — Banco da Fase 2: rastreabilidade (migração 064)

Branch: `redesenho/f2-a-banco` (worktree fora do OneDrive).

## 1. Tamanho da migração

- **`database/064_rastreabilidade.sql`**: **85.793 bytes** em UTF-8 (2.242 linhas com terminação LF; `begin;` como primeiro comando SQL e `commit;` como último), dentro do limite de 90 KB do cofre.

## 2. O que foi feito

- **Migração `database/064_rastreabilidade.sql`** (aditiva, idempotente, sem inserção de linhas e sem alterar os 6 helpers protegidos `is_agente`, `is_admin`, `allowed_project_ids`, `assert_project_allowed`, `contem_cpf`, `bloqueia_escrita_do_agente`):
  - **Tabelas novas**:
    - `public.documentos` (`id`, `project_id` FK `on delete restrict`, `tipo` em `'balancete'|'plano'`, `chave` única e não vazia, `titulo` não vazio, `criado_em`, índice `idx_documentos_project`). Comentário de coluna documentando a chave por `project_id`: `balancete:<project_id>:<AAAA-MM-DD>` e `plano:<project_id>:<plano_id>`.
    - `public.documento_versoes` (`id`, `documento_id` FK `on delete restrict`, `versao >= 1`, `sha256` 64 hex, `bucket` em `'balancete-pdfs'|'plano-trabalho-docs'`, `caminho` não vazio, `arquivo_nome`, `formato` em `'pdf'|'docx'`, `paginas` nulo quando `docx`, `parser`, `parser_versao`, `origem` em `'backfill'|'site'|'ingestao'`, `registrado_em`, `registrado_por` FK para `auth.users(id) on delete set null`), unicidades `(documento_id, versao)` e `(documento_id, sha256)`, índices `idx_documento_versoes_doc_rec` e `idx_documento_versoes_registrado_por`.
    - `public.fatos`: identificação por **chave estável** `(alvo_tabela, alvo_pai_id uuid not null, alvo_chave text not null)` em vez de `alvo_id` (porque `upsert_plano_trabalho` na 025 e `upsert_balancete` na 053 apagam e recriam as linhas filhas a cada gravação), `campo`, `valor numeric(14,2)`, `pagina` (`>= 1` ou nula), `trecho` (`1..500` caracteres não vazios), `bbox` (`{x0,x1,yMin,yMax}` numéricos ordenados ou nulo), `criado_em`, unicidade `(versao_id, alvo_tabela, alvo_pai_id, alvo_chave, campo)`, FK `versao_id on delete cascade` e índice `idx_fatos_alvo (alvo_tabela, alvo_pai_id, alvo_chave, campo)`.
    - **Sem coluna nova em `balancetes`/`planos_trabalho`**: não foi criada `documento_versao_id` (conforme correção nº 3 pós-revisão).
  - **Controle de acesso das três tabelas**: RLS ligado; `revoke all ... from public, anon, authenticated` e `grant select ... to authenticated`; exatamente **1 policy SELECT** em cada (`documentos_select_escopo` e `documento_versoes_select_escopo` por `is_admin()` ou `allowed_project_ids()`, `fatos_select_admin` estritamente `is_admin()`); nenhuma policy de escrita; gatilho `trg_bloqueia_agente` (`before insert or update or delete ... for each statement execute function public.bloqueia_escrita_do_agente()`, sem `WHEN`) nas três. Comentário explícito em tabela e cabeçalho registra que a máscara protege `fatos.trecho` entregue pela RPC, enquanto o arquivo em storage segue governado pela migração `062`.
  - **Funções auxiliares internas** (todas `security definer`, `set search_path = public, pg_temp`, `revoke all ... from public, anon, authenticated`):
    - `_tem_cpf(text)`: combina `public.contem_cpf(t)`, `public.contem_cpf` sobre dígitos com `[ \t\n\r.-]+` intermediário colapsado e blocos `3-3-3-2`, preservando a checagem de dígito verificador da 052 (ex.: `123.456.789-00` não é bloqueado; códigos de conta e datas não geram falso positivo).
    - `_mascarar_cpf(text)`: substitui sequências no formato de CPF (incluindo espaçamento/quebra de linha entre grupos) por `***.***.***-**`.
    - `_fmt_brl_num(numeric)`: formatação `pt-BR` com duas casas decimais (`1.234,50`) para rótulos de bolsas e notas de divergência.
    - `_resolver_origem_alvo(text, uuid, text, boolean)`: fonte única da regra `documento` / `legado` / `digitado`, compartilhada entre `get_origem_v2` e `explicar_livre_v2`.
  - **RPCs novas** (`security definer`, `set search_path = public, pg_temp`, `revoke all ... from public, anon`, `grant execute ... to authenticated`):
    - `registrar_documento_v2(p jsonb)`: exclusiva de admin humano (`is_admin() and not is_agente()`); recusa chaves desconhecidas (inclusive `vincular`); valida matriz `tipo × bucket × alvo_tabela × formato × paginas/pagina/bbox` e prefixo `<project_id>/` em `caminho`; bloqueia CPF via `_tem_cpf` em cada `trecho`, em `titulo`, em `arquivo_nome` e no `string_agg` entre múltiplos trechos; faz upsert por `chave` conferindo mesmo `project_id` e `tipo`; deduplica versão por `(documento_id, sha256)` devolvendo `criada = false, fatos = 0`; traduz `alvo_id` para `(alvo_pai_id, alvo_chave)`; falha atomicamente (`22023` com `detail` em JSON `[{tabela, id, campo, esperado, lido}]`) se qualquer fato apontar outro centro, não existir, tiver valor vigente nulo ou divergir do valor atual no banco.
    - `get_origem_v2(p_alvo_tabela text, p_alvo_id uuid, p_campo text)`: descobre o projeto, evita oráculo de existência para não-admin (`42501`), executa `assert_project_allowed`, mascara `trecho` para não-admin; busca o fato mais recente por `registrado_em desc, versao desc, id desc`; quando o valor atual no banco mudou após a leitura do documento (ou é nulo), rebaixa para `tipo = 'legado'` com `documento`, `busca` e `nota` `"o valor mudou depois da leitura do documento (lido R$ X)"`; para alvo sem fato gera `legado` com documento derivado de `arquivo_storage_path`/`arquivo_nome` (extensão ou padrão do tipo quando sem extensão) e objeto `busca` no formato exato de `acharAlvo`; para `scholarships.amount` retorna `digitado` com o `amount` mensal e `nota` explicativa.
    - `explicar_livre_v2(p_project_id uuid)`: executa `assert_project_allowed` e chama `get_saldo_livre(p_project_id)`; trata `has_plano = false` (`'sem plano'`), `has_balancete = false` (`'sem balancete'`) e `grupos = []` (`'sem números'`); monta a árvore raiz → `grupo:<code>` → `rubrica:<code>:previsto|realizado|comprometido` → `linha:<id>` exatamente sobre `grupos[]`, `rubricas[]`, `bolsas_ativas[]`, `balancete_id` e plano ativo (`order by versao desc limit 1`), usando `_resolver_origem_alvo` para o `tipo` das folhas; omite nó de previsto quando `valor_previsto` e total são `0`; preserva previsto negativo e estornos negativos; define `conta = 'previsto − realizado'` e `nota = 'compromissos fora de bolsas não são rastreados'` para grupos com `compromissos_cobertura = 'nenhuma'`; funciona normalmente para centros inativos quando chamado por admin.
  - **Pendências (§8 e correção nº 15)**:
    - Constraints `pendencias_chave_nao_vazia` e `pendencias_titulo_nao_vazio` atualizadas para `btrim(..., E' \t\n\r') <> ''`.
    - Criado `idx_pendencias_resolvida_por` em `pendencias(resolvida_por)`.
    - `_pendencias_sem_cpf()` passa a usar `_tem_cpf` e no `UPDATE` revalida apenas as colunas que mudaram entre `chave`, `titulo` e `detalhe`.
    - `criar_pendencia_v2(jsonb)` usa `_tem_cpf`, converte `detalhe: null` para `'{}'::jsonb`, recusa `project_id: ""` / whitespace (não transforma em pendência geral) e permite repetir chave de pendência aberta cujo centro ficou inativo, recusando centro inativo apenas ao inserir chave nova.
    - `resolver_pendencia_v2(uuid, text)` devolve erro explícito (`22023`, `'p_id é obrigatório.'`) quando `p_id` é nulo.
  - **Asserções finais na transação** (`do $$ ... $$`): RLS, ACL exata (`anon`/`PUBLIC` sem nada, `authenticated` só SELECT), 1 policy SELECT única e `trg_bloqueia_agente` habilitado (`tgenabled = 'O'`), sem `WHEN` e apontando para `'public.bloqueia_escrita_do_agente()'::regprocedure` em `documentos`, `documento_versoes`, `fatos` e `pendencias`; ausência de `documento_versao_id` em `balancetes`/`planos_trabalho`; colunas, tipos, FKs, unicidades, índices, `_pendencias_sem_cpf` e ACL/`search_path` de todas as 5 funções internas e 5 RPCs.
- **Ambiente sintético, roteiros e documentação**:
  - `tools/replica-local/sintetico/stub-064.sql`: registra documentos e fatos sintéticos (PDF e DOCX, sem PII) para `51.X` e `51.Y` exclusivamente por `registrar_documento_v2` como admin (`a1`), deixando alvos selecionados sem fato para cobrir `legado`.
  - `tests/sql/test_064_rastreabilidade.sql`: 5 blocos (`BLOCO 1` a `BLOCO 5`) cobrindo ACL/RLS/barreira do agente, validações/atomicidade/CPF de `registrar_documento_v2`, chave estável após regravação real via `upsert_plano_trabalho`/`upsert_balancete`, rebaixamento por valor alterado, desempate entre dois documentos, máscara de CPF para professor, `legado` e `digitado` em `get_origem_v2`, oráculo de `explicar_livre_v2` contra `resumo_projetos_v2` com verificador recursivo da árvore + bordas `64.EDGE` / `63.SB` / `63.SP` / `64.SN` / `63.INAT`, e todos os itens do §8 em `pendencias`.
  - `tools/replica-local/rodar-064-pglite.mjs`: sobe a base **real** (`025`, `026`, `051`, `052`, `054`, `053`, `056`, `062`, `038`, `048`, `063`), prova que `test_064` falha antes da 064, valida regras estáticas do cofre, aplica 064 + `stub-064` + `test_064`, reaplica 064 + `test_064` (idempotência), valida BLOCO 1 da 051, confere MD5 dos 6 helpers protegidos, executa 5 mutantes e roda conferência final pós-restauração. Exporta `montarBase064` e `carregarArquivo` para reaproveitamento no Vitest.
  - `tests/origem-busca-064.test.js`: suíte Vitest que testa `acharAlvo` para as 5 tabelas (`balancete_lancamentos`, `balancetes`, `planos_trabalho`, `plano_rubricas`, `plano_desembolsos`) de forma determinística (sempre ativa) e, quando `.cache/pglite-064` existe (`describe.runIf(temPglite)`), executa integração real contra `public.get_origem_v2` no PGlite alimentando `acharAlvo`.
  - `docs/migracoes.md`: adicionada a linha da `064_rastreabilidade.sql` (explicitamente marcada como **ainda não aplicada em produção**).

## 3. Como foi testado

1. **Dependências locais**:
   - `npm.cmd ci` na raiz e instalação do PGlite em `.cache/pglite-064` (`@electric-sql/pglite`, ignorado pelo git em `.cache/`).
2. **`node tools/replica-local/rodar-064-pglite.mjs`** — **verde (exit 0)**:
   - Falha antes da 064 provada: `ANTES da 064: roteiro detectou a falta da 064 (42P01) -> relation "public.documentos" does not exist`.
   - Conferência estática do cofre passou (`85793 bytes, begin;/commit; válidos, sem termos proibidos`).
   - Todos os 5 blocos de `tests/sql/test_064_rastreabilidade.sql` passaram na 1ª execução, após reaplicação idempotente da `064` e na conferência final após restauração dos mutantes.
   - BLOCO 1 da 051 (`trg_bloqueia_agente` em todas as tabelas de `public`, exceto `propostas_agente`) passou; MD5 dos 6 helpers protegidos permaneceu inalterado.
3. **`npm.cmd run lint`** (`eslint frontend/js/ mcp/ app/`) — **verde (exit 0)**.
4. **`npm.cmd test`** (`vitest run`) — **verde (exit 0)**:
   - `37 passed (37)` arquivos de teste; `575 passed | 5 skipped (580)` testes (os 5 pulados são fixtures opcionais locais pré-existentes em `tests/fixtures/pt-html/`).
5. **`.\node_modules\.bin\vitest.cmd run tests/origem-busca-064.test.js`** — **verde (exit 0)**:
   - `1 passed (1)` arquivo; `4 passed (4)` testes executados e aprovados (0 pulados), validando tanto os 3 cenários determinísticos de `acharAlvo` quanto o fluxo integrado real PGlite (`get_origem_v2` legado → `acharAlvo`) nas 5 tabelas.

## 4. Mutantes testados

Executados automaticamente na etapa 9 de `node tools/replica-local/rodar-064-pglite.mjs` e todos reprovados conforme esperado:

1. **`registrar_documento_v2` sem conferência de valor**: `064 FALHOU: divergência de valor falha com 22023 e detail em JSON`.
2. **Policy permissiva extra em `fatos` aberta a `authenticated`**: barrada pela asserção interna da `064` (`policy SELECT`) e pelo roteiro: `064 FALHOU: b1 não lê nenhuma linha direta de fatos`.
3. **`get_origem_v2`/`_resolver_origem_alvo` sem máscara de CPF**: `064 FALHOU: professor recebe trecho com CPF pontuado e espaçado mascarado: TOTAL CRÉDITOS 315.000,00 ref 529.982.247-25 e 529 982 247 25`.
4. **`trg_bloqueia_agente` em `pendencias` apontando para função dummy (mesmo nome)**: barrada pela asserção `tgfoid` da `064` e pelo roteiro: `064 FALHOU: policy SELECT única e trg_bloqueia_agente ativo/sem WHEN/função certa em pendencias`.
5. **`get_origem_v2`/`_resolver_origem_alvo` não rebaixando para `legado` quando valor muda**: `064 FALHOU: valor alterado após leitura devolve legado com nota do valor lido, documento e busca`.

## 5. Desvios do contrato

- **Sem desvios do contrato**: assinaturas, parâmetros, nomes de nós/campos e chaves de retorno de `registrar_documento_v2`, `get_origem_v2`, `explicar_livre_v2`, `documentos`, `documento_versoes` e `fatos` seguem integralmente o contrato da tarefa e todas as 18 correções pós-revisão de `docs/redesenho/tarefas/F2-A-banco.md`.
- **Arquivo acrescentado à lista conforme correção nº 14**: criado `tests/origem-busca-064.test.js` para exercitar `acharAlvo` sobre o `busca` retornado por `get_origem_v2`.

## 6. Dúvidas e itens em aberto

- **Produção e push**: conforme regra da tarefa, nada foi aplicado em produção nem enviado com `git push`. A migração aguarda revisão independente, `ensaiar` no cofre, aprovação explícita do Victor no chat e `aplicar` com o site em manutenção.
- **Backfill e documentação de junção**: o backfill de documentos/fatos fica para a tarefa F2-B (usando `registrar_documento_v2`), e a atualização de `docs/redesenho/ESTADO.md` e `README.md` fica para a junção.
- **Execução na CI vs. ambiente local**: `.github/workflows/ci.yml` instala apenas dependências raiz (`npm ci`), sem `@electric-sql/pglite`; por isso `tests/origem-busca-064.test.js` roda os testes determinísticos de `acharAlvo` sempre e condiciona o bloco integrado com PGlite (`describe.runIf(temPglite)`) à presença de `.cache/pglite-064`. Como na F1-A, o PGlite valida Postgres, PL/pgSQL e RLS puros, sem a camada HTTP do PostgREST.
