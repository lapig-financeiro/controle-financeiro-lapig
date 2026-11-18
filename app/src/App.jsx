import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AvisoFalha, BarraTopo, Esqueleto, Manutencao } from './componentes/index.js';
import { Componentes } from './paginas/Componentes.jsx';
import { EmConstrucao } from './paginas/EmConstrucao.jsx';
import { Login } from './paginas/Login.jsx';
import { Projeto } from './paginas/Projeto.jsx';
import { Projetos } from './paginas/Projetos.jsx';
import { navegarPara, parsearRota, urlProjeto } from './roteador.js';
import {
  modoExemploAtivo,
  pendencias as buscarPendencias,
  resumoProjetos,
  salvarFiltroVisao,
} from './servicos/dados.js';
import { consultarManutencao } from './servicos/manutencao.js';
import { carregarPerfil, sair, supabase } from './servicos/supabase.js';

const PENDENCIAS_CATALOGO = [
  { id: '1', titulo: 'Conta 7.1.3.99 sem rubrica', centro: 'Global Methane Hub · 30.113', tempo: 'há 2 h' },
  { id: '2', titulo: 'Aditivo sem data de evento', centro: 'Remap · 30.105', tempo: 'ontem' },
  { id: '3', titulo: 'Planilha encerraria 4 bolsas', centro: 'Kalungas · 30.XXX', tempo: 'há 3 dias' },
];

export function App() {
  const ehModoExemplo = modoExemploAtivo();
  const [rota, setRota] = useState(() => parsearRota());
  const [carregandoSessao, setCarregandoSessao] = useState(!ehModoExemplo);
  const [carregandoPerfil, setCarregandoPerfil] = useState(false);
  const [usuario, setUsuario] = useState(() =>
    ehModoExemplo ? { id: 'exemplo-admin', email: 'exemplo@lapig.ufg.br' } : null
  );
  const [perfil, setPerfil] = useState(() =>
    ehModoExemplo
      ? {
          erro: null,
          role: 'admin',
          nome: 'Admin de exemplo',
          email: 'exemplo@lapig.ufg.br',
        }
      : { erro: null, role: null, nome: '', email: '' }
  );
  const [erroLogin, setErroLogin] = useState('');
  const [manutencao, setManutencao] = useState({ ativo: false, mensagem: '' });
  const manutencaoAtivaRef = useRef(false);
  const [filtroDemoAtivo, setFiltroDemoAtivo] = useState(false);

  const [resumoSt, setResumoSt] = useState({ carregando: true, dados: null, erro: null });
  const [sinoSt, setSinoSt] = useState({ estado: 'consultando', dados: [], erro: null });
  const [filtroSalvando, setFiltroSalvando] = useState(false);
  const [filtroErro, setFiltroErro] = useState(null);

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
    if (ehModoExemplo) return undefined;

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
  }, [ehModoExemplo, aplicarUsuario]);

  const papelConhecido = !carregandoSessao && !carregandoPerfil && perfil.erro === null && perfil.role !== null;
  const isAdmin = papelConhecido && perfil.role === 'admin';

  const carregarResumo = useCallback(async () => {
    setResumoSt((prev) => ({ carregando: true, dados: prev.dados, erro: null }));
    const res = await resumoProjetos();
    setResumoSt({ carregando: false, dados: res.dados, erro: res.erro });
  }, []);

  const carregarSino = useCallback(async () => {
    setSinoSt((prev) => ({ estado: 'consultando', dados: prev.dados, erro: null }));
    const res = await buscarPendencias(null);
    if (res.erro) {
      setSinoSt({ estado: 'indisponivel', dados: [], erro: res.erro });
    } else {
      setSinoSt({ estado: 'pronto', dados: res.dados || [], erro: null });
    }
  }, []);

  const carregarDadosGlobais = useCallback(async () => {
    await Promise.all([carregarResumo(), carregarSino()]);
  }, [carregarResumo, carregarSino]);

  const precisaDadosGlobais = papelConhecido && Boolean(usuario) && rota.pagina !== 'componentes';

  useEffect(() => {
    if (!precisaDadosGlobais) return;
    carregarDadosGlobais();
  }, [precisaDadosGlobais, usuario, carregarDadosGlobais]);

  useEffect(() => {
    if (!papelConhecido || !usuario) return;
    if (rota.pagina === 'admin' && !isAdmin) {
      navegarPara('#/projetos');
    }
    if (rota.pagina === 'componentes' && !import.meta.env.DEV && !isAdmin) {
      navegarPara('#/projetos');
    }
  }, [papelConhecido, usuario, rota.pagina, isAdmin]);

  const salvarFiltro = useCallback(
    async (centrosOcultos) => {
      setFiltroSalvando(true);
      setFiltroErro(null);
      const res = await salvarFiltroVisao(centrosOcultos);
      setFiltroSalvando(false);
      if (res.erro) {
        setFiltroErro(res.erro);
        return { erro: res.erro };
      }
      await carregarDadosGlobais();
      return { erro: null };
    },
    [carregarDadosGlobais]
  );

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
          pendencias={PENDENCIAS_CATALOGO}
          onAlternarFiltro={(ativar) => setFiltroDemoAtivo(Boolean(ativar))}
          onSair={usuario && !ehModoExemplo ? sair : () => navegarPara('#/projetos')}
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

  const mapaCentros = new Map();
  for (const c of resumoSt.dados?.todos || []) mapaCentros.set(c.id, c);
  for (const c of resumoSt.dados?.centros || []) mapaCentros.set(c.id, c);

  const pendenciasSino = sinoSt.dados.map((item) => {
    if (!item.project_id) {
      return { ...item, centro: 'Geral' };
    }
    const centro = mapaCentros.get(item.project_id);
    return {
      ...item,
      centro: centro ? `${centro.name} · ${centro.code}` : (item.code || 'Centro'),
    };
  });

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
      const resumoCentro = (resumoSt.dados?.centros || []).find((c) => c.id === rota.id) || null;
      return (
        <Projeto
          projectId={rota.id}
          abaInicial={rota.aba}
          resumoCentro={resumoCentro}
          carregandoResumo={resumoSt.carregando}
          erroResumo={resumoSt.erro}
          isAdmin={isAdmin}
          onNavegar={navegarPara}
          onMudarPendencias={carregarDadosGlobais}
          onRecarregarResumo={carregarResumo}
        />
      );
    }

    if (rota.pagina === 'analise') {
      return <EmConstrucao titulo="Análise" contexto="Área de trabalho com blocos e origem" />;
    }

    return (
      <Projetos
        carregando={resumoSt.carregando}
        erro={resumoSt.erro}
        resumo={resumoSt.dados}
        isAdmin={isAdmin}
        onRecarregar={carregarResumo}
        onMostrarTodos={() => salvarFiltro([])}
        onNavegar={navegarPara}
      />
    );
  };

  return (
    <div class="casca">
      <BarraTopo
        rotaAtiva={rota.menu}
        isAdmin={isAdmin}
        usuario={{ nome: perfil.nome, email: perfil.email }}
        todosCentros={isAdmin && Array.isArray(resumoSt.dados?.todos) ? resumoSt.dados.todos : null}
        filtroSalvando={filtroSalvando}
        filtroErro={filtroErro}
        onSalvarFiltro={salvarFiltro}
        sinoEstado={sinoSt.estado}
        sinoErro={sinoSt.erro}
        pendencias={pendenciasSino}
        onRecarregarSino={carregarSino}
        onSelecionarPendencia={(item) => {
          if (item?.project_id) {
            navegarPara(urlProjeto(item.project_id, 'pendencias'));
          }
        }}
        onSair={ehModoExemplo ? () => navegarPara('#/projetos') : sair}
        onNavegar={navegarPara}
      />
      <main>{renderizarPagina()}</main>
    </div>
  );
}
