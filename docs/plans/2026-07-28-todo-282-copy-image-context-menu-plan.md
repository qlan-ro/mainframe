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
- **The worktree has no `node_modules`, and nothing outside the task graph installs
  them.** The lane's only setup step creates the worktree and stamps the tracker, so
  the install needs an owner *inside* the graph: **Task 1 runs `pnpm install` from
  the worktree root as its first step.** No other task re-runs it.
- **The group graph is a pure chain; no two groups ever run at once.** Each group
  names its predecessor in `depends_on`, including
  `copy-menu-shared-tests → clipboard-lib`, which is a scheduling edge rather than a
  code one. Two shared-worktree hazards force it. First, `pnpm install` must not run
  twice at once in one workspace, and Task 1 owns the only install. Second, **every
  group commits, and `.husky/pre-commit` runs `npx lint-staged`** — concurrent
  commits in one worktree commingle each other's staged files, a failure this repo
  has already paid for once. Serializing costs one wave: the only two groups that
  could have overlapped were `clipboard-lib` and `copy-menu-shared-tests`.
- **Which groups run the package-wide typecheck.**
  `pnpm --filter @qlan-ro/mainframe-ui typecheck` compiles the whole package, test
  files included, so it cannot pass in a group that has just committed red tests
  importing modules that do not exist yet: `clipboard-core-tests` (Tasks 1-3) and
  `menu-tests` (Task 10) must **not** run it. **Every other group must.** Because
  the graph is serialized, no other group's files are ever mid-edit, so
  `clipboard-lib`, `copy-menu-shared-tests` and `copy-menu-shared` each compile the
  package cleanly and a type error surfaces in the group that owns the file instead
  of in the last wave. Each group below states its own exit contract, and Task 13
  runs the final package-wide typecheck once everything has landed.
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

| Call site | Route | Verified by |
|---|---|---|
| `features/chat/messages/AssistantMessage.tsx` | `ZoomableImage` | Task 10 case 6 |
| `features/chat/messages/InlineImageThumbs.tsx` | `ImageLightbox` | Task 10 case 7 |
| `features/viewers/ImageViewer.tsx:151` | `ZoomableImage` | the same `ZoomableImage` Task 10 case 6 drives; `viewers/__tests__/ImageViewer.test.tsx` mocks it, so that suite is a regression guard, not menu coverage |
| `features/tasks/TaskAttachments.tsx:224` | `ImageLightbox` | QA step 4 only — no unit suite exists |
| `features/context-panel/SessionAttachmentsGrid.tsx:85` | `ImageLightbox` | `context-panel/__tests__/SessionAttachmentsGrid.test.tsx` (renders the real `ImageLightbox`) |

Scope that a decision accepts has to be scope the verification reaches, so the last
three rows are what Task 13's vitest invocation and QA step 4 now name explicitly.

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

The same reasoning deletes `classifyImageSource` and its `ImageSourceKind` union.
`'remote'` and `'unsupported'` are never told apart in production — D5 makes both
non-copyable — and the union's only consumer, `canCopyImage`, collapses the result
to a boolean. It would exist solely to be asserted. `canCopyImage(src)` is therefore
the data-URL regex test AND `imageClipboardSupported()`, and nothing else is
exported. The source kinds do not go untested: they stay as rows of Task 1's truth
table, which is where the gating rule belongs.

The same call, applied once more: **`writeImageToClipboard` takes `src` alone.** The
earlier `writeImageToClipboard(src, decoded)` carried the same image twice and used
each half on a different branch — `decoded.bytes` only when the media type is
`image/png`, `src` only on the canvas re-encode — while `copy-image.ts` called
`decodeDataUrl(src)` unconditionally. Every JPEG, webp or gif copy therefore paid a
full base64 → `Uint8Array` decode that the write discarded and re-derived from `src`
through the canvas. The tell was the doc comment: a signature needed prose to say
which of two representations of one image was the real one. So `write-image.ts` reads
the media type off the `data:` prefix and calls `decodeDataUrl` only on the PNG
branch, throwing when it returns `null`. That throw still precedes
`navigator.clipboard.write`, so the "never touch the clipboard with a malformed
source" property survives and the message still reaches the toast — `copy-image.ts`
wraps the call in a `try` and maps a synchronous throw through the same failure path
as a rejection. `DecodedDataUrl` leaves the cross-module contract: it is now
`decodeDataUrl`'s return type, read once inside `write-image.ts`, and nothing else
passes it around.

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

**D15 — Markdown images get no menu; the design gate's "satisfied by construction"
is wrong on the facts, and the gap is moot here.** The brief required "both the
attachment-image and markdown-image render paths"; the gate waved markdown through
on the grounds that both open through `LightboxSurface`. They do not.
`features/chat/parts/markdown-text.tsx` maps no `img` component — its component map
(lines 107-160) covers headings, `p`, `a`, lists, tables, `code` and the fenced-block
slots — and `UserMessage`'s map overrides only `p` on top of it
(`features/chat/messages/UserMessage.tsx:91`). A markdown image therefore renders as
react-markdown's bare `<img>`, never reaching `ZoomableImage` or `LightboxSurface`,
so it gets no menu and no test asserts one.

Moot in practice, because a markdown image here can only be `http(s)`:
`urlTransform` (`features/chat/parts/markdown-url-transform.ts:26`) admits a fixed
app-protocol list and otherwise defers to react-markdown's `defaultUrlTransform`,
which returns `''` for every protocol outside `https?|ircs?|mailto|xmpp` —
`data:` included (`react-markdown@10.1.0/lib/index.js:421`). So a markdown
`data:image/…` renders with an empty `src`, and a markdown `http(s)` image is exactly
the source D5 leaves unsupported. Every image the menu could serve arrives as an
attachment or an image part instead.

Same shape as D1's `AttachmentPreviewDialog` gap, and recorded rather than buried:
covering markdown would need an `img` entry in the markdown component map *and* the
remote-fetch ruling the brief deferred. That is separate work.

## Interfaces this change adds

```ts
// packages/ui/src/lib/clipboard/image-source.ts
export interface DecodedDataUrl { mediaType: string; bytes: Uint8Array<ArrayBuffer> }
export function decodeDataUrl(src: string): DecodedDataUrl | null;
export function imageClipboardSupported(): boolean;
export function canCopyImage(src: string): boolean;

// packages/ui/src/lib/clipboard/write-image.ts
/** Throws (synchronously, before any clipboard call) when `src` cannot be decoded. */
export function writeImageToClipboard(src: string): Promise<void>;

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

**Exit contract for this group** (it overrides the generic "typecheck + affected
tests green"):

- **Done** = the three test files below are written and committed, and the run
  named under *Verify* fails for exactly the stated reason.
- **Do not run `pnpm --filter @qlan-ro/mainframe-ui typecheck`.** It is
  package-wide and would report `TS2307` on `../image-source`, `../write-image`
  and `../copy-image` — modules this group is not allowed to create. `clipboard-lib`
  runs the first passing package-wide typecheck, and Task 13 the last (Constraints).
- **Do not create `image-source.ts`, `write-image.ts` or `copy-image.ts`, not even
  as empty stubs, to make the imports resolve.** Those three files belong to group
  `clipboard-lib`; touching them here breaks the no-shared-files assumption that
  `parallel_safe` rests on and hands `clipboard-lib` a file it did not write.

### Task 1 — Install the workspace, then decode and gating tests (RED)

**First step, before anything else in this group:** run `pnpm install` from the
worktree root. It is the only install in the whole graph (Constraints); every later
group inherits `node_modules` from it, and `copy-menu-shared-tests` depends on this
group so it cannot race the install.

**File:** `packages/ui/src/lib/clipboard/__tests__/image-source.test.ts` — **new**
(node environment; no DOM).

Cover, with hardcoded expectations (no logic mirrored from the implementation):
- `decodeDataUrl` → `{ mediaType: 'image/png', bytes }` for a known 1×1 PNG data
  URI, asserting the first eight bytes are the PNG signature
  (`137 80 78 71 13 10 26 10`) and the byte length matches the base64 payload;
  `null` for a non-base64 data URI (`data:image/svg+xml,<svg/>`), for a non-image
  data URI, and for malformed base64.
- `imageClipboardSupported` → `false` with no `ClipboardItem` global; `false` with
  `ClipboardItem` present but no `navigator.clipboard.write`; `true` with both.
  Install and remove the globals with `vi.stubGlobal` / `vi.unstubAllGlobals`.
- `canCopyImage` truth table — the sources crossed with host support. Sources:
  `data:image/png;base64,…` and `data:image/jpeg;base64,…` (copyable);
  `http://…`, `https://…`, `file:///…`, `blob:…`, `asset://…`, `''`, and a non-image
  data URI (`data:text/plain;base64,…`) (not copyable). Every source is `false` when
  `imageClipboardSupported()` is `false`; only the two `data:image/*` rows are `true`
  when it is. This is the gate D11 makes authoritative and the only place the source
  kinds are asserted, since `classifyImageSource` no longer exists (D11).

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

**No object-URL stubs are needed.** `reencodeToPng` assigns the source `data:` URL
straight to `img.src` (Task 5), so nothing in this module calls
`URL.createObjectURL` — which is just as well, since this repo's jsdom (29.1.1)
defines neither `createObjectURL` nor `revokeObjectURL`, and `vi.spyOn` throws on a
property that does not exist.

**`decode()` has that same gap; `naturalWidth` does not.** Verified against this
repo's jsdom: `HTMLImageElement.prototype.decode` is `undefined`, so install it by
assignment and delete it in teardown, while `naturalWidth`/`naturalHeight` are real
prototype accessors and take an ordinary getter spy. The `decode` stub is also where
the JPEG case reads `this.src`, since the `<img>` is never in the document:

```ts
let seenSrc = '';
beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn(function (this: HTMLImageElement) {
    seenSrc = this.src;
    return Promise.resolve();
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(2);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1);
});
afterEach(() => Reflect.deleteProperty(HTMLImageElement.prototype, 'decode'));
```

Every call passes the data URL and nothing else: `writeImageToClipboard(PNG_DATA_URI)`.
The module decodes on the PNG branch itself (D11), so this suite uses the real
`image-source` — do not mock it.

Cases:
- **PNG passthrough:** calls `write` once with a single `ClipboardItem`; the item's
  `image/png` value resolves to a `Blob` of `type === 'image/png'` and a `size`
  equal to the fixture's known decoded byte length (hardcode it; do not recompute it
  with `atob`); no canvas is touched (spy on `document.createElement` or on the
  stubbed `getContext`).
- **Activation ordering:** `navigator.clipboard.write` has already been called
  **synchronously** when `writeImageToClipboard` returns — assert the spy's call
  count is 1 before awaiting the returned promise. This is the test that pins the
  user-activation requirement from D4; without it a later refactor to `async`
  silently breaks copy in WebKit.
- **JPEG re-encode:** with the `decode`/`naturalWidth` stubs above,
  `HTMLCanvasElement.prototype.getContext` stubbed to a fake 2d context with a
  `drawImage` spy, and `HTMLCanvasElement.prototype.toBlob` stubbed to hand back a
  PNG blob: `writeImageToClipboard(JPEG_DATA_URI)` still calls `write`
  synchronously, and the item's value resolves to the re-encoded PNG blob. Also
  assert `seenSrc === JPEG_DATA_URI` — the `<img>` gets the original data URL, which
  is what replaces the object-URL round trip. **And assert no decode happened on
  this path:** the non-PNG branch never touches `decodeDataUrl` (D11) — spy on
  `atob` and assert it was not called.
- **Re-encode failure:** a `decode` stub that rejects makes the promise
  `writeImageToClipboard` returned reject too (via the adopting `write` stub above).
  Same for a `null` 2d context and for a `toBlob` that yields `null`.
- **Malformed base64 PNG source** (`data:image/png;base64,!!!`, which `decodeDataUrl`
  cannot decode): `expect(() => writeImageToClipboard(BAD_PNG_DATA_URI)).toThrow()`
  with a non-empty message, **and `navigator.clipboard.write` was never called.**
  This is the "never touch the clipboard with a malformed source" property; it moved
  here from Task 3 with the decode (D11). The throw is synchronous, so assert it with
  `toThrow`, not `rejects`.

### Task 3 — Copy orchestration tests (RED)

**File:** `packages/ui/src/lib/clipboard/__tests__/copy-image.test.ts` — **new**
(node environment).

`vi.mock('../write-image')` is the **only** mock this file needs and no DOM is
required: after D11, `copy-image.ts` imports nothing but `writeImageToClipboard` —
the source gate is `canCopyImage`'s (Task 1's truth table) and the decode is
`write-image`'s. Per D11 there are no host/source-kind cases here either. Cases:
- **Happy path** → `writeImageToClipboard` receives the src unchanged as its **only**
  argument (`toHaveBeenCalledWith(PNG_DATA_URI)`); the result is `{ ok: true }` with
  no `message`.
- **Synchronous write** → `writeImageToClipboard` has been called once before the
  returned promise is awaited (the D4 activation rule, pinned at this layer too).
- **`writeImageToClipboard` throws synchronously** (`new Error('bad source')` — the
  decode failure it raises before touching the clipboard) → `copyImageToClipboard`
  resolves `{ ok: false, message: 'bad source' }` rather than propagating the throw,
  and logs one tagged `console.warn` (spy on it — the no-silent-catch rule). This is
  what pins the `try` around the call; without it a malformed source throws out of
  the menu's `handleCopy`.
- **`writeImageToClipboard` rejects with `new Error('boom')`** →
  `{ ok: false, message: 'boom' }` and one tagged `console.warn`.
- **A non-`Error` rejection** (`Promise.reject('nope')`) still produces a non-empty
  `message`.

**Verify (whole group):** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/clipboard`
reports all three files as failed **suites**, each with a
`Failed to resolve import "../image-source"` / `"../write-image"` / `"../copy-image"`
error — the modules do not exist yet. That, and nothing else, is the expected red.
No other suite in the package changes. If a file fails for any other reason, fix
the test; if any file passes, it is asserting nothing.

---

## Group 2 — `clipboard-lib` (core) · depends on: `clipboard-core-tests`

**Exit contract for this group:**

- **Done** = the three modules below exist and are committed, the whole
  `src/lib/clipboard` suite is green (Task 6's *Verify*), and
  `pnpm --filter @qlan-ro/mainframe-ui typecheck` **passes**. This group owns the
  three files Group 1's red tests import, so it is the first point at which the
  package compiles again and the first place a type error in them can surface. Run
  it here; do not defer it to Task 13.
- Nothing else in the package is mid-edit: the graph is serialized (Constraints), so
  a failure in this typecheck is this group's own.
- **Touch nothing outside `packages/ui/src/lib/clipboard/`.** The test files stay as
  Group 1 committed them; if one of them looks wrong, the implementation is wrong.

### Task 4 — `image-source.ts`

**File:** `packages/ui/src/lib/clipboard/image-source.ts` — **new.**

Pure, no DOM writes. Three exports and one module-level constant — the copyable-source
regex, `/^data:image\/[a-zA-Z0-9.+-]+;base64,/`, which is not exported and has no
classifier wrapped around it (D11). `decodeDataUrl` splits on the
first `,`, verifies the prefix shape, `atob`s the payload inside a `try`
(returning `null` on `InvalidCharacterError` — an `/* expected */`-commented catch,
since a malformed URI is data, not a fault), and copies char codes into a
`new Uint8Array(len)`, whose inferred type is already `Uint8Array<ArrayBuffer>` —
declare the return that way (as `DecodedDataUrl`) and no copy is needed.
`imageClipboardSupported` is the two-term global check from D6 — guard both terms so
it is safe to call in a node test. `canCopyImage(src)` is one line:
`COPYABLE_SRC.test(src) && imageClipboardSupported()`.

**Verify:** `vitest run src/lib/clipboard/__tests__/image-source.test.ts` green.

### Task 5 — `write-image.ts`

**File:** `packages/ui/src/lib/clipboard/write-image.ts` — **new.**

```ts
export function writeImageToClipboard(src: string): Promise<void> {
  const png = src.startsWith('data:image/png;base64,')
    ? Promise.resolve(pngBlobFromDataUrl(src))
    : reencodeToPng(src);
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

function pngBlobFromDataUrl(src: string): Blob {
  const decoded = decodeDataUrl(src);
  if (!decoded) throw new Error('That image could not be decoded.');
  return new Blob([decoded.bytes], { type: 'image/png' });
}
```

**Only the PNG branch decodes** (D11), and `decodeDataUrl` is imported from
`./image-source` — it stays there, node-tested by Task 1. The media type comes off
the `data:` prefix, which `canCopyImage`'s regex
(`/^data:image\/[a-zA-Z0-9.+-]+;base64,/`) already guarantees is present, so a PNG
source is exactly `data:image/png;base64,…`; every other source goes to the canvas,
which reads `src` and never needs the bytes. The `throw` is synchronous and precedes
`navigator.clipboard.write`, so a malformed source never reaches the clipboard, and
its message is what `copy-image.ts` puts in the toast.

The `Uint8Array<ArrayBuffer>` annotation on `DecodedDataUrl.bytes` is what lets the
`Blob` construction typecheck (Constraints). One comment, on the promise value:
WebKit accepts only `image/png` on write, and takes a promise so the re-encode can
finish after the user gesture. Private `reencodeToPng(src: string): Promise<Blob>`:
1. `const img = new Image(); img.src = src; await img.decode();` — `decode()` over
   `createImageBitmap`/`OffscreenCanvas` because every webview the shell ships on
   supports it.
2. Draw onto a `document.createElement('canvas')` sized to
   `naturalWidth × naturalHeight`; throw when either is `0` or `getContext('2d')`
   returns `null`.
3. `canvas.toBlob(resolve, 'image/png')`, rejecting when it yields `null`.

**The re-encode loads the original `data:` URL directly; it does not rebuild a
`Blob` and an object URL from the bytes it was just handed.** `src` is a
`data:image/*` URL by construction — `canCopyImage` is the only gate and it admits
nothing else (D5) — the shell's CSP already allows it
(`img-src 'self' blob: data:` in `packages/app-tauri/src-tauri/tauri.conf.json:31`),
and a `data:` URL does not taint the canvas, so `toBlob` succeeds. Reusing it drops
an allocation, the `URL.createObjectURL`/`revokeObjectURL` pair and the `finally`
that had to balance them, plus the jsdom stubs those forced on Task 2.

Keep each function under 50 lines; if `reencodeToPng` crowds, split the canvas step
into a second private helper in the same file.

**Verify:** `vitest run src/lib/clipboard/__tests__/write-image.test.ts` green.

### Task 6 — `copy-image.ts`

**File:** `packages/ui/src/lib/clipboard/copy-image.ts` — **new.**

The exact ladder the Task 3 tests pin, and nothing more (D11 — no host or
source-kind re-check, and no decode: this module imports only
`writeImageToClipboard`). One call, wrapped in a `try`, with `.then(onOk, onErr)`
rather than `await` (D4's activation rule; carry one comment saying so):

```ts
export function copyImageToClipboard(src: string): Promise<CopyImageOutcome> {
  try {
    return writeImageToClipboard(src).then(() => ({ ok: true }), onErr);
  } catch (err) {
    return Promise.resolve(onErr(err));
  }
}
```

- `writeImageToClipboard` throws (the decode failure it raises before touching the
  clipboard) or its promise rejects → both land in one private
  `onErr(err: unknown): CopyImageOutcome`, which logs
  `console.warn('[copy-image] copy failed', err)` — the tagged-warn idiom
  `lib/editor/copy-reference.ts` already uses in this package — and returns
  `{ ok: false, message }`, where `message` is `err.message` when it is a non-empty
  `Error` message and `'The clipboard refused the image.'` otherwise.
- success → `{ ok: true }`.

The `catch` exists because the throw is synchronous: `.then(onOk, onErr)` cannot see
it, and an uncaught throw would escape `handleCopy` in `ImageContextMenu`.

No toast here: the component owns user-facing feedback so this module stays callable
outside React.

**Verify (whole group):**

- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/clipboard` all green —
  the clipboard suite, and nothing wider.
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes (the group's exit contract).
  It is package-wide, which is the point: no other group is running, and these three
  modules are what Group 1's tests could not resolve.

---

## Group 3 — `copy-menu-shared-tests` (test) · depends on: `clipboard-core-tests`, `clipboard-lib`

Both edges are **scheduling, not code**: this group shares no file with either and
reads no output of either — nothing here needs `lib/clipboard`.
`clipboard-core-tests` owns the graph's one `pnpm install` (Task 1).
`clipboard-lib` is named because it and this group would otherwise be the graph's
only concurrent pair, racing twice in one worktree: over that install, and over
`.husky/pre-commit`'s `npx lint-staged`, which commingles the staged files of
concurrent commits (Constraints).

**Exit contract for this group:**

- **Done** = the three cases below are written and committed, cases 1-2 fail for the
  reason named under *Verify*, and case 3 plus every pre-existing case in the file
  pass.
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` **passes** and is run here. Unlike
  Groups 1 and 5, this group imports nothing that does not exist: the hook and its
  harness are already in the tree, and the new cases are red on *behavior*, not on a
  missing module.
- **Do not touch `lib/ui/use-menu-copy-feedback.ts`** — the generation token is
  Task 8's, in the next group.

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

**Verify:** `vitest run src/lib/ui/__tests__/use-menu-copy-feedback.test.tsx` — cases
1 and 2 fail on the Escape assertion (`keydown` was dispatched on `document`, because
today's hook re-arms `closeMenu` from the settlement), case 3 passes, and every
case that was already in the file still passes. The suite compiles: the hook it
imports already exists, so unlike Groups 1 and 5 there is no missing-module red here.
Do not touch `use-menu-copy-feedback.ts` — the generation token is Task 8's.

---

## Group 4 — `copy-menu-shared` (ui) · depends on: `copy-menu-shared-tests`

Read the `mainframe-design-system` skill before touching `CopyMenuItem`'s markup.

**Exit contract for this group:**

- **Done** = Tasks 8 and 9 are committed, the two *Verify* runs below are green with
  **no test file edited**, and `pnpm --filter @qlan-ro/mainframe-ui typecheck`
  **passes**. This group deletes `CopyPathItem` and rewrites two shipped menus under
  `noUnusedLocals: true` (`packages/ui/tsconfig.json:16`), so a stranded
  `Check`/`Copy`/`AlertTriangle`/`CopyStatus`/`ContextMenuItem` import is a
  compile error and this is the group that owns it. The graph is serialized, so
  nothing else is mid-edit.
- Migrating a menu's markup is behavior-preserving by definition here: if a shipped
  suite needs an edit to stay green, the extraction drifted — fix the extraction.

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

**Exit contract for this group:**

- **Done** = the one test file below is written and committed and fails for exactly
  the reason named under *Verify*.
- **Do not run `pnpm --filter @qlan-ro/mainframe-ui typecheck`** — package-wide, and
  it would report `TS2307` on `../ImageContextMenu`, which this group must not
  create. `image-context-menu` typechecks this file once it exists, and Task 13 runs
  the final package-wide typecheck (Constraints).
- **Do not create `ImageContextMenu.tsx`, not even as a stub, to make the import
  resolve, and do not edit `LightboxSurface.tsx`.** Both belong to group
  `image-context-menu`; writing them here breaks the no-shared-files assumption
  `parallel_safe` rests on.

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
4. **Copy succeeds, and the call is synchronous with the click** — this is the D4
   user-activation rule at the component layer. Fire `fireEvent.click(image-copy)`,
   then *immediately*, before any `await` or `waitFor`, assert `copyImageToClipboard`
   has been called exactly once with the src. Task 11's `handleCopy` is an `async`
   function; it satisfies D4 today only because the call precedes its first `await`,
   and one inserted `await` — a permission check, a config read — would silently
   break copy in WKWebView with every other assertion in this file still green.
   `ImageContextMenu.tsx` is the file in this change most likely to be edited later,
   so the rule is pinned at all three layers (Task 2, Task 3, and here). Only then
   await the item's text becoming `Copied`, and assert `mfToast.error` was never
   called.
5. **Copy fails** — `copyImageToClipboard` resolves `{ ok: false, message: 'boom' }`;
   the item's text becomes `Copy failed`, `mfToast.error` is called once, and its
   options carry `description: 'boom'`.
6. **Assistant image-part path** — render `<ZoomableImage src={PNG_DATA_URI} />`, click
   `chat-image-zoom-trigger`, await `chat-image-zoom-dialog`, then
   `fireEvent.contextMenu` on `chat-image-zoom-image` → `image-context-menu`
   appears. This covers the assistant turn's **image part** (`AssistantMessage`), not
   a markdown image — markdown images never reach `LightboxSurface` and get no menu
   (D15).
7. **User-gallery path** — render
   `<ImageLightbox images={[{ src: PNG_DATA_URI }]} index={0} onIndexChange={vi.fn()} />`,
   `fireEvent.contextMenu` on `image-lightbox-current` → `image-context-menu`
   appears. This covers the **user turn's attachment gallery** (`InlineImageThumbs`).
   Cases 6 and 7 are the two render paths this change covers, and they are the two
   the design gate named; the brief's third, markdown, is out per D15.
8. **Nested inside `MessagePathContextMenu` — the composition that actually ships.**
   Render
   `<MessagePathContextMenu><ZoomableImage src={PNG_DATA_URI} /></MessagePathContextMenu>`
   (`AssistantMessage.tsx:110` wraps every non-nested message's parts this way), open
   the lightbox, `fireEvent.contextMenu` on `chat-image-zoom-image`, and assert
   `image-context-menu` is in the DOM **and** `tool-card-path-copy-absolute` is not.
   Seed `useActiveBasesStore` and stub `window.getSelection` the way
   `messages/__tests__/MessagePathContextMenu.test.tsx` does — it renders the real
   component with the real zustand store.

   Case 6 renders `ZoomableImage` alone, so nothing there pins this. The lightbox is
   a Dialog portal, but **React synthetic events propagate through portals along the
   React tree**, so every right-click on the lightbox image also reaches
   `MessagePathContextMenu.handleContextMenu`, which runs `setPath(null)` and
   `suppressRadixTrigger`. Today only ordering keeps the two menus from both opening
   (see Task 11), and ordering is exactly the kind of thing a later refactor breaks
   silently — this repo already paid for nested triggers once in
   `parts/link-with-preview.tsx:82-85`.
9. **Menu dismissal does not dismiss the lightbox** — with the `ZoomableImage`
   dialog open and the menu open, press `Escape` once: the menu closes and
   `chat-image-zoom-dialog` is still in the DOM. Then assert a plain click on
   `chat-image-zoom-image` (no menu open) still closes the dialog, so the existing
   dismissal contract survives the `asChild` wrap.
10. **Dismissing the menu with an outside pointer does not dismiss the lightbox** —
   the interaction risk the design gate named, and the one QA step 6 would otherwise
   own alone. Open the `ZoomableImage` dialog and the menu as in case 9, let the
   pending timers run once (the suite uses
   `vi.useFakeTimers({ shouldAdvanceTime: true })` like
   `MessagePathContextMenu.test.tsx`; Radix registers its document `pointerdown`
   listener inside a `setTimeout(0)`, so the listener is not armed on the tick the
   menu opens), then `fireEvent.pointerDown(document.body)`. Assert the menu is gone
   and `chat-image-zoom-dialog` is **still** in the DOM.

   **Fire `pointerDown` only — do not follow it with a `click`.** In a browser,
   Radix's modal `DismissableLayer` sets `pointer-events: none` on `body` while the
   menu is open, so the closing click never reaches the dialog. jsdom does no
   hit-testing and ignores that style, so a synthetic `click` on the lightbox box
   would reach `LightboxSurface.handleClick`
   (`event.target === event.currentTarget`) and close the image for a reason that
   cannot happen in the shell. The full click sequence stays with QA step 6, in a
   real webview. If the pointerdown path still proves undrivable in jsdom (the
   listener does not close the menu after two flush attempts), do not silently drop
   this case: keep it as a `it.skip` naming the jsdom limitation, record the
   downgrade as a decision in the lane result, and leave QA step 6 as the only
   coverage.
11. **A copy that settles after the menu closed does not close the lightbox** (D13,
    the integration counterpart to Task 7). Open the `ZoomableImage` dialog and the
    menu, mock `copyImageToClipboard` to a **deferred** promise, click `image-copy`,
    press `Escape` to dismiss the menu only, then settle the deferred copy and
    `advanceTimersByTime(1000)`. Assert `chat-image-zoom-dialog` is **still** in the
    DOM. Without Task 8's token this test fails by closing the image.

**Verify:** `vitest run src/features/chat/parts/__tests__/ImageContextMenu.test.tsx`
fails as a **suite**, with `Failed to resolve import "../ImageContextMenu"` — that
one error is the whole expected red; no case should fail for any other reason. The
three existing part tests (`ZoomableImage.test.tsx`, `ImageLightbox.test.tsx`,
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

**The trigger gets no `onContextMenu` guard, unlike `link-with-preview.tsx:82-85`.**
State the reason in the file's header comment, because the absence is the surprising
part. This trigger nests inside `MessagePathContextMenu` (`AssistantMessage.tsx:110`)
and React carries the synthetic event through the Dialog portal to it, but the inner
trigger runs first and Radix's own `onContextMenu` ends with
`event.preventDefault()`; the outer trigger composes its handler with
`composeEventHandlers(props.onContextMenu, …, { checkForDefaultPrevented: true })`,
so the outer menu never opens. The outer's own `handleContextMenu` still runs, and
both of its effects are inert here: `setPath(null)` is a no-op state write, and
`suppressRadixTrigger` re-sets a flag already set. It cannot resolve a path either —
it looks one up with `closest('[data-file-path]')`, which walks the **DOM**, and the
lightbox image's DOM ancestry is the portal on `document.body`, not the message.
`link-with-preview` needed `stopPropagation` because it is a real trigger inside the
message's own DOM; this one is not. Task 10 case 8 is what keeps that true.

**Verify:** cases 1-5 of Task 10 pass.

### Task 12 — Wrap the lightbox image

**File:** `packages/ui/src/features/chat/parts/LightboxSurface.tsx`

Wrap the existing `<img>` in `<ImageContextMenu src={src}>…</ImageContextMenu>`.
Leave `imageRef`, `data-testid={imageTestId}`, the classes, and `handleClick`
untouched: Radix's `asChild` slot composes the ref, so
`event.target === imageRef.current` still identifies the image and click-to-dismiss
still works. Add nothing to the props interface — the surface already receives
`src`.

**Verify:** cases 6-11 of Task 10 pass;
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
- ```
  pnpm --filter @qlan-ro/mainframe-ui exec vitest run \
    src/lib/clipboard src/lib/ui src/features/chat/parts \
    src/features/chat/messages/__tests__/MessagePathContextMenu.test.tsx \
    src/features/viewers/__tests__/ImageViewer.test.tsx \
    src/features/context-panel/__tests__/SessionAttachmentsGrid.test.tsx
  ```
  **The last two files are the non-chat `LightboxSurface` callers D10 accepts**, and
  they were missing from this run while D10 claimed the scope. Task 12 rewraps a
  component all five call sites share, so the run has to reach past `features/chat`:
  - `SessionAttachmentsGrid.test.tsx:39-46` renders the real `ImageLightbox` and
    asserts `image-lightbox-dialog` after a thumb click, so it executes the rewrapped
    `LightboxSurface` — this is the one suite outside chat that actually exercises
    Task 12.
  - `ImageViewer.test.tsx:30-44` **mocks `@/features/chat/parts/ZoomableImage`** with
    a bare `<img>`, so it never reaches `LightboxSurface`. It runs here as the
    regression guard on the viewer's own render path and on the day that mock is
    dropped — not as coverage of the menu. Do not "fix" it by unmocking; that pulls
    the Radix dialog into a viewer suite for no gain.
  - **`TaskAttachments` has no unit suite at all** — the two files that name it mock
    it away, so no vitest invocation can reach `TaskAttachments.tsx:224`. **QA smoke
    step 4 is its only coverage**, which is where the file:line evidence lives. This
    change writes no new suite for it.
- `git status` shows no stray files; no file over 300 lines (`wc -l` on every touched
  file).
- **Hygiene is checked against added lines only** — `git diff main...HEAD | grep '^+'`
  — not against whole files. No `@ts-ignore`, and no `console.*` beyond the tagged
  warns this plan adds in `copy-image.ts`. One pre-existing tagged warn lives in a
  file Task 9 modifies:
  `packages/ui/src/features/chat/parts/link-with-preview.tsx:57`,
  `console.warn('[link-with-preview] openExternal failed', href)`. It is the required
  non-silent catch on the `openExternal` path, it is untouched by Task 9, and
  removing it would be a regression. A whole-file grep would block on it.

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
   Appendix A. **Price that round-trip honestly before taking it**: the lane contract
   allows exactly one qa→implement round-trip, and Appendix A is not a two-file swap.
   Beyond the wholly new files it adds (the `HostBridge.clipboard` port, the Tauri
   bridge call, the three adapters, the Rust command and its registration), it
   rewrites work the primary path already produced:

   | Rewritten | Why |
   |---|---|
   | `lib/clipboard/image-source.ts` | capability moves to `HostBridge.clipboard.canWriteImage`; `canCopyImage` becomes two-arg (A1/A4) |
   | `lib/clipboard/write-image.ts` → `decode-image.ts` | deleted and replaced (A5) |
   | `lib/clipboard/copy-image.ts` | gains a `host` parameter and a decode-failure message (A5) |
   | `features/chat/parts/ImageContextMenu.tsx` | calls `canCopyImage(src, useHost())` (Task 11) |
   | `src-tauri/tauri.conf.json` | the `connect-src` CSP token, app-wide blast radius (A2/D8) |
   | `__tests__/image-source.test.ts` | the `imageClipboardSupported` cases go away and the `canCopyImage` truth table is re-derived two-arg |
   | `__tests__/write-image.test.ts` → `decode-image.test.ts` | the whole file targets a module A5 deletes |
   | `__tests__/copy-image.test.ts` | mocks `../decode-image`, not `../write-image`; host arg; decode-failure case |
   | `__tests__/ImageContextMenu.test.tsx` | the `ClipboardItem` / `navigator.clipboard` global stubs no longer open the menu — the `FakeHostOverrides` extension in A4 does, which is why A4 calls it load-bearing |

   Untouched by the fallback: Tasks 7-9 (the `useMenuCopyFeedback` generation token
   and the `CopyMenuItem` extraction) and Task 12 (the `LightboxSurface` wrap).
   Task 13 re-runs with the changeset widened to `@qlan-ro/mainframe-types` and
   `@qlan-ro/mainframe-app-tauri`, and QA step 8 — the packaged-build smoke — becomes
   mandatory rather than conditional. No fallback task graph is enumerated here on
   purpose: the fallback is contingent, so the implementer sequences Appendix A's
   sections (A2 first, then A1 → A3 → A4 → A5 → A6) when and only when this gate
   fails.
   **BLOCKED** — if the shell cannot be driven (no interactive session, no macOS
   host, `tauri:dev` will not start): do **not** report PASS. Hand off to a human
   with these exact steps and the fixture, and mark the lane `blocked` with
   `blocked_reason: "D7 webview clipboard gate needs an interactive macOS shell"`.
   An unverified PASS is the one outcome this gate exists to prevent.
4. Right-click the *thumbnail* (not the opened image) → no menu (webview default).
   Then open an image attachment from a **task** (Tasks panel → a task carrying an
   image → the attachment opens in `ImageLightbox`) and right-click it → the menu
   appears and Copy Image works. **This is the only coverage `TaskAttachments` gets.**
   It has no unit suite: the two files that name it,
   `features/tasks/__tests__/TaskEditModal.test.tsx:42-44` and
   `features/tasks/__tests__/TasksSidebarSection.test.tsx:70-72`, both mock it away,
   so no vitest run in Task 13 reaches `TaskAttachments.tsx:224`. If no task with an
   image attachment is reachable, attach one first rather than skipping the step —
   this is one of the three non-chat call sites D10 accepts.
5. Right-click transcript text, a code block, and the composer → unchanged.
6. Close the menu with Escape and with an outside click → the lightbox stays open;
   clicking the image itself still closes the lightbox. The outside *click* is the
   half Task 10 case 10 cannot reach — jsdom ignores the `pointer-events: none` Radix
   puts on `body` — so this step is its only coverage; run it deliberately. Then
   click **Copy Image** and immediately press Escape; wait two seconds → the lightbox
   is still open (D13).
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
  9-11, and QA step 6. Case 10 covers outside-pointer dismissal only as far as jsdom
  allows — a real closing *click* is gated by `pointer-events: none`, which jsdom
  does not honor, so that half stays with QA step 6.
- **`CopyMenuItem` touches two shipped menus.** The migration is behavior-preserving
  and pinned by their existing suites, which must pass **unedited** (Task 9). Any
  needed test edit is a signal the extraction drifted.
- **jsdom cannot decode or write images**, so `write-image.ts` is only covered
  against stubbed DOM APIs. The real write is proven by QA step 3, not by unit
  tests.

---

## Appendix A — fallback: host port + Rust clipboard command

**Execute only if the QA gate (smoke step 3) fails.** Much of this appendix is new
code, but it also rewrites four source files and four test files the primary path
already produced, changes the app's CSP, and makes the packaged-build QA step
mandatory — the table under QA step 3's FAIL branch is the authoritative delta; read
it before committing to this path. Budget one cold
`cargo` build (multi-GB `src-tauri/target` in this worktree, per the Disk Hygiene
section of `CLAUDE.md`).

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

`decodeToRgba(src: string): Promise<{ rgba: Uint8Array<ArrayBuffer>; width: number; height: number }>`
is A5's version of Task 5's `reencodeToPng`: the same `img.src = src` →
`img.decode()` → canvas pipeline off the original data URL, ending at
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
