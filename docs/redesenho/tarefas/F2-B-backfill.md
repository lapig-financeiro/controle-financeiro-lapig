# F2-B — Achar cada número no documento e preencher o histórico (script de backfill)

Executor: **DeepSeek V4.1 Flash max** (opencode), num worktree próprio **fora do OneDrive** (branch
`redesenho/f2-b-backfill`). Roda em paralelo com a 065 (`F2-E-065.md`): **sem arquivo em comum**.

Antes de começar, leia: `CLAUDE.md`, `docs/acesso-ao-banco.md` (regras de escrita em produção),
`docs/redesenho/README.md` §4 e §6 (F2), `docs/redesenho/tarefas/F2-A-banco.md` (com as três rodadas: o contrato
de `registrar_documento_v2` está lá e em `database/064_rastreabilidade.sql`, já aplicada em produção),
`frontend/js/origem-busca.js` (`linhasDaPagina`, `acharAlvo`), `frontend/js/parsers/pdf-texto.js`,
`mcp/src/buriti-proposta.js` (`textoDoPdf`: como o MCP já lê PDF no Node) e `mcp/src/client.js`.

**Você não escreve em produção.** Escreve o script e os testes, roda contra o banco local (pglite) e para. Quem
roda o script na produção é o Claude, primeiro em modo simulação e depois aplicando, em turnos separados.

## Arquivos (só estes)
- `tools/rastreabilidade/backfill.mjs` (novo) e módulos em `tools/rastreabilidade/*.mjs`
- `tools/rastreabilidade/README.md` (novo: como rodar, o que imprime, o que nunca imprime)
- `tests/rastreabilidade-*.test.js` (novos)
- `docs/redesenho/relatorios/F2-B.md` (novo)
Se precisar de dependência, use as que já existem (`pdfjs-dist` de `mcp/`, `mammoth` da raiz); não acrescente
nada ao `package.json` sem registrar no relatório.

## O que o script faz
Uso: `node tools/rastreabilidade/backfill.mjs [--aplicar] [--centro 30.117] [--saida <pasta fora do repo>]`.
Sem `--aplicar`, **só simula** (não chama `registrar_documento_v2`).
1. Login como admin com `CF_SUPABASE_URL`, `CF_SUPABASE_ANON_KEY`, `CF_EMAIL`, `CF_PASSWORD` do ambiente (nunca
   imprime nenhum deles). Lê só pela API REST/RPC com o JWT (o RLS vale).
2. **Escopo**: balancetes com `data_referencia` no ano corrente, de projetos ativos, com
   `arquivo_storage_path`; e o plano **ativo** de cada projeto ativo, com `arquivo_storage_path`. O resto é
   "legado" e fica como está.
3. Para cada documento: baixa o arquivo do bucket (`balancete-pdfs` / `plano-trabalho-docs`) pela URL
   assinada, calcula o `sha256`, extrai o texto.
   - **PDF**: páginas com `linhasDaPagina` (texto + coordenadas). Para cada número vigente do documento,
     monta o `alvo` como a 064 monta o `busca` do legado e chama `acharAlvo`. Só vira fato o que for achado
     **sem ambiguidade** (um resultado, ou o primeiro por critério de código quando houver código), com
     `pagina`, `trecho` (a linha inteira, até 500 caracteres) e `bbox`.
   - **DOCX** (planos): texto por parágrafo/linha de tabela (mammoth); `pagina` e `bbox` nulos.
   - Números por tipo: balancete → `balancetes` (`saldo_disponivel`, `rendimento_liquido`, `total_debitos`,
     `total_creditos`, quando não nulos) e `balancete_lancamentos` (`saldo_atual` de cada linha com rubrica);
     plano → `plano_rubricas.valor_previsto`, `plano_desembolsos.valor` (não nulos) e
     `planos_trabalho.valor_total_plano`.
   - `valor` do fato = o valor gravado hoje no banco (a RPC confere); o trecho tem de conter esse valor
     formatado como no documento — senão não é fato.
4. **CPF**: antes de mandar, cada `trecho` passa por um `temCpf` em JS que espelha `contem_cpf` (dígito
   verificador) **e** a normalização de `_tem_cpf` da 064 (sequências de não dígitos entre dígitos). Fato com
   CPF fica de fora (vira legado). Se mesmo assim a RPC recusar por CPF, tire os fatos suspeitos e tente de
   novo uma vez; se recusar de novo, pule o documento e registre.
5. Com `--aplicar`: uma chamada de `registrar_documento_v2` por documento (`origem: 'backfill'`,
   `parser: 'backfill-acharAlvo'`, `parser_versao` = versão do script; chave canônica da 064). Idempotente: rodar
   de novo não cria nada (mesmo `sha256`).
6. **Saída**: no terminal, só contagens por centro e por documento (achados, não achados, ambíguos, com CPF,
   recusados) — **nunca** trecho, nome de pessoa ou valor de bolsa. O detalhe (com trechos) vai para um arquivo
   JSON na pasta `--saida`, que tem de estar **fora do repositório** (o script recusa pasta dentro dele).

## Testes
- Unitários (vitest, sem rede): `temCpf` (pontuado, espaçado, barra, NBSP, DV inválido não é CPF, linha
  de balancete cheia de números não é CPF); montagem do alvo por tipo; escolha sem ambiguidade; formatação do
  valor no trecho.
- Ponta a ponta local: um PDF de balancete **sintético** gerado no teste (como `app/scripts/gerar-pdf-exemplo.mjs`
  faz) + a base pglite da 064 (`tools/replica-local/rodar-064-pglite.mjs` exporta `montarBase064`): o payload
  montado pelo script é aceito por `registrar_documento_v2`, e depois `get_origem_v2` da linha devolve
  `documento` com a página certa. Rodar duas vezes não cria versão nova. Se o pglite não estiver instalado, o
  teste se pula com aviso (como `tests/origem-busca-064.test.js`).
- Um teste que prova que a saída do terminal não contém o trecho.

## Pronto quando
`npm run lint` e `npm test` verdes; relatório `docs/redesenho/relatorios/F2-B.md` com o que fez, como testou e
o que ficou em aberto; commit na branch. **Sem push, sem rodar contra a produção.**

## Correções depois da revisão (19/11, MiniMax 3.1 Flash max, conferidas pelo Claude) — valem por cima do texto acima
1. **CPF**: `temCpf` segue a "Regra de CPF única" abaixo (a da 065, que será aplicada antes do backfill). Antes
   de chamar a RPC, aplique-o também à **concatenação** na ordem da RPC (caminho relativo, `titulo`,
   `arquivo_nome`, todos os trechos do payload): CPF partido entre dois trechos derruba o documento inteiro.
   Se a concatenação tiver CPF, remova os fatos envolvidos (por bissecção) até ficar limpa. CPF em `titulo`,
   `arquivo_nome` ou `caminho` = **documento recusado por CPF no nome** (sem retentativa).
2. **Credencial**: login de **admin humano** (as variáveis `CF_*` do ambiente de quem roda). Antes de qualquer
   leitura, o script lê o próprio papel (`app_users`, como `quem_sou_eu`) e **aborta** se não for `admin`.
   Tabela que volta vazia quando não deveria (lançamentos de um balancete que tem lançamentos) = erro, nunca
   zero. Isto é desvio declarado da regra 9 de `docs/acesso-ao-banco.md` ("automação nunca usa admin"): a 064
   só aceita admin; quem roda é o Claude, à mão, simulação e aplicação em turnos separados, sem agendamento e
   sem CI. Escreva isso no README do script e no relatório.
3. **Não reutilize `mcp/src/client.js` como está** (ele imprime o e-mail). Cliente próprio que nunca imprime
   credencial; identificadores seguros na saída: papel, código do centro, id do documento.
4. **Payload literal** (por documento, uma chamada só, com **todos** os fatos — a 064 ignora fatos novos quando
   o `sha256` já existe):
   `{ project_id, tipo: 'balancete'|'plano', chave: 'balancete:<project_id>:<AAAA-MM-DD>' | 'plano:<project_id>:<plano_id>',
   titulo: 'Balancete de mmm/aa' | 'Plano de trabalho v<versao>' (ou o título já gravado em `documentos`, se houver),
   sha256, bucket, caminho: arquivo_storage_path, arquivo_nome, formato, paginas (total do PDF; null em DOCX),
   parser: 'backfill-acharAlvo', parser_versao, origem: 'backfill',
   fatos: [ { alvo_tabela, alvo_id (id de hoje da linha), campo, valor (número JSON cru), pagina, trecho, bbox: {x0,x1,yMin,yMax} | null } ] }`.
   Nada de `alvo_pai_id`/`alvo_chave` no payload (a RPC recusa).
5. **Pré-validação local** de tudo o que a RPC recusa: valor igual ao gravado; alvo do balancete da data / do
   plano da chave; rubrica ambígua (mesmo `rubrica_code` e `descricao_livre` vazia/nula duplicada → fora); fato
   duplicado; CPF. Recusa da RPC mesmo assim → contagem **com o motivo** (CPF, divergência, ambígua, duplicado,
   outro), sem despejar o `detail` cru.
6. **Já registrado** (`criada: false`): o script avisa "documento já registrado, N fatos novos ignorados".
   Corrigir depois exige a F3 ou intervenção manual; diga isso no README.
7. **Escolha da linha**: a linha só vira fato se contiver o **valor formatado** (`1.234,56` ou `(1.234,56)`, com
   `formatarValor` de `origem-busca.js`) **e** o código da conta (lançamento) ou o texto (rubrica/parcela/
   cabeçalho). Ambíguo = mais de uma linha que satisfaz isso → não é fato. Para rubrica, o alvo do `acharAlvo`
   é `{texto}` com o valor só como desempate. Valor zero não é procurado (o `acharAlvo` não acha zero):
   registre no relatório.
8. **PDF**: use o laço por página de `frontend/js/components/origem-documento.js` (`getTextContent` →
   `linhasDaPagina`), não `textoDoPdf`. `bbox` = só as 4 chaves de `linhasDaPagina`; `trecho` truncado em 500 —
   se o valor ficar fora do corte, não é fato.
9. **Formato**: pela extensão do caminho (como a 064) e conferido pelos primeiros bytes (`%PDF`, `PK`). Plano
   que não seja PDF nem DOCX fica de fora com o motivo. **DOCX**: `convertToHtml` do mammoth → `linkedom` (já é
   dependência); cada `<tr>` e cada `<p>` é uma linha; texto desescapado.
10. **Dependências**: `pdfjs-dist` vem de `mcp/` (`npm --prefix mcp ci` no worktree); não acrescente ao
    `package.json` da raiz.
11. **Testes sem PostgREST**: a camada de rede do script é **injetável** (cliente falso nos testes). O ponta a
    ponta usa o pglite para provar que o **payload** é aceito por `registrar_documento_v2` com o JWT do admin
    sintético (receita em `tests/origem-busca-064.test.js`). Instale o pglite
    (`npm install --prefix .cache/pglite-064 --no-save --package-lock=false @electric-sql/pglite`); "verde com o
    ponta a ponta pulado" **não** é pronto.
12. **Lint**: rode também `npx eslint tools/rastreabilidade/` (o `npm run lint` não cobre `tools/`).
13. **Repositório público**: relatório e README só com contagens e códigos de centro — nunca trecho, nome,
    CPF, nome de arquivo ou valor de bolsa. O teste da saída usa um trecho sintético não trivial e confere
    terminal, relatório e README.
14. **Escopo**: `projects.active`, `projects.code`, `planos_trabalho.ativo`, `balancetes.data_referencia`;
    `--centro` que não acha exatamente um projeto aborta. `--saida`: caminho real resolvido, fora da raiz do
    worktree (comparação sem diferenciar maiúsculas no Windows).

## Regra de CPF única (vale igual na 065 e no `temCpf` da F2-B)
Um texto **tem CPF** quando `contem_cpf(texto)` (052) é verdadeiro **ou** quando existe um **candidato**: 11
dígitos em quatro grupos de 3-3-3-2 dígitos **contíguos**, sem dígito colado antes do primeiro grupo nem depois
do último, separados por **vãos de 0 a 6 caracteres que não são dígito nem letra** (qualquer espaço ou pontuação
Unicode: ponto, vírgula, traço, travessão, barra, NBSP, quebra de linha…), e os 11 dígitos passam no dígito
verificador (o mesmo cálculo de `contem_cpf`; 11 dígitos iguais não são CPF). **Letra no vão quebra o candidato.**
Procure candidatos a partir de **cada** posição de início possível (não só os achados sem sobreposição), para um
número vizinho não "roubar" dígitos do CPF.
`_mascarar_cpf` troca exatamente os candidatos que a regra aceita (com DV válido) por `***.***.***-**`;
`_cpfs` devolve exatamente os 11 dígitos desses candidatos. As três funções usam a mesma gramática.
Casos que a suíte das duas tarefas tem de cobrir (mesmas strings nas duas):
- verdadeiro: `529.982.247-25`; `52998224725`; `529 982 247 25`; `529/982/247/25`; `529,,,,,982,,,,,247,,,,,25`;
  `529` NBSP `982` NBSP `247` NBSP `25`; `529–982–247–25`; `'1.234,56 NOME 529.982.247-25'`; `'100 529.982.247-25'`.
- falso: `123.456.789-00` (DV inválido); `111.111.111-11`; `529982247250` (12 dígitos);
  `'7.1.3.05.01.00042 2506042'`; `'7.1.3.04.01.09142 09142 BOLSA DOACAO PESQUISA 380.000,00 0,00 380.000,00'`;
  `'rubrica 529 e 982 com valor 247,25'` (letras nos vãos); `'{"saldo": 1107372.93, "conta": "7.1.3.05.01.00042", "red": "71199553"}'`.
- máscara: `_tem_cpf(_mascarar_cpf(x))` é falso para todos os verdadeiros, e `_mascarar_cpf(x) = x` para os falsos.
- Na 065, a nova `_tem_cpf` **substitui** a regra da 064 por esta (contem_cpf OU candidato); a remoção de 1–3 caracteres quaisquer da 064 sai (ela juntava números separados por letras).
- Até a 065 ser aplicada, o ponta a ponta roda sobre a 064 com fixtures sem CPF; o backfill na produção só roda depois da 065.
