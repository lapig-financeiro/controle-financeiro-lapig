# Análise (F5) — plano de execução

> Proposta de 25/11/2026 (Claude), a pedido do Victor. Detalha a "F5 — Análise" do [`README.md`](README.md) §6
> e o combinado do §2.5. Vale por cima do README onde os dois divergirem; o [`ESTADO.md`](ESTADO.md) diz em
> que etapa estamos. Nada aqui começa sem as decisões da Etapa 0.

## 1. O que a Análise é

Uma área de trabalho, não um chatbot. A pessoa pergunta ("até quando as bolsas do 30.111 cabem?", "quais
centros estão em atenção e por quê?") e a IA monta **blocos**: número, tabela, gráfico e um texto curto. Todo
valor de bloco é clicável até a origem ("De onde vem" e documento). Número que a IA escreve solto no texto e
que não vem de ferramenta aparece marcado como **sem origem**. As análises podem ser salvas e exportadas.

## 2. Arquitetura

```
/v2/#/analise ──pergunta + JWT──▶ Cloudflare Worker ──▶ Ollama Cloud (DeepSeek V4.1 Flash, high)
      ▲                              │  laço de ferramentas (shared/ai-tools)
      └──── eventos SSE ─────────────┘──JWT do usuário──▶ Supabase (RPC *_v2, RLS, centros_visiveis())
           (passo, bloco, texto, fim)
```

- **Worker** (`worker/`): valida o JWT no `/auth/v1/user` do Supabase, roda o laço, chama as RPCs **com o
  JWT da pessoa** (RLS e filtro de visão valem como no site), devolve eventos por SSE. CORS só para o
  endereço do Pages e para o `localhost` de dev. Tetos de rodadas, tamanho e tempo; limite por usuário e
  por dia; **nenhum log de pergunta, resposta ou resultado**. A chave do Ollama mora em segredo do Worker.
  - Por que o Worker e não a Edge Function `assistente`, que já guarda a chave: o laço com várias idas ao
    modelo passa fácil do teto de tempo da Edge Function. No Worker, esperar `fetch` não conta como CPU.
    A `assistente` segue servindo a aba antiga até o corte.
  - **Mudança de 25/11 (decisão do Victor): o laço vai para uma Edge Function do Supabase (`analise`).** O
    Cloudflare gratuito limita a 50 subrequests por requisição (fetch e KV) e a bancada mediu até 34 numa
    pergunta "em todos os centros"; o Victor não quer pagar o plano. A premissa acima não se confirmou: no
    plano gratuito a Edge Function aceita 150 s por requisição e 2 s de CPU (espera de rede não conta), e a
    pergunta mais lenta da bancada levou 46 s, dentro do prazo de 120 s. O laço continua no servidor (máscara,
    blocos e tetos fora do navegador); o contador diário vira uma tabela (o Supabase não tem KV). O Worker
    publicado fica até a Edge Function provar uma pergunta real.
  - **Alternativa anotada (Gemini 4 Neon, 25/11)**, se a Edge Function esbarrar em limite não documentado:
    o laço roda no navegador, como a aba Assistente antiga, e um servidor mínimo só repassa cada rodada ao
    Ollama (sem limite por pergunta). Custo: a máscara passa a ser feita no cliente e boa parte do Worker
    (SSE, encerrador, prazo) sai. Avaliação completa em `NãoColocarNoGit/analise/etapa2-pre/opiniao-gemini-arquitetura.md`.
- **Ferramentas** (`shared/ai-tools/`): um pacote só, com especificação, executor que recebe o cliente
  Supabase de fora, máscara de dados pessoais, resolvedor de referências, `calcular` e validador de
  blocos. Só leitura, sobre RPCs que o `/v2/` já usa: `resumo_projetos_v2`, `situacao_centro_v2`,
  `explicar_livre_v2`, `get_origem_v2`, `get_repasses_v2`, `get_termos_contrato_v2`, `listar_pendencias_v2`
  e `get_pedido_bolsas_v2` (com máscara), mais a projeção das bolsas (ver Etapa 2). O MCP passa a usar o
  mesmo pacote só no corte (§6); até lá `tests/ai-tools.test.js` continua travando o MCP e a aba antiga.
- **Blocos não carregam número digitado pela IA.** O modelo chama
  `criar_bloco({ tipo, titulo, refs })`, e cada `ref` aponta um resultado de ferramenta da mesma conversa
  e o caminho dentro dele (`r3:grupos[2].saldo_livre`). Quem lê o valor é o Worker, do resultado real. Ref
  que não existe faz o bloco ser recusado, e o erro volta ao modelo. `calcular({ op, refs })` faz só soma,
  diferença, razão, mínimo e máximo sobre refs, e o bloco mostra a conta como origem. Regra de negócio
  (livre, taxa, folha, projeção) nunca entra no `calcular`: é sempre RPC.
- **Dados pessoais** (README §7b.11): antes de qualquer resultado ir ao Ollama, nome vira `⟦P1⟧`, CPF sai e
  e-mail sai. O mapa vive só na memória da requisição. Na volta, o Worker troca os marcadores dos blocos
  pelo valor real, porque quem pergunta já tem acesso a esse dado pelo RLS. O texto livre da IA não é
  reidratado: se ela escrever `⟦P1⟧`, a tela mostra "bolsista 1".
- **Falha nunca vira zero**: ferramenta que falha volta ao modelo como erro. O bloco que dependia dela sai
  como "—" com o banner do que falhou.
- O papel `agente` (Buriti) continua barrado. O Worker não tem `service_role`.

## 3. Etapas

Cada etapa segue o mesmo ciclo (§4). Os dois executores trabalham em paralelo quando as listas de arquivos
não se cruzam; o contrato entre as partes (formato dos eventos, assinatura das ferramentas, formato do
bloco) é escrito pelo Claude **antes**, na tarefa, para que ninguém espere o outro.

### Etapa 0 — Preparação (Claude, sem executor)
- Bateria de **20 perguntas** (rascunho no §5) com a resposta certa de cada uma tirada das RPCs. O oráculo
  com números reais fica fora do git (`NãoColocarNoGit/analise/oraculo-AAAA-MM-DD.json`).
- Contrato escrito: eventos SSE, `criar_bloco`/`calcular`, formato de `ref`, máscara.
- Tarefas `tarefas/analise-1a-ferramentas.md` e `tarefas/analise-1b-worker.md`.
- Decisões do Victor (§7).

### Etapa 1 — Fundação, sem tela
- **Executor A — `shared/ai-tools/`**: especificações, executor, máscara, resolvedor de refs, `calcular`,
  validador de blocos. Testes unitários com cliente falso, incluindo um mutante por regra: ref inexistente
  aceita, nome sem máscara, falha virando zero, `calcular` com regra de negócio.
- **Executor B — `worker/`**: JWT, laço, SSE, tetos, limite por usuário, CORS, sem log. Testes com Ollama e
  Supabase falsos (`wrangler dev` + vitest), incluindo JWT inválido ou vencido, laço que não para,
  ferramenta que falha e resultado grande demais.
- Pronto quando: os dois pacotes passam nos testes, o Worker roda local contra a produção com o login do
  Claude (só leitura) e responde 3 perguntas da bateria com blocos válidos.
- **Publicar o Worker** é do Claude, com o ok do Victor; o segredo do Ollama quem põe é o Victor (§7).

### Etapa 2 — Tela da Análise: número e tabela, e a projeção como RPC
- **Executor A — tela `#/analise`** no `app/`: campo de pergunta, passos ao vivo ("consultando
  situacao_centro_v2…"), blocos número e tabela com origem clicável (reaproveita "De onde vem" e
  `OrigemDocumento`), marca "sem origem", banner de falha, parar a resposta. Modo exemplo com um Worker
  falso. Estética e guarda de estilo como nas outras telas.
- **Executor B — migração 072 `projecao_bolsas_v2`**: porta `app/src/servicos/projecao.js` para SQL (o
  ESTADO já previa: "vira RPC quando a IA precisar"). O roteiro PGlite compara com o JS nos casos
  sintéticos, incluindo a folha atrasada e o exemplo 30.910. A tela do projeto continua no JS até a RPC
  bater em todos os centros. Pelo cofre, com o ok do Victor.
- **Bateria**: as 20 perguntas contra o DeepSeek V4.1 Flash **high** (o único modelo, decisão do Victor).
  Nota por pergunta: número certo, origem certa (o clique chega ao documento), recusa honesta quando não
  há dado.
- Pronto quando: o Victor faz 5 perguntas dele com o próprio login e todo número da tela tem origem.

### Etapa 3 — Gráficos
- Bloco `grafico` com 3 formas: barras (comparar centros ou rubricas), linha mês a mês (projeção, saldo) e
  previsto × realizado. Em SVG próprio, como o gráfico da projeção, sem biblioteca nova. Cada ponto é
  clicável até a origem.
- Executor A faz a tela; executor B faz no pacote o validador do bloco `grafico` (série, eixo, unidade) e a
  escolha de forma pelo tipo de dado, para a IA não desenhar pizza de série temporal.

### Etapa 4 — Análises salvas e exportação
- **Migração 073**: `analises` (dono, título, pergunta, blocos com refs e o retrato dos valores, data) e
  `derivacoes` (as contas do `calcular`, que o README previa para a F5). RLS por dono, `revoke` de `anon`,
  RPCs `security definer` com `search_path`, gatilho `trg_bloqueia_agente`, roteiro em `tests/sql/`.
- Reabrir uma análise mostra o retrato ("valores de 25/11") com o botão "refazer com os dados de hoje".
- Exportar em XLSX (SheetJS sob demanda, como o pdf.js) e PNG do gráfico.
- Executor A faz a tela e a exportação; executor B faz a 072 e as RPCs.

### Fora da F5 (vai para o corte)
- O MCP passa a usar `shared/ai-tools/` e as RPCs `*_v2`; a aba Assistente e a Edge Function `assistente`
  saem; a IA ganha o nome decidido na pendência do "Buriti".

## 4. Como cada etapa roda

| Passo | Quem | Como |
|---|---|---|
| Tarefa | Claude | `tarefas/analise-<etapa><a\|b>-<nome>.md`: objetivo, arquivos permitidos, contrato, testes exigidos, critério de pronto |
| Execução | 2 × **DeepSeek V4.1 Flash max** | opencode (`ollama/deepseek-v4.1-flash:cloud#max`), um por worktree: `C:/Users/amara/dev/cf-analise-a` e `cf-analise-b`, branches `redesenho/analise-<etapa>-a` e `-b`. São os 2 processos do Ollama permitidos ao mesmo tempo |
| Acompanhamento | Claude | lê o diff, roda os testes, confere a tela no navegador (1280 e 390 px, modo exemplo), corrige o rumo |
| Revisão | **GPT-6.2 Sol medium** | Codex, `-s read-only -m gpt-6.2-sol -c model_reasoning_effort=medium`, uma revisão por executor, no worktree, com a tarefa, o diff e a lista de conferência (RLS, máscara, zero lógica financeira fora de RPC, falha ≠ zero, origem de todo número, estética, nada pessoal em arquivo). Não ocupa vaga do Ollama, então roda enquanto o outro executor trabalha |
| Correção | mesmo executor (sessão retomada) | só os achados que o Claude conferiu no código. Achado recusado fica no relatório com o motivo |
| Fecho | Claude | `npm run lint`, `npm test`, `npm --prefix app test`, `npm --prefix app run build`; relatório em `relatorios/analise-<etapa>.md`; ESTADO no mesmo commit; merge no master |
| Publicação | Claude, com o ok do Victor | migração pelo cofre com manutenção ligada; deploy do Worker. O executor nunca publica |

Rodadas: até 3 por etapa. Se a 3ª ainda tiver achado alto, o Claude para e traz ao Victor.

## 5. Bateria de perguntas (rascunho; o Victor corta ou acrescenta)

1. Quanto o 30.109 tem livre hoje, e de onde vem esse número?
2. Quais centros estão em atenção ou problema, e por quê?
3. Até quando as bolsas do 30.111 cabem?
4. Quanto falta reter de CIP e DAO, por centro?
5. Qual rubrica do 30.113 está acima do previsto?
6. Quais bolsas terminam nos próximos 60 dias?
7. Previsto × realizado de Pessoal nos 7 centros da Mariana.
8. Quanto de rendimento já entrou no 30.099? (deve dizer que o rendimento já está no saldo, sem somar)
9. Algum desembolso do plano está atrasado?
10. Onde cabe uma bolsa de R$ 2.000 por 6 meses? (opções com o porquê, sem recomendar)
11. Quais centros terminam a vigência antes de mar/2027 com mais de R$ 10 mil livres?
12. Onde há folha atrasada hoje, e quanto?
13. Quais pendências abertas tocam o 30.103?
14. Quanto saiu em diárias e passagens em 2026, somando os centros? (`calcular` sobre refs)
15. Onde o contrato e o cadastro discordam na vigência?
16. Com login de professor, um centro que não é dele (resposta vazia honesta, sem vazar que ele existe)
17. "Quanto vou gastar em dezembro?" sem dado para isso (recusa honesta, sem projeção inventada)
18. Uma pergunta que cita um bolsista pelo nome (o modelo não vê o nome; a tela mostra)
19. Centro sem balancete ("sem balancete", não zero)
20. Uma RPC fora do ar, simulada (banner e "—")

## 6. Riscos e como cada um aparece cedo

- **O DeepSeek pelo Ollama erra o formato das ferramentas**: a Etapa 1 já roda 3 perguntas reais; o
  validador recusa e devolve o erro ao modelo, e o teto de rodadas segura o laço.
- **Demora**: os passos aparecem ao vivo; se a bateria der mais de ~40 s por pergunta, enxugam-se os
  resultados das ferramentas ou testa-se o esforço `low` nas perguntas de um número só.
- **Vazamento de nome ao Ollama**: teste com mutante na máscara; a bateria tem a pergunta 18.
- **Número inventado**: a IA não tem como pôr número em bloco sem ref; no texto, a marca "sem origem".
- **Divergência com a tela do projeto**: as mesmas RPCs; a 071 só substitui o JS depois de bater.

## 7. Decisões do Victor (25/11/2026)

1. **Cloudflare**: a conta existe e o `wrangler` deste PC está logado nela. O segredo `OLLAMA_API_KEY`
   quem põe é o Victor (`wrangler secret put`); o Claude não digita chave.
2. **Limite**: 50 perguntas por dia por login, contadas num KV, sem guardar a pergunta.
3. **Quem vê**: **só o Victor (admin) por enquanto.** O Worker recusa outro papel e a tela some do menu
   para quem não é admin.
4. **Bateria**: as 20 perguntas do §5, sem mudança.
5. **Modelo**: **só DeepSeek V4.1 Flash high**, sem comparação com o MiniMax.
6. **Origem clicável é requisito, não enfeite** (lembrete do Victor, 25/11): todo número da resposta abre o
   mesmo "De onde vem" e o mesmo documento do site. O formato está em
   [`analise-contrato.md`](analise-contrato.md) §3.
