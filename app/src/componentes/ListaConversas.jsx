import { Botao } from './Botao.jsx';
import { Esqueleto } from './Esqueleto.jsx';
import { Vazio } from './Vazio.jsx';
import { quandoConversa } from '../util/conversas.js';
import './ListaConversas.css';

/**
 * Lista de conversas da Análise (migração 075). Usada na coluna da esquerda
 * a partir de 1024 px e dentro do `PainelLateral` no celular. O item ativo
 * fica com o fundo de seleção; quem não está ativo é superfície com hover.
 */
export function ListaConversas({
  conversas = [],
  ativaId = null,
  onSelecionar,
  onNova,
  agora = new Date(),
  rotuloNova = 'Nova conversa',
  carregando = false,
  className = '',
}) {
  const itens = Array.isArray(conversas) ? conversas : [];

  return (
    <div class={`lista-conversas${className ? ` ${className}` : ''}`}>
      {onNova && (
        <Botao variante="secundario" onClick={onNova} className="lista-conversas__nova">
          {rotuloNova}
        </Botao>
      )}

      {carregando ? (
        <Esqueleto variante="linha" linhas={3} rotulo="Carregando conversas" />
      ) : itens.length === 0 ? (
        <Vazio mensagem="Nenhuma conversa ainda. Faça a primeira pergunta." />
      ) : (
        <ul class="lista-conversas__itens" aria-label="Conversas">
          {itens.map((conversa) => {
            const ativo = Boolean(ativaId) && conversa.id === ativaId;
            return (
              <li key={conversa.id}>
                <button
                  type="button"
                  class={`lista-conversas__item${ativo ? ' lista-conversas__item--ativo' : ''}`}
                  aria-current={ativo ? 'true' : undefined}
                  onClick={() => onSelecionar?.(conversa.id)}
                >
                  <span class="lista-conversas__titulo">{conversa.titulo}</span>
                  <span class="lista-conversas__quando">
                    {quandoConversa(conversa.atualizada_em, agora)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
