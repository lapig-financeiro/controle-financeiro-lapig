# Relatório F3-A — Migração 067 e tela: vigência e taxas lidas do contrato

Branch: `redesenho/f3-a-termos` (worktree `C:/Users/amara/dev/cf-f2-e`). Commit novo, **sem push**.
**Nada foi aplicado em produção**, nenhuma variável `CF_*` real foi usada, nenhuma outra IA foi chamada e o
runner só tocou no PGlite em memória.

> Este relatório foi escrito na 1ª rodada e atualizado na 2ª. As seções 1–6 são o retrato da 1ª rodada
> (5 mutantes, 111 testes); a **seção 7** é a 2ª rodada (taxa total, fonte em `documentos`, 7 mutantes,
> 114 testes).

## 1. Tamanho dos arquivos

| Arquivo | Bytes | Linhas |
|---|---:|---:|
| `database/067_termos_contrato.sql` | **34.946** | 879 |
| `tests/sql/test_067_termos_contrato.sql` | **26.035** | 593 |
| `tools/replica-local/rodar-067-pglite.mjs` | **10.731** | 282 |
| `app/src/paginas/Projeto.jsx` | 77.383 | 2.218 |
| `app/src/servicos/dados.js` | 17.156 | 574 |
| `app/src/servicos/dadosExemplo.js` | 67.277 | 2.144 |
| `app/tests/termos-contrato.test.jsx` | 13.840 | 425 |

A migração está abaixo de 90 KB, começa com `begin;` como primeiro comando SQL e termina com `commit;` como
último; não tem `commit`/`savepoint` no meio nem os termos proibidos do cofre (`password`, `service_role`,
`net.`, `http(`, `dblink`, `cron.`, `vault.`, `create extension`, `concurrently`, `vacuum`, `copy`,
`set role`, `alter default privileges`…). Não há INSERT de dado pela migração: as únicas linhas novas são
criadas depois, pelas RPCs, com valores do chamador.

## 2. Banco: `public.termos_contrato`

### 2.1. Tabela e barreiras

Histórico **só insert** dos termos do contrato. O vigente é o registro mais recente por
`(project_id, termo)`; nada é apagado nem editado. O único UPDATE é a conferência humana, pela RPC.

- `project_id` → `projects(id) on delete cascade`; `criado_por`/`conferido_por` → `auth.users(id) on delete set null`.
- `termo` em `('vigencia_inicio', 'vigencia_fim', 'taxa_cip_ufg', 'taxa_cip_ua', 'taxa_dao')` — os três últimos
  são os códigos das rubricas de taxa da 066.
- `valor_data` para vigência; `valor_pct numeric(6,3)` entre 0 e 100 para taxa. CHECK único impede os dois
  preenchidos ou o tipo errado.
- `trecho` de 1 a 600, obrigatório, sem CPF. O CPF é barrado por CHECK chamando `public.contem_cpf` (a função
  **não** é alterada; o CHECK roda como dono da função definer, nunca como `authenticated`, porque a tabela não
  tem INSERT direto para ninguém). A RPC também pré-checa CPF em `trecho`, `regra`, `nota`, `documento_nome`,
  `documento_url` e `autor`.
- `documento_url` só `https://drive.google.com/...` ou `https://docs.google.com/...`; `pagina` nula ou ≥ 1.
- `nota` até 2.000 (análise/comentário livre); `origem` `ia`/`pessoa`; `autor` até 60.
- `criado_em default now()`, `criado_por default auth.uid()`, `conferido_em/por`.
- RLS ligado; uma única policy de SELECT por escopo, igual à de `pendencias`
  (`is_admin() or project_id = any(allowed_project_ids())`); nenhuma policy de escrita; `revoke all` de
  `public`/`anon`/`authenticated` e `grant select` só a `authenticated`.
- `trg_bloqueia_agente` **BEFORE INSERT OR UPDATE OR DELETE FOR EACH STATEMENT**, sem `WHEN`.
- Índice `idx_termos_contrato_project_termo (project_id, termo, criado_em desc, id desc)`.

### 2.2. RPCs

Todas `security definer`, `set search_path = public, pg_temp`, `revoke ... from public, anon` e
`grant execute ... to authenticated`.

- **`get_termos_contrato_v2(p_project_id uuid) returns jsonb`** (`stable`): `assert_project_allowed`; devolve
  `{ termos: { <termo>: {...} }, end_date_cadastro, vigencia_confere }`. Cada termo traz `id`, `valor` (data
  para vigência, número para taxa), `regra`, `trecho`, `documento_nome`, `documento_url`, `pagina`, `nota`,
  `origem`, `autor`, `criado_em`, `conferido`, `conferido_em` e `versoes_anteriores` (lista das versões
  anteriores, sem `nota`). `nota` só vai para admin humano (`is_admin() and not is_agente()`); professor e
  agente recebem `null`. `vigencia_confere` é `null` se faltar o termo ou o `projects.end_date`; senão é
  `vigencia_fim = end_date`.
- **`registrar_termo_contrato_v2(p jsonb) returns jsonb`**: só admin humano. Valida chaves permitidas e tipos;
  exige `project_id` UUID existente, `termo` válido, `trecho`/`documento_nome`/`origem`/`autor`; vigência só com
  `valor_data` (data válida) e taxa só com `valor_pct` numérico entre 0 e 100; `documento_url` só Drive/Docs;
  `pagina` inteiro ≥ 1; limites de `regra`/`nota`/`autor`. Recusa CPF. Se o último registro do mesmo termo tem o
  mesmo valor, regra, trecho, documento, página e nota, devolve o id existente com `criado: false`; senão
  insere e devolve `criado: true`. `criado_em` usa `clock_timestamp()` (ver §5).
- **`conferir_termo_contrato_v2(p_id uuid) returns jsonb`**: só admin humano; `for update`; marca
  `conferido_em = now()` e `conferido_por = auth.uid()` uma vez. Repetir devolve a mesma marcação com
  `ja_estava: true`; id inexistente devolve `42501`.
- **`usar_vigencia_do_contrato_v2(p_project_id uuid) returns jsonb`**: só admin humano; `for update` no
  projeto; copia a `vigencia_fim` vigente para `projects.end_date` e a `vigencia_inicio` (se existir) para
  `projects.start_date`; devolve `{ project_id, antes: { start_date, end_date }, depois: {...}, mudou }`.
  Sem termo de vigência final devolve `22023` e não muda nada. Preserva `projects.active` mesmo que o gatilho
  da 020 queira reativar um centro inativo; não altera nome, código, valor ou qualquer outra coluna. O
  `updated_at` muda pelo gatilho `trg_projects_updated_at` da 001 — é a única outra coluna que se move.

### 2.3. O que **não** muda

`get_saldo_livre`, `explicar_livre_v2` e `resumo_projetos_v2` continuam iguais. A vigência que vale para as
contas continua sendo `projects.end_date`; a do contrato só entra lá pela RPC acima, por decisão humana. Nenhuma
linha de tabela existente é tocada pela migração.

## 3. App v2 (`app/`)

### 3.1. Camada de dados

- `dados.js`: `termosContrato(projectId)` (RPC `get_termos_contrato_v2`), `conferirTermoContrato(id)` e
  `usarVigenciaDoContrato(projectId)`, todos com validação estrita do payload (nunca transformam falha em
  dado vazio) e caminho de exemplo equivalente.
- `dadosExemplo.js`: quatro situações distintas, sem dado real:
  - **30.901** confere com o cadastro e tem as três taxas (8% + 8% + 10% = 26%);
  - **30.902** diverge (cadastro 31/03/2027, contrato 30/04/2027) e tem nota do admin;
  - **30.903** não tem nenhum termo;
  - **30.904** confere e tem nota do admin (aditivo).
  O modo exemplo também implementa `conferirTermoContrato` e `usarVigenciaDoContrato` (atualiza o centro e o
  `end_date` do saldo de exemplo), para o fluxo ser testável sem banco.

### 3.2. Cabeçalho

Perto da antiga linha "vigência digitada":

- contrato com `vigencia_fim` que confere: `Vigência até dd/mm/aaaa · faltam N meses · do contrato` — a data é
  um botão que abre o painel;
- contrato que diverge: a data do cadastro continua e entra `· contrato diz dd/mm/aaaa` em destaque de
  atenção; a data do contrato é o botão;
- sem termo: como antes (`vigência digitada`);
- falha ao carregar termos: a vigência do cadastro continua e a etiqueta vira um `—` discreto, com `title`
  explicando a falha. O erro não derruba a página nem vira zero.
- Taxas, quando existe algum termo de taxa: `Taxas do contrato: 26% (UFG 8 · unidade 8 · fundação 10)`, também
  botão. A soma é feita em milésimos inteiros (`numeric(6,3)`), só para exibir; não arredonda nem inventa
  precisão.

### 3.3. Painel "Do contrato"

`PainelLateral` com um cartão por termo, ordenado (início, fim, UFG, unidade, fundação):

- valor, `regra` ("Como foi obtido"), `trecho` em citação, documento e link "Abrir no Drive" em nova aba com
  `rel="noopener noreferrer"` e página;
- `Registrado por <autor> (IA) em dd/mm/aaaa` (ou sem "(IA)" quando `origem = pessoa`) e `conferido em
  dd/mm/aaaa` quando houver conferência;
- `nota` só para admin;
- admin: "Marcar como conferido" por termo; quando a vigência diverge, "Usar a data do contrato" com
  confirmação que mostra o antes → depois. Depois de usar, recarrega termos, saldo e resumo (a janela das
  bolsas muda com `end_date`).

### 3.4. Testes do app

`app/tests/termos-contrato.test.jsx` cobre os quatro casos do cabeçalho, a soma das taxas, o painel do
professor (sem nota, sem botões), o painel do admin (nota e botões), o "Marcar como conferido" e o fluxo
"Usar a data do contrato" (confirmação antes → depois, chamada da RPC, recarga do resumo e do saldo).
`app/tests/dados.test.js` cobre as três RPCs novas, a validação de payload e as quatro situações do modo
exemplo, incluindo conferir e usar.

## 4. Testes e cofre

### 4.1. Roteiro `tests/sql/test_067_termos_contrato.sql`

Autoconferido com `pg_temp.ok067`, em `begin`/`rollback`, sobre a base 064:

1. **BLOCO 0**: a tabela existe (antes da 067 falha com `42P01`) e os cinco centros sintéticos estão no lugar.
2. **BLOCO 1**: professor, agente e automação não registram, não conferem e não usam; anon não lê a tabela nem
   executa as RPCs.
3. **BLOCO 2**: chave desconhecida, termo inválido, vigência com `valor_pct`, taxa com `valor_data`, taxa fora de
   0–100, data inválida, URL fora do Drive/Docs, página 0 ou fracionária, CPF no trecho, autor/nota longos,
   `project_id` inválido e trecho vazio são recusados (`22023`); INSERT direto como `authenticated` falha
   (`42501`); INSERT direto do dono com CPF falha no CHECK (`23514`).
4. **BLOCO 3**: registra os cinco termos do 51.X, confere `criado_por`, idempotência (mesmo id, sem linha nova),
   versão nova quando a `regra` muda (6 linhas), conferência única e recusa de professor/agente.
5. **BLOCO 4**: `get` confere `end_date_cadastro`, `vigencia_confere`, valores, documento, página, autor,
   `conferido`, nota, uma versão anterior; professor do 51.X vê os termos mas não a nota; professor do
   51.Y não atravessa o escopo; agente lê sem nota; SELECT direto respeita o escopo; `p_project_id` nulo é
   `22023`.
6. **BLOCO 5**: o 51.Y diverge (cadastro 31/03/2027 × contrato 30/04/2027), `usar_vigencia` devolve antes/depois,
   muda só `start_date`/`end_date` do 51.Y (excluindo `updated_at`, que o gatilho da 001 mexe), não toca no
   51.X, é idempotente, recusa centro sem termo e **não reativa** o 63.INAT; professor e agente não usam.
7. **BLOCO 6**: o admin lê as 9 linhas (6 do 51.X + 2 do 51.Y + 1 do 63.INAT).

### 4.2. Runner `tools/replica-local/rodar-067-pglite.mjs` — **verde (exit 0)**

- monta a base `montarBase064` (025/026/051/052/054/053/056/062/038/048/063) e aplica o gatilho de projetos da
  020 (a base 064 não o tem; sem ele o teste de "não reativa" não teria como ser exercitado);
- confere o cofre (tamanho, `begin;`/`commit;`, termos proibidos e ausência de INSERT de dado pela migração);
- exige que `test_067` falhe **antes** da 067 (`42P01`);
- aplica a 067, roda `test_067`, reaplica e roda de novo (idempotência);
- confere o BLOCO 1 da 051 (barreira do agente em todas as tabelas de `public`) e os MD5 dos 6 helpers
  protegidos;
- prova **5 mutantes**, todos detectados pelo roteiro: (1) nota vazando para professor; (2) `usar_vigencia`
  mexendo em todos os centros; (3) `registrar` sem idempotência; (4) policy de SELECT aberta; (5)
  `usar_vigencia` reativando centro inativo;
- reaplica a 067 e roda o roteiro uma última vez.

### 4.3. Resultados

| Comando | Resultado |
|---|---|
| `node tools/replica-local/rodar-067-pglite.mjs` | **verde** (exit 0) |
| `npx vitest run` | **44 arquivos, 699 passed, 5 skipped** |
| `npm run lint` | **verde** |
| `npm test --prefix app` | **15 arquivos, 111 passed** |
| `npm run build --prefix app` | **verde** (guarda de estilo + "nenhum dado de exemplo no bundle") |

Os 5 testes pulados da raiz são os fixtures opcionais pré-existentes (`tests/fixtures/pt-html/`).

## 5. Desvios e observações

- **Idempotência inclui a `regra`.** A tarefa diz "mesmos valor, trecho, documento e nota"; a implementação
  também compara a `regra`, porque é ela que explica à pessoa de onde veio a data. Assim, corrigir a regra
  gera uma versão nova (e o painel mostra a vigente), em vez de devolver em silêncio um registro com a
  explicação errada. O resto do contrato é comparado como pedido (valor, trecho, documento, página e nota).
- **`versoes_anteriores` é uma lista**, não um contador: cada item traz `id`, `valor`, `regra`, `criado_em`,
  `autor`, `origem` e `conferido_em`. O painel não a expande nesta fase; ela existe para a próxima tela de
  histórico. Não inclui `nota` (a nota pode ser interna).
- **`criado_em` com `clock_timestamp()` na RPC.** A coluna tem `default now()`, mas uma mesma transação pode
  registrar vários termos; `now()` seria o início da transação e duas versões do mesmo termo empatariam,
  deixando a ordem para o UUID. O default continua `now()` para INSERT direto.
- **`usar_vigencia` preserva `active`.** O gatilho `trg_auto_reactivate_project` (020) reativa projeto inativo
  quando `end_date` vira futuro. A RPC restaura o `active` anterior num segundo UPDATE que não muda
  `end_date` (o gatilho não dispara de novo). O teste do 63.INAT prova. O `updated_at` muda pelo gatilho da
  001; é a única outra coluna que se move, e o teste o exclui de propósito.
- **`registrar` aceita projeto inativo** (só exige que exista). O histórico de um contrato pode precisar ser
  registrado antes de o centro voltar a ficar ativo; a tela só mostra centros ativos, e a escrita continua
  exclusiva do admin humano.
- **Modo exemplo devolve a `nota` para todo mundo.** Não há papel no `dadosExemplo.js`; a tela só a renderiza
  para `isAdmin`. O mascaramento real é o da RPC (testado no PGlite: professor e agente recebem `null`).
- **Cofre**: a 067 tem policy e funções `security definer`; pela regra do cofre, o relatório vai pedir revisão
  técnica do SQL. Por instrução desta tarefa, **nenhuma outra IA foi chamada**; a revisão fica para o Victor
  decidir. A migração não foi aplicada nem ensaiada.
- **Nada de produção**: não foi executado `ensaiar`/`aplicar`, nenhuma chamada ao Supabase de produção, nenhum
  `git push`, nenhuma variável `CF_*` real.

## 6. Pronto quando

- Runner PGlite: **ok**.
- `npx vitest run` e `npm run lint`: **ok**.
- Testes e build de `app/`: **ok**.
- Linha da 067 em `docs/migracoes.md` ("ainda não aplicada"): **ok**.
- Relatório: este arquivo.
- Commit inclui `docs/redesenho/tarefas/F3-A-termos-contrato.md`: **ok** (commit local, sem push).

## 7. 2ª rodada — taxa total e fonte no próprio sistema (19/11/2026)

O levantamento dos contratos mostrou dois casos que a 1ª rodada não cobria: financiador que fixa só o
percentual total (a divisão UFG/unidade/fundação aparece só em reais no plano) e valor que sai de um plano já
importado (em `documentos`, 064), não de um arquivo do Drive. Esta seção cobre o que mudou e os testes.

### 7.1. Tamanho dos arquivos nesta rodada

| Arquivo | Bytes | Linhas |
|---|---:|---:|
| `database/067_termos_contrato.sql` | **40.477** | 1.001 |
| `tests/sql/test_067_termos_contrato.sql` | **30.944** | 703 |
| `tools/replica-local/rodar-067-pglite.mjs` | **12.083** | 313 |
| `app/src/paginas/Projeto.jsx` | 78.960 | 2.260 |
| `app/src/servicos/dados.js` | 18.205 | 611 |
| `app/src/servicos/dadosExemplo.js` | 70.613 | 2.228 |
| `app/tests/termos-contrato.test.jsx` | 16.453 | 517 |

A migração continua abaixo de 90 KB, com `begin;`/`commit;` nas pontas e sem termos proibidos do cofre.

### 7.2. Banco

- **`taxa_total`** entrou na lista de termos e no CHECK de valor: é taxa, só aceita `valor_pct` entre 0 e 100
  (nada de `valor_data`). A divisão por rubrica (`taxa_cip_ufg`/`taxa_cip_ua`/`taxa_dao`) continua como antes.
  O banco **não** compara `taxa_total` com a soma das rubricas; se o contrato diz 16% e o plano diz 8+8+10=26%,
  as duas linhas ficam gravadas e a tela mostra os dois números. A nota (admin) é que explica.
- **`documento_id uuid references public.documentos(id) on delete restrict`** (opcional). A tabela ganhou
  `termos_contrato_documento_fonte_check`: pelo menos um entre `documento_url` e `documento_id`. A RPC valida
  que o documento existe **e é do mesmo centro**. O índice `idx_termos_contrato_documento` cobre a FK.
- `registrar_termo_contrato_v2` aceita `documento_id`, valida UUID/existência/centro e exige a fonte; a
  idempotência passou a comparar também `documento_id`.
- `get_termos_contrato_v2` devolve `documento_id` e, quando há documento, o metadado da **versão mais recente**
  de `documento_versoes` (`bucket`, `caminho`, `arquivo_nome`, `formato`, `versao`, `registrado_em`). Para o
  agente, `documento` vai `null` (o caminho do plano não é exposto a ele); professor e admin recebem.
- **Não foi criada RPC nova.** O painel usa o metadado que o `get` já devolve e o mesmo serviço/visualizador da
  aba Documentos (`arquivoDeOrigem` + componente `Documento`). O `get_origem_v2` não foi usado.
- As asserções da 067 ganharam a FK de documento (`RESTRICT`), o CHECK de fonte, `taxa_total` no CHECK do termo,
  o índice novo e a coluna `documento_id` no contrato de esquema.

### 7.3. Tela

- Cabeçalho:
  - só `taxa_total`: `Taxas do contrato: 12,5% no total`;
  - total e divisão: `Taxas do contrato: 16% no total · por rubrica: 26% (UFG 8 · unidade 8 · fundação 10)`;
  - só divisão: como na 1ª rodada, `Taxas do contrato: 26% (UFG 8 · unidade 8 · fundação 10)`.
  Em nenhum caso a tela corrige ou recalcula: a soma é só de exibição e os dois números ficam visíveis.
- Painel "Do contrato": cartão "Taxa total do contrato"; documento com `documento_url` mostra "Abrir no
  Drive"; com `documento_id` e metadado mostra **"Abrir o plano"**, que abre o componente `Documento` (mesmo
  visualizador da aba Documentos). Sem metadado (ex.: modo exemplo sem o arquivo), fica só o nome do documento,
  sem link.
- `dados.js`: o validador aceita `documento_id`/`documento`, exige ao menos uma fonte e rejeita metadado de
  documento sem `bucket`/`caminho` ou formato desconhecido.
- `dadosExemplo.js`:
  - **30.901** só tem `taxa_total` (12,5%) e `documento_id` para um plano, sem `documento` (o modo exemplo não
    tem o arquivo do plano; o painel mostra o nome, sem link);
  - **30.902** tem `taxa_total` 16% e a divisão 8+8+10=26% que não bate, com nota explicando;
  - **30.904** continua com divisão por rubrica (4+4+5=13%) e sem total, cobrindo o caso "só divisão".
- Testes do app: "só total", "total + divisão sem corrigir", "Abrir o plano" (chama `arquivoDeOrigem` e abre o
  `Documento` com o título) e o modo exemplo atualizado (3/6/0/4 termos nos quatro centros).

### 7.4. Testes e resultados

- `test_067` ganhou: `taxa_total` com `valor_data` recusada; fonte ausente recusada (`22023` e CHECK `23514`);
  `documento_id` de outro centro/não existente/inválido recusados; `taxa_total` com `documento_id` do plano do
  51.X; `get` devolvendo `documento_id` e o metadado da versão mais recente (bucket/caminho/formato/versão);
  professor vendo o metadado, agente recebendo `documento: null`; total 12,5 × divisão 26 sem correção. As
  contagens do 51.X passaram a 6 (antes da versão nova) e 7 (depois); o total geral, a 10.
- O runner passou a carregar **064 + `stub-064`** antes da 067 (a FK `documento_id` e o teste de plano precisam
  de `documentos`/`documento_versoes`) e ganhou **2 mutantes novos**: termo sem `taxa_total` no CHECK da tabela
  e `registrar` sem exigir `documento_url`/`documento_id`. Total: **7 mutantes**, todos detectados.
- Comandos:

| Comando | Resultado |
|---|---|
| `node tools/replica-local/rodar-067-pglite.mjs` | **verde** (7 mutantes) |
| `npx vitest run` | **44 arquivos, 699 passed, 5 skipped** |
| `npm run lint` | **verde** |
| `npm test --prefix app` | **15 arquivos, 114 passed** |
| `npm run build --prefix app` | **verde** |

### 7.5. Desvios e observações desta rodada

- **Metadado do documento na RPC, não RPC nova.** Era o único caminho sem inventar RPC para abrir o plano pelo
  mesmo visualizador. O `get_termos_contrato_v2` é `security definer` e já estava autorizado pelo escopo; o
  metadado é o da versão mais recente e só é devolvido para humano (agente recebe `null`). O exemplo não tem o
  arquivo do plano, então mostra só o nome — o caminho real é testado no SQL e no teste de tela com mock.
- **Diferença total × divisão não é erro de gravação.** O banco aceita as duas linhas e a tela mostra os dois
  números; a nota (só admin) explica. Não há alerta automático nem "correção" silenciosa.
- **A nota continua admin-only.** O professor vê os dois números no cabeçalho e no painel, mas não a análise
  interna que explica a diferença. É a mesma regra da 1ª rodada.
- **`documento_id` é do mesmo centro.** A RPC recusa documento de outro projeto; a FK sozinha não faria essa
  checagem.
- **Nada de produção**: sem `ensaiar`/`aplicar`, sem push, sem `CF_*` real e sem outra IA.

### 7.6. Pronto quando (2ª rodada)

- Runner PGlite com 064/stub-064: **ok** (7 mutantes).
- `npx vitest run`, `npm run lint`, testes e build de `app/`: **ok**.
- Linha da 067 em `docs/migracoes.md` atualizada: **ok**.
- Relatório com esta seção: **ok**.
- Commit novo incluindo `docs/redesenho/tarefas/F3-A-rodada2.md`: **ok** (local, sem push).
