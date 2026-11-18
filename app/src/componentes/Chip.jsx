import './Chip.css';

/**
 * Chip para filtro de visão e filtros rápidos (`--altura-chip`, `--fs-2` 500).
 * Quando ativo, usa fundo `--cor-acento-suave` e texto `--cor-texto`.
 */
export function Chip({
  ativo = false,
  icone: Icone = null,
  iconeDireita: IconeDireita = null,
  onClick,
  ariaLabel,
  ariaExpanded,
  children,
  className = '',
}) {
  return (
    <button
      type="button"
      class={`chip${ativo ? ' chip--ativo' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-pressed={ativo ? 'true' : 'false'}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
    >
      {Icone && <Icone size={16} strokeWidth={1.75} aria-hidden="true" />}
      <span>{children}</span>
      {IconeDireita && <IconeDireita size={16} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}
