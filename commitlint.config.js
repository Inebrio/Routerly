/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Tipi ammessi
    'type-enum': [
      2,
      'always',
      [
        'feat',     // nuova funzionalità
        'fix',      // correzione bug
        'docs',     // solo documentazione
        'style',    // formattazione, spazi bianchi, ecc.
        'refactor', // refactoring senza fix né feature
        'perf',     // miglioramento performance
        'test',     // aggiunta o modifica test
        'build',    // build system, dipendenze esterne
        'ci',       // configurazione CI/CD
        'chore',    // manutenzione generica
        'revert',   // revert di un commit precedente
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
  },
};
