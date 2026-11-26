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
    blocos: [],
    texto: null,
    erro: null,
    fim: null,
    recebeuFim: false,
  };
  const callbacks = { onInicio, onPasso, onBloco, onTexto, onFim, onErro };
  const parcial = () => ({
    registro: estado.registro,
    blocos: estado.blocos,
    texto: estado.texto,
  });

  const { cenario, eventos } = criarEventosAnaliseExemplo(pergunta);

  for (const evento of eventos) {
    const seguir = await esperar(atraso, signal);
    if (!seguir || signal?.aborted) {
      return { ok: false, abortada: true, ...parcial() };
    }

    switch (evento.nome) {
      case 'inicio':
        estado.registro = evento.dados?.registro ?? null;
        callbacks.onInicio?.(evento.dados);
        break;
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
    return { ok: false, abortada: true, ...parcial() };
  }

  if (cenario === 'corte') {
    const erro = { codigo: 'interrompida', mensagem: mensagemInterrompida };
    callbacks.onErro?.(erro);
    return { ok: false, interrompida: true, erro, ...parcial() };
  }

  if (estado.recebeuFim) {
    if (estado.erro) {
      return { ok: false, erro: estado.erro, ...parcial() };
    }
    return { ok: true, erro: null, ...parcial(), fim: estado.fim };
  }

  if (cenario === 'limite') {
    return { ok: false, erro: estado.erro, ...parcial() };
  }

  const erro = { codigo: 'interrompida', mensagem: mensagemInterrompida };
  callbacks.onErro?.(erro);
  return { ok: false, interrompida: true, erro, ...parcial() };
}
