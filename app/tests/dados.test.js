import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock, createSignedUrlMock, storageFromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createSignedUrlMock: vi.fn(),
  storageFromMock: vi.fn(),
}));

storageFromMock.mockImplementation(() => ({
  createSignedUrl: createSignedUrlMock,
}));

vi.mock('../src/servicos/supabase.js', () => ({
  supabase: {
    rpc: rpcMock,
    storage: { from: storageFromMock },
  },
}));

import { verificarFechamentoArvore } from '../src/componentes/DeOndeVem.jsx';
import { MARCADORES_EXEMPLO, verificarBuild } from '../scripts/verificar-build.mjs';
import {
  arquivoDeOrigem,
  balancetes,
  explicarLivre,
  filtroVisao,
  modoExemploAtivo,
  origem,
  pendencias,
  planos,
  repasses,
  resolverPendencia,
  resumoProjetos,
  saldoLivre,
  salvarFiltroVisao,
} from '../src/servicos/dados.js';
import * as dadosExemplo from '../src/servicos/dadosExemplo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  rpcMock.mockReset();
  createSignedUrlMock.mockReset();
  storageFromMock.mockClear();
  vi.unstubAllGlobals();
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
      () => explicarLivre('proj-1'),
      () => origem({ alvo_tabela: 'balancete_lancamentos', alvo_id: 'l1', campo: 'saldo_atual' }),
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

      // Também varre .mjs/.json, sentinela __EXEMPLO_CF__ e proíbe .pdf/.docx em dist.
      fs.writeFileSync(path.join(assets, 'index-abc.js'), 'console.log("limpo");\n');
      fs.writeFileSync(path.join(assets, 'worker-abc.mjs'), 'export default "__EXEMPLO_CF__";\n');
      fs.writeFileSync(path.join(assets, 'dados.json'), '{"s":"__EXEMPLO_CF__"}\n');
      fs.writeFileSync(path.join(tmp, 'balancete.pdf'), '%PDF-1.4\n');
      fs.writeFileSync(path.join(assets, 'plano.docx'), 'PK\n');

      const falhasExtras = verificarBuild(tmp, MARCADORES_EXEMPLO);
      expect(falhasExtras.some((f) => f.arquivo.endsWith('worker-abc.mjs') && f.marcador === '__EXEMPLO_CF__')).toBe(true);
      expect(falhasExtras.some((f) => f.arquivo.endsWith('dados.json') && f.marcador === '__EXEMPLO_CF__')).toBe(true);
      expect(falhasExtras.some((f) => f.arquivo === 'balancete.pdf')).toBe(true);
      expect(falhasExtras.some((f) => f.arquivo === 'assets/plano.docx')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('valida explicarLivre, origem e arquivoDeOrigem no modo real e trata falhas sem zerar', async () => {
    rpcMock.mockResolvedValueOnce({ data: { rotulo: 'x', tipo: 'calculo', valor: null, motivo: '', partes: [] }, error: null });
    const semMotivo = await explicarLivre('proj-1');
    expect(semMotivo.dados).toBeNull();
    expect(semMotivo.erro).toContain('Não foi possível');

    rpcMock.mockResolvedValueOnce({ data: { tipo: 'desconhecido', valor: 10 }, error: null });
    const origemInvalida = await origem({ alvo_tabela: 't', alvo_id: 'id', campo: 'c' });
    expect(origemInvalida.dados).toBeNull();
    expect(origemInvalida.erro).toContain('Não foi possível');

    const semDoc = await arquivoDeOrigem(null);
    expect(semDoc.dados).toBeNull();
    expect(semDoc.erro).toContain('Arquivo de origem não informado');

    createSignedUrlMock.mockResolvedValueOnce({ data: null, error: { message: 'negado' } });
    const erroUrl = await arquivoDeOrigem({ bucket: 'balancete-pdfs', caminho: 'p/a.pdf' });
    expect(erroUrl.dados).toBeNull();
    expect(erroUrl.erro).toContain('Não foi possível obter acesso');

    createSignedUrlMock.mockResolvedValueOnce({ data: { signedUrl: 'https://exemplo/signed.pdf' }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 403 }));
    const erroHttp = await arquivoDeOrigem({ bucket: 'balancete-pdfs', caminho: 'p/a.pdf' });
    expect(erroHttp.dados).toBeNull();
    expect(erroHttp.erro).toContain('403');

    const buf = new Uint8Array([37, 80, 68, 70]).buffer;
    createSignedUrlMock.mockResolvedValueOnce({ data: { signedUrl: 'https://exemplo/ok.pdf' }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, arrayBuffer: async () => buf }));
    const ok = await arquivoDeOrigem({ bucket: 'balancete-pdfs', caminho: 'p/a.pdf' });
    expect(storageFromMock).toHaveBeenCalledWith('balancete-pdfs');
    expect(createSignedUrlMock).toHaveBeenCalledWith('p/a.pdf', 300);
    expect(ok.erro).toBeNull();
    expect(ok.dados).toBe(buf);
  });

  it('dadosExemplo responde explicarLivre/origem sem chamar Supabase e com árvore fechando ao centavo', async () => {
    const cerradoId = '00000000-0000-4000-8000-000000030901';
    const veredasId = '00000000-0000-4000-8000-000000030904';
    const florestalId = '00000000-0000-4000-8000-000000030905';
    const estacoesId = '00000000-0000-4000-8000-000000030906';

    const arvore = await dadosExemplo.explicarLivre(cerradoId);
    expect(arvore.erro).toBeNull();
    expect(arvore.dados.valor).toBe(84300);
    expect(verificarFechamentoArvore(arvore.dados, 84300).falhas.size).toBe(0);

    // Confirma presença dos quatro tipos na árvore de exemplo.
    const tipos = new Set();
    const percorrer = (n) => {
      tipos.add(n.tipo);
      (n.partes || []).forEach(percorrer);
    };
    percorrer(arvore.dados);
    expect(tipos).toEqual(new Set(['calculo', 'documento', 'legado', 'digitado']));

    const origDoc = await dadosExemplo.origem({
      alvo_tabela: 'balancete_lancamentos',
      alvo_id: '00000000-0000-4000-8000-000000050101',
      campo: 'saldo_atual',
    });
    expect(origDoc.erro).toBeNull();
    expect(origDoc.dados.tipo).toBe('documento');
    expect(origDoc.dados.documento.formato).toBe('pdf');
    expect(origDoc.dados.documento.caminho).toContain(dadosExemplo.SENTINELA_EXEMPLO);

    const origLegado = await dadosExemplo.origem({
      alvo_tabela: 'balancete_lancamentos',
      alvo_id: '00000000-0000-4000-8000-000000050105',
      campo: 'saldo_atual',
    });
    expect(origLegado.dados.tipo).toBe('legado');
    expect(origLegado.dados.busca.conta_codigo).toBe('7.1.3.05.01.08124');

    const origBolsa = await dadosExemplo.origem({
      alvo_tabela: 'scholarships',
      alvo_id: 'b-901-1',
      campo: 'amount',
    });
    expect(origBolsa.dados.tipo).toBe('digitado');
    expect(origBolsa.dados.documento).toBeNull();

    const semBal = await dadosExemplo.explicarLivre(veredasId);
    expect(semBal.dados.valor).toBeNull();
    expect(semBal.dados.motivo).toBe('sem balancete');

    const semPl = await dadosExemplo.explicarLivre(florestalId);
    expect(semPl.dados.valor).toBeNull();
    expect(semPl.dados.motivo).toBe('sem plano');

    const falha = await dadosExemplo.explicarLivre(estacoesId);
    expect(falha.dados).toBeNull();
    expect(falha.erro).toBeTruthy();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(storageFromMock).not.toHaveBeenCalled();
  });
});
