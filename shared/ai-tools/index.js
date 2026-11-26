// Pacote de ferramentas da Análise (F5) — contrato em
// docs/redesenho/analise-contrato.md.
//
// O modelo nunca escreve número: ele cita ids de nós que as ferramentas
// registram. Este pacote é a única ponte entre as RPCs e o modelo; o Worker o
// importa e a tela recebe os blocos.

import { criarRegistro } from './nos.js';
import { criarMascara } from './mascara.js';
import { criarBlocos, criarCalculadora } from './blocos.js';
import { marcarTexto as marcarTextoBase } from './texto.js';
import { ehErroPacote } from './erros.js';
import { chamarRpc, mensagemRpc } from './ferramentas/comum.js';
import { FERRAMENTAS } from './ferramentas/index.js';

const CODIGOS_PROPRIOS = new Set(['http_4xx', 'tempo', 'formato', 'rede']);

export const INSTRUCOES = `
Controle financeiro do LAPIG/UFG. A Análise responde com blocos (número, tabela e
texto) sobre centros de custo, saldo livre, vigência, contrato, desembolsos,
pendências e bolsas.

Escopo: a sessão está logada como uma pessoa e o banco filtra tudo por ela. Um
resultado vazio pode ser escopo, não ausência. As ferramentas só leem; nenhuma
regra financeira é calculada aqui — todo número sai de RPC.

Quatro regras valem para todas as tools:

1. Não calcule. Todo número sai de uma RPC; a única conta permitida é
   "calcular", que soma ou subtrai nós de moeda/número da mesma unidade.
   Somar, projetar ou reordenar por conta própria produz um segundo resultado,
   que vai discordar do site.

2. Não recomende — apresente. As tools ("listar_centros", "explicar_livre",
   "situacao_centro", "desembolsos", "termos_contrato", "pendencias" e
   "bolsas") trazem valores e motivos, sem shortlist e sem ranking de mérito.
   Exponha as opções com o porquê de cada uma; escolher é de quem coordena.

3. Diga o que o número cobre quando isso muda a leitura: a data do balancete
   ("desembolsos"), o centro sem plano ou sem balancete ("listar_centros",
   "explicar_livre", "situacao_centro"), a vigência do cadastro contra a do
   contrato ("termos_contrato"), a folha atrasada ("explicar_livre") e o
   rendimento líquido, que já está incluído no saldo disponível e não se soma
   de novo ("desembolsos").

4. "listar_centros" descreve os centros; a ordem da lista não significa
   prioridade e não ranqueia mérito.

Quando usar:

- Para a visão geral por centro (livre, situação, motivos, vigência do
  cadastro, balancete, pendências abertas e responsáveis), chame
  "listar_centros" uma vez; não chame "situacao_centro" nem "explicar_livre"
  centro por centro se "listar_centros" já responde.
- Para desembolsos e parcelas de todos os centros (ex.: "algum desembolso está
  atrasado?"), chame "desembolsos" sem project_id uma única vez.
- Para vigência e taxas de contrato de todos os centros (ex.: "onde contrato e
  cadastro discordam?"), chame "termos_contrato" sem project_id uma única vez.

Regras da Análise:

5. Toda resposta é feita de blocos. Use "criar_bloco" para número, tabela e
   texto. O bloco "numero" cita um nó em "no". Na tabela, a primeira coluna
   pode ser um rótulo de linha em texto literal ("Pessoal", "Serviços PJ") ou
   o id de um nó; as demais colunas citam só ids de nós. Texto literal nas
   colunas 2 em diante é recusado.

6. Número só por "criar_bloco" ou "calcular". Não escreva número solto no texto,
   não repita no texto o número que já está num bloco e não invente valor para
   preencher tabela. "calcular" só soma e subtrai nós de moeda/número da mesma
   unidade; regra de negócio (livre, taxa, folha, projeção) é sempre RPC.

7. Não escreva id de nó ("r2.7", "c1", "{{r2.7}}") no texto final nem em bloco
   de texto. O id existe para o "criar_bloco"; a pessoa não lê id.

8. Número no texto só se for valor de nó já citado em bloco ou "calcular".
   Prefira deixar números e tabelas nos blocos ("criar_bloco") e manter o texto
   final em até 3 frases corridas, sem repetir tabela markdown nem listas de
   números no texto.

9. Sem dado, diga que não há. Diga o porquê só quando a ferramenta informar o
   motivo; se nenhuma ferramenta traz o dado nem o motivo, diga só que ele não
   está disponível, sem supor onde estaria nem por quê. Ferramenta que falha
   volta como erro: nunca trate o erro como zero, lista vazia ou "sem dado".

10. Nome de pessoa aparece como ⟦P1⟧. Não tente adivinhar, escrever ou completar
   o nome; a tela troca o marcador pelo valor real para quem tem acesso.
`.trim();

const PARAMETRO_CENTRO = {
  type: 'string',
  description: 'Código do centro (ex.: 30.901) ou id do centro.',
};

const PARAMETRO_CENTRO_OPCIONAL = {
  ...PARAMETRO_CENTRO,
  description:
    'Código do centro (ex.: 30.901) ou id do centro. Omitir para trazer todos os centros visíveis numa única chamada.',
};

function ferramenta(nome, descricao, parametros, obrigatorios = []) {
  return {
    type: 'function',
    function: {
      name: nome,
      description: descricao,
      parameters: {
        type: 'object',
        properties: parametros,
        required: obrigatorios,
      },
    },
  };
}

/** Lista de tools no formato de function calling do /api/chat do Ollama. */
export function especificacoes() {
  return [
    ferramenta(
      'listar_centros',
      'Lista os centros visíveis com código, nome, situação, livre, vigência e motivos. Comece por aqui para saber os códigos aceitos.',
      {}
    ),
    ferramenta(
      'explicar_livre',
      'Árvore do saldo livre do centro: grupos, previsto, realizado, compromissos, taxa e folha atrasada, cada valor com id.',
      { project_id: PARAMETRO_CENTRO },
      ['project_id']
    ),
    ferramenta(
      'situacao_centro',
      'Situação e motivos de um centro; déficit, saldo do grupo e tarifa separados, com origem no quando a árvore tem o nó.',
      { project_id: PARAMETRO_CENTRO },
      ['project_id']
    ),
    ferramenta(
      'desembolsos',
      'Parcelas do plano ativo, valor total, data do balancete e recursos recebidos/a receber e rendimento do centro. Sem project_id, traz os desembolsos de todos os centros visíveis numa única chamada. Rendimento líquido (quando retornado): já incluído no saldo disponível; não somar de novo. Rendimento bruto tem rótulo próprio.',
      { project_id: PARAMETRO_CENTRO_OPCIONAL }
    ),
    ferramenta(
      'termos_contrato',
      'Termos do contrato (vigência, taxas e outros) e a comparação da vigência com o cadastro. Sem project_id, traz os termos de todos os centros visíveis numa única chamada.',
      { project_id: PARAMETRO_CENTRO_OPCIONAL }
    ),
    ferramenta(
      'pendencias',
      'Pendências abertas e recentes, com tipo, situação, detalhe e centro. Sem project_id, traz todas as visíveis.',
      { project_id: PARAMETRO_CENTRO }
    ),
    ferramenta(
      'bolsas',
      'Bolsistas e bolsas visíveis (valor, início, fim, situação) e as caixas do pedido. Por padrão, as bolsas vigentes hoje e as que ainda vão começar; incluir_encerradas traz todas (também encerradas e canceladas), com a situação de cada uma. Totais globais só quando não incluem centro fora da visão.',
      {
        project_id: PARAMETRO_CENTRO,
        incluir_encerradas: {
          type: 'boolean',
          description: 'Se true, traz todas as bolsas visíveis, inclusive encerradas e canceladas (padrão: false, só vigentes e futuras).',
        },
      }
    ),
    ferramenta(
      'criar_bloco',
      'Monta um bloco citando ids de nós. Numero: no + contexto opcional. Tabela: colunas; na primeira coluna, um rótulo de linha em texto literal ou o id de um nó, e nas demais só ids de nós. Texto: texto livre com números sem origem marcados.',
      {
        tipo: { type: 'string', enum: ['numero', 'tabela', 'texto'], description: 'Tipo do bloco.' },
        titulo: { type: 'string', description: 'Título curto, sem número que não seja de nó.' },
        no: { type: 'string', description: 'Id do nó do valor, no bloco numero.' },
        contexto: { type: 'string', description: 'Id de um nó de texto ou data, opcional no bloco numero.' },
        colunas: { type: 'array', items: { type: 'string' }, description: 'Rótulos das colunas da tabela.' },
        linhas: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description:
            'Linhas da tabela. Na primeira coluna, um rótulo de linha em texto literal ou o id de um nó; nas demais, só ids de nós.',
        },
        texto: { type: 'string', description: 'Texto do bloco texto.' },
      },
      ['tipo']
    ),
    ferramenta(
      'calcular',
      'Soma ou diferença entre nós de moeda/número da mesma unidade, ao centavo. Devolve um nó c<N> com a conta como origem.',
      {
        op: { type: 'string', enum: ['soma', 'diferenca'], description: 'soma ou diferenca (o primeiro menos os outros).' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Ids dos nós, na ordem.' },
        sinais: {
          type: 'array',
          items: { type: 'integer', enum: [1, -1] },
          description: 'Sinais ±1, opcional; sem eles, soma tudo ou subtrai os seguintes.',
        },
      },
      ['op', 'ids']
    ),
  ];
}

function normalizarHoje(valor) {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  return new Date().toISOString().slice(0, 10);
}

/**
 * Cria a sessão de ferramentas. `rpc` é o cliente injetado (Worker ou teste);
 * `hoje` é AAAA-MM-DD e fica disponível para as ferramentas.
 */
export function criarSessao({ rpc, hoje } = {}) {
  if (typeof rpc !== 'function') {
    throw new TypeError('criarSessao exige rpc(nome, args).');
  }

  const registro = criarRegistro();
  const mascara = criarMascara({ rpc });
  const citados = [];
  let nomesCentros = [];
  const blocos = criarBlocos({ registro, citados, mascara, nomesCentros: () => nomesCentros });
  const calculadora = criarCalculadora({ registro, citados });

  const ctx = {
    rpc,
    hoje: normalizarHoje(hoje),
    registro,
    mascara,
    citados,
    criarBloco: (args) => blocos.criarBloco(args),
    calcular: (args) => calculadora.calcular(args),
  };

  let centrosCache = null;
  let centrosPromessa = null;
  // Uma tentativa por sessão de trazer os responsáveis para a máscara. Guardar a
  // promessa evita repetir a RPC quando ela falha (a pergunta segue com o
  // dicionário de bolsistas) e evita corrida entre pergunta e anteriores.
  let centrosNaMascara = null;

  ctx.carregarCentros = async function carregarCentros() {
    if (centrosCache) return centrosCache;
    if (centrosPromessa) return centrosPromessa;
    centrosPromessa = (async () => {
      const resposta = await chamarRpc(ctx, 'resumo_projetos_v2');
      if (resposta.erro) throw new Error(resposta.erro);
      if (!resposta.dados || !Array.isArray(resposta.dados.centros)) {
        throw new Error(`${mensagemRpc('resumo_projetos_v2')} (formato)`);
      }
      centrosCache = resposta.dados;
      // Responsável também é nome de pessoa: entra no mesmo dicionário da
      // máscara (⟦Pn⟧ estável na sessão) antes de qualquer pergunta ou
      // resultado consultar `mascara.texto`.
      mascara.carregarResponsaveis(centrosCache.centros);
      // Nome de centro não é nome de pessoa: entra na conferência de "sem
      // origem" para que o dígito de "GPW fase 2" não seja marcado.
      nomesCentros = centrosCache.centros
        .map((centro) => (centro && typeof centro.name === 'string' ? centro.name.trim() : null))
        .filter((nome) => Boolean(nome));
      return centrosCache;
    })();
    try {
      return await centrosPromessa;
    } catch (erro) {
      centrosPromessa = null;
      throw erro;
    }
  };

  ctx.resolverCentro = async function resolverCentro(argumento) {
    if (typeof argumento !== 'string' || argumento.trim() === '') {
      return { erro: 'Informe o centro pelo código (30.901) ou pelo id.' };
    }
    const valor = argumento.trim();
    let dados;
    try {
      dados = await ctx.carregarCentros();
    } catch (erro) {
      return { erro: erro && erro.message ? erro.message : 'Não foi possível carregar os centros.' };
    }
    const centros = Array.isArray(dados.centros) ? dados.centros : [];
    const achado = centros.find(
      (centro) =>
        centro &&
        (String(centro.code) === valor ||
          String(centro.id).toLowerCase() === valor.toLowerCase())
    );
    if (!achado) return { erro: 'Centro não encontrado no seu acesso.' };
    return { centro: achado };
  };

  const arvores = new Map();
  ctx.obterArvore = async function obterArvore(projectId) {
    if (arvores.has(projectId)) return arvores.get(projectId);
    const resposta = await chamarRpc(ctx, 'explicar_livre_v2', { p_project_id: projectId });
    if (resposta.erro) throw new Error(resposta.erro);
    arvores.set(projectId, resposta.dados);
    return resposta.dados;
  };

  async function executar(nomeFerramenta, args) {
    const ferramenta = FERRAMENTAS[nomeFerramenta];
    if (!ferramenta) return { erro: `ferramenta desconhecida: ${nomeFerramenta}` };

    // Blocos e cálculo têm retorno próprio e não abrem resultado de RPC.
    if (nomeFerramenta === 'criar_bloco' || nomeFerramenta === 'calcular') {
      return ferramenta.executar(ctx, args);
    }

    const escopo = registro.iniciarResultado();
    const ctxExecucao = { ...ctx, registro: escopo };
    try {
      const resultado = await ferramenta.executar(ctxExecucao, args);
      if (!resultado || typeof resultado !== 'object') {
        return { id: escopo.id, erro: `A ferramenta ${nomeFerramenta} não devolveu resultado. (formato)` };
      }
      if (resultado.erro) return { id: escopo.id, erro: String(resultado.erro) };
      if (!resultado.paraModelo) {
        return { id: escopo.id, erro: `A ferramenta ${nomeFerramenta} não devolveu dados. (formato)` };
      }
      registro.publicar(escopo);
      return { id: escopo.id, paraModelo: JSON.stringify(resultado.paraModelo) };
    } catch (erro) {
      if (
        ehErroPacote(erro) &&
        CODIGOS_PROPRIOS.has(erro.codigo) &&
        typeof erro.mensagemFixa === 'string'
      ) {
        return { id: escopo.id, erro: `${erro.mensagemFixa} (${erro.codigo})` };
      }
      return { id: escopo.id, erro: `A ferramenta ${nomeFerramenta} falhou ao montar o resultado. (formato)` };
    }
  }

  function marcarTexto(texto) {
    return marcarTextoBase(texto, { mascara, citados, nomesCentros });
  }

  /**
   * Mascara um texto que vai AO modelo (pergunta e anteriores). Usa o mesmo
   * dicionário e a mesma numeração da máscara dos resultados das ferramentas,
   * então o ⟦Pn⟧ da pergunta casa com o ⟦Pn⟧ do resultado. Falha fechado no
   * dicionário de bolsistas: se ele não carrega, a promessa rejeita e quem
   * chamou decide encerrar. Os responsáveis de `resumo_projetos_v2` entram no
   * mesmo dicionário; se essa consulta falhar, a pergunta segue só com os
   * bolsistas (não derruba a análise).
   */
  async function mascararEntrada(texto) {
    await mascara.garantirDicionario();
    if (!centrosNaMascara) {
      centrosNaMascara = ctx.carregarCentros().catch(() => null);
    }
    await centrosNaMascara;
    return mascara.texto(String(texto ?? ''));
  }

  /**
   * Reidrata `{ texto, semOrigem }` e desloca os intervalos pelo tamanho de cada
   * nome que entrou. O texto final do modelo é conferido mascarado e só vira
   * evento depois desta troca.
   */
  function reidratarTexto(marcado) {
    if (!marcado || typeof marcado !== 'object' || Array.isArray(marcado)) return marcado;
    if (typeof marcado.texto !== 'string') return marcado;
    const { texto, semOrigem } = mascara.reidratarTextoComIntervalos(
      marcado.texto,
      Array.isArray(marcado.semOrigem) ? marcado.semOrigem : []
    );
    return { ...marcado, texto, semOrigem };
  }

  function reidratar(bloco) {
    // `{ texto, semOrigem }` é o texto final já marcado; os intervalos precisam
    // andar junto com a troca dos marcadores.
    if (
      bloco &&
      typeof bloco === 'object' &&
      !Array.isArray(bloco) &&
      typeof bloco.texto === 'string' &&
      Array.isArray(bloco.semOrigem)
    ) {
      return reidratarTexto(bloco);
    }
    const copia = mascara.reidratar(bloco);
    if (
      copia &&
      copia.texto &&
      bloco &&
      bloco.texto &&
      typeof bloco.texto.texto === 'string' &&
      Array.isArray(bloco.texto.semOrigem)
    ) {
      const { texto, semOrigem } = mascara.reidratarTextoComIntervalos(
        bloco.texto.texto,
        bloco.texto.semOrigem
      );
      copia.texto.texto = texto;
      copia.texto.semOrigem = semOrigem;
    }
    return copia;
  }

  return {
    executar,
    criarBloco: (args) => blocos.criarBloco(args),
    calcular: (args) => calculadora.calcular(args),
    marcarTexto,
    reidratar,
    reidratarTexto,
    mascararEntrada,
  };
}
