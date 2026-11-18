import './LinhaDeLista.css';

/**
 * Lista de navegação semântica (`<ul>`).
 */
export function Lista({ children, ariaLabel = 'Lista', className = '' }) {
  return (
    <ul class={`lista-de-linhas${className ? ` ${className}` : ''}`} aria-label={ariaLabel}>
      {children}
    </ul>
  );
}

/**
 * Item de navegação (`<li><a>`): altura `--altura-linha`, grade fixa, nada clicável dentro.
 */
export function LinhaDeLista({ href, onClick, children, className = '' }) {
  return (
    <li class="lista-de-linhas__item">
      <a
        href={href}
        class={`linha-de-lista${className ? ` ${className}` : ''}`}
        onClick={onClick}
      >
        {children}
      </a>
    </li>
  );
}
