// criar_bloco — a implementação mora em blocos.js; esta fachada existe para
// a ferramenta ter o mesmo formato das demais em `ferramentas/`.

export const nome = 'criar_bloco';

export function executar(ctx, args) {
  return ctx.criarBloco(args);
}
