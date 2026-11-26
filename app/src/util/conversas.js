/* ============================================================
   Datas das conversas da Análise no fuso de Brasília
   ============================================================
   A regra "a última conversa foi hoje?" e os rótulos "hoje, 14h32",
   "ontem" e "25/11" são sempre no fuso `America/Sao_Paulo`, mesmo
   que o navegador esteja em outro. Nada aqui usa `style=` nem
   decide conteúdo: são funções puras, testáveis com data fixa.
   ============================================================ */

export const FUSO_BRASILIA = 'America/Sao_Paulo';

function partesBrasilia(data) {
  const valor = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(valor.getTime())) return null;
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO_BRASILIA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(valor)
    .reduce((mapa, parte) => {
      if (parte.type !== 'literal') mapa[parte.type] = parte.value;
      return mapa;
    }, {});
  return {
    dia: partes.day,
    mes: partes.month,
    ano: partes.year,
    hora: partes.hour,
    minuto: partes.minute,
  };
}

/** Dia civil de Brasília no formato `AAAA-MM-DD`, ou `null` se a data for inválida. */
export function diaBrasilia(data = new Date()) {
  const partes = partesBrasilia(data);
  return partes ? `${partes.ano}-${partes.mes}-${partes.dia}` : null;
}

export function mesmoDiaBrasilia(a, b = new Date()) {
  const primeiro = diaBrasilia(a);
  const segundo = diaBrasilia(b);
  return Boolean(primeiro && segundo && primeiro === segundo);
}

function diaAnterior(isoDia) {
  const [ano, mes, dia] = String(isoDia || '').split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (Number.isNaN(data.getTime())) return null;
  data.setUTCDate(data.getUTCDate() - 1);
  return data.toISOString().slice(0, 10);
}

/**
 * Rótulo curto da lista de conversas:
 *   hoje, 14h32 · ontem · 25/11
 */
export function quandoConversa(data, agora = new Date()) {
  const partes = partesBrasilia(data);
  if (!partes) return '—';
  const hoje = diaBrasilia(agora);
  const dia = `${partes.ano}-${partes.mes}-${partes.dia}`;
  if (dia === hoje) return `hoje, ${partes.hora}h${partes.minuto}`;
  if (dia === diaAnterior(hoje)) return 'ontem';
  return `${partes.dia}/${partes.mes}`;
}

/**
 * Data completa de Brasília: `26/11/2026, às 14h32`.
 * Usada em "Respondida em …" e na nota de origem de turno antigo.
 */
export function dataHoraBrasilia(data) {
  const partes = partesBrasilia(data);
  if (!partes) return '—';
  return `${partes.dia}/${partes.mes}/${partes.ano}, às ${partes.hora}h${partes.minuto}`;
}

/** Só a data de Brasília: `26/11/2026`. */
export function dataBrasilia(data) {
  const partes = partesBrasilia(data);
  if (!partes) return '—';
  return `${partes.dia}/${partes.mes}/${partes.ano}`;
}

/** Só a data curta de Brasília: `25/11` (usada em "Sua última conversa foi em …"). */
export function dataCurtaBrasilia(data) {
  const partes = partesBrasilia(data);
  if (!partes) return '—';
  return `${partes.dia}/${partes.mes}`;
}
