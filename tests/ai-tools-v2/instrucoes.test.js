import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { INSTRUCOES, especificacoes } from '../../shared/ai-tools/index.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const fonteMcp = readFileSync(resolve(aqui, '..', '..', 'mcp', 'src', 'index.js'), 'utf8');

/** O bloco das quatro regras, idêntico no MCP e no pacote da Análise. */
function quatroRegras(texto) {
  const inicio = texto.indexOf('Quatro regras valem para todas as tools:');
  const fim = texto.indexOf('alfabética e não significa prioridade.');
  if (inicio === -1 || fim === -1) return null;
  return texto
    .slice(inicio, fim + 'alfabética e não significa prioridade.'.length)
    .replace(/\s+/g, ' ')
    .trim();
}

describe('INSTRUCOES', () => {
  it('repete as quatro regras do MCP palavra por palavra', () => {
    const doMcp = quatroRegras(fonteMcp);
    const daAnalise = quatroRegras(INSTRUCOES);
    expect(doMcp).not.toBeNull();
    expect(daAnalise).not.toBeNull();
    expect(daAnalise).toBe(doMcp);
  });

  it('acrescenta as regras da Análise', () => {
    expect(INSTRUCOES).toContain('Toda resposta é feita de blocos');
    expect(INSTRUCOES).toContain('máximo 3 frases');
    expect(INSTRUCOES).toContain('Sem dado, diga que não há.');
    expect(INSTRUCOES).toContain('Número só por "criar_bloco" ou "calcular"');
    expect(INSTRUCOES).toContain('⟦P1⟧');
  });

  it('proíbe especular quando o dado não vem de nenhuma ferramenta', () => {
    const texto = INSTRUCOES.replace(/\s+/g, ' ');
    expect(texto).toContain('não está disponível');
    expect(texto).toContain('Diga o porquê só quando a ferramenta informar o motivo');
    expect(texto).toContain('sem supor onde estaria nem por quê');
    expect(texto).not.toContain('diga que não há e por quê');
  });
});

describe('especificacoes', () => {
  const specs = especificacoes();

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
});
