import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
const __dirname = path.dirname(fileURLToPath(import.meta.url));

vi.mock('../src/servicos/supabase.js', () => ({
  SUPABASE_URL: 'https://exemplo.supabase.co',
  SUPABASE_KEY: 'chave-publica',
  supabase: {
    auth: { getSession: vi.fn() },
    rpc: rpcMock,
  },
}));

import { enviarFeedback, executarAnalise } from '../src/servicos/analise.js';

beforeEach(() => {
  rpcMock.mockReset();
  vi.stubEnv('VITE_DADOS', 'exemplo');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('serviço no modo exemplo', () => {
  it('executarAnalise usa o módulo sintético e não chama a rede', async () => {
    const fetchImpl = vi.fn();
    const onBloco = vi.fn();
    const onFim = vi.fn();

    const resultado = await executarAnalise({
      pergunta: 'Quanto o 30.910 tem livre?',
      fetchImpl,
      atraso: 0,
      onBloco,
      onFim,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(true);
    expect(resultado.registro).toEqual(expect.any(String));
    expect(resultado.conversa).toEqual(expect.any(String));
    expect(resultado.ordem).toBe(1);
    expect(resultado.blocos).toHaveLength(4);
    expect(onBloco).toHaveBeenCalledTimes(4);
    expect(onFim).toHaveBeenCalledWith({ rodadas: 4, ms: 12000 });
  });

  it('enviarFeedback responde sucesso sem tocar o banco', async () => {
    const resultado = await enviarFeedback('registro-exemplo', { nota: 1 });

    expect(resultado).toEqual({ id: 'registro-exemplo', erro: null });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('o bundle de produção não pode importar analiseExemplo.js: o import dinâmico fica sob DEV + VITE_DADOS', () => {
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '../src/servicos/analise.js'),
      'utf8'
    );
    const inicio = fonte.indexOf('export async function executarAnalise');
    const fim = fonte.indexOf('const jwt = await resolverToken', inicio);
    const trecho = fonte.slice(inicio, fim);

    expect(trecho).toContain(
      "import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo'"
    );
    expect(trecho).toContain("import('./analiseExemplo.js')");
    expect(fonte).not.toMatch(/^\s*import\s+[^;]*analiseExemplo/m);
  });
});
