// The lint gate. Type-aware typescript-eslint rules run on the shipped code (src/, server/src/) and the build and
// release scripts, through tsconfig.json's checkJs. Tests get the untyped rules only. Existing violations are counted
// in eslint-suppressions.json; a new one fails.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// scripts/smoke.mjs runs the built dist/, like the tests, so it is linted untyped with them.
const TYPED_FILES = [
  'src/**/*.js',
  'server/src/**/*.js',
  'server/bin/*.js',
  'server/scripts/*.mjs',
  'scripts/{build,release,api-version}.mjs',
];

export default tseslint.config(
  {
    ignores: ['dist/**', '.test-dist/**', 'node_modules/**', 'examples/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  {
    files: TYPED_FILES,
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `// @ts-nocheck` marks a file whose JSDoc types are still missing (AGENTS.md); the count only goes down.
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-nocheck': false }],
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: [
      'src/server.js',
      'src/astro.js',
      'server/**/*.{js,mjs}',
      'scripts/**/*.mjs',
      'test/**/*.js',
      'e2e/**/*.{js,mjs}',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.serviceworker } },
  },
  {
    files: ['test/**/*.js', 'e2e/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Size and shape limits, for every file. A file or function past them is split, not exempted.
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 4],
      'max-statements-per-line': ['error', { max: 1 }],
      complexity: ['error', 20],
      'no-nested-ternary': 'error',
      'no-sequences': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='BlockStatement'][body.body.length=0]",
          message: "Don't swallow a rejection. Report it, or ignore it through a helper whose name says why.",
        },
      ],
    },
  },
  {
    files: ['test/**', 'server/test/**', 'e2e/**'],
    rules: { 'max-lines-per-function': 'off', 'max-lines': 'off', 'max-statements-per-line': 'off' },
  },
  prettier,
);
