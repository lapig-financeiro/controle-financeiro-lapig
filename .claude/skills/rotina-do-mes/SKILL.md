---
name: rotina-do-mes
description: Rotina mensal do Controle Financeiro LAPIG — olhar o Drive, simular a entrada de balancetes, planos, bolsas e contratos novos, rastreabilidade, vigências e pendências, e resumir ao Victor. Use quando o Victor pedir "faz a rotina do mês", "rotina mensal", "chegaram os balancetes" ou algo equivalente.
---

# Rotina do mês

Siga `docs/rotina-mensal.md` na ordem, do passo 1 ao 5. Regras que não mudam:

- Simular e gravar em turnos separados; gravar só com o "pode gravar" do Victor no chat (`docs/acesso-ao-banco.md`).
- Drive pelo conector do Google Drive (as pastas dos centros são compartilhadas pela conta da Mariana; não estão no `G:`).
- Nunca imprimir CPF nem credencial; nada com nome real em arquivo versionado.
- `projects.end_date` não se muda direto: a troca é do Victor pelo botão "Usar a data do contrato".
- Migração não faz parte da rotina.
- Ao terminar: linha no registro de `docs/rotina-mensal.md` e no `docs/redesenho/ESTADO.md`.
