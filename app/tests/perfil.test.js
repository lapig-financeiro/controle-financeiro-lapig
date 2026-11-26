import { beforeEach, describe, expect, it, vi } from 'vitest';

const { consultar, selecionar } = vi.hoisted(() => ({
  consultar: vi.fn(),
  selecionar: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: selecionar.mockReturnValue({ eq: () => ({ maybeSingle: consultar }) }),
    }),
  }),
}));

import { carregarPerfil } from '../src/servicos/supabase.js';

const perfil = { role: 'professor', display_name: 'Conta de teste' };
const usuario = { id: 'u1', email: 'conta@example.org' };

beforeEach(() => {
  consultar.mockReset();
  selecionar.mockClear();
});

describe('carregarPerfil', () => {
  it.each(['42703', 'PGRST204'])('carrega o perfil enquanto a coluna ainda está indisponível (%s)', async (code) => {
    consultar.mockResolvedValueOnce({ error: { code } });
    consultar.mockResolvedValueOnce({ data: perfil, error: null });

    expect(await carregarPerfil(usuario)).toMatchObject({ erro: null, role: 'professor', podeBolsistas: false });
    expect(selecionar.mock.calls).toEqual([
      ['role, display_name, email, pode_bolsistas'],
      ['role, display_name, email'],
    ]);
  });

  it('reconhece a permissão explicitamente concedida', async () => {
    consultar.mockResolvedValueOnce({ data: { ...perfil, pode_bolsistas: true }, error: null });
    expect(await carregarPerfil(usuario)).toMatchObject({ erro: null, podeBolsistas: true });
    expect(consultar).toHaveBeenCalledTimes(1);
  });

  it('mostra um erro para falhas que não sejam coluna ausente', async () => {
    consultar.mockResolvedValueOnce({ error: { code: '42501' } });
    expect(await carregarPerfil(usuario)).toMatchObject({ erro: expect.any(String), role: null });
    expect(consultar).toHaveBeenCalledTimes(1);
  });
});
