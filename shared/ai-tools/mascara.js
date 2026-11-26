// Máscara de dados pessoais da Análise (contrato §5).
//
// O modelo nunca vê nome de bolsista, CPF nem e-mail. Nome vira ⟦Pn⟧ estável
// na sessão; CPF (com espaço, ponto, hífen ou barra) e e-mail saem de todo
// texto. O mapa ⟦Pn⟧ → nome vive só na memória da sessão e só é usado por
// `reidratar`, que troca marcadores nos blocos que vão à tela.

import { mascararCpf } from './cpf.js';
import { criarErroPacote, ehErroPacote } from './erros.js';
import { codigoDoErro } from './ferramentas/comum.js';

const RE_MARCADOR = /⟦P(\d+)⟧/g;
const RE_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ESPACO_UNICODE = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;

function normalizarNome(valor) {
  return String(valor ?? '')
    .normalize('NFC')
    .replace(/[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu, ' ')
    .trim();
}

/**
 * Texto comparável (NFC, espaços Unicode colapsados, minúsculas e, com
 * `semAcento`, sem acento) com o mapa de cada unidade UTF-16 dele de volta
 * para `fonte` (o texto em NFC). A troca por ⟦Pn⟧ corta `fonte`, nunca o
 * texto recebido: acento decomposto ou emoji antes do nome não desloca o corte.
 */
function normalizarComparavel(valor, { semAcento = true } = {}) {
  const fonte = String(valor ?? '').normalize('NFC');
  let texto = '';
  const mapa = [];
  let deslocamento = 0;
  for (const caractere of Array.from(fonte)) {
    const inicio = deslocamento;
    const fim = deslocamento + caractere.length;
    deslocamento = fim;

    if (ESPACO_UNICODE.test(caractere)) {
      if (texto.endsWith(' ')) {
        const ultimo = mapa[mapa.length - 1];
        if (ultimo) ultimo.fim = fim;
      } else {
        texto += ' ';
        mapa.push({ inicio, fim });
      }
      continue;
    }

    const base = semAcento
      ? caractere.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      : caractere.toLowerCase();
    if (base === '') {
      const ultimo = mapa[mapa.length - 1];
      if (ultimo) ultimo.fim = fim;
      continue;
    }
    texto += base;
    // Uma entrada por unidade UTF-16: \u00e9 nessa unidade que o RegExp devolve
    // `index`. Emoji (2 unidades) com uma entrada s\u00f3 deslocava o corte.
    for (let unidade = 0; unidade < base.length; unidade += 1) mapa.push({ inicio, fim });
  }
  return { texto, mapa, fonte };
}

/** Chave sem acento: s\u00f3 para achar o nome no texto, nunca como identidade. */
function chaveDoNome(valor) {
  return normalizarComparavel(normalizarNome(valor)).texto;
}

/**
 * Chave de identidade (com acento): "Jo\u00e3o Exemplo" e "Joao Exemplo" s\u00e3o duas
 * pessoas e recebem dois \u27e6Pn\u27e7.
 */
function chaveExataDoNome(valor) {
  return normalizarComparavel(normalizarNome(valor), { semAcento: false }).texto;
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
 * Escolhe os trechos a trocar por ⟦Pn⟧ sem deixar pedaço de nome à vista.
 *
 * 1. Entre trechos que se sobrepõem, a combinação sem sobreposição que cobre
 *    MAIS texto (agendamento ponderado de intervalos); no empate, a que usa
 *    mais trechos com acento. "Joao Pedro Silva" ganha de "Pedro Silva"
 *    dentro dele, e "Maria Inês" + "Ana Paula" ganham de "Ines Ana Paula"
 *    que cruza os dois.
 * 2. O que ficou descoberto dentro da cobertura de todos os trechos achados
 *    (sobra de nome que perdeu a disputa) também vira marcador: o do trecho
 *    mais longo que cobre a sobra. A ficha pode repetir; o nome nunca fica
 *    exposto (propriedade travada por teste com dicionários aleatórios).
 */
function escolherTrechos(candidatos, fonte) {
  const PESO_CARACTERE = 1000;
  const ordenados = [...candidatos].sort((a, b) => a.fim - b.fim || a.inicio - b.inicio);
  const melhor = new Array(ordenados.length + 1).fill(0);
  const escolha = new Array(ordenados.length + 1).fill(null);
  for (let i = 1; i <= ordenados.length; i += 1) {
    const atual = ordenados[i - 1];
    let anterior = i - 1;
    while (anterior > 0 && ordenados[anterior - 1].fim > atual.inicio) anterior -= 1;
    const peso = (atual.fim - atual.inicio) * PESO_CARACTERE + (atual.exato ? 1 : 0);
    const com = melhor[anterior] + peso;
    if (com > melhor[i - 1]) {
      melhor[i] = com;
      escolha[i] = { usa: true, anterior };
    } else {
      melhor[i] = melhor[i - 1];
      escolha[i] = { usa: false };
    }
  }
  const escolhidos = [];
  for (let i = ordenados.length; i > 0; ) {
    if (escolha[i].usa) {
      escolhidos.push(ordenados[i - 1]);
      i = escolha[i].anterior;
    } else {
      i -= 1;
    }
  }

  // Sobras: posições cobertas por ALGUM candidato e por NENHUM escolhido,
  // tiradas da cobertura toda de uma vez (não candidato a candidato). As
  // sobras são disjuntas dos escolhidos por construção, então nenhuma é
  // descartada por sobreposição: todo caractere achado como nome termina
  // num marcador, ou é só espaço/pontuação entre dois nomes.
  const RE_SO_SEPARADOR = /^[^\p{L}\p{N}]*$/u;
  const cortes = new Set();
  for (const item of [...candidatos, ...escolhidos]) {
    cortes.add(item.inicio);
    cortes.add(item.fim);
  }
  const pontos = [...cortes].sort((a, b) => a - b);
  const cobre = (lista, inicio, fim) => lista.filter((item) => item.inicio <= inicio && item.fim >= fim);
  const sobras = [];
  for (let indice = 0; indice + 1 < pontos.length; indice += 1) {
    const inicio = pontos[indice];
    const fim = pontos[indice + 1];
    if (cobre(escolhidos, inicio, fim).length > 0) continue;
    const donos = cobre(candidatos, inicio, fim);
    if (donos.length === 0) continue;
    const dono = donos.sort((a, b) => b.fim - b.inicio - (a.fim - a.inicio))[0];
    const anterior = sobras[sobras.length - 1];
    if (anterior && anterior.fim === inicio && anterior.marcador === dono.marcador) {
      anterior.fim = fim;
    } else {
      sobras.push({ inicio, fim, marcador: dono.marcador, sobra: true });
    }
  }
  for (const sobra of sobras) {
    // Só espaço ou pontuação entre dois nomes escolhidos não é pedaço de nome.
    if (RE_SO_SEPARADOR.test(fonte.slice(sobra.inicio, sobra.fim))) continue;
    escolhidos.push(sobra);
  }
  return escolhidos;
}

/**
 * Cria a máscara de uma sessão. `rpc` é o mesmo cliente injetado na sessão;
 * ele só é usado uma vez, para carregar o dicionário de nomes dos bolsistas.
 */
export function criarMascara({ rpc } = {}) {
  const porMarcador = new Map(); // ⟦P1⟧ -> nome real
  const porNome = new Map(); // chave exata (com acento) -> ⟦P1⟧
  const porAlvo = new Map(); // alvo_id (ex.: scholarship) -> ⟦P1⟧
  const nomesParaBusca = []; // { nome, marcador }, maior primeiro na hora de usar
  let proximo = 0;
  let carregado = false;
  let carregando = null;

  function criarMarcador(nome) {
    const marcador = `⟦P${++proximo}⟧`;
    porNome.set(chaveExataDoNome(nome), marcador);
    porMarcador.set(marcador, nome);
    nomesParaBusca.push({ nome, marcador, chave: chaveDoNome(nome), chaveExata: chaveExataDoNome(nome) });
    return marcador;
  }

  function registrarNome(valor) {
    const nome = limparCpfEEmail(normalizarNome(valor));
    if (!nome) return '';
    const chave = chaveExataDoNome(nome);
    if (porNome.has(chave)) return porNome.get(chave);
    return criarMarcador(nome);
  }

  function acrescentarCurto(nomeCompleto, marcador) {
    const partes = normalizarNome(nomeCompleto).split(' ').filter(Boolean);
    if (partes.length <= 2) return;
    const curto = `${partes[0]} ${partes[partes.length - 1]}`;
    const chaveExata = chaveExataDoNome(curto);
    if (chaveExata.length < 3 || porNome.has(chaveExata)) return;
    porNome.set(chaveExata, marcador);
    nomesParaBusca.push({ nome: curto, marcador, chave: chaveDoNome(curto), chaveExata });
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
        const chaveExata = chaveExataDoNome(nome);
        if (!porNome.has(chaveExata)) porNome.set(chaveExata, marcador);
        if (!porMarcador.has(marcador)) porMarcador.set(marcador, nome);
        if (!nomesParaBusca.some((item) => item.nome === nome && item.marcador === marcador)) {
          nomesParaBusca.push({ nome, marcador, chave: chaveDoNome(nome), chaveExata });
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
        if (!resposta) {
          throw criarErroPacote('formato', mensagem);
        }
        if (resposta.error) {
          throw criarErroPacote(codigoDoErro(resposta.error), mensagem);
        }
        if (!resposta.data || !Array.isArray(resposta.data.bolsistas)) {
          throw criarErroPacote('formato', mensagem);
        }
        carregarNomes(resposta.data.bolsistas);
        carregado = true;
      } catch (erro) {
        if (ehErroPacote(erro)) throw erro;
        throw criarErroPacote(codigoDoErro(erro), mensagem);
      } finally {
        carregando = null;
      }
    })();
    return carregando;
  }

  function nome(valor) {
    return registrarNome(valor);
  }

  /** Trechos de `fonte` onde o nome do item aparece, num dos dois modos. */
  function acharTrechos(comparavel, mapa, item, semAcento) {
    const chave = semAcento
      ? item.chave ?? chaveDoNome(item.nome)
      : item.chaveExata ?? chaveExataDoNome(item.nome);
    if (!chave) return [];
    if (!comparavel.includes(chave)) return [];
    const padrao = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${escaparRegex(chave)})(?=$|[^\\p{L}\\p{N}])`,
      'gu'
    );
    const trechos = [];
    // Procura também ocorrências sobrepostas do mesmo nome ("Inês Ines Inês"
    // com "Ines Ines"): depois de cada achado, recomeça uma posição adiante.
    for (let achado = padrao.exec(comparavel); achado; achado = padrao.exec(comparavel)) {
      padrao.lastIndex = achado.index + achado[1].length + 1;
      const inicioComparavel = achado.index + achado[1].length;
      const fimComparavel = inicioComparavel + achado[2].length;
      if (fimComparavel > mapa.length) continue;
      trechos.push({
        inicio: mapa[inicioComparavel].inicio,
        fim: mapa[fimComparavel - 1].fim,
        marcador: item.marcador,
        exato: !semAcento,
      });
    }
    return trechos;
  }

  /** Sanitiza qualquer texto livre: CPF, e-mail e nomes conhecidos. */
  function texto(valor) {
    if (typeof valor !== 'string') return valor;
    const saida = limparCpfEEmail(valor);
    if (nomesParaBusca.length === 0) return saida;
    // Uma passada só, com os dois modos juntos (ver `escolherTrechos`). Duas
    // passadas em sequência deixavam "Joao" exposto em "Joao Pedro Silva"
    // quando "Pedro Silva" casava antes.
    const exato = normalizarComparavel(saida, { semAcento: false });
    const semAcento = normalizarComparavel(saida, { semAcento: true });
    const candidatos = [];
    for (const item of nomesParaBusca) {
      candidatos.push(...acharTrechos(exato.texto, exato.mapa, item, false));
      candidatos.push(...acharTrechos(semAcento.texto, semAcento.mapa, item, true));
    }
    if (candidatos.length === 0) return saida;
    const escolhidos = escolherTrechos(candidatos, exato.fonte);
    escolhidos.sort((a, b) => b.inicio - a.inicio);
    let resultado = exato.fonte;
    for (const trecho of escolhidos) {
      resultado = resultado.slice(0, trecho.inicio) + trecho.marcador + resultado.slice(trecho.fim);
    }
    return resultado;
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
