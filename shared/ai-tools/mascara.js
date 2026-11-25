// Máscara de dados pessoais da Análise (contrato §5).
//
// O modelo nunca vê nome de bolsista, CPF nem e-mail. Nome vira ⟦Pn⟧ estável
// na sessão; CPF (com ou sem pontuação) e e-mail saem de todo texto. O mapa
// ⟦Pn⟧ → nome vive só na memória da sessão e só é usado por `reidratar`, que
// troca marcadores nos blocos que vão à tela.

const RE_MARCADOR = /⟦P(\d+)⟧/g;
const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
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
  let saida = valor.replace(RE_CPF, '').replace(RE_EMAIL, '');
  // Sobrou espaço duplo ou espaço antes de pontuação onde o dado saiu.
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
  const nomesParaBusca = []; // { nome, marcador }, maior primeiro na hora de usar
  let proximo = 0;
  let carregado = false;
  let carregando = null;

  function registrarNome(valor) {
    const nome = limparCpfEEmail(normalizarNome(valor));
    if (!nome) return '';
    const chave = chaveDoNome(nome);
    if (porNome.has(chave)) return porNome.get(chave);
    const marcador = `⟦P${++proximo}⟧`;
    porNome.set(chave, marcador);
    porMarcador.set(marcador, nome);
    nomesParaBusca.push({ nome, marcador });
    return marcador;
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
   * Carrega o dicionário uma vez por sessão. Se a RPC falhar, a ferramenta de
   * texto livre falha fechada: sem a lista de nomes não há como garantir que
   * nenhum nome de bolsista vai ao modelo. CPF e e-mail continuam saindo.
   */
  async function garantirDicionario() {
    if (carregado) return;
    if (carregando) return carregando;
    carregando = (async () => {
      try {
        const resposta = await rpc('get_pedido_bolsas_v2');
        if (!resposta || resposta.error) {
          throw new Error('Não foi possível carregar a lista de bolsistas para mascarar nomes.');
        }
        if (!resposta.data || !Array.isArray(resposta.data.bolsistas)) {
          throw new Error('Formato inesperado em get_pedido_bolsas_v2.');
        }
        carregarNomes(resposta.data.bolsistas);
        carregado = true;
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

  return {
    nome,
    texto,
    carregarNomes,
    marcarDicionarioCarregado,
    garantirDicionario,
    reidratar,
    // exposto para introspecção e testes; não vai ao modelo
    marcadores: porMarcador,
  };
}
