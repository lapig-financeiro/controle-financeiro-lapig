# Análise 1a — pacote de ferramentas `shared/ai-tools/` (25/11/2026)

Worktree `C:/Users/amara/dev/cf-analise-a`, branch `redesenho/analise-1-a`. **Sem push, sem deploy, sem
`CF_*` reais e sem chamar a produção.** O `worker/` não foi tocado (é o outro executor). Nenhuma outra IA
foi chamada. O contrato foi seguido à risca; onde a RPC de hoje não oferece o dado que o contrato previa,
o desvio está registrado no §5.

## 1. O que foi feito

- **Sessão** (`shared/ai-tools/index.js`): `criarSessao({ rpc, hoje })` com `executar`, `criarBloco`,
  `calcular`, `marcarTexto` e `reidratar`; `INSTRUCOES` e `especificacoes()` no formato `tools` do
  `/api/chat` do Ollama. Resultados ganham `r1`, `r2`… e nós `r1.1`, `r1.2`…; `calcular` ganha `c1`…
  A lista de centros é carregada uma vez por sessão e reaproveitada na resolução de código/id.
- **Ferramentas** (`shared/ai-tools/ferramentas/`): uma por ferramenta do §4 —
  `listar_centros`, `explicar_livre`, `situacao_centro`, `desembolsos`, `termos_contrato`, `pendencias`,
  `bolsas`, `criar_bloco` e `calcular`. Cada uma valida argumento, chama a RPC injetada, registra os nós
  com a melhor origem disponível e devolve `paraModelo` compacto. Erro de RPC, exceção ou formato
  inesperado vira `{ id, erro }`; nunca `0`, `[]` ou "sem dado".
- **Blocos** (`blocos.js`): `numero`, `tabela` e `texto`, com `valor`, `unidade` e `origem` lidos do
  registro. Recusas: id inexistente, célula literal, coluna com unidades misturadas, mais de 50 linhas
  ou 8 colunas, título com número que não é de nó. `calcular` só soma/diferença em centavos inteiros,
  com origem `calculo` e cada parte com a própria origem.
- **Máscara** (`mascara.js`): `⟦P<n>⟧` estável por sessão; nome completo e "primeiro + último" em texto
  livre; CPF com e sem pontuação e e-mail saem de todo texto; dicionário de bolsistas carregado uma vez
  por sessão na primeira ferramenta com texto livre; `reidratar` só troca marcadores em blocos.
- **Texto** (`texto.js`): `marcarTexto` reconhece moeda (`R$ 1.234,56`), `1.234`, `12,5%`, datas
  `dd/mm/aaaa` e `mmm/aa` (e também ISO, como defesa), ignora código de centro (`30.109`/`78.116`) e
  código de conta (`7.1.3.99`), e marca o que não é valor de nó citado em bloco ou `calcular`.
- **Testes e dados sintéticos**: `tests/ai-tools-v2/*.test.js` e `tests/fixtures/ai-tools-v2/*.json`,
  montados a partir dos formatos de `dadosExemplo.js`, com nomes "Pessoa Exemplo …" e centros `30.9xx`;
  nenhum dado real. `package.json` só acrescentou `shared/` ao script `lint`.

## 2. Formato real de cada RPC (o que o pacote consome)

Conferido nas migrações `063`–`070`, nos validadores de `app/src/servicos/dados.js` e nos exemplos
sintéticos de `dadosExemplo.js`. As chaves abaixo são as que o pacote lê; chaves extras são ignoradas.

| RPC | Retorno usado | Origem que o pacote escolhe |
|---|---|---|
| `resumo_projetos_v2()` | `{ centros: [{ id, code, name, end_date, drive_folder_url, livre, situacao, data_referencia, pendencias_abertas, erro, responsaveis, motivos: [{ codigo, nivel, texto, grupo_code, valor, tarifa? }] }], ocultos, todos }` (069, linhas 464–509) | `livre` → `{ tipo: 'livre', project_id }`; vigência, situação, contagens e motivos → `sem_documento` |
| `explicar_livre_v2(p_project_id)` | nó `{ rotulo, valor, tipo, chave, conta, sinal, ref, nota, partes: [nó] }`; `tipo` em `calculo/documento/legado/digitado`; `motivo` na raiz sem plano/balancete/números (070, linhas 856–859) | cada nó da árvore → `{ tipo: 'no', no: <nó com partes> }`; acima de 200 nós → **todo nó** `{ tipo: 'livre', project_id, chave, caminho }` (nunca `ref` direto) |
| `situacao_centro_v2(p_project_id)` | `{ situacao, motivos: [{ codigo, nivel, texto, grupo_code, valor, tarifa? }] }` (069, linha 564) | `valor` (déficit) e `tarifa` → `sem_documento` (a RPC não devolve as linhas da tarifa); saldo do grupo ligado por `grupo_code` → `no`; texto/nível → `sem_documento` |
| `get_repasses_v2(p_project_id)` | `{ parcelas: [{ parcela, data_prevista, data_texto, valor, valor_texto }], valor_total_plano, data_balancete, recursos: { recebido, a_receber } \| null }` (063, linhas 842–847) | hoje a RPC não traz `ref`: `sem_documento`; se uma linha trouxer `ref` completa, vira `ref` |
| `get_termos_contrato_v2(p_project_id)` | `{ termos: { <termo>: { id, valor, regra, trecho, documento_nome, documento_url, documento_id, documento, pagina, nota, origem, autor, criado_em, conferido, conferido_em, versoes_anteriores } }, start_date_cadastro, end_date_cadastro, vigencia_situacao, vigencia_confere }` (067, linhas 397–411) | cada termo → `{ tipo: 'termo', project_id, termo_id }`; datas do cadastro e `vigencia_situacao` → `sem_documento` |
| `listar_pendencias_v2(p_project_id default null)` | lista de `{ id, project_id, code, tipo, titulo, detalhe, situacao, origem, criada_em }` (063, linhas 433–476) | tudo → `sem_documento` (pendência); número de `detalhe` com chave de valor vira `moeda`, o resto `numero` |
| `get_pedido_bolsas_v2()` | `{ centros: [{ id, code, name }], bolsistas: [{ holder_id, nome, equipe, valor_vigente, bolsas: [{ scholarship_id, project_id, code, valor, inicio, fim, status, vigente_hoje }] }], caixas: [{ id, nome, meses, criado_em, pessoas, total_mensal, total_periodo, itens_ocultos, itens: [{ holder_id, valor_mensal, valor_usado, nota }] }] }` (068, linhas 503–551) | nome → `⟦Pn⟧`; valores → `sem_documento`; o filtro de visão de `listar_centros` vale também sem `project_id`; com centro filtrado, as bolsas do centro ficam separadas do total global; `itens_ocultos` é preservado |
| `get_origem_v2(p_alvo_tabela, p_alvo_id, p_campo)` | `{ tipo: 'documento' \| 'legado' \| 'digitado', valor, documento, fato, busca, nota }` (064/065) | **não é chamada pelo pacote**: a origem `ref` abre `get_origem_v2(ref)` → `Documento`; a origem `livre` primeiro chama `explicar_livre_v2(project_id)` e abre o `DeOndeVem`, e só a folha com `ref` chama `get_origem_v2` |

Notas de formato:

- `get_repasses_v2` não devolve `ref` nas parcelas hoje; o ramo `ref` foi implementado e testado com um
  fixture sintético que o acrescenta, para o dia em que a RPC passar a devolver.
- `get_termos_contrato_v2` devolve `valor` como data ISO (string) ou número (percentual); o pacote
  também aceita número em string, tratando `taxa_*`/regra com `%` como `percentual`.
- `resumo_projetos_v2` não traz termos do contrato; por isso a vigência de `listar_centros` sai como
  `sem_documento` e não como `termo` (o contrato permite "sem_documento **ou** termo quando houver").
- `get_pedido_bolsas_v2` não aceita `project_id`; o filtro por centro de `bolsas` é feito no adaptador,
  sobre as bolsas que a RPC devolveu, e `valor_vigente` permanece o total de todos os centros (o rótulo
  diz isso). Nada é recalculado.

## 3. Testes

- `npm run lint`: **0 erros e 0 avisos** em `frontend/js/`, `mcp/`, `app/` e `shared/`.
- `npm test` na raiz: **51 arquivos passando + 1 ignorado (52)**, **814 testes passando + 19 ignorados**
  (**833 no total**), incluindo os testes antigos.
- Suíte nova `tests/ai-tools-v2`: **7 arquivos, 122 testes passando na versão final (82/106/114 nas rodadas anteriores)**:
  - `sessao.test.js` (14): ids sequenciais, erro de RPC/exceção/formato, centro por código/id, centro
    oculto/inexistente com o mesmo "não encontrado no seu acesso", cache da lista e concorrência.
  - `ferramentas.test.js` (41): caminho feliz e origem por tipo em cada ferramenta, árvore >200 nós
    com `caminho`, motivo real de déficit/tarifa, `motivos_falharam`, lista vazia honesta, item nulo,
    erro de RPC em cada uma e argumento inválido.
  - `blocos.test.js` (17): número/tabela/texto, id inexistente, célula literal, unidades misturadas,
    51 linhas, 9 colunas, 50 linhas/8 colunas, título e cabeçalho com número, contextos, célula de
    texto da RPC e id de bloco não consumido em recusa.
  - `calcular.test.js` (15): `0,1 + 0,2` exatamente `0,3`, diferença, sinais, origem `calculo` fechando
    ao centavo, unidade `numero`, escala de `numero`, moeda com 3 casas, unidades diferentes,
    percentual, id inexistente, `op` inválida, BigInt, faixa segura e string decimal.
  - `mascara.test.js` (17): nome completo, primeiro + último, CPF com espaço/ponto/hífen/barra,
    e-mail, `reidratar` só no bloco, varredura de **todos** os `paraModelo`, dicionário uma vez por
    sessão, falha fechada, erro externo sem PII, rótulo de bolsa com ` — `/sem sufixo e normalização
    Unicode/acentos.
  - `texto.test.js` (13): número citado × inventado, código de centro/conta, `R$ 30.109` × `30.109`,
    milhar sem ponto, datas completas, unidade/sinal, moeda negativa, sinal `-`/`−`, resultado de
    `calcular` e `reidratar`.
  - `instrucoes.test.js` (5): quatro regras idênticas às do MCP (fonte lida como texto), regras da
    Análise e formato/descrição das nove especificações.

## 4. Mutantes (cada um aplicado, testado e revertido)

| Mutante | Onde foi aplicado | Teste que pegou | Resultado observado |
|---|---|---|---|
| Tirar a máscara do nome | `mascara.js`, desligando a troca de nomes em `texto` | `mascara.test.js` | 3 falhas: nome completo, marcadores estáveis e a varredura acusou `explicar_livre` vazando "Pessoa Exemplo Um" |
| Aceitar id inexistente | `nos.js`, `obter` devolvendo nó falso | `blocos.test.js` + `calcular.test.js` | 4 falhas: id inexistente, célula literal, id de bloco e cálculo com id inexistente |
| Erro da RPC virar `[]` | `index.js`, `resultado.erro` devolvendo `paraModelo: '[]'` | `sessao.test.js` + `ferramentas.test.js` | 19 falhas, inclusive "erro da RPC volta como `{ id, erro }`" e os 7 erros por ferramenta |
| `calcular` em ponto flutuante | `blocos.js`, somando `valor` sem centavos | `calcular.test.js` | 3 falhas: `0.30000000000000004`, `9.700000000000001` e origem sem fechar |
| `sem_documento` no lugar de `no` | `comum.js`, `origemNo` devolvendo `sem_documento` | `ferramentas.test.js` | 2 falhas: árvore do livre e motivo que casa com a árvore |

Depois de cada reversão, `tests/ai-tools-v2` voltou a **82/82**.

## 5. Desvios, decisões e o que ficou de fora

Decisões dentro do contrato:

- **`situacao_centro` faz uma leitura extra** de `explicar_livre_v2` (cacheada por centro na sessão)
  para saber se o valor do motivo casa com a árvore. Se a árvore falhar, o motivo continua com
  `sem_documento`; a situação não é derrubada por causa do clique.
- **`listar_centros` usa `sem_documento` na vigência**, porque `resumo_projetos_v2` não carrega termo.
- **`bolsas` filtra por centro no adaptador** e mantém `valor_vigente` como total de todos os centros,
  com rótulo explícito. A RPC não tem parâmetro de centro; inventar uma soma filtrada seria regra de
  negócio no pacote.
- **Dicionário de nomes falha fechado**: se `get_pedido_bolsas_v2` falhar, ferramentas com texto livre
  devolvem erro em vez de arriscar nome de bolsista no `paraModelo`. CPF/e-mail continuam saindo.
- **`desembolsos` aceita `ref` opcional** na parcela, embora a `get_repasses_v2` de hoje não devolva.
- **`calcular` exige ao menos 2 ids para `diferenca`**; `soma` aceita 1. `sinais` é opcional e, quando
  enviado, vale para `soma` e `diferenca`.
- **`marcarTexto` reconhece também data ISO e moeda negativa** (`R$ −4.250,00`), além dos formatos
  pedidos; código de conta (`7.1.3.99`) também não é número.
- **`pendencias` mascara também as chaves de `detalhe`** antes de montar o `paraModelo`.
- **`executar` também roteia `criar_bloco` e `calcular`** (devolvendo o formato próprio de cada um),
  além dos métodos diretos `sessao.criarBloco`/`sessao.calcular` do contrato.
- **`hoje` é aceito e guardado na sessão**, mas as ferramentas não o usam: `vigente_hoje` e as regras de
  data já vêm calculados pelas RPCs.

Fora do escopo desta tarefa (e não feitos):

- Worker, SSE, JWT, tetos e limite diário (executor B, `worker/`).
- Tela da Análise, origem clicável e blocos na UI (Etapa 2).
- Migração `071`/projeção de bolsas, análises salvas e exportação (Etapas 2–4).
- Chamada real a qualquer RPC, navegador ou produção. Tudo foi testado com `rpc` falso e fixtures.
- Itens de caixa com `holder_id`: o `paraModelo` de `bolsas` traz só os totais da caixa; ids de pessoa
  não são necessários ao modelo e ficam fora.

## 6. O que ficou em aberto

- **Integração com o Worker**: o contrato de `executar`/`criarBloco`/`calcular` está pronto, mas o laço
  real do Worker (DeepSeek/Ollama, SSE, tetos) é do outro executor e não foi exercitado aqui.
- **Bateria de 3 perguntas** da Etapa 1 e as 20 da Etapa 2 não rodaram; exigem Worker, login e produção
  (proibidos nesta tarefa).
- **`bolsas` filtrado por centro**: se o Worker passar a querer `valor_vigente` só do centro, será
  preciso parâmetro novo na RPC 068 (ou uma soma explícita, que hoje seria regra de negócio no pacote).
- **Dicionário de nomes**: em produção a Análise é admin-only, então `get_pedido_bolsas_v2` deve
  responder; se um dia a Análise atender professor/agente, a dependência do dicionário precisa ser
  revista (o agente é barrado na 068).
- **`marcarTexto` é estrito**: anos e contagens soltas também são marcados se não forem valor de nó.
  É o comportamento pedido ("número inventado marca"), mas pode render marcação em texto prolixo; o
  teste fixa o comportamento.
- **Origem `no` duplica a subárvore** dentro do bloco (contrato §3); o teto de 200 nós evita o caso
  patológico, mas um bloco que cite a raiz de uma árvore grande carrega bastante JSON. A tela/Worker
  devem tratar o tamanho no evento `bloco`.
- **`situacao_centro` sem árvore** perde o clique para o documento naquele valor (fica `sem_documento`);
  é a recusa honesta possível quando `explicar_livre_v2` falha.

## 7. Arquivos

- `shared/ai-tools/index.js`, `nos.js`, `blocos.js`, `mascara.js`, `texto.js`, `cpf.js`, `erros.js`, `README.md`, `package.json`
- `shared/ai-tools/ferramentas/` (9 ferramentas + `comum.js` + `index.js`)
- `tests/ai-tools-v2/` (7 arquivos, 122 testes na versão final; 82/106/114 nas anteriores)
- `tests/fixtures/ai-tools-v2/` (8 JSON sintéticos)
- `package.json` (só `shared/` no `lint`)
- este relatório

## 2ª rodada (25/11/2026) — revisão do GPT-6.2 Sol medium

Os 12 achados da revisão foram aceitos e corrigidos. Esta seção é o retrato da rodada; a
contagem final é **7 arquivos, 106 testes** em `tests/ai-tools-v2` e **798 testes passando +
19 ignorados (817)** na raiz. `npm run lint`: 0 erros e 0 avisos.

### O que mudou

1. **Dados pessoais.** `cpf.js` implementa a mesma regra de `_tem_cpf`/`_mascarar_cpf` da
   065 (3-3-3-2, vãos de 0 a 6 sem dígito/letra, DV da 052): CPF com espaço, ponto, hífen
   ou barra é mascarado. Folha da árvore com `ref.alvo_tabela = 'scholarships'` troca o
   nome por `⟦Pn⟧` no rótulo do modelo, estável pelo `alvo_id` e sem depender do
   dicionário; o nó original com o nome só vai na `origem`. `pendencias` só aceita uma
   lista fechada de chaves de `detalhe` (`conta`, `competencia`, `descricao`, `documento`,
   `rubrica`, `diferenca`, `quantidade`, `referencia`, `escopo`, `observacao`, `valor`,
   `tarifa`); chave com nome/cpf/e-mail/pessoa/bolsista e número de 11 dígitos são
   descartados.
2. **Erro de RPC.** `chamarRpc` devolve mensagem fixa por consulta + código
   (`http_4xx`, `tempo` ou `formato`); o texto bruto do banco nunca sai do pacote. O
   `catch` de `executar` só preserva mensagens com `codigo` definido pelo próprio pacote;
   qualquer outra exceção vira erro genérico de formato. A varredura de PII cobre os
   caminhos de erro e uma sessão que começa por `termos_contrato`, não por `listar_centros`.
3. **Falha nunca vira sucesso.** `situacao: 'sem dado'` com motivo `falha` é erro explícito;
   `centro.erro` em `listar_centros` cria `falhou: true` e o nó "consulta falhou", sem
   livre; item `null`/inválido em lista e nó inválido na árvore são erro de formato, não
   lista vazia. A árvore é validada inteira antes de registrar qualquer nó.
4. **Motivos.** `situacao_centro` preserva `valor` (magnitude do déficit), `tarifa` e o
   saldo assinado do grupo como campos distintos. O saldo é ligado à árvore por
   `grupo_code` (não por igualdade de valor) e recebe origem `no`; déficit e tarifa ficam
   `sem_documento` com o motivo literal. `listar_centros` também expõe `valor` e `tarifa`
   separados.
5. **Números no texto.** Cabeçalho de coluna com número inventado é recusado como o
   título; `R$ 30.109` é moeda (código de centro só sem `R$`); data completa compara dia,
   mês e ano; a comparação respeita unidade e sinal (moeda só com moeda, número só com
   número, percentual só com percentual).
6. **Clique na árvore grande.** Acima de 200 nós, a origem `livre` leva também `chave`; a
   3ª rodada corrigiu a decisão: **todo nó** sai `livre` com `chave`, nunca `ref` direto,
   porque a folha de bolsa (amount × meses) difere do campo `amount` referenciado. O
   `contexto` do bloco número leva a origem do nó de contexto.
7. **`calcular` exato.** Moeda com mais de 2 casas é recusada; `numero` usa aritmética
   inteira escalada pelo maior número de casas; as partes registradas são as mesmas que
   fecharam o total.
8. **Bolsas.** O filtro de visão de `listar_centros` vale também na chamada sem
   `project_id`. Com centro filtrado, as bolsas do centro ficam em `bolsas` e o total
   global da pessoa fica em `total_global`, com rótulo próprio; `valor_vigente` não é
   reapresentado como se fosse do centro. `itens_ocultos` das caixas é preservado. Nenhuma
   soma nova no pacote.
9. **Concorrência.** Cada execução tem um escopo próprio; os nós só são publicados
   depois de o resultado inteiro ser validado. `Promise.all` não mistura `r1.*` com
   `r2.*`, e resultado com erro não deixa nó citável.
10. **`reidratar`.** O texto e os intervalos `semOrigem` são recalculados juntos; o realce
    de `⟦P1⟧ deve 500` continua em `500` depois da troca pelo nome.
11. **Node direto.** `shared/ai-tools/package.json` declara `{ "type": "module",
    "private": true }`. O comando `node -e "import('./shared/ai-tools/index.js')"` rodou
    no Node nativo e devolveu `ok function function true` (exporta `criarSessao`,
    `especificacoes` e `INSTRUCOES`).
12. **Desembolso.** O fixture padrão voltou a ser fiel à 063 (sem `ref`), e o teste prova
    `sem_documento` nas duas parcelas. Um segundo fixture (`repasses_ref.json`) tem a
    referência completa no formato que `get_origem_v2` recebe; o teste confere
    `alvo_tabela`, `alvo_id`, `campo` e o nome da parcela.

### Contrato §3/§6

O pacote passa a produzir três campos que o contrato ainda não listava; o Claude atualiza
o contrato:

- §3, origem `livre` de árvore acima de 200 nós: `{ tipo: 'livre', project_id, chave, caminho }`.
- §3, folha de árvore acima de 200 nós: **sempre** `{ tipo: 'livre', project_id, chave, caminho }`,
  nunca `ref` direto (a 3ª rodada corrigiu a proposta anterior; o valor da folha é
  amount × meses, não o `amount` do campo referenciado). O `caminho` (índices das partes
  desde a raiz) distingue folhas com a mesma `chave`.
- §6, `numero.contexto`: `{ valor, unidade, origem }` (antes só valor e unidade).
- Em `situacao_centro`, o `paraModelo` expõe `valor` (déficit), `saldo` (grupo, com origem
  `no`) e `tarifa` (sempre `sem_documento` até a RPC devolver as linhas); em
  `listar_centros`, `motivos_falharam`/`falha_motivos`; em `bolsas`, `total_global`
  (centro filtrado), `aviso` (total com centro oculto vigente) e `itens_ocultos`.

### Mutantes desta rodada (aplicados, testados e revertidos)

| Item | Mutante | Teste que pegou | Falha observada |
|---|---|---|---|
| 1 | Rótulo de folha de bolsa sem `⟦Pn⟧` quando o dicionário está vazio | `mascara.test.js` — “mascara o nome pelo alvo_id mesmo com dicionário vazio” | `paraModelo` continha “Pessoa Exemplo Um” |
| 1 | `detalhe` aceitando chave desconhecida | `ferramentas.test.js` — “descarta detalhe sensível/desconhecido” | `paraModelo` vazava “Pessoa Exemplo Fora” |
| 2 | Erro de RPC devolvendo `error.message` cru | `mascara.test.js` — “erro de RPC não leva PII ao modelo” | erro veio “Falha: … Pessoa Exemplo Um, CPF …” |
| 3 | `situacao: 'sem dado'` com `falha` virando sucesso | `ferramentas.test.js` — “situação sem dado … erro explícito” | `erro` veio `undefined` |
| 3 | `centro.erro` ignorado em `listar_centros` | `ferramentas.test.js` — “centro com erro … falhou” | `falhou` veio `false` |
| 4 | `tarifa` do motivo omitida | `ferramentas.test.js` — “motivo real de déficit e tarifa” | nó “Tarifa bancária” não existia |
| 5 | Cabeçalho de coluna não validado | `blocos.test.js` — “recusa cabeçalho …” | bloco aceitou “Total R$ 500,00” sem nó |
| 5 | Código de centro sempre proibido, mesmo com `R$` | `texto.test.js` — “R$ 30.109 é moeda …” | `semOrigem` marcou `[20,22]` em valor citado |
| 5 | Data completa comparada só por mês/ano | `texto.test.js` — “data completa compara dia, mês e ano” | `15/12/2025` não foi marcado |
| 5 | Moeda comparada por valor absoluto | `texto.test.js` — “comparação de moeda respeita unidade e sinal” | `R$ 50,00` virou “citado” pelo nó `−50` |
| 5 | Moeda comparada com número | `texto.test.js` — “comparação de moeda respeita unidade e sinal” | `R$ 3,00` virou “citado” pelo nó número `3` |
| 6 | Origem `livre` de árvore grande sem `chave` | `ferramentas.test.js` — “acima de 200 nós … chave e ref” | `origem.chave` veio `undefined` |
| 6 | `contexto` sem origem | `blocos.test.js` / `ferramentas.test.js` | `contexto.origem` veio `undefined` |
| 7 | `numero` arredondado em centavos | `calcular.test.js` — “numero usa a maior escala …” | total veio `2`, não `2.01` |
| 8 | Sem filtro de visão em `bolsas` | `ferramentas.test.js` — “filtro de visão vale também sem project_id” | bolsista veio com 2 bolsas, incluindo `30.904` |
| 8 | `itens_ocultos` omitido | `ferramentas.test.js` — “filtro de visão …” | nó de `itens_ocultos` veio `undefined` |
| 8 | Total global exposto como `valor_vigente` no filtro | `ferramentas.test.js` — “com centro filtrado …” | `valor_vigente` veio `r1.2`, não `null` |
| 9 | `registrar` usando id global em vez do escopo | `sessao.test.js` — “Promise.all não mistura …” | nó de `r1` veio com prefixo `r2` |
| 10 | `reidratar` sem recalcular intervalos | `texto.test.js` — “reidratar recalcula …” | trecho destacado virou “mplo Um d” |
| 11 | `package.json` do pacote em `commonjs` | `node -e "import('./shared/ai-tools/index.js')"` | `SyntaxError: Cannot use import statement outside a module` |
| 12 | `desembolsos` sempre `sem_documento` | `ferramentas.test.js` — “com ref completa …” | origem veio `sem_documento`, não `ref` |

Cada mutante foi revertido; na rodada final a suíte nova voltou a **106/106** e a raiz
fechou em **798 passando + 19 ignorados**.

## 3ª rodada (25/11/2026) — revisão do GPT-6.2 Sol medium

Os 8 achados da 2ª rodada foram aceitos com as decisões do Claude. Esta rodada fecha a
Etapa 1: **7 arquivos, 114 testes** em `tests/ai-tools-v2` e **806 testes passando + 19
ignorados (825)** na raiz. `npm run lint`: 0 erros e 0 avisos. O import direto no Node
segue funcionando (`node -e "import('./shared/ai-tools/index.js')"`: `ok function 9`).

### O que mudou

1. **PII em texto.** Em `pendencias`, `detalhe` agora só expõe os **números** da lista
   fechada; `conta`, `competencia`, `descricao`, `observacao` e qualquer outro texto não
   viram nó nem entram no `paraModelo`. O `titulo` continua passando pela máscara do
   dicionário. Limite conhecido, registrado de novo: nome fora do dicionário não é pego
   em `titulo`/texto livre. Na árvore, o rótulo da folha de bolsa é reconstruído pelo
   sufixo no fim (`— N mês/meses × R$ X`); tudo o que vem antes vira `⟦Pn⟧`. Se o sufixo
   não casar, o modelo vê só `⟦Pn⟧`. Um nome que contenha ` — ` não vaza mais.
2. **Dicionário.** `garantirDicionario` transforma erro ou rejeição do adaptador na
   mensagem fixa “Não foi possível carregar a lista de pessoas para proteger os nomes.”,
   com código `http_4xx` ou `formato`. O `catch` de `executar` só aceita erros marcados
   pelo próprio pacote (`erros.js`, símbolo privado) e códigos da lista fechada; um erro
   externo com `codigo` e `mensagemFixa` forjados não passa.
3. **Árvore acima de 200 nós.** Todo nó sai `{ tipo: 'livre', project_id, chave }`,
   inclusive folhas com `ref`. Nunca `ref` direto: o valor da folha (amount × meses) não é
   o `amount` do campo referenciado. O contrato §3 foi ajustado no relatório.
4. **`marcarTexto`.** O sinal `-`/`−` entra no candidato e na comparação (`-5`, `−5`,
   `-7%`); código de centro só é dispensado fora de cabeçalho. Cabeçalho de coluna com
   **qualquer** dígito é recusado, mesmo `30.901`. Célula de texto que reproduz o motivo
   vindo da RPC fica como está (decisão: o texto é da RPC), com origem `sem_documento`.
5. **`listar_centros`.** Motivo `falha` da 069 marca `motivos_falharam: true` e cria o nó
   “motivos falharam”; `livre` e `situação` válidos continuam disponíveis.
6. **Tarifa.** A 3ª rodada tentou ligar a tarifa à linha da árvore; a 4ª rodada
   removeu essa lógica: a tarifa sai sempre `sem_documento` com o motivo “tarifa
   bancária: a RPC não devolve as linhas”. Total do plano fica `sem_documento` nesta
   etapa: a 063 não devolve o id do plano ativo; vira ferramenta nova na Etapa 2.
7. **Bolsas.** Se a pessoa tem qualquer bolsa em centro fora da visão, `valor_vigente` e
   `total_global` ficam `null`, com nó de aviso “inclui centros fora da sua visão; veja as
   bolsas uma a uma”; as bolsas visíveis continuam uma a uma. Caixas que incluam pessoa
   nessa condição também têm `total_mensal`/`total_periodo` `null` e o mesmo aviso;
   `itens_ocultos` é preservado.
8. **`calcular`.** Toda a aritmética é BigInt, inclusive os intermediários; cada parcela e
   o resultado final são conferidos contra a faixa segura. `9007199254740991 + 2 −
   9007199254740991` devolve `2`; resultado fora da faixa segura é erro.

Itens 9 (concorrência), 10 (`reidratar`) e 11 (import ESM) foram revalidados sem mudança
nesta rodada.

### Mutantes desta rodada (aplicados, testados e revertidos)

| Item | Mutante | Teste que pegou | Falha observada |
|---|---|---|---|
| 1 | Voltar a aceitar texto de `detalhe` | `ferramentas.test.js` — “descarta detalhe sensível/desconhecido” | `detalhe` ganhou `descricao` |
| 1 | Rótulo de bolsa dividido no primeiro ` — ` | `mascara.test.js` — “reconstrói o rótulo pelo sufixo” | `paraModelo` vazou “Exemplo Um” |
| 2 | `catch` aceitando erro externo com `codigo`/`mensagemFixa` | `mascara.test.js` — “rejeição externa do dicionário” | erro veio “Nome Sintético Fora (http_4xx)” |
| 3 | Restaurar `ref` direto em árvore grande | `ferramentas.test.js` — “acima de 200 nós … nunca ref” | folha saiu `ref`, não `livre` com `chave` |
| 4 | Tirar o sinal do candidato de número | `texto.test.js` — “sinal negativo entra no candidato” | `-3` não foi marcado |
| 4 | Cabeçalho validado como título (código dispensado) | `blocos.test.js` — “cabeçalho … qualquer dígito” | `30.901` foi aceito no cabeçalho |
| 5 | Ignorar motivo `falha` | `ferramentas.test.js` — “motivo falha marca motivos_falharam” | `motivos_falharam` veio `false` |
| 6 | Tarifa sempre `sem_documento` | `ferramentas.test.js` — “motivo real de déficit e tarifa” | tarifa não abriu o nó da linha |
| 7 | Ignorar bolsa em centro oculto | `ferramentas.test.js` — “filtro de visão … total com centro oculto” | `valor_vigente` veio `r1.2`, não `null` |
| 7 | Ignorar pessoa com bolsa oculta no total da caixa | `ferramentas.test.js` — “filtro de visão …” | `total_mensal` deixou de ser `null` |
| 8 | Somar intermediário em `Number` | `calcular.test.js` — “BigInt mantém o intermediário” | resultado veio `1`, não `2` |

Cada mutante foi revertido; a suíte nova fechou em **114/114** e a raiz em **806 passando
+ 19 ignorados**.

### Contrato §3/§6 — correção da 2ª rodada

A 2ª rodada propôs `ref` direto para folha grande; a 3ª rodada corrige: **todo nó de
árvore acima de 200 é `{ tipo: 'livre', project_id, chave }`**, sem `ref`. Permanecem da
2ª rodada: `numero.contexto.origem`; `situacao_centro` com `valor`/`saldo`/`tarifa`;
`listar_centros` com `motivos_falharam`/`falha_motivos`; `bolsas` com `total_global`,
`aviso` e `itens_ocultos`. O total do plano segue `sem_documento` até a ferramenta da
Etapa 2.

## 4ª rodada (25/11/2026) — última rodada curta

Os 6 achados da conferência da 3ª rodada foram corrigidos. **7 arquivos, 122 testes** em
`tests/ai-tools-v2`; **814 testes passando + 19 ignorados (833)** na raiz. `npm run lint`:
0 erros e 0 avisos. Node direto segue: `node -e "import('./shared/ai-tools/index.js')"` →
`ok function 9`.

### O que mudou

1. **Máscara normalizada.** Dicionário e texto passam pela mesma normalização antes da
   busca: NFC, espaços Unicode (NBSP, tab, etc.) viram um espaço, espaços repetidos viram
   um, e a comparação ignora maiúsculas e acentos. A troca usa o mapa de posições e
   substitui o trecho **original** (inclusive com NBSP/tab) por `⟦Pn⟧`. Teste cobre NBSP,
   tab, dois espaços, maiúsculas e acentos nos dois sentidos.
2. **Caminho na árvore grande.** Cada origem `livre` leva `chave` e `caminho` (índices das
   partes desde a raiz). Duas folhas com a mesma `chave` (`linha:<id>` na 070) saem com
   caminhos diferentes.
3. **Tarifa.** O pacote não tenta mais casar rótulo/valor da linha. A tarifa sai sempre
   `sem_documento` com o motivo “tarifa bancária: a RPC não devolve as linhas”; a lógica
   de classificação pertence à RPC. O total do plano segue `sem_documento` (a 063 não
   devolve o id do plano ativo; ferramenta nova na Etapa 2).
4. **Números.** A exceção de código de centro vale só para `30.xxx`/`78.xxx` sem sinal e
   sem `R$`; `-30.109` é número (e título com ele sem nó é recusado). Moeda aceita milhar
   sem ponto (`R$ 1200`, `R$ 1200,50`) como um único candidato, sem dividir em `R$ 120` +
   `0`.
5. **Bolsas.** Só bolsa **vigente** (`vigente_hoje`) em centro oculto suprime o total da
   pessoa; bolsa antiga não. Caixa só tem os totais suprimidos se algum item usa o valor
   vigente (`valor_mensal` nulo) de pessoa nessa condição; item com valor mensal digitado
   não suprime.
6. **`calcular`.** A conversão para centavos usa a string decimal (`String(n)`, com
   tratamento de notação exponencial), nunca `toFixed`. `90071992547409,90 −
   90071992547409,00` devolve `0,90`, e os intermediários continuam em BigInt.

### Mutantes desta rodada (aplicados, testados e revertidos)

| Item | Mutante | Teste que pegou | Falha observada |
|---|---|---|---|
| 1 | Máscara voltando à busca exata (sem normalizar texto) | `mascara.test.js` — “normaliza NBSP, tab, dois espaços…” | “PESSOA NBSP EXEMPLO TAB UM” não foi mascarado |
| 2 | Origem `livre` sem `caminho` | `ferramentas.test.js` — “duas folhas com a mesma chave…” | `caminho` veio `undefined` |
| 3 | Tarifa apontando para o grupo (`origem no`) | `ferramentas.test.js` — “motivo real de déficit e tarifa” | tarifa veio `no`, não `sem_documento` |
| 4 | Exceção de código de centro aceitando sinal | `blocos.test.js` — “código de centro com sinal no título” | `Desconto -30.109` foi aceito |
| 4 | Moeda voltando a `\d{1,3}` | `texto.test.js` — “milhar sem ponto em moeda” | `R$ 1200` não foi marcado |
| 5 | Qualquer bolsa oculta suprime o total | `ferramentas.test.js` — “bolsa antiga em centro oculto…” | total veio `null` |
| 5 | Qualquer item de caixa com bolsa oculta suprime | `ferramentas.test.js` — “item de caixa com valor mensal digitado…” | totais vieram `null` |
| 6 | Conversão por `toFixed` | `calcular.test.js` — “converte pela string decimal” | resultado veio `0,91`, não `0,90` |

Cada mutante foi revertido; a suíte nova fechou em **122/122** e a raiz em **814 passando
+ 19 ignorados**.

### Contrato §3/§6 — 4ª rodada

- §3, `livre` acima de 200 nós: `{ tipo: 'livre', project_id, chave, caminho }`.
- §3, tarifa: sempre `sem_documento` até a RPC devolver as linhas; o pacote não replica a
  classificação da 069. Total do plano segue `sem_documento`.
- Permanecem: `numero.contexto.origem`, `motivos_falharam`/`falha_motivos`, `bolsas` com
  `total_global`/`aviso`/`itens_ocultos` e a regra de bolsa vigente em centro oculto.

## Ajuste do Claude depois da conferência final da 4ª rodada (25/11/2026)

O GPT-6.2 Sol (medium) conferiu `3f609a1` e achou 2 itens altos, 1 médio e 1 baixo. O Claude conferiu cada
um no código e corrigiu os quatro, cada um com teste que falha sem a correção (a versão anterior do arquivo foi
reposta, o teste foi visto falhar, e a correção voltou).

| Achado | Correção | Teste |
|---|---|---|
| Alto: emoji ou acento decomposto antes do nome deslocava o corte da máscara e deixava o nome (ou parte dele) ir ao modelo | `normalizarComparavel` mapeia cada **unidade UTF-16** do texto comparável e devolve `fonte` (o texto em NFC); a troca corta `fonte`. Bordas por `\p{L}\p{N}` | `mascara.test.js`: emoji (inclusive ZWJ) e `e` + U+0301 antes do nome |
| Alto: `-R$ 1200` aceito com nó de +R$ 1.200; `30.109,50` passava como código de centro | o sinal **colado** antes de `R$` entra no valor (`-R$ -x` volta positivo); com espaço (`R$ 1.200 - R$ 300`) é subtração e não gruda. Código de centro só sem `,`/`.` e dígito em volta | `texto.test.js`: os três casos e o código de centro sozinho |
| Médio: `Joao Exemplo` e `João Exemplo` recebiam o mesmo ⟦Pn⟧ e a reidratação trocava a pessoa | identidade pela chave **com acento** (`chaveExataDoNome`); a busca faz duas passadas, primeiro com acento e depois sem | `mascara.test.js`: duas fichas e reidratação correta |
| Baixo: `R$ 90.071.992.547.409,00 + R$ 0,87` publicava `,88` | `calcular` só publica valor (total e partes) que volta igual em centavos; senão, "fora da faixa exata" | `calcular.test.js` |

Limite que fica: um texto que escreve sem acento o nome de quem tem acento, quando existe outra pessoa com o
mesmo nome sem acento, cai na ficha da segunda. O nome continua mascarado; só a ficha pode ser a errada.

Pacote: 129 testes. Raiz: 821 passando, lint limpo.

### Segunda conferência curta do Sol (sobre `dffea1f`)

Achou 3 altos criados pelas próprias correções; os três conferidos e corrigidos, com teste que falha sem a correção:

- **Duas passadas na máscara** deixavam `Joao` exposto em `Joao Pedro Silva` quando `Pedro Silva` (outra pessoa)
  casava na passada com acento. Agora é **uma passada**: os trechos dos dois modos concorrem juntos, ganha o mais
  longo e, no mesmo trecho, o com acento.
- **Sinal e moeda**: a guarda "sem letra antes" impedia `Desconto-R$ 1200` de levar o sinal e `TotalR$ 1200` de ser
  lido como moeda. Agora o sinal colado conta sempre que não vem depois de dígito (`1200-R$ 300` é subtração) e
  `R$` é moeda com qualquer coisa antes.

Pacote: 131 testes.

### Terceira conferência curta do Sol (sobre `e8e38ed`)

Dois altos, ambos conferidos e corrigidos com teste que falha sem a correção:

- O `\p{L}` da borda do nome perdeu o escape na reescrita (`{Ana Paula}` passava inteiro). Voltou a `\p{L}` no
  template.
- "Ganha o mais longo" deixava `Maria` exposto quando `Ines Ana Paula` (outra pessoa) cruzava `Maria Inês` e
  `Ana Paula`. A escolha agora é a combinação sem sobreposição que **cobre mais texto** (agendamento ponderado de
  intervalos; no empate, com acento), e o que sobrar descoberto dentro de qualquer trecho achado também vira
  marcador (só espaço ou pontuação entre dois nomes não conta como sobra).

Pacote: 134 testes.
