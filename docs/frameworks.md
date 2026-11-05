# Tether in other frameworks

Astro has an integration ([guide](astro.md)). Everything else works with three calls and the same
server module. These patterns were tested in Next.js (App Router), SvelteKit, Vite and Eleventy.

## The browser part

```js
import Tether from '@occluze/tether';

// Once, when your app starts in the browser (not on the server):
Tether.init({
  domain: 'your-store.myshopify.com',
  token: 'public-storefront-token',
  country: 'NL', locale: 'nl-NL', productPath: '/products',
  autoMount: false,
});

// After every page render or client-side navigation, on the part of the page that changed:
Tether.mount(document.querySelector('main'));

// Before a client-side navigation removes the page (closes the cart drawer):
Tether.unmount();
```

- `init()` once. Calling it again with options configures Tether again; without options it returns
  the first promise. Call `mount()` after `init()`; it does nothing twice for the same
  element, so calling it on a container that stays in place (`<main>`) only picks up new products.
- `@occluze/tether` is safe to import on the server (SSR): nothing runs until `init()` in the browser.
- Pages that add products later (infinite scroll, your own components) call `Tether.mount(el)`
  for the new part, or set `observe: true` to let Tether watch the page.
- Server-rendered `shop.hydrate()` tags are read by `mount()`, also when they arrive with a
  client-side navigation.
- A plain `<script>` tag with `window.TETHER_CONFIG` starts by itself (the [README](../README.md) setup);
  with `autoMount: false` in it, call `Tether.mount()` yourself.

| Framework | Where |
|---|---|
| Next.js (App Router) | A client component in the root layout: `useEffect(() => { Tether.init(config) }, [])`, and an effect on `usePathname()` + search params that calls `Tether.mount(main)`, with `Tether.unmount()` as its cleanup |
| SvelteKit | `+layout.svelte`: `onMount` → `init`; `afterNavigate` → `mount(main)`; `onNavigate` → `unmount()`. Wrap the page in `{#key $page.url}` so Svelte never patches nodes Tether changed |
| Vite / plain JS | `init()` in your entry, `mount()` after you render a part of the page |
| Eleventy / any static generator | The script tag from the README, or copy `node_modules/@occluze/tether/dist/tether.min.js` (and the two optional parts next to it) to your output, so the browser runs the same version as the server module |

**React / JSX:** value-less attributes need a value: `<button tether-add-to-cart="">`. Keep Tether's
classes (`is-open`, `is-selected`) out of `className` you control on the same element, or React
removes them on the next render.

## The server part

`createStorefront()` from `@occluze/tether/server` works in any server or build step (Node, Workers,
Deno): the [Astro guide's server API](astro.md#server-api) applies as is. Pass options directly
when your framework doesn't use `import.meta.env`:

```js
import { createStorefront } from '@occluze/tether/server';
export const shop = createStorefront({ domain, token, country: 'NL', locale: 'nl-NL', productPath: '/products' });
```

- Render `shop.initialState(product)` (no flash) and `shop.hydrate(product)` (no extra request).
  `initialState` has plain data for props (`selected`, `unavailable`, `show`, `plans`); only
  `isUnavailable()` is a function.
- React: `<div hidden dangerouslySetInnerHTML={{ __html: shop.hydrate(product) }} />`.
  Svelte: `{@html shop.hydrate(product)}`. Nunjucks/Liquid: `{{ hydrate | safe }}`.
- Lists: `shop.hydrate(products, { card: true })` is about 40% smaller. Cards keep the first two
  images (`tether-bind="image:2"` for a hover image); `{ card: true, images: 3 }` keeps more.

## Your own cart UI

```jsx
const [state, setState] = useState({ cart: null, loaded: false, open: false });
useEffect(() => Tether.cart.subscribe((cart, meta) => setState({ cart, ...meta })), []);

// +/-: quick clicks add up and show at once
<button onClick={() => Tether.cart.changeQuantity(line.id, 1)}>+</button>
<span>{Tether.cart.quantityOf(line)}</span>
```

`Tether.cart.open()` / `close()` work without a `tether-cart-drawer` element: they set the `open`
state your component reads from `subscribe`. Put `tether-cart-drawer` on your own drawer element
if you want Tether's dialog semantics, focus handling and Escape.

A cart page instead of a drawer: listen to `tether:added` for an "added to cart" message.
Stock per line: `line.merchandise.quantityAvailable` (with the inventory permission).
