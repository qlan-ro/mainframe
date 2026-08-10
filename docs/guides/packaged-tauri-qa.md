# Packaged Tauri QA (tauri-mcp bridge)

A recipe for driving a **packaged** Mainframe build with the `tauri-mcp`
bridge, for the QA scenarios `pnpm tauri:dev` cannot reproduce: CSP
enforcement, code signing, the auto-updater. Everything else belongs on the
`tauri` (dev) or `browser` target — see `.agents/test-worktree.md`.

## 1. What this is for

The dev target (`tauri:dev`) loads assets from the Vite dev server, which
serves no CSP at all, and it runs with a relaxed shell configuration. A
packaged build enforces the real `script-src 'self'` CSP, is code-signed (or,
here, deliberately not), and is the only place the auto-updater path exists.
This variant exists to reach those, and only those — it is not a faster or
more convenient version of the dev target.

## 2. One-time user setup (server pin)

The MCP server is launched unpinned by default (`npx @hypothesi/tauri-mcp-server`
resolves to whatever is newest), and this repo's plugin crate is pinned to a
specific line. An unpinned server drifting ahead of the crate is what produced
the 0.12-server/0.11-crate skew this todo traces (the 0.12 server disambiguates
concurrent apps by a reported working directory that only a 0.12+ crate sends —
against an older crate that disambiguation is silently dead, and the server
falls back to port-based targeting).

Pin the server to match this repo's crate. Edit your Claude Code MCP server
config (`~/.claude.json`, under `mcpServers`) so the entry reads:

```json
"@hypothesi/tauri-mcp-server": {
  "command": "npx",
  "args": ["-y", "@hypothesi/tauri-mcp-server@0.12.0"]
}
```

Matching repo-side pin: `packages/app-tauri/src-tauri/Cargo.toml` pins
`tauri-plugin-mcp-bridge = { version = "0.12", optional = true }`, resolved in
`Cargo.lock` to `0.12.0`. The server config lives outside this repo (it is
user-scoped, not repo-scoped), so this edit is a one-time step per machine,
not something a commit here can carry for you.

## 3. Build and launch

```bash
bash scripts/build-qa-tauri.sh
.agents/test-env.sh up tauri-qa
```

`build-qa-tauri.sh` compiles the `mcp-bridge-qa` feature and the
`tauri.qa.conf.json` overlay — three security concessions, and only these
three: `withGlobalTauri`, `'unsafe-inline'` in `script-src`, and
`"dangerousDisableAssetCspModification": ["script-src"]` — into a
debug-profile app bundle (never a dmg) at
`packages/app-tauri/src-tauri/target/debug/bundle/macos/Mainframe.app`. The
launch step is `.agents/launch-test-tauri-qa.sh` — it resolves isolated ports
and a data dir, refuses to run without them, and blocks until it prints
`READY` with the bridge address and daemon facts.

**From a worktree, invoke the launch script directly instead:**
`.agents/test-env.sh` re-execs the **primary** checkout's harness whenever a
worktree's own `.agents` differs from it, and the primary harness only learns
the `tauri-qa` target once this branch merges into it. Until then, run:

```bash
bash .agents/launch-test-tauri-qa.sh
```

`'unsafe-inline'` alone is not enough to unblock the bridge's injected helper:
Tauri appends a SHA-256 source to `script-src` for every bundled JS asset (336
of them here), and per the CSP spec any hash source in a directive makes
browsers ignore `'unsafe-inline'` in that same directive. That is what
`"dangerousDisableAssetCspModification": ["script-src"]` turns off — narrowly,
leaving the `style-src` hashes alone. Evidence:
`docs/qa/2026-08-10-todo-318-group6-live-verification.md`.
`packages/app-tauri/src-tauri/tests/config_guard.rs` fails if any of the three
concessions widens, or if one reaches the default config.

## 4. Attach and verify attachment

```
driver_session start {"host": "127.0.0.1", "port": 9323}
get_backend_state
```

Pass `host` explicitly — the server's own default is `localhost`, which can
resolve to `::1` while the plugin binds `127.0.0.1` (the same IPv6 trap noted
for the Vite dev server). Before trusting any assertion, confirm
`get_backend_state` reports `identifier == ro.qlan.mainframe` **and** a `cwd`
matching this QA checkout. A `driver_session start` against a port nothing is
listening on does not fail loudly — it falls back to discovery over the
default range and silently attaches to whatever answers first, which is
exactly how a QA session ends up driving a dev app in another checkout
instead of this one.

## 5. Bridge reset

```
driver_session stop
```

Call `driver_session stop` with **no** `appIdentifier`, then re-attach and
re-verify per section 4. The server caches per-`host:port:window`
helper-registration state, and it clears that cache only in the
no-`appIdentifier`, stop-everything branch. A *targeted* stop
(`driver_session stop {"appIdentifier": …}`) leaves the cache poisoned, so a
relaunched app on the same port is treated as already-registered and every
ref-based tool (`webview_execute_js`, `webview_dom_snapshot`,
`webview_find_element`, `webview_wait_for`, `read_logs(source: console)`)
fails with `Resolve-ref helper was not available in the webview after
registration.` This reset is what makes relaunching within one server session
work at all — run it after every relaunch, not just when something looks stuck.

## 6. Preview child-webview precondition — a different failure

If every webview tool fails with a **"window not found"**-shaped error
instead of the helper-registration timeout above, this is not the same
problem. The app auto-mounts a preview child webview on boot whenever a
launch config was still marked running, and while one is mounted the bridge
cannot resolve the main window by label — no bridge reset fixes this, because
the bridge was never the thing that broke.

Detect it: the app shows a preview panel/tab on launch, or `get_backend_state`
resolves a webview whose title/URL is the previewed app's, not Mainframe's.
Stop it: stop the launch config that owns the preview (or close the preview
tab in-app) before attaching the bridge.

## 7. Never reset the webview data store

Every Mainframe build — production, dev, and this QA variant — ships the
same bundle identifier (`ro.qlan.mainframe`) and therefore shares **one**
WKWebView data store. There is deliberately no "clear the webview data store"
step in this recipe: doing that would also wipe the production app's store.
Isolation here comes entirely from `MAINFRAME_DATA_DIR` and `DAEMON_PORT`,
never from resetting shared browser state.

## 8. Isolation contract

`.agents/launch-test-tauri-qa.sh` resolves, in this order, and refuses to
launch if the resolved values aren't isolated:

1. Source `.env` (generating it via `scripts/setup-ports.sh` first if
   absent). `.env`'s `DAEMON_PORT` is the **dev** target's port — the QA app
   never launches with it directly; it is only the base the next step derives
   from.
2. `QA_DAEMON_PORT = ${MF_QA_DAEMON_PORT:-$((DAEMON_PORT + 1000))}`.
3. `QA_DATA_DIR = ${MF_QA_DATA_DIR:-~/.mainframe_qa}`.
4. Refuse (`REFUSED:` + reason, nonzero exit, nothing launched) if
   `QA_DAEMON_PORT` is not a plain decimal number in `1024–65535`, or is
   `31415`; if `QA_DATA_DIR` contains a `..` component, or resolves to
   `~/.mainframe` or anywhere inside it; or if the QA bundle is missing.

`..` is refused outright rather than normalized: a component that doesn't
exist yet can't be resolved, so `~/absent/../.mainframe/new` survives
canonicalization intact, clears the containment check, and `mkdir -p` then
creates the absent component and lands in the production dir anyway.

Both gates compare **resolved** values, not the strings they were handed,
because a near-miss reaches production either way: `parse_daemon_port`
(`src-tauri/src/lib.rs`) falls back to production `31415` on any value it
can't read as a `u16`, so `garbage`, `99999`, `031415`, and a value too long
for `test`'s integers would each launch the QA app onto the production daemon;
and `~/.mainframe/`, `~/.mainframe/sub`, and a symlink to `~/.mainframe` — at
any depth, existing or not — all reach the production data dir while comparing
unequal as strings.

The gate reads the **resolved** values, never the ambient ones — an inherited
production `DAEMON_PORT` in the calling shell is exactly what wedged the
2026-08-09 QA run, so the script re-derives its own ports from `.env` instead
of trusting whatever the shell already exports. Skipping this and launching
directly (e.g. via Finder/`open`, which does not pass environment through)
hijacks the production daemon on `:31415` and the real `~/.mainframe` —
killing the live agent session, because agent sessions run inside the
production Mainframe app.

Demonstrated refusals:

```bash
MF_QA_DAEMON_PORT=31415 bash .agents/launch-test-tauri-qa.sh    # REFUSED, nothing launched
MF_QA_DAEMON_PORT=garbage bash .agents/launch-test-tauri-qa.sh  # REFUSED (would resolve to 31415)
MF_QA_DAEMON_PORT=99999 bash .agents/launch-test-tauri-qa.sh    # REFUSED (would resolve to 31415)
MF_QA_DATA_DIR=~/.mainframe bash .agents/launch-test-tauri-qa.sh    # REFUSED
MF_QA_DATA_DIR=~/.mainframe/ bash .agents/launch-test-tauri-qa.sh   # REFUSED
MF_QA_DATA_DIR=~/.mainframe/sub bash .agents/launch-test-tauri-qa.sh # REFUSED
MF_QA_DATA_DIR=~/absent/../.mainframe bash .agents/launch-test-tauri-qa.sh # REFUSED ('..')
```

`pid_is_ours`'s sibling-checkout boundary (fixed in f5b33ab2, `"$PROJECT_ROOT"/*`)
was live-verified by extracting the shipped function and running it against
two real PIDs — one launched from inside this checkout, one from a directory
whose path merely shares `$PROJECT_ROOT` as a string prefix
(`…-bridge-sib`, no separator). The fixed function matched only the first;
re-running the pre-fix pattern (`"$PROJECT_ROOT"*`, no required `/`) against
the same sibling PID matched it, confirming the scenario discriminates rather
than passing vacuously.

## 9. Endpoints

| | dev target | QA target |
|---|---|---|
| Bridge | `127.0.0.1:9223` | `127.0.0.1:9323` |
| Daemon | `.env`'s `DAEMON_PORT` (example this checkout: `32208`) | that port + 1000 (example: `33208`) |
| Data dir | `~/.mainframe_dev` | `~/.mainframe_qa` |

Bridges cannot collide: both the plugin's upward port scan and the server's
discovery range span 100 ports from their base (`9223`–`9322` for dev,
`9323`–`9422` for QA) — non-overlapping by construction. Daemons cannot
collide within one checkout: the `+1000` offset is larger than the whole dev
port allocation range (`31416`–`32416`), so a QA port never lands inside it.
Across checkouts a QA port derived from a low dev port can in principle equal
another checkout's dev port (`32416` is both the dev range's ceiling and the
QA range's floor) — the launch script's already-listening refusal is the
backstop for that case, and its pre-launch kill only takes a port holder
whose binary lives under *this* checkout, so a foreign sibling's app is left
alone to trip that refusal rather than being killed by mistake.

**Teardown:** `.agents/test-env.sh down` (or `stop-test.sh` directly) defaults
to the *dev* port set from `.env` plus CDP `9222` — it does not know the QA
target's derived ports. Tear down a QA run by passing them explicitly:

```bash
.agents/test-env.sh down "$QA_DAEMON_PORT" 9323
```

## 10. Optional user-side fallback: macOS Accessibility

If the bridge is unavailable, the OS-level fallback is AppleScript UI
scripting (`osascript`/System Events) driving the real window. This requires
Accessibility permission for the terminal/process running the session
(System Settings → Privacy & Security → Accessibility), which only the human
user can grant — it is not something an agent session can request for
itself. This is a named, optional fallback, never a dependency of this
recipe: without it, the recipe above is still complete on its own.

## 11. Known upstream defects (follow-up, not fixed here)

Filed against `hypothesi/mcp-server-tauri`, not fixed in this repo — the
recipe above is what makes them survivable, not a workaround that erases
them:

- **Upward port scan, no runtime override.** The plugin scans from its base
  port upward for the first free one and never exposes a way to pin the exact
  port at runtime; only the base is configurable. A stale listener on the
  base port drifts a fresh launch onto a different port than the one the
  recipe expects.
- **Targeted `driver_session stop` leaks its registration cache.** Only the
  no-`appIdentifier` stop-everything branch clears
  `initializedTargets` — see section 5.
- **Window resolution fails while a child webview is mounted.** See section 6.
