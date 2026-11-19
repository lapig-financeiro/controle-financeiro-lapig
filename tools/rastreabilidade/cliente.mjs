/* ============================================================
   cliente.mjs
   Cliente Supabase próprio do backfill.

   Por que não `mcp/src/client.js`: ele imprime o e-mail no login, e a
   regra 1 de docs/acesso-ao-banco.md vale para este script. Aqui nada
   de credencial vai para stdout/stderr; os erros de rede são
   mensagens curtas, sem corpo de resposta.

   A camada de rede é injetável (`fetchImpl`) e a orquestração só
   conhece a interface de alto nível (`lerProjetosAtivos`, etc.), o que
   permite o ponta a ponta no pglite sem PostgREST.
   ============================================================ */

import { ErroFatal, ErroRpc, ErroSeguro, ErroUso } from './erros.mjs';

const TAMANHO_PAGINA = 500;
const VARIAVEIS = ['CF_SUPABASE_URL', 'CF_SUPABASE_ANON_KEY', 'CF_EMAIL', 'CF_PASSWORD'];

function semBarraFinal(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * 401/403 no meio da corrida é sessão expirada, não documento
 * recusado: aborta para não transformar falta de login em "outro" e
 * seguir baixando o resto com um token morto.
 */
function conferirSessao(resposta) {
  if (resposta.status === 401 || resposta.status === 403) {
    throw new ErroFatal('login expirou: rode de novo');
  }
}

export class ClienteSupabase {
  constructor({ url, anonKey, email, senha, fetchImpl = globalThis.fetch }) {
    this.url = semBarraFinal(url);
    this.anonKey = anonKey;
    this.email = email;
    this.senha = senha;
    this.fetchImpl = fetchImpl;
    this.token = null;
    this.userId = null;
  }

  _cabecalhos(extra = {}) {
    const cabecalhos = {
      apikey: this.anonKey,
      Accept: 'application/json',
      ...extra,
    };
    if (this.token) cabecalhos.Authorization = `Bearer ${this.token}`;
    return cabecalhos;
  }

  async entrar() {
    if (this.token && this.userId) return;

    let resposta;
    try {
      resposta = await this.fetchImpl(`${this.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: this.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: this.email, password: this.senha }),
      });
    } catch {
      throw new ErroSeguro('Não consegui falar com o Supabase no login.');
    }

    if (!resposta.ok) {
      throw new ErroSeguro('Falha no login. Confira CF_EMAIL e CF_PASSWORD (os valores não são exibidos).');
    }

    let dados;
    try {
      dados = await resposta.json();
    } catch {
      throw new ErroSeguro('O login voltou uma resposta inesperada.');
    }

    if (!dados || !dados.access_token || !dados.user || !dados.user.id) {
      throw new ErroSeguro('O login não devolveu token/usuário.');
    }
    this.token = dados.access_token;
    this.userId = dados.user.id;
  }

  async _get(caminho, contexto) {
    await this.entrar();
    let resposta;
    try {
      resposta = await this.fetchImpl(`${this.url}${caminho}`, {
        headers: this._cabecalhos(),
      });
    } catch {
      throw new ErroSeguro(`Não consegui falar com o Supabase ao ler ${contexto}.`);
    }
    conferirSessao(resposta);
    if (!resposta.ok) {
      throw new ErroSeguro(`Falha ao ler ${contexto} (HTTP ${resposta.status}).`);
    }
    return resposta;
  }

  /** Lê uma tabela paginando; a API REST já aplica o RLS com o JWT. */
  async _tabela(tabela, parametros) {
    const linhas = [];
    for (let pagina = 0; ; pagina += 1) {
      const busca = new URLSearchParams({
        ...parametros,
        limit: String(TAMANHO_PAGINA),
        offset: String(pagina * TAMANHO_PAGINA),
      });
      const resposta = await this._get(`/rest/v1/${tabela}?${busca.toString()}`, tabela);
      let lote;
      try {
        lote = await resposta.json();
      } catch {
        throw new ErroSeguro(`Resposta inesperada ao ler ${tabela}.`);
      }
      if (!Array.isArray(lote)) {
        throw new ErroSeguro(`Resposta inesperada ao ler ${tabela}.`);
      }
      linhas.push(...lote);
      if (lote.length < TAMANHO_PAGINA) break;
    }
    return linhas;
  }

  async lerPapel() {
    await this.entrar();
    const linhas = await this._tabela('app_users', {
      select: 'role',
      user_id: `eq.${this.userId}`,
      limit: '1',
    });
    return linhas.length ? linhas[0].role : null;
  }

  async lerProjetosAtivos() {
    return this._tabela('projects', {
      select: 'id,code,name',
      active: 'eq.true',
      order: 'code.asc.nullsfirst',
    });
  }

  async lerBalancetesDoAno(projectIds, ano) {
    if (!projectIds.length) return [];
    return this._tabela('balancetes', {
      select: 'id,project_id,data_referencia,saldo_disponivel,rendimento_liquido,total_debitos,total_creditos,arquivo_storage_path,arquivo_nome,raw_extraction',
      project_id: `in.(${projectIds.join(',')})`,
      data_referencia: `gte.${ano}-01-01`,
      arquivo_storage_path: 'not.is.null',
      order: 'data_referencia.asc,id.asc',
    });
  }

  async lerLancamentos(balanceteIds) {
    if (!balanceteIds.length) return [];
    return this._tabela('balancete_lancamentos', {
      select: 'id,balancete_id,conta_codigo,saldo_atual,rubrica_code',
      balancete_id: `in.(${balanceteIds.join(',')})`,
      order: 'balancete_id.asc,conta_codigo.asc,id.asc',
    });
  }

  async lerPlanosAtivos(projectIds) {
    if (!projectIds.length) return [];
    return this._tabela('planos_trabalho', {
      select: 'id,project_id,versao,ativo,valor_total_plano,arquivo_storage_path,arquivo_nome',
      project_id: `in.(${projectIds.join(',')})`,
      ativo: 'eq.true',
      arquivo_storage_path: 'not.is.null',
      order: 'project_id.asc,versao.asc',
    });
  }

  async lerRubricasDoPlano(planoIds) {
    if (!planoIds.length) return [];
    return this._tabela('plano_rubricas', {
      select: 'id,plano_id,rubrica_code,descricao_livre,valor_previsto',
      plano_id: `in.(${planoIds.join(',')})`,
      order: 'plano_id.asc,rubrica_code.asc,id.asc',
    });
  }

  async lerDesembolsos(planoIds) {
    if (!planoIds.length) return [];
    return this._tabela('plano_desembolsos', {
      select: 'id,plano_id,parcela,valor',
      plano_id: `in.(${planoIds.join(',')})`,
      order: 'plano_id.asc,parcela.asc,id.asc',
    });
  }

  async lerRubricas() {
    return this._tabela('rubricas', {
      select: 'code,name',
      order: 'code.asc',
    });
  }

  async lerDocumentos(chaves) {
    if (!chaves.length) return [];
    return this._tabela('documentos', {
      select: 'id,chave,titulo',
      chave: `in.(${chaves.join(',')})`,
      order: 'chave.asc',
    });
  }

  async lerVersoesExistentes(documentoIds) {
    if (!documentoIds.length) return [];
    return this._tabela('documento_versoes', {
      select: 'documento_id,sha256',
      documento_id: `in.(${documentoIds.join(',')})`,
      order: 'documento_id.asc,versao.asc',
    });
  }

  async baixarArquivo(bucket, caminho) {
    await this.entrar();
    const caminhoCodificado = String(caminho)
      .split('/')
      .map((parte) => encodeURIComponent(parte))
      .join('/');

    let resposta;
    try {
      resposta = await this.fetchImpl(
        `${this.url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${caminhoCodificado}`,
        {
          method: 'POST',
          headers: this._cabecalhos({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ expiresIn: 300 }),
        },
      );
    } catch {
      throw new ErroSeguro('Não consegui falar com o Storage ao assinar o arquivo.');
    }
    conferirSessao(resposta);
    if (!resposta.ok) {
      throw new ErroSeguro(`Falha ao assinar o arquivo (HTTP ${resposta.status}).`);
    }

    let assinada;
    try {
      const dados = await resposta.json();
      assinada = dados && (dados.signedURL || dados.signedUrl);
    } catch {
      throw new ErroSeguro('O Storage não devolveu a URL assinada.');
    }
    if (!assinada) throw new ErroSeguro('O Storage não devolveu a URL assinada.');

    const url = assinada.startsWith('http')
      ? assinada
      : `${this.url}/storage/v1${assinada.startsWith('/') ? '' : '/'}${assinada}`;

    let arquivo;
    try {
      arquivo = await this.fetchImpl(url, { headers: { apikey: this.anonKey } });
    } catch {
      throw new ErroSeguro('Não consegui baixar o arquivo do Storage.');
    }
    conferirSessao(arquivo);
    if (!arquivo.ok) {
      throw new ErroSeguro(`Falha ao baixar o arquivo do Storage (HTTP ${arquivo.status}).`);
    }

    try {
      return Buffer.from(await arquivo.arrayBuffer());
    } catch {
      throw new ErroSeguro('O arquivo baixado não pôde ser lido.');
    }
  }

  async registrarDocumento(payload) {
    await this.entrar();
    let resposta;
    try {
      resposta = await this.fetchImpl(`${this.url}/rest/v1/rpc/registrar_documento_v2`, {
        method: 'POST',
        headers: this._cabecalhos({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ p: payload }),
      });
    } catch {
      throw new ErroRpc('Não consegui falar com o Supabase na RPC.');
    }

    conferirSessao(resposta);
    if (!resposta.ok) {
      let corpo = null;
      try {
        corpo = await resposta.json();
      } catch {
        /* o corpo pode vir vazio/HTML; não é impresso */
      }
      throw new ErroRpc(
        (corpo && corpo.message) || `HTTP ${resposta.status}`,
        corpo && corpo.code,
        (corpo && (corpo.detail || corpo.details)) || null,
      );
    }

    try {
      return await resposta.json();
    } catch {
      throw new ErroRpc('A RPC respondeu num formato inesperado.');
    }
  }
}

export function criarClienteDoAmbiente(env = process.env) {
  const faltando = VARIAVEIS.filter((nome) => !env[nome]);
  if (faltando.length) {
    throw new ErroUso(`Variáveis de ambiente faltando: ${faltando.join(', ')}.`);
  }
  return new ClienteSupabase({
    url: env.CF_SUPABASE_URL,
    anonKey: env.CF_SUPABASE_ANON_KEY,
    email: env.CF_EMAIL,
    senha: env.CF_PASSWORD,
  });
}
