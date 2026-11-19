import { describe, expect, it } from 'vitest';
import { acharAlvo, linhasDaPagina } from '../../frontend/js/origem-busca.js';
import { gerarPdfExemploEmMemoria } from '../scripts/gerar-pdf-exemplo.mjs';
import * as dadosExemplo from '../src/servicos/dadosExemplo.js';

function parsearValorBr(texto) {
  const todos = String(texto || '').match(/\d{1,3}(?:\.\d{3})*,\d{2}/g);
  if (!todos || todos.length === 0) return null;
  const ultimo = todos[todos.length - 1];
  return Number(ultimo.replace(/\./g, '').replace(',', '.'));
}

function coletarFolhasBalancete(no, saida = []) {
  if (!no || typeof no !== 'object') return saida;
  const partes = Array.isArray(no.partes) ? no.partes : [];
  if (partes.length === 0 && no.ref?.alvo_tabela === 'balancete_lancamentos') {
    saida.push(no);
    return saida;
  }
  for (const p of partes) coletarFolhasBalancete(p, saida);
  return saida;
}

describe('PDF sintético de exemplo', () => {
  it('gera balancete de 2 páginas com fatos reais localizáveis via origem-busca e soma alinhada ao exemplo', async () => {
    const { bytes, manifesto } = await gerarPdfExemploEmMemoria();

    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(manifesto.sentinela).toBe('__EXEMPLO_CF__');
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
      'rendimento_liquido',
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

    const arvore = await dadosExemplo.explicarLivre('00000000-0000-4000-8000-000000030901');
    expect(arvore.erro).toBeNull();
    const folhas = coletarFolhasBalancete(arvore.dados);
    expect(folhas).toHaveLength(6);

    // Reabre com pdfjs-dist e compara os valores lidos do PDF com as folhas de explicarLivre do 30.901.
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

      let somaPdfCentavos = 0;
      const lidosPorGrupo = { '7.1.3.04': 0, '7.1.3.05': 0, '7.1.3.20': 0 };

      for (const folha of folhas) {
        const matchCodigo = folha.rotulo.match(/^([0-9.]+)/);
        expect(matchCodigo).not.toBeNull();
        const codigo = matchCodigo[1];

        const achados = acharAlvo(paginas, { conta_codigo: codigo });
        expect(achados).toHaveLength(1);
        const linhaPdf = paginas[achados[0].pagina - 1][achados[0].linha];
        const valorPdf = parsearValorBr(linhaPdf.texto);

        expect(valorPdf).toBe(folha.valor);
        const cent = Math.round(valorPdf * 100);
        somaPdfCentavos += cent;
        const prefixoGrupo = codigo.split('.').slice(0, 4).join('.');
        lidosPorGrupo[prefixoGrupo] += cent;
      }

      // Confere que as linhas sintéticas dos grupos e o TOTAL DE DEBITOS do PDF fecham com a soma das folhas.
      const lerLinhaCodigo = (codigo) => {
        const res = acharAlvo(paginas, { conta_codigo: codigo });
        expect(res).toHaveLength(1);
        return Math.round(parsearValorBr(paginas[res[0].pagina - 1][res[0].linha].texto) * 100);
      };

      expect(lidosPorGrupo['7.1.3.04']).toBe(lerLinhaCodigo('7.1.3.04'));
      expect(lidosPorGrupo['7.1.3.05']).toBe(lerLinhaCodigo('7.1.3.05'));
      expect(lidosPorGrupo['7.1.3.20']).toBe(lerLinhaCodigo('7.1.3.20'));

      const todasLinhas = paginas.flat();
      const linhaTotalDebitos = todasLinhas.find((l) => l.texto.includes('TOTAL DE DEBITOS:'));
      expect(linhaTotalDebitos).toBeDefined();
      const matchTotal = linhaTotalDebitos.texto.match(/TOTAL DE DEBITOS:\s*(\d{1,3}(?:\.\d{3})*,\d{2})/);
      expect(matchTotal).not.toBeNull();
      expect(Math.round(parsearValorBr(matchTotal[1]) * 100)).toBe(somaPdfCentavos);
    } finally {
      await doc.destroy();
    }
  });
});
