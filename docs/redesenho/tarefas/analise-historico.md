# Tarefa: histórico de conversas da Análise (#/analise)

Executor: DeepSeek V4.1 Flash max (opencode). Revisor: subagente `revisor-minimax` (MiniMax 3.1 Flash max).
Quem orquestra e fecha: Claude. Decisões de produto: Victor, 26/11/2026.

## Onde trabalhar

- Worktree `C:/Users/amara/dev/cf-analise-historico`, branch `redesenho/analise-historico` (já criada, com
  `node_modules` instalados na raiz, em `app/` e em `worker/`).
- Commits `feat:`/`fix:`/`test:`/`docs:` nessa branch. **Sem push, sem deploy, sem aplicar migração, sem tocar
  produção** (nada de `supabase functions deploy`, cofre, REST com chave ou senha). A pasta `.opencode/` não vai
  para o git.
- Antes de começar, leia: `AGENTS.md`, `docs/redesenho/ESTADO.md` (seções da Análise),
  `docs/redesenho/analise-contrato.md`, `docs/redesenho/estetica.md`, `docs/aplicar-migracao.md` (restrições do
  cofre: BEGIN/COMMIT, palavras recusadas, 90 KB), `database/074_analise_registro.sql`,
  `tests/sql/test_074_analise_registro.sql`, `tools/replica-local/rodar-074-pglite.mjs`,
  `docs/redesenho/relatorios/analise-primeiras-perguntas.md` (o desenho vem da §4 e das decisões da §5).
- O repositório é público: nenhum nome real, CPF ou dado de planilha em fixture, teste ou log.

## O que o Victor decidiu

1. **Retenção**: guardar enquanto a conta existir ou até a pessoa excluir a conversa. Acaba a limpeza de 180 dias.
2. **Nomes de bolsistas** podem ficar na resposta salva (ela já é guardada reidratada, como a pessoa viu).
3. **Tela**: lista de conversas, conversa contínua com o campo embaixo, botão "Nova conversa" e, se a última conversa
   ficou parada de um dia para o outro, a tela abre uma conversa nova por padrão, com "continuar a anterior" a um
   clique.

## Parte A — Migração `database/075_analise_historico.sql`

(A 073 "análises salvas" do plano fica absorvida por esta; a 072 continua reservada para a projeção das bolsas.)

Siga o padrão da 074 (cabeçalho explicando o porquê, `begin;`…`commit;`, asserções no fim, `create or replace`
repetindo `security definer`, `set search_path = public, pg_temp` e a guarda `auth.uid()` não nulo e
`not public.is_agente()` → 42501; `drop` + `create` quando a assinatura muda, restaurando o grant).

1. **Tabela `analise_conversa`**: `id uuid pk default gen_random_uuid()`, `user_id uuid not null`,
   `titulo text not null` (1–120 caracteres após `btrim`), `criada_em timestamptz not null default now()`,
   `atualizada_em timestamptz not null default now()`. Índice `(user_id, atualizada_em desc)`. RLS ligado **sem
   policy**, `revoke all` de `public, anon, authenticated`, `trg_bloqueia_agente` de statement (igual à 074).
2. **`analise_registro`** ganha `conversa_id uuid references analise_conversa(id) on delete cascade` e
   `ordem integer`. **Backfill**: para cada registro existente, uma conversa própria (título = primeiros 80
   caracteres da pergunta com espaços colapsados; `criada_em = iniciada_em`;
   `atualizada_em = coalesce(terminada_em, iniciada_em)`; `user_id` do registro) e `ordem = 1`. Depois do backfill,
   `conversa_id` e `ordem` passam a `not null`. Índice `(conversa_id, ordem)` e unicidade `(conversa_id, ordem)`.
3. **`analise_registro_iniciar`**: nova assinatura `(p_pergunta text, p_anteriores integer default 0,
   p_modelo text default null, p_conversa uuid default null) returns jsonb` → `{ "registro": uuid,
   "conversa": uuid, "ordem": int }`. `drop` da versão `(text, integer, text)` e grant só a `authenticated`.
   - `p_conversa` nulo: cria a conversa (título como no backfill) e `ordem = 1`.
   - `p_conversa` informado: tem de ser do `auth.uid()`; senão **42501** (inclusive inexistente). Trave a linha da
     conversa (`for update`) e use `ordem = max(ordem) + 1`. Atualize `atualizada_em`.
   - **Sem** o `delete` de 180 dias. O freio de inundação (200 em 24 h) continua.
4. **Conclusão só pelo servidor** (furo achado em 26/11: hoje quem está logado pode gravar o conteúdo da própria
   resposta pela `analise_registro_concluir`):
   - `drop function analise_registro_concluir(uuid, jsonb, jsonb, integer, integer, integer, text, text)`.
   - Nova `analise_registro_concluir_servidor(p_user uuid, p_id uuid, p_resposta jsonb, p_passos jsonb,
     p_rodadas integer, p_ms integer, p_chamadas integer, p_desfecho text, p_codigo_erro text default null)`,
     `security definer`, mesmo `search_path`, mesmas validações da 074 (desfecho, 256 KB, código ≤ 64), guarda
     **`auth.role() = 'service_role'`** (senão 42501), conclui só a linha `id = p_id and user_id = p_user and
     terminada_em is null` (alheia 42501, já concluída 22023) e atualiza `analise_conversa.atualizada_em`.
     `revoke all` de `public, anon, authenticated`; `grant execute` **só** a `service_role`.
5. **Leitura e gestão pelo dono** (todas `security definer`, guarda, grant só a `authenticated`, 42501 para
   conversa alheia ou inexistente):
   - `analise_conversas_listar(p_limite integer default 30, p_antes timestamptz default null) returns jsonb`:
     lista `[{ id, titulo, criada_em, atualizada_em, turnos }]` do `auth.uid()`, `atualizada_em desc`, limite 1–100,
     paginação por `atualizada_em < p_antes`.
   - `analise_conversa_ler(p_conversa uuid) returns jsonb`: `{ id, titulo, criada_em, atualizada_em, turnos: [{
     registro, ordem, pergunta, resposta, desfecho, desfecho_calculado, iniciada_em, terminada_em, rodadas, ms,
     feedback }] }` em `ordem asc`. **Sem `passos`** (são internos). `desfecho_calculado` com a mesma regra da 074
     (`cortada` após 3 min sem `terminada_em`). `feedback` = o último `{ nota, motivo }` do registro ou `null`.
   - `analise_conversa_renomear(p_conversa uuid, p_titulo text) returns void` (1–120 após `btrim`, senão 22023).
   - `analise_conversa_excluir(p_conversa uuid) returns void` (o cascade leva registros e feedbacks).
6. `analise_registros_admin`: acrescente `conversa_id` e `ordem` à saída (`create or replace` com os mesmos
   atributos e a guarda `is_admin()`).
7. Asserções no fim do `.sql` (atributos, ACL, ausência do `delete … 180 days`, `concluir` antiga inexistente,
   `concluir_servidor` sem EXECUTE para `authenticated`).
8. **Roteiro** `tests/sql/test_075_analise_historico.sql` (placeholders, nunca id real) e
   `tools/replica-local/rodar-075-pglite.mjs` no padrão do 074: aplica até a 074, prova o comportamento antigo,
   aplica a 075 (e de novo: idempotência), backfill, A não lê/renomeia/exclui/continua a conversa de B,
   `authenticated` não conclui, `service_role` conclui, anon/agente recusados, ordem crescente, retenção sem
   apagar nada antigo, BLOCO 1 da 051 e **mutantes** (no mínimo: sem RLS na `analise_conversa`; grant a anon;
   `iniciar` aceitando conversa alheia; `ler` sem filtro de dono; `excluir` sem filtro de dono; `concluir_servidor`
   com grant a `authenticated`; `delete` de 180 dias de volta; backfill deixando registro sem conversa).
   Ajuste o `rodar-074-pglite.mjs`/`test_074` só se a 075 os quebrar de propósito, e explique no relatório.
9. Linha nova em `docs/migracoes.md` no padrão das outras (marcando "não aplicada").

## Parte B — Núcleo da Análise (`worker/src`, vale para a Edge Function)

1. Corpo do `POST`: aceita `conversa` (uuid opcional; formato inválido → 400) além de `pergunta` e `anteriores`.
   Mantenha o teto de 5 `anteriores`; cada item aceita `{ pergunta, resumo, blocos? }`, com `blocos` texto
   ≤ 600 caracteres. A máscara existente vale para `blocos` também (fail-closed, como hoje).
2. `analise_registro_iniciar` com `p_conversa`; o evento SSE `inicio` passa a ser
   `{ registro, conversa, ordem }` (nulos se o registro falhar — continua best-effort, a resposta não depende dele).
3. `analise_registro_concluir_servidor` chamado com a **service role**: na Edge, `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`
   (o Supabase injeta) em `supabase/functions/analise/index.ts`, passado ao núcleo como `serviceRoleKey`; `p_user`
   é o `auth.usuario.id` que o núcleo já confere. A chave **nunca** vai para resposta, SSE, log, erro, registro ou
   teste com valor real (use um valor falso nos testes e prove que ele não aparece em nada que sai). Sem a chave
   (Worker da Cloudflare), o fechamento é pulado em silêncio: o registro fica sem conclusão, como uma falha
   best-effort.
4. `anteriores` no prompt (`worker/src/laco.js`, perto da linha 413): inclua `blocos` quando vier.
5. Atualize `docs/redesenho/analise-contrato.md` (§7 e onde citar o corpo e o `inicio`) e `worker/README.md`.
6. `npm --prefix worker run build:edge` precisa continuar passando.

## Parte C — Tela `#/analise` (`app/`)

Siga `docs/redesenho/estetica.md` e `app/src/estilo/tokens.css`: sem `style=` inline, sem hex fora dos tokens,
fonte na escala; componentes existentes (`Cartao`, `Botao`, `PainelLateral`, `Vazio`, `Esqueleto`, `AvisoFalha`).
Falha de consulta nunca vira lista vazia: aviso com "Tentar de novo".

1. **Serviços** (`app/src/servicos/`): `listarConversas`, `lerConversa`, `renomearConversa`, `excluirConversa`
   por `supabase.rpc`, no padrão `{ dados, erro }` de `dados.js`; equivalentes no modo exemplo
   (`analiseExemplo.js`) com 2–3 conversas falsas (uma de hoje, uma de ontem).
2. **Layout**: a partir de 1024 px, coluna da esquerda (~280 px) "Conversas" com o botão **"Nova conversa"** no topo
   e os itens (título + quando: "hoje, 14h32", "ontem", "25/11"), o ativo destacado. Abaixo de 1024 px, botão
   "Conversas" que abre a lista num `PainelLateral`.
3. **Conversa contínua**: turnos do mais antigo ao mais novo; o campo da pergunta fica **embaixo**, fixo
   (`position: sticky`) no fim da área da conversa. Enter envia, Shift+Enter quebra a linha (já é assim). Ao
   enviar, rola até o turno novo. Turno carregado do banco mostra "Respondida em 26/11/2026, às 14h32" e não mostra
   passos; turno ao vivo continua com passos, Parar e o feedback.
4. **Ao abrir `#/analise`**: carrega a lista. Se a conversa mais recente teve atividade **hoje** (data de Brasília,
   `America/Sao_Paulo`), abre essa conversa. Senão, abre uma conversa nova vazia com a linha "Sua última conversa
   foi em 25/11: «título»" e o botão **"Continuar"**.
5. **Nova conversa**: limpa a área e só passa a existir no banco no primeiro envio (`conversa` nulo no corpo); o id
   chega no `inicio` e a lista é recarregada.
6. **Rascunho por conversa** em memória (sobrevive à troca de conversa e à troca de aba do site; o `App.jsx` já
   mantém a tela montada). Análise em andamento continua se a pessoa trocar de conversa, e o resultado fica na
   conversa de origem.
7. **Renomear** (lápis no título da conversa aberta) e **Excluir** (com confirmação "Excluir esta conversa? Não dá
   para desfazer."). Depois de excluir, volta para uma conversa nova.
8. **`anteriores`**: os 2 últimos turnos `ok` da conversa aberta (pergunta ≤ 500, resumo = texto ≤ 1.000, `blocos`
   = linhas "título: valor formatado" dos blocos número/tabela, ≤ 600).
9. **Origem em turno antigo**: `no` abre como hoje; em `livre`, `ref` e `termo` o painel mostra antes a nota
   "Este valor é de 26/11/2026; a origem abaixo é a de hoje."
10. **Salvo ou não**: se o `inicio` vier com `registro` nulo, o turno mostra discretamente "Não foi possível salvar
    no histórico."
11. Aviso do campo: "As conversas ficam no seu histórico e ajudam a melhorar a Análise. Limite de 50 perguntas por
    dia." O botão "Nova análise" sai (vira "Nova conversa").
12. Catálogo `#/componentes`: acrescente o que for componente novo.

## Testes obrigatórios

- PGlite da 075 com os mutantes (Parte A.8) e a 074 ainda verde.
- `worker/tests`: `conversa` no corpo (válido, inválido), `inicio` com conversa/ordem, conclusão com o header da
  service role e **sem** ela quando a chave falta, chave falsa ausente de tudo que sai, `blocos` dos anteriores
  mascarados.
- `app/tests`: lista (ok, falha com aviso), regra "hoje abre a última / senão nova com Continuar" (com data fixa),
  nova conversa recebendo o id do `inicio`, rascunho por conversa, `anteriores` = 2 últimos turnos ok, excluir com
  confirmação, nota de origem em turno antigo, "Não foi possível salvar no histórico".
- Gates no fim: `npm run lint`, `npm test`, `npm --prefix app test`, `npm --prefix app run build`,
  `npm --prefix worker test`, `npm --prefix worker run build:edge`, `node tools/replica-local/rodar-075-pglite.mjs`
  e `node tools/replica-local/rodar-074-pglite.mjs`. Teste que só confirma o que o código faz (tautológico) não conta.

## Revisão (obrigatória) e fechamento

1. Quando tudo estiver construído e os gates verdes, **chame o subagente `revisor-minimax`** (ferramenta de
   subagente do opencode; está em `.opencode/agent/` deste worktree). A frase "Nao chame outras IAs" do comando
   que abriu esta sessão proíbe IAs **fora** do opencode; o subagente faz parte dele e o Victor pediu que ele
   revise. Mande para ele: o caminho desta tarefa, a lista de arquivos alterados (`git diff --stat master`) e o
   pedido de achados com arquivo:linha e gravidade, olhando em especial: RLS/ACL/guardas e atributos das funções;
   conversa alheia em todas as RPCs; service role nunca saindo do servidor; backfill; retenção; contrato do SSE;
   regras visuais; testes que realmente reprovam o defeito.
2. Confira cada achado no código. Corrija os procedentes, rode os gates de novo e, se as correções forem grandes,
   peça ao revisor uma segunda olhada **só nas correções** (no máximo 2 revisões).
3. Escreva `docs/redesenho/relatorios/analise-historico.md`: o que foi feito por parte, decisões tomadas sozinho e
   por quê, cada achado do revisor com o que você fez (corrigido / recusado e por quê), a saída resumida dos gates
   e o que ficou de fora. **Não edite o `ESTADO.md`** (quem fecha é o Claude).
4. Commit final na branch. Sua última mensagem: resumo curto do que entregou, commits, gates e pendências.

## Fora do escopo (anotar no relatório, não fazer)

- Esconder turnos de centros a que a pessoa perdeu acesso (pré-requisito antes de abrir a Análise para professores).
- Exportação (XLSX/imagem), resumo automático da conversa, detecção de mudança de assunto.
- Retenção separada para material de feedback enviado à equipe.
