# Relatório F2-H — bloco "Dinheiro em conta" no topo do projeto

Branch: `redesenho/f2-h-dinheiro` (worktree `C:/Users/amara/dev/cf-f2-c`, a partir do `master` 49cbc2c).
**Sem push, sem migração, sem tocar no banco, sem alterar `frontend/` (site antigo) e sem chamar outra IA.**

## 1. O que mudou

| Arquivo | Mudança |
|---|---|
| `app/src/paginas/Projeto.jsx` | Escolha do balancete mais recente e novo `Destaque` "Dinheiro em conta", com contexto, estados e abertura da origem |
| `app/src/componentes/Destaque.jsx` | Prop opcional `ajuda`, aplicada como `title` no rótulo |
| `app/src/componentes/Valor.jsx` | Props opcionais `rotuloOrigem` (aria-label próprio) e `dica` (title no botão) |
| `app/src/componentes/Destaque.css` | Variante `grade-destaques--cinco`: primeira linha com os dois blocos de dinheiro e segunda com os três operacionais |
| `app/src/servicos/dadosExemplo.js` | `rendimento_liquido` nos balancetes de exemplo, centro com rendimento `null` e `origem` de exemplo para o campo |
| `app/scripts/gerar-pdf-exemplo.mjs` | Fato `rendimento_liquido` no manifesto do PDF sintético |
| `app/tests/projeto.test.jsx` | 7 testes novos do destaque; índices dos testes antigos deslocados de 4 para 5 destaques |
| `app/tests/dados.test.js` | Prova do `origem` de exemplo para `rendimento_liquido` (documento e legado) e do centro com `null` |
| `app/tests/pdf-exemplo.test.js` | Manifesto passa a exigir o fato `rendimento_liquido` |
| `docs/redesenho/tarefas/F2-H-dinheiro.md` | Arquivo da tarefa incluído no commit |
| `docs/redesenho/relatorios/F2-H.md` | Este relatório |

## 2. Regra do destaque

### 2.1. Qual balancete

O destaque lê `docsSt.balancetes` (o que a página já carrega com `get_balancetes_by_project`) e escolhe o balancete de maior `data_referencia`. No empate, vence o `created_at` mais novo — comparado como data, não como texto. Balancete sem `data_referencia` não concorre, como na `v_balancete_vigente` (que filtra `data_referencia is not null`).

Nada é recalculado: o valor exibido é o `saldo_disponivel` cru do balancete escolhido.

### 2.2. Contexto e rendimento

O contexto segue o formato pedido:

- rendimento com valor: `balancete de dd/mm/aaaa · inclui R$ X de rendimento`;
- rendimento `null`: `balancete de dd/mm/aaaa · rendimento não lido` (null não vira zero);
- rendimento `0`: `balancete de dd/mm/aaaa · sem rendimento`.

O rendimento aparece **só como contexto**, com centavos (`R$ 11.240,15`). Ele já está dentro do saldo disponível (rodapé da FUNAPE: "saldo disponível pós IR/IOF estimado s/ rend. apl. financeira"), então não existe soma, nem `saldo + rendimento`, em nenhum ponto.

### 2.3. Clique e acessibilidade

O valor e o rendimento usam o mesmo caminho da aba Documentos (`abrirDocumentoDaAba`):

- valor: `{ alvo_tabela: 'balancetes', alvo_id, campo: 'saldo_disponivel' }`, aria-label "Ver origem do saldo em conta de R$ … no balancete de dd/mm/aaaa";
- rendimento: o mesmo `alvo_id`, `campo: 'rendimento_liquido'`, aria-label "Ver origem do rendimento de R$ … no balancete de dd/mm/aaaa".

O `title` do cartão e o do valor repetem a frase de ajuda; o do rendimento diz "Rendimento tem regras próprias de uso." Nenhum padrão visual novo: são os `Valor` clicáveis que já existem (sublinhado pontilhado) e `title` nativo.

### 2.4. Estados

Seguindo "falha de consulta nunca vira zero":

- carregando: `Valor` vazio com motivo `consultando`, contexto `consultando`;
- erro nos balancetes: `—` com `title` igual a `docsSt.erroBalancetes`, contexto `indisponível`;
- centro sem balancete: `—` com motivo `sem balancete`, contexto `sem balancete`;
- `saldo_disponivel` nulo no mais recente: `—` com motivo `saldo não lido`; o contexto continua mostrando a data e o rendimento, e **não** cai para um balancete anterior.

## 3. Grade de cinco destaques

`Destaque.css` ganhou a variante `grade-destaques--cinco`, aplicada só na página do projeto. Em vez de espremer cinco colunas:

- desktop (> 1024 px): grade de 6 colunas; principal e "Dinheiro em conta" ocupam 3 colunas cada (primeira linha) e bolsas/repasses/pendências ocupam 2 cada (segunda linha). Os dois blocos de dinheiro ficam lado a lado, no topo;
- até 1024 px: a grade base de 2 colunas volta e o principal ocupa a linha inteira; os outros quatro ficam em 2×2;
- até 640 px: mesma grade de 2 colunas, com padding e fonte dos valores reduzidos como antes.

Em 375 px a conta fecha sem rolagem horizontal: 343 px de conteúdo, duas colunas de ~165 px, ~133 px úteis dentro do cartão, e o valor em `--fs-4` (`R$ 184.250` ocupa ~108 px). O contexto quebra linha; o rendimento clicável continua inline.

**Tema:** o app v2 tem um único conjunto de tokens em `app/src/estilo/tokens.css` (não há `prefers-color-scheme` nem variante escura). O bloco novo não introduz cor literal: usa `--cor-superficie`, `--cor-texto`, `--cor-texto-3`, `--cor-borda` etc., então acompanha qualquer tema que venha a ser definido nos tokens.

## 4. Exemplo e origem

- Todos os balancetes de `BALANCETES_EXEMPLO` ganharam `rendimento_liquido`, alinhado ao `SALDOS_EXEMPLO` de cada centro (cerrado 11.240,15; atlas 3.180; nascentes 2.100; corredor 1.850; solos 1.400).
- `IDS.florestal` ficou com `rendimento_liquido: null` — é o centro de exemplo que exercita "rendimento não lido".
- Corredor e Solos ganharam balancete de exemplo (antes só o resumo dizia que havia balancete), para o destaque não contradizer o saldo principal.
- `origem()` no modo exemplo agora aceita `campo: 'rendimento_liquido'`: no balancete com PDF devolve `tipo: 'documento'` com o fato do rendimento; nos demais, `tipo: 'legado'` com `busca: { texto: 'rendimento liquido', valor }`.
- O manifesto do PDF sintético ganhou o fato `rendimento_liquido` (`RENDIMENTO LIQUIDO APURADO: R$ 11.240,15.`), tanto no gerador (`gerar-pdf-exemplo.mjs`) quanto no fallback em memória (`MANIFESTO_FALLBACK`).

A aba Documentos não foi alterada: o rótulo da linha (`Tipo: Balancete`, documento e data) não ficou redundante com o destaque novo e nada foi removido dela.

## 5. Testes

### 5.1. Novos testes em `app/tests/projeto.test.jsx`

1. balancete mais recente por `data_referencia` mesmo vindo fora de ordem; rendimento aparece sem somar (não existe `195.490`) e o balancete anterior não é usado;
2. empate de `data_referencia`: vence o `created_at` mais novo; rendimento zero vira `sem rendimento`;
3. `saldo_disponivel` nulo no mais recente: `—`, `saldo não lido`, `rendimento não lido`, sem fallback para o anterior;
4. erro nos balancetes: `—`, motivo no `title`, nunca `R$ 0,00`;
5. centro sem balancete: `sem balancete`;
6. estado `consultando` enquanto os balancetes não chegam;
7. clique no valor e no rendimento: `origem` chamada com `campo: 'saldo_disponivel'` e `campo: 'rendimento_liquido'`, com aria-label próprio ("saldo em conta" e "rendimento") e a ajuda nos `title`.

Também foram acrescentadas provas em `app/tests/dados.test.js` (origem de exemplo para `rendimento_liquido` nos ramos documento e legado; centro com `null`) e no `pdf-exemplo.test.js` (fato novo no manifesto).

### 5.2. Resultados

| Comando | Resultado |
|---|---|
| `npm test` em `app/` | **verde** — 13 arquivos, 93 testes |
| `npm run build` em `app/` | **verde** — guarda de estilo sem violações, Vite transformou 1690 módulos, `verificar-build` não achou dado de exemplo no bundle |
| `npm run lint` na raiz | **verde** — `eslint frontend/js/ mcp/ app/` sem saída |
| `npx vitest run` na raiz | **verde** — 43 arquivos passaram + 1 pulado; 685 testes passaram + 19 pulados |

Os pulos são os condicionais já existentes: `pglite` local ausente no roteiro 064 e fixtures opcionais. Nenhum dado real entrou nos testes.

## 6. Decisões e observações

- **Cinco em uma linha ou 2+3?** A grade de 6 colunas com 2+3 foi escolhida de propósito: mantém os dois números de dinheiro grandes e lado a lado, sem reduzir a fonte de todos os cartões nem deixar um quinto cartão sozinho na segunda linha. Abaixo de 1024 px a grade quebra em 1 + 2 + 2.
- **Nenhuma mudança de banco.** A seleção usa o retorno de `get_balancetes_by_project`, que já traz `rendimento_liquido` e `created_at`. `get_origem_v2` já aceitava o campo (064/065); só o modo exemplo foi completado.
- **Documento de origem do rendimento.** O clique usa o mesmo `abrirDocumentoDaAba`; quando o balancete de exemplo não tem PDF, a nota de "sem arquivo" continua aparecendo na aba Documentos, como já acontecia para o saldo.
- **Tema.** Como o app v2 não tem alternância de tema implementada, a conferência foi feita sobre os tokens (sem cor literal). Se o tema escuro for adicionado em `tokens.css`, este bloco segue automaticamente.

## 7. Pronto quando

- [x] Destaque "Dinheiro em conta" logo depois do principal.
- [x] Balancete mais recente por `data_referencia` (empate por `created_at`), sem recálculo.
- [x] Rendimento no contexto, com `null` → "rendimento não lido" e `0` → "sem rendimento", nunca somado.
- [x] Valor e rendimento clicáveis pelo caminho de `abrirDocumentoDaAba`, com campos e rótulos próprios.
- [x] Frases de ajuda no `title`, sem padrão visual novo.
- [x] Estados `consultando`, erro, `sem balancete` e `saldo não lido` sem virar zero.
- [x] Grade de 5 destaques regular em desktop e em 375 px, só com tokens.
- [x] Exemplo com `rendimento_liquido`, centro com `null` e `origem` respondendo para o campo.
- [x] `npm test` e `npm run build` em `app/`; `npm run lint` e `npx vitest run` na raiz: verdes.
- [x] Relatório e arquivo da tarefa no commit, sem push.
