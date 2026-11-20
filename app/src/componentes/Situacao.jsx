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

// Um balão aberto por vez: abrir um selo fecha o que estava aberto (o clique no selo
// não chega ao "clique fora" do outro, porque para a propagação para não seguir o link).
let fecharBalaoAberto = null;
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
  const balaoRef = useRef(null);
  const fecharTimerRef = useRef(null);
  const ultimoPonteiroRef = useRef(null);
  const ultimoToqueEmRef = useRef(null);

  const eventoDeToque = (evento) => {
    if (evento?.sourceCapabilities?.firesTouchEvents) return true;
    if (ultimoPonteiroRef.current !== 'touch') return false;
    return Boolean(ultimoToqueEmRef.current) && Date.now() - ultimoToqueEmRef.current < 800;
  };
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState(null);

  // Função estável que fecha este selo (usada pelo "um balão por vez").
  const fecharEsteRef = useRef(null);
  if (!fecharEsteRef.current) {
    fecharEsteRef.current = () => {
      if (fecharTimerRef.current) {
        clearTimeout(fecharTimerRef.current);
        fecharTimerRef.current = null;
      }
      setAberto(false);
    };
  }
  useEffect(
    () => () => {
      if (fecharBalaoAberto === fecharEsteRef.current) fecharBalaoAberto = null;
    },
    []
  );

  const cancelarFechamento = () => {
    if (fecharTimerRef.current) {
      clearTimeout(fecharTimerRef.current);
      fecharTimerRef.current = null;
    }
  };

  const agendarFechamento = () => {
    cancelarFechamento();
    if (typeof window === 'undefined') return;
    fecharTimerRef.current = window.setTimeout(() => {
      fecharTimerRef.current = null;
      setAberto(false);
    }, 150);
  };

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
    // a medição depois da montagem corrige o lado e a borda.
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

  const fechar = () => {
    cancelarFechamento();
    if (temMotivos) setAberto(false);
  };

  const abrir = () => {
    if (!temMotivos) return;
    cancelarFechamento();
    if (fecharBalaoAberto && fecharBalaoAberto !== fecharEsteRef.current) fecharBalaoAberto();
    fecharBalaoAberto = fecharEsteRef.current;
    posicionar();
    setAberto(true);
  };

  useEffect(() => {
    if (!temMotivos || !aberto) return undefined;
    const desempilhar = empilharEsc(idBalao, () => {
      cancelarFechamento();
      setAberto(false);
    });
    const atualizar = () => posicionar();
    window.addEventListener('resize', atualizar);
    window.addEventListener('scroll', atualizar, true);
    return () => {
      desempilhar();
      window.removeEventListener('resize', atualizar);
      window.removeEventListener('scroll', atualizar, true);
    };
  }, [temMotivos, aberto, idBalao, lista.length]);

  // Toque/clique fora fecha; o clique no selo e no balão não chega aqui.
  useEffect(() => {
    if (!aberto || typeof document === 'undefined') return undefined;
    const aoClicarFora = (evento) => {
      if (gatilhoRef.current?.contains(evento.target)) return;
      if (balaoRef.current?.contains(evento.target)) return;
      cancelarFechamento();
      setAberto(false);
    };
    document.addEventListener('click', aoClicarFora);
    return () => document.removeEventListener('click', aoClicarFora);
  }, [aberto]);

  useEffect(() => () => {
    if (fecharTimerRef.current) clearTimeout(fecharTimerRef.current);
  }, []);

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
        onPointerDown: (evento) => {
          ultimoPonteiroRef.current = evento.pointerType || 'mouse';
          if (ultimoPonteiroRef.current === 'touch') {
            ultimoToqueEmRef.current = Date.now();
          }
        },
        onTouchStart: () => {
          ultimoPonteiroRef.current = 'touch';
          ultimoToqueEmRef.current = Date.now();
        },
        onMouseOver: (evento) => {
          if (eventoDeToque(evento)) return;
          cancelarFechamento();
          abrir();
        },
        onMouseOut: (evento) => {
          if (eventoDeToque(evento)) return;
          const relacionado = evento.relatedTarget;
          if (
            relacionado &&
            (evento.currentTarget.contains(relacionado) ||
              balaoRef.current?.contains(relacionado))
          ) {
            cancelarFechamento();
            return;
          }
          agendarFechamento();
        },
        onFocus: () => {
          cancelarFechamento();
          // Foco de ponteiro (toque) deixa o clique decidir; teclado abre.
          if (!ultimoPonteiroRef.current) abrir();
        },
        onBlur: () => {
          ultimoPonteiroRef.current = null;
          agendarFechamento();
        },
        onClick: (evento) => {
          evento.preventDefault();
          evento.stopPropagation();
          if (aberto) fechar();
          else abrir();
        },
      }
    : {};

  const balao =
    temMotivos && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={balaoRef}
            id={idBalao}
            class={`situacao__balao${
              posicao?.acima ? ' situacao__balao--acima' : ''
            }`}
            data-aberto={aberto && posicao ? 'true' : 'false'}
            role="tooltip"
            onMouseOver={cancelarFechamento}
            onMouseOut={(evento) => {
              if (eventoDeToque(evento)) return;
              const relacionado = evento.relatedTarget;
              if (relacionado && balaoRef.current?.contains(relacionado)) {
                cancelarFechamento();
                return;
              }
              agendarFechamento();
            }}
            onMouseDown={(evento) => {
              evento.preventDefault();
              cancelarFechamento();
            }}
            onClick={(evento) => evento.stopPropagation()}
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
