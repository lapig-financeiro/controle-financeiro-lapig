// Checagens da bateria da Análise.
//
// `verificar` recebe os eventos SSE de uma pergunta e o `espera` do arquivo de
// perguntas. Além do que o `espera` pede, sempre confere o contrato: exatamente
// um `fim`, no máximo um `erro`, todo nó numérico de bloco com `origem`, nenhum
// nome sintético do retrato no corpo enviado ao modelo e texto final sem número
// marcado como sem origem.

const UNIDADES_COM_ORIGEM = new Set(['moeda', 'numero', 'percentual', 'data']);

function erroDeConfiguracao(mensagem) {
  return `configuração da pergunta: ${mensagem}`;
}

function blocosDe(eventos) {
  return eventos.filter((item) => item.evento === 'bloco' && item.dados).map((item) => item.dados);
}

function textoDe(eventos) {
  const textos = eventos.filter((item) => item.evento === 'texto' && item.dados);
  return textos.length ? textos[textos.length - 1].dados : null;
}

/** Todo `valor` numérico dentro do bloco, inclusive os das origens. */
export function valoresDoBloco(valor, saida = []) {
  if (Array.isArray(valor)) {
    for (const item of valor) valoresDoBloco(item, saida);
    return saida;
  }
  if (!valor || typeof valor !== 'object') return saida;

  for (const [chave, item] of Object.entries(valor)) {
    if (chave === 'valor') {
      if (typeof item === 'number' && Number.isFinite(item)) {
        saida.push(item);
      } else if (typeof item === 'string' && item.trim() !== '') {
        const numero = Number(item);
        if (Number.isFinite(numero)) saida.push(numero);
      }
    }
    if (item && typeof item === 'object') valoresDoBloco(item, saida);
  }
  return saida;
}

export function coletarValoresDosBlocos(eventos) {
  const valores = [];
  for (const bloco of blocosDe(eventos)) valoresDoBloco(bloco, valores);
  return valores;
}

function faltaOrigem(bloco, motivos) {
  const conferir = (no, onde) => {
    if (!no || typeof no !== 'object') return;
    if (UNIDADES_COM_ORIGEM.has(no.unidade) && !no.origem) {
      motivos.push(`bloco ${bloco.id ?? '?'} (${onde}): nó ${no.unidade} sem origem`);
    }
  };

  if (bloco.tipo === 'numero') {
    conferir(bloco.numero, 'numero');
    if (bloco.numero && bloco.numero.contexto) conferir(bloco.numero.contexto, 'contexto');
    return;
  }

  if (bloco.tipo === 'tabela') {
    const linhas = Array.isArray(bloco.tabela?.linhas) ? bloco.tabela.linhas : [];
    for (const [indiceLinha, linha] of linhas.entries()) {
      for (const [indiceColuna, celula] of (Array.isArray(linha) ? linha : []).entries()) {
        conferir(celula, `linha ${indiceLinha + 1}, coluna ${indiceColuna + 1}`);
      }
    }
  }
}

function verificarVazamento(contexto, motivos) {
  const nomes = Array.isArray(contexto.nomesSinteticos) ? contexto.nomesSinteticos : [];
  if (!nomes.length) return;

  const corpos = (Array.isArray(contexto.corposModelo) ? contexto.corposModelo : []).map(
    (corpo) => JSON.stringify(corpo),
  );

  for (const nome of nomes) {
    if (corpos.some((corpo) => corpo.includes(nome))) {
      motivos.push(`vazamento: nome sintético "${nome}" apareceu no corpo enviado ao modelo`);
    }
  }
}

function testarRegex(padrao, texto, motivos, rotulo) {
  let regex;
  try {
    regex = new RegExp(padrao);
  } catch {
    motivos.push(erroDeConfiguracao(`${rotulo} não é uma regex válida: ${padrao}`));
    return null;
  }
  return regex.test(texto);
}

function listaSemMarkdown(texto) {
  return texto
    .split(/\r?\n/)
    .filter((linha) => /^\s*(?:[-*]|\d+\.)\s+/.test(linha));
}

/**
 * @param {Array} eventos  eventos no formato de `lerEventos`
 * @param {object} espera
 * @param {object} contexto  `{ nomesSinteticos, corposModelo, ms }`
 * @returns {{ok: boolean, motivos: string[]}}
 */
export function verificar(eventos, espera = {}, contexto = {}) {
  const motivos = [];
  const lista = Array.isArray(eventos) ? eventos : [];

  const fins = lista.filter((item) => item.evento === 'fim');
  const erros = lista.filter((item) => item.evento === 'erro');

  if (fins.length !== 1) motivos.push(`esperava exatamente um "fim", vieram ${fins.length}`);
  if (erros.length > 1) motivos.push(`veio mais de um "erro" (${erros.length})`);

  for (const bloco of blocosDe(lista)) faltaOrigem(bloco, motivos);

  verificarVazamento(contexto, motivos);

  const texto = textoDe(lista);
  if (!texto && erros.length === 0) motivos.push('sem texto final');
  if (texto) {
    if (!Array.isArray(texto.semOrigem)) {
      motivos.push('texto final sem a lista "semOrigem"');
    } else if (texto.semOrigem.length > 0) {
      motivos.push(`texto final com ${texto.semOrigem.length} número(s) sem origem`);
    }
  }

  const erroEsperado = typeof espera.erro === 'string' ? espera.erro : null;
  if (erroEsperado) {
    if (!erros.some((item) => item.dados && item.dados.codigo === erroEsperado)) {
      const vieram = erros.map((item) => item.dados?.codigo ?? '?').join(', ') || 'nenhum';
      motivos.push(`esperava erro "${erroEsperado}", veio ${vieram}`);
    }
  } else if (espera.sem_erro !== false && erros.length > 0) {
    motivos.push(`erro inesperado: ${erros[0].dados?.codigo ?? '?'}`);
  }

  if (espera.numeros !== undefined) {
    if (!Array.isArray(espera.numeros)) {
      motivos.push(erroDeConfiguracao('"numeros" precisa ser uma lista'));
    } else {
      const valores = coletarValoresDosBlocos(lista);
      for (const esperado of espera.numeros) {
        const alvo = typeof esperado === 'number' ? esperado : Number(esperado);
        if (!Number.isFinite(alvo)) {
          motivos.push(erroDeConfiguracao(`número esperado inválido: ${esperado}`));
          continue;
        }
        const achou = valores.some((valor) => Math.abs(valor - alvo) <= 0.005);
        if (!achou) motivos.push(`número esperado ausente dos blocos: ${alvo}`);
      }
    }
  }

  if (espera.max_segundos !== undefined) {
    const limite = Number(espera.max_segundos);
    if (!Number.isFinite(limite) || limite <= 0) {
      motivos.push(erroDeConfiguracao('"max_segundos" precisa ser um número positivo'));
    } else if (Number(contexto.ms) > limite * 1000) {
      motivos.push(`passou de ${limite} s (levou ${(Number(contexto.ms) / 1000).toFixed(1)} s)`);
    }
  }

  if (espera.texto_contem !== undefined) {
    const padroes = Array.isArray(espera.texto_contem)
      ? espera.texto_contem
      : [espera.texto_contem];
    const alvo = texto?.texto ?? '';
    for (const padrao of padroes) {
      const achou = testarRegex(padrao, alvo, motivos, 'texto_contem');
      if (achou === false) motivos.push(`texto final não contém /${padrao}/`);
    }
  }

  if (espera.texto_nao_contem !== undefined) {
    const padroes = Array.isArray(espera.texto_nao_contem)
      ? espera.texto_nao_contem
      : [espera.texto_nao_contem];
    const alvo = texto?.texto ?? '';
    for (const padrao of padroes) {
      const achou = testarRegex(padrao, alvo, motivos, 'texto_nao_contem');
      if (achou === true) motivos.push(`texto final contém /${padrao}/ (não deveria)`);
    }
  }

  if (espera.sem_lista_markdown === true) {
    const linhas = listaSemMarkdown(texto?.texto ?? '');
    if (linhas.length) {
      motivos.push(`texto final tem lista markdown (${linhas.length} linha(s))`);
    }
  }

  return { ok: motivos.length === 0, motivos };
}

/** Falhas de ferramenta que a tela veria como passo de erro. */
export function falhasDeFerramenta(eventos) {
  return (Array.isArray(eventos) ? eventos : [])
    .filter((item) => item.evento === 'passo' && item.dados?.estado === 'erro')
    .map((item) => ({
      ferramenta: item.dados.ferramenta ?? '?',
      erro: item.dados.erro ?? '',
      ms: item.ms,
    }));
}

/** Ferramentas consultadas, na ordem da primeira chamada, sem repetir. */
export function ferramentasChamadas(eventos) {
  const nomes = [];
  for (const item of Array.isArray(eventos) ? eventos : []) {
    if (item.evento !== 'passo' || item.dados?.estado !== 'inicio') continue;
    const nome = item.dados.ferramenta;
    if (typeof nome === 'string' && nome && !nomes.includes(nome)) nomes.push(nome);
  }
  return nomes;
}

export function rodadasDe(eventos) {
  const fim = (Array.isArray(eventos) ? eventos : []).find((item) => item.evento === 'fim');
  const rodadas = fim?.dados?.rodadas;
  return Number.isInteger(rodadas) ? rodadas : null;
}
