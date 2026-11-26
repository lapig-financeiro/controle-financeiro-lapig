// Roteador de rede da bancada.
//
// Durante uma pergunta, `globalThis.fetch` é trocado por este roteador. Só
// três destinos existem:
//   - https://bancada.invalid  (auth, app_users e RPCs do retrato)
//   - https://ollama.com/api/chat (modelo; local, chave ou roteiro)
// Qualquer outro endereço lança "bancada: rede fora da lista" e nada sai do PC.
//
// O roteador guarda cada corpo enviado ao modelo (para a checagem de vazamento)
// e cada RPC chamada (para o relatório). Não guarda a chave do Ollama.

const ORIGEM_SUPABASE = 'https://bancada.invalid';
const ENDPOINT_MODELO = 'https://ollama.com/api/chat';
const ENDPOINT_LOCAL = 'http://localhost:11434/api/chat';

function clonar(valor) {
  if (valor === undefined) return undefined;
  return JSON.parse(JSON.stringify(valor));
}

/** UUID v4 sintético e determinístico, só para a bancada. */
function uuidSintetico(numero) {
  return `00000000-0000-4000-8000-${String(numero).padStart(12, '0')}`;
}

function bytesDeJson(valor) {
  try {
    return new TextEncoder().encode(JSON.stringify(valor)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function postgrest404(nome) {
  return {
    code: 'PGRST202',
    details: `Searched for the function public.${nome} in the schema cache`,
    hint: null,
    message: `Could not find the function public.${nome} in the schema cache`,
  };
}

function acessoNegado() {
  return {
    code: 'P0001',
    details: null,
    hint: null,
    message: 'Acesso negado',
  };
}

function cabecalho(init, nome) {
  const headers = init && init.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(nome);
  if (Array.isArray(headers)) {
    const achado = headers.find(([chave]) => String(chave).toLowerCase() === nome.toLowerCase());
    return achado ? achado[1] : null;
  }
  const chave = Object.keys(headers).find((item) => item.toLowerCase() === nome.toLowerCase());
  return chave ? headers[chave] : null;
}

function lerCorpo(init) {
  if (!init || init.body === undefined || init.body === null) return {};
  if (typeof init.body !== 'string') return {};
  try {
    return JSON.parse(init.body);
  } catch {
    return {};
  }
}

/**
 * @param {object} opcoes
 * @param {object} opcoes.retrato        retorno de prepararRetrato
 * @param {object} [opcoes.cenario]      papel, centros_visiveis, rpc
 * @param {'local'|'chave'|'roteiro'} [opcoes.modo]
 * @param {Array} [opcoes.respostasRoteiro]
 * @param {{indice:number}} [opcoes.cursor] cursor compartilhado entre perguntas
 * @param {string|null} [opcoes.chave]
 * @param {Function} [opcoes.fetchOriginal] o fetch de verdade, capturado antes da troca
 * @param {Function} [opcoes.agora]
 */
export function criarRoteador({
  retrato,
  cenario = {},
  modo = 'roteiro',
  respostasRoteiro = [],
  cursor = { indice: 0 },
  chave = null,
  fetchOriginal = globalThis.fetch,
  agora = Date.now,
} = {}) {
  if (!retrato || typeof retrato !== 'object') {
    throw new TypeError('criarRoteador exige o retrato preparado.');
  }
  if (!['local', 'chave', 'roteiro'].includes(modo)) {
    throw new TypeError(`Modo de modelo desconhecido: ${modo}`);
  }
  if (modo === 'chave' && (typeof chave !== 'string' || !chave)) {
    throw new TypeError('O modo chave exige a chave lida do arquivo.');
  }

  const papel = typeof cenario.papel === 'string' && cenario.papel ? cenario.papel : 'admin';
  const usuario = {
    id: typeof cenario.usuario?.id === 'string' && cenario.usuario.id
      ? cenario.usuario.id
      : `bancada-${papel}`,
    email: typeof cenario.usuario?.email === 'string' && cenario.usuario.email
      ? cenario.usuario.email
      : `bancada-${papel}@bancada.invalid`,
  };
  const tokenEsperado = `Bearer bancada-${papel}`;
  const visiveis = Array.isArray(cenario.centros_visiveis)
    ? new Set(cenario.centros_visiveis.map(String))
    : null;
  const falhasRpc = cenario.rpc && typeof cenario.rpc === 'object' ? cenario.rpc : {};

  const corposModelo = [];
  const chamadasRpc = [];
  // Contagem por tipo, para a coluna "chamadas externas" do relatório.
  const chamadasPorTipo = { modelo: 0, auth: 0, rpc: 0, contador: 0, registro: 0 };
  // Cota da Edge Function simulada: a RPC analise_consumir incrementa este
  // contador em memória e devolve { dia, usadas }, como a tabela da 071.
  let usadas = 0;

  // Registro da 074 em memória: a pergunta abre uma linha, o fechamento só
  // vale uma vez e só para o mesmo usuário. `iniciar`/`concluir` contam
  // chamadas (não sucessos), para a bateria pegar abertura/fechamento duplo.
  const registros = {
    abertos: new Map(),
    fechados: new Map(),
    iniciar: 0,
    concluir: 0,
  };
  let proximoRegistro = 0;

  function diaDaBancada(instante) {
    return new Date(instante - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function filtrarResumo(resumo) {
    if (!visiveis) return resumo;
    if (Array.isArray(resumo.centros)) {
      resumo.centros = resumo.centros.filter((centro) => centro && visiveis.has(String(centro.code)));
    }
    if (Array.isArray(resumo.todos)) {
      resumo.todos = resumo.todos.filter((centro) => centro && visiveis.has(String(centro.code)));
    }
    if (Array.isArray(resumo.ocultos)) {
      resumo.ocultos = resumo.ocultos.filter((centro) => centro && visiveis.has(String(centro.code)));
    }
    return resumo;
  }

  function filtrarBolsas(bolsas) {
    const copia = clonar(bolsas);
    if (!visiveis) return copia;
    copia.bolsistas = (copia.bolsistas ?? [])
      .map((bolsista) => ({
        ...bolsista,
        bolsas: (Array.isArray(bolsista.bolsas) ? bolsista.bolsas : []).filter(
          (bolsa) => bolsa && visiveis.has(String(bolsa.code)),
        ),
      }))
      .filter((bolsista) => bolsista.bolsas.length > 0);
    return copia;
  }

  function resolverCentro(args) {
    const projectId = args && args.p_project_id;
    if (typeof projectId !== 'string' || !projectId) {
      return { erro: json({ code: 'PGRST202', message: 'p_project_id é obrigatório' }, 400) };
    }
    const code = retrato.centrosPorId.get(projectId);
    if (!code) return { erro: json(postgrest404('centro'), 404) };
    if (visiveis && !visiveis.has(code)) return { erro: json(acessoNegado(), 400) };
    return { code };
  }

  function valorDoCentro(code, campo) {
    const centro = retrato.centros[code];
    if (!centro || !Object.prototype.hasOwnProperty.call(centro, campo)) return null;
    return centro[campo];
  }

  function erroRpc(code, message, status = 400) {
    return json({ code, details: null, hint: null, message }, status);
  }

  function iniciarRegistro(args) {
    const pergunta = args && args.p_pergunta;
    const anteriores = args && args.p_anteriores;
    const modelo = args && args.p_modelo;

    if (typeof pergunta !== 'string' || !pergunta.trim() || pergunta.length > 2000) {
      return erroRpc('22023', 'Pergunta inválida.');
    }
    if (
      anteriores !== undefined &&
      anteriores !== null &&
      (!Number.isInteger(anteriores) || anteriores < 0 || anteriores > 5)
    ) {
      return erroRpc('22023', 'Anteriores fora do intervalo.');
    }
    if (modelo !== undefined && modelo !== null && (typeof modelo !== 'string' || modelo.length > 200)) {
      return erroRpc('22023', 'Modelo longo demais.');
    }

    registros.iniciar += 1;
    proximoRegistro += 1;
    const id = uuidSintetico(proximoRegistro);
    registros.abertos.set(id, {
      id,
      user_id: usuario.id,
      pergunta,
      anteriores: anteriores ?? 0,
      modelo: modelo ?? null,
      iniciada_em: agora(),
    });
    return json(id);
  }

  function concluirRegistro(args) {
    // Conta a tentativa: a bateria pega o fechamento duplo também.
    registros.concluir += 1;

    const id = args && args.p_id;
    const aberto = typeof id === 'string' ? registros.abertos.get(id) : null;

    if (!aberto) {
      if (typeof id === 'string' && registros.fechados.has(id)) {
        return erroRpc('22023', 'Registro já concluído.');
      }
      return json(acessoNegado(), 400);
    }
    if (aberto.user_id !== usuario.id) return json(acessoNegado(), 400);

    const desfecho = args.p_desfecho;
    if (
      desfecho !== 'ok' &&
      desfecho !== 'erro' &&
      desfecho !== 'incompleta' &&
      desfecho !== 'tempo' &&
      desfecho !== 'limite' &&
      desfecho !== 'desconectado'
    ) {
      return erroRpc('22023', 'Desfecho inválido.');
    }

    const resposta = args.p_resposta ?? null;
    const passos = args.p_passos ?? null;
    if (resposta !== null && bytesDeJson(resposta) > 262144) {
      return erroRpc('22023', 'Resposta acima de 256 KB.');
    }
    if (passos !== null && bytesDeJson(passos) > 262144) {
      return erroRpc('22023', 'Passos acima de 256 KB.');
    }

    registros.abertos.delete(id);
    registros.fechados.set(id, {
      ...aberto,
      terminada_em: agora(),
      resposta,
      passos,
      rodadas: args.p_rodadas ?? null,
      ms: args.p_ms ?? null,
      chamadas: args.p_chamadas ?? null,
      desfecho,
      codigo_erro: args.p_codigo_erro ?? null,
    });
    return new Response(null, { status: 204 });
  }

  function respostaDeErroDoOraculo(valor) {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor) || !('__erro' in valor)) {
      return null;
    }
    const status = Number.isInteger(valor.__erro) ? valor.__erro : 500;
    return json({ code: 'XX000', message: 'RPC falhou quando o oráculo foi gravado' }, status);
  }

  function responderRpc(nome, args) {
    if (nome === 'resumo_projetos_v2') {
      return json(filtrarResumo(clonar(retrato.resumo)));
    }

    if (nome === 'get_pedido_bolsas_v2') {
      return json(filtrarBolsas(retrato.bolsas));
    }

    if (nome === 'listar_pendencias_v2') {
      const projectId = args && args.p_project_id;
      if (projectId !== undefined && projectId !== null && projectId !== '') {
        const resolvido = resolverCentro(args);
        if (resolvido.erro) return resolvido.erro;
        const pendencias = valorDoCentro(resolvido.code, 'pendencias');
        const falha = respostaDeErroDoOraculo(pendencias);
        if (falha) return falha;
        if (!Array.isArray(pendencias)) return json(postgrest404(nome), 404);
        return json(clonar(pendencias));
      }

      const codigos = visiveis
        ? [...visiveis]
        : Object.keys(retrato.centros);
      const todas = [];
      for (const code of codigos) {
        const pendencias = valorDoCentro(code, 'pendencias');
        if (Array.isArray(pendencias)) todas.push(...clonar(pendencias));
      }
      return json(todas);
    }

    const campo = Object.entries({
      situacao_centro_v2: 'situacao',
      explicar_livre_v2: 'arvore',
      get_repasses_v2: 'desembolsos',
      get_termos_contrato_v2: 'termos',
    }).find(([rpc]) => rpc === nome);

    if (!campo) return json(postgrest404(nome), 404);

    const resolvido = resolverCentro(args);
    if (resolvido.erro) return resolvido.erro;
    const valor = valorDoCentro(resolvido.code, campo[1]);
    const falha = respostaDeErroDoOraculo(valor);
    if (falha) return falha;
    if (valor === undefined || valor === null) return json(postgrest404(nome), 404);
    return json(clonar(valor));
  }

  async function rotearBancada(url, init) {
    if (url.pathname === '/auth/v1/user' || url.pathname === '/rest/v1/app_users') {
      chamadasPorTipo.auth += 1;
    }

    const authorization = cabecalho(init, 'Authorization');
    if (authorization !== tokenEsperado) {
      return json(
        {
          code: 401,
          error: 'invalid_token',
          error_description: 'JWT inválido na bancada',
        },
        401,
      );
    }

    if (url.pathname === '/auth/v1/user') {
      return json(usuario);
    }

    if (url.pathname === '/rest/v1/app_users') {
      return json([{ role: papel }]);
    }

    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const nome = decodeURIComponent(url.pathname.slice('/rest/v1/rpc/'.length));
      const args = lerCorpo(init);
      chamadasRpc.push({ nome, args: clonar(args), ms: agora() });

      if (nome === 'analise_consumir') chamadasPorTipo.contador += 1;
      else if (nome === 'analise_registro_iniciar' || nome === 'analise_registro_concluir') {
        chamadasPorTipo.registro += 1;
      } else chamadasPorTipo.rpc += 1;

      const configurada = falhasRpc[nome];
      if (configurada) {
        if (configurada === true || configurada.rede === true) {
          throw new TypeError('falha de rede simulada pela bancada');
        }
        const status = Number.isInteger(configurada.status) ? configurada.status : 500;
        return json(
          configurada.corpo ?? {
            code: typeof configurada.code === 'string' ? configurada.code : 'XX000',
            message: typeof configurada.message === 'string'
              ? configurada.message
              : 'falha simulada pela bancada',
          },
          status,
        );
      }

      // Cota da Edge Function (071): incrementa como a RPC analise_consumir.
      if (nome === 'analise_consumir') {
        usadas += 1;
        return json({ dia: diaDaBancada(agora()), usadas });
      }

      // Registro da 074 em memória (abertura/fechamento únicos).
      if (nome === 'analise_registro_iniciar') return iniciarRegistro(args);
      if (nome === 'analise_registro_concluir') return concluirRegistro(args);

      return responderRpc(nome, args);
    }

    throw new Error('bancada: rede fora da lista');
  }

  async function rotearModelo(init) {
    const bruto = init && typeof init.body === 'string' ? init.body : '';
    let corpo = null;
    try {
      corpo = JSON.parse(bruto);
    } catch {
      corpo = { __bruto: bruto };
    }
    corposModelo.push({ indice: corposModelo.length + 1, corpo, ms: agora() });
    chamadasPorTipo.modelo += 1;

    if (modo === 'roteiro') {
      const indice = Number.isInteger(cursor.indice) ? cursor.indice : 0;
      if (indice >= respostasRoteiro.length) {
        return json({ error: 'roteiro esgotado' }, 500);
      }
      cursor.indice = indice + 1;
      return json(respostasRoteiro[indice]);
    }

    const cabecalhos = { 'Content-Type': 'application/json' };
    let destino = ENDPOINT_LOCAL;
    if (modo === 'chave') {
      destino = ENDPOINT_MODELO;
      cabecalhos.Authorization = `Bearer ${chave}`;
    }

    return fetchOriginal(destino, {
      method: 'POST',
      headers: cabecalhos,
      body: bruto,
      signal: init && init.signal,
    });
  }

  async function fetchDaBancada(recurso, init = {}) {
    const url = new URL(typeof recurso === 'string' ? recurso : recurso.url);

    if (url.origin === ORIGEM_SUPABASE) {
      return rotearBancada(url, init);
    }

    if (url.origin === 'https://ollama.com' && url.pathname === '/api/chat') {
      return rotearModelo(init);
    }

    throw new Error('bancada: rede fora da lista');
  }

  return {
    fetch: fetchDaBancada,
    corposModelo,
    chamadasRpc,
    chamadasPorTipo,
    registros,
    get usadas() {
      return usadas;
    },
    papel,
  };
}

export { ENDPOINT_MODELO, ENDPOINT_LOCAL, ORIGEM_SUPABASE };
