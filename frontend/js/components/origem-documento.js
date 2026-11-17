/* ============================================================
   origem-documento.js
   Janela "De onde vem este valor?": mostra o documento de origem
   (PDF do balancete ou plano de trabalho PDF/DOCX) na página certa,
   com a linha do valor destacada.

   Uso (quem chama é a tela do plano de trabalho):
     OrigemDocumento.abrir({
       titulo: 'Realizado de Material de Consumo',
       valor: 8351.44,
       documento: { tipo: 'pdf', nome: 'balancete-30117.pdf',
                    carregar: async () => ArrayBuffer },
       partes: [{ rotulo: '…', valor: 8351.44,
                  alvo: { conta_codigo: '…', valor: 8351.44 } }],
       nota: 'opcional',
     });

   O `carregar` é de quem abre — a tela passa a URL assinada do
   Supabase. Aqui não se sabe de onde o arquivo veio, e é por isso
   que o erro de download vira uma mensagem dentro da janela em vez
   de uma tela em branco.

   Depende de: pdfjsLib e mammoth (globais do index.html), Lucide,
   escapeAttr (pure-fns.js) e do módulo puro origem-busca.js.
   ============================================================ */

import { escapeAttr, formatBRL } from '../pure-fns.js';
import {
  acharAlvo,
  formatarValor,
  linhasDaPagina,
  marcarNoHtml,
} from '../origem-busca.js';

const STYLE_ID = 'origem-documento-css';

const ZOOMS = [0.75, 1, 1.25, 1.5, 2];

const STYLES = `
.odoc-overlay {
  position: fixed;
  inset: 0;
  z-index: 250;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-6);
  /* Mesmo scrim do .modal-overlay: preto translúcido não inverte
     quando o tema muda, diferente de uma cor de texto misturada. */
  background: hsla(225, 25%, 5%, 0.72);
  backdrop-filter: blur(6px);
  animation: odoc-surgir 0.18s var(--ease-out);
}
@keyframes odoc-surgir {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.odoc-janela {
  width: min(1100px, 100%);
  height: min(88vh, 940px);
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  outline: none;
}

.odoc-topo {
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-5) var(--sp-6);
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-subtle);
}
.odoc-titulo {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.3;
}
.odoc-fechar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.odoc-fechar:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
  border-color: var(--border-subtle);
}
.odoc-fechar:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.odoc-fechar svg, .odoc-fechar i { width: 20px; height: 20px; }

.odoc-lado {
  grid-column: 1;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  min-height: 0;
  padding: var(--sp-5) var(--sp-6);
  overflow-y: auto;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
}

.odoc-valor-caixa {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-4);
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}
.odoc-rotulo {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.odoc-valor {
  font-family: var(--font-mono);
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.odoc-partes {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.odoc-parte {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-3) var(--sp-4);
  font: inherit;
  text-align: left;
  color: inherit;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.odoc-parte:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}
.odoc-parte:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.odoc-parte--ativa {
  background: var(--accent-muted);
  border-color: var(--accent);
  box-shadow: inset 3px 0 0 var(--accent);
}
.odoc-parte__linha {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2) var(--sp-3);
}
.odoc-parte__rotulo {
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-primary);
}
.odoc-parte__valor {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  white-space: nowrap;
}
.odoc-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  border-radius: var(--radius-full);
}
.odoc-status svg, .odoc-status i { width: 12px; height: 12px; flex: 0 0 auto; }
.odoc-status--ok { background: var(--success-muted); color: var(--accent-hover); }
.odoc-status--nao { background: var(--warning-muted); color: var(--warning); }
.odoc-status--procurando { background: var(--bg-secondary); color: var(--text-muted); }

.odoc-nota {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--text-muted);
}
.odoc-vazio {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.odoc-doc {
  grid-column: 2;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-secondary);
}
.odoc-doc-topo {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 48px;
  padding: var(--sp-2) var(--sp-4);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
}
.odoc-arquivo {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.odoc-arquivo svg, .odoc-arquivo i { width: 16px; height: 16px; flex: 0 0 auto; }
.odoc-arquivo span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.odoc-ferramentas {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-left: auto;
}
.odoc-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.odoc-nav-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}
.odoc-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.odoc-nav-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.odoc-nav-btn svg, .odoc-nav-btn i { width: 16px; height: 16px; }
.odoc-pagina {
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  white-space: nowrap;
}
.odoc-zoom {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: 0.75rem;
  color: var(--text-muted);
}
.odoc-zoom select {
  padding: 3px 6px;
  font: inherit;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.odoc-doc-corpo {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: var(--sp-4);
  overflow: auto;
  background: var(--bg-secondary);
}
.odoc-pdf-area {
  width: max-content;
  margin: 0 auto;
}
.odoc-canvas-wrap {
  position: relative;
  background: var(--bg-surface);
  box-shadow: var(--shadow-md);
  line-height: 1;
}
.odoc-canvas { display: block; }
.odoc-faixas {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.odoc-faixa {
  position: absolute;
  border-radius: 2px;
  background: color-mix(in srgb, var(--warning) 35%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 70%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--warning) 25%, transparent);
}

.odoc-docx {
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  padding: var(--sp-6);
  font-family: var(--font-base);
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
.odoc-docx table {
  width: 100%;
  margin: var(--sp-3) 0;
  border-collapse: collapse;
}
.odoc-docx th, .odoc-docx td {
  padding: 4px 6px;
  text-align: left;
  vertical-align: top;
  border: 1px solid var(--border-subtle);
}
.odoc-docx th { background: var(--bg-secondary); }
.odoc-docx p { margin: var(--sp-2) 0; }
.odoc-docx h1, .odoc-docx h2, .odoc-docx h3, .odoc-docx h4 {
  margin: var(--sp-4) 0 var(--sp-2);
  font-family: var(--font-heading);
  color: var(--text-primary);
}
.odoc-docx img { max-width: 100%; height: auto; }
.odoc-docx mark.origem-mark {
  padding: 0 1px;
  color: inherit;
  background: color-mix(in srgb, var(--warning) 40%, transparent);
  border-radius: 2px;
  box-shadow: inset 0 -2px 0 var(--warning);
}

.odoc-estado {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  margin: 12vh auto 0;
  padding: var(--sp-8);
  text-align: center;
  color: var(--text-secondary);
}
.odoc-estado svg, .odoc-estado i { width: 28px; height: 28px; }
.odoc-estado p {
  max-width: 46ch;
  margin: 0;
  line-height: 1.5;
}
.odoc-estado--erro { color: var(--danger); }
.odoc-estado--erro p strong { color: var(--text-primary); }

@media (max-width: 900px) {
  .odoc-overlay { padding: 0; }
  .odoc-janela {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
  }
  .odoc-topo { flex: 0 0 auto; }
  .odoc-lado {
    flex: 0 0 auto;
    max-height: 38vh;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .odoc-doc {
    flex: 1 1 auto;
    min-height: 0;
  }
  .odoc-docx {
    padding: var(--sp-4);
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .odoc-doc-corpo { padding: var(--sp-2); }
}
`;

// ── Estilos e ícones ───────────────────────────────────────

function garantirEstilos() {
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = STYLES;
  document.head.appendChild(tag);
}

function criarIcones(no) {
  if (typeof lucide === 'undefined' || typeof lucide.createIcons !== 'function') return;
  try {
    lucide.createIcons({ nodes: [no] });
  } catch {
    /* ícone é enfeite: falhar aqui não pode derrubar a janela */
  }
}

// ── Helpers de dados ───────────────────────────────────────

function paraNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;
  const texto = valor.trim().replace(/\s/g, '');
  if (!texto) return null;
  const numero = Number(
    texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto,
  );
  return Number.isFinite(numero) ? numero : null;
}

function valorExibido(valor) {
  const numero = paraNumero(valor);
  if (numero != null) return formatBRL(numero);
  if (valor == null || valor === '') return '—';
  const texto = String(valor).trim();
  return texto && texto !== 'NaN' ? texto : '—';
}

function mensagem(erro) {
  if (!erro) return 'erro desconhecido';
  if (typeof erro === 'string') return erro;
  return String(erro.message || erro);
}

function unicos(lista) {
  return [...new Set(
    lista.map((item) => String(item == null ? '' : item).trim()).filter(Boolean),
  )];
}

/** O alvo que a busca pura entende, completado com o valor da parte. */
function alvoDaParte(dados) {
  const alvo = dados && dados.alvo && typeof dados.alvo === 'object'
    ? { ...dados.alvo }
    : {};
  if (alvo.valor == null && dados && dados.valor != null) alvo.valor = dados.valor;
  if (!alvo.conta_codigo && !alvo.texto && alvo.valor == null
      && dados && dados.rotulo) {
    alvo.texto = dados.rotulo;
  }
  return alvo;
}

/**
 * Termos para marcar no HTML do DOCX. Separa por natureza porque
 * o status da parte diz se foi achada pelo código, pelo valor ou
 * pelo texto — o mesmo vocabulário do PDF.
 */
function termosDaParte(dados) {
  const alvo = dados && dados.alvo && typeof dados.alvo === 'object'
    ? dados.alvo
    : {};
  const codigo = [];
  const valor = [];
  const texto = [];

  if (alvo.conta_codigo) {
    const bruto = String(alvo.conta_codigo).trim();
    if (bruto.includes('#')) {
      // Código cortado no PDF: o reduzido é o que identifica a conta;
      // o prefixo pode aparecer inteiro no plano de trabalho.
      const [prefixo, reduzido] = bruto.split('#');
      if (prefixo) codigo.push(prefixo);
      if (reduzido) codigo.push(reduzido);
    } else if (bruto) {
      codigo.push(bruto);
    }
  }

  const numero = paraNumero(alvo.valor != null ? alvo.valor : dados && dados.valor);
  if (numero != null) {
    valor.push(formatarValor(numero));
    if (numero < 0) valor.push(`-${formatarValor(Math.abs(numero))}`);
  }

  if (alvo.texto) texto.push(String(alvo.texto));
  if (!codigo.length && !valor.length && dados && dados.rotulo) {
    texto.push(String(dados.rotulo));
  }

  const codigos = unicos(codigo);
  const valores = unicos(valor);
  const textos = unicos(texto);
  return {
    codigo: codigos,
    valor: valores,
    texto: textos,
    todos: unicos([...codigos, ...valores, ...textos]),
  };
}

// ── Estilos de status ──────────────────────────────────────

function rotuloMotivo(motivo) {
  if (motivo === 'codigo' || motivo === 'reduzido') return 'achado pelo código';
  if (motivo === 'valor') return 'achado pelo valor';
  if (motivo === 'texto') return 'achado pelo texto';
  return 'achado no documento';
}

function textoStatus(parte) {
  if (parte.estado === 'ok') return rotuloMotivo(parte.motivo);
  if (parte.estado === 'erro') return 'não consegui procurar aqui';
  if (parte.estado === 'nao') return 'não achei no documento';
  return 'procurando…';
}

function classeStatus(parte) {
  if (parte.estado === 'ok') return 'odoc-status--ok';
  if (parte.estado === 'nao' || parte.estado === 'erro') return 'odoc-status--nao';
  return 'odoc-status--procurando';
}

function iconeStatus(parte) {
  if (parte.estado === 'ok') {
    return '<i data-lucide="circle-check" aria-hidden="true"></i>';
  }
  if (parte.estado === 'nao' || parte.estado === 'erro') {
    return '<i data-lucide="search-x" aria-hidden="true"></i>';
  }
  return '<i data-lucide="loader-2" class="spin" aria-hidden="true"></i>';
}

// ── Janela ─────────────────────────────────────────────────

let janelaAtual = null;

/**
 * Abre a janela. Uma por vez: se já houver outra, ela fecha antes.
 * Devolve { fechar, overlay } para quem quiser fechar por código.
 */
export function abrir(opcoes = {}) {
  if (typeof document === 'undefined') return null;
  garantirEstilos();

  if (janelaAtual && typeof janelaAtual.fechar === 'function') {
    janelaAtual.fechar(false);
  }

  const anterior = document.activeElement;
  const opts = opcoes || {};
  const dadosDocumento = opts.documento || {};
  const tipo = tipoDoDocumento(dadosDocumento);
  const partesDados = Array.isArray(opts.partes)
    ? opts.partes.filter(Boolean)
    : [];
  const nome = dadosDocumento.nome || 'documento';
  const nota = opts.nota == null ? '' : String(opts.nota);

  const overlay = document.createElement('div');
  overlay.className = 'odoc-overlay';
  overlay.innerHTML = `
    <div class="odoc-janela" role="dialog" aria-modal="true"
         aria-labelledby="odoc-titulo" tabindex="-1">
      <header class="odoc-topo">
        <h2 class="odoc-titulo" id="odoc-titulo">${escapeAttr(opts.titulo || 'De onde vem este valor?')}</h2>
        <button type="button" class="odoc-fechar" data-odoc-fechar aria-label="Fechar">
          <i data-lucide="x" aria-hidden="true"></i>
        </button>
      </header>
      <aside class="odoc-lado">
        <div class="odoc-valor-caixa">
          <span class="odoc-rotulo">Valor conferido</span>
          <strong class="odoc-valor">${escapeAttr(valorExibido(opts.valor))}</strong>
        </div>
        <div class="odoc-partes" data-odoc-partes role="group" aria-label="Partes do valor conferido"></div>
        ${nota ? `<p class="odoc-nota">${escapeAttr(nota)}</p>` : ''}
      </aside>
      <section class="odoc-doc">
        <div class="odoc-doc-topo">
          <span class="odoc-arquivo" title="${escapeAttr(nome)}">
            <i data-lucide="file-text" aria-hidden="true"></i>
            <span>${escapeAttr(nome)}</span>
          </span>
          <div class="odoc-ferramentas" data-odoc-ferramentas></div>
        </div>
        <div class="odoc-doc-corpo" data-odoc-corpo></div>
      </section>
    </div>
  `;

  document.body.appendChild(overlay);

  const janela = overlay.querySelector('.odoc-janela');
  const corpo = overlay.querySelector('[data-odoc-corpo]');
  const partesEl = overlay.querySelector('[data-odoc-partes]');
  const ferramentas = overlay.querySelector('[data-odoc-ferramentas]');

  const estado = {
    tipo,
    documento: dadosDocumento,
    partes: partesDados.map((dados) => ({
      dados,
      alvo: alvoDaParte(dados),
      termos: termosDaParte(dados),
      resultados: [],
      motivo: null,
      estado: 'pendente',
      htmlDocx: null,
    })),
    selecionada: partesDados.length ? 0 : -1,
    pdf: null,
    paginaAtual: 1,
    zoom: 1.25,
    paginas: new Map(),        // número → promessa de page
    linhas: new Map(),         // número → linhasDaPagina já resolvido
    linhasPromessas: new Map(), // número → promessa (evita ler duas vezes)
    busca: null,
    htmlBruto: null,
    docx: null,
    canvas: null,
    wrap: null,
    faixas: null,
    viewport: null,
    dpr: 1,
    renderTask: null,
  };

  const controle = {
    overlay,
    fechar: (restaurar = true) => fechar(restaurar),
  };
  janelaAtual = controle;

  function vivo() {
    return janelaAtual === controle && overlay.isConnected;
  }

  // ── Partes à esquerda ────────────────────────────────────

  function htmlPartes() {
    if (!estado.partes.length) {
      return '<p class="odoc-vazio">Nenhuma parte informada — o documento abre na primeira página.</p>';
    }
    return estado.partes.map((parte, indice) => {
      const ativa = indice === estado.selecionada;
      const rotulo = parte.dados.rotulo || `Parte ${indice + 1}`;
      const valor = parte.dados.valor != null
        ? parte.dados.valor
        : (parte.dados.alvo && parte.dados.alvo.valor);
      return `
        <button type="button" class="odoc-parte${ativa ? ' odoc-parte--ativa' : ''}"
                data-odoc-parte="${indice}" aria-pressed="${ativa}">
          <span class="odoc-parte__rotulo">${escapeAttr(rotulo)}</span>
          <span class="odoc-parte__linha">
            <span class="odoc-parte__valor">${escapeAttr(valorExibido(valor))}</span>
            <span class="odoc-status ${classeStatus(parte)}">
              ${iconeStatus(parte)}<span>${escapeAttr(textoStatus(parte))}</span>
            </span>
          </span>
        </button>
      `;
    }).join('');
  }

  function renderizarPartes() {
    if (!partesEl) return;
    const tinhaFoco = partesEl.contains(document.activeElement);
    partesEl.innerHTML = htmlPartes();
    criarIcones(partesEl);
    if (tinhaFoco && estado.selecionada >= 0) {
      const botao = partesEl.querySelector(`[data-odoc-parte="${estado.selecionada}"]`);
      if (botao) botao.focus({ preventScroll: true });
    }
  }

  // ── Estados do painel do documento ───────────────────────

  function mostrarCarregando() {
    if (!corpo) return;
    corpo.innerHTML = `
      <div class="odoc-estado" role="status">
        <i data-lucide="loader-2" class="spin" aria-hidden="true"></i>
        <p>Carregando o documento…</p>
      </div>
    `;
    criarIcones(corpo);
  }

  function mostrarErro(erro) {
    if (!corpo) return;
    corpo.innerHTML = `
      <div class="odoc-estado odoc-estado--erro" role="alert">
        <i data-lucide="alert-circle" aria-hidden="true"></i>
        <p><strong>Não consegui abrir o documento:</strong> ${escapeAttr(mensagem(erro))}</p>
        <button type="button" class="btn btn--secondary btn--sm" data-odoc-tentar>
          Tentar de novo
        </button>
      </div>
    `;
    criarIcones(corpo);
    const tentar = corpo.querySelector('[data-odoc-tentar]');
    if (tentar) {
      tentar.addEventListener('click', () => {
        limparParaTentarDeNovo();
        carregar();
      });
    }
  }

  function mostrarErroDePagina(erro) {
    if (!corpo) return;
    // A área do canvas acabou de sair do DOM; soltar as referências
    // evita desenhar numa página que ninguém mais vê.
    estado.canvas = null;
    estado.wrap = null;
    estado.faixas = null;
    estado.viewport = null;
    corpo.innerHTML = `
      <div class="odoc-estado odoc-estado--erro" role="alert">
        <i data-lucide="alert-circle" aria-hidden="true"></i>
        <p><strong>Não consegui desenhar esta página:</strong> ${escapeAttr(mensagem(erro))}</p>
      </div>
    `;
    criarIcones(corpo);
  }

  // ── Carregamento ─────────────────────────────────────────

  async function carregar() {
    mostrarCarregando();
    try {
      if (typeof estado.documento.carregar !== 'function') {
        throw new Error('a tela não informou como buscar o arquivo');
      }
      const bruto = await estado.documento.carregar();
      if (!vivo()) return;
      const buffer = await paraArrayBuffer(bruto);
      if (!vivo()) return;
      if (estado.tipo === 'docx') await montarDocx(buffer);
      else await montarPdf(buffer);
    } catch (erro) {
      if (!vivo()) return;
      estado.partes.forEach((parte) => {
        if (parte.estado === 'pendente' || parte.estado === 'procurando') {
          parte.estado = 'erro';
        }
      });
      renderizarPartes();
      mostrarErro(erro);
    }
  }

  async function paraArrayBuffer(bruto) {
    if (bruto == null) throw new Error('o arquivo veio vazio');
    if (typeof bruto.arrayBuffer === 'function') return bruto.arrayBuffer();
    if (bruto instanceof ArrayBuffer) return bruto;
    if (ArrayBuffer.isView(bruto)) {
      return bruto.buffer.slice(bruto.byteOffset, bruto.byteOffset + bruto.byteLength);
    }
    throw new Error('o arquivo não veio num formato que eu saiba ler');
  }

  // ── PDF ──────────────────────────────────────────────────

  async function montarPdf(buffer) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('o leitor de PDF (pdf.js) não está carregado');
    }
    const tarefa = pdfjsLib.getDocument({ data: buffer });
    estado.pdf = await tarefa.promise;
    if (!vivo()) {
      try { estado.pdf.destroy(); } catch { /* noop */ }
      return;
    }

    montarCorpoPdf();
    montarFerramentasPdf();
    await renderPagina(1, false);
    if (!vivo()) return;

    estado.partes.forEach((parte) => { parte.estado = 'procurando'; });
    renderizarPartes();

    // Lê todas as páginas uma vez e chama acharAlvo uma vez por parte.
    // A primeira página já está na tela; o resto chega sozinho.
    estado.busca = buscarPartesPdf();
    if (estado.selecionada >= 0) {
      await estado.busca;
      if (vivo()) await irParaParte(estado.selecionada);
    }
  }

  function montarCorpoPdf() {
    corpo.innerHTML = `
      <div class="odoc-pdf-area">
        <div class="odoc-canvas-wrap">
          <canvas class="odoc-canvas" aria-label="Página do documento"></canvas>
          <div class="odoc-faixas" aria-hidden="true"></div>
        </div>
      </div>
    `;
    estado.wrap = corpo.querySelector('.odoc-canvas-wrap');
    estado.canvas = corpo.querySelector('.odoc-canvas');
    estado.faixas = corpo.querySelector('.odoc-faixas');
  }

  function montarFerramentasPdf() {
    ferramentas.innerHTML = `
      <button type="button" class="odoc-nav-btn" data-odoc-anterior aria-label="Página anterior">
        <i data-lucide="chevron-left" aria-hidden="true"></i>
      </button>
      <span class="odoc-pagina" data-odoc-pagina>Página 1 de ${estado.pdf.numPages}</span>
      <button type="button" class="odoc-nav-btn" data-odoc-proxima aria-label="Próxima página">
        <i data-lucide="chevron-right" aria-hidden="true"></i>
      </button>
      <label class="odoc-zoom">
        <span>Zoom</span>
        <select data-odoc-zoom aria-label="Zoom do documento">
          ${ZOOMS.map((z) => `<option value="${z}"${z === estado.zoom ? ' selected' : ''}>${Math.round(z * 100)}%</option>`).join('')}
        </select>
      </label>
    `;
    criarIcones(ferramentas);

    const anteriorBtn = ferramentas.querySelector('[data-odoc-anterior]');
    const proximaBtn = ferramentas.querySelector('[data-odoc-proxima]');
    const zoomSel = ferramentas.querySelector('[data-odoc-zoom]');

    if (anteriorBtn) {
      anteriorBtn.addEventListener('click', () => {
        if (estado.paginaAtual > 1) renderPagina(estado.paginaAtual - 1, true);
      });
    }
    if (proximaBtn) {
      proximaBtn.addEventListener('click', () => {
        if (estado.paginaAtual < estado.pdf.numPages) {
          renderPagina(estado.paginaAtual + 1, true);
        }
      });
    }
    if (zoomSel) {
      zoomSel.addEventListener('change', () => {
        const zoom = Number(zoomSel.value);
        if (!Number.isFinite(zoom) || zoom <= 0) return;
        estado.zoom = zoom;
        renderPagina(estado.paginaAtual, true);
      });
    }
    atualizarNav();
  }

  function atualizarNav() {
    if (!estado.pdf) return;
    const rotulo = ferramentas.querySelector('[data-odoc-pagina]');
    if (rotulo) {
      rotulo.textContent = `Página ${estado.paginaAtual} de ${estado.pdf.numPages}`;
    }
    const anteriorBtn = ferramentas.querySelector('[data-odoc-anterior]');
    const proximaBtn = ferramentas.querySelector('[data-odoc-proxima]');
    if (anteriorBtn) anteriorBtn.disabled = estado.paginaAtual <= 1;
    if (proximaBtn) proximaBtn.disabled = estado.paginaAtual >= estado.pdf.numPages;
  }

  async function obterPagina(numero) {
    // Guarda a promessa: duas chamadas seguidas não pedem a mesma
    // página duas vezes ao pdf.js.
    if (!estado.paginas.has(numero)) {
      estado.paginas.set(numero, estado.pdf.getPage(numero));
    }
    return estado.paginas.get(numero);
  }

  async function lerLinhas(numero) {
    if (estado.linhas.has(numero)) return estado.linhas.get(numero);
    if (estado.linhasPromessas.has(numero)) return estado.linhasPromessas.get(numero);

    const promessa = (async () => {
      const pagina = await obterPagina(numero);
      const conteudo = await pagina.getTextContent();
      return linhasDaPagina(conteudo.items);
    })();
    estado.linhasPromessas.set(numero, promessa);

    try {
      const linhas = await promessa;
      estado.linhas.set(numero, linhas);
      return linhas;
    } catch (erro) {
      estado.linhasPromessas.delete(numero);
      throw erro;
    }
  }

  async function buscarPartesPdf() {
    try {
      const paginas = [];
      for (let numero = 1; numero <= estado.pdf.numPages; numero += 1) {
        paginas.push(await lerLinhas(numero));
        if (!vivo()) return;
      }
      if (!vivo()) return;

      estado.partes.forEach((parte) => {
        try {
          // Uma chamada por parte, como manda o contrato: com todas
          // as páginas na mão ele decide a regra uma vez só.
          parte.resultados = acharAlvo(paginas, parte.alvo);
        } catch {
          parte.resultados = [];
        }
        parte.motivo = parte.resultados.length ? parte.resultados[0].motivo : null;
        parte.estado = parte.resultados.length ? 'ok' : 'nao';
      });

      renderizarPartes();
      desenharFaixas();
    } catch (erro) {
      if (!vivo()) return;
      estado.partes.forEach((parte) => {
        if (parte.estado === 'procurando' || parte.estado === 'pendente') {
          parte.estado = 'erro';
        }
      });
      renderizarPartes();
      console.warn('OrigemDocumento: não consegui procurar as partes no PDF:', erro);
    }
  }

  async function renderPagina(numero, focar) {
    if (!estado.pdf) return;
    const total = estado.pdf.numPages;
    const alvo = Math.min(Math.max(1, numero), total);
    estado.paginaAtual = alvo;

    let pagina;
    try {
      pagina = await obterPagina(alvo);
    } catch (erro) {
      if (vivo()) mostrarErroDePagina(erro);
      return;
    }
    // Outra navegação pode ter chegado enquanto esta página era
    // pedida ao pdf.js. Se a página atual já é outra, não desenha
    // esta por cima (o canvas e a barra de páginas ficariam brigando).
    if (!vivo() || !estado.canvas || estado.paginaAtual !== alvo) return;

    if (estado.renderTask) {
      try { estado.renderTask.cancel(); } catch { /* noop */ }
      estado.renderTask = null;
    }

    const dpr = window.devicePixelRatio || 1;
    const viewport = pagina.getViewport({ scale: estado.zoom * dpr });
    const canvas = estado.canvas;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const cssLargura = viewport.width / dpr;
    const cssAltura = viewport.height / dpr;
    canvas.style.width = `${cssLargura}px`;
    canvas.style.height = `${cssAltura}px`;
    if (estado.wrap) {
      estado.wrap.style.width = `${cssLargura}px`;
      estado.wrap.style.height = `${cssAltura}px`;
    }
    if (estado.faixas) estado.faixas.innerHTML = '';

    const tarefa = pagina.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
    });
    estado.renderTask = tarefa;

    try {
      await tarefa.promise;
    } catch (erro) {
      if (erro && erro.name === 'RenderingCancelledException') return;
      if (!vivo()) return;
      mostrarErroDePagina(erro);
      return;
    } finally {
      if (estado.renderTask === tarefa) estado.renderTask = null;
    }

    if (!vivo() || estado.paginaAtual !== alvo) return;
    estado.viewport = viewport;
    estado.dpr = dpr;
    desenharFaixas();
    atualizarNav();
    if (focar) rolarAteFaixa();
  }

  /**
   * Faixa semitransparente sobre a linha inteira. A conversão é a
   * mesma do pdf-split-view: `Util.transform(viewport.transform, …)`
   * leva coordenadas do PDF (Y para cima) para o viewport (Y para
   * baixo). O viewport está em pixels do canvas (zoom × dpr), então
   * dividimos por dpr para posicionar em CSS.
   */
  function desenharFaixas() {
    if (!estado.faixas || !estado.viewport) return;
    estado.faixas.innerHTML = '';

    const parte = estado.partes[estado.selecionada];
    if (!parte || !parte.resultados.length) return;
    const linhas = estado.linhas.get(estado.paginaAtual);
    if (!linhas) return;
    if (typeof pdfjsLib.Util?.transform !== 'function') return;

    const viewport = estado.viewport;
    const dpr = estado.dpr || 1;
    const larguraPagina = viewport.width / dpr;

    parte.resultados
      .filter((resultado) => resultado.pagina === estado.paginaAtual)
      .forEach((resultado) => {
        const linha = linhas[resultado.linha];
        if (!linha) return;

        const topo = pdfjsLib.Util.transform(
          viewport.transform,
          [1, 0, 0, 1, linha.x0, linha.yMax],
        );
        const base = pdfjsLib.Util.transform(
          viewport.transform,
          [1, 0, 0, 1, linha.x1, linha.yMin],
        );

        let esquerda = Math.min(topo[4], base[4]) / dpr - 4;
        let direita = Math.max(topo[4], base[4]) / dpr + 4;
        esquerda = Math.max(0, Math.min(esquerda, larguraPagina));
        direita = Math.max(0, Math.min(direita, larguraPagina));

        // Folga vertical de 1px: no balancete da FUNAPE as linhas ficam a ~8 pt uma da outra, e 4px de folga
        // (como na horizontal) faziam a faixa cobrir também a linha de cima (visto num PDF real em 17/11).
        let altura = Math.abs(base[5] - topo[5]) / dpr + 2;
        let topoPx = Math.min(topo[5], base[5]) / dpr - 1;
        if (altura < 12) {
          topoPx -= (12 - altura) / 2;
          altura = 12;
        }
        if (direita - esquerda < 8) direita = esquerda + 8;

        const faixa = document.createElement('div');
        faixa.className = 'odoc-faixa';
        faixa.style.left = `${esquerda}px`;
        faixa.style.top = `${topoPx}px`;
        faixa.style.width = `${direita - esquerda}px`;
        faixa.style.height = `${altura}px`;
        estado.faixas.appendChild(faixa);
      });
  }

  function rolarAteFaixa() {
    const faixa = estado.faixas && estado.faixas.querySelector('.odoc-faixa');
    if (!faixa || !corpo) return;
    rolarAteElemento(faixa);
  }

  function rolarAteElemento(elemento) {
    if (!elemento || !corpo) return;
    const alvo = elemento.getBoundingClientRect();
    const area = corpo.getBoundingClientRect();
    corpo.scrollTop += (alvo.top - area.top) - (corpo.clientHeight / 2) + (alvo.height / 2);
    corpo.scrollLeft += (alvo.left - area.left) - (corpo.clientWidth / 2) + (alvo.width / 2);
  }

  // ── DOCX ─────────────────────────────────────────────────

  async function montarDocx(buffer) {
    if (typeof mammoth === 'undefined') {
      throw new Error('o leitor de DOCX (mammoth) não está carregado');
    }
    const resultado = await mammoth.convertToHtml({ arrayBuffer: buffer });
    if (!vivo()) return;

    estado.htmlBruto = resultado && typeof resultado.value === 'string'
      ? resultado.value
      : '';
    if (!estado.htmlBruto.trim()) {
      throw new Error('o DOCX não tem texto que eu consiga mostrar');
    }
    ferramentas.innerHTML = '';

    // O texto do DOCX é escapado pelo mammoth na conversão; o HTML
    // resultante é o documento, não dado digitado num campo.
    corpo.innerHTML = `<div class="odoc-docx" data-odoc-docx>${estado.htmlBruto}</div>`;
    estado.docx = corpo.querySelector('[data-odoc-docx]');

    prepararPartesDocx();
    if (estado.selecionada >= 0) mostrarDocxDaParte(estado.selecionada);
  }

  function prepararPartesDocx() {
    const html = estado.htmlBruto;
    estado.partes.forEach((parte) => {
      const termos = parte.termos.todos;
      const marcado = marcarNoHtml(html, termos);
      parte.htmlDocx = marcado.html;

      if (!termos.length) {
        parte.motivo = null;
        parte.estado = 'nao';
        return;
      }

      // O motivo segue a mesma ordem do PDF: código, valor, texto.
      const achouCodigo = parte.termos.codigo.some(
        (termo) => marcarNoHtml(html, [termo]).total > 0,
      );
      const achouValor = parte.termos.valor.some(
        (termo) => marcarNoHtml(html, [termo]).total > 0,
      );
      const achouTexto = parte.termos.texto.some(
        (termo) => marcarNoHtml(html, [termo]).total > 0,
      );

      parte.motivo = achouCodigo ? 'codigo'
        : achouValor ? 'valor'
          : achouTexto ? 'texto' : null;
      parte.estado = parte.motivo ? 'ok' : 'nao';
    });
    renderizarPartes();
  }

  function mostrarDocxDaParte(indice) {
    const parte = estado.partes[indice];
    if (!parte || !estado.docx) return;
    estado.docx.innerHTML = parte.htmlDocx != null ? parte.htmlDocx : estado.htmlBruto;
    const primeira = estado.docx.querySelector('mark.origem-mark');
    if (primeira) rolarAteElemento(primeira);
    else if (corpo) corpo.scrollTop = 0;
  }

  // ── Seleção e navegação ──────────────────────────────────

  async function selecionarParte(indice) {
    if (indice < 0 || indice >= estado.partes.length) return;
    estado.selecionada = indice;
    renderizarPartes();
    try {
      await irParaParte(indice);
    } catch (erro) {
      if (vivo()) {
        console.warn('OrigemDocumento: não consegui abrir a parte selecionada:', erro);
      }
    }
  }

  async function irParaParte(indice) {
    const parte = estado.partes[indice];
    if (!parte) return;

    // A busca de todas as partes pode estar rodando; esperar aqui
    // evita abrir a página errada quando o clique chega antes dela.
    if (estado.busca) await estado.busca;
    if (!vivo() || estado.selecionada !== indice) return;

    if (estado.tipo === 'docx') {
      mostrarDocxDaParte(indice);
      return;
    }

    if (!parte.resultados.length) {
      desenharFaixas();
      return;
    }
    await renderPagina(parte.resultados[0].pagina, true);
  }

  // ── Limpeza ──────────────────────────────────────────────

  function limparParaTentarDeNovo() {
    if (estado.renderTask) {
      try { estado.renderTask.cancel(); } catch { /* noop */ }
      estado.renderTask = null;
    }
    if (estado.pdf) {
      try { estado.pdf.destroy(); } catch { /* noop */ }
      estado.pdf = null;
    }
    estado.paginas.clear();
    estado.linhas.clear();
    estado.linhasPromessas.clear();
    estado.busca = null;
    estado.htmlBruto = null;
    estado.docx = null;
    estado.canvas = null;
    estado.wrap = null;
    estado.faixas = null;
    estado.viewport = null;
    estado.paginaAtual = 1;
    if (ferramentas) ferramentas.innerHTML = '';
    estado.partes.forEach((parte) => {
      parte.resultados = [];
      parte.motivo = null;
      parte.estado = 'pendente';
      parte.htmlDocx = null;
    });
    estado.selecionada = estado.partes.length ? 0 : -1;
    renderizarPartes();
  }

  function fechar(restaurarFoco = true) {
    if (janelaAtual !== controle) return;
    janelaAtual = null;

    document.removeEventListener('keydown', aoTeclar, true);
    if (estado.renderTask) {
      try { estado.renderTask.cancel(); } catch { /* noop */ }
      estado.renderTask = null;
    }
    if (estado.pdf) {
      try { estado.pdf.destroy(); } catch { /* noop */ }
      estado.pdf = null;
    }
    overlay.remove();

    if (restaurarFoco && anterior && typeof anterior.focus === 'function'
        && document.contains(anterior)) {
      try {
        anterior.focus({ preventScroll: true });
      } catch {
        anterior.focus();
      }
    }
  }

  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    evento.preventDefault();
    evento.stopPropagation();
    fechar();
  }

  // ── Eventos ──────────────────────────────────────────────

  const botaoFechar = overlay.querySelector('[data-odoc-fechar]');
  if (botaoFechar) botaoFechar.addEventListener('click', () => fechar());

  // Só fecha se o clique COMEÇOU fora: arrastar uma seleção de texto
  // de dentro da janela e soltar no fundo não pode fechar.
  let comecouFora = false;
  overlay.addEventListener('mousedown', (evento) => {
    comecouFora = evento.target === overlay;
  });
  overlay.addEventListener('click', (evento) => {
    if (evento.target === overlay && comecouFora) fechar();
    comecouFora = false;
  });

  partesEl.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-odoc-parte]');
    if (!botao) return;
    const indice = Number(botao.getAttribute('data-odoc-parte'));
    if (Number.isInteger(indice)) selecionarParte(indice);
  });

  document.addEventListener('keydown', aoTeclar, true);

  // ── Abre ─────────────────────────────────────────────────

  renderizarPartes();
  criarIcones(overlay);
  if (janela && typeof janela.focus === 'function') {
    janela.focus({ preventScroll: true });
  }
  carregar();

  return controle;
}

// ── Helpers fora da janela ─────────────────────────────────

function tipoDoDocumento(documento) {
  const informado = String((documento && documento.tipo) || '').toLowerCase().trim();
  if (informado === 'docx' || informado === 'pdf') return informado;
  return /\.docx$/i.test(String((documento && documento.nome) || '')) ? 'docx' : 'pdf';
}

// ── Browser bridge ─────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.OrigemDocumento = { abrir };
}
