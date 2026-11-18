import { useCallback, useEffect, useState } from 'preact/hooks';
import { ExternalLink } from 'lucide-preact';
import { situacaoDasParcelas } from '../../../frontend/js/planejamento-dinheiro.js';
import {
  Abas,
  AvisoFalha,
  Botao,
  CabecalhoPagina,
  Cartao,
  Destaque,
  Esqueleto,
  GradeDestaques,
  PainelLateral,
  Situacao,
  Tabela,
  Valor,
  Vazio,
} from '../componentes/index.js';
import { urlProjeto } from '../roteador.js';
import {
  balancetes,
  pendencias,
  planos,
  repasses,
  resolverPendencia,
  saldoLivre,
} from '../servicos/dados.js';
import {
  dataCompacta,
  dinheiro,
  hojeISO,
  mesesRestantes,
  tempoRelativo,
} from '../util/formato.js';
import './Projeto.css';

const ROTULOS_ORIGEM = {
  sistema: 'Sistema',
  buriti: 'Buriti',
  claude: 'Claude',
  pessoa: 'Pessoa',
};

const ROTULOS_TIPO_PENDENCIA = {
  balancete: 'Balancete',
  plano: 'Plano de trabalho',
  bolsas: 'Bolsas',
  contrato: 'Contrato',
  cadastro: 'Cadastro',
  outro: 'Outro',
};

function situacaoGrupo(grupo, hasBalancete, defasagemMeses) {
  if (!hasBalancete) return 'sem balancete';
  const livre = Number(grupo?.saldo_livre);
  if (Number.isFinite(livre) && livre < 0) return 'problema';
  if (defasagemMeses !== null && defasagemMeses !== undefined && Number(defasagemMeses) >= 2) {
    return 'atenção';
  }
  return 'em dia';
}

function resumirRepasses(repassesDados, hasPlano, hoje) {
  if (!repassesDados) {
    return { valor: '—', contexto: 'indisponível' };
  }

  const calc = situacaoDasParcelas({
    parcelas: repassesDados.parcelas || [],
    recursos: repassesDados.recursos || null,
    dataBalancete: repassesDados.data_balancete || null,
    hoje,
    totalPlano:
      repassesDados.valor_total_plano != null ? Number(repassesDados.valor_total_plano) : null,
  });

  if (calc.itens.length === 0) {
    return { valor: '—', contexto: hasPlano === false ? 'sem plano' : 'sem cronograma' };
  }

  if (calc.recebido === null) {
    return {
      valor: <Valor valor={null} motivoSemDado="sem balancete" />,
      contexto: 'sem balancete',
    };
  }

  if (calc.sem_valores) {
    return {
      valor: <Valor valor={calc.recebido} centavos={false} />,
      contexto:
        calc.falta_sem_cronograma != null
          ? `faltam ${dinheiro(calc.falta_sem_cronograma, { centavos: false })}`
          : 'recebido até agora',
    };
  }

  const total = calc.itens.length;
  const recebidas = calc.itens.filter((i) => i.situacao === 'recebida').length;
  const atrasadas = calc.itens.filter((i) => i.situacao === 'atrasada').length;
  const proximaFutura = calc.itens.find((i) => i.situacao === 'futura' && i.mes);
  const temPendenteConferencia = calc.itens.some((i) =>
    ['parcial', 'nota_emitida', 'confirmar'].includes(i.situacao)
  );

  let contexto;
  if (atrasadas > 0) {
    contexto = atrasadas === 1 ? '1 parcela atrasada' : `${atrasadas} parcelas atrasadas`;
  } else if (proximaFutura) {
    contexto = `próximo em ${dataCompacta(proximaFutura.mes)}`;
  } else if (temPendenteConferencia) {
    contexto = 'parcela a confirmar';
  } else if (recebidas === total) {
    contexto = 'todas recebidas';
  } else {
    contexto = 'cronograma em dia';
  }

  return {
    valor: `${recebidas} de ${total}`,
    contexto,
  };
}

function resumirDetalhePendencia(detalhe) {
  if (!detalhe || typeof detalhe !== 'object') return [];
  const pares = [];
  if (detalhe.descricao) pares.push({ rotulo: 'Detalhe', valor: String(detalhe.descricao) });
  if (detalhe.observacao) pares.push({ rotulo: 'Observação', valor: String(detalhe.observacao) });
  if (detalhe.conta) pares.push({ rotulo: 'Conta', valor: String(detalhe.conta) });
  if (detalhe.rubrica) pares.push({ rotulo: 'Rubrica', valor: String(detalhe.rubrica) });
  if (detalhe.documento) pares.push({ rotulo: 'Documento', valor: String(detalhe.documento) });
  if (detalhe.competencia) {
    pares.push({ rotulo: 'Competência', valor: dataCompacta(detalhe.competencia) });
  }
  return pares;
}

function validarUrlDrive(url) {
  if (typeof url !== 'string') return null;
  const limpa = url.trim();
  return /^https?:\/\//i.test(limpa) ? limpa : null;
}

/**
 * Página individual do centro de custo (`#/projeto/<id>[/<aba>]`).
 */
export function Projeto({
  projectId,
  abaInicial = null,
  resumoCentro = null,
  carregandoResumo = false,
  erroResumo = null,
  isAdmin = false,
  hoje = hojeISO(),
  onNavegar = null,
  onMudarPendencias = null,
  onRecarregarResumo = null,
}) {
  const [abaAtiva, setAbaAtiva] = useState(abaInicial || 'dinheiro');
  const [saldoSt, setSaldoSt] = useState({ carregando: true, dados: null, erro: null });
  const [repassesSt, setRepassesSt] = useState({ carregando: true, dados: null, erro: null });
  const [docsSt, setDocsSt] = useState({
    carregando: true,
    balancetes: [],
    planos: [],
    erroBalancetes: null,
    erroPlanos: null,
  });
  const [pendenciasSt, setPendenciasSt] = useState({ carregando: true, dados: [], erro: null });

  const [painelOrigemAberto, setPainelOrigemAberto] = useState(false);
  const [grupoSelecionado, setGrupoSelecionado] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);
  const [salvandoPendenciaId, setSalvandoPendenciaId] = useState(null);
  const [erroResolucao, setErroResolucao] = useState(null);

  useEffect(() => {
    setAbaAtiva(abaInicial || 'dinheiro');
  }, [projectId, abaInicial]);

  useEffect(() => {
    setPainelOrigemAberto(false);
    setGrupoSelecionado(null);
    setConfirmacao(null);
    setErroResolucao(null);
  }, [projectId]);

  const carregarSaldo = useCallback(async () => {
    setSaldoSt({ carregando: true, dados: null, erro: null });
    const res = await saldoLivre(projectId);
    setSaldoSt({ carregando: false, dados: res.dados, erro: res.erro });
  }, [projectId]);

  const carregarRepasses = useCallback(async () => {
    setRepassesSt({ carregando: true, dados: null, erro: null });
    const res = await repasses(projectId);
    setRepassesSt({ carregando: false, dados: res.dados, erro: res.erro });
  }, [projectId]);

  const carregarDocumentos = useCallback(async () => {
    setDocsSt({
      carregando: true,
      balancetes: [],
      planos: [],
      erroBalancetes: null,
      erroPlanos: null,
    });
    const [resBal, resPl] = await Promise.all([balancetes(projectId), planos(projectId)]);
    setDocsSt({
      carregando: false,
      balancetes: Array.isArray(resBal.dados) ? resBal.dados : [],
      planos: Array.isArray(resPl.dados) ? resPl.dados : [],
      erroBalancetes: resBal.erro,
      erroPlanos: resPl.erro,
    });
  }, [projectId]);

  const carregarPendencias = useCallback(async () => {
    setPendenciasSt({ carregando: true, dados: [], erro: null });
    const res = await pendencias(projectId);
    setPendenciasSt({
      carregando: false,
      dados: Array.isArray(res.dados) ? res.dados : [],
      erro: res.erro,
    });
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    carregarSaldo();
    carregarRepasses();
    carregarDocumentos();
    carregarPendencias();
  }, [projectId, carregarSaldo, carregarRepasses, carregarDocumentos, carregarPendencias]);

  const nomeProjeto = resumoCentro?.name || saldoSt.dados?.project_name || 'Centro de custo';
  const codigoProjeto = resumoCentro?.code || '';
  const tituloPagina = codigoProjeto ? `${nomeProjeto} · ${codigoProjeto}` : nomeProjeto;
  const endDate = resumoCentro?.end_date || saldoSt.dados?.end_date || null;
  const meses = endDate ? mesesRestantes(endDate, hoje) : null;

  let contextoVigencia = null;
  if (endDate) {
    const textoMeses =
      meses === 0
        ? 'vigência encerrada'
        : meses === 1
          ? 'falta 1 mês'
          : `faltam ${meses} meses`;
    contextoVigencia = (
      <>
        Vigência até <Valor valor={endDate} tipo="data-completa" /> · {textoMeses} ·{' '}
        <span class="projeto__nota-discreta">vigência digitada</span>
      </>
    );
  } else if (!carregandoResumo && !saldoSt.carregando) {
    contextoVigencia = (
      <>
        Vigência não informada · <span class="projeto__nota-discreta">vigência digitada</span>
      </>
    );
  }

  const driveUrl = isAdmin ? validarUrlDrive(resumoCentro?.drive_folder_url) : null;

  const hasPlano = saldoSt.dados ? saldoSt.dados.has_plano !== false : resumoCentro?.situacao !== 'sem plano';
  const hasBalancete = saldoSt.dados
    ? Boolean(saldoSt.dados.has_balancete)
    : resumoCentro?.situacao !== 'sem balancete';
  const defasagemMeses = saldoSt.dados?.balancete_defasagem_meses ?? null;
  const dataRef = resumoCentro?.data_referencia || saldoSt.dados?.data_referencia || null;

  const grupos = Array.isArray(saldoSt.dados?.grupos) ? saldoSt.dados.grupos : [];
  const rubricas = Array.isArray(saldoSt.dados?.rubricas) ? saldoSt.dados.rubricas : [];
  const podeAbrirOrigem = grupos.length > 0 && resumoCentro?.livre != null;

  // Destaque principal: sempre o `livre` do resumo (nunca recalculado).
  let valorPrincipal = <Valor valor={null} motivoSemDado="sem dado" />;
  let contextoPrincipal = 'sem dado';

  if (resumoCentro?.erro === 'falha_saldo_livre' || erroResumo) {
    valorPrincipal = <Valor valor={null} motivoSemDado="Não foi possível calcular o saldo deste centro" />;
    contextoPrincipal = 'Não foi possível calcular o saldo deste centro';
  } else if (resumoCentro?.situacao === 'sem plano' || saldoSt.dados?.has_plano === false) {
    valorPrincipal = <Valor valor={null} motivoSemDado="sem plano" />;
    contextoPrincipal = 'sem plano';
  } else if (resumoCentro?.situacao === 'sem balancete' || saldoSt.dados?.has_balancete === false) {
    valorPrincipal = <Valor valor={null} motivoSemDado="sem balancete" />;
    contextoPrincipal = 'sem balancete';
  } else if (carregandoResumo && !resumoCentro) {
    valorPrincipal = <Valor valor={null} motivoSemDado="consultando" />;
    contextoPrincipal = 'consultando';
  } else if (resumoCentro && resumoCentro.livre !== null && resumoCentro.livre !== undefined) {
    valorPrincipal = (
      <Valor
        valor={resumoCentro.livre}
        centavos={false}
        problema={resumoCentro.situacao === 'problema'}
        origem={podeAbrirOrigem ? { resumo: 'Ver composição por grupo' } : null}
        onOrigem={podeAbrirOrigem ? () => setPainelOrigemAberto(true) : null}
      />
    );
    contextoPrincipal = dataRef ? `balancete de ${dataCompacta(dataRef)}` : 'balancete vigente';
  }

  const rotuloPrincipal = endDate
    ? `Livres para gastar até ${dataCompacta(endDate)}`
    : 'Livres para gastar';

  // Bolsas por mês (Correções #2 e #3).
  const temArrayBolsas = Boolean(saldoSt.dados && hasPlano && Array.isArray(saldoSt.dados.bolsas_ativas));
  const bolsasTodas = temArrayBolsas ? saldoSt.dados.bolsas_ativas : [];
  const bolsasVigentes = bolsasTodas.filter(
    (b) => b?.end_date && String(b.end_date).slice(0, 10) >= hoje
  );
  const bolsasEncerradasJanela = bolsasTodas.filter(
    (b) => !b?.end_date || String(b.end_date).slice(0, 10) < hoje
  );

  let valorBolsas = <Valor valor={null} motivoSemDado="sem dado" />;
  let contextoBolsas = 'sem dado';
  if (saldoSt.carregando) {
    valorBolsas = <Valor valor={null} motivoSemDado="consultando" />;
    contextoBolsas = 'consultando';
  } else if (saldoSt.erro) {
    valorBolsas = <Valor valor={null} motivoSemDado={saldoSt.erro} />;
    contextoBolsas = 'indisponível';
  } else if (!hasPlano || !temArrayBolsas) {
    valorBolsas = <Valor valor={null} motivoSemDado="sem plano" />;
    contextoBolsas = 'sem plano';
  } else {
    const somaBolsasMes = bolsasVigentes.reduce((s, b) => s + Number(b.valor_mensal || 0), 0);
    valorBolsas = <Valor valor={somaBolsasMes} centavos={false} />;
    if (bolsasVigentes.length === 0) {
      contextoBolsas = 'nenhum bolsista ativo';
    } else if (bolsasVigentes.length === 1) {
      contextoBolsas = '1 bolsista ativo';
    } else {
      contextoBolsas = `${bolsasVigentes.length} bolsistas ativos`;
    }
  }

  // Repasses (Correção #4).
  const resumoRep = repassesSt.carregando
    ? { valor: <Valor valor={null} motivoSemDado="consultando" />, contexto: 'consultando' }
    : repassesSt.erro
      ? { valor: <Valor valor={null} motivoSemDado={repassesSt.erro} />, contexto: 'indisponível' }
      : resumirRepasses(repassesSt.dados, hasPlano, hoje);

  // Pendências do centro.
  const listaPendencias = [...(pendenciasSt.dados || [])].sort((a, b) => {
    if (a.situacao === 'aberta' && b.situacao !== 'aberta') return -1;
    if (a.situacao !== 'aberta' && b.situacao === 'aberta') return 1;
    return String(b.criada_em || '').localeCompare(String(a.criada_em || ''));
  });
  const pendenciasAbertas = listaPendencias.filter((p) => p.situacao === 'aberta').length;

  let valorPendencias = String(pendenciasAbertas);
  let contextoPendencias = pendenciasAbertas === 0
    ? 'nenhuma aberta'
    : pendenciasAbertas === 1
      ? '1 aberta neste centro'
      : `${pendenciasAbertas} abertas neste centro`;

  if (pendenciasSt.carregando) {
    valorPendencias = <Valor valor={null} motivoSemDado="consultando" />;
    contextoPendencias = 'consultando';
  } else if (pendenciasSt.erro) {
    valorPendencias = <Valor valor={null} motivoSemDado={pendenciasSt.erro} />;
    contextoPendencias = 'indisponível';
  }

  const selecionarAba = (novaAba) => {
    setAbaAtiva(novaAba);
    if (onNavegar && projectId) {
      onNavegar(urlProjeto(projectId, novaAba));
    }
  };

  const confirmarResolucao = async (item, situacao) => {
    setSalvandoPendenciaId(item.id);
    setErroResolucao(null);
    const res = await resolverPendencia(item.id, situacao);
    setSalvandoPendenciaId(null);

    if (res.erro) {
      setErroResolucao(res.erro);
      return;
    }

    setConfirmacao(null);
    await carregarPendencias();
    onMudarPendencias?.();
  };

  const somaGrupos = grupos.reduce((s, g) => s + Number(g?.saldo_livre || 0), 0);
  const divergeDoResumo =
    resumoCentro?.livre != null &&
    grupos.length > 0 &&
    Math.abs(somaGrupos - Number(resumoCentro.livre)) > 0.01;

  const documentosUnificados = [
    ...docsSt.balancetes.map((b, idx) => ({
      id: `bal-${b.id ?? idx}`,
      tipo: 'Balancete',
      nome: b.arquivo_nome || `Balancete de ${dataCompacta(b.data_referencia)}`,
      data: b.data_referencia || null,
    })),
    ...docsSt.planos.map((p, idx) => ({
      id: `pl-${p.id ?? idx}`,
      tipo: p.ativo ? 'Plano de trabalho (ativo)' : 'Plano de trabalho',
      nome: p.arquivo_nome || p.titulo || `Versão ${p.versao || ''}`.trim(),
      data: p.data_documento || (p.created_at ? String(p.created_at).slice(0, 10) : null),
    })),
  ].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

  const colunasGrupos = [
    {
      chave: 'grupo_name',
      titulo: 'Rubrica',
      render: (g) => <span class="projeto__rubrica">{g.grupo_name}</span>,
    },
    {
      chave: 'previsto',
      titulo: 'Previsto (R$)',
      alinhamento: 'direita',
      render: (g) => <Valor valor={g.previsto} centavos={false} semPrefixo alinhadoDireita />,
    },
    {
      chave: 'realizado',
      titulo: 'Realizado (R$)',
      alinhamento: 'direita',
      render: (g) => (
        <Valor
          valor={hasBalancete ? g.realizado : null}
          centavos={false}
          semPrefixo
          alinhadoDireita
          motivoSemDado="sem balancete"
        />
      ),
    },
    {
      chave: 'compromissos',
      titulo: 'Comprometido (R$)',
      alinhamento: 'direita',
      render: (g) => (
        <Valor
          valor={hasBalancete ? g.compromissos : null}
          centavos={false}
          semPrefixo
          alinhadoDireita
          motivoSemDado="sem balancete"
        />
      ),
    },
    {
      chave: 'saldo_livre',
      titulo: 'Livre (R$)',
      alinhamento: 'direita',
      render: (g) => (
        <Valor
          valor={hasBalancete ? g.saldo_livre : null}
          centavos={false}
          semPrefixo
          problema={hasBalancete && Number(g.saldo_livre) < 0}
          alinhadoDireita
          motivoSemDado="sem balancete"
        />
      ),
    },
    {
      chave: 'situacao',
      titulo: 'Situação',
      render: (g) => <Situacao estado={situacaoGrupo(g, hasBalancete, defasagemMeses)} />,
    },
  ];

  const itensAbas = [
    {
      id: 'dinheiro',
      rotulo: 'Dinheiro',
      conteudo: saldoSt.carregando ? (
        <Esqueleto variante="tabela" linhas={4} rotulo="Carregando grupos de rubricas" />
      ) : saldoSt.erro ? (
        <AvisoFalha mensagem={saldoSt.erro} aoTentarNovamente={carregarSaldo} />
      ) : !hasPlano || grupos.length === 0 ? (
        <Vazio mensagem="Este centro ainda não tem plano de trabalho ativo." />
      ) : (
        <>
          {!hasBalancete && (
            <AvisoFalha mensagem="Sem balancete importado: realizado, comprometido e livre aguardam o documento." />
          )}
          <Tabela
            colunas={colunasGrupos}
            dados={grupos}
            chaveLinha={(g) => g.grupo_code}
            onClicarLinha={(g) => setGrupoSelecionado(g)}
            rotuloLinha={(g) => `Abrir detalhe de ${g.grupo_name}`}
            legenda="Execução por grupo de rubrica"
          />
        </>
      ),
    },
    {
      id: 'bolsas',
      rotulo: 'Bolsas',
      contagem: !saldoSt.carregando && temArrayBolsas ? bolsasVigentes.length : null,
      conteudo: saldoSt.carregando ? (
        <Esqueleto variante="tabela" linhas={3} rotulo="Carregando bolsas" />
      ) : saldoSt.erro ? (
        <AvisoFalha mensagem={saldoSt.erro} aoTentarNovamente={carregarSaldo} />
      ) : !hasPlano || !temArrayBolsas ? (
        <Vazio mensagem="Sem plano de trabalho ativo para listar as bolsas deste centro." />
      ) : bolsasVigentes.length === 0 ? (
        <>
          <Vazio mensagem="Nenhuma bolsa ativa neste centro." />
          {bolsasEncerradasJanela.length > 0 && (
            <p class="projeto__nota-discreta">
              {bolsasEncerradasJanela.length}{' '}
              {bolsasEncerradasJanela.length === 1
                ? 'bolsa encerrada permanece na janela de compromissos deste balancete.'
                : 'bolsas encerradas permanecem na janela de compromissos deste balancete.'}
            </p>
          )}
        </>
      ) : (
        <>
          <Tabela
            legenda="Bolsas ativas no centro"
            chaveLinha={(b, idx) => b.scholarship_id ?? idx}
            colunas={[
              { chave: 'bolsista', titulo: 'Bolsista' },
              {
                chave: 'valor_mensal',
                titulo: 'Valor por mês (R$)',
                alinhamento: 'direita',
                render: (b) => (
                  <Valor valor={b.valor_mensal} centavos={false} semPrefixo alinhadoDireita />
                ),
              },
              {
                chave: 'end_date',
                titulo: 'Até quando',
                render: (b) => <Valor valor={b.end_date} tipo="data" />,
              },
            ]}
            dados={bolsasVigentes}
          />
          {bolsasEncerradasJanela.length > 0 && (
            <p class="projeto__nota-discreta">
              {bolsasEncerradasJanela.length}{' '}
              {bolsasEncerradasJanela.length === 1
                ? 'bolsa encerrada também compõe os compromissos da janela do balancete.'
                : 'bolsas encerradas também compõem os compromissos da janela do balancete.'}
            </p>
          )}
        </>
      ),
    },
    {
      id: 'documentos',
      rotulo: 'Documentos',
      contagem:
        !docsSt.carregando && (!docsSt.erroBalancetes || !docsSt.erroPlanos)
          ? documentosUnificados.length
          : null,
      conteudo: docsSt.carregando ? (
        <Esqueleto variante="tabela" linhas={4} rotulo="Carregando documentos" />
      ) : docsSt.erroBalancetes && docsSt.erroPlanos ? (
        <AvisoFalha
          mensagem="Não foi possível carregar os documentos deste centro."
          aoTentarNovamente={carregarDocumentos}
        />
      ) : (
        <>
          {docsSt.erroBalancetes && (
            <AvisoFalha mensagem={docsSt.erroBalancetes} aoTentarNovamente={carregarDocumentos} />
          )}
          {docsSt.erroPlanos && (
            <AvisoFalha mensagem={docsSt.erroPlanos} aoTentarNovamente={carregarDocumentos} />
          )}
          <Tabela
            legenda="Planos e balancetes do centro"
            colunas={[
              { chave: 'tipo', titulo: 'Tipo' },
              { chave: 'nome', titulo: 'Documento' },
              {
                chave: 'data',
                titulo: 'Data',
                render: (d) => <Valor valor={d.data} tipo="data-completa" />,
              },
            ]}
            dados={documentosUnificados}
            vazio="Nenhum documento registrado neste centro."
          />
        </>
      ),
    },
    {
      id: 'pendencias',
      rotulo: 'Pendências',
      contagem: !pendenciasSt.carregando && !pendenciasSt.erro ? pendenciasAbertas : null,
      conteudo: pendenciasSt.carregando ? (
        <Esqueleto variante="linha" linhas={3} rotulo="Carregando pendências" />
      ) : pendenciasSt.erro ? (
        <AvisoFalha mensagem={pendenciasSt.erro} aoTentarNovamente={carregarPendencias} />
      ) : listaPendencias.length === 0 ? (
        <Vazio mensagem="Nenhuma pendência neste centro." />
      ) : (
        <div class="projeto__lista-pendencias">
          {listaPendencias.map((item) => {
            const emConfirmacao = confirmacao?.id === item.id;
            const aberta = item.situacao === 'aberta';
            const tipoTexto = ROTULOS_TIPO_PENDENCIA[item.tipo] || 'Outro';
            const origemTexto = ROTULOS_ORIGEM[item.origem] || item.origem;
            const meta = [tipoTexto, origemTexto, tempoRelativo(item.criada_em)]
              .filter(Boolean)
              .join(' · ');
            const detalhes = resumirDetalhePendencia(item.detalhe);

            return (
              <Cartao
                key={item.id}
                titulo={item.titulo}
                subtitulo={meta}
                acao={
                  !aberta ? (
                    <span class="projeto__pendencia-situacao">
                      {item.situacao === 'resolvida' ? 'Resolvida' : 'Descartada'}
                    </span>
                  ) : null
                }
              >
                {detalhes.length > 0 && (
                  <dl class="projeto__lista-definicao">
                    {detalhes.map((par) => (
                      <div key={par.rotulo} class="projeto__par">
                        <dt>{par.rotulo}</dt>
                        <dd>{par.valor}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {aberta && !emConfirmacao && (
                  <div class="projeto__pendencia-acoes">
                    <Botao
                      variante="secundario"
                      tamanho="compacto"
                      onClick={() => {
                        setErroResolucao(null);
                        setConfirmacao({ id: item.id, situacao: 'resolvida' });
                      }}
                    >
                      Resolvida
                    </Botao>
                    <Botao
                      variante="fantasma"
                      tamanho="compacto"
                      onClick={() => {
                        setErroResolucao(null);
                        setConfirmacao({ id: item.id, situacao: 'descartada' });
                      }}
                    >
                      Descartar
                    </Botao>
                  </div>
                )}

                {aberta && emConfirmacao && (
                  <div class="projeto__pendencia-confirmacao">
                    <p class="projeto__pendencia-pergunta">
                      {confirmacao.situacao === 'resolvida'
                        ? 'Confirmar que esta pendência foi resolvida?'
                        : 'Confirmar o descarte desta pendência?'}
                    </p>
                    {erroResolucao && <AvisoFalha mensagem={erroResolucao} />}
                    <div class="projeto__pendencia-acoes">
                      <Botao
                        variante="primario"
                        tamanho="compacto"
                        carregando={salvandoPendenciaId === item.id}
                        onClick={() => confirmarResolucao(item, confirmacao.situacao)}
                      >
                        Confirmar
                      </Botao>
                      <Botao
                        variante="fantasma"
                        tamanho="compacto"
                        desabilitado={salvandoPendenciaId === item.id}
                        onClick={() => {
                          setConfirmacao(null);
                          setErroResolucao(null);
                        }}
                      >
                        Cancelar
                      </Botao>
                    </div>
                  </div>
                )}
              </Cartao>
            );
          })}
        </div>
      ),
    },
  ];

  const rubricasGrupo = grupoSelecionado
    ? rubricas.filter((r) => r.grupo_code === grupoSelecionado.grupo_code)
    : [];

  return (
    <div class="conteudo">
      <CabecalhoPagina
        voltar={{
          rotulo: 'Projetos',
          href: '#/projetos',
          onClick: onNavegar
            ? (e) => {
                e.preventDefault();
                onNavegar('#/projetos');
              }
            : undefined,
        }}
        titulo={tituloPagina}
        contexto={contextoVigencia}
        acoes={
          driveUrl ? (
            <Botao variante="secundario" icone={ExternalLink} href={driveUrl} externo>
              Pasta no Drive
            </Botao>
          ) : null
        }
      />

      {erroResumo && (
        <AvisoFalha mensagem={erroResumo} aoTentarNovamente={onRecarregarResumo} />
      )}

      <GradeDestaques>
        <Destaque
          principal
          rotulo={rotuloPrincipal}
          valor={valorPrincipal}
          contexto={contextoPrincipal}
        />
        <Destaque
          rotulo="Bolsas por mês"
          valor={valorBolsas}
          contexto={contextoBolsas}
        />
        <Destaque
          rotulo="Repasses"
          valor={resumoRep.valor}
          contexto={resumoRep.contexto}
        />
        <Destaque
          rotulo="Pendências"
          valor={valorPendencias}
          contexto={contextoPendencias}
        />
      </GradeDestaques>

      <Cartao titulo="Detalhes do centro">
        <Abas
          itens={itensAbas}
          ativa={abaAtiva}
          aoSelecionar={selecionarAba}
          ariaLabel="Seções do centro de custo"
        />
      </Cartao>

      <PainelLateral
        aberto={painelOrigemAberto}
        aoFechar={() => setPainelOrigemAberto(false)}
        titulo="De onde vem este valor"
        subtitulo={tituloPagina}
      >
        <Destaque
          rotulo={rotuloPrincipal}
          valor={<Valor valor={resumoCentro?.livre ?? null} centavos />}
          contexto={dataRef ? `balancete de ${dataCompacta(dataRef)}` : 'soma dos grupos abaixo'}
        />

        {divergeDoResumo && (
          <AvisoFalha
            mensagem={`A soma dos grupos (${dinheiro(somaGrupos, { centavos: true })}) difere do valor exibido (${dinheiro(resumoCentro?.livre, { centavos: true })}).`}
          />
        )}

        <dl class="projeto__lista-definicao">
          {grupos.map((g) => (
            <div key={g.grupo_code} class="projeto__par-conta">
              <div class="projeto__par">
                <dt>
                  {g.grupo_name} <span class="projeto__codigo-discreto">({g.grupo_code})</span>
                </dt>
                <dd>
                  <Valor
                    valor={g.saldo_livre}
                    centavos
                    problema={Number(g.saldo_livre) < 0}
                  />
                </dd>
              </div>
              <span class="projeto__formula">
                Previsto <Valor valor={g.previsto} centavos /> − Realizado{' '}
                <Valor valor={g.realizado} centavos /> − Comprometido{' '}
                <Valor valor={g.compromissos} centavos />
              </span>
            </div>
          ))}
        </dl>

        <div class="projeto__par projeto__par--total">
          <span>Soma das partes</span>
          <Valor valor={somaGrupos} centavos />
        </div>
      </PainelLateral>

      <PainelLateral
        aberto={Boolean(grupoSelecionado)}
        aoFechar={() => setGrupoSelecionado(null)}
        titulo={grupoSelecionado?.grupo_name || ''}
        subtitulo={grupoSelecionado ? `Código ${grupoSelecionado.grupo_code}` : ''}
      >
        {grupoSelecionado && (
          <>
            <dl class="projeto__lista-definicao">
              <div class="projeto__par">
                <dt>Previsto</dt>
                <dd><Valor valor={grupoSelecionado.previsto} centavos /></dd>
              </div>
              <div class="projeto__par">
                <dt>Realizado</dt>
                <dd>
                  <Valor
                    valor={hasBalancete ? grupoSelecionado.realizado : null}
                    centavos
                    motivoSemDado="sem balancete"
                  />
                </dd>
              </div>
              <div class="projeto__par">
                <dt>Comprometido</dt>
                <dd>
                  <Valor
                    valor={hasBalancete ? grupoSelecionado.compromissos : null}
                    centavos
                    motivoSemDado="sem balancete"
                  />
                </dd>
              </div>
              <div class="projeto__par">
                <dt>Livre</dt>
                <dd>
                  <Valor
                    valor={hasBalancete ? grupoSelecionado.saldo_livre : null}
                    centavos
                    problema={hasBalancete && Number(grupoSelecionado.saldo_livre) < 0}
                    motivoSemDado="sem balancete"
                  />
                </dd>
              </div>
            </dl>

            <p class="texto-corrido projeto__cobertura">
              {grupoSelecionado.compromissos_cobertura === 'bolsas'
                ? 'Compromissos de bolsas incluídos até o fim da vigência.'
                : 'Nenhum compromisso futuro descontado neste grupo além do já realizado.'}
            </p>

            {rubricasGrupo.length > 0 && (
              <div class="projeto__subrubricas">
                <h3 class="projeto__subtitulo-painel">Rubricas deste grupo</h3>
                <dl class="projeto__lista-definicao">
                  {rubricasGrupo.map((r) => (
                    <div key={r.rubrica_code} class="projeto__par-conta">
                      <div class="projeto__par">
                        <dt>
                          {r.rubrica_name}{' '}
                          <span class="projeto__codigo-discreto">({r.rubrica_code})</span>
                        </dt>
                        <dd>
                          <Valor
                            valor={hasBalancete ? r.saldo_livre : null}
                            centavos
                            problema={hasBalancete && Number(r.saldo_livre) < 0}
                            motivoSemDado="sem balancete"
                          />
                        </dd>
                      </div>
                      <span class="projeto__formula">
                        Previsto <Valor valor={r.previsto} centavos /> · Realizado{' '}
                        <Valor valor={hasBalancete ? r.realizado : null} centavos motivoSemDado="sem balancete" /> ·
                        Comprometido{' '}
                        <Valor valor={hasBalancete ? r.compromissos : null} centavos motivoSemDado="sem balancete" />
                      </span>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </>
        )}
      </PainelLateral>
    </div>
  );
}
