// Registro de nós da sessão (contrato §2).
//
// Todo valor que uma ferramenta devolve vira um nó com id curto. O modelo vê
// só { id, valor, rotulo, unidade }; a origem fica no registro, na memória da
// sessão, e é o que o bloco leva para a tela.

export function criarRegistro() {
  let resultado = 0;
  let noDoResultado = 0;
  let calculo = 0;
  let resultadoAtual = null;
  const porId = new Map();
  const ordem = [];

  function iniciarResultado() {
    resultado += 1;
    noDoResultado = 0;
    resultadoAtual = `r${resultado}`;
    return resultadoAtual;
  }

  function registrar({ valor, unidade, rotulo, origem }) {
    if (!resultadoAtual) {
      throw new Error('Nenhum resultado de ferramenta aberto para registrar o nó.');
    }
    noDoResultado += 1;
    const no = {
      id: `${resultadoAtual}.${noDoResultado}`,
      valor,
      unidade,
      rotulo: String(rotulo ?? ''),
      origem: origem ?? null,
    };
    porId.set(no.id, no);
    ordem.push(no);
    return no;
  }

  function registrarCalculo({ valor, unidade, rotulo, origem }) {
    calculo += 1;
    const no = {
      id: `c${calculo}`,
      valor,
      unidade,
      rotulo: String(rotulo ?? ''),
      origem: origem ?? null,
    };
    porId.set(no.id, no);
    ordem.push(no);
    return no;
  }

  function obter(id) {
    return porId.get(id) ?? null;
  }

  function doResultado(idResultado) {
    return ordem.filter((no) => no.id.startsWith(`${idResultado}.`));
  }

  return {
    iniciarResultado,
    registrar,
    registrarCalculo,
    obter,
    doResultado,
    resultadoAtual: () => resultadoAtual,
    todos: () => [...ordem],
  };
}
