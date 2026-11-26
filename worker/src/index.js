/* ============================================================
   Entrada do Worker (Cloudflare) — contrato §7
   ============================================================
   Só monta as peças do runtime e entrega ao núcleo:
     - contador diário no KV `ANALISE_USO` (o de sempre);
     - `ctx.waitUntil` para segurar a promessa do laço.

   Toda a regra (rotas, CORS, prazo, tetos, SSE, encerrador) vive
   em `nucleo.js`, que também roda na Edge Function do Supabase.
   ============================================================ */

import { tratar } from './nucleo.js';
import { criarContadorKv, tetoDoAmbiente } from './limite.js';

export { origemPermitida } from './nucleo.js';

export default {
  async fetch(request, env, ctx) {
    const contador = env.ANALISE_USO
      ? criarContadorKv({
          kv: env.ANALISE_USO,
          teto: tetoDoAmbiente(env.ANALISE_LIMITE_DIA),
        })
      : null;

    const waitUntil =
      ctx && typeof ctx.waitUntil === 'function'
        ? (promessa) => ctx.waitUntil(promessa)
        : undefined;

    return tratar(request, env, { contador, waitUntil });
  },
};
