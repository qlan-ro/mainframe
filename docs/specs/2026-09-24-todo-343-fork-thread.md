# Fork a chat into a new chat that inherits its conversation

Todo #343. Sources: the todo's `## Agent Brief` (revised after the two
2026-09-24 feedback rounds), and the final `## Design decision — 2026-09-24`.
That decision picked variant D, nested rows. Its prototype is on branch
`prototype/design-walk-2026-09-23-sessions-lineage` at commit d8000bdb, which
was never merged. The brief's claims were re-checked against `main` at 962e505b.
Where the brief and the code disagree, `## Decisions` records the ruling.

## Problem

A chat's history lives only in the vendor CLI's transcript. Mainframe cannot
branch a conversation. To try a second approach from the same point, a user has
two options, and both are bad. They can continue the one chat, which loses the
first line of work. Or they can start a new chat and re-explain everything.
Nothing in the chat model records that one chat came from another, so the
sidebar cannot show that two chats are related.

This todo adds one Fork action. It branches a chat at its current point into a
new chat that already has the parent's conversation in context. The two chats
then diverge. The sidebar nests each fork under its parent. Fork is an
adapter-agnostic Mainframe feature, and each adapter declares whether it can
fork. Claude forks natively in this todo. Codex reports that it cannot fork yet
(follow-up #368).

## Behavior

### The Fork action

- Fork is one action. It appears in the sidebar row's context menu and in the
  session tab's context menu.
- Fork is enabled only when all of these hold. Otherwise it is disabled with a
  `Hint` naming the first failing reason, in this order:
  1. The adapter cannot fork: "Forking isn't available for <adapter display name> chats yet".
  2. The chat has no provider session yet: "Nothing to fork yet".
  3. The chat's transcript is missing on disk: "This chat's transcript is missing".
  4. The chat's working directory is missing: "This chat's folder is missing".
  5. A turn is in flight, meaning the chat is working or waiting on a
     permission or question answer: "Wait for the current turn to finish or
     interrupt it".
- When the fork succeeds, the new chat opens as the active chat, just as if its
  row had been clicked. When it fails, an error toast shows the daemon's failure
  message, and nothing is created.
- Any chat the sidebar lists can be forked, including another fork. Lineage
  always points at the immediate parent.
- Codex chats show the Fork item disabled with reason 1. The item is never
  hidden.

### What a fork is

- **Inherited from the parent:** project, adapter, model, permission mode, plan
  mode, tuning (effort and the other per-chat tuning values), and the working
  directory it runs in and records.
- **Not inherited:** tags and the pinned state. The fork's cost and token
  counters start at zero. It is not unread when created, and it never belongs to
  an automation run, even if the parent did.
- **Parent reference:** the fork records the parent's id as its parent chat.
  The reference is generic. It names no relationship kind, and no user action
  can change it.
- **Fork point:** the moment of the Fork action. The fork holds the parent's
  conversation exactly as it stood then. That holds even if:
  - the fork's first message comes much later;
  - the parent receives more messages in between;
  - the daemon restarts in between.
  The daemon returns the new chat only after it has pinned the fork point.
- **The parent is never mutated:** its provider session id and transcript stay
  unchanged, both by the Fork action and by anything later sent in the fork. The
  parent's live CLI process, if one exists, is not interrupted or restarted.
  Nothing ever continues the parent's provider session in place on the fork's
  behalf.
- **Own session:** once the fork has run, its provider session id differs from
  the parent's. Every later resume of the fork uses the fork's own session.
- **History before the first message:** opening a fork before sending anything
  shows the parent's conversation up to the fork point, rendered like any
  resumed chat's history. After that, messages sent in either chat appear only
  in that chat.
- **Title:** the fork starts titled `<parent display title> (fork)`.
  - If the parent's title already ends with ` (fork)`, it is reused without
    adding a second marker.
  - An untitled parent yields `Untitled (fork)`.
  - The fork's first sent message runs title generation, just as a new chat's
    first message does. The generated title replaces the provisional one.
  - A rename by the user before that first message is kept, and no generated
    title replaces it.
  - If title generation is disabled or produces nothing, the provisional title
    stays.
- Every connected client sees the new chat appear through the existing
  chat-created broadcast.

### Lineage lifecycle

- The chat list and single-chat endpoints both return the fork's parent
  reference. The reference survives archive and unarchive of the fork and of the
  parent.
- Archiving the parent does not archive, move or change its forks, and archiving
  a fork does not change its parent.
- If the parent row no longer exists, the fork stays listed and openable, and
  its lineage reads "a deleted chat".

### Sidebar: nested rows (variant D)

- Nesting applies within every group of every sort mode (Recent, Name, Status,
  Project) and in the Pinned group.
  - Within a group, a fork whose parent is in the same group is placed directly
    beneath the parent.
  - All of a parent's descendants in that group form one contiguous block right
    after it, ordered depth-first, with siblings in the group's own sort order.
  - The block sits at the parent's own position in the group. A fork's activity
    never moves its parent.
- A nested fork row is indented with a left rule, the same recipe as the
  prototype's variant D.
  - Indentation goes one step per level and stops at two levels. Deeper
    descendants render at the second level.
  - A small `GitFork` glyph leads the title line
    (`data-testid="sessions-row-fork-nest-glyph"`).
  - The indented wrapper carries `data-testid="sessions-row-fork-nest"`.
  - The row itself stays a normal row, keyed by `data-chat-id`: clicking it
    opens the fork, and its context menu and hover card work as usual.
- Fallback glyph: a fork whose parent is not in the same group renders flat
  (unindented). A `GitFork` glyph goes in the meta-line's trailing glyph cluster
  (`data-testid="sessions-row-parent-link"`), inside a `Hint`. The Hint text and
  the click behavior depend on where the parent is:

  | Parent's state | Hint text | Click |
  | --- | --- | --- |
  | Listed in a different group | `Forked from "<parent title>" — in a different group, so it can't nest here` | Activates the parent and does not activate the fork's row |
  | Exists and not archived, but not currently listed (filtered out) | `Forked from "<parent title>"` | Same as above |
  | Archived | `Forked from "<parent title>" (archived)` | None (not interactive) |
  | No longer exists | `Forked from a deleted chat` | None (not interactive) |

- A chat that has forks gets no persistent row glyph.
- The row hover card shows two new lines, each with a `FieldLabel`, a `GitFork`
  icon and a value, styled like the card's other lines:
  - On a fork, `data-testid="sessions-meta-card-forked-from"`: label
    "Forked from". The value is the parent's title, with the same
    archived-suffix and deleted-chat wording as the fallback glyph.
  - On a parent, `data-testid="sessions-meta-card-fork-count"`: label "Forked".
    The value `<n>x` counts the listed, non-archived chats whose parent is this
    chat. The line is omitted when the count is 0.

### Chat header

- A fork's chat header shows a `GitFork` icon followed by "Forked from <parent
  title>" (`data-testid="chat-header-parent-link"`). Its click, archived and
  deleted-chat rules match the sidebar's fallback glyph.
- Non-forks and new-session drafts show no parent link.

### Menu placement

- Session context menu: a Fork item (`data-testid="sessions-ctx-fork"`), placed
  after Open in Split and before the separator above Archive.
- Session tab context menu: a Fork item (`data-testid="session-tab-ctx-fork"`),
  placed after the split item (Open in Split or Close Split) and Keep Open, and
  before the separator above Close.

### Daemon contract

- The fork command is a REST command beside interrupt and resume. It accepts no
  body or an empty JSON object.
- Success returns the `ok` envelope carrying the new chat.
- Failures return the `fail` envelope and create no chat row:

  | Request | Status | Message |
  | --- | --- | --- |
  | Malformed body, unknown field, or empty id | 400 | Validation error |
  | Unknown chat id | 404 | Not found |
  | Adapter cannot fork | 422 | Names the adapter's display name |
  | No provider session, turn in flight, transcript missing, or directory missing | 409 | Names the reason |
  | The fork point cannot be pinned (for example, the CLI failed) | 500 | Failure message |

- Adapter info returned to clients includes a fork capability. It is true for
  Claude and false for Codex. Older payloads without the capability are treated
  as unable to fork.

## Not Included

- Codex fork support, tracked in #368. Codex reports it cannot fork yet. `deferred`
- Nesting a fork under a parent that sits in a different group; that case uses
  the fallback glyph. `declined`
- A persistent row glyph on chats that have forks. The count appears only in the
  hover card. `deferred`
- Forking from an earlier message ("rewind and fork"). v1 forks from the current
  end of the conversation. `deferred`
- A context-replay fork for adapters with no native fork mechanism. `deferred`
- An ACP facade method for forking. Forking is REST-only. `declined`
- Moving transcripts out of the vendor CLI's files. `declined`
- Fork UI in the mobile app. Mobile ignores the new field. `deferred`
- A slash command, keyboard shortcut or command-palette entry for Fork. `deferred`
- Side chats (#344) and temporary sessions (#346). Both reuse the parent
  reference later. `deferred`

## Edge cases

- **The parent is messaged after the fork but before the fork's first message.**
  Those messages never appear in the fork.
- **The daemon restarts between the fork and its first message.** The fork still
  opens with the parent's history up to the fork point, and its first send does
  not continue the parent's session.
- **The same chat is forked twice, even rapidly.** This yields two independent
  forks, both nested under the parent in the group's sort order.
- **A fork is forked.** The new chat's parent is the fork, not the root.
  Indentation stops at two levels.
- **Parent and fork land in different groups.** This happens when one is pinned
  and the other is not, or when they fall in different recency buckets. The fork
  uses the fallback glyph with the "different group" wording.
- **A tag filter hides the parent.** The fork falls back with the "filtered out"
  wording, and clicking the glyph still activates the parent.
- **The parent is archived, then unarchived.** While archived, the fork shows the
  archived wording and is not interactive. After unarchive, the fork nests again
  when both chats are in the same group.
- **The parent's row no longer exists.** The fork shows "a deleted chat" in the
  row, the hover card and the header, and it works normally.
- **Lineage data is corrupt,** such as a self-reference or a cycle. The rows
  render flat without hanging, and a chat never counts itself as its own fork.
- **The parent has background tasks still running but no turn in flight.** Fork
  is allowed. Background tasks are not carried into the fork.
- **A turn starts after the menu opened with Fork enabled.** The daemon refuses
  with the in-flight 409, and the UI shows the error toast.
- **The parent is open in another zone or tab.** It stays open and untouched.
- **Pinning the fork point fails,** for example because the CLI is missing or
  crashes. The request fails and no chat row remains.
- **The user renames the fork before its first message.** The rename is kept and
  no generated title replaces it.
- **The project is removed.** Existing behavior deletes all of its chats,
  including the parent and its forks.

## Acceptance criteria

1. Forking a Claude chat through the REST command returns `ok` with a new chat
   whose parent reference equals the parent's id. Loading the new chat's
   messages returns the parent's messages up to the fork point, both before and
   after the fork's first message.
2. A message sent in the fork leaves the parent's stored provider session id and
   its transcript's message list unchanged. A message sent in the parent does not
   appear in the fork. This holds for a parent message sent after the fork but
   before the fork's first message.
3. After the fork, the daemon restarts, and then the fork's first message is
   sent. The fork's messages still contain the parent's history up to the fork
   point and nothing sent to the parent afterward. The parent's provider session
   id and transcript are unchanged.
4. Once the fork has run a turn, its stored provider session id is non-empty and
   differs from the parent's.
5. A Rust test asserts two things about the Claude spawn arguments. For a fork
   whose own session is not yet known, the arguments resume the parent's session
   with the fork-session flag. After the fork has its own session id, the
   arguments resume that id without the fork-session flag. No code path yields
   the parent's session id without the fork-session flag for a fork.
6. Forking a chat whose adapter reports no fork capability (Codex, or the mock
   adapter configured to report none) returns 422 `fail`. The message contains
   the adapter's display name, and the chat count is unchanged.
7. Each of these returns `fail` with the status from the Daemon contract table
   and leaves the chat count unchanged:
   - a chat with a turn in flight (409);
   - a chat with no provider session (409);
   - a chat with a missing transcript (409);
   - an unknown chat id (404);
   - a body with an unknown field (400).
8. The fork records, and its CLI process runs in, the same working directory as
   its parent.
9. The fork's parent reference is returned by both the chat list endpoint and
   the single-chat endpoint. It is still present after archiving and
   unarchiving the fork. Archiving the parent leaves the fork listed and its
   messages loadable.
10. With the parent's row removed from storage, the fork is still listed and
    openable. Its header and fallback glyph read "a deleted chat" and are not
    interactive.
11. The fork has the parent's adapter, model, permission mode, plan mode and
    tuning. It has no tags and is not pinned. Its title is `<parent title>
    (fork)` until the first message's generated title replaces it. With title
    generation disabled, the provisional title remains after the first message.
12. The adapters endpoint returns a fork capability: true for Claude, false for
    Codex.
13. In a group containing a parent and its fork, the fork's row directly follows
    the parent's row in DOM order and sits inside `sessions-row-fork-nest` with
    `sessions-row-fork-nest-glyph`. Both rows keep their `data-chat-id`. A
    view-model unit test covers:
    - nesting in each sort mode;
    - descendant block contiguity;
    - the two-level indent cap;
    - a fork whose parent is in another group staying unnested;
    - a self-referencing chat rendering flat.
14. A fork whose parent is in a different group renders unindented with
    `sessions-row-parent-link`, and its Hint text matches the Sidebar section.
    Clicking the glyph activates the parent, and the fork's row does not become
    active. For an archived parent, the Hint reads `(archived)` and clicking
    does nothing.
15. The hover card shows `sessions-meta-card-forked-from` with the parent title
    on a fork. On a parent with two listed forks it shows
    `sessions-meta-card-fork-count` reading `2x`. On a chat with no forks it
    shows neither line.
16. A fork's chat header shows `chat-header-parent-link` reading "Forked from
    <parent title>", and clicking it activates the parent. A non-fork's header
    has no such element.
17. `sessions-ctx-fork` sits between `sessions-ctx-open-split` and the Archive
    separator. `session-tab-ctx-fork` sits before the Close separator. For each
    of these cases, both items are disabled with the exact Hint text from the
    Behavior list:
    - an adapter without the fork capability;
    - a chat with no provider session;
    - a working chat;
    - a waiting chat.
    Otherwise both are enabled, and activating one opens the returned fork as
    the active chat.
18. UI tests cover:
    - the nested row and the fallback glyph;
    - the hover-card lines;
    - the header link;
    - each menu item's enabled state and every disabled reason.
19. Rust tests cover:
    - the fork route: success, unsupported adapter, running chat, no-session
      chat, unknown chat, and an unknown field;
    - persistence of the parent reference through archive and unarchive;
    - the storage migration adding the parent reference, applied to an existing
      database;
    - the Claude fork spawn arguments from AC 5.
20. A changeset is included.

## Decisions

- Variant D (nested rows) governs sidebar lineage. It supersedes the brief's
  wording that every fork shows a `sessions-row-parent-link` glyph: that glyph
  now appears only in the fallback. This follows the user's final live-review
  decision of 2026-09-24. `reversible`
- The parent reference is one generic nullable field on the chat row, with no
  kind column. Side chats (#344) reuse it. A storage migration is involved.
  `hard-to-reverse`
- Codex fork is split out to #368, and Codex reports the capability as false.
  Flipping the capability is enough to turn it on later. `reversible`
- The fork point is pinned at the Fork action, and the daemon returns only after
  pinning. Pinning could mean spawning the fork now or resuming up to the
  parent's last message; the planner chooses and must verify the choice against
  the live Claude CLI. This is the only way to satisfy AC 2 and AC 3 without
  depending on timing. `hard-to-reverse`
- A turn in flight includes the "waiting" state, meaning a pending permission
  request or question. While the parent is waiting, the fork point is just as
  ambiguous as while it is working. `reversible`
- Fork is also refused when the transcript or working directory is missing,
  because there is nothing valid to fork. The chat model already carries both
  flags. `reversible`
- The brief's "deleting a parent" case is recast as a dangling reference. The
  daemon has no single-chat delete; only project removal deletes chats, and that
  removes the forks too. The fork must still tolerate a missing parent row.
  `reversible`
- Forks trigger title generation on their first message even though they have
  a provisional title. Today generation runs only when the title is empty
  (`assign_initial_title`), which would leave `(fork)` titles in place forever.
  A rename before the first message still wins. `reversible`
- The fork marker is ` (fork)` and is never stacked. Stacked markers become
  unreadable after a few levels, and the lineage UI already shows depth.
  `reversible`
- Nesting applies in every sort mode, including Status and Name. The design
  offered one rule for all modes. The risk is that a busy fork sits under an
  idle parent in Status mode; revisit if users object. `reversible`
- A descendant block sits at its root parent's position rather than at its most
  active member's position. A fork's activity should not move its parent, and
  this keeps the prototype's adjacency model. `reversible`
- Nested indentation stops at two levels. The prototype showed one level; two
  keeps fork-of-fork readable without using up the narrow sidebar. `reversible`
- An archived or deleted parent's lineage link is not interactive. Archived
  chats can only be restored from the Archived dialog, not opened. `reversible`
- The hover-card fork count covers listed, non-archived direct forks only. The
  client only has listed chats, and it stays consistent with what nesting
  shows. `reversible`
- The fork inherits plan mode, and its counters start at zero. "Adapter config
  and tuning yes" in the brief covers plan mode, and cost and tokens belong to
  the fork's own spend. `reversible`
- Failure statuses are 400, 404, 409, 422 and 500 as tabled. This keeps the
  unsupported-capability refusal distinct from state conflicts the user can
  resolve by waiting. `reversible`
- The tab-menu test id is `session-tab-ctx-fork`, following that menu's
  existing `session-tab-ctx-<action>` convention. `reversible`
