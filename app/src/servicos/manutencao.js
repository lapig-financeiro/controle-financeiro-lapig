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
 * Falha de rede ou arquivo ausente nunca bloqueia o site.
 */
export async function consultarManutencao(fetchImpl = globalThis.fetch, baseUrl = import.meta.env.BASE_URL) {
  if (typeof fetchImpl !== 'function') {
    return { ativo: false, mensagem: '' };
  }
  try {
    const url = `${caminhoManutencao(baseUrl)}?t=${Date.now()}`;
    const resposta = await fetchImpl(url, { cache: 'no-store' });
    if (!resposta.ok) return { ativo: false, mensagem: '' };
    const json = await resposta.json();
    return interpretarManutencao(json);
  } catch {
    return { ativo: false, mensagem: '' };
  }
}
