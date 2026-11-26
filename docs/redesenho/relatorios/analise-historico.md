# Histórico de conversas da Análise (075) — 26/11/2026

Tarefa: [`../tarefas/analise-historico.md`](../tarefas/analise-historico.md). Branch
`redesenho/analise-historico`, worktree `C:/Users/amara/dev/cf-analise-historico`.
Executor: DeepSeek V4.1 Flash max (opencode). Revisor: MiniMax 3.1 Flash max
(subagente `revisor-minimax` do opencode). Nada foi publicado, aplicado no banco ou
tocado em produção; a migração 075 está marcada como **não aplicada** em
`docs/migracoes.md`.

## 1. O que foi feito

### Parte A — migração `database/075_analise_historico.sql`

- `analise_conversa`: `id`, `user_id`, `titulo` (1–120 depois do `btrim`),
  `criada_em`, `atualizada_em`; índice `(user_id, atualizada_em desc)`; RLS ligado
  **sem policy**; `revoke all` de `public`/`anon`/`authenticated`; `trg_bloqueia_agente`
  de statement sem `WHEN`.
- `analise_registro` ganha `conversa_id` (FK `on delete cascade`) e `ordem`; o
  backfill cria uma conversa própria para cada registro antigo (título = 80
  primeiros caracteres da pergunta com espaços colapsados; `criada_em =
  iniciada_em`; `atualizada_em = coalesce(terminada_em, iniciada_em)`; `ordem = 1`).
  Depois do backfill as duas colunas são `not null`; índice e unicidade
  `(conversa_id, ordem)`; `ordem >= 1`.
- `analise_registro_iniciar(p_pergunta, p_anteriores = 0, p_modelo = null,
  p_conversa = null)` devolve `{ registro, conversa, ordem }`. Sem `p_conversa`,
  cria a conversa e `ordem = 1`; com `p_conversa`, exige que seja do `auth.uid()`
  (42501 para alheia/inexistente), trava a linha da conversa com `for update`,
  usa `max(ordem) + 1` e sobe `atualizada_em`. **Não há mais o delete de 180
  dias**; o freio de 200 registros em 24 h continua. A versão antiga
  `(text, integer, text)` foi dropada; o grant é só para `authenticated`.
- A `analise_registro_concluir` antiga foi dropada. Nasce
  `analise_registro_concluir_servidor(p_user, p_id, …)`, `security definer`, com
  a guarda `auth.role()` da credencial de servidor (42501 caso contrário), as
  mesmas validações da 074 (desfecho, 256 KB, código ≤ 64), conclusão única da
  linha `id = p_id and user_id = p_user and terminada_em is null` (alheia 42501,
  já concluída 22023) e `analise_conversa.atualizada_em = now()`. `revoke all` de
  `public`/`anon`/`authenticated`; `grant execute` **só** para a credencial de
  servidor.
- Leitura/gestão do dono: `analise_conversas_listar` (limite 1–100, padrão 30,
  paginação `atualizada_em < p_antes`, `turnos` = contagem), `analise_conversa_ler`
  (turnos em `ordem asc`, **sem `passos`**, `desfecho_calculado` com a regra de 3
  min e o último `feedback {nota, motivo}`), `analise_conversa_renomear` e
  `analise_conversa_excluir` (cascade nos registros e feedbacks). Alheia ou
  inexistente é sempre 42501.
- `analise_registros_admin` recriada com os mesmos atributos e a guarda
  `is_admin()`; a saída passa a incluir `conversa_id` e `ordem` (via `to_jsonb`).
- Roteiro `tests/sql/test_075_analise_historico.sql` e executor
  `tools/replica-local/rodar-075-pglite.mjs`: provei o comportamento antigo da
  074 (abrir/concluir pela pessoa logada), a ausência da 075 por 42P01, o
  backfill (duas conversas próprias, títulos/datas, nada órfão), o roteiro
  completo, a idempotência, ACL/atributos, o BLOCO 1 da 051 e **8 mutantes**:
  sem RLS, grant a `anon`, `iniciar` aceitando conversa alheia, `ler` sem dono,
  `excluir` sem dono, `concluir_servidor` com grant a `authenticated`, delete de
  180 dias de volta e backfill deixando registro sem conversa.
- Linha nova em `docs/migracoes.md`, marcando "não aplicada".

### Parte B — núcleo (`worker/src` e Edge Function)

- O corpo do `POST /analise` aceita `conversa` (uuid; formato inválido → 400) e
  cada item de `anteriores` aceita `blocos` (texto ≤ 600). O teto de 5
  `anteriores` e o teto de 100.000 bytes do corpo continuam.
- `analise_registro_iniciar` é chamada com `p_conversa` quando há conversa (e
  omite o parâmetro quando é nova, para continuar compatível com a 074 durante a
  janela de deploy). O evento `inicio` passa a `{ registro, conversa, ordem }`,
  com os três nulos quando o registro falha; continua sendo o primeiro evento e
  só sai depois de login e limite. O retorno do cliente SSE também carrega os
  três campos.
- `analise_registro_concluir_servidor` é chamada com a credencial de servidor:
  a Edge lê `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` em
  `supabase/functions/analise/index.ts` e passa ao núcleo como `serviceRoleKey`;
  `p_user` é o `auth.usuario.id` que o núcleo conferiu. A chave não entra em
  resposta, SSE, log, erro, registro nem teste com valor real. Sem a chave
  (Worker da Cloudflare), o fechamento é pulado em silêncio (`{ ok: false,
  pulado: true }`), sem rede.
- `laco.js` inclui os `blocos` dos anteriores no prompt, mascarados pela mesma
  `mascararEntrada` da pergunta e do resumo e cortados em 600 depois da máscara.
- Contrato §7 e `worker/README.md` atualizados. `npm --prefix worker run
  build:edge` continua passando.
- Testes do Worker: `conversa` válida/inválida no corpo, `inicio` com
  conversa/ordem, conclusão com o header da credencial de servidor e sem ela
  quando a chave falta, chave falsa ausente do que sai, `blocos` mascarados e
  cortados, e a bancada simulando a Edge (token de servidor só na conclusão).

### Parte C — tela `#/analise`

- Serviços novos em `app/src/servicos/analiseHistorico.js` (`listarConversas`,
  `lerConversa`, `renomearConversa`, `excluirConversa`) no padrão `{ dados, erro }`;
  falha de consulta devolve `dados: null` e a tela mostra `AvisoFalha` com
  "Tentar de novo" — nunca lista vazia. No modo exemplo, as equivalentes em
  `analiseExemplo.js` têm duas conversas sintéticas (uma de hoje, uma de ontem) e
  o envio cria conversa/turno exemplares para a lista recarregar de verdade.
- Layout: coluna de conversas (~280 px, token `--largura-conversas`) a partir de
  1024 px, com "Nova conversa" no topo e itens título + "hoje, 14h32"/"ontem"/"25/11";
  abaixo de 1024 px, botão "Conversas" que abre a mesma lista num
  `PainelLateral`. O componente novo `ListaConversas` entrou no catálogo
  `#/componentes`.
- Conversa contínua: turnos do mais antigo ao mais novo; o campo fica embaixo,
  `position: sticky`, no fim da área da conversa (a rolagem é da página; ver
  §6, rodada 2). Enter envia,
  Shift+Enter quebra; ao enviar, rola até o fim.
- Abrir `#/analise`: carrega a lista; se a conversa mais recente teve atividade
  hoje (fuso `America/Sao_Paulo`), abre essa; senão abre uma conversa nova vazia
  com "Sua última conversa foi em 25/11: «título»" e "Continuar".
- "Nova conversa" limpa a área e só cria no banco no primeiro envio (`conversa:
  null`); o id chega no `inicio`, a lista recarrega e o turno migra para a
  conversa criada. Rascunhos ficam por conversa em memória e sobrevivem à troca
  de conversa e à troca de aba do site (o `App` mantém a tela montada).
- Renomear pelo lápis no título e excluir com a confirmação "Excluir esta
  conversa? Não dá para desfazer."; depois de excluir, volta para uma conversa
  nova. Turno em andamento continua se a pessoa trocar de conversa e o resultado
  fica na conversa de origem.
- `anteriores`: os 2 últimos turnos `ok` da conversa aberta, com pergunta ≤ 500,
  resumo ≤ 1.000 e `blocos` = linhas "título: valor formatado" dos blocos
  número/tabela, ≤ 600.
- Turno carregado mostra "Respondida em 26/11/2026, às 14h32" e não mostra passos
  nem feedback; turno ao vivo continua com passos, Parar e feedback. Em origem
  `livre`, `ref` e `termo` de turno antigo, o painel mostra antes "Este valor é
  de 26/11/2026; a origem abaixo é a de hoje." (`no` abre como hoje; no `ref` com
  documento, a nota entra no bloco "Nota" da janela do documento).
- `inicio` com `registro` nulo mostra "Não foi possível salvar no histórico.";
  o aviso do campo virou "As conversas ficam no seu histórico e ajudam a
  melhorar a Análise. Limite de 50 perguntas por dia." e "Nova análise" virou
  "Nova conversa".
- Testes novos em `app/tests/analise-historico.test.jsx` e
  `analise-historico-servico.test.js`, além dos ajustes de contrato em
  `analise.test.js`, `analise-tela.test.jsx`, `analise-exemplo*.test.js`.

### Conferência visual (rodada 1)

Além dos testes, subi o modo exemplo (`npm --prefix app run dev:exemplo`) e
conferi a tela no Chrome headless. A captura real a 390 px CSS (via
`Emulation.setDeviceMetricsOverride`, porque o `--window-size` do Windows em
125% entrega um viewport CSS de 504 px e recorta a imagem) mostra o conteúdo
dentro da largura, o campo fixo embaixo e a lista no painel. A captura de 1280 px
mostra a coluna de conversas, o turno carregado com a data e o campo fixo. **A
medição final do layout, depois da rodada 2, está no §6.**

## 2. Decisões tomadas sozinho (e por quê)

1. **O nome da credencial de servidor não aparece literal no `.sql`.** O cofre
   recusa a palavra `service_role` no texto (docs/aplicar-migracao.md). A guarda
   compara `auth.role()` com `'service' || '_' || 'role'` e o grant é feito num
   `DO/EXECUTE` que monta o mesmo nome. As asserções e o teste conferem o
   privilégio pelo nome completo. Efeito colateral esperado: o relatório do
   cofre vai pedir revisão técnica por causa do `DO/EXECUTE`
   (`docs/aplicar-migracao.md`).
2. **`p_conversa` omitido quando a conversa é nova.** Assim o Worker continua
   funcionando na janela entre o deploy do código e a aplicação da 075 (a 074
   não conhece o parâmetro). Quando há conversa, o parâmetro vai. O cliente de
   registro aceita tanto a resposta uuid da 074 quanto o objeto
   `{ registro, conversa, ordem }` da 075.
3. **`p_user` não é validado como uuid no cliente de registro.** O valor real da
   Edge é um uuid; o teste usa `u1` para não inventar um id de pessoa. A RPC
   recebe `uuid` e o Postgres recusa o que não for uuid; o fechamento é
   best-effort. A garantia que importa (só a credencial de servidor executa) é
   da 075.
4. **Feedback do teste da 075 com horários distintos.** Numa mesma transação
   `now()` é o início dela, então dois feedbacks inseridos por RPC no mesmo
   roteiro têm o mesmo `criado_em` e o "último" cairia no desempate por id
   aleatório. Em produção cada RPC é uma transação própria; no roteiro inseri os
   dois com `criado_em` explícito (`now()` e `now() + 1 s`) para provar a ordem
   de leitura de forma determinística. A RPC de feedback em si continua coberta
   pela 074.
5. **"Nova conversa" com análise em curso na conversa ainda sem id.** A regra
   "limpa a área" vale, menos quando há uma análise rodando naquele espaço
   `nova`: nesse caso o turno fica, porque a conversa ainda não tem id e o
   resultado não pode sumir. Assim que o `inicio` traz o id, o turno migra para a
   conversa criada.
6. **Nota de origem do `ref` na janela do documento.** `livre` e `termo` têm
   painel onde a nota aparece antes; `ref` com documento abre a janela do
   `Documento` direto, então a nota entra no bloco "Nota" dessa janela (e no
   painel de carregamento/erro). É o lugar mais próximo de "o painel mostra
   antes" sem inventar um passo extra.
7. **O modo exemplo cria conversas e turnos de verdade em memória.** Sem isso a
   lista não recarregaria depois do `inicio` e a demonstração não mostraria o
   fluxo novo. O import dinâmico ficou atrás de `import.meta.env.DEV &&
   import.meta.env.VITE_DADOS === 'exemplo'` nas quatro funções; o chunk de
   exemplo **saiu** do build de produção (conferido: `dist/assets` não tem mais
   `analiseExemplo-*.js`).
8. **Token novo `--largura-conversas: 280px`.** A estética manda não espalhar
   medida literal; a tarefa pedia ~280 px. O valor ficou em `tokens.css`, como os
   demais.
9. **`ListaConversas` como componente.** A lista é usada na coluna e no painel;
   virou componente em `app/src/componentes/` e entrou no catálogo
   `#/componentes`, como a tarefa pede para componente novo.
10. **Rodada 1 — a tela usava a altura do viewport e rolava a conversa, não a
    página.** O `.analise` ocupava `100vh - --altura-topo` e a área de rolagem
    ficava entre o cabeçalho e o campo. **Substituído na rodada 2** (§6): a
    página rola e o compositor é `position: sticky` no rodapé da coluna.
11. **`test_074` não é rodado depois da 075.** A 075 dropa de propósito a
    `analise_registro_concluir` antiga; o roteiro da 074 é específico daquele
    estado. O executor da 075 prova o comportamento antigo antes de aplicar a
    075, e o `rodar-074` continua verde aplicando só a 074. Reaplicar o
    `074_analise_registro.sql` depois da 075 reprova nas asserções da própria
    074 (ela espera 10 checks e as 4 funções antigas; depois da 075 são 11
    checks e uma função a menos). Não ajustei `test_074` nem `rodar-074`; a
    explicação está aqui, como a tarefa pediu.
12. **O `npm --prefix mcp install` foi local.** O `npm test` da raiz importa
    `pdfjs-dist` de `mcp/`; o worktree não tinha `mcp/node_modules`. Instalei só
    para rodar o gate; nada versionado.

## 3. Achados do revisor

A revisão do `revisor-minimax` **não encontrou achado de gravidade alta**: nenhum
furo de RLS/ACL, nenhuma conversa alheia vazando, nenhuma saída da chave de
servidor. Os achados e o que fiz com cada um:

1. **Médio — janela entre aplicar a 075 e publicar a Edge nova.** A 075 dropa a
   `analise_registro_concluir` que a Edge em produção ainda chama; a Edge nova
   chama a `concluir_servidor`, que só existe depois da 075. Nos dois sentidos da
   janela o fechamento falha em silêncio (best-effort) e o registro fica
   `cortada`. **Aceito como passo operacional obrigatório**, não como mudança de
   código: a 075 só entra com a manutenção ligada e a Edge nova no ar na mesma
   janela, e só se desliga a manutenção depois de uma pergunta real conferida na
   `analise_registros_admin` com `terminada_em` preenchido e `desfecho = 'ok'`.
   Está na seção 4.
2. **Médio — nota de origem em turno de hoje.** `notaDeOrigemDoTurno` mostrava a
   nota em qualquer turno carregado. **Corrigido**: agora compara a data do turno
   com `mesmoDiaBrasilia` e só mostra quando é outro dia. Teste novo: turno de
   20/11 mostra "Este valor é de 20/11/2026…"; turno de hoje não mostra a nota.
3. **Baixo-médio — grant dinâmico e papel ausente.** O grant precisa ser montado
   com `||` (o cofre recusa a palavra), mas a migração não dizia o que faltava se
   o papel não existisse. **Corrigido**: um `DO` anterior confere `pg_roles` e
   para com "075: a credencial de servidor do Supabase não existe neste banco."
   O grant continua dinâmico; o relatório do cofre vai pedir revisão técnica por
   causa do `DO/EXECUTE`, como já previsto em `docs/aplicar-migracao.md`.
4. **Baixo — paginação com empate em `atualizada_em`.** O texto da tarefa pede
   `atualizada_em < p_antes`; dois registros no mesmo instante podem pular um
   item na página seguinte. **Aceito como limite conhecido**: a tela carrega 30
   e não pagina; se a lista crescer, a paginação vira tupla
   `(atualizada_em, id) < (p_antes, p_antes_id)`. Não mudei a assinatura porque
   ela é o contrato pedido.
5. **Baixo — quebra de linha perdida em `Componentes.jsx`.** **Corrigido**; o
   array `MESES_PROJECAO_CATALOGO` voltou ao formato de uma linha por mês, sem
   ruído no diff.
6. **Baixo — nomes velhos da conclusão.** **Corrigido** no cabeçalho de
   `worker/src/laco.js` e na seção da bancada do `worker/README.md`; ambos agora
   dizem `analise_registro_concluir_servidor`/074-075.
7. **Baixo — reaplicar a 074 depois da 075 reprova.** É consequência deliberada
   do drop da `concluir` antiga e dos 11 checks (a 074 espera 10): a 074 passa a
   depender da ordem. **Documentado** na decisão 11; não ajustei os roteiros,
   como a tarefa autoriza, porque o `rodar-074` isolado continua verde.
8. **Baixo — `listarConversas` não usa `mensagemDaRpc`.** **Recusado**: um 42501
   na lista não é "esta conversa não está mais disponível" (não há conversa
   específica); é falta de login/papel, e a mensagem genérica "Não foi possível
   carregar as conversas." é a correta. As outras três RPCs têm uma conversa
   concreta e usam a mensagem específica.
9. **Observação — stub de `auth.role()` mais estreito.** **Corrigido**: o stub
   do PGlite agora lê `request.jwt.claim.role` e, no fallback, o JSON
   `request.jwt.claims` (como o Supabase). O bloco de serviço do roteiro usa o
   JSON para provar o caminho de fallback.
10. **Observação — trabalho pendente no `git status`.** **Corrigido** no commit
    final, com este relatório versionado; o `ESTADO.md` não foi tocado, como a
    tarefa manda.

## 4. Antes de aplicar em produção (fora desta tarefa)

A 075 **não foi aplicada** e nada foi publicado. Quando o Claude for aplicar,
a ordem segura é:

1. Publicar o commit no `master` com a Edge Function nova, mas **manter a
   manutenção ligada** (`frontend/manutencao.json`).
2. Ensaiar e aplicar a 075 pelo cofre. O cofre vai pedir revisão técnica por
   causa do `DO/EXECUTE` do grant; o resumo ao Victor precisa dizer que o efeito
   é "grant de execução da conclusão só para a credencial de servidor".
3. Publicar/republicar a Edge Function `analise` com a
   `SUPABASE_SERVICE_ROLE_KEY` disponível no ambiente (o Supabase a injeta).
4. Com a manutenção ainda ligada, fazer **uma pergunta real** e conferir
   `analise_registros_admin`: o registro tem de ter `terminada_em` preenchido e
   `desfecho = 'ok'`, e o `inicio` da tela tem de ter `conversa`/`ordem`. Só
   então desligar a manutenção.
5. Rodar `node tools/replica-local/rodar-075-pglite.mjs` e
   `node tools/replica-local/rodar-074-pglite.mjs` de novo como conferência
   local; o primeiro cobre o backfill e os 8 mutantes, o segundo a 074 isolada.

Sem a credencial (Worker da Cloudflare), o fechamento é pulado de propósito; a
tela continua funcionando e o turno fica sem conclusão, como qualquer falha
best-effort. Não tire a manutenção antes do passo 4.

## 5. Gates

Saída resumida (última execução verde):

| Gate | Resultado |
|---|---|
| `npm run lint` | limpo |
| `npm test` (raiz) | 54 arquivos, **933 passaram**, 5 pulados |
| `npm --prefix app test` | 34 arquivos, **365 passaram** (365 depois da rodada 2) |
| `npm --prefix app run build` | guarda de estilo ok, Vite ok, verificação de build ok (sem dado de exemplo; sem chunk `analiseExemplo`) |
| `npm --prefix worker test` | 15 arquivos, **211 passaram** |
| `npm --prefix worker run build:edge` | `nucleo.gerado.js` (186.582 bytes) |
| `node tools/replica-local/rodar-075-pglite.mjs` | verde: ausência 42P01, comportamento antigo, backfill, roteiro, idempotência, ACL/atributos, barreira 051, **8 mutantes** |
| `node tools/replica-local/rodar-074-pglite.mjs` | verde: 7 mutantes (a 074 isolada) |

Observação: quando rodei `npm --prefix app test` em paralelo com a raiz e o
Worker, o teste `bolsistas.test.jsx` (não relacionado a esta tarefa) estourou o
timeout de 5 s; a suíte do app sozinha passou **364/364**. É o mesmo tipo de
falha intermitente de disco/CPU já anotado no `ESTADO.md` para testes alheios à
Análise; não alterei esses testes. O gate final é a execução limpa.

## 6. Rodada 2 — layout da conversa (26/11/2026)

O Claude conferiu a entrega no navegador, em modo exemplo, e aprovou migração,
núcleo e fluxos. Só o layout da conversa ficou apertado: a área tinha rolagem
própria (~330 px úteis em 1280×800) e o cartão do campo, alto, cobria metade da
resposta. Esta rodada mexeu só em CSS/marcação, sem revisor (como pedido).

- **Rolagem**: a área da conversa não tem mais `overflow`/altura fixa; quem rola
  é a página. A `.analise__rolagem` saiu do JSX e do CSS.
- **Campo**: o compositor é `position: sticky; bottom: 0` na coluna da conversa,
  com fundo `--cor-fundo`, borda de token e sem sombra. O `textarea` começa com
  duas linhas (`rows={2}`), cresce com o texto via `field-sizing: content` até
  8 linhas (`max-height` com `--lh-2`) e depois rola dentro dele. O rótulo
  "Pergunta" ficou só para leitor de tela (`sr-only`, ainda com `for`/`id`);
  o aviso é uma linha pequena (`--fs-1`). Em ≥1024 px o botão "Perguntar"/"Parar"
  fica ao lado do campo; abaixo, embaixo. No celular o aviso visível virou
  "Histórico salvo. Limite de 50 perguntas por dia." (a frase completa continua
  no desktop e no DOM).
- **Fim da lista**: um espaço de `--espaco-fim-conversa` (320 px) depois do
  último turno garante que ele fica acima do campo mesmo com o textarea no
  tamanho máximo; ao abrir uma conversa e ao enviar, a página rola até esse
  ponto.
- **Cabeçalho no celular**: "Conversas", título e Renomear/Excluir na mesma
  faixa; o título trunca com reticências e os botões viram ícones com
  `aria-label` abaixo de 640 px. Em ≥1024 px a coluna da esquerda substitui o
  botão "Conversas".
- **Medições no navegador** (Chrome, viewport CSS real via
  `Emulation.setDeviceMetricsOverride`): em **1280×800**, a área de conversa
  acima do campo tem **452 px** no topo da página (496 px desde o topo da
  coluna) e a abertura rola até o último turno; em **375×812**, **418 px** no
  topo (430 px desde o cabeçalho da conversa). O campo de 2 linhas mede 56 px
  (58 px no celular); no máximo, 176 px (8 linhas). Os alvos de ~450 px e
  ~400 px foram atendidos. A barra do topo a 375 px continua cortando
  "Admin"/sino/avatar — é anterior a esta tarefa e vale para as outras telas.
- **Teste**: além dos ajustes, um teste garante que o `<label>` "Pergunta"
  continua associado ao campo, com a classe `sr-only`, e que o campo tem
  `rows="2"`.
- **Gates da rodada**: `npm run lint` limpo, `npm --prefix app test` **365
  passaram**, `npm --prefix app run build` verde (guarda de estilo e build sem
  dado de exemplo). Migração, núcleo e PGlite não mudaram nesta rodada.

## 7. Fora do escopo (não feito)
- Esconder turnos de centros a que a pessoa perdeu acesso (pré-requisito antes de
  abrir a Análise para professores).
- Exportação (XLSX/imagem), resumo automático da conversa, detecção de mudança de
  assunto.
- Retenção separada para material de feedback enviado à equipe.
- Paginação visível na lista (o RPC aceita `p_antes`, mas a tela carrega a
  primeira página de 30; não há "carregar mais"). O filtro é o `atualizada_em <
  p_antes` pedido na tarefa; dois itens no mesmo instante podem pular um na
  página seguinte. Sem impacto hoje porque a tela não pagina; se a lista
  crescer, a paginação vira tupla `(atualizada_em, id) < (p_antes, p_antes_id)`.
- O corte do nome no cliente (pergunta 500, resumo 1.000, blocos 600) acontece
  antes da máscara do servidor; um nome cortado exatamente no limite pode não
  casar com o dicionário. É o mesmo limite que os `anteriores` da 074 já tinham e
  não foi ampliado aqui.
- A barra do topo a 390 px ainda corta o item "Admin"/sino/avatar com quatro
  links, filtro e usuário (é anterior a esta tarefa e vale para as outras telas;
  não mexi no componente compartilhado).
