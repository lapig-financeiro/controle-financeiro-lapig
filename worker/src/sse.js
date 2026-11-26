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

/** Comentário de sinal de vida; a tela ignora, proxies e o navegador não. */
export const COMENTARIO_PING = ': ping\n\n';

/** Primeiro ping 15 s depois de abrir; depois, um a cada 15 s. */
export const INTERVALO_PING_MS = 15_000;

/** Um evento SSE completo. `dados` precisa ser serializável em JSON. */
export function formatarEvento(nome, dados) {
  return `event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`;
}

function abortarEscritor(escritor, motivo) {
  try {
    // Sem await: um write pendurado pode segurar a promessa do abort, e o
    // encerramento não pode depender dela. A rejeição é tratada aqui.
    const promessa = escritor.abort(motivo);
    if (promessa && typeof promessa.catch === 'function') promessa.catch(() => {});
  } catch {
    // O stream já estava fechado/errado; não há o que fazer.
  }
}

/**
 * @param {WritableStream} writable
 * @param {{aoDesconectar?: Function}} [opcoes] `aoDesconectar` roda quando uma
 *   escrita (evento ou ping) falha; o encerrador usa para abortar o laço como
 *   numa desconexão do cliente.
 */
export function criarEmissor(writable, { aoDesconectar } = {}) {
  const escritor = writable.getWriter();
  const codificador = new TextEncoder();

  // aberto → encerrando → fechado. Em `encerrando`, só itens terminais
  // (`erro`/`fim`) passam; em `fechado`, nada mais é escrito.
  let estado = 'aberto';
  const fila = [];
  let bombeando = false;
  let finalizadoResolvido = false;
  let resolverFinalizado;
  let relogioPing = null;
  const finalizado = new Promise((resolve) => {
    resolverFinalizado = resolve;
  });

  function finalizar() {
    if (finalizadoResolvido) return;
    finalizadoResolvido = true;
    resolverFinalizado();
  }

  function pararPing() {
    if (relogioPing !== null) {
      clearInterval(relogioPing);
      relogioPing = null;
    }
  }

  function avisarDesconexao() {
    if (typeof aoDesconectar !== 'function') return;
    try {
      aoDesconectar();
    } catch {
      // O encerrador é quem decide; uma exceção aqui não pode derrubar o
      // emissor. A falha de escrita já fechou o stream.
    }
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
          const bytes = item.comentario
            ? codificador.encode(item.comentario)
            : codificador.encode(formatarEvento(item.nome, item.dados));
          await escritor.write(bytes);
          item.resolver(true);
        } catch {
          // Falha de escrita é desconexão, venha de um evento ou do ping.
          pararPing();
          estado = 'fechado';
          item.resolver(false);
          resolverFila(false);
          finalizar();
          avisarDesconexao();
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

  function enfileirarComentario(comentario) {
    return new Promise((resolve) => {
      fila.push({ comentario, terminal: false, cancelado: false, resolver: resolve });
      void bombear();
    });
  }

  // Sinal de vida: a partir de 15 s, um comentário a cada 15 s enquanto o
  // stream está aberto. Para em qualquer encerramento; um ping já na fila é
  // cancelado junto com os outros eventos comuns, então nunca sai depois do
  // `fim`. `unref` (Node) evita segurar o processo nos testes.
  relogioPing = setInterval(() => {
    if (estado !== 'aberto') {
      pararPing();
      return;
    }
    void enfileirarComentario(COMENTARIO_PING);
  }, INTERVALO_PING_MS);
  if (relogioPing && typeof relogioPing.unref === 'function') relogioPing.unref();

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
      pararPing();
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
          abortarEscritor(escritor, 'prazo da análise');
          finalizar();
          resolve();
        }, ms);

        finalizado.then(acabar, acabar);
      });
    },

    /** Desconexão: não escreve mais nada e aborta o stream. */
    abortar() {
      pararPing();
      if (estado === 'fechado') return finalizado;
      estado = 'fechado';
      resolverFila(false);
      abortarEscritor(escritor, 'cliente desconectou');
      finalizar();
      return finalizado;
    },

    /** Fecha sem eventos terminais. Usado só pelos testes do formatador. */
    fechar() {
      pararPing();
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
