# F0-A — Fechar a leitura dos arquivos por centro de custo

Leia antes: `CLAUDE.md` (seção Database Setup inteira), `docs/redesenho/README.md` §4, `docs/migracoes.md`
(linhas 031, 033, 034, 051, 052), `docs/aplicar-migracao.md` (só para saber as regras do cofre; **não aplique**).

## Problema
A migração `database/031_reconciliacoes.sql` criou para o bucket `bolsa-planilhas` (planilhas da FUNAPE, com
CPF) as policies `bolsa_auth_select/insert/update` com `using (bucket_id = 'bolsa-planilhas')`: **qualquer
login autenticado lê a planilha de qualquer centro**. Pelo que se vê no repositório, nenhuma migração depois
escopou isso por centro (a 052 só restringe o papel `agente`). Os buckets `balancete-pdfs` e
`plano-trabalho-docs` provavelmente têm o mesmo desenho — confira.

## O que fazer
1. Levantar, nos `.sql` e no código (`frontend/js/`, `mcp/src/`), para cada um dos três buckets: as policies
   existentes em `storage.objects`, quem faz upload, e o **formato do caminho** do arquivo (começa pelo id do
   projeto? pelo código? por outra coisa?). Escreva isso no relatório.
2. Escrever `database/062_arquivos_por_centro.sql`: leitura, gravação e troca nesses três buckets só para
   objetos de centros em `allowed_project_ids()` (admin continua vendo tudo, como hoje em `is_admin()`).
   - Se o caminho já começa pelo `project_id`, use `(storage.foldername(name))[1]`; se não, amarre pela
     tabela que guarda o caminho (ex.: `reconciliacoes`, `balancetes`, `planos_trabalho`) — sem quebrar
     upload de professor no próprio centro (o upload grava o objeto **antes** da linha da tabela: verifique
     a ordem e desenhe para ela funcionar).
   - Não remova a restrição do agente (052). Não toque `is_admin`, `allowed_project_ids`,
     `assert_project_allowed`, `is_agente`, `contem_cpf`, `bloqueia_escrita_do_agente`.
   - Regras do cofre: `begin;` na primeira linha de comando e `commit;` na última; asserções no fim, dentro
     da transação; nada das palavras proibidas listadas no `CLAUDE.md`.
3. Roteiro autoconferido `tests/sql/test_062_arquivos_por_centro.sql` + stub que **prova o defeito antes** da
   correção (professor A lê arquivo do centro B) e o conserto depois (não lê; lê o próprio; admin lê tudo;
   upload do professor no próprio centro continua funcionando). Siga o padrão dos testes de 044/054 e,
   se der, rode na stack local (`tools/replica-local/`).
4. Acrescentar a linha da 062 em `docs/migracoes.md`.
5. Relatório em `docs/redesenho/relatorios/F0-A.md`.

## Arquivos (só estes)
`database/062_arquivos_por_centro.sql`, `tests/sql/test_062_arquivos_por_centro.sql`, stub em
`tools/replica-local/` se precisar (arquivo novo), `docs/migracoes.md`, `docs/redesenho/relatorios/F0-A.md`.

## Correções depois da revisão do plano (18/11, valem por cima do texto acima)
1. **O caminho já começa pelo id do projeto** nos três escritores: `holders.js:1539`,
   `plano-trabalho.js:1318` e `:1437` gravam `${projectId}/${Date.now()}_${nome}`. Use o prefixo; **não**
   amarre pela tabela. Compare como **texto** (`split_part(name, '/', 1)` contra os ids de
   `allowed_project_ids()` convertidos para texto): converter um prefixo que não é uuid para `uuid` derruba a
   consulta inteira. Objeto com prefixo que não é centro conhecido fica visível só ao admin (quarentena natural).
2. **Derrube as policies antigas**, todos os verbos: `025` (linhas ~309–321), `026` (~235–241), `031` (~71–78).
   Policies permissivas somam por OR: criar as novas sem `drop policy if exists` das antigas mantém o vazamento.
3. **Quatro verbos**: select; insert `with check`; update `using` **e** `with check` (senão dá para mover o
   arquivo para a pasta de outro centro); delete escopado (`plano-trabalho.js` apaga o arquivo depois de apagar
   a linha — confira os pontos de `remove` e mantenha-os funcionando para o próprio centro).
4. Os três buckets são privados (`public = false` em 025/026/031): a policy é a barreira. Confira se algum
   código lê esses buckets com credencial que ignora RLS e registre no relatório.
5. **Teste obrigatório, não "se der"**: siga o modelo de `tools/replica-local/stub-052.sql` (simula o
   `request.jwt.claim.sub` e cria `storage.objects`) e dos `tools/replica-local/rodar-0xx-pglite.mjs`. Crie
   `tools/replica-local/stub-062.sql` (carrega as policies da 031/025/026 para **provar o vazamento**) e
   `tools/replica-local/rodar-062-pglite.mjs`, e rode. Casos: professor A não lê/grava/move/apaga no centro B;
   lê/grava/apaga no próprio; admin tudo; agente continua barrado pela 052.
6. Inclua no relatório uma consulta só de leitura (para o Claude rodar como admin) que conte os objetos de cada
   bucket e quantos têm prefixo que não é id de projeto existente.

## Pronto quando
Migração e teste escritos; teste rodou (diga onde e o resultado) ou, se não deu para rodar, o relatório diz
exatamente por quê; `npm run lint` e `npm test` verdes. **Não aplique em produção e não faça commit.**
