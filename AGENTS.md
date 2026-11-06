# Working on Tether

Tether puts a live Shopify store into Webflow, Astro or any HTML page through `tether-*` attributes: products, cart, subscriptions and customer accounts. The optional Worker in `server/` syncs Shopify products to the Webflow CMS. This page is for anyone changing the code, people and coding agents alike. `CLAUDE.md` points here.

## Layout

| Folder | Runs in | Notes |
| --- | --- | --- |
| `src/` | the visitor's browser; `server.js`, `initial.js` and `astro.js` also run in Node at build time | Built by `scripts/build.mjs` into `dist/` |
| `server/src/` | the user's own Cloudflare Worker, or Node through `bin/tether-sync.js` | Plain JavaScript, run from source. Deployed copies update it with a pinned workflow that imports `src/entry.js` with plain Node, so it never gets a build step |
| `server/src/shared/` | the browser and the Worker | Imports nothing outside itself; dependency-cruiser enforces the layers |
| `types/` | | The published `.d.ts` files |
| `test/`, `server/test/` | `node --test` with jsdom | `e2e/` is Playwright on the Astro starter |

The source is JavaScript with JSDoc types, checked by `tsc` (`checkJs` on top of `@tsconfig/strictest`). Every file is fully typed; `// @ts-nocheck` and type casts that hide a wrong type are not accepted.

## The gate

`npm run check` runs, in order:

1. Prettier;
2. ESLint (typescript-eslint `strict-type-checked`);
3. `tsc`;
4. Knip;
5. dependency-cruiser;
6. the tests.

lefthook runs Prettier and ESLint on staged files before each commit, and `npm run check` before each push. Before calling work done, run `npm run check`. When a change sends a new query or mutation, also run `npm run smoke`.

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
- **One method per concern.** One Storefront client (`client.js`), one place that formats money, one sealing scheme for anything stored. No fallback chains.
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
