// Retrato das RPCs da Análise (bancada).
//
// O retrato é o JSON que o oráculo grava fora do git
// (NãoColocarNoGit/analise/oraculo-AAAA-MM-DD.json). Ele tem o resumo dos
// centros, as cinco RPCs de cada centro e as bolsas **sem nome**. Aqui ele vira
// as respostas que o roteador devolve, com os nomes de bolsista reconstruídos
// como `Bolsista Bancada 001`, 002… — um por `pessoa` — e `holder_id` estável.
//
// Nada aqui toca a rede. O retrato real nunca é copiado para o repositório.

import { readFile } from 'node:fs/promises';

const CAMPOS_RPC = Object.freeze({
  situacao: 'situacao_centro_v2',
  arvore: 'explicar_livre_v2',
  desembolsos: 'get_repasses_v2',
  termos: 'get_termos_contrato_v2',
  pendencias: 'listar_pendencias_v2',
});

export { CAMPOS_RPC };

function clonar(valor) {
  if (valor === undefined) return undefined;
  return JSON.parse(JSON.stringify(valor));
}

function numeroOuNulo(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(valor)) {
    const numero = Number(valor.trim().replace(',', '.'));
    return Number.isFinite(numero) ? numero : null;
  }
  return null;
}

function idSeguro(valor, indice) {
  const base = String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `p${indice + 1}`;
}

/** Lê e prepara um retrato do disco. */
export async function carregarRetrato(caminho) {
  let texto;
  try {
    texto = await readFile(caminho, 'utf8');
  } catch {
    throw new Error(`Não foi possível ler o retrato: ${caminho}`);
  }

  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    throw new Error(`O retrato não é JSON válido: ${caminho}`);
  }

  return prepararRetrato(dados);
}

/**
 * Normaliza o retrato do oráculo sem alterar o formato das RPCs. O que faltar
 * num campo que o validador do pacote exige é preenchido com valor neutro e
 * anotado em `observacoes` (o relatório da bancada mostra a lista).
 */
export function prepararRetrato(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    throw new Error('O retrato precisa ser um objeto JSON.');
  }

  const resumo = clonar(dados.resumo ?? {});
  if (!Array.isArray(resumo.centros)) {
    throw new Error('O retrato não tem resumo.centros (o formato do oráculo).');
  }

  const observacoes = [];
  const centrosPorCodigo = new Map();
  const centrosPorId = new Map();

  for (const centro of resumo.centros) {
    if (!centro || typeof centro !== 'object' || typeof centro.code !== 'string' || !centro.code) {
      observacoes.push('resumo.centros: item sem "code" foi ignorado no índice.');
      continue;
    }
    centrosPorCodigo.set(centro.code, centro);
    if (typeof centro.id === 'string' && centro.id) centrosPorId.set(centro.id, centro.code);
  }

  for (const centro of Array.isArray(resumo.todos) ? resumo.todos : []) {
    if (!centro || typeof centro !== 'object') continue;
    if (typeof centro.code === 'string' && centro.code && !centrosPorCodigo.has(centro.code)) {
      centrosPorCodigo.set(centro.code, centro);
    }
    if (typeof centro.id === 'string' && centro.id && !centrosPorId.has(centro.id)) {
      if (typeof centro.code === 'string') centrosPorId.set(centro.id, centro.code);
    }
  }

  const centrosBrutos = dados.centros && typeof dados.centros === 'object' ? dados.centros : {};
  const centros = {};

  for (const [codigo, bruto] of Object.entries(centrosBrutos)) {
    if (!centrosPorCodigo.has(codigo)) {
      centrosPorCodigo.set(codigo, { code: codigo, id: null, name: codigo });
      observacoes.push(`centro ${codigo}: não estava no resumo; índice montado pelo código.`);
    }
    const centro = bruto && typeof bruto === 'object' ? bruto : {};
    centros[codigo] = {};
    for (const [campo, rpc] of Object.entries(CAMPOS_RPC)) {
      const valor = centro[campo];
      if (valor === undefined) {
        observacoes.push(`centro ${codigo}: ${rpc} ausente no retrato.`);
        continue;
      }
      centros[codigo][campo] = clonar(valor);
    }
    if (!Object.prototype.hasOwnProperty.call(centros[codigo], 'pendencias')) {
      centros[codigo].pendencias = [];
    }
  }

  const bolsistas = [];
  const nomesSinteticos = [];
  const nomesPorPessoa = new Map();
  const nomesPorBolsa = new Map();
  const holdersUsados = new Set();
  const listaBolsas = Array.isArray(dados.bolsas) ? dados.bolsas : [];

  if (!Array.isArray(dados.bolsas)) {
    observacoes.push('retrato sem a lista "bolsas"; get_pedido_bolsas_v2 responderá vazio.');
  }

  listaBolsas.forEach((entrada, indice) => {
    const pessoa = entrada && typeof entrada.pessoa === 'string' && entrada.pessoa
      ? entrada.pessoa
      : `P${indice + 1}`;

    let nome = nomesPorPessoa.get(pessoa);
    if (!nome) {
      nome = `Bolsista Bancada ${String(nomesPorPessoa.size + 1).padStart(3, '0')}`;
      nomesPorPessoa.set(pessoa, nome);
      nomesSinteticos.push(nome);
    }

    const base = `bancada-${idSeguro(pessoa, indice)}`;
    let holderId = base;
    let sufixo = 2;
    while (holdersUsados.has(holderId)) {
      holderId = `${base}-${sufixo}`;
      sufixo += 1;
    }
    holdersUsados.add(holderId);

    const valorVigente = numeroOuNulo(entrada && entrada.valor_vigente);
    if (valorVigente === null) {
      observacoes.push(`bolsista ${pessoa}: valor_vigente ausente; preenchido com 0.`);
    }

    const bolsas = [];
    for (const [indiceBolsa, bolsaBruta] of (Array.isArray(entrada && entrada.bolsas)
      ? entrada.bolsas
      : []
    ).entries()) {
      const bolsa = normalizarBolsa({
        bolsa: bolsaBruta,
        centrosPorCodigo,
        centrosPorId,
        observacoes,
        etiqueta: `${pessoa}.bolsas[${indiceBolsa}]`,
      });
      if (bolsa) {
        bolsas.push(bolsa);
        if (
          bolsaBruta &&
          typeof bolsaBruta.scholarship_id === 'string' &&
          bolsaBruta.scholarship_id
        ) {
          nomesPorBolsa.set(bolsaBruta.scholarship_id, nome);
        }
      }
    }

    bolsistas.push({
      holder_id: holderId,
      nome,
      equipe: entrada && typeof entrada.equipe === 'string' && entrada.equipe
        ? entrada.equipe
        : null,
      valor_vigente: valorVigente ?? 0,
      bolsas,
    });
  });

  const bolsas = { bolsistas };
  if (Array.isArray(dados.caixas)) bolsas.caixas = clonar(dados.caixas);

  // O oráculo trocou todo nome por "[nome]". Na árvore, a folha de bolsa tem a
  // ref da scholarship e o sufixo "— N meses × R$ X"; trocar o marcador pelo
  // nome sintético daquela bolsa mantém o mesmo ⟦Pn⟧ entre `bolsas` e árvore.
  for (const centro of Object.values(centros)) {
    if (centro.arvore && typeof centro.arvore === 'object') {
      substituirNomeNaArvore(centro.arvore, nomesPorBolsa);
    }
  }

  return {
    resumo,
    centros,
    centrosPorCodigo,
    centrosPorId,
    bolsas,
    nomesSinteticos,
    observacoes,
  };
}

function substituirNomeNaArvore(no, nomesPorBolsa) {
  if (!no || typeof no !== 'object' || Array.isArray(no)) return;

  if (
    no.ref &&
    no.ref.alvo_tabela === 'scholarships' &&
    typeof no.ref.alvo_id === 'string' &&
    typeof no.rotulo === 'string'
  ) {
    const nome = nomesPorBolsa.get(no.ref.alvo_id);
    if (nome) no.rotulo = no.rotulo.split('[nome]').join(nome);
  }

  for (const parte of Array.isArray(no.partes) ? no.partes : []) {
    substituirNomeNaArvore(parte, nomesPorBolsa);
  }
}

function normalizarBolsa({ bolsa, centrosPorCodigo, centrosPorId, observacoes, etiqueta }) {
  if (!bolsa || typeof bolsa !== 'object' || Array.isArray(bolsa)) {
    observacoes.push(`${etiqueta}: bolsa inválida foi ignorada.`);
    return null;
  }

  let code = typeof bolsa.code === 'string' ? bolsa.code : '';
  let projectId = typeof bolsa.project_id === 'string' ? bolsa.project_id : '';

  if (!code && projectId && centrosPorId.has(projectId)) code = centrosPorId.get(projectId);
  if (!projectId && code && centrosPorCodigo.has(code)) {
    const centro = centrosPorCodigo.get(code);
    if (typeof centro.id === 'string') projectId = centro.id;
  }

  if (!code || !projectId) {
    observacoes.push(`${etiqueta}: sem code/project_id utilizável; bolsa ignorada.`);
    return null;
  }

  const valor = numeroOuNulo(bolsa.valor);
  if (valor === null) observacoes.push(`${etiqueta}: valor ausente; preenchido com 0.`);
  if (typeof bolsa.inicio !== 'string') observacoes.push(`${etiqueta}: inicio ausente; string vazia.`);
  if (typeof bolsa.fim !== 'string') observacoes.push(`${etiqueta}: fim ausente; string vazia.`);
  if (typeof bolsa.status !== 'string') observacoes.push(`${etiqueta}: status ausente; "desconhecido".`);
  if (typeof bolsa.vigente_hoje !== 'boolean') {
    observacoes.push(`${etiqueta}: vigente_hoje ausente; false.`);
  }

  return {
    project_id: projectId,
    code,
    valor: valor ?? 0,
    inicio: typeof bolsa.inicio === 'string' ? bolsa.inicio : '',
    fim: typeof bolsa.fim === 'string' ? bolsa.fim : '',
    status: typeof bolsa.status === 'string' ? bolsa.status : 'desconhecido',
    vigente_hoje: bolsa.vigente_hoje === true,
  };
}
