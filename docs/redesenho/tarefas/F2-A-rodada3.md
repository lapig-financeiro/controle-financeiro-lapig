# F2-A — 3ª rodada (revisão final DeepSeek max do commit edc7ec2, 19/11)

Mesmo worktree, branch e arquivos. Nada alto; corrigir os itens abaixo, manter ≤ 90 KB, acrescentar a seção
"3ª rodada" ao relatório e um commit novo. Sem push, sem aplicar.

1. **`busca.texto` com máscara**: no `legado` de `plano_rubricas` (e onde mais `busca.texto` vier de texto
   livre), passe por `_mascarar_cpf` quando `p_mascarar`. Teste com `descricao_livre` contendo CPF, como
   professor e como agente.
2. **Caminho canônico**: o primeiro segmento do `caminho` tem de ser exatamente `v_project_id::text`
   (minúsculo); a 062 compara como texto, então um UUID maiúsculo deixaria o arquivo inacessível ao professor.
   Ajuste o teste da 2ª rodada (maiúsculo passa a ser recusado com mensagem clara).
3. **Pré-checagem de `pendencias`** também lista linhas com `chave` ou `titulo` nulos.
4. **Gatilho de CPF de `pendencias`**: recusar também a troca de um CPF por outro (texto novo com CPF e
   diferente do antigo nos campos alterados). Teste.
5. **Índice** `idx_fatos_versao` em `fatos(versao_id)`, com a asserção.
6. **Plano sem fatos**: para `tipo = 'plano'`, conferir sempre que o `plano_id` da chave existe e é do
   `project_id` (mesmo com `fatos: []`); para `balancete`, que exista balancete do projeto naquela data.
   Teste com `fatos: []`.
7. **`parser`/`parser_versao`** passam por `_tem_cpf` na validação.
8. **Asserção do `qual` das policies robusta ao deparse**: normalize antes de comparar (remova todo
   espaço em branco e parênteses redundantes dos dois lados, ou compare `regexp_replace(lower(qual), '[\s()]',
   '', 'g')`). Os mutantes 7 e 8 continuam reprovando.
