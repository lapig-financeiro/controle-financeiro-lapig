// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { LinhaDeLista, Lista, Tabela } from '../src/componentes/index.js';
import { Situacao } from '../src/componentes/Situacao.jsx';

const MOTIVOS = [
  {
    codigo: 'saldo_negativo',
    nivel: 'problema',
    texto: 'Rubrica f — Equipamentos: gasto R$ 100,00 acima do previsto.',
    grupo_code: 'f',
    valor: 100,
  },
  {
    codigo: 'tarifa_bancaria',
    nivel: 'atenção',
    texto:
      'Rubrica b — Serviços: R$ 14,34 de tarifa bancária sem previsão no plano.',
    grupo_code: 'b',
    valor: 14.34,
  },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function abrirComMouse(selo) {
  selo.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

describe('Situacao com motivos', () => {
  it('abre o balão no mouse e no foco, um texto por linha, e fecha com Esc', async () => {
    render(
      <Lista ariaLabel="Centros de custo">
        <LinhaDeLista href="#/projeto">
          <Situacao estado="atenção" motivos={MOTIVOS} />
        </LinhaDeLista>
      </Lista>,
      document.body
    );

    const selo = document.querySelector('.situacao');
    expect(selo.getAttribute('tabindex')).toBe('0');
    const idBalao = selo.getAttribute('aria-describedby');
    expect(idBalao).toBeTruthy();

    abrirComMouse(selo);
    await tick();

    const balao = document.getElementById(idBalao);
    expect(balao).toBeTruthy();
    expect(balao.getAttribute('role')).toBe('tooltip');
    expect(balao.getAttribute('data-aberto')).toBe('true');
    expect(balao.querySelectorAll('.situacao__balao-linha')).toHaveLength(2);
    expect(balao.textContent).toContain('R$ 100,00');
    expect(balao.textContent).toContain('R$ 14,34');
    expect(balao.querySelector('.situacao__balao-ponto--problema')).not.toBeNull();
    expect(balao.querySelector('.situacao__balao-ponto--atencao')).not.toBeNull();

    // O balão é montado no body: não é cortado pelo overflow da lista.
    expect(document.querySelector('.lista-de-linhas').contains(balao)).toBe(false);
    expect(document.body.contains(balao)).toBe(true);

    selo.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    await esperar(180);
    expect(balao.getAttribute('data-aberto')).toBe('false');

    selo.focus();
    await tick();
    expect(balao.getAttribute('data-aberto')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(balao.getAttribute('data-aberto')).toBe('false');
  });

  it('mantém o balão aberto enquanto o ponteiro está no selo ou no balão', async () => {
    render(
      <Lista ariaLabel="Centros de custo">
        <LinhaDeLista href="#/projeto">
          <Situacao estado="atenção" motivos={MOTIVOS} />
        </LinhaDeLista>
      </Lista>,
      document.body
    );

    const selo = document.querySelector('.situacao');
    abrirComMouse(selo);
    await tick();
    const balao = document.querySelector('.situacao__balao');
    expect(balao.getAttribute('data-aberto')).toBe('true');

    // Sai do selo direto para o balão: não pode fechar antes de dar tempo.
    selo.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: balao })
    );
    balao.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await esperar(200);
    expect(balao.getAttribute('data-aberto')).toBe('true');

    // Saiu do balão: fecha com o atraso.
    balao.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
    );
    await esperar(200);
    expect(balao.getAttribute('data-aberto')).toBe('false');
  });

  it('dentro da tabela o balão também sai no body, e sem motivos o selo fica como antes', async () => {
    render(
      <Tabela
        colunas={[
          { chave: 'nome', titulo: 'Rubrica' },
          {
            chave: 'situacao',
            titulo: 'Situação',
            render: (linha) => <Situacao estado={linha.situacao} motivos={linha.motivos} />,
          },
        ]}
        dados={[
          { id: 'b', nome: 'Serviços de Terceiros', situacao: 'problema', motivos: MOTIVOS },
        ]}
        chaveLinha={(linha) => linha.id}
        legenda="Rubricas do centro"
      />,
      document.body
    );

    const selo = document.querySelector('.situacao');
    abrirComMouse(selo);
    await tick();

    const balao = document.querySelector('.situacao__balao');
    expect(balao).toBeTruthy();
    expect(balao.getAttribute('data-aberto')).toBe('true');
    expect(document.querySelector('.tabela-envoltorio').contains(balao)).toBe(false);
    expect(document.body.contains(balao)).toBe(true);

    render(null, document.body);
    document.body.innerHTML = '';

    render(<Situacao estado="problema" />, document.body);
    const semMotivos = document.querySelector('.situacao');
    expect(semMotivos.getAttribute('tabindex')).toBeNull();
    expect(semMotivos.hasAttribute('aria-describedby')).toBe(false);
    expect(semMotivos.classList.contains('situacao--com-motivos')).toBe(false);
    expect(document.querySelector('.situacao__balao')).toBeNull();
  });
});

describe('Situacao: um balão por vez', () => {
  it('clicar no selo de outro centro fecha o balão que estava aberto', async () => {
    render(
      <Lista ariaLabel="Centros de custo">
        <LinhaDeLista href="#/a">
          <Situacao estado="atenção" motivos={MOTIVOS} />
        </LinhaDeLista>
        <LinhaDeLista href="#/b">
          <Situacao estado="problema" motivos={MOTIVOS} />
        </LinhaDeLista>
      </Lista>,
      document.body
    );
    const [a, b] = document.querySelectorAll('.situacao');
    a.click();
    await tick();
    expect(document.getElementById(a.getAttribute('aria-describedby')).getAttribute('data-aberto')).toBe('true');

    b.click();
    await tick();
    const abertos = Array.from(document.querySelectorAll('.situacao__balao')).filter(
      (el) => el.getAttribute('data-aberto') === 'true'
    );
    expect(abertos).toHaveLength(1);
    expect(abertos[0].id).toBe(b.getAttribute('aria-describedby'));
  });
});
