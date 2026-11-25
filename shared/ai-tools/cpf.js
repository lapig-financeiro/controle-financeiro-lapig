// Regra de CPF única, alinhada a `_tem_cpf`/`_mascarar_cpf` da migração 065.
//
// Um texto tem CPF quando `contem_cpf` (052: 11 dígitos com pontos opcionais e
// hífen opcional, DV válido) OU quando há um candidato 3-3-3-2 com vãos de 0 a
// 6 caracteres que não são dígito nem letra e o DV dos 11 dígitos é válido.
// Assim CPF com espaço, ponto, hífen ou barra também é mascarado.

const GRUPOS = [3, 3, 3, 2];
const MAX_VAO = 6;

function ehDigito(caractere) {
  return /^[0-9]$/.test(caractere);
}

function ehLetra(caractere) {
  if (caractere.toUpperCase() !== caractere.toLowerCase()) return true;
  return /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(caractere);
}

/** DV de 11 dígitos, igual a `contem_cpf` da 052. */
export function cpfValido(digitos) {
  const d = String(digitos).replace(/[^0-9]/g, '').split('').map(Number);
  if (d.length !== 11) return false;
  if (d.every((numero) => numero === d[0])) return false;

  let soma = 0;
  for (let indice = 0; indice < 9; indice += 1) soma += d[indice] * (10 - indice);
  const dv1 = soma % 11 < 2 ? 0 : 11 - (soma % 11);

  soma = 0;
  for (let indice = 0; indice < 10; indice += 1) soma += d[indice] * (11 - indice);
  const dv2 = soma % 11 < 2 ? 0 : 11 - (soma % 11);

  return d[9] === dv1 && d[10] === dv2;
}

/** `contem_cpf` da 052: 11 dígitos, pontos opcionais e hífen opcional, DV. */
export function contemCpf(texto) {
  if (typeof texto !== 'string') return false;
  const padrao = /(^|[^0-9])(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?![0-9])/g;
  for (const achado of texto.matchAll(padrao)) {
    if (cpfValido(achado[2])) return true;
  }
  return false;
}

/**
 * Fim (índice exclusivo, 0-based) do candidato 3-3-3-2 que começa em `inicio`,
 * ou null. Só a forma; o DV é `cpfValido`.
 */
export function cpfCandidato(texto, inicio) {
  if (typeof texto !== 'string' || !Number.isInteger(inicio)) return null;
  if (inicio < 0 || inicio >= texto.length) return null;
  if (inicio > 0 && ehDigito(texto[inicio - 1])) return null;

  let posicao = inicio;
  for (let grupo = 0; grupo < GRUPOS.length; grupo += 1) {
    const tamanho = GRUPOS[grupo];
    const trecho = texto.slice(posicao, posicao + tamanho);
    if (!new RegExp(`^[0-9]{${tamanho}}$`).test(trecho)) return null;
    posicao += tamanho;

    if (grupo === GRUPOS.length - 1) break;

    let vao = 0;
    while (
      posicao < texto.length &&
      vao < MAX_VAO &&
      !ehDigito(texto[posicao]) &&
      !ehLetra(texto[posicao])
    ) {
      posicao += 1;
      vao += 1;
    }
    if (posicao >= texto.length || !ehDigito(texto[posicao])) return null;
  }

  if (posicao < texto.length && ehDigito(texto[posicao])) return null;
  return posicao;
}

/** `_tem_cpf` da 065 em JS. */
export function temCpf(texto) {
  if (typeof texto !== 'string' || texto === '') return false;
  if (contemCpf(texto)) return true;

  for (let inicio = 0; inicio <= texto.length - 11; inicio += 1) {
    if (!ehDigito(texto[inicio])) continue;
    const fim = cpfCandidato(texto, inicio);
    if (fim === null) continue;
    const digitos = texto.slice(inicio, fim).replace(/[^0-9]/g, '');
    if (cpfValido(digitos)) return true;
  }
  return false;
}

/** `_mascarar_cpf` da 065: troca o candidato inteiro por ***.***.***-**. */
export function mascararCpf(texto) {
  if (typeof texto !== 'string') return texto;
  let saida = '';
  let posicao = 0;
  while (posicao < texto.length) {
    if (ehDigito(texto[posicao])) {
      const fim = cpfCandidato(texto, posicao);
      if (fim !== null) {
        const digitos = texto.slice(posicao, fim).replace(/[^0-9]/g, '');
        if (cpfValido(digitos)) {
          saida += '***.***.***-**';
          posicao = fim;
          continue;
        }
      }
    }
    saida += texto[posicao];
    posicao += 1;
  }
  return saida;
}

/** Número inteiro de 11 dígitos nunca vira nó (pode ser CPF antigo). */
export function ehNumeroOnzeDigitos(valor) {
  if (typeof valor === 'number' && Number.isInteger(valor)) {
    return String(Math.abs(valor)).length === 11;
  }
  if (typeof valor === 'string') return /^\d{11}$/.test(valor.trim());
  return false;
}
