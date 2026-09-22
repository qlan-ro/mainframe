# Inline agent notes on every text file (markdown, CSV, SVG)

Todo #357. Source: the todo's `## Agent Brief`, the `## Design direction` resolved
with the user on 2026-09-20 (variant B of three, prototype branch
`prototype/design-walk-2026-09-20`, never merged), and the 2026-09-20 feedback
widening the scope from markdown to any text-type file. Claims in the brief were
re-checked against the branch; the contradictions found are recorded in
`## Decisions`.

## Problem

Reviewing a file with an agent means leaving notes on the lines that matter and
sending them as one review message. That gesture exists today, but only where the
workspace happens to mount the code editor: `.ts`, `.json`, `.yaml`, `.txt`,
extensionless files, and the modified side of a diff. The four viewers that
replace the editor with something else — markdown Preview, markdown Source, the
CSV table, and SVG "Code" — have no way to add a note at all. A user reading a
spec in Preview, scanning a data file as a table, or checking generated markup
has to fall back to copying text into the chat by hand.

Two things make this more than a missing button. Pending notes live inside the
editor view, so anything that unmounts it — toggling Preview and Source, moving
between a table and its source — would silently discard notes and half-typed
drafts. And submitting a review with no active session throws the notes away even
though nothing was sent.

## Behavior

Every file the workspace opens as text supports agent notes. A file tab owns one
note set: each note covers a range of source lines, quotes the source text of
those lines, and holds the user's draft until it is submitted. Code files and the
diff tab keep exactly what they have today, including their submit bar.

**Adding a note in a rendered view.** Hovering an annotatable region — a rendered
markdown block (paragraph, heading, list item, fenced code block, table,
blockquote) or a CSV row — tints it and reveals an add-note control at its right
margin. Activating the control opens the note editor directly beneath that region:
the same card used by the code editor, showing the quoted source lines, a text
field, Cancel, "Add context", and Send. A region that already carries a note shows
a persistent marker in the same right-margin slot instead of the hover control;
clicking the marker reopens that note's editor. When several regions are nested
(a paragraph inside a list item, a list inside a list), only the innermost hovered
region offers the control.

**Adding a note in a source view.** Markdown Source, CSV Source, and SVG Source
all present the file as numbered lines with the same gutter marker the code editor
has: clicking the marker on a line, or on an active selection, opens the note
editor beneath the last line of the range.

**Markdown.** Both modes annotate the same note set. A note created in Preview
records the source line range of the block it was created on and quotes that
block's markdown source — including fence delimiters for a fenced code block — so
that once submitted it is indistinguishable from a note made over the same lines
in Source. A block the renderer cannot place in the source offers no control. A
note created in Source shows its marker in Preview on every block whose lines
overlap the note's range; a note that overlaps no block (a blank line between
paragraphs) shows no marker in Preview but is still listed in the
count and still submitted.

**CSV.** The table annotates whole rows. The row-number column shows the row's
line number in the original file, not its position in the current view, so it does
not change when the table is sorted or filtered — and it is the same line the row
occupies in Source. A row whose quoted field contains newlines spans the several
lines it really spans: the column shows the row's first line, and the note covers
and quotes the whole range. Notes on rows the active filter hides stay in the set and stay
in the count. The header row is not annotatable from the table; Source is where a
note on it belongs.

The CSV tab gains a Preview/Source toggle where the other text viewers carry
theirs, and opens on the table as it does today. Source shows the raw file text
with the line gutter. The file is read-only in both modes. In Preview the toggle
and the existing filter control share the header actions slot; the filter is
hidden in Source, where it has nothing to filter.

**SVG.** The existing "Code" mode becomes a Source view with the line gutter, so
the markup can be annotated line by line, and its toggle label changes from "Code"
to "Source" to match the other two viewers. The rendered Preview offers no control
— an image has no lines to address — but notes and drafts survive a
Preview → Source → Preview round-trip like every other mode toggle.

**Editing markdown while notes are open.** Markdown Source is the one
annotatable surface that is editable. Typing there moves a note's marker with the
text it is anchored to, as the code editor's marker already does, and the note's
recorded line range moves with it, so the same note points at the same text in
Preview, in Source, and in the submitted message. The quoted text a note captured
when it was created does not change.

**Submitting.** On markdown, CSV and SVG tabs, one submit bar per file tab while
the set holds at least one note, absent when it is empty, shown in every mode,
reporting how many of the tab's notes have text and offering a single submit
action for all of them. Submitting sends one review message to the active
session covering every note that has text, ordered by source line regardless of which mode or surface
created it, in the existing review format, and then empties the set everywhere.
Sending a single note from its card sends only that note and removes it from every
surface that shows it. When there is no active session, both submit and
single-note send do nothing at all: every note and every draft is still there
afterwards. Because every tab submits through the same path, this is the one
behavior change code files and the diff tab also get.

Notes stay ephemeral — nothing is written to disk or to the daemon, and closing
the tab discards them, exactly as for code files today.

## Not Included

- Persisting notes across tab close, app restart, or to the daemon — `deferred`
- Re-capturing a note's quoted text when the buffer under it is edited; the
  quote stays as captured even after its line range moves — `deferred`
- Text-selection (sub-block) anchoring inside rendered prose, and sub-cell
  anchoring inside a CSV row — `deferred`
- Making CSV or SVG editable; annotation stays a read gesture — `deferred`
- Changes to the review message format, to the per-note send gesture, or to the
  code-kind and diff-tab annotation path, including their submit bar — `declined`
  (the shared no-session discard fix is the sole exception; see `## Decisions`)
- Threaded replies, resolve/unresolve state, and agent-authored comments —
  `declined`
- Annotation in the image and PDF viewers; both are binary and not
  line-addressable — `declined`
- A Preview "Comment" action that only jumps to Source at that line, instead of
  annotating in place — `declined`
- Mobile (separate repository) — `platform`

## Edge cases

- A markdown block with no source position (synthesised by a renderer plugin)
  offers no add-note control; the rest of the document is unaffected.
- Nested blocks: hovering a paragraph inside a list item reveals exactly one
  control, on the paragraph.
- A Source note whose range spans several blocks marks all of them in Preview;
  clicking any of those markers opens that one note's editor.
- When more than one note overlaps the same rendered block, the block shows one
  marker and clicking it opens a card for each overlapping note, stacked beneath
  the block in ascending start-line order.
- A note whose start line is past the end of the current buffer (the file was
  edited or reloaded shorter) renders no marker but stays in the set and in the
  count, and is still submitted.
- Editing markdown in Source moves a note's line range with the edited text, so
  a note can end up quoting text that no longer matches its (now moved) lines.
  Text typed over a note's whole range collapses it onto the line the edit left
  behind; the note stays in the set and in the count.
- CSV line numbering counts from the first line of the file as read: leading blank
  lines are counted but produce no row, and a trailing newline produces no extra
  row. Mid-file blank lines keep producing the single empty row they produce
  today, at their real line number.
- CSV files using CRLF, and files using a lone CR as the line break, number rows
  the same way the source view splits lines.
- A filter change that hides a row with an open note editor closes that editor;
  the note and its draft text survive and reappear when the row is visible again.
- An empty or unparseable CSV shows no rows and therefore no row controls; Source
  still annotates the raw text.
- SVG or CSV content that has not finished loading shows no controls and no submit
  bar.

## Acceptance criteria

*Shared note set*

1. Adding a note in one mode of a file tab, typing draft text without saving,
   toggling to the other mode and back, shows that note with its draft text
   unchanged.
2. A source view mounted after a note was created elsewhere shows a gutter marker
   on that note's lines, and adding or removing a note outside the source view
   adds or removes its marker there without remounting.
3. On a markdown, CSV or SVG tab, while at least one note exists, exactly one
   `editor-submit-review` element (with its `editor-submit-review-btn` action) is
   present per file tab, in every mode of that tab, and its count covers notes
   from all modes; with an empty set both testids have zero elements. Its label
   pluralises: one filled note of one reads `1 of 1 agent note filled`. This
   criterion does not apply to code or diff tabs (see 25).
4. With notes created in two different modes, submitting produces exactly one
   message appended to the active session, whose body is the existing review
   format (`File: \`<path>\`` followed by `At line N:` / `At lines N-M:` blocks
   separated by `---`), with the blocks in ascending start-line order; after it
   the note set is empty in both modes and the submit bar is absent.
5. Sending one note from its card appends a message containing only that note and
   removes that note's marker and card from every surface; other notes and drafts
   are untouched.
6. With no active session, activating submit appends no message and leaves every
   note and every draft present; the same holds for single-note send. This holds
   on a markdown, CSV, SVG, code and diff tab alike.
7. Add-note controls, markers, and note cards carry `data-testid`s keyed by source
   line or note id (`md-note-add-<line>`, `csv-note-add-<line>`) — never by array
   index or display position.
8. No daemon route, schema, or persisted field is added or changed; the diff of
   `packages/core-rs` and of the daemon route surface is empty, so Zod validation,
   the ok/fail envelope, and Rust parity are not applicable to this change.

*Markdown*

9. Opening a markdown file and switching to Source shows the same comment gutter
   a code file shows, plus the tab's own submit bar, and a note added there
   reaches the session on submit.
10. In Preview, hovering a paragraph, a heading, a list item, a fenced code block,
    a table, and a blockquote each reveals an add-note control; activating it
    opens the note card beneath that block.
11. A note created on a block in Preview records the block's first and last source
    line and quotes the block's markdown source; for a fenced code block the
    quoted text includes both fence delimiter lines.
12. Hovering a paragraph nested inside a list item reveals exactly one add-note
    control, and the note it creates records the paragraph's line range.
13. A note created in Preview appears on its source lines in Source; a note
    created in Source over lines that a rendered block occupies shows that block's
    marker in Preview.
14. Inserting two lines above an existing note in markdown Source moves that
    note's marker, its Preview marker, and the line numbers in the submitted
    message down by two; the note's quoted text is unchanged.

*CSV*

15. Hovering a table row reveals an add-note control; activating it opens the note
    card for that row.
16. The row-number column shows each row's source line number, and those numbers
    are unchanged after sorting by any column and after applying a filter.
17. For a file whose third row contains a quoted field with an embedded newline,
    the row-number column shows that row's first source line, the note created on
    it records the full multi-line range and quotes those raw source lines, and
    opening Source shows that note's marker on the same lines.
18. The same holds for a file with CRLF line endings and for a file with lone-CR
    line endings.
19. For a file starting with two blank lines, the first data row's recorded line
    number accounts for them.
20. With a filter active that hides a noted row, the submit bar's count still
    includes that note, and submitting includes it in the message.
21. The CSV tab opens on the table, and renders a Preview/Source segmented
    toggle in the viewer header actions slot alongside the existing
    `viewer-csv-filter` control; Source renders the raw text in the
    comment-gutter editor, neither mode accepts keystrokes into the document, and
    `viewer-csv-filter` is absent in Source. The existing `viewer-csv`,
    `viewer-csv-filter`, `viewer-csv-header-*`, `viewer-csv-empty` and `tbody tr`
    e2e assertions pass without being re-pointed at a mode switch.

*SVG*

22. SVG Source renders the raw markup in the comment-gutter editor (not a
    preformatted block), with the gutter, note card, and submit bar working as for
    a code file, and the document is read-only. The tab still opens on Preview,
    the `viewer-svg-source` testid moves onto the gutter-editor root so the
    existing visible/absent e2e assertions hold, and the markup stays
    text-selectable via `.mf-editor-selectable`.
23. The SVG toggle segments read "Preview" and "Source", keeping the existing
    `viewer-svg-preview-toggle` / `viewer-svg-source-toggle` testids.
24. SVG Preview exposes no add-note control, and a note plus its draft survives
    Preview → Source → Preview.

*No regression and quality*

25. A code file and the diff tab still add, edit, delete, send, and submit notes
    as before, with one intended change: with no active session their submit and
    single-note send now leave notes and drafts in place instead of discarding
    them (see 6). The existing code-editor and diff-editor comment tests pass
    unchanged apart from that case. Their submit bar is untouched: it still sits
    above the editor and reads `N agent notes` with a `Submit review (N)` button.
26. New unit tests cover: markdown block position → line range (including a nested
    list item and a fenced code block), CSV row → source line range (quoted
    multi-line field, CRLF, lone CR, leading blank lines), note-and-draft survival
    across a mode toggle, merged submission ordering across two surfaces, the
    no-session submit leaving notes intact, and a note's range following an edit
    made above it in markdown Source.
27. Existing tests whose asserted text changed — the CSV row-number column and
    the SVG toggle label — are updated to the new expected strings; no other
    existing test is loosened. The existing `MarkdownPreview` render and
    CSS-selection tests pass unchanged, so the per-block hover
    wrappers must not break the prose child selectors or the
    `.mf-editor-selectable` opt-in.
28. Every touched file stays under 300 lines and every function under 50 lines;
    the gutter-orchestration hook, the editor tab, and the CSV viewer are near the
    ceiling and are decomposed rather than grown. A changeset is included.

## Decisions

- **The design-direction submit bar (sticky bottom, "N of M agent notes filled",
  primary "Submit review (M)") applies only to the tabs that host the lifted note
  set — markdown, CSV and SVG. Code and diff keep today's bar above the editor,
  reading "N agent notes" with a secondary button.** The brief fences the
  code-kind and diff path in three places and the design direction scopes its
  lifted model to `MarkdownEditorTab`, `CsvViewer` and `SvgViewer`, so nothing
  authorises restyling the wrapper's own bar; a lifted host suppresses the
  wrapper's bar and renders its own, so no tab shows two. Accepted cost: two bar
  styles coexist until a separate all-surfaces decision, as with persistence.
  `reversible`
- **Innermost hovered block wins; ancestors suppress their control while a
  descendant is hovered.** Two stacked controls on a list item and its paragraph
  is worse than the rare case of wanting the outer range, which Source still
  offers. `reversible`
- **A Source note marks every Preview block its range overlaps; a note overlapping
  no block shows no marker but is still counted and submitted.** Overlap is what
  the existing line-query model already answers, and dropping an unmarked note
  from the count would lose work silently. `reversible`
- **The no-session fix covers per-note send as well as submit, and lands in the
  shared path, so code and diff tabs get it too.** Both gestures go through
  `use-review-actions` / `use-send-review`, which every tab uses, and both
  currently discard the note after a skipped send; fixing one gesture, or
  branching the fix by file kind to keep the code path bit-identical, would
  preserve a data-loss bug to honour a scope fence. This is the one deliberate
  crack in the "code and diff unchanged" rule. `reversible`
- **CSV parses the untrimmed text: leading and trailing blank lines count for
  numbering but produce no rows; mid-file blank lines keep today's single empty
  row.** Line 1 must be the file's first line for source numbers to be true, and
  changing mid-file behavior would be an unrelated parser change. `hard-to-reverse`
  (row identity and the row-number column's meaning are what every downstream note
  is keyed to)
- **Row-end detection matches the source view's line splitting for LF, CRLF and
  lone CR.** A row annotated in the table must land on the same lines in Source, so
  the two splitters have to agree; both already treat a lone CR as a break.
  `hard-to-reverse` (same keying)
- **CSV gains a Preview/Source toggle with a read-only gutter editor.** Adopted
  from the brief: it gives header rows and malformed lines an addressable home the
  row-granular table cannot offer, and makes the three toggling text viewers
  behave alike. `reversible`
- **SVG is in scope, Source only.** Its Preview is an image with no lines; its
  Source is a preformatted block the read-only gutter editor replaces almost
  one-for-one. `reversible`
- **The SVG toggle label changes from "Code" to "Source".** Three text viewers
  with the same toggle should read the same; testids are unchanged, so only one
  unit-test string is updated. `reversible`
- **The CSV filter control is hidden in Source and the status footer keeps its
  rows/cols reading in both modes.** Filtering raw text is meaningless; inventing
  a second status line is scope the todo did not ask for. `reversible`
- **Notes quote the raw source lines in every surface — markdown source for a
  block, raw CSV lines for a row, raw markup for SVG.** The agent should receive
  the text it will see in the file, not a rendered cell value. `reversible`
- **Preview anchors at whole-block granularity using the renderer's source
  positions.** Arbitrary text-selection anchoring needs a source-offset mapping the
  renderer does not expose; Source covers the exact-range case. `reversible`
- **Notes stay ephemeral.** Matches the code and diff tabs; changing that is a
  decision for all surfaces at once. `reversible`
- **A note's recorded line range follows edits to the buffer under it; markdown
  Source writes the mapped range back into the owned set.** An earlier draft of
  this spec claimed line numbers stay as recorded; the code disagrees, in a way
  that only bites once the model is lifted: `comment-gutter-state` already maps
  its anchors
  through `tr.changes.mapPos`, while `CommentEntry.startLine` never moves, so the
  code editor's marker already follows edits and its submitted payload already
  does not. Preview and the view-less submit path read the owned set, so leaving
  them unreconciled would put the Source marker and the Preview marker on
  different blocks after one keystroke. Writing the mapped range back keeps every
  surface on one truth and makes the payload accurate; the alternative — deriving
  Source markers from the owned set and dropping CM mapping — is simpler but
  regresses marker behavior the code editor has today. The captured quote stays
  as captured. `reversible`
- **The existing "agent notes" concept is what "inline comments" means here.** The
  codebase has exactly one annotation concept, labelled that way in its own submit
  bar; the todo reads as "this is missing on the viewers". `hard-to-reverse`
  (the whole feature's framing)
