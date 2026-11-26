# Revisão da v2 do Buriti · 26/11/2026

A revisão passou pela entrada, pela troca de conta, pela navegação entre centros, pelo filtro de visão, pela Análise e pelo pedido de bolsas.

| Área | O que foi encontrado | Correção |
|---|---|---|
| Análise | O campo sugeria um centro fixo para todo mundo. | O exemplo e a primeira sugestão usam um centro da lista de Projetos da própria conta. Enquanto a lista carrega, falha ou está vazia, a pergunta é genérica. O filtro de visão do admin também vale para o exemplo. |
| Bolsistas | Admins e professores podiam abrir o pedido, inclusive por link direto. | A permissão por conta controla o menu e a rota. A migração 076 guarda a mesma regra no banco. |
| Troca de conta | Uma consulta de perfil iniciada na conta anterior podia terminar depois da troca e sobrescrever o perfil atual. | O aplicativo descarta respostas antigas e limpa o resumo, o sino e a conversa em memória quando o login muda. |
| Abertura durante manutenção | A interface podia aparecer antes da primeira consulta a `manutencao.json`. | A tela aguarda a consulta inicial, com prazo de cinco segundos em caso de falha de rede. Respostas antigas de consultas sobrepostas são descartadas. |

## Guia de navegação

O convite aparece no primeiro acesso de cada conta ao navegador. O botão **Iniciar tour** abre Projetos. O guia segue para a aba Dinheiro de um centro visível, ensina a abrir o sino e leva à Análise. As etapas de Bolsistas e Admin acompanham as permissões da conta. A pessoa pode usar a página durante cada passo e reiniciar pelo menu de iniciais, em **Como usar o site**. No celular, durante o guia, o campo de pergunta rola com a página e deixa o botão Conversas visível.

## Acesso ao pedido de bolsas

A concessão é explícita e começa desligada para todas as contas. O banco recusa as sete operações de edição do pedido sem a permissão. A consulta usada pela Análise continua trazendo as bolsas permitidas para a conta. Equipes e caixas só aparecem na consulta de quem pode montar o pedido.

A 076 foi testada em PostgreSQL descartável com contas sintéticas. Os roteiros cobrem concessão e revogação, escopo por centro, recusa de autoatribuição, bloqueio das sete edições, acesso sem login, atributos das funções, gatilho do agente e os casos anteriores da 068 e da 069.

## Validação e publicação

Os testes da aplicação cobrem o centro sugerido, as rotas, o guia, a troca de conta e a manutenção. A navegação foi conferida no Edge em 360, 390 e 1280 px com dados de exemplo e sessões simuladas. O teste da faixa de origem em PDF, que falhou de forma intermitente sob carga, agora espera a renderização antes de comparar as coordenadas.

A 076 segue o fluxo descrito em [Aplicar uma migração](../../aplicar-migracao.md). Depois de aplicar, conceder por ID apenas à conta indicada pelo Victor com a RPC administrativa `definir_acesso_bolsistas_v2`, seguindo o protocolo de escrita em produção. Conferir que há uma única concessão e validar a rota com uma conta autorizada e outra sem a permissão.
