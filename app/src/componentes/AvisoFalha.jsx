import { AlertTriangle } from 'lucide-preact';
import { Botao } from './Botao.jsx';
import './AvisoFalha.css';

/**
 * Faixa de falha de consulta: nunca vira zero, informa o que falhou e oferece retentativa.
 */
export function AvisoFalha({
  mensagem,
  aoTentarNovamente = null,
  grave = false,
  className = '',
}) {
  return (
    <div
      class={`aviso-falha${grave ? ' aviso-falha--grave' : ''}${className ? ` ${className}` : ''}`}
      role="alert"
    >
      <div class="aviso-falha__texto">
        <AlertTriangle size={16} strokeWidth={1.75} class="aviso-falha__icone" aria-hidden="true" />
        <span>{mensagem}</span>
      </div>
      {aoTentarNovamente && (
        <Botao variante="fantasma" tamanho="compacto" onClick={aoTentarNovamente}>
          Tentar de novo
        </Botao>
      )}
    </div>
  );
}
