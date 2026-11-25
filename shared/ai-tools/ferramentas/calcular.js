// calcular — a implementação mora em blocos.js; esta fachada existe para a
// ferramenta ter o mesmo formato das demais em `ferramentas/`.

export const nome = 'calcular';

export function executar(ctx, args) {
  return ctx.calcular(args);
}
