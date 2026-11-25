// Marcação de números sem origem (contrato §1 e §6).
//
// A IA não escreve número com origem própria: todo valor de bloco vem de um
// nó. Quando um número aparece no texto livre e não é o valor de nenhum nó já
// citado em bloco ou `calcular`, ele volta em `semOrigem` para a tela marcar.
// Código de centro (30.109) e código de conta (7.1.3.99) não são números.

const MESES = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

function perto(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) <= 0.005;
}

function valorNumerico(texto) {
  let limpo = String(texto)
    .replace(/^R\$\s?/, '')
    .replace(/−/g, '-')
    .replace(/%$/, '')
    .trim();
  if (limpo.includes(',')) {
    // pt-BR: ponto é milhar, vírgula é decimal.
    limpo = limpo.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(limpo)) {
    // "1.234" e "1.234.567": ponto de milhar.
    limpo = limpo.replace(/\./g, '');
  }
  // "9.75" e "12.5": ponto decimal (o modelo às vezes escreve assim).
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : null;
}

function dataValida(ano, mes, dia) {
  const a = Number(ano);
  const m = Number(mes);
  const d = Number(dia);
  if (!Number.isInteger(a) || a < 1900 || a > 2999) return false;
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > 31) return false;
  return true;
}

/** Todas as ocorrências candidatas, de todos os formatos, com sobreposição. */
function coletarCandidatos(texto) {
  const achados = [];

  for (const m of texto.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)) {
    if (!dataValida(m[3], m[2], m[1])) continue;
    achados.push({
      inicio: m.index,
      fim: m.index + m[0].length,
      tipo: 'data',
      iso: `${m[3]}-${m[2]}-${m[1]}`,
      anoMes: `${m[3]}-${m[2]}`,
    });
  }

  for (const m of texto.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    if (!dataValida(m[1], m[2], m[3])) continue;
    achados.push({
      inicio: m.index,
      fim: m.index + m[0].length,
      tipo: 'data',
      iso: m[0],
      anoMes: `${m[1]}-${m[2]}`,
    });
  }

  for (const m of texto.matchAll(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/(\d{2,4})\b/gi)) {
    const mes = MESES[m[1].toLowerCase()];
    let ano = Number(m[2]);
    if (m[2].length === 2) ano += 2000;
    if (!mes || !Number.isInteger(ano)) continue;
    const mm = String(mes).padStart(2, '0');
    achados.push({
      inicio: m.index,
      fim: m.index + m[0].length,
      tipo: 'data',
      iso: null,
      anoMes: `${ano}-${mm}`,
    });
  }

  for (const m of texto.matchAll(/R\$\s?[-−]?\d{1,3}(?:\.\d{3})*(?:[.,]\d{1,2})?/g)) {
    const valor = valorNumerico(m[0]);
    if (valor === null) continue;
    achados.push({ inicio: m.index, fim: m.index + m[0].length, tipo: 'moeda', valor });
  }

  for (const m of texto.matchAll(/(?<![0-9A-Za-zÀ-ÖØ-öø-ÿ])[-−]?\d+(?:[.,]\d+)?\s?%/g)) {
    const valor = valorNumerico(m[0]);
    if (valor === null) continue;
    achados.push({ inicio: m.index, fim: m.index + m[0].length, tipo: 'percentual', valor });
  }

  for (const m of texto.matchAll(/(?<![0-9A-Za-zÀ-ÖØ-öø-ÿ])[-−]?\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g)) {
    const valor = valorNumerico(m[0]);
    if (valor === null) continue;
    achados.push({ inicio: m.index, fim: m.index + m[0].length, tipo: 'numero', valor });
  }

  for (const m of texto.matchAll(/(?<![0-9A-Za-zÀ-ÖØ-öø-ÿ])[-−]?\d+,\d+\b/g)) {
    const valor = valorNumerico(m[0]);
    if (valor === null) continue;
    achados.push({ inicio: m.index, fim: m.index + m[0].length, tipo: 'numero', valor });
  }

  for (const m of texto.matchAll(/(?<![0-9A-Za-zÀ-ÖØ-öø-ÿ])[-−]?\d+\.\d{1,2}\b/g)) {
    const valor = valorNumerico(m[0]);
    if (valor === null) continue;
    achados.push({ inicio: m.index, fim: m.index + m[0].length, tipo: 'numero', valor });
  }

  for (const m of texto.matchAll(/(?<![0-9A-Za-zÀ-ÖØ-öø-ÿ])[-−]?\d+\b/g)) {
    const valor = valorNumerico(m[0]);
    if (valor === null) continue;
    achados.push({ inicio: m.index, fim: m.index + m[0].length, tipo: 'numero', valor });
  }

  return achados;
}

function intervalosProibidos(texto) {
  const intervalos = [];
  for (const m of texto.matchAll(/⟦P\d+⟧/g)) {
    intervalos.push({ inicio: m.index, fim: m.index + m[0].length });
  }
  // Código de centro (30.109/78.116) não é número... a menos que venha com R$:
  // aí é moeda, e o candidato de moeda tem de prevalecer.
  for (const m of texto.matchAll(/\b(?:30|78)\.\d{3}\b/g)) {
    const antes = texto.slice(Math.max(0, m.index - 6), m.index);
    if (/R\$\s?[-−]?\s*$/.test(antes)) continue;
    intervalos.push({ inicio: m.index, fim: m.index + m[0].length });
  }
  // Código de conta contábil (7.1.3.99) também não é número.
  for (const m of texto.matchAll(/\b\d{1,2}(?:\.\d{1,2}){2,}\b/g)) {
    intervalos.push({ inicio: m.index, fim: m.index + m[0].length });
  }
  return intervalos;
}

function sobrepoe(inicio, fim, intervalos) {
  return intervalos.some((item) => inicio < item.fim && fim > item.inicio);
}

function citou(token, citados) {
  if (!Array.isArray(citados) || citados.length === 0) return false;
  if (token.tipo === 'data') {
    return citados.some((no) => {
      if (!no || no.unidade !== 'data') return false;
      const valor = String(no.valor ?? '').slice(0, 10);
      if (token.iso) return valor === token.iso;
      return Boolean(token.anoMes) && valor.slice(0, 7) === token.anoMes;
    });
  }
  if (token.tipo === 'percentual') {
    return citados.some((no) => no && no.unidade === 'percentual' && perto(no.valor, token.valor));
  }
  if (token.tipo === 'moeda') {
    return citados.some((no) => no && no.unidade === 'moeda' && perto(no.valor, token.valor));
  }
  return citados.some((no) => no && no.unidade === 'numero' && perto(no.valor, token.valor));
}

/**
 * Devolve os trechos de números do texto que não são valor de nó citado.
 * `citados` é a lista de nós já usados em bloco ou em `calcular`.
 */
export function marcarNumeros(texto, citados = []) {
  if (typeof texto !== 'string' || texto === '') return [];
  const proibidos = intervalosProibidos(texto);
  const candidatos = coletarCandidatos(texto).sort((a, b) => {
    if (a.inicio !== b.inicio) return a.inicio - b.inicio;
    return b.fim - b.inicio - (a.fim - a.inicio);
  });

  const escolhidos = [];
  for (const candidato of candidatos) {
    if (sobrepoe(candidato.inicio, candidato.fim, proibidos)) continue;
    if (sobrepoe(candidato.inicio, candidato.fim, escolhidos)) continue;
    escolhidos.push(candidato);
  }

  escolhidos.sort((a, b) => a.inicio - b.inicio);
  const semOrigem = [];
  for (const candidato of escolhidos) {
    if (!citou(candidato, citados)) {
      semOrigem.push({ inicio: candidato.inicio, fim: candidato.fim });
    }
  }
  return semOrigem;
}

/** Marca o texto já mascarado; devolve o texto e os intervalos sem origem. */
export function marcarTexto(texto, { mascara, citados = [] } = {}) {
  const limpo = mascara ? mascara.texto(texto) : texto;
  return { texto: limpo, semOrigem: marcarNumeros(limpo, citados) };
}
