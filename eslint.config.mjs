// The lint gate. Type-aware typescript-eslint rules run on the shipped code (src/, server/src/) and the build and
// release scripts, through tsconfig.json's checkJs. Tests get the untyped rules only.
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
      // An empty attribute or config string means "not set" throughout, so `||` on strings is deliberate.
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
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
          // An empty handler, one that never names the error, or one that only answers a constant
          // (`() => null`, `(error) => ({})`, `() => undefined`) all drop the rejection unseen.
          selector: [
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='BlockStatement'][body.body.length=0]",
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[params.length=0]",
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type=/^(Literal|ObjectExpression|ArrayExpression|TemplateLiteral)$/]",
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression > Identifier.body[name='undefined']",
          ].join(', '),
          message: "Don't swallow a rejection. Report it, or ignore it through a helper whose name says why.",
        },
        {
          selector:
            "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/], CallExpression > MemberExpression.callee[property.name='insertAdjacentHTML']",
          message:
            'HTML from Shopify goes through setStoreHtml() in src/dom.js, which removes script; everything else is text.',
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
      // A fake API answers many routes in one function, as the real one does behind its router.
      complexity: 'off',
      'no-restricted-syntax': 'off',
    },
  },
  prettier,
);
