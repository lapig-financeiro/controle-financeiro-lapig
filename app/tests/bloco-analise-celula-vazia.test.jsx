// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { BlocoAnalise } from '../src/componentes/BlocoAnalise.jsx';

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

describe('BlocoAnalise — célula vazia da tabela', () => {
  it('mostra "—" sem clique quando o servidor manda valor nulo (grupo sem realizado)', () => {
    const bloco = {
      id: 'b1',
      tipo: 'tabela',
      titulo: 'Por grupo',
      tabela: {
        colunas: [
          { rotulo: 'Grupo', unidade: 'texto' },
          { rotulo: 'Previsto', unidade: 'moeda' },
          { rotulo: 'Realizado', unidade: 'moeda' },
        ],
        linhas: [
          [
            { valor: 'Passagens', unidade: 'texto', origem: null },
            { valor: 141000, unidade: 'moeda', origem: { tipo: 'sem_documento', motivo: 'x', consulta: '' } },
            {
              valor: null,
              unidade: 'moeda',
              origem: { tipo: 'sem_documento', motivo: 'sem valor para esta coluna', consulta: '' },
            },
          ],
        ],
      },
    };
    render(<BlocoAnalise bloco={bloco} onOrigem={() => {}} />, document.body);
    const celulas = Array.from(document.querySelectorAll('td'));
    expect(celulas).toHaveLength(3);
    expect(celulas[2].textContent.trim()).toBe('—');
    expect(celulas[2].querySelector('button')).toBeNull();
  });
});
