// PDF sintético mínimo de balancete (mesma ideia de
// app/scripts/gerar-pdf-exemplo.mjs). Só conteúdo inventado.

function escaparTextoPdf(texto) {
  return String(texto)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function construirStreamPagina(linhas) {
  const comandos = ['BT'];
  for (const item of linhas) {
    const fonte = item.negrito ? '/F2' : '/F1';
    const tamanho = item.tamanho || 10;
    comandos.push(`${fonte} ${tamanho} Tf`);
    if (Array.isArray(item.colunas)) {
      for (const col of item.colunas) {
        comandos.push(`1 0 0 1 ${col.x} ${item.y} Tm (${escaparTextoPdf(col.texto)}) Tj`);
      }
    } else {
      comandos.push(`1 0 0 1 ${item.x ?? 42} ${item.y} Tm (${escaparTextoPdf(item.texto)}) Tj`);
    }
  }
  comandos.push('ET');
  return comandos.join('\n');
}

export function montarPdfBytes(paginasLinhas) {
  const objetos = [];
  const adicionarObjeto = (corpo) => {
    objetos.push(corpo);
    return objetos.length;
  };

  adicionarObjeto('');
  adicionarObjeto('');
  const idFonteNormal = adicionarObjeto(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const idFonteNegrito = adicionarObjeto(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  const idsPaginas = [];
  for (const linhas of paginasLinhas) {
    const stream = construirStreamPagina(linhas);
    const bytesStream = Buffer.byteLength(stream, 'latin1');
    const idConteudo = adicionarObjeto(`<< /Length ${bytesStream} >>\nstream\n${stream}\nendstream`);
    const idPagina = adicionarObjeto(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + `/Resources << /Font << /F1 ${idFonteNormal} 0 R /F2 ${idFonteNegrito} 0 R >> >> `
      + `/Contents ${idConteudo} 0 R >>`,
    );
    idsPaginas.push(idPagina);
  }

  objetos[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[1] = `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(' ')}] /Count ${idsPaginas.length} >>`;

  const partes = ['%PDF-1.4\n'];
  const offsets = [0];
  let cursor = Buffer.byteLength(partes[0], 'latin1');

  for (let i = 0; i < objetos.length; i += 1) {
    offsets.push(cursor);
    const bloco = `${i + 1} 0 obj\n${objetos[i]}\nendobj\n`;
    partes.push(bloco);
    cursor += Buffer.byteLength(bloco, 'latin1');
  }

  const inicioXref = cursor;
  const xrefLinhas = [`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`];
  for (let i = 1; i <= objetos.length; i += 1) {
    xrefLinhas.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  const trailer = `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\n`
    + `startxref\n${inicioXref}\n%%EOF\n`;

  partes.push(xrefLinhas.join(''), trailer);
  return Buffer.from(partes.join(''), 'latin1');
}

/** Uma linha do balancete com as colunas usuais (conta, reduzido, …). */
export function linhaContabil(y, conta, reduzido, descricao, debitos, creditos, saldo, negrito = false) {
  return {
    y,
    tamanho: 9,
    negrito,
    colunas: [
      { x: 42, texto: conta },
      { x: 145, texto: reduzido },
      { x: 190, texto: descricao },
      { x: 392, texto: debitos },
      { x: 454, texto: creditos },
      { x: 512, texto: saldo },
    ],
  };
}

/** Linha no layout real, com as cinco colunas numéricas como o PDF imprime. */
export function linhaContabilCincoColunas(y, conta, reduzido, descricao, valores, negrito = false) {
  return {
    y,
    tamanho: 9,
    negrito,
    colunas: [
      { x: 42, texto: conta },
      { x: 145, texto: reduzido },
      { x: 190, texto: descricao },
      ...valores.map((texto, indice) => ({ x: 320 + indice * 46, texto })),
    ],
  };
}
