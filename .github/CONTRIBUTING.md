# Contributing

Issues and pull requests are welcome. [AGENTS.md](../AGENTS.md) describes the code, the gate and the hooks; this page
is the short version.

```bash
npm ci
npm run check     # the gate CI runs: Prettier, ESLint, tsc, Knip, dependency-cruiser, the tests
npm run e2e       # Playwright on the Astro starter, when a change touches what a page renders
npm run smoke     # live check against Shopify's public demo store, when a change sends a new query or mutation
```

- `npm ci` installs lefthook's hooks: they format and lint staged files before each commit, check the commit message
  (a capitalised plain-English subject, no conventional-commit type, no closing full stop) and run `npm run check`
  before each push.
- Never commit `dist/`. It changes only in a release commit, which rebuilds it; `npm test` and `npm run smoke` build
  into `.test-dist/` instead. `npm run e2e` rebuilds `dist/`, so discard that before committing
  (`git checkout -- dist/`). CI fails a pull request that changes `dist/`.
- Keep it dependency-free and small. Tether runs on every page load.
- Every new attribute goes in the attribute reference (`docs/reference.md`).
- Anything that sends a new query or mutation must pass `npm run smoke`, against a dev store with selling plans if it
  touches subscriptions (`TETHER_DOMAIN=... TETHER_TOKEN=... npm run smoke`).
