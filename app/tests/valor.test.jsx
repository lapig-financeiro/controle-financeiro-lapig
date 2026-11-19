// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Destaque } from '../src/componentes/Destaque.jsx';
import { Valor } from '../src/componentes/Valor.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const semNbsp = (texto) => String(texto || '').replace(/\u00a0/g, ' ');

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

describe('Valor', () => {
  it('usa rotuloOrigem próprio e liga a ajuda por aria-describedby', () => {
    const onOrigem = vi.fn();
    render(
      <Valor
        valor={11240.15}
        centavos
        origem={{}}
        onOrigem={onOrigem}
        rotuloOrigem="Ver origem do rendimento"
        ariaDescritoPor="ajuda-rendimento"
        ariaBusy
      />,
      document.body
    );

    const botao = document.querySelector('button.valor--origem');
    expect(botao.getAttribute('aria-label')).toBe('Ver origem do rendimento');
    expect(botao.getAttribute('aria-describedby')).toBe('ajuda-rendimento');
    expect(botao.getAttribute('aria-busy')).toBe('true');
    expect(semNbsp(botao.textContent)).toBe('R$ 11.240,15');

    botao.click();
    expect(onOrigem).toHaveBeenCalledTimes(1);
  });

  it('sem rotuloOrigem, mantém o resumo da origem no aria-label', () => {
    render(
      <Valor valor={10} origem={{ resumo: 'Conta com origem' }} onOrigem={() => {}} />,
      document.body
    );

    const botao = document.querySelector('button.valor--origem');
    expect(semNbsp(botao.getAttribute('aria-label'))).toBe(
      'R$ 10 (Conta com origem). Ver origem'
    );
    expect(botao.hasAttribute('aria-describedby')).toBe(false);
    expect(botao.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('Destaque', () => {
  it('coloca a ajuda só no rótulo, não no cartão', () => {
    render(
      <Destaque rotulo="Dinheiro em conta" valor="R$ 1" ajuda="Ajuda curta" />,
      document.body
    );

    expect(document.querySelector('.destaque').hasAttribute('title')).toBe(false);
    expect(document.querySelector('.destaque__rotulo').getAttribute('title')).toBe('Ajuda curta');
  });

  it('exibe valores longos e negativos por inteiro', () => {
    render(
      <div>
        <Destaque
          rotulo="Longo"
          valor={<Valor valor={12345679} centavos={false} />}
        />
        <Destaque
          rotulo="Negativo"
          valor={<Valor valor={-12345679} centavos={false} problema />}
        />
      </div>,
      document.body
    );

    const valores = Array.from(document.querySelectorAll('.destaque__valor'));
    expect(semNbsp(valores[0].textContent)).toBe('R$ 12.345.679');
    expect(semNbsp(valores[1].textContent)).toBe('\u2212R$ 12.345.679');
  });

  it('Destaque.css permite quebrar o valor em 375 px', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../src/componentes/Destaque.css'),
      'utf8'
    );
    expect(css).toMatch(/\.destaque\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.destaque__valor\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  });
});
