/* ============================================================
   executar.mjs
   Orquestração do backfill da F2-B.

   A rede é injetada (`cliente`), então o mesmo fluxo roda contra o
   Supabase (cliente.mjs) ou contra o pglite nos testes. Nada aqui
   imprime: `executarBackfill` devolve o detalhe; `formatarSaidaTerminal`
   é a única função que monta texto para o terminal e só usa
   contagens/códigos/id — nunca trecho, nome, CPF ou valor.
   ============================================================ */

import { mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAMPOS_BALANCETE,
  alvoDaRubrica,
  alvoDoCabecalho,
  alvoDoDesembolso,
  alvoDoLancamento,
  alvoDoTotalPlano,
  alvosAlternativosDaRubrica,
  contaComReduzido,
  escolherLinhaComAlternativas,
  montarFato,
  valorLidoDoTrecho,
} from './alvo.mjs';
import { temCpf, temCpfLargo064 } from './cpf.mjs';
import { detectarFormato, lerDocumento, sha256 } from './documento.mjs';
import { ErroFatal, ErroUso } from './erros.mjs';

export const VERSAO = '1.0.0';
export const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const BUCKETS = {
  balancete: 'balancete-pdfs',
  plano: 'plano-trabalho-docs',
};

function numero(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const n = Number(String(valor).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dataISO(valor) {
  if (valor == null) return null;
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  }
  const texto = String(valor);
  const achado = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return achado ? `${achado[1]}-${achado[2]}-${achado[3]}` : null;
}

function valoresIguais(a, b) {
  const x = numero(a);
  const y = numero(b);
  return x != null && y != null && Math.abs(x - y) < 0.005;
}

function tituloDoBalancete(data) {
  if (!data) return 'Balancete';
  const [ano, mes] = data.split('-');
  const indice = Number(mes) - 1;
  if (!MESES[indice]) return 'Balancete';
  return `Balancete de ${MESES[indice]}/${ano.slice(-2)}`;
}

function tituloDoPlano(versao) {
  return `Plano de trabalho v${versao == null ? '0' : versao}`;
}

function nomeDoArquivo(caminho, arquivoNome) {
  const nome = String(arquivoNome == null ? '' : arquivoNome).trim();
  if (nome) return nome;
  const partes = String(caminho).split('/');
  const ultimo = partes[partes.length - 1];
  return ultimo ? ultimo : null;
}

function caminhoValido(caminho, projectId) {
  if (typeof caminho !== 'string' || caminho !== caminho.trim() || !caminho) return false;
  if (caminho.includes('\\') || caminho.includes('\0')) return false;
  const partes = caminho.split('/');
  if (partes.some((parte) => parte === '..')) return false;
  if (partes.length < 2) return false;
  if (partes[0] !== String(projectId)) return false;
  return Boolean(partes.slice(1).join('/'));
}

/**
 * A lista de lançamentos do `raw_extraction`. O banco tem os dois
 * formatos: `{ lancamentos: [...] }` e `{ data: { lancamentos: [...] } }`;
 * o guarda de forma aceita os dois (e só os dois).
 */
function listaDeLancamentos(raw) {
  try {
    const objeto = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!objeto || typeof objeto !== 'object') return null;
    if (Array.isArray(objeto.lancamentos)) return objeto.lancamentos;
    if (objeto.data && typeof objeto.data === 'object' && Array.isArray(objeto.data.lancamentos)) {
      return objeto.data.lancamentos;
    }
    return null;
  } catch {
    return null;
  }
}

/** Quantos lançamentos o `raw_extraction` diz que existem. */
export function lancamentosEsperados(raw) {
  const lista = listaDeLancamentos(raw);
  return lista ? lista.length : 0;
}

/**
 * Mapa `conta_codigo → conta_reduzido` do `raw_extraction` (4ª rodada).
 * É a matéria-prima do alvo alternativo para o código que o PDF corta.
 * Conta com reduzido vazio, ou que apareça com dois reduzidos, fica
 * fora do mapa: não há alternativa confiável para ela.
 */
export function reduzidosPorConta(raw) {
  const mapa = new Map();
  const suspeitas = new Set();

  for (const item of listaDeLancamentos(raw) || []) {
    if (!item || typeof item !== 'object') continue;
    const conta = String(item.conta_codigo == null ? '' : item.conta_codigo).trim();
    // Código já no formato `<prefixo>#<reduzido>` não tem como ter
    // prefixo de cinco segmentos.
    if (!conta || conta.includes('#')) continue;
    const reduzido = String(item.conta_reduzido == null ? '' : item.conta_reduzido).trim();
    if (!reduzido) {
      suspeitas.add(conta);
      continue;
    }
    if (mapa.has(conta) && mapa.get(conta) !== reduzido) suspeitas.add(conta);
    else mapa.set(conta, reduzido);
  }

  for (const conta of suspeitas) mapa.delete(conta);
  return mapa;
}

function concatenar({ camRel, titulo, arquivoNome, fatos }) {
  const partes = [camRel, titulo, arquivoNome, ...fatos.map((fato) => fato.trecho)];
  return partes
    .filter((parte) => parte != null)
    .map((parte) => String(parte))
    .join(' ');
}

function menorPrefixoSujo(base, fatos) {
  let baixo = 1;
  let alto = fatos.length;
  let achado = null;

  while (baixo <= alto) {
    const meio = Math.floor((baixo + alto) / 2);
    if (temCpf(concatenar({ ...base, fatos: fatos.slice(0, meio) }))) {
      achado = meio;
      alto = meio - 1;
    } else {
      baixo = meio + 1;
    }
  }

  return achado;
}

/**
 * Remove os fatos envolvidos quando a concatenação na ordem da RPC
 * (caminho relativo, título, arquivo e trechos) forma um CPF. A
 * bissecção acha o menor prefixo sujo; o fato que fecha o prefixo é
 * o envolvido. Repete até a concatenação ficar limpa.
 */
export function removerFatosComCpf({ camRel, titulo, arquivoNome, fatos }) {
  const base = { camRel, titulo, arquivoNome };
  let restantes = fatos.slice();
  const removidos = [];

  while (restantes.length && temCpf(concatenar({ ...base, fatos: restantes }))) {
    const prefixo = menorPrefixoSujo(base, restantes);
    if (!prefixo) break;
    removidos.push(restantes[prefixo - 1]);
    restantes = restantes.slice(0, prefixo - 1).concat(restantes.slice(prefixo));
  }

  return { fatos: restantes, removidos };
}

export function motivoRecusa(erro) {
  const mensagem = String((erro && (erro.message || erro)) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (mensagem.includes('cpf')) return 'cpf';
  if (mensagem.includes('divergem') || mensagem.includes('divergencia')) return 'divergencia';
  if (mensagem.includes('ambigua')) return 'ambigua';
  if (mensagem.includes('duplicado')) return 'duplicado';
  return 'outro';
}

function somarMotivo(detalhe, motivo) {
  detalhe.motivos[motivo] = (detalhe.motivos[motivo] || 0) + 1;
}

function candidatosDoBalancete(balancete, lancamentos, reduzidos = new Map()) {
  const candidatos = [];

  for (const campo of CAMPOS_BALANCETE) {
    const valor = numero(balancete[campo]);
    candidatos.push({
      alvoTabela: 'balancetes',
      alvoId: String(balancete.id),
      campo,
      valor,
      alvo: alvoDoCabecalho(campo, valor),
      paiId: String(balancete.id),
      chaveEstavel: '',
    });
  }

  const ordenados = lancamentos.slice().sort((a, b) => (
    String(a.conta_codigo).localeCompare(String(b.conta_codigo))
    || String(a.id).localeCompare(String(b.id))
  ));
  for (const lancamento of ordenados) {
    if (!String(lancamento.rubrica_code == null ? '' : lancamento.rubrica_code).trim()) continue;
    const valor = numero(lancamento.saldo_atual);
    const conta = String(lancamento.conta_codigo == null ? '' : lancamento.conta_codigo).trim();
    const reduzido = reduzidos.get(conta);
    const contaAlternativa = reduzido ? contaComReduzido(conta, reduzido) : null;
    candidatos.push({
      alvoTabela: 'balancete_lancamentos',
      alvoId: String(lancamento.id),
      campo: 'saldo_atual',
      valor,
      alvo: alvoDoLancamento({ ...lancamento, saldo_atual: valor }),
      // 4ª rodada: só entra quando o código completo não acha nenhuma
      // linha. `contagemAlternativa` marca o fato como achado pelo
      // reduzido para a contagem `por_reduzido`.
      alternativas: contaAlternativa ? [{ conta_codigo: contaAlternativa, valor }] : [],
      contagemAlternativa: 'por_reduzido',
      paiId: String(lancamento.balancete_id),
      chaveEstavel: String(lancamento.conta_codigo),
    });
  }

  return candidatos;
}

function chaveDaRubrica(rubrica) {
  return `${rubrica.rubrica_code}|${rubrica.descricao_livre == null ? '' : rubrica.descricao_livre}`;
}

function chaveUnicaDoFato(fato) {
  return `${fato.alvo_tabela}|${fato.alvo_id}|${fato.campo}`;
}

function candidatosDoPlano(plano, rubricas, desembolsos, nomesRubricas) {
  const candidatos = [];

  const total = numero(plano.valor_total_plano);
  candidatos.push({
    alvoTabela: 'planos_trabalho',
    alvoId: String(plano.id),
    campo: 'valor_total_plano',
    valor: total,
    alvo: alvoDoTotalPlano(total),
    paiId: String(plano.id),
    chaveEstavel: '',
  });

  const grupos = new Map();
  for (const rubrica of rubricas) {
    const chave = chaveDaRubrica(rubrica);
    if (!grupos.has(chave)) grupos.set(chave, 0);
    grupos.set(chave, grupos.get(chave) + 1);
  }

  const ordenadas = rubricas.slice().sort((a, b) => (
    String(a.rubrica_code).localeCompare(String(b.rubrica_code))
    || String(a.descricao_livre == null ? '' : a.descricao_livre).localeCompare(String(b.descricao_livre == null ? '' : b.descricao_livre))
    || String(a.id).localeCompare(String(b.id))
  ));
  for (const rubrica of ordenadas) {
    const valor = numero(rubrica.valor_previsto);
    if ((grupos.get(chaveDaRubrica(rubrica)) || 0) > 1) {
      candidatos.push({
        alvoTabela: 'plano_rubricas',
        alvoId: String(rubrica.id),
        campo: 'valor_previsto',
        valor,
        alvo: null,
        paiId: String(rubrica.plano_id),
        chaveEstavel: chaveDaRubrica(rubrica),
        ambiguo: true,
        motivo: 'rubrica_ambigua',
      });
      continue;
    }
    const nome = nomesRubricas.get(String(rubrica.rubrica_code)) || String(rubrica.rubrica_code);
    // 4ª rodada: sinônimos fixos (cip_ufg, cip_ua, dao) só quando a
    // rubrica não tem descrição livre; o nome do catálogo é tentado antes.
    const alternativas = alvosAlternativosDaRubrica({ ...rubrica, valor_previsto: valor });
    candidatos.push({
      alvoTabela: 'plano_rubricas',
      alvoId: String(rubrica.id),
      campo: 'valor_previsto',
      valor,
      alvo: alvoDaRubrica({ ...rubrica, valor_previsto: valor }, nome),
      alternativas,
      contagemAlternativa: null,
      paiId: String(rubrica.plano_id),
      chaveEstavel: chaveDaRubrica(rubrica),
    });
  }

  const desembolsosOrdenados = desembolsos.slice().sort((a, b) => (
    Number(a.parcela) - Number(b.parcela) || String(a.id).localeCompare(String(b.id))
  ));
  for (const desembolso of desembolsosOrdenados) {
    const valor = numero(desembolso.valor);
    candidatos.push({
      alvoTabela: 'plano_desembolsos',
      alvoId: String(desembolso.id),
      campo: 'valor',
      valor,
      alvo: alvoDoDesembolso({ ...desembolso, valor }),
      paiId: String(desembolso.plano_id),
      chaveEstavel: String(desembolso.parcela),
    });
  }

  return candidatos;
}

function alvoLocalValido(doc, candidato) {
  if (doc.tipo === 'balancete') {
    if (candidato.alvoTabela === 'balancetes') {
      return candidato.alvoId === String(doc.balancete.id);
    }
    if (candidato.alvoTabela === 'balancete_lancamentos') {
      return candidato.paiId === String(doc.balancete.id);
    }
    return false;
  }

  if (doc.tipo === 'plano') {
    if (candidato.alvoTabela === 'planos_trabalho') {
      return candidato.alvoId === String(doc.plano.id);
    }
    if (candidato.alvoTabela === 'plano_rubricas' || candidato.alvoTabela === 'plano_desembolsos') {
      return candidato.paiId === String(doc.plano.id);
    }
    return false;
  }

  return false;
}

function novoDetalhe(doc, projeto, titulo, arquivoNome, caminho) {
  return {
    tipo: doc.tipo,
    id: String(doc.id),
    chave: doc.chave,
    project_code: projeto.code,
    project_id: String(projeto.id),
    data_referencia: doc.data || null,
    versao: doc.versao == null ? null : Number(doc.versao),
    titulo,
    arquivo_nome: arquivoNome,
    caminho,
    formato: null,
    paginas: null,
    sha256: null,
    status: 'simulado',
    motivo: null,
    contagens: {
      achados: 0,
      nao_achados: 0,
      ambiguos: 0,
      com_cpf: 0,
      zeros: 0,
      sem_valor: 0,
      divergencias: 0,
      duplicados: 0,
      recusados: 0,
      por_reduzido: 0,
    },
    motivos: {},
    fatos: [],
    removidos: [],
    fatos_ignorados: 0,
  };
}

async function processarDocumento({
  doc,
  cliente,
  aplicar,
  mapaDocumentos,
  versoesPorDocumento,
  lancamentosPorBalancete,
  rubricasPorPlano,
  desembolsosPorPlano,
  nomesRubricas,
}) {
  const projeto = doc.projeto;
  const caminho = String(doc.caminho);
  const arquivoNome = nomeDoArquivo(caminho, doc.arquivo_nome);
  const existente = mapaDocumentos.get(doc.chave) || null;
  const titulo = (existente && existente.titulo) || doc.tituloPadrao;
  const detalhe = novoDetalhe(doc, projeto, titulo, arquivoNome, caminho);

  const lancamentos = doc.tipo === 'balancete'
    ? (lancamentosPorBalancete.get(String(doc.balancete.id)) || [])
    : [];
  const rubricas = doc.tipo === 'plano'
    ? (rubricasPorPlano.get(String(doc.plano.id)) || [])
    : [];
  const desembolsos = doc.tipo === 'plano'
    ? (desembolsosPorPlano.get(String(doc.plano.id)) || [])
    : [];

  // Balancete cujo raw_extraction indica mais lançamentos do que a
  // tabela tem: recusa SÓ este documento e segue (a 064 também diria
  // que falta dado; gravar menos fatos passaria por leitura completa).
  // O raw_extraction é buscado agora, por balancete, não na listagem.
  // Dele também sai o mapa conta → reduzido usado no código cortado.
  let reduzidos = new Map();
  if (doc.tipo === 'balancete') {
    const raw = await cliente.lerRawExtraction(doc.balancete.id);
    const esperado = lancamentosEsperados(raw);
    if (esperado > 0 && lancamentos.length < esperado) {
      detalhe.status = 'recusado';
      detalhe.motivo = 'lancamentos_inconsistentes';
      return detalhe;
    }
    reduzidos = reduzidosPorConta(raw);
  }

  // CPF no nome vem antes da validação de caminho: a recusa é por CPF,
  // não por formato de chave.
  const camRel = caminho.includes('/') ? caminho.slice(caminho.indexOf('/') + 1) : caminho;
  const metadados = [camRel, titulo, arquivoNome].filter((parte) => parte != null && parte !== '');
  if (temCpf(caminho) || metadados.some((parte) => temCpf(parte)) || temCpf(metadados.join(' '))) {
    detalhe.status = 'recusado';
    detalhe.motivo = 'cpf_no_nome';
    return detalhe;
  }

  if (!caminhoValido(caminho, projeto.id)) {
    detalhe.status = 'recusado';
    detalhe.motivo = 'caminho';
    return detalhe;
  }

  let bytes;
  try {
    bytes = await cliente.baixarArquivo(doc.bucket, caminho);
  } catch (erro) {
    if (erro instanceof ErroFatal) throw erro;
    detalhe.status = 'recusado';
    detalhe.motivo = 'arquivo';
    return detalhe;
  }

  let formato;
  try {
    formato = detectarFormato(caminho, bytes, doc.tipo);
  } catch {
    detalhe.status = 'recusado';
    detalhe.motivo = 'formato';
    return detalhe;
  }
  detalhe.formato = formato;

  let paginas;
  let totalPaginas;
  try {
    const lido = await lerDocumento(bytes, formato);
    paginas = lido.paginas;
    totalPaginas = lido.totalPaginas;
  } catch {
    detalhe.status = 'recusado';
    detalhe.motivo = 'leitura';
    return detalhe;
  }
  detalhe.paginas = totalPaginas;
  detalhe.sha256 = sha256(bytes);

  const candidatos = doc.tipo === 'balancete'
    ? candidatosDoBalancete(doc.balancete, lancamentos, reduzidos)
    : candidatosDoPlano(doc.plano, rubricas, desembolsos, nomesRubricas);

  const fatos = [];
  const vistos = new Set();
  const chavesPorReduzido = new Set();

  for (const candidato of candidatos) {
    if (!alvoLocalValido(doc, candidato)) {
      detalhe.contagens.recusados += 1;
      somarMotivo(detalhe, 'alvo');
      continue;
    }

    // Número nulo no banco não vira fato; só entra na contagem própria
    // para o resumo dizer quanto ficou de fora sem valor.
    if (candidato.valor == null) {
      detalhe.contagens.sem_valor += 1;
      somarMotivo(detalhe, 'sem_valor');
      continue;
    }

    if (candidato.ambiguo) {
      detalhe.contagens.ambiguos += 1;
      somarMotivo(detalhe, candidato.motivo || 'ambiguo');
      continue;
    }

    if (candidato.valor === 0) {
      detalhe.contagens.zeros += 1;
      continue;
    }

    // Código completo primeiro; só quando ele não acha nenhuma linha
    // entram as alternativas (reduzido cortado ou sinônimo de rubrica).
    const { selecao, alternativa } = escolherLinhaComAlternativas(
      paginas,
      candidato.alvo,
      candidato.alternativas || [],
    );
    if (selecao.status === 'zero') {
      detalhe.contagens.zeros += 1;
      continue;
    }
    if (selecao.status === 'sem_valor') {
      detalhe.contagens.sem_valor += 1;
      somarMotivo(detalhe, 'sem_valor');
      continue;
    }
    if (selecao.status === 'nao_achado') {
      detalhe.contagens.nao_achados += 1;
      somarMotivo(detalhe, 'nao_achado');
      continue;
    }
    if (selecao.status === 'corte') {
      detalhe.contagens.nao_achados += 1;
      somarMotivo(detalhe, 'corte_500');
      continue;
    }
    if (selecao.status === 'ambiguo') {
      detalhe.contagens.ambiguos += 1;
      somarMotivo(detalhe, 'ambiguo');
      continue;
    }
    if (selecao.status !== 'achado') {
      detalhe.contagens.recusados += 1;
      somarMotivo(detalhe, 'selecao');
      continue;
    }

    const fato = montarFato({
      alvoTabela: candidato.alvoTabela,
      alvoId: candidato.alvoId,
      campo: candidato.campo,
      valor: candidato.valor,
      formato,
      selecao,
    });
    if (!fato) {
      detalhe.contagens.recusados += 1;
      somarMotivo(detalhe, 'fato');
      continue;
    }

    // Pré-validação da correção 7: o número é extraído do TRECHO (o
    // texto como o documento imprime), não comparado com ele mesmo.
    const valorLido = valorLidoDoTrecho(fato.trecho, fato.valor);
    if (valorLido == null || !valoresIguais(fato.valor, valorLido)) {
      detalhe.contagens.recusados += 1;
      detalhe.contagens.divergencias += 1;
      somarMotivo(detalhe, 'divergencia');
      continue;
    }

    if (temCpf(fato.trecho)) {
      detalhe.contagens.com_cpf += 1;
      somarMotivo(detalhe, 'cpf');
      continue;
    }

    const chaveFato = `${fato.alvo_tabela}|${candidato.paiId}|${candidato.chaveEstavel}|${fato.campo}`;
    if (vistos.has(chaveFato)) {
      detalhe.contagens.duplicados += 1;
      somarMotivo(detalhe, 'duplicado');
      continue;
    }
    vistos.add(chaveFato);
    fatos.push(fato);
    if (alternativa != null && candidato.contagemAlternativa) {
      chavesPorReduzido.add(chaveUnicaDoFato(fato));
    }
  }

  const limpeza = removerFatosComCpf({ camRel, titulo, arquivoNome, fatos });
  if (temCpf(concatenar({ camRel, titulo, arquivoNome, fatos: limpeza.fatos }))) {
    detalhe.status = 'recusado';
    detalhe.motivo = 'cpf';
    return detalhe;
  }

  for (const removido of limpeza.removidos) {
    detalhe.removidos.push({
      alvo_tabela: removido.alvo_tabela,
      alvo_id: removido.alvo_id,
      campo: removido.campo,
      motivo: 'cpf_particionado',
    });
  }
  detalhe.contagens.com_cpf += limpeza.removidos.length;

  const fatosFinal = limpeza.fatos;
  detalhe.contagens.achados = fatosFinal.length;
  detalhe.contagens.por_reduzido = fatosFinal
    .filter((fato) => chavesPorReduzido.has(chaveUnicaDoFato(fato))).length;
  detalhe.fatos = fatosFinal;

  // Nunca registrar documento com zero fatos: não chama a RPC nem em
  // aplicação. Vale também depois da retentativa por CPF.
  if (fatosFinal.length === 0) {
    detalhe.status = 'sem_fatos';
    return detalhe;
  }

  const payload = {
    project_id: String(projeto.id),
    tipo: doc.tipo,
    chave: doc.chave,
    titulo,
    sha256: detalhe.sha256,
    bucket: doc.bucket,
    caminho,
    arquivo_nome: arquivoNome,
    formato,
    paginas: totalPaginas,
    parser: 'backfill-acharAlvo',
    parser_versao: VERSAO,
    origem: 'backfill',
    fatos: fatosFinal,
  };

  if (!aplicar) {
    const versoes = (existente && versoesPorDocumento.get(String(existente.id))) || new Set();
    if (existente && versoes.has(detalhe.sha256)) {
      detalhe.status = 'ja_registrado';
      detalhe.fatos_ignorados = fatosFinal.length;
    } else {
      detalhe.status = 'simulado';
    }
    return detalhe;
  }

  try {
    const resultado = await cliente.registrarDocumento(payload);
    if (resultado && resultado.criada === false) {
      detalhe.status = 'ja_registrado';
      detalhe.fatos_ignorados = fatosFinal.length;
      detalhe.versao = resultado.versao == null ? detalhe.versao : Number(resultado.versao);
    } else {
      detalhe.status = 'aplicado';
      if (resultado && resultado.versao != null) detalhe.versao = Number(resultado.versao);
    }
    return detalhe;
  } catch (erro) {
    if (erro instanceof ErroFatal) throw erro;
    const motivo = motivoRecusa(erro);
    if (motivo !== 'cpf') {
      detalhe.status = 'recusado';
      detalhe.motivo = motivo;
      somarMotivo(detalhe, motivo);
      return detalhe;
    }

    // CPF: tira os fatos suspeitos e tenta UMA vez de novo. Sem
    // suspeito não há o que tirar: pula o documento sem segunda
    // chamada (a regra da 064 acusou algo que a nossa não vê).
    const suspeitos = fatosFinal.filter((fato) => temCpfLargo064(fato.trecho));
    if (!suspeitos.length) {
      detalhe.status = 'recusado';
      detalhe.motivo = 'cpf';
      somarMotivo(detalhe, 'cpf');
      return detalhe;
    }

    const restantes = fatosFinal.filter((fato) => !suspeitos.includes(fato));
    const nova = removerFatosComCpf({ camRel, titulo, arquivoNome, fatos: restantes });

    for (const removido of suspeitos) {
      detalhe.removidos.push({
        alvo_tabela: removido.alvo_tabela,
        alvo_id: removido.alvo_id,
        campo: removido.campo,
        motivo: 'cpf_rpc',
      });
    }
    for (const removido of nova.removidos) {
      detalhe.removidos.push({
        alvo_tabela: removido.alvo_tabela,
        alvo_id: removido.alvo_id,
        campo: removido.campo,
        motivo: 'cpf_particionado',
      });
    }
    detalhe.contagens.com_cpf += suspeitos.length + nova.removidos.length;

    if (temCpf(concatenar({ camRel, titulo, arquivoNome, fatos: nova.fatos }))) {
      detalhe.status = 'recusado';
      detalhe.motivo = 'cpf';
      somarMotivo(detalhe, 'cpf');
      return detalhe;
    }

    detalhe.contagens.achados = nova.fatos.length;
    detalhe.contagens.por_reduzido = nova.fatos
      .filter((fato) => chavesPorReduzido.has(chaveUnicaDoFato(fato))).length;
    detalhe.fatos = nova.fatos;

    if (nova.fatos.length === 0) {
      detalhe.status = 'sem_fatos';
      return detalhe;
    }

    try {
      const segundo = await cliente.registrarDocumento({ ...payload, fatos: nova.fatos });
      if (segundo && segundo.criada === false) {
        detalhe.status = 'ja_registrado';
        detalhe.fatos_ignorados = nova.fatos.length;
        detalhe.versao = segundo.versao == null ? detalhe.versao : Number(segundo.versao);
      } else {
        detalhe.status = 'aplicado';
        if (segundo && segundo.versao != null) detalhe.versao = Number(segundo.versao);
      }
      detalhe.retentativa_cpf = true;
    } catch (erro2) {
      if (erro2 instanceof ErroFatal) throw erro2;
      detalhe.status = 'recusado';
      detalhe.motivo = motivoRecusa(erro2);
      somarMotivo(detalhe, detalhe.motivo);
    }
    return detalhe;
  }
}

function resumir(detalhes) {
  const resumo = {
    documentos: detalhes.length,
    achados: 0,
    nao_achados: 0,
    ambiguos: 0,
    com_cpf: 0,
    zeros: 0,
    sem_valor: 0,
    divergencias: 0,
    duplicados: 0,
    recusados: 0,
    por_reduzido: 0,
    documentos_recusados: 0,
    ja_registrados: 0,
    aplicados: 0,
    simulados: 0,
    sem_fatos: 0,
  };

  for (const detalhe of detalhes) {
    for (const chave of [
      'achados', 'nao_achados', 'ambiguos', 'com_cpf', 'zeros', 'sem_valor',
      'divergencias', 'duplicados', 'recusados', 'por_reduzido',
    ]) {
      resumo[chave] += detalhe.contagens[chave] || 0;
    }
    if (detalhe.status === 'recusado') resumo.documentos_recusados += 1;
    if (detalhe.status === 'ja_registrado') resumo.ja_registrados += 1;
    if (detalhe.status === 'aplicado') resumo.aplicados += 1;
    if (detalhe.status === 'simulado') resumo.simulados += 1;
    if (detalhe.status === 'sem_fatos') resumo.sem_fatos += 1;
  }

  return resumo;
}

function agruparPorCentro(detalhes) {
  const mapa = new Map();
  for (const detalhe of detalhes) {
    const codigo = detalhe.project_code == null || detalhe.project_code === ''
      ? '(sem código)'
      : String(detalhe.project_code);
    if (!mapa.has(codigo)) mapa.set(codigo, { codigo, documentos: [] });
    mapa.get(codigo).documentos.push(detalhe);
  }
  return [...mapa.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/**
 * Executa o escopo inteiro. `cliente` é a interface de alto nível
 * (cliente.mjs no Supabase, um adaptador pglite nos testes).
 */
export async function executarBackfill({ cliente, opcoes = {}, geradoEm = new Date() } = {}) {
  if (!cliente) throw new ErroUso('Cliente de dados não informado.');

  const aplicar = Boolean(opcoes.aplicar);
  const ano = Number.isInteger(opcoes.ano) ? opcoes.ano : new Date().getFullYear();
  const centro = opcoes.centro == null ? null : String(opcoes.centro).trim();
  if (opcoes.centro != null && !centro) throw new ErroUso('--centro não pode ser vazio.');

  // 1. Papel ANTES de qualquer leitura de dados.
  const papel = await cliente.lerPapel();
  if (papel !== 'admin') {
    throw new ErroFatal('O backfill exige login de admin humano (papel lido em app_users).');
  }

  // 2. Projetos ativos e filtro de centro.
  let projetos = (await cliente.lerProjetosAtivos()) || [];
  projetos = projetos.map((projeto) => ({
    ...projeto,
    id: String(projeto.id),
    code: projeto.code == null ? null : String(projeto.code),
  }));

  if (centro) {
    const filtrados = projetos.filter((projeto) => projeto.code === centro);
    if (filtrados.length !== 1) {
      throw new ErroFatal(`--centro ${centro} não encontrou exatamente um projeto ativo (achei ${filtrados.length}).`);
    }
    projetos = filtrados;
  }

  const projetosPorId = new Map(projetos.map((projeto) => [projeto.id, projeto]));
  const projectIds = projetos.map((projeto) => projeto.id);

  if (!projectIds.length) {
    return {
      gerado_em: geradoEm.toISOString(),
      modo: aplicar ? 'aplicacao' : 'simulacao',
      papel,
      ano,
      centro,
      versao_backfill: VERSAO,
      resumo: resumir([]),
      centros: [],
    };
  }

  // 3. Balancetes do ano e plano ativo de cada projeto.
  const [balancetesBrutos, planosBrutos] = await Promise.all([
    cliente.lerBalancetesDoAno(projectIds, ano),
    cliente.lerPlanosAtivos(projectIds),
  ]);

  const balancetes = (balancetesBrutos || [])
    .filter((balancete) => projetosPorId.has(String(balancete.project_id)))
    .map((balancete) => ({
      ...balancete,
      id: String(balancete.id),
      project_id: String(balancete.project_id),
    }))
    .filter((balancete) => {
      const data = dataISO(balancete.data_referencia);
      return Boolean(data && data.startsWith(`${ano}-`) && String(balancete.arquivo_storage_path || '').trim());
    });

  const planosPorProjeto = new Map();
  for (const plano of planosBrutos || []) {
    if (!projetosPorId.has(String(plano.project_id))) continue;
    if (plano.ativo === false) continue;
    if (!String(plano.arquivo_storage_path || '').trim()) continue;
    const atual = planosPorProjeto.get(String(plano.project_id));
    if (!atual || Number(plano.versao) > Number(atual.versao)) {
      planosPorProjeto.set(String(plano.project_id), {
        ...plano,
        id: String(plano.id),
        project_id: String(plano.project_id),
      });
    }
  }
  const planos = [...planosPorProjeto.values()];

  // 4. Lançamentos do balancete (todos, para conferir a tabela vazia).
  // Balancete com menos lançamentos que o raw_extraction indica é
  // recusado sozinho mais adiante (motivo `lancamentos_inconsistentes`);
  // o raw_extraction é buscado por documento, não na listagem.
  const balanceteIds = balancetes.map((balancete) => balancete.id);
  const lancamentos = ((await cliente.lerLancamentos(balanceteIds)) || []).map((lancamento) => ({
    ...lancamento,
    id: String(lancamento.id),
    balancete_id: String(lancamento.balancete_id),
  }));

  const lancamentosPorBalancete = new Map();
  for (const lancamento of lancamentos) {
    if (!lancamentosPorBalancete.has(lancamento.balancete_id)) {
      lancamentosPorBalancete.set(lancamento.balancete_id, []);
    }
    lancamentosPorBalancete.get(lancamento.balancete_id).push(lancamento);
  }

  // 5. Rubricas, desembolsos e nomes de rubrica dos planos.
  const planoIds = planos.map((plano) => plano.id);
  const [rubricasBrutas, desembolsosBrutos, rubricasBase] = await Promise.all([
    cliente.lerRubricasDoPlano(planoIds),
    cliente.lerDesembolsos(planoIds),
    cliente.lerRubricas(),
  ]);

  const rubricasPorPlano = new Map();
  for (const rubrica of rubricasBrutas || []) {
    const planoId = String(rubrica.plano_id);
    if (!rubricasPorPlano.has(planoId)) rubricasPorPlano.set(planoId, []);
    rubricasPorPlano.get(planoId).push({ ...rubrica, id: String(rubrica.id), plano_id: planoId });
  }

  const desembolsosPorPlano = new Map();
  for (const desembolso of desembolsosBrutos || []) {
    const planoId = String(desembolso.plano_id);
    if (!desembolsosPorPlano.has(planoId)) desembolsosPorPlano.set(planoId, []);
    desembolsosPorPlano.get(planoId).push({ ...desembolso, id: String(desembolso.id), plano_id: planoId });
  }

  const nomesRubricas = new Map();
  for (const rubrica of rubricasBase || []) {
    nomesRubricas.set(String(rubrica.code), rubrica.name == null ? '' : String(rubrica.name));
  }

  // 6. Descritores dos documentos.
  const documentos = [];
  for (const balancete of balancetes) {
    const projeto = projetosPorId.get(balancete.project_id);
    const data = dataISO(balancete.data_referencia);
    documentos.push({
      tipo: 'balancete',
      id: balancete.id,
      chave: `balancete:${balancete.project_id}:${data}`,
      projeto,
      balancete,
      data,
      versao: null,
      bucket: BUCKETS.balancete,
      caminho: balancete.arquivo_storage_path,
      arquivo_nome: balancete.arquivo_nome,
      tituloPadrao: tituloDoBalancete(data),
    });
  }
  for (const plano of planos) {
    const projeto = projetosPorId.get(plano.project_id);
    documentos.push({
      tipo: 'plano',
      id: plano.id,
      chave: `plano:${plano.project_id}:${plano.id}`,
      projeto,
      plano,
      data: null,
      versao: plano.versao,
      bucket: BUCKETS.plano,
      caminho: plano.arquivo_storage_path,
      arquivo_nome: plano.arquivo_nome,
      tituloPadrao: tituloDoPlano(plano.versao),
    });
  }
  documentos.sort((a, b) => (
    String(a.projeto.code || '').localeCompare(String(b.projeto.code || ''))
    || a.tipo.localeCompare(b.tipo)
    || String(a.data || '').localeCompare(String(b.data || ''))
    || Number(a.versao || 0) - Number(b.versao || 0)
    || a.id.localeCompare(b.id)
  ));

  // 7. Títulos já gravados e sha256 já registrados (simulação e aviso).
  const chaves = documentos.map((documento) => documento.chave);
  const documentosExistentes = (await cliente.lerDocumentos(chaves)) || [];
  const mapaDocumentos = new Map(
    documentosExistentes.map((documento) => [String(documento.chave), documento]),
  );
  const idsExistentes = [...mapaDocumentos.values()].map((documento) => String(documento.id));
  const versoesExistentes = (await cliente.lerVersoesExistentes(idsExistentes)) || [];
  const versoesPorDocumento = new Map();
  for (const versao of versoesExistentes) {
    const id = String(versao.documento_id);
    if (!versoesPorDocumento.has(id)) versoesPorDocumento.set(id, new Set());
    versoesPorDocumento.get(id).add(String(versao.sha256));
  }

  // 8. Um documento por vez.
  const detalhes = [];
  for (const documento of documentos) {
    const detalhe = await processarDocumento({
      doc: documento,
      cliente,
      aplicar,
      mapaDocumentos,
      versoesPorDocumento,
      lancamentosPorBalancete,
      rubricasPorPlano,
      desembolsosPorPlano,
      nomesRubricas,
    });
    detalhes.push(detalhe);
  }

  return {
    gerado_em: geradoEm.toISOString(),
    modo: aplicar ? 'aplicacao' : 'simulacao',
    papel,
    ano,
    centro,
    versao_backfill: VERSAO,
    resumo: resumir(detalhes),
    centros: agruparPorCentro(detalhes),
  };
}

/**
 * Texto do terminal: só contagens, códigos de centro, ids de documento
 * e datas/versões. Nunca trecho, título, arquivo, caminho, CPF ou valor.
 */
export function formatarSaidaTerminal(detalhe) {
  const linhas = [];
  const modo = detalhe.modo === 'aplicacao' ? 'aplicação' : 'simulação';
  linhas.push(`Backfill de rastreabilidade — ${modo}`);
  linhas.push(`Papel: ${detalhe.papel}`);
  linhas.push(`Ano: ${detalhe.ano}`);
  if (detalhe.centro) linhas.push(`Centro: ${detalhe.centro}`);
  linhas.push('');

  for (const centro of detalhe.centros || []) {
    linhas.push(`Centro ${centro.codigo} (${centro.documentos.length} documento(s))`);
    for (const documento of centro.documentos) {
      const identidade = documento.tipo === 'balancete'
        ? `balancete ${documento.data_referencia || '?'}`
        : `plano v${documento.versao == null ? '?' : documento.versao}`;
      const contagens = documento.contagens;
      let linha = `  ${identidade} [${documento.id}]: achados ${contagens.achados}, `
        + `nao_achados ${contagens.nao_achados}, ambiguos ${contagens.ambiguos}, `
        + `com_cpf ${contagens.com_cpf}, zeros ${contagens.zeros}, `
        + `sem_valor ${contagens.sem_valor}, divergencias ${contagens.divergencias}, `
        + `duplicados ${contagens.duplicados}, recusados ${contagens.recusados}, `
        + `por_reduzido ${contagens.por_reduzido || 0}`;

      if (documento.status === 'recusado') {
        linha += ` — RECUSADO (${documento.motivo || 'outro'})`;
      } else if (documento.status === 'sem_fatos') {
        linha += ' — sem fatos';
      } else if (documento.status === 'ja_registrado') {
        linha += ` — documento já registrado, ${documento.fatos_ignorados || 0} fatos novos ignorados`;
      } else if (documento.status === 'aplicado') {
        linha += ` — aplicado (v${documento.versao == null ? '?' : documento.versao})`;
      } else {
        linha += ' — simulado';
      }
      linhas.push(linha);
    }
  }

  const resumo = detalhe.resumo || {};
  linhas.push('');
  linhas.push(
    `Resumo: documentos ${resumo.documentos || 0}, achados ${resumo.achados || 0}, `
    + `nao_achados ${resumo.nao_achados || 0}, ambiguos ${resumo.ambiguos || 0}, `
    + `com_cpf ${resumo.com_cpf || 0}, zeros ${resumo.zeros || 0}, `
    + `sem_valor ${resumo.sem_valor || 0}, divergencias ${resumo.divergencias || 0}, `
    + `duplicados ${resumo.duplicados || 0}, por_reduzido ${resumo.por_reduzido || 0}, `
    + `documentos_recusados ${resumo.documentos_recusados || 0}, `
    + `sem_fatos ${resumo.sem_fatos || 0}, `
    + `ja_registrados ${resumo.ja_registrados || 0}`,
  );

  return linhas.join('\n');
}

/** Pasta padrão fora do repositório (temp do sistema). */
export function pastaSaidaPadrao() {
  return path.join(tmpdir(), 'cf-backfill-rastreabilidade');
}

/**
 * Resolve a pasta de saída e recusa qualquer caminho dentro do
 * worktree. No Windows a comparação não diferencia maiúsculas.
 */
export function validarPastaSaida(saida, raizRepo = RAIZ_REPO) {
  const normalizar = (caminho) => {
    const texto = process.platform === 'win32' ? caminho.toLowerCase() : caminho;
    return texto.replace(/[\\/]+$/, '');
  };
  const dentroDe = (caminho, raiz) => {
    const alvo = normalizar(caminho);
    const base = normalizar(raiz);
    return alvo === base || alvo.startsWith(`${base}${path.sep}`);
  };

  const raizLexical = path.resolve(raizRepo);
  const alvo = path.resolve(String(saida));

  // Primeiro a comparação lexical (pega o caso comum e a variação de
  // maiúsculas no Windows); depois a comparação real, que resolve symlink.
  if (dentroDe(alvo, raizLexical)) {
    throw new ErroUso('A pasta --saida tem de ficar fora do repositório.');
  }

  mkdirSync(alvo, { recursive: true });
  const alvoReal = realpathSync(alvo);
  const raizReal = realpathSync(raizLexical);

  if (dentroDe(alvoReal, raizReal)) {
    throw new ErroUso('A pasta --saida tem de ficar fora do repositório.');
  }

  return alvoReal;
}
