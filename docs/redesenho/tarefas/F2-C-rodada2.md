# F2-C — 2ª rodada (correções da revisão de fase, 19/11)

Mesmo worktree e branch (`redesenho/f2-c-telas`), mesmos arquivos permitidos da `F2-C-telas.md`, mais
`docs/redesenho/relatorios/F2-C.md` (acrescente uma seção "2ª rodada"). Dois DeepSeek max revisaram o commit
853d719; o Claude conferiu os achados abaixo e a tela no navegador (o fluxo principal funciona).

## Corrigir
1. **Sanitizador do DOCX**: remover também `noscript`, `template`, `noembed`, `noframes`, `xmp`,
   `plaintext`; sem `DOMParser`, devolver `''` (falha fechada); sanitizar de novo depois de `marcarNoHtml`.
   Teste com `<noscript><p title="</noscript><img src=x onerror=alert(1)>">`.
2. **Árvore malformada não derruba a página**: validar a árvore **recursivamente** em `dados.js` (objeto,
   `rotulo`, `tipo`, `valor`, `partes` array, `ref` válido quando presente); inválida → erro → fallback por
   grupo. Os mesmos validadores valem para as respostas do modo exemplo. Acessos defensivos em
   `Projeto.jsx`/`DeOndeVem.jsx`. Teste com `partes: [null]`.
3. **Exceções**: `carregarExplicar` e `abrirDocumentoDaAba` com `try/catch` (rejeição vira `erro` e libera o
   carregando). Teste com `mockRejectedValue`.
4. **Folhas concorrentes**: estado de geração por caminho; consultar B não deixa A presa em "Consultando
   origem…"; `buscaTexto` é limpo no início de uma nova consulta e no erro. Teste com duas folhas.
5. **Clicabilidade e ramos do painel**:
   - Destaque só abre a árvore se houver grupos; se a árvore voltar com raiz nula ou sem partes enquanto o
     resumo tem número, mostrar o motivo **e** o painel por grupo de reserva (não um vazio).
   - Grupo ausente da árvore: nota neutra + reserva do grupo, **sem** "tentar de novo".
   - Raiz da árvore com valor finito e Destaque nulo → aviso de divergência.
6. **Grupo com `saldo_livre` nulo**: situação `sem dado` (não "em dia") e `motivoSemDado` "sem dado"
   quando o centro tem balancete. Teste na linha da tabela.
7. **`a_receber` ausente** não vira 0: preservar `null` e, sem ele, não classificar parcela como
   `nota_emitida`/`parcial` (mostrar "sem dados de recurso"). Teste.
8. **Documento**:
   - O critério usa a página efetivamente aberta quando a busca mudou de página.
   - Faixas são limpas ao trocar de página/zoom (ou guardadas com a página delas); teste com `getPage`
     atrasado e clique em "Próxima página".
   - Erro de download limpa o critério ("não foi possível ler o documento").
   - `legado` sem `busca` (ou sem nenhum de `conta_codigo`/`texto`/`valor`) não chama `acharAlvo`: abre na
     página 1 sem faixa.
   - DOCX: código cortado `prefixo#reduzido` exige os dois na mesma linha/linha de tabela (equivalente ao
     `acharAlvo`); `valor: ''` não vira 0.
   - Teste com os quatro valores exatos da faixa (bbox e viewport conhecidos, `devicePixelRatio` 1 e 2).
9. **Aba Documentos**: arquivo ausente é nota/`Vazio`, não `AvisoFalha`.
10. **Painel de reserva**: comparar em centavos (`Math.round(x*100)`), sem tolerância de 0,01.
11. **Exemplo fora do build**:
    - Manifesto gerado leva o sentinela `__EXEMPLO_CF__`.
    - O usuário de exemplo de `App.jsx` (`Admin de exemplo`, `exemplo@lapig.ufg.br`) sai do bundle de
      produção: use `import.meta.env.DEV` direto na condição, para o Rollup eliminar o bloco. O
      `verificar-build` procura essas strings e há teste que reprova um bundle com elas.
12. **CSP**: o `<meta>` vai para o **começo** do `<head>`, antes de qualquer `<script>`/`<link>`. Teste no
    `dist/index.html`.
13. **Testes que não provavam**:
    - `pdf-exemplo.test.js` lê os valores do PDF gerado e compara com as folhas de
      `dadosExemplo.explicarLivre` de 30.901.
    - `dados.test.js` passa por `dados.js` com o modo exemplo ligado (`vi.stubEnv`) e afirma zero chamadas ao
      Supabase.
    - Todas as árvores de `ARVORES_EXEMPLO` são conferidas (fecham e batem com o resumo).
    - `origem-declarada.test.js` varre subpastas e reprova `origem` em ternário com ramo nulo quando não há
      `semOrigem`.

## Pronto quando
`npm --prefix app test`, `npm --prefix app run build`, `npm run lint` e `npm test` verdes; relatório
atualizado (quais testes mudaram); commit novo na branch. Sem push.
