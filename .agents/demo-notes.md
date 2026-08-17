# Demo notes — mainframe

Read by the `feature-recorder` skill before it derives a scenario. The run book
(how to actually record) is `demos/README.md`; this is what's worth filming and
what to know before you point a camera at it.

## The environment

`.agents/demo-env.sh up` boots an isolated stack — daemon on **:31417**, vite on
**:5183**, data in `/tmp/mainframe-demo` — so it can never touch the dev daemon
on :31415, the e2e harness on :31416, or `~/.mainframe`. It seeds:

- **`acme-web`**, a small storefront repo with an uncommitted `src/cart.ts`
  change, so the diff and review surfaces have real content (`1 file · +8 −2`).
- **five todos** across Open / In Progress / Done, so the Kanban board isn't empty.
- **two automations** (a weekday schedule and a `session.finished` event trigger).

Every `up` rebuilds all of it from scratch, so take 2 sees what take 1 saw.

## Deterministic agent

The daemon runs with `E2E_MODE=mock`, replaying NDJSON from
`packages/e2e/fixtures/recordings/`. No API spend, no non-determinism, identical
every take. `MF_DEMO_RECORDING_KEY` picks the conversation:

| Key | What it shows |
|---|---|
| `tool-group` | "I'll search for that" → grouped Read + Grep → an answer. The general-purpose beat. |
| `ask-question` | an `AskUserQuestion` gate, answered inline, then a follow-up. |
| `workflow` | **a four-phase `release-readiness` run**: Scan done, Review mid-flight over two files, Verify queued, Report up next — six agents, 41.2k tokens. Leaves the run **running**, which is what fills the Activity panel and makes its row drill into the run panel. |
| `task-subagent`, `todo-write`, `plan-approval`, `permissions-*`, … | the rest of the e2e corpus — see the directory. |

The `workflow` fixture is demo-authored (the others are e2e recordings). It works
because the mock adapter reports background work to the daemon's tracker —
subagent, background bash and workflow rows — and a fixture can ship a whole
`ClaudeWorkflowRun` snapshot through the `onWorkflowRun` recorded method. See
`packages/core-rs/crates/mainframe-adapter-mock/src/task_bridge.rs`.

**A recording that never resolves its tool calls keeps the session running.** The
composer shows the stop button and the elapsed timer ticks. That's honest for a
"work in flight" beat; it's wrong for a beat that should look finished.

## Surfaces worth filming

Sessions sidebar and project filter · the composer's model/permission/plan/worktree
controls · grouped tool cards · the question gate · transcript select-to-quote ·
the session rail (Session summary, Activity, Tasks quick-add) · the workflow run
panel · session tabs · Kanban board · Automations · the daemon picker and remote
pairing · Review Changes with a line-anchored comment.

## Not filmable here

- **Terminal and sandbox preview** — `lib/host/fake-adapter.ts` rejects
  `terminal.create` and `preview.capture` without `__TAURI_INTERNALS__`.
- **Native window chrome** — this is browser mode; no traffic lights, no title bar.
- **Split chat** — `session-tab-ctx-open-split` is disabled unless two *committed*
  sessions exist, and one boot can only replay one conversation. Seed a second
  chat via `POST /api/chats` to unblock it.

## Gotchas that have cost takes

- The transcript is a fixed-width centred column; below ~1920 wide the floating
  session panels overlap it. Record at **1920×1080**.
- Only the **modified** pane anchors a review comment — a click in `.cm-merge-a`
  is silently ignored — and CodeMirror splits a line across token spans, so
  target `.cm-merge-b .cm-line` rather than `getByText`.
- The Review Changes modal covers the sidebar: film sidebar surfaces **before** it.
- The Kanban view mode lives in a store, not storage — open it off camera, switch
  to Board, close, and the on-camera open lands on the board with no extra click.
- The Session-panel summary button is `session-panel-rail-open`;
  `session-panel-rail-context` only mounts once there's context-meter data.
- `locator.selectText()` does not arm the quote toolbar — it needs a real
  `mouse.down` → `move` → `up` drag, because the toolbar arms on mouseup.
