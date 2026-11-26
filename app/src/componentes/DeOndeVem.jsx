import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { ChevronDown, ChevronRight } from 'lucide-preact';
import { arquivoDeOrigem, origem as buscarOrigemPadrao } from '../servicos/dados.js';
import { dataCompacta, dinheiro } from '../util/formato.js';
import { AvisoFalha } from './AvisoFalha.jsx';
import { Destaque } from './Destaque.jsx';
import { Documento } from './Documento.jsx';
import { Esqueleto } from './Esqueleto.jsx';
import { Valor } from './Valor.jsx';
import { Vazio } from './Vazio.jsx';
import './DeOndeVem.css';

function paraCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Confere se todos os nós `calculo` com partes fecham ao centavo (`Σ sinal × filho.valor === valor`)
 * e se a raiz bate com `valorEsperado` (quando passado, inclusive `null`).
 * Devolve as falhas e todos os ancestrais que devem abrir.
 */
export function verificarFechamentoArvore(raiz, valorEsperado = undefined) {
  const falhas = new Map();
  const caminhosAbrir = new Set();

  if (!raiz || typeof raiz !== 'object') {
    return { falhas, caminhosAbrir };
  }

  function visitar(no, caminho, ancestrais) {
    if (!no || typeof no !== 'object') return;
    const partes = Array.isArray(no.partes) ? no.partes : [];
    const valorCent = paraCentavos(no.valor);

    if (no.tipo === 'calculo' && partes.length > 0 && valorCent !== null) {
      let somaCent = 0;
      let invalido = false;
      for (const filho of partes) {
        const filhoCent = paraCentavos(filho?.valor);
        if (filhoCent === null) {
          invalido = true;
          break;
        }
        const sinal = filho?.sinal === -1 ? -1 : 1;
        somaCent += sinal * filhoCent;
      }

      if (invalido || somaCent !== valorCent) {
        const rotulo = typeof no.rotulo === 'string' && no.rotulo ? no.rotulo : 'este item';
        const mensagem = invalido
          ? `Não foi possível fechar "${rotulo}" porque há parte sem valor válido.`
          : `A soma das partes (${dinheiro(somaCent / 100, { centavos: true })}) difere do valor exibido (${dinheiro(valorCent / 100, { centavos: true })}).`;
        falhas.set(caminho, mensagem);
        caminhosAbrir.add(caminho);
        for (const anc of ancestrais) caminhosAbrir.add(anc);
      }
    }

    partes.forEach((filho, idx) => {
      visitar(filho, `${caminho}/${idx}`, [...ancestrais, caminho]);
    });
  }

  visitar(raiz, '0', []);

  const raizCent = paraCentavos(raiz.valor);
  if (valorEsperado !== undefined && raizCent !== null) {
    const esperadoCent = paraCentavos(valorEsperado);
    if (esperadoCent === null) {
      const msgDivergencia = `O total da árvore (${dinheiro(raizCent / 100, { centavos: true })}) difere do painel, que não tem valor disponível.`;
      const anterior = falhas.get('0');
      falhas.set('0', anterior ? `${anterior} ${msgDivergencia}` : msgDivergencia);
      caminhosAbrir.add('0');
    } else if (esperadoCent !== raizCent) {
      const msgDivergencia = `O total da árvore (${dinheiro(raizCent / 100, { centavos: true })}) difere do valor do painel (${dinheiro(esperadoCent / 100, { centavos: true })}).`;
      const anterior = falhas.get('0');
      falhas.set('0', anterior ? `${anterior} ${msgDivergencia}` : msgDivergencia);
      caminhosAbrir.add('0');
    }
  }

  return { falhas, caminhosAbrir };
}

function textoFolha(no, estadoFolha) {
  if (no?.tipo === 'digitado') {
    return 'valor digitado, sem documento';
  }
  if (no?.tipo === 'legado') {
    if (estadoFolha?.buscaTexto) return estadoFolha.buscaTexto;
    if (estadoFolha?.semArquivo || !no?.ref) return 'anterior à rastreabilidade, sem arquivo';
    return 'anterior à rastreabilidade: a linha é procurada ao abrir';
  }
  return '';
}

function ehNoRaizOuGrupo(no, nivel) {
  if (nivel === 0) return true;
  const chave = String(no?.chave || '');
  return chave === 'livre' || chave.startsWith('grupo:');
}

/**
 * Árvore explicativa dentro do `PainelLateral`:
 * primeiro nível aberto, nós recolhíveis, autoabertura de ancestrais com falha de fechamento
 * e abertura do `Documento` quando a folha devolve um arquivo.
 */
export function DeOndeVem({
  arvore = null,
  valorEsperado = undefined,
  carregando = false,
  erro = null,
  aoTentarNovamente = null,
  buscarOrigem = buscarOrigemPadrao,
  carregarArquivo = arquivoDeOrigem,
  carregadorPdf = undefined,
  carregadorMammoth = undefined,
}) {
  const baseId = useId();
  const [abertos, setAbertos] = useState({});
  const [estadoFolhas, setEstadoFolhas] = useState({});
  const [docAberto, setDocAberto] = useState(null);

  const montadoRef = useRef(true);
  const arvoreGenRef = useRef(0);
  const genPorCaminhoRef = useRef(new Map());
  const ultimoCliqueDocRef = useRef(0);
  const buscarOrigemRef = useRef(buscarOrigem);
  buscarOrigemRef.current = buscarOrigem;

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      arvoreGenRef.current += 1;
      genPorCaminhoRef.current.clear();
    };
  }, []);

  const { falhas, caminhosAbrir } = useMemo(
    () => verificarFechamentoArvore(arvore, valorEsperado),
    [arvore, valorEsperado]
  );

  useEffect(() => {
    setAbertos({});
    setEstadoFolhas({});
    setDocAberto(null);
    arvoreGenRef.current += 1;
    genPorCaminhoRef.current.clear();
    ultimoCliqueDocRef.current = 0;
  }, [arvore]);

  if (carregando) {
    return <Esqueleto variante="linha" linhas={5} rotulo="Carregando origem do valor" />;
  }

  if (erro) {
    return <AvisoFalha mensagem={erro} aoTentarNovamente={aoTentarNovamente} />;
  }

  if (!arvore || typeof arvore !== 'object') {
    return <Vazio mensagem="Nenhuma explicação disponível." />;
  }

  if (arvore.valor === null || arvore.valor === undefined) {
    return <Vazio mensagem={arvore.motivo ? `Sem dados para explicar: ${arvore.motivo}.` : 'Sem dados de origem.'} />;
  }

  const consultarFolha = async (no, caminho) => {
    if (!no?.ref) return;
    const arvoreGen = arvoreGenRef.current;
    const genCaminho = (genPorCaminhoRef.current.get(caminho) || 0) + 1;
    genPorCaminhoRef.current.set(caminho, genCaminho);
    const cliqueId = ++ultimoCliqueDocRef.current;

    setEstadoFolhas((prev) => ({
      ...prev,
      [caminho]: {
        ...(prev[caminho] || {}),
        carregando: true,
        erro: null,
        nota: null,
        buscaTexto: null,
      },
    }));

    let res;
    try {
      res = await buscarOrigemRef.current(no.ref);
    } catch {
      res = { dados: null, erro: 'Não foi possível consultar a origem deste valor.' };
    }

    if (
      !montadoRef.current ||
      arvoreGen !== arvoreGenRef.current ||
      genPorCaminhoRef.current.get(caminho) !== genCaminho
    ) {
      return;
    }

    if (res?.erro || !res?.dados) {
      setEstadoFolhas((prev) => ({
        ...prev,
        [caminho]: {
          ...(prev[caminho] || {}),
          carregando: false,
          erro: res?.erro || 'Não foi possível consultar a origem deste valor.',
          nota: null,
          buscaTexto: null,
        },
      }));
      return;
    }

    const dadosOrigem = res.dados;
    if (dadosOrigem.documento) {
      setEstadoFolhas((prev) => ({
        ...prev,
        [caminho]: {
          ...(prev[caminho] || {}),
          carregando: false,
          erro: null,
          nota: null,
          semArquivo: false,
          buscaTexto: null,
        },
      }));
      if (cliqueId === ultimoCliqueDocRef.current) {
        setDocAberto({
          caminho,
          arvoreGen,
          titulo: dadosOrigem.documento.titulo || no.rotulo,
          documento: dadosOrigem.documento,
          tipoOrigem: dadosOrigem.tipo,
          fato: dadosOrigem.fato,
          busca: dadosOrigem.busca,
          nota: dadosOrigem.nota,
          valor: dadosOrigem.valor ?? no.valor,
          parte: no.rotulo,
        });
      }
    } else {
      const notaExplicita =
        typeof dadosOrigem.nota === 'string' && dadosOrigem.nota.trim()
          ? dadosOrigem.nota.trim()
          : '';
      const notaSemDoc =
        notaExplicita ||
        (no.tipo === 'documento' ? 'Arquivo de origem indisponível.' : '');
      setEstadoFolhas((prev) => ({
        ...prev,
        [caminho]: {
          ...(prev[caminho] || {}),
          carregando: false,
          erro: null,
          nota: notaSemDoc,
          semArquivo: dadosOrigem.tipo === 'legado',
          buscaTexto: null,
        },
      }));
    }
  };

  const noEstaAberto = (caminho, nivel) => {
    if (nivel === 0) return true;
    if (Object.prototype.hasOwnProperty.call(abertos, caminho)) {
      return Boolean(abertos[caminho]);
    }
    return caminhosAbrir.has(caminho);
  };

  const alternarNo = (caminho, nivel) => {
    setAbertos((prev) => ({
      ...prev,
      [caminho]: !noEstaAberto(caminho, nivel),
    }));
  };

  const renderFilhos = (partes, caminhoPai, nivel) => {
    if (!Array.isArray(partes) || partes.length === 0) return null;
    const classeLista =
      nivel === 1
        ? 'de-onde-vem__lista de-onde-vem__lista--raiz'
        : 'de-onde-vem__lista de-onde-vem__lista--aninhada';

    return (
      <ul class={classeLista}>
        {partes.map((no, idx) => {
          if (!no || typeof no !== 'object') return null;
          const caminho = `${caminhoPai}/${idx}`;
          const filhos = Array.isArray(no.partes) ? no.partes : [];
          const temFilhos = filhos.length > 0;
          const ehFolha = !temFilhos;
          const temRef = ehFolha && Boolean(no.ref);
          const aberta = temFilhos && noEstaAberto(caminho, nivel);
          const sublistaId = `${baseId}-sub-${caminho.replace(/\//g, '-')}`;
          const estadoFolha = estadoFolhas[caminho];
          const falhaNo = falhas.get(caminho);
          const subFolha = ehFolha ? textoFolha(no, estadoFolha) : '';
          const ehGrupo = ehNoRaizOuGrupo(no, nivel);

          return (
            <li key={no.chave || idx} class="de-onde-vem__item">
              <div class="de-onde-vem__linha">
                <div class="de-onde-vem__cabeca">
                  {temFilhos && (
                    <button
                      type="button"
                      class="de-onde-vem__alternar"
                      aria-expanded={aberta ? 'true' : 'false'}
                      aria-controls={sublistaId}
                      aria-label={`${aberta ? 'Recolher' : 'Expandir'} ${no.rotulo}`}
                      onClick={() => alternarNo(caminho, nivel)}
                    >
                      {aberta ? (
                        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                      )}
                    </button>
                  )}

                  <div class="de-onde-vem__rotulos">
                    <span class={`de-onde-vem__rotulo${nivel === 1 ? ' de-onde-vem__rotulo--grupo' : ''}`}>
                      {no.sinal === -1 && (
                        <span class="de-onde-vem__sinal" aria-label="subtrai">
                          −
                        </span>
                      )}
                      {no.rotulo}
                    </span>

                    {no.tipo === 'calculo' && no.conta && (
                      <span class="de-onde-vem__conta">{no.conta}</span>
                    )}

                    {subFolha && <span class="de-onde-vem__nota">{subFolha}</span>}

                    {no.nota && <span class="de-onde-vem__nota">{no.nota}</span>}
                  </div>
                </div>

                <div class="de-onde-vem__valor">
                  <Valor
                    valor={no.valor}
                    centavos
                    problema={ehGrupo && Number(no.valor) < 0}
                    origem={temRef ? { resumo: no.rotulo } : null}
                    onOrigem={temRef ? () => consultarFolha(no, caminho) : null}
                    semOrigem={!temRef ? subFolha || 'Valor calculado pelas partes abaixo' : ''}
                  />
                </div>
              </div>

              {estadoFolha?.carregando && (
                <p class="de-onde-vem__status-folha" role="status">
                  Consultando origem…
                </p>
              )}

              {estadoFolha?.erro && (
                <div class="de-onde-vem__aviso-no">
                  <AvisoFalha
                    mensagem={estadoFolha.erro}
                    aoTentarNovamente={() => consultarFolha(no, caminho)}
                  />
                </div>
              )}

              {estadoFolha?.nota && (
                <p class="de-onde-vem__nota-folha">{estadoFolha.nota}</p>
              )}

              {falhaNo && (
                <div class="de-onde-vem__aviso-no">
                  <AvisoFalha mensagem={falhaNo} />
                </div>
              )}

              {temFilhos && aberta && (
                <div id={sublistaId}>{renderFilhos(filhos, caminho, nivel + 1)}</div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const falhaRaiz = falhas.get('0');
  // A Análise pode abrir o painel direto numa folha (ex.: a linha do plano
  // citada numa tabela). Sem partes abaixo, o valor do topo é o único caminho
  // até o documento: ele abre a origem como a folha abriria dentro da árvore.
  const raizEhFolhaComRef =
    !(Array.isArray(arvore.partes) && arvore.partes.length > 0) && Boolean(arvore.ref);
  const estadoRaiz = estadoFolhas['0'];
  const contextoRaiz = [
    arvore.conta || null,
    arvore.data_referencia ? `balancete de ${dataCompacta(arvore.data_referencia)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div class="de-onde-vem">
      <Destaque
        rotulo={arvore.rotulo}
        valor={
          <Valor
            valor={arvore.valor}
            centavos
            problema={Number(arvore.valor) < 0}
            origem={raizEhFolhaComRef ? { resumo: arvore.rotulo } : null}
            onOrigem={raizEhFolhaComRef ? () => consultarFolha(arvore, '0') : null}
            semOrigem={raizEhFolhaComRef ? '' : 'Total calculado pelas partes abaixo'}
          />
        }
        contexto={contextoRaiz || undefined}
      />

      {raizEhFolhaComRef && textoFolha(arvore, estadoRaiz) && (
        <p class="de-onde-vem__nota">{textoFolha(arvore, estadoRaiz)}</p>
      )}

      {estadoRaiz?.carregando && (
        <p class="de-onde-vem__status-folha" role="status">
          Consultando origem…
        </p>
      )}

      {estadoRaiz?.erro && (
        <AvisoFalha mensagem={estadoRaiz.erro} aoTentarNovamente={() => consultarFolha(arvore, '0')} />
      )}

      {arvore.tipo === 'digitado' && (
        <p class="de-onde-vem__nota">valor digitado, sem documento</p>
      )}

      {arvore.nota && <p class="de-onde-vem__nota">{arvore.nota}</p>}

      {falhaRaiz && <AvisoFalha mensagem={falhaRaiz} />}

      {renderFilhos(arvore.partes, '0', 1)}

      <Documento
        aberto={Boolean(docAberto)}
        aoFechar={() => setDocAberto(null)}
        titulo={docAberto?.titulo || ''}
        documento={docAberto?.documento || null}
        tipoOrigem={docAberto?.tipoOrigem || 'documento'}
        fato={docAberto?.fato || null}
        busca={docAberto?.busca || null}
        nota={docAberto?.nota || ''}
        valor={docAberto?.valor ?? null}
        parte={docAberto?.parte || ''}
        carregarArquivo={carregarArquivo}
        carregadorPdf={carregadorPdf}
        carregadorMammoth={carregadorMammoth}
        onResultadoBusca={(resBusca) => {
          if (!docAberto?.caminho || docAberto.arvoreGen !== arvoreGenRef.current) return;
          const caminhoDoc = docAberto.caminho;
          setEstadoFolhas((prev) => ({
            ...prev,
            [caminhoDoc]: {
              ...(prev[caminhoDoc] || {}),
              buscaTexto: resBusca.texto,
            },
          }));
        }}
      />
    </div>
  );
}
