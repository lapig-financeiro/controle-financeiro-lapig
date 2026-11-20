import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { ChevronDown } from 'lucide-preact';
import {
  AvisoFalha,
  Botao,
  CabecalhoPagina,
  Campo,
  Esqueleto,
  PainelLateral,
  Tabela,
  Vazio,
} from '../componentes/index.js';
import { acessosUsuarios, salvarAcessos } from '../servicos/dados.js';
import './Admin.css';

const ROTULOS_PAPEL = {
  admin: 'Admin',
  professor: 'Professor',
  agente: 'Buriti (IA)',
  automacao: 'Automação',
};

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function rotuloPapel(role) {
  return ROTULOS_PAPEL[role] || role || '—';
}

function codigoCentro(centro) {
  return typeof centro?.code === 'string' && centro.code.trim()
    ? centro.code.trim()
    : 'sem código';
}

function prioridadeLogin(usuario) {
  if (usuario.role === 'professor' && usuario.centros.length === 0) return 0;
  if (usuario.role === 'professor') return 1;
  if (usuario.role === 'admin') return 2;
  if (usuario.role === 'agente') return 3;
  if (usuario.role === 'automacao') return 4;
  return 5;
}

function ordenarLogins(usuarios) {
  return [...usuarios].sort((a, b) => {
    const diffPrio = prioridadeLogin(a) - prioridadeLogin(b);
    if (diffPrio !== 0) return diffPrio;
    const diffNome = String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', {
      sensitivity: 'base',
    });
    if (diffNome !== 0) return diffNome;
    return String(a.email || '').localeCompare(String(b.email || ''), 'pt-BR', {
      sensitivity: 'base',
    });
  });
}

function ordenarCentros(centros) {
  return [...centros].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const codeA = typeof a.code === 'string' ? a.code.trim() : '';
    const codeB = typeof b.code === 'string' ? b.code.trim() : '';
    if (Boolean(codeA) !== Boolean(codeB)) return codeA ? -1 : 1;
    const diffCode = codeA.localeCompare(codeB, 'pt-BR', { sensitivity: 'base' });
    if (diffCode !== 0) return diffCode;
    return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', {
      sensitivity: 'base',
    });
  });
}

function resumoOQueVe(usuario, centrosPorId) {
  if (usuario.role === 'admin') {
    return 'todos os centros';
  }

  const total = usuario.centros.length;
  if (total === 0) {
    if (usuario.role === 'professor') {
      return <span class="admin__sem-centro">nenhum centro</span>;
    }
    return <span class="admin__texto-neutro">nenhum centro</span>;
  }

  const codigos = usuario.centros
    .map((id) => {
      const c = centrosPorId.get(id);
      return typeof c?.code === 'string' && c.code.trim() ? c.code.trim() : '';
    })
    .sort((a, b) => {
      if (Boolean(a) !== Boolean(b)) return a ? -1 : 1;
      return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
    })
    .map((code) => code || 'sem código');

  const prefixo = `${total} ${total === 1 ? 'centro' : 'centros'}`;
  if (codigos.length <= 4) {
    return `${prefixo} · ${codigos.join(', ')}`;
  }
  return `${prefixo} · ${codigos.slice(0, 4).join(', ')} +${codigos.length - 4}`;
}

/**
 * Tela Admin mínima (`/v2/#/admin`): lista logins, mostra quem vê qual centro de custo
 * e edita papel e lista completa de centros em um painel lateral.
 */
export function Admin({ usuarioId = null }) {
  const [st, setSt] = useState({ carregando: true, dados: null, erro: null });
  const [buscaLogin, setBuscaLogin] = useState('');
  const [aviso, setAviso] = useState(null);

  const [usuarioEditando, setUsuarioEditando] = useState(null);
  const [papelPainel, setPapelPainel] = useState('professor');
  const [marcados, setMarcados] = useState(() => new Set());
  const [buscaCentro, setBuscaCentro] = useState('');
  const [encerradosAberto, setEncerradosAberto] = useState(false);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroPainel, setErroPainel] = useState(null);

  const montadoRef = useRef(true);
  const geracaoRef = useRef(0);
  const salvandoRef = useRef(false);
  const acoesPainelRef = useRef(null);
  const confirmandoAnteriorRef = useRef(false);
  const devolverFocoSalvarRef = useRef(false);
  const papelSelectId = useId();
  const papelAjudaId = useId();

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      geracaoRef.current += 1;
    };
  }, []);

  const carregar = useCallback(async ({ posSalvar = false } = {}) => {
    const geracao = ++geracaoRef.current;
    setSt((anterior) => ({ ...anterior, carregando: true, erro: null }));
    try {
      const res = await acessosUsuarios();
      if (!montadoRef.current || geracao !== geracaoRef.current) return false;
      if (res?.erro) {
        setSt((anterior) => {
          const msg = posSalvar && anterior.dados
            ? 'Os acessos foram salvos, mas a lista não recarregou.'
            : res.erro;
          return { carregando: false, dados: anterior.dados, erro: msg };
        });
        return false;
      }
      setSt({ carregando: false, dados: res.dados, erro: null });
      return true;
    } catch {
      if (!montadoRef.current || geracao !== geracaoRef.current) return false;
      setSt((anterior) => {
        const msg = posSalvar && anterior.dados
          ? 'Os acessos foram salvos, mas a lista não recarregou.'
          : 'Não foi possível carregar os acessos.';
        return { carregando: false, dados: anterior.dados, erro: msg };
      });
      return false;
    }
  }, []);

  useEffect(() => {
    carregar().catch(() => {
      if (montadoRef.current) {
        setSt((anterior) => ({
          carregando: false,
          dados: anterior.dados,
          erro: 'Não foi possível carregar os acessos.',
        }));
      }
    });
  }, [carregar]);

  useEffect(() => {
    if (confirmandoRemocao && !confirmandoAnteriorRef.current) {
      acoesPainelRef.current?.querySelector('.admin__confirmacao .botao--primario')?.focus();
    } else if (!confirmandoRemocao && confirmandoAnteriorRef.current && devolverFocoSalvarRef.current) {
      devolverFocoSalvarRef.current = false;
      acoesPainelRef.current?.querySelector('.admin__painel-botoes .botao--primario')?.focus();
    }
    confirmandoAnteriorRef.current = confirmandoRemocao;
  }, [confirmandoRemocao]);

  const dados = st.dados;

  const centrosOrdenados = useMemo(
    () => ordenarCentros(dados?.centros || []),
    [dados]
  );

  const centrosPorId = useMemo(() => {
    const mapa = new Map();
    for (const c of centrosOrdenados) mapa.set(c.id, c);
    return mapa;
  }, [centrosOrdenados]);

  const usuariosOrdenados = useMemo(
    () => ordenarLogins(dados?.usuarios || []),
    [dados]
  );

  const mostrarBuscaLogins = (dados?.usuarios?.length || 0) > 8;

  const usuariosFiltrados = useMemo(() => {
    if (!mostrarBuscaLogins) return usuariosOrdenados;
    const termo = normalizarTexto(buscaLogin);
    if (!termo) return usuariosOrdenados;
    return usuariosOrdenados.filter(
      (u) => normalizarTexto(u.nome).includes(termo) || normalizarTexto(u.email).includes(termo)
    );
  }, [usuariosOrdenados, mostrarBuscaLogins, buscaLogin]);

  const abrirPainel = (usuario) => {
    if (salvandoRef.current || st.carregando) return;
    const atual = (st.dados?.usuarios || []).find((u) => u.user_id === usuario.user_id) || usuario;
    setAviso(null);
    setUsuarioEditando(atual);
    setPapelPainel(atual.role);
    setMarcados(new Set(atual.centros));
    setBuscaCentro('');
    setEncerradosAberto(false);
    devolverFocoSalvarRef.current = false;
    setConfirmandoRemocao(false);
    setErroPainel(null);
  };

  const fecharPainel = () => {
    if (salvandoRef.current) return;
    devolverFocoSalvarRef.current = false;
    setUsuarioEditando(null);
    setConfirmandoRemocao(false);
    setErroPainel(null);
  };

  // Falha fechada: sem usuarioId, nenhum admin pode ser rebaixado pela tela.
  const temUsuarioId = typeof usuarioId === 'string' && usuarioId.trim().length > 0;
  const ehProprioAdmin = Boolean(
    usuarioEditando &&
      usuarioEditando.role === 'admin' &&
      (!temUsuarioId || usuarioEditando.user_id === usuarioId)
  );

  const centrosVisiveisBusca = useMemo(() => {
    const termo = normalizarTexto(buscaCentro);
    if (!termo) return centrosOrdenados;
    return centrosOrdenados.filter(
      (c) =>
        normalizarTexto(codigoCentro(c)).includes(termo) ||
        normalizarTexto(c.name).includes(termo)
    );
  }, [centrosOrdenados, buscaCentro]);

  const ativosVisiveis = useMemo(
    () => centrosVisiveisBusca.filter((c) => c.active !== false),
    [centrosVisiveisBusca]
  );

  const inativosVisiveis = useMemo(
    () => centrosVisiveisBusca.filter((c) => c.active === false),
    [centrosVisiveisBusca]
  );

  const centrosAlvoLote = useMemo(
    () => (encerradosAberto ? centrosVisiveisBusca : ativosVisiveis),
    [encerradosAberto, centrosVisiveisBusca, ativosVisiveis]
  );

  const alteracoes = useMemo(() => {
    if (!usuarioEditando) {
      return {
        mudouPapel: false,
        rebaixandoAdmin: false,
        centrosMarcados: [],
        adicionados: [],
        removidos: [],
        temMudanca: false,
      };
    }

    const iniciais = new Set(usuarioEditando.centros);
    const centrosMarcados = [];
    const adicionados = [];
    const removidos = [];

    for (const c of centrosOrdenados) {
      const estava = iniciais.has(c.id);
      const esta = marcados.has(c.id);
      if (esta) centrosMarcados.push(c);
      if (!estava && esta) adicionados.push(c);
      if (estava && !esta) removidos.push(c);
    }

    for (const id of marcados) {
      if (!centrosPorId.has(id)) {
        const fallback = { id, code: '', name: 'sem código' };
        centrosMarcados.push(fallback);
        if (!iniciais.has(id)) adicionados.push(fallback);
      }
    }
    for (const id of iniciais) {
      if (!centrosPorId.has(id) && !marcados.has(id)) {
        removidos.push({ id, code: '', name: 'sem código' });
      }
    }

    const mudouPapel = papelPainel !== usuarioEditando.role;
    const rebaixandoAdmin = usuarioEditando.role === 'admin' && papelPainel === 'professor';
    const temMudanca = mudouPapel || adicionados.length > 0 || removidos.length > 0;
    return {
      mudouPapel,
      rebaixandoAdmin,
      centrosMarcados,
      adicionados,
      removidos,
      temMudanca,
    };
  }, [usuarioEditando, papelPainel, marcados, centrosOrdenados, centrosPorId]);

  const precisaConfirmar = alteracoes.rebaixandoAdmin || alteracoes.removidos.length > 0;

  const alternarCentro = (projectId) => {
    devolverFocoSalvarRef.current = false;
    setConfirmandoRemocao(false);
    setErroPainel(null);
    setMarcados((anterior) => {
      const proximo = new Set(anterior);
      if (proximo.has(projectId)) proximo.delete(projectId);
      else proximo.add(projectId);
      return proximo;
    });
  };

  const marcarVisiveis = () => {
    devolverFocoSalvarRef.current = false;
    setConfirmandoRemocao(false);
    setErroPainel(null);
    setMarcados((anterior) => {
      const proximo = new Set(anterior);
      for (const c of centrosAlvoLote) proximo.add(c.id);
      return proximo;
    });
  };

  const limparVisiveis = () => {
    devolverFocoSalvarRef.current = false;
    setConfirmandoRemocao(false);
    setErroPainel(null);
    setMarcados((anterior) => {
      const proximo = new Set(anterior);
      for (const c of centrosAlvoLote) proximo.delete(c.id);
      return proximo;
    });
  };

  const executarSalvar = async () => {
    if (!usuarioEditando || salvandoRef.current || !alteracoes.temMudanca) return;
    if (ehProprioAdmin && papelPainel !== 'admin') return;

    salvandoRef.current = true;
    setSalvando(true);
    setErroPainel(null);

    const idsCompletos = [
      ...centrosOrdenados.filter((c) => marcados.has(c.id)).map((c) => c.id),
      ...Array.from(marcados).filter((id) => !centrosPorId.has(id)),
    ];

    try {
      const res = await salvarAcessos(usuarioEditando.user_id, papelPainel, idsCompletos);
      if (!montadoRef.current) return;
      if (res?.erro) {
        setErroPainel(res.erro);
        devolverFocoSalvarRef.current = false;
        setConfirmandoRemocao(false);
        return;
      }

      const nomeSalvo = usuarioEditando.nome;
      devolverFocoSalvarRef.current = false;
      setUsuarioEditando(null);
      setConfirmandoRemocao(false);
      setAviso(`Acessos de ${nomeSalvo} salvos`);
      await carregar({ posSalvar: true });
    } catch {
      if (!montadoRef.current) return;
      setErroPainel('Não foi possível salvar os acessos.');
      devolverFocoSalvarRef.current = false;
      setConfirmandoRemocao(false);
    } finally {
      salvandoRef.current = false;
      if (montadoRef.current) setSalvando(false);
    }
  };

  const aoClicarSalvar = () => {
    if (!alteracoes.temMudanca || salvandoRef.current) return;
    if (precisaConfirmar && !confirmandoRemocao) {
      devolverFocoSalvarRef.current = false;
      setConfirmandoRemocao(true);
      return;
    }
    executarSalvar();
  };

  const colunas = [
    {
      chave: 'nome',
      titulo: 'Nome',
      render: (u) => <span class="admin__usuario-nome">{u.nome}</span>,
    },
    {
      chave: 'email',
      titulo: 'E-mail',
      render: (u) => <span class="admin__usuario-email">{u.email || '—'}</span>,
    },
    {
      chave: 'role',
      titulo: 'Papel',
      render: (u) => rotuloPapel(u.role),
    },
    {
      chave: 'centros',
      titulo: 'O que vê',
      render: (u) => <span class="admin__o-que-ve">{resumoOQueVe(u, centrosPorId)}</span>,
    },
    {
      chave: 'acoes',
      titulo: 'Ações',
      alinhamento: 'direita',
      render: (u) =>
        u.role === 'agente' || u.role === 'automacao' ? (
          <span class="admin__somente-leitura">Muda só pelo banco, de propósito</span>
        ) : (
          <Botao
            variante="fantasma"
            tamanho="compacto"
            desabilitado={salvando || st.carregando}
            onClick={() => abrirPainel(u)}
            aria-label={`Editar ${u.nome}`}
          >
            Editar
          </Botao>
        ),
    },
  ];

  const renderizarItemCentro = (centro) => (
    <li key={centro.id} class="admin__centro-linha">
      <label class="admin__centro-item">
        <input
          type="checkbox"
          class="admin__centro-checkbox"
          value={centro.id}
          checked={marcados.has(centro.id)}
          disabled={salvando}
          onChange={() => alternarCentro(centro.id)}
        />
        <span class="admin__centro-texto">
          {codigoCentro(centro)} — {centro.name}
        </span>
      </label>
    </li>
  );

  return (
    <div class="conteudo admin">
      <CabecalhoPagina titulo="Admin" contexto="Quem vê qual centro de custo" />

      <p class="admin__nota texto-corrido">
        Para dar acesso a alguém novo: crie o login no Supabase (Authentication → Users). Ele
        aparece aqui como professor, sem nenhum centro; marque os centros e salve.
      </p>

      {aviso && (
        <p class="admin__aviso" role="status">
          {aviso}
        </p>
      )}

      {st.erro && (
        <AvisoFalha mensagem={st.erro} aoTentarNovamente={() => carregar()} />
      )}

      {st.carregando && !dados ? (
        <Esqueleto variante="tabela" linhas={5} rotulo="Carregando acessos dos usuários" />
      ) : dados && dados.usuarios.length === 0 ? (
        <Vazio mensagem="Nenhum login cadastrado." />
      ) : (
        dados && (
          <section class="admin__lista" aria-label="Logins cadastrados">
            {st.carregando && (
              <p class="admin__atualizando" role="status">
                Atualizando…
              </p>
            )}

            {mostrarBuscaLogins && (
              <div class="admin__barra-busca">
                <Campo
                  rotulo="Buscar login"
                  tipo="search"
                  valor={buscaLogin}
                  aoMudar={setBuscaLogin}
                  placeholder="Nome ou e-mail"
                  className="admin__busca-login"
                />
              </div>
            )}

            <Tabela
              colunas={colunas}
              dados={usuariosFiltrados}
              chaveLinha={(u) => u.user_id}
              legenda="Acessos por login"
              className="admin__tabela"
              vazio="Nenhum login encontrado para a busca."
            />
          </section>
        )
      )}

      <PainelLateral
        aberto={Boolean(usuarioEditando)}
        aoFechar={fecharPainel}
        titulo={usuarioEditando?.nome || ''}
        subtitulo={usuarioEditando?.email || ''}
      >
        {usuarioEditando && (
          <div class="admin__painel">
            <div class="seletor">
              <label class="seletor__rotulo" for={papelSelectId}>
                Papel
              </label>
              <div class="seletor__controle">
                <select
                  id={papelSelectId}
                  class="seletor__entrada"
                  value={papelPainel}
                  disabled={salvando}
                  aria-describedby={ehProprioAdmin || papelPainel === 'admin' ? papelAjudaId : undefined}
                  onChange={(e) => {
                    const proximo = e.currentTarget.value;
                    if (ehProprioAdmin && proximo !== 'admin') return;
                    setPapelPainel(proximo);
                    devolverFocoSalvarRef.current = false;
                    setConfirmandoRemocao(false);
                    setErroPainel(null);
                  }}
                >
                  <option value="professor" disabled={ehProprioAdmin}>
                    Professor
                  </option>
                  <option value="admin">Admin</option>
                </select>
                <ChevronDown size={16} strokeWidth={1.75} class="seletor__seta" aria-hidden="true" />
              </div>
              {(ehProprioAdmin || papelPainel === 'admin') && (
                <div id={papelAjudaId} class="admin__papel-notas">
                  {ehProprioAdmin && (
                    <span class="seletor__ajuda">Peça a outro administrador</span>
                  )}
                  {papelPainel === 'admin' && (
                    <span class="seletor__ajuda">
                      Admin vê todos os centros; a lista abaixo fica guardada caso ele volte a
                      professor.
                    </span>
                  )}
                </div>
              )}
            </div>

            <div class="admin__centros-secao">
              <div class="admin__centros-topo">
                <span class="admin__centros-titulo">Centros de custo</span>
                <span class="admin__centros-contador" role="status">
                  {marcados.size} {marcados.size === 1 ? 'centro marcado' : 'centros marcados'}
                </span>
              </div>

              <Campo
                rotulo="Buscar centro"
                tipo="search"
                valor={buscaCentro}
                aoMudar={setBuscaCentro}
                placeholder="Código ou nome"
                desabilitado={salvando}
                className="admin__busca-centro"
              />

              <div class="admin__centros-lote">
                <Botao
                  variante="fantasma"
                  tamanho="compacto"
                  desabilitado={salvando || centrosAlvoLote.length === 0}
                  onClick={marcarVisiveis}
                >
                  Marcar todos
                </Botao>
                <Botao
                  variante="fantasma"
                  tamanho="compacto"
                  desabilitado={salvando || centrosAlvoLote.length === 0}
                  onClick={limparVisiveis}
                >
                  Limpar
                </Botao>
              </div>

              {centrosVisiveisBusca.length === 0 ? (
                <p class="admin__centros-vazio">Nenhum centro encontrado.</p>
              ) : (
                <div class="admin__centros-grupos">
                  {ativosVisiveis.length > 0 && (
                    <ul class="admin__centros-lista" aria-label="Centros ativos">
                      {ativosVisiveis.map(renderizarItemCentro)}
                    </ul>
                  )}

                  {inativosVisiveis.length > 0 && (
                    <details
                      class="admin__encerrados"
                      open={encerradosAberto}
                      onToggle={(e) => setEncerradosAberto(Boolean(e.currentTarget.open))}
                    >
                      <summary
                        class="admin__encerrados-titulo"
                        onClick={(e) => {
                          e.preventDefault();
                          setEncerradosAberto((v) => !v);
                        }}
                      >
                        Encerrados ({inativosVisiveis.length})
                      </summary>
                      <ul class="admin__centros-lista" aria-label="Centros encerrados">
                        {inativosVisiveis.map(renderizarItemCentro)}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>

            {alteracoes.temMudanca && (
              <div class="admin__resumo" aria-live="polite">
                {alteracoes.mudouPapel && (
                  <p class="admin__resumo-linha">
                    Papel: {rotuloPapel(usuarioEditando.role)} → {rotuloPapel(papelPainel)}
                  </p>
                )}
                {alteracoes.rebaixandoAdmin ? (
                  <>
                    <p class="admin__resumo-linha">
                      Passa a ver:{' '}
                      {alteracoes.centrosMarcados.length === 0
                        ? 'nenhum centro'
                        : alteracoes.centrosMarcados.map(codigoCentro).join(', ')}
                    </p>
                    <p class="admin__resumo-linha">Deixa de ver: todos os centros</p>
                  </>
                ) : (
                  <>
                    {alteracoes.adicionados.length > 0 && (
                      <p class="admin__resumo-linha">
                        Passa a ver: {alteracoes.adicionados.map(codigoCentro).join(', ')}
                      </p>
                    )}
                    {alteracoes.removidos.length > 0 && (
                      <p class="admin__resumo-linha">
                        Deixa de ver: {alteracoes.removidos.map(codigoCentro).join(', ')}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {erroPainel && <AvisoFalha mensagem={erroPainel} grave />}

            <div class="admin__painel-acoes" ref={acoesPainelRef}>
              {confirmandoRemocao ? (
                <div
                  class="admin__confirmacao"
                  role="alert"
                  aria-label="Confirmar remoção de acessos"
                >
                  <p class="admin__confirmacao-texto">
                    {alteracoes.rebaixandoAdmin
                      ? 'Deixa de ver todos os centros. Confirmar?'
                      : `Deixa de ver ${alteracoes.removidos.map(codigoCentro).join(', ')}. Confirmar?`}
                  </p>
                  <div class="admin__confirmacao-botoes">
                    <Botao
                      variante="primario"
                      tamanho="compacto"
                      carregando={salvando}
                      desabilitado={salvando}
                      onClick={executarSalvar}
                    >
                      Confirmar e salvar
                    </Botao>
                    <Botao
                      variante="fantasma"
                      tamanho="compacto"
                      desabilitado={salvando}
                      onClick={() => {
                        devolverFocoSalvarRef.current = true;
                        setConfirmandoRemocao(false);
                      }}
                    >
                      Cancelar
                    </Botao>
                  </div>
                </div>
              ) : (
                <div class="admin__painel-botoes">
                  <Botao
                    variante="primario"
                    carregando={salvando}
                    desabilitado={!alteracoes.temMudanca || salvando}
                    onClick={aoClicarSalvar}
                  >
                    Salvar
                  </Botao>
                  <Botao variante="fantasma" desabilitado={salvando} onClick={fecharPainel}>
                    Cancelar
                  </Botao>
                </div>
              )}
            </div>
          </div>
        )}
      </PainelLateral>
    </div>
  );
}
