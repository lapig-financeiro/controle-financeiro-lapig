import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIRETORIO_PAGINAS = path.resolve(__dirname, '../src/paginas');

function pularString(codigo, inicio, aspa) {
  let i = inicio + 1;
  while (i < codigo.length) {
    const c = codigo[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === aspa) return i + 1;
    i += 1;
  }
  return codigo.length;
}

function extrairTagsValor(codigo) {
  const tags = [];
  let i = 0;

  while (i < codigo.length) {
    // Pula comentários JS e blocos JSX {/* ... */}
    if (codigo[i] === '/' && codigo[i + 1] === '/') {
      const fim = codigo.indexOf('\n', i + 2);
      i = fim === -1 ? codigo.length : fim + 1;
      continue;
    }
    if (codigo[i] === '/' && codigo[i + 1] === '*') {
      const fim = codigo.indexOf('*/', i + 2);
      i = fim === -1 ? codigo.length : fim + 2;
      continue;
    }

    if (codigo.startsWith('<Valor', i) && /[\s/>]/.test(codigo[i + 6] || '')) {
      const linha = codigo.slice(0, i).split('\n').length;
      let j = i + 6;
      let chaves = 0;
      let aspa = null;

      while (j < codigo.length) {
        const c = codigo[j];
        if (aspa) {
          if (c === '\\') {
            j += 2;
            continue;
          }
          if (c === aspa) aspa = null;
          j += 1;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') {
          aspa = c;
          j += 1;
          continue;
        }
        if (c === '{') {
          chaves += 1;
          j += 1;
          continue;
        }
        if (c === '}') {
          if (chaves > 0) chaves -= 1;
          j += 1;
          continue;
        }
        if (chaves === 0 && c === '>') {
          tags.push({ linha, bruto: codigo.slice(i + 6, j) });
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }

    i += 1;
  }

  return tags;
}

function parsearAtributos(bruto) {
  const attrs = new Map();
  let i = 0;

  while (i < bruto.length) {
    while (i < bruto.length && /[\s/]/.test(bruto[i])) i += 1;
    if (i >= bruto.length) break;

    const matchNome = bruto.slice(i).match(/^([a-zA-Z_$][a-zA-Z0-9_$-]*)/);
    if (!matchNome) {
      i += 1;
      continue;
    }
    const nome = matchNome[1];
    i += nome.length;

    while (i < bruto.length && /\s/.test(bruto[i])) i += 1;
    if (bruto[i] !== '=') {
      attrs.set(nome, { tipo: 'bool', valor: true });
      continue;
    }

    i += 1;
    while (i < bruto.length && /\s/.test(bruto[i])) i += 1;

    if (bruto[i] === '"' || bruto[i] === "'") {
      const aspa = bruto[i];
      const fim = pularString(bruto, i, aspa);
      attrs.set(nome, { tipo: 'string', valor: bruto.slice(i + 1, fim - 1) });
      i = fim;
      continue;
    }

    if (bruto[i] === '{') {
      let chaves = 0;
      let j = i;
      let aspa = null;
      while (j < bruto.length) {
        const c = bruto[j];
        if (aspa) {
          if (c === '\\') {
            j += 2;
            continue;
          }
          if (c === aspa) aspa = null;
          j += 1;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') {
          aspa = c;
          j += 1;
          continue;
        }
        if (c === '{') chaves += 1;
        else if (c === '}') {
          chaves -= 1;
          if (chaves === 0) {
            j += 1;
            break;
          }
        }
        j += 1;
      }
      attrs.set(nome, { tipo: 'expr', valor: bruto.slice(i + 1, j - 1).trim() });
      i = j;
    }
  }

  return attrs;
}

function expressaoNaoNula(attr) {
  if (!attr) return false;
  if (attr.tipo === 'string') return attr.valor.trim().length > 0;
  if (attr.tipo === 'expr') {
    const v = attr.valor.trim();
    if (!v || v === 'null' || v === 'undefined' || v === 'false' || v === '""' || v === "''") {
      return false;
    }
    return true;
  }
  return false;
}

export function verificarOrigemDeclaradaEmCodigo(codigo, arquivo = 'Pagina.jsx') {
  const tags = extrairTagsValor(codigo);
  const violacoes = [];

  for (const tag of tags) {
    const attrs = parsearAtributos(tag.bruto);
    const tipoAttr = attrs.get('tipo');

    // Datas ficam de fora da regra (tipo começando por "data").
    if (tipoAttr) {
      const valorLimpo = tipoAttr.valor
        ? String(tipoAttr.valor).replace(/^['"`]|['"`]$/g, '').trim()
        : '';
      if (valorLimpo.startsWith('data')) continue;
    }

    const temOrigemCompleta =
      expressaoNaoNula(attrs.get('origem')) && expressaoNaoNula(attrs.get('onOrigem'));
    const temSemOrigem = expressaoNaoNula(attrs.get('semOrigem'));

    if (!temOrigemCompleta && !temSemOrigem) {
      violacoes.push({
        arquivo,
        linha: tag.linha,
        detalhe: '<Valor> monetário em paginas/ exige (origem + onOrigem) ou semOrigem="<motivo>"',
      });
    }
  }

  return violacoes;
}

describe('regra da origem declarada em app/src/paginas/', () => {
  it('todo <Valor> monetário em paginas/ declara origem+onOrigem ou semOrigem (pulando datas)', () => {
    const arquivos = fs
      .readdirSync(DIRETORIO_PAGINAS)
      .filter((nome) => nome.endsWith('.jsx'))
      .sort();

    expect(arquivos.length).toBeGreaterThan(0);

    const todasViolacoes = [];
    for (const nome of arquivos) {
      const conteudo = fs.readFileSync(path.join(DIRETORIO_PAGINAS, nome), 'utf8');
      todasViolacoes.push(...verificarOrigemDeclaradaEmCodigo(conteudo, nome));
    }

    expect(todasViolacoes).toEqual([]);
  });

  it('reprova casos sem origem/onOrigem/semOrigem válidos e aceita datas e casos declarados', () => {
    const codigo = `
      export function Exemplo({ pode, abrir }) {
        return (
          <>
            <Valor valor={100} />
            <Valor valor={200} origem={{ id: '1' }} />
            <Valor valor={300} onOrigem={abrir} />
            <Valor valor={400} origem={null} onOrigem={abrir} />
            <Valor valor={500} semOrigem="" />
            <Valor valor="2026-10-15" tipo="data" />
            <Valor valor="2026-10-15" tipo="data-completa" />
            <Valor valor={600} semOrigem="soma desta tela" />
            <Valor valor={700} origem={{ resumo: 'ok' }} onOrigem={abrir} />
          </>
        );
      }
    `;

    const violacoes = verificarOrigemDeclaradaEmCodigo(codigo, 'Teste.jsx');
    expect(violacoes).toHaveLength(5);
  });
});
