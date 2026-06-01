# Tech-Debt Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate every actionable finding from the two architecture audits (deepening + thermo-nuclear, and convention-divergence) on `feat/code-tech-debt`, one verifiable workstream per commit.

**Architecture:** Findings are mapped to 19 workstreams. We execute by dependency + risk: confirmed bugs/security first, then foundational type/contract unification (which other workstreams depend on), then area refactors, then mechanical sweeps, then the long tail. Each workstream is curated against the raw audit buckets when reached (the auto-classifier is a first-pass map, not gospil) and lands as its own commit with green build + tests.

**Tech Stack:** TypeScript (strict, NodeNext), pnpm workspaces, vitest, better-sqlite3, Express + ws, Electron/React/Zustand.

**Source digests:** `/tmp/audit-digest.json` (247 deepening findings), `/tmp/divergence-digest.json` (113 deviations / 20 axes). Reports: `architecture-review-*.html`, `divergence-audit-*.html`.

**Baseline (verified 2026-05-29):** `pnpm build` green; core `1554/1554` tests pass (one known-flaky `search.test.ts > searches directory recursively`).

---

## Workstream sequence & status

| # | Workstream | Items | Focus | Status |
|---|---|---|---|---|
| WS1 | Security | 7 (curated) | path-boundary bug + 2 copies, chatId traversal, command-name injection, shell interpolation | ✅ done `fbb768bd` |
| WS7 | DB cascade | 5 | transactional cascade (NOT FK — migration risk); bg-task map leak | ✅ done `d9898047` |
| WS3a | Canonical content types | keystone | `LeafContent` base + `permission_request: ControlRequest` (sentinel removals → WS14) | ✅ done `ad6d2f36` |
| WS3b | Canonical mode type | 13 | one `ExecutionMode`; Zod from one source | ✅ done `5ddd7e9b` |
| WS4 | Response envelope + http | 26 | asyncHandler "latent-bug" = **FALSE POSITIVE** (Express 5); envelope normalization still TODO (client-coupled) | ◑ asyncHandler done `87a608aa`; envelope pending |
| WS5 | Git consolidation | 18 | shared `git-parse.ts`, `detectBaseBranch()`, worktree.ts -> async `execGit`; removed dead `isGitRepo` | done `71eb584a` (batch 2) |
| WS6 | events.ts decomposition | 19 | split 740-line file; lift Claude-specific parsing | pending |
| WS14-followups | — | — | (1) WS14a: MainframeText matches error parts by `message === text` string-equality — codex MEDIUM: could misfire if a sibling text part equals an error block's message in the same DisplayMessage. Robust fix = match by part index (needs running app to verify assistant-ui part-index API → group with WS14c). (2) scattered-progress data-loss quirk (own PR). |
| WS14 | Message display pipeline | scope grew | NOT 4 trivial items — real round-trip (findings #0/#7/#10/#11). WS14a error sentinel `5b9a3f0e`; characterization tests `5e4beed4`; WS14b core applyToolGrouping passthrough rewrite `3c8d4e21`. WS14c (desktop _ToolGroup/_TaskGroup re-encode removal, HIGH risk, needs running app to verify rendering) PENDING. Follow-up: scattered-progress data-loss quirk pinned but NOT fixed (own PR). | ◑ WS14a/b done; WS14c pending |
| WS8 | Transport WS→REST | 7 | migrate command ClientEvents to REST (author TODO) | pending |
| WS9 | Logging/catch hygiene | 13 | no silent catch, no `console.*` in core | ✅ done `b03be53c` |
| WS10 | Zod coverage | 7 | validate the unguarded endpoints | ✅ done `c6c3166e` |
| WS11 | UI logic → core | 85* | move pure logic out of React (*over-captured, curate) | pending |
| WS12 | data-testid | 3 | tag untagged interactive elements | ✅ done `efdec0d0` |
| WS13 | File-size decomposition | 19 | split genuine sprawl (skip cohesive big files) | pending |
| WS15 | Copy-paste dedup | 16 | extract canonical helpers | pending |
| WS16 | Deepen shallow modules | 13 | delete thin wrappers / façades | pending |
| WS17 | Layering leaks | 17 | move logic to canonical layer | pending |
| WS18 | Misc core | 7 | remaining core findings | pending |
| WS19 | Emergent-norm misc | 11 | route-factory, nanoid, etc. (1 latent-bug) | pending |
| WS0 | Justified (skip) | 34 | no action — audited & defensible | n/a |

\* buckets WS11/WS18/WS19 are first-pass classifier output; each is curated against the digest when reached so no finding is silently dropped or mis-scoped.

---

## WS1: Security

**Files:**
- Modify: `packages/core/src/server/routes/path-utils.ts` (boundary predicate)
- Test: `packages/core/src/__tests__/routes/path-utils.test.ts`
- Modify: `packages/core/src/server/routes/search.ts:28-38` (use canonical helper)
- Modify: `packages/core/src/attachment/attachment-store.ts` (validate `chatId` segment)
- Modify: `packages/core/src/server/ws-schemas.ts:53` (command-name regex)
- Modify: `packages/core/src/lsp/lsp-registry.ts:89` (no shell interpolation)

- [ ] **Step 1: Failing test — prefix-boundary bug.** Add a sibling-dir case to `path-utils.test.ts`: a base `tmpDir/proj` and a sibling `tmpDir/proj-evil`; `resolveAndValidatePath(base, '../proj-evil/secret')` must return `null`. With the current `startsWith(realBase)` it returns the path → FAIL.
- [ ] **Step 2: Fix** — extract `isWithinBase(realBase, realTarget)` = `realTarget === realBase || realTarget.startsWith(realBase + path.sep)`; build both `resolveAndValidatePath` and `resolveClaudeConfigPath` on it. Run test → PASS.
- [ ] **Step 3:** Route `search.ts` `isWithinBase` through the shared predicate (delete the divergent copy; keep async wrapper).
- [ ] **Step 4: chatId traversal** — in `attachment-store.ts`, validate the `chatId` segment (`basename` + reject traversal) before every `join(baseDir, chatId)`.
- [ ] **Step 5: command-name injection** — `ws-schemas.ts:53` `name: z.string().min(1)` → `z.string().regex(/^[a-zA-Z0-9_-]+$/)`; add a schema test.
- [ ] **Step 6: shell interpolation** — `lsp-registry.ts:89` → `execFileAsync('/bin/sh', ['-c', 'command -v "$1"', 'sh', config.command])`.
- [ ] **Step 7:** `pnpm --filter @qlan-ro/mainframe-core test` + `pnpm build` green; commit `fix(core): close path-traversal, command-name and shell-interpolation seams (WS1)`.

(Later workstreams are detailed when reached, per YAGNI — the digests hold every finding's files/lines/fix.)
