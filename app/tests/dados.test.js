import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { MARCADORES_EXEMPLO, verificarBuild, verificarCspIndexHtml } from '../scripts/verificar-build.mjs';
import { inserirCspNoHead } from '../vite.config.js';
import {
  arquivoDeOrigem,
  balancetes,
  conferirTermoContrato,
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
  termosContrato,
  usarVigenciaDoContrato,
  validarArvoreExplicacao,
  validarTermosContrato,
} from '../src/servicos/dados.js';
import * as dadosExemplo from '../src/servicos/dadosExemplo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  rpcMock.mockReset();
  createSignedUrlMock.mockReset();
  storageFromMock.mockClear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
      () => termosContrato('proj-1'),
      () => conferirTermoContrato('termo-1'),
      () => usarVigenciaDoContrato('proj-1'),
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

  it('usa as RPCs de termos do contrato e valida o payload antes de exibir', async () => {
    const termo = {
      id: 'termo-fim-1',
      valor: '2027-01-15',
      regra: 'vigência definida no contrato',
      trecho: 'CLÁUSULA SEGUNDA — a vigência é a definida no instrumento.',
      documento_nome: 'Contrato',
      documento_url: 'https://drive.google.com/file/d/x/view',
      pagina: 2,
      nota: null,
      origem: 'ia',
      autor: 'Claude',
      criado_em: '2026-11-18T15:10:00Z',
      conferido: false,
      conferido_em: null,
      versoes_anteriores: [],
    };
    const payload = {
      termos: { vigencia_fim: termo },
      start_date_cadastro: '2025-11-15',
      end_date_cadastro: '2027-01-15',
      vigencia_situacao: 'confere',
      vigencia_confere: true,
    };

    rpcMock.mockResolvedValueOnce({ data: payload, error: null });
    const res = await termosContrato('proj-1');
    expect(rpcMock).toHaveBeenNthCalledWith(1, 'get_termos_contrato_v2', { p_project_id: 'proj-1' });
    expect(res.erro).toBeNull();
    expect(validarTermosContrato(res.dados)).toBe(true);

    rpcMock.mockResolvedValueOnce({
      data: { ...payload, termos: { vigencia_fim: { ...termo, origem: 'sistema' } } },
      error: null,
    });
    const invalido = await termosContrato('proj-1');
    expect(invalido.dados).toBeNull();
    expect(invalido.erro).toContain('Não foi possível');

    const comPlano = {
      ...payload,
      termos: {
        taxa_total: {
          ...termo,
          documento_url: null,
          documento_id: 'documento-plano-1',
          documento: {
            id: 'documento-plano-1',
            titulo: 'Plano de trabalho',
            tipo: 'plano',
            bucket: 'plano-trabalho-docs',
            caminho: 'p-1/plano.docx',
            arquivo_nome: 'plano.docx',
            formato: 'docx',
            versao: 1,
          },
        },
      },
    };
    expect(validarTermosContrato(comPlano)).toBe(true);
    expect(
      validarTermosContrato({
        ...payload,
        termos: { taxa_total: { ...termo, documento_url: null, documento_id: 'documento-plano-1' } },
      })
    ).toBe(true);
    expect(
      validarTermosContrato({
        ...payload,
        termos: { taxa_total: { ...termo, documento_url: null } },
      })
    ).toBe(false);
    expect(
      validarTermosContrato({
        ...payload,
        termos: {
          taxa_total: {
            ...termo,
            documento_id: 'documento-plano-1',
            documento: { bucket: 'plano-trabalho-docs', formato: 'exe' },
          },
        },
      })
    ).toBe(false);

    rpcMock.mockResolvedValueOnce({
      data: { id: 'termo-fim-1', conferido_em: '2026-11-18T17:00:00Z', ja_estava: false },
      error: null,
    });
    const conferido = await conferirTermoContrato('termo-fim-1');
    expect(rpcMock).toHaveBeenNthCalledWith(3, 'conferir_termo_contrato_v2', { p_id: 'termo-fim-1' });
    expect(conferido.erro).toBeNull();

    rpcMock.mockResolvedValueOnce({
      data: {
        project_id: 'proj-1',
        antes: { start_date: null, end_date: '2027-03-31' },
        depois: { start_date: null, end_date: '2027-04-30' },
        mudou: true,
      },
      error: null,
    });
    const usado = await usarVigenciaDoContrato('proj-1');
    expect(rpcMock).toHaveBeenNthCalledWith(4, 'usar_vigencia_do_contrato_v2', { p_project_id: 'proj-1' });
    expect(usado.erro).toBeNull();

    const semCentro = await termosContrato(null);
    expect(semCentro.dados).toBeNull();
    expect(semCentro.erro).toContain('não informado');
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

      // Também varre .mjs/.json, sentinela __EXEMPLO_CF__, usuário Admin de exemplo e proíbe .pdf/.docx em dist.
      fs.writeFileSync(path.join(assets, 'index-abc.js'), 'const n = "Admin de exemplo";\n');
      expect(
        verificarBuild(tmp, MARCADORES_EXEMPLO).some((f) => f.marcador === 'Admin de exemplo')
      ).toBe(true);

      fs.writeFileSync(path.join(assets, 'index-abc.js'), 'const e = "exemplo@lapig.ufg.br";\n');
      expect(
        verificarBuild(tmp, MARCADORES_EXEMPLO).some((f) => f.marcador === 'exemplo@lapig.ufg.br')
      ).toBe(true);

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

  it('coloca CSP no começo do head antes de script e link (inclusive no dist/index.html quando gerado)', () => {
    const htmlBase =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="icon" href="/x.svg"><script src="/a.js"></script></head><body></body></html>';
    const htmlComCsp = inserirCspNoHead(htmlBase);
    expect(verificarCspIndexHtml(htmlComCsp)).toBeNull();

    const htmlCspNoFim =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="icon" href="/x.svg"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head><body></body></html>';
    expect(verificarCspIndexHtml(htmlCspNoFim)).toContain('depois de <link>');

    const htmlCspAposScript =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><script src="/a.js"></script><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head><body></body></html>';
    expect(verificarCspIndexHtml(htmlCspAposScript)).toContain('depois de <script>');

    const distIndex = path.resolve(__dirname, '../dist/index.html');
    if (fs.existsSync(distIndex)) {
      const htmlDist = fs.readFileSync(distIndex, 'utf8');
      expect(verificarCspIndexHtml(htmlDist)).toBeNull();
      const head = htmlDist.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
      const posCsp = head.search(/<meta\s[^>]*http-equiv=["']?Content-Security-Policy/i);
      const posScript = head.search(/<script[\s>]/i);
      const posLink = head.search(/<link[\s>]/i);
      expect(posCsp).toBeGreaterThanOrEqual(0);
      if (posScript >= 0) expect(posCsp).toBeLessThan(posScript);
      if (posLink >= 0) expect(posCsp).toBeLessThan(posLink);
    }
  });

  it('valida explicarLivre recursivamente rejeitando nós malformados como partes: [null]', async () => {
    const casosInvalidos = [
      { rotulo: 'Livre', tipo: 'calculo', valor: 100, partes: [null] },
      {
        rotulo: 'Livre',
        tipo: 'calculo',
        valor: 100,
        partes: [{ rotulo: 'Filho inválido', tipo: 'inventado', valor: 100, partes: [] }],
      },
      {
        rotulo: 'Livre',
        tipo: 'calculo',
        valor: 100,
        partes: [{ rotulo: 'Filho nulo', tipo: 'calculo', valor: null, motivo: 'x', partes: [] }],
      },
      {
        rotulo: 'Livre',
        tipo: 'calculo',
        valor: 100,
        partes: [
          {
            rotulo: 'Ref ruim',
            tipo: 'documento',
            valor: 100,
            ref: { alvo_tabela: '', alvo_id: '1', campo: 'saldo' },
            partes: [],
          },
        ],
      },
      {
        rotulo: 'Livre',
        tipo: 'calculo',
        valor: 100,
        partes: [
          {
            rotulo: 'Grupo',
            tipo: 'calculo',
            valor: 100,
            partes: [{ rotulo: 'Neto sem array', tipo: 'legado', valor: 100, partes: 'ruim' }],
          },
        ],
      },
    ];

    for (const payload of casosInvalidos) {
      rpcMock.mockResolvedValueOnce({ data: payload, error: null });
      const res = await explicarLivre('proj-1');
      expect(res.dados).toBeNull();
      expect(res.erro).toContain('Não foi possível');
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

    const origRendimento = await dadosExemplo.origem({
      alvo_tabela: 'balancetes',
      alvo_id: '00000000-0000-4000-8000-000000090102',
      campo: 'rendimento_liquido',
    });
    expect(origRendimento.erro).toBeNull();
    expect(origRendimento.dados.tipo).toBe('documento');
    expect(origRendimento.dados.valor).toBe(11240.15);
    expect(origRendimento.dados.fato.trecho).toContain('RENDIMENTO LIQUIDO');

    const origRendimentoLegado = await dadosExemplo.origem({
      alvo_tabela: 'balancetes',
      alvo_id: '00000000-0000-4000-8000-000000090201',
      campo: 'rendimento_liquido',
    });
    expect(origRendimentoLegado.erro).toBeNull();
    expect(origRendimentoLegado.dados.tipo).toBe('legado');
    expect(origRendimentoLegado.dados.valor).toBe(3180);
    expect(origRendimentoLegado.dados.busca.texto).toBe('rendimento liquido');

    // Centro de exemplo com rendimento não lido: null não vira zero.
    const balancetesFlorestal = await dadosExemplo.balancetes(florestalId);
    expect(balancetesFlorestal.dados[0].rendimento_liquido).toBeNull();

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

  it('passa por dados.js com modo exemplo ligado via stubEnv sem chamar Supabase e valida exemplo malformado', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_DADOS', 'exemplo');
    const fechadoId = '00000000-0000-4000-8000-000000030901';
    const fakePdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]).buffer;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).includes('manifesto.json')) {
          return {
            ok: true,
            json: async () => ({
              sentinela: '__EXEMPLO_CF__',
              fatos: {
                '7.1.3.04.01.09142': { pagina: 1, trecho: '7.1.3.04.01.09142 380.000,00', bbox: null },
              },
            }),
          };
        }
        return { ok: true, arrayBuffer: async () => fakePdf };
      })
    );

    const resResumo = await resumoProjetos();
    const resPend = await pendencias(fechadoId);
    const resSaldo = await saldoLivre(fechadoId);
    const resRep = await repasses(fechadoId);
    const resBal = await balancetes(fechadoId);
    const resPl = await planos(fechadoId);
    const resTermos = await termosContrato(fechadoId);
    const resArv = await explicarLivre(fechadoId);
    const resOrig = await origem({
      alvo_tabela: 'balancete_lancamentos',
      alvo_id: '00000000-0000-4000-8000-000000050101',
      campo: 'saldo_atual',
    });
    const resArq = await arquivoDeOrigem({
      bucket: 'balancete-pdfs',
      caminho: 'p/balancete.pdf',
      arquivo_nome: 'balancete-30901-out-26.pdf',
    });

    expect(resResumo.erro).toBeNull();
    expect(resResumo.dados.centros.length).toBeGreaterThan(0);
    expect(resPend.erro).toBeNull();
    expect(resSaldo.dados.has_plano).toBe(true);
    expect(resRep.dados.parcelas.length).toBeGreaterThan(0);
    expect(resBal.dados.length).toBeGreaterThan(0);
    expect(resPl.dados.length).toBeGreaterThan(0);
    expect(resTermos.erro).toBeNull();
    expect(resTermos.dados.vigencia_confere).toBe(true);
    expect(resTermos.dados.termos.vigencia_fim).toBeDefined();
    expect(resArv.dados.valor).toBe(84300);
    expect(resOrig.dados.tipo).toBe('documento');
    expect(resArq.dados).toBe(fakePdf);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(storageFromMock).not.toHaveBeenCalled();

    // Confere que o mesmo validador recursivo também barra resposta malformada no modo exemplo.
    const spyExplicar = vi
      .spyOn(dadosExemplo, 'explicarLivre')
      .mockResolvedValueOnce({
        dados: { rotulo: 'X', tipo: 'calculo', valor: 10, partes: [null] },
        erro: null,
      });
    const resMalformado = await explicarLivre(fechadoId);
    expect(spyExplicar).toHaveBeenCalledTimes(1);
    expect(resMalformado.dados).toBeNull();
    expect(resMalformado.erro).toContain('Não foi possível');
  });

  it('todas as árvores de ARVORES_EXEMPLO fecham ao centavo e batem com resumoProjetos', async () => {
    const filtroOriginal = (await dadosExemplo.filtroVisao()).dados.centros_ocultos;
    await dadosExemplo.salvarFiltroVisao([]);

    try {
      const resumoTodos = await dadosExemplo.resumoProjetos();
      expect(resumoTodos.erro).toBeNull();
      const centrosPorId = new Map(resumoTodos.dados.centros.map((c) => [c.id, c]));

      const idsArvores = Object.keys(dadosExemplo.ARVORES_EXEMPLO);
      expect(idsArvores.length).toBe(8);

      for (const projectId of idsArvores) {
        const centro = centrosPorId.get(projectId);
        expect(centro).toBeDefined();

        const res = await dadosExemplo.explicarLivre(projectId);
        expect(res.erro).toBeNull();
        expect(validarArvoreExplicacao(res.dados)).toBe(true);

        if (centro.livre === null) {
          expect(res.dados.valor).toBeNull();
          expect(res.dados.motivo).toBe(centro.situacao);
        } else {
          expect(res.dados.valor).toBe(centro.livre);
          const { falhas } = verificarFechamentoArvore(res.dados, centro.livre);
          expect(falhas.size).toBe(0);
        }
      }
    } finally {
      await dadosExemplo.salvarFiltroVisao(filtroOriginal);
    }
  });

  it('modo exemplo: termos têm um que confere, um que diverge, um sem termos e um com nota', async () => {
    const todos = (await dadosExemplo.resumoProjetos()).dados.todos;
    const idPorCodigo = new Map(todos.map((c) => [c.code, c.id]));

    const confere = await dadosExemplo.termosContrato(idPorCodigo.get('30.901'));
    expect(confere.erro).toBeNull();
    expect(validarTermosContrato(confere.dados)).toBe(true);
    expect(confere.dados.vigencia_confere).toBe(true);
    expect(Object.keys(confere.dados.termos)).toHaveLength(3);
    expect(confere.dados.termos.taxa_total.valor).toBe(9.75);
    expect(confere.dados.termos.taxa_cip_ufg).toBeUndefined();
    expect(confere.dados.termos.taxa_total.documento_id).toBe('documento-plano-30901-v2');
    expect(confere.dados.termos.taxa_total.documento).toBeNull();
    expect(confere.dados.termos.vigencia_fim.nota).toBeNull();
    expect(confere.dados.vigencia_situacao).toBe('confere');
    expect(confere.dados.start_date_cadastro).toBeNull();

    const diverge = await dadosExemplo.termosContrato(idPorCodigo.get('30.902'));
    expect(diverge.dados.vigencia_confere).toBe(false);
    expect(diverge.dados.vigencia_situacao).toBe('diverge');
    expect(diverge.dados.termos.vigencia_fim.valor).toBe('2027-04-30');
    expect(diverge.dados.termos.vigencia_fim.nota).toContain('diferença');
    expect(diverge.dados.termos.taxa_total.valor).toBe(9.75);
    expect(diverge.dados.termos.taxa_cip_ufg.valor).toBe(5);
    expect(diverge.dados.termos.taxa_cip_ua.valor).toBe(6);
    expect(diverge.dados.termos.taxa_dao.valor).toBe(4);
    expect(diverge.dados.termos.taxa_total.nota).toContain('9,75%');

    const semTermos = await dadosExemplo.termosContrato(idPorCodigo.get('30.903'));
    expect(semTermos.erro).toBeNull();
    expect(semTermos.dados.termos).toEqual({});
    expect(semTermos.dados.vigencia_situacao).toBe('sem_contrato');
    expect(semTermos.dados.vigencia_confere).toBeNull();

    const comNota = await dadosExemplo.termosContrato(idPorCodigo.get('30.904'));
    expect(comNota.dados.vigencia_confere).toBe(true);
    expect(comNota.dados.vigencia_situacao).toBe('confere');
    expect(comNota.dados.termos.vigencia_fim.nota).toContain('aditivo');
    expect(comNota.dados.termos.taxa_total).toBeUndefined();
    expect(comNota.dados.termos.taxa_cip_ufg.valor).toBe(3);
    expect(comNota.dados.termos.taxa_cip_ua.valor).toBe(4);
    expect(comNota.dados.termos.taxa_dao.valor).toBe(2);

    const idFimAtlas = diverge.dados.termos.vigencia_fim.id;
    const conferido = await dadosExemplo.conferirTermoContrato(idFimAtlas);
    expect(conferido.dados.ja_estava).toBe(false);
    const depoisDeConferir = await dadosExemplo.termosContrato(idPorCodigo.get('30.902'));
    expect(depoisDeConferir.dados.termos.vigencia_fim.conferido).toBe(true);
    const conferidoDeNovo = await dadosExemplo.conferirTermoContrato(idFimAtlas);
    expect(conferidoDeNovo.dados.ja_estava).toBe(true);

    const usado = await dadosExemplo.usarVigenciaDoContrato(idPorCodigo.get('30.902'));
    expect(usado.erro).toBeNull();
    expect(usado.dados.antes.end_date).toBe('2027-03-31');
    expect(usado.dados.depois.end_date).toBe('2027-04-30');
    expect(usado.dados.depois.start_date).toBe('2025-08-30');
    const depoisDeUsar = await dadosExemplo.termosContrato(idPorCodigo.get('30.902'));
    expect(depoisDeUsar.dados.vigencia_confere).toBe(true);

    const resumoDepois = await dadosExemplo.resumoProjetos();
    const atlas = resumoDepois.dados.centros.find((c) => c.code === '30.902');
    expect(atlas.end_date).toBe('2027-04-30');

    const semVigencia = await dadosExemplo.usarVigenciaDoContrato(idPorCodigo.get('30.903'));
    expect(semVigencia.dados).toBeNull();
    expect(semVigencia.erro).toContain('Sem vigência');
  });
});
