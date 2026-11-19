import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIRETORIO_PAGINAS = path.resolve(__dirname, '../src/paginas');

function listarArquivosJsx(diretorio) {
  const resultado = [];
  for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
    const completo = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarArquivosJsx(completo));
    } else if (entrada.name.endsWith('.jsx')) {
      resultado.push(completo);
    }
  }
  return resultado.sort();
}

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

function removerParentesesExternos(expr) {
  let s = expr.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let prof = 0;
    let aspa = null;
    let fechaNoFim = true;
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      if (aspa) {
        if (c === '\\') {
          i += 1;
          continue;
        }
        if (c === aspa) aspa = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') aspa = c;
      else if (c === '(' || c === '{' || c === '[') prof += 1;
      else if (c === ')' || c === '}' || c === ']') {
        prof -= 1;
        if (prof === 0 && i < s.length - 1) {
          fechaNoFim = false;
          break;
        }
      }
    }
    if (!fechaNoFim || prof !== 0) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

function dividirTernarioNivelZero(expr) {
  let profParen = 0;
  let profChave = 0;
  let profColchete = 0;
  let aspa = null;
  let idxInterrogacao = -1;
  let ternariosAninhados = 0;

  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (aspa) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === aspa) aspa = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      aspa = c;
      continue;
    }
    if (c === '(') profParen += 1;
    else if (c === ')') profParen -= 1;
    else if (c === '{') profChave += 1;
    else if (c === '}') profChave -= 1;
    else if (c === '[') profColchete += 1;
    else if (c === ']') profColchete -= 1;
    else if (profParen === 0 && profChave === 0 && profColchete === 0) {
      if (c === '?' && expr[i + 1] !== '?' && expr[i + 1] !== '.') {
        if (idxInterrogacao === -1) idxInterrogacao = i;
        else ternariosAninhados += 1;
      } else if (c === ':' && idxInterrogacao !== -1) {
        if (ternariosAninhados === 0) {
          return {
            consequente: expr.slice(idxInterrogacao + 1, i).trim(),
            alternativa: expr.slice(i + 1).trim(),
          };
        }
        ternariosAninhados -= 1;
      }
    }
  }
  return null;
}

function temAndNivelZero(expr) {
  let profParen = 0;
  let profChave = 0;
  let profColchete = 0;
  let aspa = null;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (aspa) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === aspa) aspa = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      aspa = c;
      continue;
    }
    if (c === '(') profParen += 1;
    else if (c === ')') profParen -= 1;
    else if (c === '{') profChave += 1;
    else if (c === '}') profChave -= 1;
    else if (c === '[') profColchete += 1;
    else if (c === ']') profColchete -= 1;
    else if (
      profParen === 0 &&
      profChave === 0 &&
      profColchete === 0 &&
      c === '&' &&
      expr[i + 1] === '&'
    ) {
      return true;
    }
  }
  return false;
}

function exprJsNaoNula(raw) {
  const v = removerParentesesExternos(raw);
  if (!v || v === 'null' || v === 'undefined' || v === 'false' || v === '""' || v === "''" || v === '0' || v === 'NaN') {
    return false;
  }
  const ternario = dividirTernarioNivelZero(v);
  if (ternario) {
    return exprJsNaoNula(ternario.consequente) && exprJsNaoNula(ternario.alternativa);
  }
  if (temAndNivelZero(v)) {
    return false;
  }
  return true;
}

function expressaoNaoNula(attr) {
  if (!attr) return false;
  if (attr.tipo === 'string') return attr.valor.trim().length > 0;
  if (attr.tipo === 'expr') return exprJsNaoNula(attr.valor);
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

export function verificarOrigemDeclaradaEmDiretorio(diretorio) {
  const arquivos = listarArquivosJsx(diretorio);
  const todasViolacoes = [];
  for (const caminho of arquivos) {
    const relativo = path.relative(diretorio, caminho).replace(/\\/g, '/');
    const conteudo = fs.readFileSync(caminho, 'utf8');
    todasViolacoes.push(...verificarOrigemDeclaradaEmCodigo(conteudo, relativo));
  }
  return { arquivos, violacoes: todasViolacoes };
}

describe('regra da origem declarada em app/src/paginas/', () => {
  it('todo <Valor> monetário em paginas/ (incluindo subpastas) declara origem+onOrigem ou semOrigem (pulando datas)', () => {
    const { arquivos, violacoes } = verificarOrigemDeclaradaEmDiretorio(DIRETORIO_PAGINAS);
    expect(arquivos.length).toBeGreaterThan(0);
    expect(violacoes).toEqual([]);
  });

  it('reprova casos sem origem/onOrigem válidos, ternário com ramo nulo e subpastas sem declaração', () => {
    const codigo = `
      export function Exemplo({ pode, abrir }) {
        return (
          <>
            <Valor valor={100} />
            <Valor valor={200} origem={{ id: '1' }} />
            <Valor valor={300} onOrigem={abrir} />
            <Valor valor={400} origem={null} onOrigem={abrir} />
            <Valor valor={500} semOrigem="" />
            <Valor valor={510} origem={pode ? { resumo: 'Ver' } : null} onOrigem={abrir} />
            <Valor valor={520} origem={{ resumo: 'Ver' }} onOrigem={pode ? abrir : undefined} />
            <Valor valor={530} origem={pode && { resumo: 'Ver' }} onOrigem={abrir} />
            <Valor valor="2026-10-15" tipo="data" />
            <Valor valor="2026-10-15" tipo="data-completa" />
            <Valor valor={600} semOrigem="soma desta tela" />
            <Valor valor={700} origem={{ resumo: 'ok' }} onOrigem={abrir} />
            <Valor valor={800} origem={pode ? { resumo: 'A' } : { resumo: 'B' }} onOrigem={abrir} />
            <Valor valor={900} origem={pode ? { resumo: 'A' } : null} onOrigem={pode ? abrir : null} semOrigem="sem detalhe" />
          </>
        );
      }
    `;

    const violacoes = verificarOrigemDeclaradaEmCodigo(codigo, 'Teste.jsx');
    expect(violacoes).toHaveLength(8);

    // Confere varredura recursiva em subpasta.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'origem-decl-'));
    try {
      const subpasta = path.join(tmp, 'sub', 'detalhe');
      fs.mkdirSync(subpasta, { recursive: true });
      fs.writeFileSync(
        path.join(subpasta, 'Interna.jsx'),
        'export function Interna() { return <Valor valor={10} />; }\n',
        'utf8'
      );
      const res = verificarOrigemDeclaradaEmDiretorio(tmp);
      expect(res.arquivos).toHaveLength(1);
      expect(res.violacoes).toHaveLength(1);
      expect(res.violacoes[0].arquivo).toBe('sub/detalhe/Interna.jsx');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
