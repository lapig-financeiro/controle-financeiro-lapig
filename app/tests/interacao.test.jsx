// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Campo } from '../src/componentes/Campo.jsx';
import { Documento } from '../src/componentes/Documento.jsx';
import { Esqueleto } from '../src/componentes/Esqueleto.jsx';
import { PainelLateral } from '../src/componentes/PainelLateral.jsx';
import { Seletor } from '../src/componentes/Seletor.jsx';
import { Tabela } from '../src/componentes/Tabela.jsx';

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

const tick = () => new Promise((r) => setTimeout(r, 25));

describe('pilha de Esc e foco estável em PainelLateral/Documento', () => {
  it('fecha primeiro a camada do topo (Documento) e só depois PainelLateral', async () => {
    const fecharPainel = vi.fn();
    const fecharDocumento = vi.fn();

    render(
      <>
        <PainelLateral aberto aoFechar={fecharPainel} titulo="Painel">
          <p>Conteúdo do painel</p>
        </PainelLateral>
        <Documento aberto aoFechar={fecharDocumento} titulo="Documento" valor={100} />
      </>,
      document.body
    );
    await tick();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fecharDocumento).toHaveBeenCalledTimes(1);
    expect(fecharPainel).toHaveBeenCalledTimes(0);

    render(
      <PainelLateral aberto aoFechar={fecharPainel} titulo="Painel">
        <p>Conteúdo do painel</p>
      </PainelLateral>,
      document.body
    );
    await tick();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fecharPainel).toHaveBeenCalledTimes(1);
  });

  it('não rouba o foco em re-render quando aoFechar muda de referência', async () => {
    function montar(contador) {
      render(
        <PainelLateral aberto aoFechar={() => contador} titulo="Painel">
          <input id="campo-interno" type="text" />
        </PainelLateral>,
        document.body
      );
    }

    montar(1);
    await tick();
    const input = document.getElementById('campo-interno');
    input.focus();
    expect(document.activeElement).toBe(input);

    montar(2);
    await tick();
    expect(document.activeElement).toBe(input);
  });
});

describe('acessibilidade de Campo, Seletor, Tabela e Esqueleto', () => {
  it('liga aria-describedby de Campo e Seletor para ajuda e erro', () => {
    render(
      <>
        <Campo id="c1" rotulo="Nome" ajuda="Texto de ajuda" erro="Campo obrigatório" />
        <Seletor id="s1" rotulo="Tipo" opcoes={[{ valor: 'a', rotulo: 'A' }]} ajuda="Ajuda seletor" />
      </>,
      document.body
    );

    const campo = document.getElementById('c1');
    expect(campo.getAttribute('aria-describedby')).toBe('c1-erro c1-ajuda');

    const seletor = document.getElementById('s1');
    expect(seletor.getAttribute('aria-describedby')).toBe('s1-ajuda');
  });

  it('Tabela sem linhas renderiza Vazio e Esqueleto expõe role="status"', () => {
    render(
      <>
        <Tabela colunas={[{ chave: 'nome', titulo: 'Nome' }]} dados={[]} />
        <Esqueleto variante="linha" linhas={2} rotulo="Carregando projetos" />
      </>,
      document.body
    );

    expect(document.querySelector('.vazio')).not.toBeNull();
    const status = document.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toContain('Carregando projetos');
  });
});
