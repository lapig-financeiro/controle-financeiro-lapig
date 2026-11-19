# F2-A — Banco da fase 2: rastreabilidade (migração 064)

Executor: **Orchestrator (Neon)**, num worktree próprio **fora do OneDrive** (branch `redesenho/f2-a-banco`).
Roda em paralelo com a F2-C (telas): as duas **não têm arquivo em comum**. O contrato entre elas é a seção
"Contrato" abaixo, igual nas duas tarefas; não mude nome, parâmetro ou campo sem registrar no relatório.

Antes de começar, leia: `CLAUDE.md` (regras de migração e do cofre), `docs/migracoes.md` (linhas 025, 026,
033, 038, 048, 050, 053, 062, 063), `docs/redesenho/README.md` §4, §6 (F2) e §7b, `docs/redesenho/ESTADO.md`
(seção "Para uma 064"), e `database/063_redesenho_f1.sql` + `tools/replica-local/rodar-063-pglite.mjs` +
`tests/sql/test_063_redesenho_f1.sql` como modelo de forma e de teste (inclusive as "Correções depois da
revisão" de `tarefas/F1-A-banco.md`, que valem aqui também).

**Você não aplica nada em produção.** Escreve, testa localmente e para.

## Arquivos (só estes)
- `database/064_rastreabilidade.sql` (novo)
- `tests/sql/test_064_rastreabilidade.sql` (novo)
- `tools/replica-local/sintetico/stub-064.sql` (novo)
- `tools/replica-local/rodar-064-pglite.mjs` (novo; reaproveite o runner da 063, que também carrega a 063)
- `docs/migracoes.md` (uma linha nova para a 064)
- `docs/redesenho/relatorios/F2-A.md` (novo)

## Decisões de desenho (já tomadas; não reabrir)
- **Aditivo.** Nenhuma RPC que o site antigo usa muda (`upsert_balancete`, `get_saldo_livre`,
  `upsert_plano_trabalho`… ficam como estão). `balancetes` continua sendo "os números vigentes"; o histórico de
  arquivos e de leituras fica em `documento_versoes` + `fatos`. O versionamento completo (aplicar sem
  sobrescrever, desfazer) chega com `aplicar_documento` na F3.
- `aplicacoes` e `derivacoes` **não** nascem agora: sem quem escreva nelas, seriam tabelas vazias com regra
  adivinhada. Nascem na F3 (aplicação automática) e na F5 (`calcular`). A árvore de valores calculados da F2 é
  montada na leitura por `explicar_livre_v2`, a partir das mesmas tabelas que `get_saldo_livre` lê.
- **Folha sem fato não é erro**: é `legado` (o número veio antes da rastreabilidade). Se o arquivo de origem
  existir (`balancetes.arquivo_storage_path`, `planos_trabalho.arquivo_storage_path`), `get_origem_v2` devolve
  o documento e os termos de busca, e o site acha a linha na hora (`frontend/js/origem-busca.js`), como o site
  antigo já faz.
- Bolsas são `digitado` nesta fase (a planilha da FUNAPE ganha fatos por linha na F3, com CPF mascarado).

## O que a 064 cria

### 1. `documentos`
`id uuid pk default gen_random_uuid()`, `project_id uuid not null references projects(id) on delete restrict`,
`tipo text not null` (check `'balancete','plano'`; `'bolsas','contrato'` entram na F3/F4 por migração),
`chave text not null unique` (comentário da coluna: `balancete:<code>:<AAAA-MM-DD>` ou
`plano:<code>:v<versao>`), `titulo text not null`, `criado_em timestamptz not null default now()`.

### 2. `documento_versoes`
`id uuid pk`, `documento_id uuid not null references documentos(id) on delete restrict`, `versao int not null`
(1, 2, 3… por documento), `sha256 text not null` (64 hex, check), `bucket text not null` (check
`'balancete-pdfs','plano-trabalho-docs'`), `caminho text not null` (começa por `<project_id>/`, check por
função — é o que a 062 usa para o escopo do arquivo), `arquivo_nome text`, `formato text not null` (check
`'pdf','docx'`), `paginas int`, `parser text not null`, `parser_versao text not null`, `origem text not null`
(check `'backfill','site','ingestao'`), `registrado_em timestamptz not null default now()`, `registrado_por uuid
references auth.users(id) on delete set null`. `unique (documento_id, versao)`, `unique (documento_id, sha256)`.

### 3. `fatos` (um número lido de um documento, com o lugar onde está)
`id uuid pk`, `versao_id uuid not null references documento_versoes(id) on delete cascade`,
`alvo_tabela text not null` (check em `'balancetes','balancete_lancamentos','planos_trabalho','plano_rubricas',
'plano_desembolsos'`), `alvo_id uuid not null`, `campo text not null` (check pelo par tabela/campo, tabela
abaixo), `valor numeric(14,2) not null`, `pagina int` (null em DOCX), `trecho text not null` (1 a 500
caracteres, a linha literal do documento), `bbox jsonb` (null ou `{x0,x1,yMin,yMax}` números, espaço do PDF,
como `linhasDaPagina` de `origem-busca.js`), `criado_em timestamptz not null default now()`.
`unique (versao_id, alvo_tabela, alvo_id, campo)`; índice em `(alvo_tabela, alvo_id, campo)`.

| alvo_tabela | campos aceitos |
|---|---|
| `balancetes` | `saldo_disponivel`, `rendimento_liquido`, `total_debitos`, `total_creditos` |
| `balancete_lancamentos` | `saldo_atual`, `valor_debito`, `valor_credito` |
| `planos_trabalho` | `valor_total_plano` |
| `plano_rubricas` | `valor_previsto` |
| `plano_desembolsos` | `valor` |

### 4. Ligação com os números vigentes
`balancetes.documento_versao_id` e `planos_trabalho.documento_versao_id` (`uuid null references
documento_versoes(id) on delete set null`, `add column if not exists`). Só `registrar_documento_v2` grava.
Nenhum gatilho novo em `balancetes`/`planos_trabalho` (o site antigo grava nelas e não pode quebrar).

### 5. Acesso das três tabelas
RLS ligado; `revoke all ... from public, anon, authenticated` e depois `grant select ... to authenticated`
(lição do 1º ensaio da 063: o Supabase dá tudo a `anon`/`authenticated` em objeto novo). Policy de SELECT:
admin, ou o centro no escopo (`documentos.project_id`; nas outras duas, pelo documento pai). **Nenhuma**
policy de escrita: só pela RPC. Gatilho `trg_bloqueia_agente` (BEFORE INSERT OR UPDATE OR DELETE FOR EACH
STATEMENT, sem WHEN) nas três. Professor lê `fatos.trecho` só pela RPC `get_origem_v2` (que mascara CPF):
a policy de `fatos` é **só admin**.

### 6. Funções auxiliares (definer, `set search_path = public, pg_temp`, sem grant a ninguém além do
necessário; revogue de `public, anon, authenticated` as que só são chamadas por outras funções)
- `_tem_cpf(t text) returns boolean`: `contem_cpf(t)` **ou** um regex local que pega CPF com espaço, ponto ou
  traço entre os grupos (`\d{3}[ .-]?\d{3}[ .-]?\d{3}[ .-]?\d{2}` com fronteira de dígito dos dois lados).
  Não toca `contem_cpf` (o cofre recusa).
- `_mascarar_cpf(t text) returns text`: troca o que `_tem_cpf` acharia por `***.***.***-**`.

### 7. RPCs (todas `security definer` + `set search_path = public, pg_temp`; `revoke execute ... from
public, anon`; `grant execute ... to authenticated`; guard no começo)
- **`registrar_documento_v2(p jsonb)`** — **só admin** nesta fase (a ingestão da F3 ganha a dela). Chaves
  aceitas (outras são recusadas): `project_id, tipo, chave, titulo, sha256, bucket, caminho, arquivo_nome,
  formato, paginas, parser, parser_versao, origem, vincular {tabela, id}, fatos [ {alvo_tabela, alvo_id,
  campo, valor, pagina, trecho, bbox} ]`. Numa transação só:
  1. upsert de `documentos` por `chave` (mesmo `project_id` e `tipo`, senão erro);
  2. se já existe versão com o mesmo `sha256`, **não cria outra** e não mexe nos fatos (devolve
     `criada = false`); senão cria a versão `max(versao)+1`;
  3. cada fato: o alvo tem de existir **e ser do mesmo projeto** (balancete/plano do `project_id`), e `valor`
     tem de ser **igual ao valor gravado hoje** no alvo/campo. Qualquer fato que não bate faz a chamada
     inteira falhar com a lista dos que não bateram (`raise exception` com `detail` em JSON: tabela, id,
     campo, esperado, lido). É isso que prova que o trecho é a origem do número vigente;
  4. `_tem_cpf(trecho)` em qualquer fato → recusa a chamada (o plano traz a equipe com CPF; o trecho tem de
     ser só a linha do valor);
  5. `vincular` (`balancetes` ou `planos_trabalho`, mesmo projeto) recebe `documento_versao_id` = a versão.
  Devolve `{ documento_id, versao_id, versao, criada, fatos }` (`fatos` = quantos gravou).
- **`get_origem_v2(p_alvo_tabela text, p_alvo_id uuid, p_campo text)`** — descobre o projeto do alvo e faz
  `assert_project_allowed`. Procura o fato do alvo/campo na versão mais recente que tenha um. Achou →
  `tipo = 'documento'`. Não achou e o alvo é de balancete/plano → `tipo = 'legado'`, com o documento montado
  de `arquivo_storage_path`/`arquivo_nome` do balancete/plano pai, se houver, e `busca` (os termos que
  `acharAlvo` usa: `conta_codigo` e `valor` para lançamento; `rubrica_code`, `descricao_livre` e `valor` para
  rubrica; `parcela` e `valor` para desembolso; `valor` nos cabeçalhos). Para não-admin, `trecho` sai por
  `_mascarar_cpf`. Bolsas (`alvo_tabela = 'scholarships'`, `campo = 'amount'`) → `tipo = 'digitado'`, com
  `nota` "valor do cadastro de bolsas (planilha da FUNAPE), sem documento por linha até a F3".
  Qualquer outra tabela/campo → erro.
- **`explicar_livre_v2(p_project_id uuid)`** — `assert_project_allowed`. Chama `get_saldo_livre` e monta a
  árvore do "livre": raiz = soma dos grupos; cada grupo = previsto − realizado − comprometido; previsto =
  linhas de `plano_rubricas` do plano ativo (folha `ref` → `plano_rubricas.valor_previsto`); realizado =
  linhas de `balancete_lancamentos` do balancete que `get_saldo_livre` usou (`balancete_id` do retorno), com
  rubrica, campo `saldo_atual` (é o que a 048 soma); comprometido = bolsas de `bolsas_ativas` (folha
  `scholarships.amount`, `tipo = 'digitado'`, rótulo "nome — N meses × R$ X"). **Invariante**: em todo nó de
  cálculo, `Σ(sinal × filho.valor) = valor` ao centavo, e a raiz = `livre` de `resumo_projetos_v2` para o
  mesmo centro. Se `get_saldo_livre` disser `has_plano = false` ou `has_balancete = false`, a raiz vem com
  `valor = null` e `motivo` (`'sem plano'`/`'sem balancete'`), sem partes. O `tipo` de cada folha
  (`documento`/`legado`/`digitado`) sai da mesma regra de `get_origem_v2` (uma função interna só, sem
  duplicar a lógica).

### 8. Pendências (achados da revisão max da 063 — ver ESTADO.md "Para uma 064")
- O gatilho de CPF de `pendencias` e `criar_pendencia_v2` passam a usar `_tem_cpf`; no UPDATE o gatilho só
  revalida os campos que mudaram.
- `criar_pendencia_v2`: centro inativo só é recusado quando a pendência **não existe** (repetir a chave de
  uma pendência aberta de centro que ficou inativo atualiza, não falha); `project_id: ""` é erro (não vira
  pendência geral); `detalhe: null` vira `{}`; título em branco (inclusive só `\n`/`\t`) é erro.
- `resolver_pendencia_v2(null, …)` dá erro claro, não "não encontrada".
- Índice em `pendencias(resolvida_por)`.
- A asserção final da 064 confere também, para `pendencias` **e** para as três tabelas novas: uma policy
  SELECT só (nenhuma outra policy), gatilho do agente habilitado (`tgenabled = 'O'`) e sem `WHEN`.

## Contrato (igual na F2-C)
```
explicar_livre_v2(p_project_id uuid) → jsonb
{ "valor": number|null, "motivo": "sem plano"|"sem balancete"|"sem números"|null, "data_referencia": "AAAA-MM-DD"|null,
  "rotulo": "Livre para gastar", "tipo": "calculo", "conta": "soma dos grupos", "chave": "livre", "sinal": 1,
  "ref": null, "nota": null, "partes": [ No ] }        -- valor null ⇒ partes [] e motivo preenchido
No = { "rotulo": string, "valor": number, "tipo": "calculo"|"documento"|"legado"|"digitado",
       "chave": string,                  -- "grupo:<grupo_code>", "rubrica:<code>:previsto|realizado|comprometido", "linha:<id>"
       "conta": string|null,             -- só em "calculo": "previsto − realizado − comprometido" ou "previsto − realizado"
       "sinal": 1|-1,                    -- como entra na conta do pai (o valor do nó é sempre o seu, sem sinal)
       "ref": { "alvo_tabela", "alvo_id", "campo" }|null,   -- só folhas; o site chama get_origem_v2 com ele
       "nota": string|null,              -- ex. grupo sem compromissos rastreados
       "partes": [ No ] }                -- [] nas folhas
get_origem_v2(p_alvo_tabela text, p_alvo_id uuid, p_campo text) → jsonb
{ "tipo": "documento"|"legado"|"digitado", "valor": number|null,     -- valor = o gravado hoje no alvo/campo
  "documento": { "id": uuid|null, "tipo": "balancete"|"plano", "titulo": string, "arquivo_nome": string|null,
                 "formato": "pdf"|"docx", "bucket", "caminho", "versao": int|null, "registrado_em": string|null }|null,
  "fato": { "pagina": int|null, "trecho": string, "bbox": {x0,x1,yMin,yMax}|null, "parser", "parser_versao" }|null,
  "busca": { "conta_codigo"?, "texto"?, "valor"? }|null,   -- só em "legado"; é o `alvo` de acharAlvo, tal qual
  "nota": string|null }
registrar_documento_v2(p jsonb) → jsonb  { "documento_id","versao_id","versao","criada": bool,"fatos": int }   -- só admin; a F2-C não usa
```
O site gera a URL assinada do arquivo com o login do próprio usuário (`storage.from(bucket).createSignedUrl`):
o escopo do arquivo é o da 062, não da RPC.

## Regras do cofre (o arquivo é recusado se quebrar uma)
As mesmas da 063 (`begin;` na primeira linha de comando e `commit;` na última; nada de papéis, extensões,
`alter default privileges`, `set role`, palavras proibidas; não tocar as seis funções protegidas; a migração
não insere linha; até 90 KB). Asserções no fim, num `do $$ ... $$`: RLS ligado, ACL exata (anon sem nada,
authenticated só SELECT) nas três tabelas, policies e gatilhos como no item 8, anon sem EXECUTE em todas as
funções novas (por nome), funções definer com `search_path`, colunas e tipos.

## Testes (pglite, como a 063)
`rodar-064-pglite.mjs` carrega a base da 063 (mesma ordem, com `stub-063` e a 063), depois `stub-064`
(documentos e fatos sintéticos **só por chamada de `registrar_documento_v2` como admin**, sem PII) e a 064, e
roda `test_064_rastreabilidade.sql`. Cubra pelo menos:
1. ACL: anon não lê nada das três tabelas nem executa as RPCs; professor não lê `fatos` direto; professor A
   não lê documento do centro B; insert/update/delete direto falha para professor e para o agente (051).
2. `registrar_documento_v2`: professor recebe erro; admin registra; repetir o mesmo `sha256` não cria versão
   nem duplica fato; `sha256` novo cria a versão 2; fato com valor diferente do gravado → a chamada inteira
   falha e nada fica gravado; alvo de outro projeto → falha; trecho com CPF (com e sem pontuação, e com
   espaços entre os grupos) → falha; chave desconhecida no payload → falha; `vincular` grava
   `documento_versao_id`.
3. `get_origem_v2`: `documento` com página/trecho/bbox; professor recebe trecho mascarado (insira, por SQL
   direto de superusuário só no teste, um fato com CPF para provar a máscara); alvo sem fato → `legado` com
   documento e `busca`; bolsa → `digitado`; alvo de centro alheio → erro; tabela/campo fora da lista → erro.
4. `explicar_livre_v2`: para cada centro sintético com plano e balancete, a raiz bate com
   `resumo_projetos_v2.livre` ao centavo e todo nó de cálculo fecha (percorra a árvore em PL/pgSQL);
   sem plano/sem balancete → `valor null` e `motivo`; folhas com fato saem `documento`, sem fato `legado`,
   bolsas `digitado`.
5. Os itens do §8 (um teste por item).
6. Rodar a 064 duas vezes não quebra; antes da 064 o roteiro falha (prova que testa algo).
7. **Mutantes**: como na 063, rode o teste contra pelo menos três versões estragadas da 064 (ex.: sem a
   conferência de valor; policy de `fatos` aberta a `authenticated`; sem a máscara) e confirme que cada uma
   reprova. Registre no relatório.

## Pronto quando
- `node tools/replica-local/rodar-064-pglite.mjs` verde; `npm run lint` e `npm test` verdes.
- Linha da 064 em `docs/migracoes.md`; relatório `docs/redesenho/relatorios/F2-A.md` (o que fez, como testou,
  mutantes, desvios do contrato, dúvidas, tamanho do arquivo).
- Commit na branch do worktree (conventional commit). **Sem push, sem aplicar.**

## Correções depois da revisão (19/11, DeepSeek max, conferidas pelo Claude) — valem por cima do texto acima
1. **Alvo estável, não id.** `upsert_plano_trabalho` (025:415) e `upsert_balancete` (053:322) apagam e recriam
   as linhas a cada gravação: um fato preso ao `id` da linha morre no próximo salvamento. `fatos` guarda
   `alvo_tabela`, **`alvo_pai_id uuid not null`** e **`alvo_chave text not null`** em vez de `alvo_id`:
   `balancetes` → (`id`, `''`); `balancete_lancamentos` → (`balancete_id`, `conta_codigo`); `planos_trabalho`
   → (`id`, `''`); `plano_rubricas` → (`plano_id`, `rubrica_code || '|' || coalesce(descricao_livre,'')`);
   `plano_desembolsos` → (`plano_id`, `parcela::text`). `unique (versao_id, alvo_tabela, alvo_pai_id,
   alvo_chave, campo)` e índice em `(alvo_tabela, alvo_pai_id, alvo_chave, campo)`. O **payload** de
   `registrar_documento_v2` e o `ref` do contrato continuam com `alvo_id` (o id de hoje); a RPC traduz para a
   chave estável. `get_origem_v2` também traduz o `alvo_id` recebido. Teste: registrar, regravar o plano e o
   balancete pelas RPCs antigas com os mesmos números, e a folha continua `documento`.
2. **Valor mudou depois da leitura**: `get_origem_v2` compara `fato.valor` com o valor gravado hoje; diferente
   → `tipo = 'legado'`, `nota` "o valor mudou depois da leitura do documento (lido R$ X)", com o documento e
   `busca`. Teste.
3. **Sem `vincular` e sem coluna nova em `balancetes`/`planos_trabalho`** (o professor edita essas tabelas
   direto, 033:337 e :354; a coluna seria forjável). Remova o item 4 e a chave `vincular` do payload. O
   documento de um alvo se acha pelos fatos.
4. **Chave do documento por `project_id`** (o `code` pode ser nulo ou mudar, 041:76): `balancete:<project_id>:
   <AAAA-MM-DD>` e `plano:<project_id>:<plano_id>`.
5. **Matriz tipo × tabela × bucket**: `balancete` ⇒ `balancetes`/`balancete_lancamentos` e bucket
   `balancete-pdfs`; `plano` ⇒ `planos_trabalho`/`plano_rubricas`/`plano_desembolsos` e bucket
   `plano-trabalho-docs`. O formato decide `paginas`/`pagina` (DOCX: nulos). `caminho` começar por
   `<project_id>/` é conferido **na RPC** (sem CHECK entre tabelas).
6. **Comparação de valor**: `if v_atual is null or v_atual is distinct from round(v_valor, 2)` → falha. Fato
   para campo nulo no alvo é recusado. Teste com `saldo_disponivel` nulo.
7. **CPF**: `_tem_cpf(t)` = `contem_cpf(t)` **ou** `contem_cpf` sobre o texto com espaço/ponto/traço entre
   dígitos removidos (assim o dígito verificador continua valendo; `123.456.789-00` inválido não é CPF).
   `_mascarar_cpf` pode ser mais larga (regex solto). Em `registrar_documento_v2`, valide `string_agg` de todos
   os `trecho` + `titulo` + `arquivo_nome` (CPF partido entre linhas). A máscara protege o **trecho**; o
   arquivo inteiro continua com o escopo da 062 (professor do centro já abre o plano hoje) — registre isso no
   comentário, sem chamar a policy de `fatos` de barreira de CPF.
8. **Árvore a partir de `get_saldo_livre`**: os nós de grupo e de rubrica saem de `grupos[]` e `rubricas[]`
   do retorno (já filtrados pelo `base` da 048:257); as linhas (`plano_rubricas`, `balancete_lancamentos`,
   bolsas) entram só como folhas sob a rubrica, e a soma das folhas tem de fechar com o `previsto`/`realizado`/
   `compromissos` da rubrica. O plano ativo é único (`uq_plano_ativo_por_projeto`, 025:78; confira que o stub
   tem o índice) e o balancete é o `balancete_id` do retorno. Níveis: raiz → grupo (`chave grupo:<code>`) →
   previsto/realizado/comprometido de cada rubrica (`chave rubrica:<code>:previsto` etc.; rótulo "Previsto —
   <nome da rubrica>") → linhas (`chave linha:<id>`; rótulo da linha: `descricao_livre` ou o nome da rubrica
   para plano; `conta_codigo — conta_descricao` para balancete). Rubrica com previsto 0 não gera nó de previsto
   vazio. Teste com rubrica de previsto 0, previsto negativo e lançamento negativo (estorno).
9. **Bolsas**: o nó de bolsa tem `valor = compromisso` (`amount × meses`, 048:215–225); rótulo "<nome> — N
   meses × R$ X"; `ref = {scholarships, id, amount}`. `get_origem_v2` de bolsa devolve `valor = amount`
   (mensal) e a `nota` diz que a árvore mostra o total dos meses.
10. **Grupo sem compromissos rastreados** (`compromissos_cobertura = 'nenhuma'`): `conta` "previsto −
    realizado" e `nota` "compromissos fora de bolsas não são rastreados".
11. **Sem números**: plano e balancete existem mas `grupos = []` → raiz `valor null`, `motivo 'sem números'`
    (o `resumo` dá `livre null` nesse caso, 063:334). Nenhum nó abaixo da raiz tem `valor` nulo.
12. **Oráculo do teste** = `resumo_projetos_v2.centros[]` (ativos). `explicar_livre_v2` de centro inativo
    funciona para admin, testado à parte.
13. **Ordem entre documentos**: o fato vigente de um alvo é o da versão com `registrado_em` mais recente
    (desempate `versao desc`). Teste com dois documentos para o mesmo alvo.
14. **`legado` definido**: bucket pelo tipo; formato pela extensão do caminho (sem extensão: `pdf` para
    balancete, `docx` para plano); `titulo` "Balancete de mmm/aa" ou "Plano de trabalho v<versao>";
    `arquivo_nome` = o gravado ou o fim do caminho; `busca` = `{conta_codigo, valor}` para lançamento,
    `{texto: descricao_livre ou nome da rubrica, valor}` para rubrica, `{texto: 'Parcela N', valor}` para
    desembolso, `{texto: 'saldo disponivel' | 'rendimento liquido' | …, valor}` nos cabeçalhos — é o `alvo` de
    `acharAlvo` (origem-busca.js:250), que só lê `conta_codigo`, `texto` e `valor`. Teste que pega o `busca`
    devolvido e chama `acharAlvo` num texto sintético (vitest em `tests/`; acrescente esse arquivo à lista).
15. **Pendências**: o CHECK de `titulo` e `chave` vira `btrim(x, E' \t\n\r') <> ''`; `p_id` nulo tem
    mensagem própria.
16. **Asserções** conferem também `tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure`; mutante que
    troca a função mantendo o nome.
17. **Testes — base real**: o runner carrega `database/025`, `026` e `053` de verdade (com os stubs de que
    precisarem), não o `stub.sql` mínimo dessas tabelas; ordem: base → 063 → `test_064` (tem de falhar) → 064 →
    `stub-064` (dados, só pela RPC) → `test_064` → 064 de novo → `test_064` → mutantes.
18. **Backfill** não é desta tarefa: vem na F2-B (segunda leva), um script que chama `registrar_documento_v2`.
    `ESTADO.md` e `README.md` são atualizados pelo Claude na junção.
