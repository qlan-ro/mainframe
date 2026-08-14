# todo #323 — full Tauri e2e regression sweep

Closes the QA session's one open item: the prior `pnpm test:e2e` run was
SIGTERM'd mid-flight at 323/422 tests, so no-regression couldn't be certified
for the untested tail (settings.spec.ts onward).

## Why the sweep script, not `pnpm test:e2e`

`packages/e2e/run-tauri-sweep.sh` runs one Playwright invocation per spec
file instead of one invocation for the whole suite. Its own header explains
why that's the repo-canonical way to get a trustworthy complete local run:
multi-file runs share one 40-minute `globalTimeout` and starve the tail —
which is exactly the failure mode the prior interrupted run hit. Each spec
gets its own daemon + preview server and its own budget.

## Run

```
MF_E2E_SKIP_BUILD=1 E2E_MODE=mock ./packages/e2e/run-tauri-sweep.sh
```

against commit `d98b0928` (this branch's tip — the automations-library spec
and its supporting helper/plan/changeset commits, plus the earlier
skeleton-drop commit). UI bundle was pre-built for `VITE_DAEMON_PORT=31416`;
`packages/core-rs/target/release/mainframe-daemon` was the release binary the
sweep's daemon fixture resolved.

## Result: 34/34 spec files green, zero regressions

| Metric | Count |
|---|---|
| Spec files run | 34 (full `tests-tauri/*.spec.ts`, including the new `automations-library.spec.ts`) |
| Files with a nonzero exit code | 0 |
| Tests passed | 395 |
| Tests skipped (documented `TODO(bug)` / conditional skips) | 36 |
| Tests flaky (needed the suite's 1-retry policy) | 0 |
| Tests failed | 0 |
| Total accounted for | 431 |

Full per-file breakdown (`exit=0 <playwright summary line>` for every file):

```
automations-library: exit=0 6 passed (6.0s)
chat-header: exit=0 1 skipped 5 passed (4.4s)
chat: exit=0 3 skipped 8 passed (8.2s)
composer-advanced: exit=0 8 skipped 12 passed (9.0s)
composer: exit=0 1 skipped 14 passed (12.8s)
daemon-picker: exit=0 10 passed (13.8s)
directory-picker: exit=0 1 skipped 13 passed (6.6s)
editor-comments-review: exit=0 1 skipped 11 passed (10.7s)
editor-diff: exit=0 1 skipped 5 passed (5.6s)
editor: exit=0 1 skipped 12 passed (7.1s)
files-tree: exit=0 17 passed (7.8s)
find-in-path: exit=0 9 passed (12.9s)
gates: exit=0 6 passed (10.8s)
git-branch: exit=0 17 passed (29.8s)
layout: exit=0 11 passed (12.7s)
preview: exit=0 4 skipped 9 passed (12.5s)
review-panel: exit=0 17 passed (13.3s)
session-panel: exit=0 28 passed (10.7s)
session-tabs: exit=0 6 passed (5.6s)
sessions-draft: exit=0 15 passed (34.3s)
sessions-filters: exit=0 2 skipped 15 passed (12.8s)
sessions-rows: exit=0 1 skipped 11 passed (11.2s)
sessions-tags: exit=0 1 skipped 11 passed (8.5s)
sessions: exit=0 14 passed (14.8s)
settings: exit=0 19 passed (17.4s)
sidebar-chrome: exit=0 1 skipped 6 passed (3.4s)
spotlight: exit=0 1 skipped 12 passed (11.3s)
stress-matrix: exit=0 1 passed (6.3s)
tasks: exit=0 1 skipped 17 passed (21.1s)
tool-cards: exit=0 21 passed (29.5s)
transcript: exit=0 4 skipped 10 passed (8.8s)
viewers: exit=0 1 skipped 9 passed (4.2s)
window-states: exit=0 2 skipped 7 passed (16.5s)
workspace-surface: exit=0 1 skipped 11 passed (7.2s)
```

Notes on specs the prior session flagged:

- **`automations-library.spec.ts`** (this todo's new spec): 6/6 passed, no
  retries needed.
- **`sessions.spec.ts`**: the prior session reported an auto-recovered flake
  at `sessions.spec.ts:320` (archive-dialog worktree deletion, retry #1).
  This sweep's `sessions` line shows `14 passed`, `0` flaky, `exit=0` — the
  scenario passed on its first attempt this run, consistent with the prior
  report's characterization of it as an AI-response flake rather than a
  regression.
- **`transcript.spec.ts`**: the repo memory notes a CI-only flake on the
  transcript pair (`e2e-red-since-rc20`). Locally this run passed clean
  (10 passed, 4 documented skips, 0 flaky) — no local reproduction, no new
  information contradicting the "CI-only" characterization.

## Cleanup

Verified after the sweep: no leftover `playwright` or `mainframe-daemon`
processes. One leftover `vite preview --port 4317` process remained from the
last spec file; killed by port (`lsof -ti :4317 | xargs kill`), then
reverified no listener on that port. Production
(`/Applications/Mainframe.app`, `:31415`, pid unrelated to the sweep) was
confirmed alive and untouched before and after (`GET /health` → `200`)
throughout.

The prior interrupted session reported a suite total of 422 tests (from a
`pnpm test:e2e` run cut short at 323/422); this complete per-spec sweep
accounts for 431 (395 passed + 36 skipped) across all 34 spec files, with
zero failures. The two totals aren't reconciled here — differences in
per-run conditional skip counts or "did not run" bookkeeping between the
two invocation styles are plausible but unverified; reporting both numbers
as observed rather than guessing at the gap.

## Conclusion

Acceptance criterion "the full Tauri e2e project passes locally with the new
spec included, and no existing spec regresses" is met. No product code was
touched to get here — this document is the artifact.
