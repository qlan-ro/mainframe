# Reference another session with `@` (todo #240)

## Problem

To point an agent at another session today, the user right-clicks that session's sidebar row, picks
"Copy Session ID", and pastes a raw CLI session id into the message. The action only exists once the
session has started, the pasted id is meaningless to a human reader, and the receiving agent cannot turn
it into anything it can read — it is not a path, and nothing in the message says what it is. The
reference is therefore both unreadable and inert.

The composer already has a picker for this shape of problem: `@` offers agents and project files, and a
picked file lands as text the agent can act on. Sessions are missing from it. The user wants to type `@`,
recognize the other session by its title, and have the agent end up holding something it can actually
open — without ever seeing or handling an id.

## Behavior

**Picking a session.** Typing `@` in the composer opens the existing trigger popover. Session rows merge
into the same flat result list that already holds agents and files — no group header, no section — and
are told apart by a leading glyph that agent and file rows do not carry. The list order is: matching
agents, then matching sessions (most recently updated first), then the cached file and directory results.
Sessions are matched by a case-insensitive substring of the typed token against the session's reference
label (below), the same matching the other `@` sources use. The typed token is whitespace-bounded, so a
multi-word query is not possible — as is already true for files and agents.

**Which sessions are offered.** Only sessions in the *current chat's project*, and only those the app has
already resolved to an existing transcript file. Cross-project references are not possible, so no row
shows a project label. Excluded, and hidden rather than shown disabled: the session the user is composing
in, archived sessions, sessions that have never started, sessions whose transcript is missing, and
sessions whose transcript location the app cannot determine (an adapter with no known layout, or an
adapter that can neither confirm nor deny the file). Every visible row is actionable because offerability
is decided by data already in hand, not by a check deferred to selection time. When no session in the
project qualifies, no session rows appear and the popover behaves exactly as it does today.

**Reference label.** Sessions are identified throughout this feature by a *reference label*: the
session's displayed title (the same fallback title the sidebar shows when a session has none), reduced to
a markdown-inert character set — letters, digits, spaces, `…`, and the punctuation `, ; ! ? ' " ( ) -`.
Every other character is replaced with a space, runs of whitespace collapse to one space, and the result
is trimmed. That removes every character markdown gives meaning to — `` ` `` `* _ [ ] < > ~ \ & # |` — and
`. : / @`, the characters GFM needs to autolink a bare URL or an email address. The label is built once,
against that character set, so a single rule covers the picker row, the inserted token, the reference
line, and the chip. Sanitizing rather than escaping is deliberate: the token, the reference line, and the
chip must stay byte-identical to each other, and a backslash-escaped label would not. If sanitizing leaves
nothing — a title of only punctuation or emoji — the label falls back to the sidebar's untitled display
title.

Labels are not unique, so when the offerable set holds more than one session with the same label, the app
appends ` (2)`, ` (3)`, … in list order — most recently updated
first, chat id as the tiebreak — so that every offered row has a distinct label and the same session
keeps the same label for the same list. If the label the app is about to insert is already used in the
draft by a *different* session, it takes the next free suffix instead. The label is what the picker row
shows, what the inserted token carries, and what the chip displays; no chat id and no path is ever shown
to the user.

**What selection inserts.** Selecting a session replaces the typed `@` token with the literal text
`@<label>`, followed by one space — the same insertion path a file or agent mention uses. The composer
shows that token literally, tinted in a color of its own, distinct from the tint used for file mentions
and skills. At send, the app rewrites each of the draft's own labels to the wire token `@session[<label>]`
(amended 2026-07-30 — see decision 1). Deleting a reference is deleting text; there is no separate chip
row and no second removable-item collection. The composer's highlight overlay continues to match the
textarea content character for character, so the caret never drifts.

Insertion is unconditional and immediate: the absolute transcript path was already resolved when the
picker's data was fetched, so there is no check to fail and nothing to veto. The draft records the label
and its resolved path for the lifetime of the draft.

**What the agent receives.** At send, the app scans the composed message for `@session[…]` tokens and
prepends one line per unique label it has a recorded path for, above everything else in the body (above
the first quote block), followed by a blank line:

```
Referenced session @session[<label>]: <absolute transcript path>
```

The typed body keeps its inline tokens unchanged. The path is emitted as a plain labeled path, never as
an `@`-style file mention — an `@`-path would make the CLI inline the whole transcript into the prompt.
The labeled path lets the agent decide whether to read or search it.

A token with no recorded path — hand-typed, or picked in a draft the app no longer holds a resolution
for — contributes no reference line. The token stays in the body as plain text and the send proceeds.
Sending is never blocked by a reference, and the app never re-reads the filesystem at send time: a
session deleted after the picker's read still contributes its recorded line, and the agent discovers the
missing file when it tries to open it.

**How the sent message reads.** In the transcript, the user message shows each reference as a chip
carrying the reference label and nothing else — no path, no project label, no hover detail, not
clickable. Two separate stages produce that:

1. *Before markdown parsing*, the renderer strips the leading run of reference lines from the text it
   displays. They are machine payload; the user should not read a filesystem path in their own message.
   This is the same stage that already recognizes capture blocks, diff-review comments, and plan turns.
2. *While rendering the remaining prose*, each inline `@session[…]` token becomes chip chrome, through
   the same inline-directive seam that already turns `@file` mentions and a leading `/command` into
   inline chrome. That seam must reach tokens inside formatted paragraphs too: a paragraph mixing bold,
   italics, links, or code with a session token renders every token as a chip, not as raw text. Leading
   `/command` recognition stays confined to a paragraph's first run of text, so mixed formatting cannot
   invent a command chip mid-paragraph.

The message body itself is never rewritten — it still carries the labeled absolute path, which is what
the agent sees. Because both stages read only the body text, the optimistic local echo and the daemon's
confirmed echo render identically, with no flip at reconcile, and the chip reproduces on reload from the
replayed message. The label lives inside the line and the token rather than being looked up, so the chip
still renders after the referenced session is renamed, archived, or deleted.

A body whose text does not match the recognized shapes renders exactly as it does today.

**Transcript resolution.** Resolving chats to absolute transcript paths is a daemon read, requested for
the current project's candidate sessions in one call rather than per row or per keystroke. The picker
fetches it when the composer mounts and refreshes it when the popover opens. It is adapter-aware: it
never assumes the Claude layout for a non-Claude session, and it never trusts the chat record's stored
path blindly. Per chat it answers one of three things: *resolved* with an absolute path, *unavailable*
with a reason (never started, transcript missing), or *unknown* — the adapter cannot determine the
location. Only *resolved* chats are offered.

## Not Included

- `deferred` — Inline chips inside the composer's typed text; the composer keeps its plain textarea and
  color-only overlay.
- `declined` — Any chip row above the composer input, or any composer-side collection of picked sessions
  separate from the text.
- `declined` — Any wire-payload change for the sent-message chip: no structured per-message field, no
  daemon-side rewriting or stripping of the message body.
- `declined` — A clickable chip that navigates to the referenced session, and any project label, chat id,
  or path on the chip.
- `declined` — Cross-project references, and any picker ranking rule based on project (replaced by a hard
  same-project filter).
- `declined` — A pick-time failure path in the popover (an error slot on a row, an async veto over
  insertion). Offerability is settled before the row is shown.
- `declined` — Re-reading the transcript at send time, or any revalidation when an old message is
  re-rendered.
- `platform` — Rendering the chip outside the chat transcript (in-chat search results, notifications, the
  mobile client). Those consume the same body text and keep showing the labeled line.
- `deferred` — Changing how the receiving agent parses or acts on the referenced transcript, beyond
  emitting the labeled path.
- `deferred` — Surfacing transcript paths anywhere else in the product (sidebar, session details,
  reveal-in-Finder).
- `declined` — Summarizing, excerpting, or inlining transcript contents into the message.
- `deferred` — Permission or visibility rules beyond the same-project filter and the exclusions above.

## Edge cases

1. **No offerable sessions in the project** (a project's first session, or every transcript missing or
   unknown) — no session rows appear; the `@` popover is unchanged from today.
2. **Two sessions with the same title** — the picker shows and inserts distinct labels (`Foo`,
   `Foo (2)`), and referencing both produces two lines carrying two different paths.
3. **A label collides with one already in the draft for another session** — the insertion takes the next
   free suffix, so no two sessions in one draft ever share a token.
4. **Token typed by hand, never picked** — it tints in the composer and renders as a chip with that
   literal label, but contributes no reference line. It must not throw and must not block the send.
5. **Same session referenced twice** — one reference line; both inline tokens render as chips.
6. **Picking a session already referenced in the draft** — the same token is inserted again; the send-time
   scan collapses it to one line.
7. **Referenced session deleted between the picker's read and the send** — the recorded line is still
   prepended and reaches the agent with a path that no longer exists. The send is not blocked and no
   error is shown; the agent reports the missing file when it opens it. (This deviates from the design
   direction — see decision 12.)
8. **Referenced session archived, renamed, or deleted after send** — the chip still renders from the
   label carried in the token. The stored path may be stale; the chip makes no claim about it.
9. **Token inside a formatted paragraph** — `see **this** @session[Foo]` renders the chip, not raw text.
10. **Title containing markdown syntax** — backticks, `*`, `_`, `[`, `]`, `<`, `~~`, `#`, `|`, a bare URL,
    or an email address. This is a common class, not a corner: a title is the user's first message
    collapsed and truncated to 50 characters, or an LLM-written line. All of it is replaced when the label
    is built, so the token, the reference line, and the chip carry an inert label. Without that, a session
    titled ``Why does `useEffect` fire twice`` would insert ``@session[Why does `useEffect` fire twice]``,
    markdown would split the backtick pair into a code node, and the sent message would show the raw
    fragments ``@session[Why does `` and `` fire twice]`` instead of a chip. Newlines cannot reach a title,
    and the same rule removes them regardless.
11. **Title that sanitizes to nothing, or no title at all** — a session with no title, or one whose title
    is only punctuation or emoji, is offered under the same fallback display title the sidebar shows; the
    token is never `@session[]`.
12. **Two different titles sanitizing to the same label** — ``Fix `foo` handling`` and `Fix *foo*
    handling` both reduce to `Fix foo handling`, so the second takes the ` (2)` suffix, exactly as two
    identical titles do.
13. **Long label** — the sent-message chip truncates; the composer token does not truncate, because it is
    raw text.
14. **Caret placed back inside an inserted token** — the popover may reopen with the bracket text as its
    query, exactly as it would inside any other mention token. No matches, no special handling.
15. **A user types the reference-line shape by hand** — it is stripped from the rendered message like a
    real one. Accepted: the shape is specific enough that accidental collisions are not a practical
    concern.
16. **`@session[…]` must not be eaten by the plain-mention highlighter** — the session shape is
    recognized before the bare `@word` mention shape, in both the composer overlay and the message
    renderer, so `@session` never highlights as a file mention.
17. **Reference lines with an empty typed body** — a message that is only references sends and renders as
    chips with no prose.
18. **Multi-quote composition** — reference lines go above the entire composed message, before the first
    quote block, regardless of which segment held the token.

## Acceptance criteria

1. With at least two started sessions in a project, typing `@` plus part of another session's label lists
   that session in the trigger popover as a row in the same flat list as agents and files, with no group
   header, carrying a leading glyph that agent and file rows do not render; when a query matches all three
   kinds, the rendered order is agents, then sessions, then files and directories.
2. Selecting that row replaces the typed `@…` token with the exact literal text `@<label> ` in the
   composer, and changes no other character of the composer text; the sent body carries
   `@session[<label>]` in its place.
3. The composer's highlight overlay's concatenated `textContent` equals the textarea's `value` exactly
   while a session token is present.
4. The session token renders in the composer overlay with a color class distinct from the class applied
   to file mentions and to skills.
5. The sent message body contains a line matching `^Referenced session @session\[[^\]\n]*\]: /.+$` whose
   path is the referenced session's absolute transcript path; the body contains no raw CLI session id and
   no chat id.
6. The reference lines appear at the top of the body, followed by a blank line, ahead of any quote block.
7. Two tokens carrying the same label produce exactly one reference line.
8. With two offerable sessions whose labels are equal — identical titles, or titles that differ only in
   characters sanitization removes — the picker lists them with distinct labels (`<label>` and
   `<label> (2)`), and referencing both produces two reference lines whose paths are each session's own
   transcript path.
9. A hand-typed `@session[Nonexistent]` token produces no reference line, does not throw, and does not
   prevent the send.
10. The rendered sent user message shows one chip per inline token, labeled with the reference label and
    nothing else, and the reference lines are absent from the rendered text.
11. A message whose paragraph mixes markdown formatting with a session token (`see **this**
    @session[Foo]`) renders the bold text and the chip; no raw `@session[…]` text appears.
12. A session titled ``Why does `useEffect` fire twice`` is offered with the label `Why does useEffect
    fire twice`; the inserted token, the reference line, and the rendered chip all carry that same string;
    and the sent message renders one chip with no `<code>` element and no raw `@session[` fragment in its
    text. The same holds for a title containing `*`, `_`, `[`, `<`, `~~`, `www.example.com`, and
    `name@example.com`.
13. The chip is present in the optimistic local echo and in the daemon's confirmed echo with identical
    output — no path-then-chip flip and no flicker at reconcile.
14. Reloading the app and reopening the session reconstructs the chips from the replayed message text,
    including after the referenced session has been archived or deleted.
15. Sending a message with one or more references leaves exactly one user message in the transcript: one
    confirmed server message clears exactly one pending, with no duplicate or orphaned user message.
16. A user message whose text matches neither the reference-line shape nor the token shape renders
    byte-identically to how it renders today.
17. The picker does not offer: the active session, archived sessions, sessions in another project,
    sessions that have never started, sessions whose transcript resolution returned unavailable, or
    sessions whose transcript resolution returned unknown.
18. No offered session ever resolves to a Claude-shaped path when its adapter is not Claude.
19. Deleting a referenced session's transcript after the picker's read and before the send still sends the
    message with its reference line intact, shows no error in the UI, and issues no additional resolution
    request during the send.
20. The transcript-resolution route validates its input with Zod-equivalent schema validation, returns the
    standard `ok`/`fail` envelope, accepts a set of chat ids in one request, and returns per chat one of
    resolved (with an absolute path), unavailable (with a reason), or unknown.
21. Rust daemon tests cover the resolution route for: a Claude session whose transcript is present, a
    session whose transcript file is missing, a chat that has never started, a non-Claude adapter that
    resolves, and an adapter that returns unknown.
22. File, directory, and agent mention behavior is unchanged, including directory drill-down and the
    trailing-space insertion behavior — the existing trigger-engine and mention-adapter tests pass
    unmodified, and rows for those kinds render no glyph.
23. The picker row carries `data-testid="composer-mention-session-<chatId>"`, produced by a per-item
    test-id hook on the trigger configuration rather than the trigger-wide prefix. The sent-message chip
    carries `data-testid="chat-message-session-chip-<labelSlug>"`, where `labelSlug` is the reference
    label lowercased with each run of non-alphanumeric characters replaced by `-` and leading and
    trailing `-` trimmed.
24. Unit tests cover: picker search, merge ordering, each exclusion rule, and label disambiguation; label
    sanitization for a title carrying backticks, `*`, `[`, `<`, `~~`, a bare URL, and an email address,
    plus a title that sanitizes to empty; the reference-line format round-trip (compose → parse → same
    label and path); send-time de-duplication; and the rendered chip on an optimistic message, a replayed
    message, a markdown-formatted paragraph, and a message referencing a markdown-syntax title.
25. `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes and the changed UI test files pass; `cargo
    test` passes in `packages/core-rs`.
26. The picker row and its glyph, the composer token tint, and the sent-message chip go through the design
    gate (`needs-ui`) before the PR is marked ready.

## Decisions

1. **Inline mention token in the typed text, not a chip row above the composer.**
   `reversible` — Ruled at the design gate 2026-07-28, reversing the brief. Verified: `@` file mentions
   are already plain characters in the textarea tinted by a color-only overlay whose contract is that
   concatenated `textContent` equals the raw input, so a session token joins existing machinery with no
   caret risk and no new removable-item model.
   **Amended 2026-07-30:** the draft spells the token `@<label>`, not `@session[<label>]`. The overlay
   shows a token verbatim, so the wire form put `session[…]` on screen while typing — rejected on review.
   The bracket form survives on the wire (it delimits a title's spaces and keys the reference lines and
   the chip); `expandSessionMentions` rewrites the draft's own recorded labels at send, and the overlay
   tints them from the same list. A hand-edited label no longer matches, so it sends as plain text with
   no reference line — the same outcome a hand-typed unknown token already had (AC 9).
2. **Reference-line literal is `Referenced session @session[<label>]: <absolute path>`, one per line,
   prepended above the whole composition.** `hard-to-reverse` — Once messages ship with this shape, old
   messages only render as chips if the parser keeps recognizing it. Reusing the token form inside the
   line means one sanitization rule (decision 20) covers both, and pairs each line to its token
   unambiguously.
3. **The sent-message chip is derived at render time from the body text.** `hard-to-reverse` — The only
   mechanism that survives reload: replayed history is rebuilt from the CLI's own transcript and carries
   the message text and nothing else, so a structured per-message field could not reproduce the chip.
4. **Derivation is two stages, not one: the reference lines are stripped before markdown parsing, and the
   inline token becomes a chip at the existing inline-directive seam inside the rendered prose.**
   `hard-to-reverse` — Verified: only the whole-text strip can precede markdown; React chip chrome cannot
   be emitted before parsing without a placeholder/AST transform. The token path therefore rides
   `mainframeUserFormatter` + `createDirectiveText`, which already emit inline chrome for `@file` and
   `/command`. Documented because a plan that reads "recognize before markdown" as covering both stages
   would build the wrong thing.
5. **`DirectiveParagraph` must feed every string child through the formatter, not bail when `children` is
   not a string.** `reversible` — Verified at `features/chat/messages/UserMessage.tsx:80-83`: today a
   paragraph holding any formatting passes through untouched, so `see **this** @session[Foo]` would render
   the token raw. Command recognition stays limited to the first text run so the widened seam cannot
   invent a chip mid-paragraph. Fixing it also repairs `@file` mentions in formatted paragraphs.
6. **Sessions merge flat into the fuzzy results with a leading glyph; no group header.** `reversible` —
   Honors the design direction and matches the engine: `mention-adapter.ts` returns no categories and
   `navigation.ts` returns a flat list in search mode, so a headed group would mean new grouping in the
   engine. The glyph needs one additive change: `TriggerFieldPopover` renders an optional per-type icon,
   which today it does not do for any row. Order is agents → sessions → files, extending the adapter's
   existing agents-before-files merge.
7. **The reference label disambiguates duplicate titles with a numeric suffix; identity is never a chat
   id in the line or the token.** `hard-to-reverse` — Titles are not unique (`SessionRow.tsx:101` falls
   back to the literal `Untitled session`, and `chats.title` has no uniqueness constraint), so
   title-only tokens would let one line represent two sessions. The design gate ruled the chip carries no
   chat id; a suffix keeps that promise while making every token a unique key for the send-time scan.
   Hard to reverse because the suffix is baked into shipped message bodies.
8. **The sent-message chip's test id is keyed by a slug of the reference label, not by chat id.**
   `reversible` — The body carries no chat id by decision 7, so `chat-message-session-chip-<chatId>` is
   underivable at render time. The slug is domain-derived and stable, which is what the project's
   test-id rule requires; it is not an array index.
9. **The picker row's test id needs a new per-item test-id hook on `TriggerConfig`.** `reversible` —
   Verified: `TriggerFieldPopover.tsx:31` derives every row id from the trigger-wide prefix, which
   `ComposerTriggers.tsx:85` fixes to `composer-file-item`, so the design direction's
   `composer-mention-session-<chatId>` cannot be produced today. The hook is additive and leaves existing
   rows on the prefix.
10. **Offerability comes from one batched, adapter-aware daemon read of the project's candidate sessions,
    fetched per composer mount and per popover open — never per row per keystroke.** `reversible` —
    Reverses the earlier ruling that resolution happens on selection. Verified that selection-time
    resolution is not implementable as specified: `use-trigger-field.ts:118-133` inserts and emits before
    `onInserted` runs, so there is no veto and no async hook, and the popover has no error slot. It also
    reverses the "hidden, every row actionable" promise being unenforceable: `transcript_presence.rs:80-83`
    returns the previous flag on an indeterminate probe and `chat-to-thread-custom.ts:70` defaults
    `transcriptMissing` to false, so the thread-list flag alone would offer Codex sessions whose registry
    row is absent (`mainframe-adapter-codex/src/transcript.rs:26-44` returns `None` there). One batch call
    settles offerability before the row is drawn and makes selection a pure text insertion.
11. **Only *resolved* sessions are offered; *unknown* is treated as not offerable.** `reversible` — The
    brief's ruling ("where no transcript location is known, the session is simply not offerable"), now
    enforceable because the tri-state reaches the picker. Keeps every visible row actionable.
12. **No re-read at send time, and a stale recorded path is sent as-is.** `hard-to-reverse` in effect on
    the agent's experience, `reversible` in code — This *deviates from the design direction*, which ruled
    that a session deleted before send "fails at send; drop the reference line". Verified the send path is
    synchronous by design (it reads live composer state to avoid dropping just-typed text); making it
    await a daemon round-trip risks dropping the user's message, a worse failure than a path the agent
    finds missing. The design direction's intent — never block the send — is preserved. Overrule this if
    a stale path proves confusing in practice.
13. **Picker is scoped to the current chat's project.** `reversible` — Ruled by the user at the design
    gate, replacing the brief's "same-project first, project label on every row" ranking. Makes the
    project label redundant everywhere.
14. **Codex sessions are offerable when the daemon resolves their rollout path.** `reversible` — Corrects
    the brief, which assumed the rollout path is not surfaced. Verified: the Rust daemon resolves it from
    Codex's state store and contains it under `~/.codex/sessions`. Codex sessions whose registry row is
    missing return unknown and are hidden by decision 11.
15. **The brief's "widen the per-session payload with a chat id" is dropped.** `reversible` — Verified in
    the sessions view-model: the chat id is already the thread entry's `remoteId`, and the batch
    resolution read is keyed by it.
16. **De-duplication happens at send, not at insertion.** `reversible` — Insertion stays a pure text
    operation; the send-time scan already walks every token, and decision 7 makes labels unique per
    session so the scan cannot merge two sessions.
17. **Session matching is single-token substring on the label.** `reversible` — The trigger token is
    whitespace-bounded engine-wide; changing that would alter file and agent mention behavior, which is
    explicitly out of scope.
18. **A user-typed line matching the reference shape is stripped from the render.** `reversible` — The
    parser reads only the body, and disambiguating author intent would require the wire-payload change
    the brief rules out.
19. **The design direction's concrete component and token guidance is carried forward to the plan, not
    restated here.** `reversible` — Class names and token names are implementation; the behavior they
    encode (distinct token tint, session glyph, chip truncation, chip inline in the prose flow) is
    specified above.
20. **The reference label is sanitized to a markdown-inert character set when it is built — not escaped,
    and not merely stripped of `]` and newlines.** `hard-to-reverse` — Labels are baked into shipped
    message bodies, and by decision 4 the chip is produced *after* markdown parsing, where the formatter
    sees each string child of a paragraph in isolation. Any markdown-active character in the label splits
    the token across mdast nodes before the formatter runs, and the message shows raw fragments instead of
    a chip. The class is common, not exotic: titles are the user's first message collapsed and truncated
    to 50 characters (`packages/core-rs/crates/mainframe-chat/src/title_generator.rs:5-18`) or an LLM
    line, and `packages/ui/src/features/chat/messages/UserMessage.tsx:33` renders with `remark-gfm`, so
    backticks, `*`, `[`, `<`, `~~`, bare `www.` URLs, and email addresses all form nodes. Escaping was
    rejected: the label is matched literally in three places (token, reference line, chip), and a
    backslash-escaped label stops round-tripping byte-identically between them. `.`, `:`, `/`, and `@` are
    excluded to kill GFM autolink literals; `…` is kept because the fallback title's truncation marker
    uses it. Sanitization can map two distinct titles onto one label, which the existing numeric suffix
    already handles.
