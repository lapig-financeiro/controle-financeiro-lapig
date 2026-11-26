import { describe, expect, it, vi } from 'vitest';

// O cliente falso usa `this`: antes da correção, `enviarFeedback` tirava o
// método do objeto e a chamada perdia o `this` (o defeito que os 16 testes
// do serviço não pegavam porque sempre injetavam `rpc`).
vi.mock('../src/servicos/supabase.js', () => {
  const cliente = {
    base: 'cliente-falso',
    async rpc(nome, args) {
      if (!this || this.base !== 'cliente-falso') {
        throw new Error('o método rpc perdeu o this');
      }
      return { data: `uuid:${nome}:${args.p_registro_id}`, error: null };
    },
  };
  return {
    SUPABASE_URL: 'https://exemplo.supabase.co',
    SUPABASE_KEY: 'chave-publica',
    supabase: cliente,
  };
});

import { enviarFeedback } from '../src/servicos/analise.js';

describe('enviarFeedback — cliente com this', () => {
  it('chama supabase.rpc como método do cliente e devolve o id', async () => {
    const resultado = await enviarFeedback('reg-1', { nota: 1 });

    expect(resultado).toEqual({
      id: 'uuid:analise_feedback_enviar:reg-1',
      erro: null,
    });
  });

  it('não descola métodos do cliente quando há comentário', async () => {
    const resultado = await enviarFeedback('reg-2', {
      nota: -1,
      comentario: 'faltou o final',
    });

    expect(resultado.erro).toBeNull();
    expect(resultado.id).toContain('reg-2');
  });
});
