// The lint gate. Type-aware typescript-eslint rules run on the TypeScript sources (the shipped code in src/ and
// server/src/, and the scripts) and on the JavaScript tests, which .config/tsconfig/test.json and e2e.json type-check.
// The JavaScript shims that old deployed copies call get the untyped rules only.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TEST_FILES = ['test/**/*.js', 'server/test/**/*.js', 'e2e/**/*.{js,mjs}'];
const TYPED_FILES = [
  'src/**/*.ts',
  'server/src/**/*.ts',
  'server/bin/*.ts',
  'server/scripts/*.ts',
  'scripts/*.ts',
  ...TEST_FILES,
];

const SWALLOWED_REJECTION = {
  // An empty handler, one that never names the error, or one that only answers a constant
  // (`() => null`, `(error) => ({})`, `() => undefined`) all drop the rejection unseen.
  selector: [
    "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='BlockStatement'][body.body.length=0]",
    "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[params.length=0]",
    "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type=/^(Literal|ObjectExpression|ArrayExpression|TemplateLiteral)$/]",
    "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression > Identifier.body[name='undefined']",
  ].join(', '),
  message: "Don't swallow a rejection. Report it, or ignore it through a helper whose name says why.",
};

const UNSANITISED_HTML = {
  selector:
    "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/], CallExpression > MemberExpression.callee[property.name='insertAdjacentHTML']",
  message:
    'HTML from Shopify goes through setStoreHtml() in src/dom.ts, which removes script; everything else is text.',
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.test-dist/**',
      'node_modules/**',
      'examples/**',
      'test-results/**',
      'playwright-report/**',
      // Declarations only, outside the source's programs (.config/tsconfig/browser.json); npm run test:types compiles them.
      'src/globals.d.ts',
    ],
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
      '@typescript-eslint/no-floating-promises': [
        'error',
        // node:test runs and reports every test it is given; the promise test() returns needs no handling.
        { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'describe', 'it'] }] },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // An empty attribute or config string means "not set" throughout, so `||` on strings is deliberate.
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: [
      'src/server.ts',
      'src/astro.ts',
      'server/**/*.{js,mjs,ts}',
      'scripts/**/*.ts',
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
      'no-restricted-syntax': ['error', SWALLOWED_REJECTION, UNSANITISED_HTML],
    },
  },
  {
    files: TEST_FILES,
    rules: {
      // Tests write fixture markup, which is the test's own text, not Shopify's.
      'no-restricted-syntax': ['error', SWALLOWED_REJECTION],
      // A fake of an async API is async itself, so it rejects rather than throws, as the real one does.
      '@typescript-eslint/require-await': 'off',
      // A stub that does nothing is the point of the stub.
      '@typescript-eslint/no-empty-function': 'off',
      // GSAP's ScrollTrigger is a class used through its static methods, and its fakes are too.
      '@typescript-eslint/no-extraneous-class': ['error', { allowStaticOnly: true, allowEmpty: true }],
    },
  },
  prettier,
);
