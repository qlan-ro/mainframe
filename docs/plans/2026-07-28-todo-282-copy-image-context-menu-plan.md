# Todo #282 — Right-click an opened image to copy it

**Route:** no-spec (this plan works directly from the approved Agent Brief + the 2026-07-28 Design direction)
**Branch:** `todo/282-copy-image-context-menu` · **Worktree:** `.worktrees/todo-282-copy-image-context-menu`

## Goal

An image the user opens in the chat transcript has no context menu, so there is no
way to get the bitmap onto the system clipboard — text copies fine, binary image
data does not. This change wraps the one `<img>` inside `LightboxSurface` — the
choke point both zoom paths already route through (`ZoomableImage` for assistant
images, `ImageLightbox` for the user-turn gallery, task and session attachment
grids, and the file `ImageViewer`) — in a shadcn `ContextMenu` carrying a single
**Copy Image** item. Clicking it writes the image to the system clipboard through
the webview's own async Clipboard API (`navigator.clipboard.write` with a
`ClipboardItem`), the same API the transcript already uses to copy text, so pasting
into Preview or Slack yields the image, not a URL. No IPC, no Rust, no host port.
The menu mounts only when the source is copyable (`data:image/*`) *and* the webview
advertises image-clipboard support; otherwise `ImageContextMenu` renders its
children bare and right-click falls through exactly as it does today. The item
reports its own outcome inline (Copy → Copied / Copy failed) through the shared
`useMenuCopyFeedback` hook, and a failure additionally raises an `mfToast` carrying
the reason.

## Constraints

- **`CLAUDE.md`:** max 300 lines/file, 50 lines/function; `data-testid` on every
  interactive element (`<surface>-<element>` kebab-case); tests required for new
  core logic; no silent catches; changeset required before commit.
- **`packages/ui/CLAUDE.md`:** shadcn primitives, never raw Radix; read the
  `mainframe-design-system` skill before writing markup or class names; pure logic
  lives outside React.
- **Design gate (2026-07-28)** is authoritative where it and the brief disagree —
  see D1/D2 below. Where this plan departs from the gate, D9 records why.
- **Vitest project split** (`packages/ui/vitest.config.ts`): `*.test.tsx` runs in
  jsdom, `*.test.ts` in node. A `.test.ts` that touches DOM APIs must carry a
  `// @vitest-environment jsdom` pragma — `write-image.test.ts` needs it, the other
  two do not.
- **Every file this plan touches is comfortably under the line limits.** Largest
  edited file: `LightboxSurface.tsx` (42 → ~48). Every new file lands well under
  300; every new function under 50.
- **The worktree has no `node_modules`.** Run `pnpm install` from the worktree root
  before the first task.
- **No Rust and no cold `cargo` build** on the primary path. Appendix A (the
  fallback) is the only thing that would need one; do not pay for it before Task 13
  says it is needed.

## Decisions

**D1 — Mount point is `LightboxSurface` only; `AttachmentPreviewDialog` is not
wrapped.** The design gate scoped the menu to the *opened* image, and both zoom
paths funnel through `LightboxSurface`. The third "opened image" surface,
`AttachmentPreviewDialog` in `packages/ui/src/components/ui/assistant-ui/attachment.tsx`,
is the **same dialog the composer uses for its own attachment previews**, which the
brief explicitly rules out of scope. Wrapping it would leak the menu into the
composer, so it stays out. Consequence: sandbox-capture attachments on a user turn
(which render through `AttachmentPreviewDialog`, not `ImageLightbox`) get no menu.
If that gap matters, splitting the message and composer preview dialogs is separate
work.

**D2 — Unsupported sources mount no menu** (design gate), superseding the brief's
"disabled item with a reason". A one-item menu whose only item is dead is worse
than no menu; right-click falls through to the webview default.

**D3 — Testids: `chat-image-context-menu` on the menu *content*, `chat-image-copy`
on the item.** The design direction put the first one on the trigger, but the
trigger is the `<img>`, which already carries `imageTestId`
(`chat-image-zoom-image` / `image-lightbox-current`) that existing tests assert on;
one element cannot hold two testids. Neither id is keyed by a message/attachment
id because the lightbox renders exactly one image at a time — there is no list and
no index to disambiguate, and threading an id through three call sites to satisfy
the letter of the rule buys nothing.

**D4 — The webview writes the clipboard; nothing crosses the IPC boundary.**
*(Replaces the earlier "renderer decodes to RGBA, Rust writes" decision.)* Three
candidate paths were compared:

| Path | Cost | Verdict |
|---|---|---|
| `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])` in the renderer | one ~40-line module | **chosen** |
| Renderer decodes to RGBA → raw-body `invoke` → `tauri-plugin-clipboard-manager` | new Rust command + plugin dep + host port + a CSP change with app-wide blast radius (D8) | fallback, Appendix A |
| Ship the encoded bytes to Rust and decode there | an image-decoding crate and a per-format support matrix | rejected |

Why the webview path is credible here rather than assumed: the renderer already
calls `navigator.clipboard.writeText` successfully inside the Tauri WKWebView
(`lib/editor/copy-reference.ts`, `features/chat/parts/CodeHeader.tsx`,
`features/settings/panes/remote-access/CopyButton.tsx`), and `copy-reference.ts`
documents an *observed* WKWebView failure mode ("refuses `writeText` whenever the
document isn't focused") — the async Clipboard API is therefore present and the
origin is a secure context, which is the only precondition WebKit puts on
`ClipboardItem`. WebKit has shipped `ClipboardItem` writes for `image/png` since
Safari 13.4, and the shipped app is macOS-only today
(`.github/workflows/release.yml`, `build-app-tauri` matrix). This decision is not
taken on faith: **Task 13 is a hard gate** that verifies a real paste in the shell
before the change can ship, and Appendix A specifies the fallback in full.

**D5 — Supported sources are `data:image/*` only, normalized to PNG.** Every image
the transcript renders today is a data URI: `convert-message.ts` builds
`` `data:${c.mediaType};base64,${c.data}` ``, and `SessionAttachmentsGrid`,
`TaskAttachments`, and `ImageViewer` all do the same. `http(s)` sources stay
unsupported per the brief's "do not fetch on right-click" ruling; `file://` and
asset-protocol sources are unsupported because nothing in the transcript produces
them. WebKit accepts only `image/png` on write, so a `data:image/jpeg` (or webp,
or gif) source is re-encoded to PNG through a canvas before the write — see
Task 9.

**D6 — No `HostBridge.clipboard` port; capability is a runtime feature detection.**
The brief asked for a host-adapter capability, which made sense when the write had
to reach Rust. The write is now webview-native and identical on every host, so the
port would be three adapter implementations that all forward to the same two lines.
`imageClipboardSupported()` in `lib/clipboard/image-source.ts`
(`typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function'`)
satisfies the brief's actual requirement — *a flag the UI reads before render, not a
throw at call time*. Consequence, in the user's favor: browser mode is no longer
categorically disabled. Chromium supports the write, so the menu appears and works
there; Firefox does not expose `ClipboardItem` writes by default, so it gets no
menu. jsdom has neither, so every existing transcript test renders exactly as
before.

**D7 — Task 13 is a gate, not a QA step.** The webview path is the whole change; if
WKWebView refuses the write, four of this plan's files are dead. So the plan is
ordered so the *cheap* path is built and proven in the running shell (Task 13)
before any Rust exists, and Appendix A — the host port plus the Rust command — is
executed only if that gate fails. The gate's outcome is recorded as a decision in
the lane result either way.

**D8 — If Appendix A is taken, it keeps the raw-body invoke and fixes the CSP; it
does not switch to plain typed args.** Recorded here because it is the reason the
fallback looks the way it does. `packages/app-tauri/src-tauri/tauri.conf.json:31`
sets `connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https: wss:`, with no
`ipc:` token. Tauri's JS IPC sends every invoke as
`fetch(convertFileSrc(cmd, 'ipc'))` (`tauri-2.11.5/scripts/ipc-protocol.js`), so in
the packaged app that fetch is CSP-rejected, `customProtocolIpcFailed` latches, and
every subsequent invoke falls back to `window.ipc.postMessage`, whose payload is
JSON — reaching Rust as `InvokeBody::Json` (`tauri/src/ipc/protocol.rs`). Tauri does
**not** inject the token for you: `manager::set_csp` only rewrites `script-src` and
`style-src` nonces, and `tauri-utils`' own config docs show the developer writing
`connect-src ipc: http://ipc.localhost` by hand. Because `build.devUrl` is served by
Vite with no CSP header at all, this breaks *only* the packaged app. The obvious
alternative — plain typed args — is worse, not safer:
`scripts/process-ipc-message-fn.js` JSON-stringifies any object payload with
`Uint8Array → Array.from` on **both** transports, so a 3024×1964 retina capture
(23.7 MB of RGBA) becomes a ~75 MB JSON number array to stringify and parse on every
copy. Appendix A therefore adds the CSP token, and its QA runs against a packaged
build.

**D9 — The menu reuses `useMenuCopyFeedback` and the in-repo item markup.** The
transcript already has two copy context menus — `MessagePathContextMenu` and
`LinkWithPreview` — and the hook exists precisely "so the message path menu doesn't
paste the mechanism a second time". A third idiom (silent success, toast-only
failure) would make three copy menus in one surface behave three ways, so the image
menu adopts the hook: the item reads Copy → **Copied** / **Copy failed** and the
menu self-closes after ~900 ms. The failure toast is kept on top of the inline
state because it is the only place the *reason* fits. This also fixes the icon:
the design direction wrote `<Copy size={13} className="text-muted-foreground" />`,
but every ContextMenu copy item in the repo uses `className="mr-2 size-3.5"` with
no colour override; the image menu matches its neighbours.

## Interfaces this change adds

```ts
// packages/ui/src/lib/clipboard/image-source.ts
export type ImageSourceKind = 'data-url' | 'remote' | 'unsupported';
export function classifyImageSource(src: string): ImageSourceKind;
export function decodeDataUrl(src: string): { mediaType: string; bytes: Uint8Array } | null;
export function imageClipboardSupported(): boolean;
export function canCopyImage(src: string): boolean;

// packages/ui/src/lib/clipboard/write-image.ts
export function writeImageToClipboard(bytes: Uint8Array, mediaType: string): Promise<void>;

// packages/ui/src/lib/clipboard/copy-image.ts
export type CopyImageResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported-host' | 'unsupported-source' | 'write-failed'; message: string };
export function copyImageToClipboard(src: string): Promise<CopyImageResult>;
```

`copyImageToClipboard` is **not** an `async` function. WebKit requires
`navigator.clipboard.write` to run under the user activation of the click that
triggered it, and an `await` before the call ends that activation. Everything up to
the write is synchronous; the re-encode for non-PNG sources rides inside the
`ClipboardItem` value as a promise, which is the form WebKit documents for exactly
this case.

---

## Group 1 — `clipboard-core-tests` (test) · depends on: nothing

All three files are **red-phase**: the modules they import do not exist yet, and
Group `clipboard-lib` implements against them. Say so in each file's header comment
so a reader is not confused by a failing run.

### Task 1 — Source classification and gating tests (RED)

**File:** `packages/ui/src/lib/clipboard/__tests__/image-source.test.ts` — **new**
(node environment; no DOM).

Cover, with hardcoded expectations (no logic mirrored from the implementation):
- `classifyImageSource` → `'data-url'` for `data:image/png;base64,…` and
  `data:image/jpeg;base64,…`; `'remote'` for `http://…` and `https://…`;
  `'unsupported'` for `file:///…`, `blob:…`, `asset://…`, `''`, and a non-image
  data URI (`data:text/plain;base64,…`).
- `decodeDataUrl` → `{ mediaType: 'image/png', bytes }` for a known 1×1 PNG data
  URI, asserting the first eight bytes are the PNG signature
  (`137 80 78 71 13 10 26 10`) and the byte length matches the base64 payload;
  `null` for a non-base64 data URI (`data:image/svg+xml,<svg/>`), for a non-image
  data URI, and for malformed base64.
- `imageClipboardSupported` → `false` with no `ClipboardItem` global; `false` with
  `ClipboardItem` present but no `navigator.clipboard.write`; `true` with both.
  Install and remove the globals with `vi.stubGlobal` / `vi.unstubAllGlobals`.
- `canCopyImage` truth table over `{data-url, remote} × {supported, unsupported}` —
  only `data-url` + supported is `true`.

### Task 2 — Clipboard write tests (RED)

**File:** `packages/ui/src/lib/clipboard/__tests__/write-image.test.ts` — **new.**
First line: `// @vitest-environment jsdom` (see Constraints).

Stub `ClipboardItem` with a class that records its constructor argument, and
`navigator.clipboard.write` with a spy. Cases:
- **PNG passthrough:** `writeImageToClipboard(bytes, 'image/png')` calls `write`
  once with a single `ClipboardItem`; the item's `image/png` value resolves to a
  `Blob` of `type === 'image/png'` and `size === bytes.length`; no canvas is
  touched (spy on `document.createElement` or on the stubbed `getContext`).
- **Activation ordering:** `navigator.clipboard.write` has already been called
  **synchronously** when `writeImageToClipboard` returns — assert the spy's call
  count is 1 before awaiting the returned promise. This is the test that pins the
  user-activation requirement from D4; without it a later refactor to `async`
  silently breaks copy in WebKit.
- **JPEG re-encode:** with `HTMLImageElement.prototype.decode` stubbed to resolve
  (setting `naturalWidth`/`naturalHeight`), `HTMLCanvasElement.prototype.getContext`
  stubbed to a fake 2d context with a `drawImage` spy, and
  `HTMLCanvasElement.prototype.toBlob` stubbed to hand back a PNG blob:
  `writeImageToClipboard(bytes, 'image/jpeg')` still calls `write` synchronously,
  and the item's value resolves to the re-encoded PNG blob. Assert
  `URL.createObjectURL` / `URL.revokeObjectURL` are balanced.
- **Re-encode failure:** a rejecting `decode()` rejects the returned promise, and
  the object URL is still revoked. Same for a `null` 2d context and for a `toBlob`
  that yields `null`.

### Task 3 — Copy orchestration tests (RED)

**File:** `packages/ui/src/lib/clipboard/__tests__/copy-image.test.ts` — **new**
(node environment).

`vi.mock('../write-image')` so no DOM is needed; use the real `image-source`.
Cases:
- No `ClipboardItem` global → `{ ok: false, reason: 'unsupported-host' }`, and
  `writeImageToClipboard` is never called.
- `https://…` source with support present → `{ ok: false, reason:
  'unsupported-source' }`, nothing called.
- Happy path → `writeImageToClipboard` receives exactly the decoded bytes and the
  media type from the data URI; result is `{ ok: true }`.
- `writeImageToClipboard` rejects → `{ ok: false, reason: 'write-failed' }` with a
  non-empty `message` taken from the error, and one tagged `console.warn` (spy on
  it — the no-silent-catch rule).
- A non-`Error` rejection (`Promise.reject('nope')`) still produces a non-empty
  `message`.

**Verify (whole group):** all three files fail on missing modules; no other suite
changes. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/clipboard`.

---

## Group 2 — `clipboard-lib` (core) · depends on: `clipboard-core-tests`

### Task 4 — `image-source.ts`

**File:** `packages/ui/src/lib/clipboard/image-source.ts` — **new.**

Pure, no DOM writes. `classifyImageSource` matches
`^data:image\/[a-zA-Z0-9.+-]+;base64,` for `'data-url'` and `^https?:` for
`'remote'`; everything else is `'unsupported'`. `decodeDataUrl` splits on the
first `,`, verifies the prefix shape, `atob`s the payload inside a `try`
(returning `null` on `InvalidCharacterError` — an `/* expected */`-commented catch,
since a malformed URI is data, not a fault), and copies char codes into a
`Uint8Array`. `imageClipboardSupported` is the two-term global check from D6 —
guard both terms so it is safe to call in a node test. `canCopyImage` is the
conjunction of the kind check and `imageClipboardSupported()`.

**Verify:** `vitest run src/lib/clipboard/__tests__/image-source.test.ts` green.

### Task 5 — `write-image.ts`

**File:** `packages/ui/src/lib/clipboard/write-image.ts` — **new.**

```ts
export function writeImageToClipboard(bytes: Uint8Array, mediaType: string): Promise<void> {
  const png =
    mediaType === 'image/png'
      ? Promise.resolve(new Blob([bytes], { type: 'image/png' }))
      : reencodeToPng(bytes, mediaType);
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
```

One comment, on the promise value: WebKit accepts only `image/png` on write, and
takes a promise so the re-encode can finish after the user gesture. Private
`reencodeToPng(bytes, mediaType): Promise<Blob>`:
1. `const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }))` — blob
   URLs are same-origin, so the canvas is never tainted.
2. `const img = new Image(); img.src = url; await img.decode();` — `decode()` over
   `createImageBitmap`/`OffscreenCanvas` because every webview the shell ships on
   supports it.
3. Draw onto a `document.createElement('canvas')` sized to
   `naturalWidth × naturalHeight`; throw when either is `0` or `getContext('2d')`
   returns `null`.
4. `canvas.toBlob(resolve, 'image/png')`, rejecting when it yields `null`.
5. `URL.revokeObjectURL(url)` in a `finally`.

Keep each function under 50 lines; if `reencodeToPng` crowds, split the canvas step
into a second private helper in the same file.

**Verify:** `vitest run src/lib/clipboard/__tests__/write-image.test.ts` green.

### Task 6 — `copy-image.ts`

**File:** `packages/ui/src/lib/clipboard/copy-image.ts` — **new.**

The exact ladder the Task 3 tests pin: `imageClipboardSupported()` →
`decodeDataUrl` → `writeImageToClipboard`, with `.then(onOk, onErr)` rather than
`await` (D4's activation rule; carry one comment saying so). The error branch calls
`console.warn('[copy-image] clipboard write failed', err)` — the tagged-warn idiom
`lib/editor/copy-reference.ts` already uses in this package — before returning
`{ ok: false, reason: 'write-failed', message }`, where `message` is the error's
message or a fixed fallback for a non-`Error` throw. No toast here: the component
owns user-facing feedback so this module stays callable outside React.

**Verify:** `vitest run src/lib/clipboard` all green, and
`pnpm --filter @qlan-ro/mainframe-ui typecheck` passes.

---

## Group 3 — `menu-tests` (test) · depends on: `clipboard-lib`

### Task 7 — `ImageContextMenu` behavior + both render paths (RED)

**File:** `packages/ui/src/features/chat/parts/__tests__/ImageContextMenu.test.tsx` — **new.**

Red-phase against Group `image-context-menu`. Imports the real
`lib/clipboard/image-source` (already built) and mocks `@/lib/clipboard/copy-image`
and `@/lib/toast`. A `beforeEach` installs `ClipboardItem` and
`navigator.clipboard.write` stubs so `canCopyImage` returns true;
`vi.unstubAllGlobals()` in `afterEach`. Radix context menus open on
`fireEvent.contextMenu(element)` — the pattern proven in
`features/sessions/sidebar/__tests__/SessionContextMenu.test.tsx`. Mirror
`features/chat/messages/__tests__/MessagePathContextMenu.test.tsx` for how it
handles the hook's delayed-close timer; do not invent a new timer strategy. Use a
real 1×1 PNG data URI constant for the copyable source.

Cases:
1. **Supported webview + data URI** — right-clicking the wrapped child opens
   `chat-image-context-menu` containing `chat-image-copy` with the text
   `Copy Image`.
2. **Supported webview + `https://…` source** — no `chat-image-context-menu` after
   `fireEvent.contextMenu`, and the child still renders.
3. **No `ClipboardItem` + data URI** — same: no menu, child renders.
4. **Copy succeeds** — clicking `chat-image-copy` calls `copyImageToClipboard` once
   with the src; the item's text becomes `Copied`; `mfToast.error` is never called.
5. **Copy fails** — `copyImageToClipboard` resolves
   `{ ok: false, reason: 'write-failed', message: 'boom' }`; the item's text becomes
   `Copy failed`, `mfToast.error` is called once, and its options carry
   `description: 'boom'`.
6. **Assistant-image path** — render `<ZoomableImage src={PNG_DATA_URI} />`, click
   `chat-image-zoom-trigger`, await `chat-image-zoom-dialog`, then
   `fireEvent.contextMenu` on `chat-image-zoom-image` → `chat-image-context-menu`
   appears. (Satisfies "the assistant/attachment render path gets the menu".)
7. **User-gallery path** — render
   `<ImageLightbox images={[{ src: PNG_DATA_URI }]} index={0} onIndexChange={vi.fn()} />`,
   `fireEvent.contextMenu` on `image-lightbox-current` → `chat-image-context-menu`
   appears. (Satisfies the second required render path.)
8. **Menu dismissal does not dismiss the lightbox** — with the `ZoomableImage`
   dialog open and the menu open, press `Escape` once: the menu closes and
   `chat-image-zoom-dialog` is still in the DOM. Then assert a plain click on
   `chat-image-zoom-image` (no menu open) still closes the dialog, so the existing
   dismissal contract survives the `asChild` wrap.

**Verify:** the file fails on the missing `../ImageContextMenu` module; the three
existing part tests (`ZoomableImage.test.tsx`, `ImageLightbox.test.tsx`,
`markdown-text.test.tsx`) still pass untouched — jsdom has no `ClipboardItem`, so
they render exactly as before.

---

## Group 4 — `image-context-menu` (ui) · depends on: `menu-tests`, `clipboard-lib`

Read the `mainframe-design-system` skill before writing any markup here.

### Task 8 — `ImageContextMenu.tsx`

**File:** `packages/ui/src/features/chat/parts/ImageContextMenu.tsx` — **new.**

```tsx
interface ImageContextMenuProps { src: string; children: ReactNode }
```

`useMenuCopyFeedback()` first (hooks before the early return), then
`if (!canCopyImage(src)) return <>{children}</>;` — D2's "no menu at all". Otherwise
the shadcn `ContextMenu onOpenChange={handleOpenChange}` /
`ContextMenuTrigger asChild` / `ContextMenuContent className="w-44"` with one item,
mirroring `MessagePathContextMenu`'s `CopyPathItem` markup (D9):

```tsx
<ContextMenuItem data-testid="chat-image-copy" onSelect={onCopySelect('chat-image-copy', handleCopy)}>
  {status === 'copied' && <Check className="mr-2 size-3.5 text-mf-success" />}
  {status === 'failed' && <AlertTriangle className="mr-2 size-3.5 text-destructive" />}
  {status === 'idle' && <Copy className="mr-2 size-3.5" />}
  {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy Image'}
</ContextMenuItem>
```

`handleCopy` is the `() => Promise<boolean>` the hook expects: it awaits
`copyImageToClipboard(src)`, fires
`mfToast.error('Could not copy the image', { description: result.message })` when
`!result.ok` (`mfToast`, never `sonner` directly), and returns `result.ok`.
`data-testid="chat-image-context-menu"` goes on `ContextMenuContent` (D3). No
separator and no reserved second group.

**Verify:** cases 1–5 of Task 7 pass.

### Task 9 — Wrap the lightbox image

**File:** `packages/ui/src/features/chat/parts/LightboxSurface.tsx`

Wrap the existing `<img>` in `<ImageContextMenu src={src}>…</ImageContextMenu>`.
Leave `imageRef`, `data-testid={imageTestId}`, the classes, and `handleClick`
untouched: Radix's `asChild` slot composes the ref, so
`event.target === imageRef.current` still identifies the image and click-to-dismiss
still works. Add nothing to the props interface — the surface already receives
`src`.

**Verify:** cases 6–8 of Task 7 pass;
`vitest run src/features/chat/parts/__tests__/ZoomableImage.test.tsx src/features/chat/parts/__tests__/ImageLightbox.test.tsx`
still green.

### Task 10 — Changeset and full verification

**File:** `.changeset/<generated>.md` — **new.**

`pnpm changeset`, patch bump for `@qlan-ro/mainframe-ui` only (no types or Rust
change on this path; if Appendix A is executed, extend the changeset to
`@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-app-tauri`). Summary: one line
stating that right-clicking an opened image offers Copy Image.

**Verify:**
- `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/clipboard src/features/chat/parts`
- `git status` shows no stray files; no `@ts-ignore`, no `console.*` outside the one
  tagged warn in `copy-image.ts`, no file over 300 lines (`wc -l` on every touched
  file).

---

## Group 5 — `webview-clipboard-gate` (qa) · depends on: `image-context-menu`

### Task 11 — Prove the write in the running shell

This is the gate D7 describes, not a nice-to-have. Do it before considering the
lane's implement stage complete, and record the outcome as a decision in the lane
result.

1. `pnpm tauri:dev` from `packages/app-tauri` with an isolated `MAINFRAME_DATA_DIR`
   and `DAEMON_PORT` (per the memory note on production takeover). The Rust build
   is cold in this worktree but the Rust *sources* are untouched, so nothing here
   depends on Appendix A.
2. Open a PNG image in the transcript, right-click, click **Copy Image**, and paste
   into Preview (⌘N). The bitmap must appear with correct colours and dimensions.
3. Repeat with a JPEG-sourced image if one is reachable (the re-encode path).

**PASS** → the plan is complete; Appendix A is not executed and stays in this file
as the recorded alternative.
**FAIL** (`navigator.clipboard.write` rejects, or the paste yields nothing) →
capture the exact rejection, record it as the D7 outcome, and execute Appendix A.
Tasks 1–3 and 7–9 survive unchanged in that case; only `write-image.ts` and the
capability term of `image-source.ts` are replaced.

---

## QA smoke (for the qa stage, not this plan's tasks)

1. `pnpm tauri:dev` with an isolated `MAINFRAME_DATA_DIR` and `DAEMON_PORT`.
2. Send a screenshot to a session, open the resulting image in the transcript,
   right-click it → menu appears at the pointer, not clipped by the lightbox box.
3. Click **Copy Image** → the item reads **Copied** and the menu closes on its own;
   paste into Preview → the bitmap appears, correct colours and dimensions, no alpha
   inversion.
4. Right-click the *thumbnail* (not the opened image) → no menu (webview default).
5. Right-click transcript text, a code block, and the composer → unchanged.
6. Close the menu with Escape and with an outside click → the lightbox stays open;
   clicking the image itself still closes the lightbox.
7. Browser mode (`vite` without Tauri, in Chromium) → the menu appears and the copy
   works (D6); no console error.
8. **Only if Appendix A was executed:** run steps 2–3 against a packaged build
   (`scripts/build-release-local.sh --tauri`), not `tauri:dev`. The dev server
   serves no CSP header, so the IPC transport differs from the shipped app and a
   dev-only smoke cannot see the failure D8 describes. Also re-smoke the terminal,
   file open, and daemon start/stop on that build, since the CSP change moves every
   invoke onto the custom-protocol transport.

## Risks

- **`navigator.clipboard.write` in WKWebView is the load-bearing assumption.**
  Mitigated by Task 11 (a hard gate before ship) and by Appendix A being specified
  in full rather than discovered later. Evidence for it is in D4.
- **Non-PNG sources ride the canvas re-encode**, whose promise is resolved after the
  user gesture. WebKit documents promise values for exactly this reason, but if it
  refuses, PNG (every screenshot, the dominant case) still works and the JPEG case
  surfaces as an honest "Copy failed" toast rather than a corrupt clipboard entry.
- **Radix menu inside a Radix dialog.** Both portal to `document.body` at `z-50`;
  the menu mounts later so it stacks above. Covered by Task 7 case 8 and QA step 6.
- **jsdom cannot decode or write images**, so `write-image.ts` is only covered
  against stubbed DOM APIs. The real write is proven by Task 11, not by unit tests.

---

## Appendix A — fallback: host port + Rust clipboard command

**Execute only if Task 11 fails.** Everything here is additive to Tasks 1–3 and
7–9; `write-image.ts` and the capability term of `image-source.ts` are replaced,
`copy-image.ts` gains a `host` parameter, and `ImageContextMenu` calls
`canCopyImage(src, useHost())`. Budget one cold `cargo` build (multi-GB
`src-tauri/target` in this worktree, per the Disk Hygiene section of `CLAUDE.md`).

### A1 — Host contract

**File:** `packages/types/src/host/host-bridge.ts`

```ts
clipboard: {
  /** True when the host can put a bitmap on the system clipboard. Read before
   *  rendering clipboard affordances — never probe by calling and catching. */
  readonly canWriteImage: boolean;
  /** rgba is width*height*4 bytes, row-major, non-premultiplied. */
  writeImage(rgba: Uint8Array, width: number, height: number): Promise<void>;
};
```

Placed after `shell` and before `notify`. No Zod schema in `host-contract.ts` —
those schemas exist for the Electron `ipcMain` handlers, and the Electron adapter
reports `canWriteImage: false` (its preload exposes no clipboard image API and
adding one is out of scope), so it never receives this payload.

**Verify:** `pnpm --filter @qlan-ro/mainframe-types build` succeeds; the UI
typecheck fails until A3.

### A2 — CSP token (do this before anything else in the appendix)

**File:** `packages/app-tauri/src-tauri/tauri.conf.json`

Add `ipc: http://ipc.localhost` to the `connect-src` directive:

```
connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* ws://127.0.0.1:* https: wss:
```

Rationale and the rejected alternative are D8. Two consequences to state in the PR
body: the packaged app's IPC moves from `window.ipc.postMessage` to the
custom-protocol transport for **every** command (the transport dev already uses, so
this reduces dev/prod divergence — but it is an app-wide change riding in an
image-copy PR), and QA step 8 becomes mandatory.

### A3 — Renderer→Tauri call

**File:** `packages/ui/src/lib/tauri/bridge.ts`

```ts
export async function clipboardWriteImage(rgba: Uint8Array, width: number, height: number): Promise<void> {
  if (!IS_TAURI) throw new Error('clipboard.writeImage is not available outside the Tauri webview');
  await invoke<void>('clipboard_write_image', rgba, {
    headers: { 'x-image-width': String(width), 'x-image-height': String(height) },
  });
}
```

Pass the `Uint8Array` **directly**; do not copy it. `process-ipc-message-fn.js`
passes any `ArrayBuffer.isView` argument straight through to `fetch`, which reads
only `byteOffset..byteOffset+byteLength`, and the RGBA array produced by the decode
step is already exactly sized at offset 0. A defensive `.slice()` would cost a
second full-size copy in the webview (≈59 MB for a 5K capture) and buy nothing. No
comment is needed here beyond the `IS_TAURI` guard.

`@tauri-apps/api@2.11.1` types `InvokeArgs` as
`Record<string, unknown> | number[] | ArrayBuffer | Uint8Array` and `InvokeOptions`
as `{ headers: HeadersInit }`, so this is the supported raw-body form.

### A4 — Adapters

- `packages/ui/src/lib/host/tauri-adapter.ts` — `clipboard = { canWriteImage: true, writeImage: (rgba, w, h) => bridge.clipboardWriteImage(rgba, w, h) };`
- `packages/ui/src/lib/host/electron-adapter.ts` — `canWriteImage: false`; `writeImage` returns a rejected promise naming the host (mirror the file's existing not-supported style).
- `packages/ui/src/lib/host/fake-adapter.ts` — `canWriteImage` reads `this.overrides.clipboard?.canWriteImage ?? false`; `writeImage` delegates to the override when set, otherwise `notSupported('clipboard.writeImage')`. Extend `FakeHostOverrides` with `clipboard?: { canWriteImage?: boolean; writeImage?: (rgba: Uint8Array, width: number, height: number) => Promise<void> }` — load-bearing, since without it no jsdom test can reach the menu.

Tests: `lib/host/__tests__/tauri-adapter.test.ts` gains one case (`clipboard.writeImage(rgba, 2, 1)` invokes `'clipboard_write_image'` with a `Uint8Array` of `byteLength === 8` and the two headers); `lib/host/__tests__/fake-adapter.test.ts` gains two (default rejects; override receives the arguments).

### A5 — RGBA decode in the renderer

**File:** `packages/ui/src/lib/clipboard/decode-image.ts` — replaces `write-image.ts`.

`decodeToRgba(bytes, mediaType): Promise<{ rgba: Uint8Array; width: number; height: number }>`
is A5's version of Task 5's `reencodeToPng`: same object-URL → `img.decode()` →
canvas pipeline, ending at
`{ rgba: new Uint8Array(imageData.data.buffer.slice(0)), width, height }` instead of
`toBlob`. Its test file (`__tests__/decode-image.test.ts`, jsdom pragma) mirrors
Task 2 with `getImageData` in place of `toBlob`. `copy-image.ts` gains a
`decode-failed` reason between the source gate and the write.

### A6 — Rust command

**Files:**
- `packages/app-tauri/src-tauri/Cargo.toml` — `tauri-plugin-clipboard-manager = "2"` (+ `Cargo.lock` churn).
- `packages/app-tauri/src-tauri/src/commands/clipboard.rs` — **new.**
- `packages/app-tauri/src-tauri/src/commands/mod.rs` — `pub mod clipboard;` + `pub use clipboard::clipboard_write_image;`.
- `packages/app-tauri/src-tauri/src/lib.rs` — add the command to the `use commands::{…}` list and `tauri::generate_handler![…]`; add `.plugin(tauri_plugin_clipboard_manager::init())` beside the other `.plugin(...)` calls.

Split the module so the validation is testable without an `AppHandle` — every other
module in this crate carries a `#[cfg(test)]` block (`presence.rs`, `shell_env.rs`,
`sidecar.rs`, `log_sink.rs`, `terminal/mod.rs`, `menu.rs`, `updater/channel.rs`,
`preview/bridge_plugin.rs`, `lib.rs`, `commands/daemons.rs`), and this is the code
path whose failure mode the brief calls out as "worse than a disabled menu item".

```rust
/// Widest side any capture we accept can have; also the ceiling of the canvas the
/// renderer decoded through.
const MAX_IMAGE_DIMENSION: u32 = 16_384;
/// 256 MiB of RGBA ≈ 67 Mpx. Sized from real retina captures, not a round number:
/// a full-screen Pro Display XDR grab (6016×3384) is 81 MB and a scaled-4K/8K grab
/// (7680×4320) is 133 MB — both must pass. Anything past this is refused with the
/// "Could not copy the image" toast, which is the accepted user-visible cost of
/// bounding a single allocation to a quarter gigabyte.
const MAX_RGBA_BYTES: usize = 256 * 1024 * 1024;

fn header_u32(headers: &HeaderMap, name: &str) -> Result<u32, String>;
fn validate_rgba(len: usize, width: u32, height: u32) -> Result<(), String>;

#[tauri::command]
pub fn clipboard_write_image(app: tauri::AppHandle, request: Request<'_>) -> Result<(), String>;
```

The command: `request.body()` must be `InvokeBody::Raw` (anything else errors
naming the expected form — with A2 in place this cannot happen, and the error says
so); read `x-image-width` / `x-image-height` through `header_u32`; call
`validate_rgba`; then
`app.clipboard().write_image(&Image::new(rgba, width, height))`, mapping the error
to a `String` (the `Result<_, String>` convention `commands/fs.rs` established).
`validate_rgba` rejects `width == 0`, `height == 0`, either side over
`MAX_IMAGE_DIMENSION`, `len > MAX_RGBA_BYTES`, and `len != width*height*4` computed
in `usize` with `checked_mul` so a hostile header cannot overflow.

`#[cfg(test)] mod tests` covers: `header_u32` with a missing header, a non-numeric
header, a value past `u32::MAX`, and the happy path; `validate_rgba` with the happy
path, `width == 0`, `height == 0`, a side over `MAX_IMAGE_DIMENSION`, a
length mismatch, a length over `MAX_RGBA_BYTES`, and `(u32::MAX, u32::MAX)` —
which proves the `checked_mul` path returns an error instead of wrapping.

No capability entry is needed in `src-tauri/capabilities/main.json`: app-defined
commands are not permission-gated (`read_file` / `terminal_create` have no entry
either), and the plugin's own JS commands are never invoked from the renderer.

**Verify:** `cargo test` (the new module's tests), `cargo check`,
`cargo fmt --check`, and `cargo clippy --all-targets -- -D warnings` from
`packages/app-tauri/src-tauri`, then QA step 8 on a packaged build.
