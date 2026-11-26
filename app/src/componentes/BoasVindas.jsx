import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { urlProjeto } from '../roteador.js';
import { Botao } from './Botao.jsx';
import './BoasVindas.css';

function chave(usuarioId) {
  return `cf_boas_vindas_${usuarioId || 'local'}`;
}

export function boasVindasVista(usuarioId) {
  try {
    return window.localStorage.getItem(chave(usuarioId)) === 'visto';
  } catch {
    return true;
  }
}

export function marcarBoasVindasVista(usuarioId) {
  try {
    window.localStorage.setItem(chave(usuarioId), 'visto');
  } catch {
    // O guia continua disponível pelo menu.
  }
}

export function BoasVindas({ aoFechar, isAdmin, podeBolsistas, rota, centros, onNavegar }) {
  const [indice, setIndice] = useState(-1);
  const tituloId = useId();
  const tituloRef = useRef(null);
  const centro = centros.find((item) => item.id === rota.id) || centros[0];
  const passos = [
    {
      titulo: 'Encontre um centro de custo',
      texto: 'Em Projetos, cada linha abre um centro de custo. Passe o mouse ou toque no selo de situação para ver o motivo.',
      pagina: 'projetos',
      caminho: '#/projetos',
      acao: 'Ir para Projetos',
    },
    {
      titulo: 'Confira de onde vem o saldo livre',
      texto: centro
        ? 'Na aba Dinheiro, clique no valor sublinhado ou abra uma rubrica para conferir o que já foi gasto e o que está comprometido.'
        : 'Quando houver um centro visível, abra a aba Dinheiro e clique no valor sublinhado para conferir como o saldo foi calculado.',
      pagina: 'projeto',
      caminho: centro ? urlProjeto(centro.id, 'dinheiro') : null,
      acao: 'Abrir o centro',
      aba: 'dinheiro',
    },
    {
      titulo: 'Acompanhe as pendências',
      texto: 'Abra o sino no topo. Se houver uma pendência de um centro, clique nela para abrir a aba Pendências.',
    },
    {
      titulo: 'Faça uma pergunta ao Assistente',
      texto: 'Abra Nova conversa (no celular, fica em Conversas). Clique numa sugestão para preencher o campo e edite a pergunta antes de enviar.',
      pagina: 'analise',
      caminho: '#/analise',
      acao: 'Ir para Análise',
    },
  ];
  if (podeBolsistas) {
    passos.push({
      titulo: 'Monte um pedido de bolsas',
      texto: 'Em Bolsistas, filtre por centro ou equipe e use as caixas para reunir as pessoas do pedido.',
      pagina: 'bolsistas',
      caminho: '#/bolsistas',
      acao: 'Ir para Bolsistas',
    });
  }
  if (isAdmin) {
    passos.push({
      titulo: 'Confira os acessos em Admin',
      texto: 'Abra um login para ver a quais centros ele tem acesso. O filtro de centros no topo muda apenas a sua própria tela.',
      pagina: 'admin',
      caminho: '#/admin',
      acao: 'Ir para Admin',
    });
  }

  useEffect(() => {
    tituloRef.current?.focus();
  }, [indice]);

  const passo = passos[indice];
  const naTela = passo?.pagina === rota.pagina &&
    (!passo.aba || passo.aba === (rota.aba || 'dinheiro'));
  const ultimo = indice === passos.length - 1;

  const irParaPasso = (proximo) => {
    setIndice(proximo);
    const caminho = passos[proximo].caminho;
    if (caminho) onNavegar(caminho);
  };

  return (
    <div class="conteudo boas-vindas">
      <section class="boas-vindas__cartao" aria-labelledby={tituloId}>
        <div class="boas-vindas__cabecalho">
          <p class="boas-vindas__contexto">
            {passo ? `Como usar o site · Passo ${indice + 1} de ${passos.length}` : 'Guia do Buriti'}
          </p>
          <Botao variante="fantasma" tamanho="compacto" onClick={aoFechar}>
            {passo ? 'Sair do guia' : 'Agora não'}
          </Botao>
        </div>
        <h2 id={tituloId} class="boas-vindas__titulo" ref={tituloRef} tabIndex={-1}>
          {passo?.titulo || 'Como usar o site'}
        </h2>
        <p class="texto-corrido">
          {passo?.texto || 'Passe pelas telas do Buriti e veja como consultar seus centros de custo. Você pode voltar ao guia pelo menu com as suas iniciais.'}
        </p>
        <div class="boas-vindas__acoes">
          {indice > 0 && <Botao variante="fantasma" onClick={() => irParaPasso(indice - 1)}>Voltar</Botao>}
          {passo?.caminho && !naTela && (
            <Botao onClick={() => onNavegar(passo.caminho)}>{passo.acao}</Botao>
          )}
          <Botao variante={passo ? 'secundario' : 'primario'} onClick={ultimo ? aoFechar : () => irParaPasso(indice + 1)}>
            {ultimo ? 'Concluir' : passo ? 'Próximo' : 'Iniciar tour'}
          </Botao>
        </div>
      </section>
    </div>
  );
}
