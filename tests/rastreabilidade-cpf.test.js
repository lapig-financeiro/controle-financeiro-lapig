import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  candidatosCpf,
  contemCpf,
  cpfsDe,
  mascararCpf,
  temCpf,
  temCpfLargo064,
} from '../tools/rastreabilidade/cpf.mjs';
import { removerFatosComCpf } from '../tools/rastreabilidade/executar.mjs';

const NBSP = '\u00A0';
const EN_DASH = '\u2013';

// Mesmas strings que a suíte da 065 usa (Regra de CPF única); o
// fixture é um só para as duas tarefas.
const CASOS = JSON.parse(readFileSync(
  new URL('./fixtures/cpf-casos.json', import.meta.url),
  'utf8',
));
const VERDADEIROS = CASOS.verdadeiros;
const FALSOS = CASOS.falsos;

describe('temCpf — Regra de CPF única (065)', () => {
  it.each(VERDADEIROS)('reconhece %s', (texto) => {
    expect(temCpf(texto)).toBe(true);
  });

  it.each(FALSOS)('não reconhece %s', (texto) => {
    expect(temCpf(texto)).toBe(false);
  });

  it('a regra de candidatos é mais larga que a 052 (barra, NBSP, travessão)', () => {
    expect(contemCpf('529/982/247/25')).toBe(false);
    expect(temCpf('529/982/247/25')).toBe(true);
    expect(contemCpf(`529${NBSP}982${NBSP}247${NBSP}25`)).toBe(false);
    expect(temCpf(`529${NBSP}982${NBSP}247${NBSP}25`)).toBe(true);
    expect(temCpf(`529${EN_DASH}982${EN_DASH}247${EN_DASH}25`)).toBe(true);
  });

  it('acha o candidato a partir de cada posição, sem o vizinho roubar dígitos', () => {
    const achados = candidatosCpf('100 529.982.247-25');
    expect(achados).toHaveLength(1);
    expect(achados[0].digitos).toBe('52998224725');
    expect(cpfsDe('100 529.982.247-25')).toEqual(['52998224725']);
  });

  it('não transforma letra no vão em CPF', () => {
    expect(temCpf('529 e 982 e 247 e 25')).toBe(false);
    expect(temCpf('529, 982, 247 - 25')).toBe(true); // só pontuação no vão
  });

  it('não aceita 11 dígitos com DV inválido nem 12 dígitos', () => {
    expect(temCpf('123.456.789-00')).toBe(false);
    expect(temCpf('529982247250')).toBe(false);
  });

  it('mascararCpf não deixa CPF passar em nenhum dos verdadeiros', () => {
    for (const texto of VERDADEIROS) {
      const mascarado = mascararCpf(texto);
      expect(temCpf(mascarado)).toBe(false);
      expect(mascarado).toContain('***.***.***-**');
    }
  });

  it('mascararCpf devolve o texto intacto nos falsos', () => {
    for (const texto of FALSOS) {
      expect(mascararCpf(texto)).toBe(texto);
    }
  });

  it('mascararCpf troca exatamente o intervalo do CPF', () => {
    expect(mascararCpf('CPF 529 982 247 25 ok')).toBe('CPF ***.***.***-** ok');
    expect(mascararCpf('1.234,56 NOME 529.982.247-25')).toBe('1.234,56 NOME ***.***.***-**');
  });

  it('cpfsDe devolve os 11 dígitos, sem repetir', () => {
    expect(cpfsDe('529.982.247-25 e 529 982 247 25 e 123.456.789-00')).toEqual(['52998224725']);
  });

  it('texto nulo/vazio não tem CPF', () => {
    expect(temCpf(null)).toBe(false);
    expect(temCpf(undefined)).toBe(false);
    expect(temCpf('')).toBe(false);
  });

  it('a regra larga da 064 (só retentativa) pega o falso positivo que a 065 remove', () => {
    // "e" nos vãos: a 064 removia até 3 não-dígitos (inclusive letras) e
    // juntava os números; a 065 só aceita vãos sem letra.
    expect(temCpf('529 e 982 e 247 e 25')).toBe(false);
    expect(temCpfLargo064('529 e 982 e 247 e 25')).toBe(true);
  });

  it('a regra larga da 064 espelha as quatro checagens, inclusive vãos de 4 letras', () => {
    const comVaoDeQuatroLetras = '529abcd982efgh247ijkl25';
    expect(temCpf(comVaoDeQuatroLetras)).toBe(false);
    expect(contemCpf(comVaoDeQuatroLetras)).toBe(false);
    expect(temCpfLargo064(comVaoDeQuatroLetras)).toBe(true);
    expect(temCpfLargo064('529abc982def247ghi25')).toBe(true); // 3 letras
    expect(temCpfLargo064('529abcde982def247ghi25')).toBe(false); // 5 letras
  });

  it('a regra larga da 064 também aceita 5+ separadores (4ª checagem)', () => {
    const comSetePontos = '529.......982.......247.......25';
    expect(temCpf(comSetePontos)).toBe(false); // vão > 6 na regra da 065
    expect(contemCpf(comSetePontos)).toBe(false);
    expect(temCpfLargo064(comSetePontos)).toBe(true); // {5,} separadores na 064
  });
});

describe('CPF partido entre trechos (bissecção)', () => {
  function fato(trecho, campo = 'saldo_disponivel') {
    return {
      alvo_tabela: 'balancetes',
      alvo_id: '00000000-0000-0000-0000-000000000001',
      campo,
      valor: 1,
      pagina: 1,
      trecho,
      bbox: null,
    };
  }

  it('remove o fato que fecha o CPF na concatenação e deixa o resto', () => {
    const fatos = [
      fato('linha termina em 529.982.247', 'saldo_disponivel'),
      fato('25 comeca aqui', 'total_debitos'),
      fato('linha limpa 10,00', 'total_creditos'),
    ];
    const resultado = removerFatosComCpf({
      camRel: 'projeto/arquivo.pdf',
      titulo: 'Balancete',
      arquivoNome: 'arquivo.pdf',
      fatos,
    });

    expect(resultado.removidos).toHaveLength(1);
    expect(resultado.fatos).toHaveLength(2);
    expect(resultado.fatos.some((f) => f.trecho.includes('25 comeca'))).toBe(false);
    expect(temCpf(resultado.fatos.map((f) => f.trecho).join(' '))).toBe(false);
  });

  it('não mexe numa lista limpa', () => {
    const fatos = [fato('linha limpa 1.000,00'), fato('outra linha 2.000,00', 'total_debitos')];
    const resultado = removerFatosComCpf({
      camRel: 'projeto/arquivo.pdf',
      titulo: 'Balancete',
      arquivoNome: 'arquivo.pdf',
      fatos,
    });
    expect(resultado.removidos).toEqual([]);
    expect(resultado.fatos).toHaveLength(2);
  });
});
