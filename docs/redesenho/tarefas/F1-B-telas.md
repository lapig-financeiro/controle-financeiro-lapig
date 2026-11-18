# F1-B — Telas da fase 1 (Projetos, página do projeto, filtro de visão, pendências)

Executor: **Orchestrator (Neon)**, num worktree próprio **fora do OneDrive** (branch `redesenho/f1-b-telas`).
Roda em paralelo com a F1-A (banco): as duas tarefas **não têm arquivo em comum**. As RPCs novas ainda não
existem em produção; você trabalha sobre o **contrato** abaixo (igual ao da F1-A) e sobre dados de exemplo.

Antes de começar, leia: `docs/redesenho/estetica.md` **inteiro** (§5 telas de referência, §6 escrita, §6b
decisões; siga à risca), `docs/redesenho/README.md` §4, §6 (F1) e §7b, e o código de `app/src/` (componentes
prontos, `servicos/supabase.js`, `roteador.js`, `paginas/Componentes.jsx`, que já mostra a tela de referência
com dados falsos).

## Arquivos (só estes)
- `app/src/**` e `app/tests/**`
- `app/vite.config.js` (só se precisar liberar o import de `../frontend/js/planejamento-dinheiro.js`)
- `docs/redesenho/relatorios/F1-B.md` (novo)
Nada fora de `app/`. **Não** edite `frontend/js/planejamento-dinheiro.js`: importe-o como está.

## Contrato (igual na F1-A)
```
resumo_projetos_v2() → jsonb
{ "centros": [ { "id", "code", "name", "end_date", "drive_folder_url" (null para não-admin),
                 "livre": number|null, "situacao": "em dia"|"atenção"|"problema"|"sem balancete"|"sem plano"|"sem dado",
                 "data_referencia": "AAAA-MM-DD"|null, "pendencias_abertas": int, "erro": "falha_saldo_livre"|null,
                 "responsaveis": [string] } ],
  "ocultos": int,
  "todos": [ { "id","code","name","responsaveis","oculto": bool } ] }   -- só admin; professor recebe []
listar_pendencias_v2(p_project_id uuid default null) → jsonb  [ { "id","project_id","code","tipo","titulo","detalhe","situacao","origem","criada_em" } ]
resolver_pendencia_v2(p_id uuid, p_situacao text) → jsonb  { "id","situacao" }
criar_pendencia_v2(p jsonb) → jsonb  { "id","chave","situacao","criada": bool }   -- só admin; a F1-B não usa (sem tela de criar na F1)
get_filtro_visao_v2() → jsonb  { "centros_ocultos": [uuid] }
set_filtro_visao_v2(p_centros_ocultos uuid[]) → jsonb  { "centros_ocultos": [uuid] }
get_repasses_v2(p_project_id uuid) → jsonb
{ "parcelas": [ { "parcela","data_prevista","data_texto","valor","valor_texto" } ],
  "valor_total_plano": number|null, "data_balancete": "AAAA-MM-DD"|null, "recursos": object|null }
get_saldo_livre(p_project_id uuid) → jsonb   -- já existe (038/048). Campos usados: grupos[] {grupo_code,
  grupo_name, previsto, realizado, compromissos, compromissos_cobertura, saldo_livre}, rubricas[],
  bolsas_ativas[] {bolsista, valor_mensal, end_date, meses, compromisso}, has_plano, has_balancete,
  data_referencia, end_date, balancete_defasagem_meses, avisos[], nota
get_balancetes_by_project(p_project_id uuid), get_planos_historico(p_project_id uuid)  -- já existem (lista de documentos)
```

## Camada de dados (`app/src/servicos/dados.js`, nova)
- Uma função por chamada do contrato (`resumoProjetos()`, `pendencias(projectId?)`, `resolverPendencia()`,
  `filtroVisao()`, `salvarFiltroVisao()`, `saldoLivre(id)`, `repasses(id)`, `documentos(id)`), cada uma
  devolvendo `{ dados, erro }`. **Erro nunca vira zero nem lista vazia silenciosa**: a tela mostra AvisoFalha
  com "Tentar de novo" e `—` no número.
- Implementação real: `supabase.rpc(...)`. Implementação de exemplo: `servicos/dadosExemplo.js`, com dados
  **sintéticos** (nomes de projeto inventados, nenhum nome de pessoa real, nenhum CPF), cobrindo: centro em
  dia, atenção, problema (grupo negativo), sem balancete, sem plano, sem dado (erro), 2 centros ocultos,
  pendência com e sem centro, parcelas recebida/futura/atrasada.
- Escolha: `import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo'` usa o exemplo **sem login** (para
  conferir telas); qualquer outro caso usa o real. O exemplo **não pode entrar no build de produção** (import
  dinâmico dentro do `if` do DEV; confira com `grep` no `dist/` que nenhum nome do exemplo aparece).
- Acrescente um script `"dev:exemplo": "vite --mode exemplo"` (ou equivalente) e um `.env.exemplo` com
  `VITE_DADOS=exemplo` dentro de `app/`.

## Telas

### Projetos (`#/projetos`, página inicial)
Exatamente a tela de referência da `estetica.md` §5: CabecalhoPagina "Projetos" + linha de contexto
"17 centros · R$ 1,24 mi livres no total" (+ " · 2 centros ocultos" quando houver; o total soma só `livre`
não nulo e diz quantos ficaram de fora se algum for null: "3 centros sem número"). Chips de situação
(Todas, Em dia, Atenção, Problema, Sem balancete — só os que têm algum centro). LinhaDeLista em ordem
alfabética: nome, código, "R$ 84.300 livres até ago/27" (`end_date`) ou "—", Situação. A linha leva a
`#/projeto/<id>`. Carregando = Esqueleto; vazio = Vazio ("Nenhum centro para mostrar" e, se houver ocultos,
botão "Mostrar todos").

### Página do projeto (`#/projeto/<id>`)
Referência da `estetica.md` §5 (o catálogo `#/componentes` já tem o desenho):
- Cabeçalho: "← Projetos", "Nome · código", "Vigência até 31/08/2027 · faltam 21 meses · vigência digitada"
  (`--fs-1 --cor-texto-3`, até a F4), botão "Pasta no Drive" **só para admin** e só se houver URL.
- Destaque principal: `livre` do resumo (o mesmo número da lista, nunca recalculado), "livres para gastar até
  ago/27", "balancete de set/26". Clicável: abre PainelLateral "De onde vem este valor" com as partes por
  grupo vindas de `get_saldo_livre` (previsto − realizado − comprometido = livre, uma linha por grupo, e o
  total igual ao destaque). Se a soma das partes não bater com `livre`, mostre AvisoFalha no painel, não
  esconda.
- Destaques menores: "Bolsas por mês" (soma de `valor_mensal` de `bolsas_ativas` — é soma de exibição,
  permitida; o compromisso vem pronto), "Repasses N de M" (calculado com `situacaoDasParcelas` importado de
  `frontend/js/planejamento-dinheiro.js`, sobre `get_repasses_v2`; "próximo em jan/27"), "Pendências N".
- Abas (componente Abas): **Dinheiro** (Tabela por grupo: Rubrica, Previsto (R$), Realizado (R$),
  Comprometido (R$), Livre (R$), Situação; linha abre o PainelLateral do grupo com as rubricas dele e a
  `compromissos_cobertura` em frase curta), **Bolsas** (lista de `bolsas_ativas`: bolsista, valor por mês,
  até quando), **Documentos** (planos e balancetes do centro, mais recente primeiro; abrir o arquivo fica para
  a F2 — por ora só a lista com data e tipo), **Pendências** (as do centro; admin e professor do centro podem
  marcar "Resolvida" ou "Descartar", com confirmação no próprio cartão, sem `confirm()` do navegador).
- Projeto sem balancete: destaque "—" e a frase "sem balancete"; nunca "R$ 0". Sem plano: idem com
  "sem plano".

### Filtro de visão (admin)
Chip na barra do topo, como `estetica.md` §5: "Todos os centros" ou "12 de 17 centros" (acento suave quando
há oculto). Abre MenuSuspenso com os centros de `todos`, agrupados por professor (`responsaveis[0]`, "Sem
responsável" por último), caixas de seleção, atalhos "Só os de <professor>" e "Mostrar todos". Salva com
`set_filtro_visao_v2` e recarrega o resumo e o sino. Professor não vê o chip.

### Sino
Contagem de `listar_pendencias_v2()` abertas (respeita o filtro; as sem centro sempre contam para o admin).
Três estados (consultando / indisponível / contagem), como o site antigo. Abre um PainelLateral com a lista;
cada pendência leva à aba Pendências do projeto (ou fica no painel, se for sem centro).

### Barra do topo
Projetos ativo nessas rotas; Análise e Admin continuam "Em construção".

## Testes (vitest, em `app/tests/`)
- `dados.test.js`: erro de RPC devolve `{ erro }` e nunca número; o exemplo não é importado fora do DEV.
- `projetos.test.jsx`: lista em ordem alfabética, chips filtram, linha de contexto com e sem ocultos, centro
  sem balancete mostra "—" e "sem balancete".
- `projeto.test.jsx`: destaque igual ao `livre` do resumo; painel soma as partes; Repasses usa
  `situacaoDasParcelas`; Pasta no Drive some para professor.
- `filtro.test.jsx`: chip mostra "N de M"; "Mostrar todos" salva lista vazia.
- A guarda de estilo (`npm --prefix app run build`) tem de passar.

## Pronto quando
- `npm --prefix app test`, `npm --prefix app run build`, `npm run lint` e `npm test` verdes.
- Em `npm --prefix app run dev:exemplo`, a 1280 px e a 360 px: sem rolagem horizontal da página, nenhum valor
  fora do cartão, todos os estados de exemplo visíveis. Conferido por você no navegador headless (como na
  4ª rodada da F0-B); registre as medidas no relatório.
- Relatório `docs/redesenho/relatorios/F1-B.md`: o que fez, como conferiu, desvios do contrato, dúvidas.
- Commit na branch do worktree (conventional commit). **Sem push.**

## Correções depois da revisão (18/11, dois DeepSeek, conferidas pelo Claude) — valem por cima do texto acima
1. **Arquivos**: além de `app/src/**` e `app/tests/**`, pode editar `app/package.json` (script `dev:exemplo`),
   criar `app/.env.exemplo` e escrever o relatório `docs/redesenho/relatorios/F1-B.md`. Nada mais fora de `app/`.
2. **Centro sem plano**: `get_saldo_livre` com `has_plano = false` devolve **só** `has_plano, has_balancete,
   project_id, project_name, message` (048). Ausência de `grupos`/`bolsas_ativas` = "sem plano" e `—`, nunca
   "0 bolsas" nem tabela vazia.
3. **Bolsas por mês** soma só as de `bolsas_ativas` com `end_date >= hoje` (o array traz bolsa já encerrada
   dentro da janela de compromissos, 048). "N bolsistas ativos" usa o mesmo critério.
4. **Repasses**: chame `situacaoDasParcelas({ parcelas, recursos, dataBalancete: data_balancete, hoje,
   totalPlano: valor_total_plano })`, exatamente como `frontend/js/pages/planejamento.js:209`.
5. **Sino** abre **MenuSuspenso** (como `Sino.jsx` e `estetica.md` §4/§6b), não PainelLateral. Cada item leva a
   `#/projeto/<id>/pendencias`: o roteador ganha a aba como segmento opcional
   (`dinheiro|bolsas|documentos|pendencias`) e a página abre nela. Pendência sem centro fica no menu, sem link.
6. **Catálogo**: em `paginas/Componentes.jsx`, troque o destaque "Valor digitado" por "Pendências", para o
   catálogo bater com a `estetica.md` §5 (o estado "valor digitado" continua no catálogo, no componente Valor).
7. **Papel do usuário** vem do perfil que `App.jsx` já carrega (`carregarPerfil` → `role`), não de `todos`
   estar vazio. O botão do Drive aparece só para admin **e** só se `drive_folder_url` vier preenchido (o banco
   já manda `null` para professor).
8. **Documentos**: duas funções na camada de dados, `balancetes(id)` e `planos(id)`, cada uma com o shape da
   RPC; a aba junta as duas listas por data (balancete: `data_referencia`; plano: data do documento/versão).
9. **Filtro**: agrupa por `responsaveis[0]` só para exibir; o atalho "Só os de X" seleciona todo centro em que
   X está em `responsaveis`.
10. **Sem criação de pendência na F1**: em produção o sino e a aba podem nascer vazios; o Vazio da aba diz
    "Nenhuma pendência neste centro". Não crie tela de criar pendência.
11. **`erro` do resumo** é o código fixo `'falha_saldo_livre'`: mostre "Não foi possível calcular o saldo deste
    centro" e `—`, situação "sem dado".
