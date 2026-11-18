/* ============================================================
   Planejamento de bolsas (admin-only) — pedido do Victor em 17/11/2026,
   redesenhada em 18/11/2026 ("o mais explicativa possível à primeira
   vista, com detalhe e ajuste quando precisar").

   O mapa pessoa × mês: quem paga a bolsa de cada pessoa até o horizonte
   e quanto fica sem cobertura. A conta é o PlanejamentoMotor
   (frontend/js/planejamento-motor.js), porte fiel do refazer_mapa.py,
   travado por tests/planejamento-motor.test.js. Esta tela não calcula
   nada por conta própria além de somar o que o motor devolve para
   desenhar (colunas do mês, totais de linha).

   Ordem da tela, do essencial ao detalhe:
   1. Resposta: quanto falta no cenário escolhido, desde quando, e quanto
      seria se o dinheiro "a entrar" não entrar.
   2. Cenários lado a lado (os gravados nas premissas), cada um com a
      sua falta; clicar escolhe. "Ajustar" liga e desliga fontes e as duas
      decisões em discussão; se não bater com nenhum, vira "Ajuste próprio".
   3. Mês a mês: quem paga cada mês (colunas empilhadas por fonte).
      Clicar num mês abre o detalhe.
   4. De onde vem o dinheiro: cada fonte, com o valor clicável.
   5. Pessoa a pessoa (fechado por padrão): o valor de cada bolsa é
      clicável e mostra de onde veio (planilha da FUNAPE ou premissa).
   6. Alertas (fechado por padrão).

   "De onde vem este valor": balancete (PDF) para o caixa dos centros e
   planilha de bolsas da FUNAPE (XLSX, bucket bolsa-planilhas, a última
   reconciliação do centro) para o valor de cada bolsa — os dois pelo
   OrigemDocumento. Fonte fixa nas premissas mostra a ressalva gravada.

   Segurança: rota bloqueada para não-admin (app.js), link com data-admin,
   e o RLS da 061 só deixa admin ler as premissas. Nada aqui grava.
   ============================================================ */

Router.register('planejamento', {
  title: 'Planejamento de bolsas',
  async render(container) {
    await PlanejamentoPage.load(container);
  },
});

const PlanejamentoPage = (() => {
  const PLANEJAMENTO = 'bolsas-2027';
  const ROTM = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const rot = m => `${ROTM[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
  const K = v => (Math.abs(v) >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
    : Math.abs(v) >= 1000 ? `R$ ${Math.round(v / 1000).toLocaleString('pt-BR')} mil` : formatBRL(v));
  const esc = v => escapeAttr(v == null ? '' : String(v));

  let el = null;
  let base = null;          // { dados, premissas, versao, balancetes, porCodigo }
  let escolha = null;       // { fontes: Set, sobrasGC, continua } — o cenário que a tela mostra
  let ultimo = null;        // resultado do motor da última renderização
  let filtroFalta = false;
  const abertos = { ajustes: false, pessoas: false, alertas: false };

  async function load(container) {
    el = container;
    el.innerHTML = '<div class="skeleton skeleton--card" style="height:240px;"></div>';
    injetarEstilo();
    try {
      base = await carregar();
    } catch (e) {
      el.innerHTML = erroCard(e.message);
      lucide.createIcons({ nodes: [el] });
      return;
    }
    escolha = escolhaDe(base.premissas.cenarios[0]);
    render();
  }

  /* ── Leitura (a mesma do refazer_mapa.py: ler_banco) ─────── */

  async function carregar() {
    const { data: versoes, error: eV } = await supabaseClient
      .from('planejamento_versoes').select('premissas, nota, criado_em, criado_por')
      .eq('planejamento', PLANEJAMENTO).order('criado_em', { ascending: false }).limit(1);
    if (eV) {
      if (/planejamento_versoes/.test(eV.message || '') || eV.code === '42P01' || eV.code === 'PGRST205') {
        throw new Error('As premissas ainda não estão no banco: falta aplicar a migração 061.');
      }
      throw new Error('Não consegui ler as premissas: ' + eV.message);
    }
    if (!versoes || !versoes.length) throw new Error('Nenhuma versão das premissas gravada ainda.');
    const versao = versoes[0];
    const premissas = versao.premissas;

    const hoje = new Date();
    const ref = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const { data: projs, error: eP } = await supabaseClient.from('projects').select('id, code, name, end_date, active');
    if (eP) throw new Error('Não consegui ler os centros de custo: ' + eP.message);
    const porCodigo = Object.fromEntries(projs.filter(p => p.code).map(p => [p.code, p]));

    const ccs = new Set([...premissas.centros_do_laerte.codigos, ...premissas.fontes.itens.filter(f => f.cc).map(f => f.cc)]);
    const centros = {};
    const balancetes = {};
    await Promise.all([...ccs].sort().map(async cc => {
      const p = porCodigo[cc];
      if (!p) { centros[cc] = { existe: false }; return; }
      const { data: s, error } = await supabaseClient.rpc('get_saldo_livre', { p_project_id: p.id });
      if (error) throw new Error(`Saldo livre do ${cc}: ${error.message}`);
      balancetes[cc] = s.balancete_id || null;
      centros[cc] = {
        existe: true, nome: p.name, fim: p.end_date, ativo: p.active,
        tem_plano: s.has_plano, tem_balancete: s.has_balancete, balancete: s.data_referencia,
        caixa: s.saldo_disponivel_caixa, compromissos_bolsas: s.compromissos_bolsas || 0,
        compromissos_inicio: mes(s.compromissos_inicio), compromissos_fim: mes(s.compromissos_fim),
        grupos: Object.fromEntries((s.grupos || []).map(g => [g.grupo_code,
          { livre: g.saldo_livre, previsto: g.previsto, realizado: g.realizado }])),
      };
    }));

    const ids = premissas.centros_do_laerte.codigos.filter(c => porCodigo[c]).map(c => porCodigo[c].id);
    const { data: bs, error: eB } = await supabaseClient.from('scholarships')
      .select('amount, start_date, end_date, status, notes, project_id, scholarship_holders(full_name)')
      .in('project_id', ids).neq('status', 'cancelled').gte('end_date', `${ref}-01`);
    if (eB) throw new Error('Não consegui ler as bolsas: ' + eB.message);
    const porId = Object.fromEntries(projs.map(p => [p.id, p.code]));
    const bolsas = bs.map(b => ({
      pessoa: b.scholarship_holders?.full_name || null, cc: porId[b.project_id], valor: Number(b.amount),
      de: mes(b.start_date), ate: mes(b.end_date), status: b.status, nota: b.notes || '',
    }));

    return { dados: { lido_em: new Date().toISOString().slice(0, 19), ref, centros, bolsas }, premissas, versao, balancetes, porCodigo };
  }

  const mes = d => (d ? String(d).slice(0, 7) : null);

  /* ── Cenário: os gravados nas premissas + o ajuste da tela ── */

  // Um cenário das premissas vira as três escolhas que a tela sabe ligar e desligar.
  function escolhaDe(c) {
    return { fontes: new Set(c.fontes), sobrasGC: !!(c.sobras_para_gc && c.sobras_para_gc.length), continua: !(c.encerra_com_cc && c.encerra_com_cc.length) };
  }

  const mesmaEscolha = (a, b) => a.sobrasGC === b.sobrasGC && a.continua === b.continua
    && a.fontes.size === b.fontes.size && [...a.fontes].every(f => b.fontes.has(f));

  // E de volta: as escolhas viram um cenário para o motor. As listas das decisões vêm dos cenários
  // gravados que as usam (B para as sobras, D para o fim de ICS/GMH).
  function cenarioDe(e, codigo, semAEntrar) {
    const P = base.premissas;
    const comSobras = P.cenarios.find(c => c.sobras_para_gc && c.sobras_para_gc.length) || {};
    const comFim = P.cenarios.find(c => c.encerra_com_cc && c.encerra_com_cc.length) || {};
    const aEntrar = new Set(P.fontes.itens.filter(f => f.situacao === 'a_entrar').map(f => f.codigo));
    const ordem = P.fontes.itens.map(f => f.codigo).filter(f => e.fontes.has(f) && !(semAEntrar && aEntrar.has(f)));
    const c = { codigo, nome: codigo, fontes: ordem };
    if (e.sobrasGC) { c.sobras_para_gc = comSobras.sobras_para_gc || []; c.gc_sem_teto = !!comSobras.gc_sem_teto; }
    if (!e.continua) c.encerra_com_cc = comFim.encerra_com_cc || [];
    return c;
  }

  function nomeDaEscolha() {
    const c = base.premissas.cenarios.find(x => mesmaEscolha(escolhaDe(x), escolha));
    return c ? c : null;
  }

  function calcular() {
    const P = base.premissas;
    const cenarios = [
      ...P.cenarios,
      cenarioDe(escolha, '_ESC', false),
      cenarioDe(escolha, '_ESC_SEM', true),
    ];
    return PlanejamentoMotor.calcular(base.dados, { ...P, cenarios });
  }

  /* ── Desenho ─────────────────────────────────────────────── */

  function render() {
    let r;
    try {
      r = calcular();
    } catch (e) {
      el.innerHTML = erroCard('A conta não fechou: ' + e.message);
      lucide.createIcons({ nodes: [el] });
      return;
    }
    ultimo = r;
    const v = base.versao;
    el.innerHTML = `
      <div class="plan">
        <p class="plan-versao"><i data-lucide="file-clock"></i>
          <span>Premissas de <strong>${formatDate(String(v.criado_em).slice(0, 10))}</strong>${v.nota ? ` (${esc(v.nota)})` : ''}.
          Bolsas, saldos e balancetes lidos agora do sistema. Nada nesta tela grava.</span>
          <button class="btn btn--ghost btn--sm" data-acao="premissas"><i data-lucide="list"></i> Ver premissas</button></p>
        ${resposta(r)}
        ${cenarios(r)}
        ${mesAMes(r)}
        ${fontes(r)}
        ${pessoas(r)}
        ${alertas(r)}
      </div>`;
    lucide.createIcons({ nodes: [el] });
    ligarEventos();
  }

  // 1. A resposta, em uma frase.
  function resposta(r) {
    const c = r.cenarios._ESC, sem = r.cenarios._ESC_SEM;
    const M = r.meses;
    const primeiro = x => M.find(m => x.sem_mes[m] > 0);
    const mensal = r.pessoas.reduce((s, p) => s + p.alvo, 0);
    const nomeado = nomeDaEscolha();
    const aEntrar = base.premissas.fontes.itens.filter(f => f.situacao === 'a_entrar' && escolha.fontes.has(f.codigo));
    const falta = c.total_sem;
    const pl = aEntrar.length > 1;
    const titulo = falta > 0
      ? `Faltam <button class="plan-num plan-num--falta" data-acao="mes-falta">${formatBRL(falta)}</button>`
      : 'Não falta dinheiro';
    const sub = falta > 0
      ? `para manter as ${r.pessoas.length} bolsas até ${rot(M[M.length - 1])}. A falta começa em <strong>${rot(primeiro(c))}</strong>.`
      : `As ${r.pessoas.length} bolsas ficam cobertas em todos os meses, de ${rot(M[0])} a ${rot(M[M.length - 1])}.`;
    const semLinha = aEntrar.length
      ? (sem.total_sem > falta
        ? `<p class="plan-resp__extra"><i data-lucide="hourglass"></i><span>Isso conta com ${aEntrar.map(f => `<strong>${esc(curto(f))}</strong>`).join(' e ')},
          que ainda não ${pl ? 'entraram' : 'entrou'}. Se não ${pl ? 'entrarem' : 'entrar'}, a falta sobe para <strong>${formatBRL(sem.total_sem)}</strong>, a partir de ${rot(primeiro(sem))}.</span></p>`
        : `<p class="plan-resp__extra"><i data-lucide="hourglass"></i><span>Mesmo sem ${aEntrar.map(f => esc(curto(f))).join(' e ')}, que ainda não ${pl ? 'entraram' : 'entrou'}, o resultado é o mesmo.</span></p>`)
      : '<p class="plan-resp__extra"><i data-lucide="wallet"></i><span>Só com dinheiro que já entrou.</span></p>';
    // Sobra que vence sem uso enquanto falta: o ponto que o cenário das sobras resolve.
    const vencem = base.premissas.fontes.itens.filter(f => escolha.fontes.has(f.codigo) && c.sobra[f.codigo] >= 1
      && r.fontes[f.codigo].ate_hoje < M[M.length - 1]);
    const totVence = vencem.reduce((s, f) => s + c.sobra[f.codigo], 0);
    const semFalta = base.premissas.cenarios.find(x => r.cenarios[x.codigo].total_sem === 0);
    const venceLinha = falta > 0 && totVence >= 1
      ? `<p class="plan-resp__extra"><i data-lucide="alert-circle"></i><span>Ao mesmo tempo, <strong>${formatBRL(totVence)}</strong> sobram em
        ${vencem.map(f => esc(curto(f))).join(', ')} e vencem sem uso: essas fontes acabam antes de faltar dinheiro.
        ${semFalta && semFalta.codigo !== nomeado?.codigo ? `<button class="plan-link" data-cenario="${esc(semFalta.codigo)}">Ver o cenário "${esc(semFalta.nome)}"</button>, em que não falta dinheiro.` : ''}</span></p>`
      : '';
    return `
      <section class="card plan-resp ${falta > 0 ? 'plan-resp--falta' : 'plan-resp--ok'}">
        <div class="plan-resp__principal">
          <p class="plan-resp__cenario">Cenário: <strong>${nomeado ? esc(nomeado.nome) : 'Ajuste próprio'}</strong></p>
          <h2 class="plan-resp__titulo">${titulo}</h2>
          <p class="plan-resp__sub">${sub}</p>
          ${semLinha}
          ${venceLinha}
        </div>
        <dl class="plan-resp__fatos">
          <div><dt>A manter por mês</dt><dd><button class="plan-num" data-acao="mensal">${formatBRL(mensal)}</button></dd></div>
          <div><dt>Pessoas</dt><dd>${r.pessoas.length}</dd></div>
          <div><dt>Período</dt><dd>${rot(M[0])} a ${rot(M[M.length - 1])}</dd></div>
        </dl>
      </section>`;
  }

  // "30.118 WRI Brasil: bolsas do plano…" → "30.118 WRI Brasil"; "US$ 80 mil (WRI…)" fica.
  const curto = f => String(f.nome).split(':')[0];

  // 2. Cenários lado a lado + ajustes.
  function cenarios(r) {
    const P = base.premissas;
    const nomeado = nomeDaEscolha();
    const cards = P.cenarios.map(c => {
      const x = r.cenarios[c.codigo];
      const ativo = nomeado && nomeado.codigo === c.codigo;
      return `<button class="plan-cen ${ativo ? 'plan-cen--ativo' : ''}" data-cenario="${esc(c.codigo)}" aria-pressed="${ativo}">
        <span class="plan-cen__nome">${esc(c.nome)}</span>
        <span class="plan-cen__valor ${x.total_sem > 0 ? 'plan-falta' : 'plan-cen__valor--ok'}">${x.total_sem > 0 ? `falta ${K(x.total_sem)}` : 'não falta dinheiro'}</span>
        <span class="plan-cen__explica">${esc(c.explica || '')}</span>
      </button>`;
    }).join('');
    const aj = P.fontes.itens.map(f => `<label class="plan-chk">
        <input type="checkbox" data-fonte-chk="${esc(f.codigo)}" ${escolha.fontes.has(f.codigo) ? 'checked' : ''}>
        <span>${esc(f.nome)} ${f.situacao === 'a_entrar' ? '<span class="plan-chip plan-chip--entrar">a entrar</span>' : ''}</span></label>`).join('');
    return `
      <section class="card">
        <div class="card__header"><div><h3 class="card__title">Compare os cenários</h3>
          <p class="card__subtitle">Cada cartão é um jeito de pagar as mesmas bolsas. Clique para ver o cenário no resto da página.</p></div></div>
        <div class="plan-cens">${cards}</div>
        <details class="plan-det" data-det="ajustes" ${abertos.ajustes ? 'open' : ''}>
          <summary><i data-lucide="sliders-horizontal"></i> Ajustar: escolher fontes e decisões${nomeado ? '' : ' <span class="plan-chip">ajuste próprio</span>'}</summary>
          <div class="plan-ajustes">
            <div><h4>Fontes que entram na conta</h4>${aj}</div>
            <div><h4>Em discussão</h4>
              <label class="plan-chk"><input type="checkbox" data-decisao="sobrasGC" ${escolha.sobrasGC ? 'checked' : ''}>
                <span><strong>Sobras viram bolsa no guarda-chuva.</strong> O que sobra nos centros quando eles acabam vai para o
                guarda-chuva, sem o teto mensal. Exige mudar o plano do guarda-chuva.</span></label>
              <label class="plan-chk"><input type="checkbox" data-decisao="continua" ${escolha.continua ? 'checked' : ''}>
                <span><strong>Quem é do ICS e do GMH continua depois que o projeto acaba.</strong> Desligado, essa parte da bolsa
                deixa de ser necessidade depois do fim do centro.</span></label>
            </div>
          </div>
        </details>
      </section>`;
  }

  // Soma, por mês, o que cada fonte paga no cenário escolhido (para desenhar as colunas).
  function porMes(r) {
    const c = r.cenarios._ESC;
    const out = {};
    r.meses.forEach(m => { out[m] = {}; });
    r.pessoas.forEach(p => r.meses.forEach(m => {
      (c.mapa[`${p.nome}|${m}`] || []).forEach(([k, val]) => {
        const chave = k === 'SEM' ? 'SEM' : (k.startsWith('→') ? k : '_proprio');
        out[m][chave] = (out[m][chave] || 0) + val;
      });
    }));
    return out;
  }

  // 3. Mês a mês: colunas empilhadas, uma cor por fonte, vermelho = sem dinheiro.
  function mesAMes(r) {
    const pm = porMes(r);
    const M = r.meses;
    const tot = m => Object.values(pm[m]).reduce((s, x) => s + x, 0);
    const max = Math.max(...M.map(tot), 1);
    const ordem = ['_proprio', ...base.premissas.fontes.itens.map(f => '→' + f.codigo), 'SEM'];
    const col = m => {
      const partes = ordem.filter(k => pm[m][k] > 0).map(k =>
        `<i style="height:${(pm[m][k] / max) * 100}%;background:${corDe(k)}"></i>`).join('');
      const f = pm[m].SEM || 0;
      return `<button class="plan-mes" data-mes="${m}" title="Ver o detalhe de ${rot(m)}">
        <span class="plan-mes__barra">${partes}</span>
        <span class="plan-mes__falta ${f > 0 ? 'plan-falta' : ''}">${f > 0 ? `${Math.round(f / 1000).toLocaleString('pt-BR')} mil` : ''}</span>
        <span class="plan-mes__rot">${rot(m)}</span></button>`;
    };
    const usadas = ordem.filter(k => M.some(m => pm[m][k] > 0));
    return `
      <section class="card">
        <div class="card__header"><div><h3 class="card__title">Quem paga cada mês</h3>
          <p class="card__subtitle">Cada coluna é o total das bolsas no mês; as cores mostram de onde sai o dinheiro.
            Em vermelho, o que fica sem dinheiro. Clique num mês para o detalhe.</p></div></div>
        <div class="plan-legenda">${usadas.map(k => `<span><i style="background:${corDe(k)}"></i>${esc(rotuloFonte(k))}</span>`).join('')}</div>
        <div class="plan-meses" style="grid-template-columns:repeat(${M.length},minmax(0,1fr))">${M.map(col).join('')}</div>
      </section>`;
  }

  function rotuloFonte(k) {
    if (k === 'SEM') return 'sem dinheiro';
    if (k === '_proprio' || !k.startsWith('→')) return 'o próprio centro paga';
    const f = base.premissas.fontes.itens.find(x => x.codigo === k.slice(1));
    return f ? curto(f) : k.slice(1);
  }

  // 4. De onde vem o dinheiro.
  function fontes(r) {
    const c = r.cenarios._ESC;
    const M = r.meses;
    const linhas = base.premissas.fontes.itens.map(fi => {
      const k = fi.codigo, f = r.fontes[k];
      const fora = !escolha.fontes.has(k);
      const usado = c.usado[k], sobra = c.sobra[k];
      const pct = f.valor_hoje > 0 && usado != null ? Math.min(100, (usado / f.valor_hoje) * 100) : 0;
      const vence = !fora && sobra >= 1 && f.ate_hoje < M[M.length - 1];
      return `<tr class="${fora ? 'plan-fora' : ''}">
        <th><span class="plan-cor" style="background:${corDe('→' + k)}"></span>${esc(f.nome || fi.nome)}
          <div class="plan-miudo">${fi.situacao === 'a_entrar' ? '<span class="plan-chip plan-chip--entrar">a entrar</span>' : '<span class="plan-chip">em caixa</span>'}
          certeza ${esc(fi.certeza || '—')}${fora ? ' · fora deste cenário' : ''}</div></th>
        <td><button class="plan-num" data-fonte="${esc(k)}" title="De onde vem este valor">${formatBRL(f.valor_hoje)}</button></td>
        <td>${rot(f.de_hoje)} a ${rot(f.ate_hoje)}${f.teto_mes ? `<div class="plan-miudo">até ${formatBRL(f.teto_mes)}/mês</div>` : ''}</td>
        <td>${fora ? '—' : `<div class="plan-uso"><i style="width:${pct}%"></i></div>${usado == null ? '—' : formatBRL(usado)}`}</td>
        <td>${fora || sobra == null ? '—' : formatBRL(sobra)}${vence ? '<div class="plan-miudo plan-vence">vence sem uso</div>' : ''}</td></tr>`;
    }).join('');
    const gc = c.para_gc && Object.entries(c.para_gc).filter(([, x]) => x > 0);
    return `
      <section class="card">
        <div class="card__header"><div><h3 class="card__title">De onde vem o dinheiro</h3>
          <p class="card__subtitle">Clique no valor para ver de onde ele saiu.</p></div></div>
        <div class="plan-rolagem"><table class="plan-tab">
          <colgroup><col style="width:38%"><col><col><col style="width:20%"><col></colgroup>
          <thead><tr><th>Fonte</th><th>Disponível</th><th>Pode pagar</th><th>Usado neste cenário</th><th>Sobra</th></tr></thead>
          <tbody>${linhas}</tbody></table></div>
        ${gc && gc.length ? `<p class="plan-nota">Foram ao guarda-chuva: ${gc.map(([k, x]) => `${esc(k)} ${K(x)}`).join(', ')}.</p>` : ''}
      </section>`;
  }

  // 5. Pessoa a pessoa.
  function pessoas(r) {
    const c = r.cenarios._ESC;
    const M = r.meses;
    const lista = r.pessoas.filter(p => !filtroFalta || M.some(m => (c.mapa[`${p.nome}|${m}`] || []).some(([k]) => k === 'SEM')));
    const semNenhum = r.pessoas.filter(p => M.some(m => (c.mapa[`${p.nome}|${m}`] || []).some(([k]) => k === 'SEM'))).length;
    const cel = (p, m) => {
      const x = c.mapa[`${p.nome}|${m}`] || [];
      if (!x.length) return '<td></td>';
      const dica = x.map(([k, val]) => `${rotuloFonte(k)}: ${formatBRL(val)}`).join(' + ');
      const k = x.some(([q]) => q === 'SEM') ? 'SEM' : x[x.length - 1][0];
      return `<td class="plan-cel" title="${esc(rot(m) + ' — ' + dica)}"><i style="background:${corDe(k)}"></i></td>`;
    };
    const linhas = lista.map(p => `<tr><th>${esc(p.nome)}</th><td>${esc(p.grupo)}</td>
      <td><button class="plan-num" data-pessoa="${esc(p.nome)}" title="De onde vem este valor">${formatBRL(p.alvo)}</button></td>
      ${M.map(m => cel(p, m)).join('')}</tr>`).join('');
    return `
      <details class="card plan-det plan-det--card" data-det="pessoas" ${abertos.pessoas ? 'open' : ''}>
        <summary><span><strong>Pessoa a pessoa</strong> · ${r.pessoas.length} pessoas${semNenhum ? `, <span class="plan-falta">${semNenhum} ficam sem dinheiro em algum mês</span>` : ''}</span></summary>
        <div class="plan-det__corpo">
          <div class="plan-pessoas-topo">
            <p class="plan-nota">Clique no valor da bolsa para ver de onde ele veio. Quem fica sem dinheiro depende da ordem
              da lista; o total, não. Isto não é proposta de quem sai.</p>
            <label class="plan-chk plan-chk--linha"><input type="checkbox" data-acao="filtro" ${filtroFalta ? 'checked' : ''}> Só quem fica sem dinheiro</label>
          </div>
          <div class="plan-rolagem"><table class="plan-tab plan-tab--pessoas">
            <thead><tr><th>Pessoa</th><th>Centro</th><th>Bolsa/mês</th>${M.map(m => `<th>${rot(m)}</th>`).join('')}</tr></thead>
            <tbody>${linhas}</tbody></table></div>
        </div>
      </details>`;
  }

  function alertas(r) {
    if (!r.alertas.length) return '';
    return `<details class="card plan-det plan-det--card" data-det="alertas" ${abertos.alertas ? 'open' : ''}>
      <summary><span><i data-lucide="alert-triangle"></i> <strong>Avisos da conta</strong> · ${r.alertas.length}</span></summary>
      <div class="plan-det__corpo"><ul class="plan-lista">${r.alertas.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div></details>`;
  }

  // Uma cor por fonte, na ordem das premissas. Cinza = o próprio centro paga.
  const PALETA = ['#8b6fd6', '#e08a3c', '#2a9d8f', '#d4a72c', '#4a7fd4', '#d4609b', '#3fa34d', '#5bb5d9'];
  function corDe(k) {
    if (k === 'SEM') return 'var(--danger)';
    if (!k.startsWith('→')) return '#9aa39d';
    const i = base.premissas.fontes.itens.findIndex(f => f.codigo === k.slice(1));
    return i < 0 ? '#9aa39d' : PALETA[i % PALETA.length];
  }

  /* ── Eventos ─────────────────────────────────────────────── */

  function ligarEventos() {
    const r = ultimo;
    el.querySelectorAll('[data-cenario]').forEach(b => b.addEventListener('click', () => {
      escolha = escolhaDe(base.premissas.cenarios.find(c => c.codigo === b.dataset.cenario));
      render();
    }));
    el.querySelectorAll('[data-fonte-chk]').forEach(i => i.addEventListener('change', () => {
      if (i.checked) escolha.fontes.add(i.dataset.fonteChk); else escolha.fontes.delete(i.dataset.fonteChk);
      render();
    }));
    el.querySelectorAll('[data-decisao]').forEach(i => i.addEventListener('change', () => {
      escolha[i.dataset.decisao] = i.checked;
      render();
    }));
    el.querySelectorAll('details[data-det]').forEach(d => d.addEventListener('toggle', () => { abertos[d.dataset.det] = d.open; }));
    el.querySelector('[data-acao="filtro"]')?.addEventListener('change', e => { filtroFalta = e.target.checked; render(); });
    el.querySelector('[data-acao="premissas"]')?.addEventListener('click', verPremissas);
    el.querySelector('[data-acao="mensal"]')?.addEventListener('click', () => verMensal(r));
    el.querySelector('[data-acao="mes-falta"]')?.addEventListener('click', () => {
      const m = r.meses.find(x => r.cenarios._ESC.sem_mes[x] > 0);
      if (m) verMes(r, m);
    });
    el.querySelectorAll('[data-mes]').forEach(b => b.addEventListener('click', () => verMes(r, b.dataset.mes)));
    el.querySelectorAll('[data-fonte]').forEach(b => b.addEventListener('click', () => origemDaFonte(b.dataset.fonte, r.fontes[b.dataset.fonte])));
    el.querySelectorAll('[data-pessoa]').forEach(b => b.addEventListener('click', () => origemDaPessoa(r.pessoas.find(p => p.nome === b.dataset.pessoa))));
  }

  const modal = (title, bodyHTML, maxWidth) => createModal({ title, bodyHTML, maxWidth: maxWidth || '640px', saveLabel: 'Fechar', hideCancelBtn: true, onSave: () => true });

  // Como chegamos ao total por mês: soma das bolsas por centro.
  function verMensal(r) {
    const g = {};
    r.pessoas.forEach(p => p.base_linhas.forEach(([cc, v]) => { g[cc] = g[cc] || { n: 0, v: 0 }; g[cc].n += 1; g[cc].v += v; }));
    const total = r.pessoas.reduce((s, p) => s + p.alvo, 0);
    modal('A manter por mês', `<p>Soma das bolsas de cada pessoa no mês de referência (${rot(base.dados.ref)}), por centro que paga hoje.
      Para ver de onde vem cada bolsa, abra "Pessoa a pessoa" e clique no valor.</p>
      <table class="plan-tab"><thead><tr><th>Centro</th><th>Bolsas</th><th>Por mês</th></tr></thead><tbody>
      ${Object.entries(g).sort().map(([cc, x]) => `<tr><th>${esc(cc)} ${esc(base.dados.centros[cc]?.nome || '')}</th><td>${x.n}</td><td>${formatBRL(x.v)}</td></tr>`).join('')}
      <tr><th><strong>Total</strong></th><td></td><td><strong>${formatBRL(total)}</strong></td></tr></tbody></table>`);
  }

  // Detalhe de um mês: o que cada fonte paga e quem fica sem.
  function verMes(r, m) {
    const pm = porMes(r)[m];
    const c = r.cenarios._ESC;
    const sem = r.pessoas.map(p => [p, (c.mapa[`${p.nome}|${m}`] || []).filter(([k]) => k === 'SEM').reduce((s, [, v]) => s + v, 0)]).filter(([, v]) => v > 0);
    const linhas = Object.entries(pm).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
      `<tr><th><span class="plan-cor" style="background:${corDe(k)}"></span>${esc(rotuloFonte(k))}</th><td>${formatBRL(v)}</td></tr>`).join('');
    modal(`Bolsas de ${rot(m)}`, `<table class="plan-tab"><thead><tr><th>Quem paga</th><th>Valor</th></tr></thead><tbody>${linhas}
      <tr><th><strong>Total</strong></th><td><strong>${formatBRL(Object.values(pm).reduce((s, x) => s + x, 0))}</strong></td></tr></tbody></table>
      ${sem.length ? `<h4>Sem dinheiro em ${rot(m)} (${sem.length})</h4><ul class="plan-lista">${sem.map(([p, v]) => `<li>${esc(p.nome)} (${esc(p.grupo)}): ${formatBRL(v)}</li>`).join('')}</ul>
        <p class="plan-nota">Quem aparece aqui depende da ordem da lista; o total do mês, não.</p>` : '<p>Ninguém fica sem dinheiro neste mês.</p>'}`);
  }

  // "De onde vem este valor" de uma fonte. Do banco: abre o balancete com a linha do saldo disponível marcada e
  // explica a conta. Fixo nas premissas: mostra a origem e a ressalva gravadas com ela.
  async function origemDaFonte(k, f) {
    const fi = base.premissas.fontes.itens.find(x => x.codigo === k) || {};
    const c = f.cc ? base.dados.centros[f.cc] : null;
    const conta = `<p><strong>${esc(f.nome)}</strong>: ${formatBRL(f.valor_hoje)}.</p>
      ${f.como ? `<p>Como foi lido: ${esc(f.como)}.</p>` : ''}
      ${fi.ressalva || f.ressalva ? `<p class="plan-nota">${esc(fi.ressalva || f.ressalva)}</p>` : ''}
      ${fi.base === 'fixo' ? '<p class="plan-nota">Valor fixo gravado nas premissas: não vem de documento do sistema.</p>' : ''}`;
    const balanceteId = f.cc ? base.balancetes[f.cc] : null;
    if (!c || !balanceteId || typeof OrigemDocumento === 'undefined') { modal('De onde vem este valor', conta); return; }
    const { data: bal } = await supabaseClient.from('balancetes').select('arquivo_storage_path, arquivo_nome').eq('id', balanceteId).maybeSingle();
    if (!bal?.arquivo_storage_path) { modal('De onde vem este valor', conta + '<p>O PDF deste balancete não está guardado no sistema.</p>'); return; }
    OrigemDocumento.abrir({
      titulo: `${f.nome}`,
      valor: f.valor_hoje,
      documento: { tipo: 'pdf', nome: bal.arquivo_nome || 'balancete.pdf', carregar: () => baixar('balancete-pdfs', bal.arquivo_storage_path) },
      partes: [
        { rotulo: `Saldo disponível no balancete de ${formatDate(c.balancete)}`, valor: Number(c.caixa),
          alvo: { valor: Number(c.caixa), texto: 'saldo disponivel' } },
      ],
      nota: `${f.como || ''}. Bolsas já contratadas descontadas: ${formatBRL(Number(c.compromissos_bolsas))}.`,
    });
  }

  // "De onde vem este valor" de uma bolsa: cada linha da pessoa (centro, valor, período) e o documento.
  // Linha do banco → a última planilha de bolsas da FUNAPE guardada para o centro, com a linha da pessoa marcada.
  // Linha das premissas → a bolsa prevista que ainda não está no sistema.
  function origemDaPessoa(p) {
    if (!p) return;
    const linhas = p.linhas.map((l, i) => `<tr><th>${esc(l.cc)}</th><td>${formatBRL(l.valor)}</td><td>${rot(l.de)} a ${rot(l.ate)}</td>
      <td>${l.origem === 'premissa'
        ? 'Prevista nas premissas (ainda não está no sistema)'
        : `<button class="btn btn--ghost btn--sm" data-planilha="${i}"><i data-lucide="file-spreadsheet"></i> Ver na planilha da FUNAPE</button>`}</td></tr>`).join('');
    const corpo = `<p><strong>${esc(p.nome)}</strong>: ${formatBRL(p.alvo)} por mês em ${rot(p.desde)}${p.base_linhas.length > 1 ? `, somando ${p.base_linhas.length} bolsas` : ''}.</p>
      <table class="plan-tab"><thead><tr><th>Centro</th><th>Por mês</th><th>Período considerado</th><th>Origem</th></tr></thead><tbody>${linhas}</tbody></table>
      <p class="plan-nota">O período é o da bolsa no sistema, cortado entre ${rot(base.dados.ref)} e ${rot(base.premissas.horizonte_ate)}.
        O que vem depois do fim da bolsa é necessidade a cobrir pelas fontes.</p>`;
    const janela = modal('De onde vem este valor', corpo, '760px').overlay;
    lucide.createIcons({ nodes: [janela] });
    janela.querySelectorAll('[data-planilha]').forEach(b => b.addEventListener('click', () => abrirPlanilha(p, p.linhas[Number(b.dataset.planilha)], b)));
  }

  async function abrirPlanilha(p, l, botao) {
    const proj = base.porCodigo[l.cc];
    const avisar = msg => { botao.replaceWith(Object.assign(document.createElement('span'), { className: 'plan-nota', textContent: msg })); };
    if (!proj) { avisar('Centro não encontrado no sistema.'); return; }
    const { data, error } = await supabaseClient.from('reconciliacoes').select('competencia, arquivo_nome, arquivo_storage_path')
      .eq('project_id', proj.id).not('arquivo_storage_path', 'is', null).order('competencia', { ascending: false }).limit(1);
    if (error) { avisar('Não consegui buscar a planilha: ' + error.message); return; }
    const rec = data && data[0];
    if (!rec) { avisar('Nenhuma planilha da FUNAPE guardada para este centro: a bolsa foi cadastrada à mão.'); return; }
    OrigemDocumento.abrir({
      titulo: `Bolsa de ${p.nome} no ${l.cc}`,
      valor: l.valor,
      documento: { tipo: 'xlsx', nome: rec.arquivo_nome || 'planilha.xlsx', carregar: () => baixar('bolsa-planilhas', rec.arquivo_storage_path) },
      partes: [{ rotulo: `${p.nome}: ${formatBRL(l.valor)}/mês`, valor: l.valor, alvo: { texto: p.nome } }],
      nota: `Planilha de bolsas da FUNAPE de ${formatDate(rec.competencia).slice(3)}, a última importada para o ${l.cc}. A linha da pessoa fica destacada.`,
    });
  }

  async function baixar(bucket, path) {
    const { data, error } = await supabaseClient.storage.from(bucket).createSignedUrl(path, 60);
    if (error) throw new Error(error.message);
    const resp = await fetch(data.signedUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.arrayBuffer();
  }

  function verPremissas() {
    const P = base.premissas;
    const linhas = P.fontes.itens.map(f => `<li><strong>${esc(f.nome)}</strong>
      (${f.situacao === 'a_entrar' ? 'a entrar' : 'em caixa'}${f.base === 'fixo' ? `, ${formatBRL(f.valor)}` : ', lido do sistema'})
      ${f.ressalva ? `<br><span class="plan-nota">${esc(f.ressalva)}</span>` : ''}</li>`).join('');
    const destinos = (P.destinos_previstos?.itens || []).map(d => `<li>${esc(d.pessoa)} no ${esc(d.cc)}:
      ${formatBRL(d.valor)}/mês, ${rot(d.de)} a ${rot(d.ate)}</li>`).join('');
    const cens = P.cenarios.map(c => `<li><strong>${esc(c.nome)}</strong>: ${esc(c.explica || '')}</li>`).join('');
    modal('Premissas (o que não está no sistema)', `<p>Versão de ${formatDate(String(base.versao.criado_em).slice(0, 10))}. Horizonte: ${rot(P.horizonte_ate)}.</p>
        <h4>Fontes</h4><ul class="plan-lista">${linhas}</ul>
        <h4>Cenários</h4><ul class="plan-lista">${cens}</ul>
        <h4>Bolsas previstas e ainda não implantadas</h4><ul class="plan-lista">${destinos || '<li>nenhuma</li>'}</ul>`, '760px');
  }

  function erroCard(msg) {
    return `<div class="card"><div class="empty-state"><i data-lucide="alert-triangle"></i>
      <h3 class="empty-state__title">Não deu para montar o planejamento</h3>
      <p class="empty-state__text">${esc(msg)}</p></div></div>`;
  }

  function injetarEstilo() {
    if (document.getElementById('planejamento-css')) return;
    const s = document.createElement('style');
    s.id = 'planejamento-css';
    s.textContent = `
      .plan { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; max-width: 1280px; }
      .plan > * { min-width: 0; }
      .plan-versao { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); color: var(--text-secondary); font-size: 13px; margin: 0; }
      .plan-versao > i { width: 16px; height: 16px; }
      .plan-versao .btn { margin-left: auto; }

      .plan-resp { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--sp-6); align-items: center; border-left: 4px solid var(--success); }
      .plan-resp--falta { border-left-color: var(--danger); }
      .plan-resp__cenario { margin: 0 0 var(--sp-1); font-size: 13px; color: var(--text-secondary); }
      .plan-resp__titulo { margin: 0; font-family: var(--font-heading); font-size: clamp(26px, 3vw, 36px); line-height: 1.15; font-weight: 700; }
      .plan-resp--ok .plan-resp__titulo { color: var(--success); }
      .plan-resp__sub { margin: var(--sp-2) 0 0; font-size: 15px; color: var(--text-primary); max-width: 62ch; }
      .plan-resp__extra { display: flex; gap: var(--sp-2); align-items: flex-start; margin: var(--sp-3) 0 0; font-size: 14px; color: var(--text-secondary); max-width: 70ch; }
      .plan-resp__extra i { width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px; }
      .plan-resp__fatos { display: grid; gap: var(--sp-3); margin: 0; padding-left: var(--sp-6); border-left: 1px solid var(--border-subtle); }
      .plan-resp__fatos dt { font-size: 12px; color: var(--text-secondary); }
      .plan-resp__fatos dd { margin: 0; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
      @media (max-width: 900px) { .plan-resp { grid-template-columns: 1fr; } .plan-resp__fatos { padding-left: 0; border-left: 0; grid-template-columns: repeat(3, auto); } }

      .plan-num { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; text-decoration: underline dotted; text-decoration-color: var(--accent); text-underline-offset: 4px; }
      .plan-num:hover, .plan-num:focus-visible { color: var(--accent); }
      .plan-num--falta { color: var(--danger); }
      .plan-link { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); cursor: pointer; text-decoration: underline; font-weight: 600; }

      .plan-cens { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--sp-3); }
      .plan-cen { display: flex; flex-direction: column; gap: var(--sp-1); text-align: left; padding: var(--sp-3) var(--sp-4); border: 1px solid var(--border-default);
        border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); font: inherit; cursor: pointer; }
      .plan-cen:hover { border-color: var(--accent); }
      .plan-cen--ativo { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: var(--accent-muted, var(--bg-secondary)); }
      .plan-cen__nome { font-weight: 600; font-size: 14px; }
      .plan-cen__valor { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .plan-cen__valor--ok { color: var(--success); }
      .plan-cen__explica { font-size: 12px; color: var(--text-secondary); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

      .plan-det { margin-top: var(--sp-4); }
      .plan-det > summary { cursor: pointer; font-size: 14px; color: var(--text-secondary); display: flex; align-items: center; gap: var(--sp-2); list-style: none; }
      .plan-det > summary::-webkit-details-marker { display: none; }
      .plan-det > summary::before { content: '▸'; color: var(--text-muted); }
      .plan-det[open] > summary::before { content: '▾'; }
      .plan-det > summary i { width: 16px; height: 16px; }
      .plan-det--card { margin-top: 0; }
      .plan-det--card > summary { color: var(--text-primary); font-size: 15px; }
      .plan-det__corpo { margin-top: var(--sp-4); }
      .plan-ajustes { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--sp-6); margin-top: var(--sp-4); }
      .plan-ajustes h4 { margin: 0 0 var(--sp-2); font-size: 13px; color: var(--text-secondary); font-weight: 600; }
      .plan-chk { display: flex; gap: var(--sp-2); align-items: flex-start; font-size: 14px; line-height: 1.45; cursor: pointer; margin-bottom: var(--sp-2); }
      .plan-chk input { margin-top: 3px; accent-color: var(--accent); }
      .plan-chk--linha { align-items: center; margin: 0; white-space: nowrap; font-size: 13px; color: var(--text-secondary); }
      .plan-chk--linha input { margin-top: 0; }

      .plan-legenda { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); font-size: 12px; color: var(--text-secondary); margin-bottom: var(--sp-4); }
      .plan-legenda span { display: inline-flex; align-items: center; gap: 6px; }
      .plan-legenda i, .plan-cel i, .plan-cor { display: inline-block; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
      .plan-cor { margin-right: 8px; vertical-align: -1px; }
      .plan-meses { display: grid; gap: 4px; align-items: end; }
      .plan-mes { display: flex; flex-direction: column; align-items: stretch; gap: 4px; background: none; border: 0; padding: 4px 0; cursor: pointer; font: inherit; color: inherit; border-radius: var(--radius-sm); min-width: 0; }
      .plan-mes:hover, .plan-mes:focus-visible { background: var(--bg-secondary); }
      .plan-mes__barra { height: 150px; display: flex; flex-direction: column-reverse; margin: 0 15%; border-radius: 3px; overflow: hidden; }
      .plan-mes__barra i { display: block; }
      .plan-mes__falta { font-size: 11px; height: 14px; text-align: center; white-space: nowrap; overflow: hidden; }
      .plan-mes__rot { font-size: 11px; color: var(--text-secondary); text-align: center; white-space: nowrap; }

      .plan-rolagem { overflow-x: auto; max-width: 100%; }
      .plan-tab { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
      .plan-tab th, .plan-tab td { padding: 8px 10px; border-bottom: 1px solid var(--border-subtle); text-align: right; vertical-align: top; }
      .plan-tab tbody th, .plan-tab thead th:first-child { text-align: left; font-weight: 500; }
      .plan-tab thead th { color: var(--text-secondary); font-weight: 500; font-size: 12px; }
      .plan-tab--pessoas th, .plan-tab--pessoas td { padding: 5px 6px; white-space: nowrap; }
      .plan-tab--pessoas tbody th { position: sticky; left: 0; background: var(--bg-surface); z-index: 1; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
      .plan-tab--pessoas td.plan-cel { text-align: center; }
      .plan-fora { opacity: 0.5; }
      .plan-miudo { font-size: 11px; color: var(--text-muted); font-weight: 400; margin-top: 2px; }
      .plan-vence { color: var(--warning); }
      .plan-uso { height: 6px; background: var(--bg-secondary); border-radius: 3px; overflow: hidden; margin: 4px 0 4px auto; max-width: 140px; }
      .plan-uso i { display: block; height: 100%; background: var(--accent); }
      .plan-falta { color: var(--danger); font-weight: 600; }
      .plan-chip { display: inline-block; padding: 1px 8px; border-radius: var(--radius-full); font-size: 11px; background: var(--success-muted); color: var(--success); }
      .plan-chip--entrar { background: var(--warning-muted); color: var(--warning); }
      .plan-nota { color: var(--text-secondary); font-size: 13px; }
      .plan-pessoas-topo { display: flex; justify-content: space-between; gap: var(--sp-4); align-items: flex-start; flex-wrap: wrap; margin-bottom: var(--sp-3); }
      .plan-pessoas-topo .plan-nota { margin: 0; max-width: 70ch; }
      .plan-lista { margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6; }
    `;
    document.head.appendChild(s);
  }

  return { load };
})();
