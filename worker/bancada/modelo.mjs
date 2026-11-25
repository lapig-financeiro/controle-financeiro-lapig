// Leitura do arquivo da chave e do roteiro do modelo.
//
// A chave nunca é impressa, gravada em log nem devolvida em mensagem de erro:
// este módulo só devolve o texto para o roteador montar o cabeçalho.

import { readFile } from 'node:fs/promises';

export async function lerChave(caminho) {
  let texto;
  try {
    texto = await readFile(caminho, 'utf8');
  } catch {
    throw new Error('Não foi possível ler o arquivo da chave.');
  }

  const chave = texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .find((linha) => linha !== '');

  if (!chave) throw new Error('O arquivo da chave está vazio.');
  return chave;
}

export async function carregarRoteiro(caminho) {
  let dados;
  try {
    dados = JSON.parse(await readFile(caminho, 'utf8'));
  } catch {
    throw new Error('O roteiro não é JSON válido.');
  }

  const lista = Array.isArray(dados) ? dados : dados && dados.respostas;
  if (!Array.isArray(lista)) {
    throw new Error('O roteiro precisa ser uma lista de respostas ou { "respostas": [...] }.');
  }
  if (!lista.length) throw new Error('O roteiro está vazio.');

  for (const [indice, resposta] of lista.entries()) {
    if (!resposta || typeof resposta !== 'object' || Array.isArray(resposta)) {
      throw new Error(`A resposta ${indice + 1} do roteiro não é um objeto.`);
    }
  }

  return lista;
}
