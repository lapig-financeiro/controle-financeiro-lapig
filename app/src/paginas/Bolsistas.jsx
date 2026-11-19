import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, Plus, Trash2 } from 'lucide-preact';
import {
  AvisoFalha,
  Botao,
  CabecalhoPagina,
  Campo,
  Chip,
  Esqueleto,
  Seletor,
  Valor,
  Vazio,
} from '../componentes/index.js';
import {
  apagarCaixaPedido,
  colocarNaCaixa,
  pedidoBolsas,
  salvarCaixaPedido,
  salvarEquipeBolsista,
  tirarDaCaixa,
} from '../servicos/dados.js';
import { dataCompacta, dinheiro, hojeISO } from '../util/formato.js';
import './Bolsistas.css';

const EQUIPES = [
  { valor: 'pastagem', rotulo: 'Pastagem' },
  { valor: 'sem', rotulo: 'Sem equipe' },
  { valor: 'alertas', rotulo: 'Alertas' },
  { valor: 'solos', rotulo: 'Solos' },
];

const FILTROS_PADRAO = {
  centros: null,
  equipes: ['pastagem', 'sem'],
  situacao: 'vigente',
  data: '',
  busca: '',
};

function chaveFiltros(usuarioId) {
  return `cf_bolsistas_filtros_${usuarioId || 'local'}`;
}

function lerFiltros(usuarioId) {
  if (typeof window === 'undefined' || !window.localStorage) return { ...FILTROS_PADRAO };
  try {
    const bruto = JSON.parse(window.localStorage.getItem(chaveFiltros(usuarioId)) || 'null');
    if (!bruto || typeof bruto !== 'object') return { ...FILTROS_PADRAO };
    const equipes = Array.isArray(bruto.equipes)
      ? bruto.equipes.filter((e) => EQUIPES.some((item) => item.valor === e))
      : FILTROS_PADRAO.equipes;
    return {
      centros: Array.isArray(bruto.centros) ? bruto.centros.filter((id) => typeof id === 'string') : null,
      equipes,
      situacao: bruto.situacao === 'termina' ? 'termina' : 'vigente',
      data: typeof bruto.data === 'string' ? bruto.data : '',
      busca: typeof bruto.busca === 'string' ? bruto.busca : '',
    };
  } catch {
    return { ...FILTROS_PADRAO };
  }
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function rotuloEquipe(equipe) {
  const item = EQUIPES.find((e) => e.valor === (equipe ?? 'sem'));
  return item ? item.rotulo : 'Sem equipe';
}

function equipeDaPessoa(pessoa) {
  return pessoa.equipe ?? 'sem';
}

function bolsaTexto(bolsa) {
  return `${bolsa.code} · ${dinheiro(bolsa.valor, { centavos: false })}/mês · até ${dataCompacta(bolsa.fim)}`;
}

function CaixaPedido({
  caixa,
  pessoasPorId,
  emAcao,
  onSalvarCaixa,
  onApagarCaixa,
  onTirar,
  onSalvarItem,
}) {
  const [nome, setNome] = useState(caixa.nome);
  const [meses, setMeses] = useState(String(caixa.meses));
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    setNome(caixa.nome);
    setMeses(String(caixa.meses));
  }, [caixa.nome, caixa.meses]);

  const mesesNumero = Number(meses);
  const mesesValidos = Number.isInteger(mesesNumero) && mesesNumero >= 1 && mesesNumero <= 60;
  const podeSalvar = nome.trim().length > 0 && nome.trim().length <= 80 && mesesValidos;

  return (
    <section class="bolsistas__caixa" data-caixa-id={caixa.id} aria-label={`Caixa ${caixa.nome}`}>
      <div class="bolsistas__caixa-edicao">
        <Campo
          rotulo="Nome da caixa"
          valor={nome}
          aoMudar={setNome}
          desabilitado={emAcao}
          className="bolsistas__caixa-nome"
        />
        <Campo
          rotulo="Meses"
          tipo="number"
          valor={meses}
          aoMudar={setMeses}
          min={1}
          max={60}
          desabilitado={emAcao}
          className="bolsistas__caixa-meses"
        />
        <Botao
          variante="secundario"
          tamanho="compacto"
          onClick={() => onSalvarCaixa(caixa.id, nome, mesesNumero)}
          desabilitado={emAcao || !podeSalvar}
        >
          Salvar
        </Botao>
      </div>

      <p class="bolsistas__caixa-resumo">
        <strong>{caixa.pessoas}</strong> {caixa.pessoas === 1 ? 'pessoa' : 'pessoas'} ·{' '}
        {dinheiro(caixa.total_mensal, { centavos: false })} por mês ·{' '}
        {dinheiro(caixa.total_periodo, { centavos: false })} em {caixa.meses} meses
      </p>
      {caixa.itens_ocultos > 0 && (
        <p class="bolsistas__caixa-ocultos">
          {caixa.itens_ocultos}{' '}
          {caixa.itens_ocultos === 1 ? 'pessoa saiu da lista' : 'pessoas saíram da lista'} e não
          entra{caixa.itens_ocultos === 1 ? '' : 'm'} nesta conta.
        </p>
      )}

      <div class="bolsistas__caixa-itens">
        {caixa.itens.length === 0 ? (
          <p class="bolsistas__caixa-vazia">Ninguém nesta caixa ainda.</p>
        ) : (
          caixa.itens.map((item) => {
            const pessoa = pessoasPorId.get(item.holder_id);
            return (
              <ItemDaCaixa
                key={item.holder_id}
                caixaId={caixa.id}
                item={item}
                nome={pessoa?.nome || 'Pessoa fora da lista'}
                emAcao={emAcao}
                onTirar={onTirar}
                onSalvarItem={onSalvarItem}
              />
            );
          })
        )}
      </div>

      <div class="bolsistas__caixa-acoes">
        {!confirmando ? (
          <Botao
            variante="fantasma"
            tamanho="compacto"
            icone={Trash2}
            onClick={() => setConfirmando(true)}
            desabilitado={emAcao}
          >
            Apagar caixa
          </Botao>
        ) : (
          <div class="bolsistas__confirmacao" role="group" aria-label="Confirmar exclusão da caixa">
            <span>Apagar esta caixa e as pessoas dela?</span>
            <Botao
              variante="secundario"
              tamanho="compacto"
              onClick={() => onApagarCaixa(caixa.id)}
              desabilitado={emAcao}
            >
              Sim, apagar
            </Botao>
            <Botao
              variante="fantasma"
              tamanho="compacto"
              onClick={() => setConfirmando(false)}
              desabilitado={emAcao}
            >
              Cancelar
            </Botao>
          </div>
        )}
      </div>
    </section>
  );
}

function ItemDaCaixa({ caixaId, item, nome, emAcao, onTirar, onSalvarItem }) {
  const [valor, setValor] = useState(item.valor_mensal === null ? '' : String(item.valor_mensal));
  const [nota, setNota] = useState(item.nota || '');
  const [erro, setErro] = useState('');

  useEffect(() => {
    setValor(item.valor_mensal === null ? '' : String(item.valor_mensal));
    setNota(item.nota || '');
  }, [item.valor_mensal, item.nota]);

  const salvar = () => {
    const texto = valor.trim();
    const numero = texto === ''
      ? null
      : Number(texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto);
    if (numero !== null && (!Number.isFinite(numero) || numero <= 0)) {
      setErro('Informe um valor positivo ou deixe vazio para usar o atual.');
      return;
    }
    setErro('');
    onSalvarItem(caixaId, item.holder_id, numero, nota);
  };

  return (
    <div class="bolsistas__item" data-holder-id={item.holder_id}>
      <div class="bolsistas__item-topo">
        <span class="bolsistas__item-nome">{nome}</span>
        <span class="bolsistas__item-usado">
          usa {dinheiro(item.valor_usado, { centavos: false })}/mês
        </span>
        <Botao
          variante="fantasma"
          tamanho="compacto"
          onClick={() => onTirar(caixaId, item.holder_id)}
          desabilitado={emAcao}
          aria-label={`Tirar ${nome} da caixa`}
        >
          Tirar
        </Botao>
      </div>
      <div class="bolsistas__item-campos">
        <Campo
          rotulo="Valor no pedido"
          valor={valor}
          aoMudar={setValor}
          placeholder={dinheiro(item.valor_usado, { centavos: false })}
          ajuda="Vazio = valor atual"
          desabilitado={emAcao}
          inputMode="decimal"
        />
        <Campo
          rotulo="Nota curta"
          valor={nota}
          aoMudar={setNota}
          maxLength={300}
          desabilitado={emAcao}
        />
        <Botao
          variante="secundario"
          tamanho="compacto"
          onClick={salvar}
          desabilitado={emAcao}
        >
          Salvar pessoa
        </Botao>
      </div>
      {erro && <p class="bolsistas__item-erro">{erro}</p>}
    </div>
  );
}

export function Bolsistas({ usuarioId = null }) {
  const [st, setSt] = useState({ carregando: true, dados: null, erro: null });
  const [erroAcao, setErroAcao] = useState(null);
  const [filtros, setFiltros] = useState(() => lerFiltros(usuarioId));
  const [mostrarNovaCaixa, setMostrarNovaCaixa] = useState(false);
  const [novaCaixa, setNovaCaixa] = useState({ nome: '', meses: '12' });
  const [emAcao, setEmAcao] = useState(false);
  const montadoRef = useRef(true);
  const geracaoRef = useRef(0);
  const acaoRef = useRef(false);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      geracaoRef.current += 1;
    };
  }, []);

  const carregar = async () => {
    const geracao = ++geracaoRef.current;
    setSt((anterior) => ({ ...anterior, carregando: true, erro: null }));
    const res = await pedidoBolsas();
    if (!montadoRef.current || geracao !== geracaoRef.current) return;
    if (res.erro) {
      setSt((anterior) => ({ carregando: false, dados: anterior.dados, erro: res.erro }));
      return;
    }
    setSt({ carregando: false, dados: res.dados, erro: null });
  };

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(chaveFiltros(usuarioId), JSON.stringify(filtros));
    } catch {
      /* localStorage pode estar indisponível; o filtro continua valendo na sessão */
    }
  }, [filtros, usuarioId]);

  const executar = async (acao) => {
    if (acaoRef.current) return false;
    acaoRef.current = true;
    setEmAcao(true);
    setErroAcao(null);
    try {
      const res = await acao();
      if (res?.erro) {
        setErroAcao(res.erro);
        return false;
      }
      await carregar();
      return true;
    } catch {
      setErroAcao('Não foi possível concluir a ação.');
      return false;
    } finally {
      acaoRef.current = false;
      if (montadoRef.current) setEmAcao(false);
    }
  };

  const dados = st.dados;
  const centros = dados?.centros || [];
  const marcados = useMemo(() => {
    const ids = centros.map((c) => c.id);
    if (filtros.centros === null) return new Set(ids);
    return new Set(filtros.centros.filter((id) => ids.includes(id)));
  }, [centros, filtros.centros]);

  const equipesSelecionadas = useMemo(() => new Set(filtros.equipes), [filtros.equipes]);
  const hoje = hojeISO();

  const pessoasPorId = useMemo(() => {
    const mapa = new Map();
    for (const pessoa of dados?.bolsistas || []) mapa.set(pessoa.holder_id, pessoa);
    return mapa;
  }, [dados]);

  const pessoasFiltradas = useMemo(() => {
    const busca = normalizarTexto(filtros.busca);
    return (dados?.bolsistas || []).filter((pessoa) => {
      if (!equipesSelecionadas.has(equipeDaPessoa(pessoa))) return false;
      if (busca && !normalizarTexto(pessoa.nome).includes(busca)) return false;

      const bolsas = pessoa.bolsas.filter((b) => marcados.has(b.project_id));
      if (bolsas.length === 0) return false;

      if (filtros.situacao === 'vigente') {
        return bolsas.some((b) => b.vigente_hoje);
      }
      if (filtros.situacao === 'termina' && filtros.data) {
        return bolsas.some(
          (b) => b.status !== 'cancelled' && b.fim >= hoje && b.fim <= filtros.data
        );
      }
      return bolsas.some((b) => b.status !== 'cancelled');
    });
  }, [dados, equipesSelecionadas, marcados, filtros.busca, filtros.situacao, filtros.data, hoje]);

  const caixaDaPessoa = (holderId) =>
    (dados?.caixas || []).find((caixa) =>
      caixa.itens.some((item) => item.holder_id === holderId)
    ) || null;

  const alternarCentro = (centroId) => {
    const proximos = new Set(marcados);
    if (proximos.has(centroId)) proximos.delete(centroId);
    else proximos.add(centroId);
    setFiltros((anterior) => ({ ...anterior, centros: Array.from(proximos) }));
  };

  const alternarEquipe = (equipe) => {
    setFiltros((anterior) => {
      const atuais = new Set(anterior.equipes);
      if (atuais.has(equipe)) atuais.delete(equipe);
      else atuais.add(equipe);
      return { ...anterior, equipes: Array.from(atuais) };
    });
  };

  const escolherEquipe = (pessoa, equipe) => {
    const alvo = equipe === 'sem' ? null : equipe;
    if (equipeDaPessoa(pessoa) === equipe) return;
    executar(() => salvarEquipeBolsista(pessoa.holder_id, alvo));
  };

  const salvarCaixa = (id, nome, meses) => {
    executar(() => salvarCaixaPedido({ id, nome, meses }));
  };

  const criarCaixa = (evento) => {
    evento.preventDefault();
    const meses = Number(novaCaixa.meses);
    if (!novaCaixa.nome.trim()) {
      setErroAcao('Informe o nome da caixa.');
      return;
    }
    executar(() => salvarCaixaPedido({ nome: novaCaixa.nome, meses })).then((ok) => {
      if (ok) {
        setNovaCaixa({ nome: '', meses: '12' });
        setMostrarNovaCaixa(false);
      }
    });
  };

  const contexto = dados
    ? `${dados.bolsistas.length} ${
        dados.bolsistas.length === 1 ? 'pessoa' : 'pessoas'
      } · ${dados.centros.length} ${dados.centros.length === 1 ? 'centro' : 'centros'}`
    : null;

  return (
    <div class="conteudo bolsistas">
      <CabecalhoPagina
        titulo="Bolsistas"
        contexto="Monte o pedido de bolsas: filtre e coloque as pessoas nas caixas"
      />
      {contexto && <p class="bolsistas__contexto">{contexto}</p>}

      {st.erro && <AvisoFalha mensagem={st.erro} aoTentarNovamente={carregar} />}
      {erroAcao && <AvisoFalha mensagem={erroAcao} />}

      {!dados && st.carregando && (
        <div class="bolsistas__carregando">
          <Esqueleto variante="cartao" linhas={4} rotulo="Carregando o pedido de bolsas" />
          <Esqueleto variante="cartao" linhas={3} rotulo="Carregando as caixas" />
        </div>
      )}

      {!dados && !st.carregando && st.erro && (
        <p class="bolsistas__indisponivel">
          Totais do pedido:{' '}
          <Valor
            valor={null}
            motivoSemDado="indisponível"
            semOrigem="Totais do pedido indisponíveis"
          />
        </p>
      )}

      {dados && (
        <div class="bolsistas__layout">
          <section class="bolsistas__lista" aria-label="Bolsistas">
            <div class="bolsistas__filtros">
              <fieldset class="bolsistas__filtro">
                <legend class="bolsistas__filtro-titulo">Centros</legend>
                <div class="bolsistas__filtro-centros">
                  {centros.map((centro) => (
                    <label key={centro.id} class="bolsistas__centro">
                      <input
                        type="checkbox"
                        class="bolsistas__filtro-centro"
                        value={centro.id}
                        checked={marcados.has(centro.id)}
                        onChange={() => alternarCentro(centro.id)}
                      />
                      <span>
                        {centro.code} · {centro.name}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset class="bolsistas__filtro">
                <legend class="bolsistas__filtro-titulo">Equipe</legend>
                <div class="bolsistas__filtro-chips" role="group" aria-label="Filtrar por equipe">
                  {EQUIPES.map((equipe) => (
                    <Chip
                      key={equipe.valor}
                      ativo={equipesSelecionadas.has(equipe.valor)}
                      onClick={() => alternarEquipe(equipe.valor)}
                    >
                      {equipe.rotulo}
                    </Chip>
                  ))}
                </div>
              </fieldset>

              <div class="bolsistas__filtro bolsistas__filtro-situacao">
                <Seletor
                  rotulo="Situação"
                  valor={filtros.situacao}
                  aoMudar={(valor) =>
                    setFiltros((anterior) => ({ ...anterior, situacao: valor }))
                  }
                  opcoes={[
                    { valor: 'vigente', rotulo: 'Vigente hoje' },
                    { valor: 'termina', rotulo: 'Termina até' },
                  ]}
                />
                {filtros.situacao === 'termina' && (
                  <Campo
                    rotulo="Termina até"
                    tipo="date"
                    valor={filtros.data}
                    aoMudar={(valor) =>
                      setFiltros((anterior) => ({ ...anterior, data: valor }))
                    }
                  />
                )}
              </div>

              <Campo
                rotulo="Buscar por nome"
                tipo="search"
                valor={filtros.busca}
                aoMudar={(valor) => setFiltros((anterior) => ({ ...anterior, busca: valor }))}
                placeholder="Nome da pessoa"
                className="bolsistas__busca"
              />

              <p class="bolsistas__contador" role="status">
                {pessoasFiltradas.length}{' '}
                {pessoasFiltradas.length === 1 ? 'pessoa na lista' : 'pessoas na lista'}
              </p>
            </div>

            {pessoasFiltradas.length === 0 ? (
              <Vazio mensagem="Nenhuma pessoa com esses filtros." />
            ) : (
              <ul class="bolsistas__pessoas" aria-label="Pessoas do pedido">
                {pessoasFiltradas.map((pessoa) => {
                  const equipe = equipeDaPessoa(pessoa);
                  const caixaAtual = caixaDaPessoa(pessoa.holder_id);
                  const bolsasVisiveis = pessoa.bolsas.filter((b) => marcados.has(b.project_id));
                  return (
                    <li
                      key={pessoa.holder_id}
                      class="bolsistas__pessoa"
                      data-holder-id={pessoa.holder_id}
                    >
                      <div class="bolsistas__pessoa-topo">
                        <span class="bolsistas__pessoa-nome">{pessoa.nome}</span>
                        <details class="bolsistas__equipe">
                          <summary
                            class="chip bolsistas__equipe-chip"
                            aria-label={`Equipe de ${pessoa.nome}: ${rotuloEquipe(pessoa.equipe)}`}
                          >
                            {rotuloEquipe(pessoa.equipe)}
                          </summary>
                          <div
                            class="bolsistas__equipe-opcoes"
                            role="group"
                            aria-label={`Escolher equipe de ${pessoa.nome}`}
                          >
                            {EQUIPES.map((opcao) => (
                              <button
                                key={opcao.valor}
                                type="button"
                                class="bolsistas__equipe-opcao"
                                aria-pressed={equipe === opcao.valor ? 'true' : 'false'}
                                onClick={(evento) => {
                                  const detalhes = evento.currentTarget.closest('details');
                                  if (detalhes) detalhes.open = false;
                                  escolherEquipe(pessoa, opcao.valor);
                                }}
                              >
                                {equipe === opcao.valor && <Check size={16} strokeWidth={1.75} aria-hidden="true" />}
                                {opcao.rotulo}
                              </button>
                            ))}
                          </div>
                        </details>
                      </div>

                      <div class="bolsistas__bolsas">
                        {bolsasVisiveis.map((bolsa) => (
                          <span
                            key={bolsa.scholarship_id}
                            class={`bolsistas__bolsa${
                              bolsa.vigente_hoje ? '' : ' bolsistas__bolsa--apagada'
                            }`}
                            title={bolsa.vigente_hoje ? 'Vigente hoje' : 'Não vigente hoje'}
                          >
                            {bolsaTexto(bolsa)}
                          </span>
                        ))}
                      </div>

                      <div class="bolsistas__pessoa-rodape">
                        <span class="bolsistas__pessoa-valor">
                          vigente hoje: <strong>{dinheiro(pessoa.valor_vigente, { centavos: false })}</strong>/mês
                        </span>
                        <div class="bolsistas__pessoa-acoes">
                          {dados.caixas.length === 0 ? (
                            <span class="bolsistas__sem-caixa">Crie uma caixa para colocar as pessoas.</span>
                          ) : (
                            dados.caixas.map((caixa) => {
                              const esta = caixaAtual?.id === caixa.id;
                              return (
                                <Botao
                                  key={caixa.id}
                                  variante={esta ? 'primario' : 'secundario'}
                                  tamanho="compacto"
                                  className="bolsistas__botao-colocar"
                                  data-caixa-id={caixa.id}
                                  data-holder-id={pessoa.holder_id}
                                  onClick={() =>
                                    executar(() =>
                                      colocarNaCaixa(caixa.id, pessoa.holder_id, null, null)
                                    )
                                  }
                                  desabilitado={emAcao}
                                >
                                  {esta ? `Em ${caixa.nome}` : `Pôr em ${caixa.nome}`}
                                </Botao>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside class="bolsistas__caixas" aria-label="Caixas do pedido">
            <div class="bolsistas__caixas-topo">
              <h2 class="bolsistas__caixas-titulo">Caixas</h2>
              <Botao
                variante="primario"
                tamanho="compacto"
                icone={Plus}
                onClick={() => setMostrarNovaCaixa((v) => !v)}
                desabilitado={emAcao}
              >
                Nova caixa
              </Botao>
            </div>

            {mostrarNovaCaixa && (
              <form class="bolsistas__nova-caixa" onSubmit={criarCaixa}>
                <Campo
                  rotulo="Nome"
                  valor={novaCaixa.nome}
                  aoMudar={(nome) => setNovaCaixa((anterior) => ({ ...anterior, nome }))}
                  placeholder="Time Pastagem"
                  maxLength={80}
                />
                <Campo
                  rotulo="Meses"
                  tipo="number"
                  valor={novaCaixa.meses}
                  aoMudar={(meses) => setNovaCaixa((anterior) => ({ ...anterior, meses }))}
                  min={1}
                  max={60}
                />
                <div class="bolsistas__nova-caixa-acoes">
                  <Botao variante="primario" tamanho="compacto" tipo="submit" desabilitado={emAcao}>
                    Criar caixa
                  </Botao>
                  <Botao
                    variante="fantasma"
                    tamanho="compacto"
                    onClick={() => setMostrarNovaCaixa(false)}
                    desabilitado={emAcao}
                  >
                    Cancelar
                  </Botao>
                </div>
              </form>
            )}

            {dados.caixas.length === 0 ? (
              <Vazio mensagem="Nenhuma caixa ainda. Crie a primeira para montar o time." />
            ) : (
              dados.caixas.map((caixa) => (
                <CaixaPedido
                  key={caixa.id}
                  caixa={caixa}
                  pessoasPorId={pessoasPorId}
                  emAcao={emAcao}
                  onSalvarCaixa={(id, nome, meses) => salvarCaixa(id, nome, meses)}
                  onApagarCaixa={(id) => executar(() => apagarCaixaPedido(id))}
                  onTirar={(caixaId, holderId) => executar(() => tirarDaCaixa(caixaId, holderId))}
                  onSalvarItem={(caixaId, holderId, valor, nota) =>
                    executar(() => colocarNaCaixa(caixaId, holderId, valor, nota))
                  }
                />
              ))
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
