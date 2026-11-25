# Folha atrasada — migração 070 (25/11, pedido do Victor)

Worktree `C:/Users/amara/dev/cf-folha-banco`, branch `redesenho/folha-atrasada-banco` (do `master` 620f19a,
`node_modules` instalados). Relatório em `docs/redesenho/relatorios/folha-atrasada-banco.md`, **um commit no fim**
(`fix(banco): ...`). **Sem push. Não aplique a migração em lugar nenhum além da réplica local (PGlite). Não chame
outras IAs.** Nenhum dado real (nome, CPF, código ou nome de centro real, valor copiado de balancete) em teste,
roteiro ou relatório: use centros e pessoas sintéticos.

Leia antes, inteiros: `AGENTS.md` (regras de migração), `docs/aplicar-migracao.md` (restrições do cofre:
BEGIN/COMMIT, palavras recusadas, 90 KB), `database/048_janela_compromissos_dia_pagamento.sql` (a janela do dia 07),
`database/066_taxas_comprometidas.sql` (a versão **viva** de `get_saldo_livre`; confirme com grep que nenhuma
migração depois dela redefine `get_saldo_livre` nem `explicar_livre_v2`, e use a última definição de cada uma como
base), `tests/sql/test_066_taxas_comprometidas.sql` e `tools/replica-local/rodar-066-pglite.mjs` (molde do roteiro e
do executor), a linha da 066 e da 069 em `docs/migracoes.md`.

## O defeito

`get_saldo_livre` supõe que o balancete de data D já contém a folha de bolsas de todo mês até `balancete_cobre_ate`
(o mês de D se D passou do dia 07, senão o anterior), e só conta compromissos a partir do mês seguinte. Quando a
FUNAPE paga uma folha **atrasada** (depois da data do balancete), esse dinheiro não está no realizado **nem** nos
compromissos: aparece como **livre**, mas já tem dono. Medido na produção em 25/11 (só leitura): acontece em
alguns centros, tanto com balancete emitido antes do dia 07 (folha do mês anterior paga com atraso) quanto com
balancete emitido depois do dia 07 (folha do próprio mês ainda fora do balancete).

## A regra nova (conferir a folha contra os balancetes anteriores)

Constante nova `c_meses_conferencia constant integer := 6`. Com `cober(x)` = último mês coberto pelo balancete x
(mesma regra da 048: mês de x se o dia > 07, senão o anterior):

1. D = o balancete mais recente (o mesmo que a função já usa). `real(x)` = soma de `saldo_atual` das linhas de
   `balancete_lancamentos` do balancete x com `rubrica_code = 'a.bolsas'` (mesma fonte do `realizado`).
2. Candidatos k: balancetes **anteriores** do mesmo projeto com `cober(k) < cober(D)` e
   `cober(k) >= cober(D) − c_meses_conferencia meses`.
3. Para cada k: `esperado_k` = soma, para cada mês m em `(cober(k), cober(D)]`, da folha do mês m = soma de
   `amount` das bolsas do projeto com `status <> 'cancelled'` que se sobrepõem ao mês m (**o mesmo critério de
   sobreposição** do bloco de compromissos: `start_date <= fim do mês` e `end_date >= início do mês`, via
   `generate_month_series`). `visto_k = real(D) − real(k)`. `falta_k = esperado_k − visto_k`.
4. `falta = greatest(max(falta_k), 0)`, arredondado a centavos; abaixo de R$ 0,01 é zero. O k que deu o máximo é o
   "balancete de comparação" (em empate, o mais recente).
5. Se `falta > 0`: soma `falta` a `v_compromissos` (portanto a `compromissos_bolsas`, ao compromisso de `a.bolsas` e
   ao `saldo_livre` do grupo e do total, que já derivam dele) e acrescenta um aviso:
   `format('A folha de bolsas de %s não aparece toda no balancete de %s: faltam R$ %s (esperado R$ %s desde o balancete de %s, visto R$ %s). A diferença conta como compromisso até aparecer.', <mês ou "MM/AAAA a MM/AAAA">, <DD/MM/AAAA de D>, ...)`
   com valores em formato pt-BR (`to_char(..., 'FM999G999G990D00')` com `lc_numeric` não garantido: formate com
   `replace` como já se fizer na base, ou documente a escolha).
6. Por que o máximo e não só o balancete imediatamente anterior: com duas folhas atrasadas, só o par mais longo vê as
   duas. Por que nunca negativo: bolsa antiga que não está cadastrada faz `esperado` ficar abaixo do visto; isso não
   pode virar dinheiro livre. A conferência só **acrescenta** compromisso (erra para "cabe menos", o lado seguro,
   como a 048).

Chaves novas no retorno (aditivas; nenhuma chave existente muda de nome, tipo ou significado, exceto os valores que
derivam de `v_compromissos` quando `falta > 0`):

```
'folha_conferencia': 'feita' | 'sem_balancete_anterior' | 'sem_balancete',
'folha_atrasada': null | {
  'valor': <falta>, 'esperado': <esperado_k>, 'visto': <visto_k>,
  'desde_balancete': <data_referencia de k>, 'balancete': <data_referencia de D>,
  'mes_inicio': <primeiro dia do mês cober(k)+1>, 'mes_fim': <primeiro dia do mês cober(D)>
}
```

`folha_atrasada` é `null` quando `falta = 0` ou a conferência não foi feita. Atualize a `nota` do retorno com uma
frase sobre a conferência. **Sem plano ativo** a função continua devolvendo cedo como hoje (não acrescente nada lá).

## `explicar_livre_v2`

A árvore de "por que o livre é X" tem de continuar fechando (a soma das partes = `saldo_livre`). Acrescente, quando
`folha_atrasada` não for nulo, a parte `Comprometido — folha atrasada` sob a rubrica de bolsas, sinal −1,
`conta = 'folha esperada que o balancete ainda não mostra'`, valor `falta`, no mesmo estilo da parte das taxas da 066.
Confira como a árvore hoje monta o compromisso de bolsas (talvez ela já some `compromissos` inteiros e então a parte
nova duplicaria: nesse caso a parte nova **separa** o valor dentro do nó existente, sem duplicar). Prove no roteiro
que a soma fecha com e sem folha atrasada.

## Quem mais consome

Liste no relatório (grep) todo consumidor de `get_saldo_livre`: `simular_alocacao` (039), `panorama` (040),
`resumo_projetos_v2` (063), `_situacao_centro` (069), `frontend/js/pages/planejamento.js`,
`frontend/js/pages/plano-trabalho.js`, `frontend/js/ai/tools.js`, `mcp/src/tools.js`, `app/`. Para cada um diga se
o número muda quando há folha atrasada (deve mudar para baixo, coerente) e se algo quebra. **Não altere** nenhum
deles nesta tarefa; o site antigo vai mostrar o livre menor quando houver folha atrasada, como aconteceu na 048 e
na 066 (é correção de cálculo; o Victor decide ao aprovar a migração).

## Entregáveis

- `database/070_folha_atrasada.sql`: cabeçalho no estilo da 048/066 (o defeito, a regra, o que não muda, conferência),
  `create or replace` repetindo `security definer`, `set search_path = public, pg_temp`, o guard
  `assert_project_allowed` e tudo o que a 066 tem; **sem `drop`** (a ACL da 035 fica). Diff mínimo sobre o corpo da
  066 (não reescreva o resto). Asserções no fim do `.sql`. Respeite as restrições do cofre.
- `tests/sql/test_070_folha_atrasada.sql` autoconferido + `tools/replica-local/rodar-070-pglite.mjs`, provando:
  sem folha atrasada nada muda (compare antes/depois da 070 o retorno inteiro de um centro sintético, chave a chave,
  exceto as duas chaves novas e a `nota`); um atraso de um mês (o caso de 03/11 com folha de outubro paga depois);
  dois meses; balancete com dia > 07 cuja folha do próprio mês não veio; bolsa antiga não cadastrada (falta
  negativa → 0); só um balancete (`sem_balancete_anterior`); sem balancete; bolsa cancelada não conta; candidato
  fora da janela de 6 meses ignorado; empate; a árvore do `explicar_livre_v2` fechando; atributos em `pg_proc`
  (`prosecdef`, `proconfig`) e ACL iguais aos de antes; o BLOCO 1 de `tests/sql/test_051_buriti_propostas.sql`
  (gatilho que barra o agente) passando; e **mutantes** (pelo menos: sem o `greatest(...,0)`, só o par imediato,
  `status = 'active'` no lugar de `<> 'cancelled'`, `>=` trocado na janela, soma sem arredondar) que o roteiro
  reprova.
- Linha nova em `docs/migracoes.md` no estilo das outras.
- `npm run lint` e `npm test` verdes na raiz.

Precisou mexer em arquivo fora desta lista? Pare e registre no relatório.
