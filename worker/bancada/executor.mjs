// Executa UMA pergunta da bateria contra o próprio `worker/src/index.js`.
//
// Monta o env da bancada, troca `globalThis.fetch` pelo roteador, chama o
// `fetch` do Worker (sem wrangler), lê o SSE e espera as promessas do
// `ctx.waitUntil` antes de devolver. O fetch original é restaurado sempre.

import workerPadrao from '../src/index.js';
import { criarRoteador } from './roteador.mjs';
import { lerEventos } from './sse.mjs';
import {
  falhasDeFerramenta,
  ferramentasChamadas,
  rodadasDe,
  verificar,
} from './bateria.mjs';

export function criarKvMemoria() {
  const mapa = new Map();
  return {
    mapa,
    async get(chave) {
      return mapa.has(chave) ? mapa.get(chave) : null;
    },
    async put(chave, valor, _opcoes) {
      mapa.set(chave, valor);
      return undefined;
    },
    async delete(chave) {
      mapa.delete(chave);
    },
  };
}

export function criarEnv({ modelo, papel, papeis, modo }) {
  return {
    SUPABASE_URL: 'https://bancada.invalid',
    SUPABASE_ANON_KEY: 'bancada-anon',
    ANALISE_MODELO: modelo,
    ANALISE_PAPEIS: papeis,
    ANALISE_LIMITE_DIA: '100000',
    ANALISE_USO: criarKvMemoria(),
    OLLAMA_API_KEY:
      modo === 'local' ? 'bancada-local' : modo === 'chave' ? 'bancada-chave' : 'bancada-roteiro',
  };
}

function corpoDaPergunta(definicao) {
  const corpo = {
    pergunta: definicao.pergunta,
    anteriores: Array.isArray(definicao.anteriores) ? definicao.anteriores : [],
  };
  return JSON.stringify(corpo);
}

function resultadoComFalha({ definicao, cenario, inicio, ms, statusHttp, motivos }) {
  return {
    id: definicao.id,
    pergunta: definicao.pergunta,
    cenario,
    inicio: new Date(inicio).toISOString(),
    ms,
    statusHttp,
    ok: false,
    motivos,
    rodadas: null,
    ferramentas: [],
    chamadasModelo: 0,
    chamadasRpc: [],
    falhas: [],
    textoFinal: null,
    blocos: [],
    eventos: [],
  };
}

/**
 * @param {object} opcoes
 * @param {object} opcoes.definicao   `{ id, pergunta, cenario?, anteriores?, espera? }`
 * @param {object} opcoes.retrato     retorno de `prepararRetrato`
 * @param {'local'|'chave'|'roteiro'} [opcoes.modo]
 * @param {Array} [opcoes.respostasRoteiro]
 * @param {{indice:number}} [opcoes.cursor]
 * @param {string|null} [opcoes.chave]
 * @param {string} [opcoes.modelo]
 * @param {Function} [opcoes.fetchOriginal]
 * @param {Function} [opcoes.agora]
 * @param {object} [opcoes.worker]
 */
export async function executarPergunta({
  definicao,
  retrato,
  modo = 'roteiro',
  respostasRoteiro = [],
  cursor = { indice: 0 },
  chave = null,
  modelo = 'deepseek-v4.1-flash:cloud',
  fetchOriginal = globalThis.fetch,
  agora = Date.now,
  worker = workerPadrao,
} = {}) {
  if (!definicao || typeof definicao !== 'object' || typeof definicao.pergunta !== 'string') {
    throw new TypeError('Cada pergunta precisa de "pergunta".');
  }

  const cenario = definicao.cenario && typeof definicao.cenario === 'object'
    ? definicao.cenario
    : {};
  const papel = typeof cenario.papel === 'string' && cenario.papel ? cenario.papel : 'admin';
  const papeisBrutos = cenario.papeis ?? (papel === 'admin' ? 'admin' : papel);
  const papeis = Array.isArray(papeisBrutos) ? papeisBrutos.join(',') : String(papeisBrutos);

  const env = criarEnv({ modelo, papel, papeis, modo });
  const roteador = criarRoteador({
    retrato,
    cenario,
    modo,
    respostasRoteiro,
    cursor,
    chave,
    fetchOriginal,
    agora,
  });

  const promessas = [];
  const ctx = {
    waitUntil(promessa) {
      promessas.push(Promise.resolve(promessa));
    },
  };

  const requisicao = new Request('https://worker.bancada.invalid/analise', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      Authorization: `Bearer bancada-${papel}`,
      'Content-Type': 'application/json',
    },
    body: corpoDaPergunta(definicao),
  });

  const inicio = agora();
  const fetchAnterior = globalThis.fetch;

  try {
    globalThis.fetch = roteador.fetch;
    const resposta = await worker.fetch(requisicao, env, ctx);
    const statusHttp = resposta.status;

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      await Promise.allSettled(promessas);
      return resultadoComFalha({
        definicao,
        cenario,
        inicio,
        ms: agora() - inicio,
        statusHttp,
        motivos: [`HTTP ${statusHttp}: ${corpo.slice(0, 300)}`],
      });
    }

    const eventos = await lerEventos(resposta.body, { inicio, agora });
    await Promise.allSettled(promessas);
    const ms = agora() - inicio;

    const textoEvento = [...eventos].reverse().find((item) => item.evento === 'texto');
    const blocos = eventos
      .filter((item) => item.evento === 'bloco' && item.dados)
      .map((item) => item.dados);
    const falhas = falhasDeFerramenta(eventos);
    const verificacao = verificar(eventos, definicao.espera ?? {}, {
      nomesSinteticos: retrato.nomesSinteticos,
      corposModelo: roteador.corposModelo.map((item) => item.corpo),
      ms,
    });

    return {
      id: definicao.id,
      pergunta: definicao.pergunta,
      cenario,
      inicio: new Date(inicio).toISOString(),
      ms,
      statusHttp,
      ok: verificacao.ok,
      motivos: verificacao.motivos,
      rodadas: rodadasDe(eventos),
      ferramentas: ferramentasChamadas(eventos),
      chamadasModelo: roteador.corposModelo.length,
      chamadasRpc: roteador.chamadasRpc.map((item) => ({ nome: item.nome, args: item.args })),
      falhas,
      textoFinal: textoEvento?.dados?.texto ?? null,
      blocos,
      eventos,
    };
  } catch (erro) {
    return resultadoComFalha({
      definicao,
      cenario,
      inicio,
      ms: agora() - inicio,
      statusHttp: null,
      motivos: [`a bancada falhou nesta pergunta: ${erro && erro.message ? erro.message : 'erro desconhecido'}`],
    });
  } finally {
    globalThis.fetch = fetchAnterior;
  }
}
