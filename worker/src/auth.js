/* ============================================================
   Autenticação e papel (contrato §7)
   ============================================================
   O `user_id` vem SEMPRE de `GET /auth/v1/user`, nunca do corpo
   da requisição. O papel vem de `app_users`, lido com o mesmo
   JWT — exatamente como o app faz. O Worker não tem
   `service_role`: se o RLS não deixasse a pessoa ler o próprio
   papel, o Worker também não leria.

   Distinção deliberada entre "esse login não vale" (`sem_login`),
   "esse login não pode usar a Análise" (`sem_permissao`) e "a
   infraestrutura não respondeu" (`interno`). Trocar os três por
   uma mensagem só faria o admin caçar problema no lugar errado.
   ============================================================ */

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

async function buscar(fetchImpl, url, init, timeoutMs) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controle.signal });
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Valida o JWT e o papel.
 *
 * @returns {Promise<{ok: true, usuario: {id: string, email: string|null}, papel: string}
 *                  | {ok: false, codigo: 'sem_login'|'sem_permissao'|'interno'|'tempo',
 *                     mensagem: string}>}
 */
export async function autenticar({
  jwt,
  supabaseUrl,
  anonKey,
  papeis = PAPEIS_PADRAO,
  fetchImpl = fetch,
  timeoutMs = 10_000,
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

  let resposta;
  try {
    resposta = await buscar(
      fetchImpl,
      `${base}/auth/v1/user`,
      { method: 'GET', headers: cabecalhos },
      timeoutMs,
    );
  } catch (e) {
    return e?.name === 'AbortError'
      ? { ok: false, codigo: 'tempo', mensagem: 'A validação do login demorou demais. Tente de novo.' }
      : interno('Não foi possível validar o login agora.');
  }

  if (resposta.status === 401 || resposta.status === 403) return semLogin();
  if (!resposta.ok) return interno('Não foi possível validar o login agora.');

  let usuario;
  try {
    usuario = await resposta.json();
  } catch {
    return semLogin();
  }
  if (!usuario || typeof usuario.id !== 'string' || !usuario.id) return semLogin();

  let respostaPapel;
  try {
    respostaPapel = await buscar(
      fetchImpl,
      `${base}/rest/v1/app_users?select=role&user_id=eq.${encodeURIComponent(usuario.id)}`,
      { method: 'GET', headers: cabecalhos },
      timeoutMs,
    );
  } catch (e) {
    return e?.name === 'AbortError'
      ? { ok: false, codigo: 'tempo', mensagem: 'A leitura do seu papel demorou demais. Tente de novo.' }
      : interno('Não foi possível ler o seu papel agora.');
  }

  if (!respostaPapel.ok) return interno('Não foi possível ler o seu papel agora.');

  let linhas;
  try {
    linhas = await respostaPapel.json();
  } catch {
    return interno('Não foi possível ler o seu papel agora.');
  }

  const papel = Array.isArray(linhas) ? linhas[0]?.role : linhas?.role;
  if (typeof papel !== 'string' || !papel) return semPermissao(null);

  if (!papeis.includes(papel)) return semPermissao(papel);

  return {
    ok: true,
    usuario: {
      id: usuario.id,
      email: typeof usuario.email === 'string' ? usuario.email : null,
    },
    papel,
  };
}
