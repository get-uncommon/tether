import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minifyGraphqlTemplates } from '../scripts/graphql-minify.ts';

test('a GraphQL template is minified, its ${…} kept as written', () => {
  const code = 'const q = `\n  query Product($handle: String!) {\n    product(handle: $handle) { ${fields} }\n  }\n`;';
  assert.equal(
    minifyGraphqlTemplates(code),
    'const q = ` query Product($handle:String!){product(handle:$handle){${fields}}}`;',
  );
});

test('a backtick in a regular expression or a comment does not pair with a template', () => {
  const code = [
    'const COOKIE = /^[^`;]+$/;',
    '// a comment about the query `x`',
    'const label = `Hello ${name}`;',
    'const q = `{ cart { id } }`;',
  ].join('\n');
  const minified = minifyGraphqlTemplates(code);
  assert.equal(
    minified,
    [
      'const COOKIE = /^[^`;]+$/;',
      '// a comment about the query `x`',
      'const label = `Hello ${name}`;',
      'const q = `{cart{id}}`;',
    ].join('\n'),
  );
});

test('a template nested in a non-GraphQL template is still found', () => {
  const code = 'const s = `x ${f(`{ cart { id } }`)} y`;';
  assert.equal(minifyGraphqlTemplates(code), 'const s = `x ${f(`{cart{id}}`)} y`;');
});
