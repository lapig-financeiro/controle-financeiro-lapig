import { useEffect, useId, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import { empilharEsc, estaNoTopoEsc } from '../util/pilhaEsc.js';
import { Valor } from './Valor.jsx';
import './Documento.css';

const SELETOR_FOCAVEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Moldura da janela larga de documento (`--largura-documento`, altura `--altura-documento`).
 * Esquerda: conteúdo do documento com o trecho em faixa `--cor-acento-suave`.
 * Direita (`--largura-menu`): valor com centavos, parte e critério ("achado pelo código/valor/texto").
 * Sem pdf.js/mammoth/SheetJS nesta etapa (carregam sob demanda a partir da F2).
 */
export function Documento({
  aberto = false,
  aoFechar,
  titulo = 'Documento de origem',
  arquivo = '',
  pagina = null,
  valor = null,
  parte = '',
  achadoPor = '',
  trecho = '',
  children = null,
}) {
  const tituloId = useId();
  const pilhaId = useId();
  const modalRef = useRef(null);
  const focoAnteriorRef = useRef(null);
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;

  useEffect(() => {
    if (!aberto) return undefined;

    focoAnteriorRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

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

  if (!aberto) return null;

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
            <h2 id={tituloId} class="documento__titulo">{titulo}</h2>
            {(arquivo || pagina) && (
              <p class="documento__meta">
                {arquivo}
                {arquivo && pagina ? ' · ' : ''}
                {pagina ? `página ${pagina}` : ''}
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
          <div class="documento__visao">
            {children || (
              <div class="documento__folha">
                {trecho ? (
                  <p class="documento__trecho texto-corrido">{trecho}</p>
                ) : (
                  <p class="documento__aviso-leitor">
                    Visualizador sob demanda preparado para receber PDF, DOCX ou planilha.
                  </p>
                )}
              </div>
            )}
          </div>

          <aside class="documento__lateral" aria-label="Dados da origem">
            <div class="documento__bloco">
              <span class="documento__rotulo">Valor</span>
              <div class="documento__valor">
                <Valor valor={valor} centavos />
              </div>
            </div>

            {parte && (
              <div class="documento__bloco">
                <span class="documento__rotulo">Parte</span>
                <p class="documento__texto">{parte}</p>
              </div>
            )}

            {achadoPor && (
              <div class="documento__bloco">
                <span class="documento__rotulo">Localização</span>
                <p class="documento__criterio">{achadoPor}</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
