const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * Formata um valor numérico em moeda brasileira (BRL).
 * Devolve `—` para `null`, `undefined`, `''`, `NaN` ou não finito — nunca zero.
 * Negativos sempre preservam o sinal tipográfico `−` (U+2212), inclusive valores pequenos.
 *
 * @param {number|string|null|undefined} valor
 * @param {{ centavos?: boolean, prefixo?: boolean }} [opcoes]
 * @returns {string}
 */
export function dinheiro(valor, opcoes = {}) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(numero)) return '—';

  const { centavos = false, prefixo = true } = opcoes;
  const casas = centavos ? 2 : 0;
  const ehNegativo = numero < 0;
  const absoluto = numero === 0 ? 0 : Math.abs(numero);

  const formatado = prefixo
    ? new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: casas,
        maximumFractionDigits: casas,
      }).format(absoluto)
    : new Intl.NumberFormat('pt-BR', {
        style: 'decimal',
        minimumFractionDigits: casas,
        maximumFractionDigits: casas,
      }).format(absoluto);

  return ehNegativo ? `\u2212${formatado}` : formatado;
}

/**
 * Formata valores grandes de forma compacta (`R$ 1,24 mi`, `R$ 84,3 mil`)
 * para totais de cabeçalho e eixos de gráfico.
 *
 * @param {number|string|null|undefined} valor
 * @returns {string}
 */
export function dinheiroCompacto(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(numero)) return '—';

  const abs = Math.abs(numero);
  const sinal = numero < 0 ? '\u2212' : '';

  if (abs >= 1_000_000) {
    const mi = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(abs / 1_000_000);
    return `${sinal}R$ ${mi} mi`;
  }

  if (abs >= 1_000) {
    const mil = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(abs / 1_000);
    return `${sinal}R$ ${mil} mil`;
  }

  return dinheiro(numero, { centavos: false });
}

function extrairPartesData(entrada) {
  if (!entrada) return null;
  if (entrada instanceof Date) {
    if (Number.isNaN(entrada.getTime())) return null;
    return {
      ano: entrada.getFullYear(),
      mes: entrada.getMonth() + 1,
      dia: entrada.getDate(),
    };
  }
  const texto = String(entrada).trim();
  const match = texto.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (match) {
    const ano = Number(match[1]);
    const mes = Number(match[2]);
    const dia = match[3] ? Number(match[3]) : 1;
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return { ano, mes, dia };
  }
  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) return null;
  return {
    ano: data.getFullYear(),
    mes: data.getMonth() + 1,
    dia: data.getDate(),
  };
}

/**
 * Formata uma data no padrão compacto `mmm/aa` (ex.: `set/26`).
 */
export function dataCompacta(data) {
  const partes = extrairPartesData(data);
  if (!partes) return '—';
  const mesTexto = MESES_CURTOS[partes.mes - 1];
  const anoTexto = String(partes.ano).slice(-2).padStart(2, '0');
  return `${mesTexto}/${anoTexto}`;
}

/**
 * Formata uma data no padrão completo `dd/mm/aaaa` (ex.: `30/09/2026`).
 */
export function dataCompleta(data) {
  const partes = extrairPartesData(data);
  if (!partes) return '—';
  const dia = String(partes.dia).padStart(2, '0');
  const mes = String(partes.mes).padStart(2, '0');
  return `${dia}/${mes}/${partes.ano}`;
}

/**
 * Extrai até duas iniciais para o avatar do usuário.
 */
export function iniciaisUsuario(nomeOuEmail) {
  if (!nomeOuEmail) return '?';
  const texto = String(nomeOuEmail).trim();
  if (!texto) return '?';
  const base = texto.includes('@') ? texto.split('@')[0].replace(/[._-]+/g, ' ') : texto;
  const partes = base.split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase();
}
