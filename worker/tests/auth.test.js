import { describe, it, expect } from 'vitest';
import {
  autenticar,
  extrairJwt,
  papeisPermitidos,
} from '../src/auth.js';

const SUPABASE = 'https://proj.supabase.co';
const ANON = 'chave-publica';
const JWT = 'jwt-da-pessoa';

function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchFalso({
  usuario = { id: 'u1', email: 'admin@lapig' },
  statusUsuario = 200,
  papel = 'admin',
  statusPapel = 200,
  linhasPapel,
} = {}) {
  const chamadas = [];
  const fn = async (url, init = {}) => {
    chamadas.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      if (statusUsuario !== 200) return new Response('', { status: statusUsuario });
      return json(usuario);
    }
    if (url.includes('/rest/v1/app_users')) {
      if (statusPapel !== 200) return new Response('', { status: statusPapel });
      const corpo = linhasPapel !== undefined
        ? linhasPapel
        : papel == null
          ? []
          : [{ role: papel }];
      return json(corpo);
    }
    throw new Error(`URL inesperada: ${url}`);
  };
  fn.chamadas = chamadas;
  return fn;
}

function pedir(fetchImpl, extra = {}) {
  return autenticar({
    jwt: JWT,
    supabaseUrl: SUPABASE,
    anonKey: ANON,
    fetchImpl,
    ...extra,
  });
}

describe('extrairJwt', () => {
  it('aceita Bearer com qualquer caixa e espaço sobrando', () => {
    expect(extrairJwt('Bearer abc.def')).toBe('abc.def');
    expect(extrairJwt('  bearer   abc.def  ')).toBe('abc.def');
  });

  it('recusa esquema errado e cabeçalho ausente', () => {
    expect(extrairJwt(null)).toBeNull();
    expect(extrairJwt('')).toBeNull();
    expect(extrairJwt('Token abc')).toBeNull();
    expect(extrairJwt('Bearer   ')).toBeNull();
  });
});

describe('papeisPermitidos', () => {
  it('sem variável, só admin', () => {
    expect(papeisPermitidos(undefined)).toEqual(['admin']);
    expect(papeisPermitidos('')).toEqual(['admin']);
    expect(papeisPermitidos('  ,  ')).toEqual(['admin']);
  });

  it('lê lista separada por vírgula', () => {
    expect(papeisPermitidos('admin, professor')).toEqual(['admin', 'professor']);
  });
});

describe('autenticação', () => {
  it('sem JWT é sem_login, sem chamar o Supabase', async () => {
    const fetchImpl = fetchFalso();
    const r = await autenticar({ jwt: null, supabaseUrl: SUPABASE, anonKey: ANON, fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('sem_login');
    expect(fetchImpl.chamadas).toHaveLength(0);
  });

  it('JWT inválido (401) é sem_login', async () => {
    const r = await pedir(fetchFalso({ statusUsuario: 401 }));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('sem_login');
  });

  it('JWT vencido (403) é sem_login', async () => {
    const r = await pedir(fetchFalso({ statusUsuario: 403 }));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('sem_login');
  });

  it('admin é aceito e o id vem do /auth/v1/user', async () => {
    const fetchImpl = fetchFalso({ usuario: { id: 'u-admin', email: 'a@b' }, papel: 'admin' });
    const r = await pedir(fetchImpl);

    expect(r).toMatchObject({
      ok: true,
      usuario: { id: 'u-admin', email: 'a@b' },
      papel: 'admin',
    });
    expect(fetchImpl.chamadas).toHaveLength(2);
    // O JWT da pessoa vai nos dois pedidos, e a chave pública vai no apikey.
    for (const c of fetchImpl.chamadas) {
      expect(c.init.headers.Authorization).toBe(`Bearer ${JWT}`);
      expect(c.init.headers.apikey).toBe(ANON);
    }
    expect(fetchImpl.chamadas[1].url).toContain('user_id=eq.u-admin');
  });

  it('professor é recusado', async () => {
    const r = await pedir(fetchFalso({ papel: 'professor' }));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('sem_permissao');
    expect(r.papel).toBe('professor');
  });

  it('outro papel aceito por ANALISE_PAPEIS passa', async () => {
    const r = await pedir(fetchFalso({ papel: 'professor' }), {
      papeis: papeisPermitidos('admin,professor'),
    });
    expect(r.ok).toBe(true);
    expect(r.papel).toBe('professor');
  });

  it('sem linha em app_users é sem_permissao', async () => {
    const r = await pedir(fetchFalso({ linhasPapel: [] }));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('sem_permissao');
  });

  it('erro do Supabase é interno, não sem_login', async () => {
    const r = await pedir(fetchFalso({ statusUsuario: 500 }));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('interno');
  });

  it('rede fora é interno, não sem_login', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed');
    };
    const r = await pedir(fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('interno');
  });
});
