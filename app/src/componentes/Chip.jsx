import './Chip.css';

/**
 * Chip para filtro de visão e filtros rápidos (`--altura-chip`, `--fs-2` 500).
 * Quando ativo, usa fundo `--cor-acento-suave` e texto `--cor-texto`.
 * `aria-pressed` só é emitido quando `ativo` é passado explicitamente: chips de
 * sugestão que só preenchem um campo não devem anunciar "não pressionado".
 */
export function Chip({
  ativo,
  icone: Icone = null,
  iconeDireita: IconeDireita = null,
  onClick,
  ariaLabel,
  ariaExpanded,
  children,
  className = '',
}) {
  const ativoBooleano = Boolean(ativo);
  const ariaPressed =
    ativo === undefined ? undefined : ativoBooleano ? 'true' : 'false';
  return (
    <button
      type="button"
      class={`chip${ativoBooleano ? ' chip--ativo' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-pressed={ariaPressed}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
    >
      {Icone && <Icone size={16} strokeWidth={1.75} aria-hidden="true" />}
      <span>{children}</span>
      {IconeDireita && <IconeDireita size={16} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}
