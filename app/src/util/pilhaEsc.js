const pilha = [];
let ouvinteAtivo = false;

function aoTeclarEsc(e) {
  if (e.key !== 'Escape' || pilha.length === 0) return;
  const topo = pilha[pilha.length - 1];
  e.preventDefault();
  topo.onEsc?.();
}

function atualizarOuvinte() {
  if (typeof document === 'undefined') return;
  if (pilha.length > 0 && !ouvinteAtivo) {
    document.addEventListener('keydown', aoTeclarEsc);
    ouvinteAtivo = true;
  } else if (pilha.length === 0 && ouvinteAtivo) {
    document.removeEventListener('keydown', aoTeclarEsc);
    ouvinteAtivo = false;
  }
}

/**
 * Registra uma camada sobreposta na pilha global de `Esc`.
 * Apenas o item do topo recebe o fechamento por `Escape`.
 *
 * @param {string} id
 * @param {() => void} onEsc
 * @returns {() => void}
 */
export function empilharEsc(id, onEsc) {
  const entrada = { id, onEsc };
  pilha.push(entrada);
  atualizarOuvinte();

  return () => {
    const idx = pilha.lastIndexOf(entrada);
    if (idx !== -1) {
      pilha.splice(idx, 1);
      atualizarOuvinte();
    }
  };
}

export function estaNoTopoEsc(id) {
  return pilha.length > 0 && pilha[pilha.length - 1].id === id;
}

export function tamanhoPilhaEsc() {
  return pilha.length;
}
