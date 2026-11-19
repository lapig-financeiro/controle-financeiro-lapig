# F2-B — 4ª rodada (simulação na produção de 19/11, conferida pelo Claude)

Worktree `C:/Users/amara/dev/cf-f2-b`, branch nova `redesenho/f2-b-rodada4` a partir do `master` (5cdbcdd).
Seção "4ª rodada" no relatório `docs/redesenho/relatorios/F2-B.md`, commit novo. Sem push, sem produção, sem as
variáveis `CF_*` reais.

A simulação na produção (065 aplicada) leu 49 documentos: 385 números achados e 286 não achados. Duas causas
explicam a maior parte. Corrija só elas; o resto continua `legado` de propósito.

## 1. Lançamento com código cortado no PDF (11 de 33 balancetes sem nenhum lançamento achado)

Nos balancetes novos da FUNAPE a linha do lançamento traz o código **cortado** seguido do **reduzido**, e não o
código completo que o banco guarda:

```
banco (balancete_lancamentos.conta_codigo): 7.1.3.02.01.00002
linha do PDF (só números):                  7.1.3.02.01.0 2503002 | 0,00 21.496,58 0,00 21.496,58 21.496,58
raw_extraction do balancete:                { conta_codigo: "7.1.3.02.01.00002", conta_reduzido: "2503002", conta_incompleta: false, ... }
```

Nos balancetes antigos a linha traz `7.1.3.02.01.00002` inteiro e já funciona. Na mesma página também há
linhas de agregação que começam pelo mesmo prefixo (`7.1.3.02 2521323 ...`, `7.1.3.02.01 25213231 ...`) com o
mesmo valor: elas **não** podem virar fato.

Correção:
- O `raw_extraction` já é lido por balancete (`lerRawExtraction`). Monte um mapa `conta_codigo → conta_reduzido`
  com os lançamentos dele (nos dois formatos aceitos). Se a mesma `conta_codigo` aparecer com reduzidos
  diferentes, ou o reduzido for vazio, não há alternativa para aquela conta.
- Primeiro tente o alvo de hoje (código completo + valor). **Só quando nenhuma linha servir** com o código
  completo, tente o alvo `"<prefixo>#<reduzido>"`, que é a regra 2 que `contaNaLinha` e o `acharAlvo` do site já
  entendem (prefixo no começo da linha + reduzido como palavra inteira), sempre com o valor na linha. Prefixo =
  os cinco primeiros segmentos do código (`7.1.3.02.01`). A regra de ambiguidade não muda: mais de uma linha
  servindo = ambíguo, sem fato.
- O `busca`/`ref` do legado no banco não muda (fica para depois); isto é só no script.
- Contagem nova `por_reduzido` (fatos achados pela alternativa), no detalhe e no resumo.
- Testes: unitário com as três linhas acima (só a do reduzido serve); conta com dois reduzidos no raw (sem
  alternativa); ponta a ponta no pglite com um PDF sintético no layout cortado, cujo fato chega ao
  `registrar_documento_v2`.

## 2. Rubricas do plano cujo nome no documento difere do catálogo

Nos planos, o valor está na linha mas o texto não é o nome do catálogo (`rubricas.name`). Os casos medidos:

| `rubrica_code` | nome no catálogo | como o plano escreve |
|---|---|---|
| `cip_ufg` | Custos Indiretos (CIP) — UFG | `Custos indiretos para a UFG` |
| `cip_ua` | Custos Indiretos (CIP) — UA/Órgão | `Custos indiretos para a UA/Órgão` |
| `dao` | Despesas Adm e Operacionais (DAO) | `D.A.O da Fundação` |

Correção:
- Um mapa fixo de sinônimos por `rubrica_code` em `alvo.mjs` (só os três acima). Quando a rubrica não tem
  `descricao_livre` e nenhuma linha serve com o nome do catálogo, tente cada sinônimo, na ordem, com o valor
  na linha. A comparação continua sem acento e sem caixa (`textoNaLinha`).
- `cip_ufg` e `cip_ua` costumam ter o **mesmo valor**: o sinônimo tem de distinguir ("para a UFG" × "para a
  UA/Órgão"); se as duas linhas servirem, é ambíguo e não vira fato. Teste com os dois no mesmo plano e mesmo
  valor (cada um acha a sua linha) e com um sinônimo que case nas duas (ambíguo).
- Teste DOCX sintético no ponta a ponta com as três linhas.
- Nada de sinônimo para outras rubricas nesta rodada.

## Verificação

`npx vitest run`, `npm run lint` e `npx eslint tools/rastreabilidade/` verdes; o ponta a ponta do pglite não pode
ser pulado. README atualizado (seção "O que vira fato"). Nenhum dado real em teste ou fixture (sem nome de
pessoa, sem CPF): use valores e códigos inventados.
