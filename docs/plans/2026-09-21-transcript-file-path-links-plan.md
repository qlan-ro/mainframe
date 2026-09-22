# Todo #355 — transcript file paths open in the workspace

**Route:** no-spec (Agent Brief + Design direction, variant A).
**Form:** short plan. Estimated source diff ≈ 140 lines across 6 files; one implementation group.

## Goal

A markdown link in the transcript whose target is a file path must behave like a file reference, not a web
link: clicking it emits the existing `open-file` surface intent (forwarding `line`/`character` when the target
carries them) so the workspace surface comes forward with the file open, and its context menu offers **Open
file** + **Copy absolute path** / **Copy relative path** instead of "Copy link" / "Open link". This covers
absolute POSIX targets, project-relative targets and `file://` targets (the last of which the sanitiser
currently strips to a dead anchor). Genuine http(s) links, the localhost tunnel chip and the smart-action
chips are untouched. The presentation is the design-walk variant A: an inline `aui-md-a` link with a leading
`FileCode2` glyph, working identically in the four surfaces that render markdown outside the chat
smart-actions provider.

## Files

| File | Change |
| --- | --- |
| `packages/ui/src/lib/files/file-href.ts` *(new)* | Pure classifier `parseFileHref(href)` → `{ path, line?, character? } \| null`. The single predicate for "is this href a file reference". |
| `packages/ui/src/features/chat/parts/markdown-url-transform.ts` | Widen `urlTransform` to `(url, key)`; when `key === 'href'` and `parseFileHref(url)` is non-null, return `url` unchanged before falling through to `defaultUrlTransform`. |
| `packages/ui/src/features/chat/parts/FileRefLink.tsx` *(new)* | Variant-A anchor + its own context menu. Port of the prototype, with the stubs replaced by the real seams. |
| `packages/ui/src/features/chat/smart-actions/SmartLink.tsx` | New first branch: `parseFileHref(href)` non-null → `FileRefLink`. Localhost/web branches unchanged below it. |
| `packages/ui/src/features/chat/tools/chat-tool-context.ts` | `openFile(path, position?: { line: number; character: number })` — additive; the two existing call sites in `tools/shared/chrome.tsx` keep working. |
| `packages/ui/src/features/chat/messages/MessagePathContextMenu.tsx` | Add an **Open file** item above the copy group (a separator between), emitting `open-file` for the resolved `[data-file-path]`. |
| `.changeset/*.md` | Patch changeset for `@qlan-ro/mainframe-ui`. Exit criterion of the group, not a task. |
| Tests | `lib/files/__tests__/file-href.test.ts`, `chat/parts/__tests__/markdown-url-transform.test.ts` *(new file — none exists)*, `chat/parts/__tests__/file-ref-link.test.tsx`, one added case in `chat/messages/__tests__/MessagePathContextMenu.test.tsx`. |

`link-with-preview.tsx` is **not** in this list on purpose — see Risks.

## Design resolutions (decided here, not left to the implementer)

1. **One classifier, two callers.** The brief says to use "the shared file-reference helper" for the
   is-this-a-file decision, but `toFileRef` is a normaliser, not a predicate: `https://example.com` has no
   `file://` prefix and does not start with `/`, so it falls into the already-relative branch and comes back as
   a `FileRef` (`file-ref.ts:77-84`). The decision therefore lives in a new pure `parseFileHref`, and **both**
   `urlTransform` and `SmartLink` must call that same function — if the sanitiser and the dispatcher disagree,
   one of them renders a web link for something the other passed through as a path. `toFileRef` keeps its real
   job: turning the parsed path into the absolute/relative strings the menu copies and the testid uses. The
   visible link text stays exactly as authored (`{children}`) and is never relabelled from the helper — the
   brief's "use the helper for the display label" is satisfied by the menu and testid strings.
2. **`parseFileHref` rules** (rejects → `null`, so the link stays on today's web path):
   - empty, or starting with `#` or `?`;
   - any scheme other than `file:` — a scheme being `^[A-Za-z][A-Za-z0-9+.-]*:` appearing before the first `/`
     (so `http:`, `mailto:`, `slack:`, `vscode:` reject, while `/a/b.ts:42` and `src/a.ts:42` do not match the
     scheme shape at all);
   - a relative target whose first segment contains a dot, **does not start with `.`**, and has further
     segments (`example.com/page` is a hostname, not a path). The leading-dot exemption is load-bearing:
     without it the rule would reject `./x`, `../x` and every dotfile directory in this repo
     (`.github/pull_request_template.md`, `.agents/live-qa.md`, `.changeset/x.md`, `.claude/settings.json`),
     which carry no colon, so `defaultUrlTransform` passes them through untouched, `parseFileHref` would
     return `null`, and `SmartLink` would fall through to `LinkWithPreview` — whose click handler hands the
     bare filesystem path to `host.shell.openExternal` (`link-with-preview.tsx:56-64`), i.e. exactly the bug
     this todo fixes.
   Accepts: `file://…`, `/abs/path`, `./x`, `../x`, `.github/pull_request_template.md`, and relative
   `a/b.ts` / `README.md`. The trailing
   `:line` / `:line:col` suffix is split off the path and converted to the 0-based `RevealTarget` contract
   (`:42` → `{ line: 41, character: 0 }`; `:42:7` → `{ line: 41, character: 6 }`), clamped at 0 so `:0` does
   not produce `-1`. `character` is always present when `line` is, because the subscriber only stashes a
   reveal when *both* are numbers. After the suffix split, a non-`file://` path is `decodeURIComponent`d
   inside a try/catch (falling back to the raw string): hrefs arrive percent-encoded — see Established facts —
   so `Application Support` would otherwise reach the intent as `Application%20Support`. `file://` targets are
   returned untouched because `toFileRef` runs its own decoder on them (`file-ref.ts:113-115`); decoding here
   too would double-decode.
3. **`file:` relaxation is scoped to `key === 'href'`.** react-markdown applies `urlTransform` to every URL
   property, `img src` included; an unscoped relaxation would newly allow live `file://` image sources in the
   webview, which is outside this change.
4. **AC-7's toast clause is deliberately satisfied by the in-tab error state — flagged for human
   ratification.** The brief's AC reads "a target that cannot be opened surfaces a toast rather than failing
   silently". The link cannot observe the failure: `emitSurfaceIntent` returns `void`. The only place the
   failure is observable is `raw == null` in `viewer-router.tsx:129` (and `EditorTab.tsx:130`), which already
   renders "File not found or unreadable" in the tab — a visible, non-silent signal. Firing `mfToast.error`
   from `@/lib/toast` there would also fire for every other consumer of the shared viewer — the file tree,
   spotlight, the review panel and find-in-path — and scoping it to transcript links would need a flag
   threaded through the `open-file` intent, which the brief rules out ("no new intent variant"). **Decision:**
   ship the in-tab error as the failure signal, add no toast, and do not pre-validate existence. This is a
   deliberate deviation from AC-7 as literally worded; it needs a human yes/no before the PR closes. If the
   answer is no, the fallback is `mfToast.error('Could not open file', { description: path })` at
   `viewer-router.tsx:129` + `EditorTab.tsx:130`, accepting that all four other viewer consumers toast too.
5. **`data-testid`s:** the anchor is `chat-fileref-<relative>`, the menu items are
   `chat-fileref-open-<relative>`, `chat-fileref-copy-absolute-<relative>` and
   `chat-fileref-copy-relative-<relative>`, where `<relative>` is `toFileRef(path, bases).relative` (per the
   design direction). The anchor also carries `data-file-path={path}` for e2e and tree consistency. The two
   copy rows use `CopyMenuItem` + `useMenuCopyFeedback`, as everywhere else in this codebase — the prototype's
   bare `ContextMenuItem` copy rows are throwaway and must not be ported.

## Established facts

- `defaultUrlTransform` returns `''` for any scheme outside `safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i`,
  and returns the value untouched when the first `:` comes after the first `/`, `?` or `#`, or when there is
  no `:` at all — `node_modules/.pnpm/react-markdown@10.1.0_.../react-markdown/lib/index.js:124` and `421-448`.
  So `file://…` is stripped today, while `/abs/a.ts:42` and `src/a.ts:42` already survive.
- `urlTransform` is invoked as `urlTransform(String(value || ''), key, node)` for every URL-valued property,
  not only `href` — same file, line 382; the callback signature is documented at lines 94-104.
- Link hrefs reach the component **percent-encoded**: `mdast-util-to-hast`'s link handler sets
  `href: normalizeUri(node.url)` (`mdast-util-to-hast@13.2.1/lib/handlers/link.js:20`), and `normalizeUri`
  percent-encodes every ASCII character outside `/[!#$&-;=?-Z_a-z~]/` — a space included
  (`micromark-util-sanitize-uri@2.0.1/index.js:57,73-77,96-97`). `urlTransform` and the `a` override both run
  on the hast property, i.e. after that encoding.
- `toFileRef` decodes `file://` URIs itself via `new URL(...).pathname` + `decodeURIComponent` —
  `packages/ui/src/lib/files/file-ref.ts:113-115`.
- The UI package is `@qlan-ro/mainframe-ui` — `packages/ui/package.json:2`.
- `toFileRef(raw, bases)` accepts `file://` URIs, absolute paths and relative paths, and has no URL guard —
  `packages/ui/src/lib/files/file-ref.ts:68-101`.
- The `open-file` intent carries `path`, optional `line` and optional `character` —
  `packages/ui/src/store/surface-intents.ts:2`.
- `openFileTab` lights the workspace surface itself (no separate `activate-surface` needed), and a reveal
  target is stashed only when `typeof line === 'number' && typeof character === 'number'` —
  `packages/ui/src/store/intent-subscriber.ts:77-83`.
- `RevealTarget.line` / `.character` are 0-based — `packages/ui/src/store/editor.ts:33-38`; `FindInPathModal`
  does the `-1` conversion from 1-based search hits — `packages/ui/src/features/files/FindInPathModal.tsx:94-100`.
- `useActiveBasesStore` is a plain zustand store with no provider — `packages/ui/src/store/active-bases-store.ts:26-32`.
- `useOpenFile` uses only `useCallback` + `emitSurfaceIntent`, so it is safe outside the chat providers —
  `packages/ui/src/features/chat/tools/chat-tool-context.ts:24-36`.
- `useSmartActionsEnabled` reads a context whose default is `false`; it returns `false` outside the provider
  rather than throwing — `packages/ui/src/features/chat/smart-actions/smart-actions-context.tsx:15,21`.
  (`useDaemonPort`, reached only from the localhost branch, is the hook that throws.)
- `markdownComponents.a = SmartLink` — `packages/ui/src/features/chat/parts/markdown-text.tsx:126` — and
  `userMarkdownComponents` spreads it — `packages/ui/src/features/chat/messages/user-directive-renderers.tsx:79`.
  `PlanGate.tsx:37`, `UserMessage.tsx:168`, `ReviewCommentCard.tsx:39` and `PlanBubble.tsx:74` all render
  `Markdown` with that map and no `SmartActionsProvider`, so one dispatcher branch covers all five surfaces.
- Nested Radix menus: an inner trigger must `stopPropagation` on `onContextMenu` and must **never**
  `preventDefault`, or `checkForDefaultPrevented` suppresses the inner link's own menu — the rule is written
  out at `packages/ui/src/features/chat/parts/link-with-preview.tsx:88-91`, and the complementary note for
  portalled triggers is at `packages/ui/src/features/chat/parts/ImageContextMenu.tsx:11-18`.
- `MessagePathContextMenu` resolves its target through `closest('[data-file-path]')` and suppresses itself
  when there is a text selection — `packages/ui/src/features/chat/messages/MessagePathContextMenu.tsx:44-50`.
  The only other `data-file-path` carrier today is the tool-card pill
  (`packages/ui/src/features/chat/tools/shared/chrome.tsx:102`); lightbox images are portalled out of the
  message subtree, so the new Open-file item cannot appear on an image right-click.
- The design-walk prototype variant A is `FileRefLink.tsx` on branch `prototype/design-walk-2026-09-20`
  (`packages/ui/src/prototype/FileRefLink.tsx`, the fall-through return) — `aui-md-a inline-flex items-center
  gap-1 border-b border-primary/40 text-primary no-underline hover:opacity-80` with `<FileCode2 className="size-3
  shrink-0" />` before `{children}`. Its `openStub`, `PROJECT` constant and `splitTarget` are throwaway; the
  real component uses `useOpenFile` + `useActiveBasesStore` + `toFileRef` + `parseFileHref`. Never merge that
  branch.

## Implementation group — `transcript-file-ref-links` (kind: ui)

TDD inline: write each test first and watch it fail, then make it pass. Order within the group:

1. **`parseFileHref` tests → implementation.** Table-driven over the rules in resolution 2, including the
   line/character conversions (including the `:0` clamp), a percent-encoded path (`%20` → a real space), the
   leading-dot accept rows (`./x`, `../x`, `.github/pull_request_template.md`, `.changeset/x.md`), and
   every rejection case (`http(s)`, `mailto:`, `slack:`, `#anchor`, `?q`, `example.com/page`, empty).
2. **`urlTransform` tests → implementation.** `file:///a/b.ts` with `key === 'href'` survives; the same URL with
   `key === 'src'` is still stripped; `https://…`, `slack://…` and the existing app-protocol allowances are
   unchanged.
3. **`useOpenFile` widening.** `openFile(path, position?: { line: number; character: number })`; leave
   `openDiff`/`revealFile` alone. The existing single-argument calls at `tools/shared/chrome.tsx:84,92` must
   keep compiling. This step comes **before** the link component because step 4's `path:42:7` case asserts the
   widened signature; the reverse order cannot go green and would not typecheck. There is no test file for
   `chat-tool-context.ts` (`tools/__tests__/` holds only `group-parts` and `tool-dispatch`), so this step's
   verification is the package typecheck plus step 4's position case — do not author a new suite for the hook.
4. **`FileRefLink` + `SmartLink` branch tests → implementation.** Cover, with no providers mounted (render
   `SmartLink` directly, mocking `@/store/surface-intents` and `@/lib/host` the way
   `smart-actions/__tests__/url-chip-menu.test.tsx:11-27` does):
   - an absolute in-project href emits `{ type: 'open-file', path }` and never calls `host.shell.openExternal`;
   - a project-relative href and a `file://` href do the same;
   - `path:42:7` emits `line: 41, character: 6` (via the step-3 signature);
   - the rendered link text is the authored markdown text, not a helper-derived label;
   - the context menu shows Open file + the two copy-path items and shows neither "Copy link" nor "Open link",
     and no hover Copy-URL button is rendered;
   - an `https://` href still routes to `LinkWithPreview` (external open, `chat-link-copy` present).
5. **`MessagePathContextMenu` Open-file item.** Add the item + separator; extend the existing suite with a case
   asserting the emitted intent for a `[data-file-path]` element, and that the fall-through behaviour for
   prose/selection is unchanged.

**Verification intent for the group** (implementers own the exact commands):

- The new and amended unit suites pass, and the pre-existing `markdown-text`, `url-chip`, `chrome` and
  `MessagePathContextMenu` suites still pass.
- `packages/ui` typecheck passes — note that typecheck includes tests, so run the package typecheck, not just
  the build.
- Lint passes; every touched file stays under the 300-line limit and every new function under 50.
- A grep for `Copy link` inside the file-reference component finds nothing, and no `openStub` survives from
  the prototype port.
- A patch changeset exists for `@qlan-ro/mainframe-ui`.

## Risks

- **`#341` merge collision.** The "Open in Mainframe" row for http links lands in `link-with-preview.tsx`.
  This change must not touch that file at all — the file branch belongs in `SmartLink` and a new component.
- **Directory-less `name:line` targets.** `README.md:42` is stripped by `defaultUrlTransform` before we see it,
  because a colon with no preceding `/` reads as a scheme, and it is syntactically indistinguishable from a
  real scheme such as `sms:42`. Known limitation, not handled; the same reasoning puts Windows `C:/…` targets
  out of scope.
- **False positives on scheme-less web links.** A relative-looking single-segment target such as
  `[site](example.com)` is now classified as a file. It was already a broken link (the old branch handed a
  scheme-less string to the external opener), so this is judged an acceptable trade for keeping the rule
  simple. If a reviewer disagrees, the narrowing knob is requiring a `/` in relative targets.
- **Nested context menus.** `FileRefLink` sits inside `MessagePathContextMenu`'s trigger. Keep
  `onContextMenu={(e) => e.stopPropagation()}` and add no `preventDefault`, or the file-reference menu stops
  opening. This is the failure mode that the existing comment in `link-with-preview.tsx` was written for.

## Out of scope

Linkifying bare paths in prose (needs a new remark plugin), paths inside tool-result bodies, the search card's
"in {path}" sub-header, changes to the localhost chip or instruction chips, and anything daemon-side.
