/* ============================================================
   Entrada do bundle da Edge Function (`analise`)
   ============================================================
   O esbuild empacota este arquivo num único ESM em
   `supabase/functions/analise/`, porque o deploy do Supabase só
   enxerga o que está dentro de `supabase/functions/`. A entrada
   Deno (`index.ts`) importa `tratar`, `criarContadorRpc` e
   `tetoDoAmbiente` do arquivo gerado.
   ============================================================ */

export { tratar } from './nucleo.js';
export { criarContadorRpc } from './contador-rpc.js';
export { tetoDoAmbiente } from './limite.js';
export { normalizarCaminhoEdge } from './edge-caminho.js';
