import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROPRIEDADES_SO_TOKENS = new Set([
  'font-size',
  'box-shadow',
  'border-radius',
]);

const PALAVRAS_PERMITIDAS = new Set(['0', 'none', 'inherit', 'initial', 'unset']);
const PALAVRAS_Z_PERMITIDAS = new Set(['0', 'auto', 'inherit', 'initial', 'unset']);
const PESOS_PERMITIDOS = new Set(['400', '500', '600', 'inherit', 'initial', 'unset']);
const QUEBRAS_PERMITIDAS = new Set(['640px', '900px', '1024px']);

function preservarQuebras(texto) {
  return texto.replace(/[^\n]/g, '');
}

function removerComentariosCss(conteudo) {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, preservarQuebras);
}

function removerComentariosJs(conteudo) {
  return conteudo
    .replace(/\/\*[\s\S]*?\*\//g, preservarQuebras)
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function mascararMediaQueries(css) {
  return css.replace(/@media\s*[^{]+/g, preservarQuebras);
}

function linhaDoIndice(conteudo, indice) {
  let linha = 1;
  for (let i = 0; i < indice; i += 1) {
    if (conteudo[i] === '\n') linha += 1;
  }
  return linha;
}

export function extrairTokens(conteudoTokensCss) {
  const semComentarios = removerComentariosCss(conteudoTokensCss);
  const tokens = new Set();
  const regex = /(--[a-zA-Z0-9-]+)\s*:/g;
  let match;
  while ((match = regex.exec(semComentarios)) !== null) {
    tokens.add(match[1]);
  }
  return tokens;
}

function valorUsaApenasTokens(valor) {
  const limpo = valor.replace(/!important\s*$/, '').trim();
  if (!limpo) return false;
  const semVars = limpo.replace(/var\(\s*--[a-z0-9-]+\s*\)/gi, ' ').trim();
  if (!semVars) return true;
  const partes = semVars.split(/\s+/).filter(Boolean);
  return partes.every((parte) => PALAVRAS_PERMITIDAS.has(parte));
}

function zIndexPermitido(valor) {
  const limpo = valor.replace(/!important\s*$/, '').trim();
  if (!limpo) return false;
  if (/^var\(\s*--[a-z0-9-]+\s*\)$/i.test(limpo)) return true;
  return PALAVRAS_Z_PERMITIDAS.has(limpo);
}

function pesoPermitido(valor) {
  const limpo = valor.replace(/!important\s*$/, '').trim();
  if (!limpo) return false;
  if (/^var\(\s*--[a-z0-9-]+\s*\)$/i.test(limpo)) return true;
  return PESOS_PERMITIDOS.has(limpo);
}

function dividirEntradasObjeto(miolo) {
  const entradas = [];
  let atual = '';
  let paren = 0;
  let colchete = 0;
  let chave = 0;
  let aspa = null;
  let escapado = false;

  for (let i = 0; i < miolo.length; i += 1) {
    const c = miolo[i];
    if (escapado) {
      atual += c;
      escapado = false;
      continue;
    }
    if (c === '\\' && aspa) {
      atual += c;
      escapado = true;
      continue;
    }
    if (aspa) {
      atual += c;
      if (c === aspa) aspa = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      aspa = c;
      atual += c;
      continue;
    }
    if (c === '(') paren += 1;
    else if (c === ')' && paren > 0) paren -= 1;
    else if (c === '[') colchete += 1;
    else if (c === ']' && colchete > 0) colchete -= 1;
    else if (c === '{') chave += 1;
    else if (c === '}' && chave > 0) chave -= 1;
    else if (c === ',' && paren === 0 && colchete === 0 && chave === 0) {
      if (atual.trim()) entradas.push(atual.trim());
      atual = '';
      continue;
    }
    atual += c;
  }
  if (atual.trim()) entradas.push(atual.trim());
  return entradas;
}

function lerObjetoStyleJsx(conteudo, indiceStyle) {
  const aposIgual = conteudo.slice(indiceStyle).replace(/^style\s*=\s*/, '');
  if (!aposIgual.startsWith('{{')) return null;

  let profundidade = 0;
  let fim = -1;
  for (let i = 0; i < aposIgual.length; i += 1) {
    if (aposIgual[i] === '{') profundidade += 1;
    else if (aposIgual[i] === '}') {
      profundidade -= 1;
      if (profundidade === 0) {
        fim = i;
        break;
      }
    }
  }
  if (fim === -1) return null;

  const miolo = aposIgual.slice(2, fim).replace(/\}\s*$/, '').trim();
  if (!miolo) return null;

  const entradas = dividirEntradasObjeto(miolo);
  if (entradas.length === 0) return null;

  const nomes = [];
  for (const entrada of entradas) {
    const m = entrada.match(/^['"](--[a-zA-Z0-9-]+)['"]\s*:/);
    if (!m) return null;
    nomes.push(m[1]);
  }
  return nomes;
}

function styleJsxPermitido(conteudo, indiceStyle) {
  return lerObjetoStyleJsx(conteudo, indiceStyle) !== null;
}

export function extrairCustomPropsJsx(conteudo) {
  const semComentarios = removerComentariosJs(conteudo);
  const props = new Set();
  const regexStyle = /\bstyle\s*=/g;
  let match;
  while ((match = regexStyle.exec(semComentarios)) !== null) {
    const nomes = lerObjetoStyleJsx(semComentarios, match.index);
    if (nomes) {
      for (const n of nomes) props.add(n);
    }
  }
  return props;
}

function verificarTokensReferenciados(
  arquivo,
  conteudoSemComentarios,
  tokensDefinidos,
  problemas,
  propsDinamicas = null
) {
  if (!tokensDefinidos || tokensDefinidos.size === 0) return;
  const regexVar = /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,|\))/g;
  let match;
  while ((match = regexVar.exec(conteudoSemComentarios)) !== null) {
    const token = match[1];
    if (!tokensDefinidos.has(token) && !propsDinamicas?.has(token)) {
      problemas.push({
        arquivo,
        linha: linhaDoIndice(conteudoSemComentarios, match.index),
        regra: 'token-inexistente',
        detalhe: `Variável ${token} não existe em tokens.css`,
      });
    }
  }
}

function verificarMediaQueries(arquivo, semComentarios, problemas) {
  const regexMedia = /@media\s*([^{]+)/g;
  let match;
  while ((match = regexMedia.exec(semComentarios)) !== null) {
    const condicao = match[1].trim();
    if (/^\(\s*prefers-reduced-motion\s*:\s*(reduce|no-preference)\s*\)$/.test(condicao)) {
      continue;
    }
    const quebraMatch = condicao.match(/^\(\s*(?:max|min)-width\s*:\s*(\d+px)\s*\)$/);
    if (!quebraMatch || !QUEBRAS_PERMITIDAS.has(quebraMatch[1])) {
      problemas.push({
        arquivo,
        linha: linhaDoIndice(semComentarios, match.index),
        regra: 'media-invalida',
        detalhe: `@media fora de 640px/900px/1024px ou prefers-reduced-motion: ${condicao}`,
      });
    }
  }
}

export function verificarArquivo(
  caminhoRelativo,
  conteudo,
  tokensDefinidos = null,
  propsDinamicas = null
) {
  const normalizado = caminhoRelativo.replace(/\\/g, '/');
  const problemas = [];
  const ext = path.extname(normalizado);

  if (normalizado.endsWith('estilo/tokens.css')) {
    const semComentarios = removerComentariosCss(conteudo);
    verificarTokensReferenciados(normalizado, semComentarios, tokensDefinidos, problemas);
    return problemas;
  }

  if (ext === '.css') {
    const semComentarios = removerComentariosCss(conteudo);
    verificarTokensReferenciados(
      normalizado,
      semComentarios,
      tokensDefinidos,
      problemas,
      propsDinamicas
    );
    verificarMediaQueries(normalizado, semComentarios, problemas);

    const regexCor = /(#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\()/g;
    let match;
    while ((match = regexCor.exec(semComentarios)) !== null) {
      problemas.push({
        arquivo: normalizado,
        linha: linhaDoIndice(semComentarios, match.index),
        regra: 'cor-literal',
        detalhe: `Cor literal fora de tokens.css: ${match[1]}`,
      });
    }

    const semMedia = mascararMediaQueries(semComentarios);
    const regexUnidade = /(-?(?:\d+\.\d+|\.\d+|\d+))(px|ms|vh)\b/gi;
    while ((match = regexUnidade.exec(semMedia)) !== null) {
      const numero = match[1];
      const unidade = match[2].toLowerCase();
      const completo = `${numero}${unidade}`;
      const ehUmPx = unidade === 'px' && (numero === '1' || numero === '-1');
      if (!ehUmPx) {
        problemas.push({
          arquivo: normalizado,
          linha: linhaDoIndice(semMedia, match.index),
          regra: 'medida-literal',
          detalhe: `Medida literal fora de tokens.css: ${completo}`,
        });
      }
    }

    const regexDecl = /(^|[;{\s])(font-size|font-weight|box-shadow|border-radius|z-index)\s*:\s*([^;{}]+)/gi;
    while ((match = regexDecl.exec(semComentarios)) !== null) {
      const prop = match[2].toLowerCase();
      const valor = match[3].trim();
      if (prop === 'font-weight') {
        if (!pesoPermitido(valor)) {
          problemas.push({
            arquivo: normalizado,
            linha: linhaDoIndice(semComentarios, match.index),
            regra: 'peso-proibido',
            detalhe: `font-weight fora de 400/500/600: ${valor}`,
          });
        }
      } else if (prop === 'z-index') {
        if (!zIndexPermitido(valor)) {
          problemas.push({
            arquivo: normalizado,
            linha: linhaDoIndice(semComentarios, match.index),
            regra: 'z-index-literal',
            detalhe: `z-index literal fora de tokens.css: ${valor}`,
          });
        }
      } else if (PROPRIEDADES_SO_TOKENS.has(prop) && !valorUsaApenasTokens(valor)) {
        problemas.push({
          arquivo: normalizado,
          linha: linhaDoIndice(semComentarios, match.index),
          regra: 'propriedade-literal',
          detalhe: `${prop}: ${valor} deve usar token de tokens.css`,
        });
      }
    }
  } else if (ext === '.js' || ext === '.jsx') {
    const semComentarios = removerComentariosJs(conteudo);
    verificarTokensReferenciados(
      normalizado,
      semComentarios,
      tokensDefinidos,
      problemas,
      propsDinamicas
    );

    const regexStyle = /\bstyle\s*=/g;
    let match;
    while ((match = regexStyle.exec(semComentarios)) !== null) {
      if (!styleJsxPermitido(semComentarios, match.index)) {
        problemas.push({
          arquivo: normalizado,
          linha: linhaDoIndice(semComentarios, match.index),
          regra: 'style-inline',
          detalhe: 'style= proibido em JSX (permitido apenas style={{ \'--var\': ... }})',
        });
      }
    }

    const regexCor = /(#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\()/g;
    while ((match = regexCor.exec(semComentarios)) !== null) {
      problemas.push({
        arquivo: normalizado,
        linha: linhaDoIndice(semComentarios, match.index),
        regra: 'cor-literal',
        detalhe: `Cor literal fora de tokens.css: ${match[1]}`,
      });
    }
  }

  return problemas;
}

function listarArquivos(diretorio) {
  const resultado = [];
  for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
    const completo = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarArquivos(completo));
    } else if (/\.(css|js|jsx)$/.test(entrada.name)) {
      resultado.push(completo);
    }
  }
  return resultado;
}

export function verificarEstilo(diretorioSrc, caminhoTokens = path.join(diretorioSrc, 'estilo/tokens.css')) {
  const tokensDefinidos = fs.existsSync(caminhoTokens)
    ? extrairTokens(fs.readFileSync(caminhoTokens, 'utf8'))
    : null;

  const arquivos = listarArquivos(diretorioSrc);
  const conteudos = new Map();
  const propsDinamicas = new Set();

  for (const arquivo of arquivos) {
    const conteudo = fs.readFileSync(arquivo, 'utf8');
    conteudos.set(arquivo, conteudo);
    if (/\.(js|jsx)$/.test(arquivo)) {
      for (const prop of extrairCustomPropsJsx(conteudo)) {
        propsDinamicas.add(prop);
      }
    }
  }

  const problemas = [];
  for (const arquivo of arquivos) {
    const relativo = path.relative(diretorioSrc, arquivo);
    problemas.push(
      ...verificarArquivo(relativo, conteudos.get(arquivo), tokensDefinidos, propsDinamicas)
    );
  }

  return problemas;
}

const ehPrincipal = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (ehPrincipal) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const diretorioSrc = path.resolve(__dirname, '../src');
  const problemas = verificarEstilo(diretorioSrc);

  if (problemas.length > 0) {
    console.error(`Guarda de estilo reprovou ${problemas.length} ocorrência(s):`);
    for (const p of problemas) {
      console.error(`  ${p.arquivo}:${p.linha} [${p.regra}] ${p.detalhe}`);
    }
    process.exitCode = 1;
  } else {
    console.log('Guarda de estilo: nenhuma violação encontrada.');
  }
}
