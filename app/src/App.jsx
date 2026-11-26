import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  AvisoFalha,
  BarraTopo,
  BoasVindas,
  boasVindasVista,
  Esqueleto,
  Manutencao,
  marcarBoasVindasVista,
} from './componentes/index.js';
import { Admin } from './paginas/Admin.jsx';
import { Analise } from './paginas/Analise.jsx';
import { Bolsistas } from './paginas/Bolsistas.jsx';
import { Componentes } from './paginas/Componentes.jsx';
import { Login } from './paginas/Login.jsx';
import { Projeto } from './paginas/Projeto.jsx';
import { Projetos } from './paginas/Projetos.jsx';
import { navegarPara, parsearRota, urlProjeto } from './roteador.js';
import {
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
  const [rota, setRota] = useState(() => parsearRota());
  const [carregandoSessao, setCarregandoSessao] = useState(
    () => !(import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo')
  );
  const [carregandoPerfil, setCarregandoPerfil] = useState(false);
  const [usuario, setUsuario] = useState(() =>
    import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo'
      ? { id: 'exemplo-admin', email: 'exemplo@lapig.ufg.br' }
      : null
  );
  const [perfil, setPerfil] = useState(() =>
    import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo'
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

  const montadoRef = useRef(true);
  const genResumoRef = useRef(0);
  const genSinoRef = useRef(0);
  const salvandoFiltroRef = useRef(false);
  // Id do usuário já aplicado: o Supabase repete `SIGNED_IN` toda vez que a aba
  // do navegador volta a ficar visível; reaplicar o mesmo usuário recarregava o
  // perfil e desmontava a página aberta (a Análise perdia pergunta e respostas).
  const usuarioIdRef = useRef(null);
  // A Análise fica montada (escondida) depois da primeira visita, para a
  // conversa sobreviver à troca de aba do site.
  const [analiseMontada, setAnaliseMontada] = useState(false);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

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
    usuarioIdRef.current = user?.id ?? null;
    if (!user) {
      setAnaliseMontada(false);
      genResumoRef.current += 1;
      genSinoRef.current += 1;
      setUsuario(null);
      setPerfil({ erro: null, role: null, nome: '', email: '' });
      setCarregandoPerfil(false);
      setResumoSt({ carregando: true, dados: null, erro: null });
      setSinoSt({ estado: 'consultando', dados: [], erro: null });
      return;
    }
    setUsuario(user);
    setCarregandoPerfil(true);
    const dadosPerfil = await carregarPerfil(user);
    if (!montadoRef.current) return;
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
    if (import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo') return undefined;

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
        if (sessao.user.id === usuarioIdRef.current) return;
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
  const naAnalise = rota.pagina === 'analise';
  // Bolsistas e Análise são para toda conta de gente (admin e professor). O
  // agente e a automação não têm tela; o banco já filtra os centros de cada um.
  const contaDeGente = papelConhecido && (isAdmin || perfil.role === 'professor');
  const podeBolsistas = contaDeGente;
  const podeAnalise = contaDeGente;

  useEffect(() => {
    if (naAnalise && podeAnalise) setAnaliseMontada(true);
  }, [naAnalise, podeAnalise]);

  // Guia de primeiro acesso: abre sozinho uma vez por login (neste navegador).
  const [boasVindasAberta, setBoasVindasAberta] = useState(false);
  const usuarioIdAtual = usuario?.id || null;
  useEffect(() => {
    // Troca de login (ou saída) fecha o guia do anterior; o novo decide por si.
    setBoasVindasAberta(Boolean(contaDeGente && usuarioIdAtual && !boasVindasVista(usuarioIdAtual)));
  }, [contaDeGente, usuarioIdAtual]);
  const fecharBoasVindas = useCallback(() => {
    if (usuarioIdAtual) marcarBoasVindasVista(usuarioIdAtual);
    setBoasVindasAberta(false);
  }, [usuarioIdAtual]);

  const carregarResumo = useCallback(async () => {
    const gen = ++genResumoRef.current;
    setResumoSt((prev) => ({ carregando: true, dados: prev.dados, erro: null }));
    const res = await resumoProjetos();
    if (!montadoRef.current || gen !== genResumoRef.current) return;
    setResumoSt((prev) => ({
      carregando: false,
      dados: res.erro ? prev.dados : res.dados,
      erro: res.erro,
    }));
  }, []);

  const carregarSino = useCallback(async () => {
    const gen = ++genSinoRef.current;
    setSinoSt((prev) => ({ estado: 'consultando', dados: prev.dados, erro: null }));
    const res = await buscarPendencias(null);
    if (!montadoRef.current || gen !== genSinoRef.current) return;
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
    if (rota.pagina === 'bolsistas' && !podeBolsistas) {
      navegarPara('#/projetos');
    }
    if (rota.pagina === 'analise' && !podeAnalise) {
      navegarPara('#/projetos');
    }
    if (rota.pagina === 'componentes' && !import.meta.env.DEV && !isAdmin) {
      navegarPara('#/projetos');
    }
  }, [papelConhecido, usuario, rota.pagina, isAdmin, podeBolsistas, podeAnalise]);

  const salvarFiltro = useCallback(
    async (centrosOcultos) => {
      if (salvandoFiltroRef.current) {
        return { erro: null, ignorado: true };
      }
      salvandoFiltroRef.current = true;
      setFiltroSalvando(true);
      setFiltroErro(null);
      try {
        const res = await salvarFiltroVisao(centrosOcultos);
        if (res.erro) {
          if (montadoRef.current) setFiltroErro(res.erro);
          return { erro: res.erro };
        }
        await carregarDadosGlobais();
        return { erro: null };
      } catch {
        const erro = 'Não foi possível salvar o filtro de visão.';
        if (montadoRef.current) setFiltroErro(erro);
        return { erro };
      } finally {
        salvandoFiltroRef.current = false;
        if (montadoRef.current) setFiltroSalvando(false);
      }
    },
    [carregarDadosGlobais]
  );

  const mostrarCentro = useCallback(
    (projectId) => {
      const ocultosRestantes = (resumoSt.dados?.todos || [])
        .filter((c) => c.oculto && c.id !== projectId)
        .map((c) => c.id);
      return salvarFiltro(ocultosRestantes);
    },
    [resumoSt.dados, salvarFiltro]
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
          podeBolsistas={adminCatalogo}
          usuario={usuarioCatalogo}
          centrosVisiveis={filtroDemoAtivo ? { visiveis: 15, total: 17 } : { visiveis: 17, total: 17 }}
          pendencias={PENDENCIAS_CATALOGO}
          onAlternarFiltro={(ativar) => setFiltroDemoAtivo(Boolean(ativar))}
          onSair={
            usuario && !(import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo')
              ? sair
              : () => navegarPara('#/projetos')
          }
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

    if (rota.pagina === 'bolsistas') {
      if (!podeBolsistas) return null;
      return <Bolsistas usuarioId={usuario?.id || null} />;
    }

    if (rota.pagina === 'admin') {
      if (!papelConhecido || !isAdmin) return null;
      return <Admin usuarioId={usuario?.id || null} />;
    }

    if (rota.pagina === 'componentes' && !import.meta.env.DEV) {
      return null;
    }

    if (rota.pagina === 'projeto') {
      const resumoCentro = (resumoSt.dados?.centros || []).find((c) => c.id === rota.id) || null;
      const centroNoFiltro = (resumoSt.dados?.todos || []).find((c) => c.id === rota.id) || null;
      const centroOculto = Boolean(!resumoCentro && centroNoFiltro && centroNoFiltro.oculto);
      return (
        <Projeto
          projectId={rota.id}
          abaInicial={rota.aba}
          resumoCentro={resumoCentro}
          centroOculto={centroOculto}
          centroOcultoInfo={centroOculto ? centroNoFiltro : null}
          carregandoResumo={resumoSt.carregando}
          erroResumo={resumoSt.erro}
          isAdmin={isAdmin}
          onNavegar={navegarPara}
          onMudarPendencias={carregarDadosGlobais}
          onRecarregarResumo={carregarResumo}
          onMostrarEsteCentro={centroOculto && isAdmin ? () => mostrarCentro(rota.id) : null}
        />
      );
    }

    // A Análise é desenhada fora daqui (ver `analiseMontada`).
    if (rota.pagina === 'analise') return null;

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
        podeBolsistas={podeBolsistas}
        podeAnalise={podeAnalise}
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
        onSair={
          import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo'
            ? () => navegarPara('#/projetos')
            : sair
        }
        onAjuda={contaDeGente ? () => setBoasVindasAberta(true) : null}
        onNavegar={navegarPara}
      />
      <BoasVindas aberto={contaDeGente && boasVindasAberta} aoFechar={fecharBoasVindas} isAdmin={isAdmin} />
      <main>
        {renderizarPagina()}
        {analiseMontada && podeAnalise && !perfil.erro && (
          <div hidden={!naAnalise}>
            <Analise ativa={naAnalise} />
          </div>
        )}
      </main>
    </div>
  );
}
