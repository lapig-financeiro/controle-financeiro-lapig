import { Botao } from './Botao.jsx';
import { PainelLateral } from './PainelLateral.jsx';
import './BoasVindas.css';

function chave(usuarioId) {
  return `cf_boas_vindas_${usuarioId || 'local'}`;
}

/** Já viu o guia neste navegador? Sem `localStorage`, conta como visto: o guia nunca insiste. */
export function boasVindasVista(usuarioId) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return true;
    return window.localStorage.getItem(chave(usuarioId)) === 'visto';
  } catch {
    return true;
  }
}

export function marcarBoasVindasVista(usuarioId) {
  try {
    window.localStorage?.setItem(chave(usuarioId), 'visto');
  } catch {
    /* sem localStorage o guia volta no próximo acesso; não é erro */
  }
}

/**
 * Guia rápido de primeiro acesso, num painel lateral. Abre sozinho uma vez
 * por login (por navegador) e volta pelo menu do usuário, em "Como usar o site".
 */
export function BoasVindas({ aberto = false, aoFechar, isAdmin = false }) {
  const passos = [
    {
      titulo: 'Projetos',
      texto:
        'Cada linha é um centro de custo. O número principal é quanto está livre para gastar: o previsto no plano menos o que já saiu e o que já está comprometido (bolsas e taxas). Passe o mouse no selo de situação para ver o motivo.',
    },
    {
      titulo: 'Todo número tem origem',
      texto:
        'Número sublinhado abre de onde ele vem. Na página do projeto, clique numa rubrica e use “Ver no balancete ›” ou “Ver no plano ›” para abrir o documento na linha de onde saiu o valor.',
    },
    {
      titulo: 'Bolsistas',
      texto: 'As bolsas dos seus centros, com o fim de cada uma. Ali também se monta o pedido de bolsas, em caixas.',
    },
    {
      titulo: 'Análise',
      texto:
        'Pergunte em português, como para uma pessoa: “quanto o meu centro tem livre e de onde vem?”. A resposta traz números que abrem a origem e tabelas com “Copiar tabela”, para colar numa planilha. São até 50 perguntas por dia, e as conversas ficam no seu histórico.',
    },
    {
      titulo: 'Sino',
      texto: 'O sino no alto mostra as pendências abertas dos seus centros. Clique numa para ir até ela.',
    },
  ];
  if (isAdmin) {
    passos.push({
      titulo: 'Admin',
      texto:
        'Quem vê qual centro. O botão de centros no alto (“Todos os centros”, ou “X de Y centros” quando há algum escondido) esconde centros só da sua tela; não muda o que os outros veem.',
    });
  }

  return (
    <PainelLateral aberto={aberto} aoFechar={aoFechar} titulo="Como usar o site" subtitulo="Um guia de um minuto">
      <div class="boas-vindas">
        <ol class="boas-vindas__lista">
          {passos.map((passo) => (
            <li key={passo.titulo} class="boas-vindas__passo">
              <h3 class="boas-vindas__titulo">{passo.titulo}</h3>
              <p class="boas-vindas__texto texto-corrido">{passo.texto}</p>
            </li>
          ))}
        </ol>
        <p class="boas-vindas__nota">
          Este guia fica no menu com as suas iniciais, no canto de cima, em “Como usar o site”.
        </p>
        <div class="boas-vindas__acoes">
          <Botao variante="primario" onClick={aoFechar}>
            Entendi
          </Botao>
        </div>
      </div>
    </PainelLateral>
  );
}
