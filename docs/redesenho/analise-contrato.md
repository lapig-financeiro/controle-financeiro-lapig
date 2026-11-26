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
| `listar_centros` | `resumo_projetos_v2` | livre → `livre`; vigência, situação, motivos e responsáveis → `sem_documento` (responsável com o nome mascarado, ⟦Pn⟧) |
| `explicar_livre` (`project_id`) | `explicar_livre_v2` | cada nó da árvore → `no` |
| `situacao_centro` (`project_id`) | `situacao_centro_v2` | valores dos motivos → `no` quando casam com a árvore; senão `sem_documento` com o motivo literal |
| `desembolsos` (`project_id` opcional) | `get_repasses_v2` | `ref` quando a linha traz; senão `sem_documento` |
| `termos_contrato` (`project_id` opcional) | `get_termos_contrato_v2` | `termo` |
| `pendencias` (`project_id` opcional) | `listar_pendencias_v2` | `sem_documento` (pendência) |
| `bolsas` (`project_id` opcional) | `get_pedido_bolsas_v2` | `sem_documento` ("bolsa digitada"); nome mascarado |
| `criar_bloco`, `calcular` | — | §3 e §6 |

Argumento de centro aceita o código (`30.109`) ou o id; a resolução usa o `listar_centros` da própria
sessão. Centro fora do escopo da pessoa volta como "não encontrado no seu acesso", nunca como zero.

`desembolsos` e `termos_contrato` aceitam omitir `project_id`: nesse modo consultam todos os centros
visíveis em paralelo e devolvem `{ centros, nos }` numa única chamada de ferramenta. A falha de um centro
fica registrada nele como `{ codigo, nome, erro }` (nunca vira zero nem derruba os outros); se todos
falharem, a ferramenta devolve `{ erro }`.

## 5. Dados pessoais (README §7b.11)

- Campo que é nome de pessoa (por ferramenta, lista fechada no código) → `⟦P<n>⟧`, estável na sessão.
- CPF (`_tem_cpf`: com ou sem pontuação) e e-mail saem de **todo** texto, inclusive livre.
- Texto livre (título de pendência, motivo, trecho de termo): nomes completos e "primeiro + último nome" dos
  bolsistas visíveis à pessoa viram `⟦Pn⟧`. O dicionário vem de `get_pedido_bolsas_v2`, carregado uma vez
  por sessão quando a primeira ferramenta com texto livre roda. Os `responsaveis` de cada centro visível
  (`resumo_projetos_v2`) entram no **mesmo** dicionário: são nomes de pessoa tanto na pergunta quanto em
  `listar_centros`. Antes de mascarar a pergunta, a sessão tenta carregar os centros; se essa consulta
  falhar, a pergunta segue com o dicionário de bolsistas (o fail-closed continua sendo o dele). Limite
  conhecido: primeiro nome sozinho não é mascarado (registrado no plano como risco).
- O mapa `⟦Pn⟧ → nome` vive só na sessão (memória da requisição). Nada disso vai a log.

## 6. Bloco

O que o modelo pede (`criar_bloco`):

```js
{ tipo: 'numero', titulo: 'Livre do 30.109', no: 'r2.1', contexto: 'r2.4' /* opcional, nó texto ou data */ }
{ tipo: 'tabela', titulo: 'Centros em atenção', colunas: ['Centro', 'Livre', 'Motivo'],
  linhas: [['r1.3', 'r1.4', 'r1.9'], ['Pessoal', 'r1.13', 'r1.18']] }
  // a primeira coluna pode ser id de nó ou rótulo de linha em texto literal;
  // as demais colunas só aceitam id de nó
{ tipo: 'texto', texto: 'Dois centros estão em atenção pela tarifa bancária.' }
```

O que sai para a tela (evento `bloco`):

```js
{ id: 'b1', tipo: 'numero' | 'tabela' | 'texto', titulo,
  numero: { valor, unidade, rotulo, origem, contexto: { valor, unidade, origem } | null },
  tabela: { colunas: [{ rotulo, unidade }], linhas: [[{ valor, unidade, origem }]] },
  texto:  { texto, semOrigem: [{ inicio, fim }] } }
```

Na tabela, a primeira coluna aceita duas formas: id de um nó registrado (célula com
`{ valor, unidade, origem }`, como as demais) ou **rótulo de linha** em texto literal
(`'Pessoal'`, `'Serviços PJ'`, `'30.109'`), que sai como
`{ valor: textoMascarado, unidade: 'texto', origem: null }`, não vira nó e não entra em
`citados`. A primeira coluna não pode misturar rótulo literal com unidade numérica.
Texto literal nas colunas 2 em diante continua recusado.

Recusas (voltam ao modelo como erro, e o bloco não sai): id que não existe; célula literal
nas colunas 2 em diante; rótulo de linha vazio, com cara de id de nó inexistente ou com
número sem origem (código de centro e nome de centro da sessão passam; `R$ 500` inventado
não); coluna com unidades misturadas; tabela com mais de 50 linhas ou 8 colunas; título ou
cabeçalho de coluna com número que não é de nó.

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

Quatro regras valem para todas as tools, adaptadas às ferramentas reais da Análise (`listar_centros`,
`explicar_livre`, `situacao_centro`, `desembolsos`, `termos_contrato`, `pendencias`, `bolsas`,
`criar_bloco` e `calcular`):

1. **Não calcule.** Todo número sai de uma RPC; a única conta permitida é `calcular`, que soma ou
   subtrai nós de moeda/número da mesma unidade. Somar, projetar ou reordenar por conta própria
   produz um segundo resultado, que vai discordar do site.
2. **Não recomende — apresente.** As tools trazem valores e motivos, sem shortlist e sem ranking de
   mérito. Exponha as opções com o porquê de cada uma; escolher é de quem coordena.
3. **Diga o que o número cobre quando isso muda a leitura:** data do balancete (`desembolsos`), centro
   sem plano ou sem balancete (`listar_centros`, `explicar_livre`, `situacao_centro`), vigência do
   cadastro contra a do contrato (`termos_contrato`), folha atrasada (`explicar_livre`) e rendimento
   líquido, que já está incluído no saldo disponível e não se soma de novo (`desembolsos`).
4. **`listar_centros` descreve os centros**; a ordem da lista não significa prioridade e não ranqueia
   mérito.

Quando usar: `listar_centros` uma vez para a visão geral por centro (livre, situação, motivos, vigência do
cadastro, balancete, pendências abertas e responsáveis) — sem chamar `situacao_centro` ou `explicar_livre`
centro por centro se ela já responde; `desembolsos` **sem `project_id`** uma vez para desembolsos/parcelas
de todos os centros; `termos_contrato` **sem `project_id`** uma vez para vigência/taxas de todos os centros.

Além disso:

- Toda resposta é feita de blocos; número só por `criar_bloco` ou `calcular`. Sem dado, diga que não há,
  e diga o porquê só quando a ferramenta informar o motivo.
- **Não escrever id de nó** (`r2.7`, `c1`, `{{r2.7}}`) no texto final nem em bloco de texto.
- **Número no texto só se for valor de nó já citado** em bloco ou `calcular`; o texto final tem no
  máximo 3 frases corridas, sem repetir tabela markdown nem listas de números.
- Em tabelas (`criar_bloco`), a **primeira coluna** pode ser texto literal (rótulo de linha) e as
  demais colunas citam ids de nós.
