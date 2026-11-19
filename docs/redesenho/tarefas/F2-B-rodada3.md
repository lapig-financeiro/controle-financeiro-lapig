# F2-B — 3ª rodada (revisão MiniMax max dos commits 237ce44 + 0b175b3, 19/11, conferida pelo Claude)

Mesmo worktree, branch e arquivos (pode acrescentar `tests/fixtures/cpf-casos.json`). Seção "3ª rodada" no
relatório, commit novo. Sem push, sem produção. Nenhum achado alto; corrigir:

1. **`raw_extraction` nos dois formatos**: `lancamentosEsperados` lê `objeto?.lancamentos ??
   objeto?.data?.lancamentos` (e o guarda de forma aceita os dois). Fixture e teste nos dois formatos.
2. **Filtros `in.(...)` fatiados** em blocos de no máximo 50 ids/chaves por requisição, mesclando os
   resultados. Teste com 200 ids no cliente falso que confira o tamanho de cada URL.
3. **`raw_extraction` sob demanda**: não venha na listagem; busque por balancete na hora de processá-lo.
4. A frase de "já registrado" no terminal é exatamente `documento já registrado, N fatos novos ignorados`
   (ou README e relatório passam a dizer a frase do código — escolha uma e alinhe os três).
5. **Teste de descarte por divergência**: banco com `1234.56`, documento com `(1.234,56)` → o fato não entra no
   payload e a contagem `divergencia` sobe (ou, se o parêntese for um negativo legítimo, trate-o como `-1234,56`
   e prove que só o sinal certo passa).
6. **Testes da linha de total**: no ponta a ponta, "total repete código e valor" → sem fato (ambíguo); "total
   repete só o valor" → fato na linha certa.
7. **Casos de CPF num fixture único** `tests/fixtures/cpf-casos.json` com os verdadeiros/falsos da "Regra de CPF
   única"; o teste do script lê esse arquivo. (A 065 usa vão 0–6, como o script.)
8. Relatório: corrija a frase sobre cobertura das quatro checagens da 064 para o que o teste realmente cobre
   (ou acrescente o caso de 5+ separadores).
9. Candidatos com valor nulo entram numa contagem `sem_valor` no resumo.
10. Corte de 500 por caracteres reais (`Array.from(texto).slice(0, 500).join('')`), sem partir par substituto.
11. 403 no download por URL assinada é "assinatura expirou/recusada" (refaz a assinatura uma vez), não "login
    expirou".
