/* ============================================================
   SSE — formatação e entrega dos eventos (contrato §7)
   ============================================================
   O protocolo é o de sempre: `event: <nome>` seguido de `data:
   <json>` e uma linha em branco. `JSON.stringify` já escapa
   quebra de linha, então um texto do modelo com `\n` não parte
   o evento no meio — mas só se todo evento passar por aqui.

   3ª rodada: a fila é explícita e cancelável. Quando o encerrador
   começa, ele descarta o que ainda não foi escrito e não é
   `erro`/`fim`, escreve no máximo um `erro` e sempre um `fim`, e
   fecha. Se a escrita estiver bloqueada (cliente que não lê), o
   `encerrar` corre contra um limite e chama `writer.abort()`
   quando vence; o encerramento não fica preso.
   ============================================================ */

export const CABECALHOS_SSE = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
});

/** Um evento SSE completo. `dados` precisa ser serializável em JSON. */
export function formatarEvento(nome, dados) {
  return `event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`;
}

function abortarEscritor(escritor, readable) {
  try {
    const promessa = escritor.abort();
    if (promessa && typeof promessa.catch === 'function') promessa.catch(() => {});
  } catch {
    // O stream já estava fechado/errado; não há o que fazer.
  }

  // `writer.abort()` pode ficar na fila atrás de um write pendurado (é o que
  // acontece no runtime do Node). Cancelar o lado legível libera o transform e
  // rejeita o write; no Worker, é o caminho para o cliente que parou de ler.
  if (readable && typeof readable.cancel === 'function') {
    try {
      const promessa = readable.cancel();
      if (promessa && typeof promessa.catch === 'function') promessa.catch(() => {});
    } catch {
      // O lado legível já estava travado/cancelado pelo runtime.
    }
  }
}

export function criarEmissor(writable, readable) {
  const escritor = writable.getWriter();
  const codificador = new TextEncoder();

  // aberto → encerrando → fechado. Em `encerrando`, só itens terminais
  // (`erro`/`fim`) passam; em `fechado`, nada mais é escrito.
  let estado = 'aberto';
  const fila = [];
  let bombeando = false;
  let finalizadoResolvido = false;
  let resolverFinalizado;
  const finalizado = new Promise((resolve) => {
    resolverFinalizado = resolve;
  });

  function finalizar() {
    if (finalizadoResolvido) return;
    finalizadoResolvido = true;
    resolverFinalizado();
  }

  function resolverFila(valor) {
    while (fila.length) fila.shift().resolver(valor);
  }

  async function bombear() {
    if (bombeando) return;
    bombeando = true;

    try {
      while (fila.length) {
        const item = fila.shift();
        if (item.cancelado) {
          item.resolver(false);
          continue;
        }
        if (estado !== 'aberto' && !item.terminal) {
          item.resolver(false);
          continue;
        }

        try {
          await escritor.write(codificador.encode(formatarEvento(item.nome, item.dados)));
          item.resolver(true);
        } catch {
          estado = 'fechado';
          item.resolver(false);
          resolverFila(false);
          finalizar();
          return;
        }
      }

      if (estado === 'encerrando') {
        estado = 'fechado';
        try {
          await escritor.close();
        } catch {
          // Já estava fechado do outro lado.
        }
        finalizar();
      }
    } finally {
      bombeando = false;
      if (fila.length && estado !== 'fechado') void bombear();
    }
  }

  function enfileirar(nome, dados, terminal) {
    return new Promise((resolve) => {
      fila.push({ nome, dados, terminal, cancelado: false, resolver: resolve });
      void bombear();
    });
  }

  return {
    /** Evento comum. Depois do encerramento, devolve `false` sem escrever. */
    emitir(nome, dados) {
      if (estado !== 'aberto') return Promise.resolve(false);
      return enfileirar(nome, dados, false);
    },

    /**
     * Encerramento único: descarta os eventos comuns ainda na fila, escreve no
     * máximo um `erro` e sempre um `fim`, e fecha. `limite` é um timestamp
     * absoluto; se a escrita não terminar até ele, aborta o escritor.
     */
    encerrar({ erro, fim, limite, agora = Date.now } = {}) {
      if (estado !== 'aberto') return finalizado;

      estado = 'encerrando';
      for (const item of fila) {
        if (!item.terminal) item.cancelado = true;
      }

      if (erro) enfileirar('erro', erro, true);
      enfileirar('fim', fim, true);

      const ms = Math.max(0, (limite ?? agora() + 1_000) - agora());
      return new Promise((resolve) => {
        let terminou = false;
        const acabar = () => {
          if (terminou) return;
          terminou = true;
          clearTimeout(relogio);
          resolve();
        };
        const relogio = setTimeout(() => {
          if (terminou) return;
          terminou = true;
          estado = 'fechado';
          resolverFila(false);
          abortarEscritor(escritor, readable);
          finalizar();
          resolve();
        }, ms);

        finalizado.then(acabar, acabar);
      });
    },

    /** Desconexão: não escreve mais nada e aborta o stream. */
    abortar() {
      if (estado === 'fechado') return finalizado;
      estado = 'fechado';
      resolverFila(false);
      abortarEscritor(escritor, readable);
      finalizar();
      return finalizado;
    },

    /** Fecha sem eventos terminais. Usado só pelos testes do formatador. */
    fechar() {
      if (estado !== 'aberto') return finalizado;
      estado = 'encerrando';
      void bombear();
      return finalizado;
    },

    /** Resolve quando o stream fechou ou foi abortado. */
    aguardar() {
      return finalizado;
    },

    get encerrado() {
      return estado === 'fechado';
    },
  };
}
