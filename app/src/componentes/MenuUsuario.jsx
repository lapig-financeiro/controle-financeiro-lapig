import { useId, useRef, useState } from 'preact/hooks';
import { CircleHelp, LogOut } from 'lucide-preact';
import { iniciaisUsuario } from '../util/formato.js';
import { MenuSuspenso, MenuSuspensoItem, MenuSuspensoSeparador } from './MenuSuspenso.jsx';
import './MenuUsuario.css';

/**
 * Menu do usuário no padrão de divulgação: avatar (`--avatar`) abre painel com nome, papel e "Sair".
 */
export function MenuUsuario({ usuario = null, isAdmin = false, onSair = null, onAjuda = null }) {
  const [aberto, setAberto] = useState(false);
  const ancoraRef = useRef(null);
  const gatilhoRef = useRef(null);
  const painelId = useId();

  const nome = usuario?.nome || usuario?.email || 'Usuário';
  const email = usuario?.email || '';
  const iniciais = usuario?.iniciais || iniciaisUsuario(nome);
  const papel = isAdmin ? 'Administrador' : 'Professor';

  return (
    <div class="menu-usuario" ref={ancoraRef}>
      <button
        ref={gatilhoRef}
        type="button"
        class="menu-usuario__avatar"
        aria-label={`Menu do usuário ${nome}`}
        aria-expanded={aberto ? 'true' : 'false'}
        aria-controls={aberto ? painelId : undefined}
        onClick={() => setAberto((v) => !v)}
      >
        {iniciais}
      </button>

      <MenuSuspenso
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        ancoraRef={ancoraRef}
        gatilhoRef={gatilhoRef}
        ariaLabel="Conta do usuário"
      >
        <div id={painelId}>
          <div class="menu-usuario__info">
            <span class="menu-usuario__nome">{nome}</span>
            {email && email !== nome && <span class="menu-usuario__email">{email}</span>}
            <span class="menu-usuario__papel">{papel}</span>
          </div>
          <MenuSuspensoSeparador />
          {onAjuda && (
            <MenuSuspensoItem
              icone={CircleHelp}
              onClick={() => {
                setAberto(false);
                onAjuda();
              }}
            >
              Como usar o site
            </MenuSuspensoItem>
          )}
          <MenuSuspensoItem
            icone={LogOut}
            onClick={() => {
              setAberto(false);
              onSair?.();
            }}
          >
            Sair
          </MenuSuspensoItem>
        </div>
      </MenuSuspenso>
    </div>
  );
}
