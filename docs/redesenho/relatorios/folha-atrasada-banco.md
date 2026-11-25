# Relatório — Migração 070: folha atrasada

Branch `redesenho/folha-atrasada-banco` (worktree `C:/Users/amara/dev/cf-folha-banco`, a partir do `master`
620f19a). **Nada foi aplicado em produção**, nenhum `CF_*` real foi usado, nenhum dado real (nome, CPF,
código ou nome de centro, valor de balancete) entrou em teste, stub, roteiro ou neste relatório. **Não chamei
outra IA** nesta execução (a revisão do GPT-6.2 Sol veio pronta no pedido, já conferida pelo Claude) e **não
houve push**. O runner do PGlite rodou só em memória.

## 1. O que foi entregue

| Arquivo | Mudança |
|---|---|
| `database/070_folha_atrasada.sql` | `create or replace` de `get_saldo_livre` (base 066) e de `explicar_livre_v2` (base 066); nenhuma tabela/linha nova |
| `tests/sql/test_070_folha_atrasada.sql` | Roteiro autoconferido (blocos 1–13) |
| `tools/replica-local/sintetico/stub-070.sql` | Stub sintético com 14 centros `70.*` (auxiliar do roteiro, como o `stub-066.sql`) |
| `tools/replica-local/rodar-070-pglite.mjs` | Executor PGlite: base 064/065/066, defeito antes (por número), cofre, antes/depois, idempotência, barreira 051, atributos/ACL e 7 mutantes |
| `docs/migracoes.md` | Linha da 070 ("não aplicada em produção") |
| `docs/redesenho/relatorios/folha-atrasada-banco.md` | Este relatório |

Nenhum arquivo fora da lista de entregáveis foi alterado. `tools/replica-local/sintetico/stub-070.sql` é
arquivo **novo** de apoio ao roteiro (o molde da 066 também tem `stub-066.sql`), não uma alteração de
consumidor.

A migração tem 48.401 bytes (limite do cofre: 90 KB), começa com `begin;` como primeiro comando SQL, termina
com `commit;` como último, não tem `commit`/`savepoint` no meio nem os termos proibidos do cofre. O roteiro
tem 31.737 bytes, o runner 20.094 e o stub 21.478.

## 2. A versão viva e o defeito

Confirmei por `grep` em `database/` que **nenhuma migração depois da 066 redefine `get_saldo_livre` nem
`explicar_livre_v2`**: a 067, a 068 e a 069 só citam as funções em comentário/consumo. A base usada foi a
definição da 066, que é a versão viva.

O defeito: `get_saldo_livre` supõe que o balancete de data D já contém a folha de bolsas de todo mês até
`cober(D)` (mês de D se o dia > 07, senão o anterior) e só conta compromissos a partir do mês seguinte. Uma
folha paga **depois** da data do balancete não está no realizado **nem** nos compromissos: aparece como livre,
mas já tem dono. O caso sintético do roteiro reproduz o formato do defeito: balancete de 03/11/2026 (cobre
10/2026) com a folha de outubro paga depois; ela some do realizado e a janela de compromissos já começa em
11/2026.

## 3. A regra da 070

Depois do bloco de compromissos de bolsas (e antes do rollup por rubrica), com `cober(x)` igual ao da 048:

1. `real(x)` = soma de `saldo_atual` das linhas de `a.bolsas` do balancete x.
2. Candidatos `k`: balancetes anteriores do mesmo projeto com `cober(k) < cober(D)` e
   `cober(k) >= cober(D) − 6 meses` (`c_meses_conferencia = 6`).
3. `esperado_k` = soma de `amount` das bolsas do projeto com `status <> 'cancelled'` que se sobrepõem a cada
   mês de `(cober(k), cober(D)]`, pelo mesmo critério de sobreposição do bloco de compromissos
   (`start_date <= month_end` e `end_date >= month_start`, via `generate_month_series`).
4. `visto_k = real(D) − real(k)`; `falta_k = esperado_k − visto_k`.
5. `falta = round(greatest(max(falta_k), 0), 2)`; abaixo de R$ 0,01 é zero. O par que deu o máximo é o
   "balancete de comparação"; no empate, o mais recente (`data_referencia desc`).
6. `falta` é somada a `v_compromissos` **sempre** (somar zero é inócuo), e o aviso + o objeto
   `folha_atrasada` só aparecem quando `falta > 0`.

O máximo (e não só o balancete imediatamente anterior) é o que vê duas folhas atrasadas: no caso de dois
meses, o par imediato vê uma folha e o par mais longo vê duas. O `greatest(..., 0)` protege o caso de bolsa
antiga não cadastrada: o esperado fica abaixo do visto, a falta vira negativa e **não pode** diminuir o
compromisso (o teste `70.BOLSA_ANTIGA` cobre isso; o mutante sem `greatest` é reprovado).

O aviso usa `public._fmt_brl_num` (064), que formata `1.234,50` independente de `lc_numeric` — a escolha está
registrada no cabeçalho do SQL e no roteiro. O rótulo do intervalo é `MM/YYYY` quando é um mês e
`MM/YYYY a MM/YYYY` quando são vários.

Chaves novas no retorno (aditivas):

```
'folha_conferencia': 'feita' | 'sem_balancete_anterior' | 'sem_balancete'
'folha_atrasada': null | {
  'valor', 'esperado', 'visto',
  'desde_balancete', 'balancete',
  'mes_inicio', 'mes_fim'
}
```

Sem plano ativo, o retorno antecipado continua exatamente o de hoje (não ganhou chave nenhuma). Sem
balancete, `folha_conferencia = 'sem_balancete'`; com balancete e nenhum candidato,
`'sem_balancete_anterior'`; com candidato, `'feita'` mesmo quando `falta = 0`.

### 3.1. `explicar_livre_v2`

A árvore continua fechando ao centavo. O nó `Comprometido — Bolsas` passava a valer o compromisso inteiro
(incluindo a folha atrasada), mas suas partes são só as bolsas da janela (`bolsas_ativas`), que **não** contêm
a falta — então ele deixaria de fechar. A 070 **separa** o valor dentro do nó existente:

- `rubrica:a.bolsas:comprometido` passa a valer `compromissos − falta` (só a janela), com as mesmas partes;
- novo nó `Comprometido — folha atrasada` (`rubrica:a.bolsas:folha_atrasada`), sinal −1, valor `falta`, conta
  `'folha esperada que o balancete ainda não mostra'`, com duas partes:
  - `Folha esperada de MM/AAAA [a MM/AAAA]` (`:folha_esperada:comprometido`), sinal +1, valor `esperado`, com
    uma folha por bolsa/mês (mesmo formato de `bolsas_ativas`);
  - `Folha já no balancete de DD/MM/AAAA` (`:folha_vista:realizado`), sinal −1, valor `visto`, com as linhas
    de `a.bolsas` de D (+) e do balancete de comparação (−). Só entra quando `visto <> 0`; sem visto, o nó do
    esperado sozinho fecha a falta.

Os sufixos `:comprometido` e `:realizado` nas chaves das partes novas não são enfeite: o verificador do
`test_064` confere o tipo da folha pelo sufixo do pai (`:comprometido` → `scholarships`, `:realizado` →
`balancete_lancamentos`). **O `test_064` não foi alterado**; a escolha de nome mantém o roteiro existente
passando.

## 4. Consumidores de `get_saldo_livre` (grep)

Nenhum consumidor foi alterado. Todos recebem o livre menor quando há folha atrasada, como aconteceu na 048 e
na 066.

| Consumidor | Como usa | O que muda com folha atrasada | Quebra? |
|---|---|---|---|
| `database/039_simular_alocacao.sql` | `grupos[].saldo_livre` (teto orçamentário), `compromissos_inicio/fim`, `avisos` | Teto e `saldo_livre_realocavel` caem; o aviso novo é copiado para o item | Não; fica mais conservador |
| `database/040_panorama.sql` | soma `grupos[].saldo_livre`; copia `compromissos_bolsas` e `avisos` | `saldo_livre` do panorama cai; aviso novo aparece | Não |
| `database/063_redesenho_f1.sql` (`resumo_projetos_v2`) | soma `grupos[].saldo_livre`; situação por grupo negativo | `livre` cai; um grupo pode virar negativo e o centro passar a `problema` | Não; é a regra de hoje com número menor |
| `database/069_motivos_e_ajustes.sql` (`_situacao_centro`, `resumo_projetos_v2`, `situacao_centro_v2`) | grupo `saldo_livre` e `compromissos` | Mesma possibilidade de `problema` e de mudar a frase "R$ C ... não cabem no previsto" | Não |
| `frontend/js/pages/planejamento.js` | `compromissos_bolsas`, `grupos[].livre`, `caixa`, `data_referencia` | O dinheiro disponível cai; a falta é uma folha já devida, então descontar do caixa do balancete é coerente | Não |
| `frontend/js/pages/plano-trabalho.js` | `compromissos`/`saldo_livre` por rubrica; lista `bolsas_ativas` | A rubrica de bolsas mostra o compromisso maior; a lista "já contratados" continua só a janela | Não; a lista não soma o compromisso, mas não é usada como total |
| `frontend/js/ai/tools.js` | devolve o JSON bruto da RPC | As chaves novas chegam ao Assistente; a descrição ainda não as explica | Não; melhoria de texto pendente |
| `mcp/src/tools.js` (e `mcp/src/index.js`) | devolve o JSON bruto | Idem | Não |
| `app/src/servicos/dados.js` + `app/src/paginas/Projeto.jsx` | valida e desenha a árvore e os grupos | Livre menor; o nó novo passa em `validarNoArvore` e `verificarFechamentoArvore` | Não |
| `app/src/servicos/projecao.js` | `bolsas_ativas` + `compromissos_bolsas` | `compromissos_bolsas` inclui a falta, mas `bolsas_ativas` não; a projeção emite o aviso "A soma das bolsas ... difere do compromisso da janela" | **Não quebra, mas dá um aviso indevido** até aprender `folha_atrasada` |
| `app/src/paginas/Projetos.jsx` | via `resumo_projetos_v2` | Livre menor | Não |
| `frontend/js/planejamento-motor.js` / `planejamento-dinheiro.js` | `compromissos_bolsas`, `grupos[].livre` | Mais conservador; a falta é descontada uma vez (é teto alternativo, não soma) | Não |
| `app/src/servicos/dadosExemplo.js` | dados de exemplo | Não tem `folha_atrasada`; o modo exemplo fica como está | Não |
| `app/src/util/formato.js` | comentário | — | — |

O ponto de atenção real é a projeção do `/v2/`: ela compara `soma(bolsas_ativas)` com `compromissos_bolsas`
para avisar de divergência. Com folha atrasada, a divergência é **esperada** (a falta não está em
`bolsas_ativas` por desenho), então o aviso fica indevido até a projeção descontar `folha_atrasada.valor` ou
receber a folha atrasada em uma lista própria. Fica registrado como ajuste de consumidor, fora desta
migração, conforme a instrução de não alterar consumidores.

## 5. Conferência

`node tools/replica-local/rodar-070-pglite.mjs` passou de ponta a ponta. O que ele prova:

- **Defeito antes**: com a 066 (sem a 070), o `test_070` falha em `70.UM_MES` por **número**:
  `a.bolsas livre deveria ser 17000 (a 066 daria 25000), veio 25000.00`. Não depende de chave nova.
- **Sem folha atrasada nada muda**: o retorno inteiro de seis centros sintéticos foi comparado chave a chave
  antes/depois; só `folha_conferencia`, `folha_atrasada` e `nota` diferem. As seis árvores de
  `explicar_livre_v2` são idênticas à 066.
- **Casos**: um mês (03/11 com a folha de outubro paga depois, incluindo bolsa encerrada e cancelada), dois
  meses (o par mais longo vence o imediato), balancete com dia > 07 sem a folha do próprio mês, bolsa antiga
  não cadastrada (falta negativa → 0, sem diminuir compromisso), bolsa que termina no meio do mês, só um
  balancete, sem balancete, bolsa cancelada, candidato exatamente no limite de 6 meses e candidato fora,
  empate (vence o mais recente).
- **Árvore**: raiz = soma dos grupos = `get_saldo_livre`; todos os nós fecham; o nó
  `Comprometido — folha atrasada` tem valor, sinal −1 e conta; o nó da janela vale só a janela; com e sem
  falta.
- **Atributos/ACL**: `prosecdef`, `proconfig = search_path=public, pg_temp`, `provolatile` e `proacl` iguais
  antes/depois; `authenticated` mantém EXECUTE, `anon`/PUBLIC não têm.
- **Barreira 051**: BLOCO 1 passa (nenhuma tabela sem `trg_bloqueia_agente`).
- **Regressão**: `test_064`, `test_065` e `test_066` passam depois da 070 e de novo depois de reaplicá-la
  (idempotência).
- **Mutantes reprovados**: sem `greatest(..., 0)`; só o par imediato (sem o máximo); `status = 'active'` no
  lugar de `<> 'cancelled'`; `>=` trocado por `>` na janela de 6 meses; soma sem arredondar;
  `explicar_livre_v2` sem separar a folha (duplicaria); e a sobreposição trocada por "cobre o mês inteiro"
  (a bolsa que termina em 15/10 sai do esperado). As mensagens estão no log do runner.

O mutante "soma sem arredondar" é reprovado por uma asserção **estrutural** do roteiro (a definição tem de
conter `round(greatest(coalesce(v_max_falta, 0), 0), 2)`), porque o schema só guarda centavos em
`scholarships.amount` e `balancete_lancamentos.saldo_atual` (`numeric(14,2)`), então a soma exata é sempre de
centavos e o arredondamento não tem efeito observável. Está registrado no próprio teste para não parecer
equivalente sem explicação.

`npm run lint` passou. `npm test` passou (44 arquivos, 699 testes, 5 pulados) depois de instalar as
dependências do MCP com `npm ci --prefix mcp` (o `mcp/node_modules` não existia no worktree; não é mudança
versionada).

## 6. 2ª rodada (revisão do GPT-6.2 Sol, conferida pelo Claude)

Esta rodada **não muda a regra**: fecha uma lacuna de teste, troca a prova do defeito para um número e
documenta dois limites conhecidos, sem corrigi-los.

### 6.1. Bolsa que termina no meio do mês

Caso novo `70.FIM_MEIO_MES`: uma bolsa `ended` com fim em **15/10/2026** e valor 4.000; o balancete D é de
03/11/2026 (cobre 10/2026) e o k é de 03/10/2026, sem pagamento de outubro no realizado. Pelo critério de
sobreposição (`start_date <= fim do mês` e `end_date >= início do mês`), ela entra **inteira** no esperado de
outubro: `falta = 4.000`. O mutante novo troca o predicado por "cobre o mês inteiro" (`start_date <= início do
mês` e `end_date >= fim do mês`), exclui a bolsa, zera a falta e é reprovado por
`70.FIM_MEIO_MES deveria contar a bolsa que termina em 15/10 inteira (4000), veio 0`.

### 6.2. Defeito antes da 070 por número

A primeira asserção do BLOCO 2 do `test_070` passou a ser monetária: `a.bolsas` livre de `70.UM_MES` tem de
ser **17.000**; a 066 devolve **25.000**, porque os 8.000 da folha de outubro estão livres. O runner agora
espera essa falha (`070 FALHOU: 70.UM_MES a.bolsas livre deveria ser 17000 (a 066 daria 25000), veio
25000.00`) e não depende mais da ausência de `folha_conferencia` para provar o defeito.

### 6.3. Limites conhecidos (documentados, não corrigidos)

**(a) Baixa de bolsa antiga no balancete recente.** `70.BAIXA_ANTIGA` tem uma bolsa corrente de 5.000 e uma
bolsa antiga de 5.000 encerrada em 30/09/2026; o pagamento/baixa da antiga entrou no balancete de D (5.000) e
o k não tinha linha de bolsas. O `esperado` de novembro é 5.000 (só a bolsa corrente), o `visto` é 5.000 e a
falta fica **0**: a folha de novembro da bolsa corrente está faltando, mas o `visto` agregado a compensa. No
comportamento atual: `folha_atrasada` nulo, `compromissos_bolsas` 65.000 e `a.bolsas` livre 30.000 (seria
25.000 se a folha fosse contada). Um estorno negativo no mesmo lugar reduz `real(D)` e faz o contrário
(aumenta a falta: um estorno de −5.000 levaria a falta a 10.000). O `visto` soma `saldo_atual` com sinal, mas não
sabe a que bolsa nem a que mês o lançamento pertence: tudo o que entra ou sai da rubrica no intervalo é tratado
como folha. Não é
corrigido porque o balancete não traz o vínculo do lançamento com o bolsista.

**(b) Valor mudado na própria linha.** `70.VALOR_ALTERADO` tem uma única bolsa na linha com `amount = 7.000`
(o valor novo), mas o realizado de D (10.000) e o de k (5.000) são os pagamentos antigos de 5.000 por mês. O
`esperado` de novembro usa 7.000, o `visto` é 5.000 e a falta fica **2.000 fictícios**: `folha_atrasada`
2.000, `compromissos_bolsas` 93.000 (janela 91.000 + falta). A prática do sistema é encerrar a linha antiga e
criar outra; a regra usa o `amount` atual para todos os meses e não corrige isso.

### 6.4. Resultado da rodada

`node tools/replica-local/rodar-070-pglite.mjs` passou com **14 centros** no fechamento da árvore e **7
mutantes** reprovados. A 070 ficou com **48.401 bytes** (abaixo de 90 KB). `npm run lint` e `npm test`
continuam verdes (44 arquivos, 699 testes, 5 pulados). O arquivo de tarefa editado pelo Victor (sem números de
produção) entrou no commit; nenhum arquivo tem número de produção.

## 7. O que não foi feito / limites

- **Não apliquei a migração em lugar nenhum** além da réplica PGlite em memória. Não publiquei (`push`) e não
  disparei o cofre. A linha em `docs/migracoes.md` diz "não aplicada em produção".
- **Não alterei consumidores**, conforme a tarefa. Os dois efeitos visuais a decidir antes/depois de aplicar:
  1) a projeção de bolsas do `/v2/` passa a mostrar o aviso de divergência quando há folha atrasada;
  2) a lista "já contratados" de `plano-trabalho.js` e o card de bolsas do `/v2/` listam só `bolsas_ativas`,
     então não mostram a linha da folha atrasada (o total da rubrica e o livre mostram).
- **`bolsas_ativas` não ganhou a folha atrasada** de propósito: a chave existente continua significando "bolsas
  da janela de compromissos". A falta vai no total (`compromissos_bolsas`) e no objeto novo.
- **O `test_064` não foi tocado**; as chaves das partes novas terminam em `:comprometido`/`:realizado` para
  respeitar a convenção de pai que ele já verifica.
- **Os dois limites da 2ª rodada não foram corrigidos**, como pedido: baixa de bolsa antiga no balancete
  recente (o `visto` é agregado e não casa lançamento com bolsista) e valor mudado na própria linha (o
  `esperado` usa o `amount` atual para todos os meses). Estão no cabeçalho da 070 e nos blocos 10b/10c do
  `test_070`, provando o comportamento atual.
- **Não chamei outra IA nesta execução.** A revisão do GPT-6.2 Sol e a conferência do Claude vieram prontas no
  pedido; a revisão do SQL e o ensaio/aplicação pelo cofre ficam para quando o Victor aprovar a migração (o
  procedimento está em `docs/aplicar-migracao.md`).

## 8. Reproduzir

```bash
npm install --prefix .cache/pglite-064 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
node tools/replica-local/rodar-070-pglite.mjs
npm run lint
npm test
```

O runner só usa a base sintética em memória; nenhum dump, credencial ou conexão com produção.
