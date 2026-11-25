/* ============================================================
   Encerrador — dono único do fim do SSE (3ª rodada)
   ============================================================
   Laço, watchdog, desconexão e exceção chamam `encerrar`. Só a
   primeira chamada vale: as outras recebem a mesma promessa. O
   encerrador decide o `fim` (rodadas e ms), manda o emissor
   descartar o que ainda não foi escrito, escreve no máximo um
   `erro`, sempre um `fim`, e fecha.

   Na desconexão do cliente, nada mais é escrito: aborta o stream.
   A escrita terminal corre contra `prazo + 1 s`; se o cliente não
   lê, o emissor aborta o escritor em vez de segurar o Worker.
   ============================================================ */

import { criarEmissor } from './sse.js';

export function criarEncerrador({
  writable,
  readable,
  estado,
  inicio,
  prazo,
  abortar,
  agora = Date.now,
}) {
  const emissor = criarEmissor(writable, readable);
  let fase = 'aberto'; // aberto | encerrando | fechado
  let promessa = null;

  function marcarFechado() {
    fase = 'fechado';
  }

  async function encerrar({ erro, desconectado = false } = {}) {
    if (fase !== 'aberto') return promessa ?? false;

    // A guarda é síncrona: quem chegar depois desta linha não entra.
    fase = 'encerrando';
    // Num sucesso não há fetch pendente para cancelar; abortar aqui mataria
    // uma RPC que o teste (ou um uso futuro) ainda fosse chamar. Em erro,
    // watchdog ou desconexão, o aborto é parte do encerramento.
    if (typeof abortar === 'function' && (erro || desconectado)) abortar();

    if (desconectado) {
      promessa = emissor.abortar().then(() => {
        marcarFechado();
        return false;
      });
      return promessa;
    }

    const fim = { rodadas: estado?.rodadas ?? 0, ms: agora() - inicio };
    // O terminal pode esperar o cliente voltar a ler até o prazo + 1 s; depois
    // disso, aborta o escritor em vez de segurar o Worker.
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
