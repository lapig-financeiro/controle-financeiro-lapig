/* ============================================================
   Encerrador — dono único do fim do SSE (3ª/4ª rodadas)
   ============================================================
   Laço, watchdog, desconexão e exceção chamam `encerrar`. Um
   encerramento normal só vale na primeira chamada: as outras
   recebem a mesma promessa. O encerrador decide o `fim` (rodadas
   e ms), manda o emissor descartar o que ainda não foi escrito,
   escreve no máximo um `erro`, sempre um `fim`, e fecha.

   A desconexão é especial: processa mesmo com um encerramento já
   em curso. Ela aborta o sinal interno e a escrita na hora, para
   o `waitUntil` não esperar o limite de uma escrita bloqueada.

   A escrita terminal corre contra `prazo + 1 s`. No limite, o
   emissor chama `writer.abort(motivo)` sem await e libera a
   promessa, mesmo que o leitor não leia.
   ============================================================ */

import { criarEmissor } from './sse.js';

export function criarEncerrador({
  writable,
  estado,
  inicio,
  prazo,
  abortar,
  agora = Date.now,
}) {
  const emissor = criarEmissor(writable);
  let fase = 'aberto'; // aberto | encerrando | fechado
  let promessa = null;

  function marcarFechado() {
    fase = 'fechado';
  }

  async function encerrar({ erro, desconectado = false } = {}) {
    // Desconexão não espera a vez de um encerramento normal: se o `fim` está
    // bloqueado, aborta a escrita agora e libera o `waitUntil`.
    if (desconectado) {
      if (typeof abortar === 'function') abortar();
      if (fase === 'fechado') return promessa ?? false;

      fase = 'fechado';
      promessa = emissor.abortar().then(() => false);
      return promessa;
    }

    if (fase !== 'aberto') return promessa ?? false;

    // A guarda é síncrona: quem chegar depois desta linha não entra.
    fase = 'encerrando';
    // Num sucesso não há fetch pendente para cancelar; abortar aqui mataria
    // uma RPC que o teste (ou um uso futuro) ainda fosse chamar. Em erro, o
    // aborto é parte do encerramento.
    if (typeof abortar === 'function' && erro) abortar();

    const fim = { rodadas: estado?.rodadas ?? 0, ms: agora() - inicio };
    // O terminal pode esperar o cliente voltar a ler até o prazo + 1 s; depois
    // disso, o emissor aborta o escritor em vez de segurar o Worker.
    const limite = prazo + 1_000;
    promessa = emissor
      .encerrar({ erro, fim, limite, agora })
      .then(() => {
        marcarFechado();
        return true;
      });
    return promessa;
  }

  return {
    get fase() {
      return fase;
    },

    get aberto() {
      return fase === 'aberto';
    },

    async emitir(nome, dados) {
      if (fase !== 'aberto') return false;
      const ok = await emissor.emitir(nome, dados);
      // Escrita falhou (cliente foi embora). O encerrador assume a partir daqui.
      if (!ok && fase === 'aberto') void encerrar({ desconectado: true });
      return ok;
    },

    encerrar,

    /** Resolve quando o stream fechou ou foi abortado. */
    aguardar() {
      return promessa ?? Promise.resolve(false);
    },

    abortar() {
      if (fase === 'fechado') return promessa ?? Promise.resolve(false);
      fase = 'fechado';
      promessa = emissor.abortar().then(() => false);
      return promessa;
    },
  };
}
