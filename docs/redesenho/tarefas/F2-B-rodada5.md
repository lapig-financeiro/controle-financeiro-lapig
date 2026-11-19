# F2-B — 5ª rodada (revisões MiniMax max e GLM 5.3 do commit 40d2d57, 19/11, conferidas pelo Claude)

Mesmo worktree e branch da 4ª rodada (`redesenho/f2-b-rodada4`). Seção "5ª rodada" no relatório, commit novo. Sem
push, sem produção, sem `CF_*`. Nenhum achado alto; corrigir:

1. **Prefixo mais estreito** (GLM 2, MiniMax 5): em `contaComReduzido`, o prefixo passa a ser os cinco primeiros
   segmentos **mais `.` e o primeiro caractere do sexto** (`7.1.3.02.01.00002` → `7.1.3.02.01.0#2503002`). Sem
   sexto segmento, não há alternativa. Assim a agregação `7.1.3.02.01 25213231 ...` e um ramo vizinho
   `7.1.3.02.012 2503002 ...` deixam de casar o prefixo. Testes com as duas linhas (nenhuma serve) e com
   `7.1.3.02.01.0 2503002` e `7.1.3.02.01.00 2503002` (as duas servem, cada uma sozinha).
2. **Sinônimos** (MiniMax 1 e 2), sem perder a distinção UFG × UA:
   - `dao`: `D.A.O da Fundação` e `D.A.O. da Fundação`;
   - `cip_ua`: `Custos indiretos para a UA`, `Custos indiretos para a Unidade`, `Custos indiretos para a Órgão`
     não — use só as duas primeiras (a primeira já cobre `UA/Órgão` e `UA / Órgão`);
   - `cip_ufg`: inalterado.
   Teste: nenhum sinônimo de `cip_ua` casa `Custos indiretos para a UFG ...` e nenhum de `cip_ufg` casa as linhas
   da UA. Esse teste usa o `SINONIMOS_RUBRICA` real, não um alvo escrito à mão (MiniMax 6).
3. **Testes** (GLM 1, MiniMax 7): acrescente o caso de conta repetida no raw com o **mesmo** reduzido (vale como
   um só) ou corrija a frase do relatório; a linha cortada do PDF sintético do ponta a ponta passa a ter as cinco
   colunas do layout (`0,00 21.496,58 0,00 21.496,58 21.496,58`).
4. **Só registrar no relatório, sem mudar código**: linha repetida na quebra de página continua ambígua (MiniMax
   3; na simulação de 19/11 foram 2 ambíguos ao todo); lançamento de conta redutora (banco negativo, PDF
   positivo) continua `legado` (MiniMax 4); linha única com "UFG e UA" (GLM 3) não ocorre nos planos medidos.
