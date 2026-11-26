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

## 5. Segunda rodada de retorno (26/11, pergunta do 30.109)

**Decisões do Victor sobre o histórico**: guardar enquanto a conta existir; nomes de bolsistas podem ficar na
resposta salva; tela como sugerido (lista de conversas, "Nova conversa", conversa parada de um dia para o outro abre
nova por padrão). A implementação fica para depois destes ajustes.

**"Bloco acima" com o bloco embaixo.** A tela põe o texto final antes dos blocos, mas o modelo escrevia como se
fosse o contrário. A regra 11 das `INSTRUCOES` (`shared/ai-tools/index.js`) diz que o texto aparece antes, que os
blocos se citam como "abaixo" e que não se cria bloco de texto repetindo o texto final (o "Leitura" do 30.109).

**Resposta mais didática.** A regra 12 pede: primeira frase com a resposta direta e o número principal (a regra 6
passou a permitir repetir esse número); depois, em 2 ou 3 frases, como se chega a ele em palavras do dia a dia;
cada termo (previsto, realizado, comprometido, livre) explicado na primeira vez; sem "grupo de rubrica" ou siglas
soltas; e o que olhar nos blocos abaixo. O texto passou de 3 para até 6 frases curtas. Datas em dd/mm/aaaa e
valores com centavos: na primeira bancada o modelo escreveu "1º de março de 2026", e o "1" e o "28" viraram
"sem origem".

Bancada com o DeepSeek de verdade (`worker/bancada`, retrato de exemplo): 4/4 depois do ajuste das datas. A
pergunta 4 falhou uma vez (o modelo errou a tabela três vezes e esgotou as rodadas), mas passou nas três
repetições, a mesma variação que o ESTADO já registra. Exemplo de texto novo: "O centro 30.901 tem R$ 120.000,50
livres para gastar. Livre é o que sobra depois de descontar o que já está prometido. […] A tabela abaixo mostra
quanto sobra em cada grupo de despesa." Expectativa da bancada trocada de `bloco` para `abaixo`, mais
`texto_nao_contem: acima`.

**Caminho até o documento.** Em `app/src/componentes/DeOndeVem.jsx`:
- árvore com até 15 nós abre inteira (`abrirTudoAte`), em vez de só o primeiro nível;
- folha com documento ganha o atalho escrito **"Ver no balancete ›"** ou **"Ver no plano ›"**, além do valor
  sublinhado. Valor digitado (bolsa) não ganha atalho, porque não há arquivo para abrir.
O componente é o mesmo da página do projeto, que ganha as duas melhorias. Testes em `app/tests/de-onde-vem.test.jsx`
(os antigos que testam o recolhimento passam `abrirTudoAte={0}`). Visto no modo exemplo: a árvore abre inteira.
O exemplo não tem folha de balancete com arquivo, então o atalho do balancete fica para conferir em produção.

Verificação: lint limpo; raiz 932; worker 204; app 339; builds `app` e `edge` ok.

## 6. Conferência em produção depois da publicação (26/11)

Pergunta real "Quanto o 30.109 tem livre hoje, e de onde vem?":
- O texto melhorou: resposta direta com o número, explicação de previsto, realizado e comprometido, e "as tabelas
  abaixo".
- O atalho "Ver no plano ›" apareceu nas folhas do plano.
- **Defeito novo, mais grave**: na tabela "Previsto, realizado e livre por grupo", Passagens, Diárias e
  Investimento mostravam **Realizado = previsto** (R$ 141.000,00 etc.). Esses grupos não têm lançamento no
  balancete, a árvore não traz nó de realizado, e o modelo preencheu a coluna com a única linha do plano, que fica
  logo abaixo do "Previsto". As instruções novas, que pedem para explicar a conta, levaram o modelo a montar uma
  tabela maior, e a falta de célula vazia apareceu.
- O número saiu entre `**…**`, porque a tela não interpreta markdown.

Correções:
- `criar_bloco` aceita `null` nas colunas 2 em diante, e a tela mostra "—" com "sem valor para esta coluna".
  A linha que cita um nó e o seu filho único é recusada, com a instrução de usar `null`. Uma coluna só de vazias
  é recusada.
- `INSTRUCOES` 5 e 12: célula sem nó é `null`, nunca outro nó parecido; texto sem markdown.
- `semMarkdownDeEnfase` tira `**`, `__` e `#` de título antes de marcar o texto (vale para o Worker e para a Edge).
- Testes: `tests/ai-tools-v2/blocos.test.js` (a recusa e a célula vazia), `texto.test.js` e
  `app/tests/bloco-analise-celula-vazia.test.jsx`. Bancada real 4/4 nas repetições (a pergunta 3 teve um texto fraco
  uma vez e passou nas 3 seguintes).

Conferência em produção da correção (`5325847`): Realizado virou "—" nos grupos sem gasto, mas o **Previsto**
também. Nesses grupos o próprio grupo (o livre) tem um único filho, o "Previsto", e a trava recusava grupo +
Previsto na mesma linha, que é uma leitura legítima (previsto = livre quando nada foi gasto). A trava agora pega só
a **folha** ao fim da cadeia (a linha do documento repetindo o valor), e a instrução 5 diz para citar o
"Previsto — …" do grupo na coluna do previsto. Teste unitário de `abaixoPorFilhoUnico` com os dois casos.
