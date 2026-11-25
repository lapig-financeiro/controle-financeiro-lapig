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

function tituloComNumeroSemOrigem(titulo, citados, extras = []) {
  if (!titulo) return false;
  const lista = [...citados, ...extras];
  return marcarNumeros(titulo, lista).length > 0;
}

function citar(citados, nos) {
  for (const no of nos) {
    if (!no) continue;
    citados.push({ id: no.id, unidade: no.unidade, valor: no.valor });
  }
}

export function criarBlocos({ registro, citados = [], mascara }) {
  let proximo = 0;

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
      if (tituloComNumeroSemOrigem(titulo, citados)) {
        return erro('o título tem número que não é valor de nó citado.');
      }
      const texto = mascara.texto(args.texto);
      const semOrigem = marcarNumeros(texto, citados);
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
      if (tituloComNumeroSemOrigem(titulo, citados, usados)) {
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

    for (let indiceLinha = 0; indiceLinha < args.linhas.length; indiceLinha += 1) {
      const linha = args.linhas[indiceLinha];
      if (!Array.isArray(linha) || linha.length !== colunas.length) {
        return erro(`a linha ${indiceLinha + 1} não tem o mesmo número de colunas.`);
      }
      const saida = [];
      for (let indiceColuna = 0; indiceColuna < linha.length; indiceColuna += 1) {
        const id = linha[indiceColuna];
        if (typeof id !== 'string') {
          return erro('toda célula da tabela é o id de um nó, não um valor literal.');
        }
        const no = registro.obter(id.trim());
        if (!no) return erro(`nó não encontrado: ${id}`);
        if (colunas[indiceColuna].unidade === null) {
          colunas[indiceColuna].unidade = no.unidade;
        } else if (colunas[indiceColuna].unidade !== no.unidade) {
          return erro(
            `a coluna "${colunas[indiceColuna].rotulo}" mistura unidades ` +
              `(${colunas[indiceColuna].unidade} e ${no.unidade}).`
          );
        }
        saida.push({ valor: no.valor, unidade: no.unidade, origem: origemDoNo(no) });
        usados.push(no);
      }
      linhas.push(saida);
    }

    if (tituloComNumeroSemOrigem(titulo, citados, usados)) {
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
