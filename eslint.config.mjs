// The lint gate. Type-aware typescript-eslint rules run on the shipped code (src/, server/src/) and the build and
// release scripts, through tsconfig.json's checkJs. Tests get the untyped rules only. Existing violations are counted
// in eslint-suppressions.json; a new one fails.
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
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

// In a file still marked `// @ts-nocheck` every value is `any`, so these rules would only count accesses. They turn
// on when the marker goes.
const UNTYPED_MARKER = /^(#!.*\r?\n)?\/\/ @ts-nocheck\b/;
const UNTYPED_FILES = ['src', 'server/src', 'server/bin', 'server/scripts', 'scripts']
  .flatMap((dir) => readdirSync(dir, { recursive: true }).map((file) => `${dir}/${file.split(sep).join('/')}`))
  .filter((file) => /\.m?js$/.test(file) && UNTYPED_MARKER.test(readFileSync(file, 'utf8')));
const ANY_RULES = [
  'no-unsafe-member-access',
  'no-unsafe-assignment',
  'no-unsafe-call',
  'no-unsafe-return',
  'no-unsafe-argument',
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
      // An empty attribute or config string means "not set" throughout, so `||` on strings is deliberate.
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
      // `// @ts-nocheck` marks a file whose JSDoc types are still missing (AGENTS.md); the count only goes down.
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-nocheck': false }],
    },
  },
  {
    files: UNTYPED_FILES,
    rules: Object.fromEntries(ANY_RULES.map((rule) => [`@typescript-eslint/${rule}`, 'off'])),
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
        {
          selector:
            "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/], CallExpression > MemberExpression.callee[property.name='insertAdjacentHTML']",
          message: 'HTML from Shopify goes through setTrustedHtml() in src/dom.js; everything else is text.',
        },
      ],
    },
  },
  {
    files: ['test/**', 'server/test/**', 'e2e/**'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      'max-statements-per-line': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  prettier,
);
