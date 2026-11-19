import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerArgumentos, principal } from '../tools/rastreabilidade/backfill.mjs';
import {
  RAIZ_REPO,
  formatarSaidaTerminal,
  motivoRecusa,
  pastaSaidaPadrao,
  validarPastaSaida,
} from '../tools/rastreabilidade/executar.mjs';

const TRECHO_SENTINELA = 'LINHA SINTETICA NAO TRIVIAL 7.1.3.99.01.00001 BOLSA DE PESQUISA 987.654,32';
const TITULO_SENTINELA = 'TITULO COM NOME SENTINELA';
const ARQUIVO_SENTINELA = 'ARQUIVO-SENTINELA.pdf';

function detalheExemplo() {
  return {
    gerado_em: '2026-11-19T12:00:00.000Z',
    modo: 'simulacao',
    papel: 'admin',
    ano: 2026,
    centro: null,
    versao_backfill: '1.0.0',
    resumo: {
      documentos: 1,
      achados: 1,
      nao_achados: 0,
      ambiguos: 0,
      com_cpf: 0,
      zeros: 0,
      duplicados: 0,
      recusados: 0,
      documentos_recusados: 0,
      ja_registrados: 0,
      aplicados: 0,
      simulados: 1,
    },
    centros: [{
      codigo: '99.E2E',
      documentos: [{
        tipo: 'balancete',
        id: '00000000-0000-0000-0000-000000000001',
        chave: 'balancete:00000000-0000-0000-0000-000000000001:2026-10-15',
        project_code: '99.E2E',
        project_id: '00000000-0000-0000-0000-000000000001',
        data_referencia: '2026-10-15',
        versao: null,
        titulo: TITULO_SENTINELA,
        arquivo_nome: ARQUIVO_SENTINELA,
        caminho: '00000000-0000-0000-0000-000000000001/ARQUIVO-SENTINELA.pdf',
        formato: 'pdf',
        paginas: 1,
        sha256: 'a'.repeat(64),
        status: 'simulado',
        motivo: null,
        contagens: {
          achados: 1,
          nao_achados: 0,
          ambiguos: 0,
          com_cpf: 0,
          zeros: 0,
          duplicados: 0,
          recusados: 0,
        },
        motivos: {},
        fatos: [{
          alvo_tabela: 'balancete_lancamentos',
          alvo_id: '00000000-0000-0000-0000-000000000002',
          campo: 'saldo_atual',
          valor: 987654.32,
          pagina: 1,
          trecho: TRECHO_SENTINELA,
          bbox: { x0: 1, x1: 2, yMin: 3, yMax: 4 },
        }],
        removidos: [],
        fatos_ignorados: 0,
      }],
    }],
  };
}

describe('saída do terminal e detalhe', () => {
  it('o terminal só mostra contagens, centro e id — nunca trecho, título, arquivo ou valor', () => {
    const detalhe = detalheExemplo();
    const terminal = formatarSaidaTerminal(detalhe);

    expect(terminal).toContain('Centro 99.E2E');
    expect(terminal).toContain('achados 1');
    expect(terminal).toContain('00000000-0000-0000-0000-000000000001');
    expect(terminal).not.toContain(TRECHO_SENTINELA);
    expect(terminal).not.toContain(TITULO_SENTINELA);
    expect(terminal).not.toContain(ARQUIVO_SENTINELA);
    expect(terminal).not.toContain('987.654,32');
    expect(terminal).not.toContain('987654.32');
  });

  it('o detalhe (fora do repositório) é onde o trecho fica', () => {
    expect(JSON.stringify(detalheExemplo())).toContain(TRECHO_SENTINELA);
  });

  it('relatório e README do script não contêm trecho sintético nem dados de pessoa/arquivo/valor', () => {
    const relatorio = readFileSync(
      path.join(RAIZ_REPO, 'docs', 'redesenho', 'relatorios', 'F2-B.md'),
      'utf8',
    );
    const readme = readFileSync(
      path.join(RAIZ_REPO, 'tools', 'rastreabilidade', 'README.md'),
      'utf8',
    );

    for (const texto of [relatorio, readme]) {
      expect(texto).not.toContain(TRECHO_SENTINELA);
      expect(texto).not.toContain(TITULO_SENTINELA);
      expect(texto).not.toContain(ARQUIVO_SENTINELA);
      expect(texto).not.toContain('987.654,32');
    }
  });

  it('modo aplicação e recusa continuam sem conteúdo sensível', () => {
    const detalhe = detalheExemplo();
    detalhe.modo = 'aplicacao';
    detalhe.centros[0].documentos[0].status = 'recusado';
    detalhe.centros[0].documentos[0].motivo = 'divergencia';
    const terminal = formatarSaidaTerminal(detalhe);
    expect(terminal).toContain('RECUSADO (divergencia)');
    expect(terminal).not.toContain(TRECHO_SENTINELA);
  });
});

describe('motivoRecusa', () => {
  it('classifica sem despejar o detalhe cru', () => {
    expect(motivoRecusa(new Error('Trecho do fato contém CPF e não pode ser gravado.'))).toBe('cpf');
    expect(motivoRecusa(new Error('Fatos divergem dos valores gravados no banco (2 divergência(s)).'))).toBe('divergencia');
    expect(motivoRecusa(new Error('Linha ambígua no plano (2 linhas para b|x).'))).toBe('ambigua');
    expect(motivoRecusa(new Error('Fato duplicado no payload para planos_trabalho.'))).toBe('duplicado');
    expect(motivoRecusa(new Error('Campo bucket incompatível com o tipo do documento.'))).toBe('outro');
  });
});

describe('validarPastaSaida', () => {
  it('recusa pasta dentro do repositório antes de criá-la', () => {
    expect(() => validarPastaSaida(path.join(RAIZ_REPO, 'docs'), RAIZ_REPO)).toThrow(/fora do repositório/);
  });

  it.runIf(process.platform === 'win32')('no Windows, compara sem diferenciar maiúsculas', () => {
    expect(() => validarPastaSaida(path.join(RAIZ_REPO, 'DoCs'), RAIZ_REPO)).toThrow(/fora do repositório/);
  });

  it('aceita pasta fora do repositório e devolve o caminho real', () => {
    const pasta = path.join(tmpdir(), `cf-backfill-teste-${process.pid}`);
    try {
      const real = validarPastaSaida(pasta, RAIZ_REPO);
      expect(path.isAbsolute(real)).toBe(true);
      expect(real.toLowerCase().startsWith(RAIZ_REPO.toLowerCase())).toBe(false);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('a pasta padrão é fora do repositório', () => {
    const padrao = pastaSaidaPadrao();
    expect(padrao.toLowerCase().startsWith(RAIZ_REPO.toLowerCase())).toBe(false);
  });
});

describe('lerArgumentos', () => {
  it('lê --aplicar, --centro e --saida', () => {
    expect(lerArgumentos(['--aplicar', '--centro', '99.E2E', '--saida', 'C:\\temp\\saida'])).toEqual({
      aplicar: true,
      centro: '99.E2E',
      saida: 'C:\\temp\\saida',
      ajuda: false,
    });
  });

  it('aceita a forma --chave=valor', () => {
    expect(lerArgumentos(['--centro=99.E2E', '--saida=C:\\temp\\saida'])).toEqual({
      aplicar: false,
      centro: '99.E2E',
      saida: 'C:\\temp\\saida',
      ajuda: false,
    });
  });

  it('recusa argumento desconhecido', () => {
    expect(() => lerArgumentos(['--foo'])).toThrow(/desconhecido/);
    expect(() => lerArgumentos(['--centro'])).toThrow(/exige/);
  });

  it('--centro e --saida recusam valor que comece por -- (ou vazio)', () => {
    expect(() => lerArgumentos(['--centro', '--aplicar'])).toThrow(/--centro exige/);
    expect(() => lerArgumentos(['--saida', '--centro'])).toThrow(/--saida exige/);
    expect(() => lerArgumentos(['--centro=--aplicar'])).toThrow(/--centro exige/);
    expect(() => lerArgumentos(['--saida='])).toThrow(/--saida exige/);
  });

  it('valida e cria --saida antes de ler o ambiente ou dados', async () => {
    // Sem essa ordem, a falta de CF_* viria primeiro. Aqui a pasta
    // dentro do repositório tem de ser o erro.
    await expect(principal(['--saida', path.join(RAIZ_REPO, 'docs')]))
      .rejects.toThrow(/fora do repositório/);
  });
});
