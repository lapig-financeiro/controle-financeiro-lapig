import { describe, expect, it } from 'vitest';
import { parsearRota } from '../src/roteador.js';

describe('roteador', () => {
  it('interpreta as rotas principais e sub-rotas de projeto', () => {
    expect(parsearRota('')).toEqual({ pagina: 'projetos', menu: 'projetos', id: null });
    expect(parsearRota('#/projetos')).toEqual({ pagina: 'projetos', menu: 'projetos', id: null });
    expect(parsearRota('#/projetos/30.113')).toEqual({ pagina: 'projeto', menu: 'projetos', id: '30.113' });
    expect(parsearRota('#/projetos/a%20b')).toEqual({ pagina: 'projeto', menu: 'projetos', id: 'a b' });
    expect(parsearRota('#/analise')).toEqual({ pagina: 'analise', menu: 'analise', id: null });
    expect(parsearRota('#/admin')).toEqual({ pagina: 'admin', menu: 'admin', id: null });
    expect(parsearRota('#/componentes')).toEqual({ pagina: 'componentes', menu: 'componentes', id: null });
  });

  it('não lança erro com sequência % malformada no hash', () => {
    expect(() => parsearRota('#/projetos/%E0%A4%A')).not.toThrow();
    expect(parsearRota('#/projetos/%E0%A4%A')).toEqual({
      pagina: 'projeto',
      menu: 'projetos',
      id: '%E0%A4%A',
    });
  });
});
