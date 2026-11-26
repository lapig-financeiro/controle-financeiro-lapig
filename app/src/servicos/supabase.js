import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://skxiivmkhpegefafdlty.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_cWm8BfwIb2JQ-WIOOjkQfA_jvTt7OmG';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Carrega papel e nome de `app_users` (colunas `role`, `display_name`, `email`).
 * Se a consulta falhar, devolve `erro` sem rebaixar o usuário para `professor` em silêncio.
 */
export async function carregarPerfil(usuario) {
  if (!usuario?.id) {
    return { erro: null, role: null, nome: '', email: '' };
  }

  const emailPadrao = usuario.email || '';
  const nomeMeta = usuario.user_metadata?.display_name || '';

  try {
    const consultar = (colunas) => supabase.from('app_users').select(colunas).eq('user_id', usuario.id).maybeSingle();
    const colunas = 'role, display_name, email';
    let { data, error } = await consultar(`${colunas}, pode_bolsistas`);
    // Antes de a migração entrar no ar, os outros acessos continuam disponíveis.
    if (error?.code === '42703' || error?.code === 'PGRST204') {
      ({ data, error } = await consultar(colunas));
    }

    if (error) {
      return {
        erro: 'Não foi possível conferir seu perfil de acesso. Tente de novo.',
        role: null,
        nome: nomeMeta || emailPadrao,
        email: emailPadrao,
      };
    }

    if (!data) {
      return {
        erro: null,
        role: 'professor',
        nome: nomeMeta || emailPadrao,
        email: emailPadrao,
      };
    }

    return {
      erro: null,
      role: data.role || 'professor',
      nome: data.display_name || nomeMeta || data.email || emailPadrao,
      email: data.email || emailPadrao,
      podeBolsistas: data.pode_bolsistas === true,
    };
  } catch {
    return {
      erro: 'Não foi possível conferir seu perfil de acesso. Tente de novo.',
      role: null,
      nome: nomeMeta || emailPadrao,
      email: emailPadrao,
    };
  }
}

export async function entrarComSenha(emailBruto, senha) {
  const email = String(emailBruto || '').trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) {
    const mensagens = {
      'Invalid login credentials': 'E-mail ou senha incorretos.',
      'Email not confirmed': 'Conta ainda não confirmada.',
    };
    throw new Error(mensagens[error.message] || `Não foi possível entrar: ${error.message}`);
  }
  return data.user;
}

export async function sair() {
  await supabase.auth.signOut();
}
