import './Esqueleto.css';

/**
 * Carregamento no formato do conteúdo com blocos `--cor-afundado` e pulso de 1,2 s.
 */
export function Esqueleto({
  variante = 'linha',
  linhas = 3,
  rotulo = 'Carregando',
  className = '',
}) {
  return (
    <div role="status" class={className}>
      <span class="sr-only">{rotulo}</span>

      {variante === 'destaque' && (
        <div class="esqueleto-destaque" aria-hidden="true">
          <span class="esqueleto__bloco esqueleto__bloco--rotulo" />
          <span class="esqueleto__bloco esqueleto__bloco--numero" />
          <span class="esqueleto__bloco esqueleto__bloco--contexto" />
        </div>
      )}

      {variante === 'tabela' && (
        <div class="esqueleto-tabela" aria-hidden="true">
          <div class="esqueleto-tabela__cabecalho">
            <span class="esqueleto__bloco esqueleto__bloco--col-larga" />
            <span class="esqueleto__bloco esqueleto__bloco--col-curta" />
            <span class="esqueleto__bloco esqueleto__bloco--col-curta" />
          </div>
          {Array.from({ length: linhas }).map((_, indice) => (
            <div key={indice} class="esqueleto-tabela__linha">
              <span class="esqueleto__bloco esqueleto__bloco--col-larga" />
              <span class="esqueleto__bloco esqueleto__bloco--col-curta" />
              <span class="esqueleto__bloco esqueleto__bloco--col-curta" />
            </div>
          ))}
        </div>
      )}

      {variante === 'cartao' && (
        <div class="esqueleto-cartao" aria-hidden="true">
          <span class="esqueleto__bloco esqueleto__bloco--titulo" />
          {Array.from({ length: linhas }).map((_, indice) => (
            <span key={indice} class="esqueleto__bloco esqueleto__bloco--linha" />
          ))}
        </div>
      )}

      {variante === 'linha' && (
        <div class="esqueleto-lista" aria-hidden="true">
          {Array.from({ length: linhas }).map((_, indice) => (
            <span key={indice} class="esqueleto__bloco esqueleto__bloco--linha" />
          ))}
        </div>
      )}
    </div>
  );
}
