import { useId, useRef, useState } from 'preact/hooks';
import { AlertTriangle, Bell } from 'lucide-preact';
import { urlProjeto } from '../roteador.js';
import { tempoRelativo } from '../util/formato.js';
import { AvisoFalha } from './AvisoFalha.jsx';
import { Esqueleto } from './Esqueleto.jsx';
import { MenuSuspenso, MenuSuspensoSeparador } from './MenuSuspenso.jsx';
import './Sino.css';

/**
 * Sino de pendências (ícone 20 px) no padrão de divulgação.
 * Três estados: `consultando`, `indisponivel` e `pronto`.
 */
export function Sino({
  estado = 'pronto',
  pendencias = [],
  erro = null,
  onTentarNovamente = null,
  onSelecionar = null,
}) {
  const [aberto, setAberto] = useState(false);
  const ancoraRef = useRef(null);
  const gatilhoRef = useRef(null);
  const painelId = useId();

  const abertas = (pendencias || []).filter((p) => !p.situacao || p.situacao === 'aberta');
  const total = abertas.length;

  let rotuloBotao = 'Pendências';
  if (estado === 'consultando') {
    rotuloBotao = 'Consultando pendências';
  } else if (estado === 'indisponivel') {
    rotuloBotao = 'Pendências indisponíveis';
  } else if (total > 0) {
    rotuloBotao = total === 1 ? '1 pendência' : `${total} pendências`;
  }

  return (
    <div class="sino" ref={ancoraRef}>
      <button
        ref={gatilhoRef}
        type="button"
        class="sino__botao"
        aria-label={rotuloBotao}
        aria-expanded={aberto ? 'true' : 'false'}
        aria-controls={aberto ? painelId : undefined}
        onClick={() => setAberto((v) => !v)}
      >
        <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
        {estado === 'consultando' && (
          <span class="sino__estado-texto" aria-hidden="true">…</span>
        )}
        {estado === 'indisponivel' && (
          <AlertTriangle size={16} strokeWidth={1.75} class="sino__alerta" aria-hidden="true" />
        )}
        {estado === 'pronto' && total > 0 && (
          <span class="sino__contagem" aria-hidden="true">
            {total}
          </span>
        )}
      </button>

      <MenuSuspenso
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        ancoraRef={ancoraRef}
        gatilhoRef={gatilhoRef}
        ariaLabel="Pendências"
      >
        <div id={painelId}>
          <div class="sino__cabecalho">Pendências</div>
          <MenuSuspensoSeparador />
          {estado === 'consultando' ? (
            <div class="sino__estado">
              <Esqueleto variante="linha" linhas={2} rotulo="Consultando pendências" />
            </div>
          ) : estado === 'indisponivel' ? (
            <div class="sino__estado">
              <AvisoFalha
                mensagem={erro || 'Não foi possível consultar as pendências.'}
                aoTentarNovamente={onTentarNovamente}
              />
            </div>
          ) : total === 0 ? (
            <p class="sino__vazio">Nenhuma pendência no momento.</p>
          ) : (
            <ul class="sino__lista">
              {abertas.map((item, indice) => {
                const temProjetoCampo = Object.prototype.hasOwnProperty.call(item, 'project_id');
                const metaCentro = item.centro || (temProjetoCampo
                  ? (item.project_id ? (item.code || 'Centro') : 'Geral')
                  : '');
                const metaTempo = item.tempo || (item.criada_em ? tempoRelativo(item.criada_em) : '');
                const meta = [metaCentro, metaTempo].filter(Boolean).join(' · ');

                return (
                  <li key={item.id ?? indice}>
                    {temProjetoCampo && !item.project_id ? (
                      <div class="sino__item sino__item--estatico">
                        <span class="sino__item-titulo">{item.titulo}</span>
                        {meta && <span class="sino__item-meta">{meta}</span>}
                      </div>
                    ) : temProjetoCampo ? (
                      <a
                        href={urlProjeto(item.project_id, 'pendencias')}
                        class="sino__item"
                        onClick={(e) => {
                          setAberto(false);
                          if (onSelecionar) {
                            e.preventDefault();
                            onSelecionar(item);
                          }
                        }}
                      >
                        <span class="sino__item-titulo">{item.titulo}</span>
                        {meta && <span class="sino__item-meta">{meta}</span>}
                      </a>
                    ) : (
                      <button
                        type="button"
                        class="sino__item"
                        onClick={() => {
                          setAberto(false);
                          onSelecionar?.(item);
                        }}
                      >
                        <span class="sino__item-titulo">{item.titulo}</span>
                        {meta && <span class="sino__item-meta">{meta}</span>}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </MenuSuspenso>
    </div>
  );
}
