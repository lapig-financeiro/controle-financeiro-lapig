# Estado do redesenho — documento vivo

> **Para quem retoma (pessoa ou IA):** leia este arquivo primeiro. Ele diz onde o trabalho está, o que foi
> combinado com o Victor e o próximo passo. O plano é [`README.md`](README.md); a estética,
> [`estetica.md`](estetica.md). Atualize este arquivo **a cada passo concluído ou decisão nova**, no mesmo
> commit do passo. Análises e retratos com dados reais ficam fora do git, em `NãoColocarNoGit/repensar-2026-11-18/`.

Última atualização: 25/11/2026 (folha atrasada na projeção das bolsas).

> **Nomes das frentes:** F3-A, F3-B e F3-C foram pedidos urgentes do Victor (termos do contrato, pedido de bolsas,
> motivo dos selos). Elas **não são** a "F3 — Leitura automática" do plano (README §6), que segue por fazer.
> Daqui em diante as frentes levam nome descritivo (ex.: "Projeção por rubrica"), sem letra de fase, e a tarefa
> fica em `tarefas/<nome-curto>.md`.

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
- Modo de trabalho (vale desde 19/11; o histórico está no README §7): executores = até 2 DeepSeek V4.1 Flash
  **max** pelo opencode, cada um no seu worktree em `C:/Users/amara/dev/`; testes e revisões = **MiniMax 3.1 Flash
  max** (sempre) e DeepSeek max (um com o projeto, outro cego); **GLM 5.3 evitar** (cota); no máximo 2 processos do
  Ollama ao mesmo tempo; Neon (agy) só a pedido do Victor. O Claude escreve a tarefa, acompanha, confere cada
  achado antes de virar correção, roda os testes e confere a tela no navegador.
- Banco de produção: simular e gravar em turnos separados, com o "pode gravar" do Victor; nunca mudar
  `projects.end_date` direto (é o botão da tela de termos).
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

| F3-A | **No ar desde 19/11: 067 aplicada** (run 44602502209) e 26 termos gravados em 10 centros (ver Registro). Datas de contrato de 30.099, 30.113 e 30.116 aplicadas pelo Victor no botão (19/11). Histórico da execução: migração 067 (`termos_contrato` só insert, 4 RPCs, roteiro PGlite com 8 mutantes) e a tela do `/v2/` (cabeçalho "do contrato"/"contrato diz"/"não está no cadastro", `taxa_total` × divisão sem correção, painel "Do contrato" com trecho, documento do Drive ou "Abrir o plano", nota do admin, conferir e usar a data). 2ª rodada incluiu `taxa_total` e `documento_id`; 3ª fechou o SELECT direto; 4ª aplicou `_tem_cpf` no gatilho, máscara de documento para não-admin, `vigencia_situacao`/`start_date` e as asserções fortes. `npx vitest run` 699 passou (5 pulados), `npm test --prefix app` 115 passou, `npm run lint` e `npm run build --prefix app` verdes. |
| Admin mínimo | **No ar em 20/11** (merge 96513e4; CI e deploy verdes; bundle do `/v2/` com a tela e sem dado de exemplo). Branch `redesenho/admin-minimo` (7c34031 + db69d7b). Tela `#/admin`: lista de logins (sem centro primeiro; Buriti e automação só leitura), painel com papel e centros, resumo "passa a ver / deixa de ver", confirmação em dois passos ao tirar centro ou rebaixar admin, o próprio admin não se rebaixa. Sem migração (lê `app_users`/`user_projects`/`projects`, grava por `save_user_assignments`). Executor: agy Orchestrator **Argon** (pedido do Victor, 20/11), 2 rodadas; revisões MiniMax max e DeepSeek max. App 190 testes, lint e build verdes; 2 mutantes conferidos pelo Claude; tela vista em 1400 e 390 px no modo exemplo. Aberto: dois admins ao mesmo tempo podem se sobrescrever; clicar na linha não abre o painel; medidas `rem` no CSS. Falta: o Victor abrir `#/admin` com o login dele. |
| Uso real | **20/11: a Mariana recebeu o acesso** ao `/v2/` (papel professor, 7 centros: 30.099, 30.109, 30.111, 30.113, 30.116, 30.117, 30.118). É a primeira pessoa de fora usando o site novo: o retorno dela orienta as próximas telas. Telas que ela vê: Projetos, página do projeto (dinheiro, rubricas com motivo do selo, "De onde vem", termos do contrato, pendências) e Bolsistas. Análise e Admin ainda dizem "em construção". |
| F3-B | **No ar em 20/11: 068 aplicada** (run 44649574063): tela "Bolsistas" do `/v2/` (montar pedido de bolsas: filtros de centro, equipe Pastagem/Alertas/Solos e situação; caixas com totais vindos da RPC; passo a passo no topo) e migração 068 (`bolsista_equipes`, `caixas_pedido`, `caixa_pedido_itens`, 8 RPCs, sem policy nem grant; lock por dono; agente e automação barrados). 3 rodadas; revisões MiniMax max e DeepSeek max resolvidas; PGlite com 17 mutantes. Login da Mariana criado e com os 7 centros (20/11). Ajustes da revisão final na 069. |
| F3-C | **No ar em 20/11: 069 aplicada** (run 44748685655): motivo nos selos de situação (balão no hover, foco e toque, na lista e nas rubricas), tarifa bancária sem previsão vira atenção com o motivo escrito (ILPF 30.116), `situacao_centro_v2` e ajustes da revisão da 068 (só põe na caixa quem está na lista, confirmação no "Tirar quem saiu da lista", dono no `for update`, lock ao apagar). 2 rodadas + ajustes do Claude; revisões MiniMax max (2) e DeepSeek max cego; PGlite com 10 mutantes. |
| Projeção das bolsas | **No ar em 23/11** (merge a49fb9e; deploy 45244076178 e CI 45244076287 verdes; sem migração). Responde "até quando as bolsas cabem": o menor entre o orçamento da rubrica de bolsas e o dinheiro em conta mês a mês (folha todo dia 07, desembolsos do plano já sem as taxas, cada bolsa posicionada pelo fim da janela da 066). Cartão "Bolsas por mês" com "Cabem até" (clicável), coluna "Cabe até" na tabela e no painel da rubrica, e seção na aba Dinheiro com botões "Contar" (desembolso futuro ligado; atrasado e rendimento desligados), gráfico SVG e tabela mês a mês. "Repasses" virou **"Desembolsos"**. Conta pura em `app/src/servicos/projecao.js` (sem RPC: vira RPC quando a IA precisar, na Análise). DeepSeek max em 2 rodadas + ajuste do gráfico pelo Claude; revisões MiniMax max e DeepSeek max. Conferida com dados reais (só leitura): 30.109 cabe até mar/27, abr/27 depende do desembolso 4 (R$ 3.111 faltando no dia 07); com rendimento, até set/27. Relatório `relatorios/projecao-bolsas.md`. |
| Folha atrasada | **Pronto no worktree `redesenho/folha-atrasada-tela` em 25/11 (sem push, sem migração)**. A tela aceita `folha_atrasada` e `folha_conferencia` da 070; a conta desconta a folha atrasada do caixa e do orçamento no 1º mês e a checagem da soma de bolsas deixa de acusar diferença. Tabela mês a mês ganhou a coluna "Folha atrasada" no 1º mês, o "Como a conta é feita" ganhou a frase da saída, e o painel da rubrica de bolsas diz "inclui R$ X de folha que ainda não apareceu no balancete de DD/MM". Modo exemplo: centro sintético 30.910 (Restinga Costeira Sul). Relatório `relatorios/folha-atrasada-tela.md`. Falta a 070 existir/aplicar e a revisão/publicação. |

## Próximos passos (proposta de 20/11; a ordem é decisão do Victor)
O que já está no ar: F0, F1, F2 (menos a F2-D), F3-A/B/C. O que falta do plano (README §6): F2-D, Admin, a F3
de verdade (leitura automática), F4 (o resto dos contratos), F5 (Análise) e o corte do site antigo.

1. **Ouvir a Mariana (contínuo).** Anotar aqui, na seção "Retorno de uso", o que ela estranhar ou pedir; defeito
   de tela vai na frente de tudo. Falta também conferir o `/v2/` com um login de professor de verdade (pendente
   desde a F0-A e a F1).
2. **Rotina de novembro** (`docs/rotina-mensal.md`, skill `rotina-do-mes`): quando a pasta "11 - Novembro 2026"
   aparecer no Drive. Esperando os balancetes do 30.106 e o do 30.110 depois de 03/11.
3. **Projeção por rubrica** (a F2-D do plano) — **no ar em 23/11** (ver tabela). Falta: ouvir o uso; a
   `calc_project_monthly` segue intocada até o corte.
4. **Admin mínimo** (README §2.4) — **no ar em 20/11** (ver tabela). Hoje o acesso da Mariana foi dado pelo Claude via `save_user_assignments`. A tela
   Admin dá ao Victor quem vê qual centro e o filtro da própria visão (o banco já tem `filtro_visao` e `centros_visiveis()` desde a 063), sem
   precisar de nós. Pequena e independente de 3: dá para correr em paralelo.
5. **Leitura automática** (a F3 do plano): Apps Script no Drive → Storage + `ingest_jobs` → repositório
   privado com os parsers → `aplicar_documento` ou pendência. É a frente maior; com ela a rotina do mês deixa de
   ser manual. Antes: decidir o repositório privado e o login `automacao`.
6. **Análise** (a F5 do plano): Worker + ferramentas + blocos com origem.
7. **Corte**: quando o `/v2/` cobrir o uso diário, o novo vai para `/` e o antigo sai. No corte: (a) o nome visível
   do sistema passa a ser **Buriti** (decisão do Victor, 23/11: título, cabeçalho e login; **o endereço e o nome do
   repositório não mudam**, porque o login mora no `localStorage` por endereço e o cofre usa o redirecionamento);
   (b) a IA é atualizada para o sistema novo (RPCs `*_v2`, termos de contrato, selos com motivo, pendências por
   projeto) e ganha nome próprio, já que "Buriti" passa a ser o sistema (ver pendência abaixo).

## Dívidas técnicas conhecidas
Os achados das revisões da 063 entraram na 064 e os da 064 na 065 (ver o cabeçalho de cada `.sql`). Ficam:
- `get_saldo_livre` (048) ignora rubrica só com previsto negativo ou só com estorno (pré-existente).
- Chave estável de `plano_rubricas` muda quando a descrição é editada: a folha da árvore volta a "legado" em
  silêncio.
- Nenhum centro tem `drive_folder_url` cadastrado: o botão do Drive na página do projeto não aparece.
- O que o backfill deixou "legado": contas redutoras (banco negativo, PDF positivo), linha repetida na quebra de
  página e o plano do 30.068 (não é DOCX). Documento registrado não aceita fato novo até existir
  `aplicar_documento`.
- Regra da tarifa bancária sem teto de valor (decisão aberta abaixo).

## Pendências com o Victor
- Ordem dos próximos passos (acima). A projeção por rubrica foi decidida e publicada em 23/11 (esboços em
  `NãoColocarNoGit/esbocos/`); vocabulário da tela: **desembolso**, não "parcela" nem "repasse".
- Nome da IA depois que o sistema virar "Buriti" (23/11). Hoje "Buriti" é o papel `agente`, o rótulo "Buriti (IA)"
  da tela Admin e as "pendências do Buriti"; na prática quem lê os e-mails e cadastra é o Claude, e as notas da
  atualização de documentos já saem como "Claude". Opção na mesa: a IA passa a se chamar pelo nome do modelo
  ("Claude") ou "assistente", e o papel `agente` fica como está no banco.
- Equipe (Pastagem/Alertas/Solos) de quem ficou sem: inspeção, estatístico e VANT (4), as duas gestoras de
  R$ 5.200 e 5 pessoas fora do plano do 30.111.
- Teto opcional para a tarifa bancária virar "atenção" (hoje vale qualquer valor, desde que o negativo caiba nela).
- Possível duplicidade 30.XXX × 30.121 "TJGO" (Kalungas).
- Contratos que não estão na pasta do Drive: 30.068, 30.088, 30.100, 30.110, 30.117 e 78.215 (pendências abertas).

## Retorno de uso
| Data | Quem | O que disse / o que fizemos |
|---|---|---|
| 20/11 | Victor (testando com o login da Mariana) | Filtro compacto e não fixo; botão "Montar caixas Alertas e Solos"; nomes em "Primeira maiúscula"; nome comprido não pode desalinhar a caixa — tudo feito no mesmo dia |

## Registro
| Data | O que aconteceu |
|---|---|
| 25/11 | **Folha atrasada na projeção** pronta no worktree `redesenho/folha-atrasada-tela` (sem push, sem migração): `dados.js` sanitiza `folha_atrasada`/`folha_conferencia`; `projecao.js` desconta a folha atrasada do caixa e do orçamento no 1º mês, corrige a checagem da soma e devolve o valor no mês e no retorno; a tela mostra a coluna "Folha atrasada" só quando > 0, a frase no "Como a conta é feita" e o "inclui R$ X..." no painel da rubrica. Exemplo: 30.910 sintético. Raiz 685/19 pulados, app 245, lint e build verdes. Relatório `relatorios/folha-atrasada-tela.md`. Depende da 070 (em paralelo) |
| 23/11 | **Projeção das bolsas no ar** (merge a49fb9e, deploy e CI verdes; bundle `index-Bd_dUCVx.js` com a seção e sem `example.org`). Esboços com números reais do 30.109 (fora do git) → Victor escolheu juntar as duas formas e chamar de "desembolso". 1ª rodada 4ead369 (DeepSeek max); revisões MiniMax max e DeepSeek max acharam bolsa posicionada errada quando começa/termina no meio da janela (alto, confirmado na 066), taxa 0,15% no texto, "Cabe até" só no painel de erro, nulo virando zero, frase ignorando o orçamento, data do centro anterior; 2ª rodada 05f7741 corrigiu com teste; o Claude corrigiu o gráfico que escalava o texto (e4a7d1e). Master: raiz 704, app 238, lint e build verdes. Também em 23/11: nome visível do sistema passa a ser **Buriti** no corte (link e repositório ficam) e o nome da IA vira pendência |
| 20/11 | Admin mínimo feito pelo agy Orchestrator (Argon), a pedido do Victor: 1ª rodada 7c34031; revisões MiniMax max e DeepSeek max acharam centro sem código derrubando a tela (alto), rebaixar admin sem confirmação, "Marcar todos" pegando encerrados escondidos, reabrir durante a recarga e foco da confirmação; 2ª rodada db69d7b corrigiu tudo com teste. Dados reais conferidos só leitura: 5 logins, 21 centros, todos com código |
| 20/11 | Victor enviou o acesso do `/v2/` à Mariana. ESTADO revisto: linhas velhas (F3-A, próximos passos, notas da 064/065) trocadas por "Próximos passos", "Dívidas técnicas" e "Pendências com o Victor" atuais |
| 20/11 | **069 aplicada** com o ok do Victor (F3-C; master 7db4edb, ensaio 44746974367, aplicar 44748685655, aprovação cbf79c0860667bed, manutenção ligada e desligada). Conferida pela API: resumo 200 com `motivos` nos 11 centros; 30.116 em atenção pela tarifa (R$ 14,34); 30.088 e 30.095 seguem em problema (CIP/DAO acima do previsto) com a tarifa deles separada; `situacao_centro_v2` 200; anon 401; `_situacao_centro` 403; `get_pedido_bolsas_v2` 200 (137 bolsistas) |
| 20/11 | F3-C revisão final (MiniMax max): 14 itens da 2ª rodada corrigidos, nada impede aplicar; o Claude corrigiu os 3 achados de app (um balão por vez, ordem da regra antiga sem a RPC nova, textos do exemplo) com teste que falha sem a correção (`afbb2ca`, app 173 testes). Datas de contrato: conferido pela API que o Victor já aplicou pelo botão em 19/11 as de 30.099 (11/02/2027), 30.113 (30/04/2027) e 30.116 (01/04/2027); deixam de ser pendência. Falta: publicar no master, ensaiar e aplicar a 069 com o ok do Victor |
| 20/11 | F3-C 2ª rodada (revisões MiniMax max e DeepSeek max cegas de `4c7dbc4`, conferidas pelo Claude): saldo negativo agora separa gasto de compromisso, motivo da tarifa leva `valor` (o negativo) e `tarifa` (Y), helper usa o `balancete_id` da 066, `grupos` malformado vira `sem dado`/`falha`, falha só do helper mantém `livre`/situação com motivo literal, asserções ancoradas em `position()` e lock completo antes do `delete`; no app, clique/toque no selo alterna sem navegar, balão com atraso de 150 ms e hover, aviso de falha da RPC nova e motivo inválido descartado. PGlite 10 mutantes, app 171 testes, raiz 699, lint/build verdes; Chrome em 1400 (mouse) e 390 (toque). Sem push, sem aplicar |
| 20/11 | F3-C pronta no worktree `redesenho/f3-c-069` (sem push, sem aplicar): 069 (`_situacao_centro` com tarifa bancária em atenção, `motivos` no resumo, `situacao_centro_v2`, `colocar` só pela lista do pedido, dono no `for update` das seis RPCs, ordem de origem/`saiu_de` e lock ao apagar) e app (balão no selo com hover/foco/Esc, confirmação em dois passos, `editarItemCaixa` pt-BR). PGlite 6 mutantes, test_068 depois da 069, app 167 testes, raiz 699, lint/build verdes; Chrome em 1400/390 na lista e na tabela. Falta revisão e ok para ensaiar/aplicar |
| 20/11 | Bolsistas, pedido do Victor depois de testar com o login da Mariana: filtro compacto e não mais fixo; botão "Montar caixas Alertas e Solos" (cria as caixas de quem clica e põe quem é da equipe e tem bolsa vigente). Equipes do 30.111 gravadas pelo plano de trabalho (MapBiomas/IAMAP), com o "pode gravar": 68 Alertas, 9 Solos (pelo nome no plano, ou pelo valor R$ 900/700). Sem equipe até o Victor decidir: inspeção, estatístico e VANT (4), gestoras R$ 5.200 (2), outros 5 fora do plano |
| 20/11 | Login da Mariana (criado pelo Victor no Supabase) recebeu papel professor e os 7 centros (30.099, 30.109, 30.111, 30.113, 30.116, 30.117, 30.118) por `save_user_assignments`, com o "pode gravar" do Victor; conferido: 7 centros |
| 20/11 | **068 aplicada** com o ok do Victor (F3-B, tela Bolsistas; master af7b859, run 44649574063, manutenção ligada e desligada). Conferida pela API: RPC 200 para admin (137 bolsistas, 11 centros), 401 sem login, tabelas 403. Revisão final MiniMax: nada bloqueava; 2 médios para a 069 |
| 19/11 | F3-B pronta e publicada no master (pedido de bolsas da Mariana: tela Bolsistas + 068). Victor confirmou os 7 centros dela (30.099, 30.109, 30.111, 30.113, 30.116, 30.117, 30.118). 068 vai ao ensaio |
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
| 19/11 | Termos do contrato gravados com o ok do Victor (simulação e gravação em turnos separados): 23 termos em 9 centros (autor Claude, origem IA, trecho e documento) e 8 pendências tipo contrato. Situação: confere 30.095, 30.109, 30.114, 30.118; diverge 30.099 (contrato 11/02/2027), 30.113 (30/04/2027), 30.116 (01/04/2027) e 30.103 (vigência 30/03/2027, gasto só até 31/12/2026: manter cadastro); 30.106 só taxa. Nenhum `end_date` foi mudado: a troca é decisão do Victor pelo botão. Faltam 30.068, 30.110, 30.111, 78.215, 30.XXX; contrato fora da pasta em 30.088, 30.100, 30.117. Levantamento fica fora do repositório (cláusulas de confidencialidade) |
| 19/11 | Segunda leva gravada com o ok do Victor: 3 termos do 30.111 (contrato IAMAP lido por OCR local: vigência 01/01/2026 a 31/01/2027, cadastro 31/12/2026; taxa total 12%; prorrogação não entra) e 5 pendências: 30.111 (diverge), 30.110 (só minuta), 30.068 (outorga fora da pasta), 78.215 (termo não achado), 30.XXX (possível duplicidade com 30.121 "TJGO"). Total: 26 termos em 10 centros, 13 pendências de contrato abertas. Nenhum `end_date` mudado |
| 19/11 | Rotina do mês escrita (`docs/rotina-mensal.md` + skill do projeto `rotina-do-mes`): Drive pelo conector (`Saldo/<MM - Mês AAAA>` e pastas dos centros), simular e gravar balancetes, planos, bolsas e termos com os scripts existentes, backfill só nos novos, vigências/parcelas/pendências, resumo ao Victor. Ainda não rodada: a última pasta de saldo é "10 - Outubro 2026". Busca ampla no Drive não achou os contratos de 30.068, 30.088, 30.100, 30.110, 30.117 e 78.215 (as pendências seguem). Tela dos termos não conferida no navegador (pede o login do Victor); pela API a RPC devolve os 10 centros |
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
