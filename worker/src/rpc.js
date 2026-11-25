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
   ============================================================ */

function erroRede(nome, causa) {
  const detalhe = causa?.name === 'AbortError' ? 'demorou demais' : 'não chegou ao banco';
  return {
    data: null,
    error: {
      codigo: causa?.name === 'AbortError' ? 'tempo' : 'rede',
      mensagem: `A consulta ${nome} ${detalhe}.`,
      causa: causa?.message ?? null,
    },
  };
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

    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), timeoutMs);

    let resposta;
    try {
      resposta = await fetchImpl(`${base}/rest/v1/rpc/${encodeURIComponent(nome)}`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(args ?? {}),
        signal: controle.signal,
      });
    } catch (e) {
      clearTimeout(relogio);
      return erroRede(nome, e);
    }

    let texto = '';
    try {
      texto = await resposta.text();
    } catch {
      texto = '';
    } finally {
      // O relógio cobre também a leitura do corpo: uma resposta que entrega
      // cabeçalho e trava no meio não pode segurar o laço.
      clearTimeout(relogio);
    }

    let corpo = null;
    if (texto) {
      try {
        corpo = JSON.parse(texto);
      } catch {
        corpo = null;
      }
    }

    if (!resposta.ok) {
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

    if (texto && corpo === null) {
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
  };
}
