import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARCADORES_EXEMPLO = [
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

function listarArquivosBuild(diretorio) {
  const resultado = [];
  if (!fs.existsSync(diretorio)) return resultado;
  for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
    const completo = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarArquivosBuild(completo));
    } else if (/\.(js|css|html)$/i.test(entrada.name)) {
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

  const arquivos = listarArquivosBuild(diretorioDist);
  const temBundleJs = arquivos.some((a) => a.endsWith('.js'));
  if (!temBundleJs) {
    return [{ arquivo: 'dist/assets', marcador: 'nenhum arquivo .js encontrado' }];
  }

  const ocorrencias = [];
  for (const arquivo of arquivos) {
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
