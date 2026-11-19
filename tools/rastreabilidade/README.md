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

## O que vira fato

- **Balancete (PDF):** `saldo_disponivel`, `rendimento_liquido`, `total_debitos` e
  `total_creditos` não nulos; e `saldo_atual` de cada lançamento **com rubrica**.
  Linha sem rubrica não é procurada.
- **Plano (PDF ou DOCX):** `valor_total_plano`, `valor_previsto` das rubricas e
  `valor` das parcelas de desembolso, quando não nulos.
- **Zero não é procurado**: o `acharAlvo` não acha zero; esses números ficam de fora
  e só aparecem na contagem `zeros` do detalhe/relatório.
- A linha só vira fato se contiver o **valor formatado** (com separador de milhar e
  duas casas, via `formatarValor` de `frontend/js/origem-busca.js`) **e** o código
  da conta (lançamento) ou o texto (rubrica/parcela/cabeçalho). Se mais de uma linha
  satisfizer, é **ambíguo** e não vira fato.
- Para rubrica, o alvo do `acharAlvo` é `{ texto }` (descrição livre ou nome da
  rubrica), com o valor só como desempate.
- **Pré-validação de valor:** antes da RPC, o script extrai o número **do trecho**
  (parsing do texto como o documento imprime, incluindo negativos entre parênteses)
  e confere se ele é o valor do fato. Não é uma comparação do valor com ele mesmo.
  A divergência entre o documento e o banco que o texto não revela continua sendo
  pega só pela RPC (a linha é escolhida pelo valor formatado que está no banco).
- O `trecho` é a linha inteira, truncada em 500 caracteres. Se o valor ficar fora do
  corte, não é fato.
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
  por causa de tabela incompleta.

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

## Sessão expirada

HTTP 401 ou 403 durante a corrida (leitura, Storage ou RPC) **não** é recusa de
documento: o script aborta com código de saída ≠ 0 e a mensagem
`login expirou: rode de novo`. É só autenticar de novo e repetir; o que já foi
aplicado é idempotente pelo `sha256`.

## Já registrado

Quando o mesmo `sha256` já existe, a RPC devolve `criada: false` e **ignora todos os
fatos novos** (o registro é imutável). O script avisa
`documento já registrado, N fatos novos ignorados`. Corrigir uma leitura errada depois
disso exige a F3 (nova versão/desfazer) ou intervenção manual; **não** apague fatos à
mão.

## Saída

**Terminal:** só o modo, o papel, o ano, e — por centro e por documento — as
contagens de achados, não achados, ambíguos, com CPF, zeros, duplicados, recusados,
o status (`sem fatos`, já registrado, aplicado, recusado com motivo), além do código
do centro, do id do documento, da data/versão e do motivo de recusa. Nunca imprime
trecho, título, nome de pessoa, CPF, nome de arquivo, caminho ou valor.

**JSON de detalhe:** vai para a pasta `--saida`, **fora do repositório**, e é o único
lugar com trechos e valores. O arquivo é `backfill-<AAAAMMDD-HHMMSS>.json`.

## Testes

```bash
npx vitest run tests/rastreabilidade
npx eslint tools/rastreabilidade/
```

- Unitários (sem rede): regra de CPF (inclusive a regra larga da 064 com vãos de até
  4 letras), montagem do alvo por tipo, escolha sem ambiguidade, valor lido do
  trecho, formatação do valor no trecho, corte de 500, bbox, saída do terminal.
- Ponta a ponta (pglite): um PDF de balancete **e** um DOCX de plano, ambos
  sintéticos e gerados no teste. O DOCX passa pela saída real do `lerDocx` até
  `registrar_documento_v2`; `get_origem_v2` devolve `documento` (para o DOCX, com
  `pagina` nula), rodar duas vezes não cria versão nova e a simulação não chama a
  RPC.

## Versão

`parser = backfill-acharAlvo`, `parser_versao = 1.0.0`, `origem = backfill`.
