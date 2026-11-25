import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { criarSessao } from '../../shared/ai-tools/index.js';

const aqui = dirname(fileURLToPath(import.meta.url));

function fixture(nome) {
  return JSON.parse(
    readFileSync(resolve(aqui, '..', 'fixtures', 'ai-tools-v2', `${nome}.json`), 'utf8')
  );
}

function montar() {
  const respostas = {
    resumo_projetos_v2: { data: fixture('resumo_projetos'), error: null },
    get_termos_contrato_v2: { data: fixture('termos_contrato'), error: null },
    get_pedido_bolsas_v2: { data: fixture('pedido_bolsas'), error: null },
  };
  return criarSessao({
    rpc: async (nome) => respostas[nome] ?? { data: null, error: { message: `sem fixture: ${nome}` } },
    hoje: '2026-11-25',
  });
}

function acharNo(dados, parte) {
  const no = dados.nos.find((item) => item.rotulo.includes(parte));
  expect(no, `nó "${parte}"`).toBeTruthy();
  return no;
}

async function preparar() {
  const sessao = montar();
  const centros = JSON.parse((await sessao.executar('listar_centros', {})).paraModelo);
  const termos = JSON.parse(
    (await sessao.executar('termos_contrato', { project_id: '30.901' })).paraModelo
  );
  return { sessao, centros, termos };
}

describe('marcarTexto', () => {
  it('não marca número de bloco citado e marca o inventado', async () => {
    const { sessao, centros } = await preparar();
    const livre = acharNo(centros, 'Livre — Centro Exemplo Um');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: livre.id });

    expect(sessao.marcarTexto('O livre é R$ 84.300,00.').semOrigem).toEqual([]);
    const inventado = sessao.marcarTexto('O livre é R$ 99.000,00.');
    expect(inventado.semOrigem).toHaveLength(1);
    const trecho = inventado.texto.slice(inventado.semOrigem[0].inicio, inventado.semOrigem[0].fim);
    expect(trecho).toBe('R$ 99.000,00');
  });

  it('não marca código de centro nem código de conta', async () => {
    const { sessao } = await preparar();
    expect(sessao.marcarTexto('Centro 30.901 e 78.116.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Conta 7.1.3.99 sem rubrica.').semOrigem).toEqual([]);
  });

  it('não marca data citada e marca a diferente', async () => {
    const { sessao, centros } = await preparar();
    const vigencia = acharNo(centros, 'Vigência — 30.901');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: vigencia.id });

    expect(sessao.marcarTexto('Vence em 30/09/2027.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em 2027-09-30.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em set/27.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('Vence em 30/09/2028.').semOrigem).toHaveLength(1);
    expect(sessao.marcarTexto('Vence em set/28.').semOrigem).toHaveLength(1);
  });

  it('não marca percentual citado e marca o diferente', async () => {
    const { sessao, termos } = await preparar();
    const taxa = acharNo(termos, 'Taxa total');
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: taxa.id });

    expect(sessao.marcarTexto('A taxa é 9,75%.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('A taxa é 9.75%.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('A taxa é 10%.').semOrigem).toHaveLength(1);
  });

  it('reconhece moeda negativa e a marca quando não é nó', async () => {
    const { sessao } = await preparar();
    const marcado = sessao.marcarTexto('O saldo é R$ −4.250,00.');
    expect(marcado.semOrigem).toHaveLength(1);
    const trecho = marcado.texto.slice(marcado.semOrigem[0].inicio, marcado.semOrigem[0].fim);
    expect(trecho).toBe('R$ −4.250,00');
  });

  it('não marca resultado de calcular já citado em bloco', async () => {
    const { sessao, centros } = await preparar();
    const um = acharNo(centros, 'Livre — Centro Exemplo Um');
    const dois = acharNo(centros, 'Livre — Centro Exemplo Dois');
    const calculo = sessao.calcular({ op: 'soma', ids: [um.id, dois.id] });
    expect(calculo.erro).toBeUndefined();
    sessao.criarBloco({ tipo: 'numero', titulo: '', no: calculo.id });
    expect(sessao.marcarTexto('O total é R$ 103.700,00.').semOrigem).toEqual([]);
    expect(sessao.marcarTexto('O total é R$ 103.700,01.').semOrigem).toHaveLength(1);
  });

  it('marca um número sem nenhum bloco', async () => {
    const { sessao } = await preparar();
    const marcado = sessao.marcarTexto('São 3 centros e R$ 1.234,56.');
    expect(marcado.semOrigem).toHaveLength(2);
    expect(marcado.semOrigem[0].inicio).toBeLessThan(marcado.semOrigem[1].inicio);
  });
});
