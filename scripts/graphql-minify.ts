/**
 * Minifies the GraphQL in Tether's template literals at build time, so the source keeps readable queries.
 *
 * Template literals are found by TypeScript's parser, not by pairing backticks: a backtick in a regular expression, a
 * string or a comment would pair with the wrong one and mangle the code around it.
 */
import ts from 'typescript';

/** Text that looks like GraphQL: an operation, a fragment, an inline fragment or a selection of Tether's fields. */
const GRAPHQL = /\b(query|mutation|fragment)\b|\.\.\. ?on |\{[^}]*\b(id|nodes|amount|cart)\b/;

const minifyGraphqlText = (text: string): string =>
  text
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ?([{}():,!=@[\]]) ?/g, '$1');

/** A template literal's source range and its replacement. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * @param template A template literal, with or without `${…}`.
 * @returns Its replacement when its text looks like GraphQL: the text minified, every `${…}` kept as written.
 */
function minifyTemplate(code: string, source: ts.SourceFile, template: ts.TemplateLiteral): Edit | null {
  const start = template.getStart(source);
  // Each literal piece's text without its delimiters: `…`, `…${, }…${ or }…`.
  const pieces = ts.isNoSubstitutionTemplateLiteral(template)
    ? [code.slice(start + 1, template.end - 1)]
    : [
        code.slice(start + 1, template.head.end - 2),
        ...template.templateSpans.map((span) =>
          code.slice(span.literal.getStart(source) + 1, span.literal.end - (ts.isTemplateTail(span.literal) ? 1 : 2)),
        ),
      ];
  if (!GRAPHQL.test(pieces.join(' '))) return null;
  // Each expression's source between its `${` (the end of the piece before) and its `}` (the start of the next).
  const expressions = ts.isNoSubstitutionTemplateLiteral(template)
    ? []
    : template.templateSpans.map((span, index) =>
        code.slice(template.templateSpans[index - 1]?.literal.end ?? template.head.end, span.literal.getStart(source)),
      );
  let text = '`';
  pieces.forEach((piece, index) => {
    text += minifyGraphqlText(piece);
    const expression = expressions[index];
    if (expression !== undefined) text += `\${${expression}}`;
  });
  return { start, end: template.end, text: `${text}\`` };
}

/**
 * Collapses whitespace and drops the spaces around punctuation in the template literals that look like GraphQL, only
 * in their text, never inside `${…}`.
 *
 * @param fileName Only for the parser's messages and its choice of TypeScript or JavaScript.
 */
export function minifyGraphqlTemplates(code: string, fileName = 'module.ts'): string {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const edits: Edit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const edit = minifyTemplate(code, source, node);
      // A GraphQL template's `${…}` are kept as written, so nothing inside it is edited twice.
      if (edit) {
        edits.push(edit);
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  let result = code;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
