export const MENSAGEM_PADRAO =
  'O Buriti está em atualização. Volte em alguns minutos — não é preciso fazer nada.';

export function caminhoManutencao(baseUrl = import.meta.env.BASE_URL || '/') {
  const origem = typeof window !== 'undefined' ? window.location.origin : 'https://localhost';
  return new URL('../manutencao.json', `${origem}${baseUrl}`).pathname;
}

/**
 * Interpreta o JSON de `manutencao.json`. Só `"ativo": true` bloqueia o uso.
 */
export function interpretarManutencao(json) {
  if (!json || json.ativo !== true) {
    return { ativo: false, mensagem: '' };
  }
  const msg =
    typeof json.mensagem === 'string' && json.mensagem.trim()
      ? json.mensagem.trim().slice(0, 500)
      : MENSAGEM_PADRAO;
  return { ativo: true, mensagem: msg };
}

/**
 * Lê `../manutencao.json` relativo a `import.meta.env.BASE_URL` sem cache.
 * Distingue uma liberação confirmada de uma consulta que falhou.
 */
export async function consultarManutencao(fetchImpl = globalThis.fetch, baseUrl = import.meta.env.BASE_URL) {
  const falha = { ativo: false, mensagem: '', falhou: true };
  if (typeof fetchImpl !== 'function') return falha;

  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), 5000);
  try {
    const url = `${caminhoManutencao(baseUrl)}?t=${Date.now()}`;
    const resposta = await fetchImpl(url, { cache: 'no-store', signal: controle.signal });
    if (!resposta.ok) return falha;
    const json = await resposta.json();
    if (typeof json?.ativo !== 'boolean') return falha;
    return interpretarManutencao(json);
  } catch {
    return falha;
  } finally {
    clearTimeout(prazo);
  }
}
