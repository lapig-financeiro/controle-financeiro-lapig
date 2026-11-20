import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, Plus, StickyNote, Trash2 } from 'lucide-preact';
import {
  AvisoFalha,
  Botao,
  CabecalhoPagina,
  Campo,
  Chip,
  Esqueleto,
  Seletor,
  Valor,
  Vazio,
} from '../componentes/index.js';
import {
  apagarCaixaPedido,
  colocarNaCaixa,
  editarItemCaixa,
  limparOcultosDaCaixa,
  pedidoBolsas,
  salvarCaixaPedido,
  salvarEquipeBolsista,
  tirarDaCaixa,
} from '../servicos/dados.js';
import { dataCompacta, dinheiro, hojeISO, nomeProprio } from '../util/formato.js';
import { parseValorBR } from '../util/moeda.js';
import './Bolsistas.css';

const EQUIPES = [
  { valor: 'pastagem', rotulo: 'Pastagem' },
  { valor: 'sem', rotulo: 'Sem equipe' },
  { valor: 'alertas', rotulo: 'Alertas' },
  { valor: 'solos', rotulo: 'Solos' },
];

// Equipes que ganham caixa própria pelo botão "Montar caixas" (pedido do Victor, 20/11).
const EQUIPES_COM_CAIXA = ['alertas', 'solos'];

const FILTROS_PADRAO = {
  centrosDesmarcados: [],
  legadoCentrosMarcados: null,
  equipes: ['pastagem', 'sem'],
  situacao: 'vigente',
  data: '',
  busca: '',
};

function chaveFiltros(usuarioId) {
  return `cf_bolsistas_filtros_${usuarioId || 'local'}`;
}

function chavePassos(usuarioId) {
  return `cf_bolsistas_passos_${usuarioId || 'local'}`;
}

function lerPassos(usuarioId) {
  if (typeof window === 'undefined' || !window.localStorage) return true;
  try {
    return window.localStorage.getItem(chavePassos(usuarioId)) !== 'fechado';
  } catch {
    return true;
  }
}

function lerFiltros(usuarioId) {
  if (typeof window === 'undefined' || !window.localStorage) return { ...FILTROS_PADRAO };
  try {
    const bruto = JSON.parse(window.localStorage.getItem(chaveFiltros(usuarioId)) || 'null');
    if (!bruto || typeof bruto !== 'object') return { ...FILTROS_PADRAO };
    const equipes = Array.isArray(bruto.equipes)
      ? bruto.equipes.filter((e) => EQUIPES.some((item) => item.valor === e))
      : FILTROS_PADRAO.equipes;
    return {
      centrosDesmarcados: Array.isArray(bruto.centrosDesmarcados)
        ? bruto.centrosDesmarcados.filter((id) => typeof id === 'string')
        : [],
      // Formato antigo (lista de marcados): convertido quando os centros chegam.
      legadoCentrosMarcados: Array.isArray(bruto.centros)
        ? bruto.centros.filter((id) => typeof id === 'string')
        : null,
      equipes,
      situacao: bruto.situacao === 'termina' ? 'termina' : 'vigente',
      data: typeof bruto.data === 'string' ? bruto.data : '',
      busca: typeof bruto.busca === 'string' ? bruto.busca : '',
    };
  } catch {
    return { ...FILTROS_PADRAO };
  }
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function rotuloEquipe(equipe) {
  const item = EQUIPES.find((e) => e.valor === (equipe ?? 'sem'));
  return item ? item.rotulo : 'Sem equipe';
}

function equipeDaPessoa(pessoa) {
  return pessoa.equipe ?? 'sem';
}

function bolsaTexto(bolsa) {
  return `${bolsa.code} · ${dinheiro(bolsa.valor, { centavos: false })}/mês · até ${dataCompacta(bolsa.fim)}`;
}

function CaixaPedido({
  caixa,
  pessoasPorId,
  emAcao,
  onSalvarCaixa,
  onApagarCaixa,
  onTirar,
  onSalvarItem,
  onLimparOcultos,
}) {
  const [editandoCaixa, setEditandoCaixa] = useState(false);
  const [nome, setNome] = useState(caixa.nome);
  const [meses, setMeses] = useState(String(caixa.meses));
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    setNome(caixa.nome);
    setMeses(String(caixa.meses));
  }, [caixa.nome, caixa.meses]);

  const mesesNumero = Number(meses);
  const mesesValidos = Number.isInteger(mesesNumero) && mesesNumero >= 1 && mesesNumero <= 60;
  const podeSalvar = nome.trim().length > 0 && nome.trim().length <= 80 && mesesValidos;

  const salvarCaixa = async (evento) => {
    evento.preventDefault();
    if (!podeSalvar) return;
    const res = await onSalvarCaixa(caixa.id, nome, mesesNumero);
    if (res?.ok) setEditandoCaixa(false);
  };

  return (
    <section class="bolsistas__caixa" data-caixa-id={caixa.id} aria-label={`Caixa ${caixa.nome}`}>
      <div class="bolsistas__caixa-topo">
        <h3 class="bolsistas__caixa-nome-titulo">{caixa.nome}</h3>
        <Botao
          variante="fantasma"
          tamanho="compacto"
          onClick={() => setEditandoCaixa((v) => !v)}
          desabilitado={emAcao}
        >
          Editar caixa
        </Botao>
      </div>

      <p class="bolsistas__caixa-resumo">
        <strong>{caixa.pessoas}</strong> {caixa.pessoas === 1 ? 'pessoa' : 'pessoas'} ·{' '}
        {dinheiro(caixa.total_mensal, { centavos: false })}/mês ·{' '}
        {dinheiro(caixa.total_periodo, { centavos: false })} em {caixa.meses} meses
      </p>

      {editandoCaixa && (
        <form class="bolsistas__caixa-edicao" onSubmit={salvarCaixa}>
          <Campo
            rotulo="Nome da caixa"
            valor={nome}
            aoMudar={setNome}
            desabilitado={emAcao}
            maxLength={80}
            className="bolsistas__caixa-nome"
          />
          <Campo
            rotulo="Meses"
            tipo="number"
            valor={meses}
            aoMudar={setMeses}
            min={1}
            max={60}
            desabilitado={emAcao}
            className="bolsistas__caixa-meses"
          />
          <Botao
            variante="secundario"
            tamanho="compacto"
            tipo="submit"
            desabilitado={emAcao || !podeSalvar}
          >
            Salvar caixa
          </Botao>
        </form>
      )}

      {caixa.itens_ocultos > 0 && (
        <div class="bolsistas__caixa-ocultos">
          <span>
            {caixa.itens_ocultos}{' '}
            {caixa.itens_ocultos === 1 ? 'pessoa saiu da lista' : 'pessoas saíram da lista'} e não
            entra{caixa.itens_ocultos === 1 ? '' : 'm'} nesta conta.
          </span>
          <Botao
            variante="fantasma"
            tamanho="compacto"
            onClick={() => onLimparOcultos(caixa.id)}
            desabilitado={emAcao}
          >
            Tirar quem saiu da lista
          </Botao>
        </div>
      )}

      <div class="bolsistas__caixa-itens">
        {caixa.itens.length === 0 ? (
          <p class="bolsistas__caixa-vazia">Ninguém nesta caixa ainda.</p>
        ) : (
          caixa.itens.map((item) => {
            const pessoa = pessoasPorId.get(item.holder_id);
            return (
              <ItemDaCaixa
                key={item.holder_id}
                caixaId={caixa.id}
                item={item}
                nome={pessoa?.nome || 'Pessoa fora da lista'}
                emAcao={emAcao}
                onTirar={onTirar}
                onSalvarItem={onSalvarItem}
              />
            );
          })
        )}
      </div>

      <div class="bolsistas__caixa-acoes">
        {!confirmando ? (
          <Botao
            variante="fantasma"
            tamanho="compacto"
            icone={Trash2}
            onClick={() => setConfirmando(true)}
            desabilitado={emAcao}
          >
            Apagar caixa
          </Botao>
        ) : (
          <div class="bolsistas__confirmacao" role="group" aria-label="Confirmar exclusão da caixa">
            <span>Apagar esta caixa e as pessoas dela?</span>
            <Botao
              variante="secundario"
              tamanho="compacto"
              onClick={() => onApagarCaixa(caixa.id)}
              desabilitado={emAcao}
            >
              Sim, apagar
            </Botao>
            <Botao
              variante="fantasma"
              tamanho="compacto"
              onClick={() => setConfirmando(false)}
              desabilitado={emAcao}
            >
              Cancelar
            </Botao>
          </div>
        )}
      </div>
    </section>
  );
}

function ItemDaCaixa({ caixaId, item, nome, emAcao, onTirar, onSalvarItem }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(item.valor_mensal === null ? '' : String(item.valor_mensal));
  const [nota, setNota] = useState(item.nota || '');
  const [erro, setErro] = useState('');

  useEffect(() => {
    setValor(item.valor_mensal === null ? '' : String(item.valor_mensal));
    setNota(item.nota || '');
  }, [item.valor_mensal, item.nota]);

  const salvar = async () => {
    const texto = valor.trim();
    const numero = texto === '' ? null : parseValorBR(texto);
    if (texto !== '' && (numero === null || numero <= 0)) {
      setErro('Informe um valor positivo ou deixe vazio para usar o atual.');
      return;
    }
    setErro('');
    const res = await onSalvarItem(caixaId, item.holder_id, numero, nota);
    if (res?.ok) setEditando(false);
  };

  const editado = item.valor_mensal !== null && item.valor_mensal !== undefined;

  return (
    <div class="bolsistas__item" data-holder-id={item.holder_id}>
      <div class="bolsistas__item-linha">
        <span class="bolsistas__item-nome" title={nome}>
          {nome}
        </span>
        <span class="bolsistas__item-valor">
          <span class="bolsistas__item-usado">
            {dinheiro(item.valor_usado, { centavos: false })}/mês
            {editado && <span class="bolsistas__item-editado">editado</span>}
          </span>
          {item.nota && (
            <span
              class="bolsistas__item-nota"
              title={item.nota}
              aria-label={`Nota: ${item.nota}`}
            >
              <StickyNote size={15} strokeWidth={1.75} aria-hidden="true" />
            </span>
          )}
        </span>
        <div class="bolsistas__item-acoes">
          <Botao
            variante="fantasma"
            tamanho="compacto"
            onClick={() => setEditando((v) => !v)}
            desabilitado={emAcao}
            aria-label={`Editar ${nome} na caixa`}
          >
            Editar
          </Botao>
          <Botao
            variante="fantasma"
            tamanho="compacto"
            onClick={() => onTirar(caixaId, item.holder_id)}
            desabilitado={emAcao}
            aria-label={`Tirar ${nome} da caixa`}
          >
            Tirar
          </Botao>
        </div>
      </div>

      {editando && (
        <div class="bolsistas__item-editor">
          <Campo
            rotulo="Valor no pedido"
            valor={valor}
            aoMudar={setValor}
            placeholder={dinheiro(item.valor_usado, { centavos: false })}
            ajuda="Vazio = valor atual"
            desabilitado={emAcao}
            inputMode="decimal"
          />
          <Campo
            rotulo="Nota curta"
            valor={nota}
            aoMudar={setNota}
            maxLength={300}
            desabilitado={emAcao}
          />
          <Botao
            variante="secundario"
            tamanho="compacto"
            onClick={salvar}
            desabilitado={emAcao}
          >
            Salvar pessoa
          </Botao>
        </div>
      )}
      {erro && <p class="bolsistas__item-erro">{erro}</p>}
    </div>
  );
}

export function Bolsistas({ usuarioId = null }) {
  const [st, setSt] = useState({ carregando: true, dados: null, erro: null });
  const [erroAcao, setErroAcao] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [filtros, setFiltros] = useState(() => lerFiltros(usuarioId));
  const [passosAbertos, setPassosAbertos] = useState(() => lerPassos(usuarioId));
  const [mostrarNovaCaixa, setMostrarNovaCaixa] = useState(false);
  const [novaCaixa, setNovaCaixa] = useState({ nome: '', meses: '12' });
  const [emAcao, setEmAcao] = useState(false);
  const montadoRef = useRef(true);
  const geracaoRef = useRef(0);
  const acaoRef = useRef(false);
  const caixasRef = useRef(null);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      geracaoRef.current += 1;
    };
  }, []);

  const carregar = async () => {
    const geracao = ++geracaoRef.current;
    setSt((anterior) => ({ ...anterior, carregando: true, erro: null }));
    const res = await pedidoBolsas();
    if (!montadoRef.current || geracao !== geracaoRef.current) return false;
    if (res.erro) {
      setSt((anterior) => ({ carregando: false, dados: anterior.dados, erro: res.erro }));
      return false;
    }
    const dados = {
      ...res.dados,
      bolsistas: res.dados.bolsistas.map((p) => ({ ...p, nome: nomeProprio(p.nome) })),
    };
    setSt({ carregando: false, dados, erro: null });
    return true;
  };

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!st.dados || filtros.legadoCentrosMarcados) return;
    try {
      window.localStorage.setItem(
        chaveFiltros(usuarioId),
        JSON.stringify({
          centrosDesmarcados: filtros.centrosDesmarcados,
          equipes: filtros.equipes,
          situacao: filtros.situacao,
          data: filtros.data,
          busca: filtros.busca,
        })
      );
    } catch {
      /* localStorage pode estar indisponível; o filtro continua valendo na sessão */
    }
  }, [filtros, usuarioId]);

  const dados = st.dados;
  const centros = dados?.centros || [];

  useEffect(() => {
    if (!dados || !filtros.legadoCentrosMarcados) return;
    const ids = dados.centros.map((c) => c.id);
    const legado = filtros.legadoCentrosMarcados.filter((id) => ids.includes(id));
    // Se a lista antiga de marcados só tinha centros que não existem mais,
    // voltar para todos em vez de começar com a lista vazia.
    const desmarcados =
      filtros.legadoCentrosMarcados.length > 0 && legado.length === 0
        ? []
        : ids.filter((id) => !legado.includes(id));
    setFiltros((anterior) => ({
      ...anterior,
      centrosDesmarcados: desmarcados,
      legadoCentrosMarcados: null,
    }));
  }, [dados, filtros.legadoCentrosMarcados]);

  const marcados = useMemo(() => {
    const ids = centros.map((c) => c.id);
    if (filtros.legadoCentrosMarcados) {
      const legado = filtros.legadoCentrosMarcados.filter((id) => ids.includes(id));
      if (filtros.legadoCentrosMarcados.length > 0 && legado.length === 0) {
        return new Set(ids);
      }
      return new Set(legado);
    }
    const ocultos = new Set(filtros.centrosDesmarcados);
    return new Set(ids.filter((id) => !ocultos.has(id)));
  }, [centros, filtros.centrosDesmarcados, filtros.legadoCentrosMarcados]);

  const equipesSelecionadas = useMemo(() => new Set(filtros.equipes), [filtros.equipes]);
  const hoje = hojeISO();

  const pessoasPorId = useMemo(() => {
    const mapa = new Map();
    for (const pessoa of dados?.bolsistas || []) mapa.set(pessoa.holder_id, pessoa);
    return mapa;
  }, [dados]);

  const pessoasFiltradas = useMemo(() => {
    const busca = normalizarTexto(filtros.busca);
    return (dados?.bolsistas || []).filter((pessoa) => {
      if (!equipesSelecionadas.has(equipeDaPessoa(pessoa))) return false;
      if (busca && !normalizarTexto(pessoa.nome).includes(busca)) return false;

      const bolsas = pessoa.bolsas.filter((b) => marcados.has(b.project_id));
      if (bolsas.length === 0) return false;

      if (filtros.situacao === 'vigente') {
        return bolsas.some((b) => b.vigente_hoje);
      }
      if (filtros.situacao === 'termina' && filtros.data) {
        return bolsas.some(
          (b) => b.status !== 'cancelled' && b.fim >= hoje && b.fim <= filtros.data
        );
      }
      return bolsas.some((b) => b.status !== 'cancelled');
    });
  }, [dados, equipesSelecionadas, marcados, filtros.busca, filtros.situacao, filtros.data, hoje]);

  const caixaDaPessoa = (holderId) =>
    (dados?.caixas || []).find((caixa) =>
      caixa.itens.some((item) => item.holder_id === holderId)
    ) || null;

  const executar = async (acao) => {
    if (acaoRef.current) return { ok: false, dados: null };
    acaoRef.current = true;
    setEmAcao(true);
    setErroAcao(null);
    setAviso(null);
    try {
      const res = await acao();
      if (res?.erro) {
        setErroAcao(res.erro);
        return { ok: false, dados: null };
      }
      await carregar();
      return { ok: true, dados: res?.dados ?? null };
    } catch {
      setErroAcao('Não foi possível concluir a ação.');
      return { ok: false, dados: null };
    } finally {
      acaoRef.current = false;
      if (montadoRef.current) setEmAcao(false);
    }
  };

  const alternarCentro = (centroId) => {
    setFiltros((anterior) => {
      const ocultos = new Set(anterior.centrosDesmarcados);
      if (marcados.has(centroId)) ocultos.add(centroId);
      else ocultos.delete(centroId);
      return { ...anterior, centrosDesmarcados: Array.from(ocultos) };
    });
  };

  const alternarEquipe = (equipe) => {
    setFiltros((anterior) => {
      const atuais = new Set(anterior.equipes);
      if (atuais.has(equipe)) atuais.delete(equipe);
      else atuais.add(equipe);
      return { ...anterior, equipes: Array.from(atuais) };
    });
  };

  const rolarParaCaixas = () => {
    caixasRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const abrirNovaCaixa = () => {
    setMostrarNovaCaixa(true);
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)')?.matches) {
      setTimeout(rolarParaCaixas, 0);
    }
  };

  const fecharPassos = () => {
    setPassosAbertos(false);
    try {
      window.localStorage?.setItem(chavePassos(usuarioId), 'fechado');
    } catch {
      /* localStorage pode estar indisponível; o passo a passo volta na próxima sessão */
    }
  };

  const escolherEquipe = async (pessoa, equipe) => {
    const alvo = equipe === 'sem' ? null : equipe;
    if (equipeDaPessoa(pessoa) === equipe) return;
    const res = await executar(() => salvarEquipeBolsista(pessoa.holder_id, alvo));
    if (res.ok && !equipesSelecionadas.has(equipe)) {
      setAviso(`${pessoa.nome} agora está em ${rotuloEquipe(alvo)} (fora do filtro).`);
    }
  };

  const colocarPessoaNaCaixa = async (pessoa, caixa) => {
    const res = await executar(() => colocarNaCaixa(caixa.id, pessoa.holder_id));
    const saiuDe = res.dados?.saiu_de;
    if (res.ok && Array.isArray(saiuDe) && saiuDe.length > 0) {
      const nomes = saiuDe.map((c) => c.nome).join(', ');
      setAviso(`${pessoa.nome} saiu de ${nomes}.`);
    }
  };

  const salvarCaixa = (id, nome, meses) =>
    executar(() => salvarCaixaPedido({ id, nome, meses }));

  const criarCaixa = async (evento) => {
    evento.preventDefault();
    if (!novaCaixa.nome.trim()) {
      setErroAcao('Informe o nome da caixa.');
      return;
    }
    const meses = novaCaixa.meses === '' ? undefined : Number(novaCaixa.meses);
    const payload = { nome: novaCaixa.nome };
    if (meses !== undefined) payload.meses = meses;
    const res = await executar(() => salvarCaixaPedido(payload));
    if (res.ok) {
      setNovaCaixa({ nome: '', meses: '12' });
      setMostrarNovaCaixa(false);
    }
  };

  const faltamNasCaixasDasEquipes = () => {
    if (!dados) return [];
    return EQUIPES_COM_CAIXA.map((equipe) => {
      const nome = rotuloEquipe(equipe);
      const caixa = dados.caixas.find((c) => normalizarTexto(c.nome) === normalizarTexto(nome));
      const pessoas = dados.bolsistas.filter(
        (p) =>
          p.equipe === equipe &&
          p.bolsas.some((b) => b.vigente_hoje) &&
          !caixaDaPessoa(p.holder_id)
      );
      return { equipe, nome, caixa: caixa || null, pessoas };
    }).filter((g) => g.pessoas.length > 0);
  };

  const montarCaixasDasEquipes = async () => {
    const grupos = faltamNasCaixasDasEquipes();
    if (grupos.length === 0) return;
    const resumo = [];
    const res = await executar(async () => {
      for (const grupo of grupos) {
        let caixaId = grupo.caixa?.id;
        if (!caixaId) {
          const criada = await salvarCaixaPedido({ nome: grupo.nome });
          if (criada?.erro) return criada;
          caixaId = criada.dados.id;
        }
        for (const pessoa of grupo.pessoas) {
          const r = await colocarNaCaixa(caixaId, pessoa.holder_id);
          if (r?.erro) return r;
        }
        resumo.push(
          `${grupo.nome}: ${grupo.pessoas.length} ${grupo.pessoas.length === 1 ? 'pessoa' : 'pessoas'}`
        );
      }
      return { dados: null };
    });
    if (res.ok) setAviso(`Caixas montadas pelas equipes — ${resumo.join(' · ')}.`);
  };

  const limparOcultos = async (caixaId) => {
    const res = await executar(() => limparOcultosDaCaixa(caixaId));
    if (res.ok) {
      const removidos = res.dados?.removidos ?? 0;
      setAviso(
        removidos === 1
          ? '1 pessoa que saiu da lista foi tirada da caixa.'
          : `${removidos} pessoas que saíram da lista foram tiradas da caixa.`
      );
    }
  };

  const contexto = dados
    ? `${dados.bolsistas.length} ${
        dados.bolsistas.length === 1 ? 'pessoa' : 'pessoas'
      } · ${dados.centros.length} ${dados.centros.length === 1 ? 'centro' : 'centros'}`
    : null;

  return (
    <div class="conteudo bolsistas">
      <CabecalhoPagina
        titulo="Bolsistas"
        contexto="Monte o pedido de bolsas: filtre e coloque as pessoas nas caixas"
      />

      {passosAbertos && (
        <section class="bolsistas__passos" aria-label="Como montar o pedido">
          <ol class="bolsistas__passos-lista">
            <li>
              <span class="bolsistas__passo-numero" aria-hidden="true">1.</span>{' '}
              Filtre quem entra
            </li>
            <li>
              <span class="bolsistas__passo-numero" aria-hidden="true">2.</span>{' '}
              Crie uma caixa (ex.: Time Pastagem)
            </li>
            <li>
              <span class="bolsistas__passo-numero" aria-hidden="true">3.</span>{' '}
              Ponha as pessoas na caixa
            </li>
          </ol>
          <div class="bolsistas__passos-acoes">
            <Botao
              variante="secundario"
              tamanho="compacto"
              icone={Plus}
              onClick={abrirNovaCaixa}
              desabilitado={emAcao}
            >
              Nova caixa
            </Botao>
            <Botao variante="fantasma" tamanho="compacto" onClick={fecharPassos}>
              Entendi
            </Botao>
          </div>
        </section>
      )}

      {contexto && <p class="bolsistas__contexto">{contexto}</p>}

      {st.erro && <AvisoFalha mensagem={st.erro} aoTentarNovamente={carregar} />}
      {erroAcao && <AvisoFalha mensagem={erroAcao} />}
      {aviso && (
        <p class="bolsistas__aviso" role="status">
          {aviso}
        </p>
      )}

      {!dados && st.carregando && (
        <div class="bolsistas__carregando">
          <Esqueleto variante="cartao" linhas={4} rotulo="Carregando o pedido de bolsas" />
          <Esqueleto variante="cartao" linhas={3} rotulo="Carregando as caixas" />
        </div>
      )}

      {!dados && !st.carregando && st.erro && (
        <p class="bolsistas__indisponivel">
          Totais do pedido:{' '}
          <Valor
            valor={null}
            motivoSemDado="indisponível"
            semOrigem="Totais do pedido indisponíveis"
          />
        </p>
      )}

      {dados && (
        <div class="bolsistas__layout">
          <section class="bolsistas__lista" aria-label="Bolsistas">
            <div class="bolsistas__filtros">
              <div class="bolsistas__filtros-linha">
                <Campo
                  rotulo="Buscar por nome"
                  tipo="search"
                  valor={filtros.busca}
                  aoMudar={(valor) => setFiltros((anterior) => ({ ...anterior, busca: valor }))}
                  placeholder="Nome da pessoa"
                  className="bolsistas__busca"
                />

                <div class="bolsistas__filtro bolsistas__filtro-situacao">
                  <Seletor
                    rotulo="Situação"
                    valor={filtros.situacao}
                    aoMudar={(valor) =>
                      setFiltros((anterior) => ({ ...anterior, situacao: valor }))
                    }
                    opcoes={[
                      { valor: 'vigente', rotulo: 'Vigente hoje' },
                      { valor: 'termina', rotulo: 'Termina até' },
                    ]}
                  />
                  {filtros.situacao === 'termina' && (
                    <Campo
                      rotulo="Termina até"
                      tipo="date"
                      valor={filtros.data}
                      aoMudar={(valor) =>
                        setFiltros((anterior) => ({ ...anterior, data: valor }))
                      }
                    />
                  )}
                </div>

                <p class="bolsistas__contador" role="status">
                  {pessoasFiltradas.length}{' '}
                  {pessoasFiltradas.length === 1 ? 'pessoa na lista' : 'pessoas na lista'}
                </p>
              </div>

              <fieldset class="bolsistas__filtro">
                <legend class="bolsistas__filtro-titulo">Equipe</legend>
                <div class="bolsistas__filtro-chips" role="group" aria-label="Filtrar por equipe">
                  {EQUIPES.map((equipe) => (
                    <Chip
                      key={equipe.valor}
                      ativo={equipesSelecionadas.has(equipe.valor)}
                      onClick={() => alternarEquipe(equipe.valor)}
                    >
                      {equipe.rotulo}
                    </Chip>
                  ))}
                </div>
              </fieldset>

              <fieldset class="bolsistas__filtro">
                <legend class="bolsistas__filtro-titulo">Centros</legend>
                <div class="bolsistas__filtro-centros">
                  {centros.map((centro) => (
                    <label key={centro.id} class="bolsistas__centro">
                      <input
                        type="checkbox"
                        class="bolsistas__filtro-centro"
                        value={centro.id}
                        checked={marcados.has(centro.id)}
                        onChange={() => alternarCentro(centro.id)}
                      />
                      <span>
                        {centro.code} · {centro.name}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

            </div>

            {dados.caixas.length === 0 && (
              <div class="bolsistas__primeira-caixa">
                <p class="bolsistas__primeira-caixa-texto">
                  Crie sua primeira caixa para começar a separar as pessoas
                </p>
                <Botao
                  variante="secundario"
                  tamanho="compacto"
                  icone={Plus}
                  onClick={abrirNovaCaixa}
                  desabilitado={emAcao}
                >
                  Nova caixa
                </Botao>
              </div>
            )}

            {pessoasFiltradas.length === 0 ? (
              <Vazio mensagem="Nenhuma pessoa com esses filtros." />
            ) : (
              <ul class="bolsistas__pessoas" aria-label="Pessoas do pedido">
                {pessoasFiltradas.map((pessoa) => {
                  const equipe = equipeDaPessoa(pessoa);
                  const caixaAtual = caixaDaPessoa(pessoa.holder_id);
                  const bolsasVisiveis = pessoa.bolsas.filter((b) => marcados.has(b.project_id));
                  const temCentroDesmarcado = pessoa.bolsas.some(
                    (b) => b.vigente_hoje && !marcados.has(b.project_id)
                  );
                  return (
                    <li
                      key={pessoa.holder_id}
                      class={`bolsistas__pessoa${
                        dados.caixas.length === 0 ? ' bolsistas__pessoa--sem-caixas' : ''
                      }`}
                      data-holder-id={pessoa.holder_id}
                    >
                      <div class="bolsistas__pessoa-identidade">
                        <span class="bolsistas__pessoa-nome">{pessoa.nome}</span>
                        <details class="bolsistas__equipe">
                          <summary
                            class="chip bolsistas__equipe-chip"
                            aria-label={`Equipe de ${pessoa.nome}: ${rotuloEquipe(pessoa.equipe)}`}
                          >
                            {rotuloEquipe(pessoa.equipe)}
                          </summary>
                          <div
                            class="bolsistas__equipe-opcoes"
                            role="group"
                            aria-label={`Escolher equipe de ${pessoa.nome}`}
                          >
                            {EQUIPES.map((opcao) => (
                              <button
                                key={opcao.valor}
                                type="button"
                                class="bolsistas__equipe-opcao"
                                aria-pressed={equipe === opcao.valor ? 'true' : 'false'}
                                onClick={(evento) => {
                                  const detalhes = evento.currentTarget.closest('details');
                                  if (detalhes) detalhes.open = false;
                                  escolherEquipe(pessoa, opcao.valor);
                                }}
                              >
                                {equipe === opcao.valor && (
                                  <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                                )}
                                {opcao.rotulo}
                              </button>
                            ))}
                          </div>
                        </details>
                      </div>

                      <div class="bolsistas__pessoa-conteudo">
                        <div class="bolsistas__bolsas">
                          {bolsasVisiveis.map((bolsa) => (
                            <span
                              key={bolsa.scholarship_id}
                              class={`bolsistas__bolsa${
                                bolsa.vigente_hoje ? '' : ' bolsistas__bolsa--apagada'
                              }`}
                              title={bolsa.vigente_hoje ? 'Vigente hoje' : 'Não vigente hoje'}
                            >
                              {bolsaTexto(bolsa)}
                            </span>
                          ))}
                        </div>

                        <p class="bolsistas__pessoa-soma">
                          <span class="bolsistas__pessoa-valor">
                            soma vigente hoje (todos os seus centros):{' '}
                            <strong>{dinheiro(pessoa.valor_vigente, { centavos: false })}</strong>/mês
                          </span>
                          {temCentroDesmarcado && (
                            <span class="bolsistas__pessoa-aviso-centro">
                              inclui bolsa de centro desmarcado
                            </span>
                          )}
                        </p>
                      </div>

                      {dados.caixas.length > 0 && (
                        <div class="bolsistas__pessoa-acoes">
                          {dados.caixas.map((caixa) => {
                            const esta = caixaAtual?.id === caixa.id;
                            return esta ? (
                              <span
                                key={caixa.id}
                                class="bolsistas__marcador"
                                data-caixa-id={caixa.id}
                                data-holder-id={pessoa.holder_id}
                                aria-label={`${pessoa.nome} está na caixa ${caixa.nome}`}
                              >
                                Na caixa {caixa.nome}
                              </span>
                            ) : (
                              <Botao
                                key={caixa.id}
                                variante="secundario"
                                tamanho="compacto"
                                className="bolsistas__botao-colocar"
                                data-caixa-id={caixa.id}
                                data-holder-id={pessoa.holder_id}
                                onClick={() => colocarPessoaNaCaixa(pessoa, caixa)}
                                desabilitado={emAcao}
                              >
                                Pôr em {caixa.nome}
                              </Botao>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside ref={caixasRef} class="bolsistas__caixas" aria-label="Caixas do pedido">
            <div class="bolsistas__caixas-topo">
              <h2 class="bolsistas__caixas-titulo">Caixas</h2>
              <Botao
                variante="primario"
                tamanho="compacto"
                icone={Plus}
                onClick={abrirNovaCaixa}
                desabilitado={emAcao}
              >
                Nova caixa
              </Botao>
            </div>

            {faltamNasCaixasDasEquipes().length > 0 && (
              <div class="bolsistas__caixas-equipes">
                <p class="bolsistas__caixas-equipes-texto">
                  {faltamNasCaixasDasEquipes()
                    .map((g) => `${g.pessoas.length} de ${g.nome}`)
                    .join(' e ')}{' '}
                  ainda fora das caixas.
                </p>
                <Botao
                  variante="secundario"
                  tamanho="compacto"
                  onClick={montarCaixasDasEquipes}
                  desabilitado={emAcao}
                >
                  Montar caixas {faltamNasCaixasDasEquipes().map((g) => g.nome).join(' e ')}
                </Botao>
              </div>
            )}

            {mostrarNovaCaixa && (
              <form class="bolsistas__nova-caixa" onSubmit={criarCaixa}>
                <Campo
                  rotulo="Nome"
                  valor={novaCaixa.nome}
                  aoMudar={(nome) => setNovaCaixa((anterior) => ({ ...anterior, nome }))}
                  placeholder="Time Pastagem"
                  maxLength={80}
                />
                <Campo
                  rotulo="Meses"
                  tipo="number"
                  valor={novaCaixa.meses}
                  aoMudar={(meses) => setNovaCaixa((anterior) => ({ ...anterior, meses }))}
                  min={1}
                  max={60}
                />
                <div class="bolsistas__nova-caixa-acoes">
                  <Botao variante="primario" tamanho="compacto" tipo="submit" desabilitado={emAcao}>
                    Criar caixa
                  </Botao>
                  <Botao
                    variante="fantasma"
                    tamanho="compacto"
                    onClick={() => setMostrarNovaCaixa(false)}
                    desabilitado={emAcao}
                  >
                    Cancelar
                  </Botao>
                </div>
              </form>
            )}

            {dados.caixas.length === 0 ? (
              <Vazio
                mensagem="Nenhuma caixa ainda. Crie a primeira para montar o time."
                rotuloBotao="Nova caixa"
                aoClicar={abrirNovaCaixa}
              />
            ) : (
              dados.caixas.map((caixa) => (
                <CaixaPedido
                  key={caixa.id}
                  caixa={caixa}
                  pessoasPorId={pessoasPorId}
                  emAcao={emAcao}
                  onSalvarCaixa={(id, nome, meses) => salvarCaixa(id, nome, meses)}
                  onApagarCaixa={(id) => executar(() => apagarCaixaPedido(id))}
                  onTirar={(caixaId, holderId) => executar(() => tirarDaCaixa(caixaId, holderId))}
                  onSalvarItem={(caixaId, holderId, valor, nota) =>
                    executar(() => editarItemCaixa(caixaId, holderId, valor, nota))
                  }
                  onLimparOcultos={limparOcultos}
                />
              ))
            )}
          </aside>
        </div>
      )}

      {dados && (
        <aside class="bolsistas__barra-caixas" aria-label="Resumo das caixas">
          <div class="bolsistas__barra-resumo">
            {dados.caixas.length === 0 ? (
              <span class="bolsistas__barra-vazio">Nenhuma caixa ainda.</span>
            ) : (
              dados.caixas.map((caixa) => (
                <span key={caixa.id} class="bolsistas__barra-caixa">
                  {caixa.nome}: {caixa.pessoas} ·{' '}
                  {dinheiro(caixa.total_mensal, { centavos: false })}/mês
                </span>
              ))
            )}
          </div>
          {dados.caixas.length === 0 ? (
            <Botao
              variante="primario"
              tamanho="compacto"
              onClick={abrirNovaCaixa}
              desabilitado={emAcao}
            >
              Nova caixa
            </Botao>
          ) : (
            <Botao variante="secundario" tamanho="compacto" onClick={rolarParaCaixas}>
              Ver caixas
            </Botao>
          )}
        </aside>
      )}
    </div>
  );
}
