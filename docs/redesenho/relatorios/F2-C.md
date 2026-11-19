# Relatório F2-C — "De onde vem" e o Documento no `/v2/`

## O que foi feito

- **Dependências e geração de exemplo (`app/package.json`, `app/package-lock.json`, `app/.gitignore`, `app/scripts/gerar-pdf-exemplo.mjs`)**:
  - Instalados `pdfjs-dist@4.10.38` e `mammoth@1.12.0` com versões exatas (sem `^`) em `app/package.json`.
  - Criado `app/scripts/gerar-pdf-exemplo.mjs` (`npm --prefix app run gerar:exemplo`), que gera em memória um balancete PDF sintético de 2 páginas (`balancete-30901-out-26.pdf`, 4.254 bytes, zero nomes de pessoas reais) com contas `7.1.3.x` e `SALDO DISPONIVEL` alinhados ao centavo com `dadosExemplo.js`, e o lê com o próprio `pdfjs-dist` + `linhasDaPagina`/`acharAlvo` de `frontend/js/origem-busca.js` para produzir `manifesto.json` (`pagina`, `linha`, `trecho`, `bbox`).
  - Criado `app/.gitignore` ignorando `.exemplo/` (o PDF e o manifesto gerados pelo script não são versionados).

- **Build, CSP e guardas (`app/vite.config.js`, `app/scripts/verificar-build.mjs`, `app/scripts/verificar-estilo.mjs`)**:
  - `app/vite.config.js`: acrescentado `data:` apenas em `font-src` da CSP de build (`font-src 'self' data:`) para fontes embutidas de PDFs no `pdf.js`, mantendo `worker-src 'self' blob:` e demais diretivas intactas. Adicionado middleware `servirExemploNoDev` ativo somente em `configureServer` quando `mode === 'exemplo'`, servindo `/controle-financeiro-lapig/v2/__exemplo/balancete-30901-out-26.pdf` e `/controle-financeiro-lapig/v2/__exemplo/manifesto.json`.
  - `app/scripts/verificar-build.mjs`: adicionado sentinela `'__EXEMPLO_CF__'` em `MARCADORES_EXEMPLO`, varredura ampliada para incluir `.mjs` e `.json`, e reprovação automática se houver qualquer `.pdf` ou `.docx` em `dist/`.
  - `app/scripts/verificar-estilo.mjs`: corrigida a leitura de objetos multiline/vírgula final em `style={{ '--var': ... }}` e liberado o uso em `.css` de `var(--...)` apenas para custom properties efetivamente declaradas via `style={{ '--...': ... }}` nos arquivos `.js`/`.jsx` da mesma árvore, mantendo bloqueio total para variáveis inexistentes (ex.: `var(--cor-inventada)`).

- **Camada de dados e leitores sob demanda (`app/src/servicos/leitoresDocumento.js`, `dados.js`, `dadosExemplo.js`)**:
  - `leitoresDocumento.js`: carregamento dinâmico (`import(...)`) de `pdfjs-dist`, `pdfjs-dist/build/pdf.worker.min.mjs?url` (respeitando `base`, com `GlobalWorkerOptions.workerSrc`) e `mammoth/mammoth.browser.min.js`.
  - `dados.js`: adicionadas `explicarLivre(projectId)`, `origem(ref)` e `arquivoDeOrigem(documento)` (via `supabase.storage.from(bucket).createSignedUrl(caminho, 300)` + `fetch` → `ArrayBuffer`), com validação de payload e erro explícito sem zerar.
  - `dadosExemplo.js`: adicionados sentinela `__EXEMPLO_CF__`, IDs estáveis por linha, árvores de `explicarLivre` fechando ao centavo e cobrindo os quatro tipos (`calculo`, `documento`, `legado`, `digitado`) além de `sem balancete`, `sem plano` e falha (`30.906`); `origem` consumindo `__exemplo/manifesto.json` e `arquivoDeOrigem` buscando `__exemplo/balancete-30901-out-26.pdf` por `import.meta.env.BASE_URL` sem tocar no Supabase.

- **Componentes (`app/src/componentes/Valor.jsx`, `Documento.jsx`, `Documento.css`, `DeOndeVem.jsx`, `DeOndeVem.css`, `index.js`)**:
  - `Valor.jsx`: adicionada a prop `semOrigem` (sem efeito visual; aplicada ao `title` quando não há valor vazio nem botão de origem).
  - `Documento.jsx` / `Documento.css`: escolha estrita por `documento.formato` (`pdf`/`docx`, ou erro em formato não suportado); PDF com `isEvalSupported: false`, destaque por `fato.bbox` (ou busca de `fato.trecho` com `acharAlvo` quando `bbox` for nulo, ou página do fato sem faixa), fluxo `legado` com `linhasDaPagina` + `acharAlvo` de `frontend/js/origem-busca.js` (abrindo página 1 sem faixa quando não achar), navegação de páginas e zoom, faixa com `color-mix` e custom properties (`--faixa-x`, `--faixa-y`, `--faixa-largura`, `--faixa-altura`); DOCX com `mammoth` + sanitização de HTML (`sanitizarHtmlDocx`) + `marcarNoHtml`; coluna direita com valor com centavos, trecho literal abaixo do valor em `--fs-2`, parte, critério e nota; erro de download dentro da janela via `AvisoFalha` com `"Tentar de novo"`.
  - `DeOndeVem.jsx` / `DeOndeVem.css`: árvore dentro do `PainelLateral` com primeiro nível aberto, nós recolhíveis (`aria-expanded`), sinal `−` (`aria-label="subtrai"`) em filhos com `sinal === -1`, `problema` (vermelho) apenas em raiz/grupo negativo, conferência de fechamento em centavos (`verificarFechamentoArvore`) autoabrindo ancestrais e mostrando `AvisoFalha` nos nós divergentes, clique apenas em folhas com `ref`, e abertura do `Documento` (ou exibição da nota no próprio painel quando sem arquivo).

- **Páginas (`app/src/paginas/Projeto.jsx`, `Projeto.css`, `Projetos.jsx`, `Componentes.jsx`)**:
  - `Projeto.jsx`: Destaque "Livres para gastar" clicável abre `DeOndeVem` na raiz (e fica `—` não clicável quando `sem plano`, `sem balancete`, `sem números` ou erro); linha da tabela de grupos na aba `Dinheiro` abre `DeOndeVem` no nó `grupo:<code>`; se `explicarLivre` falhar (ex.: migração 064 ainda fora do ar), exibe `AvisoFalha` com `"Tentar de novo"` junto com o **painel por grupo reserva** da F1; aba `Documentos` preserva o `id` do banco e abre o documento via `origem({ alvo_tabela: 'balancetes' | 'planos_trabalho', ... })`; corrigido o `<Valor>` de data sem `tipo` na tabela de bolsas sem data de término para `tipo="data"`; declarada `origem`+`onOrigem` ou `semOrigem` em todos os `<Valor>` monetários.
  - `Projetos.jsx`: adicionada `semOrigem` nos `<Valor>` monetários da lista (mantendo o texto não clicável).
  - `Componentes.jsx`: substituída a versão plana de origem por `<DeOndeVem>` + `<Documento>` com dados estáticos de exemplo do catálogo (sem marcadores de `dadosExemplo.js`), e declarada `semOrigem` nos `<Valor>` monetários de amostra.

## Tamanho do bundle (antes e depois)

Medido via `npm.cmd --prefix app run build`:

| Artefato | Antes (F1-B) | Depois (F2-C) | Observação |
|---|---:|---:|---|
| `dist/index.html` | `0,98 kB` (`0,55 kB` gzip) | `0,99 kB` (`0,55 kB` gzip) | CSP inclui `font-src 'self' data:` |
| `dist/assets/index-*.css` | `39,03 kB` (`6,51 kB` gzip) | `45,03 kB` (`7,22 kB` gzip) | CSS de `DeOndeVem`, `Documento` e `Projeto` |
| `dist/assets/index-*.js` (inicial) | `337,53 kB` (`93,38 kB` gzip) | `374,97 kB` (`104,71 kB` gzip) | `+37,44 kB` bruto (`+11,33 kB` gzip); sem `pdf.js` nem `mammoth` |
| `dist/assets/pdf-*.js` (sob demanda) | — | `365,12 kB` (`107,61 kB` gzip) | Carregado só ao abrir PDF |
| `dist/assets/pdf.worker.min-*.mjs` (sob demanda) | — | `1.375,84 kB` | Worker emitido pelo Vite com `base` |
| `dist/assets/pdf.worker.min-*.js` (ponte URL) | — | `0,10 kB` (`0,11 kB` gzip) | Exporta URL `/controle-financeiro-lapig/v2/assets/pdf.worker.min-*.mjs` |
| `dist/assets/mammoth.browser.min-*.js` (sob demanda) | — | `499,35 kB` (`125,32 kB` gzip) | Carregado só ao abrir DOCX |

Verificação adicional em `app/dist/assets/index-*.js`: nenhuma ocorrência de `PDFDocumentProxy`, `pdfjs-dist` ou `__EXEMPLO_CF__`; apenas os três `import(...)` dinâmicos para os chunks lazy (`pdf-*.js`, `pdf.worker.min-*.js`, `mammoth.browser.min-*.js`), e zero arquivos `.pdf`/`.docx` em `app/dist`.

## Como foi testado

Todos os comandos abaixo foram executados após a última edição no código e passaram:

- `npm.cmd --prefix app test`: **13 arquivos, 71 testes passando (71/71)**:
  - `tests/de-onde-vem.test.jsx` (3 testes): os 4 tipos de nó, sinal `−` com `aria-label="subtrai"`, `valor--problema` só em raiz/grupo negativo, `aria-expanded`, autoabertura de ancestrais e `AvisoFalha` em nó que não fecha/diverge, clique em folha com `ref` abrindo `Documento` vs nota no painel sem arquivo, folha sem `ref` não é botão, loading e falha em `origem`.
  - `tests/documento.test.jsx` (6 testes): conversão de coordenadas (`calcularRetanguloFaixa`) com `dpr=1` e `dpr=2`, `pdfjs-dist` simulado (`isEvalSupported: false`, página do fato, faixa por `--faixa-*`, critério + trecho literal, zoom e paginação), `pagina: null` e `bbox: null` (busca por `fato.trecho`), `legado` achado/não achado via `acharAlvo`, DOCX com `mammoth` simulado + sanitização XSS + `marcarNoHtml`, carregamento e erro de download como `AvisoFalha`.
  - `tests/origem-declarada.test.js` (2 testes): confere todos os `.jsx` de `app/src/paginas/` (pulando `tipo` começando por `data`) e valida casos sintéticos inválidos e válidos.
  - `tests/pdf-exemplo.test.js` (1 teste): gera PDF em memória com `pdfjs-dist` real + `origem-busca.js`, confere 2 páginas, 7 fatos com bbox válido e soma alinhada a `dadosExemplo.js`.
  - `tests/dados.test.js` (atualizado, 9 testes): erros/validações de `explicarLivre`, `origem`, `arquivoDeOrigem` (`createSignedUrl` + `fetch`), `dadosExemplo` sem Supabase e fechamento ao centavo, e `verificarBuild` reprovando `.pdf`/`.docx`/`.mjs`/`.json` e `__EXEMPLO_CF__`.
  - `tests/verificar-estilo.test.js` (atualizado, 9 testes): inclui caso de custom properties `--faixa-*` em `style={{ '--faixa-x': ..., }}` + CSS mantendo reprovação para `var(--cor-inventada)`.
  - `tests/projeto.test.jsx` (atualizado, 9 testes): testes da F1 preservados + reescrita e novos casos conforme Correção #15.
  - Demais suítes da F0/F1 (`formato`, `roteador`, `manutencao`, `interacao`, `projetos`, `filtro`): todas verdes sem regressões.
- `npm.cmd --prefix app run build` (`verificar-estilo` + `vite build` + `verificar-build`): **0 violações de estilo**, **0 dados/arquivos de exemplo no build**.
- `npm.cmd run lint`: **0 erros, 0 avisos** em `frontend/js/`, `mcp/` e `app/`.
- `npm.cmd test` (raiz): **36 arquivos passando, 571 testes passando e 5 ignorados (576 total)**.
- Smoke HTTP em `npm.cmd --prefix app run dev:exemplo -- --port 5179`:
  - `GET /controle-financeiro-lapig/v2/` → `200`
  - `GET /controle-financeiro-lapig/v2/__exemplo/balancete-30901-out-26.pdf` → `200`, `application/pdf`, `4254` bytes
  - `GET /controle-financeiro-lapig/v2/__exemplo/manifesto.json` → `200`, `application/json; charset=utf-8` com os 7 fatos e `bbox`.

### Mudanças nos testes da F1 (`app/tests/projeto.test.jsx`)

- `usa o livre do resumo sem recalcular...`: atualizado o clique no destaque principal para validar o painel `DeOndeVem` (`84.300,00`, `Pessoal`, `Serviços`, sem `.aviso-falha`) e adicionado clique na linha do grupo `Pessoal` na aba `Dinheiro` abrindo `DeOndeVem` no nó `grupo:a` (`60.000,00`, `Realizado — Bolsas`).
- `oculta Pasta no Drive para professor mesmo com URL preenchida e acusa divergência...`: adaptado para configurar `explicarLivre` retornando `50.000,00` contra `resumoCentro.livre = 84.300` e verificar `AvisoFalha` no `DeOndeVem`.
- `nunca converte nulo em zero...`: no bloco do painel do destaque principal, atualizado para validar o aviso do `DeOndeVem` diante de nó com valor nulo (mantida também a conferência do painel de reserva no novo teste de fallback).
- `trata centro sem plano e centro sem balancete...`: acrescentada asserção de botão ausente (`button.valor--origem`) e novo subcaso para `situacao: 'sem números'` (`—`, `"sem números"`, sem abrir árvore).
- Casos novos adicionados:
  - `mostra carregamento, usa o painel por grupo como fallback quando explicarLivre falha e recarrega com Tentar de novo`
  - `aba Documentos abre balancete e plano preservando o id do banco na chamada de origem`

## Roteiro para conferência no navegador (Claude)

### 1. Fluxo completo em `npm --prefix app run dev:exemplo` (1280×800 e 390×844)
1. Subir `npm --prefix app run dev:exemplo` e abrir `http://localhost:5173/controle-financeiro-lapig/v2/`.
2. Abrir **Bacia do Cerrado Norte · 30.901**.
3. Clicar no Destaque **R$ 84.300** (*Livres para gastar até ago/27*):
   - Verificar `DeOndeVem` com `Pessoal`, `Serviços de terceiros (PJ)` (com nota `"compromissos fora de bolsas não são rastreados"`) e `Equipamentos e material permanente`, sem avisos de falha.
4. Expandir **Pessoal** (ver sinais `−` antes de *Realizado* e *Comprometido*):
   - Expandir **Realizado — Bolsas de pesquisa** → clicar em `7.1.3.04.01.09142` (`R$ 380.000,00`): abre `Documento` na **página 1 de 2** do PDF sintético com faixa verde suave sobre a linha e trecho literal abaixo do valor na coluna direita (`lido na página 1 (leitor balancete-parser 1.0)`). Testar troca de zoom (ex.: `150%`) e botão **Próxima página**. Fechar com `Esc`.
   - Expandir **Comprometido — Bolsas de pesquisa** → clicar em **Bolsista A**: confirmar que **não** abre `Documento` e exibe a nota no próprio painel.
   - Expandir **Previsto — Auxílio a colaboradores**: confirmar que `Auxílio a colaboradores` **não** é botão e exibe `"anterior à rastreabilidade, sem arquivo"`.
5. Fechar e expandir **Serviços de terceiros (PJ)** → **Realizado**:
   - Clicar em `7.1.3.05.01.08110` (`R$ 64.350,75`): abre `Documento` direto na **página 2 de 2** com faixa destacada. Fechar.
   - Clicar em `7.1.3.05.01.08124` (`R$ 41.549,25`, `legado` com arquivo): abre `Documento` na **página 2 de 2** com `"achado pelo código"` na coluna direita e atualiza o texto da folha no painel para `"achado pelo código"`.
6. Na aba **Dinheiro**, clicar na linha **Pessoal**: abre `DeOndeVem` já focado no nó do grupo (`R$ 58.200,00`).
7. Na aba **Documentos**, clicar no **Balancete (`balancete-30901-out-26.pdf`)**: abre `Documento` na **página 2** destacando `SALDO DISPONIVEL EM CONTA MOVIMENTO: R$ 184.250,40.`. Clicar no **Plano de trabalho**: mostra aviso no painel sem abrir janela vazia.
8. Abrir **Monitoramento de Nascentes · 30.903** → clicar em `R$ 15.750`: conferir nó `Equipamentos e material permanente` (`−R$ 4.250,00`) em vermelho (`--cor-problema`) e demais subtrações positivas em cor normal (`--cor-texto`).
9. Abrir **Mapeamento de Veredas · 30.904** e **Inventário Florestal Sul · 30.905**: confirmar `—` não clicável no Destaque principal.
10. Abrir `#/componentes` → clicar em `R$ 84.300` → clicar em `7.1.3.04.01.09142`: conferir `<DeOndeVem>` e `<Documento>` estáticos. Conferir que não há estouro horizontal a `1280×800` e `390×844` (especialmente no `Documento` em tela estreita e nas linhas da árvore).

### 2. Conferência da CSP real e worker no build (`npm --prefix app run build && npm --prefix app run preview`)
1. Subir `npm --prefix app run preview` e abrir `http://localhost:4173/controle-financeiro-lapig/v2/#/componentes` (em dev/preview com a CSP de build injetada no `dist/index.html`).
2. Antes de clicar no valor de origem, conferir na aba **Network** que apenas `index-*.js` foi baixado (nem `pdf-*.js` nem `pdf.worker.min-*.mjs` carregaram na abertura).
3. Clicar no Destaque `R$ 84.300` → expandir `Pessoal` → `Realizado` → clicar na folha `7.1.3.04.01.09142`:
   - Confirmar que `pdf-*.js` e `/controle-financeiro-lapig/v2/assets/pdf.worker.min-*.mjs` são carregados sob demanda com HTTP `200`.
   - Confirmar **zero erros de CSP** no console (`font-src 'self' data:` e `worker-src 'self' blob:`) e o PDF mínimo do catálogo renderizado no `<canvas>` com a faixa destacada.

## Desvios do contrato e dúvidas

- **Desvios do contrato**: nenhum. Todos os campos de `explicar_livre_v2`, `get_origem_v2` e `storage.from(bucket).createSignedUrl` seguem exatamente o contrato F2-A/F2-C.
- **Uso de `npm.cmd` no Windows PowerShell**: a execução de `npm.ps1` estava bloqueada pela ExecutionPolicy local, então os comandos npm foram executados via `npm.cmd`.
- **Dúvidas / observação para a integração com a F2-A**: em `Projeto.jsx`, quando `resumo_projetos_v2` traz `situacao = 'sem números'` ou `has_plano && has_balancete && grupos.length === 0`, o Destaque principal fica não clicável (`—`). Se em algum centro `resumo_projetos_v2` trouxer `livre` nulo por outro motivo ainda não mapeado na F1, `Projeto.jsx` já impede abrir a árvore.
