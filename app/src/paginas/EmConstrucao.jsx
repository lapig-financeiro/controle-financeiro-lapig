import { CabecalhoPagina, Vazio } from '../componentes/index.js';

export function EmConstrucao({ titulo, contexto, voltar = null }) {
  return (
    <div class="conteudo">
      <CabecalhoPagina voltar={voltar} titulo={titulo} contexto={contexto} />
      <Vazio mensagem="Em construção." />
    </div>
  );
}
