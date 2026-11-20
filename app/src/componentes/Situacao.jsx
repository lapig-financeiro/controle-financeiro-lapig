import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { empilharEsc } from '../util/pilhaEsc.js';
import './Situacao.css';

const ESTADOS = {
  'em dia': { classe: 'situacao--acento', texto: 'em dia' },
  atencao: { classe: 'situacao--atencao', texto: 'atenção' },
  'atenção': { classe: 'situacao--atencao', texto: 'atenção' },
  problema: { classe: 'situacao--problema', texto: 'problema' },
  'sem balancete': { classe: 'situacao--neutro', texto: 'sem balancete' },
  'sem plano': { classe: 'situacao--neutro', texto: 'sem plano' },
  'sem dado': { classe: 'situacao--neutro', texto: 'sem dado' },
};

const CLASSE_NIVEL = {
  problema: 'situacao__balao-ponto--problema',
  'atenção': 'situacao__balao-ponto--atencao',
  atencao: 'situacao__balao-ponto--atencao',
  info: 'situacao__balao-ponto--info',
};

const LARGURA_MAXIMA = 340;
const MARGEM = 8;

/**
 * Indicador de situação: ponto de 6 px + palavra fixa, sem fundo.
 *
 * Com `motivos`, o selo vira focável e mostra um balão (mouse, foco ou
 * toque) com um texto por linha. O balão é montado no `body` com
 * posição fixa para não ser cortado pela lista ou pela tabela; fecha
 * com Esc pela pilha global.
 */
export function Situacao({ estado = 'sem dado', className = '', motivos = null }) {
  const chave = String(estado || 'sem dado').trim().toLowerCase();
  const config = ESTADOS[chave] || ESTADOS['sem dado'];
  const lista = Array.isArray(motivos)
    ? motivos.filter((motivo) => motivo && typeof motivo.texto === 'string' && motivo.texto.trim())
    : [];
  const temMotivos = lista.length > 0;
  const idBalao = useId();
  const gatilhoRef = useRef(null);
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState(null);

  const posicionar = () => {
    const elemento = gatilhoRef.current;
    if (!elemento || typeof window === 'undefined') return;
    const retangulo = elemento.getBoundingClientRect();
    const largura = Math.min(LARGURA_MAXIMA, Math.max(200, window.innerWidth - MARGEM * 2));
    const esquerda = Math.max(
      MARGEM,
      Math.min(
        retangulo.left + retangulo.width / 2 - largura / 2,
        window.innerWidth - largura - MARGEM
      )
    );
    // Estimativa suficiente para decidir entre abrir abaixo ou acima;
    // o balão cresce para baixo e nunca fica cortado pela borda.
    const alturaEstimada = 24 + lista.length * 44;
    const cabeAbaixo =
      retangulo.bottom + MARGEM + alturaEstimada <= window.innerHeight ||
      retangulo.top < alturaEstimada + MARGEM;
    setPosicao({
      top: cabeAbaixo ? retangulo.bottom + MARGEM : retangulo.top - MARGEM,
      left: esquerda,
      width: largura,
      acima: !cabeAbaixo,
    });
  };

  const abrir = () => {
    if (!temMotivos) return;
    posicionar();
    setAberto(true);
  };

  const fechar = () => {
    if (temMotivos) setAberto(false);
  };

  useEffect(() => {
    if (!temMotivos || !aberto) return undefined;
    const desempilhar = empilharEsc(idBalao, () => setAberto(false));
    const atualizar = () => posicionar();
    window.addEventListener('resize', atualizar);
    window.addEventListener('scroll', atualizar, true);
    return () => {
      desempilhar();
      window.removeEventListener('resize', atualizar);
      window.removeEventListener('scroll', atualizar, true);
    };
  }, [temMotivos, aberto, idBalao, lista.length]);

  // A estimativa decide o lado; depois de montar, mede o balão de
  // verdade e escolhe o lado em que ele inteiro cabe, subindo ou
  // descendo quando preciso.
  useLayoutEffect(() => {
    if (!aberto || !posicao) return;
    const balao = typeof document !== 'undefined' ? document.getElementById(idBalao) : null;
    const gatilho = gatilhoRef.current;
    if (!balao || !gatilho) return;
    const retanguloBalao = balao.getBoundingClientRect();
    const retanguloGatilho = gatilho.getBoundingClientRect();
    const altura = retanguloBalao.height;
    const espacoAbaixo = window.innerHeight - retanguloGatilho.bottom - MARGEM;
    const espacoAcima = retanguloGatilho.top - MARGEM;
    let acima;
    let top;

    if (altura <= espacoAbaixo) {
      acima = false;
      top = retanguloGatilho.bottom + MARGEM;
    } else if (altura <= espacoAcima) {
      acima = true;
      top = retanguloGatilho.top - MARGEM;
    } else if (espacoAcima > espacoAbaixo) {
      acima = true;
      top = Math.max(MARGEM + altura, retanguloGatilho.top - MARGEM);
    } else {
      acima = false;
      top = Math.max(
        MARGEM,
        Math.min(window.innerHeight - MARGEM - altura, retanguloGatilho.bottom + MARGEM)
      );
    }

    if (posicao.acima !== acima || posicao.top !== top) {
      setPosicao({ ...posicao, top, acima });
    }
  }, [aberto, posicao, idBalao]);

  const propsGatilho = temMotivos
    ? {
        tabIndex: 0,
        'aria-describedby': idBalao,
        onMouseOver: abrir,
        onMouseOut: (evento) => {
          const relacionado = evento.relatedTarget;
          if (relacionado && evento.currentTarget.contains(relacionado)) return;
          fechar();
        },
        onFocus: abrir,
        onBlur: fechar,
      }
    : {};

  const balao =
    temMotivos && typeof document !== 'undefined'
      ? createPortal(
          <div
            id={idBalao}
            class={`situacao__balao${
              posicao?.acima ? ' situacao__balao--acima' : ''
            }`}
            data-aberto={aberto && posicao ? 'true' : 'false'}
            role="tooltip"
            style={{
              '--balao-top': posicao ? `${posicao.top}px` : '0px',
              '--balao-left': posicao ? `${posicao.left}px` : '0px',
              '--balao-width': posicao ? `${posicao.width}px` : '320px',
            }}
          >
            {lista.map((motivo, indice) => (
              <span key={`${motivo.codigo || 'motivo'}-${indice}`} class="situacao__balao-linha">
                <span
                  class={`situacao__balao-ponto ${
                    CLASSE_NIVEL[String(motivo.nivel || '').trim().toLowerCase()] ||
                    'situacao__balao-ponto--info'
                  }`}
                  aria-hidden="true"
                />
                <span>{motivo.texto}</span>
              </span>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <span
        ref={gatilhoRef}
        class={`situacao ${config.classe}${
          temMotivos ? ' situacao--com-motivos' : ''
        }${className ? ` ${className}` : ''}`}
        {...propsGatilho}
      >
        <span class="situacao__ponto" aria-hidden="true" />
        <span>{config.texto}</span>
      </span>
      {balao}
    </>
  );
}
