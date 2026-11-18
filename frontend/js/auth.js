/* ============================================================
   Auth — Login, Logout, Session Management
   ============================================================
   O login é o e-mail cadastrado no Supabase Auth. Não há atalho
   por nome curto — ver toEmail().

   Multi-tenancy: após o login, carrega o perfil do usuário em
   `app_users` (papel: admin/professor) e os centros de custo
   permitidos em `user_projects`. O papel precisa estar pronto
   ANTES de App.init() (que esconde links admin e registra o
   guard de rota). A segurança real fica no banco (RLS + guards
   nas RPCs); o papel no frontend só controla a UI.
   ============================================================ */

/* exported Auth -- global de script clássico: consumido por app.js e pelas páginas que checam papel. */
const Auth = (() => {
  const loginScreen = document.getElementById('login-screen');
  const appScreen   = document.getElementById('app');
  const loginForm   = document.getElementById('login-form');
  const loginInput  = document.getElementById('login-email');
  const loginPass   = document.getElementById('login-password');
  const loginBtn    = document.getElementById('login-btn');
  const loginError  = document.getElementById('login-error');
  const loginErrorText = document.getElementById('login-error-text');
  const logoutBtn   = document.getElementById('logout-btn');
  const togglePass  = document.getElementById('toggle-password');
  const userEmailEl = document.getElementById('user-email');
  const userAvatarEl= document.getElementById('user-avatar');
  const esqueciBtn  = document.getElementById('esqueci-senha');
  const loginAviso  = document.getElementById('login-aviso');
  const senhaForm   = document.getElementById('senha-form');
  const senhaNova   = document.getElementById('senha-nova');
  const senhaConfirma = document.getElementById('senha-confirma');
  const senhaBtn    = document.getElementById('senha-btn');
  const senhaErro   = document.getElementById('senha-erro');
  const senhaErroText = document.getElementById('senha-erro-text');

  let currentUser = null;
  let userRole = null;           // 'admin' | 'professor'
  let allowedProjectIds = [];    // centros de custo permitidos (vazio p/ admin)

  /**
   * Normaliza o que foi digitado no campo de login.
   *
   * O login é sempre o e-mail cadastrado no Supabase Auth. Não existe
   * atalho por nome curto: mapear apelido → e-mail exigiria embutir os
   * e-mails reais neste arquivo, que vai inteiro para o bundle público
   * do GitHub Pages. Isso entregaria a um atacante os nomes exatos das
   * contas para tentativa de senha.
   */
  function toEmail(input) {
    return (input || '').trim().toLowerCase();
  }

  /**
   * Extract display name from email.
   * "fulano.silva@exemplo.br" -> "Fulano Silva"
   */
  function displayName(email) {
    if (!email) return '';
    const local = email.split('@')[0];
    // Capitalize first letter of each word
    return local.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // Toggle password visibility
  togglePass?.addEventListener('click', () => {
    const isPassword = loginPass.type === 'password';
    loginPass.type = isPassword ? 'text' : 'password';
    const icon = togglePass.querySelector('.input-group__toggle-icon');
    icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
    lucide.createIcons({ nodes: [togglePass] });
  });

  // Show error
  function showError(msg) {
    loginError.hidden = false;
    loginErrorText.textContent = msg;
  }

  function hideError() {
    loginError.hidden = true;
  }

  // Carrega o perfil (papel + centros de custo) do usuário autenticado.
  // RLS permite ler a própria linha de app_users e user_projects.
  // Fallback: sem linha (ou tabela ausente pré-migração) → admin por email
  // conhecido, senão professor sem projetos.
  async function loadProfile(user) {
    userRole = 'professor';
    allowedProjectIds = [];
    if (!user?.id) return;

    // Fail-closed: sem linha em app_users (ou erro de leitura), o usuário
    // cai como professor. A UI esconde o que é admin; o RLS no banco é a
    // barreira real, então um degrade aqui nunca abre acesso.
    const fallbackRole = 'professor';

    try {
      const [profileRes, projRes] = await Promise.all([
        supabaseClient
          .from('app_users')
          .select('role, display_name, email')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabaseClient
          .from('user_projects')
          .select('project_id')
          .eq('user_id', user.id),
      ]);

      if (profileRes.data) {
        userRole = profileRes.data.role || fallbackRole;
        if (profileRes.data.display_name) {
          user._displayName = profileRes.data.display_name;
        }
      } else {
        userRole = fallbackRole;
      }

      if (projRes.data) {
        allowedProjectIds = projRes.data.map(r => r.project_id);
      }
    } catch (e) {
      console.error('Erro ao carregar perfil (app_users/user_projects):', e);
      userRole = fallbackRole;
    }
  }

  // Switch screens
  async function showApp(user) {
    currentUser = user;
    await loadProfile(user);   // papel pronto antes de App.init()
    loginScreen.hidden = true;
    appScreen.hidden = false;

    // Update user info in sidebar
    const email = user.email || '';
    const name = user._displayName || displayName(email);
    userEmailEl.textContent = name || email;
    userAvatarEl.textContent = (name || email).charAt(0).toUpperCase();

    // Initialize the app
    if (typeof App !== 'undefined' && App.init) {
      await App.init({ novaSessao: true });
    }
  }

  function showLogin() {
    currentUser = null;
    userRole = null;
    allowedProjectIds = [];
    loginScreen.hidden = false;
    appScreen.hidden = true;
    if (loginForm) loginForm.hidden = false;
    if (senhaForm) senhaForm.hidden = true;
    loginPass.value = '';
    hideError();
  }

  // ── Esqueci a senha ─────────────────────────────────────────
  // O e-mail leva de volta a este mesmo endereço (precisa estar em
  // Authentication → URL Configuration → Redirect URLs no Supabase).
  // A resposta é a mesma exista ou não a conta: não revela quem tem login.
  function showAviso(msg) {
    loginAviso.hidden = false;
    loginAviso.textContent = msg;
  }

  esqueciBtn?.addEventListener('click', async () => {
    hideError();
    loginAviso.hidden = true;
    const email = toEmail(loginInput.value);
    if (!email || !email.includes('@')) {
      showError('Digite seu e-mail no campo acima e clique de novo em "Esqueci a senha".');
      loginInput.focus();
      return;
    }
    esqueciBtn.disabled = true;
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
      });
      if (error) {
        const limite = /rate limit|security purposes|only request this/i.test(error.message);
        showError(limite
          ? 'Muitos pedidos seguidos. Espere alguns minutos e tente de novo.'
          : `Não foi possível enviar o link: ${error.message}`);
        return;
      }
      showAviso(`Se ${email} tiver acesso, chega em instantes um e-mail com o link para criar uma senha nova. `
        + 'O link vale por 1 hora; abra-o neste mesmo computador.');
    } catch (err) {
      showError(`Erro interno: ${err.message || err}`);
    } finally {
      esqueciBtn.disabled = false;
    }
  });

  // ── Nova senha (chegou pelo link do e-mail) ─────────────────
  let sessaoRecuperacao = null;

  function showNovaSenha(user) {
    sessaoRecuperacao = user;
    loginScreen.hidden = false;
    appScreen.hidden = true;
    loginForm.hidden = true;
    senhaForm.hidden = false;
    senhaErro.hidden = true;
    senhaNova.value = '';
    senhaConfirma.value = '';
    senhaNova.focus();
  }

  function erroSenha(msg) {
    senhaErro.hidden = false;
    senhaErroText.textContent = msg;
  }

  senhaForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    senhaErro.hidden = true;
    const nova = senhaNova.value;
    if (nova.length < 8) { erroSenha('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (nova !== senhaConfirma.value) { erroSenha('As duas senhas não são iguais.'); return; }

    const btnText = senhaBtn.querySelector('.btn__text');
    const btnLoader = senhaBtn.querySelector('.btn__loader');
    btnText.hidden = true; btnLoader.hidden = false; senhaBtn.disabled = true;
    try {
      const { data, error } = await supabaseClient.auth.updateUser({ password: nova });
      if (error) {
        const msgs = {
          'New password should be different from the old password.': 'A nova senha precisa ser diferente da anterior.',
          'Auth session missing!': 'O link expirou. Volte ao login e peça outro em "Esqueci a senha".',
        };
        erroSenha(msgs[error.message]
          || (/weak|at least/i.test(error.message) ? 'Senha fraca: use uma senha mais longa ou com letras e números.' : `Erro: ${error.message}`));
        return;
      }
      senhaNova.value = ''; senhaConfirma.value = '';
      window.cfLinkSenha = null;
      if (typeof showToast === 'function') showToast('Senha alterada.', 'success');
      await showApp(data.user || sessaoRecuperacao);
    } catch (err) {
      erroSenha(`Erro interno: ${err.message || err}`);
    } finally {
      btnText.hidden = false; btnLoader.hidden = true; senhaBtn.disabled = false;
    }
  });

  // Login handler
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const rawInput = loginInput.value.trim();
    const password = loginPass.value;

    if (!rawInput || !password) {
      showError('Preencha todos os campos.');
      return;
    }

    const email = toEmail(rawInput);

    // Show loading
    const btnText = loginBtn.querySelector('.btn__text');
    const btnLoader = loginBtn.querySelector('.btn__loader');
    btnText.hidden = true;
    btnLoader.hidden = false;
    loginBtn.disabled = true;

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        const errorMessages = {
          'Invalid login credentials': 'Usuário ou senha incorretos.',
          'Email not confirmed': 'Conta ainda não confirmada.',
        };
        showError(errorMessages[error.message] || `Erro: ${error.message}`);
        return;
      }

      // Mudança de endereço (22/10/2026): o login antigo ficava num endereço
      // compartilhado com outros sites. No primeiro login neste navegador,
      // encerra as outras sessões do usuário para que um token antigo copiado
      // de lá deixe de valer. Uma vez só por navegador.
      try {
        if (!localStorage.getItem('cf_sessoes_antigas_encerradas')) {
          const { error: outrasErr } = await supabaseClient.auth.signOut({ scope: 'others' });
          if (!outrasErr) localStorage.setItem('cf_sessoes_antigas_encerradas', new Date().toISOString());
        }
      } catch (e) {
        console.warn('Não foi possível encerrar as sessões antigas:', e);
      }

      await showApp(data.user);
    } catch (err) {
      console.error("ERRO DE LOGIN COMPLETO:", err);
      showError(`Erro interno: ${err.message || err.toString()}`);
    } finally {
      btnText.hidden = false;
      btnLoader.hidden = true;
      loginBtn.disabled = false;
    }
  });

  // Logout handler
  logoutBtn?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    showLogin();
  });

  // Check existing session on load
  async function checkSession() {
    try {
      const { data, error } = await supabaseClient.auth.getSession();

      if (error) {
        console.error("Session check error:", error);
        showLogin();
        return;
      }

      const link = window.cfLinkSenha;
      if (link?.tipo === 'recuperacao' && data?.session?.user) {
        showNovaSenha(data.session.user);
      } else if (data?.session?.user) {
        await showApp(data.session.user);
      } else {
        showLogin();
        if (link) {
          showError(link.codigo === 'otp_expired' || link.tipo === 'recuperacao'
            ? 'O link de senha expirou ou já foi usado. Peça outro em "Esqueci a senha".'
            : 'O link de senha não funcionou. Peça outro em "Esqueci a senha".');
        }
      }
    } catch (err) {
      console.error("Critical error checking session:", err);
      showLogin();
    }
  }

  // Listen for auth state changes
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      showLogin();
    } else if (event === 'PASSWORD_RECOVERY' && session?.user && senhaForm?.hidden) {
      // Caso o cliente termine de ler o link depois do checkSession.
      showNovaSenha(session.user);
    }
  });

  return {
    checkSession,
    getUser: () => currentUser,
    isAdmin: () => userRole === 'admin',
    getRole: () => userRole,
    getAllowedProjectIds: () => allowedProjectIds.slice(),
  };
})();