// A mesma tradução de caracteres de public.norm_item (migração 053).
export function chaveItemPlano(descricao) {
  const acentos = 'áàâãäéèêëíìîïóòôõöúùûüç';
  const letras = 'aaaaaeeeeiiiiooooouuuuc';
  return (descricao ?? '').toLowerCase().replace(/[áàâãäéèêëíìîïóòôõöúùûüç]/g,
    (letra) => letras[acentos.indexOf(letra)]
  ).replace(/[^a-z0-9]+/g, ' ').trim();
}

const centavos = (n) => Math.round(Number(n) * 100);

export function execucaoConferida(detalhe, rubrica) {
  return Boolean(detalhe?.fecha && rubrica &&
    centavos(detalhe.previsto) === centavos(rubrica.previsto) &&
    centavos(detalhe.realizado) === centavos(rubrica.realizado));
}

export function indexarExecucaoRubricas(rubricas) {
  return new Map(rubricas.map((r) => {
    const itens = new Map();
    let somaItens = 0;
    for (const item of r.detalhes) {
      const chave = chaveItemPlano(item.descricao);
      somaItens += centavos(item.realizado);
      if (chave) itens.set(chave, {
        previsto: item.previsto, realizado: item.realizado, saldo: item.saldo, vinculado: false,
      });
    }
    const realizadoSemItem = Number(r.realizado_sem_item);
    let temSemItem = realizadoSemItem !== 0;
    let somaContas = 0;
    for (const conta of r.contas) {
      const valor = centavos(conta.realizado);
      if (valor === 0) continue;
      somaContas += valor;
      const item = itens.get(chaveItemPlano(conta.item));
      if (item) item.vinculado = true;
      else temSemItem = true;
    }
    return [r.rubrica_code, {
      itens, temSemItem,
      fecha: itens.size === r.detalhes.length && somaContas === centavos(r.realizado) &&
        somaItens + centavos(realizadoSemItem) === somaContas,
      previsto: r.previsto,
      realizado: r.realizado,
      previstoSemDescricao: Number(r.previsto_sem_descricao),
      realizadoSemItem,
      realizadoVinculadoCentavos: somaItens,
    }];
  }));
}

export function execucaoDoItem(detalhe, rubrica, linha, chaveUnica, linhaUnica) {
  // A máscara protege o rótulo de apresentação, mas muda sua identidade.
  if (linha.rotulo.includes('***.***.***-**')) return null;
  const item = detalhe?.itens.get(chaveItemPlano(linha.rotulo));
  if (!item || !chaveUnica || !execucaoConferida(detalhe, rubrica) ||
      centavos(item.previsto) !== centavos(linha.valor)) return null;

  const unico = linhaUnica && detalhe.itens.size === 1 && detalhe.previstoSemDescricao === 0 &&
    centavos(item.previsto) === centavos(rubrica.previsto);
  const totalCompromissos = rubrica.compromissos == null || String(rubrica.compromissos).trim() === ''
    ? null : Number(rubrica.compromissos);
  const compromissos = Number.isFinite(totalCompromissos) && (unico || totalCompromissos === 0)
    ? totalCompromissos : null;
  const realizado = item.vinculado || !detalhe.temSemItem ? item.realizado : null;
  const saldoLivre = detalhe.temSemItem || compromissos == null
    ? null : (centavos(item.saldo) - centavos(compromissos)) / 100;
  return { realizado, compromissos, saldo_livre: saldoLivre };
}
