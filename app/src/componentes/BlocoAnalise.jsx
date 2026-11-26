import { dataCompleta, dinheiro } from '../util/formato.js';
import { Destaque } from './Destaque.jsx';
import { Tabela } from './Tabela.jsx';
import { Valor } from './Valor.jsx';
import './BlocoAnalise.css';

const UNIDADES = new Set(['moeda', 'data', 'numero', 'percentual', 'texto']);
const ALINHADAS_DIREITA = new Set(['moeda', 'numero', 'percentual']);

export const TITULO_SEM_ORIGEM = 'Número sem origem: não veio de um bloco';

function numeroFinito(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Formata um valor de bloco conforme a unidade do contrato (§6):
 * moeda com centavos, data completa, percentual e número em pt-BR.
 * Valor ausente ou não finito vira `—`, nunca zero.
 */
export function formatarValorAnalise(valor, unidade = 'texto', { semPrefixo = false } = {}) {
  const tipo = UNIDADES.has(unidade) ? unidade : 'texto';

  if (tipo === 'texto') {
    return valor === null || valor === undefined || valor === '' ? '—' : String(valor);
  }

  const numero = numeroFinito(valor);
  if (numero === null && tipo !== 'data') return '—';

  if (tipo === 'moeda') {
    return dinheiro(valor, { centavos: true, prefixo: !semPrefixo });
  }
  if (tipo === 'data') {
    return dataCompleta(valor);
  }
  if (tipo === 'percentual') {
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(numero)}%`;
  }
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(numero);
}

/** Só vira botão quando a origem é de um tipo que a tela sabe abrir. */
export function origemAbribel(origem) {
  if (!origem || typeof origem !== 'object') return false;
  switch (origem.tipo) {
    case 'no':
      return Boolean(origem.no && typeof origem.no === 'object');
    case 'livre':
      return typeof origem.project_id === 'string' && origem.project_id.trim() !== '';
    case 'ref':
      return Boolean(
        origem.ref &&
          typeof origem.ref === 'object' &&
          origem.ref.alvo_tabela &&
          origem.ref.alvo_id &&
          origem.ref.campo
      );
    case 'termo':
      return Boolean(origem.project_id && origem.termo_id);
    case 'calculo':
      return Array.isArray(origem.partes);
    default:
      return false;
  }
}

/** Um bloco só é renderizado se tem a forma do contrato §6. */
export function blocoValido(bloco) {
  if (!bloco || typeof bloco !== 'object') return false;

  if (bloco.tipo === 'numero') {
    const numero = bloco.numero;
    return Boolean(
      numero &&
        typeof numero === 'object' &&
        Object.prototype.hasOwnProperty.call(numero, 'valor') &&
        numero.valor !== undefined
    );
  }

  if (bloco.tipo === 'tabela') {
    const tabela = bloco.tabela;
    return Boolean(
      tabela &&
        typeof tabela === 'object' &&
        Array.isArray(tabela.colunas) &&
        tabela.colunas.length > 0 &&
        Array.isArray(tabela.linhas) &&
        tabela.linhas.every((linha) => Array.isArray(linha))
    );
  }

  if (bloco.tipo === 'texto') {
    return Boolean(bloco.texto && typeof bloco.texto.texto === 'string');
  }

  return false;
}

/**
 * Intervalos de `semOrigem` em índices UTF-16: descarta fora do texto,
 * invertidos e sobrepostos, sem lançar.
 */
export function intervalosValidos(texto, semOrigem) {
  const base = typeof texto === 'string' ? texto : String(texto ?? '');
  if (!Array.isArray(semOrigem)) return [];

  const candidatos = semOrigem
    .filter(
      (intervalo) =>
        intervalo &&
        Number.isInteger(intervalo.inicio) &&
        Number.isInteger(intervalo.fim) &&
        !(intervalo.fim > base.length) &&
        intervalo.inicio >= 0 &&
        intervalo.inicio < intervalo.fim
    )
    .sort((a, b) => a.inicio - b.inicio || a.fim - b.fim);

  const validos = [];
  let ultimoFim = -1;
  for (const intervalo of candidatos) {
    if (intervalo.inicio < ultimoFim) continue;
    validos.push({ inicio: intervalo.inicio, fim: intervalo.fim });
    ultimoFim = intervalo.fim;
  }
  return validos;
}

function substituirPessoas(texto) {
  return String(texto ?? '').replace(/⟦P(\d+)⟧/g, (_, numero) => `pessoa ${numero}`);
}

/**
 * Texto com os trechos que não vieram de bloco marcados e os marcadores
 * `⟦Pn⟧` residuais trocados por "pessoa n".
 */
export function TextoComSemOrigem({ texto, semOrigem = [] }) {
  const base = typeof texto === 'string' ? texto : String(texto ?? '');
  if (!base) return null;

  const intervalos = intervalosValidos(base, semOrigem);
  const partes = [];
  let cursor = 0;

  intervalos.forEach((intervalo, indice) => {
    if (intervalo.inicio > cursor) {
      partes.push(
        <span key={`texto-${indice}`}>
          {substituirPessoas(base.slice(cursor, intervalo.inicio))}
        </span>
      );
    }
    partes.push(
      <mark
        key={`marca-${indice}`}
        class="bloco-analise__sem-origem"
        title={TITULO_SEM_ORIGEM}
      >
        {substituirPessoas(base.slice(intervalo.inicio, intervalo.fim))}
      </mark>
    );
    cursor = intervalo.fim;
  });

  if (cursor < base.length) {
    partes.push(<span key="texto-final">{substituirPessoas(base.slice(cursor))}</span>);
  }

  return <>{partes}</>;
}

function motivoDoValor(valorAusente, origem) {
  if (valorAusente) return origem?.motivo || 'sem dado';
  if (origem?.tipo === 'sem_documento') return origem.motivo || 'sem documento';
  if (!origem) return 'Origem não informada';
  return 'Origem não informada';
}

/**
 * Valor de um bloco da Análise. Moeda e data usam `Valor`; número e
 * percentual usam o mesmo visual e a mesma classe de origem. O clique
 * entrega `{ valorEsperado }` para a tela conferir contas do tipo `calculo`.
 */
export function ValorAnalise({
  valor,
  unidade = 'texto',
  origem = null,
  onOrigem = null,
  valorEsperado = undefined,
  alinhadoDireita = false,
  semPrefixo = false,
  className = '',
}) {
  const tipo = UNIDADES.has(unidade) ? unidade : 'texto';
  const texto = formatarValorAnalise(valor, tipo, { semPrefixo });
  const vazio = texto === '—';
  const abrivel = origemAbribel(origem) && typeof onOrigem === 'function';
  const motivo = motivoDoValor(vazio, origem);
  const esperado = valorEsperado === undefined ? valor : valorEsperado;

  const classes = [
    'valor',
    alinhadoDireita ? 'valor--direita' : '',
    className,
  ].filter(Boolean).join(' ');

  if (tipo === 'moeda') {
    return (
      <Valor
        valor={valor}
        centavos
        semPrefixo={semPrefixo}
        alinhadoDireita={alinhadoDireita}
        motivoSemDado={motivo}
        origem={abrivel ? origem : null}
        onOrigem={abrivel ? (origemClicada, evento) => onOrigem(origemClicada, { valorEsperado: esperado }, evento) : null}
        semOrigem={!abrivel ? motivo : ''}
        rotuloOrigem={abrivel && origem?.resumo ? `${origem.resumo}. Ver origem` : ''}
      />
    );
  }

  if (tipo === 'data') {
    return (
      <Valor
        valor={valor}
        tipo="data-completa"
        alinhadoDireita={alinhadoDireita}
        motivoSemDado={motivo}
        origem={abrivel ? origem : null}
        onOrigem={abrivel ? (origemClicada, evento) => onOrigem(origemClicada, { valorEsperado: esperado }, evento) : null}
        semOrigem={!abrivel ? motivo : ''}
        rotuloOrigem={abrivel && origem?.resumo ? `${origem.resumo}. Ver origem` : ''}
      />
    );
  }

  if (vazio) {
    return (
      <span class={`valor valor--vazio${alinhadoDireita ? ' valor--direita' : ''}${className ? ` ${className}` : ''}`} title={motivo}>
        —
      </span>
    );
  }

  if (abrivel) {
    const rotuloAcessivel = origem?.resumo ? `${texto} (${origem.resumo}). Ver origem` : `Ver origem de ${texto}`;
    return (
      <button
        type="button"
        class={`${classes} valor--origem`}
        onClick={(evento) => onOrigem(origem, { valorEsperado: esperado }, evento)}
        aria-label={rotuloAcessivel}
      >
        {texto}
      </button>
    );
  }

  return (
    <span class={classes} title={!origem || origem.tipo !== 'texto' ? motivo : undefined}>
      {texto}
    </span>
  );
}

/**
 * Um bloco da resposta da Análise: número, tabela ou texto. Devolve `null`
 * para bloco inválido — a tela mostra uma única nota discreta por análise.
 */
export function BlocoAnalise({ bloco, onOrigem = null, className = '' }) {
  if (!blocoValido(bloco)) return null;

  if (bloco.tipo === 'numero') {
    const numero = bloco.numero;
    const contexto = numero.rotulo || numero.contexto ? (
      <span>
        {numero.rotulo}
        {numero.rotulo && numero.contexto ? ' · ' : ''}
        {numero.contexto && (
          <ValorAnalise
            valor={numero.contexto.valor}
            unidade={numero.contexto.unidade}
            origem={numero.contexto.origem}
            onOrigem={onOrigem}
            valorEsperado={numero.contexto.valor}
          />
        )}
      </span>
    ) : undefined;

    return (
      <div class={`bloco-analise${className ? ` ${className}` : ''}`}>
        <Destaque
          rotulo={bloco.titulo || 'Número'}
          valor={
            <ValorAnalise
              valor={numero.valor}
              unidade={numero.unidade}
              origem={numero.origem}
              onOrigem={onOrigem}
              valorEsperado={numero.valor}
            />
          }
          contexto={contexto}
        />
      </div>
    );
  }

  if (bloco.tipo === 'tabela') {
    const colunas = bloco.tabela.colunas.map((coluna, indice) => {
      const unidade = UNIDADES.has(coluna?.unidade) ? coluna.unidade : 'texto';
      const alinhada = ALINHADAS_DIREITA.has(unidade);
      const cabecalhoComPrefixo = String(coluna?.rotulo || '').includes('(R$)');
      return {
        chave: `coluna-${indice}`,
        titulo: coluna?.rotulo || '',
        alinhamento: alinhada ? 'direita' : undefined,
        render: (linha) => {
          const celula = linha?.[indice];
          if (!celula || typeof celula !== 'object') return null;
          if (indice === 0 && !celula.origem) {
            return <span>{formatarValorAnalise(celula.valor, 'texto')}</span>;
          }
          return (
            <ValorAnalise
              valor={celula.valor}
              unidade={celula.unidade || unidade}
              origem={celula.origem}
              onOrigem={onOrigem}
              valorEsperado={celula.valor}
              alinhadoDireita={alinhada}
              semPrefixo={unidade === 'moeda' && cabecalhoComPrefixo}
            />
          );
        },
      };
    });

    return (
      <div class={`bloco-analise${className ? ` ${className}` : ''}`}>
        {bloco.titulo && <h3 class="bloco-analise__titulo">{bloco.titulo}</h3>}
        <Tabela
          colunas={colunas}
          dados={bloco.tabela.linhas}
          chaveLinha={(_, indice) => `linha-${indice}`}
          legenda={bloco.titulo || 'Tabela da análise'}
        />
      </div>
    );
  }

  return (
    <div class={`bloco-analise${className ? ` ${className}` : ''}`}>
      {bloco.titulo && <h3 class="bloco-analise__titulo">{bloco.titulo}</h3>}
      <p class="bloco-analise__texto texto-corrido">
        <TextoComSemOrigem texto={bloco.texto.texto} semOrigem={bloco.texto.semOrigem} />
      </p>
    </div>
  );
}
