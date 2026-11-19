# Relatório F2-H — bloco "Dinheiro em conta" no topo do projeto

Branch: `redesenho/f2-h-dinheiro` (worktree `C:/Users/amara/dev/cf-f2-c`, a partir do `master` 49cbc2c).
**Sem push, sem migração, sem tocar no banco, sem alterar `frontend/` (site antigo) e sem chamar outra IA.**
Este arquivo cobre a entrega original (commit `b446459`) e a 2ª rodada de revisões (seção 8).

## 1. O que mudou

| Arquivo | Mudança |
|---|---|
| `app/src/paginas/Projeto.jsx` | Balancete mais recente, `Destaque` "Dinheiro em conta", contexto/estados, abertura da origem, carregamento separado de balancetes e planos, guarda na troca de centro e `AvisoFalha` no topo |
| `app/src/componentes/Destaque.jsx` | `ajuda` como único `title` (no rótulo) e `ajudasOcultas` (`sr-only`) para `aria-describedby` |
| `app/src/componentes/Valor.jsx` | `rotuloOrigem`, `ariaDescritoPor` e `ariaBusy`; saiu o `dica` |
| `app/src/componentes/Tabela.jsx` | `chaveCarregando` marca a linha em consulta (`aria-busy`) |
| `app/src/componentes/Destaque.css` | Variante de 5 destaques (2+3), `min-width: 0` e `overflow-wrap: anywhere` |
| `app/src/servicos/dadosExemplo.js` | `rendimento_liquido` nos balancetes de exemplo, centro com `null` e `origem` de exemplo para o campo |
| `app/scripts/gerar-pdf-exemplo.mjs` | Fato `rendimento_liquido` no manifesto do PDF sintético |
| `app/tests/projeto.test.jsx` | 11 testes do destaque, incluindo ordem, estados, efeitos de clique, planos pendentes, aviso no topo e troca de centro |
| `app/tests/valor.test.jsx` | 5 testes de `Valor`/`Destaque`: `rotuloOrigem`, `aria-describedby`, título único, valores longos e regra de quebra no CSS |
| `app/tests/dados.test.js` | Prova do `origem` de exemplo para `rendimento_liquido` (documento e legado) e do centro com `null` |
| `app/tests/pdf-exemplo.test.js` | Manifesto passa a exigir o fato `rendimento_liquido` |
| `docs/redesenho/tarefas/F2-H-dinheiro.md` | Arquivo da 1ª rodada incluído no commit original |
| `docs/redesenho/tarefas/F2-H-rodada2.md` | Arquivo desta rodada incluído no commit novo |
| `docs/redesenho/relatorios/F2-H.md` | Este relatório |

## 2. Regra do destaque

### 2.1. Qual balancete

O destaque lê `docsSt.balancetes` (o que a página já carrega com `get_balancetes_by_project`) e escolhe o balancete de maior `data_referencia`. A 026 garante `unique (project_id, data_referencia)` e `data_referencia not null`, então não existe empate; a checagem de data é só defesa contra entrada incompleta. `created_at` não decide nada.

Nada é recalculado: o valor exibido é o `saldo_disponivel` cru do balancete escolhido. O topo mostra reais inteiros (`centavos={false}`), como o destaque principal: `184.250,40` vira **R$ 184.250** (arredondado para o inteiro mais próximo pelo `Intl`). O rendimento no contexto mantém os centavos.

### 2.2. Contexto e rendimento

O contexto segue o formato pedido:

- rendimento com valor: `balancete de dd/mm/aaaa · inclui R$ X de rendimento`;
- rendimento `null`: `balancete de dd/mm/aaaa · rendimento não lido` (null não vira zero);
- rendimento `0`: `balancete de dd/mm/aaaa · sem rendimento`.

O rendimento aparece **só como contexto**, com centavos (`R$ 11.240,15`). Ele já está dentro do saldo disponível (rodapé da FUNAPE: "saldo disponível pós IR/IOF estimado s/ rend. apl. financeira"), então não existe soma, nem `saldo + rendimento`, em nenhum ponto.

### 2.3. Clique e acessibilidade

O valor e o rendimento usam o mesmo caminho da aba Documentos (`abrirDocumentoDaAba`):

- valor: `{ alvo_tabela: 'balancetes', alvo_id, campo: 'saldo_disponivel' }`, aria-label "Ver origem do saldo em conta de R$ … no balancete de dd/mm/aaaa";
- rendimento: o mesmo `alvo_id`, `campo: 'rendimento_liquido'`, aria-label curto "Ver origem do rendimento" (a frase em volta já diz o valor e a data).

A ajuda tem **um único `title`**, no rótulo do destaque. O botão do valor é ligado ao texto de ajuda por `aria-describedby` (um `span.sr-only` no próprio cartão); o rendimento tem a sua própria descrição oculta, "Já está dentro do dinheiro em conta. Rendimento tem regras próprias de uso." O `div` e os botões não repetem `title`, e os `origem.resumo` que ficariam mortos nesses dois pontos foram removidos.

### 2.4. Estados e retorno do clique

Seguindo "falha de consulta nunca vira zero":

- carregando: `Valor` vazio com motivo `consultando`, contexto `consultando`; o destaque olha **só** `carregandoBalancetes`, então planos pendentes não seguram o dinheiro;
- erro nos balancetes: `—` com `title` igual a `docsSt.erroBalancetes`, contexto `indisponível`, **e** um `AvisoFalha` no topo, com "Tentar de novo" → `carregarDocumentos`. Quando a aba Documentos já mostra o aviso (documentos carregados), o aviso do topo some para não duplicar; se a aba ainda está no esqueleto, o aviso do topo continua;
- centro sem balancete: `—` com motivo `sem balancete`, contexto `sem balancete`;
- `saldo_disponivel` nulo no mais recente: `—` com motivo `saldo não lido`; o contexto continua mostrando a data e o rendimento, e **não** cai para um balancete anterior.

Ao clicar no saldo ou no rendimento, o contexto vira `abrindo documento…` e o botão do valor fica `aria-busy` enquanto `origem` carrega. A linha correspondente da aba Documentos usa o mesmo id (`bal-<id>`) e mostra `· consultando…`, com `aria-busy` no `<tr>`. Se a origem não trouxer documento (nota) ou falhar, a aba Documentos é selecionada e o bloco é rolado até a nota/erro, que já existem lá.

Ao trocar de centro, `docsSt` é zerado no mesmo efeito de `[projectId]` e a renderização ignora dados de outro `projectId` (guarda `docsDoCentro`), então o primeiro paint do centro novo não reaproveita o dinheiro do anterior.

## 3. Grade de cinco destaques

`Destaque.css` ganhou a variante `grade-destaques--cinco`, aplicada só na página do projeto. Em vez de espremer cinco colunas:

- desktop (> 1024 px): grade de 6 colunas; principal e "Dinheiro em conta" ocupam 3 colunas cada (primeira linha) e bolsas/repasses/pendências ocupam 2 cada (segunda linha). Os dois blocos de dinheiro ficam lado a lado, no topo;
- até 1024 px: a grade base de 2 colunas volta e o principal ocupa a linha inteira; os outros quatro ficam em 2×2;
- até 640 px: mesma grade de 2 colunas, com padding e fonte dos valores reduzidos como antes.

Em 375 px a conta fecha sem rolagem horizontal: 343 px de conteúdo, duas colunas de ~165 px, ~133 px úteis dentro do cartão, e o valor em `--fs-4` (`R$ 184.250` ocupa ~108 px). Para valores longos, `.destaque` tem `min-width: 0` e `.destaque__valor` tem `overflow-wrap: anywhere`: R$ 12.345.679 (e o negativo) quebram dentro do cartão em vez de estourar a tela. O caso está registrado em `app/tests/valor.test.jsx`.

**Tema:** o app v2 tem um único conjunto de tokens em `app/src/estilo/tokens.css` (não há `prefers-color-scheme` nem variante escura). O bloco novo não introduz cor literal: usa `--cor-superficie`, `--cor-texto`, `--cor-texto-3`, `--cor-borda` etc., então acompanha qualquer tema que venha a ser definido nos tokens.

## 4. Exemplo e origem

- Todos os balancetes de `BALANCETES_EXEMPLO` ganharam `rendimento_liquido`, alinhado ao `SALDOS_EXEMPLO` de cada centro (cerrado 11.240,15; atlas 3.180; nascentes 2.100; corredor 1.850; solos 1.400).
- `IDS.florestal` ficou com `rendimento_liquido: null` — é o centro de exemplo que exercita "rendimento não lido".
- Corredor e Solos ganharam balancete de exemplo (antes só o resumo dizia que havia balancete), para o destaque não contradizer o saldo principal.
- `origem()` no modo exemplo agora aceita `campo: 'rendimento_liquido'`: no balancete com PDF devolve `tipo: 'documento'` com o fato do rendimento; nos demais, `tipo: 'legado'` com `busca: { texto: 'rendimento liquido', valor }`.
- O manifesto do PDF sintético ganhou o fato `rendimento_liquido` (`RENDIMENTO LIQUIDO APURADO: R$ 11.240,15.`), tanto no gerador (`gerar-pdf-exemplo.mjs`) quanto no fallback em memória (`MANIFESTO_FALLBACK`).

A aba Documentos não mudou de rótulo: `Tipo: Balancete`, documento e data continuam iguais. O que mudou nela foi o estado de consulta, que agora fica na linha (`· consultando…` + `aria-busy`) em vez de uma nota global; a nota/erro de uma origem continua no bloco da aba.

## 5. Testes

### 5.1. Testes do destaque em `app/tests/projeto.test.jsx`

1. usa o balancete mais recente por `data_referencia`, mesmo fora de ordem; compara o texto exato do valor (`R$ 184.250`) e proíbe `195.490` e `195.491` (a soma de saldo + rendimento);
2. escolhe pela `data_referencia`, não pela posição da lista, com três entradas desordenadas; rendimento zero vira `sem rendimento`;
3. `saldo_disponivel` nulo no mais recente: `—`, `saldo não lido` e `rendimento não lido`, sem fallback para o anterior;
4. erro nos balancetes: `—`, motivo no `title`, `AvisoFalha` no topo e nenhum `R$ 0`;
5. centro sem balancete: `sem balancete`;
6. estado `consultando` enquanto os balancetes não chegam;
7. clique no valor abre o modal com o documento; clique no rendimento sem documento seleciona a aba Documentos com a nota visível; falha da origem seleciona a aba com o erro visível;
8. enquanto a origem carrega, o contexto vira `abrindo documento…` e o botão fica `aria-busy`;
9. planos pendentes para sempre, balancetes respondidos: o destaque mostra o saldo (a aba Documentos continua carregando);
10. erro dos balancetes aparece no topo com "Tentar de novo"; na aba Documentos o aviso do topo some e fica só o da aba; a retentativa recarrega e mostra o valor;
11. troca de `projectId` no mesmo componente não mostra o dinheiro do centro anterior e volta a `consultando`.

### 5.2. Testes de `Valor`/`Destaque` em `app/tests/valor.test.jsx`

- `rotuloOrigem` substitui o aria-label e `ariaDescritoPor`/`ariaBusy` viram `aria-describedby`/`aria-busy`;
- sem `rotuloOrigem`, o `origem.resumo` continua no aria-label padrão;
- a ajuda fica só no rótulo do `Destaque` (o cartão não tem `title`);
- valores longos e negativos aparecem por inteiro (`R$ 12.345.679` e `−R$ 12.345.679`);
- `Destaque.css` tem `min-width: 0` e `overflow-wrap: anywhere`.

Também foram mantidas as provas em `app/tests/dados.test.js` (origem de exemplo para `rendimento_liquido` nos ramos documento e legado; centro com `null`) e no `pdf-exemplo.test.js` (fato novo no manifesto).

### 5.3. Resultados

| Comando | Resultado |
|---|---|
| `npm test` em `app/` | **verde** — 14 arquivos, 102 testes |
| `npm run build` em `app/` | **verde** — guarda de estilo sem violações, Vite transformou 1690 módulos, `verificar-build` não achou dado de exemplo no bundle |
| `npm run lint` na raiz | **verde** — `eslint frontend/js/ mcp/ app/` sem saída |
| `npx vitest run` na raiz | **verde** — 43 arquivos passaram + 1 pulado; 685 testes passaram + 19 pulados |

Os pulos são os condicionais já existentes: `pglite` local ausente no roteiro 064 e fixtures opcionais. Nenhum dado real entrou nos testes.

## 6. Decisões e observações

- **Cinco em uma linha ou 2+3?** A grade de 6 colunas com 2+3 foi escolhida de propósito: mantém os dois números de dinheiro grandes e lado a lado, sem reduzir a fonte de todos os cartões nem deixar um quinto cartão sozinho na segunda linha. Abaixo de 1024 px a grade quebra em 1 + 2 + 2.
- **Nenhuma mudança de banco.** A seleção usa o retorno de `get_balancetes_by_project`, que já traz `rendimento_liquido`. `get_origem_v2` já aceitava o campo (064/065); só o modo exemplo foi completado.
- **Ajuda sem repetição.** O texto de ajuda existe uma vez no `title` do rótulo e uma vez no `sr-only` ligado por `aria-describedby`; não há `title` no cartão nem nos botões. O rendimento tem uma descrição própria, também oculta.
- **Documento de origem do rendimento.** O clique usa o mesmo `abrirDocumentoDaAba`; sem documento ou com erro, a aba Documentos é selecionada e rolada até a nota/erro. A linha da tabela usa o mesmo id de carregamento do topo (`bal-<id>`).
- **Carregamento separado.** `docsSt` tem `carregandoBalancetes` e `carregandoPlanos`; o destaque só depende do primeiro. A aba Documentos espera os dois porque a tabela é única.
- **Troca de centro.** Além de zerar `docsSt` no efeito de `[projectId]`, a renderização usa `docsDoCentro` e ignora estado de outro projeto — a guarda cobre o intervalo entre a troca e o efeito.
- **Tema.** Como o app v2 não tem alternância de tema implementada, a conferência foi feita sobre os tokens (sem cor literal). Se o tema escuro for adicionado em `tokens.css`, este bloco segue automaticamente.

## 7. Pronto quando

- [x] Destaque "Dinheiro em conta" logo depois do principal.
- [x] Balancete mais recente por `data_referencia`, sem recálculo e sem empate artificial.
- [x] Rendimento no contexto, com `null` → "rendimento não lido" e `0` → "sem rendimento", nunca somado.
- [x] Valor e rendimento clicáveis pelo caminho de `abrirDocumentoDaAba`, com campos e rótulos próprios.
- [x] Um único `title` no rótulo; ajuda ligada ao valor por `aria-describedby`; sem `dica` repetida.
- [x] Estados `consultando`, erro, `sem balancete` e `saldo não lido` sem virar zero.
- [x] Erro dos balancetes no topo, com retentativa, sem duplicar o da aba.
- [x] Clique com retorno: `abrindo documento…`/`aria-busy`, aba Documentos com nota/erro e linha em consulta.
- [x] Troca de centro não mostra o dinheiro anterior.
- [x] Grade de 5 destaques regular em desktop e em 375 px, com quebra de valores longos.
- [x] Exemplo com `rendimento_liquido`, centro com `null` e `origem` respondendo para o campo.
- [x] `npm test` e `npm run build` em `app/`; `npm run lint` e `npx vitest run` na raiz: verdes.
- [x] Relatório e arquivos das duas rodadas no commit novo, sem push.

## 8. 2ª rodada (revisões MiniMax max e DeepSeek max do `b446459`, conferidas pelo Claude)

Nenhum achado alto. O que foi corrigido:

1. **Frase de ajuda.** O livre não é "a conta menos o comprometido"; o texto agora é "Tudo o que está na conta do projeto, pelo último balancete. O livre é outra conta: o previsto no plano menos o que já foi gasto e o que já está comprometido (bolsas, taxas)." O rendimento usa "Já está dentro do dinheiro em conta. Rendimento tem regras próprias de uso."
2. **Ajuda acessível e sem repetição.** Único `title` no rótulo; saíram o `title` do `div` e o `dica` repetido. A ajuda do valor é um `span.sr-only` ligado por `aria-describedby`; os `origem.resumo` mortos foram removidos dos dois pontos que já têm `rotuloOrigem`.
3. **Rótulo do rendimento.** `aria-label` curto, "Ver origem do rendimento"; a frase em volta continua dizendo valor e data.
4. **Clique com retorno.** O contexto vira `abrindo documento…` e o valor fica `aria-busy`; sem documento ou com erro, a aba Documentos é selecionada e o bloco é rolado. O topo usa o mesmo id `bal-<id>` da linha, que mostra `· consultando…` e `aria-busy`.
5. **"Consultando" separado.** `docsSt` ganhou `carregandoBalancetes`/`carregandoPlanos`; o destaque olha só balancetes. Teste com planos pendentes e balancetes respondidos passa.
6. **Falha só no `title`.** `erroBalancetes` agora tem `AvisoFalha` no topo com "Tentar de novo" → `carregarDocumentos`, oculto quando a aba Documentos já mostra o mesmo erro; se a aba ainda está no esqueleto, o topo assume o aviso.
7. **Troca de centro.** `docsSt` é zerado no efeito de `[projectId]` e a renderização usa `docsDoCentro` para ignorar dados de outro projeto antes do primeiro paint. Teste de rerender trocando o `projectId` passa.
8. **Número longo em 375 px.** `min-width: 0` no `.destaque` e `overflow-wrap: anywhere` no `.destaque__valor`, valendo para os cinco. Registro com R$ 12.345.679 e o negativo em `valor.test.jsx`.
9. **Empate impossível.** `balanceteMaisRecente` só compara `data_referencia` (ignora entrada sem data por defesa); o teste de empate virou teste de ordem com três entradas.
10. **Testes que provam.** Texto exato do valor, proibição de `195.491` e de `R$ 0`; o teste de clique prova o modal com documento, a aba Documentos com a nota e a aba com o erro; `valor.test.jsx` cobre `rotuloOrigem` com e sem, `aria-describedby` e o título único.
11. **Relatório.** Registrado que o valor do topo sai sem centavos (arredondado) e corrigida a contagem de `title`: agora é um só, no rótulo.

Resultado depois da rodada: `app/` com **14 arquivos e 102 testes**; build, lint e os testes da raiz verdes. Nada de banco, nada de `frontend/` e nada de push.
