import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { garantirPdfExemplo, NOME_PDF_EXEMPLO } from './scripts/gerar-pdf-exemplo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = '/controle-financeiro-lapig/v2/';

const CSP_BUILD = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'self' https://skxiivmkhpegefafdlty.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ') + ';';

function cspApenasNoBuild() {
  return {
    name: 'csp-apenas-no-build',
    transformIndexHtml(html, ctx) {
      if (!ctx?.bundle) return html;
      return html.replace(
        '</head>',
        `  <meta http-equiv="Content-Security-Policy" content="${CSP_BUILD}">\n</head>`
      );
    },
  };
}

function servirExemploNoDev(mode) {
  return {
    name: 'servir-exemplo-no-dev',
    configureServer(server) {
      if (mode !== 'exemplo') return;
      const pastaExemplo = path.resolve(__dirname, '.exemplo');
      const pronto = garantirPdfExemplo(pastaExemplo);

      server.middlewares.use(async (req, res, next) => {
        const caminhoReq = (req.url || '').split('?')[0];
        const rotaPdf = `${BASE}__exemplo/${NOME_PDF_EXEMPLO}`;
        const rotaManifesto = `${BASE}__exemplo/manifesto.json`;
        if (caminhoReq !== rotaPdf && caminhoReq !== rotaManifesto) {
          next();
          return;
        }
        try {
          const gerado = await pronto;
          if (caminhoReq === rotaPdf) {
            const pdf = fs.readFileSync(gerado.caminhoPdf);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/pdf');
            res.end(pdf);
            return;
          }
          const manifesto = fs.readFileSync(gerado.caminhoManifesto, 'utf8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(manifesto);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [preact(), cspApenasNoBuild(), servirExemploNoDev(mode)],
  base: BASE,
  server: {
    fs: {
      allow: ['..'],
    },
  },
}));
