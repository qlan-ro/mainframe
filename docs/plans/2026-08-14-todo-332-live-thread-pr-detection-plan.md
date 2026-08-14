# Live thread doesn't detect PR — implementation plan (todo #332)

## Goal

When the daemon detects a pull request during an in-flight turn, it persists the PR on the chat row and
broadcasts `chat.prDetected` to every client subscribed to that chat — which always includes the session the
user is looking at. The client throws that event away: `SessionListRouter` has no case for it, so nothing
refreshes the sessions-list projection that every PR surface reads. The user sees no PR until an unrelated
refetch lands or they reopen the session. This plan adds the one missing router case (`chat.prDetected` →
the existing debounced `onReload`), a red-phase unit test that observes the gap first, and a test that pins
the coalescing on the refresh path so a burst of events cannot become a refetch storm. No daemon change, no
type change, no new subscription, no new PR surface.

## Established facts

Every line below was verified while planning. Downstream implementers and reviewers should trust these
rather than re-deriving them.

| Fact | Receipt |
| --- | --- |
| The `chat.prDetected` member already exists in the shared TS event union, carrying `chatId` and a `DetectedPr`. No contract change is needed. | `packages/types/src/events.ts:91` |
| The daemon emits `chat.prDetected` **live, mid-turn**, from the CLI stream handler — not only on chat load. | `packages/core-rs/crates/mainframe-chat/src/event_handler.rs:1161` (`on_pr_detected`) |
| The live path persists **before** it broadcasts: `add_detected_prs` runs first, and only its return value is emitted. A reload triggered by the event therefore reads the already-persisted PR. | `event_handler.rs:1161-1171`; `packages/core-rs/crates/mainframe-server/src/chat_deps.rs:414-418` (`call_blocking` → `d.chats.add_detected_prs`) |
| `add_detected_prs` dedupes by URL and returns **only** rows that were newly written or upgraded `mentioned` → `created`. A repeat detection of the same PR returns an empty vec, so no event is emitted at all. | `packages/core-rs/crates/mainframe-db/src/chats.rs:537-570` |
| `chat.prDetected` is **not** connection-global. The fan-out delivers `chatId`-carrying events only to clients subscribed to that chat. | `packages/core-rs/crates/mainframe-server/src/websocket.rs:51-55` (`CONNECTION_GLOBAL_EVENT_TYPES` = `chat.notification`, `permission.requested`, `automation.notification`), `websocket.rs:682-692` (`is_global \|\| subscriptions.contains(chat)`) |
| Sessions not currently open keep their existing path: the daemon re-scans the whole transcript on chat load and persists + emits from there. | `chat_deps.rs:550` (`self.scan_and_persist_prs(chat_id, &history)`), `chat_deps.rs:169-188` |
| The client router listens on the **shared** `daemonWs` singleton, not a per-chat socket. Adding a case opens no new subscription. | `packages/ui/src/features/sessions/ws/session-list-router.ts:62`; `packages/ui/src/features/sessions/ws/use-session-list-router.ts:134` |
| `SessionListRouter.route` has no `chat.prDetected` case; unmatched types hit `default: return;`. This is the bug. | `session-list-router.ts:65-100` |
| The list-refresh path is already coalesced: leading-edge reload, then a 200 ms trailing window collapses a burst into one further reload. `onReload` passed to the router **is** that `scheduleReload`. | `use-session-list-router.ts:117-136` |
| `threads.reload()` re-derives every session's `custom` from the daemon through `chatToThreadCustom`, which copies `chat.detectedPrs` into `SessionCustom.detectedPrs`. | `packages/ui/src/features/sessions/view-model/chat-to-thread-custom.ts:67` |
| The projection is already tested for detectedPrs pass-through and empty-default. | `packages/ui/src/features/sessions/view-model/__tests__/chat-to-thread-custom.test.ts:120-124` |
| The remote adapter's `list()` → `custom.detectedPrs` seam is already tested. | `packages/ui/src/features/sessions/runtime/__tests__/chats-remote-adapter.test.ts:109` |
| `activeSessionCustom` prefers the **remoteId-keyed** thread entry over the `__LOCALID_*` entry, so a session created this app-run still sees the refreshed custom after a reload. | `chat-to-thread-custom.ts:138-145` |
| All three PR surfaces read `detectedPrs` off that same projection — one reload updates all three. | Summary PR row: `packages/ui/src/features/session-panel/SummarySection.tsx:168`; session-row glyph + hover card: `packages/ui/src/features/sessions/SessionRow.tsx:125,272`; "has PR" filter: `packages/ui/src/features/sessions/filter/apply-session-filters.ts:28` |
| The per-chat controller's event mapper ends in a **silent** `default: return { kind: 'noop' }` — an unhandled `chat.prDetected` logs nothing and warns nothing. No controller change and no explicit-ignore case is needed. | `packages/ui/src/features/chat/controller/handle-daemon-event.ts:155-156` |
| The chat header deliberately renders no PR link, pinned by a test. Out of scope. | `packages/ui/src/features/chat/thread/__tests__/ChatCardHeader.test.tsx:155` |
| `docs/plans/` is gitignored, so this plan is committed with `git add -f`. | `.gitignore:53` |

## Design decision

The brief offered two routes: a targeted state update, or reuse of the existing debounced list refresh. This
plan takes the debounced refresh, matching the brief's recommendation.

The reason is not just precedent. `@assistant-ui/react` exposes no mutate-one-thread API under
`useRemoteThreadListRuntime` — the reason `chat.updated` already reloads instead of patching
(`session-list-router.ts:5-8`). A surgical update would have to fork the projection and write a second path
into `custom.detectedPrs` that the next reload immediately overwrites. Reload re-derives from the daemon,
which is also what makes a duplicate event harmless: the same list comes back and the projection is
unchanged, so nothing re-renders. The reload is already debounced, so a burst costs at most two refetches.

## Acceptance-criteria disposition

| Criterion | How it is met |
| --- | --- |
| PR appears in the Summary PR row of the open session, no reopen | New router case → `scheduleReload` → `chats-remote-adapter.list()` → `chatToThreadCustom` (detectedPrs) → `activeSessionCustom` → `SummarySection.tsx:168`. Every link after the router is already tested (receipts above); Task 1 covers the missing link. |
| Same PR appears as the session-row indicator and matches the "has PR" filter | Same single reload; `SessionRow.tsx:125,272` and `apply-session-filters.ts:28` read the same `custom.detectedPrs`. No extra code. |
| PR in a non-open session still appears on the next list refresh; no new per-chat subscriptions | **No code change.** The load-path rescan (`chat_deps.rs:550`) and the existing `chat.updated`/`background_task.*` reloads are untouched. The router listens on the shared `daemonWs`, so nothing new is subscribed. |
| Same PR twice → no duplicate, no flicker; coalescing preserved | Daemon-side: `add_detected_prs` returns nothing for a repeat, so no second event fires (`chats.rs:537-570`). Client-side: reload re-derives the same list, and `scheduleReload` collapses bursts. Task 3 pins the coalescing, which has no test today. |
| A test drives the event router with `chat.prDetected` and fails before the fix | Task 1, observed red before Task 2. |
| Typecheck + UI tests pass; ships with a changeset | Task 2 (changeset) and Task 4 (verification). |

## Constraints from CLAUDE.md

- `packages/ui` files stay under 300 lines / 50 lines per function. `session-list-router.ts` is 116 lines and
  gains 2; no decomposition needed.
- A changeset is mandatory before commit (`@qlan-ro/mainframe-ui`, patch).
- Tests are required for changed client logic; TDD ordering means the router test lands and fails first.
- No leftovers: the router's header docblock documents every routed event type, so the new case updates it in
  the same commit.
- Run single test files (`vitest run <file>`); large multi-suite batches hit cross-file `React.act` failures.

## Tasks

### Task 1 — Red test: the router must reload on `chat.prDetected`

**Kind:** test. **Files:** `packages/ui/src/features/sessions/ws/__tests__/session-list-router.test.ts`
(modify).

Add a `describe` block, placed after the existing `permission.resolved` block and before the
`background_task` block, so the file's order keeps mirroring `SessionListRouter.route`. Extend the file's
header docblock behavior list with the new line.

The test dispatches a `chat.prDetected` event through the existing `makeFakeWs` harness and asserts:

- `onReload` was called exactly once.
- `onMarkUnread` was **not** called. The event only reaches clients subscribed to that chat — i.e. the
  session on screen — and marking the visible session unread would leave a stale dot (see the active-thread
  guard at `use-session-list-router.ts:137-143`).

Use a literal `DetectedPr` payload matching `packages/types/src/events.ts:91`:
`{ type: 'chat.prDetected', chatId: 'c7', pr: { url: 'https://github.com/o/r/pull/7', owner: 'o', repo: 'r', number: 7, source: 'created' } }`.
Import `DetectedPr` as a type alongside the existing `BackgroundTask, Chat, DaemonEvent` import so the
fixture is type-checked rather than cast.

Add a second case in the same block for `source: 'mentioned'` asserting the same outcome, so a future
attempt to branch on `source` inside the router breaks a test.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/session-list-router.test.ts`
— the two new cases FAIL (`onReload` received 0 calls, expected 1); every pre-existing case in the file still
passes. Record the failure output; do not proceed to Task 2 before observing it.

### Task 2 — Route `chat.prDetected` to the debounced list reload

**Kind:** ui. **Files:** `packages/ui/src/features/sessions/ws/session-list-router.ts` (modify);
`.changeset/live-thread-pr-detection.md` (new).

In `SessionListRouter.route`, add `chat.prDetected` to the reload group. Put it next to `chat.created` /
`chat.ended` as its own case with its own `return`, not appended to that fallthrough, so the header docblock
can explain why it reloads:

```ts
case 'chat.prDetected':
  this.deps.onReload();
  return;
```

Update the file's header docblock: add a line stating that `chat.prDetected` reloads because the Summary PR
row, the session-row PR glyph and the "has PR" filter all read `custom.detectedPrs` off the list projection,
and that the event is subscriber-gated — it arrives only for the chat the user has open, so sessions in the
background keep relying on the daemon's load-path rescan.

Do **not** touch `packages/ui/src/features/chat/controller/handle-daemon-event.ts`. Its `default` arm is a
silent `noop` (`handle-daemon-event.ts:155`), the per-chat controller renders no PR surface, and adding a
case there would be dead code.

Do **not** add `chat.prDetected` to `CONNECTION_GLOBAL_EVENT_TYPES` in the daemon, add a `chat.updated`
broadcast beside it, or touch any Rust file. The daemon side is correct as-is.

Write the changeset by hand or via `pnpm changeset`: package `@qlan-ro/mainframe-ui`, bump `patch`, summary
one sentence — a pull request created during a live turn now appears in the open session without a reopen.

**Verification:**
1. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/session-list-router.test.ts`
   — all cases green, including Task 1's two.
2. `pnpm --filter @qlan-ro/mainframe-ui typecheck` — clean.
3. `git status --short .changeset/` shows the new changeset file.

### Task 3 — Pin the coalescing on the list-refresh path

**Kind:** test. **Files:** `packages/ui/src/features/sessions/ws/__tests__/use-session-list-router.test.tsx`
(modify).

Acceptance criterion 4 requires that a burst of events not produce one refetch per event. The debounce lives
in `use-session-list-router.ts:117-136` and has no test, so nothing today would catch its removal. This test
pins pre-existing behavior: it passes both before and after Task 2, and is deliberately not a red-phase test.

Add a `describe` block using `vi.useFakeTimers()` (restore with `vi.useRealTimers()` in an `afterEach`, and
keep the fake timers scoped to this block so the file's other tests are unaffected). The file already mocks
`createSessionListRouter` and captures the hook's real deps into `capturedDeps`, so `capturedDeps.onReload`
*is* the live `scheduleReload` closure — no new mocking is needed.

Render the hook, then inside `act`:

- Call `capturedDeps.onReload()` three times in a row. Assert `reloadSpy` was called exactly once — the
  leading edge fired, the other two were swallowed by the cooling window.
- Advance timers by 200 ms. Assert `reloadSpy` has now been called exactly twice — the trailing window
  collapsed the burst into one further reload, not one per event.
- Advance another 200 ms with no further events. Assert `reloadSpy` is still at two — the timer does not
  re-arm itself indefinitely.

Extend the file's header docblock behavior list with a line for the coalescing.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/use-session-list-router.test.tsx`
— all cases green, including every pre-existing one (fake timers must not leak into them).

### Task 4 — Final verification

**Kind:** test. **Files:** none (verification only).

1. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/session-list-router.test.ts`
2. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/use-session-list-router.test.tsx`
3. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/session-list-router-lifetime.test.tsx`
   — the router's lifetime contract is adjacent to the change; confirm it did not regress.
4. `pnpm --filter @qlan-ro/mainframe-ui typecheck`
5. `git diff --stat` — the change touches exactly three files plus one changeset. Anything else is scope
   creep; revert it.

Run the three vitest files separately, not as one batch — batched runs hit the cross-file `React.act`
failure documented in the root CLAUDE.md.

## Out of scope

Restated from the brief so no implementer widens the diff:

- **Codex sessions never detect PRs at all.** The Codex adapter has no PR-scanning path. Real gap, separate
  todo, cross-reference it — do not fold it in here.
- Any branch → PR association: lookup by branch, GitHub API polling, PR review or CI state. None exists.
- New places to display a PR. The chat header shows none by design, pinned by
  `ChatCardHeader.test.tsx:155`.
- The Tasks board's GitHub issue import and its token handling.
- The detection heuristics themselves — which commands and tools are scanned, and how `created` versus
  `mentioned` is decided.
