#!/usr/bin/env node
// Gera o bundle único da Edge Function `analise`.
//
// O deploy do Supabase só empacota o que está em `supabase/functions/`; por
// isso o núcleo (worker/src) e o pacote shared/ai-tools são reunidos num
// arquivo só, ao lado da entrada Deno. O arquivo gerado NÃO é versionado:
// está no .gitignore e deve ser refeito antes do deploy.
//
//   npm --prefix worker run build:edge

import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../..');
const ENTRADA = path.join(RAIZ, 'worker', 'src', 'edge.js');
const SAIDA = path.join(RAIZ, 'supabase', 'functions', 'analise', 'nucleo.gerado.js');

export async function gerarBundle({ quiet = false } = {}) {
  await mkdir(path.dirname(SAIDA), { recursive: true });

  await build({
    entryPoints: [ENTRADA],
    outfile: SAIDA,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'esnext',
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
    banner: {
      js: '// GERADO por `npm --prefix worker run build:edge` — NÃO VERSIONAR.',
    },
  });

  const info = await stat(SAIDA);
  if (!quiet) {
    console.log(`Edge Function: ${path.relative(RAIZ, SAIDA)} (${info.size} bytes).`);
  }
  return { caminho: SAIDA, bytes: info.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  gerarBundle().catch((erro) => {
    console.error(`build:edge: ${erro && erro.message ? erro.message : 'erro desconhecido'}`);
    process.exitCode = 1;
  });
}
