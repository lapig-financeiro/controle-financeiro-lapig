// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  saldoLivreMock,
  repassesMock,
  balancetesMock,
  planosMock,
  pendenciasMock,
  resolverPendenciaMock,
} = vi.hoisted(() => ({
  saldoLivreMock: vi.fn(),
  repassesMock: vi.fn(),
  balancetesMock: vi.fn(),
  planosMock: vi.fn(),
  pendenciasMock: vi.fn(),
  resolverPendenciaMock: vi.fn(),
}));

vi.mock('../src/servicos/dados.js', () => ({
  saldoLivre: saldoLivreMock,
  repasses: repassesMock,
  balancetes: balancetesMock,
  planos: planosMock,
  pendencias: pendenciasMock,
  resolverPendencia: resolverPendenciaMock,
}));

import { Projeto } from '../src/paginas/Projeto.jsx';

const tick = () => new Promise((r) => setTimeout(r, 25));

afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = '';
});

beforeEach(() => {
  saldoLivreMock.mockReset();
  repassesMock.mockReset();
  balancetesMock.mockReset();
  planosMock.mockReset();
  pendenciasMock.mockReset();
  resolverPendenciaMock.mockReset();
});

function configurarPadrao({
  grupos = [
    {
      grupo_code: 'a',
      grupo_name: 'Pessoal',
      previsto: 800000,
      realizado: 600000,
      compromissos: 140000,
      saldo_livre: 60000,
      compromissos_cobertura: 'bolsas',
    },
    {
      grupo_code: 'b',
      grupo_name: 'Serviços',
      previsto: 100000,
      realizado: 75700,
      compromissos: 0,
      saldo_livre: 24300,
      compromissos_cobertura: 'nenhuma',
    },
  ],
} = {}) {
  saldoLivreMock.mockResolvedValue({
    dados: {
      has_plano: true,
      has_balancete: true,
      project_id: 'p-1',
      project_name: 'Bacia do Cerrado',
      end_date: '2027-08-31',
      data_referencia: '2026-10-15',
      bolsas_ativas: [
        { scholarship_id: 'b1', bolsista: 'Bolsista 1', valor_mensal: 6000, end_date: '2027-08-31' },
        { scholarship_id: 'b2', bolsista: 'Bolsista 2', valor_mensal: 4000, end_date: '2027-06-30' },
        { scholarship_id: 'b3', bolsista: 'Bolsista Encerrada', valor_mensal: 3500, end_date: '2026-10-31' },
      ],
      grupos,
      rubricas: [],
    },
    erro: null,
  });

  repassesMock.mockResolvedValue({
    dados: {
      parcelas: [
        { parcela: 1, data_prevista: '2026-01-15', data_texto: null, valor: 250000, valor_texto: null },
        { parcela: 2, data_prevista: '2026-06-15', data_texto: null, valor: 250000, valor_texto: null },
        { parcela: 3, data_prevista: '2027-01-20', data_texto: null, valor: 250000, valor_texto: null },
      ],
      valor_total_plano: 750000,
      data_balancete: '2026-10-15',
      recursos: { recebido: 500000, a_receber: 0 },
    },
    erro: null,
  });

  balancetesMock.mockResolvedValue({
    dados: [
      { id: 'bal-1', data_referencia: '2026-10-15', arquivo_nome: 'balancete-out.pdf' },
    ],
    erro: null,
  });

  planosMock.mockResolvedValue({
    dados: [
      { id: 'pl-2', versao: 2, ativo: true, data_documento: '2026-06-10', arquivo_nome: 'plano-v2.docx' },
      { id: 'pl-1', versao: 1, ativo: false, data_documento: '2025-11-01', arquivo_nome: 'plano-v1.docx' },
    ],
    erro: null,
  });

  pendenciasMock.mockResolvedValue({
    dados: [
      {
        id: 'pend-1',
        project_id: 'p-1',
        code: '30.901',
        tipo: 'balancete',
        titulo: 'Conta sem rubrica vinculada',
        detalhe: { conta: '7.1.3.99' },
        situacao: 'aberta',
        origem: 'sistema',
        criada_em: '2026-11-18T17:00:00Z',
      },
    ],
    erro: null,
  });
}

describe('página do Projeto', () => {
  it('usa o livre do resumo sem recalcular, soma partes no painel, filtra bolsas ativas e calcula repasses', async () => {
    configurarPadrao();
    render(
      <Projeto
        projectId="p-1"
        hoje="2026-11-18"
        isAdmin
        resumoCentro={{
          id: 'p-1',
          code: '30.901',
          name: 'Bacia do Cerrado',
          end_date: '2027-08-31',
          drive_folder_url: 'https://drive.google.com/drive/folders/teste',
          livre: 84300,
          situacao: 'em dia',
          data_referencia: '2026-10-15',
        }}
      />,
      document.body
    );
    await tick();

    const destaques = Array.from(document.querySelectorAll('.destaque'));
    expect(destaques[0].textContent).toContain('84.300');
    expect(destaques[0].textContent).toContain('balancete de out/26');

    // Bolsas por mês soma só end_date >= 2026-11-18 (6000 + 4000 = 10.000; ignora 3500 encerrada).
    expect(destaques[1].textContent).toContain('10.000');
    expect(destaques[1].textContent).toContain('2 bolsistas ativos');

    // Repasses via situacaoDasParcelas: 2 recebidas de 3, próxima em jan/27.
    expect(destaques[2].textContent).toContain('2 de 3');
    expect(destaques[2].textContent).toContain('próximo em jan/27');

    // Botão Pasta no Drive visível para admin com URL.
    const linkDrive = Array.from(document.querySelectorAll('a.botao')).find((a) =>
      a.textContent.includes('Pasta no Drive')
    );
    expect(linkDrive).toBeTruthy();
    expect(linkDrive.getAttribute('href')).toBe('https://drive.google.com/drive/folders/teste');

    // Abre painel "De onde vem este valor" ao clicar no destaque principal.
    destaques[0].querySelector('button.valor--origem').click();
    await tick();
    const painel = document.querySelector('.painel-lateral');
    expect(painel.textContent).toContain('De onde vem este valor');
    expect(painel.textContent).toContain('84.300,00');
    expect(painel.querySelector('.aviso-falha')).toBeNull();
  });

  it('acusa no painel quando a soma dos grupos não bate com o livre do resumo e esconde Drive para professor', async () => {
    configurarPadrao({
      grupos: [
        {
          grupo_code: 'a',
          grupo_name: 'Pessoal',
          previsto: 500000,
          realizado: 400000,
          compromissos: 50000,
          saldo_livre: 50000,
          compromissos_cobertura: 'bolsas',
        },
      ],
    });

    render(
      <Projeto
        projectId="p-1"
        hoje="2026-11-18"
        isAdmin={false}
        resumoCentro={{
          id: 'p-1',
          code: '30.901',
          name: 'Bacia do Cerrado',
          end_date: '2027-08-31',
          drive_folder_url: null,
          livre: 84300,
          situacao: 'em dia',
          data_referencia: '2026-10-15',
        }}
      />,
      document.body
    );
    await tick();

    expect(document.body.textContent).not.toContain('Pasta no Drive');

    const destaquePrincipal = document.querySelector('.destaque--principal');
    expect(destaquePrincipal.textContent).toContain('84.300');
    destaquePrincipal.querySelector('button.valor--origem').click();
    await tick();

    const painel = document.querySelector('.painel-lateral');
    expect(painel.querySelector('.aviso-falha')).not.toBeNull();
    expect(painel.textContent).toContain('50.000,00');
  });

  it('trata centro sem plano (048 sem grupos/bolsas_ativas) e centro sem balancete sem mostrar zeros', async () => {
    saldoLivreMock.mockResolvedValue({
      dados: {
        has_plano: false,
        has_balancete: true,
        project_id: 'p-sem-plano',
        project_name: 'Inventário Sem Plano',
        message: 'Sem plano ativo.',
      },
      erro: null,
    });
    repassesMock.mockResolvedValue({
      dados: { parcelas: [], valor_total_plano: null, data_balancete: '2026-10-10', recursos: { recebido: 0 } },
      erro: null,
    });
    balancetesMock.mockResolvedValue({ dados: [], erro: null });
    planosMock.mockResolvedValue({ dados: [], erro: null });
    pendenciasMock.mockResolvedValue({ dados: [], erro: null });

    render(
      <Projeto
        projectId="p-sem-plano"
        hoje="2026-11-18"
        resumoCentro={{
          id: 'p-sem-plano',
          code: '30.905',
          name: 'Inventário Sem Plano',
          end_date: '2027-09-30',
          livre: null,
          situacao: 'sem plano',
          data_referencia: '2026-10-10',
        }}
      />,
      document.body
    );
    await tick();

    const destaques = Array.from(document.querySelectorAll('.destaque'));
    expect(destaques[0].textContent).toContain('—');
    expect(destaques[0].textContent).toContain('sem plano');
    expect(destaques[1].textContent).toContain('—');
    expect(destaques[1].textContent).toContain('sem plano');
    expect(destaques[1].textContent).not.toContain('0 bolsas');
    expect(document.querySelector('.abas__painel .vazio').textContent).toContain('não tem plano de trabalho ativo');

    // Centro sem balancete: destaque principal e repasses mostram — e "sem balancete" (nunca "R$ 0" nem "0 de 2").
    saldoLivreMock.mockResolvedValue({
      dados: {
        has_plano: true,
        has_balancete: false,
        project_id: 'p-sem-bal',
        project_name: 'Veredas Sem Balancete',
        end_date: '2027-12-31',
        bolsas_ativas: [],
        grupos: [
          {
            grupo_code: 'a',
            grupo_name: 'Pessoal',
            previsto: 300000,
            realizado: 0,
            compromissos: 0,
            saldo_livre: 300000,
            compromissos_cobertura: 'bolsas',
          },
        ],
        rubricas: [],
      },
      erro: null,
    });
    repassesMock.mockResolvedValue({
      dados: {
        parcelas: [{ parcela: 1, data_prevista: '2027-02-01', data_texto: null, valor: 150000, valor_texto: null }],
        valor_total_plano: 300000,
        data_balancete: null,
        recursos: null,
      },
      erro: null,
    });

    render(null, document.body);
    render(
      <Projeto
        projectId="p-sem-bal"
        hoje="2026-11-18"
        resumoCentro={{
          id: 'p-sem-bal',
          code: '30.904',
          name: 'Veredas Sem Balancete',
          end_date: '2027-12-31',
          livre: null,
          situacao: 'sem balancete',
          data_referencia: null,
        }}
      />,
      document.body
    );
    await tick();

    const destaquesSemBal = Array.from(document.querySelectorAll('.destaque'));
    expect(destaquesSemBal[0].textContent).toContain('—');
    expect(destaquesSemBal[0].textContent).toContain('sem balancete');
    expect(destaquesSemBal[0].textContent).not.toContain('R$ 0');
    expect(destaquesSemBal[2].textContent).toContain('—');
    expect(destaquesSemBal[2].textContent).toContain('sem balancete');
    expect(destaquesSemBal[2].textContent).not.toContain('0 de 1');
  });

  it('abre na aba pendencias, confirma inline sem window.confirm e ordena documentos', async () => {
    configurarPadrao();
    resolverPendenciaMock.mockResolvedValue({ dados: { id: 'pend-1', situacao: 'resolvida' }, erro: null });
    const confirmOriginal = window.confirm;
    const confirmSpy = vi.fn();
    window.confirm = confirmSpy;
    const aoMudarPendencias = vi.fn();

    try {
      render(
        <Projeto
          projectId="p-1"
          abaInicial="pendencias"
          hoje="2026-11-18"
          onMudarPendencias={aoMudarPendencias}
          resumoCentro={{
            id: 'p-1',
            code: '30.901',
            name: 'Bacia do Cerrado',
            end_date: '2027-08-31',
            livre: 84300,
            situacao: 'em dia',
            data_referencia: '2026-10-15',
          }}
        />,
        document.body
      );
      await tick();

      expect(document.body.textContent).toContain('Conta sem rubrica vinculada');
      const btnResolvida = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Resolvida'
      );
      btnResolvida.click();
      await tick();

      expect(document.body.textContent).toContain('Confirmar que esta pendência foi resolvida?');
      const btnConfirmar = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Confirmar'
      );
      btnConfirmar.click();
      await tick();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(resolverPendenciaMock).toHaveBeenCalledWith('pend-1', 'resolvida');
      expect(aoMudarPendencias).toHaveBeenCalledTimes(1);

      const abaDocs = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
        t.textContent.includes('Documentos')
      );
      abaDocs.click();
      await tick();

      const linhasDocs = Array.from(document.querySelectorAll('.tabela__linha')).map((l) => l.textContent);
      expect(linhasDocs[0]).toContain('balancete-out.pdf');
      expect(linhasDocs[1]).toContain('plano-v2.docx');
      expect(linhasDocs[2]).toContain('plano-v1.docx');
    } finally {
      window.confirm = confirmOriginal;
    }
  });
});
