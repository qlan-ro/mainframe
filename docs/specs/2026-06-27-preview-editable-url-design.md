# Preview Tab — Editable Address Bar

**Date:** 2026-06-27
**Status:** Approved (design)
**Branch:** feat/app-tauri-wt

## Problem

The Preview tab shows the dev-server URL as a read-only label (`localhost:{port}`) in
`PreviewUrlBar.tsx`. The webview only ever loads `http://localhost:${port}` (root). Users
cannot navigate to a path, a different port, or any other address, and the bar does not
reflect navigation that happens inside the previewed app.

## Goal

Turn the read-only label into a full, two-way browser address bar:

- The user can type **any** `http(s)` URL and navigate the webview to it.
- The bar **reflects** navigation that happens inside the webview (link clicks, redirects,
  SPA route changes), like a real browser.

## Non-Goals

- Persisting the typed URL across server restarts (resets to `localhost:{port}` on start).
- History (back/forward) navigation, autocomplete, or bookmarks.
- Restricting the host to localhost — the bar accepts arbitrary URLs by design.

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| What can the user navigate to? | **Any URL** (full address bar, including external sites). |
| Does the bar reflect in-webview navigation? | **Yes — two-way.** |
| Persist typed URL across restart? | **No** — resets to `localhost:{port}` on (re)start / port change. |
| Tauri detection depth | Both **full-page** loads and **SPA in-page** navigations. |

## Architecture

Three layers change:

1. **`packages/types`** — extend the `PreviewHandle` interface with an `onNavigate`
   subscription.
2. **`packages/ui`** — the address-bar UI, the address state, and the two host
   implementations of `onNavigate`.
3. **`packages/app-tauri/src-tauri`** — a Rust command + injected JS to detect navigation
   inside the Tauri child webview (Electron needs no Rust).

### 1. UX / Component — `PreviewUrlBar.tsx`

Replace the read-only `<span>` with an always-present, inline-styled `<input>`:

- `data-testid="preview-url-input"`.
- **Value:** the current full URL (e.g. `http://localhost:3000/dashboard`).
- **Enter** → normalize the input, then call `handle.navigate(normalized)`.
- **Escape** or **blur without submit** → revert the input to the current URL.
- **Disabled** when the server is not running (`!isRunning`), mirroring the existing
  reload / open-in-browser / clear-cache buttons, which remain unchanged.
- **Invalid input** → brief invalid visual state (e.g. red ring); do **not** navigate, do
  not crash.

#### URL normalization helper (pure, unit-tested)

A small pure function `normalizePreviewUrl(input: string): string | null`:

- Trims whitespace.
- If the input has no scheme (no `://`), prepend `http://` (dev servers are usually plain
  HTTP). Example: `localhost:3000/x` → `http://localhost:3000/x`; `example.com` →
  `http://example.com`.
- Parse with `new URL(...)`. If it throws, return `null` (caller shows the invalid state).
- Returns the normalized absolute URL string on success.

### 2. Address state

A `currentUrl: string` held as local React state, encapsulated in a small
`use-preview-address` hook (kept in `packages/ui/src/features/preview/`). The hook:

- Seeds `currentUrl` to `http://localhost:${port}` when a port becomes available, and
  re-seeds whenever the port changes or the server (re)starts.
- Exposes `currentUrl` and a `submit(input: string)` action that normalizes, navigates the
  webview via the `PreviewHandle`, and on success sets `currentUrl`.
- Subscribes to `handle.onNavigate(url => setCurrentUrl(url))` while a handle exists,
  unsubscribing on teardown.
- Is **not** persisted to the layout store — restart/port change resets it.

The hook owns the handle subscription so `PreviewUrlBar` stays a controlled presentational
component (`value`, `onSubmit`, `disabled`).

### 3. Host-bridge capability — `onNavigate`

Add to `PreviewHandle` in `packages/types/src/host/host-bridge.ts`:

```ts
/** Subscribe to navigations that occur inside the preview webview
 *  (link clicks, redirects, SPA route changes). Returns an unsubscribe fn. */
onNavigate(cb: (url: string) => void): Unsubscribe;
```

Implemented on **both** hosts so the interface is never a stub.

#### Electron — `lib/host/electron-preview.ts`

Mirror the existing `onInspect`/`onRegionSelect` callback-set pattern:

- Maintain a `Set<(url: string) => void>`.
- Add listeners on the `<webview>` element for `did-navigate` (full-page) and
  `did-navigate-in-page` (SPA / hash). Read `event.url` and fan out to the set.
- `onNavigate(cb)` adds to the set and returns a remover.

Native and low-risk; no main-process change.

#### Tauri — `lib/host/tauri-preview.ts` + `lib/tauri/preview.ts`

Mirror the proven `onInspectResult` event pattern:

- New `preview:navigate` event emitted from Rust.
- New binding `onNavigateEvent(cb)` in `lib/tauri/preview.ts` using `listen('preview:navigate', ...)`.
- In `tauri-preview.ts`, `onNavigate` subscribes via `onNavigateEvent`, filters by `tabId`,
  and forwards `result.url`.

### 4. Tauri navigation detection (Rust + injected JS)

Tauri's child `WebviewBuilder` exposes no native navigation callback, so detection runs in
injected JS (the existing `BRIDGE_JS` in `preview/bridge.rs`) and reports back through a new
Rust command that re-emits an app event — exactly the inspect/region pattern.

- **New Rust command** `preview_navigate_event(tab_id, url)` in `preview/mod.rs`: emits
  `app.emit("preview:navigate", NavigateResult { tab_id, url })`. Register in the invoke
  handler.
- **`BRIDGE_JS` additions** (`preview/bridge.rs`):
  - **Full-page navigations:** `initialization_script` re-runs on every document load, so
    report `location.href` once at injection time — covers link-to-new-document for free.
  - **SPA in-page navigations:** patch `history.pushState` / `history.replaceState` and
    listen to `popstate` + `hashchange`; on change, if `location.href` differs from the last
    reported URL, invoke `preview_navigate_event` with the tab id and new href.
  - De-dupe against the last reported URL to avoid event storms.

Electron requires **no** Rust change (events are native).

## Data Flow

```
User types + Enter ─► PreviewUrlBar.onSubmit ─► use-preview-address.submit
   └─► normalizePreviewUrl ─► handle.navigate(url) ─► (Electron loadURL | Tauri preview_navigate)
                                                        └─► setCurrentUrl(url)

In-webview nav ─► (Electron did-navigate / Tauri BRIDGE_JS ─► preview_navigate_event ─► emit)
   └─► handle.onNavigate(cb) ─► use-preview-address.setCurrentUrl ─► PreviewUrlBar value
```

## Error Handling

- Invalid URL input: `normalizePreviewUrl` returns `null`; the bar shows the invalid state
  and does not navigate. No throw, no log spam.
- `handle.navigate` rejection: caught and logged via the host's existing logging convention
  (`console.warn` with a `[preview]` tag in desktop/UI code); the bar reverts to
  `currentUrl`.
- Tauri event subscription failure: caught and logged like the existing `onInspect` wiring
  (`console.warn('[preview] tauri onNavigate', e)`).

## Testing

- **Unit — `normalizePreviewUrl`:** hardcoded expectations. `localhost:3000/x` →
  `http://localhost:3000/x`; `example.com` → `http://example.com`; `https://a.com` →
  unchanged; `not a url ::` → `null`; empty/whitespace → `null`.
- **Unit — `PreviewUrlBar`:** Enter calls the submit handler with the typed value; Escape
  reverts to `value`; input is disabled when not running; the rendered value reflects the
  `value` prop (covers the `onNavigate`-driven update path).
- **Unit — `use-preview-address`** (if logic warrants): seeds from port, re-seeds on port
  change, updates on an `onNavigate` callback, submit calls `navigate`.
- Every interactive element carries a `data-testid` (`preview-url-input` added; existing
  button testids unchanged).

## Files Touched

**Interface**
- `packages/types/src/host/host-bridge.ts` — add `onNavigate` to `PreviewHandle`.

**UI (`packages/ui/src/`)**
- `features/preview/PreviewUrlBar.tsx` — editable input + invalid state.
- `features/preview/use-preview-address.ts` — new address-state hook.
- `features/preview/PreviewInstance.tsx` (and/or `PreviewToolbar.tsx`) — wire the hook.
- `features/preview/normalize-url.ts` — `normalizePreviewUrl` helper (or colocated).
- `lib/host/electron-preview.ts` — `onNavigate` via `did-navigate` listeners.
- `lib/host/tauri-preview.ts` — `onNavigate` via `onNavigateEvent`.
- `lib/tauri/preview.ts` — `onNavigateEvent` binding + `NavigateResult` type.
- `features/preview/__tests__/` — unit tests above.

**Tauri (`packages/app-tauri/src-tauri/src/`)**
- `preview/mod.rs` — `preview_navigate_event` command + invoke-handler registration.
- `preview/bridge.rs` — `BRIDGE_JS` navigation detection (full-page + SPA).

## Risks

- **SPA coverage on Tauri:** apps that route without `pushState`/`popstate`/`hashchange`
  (rare) won't be reflected. Acceptable; full-page and standard SPA routing are covered.
- **Electron event selection:** must confirm `did-navigate` vs `did-navigate-in-page` fire
  for the previewed app's routing; both are listened to, reducing risk.
- **Legacy Electron host:** Electron is the legacy target but shares the interface; the
  native listener is cheap and keeps the interface non-stubbed.
