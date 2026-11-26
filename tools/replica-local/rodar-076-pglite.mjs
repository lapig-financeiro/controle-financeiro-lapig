// Base descartável em memória. Nenhuma conexão com produção.
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.cache/pglite-064/node_modules/@electric-sql/pglite/dist/index.js';
import { carregarArquivo, montarBase064 } from './rodar-064-pglite.mjs';
import { conferirRegrasCofre069 } from './rodar-069-pglite.mjs';

const migracao = 'database/076_acesso_pedido_bolsas.sql';
const db = new PGlite();
try {
  await montarBase064(db, { quiet: true });
  for (const arquivo of [
    'database/064_rastreabilidade.sql',
    'tools/replica-local/sintetico/stub-064.sql',
    'database/065_rastreabilidade_ajustes.sql',
    'database/066_taxas_comprometidas.sql',
    'database/067_termos_contrato.sql',
    'database/068_pedido_bolsas.sql',
    'database/069_motivos_e_ajustes.sql',
  ]) {
    await carregarArquivo(db, arquivo, { quiet: true });
  }

  const texto = await readFile(new URL('../../' + migracao, import.meta.url), 'utf8');
  conferirRegrasCofre069(texto);
  await carregarArquivo(db, migracao);
  await carregarArquivo(db, migracao);
  // Reproduz a ACL de tabela, para testar a policy mesmo se o papel tiver UPDATE.
  await db.exec('grant select, update on public.app_users to authenticated;');
  await carregarArquivo(db, 'tests/sql/test_076_acesso_pedido_bolsas.sql');

  // Exercita o fluxo completo do pedido com as contas dos roteiros antigos liberadas.
  await db.exec("update public.app_users set pode_bolsistas = true where role in ('admin', 'professor');");
  await carregarArquivo(db, 'tests/sql/test_068_pedido_bolsas.sql', { quiet: true });
  await carregarArquivo(db, 'tests/sql/test_069_motivos_e_ajustes.sql', { quiet: true });

  const teste051 = await readFile(new URL('../../tests/sql/test_051_buriti_propostas.sql', import.meta.url), 'utf8');
  const barreira = teste051.slice(teste051.indexOf('do $$'), teste051.indexOf('-- BLOCO 2'));
  await db.exec(barreira, { onNotice: (aviso) => console.log(aviso.message) });
  console.log('076 OK: permissão por conta, revogação, escopo, API da Análise, ACL e idempotência.');
} finally {
  await db.close();
}
