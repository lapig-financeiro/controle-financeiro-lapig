// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Projetos } from '../src/paginas/Projetos.jsx';

const tick = () => new Promise((r) => setTimeout(r, 25));

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

const RESUMO_BASE = {
  ocultos: 2,
  centros: [
    {
      id: '3',
      code: '30.903',
      name: 'Zebra Ambiental',
      end_date: '2027-06-30',
      livre: 10000,
      situacao: 'problema',
      erro: null,
    },
    {
      id: '1',
      code: '30.901',
      name: 'Atlas Hídrico',
      end_date: '2027-08-31',
      livre: 84300,
      situacao: 'em dia',
      erro: null,
    },
    {
      id: '2',
      code: '30.902',
      name: 'Kalungas Teste',
      end_date: null,
      livre: null,
      situacao: 'sem balancete',
      erro: null,
    },
    {
      id: '4',
      code: '30.904',
      name: 'Serra Erro',
      end_date: '2027-05-31',
      livre: null,
      situacao: 'sem dado',
      erro: 'falha_saldo_livre',
    },
  ],
};

describe('página Projetos', () => {
  it('ordena centros alfabeticamente e monta linha de contexto com e sem ocultos', () => {
    render(<Projetos resumo={RESUMO_BASE} isAdmin />, document.body);

    const nomes = Array.from(document.querySelectorAll('.projetos__nome')).map((el) => el.textContent);
    expect(nomes).toEqual(['Atlas Hídrico', 'Kalungas Teste', 'Serra Erro', 'Zebra Ambiental']);

    const contexto = document.querySelector('.cabecalho-pagina__contexto').textContent;
    expect(contexto).toContain('4 centros');
    expect(contexto).toContain('R$ 94,3 mil livres no total');
    expect(contexto).toContain('2 centros sem número');
    expect(contexto).toContain('2 centros ocultos');

    render(
      <Projetos
        resumo={{
          ocultos: 0,
          centros: RESUMO_BASE.centros.slice(0, 2),
        }}
        isAdmin={false}
      />,
      document.body
    );

    const contextoSemOcultos = document.querySelector('.cabecalho-pagina__contexto').textContent;
    expect(contextoSemOcultos).toBe('2 centros · R$ 94,3 mil livres no total');
  });

  it('exibe só chips de situações presentes e filtra a lista ao clicar', async () => {
    render(<Projetos resumo={RESUMO_BASE} isAdmin />, document.body);

    const rotulos = Array.from(document.querySelectorAll('.projetos__chips .chip')).map(
      (c) => c.textContent
    );
    expect(rotulos).toEqual(['Todas', 'Em dia', 'Problema', 'Sem balancete', 'Sem dado']);
    expect(rotulos).not.toContain('Atenção');
    expect(rotulos).not.toContain('Sem plano');

    const chipSemBalancete = Array.from(document.querySelectorAll('.projetos__chips .chip')).find(
      (c) => c.textContent === 'Sem balancete'
    );
    chipSemBalancete.click();
    await tick();

    const nomesFiltrados = Array.from(document.querySelectorAll('.projetos__nome')).map(
      (el) => el.textContent
    );
    expect(nomesFiltrados).toEqual(['Kalungas Teste']);
  });

  it('mostra travessão e frase correta para sem balancete e falha_saldo_livre (nunca R$ 0)', () => {
    render(<Projetos resumo={RESUMO_BASE} isAdmin />, document.body);

    const linhas = Array.from(document.querySelectorAll('.linha-de-lista'));
    const linhaSemBalancete = linhas.find((l) => l.textContent.includes('Kalungas Teste'));
    expect(linhaSemBalancete.textContent).toContain('—');
    expect(linhaSemBalancete.textContent).toContain('sem balancete');
    expect(linhaSemBalancete.textContent).not.toContain('R$ 0');

    const linhaErro = linhas.find((l) => l.textContent.includes('Serra Erro'));
    expect(linhaErro.textContent).toContain('Não foi possível calcular o saldo deste centro');
    expect(linhaErro.textContent).toContain('—');
    expect(linhaErro.textContent).toContain('sem dado');
  });

  it('mostra AvisoFalha em erro e Vazio com Mostrar todos quando há centros ocultos', () => {
    const recarregar = vi.fn();
    render(
      <Projetos erro="Falha ao consultar centros." onRecarregar={recarregar} />,
      document.body
    );

    expect(document.querySelector('.aviso-falha').textContent).toContain('Falha ao consultar centros.');
    document.querySelector('.aviso-falha button').click();
    expect(recarregar).toHaveBeenCalledTimes(1);

    const mostrarTodos = vi.fn();
    render(
      <Projetos
        resumo={{ centros: [], ocultos: 3, todos: [] }}
        isAdmin
        onMostrarTodos={mostrarTodos}
      />,
      document.body
    );

    expect(document.querySelector('.vazio').textContent).toContain('Nenhum centro para mostrar.');
    const btnMostrar = document.querySelector('.vazio button');
    expect(btnMostrar.textContent).toBe('Mostrar todos');
    btnMostrar.click();
    expect(mostrarTodos).toHaveBeenCalledTimes(1);
  });
});
