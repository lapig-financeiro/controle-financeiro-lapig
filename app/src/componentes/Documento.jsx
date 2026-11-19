import { useCallback, useEffect, useId, useRef, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, X } from 'lucide-preact';
import {
  acharAlvo,
  formatarValor,
  linhasDaPagina,
  marcarNoHtml,
} from '../../../frontend/js/origem-busca.js';
import { arquivoDeOrigem } from '../servicos/dados.js';
import { carregarMammoth, carregarPdfJs } from '../servicos/leitoresDocumento.js';
import { empilharEsc, estaNoTopoEsc } from '../util/pilhaEsc.js';
import { AvisoFalha } from './AvisoFalha.jsx';
import { Esqueleto } from './Esqueleto.jsx';
import { Valor } from './Valor.jsx';
import './Documento.css';

const ZOOMS = [0.75, 1, 1.25, 1.5, 2];

const SELETOR_FOCAVEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function multiplicarTransform(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function bboxValido(bbox) {
  return Boolean(
    bbox &&
      typeof bbox === 'object' &&
      Number.isFinite(bbox.x0) &&
      Number.isFinite(bbox.x1) &&
      Number.isFinite(bbox.yMin) &&
      Number.isFinite(bbox.yMax)
  );
}

/**
 * Converte coordenadas no espaço do PDF (`{ x0, x1, yMin, yMax }`) para pixels CSS
 * usando `viewport.transform` (mesma conversão de `origem-documento.js`).
 */
export function calcularRetanguloFaixa(bbox, viewport, dpr = 1, transformFn = null) {
  if (!bboxValido(bbox) || !viewport || !Array.isArray(viewport.transform)) return null;
  const aplicar = typeof transformFn === 'function' ? transformFn : multiplicarTransform;
  const dprSeguro = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const larguraPagina = viewport.width / dprSeguro;

  const topo = aplicar(viewport.transform, [1, 0, 0, 1, bbox.x0, bbox.yMax]);
  const base = aplicar(viewport.transform, [1, 0, 0, 1, bbox.x1, bbox.yMin]);

  let esquerda = Math.min(topo[4], base[4]) / dprSeguro - 4;
  let direita = Math.max(topo[4], base[4]) / dprSeguro + 4;
  esquerda = Math.max(0, Math.min(esquerda, larguraPagina));
  direita = Math.max(0, Math.min(direita, larguraPagina));

  let altura = Math.abs(base[5] - topo[5]) / dprSeguro + 2;
  let topoPx = Math.min(topo[5], base[5]) / dprSeguro - 1;
  if (altura < 12) {
    topoPx -= (12 - altura) / 2;
    altura = 12;
  }
  if (direita - esquerda < 8) {
    direita = Math.min(larguraPagina, esquerda + 8);
  }

  return {
    x: Number(esquerda.toFixed(2)),
    y: Number(topoPx.toFixed(2)),
    width: Number(Math.max(0, direita - esquerda).toFixed(2)),
    height: Number(altura.toFixed(2)),
  };
}

/**
 * Remove tags ativas, manipuladores inline e esquemas inseguros do HTML vindo do mammoth.
 */
export function sanitizarHtmlDocx(html) {
  const texto = typeof html === 'string' ? html : '';
  if (!texto) return '';
  if (typeof DOMParser === 'undefined') return texto;

  const doc = new DOMParser().parseFromString(`<div>${texto}</div>`, 'text/html');
  doc.body
    .querySelectorAll('script, style, iframe, object, embed, svg, math, form, link, meta, base')
    .forEach((no) => no.remove());

  doc.body.querySelectorAll('*').forEach((no) => {
    for (const attr of [...no.attributes]) {
      const nome = attr.name.toLowerCase();
      if (nome.startsWith('on') || nome === 'style') {
        no.removeAttribute(attr.name);
        continue;
      }
      if (
        (nome === 'href' || nome === 'src' || nome === 'xlink:href') &&
        !/^(https?:|mailto:|#|data:image\/(?:png|jpe?g|gif|webp);)/i.test(attr.value.trim())
      ) {
        no.removeAttribute(attr.name);
      }
    }
  });

  return doc.body.firstElementChild ? doc.body.firstElementChild.innerHTML : '';
}

export function criterioPorMotivo(motivo) {
  if (motivo === 'codigo' || motivo === 'reduzido') return 'achado pelo código';
  if (motivo === 'valor') return 'achado pelo valor';
  if (motivo === 'texto') return 'achado pelo texto';
  return 'não achado no documento';
}

export function formatarCriterioDocumento(tipoOrigem, fato, motivoBusca = null) {
  if (tipoOrigem === 'documento') {
    const temPagina = Number.isInteger(fato?.pagina) && fato.pagina >= 1;
    const prefixo = temPagina ? `lido na página ${fato.pagina}` : 'lido no documento';
    const leitor = [fato?.parser, fato?.parser_versao].filter(Boolean).join(' ').trim();
    return leitor ? `${prefixo} (leitor ${leitor})` : prefixo;
  }
  if (tipoOrigem === 'legado') {
    return motivoBusca ? criterioPorMotivo(motivoBusca) : 'não achado no documento';
  }
  return '';
}

function montarTermosDocx({ tipoOrigem, fato, busca, valor }) {
  const codigo = [];
  const valores = [];
  const texto = [];

  if (busca?.conta_codigo) {
    const bruto = String(busca.conta_codigo).trim();
    if (bruto.includes('#')) {
      const [prefixo, reduzido] = bruto.split('#');
      if (prefixo) codigo.push(prefixo);
      if (reduzido) codigo.push(reduzido);
    } else if (bruto) {
      codigo.push(bruto);
    }
  }

  const num = busca?.valor != null ? Number(busca.valor) : valor != null ? Number(valor) : null;
  if (num != null && Number.isFinite(num)) {
    valores.push(formatarValor(num));
    if (num < 0) valores.push(`-${formatarValor(Math.abs(num))}`);
  }

  if (tipoOrigem === 'documento' && fato?.trecho) {
    texto.push(String(fato.trecho));
  }
  if (busca?.texto) {
    texto.push(String(busca.texto));
  }

  const unicos = (arr) => [...new Set(arr.map((s) => String(s || '').trim()).filter(Boolean))];
  return {
    codigo: unicos(codigo),
    valores: unicos(valores),
    texto: unicos(texto),
    todos: unicos([...texto, ...codigo, ...valores]),
  };
}

function paraBufferCopia(bruto) {
  if (bruto instanceof ArrayBuffer) return bruto.slice(0);
  if (ArrayBuffer.isView(bruto)) {
    return bruto.buffer.slice(bruto.byteOffset, bruto.byteOffset + bruto.byteLength);
  }
  return null;
}

/**
 * Janela larga do documento de origem (`--largura-documento`, altura `--altura-documento`).
 * Carrega `pdfjs-dist` e `mammoth` sob demanda pela prop `documento.formato`.
 */
export function Documento({
  aberto = false,
  aoFechar,
  titulo = '',
  documento = null,
  tipoOrigem = 'documento',
  fato = null,
  busca = null,
  nota = '',
  arquivo = '',
  pagina = null,
  valor = null,
  parte = '',
  achadoPor = '',
  trecho = '',
  children = null,
  carregarArquivo = arquivoDeOrigem,
  carregadorPdf = carregarPdfJs,
  carregadorMammoth = carregarMammoth,
  onResultadoBusca = null,
}) {
  const tituloId = useId();
  const pilhaId = useId();
  const modalRef = useRef(null);
  const visaoRef = useRef(null);
  const canvasRef = useRef(null);
  const focoAnteriorRef = useRef(null);
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;
  const onResultadoBuscaRef = useRef(onResultadoBusca);
  onResultadoBuscaRef.current = onResultadoBusca;
  const carregarArquivoRef = useRef(carregarArquivo);
  carregarArquivoRef.current = carregarArquivo;
  const carregadorPdfRef = useRef(carregadorPdf);
  carregadorPdfRef.current = carregadorPdf;
  const carregadorMammothRef = useRef(carregadorMammoth);
  carregadorMammothRef.current = carregadorMammoth;

  const pdfRef = useRef(null);
  const pdfjsRef = useRef(null);
  const renderTaskRef = useRef(null);
  const sessaoRef = useRef(0);
  const renderGenRef = useRef(0);
  const deveRolarParaFaixaRef = useRef(false);

  const [estadoDoc, setEstadoDoc] = useState({
    carregando: false,
    erro: null,
    formato: null,
    totalPaginas: 0,
    paginaAtual: 1,
    alvosPdf: [],
    htmlDocx: '',
    criterio: '',
  });
  const [zoom, setZoom] = useState(1.25);
  const [medidaPagina, setMedidaPagina] = useState({ largura: 0, altura: 0, faixas: [] });
  const [erroPagina, setErroPagina] = useState(null);
  const [tentativaReload, setTentativaReload] = useState(0);

  const formatoBruto = documento ? String(documento.formato || '').toLowerCase().trim() : '';
  const formatoDocumento = !documento
    ? null
    : formatoBruto === 'pdf' || formatoBruto === 'docx'
      ? formatoBruto
      : 'nao-suportado';

  const chaveCarga =
    aberto && documento
      ? JSON.stringify({
          id: documento.id ?? null,
          bucket: documento.bucket ?? null,
          caminho: documento.caminho ?? null,
          arquivo_nome: documento.arquivo_nome ?? null,
          formato: formatoDocumento,
          tipoOrigem,
          pagina: fato?.pagina ?? null,
          trecho: fato?.trecho ?? null,
          bbox: fato?.bbox ?? null,
          parser: fato?.parser ?? null,
          parser_versao: fato?.parser_versao ?? null,
          busca: busca ?? null,
          valor: valor ?? null,
          tentativaReload,
        })
      : '';

  const cargaAtualRef = useRef(null);
  cargaAtualRef.current = {
    documento,
    formatoDocumento,
    tipoOrigem,
    fato,
    busca,
    valor,
  };

  useEffect(() => {
    if (!aberto) return undefined;

    focoAnteriorRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const modal = modalRef.current;
    if (modal) {
      const focaveis = modal.querySelectorAll(SELETOR_FOCAVEL);
      if (focaveis.length > 0) focaveis[0].focus();
      else modal.focus();
    }

    const desempilhar = empilharEsc(pilhaId, () => aoFecharRef.current?.());

    const lidarTab = (e) => {
      if (e.key !== 'Tab' || !estaNoTopoEsc(pilhaId) || !modalRef.current) return;
      const lista = Array.from(modalRef.current.querySelectorAll(SELETOR_FOCAVEL));
      if (lista.length === 0) {
        e.preventDefault();
        return;
      }
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };

    document.addEventListener('keydown', lidarTab);
    return () => {
      desempilhar();
      document.removeEventListener('keydown', lidarTab);
      document.body.style.overflow = overflowAnterior;
      if (focoAnteriorRef.current && focoAnteriorRef.current.isConnected) {
        focoAnteriorRef.current.focus();
      }
    };
  }, [aberto, pilhaId]);

  const destruirPdfAtual = useCallback(() => {
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {
        /* noop */
      }
      renderTaskRef.current = null;
    }
    if (pdfRef.current) {
      try {
        pdfRef.current.destroy();
      } catch {
        /* noop */
      }
      pdfRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!chaveCarga) {
      sessaoRef.current += 1;
      destruirPdfAtual();
      setEstadoDoc({
        carregando: false,
        erro: null,
        formato: null,
        totalPaginas: 0,
        paginaAtual: 1,
        alvosPdf: [],
        htmlDocx: '',
        criterio: '',
      });
      setMedidaPagina({ largura: 0, altura: 0, faixas: [] });
      setErroPagina(null);
      return undefined;
    }

    const {
      documento: docAtual,
      formatoDocumento: formatoAtual,
      tipoOrigem: tipoAtual,
      fato: fatoAtual,
      busca: buscaAtual,
      valor: valorAtual,
    } = cargaAtualRef.current;

    const sessao = ++sessaoRef.current;
    let cancelado = false;
    const vivo = () => !cancelado && sessaoRef.current === sessao;

    destruirPdfAtual();
    setErroPagina(null);
    setMedidaPagina({ largura: 0, altura: 0, faixas: [] });
    setZoom(1.25);
    deveRolarParaFaixaRef.current = true;
    setEstadoDoc({
      carregando: true,
      erro: null,
      formato: formatoAtual,
      totalPaginas: 0,
      paginaAtual: 1,
      alvosPdf: [],
      htmlDocx: '',
      criterio: tipoAtual === 'legado' ? 'procurando no documento…' : formatarCriterioDocumento(tipoAtual, fatoAtual),
    });

    async function iniciar() {
      try {
        if (formatoAtual === 'nao-suportado') {
          setEstadoDoc((prev) => ({
            ...prev,
            carregando: false,
            erro: 'Formato de documento não suportado.',
          }));
          return;
        }
        const resArquivo = await carregarArquivoRef.current(docAtual);
        if (!vivo()) return;
        if (resArquivo?.erro || !resArquivo?.dados) {
          setEstadoDoc((prev) => ({
            ...prev,
            carregando: false,
            erro: resArquivo?.erro || 'Não foi possível carregar o arquivo de origem.',
          }));
          return;
        }

        const buffer = paraBufferCopia(resArquivo.dados);
        if (!buffer || buffer.byteLength === 0) {
          setEstadoDoc((prev) => ({
            ...prev,
            carregando: false,
            erro: 'O arquivo de origem veio vazio.',
          }));
          return;
        }

        if (formatoAtual === 'docx') {
          const mammoth = await carregadorMammothRef.current();
          if (!vivo()) return;
          const resultado = await mammoth.convertToHtml({ arrayBuffer: buffer });
          if (!vivo()) return;

          const htmlLimpo = sanitizarHtmlDocx(resultado?.value || '');
          if (!htmlLimpo.trim()) {
            setEstadoDoc((prev) => ({
              ...prev,
              carregando: false,
              erro: 'O documento não tem texto que possa ser exibido.',
            }));
            return;
          }

          const termos = montarTermosDocx({
            tipoOrigem: tipoAtual,
            fato: fatoAtual,
            busca: buscaAtual,
            valor: valorAtual,
          });
          const marcado = marcarNoHtml(htmlLimpo, termos.todos);

          let motivoDocx = null;
          if (tipoAtual === 'legado') {
            const achouCodigo = termos.codigo.some((t) => marcarNoHtml(htmlLimpo, [t]).total > 0);
            const achouValor = termos.valores.some((t) => marcarNoHtml(htmlLimpo, [t]).total > 0);
            const achouTexto = termos.texto.some((t) => marcarNoHtml(htmlLimpo, [t]).total > 0);
            motivoDocx = achouCodigo ? 'codigo' : achouValor ? 'valor' : achouTexto ? 'texto' : null;
          }

          const criterioFinal = formatarCriterioDocumento(tipoAtual, fatoAtual, motivoDocx);
          if (tipoAtual === 'legado') {
            onResultadoBuscaRef.current?.({
              achado: Boolean(motivoDocx),
              texto: criterioFinal,
              motivo: motivoDocx,
            });
          }

          setEstadoDoc({
            carregando: false,
            erro: null,
            formato: 'docx',
            totalPaginas: 0,
            paginaAtual: 1,
            alvosPdf: [],
            htmlDocx: marcado.html,
            criterio: criterioFinal,
          });
          return;
        }

        // PDF sob demanda
        const pdfjs = await carregadorPdfRef.current();
        if (!vivo()) return;
        pdfjsRef.current = pdfjs;

        const tarefa = pdfjs.getDocument({
          data: new Uint8Array(buffer),
          isEvalSupported: false,
        });
        const pdf = await tarefa.promise;
        if (!vivo()) {
          try {
            pdf.destroy();
          } catch {
            /* noop */
          }
          return;
        }
        pdfRef.current = pdf;

        const totalPaginas = pdf.numPages || 1;
        const temPaginaFato =
          Number.isInteger(fatoAtual?.pagina) && fatoAtual.pagina >= 1 && fatoAtual.pagina <= totalPaginas;

        let paginaInicial = temPaginaFato ? fatoAtual.pagina : 1;
        let alvosPdf = [];
        let motivoAchado = null;

        if (tipoAtual === 'documento' && bboxValido(fatoAtual?.bbox) && temPaginaFato) {
          alvosPdf = [{ pagina: fatoAtual.pagina, bbox: fatoAtual.bbox }];
        } else {
          const paginasTexto = [];
          for (let n = 1; n <= totalPaginas; n += 1) {
            const pg = await pdf.getPage(n);
            if (!vivo()) return;
            const textContent = await pg.getTextContent();
            if (!vivo()) return;
            paginasTexto.push(linhasDaPagina(textContent.items));
          }

          const alvoBusca =
            tipoAtual === 'documento'
              ? fatoAtual?.trecho
                ? { texto: fatoAtual.trecho }
                : null
              : buscaAtual || {};

          const achados = alvoBusca ? acharAlvo(paginasTexto, alvoBusca) : [];
          if (achados.length > 0) {
            const achadosNaPaginaFato =
              tipoAtual === 'documento' && temPaginaFato
                ? achados.filter((a) => a.pagina === fatoAtual.pagina)
                : [];
            const escolhidos = achadosNaPaginaFato.length > 0 ? achadosNaPaginaFato : achados;
            paginaInicial = escolhidos[0].pagina;
            motivoAchado = escolhidos[0].motivo;
            alvosPdf = escolhidos
              .map((a) => {
                const linha = paginasTexto[a.pagina - 1]?.[a.linha];
                if (!linha) return null;
                return {
                  pagina: a.pagina,
                  bbox: { x0: linha.x0, x1: linha.x1, yMin: linha.yMin, yMax: linha.yMax },
                };
              })
              .filter(Boolean);
          } else {
            paginaInicial = tipoAtual === 'documento' && temPaginaFato ? fatoAtual.pagina : 1;
          }
        }

        const criterioFinal = formatarCriterioDocumento(tipoAtual, fatoAtual, motivoAchado);
        if (tipoAtual === 'legado') {
          onResultadoBuscaRef.current?.({
            achado: Boolean(motivoAchado),
            texto: criterioFinal,
            motivo: motivoAchado,
          });
        }

        setEstadoDoc({
          carregando: false,
          erro: null,
          formato: 'pdf',
          totalPaginas,
          paginaAtual: paginaInicial,
          alvosPdf,
          htmlDocx: '',
          criterio: criterioFinal,
        });
      } catch (err) {
        if (!vivo()) return;
        setEstadoDoc((prev) => ({
          ...prev,
          carregando: false,
          erro: err?.message || 'Não foi possível abrir o documento.',
        }));
      }
    }

    iniciar();

    return () => {
      cancelado = true;
      destruirPdfAtual();
    };
  }, [chaveCarga, destruirPdfAtual]);

  // Renderiza a página atual do PDF no <canvas>
  useEffect(() => {
    if (
      !aberto ||
      estadoDoc.carregando ||
      estadoDoc.erro ||
      estadoDoc.formato !== 'pdf' ||
      !pdfRef.current ||
      !canvasRef.current
    ) {
      return undefined;
    }

    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const gen = ++renderGenRef.current;
    let cancelado = false;

    async function desenhar() {
      setErroPagina(null);
      try {
        const pg = await pdf.getPage(estadoDoc.paginaAtual);
        if (cancelado || renderGenRef.current !== gen) return;

        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            /* noop */
          }
          renderTaskRef.current = null;
        }

        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const viewport = pg.getViewport({ scale: zoom * dpr });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));

        const ctx = canvas.getContext('2d');
        if (ctx) {
          const tarefa = pg.render({ canvasContext: ctx, viewport });
          renderTaskRef.current = tarefa;
          await tarefa.promise;
          if (renderTaskRef.current === tarefa) renderTaskRef.current = null;
        }
        if (cancelado || renderGenRef.current !== gen) return;

        const cssLargura = Math.round(viewport.width / dpr);
        const cssAltura = Math.round(viewport.height / dpr);
        const transformFn = pdfjsRef.current?.Util?.transform || null;
        const faixas = estadoDoc.alvosPdf
          .filter((a) => a.pagina === estadoDoc.paginaAtual)
          .map((a) => calcularRetanguloFaixa(a.bbox, viewport, dpr, transformFn))
          .filter(Boolean);

        setMedidaPagina({ largura: cssLargura, altura: cssAltura, faixas });
      } catch (err) {
        if (err?.name === 'RenderingCancelledException') return;
        if (!cancelado && renderGenRef.current === gen) {
          setErroPagina(err?.message || 'Não foi possível desenhar esta página.');
        }
      }
    }

    desenhar();

    return () => {
      cancelado = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          /* noop */
        }
        renderTaskRef.current = null;
      }
    };
  }, [
    aberto,
    estadoDoc.carregando,
    estadoDoc.erro,
    estadoDoc.formato,
    estadoDoc.paginaAtual,
    estadoDoc.alvosPdf,
    zoom,
  ]);

  // Rola até a faixa ou marca destacada após renderizar
  useEffect(() => {
    if (!aberto || !deveRolarParaFaixaRef.current || !visaoRef.current) return;
    if (estadoDoc.formato === 'pdf' && medidaPagina.faixas.length > 0) {
      const faixaEl = visaoRef.current.querySelector('.documento__faixa');
      if (faixaEl && typeof faixaEl.scrollIntoView === 'function') {
        faixaEl.scrollIntoView({ block: 'center', inline: 'center' });
      }
      deveRolarParaFaixaRef.current = false;
    } else if (estadoDoc.formato === 'docx' && estadoDoc.htmlDocx) {
      const marcaEl = visaoRef.current.querySelector('mark.origem-mark');
      if (marcaEl && typeof marcaEl.scrollIntoView === 'function') {
        marcaEl.scrollIntoView({ block: 'center' });
      }
      deveRolarParaFaixaRef.current = false;
    }
  }, [aberto, estadoDoc.formato, estadoDoc.htmlDocx, medidaPagina.faixas]);

  if (!aberto) return null;

  const tituloExibido = titulo || documento?.titulo || 'Documento de origem';
  const nomeArquivo = documento?.arquivo_nome || arquivo || '';
  const paginaMeta =
    estadoDoc.formato === 'pdf' && estadoDoc.totalPaginas > 0
      ? estadoDoc.paginaAtual
      : pagina;
  const trechoLiteral = fato?.trecho || trecho || '';
  const criterioExibido = documento ? estadoDoc.criterio : achadoPor;

  const irParaPagina = (novaPagina) => {
    const limite = Math.max(1, estadoDoc.totalPaginas);
    const alvo = Math.min(Math.max(1, novaPagina), limite);
    deveRolarParaFaixaRef.current = true;
    setEstadoDoc((prev) => ({ ...prev, paginaAtual: alvo }));
  };

  return (
    <div
      class="documento__veu"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFecharRef.current?.();
      }}
    >
      <div
        ref={modalRef}
        class="documento"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
      >
        <header class="documento__cabecalho">
          <div class="documento__titulos">
            <h2 id={tituloId} class="documento__titulo">
              {tituloExibido}
            </h2>
            {(nomeArquivo || paginaMeta) && (
              <p class="documento__meta">
                {nomeArquivo}
                {nomeArquivo && paginaMeta ? ' · ' : ''}
                {paginaMeta ? `página ${paginaMeta}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            class="documento__fechar"
            aria-label="Fechar documento"
            onClick={() => aoFecharRef.current?.()}
          >
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div class="documento__grade">
          <div class="documento__painel-doc">
            {documento && estadoDoc.formato === 'pdf' && !estadoDoc.carregando && !estadoDoc.erro && (
              <div class="documento__barra">
                <div class="documento__navegacao">
                  <button
                    type="button"
                    class="documento__nav-btn"
                    aria-label="Página anterior"
                    disabled={estadoDoc.paginaAtual <= 1}
                    onClick={() => irParaPagina(estadoDoc.paginaAtual - 1)}
                  >
                    <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                  <span class="documento__pagina-texto">
                    Página {estadoDoc.paginaAtual} de {estadoDoc.totalPaginas}
                  </span>
                  <button
                    type="button"
                    class="documento__nav-btn"
                    aria-label="Próxima página"
                    disabled={estadoDoc.paginaAtual >= estadoDoc.totalPaginas}
                    onClick={() => irParaPagina(estadoDoc.paginaAtual + 1)}
                  >
                    <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>

                <label class="documento__zoom">
                  <span>Zoom</span>
                  <select
                    class="documento__zoom-seletor"
                    aria-label="Zoom do documento"
                    value={String(zoom)}
                    onChange={(e) => {
                      const novoZoom = Number(e.target.value);
                      if (Number.isFinite(novoZoom) && novoZoom > 0) {
                        setZoom(novoZoom);
                      }
                    }}
                  >
                    {ZOOMS.map((z) => (
                      <option key={z} value={String(z)}>
                        {Math.round(z * 100)}%
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div class="documento__visao" ref={visaoRef}>
              {!documento ? (
                children || (
                  <div class="documento__folha">
                    {trecho ? (
                      <p class="documento__trecho texto-corrido">{trecho}</p>
                    ) : (
                      <p class="documento__aviso-leitor">
                        Visualizador sob demanda preparado para receber PDF ou DOCX.
                      </p>
                    )}
                  </div>
                )
              ) : estadoDoc.carregando ? (
                <Esqueleto variante="cartao" linhas={6} rotulo="Carregando documento" />
              ) : estadoDoc.erro ? (
                <AvisoFalha
                  grave
                  mensagem={estadoDoc.erro}
                  aoTentarNovamente={() => setTentativaReload((n) => n + 1)}
                />
              ) : erroPagina ? (
                <AvisoFalha grave mensagem={erroPagina} />
              ) : estadoDoc.formato === 'docx' ? (
                <div
                  class="documento__docx"
                  // HTML sanitizado por sanitizarHtmlDocx e marcado por marcarNoHtml
                  dangerouslySetInnerHTML={{ __html: estadoDoc.htmlDocx }}
                />
              ) : (
                <div class="documento__pdf-area">
                  <div
                    class="documento__pagina-wrap"
                    style={{
                      '--pagina-largura': medidaPagina.largura ? `${medidaPagina.largura}px` : 'auto',
                      '--pagina-altura': medidaPagina.altura ? `${medidaPagina.altura}px` : 'auto',
                    }}
                  >
                    <canvas
                      ref={canvasRef}
                      class="documento__canvas"
                      aria-label={`Página ${estadoDoc.paginaAtual} do documento`}
                    />
                    <div class="documento__faixas" aria-hidden="true">
                      {medidaPagina.faixas.map((faixa, idx) => (
                        <div
                          key={idx}
                          class="documento__faixa"
                          style={{
                            '--faixa-x': `${faixa.x}px`,
                            '--faixa-y': `${faixa.y}px`,
                            '--faixa-largura': `${faixa.width}px`,
                            '--faixa-altura': `${faixa.height}px`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside class="documento__lateral" aria-label="Dados da origem">
            <div class="documento__bloco">
              <span class="documento__rotulo">Valor</span>
              <div class="documento__valor">
                <Valor valor={valor} centavos semOrigem="Valor conferido no documento de origem" />
              </div>
              {trechoLiteral && (
                <p class="documento__trecho-lateral">{trechoLiteral}</p>
              )}
            </div>

            {parte && (
              <div class="documento__bloco">
                <span class="documento__rotulo">Parte</span>
                <p class="documento__texto">{parte}</p>
              </div>
            )}

            {criterioExibido && (
              <div class="documento__bloco">
                <span class="documento__rotulo">Localização</span>
                <p class="documento__criterio">{criterioExibido}</p>
              </div>
            )}

            {nota && (
              <div class="documento__bloco">
                <span class="documento__rotulo">Nota</span>
                <p class="documento__criterio">{nota}</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
