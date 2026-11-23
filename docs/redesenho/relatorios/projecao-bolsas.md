# Projeção das bolsas — relatório (23/11/2026)

Branch `redesenho/projecao-bolsas`, worktree `C:/Users/amara/dev/cf-projecao`, a partir do `master` 8aab090.
Tarefa: [`docs/redesenho/tarefas/projecao-bolsas.md`](../tarefas/projecao-bolsas.md). Sem push, sem migração e sem chamar
outra IA. Todos os dados dos testes e do modo exemplo são fictícios.

## O que foi feito

### A conta (`app/src/servicos/projecao.js`)

Função pura `projetarBolsas({ saldo, repasses, hoje, contar })`, sem DOM, rede ou `new Date()`. Ela usa a mesma
`situacaoDasParcelas` de `frontend/js/planejamento-dinheiro.js` e o `vencimento` que passou a ser exportado (só o
`export` mudou no site antigo).

- A folha é montada por mês: cada bolsa paga `valor_mensal` por `meses` meses a partir de `compromissos_inicio` e
  deixa de pesar quando termina. Bolsa sem valor ou sem meses válidos → `dado_incompleto` (nunca zero).
- O orçamento começa na soma de `saldo` das rubricas `compromisso_tipo === 'bolsas'` e desconta a folha de cada mês.
  O limite é o primeiro mês em que o que restou do mês anterior não paga mais uma folha; um resto menor que a folha
  depois da última bolsa não vira limite (não há outra folha).
- O dinheiro em conta começa em `saldo_disponivel_caixa` e, com a opção "Rendimento" desligada, desconta
  `rendimento_liquido` (nunca soma de novo). Sem balancete ou caixa nulo → `sem_balancete`.
- Desembolsos futuros entram no mês do vencimento; dia ≤ 07 antes da folha, depois do dia 07 depois. Atrasados
  (`atrasada`, `confirmar`, `parcial`, `nota_emitida`) aparecem sempre em `atrasados` e só entram na conta com a
  opção ligada, no primeiro mês, antes da folha. `sem_data`, `sem_valor` e `sem_balancete` nunca contam e vão para
  `fora`. O valor que entra é `falta × (1 − taxa_fracao)`, com `taxa_fracao` = previsto das rubricas de taxa ÷
  previsto de todas as rubricas.
- Plano sem valor em nenhuma parcela → `repoe_gasto` (vale o orçamento). Sem bolsas → `sem_bolsas`. Mês a mês com
  arredondamento de centavos a cada passo.
- `depende_de` só aparece quando o desembolso entra depois da folha no próprio mês da falta e, depois dele, nenhum
  mês fica negativo de novo. `mes_mais_apertado` é o menor `em_conta_apos_folha`.

Decisões de defesa que a tarefa não detalhava (registradas como desvio):

- Se não houver nenhuma rubrica com `compromisso_tipo === 'bolsas'`, devolve `dado_incompleto` em vez de assumir
  orçamento zero e inventar um limite no primeiro mês.
- Um desembolso futuro que vence antes do primeiro mês da conta entra no primeiro mês, com aviso em `avisos`, para
  não sumir da conta (o caixa do balancete é anterior a ele).
- O limite do orçamento é comparado com o orçamento **antes** da folha do mês; é o que faz o cenário obrigatório com
  rendimento terminar em `ate_o_fim` com sobra de 60.000, e não em um falso limite no último mês.

### A tela (`Projeto.jsx`)

- Cartão "Bolsas por mês": ganhou a linha "Cabem até …" com o motivo curto. A data fica em `--cor-texto`; quando
  não chega ao fim, o texto de apoio usa `--cor-atencao`. O cartão inteiro é clicável (prop opcional `onClick` no
  `Destaque`; sem ela o componente fica como era), abre a aba Dinheiro e leva o foco à seção.
- "Repasses" virou "Desembolsos". As mensagens visíveis de `resumirRepasses` também deixaram de dizer "parcela"
  ("1 desembolso atrasado", "1 desembolso parcial", "todos recebidos"). Nomes internos (`repasses()`,
  `get_repasses_v2`) ficaram.
- Tabela da aba Dinheiro: coluna "Cabe até" só na linha de grupo que tem rubrica de bolsas; as outras com "—". A
  mesma informação aparece em "Rubricas deste grupo", na rubrica de bolsas.
- Seção "Até quando as bolsas cabem", abaixo da tabela: frase de resposta, os três chips "Contar:" com
  `aria-pressed`, o gráfico e os `details`. Os chips recalculam cartão, coluna, frase e gráfico juntos; o estado
  volta ao padrão ao trocar de centro.
- Aviso de desembolso atrasado: valor, data prevista, balancete em que não aparece e se está contado acima. Sem
  botão, porque não há pendência automática.
- `details` "Como a conta é feita": regras curtas, o `fora` e a fração de taxa usada (com os valores que a formam).
- Falha de `saldoLivre` ou de `repasses`: `AvisoFalha` com "Tentar de novo", cartão sem "Cabem até" e nenhuma data
  inventada. `sem_bolsas`, `sem_balancete`, `repoe_gasto` e `dado_incompleto` mostram o `motivo` no lugar do
  gráfico. Sem plano, a seção não aparece.

### Gráfico (`GraficoProjecao.jsx`/`.css`)

SVG em Preact, sem biblioteca nova: duas barras por mês (em conta depois da folha em `--grafico-1`, negativo em
`--cor-problema`; orçamento em `--grafico-2` com contorno de 1,5 px em `--grafico-1`), faixa
`--cor-problema-suave` no mês da falta, linha tracejada `--grafico-3` com "+ desembolso N (R$ X mil)", grade em
`--cor-borda` sem linhas de eixo, eixo compacto ("300 mil") e legenda em cima à esquerda em `--fs-1`. Rótulos de
meses vizinhos ficam em três faixas no topo para não se cruzarem. `role="img"` com `aria-label` e `details` "Ver mês
a mês em tabela" com os mesmos números. Em tela estreita o SVG rola dentro da própria caixa; a página não rola.

### Modo exemplo e catálogo

- `dadosExemplo.js`: os saldos fictícios ganharam `compromissos_inicio`, `saldo` nas rubricas e
  `compromisso_tipo` (`bolsas`/`taxa`). O Atlas (30.902) virou o caso que aperta e depende de um desembolso: caixa
  de 40.000 (o balancete de exemplo foi ajustado de 62.100 para 40.000), duas bolsas de 8.000/mês por 5 meses a
  partir de set/26, orçamento de 52.900, desembolso 2 atrasado desde 15/07/2026 e desembolso 3 futuro em 10/01/2027.
  O Cerrado (30.901) e o Corredor (30.907) caber até o fim; Veredas (30.904) segue sem balancete. Nenhum nome,
  código ou valor real entrou nos exemplos.
- Catálogo `#/componentes`: card "Projeção das bolsas" com dados fictícios e o cartão "Desembolsos".

## Testes

- `npx vitest run` (raiz): **685 passaram, 19 pulados**, 43 arquivos passaram e 1 foi pulado.
- `npm test --prefix app`: **215 passaram** em 24 arquivos.
- `npm run lint`: sem erro nem aviso.
- `npm run build --prefix app`: verde; guarda de estilo sem violação e verificação de build sem dado de exemplo.

Arquivos novos de teste:

- `app/tests/projecao.test.js` (16 testes): cenário obrigatório inteiro (números conferidos à mão), rendimento,
  atrasado, orçamento de 300.000, dia 07, data só de mês, folha que cai quando uma bolsa termina, `fora`, `sem_valor`,
  `nota_emitida`, `repoe_gasto`, `sem_balancete`, `sem_bolsas`, aviso de soma e rendimento nulo.
- `app/tests/projecao-tela.test.jsx` (9 testes): cartão com "Cabem até", coluna só na linha de bolsas, chip
  "Rendimento" mudando cartão e frase, falha de saldo e de desembolsos sem data, aviso de atrasado (contado e não
  contado), rótulo "Desembolsos", tabela do `details` com os números do gráfico, clique no cartão levando à seção
  com foco, painel "Rubricas deste grupo" e estado sem balancete com o motivo no lugar do gráfico.

### Mutantes (desfeitos)

1. Regra do dia 07: `dia <= 7` → `dia < 7`. **1 teste falhou** (o teste do dia 07 em `projecao.test.js`), 22
   passaram. Desfeito.
2. Rendimento somado em vez de tirado: `saldoConta - rendimento` → `saldoConta + rendimento`. **6 testes
   falharam**: 3 em `projecao.test.js` (cenário padrão, sem futuro e com atrasado) e 3 em
   `projecao-tela.test.jsx` (cartão/coluna, chip "Rendimento" e tabela do gráfico); 17 passaram. Desfeito.

### Conferência visual

Servidor `npm run dev:exemplo --prefix app` (porta 5191) e Chrome headless, com `Emulation.setDeviceMetricsOverride`
para medir 1400 e 390 px de verdade (o Chrome no Windows não aceita janela menor que ~500 px; a primeira captura em
390 era um recorte e foi refeita).

- **30.902 (Atlas, aperta e depende)**: cartão "Cabem até dez/26 · jan/27 depende do desembolso 3"; coluna "Cabe
  até" só em Pessoal; aviso do desembolso 2 atrasado; gráfico com a faixa da falta em jan/27 e a linha do desembolso
  3. Em 390 px, `document.documentElement.scrollWidth` = 375 (sem rolagem horizontal da página); o gráfico rola
  dentro da caixa.
- **30.901 (Cerrado, cabe até o fim)**: "Cabem até ago/27 · fim das bolsas cadastradas"; frase com o mês mais
  apertado e a sobra de 57.600; os dois desembolsos futuros aparecem em faixas diferentes, sem rótulos sobrepostos;
  o cabeçalho da seção diz "folha de até R$ 23.200" porque a folha cai quando a bolsa encerrada termina.
- **30.904 (Veredas, sem balancete)**: cartão e coluna com data só pelo orçamento; motivo no lugar do gráfico; sem
  dinheiro em conta inventado. Em 1400 px, `scrollWidth` = 1.385.
- **Catálogo `#/componentes`**: gráfico com dados fictícios, legenda, faixa, linha e tabela; cartão
  "Desembolsos".

A barra de abas rola horizontalmente no celular (comportamento previsto na estética para abas); a página não rola.

## Arquivos alterados

Novos: `app/src/servicos/projecao.js`, `app/src/componentes/GraficoProjecao.jsx`,
`app/src/componentes/GraficoProjecao.css`, `app/tests/projecao.test.js`, `app/tests/projecao-tela.test.jsx` e este
relatório.

Alterados: `Projeto.jsx`, `Projeto.css`, `Componentes.jsx`, `Destaque.jsx`, `Destaque.css`, `componentes/index.js`,
`dados.js`, `dadosExemplo.js`, `app/tests/projeto.test.jsx` e `frontend/js/planejamento-dinheiro.js` (só o
`export` de `vencimento`). Também `docs/redesenho/ESTADO.md` (exigência do `CLAUDE.md` de atualizar o estado no
mesmo commit) e o arquivo da tarefa, que estava fora do git.

## Desvios do plano da tarefa

- **Chart.js**: `estetica.md` cita Chart.js; o gráfico foi feito em SVG com Preact, como a própria tarefa pediu. Não
  entrou biblioteca nova.
- **`ESTADO.md`**: fora da lista "Arquivos", mas atualizado por exigência do `CLAUDE.md`; registrado aqui.
- **Teste existente**: a expectativa "1 parcela parcial" virou "1 desembolso parcial" em `projeto.test.jsx`, pela
  troca de vocabulário da tela (não era só o literal "Repasses").
- **Exemplos**: para o modo exemplo demonstrar os três casos, o caixa do Atlas e o saldo do balancete dele foram
  ajustados para 40.000 (antes 62.100) e o desembolso 3 passou de 15/01/2027 para 10/01/2027. Os demais centros
  ganharam os campos novos (`compromissos_inicio`, `saldo`, `compromisso_tipo`) sem mudar os valores que já
  existiam. Tudo fictício.
- **Defesas da conta** descritas acima (rubrica de bolsas ausente, desembolso antes do primeiro mês e limite do
  orçamento antes da folha).

## Em aberto

- Falta revisão e o "ok" do Victor para juntar/publicar; nada foi enviado (`sem push`), nada foi aplicado no banco e
  não há migração.
- A seção usa `id="projecao-titulo"`; se algum dia a página for embutida duas vezes, o id precisa ser único por
  instância.
- O gráfico tem 900 px fixos e rola no celular, como pedido. Se a tela passar a precisar de gráfico fluido, é uma
  decisão à parte.
- A conta depende de `compromisso_tipo` e `saldo` em `get_saldo_livre` (migração 066, já aplicada). Antes de uma
  produção sem a 066, ela devolve `dado_incompleto` em vez de inventar limite.
- No exemplo do Cerrado, a primeira folha inclui uma bolsa encerrada na janela (o cartão "Bolsas por mês" mostra só
  as vigentes); por isso o cabeçalho da seção diz "folha de até". É comportamento do dado fictício, não da
  produção.
