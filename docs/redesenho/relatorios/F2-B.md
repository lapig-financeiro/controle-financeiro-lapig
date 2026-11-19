# F2-B — backfill da rastreabilidade (relatório)

## O que foi feito

- `tools/rastreabilidade/backfill.mjs`: CLI (`--aplicar`, `--centro`, `--saida`),
  leitura das quatro variáveis `CF_*`, checagem de papel **antes** de qualquer
  leitura de dados, simulação sem RPC e gravação do JSON de detalhe fora do repo.
- `tools/rastreabilidade/cliente.mjs`: cliente Supabase próprio, sobre `fetch`, que
  nunca imprime credencial (o `mcp/src/client.js` imprimia o e-mail) e pagina as
  leituras REST com o JWT do admin.
- `tools/rastreabilidade/executar.mjs`: orquestração injetável (a rede é um objeto
  `cliente`), escopo, montagem do payload literal da 064, pré-validação local,
  remoção de fatos com CPF (inclusive CPF partido entre trechos), retentativa única
  na recusa por CPF, idempotência, contagens e texto do terminal.
- `tools/rastreabilidade/cpf.mjs`: a **Regra de CPF única** da 065 em JS (052 +
  candidato 3-3-3-2 com vãos de 0 a 6 não-dígito/não-letra, DV válido, busca a partir
  de cada posição), com `mascararCpf`/`cpfsDe` na mesma gramática.
- `tools/rastreabilidade/alvo.mjs`: montagem do `alvo` por tipo e escolha da linha
  (valor formatado **e** código/texto; mais de uma linha = ambíguo; corte de 500;
  `bbox` só com as quatro chaves de `linhasDaPagina`).
- `tools/rastreabilidade/documento.mjs`: PDF pelo `pdf.js` de `mcp/` (laço
  `getTextContent` → `linhasDaPagina` de `origem-documento.js`), DOCX por
  `mammoth.convertToHtml` + `linkedom`, formato pela extensão conferido pelos
  primeiros bytes.
- `tools/rastreabilidade/erros.mjs`: separa erro seguro (vai ao terminal) de erro de
  RPC/PostgREST (só vira motivo, nunca é despejado).
- `tools/rastreabilidade/README.md`: como rodar, o que imprime, o que nunca imprime,
  o desvio declarado da regra 9 e o aviso de "já registrado".
- Testes novos: `tests/rastreabilidade-cpf.test.js`,
  `tests/rastreabilidade-alvo.test.js`, `tests/rastreabilidade-documento.test.js`,
  `tests/rastreabilidade-fluxo.test.js`, `tests/rastreabilidade-saida.test.js` e
  `tests/rastreabilidade-backfill-064.test.js` (pglite).

## Decisões e desvios do plano

1. **Admin humano é intencional.** A 064 só aceita `admin`; o script lê o próprio
   papel em `app_users` e aborta se não for `admin`. É o desvio declarado da regra 9
   de `docs/acesso-ao-banco.md`, registrado no README e neste relatório: execução
   manual, simulação e aplicação em turnos separados, sem agendamento e sem CI.
2. **CPF antes da RPC.** A regra da 065 é aplicada por trecho, nos metadados e na
   concatenação na ordem da RPC (caminho relativo, título, arquivo, trechos). Um CPF
   partido entre dois trechos é removido por bissecção; CPF no nome do documento
   recusa o documento sem retentativa. A retentativa única usa a regra mais larga da
   064 só para achar os fatos suspeitos; sem suspeito, o documento é recusado sem
   segunda chamada (2ª rodada, correção 3).
3. **Zero não é procurado.** O `acharAlvo` não acha zero; esses números entram na
   contagem `zeros` e não viram fato.
4. **Rubrica ambígua e fato duplicado.** Rubrica com mesmo `rubrica_code` e
   `descricao_livre` nula/vazia duplicada fica de fora antes da RPC, porque a 064
   recusaria o documento inteiro. Fato com a mesma chave estável (tabela, pai,
   chave e campo) é contado como duplicado e não entra no payload.
5. **Tabela inconsistente recusa um documento, não a corrida.** Se o `raw_extraction`
   de um balancete tem mais lançamentos do que a consulta devolveu (inclusive zero),
   aquele balancete vira `recusado`/`lancamentos_inconsistentes` e os outros seguem; o
   script nunca grava uma leitura parcial como se fosse completa (2ª rodada, correção
   6).
6. **Idempotência.** O mesmo `sha256` devolve `criada: false`; o script avisa quantos
   fatos novos foram ignorados. Corrigir depois exige a F3 ou intervenção manual.
7. **DOCX.** Cada `<tr>` e cada `<p>` fora de tabela é uma linha no formato
   `{ texto }` (o mesmo de `linhasDaPagina`); `<p>` dentro de `<td>` não vira linha
   própria para não repetir a célula. O texto do mammoth é desescapado pelo
   `linkedom`.
8. **Saída.** O terminal só usa contagens, código de centro, id de documento,
   data/versão e motivo de recusa. O JSON de detalhe (com trechos) vai para
   `--saida`, fora do worktree; a pasta é resolvida, validada e criada antes de
   qualquer leitura (inclusive do ambiente) e é recusada se estiver dentro do repo
   (sem diferenciar maiúsculas no Windows).
9. **Dependências.** `pdfjs-dist` vem de `mcp/` (via `npm --prefix mcp ci`);
   `mammoth` e `linkedom` já eram dependências da raiz. Nada foi acrescentado ao
   `package.json` da raiz. O pglite dos testes fica em `.cache/pglite-064`, fora do
   git.
10. **Escopo.** `projects.active`, `projects.code`, `planos_trabalho.ativo` e
    `balancetes.data_referencia`; `--centro` que não acha exatamente um projeto
    ativo aborta. Se houver mais de um plano ativo por projeto (o índice da 025
    impede), o script usa o de maior versão.

## Como foi testado

- `npx vitest run tests/rastreabilidade-cpf.test.js` — casos da regra de CPF
  (pontuado, espaçado, barra, NBSP, travessão, DV inválido, 12 dígitos, linha de
  balancete, letras nos vãos, máscara), as quatro checagens largas da 064 (vãos de
  1–4 letras e 5+ separadores) e CPF partido entre trechos (bissecção).
- `tests/rastreabilidade-alvo.test.js` — montagem do alvo por tipo, escolha sem
  ambiguidade, ambiguidade com duas linhas, valor dentro de outro número, negativo
  entre parênteses, zero, código cortado com `#`, corte de 500, `bbox`, fato DOCX e
  leitura do valor a partir do trecho (com dois números na mesma linha).
- `tests/rastreabilidade-documento.test.js` — formato pelos bytes, extensão que
  mente, DOCX sintético pelo mammoth (linhas `{ texto }`, `<tr>` como linha, `<p>` de
  célula sem repetição, texto desescapado, linha de equipe com CPF detectada).
- `tests/rastreabilidade-fluxo.test.js` — papel não-admin aborta antes de ler dados;
  `--centro` inexistente aborta; lançamentos vazios/menos linhas que o
  `raw_extraction` recusam só aquele documento; `sem_fatos` sem RPC (inclusive
  depois de a retentativa por CPF esvaziar os fatos); recusa por CPF sem suspeito não
  faz segunda chamada; `ErroFatal` de sessão não vira recusa; o cliente HTTP trata 401
  como `login expirou`.
- `tests/rastreabilidade-saida.test.js` — o terminal não contém trecho, título,
  arquivo ou valor; o detalhe contém o trecho; relatório e README não contêm o trecho
  sintético; `--saida` dentro do repo é recusada (inclusive variação de maiúsculas no
  Windows) antes de ler o ambiente; `--centro`/`--saida` recusam valor que comece por
  `--`.
- `tests/rastreabilidade-backfill-064.test.js` — ponta a ponta no pglite com um PDF
  sintético de 2 páginas (9 fatos, 1 zero, simulação sem RPC; aplicação aceita por
  `registrar_documento_v2`; `get_origem_v2` devolve `documento` com a página certa,
  inclusive bbox; segunda aplicação não cria versão nova) e com um DOCX sintético
  gerado no teste (3 fatos; `get_origem_v2` devolve `documento` com `pagina` nula;
  segunda aplicação não cria versão nova).

## Resultados

- `npx eslint tools/rastreabilidade/` — verde.
- `npm run lint` — verde.
- `npm test` — verde, com o ponta a ponta do pglite executado (não pulado):
  662 testes passaram e 5 pulos de outras suítes, não desta.
- Nenhum documento real foi baixado e nenhuma variável `CF_*` real foi usada nesta
  execução. As contagens acima são de fixtures sintéticas (centros `99.E2E` e
  `99.E2D`).

## 2ª rodada (revisão GLM 5.3 do commit 237ce44)

Nove correções pedidas em `docs/redesenho/tarefas/F2-B-rodada2.md`:

1. **DOCX no formato certo.** `linhasDoHtmlDocx`/`lerDocx` devolvem `{ texto }`, como
   `linhasDaPagina`; antes devolviam string e `escolherLinha` não achava nada em
   plano DOCX. Agora há ponta a ponta com um DOCX sintético gerado no teste, passando
   pela saída real do `lerDocx` até `registrar_documento_v2` no pglite: 3 fatos,
   `get_origem_v2` devolve `documento` com `pagina` nula para o total e as duas
   rubricas, e a segunda aplicação não cria versão nova.
2. **Nunca zero fatos.** Documento sem fato vira o status próprio `sem_fatos`, sem
   chamar a RPC; o status aparece no terminal por documento e a contagem no resumo do
   terminal e do JSON. Vale também quando a retentativa por CPF esvazia os fatos.
3. **Retentativa por CPF sem suspeito.** Se a RPC recusa por CPF e a regra larga da
   064 não aponta nenhum trecho suspeito, o documento é pulado com `recusado`/`cpf`
   sem segunda chamada.
4. **`temCpfLargo064` com as quatro checagens da 064.** Inclui o padrão 3-3-3-2 com
   vãos de até 4 caracteres quaisquer (letras inclusive) e 5+ separadores. Teste com
   um CPF sintético quebrado por quatro letras em cada vão: a regra da 065 não vê
   CPF, a larga da 064 vê.
5. **`--saida` antes de tudo.** A pasta é validada e criada antes de ler o ambiente,
   autenticar, baixar ou gravar. Teste prova que uma pasta dentro do repositório falha
   antes de a falta de `CF_*` ser reclamada.
6. **Balancete inconsistente recusa só ele.** `raw_extraction` com mais lançamentos do
   que a tabela (inclusive tabela vazia) vira `recusado`/`lancamentos_inconsistentes`
   para aquele documento, sem baixar o arquivo, e a corrida continua.
7. **Pré-validação de valor lida do trecho.** O número é extraído do texto do trecho
   (formato do documento, negativos entre parênteses) e comparado com o valor do
   fato; não se compara o valor com ele mesmo. O limite fica registrado no README: a
   divergência entre documento e banco que o trecho não revela continua sendo pega só
   pela RPC.
8. **401/403 abortam.** Leitura, Storage e RPC tratam 401/403 como sessão expirada:
   `ErroFatal('login expirou: rode de novo')`, código de saída ≠ 0, em vez de
   `recusado (outro)`. Os `catch` por documento reidratam o `ErroFatal` para não
   engoli-lo.
9. **Argumentos.** `--centro` e `--saida` recusam valor vazio ou que comece por `--`,
   tanto na forma separada quanto em `--chave=valor`.

Testes da rodada: `tests/rastreabilidade-cpf.test.js`,
`tests/rastreabilidade-alvo.test.js`, `tests/rastreabilidade-documento.test.js`,
`tests/rastreabilidade-fluxo.test.js`, `tests/rastreabilidade-saida.test.js` e
`tests/rastreabilidade-backfill-064.test.js` (ponta a ponta com PDF e DOCX). O
`parser_versao` continua `1.0.0` porque nada foi aplicado em produção antes desta
revisão.

## O que ficou em aberto

- **Rodar na produção** (operador, primeiro em simulação e depois aplicando, em
  turnos separados) **depois** de a 065 ser aplicada. O script está pronto, mas não
  foi executado contra o Supabase.
- O `criada: false` ignora fatos novos por desenho da 064; corrigir uma leitura errada
  depois disso depende da F3 ou de intervenção manual.
- Arquivos ausentes no Storage, formato divergente e caminho inválido recusam o
  documento com o motivo; o relatório da execução real deve mostrar essas contagens.
- Valores zero não são rastreados (o `acharAlvo` não acha zero). A F3/F5 pode decidir
  uma forma de marcar zero com origem.
- A pré-validação de valor confere o número que o próprio trecho imprime; uma
  divergência entre o valor do banco e o do documento que não apareça no texto só é
  pega pela RPC (com o motivo `divergencia` na contagem).
- Se a consulta de lançamentos voltar com menos linhas do que o `raw_extraction`
  indica, o documento é recusado sozinho (`lancamentos_inconsistentes`). Uma base com
  `raw_extraction` histórico inconsistente precisa de revisão manual antes de contar
  com esses documentos no backfill.
- O cliente REST não renova o JWT sozinho. Se a sessão expirar no meio (HTTP 401/403),
  o script aborta com `login expirou: rode de novo` e código de saída ≠ 0; é só
  rodar de novo, e o que já foi aplicado não duplica.
