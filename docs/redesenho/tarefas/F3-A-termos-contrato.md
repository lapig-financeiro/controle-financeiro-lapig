# F3-A — migração 067 e tela: vigência e taxas lidas do contrato (19/11, pedido do Victor)

Worktree `C:/Users/amara/dev/cf-f2-e`, branch nova `redesenho/f3-a-termos` a partir do `master` (já criada). Relatório
em `docs/redesenho/relatorios/F3-A.md`, commit novo. Sem push, sem aplicar, sem `CF_*` reais. Leia antes o
`CLAUDE.md` (regras do cofre e de migração), `docs/migracoes.md` (linhas 063 a 066) e `database/063_*.sql` (tabela
`pendencias`: é o molde de tabela, RLS, gatilho do agente, RPC admin e asserções).

## Por quê (palavras do Victor)

"A vigência da Acelen foi digitada e eu não sei de onde ela veio... O certo seria olhar o contrato... isso pode ser
inserido por IA e ficar indicado isso... poderia ter um campo para essa sua descrição desse detalhe. Mas tudo isso só
seria mostrado no momento que alguém clica na vigência." Também: coletar a taxa (%) de cada projeto e mostrar no
site; e um campo para "qualquer análise ou comentário" da IA.

Caso real (só para entender; **não** use estes dados em teste): o contrato diz "vigência de 20 meses, contados a
partir da data de assinatura"; a última assinatura foi dias depois da primeira, então a data certa sai da última; o
banco tinha uma data digitada diferente. Taxas: UFG 8%, unidade 8%, fundação 10%.

## Banco: `database/067_termos_contrato.sql`

1. Tabela `public.termos_contrato`, **só insert** (histórico; o vigente é o mais recente por `(project_id, termo)`):
   - `id uuid pk default gen_random_uuid()`, `project_id uuid not null references projects(id) on delete cascade`;
   - `termo text not null check in ('vigencia_inicio', 'vigencia_fim', 'taxa_cip_ufg', 'taxa_cip_ua', 'taxa_dao')`
     (os códigos das taxas são os das rubricas da 066);
   - `valor_data date`, `valor_pct numeric(6,3)`; check: termos de vigência só com `valor_data`, termos de taxa só com
     `valor_pct` entre 0 e 100;
   - `regra text` (até 300: como a data foi obtida, ex.: "20 meses contados da última assinatura");
   - `trecho text not null` (1 a 600, o texto do contrato que sustenta o valor, sem CPF: check com
     `public.contem_cpf`, só chamar, nunca alterar);
   - `documento_nome text not null`, `documento_url text` (só `https://drive.google.com/...` ou `https://docs.google.com/...`,
     check), `pagina int` (>= 1 ou null);
   - `nota text` (até 2000: análise/comentário livre de quem registrou, ex.: divergência com o banco, aditivo,
     dúvida), `origem text not null check in ('ia', 'pessoa')`, `autor text not null` (até 60, ex.: "Claude");
   - `criado_em timestamptz not null default now()`, `criado_por uuid default auth.uid()`;
   - `conferido_em timestamptz`, `conferido_por uuid` (um humano confirmou; é o único UPDATE permitido, só pela RPC).
   - RLS ligado; SELECT por escopo igual à policy de `pendencias`; nenhuma policy de escrita; `revoke all ... from
     anon`; gatilho `trg_bloqueia_agente` BEFORE INSERT OR UPDATE OR DELETE FOR EACH STATEMENT sem WHEN.
2. RPCs (todas `security definer`, `set search_path = public, pg_temp`, `revoke ... from public, anon`, `grant ... to
   authenticated`):
   - `get_termos_contrato_v2(p_project_id uuid) returns jsonb`: `assert_project_allowed`; devolve
     `{ termos: { <termo>: { id, valor, regra, trecho, documento_nome, documento_url, pagina, nota, origem, autor,
     criado_em, conferido, conferido_em, versoes_anteriores } }, end_date_cadastro, vigencia_confere }`, onde
     `vigencia_confere` = `vigencia_fim` do contrato = `projects.end_date` (null se faltar um dos dois). `nota` só
     vai para admin (professor recebe null; a nota pode conter análise interna).
   - `registrar_termo_contrato_v2(p jsonb) returns jsonb`: só admin humano (`is_admin() and not is_agente()`, molde
     do `criar_pendencia_v2`); valida chaves permitidas e tipos; insere uma linha nova; devolve o id. Se o último
     registro do mesmo termo tiver os mesmos valor, trecho, documento e nota, não insere de novo (idempotente) e
     devolve o id existente.
   - `conferir_termo_contrato_v2(p_id uuid) returns jsonb`: só admin humano; marca `conferido_em/por` uma vez.
   - `usar_vigencia_do_contrato_v2(p_project_id uuid) returns jsonb`: só admin humano; copia o `vigencia_fim`
     vigente para `projects.end_date` (e `vigencia_inicio` para `start_date`, se existir e a coluna existir — confira
     o nome real das colunas em `projects`). Devolve o antes e o depois. Não toca em mais nada.
3. Nada muda em `get_saldo_livre`, `explicar_livre_v2`, `resumo_projetos_v2`. A vigência que vale para as contas
   continua sendo `projects.end_date`; a do contrato só entra lá pela RPC acima, por decisão humana.
4. Asserções no fim do arquivo, dentro de `begin/commit`: tabela com RLS, sem policy de escrita, gatilho do agente
   no formato exato, ACL (anon sem nada; authenticated só SELECT na tabela e EXECUTE nas RPCs), atributos das
   funções (`security definer`, `proconfig` exato). Regras do cofre: até 90 KB, BEGIN só na primeira linha e COMMIT
   só na última, nenhuma palavra proibida, nenhuma linha nova com `now()`/`gen_random_uuid()` gravada pela própria
   migração (ela não insere dados).
5. Roteiro `tests/sql/test_067_termos_contrato.sql` autoconferido + runner `tools/replica-local/rodar-067-pglite.mjs`
   (molde do `rodar-066-pglite.mjs`): professor só vê os do escopo e recebe `nota` null; agente não grava; anon não
   lê; trecho com CPF recusado; termo de taxa com data recusado; idempotência; `usar_vigencia_do_contrato_v2` muda
   só `end_date`/`start_date` do centro pedido. Linha da 067 em `docs/migracoes.md` ("ainda não aplicada").

## App v2 (`app/`)

1. `servicos/dados.js` + `dadosExemplo.js`: `termosContrato(projectId)` (modo exemplo com um centro que confere,
   um que diverge, um sem termos e um com nota).
2. `paginas/Projeto.jsx`, cabeçalho (perto da linha 555, onde hoje está "vigência digitada"):
   - com `vigencia_fim` do contrato que confere: "Vigência até dd/mm/aaaa · faltam N meses · **do contrato**" (a data
     vira botão);
   - que diverge: a data do cadastro continua, com "· contrato diz dd/mm/aaaa" em destaque de atenção;
   - sem termo: como hoje ("vigência digitada").
   - Taxas, quando houver algum termo de taxa: "Taxas do contrato: 26% (UFG 8 · unidade 8 · fundação 10)", também
     botão. Soma só para exibir; arredonde nada.
3. Clicar abre o `PainelLateral` "Do contrato" com, por termo: valor, `regra`, `trecho` (em citação), documento
   (link "Abrir no Drive" em nova aba, `rel="noopener noreferrer"`, página), "Registrado por <autor> (IA) em
   dd/mm/aaaa" ou "conferido em dd/mm/aaaa", e a `nota` (só admin). Para admin: botões "Marcar como conferido" e,
   quando diverge, "Usar a data do contrato" (com confirmação que mostra antes → depois). Depois de usar, recarrega
   o resumo e o saldo (a vigência muda a janela das bolsas).
4. Falha ao carregar termos nunca esconde a vigência do cadastro: mostra como hoje e um `—` discreto no lugar da
   etiqueta.
5. Testes em `app/tests/` para os quatro casos, para o painel (professor sem nota, admin com nota e botões) e para o
   fluxo "Usar a data do contrato".

## Verificação

`npx vitest run`, `npm run lint`, testes e build de `app/` verdes; o runner do pglite não pode ser pulado neste
worktree. Nenhum dado real em teste ou fixture.
