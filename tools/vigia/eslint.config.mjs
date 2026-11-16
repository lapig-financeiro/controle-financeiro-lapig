// Configuração própria: respeita o escopo da tarefa, sem editar o lint da raiz.
import globals from 'globals';
export default [
  { ignores: ['**/dist/**'] },
  { files: ['**/*.js'], languageOptions: { ecmaVersion:2022, sourceType:'commonjs', globals:{...globals.node,
    VigiaUtil:'readonly',VigiaMascara:'readonly',VigiaTriagem:'readonly',VigiaLigacao:'readonly',VigiaEvidencia:'readonly',VigiaPrazos:'readonly',VigiaModelo:'readonly',VigiaProcessar:'readonly',VigiaResumo:'readonly',
    VigiaGmail:'readonly',VigiaSupabase:'readonly',VigiaOllama:'readonly',VigiaAvisos:'readonly',VigiaMain:'readonly',
    GmailApp:'readonly',UrlFetchApp:'readonly',PropertiesService:'readonly',LockService:'readonly',MailApp:'readonly',ScriptApp:'readonly',CacheService:'readonly',
    SpreadsheetApp:'readonly',Session:'readonly',painelRegistrar_:'readonly'
  } }, rules:{'no-undef':'error','no-unused-vars':['error',{args:'none',caughtErrors:'none',varsIgnorePattern:'^(checar|resumoDiario|testarConfiguracao|testarModelo|instalarGatilhos|Vigia|painelRegistrar_)'}],
    'no-dupe-keys':'error','no-dupe-args':'error','no-unreachable':'error','no-async-promise-executor':'error','no-unsafe-negation':'error'} }
];
