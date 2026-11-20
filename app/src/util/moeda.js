/**
 * Lê um valor em reais digitado em pt-BR.
 *
 * Regras:
 * - ponto seguido de exatamente 3 dígitos é separador de milhar (`4.500` = 4500);
 * - vírgula é o separador decimal (`4,50` = 4.5);
 * - sem vírgula, um ponto com 1 ou 2 dígitos também é decimal (`4.5` = 4.5);
 * - aceita `R$`, espaços (inclusive o espaço fino) e sinal de menos;
 * - vazio, texto solto ou combinação ambígua devolvem `null`.
 *
 * Não arredonda nem limita o valor; quem chama decide o que aceitar.
 *
 * @param {string|number|null|undefined} entrada
 * @returns {number|null}
 */
export function parseValorBR(entrada) {
  if (entrada === null || entrada === undefined) return null;
  let texto = String(entrada).replace(/\u00a0/g, ' ').trim();
  if (!texto) return null;

  texto = texto.replace(/R\$\s*/gi, '').trim();
  if (!texto) return null;

  let sinal = 1;
  if (/^[−-]/.test(texto)) {
    sinal = -1;
    texto = texto.slice(1).trim();
  } else if (texto.startsWith('+')) {
    texto = texto.slice(1).trim();
  }
  if (!texto || !/^[\d.,\s]+$/.test(texto)) return null;

  texto = texto.replace(/\s+/g, '');
  if (!/\d/.test(texto)) return null;

  let numero;
  if (texto.includes(',')) {
    const partes = texto.split(',');
    if (partes.length !== 2) return null;
    const [inteiroBruto, decimal] = partes;
    if (!decimal || !/^\d{1,2}$/.test(decimal)) return null;
    const inteiro = normalizarMilhar(inteiroBruto);
    if (inteiro === null) return null;
    numero = Number(`${inteiro}.${decimal}`);
  } else if (texto.includes('.')) {
    const partes = texto.split('.');
    if (partes.length < 2 || partes.some((parte) => !/^\d+$/.test(parte))) return null;

    const depoisDoPrimeiro = partes.slice(1);
    if (depoisDoPrimeiro.every((parte) => parte.length === 3)) {
      numero = Number(partes.join(''));
    } else if (partes.length === 2 && depoisDoPrimeiro[0].length <= 2) {
      numero = Number(`${partes[0]}.${partes[1]}`);
    } else {
      return null;
    }
  } else {
    if (!/^\d+$/.test(texto)) return null;
    numero = Number(texto);
  }

  if (!Number.isFinite(numero)) return null;
  return sinal * numero;
}

function normalizarMilhar(texto) {
  if (!texto) return null;
  const partes = texto.split('.');
  if (!partes.every((parte) => /^\d+$/.test(parte))) return null;
  if (partes.length === 1) return partes[0];
  if (partes[0].length < 1 || partes[0].length > 3) return null;
  if (!partes.slice(1).every((parte) => parte.length === 3)) return null;
  return partes.join('');
}
