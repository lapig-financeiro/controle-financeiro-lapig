import { useId, useRef } from 'preact/hooks';
import './Abas.css';

/**
 * Abas acessíveis (`tablist` / `tab` / `tabpanel`) com setas e tabindex itinerante.
 */
export function Abas({
  itens = [],
  ativa,
  aoSelecionar,
  ariaLabel = 'Seções',
  children = null,
  className = '',
}) {
  const baseId = useId();
  const refsAbas = useRef([]);

  const aoTeclar = (e, indice) => {
    if (itens.length === 0) return;
    let proximo = null;
    if (e.key === 'ArrowRight') proximo = (indice + 1) % itens.length;
    else if (e.key === 'ArrowLeft') proximo = (indice - 1 + itens.length) % itens.length;
    else if (e.key === 'Home') proximo = 0;
    else if (e.key === 'End') proximo = itens.length - 1;

    if (proximo !== null) {
      e.preventDefault();
      const item = itens[proximo];
      aoSelecionar?.(item.id);
      refsAbas.current[proximo]?.focus();
    }
  };

  const itemAtivo = itens.find((item) => item.id === ativa) || itens[0];

  return (
    <div class={`abas-bloco${className ? ` ${className}` : ''}`}>
      <div class="abas" role="tablist" aria-label={ariaLabel}>
        {itens.map((item, indice) => {
          const selecionada = item.id === ativa;
          return (
            <button
              key={item.id}
              ref={(el) => { refsAbas.current[indice] = el; }}
              id={`${baseId}-aba-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selecionada ? 'true' : 'false'}
              aria-controls={`${baseId}-painel-${item.id}`}
              tabIndex={selecionada ? 0 : -1}
              class={`abas__item${selecionada ? ' abas__item--ativa' : ''}`}
              onClick={() => aoSelecionar?.(item.id)}
              onKeyDown={(e) => aoTeclar(e, indice)}
            >
              <span>{item.rotulo}</span>
              {item.contagem !== undefined && item.contagem !== null && (
                <span class="abas__contagem">{item.contagem}</span>
              )}
            </button>
          );
        })}
      </div>

      {itemAtivo && (
        <div
          id={`${baseId}-painel-${itemAtivo.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-aba-${itemAtivo.id}`}
          class="abas__painel"
        >
          {typeof children === 'function' ? children(itemAtivo) : (itemAtivo.conteudo ?? children)}
        </div>
      )}
    </div>
  );
}
