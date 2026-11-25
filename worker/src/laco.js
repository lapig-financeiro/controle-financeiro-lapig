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
   ============================================================ */

import { diaBrasilia } from './limite.js';

export const TETOS = Object.freeze({
  rodadas: 8,
  ferramentas: 30,
  resultadoChars: 60_000,
  ms: 120_000,
});

/** Erro que o chamador do modelo usa para dizer POR QUE falhou. */
export class ErroModelo extends Error {
  constructor(mensagem, codigo = 'modelo') {
    super(mensagem);
    this.name = 'ErroModelo';
    this.codigo = codigo;
  }
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

/**
 * Roda uma pergunta até o modelo responder em texto.
 *
 * @param {object} opts
 * @param {object} opts.sessao        sessão do pacote `shared/ai-tools` (contrato §4)
 * @param {Function} opts.chamarModelo `({mensagens, tools, timeoutMs}) => resposta do /api/chat`
 * @param {Function} opts.emitir      `(nomeEvento, dados) => Promise<boolean>`
 * @param {string} opts.instrucoes    `INSTRUCOES` do pacote, injetado
 * @param {string} opts.pergunta
 * @param {Array}  [opts.anteriores]  `[{pergunta, resumo}]`, até 5
 * @param {string} [opts.hoje]        `AAAA-MM-DD` no fuso de Brasília
 * @param {Array}  [opts.tools]       especificações no formato do Ollama
 * @param {object} [opts.tetos]       sobrescreve `TETOS` (testes)
 * @param {Function} [opts.agora]     relógio injetável (testes)
 * @param {AbortSignal} [opts.sinal]  aborta quando o cliente desconecta
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
  sinal,
}) {
  const limites = { ...TETOS, ...tetos };
  const inicio = agora();
  let rodadas = 0;
  let ferramentas = 0;

  const decorrido = () => agora() - inicio;
  const abortado = () => Boolean(sinal?.aborted);

  async function emitirPasso(ferramenta, estado, erro) {
    const dados = {
      ferramenta,
      rotulo: rotuloDaFerramenta(ferramenta),
      estado,
    };
    if (erro) dados.erro = erro;
    return emitir('passo', dados);
  }

  async function encerrarComErro(codigo, mensagem) {
    if (abortado()) {
      return { ok: false, abortado: true, rodadas, ms: decorrido() };
    }
    await emitir('erro', { codigo, mensagem });
    const ms = decorrido();
    await emitir('fim', { rodadas, ms });
    return { ok: false, codigo, rodadas, ms };
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
      if (abortado()) {
        return { ok: false, abortado: true, rodadas, ms: decorrido() };
      }
      if (decorrido() >= limites.ms) {
        return await encerrarComErro(
          'tempo',
          `A análise passou de ${Math.round(limites.ms / 1000)} s e foi interrompida. ` +
            'Tente uma pergunta mais específica.',
        );
      }

      rodadas += 1;

      let resposta;
      try {
        resposta = await chamarModelo({
          mensagens,
          tools,
          timeoutMs: Math.max(1, Math.min(limites.ms - decorrido(), limites.ms)),
        });
      } catch (e) {
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

      const mensagem = resposta?.message;
      if (!mensagem || typeof mensagem !== 'object') {
        return await encerrarComErro('modelo', 'A resposta do modelo veio sem "message".');
      }

      const chamadas = Array.isArray(mensagem.tool_calls) ? mensagem.tool_calls : [];

      // ── Resposta final ────────────────────────────────────────────────
      if (!chamadas.length) {
        const conteudo = String(mensagem.content ?? '').trim();
        const marcado = await sessao.marcarTexto(conteudo);
        await emitir('texto', {
          texto: typeof marcado?.texto === 'string' ? marcado.texto : '',
          semOrigem: Array.isArray(marcado?.semOrigem) ? marcado.semOrigem : [],
        });
        const ms = decorrido();
        await emitir('fim', { rodadas, ms });
        return { ok: true, rodadas, ms };
      }

      // Chegou ao teto de rodadas ainda pedindo ferramenta: não adianta
      // executar a última leva (o resultado não voltaria ao modelo).
      if (rodadas >= limites.rodadas) {
        return await encerrarComErro(
          'interno',
          `O modelo não chegou a uma resposta em ${limites.rodadas} rodadas. ` +
            'Tente uma pergunta mais específica.',
        );
      }

      mensagens.push({
        role: 'assistant',
        content: String(mensagem.content ?? ''),
        tool_calls: chamadas,
      });

      // ── Ferramentas da rodada ──────────────────────────────────────────
      for (const chamada of chamadas) {
        if (abortado()) {
          return { ok: false, abortado: true, rodadas, ms: decorrido() };
        }
        if (decorrido() >= limites.ms) {
          return await encerrarComErro(
            'tempo',
            `A análise passou de ${Math.round(limites.ms / 1000)} s e foi interrompida. ` +
              'Tente uma pergunta mais específica.',
          );
        }
        if (ferramentas >= limites.ferramentas) {
          return await encerrarComErro(
            'interno',
            `O modelo pediu mais de ${limites.ferramentas} consultas e foi interrompido. ` +
              'Tente uma pergunta mais específica.',
          );
        }
        ferramentas += 1;

        const fn = chamada?.function ?? chamada ?? {};
        const nome = typeof fn.name === 'string' ? fn.name : '';

        if (!nome) {
          await emitirPasso('desconhecida', 'erro', 'A chamada veio sem nome de ferramenta.');
          mensagens.push(
            mensagemDeTool(chamada, '', { erro: 'A chamada veio sem nome de ferramenta.' }),
          );
          continue;
        }

        let args;
        try {
          args = lerArgumentos(fn.arguments);
        } catch (e) {
          const motivo = e?.message ?? 'Argumentos inválidos.';
          await emitirPasso(nome, 'erro', motivo);
          mensagens.push(mensagemDeTool(chamada, nome, { erro: motivo }));
          continue;
        }

        const passoIniciou = await emitirPasso(nome, 'inicio');
        if (passoIniciou === false || abortado()) {
          return { ok: false, abortado: true, rodadas, ms: decorrido() };
        }

        // ── criar_bloco ──────────────────────────────────────────────────
        if (nome === 'criar_bloco') {
          let saida;
          try {
            saida = await sessao.criarBloco(args);
          } catch (e) {
            saida = { erro: e?.message ?? 'Falha ao montar o bloco.' };
          }

          if (saida?.erro) {
            const motivo = String(saida.erro);
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
          if (!blocoTela || typeof blocoTela !== 'object') {
            return await encerrarComErro(
              'interno',
              'O bloco foi aceito mas voltou num formato inválido.',
            );
          }

          await emitirPasso(nome, 'fim');
          await emitir('bloco', blocoTela);
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

          if (saida?.erro) {
            const motivo = String(saida.erro);
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

        if (saida?.erro) {
          const motivo = String(saida.erro);
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
