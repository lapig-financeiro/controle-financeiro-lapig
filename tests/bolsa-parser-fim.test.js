// Fim da bolsa como "início + N meses" na planilha da FUNAPE (30.106, 25/11/2026):
// contado mês a mês, o mês do fim entrava como pago e a bolsa durava um mês a mais.
// Planilha sintética (nomes e CPFs falsos), montada com o SheetJS do próprio site.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const raiz = path.resolve(import.meta.dirname, '..');

beforeAll(async () => {
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  if (typeof globalThis.XLSX === 'undefined') {
    vm.runInThisContext(fs.readFileSync(path.join(raiz, 'frontend/vendor/xlsx.full.min.js'), 'utf8'));
  }
  await import('../frontend/js/parsers/bolsa-parser.js');
});

function planilha(linhas) {
  const XLSX = globalThis.XLSX;
  const ws = XLSX.utils.json_to_sheet(linhas.map(([duracao, total], i) => ({
    Nome: `Pessoa Exemplo ${i + 1}`, CPF: '', 'E-mail': '', Tipo: 'Apoio', 'Formação': '',
    'Duração': duracao, 'Pagamento Automático': 'Sim', Status: 'Ativo', Valor: 500,
    'Total de Bolsas': total, 'Bolsas pagas/em aberto': 1,
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bolsas');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

describe('fimExclusivoCorrigido', () => {
  const f = (...a) => globalThis.fimExclusivoCorrigido(...a);
  it('dia do fim igual ao do início: o mês do fim não é pago', () => {
    expect(f('2026-08-01', '2027-01-01', 5)).toBe('2026-12-31');
    expect(f('2026-02-04', '2027-02-04', 12)).toBe('2027-01-31');
    expect(f('2026-02-04', '2027-02-04', null)).toBe('2027-01-31');
  });
  it('fim no último dia do mês fica como está', () => {
    expect(f('2026-10-01', '2026-11-30', 2)).toBeNull();
    expect(f('2024-11-01', '2026-11-30', 25)).toBeNull();
    expect(f('2026-01-31', '2026-03-31', 3)).toBeNull();
  });
  it('não corrige quando a conta corrigida não bate com o total de bolsas', () => {
    expect(f('2026-08-01', '2027-01-01', 6)).toBeNull();
  });
  it('não corrige datas que não fazem sentido', () => {
    expect(f('2026-08-01', '2026-08-01', 1)).toBeNull();
    expect(f('2026-08-15', '2026-08-15', null)).toBeNull();
    expect(f(null, '2027-01-01', 5)).toBeNull();
  });
});

describe('parseBolsaSpreadsheet com fim "início + N meses"', () => {
  it('corrige o fim e avisa sem nome nem CPF; a linha comum não muda', () => {
    const { data, warnings } = globalThis.parseBolsaSpreadsheet(planilha([
      ['01/08/2026 / 01/01/2027', 5],
      ['01/10/2026 / 30/11/2026', 2],
    ]));
    expect(data.map(r => [r.duracao_inicio, r.duracao_fim])).toEqual([
      ['2026-08-01', '2026-12-31'],
      ['2026-10-01', '2026-11-30'],
    ]);
    expect(warnings).toEqual([
      'Linha 2: o fim 01/01/2027 é "início + N meses" e esse mês não é pago; a bolsa foi contada até 31/12/2026.',
    ]);
  });
});
