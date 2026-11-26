# Análise — o que o Victor estranhou nas primeiras perguntas reais (26/11/2026)

Feito pelo Claude, sem executor delegado (ajustes pequenos na tela). Nada aplicado no banco.

## 1. Enviar com Ctrl+Enter
O Victor achou antinatural ("IA nenhuma funciona dessa forma"). Agora o **Enter envia** e o **Shift+Enter quebra a
linha**. Durante a composição de acento (`isComposing`), o Enter não envia. Arquivo: `app/src/paginas/Analise.jsx`
(`aoTeclar`); teste em `app/tests/analise-tela.test.jsx`.

## 2. Pergunta e resposta sumiam ao trocar de aba
Duas causas:
- **Aba do navegador**: o `auth-js` (2.119) dispara `SIGNED_IN` toda vez que a aba volta a ficar visível
  (`_onVisibilityChanged` → `_recoverAndRefresh`). O `App.jsx` reaplicava o usuário, o perfil passava a "carregando",
  a rota da Análise devolvia `null` e a tela era desmontada. De quebra, o perfil, o resumo e o sino eram recarregados
  sem necessidade em todas as telas. Correção: `usuarioIdRef` faz o `App` ignorar o `SIGNED_IN` quando o usuário é o mesmo.
- **Aba do site** (Projetos ↔ Análise): o estado morava dentro do componente. Agora a Análise fica montada depois da
  primeira visita e só é escondida (`hidden`) fora da rota. A análise em curso continua rodando e o rascunho permanece.
  Ao sair, painel e documento fecham (`ativa = false`). No logout, a tela é desmontada (`analiseMontada` volta a `false`).
- Recarregar a página (F5) ainda perde a conversa: isso entra com o histórico (item 4).
Teste em `app/tests/analise-acesso.test.jsx`. O mutante sem o filtro de `SIGNED_IN` é pego.

## 3. "A conta e o documento funcionam?" (pergunta do 30.103, refeita em produção)
- **Realizado — Bolsas** → conta `7.1.3.04.01.09142 — BOLSA DOAÇÃO` → clicar no valor abre o **balancete de nov/26**
  com a linha destacada. Funciona.
- **Previsto — Bolsas**, aberto pela árvore do livre → linha "Bolsas" (anterior à rastreabilidade) → clicar no valor
  abre o **Plano de trabalho v4** (5ª carta de remanejamento) com a linha "Bolsas R$ 212.800,00" destacada. Funciona.
- **Defeito achado**: na tabela "Composição do grupo Bolsas", o modelo citou a **própria linha do plano** (uma folha
  com `ref`). O painel "De onde vem" abria só o topo, com o valor sem clique e nada embaixo, ou seja, um beco sem saída.
  Correção em `app/src/componentes/DeOndeVem.jsx`: quando a raiz é uma folha com `ref`, o valor do topo abre a origem
  como a folha abriria dentro da árvore, com a mesma nota ("a linha é procurada ao abrir") e o mesmo aviso de falha.
  Testes em `app/tests/de-onde-vem.test.jsx`.
- Para o Victor: o documento fica sempre **na folha** da árvore. Basta abrir a seta até o último nível e clicar no valor.

## 4. Histórico e conversa contínua
Ainda não implementado. O desenho foi conversado com o GPT-6.2 Sol (medium, só leitura, na pasta do projeto).
O que ele propõe, conferido pelo Claude:

- **Dados**: tabela de conversas (dono, título editável, última atividade) e a 074 como base dos turnos (ordem,
  pergunta, resposta, estado). Guardar o **retrato que a pessoa viu** (texto, blocos, valores, origens, avisos) e
  mostrar "Respondida em 26/11, às 14h32". A origem `no` já é retrato. Nas origens `livre`, `ref` e `termo`, o clique
  diz "Consultar origem atual", e "Refazer com os dados de hoje" gera um turno novo.
- **Retenção**: enquanto a conta estiver ativa ou até a pessoa excluir a conversa, com nomes de bolsistas fora do
  retrato persistente. **Conferido**: hoje os 180 dias são apagados pela própria `analise_registro_iniciar` (074, l. 196).
- **Acesso**: cada pessoa vê só o que é seu, e só enquanto tiver acesso aos centros envolvidos. Se perder acesso a um
  centro, o turno some inteiro. A `analise_registros_admin` devolve o conteúdo integral e precisa mudar antes de abrir
  a Análise para mais gente.
- **Furo apontado e conferido**: a `analise_registro_concluir` tem `grant` para `authenticated` (074, l. 303). Quem
  está logado pode gravar o conteúdo do próprio registro, então um retrato salvo não serve de evidência enquanto a
  conclusão não passar por um caminho só da Edge Function. A gravação também é best-effort: a tela precisa mostrar
  "Salva", "Parcial" ou "Não foi possível salvar".
- **Continuação**: o navegador manda o id da conversa e o servidor busca os **2 últimos turnos** (teto de ~4 KB, máscara
  aplicada no servidor), com uma projeção pequena dos blocos (centro, indicador, período, valor), para "e se eu
  descontar aquele valor?" ter referente. Perguntas sobre hoje consultam as RPCs de novo.
- **Assuntos misturados**: não brigar com isso. A janela curta torna a mistura quase inofensiva. Uma pergunta completa
  ("bolsas do 30.111") prevalece sobre o assunto anterior; com dois referentes possíveis, o modelo pergunta
  ("o saldo ou as bolsas?"). Classificar assunto, resumir a conversa toda ou sugerir dividir fica para depois
  (custa CPU e atrapalha comparações legítimas).
- **Tela**: lista lateral de conversas (no celular, um botão "Conversas"), a conversa da mais antiga para a mais nova
  com o campo fixo embaixo, e "Nova conversa" que só cria o registro no primeiro envio.
- **Testar antes**: perda de acesso a um centro, origem que mudou, queda no meio da resposta e duas perguntas
  seguidas sobre centros diferentes.

Acréscimo do Claude para a preocupação com leigos: além da janela curta, uma conversa parada por muitas horas (por
exemplo, de um dia para o outro) abre por padrão como **conversa nova**, com "continuar a anterior" a um clique.
Quem volta no dia seguinte quase sempre traz outro assunto. Falta a decisão do Victor; a implementação vira a
migração das análises salvas e entra no lugar da Etapa 4 do `analise-plano.md`.

## Verificação
`npm run lint` limpo; raiz 931; app 338; `npm --prefix app run build` ok. A conferência do item 3 foi feita em
produção, no navegador do app, com o login do Victor (uma pergunta gasta). As correções 1, 2 e 3 **não estão
publicadas** até o push para o `master`.
