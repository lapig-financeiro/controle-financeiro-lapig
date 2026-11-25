// Registro de nós da sessão (contrato §2).
//
// Todo valor que uma ferramenta devolve vira um nó com id curto. O modelo vê
// só { id, valor, rotulo, unidade }; a origem fica no registro, na memória da
// sessão, e é o que o bloco leva para a tela.
//
// Cada execução tem o próprio escopo: os nós ficam pendentes até o resultado
// inteiro ser validado e só então são publicados. Chamadas concorrentes não
// trocam ids nem misturam nós.

export function criarRegistro() {
  let resultado = 0;
  let calculo = 0;
  const porId = new Map();
  const ordem = [];

  function iniciarResultado() {
    resultado += 1;
    const escopo = {
      id: `r${resultado}`,
      pendentes: [],
      registrar({ valor, unidade, rotulo, origem }) {
        const no = {
          id: `${escopo.id}.${escopo.pendentes.length + 1}`,
          valor,
          unidade,
          rotulo: String(rotulo ?? ''),
          origem: origem ?? null,
        };
        escopo.pendentes.push(no);
        return no;
      },
    };
    return escopo;
  }

  function publicar(escopo) {
    for (const no of escopo.pendentes) {
      porId.set(no.id, no);
      ordem.push(no);
    }
    escopo.pendentes = [];
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
    publicar,
    registrarCalculo,
    obter,
    doResultado,
    todos: () => [...ordem],
  };
}
