import { Loader2 } from 'lucide-preact';
import './Botao.css';

/**
 * Botão padrão do sistema: `primario` (um por tela), `secundario` ou `fantasma`.
 * Quando `href` é informado, renderiza um link `<a>` com a mesma aparência.
 */
export function Botao({
  variante = 'secundario',
  tamanho = 'padrao',
  icone: Icone = null,
  carregando = false,
  tipo = 'button',
  desabilitado = false,
  href = null,
  externo = false,
  onClick,
  children,
  className = '',
  ...resto
}) {
  const classes = [
    'botao',
    `botao--${variante}`,
    tamanho === 'compacto' ? 'botao--compacto' : '',
    className,
  ].filter(Boolean).join(' ');

  if (href) {
    return (
      <a
        href={href}
        target={externo ? '_blank' : undefined}
        rel={externo ? 'noopener noreferrer' : undefined}
        class={classes}
        aria-disabled={desabilitado ? 'true' : undefined}
        onClick={onClick}
        {...resto}
      >
        {Icone && <Icone size={16} strokeWidth={1.75} aria-hidden="true" />}
        <span>{children}</span>
      </a>
    );
  }

  return (
    <button
      type={tipo}
      class={classes}
      disabled={desabilitado || carregando}
      onClick={onClick}
      {...resto}
    >
      {carregando ? (
        <Loader2 size={16} strokeWidth={1.75} class="botao__girador" aria-hidden="true" />
      ) : (
        Icone && <Icone size={16} strokeWidth={1.75} aria-hidden="true" />
      )}
      <span>{children}</span>
    </button>
  );
}
