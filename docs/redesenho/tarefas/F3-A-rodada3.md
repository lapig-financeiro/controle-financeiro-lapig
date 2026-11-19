# F3-A — 3ª rodada (achado do Claude na leitura da 067, 19/11)

Mesmo worktree e branch. Seção "3ª rodada" no relatório, commit novo. Sem push.

**Alto — a `nota` vaza para professor pela tabela.** A 067 faz `grant select on public.termos_contrato to
authenticated` com a policy de escopo. A RPC devolve `nota` null para quem não é admin humano, mas um professor (ou o
agente) lê a coluna direto: `GET /rest/v1/termos_contrato?select=nota`. A regra "nota só para admin" fica furada.

Correção: nenhum acesso direto à tabela para `authenticated` (`revoke all ... from public, anon, authenticated`, sem
grant de select); a leitura é só pela `get_termos_contrato_v2` (definer). Mantenha RLS ligado e a policy de SELECT
(ela continua valendo como defesa caso alguém conceda select no futuro) — ou remova a policy e ajuste a asserção;
escolha e justifique. Atualize as asserções de ACL do fim do arquivo (authenticated sem SELECT na tabela), o roteiro
SQL (professor e agente recebem erro de permissão no SELECT direto; admin também, já que lê pela RPC) e o runner do
pglite. Confira que nada no app lê a tabela direto.

`npx vitest run`, `npm run lint`, testes e build de `app/`, runner do pglite: verdes.
