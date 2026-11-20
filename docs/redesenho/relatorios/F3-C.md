# Relatório F3-C — Migração 069: motivo dos selos, tarifa bancária e ajustes da 068

Branch: `redesenho/f3-c-069` (worktree `C:/Users/amara/dev/cf-f3-c`, a partir do `master` f1333c6).
**Nada foi aplicado em produção**, nenhum `CF_*` real foi usado, nenhum dado real (nome, CPF ou código de centro)
entrou em teste, fixture ou modo exemplo e **nenhuma outra IA foi chamada**. O runner do PGlite rodou só em memória.
Sem push, como pedido.

## 1. O que foi entregue

| Arquivo | Mudança |
|---|---|
| `database/069_motivos_e_ajustes.sql` | Migração: helper `_situacao_centro`, `resumo_projetos_v2` com `motivos`, RPC `situacao_centro_v2` e recriação das seis RPCs de caixa com os ajustes da revisão da 068 |
| `tests/sql/test_069_motivos_e_ajustes.sql` | Roteiro autoconferido (blocos 0–7) |
| `tools/replica-local/rodar-069-pglite.mjs` | Executor PGlite: base 063…068, defeito antes, cofre, idempotência, `test_068` depois da 069, resumo antes/depois, barreira 051, helpers e 6 mutantes |
| `docs/migracoes.md` | Linha da 069 ("ainda não aplicada") |
| `docs/redesenho/ESTADO.md` | F3-C na tabela e registro de 20/11 |
| `app/src/componentes/Situacao.jsx` / `.css` | Balão de motivos no selo (hover, foco, toque, Esc, portal no `body`) |
| `app/src/paginas/Projetos.jsx` | Passa `centro.motivos` ao selo |
| `app/src/paginas/Projeto.jsx` | Selo do topo e das rubricas via `situacaoCentro`; `situacaoGrupo` com tarifa; fallback para a regra de hoje |
| `app/src/servicos/dados.js` | Validação de `motivos`, `situacaoCentro` com fallback `42883`/`PGRST202` e `editarItemCaixa` com `parseValorBR` |
| `app/src/servicos/dadosExemplo.js` | Resumo com `motivos`, `situacaoCentro`, centro fictício de tarifa e motivos nos demais centros; `editarItemCaixa` pt-BR |
| `app/src/paginas/Bolsistas.jsx` | "Tirar quem saiu da lista" em dois passos ("Sim, tirar"/"Cancelar") |
| `app/tests/situacao-motivos.test.jsx` | Balão no hover/foco/Esc, fora da lista e da tabela; selo sem motivos igual a antes |
| `app/tests/situacao-centro.test.js` | Validador, fallback sem RPC, `editarItemCaixa("4.500")` e modo exemplo |
| `app/tests/bolsistas.test.jsx` | Confirmação em dois passos do "Tirar quem saiu da lista" |
| `app/tests/projeto.test.jsx` / `termos-contrato.test.jsx` | Mock de `situacaoCentro` (fallback por padrão) e caso tarifa na rubrica/regra antiga |
| `app/tests/dados.test.js` | 8 árvores de exemplo (entrou a do centro com tarifa) |
| `docs/redesenho/tarefas/F3-C-069.md` | Arquivo da tarefa, incluído no commit |

## 2. Tamanho dos arquivos

| Arquivo | Bytes | Linhas |
|---|---:|---:|
| `database/069_motivos_e_ajustes.sql` | **40.704** | 1.144 |
| `tests/sql/test_069_motivos_e_ajustes.sql` | **29.710** | 606 |
| `tools/replica-local/rodar-069-pglite.mjs` | **14.950** | 376 |
| `app/src/componentes/Situacao.jsx` | 6.190 | 176 |
| `app/src/componentes/Situacao.css` | 2.150 | 106 |
| `app/src/servicos/dados.js` | 35.545 | 1.134 |
| `app/src/servicos/dadosExemplo.js` | 95.701 | 2.973 |
| `app/src/paginas/Projeto.jsx` | 82.710 | 2.355 |
| `app/src/paginas/Bolsistas.jsx` | 40.120 | 1.102 |
| `app/src/paginas/Projetos.jsx` | 8.442 | 246 |

A migração fica abaixo de 90 KB, começa com `begin;` como primeiro comando SQL e termina com `commit;` como
último; não tem `commit`/`savepoint` no meio nem os termos proibidos do cofre (`password`, `service_role`,
`net.`, `http(`, `dblink`, `cron.`, `vault.`, `create extension`, `concurrently`, `vacuum`, `copy`,
`set role`, `alter default privileges`…). Os dois `.sql` novos estão em **LF** no disco, como o runner exige.
A migração **não insere, altera nem apaga dados**: os únicos `insert`/`delete` do texto estão dentro do corpo
das RPCs de caixa, que são função, não dado da migração.

## 3. Banco: `database/069_motivos_e_ajustes.sql`

### 3.1. A. Situação do centro com motivos

`public._situacao_centro(p_project_id uuid, p_sl jsonb, p_pend_abertas int) returns jsonb` é um helper interno
`security definer`, `stable`, `set search_path = public, pg_temp`, sem `EXECUTE` para `authenticated`, `anon`
nem `PUBLIC`. Recebe o retorno de `get_saldo_livre` já calculado (não chama de novo) e devolve
`{ situacao, motivos }`.

A regra de hoje continua, com a exceção da tarifa:

- sem plano → `sem plano`; sem balancete → `sem balancete`;
- grupo com `saldo_livre < 0` não coberto pela tarifa → `problema`;
- defasagem `>= 2` meses, pendência aberta ou grupo negativo **coberto pela tarifa** → `atenção`;
- senão → `em dia`.

A tarifa usa o mesmo balancete de `get_saldo_livre` (`balancetes` do centro por `data_referencia desc limit 1`)
e a mesma regra de rubrica → grupo da 066: `balancete_lancamentos.rubrica_code`, com
`coalesce(r.parent_code, r.code)` como grupo. A linha é tarifa quando `conta_codigo = '7.1.3.05.01.00054'` ou
quando a descrição, sem acento e em maiúsculas, contém `SERVICOS BANCARIOS` ou `TARIFA BANCARIA`. A
normalização é `translate` (minúsculas e maiúsculas acentuadas para ASCII) + `upper`, sem extensão. Um grupo
negativo é coberto quando `−saldo_livre <= soma(saldo_atual das linhas de tarifa do grupo)`; se o negativo
passar disso, continua `problema` e o texto de `saldo_negativo` cita o valor acima do previsto **e** a parcela
de tarifa.

`motivos` é uma lista em ordem de gravidade, cada item com exatamente
`{ codigo, nivel, texto, grupo_code, valor }` (`nivel` em `problema`/`atenção`/`info`):

- `saldo_negativo` (problema): `"Rubrica b — Serviços de Terceiros P. Jurídica: gasto R$ X acima do previsto."`,
  um por grupo, com `valor = abs(saldo_livre)`;
- `tarifa_bancaria` (atenção): o texto do pedido, com `R$ 14,34` no caso do ILPF, `valor = soma da tarifa`;
- `balancete_atrasado` (atenção): `"O último balancete cobre até MM/AAAA (N meses atrás)."`;
- `pendencias_abertas` (atenção): N pendências, até 3 títulos dos mais antigos (`criada_em, id`) e `"e mais K"`;
  a consulta usa o mesmo centro e o mesmo aberto que a RPC de pendências já mostra;
- `sem_plano`, `sem_balancete` (info), `em_dia` (info, só em dia) e `falha` (info, no caminho do `exception`,
  situação `sem dado`): `"Não foi possível calcular o saldo deste centro."`.

`resumo_projetos_v2` foi recriada com as **mesmas chaves e valores** da 063 e a chave nova `motivos`. A
comparação antes/depois no runner confirma a igualdade estrutural de todos os centros da base, tirando só
`motivos`. O caminho do `exception` mantém `erro = 'falha_saldo_livre'` e `situacao = 'sem dado'`, com o motivo
`falha` vindo do mesmo helper (passando `p_sl = null`).

`public.situacao_centro_v2(p_project_id uuid)` é a RPC de leitura do selo de cada centro: definer,
`search_path` fixo, ACL igual à de `resumo_projetos_v2` (EXECUTE só para `authenticated`), `assert_project_allowed`
e uma checagem explícita de escopo que devolve **42501** para professor fora do centro. O `assert_project_allowed`
sozinho levanta `P0001`, e o teste da tarefa pede 42501; por isso a checagem vem antes. Ela conta as pendências
abertas do centro e devolve o mesmo `{ situacao, motivos }` do helper. `p_project_id` nulo → 22023; falha de
`get_saldo_livre` → `sem dado` + `falha`, sem derrubar a tela.

### 3.2. B. Ajustes da revisão final da 068

As seis RPCs que fazem `select … for update` na caixa foram recriadas com a assinatura, os atributos e a ACL
da 068:

1. **`salvar_caixa_pedido_v2`** — o `select … for update` filtra `c.id = v_id and c.dono = auth.uid()`;
2. **`apagar_caixa_pedido_v2`** — mesmo filtro e o `pg_advisory_xact_lock(hashtextextended('caixas_pedido:' || dono, 0))`
   depois de confirmar o dono;
3. **`colocar_na_caixa_v2`** — exige `_bolsista_no_pedido` (a regra da lista e do "Tirar quem saiu da lista"),
   não só `_bolsista_visivel`: pessoa visível fora da janela de 180 dias → `22023` `"Essa pessoa não está na
   lista do pedido."` (sem nome); pessoa fora do escopo continua `42501`. O filtro do dono entrou no
   `for update`; a origem e o `saiu_de` usam a mesma ordem `order by c.criado_em, c.id`, então o valor/nota
   levados são os da mesma caixa que aparece primeiro em `saiu_de`;
4. **`editar_item_caixa_v2`**, **`tirar_da_caixa_v2`** e **`limpar_ocultos_da_caixa_v2`** — o `for update` da
   caixa filtra o dono. A resposta para caixa alheia continua `P0002`, igual à inexistente.

`colocar_na_caixa_v2` foi recriada sem `drop function` (a assinatura não mudou). O `create or replace` repete
`security definer`, `set search_path = public, pg_temp`, guarda de agente/automação, CPF e grants.

### 3.3. Asserções no fim da migração

Dentro de `begin/commit`, o bloco `$asserts$` confere:

- `prosecdef` e `proconfig = array['search_path=public, pg_temp']` exatos nas nove funções tocadas;
- helper sem EXECUTE para `anon`, `authenticated` e `PUBLIC`; `resumo_projetos_v2` e `situacao_centro_v2` com
  EXECUTE só para `authenticated`;
- `pg_get_functiondef` de `colocar` contendo `_bolsista_no_pedido`; de `resumo` contendo `_situacao_centro`;
- as seis RPCs contendo, no texto, `dono = auth.uid()` antes do `for update`;
- `apagar_caixa_pedido_v2` contendo `pg_advisory_xact_lock`.

## 4. Teste SQL e runner

`tests/sql/test_069_motivos_e_ajustes.sql` roda sobre `montarBase064()` + 064 + `stub-064` + 065 + 066 + 067 + 068.
Todos os dados são sintéticos, com IDs e nomes de teste (`Teste 069 …`), e a transação termina em `rollback`.

Cobertura:

- **antes da 069** (runner): centro só com tarifa de R$ 14,34 sai `problema` no resumo antigo e
  `situacao_centro_v2` não existe → `42883`; o roteiro também falha antes com 42883;
- centro só com tarifa → `atenção` e motivo `tarifa_bancaria` com R$ 14,34, grupo `b`, valor 14,34;
- tarifa + outra despesa no mesmo grupo (previsto 50, realizado 114,34) → `problema`, um único
  `saldo_negativo` com "gasto R$ 64,34" e "R$ 14,34 disso é tarifa";
- tarifa pela descrição (`Tarifa bancária mensal`, conta `7.9.9.99.99999`) → conta; despesa comum sem
  previsão → continua `problema`;
- balancete atrasado → `atenção` com `balancete_atrasado` e o texto em MM/AAAA; quatro pendências abertas →
  `"4 pendências abertas: Pendência mais antiga; Segunda pendência; Terceira pendência e mais 1"`, sem o quarto
  título; ordem completa `saldo_negativo`, `tarifa_bancaria`, `balancete_atrasado`, `pendencias_abertas`;
- `em dia` com `em_dia`, `sem plano` com `sem_plano`, `sem balancete` com `sem_balancete`;
- chaves do centro (as 11 antigas + `motivos`) e chaves de cada motivo (as cinco exatas), níveis válidos e
  texto não vazio;
- `situacao_centro_v2` concorda com o resumo, `null` → 22023, id inexistente → `sem dado` + `falha`, professor
  fora do escopo → 42501, anon → 42501;
- `colocar` de pessoa visível fora da janela de 180 dias → 22023 com a mensagem certa; caixa alheia em cada
  uma das seis RPCs → P0002 (sem travar, provado pelo texto da função);
- duas caixas de origem com a mesma pessoa (dado montado pelo dono da tabela): `saiu_de` lista a antiga e a
  nova na ordem `criado_em, id`, e o valor/nota levados são os da antiga (111 e a nota antiga);
- ACL/atributos e os textos das seis funções;
- as RPCs antigas de caixa continuam criando e apagando.

`tools/replica-local/rodar-069-pglite.mjs` aplica 063…068, prova o defeito antigo, roda o teste antes (42883),
confere o cofre, aplica a 069, roda o teste, reaplica para idempotência, roda o `test_068` **depois** da 069,
confere a barreira `trg_bloqueia_agente` em todas as tabelas, compara os hashes dos 6 helpers protegidos,
compara o resumo antes/depois (sem `motivos`, com `deepStrictEqual`) e prova **6 mutantes**, cada um falhando pelo
motivo certo:

1. helper sem a exceção da tarifa → `69.TARIFA` sai `problema`;
2. `<=` trocado por `>=` → `69.MISTO` sai `atenção`;
3. `colocar` sem `_bolsista_no_pedido` → a pessoa fora da janela entra (o teste que esperava 22023 passa);
4. `salvar_caixa_pedido_v2` sem `dono = auth.uid()` no `for update` → a asserção de texto falha;
5. `apagar_caixa_pedido_v2` sem o advisory lock → a asserção de texto falha;
6. `grant execute` do helper para `authenticated` → a asserção de ACL falha.

O runner da 068 foi rodado de novo e continua verde com os **17 mutantes**.

## 5. App v2 (`app/`)

### 5.1. `Situacao.jsx`

Ganha a prop opcional `motivos`. Sem motivos, o componente é exatamente o de hoje: `span` com ponto e palavra,
sem `tabIndex`, sem `aria-describedby` e sem balão. Com motivos:

- o selo fica focável (`tabIndex=0`), com `aria-describedby` apontando para o balão;
- abre no `mouseover` (inclusive quando o ponteiro entra no texto interno), no foco (teclado e toque) e fecha no
  `mouseout`/`blur`; o `Esc` fecha pela `pilhaEsc.js` global;
- o balão é montado no `body` via `createPortal` e usa `position: fixed` com `top`/`left`/`width` calculados por
  `getBoundingClientRect`. Assim ele não é cortado pelo `overflow: hidden` da lista nem pelo `position:
  relative` da linha clicável da tabela; `z-index` é o `--z-painel`;
- um texto por linha, com um ponto de 6 px na cor do nível (`problema` vermelho, `atenção` âmbar, `info` neutro);
- a estimativa decide abrir abaixo ou acima; um `useLayoutEffect` mede o balão depois de montar e o sobe quando
  ele passaria da borda de baixo. O balão fica inteiro na tela em 1400 e em 390 px;
- o `style` inline usa só custom properties (`--balao-top`, `--balao-left`, `--balao-width`), como a guarda de
  estilo do `app/` exige; o CSS usa apenas tokens (`--esp-*`, `--raio-2`, `--sombra-sobreposta`, `--cor-*`,
  `--z-painel`).

### 5.2. `Projetos.jsx` e `Projeto.jsx`

- `Projetos.jsx` passa `centro.motivos` ao selo da lista.
- `Projeto.jsx` carrega `situacaoCentro(projectId)` junto com o saldo (com geração para descartar resposta
  atrasada na troca de centro) e usa a situação/motivos no selo do topo e no selo de cada rubrica. Sem dado da
  RPC nova, `situacaoTopo` cai em `resumoCentro.situacao` e `motivosTopo` em `resumoCentro.motivos`; sem
  `motivos`, o selo fica como antes.
- `situacaoGrupo` vira exportada e recebe os motivos do grupo: `saldo_livre < 0` com motivo
  `tarifa_bancaria` → `atenção`; sem tarifa, continua `problema`. O selo da rubrica recebe só os motivos
  daquele `grupo_code`. **Nada é recalculado no app**: a tarifa vem do banco.
- O destaque principal usa `situacaoTopo === 'problema'` para a cor de problema.

### 5.3. Serviços

- `resumoProjetos` valida `motivos` em cada centro: ausente (produção antes da 069) é aceito como lista vazia;
  presente precisa ser array e cada item precisa de `codigo` não vazio, `nivel` na lista e `texto` não vazio.
- `situacaoCentro(projectId)` chama `situacao_centro_v2` e valida `{ situacao, motivos }`. Se a RPC não existir
  (`42883`/`PGRST202`), devolve `{ dados: null, erro: null }` e a página usa a regra de hoje, sem aviso e sem
  quebrar.
- `editarItemCaixa` aceita string com `parseValorBR` (`"4.500"` → 4500) e number continua number; o modo exemplo
  faz o mesmo.

### 5.4. `Bolsistas.jsx` e modo exemplo

- "Tirar quem saiu da lista" abre a confirmação: `"Isso tira N pessoas da caixa e apaga o valor e a nota
  ajustados delas."` (singular para 1), com `"Sim, tirar"` e `"Cancelar"`. A RPC `limpar_ocultos_da_caixa_v2` só
  é chamada no "Sim".
- O modo exemplo tem um centro fictício novo (`30.909 Bacia Experimental do Rio Claro`) com tarifa de R$ 14,34
  em rubrica sem previsão, `atenção` e o motivo `tarifa_bancaria`; os centros existentes ganharam motivos de
  problema (`30.903`), balancete atrasado/pendências (`30.902`), pendências (`30.907`), sem plano, sem balancete
  e falha. O `30.901` segue sem motivos para a tela mostrar o selo antigo ao lado dos novos. O `SALDOS_EXEMPLO`,
  `ARVORES_EXEMPLO`, repasses, balancetes e planos do centro novo fecham ao centavo com o resumo
  (`ARVORES_EXEMPLO` agora tem 8 árvores, e o teste foi ajustado).

## 6. Verificação

| Comando | Resultado |
|---|---|
| `npx vitest run` (raiz) | **44 arquivos, 699 passaram, 5 pulados (704)** |
| `npm test --prefix app` | **21 arquivos, 167 passaram** |
| `npm run lint` (raiz, inclui `app/`) | **limpo** |
| `npm run build --prefix app` | guarda de estilo OK, Vite OK, verificação de build OK (nenhum dado de exemplo no bundle) |
| `node tools/replica-local/rodar-069-pglite.mjs` | **verde**: defeito antes, cofre (40.704 bytes), `test_069`, idempotência, `test_068` depois da 069, barreira 051, helpers intactos, resumo antes/depois e **6 mutantes** |
| `node tools/replica-local/rodar-068-pglite.mjs` | **verde**: 17 mutantes, sem regressão |

O `test_069` falha antes da 069 com **42883** (`situacao_centro_v2` ausente), como o runner exige. O resumo de
hoje foi guardado antes da migração e comparado depois, sem `motivos`, com igualdade estrutural nos 6 centros da
base. Os helpers protegidos (`is_agente`, `is_admin`, `allowed_project_ids`, `assert_project_allowed`,
`contem_cpf`, `bloqueia_escrita_do_agente`) mantiveram o mesmo `md5`.

### 6.1. Conferência na tela (`npm run dev:exemplo`)

Servidor Vite em modo exemplo (`http://localhost:5199/controle-financeiro-lapig/v2/`), Chrome headless via
DevTools Protocol. Em **1400 × 900** e **390 × 844**, na lista de centros e na tabela de rubricas do centro
`30.909`:

- o balão abre ao passar o mouse no selo e ao focar pelo teclado (o foco mostra o anel de foco);
- em todos os casos o balão é filho do `body` (`createPortal`), fica **fora** da `.lista-de-linhas` e da
  `.tabela-envoltorio`, e o retângulo inteiro cabe na janela (topo ≥ 0, base ≤ altura, esquerda ≥ 0, direita ≤
  largura). Abre acima ou abaixo do selo conforme o espaço, sempre **por cima** do conteúdo, sem ser cortado
  pelo `overflow: hidden` da lista;
- na lista ele cobre as linhas seguintes; na tabela cobre o cabeçalho/linhas, sem clipping;
- `Esc` fecha o balão nas quatro combinações (lista/tabela × 1400/390);
- as capturas ficaram fora do repositório, em
  `C:/Users/amara/AppData/Local/Temp/opencode/069-lista-1400.png`, `069-tabela-1400.png`,
  `069-lista-390.png` e `069-tabela-390.png`.

A primeira versão do balão abria abaixo quando a estimativa dizia que cabia; em 390 px o texto real passava da
borda de baixo. A medição pós-render (`useLayoutEffect`) corrigiu: se o balão medido passa da borda, ele sobe e
fica inteiro na tela. Também foi necessário dar `position: relative; z-index: var(--z-base)` ao selo dentro da
tabela, porque o `::after` do botão que estica a linha clicável cobria o selo e impedia o `mouseover`.

## 7. Decisões e observações

- **Tarifa**: a comparação é `−saldo_livre <= soma(saldo_atual das linhas de tarifa do grupo)`. A tarifa é
  reconhecida pela conta fixa `7.1.3.05.01.00054` **ou** pela descrição normalizada; o grupo é
  `coalesce(r.parent_code, r.code)`, igual à 066. Não há recálculo no app.
- **Ordem dos motivos**: problemas primeiro; depois as atenções na ordem dos grupos, o balancete atrasado e as
  pendências; `em_dia`/`sem_plano`/`sem_balancete`/`falha` são `info`.
- **`valor`**: em `saldo_negativo` é o valor absoluto do negativo do grupo; em `tarifa_bancaria` é a soma da
  tarifa. Motivos não monetários levam `null`.
- **`situacao_centro_v2` e 42501**: `assert_project_allowed` devolve `P0001`; a RPC faz a checagem de escopo
  antes para responder 42501, como o roteiro pede. O `assert` continua como defesa.
- **Fallback**: o site novo pode ser publicado antes da 069. `motivos` ausente é aceito e a RPC ausente vira
  `{ dados: null }`; nesse intervalo a página mostra exatamente a regra de hoje.
- **Semântica da tarifa**: tarifa é gasto comum da FUNAPE; o alerta não some, vira `atenção` com o motivo. Se o
  grupo tem despesa além da tarifa, o selo continua `problema` e o texto diz as duas coisas.
- **Teste do app**: o teste `dados.test.js` passou de 7 para 8 árvores de exemplo por causa do centro novo; o
  teste confere que todas fecham ao centavo e batem com o resumo.
- **Ambiente**: a raiz precisou de `npm install --prefix mcp --no-save --no-package-lock` porque
  `mcp/node_modules` estava ausente e o teste `test/rastreabilidade-backfill-064.test.js` não achava
  `pdfjs-dist`. A instalação é local, não versionada; depois disso a raiz ficou verde. `mcp/` não foi alterado.

## 8. O que não mudou

- `get_saldo_livre`, `explicar_livre_v2`, `calc_project_monthly` e os seis helpers protegidos: nenhuma linha
  tocada (os hashes são comparados no runner).
- Nenhuma tabela, coluna, policy, grant de tabela ou dado novo; a 069 só troca funções.
- `068_pedido_bolsas.sql`, `test_068_pedido_bolsas.sql` e `rodar-068-pglite.mjs` não foram editados (seguem
  `skip-worktree`); o roteiro da 068 roda depois da 069 e continua verde.

## 9. Pendências

- Revisão do Victor e ok para ensaiar/aplicar a 069 pelo cofre (a migração tem SECURITY DEFINER, então o
  relatório do cofre vai pedir revisão técnica).
- Aplicar a 069 **antes ou junto** de publicar o app novo que mostra os balões; entre o deploy e a aplicação o
  site continua funcionando pela regra de hoje.
- Conferir em produção, depois de aplicar, um centro com tarifa (o ILPF) e um com problema real; a tela do
  `/v2/` fica atrás do login.
