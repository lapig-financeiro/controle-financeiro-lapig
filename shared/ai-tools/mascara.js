// Máscara de dados pessoais da Análise (contrato §5).
//
// O modelo nunca vê nome de bolsista, CPF nem e-mail. Nome vira ⟦Pn⟧ estável
// na sessão; CPF (com espaço, ponto, hífen ou barra) e e-mail saem de todo
// texto. O mapa ⟦Pn⟧ → nome vive só na memória da sessão e só é usado por
// `reidratar`, que troca marcadores nos blocos que vão à tela.

import { mascararCpf } from './cpf.js';
import { criarErroPacote, ehErroPacote } from './erros.js';

const RE_MARCADOR = /⟦P(\d+)⟧/g;
const RE_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BORDA = '0-9A-Za-zÀ-ÖØ-öø-ÿ';

function normalizarNome(valor) {
  return String(valor ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

function chaveDoNome(valor) {
  return normalizarNome(valor).toLocaleLowerCase('pt-BR');
}

function escaparRegex(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function limparCpfEEmail(valor) {
  if (typeof valor !== 'string') return valor;
  let saida = mascararCpf(valor).replace(RE_EMAIL, '');
  // Sobrou espaço duplo ou espaço antes de pontuação onde o e-mail saiu.
  saida = saida
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/\(\s*\)/g, '');
  return saida;
}

/**
 * Cria a máscara de uma sessão. `rpc` é o mesmo cliente injetado na sessão;
 * ele só é usado uma vez, para carregar o dicionário de nomes dos bolsistas.
 */
export function criarMascara({ rpc } = {}) {
  const porMarcador = new Map(); // ⟦P1⟧ -> nome real
  const porNome = new Map(); // chave normalizada -> ⟦P1⟧
  const porAlvo = new Map(); // alvo_id (ex.: scholarship) -> ⟦P1⟧
  const nomesParaBusca = []; // { nome, marcador }, maior primeiro na hora de usar
  let proximo = 0;
  let carregado = false;
  let carregando = null;

  function criarMarcador(nome) {
    const marcador = `⟦P${++proximo}⟧`;
    porNome.set(chaveDoNome(nome), marcador);
    porMarcador.set(marcador, nome);
    nomesParaBusca.push({ nome, marcador });
    return marcador;
  }

  function registrarNome(valor) {
    const nome = limparCpfEEmail(normalizarNome(valor));
    if (!nome) return '';
    const chave = chaveDoNome(nome);
    if (porNome.has(chave)) return porNome.get(chave);
    return criarMarcador(nome);
  }

  function acrescentarCurto(nomeCompleto, marcador) {
    const partes = normalizarNome(nomeCompleto).split(' ').filter(Boolean);
    if (partes.length <= 2) return;
    const curto = `${partes[0]} ${partes[partes.length - 1]}`;
    const chave = chaveDoNome(curto);
    if (chave.length < 3 || porNome.has(chave)) return;
    porNome.set(chave, marcador);
    nomesParaBusca.push({ nome: curto, marcador });
  }

  /**
   * Marcador estável por `alvo_id`, sem depender do dicionário. É o que a
   * árvore do livre usa nas folhas de bolsa: o nome vem do próprio rótulo.
   */
  function nomeComAlvo(valor, alvoId) {
    const nome = limparCpfEEmail(normalizarNome(valor));
    const alvo = alvoId === undefined || alvoId === null ? null : String(alvoId);

    if (alvo && porAlvo.has(alvo)) {
      const marcador = porAlvo.get(alvo);
      if (nome) {
        const chave = chaveDoNome(nome);
        if (!porNome.has(chave)) porNome.set(chave, marcador);
        if (!porMarcador.has(marcador)) porMarcador.set(marcador, nome);
        if (!nomesParaBusca.some((item) => item.nome === nome && item.marcador === marcador)) {
          nomesParaBusca.push({ nome, marcador });
        }
      }
      return marcador;
    }

    if (!nome) {
      const marcador = `⟦P${++proximo}⟧`;
      if (alvo) porAlvo.set(alvo, marcador);
      return marcador;
    }

    const marcador = registrarNome(nome);
    if (alvo) porAlvo.set(alvo, marcador);
    return marcador;
  }

  /**
   * Rótulo de folha de bolsa da árvore: o sufixo é reconhecido pelo fim
   * ("— N meses × R$ X"); tudo o que vem antes vira ⟦Pn⟧. Se o sufixo não
   * casar, o modelo vê só o marcador, nunca o texto original.
   */
  function rotuloDeBolsa(rotulo, alvoId) {
    const texto = String(rotulo ?? '');
    const achado = texto.match(/(.*?)(\s*—\s*\d+\s+m[eê]s(?:es)?\s+×\s+R\$\s*[\d.,]+)\s*$/u);
    if (!achado) return nomeComAlvo(texto, alvoId);
    const nome = achado[1].trim();
    return `${nomeComAlvo(nome, alvoId)}${achado[2]}`;
  }

  /** Carrega nomes de uma resposta de get_pedido_bolsas_v2. */
  function carregarNomes(bolsistas) {
    if (!Array.isArray(bolsistas)) return;
    for (const bolsista of bolsistas) {
      if (!bolsista || typeof bolsista.nome !== 'string') continue;
      const nome = normalizarNome(bolsista.nome);
      const marcador = registrarNome(nome);
      if (marcador) acrescentarCurto(nome, marcador);
    }
  }

  /** A ferramenta `bolsas` já trouxe o dicionário: não chama a RPC de novo. */
  function marcarDicionarioCarregado() {
    carregado = true;
  }

  /**
   * Carrega o dicionário uma vez por sessão. Qualquer erro ou rejeição do
   * adaptador vira a mensagem fixa do pacote; o texto bruto não sai daqui.
   */
  async function garantirDicionario() {
    if (carregado) return;
    if (carregando) return carregando;
    carregando = (async () => {
      const mensagem = 'Não foi possível carregar a lista de pessoas para proteger os nomes.';
      try {
        const resposta = await rpc('get_pedido_bolsas_v2');
        if (!resposta || resposta.error) {
          throw criarErroPacote('http_4xx', mensagem);
        }
        if (!resposta.data || !Array.isArray(resposta.data.bolsistas)) {
          throw criarErroPacote('formato', mensagem);
        }
        carregarNomes(resposta.data.bolsistas);
        carregado = true;
      } catch (erro) {
        if (ehErroPacote(erro)) throw erro;
        throw criarErroPacote('http_4xx', mensagem);
      } finally {
        carregando = null;
      }
    })();
    return carregando;
  }

  function nome(valor) {
    return registrarNome(valor);
  }

  function substituirNome(texto, item) {
    const padrao = new RegExp(
      `(^|[^${BORDA}])(${escaparRegex(item.nome)})(?=$|[^${BORDA}])`,
      'giu'
    );
    return texto.replace(padrao, (_, antes) => `${antes}${item.marcador}`);
  }

  /** Sanitiza qualquer texto livre: CPF, e-mail e nomes conhecidos. */
  function texto(valor) {
    if (typeof valor !== 'string') return valor;
    let saida = limparCpfEEmail(valor);
    if (nomesParaBusca.length > 0) {
      const ordenados = [...nomesParaBusca].sort((a, b) => b.nome.length - a.nome.length);
      for (const item of ordenados) {
        saida = substituirNome(saida, item);
      }
    }
    return saida;
  }

  /** Troca ⟦Pn⟧ pelo nome real. Só para o bloco que vai à tela. */
  function reidratar(valor) {
    if (typeof valor === 'string') {
      return valor.replace(RE_MARCADOR, (marcador, numero) => {
        return porMarcador.get(`⟦P${numero}⟧`) ?? marcador;
      });
    }
    if (Array.isArray(valor)) return valor.map((item) => reidratar(item));
    if (valor && typeof valor === 'object') {
      const saida = {};
      for (const [chave, item] of Object.entries(valor)) saida[chave] = reidratar(item);
      return saida;
    }
    return valor;
  }

  /**
   * Reidrata o texto e desloca os intervalos `semOrigem` pelo tamanho de cada
   * nome que entrou. Sem isso, o realce depois da troca aponta para o lugar
   * errado.
   */
  function reidratarTextoComIntervalos(texto, intervalos) {
    if (typeof texto !== 'string') return { texto, semOrigem: intervalos ?? [] };
    const mapa = [];
    let saida = '';
    let ultimo = 0;
    for (const achado of texto.matchAll(RE_MARCADOR)) {
      const marcador = achado[0];
      const nome = porMarcador.get(marcador) ?? marcador;
      saida += texto.slice(ultimo, achado.index) + nome;
      mapa.push({
        inicio: achado.index,
        fim: achado.index + marcador.length,
        delta: nome.length - marcador.length,
      });
      ultimo = achado.index + marcador.length;
    }
    saida += texto.slice(ultimo);

    const deslocar = (posicao) =>
      mapa.reduce((deslocamento, troca) => {
        return troca.fim <= posicao ? deslocamento + troca.delta : deslocamento;
      }, 0);

    const semOrigem = (Array.isArray(intervalos) ? intervalos : []).map((intervalo) => ({
      inicio: intervalo.inicio + deslocar(intervalo.inicio),
      fim: intervalo.fim + deslocar(intervalo.fim),
    }));
    return { texto: saida, semOrigem };
  }

  return {
    nome,
    nomeComAlvo,
    rotuloDeBolsa,
    texto,
    carregarNomes,
    marcarDicionarioCarregado,
    garantirDicionario,
    reidratar,
    reidratarTextoComIntervalos,
    // exposto para introspecção e testes; não vai ao modelo
    marcadores: porMarcador,
  };
}
