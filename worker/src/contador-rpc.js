/* ============================================================
   Contador diário por RPC (Edge Function do Supabase)
   ============================================================
   A Edge Function não tem KV: o contador mora na tabela
   `analise_uso` (migração 071) e é consumido pela RPC
   `analise_consumir()`, chamada com o JWT de quem perguntou.

   A RPC SEMPRE incrementa e devolve `{ dia, usadas }` do dia de
   hoje no fuso de Brasília. Quem compara com o teto é este
   arquivo: `usadas > teto` recusa a pergunta. Chamar a RPC por
   fora só gasta a cota de quem chamou, nunca aumenta o teto.

   Falha de RPC nunca vira "permitido": devolve o mesmo formato de
   `limite.js` com `permitido: false` e a mensagem genérica de
   hoje. Na dúvida, não gasta o modelo.
   ============================================================ */

import { TETO_PADRAO } from './limite.js';
import { corrida, motivoDoAborto, sinalComPrazo } from './prazo.js';

const MENSAGEM_FALHA = 'Não foi possível contar o uso agora. Tente de novo em instantes.';
const MENSAGEM_TEMPO = 'A contagem de uso demorou demais. Tente de novo em instantes.';
const MENSAGEM_ABORTADO = 'A requisição foi cancelada.';

const DIA_VALIDO = /^\d{4}-\d{2}-\d{2}$/;

function falha(codigo, teto, mensagem) {
  return {
    permitido: false,
    codigo,
    teto,
    mensagem:
      codigo === 'tempo'
        ? MENSAGEM_TEMPO
        : codigo === 'abortado'
          ? MENSAGEM_ABORTADO
          : mensagem ?? MENSAGEM_FALHA,
  };
}

/**
 * Cria o contador da Edge Function.
 *
 * @param {object} opcoes
 * @param {string} opcoes.supabaseUrl
 * @param {string} opcoes.anonKey
 * @param {number} [opcoes.teto]       perguntas por login por dia
 * @param {Function} [opcoes.fetchImpl]
 * @param {number} [opcoes.timeoutMs]
 * @param {Function} [opcoes.agora]
 * @returns {{consumir: (args: {jwt: string, prazo?: number, sinal?: AbortSignal}) =>
 *            Promise<{permitido: boolean, usado?: number, teto: number, dia?: string,
 *                      codigo?: string, mensagem?: string}>}}
 */
export function criarContadorRpc({
  supabaseUrl,
  anonKey,
  teto = TETO_PADRAO,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  agora = Date.now,
} = {}) {
  const base = String(supabaseUrl || '').replace(/\/+$/, '');
  const limite = Number.isFinite(teto) && teto > 0 ? teto : TETO_PADRAO;

  return {
    async consumir({ jwt, prazo, sinal } = {}) {
      if (!base || !anonKey || !jwt) return falha('interno', limite);

      const combo = sinalComPrazo({ sinal, prazo, tetoMs: timeoutMs, agora });

      try {
        const chamada = await corrida(
          Promise.resolve().then(() =>
            fetchImpl(`${base}/rest/v1/rpc/analise_consumir`, {
              method: 'POST',
              headers: {
                apikey: anonKey,
                Authorization: `Bearer ${jwt}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: '{}',
              signal: combo.signal,
            }),
          ),
          { sinal: combo.signal },
        );

        if (chamada.erro === 'sinal') {
          return falha(motivoDoAborto({ sinal, prazo, agora }), limite);
        }
        if (chamada.erro) {
          if (combo.signal.aborted || chamada.causa?.name === 'AbortError') {
            return falha(motivoDoAborto({ sinal, prazo, agora }), limite);
          }
          return falha('interno', limite);
        }

        const resposta = chamada.valor;
        if (!resposta.ok) {
          // O corpo do erro não é lido; cancelar libera a conexão já.
          try {
            void resposta.body?.cancel?.().catch?.(() => {});
          } catch {
            // Corpo já consumido ou sem suporte a cancelamento.
          }
          return falha('interno', limite);
        }

        const leitura = await corrida(
          Promise.resolve().then(() => resposta.text()),
          { sinal: combo.signal },
        );
        if (leitura.erro === 'sinal') {
          return falha(motivoDoAborto({ sinal, prazo, agora }), limite);
        }
        if (leitura.erro) {
          if (combo.signal.aborted || leitura.causa?.name === 'AbortError') {
            return falha(motivoDoAborto({ sinal, prazo, agora }), limite);
          }
          return falha('interno', limite);
        }

        const texto = leitura.valor;
        if (typeof texto !== 'string' || !texto.trim()) return falha('interno', limite);

        let dados;
        try {
          dados = JSON.parse(texto);
        } catch {
          return falha('interno', limite);
        }

        const usadas = dados && typeof dados === 'object' ? dados.usadas : null;
        const dia = dados && typeof dados === 'object' ? dados.dia : null;
        if (
          !Number.isInteger(usadas) ||
          usadas < 1 ||
          typeof dia !== 'string' ||
          !DIA_VALIDO.test(dia)
        ) {
          return falha('interno', limite);
        }

        if (usadas > limite) {
          return {
            permitido: false,
            codigo: 'limite',
            usado: usadas,
            teto: limite,
            dia,
            mensagem: `Você chegou ao limite de ${limite} perguntas por dia. Volte amanhã.`,
          };
        }

        return { permitido: true, usado: usadas, teto: limite, dia };
      } finally {
        combo.limpar();
      }
    },
  };
}
