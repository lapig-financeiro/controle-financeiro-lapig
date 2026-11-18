import { useId, useRef, useState } from 'preact/hooks';
import { ChevronDown, Filter } from 'lucide-preact';
import { FiltroVisao } from './FiltroVisao.jsx';
import { MenuSuspenso, MenuSuspensoItem } from './MenuSuspenso.jsx';
import { MenuUsuario } from './MenuUsuario.jsx';
import { Sino } from './Sino.jsx';
import './BarraTopo.css';

const ITENS_MENU = [
  { id: 'projetos', rotulo: 'Projetos', hash: '#/projetos', apenasAdmin: false },
  { id: 'analise', rotulo: 'Análise', hash: '#/analise', apenasAdmin: false },
  { id: 'admin', rotulo: 'Admin', hash: '#/admin', apenasAdmin: true },
];

/**
 * Barra do topo única (`--altura-topo`): logo, até 3 itens de navegação,
 * chip do filtro de visão (só admin), sino de pendências e menu do usuário.
 */
export function BarraTopo({
  rotaAtiva = 'projetos',
  isAdmin = false,
  usuario = null,
  todosCentros = null,
  filtroSalvando = false,
  filtroErro = null,
  onSalvarFiltro = null,
  centrosVisiveis = null,
  pendencias = [],
  sinoEstado = 'pronto',
  sinoErro = null,
  onRecarregarSino = null,
  onAlternarFiltro = null,
  onSelecionarPendencia = null,
  onSair = null,
  onNavegar = null,
}) {
  const [filtroAberto, setFiltroAberto] = useState(false);
  const filtroAncoraRef = useRef(null);
  const filtroGatilhoRef = useRef(null);
  const filtroPainelId = useId();

  const itensVisiveis = ITENS_MENU.filter((item) => !item.apenasAdmin || isAdmin);

  const temFiltroAtivo = Boolean(
    centrosVisiveis &&
    typeof centrosVisiveis.visiveis === 'number' &&
    typeof centrosVisiveis.total === 'number' &&
    centrosVisiveis.visiveis < centrosVisiveis.total
  );

  const ocultos = temFiltroAtivo
    ? centrosVisiveis.total - centrosVisiveis.visiveis
    : 0;

  const textoFiltro = temFiltroAtivo
    ? `${centrosVisiveis.visiveis} de ${centrosVisiveis.total} centros`
    : 'Todos os centros';

  const irPara = (e, hash) => {
    if (onNavegar) {
      e.preventDefault();
      onNavegar(hash);
    }
  };

  return (
    <header class="barra-topo">
      <div class="barra-topo__interior">
        <div class="barra-topo__esquerda">
          <a
            href="#/projetos"
            class="barra-topo__marca"
            aria-label="Controle Financeiro LAPIG — início"
            onClick={(e) => irPara(e, '#/projetos')}
          >
            <img
              src={`${import.meta.env.BASE_URL}lapig-logo.svg`}
              alt="LAPIG"
              class="barra-topo__logo"
            />
          </a>

          <nav class="barra-topo__nav" aria-label="Navegação principal">
            {itensVisiveis.map((item) => {
              const ativo = rotaAtiva === item.id;
              return (
                <a
                  key={item.id}
                  href={item.hash}
                  class={`barra-topo__link${ativo ? ' barra-topo__link--ativo' : ''}`}
                  aria-current={ativo ? 'page' : undefined}
                  onClick={(e) => irPara(e, item.hash)}
                >
                  {item.rotulo}
                </a>
              );
            })}
          </nav>
        </div>

        <div class="barra-topo__direita">
          {isAdmin && Array.isArray(todosCentros) && (
            <FiltroVisao
              todos={todosCentros}
              salvando={filtroSalvando}
              erro={filtroErro}
              onSalvar={onSalvarFiltro}
            />
          )}

          {isAdmin && !Array.isArray(todosCentros) && onAlternarFiltro && (
            <div class="barra-topo__filtro-ancora" ref={filtroAncoraRef}>
              <button
                ref={filtroGatilhoRef}
                type="button"
                class={`chip barra-topo__filtro${temFiltroAtivo ? ' chip--ativo' : ''}`}
                aria-label={`Filtro de visão: ${textoFiltro}`}
                aria-expanded={filtroAberto ? 'true' : 'false'}
                aria-controls={filtroAberto ? filtroPainelId : undefined}
                onClick={() => setFiltroAberto((v) => !v)}
              >
                <Filter size={16} strokeWidth={1.75} aria-hidden="true" />
                {ocultos > 0 && (
                  <span class="barra-topo__filtro-ocultos" aria-hidden="true">
                    {ocultos}
                  </span>
                )}
                <span class="barra-topo__filtro-texto">{textoFiltro}</span>
                <ChevronDown size={16} strokeWidth={1.75} class="barra-topo__filtro-seta" aria-hidden="true" />
              </button>

              <MenuSuspenso
                aberto={filtroAberto}
                aoFechar={() => setFiltroAberto(false)}
                ancoraRef={filtroAncoraRef}
                gatilhoRef={filtroGatilhoRef}
                ariaLabel="Filtro de visão"
              >
                <div id={filtroPainelId}>
                  <MenuSuspensoItem
                    onClick={() => {
                      setFiltroAberto(false);
                      onAlternarFiltro?.(false);
                    }}
                  >
                    Mostrar todos os centros
                  </MenuSuspensoItem>
                  <MenuSuspensoItem
                    onClick={() => {
                      setFiltroAberto(false);
                      onAlternarFiltro?.(true);
                    }}
                  >
                    {temFiltroAtivo ? 'Alternar filtro de exemplo' : 'Ocultar 2 centros (prévia)'}
                  </MenuSuspensoItem>
                </div>
              </MenuSuspenso>
            </div>
          )}

          <Sino
            estado={sinoEstado}
            pendencias={pendencias}
            erro={sinoErro}
            onTentarNovamente={onRecarregarSino}
            onSelecionar={onSelecionarPendencia}
          />

          <MenuUsuario usuario={usuario} isAdmin={isAdmin} onSair={onSair} />
        </div>
      </div>
    </header>
  );
}
