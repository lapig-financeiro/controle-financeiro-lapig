function decodificarSeguro(trecho) {
  try {
    return decodeURIComponent(trecho);
  } catch {
    return trecho;
  }
}

/**
 * Interpreta a rota atual a partir do hash (`#/projetos`, `#/projetos/:id`,
 * `#/analise`, `#/admin`, `#/componentes`).
 */
export function parsearRota(hash = typeof window !== 'undefined' ? window.location.hash : '') {
  const limpo = String(hash || '').replace(/^#/, '');
  const caminho = limpo.startsWith('/') ? limpo : '/projetos';
  const partes = caminho.split('/').filter(Boolean);

  if (partes.length === 0 || partes[0] === 'projetos') {
    if (partes[1]) {
      return { pagina: 'projeto', menu: 'projetos', id: decodificarSeguro(partes[1]) };
    }
    return { pagina: 'projetos', menu: 'projetos', id: null };
  }

  if (partes[0] === 'analise') {
    return { pagina: 'analise', menu: 'analise', id: null };
  }

  if (partes[0] === 'admin') {
    return { pagina: 'admin', menu: 'admin', id: null };
  }

  if (partes[0] === 'componentes') {
    return { pagina: 'componentes', menu: 'componentes', id: null };
  }

  return { pagina: 'projetos', menu: 'projetos', id: null };
}

export function navegarPara(hash) {
  if (typeof window === 'undefined') return;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}
