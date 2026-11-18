# Redesenho do Controle Financeiro — plano mestre

> Documento vivo. Decidido com o Victor em 18/11/2026, depois de três rodadas de análise (Claude, Gemini 4
> Hydrogen High, DeepSeek V4.1 Flash Max). As análises completas ficam fora do git
> (`NãoColocarNoGit/repensar-2026-11-18/`). **Leia este arquivo e [`estetica.md`](estetica.md) inteiros
> antes de qualquer tarefa do redesenho.** As tarefas executáveis estão em [`tarefas/`](tarefas/).
> **Onde o trabalho está agora: [`ESTADO.md`](ESTADO.md)** — leia primeiro ao retomar.

## 1. Por que

O sistema faz muita coisa bem, mas cresceu por empilhamento: cada processo deixou a sua tela, a sua conta
e o seu estilo. Hoje são 16 itens de menu, três telas de "visão" que respondem quase a mesma coisa, quatro
portas para importar documento, duas fontes de dinheiro competindo com o balancete, e um visual sem padrão
(34 tamanhos de fonte no CSS + 31 no JS, 542 `style=` inline, 48 cores soltas). Toda abertura carrega ~2,6 MB
de bibliotecas e 58 scripts, mesmo para ver um saldo.

## 2. Decisões do Victor (fixas)

1. **Menu com três itens**: **Projetos** (início) → página do projeto; **Análise** (área de trabalho com IA);
   **Admin** (mínimo). Atividades sai. Não existe caixa de entrada.
2. **Tudo entra automático.** O humano só é chamado em **bloqueio** (ver §5). Nada de aprovação prévia.
3. **Pendências**: uma lista só. A página do projeto mostra as que tocam aquele projeto; o sino do topo
   mostra todas (inclusive as de vários projetos ou de nenhum).
4. **Admin** = (a) quem enxerga qual centro de custo; (b) **filtro da própria visão**: o admin vê e mexe em
   tudo, mas oculta centros da sua tela com um clique (ex.: mostrando o sistema a um professor, esconder os
   centros de outro professor); (c) saúde da leitura automática. Sem emulação de usuário. Mapeamento
   conta→rubrica, mescla de duplicados e planejamento de bolsas são resolvidos conversando com o Claude.
5. **Análise** não é chatbot: a IA monta **blocos** (número, tabela, gráfico) a partir de ferramentas; todo
   valor é clicável até o documento; análises salvas e exportáveis (XLSX/imagem). **Modelo: DeepSeek V4.1
   Flash, esforço high**, pelo Ollama Cloud, num **Cloudflare Worker**.
6. **Base nova com build** e **identidade visual de verdade**, seguida à risca ([`estetica.md`](estetica.md)).
7. Vigia de e-mails **pausado** (18/11). A rotina diária que funciona é o "Como estamos" com o Buriti.
   Cruzar a mesma pessoa em dois planos é rotina do Buriti/Claude, que gera pendência para o Victor.

## 3. Arquitetura alvo

```
Drive ──(Apps Script detecta)──▶ Storage + ingest_jobs ──(GitHub Actions, repo PRIVADO, parsers Node)──▶
   RPC aplicar_documento (papel automacao, invariantes em SQL) ──▶ tabelas versionadas + fatos (origem)
                                                     └─ bloqueio ──▶ pendencias
Site novo (/v2/, Vite + Preact) ──JWT do usuário──▶ Supabase (RLS) ; ──▶ Cloudflare Worker (laço da IA)
```

- **Frontend novo** em `app/` (Vite + Preact + JS, sem TypeScript), publicado em
  `https://lapig-financeiro.github.io/controle-financeiro-lapig/v2/` pelo mesmo `deploy.yml` (build de `app/`
  copiado para `v2/` dentro do artefato). O site atual continua em `/` intacto até o corte.
- **RPCs aditivas**: o site novo usa funções novas (`*_v2` ou nomes novos); as que o site antigo usa não
  mudam até o corte. Nenhuma tela antiga pode mudar de número durante a transição.
- **Leitores de documento** (`frontend/js/parsers/`) continuam a única implementação, usados pelo site, pelo
  MCP e pela ingestão. `app/` os importa; não copia.
- **Repositório público**: nada de conteúdo de planilha, contrato ou CPF em log de Actions deste repo. A
  ingestão roda num repositório privado à parte (F3).

## 4. Regras que valem para todas as tarefas

- Tudo de `CLAUDE.md` continua valendo: migração só pelo cofre (com o ok do Victor no chat, manutenção
  ligada), RLS é a barreira, IA não calcula, falha de consulta nunca vira zero, nenhum CPF/nome de bolsista
  em arquivo versionado, conventional commits.
- **Executor nunca aplica migração nem faz deploy de Edge Function/Worker.** Escreve, testa localmente e para.
- Não editar arquivo fora da lista "Arquivos" da tarefa. Precisou? Pare e registre no relatório.
- Toda tarefa termina com `npm run lint` e `npm test` verdes (e `npm --prefix app run build` quando mexer em
  `app/`), e um relatório curto em `docs/redesenho/relatorios/<tarefa>.md`: o que fez, o que testou, o que
  ficou em aberto, desvios do plano.
- Visual: só tokens e componentes de `estetica.md`. Proibido `style=` inline, hex fora de `tokens.css`,
  tamanho de fonte fora da escala. Há um teste que reprova.

## 5. Aplicação automática e bloqueio

Aplica sozinho quando **todas** as invariantes do tipo passam; senão cria pendência e não aplica nada.
Invariantes são escritas em SQL, versionadas, e conferidas dentro da RPC de aplicação.

| Documento | Aplica sozinho se | Bloqueio (vira pendência) |
|---|---|---|
| Balancete | sem aviso do parser; código do projeto = pasta; soma dos lançamentos = totais; toda conta 7.1.3.x com rubrica; competência nova (ou mesma competência com hash diferente → nova **versão**, a anterior fica) | conta sem rubrica (resolve-se no próprio cartão da pendência, escolhendo a rubrica); soma não fecha; código diverge |
| Plano / remanejamento | total igual ao da versão ativa (remanejamento) ou plano original novo; nenhuma rubrica some; soma dos deltas ≤ limite configurado; `data_documento` mais nova | fora disso |
| Planilha de bolsas | diff dentro do limite: encerramentos ≤ limite configurado; sem CPF duplicado/ausente em pessoa nova | encerraria muitas bolsas; identidade ambígua |
| Contrato / aditivo | vigência lida por regra com trecho literal; aditivo que só prorroga (`novo_fim > atual`, mesmo contrato) | vigência condicional sem data do evento; escaneado/ilegível; aditivo que reduz, muda objeto ou valor; dois intervalos plausíveis |

Garantias: nada se sobrescreve (versão nova sempre; o balancete passa a ter versões — hoje `upsert_balancete`
apaga os lançamentos da mesma data); cada aplicação grava `aplicacoes` (antes/depois) e tem **desfazer** por
transação compensatória; quem grava número é sempre o leitor determinístico, nunca o LLM; o papel `agente`
(Buriti) continua barrado (051); a aplicação usa um login `automacao` próprio da ingestão.

## 6. Fases

Cada fase termina com: relatórios das tarefas, conferência do Claude (lê o diff e roda os testes), **revisão
de dois DeepSeek V4.1 Flash high** independentes (opencode, um com o projeto e um cego só com o diff), e
correção dos achados confirmados. Só então a fase seguinte.

### F0 — Fundação (dias)
- **F0-A** Fechar a leitura dos buckets por centro de custo (`bolsa-planilhas` hoje é legível por qualquer
  login, mig. 031). Migração 062 + roteiro de teste. *(Aplicação pelo cofre fica com o Claude + ok do Victor.)*
- **F0-B** Esqueleto de `app/` com build, tokens e componentes base de `estetica.md`, login, casca (barra do
  topo com 3 itens), deploy em `/v2/`, guarda de estilo (teste que reprova inline/hex/fonte fora da escala).
- **F0-C** Medir a lentidão do site atual (abertura, consultas) e registrar números de referência.

### F1 — Verdade única + página do projeto
- RPCs aditivas: repasses (porte de `frontend/js/planejamento-dinheiro.js`: cronograma × conta 2.1.3.01 do
  balancete, sem rendimento) e projeção por rubrica (substituta de `calc_project_monthly`, que soma
  `funding_releases` e ignora rubrica). Testes que comparam com o JS atual nos casos mascarados.
- Tela **Projetos**: uma linha por centro (nome, código, "R$ X livres até mmm/aa", palavra de situação).
- **Página do projeto**: cabeçalho (vigência, Drive), blocos Dinheiro / Bolsas / Documentos / Pendências,
  origem clicável onde ela já existe (plano e balancete, `OrigemDocumento`).
- **Filtro de visão do admin**, global: aplica-se a toda consulta, ao sino, aos totais ("N centros ocultos")
  e, mais tarde, ao escopo das ferramentas da IA. Guardado por usuário no banco.
- Critério de pronto: "livre até" bate ao centavo com o site antigo; projeto sem balancete mostra "sem
  balancete", não zero; professor vê só os seus (RLS real); site antigo intacto.

### F2 — Rastreabilidade gravada
- Tabelas `documentos`, `documento_versoes`, `fatos` (página, trecho literal, bbox opcional, parser+versão),
  `derivacoes` (árvore de valores calculados), `aplicacoes` (antes/depois, desfazer); balancete versionado.
- Parsers emitem página/trecho; backfill só do ano corrente e dos planos ativos (o resto fica "legado").
- `get_origem(fato_id)`: árvore + documento; para professor, planilha sai como **recorte com CPF mascarado**.
- No site novo, todo número vem com origem declarada: documento, cálculo ou digitado.

### F3 — Leitura automática
- Repositório privado de ingestão (GitHub Actions, Node 22, parsers deste repo como dependência).
- Apps Script detecta arquivo novo/alterado no Drive (código `30|78.XXX` da pasta) → Storage + `ingest_jobs`.
- RPC `aplicar_documento` (papel `automacao` da ingestão, invariantes do §5) ou pendência.
- **Pendências**: tabela com chave única, RPC de leitura, sino, e "reaplicar depois de resolvido".
- Admin: saúde da leitura (última execução, o que travou).

### F4 — Contratos e vigência
- Tabela de vigências (contrato, aditivos; `tipo` intervalo ou duração-a-partir-de-evento; `evento_data`).
- Regra primeiro; LLM só quando a regra não acha, com trecho literal conferido na página. Condicional sem data
  do evento = pendência que pede só a data. Escaneado = pendência.
- `projects.end_date` passa a vir da vigência efetiva.

### F5 — Análise
- Cloudflare Worker: valida o JWT, repassa ao Supabase (RLS), streaming, limite por usuário, sem log de payload.
- Pacote único de ferramentas (`shared/ai-tools/`) usado pelo Worker, MCP e site novo.
- Ferramentas `criar_bloco` (tipo, dados, refs) e `calcular` (conta ad hoc que gera `fato_id`); número solto
  no texto é marcado "sem origem".
- Bateria fixa de ~20 perguntas antes de fixar o modelo; GLM 5.3 como alternativa na lista.
- Etapas: número+tabela → gráficos → análises salvas (tabela com RLS) e exportação XLSX/PNG.

### Corte
- Quando `/v2/` cobrir tudo: o novo vai para `/`, o antigo sai; RPCs antigas são removidas por migração.

## 7. Como o trabalho é executado

- **Executor**: Gemini 4 Hydrogen High pelo `agy` (`--mode accept-edits`), na pasta do projeto, uma tarefa
  por vez por executor; até dois executores em paralelo só quando as listas "Arquivos" das tarefas não se
  cruzam.
- **Acompanhamento**: o Claude lê o diff, roda lint/testes, confere no navegador o que for tela, e corrige o
  rumo antes da revisão.
- **Revisão de fase**: dois DeepSeek V4.1 Flash high (opencode), independentes; achados conferidos pelo
  Claude antes de virar correção.
- **Victor** é chamado para: aplicar migração (ok no chat), decisões de produto, e ver a tela.

## 7b. Correções depois da revisão do plano (18/11, dois DeepSeek; valem por cima das seções acima)

1. **F0-A não espera a fase**: assim que o teste passar e a revisão confirmar, o Claude ensaia no cofre e pede
   o ok do Victor para aplicar. É CPF acessível hoje.
2. **F0-C passa a ser o oráculo, antes de mudar o deploy**: guardar (fora do git) o retrato de
   `get_saldo_livre` de todos os centros e o peso/tempo de abertura do site atual.
3. **O número da F1 é definido**: "livres para gastar" = soma de `grupos[].saldo_livre` de `get_saldo_livre`
   (038) até `end_date`; tem de bater ao centavo com essa RPC no mesmo dia. A F1 **não** mostra "bolsas cabem
   até mês X": isso depende da projeção por rubrica, que vai para a F2 junto com `derivacoes`.
   `calc_project_monthly` não é tocada até o corte.
4. **F1 nasce com `pendencias`** (tabela + RLS + leitura) e com uma view `v_balancete_vigente`, para a F2
   trocar o corpo dela sem mudar número. Pendência sem centro nunca some com o filtro de visão. O Buriti
   ganha `criar_pendencia` (papel `agente`) na F3.
5. **Filtro de visão do admin**: tabela nova só do site novo + um ponto único de aplicação (função/view
   `centros_visiveis()`); o site antigo não lê. É apresentação, não permissão. Tarefa própria na F1.
6. **Conta sem rubrica**: resolvida no cartão da pendência (admin escolhe a rubrica); conversar com o Claude
   fica para mudanças em lote.
7. **Contrato no §5 só a partir da F4** (a tabela de vigências nasce lá).
8. **Deploy desacoplado**: build do `app/` quebrado não pode impedir a publicação do site atual (passo do app
   isolado; se falhar, publica só `frontend/` e o CI acusa).
9. **F0-B dividida** em B1 (tokens, guarda de estilo, casca, rotas, manutenção, deploy), B2 (componentes +
   catálogo `#/componentes`) e B3 (login + papel lido de `app_users`, como faz `quem_sou_eu`). A execução em
   curso cobre as três; a revisão confere contra esta divisão.
10. **Execução em paralelo** a partir da F1: cada executor num worktree próprio fora do OneDrive, branch
    própria; o Claude junta.
11. Ferramentas da IA (F5) mascaram CPF e nome antes de mandar resultado ao Ollama Cloud.

## 8. Registro

| Data | Fase/tarefa | Situação |
|---|---|---|
| 18/11/2026 | Plano escrito | — |
