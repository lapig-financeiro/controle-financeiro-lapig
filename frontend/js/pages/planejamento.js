/* ============================================================
   Planejamento de bolsas (admin-only) — pedido do Victor em 17/11/2026,
   refeita em 18/11/2026 para ser ferramenta de montar o planejamento
   numa reunião, não uma resposta pronta ("testar e pensar").

   A conta é o PlanejamentoMotor (frontend/js/planejamento-motor.js), porte
   fiel do refazer_mapa.py, travado por tests/planejamento-motor.test.js; o
   dinheiro de cada projeto sai de planejamento-dinheiro.js. Esta tela só
   soma o que o motor devolve para desenhar.

   Ordem da tela:
   1. Resumo: a conta inteira numa linha (bolsas do período − o que os
      próprios projetos pagam − o que as outras fontes pagam = falta), se é
      o ponto de partida ou uma simulação (com a lista do que mudou e
      "voltar"), o dinheiro que ainda não entrou e a sobra que vence sem uso.
   2. Monte a simulação: atalhos (os cenários das premissas, nomeados pelo
      que mudam em relação ao primeiro), cada fonte numa linha com liga/
      desliga, que rubricas usar e os meses em que pode pagar e paga, com as
      parcelas do plano marcadas; as duas decisões em aberto; "Como o
      dinheiro é contado" (pelo dinheiro ou pelo saldo do plano, e o que
      entra na conta).
   3. Quem paga cada mês: colunas empilhadas, legenda com o total do período.
   4. Pessoa a pessoa (fechado): bolsa dividida entre fontes aparece dividida.
   5. Avisos sobre os dados (fechado).
   As tabelas 2, 3 e 4 usam a mesma régua de meses (colgroup igual).
   Uma cor por fonte em toda a tela; cinza = o próprio projeto; vermelho =
   sem dinheiro. A situação das parcelas não usa as cores das fontes.

   "De onde vem este valor": balancete (PDF), cronograma do plano e planilha
   de bolsas da FUNAPE, pelo OrigemDocumento.

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
  const abertos = { regras: false, pessoas: false, alertas: false };
  // Como contar o dinheiro: vale para todos os cenários (os cenários só ligam e desligam fontes).
  let comoPadrao = null;    // as regras do ponto de partida (para "voltar" e para dizer o que mudou)
  let comoContar = null;   // { pelo: 'dinheiro'|'plano', modo: {codigo: 'pessoal'|'total'}, contarAtrasadas, contarSemData, contarRendimento }
  let efetivas = null;      // premissas que o motor recebe (fontes de centro já partidas por parcela)
  let dinheiro = null;      // código da fonte (ou do centro) → saída de dinheiroDoCentro
  // "118·p2" (pedaço que chega com a parcela 2) → "118"; "→118·p2" → "→118".
  const pai = k => String(k).split('·')[0];

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
    comoContar = {
      // Atrasadas e sem data entram por padrão (estão no plano), marcadas; o rendimento não (não é do plano).
      pelo: 'dinheiro', contarAtrasadas: true, contarSemData: true, contarRendimento: false,
      modo: Object.fromEntries(fontesDeCentro().map(f => [f.codigo, f.base === 'livre_pessoal' ? 'pessoal' : 'total'])),
    };
    comoPadrao = structuredClone(comoContar);
    render();
  }

  // Fontes que são dinheiro de um centro (lidas do sistema), na ordem das premissas.
  const fontesDeCentro = () => base.premissas.fontes.itens.filter(f => f.cc && (f.base === 'livre_pessoal' || f.base === 'livre_total_limitado_caixa'));

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
    const extras = {};   // cc → { balancete: {…, recursos}, plano: {…, desembolsos} } para a conta pelo dinheiro
    await Promise.all([...ccs].sort().map(async cc => {
      const p = porCodigo[cc];
      if (!p) { centros[cc] = { existe: false }; return; }
      const { data: s, error } = await supabaseClient.rpc('get_saldo_livre', { p_project_id: p.id });
      if (error) throw new Error(`Saldo livre do ${cc}: ${error.message}`);
      balancetes[cc] = s.balancete_id || null;
      const [bal, pl] = await Promise.all([
        s.balancete_id
          ? supabaseClient.from('balancetes').select('id, data_referencia, saldo_disponivel, rendimento_liquido, arquivo_storage_path, arquivo_nome, recursos:raw_extraction->data->recursos')
            .eq('id', s.balancete_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabaseClient.from('planos_trabalho').select('id, arquivo_nome, arquivo_storage_path, valor_total_plano, desembolsos:plano_desembolsos(parcela, data_prevista, data_texto, valor, valor_texto)')
          .eq('project_id', p.id).eq('ativo', true).maybeSingle(),
      ]);
      if (bal.error) throw new Error(`Balancete do ${cc}: ${bal.error.message}`);
      if (pl.error) throw new Error(`Plano do ${cc}: ${pl.error.message}`);
      extras[cc] = { balancete: bal.data, plano: pl.data };
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

    return { dados: { lido_em: new Date().toISOString().slice(0, 19), ref, centros, bolsas }, premissas, versao, balancetes, porCodigo, extras };
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

  // O dinheiro de cada centro com as opções de agora. Inclui os centros do Laerte que não são fonte,
  // só para mostrar (eles pagam as próprias bolsas e não entram na conta como fonte).
  function calcularDinheiro() {
    const D = PlanejamentoDinheiro;
    const hoje = base.dados.lido_em.slice(0, 10);
    const out = {};
    const umCentro = (cc, modo) => {
      const c = base.dados.centros[cc];
      if (!c || !c.existe) return null;
      const x = base.extras[cc] || {};
      const parcelas = D.situacaoDasParcelas({
        parcelas: x.plano?.desembolsos || [], recursos: x.balancete?.recursos || null,
        dataBalancete: x.balancete?.data_referencia || null, hoje, totalPlano: x.plano ? Number(x.plano.valor_total_plano) : null,
      });
      const devolver = PlanejamentoMotor.devolverExcluidas(cc, c, base.dados, base.premissas);
      const d = D.dinheiroDoCentro({ modo, centro: c, devolver, rendimento: x.balancete?.rendimento_liquido ?? null, parcelas,
        opcoes: comoContar, ref: base.dados.ref, horizonte: base.premissas.horizonte_ate });
      return { ...d, cc, parcelas, devolver };
    };
    for (const f of fontesDeCentro()) out[f.codigo] = umCentro(f.cc, comoContar.modo[f.codigo]);
    const ccFonte = new Set(fontesDeCentro().map(f => f.cc));
    for (const cc of base.premissas.centros_do_laerte.codigos) {
      const fim = mes(base.dados.centros[cc]?.fim);
      if (!ccFonte.has(cc) && !(fim && fim < base.dados.ref)) out[cc] = umCentro(cc, 'pessoal');
    }
    return out;
  }

  function calcular() {
    dinheiro = calcularDinheiro();
    const P0 = base.premissas;
    const porFonte = {};
    if (comoContar.pelo === 'dinheiro') fontesDeCentro().forEach(f => { if (dinheiro[f.codigo]) porFonte[f.codigo] = dinheiro[f.codigo]; });
    const P = comoContar.pelo === 'dinheiro' ? PlanejamentoDinheiro.premissasPeloDinheiro(P0, porFonte) : { ...P0, _filhos: null };
    efetivas = P;
    const expandir = lista => (P._filhos ? lista.flatMap(k => P._filhos[k] || [k]) : lista);
    // Escolha igual a um cenário gravado: usa o gravado tal como está (ordem das fontes e listas
    // das decisões exatas); só o ajuste próprio é remontado pela tela.
    const gravado = nomeDaEscolha();
    let escolhido;
    if (gravado) escolhido = { ...P.cenarios.find(c => c.codigo === gravado.codigo), codigo: '_ESC', nome: '_ESC' };
    else {
      const c = cenarioDe(escolha, '_ESC', false);
      escolhido = { ...c, fontes: expandir(c.fontes), ...(c.sobras_para_gc ? { sobras_para_gc: expandir(c.sobras_para_gc) } : {}) };
    }
    const aEntrar = new Set(P.fontes.itens.filter(f => f.situacao === 'a_entrar').map(f => f.codigo));
    const escSem = { ...escolhido, codigo: '_ESC_SEM', nome: '_ESC_SEM', fontes: escolhido.fontes.filter(f => !aEntrar.has(f)) };
    const cenarios = [...P.cenarios, escolhido, escSem];
    return PlanejamentoMotor.calcular(base.dados, { ...P, cenarios });
  }

  // Uma fonte das premissas juntando os pedaços que o motor recebeu (valor somado, janela de ponta a ponta).
  function fonteJunta(r, k) {
    const pedacos = Object.entries(r.fontes).filter(([x]) => pai(x) === k).map(([, f]) => f);
    const fi = base.premissas.fontes.itens.find(x => x.codigo === k) || {};
    if (!pedacos.length) {
      const d = dinheiro[k];
      return { ...fi, valor_hoje: 0, de_hoje: base.dados.ref, ate_hoje: d ? d.ate : base.premissas.horizonte_ate, pedacos: 0 };
    }
    return {
      ...fi, ...pedacos[0], codigo: k, nome: fi.nome || pedacos[0].nome,
      valor_hoje: pedacos.reduce((s, f) => s + Number(f.valor_hoje || 0), 0),
      de_hoje: pedacos.map(f => f.de_hoje).sort()[0], ate_hoje: pedacos.map(f => f.ate_hoje).sort().slice(-1)[0], pedacos: pedacos.length,
    };
  }

  // Soma, por fonte das premissas, o que o motor devolve por pedaço (usado, sobra).
  const somaPorPai = obj => {
    const out = {};
    Object.entries(obj || {}).forEach(([k, v]) => { out[pai(k)] = (out[pai(k)] || 0) + Number(v || 0); });
    return out;
  };

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
    if (!r.meses.length) {
      el.innerHTML = erroCard(`O horizonte das premissas (${base.premissas.horizonte_ate}) já passou. Grave premissas novas.`);
      lucide.createIcons({ nodes: [el] });
      return;
    }
    el.innerHTML = `
      <div class="plan">
        ${resumo(r)}
        ${placar(r)}
        ${simulacao(r)}
        ${mesAMes(r)}
        ${pessoas(r)}
        ${alertas(r)}
        <p class="plan-rodape">Bolsas, saldos, balancetes e planos lidos agora do sistema. O que não está no sistema (dinheiro
          combinado, bolsas previstas) vem das premissas gravadas em ${formatDate(String(base.versao.criado_em).slice(0, 10))}.
          As simulações não ficam salvas.
          <button class="plan-link" data-acao="premissas">Ver as premissas</button></p>
      </div>`;
    lucide.createIcons({ nodes: [el] });
    ligarEventos();
    vigiarPlacar();
  }

  // Nome de uma fonte, igual em toda a tela: "30.118 WRI Brasil", "WRI GPW FY27", "Guarda-chuva".
  const curto = f => String(f.nome).split(':')[0].trim();
  const nomeFonte = k => { const f = base.premissas.fontes.itens.find(x => x.codigo === k); return f ? curto(f) : k; };
  const lista = xs => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);
  const maiuscula = s => s.charAt(0).toUpperCase() + s.slice(1);

  // O que mudou em relação ao ponto de partida (o primeiro cenário das premissas e as regras padrão).
  // É o nome dos atalhos e o que o resumo diz que está sendo simulado: um vocabulário só.
  function mudancas(e, como) {
    const A = escolhaDe(base.premissas.cenarios[0]);
    const out = [];
    const tirou = base.premissas.fontes.itens.map(f => f.codigo).filter(k => A.fontes.has(k) && !e.fontes.has(k));
    const pos = base.premissas.fontes.itens.map(f => f.codigo).filter(k => !A.fontes.has(k) && e.fontes.has(k));
    if (tirou.length) out.push('sem ' + lista(tirou.map(nomeFonte)));
    if (pos.length) out.push('com ' + lista(pos.map(nomeFonte)));
    if (e.sobrasGC !== A.sobrasGC) out.push(e.sobrasGC ? 'sobras para o guarda-chuva' : 'sobras ficam nos projetos');
    if (e.continua !== A.continua) out.push(e.continua ? '30.109 ICS e 30.113 GMH continuam depois do fim' : '30.109 ICS e 30.113 GMH acabam com o projeto');
    if (como) {
      if (como.pelo !== comoPadrao.pelo) out.push(como.pelo === 'plano' ? 'conta pelo saldo do plano' : 'conta pelo dinheiro');
      if (como.pelo === 'dinheiro') {
        if (como.contarAtrasadas !== comoPadrao.contarAtrasadas) out.push(como.contarAtrasadas ? 'com parcelas atrasadas' : 'sem parcelas atrasadas');
        if (como.contarSemData !== comoPadrao.contarSemData) out.push(como.contarSemData ? 'com parcelas sem data' : 'sem parcelas sem data');
        if (como.contarRendimento !== comoPadrao.contarRendimento) out.push(como.contarRendimento ? 'com o rendimento' : 'sem o rendimento');
        Object.entries(como.modo).filter(([k, v]) => v !== comoPadrao.modo[k])
          .forEach(([k, v]) => out.push(`${nomeFonte(k)} ${v === 'total' ? 'usa todas as rubricas' : 'usa só Pessoal'}`));
      }
    }
    return out;
  }

  // Soma, por mês, o que cada fonte paga no cenário escolhido. Chaves: '_proprio', '→<fonte>', 'SEM'.
  function porMes(r) {
    const c = r.cenarios._ESC;
    const out = {};
    r.meses.forEach(m => { out[m] = {}; });
    r.pessoas.forEach(p => r.meses.forEach(m => {
      (c.mapa[`${p.nome}|${m}`] || []).forEach(([k, val]) => {
        const chave = k === 'SEM' ? 'SEM' : (k.startsWith('→') ? pai(k) : '_proprio');
        out[m][chave] = (out[m][chave] || 0) + val;
      });
    }));
    return out;
  }

  const somaChave = (pm, k) => Object.values(pm).reduce((s, x) => s + (x[k] || 0), 0);

  // 1. A conta inteira em uma linha: custo − o que os projetos pagam − o que as outras fontes pagam = falta.
  function resumo(r) {
    const c = r.cenarios._ESC, sem = r.cenarios._ESC_SEM;
    const M = r.meses;
    const pm = porMes(r);
    const custo = M.reduce((s, m) => s + Object.values(pm[m]).reduce((a, b) => a + b, 0), 0);
    const proprio = somaChave(pm, '_proprio');
    const outras = M.reduce((s, m) => s + Object.entries(pm[m]).filter(([k]) => k.startsWith('→')).reduce((a, [, v]) => a + v, 0), 0);
    const falta = c.total_sem;
    const mensal = r.pessoas.reduce((s, p) => s + p.alvo, 0);
    const inicioFalta = M.find(m => c.sem_mes[m] > 0);
    const ultimoPago = inicioFalta ? M[M.indexOf(inicioFalta) - 1] : null;
    const mud = mudancas(escolha, comoContar);

    // Dinheiro que ainda não entrou e foi usado: fontes "a entrar" e parcelas futuras dos planos.
    const aEntrar = efetivas.fontes.itens.filter(f => f.situacao === 'a_entrar' && escolha.fontes.has(pai(f.codigo)));
    const usadoAEntrar = aEntrar.reduce((s, f) => s + Number(c.usado[f.codigo] || 0), 0);
    const nomesAEntrar = [...new Set(aEntrar.map(f => (f._pai ? 'parcelas previstas nos planos' : nomeFonte(f.codigo))))];
    const notaEntrar = usadoAEntrar >= 1 && sem.total_sem > falta
      ? `<li><i data-lucide="hourglass"></i><span>Esta conta usa ${formatBRL(usadoAEntrar)} que ainda não entrou (${esc(lista(nomesAEntrar))}).
          Se esse dinheiro não vier, a falta sobe para <strong>${formatBRL(sem.total_sem)}</strong>.</span></li>` : '';

    // Sobra que vence sem uso enquanto falta dinheiro depois.
    const sobraPai = somaPorPai(c.sobra);
    const vencem = base.premissas.fontes.itens.filter(f => escolha.fontes.has(f.codigo) && sobraPai[f.codigo] >= 1
      && inicioFalta && fonteJunta(r, f.codigo).ate_hoje < inicioFalta);
    const totVence = vencem.reduce((s, f) => s + sobraPai[f.codigo], 0);
    const temSobrasGC = base.premissas.cenarios.some(x => x.sobras_para_gc && x.sobras_para_gc.length);
    const notaVence = falta > 0 && totVence >= 1
      ? `<li><i data-lucide="alert-circle"></i><span>${formatBRL(totVence)} sobram sem uso em ${esc(lista(vencem.map(curto)))}:
          esses projetos acabam antes de ${rot(inicioFalta)}.
          ${temSobrasGC && !escolha.sobrasGC ? '<button class="plan-link" data-liga="sobrasGC">Testar com as sobras indo para o guarda-chuva</button>' : ''}</span></li>` : '';

    const item = (rot1, valor, sub, extra = '') => `<div class="plan-conta__item ${extra}"><span class="plan-conta__rot">${rot1}</span>
      <span class="plan-conta__valor">${valor}</span><span class="plan-conta__sub">${sub}</span></div>`;
    return `
      <section class="card plan-resumo">
        <div class="plan-resumo__estado">
          ${mud.length
            ? `<span class="plan-estado plan-estado--sim">Sua simulação</span><span class="plan-resumo__mud">${esc(maiuscula(mud.join('; ')))}</span>
               <button class="btn btn--ghost btn--sm" data-acao="voltar"><i data-lucide="rotate-ccw"></i> Voltar ao ponto de partida</button>`
            : '<span class="plan-estado">Ponto de partida</span><span class="plan-resumo__mud">Todo o dinheiro previsto, cada projeto pagando até acabar. Mude o que quiser abaixo.</span>'}
        </div>
        <div class="plan-conta">
          ${item(`Bolsas de ${rot(M[0])} a ${rot(M[M.length - 1])}`, `<button class="plan-num" data-acao="mensal">${formatBRL(custo)}</button>`,
            `${r.pessoas.length} pessoas, ${formatBRL(mensal)} por mês hoje`)}
          <span class="plan-conta__op" aria-hidden="true">−</span>
          ${item('Pagam os próprios projetos', formatBRL(proprio), 'com o dinheiro de cada um')}
          <span class="plan-conta__op" aria-hidden="true">−</span>
          ${item('Pagam outras fontes', formatBRL(outras), 'as fontes ligadas abaixo')}
          <span class="plan-conta__op" aria-hidden="true">=</span>
          ${falta > 0
            ? item('Falta', `<button class="plan-num" data-acao="mes-falta">${formatBRL(falta)}</button>`, `o dinheiro cobre até ${rot(ultimoPago || M[0])}`, 'plan-conta__item--falta')
            : item('Falta', formatBRL(0), `todas pagas até ${rot(M[M.length - 1])}`, 'plan-conta__item--ok')}
        </div>
        ${notaEntrar || notaVence ? `<ul class="plan-resumo__notas">${notaEntrar}${notaVence}</ul>` : ''}
      </section>`;
  }

  // Placar fixo no alto enquanto se mexe na simulação (quando o resumo sai da vista): estado, falta e até quando.
  function placar(r) {
    const c = r.cenarios._ESC, M = r.meses;
    const ini = M.find(m => c.sem_mes[m] > 0);
    const mud = mudancas(escolha, comoContar).length;
    return `<div class="plan-placar" aria-hidden="true"><div class="plan-placar__barra">
      <span class="plan-estado ${mud ? 'plan-estado--sim' : ''}">${mud ? `Sua simulação (${mud} ${mud > 1 ? 'mudanças' : 'mudança'})` : 'Ponto de partida'}</span>
      ${c.total_sem > 0
        ? `<span>Falta <strong class="plan-falta">${formatBRL(c.total_sem)}</strong></span><span>o dinheiro cobre até <strong>${rot(M[M.indexOf(ini) - 1] || M[0])}</strong></span>`
        : `<span class="plan-ok">Não falta dinheiro até ${rot(M[M.length - 1])}</span>`}
    </div></div>`;
  }

  // Mostra o placar quando o resumo passa por baixo da barra do topo. Um ouvinte só, ligado na primeira vez;
  // ele procura os elementos de agora a cada rolagem (a tela é redesenhada a cada mudança).
  let vigiando = false;
  function acertarPlacar() {
    const resumoEl = el && el.querySelector('.plan-resumo'), p = el && el.querySelector('.plan-placar');
    if (!resumoEl || !p || !p.isConnected) return;
    const topo = document.querySelector('.topbar')?.offsetHeight || 0;
    p.style.top = topo + 'px';
    p.classList.toggle('plan-placar--on', resumoEl.getBoundingClientRect().bottom < topo + 8);
  }
  function vigiarPlacar() {
    if (!vigiando) {
      vigiando = true;
      window.addEventListener('scroll', acertarPlacar, { passive: true, capture: true });
      window.addEventListener('resize', acertarPlacar, { passive: true });
    }
    acertarPlacar();
  }

  // A mesma régua de meses nas três tabelas (fontes, gráfico, pessoas): coluna de rótulo, um mês por coluna, coluna de valor.
  const regua = M => `<colgroup><col class="plan-col-rot">${M.map(() => '<col>').join('')}<col class="plan-col-val"></colgroup>`;
  const cabMeses = (M, esq, dir) => `<thead><tr><th class="plan-esq">${esq}</th>${M.map(m =>
    `<th class="plan-m ${m.endsWith('-01') && m !== M[0] ? 'plan-m--ano' : ''}">${rot(m)}</th>`).join('')}<th class="plan-dir">${dir}</th></tr></thead>`;
  const grade = (M, miolo) => `<p class="plan-rolar">Arraste a tabela para o lado para ver todos os meses.</p>
    <div class="plan-rolagem"><table class="plan-grade" style="--meses:${M.length}">${regua(M)}${miolo}</table></div>`;

  // Parcela que pede conferência (atrasada, nota não paga, vencida depois do balancete, sem balancete).
  const PENDENTE = new Set(['atrasada', 'confirmar', 'nota_emitida', 'parcial', 'sem_balancete']);
  const COR_SIT = { em_caixa: 'var(--success)', recebida: 'var(--success)', nota_emitida: 'var(--warning)', atrasada: 'var(--danger)', confirmar: 'var(--danger)',
    parcial: 'var(--warning)', futura: 'var(--text-muted)', sem_data: 'var(--text-muted)', sem_balancete: 'var(--text-muted)', sem_valor: 'var(--danger)' };

  // Texto curto que diz o que é cada fonte, sem jargão.
  function descricao(fi, d) {
    if (d) return d.ate < base.premissas.horizonte_ate ? `Saldo do projeto, que acaba em ${rot(d.ate)}` : 'Saldo do projeto';
    const resto = String(fi.nome).split(':').slice(1).join(':').trim();
    const usd = /US\$\s*([\d.,]+)\s*mil/.exec(fi.nome);
    const partes = [];
    if (usd && fi.valor) {
      const dolares = Number(usd[1].replace(/\./g, '').replace(',', '.')) * 1000;
      partes.push(`US$ ${Math.round(dolares / 1000)} mil ≈ ${formatBRL(fi.valor)} (R$ ${(fi.valor / dolares).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por dólar)`);
    } else {
      if (resto) partes.push(maiuscula(resto));
      if (fi.valor) partes.push(formatBRL(fi.valor));
    }
    if (fi.teto_mes) partes.push(`até ${formatBRL(fi.teto_mes)} por mês`);
    return partes.join(', ');
  }

  // 2. A simulação: cada dinheiro numa linha, com liga/desliga, o que entra na conta e os meses em que paga.
  function simulacao(r) {
    const c = r.cenarios._ESC;
    const M = r.meses;
    const pm = porMes(r);
    const usadoPai = somaPorPai(c.usado), sobraPai = somaPorPai(c.sobra);
    const pelo = comoContar.pelo;
    const P = base.premissas;

    const atalhos = P.cenarios.map((x, i) => {
      const ativo = mesmaEscolha(escolhaDe(x), escolha);
      const nome = i === 0 ? 'Ponto de partida' : maiuscula(mudancas(escolhaDe(x)).join('; ') || x.nome);
      const f = r.cenarios[x.codigo].total_sem;
      return `<button class="plan-atalho ${ativo ? 'plan-atalho--ativo' : ''}" data-cenario="${esc(x.codigo)}" aria-pressed="${ativo}" title="${esc(x.explica || '')}">
        <span>${esc(nome)}</span><span class="${f > 0 ? 'plan-falta' : 'plan-ok'}">${f > 0 ? `falta ${K(f)}` : 'não falta'}</span></button>`;
    }).join('');

    const linhas = P.fontes.itens.map(fi => {
      const k = fi.codigo, f = fonteJunta(r, k);
      const d = dinheiro[k];
      const fora = !escolha.fontes.has(k);
      const usado = usadoPai[k] || 0, sobra = sobraPai[k] || 0;
      const vence = !fora && sobra >= 1 && f.ate_hoje < M[M.length - 1];
      const marcos = pelo === 'dinheiro' && d ? d.tranches.filter(t => t.chave !== 'hoje') : [];
      const cor = corDe('→' + k);
      const conta = d
        ? `<label class="plan-usar">Usar <select class="plan-sel" data-modo="${esc(k)}" ${pelo === 'plano' ? 'disabled title="Só vale na conta pelo dinheiro"' : ''}>
            <option value="pessoal" ${comoContar.modo[k] === 'pessoal' ? 'selected' : ''}>só a rubrica Pessoal</option>
            <option value="total" ${comoContar.modo[k] === 'total' ? 'selected' : ''}>todas as rubricas</option></select></label>`
        : (fi.situacao === 'a_entrar' ? '<span class="plan-chip plan-chip--entrar">ainda não entrou</span>' : '');
      const celula = m => {
        const dentro = f.valor_hoje > 0 && m >= f.de_hoje && m <= f.ate_hoje;
        const uso = fora ? 0 : (pm[m]['→' + k] || 0);
        const aqui = marcos.filter(t => t.de === m);
        const dica = [`${rot(m)}: ${uso ? `paga ${formatBRL(uso)}` : dentro ? 'pode pagar, sem uso' : 'não paga'}`,
          ...aqui.map(t => `chega ${formatBRL(t.valor)} (${t.rotulo}${t.situacao && PENDENTE.has(t.situacao) ? ', conferir' : ''})`)].join('; ');
        const marco = aqui.length ? `<i class="plan-marco ${aqui.some(t => PENDENTE.has(t.situacao)) ? 'plan-marco--conferir' : ''}"></i>` : '';
        return `<td class="plan-t ${m.endsWith('-01') && m !== M[0] ? 'plan-m--ano' : ''}" title="${esc(dica)}">
          <span class="plan-t__faixa ${dentro ? 'plan-t__faixa--pode' : ''} ${uso ? 'plan-t__faixa--usa' : ''}" style="--cor:${cor}"></span>${marco}</td>`;
      };
      return `<tr class="${fora ? 'plan-desligada' : ''}">
        <th class="plan-esq">
          <div class="plan-fonte-topo">
            <label class="plan-sw" title="${fora ? 'Ligar' : 'Desligar'} este dinheiro na simulação">
              <input type="checkbox" data-fonte-chk="${esc(k)}" ${fora ? '' : 'checked'} aria-label="Usar ${esc(curto(fi))}"><span></span></label>
            <button class="plan-fonte" data-fonte="${esc(k)}" title="Ver a conta e os documentos"><i class="plan-cor" style="background:${cor}"></i>${esc(curto(fi))}</button>
          </div>
          <div class="plan-miudo">${esc(descricao(fi, d))}</div>
          ${conta ? `<div class="plan-fonte-conta">${conta}</div>` : ''}
        </th>
        ${M.map(celula).join('')}
        <td class="plan-dir">
          <button class="plan-num" data-fonte="${esc(k)}" title="Ver a conta">${formatBRL(f.valor_hoje)}</button>
          ${fora ? '<div class="plan-miudo">desligada</div>' : `<div class="plan-miudo">usa ${formatBRL(usado)}</div>
          ${sobra >= 1 ? `<div class="plan-miudo ${vence ? 'plan-vence' : ''}">sobra ${formatBRL(sobra)}${vence ? ' sem uso' : ''}</div>` : ''}`}
        </td></tr>`;
    }).join('');

    // Projetos do Laerte que não são fonte: pagam só as próprias bolsas (cinza no gráfico).
    const proprios = Object.entries(dinheiro).filter(([k, d]) => d && !P.fontes.itens.some(f => f.codigo === k))
      .map(([cc, d]) => `<button class="plan-link" data-centro="${esc(cc)}">${esc(cc)} ${esc(base.dados.centros[cc]?.nome || '')}</button> até ${rot(d.ate)}`);
    const comFim = P.cenarios.find(x => x.encerra_com_cc && x.encerra_com_cc.length);
    const comSobras = P.cenarios.find(x => x.sobras_para_gc && x.sobras_para_gc.length);
    const chk = (chave, texto) => `<label class="plan-chk"><input type="checkbox" data-como="${chave}" ${comoContar[chave] ? 'checked' : ''} ${pelo === 'plano' ? 'disabled' : ''}> <span>${texto}</span></label>`;
    const gc = c.para_gc && Object.entries(somaPorPai(c.para_gc)).filter(([, x]) => x > 0);

    return `
      <section class="card">
        <div class="card__header"><div><h3 class="card__title">Monte a simulação</h3>
          <p class="card__subtitle">Ligue ou desligue cada dinheiro e veja o efeito na conta acima e no resto da página.
            Clique no nome ou no valor para ver de onde ele vem.</p></div></div>
        <div class="plan-atalhos"><span class="plan-atalhos__rot">Comece por</span>${atalhos}</div>
        <div class="plan-legenda">
          <span><i class="plan-amostra plan-amostra--pode"></i>pode pagar neste mês</span>
          <span><i class="plan-amostra plan-amostra--usa"></i>está pagando</span>
          ${pelo === 'dinheiro' ? `<span><i class="plan-marco plan-marco--solto"></i>parcela do plano que vai entrar</span>
          <span><i class="plan-marco plan-marco--solto plan-marco--conferir"></i>parcela atrasada ou com nota não paga: conferir</span>` : ''}
        </div>
        ${grade(M, `${cabMeses(M, 'De onde vem o dinheiro', 'Pode pagar')}<tbody>${linhas}</tbody>`)}
        ${gc && gc.length ? `<p class="plan-nota">Foram para o guarda-chuva: ${gc.map(([k, x]) => `${esc(nomeFonte(k))}, ${formatBRL(x)}`).join('; ')}.</p>` : ''}
        ${proprios.length ? `<p class="plan-nota">Pagam só as próprias bolsas (cinza no gráfico): ${proprios.join('; ')}.</p>` : ''}

        <div class="plan-decisoes">
          <h4>Decisões em aberto</h4>
          ${comSobras ? `<label class="plan-chk"><input type="checkbox" data-decisao="sobrasGC" ${escolha.sobrasGC ? 'checked' : ''}>
            <span><strong>Quando um projeto acaba, a sobra dele paga bolsas pelo guarda-chuva</strong>
            <span class="plan-miudo">Sem o limite mensal do guarda-chuva. Exige mudar o plano dele.</span></span></label>` : ''}
          ${comFim ? `<label class="plan-chk"><input type="checkbox" data-decisao="continua" ${escolha.continua ? 'checked' : ''}>
            <span><strong>Bolsistas do 30.109 ICS e do 30.113 GMH continuam depois que esses projetos acabam</strong>
            <span class="plan-miudo">Desmarcado, a parte da bolsa paga por esses projetos termina com eles.</span></span></label>` : ''}
        </div>

        <details class="plan-det" data-det="regras" ${abertos.regras ? 'open' : ''}>
          <summary><i data-lucide="calculator"></i> Como o dinheiro é contado</summary>
          <div class="plan-regras">
            <div class="plan-seg" role="group" aria-label="Como contar o dinheiro dos projetos">
              <button data-pelo="dinheiro" aria-pressed="${pelo === 'dinheiro'}">Pelo dinheiro: o que entrou e as parcelas previstas</button>
              <button data-pelo="plano" aria-pressed="${pelo === 'plano'}">Pelo saldo do plano, sem olhar o caixa</button>
            </div>
            <p class="plan-nota">${pelo === 'dinheiro'
              ? 'Cada projeto paga com o caixa do último balancete (sem o rendimento da aplicação) e com cada parcela do plano a partir do mês em que ela entra, nunca mais que o saldo do plano.'
              : 'Cada projeto paga com o saldo livre do plano, como se todo o dinheiro já estivesse em caixa.'}</p>
            ${chk('contarAtrasadas', 'Contar parcelas atrasadas (venceram e não aparecem no balancete)')}
            ${chk('contarSemData', 'Contar parcelas sem data (pagas por entrega)')}
            ${chk('contarRendimento', 'Contar o rendimento da aplicação')}
          </div>
        </details>
      </section>`;
  }

  function rotuloFonte(k) {
    if (k === 'SEM') return 'sem dinheiro';
    if (k === '_proprio') return 'próprios projetos';
    if (!k.startsWith('→')) return `o próprio projeto (${k})`;
    return nomeFonte(pai(k.slice(1)));
  }

  // 3. Quem paga cada mês: colunas empilhadas na mesma régua, legenda com o total do período ao lado.
  function mesAMes(r) {
    const pm = porMes(r);
    const M = r.meses;
    const tot = m => Object.values(pm[m]).reduce((s, x) => s + x, 0);
    const max = Math.max(...M.map(tot), 1);
    const ordem = ['_proprio', ...base.premissas.fontes.itens.map(f => '→' + f.codigo), 'SEM'];
    const usadas = ordem.filter(k => M.some(m => pm[m][k] > 0));
    const barra = m => `<td class="plan-b ${m.endsWith('-01') && m !== M[0] ? 'plan-m--ano' : ''}">
      <button class="plan-mes" data-mes="${m}" title="${esc(`${rot(m)}: ${formatBRL(tot(m))}. Clique para o detalhe.`)}">
        ${ordem.filter(k => pm[m][k] > 0).map(k => `<i style="height:${(pm[m][k] / max) * 100}%;background:${corDe(k)}"></i>`).join('')}</button></td>`;
    const falta = m => { const f = pm[m].SEM || 0; return `<td class="plan-b__falta ${m.endsWith('-01') && m !== M[0] ? 'plan-m--ano' : ''}">${f > 0 ? `${Math.round(f / 1000).toLocaleString('pt-BR')} mil` : ''}</td>`; };
    const legenda = usadas.map(k => `<li><i style="background:${corDe(k)}"></i><span>${esc(maiuscula(rotuloFonte(k)))}</span>
      <span class="${k === 'SEM' ? 'plan-falta' : ''}" title="${esc(formatBRL(somaChave(pm, k)))}">${K(somaChave(pm, k))}</span></li>`).join('');
    return `
      <section class="card">
        <div class="card__header"><div><h3 class="card__title">Quem paga cada mês</h3>
          <p class="card__subtitle">A altura é o total das bolsas no mês; as cores, de onde sai o dinheiro. Clique num mês para o detalhe.</p></div></div>
        ${grade(M, `${cabMeses(M, '', 'No período')}<tbody>
          <tr><th class="plan-esq plan-eixo"><span>${K(max)}</span><span>R$ 0</span></th>${M.map(barra).join('')}
            <td class="plan-dir plan-legenda-lado"><ul>${legenda}</ul></td></tr>
          <tr><th class="plan-esq plan-falta">Sem dinheiro (R$)</th>${M.map(falta).join('')}<td class="plan-dir"></td></tr></tbody>`)}
      </section>`;
  }

  // Legenda de cores usada logo acima da tabela de pessoas (para não depender do gráfico lá em cima).
  function legendaFontes(r) {
    const pm = porMes(r);
    const ordem = ['_proprio', ...base.premissas.fontes.itens.map(f => '→' + f.codigo), 'SEM'];
    return ordem.filter(k => r.meses.some(m => pm[m][k] > 0))
      .map(k => `<span><i style="background:${corDe(k)}"></i>${esc(maiuscula(rotuloFonte(k)))}</span>`).join('');
  }

  // 4. Pessoa a pessoa, na mesma régua. Bolsa paga por mais de uma fonte no mês aparece dividida.
  function pessoas(r) {
    const c = r.cenarios._ESC;
    const M = r.meses;
    const faltaDe = p => M.reduce((s, m) => s + (c.mapa[`${p.nome}|${m}`] || []).filter(([k]) => k === 'SEM').reduce((a, [, v]) => a + v, 0), 0);
    const lista_ = r.pessoas.filter(p => !filtroFalta || faltaDe(p) > 0);
    const semNenhum = r.pessoas.filter(p => faltaDe(p) > 0).length;
    const cel = (p, m) => {
      const ano = m.endsWith('-01') && m !== M[0] ? 'plan-m--ano' : '';
      const x = c.mapa[`${p.nome}|${m}`] || [];
      if (!x.length) return `<td class="plan-c ${ano}"></td>`;
      const grupos = {};
      x.forEach(([k, v]) => { const g = k === 'SEM' ? 'SEM' : k.startsWith('→') ? pai(k) : '_proprio'; grupos[g] = (grupos[g] || 0) + v; });
      const tot = Object.values(grupos).reduce((s, v) => s + v, 0);
      const dica = `${rot(m)}, ${formatBRL(tot)}: ` + Object.entries(grupos).map(([g, v]) =>
        `${g === '_proprio' ? 'o próprio projeto' : rotuloFonte(g)} ${formatBRL(v)}`).join(' + ');
      let acum = 0;
      const fundo = Object.keys(grupos).length === 1 ? corDe(Object.keys(grupos)[0])
        : `linear-gradient(to top, ${Object.entries(grupos).map(([g, v]) => { const a = acum; acum += v / tot * 100; return `${corDe(g)} ${a}% ${acum}%`; }).join(', ')})`;
      return `<td class="plan-c ${ano}" title="${esc(dica)}"><i style="background:${fundo}"></i></td>`;
    };
    const linhas = lista_.map(p => {
      const f = faltaDe(p);
      return `<tr><th class="plan-esq"><div class="plan-pessoa"><strong title="${esc(p.nome)}">${esc(p.nome)}</strong>
          <button class="plan-num" data-pessoa="${esc(p.nome)}" title="De onde vem este valor">${formatBRL(p.alvo)}/mês</button></div>
          <div class="plan-miudo" title="${esc(String(p.grupo).split(' + ').map(cc => `${cc} ${base.dados.centros[cc]?.nome || ''}`).join(' + '))}">${esc(p.grupo)}</div></th>
        ${M.map(m => cel(p, m)).join('')}
        <td class="plan-dir">${f > 0 ? `<span class="plan-falta">${formatBRL(f)}</span>` : '<span class="plan-miudo">—</span>'}</td></tr>`;
    }).join('');
    return `
      <details class="card plan-det plan-det--card" data-det="pessoas" ${abertos.pessoas ? 'open' : ''}>
        <summary><span><strong>Pessoa a pessoa</strong> · ${r.pessoas.length} pessoas${semNenhum ? `, <span class="plan-falta">${semNenhum} ficam sem dinheiro em algum mês</span>` : ''}</span></summary>
        <div class="plan-det__corpo">
          <div class="plan-pessoas-topo">
            <p class="plan-nota">Quem fica sem dinheiro depende da ordem da lista; o total do mês, não. Isto não é proposta de quem sai.</p>
            <label class="plan-chk plan-chk--linha"><input type="checkbox" data-acao="filtro" ${filtroFalta ? 'checked' : ''}> Só quem fica sem dinheiro</label>
          </div>
          <div class="plan-legenda">${legendaFontes(r)}</div>
          ${grade(M, `${cabMeses(M, 'Pessoa e projeto', 'Sem dinheiro')}<tbody>${linhas}</tbody>`)}
        </div>
      </details>`;
  }

  // Datas dos avisos no formato da tela (2026-10-01 → 01/10/2026).
  const dataBr = s => String(s).replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1');

  function alertas(r) {
    if (!r.alertas.length) return '';
    return `<details class="card plan-det plan-det--card" data-det="alertas" ${abertos.alertas ? 'open' : ''}>
      <summary><span><i data-lucide="alert-triangle"></i> <strong>Avisos sobre os dados</strong> · ${r.alertas.length}</span></summary>
      <div class="plan-det__corpo"><ul class="plan-lista">${r.alertas.map(a => `<li>${esc(dataBr(a))}</li>`).join('')}</ul></div></details>`;
  }

  // Uma cor por fonte, na ordem das premissas, a mesma em toda a tela. Cinza = o próprio projeto paga.
  const PALETA = ['#8b6fd6', '#e08a3c', '#2a9d8f', '#d4a72c', '#4a7fd4', '#d4609b', '#3fa34d', '#5bb5d9'];
  function corDe(k) {
    if (k === 'SEM') return 'var(--danger)';
    if (!k.startsWith('→')) return '#a9b1ab';
    const i = base.premissas.fontes.itens.findIndex(f => f.codigo === pai(k.slice(1)));
    return i < 0 ? '#a9b1ab' : PALETA[i % PALETA.length];
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
    el.querySelectorAll('[data-liga]').forEach(b => b.addEventListener('click', () => { escolha[b.dataset.liga] = true; render(); }));
    el.querySelector('[data-acao="voltar"]')?.addEventListener('click', () => {
      escolha = escolhaDe(base.premissas.cenarios[0]);
      comoContar = structuredClone(comoPadrao);
      render();
    });
    el.querySelectorAll('details[data-det]').forEach(d => d.addEventListener('toggle', () => { abertos[d.dataset.det] = d.open; }));
    el.querySelector('[data-acao="filtro"]')?.addEventListener('change', e => { filtroFalta = e.target.checked; render(); });
    el.querySelector('[data-acao="premissas"]')?.addEventListener('click', verPremissas);
    el.querySelector('[data-acao="mensal"]')?.addEventListener('click', () => verMensal(r));
    el.querySelector('[data-acao="mes-falta"]')?.addEventListener('click', () => {
      const m = r.meses.find(x => r.cenarios._ESC.sem_mes[x] > 0);
      if (m) verMes(r, m);
    });
    el.querySelectorAll('[data-mes]').forEach(b => b.addEventListener('click', () => verMes(r, b.dataset.mes)));
    el.querySelectorAll('[data-fonte]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.fonte;
      if (dinheiro[k]) verDinheiro(k, r); else origemDaFonte(k, fonteJunta(r, k));
    }));
    el.querySelectorAll('[data-centro]').forEach(b => b.addEventListener('click', () => verDinheiro(b.dataset.centro, r)));
    el.querySelectorAll('[data-modo]').forEach(s => s.addEventListener('change', () => { comoContar.modo[s.dataset.modo] = s.value; render(); }));
    el.querySelectorAll('[data-pelo]').forEach(b => b.addEventListener('click', () => { comoContar.pelo = b.dataset.pelo; render(); }));
    el.querySelectorAll('[data-como]').forEach(i => i.addEventListener('change', () => { comoContar[i.dataset.como] = i.checked; render(); }));
    el.querySelectorAll('[data-pessoa]').forEach(b => b.addEventListener('click', () => origemDaPessoa(r.pessoas.find(p => p.nome === b.dataset.pessoa))));
  }

  const modal = (title, bodyHTML, maxWidth) => createModal({ title, bodyHTML, maxWidth: maxWidth || '640px', saveLabel: 'Fechar', hideCancelBtn: true, onSave: () => true });

  // Como chegamos ao total por mês: soma das bolsas por centro.
  function verMensal(r) {
    const g = {};
    r.pessoas.forEach(p => p.base_linhas.forEach(([cc, v]) => { g[cc] = g[cc] || { n: 0, v: 0 }; g[cc].n += 1; g[cc].v += v; }));
    const total = r.pessoas.reduce((s, p) => s + p.alvo, 0);
    modal('A manter por mês', `<p>Soma da bolsa de cada pessoa em ${rot(base.dados.ref)}, por centro. Quem só começa depois entra com o valor do primeiro mês da bolsa.
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
      ${f.como && fi.base !== 'fixo' ? `<p>Como foi lido: ${esc(f.como)}.</p>` : ''}
      ${fi.ressalva || f.ressalva ? `<p class="plan-nota">${esc(fi.ressalva || f.ressalva)}</p>` : ''}
      ${fi.base === 'fixo' ? '<p class="plan-nota">Valor fixo gravado nas premissas: não vem de documento do sistema.</p>' : ''}`;
    const balanceteId = f.cc ? base.balancetes[f.cc] : null;
    if (fi.base === 'fixo' || !c || !balanceteId || typeof OrigemDocumento === 'undefined') { modal('De onde vem este valor', conta); return; }
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

  // A conta do dinheiro de um centro, passo a passo, com as parcelas e os dois documentos (balancete e plano).
  function verDinheiro(k, r) {
    const d = dinheiro[k];
    if (!d) return;
    const cc = d.cc;
    const c = base.dados.centros[cc] || {};
    const x = base.extras[cc] || {};
    const fi = base.premissas.fontes.itens.find(f => f.codigo === k);
    const sinal = v => (v == null ? '—' : v < 0 ? `− ${formatBRL(-v)}` : formatBRL(v));
    const passos = d.passos.map(p => `<tr class="${p.chave === 'hoje' || p.chave === 'teto' ? 'plan-forte' : ''}"><th>${esc(p.rotulo)}</th><td>${sinal(p.valor)}</td></tr>`).join('');
    const nesta = i => {
      const t = d.tranches.find(t => t.parcela === i.parcela);
      if (t) return `${formatBRL(t.valor)} a partir de ${rot(t.de)}${t.tapa ? ` <span class="plan-miudo">(antes, ${formatBRL(t.tapa)} vão para o que o centro já tem de pagar)</span>` : ''}`;
      const f = d.fora.find(f => f.parcela === i.parcela);
      return f ? `<span class="plan-miudo">fora: ${esc(f.motivo)}</span>` : (i.situacao === 'recebida' ? '<span class="plan-miudo">já está no caixa</span>' : '');
    };
    const S = PlanejamentoDinheiro.SITUACOES;
    const parc = d.parcelas.itens.length
      ? `<table class="plan-tab"><thead><tr><th>Parcela</th><th>Quando</th><th>Valor</th><th>Situação</th><th>Nesta conta</th></tr></thead><tbody>
        ${d.parcelas.itens.map(i => `<tr><th>${i.parcela}</th><td>${esc(i.quando || '—')}</td>
          <td>${i.valor != null ? formatBRL(i.valor) : `<span class="plan-falta">"${esc(i.valor_texto || '?')}"</span>`}</td>
          <td><span class="plan-sit" style="--cor:${COR_SIT[i.situacao] || 'var(--success)'}">${esc(S[i.situacao]?.rotulo || i.situacao)}</span>
            ${i.situacao === 'parcial' ? `<div class="plan-miudo">entraram ${formatBRL(i.recebido)}</div>` : ''}</td>
          <td>${nesta(i)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="plan-nota">O plano ativo deste centro não tem cronograma de desembolso no sistema.</p>';
    const pr = d.parcelas;
    const entrou = pr.recebido != null
      ? `<p>O balancete de ${formatDate(x.balancete.data_referencia)} diz que entraram <strong>${formatBRL(pr.recebido)}</strong> desde o início do projeto,
          sem o rendimento${pr.a_receber ? `, e há <strong>${formatBRL(pr.a_receber)}</strong> em nota fiscal emitida e ainda não paga` : ''}.
          ${pr.recebido_alem_do_plano ? `Isso é ${formatBRL(pr.recebido_alem_do_plano)} a mais que a soma das parcelas: confira o cronograma.` : ''}
          ${pr.sem_valores && pr.falta_sem_cronograma != null ? `O plano não fixa o valor das parcelas; pelo total do plano, faltariam receber ${formatBRL(pr.falta_sem_cronograma)}.` : ''}
          A situação de cada parcela sai de somar as parcelas em ordem e comparar com esse total.</p>`
      : x.balancete
        ? '<p class="plan-nota">O balancete deste centro não tem a conta do que entrou: a situação das parcelas não pôde ser conferida.</p>'
        : '<p class="plan-nota">Este centro não tem balancete no sistema: a situação das parcelas não pôde ser conferida.</p>';
    const comoAntes = fi && comoContar.pelo === 'plano'
      ? `<p class="plan-nota">A conta que está valendo na página é a antiga, pelo livre do plano: ${formatBRL(fonteJunta(r, k).valor_hoje)} (${esc(r.fontes[k]?.como || '')}).</p>` : '';
    const corpo = `
      <p><strong>${esc(fi ? fi.nome : `${cc} ${c.nome || ''}`)}</strong>${fi ? '' : ' (não é fonte: paga as próprias bolsas)'}.
        Conta: ${d.modo === 'total' ? 'todas as rubricas (usar fora de Pessoal exige remanejamento)' : 'só a rubrica Pessoal'}. Vale até ${rot(d.ate)}, o fim do centro.</p>
      ${comoAntes}
      <h4>Quanto dá para usar agora</h4>
      <table class="plan-tab plan-passos"><tbody>${passos}</tbody></table>
      <p class="plan-nota">Vale o menor entre o livre do plano e o dinheiro. O livre do plano já desconta o que foi gasto e as bolsas cadastradas. O dinheiro que chega paga primeiro o que o centro já tem de pagar (bolsas cadastradas${d.modo === 'pessoal' ? ' e o que o plano reserva para as outras rubricas' : ''}); o resto fica para as bolsas desta conta.</p>
      <h4>Parcelas do plano</h4>
      ${entrou}
      ${parc}
      <p><strong>Total para as bolsas: ${formatBRL(d.total)}</strong>${d.nao_chega > 0 ? `. Do livre do plano, ${formatBRL(d.nao_chega)} não têm dinheiro previsto para entrar antes do fim do centro, com as opções de agora.` : '.'}</p>
      <div class="plan-docs">
        ${x.balancete?.arquivo_storage_path ? '<button class="btn btn--secondary btn--sm" data-doc="balancete"><i data-lucide="file-text"></i> Ver no balancete</button>' : '<span class="plan-nota">PDF do balancete não guardado.</span>'}
        ${x.plano?.arquivo_storage_path ? '<button class="btn btn--secondary btn--sm" data-doc="plano"><i data-lucide="file-text"></i> Ver o cronograma no plano</button>' : '<span class="plan-nota">Documento do plano não guardado.</span>'}
      </div>`;
    const janela = modal(`O dinheiro do ${cc}`, corpo, '860px').overlay;
    lucide.createIcons({ nodes: [janela] });
    janela.querySelector('[data-doc="balancete"]')?.addEventListener('click', () => abrirBalancete(cc, d));
    janela.querySelector('[data-doc="plano"]')?.addEventListener('click', () => abrirCronograma(cc, d));
  }

  function abrirBalancete(cc, d) {
    const b = base.extras[cc].balancete;
    const partes = [{ rotulo: 'Caixa: saldo disponível', valor: Number(b.saldo_disponivel), alvo: { valor: Number(b.saldo_disponivel), texto: 'saldo disponivel' } }];
    if (b.rendimento_liquido != null) partes.push({ rotulo: 'Rendimento líquido da aplicação', valor: Number(b.rendimento_liquido), alvo: { valor: Number(b.rendimento_liquido), texto: 'rendimento liquido' } });
    (b.recursos?.contas || []).filter(x => x.valor).forEach(x => partes.push({
      rotulo: { recebido: 'Entrou (sem rendimento)', rendimento_bruto: 'Rendimento bruto', doacoes: 'Doações', a_receber: 'Nota fiscal a receber' }[x.tipo] + `: ${x.descricao}`,
      valor: x.valor, alvo: { valor: x.valor, texto: x.descricao },
    }));
    OrigemDocumento.abrir({
      titulo: `Balancete do ${cc} de ${formatDate(b.data_referencia)}`,
      valor: d.hoje,
      documento: { tipo: 'pdf', nome: b.arquivo_nome || 'balancete.pdf', carregar: () => baixar('balancete-pdfs', b.arquivo_storage_path) },
      partes,
      nota: 'O balancete é acumulado desde o início do projeto. "Entrou" é o que o financiador pagou; o rendimento fica à parte.',
    });
  }

  function abrirCronograma(cc, d) {
    const pl = base.extras[cc].plano;
    const partes = [{ rotulo: 'Cronograma de desembolso', valor: null, alvo: { texto: 'Cronograma de desembolso' } }];
    d.parcelas.itens.forEach(i => partes.push({ rotulo: `Parcela ${i.parcela} (${i.quando || 'sem data'})`, valor: i.valor,
      alvo: i.valor != null ? { valor: i.valor } : { texto: i.valor_texto || i.quando } }));
    OrigemDocumento.abrir({
      titulo: `Cronograma de desembolso do ${cc}`,
      valor: d.parcelas.soma_plano,
      documento: { tipo: /\.pdf$/i.test(pl.arquivo_nome || '') ? 'pdf' : 'docx', nome: pl.arquivo_nome || 'plano.docx',
        carregar: () => baixar('plano-trabalho-docs', pl.arquivo_storage_path) },
      partes,
      nota: `Plano ativo: ${pl.arquivo_nome || ''}.`,
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
      .plan { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; max-width: 1320px; }
      .plan > * { min-width: 0; }
      .plan-placar { position: sticky; z-index: 5; height: 0; margin-top: calc(-1 * var(--sp-5)); }
      .plan-placar__barra { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-4); padding: 8px var(--sp-4); font-size: 14px;
        background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md); box-shadow: 0 4px 14px rgba(0,0,0,.08);
        opacity: 0; transform: translateY(-6px); pointer-events: none; transition: opacity .15s, transform .15s; }
      .plan-placar--on .plan-placar__barra { opacity: 1; transform: none; }
      @media (prefers-reduced-motion: reduce) { .plan-placar__barra { transition: none; } }
      .plan-rodape { font-size: 12px; color: var(--text-muted); margin: 0; max-width: 90ch; }

      /* Resumo: a conta inteira numa linha */
      .plan-resumo { display: flex; flex-direction: column; gap: var(--sp-4); }
      .plan-resumo__estado { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-3); font-size: 14px; color: var(--text-secondary); }
      .plan-resumo__estado .btn { margin-left: auto; }
      .plan-estado { font-weight: 600; color: var(--text-primary); padding: 2px 10px; border-radius: var(--radius-full); background: var(--bg-secondary); font-size: 13px; }
      .plan-estado--sim { background: color-mix(in srgb, var(--warning) 22%, transparent); }
      .plan-conta { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr auto 1.15fr; align-items: stretch; gap: var(--sp-3); }
      .plan-conta__item { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-3) var(--sp-4); border-radius: var(--radius-md); background: var(--bg-secondary); min-width: 0; }
      .plan-conta__rot { font-size: 13px; color: var(--text-secondary); }
      .plan-conta__valor { font-family: var(--font-heading); font-size: clamp(18px, 1.9vw, 24px); font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-primary); white-space: nowrap; }
      .plan-conta__sub { font-size: 12px; color: var(--text-muted); }
      .plan-conta__op { align-self: center; font-size: 22px; color: var(--text-muted); font-weight: 300; }
      .plan-conta__item--falta { background: color-mix(in srgb, var(--danger) 12%, var(--bg-surface)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 45%, transparent); }
      .plan-conta__item--falta .plan-conta__valor, .plan-conta__item--falta .plan-conta__rot { color: var(--danger); }
      .plan-conta__item--ok .plan-conta__valor { color: var(--success); }
      .plan-resumo__notas { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); font-size: 14px; color: var(--text-secondary); }
      .plan-resumo__notas li { display: flex; gap: var(--sp-2); align-items: flex-start; }
      .plan-resumo__notas i { width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px; }
      @media (max-width: 1000px) {
        .plan-conta { grid-template-columns: 1fr 1fr; }
        .plan-conta__item { padding: var(--sp-3); }
        .plan-conta__valor { font-size: 17px; }
        .plan-conta__op { display: none; }
        .plan-conta__item--falta, .plan-conta__item--ok { grid-column: 1 / -1; }
      }

      .plan-num { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; border-bottom: 1px dashed var(--text-muted); }
      .plan-num:hover, .plan-num:focus-visible { color: var(--accent); border-bottom-color: var(--accent); }
      .plan-link { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
      .plan-falta { color: var(--danger); font-weight: 600; }
      .plan-ok { color: var(--success); font-weight: 600; }
      .plan-nota { color: var(--text-secondary); font-size: 13px; margin: var(--sp-3) 0 0; }
      .plan-miudo { font-size: 12px; color: var(--text-muted); font-weight: 400; margin-top: 2px; line-height: 1.35; }
      .plan-vence { color: var(--warning); font-weight: 600; }
      .plan-chip { display: inline-block; padding: 1px 8px; border-radius: var(--radius-full); font-size: 11px; background: var(--bg-secondary); color: var(--text-secondary); }
      .plan-chip--entrar { background: color-mix(in srgb, var(--warning) 20%, transparent); color: var(--text-primary); }

      /* Atalhos */
      .plan-atalhos { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-4); }
      .plan-atalhos__rot { font-size: 13px; color: var(--text-secondary); margin-right: var(--sp-1); }
      .plan-atalho { display: inline-flex; gap: var(--sp-2); align-items: baseline; padding: 5px 12px; border: 1px solid var(--border-default); border-radius: var(--radius-full);
        background: var(--bg-surface); color: var(--text-primary); font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
      .plan-atalho:hover { border-color: var(--accent); }
      .plan-atalho span:last-child { font-size: 12px; white-space: nowrap; }
      .plan-atalho--ativo { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--bg-surface)); }

      /* Legenda */
      .plan-legenda { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); font-size: 12px; color: var(--text-secondary); margin-bottom: var(--sp-3); }
      .plan-legenda span { display: inline-flex; align-items: center; gap: 6px; }
      .plan-legenda > span > i:not(.plan-marco), .plan-cor { display: inline-block; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
      .plan-cor { margin-right: 8px; vertical-align: -1px; }
      .plan-amostra { width: 18px !important; height: 10px !important; border-radius: 2px !important; }
      .plan-amostra--pode { background: color-mix(in srgb, var(--text-muted) 28%, transparent); }
      .plan-amostra--usa { background: var(--text-muted); }

      /* A régua comum: rótulo | um mês por coluna | valor */
      .plan-rolagem { overflow-x: auto; max-width: 100%; }
      .plan-grade { border-collapse: collapse; table-layout: fixed; width: 100%; min-width: calc(250px + var(--meses) * 40px + 200px); font-size: 13px; font-variant-numeric: tabular-nums; }
      .plan-col-rot { width: 250px; }
      .plan-col-val { width: 200px; }
      .plan-grade th, .plan-grade td { border-bottom: 1px solid var(--border-subtle); padding: 0; }
      .plan-grade thead th { font-size: 12px; font-weight: 500; color: var(--text-secondary); padding: 6px 0; white-space: nowrap; }
      .plan-grade .plan-m { text-align: center; }
      .plan-grade .plan-m--ano { border-left: 1px solid var(--border-default); }
      .plan-grade .plan-esq { text-align: left; padding: 10px 12px 10px 0; position: sticky; left: 0; background: var(--bg-surface); z-index: 1; font-weight: 400; vertical-align: middle; }
      .plan-grade .plan-dir { text-align: right; padding: 10px 0 10px 12px; vertical-align: middle; }
      .plan-rolar { display: none; font-size: 12px; color: var(--text-muted); margin: 0 0 var(--sp-2); }
      @media (max-width: 900px) {
        .plan-col-rot { width: 150px; }
        .plan-grade { min-width: calc(150px + var(--meses) * 44px + 150px); }
        .plan-col-val { width: 150px; }
        .plan-rolar { display: block; }
      }

      /* Linhas das fontes */
      .plan-fonte-topo { display: flex; align-items: center; gap: var(--sp-2); }
      .plan-fonte { background: none; border: 0; padding: 0; font: inherit; color: var(--text-primary); cursor: pointer; text-align: left; font-weight: 600; font-size: 14px; }
      .plan-fonte:hover, .plan-fonte:focus-visible { color: var(--accent); }
      .plan-fonte-conta { margin-top: 6px; }
      .plan-usar { font-size: 12px; color: var(--text-secondary); display: inline-flex; gap: 6px; align-items: center; }
      .plan-sel { font: inherit; font-size: 12px; padding: 2px 4px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-primary); }
      .plan-sw { position: relative; display: inline-block; width: 30px; height: 18px; flex-shrink: 0; cursor: pointer; }
      .plan-sw input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
      .plan-sw span { position: absolute; inset: 0; border-radius: 9px; background: var(--border-default); transition: background .15s; pointer-events: none; }
      .plan-sw span::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
      .plan-sw input:checked + span { background: var(--accent); }
      .plan-sw input:checked + span::after { transform: translateX(12px); }
      .plan-sw input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
      .plan-desligada .plan-t__faixa, .plan-desligada .plan-cor, .plan-desligada .plan-marco { opacity: .35; }
      .plan-desligada .plan-fonte, .plan-desligada .plan-dir { color: var(--text-muted); }
      .plan-t { position: relative; height: 44px; }
      .plan-t__faixa { position: absolute; left: 1px; right: 1px; top: 50%; height: 14px; transform: translateY(-50%); }
      .plan-t__faixa--pode { background: color-mix(in srgb, var(--cor) 26%, transparent); }
      .plan-t__faixa--usa { background: var(--cor); }
      .plan-marco { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 9px; height: 9px; border-radius: 50%;
        background: var(--bg-surface); border: 2px solid var(--text-primary); z-index: 1; }
      .plan-marco--conferir { border-color: var(--danger); background: var(--danger); }
      .plan-marco--solto { position: static; transform: none; display: inline-block; }
      @media (prefers-reduced-motion: reduce) { .plan-sw span, .plan-sw span::after { transition: none; } }

      .plan-decisoes { margin-top: var(--sp-5); padding-top: var(--sp-4); border-top: 1px solid var(--border-subtle); display: grid; gap: var(--sp-2); }
      .plan-decisoes h4, .plan-regras h4 { margin: 0 0 var(--sp-1); font-size: 13px; font-weight: 600; color: var(--text-secondary); }
      .plan-chk { display: flex; gap: var(--sp-2); align-items: flex-start; font-size: 14px; line-height: 1.45; cursor: pointer; }
      .plan-chk > input { margin-top: 3px; accent-color: var(--accent); }
      .plan-chk .plan-miudo { display: block; }
      .plan-chk--linha { align-items: center; white-space: nowrap; font-size: 13px; color: var(--text-secondary); }
      .plan-chk--linha input { margin-top: 0; }

      .plan-det { margin-top: var(--sp-4); }
      .plan-det > summary { cursor: pointer; font-size: 14px; color: var(--text-secondary); display: flex; align-items: center; gap: var(--sp-2); list-style: none; }
      .plan-det > summary::-webkit-details-marker { display: none; }
      .plan-det > summary::before { content: ''; width: 7px; height: 7px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg); margin: 0 4px 0 2px; transition: transform .15s; }
      .plan-det[open] > summary::before { transform: rotate(45deg); }
      .plan-det > summary i { width: 16px; height: 16px; }
      .plan-det--card { margin-top: 0; }
      .plan-det--card > summary { color: var(--text-primary); font-size: 15px; }
      .plan-det__corpo { margin-top: var(--sp-4); }
      .plan-regras { display: grid; gap: var(--sp-2); margin-top: var(--sp-3); max-width: 80ch; }
      .plan-regras .plan-nota { margin: 0 0 var(--sp-2); }
      .plan-seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--border-default); border-radius: var(--radius-md); overflow: hidden; justify-self: start; }
      .plan-seg button { background: var(--bg-surface); color: var(--text-secondary); border: 0; padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer; }
      .plan-seg button + button { border-left: 1px solid var(--border-default); }
      .plan-seg button[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 14%, var(--bg-surface)); color: var(--text-primary); font-weight: 600; }
      .plan-seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

      /* Gráfico na régua */
      .plan-eixo { vertical-align: top !important; height: 170px; }
      .plan-eixo span { display: block; font-size: 11px; color: var(--text-muted); text-align: right; padding-right: 4px; }
      .plan-eixo span:first-child { margin-top: 14px; }
      .plan-eixo span:last-child { margin-top: 130px; }
      .plan-b { vertical-align: bottom; padding: 8px 0 0 !important; height: 170px; }
      .plan-mes { display: flex; flex-direction: column-reverse; width: 70%; margin: 0 auto; height: 150px; padding: 0; border: 0; background: none; cursor: pointer; border-radius: 3px; overflow: hidden; }
      .plan-mes i { display: block; flex-shrink: 0; }
      .plan-mes:hover, .plan-mes:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .plan-b__falta { text-align: center; font-size: 11px; color: var(--danger); font-weight: 600; padding: 6px 0 !important; white-space: nowrap; }
      .plan-legenda-lado { vertical-align: top !important; }
      .plan-legenda-lado ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; font-size: 12px; text-align: left; }
      .plan-legenda-lado li { display: grid; grid-template-columns: 12px 1fr auto; column-gap: 6px; align-items: center; }
      .plan-legenda-lado li i { width: 10px; height: 10px; border-radius: 2px; }
      .plan-legenda-lado li span:nth-child(2) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .plan-legenda-lado li span:last-child { color: var(--text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }

      /* Pessoas na régua */
      .plan-pessoas-topo { display: flex; justify-content: space-between; gap: var(--sp-4); align-items: flex-start; flex-wrap: wrap; margin-bottom: var(--sp-3); }
      .plan-pessoas-topo .plan-nota { margin: 0; max-width: 70ch; }
      .plan-pessoa { display: flex; justify-content: space-between; gap: var(--sp-2); align-items: baseline; }
      .plan-pessoa strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .plan-pessoa .plan-num { font-size: 12px; white-space: nowrap; }
      .plan-grade tbody tr:has(.plan-pessoa) .plan-esq { padding-top: 6px; padding-bottom: 6px; }
      .plan-c { text-align: center; }
      .plan-c i { display: inline-block; width: 16px; height: 16px; border-radius: 3px; vertical-align: middle; }

      /* Janelas de detalhe */
      .plan-tab { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
      .plan-tab th, .plan-tab td { padding: 8px 10px; border-bottom: 1px solid var(--border-subtle); text-align: right; vertical-align: top; }
      .plan-tab tbody th, .plan-tab thead th:first-child { text-align: left; font-weight: 500; }
      .plan-tab thead th { color: var(--text-secondary); font-weight: 500; font-size: 12px; }
      .plan-lista { margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6; }
      .plan-sit { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
      .plan-sit::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--cor); }
      .plan-passos th { font-weight: 400 !important; }
      .plan-forte th, .plan-forte td { font-weight: 600 !important; }
      .plan-docs { display: flex; gap: var(--sp-2); flex-wrap: wrap; margin-top: var(--sp-3); }
    `;
    document.head.appendChild(s);
  }

  return { load };
})();
