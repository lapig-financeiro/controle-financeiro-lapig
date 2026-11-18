import { useEffect, useId, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import { empilharEsc, estaNoTopoEsc } from '../util/pilhaEsc.js';
import './PainelLateral.css';

const SELETOR_FOCAVEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Painel lateral direito (`--largura-painel`, 100% no celular).
 * Fecha com Esc (via pilha global) ou clique no véu e prende o foco dentro enquanto aberto.
 */
export function PainelLateral({
  aberto = false,
  aoFechar,
  titulo = '',
  subtitulo = '',
  children,
}) {
  const tituloId = useId();
  const pilhaId = useId();
  const painelRef = useRef(null);
  const focoAnteriorRef = useRef(null);
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;

  useEffect(() => {
    if (!aberto) return undefined;

    focoAnteriorRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const painel = painelRef.current;
    if (painel) {
      const focaveis = painel.querySelectorAll(SELETOR_FOCAVEL);
      if (focaveis.length > 0) {
        focaveis[0].focus();
      } else {
        painel.focus();
      }
    }

    const desempilhar = empilharEsc(pilhaId, () => aoFecharRef.current?.());

    const lidarTab = (e) => {
      if (e.key !== 'Tab' || !estaNoTopoEsc(pilhaId) || !painelRef.current) return;
      const lista = Array.from(painelRef.current.querySelectorAll(SELETOR_FOCAVEL));
      if (lista.length === 0) {
        e.preventDefault();
        return;
      }
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };

    document.addEventListener('keydown', lidarTab);

    return () => {
      desempilhar();
      document.removeEventListener('keydown', lidarTab);
      document.body.style.overflow = overflowAnterior;
      if (focoAnteriorRef.current && focoAnteriorRef.current.isConnected) {
        focoAnteriorRef.current.focus();
      }
    };
  }, [aberto, pilhaId]);

  if (!aberto) return null;

  return (
    <div
      class="painel-lateral__veu"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFecharRef.current?.();
      }}
    >
      <aside
        ref={painelRef}
        class="painel-lateral"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
      >
        <header class="painel-lateral__cabecalho">
          <div class="painel-lateral__titulos">
            <h2 id={tituloId} class="painel-lateral__titulo">
              {titulo}
            </h2>
            {subtitulo && <p class="painel-lateral__subtitulo">{subtitulo}</p>}
          </div>
          <button
            type="button"
            class="painel-lateral__fechar"
            aria-label="Fechar painel"
            onClick={() => aoFecharRef.current?.()}
          >
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        <div class="painel-lateral__corpo">{children}</div>
      </aside>
    </div>
  );
}
