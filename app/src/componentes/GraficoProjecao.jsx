import { useEffect, useRef, useState } from 'preact/hooks';
import { dataCompacta, dinheiroCompacto } from '../util/formato.js';
import { Tabela } from './Tabela.jsx';
import { Valor } from './Valor.jsx';
import './GraficoProjecao.css';

const ALTURA = 320;
const MARGEM_ESQUERDA = 64;
const MARGEM_DIREITA = 12;
const MARGEM_TOPO = 44;
const MARGEM_BASE = 44;
const LARGURA_POR_MES = 56;

function passoBonito(bruto) {
  if (!(bruto > 0) || !Number.isFinite(bruto)) return 1000;
  const expoente = Math.floor(Math.log10(bruto));
  const base = 10 ** expoente;
  const proporcao = bruto / base;
  const multiplicador = proporcao <= 1 ? 1 : proporcao <= 2 ? 2 : proporcao <= 2.5 ? 2.5 : proporcao <= 5 ? 5 : 10;
  return multiplicador * base;
}

function textoEixo(valor) {
  if (valor === 0) return '0';
  return dinheiroCompacto(valor).replace('R$ ', '');
}

/**
 * Duas barras por mês: dinheiro em conta depois da folha (`--grafico-1`)
 * e o orçamento de Bolsas que resta (`--grafico-2` com contorno). Uma
 * faixa marca o mês da falta e uma linha tracejada marca o mês em que
 * entra um desembolso. SVG em Preact, sem biblioteca de gráfico; cores
 * só por classe com tokens.
 *
 * O SVG ocupa 100% da largura da caixa e rola dentro dela quando a
 * largura mínima (56 px por mês) não couber. Acima de 14 meses o eixo
 * mostra meses alternados; acima de 24, só janeiro e julho.
 */
export function GraficoProjecao({
  meses = [],
  mesFalta = null,
  ariaLabel = '',
  className = '',
}) {
  // O SVG é desenhado na largura real da caixa (sem escalar o viewBox),
  // para o texto ficar no tamanho do token. Abaixo do mínimo por mês, a
  // caixa rola.
  const caixaRef = useRef(null);
  const [larguraCaixa, setLarguraCaixa] = useState(0);
  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return undefined;
    const medir = () => setLarguraCaixa(Math.floor(el.clientWidth || 0));
    medir();
    if (typeof ResizeObserver !== 'function') return undefined;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (!Array.isArray(meses) || meses.length === 0) return null;

  const LARGURA = Math.max(
    MARGEM_ESQUERDA + MARGEM_DIREITA + meses.length * LARGURA_POR_MES,
    larguraCaixa
  );
  const LARGURA_PLOT = LARGURA - MARGEM_ESQUERDA - MARGEM_DIREITA;
  const ALTURA_PLOT = ALTURA - MARGEM_TOPO - MARGEM_BASE;

  const mostrarRotuloMes = (indice) => {
    if (meses.length <= 14) return true;
    if (meses.length <= 24) return indice % 2 === 0;
    const mes = meses[indice].mes;
    return mes.slice(5, 7) === '01' || mes.slice(5, 7) === '07';
  };

  const valores = [];
  for (const linha of meses) {
    if (Number.isFinite(linha.em_conta_apos_folha)) valores.push(linha.em_conta_apos_folha);
    if (Number.isFinite(linha.orcamento_resta)) valores.push(linha.orcamento_resta);
  }
  const maior = Math.max(0, ...valores);
  const menor = Math.min(0, ...valores);
  const passoY = passoBonito((maior - menor) / 4 || 1);
  const topo = Math.max(passoY, Math.ceil(maior / passoY) * passoY);
  const baseY = Math.min(0, Math.floor(menor / passoY) * passoY);

  const escalaY = (valor) =>
    MARGEM_TOPO + ((topo - valor) / (topo - baseY || 1)) * ALTURA_PLOT;
  const zeroY = escalaY(0);
  const alturaBarra = (valor) => Math.max(Math.abs(escalaY(valor) - zeroY), 1);
  const yDaBarra = (valor) => (valor >= 0 ? escalaY(valor) : zeroY);

  const quantidadeTicks = Math.round((topo - baseY) / passoY);
  const ticks = [];
  for (let i = 0; i <= quantidadeTicks; i += 1) {
    ticks.push(baseY + i * passoY);
  }

  const larguraMes = LARGURA_PLOT / meses.length;
  const larguraBarra = Math.min(larguraMes * 0.28, 28);
  const espacoEntreBarras = Math.min(larguraMes * 0.06, 4);
  const temNegativo = meses.some((linha) => linha.em_conta_apos_folha < 0);
  const temDesembolso = meses.some((linha) => (linha.desembolsos || []).length > 0);

  const primeiro = meses[0]?.mes;
  const ultimo = meses[meses.length - 1]?.mes;
  const rotulo =
    ariaLabel ||
    `Dinheiro em conta depois da folha e orçamento de Bolsas que resta, mês a mês, de ${dataCompacta(primeiro)} a ${dataCompacta(ultimo)}. A tabela abaixo traz os mesmos números.`;

  const tabela = meses.map((linha) => ({
    ...linha,
    entra: (linha.entra_antes || 0) + (linha.entra_depois || 0),
    falta: linha.mes === mesFalta,
  }));

  return (
    <div class={`grafico-projecao${className ? ` ${className}` : ''}`}>
      <div class="grafico-projecao__legenda">
        <span class="grafico-projecao__legenda-item">
          <i class="grafico-projecao__amostra grafico-projecao__amostra--conta" aria-hidden="true" />
          em conta depois da folha
        </span>
        {temNegativo && (
          <span class="grafico-projecao__legenda-item">
            <i class="grafico-projecao__amostra grafico-projecao__amostra--falta" aria-hidden="true" />
            falta para a folha
          </span>
        )}
        <span class="grafico-projecao__legenda-item">
          <i class="grafico-projecao__amostra grafico-projecao__amostra--orcamento" aria-hidden="true" />
          orçamento de Bolsas que resta
        </span>
        {temDesembolso && (
          <span class="grafico-projecao__legenda-item">
            <i
              class="grafico-projecao__amostra grafico-projecao__amostra--desembolso"
              aria-hidden="true"
            />
            desembolso que entra
          </span>
        )}
        {mesFalta && (
          <span class="grafico-projecao__legenda-item">
            <i
              class="grafico-projecao__amostra grafico-projecao__amostra--mes-falta"
              aria-hidden="true"
            />
            mês em que falta
          </span>
        )}
      </div>

      <div class="grafico-projecao__rolagem" ref={caixaRef}>
        <svg
          class="grafico-projecao__svg"
          viewBox={`0 0 ${LARGURA} ${ALTURA}`}
          width={LARGURA}
          height={ALTURA}
          role="img"
          aria-label={rotulo}
        >
          {ticks.map((valor) => (
            <g key={valor}>
              <line
                class="grafico-projecao__grade"
                x1={MARGEM_ESQUERDA}
                x2={LARGURA - MARGEM_DIREITA}
                y1={escalaY(valor)}
                y2={escalaY(valor)}
              />
              <text
                class="grafico-projecao__eixo"
                x={MARGEM_ESQUERDA - 8}
                y={escalaY(valor) + 4}
                text-anchor="end"
              >
                {textoEixo(valor)}
              </text>
            </g>
          ))}

          {meses.map((linha, indice) => {
            const inicioMes = MARGEM_ESQUERDA + indice * larguraMes;
            const centro = inicioMes + larguraMes / 2;
            const xConta = centro - larguraBarra - espacoEntreBarras / 2;
            const xOrcamento = centro + espacoEntreBarras / 2;
            const conta = linha.em_conta_apos_folha;
            const orcamento = linha.orcamento_resta;

            return (
              <g key={linha.mes}>
                {linha.mes === mesFalta && (
                  <rect
                    class="grafico-projecao__faixa-falta"
                    x={inicioMes}
                    y={MARGEM_TOPO}
                    width={larguraMes}
                    height={ALTURA_PLOT}
                  />
                )}

                {Number.isFinite(conta) && (
                  <rect
                    class={`grafico-projecao__barra-conta${conta < 0 ? ' grafico-projecao__barra-conta--negativa' : ''}`}
                    x={xConta}
                    y={yDaBarra(conta)}
                    width={larguraBarra}
                    height={alturaBarra(conta)}
                  />
                )}

                {Number.isFinite(orcamento) && (
                  <rect
                    class="grafico-projecao__barra-orcamento"
                    x={xOrcamento}
                    y={yDaBarra(orcamento)}
                    width={larguraBarra}
                    height={alturaBarra(orcamento)}
                  />
                )}

                {(linha.desembolsos || []).map((desembolso, posicao) => {
                  const x = centro + larguraMes * 0.34;
                  // Rótulos de meses vizinhos podem se cruzar; cada mês
                  // usa uma das três faixas no topo e o texto cresce para
                  // a direita, longe do meio, salvo perto da borda direita.
                  const faixa = indice % 3;
                  const ancorarNoFim = x > LARGURA - 200;
                  return (
                    <g key={`${linha.mes}-${desembolso.parcela}`}>
                      <line
                        class="grafico-projecao__desembolso"
                        x1={x}
                        x2={x}
                        y1={MARGEM_TOPO}
                        y2={ALTURA - MARGEM_BASE}
                      />
                      <text
                        class="grafico-projecao__rotulo-desembolso"
                        x={ancorarNoFim ? x - 6 : x + 6}
                        y={14 + faixa * 14 + posicao * 14}
                        text-anchor={ancorarNoFim ? 'end' : 'start'}
                      >
                        {`+ desembolso ${desembolso.parcela} (${dinheiroCompacto(desembolso.liquido)})`}
                      </text>
                    </g>
                  );
                })}

                {mostrarRotuloMes(indice) && (
                  <text
                    class={`grafico-projecao__mes${linha.mes === mesFalta ? ' grafico-projecao__mes--falta' : ''}`}
                    x={centro}
                    y={ALTURA - MARGEM_BASE + 20}
                    text-anchor="middle"
                  >
                    {dataCompacta(linha.mes)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <details class="grafico-projecao__detalhes">
        <summary>Ver mês a mês em tabela</summary>
        <Tabela
          legenda="Projeção das bolsas, mês a mês"
          chaveLinha={(linha) => linha.mes}
          dados={tabela}
          className="grafico-projecao__tabela"
          colunas={[
            {
              chave: 'mes',
              titulo: 'Mês',
              render: (linha) => (
                <span class={linha.falta ? 'grafico-projecao__mes-tabela--falta' : ''}>
                  {dataCompacta(linha.mes)}
                </span>
              ),
            },
            {
              chave: 'entra',
              titulo: 'Entra (R$)',
              alinhamento: 'direita',
              render: (linha) =>
                linha.entra > 0 ? (
                  <Valor
                    valor={linha.entra}
                    centavos={false}
                    semPrefixo
                    alinhadoDireita
                    semOrigem="Desembolso que entra no mês"
                  />
                ) : (
                  <span class="grafico-projecao__vazio">—</span>
                ),
            },
            {
              chave: 'folha',
              titulo: 'Folha (R$)',
              alinhamento: 'direita',
              render: (linha) => (
                <Valor
                  valor={linha.folha}
                  centavos={false}
                  semPrefixo
                  alinhadoDireita
                  semOrigem="Soma das bolsas que pagam neste mês"
                />
              ),
            },
            {
              chave: 'em_conta_apos_folha',
              titulo: 'Em conta depois da folha (R$)',
              alinhamento: 'direita',
              render: (linha) => (
                <Valor
                  valor={linha.em_conta_apos_folha}
                  centavos={false}
                  semPrefixo
                  alinhadoDireita
                  problema={
                    Number.isFinite(linha.em_conta_apos_folha) &&
                    linha.em_conta_apos_folha < 0
                  }
                  motivoSemDado="sem balancete"
                  semOrigem="Dinheiro em conta depois de pagar a folha"
                />
              ),
            },
            {
              chave: 'orcamento_resta',
              titulo: 'Orçamento de Bolsas que resta (R$)',
              alinhamento: 'direita',
              render: (linha) => (
                <Valor
                  valor={linha.orcamento_resta}
                  centavos={false}
                  semPrefixo
                  alinhadoDireita
                  semOrigem="Orçamento da rubrica de Bolsas depois da folha"
                />
              ),
            },
          ]}
        />
      </details>
    </div>
  );
}
