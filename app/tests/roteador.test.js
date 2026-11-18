import { describe, expect, it } from 'vitest';
import { parsearRota, urlProjeto } from '../src/roteador.js';

describe('roteador', () => {
  it('interpreta as rotas principais e sub-rotas de projeto', () => {
    expect(parsearRota('')).toEqual({ pagina: 'projetos', menu: 'projetos', id: null, aba: null });
    expect(parsearRota('#/projetos')).toEqual({ pagina: 'projetos', menu: 'projetos', id: null, aba: null });
    expect(parsearRota('#/projeto/30.113')).toEqual({
      pagina: 'projeto',
      menu: 'projetos',
      id: '30.113',
      aba: null,
    });
    expect(parsearRota('#/projeto/abc-123/pendencias')).toEqual({
      pagina: 'projeto',
      menu: 'projetos',
      id: 'abc-123',
      aba: 'pendencias',
    });
    expect(parsearRota('#/projeto/abc-123/documentos')).toEqual({
      pagina: 'projeto',
      menu: 'projetos',
      id: 'abc-123',
      aba: 'documentos',
    });
    expect(parsearRota('#/projeto/abc-123/invalida')).toEqual({
      pagina: 'projeto',
      menu: 'projetos',
      id: 'abc-123',
      aba: null,
    });
    expect(parsearRota('#/projetos/a%20b')).toEqual({
      pagina: 'projeto',
      menu: 'projetos',
      id: 'a b',
      aba: null,
    });
    expect(parsearRota('#/analise')).toEqual({ pagina: 'analise', menu: 'analise', id: null, aba: null });
    expect(parsearRota('#/admin')).toEqual({ pagina: 'admin', menu: 'admin', id: null, aba: null });
    expect(parsearRota('#/componentes')).toEqual({
      pagina: 'componentes',
      menu: 'componentes',
      id: null,
      aba: null,
    });
  });

  it('gera URLs válidas para projeto e aba opcional', () => {
    expect(urlProjeto('30.113')).toBe('#/projeto/30.113');
    expect(urlProjeto('abc-1', 'pendencias')).toBe('#/projeto/abc-1/pendencias');
    expect(urlProjeto('abc-1', 'outra')).toBe('#/projeto/abc-1');
    expect(urlProjeto('')).toBe('#/projetos');
  });

  it('não lança erro com sequência % malformada no hash', () => {
    expect(() => parsearRota('#/projeto/%E0%A4%A')).not.toThrow();
    expect(parsearRota('#/projeto/%E0%A4%A')).toEqual({
      pagina: 'projeto',
      menu: 'projetos',
      id: '%E0%A4%A',
      aba: null,
    });
  });
});
