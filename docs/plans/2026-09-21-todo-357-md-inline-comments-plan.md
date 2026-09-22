# Plan — inline agent notes on every text file (markdown, CSV, SVG)

Todo #357. Spec: `docs/specs/2026-09-21-todo-357-md-inline-comments.md` (committed
on this branch). This plan is written against the spec as committed and against
the code read on 2026-09-21.

## Goal

Today the agent-notes gesture (gutter marker → inline card → "Submit review" that
posts one formatted message to the active session) exists only where
`CmEditorWithComments` / `CmDiffEditorWithComments` mount — code-kind files and
the modified side of a diff. Markdown Preview, markdown Source, the CSV table and
SVG "Code" all bypass that branch and cannot be annotated at all. This change
lifts the note set out of the editor view and into the file tab that owns the
mode toggle, so markdown (Preview + Source), CSV (table + a new Source mode) and
SVG (new gutter Source mode) all annotate one shared, source-line-anchored set of
notes with one submit bar; adds per-row source line ranges to the CSV parse and a
hast-position → source-line-range mapping for rendered markdown blocks; and fixes
the shared bug where a submit with no active session discards the notes it never
sent. Code-kind files and the diff tab keep today's submit bar and today's
gestures; the no-session fix is the single behavior change that reaches them,
because they submit through the same shared path (spec AC 6, AC 25).

Size: this is not a short-form lane. The source diff spans the shared comment
subsystem plus three viewers and a parser; ~900–1200 lines across ~18 files.

## Status on re-issue (2026-09-22)

This plan is re-issued after `4cbaa0d7` amended the spec to name the no-session
fix as the one behavior change reaching code and diff tabs. Only the four
passages that had promised those tabs were untouched have moved; every group,
task, established fact and decision below stands as reviewed.

All seven groups already have commits on `todo/357-md-inline-comments`
(`e522694d`…`2182f220`), the worktree is clean, and a full `packages/ui` vitest
run at `4cbaa0d7` is green apart from one pre-existing flake in
`features/automations/__tests__/AutomationsScope.test.tsx` — it passes when run
alone and touches no file in this lane. An implementer picking up a group below
should verify its tasks against the landed code and close whatever gap remains,
not rebuild it.

Re-verified against that landed code: `useSendReview` returns `'no-session'`
when there is no `chatId`, and `useReviewActions` returns early on that outcome
for both the submit and the single-note path with no branch on file kind — so
the amended AC 6 and AC 25 already hold.

## Established facts

Verified while planning. Receipts are file:line in this worktree or in
`/Users/doruchiulan/Projects/qlan/mainframe/node_modules`.

1. **react-markdown 10.1.0 passes the hast node to component-map entries.**
   `toJsxRuntime(tree, { …, passNode: true })` —
   `node_modules/react-markdown/lib/index.js:348,355`. The node prop is attached
   only when the mapped component is **not** a string tag:
   `if (typeof type !== 'string' && type !== state.Fragment && state.passNode) { props.node = node }`
   — `node_modules/hast-util-to-jsx-runtime/lib/index.js:339-340`. Consequence:
   an unmapped element (today `h4`–`h6`) receives no `node` and cannot be
   annotated; mapping it is what enables the affordance.
2. **mdast source positions survive into the hast elements.**
   `if (from.position) to.position = position(from)` —
   `node_modules/mdast-util-to-hast/lib/state.js:337`. `position.start.line` /
   `position.end.line` are 1-based source lines.
3. **A fenced code block carries position on BOTH `<pre>` and `<code>`.**
   `node_modules/mdast-util-to-hast/lib/handlers/code.js:42,47` calls
   `state.patch(node, result)` once on the `<code>` element and again after
   wrapping it in `<pre>`. The range covers the fence delimiter lines (it is the
   mdast `code` node's own position), which is what spec AC 11 requires.
4. **`code` cannot be the fence anchor.** `MarkdownPreview.tsx:77-78` branches on
   `className?.startsWith('language-')`; a fence with no language has no
   className and takes the inline-code branch. `pre` (today a Fragment,
   `MarkdownPreview.tsx:91`) is the reliable block anchor.
5. **CodeMirror splits lines on `/\r\n?|\n/`.**
   `const DefaultSplit = /\r\n?|\n/;` —
   `node_modules/@codemirror/state/dist/index.js:608`, used by
   `Text.of(string.split(… || DefaultSplit))` at `:2693`. This is the exact rule
   CSV row-end numbering must match for "the same lines in Source" to hold.
6. **`commentField` stores ONE document position per comment, anchored at the
   END line.** `use-comment-gutter.tsx:157` dispatches
   `addCommentEffect.of({ id, line: endLine, text: '' })`; the field converts the
   line to `doc.line(n).from` (`comment-gutter-state.ts:170`) and remaps it
   with `tr.changes.mapPos(a.pos, 1)` (`comment-gutter-state.ts:159`).
   `CommentEntry.startLine` in `use-inline-comments.ts:17-24` is never remapped.
   So the CM marker already follows edits while the submitted payload does not —
   the spec's "range follows edits" decision needs a **second, start-side**
   anchor, not just a write-back.
7. **`getCommentsFromState` output is only ever read field-by-field in tests.**
   `__tests__/comment-gutter.test.ts` asserts `.line`, `.id`, `toHaveLength` and
   a derived `Set` (lines 41, 49-52, 60, 71, 82-84, 92, 100-103, 121, 128-132,
   143, 150-153, 169-171, 186-189) — no `toEqual` on a whole entry. Adding
   `startLine`/`endLine` fields is non-breaking.
8. **`useSendReview` already no-ops without a chatId but signals nothing.**
   `use-send-review.ts:14-16` warns and returns; `use-review-actions.ts:73-77`
   deletes every comment and clears drafts regardless. That is the bug spec AC 6
   fixes.
9. **`use-send-review.test.ts` never asserts the returned promise's value** — all
   three describes assert `mockGetOrCreate` / `mockSendMessage` calls only. Giving
   the returned function a return value is invisible to it.
10. **`CmEditorWithComments.test.tsx` module-mocks `../use-inline-comments` with
    a literal object** (lines 92-100) and sets
    `mockSendReview = vi.fn().mockResolvedValue(undefined)` (line 23). Any new
    key on the model is `undefined` there, and `undefined` is not an explicit
    "skipped" signal — both facts are load-bearing for keeping that file
    unchanged (see Risks).
11. **`inferLanguage` gives `.svg` → `'html'` and `.csv` → `'plaintext'`** —
    `lib/editor/file-types.ts:60` and the `:104` fallback. Both viewers can feed
    `CmEditorWithComments` without a new lang pack.
12. **`CmEditor`'s root is
    `<div ref data-testid="editor-code" className="mf-editor-selectable h-full" />`**
    — `CmEditor.tsx:256`. It accepts no className/testid prop, so a host that
    needs its own testid must wrap it.
13. **`useDaemonPort` throws outside its provider** —
    `features/sessions/runtime/daemon-port-context.tsx:22`. `useActiveIdentity`
    runs `useAuiState` (`features/sessions/use-active-identity.ts:17`) and needs the aui
    runtime.
    Any component that reaches the send path needs those mocked in unit tests.
14. **`parseCsv` trims before parsing** — `csv-parser.ts:99`
    `const normalized = text.trim();`. Row-end detection already accepts LF, CRLF
    and lone CR (`csv-parser.ts:36-40`), and a trailing newline already produces
    no extra row (loop guard `pos < normalized.length`, `:105`).
15. **`resolve-comment-range` caps quoted content at 50 lines**
    (`MAX_INLINE_LINES`, `resolve-comment-range.ts:17`, module-private today) and
    returns `lineContent: ''` past the cap (`:51-53`). Reuse it for block/row quotes so
    one rule governs every surface.
16. **app.css re-enables selection for a grouped whitelist including
    `.mf-editor-selectable`, `pre` and `code`** — `packages/ui/src/styles/app.css:48-57`.
    There is currently no `:has()` rule anywhere in `packages/ui/src/styles/`.
17. **e2e pins that must keep passing** (`packages/e2e/tests-tauri/viewers.spec.ts`):
    `viewer-svg-source` has count 0 in Preview (:181, :195) and
    `toContainText('<rect width="100" height="50" fill="red"/>')` in Source
    (:192); `[data-testid="viewer-csv"] tbody tr` has count 3 unfiltered
    (:210-211) and 1 filtered (:227-228); `viewer-csv-empty` renders on no match
    (:233-234); the SVG tab opens with `viewer-svg-preview-toggle` active (:179).
18. **`Segmented`** (`features/viewers/Segmented.tsx`) is the shared toggle and is
    already used by both `MarkdownEditorTab` and `SvgViewer` in the `ViewerShell`
    `actions` slot.

## Files

Core / shared (`packages/ui/src/features/editor/inline-comments/`):

| File | Change |
| --- | --- |
| `use-file-notes.ts` | **new** — the liftable per-tab model: notes + drafts + `setNoteRange` + `clearAll`. |
| `use-comment-gutter.tsx` | accept an injected model + suppress its own bar; shrink below 300 by extraction. |
| `use-comment-portals.ts` | **new** — portal open/close/registry extracted from the hook. |
| `use-comment-view-sync.ts` | **new** — seed CM from the owned set on mount, reconcile outside adds/removes, write mapped ranges back. |
| `SubmitReviewBar.tsx` | **new** — today's bar, moved verbatim out of `use-comment-gutter.tsx`. |
| `NotesSubmitBar.tsx` | **new** — the lifted-tab bar ("N of M agent notes filled" + primary "Submit review (M)"). |
| `use-review-actions.ts` | sort by start line; keep notes when the send is skipped for want of a session. |
| `use-send-review.ts` | report the send outcome to its caller. |
| `use-inline-comments.ts` | additive `setCommentRange(id, startLine, endLine)`. |
| `comment-gutter-state.ts` | second (start-side) anchor + `startLine` in the effect payload and in `getCommentsFromState`. |
| `comment-gutter.ts` | re-export whatever the barrel gains. |
| `CmEditorWithComments.tsx` | additive optional `model` prop, forwarded to `useCommentGutter`. |
| `resolve-comment-range.ts` | export `MAX_INLINE_LINES`. |

Markdown (`packages/ui/src/features/editor/`):
`MarkdownEditorTab.tsx`, `MarkdownPreview.tsx`, **new**
`markdown-block-range.ts` (pure), **new** `MarkdownAnnotatedBlock.tsx`, **new**
`markdown-notes-context.ts`. Plus `packages/ui/src/styles/app.css` (one rule).

CSV / SVG (`packages/ui/src/features/viewers/`):
`csv-parser.ts`, `CsvViewer.tsx`, **new** `CsvTable.tsx`, **new** `CsvSource.tsx`,
`SvgViewer.tsx`.

Tests: new `__tests__/use-file-notes.test.ts`,
`__tests__/use-comment-view-sync.test.tsx`,
`__tests__/markdown-block-range.test.ts`,
`__tests__/MarkdownEditorTab.notes.test.tsx`,
`__tests__/CsvViewer.notes.test.tsx`; updated
`__tests__/csv-parser.test.ts`, `__tests__/CsvViewer.test.tsx`,
`__tests__/SvgViewer.test.tsx`, `__tests__/MarkdownPreview.css.test.ts`.

Changeset: `.changeset/inline-agent-notes-every-text-file.md` (patch `@mainframe/ui`),
owned by the `notes-model-core` group so no two groups write `.changeset/`.

Untouched on purpose: `packages/core-rs`, every daemon route, `EditorTab.tsx`,
`viewer-router.tsx` (both already pass `path` to the three hosts),
`format-line-comment.ts`, `InlineCommentWidget.tsx`,
`CmDiffEditorWithComments.tsx`, and every existing `CmEditorWithComments` call
site (the new `model` prop is optional, so the code and diff paths pass nothing).

## Constraints

- `CLAUDE.md`: 300 lines per file, 50 per function; decompose instead of growing.
  `use-comment-gutter.tsx` is at 275 and gains behavior — the three extractions
  above are not optional. `CsvViewer.tsx` is at 196 and gains a mode branch plus
  a row-action column — extract `CsvTable`/`CsvSource`.
- Every PR needs a changeset.
- Comments: only a non-obvious *why*, one line.
- Design tokens: `primary` / `muted-foreground` only, per the resolved design
  direction; reuse `Segmented`, `ViewerShell`, `InlineCommentWidget` as-is.
- Work only in
  `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-357-md-inline-comments`
  on `todo/357-md-inline-comments`.

## Design decisions the implementer must not re-litigate

- **Two-anchor comment field.** `addCommentEffect` gains an optional `startLine`
  (defaulting to `line`, so existing dispatches and tests are unaffected). The
  anchor record becomes `{ id, startPos, pos, text }`, mapped
  `mapPos(startPos, -1)` / `mapPos(pos, 1)`. The block widget decoration stays on
  `pos`. `getCommentsFromState` adds `startLine` / `endLine` alongside the
  existing deprecated `line` (= end line). Fact 6/7.
- **Injected model, never a conditional hook.** `useCommentGutter` always calls
  its own `useInlineComments()` + local draft state, then picks:
  `const model = injected ?? own`. That is what keeps the existing module mock
  (fact 10) live on the code/diff path.
- **`useFileNotes` composes `useInlineComments()`**, adding drafts on top and
  delegating `setNoteRange` to the new `setCommentRange`. There is exactly one
  note store; task 5 is what makes the lifted range write-back possible, not a
  spare method.
- **One hook for the three lifted hosts.** `useFileTabNotes({ filePath })`
  (exported from `use-file-notes.ts`) returns
  `{ model, gutterProps, submitBar, noteCountForLines, openNote }` so
  `MarkdownEditorTab`, `CsvViewer` and `SvgViewer` share no source file with one
  another.
- **Bar ownership.** `useCommentGutter` renders `SubmitReviewBar` only when no
  model was injected; a lifted host renders `NotesSubmitBar` itself. No tab ever
  shows two bars, and the code/diff bar's markup and strings are unchanged
  (spec AC 25).
- **Skipped-send signal.** `useSendReview`'s returned function resolves to
  `'sent' | 'no-session' | 'empty'`. `useReviewActions` awaits it and returns
  early — deleting nothing, clearing no draft — **only** on `'no-session'`. The
  fix lands in the shared path and is deliberately **not** branched by file
  kind, so code and diff tabs get it too — the one crack in "code and diff
  unchanged" that the spec itself names. It stays invisible to
  `CmEditorWithComments.test.tsx`, whose mock resolves `undefined` and so falls
  through to today's clear-everything path; that is why the file needs no edit
  (facts 9, 10).
- **Markdown Preview is a static component map plus context.** The map stays a
  module constant; the wrappers read the note set and the open-note id from a
  React context that `MarkdownPreview` provides. Building the map inside render
  would give every block a new component identity on each draft keystroke and
  remount the open card (its `useEffect(() => ref.current?.focus())` would refire).
  The `<Markdown>` element itself is `useMemo`'d on `value` for the same reason.
- **Innermost-block hover is CSS, not state.** jsdom cannot hover, so the
  suppression is one rule keyed on a `data-md-block` attribute
  (`…:hover:not(:has([data-md-block]:hover)) …`), asserted by reading the
  stylesheet text the way `MarkdownPreview.css.test.ts` already does. CSV rows do
  not nest, so they use an ordinary Tailwind `group-hover` and add nothing to
  app.css — that keeps `app.css` a single group's file.
- **Annotated markdown blocks:** `p`, `h1`–`h6`, `li`, `pre`, `blockquote`,
  `table`. **Not** `ul` / `ol` (the spec anchors at list *item* granularity) and
  not `code` (fact 4). `h4`–`h6` get mapped for the first time so every heading
  is annotatable (fact 1).
- **CSV numbering.** Parse from offset 0 (drop the `text.trim()`), then discard
  leading and trailing rows whose cells are exactly `['']` while keeping their
  lines in the count; mid-file empty rows keep producing today's single empty
  row at their real line number. The first surviving row is the header. Row line
  ranges count breaks with the CodeMirror rule (fact 5).
- **Quote text** is always the raw source line(s), capped by the existing
  `MAX_INLINE_LINES` rule (fact 15). The constant is exported from
  `resolve-comment-range.ts` by group 2, which is why groups 3 and 4 depend on
  group 2 as well as on group 1 — nobody redefines the cap.
- **Nested blocks: testids key on the full range, identical ranges collapse.**
  Markdown add controls and markers are `md-note-add-<startLine>-<endLine>` /
  `md-note-marker-<startLine>-<endLine>`, **not** the start line alone. A start
  line is not unique: running the real pipeline this repo drives
  (`remark-parse` → `remark-gfm` → `remark-rehype`, `MarkdownPreview.tsx:115`)
  over the annotated set gives `> a\n>\n> b` → `blockquote 1-3` + `p 1-1`,
  `- one\n\n  second para\n\n- two` → `li 1-3` + `p 1-1`, and `> - a\n> - b` →
  `blockquote 1-2` + `li 1-1`. Keying on the start line alone puts two elements
  under one testid, and both `getByTestId` and Playwright strict mode throw.
  Suppressing the outer block instead is **not** the fix: a blockquote always
  starts on the line of its first inner block, so it would delete every
  blockquote and every loose list item as an annotatable region, against the
  spec's own list in AC 10 and its "records the block's first and last source
  line" in AC 11.
  On top of range keying, a block renders nothing of its own — no control, no
  marker, no cards; it is a pass-through wrapper — when **any annotated
  descendant, at any depth, has the identical range**. Descendant, not direct
  child: `> - a` is `blockquote 1-1` → `ul` → `li 1-1` and `- - a` is
  `li 1-1` → `ul` → `li 1-1`, so the identical block sits behind an unannotated
  container in both. The collapse is what keeps `> a` (`blockquote 1-1` +
  `p 1-1`), `> > a` (two blockquotes + `p`, all `1-1`) and a loose item's last
  paragraph (`li 5-5` + `p 5-5`) down to one control, always the innermost.
  `(startLine, endLine)` is then unique among rendered controls: unrelated blocks
  occupy disjoint line spans and so differ in start, and an ancestor sharing a
  descendant's exact range is suppressed. The innermost-block hover CSS rule
  decides which of the surviving, genuinely different-range controls is *visible*
  (spec: "only the innermost hovered region offers the control"); it is styling,
  never the uniqueness mechanism. The predicate is a pure helper in group 4's
  `markdown-block-range.ts`, red-tested in task 2 — the wrapper does not invent
  its own tree walk. Spec AC 7 asks for testids keyed by source line and never by
  index; the two-line form meets that rule and refines its `md-note-add-<line>`
  example for markdown only. CSV rows cannot nest, so `csv-note-add-<startLine>`
  is unchanged.

## Task groups

Verification is stated as intent: what must be true and how to observe it. The
implementer owns the exact commands.

### Group 1 — `red-tests-pure` (test)

Red-phase unit tests for the two pure helpers and the lifted model, written and
observed failing before any of them exists.

1. Extend `viewers/__tests__/csv-parser.test.ts`: every row carries
   `startLine`/`endLine`; a file whose third row has a quoted field with an
   embedded newline spans its real lines; CRLF and lone-CR files number
   identically; two leading blank lines push the header to line 3 and the first
   data row to line 4; a trailing newline adds no row; a mid-file blank line
   still yields one empty row at its real line. Keep every existing assertion in
   the file as-is.
   *Verify:* the new cases fail with the current parser; the pre-existing ones
   still pass.
2. New `editor/__tests__/markdown-block-range.test.ts` for the pure mapper: a
   hast node with `position` → `{ startLine, endLine }` plus the joined source
   lines; a nested list-item paragraph maps to the paragraph's own range; a
   fenced block's range includes both delimiter lines; a node with no `position`
   maps to `null`; a range longer than `MAX_INLINE_LINES` yields an empty quote.
   Also cover the identical-range predicate of the *Nested blocks* decision:
   `> a` suppresses the blockquote, `> - a` suppresses it through the
   unannotated `ul`, `> a\n>\n> b` suppresses nothing, and `> > a` leaves only
   the innermost paragraph.
   Build the input nodes by rendering `<Markdown>` from react-markdown with a
   spy component map that captures each `node`, so the positions are real rather
   than hand-written. Do not import `remark-parse` / `remark-rehype` directly —
   `packages/ui/package.json` declares `unified` but not those, and they resolve
   today only through `shamefully-hoist`.
   *Verify:* fails on a missing module.
3. New `inline-comments/__tests__/use-file-notes.test.ts`: add/edit/delete; a
   draft set on a note is readable back; `setNoteRange` moves a note's recorded
   range and leaves its captured quote alone; `clearAll` empties notes and
   drafts; line queries return notes whose range covers the line.
   *Verify:* fails on a missing module.

Does not depend on anything. Shares no file with any other group.

### Group 2 — `notes-model-core` (core)

Depends on group 1 (its tests define this group's contract and must be seen red
first).

4. `use-file-notes.ts`: the model (notes, drafts, add/edit/delete, `setDraft`,
   `setNoteRange`, `clearAll`, line queries) and `useFileTabNotes({ filePath })`
   composing it with the gutter props, the review actions and the lifted bar.
   *Verify:* group 1's model tests go green.
5. `use-inline-comments.ts`: additive `setCommentRange(id, startLine, endLine)`.
   No other change to the file's exported shape.
   *Verify:* `use-inline-comments.test.ts` passes untouched.
6. `comment-gutter-state.ts`: the two-anchor change of the *Two-anchor
   comment field* decision, plus
   `startLine`/`endLine` on `getCommentsFromState`. Re-export from
   `comment-gutter.ts`.
   *Verify:* every pre-existing case in `comment-gutter.test.ts` still passes
   unedited, and a case appended to that file shows that inserting a line above a
   two-line comment moves both its start and its end.
7. Extract `SubmitReviewBar.tsx` (verbatim markup and strings) and
   `use-comment-portals.ts` out of `use-comment-gutter.tsx`. Also export
   `MAX_INLINE_LINES` from `resolve-comment-range.ts` — it is module-private
   today (fact 15) and groups 3 and 4 import it.
   *Verify:* `CmEditorWithComments.test.tsx` and
   `CmDiffEditorWithComments.test.tsx` pass with no edit to either file; the
   hook file is back under 300 lines.
8. `use-comment-view-sync.ts`: on view mount, dispatch an add effect for every
   note already in the owned set (skipping any whose `startLine` exceeds
   `doc.lines` — those stay countable but unmarked per the spec's past-EOF edge
   case); on subsequent owned-set changes, add or remove anchors to match; on CM
   document changes, push the mapped `startLine`/`endLine` back into the owned
   set via `setNoteRange`. Active only when a model was injected.
   *Verify:* in a new `inline-comments/__tests__/use-comment-view-sync.test.tsx`,
   mounting the wrapper with a pre-populated injected model shows a gutter marker without any user gesture, and a note removed from the
   model outside the view loses its marker without a remount.
9. `use-comment-gutter.tsx`: accept `model` and render its own bar only when
   `model` is absent (the *Injected model* and *Bar ownership* decisions).
   *Verify:* with an injected model exactly one bar renders; with none, today's
   bar renders.
10. `use-send-review.ts` + `use-review-actions.ts`: the outcome signal of the
    *Skipped-send signal* decision, and sorting submitted items by `startLine` (ties by `endLine`).
    Removal must keep working when `viewRef.current` is null, since a table row
    or a rendered block has no view.
    *Verify:* with no chatId, submit and single-note send leave the note set and
    the drafts intact — on a code or diff tab as much as on a lifted one (spec
    AC 6, AC 25); `use-send-review.test.ts` and `CmEditorWithComments.test.tsx`
    pass with no edit to either file.
11. `NotesSubmitBar.tsx`: "N of M agent notes filled" + a primary
    `Submit review (M)`, keeping the `editor-submit-review` /
    `editor-submit-review-btn` testids, singular at one of one.
    *Verify:* a render test covers the singular and plural strings and the
    disabled state at zero filled notes.
12. `.changeset/inline-agent-notes-every-text-file.md`.

Shares no file with groups 3–7.

### Group 3 — `csv-parser-ranges` (core)

Depends on groups 1 and 2 (for the exported `MAX_INLINE_LINES`). Touches only
`viewers/csv-parser.ts`.

13. Parse from offset 0; expose `startLine`/`endLine` per row and per header;
    drop leading/trailing all-empty rows while counting their lines; keep
    `_index` and the existing cell semantics; count line breaks with the
    CodeMirror rule (fact 5).
    *Verify:* every case from task 1 passes, old and new.
14. Export a helper that slices the raw source lines for a row's range (reusing
    the `MAX_INLINE_LINES` cap) so the viewer quotes raw text rather than cells.
    *Verify:* a quoted multi-line row's slice equals the file's own lines for
    that range.

### Group 4 — `md-block-range` (core)

Depends on groups 1 and 2 (for the exported `MAX_INLINE_LINES`). Touches only
`editor/markdown-block-range.ts`.

15. The pure hast-position → `{ startLine, endLine, lineContent }` mapper, over
    the markdown source string, returning `null` when the node has no `position`,
    and honouring the shared line cap. Plus the identical-range predicate: given a
    hast node, does any annotated descendant (walking `children` through
    unannotated containers such as `ul` / `ol`) carry the same start and end line?
    *Verify:* group 1's mapper tests go green.

### Group 5 — `md-annotate-ui` (ui)

Depends on groups 2 and 4.

16. `MarkdownEditorTab.tsx`: own the note set through `useFileTabNotes({ filePath: path })`;
    Source becomes `CmEditorWithComments` with the injected model; render one
    `NotesSubmitBar` outside the mode branch. Keep the existing `Segmented`
    testids and the Preview default.
    *Verify:* the bar is present in both modes with one count; the existing
    `MarkdownEditorTab.test.tsx` passes unchanged.
17. `markdown-notes-context.ts` + `MarkdownAnnotatedBlock.tsx`: the wrapper that
    reads `node.position`, renders the right-margin add control on hover
    (`MessageSquarePlus`) or the persistent `Sparkles` marker when a note
    overlaps its range, and mounts `InlineCommentWidget` beneath the block for
    every overlapping note in ascending start-line order. Testids
    `md-note-add-<startLine>-<endLine>` and
    `md-note-marker-<startLine>-<endLine>`, per the *Nested blocks* decision; a
    block the identical-range collapse suppresses renders none of the three.
    *Verify:* in a document containing `> a`, `> a\n>\n> b` and a loose list
    item, every `md-note-*` testid in the tree is unique.
    *Verify:* clicking the control for a known block opens a card whose quoted
    text is that block's markdown source.
18. `MarkdownPreview.tsx`: wrap the block elements listed under *Annotated
    markdown blocks* in
    `MarkdownAnnotatedBlock`, add the `h4`–`h6` entries, keep the map a module
    constant, memoize the `<Markdown>` element on `value`, and accept an optional
    notes context (absent → today's plain render).
    *Verify:* `MarkdownPreview.test.tsx` passes unchanged and the wrapper keeps
    `mf-editor-selectable`; the prose child selectors still match.
19. `styles/app.css`: the innermost-block hover rule, plus an assertion for it in
    `MarkdownPreview.css.test.ts` following that file's existing read-the-CSS
    pattern.
    *Verify:* the CSS test names the rule and the existing whitelist assertion
    still passes.
20. New `__tests__/MarkdownEditorTab.notes.test.tsx` — the cross-surface set:
    a note plus an unsaved draft survives Preview → Source → Preview; a
    Preview-created note shows a gutter marker in Source and vice versa; notes
    created in two modes submit as one message with blocks in ascending
    start-line order; with no active session submit sends nothing and keeps every
    note and draft; inserting two lines above a note in Source moves its marker,
    its Preview marker and its submitted line numbers by two while its quote
    stays put.
    *Verify:* these are the spec's AC 1, 2, 4, 6, 13, 14.

### Group 6 — `csv-annotate-ui` (ui)

Depends on groups 2 and 3.

21. Extract `CsvTable.tsx` from `CsvViewer.tsx` (header, sort, rows, the
    empty-filter row) and add `CsvSource.tsx` (read-only `CmEditorWithComments`
    over the raw text with the injected model).
    *Verify:* both files and `CsvViewer.tsx` are under 300 lines.
22. `CsvViewer.tsx`: own the note set; add the Preview/Source `Segmented` beside
    the existing filter chip in the `ViewerShell` actions slot, defaulting to the
    table; hide `viewer-csv-filter` in Source; render one `NotesSubmitBar` in
    both modes; keep the status footer's rows/cols reading in both.
    *Verify:* the e2e testids of fact 17 still resolve without a mode switch.
23. `CsvTable.tsx`: the row-number column shows `row.startLine`; a trailing
    action column carries the hover add control / persistent marker
    (`csv-note-add-<startLine>`, `csv-note-marker-<startLine>`); an open card
    renders as a sibling `<tr>` with a full-width `<td colSpan={headers.length + 2}>`
    after the row, so no card ever nests inside a data row. The empty-filter row's
    colSpan follows the new column count.
    *Verify:* the unfiltered `tbody tr` count is unchanged when no card is open;
    row numbers do not move under sort or filter.
24. Update `__tests__/CsvViewer.test.tsx` for the row-number column's new meaning
    and add `__tests__/CsvViewer.notes.test.tsx`: a row note records the row's
    source range and quotes its raw lines; a multi-line quoted row lands on the
    same lines in Source; a filter that hides a noted row keeps it in the count
    and in the submitted message, and closes its open card.
    *Verify:* spec AC 15–21. These suites need module mocks for the daemon-port
    and active-identity contexts (fact 13) — adding that harness is not a
    loosening.

### Group 7 — `svg-annotate-ui` (ui)

Depends on group 2.

25. `SvgViewer.tsx`: replace the `<pre>` with a wrapper div carrying
    `data-testid="viewer-svg-source"` and `mf-editor-selectable` around a
    read-only `CmEditorWithComments` (language from `inferLanguage`, fact 11)
    with the injected model; own the note set; render `NotesSubmitBar` in both
    modes; relabel the second segment to "Source" keeping
    `viewer-svg-source-toggle`; Preview keeps no affordance and stays the default.
    *Verify:* the Preview→Source→Preview round-trip keeps notes and drafts;
    `viewer-svg-source` is absent in Preview and contains the raw markup in
    Source (fact 17).
26. Update `__tests__/SvgViewer.test.tsx` for the "Source" label and the editor
    root, adding the same context mocks as group 6.
    *Verify:* spec AC 22–24.

## Risks

- **The `useInlineComments` mock in `CmEditorWithComments.test.tsx` omits
  `setCommentRange`.** That is safe only because the write-back fires from a real
  CM update listener and that suite stubs `CmEditor` entirely (fact 10). Do not
  paper over it with optional chaining; if the suite does start failing, add the
  key to the mock and say so — a mock gaining a key is not a loosened assertion.
- **Viewer unit tests now reach the send path.** `useDaemonPort` throws without a
  provider (fact 13), so `CsvViewer` and `SvgViewer` suites must mock it and
  `useActiveIdentity`. Flagged in tasks 24 and 26 so it is not discovered late.
- **CM6 inside a flex viewer body.** The editor host needs a bounded height; SVG
  and CSV Source wrappers must give it `min-h-0 flex-1` or the document collapses.
- **CSV parse change is the one hard-to-reverse decision** (spec's own wording):
  row identity and the row-number column's meaning key every downstream note. The
  leading/trailing-blank rule of the *CSV numbering* decision is the contract; test it before
  the viewer consumes it, which is why group 3 depends on group 1.
- **`tbody tr` counts.** The sibling-`<tr>` card (task 23) changes the row count
  whenever a card is open. The e2e assertions never open one, but a new unit test
  that does must count data rows by a testid, not by `tr`.

## Exit gates

- Every acceptance criterion in `docs/specs/2026-09-21-todo-357-md-inline-comments.md`
  is demonstrably met, with 1–8 exercised by group 5's cross-surface suite.
- `packages/ui` unit tests, typecheck and lint pass; the pre-existing comment,
  markdown-preview and gutter suites pass without edits, and the only existing
  test strings that change are the CSV row-number column and the SVG "Source"
  label (spec AC 27). Appending a case to an existing suite is not an edit to
  its assertions.
- No file over 300 lines, no function over 50; `use-comment-gutter.tsx` (275
  today) and `CsvViewer.tsx` (196 today) both end up smaller than they are now.
- `git diff packages/core-rs` is empty and no daemon route changed (spec AC 8).
- The changeset from task 12 is committed.
