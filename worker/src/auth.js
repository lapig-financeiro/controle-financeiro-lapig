/* ============================================================
   Autenticação e papel (contrato §7)
   ============================================================
   O `user_id` vem SEMPRE de `GET /auth/v1/user`, nunca do corpo
   da requisição. O papel vem de `app_users`, lido com o mesmo
   JWT — exatamente como o app faz. O Worker não tem
   `service_role`: se o RLS não deixasse a pessoa ler o próprio
   papel, o Worker também não leria.

   Distinção deliberada entre "esse login não vale" (`sem_login`),
   "esse login não pode usar a Análise" (`sem_permissao`), "a
   infraestrutura não respondeu" (`interno`), "demorou" (`tempo`)
   e "o cliente desconectou" (`abortado`).

   2ª rodada: o prazo único do POST e o AbortSignal da desconexão
   chegam ao fetch E à leitura do corpo. Corpo de 200 vazio ou
   interrompido não vira `sem_login`; é `interno` (ou `tempo` se
   o relógio venceu).
   ============================================================ */

import { corrida, motivoDoAborto, sinalComPrazo } from './prazo.js';

export const PAPEIS_PADRAO = Object.freeze(['admin']);

/** `Authorization: Bearer <jwt>` → jwt. Qualquer outra coisa → null. */
export function extrairJwt(cabecalho) {
  if (typeof cabecalho !== 'string') return null;
  const achado = /^Bearer\s+(.+)$/i.exec(cabecalho.trim());
  if (!achado) return null;
  const jwt = achado[1].trim();
  return jwt || null;
}

/** `ANALISE_PAPEIS` é lista separada por vírgula; vazia cai no padrão. */
export function papeisPermitidos(bruto, padrao = PAPEIS_PADRAO) {
  if (typeof bruto !== 'string' || !bruto.trim()) return padrao.slice();
  const lista = bruto.split(',').map((p) => p.trim()).filter(Boolean);
  return lista.length ? lista : padrao.slice();
}

function semLogin() {
  return {
    ok: false,
    codigo: 'sem_login',
    mensagem: 'Faça login para usar a Análise.',
  };
}

function semPermissao(papel) {
  return {
    ok: false,
    codigo: 'sem_permissao',
    papel: papel ?? null,
    mensagem: 'A Análise está restrita a administradores.',
  };
}

function interno(mensagem) {
  return { ok: false, codigo: 'interno', mensagem };
}

/** Corpo que não vai ser lido é cancelado; não segura a conexão até o fim. */
function cancelarCorpo(resposta) {
  try {
    void resposta.body?.cancel?.().catch?.(() => {});
  } catch {
    // Corpo já consumido ou sem suporte a cancelamento: nada a liberar.
  }
}

function falhaDoPedido(erro) {
  if (erro === 'abortado') {
    return { ok: false, codigo: 'abortado', mensagem: 'A requisição foi cancelada.' };
  }
  if (erro === 'tempo') {
    return {
      ok: false,
      codigo: 'tempo',
      mensagem: 'A validação do login demorou demais. Tente de novo.',
    };
  }
  return interno('Não foi possível validar o login agora.');
}

/**
 * Um GET que devolve JSON, com o prazo e a desconexão valendo do começo ao fim
 * da leitura do corpo.
 *
 * @returns {Promise<{dados?: unknown, semLogin?: true, semPermissao?: true,
 *                    erro?: 'abortado'|'tempo'|'interno'}>}
 */
async function pedirJson({ url, cabecalhos, fetchImpl, prazo, sinal, timeoutMs, agora }) {
  const combo = sinalComPrazo({ sinal, prazo, tetoMs: timeoutMs, agora });

  try {
    const chamada = await corrida(
      Promise.resolve().then(() =>
        fetchImpl(url, { method: 'GET', headers: cabecalhos, signal: combo.signal }),
      ),
      { sinal: combo.signal },
    );

    if (chamada.erro === 'sinal') {
      return { erro: motivoDoAborto({ sinal, prazo, agora }) };
    }
    if (chamada.erro) {
      if (combo.signal.aborted || chamada.causa?.name === 'AbortError') {
        return { erro: motivoDoAborto({ sinal, prazo, agora }) };
      }
      return { erro: 'interno' };
    }

    const resposta = chamada.valor;
    // 401 é "não está logado"; 403 é "está, mas não pode". Quem chama decide se
    // o 403 vira `sem_login` (validação do JWT) ou `sem_permissao` (app_users).
    if (resposta.status === 401) {
      cancelarCorpo(resposta);
      return { semLogin: true };
    }
    if (resposta.status === 403) {
      cancelarCorpo(resposta);
      return { semPermissao: true };
    }
    if (!resposta.ok) {
      cancelarCorpo(resposta);
      return { erro: 'interno' };
    }

    const leitura = await corrida(
      Promise.resolve().then(() => resposta.text()),
      { sinal: combo.signal },
    );
    if (leitura.erro === 'sinal') {
      return { erro: motivoDoAborto({ sinal, prazo, agora }) };
    }
    if (leitura.erro) {
      if (combo.signal.aborted || leitura.causa?.name === 'AbortError') {
        return { erro: motivoDoAborto({ sinal, prazo, agora }) };
      }
      return { erro: 'interno' };
    }

    const texto = leitura.valor;
    if (typeof texto !== 'string' || !texto.trim()) return { erro: 'interno' };

    try {
      return { dados: JSON.parse(texto) };
    } catch {
      return { erro: 'interno' };
    }
  } finally {
    combo.limpar();
  }
}

/**
 * Valida o JWT e o papel.
 *
 * @returns {Promise<{ok: true, usuario: {id: string, email: string|null}, papel: string}
 *                  | {ok: false, codigo: 'sem_login'|'sem_permissao'|'interno'|'tempo'|'abortado',
 *                     mensagem: string}>}
 */
export async function autenticar({
  jwt,
  supabaseUrl,
  anonKey,
  papeis = PAPEIS_PADRAO,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  prazo,
  sinal,
  agora = Date.now,
}) {
  if (!jwt) return semLogin();

  const base = String(supabaseUrl || '').replace(/\/+$/, '');
  if (!base || !anonKey) {
    return interno('O Worker está sem a configuração do Supabase.');
  }

  const cabecalhos = {
    apikey: anonKey,
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/json',
  };

  const usuario = await pedirJson({
    url: `${base}/auth/v1/user`,
    cabecalhos,
    fetchImpl,
    prazo,
    sinal,
    timeoutMs,
    agora,
  });

  // Em `/auth/v1/user`, 401 e 403 querem dizer a mesma coisa: esse login não vale.
  if (usuario.semLogin || usuario.semPermissao) return semLogin();
  if (usuario.erro) return falhaDoPedido(usuario.erro);
  if (!usuario.dados || typeof usuario.dados.id !== 'string' || !usuario.dados.id) {
    return interno('A validação do login devolveu uma resposta inválida.');
  }

  const respostaPapel = await pedirJson({
    url: `${base}/rest/v1/app_users?select=role&user_id=eq.${encodeURIComponent(usuario.dados.id)}`,
    cabecalhos,
    fetchImpl,
    prazo,
    sinal,
    timeoutMs,
    agora,
  });

  if (respostaPapel.semLogin) return semLogin();
  // 403 ao ler o próprio papel é RLS/guard: o login vale, a permissão não.
  if (respostaPapel.semPermissao) return semPermissao(null);
  if (respostaPapel.erro) {
    if (respostaPapel.erro === 'abortado') return falhaDoPedido('abortado');
    if (respostaPapel.erro === 'tempo') {
      return {
        ok: false,
        codigo: 'tempo',
        mensagem: 'A leitura do seu papel demorou demais. Tente de novo.',
      };
    }
    return interno('Não foi possível ler o seu papel agora.');
  }

  const linhas = respostaPapel.dados;
  const papel = Array.isArray(linhas) ? linhas[0]?.role : linhas?.role;
  if (typeof papel !== 'string' || !papel) return semPermissao(null);

  if (!papeis.includes(papel)) return semPermissao(papel);

  return {
    ok: true,
    usuario: {
      id: usuario.dados.id,
      email: typeof usuario.dados.email === 'string' ? usuario.dados.email : null,
    },
    papel,
  };
}
