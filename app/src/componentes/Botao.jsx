import { Loader2 } from 'lucide-preact';
import './Botao.css';

/**
 * Botão padrão do sistema: `primario` (um por tela), `secundario` ou `fantasma`.
 */
export function Botao({
  variante = 'secundario',
  tamanho = 'padrao',
  icone: Icone = null,
  carregando = false,
  tipo = 'button',
  desabilitado = false,
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
