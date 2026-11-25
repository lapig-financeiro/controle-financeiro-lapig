// Mapa das ferramentas da Análise. Uma por arquivo do contrato §4.

import * as listarCentros from './listar_centros.js';
import * as explicarLivre from './explicar_livre.js';
import * as situacaoCentro from './situacao_centro.js';
import * as desembolsos from './desembolsos.js';
import * as termosContrato from './termos_contrato.js';
import * as pendencias from './pendencias.js';
import * as bolsas from './bolsas.js';
import * as criarBloco from './criar_bloco.js';
import * as calcular from './calcular.js';

export const FERRAMENTAS = {
  [listarCentros.nome]: listarCentros,
  [explicarLivre.nome]: explicarLivre,
  [situacaoCentro.nome]: situacaoCentro,
  [desembolsos.nome]: desembolsos,
  [termosContrato.nome]: termosContrato,
  [pendencias.nome]: pendencias,
  [bolsas.nome]: bolsas,
  [criarBloco.nome]: criarBloco,
  [calcular.nome]: calcular,
};

export const FERRAMENTAS_COM_RPC = [
  'listar_centros',
  'explicar_livre',
  'situacao_centro',
  'desembolsos',
  'termos_contrato',
  'pendencias',
  'bolsas',
];
