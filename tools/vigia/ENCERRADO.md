# Vigia encerrado em 19/11/2026

Por pedido do Victor. O Vigia **não roda mais**:

- o código publicado em 18/11 era um stub que apagava os próprios acionadores (`checar` e
  `resumoDiario`) na primeira execução e marcava as rotinas como pausadas no Painel de rotinas;
- `publicar.js` recusa publicar enquanto este arquivo existir, para ninguém religar sem querer.

O que fica de propósito:

- este código, como **registro histórico** — inclusive os testes e a especificação em
  `docs/buriti-tarefas.md`;
- as tabelas `vigia_*` e o histórico já gravado no Supabase (nada foi apagado);
- o login de automação no Supabase, que **falta desativar** (ver abaixo).

## Falta fazer (fora do repositório)

Um admin no Supabase roda:

```sql
select public.set_automacao('<uuid do login>', 'vigia', false);
```

Isso desliga só as RPCs `vigia_*`. **Não troque a senha**: o mesmo login serve ao Buriti operador
(tarefas), que continua funcionando porque usa `is_automacao(null)`, não o registro `vigia`.

## Se algum dia for religar

Não é recomendado sem rever o desenho: a triagem contínua não se pagou (fila `esclarecer` crescendo,
máscara falhando, equipe não registrando progresso nas tarefas). Se ainda assim for:

1. apague este arquivo (ou rode `node tools/vigia/publicar.js --reviver`);
2. conserte o login que falhava (`login_http_*`) e rode `testarConfiguracao` e `checar`;
3. rode `instalarGatilhos`;
4. **tire o `avisarFalha()` de `apps-script/main.js`** — o painel de rotinas já avisa `FALHOU` e
   `ATRASADA`; o e-mail do Vigia duplicava o mesmo incidente.
