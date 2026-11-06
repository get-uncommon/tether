---
name: types-not-workarounds
description: Fix imprecise types at their source instead of papering over them with runtime checks, casts, optional chains or `in` narrowing. Use when reviewing or writing code that adds a guard, an assertion, an `as`, or a `?.` only to satisfy the type checker, in TypeScript or in JSDoc-typed JavaScript.
---

# Fixing types at the source

Adapted from typescript-eslint's `types-not-workarounds` skill (MIT, see `LICENSE`), with Tether's examples.

A guard that exists to satisfy the type checker rather than to handle a real runtime case adds an untested branch and leaves the wrong type in place for the next caller. Ask not "how do I convince the checker here?" but "which type is wrong, and where?"

## Narrow the parameter, not the body

If a function is only ever called with a narrower type than its signature says, change the signature. Input from the page (attributes, `localStorage`, `<meta>`, the URL) and from the network (Shopify, Webflow, a Worker request body) is parsed once, where it arrives, into a typed value. Code behind that boundary takes the typed value and never re-checks it.

Before:

```js
function withContext(query, ctx = cfg) {
  if (ctx.country) args.push(`country: ${String(ctx.country).toUpperCase()}`);
```

After: the market is parsed with `toCountry` / `toLanguage` where it arrives (`resolveConfig`, `setCountry`), `cfg.country` is typed as a `CountryCode`, and the client's `inContext` takes it as one, with no check of its own. Only the public `Tether.withContext`, which takes any string, parses its arguments.

## `!` when the type is wrong, not `?.`

When the code provably cannot see `undefined`, `?.` adds runtime logic for an impossible case and makes that branch untestable. `!` (or, in JSDoc-typed JavaScript, a `/** @type {T} */` cast) states that the type is wrong. Each one carries a comment saying why it is safe.

## Switch on a discriminant, not on `in`

`"planId" in purchase` narrows by shape and silently accepts variants you never considered. Give state a discriminant (`kind`) and switch on the discriminant, and let `switch-exhaustiveness-check` catch the case you forgot.

## Model state as a union, not as booleans

`purchase: 'one-time' | 'subscription'` next to `planId: string | null` can represent "a subscription without a plan". Write the real states:

```js
/** @typedef {{ kind: 'one-time' } | { kind: 'subscription', planId: string }} Purchase */
```

## Exceptions

- **A guard handling a real case is not a workaround.** Data from the page, the network, KV or a request body is untrusted and is checked where it arrives.
- **Storing a narrowed value is not a workaround.** It is a normal way around gaps in control-flow analysis.
- **Existing `?.` cruft stays** until the underlying type is fixed, not in an unrelated change.
