import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { ChevronDown, Filter } from 'lucide-preact';
import { AvisoFalha } from './AvisoFalha.jsx';
import { MenuSuspenso, MenuSuspensoSeparador } from './MenuSuspenso.jsx';
import './FiltroVisao.css';

function agruparPorResponsavel(todos) {
  const mapa = new Map();
  const semResponsavel = [];

  for (const centro of todos) {
    const primeiro = Array.isArray(centro.responsaveis) && centro.responsaveis[0]
      ? String(centro.responsaveis[0]).trim()
      : '';
    if (!primeiro) {
      semResponsavel.push(centro);
      continue;
    }
    if (!mapa.has(primeiro)) mapa.set(primeiro, []);
    mapa.get(primeiro).push(centro);
  }

  const ordenarCentros = (lista) =>
    [...lista].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { sensitivity: 'base' })
    );

  const grupos = Array.from(mapa.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
    .map(([rotulo, centros]) => ({
      chave: rotulo,
      rotulo,
      ehProfessor: true,
      centros: ordenarCentros(centros),
    }));

  if (semResponsavel.length > 0) {
    grupos.push({
      chave: '__sem_responsavel__',
      rotulo: 'Sem responsável',
      ehProfessor: false,
      centros: ordenarCentros(semResponsavel),
    });
  }

  return grupos;
}

function extrairOcultos(todos) {
  return new Set(todos.filter((c) => c.oculto).map((c) => c.id));
}

/**
 * Filtro de visão do administrador na barra do topo.
 * Agrupa centros por `responsaveis[0]` (com "Sem responsável" por último)
 * e no atalho "Só estes" inclui todo centro em que o professor está em `responsaveis`.
 */
export function FiltroVisao({
  todos = [],
  salvando = false,
  erro = null,
  onSalvar = null,
}) {
  const [aberto, setAberto] = useState(false);
  const [erroLocal, setErroLocal] = useState(null);
  const [gravandoLocal, setGravandoLocal] = useState(false);
  const [ocultosOtimista, setOcultosOtimista] = useState(() => extrairOcultos(todos));

  const ancoraRef = useRef(null);
  const gatilhoRef = useRef(null);
  const ultimaTentativaRef = useRef(null);
  const gravandoRef = useRef(false);
  const montadoRef = useRef(true);
  const todosRef = useRef(todos);
  todosRef.current = todos;
  const painelId = useId();

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  const assinaturaTodos = todos.map((c) => `${c.id}:${c.oculto ? 1 : 0}`).join('|');

  useEffect(() => {
    if (!gravandoRef.current && !salvando) {
      setOcultosOtimista(extrairOcultos(todosRef.current));
    }
  }, [assinaturaTodos, salvando]);

  const emSalvamento = Boolean(salvando || gravandoLocal);
  const total = todos.length;
  const ocultos = ocultosOtimista.size;
  const visiveis = Math.max(0, total - ocultos);
  const temFiltroAtivo = ocultos > 0;
  const textoFiltro = temFiltroAtivo ? `${visiveis} de ${total} centros` : 'Todos os centros';

  const grupos = agruparPorResponsavel(todos);
  const mensagemErro = erroLocal || erro;

  const enviar = async (listaOcultos) => {
    if (emSalvamento || gravandoRef.current) return;
    gravandoRef.current = true;
    setGravandoLocal(true);
    const anterior = new Set(ocultosOtimista);
    setOcultosOtimista(new Set(listaOcultos));
    ultimaTentativaRef.current = listaOcultos;
    setErroLocal(null);

    try {
      const resultado = await onSalvar?.(listaOcultos);
      if (!montadoRef.current) return;
      if (resultado?.erro) {
        setOcultosOtimista(anterior);
        setErroLocal(resultado.erro);
      }
    } catch {
      if (!montadoRef.current) return;
      setOcultosOtimista(anterior);
      setErroLocal('Não foi possível salvar o filtro de visão.');
    } finally {
      gravandoRef.current = false;
      if (montadoRef.current) {
        setGravandoLocal(false);
      }
    }
  };

  const alternarCentro = (id) => {
    if (emSalvamento || gravandoRef.current) return;
    const proximo = new Set(ocultosOtimista);
    if (proximo.has(id)) {
      proximo.delete(id);
    } else {
      proximo.add(id);
    }
    enviar(Array.from(proximo));
  };

  const soOsDe = (professor) => {
    if (emSalvamento || gravandoRef.current) return;
    const proximo = todos
      .filter((c) => !Array.isArray(c.responsaveis) || !c.responsaveis.includes(professor))
      .map((c) => c.id);
    enviar(proximo);
  };

  return (
    <div class="barra-topo__filtro-ancora" ref={ancoraRef}>
      <button
        ref={gatilhoRef}
        type="button"
        class={`chip barra-topo__filtro${temFiltroAtivo ? ' chip--ativo' : ''}`}
        aria-label={`Filtro de visão: ${textoFiltro}`}
        aria-expanded={aberto ? 'true' : 'false'}
        aria-controls={aberto ? painelId : undefined}
        onClick={() => setAberto((v) => !v)}
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
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        ancoraRef={ancoraRef}
        gatilhoRef={gatilhoRef}
        ariaLabel="Filtro de visão"
        className="filtro-visao__menu"
      >
        <div id={painelId} class="filtro-visao">
          <div class="filtro-visao__topo">
            <span class="filtro-visao__titulo">Centros visíveis</span>
            <button
              type="button"
              class="filtro-visao__acao"
              aria-disabled={emSalvamento ? 'true' : undefined}
              onClick={() => enviar([])}
            >
              Mostrar todos
            </button>
          </div>

          <MenuSuspensoSeparador />

          {mensagemErro && (
            <div class="filtro-visao__erro">
              <AvisoFalha
                mensagem={mensagemErro}
                aoTentarNovamente={
                  ultimaTentativaRef.current
                    ? () => enviar(ultimaTentativaRef.current)
                    : null
                }
              />
            </div>
          )}

          {total === 0 ? (
            <p class="filtro-visao__vazio">Nenhum centro disponível.</p>
          ) : (
            <div class="filtro-visao__grupos">
              {grupos.map((grupo) => (
                <section key={grupo.chave} class="filtro-visao__grupo">
                  <div class="filtro-visao__grupo-cabecalho">
                    <span class="filtro-visao__grupo-nome">{grupo.rotulo}</span>
                    {grupo.ehProfessor && (
                      <button
                        type="button"
                        class="filtro-visao__acao"
                        aria-label={`Mostrar só os centros de ${grupo.rotulo}`}
                        aria-disabled={emSalvamento ? 'true' : undefined}
                        onClick={() => soOsDe(grupo.rotulo)}
                      >
                        Só estes
                      </button>
                    )}
                  </div>

                  <ul class="filtro-visao__lista">
                    {grupo.centros.map((centro) => {
                      const visivel = !ocultosOtimista.has(centro.id);
                      return (
                        <li key={centro.id}>
                          <label class="filtro-visao__opcao">
                            <input
                              type="checkbox"
                              class="filtro-visao__caixa"
                              checked={visivel}
                              aria-disabled={emSalvamento ? 'true' : undefined}
                              onClick={(e) => {
                                if (emSalvamento || gravandoRef.current) {
                                  e.preventDefault();
                                }
                              }}
                              onChange={() => alternarCentro(centro.id)}
                            />
                            <span class="filtro-visao__centro-nome">{centro.name}</span>
                            <span class="filtro-visao__centro-codigo">{centro.code}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </MenuSuspenso>
    </div>
  );
}
