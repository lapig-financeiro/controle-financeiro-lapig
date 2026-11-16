import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    // Node 25+ traz um localStorage global experimental que fica `undefined` sem --localstorage-file e esconde o
    // do happy-dom/jsdom (9 testes da revisão de plano falhavam com o Node 26). A CI usa Node 22, sem o problema.
    execArgv: ['--no-experimental-webstorage'],
  },
});
