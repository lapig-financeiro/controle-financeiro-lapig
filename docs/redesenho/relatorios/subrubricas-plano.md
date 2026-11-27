# Subrubricas do plano na v2

## Execução por item do plano

O acordeão consulta os vínculos registrados no balancete que o site antigo já lê
por `get_previsto_vs_realizado` (migração 053). O encaixe com a árvore da v2 usa o
código da rubrica e a descrição normalizada, preservando os rótulos da árvore com
a máscara por perfil. A tela confere o identificador do balancete e os totais da
rubrica antes de usar os valores por item.

Lançamentos sem item atribuído e valores vinculados que ficaram fora da lista
aparecem em totais à parte. O livre por item só aparece quando as despesas estão
atribuídas e não há compromisso a repartir. O saldo livre do grupo continua vindo
de `get_saldo_livre`.

Conferência só de leitura no 30.068. Os três itens de Material de Consumo têm
vínculo no balancete. O realizado fecha ao centavo com o grupo e a tela mostra o
saldo negativo do item que ultrapassou o previsto. Conferido no Edge com dados
reais em 1280 e 390 px. Nenhuma alteração de banco foi necessária.

Revisão independente pelo OpenCode com DeepSeek V4.1 Flash max. Após a revisão,
o acordeão passou a conciliar as contas, o realizado vinculado e o valor sem item
antes de exibir a divisão. Também distingue um código que é subrubrica por si só
de um item que precisa de vínculo individual. Um rótulo com CPF mascarado não é
usado como identificador para atribuir valores. A API recusou consulta sem sessão.

## Acordeão e painel de origem

Na aba Dinheiro, clicar na linha expande as subrubricas logo abaixo. A tabela
mostra previsto, realizado, comprometido e livre. O realizado positivo é vermelho
e o livre positivo é verde. O filtro mantém apenas itens com previsão positiva.
Quando o plano descreve vários itens sob o mesmo código, o sistema mostra o
previsto de cada item. Um traço indica os valores que só existem no total do código.

O botão “Ver origem dos valores” abre o painel com as quatro medidas no topo e a
origem abaixo. Os atalhos para o plano e o balancete continuam visíveis na árvore.
O acordeão e o painel aproveitam a mesma consulta, com máscaras e escopo vindos
da RPC existente.

Na revisão, passaram o lint, os 941 testes da raiz, os 391 do app e o build. O Edge
foi conferido em 1280 e 390 px no modo exemplo, incluindo o acordeão por teclado,
as cores, os atalhos de origem e o retorno de foco ao fechar. O centro 30.068 segue
pendente de conferência em produção.

## Primeira versão

Na aba Dinheiro, uma seta ao lado do nome indica que a rubrica abre o painel lateral.
Quando há detalhamento, “Subrubricas do plano” mostra o nome e o valor previsto com
centavos. Entram apenas linhas com valor previsto positivo. Uma linha genérica com o
mesmo nome da rubrica principal fica de fora. A lista reúne tanto subrubricas do
catálogo quanto itens com descrição livre no plano.

O painel reutiliza os itens do plano ativo retornados por `explicar_livre_v2`, que já
aplica a máscara de CPF por perfil. A árvore de origem continua disponível no mesmo
painel. Se ela estiver indisponível, o resumo de reserva mostra as subrubricas do
catálogo com valor previsto positivo em `get_saldo_livre`. Isso cobre também a
consulta sem balancete, até o nível de detalhe que o resumo retorna.

O teste de tela verifica o filtro, a ausência de duplicata da rubrica principal e
que a lista só aparece ao abrir o painel. A conferência visual foi feita no Edge,
com o modo exemplo, em 1280 e 390 px. Também foram verificados a abertura por
teclado e o retorno do foco ao fechar com Esc. O centro 30.068 não foi conferido
com dados de produção.

Lint, build e guardas de estilo e de bundle passaram. Os 941 testes da raiz e os
391 do app passaram. Na primeira rodada simultânea, um teste de Bolsistas atingiu
o limite de tempo. A suíte do app passou inteira ao ser executada isoladamente.
