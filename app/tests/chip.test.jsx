// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Chip } from '../src/componentes/Chip.jsx';

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

describe('Chip — aria-pressed', () => {
  it('só anuncia pressionado quando a prop ativo é passada explicitamente', () => {
    render(
      <div>
        <Chip>Sem estado</Chip>
        <Chip ativo={false}>Não ativo</Chip>
        <Chip ativo>Ativo</Chip>
      </div>,
      document.body
    );

    const [semEstado, naoAtivo, ativo] = document.querySelectorAll('.chip');
    expect(semEstado.hasAttribute('aria-pressed')).toBe(false);
    expect(naoAtivo.getAttribute('aria-pressed')).toBe('false');
    expect(ativo.getAttribute('aria-pressed')).toBe('true');
  });
});
