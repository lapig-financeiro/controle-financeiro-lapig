# AGENTS.md — Controle Financeiro LAPIG

Sistema de controle financeiro dos centros de custo e das bolsas do LAPIG/UFG
(Supabase; interface e documentação em pt-BR). **Dois frontends convivem**: o site
atual em `frontend/` (publicado em `/`) e o site novo em `app/` (Vite + Preact,
publicado em `/v2/`), em redesenho desde 18/11/2026. Este arquivo é a memória do
projeto e vale para qualquer IA (Claude Code, Codex, OpenCode, agy). O `CLAUDE.md`
só aponta para cá. Desde 20/11/2026 o conteúdo mora aqui; antes morava no `CLAUDE.md`.

**Nomes (26/11/2026):** o sistema se chama **Buriti** (marca e regras de uso em
[`docs/redesenho/marca.md`](docs/redesenho/marca.md)); a IA do sistema se chama **Assistente**. No `/v2/` já
é assim; a página "Buriti" do site antigo e os títulos das tools do MCP mudam no corte. Chaves internas
ficam: papel `agente`, executor `buriti`, `mcp/src/buriti*.js`.

## Leia antes de mexer

| Quando | Documento |
|---|---|
| Sempre | [`docs/README.md`](docs/README.md), o índice |
| `app/` ou migração `*_v2` | [`docs/redesenho/ESTADO.md`](docs/redesenho/ESTADO.md) primeiro; plano em [`docs/redesenho/README.md`](docs/redesenho/README.md), visual em [`estetica.md`](docs/redesenho/estetica.md). Atualize o ESTADO no mesmo commit de cada passo |
| Aplicar migração | [`docs/aplicar-migracao.md`](docs/aplicar-migracao.md) inteiro |
| Escrever no banco de produção | [`docs/acesso-ao-banco.md`](docs/acesso-ao-banco.md) |
| Área coberta por migração | a linha dela em [`docs/migracoes.md`](docs/migracoes.md) (001→069 em 20/11/2026; a lista viva é esse arquivo) e o cabeçalho do `.sql` |
| Código e telas do site atual | [`docs/convencoes.md`](docs/convencoes.md) (o porquê e o teste de cada convenção), [`architecture.md`](docs/architecture.md), [`pages.md`](docs/pages.md) |
| "Faz a rotina do mês" | [`docs/rotina-mensal.md`](docs/rotina-mensal.md) |
| `docs/historico/` | relatórios datados, **não** referência viva: consulte antes de "redescobrir" um bug, nunca como fonte do estado atual |

**Mapa:** `frontend/` site atual · `app/` site novo · `database/` migrações ·
`mcp/` servidor MCP · `tests/` testes (`tests/sql/` roteiros do banco) ·
`NãoColocarNoGit/` dados e análises que não podem ir para o repositório público.

## Rodar e testar

O site atual não tem build e exige HTTP (`file://` quebra `<script type="module">`):
`cd frontend && python -m http.server 8080` ou `abrir-site.bat`. O site novo:
`npm --prefix app run dev` (catálogo em dev: `#/componentes`; modo exemplo:
`npm --prefix app run dev:exemplo`).

Antes de dizer que terminou: `npm run lint` e `npm test`; quando mexer em `app/`,
também `npm --prefix app test` e `npm --prefix app run build`. Commits no padrão
`feat:`/`fix:`/`chore:`/`docs:`.

O site atual usa as custom properties de `frontend/css/style.css`. O site novo
segue `app/src/estilo/tokens.css` e `docs/redesenho/estetica.md`: sem `style=`
inline, hex fora dos tokens ou fonte fora da escala (o build reprova).

## Site atual × redesenho

O redesenho **substitui** o site atual. Até o corte os dois funcionam, e **nenhum
número do site antigo pode mudar** (as RPCs novas são aditivas, `*_v2`).

- **Vale para os dois**: banco, segurança, dinheiro, dados pessoais, git, publicação
  e o modo de trabalho.
- **Só no site atual, e sai no corte**: menu em seções do `index.html`, guards do
  `Router` (`registerGuard`/`registerDirtyChecker`), `hub.js`, a aba Assistente e o
  MCP como estão hoje, e o HTML montado por template literal (escape por contexto:
  `escapeAttr` em HTML, `escapeAttrJs` dentro de `onclick`). Não usar esses padrões
  como modelo para o site novo.
- **Só no site novo**: rotas por hash em `app/src/roteador.js`, componentes Preact,
  RPCs `*_v2`, `centros_visiveis()` e `filtro_visao` (apresentação, não permissão).
  Tela nova nasce no `app/`; não levar tela nova para `frontend/js/pages/` sem o
  Victor pedir.

## Regras que não se negociam

- **Migração só pelo cofre** (`CofreIA/cofre-lapig`), nunca colando no SQL Editor:
  publique no `master`, ensaie, mande o resumo ao Victor e aplique só com o "ok"
  dele no chat. Ligue `frontend/manutencao.json` antes e desligue só depois de
  conferir. Executor delegado nunca aplica migração nem faz deploy. As restrições
  do cofre (BEGIN/COMMIT, palavras recusadas, 90 KB, valores fixos) estão em
  `docs/aplicar-migracao.md`.
- **Migração nova**: `create or replace` reescreve os atributos da função (repita
  `security definer`/`invoker`, `set search_path = public, pg_temp` e o guard);
  `drop` + `create` leva a ACL junto (restaure os grants da 035); rode o BLOCO 1 de
  `tests/sql/test_051_buriti_propostas.sql` para o gatilho que barra o agente; traga
  roteiro autoconferido em `tests/sql/` e asserções no fim do `.sql`; acrescente a
  linha em `docs/migracoes.md`.
- **RLS é a barreira real** (a anon key é pública); a `service_role` nunca vai ao
  frontend, e menu/sidebar é só UX. Tabela nova: RLS ligado, `revoke` de `anon`,
  `security definer` com `search_path` e o gatilho `trg_bloqueia_agente` da 051.
- **IA não grava número sozinha**: o Assistente (papel `agente`) propõe e um humano aplica; o laço do
  assistente e o MCP só chamam RPC (**zero lógica financeira no adaptador**). O
  teste `tests/ai-tools.test.js` trava os dois adaptadores.
- **Falha de consulta nunca vira zero**: banner do que falhou e `—` no KPI.
- **O repositório é público**: nenhum CPF, nome de bolsista, conteúdo de planilha
  ou contrato, credencial ou token em arquivo versionado, fixture, log do Actions
  ou saída de teste. `tests/sql` usa placeholders (`SEU-USER-ID`) substituídos no
  editor, nunca no arquivo. Dado pessoal mora nos anexos: audite por padrão, não
  por tipo de arquivo ([`docs/seguranca-publicacao.md`](docs/seguranca-publicacao.md)).
- **Git dentro do OneDrive**: operação que reempacota o `.git` (`filter-repo`,
  `gc --aggressive`, rebase grande) faz o OneDrive anunciar centenas de exclusões.
  Avise antes; se ele oferecer "restaurar arquivos excluídos", **recuse**: isso
  corrompe o repositório.
- **Publicação**: `deploy.yml` publica no GitHub Pages a partir do `master`, em
  `https://lapig-financeiro.github.io/controle-financeiro-lapig/`. O repo fica na
  organização `lapig-financeiro` só para ter endereço próprio (o login do Supabase
  mora no `localStorage`, que é por endereço). **Nenhum outro site com Pages nessa
  organização.** O endereço antigo redireciona pelo repo
  `VictorGit10/victorgit10.github.io`; nunca recriar
  `VictorGit10/controle-financeiro-lapig` (o cofre usa o redirecionamento).
- **Nunca mudar `projects.end_date` direto**: a vigência entra por termo de
  contrato e o Victor troca pelo botão "Usar a data do contrato".

## Dinheiro: o que não se reinventa

- O saldo do projeto é o **`SALDO DISPONÍVEL` do balancete**, e ele **já inclui o
  rendimento**: o rendimento se mostra ("inclui R$ X"), nunca se soma de novo.
- **Desembolso se confere pelo balancete** (contas 2.1.3.01, sem a linha de
  rendimento), nunca pela tela Desembolsos (`funding_releases`). Parcela vencida
  sem entrada é pergunta, não suposição.
- De **plano de trabalho/remanejamento só se aproveita rubrica** (e desembolso).
  Bolsista vem da planilha da FUNAPE, que é **uma por projeto**, e quem importa é
  a IA, não o Victor pela tela.
- **Taxa nunca é livre**: `cip_ufg`, `cip_ua` e `dao` viram compromisso pelo que
  falta reter (066).
- **Bolsa encerrada conta até a `end_date`** (048): encerrar sem corrigir a data
  prende dinheiro; duplicata que nunca pagou à parte vai para `cancelled` com o ok
  do Victor. A CLT do 30.111 registrada como bolsa é de propósito: não cancelar.
- **Rubrica zerada pode ser mapeamento, não ausência de gasto**: o plano de contas
  da FUNAPE não espelha as letras do plano de trabalho (passagens e DAO ficam sob
  `7.1.3.05`, e `conta_rubrica_map` casa pelo prefixo mais longo). Confira de que
  conta saiu em `balancete_lancamentos` antes de concluir.

## Quem decide

O Victor decide produto, tela, prioridade, aplicar migração e o que é interpretação
de dado (para onde foi o dinheiro, o que a PROAD aceitou). O agente segue sozinho em
**erro do sistema** (parser, cálculo, tela, dado gravado por defeito): corrige,
testa, publica e reprocessa os centros afetados, registrando no dossiê; e em
**aplicação de documento limpo** (sem aviso do leitor, total bate, é o mais recente,
nada some). Dúvida ou informação que não está nos e-mails/Drive/banco vira pendência
ou folha de decisões, não suposição. Escrita no banco: simule e grave em turnos
separados.

## Quais IAs usar (decisões do Victor, 20 e 26/11/2026)

- **Padrão: DeepSeek V4.1 Flash max** (opencode, `ollama/deepseek-v4.1-flash:cloud#max`),
  para executar e para revisar. Até 2 executores, um por worktree em
  `C:/Users/amara/dev/cf-*`, e no máximo 2 processos do Ollama ao mesmo tempo.
- **MiniMax 3.1 Flash max** (`ollama/minimax-m3.1-flash:cloud#max`) revisa as partes
  que pedirem segunda opinião.
- **Codex (GPT-6.2 Sol)**: liberado em 26/11/2026 para trabalhar direto no projeto.
  Numa worktree, o `.git` mora na pasta do OneDrive, fora do que o sandbox do Codex
  grava: ele não consegue commitar. Quem orquestra faz o commit, ou dê a ele essa pasta
  com `--add-dir`.
- **Qualquer outra IA ou modelo** (agy/Gemini, GLM, Kimi) **só quando o Victor pedir.**
- Quem orquestra escreve a tarefa, confere cada achado antes de virar correção, roda
  os testes e vê a tela no navegador. Toda tarefa termina com lint/testes verdes e
  relatório em `docs/redesenho/relatorios/<tarefa>.md`; o `ESTADO.md` muda no mesmo
  commit.

## Armadilhas

- **Assistente (papel `agente`)**: nunca vira professor nem admin; embed de tabela com
  dado pessoal num caminho que ele percorre volta vazio **sem erro**.
- **Atributo de função** (`security definer`, `search_path`) só se conclui no banco
  (`pg_proc`), nunca lendo as migrações: a 019, a 021 e a 033 se sobrescrevem em
  silêncio. Sem banco, grepe todas as migrações e diga que a conclusão é do arquivo.
- **Acesso sem login** se audita pela API real: `POST /rest/v1/rpc/<função>` com a
  anon key que volte 200 é vazamento, mesmo que a tabela volte `[]`.
- **Drive**: case pasta ↔ projeto pelo código (`\b(30|78)\.\d{3}\b`), nunca pelo nome
  (os títulos variam: `9. Remap 30.105`, `8.TNC/Syngenta - 30.100`). As pastas dos centros
  estão em "Compartilhados comigo", não no `G:`: use o conector do Google Drive.
- **Credencial de admin** dá escrita total pela API e passa por cima do RLS (admin libera
  tudo); o PostgREST aceita `DELETE`/`PATCH` sem filtro e o `audit_logs` só cobre 4
  tabelas. Antes de escrever: [`docs/acesso-ao-banco.md`](docs/acesso-ao-banco.md).
- **Fatos de centros que citam pessoas** (prazos do 30.103/TNC, equipes do 30.111,
  destino do saldo do 30.076) não vão para o git: estão em
  `C:/Users/amara/OneDrive/Documentos/Antigravity/ControleFinanceiro/NãoColocarNoGit/memoria-ias.md`.
- **Tela nova** nasce no visual e na lógica do sistema, organizada e pensada para
  decidir; o Victor recusa protótipo "feito às pressas".
- **Análise das bolsas de 2027** (fora do site): comece por
  `NãoColocarNoGit/analise-bolsas-2027/ESTADO.md`; o mapa se refaz com
  `python -I mapa/refazer_mapa.py`, rodado nessa pasta.
