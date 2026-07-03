# Trust-workspace permission toast

**Date:** 2026-07-03
**Branch:** `feat/trust-permission-toast` (off `feat/app-tauri-wt`)
**Packages:** `@qlan-ro/mainframe-core`, `@qlan-ro/mainframe-types`, `@qlan-ro/mainframe-ui`

## Problem

When Claude runs in a project whose `.claude/settings.local.json` has `permissions.allow`
entries but the workspace is **not trusted**, the CLI prints a **non-fatal** advisory to
stderr:

```
Ignoring N permissions.allow entries from .claude/settings.local.json:
this workspace has not been trusted. Run Claude Code interactively here once and
accept the trust dialog, or set projects["<path>"].hasTrustDialogAccepted: true.
```

The CLI **keeps running** — the agent is fully usable. But the daemon misclassifies this
warning as a fatal error and surfaces a red **"Agent run failed"** toast on every CLI
spawn (each thread open / run).

### Confirmed root cause

`packages/core/src/plugins/builtin/claude/events.ts` → `handleStderr` (lines 36–41):

```ts
export function handleStderr(_session, chunk, sink) {
  const message = chunk.toString().trim();
  if (!message) return;
  if (INFORMATIONAL_PATTERNS.some((p) => p.test(message))) return;
  sink.onError(new Error(message));   // ← everything unmatched becomes a fatal error
}
```

The advisory begins with `Ignoring`, not `Warning:`, so it slips past
`INFORMATIONAL_PATTERNS` and is funneled into `sink.onError` →
`{ type: 'error', chatId, error }` (`event-handler.ts:548`) → the UI's
`mfToast.error('Agent run failed', …)` (`chat-event-router.ts:53-56`).

Evidence this is classification, not replay:
- The error is **never persisted** (not a message, not in the transcript). The client
  raises the toast only on a **live** `error` event — no client-side error cache.
- The thread is **usable** — proving the CLI did not die; the stderr line is advisory.
- Withdrawn hypotheses: transcript re-parse (nothing is stored) and a stuck
  `processState='working'` respawn loop (the usable-thread evidence killed it —
  `onExit` resets state and the CLI runs fine).

## Goals

1. Stop showing the advisory as a fatal **"Agent run failed"** error.
2. Surface it as a new, non-error **permission** toast that explains the situation and
   offers a one-click **Trust** action which writes `hasTrustDialogAccepted` for the
   project, after which the CLI stops emitting the advisory entirely.
3. Replace the toast's fixed scrollable description box with the message bubble's
   **Read more** expand pattern, extracted into a shared primitive.

## Non-goals

- The root-user `--dangerously-skip-permissions` / `IS_SANDBOX` guard (different failure
  class; the `permission` toast could host it later, not now).
- Auto-retrying the failed run (decision: **trust-only**; the user re-sends).
- Trusting parent directories (trust the exact workspace path only).
- Mobile submodule and legacy `packages/desktop` / `app-electron`.
- Broadening `handleStderr` severity handling beyond the trust advisory (kept targeted to
  avoid swallowing real errors).

## Design

Four parts. The first does double duty: it removes the false error **and** produces the
signal that drives the new toast.

### A. Daemon — classify the advisory as a structured, non-fatal signal

**Decision (refined during self-review): a dedicated event, not `error` + `kind`.** An
`error`-typed event — even carrying a `kind` — still flips the run to `runState:'error'`
through the UI mapper (`handle-daemon-event`), which is wrong: the run did not fail. So the
advisory gets its own event type, keeping run state untouched. This still satisfies the
approved decision (daemon-side structured classification with a resolved `projectPath`; the
UI switches on type, never string-matches).

- **`packages/types/src/events.ts`** — add a new, additive event (the WS/REST contract is
  co-owned by mobile; unknown types/fields are ignored):
  ```ts
  | { type: 'chat.trustRequired'; chatId: string; projectPath: string }
  ```
- **`packages/core/src/plugins/builtin/claude/events.ts`** — in `handleStderr`, detect the
  advisory via a stable marker (`/has not been trusted/i` **and**
  `/permissions\.allow|hasTrustDialogAccepted/i`). On match, **do not** call `sink.onError`
  (which implies a fatal run failure). Instead call a new sink method
  (`onTrustRequired(projectPath)`) that emits `chat.trustRequired`. The session already
  knows its `projectPath` (`ClaudeSession` / `session.ts`), so the daemon attaches the
  authoritative workspace path — the UI never string-matches and never supplies a path.
  - `SessionSink` (`packages/types`) gains `onTrustRequired(projectPath: string): void`;
    the no-op default sink and `event-handler.ts`'s sink both implement it (the latter
    emits the event). No `runState` change is triggered.
- Net effect: the advisory no longer flips the run to error, and no red toast fires.

### B. Daemon — trust endpoint + `~/.claude.json` writer

- **Route:** `POST /api/chats/:chatId/trust-workspace`, keyed by **chatId** so the daemon
  re-derives the authoritative workspace path server-side (never trust a client-supplied
  filesystem path for a trust write). Registered alongside the existing chat routes; Zod
  on input; WS4 envelope via `respond.ts` (`ok`/`fail`).
- **Helper module** (new, `< 300` lines, e.g. `claude/trust-store.ts`): read `~/.claude.json`
  (async `fs/promises`), merge `projects["<path>"].hasTrustDialogAccepted = true`
  preserving all other keys, **atomic write** (tmp + `rename`). Handle a missing file
  (create minimal). Validate the derived path with `resolveAndValidatePath`. Log failures
  with the pino child logger (no silent catch).
- **Response:** success/`ok` → the UI dismisses the toast. Trust-only; no run re-dispatch.
  The user re-sends; the next spawn is trusted and silent.

### C. UI — new `permission` toast variant + Trust wiring

- **`packages/ui/src/components/ui/ws-toast.tsx`**
  - Add `'permission'` to `ToastType`.
  - `CHIP_CONFIG` gains a `permission` entry (distinct non-red accent — amber/primary),
    and `ChipIcon` renders a **shield** glyph for it.
  - **Persist, don't auto-dismiss:** change `isAuto` from `type !== 'error'` to exclude
    `permission` too (so the Trust button doesn't vanish + no countdown rail).
- **`packages/ui/src/lib/toast.ts`**
  - `duration` must be `Infinity` for `permission` as well as `error`.
  - Add a `permission(title, opts)` helper alongside `success/error/warning/info`.
- **`packages/ui/src/features/chat/controller/chat-event-router.ts`**
  - Add a `chat.trustRequired` branch (a pure side-effect, like the existing
    `message.queued.cancel_failed` branch — it must **not** flow into `handleDaemonEvent`'s
    runState mapping): raise `mfToast.permission('Workspace not trusted', { description,
    action: { label: 'Trust', onClick } })`. The `error` branch is untouched and keeps the
    red path for genuine failures.
  - `onClick` calls the trust endpoint for `chatId` (via the existing daemon client), then
    the shared card dismisses (the `action` slot already dismisses on click).
  - The description text is composed UI-side (the event carries `projectPath`, not the raw
    advisory) — e.g. the trust guidance for `projectPath`.
- **Testid:** the Trust button reuses the card's existing `data-testid="toast-action"`
  (passthrough primitive — no hardcoded feature id inside `ui/`).

### D. UI — extract a shared `ReadMore` primitive

- **New `packages/ui/src/components/ui/read-more.tsx`** — presentational, style-parameterized:
  props for content, a measured text length (or threshold-met flag), `clampLines`, fade
  color/var, and `testId` (passthrough). Holds the `expanded` state and the toggle button
  (`Read more` / `Show less` + chevrons). Keeps char-threshold clamping (no layout engine
  in jsdom).
- **`ReadMoreBubble.tsx`** becomes a thin wrapper: computes `extractText(children).length`,
  passes bubble styling (`line-clamp-4`, `--mf-um-fade`) + `testId="chat-user-readmore-toggle"`.
  `UserMessage` output stays pixel-identical.
- **`ws-toast.tsx`** description block: replace `max-h-[88px] overflow-auto` with
  `<ReadMore>` (toast clamp + its own testid). Description is already a plain string, so the
  toast passes it directly (no `extractText`); the primitive stays free of any
  `features/` import (layering).

## Data / contract summary

| Surface | Change | Compatibility |
|---|---|---|
| `chat.trustRequired` event | new event `{ chatId, projectPath }` | additive; mobile ignores unknown types |
| `SessionSink` | +`onTrustRequired(projectPath)` | internal (types + core) |
| `POST /api/chats/:chatId/trust-workspace` | new route, Zod + `ok`/`fail` | new; no existing consumer |
| `~/.claude.json` | merge one key, atomic write | preserves all other keys |

## Testing (authored via the `test-writer` agent)

- **core**
  - `handleStderr`: trust advisory → `sink.onTrustRequired(projectPath)`, **not**
    `sink.onError` (assert `onError` not called); unrelated stderr still → `onError`.
  - `event-handler` sink: `onTrustRequired` emits `chat.trustRequired` and does **not**
    change `processState`/run state.
  - trust endpoint: writes/merges `~/.claude.json`, path-validated, idempotent, missing-file
    case, rejects bad chatId.
- **ui**
  - `chat-event-router`: `chat.trustRequired` → `mfToast.permission` and no runState flip;
    genuine `error` events still `mfToast.error`.
  - `ReadMore`: below/above threshold, expand/collapse toggle.
  - `ws-toast`: `permission` variant renders shield chip + persistent (no countdown rail) +
    Trust action; existing variants unchanged.

## Security

- Trust write keyed by chatId; path re-derived server-side + `resolveAndValidatePath`.
- Atomic write; no partial `~/.claude.json`. Structured logging on failure; no silent catch.
- No shell interpolation; async I/O only.

## Risks

- **Marker brittleness:** the advisory wording could change across CLI versions. Mitigated
  by matching two independent tokens (`not been trusted` + `permissions.allow`/
  `hasTrustDialogAccepted`) rather than the full sentence, and by the daemon (not the UI)
  owning the single match site.
- **`zustand` phantom dep** in `packages/ui` (known) — unrelated but present on this branch.

## Definition of done

Typecheck + targeted tests green · trust advisory no longer shows a red error · permission
toast renders with a working Trust button that silences the advisory after re-send · Read
more works in both the bubble (unchanged visuals) and the toast · files `< 300` lines,
functions `< 50` · testids preserved · changeset added.
