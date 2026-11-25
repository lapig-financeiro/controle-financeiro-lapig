/* ============================================================
   RPC com o JWT da pessoa (contrato §7)
   ============================================================
   `POST <SUPABASE_URL>/rest/v1/rpc/<nome>`. O header `apikey` é a
   chave pública (a mesma do frontend) e o `Authorization` é o
   JWT de quem perguntou — nunca `service_role`, nunca a chave
   anônima no lugar do login. Quem decide o que a pessoa enxerga
   é o RLS e os guards das RPCs, como no site.

   Falha de RPC não lança: devolve `{ data: null, error }` para o
   laço mandar o erro ao modelo. Lançar aqui derrubaria a análise
   inteira por causa de uma consulta que o modelo poderia
   contornar com um filtro menor.

   2ª rodada: o prazo único e a desconexão valem para o fetch e
   para a leitura do corpo. 200 vazio é `resposta_invalida`; 200
   interrompido é `rede`; timeout é `tempo`; desconexão é
   `abortado`. Nunca `{ data: null, error: null }`.
   ============================================================ */

import { corrida, motivoDoAborto, sinalComPrazo } from './prazo.js';

function erroSinal(nome, codigo) {
  return {
    data: null,
    error: {
      codigo,
      mensagem:
        codigo === 'abortado'
          ? `A consulta ${nome} foi cancelada.`
          : `A consulta ${nome} demorou demais.`,
    },
  };
}

function erroLeitura(nome, causa, { abortado, status } = {}) {
  const error = {
    codigo: abortado ? 'abortado' : causa?.name === 'AbortError' ? 'tempo' : 'rede',
    mensagem:
      causa?.name === 'AbortError'
        ? `A consulta ${nome} foi interrompida.`
        : `A consulta ${nome} não chegou ao banco.`,
    causa: causa?.message ?? null,
  };
  if (status !== undefined) error.status = status;
  return { data: null, error };
}

/**
 * Cria o `rpc(nome, args)` amarrado a um JWT. O `fetch` é injetável para os
 * testes; em produção é o global do Worker.
 *
 * @returns {(nome: string, args?: object) => Promise<{data: unknown, error: null}
 *          | {data: null, error: {codigo: string, mensagem: string, status?: number}}>}
 */
export function criarRpc({
  supabaseUrl,
  anonKey,
  jwt,
  fetchImpl = fetch,
  timeoutMs = 30_000,
  prazo,
  sinal,
  agora = Date.now,
}) {
  const base = String(supabaseUrl || '').replace(/\/+$/, '');

  return async function rpc(nome, args = {}) {
    if (!base) {
      return {
        data: null,
        error: { codigo: 'interno', mensagem: 'SUPABASE_URL não está configurada no Worker.' },
      };
    }
    if (!jwt) {
      return {
        data: null,
        error: { codigo: 'sem_login', mensagem: 'A sessão não tem login.' },
      };
    }

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
            body: JSON.stringify(args ?? {}),
            signal: combo.signal,
          }),
        ),
        { sinal: combo.signal },
      );

      if (chamada.erro === 'sinal') {
        return erroSinal(nome, motivoDoAborto({ sinal, prazo, agora }));
      }
      if (chamada.erro) {
        if (combo.signal.aborted || chamada.causa?.name === 'AbortError') {
          return erroSinal(nome, motivoDoAborto({ sinal, prazo, agora }));
        }
        return erroLeitura(nome, chamada.causa);
      }

      const resposta = chamada.valor;

      // A leitura do corpo fica dentro do mesmo sinal: stream interrompido não
      // pode virar `{ data: null, error: null }` nem escapar do prazo.
      const leitura = await corrida(
        Promise.resolve().then(() => resposta.text()),
        { sinal: combo.signal },
      );
      if (leitura.erro === 'sinal') {
        return erroSinal(nome, motivoDoAborto({ sinal, prazo, agora }));
      }
      if (leitura.erro) {
        if (combo.signal.aborted || leitura.causa?.name === 'AbortError') {
          return erroSinal(nome, motivoDoAborto({ sinal, prazo, agora }));
        }
        return erroLeitura(nome, leitura.causa, { status: resposta.status });
      }

      const texto = leitura.valor;

      if (!resposta.ok) {
        let corpo = null;
        if (texto) {
          try {
            corpo = JSON.parse(texto);
          } catch {
            corpo = null;
          }
        }
        const bruto = corpo && (corpo.message || corpo.error_description || corpo.error);
        return {
          data: null,
          error: {
            codigo: (corpo && corpo.code) || `http_${resposta.status}`,
            mensagem: typeof bruto === 'string' && bruto
              ? bruto
              : `A consulta ${nome} falhou (HTTP ${resposta.status}).`,
            status: resposta.status,
          },
        };
      }

      if (typeof texto !== 'string' || texto.length === 0) {
        return {
          data: null,
          error: {
            codigo: 'resposta_invalida',
            mensagem: `A consulta ${nome} devolveu corpo vazio.`,
            status: resposta.status,
          },
        };
      }

      let corpo;
      try {
        corpo = JSON.parse(texto);
      } catch {
        return {
          data: null,
          error: {
            codigo: 'resposta_invalida',
            mensagem: `A consulta ${nome} devolveu uma resposta que não é JSON.`,
            status: resposta.status,
          },
        };
      }

      return { data: corpo, error: null };
    } finally {
      combo.limpar();
    }
  };
}
