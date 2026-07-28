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

**Picking a session.** Typing `@` in the composer opens the existing trigger popover. Alongside the
agents and project files it already offers, it now lists sessions, in their own group with a distinct
leading glyph. Sessions are matched by a case-insensitive substring of the typed token against the
session title, the same matching the other `@` sources use. The typed token is whitespace-bounded, so a
multi-word query is not possible — as is already true for files and agents.

**Which sessions are offered.** Only sessions in the *current chat's project*. Cross-project references
are not possible, so no row shows a project label. Also excluded, and hidden rather than shown disabled:
the session the user is composing in, archived sessions, sessions that have never started, sessions whose
transcript is known to be missing, and sessions on an adapter whose transcript location the app cannot
resolve. Every visible row is actionable. When no session in the project qualifies, the sessions group
does not appear and the popover behaves exactly as it does today.

**What selection inserts.** Selecting a session replaces the typed `@` token with the literal text
`@session[<title>]`, followed by one space — the same insertion path a file or agent mention uses. The
title is the session's displayed title, with `]` and newline characters removed. The composer shows that
token literally, tinted in a color of its own, distinct from the tint used for file mentions and skills.
Deleting a reference is deleting text; there is no separate chip row and no second removable-item
collection. The composer's highlight overlay continues to match the textarea content character for
character, so the caret never drifts.

Before the token is inserted, the app resolves the session's transcript to an absolute path. If
resolution fails, nothing is inserted and the popover shows the reason inline on that row; the user's
typed text is untouched.

**What the agent receives.** At send, the app scans the composed message for `@session[…]` tokens and
prepends one line per unique referenced session, above everything else in the body (above the first
quote block), followed by a blank line:

```
Referenced session @session[<title>]: <absolute transcript path>
```

The typed body keeps its inline tokens unchanged. The path is emitted as a plain labeled path, never as
an `@`-style file mention — an `@`-path would make the CLI inline the whole transcript into the prompt.
The labeled path lets the agent decide whether to read or search it.

A token whose session has no resolved transcript at send time — hand-typed, or picked in a draft the app
no longer holds a resolution for — contributes no reference line. The token stays in the body as plain
text and the send proceeds. Sending is never blocked by a reference.

**How the sent message reads.** In the transcript, the user message shows the reference as a chip
carrying the session title and nothing else — no path, no project label, no hover detail, not clickable.
The renderer derives this from the message's raw text before markdown parsing, the same stage that
already recognizes capture blocks, diff-review comments, and plan turns: it strips the leading run of
reference lines from the displayed text and replaces each inline `@session[…]` token with chip chrome.
The remaining prose renders as it does today. The message body itself is never rewritten — it still
carries the labeled absolute path, which is what the agent sees.

Because the derivation reads only the body text, the optimistic local echo and the daemon's confirmed
echo render identically, with no flip at reconcile, and the chip reproduces on reload from the replayed
message. The title lives inside the line and the token rather than being looked up, so the chip still
renders after the referenced session is renamed, archived, or deleted.

A body whose text does not match the recognized shapes renders exactly as it does today.

**Transcript resolution.** Resolving a chat to an absolute transcript path is a daemon read. It is
adapter-aware: it never assumes the Claude layout for a non-Claude session, and it never trusts the
chat record's stored path blindly. It returns either a resolved absolute path, or an unavailable result
carrying a reason the picker can show (never started, transcript missing, adapter unsupported).

## Not Included

- `deferred` — Inline chips inside the composer's typed text; the composer keeps its plain textarea and
  color-only overlay.
- `declined` — Any chip row above the composer input, or any composer-side collection of picked sessions
  separate from the text.
- `declined` — Any wire-payload change for the sent-message chip: no structured per-message field, no
  daemon-side rewriting or stripping of the message body.
- `declined` — A clickable chip that navigates to the referenced session, and any project label or path
  on the chip.
- `declined` — Cross-project references, and any picker ranking rule based on project (replaced by a hard
  same-project filter).
- `platform` — Rendering the chip outside the chat transcript (in-chat search results, notifications, the
  mobile client). Those consume the same body text and keep showing the labeled line.
- `deferred` — Changing how the receiving agent parses or acts on the referenced transcript, beyond
  emitting the labeled path.
- `deferred` — Surfacing transcript paths anywhere else in the product (sidebar, session details,
  reveal-in-Finder).
- `declined` — Summarizing, excerpting, or inlining transcript contents into the message.
- `declined` — Re-validating a referenced transcript's continued existence when an old message is
  re-rendered.
- `deferred` — Permission or visibility rules beyond the same-project filter and the exclusions above.

## Edge cases

1. **No offerable sessions in the project** (a project's first session, or every transcript missing) —
   the sessions group is absent; the `@` popover is unchanged from today.
2. **Token typed by hand, never picked** — it tints in the composer and renders as a chip with that
   literal title, but contributes no reference line. It must not throw and must not block the send.
3. **Same session referenced twice** — one reference line (de-duplicated by chat); both inline tokens
   render as chips.
4. **Picking a session already referenced in the draft** — the token is inserted again like any other
   text insertion; de-duplication happens at send, not at insertion.
5. **Referenced session archived, renamed, or deleted after send** — the chip still renders from the
   title carried in the token. The stored path may be stale; the chip makes no claim about it.
6. **Resolution fails at pick time** — no text is inserted, no chip appears, and the popover row shows
   the reason. Never insert a token that resolves to nothing.
7. **Title containing `]` or a newline** — those characters are removed at insertion, so the token and
   the reference line always parse.
8. **Empty title** — a session with no title is offered under its fallback display title, the same one
   the sidebar shows; the token is never `@session[]`.
9. **Long title** — the sent-message chip truncates; the composer token does not truncate, because it is
   raw text.
10. **Caret placed back inside an inserted token** — the popover may reopen with the bracket text as its
    query, exactly as it would inside any other mention token. No matches, no special handling.
11. **A user types the reference-line shape by hand** — it is stripped from the rendered message like a
    real one. Accepted: the shape is specific enough that accidental collisions are not a practical
    concern.
12. **`@session[…]` must not be eaten by the plain-mention highlighter** — the session shape is
    recognized before the bare `@word` mention shape, in both the composer overlay and the message
    renderer, so `@session` never highlights as a file mention.
13. **Reference lines with an empty typed body** — a message that is only references sends and renders as
    chips with no prose.
14. **Multi-quote composition** — reference lines go above the entire composed message, before the first
    quote block, regardless of which segment held the token.

## Acceptance criteria

1. With at least two started sessions in a project, typing `@` plus part of another session's title in
   the composer lists that session in the trigger popover, in a group distinct from agents and files.
2. Selecting that row replaces the typed `@…` token with the exact literal text `@session[<title>] ` in
   the composer, and changes no other character of the composer text.
3. The composer's highlight overlay's concatenated `textContent` equals the textarea's `value` exactly
   while a session token is present.
4. The session token renders in the composer overlay with a color class distinct from the class applied
   to file mentions and to skills.
5. The sent message body contains a line matching `^Referenced session @session\[[^\]\n]*\]: /.+$` whose
   path is the referenced session's absolute transcript path; the body contains no raw CLI session id.
6. The reference lines appear at the top of the body, followed by a blank line, ahead of any quote block.
7. Two tokens naming the same session produce exactly one reference line.
8. A hand-typed `@session[Nonexistent]` token produces no reference line, does not throw, and does not
   prevent the send.
9. The rendered sent user message shows one chip per inline token, labeled with the title and nothing
   else, and the reference lines are absent from the rendered text.
10. The chip is present in the optimistic local echo and in the daemon's confirmed echo with identical
    output — no path-then-chip flip and no flicker at reconcile.
11. Reloading the app and reopening the session reconstructs the chips from the replayed message text,
    including after the referenced session has been archived or deleted.
12. Sending a message with one or more references leaves exactly one user message in the transcript: one
    confirmed server message clears exactly one pending, with no duplicate or orphaned user message.
13. A user message whose text matches neither the reference-line shape nor the token shape renders
    byte-identically to how it renders today.
14. The picker does not offer: the active session, archived sessions, sessions in another project,
    sessions that have never started, sessions flagged transcript-missing, or sessions on an adapter with
    no resolvable transcript location.
15. No offered session ever resolves to a Claude-shaped path when its adapter is not Claude.
16. When resolution fails on selection, no text is inserted and the popover row shows the reason.
17. The transcript-resolution route validates its input with Zod-equivalent schema validation, returns
    the standard `ok`/`fail` envelope, and distinguishes a resolved path from an unavailable result
    carrying a reason.
18. Rust daemon tests cover the resolution route for: a Claude session whose transcript is present, a
    session whose transcript file is missing, a chat that has never started, and a non-Claude adapter.
19. File, directory, and agent mention behavior is unchanged, including directory drill-down and the
    trailing-space insertion behavior — the existing trigger-engine and mention-adapter tests pass
    unmodified.
20. Every new interactive element carries a stable `data-testid` keyed by the session's chat id:
    `composer-mention-session-<chatId>` on the picker row and `chat-message-session-chip-<chatId>` on the
    sent-message chip.
21. Unit tests cover: picker search, group ordering, and each exclusion rule; the reference-line
    format round-trip (compose → parse → same title and path); send-time de-duplication; and the rendered
    chip on both an optimistic and a replayed message.
22. `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes and the changed UI test files pass; `cargo
    test` passes in `packages/core-rs`.
23. The picker row, the composer token tint, and the sent-message chip go through the design gate
    (`needs-ui`) before the PR is marked ready.

## Decisions

1. **Inline `@session[<title>]` token in the typed text, not a chip row above the composer.**
   `reversible` — Ruled at the design gate 2026-07-28, reversing the brief. Verified: `@` file mentions
   are already plain characters in the textarea tinted by a color-only overlay whose contract is that
   concatenated `textContent` equals the raw input, so a session token joins existing machinery with no
   caret risk and no new removable-item model.
2. **Reference-line literal is `Referenced session @session[<title>]: <absolute path>`, one per line,
   prepended above the whole composition.** `hard-to-reverse` — Once messages ship with this shape, old
   messages only render as chips if the parser keeps recognizing it. Reusing the token form inside the
   line means one sanitization rule (`]` and newlines stripped) covers both the token and the line, and
   pairs each line to its token unambiguously.
3. **The sent-message chip is derived at render time from the body text, at the seam shared by the
   optimistic and confirmed message.** `hard-to-reverse` — The only mechanism that survives reload:
   replayed history is rebuilt from the CLI's own transcript and carries the message text and nothing
   else, so a structured per-message field could not reproduce the chip. Confirmed against the existing
   pre-markdown recognizers for plan turns, capture blocks, and diff-review comments.
4. **The renderer strips the reference lines from the displayed text.** `reversible` — They are machine
   payload; showing a user their own filesystem path in their own message is noise. Ruled at the design
   gate.
5. **Chip carries the title only — no path, no project label, not clickable.** `reversible` — The line
   carries no chat id, so there is nothing to navigate to and nothing to break when the session is later
   renamed or deleted. Ruled at the design gate.
6. **Picker is scoped to the current chat's project.** `reversible` — Ruled by the user at the design
   gate, replacing the brief's "same-project first, project label on every row" ranking. Makes the
   project label redundant everywhere.
7. **Offerability is filtered from data the picker already holds; the absolute path is resolved on
   selection, not for every listed row.** `reversible` — The session list payload already carries
   project id, adapter id, CLI session id, archived status, and a transcript-missing flag, and the chat
   id is available as the thread entry's `remoteId`. One resolution call per pick beats N calls per
   keystroke, and it matches the brief's ruling that a failed resolution rejects the pick.
8. **The brief's "widen the per-session payload with a chat id" is dropped as unnecessary.**
   `reversible` — Verified in the sessions view-model: the chat id is already the thread entry's
   `remoteId`. Adding a field would be dead weight.
9. **Codex sessions are offerable.** `reversible` — Corrects the brief, which assumed Codex's rollout
   path is not surfaced. Verified: the Rust daemon already resolves the Codex rollout path from Codex's
   state store and contains it under `~/.codex/sessions`. Any adapter that cannot answer stays
   unofferable, which today means only the mock adapter and any future one.
10. **No re-read of the transcript from disk at send time.** `reversible` — The send path is synchronous
    by design (it reads live composer state to avoid dropping just-typed text); making it await a daemon
    round-trip risks a worse failure than a stale path. A token with no resolution recorded emits no
    line, which satisfies the design direction's "never block the send".
11. **De-duplication happens at send, not at insertion.** `reversible` — Insertion stays a pure text
    operation with no knowledge of the rest of the draft; the send-time scan already walks every token.
12. **Session matching is single-token substring on the title.** `reversible` — The trigger token is
    whitespace-bounded engine-wide; changing that would alter file and agent mention behavior, which is
    explicitly out of scope.
13. **A user-typed line matching the reference shape is stripped from the render.** `reversible` — The
    parser reads only the body, and disambiguating author intent would require the wire-payload change
    the brief rules out.
14. **The design direction's concrete component and token guidance is carried forward to the plan, not
    restated here.** `reversible` — Class names and token names are implementation; the behavior they
    encode (distinct token tint, chip truncation, chip inline in the prose flow) is specified above.
