/* ============================================================
   Caminho recebido pela Edge Function
   ============================================================
   Dentro do Supabase a função recebe o caminho SEM
   `/functions/v1` e COM o nome da função:

     POST /functions/v1/analise        → /analise
     GET  /functions/v1/analise/saude  → /analise/saude

   O núcleo e o Worker continuam com as rotas de sempre
   (`/saude` e `/analise`). A entrada Deno normaliza antes de
   chamar `tratar`; o resto do caminho fica como está.

   Função pura para o teste não precisar subir Deno.
   ============================================================ */

const ALIASES = new Map([
  ['/analise', '/analise'],
  ['/functions/v1/analise', '/analise'],
  ['/analise/saude', '/saude'],
  ['/functions/v1/analise/saude', '/saude'],
]);

export function normalizarCaminhoEdge(pathname) {
  if (typeof pathname !== 'string') return pathname;
  return ALIASES.get(pathname) ?? pathname;
}
