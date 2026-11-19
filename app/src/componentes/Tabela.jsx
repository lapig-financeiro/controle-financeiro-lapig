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
  rotuloLinha = (linha) => {
    const primeira = colunas[0]?.chave;
    return primeira && linha?.[primeira] ? `Abrir detalhe de ${linha[primeira]}` : 'Abrir detalhe';
  },
  chaveCarregando = null,
  vazio = null,
  legenda = 'Tabela de dados',
  className = '',
}) {
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
            return (
              <tr
                key={chave}
                class={`tabela__linha${clicavel ? ' tabela__linha--clicavel' : ''}`}
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
                      {clicavel && colIdx === 0 ? (
                        <button
                          type="button"
                          class="tabela__gatilho"
                          aria-label={rotuloLinha(linha)}
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
