# F1-A — 2ª rodada (revisão de fase: dois DeepSeek, conferida pelo Claude)

Mesmo worktree e branch. Mesmos arquivos da F1-A (mais este). Commit novo na branch ao fim; sem push, sem aplicar.

## Migração
1. `resumo_projetos_v2`: todo o cálculo de cada centro (casts de `data_referencia`, `balancete_defasagem_meses`,
   `saldo_livre`, a situação) fica dentro do bloco com `exception`; qualquer falha nele vira `'sem dado'` com
   `erro = 'falha_saldo_livre'`, nunca derruba a lista nem manda `SQLERRM` ao cliente.
2. `criar_pendencia_v2`:
   - recusa `project_id` de projeto inativo (22023);
   - se a chave já existe com `project_id` ou `tipo` diferentes, recusa (22023) em vez de sobrescrever;
   - valida o formato do uuid antes do cast e relança 22023 sem ecoar o payload;
   - `detalhe` precisa ser objeto JSON (nulo → `'{}'`).
3. **Gatilho de CPF na tabela** (segunda barreira, além da RPC): `before insert or update on pendencias for
   each row`, função `security definer` com `set search_path`, que chama `contem_cpf(chave||' '||titulo||' '||
   detalhe::text)` e levanta erro. Padrão de `_planejamento_sem_cpf` (061). Nunca CHECK. ACL: revoke de
   public/anon/authenticated na função do gatilho.
4. `listar_pendencias_v2` (sem centro, admin): além dos `centros_visiveis()` e das sem centro, inclui as
   pendências **abertas** de centros **inativos** (centro desativado depois de a pendência nascer não pode
   esconder pendência para sempre). Centro ativo oculto pelo filtro continua fora.
5. `resolver_pendencia_v2`: autoriza antes de travar a linha, e "não existe" e "fora do escopo" devolvem o
   **mesmo** erro (sem oráculo de existência, como a 033 faz em `get_balancete_detalhado`).
6. `get_repasses_v2`: plano ativo com `order by pt.versao desc limit 1` (nada garante um único ativo). Registre
   no relatório que `get_saldo_livre` tem o mesmo `limit 1` sem ordem (fica para a F2).
7. FKs: `resolvida_por ... on delete set null`; `project_id ... on delete restrict` (convenção da 022: apagar o
   centro não apaga histórico).
8. Asserção final: nenhuma outra policy de escrita em `filtro_visao` além da do admin (como já faz para
   `pendencias`).
9. Corrija o comentário que sugere que o `security_invoker` da view protege dentro de função definer: a
   guarda real em `get_repasses_v2` é o `assert_project_allowed`.

## Teste (`tests/sql/test_063_redesenho_f1.sql`) — fechar os mutantes que passavam
10. Admin grava a linha de `filtro_visao` **antes** do bloco de escrita direta; o professor tenta update/delete
    e a linha do admin sobrevive intacta.
11. Caso positivo de `listar_pendencias_v2(<centro>)`: professor com o próprio centro recebe só as daquele centro.
12. Janela de 90 dias: uma pendência resolvida há 5 dias com `criada_em` de 200 dias atrás **aparece**.
13. `get_filtro_visao_v2` devolve a lista **guardada**: grave direto (como admin) e desative um centro já
    oculto; ele continua na lista do getter.
14. `get_filtro_visao_v2` de admin **sem linha** devolve `[]`, não `null` (antes de qualquer `set`).
15. Casos novos para 1–5: cast quebrado vira `'sem dado'`; projeto inativo recusado; chave com centro
    diferente recusada; insert direto com CPF barrado pelo gatilho (como admin, com grant de teste);
    pendência aberta de centro inativo aparece para o admin e não para o professor; mesmo erro para id
    inexistente e id alheio.
16. Prove os mutantes: para 10–13, rode uma vez com a versão defeituosa (policy permissiva extra; getter
    derivado; `criada_em` no lugar de `coalesce`) e confirme que o teste **falha**; registre no relatório.

## Pronto quando
`node tools/replica-local/rodar-063-pglite.mjs`, `npm run lint` e `npm test` verdes; relatório F1-A com uma
seção "2ª rodada"; linha da 063 em `docs/migracoes.md` atualizada se a semântica mudou; commit na branch.
