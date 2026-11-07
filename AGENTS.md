# Working on Tether

Tether puts a live Shopify store into Webflow, Astro or any HTML page through `tether-*` attributes: products, cart, subscriptions and customer accounts. The optional Worker in `server/` syncs Shopify products to the Webflow CMS. This page is for anyone changing the code, people and coding agents alike. `CLAUDE.md` points here.

## Layout

| Folder                  | Runs in                                                                                        | Notes                                                                                                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                  | the visitor's browser; `server.ts`, `initial.ts` and `astro.ts` also run in Node at build time | Built by `scripts/build.ts` into `dist/`                                                                                                                                                                                                                                                     |
| `server/src/`           | the user's own Cloudflare Worker, or Node through `bin/tether-sync.ts`                         | TypeScript run from source through Node's type stripping (Node 22.18 or newer), so it never gets a build step. Deployed copies keep a pinned workflow that runs `scripts/update-tether.mjs` and imports `src/entry.js`: those two and `bin/tether-sync.js` stay as one-line JavaScript shims |
| `server/src/shared/`    | the browser and the Worker                                                                     | Imports nothing outside itself; dependency-cruiser enforces the layers                                                                                                                                                                                                                       |
| `test/types/`           | `tsc` (`npm run test:types`)                                                                   | `check.ts` uses the package the way the docs show, against the declarations the test build generates into `.test-dist/types/`                                                                                                                                                                |
| `test/`, `server/test/` | `node --test` with jsdom                                                                       | `test/e2e/` is Playwright on the Astro starter                                                                                                                                                                                                                                               |

The source is TypeScript, checked by `tsc` on top of `@tsconfig/strictest`. Node runs it unbuilt, so only erasable syntax is allowed (`erasableSyntaxOnly`: no `enum`, `namespace` or parameter properties), type-only imports say so (`verbatimModuleSyntax`), and relative imports name the real `.ts` file. Each runtime is its own program, with only that runtime's globals, in `.config/tsconfig/`: `browser.json` (the DOM), `node.json` (`server.ts`, `astro.ts` and `scripts/`), `worker.json` (the Web Worker scope), `worker-node.json` (the sync's CLI and scripts), and the root `tsconfig.json` references them all (`tsc -b`). Tests stay JavaScript, because deployed copies run `node --test test/*.test.js`, and import the `.ts` sources; `test.json` and `e2e.json` there type-check them (`checkJs`), so a fake is checked against the type it stands in for. On Node before 22.18 the npm scripts pass `--experimental-strip-types`. Every file is fully typed; `// @ts-nocheck` and type casts that hide a wrong type are not accepted.

The published `.d.ts` files are generated from the source, never hand-written: `scripts/build.ts` runs `tsc` with `.config/tsconfig/declarations.json` on the entry points (`index.ts`, `server.ts`, `astro.ts`, `presets/barba.ts`) into `dist/types/`. A type a site imports by name is a type export of its entry point. The `window` globals the published types declare are in `src/globals.d.ts`, which the source's own program leaves out, so the source still reads those globals as unknown.

## The gate

`npm run check` runs, in order:

1. Prettier;
2. ESLint (typescript-eslint `strict-type-checked`);
3. `tsc -b`, every program;
4. Knip;
5. dependency-cruiser;
6. the tests.

The tests run with `--test-force-exit`, so a handle a test leaves open can't hang the run; `scripts/test-leaks.ts` fails the file instead and lists its open handles after the run: a file it names has a server, socket, timer, child process or pending fs call to close. It gives each file's process, and what that starts, a temp folder of its own, and fails the file for anything its tests leave there; a test removes the folders it makes (`tempFolder` in `server/test/mocks.js`). A test that runs git in a scratch repository does it through `isolatedGit` (`test/fixtures.js`), without this machine's git config and with a time limit. It also names the tests still running when a file hit `--test-timeout`, where Node names only the file.

`npm run lint:workflows` (`scripts/lint-workflows.ts`) lints the workflows, `.github/workflows/` and the sync Worker's `server/.github/workflows/`, with actionlint, the shellcheck it runs on each `run:` script, and zizmor. CI's `workflows` job runs the same script, so the versions, and the sha256 each download is checked against, are in one place: `.config/workflow-linters.json`, with an entry for Linux x64, macOS arm64 and x64, and Windows x64. To move a tool to a new version, change its version, file names and hashes there (GitHub's asset digests for actionlint and shellcheck, PyPI's wheel hashes for zizmor); `test/release-workflows.test.js` checks the file's shape. The tools are downloaded once into `node_modules/.cache/workflow-linters/`; zizmor is installed there into a venv by pip with `--require-hashes`, so it needs Python 3. Without Python the script fails, unless the commits being pushed change no workflow. zizmor's online audits use `GH_TOKEN` or else `GITHUB_TOKEN` from the environment, never the GitHub CLI's login, and are skipped, with a note, without one; CI sets `GH_TOKEN`.

lefthook runs Prettier and ESLint on staged files before each commit, checks the commit message (`scripts/commit-msg.ts`: a capitalised plain-English subject of at most 120 characters, with no conventional-commit type or closing full stop, and a blank line before the body), and `npm run check` and `npm run lint:workflows` side by side before each push. The push's check is `scripts/pre-push.ts`, which reads the pushed refs git hands the hook: when each pushed ref only adds commits to the remote's (no force-push), and both the pushed tree and every pushed commit change only `examples/astro/package.json` and its lockfile (the commit `npm run release` makes to lock the starter), it runs `test/versions.test.js` and Prettier on those two files instead of the whole gate; for a rewritten history, any other file, a new branch or tag, or commits git can't compare, it runs `npm run check`. The workflow linters stay out of `npm run check`: CI's `check` job on each Node version, the release and the rehearsal run that gate too, and would each download and run them again, while CI runs them once, in its `workflows` job. The local hook runs on your own OS, so on Windows or macOS it can't see what differs on Linux (inode reuse, case-sensitive paths, file modes, signals, `/tmp`). CI's `check` job, on Ubuntu, is the first to run the tests there. A change that touches the file system, processes or paths is done when that job has passed, not when the hook has. CI (`.github/workflows/ci.yml`) runs `npm run check` on every pull request and push to main, on Node 22.18 and 24, and the release workflow runs it before it publishes. Before calling work done, run `npm run check`. When a change sends a new query or mutation, also run `npm run smoke`.

The tools' settings live in `.config/` (lefthook, dependency-cruiser, the tsconfig programs) and in `package.json` (`prettier`, `knip`). `eslint.config.mjs` and `tsconfig.json` stay at the root, where editors look for them, and so does `.prettierignore`, whose patterns Prettier reads relative to the file's own folder.

There is no lint baseline: every rule holds for every file. An `eslint-disable` comment names its rules and gives its reason after `--` (`@eslint-community/eslint-comments`), and one that silences nothing is an error.

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
- **Surgical changes.** A refactor and a behaviour change never share a commit: each goes in its own, and the pull request says which commit is which. Formatting-only commits go in `.git-blame-ignore-revs`.
- **Never disable a lint rule to get green.** Fix the code. If a rule is wrong for a line, the disable comment says why.
- **State is a union, not a set of booleans or strings.** If two fields must agree, make them one field.
- **Input is parsed where it arrives.** Check attributes, `localStorage`, `<meta>`, URL parameters, request bodies and webhook payloads once, at the boundary. Values go into GraphQL variables, never into the query text.
- **Errors are reported (`reportError`) or ignored by a name that says why.** No empty `catch`, no `.catch(() => {})`.
- **Comments state why, at HEAD.** No history, no lists of examples. See the `writing-comments` skill.

## Skills and agents

`.claude/skills/` holds `code-clarity`, `types-not-workarounds`, `writing-comments`, `codebase-design` and `shopify-apis`. `.claude/agents/` holds `type-design-analyzer`, `comment-analyzer` and `silent-failure-hunter`. Sources and licences are in `.claude/skills/SOURCES.md`.

## Releases

Deployed Worker copies install the next release with the updater they already have, and `test/upgrade-from-released.test.js` runs each released updater, through the update workflow its copy keeps, against this tree. So `server/`'s top-level entries stay the ones the updater's `MANAGED` and `KEPT` lists name: every older updater skips an entry a release adds, so new code goes inside an existing folder. A change to the updater (`server/scripts/` and what it imports) or to the shipped workflow helps copies only from the release after it, since a copy updates with what it has. When a release changes either, the next change adds its tag to that test's `OLD_UPDATERS`: a test there fails while a release tag's updater and workflow match none of the listed tags. CI, `release.yml` and `smoke.yml` fetch every release tag for it.

The Astro starter's Tether range and its lockfile move together, by npm, and only onto a release npm already has, so `npm ci` works in the starter at every commit and `test/versions.test.js` fails when they disagree. A release commit leaves the starter on the previous release; `npm run release -- X.Y.Z --push` moves it once the release workflow has published, and `npm run release -- X.Y.Z --starter --push` does that step alone.

`npm run release` doesn't run the whole gate itself: it needs the `ci` workflow to have passed on GitHub for the commit it releases, refuses a release commit that changes more than the version rewrite (`scripts/release-version.ts`, the lockfile and `dist/`), and runs only `test/versions.test.js`, the build and the smoke test. With `--push`, its push of the release commit and tag goes through the pre-push hook, which runs `npm run check` and `npm run lint:workflows` for a push with a new tag, so the whole gate runs there, and a hook that fails stops the push. A test that fails only at a new version is caught on the pull request instead: `release-rehearsal.yml` writes the next minor and the next patch version into a worktree with `scripts/release.ts --rewrite-only`, the same rewrite, and runs `npm run check` there, on pull requests that change `src/`, `server/`, `scripts/`, `test/`, the package files or the README. `npm run release` also needs the rehearsal to have passed for the newest commit that changes one of those paths, on that commit or on the head of the pull request that merged it (`scripts/github-runs.ts`). A commit pushed without a pull request, a release commit included, has none: the release refuses it until a pull request brings a change, or the owner runs the rehearsal's steps by hand (the refusal prints them) and passes `--rehearsed`. When main moves while `--push` waits for npm, the starter's commit goes on top of the new main; when it can't, the release still ends as a success and prints the `--starter --push` command.

`dist/` changes only in a release commit. `npm test` builds into `.test-dist/`. Never run `npm run release`, tag, publish to npm or change the repository's settings: the owner does those.
