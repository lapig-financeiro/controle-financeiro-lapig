# Rotina do mês (com IA)

Combinado com o Victor em 19/11/2026: uma vez por mês, quando chegam os balancetes da FUNAPE, a IA (Claude) faz a
rotina abaixo e traz um resumo. Começa com o Victor pedindo "faz a rotina do mês"; quando estiver estável, pode virar
tarefa agendada. **Toda escrita no banco segue [`acesso-ao-banco.md`](acesso-ao-banco.md): simular num turno, gravar
em outro, com o "pode gravar" do Victor no chat.** Migração nunca faz parte da rotina (vai pelo cofre, à parte).

Os scripts citados ficam fora do Git (`NãoColocarNoGit/analise-bolsas-2027/scripts/`, por terem nomes e regras de
centros reais) ou em `tools/`. Todos simulam por padrão e gravam só com `--apply`/`--aplicar`/`--gravar`.

## 1. Ver o que chegou (só leitura)
- **Drive pelo conector** (as pastas dos centros são da conta da Mariana, compartilhadas; não estão no `G:`):
  pasta `Saldo/<MM - Mês AAAA>` do Meu Drive do Victor (ex.: `10 - Outubro 2026`; id da pasta `Saldo`:
  `1LqZdzKePjGYt1d0DVDS4VmYOCZDW7SUr`) com os balancetes do mês, e as pastas `… - 30.XXX` de cada centro, procurando arquivo
  criado ou alterado desde a última rotina (`modifiedTime >` a data da última linha do registro abaixo).
- **Banco**: data do último balancete e do plano vigente de cada centro (`resumo_projetos_v2`), pendências abertas.
- Resultado: a lista do que é novo — balancete, plano/remanejamento, planilha de bolsas, contrato ou aditivo.

## 2. Simular a entrada dos documentos novos
| Documento | Script (simulação) | Para quando |
|---|---|---|
| Balancete FUNAPE (PDF) | `balancetes_arquivos.mjs <pdf...>` | pergunta de classificação, contas-mãe não fecham, centro não bate, balancete igual ou mais antigo |
| Plano / remanejamento | proposta do Buriti → `aplicar_planos.mjs` | total não bate, rubrica some sem o documento dizer |
| Planilha de bolsas FUNAPE | `importar_funape.mjs <pasta>` | encerramento inesperado, pessoa pendente de decisão |
| Contrato ou aditivo | leitura do termo (vigência, taxa) → `registrar_termo_contrato_v2` | data condicional sem o evento, PDF ilegível |

Critério de "aplicação limpa" (o que a IA pode propor gravar sem levantar dúvida): o do
`NãoColocarNoGit/centros/README.md` — sem aviso do leitor, total bate, é o mais recente, nada some, toda conta
classificada. O resto vira pendência (`criar_pendencia_v2`, origem `claude`) em vez de ser forçado.

## 3. Rastreabilidade dos documentos novos
Depois de gravados: `node tools/rastreabilidade/backfill.mjs --centro <código>` (simula) e, com o ok,
`--aplicar`. Conferir que a raiz do `explicar_livre_v2` continua igual ao livre e que todos os nós fecham.

## 4. Vigências, taxas e pendências
- Contrato ou aditivo novo: registrar o termo com trecho, documento e nota (molde da F3-A); nunca mudar
  `projects.end_date` direto — a troca é do Victor, pelo botão "Usar a data do contrato".
- Centros a menos de 90 dias do fim da vigência e parcelas do cronograma vencidas sem entrada no balancete
  (conta 2.1.3.01, sem rendimento): viram pendência, não suposição.
- Pendências abertas cujo motivo sumiu (o documento chegou): propor resolver.

## 5. Resumo ao Victor
Uma mensagem curta: o que entrou, o que mudou no livre e no dinheiro em conta de cada centro afetado (antes → depois),
pendências novas e resolvidas, e o que precisa dele. Depois, uma linha no registro abaixo e no `ESTADO.md` do
redesenho.

## Registro
| Mês | Data | O que entrou | Pendências novas |
|---|---|---|---|
| (primeira rotina ainda não rodada) | | | |
