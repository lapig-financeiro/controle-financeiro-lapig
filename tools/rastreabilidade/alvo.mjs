/* ============================================================
   alvo.mjs
   Monta o `alvo` que o `acharAlvo` entende (o mesmo formato que a
   064 usa em `busca` para o legado) e escolhe a linha que vira fato.

   Regra da F2-B (correção 7): a linha só vira fato se contiver o
   valor formatado E o código da conta (lançamento) ou o texto
   (rubrica/parcela/cabeçalho). Mais de uma linha assim = ambíguo.

   As funções puras daqui são as que os testes travam; nada fala com
   o banco nem com o pdf.js.
   ============================================================ */

import { acharAlvo, formatarValor } from '../../frontend/js/origem-busca.js';

const TEXTOS_CABECALHO = {
  saldo_disponivel: 'saldo disponivel',
  rendimento_liquido: 'rendimento liquido',
  total_debitos: 'total de debitos',
  total_creditos: 'total de creditos',
};

export const CAMPOS_BALANCETE = Object.keys(TEXTOS_CABECALHO);

function normalizarEspacos(valor) {
  return String(valor == null ? '' : valor)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

/** 1234.5 → "1.234,50"; -1234.5 → "(1.234,50)". */
function formasDoValor(valor) {
  const absoluto = formatarValor(Math.abs(valor));
  if (valor < 0) return [`(${absoluto})`, `-${absoluto}`];
  return [absoluto];
}

/** Cópia da fronteira de valor de origem-busca.js. */
function regexDoValor(forma) {
  return new RegExp(
    `(?:^|[^\\d.,-])${escaparRegex(forma)}(?![\\d,])(?!\\.\\d)`,
  );
}

/** O valor formatado aparece como número inteiro dentro da linha? */
export function valorNaLinha(texto, valor) {
  const numero = paraNumero(valor);
  if (numero == null || numero === 0) return false;
  return formasDoValor(numero).some((forma) => regexDoValor(forma).test(String(texto)));
}

// Número monetário como o documento imprime: "1.234,56", "(1.234,56)",
// "-1.234,56" ou "380,00". Sem milhar também vale ("800,00").
const RE_NUMERO_DOCUMENTO = /\(?-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\)?/g;

/** Números monetários do texto, já convertidos para número. */
export function valoresDoTrecho(texto) {
  const t = String(texto == null ? '' : texto);
  const valores = [];

  for (const achado of t.matchAll(RE_NUMERO_DOCUMENTO)) {
    const bruto = achado[0];
    const negativo = (bruto.startsWith('(') && bruto.endsWith(')')) || bruto.startsWith('-');
    const numero = Number(
      bruto.replace(/[()\-]/g, '').replace(/\./g, '').replace(',', '.'),
    );
    if (Number.isFinite(numero)) valores.push(negativo ? -numero : numero);
  }

  return valores;
}

/**
 * Pré-validação da correção 7 da 2ª rodada: lê o valor do TRECHO
 * (parsing do número como está escrito na linha, não do valor do
 * banco) e devolve o número correspondente, ou null quando o trecho
 * não traz esse valor formatado.
 */
export function valorLidoDoTrecho(texto, valor) {
  const numero = paraNumero(valor);
  if (numero == null) return null;
  return valoresDoTrecho(texto).find((lido) => Math.abs(lido - numero) < 0.005) ?? null;
}

/** Cópia da regra de código inteiro de origem-busca.js. */
function regexDoCodigo(codigo) {
  const partes = normalizarEspacos(codigo)
    .split('.')
    .map((parte) => parte.trim())
    .filter(Boolean);
  if (!partes.length) return null;
  const corpo = partes.map(escaparRegex).join('\\s*\\.\\s*');
  return new RegExp(`(?:^|[^\\d.])${corpo}(?![.\\d])`);
}

function regexDoPrefixo(prefixo) {
  const partes = normalizarEspacos(prefixo)
    .split('.')
    .map((parte) => parte.trim())
    .filter(Boolean);
  if (!partes.length) return null;
  return new RegExp(`^${partes.map(escaparRegex).join('\\s*\\.\\s*')}`);
}

function temPalavra(texto, palavra) {
  return normalizarEspacos(texto).split(' ').includes(palavra);
}

/** O código da conta aparece na linha? Aceita `<prefixo>#<reduzido>`. */
export function contaNaLinha(texto, contaCodigo) {
  const conta = normalizarEspacos(contaCodigo);
  if (!conta) return false;
  if (conta.includes('#')) {
    const [prefixoBruto, reduzidoBruto] = conta.split('#');
    const prefixo = normalizarEspacos(prefixoBruto);
    const reduzido = normalizarEspacos(reduzidoBruto);
    const regexPrefixo = regexDoPrefixo(prefixo);
    if (!regexPrefixo || !reduzido) return false;
    return regexPrefixo.test(String(texto)) && temPalavra(texto, reduzido);
  }
  const regex = regexDoCodigo(conta);
  return Boolean(regex && regex.test(String(texto)));
}

/** O texto (sem acento/caixa) aparece na linha? */
export function textoNaLinha(texto, termo) {
  const alvo = normalizarTexto(termo);
  if (!alvo) return false;
  return normalizarTexto(texto).includes(alvo);
}

/**
 * A linha satisfaz o alvo? Precisa do valor formatado e do código
 * (lançamento) ou do texto (rubrica/parcela/cabeçalho).
 */
export function linhaServe(texto, alvo) {
  if (!alvo || typeof alvo !== 'object') return false;
  if (!valorNaLinha(texto, alvo.valor)) return false;
  if (alvo.conta_codigo) return contaNaLinha(texto, alvo.conta_codigo);
  return textoNaLinha(texto, alvo.texto);
}

// ── Alvos por tipo de número ───────────────────────────────

export function alvoDoCabecalho(campo, valor) {
  const texto = TEXTOS_CABECALHO[campo];
  if (!texto) throw new Error(`Campo de cabeçalho desconhecido: ${campo}`);
  return { texto, valor };
}

export function alvoDoLancamento(lancamento) {
  return {
    conta_codigo: lancamento.conta_codigo,
    valor: lancamento.saldo_atual,
  };
}

export function alvoDoTotalPlano(valor) {
  return { texto: 'valor total', valor };
}

/** A descrição livre, sem as aspas/espaços que o banco às vezes guarda. */
export function descricaoLivreDaRubrica(rubrica) {
  return String(rubrica && rubrica.descricao_livre != null ? rubrica.descricao_livre : '')
    .replace(/^[ \t\n\r"]+|[ \t\n\r"]+$/g, '');
}

/** Espelha o `texto` de `_resolver_origem_alvo` para plano_rubricas. */
export function alvoDaRubrica(rubrica, nomeRubrica) {
  const descricao = descricaoLivreDaRubrica(rubrica);
  return {
    texto: descricao || normalizarEspacos(nomeRubrica) || normalizarEspacos(rubrica && rubrica.rubrica_code),
    valor: rubrica && rubrica.valor_previsto,
  };
}

/**
 * Nomes que os planos usam para a mesma rubrica do catálogo (4ª rodada).
 * Só as três medidas; qualquer outra continua sem sinônimo.
 */
export const SINONIMOS_RUBRICA = {
  cip_ufg: ['Custos indiretos para a UFG'],
  cip_ua: ['Custos indiretos para a UA/Órgão'],
  dao: ['D.A.O da Fundação'],
};

/**
 * Alvos alternativos da rubrica: só quando não há `descricao_livre` e o
 * `rubrica_code` tem sinônimo fixo. A execução tenta o nome do catálogo
 * primeiro; estes entram na ordem, só se ele não achar linha.
 */
export function alvosAlternativosDaRubrica(rubrica, sinonimos = SINONIMOS_RUBRICA) {
  if (!rubrica || descricaoLivreDaRubrica(rubrica)) return [];
  const code = normalizarEspacos(rubrica.rubrica_code);
  if (!Array.isArray(sinonimos[code])) return [];
  const valor = rubrica.valor_previsto;
  return sinonimos[code]
    .map((texto) => normalizarEspacos(texto))
    .filter(Boolean)
    .map((texto) => ({ texto, valor }));
}

/**
 * Conta no formato cortado que o `acharAlvo` entende: `"<prefixo>#<reduzido>"`,
 * com o prefixo nos cinco primeiros segmentos do código. Sem cinco
 * segmentos (ou com `#` no código), não há alternativa.
 */
export function contaComReduzido(contaCodigo, reduzido) {
  const conta = normalizarEspacos(contaCodigo);
  const red = normalizarEspacos(reduzido);
  if (!conta || !red || conta.includes('#')) return null;
  const partes = conta.split('.').map((parte) => parte.trim()).filter(Boolean);
  if (partes.length < 5) return null;
  return `${partes.slice(0, 5).join('.')}#${red}`;
}

export function alvoDoDesembolso(desembolso) {
  return {
    texto: `Parcela ${desembolso && desembolso.parcela}`,
    valor: desembolso && desembolso.valor,
  };
}

// ── Escolha da linha ───────────────────────────────────────

function arredondar(valor) {
  return Math.round(Number(valor) * 100) / 100;
}

/**
 * Corta em 500 caracteres reais (code points), como o `char_length` da
 * RPC conta; `slice` cortaria unidades UTF-16 e poderia partir um par
 * substituto ao meio.
 */
export function cortarTrecho(texto) {
  return Array.from(String(texto == null ? '' : texto)).slice(0, 500).join('');
}

/** Só as quatro chaves de `linhasDaPagina`, em ordem válida. */
export function bboxDaLinha(linha) {
  if (!linha) return null;
  const numeros = [linha.x0, linha.x1, linha.yMin, linha.yMax].map(Number);
  if (!numeros.every((n) => Number.isFinite(n))) return null;
  const [xa, xb, ya, yb] = numeros;
  return {
    x0: arredondar(Math.min(xa, xb)),
    x1: arredondar(Math.max(xa, xb)),
    yMin: arredondar(Math.min(ya, yb)),
    yMax: arredondar(Math.max(ya, yb)),
  };
}

/**
 * Chama `acharAlvo` uma vez e devolve:
 *   { status: 'achado', pagina, linha, motivo, trecho, linhaObj }
 *   { status: 'nao_achado', candidatos }
 *   { status: 'ambiguo', candidatos: [{pagina,linha}] }
 *   { status: 'corte', pagina, linha }
 *   { status: 'zero' } | { status: 'sem_valor' }
 *
 * `paginas` é [[linhas], ...] como em origem-busca.js; no DOCX é uma
 * página só.
 */
export function escolherLinha(paginas, alvo) {
  const valor = paraNumero(alvo && alvo.valor);
  if (valor == null) return { status: 'sem_valor' };
  if (valor === 0) return { status: 'zero' };

  const alvoNormalizado = { ...alvo, valor };
  const candidatos = acharAlvo(paginas, alvoNormalizado);
  const validos = [];

  for (const candidato of candidatos) {
    const pagina = paginas[candidato.pagina - 1];
    const linha = pagina && pagina[candidato.linha];
    if (!linha || typeof linha.texto !== 'string') continue;
    if (!linhaServe(linha.texto, alvoNormalizado)) continue;
    if (validos.some((v) => v.pagina === candidato.pagina && v.linha === candidato.linha)) continue;
    validos.push({ ...candidato, linhaObj: linha });
  }

  if (validos.length === 0) {
    return { status: 'nao_achado', candidatos: candidatos.length };
  }
  if (validos.length > 1) {
    return {
      status: 'ambiguo',
      candidatos: validos.map((v) => ({ pagina: v.pagina, linha: v.linha })),
    };
  }

  const escolhido = validos[0];
  const trecho = cortarTrecho(escolhido.linhaObj.texto);
  if (!linhaServe(trecho, alvoNormalizado)) {
    return { status: 'corte', pagina: escolhido.pagina, linha: escolhido.linha };
  }

  return {
    status: 'achado',
    pagina: escolhido.pagina,
    linha: escolhido.linha,
    motivo: escolhido.motivo,
    trecho,
    linhaObj: escolhido.linhaObj,
  };
}

/**
 * Tenta o alvo principal e, SÓ quando ele não acha nenhuma linha
 * (`nao_achado`), os alternativos na ordem. Ambiguidade do principal
 * não é contornada pela alternativa: continua sem fato.
 *
 * Devolve { selecao, alternativa }, com `alternativa` = índice do alvo
 * alternativo usado (null quando o principal decidiu).
 */
export function escolherLinhaComAlternativas(paginas, alvo, alternativas = []) {
  const principal = escolherLinha(paginas, alvo);
  const lista = Array.isArray(alternativas) ? alternativas : [];
  if (principal.status !== 'nao_achado' || !lista.length) {
    return { selecao: principal, alternativa: null };
  }

  for (let indice = 0; indice < lista.length; indice += 1) {
    const selecao = escolherLinha(paginas, lista[indice]);
    if (selecao.status !== 'nao_achado') return { selecao, alternativa: indice };
  }

  return { selecao: principal, alternativa: null };
}

/**
 * Monta o fato no contrato da 064. Em DOCX, `pagina` e `bbox` são
 * nulos; em PDF, `bbox` sai só com as quatro chaves de `linhasDaPagina`.
 */
export function montarFato({ alvoTabela, alvoId, campo, valor, formato, selecao }) {
  if (!selecao || selecao.status !== 'achado') return null;
  const numero = paraNumero(valor);
  if (numero == null) return null;

  const fato = {
    alvo_tabela: alvoTabela,
    alvo_id: alvoId,
    campo,
    valor: Number(numero.toFixed(2)),
    pagina: null,
    trecho: selecao.trecho,
    bbox: null,
  };

  if (formato === 'pdf') {
    fato.pagina = selecao.pagina;
    fato.bbox = bboxDaLinha(selecao.linhaObj);
  }

  return fato;
}
