# Análise (F5) — contrato entre as partes

> Escrito pelo Claude em 25/11/2026, antes da Etapa 1. É a interface que o pacote de ferramentas
> (`shared/ai-tools/`), o Worker (`worker/`) e a tela (`app/`, Etapa 2) seguem. Mudança aqui só pelo Claude,
> no mesmo commit que muda o código das partes. O plano é [`analise-plano.md`](analise-plano.md).

## 1. Princípio

O modelo **nunca escreve número**. Toda ferramenta registra cada valor que devolve como um **nó** com id
curto (`r2.7`). O modelo monta blocos citando esses ids. Quem põe o valor no bloco é o código, a partir do
resultado real da RPC, e o bloco leva junto a **origem** do valor no mesmo formato que o site já usa, para
que o clique abra o mesmo "De onde vem" e o mesmo documento.

## 2. Nó

```js
// registrado pela sessão; o modelo vê só { id, valor, rotulo, unidade }
{
  id: 'r2.7',              // r<nº do resultado>.<nº do nó>; c<n> para resultado de `calcular`
  valor: 12345.67,         // número, string ISO (data) ou texto
  unidade: 'moeda' | 'data' | 'numero' | 'percentual' | 'texto',
  rotulo: 'Livre — Pessoal (30.109)',
  origem: Origem,          // §3; obrigatória em moeda/numero/percentual/data
}
```

Textos (código e nome de centro, rubrica, situação) também viram nó `unidade: 'texto'`, para a tabela não
precisar de literal. Nome de pessoa vira nó com o valor **mascarado** (`⟦P3⟧`); §5.

## 3. Origem (o clique)

Seis formas, todas já suportadas pelos componentes do `app/` ou montadas com eles:

| `tipo` | Campos | O que a tela abre (Etapa 2) | Quando usar |
|---|---|---|---|
| `no` | `no`: nó da árvore no formato de `explicar_livre_v2` (`{ rotulo, valor, tipo, ref, partes, sinal }`) | `DeOndeVem` com `arvore = no`; a folha chama `get_origem_v2` e abre o `Documento` na página e no trecho | todo valor que vem da árvore do livre (raiz, grupos, rubricas, compromissos, folha atrasada) |
| `livre` | `project_id`, `chave` e `caminho` (opcionais: a `chave` do nó a abrir e os índices das `partes` desde a raiz, ex. `[1, 0, 3]`; a `chave` sozinha não é única, porque a 070 repete `linha:<id>` no compromisso e na folha atrasada) | carrega `explicar_livre_v2(project_id)` e abre `DeOndeVem`, como o valor principal da página do projeto; com `chave`, abre e destaca aquele nó | livre de um centro vindo de `resumo_projetos_v2` (sem árvore no resultado), ou nó de árvore grande demais sem `ref` |
| `ref` | `ref: { alvo_tabela, alvo_id, campo }`, `nome` | `get_origem_v2(ref)` → `Documento`, como o saldo em conta e o rendimento (`itemOrigemDoBalancete`) | campo de documento com ref direta: balancete (`saldo_disponivel`, `rendimento_liquido`), plano, desembolso |
| `termo` | `project_id`, `termo_id` | o painel "Do contrato" do projeto (trecho literal e documento) | vigência, taxa e outros termos de `get_termos_contrato_v2` |
| `calculo` | `op` (`soma` \| `diferenca`), `partes: [{ id, sinal, valor, rotulo, origem }]` | lista das partes com o sinal; cada parte é clicável pela própria origem; o total confere ao centavo | resultado de `calcular` |
| `sem_documento` | `motivo` (texto curto), `consulta` (nome da RPC) | balão com o motivo, sem botão | **só** quando a RPC não traz nada melhor: bolsa digitada (até a F3), pendência, data de hoje. O motivo diz por quê ("bolsa digitada, ainda sem documento") |

Regras:
- A ferramenta escolhe a **melhor origem que a RPC oferece**. Se a RPC traz `ref` ou árvore, usar
  `sem_documento` é defeito.
- O nó da árvore vai inteiro (com as partes) dentro da origem `no`, para o clique não precisar de nova
  consulta. Limite: 200 nós por árvore; acima disso, todo nó sai como `livre` com a `chave` e o `caminho`
  dele (o clique abre a árvore naquele nó). Nunca `ref` direto, porque o valor da folha (ex.: bolsa × meses) pode
  diferir do campo referenciado (2ª revisão de 25/11).
- Nó de bolsa na árvore (`ref.alvo_tabela = 'scholarships'`): o modelo vê o rótulo com `⟦Pn⟧` no lugar do
  nome, estável pela `alvo_id`, sem depender do dicionário de nomes; o nome só existe na `origem`, que
  nunca vai ao modelo.
- Sem documento por enquanto (decisão de 25/11, a resolver na Etapa 2): **tarifa bancária** (a 069 soma as
  linhas e não as devolve; o pacote não replica a regra), **total do plano** e **desembolsos** (a 063 não
  devolve o id do plano nem `ref` das parcelas), **saldo em conta e rendimento** (ainda sem ferramenta; no
  site abrem o balancete por `ref` em `balancetes`). A Etapa 2 traz uma ferramenta de dinheiro em conta e
  plano com essas `ref`, e RPC que devolva as linhas da tarifa.
- `calculo` só soma e subtrai, com `sinal` ±1, para o "De onde vem" fechar ao centavo. Razão e
  percentual de conta ad hoc ficam fora da Etapa 1.

## 4. Sessão de ferramentas (`shared/ai-tools/index.js`)

```js
import { criarSessao, INSTRUCOES, especificacoes } from '../shared/ai-tools/index.js';

const sessao = criarSessao({
  rpc: async (nome, args) => ({ data, error }),   // injetado: Worker usa fetch com o JWT; testes, falso
  hoje: '2026-11-25',
});
especificacoes();            // lista de tools no formato do /api/chat do Ollama (function calling)
await sessao.executar(nome, args);
//   → { id: 'r3', paraModelo: string /* JSON compacto e mascarado */ }
//   → { id: 'r3', erro: 'mensagem para o modelo' }   (falha da RPC nunca vira zero nem lista vazia)
sessao.criarBloco(args);     // → { bloco } (§6) ou { erro } que volta ao modelo
sessao.calcular(args);       // → { id: 'c1', paraModelo } ou { erro }
sessao.marcarTexto(texto);   // → { texto, semOrigem: [{ inicio, fim }] }  números do texto que não são valor de nó citado
sessao.reidratar(bloco);     // troca ⟦Pn⟧ pelo valor real; só para o que vai à tela
sessao.reidratarTexto(marcado); // → { texto, semOrigem } reidratado, intervalos deslocados
await sessao.mascararEntrada(texto); // → texto mascarado; carrega o dicionário e falha fechado
```

A pergunta e os `anteriores` passam por `mascararEntrada` **antes da primeira ida ao modelo**: o
`⟦Pn⟧` é o mesmo dos resultados das ferramentas, e CPF/e-mail saem de todo texto. Se o dicionário
de nomes não carregar, a sessão rejeita e o Worker encerra com `erro` `interno` sem mandar a
pergunta crua ao modelo. O texto final é conferido por `marcarTexto` na versão mascarada e só vira
evento `texto` depois de `reidratarTexto` (que também desloca `semOrigem`).

Ferramentas da Etapa 1 (só leitura; nenhuma conta de negócio no pacote):

| Ferramenta | RPC | Origem dos números |
|---|---|---|
| `listar_centros` | `resumo_projetos_v2` | livre → `livre`; vigência → `sem_documento` ou `termo` quando houver |
| `explicar_livre` (`project_id`) | `explicar_livre_v2` | cada nó da árvore → `no` |
| `situacao_centro` (`project_id`) | `situacao_centro_v2` | valores dos motivos → `no` quando casam com a árvore; senão `sem_documento` com o motivo literal |
| `desembolsos` (`project_id`) | `get_repasses_v2` | `ref` quando a linha traz; senão `sem_documento` |
| `termos_contrato` (`project_id`) | `get_termos_contrato_v2` | `termo` |
| `pendencias` (`project_id` opcional) | `listar_pendencias_v2` | `sem_documento` (pendência) |
| `bolsas` (`project_id` opcional) | `get_pedido_bolsas_v2` | `sem_documento` ("bolsa digitada"); nome mascarado |
| `criar_bloco`, `calcular` | — | §3 e §6 |

Argumento de centro aceita o código (`30.109`) ou o id; a resolução usa o `listar_centros` da própria
sessão. Centro fora do escopo da pessoa volta como "não encontrado no seu acesso", nunca como zero.

## 5. Dados pessoais (README §7b.11)

- Campo que é nome de pessoa (por ferramenta, lista fechada no código) → `⟦P<n>⟧`, estável na sessão.
- CPF (`_tem_cpf`: com ou sem pontuação) e e-mail saem de **todo** texto, inclusive livre.
- Texto livre (título de pendência, motivo, trecho de termo): nomes completos e "primeiro + último nome" dos
  bolsistas visíveis à pessoa viram `⟦Pn⟧`. O dicionário vem de `get_pedido_bolsas_v2`, carregado uma vez
  por sessão quando a primeira ferramenta com texto livre roda. Limite conhecido: primeiro nome sozinho
  não é mascarado (registrado no plano como risco).
- O mapa `⟦Pn⟧ → nome` vive só na sessão (memória da requisição). Nada disso vai a log.

## 6. Bloco

O que o modelo pede (`criar_bloco`):

```js
{ tipo: 'numero', titulo: 'Livre do 30.109', no: 'r2.1', contexto: 'r2.4' /* opcional, nó texto ou data */ }
{ tipo: 'tabela', titulo: 'Centros em atenção', colunas: ['Centro', 'Livre', 'Motivo'],
  linhas: [['r1.3', 'r1.4', 'r1.9'], ['r1.12', 'r1.13', 'r1.18']] }   // toda célula é id de nó
{ tipo: 'texto', texto: 'Dois centros estão em atenção pela tarifa bancária.' }
```

O que sai para a tela (evento `bloco`):

```js
{ id: 'b1', tipo: 'numero' | 'tabela' | 'texto', titulo,
  numero: { valor, unidade, rotulo, origem, contexto: { valor, unidade, origem } | null },
  tabela: { colunas: [{ rotulo, unidade }], linhas: [[{ valor, unidade, origem }]] },
  texto:  { texto, semOrigem: [{ inicio, fim }] } }
```

Recusas (voltam ao modelo como erro, e o bloco não sai): id que não existe; célula literal; coluna com
unidades misturadas; tabela com mais de 50 linhas ou 8 colunas; título ou cabeçalho de coluna com número
que não é de nó.

Mensagem de erro de RPC nunca vai crua ao modelo nem à tela: sai uma mensagem fixa por ferramenta com o
código (`http_4xx`, `tempo`, `formato`, `rede`).

## 7. Worker (`worker/`)

`POST /analise` com `Authorization: Bearer <JWT do Supabase>` e corpo
`{ pergunta: string (≤ 2.000), anteriores?: [{ pergunta, resumo }] (≤ 5) }`.
Resposta `text/event-stream`, eventos `event: <nome>\ndata: <json>`:

| Evento | Dados |
|---|---|
| `passo` | `{ ferramenta, rotulo, estado: 'inicio' \| 'fim' \| 'erro', erro? }`; `rotulo` em pt-BR ("consultando os centros") |
| `bloco` | o bloco reidratado (§6) |
| `texto` | `{ texto, semOrigem }`, a resposta final curta, já reidratada (nomes reais e `semOrigem` deslocado) |
| `fim` | `{ rodadas, ms }` |
| `erro` | `{ codigo: 'sem_login' \| 'sem_permissao' \| 'limite' \| 'modelo' \| 'tempo' \| 'interno' \| 'incompleta', mensagem }` |

- Autenticação: `GET /auth/v1/user` com o JWT; papel lido de `app_users` com o mesmo JWT (como o app). Só
  `admin` (variável `ANALISE_PAPEIS`, padrão `admin`). Sem `service_role`.
- Quando as 8 rodadas acabam e já houve ao menos um bloco emitido, o encerramento é `erro` com código
  `incompleta` e a mensagem fixa "A resposta ficou incompleta: parei em 8 rodadas. Os blocos acima estão
  certos; para o resto, faça uma pergunta mais específica." Sem bloco emitido, continua `interno`.
- Modelo: `POST https://ollama.com/api/chat`, `model` = `ANALISE_MODELO` (padrão
  `deepseek-v4.1-flash:cloud`), `think: 'high'` (se a API recusar o nível para esse modelo, `think: true`;
  o Claude confere com uma chamada real no fim da Etapa 1), `stream: false` por rodada,
  `tools` = `especificacoes()`.
- Tetos: 8 rodadas, 30 chamadas de ferramenta, 60.000 caracteres por resultado (acima disso volta erro
  pedindo filtro), 120 s no total.
- Limite: KV `ANALISE_USO`, chave `uso:<user_id>:<AAAA-MM-DD>` (fuso de Brasília), 50 por dia, expira em
  48 h. Conta a pergunta quando ela começa.
- CORS: `https://lapig-financeiro.github.io` e `http://localhost:*`. `OPTIONS` responde sem autenticar.
- Sem log de pergunta, resultado, bloco ou texto. `console.log` só com código de erro e tempo.
- Segredos: `OLLAMA_API_KEY` (o Victor põe). Variáveis: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (públicas),
  `ANALISE_MODELO`, `ANALISE_PAPEIS`.

## 8. Instruções ao modelo (`INSTRUCOES` no pacote)

As quatro regras do MCP, palavra por palavra (não calcule, não recomende, diga o que o número cobre,
panorama descreve), mais: toda resposta é feita de blocos; número só por `criar_bloco` ou `calcular`; o
texto final tem no máximo 3 frases e não repete número dos blocos; sem dado, diga que não há e por quê.
