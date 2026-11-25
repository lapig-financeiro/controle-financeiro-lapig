// Relatório da bancada: a tabela do `relatorio.md` (saída, ignorada pelo git) e
// os detalhes legíveis de cada pergunta. Nada de chave, nada de corpo de modelo.

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUMERO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function escapar(valor) {
  return String(valor ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function formatarValor(valor, unidade) {
  if (valor === null || valor === undefined) return '—';
  if (unidade === 'moeda' && typeof valor === 'number') return MOEDA.format(valor);
  if (unidade === 'percentual' && typeof valor === 'number') return `${NUMERO.format(valor)}%`;
  if (unidade === 'numero' && typeof valor === 'number') return NUMERO.format(valor);
  return String(valor);
}

function formatarOrigem(origem) {
  if (!origem || typeof origem !== 'object') return 'sem origem';
  if (origem.tipo === 'sem_documento') {
    return `sem documento (${origem.motivo || 'motivo não informado'})`;
  }
  if (origem.tipo === 'no') {
    const chave = origem.no && typeof origem.no.chave === 'string' ? origem.no.chave : null;
    return chave ? `nó da árvore (${chave})` : 'nó da árvore';
  }
  if (origem.tipo === 'livre') {
    const chave = origem.chave ? `, ${origem.chave}` : '';
    return `livre${chave}`;
  }
  if (origem.tipo === 'ref') {
    const ref = origem.ref ?? {};
    return `documento ${ref.alvo_tabela ?? '?'}.${ref.campo ?? '?'}`;
  }
  if (origem.tipo === 'termo') return 'termo do contrato';
  if (origem.tipo === 'calculo') {
    return `cálculo ${origem.op ?? ''} (${Array.isArray(origem.partes) ? origem.partes.length : 0} partes)`;
  }
  return String(origem.tipo ?? 'origem');
}

function renderizarBloco(bloco) {
  if (!bloco || typeof bloco !== 'object') return ['_(bloco inválido)_'];

  if (bloco.tipo === 'numero' && bloco.numero) {
    const no = bloco.numero;
    const linhas = [
      `**${bloco.titulo || `Bloco ${bloco.id ?? ''}`}** — ` +
        `${formatarValor(no.valor, no.unidade)} (${no.unidade ?? '?'})`,
      `Rótulo: ${no.rotulo || '—'} · Origem: ${formatarOrigem(no.origem)}`,
    ];
    if (no.contexto) {
      linhas.push(
        `Contexto: ${formatarValor(no.contexto.valor, no.contexto.unidade)} · ` +
          `Origem: ${formatarOrigem(no.contexto.origem)}`,
      );
    }
    return linhas;
  }

  if (bloco.tipo === 'tabela' && bloco.tabela) {
    const colunas = Array.isArray(bloco.tabela.colunas) ? bloco.tabela.colunas : [];
    const linhas = Array.isArray(bloco.tabela.linhas) ? bloco.tabela.linhas : [];
    const saida = [
      `**${bloco.titulo || `Bloco ${bloco.id ?? ''}`}** (tabela)`,
      `| ${colunas.map((coluna) => escapar(coluna.rotulo)).join(' | ')} |`,
      `| ${colunas.map(() => '---').join(' | ')} |`,
    ];
    for (const linha of linhas) {
      saida.push(
        `| ${(Array.isArray(linha) ? linha : [])
          .map((celula) => escapar(formatarValor(celula.valor, celula.unidade)))
          .join(' | ')} |`,
      );
    }
    return saida;
  }

  if (bloco.tipo === 'texto' && bloco.texto) {
    return [`**${bloco.titulo || `Bloco ${bloco.id ?? ''}`}** (texto)`, `> ${bloco.texto.texto}`];
  }

  return [`**${bloco.titulo || `Bloco ${bloco.id ?? ''}`}** (${bloco.tipo ?? '?'})`, '```json', JSON.stringify(bloco, null, 2), '```'];
}

function detalhes(resultado) {
  const linhas = [];
  linhas.push(`### ${resultado.id}. ${resultado.pergunta}`);
  linhas.push('');
  linhas.push(
    `${resultado.ok ? '**Passou.**' : '**Falhou.**'} ` +
      `${(Number(resultado.ms) / 1000).toFixed(1)} s · ` +
      `${resultado.rodadas ?? '?'} rodada(s) · ` +
      `${resultado.chamadasModelo} chamada(s) ao modelo`,
  );
  linhas.push('');
  if (resultado.ferramentas.length) {
    linhas.push(`Ferramentas: ${resultado.ferramentas.join(', ')}.`);
    linhas.push('');
  }
  if (resultado.motivos.length) {
    linhas.push('Por quê:');
    for (const motivo of resultado.motivos) linhas.push(`- ${motivo}`);
    linhas.push('');
  }
  if (resultado.falhas.length) {
    linhas.push('Falhas de ferramenta (o modelo recebeu o erro):');
    for (const falha of resultado.falhas) {
      linhas.push(`- ${falha.ferramenta}: ${falha.erro}`);
    }
    linhas.push('');
  }

  if (resultado.textoFinal) {
    linhas.push('Texto final:');
    linhas.push('');
    linhas.push(`> ${resultado.textoFinal}`);
    linhas.push('');
  }

  if (resultado.blocos.length) {
    linhas.push('Blocos:');
    linhas.push('');
    for (const bloco of resultado.blocos) {
      for (const linha of renderizarBloco(bloco)) linhas.push(linha);
      linhas.push('');
    }
  }

  return linhas;
}

/**
 * @param {object} opcoes
 * @param {Array} opcoes.resultados
 * @param {object} opcoes.meta  `{ data, modo, modelo, retrato, observacoes }`
 */
export function formatarRelatorio({ resultados, meta = {} }) {
  const passaram = resultados.filter((resultado) => resultado.ok).length;
  const linhas = [];

  linhas.push('# Bancada da Análise — relatório de execução');
  linhas.push('');
  linhas.push(`- Data: ${meta.data ?? new Date().toISOString()}`);
  linhas.push(`- Modo do modelo: ${meta.modo ?? '?'}`);
  linhas.push(`- Modelo: ${meta.modelo ?? '?'}`);
  linhas.push(`- Retrato: ${meta.retrato ?? '?'}`);
  linhas.push(`- Perguntas: ${resultados.length} (${passaram} passaram, ${resultados.length - passaram} falharam)`);
  if (Array.isArray(meta.observacoes) && meta.observacoes.length) {
    linhas.push(`- Observações do retrato: ${meta.observacoes.length} (ver abaixo)`);
  }
  linhas.push('');

  if (Array.isArray(meta.observacoes) && meta.observacoes.length) {
    linhas.push('## Observações do retrato');
    linhas.push('');
    for (const observacao of meta.observacoes) linhas.push(`- ${observacao}`);
    linhas.push('');
  }

  linhas.push('## Resumo');
  linhas.push('');
  linhas.push('| # | Pergunta | Resultado | Tempo | Rodadas | Por quê |');
  linhas.push('| --- | --- | --- | --- | --- | --- |');
  for (const resultado of resultados) {
    const falhas = Array.isArray(resultado.falhas) ? resultado.falhas.length : 0;
    const situacao = resultado.ok
      ? falhas > 0
        ? `passou (${falhas} falha(s) de ferramenta)`
        : 'passou'
      : '**falhou**';
    linhas.push(
      `| ${escapar(resultado.id)} | ${escapar(resultado.pergunta)} | ` +
        `${situacao} | ` +
        `${(Number(resultado.ms) / 1000).toFixed(1)} s | ` +
        `${resultado.rodadas ?? '?'} | ` +
        `${escapar(resultado.motivos.join('; ') || '—')} |`,
    );
  }
  linhas.push('');

  linhas.push('## Detalhes');
  linhas.push('');
  for (const resultado of resultados) {
    linhas.push(...detalhes(resultado));
  }

  return `${linhas.join('\n')}\n`;
}

export function formatarEventosJsonl(resultados) {
  return `${resultados
    .map((resultado) =>
      JSON.stringify({
        id: resultado.id,
        pergunta: resultado.pergunta,
        cenario: resultado.cenario,
        inicio: resultado.inicio,
        ms: resultado.ms,
        status_http: resultado.statusHttp,
        ok: resultado.ok,
        motivos: resultado.motivos,
        rodadas: resultado.rodadas,
        ferramentas: resultado.ferramentas,
        chamadas_modelo: resultado.chamadasModelo,
        chamadas_rpc: resultado.chamadasRpc,
        falhas: resultado.falhas,
        eventos: resultado.eventos,
      }),
    )
    .join('\n')}\n`;
}
