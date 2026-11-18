import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('../src/servicos/supabase.js', () => ({
  supabase: { rpc: rpcMock },
}));

import { MARCADORES_EXEMPLO, verificarBuild } from '../scripts/verificar-build.mjs';
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

  it('valida a forma dos payloads de resumoProjetos, saldoLivre e repasses', async () => {
    rpcMock.mockResolvedValueOnce({ data: { ocultos: 0, todos: [] }, error: null });
    const semCentros = await resumoProjetos();
    expect(semCentros.dados).toBeNull();
    expect(semCentros.erro).toContain('Não foi possível');

    rpcMock.mockResolvedValueOnce({ data: { centros: [], ocultos: 0 }, error: null });
    const semTodos = await resumoProjetos();
    expect(semTodos.dados).toBeNull();
    expect(semTodos.erro).toContain('Não foi possível');

    rpcMock.mockResolvedValueOnce({
      data: { has_plano: 'sim', has_balancete: true },
      error: null,
    });
    const saldoInvalido = await saldoLivre('proj-1');
    expect(saldoInvalido.dados).toBeNull();
    expect(saldoInvalido.erro).toContain('Não foi possível');

    rpcMock.mockResolvedValueOnce({ data: { recursos: null }, error: null });
    const repassesInvalido = await repasses('proj-1');
    expect(repassesInvalido.dados).toBeNull();
    expect(repassesInvalido.erro).toContain('Não foi possível');
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

  it('verificarBuild reprova bundle contendo dados de exemplo e aprova bundle limpo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-check-'));
    try {
      const assets = path.join(tmp, 'assets');
      fs.mkdirSync(assets, { recursive: true });
      fs.writeFileSync(path.join(assets, 'index-abc.js'), 'console.log("ok");\n');
      expect(verificarBuild(tmp, MARCADORES_EXEMPLO)).toEqual([]);

      fs.writeFileSync(path.join(assets, 'index-abc.js'), 'const x = "Bacia do Cerrado Norte";\n');
      const falhas = verificarBuild(tmp, MARCADORES_EXEMPLO);
      expect(falhas.length).toBeGreaterThanOrEqual(1);
      expect(falhas[0].marcador).toBe('Bacia do Cerrado Norte');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
