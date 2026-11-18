/* ============================================================
   Planejamento por continuações (18/11/2026, pedido do Victor).

   A conta antiga (planejamento-motor.js, alocar) reparte o dinheiro mês a
   mês, pessoa a pessoa, e troca de fonte quando uma acaba: no caso de 17/11,
   19 pessoas trocavam de fonte no caminho e saíam 25 pedaços de bolsa de 1
   ou 2 meses. Implantar bolsa é burocrático; ninguém faria isso.

   Aqui a unidade é a CONTINUAÇÃO de cada pessoa: os meses, dentro do período
   escolhido, em que a bolsa atual não cobre o valor a manter (alvoNoMes do
   motor). O valor pode ter degraus (pessoa em dois projetos que acabam em
   datas diferentes). Cada continuação tem um destino:
   - pedaços em sequência, cada um de uma fonte e com pelo menos N meses (o
     último pode ser menor só se fecha a continuação); opcionalmente um
     complemento fixo por mês de outra fonte (só por escolha manual: o
     guarda-chuva completando uma bolsa maior);
   - "não continua" (só por decisão humana);
   - nenhum (fica sem dinheiro). A cobertura pode ser parcial: paga até onde
     der e o resto fica sem dinheiro.
   Primeira versão exigia uma ou duas fontes para a continuação inteira: a
   falta do caso de 17/11 dobrava (quase nenhuma fonte vai até dez/27).

   A sugestão automática anda em rodadas, como a conta mês a mês, mas em
   blocos de N meses: a cada rodada, quem precisa primeiro ganha o próximo
   bloco, da mesma fonte do bloco anterior se der, senão da que acaba primeiro
   entre as que pagam o bloco inteiro sem deixar o saldo dela negativo em mês
   nenhum (o razão mês a mês abaixo) e sem passar do teto mensal. O dinheiro
   se espalha por igual; quem para por falta de dinheiro fica "em disputa" e
   a reunião decide quem vai além.
   Tentativas descartadas (18/11, caso de 17/11): por grupos de quem começa
   no mesmo mês, o grupo de abr/27 levava o dinheiro todo e o de mai/27 ficava
   sem nada; "todos até o mesmo mês" travava em mai/27 (quem começa em abr/mai
   não fecha 3 meses) e deixava R$ 1,16 mi parado.

   As decisões manuais entram antes de tudo, valendo ou não (estouro aparece).
   Funções puras; tests/planejamento-continuacoes.test.js.
   ============================================================ */

import { alvoNoMes, meses, r2 } from './planejamento-motor.js';

const pai = k => String(k).split('·')[0];
const EPS = 0.005;

/** As continuações: por pessoa, os meses a partir de `inicio` em que a bolsa atual não cobre o alvo. */
export function continuacoes({ pessoas, cen, ref, inicio, fim }) {
  const M = meses(ref, fim);
  const out = [];
  for (const p of pessoas) {
    const nec = {};
    const antes = {};
    for (const m of M) {
      if (m < p.desde) continue;
      const proprio = p.linhas.filter(l => l.de <= m && m <= l.ate).reduce((s, l) => s + Number(l.valor), 0);
      const falta = r2(alvoNoMes(p, m, cen) - proprio);
      if (falta <= EPS) continue;
      if (m < inicio) antes[m] = falta; else nec[m] = falta;
    }
    const ms = Object.keys(nec).sort();
    if (!ms.length && !Object.keys(antes).length) continue;
    const fimAtual = p.linhas.reduce((x, l) => (l.ate > x ? l.ate : x), p.linhas[0]?.ate || ref);
    out.push({
      id: p.nome, grupo: p.grupo, alvo: p.alvo, fimAtual,
      de: ms[0] || null, ate: ms[ms.length - 1] || null,
      meses: ms,
      nec, antes,
      total: r2(Object.values(nec).reduce((s, v) => s + v, 0)),
    });
  }
  return out;
}

/**
 * As fontes ligadas, cada uma com o dinheiro que chega em cada mês. `pedacos` são as fontes do motor
 * (fontesDoDia), em que um projeto pode vir partido por parcela ("118", "118·p2"); aqui elas se juntam
 * de novo no "pai", com a chegada no mês de cada pedaço.
 */
export function fontesDosPedacos({ pedacos, itens, ligadas, cen, ref, semAEntrar = false }) {
  const out = new Map();
  for (const it of itens) {
    if (!ligadas.includes(it.codigo)) continue;
    const ps = Object.values(pedacos).filter(f => pai(f.codigo) === it.codigo && !(semAEntrar && f.situacao === 'a_entrar'));
    const chegadas = {};
    let de = null, ate = null;
    for (const f of ps) {
      const v = Number(f.valor_hoje || 0);
      if (v <= EPS) continue;
      const m = f.de_hoje > ref ? f.de_hoje : ref;
      chegadas[m] = r2((chegadas[m] || 0) + v);
      if (!de || m < de) de = m;
      if (!ate || f.ate_hoje > ate) ate = f.ate_hoje;
    }
    const teto = it.codigo === 'GC' && cen.gc_sem_teto ? null : (it.teto_mes ?? null);
    out.set(it.codigo, { codigo: it.codigo, chegadas, de, ate: ate || it.ate || null, teto });
  }
  return out;
}

/** O que uma continuação paga a cada fonte, por mês, com um destino. Devolve também o que fica sem dinheiro. */
export function pagamentosDe(c, destino) {
  const pag = {};
  const sem = {};
  const nao = {};
  const soma = (k, m, v) => { if (v > EPS) { pag[k] = pag[k] || {}; pag[k][m] = r2((pag[k][m] || 0) + v); } };
  for (const m of c.meses) {
    let falta = c.nec[m] || 0;
    if (falta <= EPS) continue;
    if (destino?.tipo === 'nao') { nao[m] = falta; continue; }
    if (destino?.tipo === 'fonte') {
      const comp = destino.complemento;
      if (comp && comp.fonte && comp.valor > 0) {
        const v = Math.min(falta, comp.valor);
        soma(comp.fonte, m, v);
        falta = r2(falta - v);
      }
      const seg = (destino.segmentos || []).find(s => s.de <= m && m <= s.ate);
      if (seg && falta > EPS) { soma(seg.fonte, m, falta); falta = 0; }
    }
    if (falta > EPS) sem[m] = falta;
  }
  return { pag, sem, nao };
}

/** Junta pagamentos ({fonte: {mês: valor}}) sem mexer nos originais. */
function juntar(a, b) {
  const out = {};
  for (const x of [a, b]) {
    for (const [k, ms] of Object.entries(x || {})) {
      out[k] = out[k] || {};
      for (const [m, v] of Object.entries(ms)) out[k][m] = r2((out[k][m] || 0) + v);
    }
  }
  return out;
}

/**
 * O razão de cada fonte mês a mês: entra, usa, saldo no fim do mês e onde estoura (saldo negativo, pagamento
 * fora da janela da fonte ou acima do teto). Fonte em `sobrasParaGC` que acabou passa o que sobrou ao
 * guarda-chuva no mês seguinte ao fim (a mesma regra do motor).
 */
export function razao(fontes, pagamentos, { M, sobrasParaGC = [] }) {
  const out = {};
  const saldo = {};
  const passou = new Set();
  for (const [k, f] of fontes) {
    out[k] = { entra: {}, usa: {}, saldo: {}, estouro: [], para_gc: 0, de: f.de, ate: f.ate, teto: f.teto };
    saldo[k] = 0;
  }
  const temGC = fontes.has('GC');
  for (const m of M) {
    // 1. O que chega no mês (antes da passagem ao guarda-chuva: fonte que acabou antes de ref chega em ref e já
    //    passa no mesmo mês, como no motor).
    for (const [k, f] of fontes) {
      const chega = f.chegadas[m] || 0;
      if (chega) { out[k].entra[m] = r2((out[k].entra[m] || 0) + chega); saldo[k] = r2(saldo[k] + chega); }
    }
    if (temGC) {
      for (const k of sobrasParaGC) {
        const f = fontes.get(k);
        if (!f || k === 'GC' || passou.has(k) || !(f.ate && f.ate < m) || saldo[k] <= EPS) continue;
        out[k].para_gc = r2(out[k].para_gc + saldo[k]);
        out.GC.entra[m] = r2((out.GC.entra[m] || 0) + saldo[k]);
        saldo.GC = r2(saldo.GC + saldo[k]);
        saldo[k] = 0;
        passou.add(k);
      }
    }
    for (const [k, f] of fontes) {
      const usa = pagamentos[k]?.[m] || 0;
      if (usa) {
        out[k].usa[m] = usa;
        saldo[k] = r2(saldo[k] - usa);
        if (!f.de || m < f.de || !f.ate || m > f.ate) out[k].estouro.push({ m, motivo: 'fora' });
        else if (saldo[k] < -EPS) out[k].estouro.push({ m, motivo: 'saldo' });
        if (f.teto != null && usa > f.teto + EPS) out[k].estouro.push({ m, motivo: 'teto' });
      }
      out[k].saldo[m] = saldo[k];
    }
  }
  for (const k of Object.keys(out)) out[k].sobra = Math.max(0, saldo[k]);
  for (const k of Object.keys(pagamentos)) {
    if (!out[k]) out[k] = { entra: {}, usa: pagamentos[k], saldo: {}, estouro: Object.keys(pagamentos[k]).map(m => ({ m, motivo: 'desligada' })), para_gc: 0, sobra: 0 };
  }
  return out;
}

const chavesEstouro = rz => new Set(Object.entries(rz).flatMap(([k, x]) => x.estouro.map(e => `${k}|${e.m}|${e.motivo}`)));

/**
 * Distribui as continuações. `manuais` = {id: destino} decididos na tela. Devolve, por continuação, o destino
 * usado e a situação: 'manual'; 'nao' (não continua); 'sugestao' (coberta inteira); 'disputa' (parou por falta
 * de dinheiro em `ateCoberto`: a reunião decide quem vai além); 'sem_fonte' (motivo 'alcance': nenhuma fonte
 * ligada paga o mês seguinte).
 *
 * Cada destino é uma sequência de pedaços, cada um de uma fonte e com pelo menos N meses (o último pode ser
 * menor só se termina a continuação). Nunca troca de fonte mês a mês.
 */
export function distribuir({ conts, fontes, manuais = {}, M, N: nPedido = 3, sobrasParaGC = [] }) {
  const N = Math.max(1, Math.floor(Number(nPedido)) || 1);
  const ordemFontes = [...fontes.values()].filter(f => f.ate && f.de).sort((a, b) => (a.ate === b.ate ? 0 : a.ate < b.ate ? -1 : 1)).map(f => f.codigo);
  const destinos = {};
  let pag = {};

  // 1. Decisões manuais primeiro, valendo ou não.
  for (const c of conts) {
    const d = manuais[c.id];
    if (!d || !c.meses.length) continue;
    destinos[c.id] = { ...d, situacao: d.tipo === 'nao' ? 'nao' : 'manual' };
    pag = juntar(pag, pagamentosDe(c, d).pag);
  }
  const rzBase = razao(fontes, pag, { M, sobrasParaGC });
  const estourosBase = chavesEstouro(rzBase);
  // Onde a decisão manual já estourou, a sugestão não põe mais ninguém: piorar o mesmo estouro não cria chave
  // nova. Saldo negativo é cumulativo: a fonte inteira fica de fora. Teto ou pagamento fora da janela: só aquele
  // mês. Se o guarda-chuva ficou negativo, as fontes que passam sobra para ele também ficam de fora.
  const cheias = new Set();
  const mesesBloqueados = new Set();
  for (const [k, x] of Object.entries(rzBase)) {
    for (const e of x.estouro) {
      if (e.motivo === 'saldo' || e.motivo === 'desligada') cheias.add(k); else mesesBloqueados.add(`${k}|${e.m}`);
    }
  }
  if (cheias.has('GC')) sobrasParaGC.forEach(k => cheias.add(k));
  const cabe = (pedaco, pagAtual) => {
    for (const [k, ms] of Object.entries(pedaco)) {
      if (cheias.has(k) || Object.keys(ms).some(m => mesesBloqueados.has(`${k}|${m}`))) return null;
    }
    const novo = juntar(pagAtual, pedaco);
    for (const x of chavesEstouro(razao(fontes, novo, { M, sobrasParaGC }))) if (!estourosBase.has(x)) return null;
    return novo;
  };
  // Pagamentos de uma fonte para os meses [i, j) da continuação.
  const trecho = (c, k, i, j) => ({ [k]: Object.fromEntries(c.meses.slice(i, j).filter(m => c.nec[m] > EPS).map(m => [m, c.nec[m]])) });

  // 2. As continuações sem decisão manual avançam em rodadas, como a conta mês a mês, mas em blocos: a cada
  // rodada, quem precisa primeiro ganha o próximo bloco de N meses (o que falta, se for menos de 2N, vai
  // inteiro, para não sobrar rabo curto). Prefere a fonte do bloco anterior (não troca à toa) e, se ela só paga
  // parte do bloco, alonga o pedaço dela enquanto o que sobra continuar com pelo menos N meses; senão, a que
  // acaba primeiro entre as que pagam o bloco inteiro. O dinheiro se espalha por igual e ninguém ganha bolsa de
  // 1 mês. Quando alguém para por falta de dinheiro que outros usaram, fica "em disputa" junto com quem recebe
  // dessas mesmas fontes daquele mês em diante: a reunião decide quem vai além.
  const pagBase = pag;
  const livres = conts.filter(c => c.meses.length && !manuais[c.id]);
  const cursor = Object.fromEntries(livres.map(c => [c.id, 0]));
  const segs = Object.fromEntries(livres.map(c => [c.id, []]));
  const parado = new Set();
  const paradas = [];   // { c, i, fontes }: quem parou por dinheiro que outros usaram, e as fontes que a pagariam
  const pegar = (c, k, i, j) => {
    const s = segs[c.id];
    if (s.length && s[s.length - 1].fonte === k) s[s.length - 1].ate = c.meses[j - 1];
    else s.push({ fonte: k, de: c.meses[i], ate: c.meses[j - 1] });
    cursor[c.id] = j;
  };
  // Bloco de tamanho L a partir de i: tenta L e, quando o resto fecharia a continuação, tamanhos menores (mínimo N).
  const tamanhos = (i, L, total) => {
    const out = [L];
    if (i + L === total) for (let x = L - 1; x >= N; x--) out.push(x);
    return out;
  };
  for (let volta = 0; volta < 1000; volta++) {
    const ativos = livres.filter(c => !parado.has(c.id) && cursor[c.id] < c.meses.length)
      .sort((a, b) => (a.meses[cursor[a.id]] < b.meses[cursor[b.id]] ? -1 : a.meses[cursor[a.id]] > b.meses[cursor[b.id]] ? 1 : 0) || b.total - a.total || (a.id < b.id ? -1 : 1));
    if (!ativos.length) break;
    for (const c of ativos) {
      const i = cursor[c.id], n = c.meses.length, resto = n - i;
      const L = resto < 2 * N ? resto : N;
      const ultima = segs[c.id].length ? segs[c.id][segs[c.id].length - 1].fonte : null;
      let feito = false;
      // A mesma fonte, alongando: o bloco inteiro, ou o que ela ainda paga, se depois sobrarem N meses ou mais.
      if (ultima) {
        let j = i, p = pag;
        while (j < i + L) { const nv = cabe(trecho(c, ultima, j, j + 1), p); if (!nv) break; p = nv; j++; }
        if (j === i + L || (j > i && n - j >= N)) { pag = p; pegar(c, ultima, i, j); feito = true; }
      }
      if (!feito) {
        fora: for (const tam of tamanhos(i, L, n)) {
          for (const k of ordemFontes) {
            if (k === ultima) continue;
            const nv = cabe(trecho(c, k, i, i + tam), pag);
            if (nv) { pag = nv; pegar(c, k, i, i + tam); feito = true; break fora; }
          }
        }
      }
      if (feito) continue;
      parado.add(c.id);
      // Sem os outros (só as decisões manuais e o que ela mesma já usou), alguma fonte a pagaria? Então parou por
      // dinheiro que outros usaram. Vale também alongar 1 mês a fonte que ela já usa.
      const comOProprio = juntar(pagBase, pagamentosDe({ ...c, meses: c.meses.slice(0, i) }, { tipo: 'fonte', segmentos: segs[c.id] }).pag);
      const pagariam = ordemFontes.filter(k => cabe(trecho(c, k, i, i + (k === ultima ? 1 : Math.min(N, resto))), comOProprio));
      if (pagariam.length) paradas.push({ c, i, fontes: new Set(pagariam) });
    }
  }
  // Em disputa: quem parou assim e quem recebe dessas fontes do mês em que ela parou em diante.
  const disputados = new Set(paradas.map(x => x.c.id));
  for (const c of livres) {
    if (disputados.has(c.id)) continue;
    const meu = pagamentosDe({ ...c, meses: c.meses.slice(0, cursor[c.id]) }, { tipo: 'fonte', segmentos: segs[c.id] }).pag;
    if (paradas.some(x => [...x.fontes].some(k => Object.keys(meu[k] || {}).some(m => m >= x.c.meses[x.i])))) disputados.add(c.id);
  }
  for (const c of livres) {
    const s = segs[c.id];
    const d = { tipo: s.length ? 'fonte' : 'nenhum', segmentos: s, ateCoberto: s.length ? s[s.length - 1].ate : null };
    if (disputados.has(c.id)) { destinos[c.id] = { ...d, situacao: 'disputa' }; continue; }
    if (cursor[c.id] >= c.meses.length) { destinos[c.id] = { ...d, situacao: 'sugestao' }; continue; }
    const seguinte = c.meses[cursor[c.id]];
    const alguem = ordemFontes.some(k => fontes.get(k).de <= seguinte && seguinte <= fontes.get(k).ate);
    destinos[c.id] = { ...d, situacao: 'sem_fonte', motivo: alguem ? 'dinheiro' : 'alcance' };
  }
  const disp = livres.filter(c => disputados.has(c.id));
  const disputas = disp.length ? [{
    desde: paradas.map(x => x.c.meses[x.i]).sort()[0] || null,
    ids: disp.map(c => c.id),
    // Fontes disputadas (as que pagariam quem parou, se os outros não estivessem nelas).
    fontes: ordemFontes.filter(k => paradas.some(x => x.fontes.has(k))),
    // Fontes que, com tudo como está, ainda pagam um bloco a alguém que parou (em geral nenhuma).
    comEspaco: ordemFontes.filter(k => paradas.some(x => cabe(trecho(x.c, k, x.i, x.i + Math.min(N, x.c.meses.length - x.i)), pag))),
  }] : [];
  return { destinos, pagamentos: pag, disputas };
}

/**
 * O resultado no formato de um cenário do motor (mapa pessoa|mês, usado, sobra, para_gc, sem_mes, total_sem),
 * para o resto da tela desenhar igual. No mapa: [cc, v] = a bolsa atual; ['→fonte', v]; ['SEM', v];
 * ['NAO', v] = não continua (não é falta nem custo).
 */
export function comoCenario({ pessoas, conts, dist, fontes, Mvista, M, sobrasParaGC = [] }) {
  const porId = Object.fromEntries(conts.map(c => [c.id, c]));
  const rz = razao(fontes, dist.pagamentos, { M, sobrasParaGC });
  const mapa = {};
  const sem_mes = Object.fromEntries(Mvista.map(m => [m, 0]));
  for (const p of pessoas) {
    const c = porId[p.nome];
    const pg = c ? pagamentosDe(c, dist.destinos[c.id]) : { pag: {}, sem: {}, nao: {} };
    for (const m of Mvista) {
      if (m < p.desde) { mapa[`${p.nome}|${m}`] = []; continue; }
      const cel = p.linhas.filter(l => l.de <= m && m <= l.ate).map(l => [l.cc, Number(l.valor)]);
      for (const [k, ms] of Object.entries(pg.pag)) if (ms[m]) cel.push([`→${k}`, ms[m]]);
      if (pg.sem[m]) { cel.push(['SEM', pg.sem[m]]); sem_mes[m] = r2(sem_mes[m] + pg.sem[m]); }
      if (pg.nao[m]) cel.push(['NAO', pg.nao[m]]);
      mapa[`${p.nome}|${m}`] = cel;
    }
  }
  const usado = {}, sobra = {}, para_gc = {};
  for (const [k, x] of Object.entries(rz)) {
    usado[k] = r2(Object.values(x.usa).reduce((s, v) => s + v, 0));
    sobra[k] = r2(x.sobra || 0);
    para_gc[k] = r2(x.para_gc || 0);
  }
  return { mapa, usado, sobra, para_gc, sem_mes, total_sem: r2(Object.values(sem_mes).reduce((s, v) => s + v, 0)), razao: rz };
}

if (typeof window !== 'undefined') {
  window.PlanejamentoContinuacoes = { continuacoes, fontesDosPedacos, pagamentosDe, razao, distribuir, comoCenario };
}
