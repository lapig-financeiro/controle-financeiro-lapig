# shared/ai-tools

Pacote de ferramentas da **Análise** (F5). É a única ponte entre as RPCs
`*_v2` do Supabase e o modelo: o modelo nunca escreve número, ele cita ids de
nós que as ferramentas registram. O Worker importa este pacote; a tela recebe os
blocos já com a origem no formato "De onde vem".

Contrato: [`docs/redesenho/analise-contrato.md`](../../docs/redesenho/analise-contrato.md).

## Como usar

```js
import { criarSessao, INSTRUCOES, especificacoes } from './shared/ai-tools/index.js';

const sessao = criarSessao({
  // O Worker injeta o fetch com o JWT da pessoa; testes injetam um falso.
  rpc: async (nome, args) => ({ data, error }),
  hoje: '2026-11-25',
});

especificacoes();                    // tools no formato /api/chat do Ollama
await sessao.executar('listar_centros', {});
// → { id: 'r1', paraModelo: '...' } ou { id: 'r1', erro: '...' }

sessao.criarBloco({ tipo: 'numero', titulo: 'Livre do 30.901', no: 'r1.4' });
sessao.calcular({ op: 'soma', ids: ['r1.4', 'r2.2'] });
sessao.marcarTexto('O livre é R$ 84.300,00.');
sessao.reidratar(bloco);             // ⟦P1⟧ → nome, só no bloco da tela
```

## Ferramentas

`listar_centros`, `explicar_livre`, `situacao_centro`, `desembolsos`,
`termos_contrato`, `pendencias`, `bolsas`, `criar_bloco` e `calcular`.

- **Só leitura.** Nenhuma ferramenta escreve no banco e nenhuma calcula regra
  de negócio: livre, taxa, folha e projeção continuam nas RPCs.
- **Falha nunca vira zero.** Erro de RPC, exceção ou formato inesperado voltam
  como `{ id, erro }`; nunca `0`, `[]` ou "sem dado".
- **Dados pessoais.** Nome de bolsista vira `⟦Pn⟧`; CPF (com ou sem pontuação)
  e e-mail saem de todo texto. O mapa vive só na memória da sessão e só
  `reidratar` o usa, nos blocos que vão à tela.
- **Origem.** Cada valor numérico leva a melhor origem que a RPC oferece
  (`no`, `livre`, `ref`, `termo`, `calculo` ou `sem_documento`).

## O que não faz

- Não chama `fetch`, não lê arquivo, não importa `node:` e não tem dependência:
  roda no Worker da Cloudflare e no Node.
- Não guarda sessão em disco, KV ou log. O estado (resultados, nós, máscara)
  morre com a requisição.
- Não decide se um número é "correto": lê a RPC e registra. Regra financeira no
  pacote é defeito.
