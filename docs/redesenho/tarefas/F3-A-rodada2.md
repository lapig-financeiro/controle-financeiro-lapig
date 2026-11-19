# F3-A — 2ª rodada (dados reais dos contratos, 19/11, levantados pelo Claude)

Mesmo worktree e branch. Seção "2ª rodada" no relatório, commit novo. Sem push.

O levantamento dos contratos mostrou duas coisas que o desenho da 1ª rodada não cobre:

1. **Taxa total.** Vários financiadores fixam só o percentual total ("Project Overhead %: 12.5%", "limitou um
   percentual de 16% de Custos Indiretos") e a divisão UFG/unidade/fundação aparece só em reais no plano.
   Acrescente o termo `taxa_total` (com `valor_pct`, mesmas regras das outras taxas). Na tela, quando houver
   `taxa_total` e nenhuma taxa por rubrica, mostre "Taxas do contrato: 12,5% no total"; quando houver as duas,
   mostre o total do contrato e, ao lado, a divisão; se a soma das taxas por rubrica não bater com `taxa_total`,
   não "corrija" nada: mostre os dois números e deixe a nota explicar.
2. **Fonte no próprio sistema.** Às vezes o valor sai do plano de trabalho já importado (está em `documentos`, 064),
   não de um arquivo do Drive. Acrescente `documento_id uuid references public.documentos(id) on delete restrict`
   (opcional). Regra: pelo menos um entre `documento_url` e `documento_id`. No painel, com `documento_id`, o link é
   "Abrir o plano" e abre o mesmo visualizador da aba Documentos (o `get_origem_v2` não serve aqui; use o
   `documento_versoes` mais recente via a RPC/serviço que a aba Documentos já usa para abrir arquivo — se não houver
   caminho sem RPC nova, diga no relatório e deixe só o nome do documento, sem link).
3. Ajuste o roteiro SQL, o runner do pglite, os dados de exemplo (um centro com só `taxa_total`, um com total e
   divisão que não batem) e os testes do app. `docs/migracoes.md` atualizado.

`npx vitest run`, `npm run lint`, testes e build de `app/`, runner do pglite: verdes.
