# Where these skills come from

These are copies of the upstream rule text, each pinned to a commit. Nothing here is fetched at run time. To update a skill, copy the new upstream text in a reviewed change. Kovo, Umber and occluze use the same copies.

| Skill or agent | Source | Commit | Licence | Changes |
| --- | --- | --- | --- | --- |
| `codebase-design` | [mattpocock/skills](https://github.com/mattpocock/skills) `skills/engineering/codebase-design` | `7739eaed7f8f` | MIT | None |
| `code-clarity` | [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) `.agents/skills/code-clarity` | `8930adad8fc3` | MIT | Examples rewritten for Tether; leans to clarity over compactness |
| `types-not-workarounds` | [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) `.agents/skills/types-not-workarounds` | `8930adad8fc3` | MIT | TSESTree sections replaced with page-input parsing and state unions |
| `writing-comments` | [withastro/astro](https://github.com/withastro/astro) `.agents/skills/writing-comments` | `f1c0b24471ae` | MIT | Astro docs-generation rules removed; Tether examples added |
| `shopify-apis/references` | [Shopify/Shopify-AI-Toolkit](https://github.com/Shopify/Shopify-AI-Toolkit) `skills/shopify/references/{storefront-graphql,customer}.md` | `a3d20f8dc284` | MIT | None. The toolkit's scripts and telemetry hook are left out |
| `shopify-apis/SKILL.md` | Tether | | | Written for this repository |
| `../agents/type-design-analyzer.md`, `comment-analyzer.md`, `silent-failure-hunter.md` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) `plugins/pr-review-toolkit/agents` | `30202c767cfa` | Apache-2.0 (`../agents/LICENSE-pr-review-toolkit`) | None |

Considered and not copied: [webflow/webflow-skills](https://github.com/webflow/webflow-skills) (MIT). Every skill there operates a Webflow site through Webflow's MCP server. None of them covers code that calls the Data API, which is what `server/src/webflow.ts` does.
