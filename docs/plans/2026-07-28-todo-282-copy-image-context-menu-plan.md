# Todo #282 — Right-click an opened image to copy it

**Route:** no-spec (this plan works directly from the approved Agent Brief + the 2026-07-28 Design direction)
**Branch:** `todo/282-copy-image-context-menu` · **Worktree:** `.worktrees/todo-282-copy-image-context-menu`

## Goal

An image the user opens has no context menu, so there is no way to get the bitmap
onto the system clipboard — text copies fine, binary image data does not. This
change wraps the one `<img>` inside `LightboxSurface` — the choke point both zoom
paths route through (`ZoomableImage`, `ImageLightbox`) — in a shadcn `ContextMenu`
carrying a single **Copy Image** item. Clicking it writes the image to the system
clipboard through the webview's own async Clipboard API (`navigator.clipboard.write`
with a `ClipboardItem`), the same API the transcript already uses to copy text, so
pasting into Preview or Slack yields the image, not a URL. No IPC, no Rust, no host
port. The menu mounts only when the source is copyable (`data:image/*`) *and* the
webview advertises image-clipboard support; otherwise `ImageContextMenu` renders its
children bare and right-click falls through exactly as it does today. The item
reports its own outcome inline (Copy Image → Copied / Copy failed) through the
shared `useMenuCopyFeedback` hook, and a failure additionally raises an `mfToast`
carrying the reason. Because `LightboxSurface` is shared, the menu also reaches the
file viewer and the task/session attachment grids — an accepted scope expansion,
recorded as D10.

## Constraints

- **`CLAUDE.md`:** max 300 lines/file, 50 lines/function; `data-testid` on every
  interactive element (`<surface>-<element>` kebab-case); tests required for new
  core logic; no silent catches; extract shared helpers at 3+ duplications;
  changeset required before commit.
- **`packages/ui/CLAUDE.md`:** shadcn primitives, never raw Radix; read the
  `mainframe-design-system` skill before writing markup or class names; pure logic
  lives outside React.
- **Design gate (2026-07-28)** is authoritative where it and the brief disagree —
  see D1/D2 below. Where this plan departs from the gate, D9 records why.
- **Vitest project split** (`packages/ui/vitest.config.ts`): `*.test.tsx` runs in
  jsdom, `*.test.ts` in node. A `.test.ts` that touches DOM APIs must carry a
  `// @vitest-environment jsdom` pragma — `write-image.test.ts` needs it, the other
  two do not.
- **TypeScript is 6.0.3** (root `package.json`, `packages/ui/package.json`). Its
  `lib.dom.d.ts` declares `BlobPart → BufferSource → ArrayBufferView<ArrayBuffer>`,
  so a bare `Uint8Array` (i.e. `Uint8Array<ArrayBufferLike>`) is **not** assignable
  to a `Blob` constructor argument. Every byte-carrying signature in this plan is
  therefore declared `Uint8Array<ArrayBuffer>`. Verified by compiling both forms
  with the repo's own `tsc`: the annotated form is clean, the bare form is `TS2322`.
- **Every file this plan touches is comfortably under the line limits.** Largest
  edited file: `LightboxSurface.tsx` (42 → ~48). Every new file lands well under
  300; every new function under 50.
- **The worktree has no `node_modules`.** Run `pnpm install` from the worktree root
  before the first task.
- **The implement stage needs no Rust and never runs `cargo`.** The one step that
  does — the D7 webview gate — is a **qa-stage** step, not an implement task
  (D14). Its cost is stated there: a cold `packages/app-tauri/src-tauri` build in
  this worktree, multi-GB per the Disk Hygiene section of `CLAUDE.md`, followed by
  a sweep. Appendix A (the fallback) is the only thing that adds Rust *source*, and
  it runs only if that gate fails.

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

**D3 — Testids are surface-neutral: `image-context-menu` on the menu *content*,
`image-copy` on the item.** Two departures from the design direction, both forced:

1. *Not `chat-*`.* `LightboxSurface` is reached from four non-chat call sites
   (D10), so a `chat-` prefix would put `chat-image-copy` on the file viewer, the
   tasks panel, and the context panel — against the `<surface>-<element>` rule and
   misleading for every future e2e selector. The neutral pair matches
   `ImageLightbox`'s own `image-lightbox-*` ids. Renaming after merge would churn
   spec files, so it is done now.
2. *Not on the trigger.* The direction put the first id on the trigger, but the
   trigger is the `<img>`, which already carries `imageTestId`
   (`chat-image-zoom-image` / `image-lightbox-current`) that existing tests assert
   on; one element cannot hold two testids.

Neither id is keyed by a message/attachment id because the lightbox renders exactly
one image at a time — there is no list and no index to disambiguate, and threading
an id through three call sites to satisfy the letter of the rule buys nothing.

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
taken on faith: **the QA-stage webview gate** (see *QA smoke*, step 3) verifies a
real paste in the shell before the change can ship, and Appendix A specifies the
fallback in full.

**D5 — Supported sources are `data:image/*` only, normalized to PNG.** Every image
the transcript renders today is a data URI: `convert-message.ts` builds
`` `data:${c.mediaType};base64,${c.data}` ``, and `SessionAttachmentsGrid`,
`TaskAttachments`, and `ImageViewer` all do the same. `http(s)` sources stay
unsupported per the brief's "do not fetch on right-click" ruling; `file://` and
asset-protocol sources are unsupported because nothing in the transcript produces
them. WebKit accepts only `image/png` on write, so a `data:image/jpeg` (or webp,
or gif) source is re-encoded to PNG through a canvas before the write — see
Task 5.

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

**D7 — The webview write is gated by a real paste before the change ships.** The
webview path is the whole change; if WKWebView refuses the write, four of this
plan's files are dead. So the *cheap* path is built and proven in the running shell
before any Rust exists, and Appendix A — the host port plus the Rust command — is
executed only if that gate fails. The gate lives in the qa stage (D14) and is
specified as QA smoke step 3, with a machine-checkable pasteboard assertion. Its
outcome is recorded as a decision in the lane result either way.

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
menu adopts the hook: the item reads Copy Image → **Copied** / **Copy failed** and
the menu self-closes after ~900 ms. The failure toast is kept on top of the inline
state because it is the only place the *reason* fits. This also fixes the icon:
the design direction wrote `<Copy size={13} className="text-muted-foreground" />`,
but every ContextMenu copy item in the repo uses `className="mr-2 size-3.5"` with
no colour override; the image menu matches its neighbours. Reusing the hook forces
two follow-on decisions, D12 and D13.

**D10 — Scope: the menu reaches every `LightboxSurface` caller, not only the
transcript.** The brief scoped the menu to "images inside the transcript" and the
design gate named the two chat paths. `LightboxSurface` is shared, so wrapping it
also puts the menu on:

| Call site | Route |
|---|---|
| `features/chat/messages/AssistantMessage.tsx` | `ZoomableImage` |
| `features/chat/messages/InlineImageThumbs.tsx` | `ImageLightbox` |
| `features/viewers/ImageViewer.tsx:151` | `ZoomableImage` |
| `features/tasks/TaskAttachments.tsx:224` | `ImageLightbox` |
| `features/context-panel/SessionAttachmentsGrid.tsx:85` | `ImageLightbox` |

**Accepted, not worked around.** All five render the same `data:image/*` sources
(`ImageViewer`'s own header documents its `src` as `data:image/...;base64,...`), so
the behavior is identical everywhere and the action is correct on each. Narrowing
it back to chat would mean a prop threaded through three call sites to *disable* a
working feature. The scope note the gate cared about is the *thumbnail* boundary —
still honored: no thumbnail anywhere gets a menu. Consequence for D3: the testids
must be surface-neutral.

**D11 — One gate, one result shape.** `canCopyImage(src)` is the single
authoritative gate; `copyImageToClipboard` does not re-check the host or the source
kind. The earlier `CopyImageResult` union carried `reason: 'unsupported-host' |
'unsupported-source' | 'write-failed'`, but `ImageContextMenu` is the only caller
and it mounts the item only when `canCopyImage` is true, so the first two variants
were unreachable in production and existed only to be asserted. The module now
returns `{ ok: boolean; message?: string }` — the shape this codebase already uses
for text (`writeToClipboard(text): Promise<boolean>` in
`lib/editor/copy-reference.ts:117`, which logs a tagged warn and resolves false),
widened only so the `DOMException` message can reach the toast description.
`useMenuCopyFeedback.onCopySelect` consumes `result.ok` directly.

**D12 — `CopyMenuItem` is extracted and all three copy menus migrate in this pass.**
The item markup (`copied → Check` / `failed → AlertTriangle` / `idle → Copy`, plus
the label ternary) already exists twice —
`features/chat/messages/MessagePathContextMenu.tsx:39-58` (`CopyPathItem`) and
`features/chat/parts/link-with-preview.tsx:90-95`. The image menu would be the
third, which `CLAUDE.md` ("extract shared helpers at 3+ duplications") forbids. It
moves to `lib/ui/CopyMenuItem.tsx`, beside `use-menu-copy-feedback.ts`, which
already owns `CopyStatus`. `link-with-preview.tsx` migrates in the same pass rather
than being left as a fourth copy: leaving it is exactly the leftover `CLAUDE.md`
rules out, and its item is structurally identical (only the label differs).

**D13 — `useMenuCopyFeedback` gains a generation token; the stray-Escape race is
fixed in the hook, not worked around in `ImageContextMenu`.** The hook's
`onCopySelect` re-arms `setTimeout(closeMenu, delayMs)` inside `run().then(...)`
with no invalidation (`lib/ui/use-menu-copy-feedback.ts:56-61`), while
`handleOpenChange(false)` clears only the timer that exists at that instant
(lines 38-43); `closeMenu` dispatches a document-level Escape keydown (line 34).
Radix's `DismissableLayer` gates Escape on `index === layers.size - 1`, so with the
menu open the menu absorbs it — which is why the hook's two existing consumers
never saw this. Inside a Dialog it bites: if the user dismisses the menu after
clicking Copy Image but before the copy settles (the JPEG canvas re-encode, or a
slow rejected write on an unfocused WKWebView document), the late settlement
schedules an Escape that fires with the menu unmounted, the lightbox Dialog is then
the highest layer, and **the image closes by itself ~900 ms later**. Fix: capture a
generation counter at select time, bump it in `handleOpenChange(false)`, and drop
settlements whose generation is stale. Fixing it in the hook costs three lines and
protects the two existing consumers from the same bug the day either of them is
nested in a dialog.

**D14 — The webview gate belongs to the qa stage; the implement stage completes
`unverified`.** The gate is a human-driven shell run: `pnpm tauri:dev`, right-click,
Copy Image, paste. The lane contract's implement exit criteria are groups done +
typecheck/tests + commits, with no slot for a manual gate, and the qa stage's
"failures route back to the implementer once" is precisely the Appendix A escape
hatch. So there is no implement task group for it — it is QA smoke step 3, with a
machine-checkable pasteboard assertion and an explicit blocked path. This also keeps
the implement stage free of `cargo`: the gate's cold `src-tauri` build is a
multi-GB, qa-stage cost (Disk Hygiene), swept afterwards.

## Interfaces this change adds

```ts
// packages/ui/src/lib/clipboard/image-source.ts
export type ImageSourceKind = 'data-url' | 'remote' | 'unsupported';
export function classifyImageSource(src: string): ImageSourceKind;
export function decodeDataUrl(src: string): { mediaType: string; bytes: Uint8Array<ArrayBuffer> } | null;
export function imageClipboardSupported(): boolean;
export function canCopyImage(src: string): boolean;

// packages/ui/src/lib/clipboard/write-image.ts
export function writeImageToClipboard(bytes: Uint8Array<ArrayBuffer>, mediaType: string): Promise<void>;

// packages/ui/src/lib/clipboard/copy-image.ts
/** `message` is present only on failure, and only when a reason is worth showing. */
export interface CopyImageOutcome { ok: boolean; message?: string }
/** Assumes `canCopyImage(src)` — the single gate (D11). */
export function copyImageToClipboard(src: string): Promise<CopyImageOutcome>;

// packages/ui/src/lib/ui/CopyMenuItem.tsx
export function CopyMenuItem(props: {
  testId: string;
  label: string;
  status: CopyStatus;
  onSelect: (event: Event) => void;
}): React.ReactElement;
```

`Uint8Array<ArrayBuffer>`, not `Uint8Array`, is load-bearing — see Constraints.
`new Uint8Array(len)` already produces that type, so no defensive copy is needed
anywhere.

`copyImageToClipboard` and `writeImageToClipboard` are **not** `async` functions.
WebKit requires `navigator.clipboard.write` to run under the user activation of the
click that triggered it, and an `await` before the call ends that activation.
Everything up to the write is synchronous; the re-encode for non-PNG sources rides
inside the `ClipboardItem` value as a promise, which is the form WebKit documents
for exactly this case.

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
  only `data-url` + supported is `true`. This is the gate D11 makes authoritative,
  so the table is the only place the gating rule is asserted.

### Task 2 — Clipboard write tests (RED)

**File:** `packages/ui/src/lib/clipboard/__tests__/write-image.test.ts` — **new.**
First line: `// @vitest-environment jsdom` (see Constraints).

**Stub shape is prescribed, not left to the implementer.** `ClipboardItem` is a
class that stores its constructor argument; `navigator.clipboard.write` **adopts**
the item's `image/png` value rather than ignoring it:

```ts
class FakeClipboardItem {
  constructor(readonly values: Record<string, Blob | Promise<Blob>>) {}
}
const write = vi.fn(async (items: FakeClipboardItem[]): Promise<void> => {
  await items[0]!.values['image/png'];
});
```

That mirrors WebKit, which rejects `write()` when a value promise rejects. A plain
spy would orphan the rejection inside the fake item: the promise
`writeImageToClipboard` returns would never adopt it, the "a rejecting decode()
rejects the returned promise" case would fail, and the rejection would surface as an
unhandled rejection. **Do not repair that by awaiting the blob before calling
`write`** — that destroys the synchronous-write property the activation-ordering
case below exists to protect. (The equivalent alternative, if the adopting stub
proves awkward: assert rejection on the *stored* value and assert invocation
separately. Pick one and say which in the file header.)

The async body of `write` still records its call synchronously, so the activation
assertion holds.

Cases:
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
- **Re-encode failure:** a rejecting `decode()` rejects the promise
  `writeImageToClipboard` returned (via the adopting stub above), and the object URL
  is still revoked. Same for a `null` 2d context and for a `toBlob` that yields
  `null`.

### Task 3 — Copy orchestration tests (RED)

**File:** `packages/ui/src/lib/clipboard/__tests__/copy-image.test.ts` — **new**
(node environment).

`vi.mock('../write-image')` so no DOM is needed; use the real `image-source`. Per
D11 there are no host/source-kind cases here — that gate is Task 1's truth table.
Cases:
- **Happy path** → `writeImageToClipboard` receives exactly the decoded bytes and
  the media type from the data URI; the result is `{ ok: true }` with no `message`.
- **Synchronous write** → `writeImageToClipboard` has been called once before the
  returned promise is awaited (the D4 activation rule, pinned at this layer too).
- **Malformed base64 data URI** (`decodeDataUrl` returns `null`) →
  `{ ok: false }` with a non-empty `message`; `writeImageToClipboard` is never
  called; one tagged `console.warn` (spy on it — the no-silent-catch rule).
- **`writeImageToClipboard` rejects with `new Error('boom')`** →
  `{ ok: false, message: 'boom' }` and one tagged `console.warn`.
- **A non-`Error` rejection** (`Promise.reject('nope')`) still produces a non-empty
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
`new Uint8Array(len)`, whose inferred type is already `Uint8Array<ArrayBuffer>` —
declare the return that way and no copy is needed. `imageClipboardSupported` is the
two-term global check from D6 — guard both terms so it is safe to call in a node
test. `canCopyImage` is the conjunction of the kind check and
`imageClipboardSupported()`.

**Verify:** `vitest run src/lib/clipboard/__tests__/image-source.test.ts` green.

### Task 5 — `write-image.ts`

**File:** `packages/ui/src/lib/clipboard/write-image.ts` — **new.**

```ts
export function writeImageToClipboard(bytes: Uint8Array<ArrayBuffer>, mediaType: string): Promise<void> {
  const png =
    mediaType === 'image/png'
      ? Promise.resolve(new Blob([bytes], { type: 'image/png' }))
      : reencodeToPng(bytes, mediaType);
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
```

The `Uint8Array<ArrayBuffer>` annotation is required for both `Blob` constructions
to typecheck (Constraints). One comment, on the promise value: WebKit accepts only
`image/png` on write, and takes a promise so the re-encode can finish after the user
gesture. Private
`reencodeToPng(bytes: Uint8Array<ArrayBuffer>, mediaType: string): Promise<Blob>`:
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

The exact ladder the Task 3 tests pin, and nothing more (D11 — no host or
source-kind re-check): `decodeDataUrl(src)` → `writeImageToClipboard`, with
`.then(onOk, onErr)` rather than `await` (D4's activation rule; carry one comment
saying so).

- `decodeDataUrl` returns `null` → `console.warn('[copy-image] could not decode the image source')`,
  then `{ ok: false, message: 'That image could not be decoded.' }`.
- write rejects → `console.warn('[copy-image] clipboard write failed', err)` — the
  tagged-warn idiom `lib/editor/copy-reference.ts` already uses in this package —
  then `{ ok: false, message }`, where `message` is `err.message` when it is a
  non-empty `Error` message and `'The clipboard refused the image.'` otherwise.
- success → `{ ok: true }`.

No toast here: the component owns user-facing feedback so this module stays callable
outside React.

**Verify:** `vitest run src/lib/clipboard` all green, and
`pnpm --filter @qlan-ro/mainframe-ui typecheck` passes.

---

## Group 3 — `copy-menu-shared-tests` (test) · depends on: nothing

### Task 7 — Stale-settlement tests for `useMenuCopyFeedback` (RED)

**File:** `packages/ui/src/lib/ui/__tests__/use-menu-copy-feedback.test.tsx` —
**modified** (the suite exists; append cases to the existing `describe`). Its
`Harness` already exposes a deferred `run`, an `item-a` button, and a `close-menu`
button that calls `handleOpenChange(false)`, and the file already runs on fake
timers — reuse all of it, add no new harness.

Red against Task 8's generation token. Three cases:
1. **Close before a successful settle** — click `item-a` with a deferred run, click
   `close-menu`, then settle `true` and `advanceTimersByTime(1000)`. Assert **no**
   Escape keydown was dispatched on `document` and `item-a` still reads `Copy A`.
   (Today the settlement re-arms the timer and one Escape fires — this is the bug
   D13 describes.)
2. **Close before a failed settle** — same, settling `false`. Same assertions; the
   failure path re-arms the same timer.
3. **A copy started *after* a close still reports** — click `close-menu` first, then
   click `item-a` and settle `true`; `item-a` reads `Copied` and exactly one Escape
   fires. This is the guard against a token that permanently poisons the hook.

**Verify:** cases 1-2 fail (an Escape is dispatched), case 3 passes; every existing
case in the file still passes.

---

## Group 4 — `copy-menu-shared` (ui) · depends on: `copy-menu-shared-tests`

Read the `mainframe-design-system` skill before touching `CopyMenuItem`'s markup.

### Task 8 — Generation token in `useMenuCopyFeedback`

**File:** `packages/ui/src/lib/ui/use-menu-copy-feedback.ts`

Add `const generationRef = useRef(0);`. `handleOpenChange(false)` increments it
before clearing the timer and resetting `settled`. `onCopySelect` captures
`const generation = generationRef.current` **outside** the `.then`, and the `.then`
returns early when `generation !== generationRef.current`, alongside the existing
`!mountedRef.current` guard. Extend the file's header comment by one sentence
saying why (a settlement that lands after the menu closed must not dispatch an
Escape — inside a Dialog the Dialog would eat it; D13). No API change: the three
returned members keep their signatures.

**Verify:** the whole `lib/ui/__tests__/use-menu-copy-feedback.test.tsx` suite is
green, including Task 7's three new cases.

### Task 9 — Extract `CopyMenuItem` and migrate both existing menus

**Files:**
- `packages/ui/src/lib/ui/CopyMenuItem.tsx` — **new.**
- `packages/ui/src/features/chat/messages/MessagePathContextMenu.tsx` — modified.
- `packages/ui/src/features/chat/parts/link-with-preview.tsx` — modified.

`CopyMenuItem` is `MessagePathContextMenu`'s current `CopyPathItem` moved verbatim
— same props, same icons, same class names, same label ternary — and re-exported
from `lib/ui/`, beside the hook that owns `CopyStatus` (D12):

```tsx
export function CopyMenuItem({ testId, label, status, onSelect }: CopyMenuItemProps) {
  return (
    <ContextMenuItem data-testid={testId} onSelect={onSelect}>
      {status === 'copied' && <Check className="mr-2 size-3.5 text-mf-success" />}
      {status === 'failed' && <AlertTriangle className="mr-2 size-3.5 text-destructive" />}
      {status === 'idle' && <Copy className="mr-2 size-3.5" />}
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : label}
    </ContextMenuItem>
  );
}
```

Then:
- `MessagePathContextMenu` deletes its local `CopyPathItem` and imports
  `CopyMenuItem`; both call sites keep their testids and labels
  (`Copy Absolute Path` / `Copy Relative Path`) unchanged.
- `link-with-preview.tsx` replaces its inlined copy item (lines 90-95) with `<CopyMenuItem testId="chat-link-copy" label="Copy link" status={menuStatus} onSelect={handleMenuCopy} />`.
  Keep the label string exactly `Copy link` —
  `features/chat/parts/__tests__/markdown-text.test.tsx:308-340` asserts it, along
  with `Copied` and the delayed close. Its second item (`chat-link-open`) is not a
  copy item and stays inline. Drop the now-unused `Check`/`Copy`/`AlertTriangle`
  imports from both files.

**Verify:**
`vitest run src/features/chat/messages/__tests__/MessagePathContextMenu.test.tsx src/features/chat/parts/__tests__/markdown-text.test.tsx`
green with no test edits — the migration is behavior-preserving, so a test change
here means the extraction changed something it should not have.

---

## Group 5 — `menu-tests` (test) · depends on: `clipboard-lib`, `copy-menu-shared`

### Task 10 — `ImageContextMenu` behavior + both render paths (RED)

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
   `image-context-menu` containing `image-copy` with the text `Copy Image`.
2. **Supported webview + `https://…` source** — no `image-context-menu` after
   `fireEvent.contextMenu`, and the child still renders.
3. **No `ClipboardItem` + data URI** — same: no menu, child renders.
4. **Copy succeeds** — clicking `image-copy` calls `copyImageToClipboard` once with
   the src; the item's text becomes `Copied`; `mfToast.error` is never called.
5. **Copy fails** — `copyImageToClipboard` resolves `{ ok: false, message: 'boom' }`;
   the item's text becomes `Copy failed`, `mfToast.error` is called once, and its
   options carry `description: 'boom'`.
6. **Assistant-image path** — render `<ZoomableImage src={PNG_DATA_URI} />`, click
   `chat-image-zoom-trigger`, await `chat-image-zoom-dialog`, then
   `fireEvent.contextMenu` on `chat-image-zoom-image` → `image-context-menu`
   appears. (Satisfies "the assistant/attachment render path gets the menu".)
7. **User-gallery path** — render
   `<ImageLightbox images={[{ src: PNG_DATA_URI }]} index={0} onIndexChange={vi.fn()} />`,
   `fireEvent.contextMenu` on `image-lightbox-current` → `image-context-menu`
   appears. (Satisfies the second required render path.)
8. **Menu dismissal does not dismiss the lightbox** — with the `ZoomableImage`
   dialog open and the menu open, press `Escape` once: the menu closes and
   `chat-image-zoom-dialog` is still in the DOM. Then assert a plain click on
   `chat-image-zoom-image` (no menu open) still closes the dialog, so the existing
   dismissal contract survives the `asChild` wrap.
9. **A copy that settles after the menu closed does not close the lightbox** (D13,
   the integration counterpart to Task 7). Open the `ZoomableImage` dialog and the
   menu, mock `copyImageToClipboard` to a **deferred** promise, click `image-copy`,
   press `Escape` to dismiss the menu only, then settle the deferred copy and
   `advanceTimersByTime(1000)`. Assert `chat-image-zoom-dialog` is **still** in the
   DOM. Without Task 8's token this test fails by closing the image.

**Verify:** the file fails on the missing `../ImageContextMenu` module; the three
existing part tests (`ZoomableImage.test.tsx`, `ImageLightbox.test.tsx`,
`markdown-text.test.tsx`) still pass untouched — jsdom has no `ClipboardItem`, so
they render exactly as before.

---

## Group 6 — `image-context-menu` (ui) · depends on: `menu-tests`, `clipboard-lib`, `copy-menu-shared`

Read the `mainframe-design-system` skill before writing any markup here.

### Task 11 — `ImageContextMenu.tsx`

**File:** `packages/ui/src/features/chat/parts/ImageContextMenu.tsx` — **new.**

```tsx
interface ImageContextMenuProps { src: string; children: ReactNode }
```

`useMenuCopyFeedback()` first (hooks before the early return), then
`if (!canCopyImage(src)) return <>{children}</>;` — D2's "no menu at all". Otherwise
the shadcn `ContextMenu onOpenChange={handleOpenChange}` /
`ContextMenuTrigger asChild` / `ContextMenuContent className="w-44"` holding one
`CopyMenuItem` (D12):

```tsx
<CopyMenuItem
  testId="image-copy"
  label="Copy Image"
  status={statusFor('image-copy')}
  onSelect={onCopySelect('image-copy', handleCopy)}
/>
```

`handleCopy` is the `() => Promise<boolean>` the hook expects: it awaits
`copyImageToClipboard(src)`, fires
`mfToast.error('Could not copy the image', { description: result.message })` when
`!result.ok` (`mfToast`, never `sonner` directly), and returns `result.ok`.
`data-testid="image-context-menu"` goes on `ContextMenuContent` (D3). No separator
and no reserved second group.

**Verify:** cases 1-5 of Task 10 pass.

### Task 12 — Wrap the lightbox image

**File:** `packages/ui/src/features/chat/parts/LightboxSurface.tsx`

Wrap the existing `<img>` in `<ImageContextMenu src={src}>…</ImageContextMenu>`.
Leave `imageRef`, `data-testid={imageTestId}`, the classes, and `handleClick`
untouched: Radix's `asChild` slot composes the ref, so
`event.target === imageRef.current` still identifies the image and click-to-dismiss
still works. Add nothing to the props interface — the surface already receives
`src`.

**Verify:** cases 6-9 of Task 10 pass;
`vitest run src/features/chat/parts/__tests__/ZoomableImage.test.tsx src/features/chat/parts/__tests__/ImageLightbox.test.tsx`
still green.

### Task 13 — Changeset and full verification

**File:** `.changeset/<generated>.md` — **new.**

`pnpm changeset`, patch bump for `@qlan-ro/mainframe-ui` only (no types or Rust
change on this path; if Appendix A is executed, extend the changeset to
`@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-app-tauri`). Summary: one line
stating that right-clicking an opened image offers Copy Image.

**Verify:**
- `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/clipboard src/lib/ui src/features/chat/parts src/features/chat/messages/__tests__/MessagePathContextMenu.test.tsx`
- `git status` shows no stray files; no `@ts-ignore`, no `console.*` outside the
  tagged warns in `copy-image.ts`, no file over 300 lines (`wc -l` on every touched
  file).

The implement stage ends here and is reported `unverified` (D14): the real
clipboard write has not yet been exercised in a webview.

---

## QA smoke (the qa stage owns these; step 3 is the D7 gate)

Steps 1-2 and 4-7 are ordinary smoke. **Step 3 is the gate**: if it fails, the
change does not ship on this path and QA routes back to the implementer once, with
Appendix A as the fix.

1. `pnpm tauri:dev` from `packages/app-tauri` with an isolated `MAINFRAME_DATA_DIR`
   and `DAEMON_PORT` (per the memory note on production takeover). **Cost:** the
   Rust build is cold in this worktree, and per the Disk Hygiene section of
   `CLAUDE.md` every `.worktrees/*` checkout that runs `cargo` grows its own
   multi-GB `target/`. The Rust *sources* are untouched, so this buys nothing but
   the shell. After the gate, run `cargo sweep --installed && cargo sweep --time 14`
   in `packages/app-tauri/src-tauri/target`, or `cargo clean --profile dev`, before
   leaving the worktree.
2. Send a screenshot to a session, open the resulting image, right-click it → menu
   appears at the pointer, not clipped by the lightbox box.
3. **Gate.** Click **Copy Image** → the item reads **Copied** and the menu closes on
   its own. Then assert the *native pasteboard*, not a screenshot:
   ```bash
   osascript -e 'set f to (open for access POSIX file "/tmp/mf282.png" with write permission)' \
             -e 'set eof f to 0' \
             -e 'write (the clipboard as «class PNGf») to f' \
             -e 'close access f'
   sips -g pixelWidth -g pixelHeight /tmp/mf282.png
   ```
   **PASS** = the `osascript` succeeds (the pasteboard actually holds `PNGf`, so the
   write landed as an image and not as text or a URL) **and** `sips` reports exactly
   the source image's known pixel dimensions. Use a fixture whose dimensions you
   recorded before the copy. Repeat with a JPEG-sourced image if one is reachable
   (the re-encode path).
   **FAIL** (`navigator.clipboard.write` rejects, the `osascript` errors with no
   `PNGf` on the pasteboard, or the dimensions differ) → capture the exact rejection,
   record it as the D7 outcome, and route back to the implementer to execute
   Appendix A. Tasks 1-3 and 10-12 survive unchanged in that case; only
   `write-image.ts` and the capability term of `image-source.ts` are replaced.
   **BLOCKED** — if the shell cannot be driven (no interactive session, no macOS
   host, `tauri:dev` will not start): do **not** report PASS. Hand off to a human
   with these exact steps and the fixture, and mark the lane `blocked` with
   `blocked_reason: "D7 webview clipboard gate needs an interactive macOS shell"`.
   An unverified PASS is the one outcome this gate exists to prevent.
4. Right-click the *thumbnail* (not the opened image) → no menu (webview default).
5. Right-click transcript text, a code block, and the composer → unchanged.
6. Close the menu with Escape and with an outside click → the lightbox stays open;
   clicking the image itself still closes the lightbox. Then click **Copy Image**
   and immediately press Escape; wait two seconds → the lightbox is still open (D13).
7. Browser mode (`vite` without Tauri, in Chromium) → the menu appears and the copy
   works (D6); no console error.
8. **Only if Appendix A was executed:** run steps 2-3 against a packaged build
   (`scripts/build-release-local.sh --tauri`), not `tauri:dev`. The dev server
   serves no CSP header, so the IPC transport differs from the shipped app and a
   dev-only smoke cannot see the failure D8 describes. Also re-smoke the terminal,
   file open, and daemon start/stop on that build, since the CSP change moves every
   invoke onto the custom-protocol transport.

## Risks

- **`navigator.clipboard.write` in WKWebView is the load-bearing assumption.**
  Mitigated by the QA gate (step 3, before ship) and by Appendix A being specified
  in full rather than discovered later. Evidence for it is in D4. The cost of a
  FAIL is one round-trip to the implementer, not a redesign.
- **Non-PNG sources ride the canvas re-encode**, whose promise is resolved after the
  user gesture. WebKit documents promise values for exactly this reason, but if it
  refuses, PNG (every screenshot, the dominant case) still works and the JPEG case
  surfaces as an honest "Copy failed" toast rather than a corrupt clipboard entry.
- **Radix menu inside a Radix dialog.** Both portal to `document.body` at `z-50`;
  the menu mounts later so it stacks above. Escape ordering is layer-based, which is
  what makes D13's late-settlement bug possible; covered by Task 7, Task 10 cases
  8-9, and QA step 6.
- **`CopyMenuItem` touches two shipped menus.** The migration is behavior-preserving
  and pinned by their existing suites, which must pass **unedited** (Task 9). Any
  needed test edit is a signal the extraction drifted.
- **jsdom cannot decode or write images**, so `write-image.ts` is only covered
  against stubbed DOM APIs. The real write is proven by QA step 3, not by unit
  tests.

---

## Appendix A — fallback: host port + Rust clipboard command

**Execute only if the QA gate (smoke step 3) fails.** Everything here is additive to
Tasks 1-3 and 10-12; `write-image.ts` and the capability term of `image-source.ts`
are replaced, `copy-image.ts` gains a `host` parameter, and `ImageContextMenu` calls
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
  writeImage(rgba: Uint8Array<ArrayBuffer>, width: number, height: number): Promise<void>;
};
```

`Uint8Array<ArrayBuffer>` for the same reason as the primary path (Constraints) —
the renderer builds this array from `ImageData` and hands it straight to `fetch`.

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
export async function clipboardWriteImage(
  rgba: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): Promise<void> {
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
- `packages/ui/src/lib/host/fake-adapter.ts` — `canWriteImage` reads `this.overrides.clipboard?.canWriteImage ?? false`; `writeImage` delegates to the override when set, otherwise `notSupported('clipboard.writeImage')`. Extend `FakeHostOverrides` with `clipboard?: { canWriteImage?: boolean; writeImage?: (rgba: Uint8Array<ArrayBuffer>, width: number, height: number) => Promise<void> }` — load-bearing, since without it no jsdom test can reach the menu.

Tests: `lib/host/__tests__/tauri-adapter.test.ts` gains one case (`clipboard.writeImage(rgba, 2, 1)` invokes `'clipboard_write_image'` with a `Uint8Array` of `byteLength === 8` and the two headers); `lib/host/__tests__/fake-adapter.test.ts` gains two (default rejects; override receives the arguments).

### A5 — RGBA decode in the renderer

**File:** `packages/ui/src/lib/clipboard/decode-image.ts` — replaces `write-image.ts`.

`decodeToRgba(bytes: Uint8Array<ArrayBuffer>, mediaType: string): Promise<{ rgba: Uint8Array<ArrayBuffer>; width: number; height: number }>`
is A5's version of Task 5's `reencodeToPng`: same object-URL → `img.decode()` →
canvas pipeline, ending at
`{ rgba: new Uint8Array(imageData.data.buffer.slice(0)), width, height }` instead of
`toBlob` — `buffer.slice(0)` yields a real `ArrayBuffer`, so the annotation holds
without a further copy. Its test file (`__tests__/decode-image.test.ts`, jsdom
pragma) mirrors Task 2 with `getImageData` in place of `toBlob`. `copy-image.ts`
gains a decode-failure message between the source gate and the write.

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
