import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// `request.signal` só aborta na desconexão do cliente com a compatibilidade
// `enable_request_signal`, que o workerd 1.20261123.1 (instalado em
// worker/node_modules) liga por padrão a partir de 2026-11-17. O teste trava
// a configuração para ninguém voltar a data sem ver.
const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

describe('configuração do Worker', () => {
  it('liga o sinal de desconexão do cliente (data 2026-11-17 ou flag)', () => {
    const data = /compatibility_date\s*=\s*"([^"]+)"/.exec(toml)?.[1];
    const flags = /compatibility_flags\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1] ?? '';

    expect(data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data >= '2026-11-17' || flags.includes('enable_request_signal')).toBe(true);
  });
});
