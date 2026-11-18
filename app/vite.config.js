import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const CSP_BUILD = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
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

export default defineConfig({
  plugins: [preact(), cspApenasNoBuild()],
  base: '/controle-financeiro-lapig/v2/',
  server: {
    fs: {
      allow: ['..'],
    },
  },
});
