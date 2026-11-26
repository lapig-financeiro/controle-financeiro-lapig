import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../..');
const SCRIPT = path.join(RAIZ, 'worker', 'src', 'build-edge.mjs');
const GERADO = path.join(RAIZ, 'supabase', 'functions', 'analise', 'nucleo.gerado.js');
const ENTRADA = path.join(RAIZ, 'supabase', 'functions', 'analise', 'index.ts');

describe('build da Edge Function', () => {
  let conteudo;

  beforeAll(async () => {
    // O arquivo gerado não é versionado; o teste roda o build de verdade.
    execFileSync(process.execPath, [SCRIPT], { cwd: RAIZ, stdio: 'pipe' });
    conteudo = await readFile(GERADO, 'utf8');
  });

  it('gera um único ESM com o que a entrada importa', async () => {
    expect(conteudo).toContain('export {');
    expect(conteudo).toContain('GERADO por');

    const modulo = await import(`${pathToFileURL(GERADO).href}?teste=${Date.now()}`);
    expect(typeof modulo.tratar).toBe('function');
    expect(typeof modulo.criarContadorRpc).toBe('function');
    expect(typeof modulo.tetoDoAmbiente).toBe('function');
    expect(typeof modulo.normalizarCaminhoEdge).toBe('function');
  });

  it('a entrada Deno importa exatamente esses nomes', async () => {
    const entrada = await readFile(ENTRADA, 'utf8');
    for (const nome of [
      'tratar',
      'criarContadorRpc',
      'tetoDoAmbiente',
      'normalizarCaminhoEdge',
    ]) {
      expect(entrada).toContain(nome);
    }
    expect(entrada).toContain('./nucleo.gerado.js');
  });

  it('o bundle não ficou gigante nem carrega import externo', async () => {
    expect(Buffer.byteLength(conteudo, 'utf8')).toBeLessThan(500_000);
    expect(conteudo).not.toMatch(/^import\s/m);
  });
});
