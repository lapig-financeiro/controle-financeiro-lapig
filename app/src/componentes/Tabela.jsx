import { Fragment } from 'preact';
import { useId } from 'preact/hooks';
import { Vazio } from './Vazio.jsx';
import './Tabela.css';

/**
 * Tabela limpa sem zebra, cabeçalho fixo em relação à página, hover `--cor-afundado`.
 * Linhas clicáveis usam um `<button>` esticado na primeira célula (sem `role` no `<tr>`).
 * Abaixo de 640 px oculta o `thead` visualmente (mantendo-o acessível) e vira cartões compactos.
 */
export function Tabela({
  colunas = [],
  dados = [],
  chaveLinha = (linha, indice) => linha?.id ?? indice,
  onClicarLinha = null,
  // Quais linhas abrem detalhe; as outras ficam como texto (ex.: logins só leitura).
  linhaClicavel = () => true,
  rotuloLinha = (linha) => {
    const primeira = colunas[0]?.chave;
    return primeira && linha?.[primeira] ? `Abrir detalhe de ${linha[primeira]}` : 'Abrir detalhe';
  },
  chaveCarregando = null,
  chaveExpandida = null,
  renderDetalhe = null,
  vazio = null,
  legenda = 'Tabela de dados',
  className = '',
}) {
  const tabelaId = useId();
  if (!dados || dados.length === 0) {
    if (typeof vazio === 'string') return <Vazio mensagem={vazio} />;
    return vazio || <Vazio mensagem="Nenhum registro encontrado." />;
  }

  const clicavel = Boolean(onClicarLinha);

  return (
    <div class={`tabela-envoltorio${className ? ` ${className}` : ''}`}>
      <table class="tabela" aria-label={legenda}>
        <thead class="tabela__cabecalho">
          <tr>
            {colunas.map((col) => (
              <th
                key={col.chave}
                scope="col"
                class={`tabela__th${col.alinhamento === 'direita' ? ' tabela__th--direita' : ''}`}
              >
                {col.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody class="tabela__corpo">
          {dados.map((linha, indice) => {
            const chave = chaveLinha(linha, indice);
            const carregando = chaveCarregando !== null && chaveCarregando === chave;
            const estaClicavel = clicavel && linhaClicavel(linha);
            const expandida = Boolean(renderDetalhe) && chaveExpandida === chave;
            const detalheId = `${tabelaId}-detalhe-${indice}`;
            return (
              <Fragment key={chave}>
                <tr
                  class={`tabela__linha${estaClicavel ? ' tabela__linha--clicavel' : ''}`}
                  aria-busy={carregando ? 'true' : undefined}
                >
                  {colunas.map((col, colIdx) => {
                    const conteudo = col.render ? col.render(linha) : linha?.[col.chave];
                    return (
                      <td
                        key={col.chave}
                        data-rotulo={col.titulo}
                        class={`tabela__td${col.alinhamento === 'direita' ? ' tabela__td--direita' : ''}`}
                      >
                        {estaClicavel && colIdx === 0 ? (
                          <button
                            type="button"
                            class="tabela__gatilho"
                            aria-label={rotuloLinha(linha)}
                            aria-expanded={renderDetalhe ? expandida : undefined}
                            aria-controls={expandida ? detalheId : undefined}
                            onClick={() => onClicarLinha(linha)}
                          >
                            {conteudo}
                          </button>
                        ) : (
                          conteudo
                        )}
                      </td>
                    );
                  })}
                </tr>
                {expandida && (
                  <tr class="tabela__detalhe" id={detalheId}>
                    <td colSpan={colunas.length}>{renderDetalhe(linha)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
