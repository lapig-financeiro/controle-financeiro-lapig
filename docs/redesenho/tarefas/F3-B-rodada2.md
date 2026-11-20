# F3-B — 2ª rodada (revisões MiniMax max e DeepSeek max de f0cebde + teste da tela pelo Claude, 19/11)

Mesmo worktree e branch. Seção "2ª rodada" no relatório, commit novo. Sem push. Os achados abaixo foram conferidos no
código; as duas revisões convergem nos itens 1, 4, 6, 7, 8 e 12.

## Alto

1. **Clicar na caixa atual (ou mover) apaga valor e nota** (`Bolsistas.jsx:612-632`, `068:825-829`). Separe as
   operações:
   - `colocar_na_caixa_v2(p_caixa_id, p_holder_id)` só põe ou move: se a pessoa já está numa caixa do mesmo dono, leva
     junto `valor_mensal` e `nota` do item de origem; se já está nesta caixa, não muda nada. Devolve `saiu_de`.
   - RPC nova `editar_item_caixa_v2(p_caixa_id, p_holder_id, p_valor_mensal numeric, p_nota text)`: grava exatamente
     o que veio (null limpa); item tem de existir (`P0002`). É a única que o editor do item usa.
   - Na lista, o botão da caixa onde a pessoa já está vira marcador não clicável ("Na caixa X").
2. **"4.500" vira R$ 4,50** (`Bolsistas.jsx:219-228`). Parser de moeda pt-BR em `util/` com testes: `4500`, `4.500`,
   `4.500,00`, `4,50`, `R$ 4.500`, `1.234.567,89`, `12.000`, vazio, lixo. Ponto seguido de exatamente 3 dígitos é
   milhar; vírgula é decimal.
3. **Corrida: mesma pessoa em duas caixas / 11ª caixa** (`068:761-829`, `622-633`). Em `salvar_caixa_pedido_v2`
   (criação) e em `colocar_na_caixa_v2`, antes de contar/apagar/inserir:
   `perform pg_advisory_xact_lock(hashtextextended('caixas_pedido:' || v_dono::text, 0))`. Diga no relatório que o
   PGlite não prova concorrência; prove por mutante que a chamada existe (remover o lock tem de falhar uma asserção de
   texto da função, `pg_get_functiondef` contendo `pg_advisory_xact_lock`).

## Médio

4. **Papel `automacao` passa** (MiniMax 2). Guarda comum das 7 RPCs: `not is_agente() and not is_automacao(null)`
   (só chamar; não alterar helpers). As três tabelas recebem também `trg_bloqueia_automacao` no formato da 054
   (statement, `_bloquear_financeiro_automacao`). Asserções e teste para os dois.
5. **"Vigente hoje" contradiz o filtro de centro** (MiniMax 3, DeepSeek 5). A RPC passa a devolver em cada bolsa o
   `vigente_hoje` (já existe) e, na pessoa, `valor_vigente` continua sendo a soma do escopo. Na tela, troque o rótulo por
   "soma vigente hoje (todos os seus centros): R$ x" e, quando algum centro da pessoa estiver desmarcado, mostre ao lado
   "inclui bolsa de centro desmarcado". O valor que vai para a caixa continua o do banco; quem quiser outro edita o
   "valor no pedido". Nada de somar no app.
6. **Item oculto sem saída** (MiniMax 8, DeepSeek 6). RPC nova `limpar_ocultos_da_caixa_v2(p_caixa_id)` (só o dono;
   apaga itens de pessoas que deixaram de ser visíveis, sem devolver nomes; devolve quantos). Botão "Tirar quem saiu da
   lista" ao lado do aviso.
7. **PK e FK não conferidas** (MiniMax 4, DeepSeek 7). Garanta as PKs de forma idempotente (adicionar se faltar) e
   asserte `contype = 'p'` com as colunas certas nas duas tabelas, e `confrelid`/`conkey`/`confkey` de cada FK (alvo
   `scholarship_holders(id)` e `caixas_pedido(id)`). Mutantes: sem PK e FK para outra tabela têm de falhar.
8. **Validadores do app frouxos** (DeepSeek 8). `validarCaixaPedido`: `pessoas === itens.length`,
   `total_periodo === total_mensal * meses` e `total_mensal` igual à soma de `valor_usado` (tolerância 0,005; isto é
   conferência, não exibição). Salvar caixa/item confere que o devolvido bate com o enviado.
9. **Testes** (DeepSeek 9 e 15): mover entre três caixas; apagar caixa **com item** escolhida pelo id guardado (o
   cascade de verdade); CPF em UPDATE de nome e nota; limites (meses 1 e 60, nome 80, nota 300, valor 0,004).
10. **Mensagem do servidor** (MiniMax 7). Para as RPCs desta tela, quando o erro vier com SQLSTATE `22023`, `P0002` ou
    `42501` levantado pela própria 068, mostre a mensagem do banco (elas são escritas para o usuário e não têm nome de
    pessoa). Demais erros seguem genéricos.
11. **Caixa alheia como oráculo** (DeepSeek 14): caixa de outro dono responde `P0002` igual à inexistente.

## Baixo

12. Arredondar antes de validar o valor (0,004 → `22023`, não `23514`) (as duas).
13. `salvarCaixaPedido` só manda `meses` quando definido (DeepSeek 13).
14. Filtro de centros: guarde os **desmarcados** (centro novo entra marcado); se o salvo deixar a lista vazia por
    centro que não existe mais, volte para todos (DeepSeek 10).
15. Mudar a equipe para uma fora do filtro: aviso "Fulano agora está em Alertas (fora do filtro)" (DeepSeek 11).
    Mover mostra "saiu de X" (MiniMax 9).
16. Asserção do gatilho de CPF exata (sem DELETE) (MiniMax 10).

## Tela (teste do Claude no modo exemplo)

17. **Caixas compactas**: cada pessoa da caixa numa linha só — nome · valor usado (com "editado" quando há
    `valor_mensal`) · ícone de nota se houver · "Editar" · "Tirar". "Editar" abre o valor e a nota na própria linha
    (ou num `PainelLateral`). Com 30 pessoas a caixa tem de caber sem rolar uma tela por pessoa.
18. **Lista mais densa**: uma linha por pessoa no desktop (nome e equipe | bolsas | soma | botões), quebrando só no
    celular. Contador e filtros fixos no topo da coluna ao rolar, se for simples.
19. Resumo da caixa em destaque no topo dela ("12 pessoas · R$ 24.600/mês · R$ 295.200 em 12 meses").

`npx vitest run`, `npm run lint`, testes e build de `app/`, runner do pglite (com os mutantes novos): verdes.
