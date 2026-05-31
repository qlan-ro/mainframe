# E2E Coverage Gap Report

_Generated 2026-05-30. Method: diff `data-testid` defined in `packages/desktop/src` against
test-ids referenced via `.locator('[data-testid=...]')` in `packages/e2e/{tests,fixtures,helpers}`._

> **Caveat:** this is a literal-string diff. Test-ids that are templated/dynamic
> (e.g. `chat-list-item` keyed by domain id, `dir-entry-${path}`) are undercounted on both
> sides. Specs that locate by role/text rather than test-id also read as `live:0` here even
> when they assert real behavior. Treat the ranking as directional and the exact counts as a floor.

## Summary

| State | Count | Meaning |
|---|---|---|
| Test-ids defined in source | 272 | raw count |
| — test-only fixture IDs | −10 | not product UI (see below) — remove from denominator |
| **Real interactive surface** | **~262** | actual product test-ids |
| Live & exercised by e2e | ~33 | working coverage (~13%) |
| **Dead testid selectors in specs** | ~19 | specs target renamed/removed UI |
| **Dead role/text selectors** | + more | non-testid stale locators (see "Beyond testids" below) |
| **Never covered** | ~229 | flows that never had a test |

Stack itself is current (`@playwright/test ^1.60.0`). The problem is **coverage drift**, not framework age.

### Test-only fixture IDs (exclude from the surface count)

These match the test-id grep but only exist inside component unit tests, never the running app —
do **not** write e2e against them: `btn`, `row`, `sub`, `tl`, `outside`, `slot-action`,
`thrower-output`, `my-label`, `my-row`, `plugin-view`. (`thumb-name` IS real product UI.)

### Beyond testids — dead role/text selectors & dormant code (from the full surface sweep)

The existing specs also use non-testid locators that are now broken, plus reference unwired code:
- `[data-testid="right-panel"]` — no such element; the panel root has no testid.
- Zone tabs queried as `getByRole('tab', …)` — they are `<button>`s with `data-testid="zone-tab-{id}"`;
  mode switching goes through `zone-button-tab-dropdown` → `zone-tab-dropdown-option-{mode}`.
- `[data-testid="line-comment-popover"]` (14-editor) — `LineCommentPopover` is **dormant/unwired**;
  the live path is `line-comment-widget` + `editor-inline-comment-input` via the glyph margin.
- `settings-modal` root testid is **missing** from the DOM (only `settings-modal-close` exists),
  yet `TutorialOverlay` queries it — a latent bug worth fixing alongside test work.

## Dead selectors — CORRECTED after source + live-DOM verification (2026-05-30)

> The original list below was derived from a **literal-string grep** of source, which produced
> **false positives for dynamically-templated test-ids**. Verified against current source and the
> running app, the real picture is:

**Genuinely dead (confirmed absent in source + DOM):**
`right-panel`, `project-dropdown`, `project-selector`, `chat-status-idle`, `chat-status-working`,
`line-comment-popover`, `todos-panel-icon`, plus the role/text mode selectors in 12-changes-tab.

**NOT dead — false positives (templated test-ids; render fine at runtime):**
`todo-column-{open,in_progress,done}` (`todo-column-${status}`), `picker-item-command-{clear,compact}`
(`picker-item-${type}-${name}`), `launch-config-{Web,Worker}` (`launch-config-${name}`),
`task-progress-item-completed` (`task-progress-item-${status}`), `user-command-bubble` (static, present).
(27-custom-commands & 33-task-progress are `test.describe.skip` regardless.)

**Keystone breakages (shared fixtures — break ~every spec, higher impact than any single spec):**
- `fixtures/project.ts` `openPickerAndSelectPath` drove the removed `project-selector`/`project-dropdown`
  flow → **fixed** to `chats-add-project` + project-group post-condition. ✓ verified (no-AI probe)
- `helpers/wait.ts` `waitForAIIdle` waited on dead `chat-status-working` (so it never actually waited)
  → **fixed** to `session-bar-status` "Thinking" detection. ✓ selector verified; behavioral (timing)
  confirmation needs an AI run.

## Per-spec health

| Spec | live | dead | note |
|---|---|---|---|
| 01-launch | 1 | 0 | |
| 02-projects | 0 | 2 | project picker re-tagged |
| 04-chat-lifecycle | 1 | 0 | |
| 05-messaging | 2 | 0 | |
| 06-permissions | 2 | 1 | |
| 07-plan-approval | 2 | 0 | |
| 08-ask-user-question | 1 | 0 | |
| 10-context-tab | 0 | 1 | |
| 12-changes-tab | 0 | 1 | |
| 14-editor | 0 | 2 | review/comment flow re-tagged |
| 15-search | 0 | 0 | likely role/text locators |
| 19-todos | 3 | 4 | board → modal/quick restructure |
| 21-multi-chat | 1 | 0 | |
| 22-app-restart | 2 | 0 | |
| 25-image-lightbox | 5 | 0 | healthiest |
| 26-tutorial | 4 | 2 | |
| 27-custom-commands | 3 | 3 | command picker re-tagged |
| 28-sandbox-launch | 6 | 3 | |
| 30-composer-attachments | 2 | 0 | |
| 31-composer-context-picker | 1 | 0 | |
| 32-chat-status-context | 3 | 0 | |
| 33-task-progress | 1 | 1 | |
| 35-external-sessions | 4 | 0 | |
| 36-codex-plan-approval | 2 | 0 | |

## Untested surfaces, ranked by size (candidate flows to author)

| Surface | Untested | Has spec? | Priority rationale |
|---|---|---|---|
| todos | 29 | 19-todos (stale) | core panel, board restructured — rewrite |
| chat | 25 | partial | permission/plan/question buttons — critical paths |
| composer | 22 | partial | send/stop/queued/worktree/model — primary input |
| sandbox | 16 | 28 (partial) | capture/inspect/screenshot lifecycle |
| session | 9 | partial | session bar, tags, row actions |
| branch | 9 | none | branch popover: fetch/push/new/update |
| editor | 7 | 14 (stale) | inline/line review comments |
| thread | 7 | none | find-in-thread, quote, tool-result collapse |
| new (branch) | 6 | none | new-branch dialog |
| find | 5 | none | find-in-path modal |
| named (tunnel) | 5 | none | tunnel config |
| tags | 5 | none | tag create/rename/recolor/delete |
| message | 4 | none | copy, thinking-toggle, read-more |
| rename (branch) | 4 | none | rename-branch dialog |
| capture | 4 | none | capture rows/thumbs |
| fileview | 4 | none | next/prev change, reveal-in-tree |

Smaller surfaces (1–3 untested) cover: settings modal, search palette, terminal, status-bar
updates, conflict view, directory picker, pairing, review modal, fullview, zone controls, tool
card expanders, project groups, etc.

## Recommended sequencing

1. **Repair the 19 dead selectors** — re-point or delete stale specs so the suite is green/honest first.
2. **Author new flows** in size+criticality order: todos → chat (permission/plan/question) →
   composer → sandbox → branch/editor → the long tail.
3. Feed each surface's flow (edges derived from handlers/state, anchored on these test-ids) to the
   `test-scenarios` skill; review the result with `e2e-reviewer`.
