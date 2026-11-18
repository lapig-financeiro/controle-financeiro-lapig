import { useId } from 'preact/hooks';
import { ChevronDown } from 'lucide-preact';
import './Seletor.css';

/**
 * Seletor (`<select>` nativo) padrão (`--altura-controle`, `--borda-controle`, anel de foco).
 */
export function Seletor({
  id,
  rotulo,
  valor = '',
  aoMudar,
  opcoes = [],
  placeholder = '',
  desabilitado = false,
  erro = '',
  ajuda = '',
  className = '',
  ...resto
}) {
  const autoId = useId();
  const selectId = id || autoId;
  const erroId = `${selectId}-erro`;
  const ajudaId = `${selectId}-ajuda`;
  const descritores = [
    erro ? erroId : null,
    ajuda ? ajudaId : null,
  ].filter(Boolean).join(' ') || undefined;

  return (
    <div class={`seletor${erro ? ' seletor--com-erro' : ''}${className ? ` ${className}` : ''}`}>
      {rotulo && (
        <label class="seletor__rotulo" for={selectId}>
          {rotulo}
        </label>
      )}
      <div class="seletor__controle">
        <select
          id={selectId}
          class="seletor__entrada"
          value={valor}
          onChange={(e) => aoMudar && aoMudar(e.currentTarget.value, e)}
          disabled={desabilitado}
          aria-invalid={erro ? 'true' : undefined}
          aria-describedby={descritores}
          {...resto}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {opcoes.map((opcao) => (
            <option key={opcao.valor} value={opcao.valor}>
              {opcao.rotulo}
            </option>
          ))}
        </select>
        <ChevronDown size={16} strokeWidth={1.75} class="seletor__seta" aria-hidden="true" />
      </div>
      {ajuda && (
        <span id={ajudaId} class="seletor__ajuda">
          {ajuda}
        </span>
      )}
      {erro && (
        <span id={erroId} class="seletor__erro" role="alert">
          {erro}
        </span>
      )}
    </div>
  );
}
