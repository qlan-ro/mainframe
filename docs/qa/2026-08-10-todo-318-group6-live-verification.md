# todo #318 — Group 6 live verification (tasks 11–14)

Raw evidence from running the committed packaged-QA recipe end to end, per
`docs/plans/2026-08-10-todo-318-packaged-tauri-qa-bridge-plan.md` Group 6.
Per that plan, this group does not edit the committed doc or scripts — it
records what actually happened and reports contradictions.

> **Superseded by the addendum at the end of this file (2026-08-11).** The
> blocking finding below was fixed on this branch and the recipe re-verified
> end to end with no workaround. The body is kept as the record of how the
> cause was found.

**Headline finding: the committed recipe does not achieve working
`webview_execute_js`/`webview_dom_snapshot`/`webview_screenshot` against the
packaged QA app.** Helper registration (the ref-based tool gate) fails
deterministically on every attempt, with a root cause different from — and
more specific than — the plan's own risk bullet. A documented, reproducible
privileged-eval workaround (not part of the committed scripts) unblocks the
rest of the stack, and was used to complete tasks 11–14 for evidentiary
purposes. **Acceptance criteria 3 ("yields a working `webview_execute_js`, a
working DOM snapshot, and a working screenshot"), 4 (relaunch gate via those
tools), and 12 (packaged CSP smoke via those tools) are not met by the
committed recipe as merged** — see "Blocking finding" below.

## Environment

- Build: `bash scripts/build-qa-tauri.sh` — succeeded, produced
  `packages/app-tauri/src-tauri/target/debug/bundle/macos/Mainframe.app`.
- Launch: `bash .agents/launch-test-tauri-qa.sh` (bare, no overrides) —
  printed `READY`, `DAEMON_PORT=33208`, `BRIDGE=127.0.0.1:9323`,
  `DATA_DIR=/Users/doruchiulan/.mainframe_qa`.
- MCP server: `npx -y @hypothesi/tauri-mcp-server@0.12.0`, spawned with
  `cwd` = this worktree (so the 0.12 cwd disambiguation applies).
- Client: `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport`,
  driving the server's stdio JSON-RPC directly (no MCP server config edit
  needed — this session has no `tauri-mcp` tools bound, so the client was
  spawned ad hoc per the plan's own driver_session contract).

## Task 11 — attach, and the helper-registration blocker

`driver_session start {host:"127.0.0.1", port:9323}` then
`ipc_get_backend_state` succeeded immediately and matched both required
facts:

```json
{"app":{"identifier":"ro.qlan.mainframe","name":"Mainframe","version":"2.0.0"},
 "cwd":"/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-318-packaged-tauri-qa-bridge", ...}
```

`webview_execute_js {script:"document.title"}` — issued five times over 10s,
every attempt:

```
Error: JavaScript execution failed: WebView execution failed: Resolve-ref
helper was not available in the webview after registration.
```

Not a timing flake (five retries, 2s apart, all failed identically) and not
finding 3's targeted-stop cache poisoning (this was the session's first-ever
registration attempt against a freshly launched app — no prior stop had
happened). `webview_dom_snapshot` and `webview_screenshot` failed the same
way (screenshot fell back to the html2canvas path).

### Differential proof: CSP is the variable, not the crate/server pair

Built and launched the **dev** target (`bash .agents/launch-test-tauri.sh`,
`--features mcp-bridge`, Vite-served, no CSP) with the same crate (0.12.0)
and the same server (0.12.0). `driver_session start {port:9223}` →
`webview_execute_js {script:"document.title"}` returned `"Mainframe"` on the
**first** attempt, no registration failure. This isolates the failure to the
packaged build specifically — the crate/server pairing itself is fine.

### Root cause: 336 per-asset CSP hashes, not the inline-script risk the plan named

The plan's risk bullet predicted a **nonce** injected because of an inline
`<script>` in `index.html`, and ruled it out by static reading (`index.html`
has no inline script, and its one `<script src>` is relative, not
`http`-prefixed, so `tauri-2.11.2`'s nonce-injection condition
(`script[src^='http']`) doesn't fire). That static analysis is correct as
far as it goes — but it examined the wrong asset population.

Connected directly to the plugin's WebSocket (`ws://127.0.0.1:9323`,
bypassing the MCP server's `ensureReady`/registration gate entirely, using
the same privileged `execute_js` command the registration poll itself uses)
and read the **served** CSP response header from page context via a
synchronous XHR against `location.href`:

```
script-src 'self' 'unsafe-inline' 'sha256-PVzYk3gdUseJMLeBqSlfa4/UPQCSG+zaednL8e6+tEQ=' ... (336 hash-source entries total)
```

Full header: `docs/qa/assets/2026-08-10-todo-318-group6/qa-served-csp-header.txt`.

`find packages/ui/dist/assets -iname '*.js' | wc -l` → **336**. Tauri
computes a per-file SHA-256 hash for every bundled JS asset and injects all
of them into `script-src` (governed by the same
`dangerousDisableAssetCspModification` knob the plan's Task 1 guard asserts
is absent from both configs) — not because of any inline `<script>` tag.
Per the CSP spec, **the presence of any hash-source (or nonce-source)
expression in a directive's source list makes conforming browsers ignore
`'unsafe-inline'` in that same directive** (backward-compat rule for CSP1
browsers). WKWebView follows this: with 336 hashes present, `'unsafe-inline'`
is spec-ignored, so the bridge's dynamically-generated inline `<script>`
helper (its content differs per registration, so it can never match a
precomputed hash) is blocked exactly as if `'unsafe-inline'` weren't in the
overlay at all.

This is confirmed, not inferred: injected the plugin's own inline-script
shape (`document.createElement('script'); ...; textContent = 'window.__CSP_PROBE__=1'; appendChild`)
through the raw channel — the element landed in the DOM
(`document.querySelector('script[data-mcp-script-id=...]') !== null`) but
`window.__CSP_PROBE__` stayed `undefined`: the browser parsed and rejected
it, exactly as CSP-hash-collision blocking predicts.

**This is a materially different, more specific finding than the plan's own
risk bullet**, though the remedy the plan already named for that bullet
(`"dangerousDisableAssetCspModification": ["script-src"]` in
`tauri.qa.conf.json`) is still the correct fix — it stops Tauri from
injecting the 336 asset hashes, leaving `script-src 'self' 'unsafe-inline'`
with no hash/nonce sources to cancel it. That edit belongs to the group that
owns `tauri.qa.conf.json` (Group 3), not this one; Task 1's config-guard test
(Group 1) currently asserts that key is *absent* from `tauri.qa.conf.json`
and would need to flip to assert the narrower `["script-src"]` form.

### Unlock used for tasks 11–14 below (not part of the committed recipe)

`ensureReady`'s poll only checks whether `window.__MCP__.resolveRef` exists
— it doesn't care how. The **outer** privileged eval call itself (the same
API the plugin uses for both registration and every `execute_js` command) is
not subject to `script-src` at all — only DOM-parsed `<script>` elements are.
So evaluating the resolve-ref helper's source **directly** (no
`document.createElement('script')` in between) through the raw WebSocket
channel defines `window.__MCP__.resolveRef` without ever touching the
CSP-restricted path:

```js
// via raw ws://127.0.0.1:9323, command: execute_js
<contents of node_modules/@hypothesi/tauri-mcp-server/dist/driver/scripts/resolve-ref.js>
```

After this pre-seed, `driver_session start` (fresh MCP client) passes the
registration poll immediately and every ref-based tool works. Re-seeding is
required after every app relaunch (a fresh page load loses the global) and
after every `driver_session stop` with no `appIdentifier` reset (see Task
13).

## Task 11 — tool trio (post pre-seed)

- `webview_execute_js {script:"document.title"}` → `"Mainframe"`.
- `webview_dom_snapshot {type:"structure", selector:'[data-testid="daemon-footer-trigger"]'}`
  → returned the real ref tree (`daemon-footer-trigger-label`, connection
  dot, etc.) — see the snapshot text embedded in the task-13 log excerpt
  below for the shape.
- `webview_screenshot {format:"png"}` → native path (not the html2canvas
  fallback), 67489 bytes, saved at
  `docs/qa/assets/2026-08-10-todo-318-group6/task11-native-screenshot.png` —
  shows the isolated QA app (`127.0.0.1:33208`, empty `~/.mainframe_qa`,
  "No sessions yet").

## Task 12 — packaged-only CSP smoke

Script: `try { new Function('return 1')(); 'ALLOWED' } catch (e) { 'BLOCKED:' + e.name }`.

| Target | Result |
|---|---|
| Packaged QA (`127.0.0.1:9323`) | `BLOCKED:EvalError` |
| Dev, Vite-served (`127.0.0.1:9223`) | `ALLOWED` |

This result is trustworthy despite the registration workaround: unlike the
inline-`<script>`-element path (proven CSP-exempt above), `new Function(...)`
invoked *inside* an eval'd script is still gated by `'unsafe-eval'` at the
JS-engine level regardless of how the outer script was delivered — WebKit's
`script-src`/`unsafe-eval` check for dynamic-code-generation APIs
(`eval`/`Function`) is enforced within the page's JS realm itself, not at
the DOM-parser level the inline-element check lives at. The packaged CSP
carries no `'unsafe-eval'`; the dev path has no CSP at all. Confirms the
default/packaged CSP's eval restriction is genuinely enforced.

## Task 13 — relaunch gate (3 relaunches, one MCP-server session)

Three consecutive `bash .agents/launch-test-tauri-qa.sh` relaunches within
one server session, each followed by the documented reset
(`driver_session stop` with no `appIdentifier`), the pre-seed workaround,
`driver_session start {port:9323}`, identity re-verification, and
`webview_execute_js`. Full results:
`docs/qa/assets/2026-08-10-todo-318-group6/task13-relaunch-results.json`.

| Relaunch | Bound bridge port (log line) | Identity match | Tool call |
|---|---|---|---|
| initial launch | `127.0.0.1:9323` | — | — |
| 1 | `127.0.0.1:9323` | yes | `"Mainframe"` |
| 2 | `127.0.0.1:9323` | yes | `"Mainframe"` |
| 3 | `127.0.0.1:9323` | yes | `"Mainframe"` |

All four observed ports are `9323` — no port drift in this environment
across four consecutive launches. The launch script's pre-launch kill (find
the old PID, kill it, poll until `:9323` frees, only then check "already
listening") worked correctly every time; no relaunch ever refused against
its own predecessor. The documented stop-all reset was necessary each time —
skipping it (not tested destructively here, but consistent with finding 3)
would leave the previous instance's registration cache in place.

**With the committed recipe alone (no pre-seed), this gate does not pass**:
every relaunch's registration would fail exactly as in Task 11, for the same
CSP reason.

## Task 14 — proof-of-life: todo #305's carried-over 401 scenario

### Pre-check (matches todo #305's evidence exactly)

Ad hoc Node proxy, `127.0.0.1:31650` → `127.0.0.1:33208` (the QA daemon),
appending `X-Forwarded-For: 203.0.113.7` to HTTP requests and the WS
upgrade (not committed — throwaway rig, per the plan).

```
GET /api/chats direct to :33208, no token   -> 200
GET /api/chats via the XFF proxy, no token  -> 401
```

This reproduces `packages/core-rs/crates/mainframe-server/src/net.rs`'s
`trust_proxy_client_ip`: the raw peer (the proxy, loopback) is trusted, so
the forwarded non-loopback hop (`203.0.113.7`) is honored and the auth
middleware's loopback bypass no longer applies.

### Live pairing through the proxy (packaged app)

Drove the real dialog in the packaged webview:
`daemon-footer-trigger` → `daemon-picker-add` → typed
`http://127.0.0.1:31650` into `daemon-add-url` → `daemon-add-verify` →
`daemon-add-continue` → fetched a fresh pairing code directly from the
daemon (`POST /api/auth/pair`, loopback, exempt) → typed the code into
`daemon-pair-code` → `daemon-add-confirm`.

Pairing succeeded: `GET /api/auth/devices` on the daemon showed the new
device (`"deviceName":"This Mac"`); the app's daemon-switcher footer
switched to the remote (`127`, host `127.0.0.1:31650`), green/connected.
Screenshots:
`docs/qa/assets/2026-08-10-todo-318-group6/task14-add-remote-dialog.png`,
`docs/qa/assets/2026-08-10-todo-318-group6/task14-paired-via-proxy.png`.

**Tooling note (separate from the CSP finding):** `webview_interact`'s
`click` action dispatches plain `MouseEvent`s (`mousedown`/`mouseup`/`click`)
only. Radix UI's `DropdownMenuTrigger`/`DropdownMenuItem` (used by the
daemon picker) open/select on `onPointerDown`, which requires a real
`PointerEvent`. Plain `webview_interact` clicks silently no-op on these
(`data-state` stays `"closed"`, no error surfaced). Worked around by
dispatching `pointerdown`→`mousedown`→(50ms)→`pointerup`→`mouseup`→`click`
manually via `webview_execute_js`. Filed as an upstream observation below.

### Revoke and observe

First revoke attempt used the wrong field name (the devices list returns
`deviceId`, not `id`) and silently no-op'd — `DELETE
/api/auth/devices/undefined` returned `200` without removing anything. Caught
by re-querying `/api/auth/devices` afterward and seeing the same device
still present with its original `createdAt`. Re-ran with the correct field;
confirmed via `GET /api/auth/devices` → `{"data":[]}` and
`GET /api/projects` via the proxy → `401` (previously `200`).

The already-open app's in-memory state didn't refetch on its own within the
observation window (an in-place daemon switch or window-focus refetch may
not exist, or the interval is long); a full relaunch of the packaged app
(same active remote target, same `~/.mainframe_qa` data dir, revoked device
already persisted to SQLite) forced a fresh authenticated fetch on boot,
which 401'd immediately:

`docs/qa/assets/2026-08-10-todo-318-group6/task14-needs-repair-footer.png`
— the daemon-switcher footer now renders a red lock icon
(`svg.lucide.lucide-lock.text-destructive`) next to "127", matching
`DAEMON_STATUS['needs-repair']` (`packages/ui/src/features/daemon/daemon-status.tsx`:
label "Re-pair needed"). The Claude/Codex usage widgets in the same footer
also flipped to `?`/dashed — their own usage fetches against the same
revoked-device remote 401'd too.

**Not captured**: the composer-restore + `describeSendError` sentence
("Not authorized on this daemon. Re-pair it from the daemon menu, then send
again. Your attachments are back in the composer.") specifically, because
that copy fires on a **chat send** failure
(`packages/ui/src/features/chat/controller/describe-send-error.ts`), and
this QA daemon's data dir has zero projects (creating one needs the native
macOS folder picker, which is outside the DOM and outside what these
webview tools can drive). The **general** auth-failure mechanism the send
path also uses (`markAuthFailure` in `packages/ui/src/lib/api/http.ts`,
firing on any 401 from any REST call) is confirmed live end-to-end by the
needs-repair footer above — the send-specific composer/error-copy text is
the one piece of the acceptance criterion not directly observed in this
session.

## Blocking finding for todo #318's acceptance criteria

- **AC "yields a working `webview_execute_js`, a working DOM snapshot, and a
  working screenshot against the packaged app"**: not met by the committed
  recipe. Every ref-based tool fails registration on every attempt against
  every packaged QA launch, for the reason above (336 CSP asset hashes
  cancel `'unsafe-inline'`). Met only via an undocumented, uncommitted
  privileged-eval pre-seed used solely to produce this report's evidence.
- **AC "Relaunch gate... the bridge drives the newly launched instance every
  time, with no helper-registration timeout"**: not met by the committed
  recipe for the same reason — the timeout in the AC's own wording is
  exactly what happens on the very first launch, before any relaunch.
- **AC "Packaged smoke... a CSP-enforcement observation"**: satisfiable
  (Task 12's result stands on its own), but only reachable through a
  session that already needed the pre-seed workaround to get past
  registration.
- **Recommended remedy** (does not require reversing finding 2's own static
  analysis, which was correct about the inline-script/nonce path — it
  addresses the separate per-asset-hash path this report found): add
  `"dangerousDisableAssetCspModification": ["script-src"]` to
  `tauri.qa.conf.json`, and flip Task 1's config-guard assertion from
  "absent" to "present, and scoped to exactly `[\"script-src\"]`". This is a
  Group 3/Group 1 change, not made here.

## Secondary findings

- **`webview_interact`'s click is inert against Radix-driven UI**
  (`onPointerDown`-gated open/select), silent no-op rather than an error.
  Worth naming alongside the plan's other upstream-defects list
  (`docs/guides/packaged-tauri-qa.md` §11) if agents will drive
  Radix-based dialogs (the daemon picker, among others) through this
  bridge — not filed there in this pass since that file belongs to Group 5.
- **`/api/auth/devices/:id` accepts an unmatched id and returns `200`**
  without indicating "not found" (`ok_empty()` unconditionally on the DB
  call succeeding, not on a row actually being removed) — the DELETE to
  `/api/auth/devices/undefined` above returned `200` and silently deleted
  nothing. Not a regression introduced by this todo; noted because it cost
  real time in this session and would equally mislead a human running the
  same recipe. Out of scope to fix here.

## Addendum, 2026-08-11 — the blocking finding is fixed and re-verified

The remedy this report recommended landed (`tauri.qa.conf.json` gains
`"dangerousDisableAssetCspModification": ["script-src"]`; the Task 1 guard
flipped from "key absent" to "key present and exactly `["script-src"]`"), and
the recipe was re-run against a freshly built QA bundle. **Everything below ran
with no pre-seed and no workaround of any kind — only the committed scripts.**

| Probe | Before the fix | After |
|---|---|---|
| Served `script-src` | `'self' 'unsafe-inline'` + **336** `sha256-` sources | `'self' 'unsafe-inline'`, **0** hash sources |
| Bridge's injected inline `<script>` | element in DOM, never executed | executes (`probe=1`) |
| `window.__MCP__.resolveRef` | absent → registration timeout | `function`, first attempt |
| `webview_execute_js {document.title}` | registration error every time | `"Mainframe"` |
| `webview_dom_snapshot` / `webview_screenshot` | same registration error | real ref tree / native-path capture |

The three acceptance criteria this report marked unmet are now met by the
committed recipe:

- **AC 3 (tool trio):** `webview_execute_js`, `webview_dom_snapshot`, and a
  native-path `webview_screenshot` all succeed on the first attempt.
- **AC 4 (relaunch gate):** three consecutive `launch-test-tauri-qa.sh`
  relaunches in one MCP-server session, each with the documented stop-all reset
  and no pre-seed — bridge bound to `127.0.0.1:9323` every time (its own log
  line), `identifier`/`cwd` verified every time, `webview_execute_js` returning
  `"Mainframe"` every time. Results:
  `docs/qa/assets/2026-08-10-todo-318-group6/task13-relaunch-results-post-csp-fix.json`.
- **AC 12 (packaged-only CSP smoke):** `new Function('return 1')` still returns
  `BLOCKED:EvalError` against the packaged app. The fix removed the asset
  hashes; it did not weaken the eval restriction, which is the property the
  smoke exists to observe.

### Task 14 completion: the composer restore and error copy this report could not observe

The blocker recorded above (a QA data dir with zero projects, and project
creation needing the native folder picker) has a bypass: the QA daemon's
loopback REST is auth-exempt, so `POST /api/projects` and `POST /api/chats`
seed both without touching the picker. Re-running the scenario that way —
seed, re-pair through the XFF proxy, open the seeded chat, revoke the device,
send — surfaced the two pieces that were missing:

- **Error copy, verbatim from the failed message:** `Not authorized on this
  daemon. Re-pair it from the daemon menu, then send again. Your attachments
  are back in the composer.`
- **Composer restore:** the dropped attachment (`qa318.txt`) is back in
  `composer-attachments` after the failure, and the failed message renders
  `Failed to send` above the sentence.

Two mechanics worth recording, because both cost time and neither is obvious:

1. **A text-only send does not 401 while the WebSocket is already open.**
   `chat-thread-controller.sendMessage` puts text on the existing authenticated
   socket (`this.ws.send({type:'message.send'})`), which the daemon keeps
   honoring after the device is revoked — the send succeeds and the agent runs.
   The 401 that carries a `status` comes from the **attachment upload**, a REST
   call, which is also why the copy's restored-attachments clause exists at all.
   Reaching that branch needs a send *with an attachment*.
2. **The attachment can be added without the native file picker** by
   dispatching a synthetic `DragEvent` carrying a `DataTransfer` at
   `composer-dropzone`.

**Observation, not a finding of this todo:** sending from a *draft* session
(no server-side chat yet) while the device is revoked clears the composer and
surfaces nothing — no failed message, no error copy, typed text lost. The
draft's chat-creation REST call 401s (the needs-repair footer appears at that
moment), but the pending-message projection that carries `describeSendError`
only exists for an already-created chat. Worth its own todo.

## Cleanup

QA app, dev app (`tauri:dev`), the XFF proxy, and all raw-probe Node
processes spawned during this session were terminated; `:9223`, `:9323`,
`:32208`, `:33208`, `:31650` confirmed free before returning. Production
(`:31415`) was never touched. Three pre-existing `npm exec
@hypothesi/tauri-mcp-server` processes (predating this session, unrelated —
likely another live session's own MCP tooling) were left running.
