# Working on Tether

Tether puts a live Shopify store into Webflow, Astro or any HTML page through `tether-*` attributes: products, cart, subscriptions and customer accounts. The optional Worker in `server/` syncs Shopify products to the Webflow CMS. This page is for anyone changing the code, people and coding agents alike. `CLAUDE.md` points here.

## Layout

| Folder | Runs in | Notes |
| --- | --- | --- |
| `src/` | the visitor's browser; `server.ts`, `initial.ts` and `astro.ts` also run in Node at build time | Built by `scripts/build.ts` into `dist/` |
| `server/src/` | the user's own Cloudflare Worker, or Node through `bin/tether-sync.ts` | TypeScript run from source through Node's type stripping (Node 22.18 or newer), so it never gets a build step. Deployed copies keep a pinned workflow that runs `scripts/update-tether.mjs` and imports `src/entry.js`: those two and `bin/tether-sync.js` stay as one-line JavaScript shims |
| `server/src/shared/` | the browser and the Worker | Imports nothing outside itself; dependency-cruiser enforces the layers |
| `types/` | `tsc` (`npm run test:types`) | `check.ts` uses the package the way the docs show, against the declarations the test build generates into `.test-dist/types/` |
| `test/`, `server/test/` | `node --test` with jsdom | `e2e/` is Playwright on the Astro starter |

The source is TypeScript, checked by `tsc` on top of `@tsconfig/strictest`. Node runs it unbuilt, so only erasable syntax is allowed (`erasableSyntaxOnly`: no `enum`, `namespace` or parameter properties), type-only imports say so (`verbatimModuleSyntax`), and relative imports name the real `.ts` file. Tests stay JavaScript and import the `.ts` sources; on Node before 22.18 the npm scripts pass `--experimental-strip-types`. Every file is fully typed; `// @ts-nocheck` and type casts that hide a wrong type are not accepted.

The published `.d.ts` files are generated from the source, never hand-written: `scripts/build.ts` runs `tsc` with `tsconfig.declarations.json` on the entry points (`index.ts`, `server.ts`, `astro.ts`, `presets/barba.ts`) into `dist/types/`. A type a site imports by name is a type export of its entry point. The `window` globals the published types declare are in `src/globals.d.ts`, which the source's own program leaves out, so the source still reads those globals as unknown.

## The gate

`npm run check` runs, in order:

1. Prettier;
2. ESLint (typescript-eslint `strict-type-checked`);
3. `tsc`;
4. Knip;
5. dependency-cruiser;
6. the tests.

lefthook runs Prettier and ESLint on staged files before each commit, and `npm run check` before each push. CI (`.github/workflows/ci.yml`) runs `npm run check` on every pull request and push to main, on Node 22.18 and 24, and the release workflow runs it before it publishes. Before calling work done, run `npm run check`. When a change sends a new query or mutation, also run `npm run smoke`.

There is no lint baseline: every rule holds for every file.

## Public API

These are compatibility promises:

- every `tether-*` attribute and `tether:*` event in `docs/`;
- every `TETHER_CONFIG` key;
- the `window.Tether` object;
- the `@occluze/tether`, `/server`, `/astro` and `/presets/barba` exports;
- the `dist/` file names;
- the Worker's routes, env names and KV keys.

A refactor keeps all of them. A change to one is a behaviour change, with a CHANGELOG line.

## Principles

- **Simplicity first.** No single-use abstraction, no configurability nobody asked for, no error handling for impossible cases.
- **One method per concern.** One Storefront client (`client.ts`), one place that formats money, one sealing scheme for anything stored. No fallback chains.
- **Surgical changes.** A refactor and a behaviour change are separate commits. Formatting-only commits go in `.git-blame-ignore-revs`.
- **Never disable a lint rule to get green.** Fix the code. If a rule is wrong for a line, the disable comment says why.
- **State is a union, not a set of booleans or strings.** If two fields must agree, make them one field.
- **Input is parsed where it arrives.** Check attributes, `localStorage`, `<meta>`, URL parameters, request bodies and webhook payloads once, at the boundary. Values go into GraphQL variables, never into the query text.
- **Errors are reported (`reportError`) or ignored by a name that says why.** No empty `catch`, no `.catch(() => {})`.
- **Comments state why, at HEAD.** No history, no lists of examples. See the `writing-comments` skill.

## Skills and agents

`.claude/skills/` holds `code-clarity`, `types-not-workarounds`, `writing-comments`, `codebase-design` and `shopify-apis`. `.claude/agents/` holds `type-design-analyzer`, `comment-analyzer` and `silent-failure-hunter`. Sources and licences are in `.claude/skills/SOURCES.md`.

## Releases

`dist/` changes only in a release commit. `npm test` builds into `.test-dist/`. Never run `npm run release`, tag, publish to npm or change the repository's settings: the owner does those.
