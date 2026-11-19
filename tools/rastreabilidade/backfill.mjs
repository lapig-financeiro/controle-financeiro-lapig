#!/usr/bin/env node
/* ============================================================
   backfill.mjs
   CLI do backfill da F2-B.

   Uso:
     node tools/rastreabilidade/backfill.mjs [--aplicar] [--centro 30.117]
       [--saida <pasta fora do repositório>]

   Sem --aplicar só simula (não chama registrar_documento_v2).
   Login: CF_SUPABASE_URL, CF_SUPABASE_ANON_KEY, CF_EMAIL, CF_PASSWORD
   do ambiente. Exige admin humano: a 064 só aceita admin, e este
   script é rodado à mão, em simulação e depois aplicação, em turnos
   separados (desvio declarado da regra 9 de docs/acesso-ao-banco.md).
   ============================================================ */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarClienteDoAmbiente } from './cliente.mjs';
import { ErroUso } from './erros.mjs';
import {
  VERSAO,
  executarBackfill,
  formatarSaidaTerminal,
  pastaSaidaPadrao,
  validarPastaSaida,
} from './executar.mjs';

const USO = `Uso: node tools/rastreabilidade/backfill.mjs [--aplicar] [--centro <código>] [--saida <pasta fora do repositório>]

Sem --aplicar, só simula: baixa, confere e mostra as contagens, sem chamar
registrar_documento_v2. Com --aplicar, registra uma versão por documento
(idempotente pelo sha256).

Escopo: balancetes do ano corrente de projetos ativos com arquivo no Storage
e o plano ativo de cada projeto ativo com arquivo. O resto fica "legado".

Credenciais: CF_SUPABASE_URL, CF_SUPABASE_ANON_KEY, CF_EMAIL e CF_PASSWORD
do ambiente. Exige papel admin (lido em app_users). Nenhum valor é impresso.

--saida precisa ficar FORA do repositório. O JSON de detalhe (com trechos)
só é gravado lá; o terminal mostra apenas contagens.

Versão do parser: ${VERSAO}`;

export function lerArgumentos(argv) {
  const opcoes = { aplicar: false, centro: null, saida: null, ajuda: false };

  const valorDoArgumento = (valor, nome) => {
    if (valor == null || valor === '' || valor.startsWith('--')) {
      throw new ErroUso(`${nome} exige um valor.`);
    }
    return valor;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i];
    if (argumento === '--aplicar') {
      opcoes.aplicar = true;
    } else if (argumento === '--centro') {
      opcoes.centro = valorDoArgumento(argv[i + 1], '--centro');
      i += 1;
    } else if (argumento.startsWith('--centro=')) {
      opcoes.centro = valorDoArgumento(argumento.slice('--centro='.length), '--centro');
    } else if (argumento === '--saida') {
      opcoes.saida = valorDoArgumento(argv[i + 1], '--saida');
      i += 1;
    } else if (argumento.startsWith('--saida=')) {
      opcoes.saida = valorDoArgumento(argumento.slice('--saida='.length), '--saida');
    } else if (argumento === '--ajuda' || argumento === '--help' || argumento === '-h') {
      opcoes.ajuda = true;
    } else {
      throw new ErroUso(`Argumento desconhecido: ${argumento}`);
    }
  }

  return opcoes;
}

function carimboDeData(data) {
  const dois = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}${dois(data.getMonth() + 1)}${dois(data.getDate())}-`
    + `${dois(data.getHours())}${dois(data.getMinutes())}${dois(data.getSeconds())}`;
}

export async function principal(argv = process.argv.slice(2)) {
  const opcoes = lerArgumentos(argv);
  if (opcoes.ajuda) {
    console.log(USO);
    return;
  }

  // Correção 5 da 2ª rodada: a pasta --saida é validada e criada
  // ANTES de qualquer leitura (inclusive do ambiente) ou escrita.
  const pasta = validarPastaSaida(opcoes.saida || pastaSaidaPadrao());

  const cliente = criarClienteDoAmbiente(process.env);
  const detalhe = await executarBackfill({ cliente, opcoes });
  console.log(formatarSaidaTerminal(detalhe));

  const arquivo = path.join(pasta, `backfill-${carimboDeData(new Date())}.json`);
  writeFileSync(arquivo, `${JSON.stringify(detalhe, null, 2)}\n`, 'utf8');

  const origemPasta = opcoes.saida ? 'pasta informada em --saida' : 'pasta temporária fora do repositório';
  console.log(`\nDetalhe: ${path.basename(arquivo)} (${origemPasta}).`);
}

function mesmoArquivo(a, b) {
  const normalizar = (caminho) => {
    const resolvido = path.resolve(caminho);
    return process.platform === 'win32' ? resolvido.toLowerCase() : resolvido;
  };
  return normalizar(a) === normalizar(b);
}

const executadoDiretamente = process.argv[1]
  && mesmoArquivo(process.argv[1], fileURLToPath(import.meta.url));

if (executadoDiretamente) {
  principal().catch((erro) => {
    const seguro = erro && erro.seguro === true;
    console.error(`Erro: ${seguro ? erro.message : 'falha inesperada (o conteúdo não é impresso por segurança).'}`);
    process.exitCode = 1;
  });
}
