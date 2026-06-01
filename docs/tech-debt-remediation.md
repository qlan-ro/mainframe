# Tech-Debt Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate every actionable finding from the two architecture audits (deepening + thermo-nuclear, and convention-divergence) on `feat/code-tech-debt`, one verifiable workstream per commit.

**Architecture:** Findings are mapped to 19 workstreams. We execute by dependency + risk: confirmed bugs/security first, then foundational type/contract unification (which other workstreams depend on), then area refactors, then mechanical sweeps, then the long tail. Each workstream is curated against the raw audit buckets when reached (the auto-classifier is a first-pass map, not gospil) and lands as its own commit with green build + tests.

**Tech Stack:** TypeScript (strict, NodeNext), pnpm workspaces, vitest, better-sqlite3, Express + ws, Electron/React/Zustand.

**Source digests:** `/tmp/audit-digest.json` (247 deepening findings), `/tmp/divergence-digest.json` (113 deviations / 20 axes). Reports: `architecture-review-*.html`, `divergence-audit-*.html`.

**Baseline (verified 2026-05-29):** `pnpm build` green; core `1554/1554` tests pass (one known-flaky `search.test.ts > searches directory recursively`).

---

## Status — 2026-06-01

> This section supersedes the original 2026-05-29 snapshot in the table below (kept as the historical plan). All actionable workstreams are **complete**; everything is consolidated into one revertable PR.

**Single revertable PR:** **#371** `feat/tech-debt-all` → `main` (squash-merge → one-commit revert). Supersedes the granular stack PRs for *merging*; merge **one or the other, not both**.

**Granular stack PRs** (for review history): #359 (batch 1) · #360 (batch 2) · #367 (batch 3) · #368 (batch 4) · #366 (WS4) · #369 (WS8). **Mobile** half of WS8: **mainframe-mobile#14** (separate repo / submodule — ship together with WS8).

**Verification (2026-06-01, on `feat/tech-debt-all`):** `pnpm build` 0 type errors; tests green — types 3 · mobile 8 · core 1684 · desktop 760.

| WS | Status | Where |
|----|--------|-------|
| WS1 Security · WS3a/3b types · WS7 DB cascade · WS9 logging · WS10 Zod · WS12 testid | ✅ done | batch 1 (#359) |
| WS5 Git consolidation · WS14a/b message pipeline | ✅ done | batch 2 (#360) |
| `createWorktree` chatId drop · scattered-progress `_TaskProgress` dedup | ✅ done | batch 3 (#367) |
| WS6 events.ts decomposition · WS15 dedup · WS16 deepen-shallow · WS18 misc-core · WS19 emergent-norm | ✅ done (curated) | batch 4 (#368) |
| **WS4** Response-envelope normalization (full, not just asyncHandler) | ✅ done | #366 |
| **WS8** WS→REST transport (+ `subscribe:ack`, hard cutover) | ✅ done | #369 + mobile#14 |
| **WS14c** First-class typed display content (drop sentinel string-matching) | ✅ done | in #371 (branch `refactor/ws14c-typed-display-content-v2`) |
| WS11 UI-logic→core (85, over-captured) | ⏭ skip / re-triage | audit: mostly noise |
| WS13 File-size decomposition | ⏭ skip | remaining big files are cohesive |
| WS17 Layering leaks | ⏭ skip | partial value; not worth the coupling cost |
| WS0 Justified | n/a | audited & defensible |

**Residual manual check:** WS14c changed the rendered `task_progress` `DisplayContent` path — worth a visual confirmation of the task-progress card in the running Electron app (the core transform is unit-tested; rendering is not).

**Reviews:** WS4 and WS8 each passed a Codex plan-review + code-review loop (APPROVED).

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
