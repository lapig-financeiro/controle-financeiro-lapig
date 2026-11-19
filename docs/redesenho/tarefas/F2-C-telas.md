# F2-C — Telas da fase 2: "De onde vem" e o Documento no /v2/

Executor: **Orchestrator (Neon)**, num worktree próprio **fora do OneDrive** (branch `redesenho/f2-c-telas`).
Roda em paralelo com a F2-A (banco): as duas **não têm arquivo em comum**. As RPCs novas ainda não existem em
produção; você trabalha sobre o **contrato** abaixo (igual ao da F2-A) e sobre dados de exemplo, como na F1-B.

Antes de começar, leia: `docs/redesenho/estetica.md` **inteiro** (em especial §4 Valor, Painel lateral, De
onde vem e Documento; siga à risca), `docs/redesenho/README.md` §4, §6 (F2) e §7b, `tarefas/F1-B-telas.md`
(com as correções, que valem aqui), e o código de `app/src/` (`componentes/Valor.jsx`, `Documento.jsx`,
`PainelLateral.jsx`, `paginas/Projeto.jsx`, `servicos/dados.js` e `dadosExemplo.js`). Para o documento, leia
`frontend/js/origem-busca.js` e `frontend/js/components/origem-documento.js` (o site antigo já abre PDF/DOCX
e destaca a linha: porte a ideia para Preact, **importando** `origem-busca.js` como está).

## Arquivos (só estes)
- `app/src/**`, `app/tests/**`, `app/scripts/**`
- `app/package.json` e `app/package-lock.json` (só para `pdfjs-dist` e `mammoth`, e um gerador de PDF de
  exemplo como devDependency, se usar)
- `app/vite.config.js` (só o necessário para o worker do pdf.js e o PDF de exemplo no modo exemplo)
- `docs/redesenho/relatorios/F2-C.md` (novo)
Nada fora de `app/`. **Não** edite `frontend/js/origem-busca.js` nem nada em `frontend/`.

## Contrato (igual na F2-A)
```
explicar_livre_v2(p_project_id uuid) → jsonb
{ "valor": number|null, "motivo": "sem plano"|"sem balancete"|"sem números"|null, "data_referencia": "AAAA-MM-DD"|null,
  "rotulo": "Livre para gastar", "tipo": "calculo", "conta": "soma dos grupos", "chave": "livre", "sinal": 1,
  "ref": null, "nota": null, "partes": [ No ] }        -- valor null ⇒ partes [] e motivo preenchido
No = { "rotulo": string, "valor": number, "tipo": "calculo"|"documento"|"legado"|"digitado",
       "chave": string,                  -- "grupo:<grupo_code>", "rubrica:<code>:previsto|realizado|comprometido", "linha:<id>"
       "conta": string|null,             -- só em "calculo": "previsto − realizado − comprometido" ou "previsto − realizado"
       "sinal": 1|-1,                    -- como entra na conta do pai (o valor do nó é sempre o seu, sem sinal)
       "ref": { "alvo_tabela", "alvo_id", "campo" }|null,   -- só folhas; o site chama get_origem_v2 com ele
       "nota": string|null,              -- ex. grupo sem compromissos rastreados
       "partes": [ No ] }                -- [] nas folhas
get_origem_v2(p_alvo_tabela text, p_alvo_id uuid, p_campo text) → jsonb
{ "tipo": "documento"|"legado"|"digitado", "valor": number|null,     -- valor = o gravado hoje no alvo/campo
  "documento": { "id": uuid|null, "tipo": "balancete"|"plano", "titulo": string, "arquivo_nome": string|null,
                 "formato": "pdf"|"docx", "bucket", "caminho", "versao": int|null, "registrado_em": string|null }|null,
  "fato": { "pagina": int|null, "trecho": string, "bbox": {x0,x1,yMin,yMax}|null, "parser", "parser_versao" }|null,
  "busca": { "conta_codigo"?, "texto"?, "valor"? }|null,   -- só em "legado"; é o `alvo` de acharAlvo, tal qual
  "nota": string|null }
registrar_documento_v2(p jsonb) → jsonb  { "documento_id","versao_id","versao","criada": bool,"fatos": int }   -- só admin; a F2-C não usa
```
O arquivo vem por `supabase.storage.from(bucket).createSignedUrl(caminho, 300)` com o login do próprio
usuário (o escopo do arquivo é o da migração 062). Erro de download vira mensagem **dentro** do Documento,
nunca tela em branco.

## O que fazer
1. **Serviços** (`servicos/dados.js`): `explicarLivre(projectId)`, `origem(ref)`, `arquivoDeOrigem(documento)`
   (URL assinada → `ArrayBuffer`). Mesmo padrão de erro das funções da F1 (falha nunca vira zero). No modo
   exemplo, `dadosExemplo.js` responde as duas RPCs para os centros de exemplo, cobrindo os quatro tipos de
   folha e uma árvore que fecha ao centavo.
2. **De onde vem** (`componentes/DeOndeVem.jsx`, novo): árvore dentro do `PainelLateral`. Cada nó: rótulo,
   `Valor` com centavos (clicável só nas folhas com `ref`), a `conta` do nó de cálculo em `--fs-1
   --cor-texto-2` ("previsto − realizado − comprometido"), filhos recolhíveis (o primeiro nível aberto). Folha
   `digitado` diz "valor digitado, sem documento" (estetica §4); `legado` diz "anterior à rastreabilidade:
   linha achada na hora" quando houver documento, ou "anterior à rastreabilidade, sem arquivo" quando não.
   Se a árvore **não fechar** ao centavo em algum nó (soma dos filhos com sinal ≠ valor), o painel mostra um
   aviso de falha (`AvisoFalha`) naquele nó em vez de esconder: é defeito do banco e precisa aparecer.
3. **Documento** (`componentes/Documento.jsx`, já existe a moldura): carregar o conteúdo de verdade.
   - PDF: `pdfjs-dist` com **import dinâmico** (não entra no bundle inicial; confira o tamanho no relatório),
     worker empacotado pelo Vite (a CSP do build tem `worker-src 'self' blob:`; não afrouxe a CSP). Renderiza
     a página do `fato.pagina` (ou a que `acharAlvo` achar no legado), com zoom e navegação de página, e a
     faixa `--cor-acento-suave` sobre o `bbox` (ou sobre a linha que `acharAlvo` devolver). Coordenadas: veja
     como `origem-documento.js` converte com `viewport`.
   - DOCX: `mammoth` com import dinâmico; destaca o trecho com `marcarNoHtml` de `origem-busca.js`.
   - Coluna da direita: valor com centavos, a parte (rótulo do nó) e o critério: "lido na página N (leitor
     <parser> <versao>)" para `documento`; "achado pelo código/valor/texto" (o que `acharAlvo` disser) para
     `legado`; "não achado no documento" quando a busca falhar — nesse caso abre na página 1 sem faixa.
   - Trecho literal do fato abaixo do valor, em `--fs-2`, para quem não quiser procurar na imagem.
4. **Página do projeto** (`paginas/Projeto.jsx`): o Destaque "livres para gastar" fica clicável e abre o De
   onde vem (raiz da árvore). Na aba Dinheiro, a linha da tabela de grupos abre o painel no nó do grupo.
   Projetos (lista) não muda: lá o número é texto (estetica §4).
5. **Origem declarada em todo número** (README §6 F2): todo `<Valor>` de dinheiro em `app/src/paginas/`
   declara a origem — `origem={...}` com o nó/ref, ou `semOrigem="<motivo>"` (ex.: "soma desta tela",
   "parcelas do cronograma"). Acrescente a prop `semOrigem` ao `Valor` (sem efeito visual; vai no `title` se
   não houver outro) e um teste em `app/tests/` que reprova `<Valor` de moeda em `paginas/` sem uma das duas.
   Datas ficam de fora da regra.
6. **PDF de exemplo** para o modo exemplo: gere por script (`app/scripts/`) um balancete **sintético** de 1–2
   páginas (contas 7.1.3.x com valores que batem com `dadosExemplo.js`, nenhum nome de pessoa) e sirva-o só
   no `npm run dev:exemplo` (middleware do Vite ou pasta fora de `public/`). `verificar-build.mjs` tem de
   reprovar se o PDF de exemplo ou dado de exemplo entrar no build. Um DOCX de exemplo é opcional.

## Testes (vitest, `app/tests/`)
- `DeOndeVem`: renderiza os quatro tipos; nó que não fecha mostra o aviso; clique em folha chama `origem` com
  o `ref` certo; folha sem `ref` não é botão.
- `Documento`: com `pdfjs-dist` simulado, abre na página do fato e posiciona a faixa pelo bbox; no legado usa
  `acharAlvo`; erro de download vira mensagem.
- Serviços: falha de RPC vira estado de erro, nunca zero; modo exemplo não chama o Supabase.
- A regra do item 5.
- Os 54 testes da F1 continuam verdes; `verificar-estilo` e `verificar-build` verdes.

## Pronto quando
- `npm --prefix app test`, `npm --prefix app run build`, `npm run lint` e `npm test` verdes.
- No `dev:exemplo`, abrir um projeto → clicar no livre → árvore → folha → PDF de exemplo com a linha
  destacada (descreva no relatório o caminho para o Claude conferir no navegador).
- Relatório `docs/redesenho/relatorios/F2-C.md`: o que fez, como testou, tamanho do bundle inicial antes e
  depois (o pdf.js não pode entrar nele), desvios do contrato, dúvidas.
- Commit na branch do worktree (conventional commit). **Sem push.**

## Correções depois da revisão (19/11, DeepSeek max, conferidas pelo Claude) — valem por cima do texto acima
1. **Contrato atualizado** (acima): `busca` é o `alvo` de `acharAlvo` tal qual (`conta_codigo`, `texto`,
   `valor`); `No` tem `chave` (`grupo:<code>` casa a linha da tabela com o nó), `nota` e `motivo 'sem números'`.
   Use `documento.formato` para escolher PDF ou DOCX (`tipo` é só rótulo).
2. **Quem abre o Documento é o `DeOndeVem`**, depois de chamar `origem(ref)`: com `documento` → abre; sem
   documento (`digitado`, `legado` sem arquivo) → a nota aparece no próprio painel, nada de janela vazia.
   Texto do legado com documento: "anterior à rastreabilidade: a linha é procurada ao abrir"; depois da busca,
   "achado pelo código/valor/texto" ou "não achado no documento". Falha de `origem` → mensagem no painel.
3. **Raiz nula** (`sem plano`/`sem balancete`/`sem números`): o Destaque continua `—` com o motivo; a árvore
   não abre. Árvore que falha ao carregar → `AvisoFalha` com "tentar de novo", e o **painel por grupo atual**
   continua disponível como reserva (a 064 pode ainda não estar no ar quando o app for publicado). Teste do
   fallback.
4. **Fechamento**: confira só nós `calculo` com partes e valor finito, em centavos, aplicando `sinal`; compare
   também a raiz com o `livre` do Destaque. Nó que não fecha abre os ancestrais automaticamente e mostra o
   `AvisoFalha` nele.
5. **Sinal na tela**: filho com `sinal = -1` aparece com "−" antes do rótulo (com `aria-label` "subtrai");
   `problema` (vermelho) só no valor negativo de raiz/grupo.
6. **`pagina`/`bbox` nulos**: sem página → "lido no documento (leitor …)"; PDF sem bbox → procura
   `fato.trecho` com `acharAlvo({ texto })`; se não achar, página do fato sem faixa.
7. **pdf.js e CSP**: fixe a versão de `pdfjs-dist` (exata, sem `^`), `isEvalSupported: false`,
   `GlobalWorkerOptions.workerSrc` apontando para o asset emitido pelo Vite (respeitando `base`). Se as fontes
   do PDF precisarem, a CSP pode ganhar `font-src 'self' data:` — **só isso**; registre no relatório.
   Descreva como o Claude confere no build (`vite preview`) com o PDF de exemplo.
8. **Faixa**: cor do token com transparência (`color-mix(...)` ou atrás do texto), posição por custom
   properties (`style={{ '--faixa-x': … }}` + `left: var(--faixa-x)`); confira que `verificar-estilo` aceita e,
   se precisar mudar a guarda, só para liberar custom properties.
9. **DOCX**: CSS de `.origem-mark` com tokens; o HTML do mammoth é sanitizado antes de entrar no DOM (como
   `origem-documento.js` faz); teste com mammoth simulado.
10. **Exemplo de ponta a ponta**: `dadosExemplo.js` ganha ids estáveis por linha e as respostas das duas RPCs;
    o script do PDF gera também um manifesto (página, linha, bbox) que o exemplo consome; no modo exemplo
    `arquivoDeOrigem` busca o PDF de dev por `import.meta.env.BASE_URL`, sem Supabase. O PDF é gerado pelo
    script, não versionado (pode acrescentar `app/.gitignore` para isso).
11. **`verificar-build`**: reprova qualquer `.pdf`/`.docx` em `dist` e varre também `.mjs`/`.json`; os dados
    de exemplo levam um sentinela único (ex. `__EXEMPLO_CF__`) que o script procura.
12. **Regra da origem declarada** (item 5): pula `tipo` que começa por `data`; a data sem `tipo` em
    `Projeto.jsx` passa a ter `tipo="data"`; exige `origem`+`onOrigem` ou `semOrigem`. Teste com os dois casos.
13. **Aba Documentos**: a linha de balancete abre o Documento por `origem({alvo_tabela:'balancetes', alvo_id,
    campo:'saldo_disponivel'})`, e a de plano por `planos_trabalho`/`valor_total_plano`; preserve o id do
    banco na linha.
14. **Catálogo** (`#/componentes`) passa a mostrar o `DeOndeVem` e o `Documento` novos (dados estáticos de
    exemplo); some a versão plana. O `DeOndeVem` é o componente que a estética §4 já descreve (não é variação
    nova).
15. **Testes da F1**: os casos de `projeto.test.jsx` que esperam o painel antigo são reescritos para a árvore
    (e um caso para o fallback); registre no relatório quais mudaram. Teste de coordenadas com viewport de
    transform conhecido; zoom e página anterior/próxima; `aria-expanded` da árvore; estados de carregamento.
16. Conferência visual (1280 e 390 px) é do Claude no navegador; deixe no relatório o roteiro.
