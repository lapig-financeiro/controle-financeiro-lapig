// Executa UMA pergunta da bateria contra o núcleo da Análise.
//
// Monta o env da bancada, troca `globalThis.fetch` pelo roteador, chama
// `tratar` com o contador por RPC (o roteador responde `analise_consumir` com
// um contador em memória), lê o SSE e espera as promessas do `waitUntil` antes
// de devolver. O fetch original é restaurado sempre.

import { tratar } from '../src/nucleo.js';
import { criarContadorRpc } from '../src/contador-rpc.js';
import { criarRoteador } from './roteador.mjs';
import { lerEventos } from './sse.mjs';
import {
  falhasDeFerramenta,
  ferramentasChamadas,
  rodadasDe,
  verificar,
} from './bateria.mjs';

export function criarEnv({ modelo, papel, papeis, modo }) {
  return {
    SUPABASE_URL: 'https://bancada.invalid',
    SUPABASE_ANON_KEY: 'bancada-anon',
    ANALISE_MODELO: modelo,
    ANALISE_PAPEIS: papeis,
    ANALISE_LIMITE_DIA: '100000',
    OLLAMA_API_KEY:
      modo === 'local' ? 'bancada-local' : modo === 'chave' ? 'bancada-chave' : 'bancada-roteiro',
  };
}

/** Acima disso, a pergunta leva o aviso no relatório (limite da Cloudflare). */
export const LIMITE_CHAMADAS_EXTERNAS = 40;

function contarChamadas(roteador) {
  const porTipo = roteador.chamadasPorTipo ?? {
    modelo: 0,
    auth: 0,
    rpc: 0,
    contador: 0,
    registro: 0,
  };
  const chamadas = {
    modelo: porTipo.modelo ?? 0,
    auth: porTipo.auth ?? 0,
    rpc: porTipo.rpc ?? 0,
    contador: porTipo.contador ?? 0,
    registro: porTipo.registro ?? 0,
  };
  chamadas.total =
    chamadas.modelo + chamadas.auth + chamadas.rpc + chamadas.contador + chamadas.registro;
  return chamadas;
}

function avisosDeChamadas(chamadas) {
  return chamadas.total > LIMITE_CHAMADAS_EXTERNAS
    ? [
        `${chamadas.total} chamadas externas nesta pergunta ` +
          `(acima de ${LIMITE_CHAMADAS_EXTERNAS})`,
      ]
    : [];
}

function corpoDaPergunta(definicao) {
  const corpo = {
    pergunta: definicao.pergunta,
    anteriores: Array.isArray(definicao.anteriores) ? definicao.anteriores : [],
  };
  return JSON.stringify(corpo);
}

/** O que a pergunta fez com o registro da 074 e o que ficou gravado. */
function registroDaPergunta(roteador, eventos) {
  const eventoInicio = eventos.find((item) => item.evento === 'inicio') ?? null;
  const id =
    eventoInicio && eventoInicio.dados && typeof eventoInicio.dados.registro === 'string'
      ? eventoInicio.dados.registro
      : null;
  const registros = roteador.registros ?? {};
  const fechado =
    id && registros.fechados instanceof Map ? registros.fechados.get(id) ?? null : null;
  return {
    id,
    evento: eventoInicio,
    iniciar: registros.iniciar ?? 0,
    concluir: registros.concluir ?? 0,
    fechado,
  };
}

function resultadoComFalha({
  definicao,
  cenario,
  inicio,
  ms,
  statusHttp,
  motivos,
  chamadas = { modelo: 0, auth: 0, rpc: 0, contador: 0, total: 0 },
}) {
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
    chamadasModelo: chamadas.modelo ?? 0,
    chamadas,
    avisos: avisosDeChamadas(chamadas),
    chamadasRpc: [],
    falhas: [],
    textoFinal: null,
    blocos: [],
    registro: null,
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
 * @param {Function} [opcoes.tratarImpl]
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
  tratarImpl = tratar,
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

  // A cota entra pela RPC, como na Edge Function: o roteador responde
  // `analise_consumir` com um contador em memória.
  const contador = criarContadorRpc({
    supabaseUrl: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    teto: 100_000,
    fetchImpl: roteador.fetch,
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
    const resposta = await tratarImpl(requisicao, env, {
      contador,
      waitUntil: (promessa) => ctx.waitUntil(promessa),
      // A bancada roda o núcleo como a Edge Function: a conclusão do registro
      // usa a credencial de servidor simulada pelo roteador.
      serviceRoleKey: 'bancada-servidor',
    });
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
        chamadas: contarChamadas(roteador),
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
    const registro = registroDaPergunta(roteador, eventos);
    const verificacao = verificar(eventos, definicao.espera ?? {}, {
      nomesSinteticos: retrato.nomesSinteticos,
      corposModelo: roteador.corposModelo.map((item) => item.corpo),
      ms,
      registro,
    });
    const chamadas = contarChamadas(roteador);

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
      chamadasModelo: chamadas.modelo,
      chamadas,
      avisos: avisosDeChamadas(chamadas),
      chamadasRpc: roteador.chamadasRpc
        .filter(
          (item) =>
            item.nome !== 'analise_consumir' &&
            item.nome !== 'analise_registro_iniciar' &&
            item.nome !== 'analise_registro_concluir_servidor',
        )
        .map((item) => ({ nome: item.nome, args: item.args })),
      falhas,
      textoFinal: textoEvento?.dados?.texto ?? null,
      blocos,
      registro,
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
      chamadas: contarChamadas(roteador),
    });
  } finally {
    globalThis.fetch = fetchAnterior;
  }
}
