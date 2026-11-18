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
- Modo de trabalho: executor = Gemini 4 Hydrogen High (até dois em paralelo, sem arquivo em comum);
  o Claude acompanha e confere; fim de cada etapa = revisão de dois DeepSeek V4.1 high. Gemini e Ollama
  têm cota sobrando; a do Claude está apertada.
- Migração: só pelo cofre, com ok do Victor no chat para publicar e de novo para aplicar; manutenção ligada
  em toda aplicação.

## Onde está
| Item | Situação |
|---|---|
| Plano, estética, tarefas F0-A/F0-B | escritos e revisados por dois DeepSeek (correções em README §7b) |
| F0-A — migração 062 (arquivos por centro) | pronta, teste PGlite verde, revisada por dois DeepSeek; **Victor autorizou publicar (18/11)** → ensaiar no cofre → pedir ok para aplicar |
| F0-B — esqueleto `app/` | 1ª entrega feita (77 KB gz na abertura); **rodada de correções em curso** (conversa agy `0883799a-f793-4445-b301-a9c368df404c`) contra a estética revisada |
| F0-C — oráculo | retrato de `get_saldo_livre` dos 21 centros guardado fora do git (`oraculo-saldo-livre-2026-11-18.json`) |
| Vigia | versão que se autodesliga publicada às 18:12 (18/11); conferir que parou depois das 18:40 |
| Redirect URL `/v2/` no Supabase | feito pelo Victor (18/11) |

## Próximos passos
1. Publicar 062 no master → ensaiar no cofre → resumo ao Victor → ok → manutenção → aplicar → conferir.
2. Terminar F0-B: fotos (1280 e 390 px), leitura "primeira vez" pelo Gemini, revisão de fase por dois DeepSeek.
3. Commit de `app/` + workflows (com ok do Victor para publicar, porque muda o deploy).
4. Escrever as tarefas da F1 (README §6 + §7b): pendências + `v_balancete_vigente`, página Projetos e do
   projeto, filtro de visão do admin; executores em worktrees fora do OneDrive.

## Pendências com o Victor
- Ok para **aplicar** a 062 (depois do ensaio).
- Ok para publicar `app/` e a mudança do deploy (quando a F0 fechar).

## Registro
| Data | O que aconteceu |
|---|---|
| 18/11 | Três rodadas de análise (Claude, Hydrogen, DeepSeek); decisões acima |
| 18/11 | Vigia pausado; plano e estética escritos e revisados; F0-A e F0-B executadas; oráculo guardado |
| 18/11 | Victor autorizou publicar a 062 e configurou a Redirect URL do `/v2/` |
