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
| `explicar_livre_v2(p_project_id)` | nó `{ rotulo, valor, tipo, chave, conta, sinal, ref, nota, partes: [nó] }`; `tipo` em `calculo/documento/legado/digitado`; `motivo` na raiz sem plano/balancete/números (070, linhas 856–859) | cada nó da árvore → `{ tipo: 'no', no: <nó com partes> }`; acima de 200 nós → `livre` |
| `situacao_centro_v2(p_project_id)` | `{ situacao, motivos: [{ codigo, nivel, texto, grupo_code, valor }] }` (069, linha 564) | texto/nível → `sem_documento`; valor que casa com a árvore → `no`; sem árvore → `sem_documento` |
| `get_repasses_v2(p_project_id)` | `{ parcelas: [{ parcela, data_prevista, data_texto, valor, valor_texto }], valor_total_plano, data_balancete, recursos: { recebido, a_receber } \| null }` (063, linhas 842–847) | `ref` se a linha trouxer (defensivo); hoje a RPC não traz → `sem_documento` |
| `get_termos_contrato_v2(p_project_id)` | `{ termos: { <termo>: { id, valor, regra, trecho, documento_nome, documento_url, documento_id, documento, pagina, nota, origem, autor, criado_em, conferido, conferido_em, versoes_anteriores } }, start_date_cadastro, end_date_cadastro, vigencia_situacao, vigencia_confere }` (067, linhas 397–411) | cada termo → `{ tipo: 'termo', project_id, termo_id }`; datas do cadastro e `vigencia_situacao` → `sem_documento` |
| `listar_pendencias_v2(p_project_id default null)` | lista de `{ id, project_id, code, tipo, titulo, detalhe, situacao, origem, criada_em }` (063, linhas 433–476) | tudo → `sem_documento` (pendência); número de `detalhe` com chave de valor vira `moeda`, o resto `numero` |
| `get_pedido_bolsas_v2()` | `{ centros: [{ id, code, name }], bolsistas: [{ holder_id, nome, equipe, valor_vigente, bolsas: [{ scholarship_id, project_id, code, valor, inicio, fim, status, vigente_hoje }] }], caixas: [{ id, nome, meses, criado_em, pessoas, total_mensal, total_periodo, itens_ocultos, itens: [{ holder_id, valor_mensal, valor_usado, nota }] }] }` (068, linhas 503–551) | nome → `⟦Pn⟧`; valores → `sem_documento` ("bolsa digitada, ainda sem documento"); CPF/e-mail não são lidos |
| `get_origem_v2(p_alvo_tabela, p_alvo_id, p_campo)` | `{ tipo: 'documento' \| 'legado' \| 'digitado', valor, documento, fato, busca, nota }` (064/065) | **não é chamada pelo pacote**: é a RPC que a tela abre ao clicar na origem `ref`/`livre` |

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
- `npm test` na raiz: **51 arquivos passando + 1 ignorado (52)**, **774 testes passando + 19 ignorados**
  (**793 no total**), incluindo os testes antigos.
- Suíte nova `tests/ai-tools-v2`: **7 arquivos, 82 testes passando**:
  - `sessao.test.js` (12): ids sequenciais, erro de RPC/exceção/formato, centro por código/id, centro
    oculto/inexistente com o mesmo "não encontrado no seu acesso", cache da lista.
  - `ferramentas.test.js` (26): caminho feliz e origem por tipo em cada ferramenta, árvore >200 nós,
    motivo com e sem árvore, parcela com e sem `ref`, lista vazia honesta, erro de RPC em cada uma e
    argumento inválido.
  - `blocos.test.js` (14): número/tabela/texto, id inexistente, célula literal, unidades misturadas,
    51 linhas, 9 colunas, 50 linhas/8 colunas, título com número inventado, id de bloco não consumido em
    recusa.
  - `calcular.test.js` (10): `0,1 + 0,2` exatamente `0,3`, diferença, sinais, origem `calculo` fechando
    ao centavo, unidade `numero`, unidades diferentes, percentual, id inexistente, `op` inválida.
  - `mascara.test.js` (8): nome completo, primeiro + último, CPF com/sem pontuação, e-mail,
    `reidratar` só no bloco, varredura de **todos** os `paraModelo`, dicionário uma vez por sessão e
    falha fechada quando o dicionário não carrega.
  - `texto.test.js` (7): número citado × inventado, código de centro/conta, datas, percentual, moeda
    negativa e resultado de `calcular`.
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

- `shared/ai-tools/index.js`, `nos.js`, `blocos.js`, `mascara.js`, `texto.js`, `README.md`
- `shared/ai-tools/ferramentas/` (9 ferramentas + `comum.js` + `index.js`)
- `tests/ai-tools-v2/` (7 arquivos, 81 testes)
- `tests/fixtures/ai-tools-v2/` (7 JSON sintéticos)
- `package.json` (só `shared/` no `lint`)
- este relatório
