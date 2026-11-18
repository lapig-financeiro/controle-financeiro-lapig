import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extrairTokens, verificarArquivo, verificarEstilo } from '../scripts/verificar-estilo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIRETORIO_SRC = path.resolve(__dirname, '../src');
const TOKENS_DEFINIDOS = extrairTokens(
  fs.readFileSync(path.join(DIRETORIO_SRC, 'estilo/tokens.css'), 'utf8')
);

describe('verificar-estilo', () => {
  it('aprova todo o código em app/src', () => {
    const problemas = verificarEstilo(DIRETORIO_SRC);
    expect(problemas).toEqual([]);
  });

  it('reprova style= inline em JSX, exceto variáveis CSS', () => {
    const ruimObj = verificarArquivo('paginas/Ruim.jsx', '<div style={{ color: "red" }}>x</div>', TOKENS_DEFINIDOS);
    expect(ruimObj.some((p) => p.regra === 'style-inline')).toBe(true);

    const ruimStr = verificarArquivo('paginas/Ruim.jsx', '<div style="margin: 8px">x</div>', TOKENS_DEFINIDOS);
    expect(ruimStr.some((p) => p.regra === 'style-inline')).toBe(true);

    const permitidoVar = verificarArquivo('paginas/Bom.jsx', "<div style={{ '--largura': '50%' }}>x</div>", TOKENS_DEFINIDOS);
    expect(permitidoVar).toEqual([]);
  });

  it('reprova cores literais (hex e rgb) fora de tokens.css', () => {
    const cssRuim = verificarArquivo('componentes/Ruim.css', '.x { color: #123456; background: rgb(1, 2, 3); }', TOKENS_DEFINIDOS);
    expect(cssRuim.filter((p) => p.regra === 'cor-literal')).toHaveLength(2);

    const jsxRuim = verificarArquivo('componentes/Ruim.jsx', "const cor = '#ABCDEF';", TOKENS_DEFINIDOS);
    expect(jsxRuim.some((p) => p.regra === 'cor-literal')).toBe(true);

    const tokens = verificarArquivo('estilo/tokens.css', ':root { --cor-fundo: #F5F5F2; }', TOKENS_DEFINIDOS);
    expect(tokens).toEqual([]);
  });

  it('reprova px, ms e vh literais fora de tokens.css, permitindo 1px, 0 e @media 640/1024', () => {
    const cssRuim = verificarArquivo(
      'componentes/Ruim.css',
      '.x { width: 120px; transition: opacity 250ms; height: 80vh; }',
      TOKENS_DEFINIDOS
    );
    expect(cssRuim.filter((p) => p.regra === 'medida-literal')).toHaveLength(3);

    const cssPermitido = verificarArquivo(
      'componentes/Bom.css',
      '@media (max-width: 640px) { .x { border: 1px solid var(--cor-borda); padding: 0; } }',
      TOKENS_DEFINIDOS
    );
    expect(cssPermitido).toEqual([]);
  });

  it('reprova z-index literal e @media fora de 640px/1024px', () => {
    const cssZ = verificarArquivo('componentes/Ruim.css', '.x { z-index: 99; }', TOKENS_DEFINIDOS);
    expect(cssZ.some((p) => p.regra === 'z-index-literal')).toBe(true);

    const cssMedia = verificarArquivo('componentes/Ruim.css', '@media (max-width: 768px) { .x { padding: 0; } }', TOKENS_DEFINIDOS);
    expect(cssMedia.some((p) => p.regra === 'media-invalida')).toBe(true);
  });

  it('reprova font-weight fora de 400/500/600', () => {
    const css = `
      .ruim {
        font-size: var(--fs-2);
        font-weight: 700;
        border-radius: var(--raio-1);
      }
      .outro {
        font-weight: bold;
      }
    `;
    const problemas = verificarArquivo('componentes/Ruim.css', css, TOKENS_DEFINIDOS);
    expect(problemas.filter((p) => p.regra === 'peso-proibido')).toHaveLength(2);
  });

  it('reprova var(--x) que não existe em tokens.css', () => {
    const css = '.x { color: var(--cor-inventada); }';
    const problemas = verificarArquivo('componentes/Ruim.css', css, TOKENS_DEFINIDOS);
    expect(problemas.some((p) => p.regra === 'token-inexistente')).toBe(true);

    const jsx = 'const s = "var(--esp-inexistente)";';
    const problemasJsx = verificarArquivo('componentes/Ruim.jsx', jsx, TOKENS_DEFINIDOS);
    expect(problemasJsx.some((p) => p.regra === 'token-inexistente')).toBe(true);
  });

  it('reprova diretório temporário contendo arquivo fora do padrão', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estilo-ruim-'));
    try {
      fs.writeFileSync(path.join(tmp, 'Quebrado.css'), '.x { padding: 18px; color: #ff0000; }\n');
      const problemas = verificarEstilo(tmp, path.join(DIRETORIO_SRC, 'estilo/tokens.css'));
      expect(problemas.length).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
