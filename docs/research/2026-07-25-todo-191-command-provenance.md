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

The split is not random. It falls exactly along vendor-vs-generic lines:

- **Vendor/product signals are well covered** — Supabase, Prisma, Convex, Stripe, AWS, Sentry,
  Clerk, Auth0, OpenAI, LangChain, Playwright, FastAPI all publish their own skills.
- **Generic language and tooling signals are not covered at all** — no `rust-lang/`, `python/`,
  `expressjs/`, `django/`, `prettier/`, `eslint/`, `tailwindlabs/`, `astral-sh/`, or `docker/`
  owner exists in the registry. For these the top hits are aggregator repos
  (`github/awesome-copilot`, `wshobson/agents`, `jeffallan/claude-skills`).

**Open decision, flagged not taken:** aggregator repos are real registry entries, so they satisfy
the spec's literal "verified to exist on skills.sh" test. But recommending an unaffiliated
third-party repo to a user, whose command then installs that repo's content onto their machine,
is a supply-chain call — not an implementation call. This table therefore takes the conservative
path: **first-party sources only; every generic signal uses the custom-scaffold FALLBACK.** If
the user wants aggregator sources shipped, the 20 FALLBACK rows below are what changes.

## Skills — `npx skills add`

Always the deterministic long form. The bare `npx skills add <owner/repo>` documented in the spec
is interactive on any multi-skill repo and must not ship in a rule.

```
npx skills add <owner/repo> --skill <skill-id> -a claude-code -g -y
```

### Matched — first-party registry sources (17)

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

`antfu` and `vercel-labs` count as first-party by maintainership: antfu is on the Vue and Vitest
core teams, `vercel-labs` is Vercel's own org. `supabase/agent-skills` supplies the postgres row
because no `postgres/` owner exists; it is vendor-adjacent, not neutral, and the rule's `why`
string should not imply otherwise.

### Unmatched — no first-party source (20)

`typescript`, `python`, `rust`, `java`, `golang`, `nextjs`, `express`, `django`, `angular`,
`drizzle`, `jest`, `pytest`, `prettier`, `eslint`, `ruff`, `tsconfig`, `tailwind`, `docker`,
`next-auth`, `passport`

Two near-misses worth recording so they are not re-litigated: `analogjs/angular-skills` (9848)
is an Angular-ecosystem org but not Angular itself; `samber/cc-skills-golang` (35764) is popular
but unaffiliated with the Go team. Both are excluded under the conservative rule above.

### Custom-scaffold fallbacks (8)

From the upstream bundle's `references/skills-reference.md` (claude-code-setup v1.0.0),
transcribed at implementation time, never vendored. `command` is the SKILL.md frontmatter
snippet; `targetPath` is `.claude/skills/<name>/SKILL.md`.

`api-doc`, `create-migration`, `gen-test`, `new-component`, `pr-check`, `release-notes`,
`project-conventions`, `setup-dev`

The plan listed seven; the reference file carries eight. `setup-dev` is included.

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
