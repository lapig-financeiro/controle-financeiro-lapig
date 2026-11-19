/* ============================================================
   cpf.mjs
   Regra de CPF única (a mesma da migração 065) espelhada em JS.

   O backfill precisa decidir, ANTES de chamar a RPC, o que é CPF:
   um trecho com CPF derruba o documento inteiro na 064/065. Este
   módulo implementa a gramática acordada:

   - `contem_cpf` da 052 (11 dígitos, pontuados ou não, com DV);
   - OU um candidato 3-3-3-2 contíguo, com vãos de 0 a 6 caracteres
     que não sejam dígito nem letra (espaço, ponto, vírgula, traço,
     travessão, barra, NBSP, quebra de linha…), procurando a partir
     de cada posição de início possível e exigindo DV válido.

   `mascararCpf` e `cpfsDe` usam a MESMA gramática. `temCpfLargo064`
   existe só para a retentativa contra uma base ainda na 064 (a regra
   mais larga dela); não use no filtro normal.
   ============================================================ */

const RE_CPF_052 = /(?<![0-9])([0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2})(?![0-9])/g;

const MAX_VAO = 6;

function digitosDe(texto) {
  return String(texto == null ? '' : texto).replace(/\D/g, '');
}

/**
 * Dígito verificador da 052. 11 dígitos iguais não são CPF.
 * Recebe a string de 11 dígitos (sem pontuação).
 */
export function cpfValido(digitos) {
  const d = String(digitos == null ? '' : digitos);
  if (!/^[0-9]{11}$/.test(d)) return false;
  if (new Set(d.split('')).size === 1) return false;
  const n = d.split('').map(Number);
  const dv = (ate) => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += n[i] * (ate + 1 - i);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(9) === n[9] && dv(10) === n[10];
}

/** A regra da 052, sem normalização de separadores. */
export function contemCpf(texto) {
  const t = String(texto == null ? '' : texto);
  RE_CPF_052.lastIndex = 0;
  for (const achado of t.matchAll(RE_CPF_052)) {
    if (cpfValido(digitosDe(achado[1]))) return true;
  }
  return false;
}

function ehDigito(c) {
  return c >= '0' && c <= '9';
}

function ehLetra(c) {
  return typeof c === 'string' && /\p{L}/u.test(c);
}

function vaoOk(texto, inicio, fim) {
  if (fim > texto.length) return false;
  for (let i = inicio; i < fim; i += 1) {
    if (ehDigito(texto[i]) || ehLetra(texto[i])) return false;
  }
  return true;
}

function grupoDeDigitos(texto, inicio, quantidade) {
  if (inicio + quantidade > texto.length) return false;
  for (let i = inicio; i < inicio + quantidade; i += 1) {
    if (!ehDigito(texto[i])) return false;
  }
  return true;
}

function candidatosDaPosicao(texto, inicio) {
  const achados = [];
  if (!grupoDeDigitos(texto, inicio, 3)) return achados;

  for (let v1 = 0; v1 <= MAX_VAO; v1 += 1) {
    const j1 = inicio + 3 + v1;
    if (!vaoOk(texto, inicio + 3, j1) || !grupoDeDigitos(texto, j1, 3)) continue;

    for (let v2 = 0; v2 <= MAX_VAO; v2 += 1) {
      const j2 = j1 + 3 + v2;
      if (!vaoOk(texto, j1 + 3, j2) || !grupoDeDigitos(texto, j2, 3)) continue;

      for (let v3 = 0; v3 <= MAX_VAO; v3 += 1) {
        const j3 = j2 + 3 + v3;
        if (!vaoOk(texto, j2 + 3, j3) || !grupoDeDigitos(texto, j3, 2)) continue;

        const fim = j3 + 2;
        if (fim < texto.length && ehDigito(texto[fim])) continue;

        const digitos = texto.slice(inicio, inicio + 3)
          + texto.slice(j1, j1 + 3)
          + texto.slice(j2, j2 + 3)
          + texto.slice(j3, j3 + 2);
        if (cpfValido(digitos)) achados.push({ inicio, fim, digitos });
      }
    }
  }

  return achados;
}

/**
 * Candidatos 3-3-3-2 aceitos pela regra, com a posição no texto.
 * Procura a partir de cada posição, não só dos achados sem sobreposição.
 */
export function candidatosCpf(texto) {
  const t = String(texto == null ? '' : texto);
  const vistos = new Set();
  const achados = [];

  for (let inicio = 0; inicio < t.length; inicio += 1) {
    if (!ehDigito(t[inicio])) continue;
    if (inicio > 0 && ehDigito(t[inicio - 1])) continue;

    for (const candidato of candidatosDaPosicao(t, inicio)) {
      const chave = `${candidato.inicio}:${candidato.fim}:${candidato.digitos}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      achados.push(candidato);
    }
  }

  return achados;
}

/** Um texto tem CPF quando a 052 OU a gramática de candidatos acha um. */
export function temCpf(texto) {
  if (texto == null || texto === '') return false;
  return contemCpf(texto) || candidatosCpf(texto).length > 0;
}

/** Os 11 dígitos dos candidatos aceitos, na ordem, sem repetir. */
export function cpfsDe(texto) {
  const lista = [];
  for (const candidato of candidatosCpf(texto)) {
    if (!lista.includes(candidato.digitos)) lista.push(candidato.digitos);
  }
  return lista;
}

/**
 * Troca exatamente os candidatos aceitos (DV válido) por ***.***.***-**.
 * O fallback cobre qualquer CPF que só a regra da 052 reconheça — hoje
 * não existe caso, mas mantém a invariante temCpf(mascararCpf(x)) = false.
 */
export function mascararCpf(texto) {
  if (texto == null) return texto;
  let t = String(texto);

  const candidatos = candidatosCpf(t).sort((a, b) => b.inicio - a.inicio);
  for (const candidato of candidatos) {
    t = t.slice(0, candidato.inicio) + '***.***.***-**' + t.slice(candidato.fim);
  }

  if (temCpf(t)) {
    t = t.replace(RE_CPF_052, (achado) => (
      cpfValido(digitosDe(achado)) ? '***.***.***-**' : achado
    ));
  }

  return t;
}

/**
 * Regra mais larga da 064 — SÓ para a retentativa quando a RPC ainda
 * estiver na 064. A 065 substitui essa regra; em produção o backfill
 * roda depois da 065.
 */
export function temCpfLargo064(texto) {
  const t = String(texto == null ? '' : texto);
  if (contemCpf(t)) return true;

  const semSeparadores = t.replace(
    /(?<=[0-9])[ \t\n\r\u00A0._/\u2013\u2014-]+(?=[0-9])/g,
    '',
  );
  if (contemCpf(semSeparadores)) return true;

  const semAteTres = t.replace(/(?<=[0-9])[^0-9]{1,3}(?=[0-9])/g, '');
  return contemCpf(semAteTres);
}
