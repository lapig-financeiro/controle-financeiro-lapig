import './Situacao.css';

const ESTADOS = {
  'em dia': { classe: 'situacao--acento', texto: 'em dia' },
  atencao: { classe: 'situacao--atencao', texto: 'atenção' },
  'atenção': { classe: 'situacao--atencao', texto: 'atenção' },
  problema: { classe: 'situacao--problema', texto: 'problema' },
  'sem balancete': { classe: 'situacao--neutro', texto: 'sem balancete' },
  'sem plano': { classe: 'situacao--neutro', texto: 'sem plano' },
  'sem dado': { classe: 'situacao--neutro', texto: 'sem dado' },
};

/**
 * Indicador de situação: ponto de 6 px + palavra fixa, sem fundo.
 */
export function Situacao({ estado = 'sem dado', className = '' }) {
  const chave = String(estado || 'sem dado').trim().toLowerCase();
  const config = ESTADOS[chave] || ESTADOS['sem dado'];

  return (
    <span class={`situacao ${config.classe}${className ? ` ${className}` : ''}`}>
      <span class="situacao__ponto" aria-hidden="true" />
      <span>{config.texto}</span>
    </span>
  );
}
