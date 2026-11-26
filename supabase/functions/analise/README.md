# analise

Edge Function que roda o laço de ferramentas da Análise (F5) e devolve os
eventos por SSE. É o mesmo laço do Worker da Cloudflare (`worker/`), agora
dentro do Supabase: o plano gratuito da Cloudflare limita a 50 subrequests por
requisição, e uma pergunta "em todos os centros" chegou a 34. Nenhuma regra
mudou — tetos, prazo de 120 s, encerrador, máscara, eventos, mensagens de erro,
CORS e ausência de log são os mesmos.

A chave `OLLAMA_API_KEY` continua só no servidor. As RPCs do site são chamadas
com o **JWT de quem perguntou**; o RLS e os guards valem como na tela. A função
não tem `service_role` e não escreve no banco, exceto a RPC de cota
`analise_consumir()` (migração 071), que só incrementa o contador do próprio
usuário.

**Caminho.** Dentro do Supabase a função recebe o caminho sem `/functions/v1` e
com o nome dela: `POST /functions/v1/analise` chega como `/analise`, e
`GET /functions/v1/analise/saude` chega como `/analise/saude`. A entrada
normaliza (`/analise[/saude]` e `/functions/v1/analise[/saude]`) antes de
chamar `tratar`; o núcleo e o Worker continuam com `/analise` e `/saude`.

## Deploy

O deploy do Supabase só empacota o que está em `supabase/functions/`. Por isso
o núcleo é reunido num arquivo único, gerado pelo esbuild que já está em
`worker/node_modules`:

```bash
# da raiz do repositório
npm --prefix worker run build:edge
npx supabase functions deploy analise --project-ref <ref-do-projeto>
```

O `nucleo.gerado.js` **não é versionado** (está no `.gitignore`): rode o
`build:edge` antes de cada deploy. Se o arquivo não existir, o deploy falha na
hora de achar o import — não há fallback silencioso.

Como na `assistente`, **não precisa de Docker nem de CLI global**: o
`npx supabase` baixa a CLI, o bundle é feito pela API e o aviso
`WARNING: Docker is not running` pode aparecer sem impedir o deploy. É preciso
estar autenticado (`npx supabase login` ou `SUPABASE_ACCESS_TOKEN`) e o
`--project-ref` é obrigatório porque o repositório não está linkado.

Conferir se subiu, sem login de usuário:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://<ref-do-projeto>.supabase.co/functions/v1/analise -d '{}'
```

`401` é o esperado (a função existe e o gateway exige JWT); `404` significa que
não existe.

## Variáveis e segredo

| Nome | Onde | Para quê |
|---|---|---|
| `SUPABASE_URL` | ambiente da Edge Function | URL do projeto (já existe) |
| `SUPABASE_ANON_KEY` | ambiente da Edge Function | Chave pública (já existe) |
| `OLLAMA_API_KEY` | **segredo** | o mesmo da `assistente` (`npx supabase secrets set OLLAMA_API_KEY=...`) |
| `ANALISE_MODELO` | opcional | padrão `deepseek-v4.1-flash:cloud` |
| `ANALISE_PAPEIS` | opcional | padrão `admin` |
| `ANALISE_LIMITE_DIA` | opcional | padrão `50` perguntas por login por dia |

## Contador

A RPC `analise_consumir()` incrementa e devolve `{ dia, usadas }` do dia de
hoje no fuso de Brasília. A Edge Function compara `usadas > ANALISE_LIMITE_DIA`
e recusa a pergunta com `erro limite`, sem chamar o modelo. O teto **não** é
parâmetro da RPC: chamá-la por fora gasta a cota de quem chamou, nunca aumenta
o teto. Falha da RPC recusa com a mesma mensagem genérica de hoje — nunca deixa
passar por padrão.

## O que só se prova publicando

- O limite de subrequests/fetch da Edge Function não é documentado; o desenho
  assume 150 s por requisição e 2 s de CPU (espera não conta).
- `request.signal` só aborta na desconexão do cliente se o runtime do Supabase
  honrar; no workerd isso dependia de `enable_request_signal`.
- O SSE atravessa o gateway do Supabase; a resposta precisa chegar sem buffer
  que junte os eventos.

Nada disso é verificável só com a bancada local: a primeira pergunta real
publicada é o teste.
