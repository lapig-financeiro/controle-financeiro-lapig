import { useState } from 'preact/hooks';
import { AvisoFalha, Botao, Campo } from '../componentes/index.js';
import { entrarComSenha } from '../servicos/supabase.js';
import './Login.css';

/**
 * Tela de login conforme `estetica.md` §4:
 * fundo `--cor-fundo`, cartão central `--largura-login`, preenchimento `--esp-6`,
 * logo `--logo`, título "Entrar" (`--fs-4`), campos E-mail e Senha empilhados,
 * erro num AvisoFalha acima do botão e botão primário de largura total. Nada mais.
 */
export function Login({ erroInicial = '', onEntrar }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(erroInicial);

  const lidarLogin = async (e) => {
    e.preventDefault();
    setErro('');

    if (!email.trim() || !senha) {
      setErro('Preencha e-mail e senha.');
      return;
    }

    setCarregando(true);
    try {
      const usuario = await entrarComSenha(email, senha);
      await onEntrar?.(usuario);
    } catch (err) {
      setErro(err.message || 'Não foi possível entrar.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <main class="login-pagina">
      <div class="login-cartao">
        <img
          src={`${import.meta.env.BASE_URL}lapig-logo.svg`}
          alt="LAPIG"
          class="login-logo"
        />
        <h1 class="login-titulo">Entrar</h1>

        <form class="login-form" onSubmit={lidarLogin} noValidate>
          <Campo
            id="login-email"
            rotulo="E-mail"
            tipo="email"
            valor={email}
            aoMudar={setEmail}
            autoComplete="username"
            obrigatorio
          />
          <Campo
            id="login-senha"
            rotulo="Senha"
            tipo="password"
            valor={senha}
            aoMudar={setSenha}
            autoComplete="current-password"
            obrigatorio
          />

          {erro && <AvisoFalha mensagem={erro} grave />}

          <Botao
            variante="primario"
            tipo="submit"
            carregando={carregando}
            className="login-botao"
          >
            Entrar
          </Botao>
        </form>
      </div>
    </main>
  );
}
