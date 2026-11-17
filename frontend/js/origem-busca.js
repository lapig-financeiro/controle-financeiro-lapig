/* ============================================================
   origem-busca.js
   "De onde vem este valor?" — encontra, no texto de um documento,
   a linha que originou um número do plano de trabalho.

   Quem confere não lê código: o componente origem-documento.js
   abre o PDF/DOCX e destaca a linha. Este arquivo faz só a parte
   que dá para testar no Node — nada de DOM, nada de pdf.js.

   As coordenadas (x0, x1, yMin, yMax) que saem de `linhasDaPagina`
   estão no espaço do PDF, que é o que o pdf.js devolve em
   `item.transform`; o componente converte para a tela com
   `pdfjsLib.Util.transform(viewport.transform, …)`.

   Cuidados que os testes travam, porque errar aqui dá falso
   positivo com cara de certeza:
   • o código da conta casa como PALAVRA inteira: "7.1.3.05.01"
     não pode casar dentro de "7.1.3.05.01.00027";
   • "345,00" não pode casar dentro de "1.345,00";
   • conta cortada pelo PDF vem no formato "<prefixo>#<reduzido>"
     (ver frontend/js/parsers/balancete-parser.js, linha ~258) e
     precisa do prefixo no começo da linha E do reduzido inteiro.
   ============================================================ */

// Mesma folga de pdf-texto.js: o pdf.js muda o Y em alguns
// centésimos entre itens da mesma linha visual.
const TOLERANCIA_LINHA = 2;

// Quando o item não informa `height`, usa a altura de um corpo
// pequeno para a faixa de destaque não nascer com zero de altura.
const ALTURA_MINIMA = 8;

// ── Texto ──────────────────────────────────────────────────

/** Espaços repetidos viram um; as pontas somem. */
function normalizarEspacos(valor) {
  return String(valor == null ? '' : valor)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Forma usada para comparar texto: sem acento e sem caixa.
 * "SERVIÇOS" e "servicos" têm de dar na mesma.
 */
function normalizarTexto(valor) {
  return normalizarEspacos(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function paraNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;
  const texto = valor.trim().replace(/\s/g, '');
  if (!texto) return null;
  const numero = Number(
    texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto,
  );
  return Number.isFinite(numero) ? numero : null;
}

// ── Linhas da página ───────────────────────────────────────

/**
 * Agrupa os itens de `page.getTextContent().items` em linhas.
 *
 * A regra de quebra é a MESMA de `textoDaPagina` (pdf-texto.js):
 * nova linha quando o Y muda mais de 2 pontos, na ordem em que os
 * itens vêm. O texto é normalizado (espaço simples, sem pontas)
 * porque o parser do balancete também normaliza antes de casar.
 *
 * Devolve [{ texto, itens: [índices], x0, x1, yMin, yMax }].
 * yMin é a menor base e yMax o topo (base + altura), em
 * coordenadas do PDF — lá o Y cresce para cima.
 */
export function linhasDaPagina(items) {
  const lista = Array.isArray(items) ? items : [];
  const linhas = [];
  let atual = null;
  let ultimoY = null;

  lista.forEach((item, indice) => {
    const transform = Array.isArray(item && item.transform) ? item.transform : [];
    const x = transform[4];
    const y = transform[5];

    // NaN/undefined não quebra linha — igual ao textoDaPagina, em
    // que `Math.abs(undefined - lastY) > 2` é falso.
    const mudaDeLinha = ultimoY !== null && Math.abs(y - ultimoY) > TOLERANCIA_LINHA;

    if (!atual || mudaDeLinha) {
      atual = {
        partes: [],
        itens: [],
        x0: Infinity,
        x1: -Infinity,
        yMin: Infinity,
        yMax: -Infinity,
        alturaMax: 0,
      };
      linhas.push(atual);
    }

    atual.itens.push(indice);
    atual.partes.push(typeof (item && item.str) === 'string' ? item.str : '');

    const largura = Number.isFinite(item && item.width) ? Math.abs(item.width) : 0;
    // Item com altura 0 (célula vazia, espaço) não diz nada sobre a altura da letra: só os
    // que têm altura entram. Sem nenhum, usa ALTURA_MINIMA no fim.
    const altura = Number.isFinite(item && item.height) ? Math.abs(item.height) : 0;

    if (Number.isFinite(x)) {
      atual.x0 = Math.min(atual.x0, x);
      atual.x1 = Math.max(atual.x1, x + largura);
    }
    if (Number.isFinite(y)) {
      atual.yMin = Math.min(atual.yMin, y);
      atual.yMax = Math.max(atual.yMax, y);
      atual.alturaMax = Math.max(atual.alturaMax, altura);
    }

    ultimoY = y;
  });

  // yMin desce 20% da altura abaixo da base (letras como "p", "ç"); yMax é a base mais alta
  // mais a altura da letra. Antes, células de altura 0 entravam com ALTURA_MINIMA e a faixa
  // subia para a linha de cima (visto num balancete real da FUNAPE em 17/11/2026).
  return linhas.map((linha) => {
    const alt = linha.alturaMax || ALTURA_MINIMA;
    const temY = Number.isFinite(linha.yMin);
    return {
      texto: normalizarEspacos(linha.partes.join(' ')),
      itens: linha.itens,
      x0: Number.isFinite(linha.x0) ? linha.x0 : 0,
      x1: Number.isFinite(linha.x1) ? linha.x1 : 0,
      yMin: temY ? linha.yMin - 0.2 * alt : 0,
      yMax: temY ? linha.yMax + alt : 0,
    };
  });
}

// ── Valor ──────────────────────────────────────────────────

/**
 * 1234.5 → "1.234,50"; -1234.5 → "(1.234,50)".
 * É a forma como o balancete da FUNAPE imprime valores.
 */
export function formatarValor(n) {
  const numero = paraNumero(n);
  if (numero == null) return '';
  const absoluto = Math.abs(numero);
  const texto = absoluto.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return numero < 0 ? `(${texto})` : texto;
}

/** Formas aceitas no documento para o mesmo valor. */
function formasDoValor(n) {
  const absoluto = formatarValor(Math.abs(n));
  if (n < 0) return [`(${absoluto})`, `-${absoluto}`];
  return [absoluto];
}

/**
 * Regex de um valor com limites de palavra numérica.
 *
 * Antes: dígito, ponto ou vírgula barram o casamento — é o que
 * impede "345,00" de casar dentro de "1.345,00".
 * Depois: dígito e vírgula sempre barram; ponto só barra quando
 * seguido de dígito. Assim "R$ 1.107.372,93." (o rodapé do
 * balancete fecha a frase com ponto) continua casando.
 */
function regexDoValor(forma) {
  return new RegExp(
    `(?:^|[^\\d.,-])${escaparRegex(forma)}(?![\\d,])(?!\\.\\d)`,
  );
}

// ── Código da conta ────────────────────────────────────────

/**
 * Código inteiro como palavra: "7.1.3.05.01" não casa dentro de
 * "7.1.3.05.01.00027". Aceita espaço em volta dos pontos porque o
 * extrator às vezes quebra o código em itens separados.
 */
function regexDoCodigo(codigo) {
  const partes = normalizarEspacos(codigo)
    .split('.')
    .map((parte) => parte.trim())
    .filter(Boolean);
  if (!partes.length) return null;
  const corpo = partes.map(escaparRegex).join('\\s*\\.\\s*');
  return new RegExp(`(?:^|[^\\d.])${corpo}(?![.\\d])`);
}

/**
 * Prefixo da conta cortada, ancorado no começo da linha. Aceita
 * espaço em volta dos pontos pela mesma razão do código inteiro.
 * Não leva lookahead: o prefixo é justamente o pedaço que o PDF
 * cortou, e a linha continua com os dígitos que faltam.
 */
function regexDoPrefixo(prefixo) {
  const partes = normalizarEspacos(prefixo)
    .split('.')
    .map((parte) => parte.trim())
    .filter(Boolean);
  if (!partes.length) return null;
  return new RegExp(`^${partes.map(escaparRegex).join('\\s*\\.\\s*')}`);
}

/** O reduzido precisa ser um token inteiro da linha. */
function temPalavra(texto, palavra) {
  return normalizarEspacos(texto).split(' ').includes(palavra);
}

// ── Busca ──────────────────────────────────────────────────

function varrer(paginas, fn) {
  paginas.forEach((linhas, indicePagina) => {
    if (!Array.isArray(linhas)) return;
    linhas.forEach((linha, indiceLinha) => {
      if (!linha || typeof linha.texto !== 'string') return;
      fn(linha, indicePagina + 1, indiceLinha);
    });
  });
}

/**
 * Procura o alvo nas páginas, na ordem das regras, e para na
 * primeira que achar alguma coisa:
 *
 *   1. conta_codigo sem "#" → código como palavra inteira;
 *   2. conta_codigo com "#" → prefixo no começo da linha + reduzido;
 *   3. valor → linhas com o valor formatado (se houver `texto`,
 *      prefere as que também o contêm);
 *   4. só texto → linhas que contêm o texto, sem acento/caixa.
 *
 * Devolve a lista ordenada [{ pagina (1-based), linha (índice), motivo }].
 * Lista vazia quer dizer "não achei no documento" — não é erro.
 */
export function acharAlvo(paginas, alvo) {
  const lista = Array.isArray(paginas) ? paginas : [];
  const alvoSeguro = alvo && typeof alvo === 'object' ? alvo : {};
  const conta = typeof alvoSeguro.conta_codigo === 'string'
    ? alvoSeguro.conta_codigo.trim()
    : '';

  // Regra 1 — código inteiro.
  if (conta && !conta.includes('#')) {
    const regex = regexDoCodigo(conta);
    const achadas = [];
    if (regex) {
      varrer(lista, (linha, pagina, indice) => {
        if (regex.test(linha.texto)) {
          achadas.push({ pagina, linha: indice, motivo: 'codigo' });
        }
      });
    }
    if (achadas.length) return achadas;
  }

  // Regra 2 — conta com código cortado: "<prefixo>#<reduzido>".
  if (conta.includes('#')) {
    const [prefixoBruto, reduzidoBruto] = conta.split('#');
    const prefixo = normalizarEspacos(prefixoBruto);
    const reduzido = normalizarEspacos(reduzidoBruto);
    const regexPrefixo = regexDoPrefixo(prefixo);
    const achadas = [];
    if (regexPrefixo && reduzido) {
      varrer(lista, (linha, pagina, indice) => {
        if (!regexPrefixo.test(linha.texto)) return;
        if (!temPalavra(linha.texto, reduzido)) return;
        achadas.push({ pagina, linha: indice, motivo: 'reduzido' });
      });
    }
    if (achadas.length) return achadas;
  }

  // Regra 3 — valor.
  // Zero nunca é alvo: "0,00" aparece em quase toda linha do balancete e marcaria a página inteira.
  const valor = paraNumero(alvoSeguro.valor);
  if (valor != null && valor !== 0) {
    const regexes = formasDoValor(valor).map(regexDoValor);
    const achadas = [];
    varrer(lista, (linha, pagina, indice) => {
      if (regexes.some((regex) => regex.test(linha.texto))) {
        achadas.push({ pagina, linha: indice, motivo: 'valor' });
      }
    });
    if (achadas.length) {
      // Se o chamador mandou também um texto, as linhas que o
      // contêm são as certas (o valor pode repetir em várias).
      const texto = normalizarTexto(alvoSeguro.texto);
      if (texto) {
        const preferidas = achadas.filter(({ pagina, linha }) => {
          const linhaEncontrada = lista[pagina - 1] && lista[pagina - 1][linha];
          return linhaEncontrada
            && normalizarTexto(linhaEncontrada.texto).includes(texto);
        });
        if (preferidas.length) return preferidas;
      }
      return achadas;
    }
  }

  // Regra 4 — só texto.
  const texto = normalizarTexto(alvoSeguro.texto);
  if (texto) {
    const achadas = [];
    varrer(lista, (linha, pagina, indice) => {
      if (normalizarTexto(linha.texto).includes(texto)) {
        achadas.push({ pagina, linha: indice, motivo: 'texto' });
      }
    });
    if (achadas.length) return achadas;
  }

  return [];
}

// ── DOCX (HTML do mammoth) ─────────────────────────────────

// Para o mesmo termo, aceita as variantes acentuadas da letra.
// A classe já traz maiúsculas; o flag `i` cobre o resto.
const VARIANTES_ACENTO = {
  a: 'aáàâãä',
  c: 'cç',
  e: 'eéèêë',
  i: 'iíìîï',
  n: 'nñ',
  o: 'oóòôõö',
  u: 'uúùûü',
  y: 'yýÿ',
};

// O texto do mammoth chega escapado: "P&D" aparece como "P&amp;D".
// O termo vem do banco em texto puro, então cada caractere especial
// aceita a forma crua e a entidade.
const ENTIDADES_HTML = {
  '&': '(?:&amp;|&)',
  '<': '&lt;',
  '>': '(?:&gt;|>)',
  '"': '(?:&quot;|")',
  "'": "(?:&#39;|&apos;|')",
};

function classeDoCaractere(caractere) {
  const entidade = ENTIDADES_HTML[caractere];
  if (entidade) return entidade;
  const base = caractere
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const grupo = VARIANTES_ACENTO[base];
  if (!grupo) return escaparRegex(caractere);
  return `[${grupo}${grupo.toUpperCase()}]`;
}

/** Monta o padrão do termo, tolerante a acento/caixa e a espaços. */
function padraoDoTermo(termo) {
  const limpo = normalizarEspacos(termo);
  if (!limpo) return '';
  let padrao = '';
  for (const caractere of limpo) {
    if (caractere === ' ') {
      // O HTML do mammoth troca espaço por &nbsp; com frequência.
      padrao += '(?:\\s|&nbsp;)+';
    } else {
      padrao += classeDoCaractere(caractere);
    }
  }
  return padrao;
}

function regexDosTermos(termos) {
  const alternativas = termos
    // Maior primeiro: "MATERIAL DE CONSUMO" ganha de "MATERIAL".
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(padraoDoTermo)
    .filter(Boolean);
  return alternativas.length
    ? new RegExp(`(?:${alternativas.join('|')})`, 'gi')
    : null;
}

function ehValorMonetario(texto) {
  return /^\(?-?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}\)?$/.test(String(texto).trim());
}

/** Antes do valor: dígito, ponto, vírgula ou sinal colado não vale. */
function bordaEsquerdaDeValor(caractere) {
  return Boolean(caractere) && /[\d.,-]/.test(caractere);
}

/**
 * Depois do valor: dígito e vírgula barram sempre; ponto só barra
 * quando é separador de milhar de outro número (".123"). O ponto
 * final de frase ("R$ 1.107.372,93.") é aceito.
 */
function bordaDireitaDeValor(texto, fim) {
  const depois = texto[fim];
  if (!depois) return false;
  if (/\d/.test(depois)) return true;
  if (depois === ',') return true;
  if (depois === '.' && /\d/.test(texto[fim + 1] || '')) return true;
  return false;
}

function marcarSegmento(texto, regex) {
  let saida = '';
  let ultimo = 0;
  let total = 0;
  let achado;

  regex.lastIndex = 0;
  while ((achado = regex.exec(texto)) !== null) {
    const encontrado = achado[0];
    if (!encontrado) {
      regex.lastIndex += 1;
      continue;
    }

    const inicio = achado.index;
    const fim = inicio + encontrado.length;

    // Um valor monetário não pode ser pedaço de outro número nem
    // estar dentro de um atributo (isso o split de tags já evita).
    if (ehValorMonetario(encontrado)
        && (bordaEsquerdaDeValor(texto[inicio - 1])
          || bordaDireitaDeValor(texto, fim))) {
      regex.lastIndex = inicio + 1;
      continue;
    }

    saida += texto.slice(ultimo, inicio);
    saida += `<mark class="origem-mark">${encontrado}</mark>`;
    ultimo = fim;
    total += 1;
  }

  saida += texto.slice(ultimo);
  return { html: saida, total };
}

/**
 * Envolve cada ocorrência dos termos em <mark class="origem-mark">.
 *
 * Recebe o HTML do mammoth. Só os trechos de TEXTO são visitados:
 * o split por `<tag>` deixa os atributos e os nomes de tag de fora,
 * então um termo que também aparece em `href="…"` não é marcado.
 * O texto do documento já vem escapado pelo mammoth; aqui não se
 * injeta nada de fora — os termos só delimitam o que já existe.
 *
 * Devolve { html, total } (total = quantidade de marcas).
 */
export function marcarNoHtml(html, termos) {
  const entrada = typeof html === 'string' ? html : '';
  const lista = [...new Set(
    (Array.isArray(termos) ? termos : [])
      .map((termo) => normalizarEspacos(termo))
      .filter(Boolean),
  )];
  if (!entrada || !lista.length) return { html: entrada, total: 0 };

  const regex = regexDosTermos(lista);
  if (!regex) return { html: entrada, total: 0 };

  const partes = entrada.split(/(<[^>]*>)/);
  let total = 0;
  for (let i = 0; i < partes.length; i += 1) {
    if (i % 2 === 1 || !partes[i]) continue; // índice ímpar = tag
    const resultado = marcarSegmento(partes[i], regex);
    partes[i] = resultado.html;
    total += resultado.total;
  }

  return { html: partes.join(''), total };
}

// ── Browser bridge ─────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.OrigemBusca = {
    linhasDaPagina,
    formatarValor,
    acharAlvo,
    marcarNoHtml,
  };
}
