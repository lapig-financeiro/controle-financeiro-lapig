// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bolsistas } from '../src/paginas/Bolsistas.jsx';

const tick = () => new Promise((r) => setTimeout(r, 40));

async function esperarPor(condicao, tentativas = 100) {
  for (let i = 0; i < tentativas; i += 1) {
    const valor = condicao();
    if (valor) return valor;
    await tick();
  }
  return condicao();
}

function nomesNaLista() {
  return Array.from(document.querySelectorAll('.bolsistas__pessoa-nome')).map(
    (el) => el.textContent
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_DADOS', 'exemplo');
  window.localStorage.clear();
});

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
  window.localStorage.clear();
  vi.unstubAllEnvs();
});

describe('página Bolsistas no modo exemplo', () => {
  it('carrega os 25 bolsistas sintéticos, os 4 centros e as 2 caixas sem banco', async () => {
    render(<Bolsistas usuarioId="exemplo" />, document.body);
    const contexto = await esperarPor(() => document.querySelector('.bolsistas__contexto'));
    expect(contexto.textContent).toContain('25 pessoas');
    expect(document.querySelectorAll('.bolsistas__filtro-centro')).toHaveLength(4);
    expect(document.querySelectorAll('.bolsistas__caixa')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('R$ 0');

    const chips = Array.from(document.querySelectorAll('.bolsistas__filtro-chips .chip'));
    for (const rotulo of ['Alertas', 'Solos']) {
      chips.find((c) => c.textContent === rotulo).click();
    }
    await esperarPor(() => nomesNaLista().length === 24);

    // Todos os 25, menos quem só tem bolsa encerrada no passado.
    expect(nomesNaLista()).toHaveLength(24);
    expect(nomesNaLista()).not.toContain('Bolsista Davi');
  });
});
