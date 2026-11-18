const ABAS_PROJETO = new Set(['dinheiro', 'bolsas', 'documentos', 'pendencias']);

function decodificarSeguro(trecho) {
  try {
    return decodeURIComponent(trecho);
  } catch {
    return trecho;
  }
}

/**
 * Interpreta a rota atual a partir do hash (`#/projetos`, `#/projeto/:id`,
 * `#/projeto/:id/:aba`, `#/projetos/:id`, `#/analise`, `#/admin`, `#/componentes`).
 */
export function parsearRota(hash = typeof window !== 'undefined' ? window.location.hash : '') {
  const limpo = String(hash || '').replace(/^#/, '');
  const caminho = limpo.startsWith('/') ? limpo : '/projetos';
  const partes = caminho.split('/').filter(Boolean);

  if (partes.length === 0 || partes[0] === 'projetos' || partes[0] === 'projeto') {
    if (partes[1]) {
      const abaBruta = partes[2] ? decodificarSeguro(partes[2]).toLowerCase() : null;
      const aba = abaBruta && ABAS_PROJETO.has(abaBruta) ? abaBruta : null;
      return {
        pagina: 'projeto',
        menu: 'projetos',
        id: decodificarSeguro(partes[1]),
        aba,
      };
    }
    return { pagina: 'projetos', menu: 'projetos', id: null, aba: null };
  }

  if (partes[0] === 'analise') {
    return { pagina: 'analise', menu: 'analise', id: null, aba: null };
  }

  if (partes[0] === 'admin') {
    return { pagina: 'admin', menu: 'admin', id: null, aba: null };
  }

  if (partes[0] === 'componentes') {
    return { pagina: 'componentes', menu: 'componentes', id: null, aba: null };
  }

  return { pagina: 'projetos', menu: 'projetos', id: null, aba: null };
}

export function urlProjeto(id, aba = null) {
  if (!id) return '#/projetos';
  const base = `#/projeto/${encodeURIComponent(id)}`;
  if (aba && ABAS_PROJETO.has(aba)) {
    return `${base}/${aba}`;
  }
  return base;
}

export function navegarPara(hash) {
  if (typeof window === 'undefined') return;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}
