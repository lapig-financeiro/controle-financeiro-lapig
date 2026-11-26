/* ============================================================
   Limite diário por login (contrato §7)
   ============================================================
   KV `ANALISE_USO`, chave `uso:<user_id>:<AAAA-MM-DD>` no fuso de
   Brasília, 50 por dia, expira em 48 h. A pergunta é contada
   quando começa, não quando termina: uma análise que estoura o
   teto de tempo também gastou modelo.

   O get/put não é atômico: duas requisições simultâneas podem
   ler o mesmo contador e gravar o mesmo +1. Isso é aceitável para
   um freio de fatura (a decisão do Victor foi 50/dia por login).
   A leitura do KV ainda pode vir de cache de outra região por até
   ~60 s (o KV é eventualmente consistente); com um único admin,
   isso pode deixar passar algumas perguntas acima de 50.

   2ª rodada: o prazo único e a desconexão também valem aqui. O KV
   não aceita AbortSignal; por isso a chamada é corrida contra o
   relógio, para o laço não ficar preso numa promessa pendurada.
   ============================================================ */

import { corrida, motivoDoAborto, sinalComPrazo } from './prazo.js';

export const TETO_PADRAO = 50;
export const TTL_SEGUNDOS = 48 * 60 * 60;

// Brasília não tem horário de verão desde 2019: UTC-3 o ano inteiro. A conta é
// feita sobre o instante UTC deslocado, não sobre o fuso do runtime (que no
// Worker é UTC e no PC de quem testa pode ser qualquer um).
const DESLOCAMENTO_BRASILIA_MS = -3 * 60 * 60 * 1000;

/** Data `AAAA-MM-DD` do instante no fuso de Brasília. */
export function diaBrasilia(agora = Date.now()) {
  return new Date(agora + DESLOCAMENTO_BRASILIA_MS).toISOString().slice(0, 10);
}

export function chaveUso(userId, dia) {
  return `uso:${userId}:${dia}`;
}

/** `ANALISE_LIMITE_DIA` inválida ou ausente cai no padrão de 50. */
export function tetoDoAmbiente(bruto, padrao = TETO_PADRAO) {
  const n = Number.parseInt(bruto, 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

async function comKv(promessa, { sinal, prazo, tetoMs, agora }) {
  const combo = sinalComPrazo({ sinal, prazo, tetoMs, agora });
  try {
    const resultado = await corrida(promessa, { sinal: combo.signal });
    if (resultado.erro === 'sinal') {
      return { erro: motivoDoAborto({ sinal, prazo, agora }) };
    }
    if (resultado.erro) return { erro: 'interno', causa: resultado.causa };
    return { valor: resultado.valor };
  } finally {
    combo.limpar();
  }
}

function falhaKv(codigo) {
  return {
    permitido: false,
    codigo,
    mensagem:
      codigo === 'tempo'
        ? 'A contagem de uso demorou demais. Tente de novo em instantes.'
        : codigo === 'abortado'
          ? 'A requisição foi cancelada.'
          : 'Não foi possível contar o uso agora. Tente de novo em instantes.',
  };
}

/**
 * Contador do Worker, no formato que o núcleo pede:
 * `consumir({ userId, jwt, prazo, sinal })`. O `jwt` é ignorado aqui — o KV
 * usa só o `user_id` que veio do `/auth/v1/user`.
 */
export function criarContadorKv({ kv, teto = TETO_PADRAO, agora = Date.now } = {}) {
  return {
    consumir({ userId, prazo, sinal }) {
      return consumir({ kv, userId, teto, agora, prazo, sinal });
    },
  };
}

/**
 * Conta uma pergunta. Não lança: falha de KV volta como `permitido: false`
 * com código `interno` — na dúvida, não gasta o modelo. Devolver "pode" para
 * uma contagem que não foi gravada seria a falha virando zero, ao contrário.
 *
 * @returns {Promise<{permitido: boolean, usado?: number, teto: number, dia: string,
 *                    codigo?: 'limite'|'interno'|'tempo'|'abortado', mensagem?: string}>}
 */
export async function consumir({
  kv,
  userId,
  teto = TETO_PADRAO,
  agora = Date.now,
  prazo,
  sinal,
  timeoutMs = 10_000,
}) {
  // Aceita instante (como os testes antigos passavam) ou relógio injetável.
  const relogio = typeof agora === 'function' ? agora : () => agora;
  const dia = diaBrasilia(relogio());
  const chave = chaveUso(userId, dia);

  const leitura = await comKv(Promise.resolve().then(() => kv.get(chave)), {
    sinal,
    prazo,
    tetoMs: timeoutMs,
    agora: relogio,
  });
  if (leitura.erro) return { ...falhaKv(leitura.erro), teto, dia };

  const lido = Number.parseInt(leitura.valor ?? '0', 10);
  const usado = Number.isFinite(lido) && lido >= 0 ? lido : 0;

  if (usado >= teto) {
    return {
      permitido: false,
      codigo: 'limite',
      usado,
      teto,
      dia,
      mensagem: `Você chegou ao limite de ${teto} perguntas por dia. Volte amanhã.`,
    };
  }

  const escrita = await comKv(
    Promise.resolve().then(() =>
      kv.put(chave, String(usado + 1), { expirationTtl: TTL_SEGUNDOS }),
    ),
    {
      sinal,
      prazo,
      tetoMs: timeoutMs,
      agora: relogio,
    },
  );
  if (escrita.erro) return { ...falhaKv(escrita.erro), teto, dia };

  return { permitido: true, usado: usado + 1, teto, dia };
}
