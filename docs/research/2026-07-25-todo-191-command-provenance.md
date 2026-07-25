# Command provenance — todo #191 Setup Advisor

Source of truth for every `command` string in the Setup Advisor rules dataset. T15 and T16 cite
this file; they do not re-derive sources.

Gathered 2026-07-25 (T2). Registry data from `https://www.skills.sh/api/search?q=<term>` — the
only working endpoint; `skills.sh` 308-redirects to `www.skills.sh`, and `/api/registry`,
`/api/skills`, and `/registry.json` all fail.

Nothing in this table is vendored into the repo (Decision 9). Every command is a constant per
rule — no fingerprint-derived substring ever enters one.

## Status vocabulary

| Status | Meaning |
|---|---|
| VERIFIED | Command transcribed from the tool's own documentation, URL recorded below |
| COMPOSED | Server invocation is vendor-documented; the `claude mcp add` wrapper is composed from Anthropic's documented transport syntax |
| FALLBACK | No registry entry or vendor doc; ships the upstream custom-scaffold snippet instead |
| DROP | No verifiable source and no fallback — excluded from the dataset |

## The match-ratio criterion

skills.sh fuzzy search returns 100 results for *every* query, so "a top hit exists" proves
nothing. A signal counts as matched only when the registry holds a **first-party or
vendor-official** source — the owner is the technology's own org, or a maintainer of it.

**17 of 37 signals (46%) match. 20 of 37 (54%) do not.**

That 46% is the number that matters, and it is the one the tiering preserves. With aggregators
allowed, 36 of 37 signals have a registry source — but 19 of those 36 are strangers' repos, and
a reader who sees only "36 of 37 covered" has been told the opposite of the truth.

The split is not random. It falls exactly along vendor-vs-generic lines:

- **Vendor/product signals are well covered** — Supabase, Prisma, Convex, Stripe, AWS, Sentry,
  Clerk, Auth0, OpenAI, LangChain, Playwright, FastAPI all publish their own skills.
- **Generic language and tooling signals are not covered at all** — no `rust-lang/`, `python/`,
  `expressjs/`, `django/`, `prettier/`, `eslint/`, `tailwindlabs/`, `astral-sh/`, or `docker/`
  owner exists in the registry. For these the top hits are aggregator repos
  (`github/awesome-copilot`, `wshobson/agents`, `jeffallan/claude-skills`).

**Supply-chain decision, ruled by the user:** aggregator repos ship, but attributed. A rule
sourced from an unaffiliated author must show whose repo it installs and how many installs that
repo's skill has, so the reader can tell a stranger's content from the vendor's. The 46% headline
above stays as the honest first-party count; it is not inflated by the aggregator rows.

## Provenance tiers

Every rule carries one. The tier reaches the wire contract as
`AutomationRecommendation.provenance`.

| Tier | Meaning |
|---|---|
| `first-party` | Nothing external is fetched — an Anthropic command, a hook config snippet, or a scaffold this app authors |
| `vendor-official` | Published by the technology's own vendor, or by a core maintainer of it |
| `third-party` | An unaffiliated author's aggregator repo |

`source` (`owner/repo` + install count) rides alongside the tier, and is set on every skills rule
— the only category that installs a named repo at a known install count. MCP, hooks, subagents,
and plugins rules carry a tier but no `source`: there is no registry entry to attribute, and a
fabricated count would be worse than none.

Per category: skills rules are `vendor-official` or `third-party` per the tables below; MCP rules
are `vendor-official` (the vendor's own server package); plugins, hooks, and subagents rules are
`first-party` (Anthropic's marketplace, Anthropic's config schema, our own Markdown).

The UI must keep `third-party` visually distinct. Flattening the distinction is the one thing
this table exists to prevent.

`antfu` (Vue and Vitest core teams) and `vercel-labs` (Vercel's own org) are `vendor-official` by
maintainership, not by owner-name matching. `supabase/agent-skills` supplies the postgres row
because no `postgres/` owner exists — it is vendor-adjacent, and that row's `why` string must not
imply Postgres published it.

## Skills — `npx skills add`

Always the deterministic long form. The bare `npx skills add <owner/repo>` documented in the spec
is interactive on any multi-skill repo and must not ship in a rule.

```
npx skills add <owner/repo> --skill <skill-id> -a claude-code -g -y
```

### Vendor-official sources (17)

| Signal | Source | Skill id | Installs |
|---|---|---|---|
| react | `vercel-labs/agent-skills` | `vercel-react-best-practices` | 578336 |
| vue | `antfu/skills` | `vue` | 30277 |
| svelte | `sveltejs/ai-tools` | `svelte-code-writer` | 6753 |
| fastapi | `fastapi/fastapi` | `fastapi` | 6160 |
| supabase | `supabase/agent-skills` | `supabase` | 182151 |
| postgres | `supabase/agent-skills` | `supabase-postgres-best-practices` | 305878 |
| prisma | `prisma/skills` | `prisma-database-setup` | 51296 |
| convex | `get-convex/agent-skills` | `convex` | 66983 |
| vitest | `antfu/skills` | `vitest` | 29134 |
| playwright | `microsoft/playwright-cli` | `playwright-cli` | 97558 |
| stripe | `stripe/ai` | `stripe-best-practices` | 62548 |
| aws | `aws/agent-toolkit-for-aws` | `aws-iam` | 4251 |
| sentry | `getsentry/sentry-for-ai` | `sentry-workflow` | 3407 |
| openai | `openai/skills` | `openai-docs` | 3438 |
| langchain | `langchain-ai/langchain-skills` | `langchain-rag` | 11706 |
| clerk | `clerk/skills` | `clerk` | 19348 |
| auth0 | `auth0/agent-skills` | `auth0-quickstart` | 2663 |

All 17 rows are tier `vendor-official`, and all carry a `source`.

### Third-party aggregator sources (19)

No vendor publishes a skill for these signals. Each row below is an unaffiliated author's repo,
selected by relevance first and install count second, and ships as tier `third-party` with the
repo and install count rendered in the rule.

| Signal | Source | Skill id | Installs |
|---|---|---|---|
| typescript | `wshobson/agents` | `typescript-advanced-types` | 55514 |
| python | `wshobson/agents` | `python-performance-optimization` | 29714 |
| rust | `wshobson/agents` | `rust-async-patterns` | 16153 |
| java | `github/awesome-copilot` | `java-springboot` | 18370 |
| golang | `samber/cc-skills-golang` | `golang-code-style` | 35764 |
| nextjs | `wshobson/agents` | `nextjs-app-router-patterns` | 25370 |
| express | `aj-geddes/useful-ai-prompts` | `nodejs-express-server` | 2990 |
| django | `affaan-m/everything-claude-code` | `django-patterns` | 7357 |
| angular | `analogjs/angular-skills` | `angular-component` | 9848 |
| drizzle | `bobmatnyc/claude-mpm-skills` | `drizzle-orm` | 4354 |
| jest | `github/awesome-copilot` | `javascript-typescript-jest` | 11922 |
| pytest | `github/awesome-copilot` | `pytest-coverage` | 11881 |
| prettier | `patricio0312rev/skills` | `eslint-prettier-config` | 898 |
| eslint | `patricio0312rev/skills` | `eslint-prettier-config` | 898 |
| ruff | `github/awesome-copilot` | `ruff-recursive-fix` | 1337 |
| tsconfig | `oimiragieo/agent-studio` | `tsconfig-json-rules` | 68 |
| tailwind | `wshobson/agents` | `tailwind-design-system` | 55916 |
| docker | `github/awesome-copilot` | `multi-stage-dockerfile` | 18987 |
| next-auth | `mindrally/skills` | `nextauth-authentication` | 938 |

`analogjs` is an Angular-ecosystem org but not the Angular team, and `samber` is unaffiliated
with the Go team; both stay `third-party`.

Two low-install rows are worth a second look before shipping: `tsconfig` (68 installs) and
`prettier`/`eslint` (898). They are genuinely on-topic, but at those counts the attribution is
carrying most of the weight.

**Rejected higher-install hits**, recorded so they are not re-litigated: `mattpocock/skills`
`setup-pre-commit` (159225) for prettier — a generic pre-commit skill, not Prettier-specific;
`microsoft/azure-skills` `python-appservice-deploy` (82665) for python — Azure deployment, not
the language; `clerk/skills` `clerk-nextjs-patterns` (28195) for nextjs — Clerk auth, not Next.js.
Install count never overrode relevance.

### No source at any tier (1)

`passport` — every hit was a generic NestJS skill or an unrelated domain (travel documents,
Laravel auth), and `q=passportjs` returned zero results. It gets no skills rule. The signal is
not wasted: it still reaches the user through `externalApis`, which drives the
`security-guidance` plugin rule and the security-reviewer subagent.

### Custom-scaffold fallbacks (8)

From the upstream bundle's `references/skills-reference.md` (claude-code-setup v1.0.0),
transcribed at implementation time, never vendored. `command` is the SKILL.md frontmatter
snippet; `targetPath` is `.claude/skills/<name>/SKILL.md`.

`api-doc`, `create-migration`, `gen-test`, `new-component`, `pr-check`, `release-notes`,
`project-conventions`, `setup-dev`

The plan listed seven; the reference file carries eight. `setup-dev` is included.

Tier `first-party`, no `source`: these scaffold a file the user owns, fetching nothing.

## MCP servers — `claude mcp add`

Anthropic's transport syntax reference for all rows: https://code.claude.com/docs/en/mcp

| Rule | Status | Command | Source |
|---|---|---|---|
| context7 | VERIFIED | `claude mcp add --scope user --header "CONTEXT7_API_KEY: YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp` | upstream SKILL.md:172 + context7 docs |
| playwright | VERIFIED | `claude mcp add playwright npx @playwright/mcp@latest` | Playwright MCP README |
| supabase | VERIFIED | `claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp"` | Supabase docs |
| github | VERIFIED | `claude mcp add --transport http github https://api.githubcopilot.com/mcp/ --header "Authorization: Bearer YOUR_GITHUB_PAT"` | code.claude.com/docs/en/mcp |
| sentry | VERIFIED | `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` | code.claude.com/docs/en/mcp, mcp.sentry.dev |
| postgres | VERIFIED | `claude mcp add --transport stdio db -- npx -y @bytebase/dbhub --dsn "postgresql://…"` | code.claude.com/docs/en/mcp |
| aws | COMPOSED | `claude mcp add --transport stdio aws-api -- uvx awslabs.aws-api-mcp-server@latest` | server invocation from awslabs README; wrapper composed |
| convex | MOVED | — | Convex documents a plugin, not MCP — see plugins below |
| docker | DROP | — | no Claude Code command exists in Docker's documentation |

The AWS row is the only COMPOSED entry: the `uvx` invocation is vendor-documented, but AWS
publishes JSON config rather than a `claude mcp add` line, so the wrapper comes from Anthropic's
documented `--transport stdio` form. It is composition from two authoritative sources, not
invention.

## Hooks — `.claude/settings.json`

Every hooks rule cites https://code.claude.com/docs/en/hooks, which supplies the full event list
(30 events), the `settings.json` structure, matcher syntax, and which events accept matchers.
`targetPath` is `.claude/settings.json`.

| Rule | Event | Matcher | Trigger signal |
|---|---|---|---|
| format-on-edit | `PostToolUse` | `Edit\|Write` | `tooling` contains prettier |
| lint-on-edit | `PostToolUse` | `Edit\|Write` | `tooling` contains eslint or ruff |
| typecheck-on-edit | `PostToolUse` | `Edit\|Write` | `tooling` contains tsconfig |
| run-related-tests | `PostToolUse` | `Edit\|Write` | `dirs` contains tests |
| block-edits | `PreToolUse` | `Edit\|Write` | `hasEnvFiles` or `hasLockFiles` |

The docs' verbatim `PostToolUse` + `Edit|Write` lint example is the shape all five follow. The
upstream `references/hooks-patterns.md` supplies the detection→recommendation mapping and the
rationale only; it carries no usable snippets, which is why the schema citation is the docs page.

## Plugins — `/plugin install`

All 15 verified present in the local `claude-plugins-official` marketplace manifest (273 plugins).

```
/plugin install <name>@claude-plugins-official
```

| Rule | Plugin | Trigger signal |
|---|---|---|
| frontend-design | `frontend-design` | frontend framework detected |
| pr-review-toolkit | `pr-review-toolkit` | `gitHost` non-null |
| commit-commands | `commit-commands` | `gitHost` non-null |
| hookify | `hookify` | `tooling` contains prettier, eslint, ruff, or tsconfig |
| typescript-lsp | `typescript-lsp` | `languages` contains typescript |
| pyright-lsp | `pyright-lsp` | `languages` contains python |
| gopls-lsp | `gopls-lsp` | `languages` contains go |
| rust-analyzer-lsp | `rust-analyzer-lsp` | `languages` contains rust |
| jdtls-lsp | `jdtls-lsp` | `languages` contains java |
| code-review | `code-review` | `fileCount` > 500 |
| plugin-dev | `plugin-dev` | `hasClaudeConfig` |
| feature-dev | `feature-dev` | `languages` non-empty |
| security-guidance | `security-guidance` | `externalApis` intersects auth libraries |
| claude-code-setup | `claude-code-setup` | no `hasClaudeConfig` |
| convex | `convex` | `databases` contains convex |

`convex` moved here from MCP: Convex documents `/plugin install convex@claude-plugins-official`
as its Claude Code path. Its MCP invocation (`npx -y convex@latest mcp start`) exists but is not
what Convex recommends.

## Footer copy — per category

`/plugin install` is a slash command typed inside Claude Code, not a shell command. The docs
confirm it ("Install with `/plugin install`"). A single terminal-oriented footer would be false
for the entire plugins category.

| Category | Footer |
|---|---|
| plugins | `Read-only — run this inside Claude Code.` |
| mcp, skills, hooks, subagents | `Read-only — commands run in your terminal.` |

This diverges from the spec's single mandated footer. The truthful footer wins.

## Subagents

No external provenance applies. Subagent rules ship hand-authored Markdown bodies with
`targetPath` of `.claude/agents/<name>.md`, per the spec's category mapping. Their schema
citation is https://code.claude.com/docs/en/sub-agents.

## Worktree constraint

Decision 22: worktree checkouts get no GitHub/GitLab-remote recommendations. The `gitHost`
predicate must not fire for a worktree, which excludes the `pr-review-toolkit`,
`commit-commands`, and `github` MCP rules there.
