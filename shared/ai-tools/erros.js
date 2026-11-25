// Erros do próprio pacote. O `executar` só aceita mensagem fixa marcada aqui;
// um erro vindo do adaptador/RPC nunca passa pelo formato do modelo.

const MARCA = Symbol('ai-tools-erro');

export function criarErroPacote(codigo, mensagem) {
  const erro = new Error(mensagem);
  erro.codigo = codigo;
  erro.mensagemFixa = mensagem;
  erro[MARCA] = true;
  return erro;
}

export function ehErroPacote(erro) {
  return Boolean(erro && erro[MARCA] === true);
}
