/* ============================================================
   Laço de ferramentas (contrato §4, §6 e §7)
   ============================================================
   Recebe TUDO de fora: a sessão do pacote `shared/ai-tools`
   (`executar`, `criarBloco`, `calcular`, `marcarTexto`,
   `reidratar`), a função que chama o modelo e o emissor de
   eventos. É o que permite testar o protocolo sem Rede, sem
   Ollama e sem Supabase — e o que impede este arquivo de saber
   o que é uma RPC ou uma regra financeira.

   Regra que não se negocia: o texto do modelo só sai daqui
   depois de `sessao.marcarTexto`, que marca número sem nó e
   mascara o que for pessoal. Bloco só sai por `criarBloco` e
   `reidratar`. Nenhum conteúdo vai para console.

   2ª rodada: o prazo é um instante absoluto (`prazo`), vindo do
   começo do POST /analise, não um contador que reinicia aqui.
   Cada chamada usa o menor entre o teto próprio e o restante.
   Texto vazio é erro do modelo; formato inválido de `marcarTexto`
   é erro interno; erro de ferramenta (inclusive exceção) é
   cortado em 500 caracteres na tela e no que volta ao modelo.
   ============================================================ */

import { PRAZO_PADRAO_MS, timeoutEfetivo } from './prazo.js';
import { diaBrasilia } from './limite.js';

export const TETOS = Object.freeze({
  rodadas: 8,
  ferramentas: 30,
  resultadoChars: 60_000,
  ms: PRAZO_PADRAO_MS,
});

/** Teto de uma única ida ao modelo; o prazo total continua mandando. */
export const TETO_POR_CHAMADA_MS = 90_000;

/** Erro de ferramenta não vira romance na tela nem no contexto do modelo. */
export const MAX_ERRO_CHARS = 500;

/**
 * Encerramento quando as rodadas acabam DEPOIS de ao menos um bloco válido: a
 * resposta continua incompleta (não vira sucesso), mas o que já saiu presta.
 * Mensagem fixa: o número de rodadas do contrato é 8.
 */
export const MENSAGEM_INCOMPLETA =
  'A resposta ficou incompleta: parei em 8 rodadas. Os blocos acima estão certos; ' +
  'para o resto, faça uma pergunta mais específica.';

/** Erro que o chamador do modelo usa para dizer POR QUE falhou. */
export class ErroModelo extends Error {
  constructor(mensagem, codigo = 'modelo') {
    super(mensagem);
    this.name = 'ErroModelo';
    this.codigo = codigo;
  }
}

function cortarErro(valor) {
  const texto = String(valor ?? '');
  if (texto.length <= MAX_ERRO_CHARS) return texto;
  return `${texto.slice(0, MAX_ERRO_CHARS - 1)}…`;
}

// Rótulo em pt-BR do passo que a tela mostra. Ferramenta desconhecida não
// inventa nome de RPC na tela: vira "consultando os dados".
const ROTULOS = Object.freeze({
  listar_centros: 'consultando os centros',
  explicar_livre: 'explicando o saldo livre',
  situacao_centro: 'lendo a situação do centro',
  desembolsos: 'consultando os desembolsos',
  termos_contrato: 'lendo os termos do contrato',
  pendencias: 'listando as pendências',
  bolsas: 'consultando as bolsas',
  criar_bloco: 'montando o bloco',
  calcular: 'fazendo a conta',
});

function rotuloDaFerramenta(nome) {
  return ROTULOS[nome] ?? 'consultando os dados';
}

/** Aceita objeto (Ollama nativo) ou string JSON (formato OpenAI). */
function lerArgumentos(bruto) {
  if (bruto == null || bruto === '') return {};
  if (typeof bruto === 'object') return bruto;
  let valor;
  try {
    valor = JSON.parse(bruto);
  } catch {
    throw new Error('Os argumentos da ferramenta não são JSON válido.');
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('Os argumentos da ferramenta não são um objeto.');
  }
  return valor;
}

function textoDoResultado(valor) {
  if (typeof valor === 'string') return valor;
  try {
    const texto = JSON.stringify(valor ?? null);
    return typeof texto === 'string' ? texto : 'null';
  } catch {
    return '{"erro":"O resultado não pôde ser serializado."}';
  }
}

function avisoResultadoGrande(tamanho, teto) {
  return {
    erro: 'Resultado grande demais para caber na conversa.',
    tamanho_chars: tamanho,
    teto_chars: teto,
    dica:
      'Refaça a consulta restringindo os centros de custo a um ou dois, ' +
      'ou peça um recorte menor. Não estime o número que faltou.',
  };
}

function mensagemDeTool(chamada, nome, conteudo) {
  const msg = {
    role: 'tool',
    tool_name: nome,
    content: typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo ?? null),
  };
  // Só existe no formato da OpenAI; quando vem, tem de voltar, ou o modelo não
  // casa o resultado com a chamada.
  if (chamada && chamada.id) msg.tool_call_id = chamada.id;
  return msg;
}

/** O formato que o contrato §4 promete para `marcarTexto`. */
function textoMarcadoValido(marcado) {
  if (!marcado || typeof marcado !== 'object') return false;
  if (typeof marcado.texto !== 'string') return false;
  if (!Array.isArray(marcado.semOrigem)) return false;
  return marcado.semOrigem.every(
    (faixa) =>
      faixa &&
      typeof faixa === 'object' &&
      Number.isInteger(faixa.inicio) &&
      Number.isInteger(faixa.fim) &&
      faixa.inicio >= 0 &&
      faixa.fim >= faixa.inicio &&
      faixa.fim <= marcado.texto.length,
  );
}

/**
 * Roda uma pergunta até o modelo responder em texto.
 *
 * @param {object} opts
 * @param {object} opts.sessao        sessão do pacote `shared/ai-tools` (contrato §4)
 * @param {Function} opts.chamarModelo `({mensagens, tools, timeoutMs, prazo, sinal}) => resposta`
 * @param {Function} opts.emitir      `(nomeEvento, dados) => Promise<boolean>`
 * @param {string} opts.instrucoes    `INSTRUCOES` do pacote, injetado
 * @param {string} opts.pergunta
 * @param {Array}  [opts.anteriores]  `[{pergunta, resumo}]`, até 5
 * @param {string} [opts.hoje]        `AAAA-MM-DD` no fuso de Brasília
 * @param {Array}  [opts.tools]       especificações no formato do Ollama
 * @param {object} [opts.tetos]       sobrescreve `TETOS` (testes)
 * @param {Function} [opts.agora]     relógio injetável (testes)
 * @param {number} [opts.inicio]      instante do começo do POST (para `fim.ms`)
 * @param {number} [opts.prazo]       instante absoluto do fim (timestamp)
 * @param {object} [opts.estado]      `{rodadas, ferramentas}` compartilhado com o watchdog
 * @param {AbortSignal} [opts.sinal]  aborta quando o encerramento/erro manda parar
 * @param {AbortSignal} [opts.sinalCliente] sinal da requisição (desconexão real do cliente)
 * @returns {Promise<{ok: boolean, rodadas: number, ms: number,
 *                    codigo?: string, abortado?: boolean}>}
 */
export async function executarLaco({
  sessao,
  chamarModelo,
  emitir,
  instrucoes = '',
  pergunta = '',
  anteriores = [],
  hoje = diaBrasilia(),
  tools = [],
  tetos = {},
  agora = () => Date.now(),
  inicio: inicioPedido,
  prazo,
  estado = { rodadas: 0, ferramentas: 0 },
  sinal,
  sinalCliente,
  encerrar: encerrarInjetado,
}) {
  const limites = { ...TETOS, ...tetos };
  const inicio = Number.isFinite(inicioPedido) ? inicioPedido : agora();
  const limite = Number.isFinite(prazo) ? prazo : inicio + limites.ms;

  let rodadas = 0;
  let ferramentas = 0;
  let blocosEmitidos = 0;
  estado.rodadas = 0;
  estado.ferramentas = 0;

  const decorrido = () => agora() - inicio;
  const expirado = () => agora() >= limite;
  const abortado = () => Boolean(sinal?.aborted);
  const duracaoSegundos = Math.max(1, Math.round((limite - inicio) / 1000));
  const mensagemTempo = () =>
    `A análise passou de ${duracaoSegundos} s e foi interrompida. ` +
    'Tente uma pergunta mais específica.';

  // Em produção, `index.js` injeta o encerrador (dono único do `fim`). Sem ele
  // — testes diretos do laço —, o padrão escreve os mesmos eventos pelo
  // `emitir`, sem conhecer SSE.
  const encerrar =
    encerrarInjetado ??
    (async ({ erro, desconectado = false } = {}) => {
      if (desconectado) return false;
      if (erro) await emitir('erro', erro);
      await emitir('fim', { rodadas: estado.rodadas ?? 0, ms: decorrido() });
      return true;
    });

  const interromper = async () => {
    // Só a desconexão do cliente encerra em modo desconexão. O sinal interno
    // também aborta quando o encerrador erra/praza; tratar isso como
    // desconexão apagaria o `erro`/`fim` que já estavam na fila.
    if (sinalCliente?.aborted) await encerrar({ desconectado: true });
    return { ok: false, abortado: true, rodadas, ms: decorrido() };
  };

  async function emitirPasso(ferramenta, estadoPasso, erro) {
    const dados = {
      ferramenta,
      rotulo: rotuloDaFerramenta(ferramenta),
      estado: estadoPasso,
    };
    if (erro) dados.erro = cortarErro(erro);
    return emitir('passo', dados);
  }

  async function encerrarComErro(codigo, mensagem) {
    if (abortado()) return interromper();
    await encerrar({ erro: { codigo, mensagem } });
    return { ok: false, codigo, rodadas, ms: decorrido() };
  }

  // ── Contexto ────────────────────────────────────────────────────────────
  const historico = Array.isArray(anteriores) ? anteriores.slice(0, 5) : [];
  let sistema = String(instrucoes || '').trim();
  if (hoje) {
    sistema += `${sistema ? '\n\n' : ''}Hoje é ${hoje} (fuso de Brasília).`;
  }
  if (historico.length) {
    const linhas = historico.map((item, i) => {
      const p = String(item?.pergunta ?? '').trim().slice(0, 500);
      const r = String(item?.resumo ?? '').trim().slice(0, 1_000);
      return `${i + 1}. Pergunta: ${p}\n   Resumo da resposta: ${r}`;
    });
    sistema +=
      '\n\nPerguntas anteriores desta conversa (só contexto; não são o pedido atual):\n' +
      linhas.join('\n');
  }

  const mensagens = [];
  if (sistema) mensagens.push({ role: 'system', content: sistema });
  mensagens.push({ role: 'user', content: String(pergunta ?? '') });

  try {
    while (rodadas < limites.rodadas) {
      if (abortado()) return interromper();
      if (expirado()) return await encerrarComErro('tempo', mensagemTempo());

      rodadas += 1;
      estado.rodadas = rodadas;

      let resposta;
      try {
        resposta = await chamarModelo({
          mensagens,
          tools,
          timeoutMs: Math.max(1, timeoutEfetivo(limite, TETO_POR_CHAMADA_MS, agora)),
          prazo: limite,
          sinal,
        });
      } catch (e) {
        if (e?.codigo === 'abortado' || abortado()) return interromper();
        if (expirado()) return await encerrarComErro('tempo', mensagemTempo());
        const codigo =
          e?.codigo === 'tempo' || e?.codigo === 'interno' ? e.codigo : 'modelo';
        const mensagem =
          codigo === 'tempo'
            ? 'O modelo não respondeu a tempo.'
            : codigo === 'interno'
              ? 'O modelo não está configurado no Worker.'
              : 'O modelo falhou ou devolveu uma resposta inválida.';
        return await encerrarComErro(codigo, mensagem);
      }

      // Resposta que chega depois do prazo não vira texto, mesmo que o fetch
      // tenha ignorado o AbortSignal.
      if (abortado()) return interromper();
      if (expirado()) return await encerrarComErro('tempo', mensagemTempo());

      const mensagem = resposta?.message;
      if (!mensagem || typeof mensagem !== 'object') {
        return await encerrarComErro('modelo', 'A resposta do modelo veio sem "message".');
      }

      const chamadas = Array.isArray(mensagem.tool_calls) ? mensagem.tool_calls : [];

      // Com tool_calls, `content` nulo/ausente é normal. Qualquer outro tipo
      // (objeto, número, array) é resposta inválida do modelo e não pode ir
      // para o histórico como `[object Object]`.
      if (
        chamadas.length &&
        mensagem.content != null &&
        typeof mensagem.content !== 'string'
      ) {
        return await encerrarComErro('modelo', 'O modelo não respondeu em texto.');
      }

      // ── Resposta final ────────────────────────────────────────────────
      if (!chamadas.length) {
        if (typeof mensagem.content !== 'string') {
          return await encerrarComErro('modelo', 'O modelo não respondeu em texto.');
        }
        const conteudo = mensagem.content.trim();
        if (!conteudo) {
          return await encerrarComErro('modelo', 'O modelo não respondeu.');
        }

        const marcado = await sessao.marcarTexto(conteudo);
        if (abortado()) return interromper();
        if (expirado()) return await encerrarComErro('tempo', mensagemTempo());
        if (!textoMarcadoValido(marcado)) {
          return await encerrarComErro(
            'interno',
            'A sessão devolveu o texto num formato inválido.',
          );
        }

        await emitir('texto', { texto: marcado.texto, semOrigem: marcado.semOrigem });
        await encerrar();
        return { ok: true, rodadas, ms: decorrido() };
      }

      // Chegou ao teto de rodadas ainda pedindo ferramenta: não adianta
      // executar a última leva (o resultado não voltaria ao modelo).
      if (rodadas >= limites.rodadas) {
        if (blocosEmitidos > 0) {
          return await encerrarComErro('incompleta', MENSAGEM_INCOMPLETA);
        }
        return await encerrarComErro(
          'interno',
          `O modelo não chegou a uma resposta em ${limites.rodadas} rodadas. ` +
            'Tente uma pergunta mais específica.',
        );
      }

      mensagens.push({
        role: 'assistant',
        content: typeof mensagem.content === 'string' ? mensagem.content : '',
        tool_calls: chamadas,
      });

      // ── Ferramentas da rodada ──────────────────────────────────────────
      for (const chamada of chamadas) {
        if (abortado()) return interromper();
        if (expirado()) return await encerrarComErro('tempo', mensagemTempo());
        if (ferramentas >= limites.ferramentas) {
          return await encerrarComErro(
            'interno',
            `O modelo pediu mais de ${limites.ferramentas} consultas e foi interrompido. ` +
              'Tente uma pergunta mais específica.',
          );
        }
        ferramentas += 1;
        estado.ferramentas = ferramentas;

        const fn = chamada?.function ?? chamada ?? {};
        const nome = typeof fn.name === 'string' ? fn.name : '';

        if (!nome) {
          const motivo = cortarErro('A chamada veio sem nome de ferramenta.');
          await emitirPasso('desconhecida', 'erro', motivo);
          mensagens.push(mensagemDeTool(chamada, '', { erro: motivo }));
          continue;
        }

        let args;
        try {
          args = lerArgumentos(fn.arguments);
        } catch (e) {
          const motivo = cortarErro(e?.message ?? 'Argumentos inválidos.');
          await emitirPasso(nome, 'erro', motivo);
          mensagens.push(mensagemDeTool(chamada, nome, { erro: motivo }));
          continue;
        }

        const passoIniciou = await emitirPasso(nome, 'inicio');
        if (passoIniciou === false || abortado()) return interromper();

        // ── criar_bloco ──────────────────────────────────────────────────
        if (nome === 'criar_bloco') {
          let saida;
          try {
            saida = await sessao.criarBloco(args);
          } catch (e) {
            saida = { erro: e?.message ?? 'Falha ao montar o bloco.' };
          }
          if (abortado()) return interromper();
          if (expirado()) return await encerrarComErro('tempo', mensagemTempo());

          if (saida?.erro) {
            const motivo = cortarErro(saida.erro);
            await emitirPasso(nome, 'erro', motivo);
            mensagens.push(mensagemDeTool(chamada, nome, { erro: motivo }));
            continue;
          }

          let blocoTela;
          try {
            blocoTela = await sessao.reidratar(saida.bloco);
          } catch {
            return await encerrarComErro(
              'interno',
              'O bloco foi aceito mas não pôde ser entregue à tela.',
            );
          }
          if (abortado()) return interromper();
          if (expirado()) return await encerrarComErro('tempo', mensagemTempo());
          if (!blocoTela || typeof blocoTela !== 'object') {
            return await encerrarComErro(
              'interno',
              'O bloco foi aceito mas voltou num formato inválido.',
            );
          }

          await emitirPasso(nome, 'fim');
          await emitir('bloco', blocoTela);
          blocosEmitidos += 1;
          const recibo = saida.bloco?.id ? { id: saida.bloco.id } : { ok: true };
          mensagens.push(mensagemDeTool(chamada, nome, recibo));
          continue;
        }

        // ── calcular ─────────────────────────────────────────────────────
        if (nome === 'calcular') {
          let saida;
          try {
            saida = await sessao.calcular(args);
          } catch (e) {
            saida = { erro: e?.message ?? 'Falha na conta.' };
          }
          if (abortado()) return interromper();
          if (expirado()) return await encerrarComErro('tempo', mensagemTempo());

          if (saida?.erro) {
            const motivo = cortarErro(saida.erro);
            await emitirPasso(nome, 'erro', motivo);
            mensagens.push(mensagemDeTool(chamada, nome, { erro: motivo }));
            continue;
          }

          const conteudo = textoDoResultado(saida?.paraModelo ?? {});
          if (conteudo.length > limites.resultadoChars) {
            const aviso = avisoResultadoGrande(conteudo.length, limites.resultadoChars);
            await emitirPasso(nome, 'erro', aviso.erro);
            mensagens.push(mensagemDeTool(chamada, nome, aviso));
            continue;
          }

          await emitirPasso(nome, 'fim');
          mensagens.push(mensagemDeTool(chamada, nome, conteudo));
          continue;
        }

        // ── Ferramentas de consulta ──────────────────────────────────────
        let saida;
        try {
          saida = await sessao.executar(nome, args);
        } catch (e) {
          saida = { erro: e?.message ?? 'Falha na consulta.' };
        }
        if (abortado()) return interromper();
        if (expirado()) return await encerrarComErro('tempo', mensagemTempo());

        if (saida?.erro) {
          const motivo = cortarErro(saida.erro);
          await emitirPasso(nome, 'erro', motivo);
          mensagens.push(mensagemDeTool(chamada, nome, { erro: motivo }));
          continue;
        }

        const conteudo = textoDoResultado(saida?.paraModelo ?? {});
        if (conteudo.length > limites.resultadoChars) {
          const aviso = avisoResultadoGrande(conteudo.length, limites.resultadoChars);
          await emitirPasso(nome, 'erro', aviso.erro);
          mensagens.push(mensagemDeTool(chamada, nome, aviso));
          continue;
        }

        await emitirPasso(nome, 'fim');
        mensagens.push(mensagemDeTool(chamada, nome, conteudo));
      }
    }

    if (blocosEmitidos > 0) {
      return await encerrarComErro('incompleta', MENSAGEM_INCOMPLETA);
    }
    return await encerrarComErro(
      'interno',
      `O modelo não chegou a uma resposta em ${limites.rodadas} rodadas. ` +
        'Tente uma pergunta mais específica.',
    );
  } catch {
    // Defeito inesperado (sessão que lança fora dos pontos tratados, emissor
    // quebrado etc.). Não inclui a mensagem original: ela pode carregar
    // conteúdo da conversa, e este arquivo não é lugar de vazar isso.
    return await encerrarComErro(
      'interno',
      'A análise falhou por um erro interno. Tente de novo.',
    );
  }
}
