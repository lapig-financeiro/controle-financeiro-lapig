import { Botao } from './Botao.jsx';
import './Manutencao.css';

/**
 * Tela cheia de manutenção lida de `/controle-financeiro-lapig/manutencao.json`.
 * Quando ligada, impede interação e gravação; `aoFecharPrevia` existe apenas para demonstração.
 */
export function Manutencao({ mensagem, aoFecharPrevia = null }) {
  return (
    <div
      class="manutencao"
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-labelledby="manutencao-titulo"
    >
      <div class="manutencao__cartao">
        <img
          src={`${import.meta.env.BASE_URL}lapig-logo.svg`}
          alt="LAPIG"
          class="manutencao__logo"
        />
        <h1 id="manutencao-titulo" class="manutencao__titulo">
          Em atualização
        </h1>
        <p class="manutencao__mensagem texto-corrido">{mensagem}</p>
        {aoFecharPrevia && (
          <div class="manutencao__acao">
            <Botao variante="secundario" onClick={aoFecharPrevia}>
              Fechar pré-visualização
            </Botao>
          </div>
        )}
      </div>
    </div>
  );
}
