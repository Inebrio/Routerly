import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

// Flat-config port of the former .eslintrc.json. Linted: every packages/*/src
// .ts/.tsx file, tests and dashboard included. Type-aware rules are
// off: they took ~3 min and reported ~10k pre-existing findings.
export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.js'] },
  js.configs.recommended,
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
    },
    // eslint-plugin-react-hooks is not a dependency; stub its rule so the existing
    // `eslint-disable react-hooks/exhaustive-deps` comments resolve.
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': { rules: { 'exhaustive-deps': { create: () => ({}) } } },
    },
    rules: {
      ...tsPlugin.configs['flat/recommended'].reduce((a, c) => ({ ...a, ...c.rules }), {}),
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', disallowTypeAnnotations: false }],
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Tests use throwing generators as stream stubs and loosely typed mocks/fixtures.
    files: ['packages/*/src/**/*.test.{ts,tsx}'],
    rules: { 'require-yield': 'off', 'no-control-regex': 'off', 'no-empty-pattern': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
];
