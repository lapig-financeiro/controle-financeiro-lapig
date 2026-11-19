# Relatório F2-G — Migração 066: taxas (CIP e DAO) nunca são livre

Branch: `redesenho/f2-g-066` (worktree `C:/Users/amara/dev/cf-f2-e`). Commit novo, **sem push**.
**Nada foi aplicado em produção**, nenhuma variável `CF_*` real foi usada, nenhuma outra IA foi chamada e o runner só tocou no PGlite em memória.

## 1. Tamanho dos arquivos

| Arquivo | Bytes | Linhas |
|---|---:|---:|
| `database/066_taxas_comprometidas.sql` | **30.014** | 615 |
| `tests/sql/test_066_taxas_comprometidas.sql` | **16.698** | 354 |
| `tools/replica-local/rodar-066-pglite.mjs` | **22.192** | 514 |
| `tools/replica-local/sintetico/stub-066.sql` | **6.263** | 134 |

A migração está abaixo de 90 KB, começa com `begin;` como primeiro comando SQL e termina com `commit;` como último; não tem `commit`/`savepoint` no meio nem os termos proibidos do cofre (`password`, `service_role`, `net.`, `http(`, `dblink`, `cron.`, `vault.`, `create extension`, `concurrently`, `vacuum`, `copy`, `set role`, `alter default privileges`…).

## 2. A regra implementada

Decisão do Victor em 19/11/2026: **a taxa a reter não é dinheiro livre**. Para as rubricas `cip_ufg`, `cip_ua` e `dao`:

```
compromissos = greatest(previsto − realizado, 0)
saldo_livre  = least(previsto − realizado, 0)
```

O que falta cobrar vira comprometido; cobrança acima do previsto (negativa) continua abatendo o livre, porque é dinheiro que já saiu. `a.bolsas` não mudou: continua com a janela do dia 07 da 048.

A lista de rubricas de taxa ficou **numa constante única** no topo de `get_saldo_livre` (`c_rubricas_taxa constant text[] := array['cip_ufg', 'cip_ua', 'dao']`), usada tanto no cálculo do compromisso quanto no `compromisso_tipo` e no rótulo do grupo. Não há códigos espalhados pelo corpo.

### 2.1. `get_saldo_livre(uuid)`

`create or replace` copiando o corpo da 048, com só os pontos pedidos:

- `compromisso_tipo` por rubrica: `'bolsas'` para `a.bolsas`, `'taxa'` para `cip_ufg`/`cip_ua`/`dao`, `null` nas demais.
- `compromissos_cobertura` do grupo: `'bolsas e taxas'` quando o grupo tem as duas coisas, `'bolsas'` quando só bolsas, `'taxas'` quando só taxas, `'nenhuma'` no resto.
- texto de `nota` e `comment on function` atualizados: taxa a reter conta como comprometido.
- janela do dia 07, avisos, retorno, guard `assert_project_allowed`, `security definer` e `set search_path = public, pg_temp` repetidos.
- ACL reafirmada explicitamente: `revoke all ... from public, anon` + `grant execute ... to authenticated` (o `create or replace` já preservava a ACL da 035; repetir é defesa contra divergência).

### 2.2. `explicar_livre_v2(uuid)`

Cópia inteira da 065, mudando só a árvore:

- nas rubricas de taxa com `compromisso > 0`, entra `Comprometido — <nome>` com `chave = rubrica:<code>:comprometido`, `sinal = -1`, `tipo = 'calculo'` e `conta = 'taxa a reter (previsto − realizado)'`.
- **Partes escolhidas:** reutilizar os nós de previsto e realizado daquela rubrica, já existentes na árvore. Como o nó só é criado quando `previsto > realizado`, a soma dos filhos com sinal é exatamente `previsto − realizado = compromisso`; não foi preciso inventar nó nem nota com a conta. Quando `realizado = 0` (não há nó de realizado, porque a árvore omite nó de valor zero), o comprometido usa só o nó de previsto — e continua fechando. Essa escolha evita repetir uma nota de cálculo em cada rubrica e mantém a origem do previsto/realizado clicável dentro do próprio comprometido.
- nota do grupo `taxas`: `"taxa a reter pela fundação/universidade: não é livre"`. No grupo misto, a nota acrescenta que as bolsas contratadas também entram.
- `conta` do grupo passa a `'previsto − realizado − comprometido'` em `bolsas`, `taxas` e `bolsas e taxas`; `nenhuma` continua `'previsto − realizado'` com a mesma nota de antes.
- a árvore continua fechando: raiz = soma dos grupos = `livre` de `resumo_projetos_v2`, e cada nó `calculo` = soma das partes com sinal. O runner confere isso em todos os centros sintéticos do resumo.

### 2.3. Nada mais muda no banco

`resumo_projetos_v2` já soma `saldo_livre` dos grupos. `simular_alocacao` já exclui `cip_ufg`, `cip_ua` e `dao` do pool remanejável. Nenhuma tabela, coluna ou linha nova; os seis helpers protegidos não foram tocados.

## 3. Telas, exemplo e assistente

- `app/src/paginas/Projeto.jsx`: frase de cobertura para `'taxas'` e `'bolsas e taxas'`; `'bolsas'` e `'nenhuma'` mantêm os textos antigos (os testes do app continuam passando sem alteração).
- `app/src/servicos/dadosExemplo.js`: grupo `cip_ufg` no 30.901 (previsto 150.000, realizado 120.000, comprometido 30.000, livre 0, `compromissos_cobertura: 'taxas'`), rubrica correspondente e a árvore de exemplo com o nó `Comprometido — Custos Indiretos (CIP) — UFG`; a raiz continua 84.300 e a árvore fecha ao centavo.
- `frontend/js/ai/tools.js` e `mcp/src/index.js`: a descrição de `compromissos_cobertura` ganhou `"taxas"` e `"bolsas e taxas"` nos dois adaptadores, com o mesmo texto.
- `frontend/js/pages/plano-trabalho.js`: a coluna de saldo já usava `comp.compromissos` de `get_saldo_livre` para qualquer rubrica (sem recalcular). O detalhe da rubrica, porém, mostrava a lista de **bolsas** em qualquer rubrica com compromisso, com o rótulo "já contratados". Agora só `a.bolsas` lista bolsistas; taxa mostra "Taxa a reter — previsto menos realizado" com o valor que veio da RPC.
- `docs/database.md` atualizado (cobertura nova e `compromisso_tipo` nas rubricas).

## 4. Testes e cofre

### 4.1. Roteiro `tests/sql/test_066_taxas_comprometidas.sql`

Autoconferido com `pg_temp.ok066`, em `begin`/`rollback`, sobre `stub-066.sql`:

1. **taxa com saldo positivo** (`cip_ufg` 100.000 − 85.000): compromissos 15.000, livre 0, `compromisso_tipo = 'taxa'`, grupo `'taxas'`;
2. **taxa estourada** (`cip_ua` 10.000 − 12.000): compromissos 0, livre −2.000, grupo `'taxas'`, sem nó `comprometido`;
3. **taxa sem realizado** (`dao` 20.000 − 0): compromete o previsto inteiro, nó `comprometido` com uma parte só (previsto);
4. **rubrica comum**: sem compromisso, `compromisso_tipo` nulo, livre previsto − realizado;
5. **grupo misto**: `dao` reparentado para `a` só na transação; cobertura `'bolsas e taxas'`, compromissos = bolsas + taxa, árvore com os dois nós `comprometido` e fechando;
6. **sem plano**: retorno antecipado da 048 com as mesmas 5 chaves e a mesma mensagem; árvore com `motivo = 'sem plano'` e valor nulo;
7. **sem balancete**: `has_balancete = false`, aviso preservado, grupo `'nenhuma'`, compromisso 0, livre previsto − realizado; árvore nula com `motivo = 'sem balancete'`;
8. **`resumo_projetos_v2`**: `66.TAXA` = 38.000 e `66.MISTO` = 25.000.

Antes da 066 o roteiro falha na primeira asserção (`066 FALHOU: taxa com saldo positivo…`), que é o defeito.

### 4.2. Runner `tools/replica-local/rodar-066-pglite.mjs` — **verde (exit 0)**

- monta a base real da 064 (`montarBase064`: 025/026/051/052/054/053/056/062/038/048/063), aplica 064, `stub-064`, 065 e `stub-066`;
- captura as árvores antes da 066 e exige que o roteiro falhe pelo motivo da taxa positiva;
- confere o cofre e aplica a 066;
- compara as **9 árvores sem taxa** (todos os centros da base + `66.SEMPLANO` + `66.SEMBAL`): idênticas em JSON às da 065; `66.TAXA` e `66.MISTO` são as únicas que mudam, de propósito;
- roda `test_064`, `test_065` e `test_066` depois da 066 e de novo após reaplicar a 066 (idempotência);
- confere em todos os 10 centros do `resumo_projetos_v2`: raiz da árvore = soma dos grupos = `livre` do resumo; grupo = soma das rubricas; rubrica = previsto − realizado − compromissos; taxas com `greatest`/`least`;
- confere o nó `comprometido` de `cip_ufg` (2 partes) e `dao` (1 parte), e a ausência dele na taxa estourada;
- confere o grupo misto em transação própria (`bolsas e taxas`, árvore fechando, os dois comprometidos);
- confere o BLOCO 1 da 051 (`trg_bloqueia_agente` em todas as tabelas de `public`, exceto `propostas_agente`);
- prova **2 mutantes**: (1) constante sem `cip_ufg`; (2) taxa positiva sem `greatest(previsto − realizado, 0)`. Os dois são pegos por `test_066`;
- confere que os MD5 dos 6 helpers protegidos não mudaram.

### 4.3. Resultados

| Comando | Resultado |
|---|---|
| `node tools/replica-local/rodar-066-pglite.mjs` | **verde** |
| `npx vitest run` | **44 arquivos, 699 passed, 5 skipped** |
| `npm run lint` | **verde** |
| `npm test --prefix app` | **13 arquivos, 86 passed** |
| `npm run build --prefix app` | **verde** (guarda de estilo + “nenhum dado de exemplo no bundle”) |

Para os testes da raiz, `mcp/node_modules` e `app/node_modules` foram instalados com `npm ci` (dependências locais; nenhum arquivo versionado). Os 5 testes pulados da raiz são os fixtures opcionais pré-existentes (`tests/fixtures/pt-html/`).

## 5. Desvios e observações

- **Nó `comprometido` da taxa**: a tarefa permitia reutilizar os nós de previsto e realizado **ou** uma nota com a conta. Foi escolhida a reutilização; a justificativa está no item 2.2. O único caso em que não há nó de realizado é `realizado = 0`, e aí o previsto sozinho fecha.
- **Grupo misto**: no banco real as três taxas são rubricas de topo e não convivem com `a.bolsas` no mesmo grupo; o código trata o caso porque a tarefa pediu, e o teste o exercita reparentando `dao` para `a` dentro da transação (rollback desfaz). Não é uma alteração de catálogo.
- **`compromisso_tipo` é chave nova** no detalhe por rubrica. Consumidores que ignoram chaves novas continuam corretos; `compromissos_cobertura` ganhou dois valores possíveis.
- **Sem balancete e taxa**: a regra continua valendo (`realizado = 0`, então a taxa prevista inteira fica comprometida). O roteiro cobre “sem balancete” num centro **sem taxa**, comparando o retorno exato com o de hoje; o centro `66.TAXA` tem balancete.
- **ACL**: `get_saldo_livre` e `explicar_livre_v2` são `security definer`, `search_path = public, pg_temp` exato, `authenticated` com EXECUTE e `anon`/`PUBLIC` sem. As asserções da própria 066 verificam isso e a presença dos três códigos na constante.
- **Nada de produção**: não foi executado `ensaiar`/`aplicar` no cofre, nenhuma chamada ao Supabase de produção, nenhum `git push`.

## 6. Pronto quando

- Runner PGlite: **ok**.
- `npx vitest run` e `npm run lint`: **ok**.
- Testes e build de `app/`: **ok**.
- Linha da 066 em `docs/migracoes.md` (“ainda não aplicada”): **ok**.
- Relatório: este arquivo.
- Commit na branch atual (`redesenho/f2-g-066`), incluindo o arquivo da tarefa `docs/redesenho/tarefas/F2-G-066.md`: **sim**.
