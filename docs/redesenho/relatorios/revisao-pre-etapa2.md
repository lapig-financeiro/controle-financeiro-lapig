# Revisão da Etapa 1 da Análise, antes da Etapa 2 (25/11/2026)

Pedido do Victor (25/11): revisão do Worker pelo **Gemini 4 Neon medium** e revisão geral pelo **MiniMax 3.1
Flash max**, e uma forma de testar a Análise por IA sem colar `.js` no console. Os dois revisores rodaram só
leitura, no master `20c4a81`. O Claude conferiu cada achado no código; "confirmado" abaixo quer dizer que o
trecho citado faz o que o revisor disse. Os textos completos das revisões estão em
`NãoColocarNoGit/analise/etapa2-pre/revisao-gemini.md` e `revisao-minimax.md` (sessões: agy
`b99bd9ff-39bf-4852-81fe-035c2503a319`, opencode `ses_deae6df53ffexK60zlU8elOTek`).

## Onde os dois concordam

| Achado | Gemini | MiniMax | Conferência |
|---|---|---|---|
| A **pergunta** e os `anteriores` vão ao Ollama **sem máscara** (`laco.js:243-261`). Nome de bolsista, CPF ou e-mail digitado sai cru; contraria o contrato §5 ("CPF e e-mail saem de todo texto") e faz a pergunta 18 da bateria falhar | alta | alta | confirmado |
| O **texto final não é reidratado** (`laco.js:327-337`): a tela vai mostrar `⟦P1⟧` no texto e o nome no bloco | alta | Etapa 2 | confirmado (o README do Worker registra isso como comportamento, mas a tela não tem como reidratar depois: o mapa morre com a requisição) |
| 403 ao ler `app_users` vira `sem_login` em vez de `sem_permissao` (`auth.js:105`) | baixa | baixa | confirmado |

## Só o Gemini (Worker)

| # | Achado | Gravidade | Conferência |
|---|---|---|---|
| G3 | Erro de RPC do Worker chega ao pacote como `{ codigo, mensagem }`, mas `codigoDoErro` (`comum.js:75-91`) olha `name`/`message`/`status`: timeout e rede viram `(http_4xx)` para o modelo e na tela | média | confirmado |
| G6 | SSE **mudo** enquanto o modelo pensa (até 90 s por rodada, `stream: false`): nenhum byte antes do primeiro `passo`. Proxy de rede institucional pode cortar; a tela não sabe que o login passou | média | confirmado (falta um primeiro evento ou comentário `: ping` periódico) |
| G6b | **Suspeita**: no plano gratuito do Cloudflare o teto é **50 subrequests** por requisição; 8 rodadas + até 30 ferramentas (algumas com 2-3 RPCs) + auth + KV pode passar disso | suspeita | não confirmado: depende do plano da conta (o `wrangler whoami` não mostra). A bancada pode contar as chamadas por pergunta |
| G4 | `consumir()` do limite agenda o `kv.put` mesmo se o prazo/aborto já venceu: conta uma pergunta que não rodou | baixa | confirmado, efeito pequeno |
| G5 | `arguments` em array passa como objeto; `tool_calls` malformado entra no histórico antes de validar; id repetido não é tratado | baixa | confirmado |
| G7 | Resposta de erro do Ollama/Supabase não tem o corpo cancelado (`body.cancel()`) | baixa | confirmado; efeito no workerd não medido |
| G9 | `passo` com `estado: 'erro'` sai sem `inicio` antes (tool sem nome ou argumento inválido) | baixa | confirmado; a tela da Etapa 2 precisa aceitar isso ou o Worker emite o `inicio` |

## Só o MiniMax (conjunto)

| # | Achado | Gravidade | Conferência |
|---|---|---|---|
| M2 | **Rendimento**: a ferramenta `desembolsos` registra o `rendimento_bruto` (R$ 31.040,69 no 30.099) com a ressalva "já incluído no saldo disponível", mas o site mostra o `rendimento_liquido` do balancete, que é o que está no saldo. Duas contas para "o rendimento" e a ressalva vale para a outra | média (dinheiro) | confirmado (`desembolsos.js:198-203`, `index.js:110`, `Projeto.jsx:1636`) |
| M3 | As `INSTRUCOES` copiam as 4 regras do MCP palavra por palavra (contrato §8) e citam ferramentas e campos que a Análise não tem (`panorama`, `simular_alocacao`, `truncado`, `caixa.cobertura`…) | média | confirmado; o defeito é do contrato |
| M4 | `bolsas` sem centro pode passar do teto de 60.000 caracteres (137 pessoas) | média | plausível, não medido |
| M5 | `get_pedido_bolsas_v2` fora do ar derruba 6 das 7 ferramentas (o dicionário de nomes é carregado por todas) | média | confirmado; falhar fechado é certo, a dúvida é se todas precisam |
| M6 | O "sem origem" do texto compara por **valor**: um R$ 500 no texto passa se qualquer nó citado valer 500 | média | confirmado (`texto.js:175-192`) |
| M7 | Tabela sem rótulo de linha (já registrado no ESTADO) | média | confirmado |
| M8 | `listar_centros` descarta `responsaveis`: a pergunta 7 ("os 7 centros da Mariana") não tem como saber quais são | média | confirmado; entrar com isso pede decisão de máscara (é nome de pessoa) |
| M9-M16 | `situacao_centro` diz "(formato)" quando é falha de cálculo; mesmo déficit com origens diferentes por ferramenta; cabeçalho de coluna recusa qualquer dígito ("Parcela 1"); comentário do `explicar_livre` promete `ref` que o código (com razão) não produz; `status` cru em inglês nas bolsas; campo de `recursos` malformado derruba `desembolsos` inteiro; o plano promete bloco com "—" e o contrato recusa o bloco | baixa | 11 e 12 conferidos; os outros plausíveis |

A tabela das 20 perguntas do MiniMax (o que as ferramentas de hoje respondem) está na revisão completa. Em
resumo: bastam 1, 2, 5, 6, 11, 12, 13, 15, 17, 19; parciais 4, 8, 9, 14, 20; não bastam 3 (falta a 071),
7 (responsáveis), 10 (não há ferramenta de alocação) e 18 (pergunta sem máscara).

## Bancada de testes (`worker/bancada/`)

Construída pelo DeepSeek V4.1 Flash max (`6d3f311`, tarefa `tarefas/analise-bancada.md`, relatório
`relatorios/analise-bancada.md`). Roda o próprio `worker/src/index.js` no Node, com o Supabase simulado a
partir do retrato das RPCs (o oráculo, fora do git) e o modelo de verdade pelo Ollama deste PC
(`localhost:11434`, sem chave) ou pela chave num arquivo (`--chave`). Nada sai do PC além do modelo; o
roteador recusa qualquer outro endereço. Confere em toda pergunta: um `fim`, no máximo um `erro`, origem em
todo nó numérico, número sem origem no texto e **vazamento** (nome sintético do retrato em qualquer corpo
enviado ao modelo).

Como rodar (na raiz do repositório; o retrato e a bateria ficam fora do git):

```bash
node worker/bancada/rodar.mjs --retrato NãoColocarNoGit/analise/oraculo-2026-11-25.json   --perguntas NãoColocarNoGit/analise/bancada/bateria-2026-11-25.json --saida NãoColocarNoGit/analise/bancada/<pasta>
```

## Primeira bateria real (25/11, DeepSeek V4.1 Flash high pelo Ollama local, Worker do master)

**9 de 20 passaram**, de 3 a 46 s por pergunta (só a 10 passou de 40 s). Números certos onde havia número
esperado: livre do 30.109 (R$ 514.864,60), rendimento do 30.099 (R$ 31.040,69), folha atrasada nos 4 centros
(69.000; 47.100; 95.620,72; 5.000) e os livres da pergunta 11. Escopo de professor (16): honesto, sem citar
o 30.088. RPC fora do ar (20): sem número inventado. As falhas, por causa:

| Causa | Perguntas | De quem |
|---|---|---|
| **Nome na pergunta vai ao modelo** (vazamento pego pela bancada; e, mesmo mascarado, o modelo não acharia o `⟦Pn⟧` sem a pergunta passar pela mesma máscara) | 18 | Worker (achado comum aos dois revisores) |
| "Sem origem" **falso**: dígito dentro do nome do centro ("GPW fase 2") e ano sozinho ("fim de 2026", "março de 2027") | 2, 11, 13, 15, 16 | pacote (`texto.js`), achado novo da bancada |
| "Sem origem" verdadeiro: o modelo escreveu ids de nó (`r2.7`) e contagens (104, "0 pendências") no texto, e em lista | 6, 19 | instruções ao modelo |
| Tabela recusada: coluna com texto e data misturados, citação de texto literal como nó, tabela acima de 50 linhas | 6, 9 (acabou em `incompleta`) | contrato §6 (rótulo de linha, texto literal; M7) |
| 8 rodadas sem resposta: não há como saber quais são "os 7 centros da Mariana" | 7 | M8 (`responsaveis`) |
| Datas MM/AAAA de balancete no texto | 14 | a conferir (pode ser verdadeiro) |

Expectativas da bateria corrigidas depois da rodada (eram minhas, não do sistema): a 2 exigia códigos e o
modelo respondeu pelo nome do centro; na 16 a bancada aceita o papel professor de propósito, para testar o
escopo das RPCs (o Worker de produção recusa qualquer papel que não seja admin).

Limites da bancada: não simula o CSP do navegador, o KV eventual nem o runtime do workerd (subrequests, CPU);
o retrato é de 25/11 e precisa ser refeito (`NãoColocarNoGit/analise/oraculo.mjs`) quando os dados mudarem.
