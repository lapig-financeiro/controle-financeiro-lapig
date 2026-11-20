import { supabase } from './supabase.js';
import { parseValorBR } from '../util/moeda.js';

export function modoExemploAtivo(env = import.meta.env) {
  return Boolean(env?.DEV && env?.VITE_DADOS === 'exemplo');
}

const NIVEIS_MOTIVO = ['problema', 'atenção', 'atencao', 'info'];

function ehMotivoValido(motivo) {
  if (!motivo || typeof motivo !== 'object' || Array.isArray(motivo)) return false;
  if (typeof motivo.codigo !== 'string' || motivo.codigo.trim() === '') return false;
  if (!NIVEIS_MOTIVO.includes(String(motivo.nivel || '').trim().toLowerCase())) return false;
  if (typeof motivo.texto !== 'string' || motivo.texto.trim() === '') return false;
  return true;
}

/**
 * Os motivos dos selos chegam da 069. Antes dela, a produção ainda não
 * manda a chave: ausente é aceito como lista vazia para o site não
 * quebrar entre o deploy e a aplicação da migração.
 */
export function validarMotivos(motivos, { ausenteOk = true } = {}) {
  if (motivos === undefined || motivos === null) return ausenteOk;
  if (!Array.isArray(motivos)) return false;
  return motivos.every(ehMotivoValido);
}

export function validarResumoProjetos(d) {
  return Boolean(
    d &&
      typeof d === 'object' &&
      Array.isArray(d.centros) &&
      Array.isArray(d.todos) &&
      d.centros.every((centro) => Boolean(centro) && validarMotivos(centro.motivos))
  );
}

export function validarSituacaoCentro(d) {
  return Boolean(
    d &&
      typeof d === 'object' &&
      typeof d.situacao === 'string' &&
      d.situacao.trim() !== '' &&
      validarMotivos(d.motivos, { ausenteOk: false })
  );
}

let exemploPromise = null;

async function carregarExemplo() {
  if (!(import.meta.env.DEV && import.meta.env.VITE_DADOS === 'exemplo')) {
    return null;
  }
  if (!exemploPromise) {
    exemploPromise = import('./dadosExemplo.js').catch((err) => {
      exemploPromise = null;
      throw err;
    });
  }
  try {
    const modulo = await exemploPromise;
    return { modulo, erro: null };
  } catch {
    exemploPromise = null;
    return { modulo: null, erro: 'Não foi possível carregar os dados de exemplo.' };
  }
}

function validarPayload(data, mensagemErro, { lista = false, validar = null } = {}) {
  if (lista) {
    if (!Array.isArray(data)) {
      return { dados: null, erro: mensagemErro };
    }
    return { dados: data, erro: null };
  }

  if (data === null || data === undefined) {
    return { dados: null, erro: mensagemErro };
  }

  if (validar && !validar(data)) {
    return { dados: null, erro: mensagemErro };
  }

  return { dados: data, erro: null };
}

async function responderExemplo(chamada, mensagemErro, opcoes = {}) {
  try {
    const res = await chamada();
    if (!res || res.erro) {
      return { dados: null, erro: res?.erro || mensagemErro };
    }
    return validarPayload(res.dados, mensagemErro, opcoes);
  } catch {
    return { dados: null, erro: mensagemErro };
  }
}

const CODIGOS_COM_MENSAGEM = new Set(['22023', 'P0002', '42501']);

function mensagemDaRpc(error) {
  if (!error || !CODIGOS_COM_MENSAGEM.has(String(error.code || ''))) return null;
  const mensagem = typeof error.message === 'string' ? error.message.trim() : '';
  if (!mensagem) return null;
  // Erro de ACL/constraint do próprio Postgres não é mensagem escrita para
  // a pessoa; esses continuam genéricos.
  if (/^(permission denied|new row|duplicate key|violates|null value)/i.test(mensagem)) {
    return null;
  }
  return mensagem;
}

async function chamarRpc(nome, params, mensagemErro, opcoes = {}) {
  const { mensagemBanco = false, ...validacao } = opcoes;
  try {
    const { data, error } = params === undefined
      ? await supabase.rpc(nome)
      : await supabase.rpc(nome, params);

    if (error) {
      return { dados: null, erro: (mensagemBanco && mensagemDaRpc(error)) || mensagemErro };
    }

    return validarPayload(data, mensagemErro, validacao);
  } catch {
    return { dados: null, erro: mensagemErro };
  }
}

export async function resumoProjetos() {
  const opcoes = {
    validar: validarResumoProjetos,
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.resumoProjetos(),
          'Não foi possível carregar os centros de custo.',
          opcoes
        );
  }
  return chamarRpc(
    'resumo_projetos_v2',
    undefined,
    'Não foi possível carregar os centros de custo.',
    opcoes
  );
}

/**
 * Situação e motivos de um centro pela RPC da 069. Se a RPC ainda não
 * existir (produção antes da migração), devolve `{ dados: null }` sem
 * erro e a página usa a regra de hoje.
 */
export async function situacaoCentro(projectId) {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    return { dados: null, erro: 'Centro é obrigatório.' };
  }
  const mensagem = 'Não foi possível carregar a situação do centro.';
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.situacaoCentro(projectId),
          mensagem,
          { validar: validarSituacaoCentro }
        );
  }
  try {
    const { data, error } = await supabase.rpc('situacao_centro_v2', {
      p_project_id: projectId,
    });
    if (error) {
      const codigo = String(error.code || '');
      if (codigo === '42883' || codigo === 'PGRST202') {
        return { dados: null, erro: null };
      }
      return { dados: null, erro: mensagemDaRpc(error) || mensagem };
    }
    if (data === null || data === undefined) {
      return { dados: null, erro: null };
    }
    if (!validarSituacaoCentro(data)) {
      return { dados: null, erro: mensagem };
    }
    return { dados: data, erro: null };
  } catch {
    return { dados: null, erro: mensagem };
  }
}

export async function pendencias(projectId = null) {
  const opcoes = { lista: true };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.pendencias(projectId),
          'Não foi possível carregar as pendências.',
          opcoes
        );
  }
  return chamarRpc(
    'listar_pendencias_v2',
    { p_project_id: projectId ?? null },
    'Não foi possível carregar as pendências.',
    opcoes
  );
}

export async function resolverPendencia(id, situacao) {
  const opcoes = {
    validar: (d) => Boolean(d && typeof d === 'object' && d.id && typeof d.situacao === 'string'),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.resolverPendencia(id, situacao),
          'Não foi possível atualizar a pendência.',
          opcoes
        );
  }
  return chamarRpc(
    'resolver_pendencia_v2',
    { p_id: id, p_situacao: situacao },
    'Não foi possível atualizar a pendência.',
    opcoes
  );
}

export async function filtroVisao() {
  const opcoes = {
    validar: (d) => Boolean(d && typeof d === 'object' && Array.isArray(d.centros_ocultos)),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.filtroVisao(),
          'Não foi possível carregar o filtro de visão.',
          opcoes
        );
  }
  return chamarRpc(
    'get_filtro_visao_v2',
    undefined,
    'Não foi possível carregar o filtro de visão.',
    opcoes
  );
}

export async function salvarFiltroVisao(centrosOcultos) {
  const opcoes = {
    validar: (d) => Boolean(d && typeof d === 'object' && Array.isArray(d.centros_ocultos)),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.salvarFiltroVisao(centrosOcultos),
          'Não foi possível salvar o filtro de visão.',
          opcoes
        );
  }
  return chamarRpc(
    'set_filtro_visao_v2',
    { p_centros_ocultos: Array.isArray(centrosOcultos) ? centrosOcultos : [] },
    'Não foi possível salvar o filtro de visão.',
    opcoes
  );
}

export async function saldoLivre(projectId) {
  const opcoes = {
    validar: (d) =>
      Boolean(
        d &&
          typeof d === 'object' &&
          typeof d.has_plano === 'boolean' &&
          typeof d.has_balancete === 'boolean'
      ),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.saldoLivre(projectId),
          'Não foi possível calcular o saldo deste centro.',
          opcoes
        );
  }
  return chamarRpc(
    'get_saldo_livre',
    { p_project_id: projectId },
    'Não foi possível calcular o saldo deste centro.',
    opcoes
  );
}

export async function repasses(projectId) {
  const opcoes = {
    validar: (d) => Boolean(d && typeof d === 'object' && Array.isArray(d.parcelas)),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.repasses(projectId),
          'Não foi possível carregar os repasses deste centro.',
          opcoes
        );
  }
  return chamarRpc(
    'get_repasses_v2',
    { p_project_id: projectId },
    'Não foi possível carregar os repasses deste centro.',
    opcoes
  );
}

export async function balancetes(projectId) {
  const opcoes = { lista: true };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.balancetes(projectId),
          'Não foi possível carregar os balancetes deste centro.',
          opcoes
        );
  }
  return chamarRpc(
    'get_balancetes_by_project',
    { p_project_id: projectId },
    'Não foi possível carregar os balancetes deste centro.',
    opcoes
  );
}

export async function planos(projectId) {
  const opcoes = { lista: true };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.planos(projectId),
          'Não foi possível carregar os planos deste centro.',
          opcoes
        );
  }
  return chamarRpc(
    'get_planos_historico',
    { p_project_id: projectId },
    'Não foi possível carregar os planos deste centro.',
    opcoes
  );
}

export async function termosContrato(projectId) {
  if (!projectId) {
    return { dados: null, erro: 'Centro de custo não informado.' };
  }
  const opcoes = { validar: validarTermosContrato };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.termosContrato(projectId),
          'Não foi possível carregar os termos do contrato.',
          opcoes
        );
  }
  return chamarRpc(
    'get_termos_contrato_v2',
    { p_project_id: projectId },
    'Não foi possível carregar os termos do contrato.',
    opcoes
  );
}

export async function conferirTermoContrato(id) {
  if (typeof id !== 'string' || !id.trim()) {
    return { dados: null, erro: 'Termo do contrato não informado.' };
  }
  const opcoes = {
    validar: (d) => Boolean(d && typeof d === 'object' && typeof d.id === 'string'),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.conferirTermoContrato(id),
          'Não foi possível marcar o termo como conferido.',
          opcoes
        );
  }
  return chamarRpc(
    'conferir_termo_contrato_v2',
    { p_id: id },
    'Não foi possível marcar o termo como conferido.',
    opcoes
  );
}

export async function usarVigenciaDoContrato(projectId) {
  if (!projectId) {
    return { dados: null, erro: 'Centro de custo não informado.' };
  }
  const dataOuNula = (v) => v === null || typeof v === 'string';
  const opcoes = {
    validar: (d) =>
      Boolean(
        d &&
          typeof d === 'object' &&
          d.antes &&
          typeof d.antes === 'object' &&
          dataOuNula(d.antes.start_date) &&
          dataOuNula(d.antes.end_date) &&
          d.depois &&
          typeof d.depois === 'object' &&
          dataOuNula(d.depois.start_date) &&
          dataOuNula(d.depois.end_date) &&
          typeof d.mudou === 'boolean'
      ),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.usarVigenciaDoContrato(projectId),
          'Não foi possível usar a vigência do contrato.',
          opcoes
        );
  }
  return chamarRpc(
    'usar_vigencia_do_contrato_v2',
    { p_project_id: projectId },
    'Não foi possível usar a vigência do contrato.',
    opcoes
  );
}

const EQUIPES_BOLSISTA = ['pastagem', 'alertas', 'solos'];

function validarEquipe(valor) {
  return valor === null || valor === undefined || EQUIPES_BOLSISTA.includes(valor);
}

export async function pedidoBolsas() {
  const opcoes = { validar: validarPedidoBolsas };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.pedidoBolsas(),
          'Não foi possível carregar o pedido de bolsas.',
          opcoes
        );
  }
  return chamarRpc(
    'get_pedido_bolsas_v2',
    undefined,
    'Não foi possível carregar o pedido de bolsas.',
    { ...opcoes, mensagemBanco: true }
  );
}

export async function salvarEquipeBolsista(holderId, equipe) {
  if (typeof holderId !== 'string' || !holderId.trim()) {
    return { dados: null, erro: 'Pessoa não informada.' };
  }
  const equipeNormalizada = equipe === null || equipe === undefined || equipe === '' ? null : equipe;
  if (!validarEquipe(equipeNormalizada)) {
    return { dados: null, erro: 'Equipe inválida.' };
  }
  const opcoes = {
    validar: (d) =>
      Boolean(
        d &&
          typeof d === 'object' &&
          d.holder_id === holderId &&
          validarEquipe(d.equipe)
      ),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.salvarEquipeBolsista(holderId, equipeNormalizada),
          'Não foi possível salvar a equipe.',
          opcoes
        );
  }
  return chamarRpc(
    'salvar_equipe_bolsista_v2',
    { p_holder_id: holderId, p_equipe: equipeNormalizada },
    'Não foi possível salvar a equipe.',
    { ...opcoes, mensagemBanco: true }
  );
}

export async function salvarCaixaPedido(payload) {
  const bruto = payload && typeof payload === 'object' ? payload : {};
  const nome = typeof bruto.nome === 'string' ? bruto.nome.trim() : '';
  const temMeses = bruto.meses !== undefined && bruto.meses !== null;
  const meses = temMeses ? bruto.meses : undefined;
  if (!nome || nome.length > 80) {
    return { dados: null, erro: 'O nome da caixa deve ter de 1 a 80 caracteres.' };
  }
  if (temMeses && (!Number.isInteger(meses) || meses < 1 || meses > 60)) {
    return { dados: null, erro: 'Os meses da caixa devem ser um inteiro entre 1 e 60.' };
  }
  if (bruto.id !== undefined && bruto.id !== null && (typeof bruto.id !== 'string' || !bruto.id.trim())) {
    return { dados: null, erro: 'Caixa não informada corretamente.' };
  }
  const corpo = { nome };
  if (temMeses) corpo.meses = meses;
  if (bruto.id !== undefined && bruto.id !== null) corpo.id = bruto.id;
  const opcoes = {
    validar: (d) =>
      Boolean(
        d &&
          typeof d === 'object' &&
          typeof d.id === 'string' &&
          d.id.trim() &&
          (bruto.id === undefined || bruto.id === null || d.id === bruto.id) &&
          typeof d.nome === 'string' &&
          d.nome === nome &&
          Number.isInteger(d.meses) &&
          d.meses >= 1 &&
          d.meses <= 60 &&
          (!temMeses || d.meses === meses)
      ),
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.salvarCaixaPedido(corpo),
          'Não foi possível salvar a caixa.',
          opcoes
        );
  }
  return chamarRpc(
    'salvar_caixa_pedido_v2',
    { p: corpo },
    'Não foi possível salvar a caixa.',
    { ...opcoes, mensagemBanco: true }
  );
}

export async function apagarCaixaPedido(id) {
  if (typeof id !== 'string' || !id.trim()) {
    return { dados: null, erro: 'Caixa não informada.' };
  }
  const opcoes = {
    validar: (d) =>
      Boolean(d && typeof d === 'object' && d.id === id && d.apagada === true),
    mensagemBanco: true,
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.apagarCaixaPedido(id),
          'Não foi possível apagar a caixa.',
          opcoes
        );
  }
  return chamarRpc(
    'apagar_caixa_pedido_v2',
    { p_id: id },
    'Não foi possível apagar a caixa.',
    opcoes
  );
}

export async function colocarNaCaixa(caixaId, holderId) {
  if (typeof caixaId !== 'string' || !caixaId.trim() || typeof holderId !== 'string' || !holderId.trim()) {
    return { dados: null, erro: 'Caixa e pessoa são obrigatórias.' };
  }
  const opcoes = {
    validar: (d) =>
      Boolean(
        d &&
          typeof d === 'object' &&
          d.caixa_id === caixaId &&
          d.holder_id === holderId &&
          numeroValidoOuNulo(d.valor_mensal) &&
          numeroFinitoEstrito(d.valor_usado) &&
          (d.nota === null || d.nota === undefined || typeof d.nota === 'string') &&
          Array.isArray(d.saiu_de) &&
          d.saiu_de.every(
            (c) =>
              c &&
              typeof c === 'object' &&
              typeof c.caixa_id === 'string' &&
              typeof c.nome === 'string'
          )
      ),
    mensagemBanco: true,
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.colocarNaCaixa(caixaId, holderId),
          'Não foi possível colocar a pessoa na caixa.',
          opcoes
        );
  }
  return chamarRpc(
    'colocar_na_caixa_v2',
    { p_caixa_id: caixaId, p_holder_id: holderId },
    'Não foi possível colocar a pessoa na caixa.',
    opcoes
  );
}

export async function editarItemCaixa(caixaId, holderId, valorMensal = null, nota = null) {
  if (typeof caixaId !== 'string' || !caixaId.trim() || typeof holderId !== 'string' || !holderId.trim()) {
    return { dados: null, erro: 'Caixa e pessoa são obrigatórias.' };
  }
  let valorBruto = null;
  if (valorMensal !== null && valorMensal !== undefined) {
    if (typeof valorMensal === 'string') {
      const texto = valorMensal.trim();
      if (texto !== '') {
        valorBruto = parseValorBR(texto);
        if (valorBruto === null) {
          return { dados: null, erro: 'O valor no pedido deve ser um número positivo.' };
        }
      }
    } else {
      valorBruto = Number(valorMensal);
    }
  }
  let valor = null;
  if (valorBruto !== null) {
    if (!Number.isFinite(valorBruto)) {
      return { dados: null, erro: 'O valor no pedido deve ser um número positivo.' };
    }
    valor = Math.round(valorBruto * 100) / 100;
    if (valor <= 0) {
      return { dados: null, erro: 'O valor no pedido deve ser um número positivo.' };
    }
  }
  const notaTexto =
    nota === null || nota === undefined || String(nota).trim() === '' ? null : String(nota).trim();
  if (notaTexto !== null && notaTexto.length > 300) {
    return { dados: null, erro: 'A nota deve ter até 300 caracteres.' };
  }
  const opcoes = {
    validar: (d) =>
      Boolean(
        d &&
          typeof d === 'object' &&
          d.caixa_id === caixaId &&
          d.holder_id === holderId &&
          (valor === null
            ? d.valor_mensal === null || d.valor_mensal === undefined
            : Math.abs(Number(d.valor_mensal) - valor) <= 0.005) &&
          numeroFinitoEstrito(d.valor_usado) &&
          (notaTexto === null
            ? d.nota === null || d.nota === undefined
            : d.nota === notaTexto)
      ),
    mensagemBanco: true,
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.editarItemCaixa(caixaId, holderId, valor, notaTexto),
          'Não foi possível editar a pessoa na caixa.',
          opcoes
        );
  }
  return chamarRpc(
    'editar_item_caixa_v2',
    {
      p_caixa_id: caixaId,
      p_holder_id: holderId,
      p_valor_mensal: valor,
      p_nota: notaTexto,
    },
    'Não foi possível editar a pessoa na caixa.',
    opcoes
  );
}

export async function tirarDaCaixa(caixaId, holderId) {
  if (typeof caixaId !== 'string' || !caixaId.trim() || typeof holderId !== 'string' || !holderId.trim()) {
    return { dados: null, erro: 'Caixa e pessoa são obrigatórias.' };
  }
  const opcoes = {
    validar: (d) =>
      Boolean(
        d &&
          typeof d === 'object' &&
          d.caixa_id === caixaId &&
          d.holder_id === holderId &&
          d.removido === true
      ),
    mensagemBanco: true,
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.tirarDaCaixa(caixaId, holderId),
          'Não foi possível tirar a pessoa da caixa.',
          opcoes
        );
  }
  return chamarRpc(
    'tirar_da_caixa_v2',
    { p_caixa_id: caixaId, p_holder_id: holderId },
    'Não foi possível tirar a pessoa da caixa.',
    opcoes
  );
}

export async function limparOcultosDaCaixa(caixaId) {
  if (typeof caixaId !== 'string' || !caixaId.trim()) {
    return { dados: null, erro: 'Caixa não informada.' };
  }
  const opcoes = {
    validar: (d) =>
      Boolean(
        d &&
          typeof d === 'object' &&
          d.caixa_id === caixaId &&
          Number.isInteger(d.removidos) &&
          d.removidos >= 0
      ),
    mensagemBanco: true,
  };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.limparOcultosDaCaixa(caixaId),
          'Não foi possível tirar quem saiu da lista.',
          opcoes
        );
  }
  return chamarRpc(
    'limpar_ocultos_da_caixa_v2',
    { p_caixa_id: caixaId },
    'Não foi possível tirar quem saiu da lista.',
    opcoes
  );
}

const TIPOS_NO_ARVORE = ['calculo', 'documento', 'legado', 'digitado'];

function ehObjetoSimples(valor) {
  return Boolean(valor && typeof valor === 'object' && !Array.isArray(valor));
}

function numeroFinitoEstrito(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor);
  if (typeof valor === 'string') {
    const trimmed = valor.trim();
    if (!trimmed) return false;
    return Number.isFinite(Number(trimmed));
  }
  return false;
}

function numeroValidoOuNulo(valor) {
  return valor === null || valor === undefined || numeroFinitoEstrito(valor);
}

function validarRefOrigem(ref) {
  if (ref === null || ref === undefined) return true;
  if (!ehObjetoSimples(ref)) return false;
  return (
    typeof ref.alvo_tabela === 'string' &&
    ref.alvo_tabela.trim().length > 0 &&
    typeof ref.alvo_id === 'string' &&
    ref.alvo_id.trim().length > 0 &&
    typeof ref.campo === 'string' &&
    ref.campo.trim().length > 0
  );
}

function validarNoArvore(no, ehRaiz = false, profundidade = 0) {
  if (profundidade > 32 || !ehObjetoSimples(no)) return false;
  if (typeof no.rotulo !== 'string') return false;
  if (!TIPOS_NO_ARVORE.includes(no.tipo)) return false;
  if (!Array.isArray(no.partes)) return false;
  if (!validarRefOrigem(no.ref)) return false;
  if (no.sinal !== undefined && no.sinal !== null && no.sinal !== 1 && no.sinal !== -1) {
    return false;
  }

  if (ehRaiz && no.valor === null) {
    return typeof no.motivo === 'string' && no.motivo.trim().length > 0 && no.partes.length === 0;
  }

  if (!numeroFinitoEstrito(no.valor)) return false;

  for (const filho of no.partes) {
    if (!validarNoArvore(filho, false, profundidade + 1)) {
      return false;
    }
  }
  return true;
}

export function validarArvoreExplicacao(d) {
  return validarNoArvore(d, true, 0);
}

export function validarOrigem(d) {
  if (!ehObjetoSimples(d)) return false;
  if (!['documento', 'legado', 'digitado'].includes(d.tipo)) return false;
  if (!numeroValidoOuNulo(d.valor)) return false;
  if (d.documento !== null && d.documento !== undefined && !ehObjetoSimples(d.documento)) {
    return false;
  }
  if (d.fato !== null && d.fato !== undefined && !ehObjetoSimples(d.fato)) {
    return false;
  }
  if (d.busca !== null && d.busca !== undefined && !ehObjetoSimples(d.busca)) {
    return false;
  }
  return true;
}

function validarTermoContrato(t) {
  if (!ehObjetoSimples(t)) return false;
  if (typeof t.id !== 'string' || !t.id.trim()) return false;
  if (typeof t.valor !== 'string' && !numeroFinitoEstrito(t.valor)) return false;
  if (t.regra !== null && t.regra !== undefined && typeof t.regra !== 'string') return false;
  if (typeof t.trecho !== 'string') return false;
  if (typeof t.documento_nome !== 'string') return false;
  if (
    t.documento_url !== null &&
    t.documento_url !== undefined &&
    typeof t.documento_url !== 'string'
  ) {
    return false;
  }
  if (
    t.documento_id !== null &&
    t.documento_id !== undefined &&
    (typeof t.documento_id !== 'string' || !t.documento_id.trim())
  ) {
    return false;
  }
  if (
    (t.documento_url === null || t.documento_url === undefined || !t.documento_url.trim()) &&
    (t.documento_id === null || t.documento_id === undefined)
  ) {
    return false;
  }
  if (t.documento !== null && t.documento !== undefined) {
    if (!ehObjetoSimples(t.documento)) return false;
    if (typeof t.documento.bucket !== 'string') return false;
    if (
      t.documento.caminho !== null &&
      t.documento.caminho !== undefined &&
      (typeof t.documento.caminho !== 'string' || !t.documento.caminho.trim())
    ) {
      return false;
    }
    if (
      t.documento.arquivo_nome !== null &&
      t.documento.arquivo_nome !== undefined &&
      typeof t.documento.arquivo_nome !== 'string'
    ) {
      return false;
    }
    if (
      t.documento.formato !== null &&
      t.documento.formato !== undefined &&
      !['pdf', 'docx'].includes(t.documento.formato)
    ) {
      return false;
    }
  }
  if (
    t.pagina !== null &&
    t.pagina !== undefined &&
    (!Number.isInteger(t.pagina) || t.pagina < 1)
  ) {
    return false;
  }
  if (t.nota !== null && t.nota !== undefined && typeof t.nota !== 'string') return false;
  if (t.origem !== 'ia' && t.origem !== 'pessoa') return false;
  if (typeof t.autor !== 'string' || !t.autor.trim()) return false;
  if (typeof t.conferido !== 'boolean') return false;
  if (t.conferido_em !== null && t.conferido_em !== undefined && typeof t.conferido_em !== 'string') {
    return false;
  }
  if (t.versoes_anteriores !== undefined && !Array.isArray(t.versoes_anteriores)) return false;
  return true;
}

export function validarTermosContrato(d) {
  if (!ehObjetoSimples(d)) return false;
  if (!ehObjetoSimples(d.termos)) return false;
  if (d.start_date_cadastro !== null && typeof d.start_date_cadastro !== 'string') return false;
  if (d.end_date_cadastro !== null && typeof d.end_date_cadastro !== 'string') return false;
  if (!['confere', 'diverge', 'sem_cadastro', 'sem_contrato'].includes(d.vigencia_situacao)) {
    return false;
  }
  if (d.vigencia_confere !== null && typeof d.vigencia_confere !== 'boolean') return false;
  return Object.values(d.termos).every(validarTermoContrato);
}

function validarDataIso(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function validarCentroPedido(c) {
  return (
    ehObjetoSimples(c) &&
    typeof c.id === 'string' &&
    c.id.trim().length > 0 &&
    typeof c.code === 'string' &&
    c.code.trim().length > 0 &&
    typeof c.name === 'string' &&
    c.name.trim().length > 0
  );
}

function validarBolsaPedido(b) {
  return (
    ehObjetoSimples(b) &&
    typeof b.scholarship_id === 'string' &&
    b.scholarship_id.trim().length > 0 &&
    typeof b.project_id === 'string' &&
    b.project_id.trim().length > 0 &&
    typeof b.code === 'string' &&
    b.code.trim().length > 0 &&
    numeroFinitoEstrito(b.valor) &&
    validarDataIso(b.inicio) &&
    validarDataIso(b.fim) &&
    ['active', 'ended', 'cancelled'].includes(b.status) &&
    typeof b.vigente_hoje === 'boolean'
  );
}

function validarBolsistaPedido(p) {
  return (
    ehObjetoSimples(p) &&
    typeof p.holder_id === 'string' &&
    p.holder_id.trim().length > 0 &&
    typeof p.nome === 'string' &&
    p.nome.trim().length > 0 &&
    validarEquipe(p.equipe) &&
    numeroFinitoEstrito(p.valor_vigente) &&
    Array.isArray(p.bolsas) &&
    p.bolsas.every(validarBolsaPedido)
  );
}

function validarItemDaCaixa(i) {
  return (
    ehObjetoSimples(i) &&
    typeof i.holder_id === 'string' &&
    i.holder_id.trim().length > 0 &&
    (i.valor_mensal === null ||
      i.valor_mensal === undefined ||
      (numeroFinitoEstrito(i.valor_mensal) && Number(i.valor_mensal) > 0)) &&
    numeroFinitoEstrito(i.valor_usado) &&
    (i.nota === null || i.nota === undefined || typeof i.nota === 'string')
  );
}

export function validarCaixaPedido(c) {
  if (!ehObjetoSimples(c)) return false;
  if (typeof c.id !== 'string' || !c.id.trim()) return false;
  if (typeof c.nome !== 'string' || !c.nome.trim() || c.nome.trim().length > 80) return false;
  if (!Number.isInteger(c.meses) || c.meses < 1 || c.meses > 60) return false;
  if (typeof c.criado_em !== 'string') return false;
  if (!Number.isInteger(c.pessoas) || c.pessoas < 0) return false;
  if (!numeroFinitoEstrito(c.total_mensal) || !numeroFinitoEstrito(c.total_periodo)) return false;
  if (!Number.isInteger(c.itens_ocultos) || c.itens_ocultos < 0) return false;
  if (!Array.isArray(c.itens) || !c.itens.every(validarItemDaCaixa)) return false;

  // Conferência (não exibição): as contas vêm prontas da RPC, mas precisam
  // fechar com os itens. Tolerância de meio centavo para o arredondamento.
  const perto = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.005;
  const somaItens = c.itens.reduce((soma, item) => soma + Number(item.valor_usado), 0);
  return (
    c.pessoas === c.itens.length &&
    perto(c.total_mensal, somaItens) &&
    perto(c.total_periodo, Number(c.total_mensal) * c.meses)
  );
}

export function validarPedidoBolsas(d) {
  return (
    ehObjetoSimples(d) &&
    Array.isArray(d.centros) &&
    d.centros.every(validarCentroPedido) &&
    Array.isArray(d.bolsistas) &&
    d.bolsistas.every(validarBolsistaPedido) &&
    Array.isArray(d.caixas) &&
    d.caixas.every(validarCaixaPedido)
  );
}

export async function explicarLivre(projectId) {
  if (!projectId) {
    return { dados: null, erro: 'Centro de custo não informado.' };
  }
  const opcoes = { validar: validarArvoreExplicacao };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.explicarLivre(projectId),
          'Não foi possível carregar a origem do saldo livre.',
          opcoes
        );
  }
  return chamarRpc(
    'explicar_livre_v2',
    { p_project_id: projectId },
    'Não foi possível carregar a origem do saldo livre.',
    opcoes
  );
}

export async function origem(ref) {
  if (!ref || typeof ref !== 'object' || !ref.alvo_tabela || !ref.alvo_id || !ref.campo) {
    return { dados: null, erro: 'Referência de origem incompleta.' };
  }
  const opcoes = { validar: validarOrigem };
  const ex = await carregarExemplo();
  if (ex) {
    return ex.erro
      ? { dados: null, erro: ex.erro }
      : responderExemplo(
          () => ex.modulo.origem(ref),
          'Não foi possível consultar a origem deste valor.',
          opcoes
        );
  }
  return chamarRpc(
    'get_origem_v2',
    {
      p_alvo_tabela: ref.alvo_tabela,
      p_alvo_id: ref.alvo_id,
      p_campo: ref.campo,
    },
    'Não foi possível consultar a origem deste valor.',
    opcoes
  );
}

export async function arquivoDeOrigem(documento) {
  if (!documento || typeof documento !== 'object' || !documento.bucket || !documento.caminho) {
    return { dados: null, erro: 'Arquivo de origem não informado.' };
  }
  const ex = await carregarExemplo();
  if (ex) {
    if (ex.erro) return { dados: null, erro: ex.erro };
    try {
      const res = await ex.modulo.arquivoDeOrigem(documento);
      if (!res || res.erro) {
        return { dados: null, erro: res?.erro || 'Não foi possível baixar o arquivo de origem.' };
      }
      const okBuffer =
        res.dados instanceof ArrayBuffer
          ? res.dados.byteLength > 0
          : ArrayBuffer.isView(res.dados) && res.dados.byteLength > 0;
      if (!okBuffer) {
        return { dados: null, erro: 'O arquivo de origem veio vazio.' };
      }
      return { dados: res.dados, erro: null };
    } catch {
      return { dados: null, erro: 'Não foi possível baixar o arquivo de origem.' };
    }
  }
  try {
    const { data, error } = await supabase.storage
      .from(documento.bucket)
      .createSignedUrl(documento.caminho, 300);

    if (error || !data?.signedUrl) {
      return { dados: null, erro: 'Não foi possível obter acesso ao arquivo de origem.' };
    }

    const resposta = await fetch(data.signedUrl);
    if (!resposta.ok) {
      return {
        dados: null,
        erro: `Não foi possível baixar o arquivo de origem (HTTP ${resposta.status}).`,
      };
    }

    const buffer = await resposta.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) {
      return { dados: null, erro: 'O arquivo de origem veio vazio.' };
    }

    return { dados: buffer, erro: null };
  } catch {
    return { dados: null, erro: 'Não foi possível baixar o arquivo de origem.' };
  }
}
