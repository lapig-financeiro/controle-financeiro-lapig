import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('../src/servicos/supabase.js', () => ({
  supabase: { rpc: rpcMock },
}));

import {
  balancetes,
  filtroVisao,
  modoExemploAtivo,
  pendencias,
  planos,
  repasses,
  resolverPendencia,
  resumoProjetos,
  saldoLivre,
  salvarFiltroVisao,
} from '../src/servicos/dados.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  rpcMock.mockReset();
});

describe('camada de dados', () => {
  it('erro de RPC devolve { dados: null, erro } e nunca zero ou lista vazia', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'falha no banco' } });

    for (const chamada of [
      () => resumoProjetos(),
      () => pendencias(),
      () => resolverPendencia('id-1', 'resolvida'),
      () => filtroVisao(),
      () => salvarFiltroVisao([]),
      () => saldoLivre('proj-1'),
      () => repasses('proj-1'),
      () => balancetes('proj-1'),
      () => planos('proj-1'),
    ]) {
      const res = await chamada();
      expect(res.dados).toBeNull();
      expect(typeof res.erro).toBe('string');
      expect(res.erro.length).toBeGreaterThan(0);
    }
  });

  it('exceção na chamada RPC ou retorno null vira erro explícito', async () => {
    rpcMock.mockRejectedValueOnce(new Error('sem rede'));
    const falhaRede = await resumoProjetos();
    expect(falhaRede.dados).toBeNull();
    expect(falhaRede.erro).toContain('Não foi possível');

    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const falhaNull = await saldoLivre('proj-1');
    expect(falhaNull.dados).toBeNull();
    expect(falhaNull.erro).toContain('Não foi possível');

    rpcMock.mockResolvedValueOnce({ data: { invalido: true }, error: null });
    const falhaLista = await balancetes('proj-1');
    expect(falhaLista.dados).toBeNull();
    expect(falhaLista.erro).toContain('Não foi possível');
  });

  it('usa as RPCs separadas get_balancetes_by_project e get_planos_historico para documentos', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ id: 'b1' }], error: null });
    rpcMock.mockResolvedValueOnce({ data: [{ id: 'p1' }], error: null });

    const b = await balancetes('proj-1');
    const p = await planos('proj-1');

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'get_balancetes_by_project', { p_project_id: 'proj-1' });
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'get_planos_historico', { p_project_id: 'proj-1' });
    expect(b).toEqual({ dados: [{ id: 'b1' }], erro: null });
    expect(p).toEqual({ dados: [{ id: 'p1' }], erro: null });
  });

  it('ativa o exemplo apenas em DEV com VITE_DADOS=exemplo e sem import estático', () => {
    expect(modoExemploAtivo({ DEV: false, VITE_DADOS: 'exemplo' })).toBe(false);
    expect(modoExemploAtivo({ DEV: true, VITE_DADOS: '' })).toBe(false);
    expect(modoExemploAtivo({ DEV: true, VITE_DADOS: 'real' })).toBe(false);
    expect(modoExemploAtivo({ DEV: true, VITE_DADOS: 'exemplo' })).toBe(true);

    const fonte = fs.readFileSync(path.resolve(__dirname, '../src/servicos/dados.js'), 'utf8');
    expect(fonte).not.toMatch(/^\s*import\s+.*dadosExemplo/m);
    expect(fonte).toContain("import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo'");
  });
});
