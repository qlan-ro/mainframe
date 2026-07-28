# URL tabs in the Run surface (#281)

## Problem

The Run surface can already show a live web page, but only one the app launched itself. A preview tab is
bound to a launch configuration: it mounts its webview when that config's process reports `running` on a
known port, and destroys it the moment the process stops. Every other way a URL reaches the user — a
localhost link an agent prints in chat, a port a teammate mentions, a page served by something Mainframe
did not start — ends at the OS browser. The app owns a webview engine and cannot point it anywhere.

This is sharpest on a remote daemon. Mainframe can now open an ad-hoc Cloudflare tunnel for a port on the
daemon machine, but the only thing it does with the resulting URL is hand it to the local OS browser. The
work happens on one machine, the window that should show it is on another, and the surface built to display
running web pages cannot display this one.

## Behavior

### Creating a URL tab

A URL tab is created from two places, both funnelling through one path:

- **The Run tab strip.** The `+` menu gains a **URL…** row beside "New terminal" and the launch configs.
  Choosing it reveals an inline input in the tab strip — not a dialog — with the placeholder
  `localhost:3000`. Enter commits, Escape cancels and restores the strip. When the Run surface is empty
  (no tabs), the same action lives as an **Open URL…** row in the Run picker and reveals the same inline
  input in place.
- **The localhost chip in chat.** The chip's open control becomes a two-row menu: **Open in Mainframe**
  first, **Open in browser** second. "Open in Mainframe" creates or focuses a URL tab, reveals the Run
  surface if it is hidden, and focuses the tab. The chip's tunnel badge, its "Stop tunnel" control, and its
  browser behavior are otherwise unchanged.

Creating a URL tab requires no launch configuration and no running process. Input is normalized the way the
existing address bar normalizes it: whitespace trimmed, `http://` added when no scheme is present, and only
`http`/`https` accepted. Anything else — unparseable text, `file://`, `javascript:`, `ssh://` — is rejected
inline, with the invalid treatment the address bar already uses, and no webview is mounted.

Opening a URL that normalizes to one an existing URL tab in the same launch scope already holds focuses that
tab instead of stacking a second one. Comparison is on the normalized URL, not the raw input.

### The tab itself

A URL tab looks like a preview tab with the process controls removed. It keeps: the address bar (editable,
and updated by navigations that happen inside the page), reload, open-in-OS-browser, clear cache, the
desktop/mobile device toggle, element inspect, and region capture. Captures and inspect results go to the
active chat exactly as they do from a preview tab.

Run/stop/restart and the console drawer are **absent**, not disabled — there is no launch config for them to
act on. The tab's title is the URL's host and port. Its pill carries a globe glyph, distinct from the
preview eye.

The webview mounts as soon as the tab has a loadable URL and stays mounted regardless of any launch
process's state. Reload reloads the URL currently displayed rather than re-deriving one from a port.

URL tabs belong to the launch scope of the session that created them, are shown only in that scope, and are
released with it — the same rules every other Run tab follows.

### Remote daemons and tunnels

On a **local** daemon, every URL loads directly and the word "tunnel" never appears.

On a **remote** daemon, a URL naming a loopback host (`localhost`, `127.0.0.1`, `[::1]`) points at the
daemon machine and is not reachable from the app's machine. The tab then uses the existing per-port quick
tunnel, scoped to the active chat:

1. If the port is one the tunnel service refuses — below 1024, or the daemon's own port — the tab shows
   that specific reason and stops. No request is made.
2. Otherwise the tab adopts an existing tunnel for that port, or requests one, and shows a pending state
   naming the port and saying a tunnel is coming up. It never shows a blank webview while waiting.
3. Pending ends when the tunnel is ready **and its hostname has been verified as resolvable**. The tab then
   loads the tunnel origin carrying over the original URL's path, query, and fragment.
4. A tunnel that reports an error, or that produces nothing within 60 seconds, puts the tab into a failure
   state that shows the daemon's own error text and a **Retry**. The address bar stays live, so the user can
   type a different URL out of the failure state.
5. If the tunnel is stopped from somewhere else (the chat chip, settings) while a tab is using it, the tab
   says the tunnel was stopped and offers Retry. It does not silently re-request.

A remote-daemon URL that is not loopback (a public site, a LAN host) loads directly, with no tunnel.

### Inspect and region capture on any origin

Element inspect, region capture, and in-page navigation tracking work on every `http`/`https` origin a tab
loads, not only on localhost and tunnel hosts. This also fixes existing preview tabs, where typing a
non-localhost URL into the address bar today leaves the inspect and capture buttons silently dead. Opening a
page in the OS browser from inside a previewed page stays restricted to `http`/`https`.

### Closing and restarting

Closing a URL tab destroys its webview. If that tab requested the tunnel it was using, and no other URL tab
is still using that port, the tunnel is stopped; a tunnel the tab merely adopted, or one another tab still
needs, stays up.

URL tabs survive an app restart. They rehydrate unmounted and load on first activation. A rehydrated tab
resolves its tunnel from scratch — the stored value is the URL the user typed, never a tunnel URL.

## Not Included

- `deferred` — Browser features: history, a back/forward stack, bookmarks, downloads, devtools, multiple
  windows.
- `deferred` — Per-URL cookie and storage partitioning beyond the session isolation the preview webview
  already provides.
- `deferred` — Preserving a URL tab's in-page navigation across a restart; a rehydrated tab reloads the URL
  the user committed, not the last page it was on.
- `deferred` — Refactoring the chat chip's browser opener to carry the original path onto the tunnel origin;
  the tab does this, the chip keeps its current behavior.
- `declined` — Any daemon change. The tunnel start/stop/list endpoints, their validation, and their status
  events are consumed as they stand. No new route, no Rust daemon type, no envelope work.
- `declined` — Changing how launch-config preview tabs derive their URL, or their run/stop/restart/console
  behavior. Only the shared reload and address-bar validation change, and identically for both kinds.
- `declined` — Promoting the URL tab kind into the shared types package. It is renderer layout state.
- `platform` — The mobile client.
- `platform` — Live automated driving of a mounted webview. The Tauri automation bridge stops answering once
  a child webview exists.

## Edge cases

- **Input without a scheme** — `localhost:3000` becomes `http://localhost:3000/`.
- **Non-http(s) scheme** — `file:///etc/passwd`, `javascript://x`, `ssh://host` are rejected inline. This
  closes the same hole in the existing preview address bar, which accepts them today.
- **Empty or whitespace-only input** — treated as invalid; Enter does nothing visible except the invalid
  state.
- **Same port, different paths** — two URL tabs on `:3000` with different paths are two tabs sharing one
  tunnel. Closing one leaves the tunnel up for the other.
- **Duplicate across panes** — dedup looks at every pane in the scope, not just the one being added to.
- **Duplicate across scopes** — the same URL under a different project or worktree is a different tab.
- **Port the service refuses** — `http://localhost:22` on a remote daemon shows "Port must be 1024 or
  higher"-class text, not a generic failure. The check runs before any request; a rejection that still
  arrives from the daemon replaces it verbatim.
- **Tunnel ready but DNS not yet propagated** — the daemon reports a usable URL up to ~30 s before its
  hostname resolves. The tab stays pending through that window rather than loading a page that cannot
  resolve.
- **Daemon switch with URL tabs open** — layout and tunnels are scoped per daemon; tabs re-resolve locality
  against the daemon that is now active.
- **Scope released while a tunnel is up** — the tab is removed like any other; its exclusively-owned tunnel
  is stopped on the same rule as an explicit close.
- **Overlay over the webview** — the inline entry input sits in the tab strip, above the webview region, so
  it is not occluded. Any popover or menu this feature adds over the tab body must hide the webview through
  the existing occlusion path first.
- **A page that never loads** — a 502 from the tunnel edge or a dead dev server renders inside the webview.
  That is the page's error, not a tab state; the tab stays loaded and the address bar stays usable.

## Acceptance criteria

1. With no launch configuration defined and no process running, the `+` menu's **URL…** row opens an inline
   input in the Run tab strip; committing `localhost:5173` creates a tab whose webview displays that page.
2. With the Run surface empty, the Run picker offers **Open URL…**, and it produces the same inline input and
   the same tab.
3. Selecting the URL kind never reaches the Run surface's fallback placeholder — the tab renders the real
   view, and no rendered Run tab shows a `<kind>: <title>` placeholder for any kind in the union.
4. The chat localhost chip's open control shows a menu with **Open in Mainframe** listed above **Open in
   browser**. Choosing "Open in Mainframe" twice for the same URL yields exactly one Run tab, focused both
   times, and reveals the Run surface if it was hidden.
5. A URL tab's toolbar renders no run, stop, restart, or console-drawer control, and renders the address
   bar, reload, open-in-browser, clear-cache, device-toggle, inspect, and region-capture controls in an
   enabled state once the page is loaded.
6. Committing input that does not normalize to an `http`/`https` URL — empty, `not a url`,
   `file:///etc/passwd`, `javascript://x` — leaves the entry in the address bar's invalid treatment and
   mounts no webview. A unit test covers each of these inputs against the normalizer.
7. On a remote daemon, committing a loopback URL on an eligible port produces a tab showing a pending state
   that names the port, then loads the tunnel origin with the original path, query, and fragment preserved.
   The only tunnel calls made are the existing per-port start/stop endpoints; the diff adds no route and
   changes no file under `packages/core-rs`.
8. A tunnel that reports an error, or that produces no ready-and-resolvable URL within 60 s, leaves the tab
   in a failure state containing the daemon's error text (or a stated timeout) plus a Retry control; the
   webview area is never left blank without a state.
9. On a remote daemon, a loopback URL on a port below 1024 or on the daemon's own port shows that specific
   rejection text in the tab body and issues no tunnel start request.
10. Inspect and region capture succeed on a non-localhost, non-tunnel `https` origin: an inspect click
    delivers an element result to chat and a region drag delivers a capture. A Rust unit test asserts the
    four bridge commands stay reachable and that the external-open scheme guard still rejects `file:`,
    `javascript:`, and `ssh:`.
11. Closing a URL tab whose tunnel it exclusively started stops that tunnel (the port disappears from the
    tunnel list). Closing one of two tabs sharing a port, or a tab that adopted a tunnel started by the chat
    chip, leaves the tunnel running.
12. A URL tab created in one project or worktree does not appear in a session belonging to another, and is
    removed when its launch scope is released — the same assertions the existing scope tests make for
    preview tabs.
13. After a restart, a URL tab is present with its URL and title intact and loads on first activation; a
    persisted URL tab on a remote daemon returns to the pending state and re-requests its tunnel rather than
    loading a stored tunnel URL. A sanitizer test asserts the URL kind survives serialization while preview,
    console, and terminal are still stripped.
14. Every interactive element added carries a `data-testid` in `<surface>-<element>` kebab-case, keyed by tab
    id: `run-tab-url-<tabId>`, `run-tab-url-entry`, `run-tab-url-entry-input`, `run-picker-open-url`, plus
    the chip's menu rows. No testid is keyed by array index.
15. No webview label or tab id contains characters outside `[A-Za-z0-9_-]`; a test asserts a URL committed
    with a path and query produces a conforming tab id.
16. URL normalization and validation, duplicate detection, tunnel-state resolution (including the
    port-rejection and DNS-pending cases), tab-model transitions, and persistence sanitization are unit
    tested outside React. No file exceeds 300 lines and no function exceeds 50.
17. `pnpm --filter @qlan-ro/mainframe-ui typecheck` and the UI test suite pass; `cargo check` in
    `packages/app-tauri/src-tauri` passes; a changeset is present.

## Decisions

**Hard to reverse**

- **D1. Widen the preview bridge's remote-origin allowlist to all `http`/`https` origins.** `hard-to-reverse`
  — ruled at the design gate on 2026-07-28, superseding the brief's "do not widen" recommendation. Every
  child webview is already built with an injected bridge and no URL check; only the capability's `remote.urls`
  list decides which origins may call back. One allowlist keeps every control identical on every URL and
  removes a degraded state that would have to be designed, explained, and tested. Accepted and recorded so it
  is not rediscovered as a bug: a hostile page can fabricate an inspect payload that reaches the agent's
  context, and can raise OS-browser windows limited to `http`/`https` by the unchanged scheme guard. The
  capability's description must be rewritten — its current text justifies the narrow scope.
- **D2. Restrict URL normalization to `http` and `https`.** `hard-to-reverse` in the sense that it removes
  capability users may have relied on: the shared normalizer accepts any parseable scheme today, so the
  existing preview address bar can point a child webview at `file://`. Both the new entry and the existing
  address bar reject non-http(s) input from now on. Fixed in the same pass rather than deferred, because the
  new entry point would otherwise widen the reach of the same hole.

**Reversible**

- **D3. A URL tab is its own tab kind, not a preview tab with a URL.** `reversible` — the preview kind's
  identity, per-config dedup, process controls, and console drawer are all launch-config semantics;
  overloading it makes every one of them conditional. Adopted from the brief.
- **D4. URL tabs persist across restarts.** `reversible` — the sanitizer strips preview, console, and
  terminal because they hold live process handles. A URL tab's whole identity is a string, so it joins the
  file-backed kinds in the persist-safe set. Adopted from the brief.
- **D5. Remote-daemon tunnelling ships in v1, strictly as a consumer.** `reversible` — it is the stated
  motivation and the service exists end to end. If integration turns out to need a daemon change, that
  change splits into its own todo rather than expanding this one. Adopted from the brief.
- **D6. Two entry points, one creation path: the tab strip's `+` (and the empty-state picker) and the chat
  chip.** `reversible` — the strip is where tabs already come from; the chip is where a URL the user wants
  already is. Adopted from the design direction, extended to the empty-state picker because an empty Run
  surface has no `+`.
- **D7. The chip's open control becomes a menu with "Open in Mainframe" above "Open in browser".**
  `reversible` — the design direction specifies that order and that stacking. It costs the existing
  browser-open flow one extra click; a second icon button would avoid that but contradicts the approved
  layout. Revisit if the click proves annoying.
- **D8. Dedup by normalized URL within a launch scope; opening a duplicate focuses the existing tab.**
  `reversible` — mirrors preview's per-config singleton. Adopted from the brief.
- **D9. The tab's address bar persists its typed URL.** `reversible` — for a URL tab the typed URL is the
  tab's identity, unlike a preview tab where it is a transient override of a derived URL. Adopted from the
  brief.
- **D10. Stop a tunnel on close only when this tab started it and no other URL tab uses that port.**
  `reversible` — the chat chip has no ownership registry, so a tunnel that already existed when the tab
  asked for one is treated as adopted and never stopped by the tab. Errs toward leaving a tunnel up, which
  matches the chip's existing rule against optimistic teardown.
- **D11. Hold the pending state until the tunnel's hostname is verified as resolvable, with a 60 s
  watchdog.** `reversible` — the daemon publishes a usable URL on connect and verifies DNS 20–30 s later.
  The chat chip hands the pre-DNS URL to the OS browser, where a reload costs nothing; an embedded webview
  would show a hard resolution error for half a minute instead. The preview tab's 20 s watchdog is too short
  for this path, hence 60 s. The client currently discards the daemon's DNS flag, so the port-tunnel store
  must start carrying it — a renderer-side change with no effect on the chip.
- **D12. Carry the original path, query, and fragment onto the tunnel origin.** `reversible` — a tunnel maps
  a port, not a page; loading only the origin would silently drop the part of the URL the user cared about.
- **D13. Reload reloads the currently displayed URL rather than re-deriving it from a port.** `reversible` —
  a URL tab has no port to derive from, and for a preview tab that has not been navigated away the behavior
  is identical. It also removes the preview tab's surprising snap-back to `localhost:<port>` after the user
  navigates elsewhere.
- **D14. An externally stopped tunnel puts the tab in a stopped state with Retry; it never auto-restarts.**
  `reversible` — auto-restarting would fight a user who just pressed "Stop tunnel" on the chip.
- **D15. The tab title is the URL's host and port, not the page's `<title>`.** `reversible` — the webview
  handle exposes navigation URLs, not document titles; deriving the title from the URL needs no new host
  contract.
- **D16. Check port eligibility on the client before requesting a tunnel.** `reversible` — the rejection
  rule is already shared pure logic, so the tab can name the reason immediately instead of round-tripping to
  learn it. A rejection that still comes back from the daemon replaces the local text verbatim.
