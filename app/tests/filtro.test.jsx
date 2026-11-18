// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarraTopo } from '../src/componentes/BarraTopo.jsx';
import { FiltroVisao } from '../src/componentes/FiltroVisao.jsx';
import { Sino } from '../src/componentes/Sino.jsx';

const tick = () => new Promise((r) => setTimeout(r, 25));

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

const TODOS_EXEMPLO = [
  {
    id: 'c1',
    code: '30.901',
    name: 'Centro Alpha',
    responsaveis: ['Profa. Clara'],
    oculto: false,
  },
  {
    id: 'c2',
    code: '30.902',
    name: 'Centro Beta',
    responsaveis: ['Prof. Renato', 'Profa. Clara'],
    oculto: true,
  },
  {
    id: 'c3',
    code: '30.903',
    name: 'Centro Sem Responsável',
    responsaveis: [],
    oculto: true,
  },
];

describe('FiltroVisao e BarraTopo', () => {
  it('mostra N de M centros e oculta o chip para professor', () => {
    render(
      <BarraTopo
        isAdmin
        usuario={{ nome: 'Admin', email: 'admin@lapig.ufg.br' }}
        todosCentros={TODOS_EXEMPLO}
        onSalvarFiltro={vi.fn()}
      />,
      document.body
    );

    const chip = document.querySelector('.barra-topo__filtro');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('1 de 3 centros');
    expect(chip.classList.contains('chip--ativo')).toBe(true);

    render(
      <BarraTopo
        isAdmin={false}
        usuario={{ nome: 'Prof', email: 'prof@lapig.ufg.br' }}
        todosCentros={TODOS_EXEMPLO}
      />,
      document.body
    );

    expect(document.querySelector('.barra-topo__filtro')).toBeNull();
  });

  it('agrupa por responsaveis[0] com Sem responsável por último, seleciona co-responsável em Só estes e limpa em Mostrar todos', async () => {
    const salvar = vi.fn().mockResolvedValue({ erro: null });
    render(<FiltroVisao todos={TODOS_EXEMPLO} onSalvar={salvar} />, document.body);

    document.querySelector('.barra-topo__filtro').click();
    await tick();

    const grupos = Array.from(document.querySelectorAll('.filtro-visao__grupo-nome')).map(
      (g) => g.textContent
    );
    expect(grupos).toEqual(['Prof. Renato', 'Profa. Clara', 'Sem responsável']);

    // Atalho "Só estes" de Profa. Clara mantém c1 (responsaveis[0]) e c2 (responsaveis[1]), ocultando só c3.
    const btnSoClara = document.querySelector('button[aria-label="Mostrar só os centros de Profa. Clara"]');
    expect(btnSoClara).not.toBeNull();
    expect(btnSoClara.textContent).toBe('Só estes');
    btnSoClara.click();
    await tick();
    expect(salvar).toHaveBeenCalledWith(['c3']);

    // "Mostrar todos" salva lista vazia.
    const btnTodos = Array.from(document.querySelectorAll('.filtro-visao__acao')).find(
      (b) => b.textContent === 'Mostrar todos'
    );
    btnTodos.click();
    await tick();
    expect(salvar).toHaveBeenLastCalledWith([]);
  });

  it('aplica atualização otimista, ignora segundo clique enquanto salva sem perder foco e reverte se falhar', async () => {
    let resolver;
    const salvar = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolver = r;
        })
    );

    render(<FiltroVisao todos={TODOS_EXEMPLO} onSalvar={salvar} />, document.body);

    document.querySelector('.barra-topo__filtro').click();
    await tick();

    const btnSoClara = document.querySelector('button[aria-label="Mostrar só os centros de Profa. Clara"]');
    btnSoClara.focus();
    btnSoClara.click();
    await tick();

    // Otimista: 2 de 3 centros (apenas c3 oculto), aria-disabled="true" e foco preservado no botão.
    expect(document.querySelector('.barra-topo__filtro').textContent).toContain('2 de 3 centros');
    expect(btnSoClara.getAttribute('aria-disabled')).toBe('true');
    expect(btnSoClara.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(btnSoClara);

    // Segundo clique enquanto ainda salva deve ser ignorado.
    const btnTodos = Array.from(document.querySelectorAll('.filtro-visao__acao')).find(
      (b) => b.textContent === 'Mostrar todos'
    );
    btnTodos.click();
    await tick();
    expect(salvar).toHaveBeenCalledTimes(1);

    // Se falhar, reverte otimismo para 1 de 3 e exibe AvisoFalha.
    resolver({ erro: 'Falha ao salvar filtro.' });
    await tick();

    expect(document.querySelector('.barra-topo__filtro').textContent).toContain('1 de 3 centros');
    expect(document.querySelector('.filtro-visao__erro .aviso-falha').textContent).toContain(
      'Falha ao salvar filtro.'
    );
  });
});

describe('Sino nos três estados', () => {
  it('renderiza consultando, indisponivel e lista em MenuSuspenso com link por centro e sem link para geral', async () => {
    render(<Sino estado="consultando" />, document.body);
    document.querySelector('.sino__botao').click();
    await tick();
    expect(document.querySelector('.menu-suspenso [role="status"]').textContent).toContain(
      'Consultando pendências'
    );

    const tentar = vi.fn();
    render(null, document.body);
    render(
      <Sino estado="indisponivel" erro="Falha de consulta." onTentarNovamente={tentar} />,
      document.body
    );
    document.querySelector('.sino__botao').click();
    await tick();
    expect(document.querySelector('.menu-suspenso .aviso-falha').textContent).toContain(
      'Falha de consulta.'
    );
    document.querySelector('.menu-suspenso .aviso-falha button').click();
    expect(tentar).toHaveBeenCalledTimes(1);

    render(null, document.body);
    render(
      <Sino
        estado="pronto"
        pendencias={[
          {
            id: 'p1',
            project_id: 'c1',
            centro: 'Centro Alpha · 30.901',
            titulo: 'Conta sem rubrica',
            situacao: 'aberta',
            criada_em: '2026-11-18T18:00:00Z',
          },
          {
            id: 'p2',
            project_id: null,
            centro: 'Geral',
            titulo: 'Pendência sem centro',
            situacao: 'aberta',
            criada_em: '2026-11-18T17:00:00Z',
          },
        ]}
      />,
      document.body
    );

    expect(document.querySelector('.sino__contagem').textContent).toBe('2');
    document.querySelector('.sino__botao').click();
    await tick();

    const link = document.querySelector('.menu-suspenso a.sino__item');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('#/projeto/c1/pendencias');

    const estatico = document.querySelector('.menu-suspenso .sino__item--estatico');
    expect(estatico).not.toBeNull();
    expect(estatico.tagName).toBe('DIV');
    expect(estatico.textContent).toContain('Pendência sem centro');
  });
});
