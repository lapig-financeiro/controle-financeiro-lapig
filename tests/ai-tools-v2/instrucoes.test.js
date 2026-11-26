import { describe, it, expect } from 'vitest';

import { INSTRUCOES, especificacoes } from '../../shared/ai-tools/index.js';

const TEXTO = INSTRUCOES.replace(/\s+/g, ' ');

describe('INSTRUCOES', () => {
  it('não cita ferramenta nem campo que a Análise não tem', () => {
    for (const proibido of [
      'panorama',
      'simular_alocacao',
      'compromissos_cobertura',
      'situacao_dado',
      'caixa.cobertura',
      'risco_devolucao.base',
      'truncado',
    ]) {
      expect(TEXTO).not.toContain(proibido);
    }
  });

  it('mantém as quatro regras adaptadas às ferramentas reais', () => {
    expect(TEXTO).toContain('1. Não calcule');
    expect(TEXTO).toContain('"calcular"');
    expect(TEXTO).toContain('2. Não recomende — apresente');
    expect(TEXTO).toContain('"listar_centros"');
    expect(TEXTO).toContain('"explicar_livre"');
    expect(TEXTO).toContain('"situacao_centro"');
    expect(TEXTO).toContain('"desembolsos"');
    expect(TEXTO).toContain('"termos_contrato"');
    expect(TEXTO).toContain('"pendencias"');
    expect(TEXTO).toContain('"bolsas"');
    expect(TEXTO).toContain('3. Diga o que o número cobre');
    expect(TEXTO).toContain('data do balancete');
    expect(TEXTO).toContain('centro sem plano ou sem balancete');
    expect(TEXTO).toContain('vigência do cadastro contra a do contrato');
    expect(TEXTO).toContain('folha atrasada');
    expect(TEXTO).toContain('rendimento líquido');
    expect(TEXTO).toContain('já está incluído no saldo disponível');
    expect(TEXTO).toContain('4. "listar_centros" descreve os centros');
    expect(TEXTO).toContain('não ranqueia mérito');
  });

  it('proíbe id de nó no texto e número sem nó citado', () => {
    expect(TEXTO).toContain('Não escreva id de nó ("r2.7", "c1", "{{r2.7}}")');
    expect(TEXTO).toContain('nem em bloco de texto');
    expect(TEXTO).toContain('Número no texto só se for valor de nó já citado');
    expect(TEXTO).toContain('até 3 frases corridas');
    expect(TEXTO).toContain('sem repetir tabela markdown');
  });

  it('explica o rótulo de linha da tabela', () => {
    expect(TEXTO).toContain('a primeira coluna pode ser um rótulo de linha em texto literal');
    expect(TEXTO).toContain('as demais colunas citam só ids de nós');
    expect(TEXTO).toContain('Texto literal nas colunas 2 em diante é recusado');
  });

  it('mantém as regras de bloco, dado ausente e nome mascarado', () => {
    expect(TEXTO).toContain('Toda resposta é feita de blocos');
    expect(TEXTO).toContain('Número só por "criar_bloco" ou "calcular"');
    expect(TEXTO).toContain('Sem dado, diga que não há.');
    expect(TEXTO).toContain('⟦P1⟧');
  });

  it('não manda especular quando o dado não vem de nenhuma ferramenta', () => {
    expect(TEXTO).toContain('não está disponível');
    expect(TEXTO).toContain('Diga o porquê só quando a ferramenta informar o motivo');
    expect(TEXTO).toContain('sem supor onde estaria nem por quê');
    expect(TEXTO).not.toContain('diga que não há e por quê');
  });
});

describe('especificacoes', () => {
  const specs = especificacoes();

  function descricao(nome) {
    return specs.find((spec) => spec.function.name === nome).function.description;
  }

  it('tem uma função por ferramenta do contrato §4', () => {
    expect(specs).toHaveLength(9);
    expect(specs.map((spec) => spec.function.name).sort()).toEqual([
      'bolsas',
      'calcular',
      'criar_bloco',
      'desembolsos',
      'explicar_livre',
      'listar_centros',
      'pendencias',
      'situacao_centro',
      'termos_contrato',
    ]);
  });

  it('está no formato do /api/chat do Ollama', () => {
    for (const spec of specs) {
      expect(spec.type).toBe('function');
      expect(typeof spec.function.name).toBe('string');
      expect(typeof spec.function.description).toBe('string');
      expect(spec.function.description.length).toBeGreaterThan(20);
      expect(spec.function.parameters.type).toBe('object');
      expect(typeof spec.function.parameters.properties).toBe('object');
    }
  });

  it('descreve todo parâmetro e só exige o que existe', () => {
    for (const spec of specs) {
      const { properties, required } = spec.function.parameters;
      for (const [nome, definicao] of Object.entries(properties)) {
        expect(definicao.description, `${spec.function.name}.${nome}`).toBeTruthy();
        expect(definicao.type, `${spec.function.name}.${nome}`).toBeTruthy();
      }
      for (const exigido of required) {
        expect(Object.keys(properties), spec.function.name).toContain(exigido);
      }
    }
  });

  it('desembolsos: a ressalva de somar é do rendimento líquido, nunca do bruto', () => {
    const texto = descricao('desembolsos');
    expect(texto).toContain('Rendimento líquido');
    expect(texto).toContain('já incluído no saldo disponível; não somar');
    expect(texto).not.toMatch(/rendimento bruto[^.]*já está incluído/i);
    expect(texto).not.toMatch(/rendimento bruto não está incluído/i);
  });

  it('criar_bloco: primeira coluna aceita rótulo literal; as demais, só id de nó', () => {
    const spec = specs.find((item) => item.function.name === 'criar_bloco');
    expect(spec.function.description).toContain('rótulo de linha em texto literal');
    expect(spec.function.parameters.properties.linhas.description).toContain('rótulo de linha');
    expect(spec.function.parameters.properties.linhas.description).toContain('nas demais, só ids de nós');
  });
});
