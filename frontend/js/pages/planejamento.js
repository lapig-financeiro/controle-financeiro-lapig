/* ============================================================
   Planejamento de bolsas (admin-only) — pedido do Victor em 17/11/2026

   O mapa pessoa × mês: quem paga a bolsa de cada pessoa até o horizonte
   e quanto fica sem cobertura. Antes era um script fora do site
   (NãoColocarNoGit/analise-bolsas-2027/mapa/refazer_mapa.py); a conta
   agora é o PlanejamentoMotor (frontend/js/planejamento-motor.js), porte
   fiel do script, travado por tests/planejamento-motor.test.js.

   De onde vem cada número:
   - do banco, a cada abertura: bolsas, saldos livres (get_saldo_livre),
     caixa do balancete e vigências — a mesma leitura do script;
   - das PREMISSAS (tabela planejamento_versoes, mig. 061): o que não está
     no banco (contrato a assinar, pessoas previstas, decisões). Cada
     gravação é uma versão; a tela mostra a vigente, quem gravou e quando.

   Duas decisões ainda em discussão viram chaves na tela, sem gravar nada:
   sobras para o guarda-chuva e continuidade de ICS/GMH. E o dinheiro "a
   entrar" (contrato não fechado) nunca se mistura ao que já entrou: a tela
   mostra a falta com e sem ele, lado a lado.

   Segurança: rota bloqueada para não-admin (app.js), link com data-admin,
   e o RLS da 061 só deixa admin ler as premissas.
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
  const K = v => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000).toLocaleString('pt-BR')} mil` : formatBRL(v));

  let el = null;
  let base = null;          // { dados, premissas, versao, projetos }
  let chaves = { sobrasGC: false, continuaIcsGmh: true };
  let filtroFalta = false;

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

    return { dados: { lido_em: new Date().toISOString().slice(0, 19), ref, centros, bolsas }, premissas, versao, balancetes };
  }

  const mes = d => (d ? String(d).slice(0, 7) : null);

  /* ── Cenário a partir das chaves ─────────────────────────── */

  function cenarioDasChaves(semAEntrar) {
    const P = base.premissas;
    const A = P.cenarios.find(c => c.codigo === 'A');
    const B = P.cenarios.find(c => c.codigo === 'B') || {};
    const D = P.cenarios.find(c => c.codigo === 'D') || {};
    const aEntrar = new Set(P.fontes.itens.filter(f => f.situacao === 'a_entrar').map(f => f.codigo));
    const c = { codigo: semAEntrar ? 'SEM' : 'COM', nome: '', fontes: A.fontes.filter(f => !(semAEntrar && aEntrar.has(f))) };
    if (chaves.sobrasGC) { c.sobras_para_gc = B.sobras_para_gc || []; c.gc_sem_teto = !!B.gc_sem_teto; }
    if (!chaves.continuaIcsGmh) c.encerra_com_cc = D.encerra_com_cc || ['30.109', '30.113'];
    return c;
  }

  function calcular() {
    const prem = { ...base.premissas, cenarios: [cenarioDasChaves(false), cenarioDasChaves(true)] };
    return PlanejamentoMotor.calcular(base.dados, prem);
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
    const com = r.cenarios.COM, sem = r.cenarios.SEM;
    const M = r.meses;
    const prim = c => M.find(m => c.sem_mes[m] > 0);
    const aEntrar = Object.values(r.fontes).filter(f => f.situacao === 'a_entrar');
    const mensal = r.pessoas.reduce((s, p) => s + p.alvo, 0);
    const v = base.versao;

    el.innerHTML = `
      <div class="plan">
        <p class="plan-versao"><i data-lucide="file-clock"></i>
          Premissas de <strong>${formatDate(String(v.criado_em).slice(0, 10))}</strong>${v.nota ? ` — ${escapeAttr(v.nota)}` : ''}.
          Bolsas, saldos e balancetes lidos agora do sistema. Nada nesta tela grava no sistema.
          <button class="btn btn--ghost btn--sm" data-acao="premissas"><i data-lucide="list"></i> Ver premissas</button></p>

        <div class="card plan-decisoes">
          <h3 class="card__title"><i data-lucide="split"></i> Em discussão</h3>
          <p class="card__subtitle">Liga e desliga para ver o efeito. Não muda nada no sistema.</p>
          <label class="plan-chave"><input type="checkbox" data-chave="sobrasGC" ${chaves.sobrasGC ? 'checked' : ''}>
            <span><strong>Sobras viram bolsa no guarda-chuva.</strong> O que sobra no 30.099, 30.118 e 30.111 quando eles
            acabam vai para o guarda-chuva, sem o teto de R$ 5.500/mês. Exige mudar o plano do guarda-chuva.</span></label>
          <label class="plan-chave"><input type="checkbox" data-chave="continuaIcsGmh" ${chaves.continuaIcsGmh ? 'checked' : ''}>
            <span><strong>Quem é do ICS e do GMH continua depois que o projeto acaba.</strong> Desligado: a parte da bolsa
            que vinha do 30.109 ou do 30.113 deixa de ser necessidade depois do fim do centro.</span></label>
        </div>

        <div class="stats-grid">
          ${kpi('Falta só com o que já entrou', sem.total_sem, prim(sem), 'danger', 'wallet')}
          ${kpi('Falta contando o que vai entrar', com.total_sem, prim(com), 'warning', 'hourglass')}
          <div class="stat-card"><div class="stat-card__icon stat-card__icon--info"><i data-lucide="users"></i></div>
            <div class="stat-card__content"><div class="stat-card__label">A manter por mês</div>
            <div class="stat-card__value currency">${formatBRL(mensal)}</div>
            <div class="stat-card__hint">${r.pessoas.length} pessoas, ${rot(M[0])} a ${rot(M[M.length - 1])}</div></div></div>
          <div class="stat-card"><div class="stat-card__icon stat-card__icon--accent"><i data-lucide="hand-coins"></i></div>
            <div class="stat-card__content"><div class="stat-card__label">A entrar (contrato não fechado)</div>
            <div class="stat-card__value currency">${formatBRL(aEntrar.reduce((s, f) => s + f.valor_hoje, 0))}</div>
            <div class="stat-card__hint">${aEntrar.map(f => escapeAttr(f.codigo)).join(' e ') || 'nada'}</div></div></div>
        </div>

        <div class="card">
          <div class="card__header"><div><h3 class="card__title">Falta por mês</h3>
            <p class="card__subtitle">Quanto das bolsas fica sem dinheiro em cada mês</p></div></div>
          <div class="plan-rolagem"><table class="plan-grade">
            <thead><tr><th></th>${M.map(m => `<th>${rot(m)}</th>`).join('')}<th>Total</th></tr></thead>
            <tbody>
              ${linhaFalta('Só com o que já entrou', sem, M)}
              ${linhaFalta('Contando o que vai entrar', com, M)}
            </tbody></table></div>
        </div>

        <div class="card">
          <div class="card__header"><div><h3 class="card__title">De onde vem o dinheiro</h3>
            <p class="card__subtitle">Clique no valor para ver de onde ele saiu</p></div></div>
          <div class="plan-rolagem"><table class="plan-grade plan-grade--fontes">
            <thead><tr><th>Fonte</th><th>Situação</th><th>Valor hoje</th><th>Janela</th>
              <th>Usado</th><th>Sobra</th></tr></thead>
            <tbody>${base.premissas.fontes.itens.map(f => linhaFonte(f.codigo, r.fontes[f.codigo], com, M)).join('')}</tbody>
          </table></div>
          ${com.para_gc && Object.values(com.para_gc).some(x => x > 0) ? `<p class="plan-nota">Foram ao guarda-chuva: ${
            Object.entries(com.para_gc).filter(([, x]) => x > 0).map(([k, x]) => `${escapeAttr(k)} ${K(x)}`).join(', ')}.</p>` : ''}
        </div>

        <div class="card">
          <div class="card__header"><div><h3 class="card__title">Por grupo</h3>
            <p class="card__subtitle">Quem recebia de onde no mês de referência</p></div></div>
          <div class="plan-rolagem"><table class="plan-grade">
            <thead><tr><th>Grupo</th><th>Pessoas</th><th>Por mês</th><th>Falta só com o que entrou</th><th>Falta contando o que vai entrar</th></tr></thead>
            <tbody>${grupos(r.pessoas).map(([g, ps]) => `<tr><th>${escapeAttr(g)}</th><td>${ps.length}</td>
              <td>${formatBRL(ps.reduce((s, p) => s + p.alvo, 0))}</td>
              <td class="${(sem.sem_grupo[g] || 0) > 0 ? 'plan-falta' : ''}">${formatBRL(sem.sem_grupo[g] || 0)}</td>
              <td class="${(com.sem_grupo[g] || 0) > 0 ? 'plan-falta' : ''}">${formatBRL(com.sem_grupo[g] || 0)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>

        <div class="card">
          <div class="card__header"><div><h3 class="card__title">Pessoa a pessoa</h3>
            <p class="card__subtitle">Contando o que vai entrar. Quem fica sem depende da ordem da lista; o total, não.
              Isto não é uma proposta de quem sai.</p></div>
            <label class="plan-filtro"><input type="checkbox" data-acao="filtro" ${filtroFalta ? 'checked' : ''}> Só quem fica sem dinheiro</label></div>
          <div class="plan-legenda">${legenda()}</div>
          <div class="plan-rolagem"><table class="plan-grade plan-grade--pessoas">
            <thead><tr><th>Pessoa</th><th>Grupo</th><th>Valor</th>${M.map(m => `<th>${rot(m)}</th>`).join('')}</tr></thead>
            <tbody>${r.pessoas.filter(p => !filtroFalta || M.some(m => (com.mapa[`${p.nome}|${m}`] || []).some(([k]) => k === 'SEM')))
              .map(p => linhaPessoa(p, com, M)).join('')}</tbody>
          </table></div>
        </div>

        ${r.alertas.length ? `<div class="card"><h3 class="card__title"><i data-lucide="alert-triangle"></i> Alertas</h3>
          <ul class="plan-alertas">${r.alertas.map(a => `<li>${escapeAttr(a)}</li>`).join('')}</ul></div>` : ''}
      </div>`;
    lucide.createIcons({ nodes: [el] });
    ligarEventos(r);
  }

  function kpi(rotulo, valor, primeiro, cor, icone) {
    return `<div class="stat-card"><div class="stat-card__icon stat-card__icon--${valor > 0 ? cor : 'success'}"><i data-lucide="${icone}"></i></div>
      <div class="stat-card__content"><div class="stat-card__label">${rotulo}</div>
      <div class="stat-card__value currency">${formatBRL(valor)}</div>
      <div class="stat-card__hint">${valor > 0 ? `a partir de ${rot(primeiro)}` : 'todos os meses cobertos'}</div></div></div>`;
  }

  function linhaFalta(rotulo, c, M) {
    return `<tr><th>${rotulo}</th>${M.map(m => `<td class="${c.sem_mes[m] > 0 ? 'plan-falta' : 'plan-ok'}">${c.sem_mes[m] > 0 ? K(c.sem_mes[m]) : '—'}</td>`).join('')}
      <td class="${c.total_sem > 0 ? 'plan-falta' : ''}"><strong>${formatBRL(c.total_sem)}</strong></td></tr>`;
  }

  function linhaFonte(k, f, c, M) {
    const situacao = f.situacao === 'a_entrar'
      ? '<span class="plan-chip plan-chip--entrar">a entrar</span>'
      : '<span class="plan-chip">em caixa</span>';
    const sobra = c.sobra[k];
    const usado = c.usado[k];
    const vence = sobra >= 1 && f.ate_hoje < M[M.length - 1];
    return `<tr><th>${escapeAttr(f.nome)}<div class="plan-certeza">certeza ${escapeAttr(f.certeza || '—')}</div></th>
      <td>${situacao}</td>
      <td><button class="plan-valor" data-fonte="${escapeAttr(k)}" title="De onde vem este valor">${formatBRL(f.valor_hoje)}</button></td>
      <td>${rot(f.de_hoje)}–${rot(f.ate_hoje)}${f.teto_mes ? `<div class="plan-certeza">teto ${formatBRL(f.teto_mes)}/mês</div>` : ''}</td>
      <td>${usado == null ? '—' : formatBRL(usado)}</td>
      <td>${sobra == null ? '—' : formatBRL(sobra)}${vence ? '<div class="plan-certeza plan-certeza--vence">vence sem uso</div>' : ''}</td></tr>`;
  }

  // Uma cor por fonte, na ordem das premissas (legíveis no tema claro e no escuro). Cinza = o próprio centro paga.
  const PALETA = ['#8b6fd6', '#e08a3c', '#2a9d8f', '#d4a72c', '#4a7fd4', '#d4609b', '#3fa34d', '#5bb5d9'];
  function corDe(k) {
    if (k === 'SEM') return 'var(--danger)';
    if (!k.startsWith('→')) return '#9aa39d';
    const i = base.premissas.fontes.itens.findIndex(f => f.codigo === k.slice(1));
    return i < 0 ? '#9aa39d' : PALETA[i % PALETA.length];
  }

  function legenda() {
    const itens = [['o próprio centro paga', corDe('')],
      ...base.premissas.fontes.itens.map(f => [`→ ${f.codigo}`, corDe('→' + f.codigo)]), ['sem dinheiro', 'var(--danger)']];
    return itens.map(([t, c]) => `<span><i style="background:${c}"></i>${escapeAttr(t)}</span>`).join('');
  }

  function linhaPessoa(p, c, M) {
    const cel = m => {
      const x = c.mapa[`${p.nome}|${m}`] || [];
      if (!x.length) return '<td></td>';
      const dica = x.map(([k, val]) => `${k === 'SEM' ? 'sem dinheiro' : k} ${formatBRL(val)}`).join(' + ');
      const chave = x.some(([k]) => k === 'SEM') ? 'SEM' : x[x.length - 1][0];
      return `<td class="plan-cel" title="${escapeAttr(dica)}"><i style="background:${corDe(chave)}"></i></td>`;
    };
    return `<tr><th>${escapeAttr(p.nome)}</th><td>${escapeAttr(p.grupo)}</td><td>${formatBRL(p.alvo)}</td>${M.map(cel).join('')}</tr>`;
  }

  function grupos(pessoas) {
    const g = {};
    pessoas.forEach(p => { (g[p.grupo] = g[p.grupo] || []).push(p); });
    return Object.entries(g);
  }

  /* ── Eventos ─────────────────────────────────────────────── */

  function ligarEventos(r) {
    el.querySelectorAll('[data-chave]').forEach(i => i.addEventListener('change', () => {
      chaves[i.dataset.chave] = i.checked;
      render();
    }));
    el.querySelector('[data-acao="filtro"]')?.addEventListener('change', e => { filtroFalta = e.target.checked; render(); });
    el.querySelector('[data-acao="premissas"]')?.addEventListener('click', verPremissas);
    el.querySelectorAll('[data-fonte]').forEach(b => b.addEventListener('click', () => origemDaFonte(b.dataset.fonte, r.fontes[b.dataset.fonte])));
  }

  // "De onde vem este valor" de uma fonte. Do banco: abre o balancete com a linha do saldo disponível marcada e
  // explica a conta. Fixo nas premissas: mostra a origem e a ressalva gravadas com ela.
  async function origemDaFonte(k, f) {
    const c = f.cc ? base.dados.centros[f.cc] : null;
    const conta = `<p><strong>${escapeAttr(f.nome)}</strong>: ${formatBRL(f.valor_hoje)}.</p>
      <p>Como foi lido: ${escapeAttr(f.como || '')}.</p>
      ${f.ressalva ? `<p class="plan-nota">${escapeAttr(f.ressalva)}</p>` : ''}`;
    const balanceteId = f.cc ? base.balancetes[f.cc] : null;
    if (!c || !balanceteId || typeof OrigemDocumento === 'undefined') {
      createModal({ title: 'De onde vem este valor', bodyHTML: conta, saveLabel: 'Fechar', hideCancelBtn: true, onSave: () => true });
      return;
    }
    const { data: bal } = await supabaseClient.from('balancetes').select('arquivo_storage_path, arquivo_nome').eq('id', balanceteId).maybeSingle();
    if (!bal?.arquivo_storage_path) {
      createModal({ title: 'De onde vem este valor', bodyHTML: conta + '<p>O PDF deste balancete não está guardado no sistema.</p>',
        saveLabel: 'Fechar', hideCancelBtn: true, onSave: () => true });
      return;
    }
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

  async function baixar(bucket, path) {
    const { data, error } = await supabaseClient.storage.from(bucket).createSignedUrl(path, 60);
    if (error) throw new Error(error.message);
    const resp = await fetch(data.signedUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.arrayBuffer();
  }

  function verPremissas() {
    const P = base.premissas;
    const linhas = P.fontes.itens.map(f => `<li><strong>${escapeAttr(f.nome)}</strong>
      (${f.situacao === 'a_entrar' ? 'a entrar' : 'em caixa'}${f.base === 'fixo' ? `, ${formatBRL(f.valor)}` : ', lido do banco'})
      ${f.ressalva ? `<br><span class="plan-nota">${escapeAttr(f.ressalva)}</span>` : ''}</li>`).join('');
    const destinos = (P.destinos_previstos?.itens || []).map(d => `<li>${escapeAttr(d.pessoa)} no ${escapeAttr(d.cc)}:
      ${formatBRL(d.valor)}/mês, ${rot(d.de)}–${rot(d.ate)}</li>`).join('');
    createModal({
      title: 'Premissas (o que não está no banco)', maxWidth: '760px', saveLabel: 'Fechar', hideCancelBtn: true, onSave: () => true,
      bodyHTML: `<p>Versão de ${formatDate(String(base.versao.criado_em).slice(0, 10))}. Horizonte: ${rot(P.horizonte_ate)}.</p>
        <h4>Fontes</h4><ul class="plan-lista">${linhas}</ul>
        <h4>Bolsas previstas e ainda não implantadas</h4><ul class="plan-lista">${destinos || '<li>nenhuma</li>'}</ul>`,
    });
  }

  function erroCard(msg) {
    return `<div class="card"><div class="empty-state"><i data-lucide="alert-triangle"></i>
      <h3 class="empty-state__title">Não deu para montar o planejamento</h3>
      <p class="empty-state__text">${escapeAttr(msg)}</p></div></div>`;
  }

  function injetarEstilo() {
    if (document.getElementById('planejamento-css')) return;
    const s = document.createElement('style');
    s.id = 'planejamento-css';
    s.textContent = `
      .plan { display: flex; flex-direction: column; gap: var(--sp-6); }
      .plan .stats-grid { margin: 0; }
      .plan-versao { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); color: var(--text-secondary); font-size: 14px; margin: 0; }
      .plan-versao > i { width: 16px; height: 16px; }
      .plan-decisoes { display: flex; flex-direction: column; gap: var(--sp-3); }
      .plan-chave { display: flex; gap: var(--sp-3); align-items: flex-start; font-size: 14px; line-height: 1.5; cursor: pointer; }
      .plan-chave input { margin-top: 4px; accent-color: var(--accent); }
      .plan-rolagem { overflow-x: auto; }
      .plan-grade { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
      .plan-grade th, .plan-grade td { padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); text-align: right; white-space: nowrap; }
      .plan-grade tbody th, .plan-grade thead th:first-child { text-align: left; font-weight: 500; position: sticky; left: 0; background: var(--bg-surface); }
      .plan-grade thead th { color: var(--text-secondary); font-weight: 500; }
      .plan-grade--fontes th, .plan-grade--fontes td { white-space: normal; vertical-align: top; }
      .plan-grade--fontes tbody th { min-width: 220px; }
      .plan-falta { color: var(--danger); font-weight: 600; }
      .plan-ok { color: var(--text-muted); }
      .plan-certeza { font-size: 11px; color: var(--text-muted); font-weight: 400; }
      .plan-certeza--vence { color: var(--warning); }
      .plan-chip { display: inline-block; padding: 1px 8px; border-radius: var(--radius-full); font-size: 12px; background: var(--success-muted); color: var(--success); }
      .plan-chip--entrar { background: var(--warning-muted); color: var(--warning); }
      .plan-valor { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
      .plan-valor:hover, .plan-valor:focus-visible { color: var(--accent-hover); }
      .plan-nota { color: var(--text-secondary); font-size: 13px; }
      .plan-filtro { font-size: 13px; color: var(--text-secondary); display: flex; gap: 6px; align-items: center; }
      .plan-legenda { display: flex; flex-wrap: wrap; gap: var(--sp-4); font-size: 12px; color: var(--text-secondary); margin-bottom: var(--sp-3); }
      .plan-legenda span { display: inline-flex; align-items: center; gap: 6px; }
      .plan-legenda i, .plan-cel i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
      .plan-grade--pessoas td.plan-cel { text-align: center; padding: 6px 4px; }
      .plan-alertas, .plan-lista { margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6; }
    `;
    document.head.appendChild(s);
  }

  return { load };
})();
