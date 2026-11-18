import { useEffect, useId, useRef } from 'preact/hooks';
import { empilharEsc } from '../util/pilhaEsc.js';
import './MenuSuspenso.css';

/**
 * Contêiner de divulgação (`aria-expanded` no gatilho, sem `role="menu"`).
 * Ao abrir, move o foco para o primeiro item interativo; Esc e clique fora fecham,
 * devolvendo o foco ao gatilho no fechamento por Esc.
 */
export function MenuSuspenso({
  aberto = false,
  aoFechar,
  ancoraRef = null,
  gatilhoRef = null,
  ariaLabel = 'Opções',
  alinhar = 'direita',
  children,
  className = '',
}) {
  const pilhaId = useId();
  const menuRef = useRef(null);
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;

  useEffect(() => {
    if (!aberto) return undefined;

    if (menuRef.current) {
      const primeiro = menuRef.current.querySelector('button:not([disabled]), a[href]');
      if (primeiro instanceof HTMLElement) {
        primeiro.focus();
      }
    }

    const desempilhar = empilharEsc(pilhaId, () => {
      aoFecharRef.current?.();
      const gatilho = gatilhoRef?.current || ancoraRef?.current?.querySelector('button[aria-expanded]');
      if (gatilho instanceof HTMLElement && gatilho.isConnected) {
        gatilho.focus();
      }
    });

    const aoClicarFora = (e) => {
      const dentroMenu = menuRef.current && menuRef.current.contains(e.target);
      const dentroAncora = ancoraRef?.current && ancoraRef.current.contains(e.target);
      if (!dentroMenu && !dentroAncora) {
        aoFecharRef.current?.();
      }
    };

    document.addEventListener('mousedown', aoClicarFora);
    return () => {
      desempilhar();
      document.removeEventListener('mousedown', aoClicarFora);
    };
  }, [aberto, pilhaId, ancoraRef, gatilhoRef]);

  if (!aberto) return null;

  return (
    <div
      ref={menuRef}
      class={`menu-suspenso menu-suspenso--${alinhar}${className ? ` ${className}` : ''}`}
      role="region"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export function MenuSuspensoItem({ icone: Icone = null, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      class={`menu-suspenso__item${className ? ` ${className}` : ''}`}
      onClick={onClick}
    >
      {Icone && <Icone size={16} strokeWidth={1.75} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

export function MenuSuspensoSeparador() {
  return <div class="menu-suspenso__separador" role="separator" />;
}
