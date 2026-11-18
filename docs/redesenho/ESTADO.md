# Estado do redesenho — documento vivo

> **Para quem retoma (pessoa ou IA):** leia este arquivo primeiro. Ele diz onde o trabalho está, o que foi
> combinado com o Victor e o próximo passo. O plano é [`README.md`](README.md); a estética,
> [`estetica.md`](estetica.md). Atualize este arquivo **a cada passo concluído ou decisão nova**, no mesmo
> commit do passo. Análises e retratos com dados reais ficam fora do git, em `NãoColocarNoGit/repensar-2026-11-18/`.

Última atualização: 18/11/2026, noite.

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
- Vigia de e-mails: **pausado** (18/11). O que funciona é o "Como estamos" diário com o Buriti; o Victor vai
  resumir o AGENTS.md e as pendências do Buriti depois.
- Modo de trabalho: executor = **Orchestrator (Neon)** no agy (`--model gemini-pro-orchestrator-neon`; nunca o
  `gemini-pro-orchestrator-g1-pro`, que é o Argon), desde 18/11 no lugar do Hydrogen (até dois em paralelo, sem arquivo em comum);
  o Claude acompanha e confere; fim de cada etapa = revisão de dois DeepSeek V4.1 high. Gemini e Ollama
  têm cota sobrando; a do Claude está apertada.
- Migração: só pelo cofre, com ok do Victor no chat para publicar e de novo para aplicar; manutenção ligada
  em toda aplicação.

## Onde está
| Item | Situação |
|---|---|
| Plano, estética, tarefas F0-A/F0-B | escritos e revisados por dois DeepSeek (correções em README §7b) |
| F0-A — migração 062 (arquivos por centro) | **aplicada em produção em 18/11** (run 44406913645, "tudo bate"); manutenção desligada; admin segue vendo os 3 buckets. Falta só um teste real com login de professor quando houver um à mão. |
| F0-B — esqueleto `app/` | 3 rodadas feitas (81 KB gz na abertura; 31 testes do app; sem estouro a 360 px); revisão de fase feita (dois DeepSeek + leitura visual do Hydrogen; decisões em `estetica.md` §6b). 4ª rodada (conferência visual do Claude a 360 px, correções pelo Neon) feita. **Falta:** ok do Victor para publicar (catálogo em dev: `.claude/launch.json` → `app-v2-dev`, `/controle-financeiro-lapig/v2/#/componentes`; em produção só admin logado vê) `app/` + workflows (ainda **sem commit**, no working tree). Conversa agy do executor: `0883799a-f793-4445-b301-a9c368df404c` |
| Vigia | **parado** — nenhuma checagem depois das 18:10 de 18/11 (conferido no banco) |
| F0-C — oráculo | retrato de `get_saldo_livre` dos 21 centros guardado fora do git (`oraculo-saldo-livre-2026-11-18.json`) |
| Redirect URL `/v2/` no Supabase | feito pelo Victor (18/11) |

## Próximos passos
1. (feito) 062 aplicada e manutenção desligada em 18/11.
2. F0-B: telas conferidas (4ª rodada); com o ok do Victor, commit de `app/`, workflows, eslint,
   `.gitignore`, `package.json` e `.claude/launch.json` (entrada `app-v2`).
3. Commit de `app/` + workflows (com ok do Victor para publicar, porque muda o deploy).
4. Escrever as tarefas da F1 (README §6 + §7b): pendências + `v_balancete_vigente`, página Projetos e do
   projeto, filtro de visão do admin; executores em worktrees fora do OneDrive.

## Pendências com o Victor
- Ok para publicar `app/` e a mudança do deploy (quando a F0 fechar).

## Registro
| Data | O que aconteceu |
|---|---|
| 18/11 | Três rodadas de análise (Claude, Hydrogen, DeepSeek); decisões acima |
| 18/11 | Vigia pausado; plano e estética escritos e revisados; F0-A e F0-B executadas; oráculo guardado |
| 18/11 | Victor autorizou publicar a 062 e configurou a Redirect URL do `/v2/` |
| 18/11 | 062 aplicada em produção; vigia confirmado parado; F0-B na 3ª rodada concluída |
| 18/11 | 4ª rodada da F0-B: Claude conferiu a 360 px; Neon corrigiu barra do topo e destaques |
| 18/11 | Victor trocou o executor: Orchestrator (Neon) no lugar do Hydrogen, a partir da F1 |
