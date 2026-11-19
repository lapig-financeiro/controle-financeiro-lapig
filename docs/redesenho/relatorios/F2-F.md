# Relatório F2-F — "De onde vem" no Word abre na linha

Branch: `redesenho/f2-f-docx` (worktree `C:/Users/amara/dev/cf-f2-c`).
**Nada foi aplicado em produção, nada foi enviado com `git push` e nenhuma outra IA foi chamada.**

## 1. O defeito

No PDF, clicar num valor abre o balancete já na linha. No DOCX o painel abria no começo do documento.

Causa confirmada em `app/src/componentes/Documento.jsx`, no ramo `formatoAtual === 'docx'`: com fato `documento`, o alvo era `{ texto: trecho }`. O `trecho` é a linha da tabela com as células juntadas por espaço — o mesmo texto que `extrairLinhasDocx` e `linhasDoHtmlDocx` produzem. O `acharAlvo` achava a `<tr>` certa pela regra 4 (texto), mas `termosDocxPorMotivo('texto')` mandava marcar o **trecho inteiro** dentro do `innerHTML` da `<tr>`. Como o texto está partido entre `<td>`s, `marcarNoHtml` não casava, nenhum `<mark class="origem-mark">` era criado e o efeito de rolagem — que procurava só `mark.origem-mark` — não achava nada.

## 2. Correção

### 2.1. Linha própria, independente da marcação

Toda linha achada no DOCX recebe `origem-linha` antes da marcação de termos, mesmo que `marcarNoHtml` não encontre nada. Em `Documento.css` a classe ganha fundo de destaque por token (`color-mix` com `--cor-acento-suave`), inclusive nas células (`tr.origem-linha > td` e `> th`); a regra antiga baseada em `tr:has(mark.origem-mark)` foi substituída por essa.

Quando a "linha" é o próprio contêiner (DOCX sem `<p>`/`<tr>`/`<li>`, caso de `extrairLinhasDocx`), o conteúdo é envolvido em `<div class="origem-linha">` antes de serializar; se a classe fosse posta no contêiner, ela se perderia no `raiz.innerHTML` usado para gerar o HTML final.

### 2.2. Valor do fato no lugar do trecho inteiro

Com `tipoOrigem === 'documento'`, os termos marcados passaram a ser os do valor: `termosDocxPorMotivo('valor', { valor })`, que usa `formatarValor` e, para valores negativos, também a forma `-1.234,50`. O trecho continua servindo para **achar** a linha; ele não é mais o que se tenta marcar.

### 2.3. Rolagem

O efeito de rolagem procura primeiro `mark.origem-mark` e, sem ele, `.origem-linha`. Assim a linha é rolada mesmo quando o texto está partido entre células e nenhuma marca foi criada.

### 2.4. Legado com motivo texto

A marcação do legado continua com os termos do motivo (`codigo`, `reduzido`, `valor` ou `texto`). A diferença é que a linha agora também recebe `origem-linha` e é rolada quando `texto` não casa por estar dividido entre `<td>`s.

### 2.5. Sanitização

`sanitizarHtmlDocx` não remove `class`; ele só remove tags ativas, atributos `on*`, `style` e URLs fora dos esquemas permitidos. A classe nova sobrevive à sanitização que roda depois da marcação, e há teste travando isso.

## 3. Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `app/src/componentes/Documento.jsx` | Classe `origem-linha` em toda linha achada; valor (e forma negativa) como termo no fato `documento`; rolagem com fallback para a linha; invólucro no caso de contêiner raiz |
| `app/src/componentes/Documento.css` | Destaque de `origem-linha` por token, incluindo células da tabela; substituição da regra `tr:has(mark.origem-mark)` |
| `app/tests/documento.test.jsx` | 5 testes novos com DOCX sintético; stub de `scrollIntoView` restaurado no `afterEach` |
| `docs/redesenho/tarefas/F2-F-docx.md` | Arquivo da tarefa incluído no commit |
| `docs/redesenho/relatorios/F2-F.md` | Este relatório |

## 4. Testes

### 4.1. Testes novos (`app/tests/documento.test.jsx`)

1. `DOCX com fato documento destaca a linha do trecho entre três células e marca o valor` — tabela com duas linhas; o trecho de uma linha junta três células. A `<tr>` certa é a única com `origem-linha`, o `64.350,75` está dentro de `mark.origem-mark` e `scrollIntoView` é chamado na marca.
2. `DOCX com fato documento sem valor na linha destaca e rola a linha mesmo sem marca` — o trecho acha a linha, mas não há valor marcável; a linha tem `origem-linha`, nenhuma marca e `scrollIntoView` é chamado nela.
3. `DOCX de documento com valor negativo marca a forma negativa formatada` — valor `-1234,50` marca `(1.234,50)`.
4. `DOCX legado com motivo texto destaca a linha partida entre células e rola até ela` — `PESQUISA E` e `DESENVOLVIMENTO` em células diferentes; o critério fica `achado pelo texto`, a linha é destacada, não há marca e a rolagem vai para a linha.
5. `sanitizarHtmlDocx preserva a classe origem-linha`.

Os testes usam HTML de tabela sintético, no formato que o mammoth gera, sem dado real.

### 4.2. Resultados

- `npm test` em `app/`: **verde** — 13 arquivos, 86 testes.
- `npm run build` em `app/`: **verde** — guarda de estilo sem violações, Vite transformou 1690 módulos e `verificar-build` não achou dado de exemplo no bundle de produção.
- `npm run lint` na raiz: **verde** — `eslint frontend/js/ mcp/ app/` sem saída.
- Prova do mutante: com `app/src/componentes/Documento.jsx` revertido para o `HEAD` (só esse arquivo; CSS e testes mantidos), o arquivo de teste ficou **4 falhas / 11 passes** — exatamente os testes 1 a 4 acima. O teste 5 (sanitização) passa porque a classe já era preservada. O arquivo corrigido foi restaurado e o alvo voltou a 15/15.

## 5. Decisões e observações

- **O que é "valor do fato"**: a RPC devolve o valor no topo do JSON de origem (`dadosOrigem.valor`), não dentro de `fato`; `DeOndeVem` entrega esse valor na prop `valor` do `Documento`. A marcação usa essa prop.
- **Valor zero/ausente**: sem valor numérico não há termo para marcar; a linha ainda é destacada e rolada pela classe. Zero também não vira termo, coerente com `acharAlvo` (zero nunca é alvo no balancete).
- **Temas**: o app hoje tem um único conjunto de tokens em `app/src/estilo/tokens.css` (não há `prefers-color-scheme` nem variante escura implementada). O destaque usa `color-mix` com `--cor-acento-suave` e `--cor-acento`, sem cor literal, então acompanha qualquer tema definido por tokens.
- **Modal legado do frontend antigo**: `frontend/js/components/origem-documento.js` não foi tocado. A tarefa aponta o defeito em `app/src/componentes/Documento.jsx`, que é o modal do app v2.
- **Sem mudança de contrato**: nenhuma RPC, migração, dado ou arquivo de produção foi alterado; a mudança é só de apresentação no app.

## 6. Pronto quando

- [x] Linha achada no DOCX recebe `origem-linha` e fundo de destaque.
- [x] Fato `documento` marca o valor formatado (e a forma negativa), não o trecho.
- [x] Rolagem procura `mark.origem-mark` e cai para `.origem-linha`.
- [x] `sanitizarHtmlDocx` preserva `origem-linha`.
- [x] Legado com motivo `texto` destaca e rola a linha partida entre células.
- [x] `npm test` e `npm run build` em `app/` e `npm run lint` na raiz verdes.
- [x] Relatório e arquivo da tarefa no commit, sem push.
