// Blocos e cálculo da Análise (contrato §3 e §6).
//
// O modelo pede um bloco citando ids; quem lê o valor é este código, do nó
// registrado pela ferramenta. Recusa sempre volta como `erro` para o modelo;
// bloco recusado não existe e não consome id.

import { marcarNumeros } from './texto.js';

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function erro(mensagem) {
  return { erro: mensagem };
}

function origemDoNo(no) {
  return no.origem ?? { tipo: 'sem_documento', motivo: 'sem origem registrada', consulta: '' };
}

function tituloComNumeroSemOrigem(titulo, citados, nomesCentros, extras = []) {
  if (!titulo) return false;
  const lista = [...citados, ...extras];
  return marcarNumeros(titulo, lista, { nomesCentros }).length > 0;
}

function citar(citados, nos) {
  for (const no of nos) {
    if (!no) continue;
    citados.push({ id: no.id, unidade: no.unidade, valor: no.valor });
  }
}

const MOTIVO_CELULA_VAZIA = 'sem valor para esta coluna';

function mesmoNo(a, b) {
  if (!a || !b) return false;
  return (
    a.rotulo === b.rotulo &&
    Number(a.valor) === Number(b.valor) &&
    JSON.stringify(a.ref ?? null) === JSON.stringify(b.ref ?? null)
  );
}

/**
 * `filho` está abaixo de `pai` por uma cadeia de filhos únicos: é o mesmo
 * número um nível abaixo (o "Previsto" e a única linha do plano). Citar os
 * dois na mesma linha da tabela põe um valor na coluna errada.
 */
function abaixoPorFilhoUnico(pai, filho) {
  if (pai?.origem?.tipo !== 'no' || filho?.origem?.tipo !== 'no') return false;
  let atual = pai.origem.no;
  const alvo = filho.origem.no;
  while (atual && Array.isArray(atual.partes) && atual.partes.length === 1) {
    atual = atual.partes[0];
    if (mesmoNo(atual, alvo)) return true;
  }
  return false;
}

function pareceIdDeNo(valor) {
  return /^[rc]\d+(?:\.\d+)?$/.test(valor);
}

export function criarBlocos({ registro, citados = [], mascara, nomesCentros }) {
  let proximo = 0;

  function nomesDaSessao() {
    if (typeof nomesCentros === 'function') {
      const nomes = nomesCentros();
      return Array.isArray(nomes) ? nomes : [];
    }
    return Array.isArray(nomesCentros) ? nomesCentros : [];
  }

  function criarBloco(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return erro('criar_bloco exige um objeto com tipo, titulo e os ids.');
    }
    const tipo = args.tipo;
    if (tipo !== 'numero' && tipo !== 'tabela' && tipo !== 'texto') {
      return erro('tipo de bloco inválido: use numero, tabela ou texto.');
    }
    if (args.titulo !== undefined && typeof args.titulo !== 'string') {
      return erro('titulo deve ser texto.');
    }
    const titulo = mascara.texto(args.titulo ?? '');

    if (tipo === 'texto') {
      if (typeof args.texto !== 'string' || args.texto.trim() === '') {
        return erro('bloco texto exige "texto".');
      }
      if (tituloComNumeroSemOrigem(titulo, citados, nomesDaSessao())) {
        return erro('o título tem número que não é valor de nó citado.');
      }
      const texto = mascara.texto(args.texto);
      const semOrigem = marcarNumeros(texto, citados, { nomesCentros: nomesDaSessao() });
      proximo += 1;
      return { bloco: { id: `b${proximo}`, tipo, titulo, texto: { texto, semOrigem } } };
    }

    if (tipo === 'numero') {
      if (typeof args.no !== 'string' || args.no.trim() === '') {
        return erro('bloco numero exige o id de um nó em "no".');
      }
      const no = registro.obter(args.no.trim());
      if (!no) return erro(`nó não encontrado: ${args.no}`);
      if (no.unidade === 'texto') {
        return erro('bloco numero exige um nó numérico (moeda, numero, percentual ou data).');
      }

      let contexto = null;
      if (args.contexto !== undefined && args.contexto !== null) {
        if (typeof args.contexto !== 'string') return erro('contexto deve ser o id de um nó de texto ou data.');
        contexto = registro.obter(args.contexto.trim());
        if (!contexto) return erro(`nó não encontrado: ${args.contexto}`);
        if (contexto.unidade !== 'texto' && contexto.unidade !== 'data') {
          return erro('contexto deve ser um nó de texto ou data.');
        }
      }

      const usados = contexto ? [no, contexto] : [no];
      if (tituloComNumeroSemOrigem(titulo, citados, nomesDaSessao(), usados)) {
        return erro('o título tem número que não é valor de nó citado.');
      }

      proximo += 1;
      const bloco = {
        id: `b${proximo}`,
        tipo,
        titulo,
        numero: {
          valor: no.valor,
          unidade: no.unidade,
          rotulo: no.rotulo,
          origem: origemDoNo(no),
          contexto: contexto
            ? {
                valor: contexto.valor,
                unidade: contexto.unidade,
                origem: origemDoNo(contexto),
              }
            : null,
        },
      };
      citar(citados, usados);
      return { bloco };
    }

    if (!Array.isArray(args.colunas) || args.colunas.length < 1 || args.colunas.length > 8) {
      return erro('tabela aceita de 1 a 8 colunas.');
    }
    if (!Array.isArray(args.linhas) || args.linhas.length < 1 || args.linhas.length > 50) {
      return erro('tabela aceita de 1 a 50 linhas.');
    }
    if (!args.colunas.every((coluna) => typeof coluna === 'string')) {
      return erro('cada coluna da tabela é um rótulo de texto.');
    }

    const colunas = args.colunas.map((coluna) => ({
      rotulo: mascara.texto(coluna),
      unidade: null,
    }));
    const linhas = [];
    const usados = [];

    function conferirUnidade(no, indiceColuna) {
      const coluna = colunas[indiceColuna];
      if (coluna.unidade === null) {
        coluna.unidade = no.unidade;
        return null;
      }
      if (coluna.unidade !== no.unidade) {
        return erro(`a coluna "${coluna.rotulo}" mistura unidades (${coluna.unidade} e ${no.unidade}).`);
      }
      return null;
    }

    for (let indiceLinha = 0; indiceLinha < args.linhas.length; indiceLinha += 1) {
      const linha = args.linhas[indiceLinha];
      if (!Array.isArray(linha) || linha.length !== colunas.length) {
        return erro(`a linha ${indiceLinha + 1} não tem o mesmo número de colunas.`);
      }
      const saida = [];
      const nosDaLinha = [];
      for (let indiceColuna = 0; indiceColuna < linha.length; indiceColuna += 1) {
        const bruto = linha[indiceColuna];
        const primeira = indiceColuna === 0;

        if (primeira && typeof bruto === 'string') {
          const texto = bruto.trim();
          const no = texto === '' ? null : registro.obter(texto);
          if (no) {
            const conflito = conferirUnidade(no, indiceColuna);
            if (conflito) return conflito;
            saida.push({ valor: no.valor, unidade: no.unidade, origem: origemDoNo(no) });
            usados.push(no);
            continue;
          }
          if (texto === '') {
            return erro('o rótulo de linha da primeira coluna não pode ser vazio.');
          }
          // Id de nó que não existe é erro do modelo, não rótulo de linha.
          if (pareceIdDeNo(texto)) return erro(`nó não encontrado: ${bruto}`);
          const mascarado = mascara.texto(texto);
          if (marcarNumeros(mascarado, citados, { nomesCentros: nomesDaSessao() }).length > 0) {
            return erro(`o rótulo de linha "${mascarado}" tem número que não é valor de nó citado.`);
          }
          // Rótulo literal não vira nó nem entra em `citados`.
          if (colunas[0].unidade === null) {
            colunas[0].unidade = 'texto';
          } else if (colunas[0].unidade !== 'texto') {
            return erro(
              `a coluna "${colunas[0].rotulo}" mistura texto literal com a unidade ` +
                `${colunas[0].unidade}.`
            );
          }
          saida.push({ valor: mascarado, unidade: 'texto', origem: null });
          continue;
        }

        if (!primeira && bruto === null) {
          // Célula sem nó (ex.: grupo sem realizado no balancete): a tela
          // mostra "—". A unidade é a da coluna, resolvida depois do laço.
          saida.push({
            valor: null,
            unidade: null,
            origem: { tipo: 'sem_documento', motivo: MOTIVO_CELULA_VAZIA, consulta: '' },
          });
          nosDaLinha.push(null);
          continue;
        }
        if (typeof bruto !== 'string') {
          return erro('toda célula da tabela é o id de um nó ou null (célula vazia), não um valor literal.');
        }
        const no = registro.obter(bruto.trim());
        if (!no) return erro(`nó não encontrado: ${bruto}`);
        const conflito = conferirUnidade(no, indiceColuna);
        if (conflito) return conflito;
        saida.push({ valor: no.valor, unidade: no.unidade, origem: origemDoNo(no) });
        usados.push(no);
        nosDaLinha.push(no);
      }
      for (let a = 0; a < nosDaLinha.length; a += 1) {
        for (let b = 0; b < nosDaLinha.length; b += 1) {
          if (a === b || !nosDaLinha[a] || !nosDaLinha[b]) continue;
          if (abaixoPorFilhoUnico(nosDaLinha[a], nosDaLinha[b])) {
            return erro(
              `na linha ${indiceLinha + 1}, a coluna "${colunas[b + 1].rotulo}" repete o valor da ` +
                `coluna "${colunas[a + 1].rotulo}" (é o mesmo item, um nível abaixo). Se não há nó ` +
                'para a coluna, use null (célula vazia).'
            );
          }
        }
      }
      linhas.push(saida);
    }

    for (const linha of linhas) {
      linha.forEach((celula, indice) => {
        if (celula.unidade === null) celula.unidade = colunas[indice].unidade ?? 'texto';
      });
    }
    if (colunas.some((coluna, indice) => indice > 0 && coluna.unidade === null)) {
      return erro('toda coluna precisa de ao menos uma célula com nó.');
    }

    if (tituloComNumeroSemOrigem(titulo, citados, nomesDaSessao(), usados)) {
      return erro('o título tem número que não é valor de nó citado.');
    }
    for (const coluna of colunas) {
      if (/\d/.test(coluna.rotulo)) {
        return erro('o cabeçalho da coluna não pode ter número.');
      }
    }

    proximo += 1;
    const bloco = {
      id: `b${proximo}`,
      tipo,
      titulo,
      tabela: { colunas: colunas.map((c) => ({ rotulo: c.rotulo, unidade: c.unidade })), linhas },
    };
    citar(citados, usados);
    return { bloco };
  }

  return { criarBloco };
}

function casasDecimais(valor) {
  const texto = String(valor);
  if (/e/i.test(texto)) {
    const [mantissa, expoente] = texto.toLowerCase().split('e');
    const casas = (mantissa.split('.')[1] || '').length;
    return Math.max(0, casas - Number(expoente));
  }
  const ponto = texto.indexOf('.');
  return ponto === -1 ? 0 : texto.length - ponto - 1;
}

function inteiroBigInt(valor, casas) {
  const texto = String(valor);
  const achado = texto.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!achado) throw new Error('forma decimal');
  const sinal = achado[1] === '-' ? -1n : 1n;
  const parteInteira = achado[2];
  const parteDecimal = achado[3] || '';
  const expoente = Number(achado[4] || 0);
  const potencia = expoente - parteDecimal.length + casas;
  const digitos = parteInteira + parteDecimal;

  if (potencia >= 0) {
    return sinal * BigInt(digitos + '0'.repeat(potencia));
  }

  const divisor = 10n ** BigInt(-potencia);
  const numero = BigInt(digitos);
  if (numero % divisor !== 0n) throw new Error('fora da escala');
  return sinal * (numero / divisor);
}

export function criarCalculadora({ registro, citados = [] }) {
  function calcular(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return erro('calcular exige { op, ids }.');
    }
    const op = args.op;
    if (op !== 'soma' && op !== 'diferenca') {
      return erro('op inválido: use soma ou diferenca.');
    }
    if (!Array.isArray(args.ids) || args.ids.length === 0) {
      return erro('ids é obrigatório: informe ao menos um nó.');
    }
    if (op === 'diferenca' && args.ids.length < 2) {
      return erro('diferenca exige ao menos dois nós.');
    }

    const nos = [];
    for (const id of args.ids) {
      if (typeof id !== 'string' || id.trim() === '') {
        return erro('cada id de calcular é o id de um nó.');
      }
      const no = registro.obter(id.trim());
      if (!no) return erro(`nó não encontrado: ${id}`);
      nos.push(no);
    }

    for (const no of nos) {
      if (no.unidade !== 'moeda' && no.unidade !== 'numero') {
        return erro('calcular só aceita nós de moeda ou numero.');
      }
    }

    const unidade = nos[0].unidade;
    for (const no of nos) {
      if (no.unidade !== unidade) {
        return erro(`calcular exige a mesma unidade; recebi ${unidade} e ${no.unidade}.`);
      }
      if (typeof no.valor !== 'number' || !Number.isFinite(no.valor)) {
        return erro(`o nó ${no.id} não tem valor numérico.`);
      }
    }

    let sinais;
    if (args.sinais !== undefined) {
      if (!Array.isArray(args.sinais) || args.sinais.length !== nos.length) {
        return erro('sinais deve ter um ±1 para cada id.');
      }
      if (!args.sinais.every((sinal) => sinal === 1 || sinal === -1)) {
        return erro('cada sinal deve ser 1 ou -1.');
      }
      sinais = [...args.sinais];
    } else {
      sinais = nos.map((_, indice) => (op === 'diferenca' && indice > 0 ? -1 : 1));
    }

    let escala;
    let casas;
    if (unidade === 'moeda') {
      for (const no of nos) {
        if (casasDecimais(no.valor) > 2) {
          return erro('calcular recusa moeda com mais de 2 casas decimais.');
        }
      }
      casas = 2;
      escala = 100;
    } else {
      casas = Math.max(...nos.map((no) => casasDecimais(no.valor)));
      escala = 10 ** casas;
      if (!Number.isSafeInteger(escala)) {
        return erro('calcular recusa escala excessiva para numero.');
      }
    }

    let inteiros;
    try {
      inteiros = nos.map((no) => inteiroBigInt(no.valor, casas));
    } catch {
      return erro('calcular recusa valores fora da faixa exata.');
    }
    if (!inteiros.every((valor) => Number.isSafeInteger(Number(valor)))) {
      return erro('calcular recusa valores fora da faixa exata.');
    }

    const totalInteiro = inteiros.reduce(
      (soma, valor, indice) => soma + valor * BigInt(sinais[indice]),
      0n
    );
    if (!Number.isSafeInteger(Number(totalInteiro))) {
      return erro('calcular recusa total fora da faixa segura.');
    }
    const valor = Number(totalInteiro) / escala;
    // Perto do limite seguro, dividir pela escala pode mudar o último dígito
    // (R$ 90.071.992.547.409,87 vira ,88). Só publica o que volta igual.
    const exato = (numero, inteiro) => {
      try {
        return inteiroBigInt(numero, casas) === inteiro;
      } catch {
        return false;
      }
    };
    if (!exato(valor, totalInteiro) || !inteiros.every((inteiro) => exato(Number(inteiro) / escala, inteiro))) {
      return erro('calcular recusa valores fora da faixa exata.');
    }

    const partes = nos.map((no, indice) => ({
      id: no.id,
      sinal: sinais[indice],
      valor: Number(inteiros[indice]) / escala,
      rotulo: no.rotulo,
      origem: clonar(origemDoNo(no)),
    }));
    const rotulo =
      op === 'soma'
        ? `Soma de ${nos.length} valores`
        : `Diferença entre ${nos.length} valores`;
    const no = registro.registrarCalculo({
      valor,
      unidade,
      rotulo,
      origem: { tipo: 'calculo', op, partes },
    });

    citados.push({ id: no.id, unidade, valor });
    for (const parte of nos) citados.push({ id: parte.id, unidade: parte.unidade, valor: parte.valor });

    return {
      id: no.id,
      paraModelo: JSON.stringify({
        resultado: { id: no.id, valor, rotulo, unidade },
        op,
        partes: nos.map((parte, indice) => ({ id: parte.id, sinal: sinais[indice] })),
      }),
    };
  }

  return { calcular };
}
