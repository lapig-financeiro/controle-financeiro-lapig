// Leitor de SSE da bancada — o mesmo formato que a tela vai ler.
//
// Sem dependência nova: lê o ReadableStream, junta os pedaços com um
// TextDecoder (stream: true), separa os eventos por linha em branco e devolve
// `{ evento, dados, ms }` na ordem em que chegaram. O `ms` é relativo ao começo
// da pergunta, para o `eventos.jsonl` guardar os tempos.

export async function lerEventos(stream, { inicio = Date.now(), agora = Date.now } = {}) {
  if (!stream || typeof stream.getReader !== 'function') {
    throw new Error('A resposta da bancada não tem corpo para ler o SSE.');
  }

  const leitor = stream.getReader();
  const decodificador = new TextDecoder();
  const eventos = [];
  let buffer = '';

  function processar(bloco) {
    if (!bloco || !bloco.trim()) return;
    // Comentário SSE (`: ping`) não é evento; a tela e a bancada ignoram.
    if (!/(^|\n)(event|data):/.test(bloco)) return;

    let evento = 'message';
    const dados = [];
    for (const linha of bloco.split(/\r?\n/)) {
      if (!linha || linha.startsWith(':')) continue;
      if (linha.startsWith('event:')) {
        evento = linha.slice('event:'.length).trim() || evento;
        continue;
      }
      if (linha.startsWith('data:')) {
        dados.push(linha.slice('data:'.length).replace(/^ /, ''));
      }
    }

    const bruto = dados.join('\n');
    if (!bruto) {
      // O contrato do Worker sempre manda data; um evento sem data é registrado
      // como veio para o relatório poder acusar.
      eventos.push({ evento, dados: null, semData: true, ms: agora() - inicio });
      return;
    }

    try {
      eventos.push({ evento, dados: JSON.parse(bruto), ms: agora() - inicio });
    } catch {
      eventos.push({
        evento,
        dados: null,
        erro: 'JSON inválido no evento',
        bruto,
        ms: agora() - inicio,
      });
    }
  }

  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      buffer += decodificador.decode(value, { stream: true });

      while (true) {
        const separador = /\r?\n\r?\n/.exec(buffer);
        if (!separador) break;
        const bloco = buffer.slice(0, separador.index);
        buffer = buffer.slice(separador.index + separador[0].length);
        processar(bloco);
      }
    }

    buffer += decodificador.decode();
    if (buffer.trim()) processar(buffer);
  } finally {
    try {
      leitor.releaseLock();
    } catch {
      // O stream pode já ter sido fechado/abortado; nada a liberar.
    }
  }

  return eventos;
}
