# F2-A — 2ª rodada (correções da revisão de fase, 19/11)

Mesmo worktree e branch (`redesenho/f2-a-banco`), mesmos arquivos permitidos da `F2-A-banco.md`, mais
`docs/redesenho/relatorios/F2-A.md` (acrescente uma seção "2ª rodada"). Dois DeepSeek max revisaram o commit
5178f7d; o Claude conferiu os achados abaixo. **Continue com até 90 KB**: se faltar espaço, encurte
comentários e mensagens das asserções, nunca remova uma checagem.

## Corrigir
1. **CPF: detecção e máscara mais largas, e a máscara nunca mais estreita que a detecção.** `_tem_cpf`:
   além do que já faz, aplique `contem_cpf` ao texto em que **qualquer** sequência de 1 a 3 caracteres não
   dígitos entre dígitos foi removida (pega barra, NBSP, en dash, `_`, vírgula, aspas e `": "` de JSON),
   mantendo o dígito verificador como critério. `_mascarar_cpf`: troque toda sequência 3-3-3-2 de dígitos
   separada por 0 a 4 não dígitos quaisquer (inclusive NBSP e quebras de linha com indentação) e também 11
   dígitos seguidos. Testes: barra, NBSP, en dash, 4+ espaços/quebras, valores JSON separados, e um DV
   inválido que **não** é recusado.
2. **Agente**: `get_origem_v2` e `explicar_livre_v2` mascaram sempre que `is_agente()`; a policy de `fatos`
   vira `is_admin() and not is_agente()`. Teste com o agente.
3. **Pendências — CPF partido**: no gatilho e em `criar_pendencia_v2`, monte o texto **completo** da linha
   nova (chave + título + todos os valores string do `detalhe`, extraídos com `jsonb_path_query`/recursão, sem
   a pontuação do JSON) e recuse quando ele tem CPF e o da linha antiga não tinha (permite limpar CPF legado
   e não bloqueia update de campo alheio). Testes: CPF em duas gravações; em duas chaves do `detalhe` numa
   gravação.
4. **Oráculo**: em `get_origem_v2`, para não-admin, alvo de centro fora do escopo e alvo inexistente dão o
   **mesmo** SQLSTATE e a mesma mensagem ("Acesso negado ao alvo."), checando o escopo antes de
   `assert_project_allowed`. Teste comparando os dois.
5. **Chave do documento e amarra fato ↔ documento**: `registrar_documento_v2` exige
   `chave = 'balancete:<project_id>:<AAAA-MM-DD>'` ou `'plano:<project_id>:<plano_id>'` (exato, com o
   `project_id` do payload) e que todo fato aponte para o balancete **dessa data** (tabelas `balancetes` e
   `balancete_lancamentos`) ou para o plano **desse id** (`planos_trabalho`, `plano_rubricas`,
   `plano_desembolsos`). Ajuste os testes que usavam chaves fora do formato. Teste: chave de setembro com alvo
   de novembro → recusa.
6. **Chave estável ambígua**: em `plano_rubricas`, se mais de uma linha do plano tiver a mesma
   `rubrica_code` e `descricao_livre` (nula/vazia duplicada; a 025 permite), `registrar_documento_v2` recusa
   o fato com mensagem clara e `_resolver_origem_alvo` devolve `legado` com `nota` "linha ambígua no plano"
   em vez de pegar a primeira. Teste com duas linhas nulas.
7. **CPF no caminho**: `_tem_cpf` também em `caminho` e `chave`; no `legado`, `arquivo_nome` exibido para
   não-admin passa por `_mascarar_cpf` (o `caminho` vai inteiro, a URL assinada precisa dele). Teste.
8. **Título do documento**: com a `chave` já existente e sha novo, atualize `documentos.titulo`. Teste.
9. **Nota da folha**: `explicar_livre_v2` copia a `nota` do `_resolver_origem_alvo` para a folha (ex.: "o
   valor mudou depois da leitura…", "linha ambígua…"). Teste.
10. **`bbox` sem `pagina`** em PDF → recusa; `paginas` obrigatório quando `formato = 'pdf'`; coordenadas
    validadas por tipo **antes** do cast (erro `22023`, não `22P02`). Teste com `x0` string.
11. **UUID maiúsculo**: compare o primeiro segmento do `caminho` como `uuid`, não como texto. Teste.
12. **`_fmt_brl_num`**: `stable` (não `immutable`) e independente de `lc_numeric` (monte os separadores à
    mão a partir de `to_char(v, 'FM999999999990.00')`). Teste com `set local lc_numeric` diferente, se o
    PGlite aceitar; senão, registre.
13. **Asserções exatas**: ACL por `aclexplode` (anon/PUBLIC sem nenhum privilégio; authenticated exatamente
    `SELECT`) nas três tabelas e em `pendencias`; o `qual` das policies comparado com a expressão esperada
    (não por regex). Mutantes novos: `grant truncate ... to anon`; `fatos_select_admin` com `is_admin() or
    true`; `documentos_select_escopo` com `using (true)`.
14. **CHECK novo de `pendencias` sobre linhas antigas**: antes do `add constraint`, um `do $$` que, se houver
    linha que o violaria, falha com a lista dos ids (sem alterar dado). Teste com uma linha `E'\t'` criada
    **antes** da 064.
15. **Árvore — `ref` exato**: o verificador recursivo do teste confere `alvo_tabela`, `campo` e que o id
    existe, para cada tipo de folha.

## Não corrigir agora (registrar no relatório)
- `get_saldo_livre` (048) ignora rubrica que só tem previsto negativo ou só lançamento negativo
  (`> 0` no `base`): é número pré-existente, fora do escopo da 064. Escreva no relatório o caso e mude o nome
  do teste de "previsto negativo" para o que ele realmente prova.
- `conta` dos nós de rubrica ("soma das linhas do plano" etc.) fica como está; o contrato passa a aceitar
  qualquer frase em `conta`.

## Pronto quando
`node tools/replica-local/rodar-064-pglite.mjs` verde (com os mutantes novos reprovando), `npm run lint` e
`npm test` verdes, arquivo ≤ 90 KB, relatório atualizado, commit novo na branch. Sem push, sem aplicar.
