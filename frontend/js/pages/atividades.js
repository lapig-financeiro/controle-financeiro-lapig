// Atividades: a tela responde "o que eu faço agora?" antes de "o que existe".
// Minha vez (abre nela) mostra o que depende do login; Equipe agrupa tudo por pessoa, para consulta.
// Uma linha por tarefa; passos, histórico e ações só no cartão completo da 054–057, ao clicar.
window.AtividadesPage = (() => {
  const f = () => window.BuritiTarefas;
  const ui = () => window.BuritiTarefasUI;
  const ABERTAS = ['em_andamento', 'aguardando_terceiro'];
  let root = null, lista = [], centros = [], pessoas = [], abertos = new Set(), geracao = 0;
  let vista = 'minha', encerradas = false;

  const guardado = (chave, padrao) => { try { return localStorage.getItem('atividades:' + chave) || padrao; } catch { return padrao; } };
  const guardar = (chave, valor) => { try { localStorage.setItem('atividades:' + chave, valor); } catch { /* sem armazenamento */ } };
  const eu = () => Auth.getUser()?.id;

  // "arthurpietro.lapig" (login sem nome no sistema) vira "Arthurpietro"; nome de pessoa fica inteiro.
  function primeiroNome(nome) {
    const p = String(nome || '').trim().split(/[\s.]+/)[0] || '';
    return p ? p[0].toUpperCase() + p.slice(1) : '';
  }

  function nomePessoa(nome) {
    const n = String(nome || '').trim();
    return /\s/.test(n) ? n : primeiroNome(n);
  }

  function dataCurta(iso) {
    return iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
  }

  // "se não for você, quem está com ela" — quem está com você some, porque a linha já é sua.
  function quemHTML(t) {
    if (!t.responsavel_id) return '<span class="ativ__quem ativ__quem--sem">sem responsável</span>';
    if (t.responsavel_id === eu()) return '';
    return `<span class="ativ__quem">${escapeAttr(primeiroNome(t.responsavel))}</span>`;
  }

  function linhaHTML(t, { compacta = false, mostrarQuem = false, admin = Auth.isAdmin() } = {}) {
    const encerrada = !ABERTAS.includes(t.status);
    const aberto = abertos.has(t.id);
    const prazo = f().prazoAtividade(t.prazo);
    const centro = t.projects?.code || t.centro_custo || '';
    const sinal = encerrada ? null : f().sinalAtividade(t, { admin });
    const faixa = encerrada ? 'encerrada' : f().faixaAtividade(t);
    const marca = encerrada ? 'feito' : faixa === 'esperando' ? 'esperando'
      : prazo.nivel === 'atrasado' || prazo.nivel === 'hoje' ? 'hoje' : 'normal';
    return `<li class="ativ__item${compacta ? ' ativ__item--compacta' : ''}" data-id="${escapeAttr(t.id)}">
      <button type="button" class="ativ__linha" aria-expanded="${aberto}" data-abrir>
        <span class="ativ__marca ativ__marca--${marca}" aria-hidden="true"></span>
        <span class="ativ__corpo">
          <span class="ativ__titulo">${escapeAttr(t.titulo)}</span>
          <span class="ativ__meta">
            ${centro ? `<span class="ativ__centro">${escapeAttr(centro)}</span>` : ''}
            ${encerrada
    ? `<span class="ativ__data">${t.status === 'cancelada' ? 'Cancelada' : 'Concluída'} em ${escapeAttr(dataCurta(t.concluida_em || t.atualizada_em))}</span>`
    : prazo.texto ? `<span class="ativ__prazo ativ__prazo--${prazo.nivel}">${escapeAttr(prazo.texto)}</span>` : ''}
            ${!encerrada && mostrarQuem ? quemHTML(t) : ''}
            ${sinal ? `<span class="ativ__sinal ativ__sinal--${sinal.chave}">${escapeAttr(sinal.texto)}</span>` : ''}
          </span>
        </span>
        <span class="ativ__seta" aria-hidden="true"></span>
      </button>
      <div class="ativ__detalhe" ${aberto ? '' : 'hidden'}>${aberto ? ui().cartao(t, { semTopo: true }) : ''}</div>
    </li>`;
  }

  function faixaHTML(faixa, { compacta = false, mostrarQuem = false, admin = Auth.isAdmin() } = {}) {
    return `<section class="ativ__faixa ativ__faixa--${faixa.chave}">
      <h3 class="ativ__cabeca">${escapeAttr(faixa.titulo)}</h3>
      <ul class="ativ__lista">${faixa.tarefas.map(t => linhaHTML(t, { compacta, mostrarQuem, admin })).join('')}</ul>
    </section>`;
  }

  function vazioHTML(minha) {
    const dica = minha ? 'O que está com outras pessoas fica em Equipe.'
      : Auth.isAdmin() ? 'Anote a primeira acima, numa linha só.' : '';
    return `<div class="ativ__vazio"><i data-lucide="sprout"></i><p>${minha ? 'Nada com você agora.' : 'Nenhuma atividade em aberto.'}</p>
      ${dica ? `<p class="ativ__vazio-dica">${dica}</p>` : ''}</div>`;
  }

  function gruposHTML(itens) {
    const admin = Auth.isAdmin();
    if (encerradas) {
      if (!itens.length) return '<p class="ativ__vazio">Nenhuma atividade encerrada nos últimos 60 dias.</p>';
      return `<section class="ativ__faixa ativ__faixa--encerradas"><h3 class="ativ__cabeca">Encerradas</h3>
        <ul class="ativ__lista">${itens.map(t => linhaHTML(t, { mostrarQuem: true, admin })).join('')}</ul></section>`;
    }
    if (vista === 'equipe') {
      const porPessoa = f().agruparPorPessoa(itens, { admin, eu: eu() });
      if (!porPessoa.length) return vazioHTML(false);
      return porPessoa.map(p => `<section class="ativ__pessoa" data-pessoa="${escapeAttr(p.id || '')}">
        <h2 class="ativ__pessoa-nome">${escapeAttr(p.sem ? p.nome : nomePessoa(p.nome))}${p.eu ? ' <span class="ativ__pessoa-eu">você</span>' : ''}</h2>
        ${p.blocos.map(b => faixaHTML(b, { compacta: true, admin })).join('')}
      </section>`).join('');
    }
    const minhas = itens.filter(t => f().minhaVez(t, { admin, eu: eu() }));
    if (!minhas.length) return vazioHTML(true);
    return f().agruparAtividades(minhas, { admin }).map(b => faixaHTML(b, { mostrarQuem: true, admin })).join('');
  }

  function desenhar() {
    if (!root?.isConnected) return;
    root.querySelectorAll('[data-vista]').forEach(b =>
      b.setAttribute('aria-pressed', String(!encerradas && b.dataset.vista === vista)));
    const voltar = root.querySelector('[data-voltar]');
    if (voltar) voltar.hidden = !encerradas;
    const rodape = root.querySelector('[data-rodape]');
    if (rodape) rodape.hidden = encerradas;
    root.querySelector('[data-lista]').innerHTML = gruposHTML(lista);
    lucide.createIcons();
  }

  async function carregar() {
    const vez = ++geracao;
    const alvo = root.querySelector('[data-lista]');
    alvo.innerHTML = '<div class="skeleton skeleton--card" style="height:160px;"></div>';
    try {
      const rows = await ui().lerTudo(() => {
        const q = ui().consultaTarefa().order('prazo', { ascending: true, nullsFirst: false }).order('id');
        if (!encerradas) return q.in('status', ABERTAS);
        return q.eq('status', 'concluida').gte('concluida_em', new Date(Date.now() - 60 * 86400000).toISOString());
      });
      await ui().preencherCentros(rows);
      if (vez !== geracao || !root.isConnected) return;
      lista = encerradas ? rows.sort((a, b) => String(b.concluida_em).localeCompare(String(a.concluida_em))) : rows;
      desenhar();
    } catch (e) {
      if (vez !== geracao || !root.isConnected) return;
      alvo.innerHTML = ui().aviso('Não foi possível consultar as atividades.', e);
      lucide.createIcons();
    }
  }

  // Depois de uma ação no cartão: relê só aquela tarefa e redesenha (ela pode ter mudado de faixa, de
  // responsável ou saído da vista).
  async function depois(id) {
    const t = await ui().ler(ui().consultaTarefa().eq('id', id).single());
    await ui().preencherCentros([t]);
    const i = lista.findIndex(x => x.id === id);
    if (i >= 0) lista[i] = t; else lista.push(t);
    if (!encerradas && !ABERTAS.includes(t.status)) { lista = lista.filter(x => x.id !== id); abertos.delete(id); }
    desenhar();
    await ui().atualizarMenu();
  }

  // ---------- Anotar ----------
  async function carregarApoio() {
    if (!Auth.isAdmin()) return;
    const [c, p] = await Promise.all([
      ui().lerTudo(() => supabaseClient.from('projects').select('id,code,name').not('code', 'is', null).order('code').order('id')),
      ui().lerTudo(() => supabaseClient.from('app_users').select('user_id,display_name,role').in('role', ['admin', 'professor'])
        .order('display_name').order('user_id')),
    ]);
    // Login sem nome no sistema (o do Victor, em 09/10) continua valendo para "fica com você"; os outros sem
    // nome ficam fora do @, que procura pelo nome.
    centros = c; pessoas = p.filter(x => x.display_name || x.user_id === eu());
  }

  function previa() {
    const campo = root.querySelector('[data-anotar-texto]');
    const saida = root.querySelector('[data-anotar-previa]');
    if (!campo || !saida) return null;
    saida.classList.remove('ativ__previa--erro');
    if (!campo.value.trim()) { saida.hidden = true; saida.textContent = ''; return null; }
    try {
      const r = f().lerCaptura(campo.value, { centros, pessoas, eu: eu() });
      const prazo = r.prazo ? 'até ' + r.prazo.split('-').reverse().slice(0, 2).join('/') : 'sem prazo';
      const quem = !r.responsavel ? 'sem responsável' : r.responsavel.user_id === eu() ? 'com você' : 'com ' + r.responsavel.display_name;
      saida.hidden = false;
      saida.textContent = `${r.centro.code} · ${r.titulo} · ${prazo} · ${quem}`;
      return r;
    } catch (e) {
      saida.hidden = false;
      saida.textContent = e.message;
      saida.classList.add('ativ__previa--erro');
      return null;
    }
  }

  async function anotar(ev) {
    ev.preventDefault();
    const campo = root.querySelector('[data-anotar-texto]');
    const botao = root.querySelector('[data-anotar-botao]');
    if (!campo.value.trim()) { previa(); campo.focus(); return; }
    const r = previa();
    if (!r) { campo.focus(); return; }
    botao.disabled = true;
    try {
      const nome = r.responsavel?.display_name || null;
      const p = { project_id: r.centro.id, titulo: r.titulo, passos: [{ descricao: r.titulo, ...(nome ? { quem: nome } : {}) }] };
      if (r.prazo) p.prazo = r.prazo;
      const id = await ui().ler(supabaseClient.rpc('criar_tarefa_na_tela', { p, p_responsavel: r.responsavel?.user_id || null }));
      campo.value = '';
      previa();
      showToast('Anotada.', 'success');
      if (encerradas) { encerradas = false; await carregar(); } else await depois(id);
    } catch (e) {
      const saida = root.querySelector('[data-anotar-previa]');
      saida.hidden = false;
      saida.textContent = 'Não foi possível anotar: ' + e.message;
      saida.classList.add('ativ__previa--erro');
    } finally {
      botao.disabled = false;
    }
  }

  async function aoClicar(e) {
    if (e.target.closest('.ativ__detalhe')) {
      // Não use closest('[data-id]'): os botões do cartão também têm data-id (o do passo).
      await ui().acao(e, 'todas', depois);
      return;
    }
    const v = e.target.closest('[data-vista]');
    if (v) {
      if (vista === v.dataset.vista && !encerradas) return;
      vista = v.dataset.vista; guardar('vista', vista);
      abertos.clear();
      if (encerradas) { encerradas = false; await carregar(); } else desenhar();
      return;
    }
    if (e.target.closest('[data-encerradas]')) { encerradas = true; abertos.clear(); await carregar(); return; }
    if (e.target.closest('[data-voltar]')) { encerradas = false; abertos.clear(); await carregar(); return; }
    const linha = e.target.closest('[data-abrir]');
    if (linha) {
      const item = linha.closest('.ativ__item'), id = item.dataset.id;
      const detalhe = item.querySelector('.ativ__detalhe');
      if (abertos.has(id)) { abertos.delete(id); detalhe.hidden = true; detalhe.innerHTML = ''; }
      else {
        abertos.add(id);
        detalhe.innerHTML = ui().cartao(lista.find(t => t.id === id), { semTopo: true });
        detalhe.hidden = false;
        lucide.createIcons();
      }
      linha.setAttribute('aria-expanded', String(abertos.has(id)));
    }
  }

  async function render(container) {
    ui().sair();
    abertos = new Set();
    encerradas = false;
    vista = guardado('vista', 'minha');
    if (!['minha', 'equipe'].includes(vista)) vista = 'minha';
    const admin = Auth.isAdmin();
    container.innerHTML = `<div class="ativ">
      ${admin ? `<form class="ativ__anotar" data-anotar autocomplete="off">
        <label class="sr-only" for="ativ-anotar">Anotar atividade</label>
        <i data-lucide="plus" aria-hidden="true"></i>
        <input id="ativ-anotar" class="ativ__campo" data-anotar-texto maxlength="400"
          placeholder="30.068 remanejar rubricas até 20/10 @Arthur">
        <button type="submit" class="btn btn--primary btn--sm" data-anotar-botao>Anotar</button>
      </form>
      <p class="ativ__previa" data-anotar-previa aria-live="polite" hidden></p>` : ''}
      <div class="ativ__barra">
        <div class="ativ__vistas" role="group" aria-label="Vista">
          <button type="button" class="ativ__chip" data-vista="minha">Minha vez</button>
          <button type="button" class="ativ__chip" data-vista="equipe">Equipe</button>
        </div>
        <button type="button" class="ativ__discreto" data-voltar hidden>← Voltar para as abertas</button>
      </div>
      <div data-lista></div>
      <div class="ativ__rodape" data-rodape>
        <button type="button" class="ativ__discreto" data-encerradas>Encerradas nos últimos 60 dias</button>
      </div>
    </div>`;
    root = container.querySelector('.ativ');
    root.addEventListener('click', aoClicar);
    if (admin) {
      root.querySelector('[data-anotar]').addEventListener('submit', anotar);
      root.querySelector('[data-anotar-texto]').addEventListener('input', previa);
    }
    lucide.createIcons();
    const apoio = carregarApoio().catch(e => {
      const saida = root.querySelector('[data-anotar-previa]');
      if (saida) {
        saida.hidden = false;
        saida.textContent = 'Não foi possível carregar centros e pessoas para anotar: ' + e.message;
        saida.classList.add('ativ__previa--erro');
      }
    });
    await Promise.all([carregar(), apoio]);
    await ui().atualizarMenu();
  }

  return { render };
})();

Router.register('atividades', {
  title: 'Atividades',
  render: container => window.AtividadesPage.render(container),
});
