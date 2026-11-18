import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AvisoFalha, BarraTopo, Esqueleto, Manutencao } from './componentes/index.js';
import { EmConstrucao } from './paginas/EmConstrucao.jsx';
import { Componentes } from './paginas/Componentes.jsx';
import { Login } from './paginas/Login.jsx';
import { navegarPara, parsearRota } from './roteador.js';
import { consultarManutencao } from './servicos/manutencao.js';
import { carregarPerfil, sair, supabase } from './servicos/supabase.js';

const PENDENCIAS_EXEMPLO = [
  { id: '1', titulo: 'Conta 7.1.3.99 sem rubrica', centro: 'Global Methane Hub · 30.113', tempo: 'há 2 h' },
  { id: '2', titulo: 'Aditivo sem data de evento', centro: 'Remap · 30.105', tempo: 'ontem' },
  { id: '3', titulo: 'Planilha encerraria 4 bolsas', centro: 'Kalungas · 30.XXX', tempo: 'há 3 dias' },
];

export function App() {
  const [rota, setRota] = useState(() => parsearRota());
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [carregandoPerfil, setCarregandoPerfil] = useState(false);
  const [usuario, setUsuario] = useState(null);
  const [perfil, setPerfil] = useState({ erro: null, role: null, nome: '', email: '' });
  const [erroLogin, setErroLogin] = useState('');
  const [manutencao, setManutencao] = useState({ ativo: false, mensagem: '' });
  const manutencaoAtivaRef = useRef(false);
  const [filtroDemoAtivo, setFiltroDemoAtivo] = useState(false);

  const verificarManutencao = useCallback(async () => {
    const estado = await consultarManutencao();
    if (!estado.ativo && manutencaoAtivaRef.current) {
      window.location.reload();
      return;
    }
    manutencaoAtivaRef.current = estado.ativo;
    setManutencao(estado);
  }, []);

  const aplicarUsuario = useCallback(async (user) => {
    if (!user) {
      setUsuario(null);
      setPerfil({ erro: null, role: null, nome: '', email: '' });
      setCarregandoPerfil(false);
      return;
    }
    setUsuario(user);
    setCarregandoPerfil(true);
    const dadosPerfil = await carregarPerfil(user);
    setPerfil(dadosPerfil);
    setCarregandoPerfil(false);
  }, []);

  useEffect(() => {
    verificarManutencao();
    const intervalo = setInterval(verificarManutencao, 60000);
    const aoMudarHash = () => {
      setRota(parsearRota());
      verificarManutencao();
    };
    window.addEventListener('hashchange', aoMudarHash);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener('hashchange', aoMudarHash);
    };
  }, [verificarManutencao]);

  useEffect(() => {
    let ativo = true;

    async function verificarSessao() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!ativo) return;

        if (error) {
          setErroLogin('Não foi possível conferir a sessão.');
          await aplicarUsuario(null);
          return;
        }

        if (data?.session?.user) {
          await aplicarUsuario(data.session.user);
        } else {
          await aplicarUsuario(null);
        }
      } finally {
        if (ativo) setCarregandoSessao(false);
      }
    }

    verificarSessao();

    // Não fazer consulta ao Supabase dentro do callback de onAuthStateChange.
    const { data: inscricao } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (!ativo) return;
      if (evento === 'SIGNED_OUT') {
        setTimeout(() => {
          if (ativo) aplicarUsuario(null);
        }, 0);
      } else if (evento === 'SIGNED_IN' && sessao?.user) {
        setTimeout(() => {
          if (ativo) aplicarUsuario(sessao.user);
        }, 0);
      }
    });

    return () => {
      ativo = false;
      inscricao?.subscription?.unsubscribe();
    };
  }, [aplicarUsuario]);

  const papelConhecido = !carregandoSessao && !carregandoPerfil && perfil.erro === null && perfil.role !== null;
  const isAdmin = papelConhecido && perfil.role === 'admin';

  useEffect(() => {
    if (!papelConhecido || !usuario) return;
    if (rota.pagina === 'admin' && !isAdmin) {
      navegarPara('#/projetos');
    }
    if (rota.pagina === 'componentes' && !import.meta.env.DEV && !isAdmin) {
      navegarPara('#/projetos');
    }
  }, [papelConhecido, usuario, rota.pagina, isAdmin]);

  if (manutencao.ativo) {
    return <Manutencao mensagem={manutencao.mensagem} />;
  }

  // Catálogo `#/componentes`: livre em dev; em produção só para admin logado.
  const podeVerComponentes = rota.pagina === 'componentes' && (import.meta.env.DEV || (usuario && isAdmin));
  if (podeVerComponentes) {
    const usuarioCatalogo = usuario
      ? { nome: perfil.nome, email: perfil.email }
      : { nome: 'Victor Amaral', email: 'catalogo@lapig.ufg.br', iniciais: 'VA' };
    const adminCatalogo = usuario ? isAdmin : true;

    return (
      <div class="casca">
        <BarraTopo
          rotaAtiva="projetos"
          isAdmin={adminCatalogo}
          usuario={usuarioCatalogo}
          centrosVisiveis={filtroDemoAtivo ? { visiveis: 15, total: 17 } : { visiveis: 17, total: 17 }}
          pendencias={PENDENCIAS_EXEMPLO}
          onAlternarFiltro={(ativar) => setFiltroDemoAtivo(Boolean(ativar))}
          onSair={usuario ? sair : () => navegarPara('#/projetos')}
          onNavegar={navegarPara}
        />
        <main>
          <Componentes centrosOcultos={filtroDemoAtivo ? 2 : 0} isAdmin={adminCatalogo} />
        </main>
      </div>
    );
  }

  if (carregandoSessao) {
    return (
      <div class="casca">
        <div class="conteudo">
          <Esqueleto variante="cartao" linhas={3} />
        </div>
      </div>
    );
  }

  if (!usuario) {
    return (
      <Login
        erroInicial={erroLogin}
        onEntrar={async (user) => {
          setErroLogin('');
          await aplicarUsuario(user);
          if (!window.location.hash || !window.location.hash.startsWith('#/')) {
            navegarPara('#/projetos');
          }
        }}
      />
    );
  }

  const renderizarPagina = () => {
    if (perfil.erro) {
      return (
        <div class="conteudo">
          <AvisoFalha
            grave
            mensagem={perfil.erro}
            aoTentarNovamente={() => aplicarUsuario(usuario)}
          />
        </div>
      );
    }

    if (rota.pagina === 'admin') {
      if (!papelConhecido || !isAdmin) return null;
      return <EmConstrucao titulo="Admin" contexto="Acessos por centro de custo e saúde da leitura" />;
    }

    if (rota.pagina === 'componentes' && !import.meta.env.DEV) {
      return null;
    }

    if (rota.pagina === 'projeto') {
      return (
        <EmConstrucao
          voltar={{ rotulo: 'Projetos', href: '#/projetos' }}
          titulo={`Projeto ${rota.id}`}
          contexto="Visão detalhada do centro de custo"
        />
      );
    }

    if (rota.pagina === 'analise') {
      return <EmConstrucao titulo="Análise" contexto="Área de trabalho com blocos e origem" />;
    }

    return <EmConstrucao titulo="Projetos" contexto="Centros de custo ativos" />;
  };

  return (
    <div class="casca">
      <BarraTopo
        rotaAtiva={rota.menu}
        isAdmin={isAdmin}
        usuario={{ nome: perfil.nome, email: perfil.email }}
        onSair={sair}
        onNavegar={navegarPara}
      />
      <main>{renderizarPagina()}</main>
    </div>
  );
}
