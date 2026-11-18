import { useEffect, useState } from 'preact/hooks';
import {
  AvisoFalha,
  CabecalhoPagina,
  Chip,
  Esqueleto,
  LinhaDeLista,
  Lista,
  Situacao,
  Valor,
  Vazio,
} from '../componentes/index.js';
import { ehCliqueNavegacaoSimples, urlProjeto } from '../roteador.js';
import { dinheiroCompacto } from '../util/formato.js';
import './Projetos.css';

const ORDEM_SITUACOES = [
  { valor: 'em dia', rotulo: 'Em dia' },
  { valor: 'atenção', rotulo: 'Atenção' },
  { valor: 'problema', rotulo: 'Problema' },
  { valor: 'sem balancete', rotulo: 'Sem balancete' },
  { valor: 'sem plano', rotulo: 'Sem plano' },
  { valor: 'sem dado', rotulo: 'Sem dado' },
];

function situacaoCentro(centro) {
  if (centro?.erro === 'falha_saldo_livre') return 'sem dado';
  const bruta = String(centro?.situacao || 'sem dado').trim().toLowerCase();
  if (bruta === 'atencao') return 'atenção';
  return bruta;
}

function temNumeroLivre(centro) {
  if (!centro || centro.erro === 'falha_saldo_livre') return false;
  if (centro.livre === null || centro.livre === undefined || centro.livre === '') return false;
  return Number.isFinite(Number(centro.livre));
}

function montarContexto(centros, ocultos) {
  const totalCentros = centros.length + ocultos;
  const partes = [`${totalCentros} ${totalCentros === 1 ? 'centro' : 'centros'}`];
  let soma = 0;
  let comNumero = 0;
  let semNumero = 0;

  for (const centro of centros) {
    if (temNumeroLivre(centro)) {
      soma += Number(centro.livre);
      comNumero += 1;
    } else {
      semNumero += 1;
    }
  }

  if (comNumero > 0) {
    partes.push(`${dinheiroCompacto(soma)} livres no total`);
  }
  if (semNumero > 0) {
    partes.push(`${semNumero} ${semNumero === 1 ? 'centro sem número' : 'centros sem número'}`);
  }
  if (ocultos > 0) {
    partes.push(`${ocultos} ${ocultos === 1 ? 'centro oculto' : 'centros ocultos'}`);
  }

  return partes.join(' · ');
}

/**
 * Tela inicial `Projetos`: lista alfabética dos centros de custo visíveis,
 * total no cabeçalho e filtro rápido por situação.
 */
export function Projetos({
  carregando = false,
  erro = null,
  resumo = null,
  isAdmin = false,
  onRecarregar = null,
  onMostrarTodos = null,
  onNavegar = null,
}) {
  const [filtroSituacao, setFiltroSituacao] = useState('todas');
  const [mostrandoTodos, setMostrandoTodos] = useState(false);
  const [erroMostrarTodos, setErroMostrarTodos] = useState(null);

  const temResumo = Boolean(resumo && Array.isArray(resumo.centros));
  const centrosBrutos = temResumo ? resumo.centros : [];
  const ocultos = Number(resumo?.ocultos || 0);

  useEffect(() => {
    if (centrosBrutos.length > 0) {
      setErroMostrarTodos(null);
    }
  }, [centrosBrutos.length]);

  const centrosOrdenados = [...centrosBrutos].sort((a, b) => {
    const compNome = String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR', {
      sensitivity: 'base',
    });
    if (compNome !== 0) return compNome;
    return String(a?.code || '').localeCompare(String(b?.code || ''), 'pt-BR');
  });

  const situacoesPresentes = new Set(centrosOrdenados.map(situacaoCentro));
  const situacaoAtiva = filtroSituacao === 'todas' || situacoesPresentes.has(filtroSituacao)
    ? filtroSituacao
    : 'todas';

  const chips = ORDEM_SITUACOES.filter((item) => situacoesPresentes.has(item.valor));
  const centrosFiltrados = situacaoAtiva === 'todas'
    ? centrosOrdenados
    : centrosOrdenados.filter((c) => situacaoCentro(c) === situacaoAtiva);

  const contexto = temResumo && !erro
    ? montarContexto(centrosOrdenados, ocultos)
    : null;

  const lidarMostrarTodos = async () => {
    if (!onMostrarTodos || mostrandoTodos) return;
    setMostrandoTodos(true);
    setErroMostrarTodos(null);
    try {
      const res = await onMostrarTodos();
      if (res?.erro) {
        setErroMostrarTodos(res.erro);
      }
    } catch {
      setErroMostrarTodos('Não foi possível mostrar os centros ocultos.');
    } finally {
      setMostrandoTodos(false);
    }
  };

  return (
    <div class="conteudo">
      <CabecalhoPagina titulo="Projetos" contexto={contexto} />

      {carregando && !temResumo ? (
        <Esqueleto variante="linha" linhas={6} rotulo="Carregando centros de custo" />
      ) : erro ? (
        <AvisoFalha mensagem={erro} aoTentarNovamente={onRecarregar} />
      ) : centrosOrdenados.length === 0 ? (
        <>
          {erroMostrarTodos && (
            <AvisoFalha mensagem={erroMostrarTodos} aoTentarNovamente={lidarMostrarTodos} />
          )}
          <Vazio
            mensagem="Nenhum centro para mostrar."
            rotuloBotao={ocultos > 0 && isAdmin && onMostrarTodos ? 'Mostrar todos' : ''}
            aoClicar={ocultos > 0 && isAdmin && onMostrarTodos ? lidarMostrarTodos : null}
          />
        </>
      ) : (
        <>
          {chips.length > 0 && (
            <div class="projetos__chips" role="group" aria-label="Filtrar por situação">
              <Chip
                ativo={situacaoAtiva === 'todas'}
                onClick={() => setFiltroSituacao('todas')}
              >
                Todas
              </Chip>
              {chips.map((item) => (
                <Chip
                  key={item.valor}
                  ativo={situacaoAtiva === item.valor}
                  onClick={() => setFiltroSituacao(item.valor)}
                >
                  {item.rotulo}
                </Chip>
              ))}
            </div>
          )}

          <Lista ariaLabel="Centros de custo">
            {centrosFiltrados.map((centro) => {
              const situacao = situacaoCentro(centro);
              const ehFalha = centro.erro === 'falha_saldo_livre';
              const mostrarValor = temNumeroLivre(centro);
              const destino = urlProjeto(centro.id);

              return (
                <LinhaDeLista
                  key={centro.id}
                  href={destino}
                  onClick={
                    onNavegar
                      ? (e) => {
                          if (!ehCliqueNavegacaoSimples(e)) return;
                          e.preventDefault();
                          onNavegar(destino);
                        }
                      : undefined
                  }
                >
                  <span class="projetos__nome-bloco">
                    <span class="projetos__nome">{centro.name}</span>
                    {ehFalha && (
                      <span class="projetos__erro-centro">
                        Não foi possível calcular o saldo deste centro
                      </span>
                    )}
                  </span>
                  <span class="projetos__codigo">{centro.code}</span>
                  <span class="projetos__saldo">
                    {mostrarValor ? (
                      <>
                        <Valor
                          valor={centro.livre}
                          centavos={false}
                          problema={situacao === 'problema'}
                        />{' '}
                        livres
                        {centro.end_date ? (
                          <>
                            {' '}
                            até <Valor valor={centro.end_date} tipo="data" />
                          </>
                        ) : null}
                      </>
                    ) : (
                      <Valor
                        valor={null}
                        motivoSemDado={
                          ehFalha
                            ? 'Não foi possível calcular o saldo deste centro'
                            : situacao
                        }
                      />
                    )}
                  </span>
                  <Situacao estado={situacao} className="projetos__situacao" />
                </LinhaDeLista>
              );
            })}
          </Lista>
        </>
      )}
    </div>
  );
}
