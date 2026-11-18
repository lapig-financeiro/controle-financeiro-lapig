import './Cartao.css';

/**
 * Superfície padrão de agrupamento: fundo branco, borda fina, sem sombra.
 */
export function Cartao({ titulo, subtitulo, acao, children, className = '' }) {
  return (
    <section class={`cartao${className ? ` ${className}` : ''}`}>
      {(titulo || subtitulo || acao) && (
        <header class="cartao__cabecalho">
          <div class="cartao__titulos">
            {titulo && <h2 class="cartao__titulo">{titulo}</h2>}
            {subtitulo && <p class="cartao__subtitulo">{subtitulo}</p>}
          </div>
          {acao && <div class="cartao__acao">{acao}</div>}
        </header>
      )}
      <div class="cartao__corpo">{children}</div>
    </section>
  );
}
