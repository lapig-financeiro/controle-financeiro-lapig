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

export const INSTRUCOES = `
Controle financeiro do LAPIG/UFG. A Análise responde com blocos (número, tabela e
texto) sobre centros de custo, saldo livre, vigência, contrato, desembolsos,
pendências e bolsas.

Escopo: a sessão está logada como uma pessoa e o banco filtra tudo por ela. Um
resultado vazio pode ser escopo, não ausência. As ferramentas só leem; nenhuma
regra financeira é calculada aqui — todo número sai de RPC.

Quatro regras valem para todas as tools:

1. Não calcule. Todo número sai das RPCs. Somar, projetar ou reordenar por conta
   própria produz um segundo resultado, que vai discordar do site.

2. Não recomende — apresente. As tools de decisão devolvem shortlist com
   justificativa. A ordem mede urgência de gasto, e urgência não é mérito: se um
   bolsista se justifica dentro do objeto daquele projeto é decisão humana e não
   está em tabela nenhuma. Exponha as opções com o porquê de cada uma; escolher
   é de quem coordena.

3. Diga o que o número cobre quando isso muda a leitura. Os campos existem para
   isso: compromissos_cobertura, situacao_dado, caixa.cobertura,
   risco_devolucao.base, truncado. Saldo alto sem balancete é previsto integral
   com realizado zero por falta de dado — não é dinheiro sobrando.

4. "panorama" descreve, "simular_alocacao" ranqueia. A ordem do panorama é
   alfabética e não significa prioridade.

Regras da Análise:

5. Toda resposta é feita de blocos. Use "criar_bloco" para número, tabela e texto.
   O bloco "numero" cita um nó em "no"; toda célula de tabela é o id de um nó,
   nunca um valor literal. O texto livre final é marcado automaticamente: número
   que não for valor de nó citado aparece como sem origem.

6. Número só por "criar_bloco" ou "calcular". Não escreva número solto no texto,
   não repita no texto o número que já está num bloco e não invente valor para
   preencher tabela. "calcular" só soma e subtrai nós de moeda/número da mesma
   unidade; regra de negócio (livre, taxa, folha, projeção) é sempre RPC.

7. O texto final tem no máximo 3 frases. Ele diz o que os blocos mostram e a
   ressalva que muda a leitura; não enumera campo por campo.

8. Sem dado, diga que não há e por quê. Ferramenta que falha volta como erro:
   nunca trate o erro como zero, lista vazia ou "sem dado". Quando o dado pedido
   não vem de nenhuma ferramenta, diga que não está disponível e não suponha
   onde ele estaria nem por quê.

9. Nome de pessoa aparece como ⟦P1⟧. Não tente adivinhar, escrever ou completar
   o nome; a tela troca o marcador pelo valor real para quem tem acesso.
`.trim();

const PARAMETRO_CENTRO = {
  type: 'string',
  description: 'Código do centro (ex.: 30.901) ou id do centro.',
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
      'Parcelas do plano ativo, valor total, data do balancete e recursos recebidos/a receber e rendimento bruto do centro. O rendimento bruto já está incluído no saldo disponível do balancete e nunca se soma de novo.',
      { project_id: PARAMETRO_CENTRO },
      ['project_id']
    ),
    ferramenta(
      'termos_contrato',
      'Termos do contrato (vigência, taxas e outros) e a comparação da vigência com o cadastro.',
      { project_id: PARAMETRO_CENTRO },
      ['project_id']
    ),
    ferramenta(
      'pendencias',
      'Pendências abertas e recentes, com tipo, situação, detalhe e centro. Sem project_id, traz todas as visíveis.',
      { project_id: PARAMETRO_CENTRO }
    ),
    ferramenta(
      'bolsas',
      'Bolsistas e bolsas visíveis (valor, início, fim, situação) e as caixas do pedido. Por padrão só bolsas vigentes hoje; incluir_encerradas traz também as antigas. Totais globais só quando não incluem centro fora da visão.',
      {
        project_id: PARAMETRO_CENTRO,
        incluir_encerradas: {
          type: 'boolean',
          description: 'Se true, inclui bolsas já encerradas (padrão: false, só as vigentes hoje).',
        },
      }
    ),
    ferramenta(
      'criar_bloco',
      'Monta um bloco citando ids de nós. Numero: no + contexto opcional. Tabela: colunas e linhas de ids. Texto: texto livre com números sem origem marcados.',
      {
        tipo: { type: 'string', enum: ['numero', 'tabela', 'texto'], description: 'Tipo do bloco.' },
        titulo: { type: 'string', description: 'Título curto, sem número que não seja de nó.' },
        no: { type: 'string', description: 'Id do nó do valor, no bloco numero.' },
        contexto: { type: 'string', description: 'Id de um nó de texto ou data, opcional no bloco numero.' },
        colunas: { type: 'array', items: { type: 'string' }, description: 'Rótulos das colunas da tabela.' },
        linhas: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Linhas da tabela; cada célula é o id de um nó.',
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
  const blocos = criarBlocos({ registro, citados, mascara });
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
      const codigosProprios = new Set(['http_4xx', 'tempo', 'formato']);
      if (
        ehErroPacote(erro) &&
        codigosProprios.has(erro.codigo) &&
        typeof erro.mensagemFixa === 'string'
      ) {
        return { id: escopo.id, erro: `${erro.mensagemFixa} (${erro.codigo})` };
      }
      return { id: escopo.id, erro: `A ferramenta ${nomeFerramenta} falhou ao montar o resultado. (formato)` };
    }
  }

  function marcarTexto(texto) {
    return marcarTextoBase(texto, { mascara, citados });
  }

  function reidratar(bloco) {
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
  };
}
