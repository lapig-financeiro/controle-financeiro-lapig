# F2-B — 2ª rodada (revisão GLM 5.3 do commit 237ce44, 19/11, conferida pelo Claude)

Mesmo worktree, branch e arquivos da `F2-B-backfill.md`. Seção "2ª rodada" no relatório, commit novo. Sem
push, sem produção.

1. **DOCX**: `linhasDoHtmlDocx`/`lerDocx` devolvem linhas no mesmo formato que `escolherLinha`/`acharAlvo`
   esperam (`{ texto }`). Teste de ponta a ponta com um DOCX **sintético gerado no teste** (sem dado real) que
   passa pela saída real de `lerDocx` até `registrar_documento_v2` no pglite.
2. **Nunca registrar documento com zero fatos**: status próprio `sem_fatos` (contado no terminal e no
   relatório), sem chamar a RPC. Vale também depois da retentativa.
3. **Retentativa por CPF sem suspeito** → pular o documento (`recusado`/`cpf`), sem segunda chamada.
4. **`temCpfLargo064`** espelha as **quatro** checagens da `_tem_cpf` da 064 (inclusive vãos de até 4
   caracteres quaisquer, com letras). Teste com `'529abcd982efgh247ijkl25'`.
5. **`--saida`** validada (e criada) **antes** de qualquer leitura ou escrita.
6. **Balancete inconsistente** (`raw_extraction` indica mais lançamentos do que a tabela tem): recusa só aquele
   documento (motivo `lancamentos_inconsistentes`) e continua.
7. **Pré-validação de valor**: compare o valor do fato com o valor **lido do trecho** (número extraído do texto
   da linha), não com ele mesmo; se não houver como, remova a checagem e registre que a divergência é pega só
   pela RPC.
8. **401/403** no meio da corrida = `ErroFatal` (aborta com código de saída ≠ 0 e mensagem "login expirou: rode
   de novo"), não "recusado (outro)".
9. **Argumentos**: `--centro`/`--saida` recusam valor que comece por `--`.
