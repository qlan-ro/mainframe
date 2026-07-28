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
**Copy Image** item. Clicking it decodes the image to raw RGBA in the renderer and
hands the bytes plus their dimensions to a new host-port method, which on Tauri
calls the clipboard plugin so pasting into Preview or Slack yields the image, not a
URL. The menu mounts only when the source is copyable (`data:image/*`) *and* the
host advertises the capability; otherwise `ImageContextMenu` renders its children
bare and right-click falls through exactly as it does today. A failed copy raises
an `mfToast` error; a successful one is silent.

## Constraints

- **`CLAUDE.md`:** max 300 lines/file, 50 lines/function; `data-testid` on every
  interactive element (`<surface>-<element>` kebab-case); tests required for new
  core logic; single canonical type in `@qlan-ro/mainframe-types`; no silent
  catches; validate input; changeset required before commit.
- **`packages/ui/CLAUDE.md`:** shadcn primitives, never raw Radix; read the
  `mainframe-design-system` skill before writing markup or class names; pure logic
  lives outside React; `lib/tauri/` is the only Tauri-aware renderer module.
- **Design gate (2026-07-28)** is authoritative where it and the brief disagree —
  see D1/D2 below.
- **Every file this plan touches is comfortably under the line limits.** Largest
  edited file: `components/ui/context-menu.tsx` (untouched), then
  `lib/host/fake-adapter.ts` (159 → ~172), `lib/tauri/bridge.ts` (245 → ~262),
  `types/src/host/host-bridge.ts` (180 → ~195), `LightboxSurface.tsx` (42 → ~48).
  Every new file lands well under 300; every new function under 50.
- **The worktree has no `node_modules`.** Run `pnpm install` from the worktree root
  before the first TypeScript task.
- **Rust disk cost:** `cargo check` in this worktree is cold and builds the full
  `app-tauri` dependency graph into a new `src-tauri/target` (multi-GB, per the
  Disk Hygiene section of `CLAUDE.md`). Budget for it once, in Group
  `tauri-clipboard-command`.

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

**D4 — The renderer decodes; Rust only writes.** `copy-image.ts` turns the source
into raw RGBA via the webview's own decoder (`<img>` + canvas `getImageData`) and
passes the bytes as a raw invoke body with `x-image-width` / `x-image-height`
headers. The Rust command validates the length, builds a `tauri::image::Image`, and
calls `clipboard.write_image`. The alternative — shipping the encoded bytes and
decoding in Rust — needs an image-decoding crate and a per-format support matrix
for something the webview already decodes to display the image.

**D5 — Supported sources are `data:image/*` only.** Every image the transcript
renders today is a data URI: `convert-message.ts` builds
`` `data:${c.mediaType};base64,${c.data}` ``, and `SessionAttachmentsGrid`,
`TaskAttachments`, and `ImageViewer` all do the same. `http(s)` sources stay
unsupported per the brief's "do not fetch on right-click" ruling; `file://` and
asset-protocol sources are unsupported because nothing in the transcript produces
them.

**D6 — `ElectronAdapter` reports `canWriteImage: false`.** The Electron shell is
legacy and its preload exposes no clipboard image API; adding one is not in scope.
Its `writeImage` rejects, and the capability flag means the UI never calls it.

## Interfaces this change adds

```ts
// packages/types/src/host/host-bridge.ts — added to HostBridge
clipboard: {
  /** True when the host can put a bitmap on the system clipboard. Read before
   *  rendering clipboard affordances — never probe by calling and catching. */
  readonly canWriteImage: boolean;
  /** rgba is width*height*4 bytes, row-major, non-premultiplied. */
  writeImage(rgba: Uint8Array, width: number, height: number): Promise<void>;
};
```

```ts
// packages/ui/src/lib/clipboard/image-source.ts
export type ImageSourceKind = 'data-url' | 'remote' | 'unsupported';
export function classifyImageSource(src: string): ImageSourceKind;
export function decodeDataUrl(src: string): { mediaType: string; bytes: Uint8Array } | null;
export function canCopyImage(src: string, host: Pick<HostBridge, 'clipboard'>): boolean;

// packages/ui/src/lib/clipboard/decode-image.ts
export function decodeToRgba(
  bytes: Uint8Array, mediaType: string,
): Promise<{ rgba: Uint8Array; width: number; height: number }>;

// packages/ui/src/lib/clipboard/copy-image.ts
export type CopyImageResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported-host' | 'unsupported-source' | 'decode-failed' | 'write-failed'; message: string };
export function copyImageToClipboard(
  src: string, host: Pick<HostBridge, 'clipboard' | 'log'>,
): Promise<CopyImageResult>;
```

---

## Group 1 — `host-port-ts` (core) · depends on: nothing

### Task 1 — Add `clipboard` to the host contract

**File:** `packages/types/src/host/host-bridge.ts`

Add the `clipboard` member to `HostBridge` exactly as written in *Interfaces*
above, placed after `shell` and before `notify`. Doc-comment says why the flag is a
readonly property and not a probe: browser mode must be able to hide the affordance
*before* render.

No Zod schema is added to `host-contract.ts` — those schemas exist for the Electron
`ipcMain` handlers, and D6 means Electron never receives this payload.

**Verify:** `pnpm --filter @qlan-ro/mainframe-types build` succeeds. The UI
typecheck fails at this point (three adapters do not implement the new member) —
that is expected until Task 3.

### Task 2 — Renderer→Tauri call

**File:** `packages/ui/src/lib/tauri/bridge.ts`

Add, following the file's existing `IS_TAURI` guard convention:

```ts
export async function clipboardWriteImage(rgba: Uint8Array, width: number, height: number): Promise<void> {
  if (!IS_TAURI) throw new Error('clipboard.writeImage is not available outside the Tauri webview');
  await invoke<void>('clipboard_write_image', rgba.slice().buffer, {
    headers: { 'x-image-width': String(width), 'x-image-height': String(height) },
  });
}
```

`rgba.slice()` guarantees the ArrayBuffer holds exactly the pixel bytes: canvas
`getImageData().data` may be a view into a larger buffer, and `invoke` sends the
whole buffer. `@tauri-apps/api@2.11.1` types `InvokeArgs` as
`Record<string, unknown> | number[] | ArrayBuffer | Uint8Array` and `InvokeOptions`
as `{ headers: HeadersInit }`, so this is the supported raw-body form.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` reports no error in this
file.

### Task 3 — Implement `clipboard` in all three adapters

**Files:**
- `packages/ui/src/lib/host/tauri-adapter.ts` — `clipboard = { canWriteImage: true, writeImage: (rgba, w, h) => bridge.clipboardWriteImage(rgba, w, h) };`
- `packages/ui/src/lib/host/electron-adapter.ts` — `canWriteImage: false`; `writeImage` returns a rejected promise with a message naming the host (mirror the existing not-supported style in that file).
- `packages/ui/src/lib/host/fake-adapter.ts` — `canWriteImage` reads `this.overrides.clipboard?.canWriteImage ?? false`; `writeImage` delegates to `this.overrides.clipboard?.writeImage` when set, otherwise `notSupported('clipboard.writeImage')`.

Also extend `FakeHostOverrides` in `fake-adapter.ts`:

```ts
clipboard?: {
  canWriteImage?: boolean;
  writeImage?: (rgba: Uint8Array, width: number, height: number) => Promise<void>;
};
```

This override is load-bearing: without it no jsdom test can reach the menu at all,
because the fake host's default is "no capability".

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes clean.

---

## Group 2 — `tauri-clipboard-command` (core) · depends on: nothing

### Task 4 — Add the clipboard plugin and the write command

**Files:**
- `packages/app-tauri/src-tauri/Cargo.toml` — add `tauri-plugin-clipboard-manager = "2"` to `[dependencies]` (+ the resulting `Cargo.lock` churn).
- `packages/app-tauri/src-tauri/src/commands/clipboard.rs` — **new.**
- `packages/app-tauri/src-tauri/src/commands/mod.rs` — `pub mod clipboard;` + `pub use clipboard::clipboard_write_image;`.
- `packages/app-tauri/src-tauri/src/lib.rs` — add `clipboard_write_image` to the `use commands::{…}` list and to `tauri::generate_handler![…]`; add `.plugin(tauri_plugin_clipboard_manager::init())` to the builder chain beside the other `.plugin(...)` calls.

`clipboard.rs`:

```rust
use tauri::image::Image;
use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Refuse absurd payloads before allocating: 64 MiB of RGBA is a ~4000×4000 image.
const MAX_RGBA_BYTES: usize = 64 * 1024 * 1024;

#[tauri::command]
pub fn clipboard_write_image(app: tauri::AppHandle, request: Request<'_>) -> Result<(), String> { … }
```

Behavior, in order:
1. `request.body()` must be `InvokeBody::Raw`; anything else is an error naming the
   expected form.
2. Parse `x-image-width` / `x-image-height` headers as `u32` via a small private
   helper (`header_u32(&request, name) -> Result<u32, String>`); a missing or
   unparsable header is an error.
3. Reject `width == 0`, `height == 0`, `rgba.len() > MAX_RGBA_BYTES`, or
   `rgba.len() != width * height * 4` (compute in `usize` with `checked_mul` so a
   hostile header cannot overflow).
4. `app.clipboard().write_image(&Image::new(rgba, width, height))`, mapping the
   error to a `String` (Tauri commands returning `Result<_, String>` is the
   established convention in `commands/fs.rs`).

No capability entry is needed in `src-tauri/capabilities/main.json`: app-defined
commands are not permission-gated (the existing `read_file` / `terminal_create`
commands have no entry either), and the plugin's own JS commands are never invoked
from the renderer.

**Verify:** `cargo check` from `packages/app-tauri/src-tauri` passes (cold build —
see Constraints). `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`
on the same directory are clean.

---

## Group 3 — `clipboard-core-tests` (test) · depends on: `host-port-ts`

Two of these three files are **red-phase** — the modules they import do not exist
yet, and Group `clipboard-lib` implements against them. The third is green-phase,
verifying Group `host-port-ts`. State that expectation in each file's header
comment so a reader is not confused by a mixed run.

### Task 5 — Pure source-classification and gating tests (RED)

**File:** `packages/ui/src/lib/clipboard/__tests__/image-source.test.ts` — **new.**

Cover, with hardcoded expectations (no logic mirrored from the implementation):
- `classifyImageSource` → `'data-url'` for `data:image/png;base64,…` and
  `data:image/jpeg;base64,…`; `'remote'` for `http://…` and `https://…`;
  `'unsupported'` for `file:///…`, `blob:…`, `asset://…`, `''`, and a
  non-image data URI (`data:text/plain;base64,…`).
- `decodeDataUrl` → `{ mediaType: 'image/png', bytes }` for a known 1×1 PNG data
  URI, asserting the first eight bytes are the PNG signature
  (`137 80 78 71 13 10 26 10`) and the byte length matches the base64 payload;
  `null` for a non-base64 data URI (`data:image/svg+xml,<svg/>`), for a
  non-image data URI, and for malformed base64.
- `canCopyImage` truth table over `{data-url, remote} × {canWriteImage true,false}`
  — only `data-url` + `true` is `true`.

### Task 6 — Copy orchestration tests (RED)

**File:** `packages/ui/src/lib/clipboard/__tests__/copy-image.test.ts` — **new.**

`vi.mock('../decode-image')` so no real canvas is needed. A hand-built host stub
provides `clipboard` and a `log` spy. Cases:
- Host without capability → `{ ok: false, reason: 'unsupported-host' }`, and
  `decodeToRgba` and `writeImage` are never called.
- `https://…` source → `{ ok: false, reason: 'unsupported-source' }`, nothing
  called.
- Happy path → `decodeToRgba` receives the decoded bytes and the media type from
  the data URI; `writeImage` receives exactly those `rgba`, `width`, `height`;
  result is `{ ok: true }`.
- `decodeToRgba` rejects → `{ ok: false, reason: 'decode-failed' }` with a
  non-empty `message`, and `host.log` was called at `warn` (the no-silent-catch
  rule), and `writeImage` was never called.
- `writeImage` rejects → `{ ok: false, reason: 'write-failed' }` with a non-empty
  `message` and a `warn` log.

### Task 7 — Decoder and adapter delegation tests

**Files:**
- `packages/ui/src/lib/clipboard/__tests__/decode-image.test.ts` — **new** (RED).
  jsdom has no image decoding, so stub the DOM seam: replace
  `HTMLImageElement.prototype.decode` with a resolver that sets `naturalWidth` /
  `naturalHeight`, and stub `HTMLCanvasElement.prototype.getContext` to return a
  fake 2d context whose `getImageData` yields a known `Uint8ClampedArray`. Assert:
  the returned `rgba`/`width`/`height` match the fake; the object URL created for
  the blob is revoked on both the success and the failure path (spy on
  `URL.createObjectURL` / `URL.revokeObjectURL`); a rejecting `decode()` propagates
  as a rejection; a `null` 2d context rejects with a message.
- `packages/ui/src/lib/host/__tests__/tauri-adapter.test.ts` — **edit** (GREEN).
  One case: `clipboard.canWriteImage === true`, and `clipboard.writeImage(rgba, 2, 1)`
  invokes `'clipboard_write_image'` with an `ArrayBuffer` of `byteLength === 8` and
  headers `{ 'x-image-width': '2', 'x-image-height': '1' }`.
- `packages/ui/src/lib/host/__tests__/fake-adapter.test.ts` — **edit** (GREEN).
  Two cases: default `canWriteImage === false` and `writeImage` rejects; with
  `{ clipboard: { canWriteImage: true, writeImage: spy } }` overrides,
  `canWriteImage === true` and the spy receives the arguments.

**Verify (whole group):** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/host/__tests__/tauri-adapter.test.ts src/lib/host/__tests__/fake-adapter.test.ts`
is green; the three `src/lib/clipboard/__tests__/*` files fail on missing modules.

---

## Group 4 — `clipboard-lib` (core) · depends on: `clipboard-core-tests`, `host-port-ts`

### Task 8 — `image-source.ts`

**File:** `packages/ui/src/lib/clipboard/image-source.ts` — **new.**

Pure, no DOM. `classifyImageSource` matches `^data:image\/[a-zA-Z0-9.+-]+;base64,`
for `'data-url'` and `^https?:` for `'remote'`; everything else is
`'unsupported'`. `decodeDataUrl` splits on the first `,`, verifies the prefix
shape, `atob`s the payload inside a `try` (returning `null` on `InvalidCharacterError`
— a `/* expected */`-commented catch, since a malformed URI is data, not a fault),
and copies char codes into a `Uint8Array`. `canCopyImage` is the two-line
conjunction of the kind check and `host.clipboard.canWriteImage`.

**Verify:** `vitest run src/lib/clipboard/__tests__/image-source.test.ts` green.

### Task 9 — `decode-image.ts`

**File:** `packages/ui/src/lib/clipboard/decode-image.ts` — **new.**

`decodeToRgba(bytes, mediaType)`:
1. `const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }))` —
   blob URLs are same-origin, so the canvas is never tainted.
2. `const img = new Image(); img.src = url; await img.decode();` — `decode()` over
   `createImageBitmap`/`OffscreenCanvas` because it is supported by all three
   webviews the shell ships on.
3. Draw onto a `document.createElement('canvas')` sized to
   `naturalWidth × naturalHeight`; throw when either is `0` or `getContext('2d')`
   returns `null`.
4. Return `{ rgba: new Uint8Array(imageData.data.buffer.slice(0)), width, height }`.
5. `URL.revokeObjectURL(url)` in a `finally`.

Keep it under 50 lines; if it crowds, extract the canvas step into a private
helper in the same file.

**Verify:** `vitest run src/lib/clipboard/__tests__/decode-image.test.ts` green.

### Task 10 — `copy-image.ts`

**File:** `packages/ui/src/lib/clipboard/copy-image.ts` — **new.**

`copyImageToClipboard(src, host)` implements the ladder the Task 6 tests pin:
capability gate → source gate → `decodeToRgba` (catch → `decode-failed`) →
`host.clipboard.writeImage` (catch → `write-failed`). Every catch calls
`host.log('warn', 'clipboard', …)` before returning; the returned `message` is the
error's message, or a fixed fallback for a non-`Error` throw. No toast here — the
component owns user-facing feedback so this module stays callable outside React.

**Verify:** `vitest run src/lib/clipboard/__tests__/copy-image.test.ts` green, and
`pnpm --filter @qlan-ro/mainframe-ui typecheck` passes.

---

## Group 5 — `menu-tests` (test) · depends on: `clipboard-lib`, `host-port-ts`

### Task 11 — `ImageContextMenu` behavior + both render paths (RED)

**File:** `packages/ui/src/features/chat/parts/__tests__/ImageContextMenu.test.tsx` — **new.**

Red-phase against Group `image-context-menu`; it imports the real
`lib/clipboard/image-source` (already built) and mocks
`@/lib/clipboard/copy-image` and `@/lib/toast`. A helper installs a capable host
via `setHostForTesting(new FakeHostBridge({ clipboard: { canWriteImage: true, writeImage: vi.fn() } }))`
and `resetHostForTesting()` in `afterEach`. Radix context menus open on
`fireEvent.contextMenu(element)` — the pattern proven in
`features/sessions/sidebar/__tests__/SessionContextMenu.test.tsx`. Use a real 1×1
PNG data URI constant for the copyable source.

Cases:
1. **Capable host + data URI** — right-clicking the wrapped child opens
   `chat-image-context-menu` containing `chat-image-copy` with the text
   `Copy Image`.
2. **Capable host + `https://…` source** — no `chat-image-context-menu` after
   `fireEvent.contextMenu`, and the child still renders.
3. **Host without the capability + data URI** — same: no menu, child renders.
4. **Copy succeeds** — clicking `chat-image-copy` calls `copyImageToClipboard`
   once with the src, and `mfToast.error` is never called.
5. **Copy fails** — `copyImageToClipboard` resolves
   `{ ok: false, reason: 'write-failed', message: 'boom' }`; `mfToast.error` is
   called once, and its options carry `description: 'boom'`.
6. **Assistant-image path** — render `<ZoomableImage src={PNG_DATA_URI} />`, click
   `chat-image-zoom-trigger`, await `chat-image-zoom-dialog`, then
   `fireEvent.contextMenu` on `chat-image-zoom-image` → `chat-image-context-menu`
   appears. (Satisfies "the attachment/assistant render path gets the menu".)
7. **User-gallery path** — render `<ImageLightbox images={[{ src: PNG_DATA_URI }]} index={0} onIndexChange={vi.fn()} />`,
   `fireEvent.contextMenu` on `image-lightbox-current` → `chat-image-context-menu`
   appears. (Satisfies the second required render path.)
8. **Menu dismissal does not dismiss the lightbox** — with the `ZoomableImage`
   dialog open and the menu open, press `Escape` once: the menu closes and
   `chat-image-zoom-dialog` is still in the DOM. Then assert a plain click on
   `chat-image-zoom-image` (no menu open) still closes the dialog, so the existing
   dismissal contract survives the `asChild` wrap.

**Verify:** the file fails on the missing `../ImageContextMenu` module; the three
existing part tests (`ZoomableImage.test.tsx`, `ImageLightbox.test.tsx`,
`markdown-text.test.tsx`) still pass untouched — the fake host's default
`canWriteImage: false` means they render exactly as before.

---

## Group 6 — `image-context-menu` (ui) · depends on: `menu-tests`, `clipboard-lib`, `host-port-ts`

Read the `mainframe-design-system` skill before writing any markup here.

### Task 12 — `ImageContextMenu.tsx`

**File:** `packages/ui/src/features/chat/parts/ImageContextMenu.tsx` — **new.**

```tsx
interface ImageContextMenuProps { src: string; children: ReactNode }
```

`useHost()` first (the only hook, so the early return below is safe), then
`if (!canCopyImage(src, host)) return <>{children}</>;` — D2's "no menu at all".
Otherwise the shadcn `ContextMenu` / `ContextMenuTrigger asChild` /
`ContextMenuContent className="w-44"` / one `ContextMenuItem`, mirroring
`EditorContextMenu`'s item markup exactly:

```tsx
<ContextMenuItem data-testid="chat-image-copy" onSelect={() => void handleCopy()}>
  <Copy size={13} className="text-muted-foreground" />
  Copy Image
</ContextMenuItem>
```

`data-testid="chat-image-context-menu"` goes on `ContextMenuContent` (D3). No
separator and no reserved second group. `handleCopy` awaits
`copyImageToClipboard(src, host)` and, on `!ok`, fires
`mfToast.error('Could not copy the image', { description: result.message })` —
`mfToast`, never `sonner` directly. Success is silent.

**Verify:** cases 1–5 of Task 11 pass.

### Task 13 — Wrap the lightbox image

**File:** `packages/ui/src/features/chat/parts/LightboxSurface.tsx`

Wrap the existing `<img>` in `<ImageContextMenu src={src}>…</ImageContextMenu>`.
Leave `imageRef`, `data-testid={imageTestId}`, the classes, and `handleClick`
untouched: Radix's `asChild` slot composes the ref, so
`event.target === imageRef.current` still identifies the image and click-to-dismiss
still works. Add nothing to the props interface — the surface already receives
`src`.

**Verify:** cases 6–8 of Task 11 pass; `vitest run src/features/chat/parts/__tests__/ZoomableImage.test.tsx src/features/chat/parts/__tests__/ImageLightbox.test.tsx`
still green.

### Task 14 — Changeset and full verification

**File:** `.changeset/<generated>.md` — **new.**

`pnpm changeset`, patch bump for `@qlan-ro/mainframe-ui`,
`@qlan-ro/mainframe-types`, and `@qlan-ro/mainframe-app-tauri`. Summary: one line
stating that right-clicking an opened image offers Copy Image.

**Verify:**
- `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/clipboard src/lib/host src/features/chat/parts`
- `git status` shows no stray files; no `@ts-ignore`, no `console.*` added, no file
  over 300 lines (`wc -l` on every touched file).

---

## QA smoke (for the qa stage, not this plan's tasks)

1. `pnpm tauri:dev` from `packages/app-tauri` with an isolated `MAINFRAME_DATA_DIR`
   and `DAEMON_PORT` (per the memory note on production takeover).
2. Send a screenshot to a session, open the resulting image in the transcript,
   right-click it → menu appears at the pointer, not clipped by the lightbox box.
3. Click **Copy Image**, paste into Preview (⌘N) → the bitmap appears, correct
   colors and dimensions, no alpha inversion.
4. Right-click the *thumbnail* (not the opened image) → no menu (webview default).
5. Right-click transcript text, a code block, and the composer → unchanged.
6. Close the menu with Escape and with an outside click → the lightbox stays open;
   clicking the image itself still closes the lightbox.
7. Browser mode (`vite` without Tauri) → right-clicking the opened image shows the
   webview's own menu, no app menu, no console error.

## Risks

- **The raw-body invoke (`tauri::ipc::Request` + headers) is unproven in this
  repo.** `@tauri-apps/api@2.11.1` types it and the shell already uses the raw
  *response* form (`InvokeResponseBody::Raw`) for the terminal, but the request
  direction is new here. It is verified by `cargo check` plus QA step 3. If it
  fails, the fallback is a base64 RGBA string argument plus a hand-rolled Rust
  decoder mirroring `base64_encode` in `commands/fs.rs` — same shape, one extra
  encode/decode hop.
- **Radix menu inside a Radix dialog.** Both portal to `document.body` at `z-50`;
  the menu mounts later so it stacks above. Covered by Task 11 case 8 and QA
  step 6.
- **jsdom cannot decode images**, so `decode-image.ts` is only covered against
  stubbed DOM APIs. The real decode is proven by QA step 3, not by unit tests.
- **Cold Rust build cost** in this worktree (see Constraints).
