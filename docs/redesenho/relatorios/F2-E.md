# Relatório F2-E — Migração 065: ajustes da 064 antes do backfill

Branch: `redesenho/f2-e-065` (worktree `C:/Users/amara/dev/cf-f2-e`, fora do OneDrive).
**Nada foi aplicado em produção e nada foi enviado com `git push`.**

Este relatório cobre a entrega original e a **2ª rodada** (revisão MiniMax max do commit `45f1b15`, conferida pelo Claude, 19/11), registrada na seção própria depois do item 2.9.

## 1. Tamanho dos arquivos

| Arquivo | Bytes | Linhas |
|---|---:|---:|
| `database/065_rastreabilidade_ajustes.sql` | **74.313** | 1.774 |
| `tests/sql/test_065_rastreabilidade_ajustes.sql` | **31.982** | 737 |
| `tools/replica-local/rodar-065-pglite.mjs` | **28.541** | 687 |

A migração está abaixo do limite de 90 KB do cofre, começa com `begin;` como primeiro comando SQL e termina com `commit;` como último; não contém `commit`/`savepoint` no meio, nem os termos proibidos (`password`, `service_role`, `net.`, `http(`, `dblink`, `cron.`, `vault.`, `create extension`, `concurrently`, `vacuum`, `copy`, `set role`, `alter default privileges`…).

## 2. O que foi feito

Só `create or replace` de funções da 064 e ajustes de asserção. **Nenhuma tabela nova, nenhuma coluna nova, nenhuma linha inserida.** As funções antigas do site (`upsert_balancete`, `upsert_plano_trabalho`, `get_saldo_livre`, `resumo_projetos_v2`…) não foram tocadas; os seis helpers protegidos (`is_agente`, `is_admin`, `allowed_project_ids`, `assert_project_allowed`, `contem_cpf`, `bloqueia_escrita_do_agente`) também não.

### 2.1. Item 1 — regra de CPF única (gramática final)

A 065 substitui a regra da 064 por **uma só**, usada por `_tem_cpf`, `_mascarar_cpf` e `_cpfs` (a remoção de 1–3 caracteres quaisquer da 064 saiu; ela fundia números vizinhos e escondia o CPF):

> Um texto **tem CPF** quando `contem_cpf(texto)` (052) é verdadeiro **ou** quando existe um **candidato**: 11 dígitos em quatro grupos de **3-3-3-2 dígitos contíguos**, sem dígito colado antes do primeiro grupo nem depois do último, separados por **vãos de 0 a 6 caracteres que não são dígito nem letra** (qualquer espaço ou pontuação Unicode: ponto, vírgula, traço, travessão, barra, NBSP, quebra de linha…), e os 11 dígitos passam no dígito verificador (o mesmo cálculo de `contem_cpf`; 11 dígitos iguais não são CPF). **Letra no vão quebra o candidato.** Procura-se candidato a partir de **cada** posição de início possível, não só nos achados sem sobreposição, para um número vizinho não roubar dígitos do CPF.

Implementação:
- `_cpf_candidato(t, p_inicio)` (novo helper `immutable`, `security definer`, `search_path`, sem grant): devolve o fim (1-based) do candidato que começa em `p_inicio` ou `null`. Confere os grupos 3-3-3-2, o vão de 0 a 6, a fronteira de dígito dos dois lados e letra no vão (inclusive acentuada, por `upper(x) <> lower(x)`); **não** confere o DV.
- `_tem_cpf`: `contem_cpf(t)` ou varre **cada** posição e, para cada candidato estrutural, aplica `contem_cpf` aos 11 dígitos.
- `_mascarar_cpf`: uma passada da esquerda para a direita; só troca candidato cujo DV é válido por `***.***.***-**`. Não mascara 11 dígitos quaisquer, nem DV inválido, nem formato 4-4-3.
- `_cpfs`: varre cada posição, devolve os 11 dígitos de cada candidato com DV válido, na ordem e sem repetir.

Casos conferidos (as mesmas strings na F2-B): verdades `529.982.247-25`, `52998224725`, `529 982 247 25`, `529/982/247/25`, `529,,,,,982,,,,,247,,,,,25`, NBSP, en dash, `1.234,56 NOME 529.982.247-25`, `100 529.982.247-25`; falsidades `123.456.789-00`, `111.111.111-11`, `529982247250`, `7.1.3.05.01.00042 2506042`, a linha de balancete `7.1.3.04.01.09142 09142 BOLSA DOACAO PESQUISA 380.000,00 0,00 380.000,00`, `rubrica 529 e 982 com valor 247,25`, o JSON `{"saldo": 1107372.93, ...}`, 7 vírgulas no vão e `5299 8224 725` (4-4-3).

### 2.2. Item 2 — máscara só com DV válido

A máscara usa a mesma regra do item 1 e só troca candidato com DV válido. `_mascarar_cpf('123.456.789-00')` devolve o texto intacto. `_tem_cpf(_mascarar_cpf(x))` é falso para todos os verdadeiros e `_mascarar_cpf(x) = x` para todos os falsos.

### 2.3. Item 3 — caminho com CPF (ramos `legado` e `documento`)

Para não-admin e agente, no `legado`, `arquivo_nome` continua mascarado; se o **caminho** (o nome de arquivo dentro dele) tem CPF, `documento.caminho` sai `null` e **`documento.nota`** recebe `"arquivo com nome que parece CPF: peça ao admin"`. A nota fica **dentro de `documento`**, não na `nota` do topo; por isso a árvore de `explicar_livre_v2` não muda. Sem CPF, nada muda (o caminho continua cru). Admin continua vendo `arquivo_nome` e `caminho` crus e sem `documento.nota` (a chave nem aparece).

Na 2ª rodada, a mesma regra passou a valer no ramo **`documento`** (quando há fato conferido, cujo caminho vem de `documento_versoes.caminho`): para não-admin e agente, `documento.caminho` também vira `null` e `documento.nota` recebe a mesma mensagem. Admin continua vendo o caminho cru.

### 2.4. Item 4 — `criar_pendencia_v2` só recusa CPF novo

Pendência **nova** continua recusando qualquer CPF com `22023` (a checagem foi movida para depois do `select … for update` e do retorno da existente). Pendência **existente** não faz checagem prévia: o `UPDATE` dispara `_pendencias_sem_cpf` e o gatilho decide (`23514`) se o CPF é novo em relação à linha antiga. Assim é possível limpar um CPF legado do `detalhe` mantendo o mesmo título que já tinha CPF (ou remover o CPF do título), sem que a RPC recuse a atualização.

### 2.5. Item 5 — `explicar_livre_v2` em lote

Nova função interna `_resolver_origens_v2(p_alvos jsonb, p_mascarar boolean)` (`stable`, `security definer`, `search_path = public, pg_temp`, sem grant, revogada de `public, anon, authenticated`): recebe um conjunto de `{alvo_tabela, alvo_id, campo}`, resolve os alvos por tabela numa consulta só e junta com `fatos`/`documento_versoes`/`documentos` com `distinct on` e a mesma ordem da 064 (`registrado_em desc`, `versao desc`, `id desc`). Devolve uma linha por alvo pedido (origem `null` quando o alvo não resolve). A parte comum (documento/legado/digitado, busca, ambiguidade, máscara, nota de valor alterado e nota de caminho com CPF) ficou só nela; `_resolver_origem_alvo` virou um invólucro de um alvo sobre essa função, então a regra é uma só.

`explicar_livre_v2` monta três conjuntos (previstos do plano ativo, realizados do balancete usado por `get_saldo_livre`, bolsas com compromisso ≠ 0) e faz **exatamente uma chamada por tabela, fora do laço das rubricas** (no máximo 3 por árvore). O resultado de cada chamada fica guardado como um objeto `jsonb` indexado por `(alvo_tabela, alvo_id, campo)` e é consultado diretamente ao montar cada folha; não há `left join` com a função dentro do laço. Na 2ª rodada, o subselect correlacionado que contava a ambiguidade de `plano_rubricas` foi trocado por um `group by (plano_id, rubrica_code, coalesce(descricao_livre, ''))`, calculado uma vez. A árvore foi comparada antes/depois da 065 em 10 árvores sintéticas (admin para os 7 centros; professor e agente em 51.X; professor em 63.INAT) e saiu **idêntica em JSON**. No centro sintético grande (320 rubricas, 960 lançamentos), o tempo caiu de **716 ms (mediana) na 064 para 547 ms na 065** (ver seção "2ª rodada").

### 2.6. Item 6 — `registrar_documento_v2` com conflito claro

O `select … for update` em `documentos` antes de `max(versao)+1` foi mantido (correção pós-revisão). O `insert` em `documento_versoes` ganhou `exception when unique_violation` e devolve `40001` com `"Conflito ao gravar a versão % do documento; tente novamente."`. O resto da função é o da 064, sem mudança de comportamento.

### 2.7. Item 7 — mensagem de alvo nulo unificada

Em `get_origem_v2`, para **não-admin** (professor e agente), `p_alvo_tabela`, `p_alvo_id` ou `p_campo` nulos devolvem o mesmo `42501` e a mesma mensagem `"Acesso negado ao alvo."` dos casos já unificados (alvo alheio/inexistente). Admin mantém `22023` com `"alvo_tabela, alvo_id e campo são obrigatórios."`. A mensagem e o SQLSTATE dos casos já unificados não mudaram.

### 2.8. Item 8 — asserção de policy com nomes

A asserção da 065, quando uma tabela tem ≠ 1 policy, lista as que sobraram: `065: documentos deve ter exatamente 1 policy (sobraram: documentos_select_escopo, policy_extra_065)`. O mutante com policy extra confirma a mensagem.

### 2.9. Item 9 — registrado, não corrigido

- **Chave estável de `plano_rubricas`**: é `rubrica_code || '|' || coalesce(descricao_livre, '')`; editar a descrição do item muda a chave, e a folha volta a `legado` em silêncio (não é desta migração; fica anotado).
- **`get_saldo_livre` (048)**: o CTE `base` filtra `coalesce(p.v, 0) > 0 or coalesce(rr.v, 0) > 0 or (r.code = 'a.bolsas' and v_compromissos > 0)`; uma rubrica que só tenha previsto negativo (com realizado ≤ 0) ou só estorno (saldo_atual < 0, com previsto ≤ 0) é ignorada. Número pré-existente, fora do escopo da 065; `explicar_livre_v2` continua batendo com `resumo_projetos_v2` porque ambos herdam a 048.

## 2ª rodada — revisão MiniMax max do commit `45f1b15` (19/11, conferida pelo Claude)

Nenhum achado alto. Os quatro pontos foram atendidos; o runner, o `test_065` e o benchmark foram ampliados.

### 2ª rodada.1. Lote de verdade em `explicar_livre_v2`

Em `explicar_livre_v2`, `_resolver_origens_v2` passou a ser chamada **uma vez por tabela, fora do laço das rubricas** — no máximo 3 chamadas por árvore, contra 3 por rubrica antes. Cada resultado é agregado em um objeto `jsonb` com chave `alvo_tabela|alvo_id|campo`; as folhas consultam essa chave diretamente, sem `left join` com a função. Na mesma função, o subselect correlacionado que decidia a ambiguidade de `plano_rubricas` virou um `group by (plano_id, rubrica_code, coalesce(descricao_livre, ''))`, calculado uma vez no CTE `amb`.

**Benchmark** (centro sintético com 320 rubricas, 960 lançamentos; mediana de 3 execuções; criação das linhas fora do tempo medido):

| Versão de `explicar_livre_v2` | Medidas (ms) | Mediana | Árvore |
|---|---:|---:|---:|
| 064 | 676, 716, 811 | **716 ms** | 493.509 bytes |
| 065 (2ª rodada) | 546, 547, 586 | **547 ms** | 493.509 bytes |

A árvore do centro grande saiu idêntica (493.509 bytes nas duas) e o runner falha se a 065 ficar mais lenta que a 064. A 065 ficou ~24% mais rápida neste cenário; o ganho é limitado porque o resto da montagem da árvore (640 consultas por rubrica) domina o tempo.

### 2ª rodada.2. Caminho no ramo `documento`

Para não-admin e agente, no ramo `documento` (fato conferido; caminho vindo de `documento_versoes.caminho`), `documento.caminho` também vira `null` quando tem CPF, com `documento.nota = "arquivo com nome que parece CPF: peça ao admin"`. Admin continua vendo o caminho cru e sem a chave `nota`. O `test_065` cobre b1, c1 e admin, confere que a folha da árvore continua `documento` com `nota` nula, e o runner tem o mutante `2b` (caminho do ramo `documento` volta cru).

### 2ª rodada.3. `search_path` exato

As asserções da 065 passaram de `like 'search_path=%'` para `p.proconfig = array['search_path=public, pg_temp']::text[]`, o valor exato que o Postgres grava para `set search_path = public, pg_temp`. O `test_065` também exige o array exato em `_resolver_origens_v2`. O runner aplica uma sonda em que a definição de `_resolver_origens_v2` usa `search_path = public` e confirma que a própria 065 falha (`065: função interna public._resolver_origens_v2(jsonb, boolean) sem security definer ou search_path`).

### 2ª rodada.4. Registrado, sem mudar

- **Concatenação entre campos**: `_tem_cpf` pode formar um CPF que não existe em nenhum campo isolado (por exemplo, dígitos no fim de um campo + dígitos no começo do seguinte). O risco medido em linhas de balancete é zero; a concatenação foi mantida de propósito para pegar CPF partido entre campos.
- **064 depois da 065**: a 064 **não pode ser reaplicada** depois da 065 (as asserções antigas da própria 064, com `'5299 8224 725'` e vão de 9 caracteres, falham com a gramática nova). A produção já tem a 064; a ordem correta é 064 → 065. Um replay completo futuro precisa pular/substituir essas asserções ou aplicar a 065 antes do bloco de asserção da 064.
- **`_cpfs` e `_mascarar_cpf`**: `_cpfs` varre **todas** as posições de início (para um número vizinho não roubar dígitos) e `_mascarar_cpf` é gulosa da esquerda para a direita. A diferença é intencional (a máscara não precisa listar todos os candidatos sobrepostos) e não há escape: os candidatos válidos que se sobrepõem ao primeiro trecho mascarado são descartados na saída.

## 3. Como foi testado

1. **Dependências**: `npm ci` na raiz (174 pacotes) e PGlite em `.cache/pglite-064` (mesmo caminho do runner da 064):
   `npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite`.
2. **`node tools/replica-local/rodar-065-pglite.mjs`** — **verde (exit 0)**. O runner:
   - monta a base real da 064 (`montarBase064`: 025/026/051/052/054/053/056/062/038/048/063), aplica a 064 e o `stub-064`;
   - captura a árvore de `explicar_livre_v2` de cada centro sintético **antes** da 065 (admin nos 7 centros, professor e agente em 51.X, professor em 63.INAT);
   - prova o defeito de **cada item** antes da 065: item 1 (`_tem_cpf('529,,,,,982,,,,,247,,,,,25')` = `false`), item 2 (`_mascarar_cpf('123.456.789-00')` = `***.***.***-**`), item 3 (caminho legado com CPF saía cru para b1), item 4 (pendência existente com CPF repetido devolvia `22023`), item 5 (`_resolver_origens_v2` ausente), item 6 (colisão devolvia `23505` cru), item 7 (alvo nulo de b1 devolvia `22023`), item 8 (a asserção da 064 não listava o nome da policy);
   - mede `explicar_livre_v2` num centro sintético de 320 rubricas e 960 lançamentos **antes** e **depois** da 065 (3 execuções, mediana; criação fora do tempo medido) e exige que a 065 não fique mais lenta que a 064;
   - confere que `test_065` falha **antes** da 065 pelo motivo do item 1 (`065 FALHOU: item 1: CPF com 5 vírgulas…`);
   - confere o cofre, aplica a 065 e compara as 10 árvores (idênticas em JSON);
   - roda `test_064` **e** `test_065` (verdes), reaplica a 065 e roda os dois de novo (idempotência);
   - confere o BLOCO 1 da 051 (`trg_bloqueia_agente` em todas as tabelas de `public`, exceto `propostas_agente`) e os MD5 dos 6 helpers protegidos;
   - prova **8 mutantes** (itens 1, 2, 2b, 3, 4, 5, 6 e 7) e a asserção do item 8; a sonda de `search_path` frouxo confirma a asserção exata; restaura a 065 depois de cada um e roda os dois roteiros na conferência final.
3. **`npm run lint`** — verde (exit 0).
4. **`npx vitest run`** — verde (exit 0): `37 passed (37)` arquivos, `575 passed | 5 skipped (580)` testes (os 5 pulados são fixtures opcionais pré-existentes em `tests/fixtures/pt-html/`).

## 4. Mutantes

Todos foram detectados por `test_065` (e as asserções dos itens 8 e 9 pelo próprio arquivo da 065):

| # | Mutação | Reprovação |
|---|---|---|
| 1 | `_tem_cpf` sem a regra de candidato (`v_fim := null`) | `065 FALHOU: item 1: CPF com 5 vírgulas…` |
| 2 | `_mascarar_cpf` sem o DV (`if true then`) | `065 FALHOU: item 2: _mascarar_cpf não deveria alterar texto sem CPF: 123.456.789-00` |
| 3 | `_resolver_origens_v2` devolve `caminho` cru no ramo `legado` | `065 FALHOU: item 3: b1 recebe arquivo_nome mascarado, caminho nulo e nota dentro de documento` |
| 2b | `_resolver_origens_v2` devolve `caminho` cru no ramo `documento` | `065 FALHOU: item 2b: b1 recebe caminho nulo e nota no ramo documento` |
| 4 | `criar_pendencia_v2` com a checagem prévia da 064 | `065 FALHOU: item 4: pendência existente deveria aceitar a limpeza do detalhe (Pendência contém …)` |
| 5 | `explicar_livre_v2` com a folha de previsto trocada para `legado` | `065 FALHOU: item 5: lote e _resolver_origem_alvo divergem em 2 de 7 folhas` |
| 6 | `registrar_documento_v2` sem o `exception when unique_violation` | `065 FALHOU: esperado SQLSTATE 40001, veio 23505 (duplicate key value violates unique constraint "documento_versoes_doc_versao_unique")` |
| 7 | `get_origem_v2` com `22023` para alvo nulo de não-admin | `065 FALHOU: esperado SQLSTATE 42501, veio 22023 (alvo_tabela, alvo_id e campo são obrigatórios.)` |
| 8 | Policy extra em `documentos` + reaplicação da 065 | `065: documentos deve ter exatamente 1 policy (sobraram: documentos_select_escopo, policy_extra_065)` |
| 9 | `_resolver_origens_v2` com `search_path = public` (frouxo) | `065: função interna public._resolver_origens_v2(jsonb, boolean) sem security definer ou search_path` |

## 5. Mudanças no `test_064` além do item 3 (desvio explicado)

A tarefa pedia para acrescentar `tests/sql/test_064_rastreabilidade.sql` à lista "só para atualizar as asserções que a 065 muda de propósito (item 3)". Na prática, a **regra de CPF nova** e o **item 4** mudam de propósito mais três asserções; sem atualizá-las, o `test_064` não poderia ficar verde depois da 065. O diff ficou mínimo (11 inserções, 8 remoções) e só nessas asserções:

1. **Item 3**: o legado com CPF no caminho, para b1/c1, agora espera `documento.caminho = null` e `documento.nota = "arquivo com nome que parece CPF: peça ao admin"`; admin continua com caminho cru e sem a chave `nota`.
2. **Item 1 (gramática)**: o caso `'Linha 529    ' || E'\n' || '    982 …'` tinha vão de **9** caracteres; a regra nova só aceita até **6**. Foi reduzido para 6 (5 espaços + quebra de linha), mantendo o caso de quebra de linha com indentação. O trecho sintético do bloco 3 também tinha o vão de 9 e a variante `5299 8224 725` (4-4-3); passou a ter vão de 6 e 7 variantes (a expectativa de máscara caiu de 8 para 7 `***.***.***-**`). `5299 8224 725` **não** é candidato 3-3-3-2 pela regra única; o `test_065` passou a cobri-lo como falso.
3. **Item 4**: a atualização de uma pendência **existente** com CPF novo agora é recusada pelo gatilho (`23514`), não pela checagem prévia da RPC (`22023`). A asserção do `test_064` foi trocada para `23514` com a mensagem `Pendência com CPF%`.

Nenhuma outra asserção do `test_064` foi alterada. Na 2ª rodada, o `test_064` não mudou.

## 6. Desvios do contrato

- **Sem desvio de assinatura/campos do contrato**: `registrar_documento_v2`, `get_origem_v2`, `explicar_livre_v2`, `criar_pendencia_v2` e as tabelas da 064 continuam com os mesmos nomes, parâmetros e chaves de retorno.
- **`documento.nota`** é uma chave nova, e só aparece quando o caminho (no ramo `legado` ou no ramo `documento`) tem CPF e o usuário é não-admin/agente. Sem CPF a chave não existe (nada muda para o contrato atual).
- **Função nova** `_resolver_origens_v2`: interna, `stable`, `security definer`, `search_path`, sem grant (revogada de `public, anon, authenticated`), como a correção pós-revisão pediu. `_resolver_origem_alvo` passou a ser invólucro da mesma regra.

## 7. Dúvidas, itens em aberto e observações

- **Ordem 064 → 065 / 064 não pode ser reaplicada**: reaplicar a **064 depois da 065** falha nas asserções antigas da própria 064 (`'5299 8224 725'` e o vão de 9 caracteres eram positivos para a regra velha). A produção já tem a 064 aplicada; a 065 é a próxima e o runner aplica nessa ordem. Um replay completo futuro (por exemplo, um `000_reset` + todas as migrações) precisa pular/substituir essas duas asserções da 064, ou aplicar a 065 antes de rodar o bloco de asserção da 064. Isso não afeta a aplicação da 065 pelo cofre.
- **Concatenação entre campos**: `_tem_cpf` pode formar um CPF que não existe em nenhum campo isolado (dígitos no fim de um campo + dígitos no começo do seguinte). O risco medido em linhas de balancete é zero; a concatenação foi mantida de propósito para pegar CPF partido entre campos.
- **Sobreposição de candidatos**: `_mascarar_cpf` é gulosa da esquerda para a direita; se dois candidatos válidos se sobrepõem, mascara o primeiro e descarta o trecho (a saída não tem mais dígitos). `_cpfs` varre **todas** as posições e coleta todos os candidatos válidos, sem sobreposição de coleta. A diferença é intencional e não há escape.
- **Letra/dígito Unicode**: a gramática usa `[0-9]` (dígitos ASCII) e trata letra acentuada por `upper(x) <> lower(x)`; dígitos de outros alfabetos não são CPF brasileiro e caem como caractere de vão. Não há esse tipo de dado nos balancetes/planos.
- **Chave estável de `plano_rubricas` e `get_saldo_livre` (048)**: registrados no item 2.9, não corrigidos.
- **F2-B**: o `temCpf` em JS deve espelhar exatamente a gramática do item 2.1 (mesmas strings de teste).
- **Produção/push**: nada aplicado em produção, nada enviado com `git push`, nenhuma outra IA chamada.

## 8. Pronto quando

- `node tools/replica-local/rodar-065-pglite.mjs` verde: **ok** (10 árvores idênticas, centro grande mais rápido que a 064, 8 mutantes + asserção do item 8 + sonda de `search_path` exato, `test_064`/`test_065` verdes e idempotência).
- `npm run lint` e `npx vitest run` verdes: **ok**.
- Linha da 065 em `docs/migracoes.md`: **ok**.
- Relatório: este arquivo.
- Commit na branch atual (`redesenho/f2-e-065`): conventional commit, sem push.
