import './Destaque.css';

/**
 * Bloco de métrica única: rótulo, número protagonista e linha de contexto.
 * `principal` usa `--fs-6` (no máximo um por tela). `ajuda` vira o title do
 * rótulo; `ajudasOcultas` são textos `sr-only` ligados por `aria-describedby`.
 */
export function Destaque({
  rotulo,
  valor,
  contexto,
  principal = false,
  className = '',
  ajuda = '',
  ajudasOcultas = [],
}) {
  return (
    <div class={`destaque${principal ? ' destaque--principal' : ''}${className ? ` ${className}` : ''}`}>
      <span class="destaque__rotulo" title={ajuda || undefined}>{rotulo}</span>
      <div class="destaque__valor tabular">{valor}</div>
      {contexto && <span class="destaque__contexto">{contexto}</span>}
      {ajudasOcultas.map(({ id, texto }) => (
        <span key={id} id={id} class="sr-only">{texto}</span>
      ))}
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
