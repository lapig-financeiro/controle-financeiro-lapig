/* ============================================================
   Análise (F5) — stream de exemplo (`npm run dev:exemplo`)
   ============================================================
   Substitui a Edge Function só no modo exemplo. Usa apenas os centros
   sintéticos de `dadosExemplo.js`, com origens que funcionam no modo
   exemplo: `no` (nó de ARVORES_EXEMPLO), `livre` (explicarLivre),
   `ref` (origem), `termo` (termosContrato), `calculo` que fecha ao
   centavo e `sem_documento`.

   O cenário é escolhido por palavra-chave na pergunta, sem acento e
   sem caixa. `atraso` existe para os testes: zero não espera.
   ============================================================ */

import { ARVORES_EXEMPLO } from './dadosExemplo.js';

const CENTRO_RESTINGA = '00000000-0000-4000-8000-000000030910'; // 30.910
const CENTRO_CERRADO = '00000000-0000-4000-8000-000000030901'; // 30.901

const REGISTRO_EXEMPLO = '00000000-0000-4000-8000-000000000901';
const MENSAGEM_INTERROMPIDA_PADRAO =
  'A análise foi interrompida pelo servidor antes de terminar. O que chegou até aqui está abaixo, incompleto. Tente de novo ou faça uma pergunta mais específica.';

function clonar(valor) {
  if (valor === null || valor === undefined) return valor;
  if (typeof structuredClone === 'function') return structuredClone(valor);
  return JSON.parse(JSON.stringify(valor));
}

function primeiraFolhaComRef(no, alvoTabela = null) {
  if (!no || typeof no !== 'object') return null;
  if (Array.isArray(no.partes) && no.partes.length > 0) {
    for (const parte of no.partes) {
      const achada = primeiraFolhaComRef(parte, alvoTabela);
      if (achada) return achada;
    }
    return null;
  }
  if (!no.ref) return null;
  if (alvoTabela && no.ref.alvo_tabela !== alvoTabela) return null;
  return no;
}

const ARVORE_RESTINGA = ARVORES_EXEMPLO[CENTRO_RESTINGA] || null;
const ARVORE_CERRADO = ARVORES_EXEMPLO[CENTRO_CERRADO] || null;
const FOLHA_COM_REF =
  primeiraFolhaComRef(ARVORE_CERRADO, 'balancete_lancamentos') ||
  primeiraFolhaComRef(ARVORE_CERRADO);

const ORIGEM_NO = ARVORE_RESTINGA
  ? { tipo: 'no', no: clonar(ARVORE_RESTINGA) }
  : { tipo: 'sem_documento', motivo: 'árvore de exemplo indisponível', consulta: 'exemplo' };

const ORIGEM_LIVRE = {
  tipo: 'livre',
  project_id: CENTRO_RESTINGA,
  chave: 'grupo:a',
  caminho: [0],
};

const ORIGEM_REF = FOLHA_COM_REF
  ? { tipo: 'ref', ref: clonar(FOLHA_COM_REF.ref), nome: FOLHA_COM_REF.rotulo }
  : { tipo: 'sem_documento', motivo: 'documento de exemplo indisponível', consulta: 'exemplo' };

const ORIGEM_TERMO = {
  tipo: 'termo',
  project_id: CENTRO_CERRADO,
  termo_id: 'termo-30901-fim',
};

const ORIGEM_SEM_DOCUMENTO = {
  tipo: 'sem_documento',
  motivo: 'valor digitado, ainda sem documento',
  consulta: 'exemplo',
};

function textoComSemOrigem() {
  const texto =
    'A folha de out/26 foi paga depois do balancete e ainda não aparece no realizado; são 3 meses de defasagem.';
  const inicio = texto.indexOf('3 meses');
  return {
    texto,
    semOrigem: inicio >= 0 ? [{ inicio, fim: inicio + '3 meses'.length }] : [],
  };
}

function blocoNumero() {
  return {
    id: 'b-numero',
    tipo: 'numero',
    titulo: 'Livre do 30.910 hoje',
    numero: {
      valor: 52000,
      unidade: 'moeda',
      rotulo: 'Livre — Pessoal (30.910)',
      origem: clonar(ORIGEM_NO),
      contexto: { valor: '2026-10-15', unidade: 'data', origem: null },
    },
  };
}

function blocoTabela() {
  return {
    id: 'b-tabela',
    tipo: 'tabela',
    titulo: 'Centros do exemplo',
    tabela: {
      colunas: [
        { rotulo: 'Centro', unidade: 'texto' },
        { rotulo: 'Livre (R$)', unidade: 'moeda' },
        { rotulo: 'Vigência', unidade: 'data' },
      ],
      linhas: [
        [
          { valor: '30.910', unidade: 'texto', origem: null },
          { valor: 52000, unidade: 'moeda', origem: clonar(ORIGEM_LIVRE) },
          { valor: '2027-09-30', unidade: 'data', origem: clonar(ORIGEM_TERMO) },
        ],
        [
          { valor: '30.901', unidade: 'texto', origem: null },
          { valor: FOLHA_COM_REF?.valor ?? 184250.4, unidade: 'moeda', origem: clonar(ORIGEM_REF) },
          {
            valor: '2026-10-15',
            unidade: 'data',
            origem: { ...ORIGEM_SEM_DOCUMENTO, motivo: 'data informada no modo exemplo' },
          },
        ],
        [
          { valor: '30.909', unidade: 'texto', origem: null },
          { valor: 52000, unidade: 'moeda', origem: clonar(ORIGEM_NO) },
          { valor: null, unidade: 'data', origem: clonar(ORIGEM_SEM_DOCUMENTO) },
        ],
      ],
    },
  };
}

function blocoCalculo() {
  return {
    id: 'b-calculo',
    tipo: 'numero',
    titulo: 'Comprometido do 30.910',
    numero: {
      valor: 30000,
      unidade: 'moeda',
      rotulo: 'Soma das partes',
      origem: {
        tipo: 'calculo',
        op: 'soma',
        partes: [
          {
            id: 'parte-1',
            sinal: 1,
            valor: 20000.1,
            rotulo: 'Parte sintética A',
            origem: { ...ORIGEM_SEM_DOCUMENTO, motivo: 'parte digitada no modo exemplo' },
          },
          {
            id: 'parte-2',
            sinal: 1,
            valor: 9999.9,
            rotulo: 'Parte sintética B',
            origem: { ...ORIGEM_SEM_DOCUMENTO, motivo: 'parte digitada no modo exemplo' },
          },
        ],
      },
      contexto: null,
    },
  };
}

function blocoTexto() {
  return {
    id: 'b-texto',
    tipo: 'texto',
    titulo: 'Sobre a folha atrasada',
    texto: textoComSemOrigem(),
  };
}

function blocoMalformado() {
  return {
    id: 'b-invalido',
    tipo: 'tabela',
    titulo: 'Tabela sem colunas',
    tabela: { colunas: null, linhas: {} },
  };
}

/* ------------------------------------------------------------
   Histórico de conversas do modo exemplo (075)
   ------------------------------------------------------------ */

const CONVERSA_HOJE = '00000000-0000-4000-8000-000000000a01';
const CONVERSA_ONTE = '00000000-0000-4000-8000-000000000a02';
const REGISTRO_HOJE_1 = '00000000-0000-4000-8000-000000000b01';
const REGISTRO_HOJE_2 = '00000000-0000-4000-8000-000000000b02';
const REGISTRO_ONTE = '00000000-0000-4000-8000-000000000b03';

let proximaConversaExemplo = 0;
let proximoRegistroExemplo = 0;

function dataExemplo(diasAtras, hora, minuto) {
  const base = new Date();
  base.setDate(base.getDate() - diasAtras);
  const ano = base.getFullYear();
  const mes = String(base.getMonth() + 1).padStart(2, '0');
  const dia = String(base.getDate()).padStart(2, '0');
  const hh = String(hora).padStart(2, '0');
  const mm = String(minuto).padStart(2, '0');
  return `${ano}-${mes}-${dia}T${hh}:${mm}:00-03:00`;
}

function novoRegistroExemplo() {
  proximoRegistroExemplo += 1;
  return `00000000-0000-4000-8000-${String(700 + proximoRegistroExemplo).padStart(12, '0')}`;
}

function criarConversasExemplo() {
  const hoje = dataExemplo(0, 14, 32);
  const ontem = dataExemplo(1, 9, 15);
  return [
    {
      id: CONVERSA_HOJE,
      titulo: 'Saldo livre do 30.910',
      criada_em: hoje,
      atualizada_em: hoje,
      turnos: [
        {
          registro: REGISTRO_HOJE_1,
          ordem: 1,
          pergunta: 'Quanto o 30.910 tem livre hoje, e de onde vem?',
          resposta: {
            texto: {
              texto:
                'O 30.910 tem R$ 52.000,00 livres para gastar. Livre é o que sobra depois do previsto, do realizado e do comprometido.',
              semOrigem: [],
            },
            blocos: [blocoNumero()],
          },
          desfecho: 'ok',
          desfecho_calculado: 'ok',
          iniciada_em: hoje,
          terminada_em: hoje,
          rodadas: 4,
          ms: 12000,
          feedback: null,
        },
        {
          registro: REGISTRO_HOJE_2,
          ordem: 2,
          pergunta: 'E o comprometido, o que inclui?',
          resposta: {
            texto: {
              texto:
                'O comprometido do 30.910 é R$ 30.000,00: são as bolsas e os desembolsos já prometidos até o fim do plano.',
              semOrigem: [],
            },
            blocos: [blocoCalculo()],
          },
          desfecho: 'ok',
          desfecho_calculado: 'ok',
          iniciada_em: hoje,
          terminada_em: hoje,
          rodadas: 2,
          ms: 6000,
          feedback: null,
        },
      ],
    },
    {
      id: CONVERSA_ONTE,
      titulo: 'Bolsas do 30.901',
      criada_em: ontem,
      atualizada_em: ontem,
      turnos: [
        {
          registro: REGISTRO_ONTE,
          ordem: 1,
          pergunta: 'Quais bolsas do 30.901 terminam nos próximos 60 dias?',
          resposta: {
            texto: {
              texto:
                'Duas bolsas do 30.901 terminam nos próximos 60 dias, segundo a planilha de bolsas do centro.',
              semOrigem: [],
            },
            blocos: [blocoTabela()],
          },
          desfecho: 'ok',
          desfecho_calculado: 'ok',
          iniciada_em: ontem,
          terminada_em: ontem,
          rodadas: 2,
          ms: 8000,
          feedback: null,
        },
      ],
    },
  ];
}

let conversasExemplo = criarConversasExemplo();

function copiarConversa(conversa) {
  return clonar(conversa);
}

function resumoConversa(conversa) {
  return {
    id: conversa.id,
    titulo: conversa.titulo,
    criada_em: conversa.criada_em,
    atualizada_em: conversa.atualizada_em,
    turnos: Array.isArray(conversa.turnos) ? conversa.turnos.length : 0,
  };
}

/** Equivalente de `analise_conversas_listar` no modo exemplo. */
export function listarConversasExemplo({ limite = 30, antes = null } = {}) {
  const teto = !Number.isInteger(limite) || limite < 1 ? 30 : Math.min(limite, 100);
  const limiteEm = antes ? new Date(antes).getTime() : null;
  const lista = conversasExemplo
    .filter((conversa) => {
      if (limiteEm === null || Number.isNaN(limiteEm)) return true;
      return new Date(conversa.atualizada_em).getTime() < limiteEm;
    })
    .sort(
      (a, b) =>
        new Date(b.atualizada_em).getTime() - new Date(a.atualizada_em).getTime(),
    )
    .slice(0, teto)
    .map(resumoConversa);
  return { dados: lista, erro: null };
}

/** Equivalente de `analise_conversa_ler` no modo exemplo. */
export function lerConversaExemplo(id) {
  const conversa = conversasExemplo.find((item) => item.id === id);
  if (!conversa) {
    return { dados: null, erro: 'Esta conversa não está mais disponível.' };
  }
  return {
    dados: {
      ...copiarConversa(conversa),
      turnos: conversa.turnos
        .slice()
        .sort((a, b) => a.ordem - b.ordem)
        .map((turno) => copiarConversa(turno)),
    },
    erro: null,
  };
}

/** Equivalente de `analise_conversa_renomear` no modo exemplo. */
export function renomearConversaExemplo(id, titulo) {
  const conversa = conversasExemplo.find((item) => item.id === id);
  if (!conversa) {
    return { dados: null, erro: 'Esta conversa não está mais disponível.' };
  }
  conversa.titulo = titulo;
  return { dados: null, erro: null };
}

/** Equivalente de `analise_conversa_excluir` no modo exemplo. */
export function excluirConversaExemplo(id) {
  const antes = conversasExemplo.length;
  conversasExemplo = conversasExemplo.filter((item) => item.id !== id);
  if (conversasExemplo.length === antes) {
    return { dados: null, erro: 'Esta conversa não está mais disponível.' };
  }
  return { dados: null, erro: null };
}

function garantirConversaExemplo(conversa, pergunta) {
  if (typeof conversa === 'string' && conversa) {
    const existente = conversasExemplo.find((item) => item.id === conversa);
    if (existente) return existente;
  }

  proximaConversaExemplo += 1;
  const titulo = String(pergunta || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  const agora = new Date().toISOString();
  const nova = {
    id: `00000000-0000-4000-8000-${String(900 + proximaConversaExemplo).padStart(12, '0')}`,
    titulo: titulo || 'Nova conversa',
    criada_em: agora,
    atualizada_em: agora,
    turnos: [],
  };
  conversasExemplo = [nova, ...conversasExemplo];
  return nova;
}

function fecharTurnoExemplo(conversa, dados) {
  if (!conversa || !dados.registro) return;
  const desfecho = dados.desfecho || null;
  const terminadaEm = dados.terminou ? new Date().toISOString() : null;
  const texto = dados.texto && typeof dados.texto === 'object' ? dados.texto : null;
  const blocos = Array.isArray(dados.blocos) ? dados.blocos : [];
  conversa.turnos.push({
    registro: dados.registro,
    ordem: dados.ordem || conversa.turnos.length + 1,
    pergunta: dados.pergunta,
    resposta: texto || blocos.length ? { texto, blocos } : null,
    desfecho,
    desfecho_calculado: terminadaEm ? desfecho : 'cortada',
    iniciada_em: dados.iniciadaEm,
    terminada_em: terminadaEm,
    rodadas: dados.rodadas,
    ms: dados.ms,
    feedback: null,
  });
  conversa.atualizada_em = terminadaEm || dados.iniciadaEm;
}


function eventoPasso(ferramenta, rotulo, estado, erro = undefined) {
  const dados = { ferramenta, rotulo, estado };
  if (erro) dados.erro = erro;
  return { nome: 'passo', dados };
}

export function identificarCenario(pergunta) {
  const texto = String(pergunta || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (texto.includes('limite')) return 'limite';
  if (texto.includes('corte')) return 'corte';
  if (texto.includes('incompleta')) return 'incompleta';
  if (texto.includes('invalido')) return 'invalido';
  if (texto.includes('sem registro')) return 'sem-registro';
  return 'padrao';
}

/**
 * Sequência determinística de eventos do cenário, sem atraso.
 * Serve para o teste conferir o roteiro e para `executarAnaliseExemplo`.
 */
export function criarEventosAnaliseExemplo(pergunta) {
  const cenario = identificarCenario(pergunta);
  const inicio = { nome: 'inicio', dados: { registro: REGISTRO_EXEMPLO } };

  if (cenario === 'limite') {
    return {
      cenario,
      eventos: [
        {
          nome: 'erro',
          dados: {
            codigo: 'limite',
            mensagem: 'Você chegou ao limite de 50 perguntas por dia. Tente de novo amanhã.',
          },
        },
      ],
    };
  }

  if (cenario === 'corte') {
    return {
      cenario,
      eventos: [
        inicio,
        eventoPasso('listar_centros', 'consultando os centros', 'inicio'),
        eventoPasso('listar_centros', 'consultando os centros', 'fim'),
        { nome: 'bloco', dados: blocoNumero() },
        { nome: 'bloco', dados: blocoTexto() },
      ],
    };
  }

  if (cenario === 'incompleta') {
    return {
      cenario,
      eventos: [
        inicio,
        eventoPasso('listar_centros', 'consultando os centros', 'inicio'),
        eventoPasso('listar_centros', 'consultando os centros', 'fim'),
        { nome: 'bloco', dados: blocoNumero() },
        { nome: 'bloco', dados: blocoTabela() },
        {
          nome: 'erro',
          dados: {
            codigo: 'incompleta',
            mensagem:
              'A resposta ficou incompleta: parei em 8 rodadas. Os blocos acima estão certos; para o resto, faça uma pergunta mais específica.',
          },
        },
        { nome: 'fim', dados: { rodadas: 8, ms: 42000 } },
      ],
    };
  }

  if (cenario === 'invalido') {
    return {
      cenario,
      eventos: [
        inicio,
        eventoPasso('criar_bloco', 'montando o bloco', 'inicio'),
        { nome: 'bloco', dados: blocoNumero() },
        { nome: 'bloco', dados: blocoMalformado() },
        { nome: 'bloco', dados: blocoTexto() },
        eventoPasso('criar_bloco', 'montando o bloco', 'fim'),
        {
          nome: 'texto',
          dados: {
            texto: 'Um bloco veio em formato inválido; os outros estão completos.',
            semOrigem: [],
          },
        },
        { nome: 'fim', dados: { rodadas: 2, ms: 6000 } },
      ],
    };
  }

  if (cenario === 'sem-registro') {
    return {
      cenario,
      eventos: [
        { nome: 'inicio', dados: { registro: null } },
        eventoPasso('listar_centros', 'consultando os centros', 'inicio'),
        eventoPasso('listar_centros', 'consultando os centros', 'fim'),
        { nome: 'bloco', dados: blocoNumero() },
        {
          nome: 'texto',
          dados: {
            texto: 'O 30.910 tem R$ 52.000,00 livres; o registro desta análise não foi gravado.',
            semOrigem: [],
          },
        },
        { nome: 'fim', dados: { rodadas: 2, ms: 7000 } },
      ],
    };
  }

  return {
    cenario: 'padrao',
    eventos: [
      inicio,
      eventoPasso('listar_centros', 'consultando os centros', 'inicio'),
      eventoPasso('listar_centros', 'consultando os centros', 'fim'),
      eventoPasso('explicar_livre', 'explicando o saldo livre', 'inicio'),
      eventoPasso(
        'explicar_livre',
        'explicando o saldo livre',
        'erro',
        'a origem demorou a responder'
      ),
      eventoPasso('explicar_livre', 'explicando o saldo livre', 'inicio'),
      eventoPasso('explicar_livre', 'explicando o saldo livre', 'fim'),
      eventoPasso('termos_contrato', 'lendo os termos do contrato', 'inicio'),
      eventoPasso(
        'termos_contrato',
        'lendo os termos do contrato',
        'erro',
        'Não foi possível carregar os termos do contrato. (tempo)'
      ),
      eventoPasso('criar_bloco', 'montando o bloco', 'inicio'),
      { nome: 'bloco', dados: blocoNumero() },
      eventoPasso('criar_bloco', 'montando o bloco', 'fim'),
      { nome: 'bloco', dados: blocoTabela() },
      { nome: 'bloco', dados: blocoCalculo() },
      { nome: 'bloco', dados: blocoTexto() },
      {
        nome: 'texto',
        dados: {
          texto:
            'O 30.910 tem R$ 52.000,00 livres para gastar. A folha de out/26 ainda está fora do balancete, então o compromisso de bolsas já a considera.',
          semOrigem: [],
        },
      },
      { nome: 'fim', dados: { rodadas: 4, ms: 12000 } },
    ],
  };
}

function esperar(ms, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  if (!(ms > 0)) return Promise.resolve(true);

  return new Promise((resolver) => {
    let concluido = false;
    const terminar = (valor) => {
      if (concluido) return;
      concluido = true;
      clearTimeout(temporizador);
      signal?.removeEventListener('abort', aoAbortar);
      resolver(valor);
    };
    const aoAbortar = () => terminar(false);
    const temporizador = setTimeout(() => terminar(true), ms);
    signal?.addEventListener('abort', aoAbortar, { once: true });
  });
}

/**
 * Roda o cenário com os mesmos callbacks e o mesmo formato de retorno de
 * `executarAnalise`. O `signal` é respeitado entre um evento e outro.
 */
export async function executarAnaliseExemplo({
  pergunta,
  conversa = null,
  signal,
  atraso = 300,
  onInicio,
  onPasso,
  onBloco,
  onTexto,
  onFim,
  onErro,
  mensagemInterrompida = MENSAGEM_INTERROMPIDA_PADRAO,
} = {}) {
  const estado = {
    registro: null,
    conversa: null,
    ordem: null,
    blocos: [],
    texto: null,
    erro: null,
    fim: null,
    recebeuFim: false,
  };
  const callbacks = { onInicio, onPasso, onBloco, onTexto, onFim, onErro };
  const parcial = () => ({
    registro: estado.registro,
    conversa: estado.conversa,
    ordem: estado.ordem,
    blocos: estado.blocos,
    texto: estado.texto,
  });

  const { cenario, eventos } = criarEventosAnaliseExemplo(pergunta);
  const inicioEm = new Date().toISOString();
  const registroNovo = novoRegistroExemplo();
  const conversaExemplo =
    cenario === 'limite' || cenario === 'sem-registro'
      ? null
      : garantirConversaExemplo(conversa, pergunta);
  const ordemExemplo = conversaExemplo ? conversaExemplo.turnos.length + 1 : null;

  let turnoFechado = false;
  function fecharTurno(desfecho, terminou) {
    if (turnoFechado || !conversaExemplo || !estado.registro) return;
    turnoFechado = true;
    fecharTurnoExemplo(conversaExemplo, {
      pergunta,
      registro: estado.registro,
      ordem: estado.ordem,
      texto: estado.texto,
      blocos: estado.blocos,
      desfecho,
      terminou,
      iniciadaEm: inicioEm,
      rodadas: estado.fim?.rodadas ?? 0,
      ms: estado.fim?.ms ?? Math.max(0, Date.now() - new Date(inicioEm).getTime()),
    });
  }

  for (const evento of eventos) {
    const seguir = await esperar(atraso, signal);
    if (!seguir || signal?.aborted) {
      fecharTurno('desconectado', false);
      return { ok: false, abortada: true, ...parcial() };
    }

    switch (evento.nome) {
      case 'inicio': {
        const dados = evento.dados?.registro
          ? {
              ...evento.dados,
              registro: registroNovo,
              conversa: conversaExemplo?.id ?? null,
              ordem: ordemExemplo,
            }
          : { registro: null, conversa: null, ordem: null };
        estado.registro = dados.registro ?? null;
        estado.conversa = dados.conversa ?? null;
        estado.ordem = dados.ordem ?? null;
        callbacks.onInicio?.(dados);
        break;
      }
      case 'passo':
        callbacks.onPasso?.(evento.dados);
        break;
      case 'bloco':
        estado.blocos.push(evento.dados);
        callbacks.onBloco?.(evento.dados);
        break;
      case 'texto':
        estado.texto = evento.dados;
        callbacks.onTexto?.(evento.dados);
        break;
      case 'erro':
        estado.erro = evento.dados;
        callbacks.onErro?.(evento.dados);
        break;
      case 'fim':
        estado.recebeuFim = true;
        estado.fim = evento.dados;
        callbacks.onFim?.(evento.dados);
        break;
      default:
        break;
    }
  }

  if (signal?.aborted) {
    fecharTurno('desconectado', false);
    return { ok: false, abortada: true, ...parcial() };
  }

  if (cenario === 'corte') {
    const erro = { codigo: 'interrompida', mensagem: mensagemInterrompida };
    fecharTurno('desconectado', false);
    callbacks.onErro?.(erro);
    return { ok: false, interrompida: true, erro, ...parcial() };
  }

  if (estado.recebeuFim) {
    if (estado.erro) {
      fecharTurno(estado.erro.codigo === 'incompleta' ? 'incompleta' : 'erro', true);
      return { ok: false, erro: estado.erro, ...parcial() };
    }
    fecharTurno('ok', true);
    return { ok: true, erro: null, ...parcial(), fim: estado.fim };
  }

  if (cenario === 'limite') {
    return { ok: false, erro: estado.erro, ...parcial() };
  }

  const erro = { codigo: 'interrompida', mensagem: mensagemInterrompida };
  fecharTurno('desconectado', false);
  callbacks.onErro?.(erro);
  return { ok: false, interrompida: true, erro, ...parcial() };
}
