# Contributing

Issues and pull requests are welcome.

```bash
npm install
npm test          # unit tests (jsdom + mocked Storefront API)
npm run smoke     # live check against Shopify's public demo store
npm run build
```

- Keep it dependency-free and small. Tether runs on every page load.
- Every new attribute goes in the README attribute reference.
- Anything that sends a new query or mutation must pass `npm run smoke`, against a
  dev store with selling plans if it touches subscriptions
  (`TETHER_DOMAIN=... TETHER_TOKEN=... npm run smoke`).
- Commit `dist/` with releases only (jsDelivr serves tagged builds).
