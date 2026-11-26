# Rodada de correção da Análise + registro, feedback e aviso de corte — 26/11/2026

> Orquestração: **Gemini 4 Neon medium** (agy). Execução: **DeepSeek V4.1 Flash max** (opencode). Revisão de cada etapa (somente leitura): **MiniMax 3.1 Flash max** (opencode). Worktree `C:/Users/amara/dev/cf-correcoes`, branch `redesenho/analise-correcoes`. Nada foi aplicado em produção, publicado ou enviado por `push`.

## 1. O que mudou por item

### Parte A — achados da revisão pré-Etapa 2

| Item | O que mudou |
|---|---|
| **A1** (máscara na entrada) | `shared/ai-tools/index.js` ganhou `sessao.mascararEntrada(texto)` (carrega o dicionário via `garantirDicionario()` em modo fail-closed e aplica `mascara.texto()`). `worker/src/laco.js` mascara `pergunta` e `anteriores` antes da 1ª chamada ao modelo (antes do corte de 500/1000 chars, recuando para não partir marcador `⟦Pn⟧`); se `mascararEntrada` faltar ou falhar, encerra com erro sem enviar a pergunta crua. |
| **A2** (reidratação do texto final) | `shared/ai-tools/index.js` ganhou `sessao.reidratarTexto(marcado)` (e `reidratar` também aceita `{ texto, semOrigem }`), deslocando os intervalos de `semOrigem`. `worker/src/laco.js` confere `marcarTexto` na versão mascarada e reidrata antes de emitir o evento `texto`. Bloco e texto final saem com o mesmo nome real. |
| **A3** (403 em `app_users`) | `worker/src/auth.js`: `pedirJson` separa 401 (`semLogin`) de 403 (`semPermissao`). `/auth/v1/user` segue 401/403 → `sem_login`; `/rest/v1/app_users` 403 vira `sem_permissao`. |
| **A4** (`codigoDoErro`) | `shared/ai-tools/ferramentas/comum.js` lê `erro.codigo` e `erro.mensagem` (formato de `worker/src/rpc.js`), mapeando `tempo`/`abortado`/408/504/524 → `tempo`, `rede`/5xx → `rede` e `resposta_invalida` → `formato`. `CODIGOS_PROPRIOS` em `shared/ai-tools/index.js` agora inclui `rede`. `mascara.js` também propaga `codigoDoErro`. |
| **A5** (rendimento em `desembolsos`) | Conferido em `database/063_redesenho_f1.sql` (`get_repasses_v2`) e `app/src/paginas/Projeto.jsx:1636`: o site lê `rendimento_liquido` do balancete, enquanto `get_repasses_v2` hoje retorna `recursos` com `rendimento_bruto`. `desembolsos.js` passou a aceitar e registrar `recursos.rendimento_liquido` com a ressalva *"já incluído no saldo disponível, não somar"*; `rendimento_bruto` fica com rótulo próprio e sem essa ressalva (e sem afirmar que está fora do saldo). Nenhum número do site nem do MCP mudou. |
| **A6** (`INSTRUCOES` + contrato §8) | Removidas todas as referências a ferramentas/campos do MCP que a Análise não tem (`panorama`, `simular_alocacao`, `compromissos_cobertura`, `situacao_dado`, `caixa.cobertura`, `risco_devolucao.base`, `truncado`). As 4 regras foram adaptadas às ferramentas reais, com proibição explícita de id de nó no texto, exigência de nó citado para número no texto e orientação de quando usar cada consulta. Contrato §8 atualizado. |
| **A7** ("sem origem" falso) | `shared/ai-tools/texto.js`: dígitos em nome de centro listado na sessão (ex.: `"GPW fase 2"`, com coordenadas corretas em NFC e NFD e guarda `includes` antes da `RegExp`), ano sozinho (`1900`–`2099`, sem `R$` antes nem `%`/decimal depois) e datas (`DD/MM/AAAA`, `MM/AAAA`, `AAAA-MM-DD`, `mmm/AAAA`) entram em `intervalosProibidos`. Valores em `R$` (inclusive `R$ 2026`) continuam exigindo origem. |
| **A8** (rótulo de linha nas tabelas) | `shared/ai-tools/blocos.js` e contrato §6: a 1ª coluna da tabela aceita id de nó **ou** texto literal (mascarado, `unidade: 'texto'`, `origem: null`, fora de `citados`, recusando vazio, id inexistente e número sem origem). Colunas 2+ seguem exigindo id de nó. `reidratar` funciona com `origem: null`. |
| **A9** (`responsaveis` mascarados) | `shared/ai-tools/mascara.js` ganhou `carregarResponsaveis(centros)` (no mesmo dicionário dos bolsistas, incluindo primeiro nome unívoco com ≥ 3 chars para casar pergunta e resultado). `carregarCentros()` alimenta a máscara e `mascararEntrada` tenta pré-carregar centros sem derrubar a sessão se `resumo_projetos_v2` falhar. `listar_centros.js` expõe `responsaveis` como nós `texto` mascarados. |
| **A10** (todos os centros numa chamada) | Sem migração: `desembolsos.js` e `termos_contrato.js` tornaram `project_id` opcional. Sem `project_id`, consultam todos os centros visíveis em paralelo numa única chamada de ferramenta, com falha parcial isolada por centro (nunca vira zero) e `garantirDicionario` fail-closed. `INSTRUCOES` e `especificacoes()` atualizadas. |
| **A11** (menores) | **Worker**: G5 (`lerArgumentos` rejeita array; `prepararChamadas` filtra malformados, preserva `type`/`index` e desambigua `id` repetido), G7 (`body.cancel()` em erro HTTP em `auth.js`, `nucleo.js`, `contador-rpc.js`, `registro-rpc.js`), G9 (`passo` `inicio` antes de `erro`). **Pacote**: M4 (`bolsas.js` corta deterministicamente acima de 55k chars com `parcial: true` e `aviso_corte`), M9 (`situacao_centro.js` sem `(formato)` em falha de cálculo), M14 (`status` das bolsas em pt-BR: `ativa`/`encerrada`/`cancelada`/`pendente`), M15 (campo malformado em `recursos` vira `null` sem derrubar `desembolsos`). M5 (fail-closed do dicionário) mantido intacto. |

### Parte B — registro, feedback e aviso de corte

| Item | O que mudou |
|---|---|
| **B1** (`074_analise_registro.sql`) | Migração pronta no repositório (29.948 bytes, não aplicada em produção). Cria `analise_registro` e `analise_feedback` (RLS ligado **sem policy**, `revoke all` de `public`/`anon`/`authenticated`, `trg_bloqueia_agente` de statement sem WHEN), 4 RPCs `security definer` com `search_path = public, pg_temp`, guarda `auth.uid() is not null and not is_agente()` e `grant execute` só a `authenticated`: `analise_registro_iniciar` (retenção de 180 dias só do próprio usuário + freio de 200/24 h), `analise_registro_concluir` (só dono, só uma vez, teto 256 KB no jsonb), `analise_feedback_enviar` (só dono, nota `-1`/`1`, motivo ou comentário ≤ 2.000 chars) e `analise_registros_admin` (guarda extra `is_admin()`, teto 200 linhas, `desfecho_calculado = 'cortada'` após 3 min sem `terminada_em`). Roteiro `tests/sql/test_074_analise_registro.sql`, executor `tools/replica-local/rodar-074-pglite.mjs` (7 mutantes) e linha em `docs/migracoes.md`. |
| **B2** (núcleo + SSE `inicio` + bancada) | `worker/src/registro-rpc.js` (best-effort, teto de 192 KB compactos com folga para expansão de `jsonb::text` do Postgres, sem `console.*`). `worker/src/nucleo.js` e `laco.js`: abrem o registro após login + contador, emitem `event: inicio` com `{ registro }` como primeiro evento SSE (falha do registro não derruba a pergunta: `registro: null`), acumulam blocos/texto reidratados e `passos` com argumentos mascarados, e chamam `concluir` uma única vez em `waitUntil` com prazo próprio de 5 s. `worker/bancada/` simula `analise_registro_iniciar`/`concluir` em memória e valida em toda pergunta `inicio` primeiro, 1 abertura/1 fechamento e ausência de nome sintético nos `passos`. Contrato §7 e `worker/README.md` atualizados. |
| **B3** (cliente SSE no `app/`) | `app/src/servicos/analise.js` (sem UI): `executarAnalise` faz POST na Edge Function com JWT, lê SSE incrementalmente (UTF-8 multibyte, chunks partidos, `: ping` e eventos desconhecidos ignorados) e emite erro local `interrompida` com a mensagem exata do contrato quando o stream fecha sem `fim` (preservando tudo o que chegou). `enviarFeedback` chama `analise_feedback_enviar`. 16 testes em `app/tests/analise.test.js` e nota da Etapa 2 em `docs/redesenho/analise-plano.md`. |

### Avaliação: a 074 serve de base para a 073 (análises salvas)?

**Sim, como referência opcional, mas não como a mesma tabela.** A `analise_registro` (074) é trilha operacional com retenção automática de 180 dias e escrita única (`terminada_em is null`). Já a 073 (análises salvas) precisa de permanência sem expiração, título editável pelo usuário, retrato explícito ("valores de DD/MM") e tabela filha de derivações (`derivacoes`). O melhor desenho na Etapa 4 é manter `analises` (073) separada, com uma FK opcional `registro_id uuid references analise_registro(id) on delete set null` para que "salvar esta análise" possa copiar o retrato de um registro sem perder a análise salva quando a retenção de 180 dias apagar o registro operacional.

## 2. O que ficou de fora e por quê

- **`rendimento_liquido` em produção**: `get_repasses_v2` (migração 063) devolve `b.raw_extraction -> 'data' -> 'recursos'`, que traz `rendimento_bruto` e não `rendimento_liquido`. Como a tarefa proíbe alterar outras migrações/RPCs existentes nesta rodada, `desembolsos.js` ficou pronto para registrar `rendimento_liquido` assim que vier da RPC (e corrigiu o rótulo/ressalva do `rendimento_bruto`), ficando o líquido real para a ferramenta de balancete/dinheiro em conta prevista para a Etapa 2.
- **CSP em `app/vite.config.js`**: não foi alterado porque a Edge Function (`https://skxiivmkhpegefafdlty.supabase.co/functions/v1/analise`) está na mesma origem Supabase já liberada em `connect-src`, e os testes não exigiram mudança.
- **Tela `#/analise`**: fora desta rodada (Etapa 2).
- **Aplicação da 074 / deploy da Edge Function / push**: proibidos nesta rodada; aguardam revisão final do Claude e ok do Victor.

## 3. Testes e mutantes

| Comando | Resultado |
|---|---|
| `npm run lint` | **0 erros** |
| `npm test` | **54 arquivos passaram (54); 926 testes passaram, 5 pulados (931)** |
| `npm --prefix worker test` | **15 arquivos passaram (15); 204 testes passaram** |
| `npm --prefix app test` | **25 arquivos passaram (25); 273 testes passaram** |
| `npm --prefix app run build` | **Guarda de estilo OK, Vite build OK, verificação de bundle OK** |
| `npm --prefix worker run build:edge` | **OK (`supabase/functions/analise/nucleo.gerado.js`, 179.787 bytes)** |
| `node tools/replica-local/rodar-074-pglite.mjs` | **OK — ausência `42P01`, Cofre OK (29.948 bytes), roteiro, idempotência, ACL/atributos, BLOCO 1 da 051 e 7 mutantes pegos** |

**Mutantes da 074 (7/7 pegos pelo motivo certo):**
1. Sem RLS em `analise_registro` → `074 FALHOU: RLS desligado em analise_registro`
2. Grant de EXECUTE para `anon` → `074 FALHOU: anon possui EXECUTE em public.analise_registro_iniciar(text, integer, text)`
3. Sem guarda `not is_agente()` → `074 FALHOU: agente barrado pelo motivo errado`
4. `analise_registro_concluir` sem checar dono → `074 FALHOU: A concluiu o registro de B`
5. `analise_registro_concluir` permitindo concluir duas vezes → `074 FALHOU: A concluiu duas vezes`
6. `analise_registros_admin` sem `is_admin()` → `074 FALHOU: professor chamou analise_registros_admin`
7. Retenção de 180 dias apagando linha de outro usuário → `074 FALHOU: A apagou as linhas antigas de B`

> Observação de ambiente: `mcp/node_modules` não existia no worktree; as dependências de `mcp/` foram instaladas localmente (sem alterar nenhum arquivo versionado) para o teste de backfill da 064 rodar no `npm test`. Nenhum arquivo de `mcp/` foi editado e o MCP não importa `shared/ai-tools/`.

## 4. Bancada real: antes (`bateria-2-edge`) × depois (`depois-bateria20`)

Modelo: `deepseek-v4.1-flash:cloud` (local `localhost:11434`), retrato `oraculo-2026-11-25.json`, bateria `bateria-2026-11-25.json`.
Nota: no "depois", cada pergunta inclui **+2 chamadas externas** do registro da 074 (`analise_registro_iniciar` e `analise_registro_concluir`), além de 2 auth + 1 contador + RPCs + modelo.

- **Antes (`bateria-2-edge`)**: **9/20 passaram** (11 falharam; 1 vazamento na pergunta 18; pergunta 9 com 43 chamadas externas e `erro interno`).
- **Depois (`depois-bateria20`)**: **18/20 passaram** (2 falharam; **0 vazamentos**, inclusive na pergunta 18; todas as 20 perguntas abriram e fecharam o registro 1× com `inicio` em primeiro lugar e `passos` sem nome sintético).

| # | Antes (resultado · chamadas) | Depois (resultado · chamadas) | Observação |
|---|---|---|---|
| 1 | falhou (sem origem) · 13 | **passou** · 14 | Corrigido (A6/A7/A8) |
| 2 | falhou (16 sem origem) · 11 | falhou (1 sem origem) · 10 | Modelo escreveu contagem `(5 entre os visíveis)` sem citar nó; `"GPW fase 2"` não deu falso positivo (passou na rodada `depois-cpu`) |
| 3 | falhou (8 sem origem) · 15 | **passou** · 14 | Corrigido (A6/A7) |
| 4 | falhou (1 sem origem) · 22 | **passou** · 38 | Corrigido (A7) |
| 5 | falhou (incompleta) · 15 | **passou** · 11 | Corrigido (A8 rótulo de tabela) |
| 6 | passou · 10 | falhou (64,0 s > 60 s) · 15 | Passou de 60 s de relógio no Ollama local; resposta válida e sem vazamento |
| 7 | passou · 23 | **passou** · 21 | A9 (`responsaveis` mascarados) casando pergunta × resultado |
| 8 | passou · 10 | **passou** · 11 | Sem regressão |
| 9 | falhou (interno) · **43** | **passou** · **25** | A10 cortou as chamadas externas de 43 para 25 (mesmo com +2 do registro) e eliminou o estouro de 30 consultas |
| 10 | falhou (incompleta) · 37 | **passou** · 48 | Passou (aviso >40 chamadas externas) |
| 11 | falhou (incompleta) · 33 | **passou** · 24 | Corrigido (A7/A10) |
| 12 | passou · 23 | **passou** · 25 | Sem regressão |
| 13 | passou · 9 | **passou** · 11 | Sem regressão |
| 14 | falhou (8 sem origem) · 23 | **passou** · 24 | Corrigido (A6/A7) |
| 15 | passou · 21 | **passou** · 22 | Sem regressão |
| 16 | passou · 8 | **passou** · 10 | Escopo de professor mantido |
| 17 | passou · 29 | **passou** · 23 | Recusa honesta mantida |
| 18 | falhou (**vazamento**) · 9 | **passou (0 vazamento)** · 14 | A1 + A2 + B2: nome mascarado na entrada, reidratado na saída, ausente nos `passos` |
| 19 | passou · 11 | **passou** · 15 | Sem plano ≠ zero mantido |
| 20 | falhou (1 sem origem) · 13 | **passou** · 12 | RPC fora do ar sem número inventado |

## 5. CPU: antes × depois (perguntas 2, 4, 9 e 12)

Medido com `node --cpu-prof --cpu-prof-interval 200 worker/bancada/rodar.mjs ... --so 2,4,9,12`, somando tempo próprio dos arquivos em `shared/ai-tools/` e `worker/src/`:

| Métrica | Antes (`antes-cpu`, 2/4 passaram) | Depois (`depois-cpu`, 4/4 passaram) |
|---|---|---|
| **Total código nosso (`shared/ai-tools/` + `worker/src/`)** | **120,84 ms** | **115,30 ms** |
| Maior arquivo | `shared/ai-tools/mascara.js` (**64,94 ms**) | `shared/ai-tools/mascara.js` (**42,53 ms**) |
| 2º maior arquivo | `worker/src/nucleo.js` (9,89 ms) | `shared/ai-tools/texto.js` (37,00 ms) |
| 3º maior arquivo | `shared/ai-tools/ferramentas/comum.js` (9,28 ms) | `worker/src/nucleo.js` (8,90 ms) |
| Novo módulo `worker/src/registro-rpc.js` | — | **0,60 ms** |

Nada chegou perto de 1 s (~29 ms de CPU média por pergunta pesada, abaixo do "antes").

## 6. Revisões do MiniMax 3.1 Flash max e o que foi feito com cada achado

| Etapa | Achado do MiniMax | Gravidade | O que foi feito |
|---|---|---|---|
| **A1** | `laco.js:304`: `mascararEntrada` opcional deixava pergunta crua passar se ausente | Média | **Corrigido**: agora falha fechado (`erro interno`) se `mascararEntrada` faltar. |
| **A1** | `laco.js:141`: `prepararChamadas` removia `type`/`index` do `tool_call` | Média | **Corrigido**: preserva os campos do objeto original ao normalizar. |
| **A1** | `mascara.js:283,292`: `garantirDicionario` virava tudo `http_4xx` | Média | **Corrigido**: propaga `codigoDoErro(...)` e `laco.js` trata `tempo`. |
| **A1** | `laco.js:330`: corte de 500/1000 chars podia partir `⟦Pn⟧` | Baixa | **Corrigido**: `cortarSemPartirMarcador`. |
| **A1** | `index.js:278`: `Set` recriado no `catch` | Baixa | **Corrigido**: promovido a `CODIGOS_PROPRIOS`. |
| **A2** | `desembolsos.js`: `get_repasses_v2` hoje não devolve `rendimento_liquido` | Alta | **Documentado** (§2): sem migração nem RPC extra (quebraria o oráculo da bancada e dobraria RPCs); líquido entra na ferramenta de balancete da Etapa 2. |
| **A2** | `index.js:121` / `desembolsos.js:206`: afirmação "bruto não está incluído" convida a somar duas vezes | Média | **Corrigido**: removida a afirmação; bruto fica só com rótulo próprio. |
| **A2** | `texto.js:222,237`: `normalizarBusca` em NFC deslocava offsets em texto NFD | Média | **Corrigido**: mapeia diretamente sobre a string original agrupando marcas combinantes. |
| **A3** | `mascara.js:201`: primeiro nome sozinho de responsável de 2 palavras ia cru | Alta | **Corrigido**: `carregarResponsaveis` registra o primeiro nome quando unívoco (≥ 3 chars) apontando para o mesmo `⟦Pn⟧`. |
| **A3** | `desembolsos.js` / `termos_contrato.js`: modo "todos os centros" sem corte de 60k | Alta | **Avaliado e mantido**: no retrato real `desembolsos` completo tem ~8 KB brutos (~18 KB com nós) e `termos_contrato` ~15 KB; registrado como atenção se o número de centros/parcelas crescer muito. |
| **A3** | `termos_contrato.js:171,202`: não chamava `garantirDicionario()` (fail-open) | Média | **Corrigido**: `await ctx.mascara.garantirDicionario()` adicionado nos dois modos. |
| **A3** | `termos_contrato.js` / `desembolsos.js`: `centro.name` cru em rótulo/valor | Média | **Corrigido**: passa por `ctx.mascara.texto(centro.name)`. |
| **B1** | `074:161`: sem freio de inundação por usuário na RPC `analise_registro_iniciar` | Média | **Corrigido**: limite de 200 registros em 24 h por usuário dentro da RPC. |
| **B1** | `rodar-074-pglite.mjs:132`: prova de ausência aceitava `msgAntes.includes(...)` | Baixa | **Corrigido**: exige estritamente `codigoAntes === '42P01'`. |
| **B2** | `registro-rpc.js:25`: teto de 240 KB compactos podia passar de 256 KB em `jsonb::text` | Média | **Corrigido**: teto baixado para **192 KB** compactos (folga de ~33% para a expansão do Postgres). |
| **B2** | `nucleo.js:315`: `falhaEscrita` antes de `resultado.abortado` gravava timeout como `desconectado` | Baixa | **Corrigido**: `resultado.abortado` checado antes de `falhaEscrita`. |
| **B3** | `app/src/servicos/analise.js:319`: `signal.aborted` antes de `recebeuFim` | Média | **Corrigido**: `estado.recebeuFim` checado antes de `signal?.aborted`. |
| **B3** | `app/src/servicos/analise.js:278`: 4xx descartava `{ erro }` pt-BR do servidor | Média | **Corrigido**: lê `{ erro }` JSON em 4xx antes do fallback genérico. |
| **B3** | `app/src/servicos/analise.js:370`: `p_registro_id` sem `.trim()` | Baixa | **Corrigido**: envia `registro.trim()`. |

## 7. O que só se prova publicando

- Ensaio e aplicação da `074_analise_registro.sql` pelo cofre (`CofreIA/cofre-lapig`), com manutenção ligada e ok explícito do Victor.
- Deploy da Edge Function `analise` (`npm --prefix worker run build:edge` + `npx supabase functions deploy analise --project-ref ...`) e conferência real de:
  - evento SSE `inicio` (`{ registro }`) chegando primeiro pelo gateway do Supabase;
  - `EdgeRuntime.waitUntil` concluindo `analise_registro_concluir` em resposta normal, em timeout e em desconexão da aba;
  - `analise_registros_admin` devolvendo `desfecho_calculado = 'cortada'` quando o runtime matar a função sem `concluir`.
- Integração visual da tela `#/analise` (Etapa 2) com `app/src/servicos/analise.js` e o aviso de corte `interrompida` ao vivo.

## 8. Sessões do opencode usadas

| Etapa | Papel | Modelo | Sessão (`.sid`) |
|---|---|---|---|
| A1 | Executor | DeepSeek V4.1 Flash max | `ses_de819bf12ffe83bJE5YKpMhBHZ` |
| A1 | Revisor | MiniMax 3.1 Flash max | `ses_de814b31cffezTFu4uVGfW4e20` |
| A2 | Executor | DeepSeek V4.1 Flash max | `ses_de80c9ec8ffeDAkhuBn3QVTKD1` |
| A2 | Revisor | MiniMax 3.1 Flash max | `ses_de805e551ffeEg2ds0t6IPeIRV` |
| A3 | Executor | DeepSeek V4.1 Flash max | `ses_de7fd78cfffecEVInLH27TlNu1` |
| A3 | Revisor | MiniMax 3.1 Flash max | `ses_de7f86e87ffeaL9oop7JJAuRXD` |
| B1 | Executor | DeepSeek V4.1 Flash max | `ses_de7f1f456ffeaDcPNIt3BfRm70` |
| B1 | Revisor | MiniMax 3.1 Flash max | `ses_de7ec1bf1ffeBsvsvUKPyRPkzf` |
| B2 | Executor | DeepSeek V4.1 Flash max | `ses_de7e710efffewEise1QCR7HrMm` |
| B2 | Revisor | MiniMax 3.1 Flash max | `ses_de7db0227ffepqbHG6PkrWP5g6` |
| B3 | Executor | DeepSeek V4.1 Flash max | `ses_de7d39ad8ffeKDCjMi1jaDTKC7` |
| B3 | Revisor | MiniMax 3.1 Flash max | `ses_de7d06babffejY46Q2OC4tRWIZ` |
