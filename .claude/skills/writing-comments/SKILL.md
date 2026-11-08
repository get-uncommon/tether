---
name: writing-comments
description: How to write file, item (/** */) and inline (//) comments in Tether's source, for contributors reading it at HEAD. Use whenever writing or editing comments in .js, .mjs or .d.ts files, including comments added incidentally while fixing bugs or building features. Does not cover user documentation in docs/.
---

# Writing comments

Adapted from Astro's `writing-comments` skill (MIT, see `LICENSE`), with Astro's docs-generation rules removed and Tether's examples added.

## The reader

Write for a contributor who is competent in JavaScript, Shopify's APIs and the DOM but has no access to your current context: not this conversation, the pull request, the issue or the diff. They see only the repository at HEAD.

1. **Never narrate change history.** "Now", "used to", "no longer", "before 0.6.5" mean nothing at HEAD, where only one approach exists. State how the code works and why; history belongs in the commit message.
2. **Never address the reviewer.** A comment that argues a change is correct belongs in the PR description.

## Three kinds of comment, three jobs

| Kind          | Syntax                            | Job         | Contains                                                                                                      |
| ------------- | --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| File overview | `/** */` or `//` block at the top | Explanation | Why the module exists, the terms it defines, where it runs (browser, Worker, Node)                                         |
| Item docs     | `/** */` above a declaration      | Reference   | The contract: behaviour, parameters, return value, errors, invariants                                         |
| Inline        | `//` in a body                    | Rationale   | Only what the code cannot say: a Shopify, Webflow or browser behaviour worked around, a constraint, a coupling elsewhere |

Don't mix the jobs. In JSDoc-typed JavaScript the `/** */` block also carries `@param` and `@returns` types; keep the prose part to the contract.

## The deletion test

Before writing any comment, ask: does this state something the reader cannot recover from the code? If the name fails to carry it, improve the name instead.

## Name the behaviour, not a list of examples

A list of examples stands in for a definition the reader then has to reverse-engineer.

```js
// BAD: the page body mount(document) last ran on (Astro's first page-load repeats it)
// GOOD: The body the last full-document mount ran on: a second mount of the same body sends no requests.
```

Name a library or a site builder only when the code integrates with it by name (Webflow, Astro's ClientRouter, Barba), never as colour.

## Banned patterns

- **Narrating the next line.**
- **Change-history narration.** Rewrite as present-tense rationale.
- **Reviewer-addressed justification.**
- **Restated JSDoc.** `/** Compiles the styles. */` above `compileStyles` says nothing.
- **Vague hedging.** "Some sites", "various reasons", "etc.": name them or drop the sentence.
- **Section banners** (`// ---------------------------------------------------------------- crypto`). A file long enough to need one should be split.
- **Emojis.**

## Conventions in this codebase

- `@param name description`, `@returns` and `@throws` state the contract.
- `TetherError` codes (`NOT_FOUND`, `INVALID_DISCOUNT`, `HTTP_401`) are part of the public API; the comment where one is raised names it.
- `// TODO:` for deferred work, with a link when an issue tracks it. No `FIXME`.

## Editing existing code

- Preserve hard-won context. If a change alters behaviour, correct the specific prose rather than replacing it with generic text.
- A change that makes a comment false fixes it in the same diff.
- Match the surrounding density.

## Self-check before finishing

Re-read only the comments in your diff, apart from the code:

1. Does each one pass the deletion test?
2. Does any refer to the conversation, the change itself or the reviewer?
3. Would a reader without the diff understand each one?

Fix or delete what fails. Deletion is the default.
