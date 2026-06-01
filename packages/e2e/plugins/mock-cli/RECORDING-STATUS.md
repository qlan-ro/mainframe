# Mock-CLI recording status & findings

_Branch `feat/e2e-record-all` (stacks on the mock-cli mechanism PR #363). This is the result of the
"record fixtures for all AI specs so the suite runs under `E2E_MODE=mock`" effort._

## TL;DR

The goal as literally stated — **"run *all* tests using mock-cli"** — is **not achievable**, for one
architectural reason and one operational reason (both documented below). What *is* delivered: the
mock-cli mechanism plus **6 UI-flow AI specs that record & replay green** with zero API calls. Roughly
half the AI specs fundamentally cannot be mocked.

## ✅ Recorded & replaying in mock (UI/conversation-flow specs)

Each verified solo with `E2E_MODE=record` → `E2E_MODE=mock` → green:

| Spec | recordingKey | What it covers |
|------|--------------|----------------|
| `06-permissions` (Interactive) | `permissions-interactive` | permission card → deny/allow-once |
| `05-messaging` | `messaging` | send message, response, token footer, tool-call card |
| `25-image-lightbox` | `image-lightbox` | image/attachment thumbnail in composer |
| `30-composer-attachments` | `composer-attachments` | attaching an image → thumbnail |
| `31-composer-context-picker` | `context-picker` | `/` opens the command picker |
| `47-thread` | `thread` | long-message read-more, tool-result cards |

## ❌ Cannot be mocked — architectural limit (the key finding)

**Mock-cli replays the agent's recorded *messages/UI events*, not its real *tool side-effects*.** The
`ReplaySession` emits the recorded `onMessage`/`onToolResult`/… sink calls, but no file is actually
written, no git state changes, no process runs. So any spec that asserts on a **real-world outcome**
fails in mock even though the conversation replays correctly:

| Spec | Why it can't be mocked |
|------|------------------------|
| `10-context-tab` | asserts the **Changes tab** shows AI-edited files — needs real file edits on disk |
| `12-changes-tab` | asserts real git working-tree changes from AI edits |
| `07-plan-approval` | plan execution makes real edits; also multi-session |
| `32-chat-status-context` | asserts the adapter label is **"Claude Code"** — in mock it's "Mock CLI" (inherent) |

These must keep running against the real CLI (or be split so only their UI-flow assertions run in mock).

## ⏭️ Not attempted (complex / likely unmockable)

- `08-ask-user-question` — depends on the model *choosing* to ask (nondeterministic to record).
- `21-multi-chat` — two sessions on one project (per-key index `.0`/`.1`; replay order fragile).
- `22-app-restart` — restarts the daemon mid-test; replay across a resume is unsupported.
- `27-custom-commands` — 4 separate `launchApp()` per file (4 sessions to key).
- `33-task-progress` — subagents (Task tool); Haiku rarely spawns them.
- `36-codex-plan-approval` — uses the **codex** adapter; the record-wrapper only wraps `claude`.

## ⚠️ Operational: suite-run flakiness

Specs pass **solo** but a multi-spec `E2E_MODE=mock` run flakes badly **in this environment**:
`electron.launch: Process failed to launch` and `connection-status` timeouts. Two contributing causes:

1. **Fixed 9222 DevTools port** — the app binds `--remote-debugging-port=9222` in dev mode; rapid
   back-to-back Electron launches collide on it. **Fixed here**: the app now skips 9222 when
   `MF_E2E=1` (set by the harness). Plus `launchApp` already reaps stray `mf-e2e-data-` Electrons.
2. **CPU contention** — this run shared the working machine with another active agent; under load,
   Electron startup exceeds the 15 s connect timeout. This is environmental and would not affect a
   dedicated CI runner, but it means I could not get a clean full-suite pass here.

Recommendation: run mock specs with `retries` (already 1) and, ideally, on a quiet/dedicated machine
or CI runner. The 9222 fix should make suite runs reliable absent CPU starvation.

## CI integration — deferred (intentionally, per the ask)

A draft workflow is at [`ci-e2e-mock.draft.yml`](./ci-e2e-mock.draft.yml). **Not enabled yet** because:

1. Only ~6 specs are mockable; a full `E2E_MODE=mock` suite would fail on the un-recorded/unmockable
   specs. A real CI job needs either the full mockable set enrolled **or** explicit scoping to the
   recorded specs (e.g. a Playwright project/grep over the `recordingKey`-enrolled specs).
2. Headless Electron on Linux CI (xvfb + `playwright install --with-deps`) is unvalidated from here.
3. The suite isn't reliably green locally yet (see flakiness above), so wiring CI now would just
   produce red PRs.

Mock mode is nonetheless the **right** CI approach: it needs **no Claude API key**, so it's safe to run
on every PR once the above are resolved. Suggested first step: a CI job scoped to the recorded specs
(the 6 above) under xvfb, expand as more UI-flow specs are recorded.

## Runbook — recording another UI-flow spec

1. Enroll: in the describe's `beforeAll`, `launchApp({ recordingKey: '<stable-key>' })`.
2. `rm -f /tmp/<any fixed files the scenario writes>`; build once: `pnpm --filter @qlan-ro/mainframe-e2e build:app && build:mock`.
3. Record: `MF_E2E_DAEMON_PORT=<port> E2E_MODE=record playwright test <spec>` (real Claude).
4. Verify: `MF_E2E_DAEMON_PORT=<port> E2E_MODE=mock playwright test <spec>` → green.
5. If it asserts real side-effects (files/git/adapter name), it is **not** mockable — leave it on real CLI.
6. Commit the `<key>.0.ndjson` fixture + the enrollment.
