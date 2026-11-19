import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARCADORES_EXEMPLO = [
  '__EXEMPLO_CF__',
  'Admin de exemplo',
  'exemplo@lapig.ufg.br',
  'Bacia do Cerrado Norte',
  'Atlas Hídrico do Planalto',
  'Monitoramento de Nascentes',
  'Mapeamento de Veredas',
  'Inventário Florestal Sul',
  'Rede de Estações Serra',
  'Corredor Ecológico Oeste',
  'Observatório de Solos Leste',
  'Profa. Clara Mendes',
  'Prof. Renato Alves',
  'Profa. Beatriz Cunha',
  'dadosExemplo',
];

export function verificarCspIndexHtml(html) {
  const matchHead = String(html || '').match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!matchHead) {
    return 'tag <head> ausente no index.html';
  }
  const head = matchHead[1];
  const matchCsp = head.match(/<meta\s[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/i);
  if (!matchCsp) {
    return 'meta Content-Security-Policy ausente no <head>';
  }
  const posCsp = matchCsp.index;
  const matchScript = head.match(/<script[\s>]/i);
  if (matchScript && matchScript.index < posCsp) {
    return 'meta Content-Security-Policy aparece depois de <script> no <head>';
  }
  const matchLink = head.match(/<link[\s>]/i);
  if (matchLink && matchLink.index < posCsp) {
    return 'meta Content-Security-Policy aparece depois de <link> no <head>';
  }
  return null;
}

function listarTodosArquivosBuild(diretorio) {
  const resultado = [];
  if (!fs.existsSync(diretorio)) return resultado;
  for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
    const completo = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarTodosArquivosBuild(completo));
    } else {
      resultado.push(completo);
    }
  }
  return resultado;
}

export function verificarBuild(diretorioDist, marcadores = MARCADORES_EXEMPLO) {
  const diretorioAssets = path.join(diretorioDist, 'assets');
  if (!fs.existsSync(diretorioAssets)) {
    return [{ arquivo: 'dist/assets', marcador: 'diretório ausente' }];
  }

  const todosArquivos = listarTodosArquivosBuild(diretorioDist);
  const arquivosTexto = todosArquivos.filter((a) => /\.(js|mjs|css|html|json)$/i.test(a));
  const temBundleJs = arquivosTexto.some((a) => /\.(js|mjs)$/i.test(a));
  if (!temBundleJs) {
    return [{ arquivo: 'dist/assets', marcador: 'nenhum arquivo .js encontrado' }];
  }

  const ocorrencias = [];
  const caminhoIndex = path.join(diretorioDist, 'index.html');
  if (fs.existsSync(caminhoIndex)) {
    const erroCsp = verificarCspIndexHtml(fs.readFileSync(caminhoIndex, 'utf8'));
    if (erroCsp) {
      ocorrencias.push({ arquivo: 'index.html', marcador: erroCsp });
    }
  }

  for (const arquivo of todosArquivos) {
    const relativo = path.relative(diretorioDist, arquivo).replace(/\\/g, '/');
    if (/\.(pdf|docx)$/i.test(arquivo)) {
      ocorrencias.push({ arquivo: relativo, marcador: 'arquivo de documento proibido no build' });
    }
  }

  for (const arquivo of arquivosTexto) {
    const conteudo = fs.readFileSync(arquivo, 'utf8');
    const relativo = path.relative(diretorioDist, arquivo).replace(/\\/g, '/');
    for (const marcador of marcadores) {
      if (conteudo.includes(marcador)) {
        ocorrencias.push({ arquivo: relativo, marcador });
      }
    }
  }
  return ocorrencias;
}

const ehPrincipal =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (ehPrincipal) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const diretorioDist = path.resolve(__dirname, '../dist');
  const ocorrencias = verificarBuild(diretorioDist);

  if (ocorrencias.length > 0) {
    console.error(`Verificação de build reprovou ${ocorrencias.length} ocorrência(s):`);
    for (const o of ocorrencias) {
      console.error(`  ${o.arquivo}: marcador "${o.marcador}" encontrado`);
    }
    process.exitCode = 1;
  } else {
    console.log('Verificação de build: nenhum dado de exemplo no bundle de produção.');
  }
}
