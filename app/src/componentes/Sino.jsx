import { useId, useRef, useState } from 'preact/hooks';
import { Bell } from 'lucide-preact';
import { MenuSuspenso, MenuSuspensoSeparador } from './MenuSuspenso.jsx';
import './Sino.css';

/**
 * Sino de pendências (ícone 20 px) no padrão de divulgação.
 */
export function Sino({ pendencias = [], onSelecionar = null }) {
  const [aberto, setAberto] = useState(false);
  const ancoraRef = useRef(null);
  const gatilhoRef = useRef(null);
  const painelId = useId();
  const total = pendencias.length;

  return (
    <div class="sino" ref={ancoraRef}>
      <button
        ref={gatilhoRef}
        type="button"
        class="sino__botao"
        aria-label={total > 0 ? `${total} pendências` : 'Pendências'}
        aria-expanded={aberto ? 'true' : 'false'}
        aria-controls={aberto ? painelId : undefined}
        onClick={() => setAberto((v) => !v)}
      >
        <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
        {total > 0 && (
          <span class="sino__contagem" aria-hidden="true">
            {total}
          </span>
        )}
      </button>

      <MenuSuspenso
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        ancoraRef={ancoraRef}
        gatilhoRef={gatilhoRef}
        ariaLabel="Pendências"
      >
        <div id={painelId}>
          <div class="sino__cabecalho">Pendências</div>
          <MenuSuspensoSeparador />
          {total === 0 ? (
            <p class="sino__vazio">Nenhuma pendência no momento.</p>
          ) : (
            <ul class="sino__lista">
              {pendencias.map((item, indice) => (
                <li key={item.id ?? indice}>
                  <button
                    type="button"
                    class="sino__item"
                    onClick={() => {
                      setAberto(false);
                      onSelecionar?.(item);
                    }}
                  >
                    <span class="sino__item-titulo">{item.titulo}</span>
                    <span class="sino__item-meta">
                      {item.centro} · {item.tempo}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </MenuSuspenso>
    </div>
  );
}
