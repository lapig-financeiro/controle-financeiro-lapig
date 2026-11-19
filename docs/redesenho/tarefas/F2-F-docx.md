# F2-F — "De onde vem" no Word não leva à linha (19/11, achado do Victor, causa conferida pelo Claude)

Worktree `C:/Users/amara/dev/cf-f2-c`, branch nova `redesenho/f2-f-docx` a partir do `master`. Relatório em
`docs/redesenho/relatorios/F2-F.md`, commit novo. Sem push.

## O defeito

No PDF, clicar num valor abre o balancete já na linha. No DOCX o painel abre no começo do documento.

Causa (`app/src/componentes/Documento.jsx`, ramo `formatoAtual === 'docx'`): com fato `documento`, o alvo é
`{ texto: trecho }`. O `trecho` é a linha da tabela com as células juntadas por espaço (igual a
`extrairLinhasDocx` e ao `linhasDoHtmlDocx` do backfill), então o `acharAlvo` acha a `<tr>` certa pela regra 4
(texto). Mas `termosDocxPorMotivo('texto')` manda marcar **o trecho inteiro** dentro do `innerHTML` da `<tr>`,
onde o texto está partido entre `<td>`s: `marcarNoHtml` não casa, nenhum `<mark class="origem-mark">` é criado,
e o efeito de rolagem (que procura `mark.origem-mark`) não acha nada.

## Correção

1. Toda linha achada no DOCX recebe uma classe própria (ex.: `origem-linha`, com fundo de destaque no
   `Documento.css`, nos dois temas), independentemente de a marcação de termos dar certo.
2. Com fato `documento`, marque dentro dessa linha **o valor formatado** (`formatarValor` do valor do fato, e a
   forma negativa), não o trecho inteiro.
3. A rolagem procura primeiro `mark.origem-mark` e, sem ele, a `.origem-linha`.
4. O `sanitizarHtmlDocx` não pode remover a classe nova.
5. Mesmo cuidado para `legado` com motivo `texto` (rubrica/parcela num DOCX): a linha fica destacada e rolada
   mesmo quando o texto está partido entre células.

## Testes

Em `app/tests/`, com DOCX sintético (HTML de tabela como o mammoth gera, sem dado real): fato `documento` cujo
trecho junta três células → a `<tr>` certa tem `origem-linha`, o valor está dentro de `mark.origem-mark` e
`scrollIntoView` é chamado nela; um caso sem valor na linha (só a classe) também rola. `npm test` e
`npm run build` em `app/`, mais `npm run lint` na raiz, verdes.
