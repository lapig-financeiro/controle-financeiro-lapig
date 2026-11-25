/* ============================================================
   Limite diário por login (contrato §7)
   ============================================================
   KV `ANALISE_USO`, chave `uso:<user_id>:<AAAA-MM-DD>` no fuso de
   Brasília, 50 por dia, expira em 48 h. A pergunta é contada
   quando começa, não quando termina: uma análise que estoura o
   teto de tempo também gastou modelo.

   O KV é eventualmente consistente e o get/put não é atômico:
   duas requisições simultâneas podem ler o mesmo contador e
   gravar o mesmo +1. Isso é aceitável para um freio de fatura
   (a decisão do Victor foi 50/dia por login), e está no relatório.
   ============================================================ */

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

/**
 * Conta uma pergunta. Não lança: falha de KV volta como `permitido: false`
 * com código `interno` — na dúvida, não gasta o modelo. Devolver "pode" para
 * uma contagem que não foi gravada seria a falha virando zero, ao contrário.
 *
 * @returns {Promise<{permitido: boolean, usado?: number, teto: number, dia: string,
 *                    codigo?: 'limite'|'interno', mensagem?: string}>}
 */
export async function consumir({ kv, userId, teto = TETO_PADRAO, agora = Date.now() }) {
  const dia = diaBrasilia(agora);
  const chave = chaveUso(userId, dia);

  let bruto;
  try {
    bruto = await kv.get(chave);
  } catch {
    return {
      permitido: false,
      codigo: 'interno',
      teto,
      dia,
      mensagem: 'Não foi possível contar o uso agora. Tente de novo em instantes.',
    };
  }

  const lido = Number.parseInt(bruto ?? '0', 10);
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

  try {
    await kv.put(chave, String(usado + 1), { expirationTtl: TTL_SEGUNDOS });
  } catch {
    return {
      permitido: false,
      codigo: 'interno',
      teto,
      dia,
      mensagem: 'Não foi possível contar o uso agora. Tente de novo em instantes.',
    };
  }

  return { permitido: true, usado: usado + 1, teto, dia };
}
