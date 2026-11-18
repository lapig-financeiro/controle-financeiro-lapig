import { Botao } from './Botao.jsx';
import './Vazio.css';

/**
 * Estado vazio sem ilustração: uma frase e, quando fizer sentido, um botão.
 */
export function Vazio({ mensagem, rotuloBotao = '', aoClicar = null, className = '' }) {
  return (
    <div class={`vazio${className ? ` ${className}` : ''}`}>
      <p class="vazio__mensagem texto-corrido">{mensagem}</p>
      {rotuloBotao && aoClicar && (
        <Botao variante="secundario" onClick={aoClicar}>
          {rotuloBotao}
        </Botao>
      )}
    </div>
  );
}
