# Subrubricas do plano na v2

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
