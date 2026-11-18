import './Destaque.css';

/**
 * Bloco de métrica única: rótulo, número protagonista e linha de contexto.
 * `principal` usa `--fs-6` (no máximo um por tela).
 */
export function Destaque({ rotulo, valor, contexto, principal = false, className = '' }) {
  return (
    <div class={`destaque${principal ? ' destaque--principal' : ''}${className ? ` ${className}` : ''}`}>
      <span class="destaque__rotulo">{rotulo}</span>
      <div class="destaque__valor tabular">{valor}</div>
      {contexto && <span class="destaque__contexto">{contexto}</span>}
    </div>
  );
}

export function GradeDestaques({ children, className = '' }) {
  return (
    <div class={`grade-destaques${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}
