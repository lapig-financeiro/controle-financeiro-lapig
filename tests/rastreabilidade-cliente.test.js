import { describe, expect, it, vi } from 'vitest';
import { ClienteSupabase } from '../tools/rastreabilidade/cliente.mjs';
import { ErroFatal } from '../tools/rastreabilidade/erros.mjs';

function clienteComToken(fetchImpl) {
  const cliente = new ClienteSupabase({
    url: 'https://exemplo.invalido',
    anonKey: 'chave-sintetica',
    email: 'admin@exemplo.invalido',
    senha: 'senha-sintetica',
    fetchImpl,
  });
  cliente.token = 'token-sintetico';
  cliente.userId = 'usuario-sintetico';
  return cliente;
}

function idsDoParametro(valor) {
  const achado = /^in\.\((.*)\)$/s.exec(String(valor == null ? '' : valor));
  return achado ? achado[1].split(',') : [];
}

function fetchQueDevolveAsChaves(urls) {
  return vi.fn(async (url) => {
    urls.push(String(url));
    const parametros = new URL(String(url)).searchParams;
    for (const [, valor] of parametros) {
      const valores = idsDoParametro(valor);
      if (valores.length) {
        return {
          ok: true,
          status: 200,
          json: async () => valores.map((valorDoLote) => ({ id: valorDoLote })),
        };
      }
    }
    return { ok: true, status: 200, json: async () => [] };
  });
}

const IDS = Array.from(
  { length: 200 },
  (_, indice) => `00000000-0000-0000-0000-${String(indice).padStart(12, '0')}`,
);

const CHAVES = Array.from(
  { length: 200 },
  (_, indice) => `balancete:00000000-0000-0000-0000-${String(indice).padStart(12, '0')}:2026-10-15`,
);

describe('cliente REST — filtros in.(...) em blocos de 50', () => {
  const casos = [
    {
      nome: 'lerBalancetesDoAno',
      coluna: 'project_id',
      valores: IDS,
      chamar: (cliente, valores) => cliente.lerBalancetesDoAno(valores, 2026),
    },
    {
      nome: 'lerLancamentos',
      coluna: 'balancete_id',
      valores: IDS,
      chamar: (cliente, valores) => cliente.lerLancamentos(valores),
    },
    {
      nome: 'lerPlanosAtivos',
      coluna: 'project_id',
      valores: IDS,
      chamar: (cliente, valores) => cliente.lerPlanosAtivos(valores),
    },
    {
      nome: 'lerRubricasDoPlano',
      coluna: 'plano_id',
      valores: IDS,
      chamar: (cliente, valores) => cliente.lerRubricasDoPlano(valores),
    },
    {
      nome: 'lerDesembolsos',
      coluna: 'plano_id',
      valores: IDS,
      chamar: (cliente, valores) => cliente.lerDesembolsos(valores),
    },
    {
      nome: 'lerDocumentos',
      coluna: 'chave',
      valores: CHAVES,
      chamar: (cliente, valores) => cliente.lerDocumentos(valores),
    },
    {
      nome: 'lerVersoesExistentes',
      coluna: 'documento_id',
      valores: IDS,
      chamar: (cliente, valores) => cliente.lerVersoesExistentes(valores),
    },
  ];

  for (const caso of casos) {
    it(`${caso.nome}: 200 valores viram 4 requisições de no máximo 50`, async () => {
      const urls = [];
      const cliente = clienteComToken(fetchQueDevolveAsChaves(urls));
      const linhas = await caso.chamar(cliente, caso.valores);

      expect(linhas).toHaveLength(caso.valores.length);
      expect(urls).toHaveLength(4);

      let total = 0;
      for (const url of urls) {
        const parametros = new URL(url).searchParams;
        const valores = idsDoParametro(parametros.get(caso.coluna));
        expect(valores.length).toBeGreaterThan(0);
        expect(valores.length).toBeLessThanOrEqual(50);
        // Cada bloco cabe numa URL curta (a de `chave` é a mais longa).
        expect(url.length).toBeLessThan(4000);
        total += valores.length;
      }
      expect(total).toBe(caso.valores.length);
    });
  }

  it('a listagem de balancetes não pede raw_extraction', async () => {
    const urls = [];
    const cliente = clienteComToken(fetchQueDevolveAsChaves(urls));
    await cliente.lerBalancetesDoAno([IDS[0]], 2026);

    const parametros = new URL(urls[0]).searchParams;
    expect(parametros.get('select')).not.toContain('raw_extraction');
  });

  it('raw_extraction é buscado por balancete, com select só dele', async () => {
    const urls = [];
    const raw = { data: { lancamentos: [{}] } };
    const fetchImpl = vi.fn(async (url) => {
      urls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => [{ raw_extraction: raw }],
      };
    });
    const cliente = clienteComToken(fetchImpl);
    const resultado = await cliente.lerRawExtraction(IDS[0]);

    expect(resultado).toEqual(raw);
    expect(urls).toHaveLength(1);
    const parametros = new URL(urls[0]).searchParams;
    expect(parametros.get('select')).toBe('raw_extraction');
    expect(parametros.get('id')).toBe(`eq.${IDS[0]}`);
  });
});

describe('cliente Storage — 403 na URL assinada', () => {
  function respostaAssinatura() {
    return {
      ok: true,
      status: 200,
      json: async () => ({ signedURL: '/object/sign/balancete-pdfs/projeto/arquivo.pdf?token=t' }),
    };
  }

  function respostaArquivo(status, bytes = Buffer.from('%PDF-1.4 sintetico', 'latin1')) {
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => bytes,
    };
  }

  it('refaz a assinatura uma vez e baixa na segunda tentativa', async () => {
    let assinaturas = 0;
    let downloads = 0;
    const fetchImpl = vi.fn(async (url, init) => {
      // A assinatura é POST; o download da URL assinada é GET.
      if (init && init.method === 'POST') {
        assinaturas += 1;
        return respostaAssinatura();
      }
      downloads += 1;
      return respostaArquivo(downloads === 1 ? 403 : 200);
    });

    const bytes = await clienteComToken(fetchImpl).baixarArquivo(
      'balancete-pdfs',
      'projeto/arquivo.pdf',
    );

    expect(bytes.toString('latin1')).toContain('%PDF');
    expect(assinaturas).toBe(2);
    expect(downloads).toBe(2);
  });

  it('dois 403 seguidos viram recusa de assinatura, não login expirado', async () => {
    const fetchImpl = vi.fn(async (url, init) => (
      init && init.method === 'POST'
        ? respostaAssinatura()
        : respostaArquivo(403)
    ));

    let erro = null;
    try {
      await clienteComToken(fetchImpl).baixarArquivo('balancete-pdfs', 'projeto/arquivo.pdf');
    } catch (capturado) {
      erro = capturado;
    }

    expect(erro).toBeTruthy();
    expect(erro.message).toMatch(/Assinatura do arquivo expirou ou foi recusada/);
    expect(erro.message).not.toMatch(/login expirou/);
    expect(erro).not.toBeInstanceOf(ErroFatal);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('403 ao assinar continua sendo login expirado', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));

    await expect(
      clienteComToken(fetchImpl).baixarArquivo('balancete-pdfs', 'projeto/arquivo.pdf'),
    ).rejects.toBeInstanceOf(ErroFatal);
  });
});
