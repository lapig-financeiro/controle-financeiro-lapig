import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { build } = require('../../tools/vigia/build.js');
const fixtures = require('./fixtures/casos.json');
const fonte = fs.readFileSync(build(), 'utf8');
const copiar = v => JSON.parse(JSON.stringify(v));

// Planilha falsa só com o que o painelRegistrar_ usa: cabeçalho, busca da rotina e append.
function criarPainel() {
  const abas = {};
  function criarAba() {
    const linhas = [];
    return {
      linhas,
      getLastRow: () => linhas.length,
      getRange: (linha, coluna, nLinhas = 1, nColunas = 1) => ({
        getValues: () => Array.from({ length: nLinhas }, (_, i) => Array.from({ length: nColunas }, (_, j) => (linhas[linha - 1 + i] || [])[coluna - 1 + j] ?? '')),
        setValues: valores => valores.forEach((nova, i) => {
          if (!linhas[linha - 1 + i]) linhas[linha - 1 + i] = [];
          const alvo = linhas[linha - 1 + i];
          nova.forEach((valor, j) => { alvo[coluna - 1 + j] = valor; });
        })
      }),
      appendRow: valores => { linhas.push(valores.slice()); }
    };
  }
  const planilha = { getSheetByName: nome => abas[nome] || null, insertSheet: nome => (abas[nome] = criarAba()) };
  const rotinas = () => (abas.Estado ? abas.Estado.linhas.slice(1) : [])
    .map(l => ({ rotina:l[0], estado:l[1], quando:l[2], resumo:l[3], detalhe:l[4], intervalo:l[5], conta:l[6] }));
  return { abas, planilha, id:null, rotinas, historico:() => (abas.Historico ? abas.Historico.linhas.slice(1) : []) };
}

function sandbox(opcoes = {}) {
  const estado = { requisicoes: [], queries: [], logs: [], emails: [], mensagens: {}, eventos: {}, capturas: [], finalizacoes: [], avisos: {}, acks: [], auth:0, locks:0, releases:0, triggers:[], expurgos:0, cache:{} };
  const painel = criarPainel();
  const config = { SUPABASE_URL:'https://banco.exemplo.invalid',SUPABASE_ANON_KEY:'fake-anon-secret',VIGIA_EMAIL:'vigia@exemplo.invalid',VIGIA_SENHA:'fake-password-secret',SITE_URL:'https://site.exemplo.invalid/#buriti',EMAIL_AVISO:'aviso@exemplo.invalid',...opcoes.config };
  let mensagens = opcoes.mensagens || [fixtures.mensagens.envio, fixtures.mensagens.github];
  const ctx = { versao_esquema:1,tarefas:[copiar(fixtures.tarefa)],cursor_em:'2026-10-05T16:00:00.000Z',vinculos:[],pendentes:[],alertas_emitidos:[],esclarecer:0,rotina:0,saude:'ok',...opcoes.contexto };
  function gmailMessage(m) {
    return { getId:()=>m.gmail_message_id, getThread:()=>({getId:()=>m.gmail_thread_id,isInSpam:()=>!!m.spam}), getDate:()=>new Date(m.recebida_em),
      getFrom:()=>m.de || '',getTo:()=>m.para || '',getCc:()=>m.cc || '',getSubject:()=>m.assunto || '',getPlainBody:()=>m.corpo || '',
      getHeader:n=>m.headers?.[n] || '',getAttachments:()=>Array(m.anexos || 0).fill({}),isInTrash:()=>!!m.trash };
  }
  function response(status, body) { return {getResponseCode:()=>status,getContentText:()=>JSON.stringify(body)}; }
  function registrar(p) {
    if (p.execucao && !p.execucao.id) return {execucao_id:'exec-' + (estado.finalizacoes.length + 1)};
    if (p.execucao) {
      estado.finalizacoes.push(p);
      (p.resultados || []).forEach(r => {
        const id = r.registro_mensagem.gmail_message_id;
        if (r.registro_mensagem.estado === 'processada') estado.mensagens[id] = r.registro_mensagem;
        r.eventos.forEach(e => { estado.eventos[e.chave] = e; if (r.precisa_victor) estado.avisos[e.chave] ||= { chave:e.chave,tipo:e.tipo,tarefa_id:e.tarefa_id,estado:'pendente' }; });
      });
      (p.eventos || []).forEach(e => { estado.eventos[e.chave] = e; });
      if (p.resumo_diario) estado.avisos[p.resumo_diario.chave] ||= {...p.resumo_diario,tipo:'resumo_diario',estado:'pendente'};
    }
    (p.avisos_resultados || []).forEach(a => { estado.acks.push(a); if (estado.avisos[a.chave]) estado.avisos[a.chave].estado = a.estado; });
    return { avisos:Object.values(estado.avisos).filter(a=>a.estado !== 'enviado') };
  }
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-06T16:00:00.000Z'])); } static now() { return new Date('2026-10-06T16:00:00.000Z').getTime(); } }
  const global = {
    Date:FixedDate,Intl,console:{log:s=>estado.logs.push(s)},
    PropertiesService:{getScriptProperties:()=>({getProperties:()=>({...config})})},
    LockService:{getScriptLock:()=>({tryLock:()=>{estado.locks++;return !opcoes.ocupado;},releaseLock:()=>estado.releases++})},
    MailApp:{sendEmail:email=>{if(opcoes.mailFalha) throw new Error('mail fake secret');estado.emails.push(email);}},
    SpreadsheetApp:{openById:id=>{if(opcoes.painelFalha) throw new Error('planilha fake secret');painel.id=id;return painel.planilha;}},
    Session:{getEffectiveUser:()=>({getEmail:()=>'vigia@exemplo.invalid'})},
    CacheService:{getScriptCache:()=>({get:k=>estado.cache[k]||null,put:(k,v)=>{estado.cache[k]=v;}})},
    GmailApp:{
      search:(q, start, max)=>{
        estado.queries.push(q);
        if (opcoes.gmailFalha) throw new Error('Gmail sensitive failure');
        const spam = q.startsWith('in:spam');
        const lista = mensagens.filter(m=>!!m.spam === spam).map(m=>({getMessages:()=>[gmailMessage(m)]}));
        return lista.slice(start,start+max);
      },
      getMessageById:id=>{const m=mensagens.find(m=>m.gmail_message_id===id); return m ? gmailMessage(m):null;}
    },
    UrlFetchApp:{fetch:(url,opts)=>{
      estado.requisicoes.push({url,opts});
      if (url.includes('/auth/v1/token')) { estado.auth++;return response(200,{access_token:'fake-jwt',expires_in:3600}); }
      if (url === 'https://ollama.com/api/chat') {
        if (opcoes.modeloFalha) throw new Error('Ollama fake secret');
        return response(200,{message:{content:opcoes.respostaModelo || JSON.stringify({tarefa_id:'t-bolsa',varias:[],demanda_nova:false,classificacao:'exigencia',resumo:'Exigência',trecho_evidencia:'É necessário informar as atividades de cada bolsista.',confianca:'alta'})}});
      }
      if (url.startsWith('https://ntfy.sh/')) return response(opcoes.ntfyFalha ? 503 : 200,{});
      const nome = url.split('/').pop(), p = JSON.parse(opts.payload).p;
      if (opcoes.unauthorized && estado.auth === 1 && nome === 'vigia_contexto') return response(401,{});
      if (nome === 'vigia_contexto') return response(200,{...ctx,pendentes:Object.values(estado.mensagens).filter(m=>m.estado!=='processada').map(m=>m.gmail_message_id)});
      if (nome === 'vigia_capturar') {
        if (opcoes.capturaFalha) return response(500,{message:'fake secret'});
        estado.capturas.push(p);
        let novas = 0;
        p.mensagens.forEach(m=>{if(!estado.mensagens[m.gmail_message_id]) {estado.mensagens[m.gmail_message_id]=m;novas++;}});
        return response(200,{mensagens_novas:novas,processar_ids:p.mensagens.filter(m=>estado.mensagens[m.gmail_message_id].estado!=='processada').map(m=>m.gmail_message_id),cursor_em:p.janela.fim});
      }
      if (nome === 'vigia_registrar') return response(200,registrar(p));
      if (nome === 'vigia_expurgar') {estado.expurgos++;return response(200,{mensagens_expurgadas:0});}
      throw new Error('URL inesperada ' + url);
    }},
    ScriptApp:{getProjectTriggers:()=>estado.triggers.slice(),deleteTrigger:t=>{estado.triggers=estado.triggers.filter(x=>x!==t);},newTrigger:n=>{
      const trigger={nome:n,getHandlerFunction:()=>n}, chain={};
      for(const method of ['timeBased','everyMinutes','atHour','everyDays','inTimezone']) chain[method]=v=>{trigger[method]=v;return chain;};
      chain.create=()=>{estado.triggers.push(trigger);return trigger;};return chain;
    }}
  };
  vm.createContext(global);vm.runInContext(fonte,global);
  return { global,estado,config,painel,setMensagens:v=>{mensagens=v;},opcoes };
}

describe('Vigia.gs com serviços falsos, sem rede', () => {
  it('build determinístico, sem import/require/module; captura precede processamento e registro', () => {
    expect(fs.readFileSync(build(),'utf8')).toBe(fonte);
    expect(fonte).not.toMatch(/\brequire\(|\bmodule\.exports|^import /m);
    expect(fonte).toMatch(/\/\/ apps-script[\\/]painel\.js/);
    expect(fonte).toContain('function painelRegistrar_(');
    expect(fonte).not.toContain('enviarEmail');
    const {global,estado}=sandbox();
    expect(global.checar().estado).toBe('ok');
    expect(estado.mensagens['m-envio'].fila).toBe('tarefa');
    expect(estado.mensagens['m-github'].fila).toBe('rotina');
    expect(estado.capturas[0].mensagens.every(m=>m.estado==='capturada')).toBe(true);
    const urls=estado.requisicoes.map(r=>r.url);
    expect(urls.findIndex(u=>u.endsWith('vigia_capturar'))).toBeLessThan(urls.findLastIndex(u=>u.endsWith('vigia_registrar')));
    expect(estado.releases).toBe(1);expect(estado.expurgos).toBe(1);expect(estado.emails.length).toBeGreaterThan(0);
    expect(estado.requisicoes.some(r=>r.url.includes('ollama'))).toBe(false);
  });
  it('segunda execução não duplica efeitos ou avisos já enviados', () => {
    const {global,estado}=sandbox();global.checar();const eventos=Object.keys(estado.eventos),avisos=estado.emails.length;
    global.checar();expect(Object.keys(estado.eventos)).toEqual(eventos);expect(estado.emails.length).toBe(avisos);
    expect(estado.finalizacoes[1].execucao.mensagens_novas).toBe(0);
  });
  it('inclui arquivadas, enviadas e spam, remove lixeira e mensagens fora da janela', () => {
    const mensagens=[fixtures.mensagens.envio,{...fixtures.mensagens.desconhecida,spam:true},{...fixtures.mensagens.github,trash:true},{...fixtures.mensagens.encaminhada,gmail_message_id:'m-antiga',recebida_em:'2026-09-20T12:00:00Z'}];
    const {global,estado}=sandbox({mensagens});global.checar();
    expect(Object.keys(estado.mensagens).sort()).toEqual(['m-envio','m-tj']);
    expect(estado.queries[0]).toContain('in:anywhere -in:trash -in:spam');expect(estado.queries[1]).toContain('in:spam -in:trash');
    expect(estado.capturas[0].janela.inicio).toBe('2026-10-04T16:00:00.000Z');
  });
  it('pagina além de 100 threads sem descartar mensagens', () => {
    const mensagens=Array.from({length:101},(_,i)=>({...fixtures.mensagens.github,gmail_message_id:'p-'+i}));
    const {global,estado}=sandbox({mensagens});global.checar();expect(Object.keys(estado.mensagens)).toHaveLength(101);expect(estado.queries).toHaveLength(3);
  });
  it('janela incompleta não é capturada e não avança cursor', () => {
    const mensagens=Array.from({length:1000},(_,i)=>({...fixtures.mensagens.github,gmail_message_id:'p-'+i}));
    const {global,estado}=sandbox({mensagens});expect(()=>global.checar()).toThrow('janela_incompleta');expect(estado.capturas).toEqual([]);expect(estado.releases).toBe(1);
  });
  it('falha de captura não chama modelo e registra fim com erro sanitizado', () => {
    const {global,estado}=sandbox({capturaFalha:true,config:{OLLAMA_API_KEY:'fake-ollama-secret'}});
    expect(()=>global.checar()).toThrow('rpc_vigia_capturar_http_500');
    expect(estado.requisicoes.some(r=>r.url.includes('ollama.com'))).toBe(false);
    expect(estado.finalizacoes[0].execucao.erros[0].codigo).toBe('rpc_vigia_capturar_http_500');expect(estado.releases).toBe(1);
  });
  it('falha repetida avisa uma vez só (a cada 6 h), com assunto claro', () => {
    const s=sandbox({capturaFalha:true});
    expect(()=>s.global.checar()).toThrow('rpc_vigia_capturar_http_500');
    expect(()=>s.global.checar()).toThrow('rpc_vigia_capturar_http_500');
    const falhas=s.estado.emails.filter(e=>e.subject==='Vigia LAPIG · falha na checagem');
    expect(falhas).toHaveLength(1);expect(falhas[0].body).not.toContain('fake');
  });
  it('checagem bem-sucedida registra pulsação no painel, sem detalhe', () => {
    const s=sandbox();s.global.checar();
    const final=s.estado.finalizacoes[0];
    const rotina=s.painel.rotinas().find(r=>r.rotina==='Vigia LAPIG · checagem');
    expect(rotina).toMatchObject({estado:'OK',detalhe:'',intervalo:1});
    expect(rotina.resumo).toBe(final.resultados.length+' mensagens, '+final.execucao.alertas+' alertas');
    expect(s.painel.historico().some(l=>l[1]==='Vigia LAPIG · checagem'&&l[2]==='OK')).toBe(true);
  });
  it('falha na checagem registra FALHOU no painel com a chave do erro, sem conteúdo', () => {
    const s=sandbox({capturaFalha:true});
    expect(()=>s.global.checar()).toThrow('rpc_vigia_capturar_http_500');
    const rotina=s.painel.rotinas().find(r=>r.rotina==='Vigia LAPIG · checagem');
    expect(rotina).toMatchObject({estado:'FALHOU',resumo:'rpc_vigia_capturar_http_500',detalhe:'',intervalo:1});
    expect(rotina.resumo).not.toContain('fake');
  });
  it('resumo diário vai ao painel, não ao e-mail, com recibo sem canal', () => {
    const s=sandbox({mensagens:[],config:{NTFY_TOPICO:'topico-sintetico'},contexto:{tarefas:[{status:'em_andamento'},{status:'em_andamento'}],
      resumo_tarefas:[{titulo:'Bolsa 30.068',situacao:'em_andamento',precisa_atencao:true,motivo_atencao:'prazo vence hoje'},{titulo:'Relatório',situacao:'em_andamento'}],
      esclarecer:1,esclarecer_lista:[{gmail_thread_id:'th1',recebida_em:'2026-10-06T12:00:00Z',remetente:'[P1]',assunto:'Ofício novo',motivo:'demanda_nova'}]}});
    s.global.resumoDiario();
    expect(s.estado.requisicoes.some(r=>r.url.startsWith('https://ntfy.sh/'))).toBe(false);
    expect(s.estado.emails).toEqual([]);
    const rotina=s.painel.rotinas().find(r=>r.rotina==='Vigia LAPIG · resumo diário');
    expect(s.painel.id).toBe(s.global.PAINEL_PLANILHA_ID);
    expect(rotina).toMatchObject({estado:'AVISO',intervalo:24});
    expect(rotina.resumo).toBe('Tarefas abertas: 2 · Precisam de você: 1 · Mensagens para esclarecer: 1');
    expect(rotina.detalhe).toContain('"Ofício novo" (assunto novo, sem tarefa)');
    expect(rotina.detalhe).toContain('PRECISA DE VOCÊ');
    const ack=s.estado.acks.find(a=>a.chave==='resumo:2026-10-06');
    expect(ack).toEqual({chave:'resumo:2026-10-06',estado:'enviado'});
    expect('canal' in ack).toBe(false);
  });
  it('resumo sem atenção fica OK no painel', () => {
    const s=sandbox({mensagens:[]});s.global.resumoDiario();
    const rotina=s.painel.rotinas().find(r=>r.rotina==='Vigia LAPIG · resumo diário');
    expect(rotina.estado).toBe('OK');expect(rotina.resumo).toContain('Precisam de você: 0');
  });
  it('painel fora do ar vira falhou/envio_falhou, sem canal, e reenvia na execução seguinte', () => {
    const s=sandbox({mensagens:[],painelFalha:true});s.global.resumoDiario();
    expect(s.estado.emails).toEqual([]);
    expect(s.estado.acks.find(a=>a.chave==='resumo:2026-10-06')).toEqual({chave:'resumo:2026-10-06',estado:'falhou',motivo:'envio_falhou'});
    expect('canal' in s.estado.acks.find(a=>a.chave==='resumo:2026-10-06')).toBe(false);
    expect(s.estado.avisos['resumo:2026-10-06'].estado).toBe('falhou');
    s.opcoes.painelFalha=false;s.global.resumoDiario();
    expect(s.estado.acks.filter(a=>a.chave==='resumo:2026-10-06').at(-1)).toEqual({chave:'resumo:2026-10-06',estado:'enviado'});
    expect(s.painel.rotinas().find(r=>r.rotina==='Vigia LAPIG · resumo diário').estado).toBe('OK');
  });
  it('modelo offline deixa captura para próxima execução e depois processa', () => {
    const s=sandbox({mensagens:[fixtures.mensagens.exigencia],config:{OLLAMA_API_KEY:'fake-ollama-secret'},modeloFalha:true});
    s.global.checar();expect(s.estado.mensagens['m-exigencia'].estado).toBe('capturada');
    s.opcoes.modeloFalha=false;s.global.checar();expect(s.estado.mensagens['m-exigencia'].estado).toBe('processada');
    expect(s.estado.finalizacoes[1].resultados[0].precisa_victor).toBe(true);
    const request=s.estado.requisicoes.find(r=>r.url==='https://ollama.com/api/chat');
    expect(JSON.parse(request.opts.payload)).toMatchObject({format:'json',stream:false,model:'glm-5.3-flash'});
  });
  it('recupera pendência anterior à janela diretamente pelo ID no Gmail', () => {
    const msg={...fixtures.mensagens.exigencia,recebida_em:'2026-10-02T15:00:00Z'};
    const s=sandbox({mensagens:[msg],config:{OLLAMA_API_KEY:'fake-ollama-secret'}});
    s.estado.mensagens[msg.gmail_message_id]={gmail_message_id:msg.gmail_message_id,estado:'capturada'};
    s.global.checar();expect(s.estado.capturas[0].mensagens).toEqual([]);
    expect(s.estado.mensagens[msg.gmail_message_id].estado).toBe('processada');
  });
  it('renova token em 401 e usa exclusivamente RPCs permitidas', () => {
    const {global,estado}=sandbox({unauthorized:true});global.checar();expect(estado.auth).toBe(2);
    expect(estado.requisicoes.filter(r=>r.url.includes('/rest/')).every(r=>r.url.includes('/rpc/vigia_'))).toBe(true);
  });
  it('ntfy com falha usa reserva por MailApp; falha de ambos pode ser reenviada', () => {
    const s=sandbox({ntfyFalha:true,mailFalha:true,config:{NTFY_TOPICO:'topico-sintetico'}});s.global.checar();
    expect(Object.values(s.estado.avisos).every(a=>a.estado==='falhou')).toBe(true);
    s.opcoes.mailFalha=false;s.global.checar();expect(s.estado.emails.length).toBeGreaterThan(0);
    expect(Object.values(s.estado.avisos).every(a=>a.estado==='enviado')).toBe(true);
    const ntfy=s.estado.requisicoes.find(r=>r.url.startsWith('https://ntfy.sh/'));expect(ntfy.opts.headers).toMatchObject({Title:'Vigia LAPIG',Priority:'3'});
  });
  it('lock ocupado impede execução; configuração mostra só status e gatilhos não duplicam', () => {
    const s=sandbox({ocupado:true});expect(s.global.checar().estado).toBe('ocupado');expect(s.estado.requisicoes).toEqual([]);
    s.global.testarConfiguracao();expect(s.estado.logs.join('\n')).not.toContain('fake-');
    s.global.instalarGatilhos();s.global.instalarGatilhos();expect(s.estado.triggers).toHaveLength(2);
    expect(s.estado.triggers.find(t=>t.nome==='resumoDiario').inTimezone).toBe('America/Sao_Paulo');
  });
  it('resumo diário vazio vai ao painel, sem buscar Gmail', () => {
    const s=sandbox({contexto:{tarefas:[]}});s.global.resumoDiario();expect(s.estado.queries).toEqual([]);
    const rotina=s.painel.rotinas().find(r=>r.rotina==='Vigia LAPIG · resumo diário');
    expect(rotina.resumo).toBe('Tarefas abertas: 0 · Precisam de você: 0 · Mensagens para esclarecer: 0');
    expect(rotina.detalhe).toContain('Tarefas abertas: 0');expect(rotina.detalhe).toContain('Mensagens para esclarecer: 0');
    expect(rotina.detalhe).toContain('Vigia · 2026-10-06');
  });
  it('resumo e aviso mascaram nomes conhecidos mesmo sem mensagens capturadas na execução', () => {
    const s=sandbox({mensagens:[]});s.global.resumoDiario();
    expect(s.painel.rotinas().find(r=>r.rotina==='Vigia LAPIG · resumo diário').detalhe).not.toContain('Otávio Exemplo');
    expect(s.global.VigiaResumo.textoAviso({...fixtures.tarefa,tipo:'alerta_prazo',mapa:{}})).not.toContain('Otávio Exemplo');
  });
  it('passada no spam preserva marca; spam sem relação não chama modelo', () => {
    const s=sandbox({mensagens:[fixtures.mensagens.spam],config:{OLLAMA_API_KEY:'fake-ollama-secret'}});
    s.global.checar();expect(s.estado.mensagens['m-spam']).toMatchObject({fila:'rotina',motivo:'spam'});
    expect(s.estado.requisicoes.some(r=>r.url==='https://ollama.com/api/chat')).toBe(false);
    expect(s.global.VigiaGmail.porId('m-spam').spam).toBe(true);
  });
  it('marca spam também quando mensagem já foi vista na outra consulta', () => {
    const s=sandbox({mensagens:[fixtures.mensagens.desconhecida]});
    const thread=s.global.GmailApp.search('in:anywhere',0,100)[0];
    s.global.GmailApp.search=()=>[thread];
    const r=s.global.VigiaGmail.buscar('2026-10-05T16:00:00Z','2026-10-06T16:00:00Z');
    expect(r.mensagens).toHaveLength(1);expect(r.mensagens[0].spam).toBe(true);
  });
  it('spam forte chama modelo e conta atenção; VICTOR_EMAIL evita autoaviso na thread', () => {
    const s=sandbox({mensagens:[fixtures.mensagens.spam_forte,fixtures.mensagens.victor],contexto:{tarefas:fixtures.tarefasDificeis},config:{OLLAMA_API_KEY:'fake-ollama-secret',VICTOR_EMAIL:'victor@exemplo.invalid'}});
    s.global.checar();
    expect(s.estado.mensagens['m-spam-forte'].motivo).toBe('spam_com_vinculo');
    const proprio=s.estado.finalizacoes[0].resultados.find(r=>r.registro_mensagem.gmail_message_id==='m-victor');
    expect(proprio.precisa_victor).toBe(false);expect(proprio.passos_sugeridos).toEqual([]);
  });
});
