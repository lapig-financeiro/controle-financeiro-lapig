# Tarefa: rodada de correção da Análise + registro, feedback e aviso de corte

> Escrita pelo Claude em 26/11/2026, a pedido do Victor. **Orquestrador: Gemini 4 Neon medium** (agy), com
> liberdade para dividir e ordenar o trabalho. **Executor: DeepSeek V4.1 Flash max**; **revisor de cada etapa:
> MiniMax 3.1 Flash max** (os dois pelo opencode). Worktree `C:/Users/amara/dev/cf-correcoes`, branch
> `redesenho/analise-correcoes`, a partir do master `89a6a35`. O Claude só confere a entrega final.
>
> Leia antes: `AGENTS.md` (regras que não se negociam), `docs/aplicar-migracao.md` (restrições do cofre),
> `docs/redesenho/ESTADO.md` (parte da Análise), `docs/redesenho/analise-contrato.md` (o contrato inteiro),
> `docs/redesenho/analise-plano.md`, `docs/redesenho/relatorios/revisao-pre-etapa2.md` (os achados, já
> conferidos pelo Claude), `docs/redesenho/relatorios/analise-edge.md`, `worker/README.md`,
> `supabase/functions/analise/README.md` e `database/071_analise_uso.sql` (molde de tabela + RPC desta rodada).

## Situação

A Análise (F5) roda o laço de ferramentas numa **Edge Function do Supabase** (`supabase/functions/analise/`,
publicada em 26/11), com o núcleo em `worker/src/nucleo.js` (o Worker da Cloudflare usa o mesmo núcleo e segue
publicado até a troca). O pacote `shared/ai-tools/` tem as ferramentas, a máscara de nomes e a validação de
blocos. A tela `#/analise` do `app/` **ainda não existe** (é a Etapa 2, fora desta rodada).

Em 26/11 a Edge Function teve o stream cortado aos 5,5 s numa pergunta "em todos os centros" (`CPU Time
exceeded`, teto de 2 s de CPU do plano gratuito). A causa era a máscara montar duas `RegExp` por nome para
cada texto; o `includes` antes da `RegExp` (d8fd64c) derrubou a máscara de ~1,0 s para ~0,05 s em 3 perguntas.
**Não piore isso**: a medida de CPU desta rodada faz parte do "pronto".

## Parte A — achados da revisão (`relatorios/revisao-pre-etapa2.md`)

Todos foram conferidos no código pelo Claude. Corrija com teste que falhe antes e passe depois.

1. **Pergunta e `anteriores` mascarados** antes de ir ao modelo (`laco.js`): mesma máscara da sessão
   (`texto()`, depois do dicionário carregado), para que o `⟦Pn⟧` da pergunta seja o mesmo dos resultados das
   ferramentas. CPF e e-mail também saem. A pergunta 18 da bateria passa a não vazar.
2. **Texto final reidratado** antes do evento `texto` (a tela não tem como reidratar: o mapa morre com a
   requisição). A conferência de "sem origem" continua sobre a versão mascarada. Os blocos já saem reidratados:
   confira que o texto e o bloco mostram o mesmo nome.
3. **403 ao ler `app_users`** vira `sem_permissao`, não `sem_login` (`auth.js`).
4. **`codigoDoErro`** (`shared/ai-tools/ferramentas/comum.js`) reconhece o erro `{ codigo, mensagem }` que
   `worker/src/rpc.js` entrega (timeout, rede, 5xx): não pode virar `http_4xx`.
5. **Rendimento** (`desembolsos`): o site mostra o `rendimento_liquido` do balancete, que é o que está no
   saldo. A ferramenta passa a registrar o líquido com a ressalva "já incluído no saldo disponível; não somar";
   se o bruto continuar, vai com rótulo próprio e sem essa ressalva. Confira o campo na RPC e no
   `app/src/telas/Projeto.jsx` antes de decidir; nenhum número do site muda.
6. **`INSTRUCOES`** ao modelo: tire as ferramentas e campos que a Análise não tem (`panorama`,
   `simular_alocacao`, `truncado`, `caixa.cobertura`…), mantenha as 4 regras adaptadas às ferramentas reais e
   acrescente: não escrever id de nó (`r2.7`) no texto; número no texto só com nó citado. Atualize o contrato §8.
7. **"Sem origem" falso** (`shared/ai-tools/texto.js`): dígito dentro do nome de um centro que a sessão
   listou ("GPW fase 2"), ano sozinho ("2026", "março de 2027") e data (DD/MM/AAAA, MM/AAAA) não são números a
   conferir. Valor em R$ continua exigindo origem. Teste com as frases das perguntas 2, 11, 13, 14, 15 e 16.
8. **Rótulo de linha nas tabelas** (M7; contrato §6): a primeira coluna pode ser texto (rótulo) e as outras
   valores com origem; texto literal citado não vira nó. Ajuste a validação de `criar_bloco` e o contrato.
9. **`listar_centros` com `responsaveis`** (M8), **mascarados** pelo mesmo dicionário: os nomes dos
   responsáveis entram na máscara (como os bolsistas) e o modelo vê `⟦Pn⟧`. Com o item 1, "os centros da
   Mariana" passa a casar o `⟦Pn⟧` da pergunta com o do responsável. Nenhum nome real vai ao Ollama.
10. **Uma consulta para todos os centros**: hoje uma pergunta "por centro" chama `explicar_livre`/
    `situacao_centro` um centro por vez (a pergunta 9 chegou a 43 chamadas e ao teto de 30 consultas). Crie
    uma ferramenta (ou um modo da existente) que traga o resumo de todos os centros numa chamada, **usando RPC
    `*_v2` que já existe** (ex.: `resumo_projetos_v2`; confira o que ela devolve). Sem migração para isso.
    Diga nas `INSTRUCOES` quando usar.
11. **Menores** (corrija se for simples e testável; senão, registre no relatório por quê não):
    - `bolsas` sem centro pode passar do teto de 60.000 caracteres: meça com o retrato e corte com aviso
      explícito ao modelo de que veio parcial e como filtrar (M4);
    - `arguments` em array, `tool_calls` malformado entrando no histórico, id repetido (G5);
    - corpo de resposta de erro do Ollama/Supabase não cancelado (G7);
    - `passo` com `estado: 'erro'` sem `inicio` antes (G9): emita o `inicio`;
    - `situacao_centro` dizendo "(formato)" em falha de cálculo, `status` cru em inglês nas bolsas, campo de
      `recursos` malformado derrubando `desembolsos` inteiro (M9-M16).
    - **Não mude** o comportamento de falhar fechado do dicionário de nomes (M5): se a lista de pessoas não
      carrega, a ferramenta que devolve nome recusa.

## Parte B — registro das perguntas, feedback e aviso de corte (pedido do Victor, 26/11)

O Victor quer (1) que a pessoa seja avisada quando a análise for cortada, em vez de uma falha silenciosa;
(2) que a pessoa possa dar feedback na conversa (erro, corte ou algo a melhorar); (3) guardar todas as
perguntas e respostas para estudar o uso (por exemplo, o da Mariana) e conferir a qualidade. **Isso muda de
propósito a regra "sem log" da Análise**: o registro vai para o **banco**, atrás de RLS, nunca para o log da
Edge Function nem do Worker (lá continua sem log de pergunta, argumento, resultado ou texto).

Decisões já tomadas (o Claude recomendou e o Victor seguiu; não reabra sem motivo):
- guarda-se **o que a pessoa digitou e viu** (pergunta e resposta reidratadas, os blocos, os passos com as
  ferramentas e os argumentos mascarados que o modelo usou);
- **só o admin lê** (o próprio usuário também pode ler os registros dele, se for simples); ninguém edita;
- retenção de **180 dias**, apagados pela própria RPC de registro (molde da 071);
- a tela da Etapa 2 vai avisar que "as perguntas ficam guardadas para melhorar a Análise" (anote no plano; não
  é desta rodada).

### B1. Migração `database/074_analise_registro.sql`

Numeração: 072 (projeção das bolsas) e 073 (análises salvas) continuam reservadas no `analise-plano.md`.
Avalie e escreva no relatório se o registro serve de base para a 073; não a implemente.

- Tabela `analise_registro`: `id uuid` (PK, `gen_random_uuid()`), `user_id uuid not null`, `iniciada_em
  timestamptz not null default now()`, `terminada_em timestamptz`, `pergunta text not null` (com o mesmo
  limite de caracteres do núcleo), `anteriores integer` (quantas mensagens anteriores vieram), `modelo text`,
  `resposta jsonb` (texto + blocos), `passos jsonb`, `rodadas int`, `ms int`, `chamadas int`, `desfecho text`
  (check: `ok`, `erro`, `incompleta`, `tempo`, `limite`…; o conjunto exato sai dos eventos do contrato),
  `codigo_erro text`. Limite de tamanho no `jsonb` (por exemplo 256 KB) para ninguém encher o banco.
- Tabela `analise_feedback`: `id uuid` PK, `registro_id uuid not null references analise_registro on delete
  cascade`, `user_id uuid not null`, `criado_em timestamptz default now()`, `nota smallint` (check `-1` ou `1`,
  nula permitida), `comentario text` (até 2.000 caracteres), `motivo text` (check: `errado`, `cortada`,
  `incompleta`, `melhorar`, `outro`, nulo permitido). Pelo menos nota, motivo ou comentário.
- As duas: RLS ligado **sem policy**, `revoke all` de `public`/`anon`/`authenticated`, `trg_bloqueia_agente`
  de statement sem WHEN (molde da 071/051).
- RPCs `security definer`, `set search_path = public, pg_temp`, guarda `auth.uid()` não nulo e `not
  is_agente()` (42501), `grant execute` só a `authenticated`:
  - `analise_registro_iniciar(p_pergunta text, p_anteriores int, p_modelo text) → uuid`: cria a linha do
    próprio usuário e apaga as linhas dele com mais de 180 dias;
  - `analise_registro_concluir(p_id uuid, p_resposta jsonb, p_passos jsonb, p_rodadas int, p_ms int,
    p_chamadas int, p_desfecho text, p_codigo_erro text) → void`: só a linha do próprio usuário e só **uma
    vez** (`terminada_em is null`); outra linha ou segunda chamada = erro;
  - `analise_feedback_enviar(p_registro_id uuid, p_nota smallint, p_motivo text, p_comentario text) → uuid`:
    só para registro do próprio usuário;
  - `analise_registros_admin(p_desde timestamptz, p_limite int) → jsonb`: guarda extra `is_admin()`;
    devolve os registros com os feedbacks e um desfecho calculado **`cortada`** quando `terminada_em` é nulo e
    `iniciada_em` tem mais de 3 minutos (o prazo do núcleo é 120 s). Limite máximo de linhas por chamada.
- Asserções no fim do `.sql`; respeite as restrições do cofre (`BEGIN/COMMIT`, palavras recusadas, 90 KB,
  valores fixos). Roteiro `tests/sql/test_074_analise_registro.sql` e `tools/replica-local/rodar-074-pglite.mjs`
  no molde do `rodar-071-pglite.mjs`: ausência antes, idempotência, A não lê nem conclui nem dá feedback no
  registro de B, concluir duas vezes recusado, anon/sem JWT/agente recusados, professor não lê o admin, escrita
  direta recusada, retenção de 180 dias, `cortada` calculado, ACL e atributos, BLOCO 1 da 051 e **pelo menos 6
  mutantes** (sem RLS, grant a anon, sem guarda do agente, concluir sem checar dono, concluir duas vezes,
  admin sem `is_admin()`). Linha nova em `docs/migracoes.md`.

### B2. Núcleo (`worker/src/`)

- Depois do login e do contador, chama `analise_registro_iniciar` com o JWT da pessoa; no fim (qualquer
  desfecho: `fim` normal, `erro`, tempo, encerrador) chama `analise_registro_concluir` dentro do
  `waitUntil`. A falha do registro **não** derruba a resposta (o registro não é barreira de segurança): a
  pergunta segue e o relatório diz como isso aparece. Nada disso vai para o log.
- Evento SSE novo, o **primeiro** da resposta: `inicio` com `{ registro }` (o id, ou `null` se o registro
  falhou). Serve para a tela mandar o feedback e já mostra que o login passou. Atualize o contrato §7 e o
  `worker/README.md`.
- Bancada (`worker/bancada/`): o roteador responde as RPCs novas em memória, confere que toda pergunta abre e
  fecha o registro uma vez e que o registro guardado não tem nome sintético do retrato onde não deve (a
  pergunta e a resposta guardadas são as reidratadas: o nome **pode** estar ali; os `passos` não).

### B3. Cliente do stream no `app/` (sem tela)

`app/src/servicos/analise.js` (novo): função que faz o POST na Edge Function com o JWT da sessão, lê o SSE e
chama callbacks por evento. **Se o stream fechar sem `fim`** (o runtime matou a função, a rede caiu), ela
emite um erro local `interrompida` com a mensagem: "A análise foi interrompida pelo servidor antes de
terminar. O que chegou até aqui está abaixo, incompleto. Tente de novo ou faça uma pergunta mais específica."
— e mantém o que já tinha chegado. Também `enviarFeedback(registro, { nota, motivo, comentario })` pela RPC.
Testes no `app` (stream completo, cortado sem `fim`, `erro` + `fim`, ping, evento desconhecido ignorado).
Nada de tela: ela é da Etapa 2. **Não acrescente a URL da Edge Function ao CSP** (`app/vite.config.js`) se isso
não for preciso para os testes; se for, diga no relatório.

## Arquivos

Pode criar/editar: `shared/ai-tools/**`, `worker/src/**`, `worker/tests/**`, `worker/bancada/**`,
`worker/README.md`, `supabase/functions/analise/**` (menos o `nucleo.gerado.js`, que não é versionado),
`database/074_analise_registro.sql`, `tests/sql/test_074_analise_registro.sql`,
`tools/replica-local/rodar-074-pglite.mjs`, `app/src/servicos/analise.js` e o teste dele,
`tests/ai-tools.test.js` e outros testes de `tests/` que travem o pacote, `docs/migracoes.md` (só a linha da
074), `docs/redesenho/analise-contrato.md`, `docs/redesenho/analise-plano.md`, `docs/redesenho/ESTADO.md` (só
a parte da Análise), `docs/redesenho/relatorios/analise-correcoes.md`.
**Não mexa** em: `frontend/`, `mcp/` (o MCP compartilha o pacote: se uma mudança no `shared/ai-tools/`
mudar o que o MCP responde, pare e registre), telas do `app/`, outras migrações.

## O que não fazer

Não aplicar migração, não usar o cofre, não publicar (nem Edge Function, nem Worker, nem site), não fazer
login em nada, não chamar a produção, não fazer `push`, não mexer no `master` nem na pasta do OneDrive.
O modelo de verdade só pela bancada (Ollama local, `localhost:11434`). Nenhum dado de
`NãoColocarNoGit/` entra em arquivo versionado, teste ou relatório (números agregados e ids de pergunta
podem; nomes, nunca).

## Pronto quando

- `npm run lint`, `npm test`, `npm --prefix worker test`, `npm --prefix app test`, `npm --prefix app run build`
  e `npm --prefix worker run build:edge` verdes; roteiro PGlite da 074 verde com todos os mutantes pegos.
- Bancada: a bateria real inteira (20 perguntas) com o núcleo novo, comparada com `bateria-2-edge` (9/20):
  quantas passam, por quê as outras falham, chamadas externas por pergunta (a pergunta 9 tem de cair muito) e
  **nenhum vazamento** (a 18 inclusive).
- **CPU**: perfil do Node (`node --cpu-prof`) nas perguntas 2, 4, 9 e 12, antes e depois, com a soma por
  arquivo do código nosso (`shared/ai-tools/`, `worker/src/`). Nada pode voltar perto de 1 s; diga o maior.
- Relatório `docs/redesenho/relatorios/analise-correcoes.md`: o que mudou por item (A1-A11, B1-B3), o que
  ficou de fora e por quê, testes (números), mutantes, bancada antes/depois, CPU, os achados do MiniMax e o
  que foi feito com cada um, e o que só se prova publicando.
- `ESTADO.md` atualizado no mesmo commit de cada etapa; commits atômicos no padrão do projeto
  (`fix(analise): …`, `feat(analise): …`, `docs(analise): …`) na branch `redesenho/analise-correcoes`.
