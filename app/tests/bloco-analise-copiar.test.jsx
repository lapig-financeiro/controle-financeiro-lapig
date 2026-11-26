// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlocoAnalise, tabelaParaTexto } from '../src/componentes/BlocoAnalise.jsx';

const tick = () => new Promise((r) => setTimeout(r, 25));

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

const TABELA = {
  colunas: [
    { rotulo: 'Rubrica', unidade: 'texto' },
    { rotulo: 'Previsto', unidade: 'moeda' },
    { rotulo: 'Realizado (R$)', unidade: 'moeda' },
    { rotulo: 'Executado', unidade: 'percentual' },
    { rotulo: 'Balancete', unidade: 'data' },
  ],
  linhas: [
    [
      { valor: 'Pessoal\tbolsas' },
      { valor: 1234567.8, origem: { tipo: 'ref' } },
      { valor: -3180.5 },
      { valor: 83.456 },
      { valor: '2026-10-15' },
    ],
    [{ valor: 'Bolsa de ⟦P2⟧' }, { valor: null }, null, { valor: 'x' }, { valor: null }],
  ],
};

describe('tabelaParaTexto', () => {
  it('sai em colunas separadas por tabulação, números pt-BR sem R$ e vazio como —', () => {
    const texto = tabelaParaTexto(TABELA);
    const [cabecalho, primeira, segunda, ...resto] = texto.split('\n');
    expect(resto).toEqual([]);
    expect(cabecalho.split('\t')).toEqual([
      'Rubrica',
      'Previsto (R$)',
      'Realizado (R$)',
      'Executado',
      'Balancete',
    ]);
    // Tabulação dentro do texto não pode quebrar a coluna; negativo com hífen comum.
    expect(primeira.split('\t')).toEqual(['Pessoal bolsas', '1.234.567,80', '-3.180,50', '83,46%', '15/10/2026']);
    // Nada vira zero: sem valor é "—"; marcador de pessoa vira "pessoa n".
    expect(segunda.split('\t')).toEqual(['Bolsa de pessoa 2', '—', '—', '—', '—']);
  });

  it('texto que começa com = + - @ não vira fórmula; zero negativo sai 0,00', () => {
    const texto = tabelaParaTexto({
      colunas: [{ rotulo: 'Rótulo', unidade: 'texto' }, { rotulo: 'Valor R$', unidade: 'moeda' }],
      linhas: [[{ valor: '=HYPERLINK("x")' }, { valor: -0 }], [{ valor: '@soma' }, { valor: -12.5 }]],
    });
    const [cab, l1, l2] = texto.split('\n');
    // Rótulo que já tem "R$" não ganha "(R$)" de novo.
    expect(cab.split('\t')).toEqual(['Rótulo', 'Valor R$']);
    expect(l1.split('\t')).toEqual([`'=HYPERLINK("x")`, '0,00']);
    // Negativo numérico continua número (sem apóstrofo).
    expect(l2.split('\t')).toEqual(["'@soma", '-12,50']);
  });

  it('tabela malformada devolve texto vazio', () => {
    expect(tabelaParaTexto(null)).toBe('');
    expect(tabelaParaTexto({ colunas: [] })).toBe('');
  });
});

describe('botão Copiar tabela', () => {
  it('copia o texto da tabela e confirma no botão', async () => {
    const copiar = vi.fn().mockResolvedValue(undefined);
    render(<BlocoAnalise bloco={{ tipo: 'tabela', titulo: 'Rubricas', tabela: TABELA }} copiar={copiar} />, document.body);
    const botao = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Copiar tabela')
    );
    expect(botao).toBeTruthy();
    botao.click();
    await tick();
    expect(copiar).toHaveBeenCalledWith(tabelaParaTexto(TABELA));
    expect(botao.textContent).toContain('Copiada');
    expect(document.querySelector('[role="status"]').textContent).toContain('Tabela copiada');
  });

  it('falha ao copiar aparece na tela', async () => {
    const copiar = vi.fn().mockRejectedValue(new Error('negado'));
    render(<BlocoAnalise bloco={{ tipo: 'tabela', tabela: TABELA }} copiar={copiar} />, document.body);
    document.querySelector('.bloco-analise__copiar button').click();
    await tick();
    const status = document.querySelector('.bloco-analise__copiar-status--falha');
    expect(status).not.toBeNull();
    expect(status.textContent).toContain('Não foi possível copiar');
  });

  it('bloco de número e de texto não ganham o botão', () => {
    render(
      <div>
        <BlocoAnalise bloco={{ tipo: 'numero', titulo: 'Livre', numero: { valor: 10, unidade: 'moeda' } }} />
        <BlocoAnalise bloco={{ tipo: 'texto', texto: { texto: 'oi' } }} />
      </div>,
      document.body
    );
    expect(document.querySelector('.bloco-analise__copiar')).toBeNull();
  });
});
