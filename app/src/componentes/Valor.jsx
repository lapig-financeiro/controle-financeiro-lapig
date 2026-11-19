import { dataCompacta, dataCompleta, dinheiro, dinheiroCompacto } from '../util/formato.js';
import './Valor.css';

/**
 * Exibe valor monetário ou data com semântica explícita.
 * Números nunca são verdes: positivo usa `--cor-texto`; negativo com `problema` usa `--cor-problema`.
 * Só vira `<button>` quando `origem` e `onOrigem` são fornecidos (Destaque, PainelLateral, Documento).
 * `rotuloOrigem` substitui o aria-label padrão; `ariaDescritoPor` liga a ajuda e `ariaBusy` marca o carregamento.
 */
export function Valor({
  valor,
  tipo = 'moeda',
  centavos = false,
  semPrefixo = false,
  problema = false,
  alinhadoDireita = false,
  motivoSemDado = 'sem dado',
  origem = null,
  onOrigem = null,
  semOrigem = '',
  rotuloOrigem = '',
  ariaDescritoPor = '',
  ariaBusy = false,
  className = '',
}) {
  const ehTipoMoeda = tipo === 'moeda' || tipo === 'moeda-compacta';
  const temValor = valor !== null && valor !== undefined && valor !== '' &&
    (!ehTipoMoeda || Number.isFinite(Number(valor)));

  if (!temValor) {
    return (
      <span
        class={`valor valor--vazio${alinhadoDireita ? ' valor--direita' : ''}${className ? ` ${className}` : ''}`}
        title={motivoSemDado}
      >
        —
      </span>
    );
  }

  let texto;
  if (tipo === 'data') {
    texto = dataCompacta(valor);
  } else if (tipo === 'data-completa') {
    texto = dataCompleta(valor);
  } else if (tipo === 'moeda-compacta') {
    texto = dinheiroCompacto(valor);
  } else {
    texto = dinheiro(valor, { centavos, prefixo: !semPrefixo });
  }

  const ehNegativo = ehTipoMoeda && Number(valor) < 0;
  const classes = [
    'valor',
    alinhadoDireita ? 'valor--direita' : '',
    problema && ehNegativo ? 'valor--problema' : '',
    className,
  ].filter(Boolean).join(' ');

  if (origem && onOrigem) {
    const rotuloAcessivel =
      rotuloOrigem ||
      (origem.resumo
        ? `${texto} (${origem.resumo}). Ver origem`
        : `Ver origem de ${texto}`);
    return (
      <button
        type="button"
        class={`${classes} valor--origem`}
        onClick={(e) => onOrigem(origem, e)}
        aria-label={rotuloAcessivel}
        aria-describedby={ariaDescritoPor || undefined}
        aria-busy={ariaBusy ? 'true' : undefined}
      >
        {texto}
      </button>
    );
  }

  return (
    <span class={classes} title={semOrigem || undefined}>
      {texto}
    </span>
  );
}
