import { ArrowLeft } from 'lucide-preact';
import './CabecalhoPagina.css';

/**
 * Cabeçalho de página: link de volta opcional (`--fs-2`, `--cor-texto-2`, seta 16 px),
 * título `--fs-4`, linha de contexto `--fs-2 --cor-texto-2` e ações à direita.
 */
export function CabecalhoPagina({
  voltar = null,
  titulo,
  contexto = null,
  acoes = null,
  className = '',
}) {
  return (
    <header class={`cabecalho-pagina${className ? ` ${className}` : ''}`}>
      {voltar && (
        <div class="cabecalho-pagina__volta">
          {voltar.href ? (
            <a href={voltar.href} class="cabecalho-pagina__link-volta" onClick={voltar.onClick}>
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>{voltar.rotulo}</span>
            </a>
          ) : (
            <button type="button" class="cabecalho-pagina__link-volta" onClick={voltar.onClick}>
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>{voltar.rotulo}</span>
            </button>
          )}
        </div>
      )}

      <div class="cabecalho-pagina__linha">
        <div class="cabecalho-pagina__titulos">
          <h1 class="cabecalho-pagina__titulo">{titulo}</h1>
          {contexto && <p class="cabecalho-pagina__contexto">{contexto}</p>}
        </div>
        {acoes && <div class="cabecalho-pagina__acoes">{acoes}</div>}
      </div>
    </header>
  );
}
