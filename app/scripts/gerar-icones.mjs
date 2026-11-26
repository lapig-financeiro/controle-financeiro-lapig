import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const playwrightDoApp = join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime',
  'dependencies', 'node', 'node_modules', 'playwright');
const playwright = process.env.PLAYWRIGHT_PATH
  ?? (existsSync(playwrightDoApp) ? playwrightDoApp : 'playwright');
const { chromium } = require(playwright);

const publicUrl = new URL('../public/', import.meta.url);
const tokens = readFileSync(new URL('../src/estilo/tokens.css', import.meta.url), 'utf8');
const superficie = tokens.match(/--cor-superficie:\s*(#[\da-f]{6});/i)?.[1];
if (!superficie) throw new Error('Token --cor-superficie ausente ou inválido.');

const svgEmDataUrl = (arquivo) =>
  `data:image/svg+xml;base64,${readFileSync(new URL(arquivo, publicUrl)).toString('base64')}`;

const icones = [
  { nome: 'favicon-32.png', tamanho: 32, desenho: 32, origem: 'favicon' },
  { nome: 'apple-touch-icon.png', tamanho: 180, desenho: 135, fundo: superficie },
  { nome: 'icone-192.png', tamanho: 192, desenho: 144, fundo: superficie },
  { nome: 'icone-512.png', tamanho: 512, desenho: 384, fundo: superficie },
  // O quadrado de 288 px cabe inteiro no círculo com diâmetro de 80% de 512 px.
  { nome: 'icone-maskable-512.png', tamanho: 512, desenho: 288, fundo: superficie },
];

const navegador = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  executablePath: process.env.NAVEGADOR_CHROMIUM,
});
try {
  const pagina = await navegador.newPage({ deviceScaleFactor: 1 });
  await pagina.setContent(`
    <img id="simbolo" hidden src="${svgEmDataUrl('marca/buriti-simbolo.svg')}">
    <img id="favicon" hidden src="${svgEmDataUrl('favicon.svg')}">
  `);
  const pngs = await pagina.evaluate(async (configuracoes) => {
    await Promise.all(Array.from(document.images, (img) => img.decode()));
    return configuracoes.map(({ tamanho, desenho, fundo, origem = 'simbolo' }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = tamanho;
      const ctx = canvas.getContext('2d', { alpha: !fundo });
      if (fundo) {
        ctx.fillStyle = fundo;
        ctx.fillRect(0, 0, tamanho, tamanho);
      }
      const margem = (tamanho - desenho) / 2;
      ctx.drawImage(document.getElementById(origem), margem, margem, desenho, desenho);
      return canvas.toDataURL('image/png').split(',')[1];
    });
  }, icones);

  icones.forEach(({ nome }, i) => {
    writeFileSync(new URL(nome, publicUrl), Buffer.from(pngs[i], 'base64'));
    console.log(nome);
  });
} finally {
  await navegador.close();
}
