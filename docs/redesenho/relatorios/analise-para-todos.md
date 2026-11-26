# Análise para toda conta, guia de primeiro acesso e ajustes (26/11/2026)

Pedido do Victor: abrir a Análise para todo mundo com conta, fechar pendências do site, um guia rápido para
quem abre pela primeira vez, o atalho ao documento original fora da Análise e "Copiar" nas tabelas da Análise.
Feito pelo Claude, sem executor delegado. Sem migração.

## O que mudou
- **Análise para admin e professor.** Tela: menu e rota `#/analise` passam a valer para `professor`
  (`podeAnalise` em `App.jsx`, `BarraTopo`); agente e automação seguem sem a tela. Servidor: o padrão de
  `ANALISE_PAPEIS` em `worker/src/auth.js` vira `admin,professor` (o projeto não tem esse segredo na Edge
  Function, conferido por `supabase secrets list`, então o padrão vale). `wrangler.toml` e os dois READMEs
  acompanham. A primeira sugestão deixa de citar o 30.109 ("Quanto cada um dos meus centros tem livre hoje…").
  O escopo continua no banco: todas as ferramentas chamam RPCs com o JWT da pessoa (`resumo_projetos_v2`,
  `explicar_livre_v2`, `get_pedido_bolsas_v2` etc.), que já filtram por `user_projects`; a máscara de nomes
  lê só os bolsistas que a pessoa vê.
- **Atalho ao documento na página do projeto e na Análise.** Árvore com mais de 15 nós ficava fechada e o
  "Ver no balancete/plano ›" da folha só aparecia depois de abrir as setas; na Análise o painel costuma abrir
  uma árvore pequena, por isso parecia que o atalho só existia lá. Agora o painel da rubrica (Projeto) e os
  painéis da Análise abrem o caminho até cada folha com documento (`abrirAteDocumentos`); as bolsas do
  comprometido, sem arquivo, ficam fechadas (no 30.111 o grupo de Pessoal tem 165 nós).
- **Copiar tabela** em todo bloco de tabela da Análise: texto separado por tabulação (cola em colunas no Excel e
  no Planilhas), números em pt-BR sem "R$" e com hífen comum no negativo, coluna em reais ganha "(R$)" no
  cabeçalho, data dd/mm/aaaa, vazio como "—" (nunca zero) e `⟦Pn⟧` como "pessoa n". Se a área de
  transferência for negada, tenta `execCommand('copy')`; se também falhar, a tela diz para selecionar e usar
  Ctrl+C.
- **Guia de primeiro acesso** (`BoasVindas.jsx`): painel lateral com Projetos, origem dos números, Bolsistas,
  Análise, Sino e (só admin) Admin. Abre sozinho uma vez por login neste navegador (`localStorage`
  `cf_boas_vindas_<user_id>`) e volta pelo menu do usuário, em "Como usar o site".
- **Admin**: clicar na linha de um login editável abre o painel (pendência anotada em 20/11); Buriti e automação
  continuam sem clique. `Tabela` ganhou `linhaClicavel`.

- **Leitor de documentos (DOCX).** O plano em DOCX é convertido em HTML (mammoth) para o site poder marcar a
  linha de onde saiu o valor; por isso não tem a cara do Word. A rolagem lateral era da própria folha e a
  barra só aparecia no fim do documento. Agora a folha ocupa a largura disponível (`fit-content`), a tabela
  quebra a linha nas células (`--medida-celula: 32ch`) e, se ainda assim não couber, quem rola é a área de
  visualização, com a barra sempre à vista. PDF (balancetes) segue mostrando a página original.

## Segunda rodada (revisões DeepSeek V4.1 Flash max e MiniMax 3.1 Flash max, só leitura)
Nenhum achado alto nas duas; as duas seguiram cada ferramenta até a RPC e não acharam caminho de professor
ver centro, valor, nome ou documento de outro centro. Corrigido pelo Claude depois de conferir cada achado:
texto do botão de centros no guia; árvore aberta só até os documentos (no lugar de abrir tudo); primeira
coluna da tabela com o mesmo texto na tela e na cópia; foco e seleção devolvidos na cópia de reserva e
acesso à área de transferência dentro do `try`; texto que começa com `= + - @` sai com apóstrofo (não vira
fórmula); `-0` sai `0,00`; rótulo que já tem "R$" não ganha "(R$)"; sugestão neutra para admin; guia fecha
na troca de login e `localStorage` lido dentro do `try`; agente e automação recusados no servidor mesmo que
alguém os ponha em `ANALISE_PAPEIS` (`PAPEIS_NUNCA`); teste do papel padrão sem passar a lista; documento com
caminho anulado (nome que parece CPF) mostra a nota em vez de abrir o leitor, e a nota também aparece quando
o painel abre direto numa folha (defeito antigo achado pelo teste novo). Ficaram para o Victor: automação
não barrada nas RPCs de histórico da 074/075 (pede migração; impacto baixo) e o histórico de quem perde o
centro. Não feitos: título da tabela na cópia (atrapalha colar em planilha existente) e o "50" fixo no guia
(a tela da Análise já fixa o mesmo número).

## Bancada real (modelo deepseek-v4.1-flash, retrato de produção de 26/11)
- Bateria de 20 perguntas com o código desta rodada: 18/20, o mesmo placar da rodada anterior. A 4 caiu por
  erro interno (passou ao repetir). A 6 ("quais bolsas terminam nos próximos 60 dias?") tinha **erro de
  conteúdo**: o texto dizia "nenhuma termina" e, na mesma frase, que 68 terminam em 31/12/2026. O modelo
  filtrava datas de cabeça. Correção: a ferramenta `bolsas` ganhou `terminam_em_dias` (1 a 366), que filtra
  quem termina entre hoje e hoje + N e devolve "periodo" com os dias, a data-limite e a contagem, todos com
  origem. Depois disso a resposta foi "74 bolsas, até 25/01/2027", igual à contagem feita direto no retrato
  com o mesmo filtro de visão (12 ficam fora da visão do login). Resta marcado como "sem origem" só o "60"
  ecoado da pergunta.
- Bateria inteira de novo com a correção (`bateria-26-final`, fora do git): 18/20. As duas que caíram (3 e 6)
  têm conteúdo certo e caíram só por um número no texto fora de bloco (o "60" da pergunta; uma data na 3).

## Conferência dos valores em produção (só leitura, 26/11)
- Site novo × site antigo, 21 centros: raiz da árvore = livre do resumo e = soma dos grupos de
  `get_saldo_livre`, e previsto, realizado e livre iguais ao centavo nos 105 grupos de 17 centros com número.
  Diferenças esperadas: 3 centros sem plano e o 30.XXX sem balancete (o antigo mostra o previsto inteiro,
  R$ 765.500, como livre; o novo mostra "—").
- Todos os nós das árvores fecham (soma das partes = nó).
- 585 folhas com origem: 439 iguais ao valor gravado na tabela de origem e 146 bolsas em que meses ×
  mensalidade gravada = valor da folha.
- Contra o documento original: amostra de folhas "documento" com o fato conferido; das 148 folhas "legado",
  134 têm o valor escrito no documento ligado. As 14 restantes: 7 do 30.103 estão no documento sem centavos
  ("R$ 8.000"); 6 do 30.117 (CIP 7.490,67 ×2 e DAO 16.229,78) não aparecem no 3º remanejamento ligado, mas
  batem com 3% e 6,5% do total de R$ 249.688,89; 1 do 30.068 (bens permanentes R$ 1.584.230,60) não aparece
  na planilha xlsx ligada. Esses dois últimos são de rastreabilidade (qual documento mostrar), não de cálculo.

## Conferência
- Testes novos: acesso (professor vê, agente não), guia (abre uma vez, "Entendi" grava, reabre pelo menu,
  passo de Admin só para admin, agente sem guia), `tabelaParaTexto` e botão (copiou/falhou), árvore grande com
  `abrirTudoAte={Infinity}`, linha do Admin. Worker: professor passa pelo padrão, agente e automação recusados,
  `ANALISE_PAPEIS=admin` restringe de novo.
- Gates: `npm run lint` 0; raiz 938; app 376; worker 212; `build:edge` regenerado; build do app sem dado de
  exemplo.
- Navegador (modo exemplo, 1024 e 800 px): guia aberto no primeiro acesso e fechado em "Entendi"; botão
  "Copiar tabela" ao lado do título; clique real mostrou "Copiada" (via reserva, porque o painel do app nega a
  API nova; clique por script mostrou a mensagem de falha).

## Não feito / limites
- **Conversas de centros perdidos.** Se um professor perde acesso a um centro, as respostas antigas dele sobre
  esse centro seguem no histórico (números que ele já viu). Esconder exige saber quais centros cada turno
  consultou: o servidor teria de gravar os centros resolvidos e uma migração (076) filtraria
  `analise_conversas_listar`/`_ler`. Os ids não estão de forma confiável em `passos` (o argumento é o código,
  ex. "30.109"). Fica como decisão do Victor.
- Nenhum login de professor de verdade foi usado no teste: o escopo foi conferido nas RPCs (arquivo e
  revisões) e pela bancada, que tem cenário de professor.
- Publicar: push no `master` (site) e `npx supabase functions deploy analise` (servidor), com o ok do Victor.
  Até a Edge Function ser republicada, professor que abrir a Análise recebe "não disponível para este tipo de
  conta".
