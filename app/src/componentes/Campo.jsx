import { useId } from 'preact/hooks';
import './Campo.css';

/**
 * Campo de texto padrão (`--altura-controle`, `--borda-controle`, anel de foco).
 */
export function Campo({
  id,
  rotulo,
  tipo = 'text',
  valor = '',
  aoMudar,
  onInput,
  placeholder = '',
  erro = '',
  ajuda = '',
  obrigatorio = false,
  desabilitado = false,
  autoComplete,
  minLength,
  sufixo = null,
  className = '',
  ...resto
}) {
  const autoId = useId();
  const inputId = id || autoId;
  const erroId = `${inputId}-erro`;
  const ajudaId = `${inputId}-ajuda`;
  const descritores = [
    erro ? erroId : null,
    ajuda ? ajudaId : null,
  ].filter(Boolean).join(' ') || undefined;

  const lidarEntrada = (e) => {
    if (aoMudar) aoMudar(e.currentTarget.value, e);
    if (onInput) onInput(e);
  };

  return (
    <div class={`campo${erro ? ' campo--com-erro' : ''}${className ? ` ${className}` : ''}`}>
      {rotulo && (
        <label class="campo__rotulo" for={inputId}>
          {rotulo}
        </label>
      )}
      <div class="campo__controle">
        <input
          id={inputId}
          type={tipo}
          class={`campo__entrada${sufixo ? ' campo__entrada--com-sufixo' : ''}`}
          value={valor}
          onInput={lidarEntrada}
          placeholder={placeholder}
          required={obrigatorio}
          disabled={desabilitado}
          autocomplete={autoComplete}
          minLength={minLength}
          aria-invalid={erro ? 'true' : undefined}
          aria-describedby={descritores}
          {...resto}
        />
        {sufixo && <div class="campo__sufixo">{sufixo}</div>}
      </div>
      {ajuda && (
        <span id={ajudaId} class="campo__ajuda">
          {ajuda}
        </span>
      )}
      {erro && (
        <span id={erroId} class="campo__erro" role="alert">
          {erro}
        </span>
      )}
    </div>
  );
}
