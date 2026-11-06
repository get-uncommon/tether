# Changelog

## 0.7.0 (unreleased)

- **Breaking (script build):** every optional part carries the sha384 `integrity` hash from the
  core's own build, a `partsUrl` included, and loads with CORS when it is on another origin. A
  self-hosted `partsUrl` must serve the files of the same release as the core: upload the whole
  folder of that release and replace it together with the core. A part from another release fails
  to load. Watch builds (`--watch`) carry the hashes too, rebuilding the core when a part changes.
  **Upgrade:** sites that load parts from beside the core (jsDelivr, or the whole release folder
  self-hosted) need nothing; a `partsUrl` folder is updated with the core.
- **Breaking (sync Worker updates):** a copy installs a release only from the signed
  `tether-server-X.Y.Z.tar.gz` on its GitHub Release, after `gh attestation verify` checks that
  Tether's release workflow built it from the tag's commit (still required to be on `main`). Run by
  hand without the GitHub CLI, the updater refuses unless `--allow-unverified` is given; a check
  that fails is always refused. Releases before 0.7.0 have no signed file and can't be installed by
  the new updater. **Upgrade:** none for the updater itself: a copy's own 0.6 updater installs
  0.7.0 by commit, and from then on every update is verified (`gh` comes with every GitHub runner).
  Which copies take 0.7.0 is decided by their `TETHER_VERSION` (next item).
- **Breaking (sync Worker), act before 0.7.0 is released:** copies made from 0.6.1 to 0.6.8 have
  `latest` in `TETHER_VERSION` unless it was changed, so they install 0.7.0 by themselves on the
  first scheduled update run after its release (Mondays by default), and Cloudflare deploys it.
  **Upgrade, before 0.7.0 is released, in each such copy:** do the one-time steps below that apply
  to it (customer accounts: add `ACCOUNT_SECRET`; a host that runs the Node CLI itself: Node 22.18
  or newer), or write `0.6` in `TETHER_VERSION` to stay on 0.6 and change it to `0.7` when ready.
  Copies whose `TETHER_VERSION` says `0.6` (made from 0.6.0, or changed) get 0.7.0 only when it is
  changed to `0.7`. A copy that installs 0.7.0 without `ACCOUNT_SECRET` keeps syncing, answering
  webhooks and starting deploys; only its account routes answer 503 with
  `accounts need the Worker secret ACCOUNT_SECRET (see /check)`, and `/check` shows the error,
  until the secret is added.
- **Breaking (customer accounts):** accounts run only through the Worker (`account.server`), so no
  customer token is ever kept in the browser. Browser mode is removed: the `account.clientId`,
  `callbackUrl`, `tokenUrl`, `shopDomain` and `remember` options, and `Tether.account.query()`,
  `getToken()` and `handleCallback()`. An `account` config without `server` warns "customer
  accounts need the Worker since 0.7.0: set account.server" and loads nothing; a `Tether.account`
  function called without it rejects with `NOT_CONFIGURED`. Types: `account.server` is required,
  and the account answers keep their exact shapes. Visitors logged in through browser mode are
  logged out. **Upgrade (sites with `account.clientId`):** set up accounts in the Worker
  ([setup](docs/accounts.md#setup)): register `https://your-shop.com/_tether/account/callback` as
  the callback URI in Shopify, give the Worker `ACCOUNT_CLIENT_ID`, `ACCOUNT_ORIGINS`,
  `STOREFRONT_TOKEN` and `ACCOUNT_SECRET`, then replace the browser options with
  `account: { server: '/_tether/account' }`. Code that called `Tether.account.query()` uses the
  fixed functions (`customer()`, `orders()`, `order()`, …) instead. Sites already on
  `account.server` only drop the removed options, which are ignored.
- **Breaking (product scope):** `scope.purchase` is the purchase itself,
  `{ kind: 'subscription', planId }` or `{ kind: 'one-time', offeredPlanId }` (the plan offered next
  to the one-time price, `null` without plans), and is read-only. `scope.planId` and assigning
  `scope.purchase` / `scope.planId` are removed. **Upgrade:** read `scope.purchase.kind` where the
  code compared `scope.purchase` to a string, `scope.plan?.id` (or the union's `planId`) for the
  plan, and change it with `scope.setPurchase(mode)` and `scope.selectPlan(ref)`.
- **Breaking (cart):** `Tether.cart.setCheckoutResolver(fn | null)` replaces
  `setCustomer({ accessToken, beforeCheckout })` and the `customerAccessToken` and `beforeCheckout`
  properties: the function answers a logged-in customer's checkout URL for the cart (`null` uses the
  cart's own), and that URL opens with `logged_in=true`. New carts no longer carry a
  `customerAccessToken` (the Worker links the cart at checkout). `Tether.cart.lastError` is
  read-only, and the undocumented `Tether.cart._commit()` is removed. Types: `CustomerLink` is gone.
  **Upgrade:** the account part sets the resolver itself; only code that called `setCustomer` or
  wrote those properties changes, to `setCheckoutResolver`.
- **Breaking (events):** `Tether.on(name, fn)` calls `fn` only for events Tether dispatched itself,
  so another script's look-alike `tether:*` event can't hand a listener a detail it didn't expect.
  The variant link (`tether-variant-url`) ignores such events too. Types: `Tether.on` takes only
  the names in `TetherEvents`; the `(name: string, fn: (detail: unknown) => …)` form is gone.
  **Upgrade:** listen with `document.addEventListener` for your own events.
- **Breaking (descriptions):** a description can't cover the page any more. It loses `class`
  attributes (a site's modal or overlay class would apply to it), the inline styles `transform`,
  `translate`, `rotate`, `scale` and `offset-*`, negative margins and values in viewport units.
  Content wider than the element still isn't clipped. **Upgrade:** style descriptions from the
  site's CSS through the element Tether fills (`[tether-bind="description"] h2 { … }`), not with
  classes inside the description.
- Fix: the analytics part no longer throws on a `checkout` event without a cart.
- **Breaking (descriptions):** iframes are kept only from YouTube (`www.youtube.com`,
  `www.youtube-nocookie.com`), Vimeo's player, Loom and Wistia, so store content can't frame a
  look-alike login page; an iframe from any other origin is removed. Kept embeds look as before.
  **Upgrade:** list other players in the new `embedOrigins` option (bare https origins, e.g.
  `['https://player.example.com']`); an entry that isn't one is skipped with a warning.
- **Breaking (Barba preset):** `barbaPreset()`'s `gsap`, `lenis` and `scrollTrigger` take only
  getters (`() => lenis`), as their types always said; a value throws a `TypeError` when the
  preset is made. **Upgrade:** wrap the value in a function.
- Fix (Barba preset): the default `scrollTrigger` getter calls `ScrollTrigger.refresh()` after an
  async render again; it was skipped because ScrollTrigger is a class.
- Types: `barbaPreset()` returns its hooks as set (not `| null`); a product option value's `swatch`
  is typed (`{ color, image: { previewImage } }`) instead of `unknown`; the Astro integration
  accepts `siteUrl` and `pageSize`, so the config shared with `createStorefront()` type-checks
  (both are still left out of the page).
- Types: `ResolvedTetherConfig.domain` is a `ShopDomain` (or `''`) and `apiVersion` an `ApiVersion`
  (or `'unstable'`), branded where the config is read; `TetherOptions` still takes plain strings.
- **Breaking (errors):** the codes `NOT_ALLOWED`, `SESSION_ENDED` and `TOKEN_FAILED`, which nothing
  raises since accounts run through the Worker, are removed, and `TetherError.code` is exactly
  `TetherErrorCode` (Shopify's own codes for refused input are on `userErrors`). **Upgrade:** drop
  checks for those codes.
- **Breaking (sync Worker):** `GET /_tether/account/orders` answers the orders as the browser reads
  them (every selected field present, `null` when Shopify leaves it out, only the selected fields),
  read by the same module (`server/src/shared/account-orders.ts`) in the Worker and the browser. An
  order without an id makes the route answer 502 instead of sending it on. **Upgrade:** none for
  sites using `Tether.account.orders()`; code reading `/orders` itself gets the same fields.
- **Breaking (types):** the Shopify objects are typed exactly as Tether's queries select them:
  `ShopifyProduct`, `ShopifyVariant`, `ShopifyCart` and `ShopifyCartLine` have no index signature
  and no optional fields Shopify always sends, a cart line's `merchandise` is `ShopifyCartVariant`,
  `ShopifySellingPlan` always has its `group`, and the new `ShopifySellingPlanNode`,
  `ShopifySellingPlanGroup`, `ShopifySellingPlanAllocation`, `ShopifyMetafield`,
  `SellingPlanAdjustmentValue`, `PlanAdjustment`, `ProductWithPlans` and `VariantWithPlans` name the
  rest. `Tether.plans` takes what each helper reads and answers typed allocations and adjustments.
  `InitialState` declares `unavailable`. The Astro integration's `hooks` is typed as the
  `astro:config:setup` hook it registers. **Upgrade:** code that read fields Tether doesn't query
  through the index signature reads them from its own `Tether.query()` result instead.
- **Breaking (types):** the published declarations are generated from the source (now TypeScript)
  by `tsc` at build time, in `dist/types/`, so they can't drift from the code. Where the
  hand-written ones differed, they now say what the code does: `TetherError` is a type export of
  `@occluze/tether` (the class is `Tether.TetherError`, and a value export of
  `@occluze/tether/server`), `Tether.on(name, fn)` types the detail of each event Tether dispatches
  (`TetherEvents`) and hands another name's detail as `unknown`, `scope.setPurchase()` takes
  `'one-time' | 'subscription'`, `Tether.mount()` takes a `Document` or an `Element`, and
  `createStorefront()` names the `.env` keys it reads instead of taking any key. The types a site
  imports keep their names (`TetherConfig`, `Tether`, `ShopifyProduct`, `ShopifyCart`, `Storefront`,
  `InitialState`, the account answers, …), and `window.Tether` and `window.TETHER_CONFIG` stay
  declared. **Upgrade:** a site that imported `TetherError` from `@occluze/tether` as a value (it was
  never exported there at run time) uses `Tether.TetherError`.
- The source is TypeScript. The sync Worker and its CLI run it unbuilt through Node's type
  stripping, so they need Node 22.18 or newer; the browser builds in `dist/` are unchanged. Deployed
  Worker copies keep working: `src/entry.js`, `bin/tether-sync.js` and `scripts/update-tether.mjs`,
  which their wrangler config and pinned workflow name, stay as one-line JavaScript shims.
  **Upgrade:** none for Worker copies whose update workflow runs on Node 22.18 or newer (GitHub's
  `setup-node` with `node-version: 22` installs the latest 22). A host that runs the Node CLI
  (`tether-sync`) itself needs Node 22.18 or newer: update Node there before updating Tether.
- **Breaking (server):** `initialState(product)` throws a `TetherError` for a product without
  variants (Shopify always sends at least one), so its non-null overload holds; `initialState(null)`
  is still `null`. **Upgrade:** none for Shopify data.
- Customer accounts: on start the core removes the tokens Tether 0.6's browser-mode accounts left in
  `sessionStorage` / `localStorage` (`<prefix>:account:<domain>`, `<prefix>:account-login:<domain>`),
  so a full-scope refresh token doesn't stay behind. This cleanup is removed again in 0.8.0.
- Sync Worker: a repeated webhook delivery is also dropped across the Worker's isolates in a data
  centre, through Cloudflare's Cache API (`caches.open('tether-webhook-deliveries')`, kept six
  hours, free and without KV writes). Node keeps the in-process check only.
- Sync CLI: the `Webflow requests` count is right with Webflow and `DEPLOY_HOOK_URL` together (it
  stayed at 0).
- **Breaking (sync Worker):** customer accounts need `ACCOUNT_SECRET` (24+ random characters); the
  session key no longer falls back to `SYNC_SECRET`, the `/reconcile` and `/check` password.
  Without it the account routes answer 503 `accounts need the Worker secret ACCOUNT_SECRET (see
  /check)` and log `account setup ACCOUNT_SECRET is not set` (the sync, webhooks and deploys are
  unaffected), and `/check` shows an error step that says what to set. **Upgrade, once, before a Worker with
  customer accounts runs 0.7.0:** if it has no `ACCOUNT_SECRET` yet, add one in Cloudflare → your
  Worker → Settings → Variables and Secrets (`openssl rand -hex 24`, not the value of
  `SYNC_SECRET`). 0.6 already uses it, so it can be set before the update. Changing the key logs
  every customer out once. A copy whose `TETHER_VERSION` says `latest`, which is every copy
  made from 0.6.1 to 0.6.8 unless changed, installs 0.7.0 by itself: set the secret before 0.7.0 is
  released. A copy on `0.6` gets 0.7.0 only when the file says `0.7`: set the secret first. Workers without customer
  accounts, or with `ACCOUNT_SECRET` already set, need nothing.
- Sync Worker updates: when a release ships a newer `.github/workflows/update-tether.yml` than the
  copy's (its `# Tether workflow revision:` line), the update run prints a GitHub Actions warning
  and adds the one-time manual step to the job summary. **Upgrade notes, for any later release that
  raises it:** copy `server/.github/workflows/update-tether.yml` from that release over the same
  file in your copy and commit it, once, by hand (GitHub doesn't let the workflow change its own
  file; keep your own `cron` line). 0.7.0 ships revision 3: separate jobs, the release's tests run
  with a read-only token that isn't kept in the checkout, actions pinned by commit, and the update
  uploaded with its sha256 as a job output before the release's tests run, so `publish` applies it
  only when the hash matches and the tests can't change what is pushed. Copies
  deployed before 0.7.0 have revision 1 (no revision line). Their 0.6 updater installs 0.7.0
  without a warning; from then on every update run warns, also a run that finds nothing new, until
  the copy has the new workflow. The warning and the job summary link to the release's workflow
  file. **Upgrade (every copy deployed before 0.7.0):** do that one-time copy once 0.7.0 is
  installed. Until then the copy keeps updating with its old workflow, whose test step holds a token
  that can write to the copy's repository.
- Releases: `release.yml` builds `tether-server-X.Y.Z.tar.gz` (a `git archive` of the tag's
  `server/`, the same bytes on every run), attests it (`actions/attest-build-provenance`, pinned)
  and uploads it to the GitHub Release. The release runs the whole gate (`npm run check`);
  dependencies are installed only in a read-only job, the server asset is built and attested in a
  job that installs nothing, and npm publishes with `--ignore-scripts`.
- Fix (sync Worker): only the exact example values from the docs (`your-store.myshopify.com`,
  `choose-a-long-random-string`, `shpat_…`, …) count as unset. A real value that starts with `todo`,
  `example` or `xxx`, or contains `...`, was silently ignored (e.g.
  `WEBFLOW_OWNED=todo-notes,description`) and is now used.
- Fix (sync Worker updates): a copy's update tests no longer read the copy's own `TETHER_VERSION` or
  `tether-sync.config.js`, so a copy on `latest` or a pinned version, or with its own mapping, no
  longer fails its update run. A test installs this release into a v0.6.8 copy with v0.6.8's own
  updater and runs the copy's tests.
- Releases: the signing job installs an exact npm (11.21.1); esbuild, jsdom and Playwright are
  pinned exactly. The build finds GraphQL template literals with TypeScript's parser instead of by
  pairing backticks, which a backtick in a regular expression could throw off.
- Repository: CI runs `npm run check` on pull requests and pushes to `main`, on Node 22.18 and 24.
- Repository: browser, Node-side, Worker and test code are type-checked as separate programs
  (`tsc -b`), so browser code can't use Node globals and the Worker can't use the DOM; the tests are
  type-checked too, with their fakes checked against the interfaces they stand in for.
- Types: `ApiVersion` is the template literal `` `${number}-${'01' | '04' | '07' | '10'}` `` (it was a
  branded string), and the API version constants are typed `ApiVersion`.
- Security: descriptions lose `id` attributes (they could clobber `window.<id>` and the site's own
  ids), inline style declarations that position content over the page or load from elsewhere
  (`position`, `top`/`right`/`bottom`/`left`/`inset`, `z-index`, any value with `url(`,
  `expression(` or `@import`), and iframes from the site's own origin; an iframe's `allow` keeps only
  `autoplay`, `encrypted-media`, `picture-in-picture`, `fullscreen`, `clipboard-write`,
  `accelerometer`, `gyroscope` and `web-share`. **Behaviour change:** inline styles are written back
  as the browser parses them (`color:red` becomes `color: red;`); the look is the same.
- Config: an unknown `TETHER_CONFIG` key (a typo) warns and is left out of the config. `partsUrl`
  is checked when Tether starts: one that is neither https nor on the site warns and the parts load
  beside the core. `markets.detect` takes a single source name too, and `Tether.detectMarket(markets)`
  validates the `markets` it is given. **Behaviour change:** `Tether.config` is a read-only view of
  the live config: a write throws in strict-mode code and warns (`Tether.init(options)` changes it).
- Analytics: only events Tether itself sent become analytics events; a look-alike `tether:*` event
  from another script sends nothing (and no longer throws inside the analytics part).
- `observe`: each burst of added elements is mounted once, reading only their own hydrate tags and
  rendering the cart once, instead of rescanning the document per element.
- A `data-tether-hydrate` entry without the lists and prices a render walks is skipped, and the
  product loads from Shopify.
- A failed mount after `astro:page-load`, a failed render after add-to-cart and a failed refresh of
  a server-rendered product are reported (or handled) instead of surfacing as unhandled rejections.
- `@inContext` is added after reading the operation header with strings and comments blanked out:
  a `)` in a variable's default value no longer misplaces it, and the word `@inContext` in a comment
  or the selection set no longer stops it. An operation that names its own `@inContext` keeps it.
- Script build: a part file that loads but doesn't register is tried again on next use. **Behaviour
  change:** when the core was not loaded by a `<script src>` (so its folder is unknown) and there is
  no `partsUrl`, loading a part fails with a message saying so, instead of fetching it from the site
  root.
- Cart: `Tether.cart.lines`, `Tether.cart.warnings` and the `subscribe` meta's `warnings` are copies;
  `lastError` is always an `Error` or `null`; `add()` rejects if Shopify answers without a cart.
- Astro integration: `createStorefront()`'s own options in a shared `shop.config.js` (`siteUrl`,
  `pageSize`, `fetch`) are left out of the page; any other unknown option warns at build time.
- Types (also covered by the generated declarations above): the `TetherError` constructor takes typed `errors`/`userErrors`/`code`; `Tether.config` is `ResolvedTetherConfig`;
  `query()` defaults to `unknown` and `on(name: string)` passes `unknown`
  instead of `any`; `onError` receives `unknown` (a handler may still type it narrower); cart
  changes that can answer without a cart return `ShopifyCart | null` and `checkout()` the checkout
  URL; `imageUrl()` returns `url` itself when it is empty; an `initialState` plan's price and an
  image's `width`/`height` can be `null`; `__core` and `__parts` are declared.
- Releases: the version is set in `package.json` only; the release script writes every copy from it
  (`scripts/versions.ts`), and a test checks they agree.
- Security: descriptions (`tether-bind="description"`, `tether-collection-bind="description"`) go
  through an allow-list of content elements and attributes. **Behaviour change:** `<style>` blocks and
  form fields are removed, unknown elements are unwrapped (their text stays), iframes are kept only
  with an https `src` and run sandboxed with a strict referrer policy, and links that open a new tab
  get `rel="noopener noreferrer"`. Text formatting, inline styles, images, links, tables and video
  embeds render as before.
- Security: the optional parts loaded from the core script's own folder carry a sha384 `integrity`
  hash from the same build, so a core pinned with `integrity` runs only its own parts. **Behaviour
  change:** a core on another origin loads its parts with CORS (jsDelivr sends the headers; a
  self-hosted copy on another domain must too).
- Security (sync Worker): a repeated webhook delivery (same `X-Shopify-Webhook-Id`) is dropped
  within the Worker instance and across the data centre (see above), after the signature and shop
  checks.
- Security (sync Worker): a new login ends the session the browser already had. A failed login,
  callback or logout step sends the visitor back to the site with `?account=error` (and clears the
  login cookies) instead of a raw 502 answer.
- Security (sync Worker updates): only `v`-prefixed tags are releases; an update is staged and
  swapped in, and rolled back when it fails part-way.
- Config: every `TETHER_CONFIG` option is validated once. **Behaviour change:** an invalid value
  warns in the console and falls back to its default: `apiVersion` must be quarterly (or
  `unstable`), `domain` a host name, `locale` a locale `Intl` accepts; `country` and `language` are
  normalised to Shopify's codes (`'de'` → `DE`); the `account` URLs must be a site path or https
  (http on localhost); invalid fields of `markets`, `analytics` and `account` are dropped.
- Analytics: `shopify: { proxy: true }` is the documented form; any value still turns it on.
- Customer accounts: a failed login fires `tether:account-error` with `{ error }`: `'error'` or
  `'expired'` (`?account=error` / `?account=expired`).
- Customer accounts: `customer()` has one shape (`id`, `firstName`, `lastName`, `displayName`,
  `emailAddress`, `defaultAddress`; missing fields are `null`, and `id` is included); logged out,
  `customer()` is `null` and `orders()` `[]`. Refused input is `INVALID` (with `userErrors`), an
  unreachable Worker `NETWORK`.
- Customer accounts (sync Worker): a refresh refused for any reason but `invalid_grant` answers 502
  and keeps the session; a session without a refresh token no longer asks Shopify; discovery falls
  back to the shop id only on a 403/430 from the store domain.
- `Tether.cart.forgetSaved()`: forgets this device's cart and shows an empty one.
- Amounts Tether adds up or subtracts (totals, savings) are taken in each currency's own smallest
  unit (JPY whole, KWD three decimals) instead of hundredths.
- `productUrl()` (browser links and `@occluze/tether/server`) gives no link (`null`) for a missing
  handle or id instead of `/product/null`, and encodes the handle.
- A token without inventory access gets queries without `quantityAvailable`; `Tether.query()`
  texts are sent as written.
- Storefront answers that are malformed reject with a `TetherError` instead of a `TypeError`.
- Sync Worker: `/health` answers `{ ok: true }` only; the public `/check` answers only
  `{ ok, steps }` with each step's title and level. The running version and the KV binding need the
  bearer secret (`Authorization: Bearer <SYNC_SECRET>` on `/check`).
- Sync Worker: a customer account request body over 64 KiB is answered 413, and a larger declared
  `Content-Length` is refused before the body is read.
- Sync Worker: the Node server logs the address it really bound.
- Types: `Tether.account` methods return their real shapes (`AccountCustomer`, `AccountOrder`,
  `OrderDetail`, `SubscriptionContract`, …), `TetherErrorCode` lists every code, `TetherEvents` has
  the account, search and list-rendered events, and `productUrl()` returns `string | null`.
- The Storefront, Customer Account and Admin API versions live in one place
  (`server/src/shared/api-versions.ts`).

## 0.6.8 (2026-11-06)

- Security: the market's country and language are checked before they go into a query's
  `@inContext`. A `<meta name="tether-page-language">` or a saved market could otherwise change the
  query text. A language such as `nl-NL` is now sent as `NL` instead of the invalid `NL_NL`.
- Security (sync Worker): the cached Shopify Admin token is stored encrypted in KV, with a key
  derived from `SHOPIFY_CLIENT_SECRET`. After the update, the Worker asks Shopify for a new token
  once.
- Security (sync Worker): a webhook without the `X-Shopify-Shop-Domain` header is refused (403).
  Shopify always sends it.
- Security: product and collection descriptions (`tether-bind="description"`,
  `tether-collection-bind="description"`) are sanitized. Scripts, event handlers and `javascript:` links are
  removed; markup, styles, images, links and video embeds stay. A description that relied on a script in its
  HTML no longer runs it.
- Security: the Astro integration refuses a secret Shopify token (`shpat_`, `shpss_`, …), because it would be
  written into every page. It warns when the token comes from a name without `PUBLIC_`.
- Security: a background image URL is escaped for CSS, and checkout only opens an https URL.
- Security: `partsUrl` must be https or on the site's own origin.
- Security (sync Worker): the public `/check` shows only each step's title and level. Details and the API
  tests need `Authorization: Bearer <SYNC_SECRET>`.
- Security (sync Worker): webhooks over 1 MB are refused (413), and a webhook is accepted only for the
  configured store.
- Security (sync Worker): customer accounts no longer accept an example value as the session key.
  `/check` recommends a separate `ACCOUNT_SECRET` instead of reusing `SYNC_SECRET`.
- Security (sync Worker): account discovery never guesses Shopify's endpoints. The id token must name
  its signing key, and `iat`/`nbf` are checked.
- Security (sync Worker updates): a release is installed by the commit its tag points at, and only when
  that commit is on the upstream default branch.
- Customer accounts (server mode): parallel requests share one token refresh. A failed cart unlink at
  logout is logged.
- Astro integration: `.env` files are read on Windows too.
- The core script is about 21 KB gzipped (was 20 KB).

## 0.6.7 (2026-11-05)

- Astro: the first page load no longer mounts twice (the injected script and ClientRouter's first
  `astro:page-load`), so account pages send each request once instead of twice.
- Account pages: a second submit or click while a request is still running does nothing (no
  duplicate address, return or subscription change from a double click or Enter).
- Addresses: on an edit, a field cleared in the form (apartment, phone) is cleared in Shopify too.
- Addresses and subscriptions: a failed load keeps what's shown and sets `addresses-error` /
  `subscriptions-error` (new `tether-show` values) instead of showing "none yet".
- Profile: after saving, `tether-account-bind` shows the new name.
- Subscriptions: `tether-subscription-state="done"` lands on the row as shown after the update.
- Orders: a tracking link without a URL is hidden; after a return request only `return-requested`
  shows, not `has-returns` as well.
- Cart: `setAttributes`, `applyDiscount` and `removeDiscount` called quickly in a row no longer
  undo each other (each reads the cart in its turn).
- Checkout asks Shopify for the checkout URL and the account's own URL side by side.
- Account: the order list and the account pages load side by side.
- Sync: a deploy hook that can't be reached keeps the rebuild pending for the next run.
- Account pages: the profile and address forms are handled before a page router (Astro's
  ClientRouter) sees the submit, so the router no longer navigates with the form fields in the URL.

## 0.6.6 (2026-11-05)

- Sync (Node CLI file store): a write from another process in the same coarse timestamp tick
  (common on Linux) is no longer missed; the store compares size and inode as well as mtime. This
  also made the sync's update check fail on some GitHub runners.

## 0.6.5 (2026-11-05)

**Customer accounts on your own site:** order pages (lines, totals, addresses, tracking), profile
and address editing, subscriptions (skip, pause, resume, cancel) and return requests, in both server
and browser mode, with markup attributes and empty/loading states ([guide](docs/accounts.md)). Only
the login, checkout and card changes stay on Shopify. In server mode each is a fixed Worker
operation with validated input; a customer can only act on their own orders, addresses and
subscriptions. A new optional part (6 KB) loads only on pages that use them.

Fixes from a full security audit (Cloudflare's security-audit method; details in the release notes):

- **Sync webhooks:** the `X-Shopify-Topic` header isn't covered by Shopify's signature, so it no
  longer decides on its own: every webhook asks Shopify for the product, and an item is only
  removed when Shopify no longer has the product. Before, a replayed signed webhook with the
  topic changed to `products/delete` could take a live product off the site.
- **`tether-sync serve` (Node):** routes before reading the body, accepts bodies up to 1 MB
  (413 above), and an aborted upload no longer stops the process. New `--host` option
  (e.g. `127.0.0.1` behind a proxy).
- **Test server (`e2e/serve.mjs`, development only):** serves only files inside its folders and
  listens on 127.0.0.1.

## 0.6.4 (2026-11-05)

- Customer accounts, server mode: the Worker asks for Shopify's signing keys with JSON headers
  (a request from a Worker without them can get a bot-protection page instead of the keys), and
  says clearly when the keys can't be fetched.

## 0.6.3 (2026-11-05)

- Customer accounts, server mode on a deployed Worker: login failed with "account error" because
  the store domain's bot protection answers 403 to Workers for its `.well-known` files. The Worker
  now finds the shop id through the Storefront API and uses Shopify's account addresses directly
  (needs `STOREFRONT_TOKEN`, which server mode already asks for).

## 0.6.2 (2026-11-05)

From testers building an Astro store from the starter:

**Fixes**
- Cart: quick +/− clicks no longer step the count and totals through every reply from Shopify
  (+ + + − from 1 showed 2, 3, 4, 3). Only the latest quantity is sent; a click that undoes the
  last one sends nothing.
- A wrong token (or an Admin token, `shpat_…`) now says so, naming the store: Shopify's 401 has
  no message, so the error (and `astro build`'s output) was empty.
- `hydrate(products, { card: true })` keeps two images per product (a hover image,
  `tether-bind="image:2"`), `images: n` for more. Cards with a second image showed the first one
  until the background refresh.
- `diagnose()`: documented values (`tether-show="search-empty"`, `logged-in`, `logged-out`) are no
  longer called unknown. It now finds typos, with a suggestion: `tether-bind="pric"`, attributes like
  `tether-bnd` or `tether-add-to-card`, and an option list for an option the product doesn't have.
  Clearer messages, with no empty or `undefined` parts.
- Types: `initialState(product)` is non-null for a product (strict `astro check` passes with the
  docs' examples). `show` has `plenty-in-stock` and `has-savings`. `getProduct()` and
  `getProducts({ query })` take `null`/`undefined`. A typo in `createStorefront()` options is now
  a type error.
- Astro integration: in dev, a change to `src/shop.config.js` restarts the dev server, so the
  browser gets the new config too (`watch` for other files). `.env` files follow `--mode`, and the
  store variables are declared through `astro:env`.

**New**
- `account.server` can be a path on your own site (`'/_tether/account'`).
- Accounts: `tether-show="orders-loading"` / `"orders-empty"`, `tether-order-bind="image"`, and
  `tether-order-lines` with `tether-order-line="title|variant-title|quantity|image"`.
- `tether-products="url:q"`: search results for the page's `?q=` on a static site.
- `tether-max-width` / `data-max-width` (and `-max-height`, `-crop`): valid HTML for image sizes.

**Starter and docs**
- README: the three ways to install side by side (script tag via jsDelivr, npm, with the Worker),
  with when to pick each.
- The Astro starter has `site`, canonical links, a favicon, a 404 page, a static search page,
  `tsconfig.json`, and no longer ignores `package-lock.json`. The first cards and the first product
  image load eagerly (`fetchpriority="high"`), the rest lazily.
- Astro guide: `astro:assets` `<Image>` makes images download twice with Tether (use `<img>`),
  fonts with `<ClientRouter />`, search pages need SSR (or `url:q`), a null check for unknown
  collections, `prerender` with SSR, and `revalidate: false` for SSR pages.

## 0.6.1 (2026-11-04)

**Customer accounts, server mode: fixes from an independent security review** (nothing critical
was found; every finding is fixed and has a test):
- Login CSRF: the pending login is now sealed in an HttpOnly cookie in the browser that started
  it, so a login link from someone else can't log a visitor into the wrong account. As a result,
  nothing is written to KV before a real login (no quota abuse by anonymous requests).
- `/login` no longer takes a cart; carts are only linked through the protected `POST /cart`.
- Logout can't fail open: the session is ended and the cookie cleared first, even when Shopify is
  down. The id token for Shopify's logout goes through a one-time HttpOnly cookie, never the page.
- Sessions have an absolute lifetime (`ACCOUNT_SESSION_DAYS`), end when Shopify ends them, and
  survive two requests refreshing at once.
- A separate encryption key per purpose, bound to its KV key; optional `ACCOUNT_SECRET`.
- Order links must be https; stricter cart ids; no setup details in public errors.

**Sync:** new deploys follow every release (`TETHER_VERSION` is `latest`).

**Docs:** the comparison covers 0.6 (accounts, search, analytics, frameworks).

## 0.6.0 (2026-11-04)

Found by 10 agents building stores from the docs alone (Astro static and SSR, plain HTML, Vite,
SvelteKit, Next.js, Eleventy, subscriptions, multi-market, an accessible React cart) and 10 more
shopping in them (phone, keyboard only, screen reader, German, French, US, bargain hunter, …).

**New: optional parts** (each loads only on pages that use it; the main script stays 20 KB)
- **Search as you type** (`tether-search`, 2 KB): Shopify's predictive search with products,
  collections and suggested searches; keyboard and screen-reader friendly.
- **Customer accounts** (4 KB): login on Shopify's page, the customer's name and orders, a checkout
  that knows them. **Server mode** (recommended): your sync Worker does the login (OAuth with PKCE,
  the id token's signature checked), keeps the tokens encrypted in KV and gives the browser only an
  HttpOnly session cookie, so no Shopify token ever reaches the browser. Browser mode for quick
  starts. Both tested on a real store. [Guide](docs/accounts.md).
- **Analytics** (`analytics`, 3 KB): GA4 / Tag Manager ecommerce events in `dataLayer`, Shopify's
  own analytics (experimental, through Shopify's scripts), or `onEvent` for any tool. [Guide](docs/analytics.md).
- **Structured data:** `shop.jsonLd(product)` for Google's product results.
- **Other markets on static sites:** `html.tether-market-pending` until the visitor's prices are in.
- **Real-browser tests** (36, in Chromium, WebKit, Firefox and a phone, on every push): the
  starter, a plain HTML page with the `<script>` build and its optional parts, GA4 events, the
  market marker, and Shopify analytics with Shopify's real scripts (their sends intercepted).

**Fixes**
- **Stale prices:** Shopify caches the answer to an identical query text, prices included, for
  hours after a change. Tether's queries now carry a one-minute time marker (`maxAge`, default 60
  seconds), so the server module, builds and pages get current prices. (The cart always had them,
  so a page could show one price and checkout charge another.)
- Two quick clicks on cart +/− counted once; they now add up, show at once, and the line gets
  `is-busy` until Shopify answers. `Tether.cart.changeQuantity(lineId, ±1)` does the same for your
  own buttons; `Tether.cart.quantityOf(line)` shows the pending quantity.
- Clicking an option value that's unavailable with the current choices threw the other choices
  away. It now picks the closest variant that has the value; a value no variant has is ignored.
- View Transitions into a page built for another market (`/de/`) kept the old market. New:
  `<meta name="tether-page-country|language|locale">` makes a page that market, also back again.
- With the Astro integration, a visitor's saved money format lost to the config on every page.
- The country select now takes the language (or none) from the `markets.locales` entry for that
  country, instead of keeping the previous one.
- `Tether.cart.open()` did nothing without a `tether-cart-drawer` (React/Svelte/Vue carts); it now
  sets the open state for `subscribe`.
- `tether-show="list-empty"`, `list-filled` and `tether-load-more` ignored the `hidden` attribute.
- A closed cart drawer is `inert`: its buttons are no longer in the Tab order.
- `applyDiscount()` with a code Shopify doesn't accept rejects (`INVALID_DISCOUNT`) and doesn't keep
  the code; the form also sets `aria-invalid`. Repeated warnings are shown once.
- Recommendations for a missing product are no longer reported to `onError`.

**New**
- Cart warnings per line: `tether-line="warning"`, `is-warning`, `tether-line-show="warning"`, and
  `warningText(w)` to translate Shopify's messages. Cart lines carry `merchandise.quantityAvailable`.
- Shareable variant links: `variantUrl: true` (or `tether-variant-url`) keeps `?variant=` in the URL.
- Tabs stay in sync: a cart change or market switch in one tab updates the others. The cart count
  shows its last known value at once on the next page, instead of 0.
- `tether-show="plenty-in-stock"`, `lowStock` (default 5), `tether-plan-bind="option"`,
  `tether-recommendations="url:handle"` (or empty inside a product).
- Savings in the locale's format (`30 %` in German and French); `shop.formatPercent()`.
- `checkout-charge` counts the quantity.
- Server: `hydrate(products, { card: true })` for lists (about 40% smaller); `initialState()` gains
  `has-savings`, `plenty-in-stock`, `plans`, `savings` and a plain `unavailable` map; `lowStock`.
- `diagnose()` shows the market in use and warns about product options the page offers no way to choose.
- Types: `seo`, `setCountry` options (`locale`, `language: null`), the new config options.
- Docs: [other frameworks](docs/frameworks.md) (Next.js, SvelteKit, Vite, Eleventy); many
  attributes and classes that were only in the code are now in the reference.

The main script is 20.1 KB gzipped (18.5 KB in 0.5): the fixes above. Bundles, tab sync and
variant links moved to the optional `extras` part (1 KB).

## 0.5.0 (2026-11-04)

**Astro** ([guide](docs/astro.md), [starter](examples/astro)): Shopify product pages built at build
time (or per request with SSR), with live prices, stock, variants, subscriptions and the cart.
- `@occluze/tether/astro`: an integration that adds Tether to every page, configured from `.env`
  (`PUBLIC_SHOPIFY_DOMAIN`, `PUBLIC_SHOPIFY_STOREFRONT_TOKEN`).
- `@occluze/tether/server`: `createStorefront()` for build-time and server data: `getProduct`,
  `getProducts`, `allProducts`, `getCollection`, `allCollections`, `getRecommendations`,
  `formatMoney`, `productUrl`, `imageUrl`, `query`. Same product shape as the browser.
- Hydration: `shop.hydrate(products)` puts the data in the page; the browser renders it without a
  request and refreshes prices and stock once in the background, batched for the whole page
  (`revalidate: false` to skip). Server-rendered images and products loaded earlier in the visit are kept.
- View Transitions (`<ClientRouter />`) work by themselves: each page is mounted, the cart closes
  on navigation (`astro: false` to turn off).
- `shop.initialState(product)`: what Tether shows first (variant, price, purchase mode, every
  `tether-show` condition, unavailable options), so server-rendered pages don't change when the
  script takes over. Same rules as the browser, covered by a test that compares the two.
- `Tether.cart.subscribe(fn)` for React, Svelte and Vue islands, with `loaded` (saved cart known)
  and `warnings`. `Tether.cart.loaded`, `Tether.imageUrl()`.
- `getRecommendations()` also takes a handle (server and browser), so it runs next to `getProduct()`.

**Sync: rebuild on change.** `DEPLOY_HOOK_URL` starts a build of a statically built site
(Cloudflare Pages, Netlify, Vercel) when product content changes; stock changes don't. At most one
build per `DEPLOY_HOOK_MIN_SECONDS` (60). Works with or without Webflow.

**Fixes** (found by first-time users building with the docs only):
- `tether-show` elements hidden before the script ran (a class, `style="display:none"`, `hidden`)
  are now shown when their condition applies, for every condition, not only error/not-found.
- Cart line links (`tether-line="url"`) open the variant that's in the cart.
- `tether-checkout` gets `is-disabled` / `aria-disabled` while the cart is empty.
- Cart warnings: asking for more than is in stock used to change the quantity silently. Shopify's
  message now shows in `tether-show="cart-warning"` / `[tether-cart-warning]`, with a
  `tether:cart-warning` event (API 2024-07 and later; older versions just skip it).
- Cart line links also keep the subscription plan (`selling_plan=`).
- `cart.subscribe` and `tether:cart-updated` now also fire when the saved cart has loaded.
- Discount codes: the form no longer becomes a page navigation with Astro's router; an invalid
  code gets `is-invalid` and is removed from the cart (it used to stay and repeat its warning).
- Another language: when Shopify translates option names (Size → Größe), `tether-option-list`,
  `tether-option` and `tether-option-selected` keep matching (by position).
- `Tether.query()` / `shop.query()` add the market to anonymous and shorthand queries too.
- `diagnose()` knows `tether-show="cart-warning"`.

**Markets:**
- `setCountry('DE', { locale: 'de-DE' })`, or a `locale` in a `markets.locales` entry for that
  country: the money format follows the country, and is remembered with it.
- `tether-countries="NL,DE"` limits a country select to your markets, in your order.
- With the Astro integration, `window.TETHER_CONFIG` in the layout no longer starts a second,
  unconfigured Tether.

## 0.4.0 (2026-11-04)

**Smaller:** the script every visitor loads went from 62.9 KB to 50.8 KB (20.7 → 17.1 KB gzipped, 15.4 KB brotli), while gaining the fixes below.
- Diagnose and markets are optional parts, loaded on first use (`tether.diagnose.min.js`,
  `tether.markets.min.js`, next to the main script; split chunks for bundlers). Self-hosting: copy
  them too, or set `partsUrl`. `Tether.detectMarket()` and `Tether.getLocalization()` now return
  promises.
- Built for ES2020 browsers (no helpers for `?.` and `??`), GraphQL minified at build time.

**TypeScript types** for the whole API, config, events and the Barba preset.

**Tested on a real Webflow site** (product pages, subscriptions, cart, Barba transitions), fixing:
- The cart drawer is now keyboard and screen-reader friendly: dialog semantics, focus moves in and
  back, Tab stays inside, `aria-expanded` on cart buttons (`cartFocus: false` to turn off).
- Add-to-cart links (not only buttons) get `aria-disabled` when unavailable.
- Products and lists that failed on a network error load again when the browser is back online.

**Releases in one step:** `npm run release -- X.Y.Z --push`; a workflow publishes to npm with
provenance (trusted publishing) and creates the GitHub Release.

The npm package shows the author link (occluze.com).

## 0.3.6 (2026-11-04)

- Fix: updates of deployed sync copies could be rejected by GitHub, because an Action's token may
  not change workflow files. The updater no longer touches `.github/`; the workflow file stays as
  it was deployed, and all update logic lives in `scripts/update-tether.mjs`, which updates itself.
  (Reverts the 0.3.5 workflow step.)
- On npm: `npm install @occluze/tether`.

## 0.3.5 (2026-11-04)

- Sync updates can't silently stall: after committing an update, the Update Tether action waits
  until Cloudflare has started the build, pushes again once if it hasn't, and fails visibly
  otherwise (GitHub emails you).
- New [comparison page](docs/comparison.md): Tether vs Smootify vs Storesynk (formerly Shopyflow),
  with sources. Fixed the competitor's name (Shopyflow, not "Shopiflow") in the description.

## 0.3.4 (2026-11-04)

- Shorter READMEs with what everyone needs; the full reference moved to `docs/reference.md`, the
  sync's technical details to `server/docs/advanced.md`.
- The README recommends `@0.3` on jsDelivr (every 0.3.x fix), with `@v0.3.4` to pin and `@latest`.
- Sync `/check`: the "update available" note reads versions from jsDelivr (GitHub's API rate-limits
  unauthenticated calls from Cloudflare). The updater also updates `docs/`.

## 0.3.3 (2026-11-04)

Tested live: Deploy to Cloudflare → first import into a Webflow collection → webhooks registered by
the Worker → create, rename, draft, re-activate and delete a Shopify product, each reflected in
Webflow within seconds.

- The Deploy form asks only for what a deploy needs: store domain, collection id, Webflow token,
  Shopify client id + secret, `SYNC_SECRET`. Optional settings are documented as secrets to add
  later (`FIELD_MAP`, `WEBFLOW_OWNED`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, `MAX_SUBREQUESTS`).
- No manual webhook setup: the Worker registers the product webhooks through the app on its first
  `POST /reconcile` (signed with the client secret). `/check` reports them; the CLI has
  `tether-sync webhooks <url>`. Webhooks signed with either the client secret or
  `SHOPIFY_WEBHOOK_SECRET` are accepted.
- `check` folds fields the collection doesn't have into one line instead of a warning per field.
- Deployed copies update themselves: `TETHER_VERSION` (`0.3` patches only, `0.3.3` pinned,
  `latest`) and an **Update Tether** GitHub Action in the copy (weekly, or Run workflow) that
  takes the newest matching release, tests it, commits it and lets Cloudflare redeploy. Mapping,
  Cloudflare ids and secrets are kept. The Action keeps its schedule alive, `/health` shows the
  running version, and `/check` warns when an update in the range hasn't been installed.

## 0.3.2 (2026-11-04)

- Worker: `POST /reconcile?since=all` (with `SYNC_SECRET`) runs a full first import without
  the CLI; if it doesn't fit in one run, the cron continues it.
- Fix: a half-done reconcile window that started from an explicit `since` is now resumed by the
  next run instead of being dropped.

## 0.3.1 (2026-11-04)

- Deploy to Cloudflare: the form starts empty (no example values), with clearer descriptions
  of what's required.
- Example values (`your-…`, `choose-…`, `…`) and a `SYNC_SECRET` shorter than 24 characters
  count as not set, so a left-over example can never unlock `/reconcile` or the API tests on
  `/check`. `check` names each such value.
- CI: actions/checkout and actions/setup-node v5 (Node 24).

## 0.3.0 (2026-11-04)

**Markets and localization**
- `markets: { detect: true, locales }`: country/language from the visitor's saved choice, your
  server (`window.TETHER_COUNTRY`, `<meta name="tether-country">`, a cookie such as one set from
  Cloudflare's `cf-ipcountry`) or Webflow Localization (locale subdirectory or `<html lang>`).
  No IP lookups from the browser.
- `select[tether-country-select]` (from `localization.availableCountries`) and `tether-country-bind`.
- `Tether.setCountry(code, { language })`: updates `@inContext`, the cart's
  `buyerIdentity.countryCode`, and re-renders products (keeping the selection) and lists.
  A saved cart from another market is moved on load. Events `country-changed`, `product-updated`.
- `Tether.getLocalization()`, `Tether.detectMarket()`; diagnose() shows the detected market.
- Switching ignores responses still on their way from the old market, keeps rendered products
  visible (`tether-state="updating"`), never creates a cart, and a saved choice applies without
  `detect`. Detached roots from page transitions are released.

**Shopify API upgrade safety**
- `scripts/api-version.mjs [--next]`; diagnose() names the version to upgrade to; a warning for
  `apiVersion: 'unstable'`.
- `.github/workflows/smoke.yml`: weekly and on push, tests + smoke on the pinned and the next
  API version; opens/updates an issue on failure.
- The smoke test covers the localization query and `setCountry`.

**Server sync**
- Deploy to Cloudflare button: `server/wrangler.jsonc` (KV binding, cron), secrets prompted from
  `.dev.vars.example`, descriptions in `package.json`.
- The config file now ships as a working default for a standard Products collection, with
  `SHOPIFY_DOMAIN` / `WEBFLOW_COLLECTION_ID` from the environment, `FIELD_MAP` / `WEBFLOW_OWNED`
  overrides, and `webflow.skipMissingFields` (on by default).
- `tether-sync check` is a guided first-run: what's missing, how to fix it, API and mapping tests,
  a sample item. Also at `GET /check` on the Worker (API tests only with `SYNC_SECRET`).
- Secrets set to `none` count as unset.
- Reliability (from a review of 0.2.0):
  - Product pages fit Shopify's 1,000-point query cost limit (25 variants, 10 images per
    product, ~19 products per page) and shrink on `MAX_COST_EXCEEDED`.
  - Reconcile budgets products, pages and subrequests (Worker: `MAX_SUBREQUESTS`, default 45),
    saves its exact position (page + offset) and never stalls on bulk edits; the window overlaps by
    `overlapMinutes`; a Shopify error saves progress instead of throwing.
  - Hashes are stored only after a successful publish; a failed publish is retried.
  - Duplicate items from concurrent runs are prevented (Webflow's unique slug: the loser adopts
    the winner's item); a created item's id is stored before publishing.
  - Webhook runs fail fast on long rate-limit waits and queue the product for reconcile.
  - The client-credentials token and the Webflow item index are cached in the store.
  - A draft product whose item was deleted in Webflow is no longer recreated; prune with
    `onDelete: 'unpublish'` no longer repeats.
  - `SYNC_SECRET=none` no longer opens `/reconcile`; `/check` without the secret hides values.
  - The Node state file batches writes, merges with other processes and recovers from a failed write.
- Fix: `server/src/worker.js` was excluded by `.gitignore` in 0.2.0.

## 0.2.0 (2026-11-04)

**Products without a Webflow CMS item**
- `tether-product="url:handle"` (any query parameter, e.g. `url:p`) and `url:path` (last path
  segment): one static page renders any Shopify product.
- `productPath` templates accept `{handle}` and `{id}`, e.g. `'/product?handle={handle}'`.
- `tether-page-title="{title} | Shop"` sets the document title.

**Robustness**
- State blocks: `tether-show="loading | ready | error | not-found"` in products and lists,
  `tether-show="cart-error"` for the cart. Blocks hidden by a Webflow class are shown too.
- Failed scopes get `tether-error` (`not-found` or an error code) and disabled add-to-cart buttons.
- Errors carry a `code` (`NOT_FOUND`, `NETWORK`, `HTTP_401`, …). New events `product-not-found`
  and `cart-error`; product and list failures also emit `error`.
- A failed cart load no longer forgets the cart when Shopify is only unreachable.
- `Tether.diagnose()`: config, API version support window, token reachability, selling plans
  and markup problems on the page.
- Documented `onError` for Sentry-style reporting and the Shopify API upgrade process.
  `npm run smoke` checks diagnose and not-found, and takes `TETHER_API_VERSION`.

**Server-side sync (new, `server/`)**
- Shopify → Webflow CMS sync for a Cloudflare Worker or a Node CLI: HMAC-verified product
  webhooks, idempotent `reconcile` cron with a cursor and a per-run budget, `import` with `--prune`,
  per-project field mapping with Webflow-owned fields, Webflow throttling, `check` command.
  See `server/README.md`.

## 0.1.3 (2026-11-04)

- `tether-bind="image:N"` binds the nth product image (e.g. a lifestyle shot), falling back to the featured image.

## 0.1.2 (2026-11-04)

- `tether-plan-list="true"` / `"all"` / `"*"` now list every plan, like an empty value (Webflow often can't save empty attribute values).

## 0.1.1 (2026-11-04)

- Fix: attributes on the product root element itself (e.g. a card link with `tether-bind="link"`) were ignored.

## 0.1.0 (2026-11-04)

First release.

- Products, variants, options, swatches, metafields, recommendations
- Product lists from collections or search, with load more
- Cart: add (single or many lines), update, remove, clear, note, attributes,
  discount codes, buyer identity, checkout (same or new tab), drawer
- Subscriptions via Shopify selling plans: one-time/subscribe toggle, plan list,
  subscription price and savings, change plan or switch to one-time in the cart
- Bundles / build-a-box with `tether-group`
- Markets via `@inContext(country, language)`
- Configurable attribute prefix (`prefix: 'wfs'` for older markup)
- Hooks for page transitions, scroll locks and animations; generic Barba/Lenis/GSAP preset
- Tolerates tokens without the inventory permission
