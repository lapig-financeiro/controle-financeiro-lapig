#!/usr/bin/env node
// Bancada de testes da Análise.
//
// Roda o próprio `worker/src/index.js` no Node — sem wrangler — com o Supabase
// simulado a partir de um retrato das RPCs e o modelo em um dos três modos:
// local (Ollama deste PC), chave (ollama.com de verdade) ou roteiro (sem rede).
//
//   node worker/bancada/rodar.mjs \
//     --roteiro worker/bancada/exemplo/roteiro.json \
//     --retrato worker/bancada/exemplo/retrato.json \
//     --perguntas worker/bancada/exemplo/perguntas.json
//
// A saída vai para worker/bancada/saida/ (eventos.jsonl + relatorio.md), que é
// ignorada pelo git. O código de saída é 0 só quando todas as perguntas passam.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { carregarRetrato } from './retrato.mjs';
import { carregarRoteiro, lerChave } from './modelo.mjs';
import { executarPergunta } from './executor.mjs';
import { formatarEventosJsonl, formatarRelatorio } from './relatorio.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../..');

const MODELO_PADRAO = 'deepseek-v4.1-flash:cloud';

const AJUDA = `Uso: node worker/bancada/rodar.mjs [opções]

  --modelo <nome>       modelo do Ollama (padrão: ${MODELO_PADRAO})
  --retrato <arquivo>   retrato das RPCs (padrão: worker/bancada/exemplo/retrato.json)
  --perguntas <arquivo> bateria de perguntas (padrão: worker/bancada/exemplo/perguntas.json)
  --roteiro <arquivo>   respostas prontas do /api/chat; não usa rede
  --chave <arquivo>     lê a OLLAMA_API_KEY de um arquivo de uma linha e usa ollama.com
  --saida <pasta>       pasta de saída (padrão: worker/bancada/saida/)
  --so 3,8              roda só as perguntas com esses ids
  --ajuda, -h           mostra esta ajuda

Sem --roteiro nem --chave, o modelo é o Ollama local em http://localhost:11434.`;

function caminhoDoUsuario(valor) {
  return path.resolve(process.cwd(), valor);
}

export function analisarArgumentos(argv) {
  const opcoes = {
    modelo: MODELO_PADRAO,
    retrato: path.join(RAIZ, 'worker', 'bancada', 'exemplo', 'retrato.json'),
    perguntas: path.join(RAIZ, 'worker', 'bancada', 'exemplo', 'perguntas.json'),
    saida: path.join(RAIZ, 'worker', 'bancada', 'saida'),
    roteiro: null,
    chave: null,
    so: null,
    ajuda: false,
  };

  for (let indice = 0; indice < argv.length; indice += 1) {
    const argumento = argv[indice];
    const valor = () => {
      if (indice + 1 >= argv.length) throw new Error(`falta o valor de ${argumento}`);
      indice += 1;
      return argv[indice];
    };

    switch (argumento) {
      case '--modelo':
        opcoes.modelo = valor();
        break;
      case '--retrato':
        opcoes.retrato = caminhoDoUsuario(valor());
        break;
      case '--perguntas':
        opcoes.perguntas = caminhoDoUsuario(valor());
        break;
      case '--roteiro':
        opcoes.roteiro = caminhoDoUsuario(valor());
        break;
      case '--chave':
        opcoes.chave = caminhoDoUsuario(valor());
        break;
      case '--saida':
        opcoes.saida = caminhoDoUsuario(valor());
        break;
      case '--so':
        opcoes.so = valor()
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        if (!opcoes.so.length) throw new Error('--so precisa de ao menos um id');
        break;
      case '--ajuda':
      case '-h':
        opcoes.ajuda = true;
        break;
      default:
        throw new Error(`argumento desconhecido: ${argumento}`);
    }
  }

  if (opcoes.roteiro && opcoes.chave) {
    throw new Error('use --roteiro ou --chave, não os dois');
  }

  return opcoes;
}

export async function carregarPerguntas(caminho) {
  let dados;
  try {
    dados = JSON.parse(await readFile(caminho, 'utf8'));
  } catch {
    throw new Error(`não foi possível ler as perguntas: ${caminho}`);
  }

  const lista = Array.isArray(dados) ? dados : dados && dados.perguntas;
  if (!Array.isArray(lista) || lista.length === 0) {
    throw new Error('as perguntas precisam ser uma lista não vazia (ou { "perguntas": [...] })');
  }

  for (const [indice, pergunta] of lista.entries()) {
    if (!pergunta || typeof pergunta !== 'object' || Array.isArray(pergunta)) {
      throw new Error(`a pergunta ${indice + 1} não é um objeto`);
    }
    if (pergunta.id === undefined || pergunta.id === null || pergunta.id === '') {
      throw new Error(`a pergunta ${indice + 1} não tem "id"`);
    }
    if (typeof pergunta.pergunta !== 'string' || !pergunta.pergunta.trim()) {
      throw new Error(`a pergunta ${pergunta.id} não tem "pergunta"`);
    }
    if (pergunta.espera !== undefined && (!pergunta.espera || typeof pergunta.espera !== 'object')) {
      throw new Error(`a espera da pergunta ${pergunta.id} precisa ser um objeto`);
    }
    if (pergunta.cenario !== undefined && (!pergunta.cenario || typeof pergunta.cenario !== 'object')) {
      throw new Error(`o cenário da pergunta ${pergunta.id} precisa ser um objeto`);
    }
    if (pergunta.anteriores !== undefined && !Array.isArray(pergunta.anteriores)) {
      throw new Error(`"anteriores" da pergunta ${pergunta.id} precisa ser uma lista`);
    }
  }

  return lista;
}

function descreverModo(modo) {
  if (modo === 'roteiro') return 'roteiro (sem rede)';
  if (modo === 'chave') return 'chave (ollama.com)';
  return 'local (localhost:11434)';
}

async function main() {
  const opcoes = analisarArgumentos(process.argv.slice(2));
  if (opcoes.ajuda) {
    console.log(AJUDA);
    return 0;
  }

  const modo = opcoes.roteiro ? 'roteiro' : opcoes.chave ? 'chave' : 'local';

  const retrato = await carregarRetrato(opcoes.retrato);
  const perguntas = await carregarPerguntas(opcoes.perguntas);

  let selecionadas = perguntas;
  if (opcoes.so) {
    const desejadas = new Set(opcoes.so.map(String));
    const existentes = new Set(perguntas.map((pergunta) => String(pergunta.id)));
    const faltando = [...desejadas].filter((id) => !existentes.has(id));
    if (faltando.length) throw new Error(`pergunta(s) não encontrada(s): ${faltando.join(', ')}`);
    selecionadas = perguntas.filter((pergunta) => desejadas.has(String(pergunta.id)));
  }

  const respostasRoteiro = opcoes.roteiro ? await carregarRoteiro(opcoes.roteiro) : [];
  const chave = opcoes.chave ? await lerChave(opcoes.chave) : null;

  const cursor = { indice: 0 };
  const resultados = [];

  console.log(`Bancada: ${selecionadas.length} pergunta(s), modelo ${opcoes.modelo}, ${descreverModo(modo)}.`);
  if (retrato.observacoes.length) {
    console.log(`Retrato: ${retrato.observacoes.length} observação(ões); o relatório detalha.`);
  }

  for (const definicao of selecionadas) {
    process.stdout.write(`[${definicao.id}] ${definicao.pergunta} … `);
    const resultado = await executarPergunta({
      definicao,
      retrato,
      modo,
      respostasRoteiro,
      cursor,
      chave,
      modelo: opcoes.modelo,
    });
    resultados.push(resultado);
    console.log(
      `${resultado.ok ? 'passou' : 'FALHOU'} (${(resultado.ms / 1000).toFixed(1)} s, ` +
        `${resultado.chamadas?.total ?? 0} chamadas externas)`,
    );
    for (const motivo of resultado.motivos) console.log(`    - ${motivo}`);
    for (const aviso of resultado.avisos ?? []) console.log(`    ! ${aviso}`);
  }

  await mkdir(opcoes.saida, { recursive: true });
  const arquivoEventos = path.join(opcoes.saida, 'eventos.jsonl');
  const arquivoRelatorio = path.join(opcoes.saida, 'relatorio.md');
  await writeFile(arquivoEventos, formatarEventosJsonl(resultados), 'utf8');
  await writeFile(
    arquivoRelatorio,
    formatarRelatorio({
      resultados,
      meta: {
        data: new Date().toISOString(),
        modo: descreverModo(modo),
        modelo: opcoes.modelo,
        retrato: path.basename(opcoes.retrato),
        observacoes: retrato.observacoes,
      },
    }),
    'utf8',
  );

  const passaram = resultados.filter((resultado) => resultado.ok).length;
  console.log(
    `Bancada: ${passaram}/${resultados.length} passaram. Relatório: ${arquivoRelatorio}`,
  );

  return passaram === resultados.length ? 0 : 1;
}

main()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro) => {
    console.error(`bancada: ${erro && erro.message ? erro.message : 'erro desconhecido'}`);
    process.exitCode = 2;
  });
