/* ============================================================
   Prazo único da requisição (2ª rodada da revisão)
   ============================================================
   O POST /analise tem UM prazo absoluto, contado do começo do
   handler (antes da autenticação). Cada chamada usa o menor entre
   o próprio teto e o tempo que falta. Este arquivo é o único
   lugar que faz essa conta — auth, limite, RPC e modelo passam
   por aqui para não inventarem prazos paralelos.

   `corrida` não substitui o AbortSignal: ele garante que o laço
   não fica preso numa promessa que ignorou o aborto (uma chamada
   pendurada), devolvendo `{ erro: 'sinal' }`.
   ============================================================ */

export const PRAZO_PADRAO_MS = 120_000;

/** Milissegundos até o prazo; `Infinity` quando não há prazo. */
export function restanteMs(prazo, agora = Date.now) {
  if (prazo == null || !Number.isFinite(prazo)) return Number.POSITIVE_INFINITY;
  return Math.max(0, prazo - agora());
}

/** O menor entre o teto próprio da chamada e o tempo restante. */
export function timeoutEfetivo(prazo, tetoMs, agora = Date.now) {
  const restante = restanteMs(prazo, agora);
  if (tetoMs == null || !Number.isFinite(tetoMs)) return restante;
  return Math.max(0, Math.min(tetoMs, restante));
}

/**
 * AbortSignal que dispara no menor entre `tetoMs`, o prazo absoluto e a
 * desconexão do cliente (`sinal`). O chamador precisa rodar `limpar()` no
 * `finally`, senão o relógio fica armado à toa.
 */
export function sinalComPrazo({ sinal, prazo, tetoMs, agora = Date.now }) {
  const controle = new AbortController();
  const ms = timeoutEfetivo(prazo, tetoMs, agora);

  let relogio;
  if (Number.isFinite(ms)) {
    if (ms <= 0) controle.abort();
    else relogio = setTimeout(() => controle.abort(), ms);
  }

  const aoAbortar = () => controle.abort();
  if (sinal) {
    if (sinal.aborted) controle.abort();
    else sinal.addEventListener('abort', aoAbortar, { once: true });
  }

  return {
    signal: controle.signal,
    limpar() {
      if (relogio !== undefined) clearTimeout(relogio);
      if (sinal) sinal.removeEventListener('abort', aoAbortar);
    },
  };
}

/**
 * Espera uma promessa, mas desiste quando o sinal aborta. Nunca rejeita:
 * devolve `{ valor }`, `{ erro: 'sinal' }` ou `{ erro: 'falhou', causa }`.
 * É a rede de segurança para fetch/leitura que não honrou o AbortSignal.
 */
export function corrida(promessa, { sinal } = {}) {
  return new Promise((resolve) => {
    let terminou = false;
    const finalizar = (resultado) => {
      if (terminou) return;
      terminou = true;
      if (sinal) sinal.removeEventListener('abort', aoAbortar);
      resolve(resultado);
    };
    const aoAbortar = () => finalizar({ erro: 'sinal' });

    if (sinal) {
      if (sinal.aborted) {
        finalizar({ erro: 'sinal' });
        return;
      }
      sinal.addEventListener('abort', aoAbortar, { once: true });
    }

    Promise.resolve(promessa).then(
      (valor) => finalizar({ valor }),
      (causa) => finalizar({ erro: 'falhou', causa }),
    );
  });
}

/**
 * Quando o sinal combinado disparou, diz se foi desconexão do cliente
 * (`abortado`) ou prazo/teto (`tempo`). O sinal externo é o da requisição.
 */
export function motivoDoAborto({ sinal, agora = Date.now, prazo }) {
  if (sinal?.aborted) return 'abortado';
  if (prazo != null && Number.isFinite(prazo) && agora() >= prazo) return 'tempo';
  return 'tempo';
}
