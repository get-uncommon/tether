---
name: code-clarity
description: Remove the unnecessary intermediate variables, restating comments, golfed one-liners and imprecise names that make Tether's code longer or denser without making it clearer. Use when writing or reviewing any TypeScript or JavaScript in this repository, especially code written with an AI agent's help.
---

# Keeping code direct

Adapted from typescript-eslint's `code-clarity` skill (MIT, see `LICENSE`), with Tether's examples in place of TSESTree ones. One change: where typescript-eslint leans towards compactness, Tether leans towards clarity, because golfed one-liners are this repository's recurring fault.

These are nits: offer a suggestion, don't block on them. There are two exceptions, which do block: a comment that restates code (a stale comment misleads), and a line that has to be read twice to be understood.

## Clarity over brevity

A line that packs a whole computation into one expression has to be unpacked in the reader's head. Give the steps names.

Before:

```js
const deploy = env.DEPLOY_HOOK_URL
  ? createDeployHook({ url: env.DEPLOY_HOOK_URL, minIntervalSeconds: env.DEPLOY_HOOK_MIN_SECONDS !== undefined && !Number.isNaN(Number(env.DEPLOY_HOOK_MIN_SECONDS)) ? Number(env.DEPLOY_HOOK_MIN_SECONDS) : 60, store, log })
  : null;
```

After:

```js
const minIntervalSeconds = numberOr(env.DEPLOY_HOOK_MIN_SECONDS, DEFAULT_DEPLOY_INTERVAL_SECONDS);
const deploy = env.DEPLOY_HOOK_URL ? createDeployHook({ url: env.DEPLOY_HOOK_URL, minIntervalSeconds, store, log }) : null;
```

No nested ternaries. Two branches are a ternary; three are an `if` chain, a lookup table, or a `switch`.

## Don't store a value used once

Keep the variable when it is read more than once, when repeating the expression would be long, when the name explains a computation the expression does not, or when it holds a type-narrowed value. Otherwise inline it. Lowest priority in this skill: raise it once, never twice.

## Declare variables where they are first needed

A declaration above a guard that returns does work the guard would have skipped. Build a value inside the branch that uses it.

## Prefer an early return to a wrapping `if`

When a function body is mostly one branch, invert the condition and return.

## Let `const` infer, and annotate exported functions

Explicit return types on module-private functions are optional. Exported functions, the config (`TetherConfig`) and the shapes Tether reads from Shopify are annotated: their types are the contract.

## Avoid `let` when a ternary will do

A `let` assigned in two branches is a ternary. A `let` reassigned across several branches, or accumulated in a loop, is fine.

## Delete comments that restate the code

Nothing verifies a comment, so it drifts out of date and then misleads. Four recur:

- a label above a test case describing what it covers;
- the history of how the code came to be ("used to", "before this", "no longer");
- a section banner inside a function (`// ------------------------------------------------------------ render`): a file long enough to need one should be split;
- a restatement of the line directly below.

Keep comments that explain a non-obvious why: a Shopify, Webflow or browser behaviour the code works around, an external constraint, an invariant, a magic value's origin. See `writing-comments`.

## Name things fully and accurately

- **No abbreviations.** `p0` → `product`, `fm` → `formatMoney`, `s` → `savings`. Coordinates `x`, `y` and loop indices `i` are fine.
- **The name matches what the code does.**
- **No numeric suffixes.** Name the difference.
- **No magic numbers.** `120` becomes `LAYOUT_DEBOUNCE_MS`; put the unit in the name.
