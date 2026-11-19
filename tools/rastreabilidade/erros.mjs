/* ============================================================
   erros.mjs
   Tipos de erro do backfill. Só `seguro` pode ir para o terminal:
   mensagens de RPC/PostgREST podem carregar conteúdo do documento.
   ============================================================ */

export class ErroSeguro extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroSeguro';
    this.seguro = true;
  }
}

export class ErroFatal extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroFatal';
    this.seguro = true;
  }
}

export class ErroUso extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroUso';
    this.seguro = true;
  }
}

export class ErroRpc extends Error {
  constructor(mensagem, codigo, detalhe) {
    super(mensagem);
    this.name = 'ErroRpc';
    this.code = codigo;
    this.detail = detalhe;
    this.seguro = false;
  }
}
