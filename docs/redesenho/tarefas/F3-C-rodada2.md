# F3-C — 2ª rodada (revisões MiniMax max e DeepSeek max cego de 4c7dbc4, conferidas pelo Claude, 20/11)

Mesmo worktree e branch. Seção "2ª rodada" no relatório `docs/redesenho/relatorios/F3-C.md`, commit novo. Sem push. Os
`.sql` 060–068 seguem LF e `skip-worktree` (não editar nem commitar). Não chame outras IAs.

## Banco (`database/069_motivos_e_ajustes.sql`)

1. **Texto do grupo negativo diz "gasto" quando o negativo vem de compromisso** (alto). `saldo_livre = previsto −
   realizado − compromissos` (066). Use `previsto`, `realizado` e `compromissos` do próprio grupo em `p_sl`:
   - parte do gasto: `excesso_gasto = greatest(realizado − previsto, 0)`;
   - parte dos compromissos: o resto do negativo (`−saldo_livre − excesso_gasto`, se > 0).
   Texto do `saldo_negativo`, montando só as frases que se aplicam: "Rubrica b — Nome: saldo livre R$ −X." + "Gasto R$ A
   acima do previsto." + "R$ C de bolsas/taxas já comprometidas até o fim não cabem no previsto." (+ a frase da tarifa,
   item 2, quando houver). `valor` = o negativo (`−saldo_livre`, positivo). Teste com bolsa comprometida (previsto
   1.000, realizado 800, compromissos 300 → só a frase de compromisso) e com os dois.
2. **O valor do motivo da tarifa não bate com o saldo ao lado** (médio). Quando o negativo cabe na tarifa, texto: "Rubrica
   b — Nome: saldo livre R$ −X por causa de R$ Y de tarifa bancária sem previsão no plano; sem ela, ficaria dentro do
   previsto. É cobrança comum da FUNAPE; vale prever no próximo remanejamento." `valor` = X (o negativo), e acrescente
   `tarifa` = Y no objeto do motivo. Quando passa da tarifa (problema), a frase "R$ Y disso é tarifa bancária sem
   previsão" continua. Regra de classificação inalterada.
3. **Balancete relido** (médio): use `nullif(p_sl ->> 'balancete_id', '')::uuid` (o 066 já devolve) em vez de refazer o
   "mais recente". Sem esse campo, não aplique a exceção da tarifa (fica `problema`).
4. **`grupos` ausente ou malformado vira "em dia"** (médio): com plano e balancete, se `p_sl -> 'grupos'` não for array,
   devolva `sem dado` com o motivo `falha`.
5. **Falha só do motivo apaga o saldo** (médio): no `resumo_projetos_v2`, chame o helper num bloco `begin … exception`
   próprio, dentro do bloco do centro. Se só o helper falhar, mantenha `livre`, `data_referencia` e a situação pela regra
   antiga (063) e use `motivos` = `[{"codigo":"falha",…}]` literal (sem chamar o helper de novo no handler). O handler
   externo (falha do `get_saldo_livre`) também usa o literal, nunca o helper. Teste com o helper quebrado por mutante.
6. Asserções mais firmes (médio): o lock de `apagar` tem de casar a chave inteira
   (`hashtextextended('caixas_pedido:' || …`) e vir antes do `delete`; o `dono = auth.uid()` tem de estar no mesmo
   `select … from public.caixas_pedido … for update` (âncora no trecho, não regex solta); use `position()` em vez de
   `like` com `_`.

## Teste e runner

7. Caixa alheia no `salvar_caixa_pedido_v2`: usar a caixa real do outro dono (a `…b01`), conferir `P0002` **e** que nome
   e meses dela não mudaram.
8. Mutantes novos: sem `dono = auth.uid()` em `colocar` (além do `salvar`); ordem de `saiu_de` trocada de volta para
   `c.nome, c.id` (o teste de origem/`saiu_de` tem de pegar); helper quebrado (item 5: o resumo continua devolvendo o
   centro com `livre` certo e motivo `falha`); `grupos` não-array (item 4).
9. No BLOCO 0 (antes da 069), rode `resumo_projetos_v2` no centro de tarifa e asserte `problema` (o defeito que o
   Victor viu). Rode também o resumo como professor (b1) depois da 069.

## App

10. **Toque no selo dentro da linha-link** (médio, `Projetos.jsx` + `LinhaDeLista`): com motivos, `onClick` no selo faz
    `preventDefault` + `stopPropagation` e alterna o balão (abrir/fechar); o resto da linha continua abrindo o centro.
    Teste: clicar no selo não navega e abre o balão; clicar fora fecha.
11. **Balão fecha antes de dar para ler** (baixo): mantenha aberto enquanto o ponteiro estiver no selo **ou** no balão
    (fechamento com atraso de ~150 ms, cancelado ao entrar no balão; `pointer-events: auto` no balão).
12. **Falha da RPC nova é engolida** (médio): fallback silencioso só para `42883`/`PGRST202` (RPC ainda não aplicada).
    Outra falha: aviso discreto no topo do centro "Não foi possível carregar o motivo dos selos." (componente
    `AvisoFalha`) e os selos pela regra antiga. Teste dos dois caminhos.
13. **Um motivo inválido derruba a lista inteira** (baixo): no validador do resumo e de `situacaoCentro`, descarte só os
    motivos inválidos (e registre `console.warn`), sem recusar o payload. Ajuste o teste.
14. Modo exemplo: `situacaoCentro` respeita os centros ocultos como `resumoProjetos`.

`npx vitest run` (raiz e app), `npm run lint`, build do app, `rodar-069-pglite.mjs` e `rodar-068-pglite.mjs`: verdes.
Confira na tela (`npm run dev:exemplo`, 1400 px e 390 px) o toque no selo da lista e o balão, e descreva no relatório.
