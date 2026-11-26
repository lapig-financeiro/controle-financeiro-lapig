// Marcação de números sem origem (contrato §1 e §6).
//
// A IA não escreve número com origem própria: todo valor de bloco vem de um
// nó. Quando um número aparece no texto livre e não é o valor de nenhum nó já
// citado em bloco ou `calcular`, ele volta em `semOrigem` para a tela marcar.
// Código de centro (30.109) e código de conta (7.1.3.99) não são números, e o
// mesmo vale para nome de centro da sessão ("GPW fase 2"), ano sozinho (2026)
// e data (15/12/2025, 12/2026, 2025-12-15, jan/2027). Valor em R$ sempre exige
// origem, inclusive "R$ 2026".

const MESES = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

function escaparRegex(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Texto comparável sem acento e em minúsculas, com o intervalo de origem de
 * cada unidade UTF-16. Serve só para achar nome de centro; a identidade nunca
 * depende dele.
 */
function normalizarBusca(valor) {
  const fonte = String(valor ?? '');
  let texto = '';
  const mapa = [];
  let deslocamento = 0;
  for (const caractere of Array.from(fonte)) {
    const inicio = deslocamento;
    const fim = inicio + caractere.length;
    deslocamento = fim;
    const base = caractere
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (base === '') {
      const ultimo = mapa[mapa.length - 1];
      if (ultimo) ultimo.fim = fim;
      continue;
    }
    texto += base;
    for (let unidade = 0; unidade < base.length; unidade += 1) mapa.push({ inicio, fim });
  }
  return { texto, mapa };
}

function perto(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) <= 0.005;
}

function valorNumerico(texto) {
  let limpo = String(texto)
    .replace(/−/g, '-')
    // "-R$ 1200" e "R$ -1200" são negativos; "-R$ -1200" não.
    .replace(/^(-?)R\$\s?(-?)/, (_, antes, depois) => (antes === depois ? '' : '-'))
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

  // Mês/ano sem dia (11/2026). Não casa com o `mm/aaaa` de `dd/mm/aaaa`:
  // não pode vir logo depois de dígito ou de outra barra, então o candidato
  // completo continua sendo o único da data inteira.
  // Não vale se vier percentual ou decimal colado ("11/2026%", "11/2026,5"):
  // aí o trecho não é data e o número tem de concorrer sozinho.
  for (const m of texto.matchAll(/(?<![\d/])(\d{2})\/(\d{4})\b(?!\s*%|[.,]\d)/g)) {
    const mes = Number(m[1]);
    const ano = Number(m[2]);
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) continue;
    if (!Number.isInteger(ano) || ano < 1900 || ano > 2999) continue;
    achados.push({
      inicio: m.index,
      fim: m.index + m[0].length,
      tipo: 'data',
      iso: null,
      anoMes: `${m[2]}-${m[1]}`,
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

  // O sinal colado antes de R$ ("-R$ 1200", "Desconto-R$ 1200") faz parte do
  // valor; depois de dígito ("1200-R$ 300") é subtração. Letra colada antes
  // de R$ ("TotalR$ 1200") não impede ler moeda.
  for (const m of texto.matchAll(/(?:(?<!\d)[-−])?R\$\s?[-−]?\d+(?:\.\d{3})*(?:[.,]\d{1,2})?/g)) {
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

function intervalosProibidos(texto, datas = []) {
  const intervalos = [];
  // Data não é número a conferir: nem a data inteira nem os dígitos internos
  // entram em `semOrigem`. Os intervalos vêm dos candidatos de data já
  // reconhecidos por `coletarCandidatos`.
  for (const data of datas) {
    intervalos.push({ inicio: data.inicio, fim: data.fim });
  }
  for (const m of texto.matchAll(/⟦P\d+⟧/g)) {
    intervalos.push({ inicio: m.index, fim: m.index + m[0].length });
  }
  // Código de centro (30.109/78.116) não é número... a menos que venha com R$:
  // aí é moeda, e o candidato de moeda tem de prevalecer.
  // Só o código inteiro: "30.109,50" e "1.030.109" são números.
  for (const m of texto.matchAll(/(?<![\d.,])\b(?:30|78)\.\d{3}\b(?![.,]\d)/g)) {
    const antes = texto.slice(Math.max(0, m.index - 6), m.index);
    if (/(?:R\$\s*[+\-−]?|[+\-−])\s*$/.test(antes)) continue;
    intervalos.push({ inicio: m.index, fim: m.index + m[0].length });
  }
  // Código de conta contábil (7.1.3.99) também não é número.
  for (const m of texto.matchAll(/\b\d{1,2}(?:\.\d{1,2}){2,}\b/g)) {
    intervalos.push({ inicio: m.index, fim: m.index + m[0].length });
  }
  // Ano sozinho ("2026", "março de 2027") não é número a conferir. Valor em R$
  // continua exigindo origem ("R$ 2026"), e "2026%" / "2026,5" / "2026.5" não
  // são ano: o número tem de concorrer sozinho.
  for (const m of texto.matchAll(/(?<![0-9A-Za-zÀ-ÖØ-öø-ÿ])(?:19\d{2}|20\d{2})\b/g)) {
    if (/^\s*%/.test(texto.slice(m.index + m[0].length))) continue;
    if (/^[.,]\d/.test(texto.slice(m.index + m[0].length))) continue;
    const antes = texto.slice(Math.max(0, m.index - 6), m.index);
    if (/(?:R\$\s*[+\-−]?|[+\-−])\s*$/.test(antes)) continue;
    intervalos.push({ inicio: m.index, fim: m.index + m[0].length });
  }
  return intervalos;
}

/** Nome de centro listado na sessão não tem número a conferir. */
function intervalosDeNomes(texto, nomesCentros) {
  if (!Array.isArray(nomesCentros) || nomesCentros.length === 0) return [];
  const alvo = normalizarBusca(texto);
  if (alvo.texto === '') return [];
  const intervalos = [];
  for (const nome of nomesCentros) {
    if (typeof nome !== 'string') continue;
    const chave = normalizarBusca(nome).texto.trim();
    if (chave === '') continue;
    if (!alvo.texto.includes(chave)) continue;
    const padrao = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${escaparRegex(chave)})(?=$|[^\\p{L}\\p{N}])`,
      'gu'
    );
    for (let achado = padrao.exec(alvo.texto); achado; achado = padrao.exec(alvo.texto)) {
      const inicio = achado.index + achado[1].length;
      const fim = inicio + achado[2].length;
      intervalos.push({ inicio: alvo.mapa[inicio].inicio, fim: alvo.mapa[fim - 1].fim });
      padrao.lastIndex = inicio + 1;
    }
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
 * `citados` é a lista de nós já usados em bloco ou em `calcular`;
 * `nomesCentros` são os nomes dos centros listados na sessão.
 */
export function marcarNumeros(texto, citados = [], { nomesCentros = [] } = {}) {
  if (typeof texto !== 'string' || texto === '') return [];
  const candidatos = coletarCandidatos(texto).sort((a, b) => {
    if (a.inicio !== b.inicio) return a.inicio - b.inicio;
    return b.fim - b.inicio - (a.fim - a.inicio);
  });
  const proibidos = [
    ...intervalosProibidos(texto, candidatos.filter((candidato) => candidato.tipo === 'data')),
    ...intervalosDeNomes(texto, nomesCentros),
  ];

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
export function marcarTexto(texto, { mascara, citados = [], nomesCentros = [] } = {}) {
  const limpo = mascara ? mascara.texto(texto) : texto;
  return { texto: limpo, semOrigem: marcarNumeros(limpo, citados, { nomesCentros }) };
}
