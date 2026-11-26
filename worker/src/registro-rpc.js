/* ============================================================
   Registro da Análise por RPC (migração 074)
   ============================================================
   A pergunta e o que a pessoa viu ficam na tabela
   `analise_registro`, atrás de RLS, escritos pelas RPCs
   `analise_registro_iniciar` e `analise_registro_concluir` com o
   JWT de quem perguntou. Nada disso vai para log: o registro mora
   no banco, nunca no console da Edge Function nem do Worker.

   Este cliente é best-effort de propósito. O registro não é
   barreira de segurança nem de resposta: qualquer falha (rede,
   HTTP != 200, prazo, JSON inválido) vira `{ id: null }` no
   `iniciar` e `{ ok: false }` no `concluir`; nunca lança e nunca
   loga.

   `p_resposta` e `p_passos` são cortados em 240 KB (o check da
   074 aceita 256 KB) com `{ truncado: true }`, para o fechamento
   nunca ser recusado por tamanho. A marca é posta no próprio JSON:
   nos passos, um item final; na resposta, a chave de topo.
   ============================================================ */

import { corrida, sinalComPrazo } from './prazo.js';

/**
 * Folga sobre o teto de 256 KB da 074 (`octet_length(jsonb::text)`): o
 * Postgres adiciona espaço após `:` e `,` ao serializar `jsonb`, expandindo
 * payloads densos em até ~25%; 192 KB compactos garantem ficar abaixo de 256 KB.
 */
export const TETO_JSON_BYTES = 192 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESFECHOS = new Set([
  'ok',
  'erro',
  'incompleta',
  'tempo',
  'limite',
  'desconectado',
]);

/** O corpo de erro de uma RPC nunca é lido; cancelar libera a conexão. */
function cancelarCorpo(resposta) {
  try {
    void resposta.body?.cancel?.().catch?.(() => {});
  } catch {
    // Corpo já consumido ou sem suporte a cancelamento: nada a liberar.
  }
}

/** Bytes UTF-8 do JSON; `Infinity` quando nem serializa (nunca deveria). */
function bytesDe(valor) {
  let texto;
  try {
    texto = JSON.stringify(valor);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  if (typeof texto !== 'string') return Number.POSITIVE_INFINITY;
  try {
    return new TextEncoder().encode(texto).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function cabe(valor, teto) {
  return bytesDe(valor) <= teto;
}

/** Mantém o maior prefixo da lista que cabe, com um item de marca no fim. */
function truncarLista(lista, teto) {
  const marca = { truncado: true };
  for (let quantidade = lista.length - 1; quantidade >= 0; quantidade -= 1) {
    const candidato = [...lista.slice(0, quantidade), marca];
    if (cabe(candidato, teto)) return candidato;
  }
  return [marca];
}

/**
 * Corta a resposta preservando o texto e o maior número de blocos que
 * couber. Se nem o texto couber, ele entra truncado e sem os intervalos
 * de `semOrigem` (que deixariam de apontar para o texto gravado).
 */
function truncarResposta(resposta, teto) {
  const texto = resposta.texto ?? null;
  const blocos = Array.isArray(resposta.blocos) ? resposta.blocos : [];
  const marca = { truncado: true };

  for (let quantidade = blocos.length; quantidade >= 0; quantidade -= 1) {
    const candidato = {
      texto,
      blocos: blocos.slice(0, quantidade),
      truncado: true,
    };
    if (quantidade < blocos.length) candidato.blocos.push(marca);
    if (cabe(candidato, teto)) return candidato;
  }

  if (texto && typeof texto === 'object' && typeof texto.texto === 'string') {
    let prefixo = texto.texto.slice(0, Math.min(texto.texto.length, Math.floor(teto / 2)));
    while (
      prefixo.length > 0 &&
      !cabe({ texto: { texto: prefixo, semOrigem: [] }, blocos: [], truncado: true }, teto)
    ) {
      prefixo = prefixo.slice(0, Math.floor(prefixo.length * 0.8));
    }
    return { texto: { texto: prefixo, semOrigem: [] }, blocos: [], truncado: true };
  }

  return { texto: null, blocos: [], truncado: true };
}

function ajustarResposta(resposta, teto) {
  if (resposta === null || resposta === undefined) return null;
  if (!resposta || typeof resposta !== 'object' || Array.isArray(resposta)) {
    return { truncado: true };
  }
  return cabe(resposta, teto) ? resposta : truncarResposta(resposta, teto);
}

function ajustarPassos(passos, teto) {
  if (!Array.isArray(passos)) return [];
  return cabe(passos, teto) ? passos : truncarLista(passos, teto);
}

function inteiroOuNulo(valor) {
  return Number.isInteger(valor) && valor >= 0 ? valor : null;
}

/**
 * Cria o cliente do registro.
 *
 * @param {object} opcoes
 * @param {string} opcoes.supabaseUrl
 * @param {string} opcoes.anonKey
 * @param {Function} [opcoes.fetchImpl]
 * @param {number} [opcoes.timeoutMs]
 * @param {Function} [opcoes.agora]
 * @returns {{iniciar: Function, concluir: Function}}
 */
export function criarRegistradorRpc({
  supabaseUrl,
  anonKey,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  agora = Date.now,
} = {}) {
  const base = String(supabaseUrl || '').replace(/\/+$/, '');

  /**
   * POST numa RPC com o JWT da pessoa. Devolve `{ ok, texto? }`; qualquer
   * falha é `{ ok: false }`. O corpo de erro é cancelado sem ser lido.
   */
  async function chamarRpc(nome, corpo, { jwt, prazo, sinal } = {}) {
    if (!base || !anonKey || !jwt) return { ok: false };

    const combo = sinalComPrazo({ sinal, prazo, tetoMs: timeoutMs, agora });

    try {
      const chamada = await corrida(
        Promise.resolve().then(() =>
          fetchImpl(`${base}/rest/v1/rpc/${encodeURIComponent(nome)}`, {
            method: 'POST',
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${jwt}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(corpo ?? {}),
            signal: combo.signal,
          }),
        ),
        { sinal: combo.signal },
      );

      if (chamada.erro) return { ok: false };

      const resposta = chamada.valor;
      if (!resposta.ok) {
        cancelarCorpo(resposta);
        return { ok: false, status: resposta.status };
      }

      const leitura = await corrida(
        Promise.resolve().then(() => resposta.text()),
        { sinal: combo.signal },
      );
      if (leitura.erro) return { ok: false };
      return {
        ok: true,
        texto: typeof leitura.valor === 'string' ? leitura.valor : '',
      };
    } catch {
      return { ok: false };
    } finally {
      combo.limpar();
    }
  }

  return {
    /**
     * Abre o registro da pergunta. Devolve `{ id }` (uuid) ou `{ id: null }`.
     */
    async iniciar({ jwt, pergunta, anteriores, modelo, prazo, sinal } = {}) {
      try {
        const resposta = await chamarRpc(
          'analise_registro_iniciar',
          {
            p_pergunta: pergunta,
            p_anteriores: inteiroOuNulo(anteriores) ?? 0,
            p_modelo: typeof modelo === 'string' ? modelo : null,
          },
          { jwt, prazo, sinal },
        );
        if (!resposta.ok || typeof resposta.texto !== 'string') return { id: null };

        let dados;
        try {
          dados = JSON.parse(resposta.texto);
        } catch {
          return { id: null };
        }
        return typeof dados === 'string' && UUID.test(dados)
          ? { id: dados }
          : { id: null };
      } catch {
        return { id: null };
      }
    },

    /**
     * Fecha o registro uma única vez. Qualquer falha é silenciosa.
     */
    async concluir({
      jwt,
      id,
      resposta,
      passos,
      rodadas,
      ms,
      chamadas,
      desfecho,
      codigoErro,
      prazo,
      sinal,
    } = {}) {
      try {
        if (typeof id !== 'string' || !UUID.test(id) || !jwt || !base || !anonKey) {
          return { ok: false };
        }

        const corpo = {
          p_id: id,
          p_resposta: ajustarResposta(resposta, TETO_JSON_BYTES),
          p_passos: ajustarPassos(passos, TETO_JSON_BYTES),
          p_rodadas: inteiroOuNulo(rodadas),
          p_ms: inteiroOuNulo(ms),
          p_chamadas: inteiroOuNulo(chamadas),
          p_desfecho: DESFECHOS.has(desfecho) ? desfecho : 'erro',
          p_codigo_erro:
            typeof codigoErro === 'string' && codigoErro
              ? codigoErro.slice(0, 64)
              : null,
        };

        const fechado = await chamarRpc('analise_registro_concluir', corpo, {
          jwt,
          prazo,
          sinal,
        });
        return { ok: fechado.ok === true };
      } catch {
        return { ok: false };
      }
    },
  };
}
