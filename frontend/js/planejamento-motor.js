/* ============================================================
   planejamento-motor.js
   Motor do planejamento das bolsas: quem paga a bolsa de cada pessoa,
   mês a mês, até o horizonte, e quanto fica sem cobertura em cada
   cenário.

   Porta fiel de .claude/refazer_mapa_referencia.py (as funções de
   modelo, sem banco, planilha, relatório nem main). A ORDEM das
   operações é parte do resultado: quem fica sem bolsa depende dela.
   O teste tests/planejamento-motor.test.js compara este motor com o
   resultado do Python no fixture caso-mascarado.json.

   Funções puras: sem DOM e sem rede. Expostas como ES module e
   também em window.PlanejamentoMotor (como os parsers).
   ============================================================ */

/**
 * Arredonda com o mesmo resultado de `round(x, 2)` do Python.
 * `toFixed(2)` é especificado como o inteiro n mais próximo de x·10²;
 * como nenhum meio-centavo é representável em binário, não há empate
 * e o resultado coincide com o do Python. `Math.round(x*100)/100` não
 * serve: 2.675 é 2.674999… em binário (Python dá 2.67), mas 2.675*100
 * arredonda para 267.5 e Math.round sobe para 2.68.
 */
export function r2(x) {
  return Number(x.toFixed(2));
}

/** Normalização de nomes do Python: NFKD, só ASCII, minúsculas, espaços colapsados. */
export function norm(s) {
  const t = (s || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase();
  return t.split(/\s+/).filter(Boolean).join(' ');
}

/** 'AAAA-MM-DD' → 'AAAA-MM' (None quando não há data). */
export function mes(d) {
  return d ? d.slice(0, 7) : null;
}

/** Lista de 'AAAA-MM' de `de` até `ate`, inclusive (comparação de string, como no Python). */
export function meses(de, ate) {
  let y = Number(de.slice(0, 4));
  let m = Number(de.slice(5, 7));
  const out = [];
  let atual = `${y}-${String(m).padStart(2, '0')}`;
  while (atual <= ate) {
    out.push(atual);
    m += 1;
    if (m === 13) {
      y += 1;
      m = 1;
    }
    atual = `${y}-${String(m).padStart(2, '0')}`;
  }
  return out;
}

function soma(itens) {
  let total = 0;
  for (const v of itens) total += v;
  return total;
}

function maxStr(a, b) {
  return a >= b ? a : b;
}

function minStr(a, b) {
  return a <= b ? a : b;
}

// ── formatação para as mensagens dos alertas (igual ao Python) ────────────────

function agruparMilhares(s) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function brl(v) {
  const [inteiro, decimal] = Number(v).toFixed(2).split('.');
  return `${agruparMilhares(inteiro)},${decimal}`;
}

function brl0(v) {
  // Python usa f'{v:,.0f}', que arredonda empates para o par.
  const piso = Math.floor(v);
  const resto = v - piso;
  let n;
  if (resto === 0.5) n = piso % 2 === 0 ? piso : piso + 1;
  else n = Math.round(v);
  return agruparMilhares(String(n));
}

/**
 * Monta as pessoas a partir das bolsas do banco + destinos previstos.
 * Devolve a lista já ordenada por (grupo, -alvo, nome), enchendo `alertas`.
 */
export function montarPessoas(dados, premissas, alertas) {
  const ref = dados.ref;
  const fim = premissas.horizonte_ate;
  const so111 = new Set(premissas.filtro_30111.somente.map(norm));
  const achados111 = new Set();
  const excl = premissas.excluir_bolsas.nota_contem;
  const pessoas = new Map();

  const pessoa = (k) => {
    if (!pessoas.has(k)) pessoas.set(k, { nome: null, linhas: [] });
    return pessoas.get(k);
  };

  for (const b of dados.bolsas) {
    if (!b.pessoa) {
      alertas.push(`Bolsa sem bolsista no ${b.cc} (${brl(b.valor)}): ignorada.`);
      continue;
    }
    if (excl.some((x) => (b.nota || '').includes(x))) continue;
    if (b.cc === '30.111') {
      if (!so111.has(norm(b.pessoa))) continue;
      achados111.add(norm(b.pessoa));
    }
    if (b.ate < ref || b.de > fim) continue;
    const k = norm(b.pessoa);
    const p = pessoa(k);
    p.nome = p.nome || b.pessoa;
    p.linhas.push({
      cc: b.cc,
      valor: b.valor,
      de: maxStr(b.de, ref),
      ate: minStr(b.ate, fim),
      origem: 'banco',
    });
  }

  for (const n of so111) {
    if (!achados111.has(n)) {
      alertas.push(`Equipe de Pastagem: "${n}" não tem bolsa no 30.111 no banco. Conferir o nome em premissas.json.`);
    }
  }

  for (const d of premissas.destinos_previstos.itens) {
    const k = norm(d.pessoa);
    const p = pessoa(k);
    const cobertos = new Set();
    for (const l of p.linhas) {
      if (l.cc === d.cc) for (const m of meses(l.de, l.ate)) cobertos.add(m);
    }
    const janela = meses(maxStr(d.de, ref), minStr(d.ate, fim));
    const faltam = janela.filter((m) => !cobertos.has(m));
    if (!faltam.length) {
      alertas.push(
        `Premissa virou dado: ${d.pessoa} já está no banco no ${d.cc} em todo o período previsto. ` +
          'Tirar de premissas.json.'
      );
      continue;
    }
    if (faltam.length < janela.length) {
      alertas.push(
        `Premissa em parte coberta pelo banco: ${d.pessoa} no ${d.cc}; uso só ${rotuloMes(faltam[0])}–${rotuloMes(
          faltam[faltam.length - 1]
        )}.`
      );
    }
    p.nome = p.nome || d.pessoa;
    p.linhas.push({
      cc: d.cc,
      valor: d.valor,
      de: faltam[0],
      ate: faltam[faltam.length - 1],
      origem: 'premissa',
    });
  }

  const out = [];
  for (const p of pessoas.values()) {
    if (!p.linhas.length) continue;
    const ativas = (m) => p.linhas.filter((l) => l.de <= m && m <= l.ate);
    const primeiro = p.linhas.reduce((menor, l) => (l.de < menor ? l.de : menor), p.linhas[0].de);
    const base = ativas(ref).length ? ref : primeiro;
    const doMes = ativas(base);
    out.push({
      nome: p.nome,
      grupo: [...new Set(doMes.map((l) => l.cc))].sort().join(' + '),
      alvo: r2(soma(doMes.map((l) => l.valor))),
      desde: base,
      linhas: p.linhas,
      base_linhas: doMes.map((l) => [l.cc, l.valor]),
    });
  }

  return out.sort((a, b) => {
    if (a.grupo !== b.grupo) return a.grupo < b.grupo ? -1 : 1;
    if (a.alvo !== b.alvo) return b.alvo - a.alvo;
    if (a.nome === b.nome) return 0;
    return a.nome < b.nome ? -1 : 1;
  });
}

const ROTM = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 'AAAA-MM' → 'mmm/AA' (só mensagens). */
function rotuloMes(m) {
  return `${ROTM[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
}

/**
 * O banco não tem a situação "pausada": bolsa pausada na FUNAPE fica "ativa" e o
 * saldo_livre a desconta como compromisso. O mapa não conta essas bolsas
 * (premissas: excluir_bolsas), então devolve à fonte o que foi descontado.
 */
export function devolverExcluidas(cc, c, dados, premissas) {
  const ini = c.compromissos_inicio;
  const fim = c.compromissos_fim;
  if (!ini || !fim) return 0.0;
  const excl = premissas.excluir_bolsas.nota_contem;
  let v = 0.0;
  for (const b of dados.bolsas) {
    if (b.cc === cc && b.status === 'active' && excl.some((x) => (b.nota || '').includes(x))) {
      const de = maxStr(b.de, ini);
      const ate = minStr(b.ate, fim);
      if (de <= ate) v += b.valor * meses(de, ate).length;
    }
  }
  return v;
}

/** Valor disponível de uma fonte hoje, e a frase que explica de onde saiu. */
export function valorFonte(f, dados, premissas) {
  if (f.base === 'fixo') return [Number(f.valor), 'fixo em premissas.json'];
  let c = dados.centros[f.cc] || {};
  if (!c.existe) return [0.0, 'centro não existe no banco'];
  const dev = devolverExcluidas(f.cc, c, dados, premissas);
  if (dev) {
    c = {
      ...c,
      compromissos_bolsas: Number(c.compromissos_bolsas) - dev,
      grupos: {
        ...c.grupos,
        a: { ...(c.grupos.a || {}), livre: Number((c.grupos.a || {}).livre || 0) + dev },
      },
    };
  }
  const caixa = c.caixa;
  const livreCaixa = caixa === null || caixa === undefined ? null : Number(caixa) - Number(c.compromissos_bolsas);
  const extra = dev ? `; + ${brl0(dev)} de bolsas pausadas que o banco desconta` : '';
  if (f.base === 'livre_pessoal') {
    const v = Number((c.grupos.a || {}).livre || 0);
    return [
      Math.max(v, 0.0),
      `livre de Pessoal (saldo_livre, balancete ${c.balancete || 'nenhum'})${extra}`,
    ];
  }
  if (f.base === 'livre_total_limitado_caixa') {
    const tot = soma(Object.values(c.grupos || {}).map((g) => Math.max(Number(g.livre || 0), 0)));
    const v = livreCaixa === null ? tot : Math.min(tot, livreCaixa);
    return [
      Math.max(v, 0.0),
      `livre somado ${brl0(tot)}; caixa − bolsas ${
        livreCaixa !== null ? brl0(livreCaixa) : '—'
      } (balancete ${c.balancete || 'nenhum'})`,
    ];
  }
  if (f.base === 'caixa_menos') {
    if (livreCaixa === null) return [0.0, 'sem balancete'];
    return [
      Math.max(livreCaixa - Number(f.menos || 0), 0.0),
      `caixa − bolsas − ${brl0(f.menos || 0)} (balancete ${c.balancete})`,
    ];
  }
  throw new Error(String(f.base));
}

/** Fontes de hoje: valor, janela e explicação de cada item de premissas.fontes. */
export function fontesDoDia(dados, premissas) {
  const out = {};
  for (const f of premissas.fontes.itens) {
    const [v, como] = valorFonte(f, dados, premissas);
    const de = f.de === 'ref' ? dados.ref : maxStr(f.de, dados.ref);
    let ate = f.ate;
    if (ate === 'fim_do_cc') {
      const c = dados.centros[f.cc];
      ate = mes(c ? c.fim : null) || premissas.horizonte_ate;
    }
    out[f.codigo] = { ...f, valor_hoje: r2(v), como, de_hoje: de, ate_hoje: ate };
  }
  return out;
}

/**
 * Valor a manter no mês. Com 'encerra_com_cc' (decisão "o projeto acabou"), a parte
 * da bolsa que vinha de um desses centros deixa de ser necessidade depois do fim
 * dele; sem a opção, a pessoa continua com o valor inteiro.
 */
export function alvoNoMes(p, m, cen) {
  const fins = cen._fins || {};
  const encerra = cen.encerra_com_cc || [];
  const corte = soma(p.base_linhas.filter(([cc]) => encerra.includes(cc) && fins[cc] && m > fins[cc]).map(([, v]) => v));
  return r2(p.alvo - corte);
}

/**
 * Aloca, mês a mês, a falta de cada pessoa nas fontes do cenário.
 * Fontes com teto mensal pagam primeiro; entre as demais, a que vence antes.
 * A ordenação parte da ordem de `cen.fontes` e é estável.
 */
export function alocar(pessoas, fontes, cen, M) {
  // Map (e não objeto) porque as chaves "118"/"111"/… do objeto sairiam na ordem
  // numérica, e a ordem de inserção decide quem paga quando o empate é total.
  const fs = new Map();
  for (const k of cen.fontes) {
    const semTetoNaFonte = fontes[k].teto_mes === undefined ? null : fontes[k].teto_mes;
    fs.set(k, {
      saldo: fontes[k].valor_hoje,
      de: fontes[k].de_hoje,
      ate: fontes[k].ate_hoje,
      teto: k === 'GC' && cen.gc_sem_teto ? null : semTetoNaFonte,
    });
  }
  const usado = {};
  const para_gc = {};
  for (const k of fs.keys()) {
    usado[k] = 0.0;
    para_gc[k] = 0.0;
  }
  const mapa = {};

  for (const m of M) {
    for (const k of cen.sobras_para_gc || []) {
      const f = fs.get(k);
      if (f && fs.has('GC') && f.ate < m && f.saldo > 0) {
        para_gc[k] += f.saldo;
        fs.get('GC').saldo += f.saldo;
        f.saldo = 0;
      }
    }
    const noMes = {};
    const ordenadas = [...fs.keys()].sort((a, b) => {
      const ta = fs.get(a).teto === null ? 1 : 0;
      const tb = fs.get(b).teto === null ? 1 : 0;
      if (ta !== tb) return ta - tb;
      const aa = fs.get(a).ate;
      const bb = fs.get(b).ate;
      if (aa === bb) return 0;
      return aa < bb ? -1 : 1;
    });
    for (const p of pessoas) {
      const chave = `${p.nome}|${m}`;
      if (m < p.desde) {
        mapa[chave] = [];
        continue;
      }
      const cel = p.linhas.filter((l) => l.de <= m && m <= l.ate).map((l) => [l.cc, l.valor]);
      let falta = r2(alvoNoMes(p, m, cen) - soma(cel.map(([, v]) => v)));
      for (const k of ordenadas) {
        if (falta <= 0) break;
        const f = fs.get(k);
        if (!(f.de <= m && m <= f.ate) || f.saldo <= 0) continue;
        const pode = Math.min(falta, f.saldo, f.teto ? f.teto - (noMes[k] || 0) : falta);
        if (pode <= 0) continue;
        f.saldo -= pode;
        usado[k] += pode;
        noMes[k] = (noMes[k] || 0) + pode;
        falta = r2(falta - pode);
        cel.push([`→${k}`, pode]);
      }
      if (falta > 0) cel.push(['SEM', falta]);
      mapa[chave] = cel;
    }
  }

  const sem_mes = {};
  for (const m of M) {
    sem_mes[m] = soma(
      pessoas.flatMap((p) => (mapa[`${p.nome}|${m}`] || []).filter(([k]) => k === 'SEM').map(([, v]) => v))
    );
  }
  const sem_grupo = {};
  for (const p of pessoas) {
    let total = 0;
    for (const m of M) {
      for (const [k, v] of mapa[`${p.nome}|${m}`] || []) if (k === 'SEM') total += v;
    }
    sem_grupo[p.grupo] = (sem_grupo[p.grupo] || 0) + total;
  }
  const sobra = {};
  for (const [k, f] of fs) sobra[k] = f.saldo;

  return {
    mapa,
    usado,
    sobra,
    para_gc,
    sem_mes,
    sem_grupo,
    total_sem: soma(Object.values(sem_mes)),
  };
}

function diasEntre(isoA, isoB) {
  const em = (s) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((em(isoA) - em(isoB)) / 86400000);
}

/** Alertas sobre o estado dos centros e sobre premissas que não cabem no plano. */
export function checar(dados, pessoas, fontes, alertas) {
  const hoje = dados.lido_em.slice(0, 10);
  for (const [cc, c] of Object.entries(dados.centros)) {
    if (!c.existe) {
      alertas.push(`${cc}: não existe no banco.`);
      continue;
    }
    if (!c.tem_plano) alertas.push(`${cc}: sem plano de trabalho ativo no banco.`);
    if (!c.tem_balancete) {
      alertas.push(`${cc}: sem balancete; o livre é o previsto do plano, não o caixa.`);
    } else if (diasEntre(hoje, c.balancete) > 45) {
      alertas.push(`${cc}: balancete de ${c.balancete}, com mais de 45 dias.`);
    }
  }
  // premissas de bolsa que o centro precisa pagar além do que o banco já desconta
  const extra = new Map();
  for (const p of pessoas) {
    for (const l of p.linhas) {
      if (l.origem === 'premissa') {
        extra.set(l.cc, (extra.get(l.cc) || 0) + l.valor * meses(l.de, l.ate).length);
      }
    }
  }
  for (const [cc, v] of extra) {
    const c = dados.centros[cc] || {};
    const livre = Number(((c.grupos || {}).a || {}).livre || 0);
    const caixa = c.caixa;
    let msg = `${cc}: as bolsas previstas e ainda não implantadas somam ${brl0(v)}; o livre de Pessoal no banco é ${brl0(livre)}`;
    if (caixa !== null && caixa !== undefined) {
      msg += ` e o caixa (balancete ${c.balancete}) é ${brl0(Number(caixa))}`;
    }
    if (v > livre + 0.01) alertas.push(`${msg}. NÃO CABE no plano: conferir.`);
    else if (caixa !== null && caixa !== undefined && v > Number(caixa)) {
      alertas.push(`${msg}. Cabe no plano, mas o caixa de hoje não cobre: depende das parcelas a receber.`);
    } else alertas.push(`${msg}. Cabe.`);
  }
}

/**
 * Necessidade = pago pelos centros + usado das fontes + sem cobertura, em cada
 * cenário. Se não fechar, o modelo errou: lança Error (no Python era sys.exit).
 */
export function conservacao(pessoas, res, M, cens) {
  for (const [cod, r] of Object.entries(res)) {
    let nec = 0.0;
    let cob = 0.0;
    let usado = 0.0;
    let sem = 0.0;
    for (const p of pessoas) {
      for (const m of M) {
        if (m < p.desde) continue;
        const alvo = alvoNoMes(p, m, cens[cod]);
        nec += alvo;
        for (const [k, v] of r.mapa[`${p.nome}|${m}`]) {
          if (k === 'SEM') sem += v;
          else if (k.startsWith('→')) usado += v;
          else cob += Math.min(v, alvo);
        }
      }
    }
    const usadoFontes = soma(Object.values(r.usado));
    if (Math.abs(nec - cob - usado - sem) > 1 || Math.abs(usado - usadoFontes) > 1) {
      throw new Error(
        `conservação falhou no cenário ${cod}: necessidade ${nec.toFixed(2)} ≠ ${cob.toFixed(2)} + ${usado.toFixed(
          2
        )} + ${sem.toFixed(2)}`
      );
    }
  }
}

/**
 * Entrada do motor: faz o mesmo que o trecho de main() entre montar_pessoas e
 * conservacao, inclusive os `_fins` dos cenários.
 *
 * @returns {{meses: string[], pessoas: object[], fontes: object, cenarios: object, alertas: string[]}}
 */
export function calcular(dados, premissas) {
  const alertas = [];
  const pessoas = montarPessoas(dados, premissas, alertas);
  const fontes = fontesDoDia(dados, premissas);
  checar(dados, pessoas, fontes, alertas);
  const M = meses(dados.ref, premissas.horizonte_ate);
  const fins = {};
  for (const [cc, c] of Object.entries(dados.centros)) {
    if (c.existe) fins[cc] = mes(c.fim);
  }
  const cens = {};
  for (const c of premissas.cenarios) cens[c.codigo] = { ...c, _fins: fins };
  const cenarios = {};
  for (const [k, c] of Object.entries(cens)) cenarios[k] = alocar(pessoas, fontes, c, M);
  conservacao(pessoas, cenarios, M, cens);
  return { meses: M, pessoas, fontes, cenarios, alertas };
}

if (typeof window !== 'undefined') {
  window.PlanejamentoMotor = {
    r2,
    norm,
    mes,
    meses,
    montarPessoas,
    devolverExcluidas,
    valorFonte,
    fontesDoDia,
    alvoNoMes,
    alocar,
    checar,
    conservacao,
    calcular,
  };
}
