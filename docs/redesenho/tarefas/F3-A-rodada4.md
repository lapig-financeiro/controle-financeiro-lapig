# F3-A — 4ª rodada (revisões MiniMax max e DeepSeek max de 6f3988d..fd4ef46, 19/11, conferidas pelo Claude)

Mesmo worktree e branch. Seção "4ª rodada" no relatório, commit novo. Sem push. As duas revisões convergem.

## Alto

1. **CPF com espaço, hífen ou barra passa** (MiniMax 1, DeepSeek 1 e 2). `contem_cpf` (052) é a versão fraca; a
   064/065 criou `public._tem_cpf(text)` justamente para isso. Troque as chamadas no CHECK do `trecho` e no
   `registrar` por `_tem_cpf` (só chamar; não alterar helpers). Como CHECK com função sem EXECUTE para
   `authenticated` é frágil (063 evitou isso: MiniMax 7), prefira validar só na RPC definer **e** manter um CHECK
   via helper definer próprio, no molde do `_pendencias_sem_cpf()` da 063 — escolha e justifique. Testes com
   `529 982 247 25`, `529-982-247-25`, `529.982.247/25`, com quebra de linha, pela RPC e por INSERT do dono.

## Médio

2. **Metadado do documento cru para professor** (MiniMax 5, DeepSeek 3): no objeto `documento` da
   `get_termos_contrato_v2`, aplique a mesma regra da 064/065 para não-admin (`_mascarar_cpf` no nome; `caminho`
   null quando parece CPF). Não prometa no relatório que o agente não vê o caminho (ele lê `documento_versoes` por
   REST: MiniMax 6); só não piore.
3. **Idempotência ignora `origem` e `autor`** (MiniMax 2, DeepSeek 4): inclua os dois na comparação.
4. **Centro sem `end_date`** (MiniMax 3, DeepSeek 6): a RPC passa a devolver `vigencia_situacao` =
   `'confere' | 'diverge' | 'sem_cadastro' | 'sem_contrato'` (mantenha `vigencia_confere` por compatibilidade). Tela:
   `sem_cadastro` mostra "Vigência do contrato: dd/mm/aaaa · não está no cadastro" e o admin vê "Usar a data do
   contrato". Teste.
5. **`start_date` muda sem aviso** (MiniMax 4, DeepSeek 5): a confirmação mostra início e fim (antes → depois) quando
   o início também muda; o validador do app confere os dois.
6. **"De onde vem" velho depois de usar a vigência** (DeepSeek 7): recarregue/zere o estado do explicar junto com
   resumo e saldo.
7. **Asserções fracas** (MiniMax 9, DeepSeek 8): confira o `qual` da policy por igualdade normalizada (como a 064) e
   o conteúdo (`pg_get_constraintdef`) de cada CHECK, não só o nome.
8. **Policy não protege coluna** (DeepSeek 9): a policy por linha não é "defesa da nota". Remova a policy (sem grant
   ela não serve) e ajuste asserções e relatório; o motivo é a ACL.

## Baixo (fazer)

9. `versoes_anteriores` sem `nota`: teste com `not ?` em cada item (DeepSeek 10).
10. Runner exige `42P01` no passo "antes da 067" (DeepSeek 11).
11. Teste "professor sem botões" com o caso que diverge, os dois botões ausentes (DeepSeek 12).
12. Fixtures sem os números do caso real (20 meses, 8+8+10, 12,5, 16): troque por sintéticos (DeepSeek 13).
13. `usar_vigencia` sem UPDATE quando nada muda; limites em `documento_nome`/`documento_url`; `valor_pct` com
    `numeric(6,3)` e rejeição de NaN; `pagina` fora de faixa vira 22023; `termosSt` zerado na troca de centro;
    `validarUrlDrive` do painel com a mesma regra do banco (`^https://(drive|docs)\.google\.com/`) (DeepSeek 14,
    MiniMax 8).
14. Relatório: tire o texto da 1ª rodada que diz `grant select` (MiniMax 10).

Não precisa: lock de concorrência no `registrar` (só um admin registra); `on delete restrict` × cascade — registre
no relatório como limitação conhecida.

`npx vitest run`, `npm run lint`, testes e build de `app/`, runner do pglite: verdes.
