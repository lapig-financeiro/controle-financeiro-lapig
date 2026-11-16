/**
 * Trecho para colar em OUTROS scripts do Apps Script.
 *
 * Uso:
 *   painelRegistrar_('Backup do Drive', 'OK', 'tudo certo', '', 24);
 *
 * O painel é auxiliar: esta função nunca lança erro para quem chamou.
 * Devolve true quando gravou e false quando desistiu.
 */

var PAINEL_PLANILHA_ID = '1PpcLkC_s4qllvNP4tHW7c2c2zDNJQOHsp2X2fLmt8Tk';

function painelRegistrar_(rotina, estado, resumo, detalhe, intervaloHoras) {
  try {
    // Normaliza antes de tocar na planilha.
    rotina = String(rotina == null ? '' : rotina).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!rotina) return false;

    estado = String(estado == null ? '' : estado).trim().toUpperCase();
    if (estado !== 'OK' && estado !== 'AVISO' && estado !== 'FALHOU') estado = 'AVISO';

    resumo = String(resumo == null ? '' : resumo).slice(0, 300);
    detalhe = String(detalhe == null ? '' : detalhe).slice(0, 45000);
    intervaloHoras = Number(intervaloHoras);
    if (!isFinite(intervaloHoras) || intervaloHoras <= 0) intervaloHoras = 24;

    // Sem LockService de propósito: a trava de script é a mesma de quem chama
    // (soltá-la aqui soltaria a dele) e não protege entre scripts diferentes.

    var planilha = SpreadsheetApp.openById(PAINEL_PLANILHA_ID);
    var quando = new Date().toISOString();
    var conta = '';
    try {
      conta = String(Session.getEffectiveUser().getEmail() || '');
    } catch (erroConta) {
      conta = '';
    }

    // Aba Estado: uma linha por rotina (upsert pela coluna A).
    var aba = planilha.getSheetByName('Estado');
    if (!aba) aba = planilha.insertSheet('Estado');
    var total = aba.getLastRow();
    var temCabecalho = false;
    if (total > 0) {
      var primeira = aba.getRange(1, 1, 1, 7).getValues()[0];
      temCabecalho = String(primeira[0] == null ? '' : primeira[0]).trim() !== '';
    }
    if (!temCabecalho) {
      aba.getRange(1, 1, 1, 7).setValues([
        ['rotina', 'estado', 'ultima_execucao', 'resumo', 'detalhe', 'intervalo_horas', 'conta']
      ]);
    }

    var linhaAlvo = 0;
    if (total > 1) {
      var linhas = aba.getRange(2, 1, total - 1, 7).getValues();
      for (var i = 0; i < linhas.length; i++) {
        var nome = String(linhas[i][0] == null ? '' : linhas[i][0]).trim();
        if (nome === rotina) {
          linhaAlvo = i + 2;
          break;
        }
      }
    }

    var valores = [rotina, estado, quando, resumo, detalhe, intervaloHoras, conta];
    if (linhaAlvo > 0) {
      aba.getRange(linhaAlvo, 1, 1, 7).setValues([valores]);
    } else {
      aba.appendRow(valores);
    }

    // Aba Historico: só append.
    var historico = planilha.getSheetByName('Historico');
    if (!historico) historico = planilha.insertSheet('Historico');
    var totalHistorico = historico.getLastRow();
    var historicoTemCabecalho = false;
    if (totalHistorico > 0) {
      var primeiraHist = historico.getRange(1, 1, 1, 4).getValues()[0];
      historicoTemCabecalho = String(primeiraHist[0] == null ? '' : primeiraHist[0]).trim() !== '';
    }
    if (!historicoTemCabecalho) {
      historico.getRange(1, 1, 1, 4).setValues([['quando', 'rotina', 'estado', 'resumo']]);
    }
    historico.appendRow([quando, rotina, estado, resumo]);

    return true;
  } catch (erro) {
    return false;
  }
}
