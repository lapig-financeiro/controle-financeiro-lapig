# Estado do redesenho — documento vivo

> **Para quem retoma (pessoa ou IA):** leia este arquivo primeiro. Ele diz onde o trabalho está, o que foi
> combinado com o Victor e o próximo passo. O plano é [`README.md`](README.md); a estética,
> [`estetica.md`](estetica.md). Atualize este arquivo **a cada passo concluído ou decisão nova**, no mesmo
> commit do passo. Análises e retratos com dados reais ficam fora do git, em `NãoColocarNoGit/repensar-2026-11-18/`.

Última atualização: 19/11/2026, tarde.

## Combinados com o Victor (não rediscutir)
- Menu: Projetos → página do projeto; Análise (área de trabalho com IA, não chatbot); Admin mínimo.
- Atividades sai. Sem caixa de entrada e sem aprovação: tudo entra automático; humano só em bloqueio.
- Pendências: lista única (por projeto + sino global). Mesma pessoa em dois planos = rotina do Buriti/Claude
  que vira pendência do Buriti para o Victor; nada manual.
- Admin: quem vê qual centro + **filtro da própria visão** (ocultar centros numa demonstração). Sem emulação.
- IA da Análise: **DeepSeek V4.1 Flash, esforço high** (Ollama Cloud), num Cloudflare Worker; todo número
  com origem; gráficos e exportação por etapas.
- Base nova com build (Vite + Preact em `app/`, publicada em `/v2/`) e identidade visual seguida à risca.
- Minutas no Drive: não se preocupar por agora.
- Vigia de e-mails: **encerrado** (19/11). O que funciona é o "Como estamos" diário com o Buriti; o Victor vai
  resumir o AGENTS.md e as pendências do Buriti depois.
- Modo de trabalho: executor = **Orchestrator (Neon)** no agy (`--model gemini-pro-orchestrator-neon`; nunca o
  `gemini-pro-orchestrator-g1-pro`, que é o Argon), desde 18/11 no lugar do Hydrogen (até dois em paralelo, sem arquivo em comum);
  o Claude acompanha e confere; fim de cada etapa = revisão de dois DeepSeek V4.1 Flash **max** (`#max`, pedido de 18/11; sempre, inclusive revisão de SQL para o cofre). Gemini e Ollama
  têm cota sobrando; a do Claude está apertada.
- **Desde 19/11:** executores = até 2 DeepSeek V4.1 Flash max; testes e revisões = MiniMax 3.1 Flash max (sempre) e
  GLM 5.3, além do DeepSeek max; no máximo 2 processos do Ollama ao mesmo tempo (cota do Ollama folgada). Neon só a pedido.
- Migração: só pelo cofre, com ok do Victor no chat para publicar e de novo para aplicar; manutenção ligada
  em toda aplicação.

## Onde está
| Item | Situação |
|---|---|
| Plano, estética, tarefas F0-A/F0-B | escritos e revisados por dois DeepSeek (correções em README §7b) |
| F0-A — migração 062 (arquivos por centro) | **aplicada em produção em 18/11** (run 44406913645, "tudo bate"); manutenção desligada; admin segue vendo os 3 buckets. Falta só um teste real com login de professor quando houver um à mão. |
| F0-B — esqueleto `app/` | **publicado em /v2/ em 18/11** (commit dfc7bd1; CI e deploy ok; conferido no ar: login, catálogo só com login, site atual intacto). Catálogo em dev: `.claude/launch.json` → `app-v2-dev`, `#/componentes`. |
| Vigia | **encerrado em 19/11** — sem acionadores; nenhuma checagem depois das 18:10 de 18/11 (conferido no banco) |
| F0-C — oráculo | retrato de `get_saldo_livre` dos 21 centros guardado fora do git (`oraculo-saldo-livre-2026-11-18.json`) |
| Redirect URL `/v2/` no Supabase | feito pelo Victor (18/11) |
| F1 | **Duas rodadas feitas e revisadas** (dois DeepSeek por frente, mutantes no teste da 063). Branch `redesenho/f1-a-banco` (worktree `C:/Users/amara/dev/cf-f1-a`, commits 7115e26 + 5c90495: migração 063, 41 KB, pglite verde) e `redesenho/f1-b-telas` (worktree `C:/Users/amara/dev/cf-f1-b`, 3eb05ca + 2f3ff1b: 54 testes, guarda de build sem dado de exemplo). Conferidas pelo Claude no navegador com dados de exemplo (`.claude/launch.json` → `f1b-exemplo`). **063 aplicada e telas publicadas no /v2/ em 18/11** (merge d2b8db8; CI e deploy ok; bundle no ar chama as RPCs novas e não tem dado de exemplo). **Falta:** o Victor abrir o /v2/ com o login dele e conferir com dados reais; teste com login de professor quando houver um. Pontos anotados para a F2: `get_saldo_livre` lê `balancetes` direto e tem `limit 1` sem ordem no plano ativo; nenhum centro tem `drive_folder_url` cadastrado (o botão do Drive não aparece). |

| F2 | **1ª leva pronta e juntada ao master local (19/11, merges e173316 e 55de075; sem push)**. F2-A: migração 064 (88,8 KB; `documentos`, `documento_versoes`, `fatos` com alvo estável, `registrar_documento_v2`, `get_origem_v2`, `explicar_livre_v2`, achados da 063), três rodadas (a 3ª pelo DeepSeek max, porque a cota do Gemini acabou); revisão final DeepSeek max sem achado alto; pglite verde com 8 mutantes. F2-C: "De onde vem" em árvore + Documento com pdf.js/mammoth sob demanda no /v2/, duas rodadas, 81 testes; conferida pelo Claude no modo exemplo (1280/390) e o pdf.js testado sob a CSP do build. Até a F2-B, toda folha real sai "legado" (documento aberto e linha procurada na hora). **064 aplicada em produção em 19/11** (run 44539521651, "Tudo bate"; raiz da árvore = livre ao centavo nos 19 centros, todos os nós fecham, ~0,1 s por centro; 280 folhas legado, 128 digitado, 0 documento até a F2-B; sem login 401) e telas publicadas no /v2/ (6265999). Falta o Victor ver com o login dele. 2ª leva: F2-B (backfill; o script tem de testar `_tem_cpf` por fato e deixar de fora os falsos positivos, senão um só derruba o documento inteiro) e F2-D (projeção por rubrica; definir com o Victor). Anotado para depois: `get_saldo_livre` (048) ignora rubrica só com previsto negativo ou só com estorno. Um teste do app falhou uma vez logo após `npm ci` no OneDrive e passou nas 9 execuções seguintes (provável tempo de disco frio). |

| F3-A | **Pronta no worktree `redesenho/f3-a-termos` em 19/11, sem push e sem aplicar**: migração 067 (`termos_contrato` só insert, 4 RPCs, roteiro PGlite com 8 mutantes) e a tela do `/v2/` (cabeçalho "do contrato"/"contrato diz"/"não está no cadastro", `taxa_total` × divisão sem correção, painel "Do contrato" com trecho, documento do Drive ou "Abrir o plano", nota do admin, conferir e usar a data). 2ª rodada incluiu `taxa_total` e `documento_id`; 3ª fechou o SELECT direto; 4ª aplicou `_tem_cpf` no gatilho, máscara de documento para não-admin, `vigencia_situacao`/`start_date` e as asserções fortes. `npx vitest run` 699 passou (5 pulados), `npm test --prefix app` 115 passou, `npm run lint` e `npm run build --prefix app` verdes. Falta: revisão do Victor e ok para ensaiar/aplicar a 067; depois publicar a tela. |

## Próximos passos
1. (feito) 062 aplicada e manutenção desligada em 18/11.
2. (feito) F0-B publicada em /v2/ (18/11).
   Era: commit de `app/`, workflows, eslint,
   `.gitignore`, `package.json` e `.claude/launch.json` (entrada `app-v2`).
3. (feito) Commit de `app/` + workflows com o ok do Victor.
4. (em curso) F1 delegada ao Neon (ver tabela). Era: escrever as tarefas da F1 (README §6 + §7b): pendências + `v_balancete_vigente`, página Projetos e do
   projeto, filtro de visão do admin; executores em worktrees fora do OneDrive.

## Para uma 064 (antes da F3, quando o Buriti passar a gravar pendências)
Revisão DeepSeek max da 063 final (18/11, sem achado alto). Médios: `contem_cpf` não pega CPF com espaço/traço
entre os grupos nem partido entre campos (fazer um invólucro local, sem tocar `contem_cpf`); `criar_pendencia_v2`
recusa centro inativo antes do upsert (quebra a idempotência de pendência já aberta); `project_id: ""` vira
pendência geral (devia ser erro); a asserção final não pega uma 2ª policy SELECT nem gatilho desligado/`WHEN`.
Baixos: gatilho de CPF revalida campos não alterados no UPDATE; índice em `resolvida_por`; `detalhe` NULL;
`btrim` sem `
`; erro de `p_id` nulo em `resolver_pendencia_v2`. Relatório completo no scratchpad da sessão
de 18/11 (`rev-063-max.jsonl`); refazer a revisão se ele sumir.

## Para uma 065 (antes do backfill da F2-B)
Revisões da 064 final (19/11: DeepSeek max e MiniMax 3.1 Flash max, nenhum achado alto). Médios: `_tem_cpf`/`_mascarar_cpf`
não pegam CPF com 5+ separadores fora da classe fixa (colapsar qualquer sequência de não dígitos entre dígitos antes do
`contem_cpf`, nas duas funções); `caminho` legado sai sem máscara junto com o `arquivo_nome` mascarado; a 1ª passada da
máscara troca qualquer 11 dígitos sem conferir o DV (atrapalha o `acharAlvo` no legado); `criar_pendencia_v2` recusa limpar
pendência legada com CPF (recusar só CPF novo, como o gatilho). Baixos: chave estável de `plano_rubricas` muda ao editar a
descrição (a folha volta a legado em silêncio); asserção "exatamente 1 policy" deve listar as que sobram; `explicar_livre_v2`
resolve origem folha a folha (lote por tabela); `max(versao)+1` sem trava; unificar mensagens de alvo inválido.
Pré-existente: `get_saldo_livre` (048) ignora rubrica só com previsto negativo ou só com estorno.

## Pendências com o Victor
- Nenhuma no momento.

## Registro
| Data | O que aconteceu |
|---|---|
| 19/11 | F3-A 4ª rodada (revisões MiniMax max e DeepSeek max): CPF robusto com `_tem_cpf` e gatilho definer `trg_termos_sem_cpf` (espaço/hífen/barra/quebra); metadado de documento mascarado para não-admin; `origem`/`autor` na idempotência; `vigencia_situacao` + `start_date_cadastro`; confirmação mostra início e fim; "De onde vem" recarregado; policy removida (RLS sem policy = default deny); asserções por conteúdo de cada CHECK; fixtures sintéticos; limites/NaN/página e URL do painel; runner exige 42P01. App 115 testes, PGlite com 8 mutantes, lint e build verdes. 067 segue não aplicada |
| 19/11 | F3-A 3ª rodada (achado de segurança): a 067 dava SELECT em `termos_contrato` a `authenticated`, então a `nota` (análise interna) vazava por `GET /rest/v1/termos_contrato?select=nota` mesmo com a RPC mascarando. Correção: `authenticated` sem nenhum acesso direto (só as RPCs definer); RLS/policy de SELECT mantidas como defesa em profundidade. Roteiro prova 42501 para anon, agente, professor e admin; runner com 8 mutantes. App não lia a tabela direto. 067 segue não aplicada |
| 19/11 | F3-A 2ª rodada no mesmo worktree (sem push, sem aplicar): `taxa_total` (percentual total do financiador, sem comparar com a divisão por rubrica) e `documento_id` (fonte em `documentos`, 064; pelo menos um entre URL e documento; metadado da versão mais recente para "Abrir o plano" no painel). Roteiro PGlite com 7 mutantes, app com 114 testes, lint e build verdes. 067 segue não aplicada |
| 19/11 | F3-A pronta no worktree `redesenho/f3-a-termos` (sem push, sem aplicar): 067 (termos do contrato só insert; RPCs de leitura, registro, conferência e uso da vigência) e a tela do `/v2/` (cabeçalho "do contrato"/"contrato diz", taxas e painel "Do contrato"). PGlite verde com 5 mutantes; app 111 testes, lint e build verdes. Falta: revisão e ok do Victor para ensaiar/aplicar |
| 19/11 | 2ª leva: 065 (ajustes da 064: regra única de CPF, caminho com CPF anulado, árvore em lote ~25% mais rápida) e F2-B (script de backfill, simulação por padrão) feitas por dois DeepSeek max, revisadas por MiniMax max e GLM 5.3 (nada alto), juntadas ao master local (4214b3a, b0c2229, 83a717b). Falta: ok do Victor para publicar e ensaiar a 065; aplicar; depois simular o backfill e, com ok, aplicar |
| 19/11 | 065 publicada (master bca4585), ensaiada e aplicada pelo cofre com o ok do Victor (run 44558084535, manutenção ligada e desligada); conferida pela API: raiz = livre nos 19 centros, todos os nós fecham, 81 ms médios. Falta: simular o backfill da F2-B e trazer as contagens; aplicar só com novo ok |
| 19/11 | Simulação do backfill na produção: 385 de 671 números achados. Causas: código de conta cortado nos balancetes novos e nomes de CIP/DAO nos planos. 4ª e 5ª rodadas (DeepSeek max; revisões MiniMax max e GLM 5.3, nada alto) usam `<prefixo>#<reduzido>` do raw_extraction e sinônimos fixos; nova simulação: 579 achados (balancetes 472/502, planos 107/169), 0 CPF, 0 divergência, 2 ambíguos. Juntado ao master (bdef65d). Ficam `legado`: contas redutoras (banco negativo, PDF positivo), linha repetida na quebra de página, plano do 30.068 (não é DOCX). Falta: ok para aplicar |
| 19/11 | Backfill aplicado na produção com o ok do Victor (master d05698a): 48 documentos, 579 fatos, 1 recusa (plano do 30.068, leitura). Conferido pela API: raiz = livre nos 19 centros, todos os nós fecham; folhas da árvore viva: 239 documento, 41 legado (eram 280), 128 digitado; `get_origem_v2` devolve página e bbox, URL assinada 200. O que ficou de fora espera a F3 (documento registrado não aceita fato novo) |
| 19/11 | **066 aplicada** com o ok do Victor (taxa CIP/DAO a reter vira comprometido; master e9e6c58, run 44576510098, manutenção ligada e desligada). Conferida pela API: raiz = livre nos 19 centros, todos os nós fecham, sem login 401; livre caiu R$ 544.503,40 em 10 centros (30.109 −137,6 mil; 30.113 −119,5 mil; 30.118 −85,4 mil; 30.068 −53,6 mil; 30.099 −53,2 mil; 78.215 −34,5 mil; 30.116 −29,6 mil; 30.111 −27,0 mil; 30.117 −4,1 mil; 30.110 −0,45) |
| 19/11 | F2-H publicada (master 7969a86): destaque "Dinheiro em conta" no topo do projeto do `/v2/` (saldo do último balancete, "inclui R$ X de rendimento" sem somar, os dois clicáveis até a linha do PDF). DeepSeek max executou; revisões MiniMax max e DeepSeek max (sem achado alto), 2ª rodada corrigiu os médios. GLM 5.3 deixa de ser usado (cota, pedido do Victor) |
| 19/11 | Contrato assinado do 30.099 (Drive, pasta "4. Acelen - 30.099", da conta da Mariana): vigência de **20 meses** da assinatura (27/05/2025) → 27/01/2027, igual ao banco; taxa UFG 8% + IESA 8% + FUNAPE 10% = 26% (R$ 180.180 de R$ 693.000). Base para a F3 (vigência e taxa com trecho do contrato) |
| 19/11 | **067 aplicada** com o ok do Victor (F3-A: termos do contrato com procedência; master 4182e44, run 44602502209, manutenção ligada e desligada). Conferida pela API: RPC 200 para admin, 401 sem login, tabela fechada (42501). Tabela vazia: falta registrar o levantamento (simular e gravar em turnos separados) |
| 19/11 | **064 aplicada em produção** com o ok do Victor (revisões DeepSeek max e MiniMax 3.1 Flash max, pedido do Victor); manutenção ligada e desligada |
| 19/11 | Vigia encerrado de vez (sem acionadores e sem republicação acidental); cartão `PC · Backup do cofre` corrigido no Painel |
| 19/11 | F2-A e F2-C revisadas, corrigidas e juntadas ao master local; Victor autorizou o DeepSeek max como executor da 3ª rodada da 064 (Gemini sem cota) |
| 19/11 | Victor: seguir para a F2. Tarefas F2-A e F2-C escritas, revisadas (DeepSeek max) e entregues a dois Neon |
| 18/11 | Três rodadas de análise (Claude, Hydrogen, DeepSeek); decisões acima |
| 18/11 | Vigia pausado; plano e estética escritos e revisados; F0-A e F0-B executadas; oráculo guardado |
| 18/11 | Victor autorizou publicar a 062 e configurou a Redirect URL do `/v2/` |
| 18/11 | 062 aplicada em produção; vigia confirmado parado; F0-B na 3ª rodada concluída |
| 18/11 | 4ª rodada da F0-B: Claude conferiu a 360 px; Neon corrigiu barra do topo e destaques |
| 18/11 | Victor autorizou e o /v2/ foi publicado (dfc7bd1) |
| 18/11 | Tarefas da F1 escritas, revisadas por dois DeepSeek e entregues a dois Neon em paralelo |
| 18/11 | Telas da F1 publicadas no /v2/ (d2b8db8) |
| 18/11 | **063 aplicada em produção** (run 44422809505, "tudo bate"); livre bate ao centavo nos 19 centros; manutenção desligada. Victor: revisões sempre com DeepSeek max |
| 18/11 | Victor autorizou publicar a 063; 1º ensaio falhou (ACL da view), 2º passou |
| 18/11 | F1-A e F1-B: 1ª rodada, revisão de fase (dois DeepSeek cada) e 2ª rodada concluídas |
| 18/11 | Victor trocou o executor: Orchestrator (Neon) no lugar do Hydrogen, a partir da F1 |
