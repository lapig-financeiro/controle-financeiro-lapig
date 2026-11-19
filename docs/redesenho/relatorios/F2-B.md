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
  sintético; a frase de já registrado é exata; `--saida` dentro do repo é recusada
  (inclusive variação de maiúsculas no Windows) antes de ler o ambiente;
  `--centro`/`--saida` recusam valor que comece por `--`.
- `tests/rastreabilidade-cliente.test.js` — 200 ids em cada filtro `in.(...)` viram 4
  requisições de no máximo 50; a listagem não pede `raw_extraction` e a leitura por
  balancete pede só ele; 403 na URL assinada refaz a assinatura uma vez e dois 403
  recusam o arquivo sem virar "login expirou".
- `tests/rastreabilidade-backfill-064.test.js` — ponta a ponta no pglite com um PDF
  sintético de 2 páginas (9 fatos, 1 zero, simulação sem RPC; aplicação aceita por
  `registrar_documento_v2`; `get_origem_v2` devolve `documento` com a página certa,
  inclusive bbox; segunda aplicação não cria versão nova), com um DOCX sintético
  gerado no teste (3 fatos; `get_origem_v2` devolve `documento` com `pagina` nula;
  segunda aplicação não cria versão nova) e com os dois casos de linha de total
  (código e valor repetidos = ambíguo; só o valor repetido = fato na linha certa).

## Resultados

- `npx eslint tools/rastreabilidade/` — verde.
- `npm run lint` — verde.
- `npm test` — verde, com o ponta a ponta do pglite executado (não pulado):
  683 testes passaram e 5 pulos de outras suítes, não desta.
- Nenhum documento real foi baixado e nenhuma variável `CF_*` real foi usada nesta
  execução. As contagens acima são de fixtures sintéticas (centros `99.E2E`,
  `99.E2D`, `99.E2T` e `99.E2V`).

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
   vãos de até 4 caracteres quaisquer (letras inclusive) e 5+ separadores. Testes com
   um CPF sintético quebrado por quatro letras em cada vão e com 5+ separadores (este
   acrescentado na 3ª rodada): a regra da 065 não vê CPF, a larga da 064 vê.
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

## 3ª rodada (revisão MiniMax max dos commits 237ce44 + 0b175b3)

Onze correções pedidas em `docs/redesenho/tarefas/F2-B-rodada3.md`:

1. **`raw_extraction` nos dois formatos.** `lancamentosEsperados` lê
   `objeto.lancamentos` **ou** `objeto.data.lancamentos`; o guarda de forma aceita
   exatamente esses dois. Há teste unitário dos dois (objeto e string) e, no ponta a
   ponta, o balancete do centro `99.E2T` usa `{ data: { lancamentos } }`.
2. **`in.(...)` em blocos.** O cliente REST fatia ids/chaves em blocos de no máximo
   50 e mescla os resultados. Teste com 200 ids em cada método filtrado (7 métodos):
   4 requisições, nenhuma com mais de 50 valores, total 200.
3. **`raw_extraction` sob demanda.** Saiu do `select` da listagem de balancetes e
   passou a ser lido por documento (`lerRawExtraction`), antes do download. O teste
   do cliente confere que o `select` da listagem não o pede e que a leitura por
   balancete usa `select=raw_extraction`.
4. **Frase de já registrado.** O terminal agora imprime exatamente
   `documento já registrado, N fatos novos ignorados`, a mesma frase do README e
   deste relatório; teste próprio no arquivo de saída.
5. **Divergência de sinal.** Teste de fluxo: banco com `1234.56` e documento com
   `(1.234,56)` → o fato não entra no payload, `divergencias` sobe (contagem nova no
   detalhe e no resumo) e motivo `divergencia`. A pré-validação trata o parêntese
   como negativo legítimo: o positivo do banco não casa (`valorLidoDoTrecho` também
   testado nos dois sinais).
6. **Linha de total, no ponta a ponta.** Centro `99.E2T`: total que repete código e
   valor deixa duas linhas válidas → ambíguo, sem fato, status `sem_fatos`. Centro
   `99.E2V`: total que repete só o valor → fato único na linha do lançamento, aceito
   pela 064 e devolvido por `get_origem_v2` com a página certa.
7. **CPF num fixture único.** `tests/fixtures/cpf-casos.json` guarda os verdadeiros e
   falsos da Regra de CPF única; o teste lê o arquivo (mesmas strings da 065). A
   regra larga da 064 e a bissecção continuam testadas no mesmo arquivo.
8. **Quatro checagens da 064.** O teste ganhou o caso de 5+ separadores
   (`529.......982.......247.......25`): a 065 recusa, a regra larga da 064 aceita.
   A frase da 2ª rodada sobre a cobertura agora corresponde ao teste.
9. **`sem_valor`.** Candidatos com valor nulo (cabeçalho, lançamento, rubrica,
   desembolso ou total do plano) entram na contagem `sem_valor` do detalhe e do
   resumo em vez de sumirem sem explicação.
10. **Corte de 500 caracteres reais.** `cortarTrecho` usa
    `Array.from(texto).slice(0, 500).join('')`; teste com 499 caracteres + emoji
    prova que o par substituto não é partido e que o comprimento em code points é
    500 (o `slice` antigo dava 500 unidades UTF-16).
11. **403 na URL assinada.** O download trata 403 como assinatura expirada/recusada
    e refaz a assinatura uma vez; se falhar de novo, recusa aquele documento
    (`arquivo`). 403 ao **assinar** continua sendo `login expirou`. Testes cobrem o
    sucesso na segunda tentativa, os dois 403 e o 403 na assinatura.

## 4ª rodada (simulação na produção de 19/11, conferida pelo Claude)

A simulação na produção (065 aplicada) leu 49 documentos: 385 números achados e 286
não achados. Esta rodada corrige só as duas causas que explicam a maior parte deles;
o resto continua `legado` de propósito.

1. **Lançamento com código cortado no PDF.** O `acharAlvo` já entende
   `"<prefixo>#<reduzido>"` (prefixo no começo da linha + reduzido inteiro), mas o
   script só passava o código completo. Agora o `raw_extraction` — que já era lido
   por balancete — alimenta um mapa `conta_codigo → conta_reduzido`
   (`reduzidosPorConta`, nos dois formatos `{ lancamentos }` e
   `{ data: { lancamentos } }`). A conta primeiro é procurada pelo código completo;
   **só quando nenhuma linha serve** o script tenta `"<prefixo>#<reduzido>"`, com o
   prefixo nos cinco primeiros segmentos (`7.1.3.02.01`). Conta com reduzido vazio
   ou com dois reduzidos diferentes no raw fica sem alternativa; mais de uma linha
   servindo continua ambígua e não vira fato. O `busca`/`ref` do legado no banco não
   mudou. Entrou a contagem `por_reduzido` (fatos aceitos achados pela alternativa)
   no detalhe, no resumo e no terminal. O `parser_versao` continua `1.0.0`: nada foi
   aplicado em produção.
2. **Sinônimos de rubrica no plano.** `alvo.mjs` ganhou um mapa fixo, só com os três
   casos medidos: `cip_ufg` → `Custos indiretos para a UFG`, `cip_ua` →
   `Custos indiretos para a UA/Órgão` e `dao` → `D.A.O da Fundação`. A rubrica é
   procurada primeiro pelo nome do catálogo; só quando não tem `descricao_livre` e
   nenhuma linha serve é que os sinônimos entram, na ordem, sempre com o valor na
   linha. A comparação é a de `textoNaLinha` (sem acento e sem caixa). `cip_ufg` e
   `cip_ua` com o mesmo valor são distinguidos pelo texto ("para a UFG" × "para a
   UA/Órgão"); se um sinônimo casar nas duas linhas, é ambíguo e não vira fato.
   Nenhuma outra rubrica ganhou sinônimo.

Testes desta rodada:

- `tests/rastreabilidade-alvo.test.js` — as três linhas medidas (lançamento cortado
  + duas agregações com o mesmo prefixo e valor): o código completo dá
  `nao_achado`, e só a linha do reduzido vira `achado`; o reduzido não é tentado
  quando o código completo já acha; duas linhas iguais continuam ambíguas; conta
  com menos de cinco segmentos não gera alternativa; o mapa de sinônimos tem só as
  três rubricas e não vale para rubrica com `descricao_livre`; `cip_ufg` e `cip_ua`
  com o mesmo valor acham cada um a sua linha; um sinônimo que casa nas duas é
  ambíguo.
- `tests/rastreabilidade-fluxo.test.js` — `reduzidosPorConta` lê os dois formatos,
  aceita a conta repetida com o mesmo reduzido e descarta a conta com dois
  reduzidos ou com reduzido vazio (sem alternativa).
- `tests/rastreabilidade-backfill-064.test.js` (pglite, não pulado) — centro
  `99.E2R`: PDF sintético no layout cortado (lançamento + duas agregações) e
  `raw_extraction` com o reduzido; o fato é achado pela alternativa, conta
  `por_reduzido`, é aceito por `registrar_documento_v2` e `get_origem_v2` devolve
  `documento` com a página certa; rodar de novo não cria versão. Centro `99.E2S`:
  DOCX sintético com as três linhas de sinônimo (os dois CIPs com o mesmo valor) e
  as três rubricas sem `descricao_livre`; os 3 fatos são aceitos pela 064 e
  `get_origem_v2` devolve `documento` com o trecho de cada linha certa.

Verificação: `npx vitest run` — 44 arquivos, **694 testes passaram** e 5 pulos de
outras suítes, com o ponta a ponta do pglite executado; `npm run lint` e
`npx eslint tools/rastreabilidade/` verdes. Nenhum documento real foi baixado e
nenhuma variável `CF_*` foi usada; os centros e valores dos testes são sintéticos.

## 5ª rodada (revisões MiniMax max e GLM 5.3 do commit 40d2d57)

Nenhum achado alto. Correções pedidas em `docs/redesenho/tarefas/F2-B-rodada5.md`:

1. **Prefixo mais estreito no código cortado.** `contaComReduzido` passou a montar o
   prefixo com os cinco primeiros segmentos **mais `.` e o primeiro caractere do
   sexto**: `7.1.3.02.01.00002` → `7.1.3.02.01.0#2503002`. Sem sexto segmento não
   há alternativa. Assim a agregação `7.1.3.02.01 25213231 …` e um ramo vizinho
   `7.1.3.02.012 2503002 …` deixam de casar o prefixo. Testes novos: as duas linhas
   juntas não servem; `7.1.3.02.01.0 2503002` e `7.1.3.02.01.00 2503002` servem,
   cada uma sozinha; `7.1.3.02.01` (sem sexto segmento) não gera alternativa.
2. **Sinônimos sem perder a distinção UFG × UA.** `dao` ficou com `D.A.O da
   Fundação` e `D.A.O. da Fundação`; `cip_ua` passou a `Custos indiretos para a UA`
   (que já cobre `UA/Órgão` e `UA / Órgão`) e `Custos indiretos para a Unidade`;
   `cip_ufg` continua só `Custos indiretos para a UFG`. O teste usa o
   `SINONIMOS_RUBRICA` real, não um alvo escrito à mão: nenhum sinônimo de `cip_ua`
   casa a linha da UFG e nenhum de `cip_ufg` casa as linhas da UA. Os dois jeitos do
   DAO também acham cada um a sua linha.
3. **Testes da rodada anterior conferidos.** `tests/rastreabilidade-fluxo.test.js`
   agora tem o caso da conta repetida no raw com o **mesmo** reduzido (vale como um
   só; o mapa continua com `size` 1), que a 4ª rodada dizia estar coberto sem estar.
   A linha cortada do PDF sintético do ponta a ponta passou a ter as cinco colunas
   numéricas do layout (`0,00 21.496,58 0,00 21.496,58 21.496,58`), via
   `linhaContabilCincoColunas` em `tests/helpers/balancete-pdf.js`.
4. **Continuam como estão (só registrado, sem mudar código).** A linha repetida na
   quebra de página continua ambígua — na simulação de 19/11 foram 2 ambíguos ao
   todo. O lançamento de conta redutora (banco negativo, PDF positivo) continua
   `legado`. A linha única com "UFG e UA" não ocorre nos planos medidos, então não
   ganhou tratamento.

Verificação: `npx vitest run` — 44 arquivos, **699 testes passaram** e 5 pulos de
outras suítes, com o ponta a ponta do pglite executado (13 testes, nenhum pulado);
`npm run lint` e `npx eslint tools/rastreabilidade/` verdes. Nenhum documento real
foi baixado e nenhuma variável `CF_*` foi usada; centros e valores sintéticos. O
`parser_versao` continua `1.0.0`.

## O que ficou em aberto

- Os números que a simulação de 19/11 não achou por **outras** causas continuam
  `legado` de propósito; a 4ª rodada só tratou código cortado e os três sinônimos de
  rubrica. Rodar a simulação de novo é o que mede quanto as correções resolveram.
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
- O cliente REST não renova o JWT sozinho. Se a sessão expirar no meio (HTTP 401/403
  nas leituras, na assinatura ou na RPC), o script aborta com `login expirou: rode de
  novo` e código de saída ≠ 0; é só rodar de novo, e o que já foi aplicado não
  duplica. 403 no **download** da URL assinada não é sessão: refaz a assinatura uma
  vez e, se falhar de novo, recusa só aquele documento.
