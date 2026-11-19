# Backfill de rastreabilidade (F2-B)

Script que acha cada número vigente no documento de origem (balancete em PDF ou plano
em PDF/DOCX) e chama `registrar_documento_v2` (migração 064) com os fatos — página,
trecho literal e `bbox` — para o "De onde vem este valor" parar de cair em `legado`.

## Antes de rodar: quem pode rodar

- **Login de admin humano, à mão.** A 064 só aceita `admin`, e o script confere o
  próprio papel em `app_users` antes de qualquer leitura. Este é um **desvio
  declarado** da regra 9 de [`docs/acesso-ao-banco.md`](../../docs/acesso-ao-banco.md)
  ("automação nunca usa admin"): não há agendamento, não há CI e não é uma rotina;
  quem roda é o operador, em **simulação primeiro** e **aplicação num turno
  separado**, depois da conferência de quem aprova.
- A **migração 065** precisa estar aplicada **antes** do backfill na produção. Até
  lá, o ponta a ponta roda sobre a 064 com fixtures sem CPF.
- Nunca use as variáveis `CF_*` reais fora do turno combinado. O script não imprime
  nenhum valor de credencial.

## Dependências

- Node.js 22 ou mais novo.
- `npm ci` na raiz (vitest, eslint, mammoth, linkedom).
- `npm --prefix mcp ci` (o `pdfjs-dist` vem de `mcp/`; o `package.json` da raiz não
  ganha dependência nova).
- Para os testes de ponta a ponta, o pglite em `.cache/pglite-064`:
  `npm install --prefix .cache/pglite-064 --no-save --package-lock=false @electric-sql/pglite`.
  Sem ele, o teste de integração se pula com aviso; **verde com o ponta a ponta
  pulado não conta como pronto**.

## Uso

```bash
node tools/rastreabilidade/backfill.mjs \
  [--aplicar] [--centro 30.117] [--saida <pasta fora do repositório>]
```

Variáveis de ambiente (só os nomes; os valores nunca são impressos):

```
CF_SUPABASE_URL
CF_SUPABASE_ANON_KEY
CF_EMAIL
CF_PASSWORD
```

- Sem `--aplicar`: **só simula**. Baixa os arquivos, calcula `sha256`, procura as
  linhas e mostra as contagens; **não chama** `registrar_documento_v2`.
- Com `--aplicar`: uma chamada por documento, com todos os fatos. É idempotente pelo
  `sha256`: rodar de novo com o mesmo arquivo não cria versão nem fato.
- `--centro` filtra por `projects.code` e aborta se não achar **exatamente um**
  projeto ativo com aquele código. `--centro`/`--saida` recusam valor que comece
  por `--` (ou vazio), para um argumento seguinte não virar valor por engano.
- `--saida` é a pasta do JSON de detalhe. Tem de ficar **fora do repositório**
  (comparação sem diferenciar maiúsculas no Windows); o script recusa pasta dentro
  do worktree. Ela é validada e criada **antes** de qualquer leitura (inclusive das
  variáveis de ambiente) ou escrita. Sem `--saida`, usa uma pasta temporária do
  sistema, também fora do repositório.

## Escopo

Entram:

- balancetes com `data_referencia` no **ano corrente**, de projetos **ativos**, com
  `arquivo_storage_path` no bucket `balancete-pdfs`;
- o **plano ativo** de cada projeto ativo, com `arquivo_storage_path` no bucket
  `plano-trabalho-docs`.

O resto fica como está (`legado`). Bolsas continuam `digitado` nesta fase.

## Requisições

Os filtros `in.(...)` do PostgREST são fatiados em blocos de no máximo **50**
ids/chaves por requisição, e os resultados são mesclados. `raw_extraction` não vem
na listagem de balancetes: é lido por documento, com `select` só dele.

## O que vira fato

- **Balancete (PDF):** `saldo_disponivel`, `rendimento_liquido`, `total_debitos` e
  `total_creditos` não nulos; e `saldo_atual` de cada lançamento **com rubrica**.
  Linha sem rubrica não é procurada.
- **Plano (PDF ou DOCX):** `valor_total_plano`, `valor_previsto` das rubricas e
  `valor` das parcelas de desembolso, quando não nulos.
- **Zero não é procurado**: o `acharAlvo` não acha zero; esses números ficam de fora
  e só aparecem na contagem `zeros` do detalhe/relatório.
- **Valor nulo não é procurado**: candidatos com valor nulo no banco (campos do
  balancete, rubrica, desembolso ou total do plano) entram na contagem `sem_valor`
  do detalhe e do resumo.
- A linha só vira fato se contiver o **valor formatado** (com separador de milhar e
  duas casas, via `formatarValor` de `frontend/js/origem-busca.js`) **e** o código
  da conta (lançamento) ou o texto (rubrica/parcela/cabeçalho). Se mais de uma linha
  satisfizer, é **ambíguo** e não vira fato.
- **Código cortado no PDF:** o lançamento é procurado primeiro pelo **código
  completo**. Só quando nenhuma linha serve, o script usa o mapa
  `conta_codigo → conta_reduzido` do `raw_extraction` daquele balancete e procura
  `"<prefixo>#<reduzido>"` (prefixo = os cinco primeiros segmentos do código mais
  `.` e o **primeiro caractere do sexto**; `7.1.3.02.01.00002` vira
  `7.1.3.02.01.0#2503002`), que é a regra 2 do `acharAlvo` — prefixo no começo da
  linha e reduzido como palavra inteira, sempre com o valor na linha. O prefixo mais
  estreito é o que impede a agregação `7.1.3.02.01 25213231 …` e um ramo vizinho
  (`7.1.3.02.012 2503002 …`) de casarem por engano. Conta sem sexto segmento, com
  reduzido vazio ou com dois reduzidos diferentes no `raw_extraction` fica **sem
  alternativa**. A regra de ambiguidade não muda: mais de uma linha servindo =
  ambíguo, sem fato. Esses fatos entram na contagem `por_reduzido` do detalhe, do
  resumo e do terminal. O `busca`/`ref` do legado no banco continua como está.
- Para rubrica, o alvo do `acharAlvo` é `{ texto }` (descrição livre ou nome da
  rubrica), com o valor só como desempate.
- **Sinônimos de rubrica no plano:** só `cip_ufg`, `cip_ua` e `dao` têm nomes fixos
  usados pelos documentos. `cip_ufg`: `Custos indiretos para a UFG`. `cip_ua`:
  `Custos indiretos para a UA` (cobre `UA/Órgão` e `UA / Órgão`) e `Custos
  indiretos para a Unidade`. `dao`: `D.A.O da Fundação` e `D.A.O. da Fundação`.
  Quando a rubrica **não tem** `descricao_livre` e o nome do catálogo não acha
  nenhuma linha, o script tenta os sinônimos, na ordem, sempre com o valor na linha.
  `cip_ufg` e `cip_ua` costumam ter o mesmo valor; é o texto ("para a UFG" × "para
  a UA" ou "para a Unidade") que distingue. Se um sinônimo casar nas duas linhas, é
  ambíguo e não vira fato. Nenhuma outra rubrica ganha sinônimo.
- **Pré-validação de valor:** antes da RPC, o script extrai o número **do trecho**
  (parsing do texto como o documento imprime, incluindo negativos entre parênteses)
  e confere se ele é o valor do fato. Não é uma comparação do valor com ele mesmo.
  A divergência entre o documento e o banco que o texto não revela continua sendo
  pega só pela RPC (a linha é escolhida pelo valor formatado que está no banco).
  Divergência achada aqui não entra no payload e sobe a contagem `divergencias`.
- O `trecho` é a linha inteira, truncada em **500 caracteres reais** (code points,
  como o `char_length` da RPC conta, sem partir par substituto). Se o valor ficar
  fora do corte, não é fato.
- `bbox` tem só as quatro chaves de `linhasDaPagina` (`x0`, `x1`, `yMin`, `yMax`).
  Em DOCX, `pagina` e `bbox` são nulos.
- Rubrica ambígua no plano (mesmo `rubrica_code` e `descricao_livre` nula/vazia
  duplicada) fica de fora: a 064 recusaria o documento inteiro.
- **Zero fatos não registra.** Documento em que nenhum número vira fato sai com o
  status `sem_fatos` (contado no terminal e no JSON), sem chamar a RPC — também
  depois da retentativa por CPF.
- **Balancete inconsistente** (`raw_extraction` indica mais lançamentos do que a
  tabela tem) é recusado sozinho, com o motivo `lancamentos_inconsistentes`, e a
  corrida continua nos outros documentos. Nunca grava menos fatos do que deveria
  por causa de tabela incompleta. O `raw_extraction` aceita os dois formatos do
  banco (`{ lancamentos: [...] }` e `{ data: { lancamentos: [...] } }`) e é
  buscado **por balancete**, na hora de processá-lo — não vem na listagem.

## Formato

Pela extensão do caminho (como a 064) e conferido pelos primeiros bytes:

- `%PDF` → PDF (balancete só aceita PDF);
- `PK` → DOCX (plano aceita PDF ou DOCX).

Extensão e conteúdo divergentes, ou arquivo que não é PDF/DOCX, recusam o documento
com o motivo `formato`.

## CPF

Antes de chamar a RPC, o script aplica a **Regra de CPF única** (a mesma da 065) em:

1. cada `trecho`;
2. `titulo`, `arquivo_nome` e o caminho relativo (o que a 064 chama de `cam_rel`);
3. a **concatenação na ordem da RPC** (`caminho relativo`, `titulo`, `arquivo_nome`,
   todos os trechos).

Fato com CPF fica de fora (vira `legado`). CPF no título, no nome do arquivo ou no
caminho = **documento recusado por CPF no nome**, sem retentativa. Se a concatenação
formar um CPF partido entre dois trechos, os fatos envolvidos são removidos por
bissecção até a concatenação ficar limpa.

Se a RPC recusar por CPF mesmo assim (por exemplo, contra uma base ainda na 064), o
script tira os fatos que a regra larga da 064 aponta como suspeitos e tenta **uma
vez** de novo. Se não houver suspeito, ou se a segunda chamada recusar de novo, o
documento é pulado com o motivo `cpf` e o script segue. Nada disso imprime CPF.

## Sessão expirada e assinatura do arquivo

HTTP 401 ou 403 durante a corrida (leitura, **assinatura** no Storage ou RPC) **não**
é recusa de documento: o script aborta com código de saída ≠ 0 e a mensagem
`login expirou: rode de novo`. É só autenticar de novo e repetir; o que já foi
aplicado é idempotente pelo `sha256`.

Um **403 no download pela URL assinada** é outra coisa: a assinatura expirou ou foi
recusada. O script refaz a assinatura **uma vez**; se falhar de novo, aquele
documento é recusado com o motivo `arquivo` e a corrida continua — sem derrubar a
sessão.

## Já registrado

Quando o mesmo `sha256` já existe, a RPC devolve `criada: false` e **ignora todos os
fatos novos** (o registro é imutável). O terminal avisa, exatamente:
`documento já registrado, N fatos novos ignorados`. Corrigir uma leitura errada depois
disso exige a F3 (nova versão/desfazer) ou intervenção manual; **não** apague fatos à
mão.

## Saída

**Terminal:** só o modo, o papel, o ano, e — por centro e por documento — as
contagens de achados, não achados, ambíguos, com CPF, zeros, sem valor, divergências,
duplicados, recusados e achados por reduzido (`por_reduzido`), o status (`sem fatos`,
já registrado, aplicado, recusado com motivo), além do código do centro, do id do
documento, da data/versão e do motivo de recusa. Nunca imprime trecho, título, nome
de pessoa, CPF, nome de arquivo, caminho ou valor. O aviso de já registrado é
exatamente `documento já registrado, N fatos novos ignorados`.

**JSON de detalhe:** vai para a pasta `--saida`, **fora do repositório**, e é o único
lugar com trechos e valores. O arquivo é `backfill-<AAAAMMDD-HHMMSS>.json`.

## Testes

```bash
npx vitest run tests/rastreabilidade
npx eslint tools/rastreabilidade/
```

- Unitários (sem rede): regra de CPF em `tests/fixtures/cpf-casos.json` (o mesmo
  fixture serve à 065; inclusive a regra larga da 064 com vãos de até 4 letras e
  5+ separadores), montagem do alvo por tipo, escolha sem ambiguidade, valor lido
  do trecho, formatação do valor no trecho, corte de 500 caracteres reais (sem
  partir par substituto), bbox, divergência descartada, `sem_valor`, saída do
  terminal e filtros `in.(...)` em blocos de 50 (200 ids viram 4 requisições).
- Código cortado: as três linhas (lançamento com reduzido + duas agregações) provam
  que só a do reduzido serve. O prefixo estreito é testado com a agregação
  `7.1.3.02.01 …` e o ramo vizinho `7.1.3.02.012 …` (nenhum serve), com
  `7.1.3.02.01.0 …` e com `7.1.3.02.01.00 …` (cada uma serve sozinha); conta sem
  sexto segmento não gera alternativa. O mapa aceita a conta repetida com o mesmo
  reduzido e descarta a conta com dois reduzidos ou com reduzido vazio. Duas linhas
  iguais continuam ambíguas. Sinônimos: o teste usa o `SINONIMOS_RUBRICA` real e
  confere que nenhum sinônimo de `cip_ua` casa a linha da UFG e nenhum de `cip_ufg`
  casa as linhas da UA; `cip_ufg` e `cip_ua` com o mesmo valor acham cada um a sua
  linha, os dois jeitos do DAO acham a sua, e um sinônimo que casa nas duas é
  ambíguo.
- O cliente falso também cobre o download: 403 na URL assinada refaz a assinatura
  uma vez; dois 403 recusam o arquivo sem virar "login expirou".
- Ponta a ponta (pglite): um PDF de balancete **e** um DOCX de plano, ambos
  sintéticos e gerados no teste. O DOCX passa pela saída real do `lerDocx` até
  `registrar_documento_v2`; `get_origem_v2` devolve `documento` (para o DOCX, com
  `pagina` nula), rodar duas vezes não cria versão nova e a simulação não chama a
  RPC. A linha de total tem dois casos: repetir código e valor fica ambíguo (sem
  fato); repetir só o valor deixa o fato na linha do lançamento. Também há um PDF
  com o **código cortado** (a linha no layout de cinco colunas numéricas; o fato
  chega à RPC pelo reduzido e conta em `por_reduzido`) e um DOCX com os **três
  sinônimos** de rubrica, cada um na sua linha com o mesmo valor nos dois CIPs.

## Versão

`parser = backfill-acharAlvo`, `parser_versao = 1.0.0`, `origem = backfill`.
