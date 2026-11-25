/* ============================================================
   SSE — formatação e entrega dos eventos (contrato §7)
   ============================================================
   O protocolo é o de sempre: `event: <nome>` seguido de `data:
   <json>` e uma linha em branco. `JSON.stringify` já escapa
   quebra de linha, então um texto do modelo com `\n` não parte
   o evento no meio — mas só se todo evento passar por aqui.

   2ª rodada: as escritas passam por uma fila. O watchdog do prazo
   pode emitir `erro`/`fim` enquanto o laço ainda está terminando
   um `passo`; sem a fila, os dois writes podiam intercalar.
   ============================================================ */

export const CABECALHOS_SSE = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
});

/** Um evento SSE completo. `dados` precisa ser serializável em JSON. */
export function formatarEvento(nome, dados) {
  return `event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`;
}

/**
 * Escreve eventos num `WritableStream`. Devolve `false` quando o cliente
 * desconectou (write rejeitou) — quem chama usa isso para parar o laço em vez
 * de continuar trabalhando para uma tela que não existe mais.
 *
 * A escrita é feita chunk a chunk: nada é bufferizado além do que o
 * TransformStream do Worker segura, e o primeiro evento sai antes da primeira
 * resposta do modelo.
 */
export function criarEmissor(writable) {
  const escritor = writable.getWriter();
  const codificador = new TextEncoder();
  let encerrado = false;
  let fila = Promise.resolve();

  function enfileirar(tarefa) {
    const resultado = fila.then(tarefa, tarefa);
    // A fila continua mesmo quando uma escrita falha; o resultado de cada
    // tarefa é devolvido a quem chamou.
    fila = resultado.catch(() => {});
    return resultado;
  }

  return {
    emitir(nome, dados) {
      return enfileirar(async () => {
        if (encerrado) return false;
        try {
          await escritor.write(codificador.encode(formatarEvento(nome, dados)));
          return true;
        } catch {
          // Cliente foi embora (ou o stream já foi fechado). Não há o que
          // registrar: o conteúdo do evento não vai para log nem em erro.
          encerrado = true;
          return false;
        }
      });
    },

    fechar() {
      return enfileirar(async () => {
        if (encerrado) return;
        encerrado = true;
        try {
          await escritor.close();
        } catch {
          // Já estava fechado do outro lado; nada a fazer.
        }
      });
    },

    get encerrado() {
      return encerrado;
    },
  };
}
