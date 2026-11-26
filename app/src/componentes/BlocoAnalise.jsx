import { Check, Copy } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { dataCompleta, dinheiro } from '../util/formato.js';
import { Botao } from './Botao.jsx';
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

const FORMATO_PLANILHA = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const FORMATO_PLANILHA_MOEDA = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Uma célula como texto de planilha: número em pt-BR sem "R$" e com hífen
 * comum no negativo (o Excel e o Planilhas leem "−" como texto), data
 * dd/mm/aaaa, percentual com "%". Vazio vira "—", como na tela: nunca zero.
 */
function celulaParaPlanilha(valor, unidade) {
  const tipo = UNIDADES.has(unidade) ? unidade : 'texto';
  if (tipo === 'texto') {
    const texto = valor === null || valor === undefined || valor === '' ? '' : substituirPessoas(valor);
    const limpo = texto.replace(/[\t\r\n]+/g, ' ').trim() || '—';
    // Texto que começa com = + - @ viraria fórmula ao colar na planilha.
    return /^[=+\-@]/.test(limpo) ? `'${limpo}` : limpo;
  }
  if (tipo === 'data') return formatarValorAnalise(valor, 'data');
  const bruto = numeroFinito(valor);
  if (bruto === null) return '—';
  const numero = bruto === 0 ? 0 : bruto; // sem "-0,00"
  if (tipo === 'moeda') return FORMATO_PLANILHA_MOEDA.format(numero);
  if (tipo === 'percentual') return `${FORMATO_PLANILHA.format(numero)}%`;
  return FORMATO_PLANILHA.format(numero);
}

/**
 * Tabela da Análise como texto separado por tabulação (cola em colunas no
 * Excel e no Planilhas). Coluna em reais sem "(R$)" no rótulo ganha o sufixo,
 * já que as células saem sem o prefixo.
 */
export function tabelaParaTexto(tabela) {
  if (!tabela || !Array.isArray(tabela.colunas) || !Array.isArray(tabela.linhas)) return '';
  const unidades = tabela.colunas.map((coluna) =>
    UNIDADES.has(coluna?.unidade) ? coluna.unidade : 'texto'
  );
  const cabecalho = tabela.colunas.map((coluna, indice) => {
    const rotulo = String(coluna?.rotulo ?? '').replace(/[\t\r\n]+/g, ' ').trim();
    if (unidades[indice] === 'moeda' && !rotulo.includes('R$')) {
      return rotulo ? `${rotulo} (R$)` : 'R$';
    }
    return rotulo;
  });
  const linhas = tabela.linhas
    .filter((linha) => Array.isArray(linha))
    .map((linha) =>
      tabela.colunas
        .map((_, indice) => {
          const celula = linha[indice];
          if (!celula || typeof celula !== 'object') return '—';
          return celulaParaPlanilha(celula.valor, celula.unidade || unidades[indice]);
        })
        .join('\t')
    );
  return [cabecalho.join('\t'), ...linhas].join('\n');
}

// Reserva para quando a API nova é negada (página embutida, permissão do
// navegador): o `execCommand` antigo ainda copia uma seleção num clique.
function copiarPorSelecao(texto) {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  // Guarda foco e seleção de quem clicou: a cópia não pode tirar o cursor do
  // campo da pergunta nem desfazer uma seleção.
  const focoAnterior = document.activeElement;
  const selecao = typeof window.getSelection === 'function' ? window.getSelection() : null;
  const intervalos = [];
  if (selecao) {
    for (let i = 0; i < selecao.rangeCount; i += 1) intervalos.push(selecao.getRangeAt(i));
  }
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.tabIndex = -1;
  area.className = 'bloco-analise__area-copia';
  document.body.appendChild(area);
  let ok = false;
  try {
    area.focus({ preventScroll: true });
    area.select();
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    area.remove();
    if (selecao) {
      selecao.removeAllRanges();
      intervalos.forEach((intervalo) => selecao.addRange(intervalo));
    }
    if (focoAnterior && typeof focoAnterior.focus === 'function' && focoAnterior.isConnected) {
      focoAnterior.focus({ preventScroll: true });
    }
  }
  return ok;
}

async function copiarTexto(texto) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return;
    }
  } catch {
    /* cai na reserva abaixo */
  }
  if (!copiarPorSelecao(texto)) throw new Error('Área de transferência indisponível');
}

/** "Copiar tabela": confirma por 2 s ao lado do botão e avisa se falhar. */
function BotaoCopiarTabela({ tabela, copiar = copiarTexto }) {
  const [estado, setEstado] = useState('parado');
  const relogioRef = useRef(null);

  useEffect(() => () => clearTimeout(relogioRef.current), []);

  const aoCopiar = async () => {
    clearTimeout(relogioRef.current);
    try {
      await copiar(tabelaParaTexto(tabela));
      setEstado('copiada');
    } catch {
      setEstado('falhou');
    }
    relogioRef.current = setTimeout(() => setEstado('parado'), 2000);
  };

  return (
    <span class="bloco-analise__copiar">
      <Botao
        variante="fantasma"
        tamanho="compacto"
        icone={estado === 'copiada' ? Check : Copy}
        onClick={aoCopiar}
      >
        {estado === 'copiada' ? 'Copiada' : 'Copiar tabela'}
      </Botao>
      <span
        class={`bloco-analise__copiar-status${estado === 'falhou' ? ' bloco-analise__copiar-status--falha' : ''}`}
        role="status"
      >
        {estado === 'copiada'
          ? 'Tabela copiada. Cole numa planilha.'
          : estado === 'falhou'
            ? 'Não foi possível copiar. Selecione a tabela e use Ctrl+C.'
            : ''}
      </span>
    </span>
  );
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
export function BlocoAnalise({ bloco, onOrigem = null, className = '', copiar = undefined }) {
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
            return <span>{substituirPessoas(formatarValorAnalise(celula.valor, 'texto'))}</span>;
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
        <div class="bloco-analise__cabeca">
          {bloco.titulo ? <h3 class="bloco-analise__titulo">{bloco.titulo}</h3> : <span />}
          <BotaoCopiarTabela tabela={bloco.tabela} copiar={copiar} />
        </div>
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
