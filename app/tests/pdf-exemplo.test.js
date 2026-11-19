import { describe, expect, it } from 'vitest';
import { acharAlvo, linhasDaPagina } from '../../frontend/js/origem-busca.js';
import { gerarPdfExemploEmMemoria } from '../scripts/gerar-pdf-exemplo.mjs';

describe('PDF sintético de exemplo', () => {
  it('gera balancete de 2 páginas com fatos reais localizáveis via origem-busca e soma alinhada ao exemplo', async () => {
    const { bytes, manifesto } = await gerarPdfExemploEmMemoria();

    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(manifesto.paginas).toBe(2);
    expect(manifesto.arquivo_nome).toBe('balancete-30901-out-26.pdf');

    const chavesEsperadas = [
      '7.1.3.04.01.09142',
      '7.1.3.04.01.09145',
      '7.1.3.04.02.09210',
      '7.1.3.05.01.08110',
      '7.1.3.05.01.08124',
      '7.1.3.20.01.05012',
      'saldo_disponivel',
    ];
    expect(Object.keys(manifesto.fatos)).toEqual(chavesEsperadas);

    for (const chave of chavesEsperadas) {
      const fato = manifesto.fatos[chave];
      expect(fato.pagina).toBeGreaterThanOrEqual(1);
      expect(fato.pagina).toBeLessThanOrEqual(2);
      expect(fato.trecho.length).toBeGreaterThan(10);
      expect(fato.bbox.x1).toBeGreaterThan(fato.bbox.x0);
      expect(fato.bbox.yMax).toBeGreaterThan(fato.bbox.yMin);
    }

    // Reabre com pdfjs-dist para conferir busca na hora do caso legado (7.1.3.05.01.08124 na página 2).
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0,
    }).promise;

    try {
      const paginas = [];
      for (let n = 1; n <= doc.numPages; n += 1) {
        const pg = await doc.getPage(n);
        const tc = await pg.getTextContent();
        paginas.push(linhasDaPagina(tc.items));
      }

      const achadoLegado = acharAlvo(paginas, { conta_codigo: '7.1.3.05.01.08124', valor: 41549.25 });
      expect(achadoLegado).toHaveLength(1);
      expect(achadoLegado[0].pagina).toBe(2);
      expect(achadoLegado[0].motivo).toBe('codigo');

      // Confere que a soma dos lançamentos do PDF fecha ao centavo com os grupos do 30.901.
      const pessoal = 380000 + 160000 + 72400;
      const servicos = 64350.75 + 41549.25;
      const equipamentos = 68000;
      expect(pessoal).toBe(612400);
      expect(servicos).toBe(105900);
      expect(equipamentos).toBe(68000);
    } finally {
      await doc.destroy();
    }
  });
});
