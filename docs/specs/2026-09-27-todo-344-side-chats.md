# Side chats (always temporary)

Todo #344. Sources: the todo's `## Agent Brief`, its 2026-09-24 feedback (no
conversation survives a daemon restart), and its approved design direction (the
compact side-chat panel notice). Brief claims were re-checked against `origin/main`
at `1a33c008`. The prerequisites are merged: #346 (temporary chats, no-persistence
capability, context-loss notice, discard) in #718, #343 (the parent-chat reference) in
#717, and #178 (idle offload) in #720. Conflicts with the brief or the design
direction are recorded in `## Decisions`.

## Problem

Every conversation in Mainframe is a first-class session. It is listed in the sidebar,
takes a tab, and has to be archived later. A quick side question such as "what does
this error mean" or "summarize what we just did" costs a permanent session row. #346
added temporary chats, but they still show up in the sidebar as sessions of their own.

A side chat is a throwaway conversation attached to the chat you are looking at. It
shares that chat's project and working directory, starts empty, is never listed as a
session, and is deleted when you are done with it.

## Behavior

**What a side chat is.** A side chat is a temporary chat (#346) whose parent is
another chat. It uses the parent's working directory (the parent's worktree if it has
one, otherwise the project root, and for a non-project parent the parent's scratch
directory). It also uses the parent's adapter, and the parent's model and permission
mode at the moment it is created. It starts with an empty conversation. It does not
inherit the parent's messages; forking does that. A parent has at most one side chat.
A side chat cannot have a side chat of its own. Creating the side chat does not start
a CLI process. The first message does, like any chat.

**Opening.** "Open side chat" is offered in the session row context menu, in the
session tab context menu, and as a toggle in the parent chat's header. Opening a side
chat on a chat that already has one reveals the existing side chat. It never creates a
second one. If the chosen chat is not on screen, it is activated first, the same way a
click would activate it. The action is not offered on drafts, archived chats, or side
chats. Opening fails when the parent is archived, is itself a side chat, or has a
missing working directory. In each case the user sees an error and no side chat is
created.

**The panel.** The side chat renders as a panel docked at the bottom of its parent's
chat column. It lives inside whatever pane shows the parent. In the single chat view
that is the main chat surface. In a split it is the parent's zone. The other zone is
unaffected, and the split stays two zones. The panel moves with the parent: whichever
zone or view shows the parent also shows the panel.

The panel has a header, the side chat's transcript, and a composer. The header reads
"Side chat" and shows the side chat's running/waiting status, a collapse control, and
a close control. By default the panel takes about 40% of the column's height. The
user can resize it by dragging its top edge, down to the height that the header and
composer need. The composer works like a normal chat composer, with model and
permission controls. It offers no adapter switch, no worktree controls, and no
Temporary toggle.

**Collapse versus close.** Collapse hides the panel and keeps the side chat alive.
Collapsed or expanded is remembered per parent on the device, and survives a UI
reload. Close discards the side chat through #346's discard, which stops its process,
drops any pending gate, and deletes the row. Close asks for no confirmation. The next
open creates a new, empty side chat.

**Status is visible without hunting.** The header toggle on the parent reflects
whether a side chat exists. While the panel is collapsed, the toggle also shows the
side chat's running or waiting state. If the side chat raises a permission or question
gate while its parent is on screen, the panel expands so the gate is visible. While
the side chat is waiting and its parent is not on screen, the parent's sidebar row and
session tab show the waiting state.

**Never a session.** A side chat never appears in any chat listing, even when the
caller opts in to temporary chats. That covers the sidebar, the command palette, the
archived-sessions dialog, and both REST list endpoints. Fetching a side chat by id
still works. The parent's chat payload tells clients which side chat it has, if any.
A side chat can never be pinned, tagged, archived, forked, opened in a split, or added
to the session tab strip. The parent's fork-lineage surfaces (forked-from link,
nested rows, fork counts) never treat a side chat as a fork.

**Within one daemon run.** Switching to another session and back brings the same side
chat back, with its conversation intact. Its CLI stays alive and its messages come from
the in-memory cache.

**After its CLI goes away.** A side chat follows #346's rule for temporary chats
unchanged. When its adapter reports the no-persistence capability, its CLI writes no
vendor transcript. A daemon restart, a CLI exit, or an idle offload therefore loses the
conversation. The row, the parent relationship, and the parent's toggle all survive.
Reopening the parent shows the panel (unless collapsed) with an empty transcript and the
compact "Earlier context was not preserved" note. It is not an error, it is not the
degraded card, and it is not the transcript-missing card. The next message starts a
fresh vendor session in the same side chat, with no resume, and the new provider session
id replaces the old one.

When the adapter does not report the capability, the side chat gets only the
Mainframe-level temporary behavior. It resumes with its history after a restart, like
any chat.

**The panel's notice.** The notice is a slim single line directly under the panel's
header. It has a small glyph and muted text, with no boxed card and no separator
lines. It is a compact variant of #346's notice, not a second design. It has two
states, and the panel never shows both:
- The capability is on and the side chat has lost context: **"Earlier context was not
  preserved"**, with #346's `History` glyph. It has a dismiss control and shares #346's
  dismissal rule: dismissed per chat on the device, and shown again after a later loss.
- The capability is off: **"This provider keeps its own transcript for this chat."**,
  with a neutral glyph. It is always shown and cannot be dismissed.

The panel never shows #346's full-size Alert, and no side-chat surface says or implies
that nothing was saved. The capability is read from the adapter info, never from an
adapter id.

**Cascades.** A side chat is discarded, with its process stopped and its row deleted,
when:
- the user closes it;
- its parent is archived (before any worktree removal that the archive requests);
- its parent is discarded, when the parent is itself a temporary chat;
- its parent's project is removed.

## Not Included

- The temporary-chat primitive, no-persistence, the context-loss notice, and non-project
  chats themselves. #346 shipped them, and this todo adds no adapter code. — declined
- Copying the parent's conversation into the side chat. That is forking. — declined
- More than one side chat per parent, or side chats of side chats. — declined
- Promoting a side chat into a permanent session. — deferred
- Messaging between a side chat and its parent, such as "send to parent". — deferred
- Preserving, storing, or replaying a side chat's conversation across a restart, an
  offload, or a respawn. — declined
- Opening a side chat from the command palette, or with a keyboard shortcut. — deferred
- Keeping a side chat's CLI alive past the idle-offload threshold. — declined
- Copying the parent's later model or permission changes into an existing side chat.
  — declined
- Side chats in the mobile app, which never lists them. Mobile push notifications for a
  side chat's gate get no special routing. — platform

## Edge cases

- **Two opens race on the same parent** (double click, two clients): exactly one side
  chat row exists afterwards, and both callers get it.
- **Parent archived while the side chat is mid-turn or has a pending gate:** the side
  chat's process is stopped, the gate is dropped, and its row is deleted. The archive
  itself succeeds.
- **Parent archived with worktree deletion:** the side chat is discarded before the
  worktree is removed, so no side-chat process is left running in a deleted directory.
- **Parent unarchived:** no side chat comes back. The next open starts a new one.
- **Non-project parent:** the side chat runs in the parent's scratch directory.
  Discarding the side chat never removes that directory. If the directory does not
  exist yet, it is created on the side chat's first spawn at the parent's path.
- **Parent's worktree goes missing while a side chat exists:** the side chat shows the
  same missing-directory handling as any chat.
- **Side chat idle past the offload threshold** (a Claude side chat with no persistence):
  it is offloaded like any chat. Reopening it shows an empty transcript and the compact
  not-preserved note, the same as after a restart.
- **Restart before the side chat ever spawned a CLI:** there was no context to lose, so
  the panel shows no not-preserved note.
- **Side chat closed from another client, or removed by a cascade, while its panel is
  open:** the panel disappears and the parent's toggle returns to its no-side-chat
  state. No error is shown.
- **Close fails** (daemon unreachable): the panel stays, and an error toast is shown.
- **A side chat id reaches a navigation path** (a deep link, a stale tab entry, or a
  search or notification link): the parent is activated with the panel expanded. The id
  is never admitted to the tab strip, a zone, or the sidebar.
- **Parent is dragged between zones, or the split is dissolved:** the panel follows the
  parent and keeps its collapsed or expanded state.
- **Adapter capability changes between daemon versions:** each spawn decides from the
  current capability (#346). The panel's notice follows the capability that the adapter
  info reports now.
- **Parent is a temporary chat:** opening a side chat is allowed. Discarding the parent
  discards the side chat as well.
- **Parent has a turn in flight:** a side chat can still be opened and used. The two
  CLI processes are independent.

## Acceptance criteria

1. A single REST command opens a chat's side chat, or reveals the existing one. Its
   body and path are serde-validated, and every response uses the `ok`/`fail`
   envelope. On a parent with no side chat it returns `ok` with a new chat that is
   temporary, has the parent's id as its parent, and has the parent's project, adapter,
   model, permission mode, and worktree. Called again on the same parent, it returns
   the same chat id. No second row is written.
2. The open command returns `fail`, and writes no row, when the parent id is unknown,
   the parent is archived, the parent is itself a side chat, or the parent's working
   directory is missing.
3. Two concurrent open commands on the same parent leave exactly one side chat row.
4. The existing discard command deletes a side chat's row and stops its process. A
   later open on the same parent returns a different chat id with no messages.
5. A side chat is absent from `GET /api/chats` and `GET /api/projects/{id}/chats`,
   both with and without the temporary-chat opt-in. `GET /api/chats/{id}` returns it.
   The parent's chat payload identifies its side chat, and after discard it identifies
   none.
6. Pin, tag assignment, archive, unarchive, and fork each return `fail` for a side
   chat.
7. Archiving the parent, discarding a temporary parent, and removing the parent's
   project each delete the side chat's row and stop its process. When the archive
   requests worktree deletion, the side chat's process is stopped before the worktree
   is removed.
8. Discarding the side chat of a non-project parent leaves the parent's scratch
   directory in place.
9. The side chat's first message spawns its CLI in the parent's working directory: the
   worktree if the parent has one, otherwise the project root, otherwise the parent's
   scratch directory. The spawn uses the parent's adapter. Its history contains none of
   the parent's messages.
10. A chat-layer test with the mock adapter shows that a side chat's spawn carries the
    no-persistence option when the adapter reports the capability, and does not carry
    it when the adapter does not. The diff adds no code under any adapter crate.
11. Within one daemon run, after the UI switches to another session and back to the
    parent, `side-chat-panel-<parentChatId>` shows the same side chat with the same
    messages, and no new CLI process was spawned.
12. After a daemon restart, with the mock adapter reporting the capability:
    - opening the parent shows `side-chat-panel-<parentChatId>` for the same side chat
      id, with no prior messages;
    - `chat-context-not-preserved-<parentChatId>` renders inside the panel;
    - no resume is attempted;
    - the side chat is never marked transcript-missing or degraded;
    - the next message starts a fresh vendor session in the same side chat, and its
      stored provider session id changes.
13. After a daemon restart, with the mock adapter not reporting the capability,
    opening the parent shows the same side chat. Its next message resumes the earlier
    vendor session, and its history is restored.
14. When the side chat's adapter does not report the capability,
    `chat-provider-keeps-transcript-<parentChatId>` renders inside the panel and has no
    dismiss control. `chat-context-not-preserved-<parentChatId>` never renders at the
    same time. No side-chat surface contains the text "not saved" or "nothing was
    saved".
15. Inside the panel, the full-size `chat-context-not-preserved-<sideChatId>` Alert
    never renders. Dismissing `chat-context-not-preserved-<parentChatId>` hides it
    across a UI reload, and a later context loss shows it again.
16. With two chats in a split, opening a side chat on the focused chat renders
    `side-chat-panel-<parentChatId>` inside that chat's zone. The other zone's DOM is
    unchanged, and the zones store still holds exactly two zones.
17. The panel renders the same way when the parent is alone in the single view.
18. The session tab store, the zones store, the sidebar projection, and the command
    palette's session results never hold a side chat id, including after an open-in-split request, a tab-open request, or a
    navigation request carrying a side chat id. A navigation request for a side chat id
    activates its parent and expands the panel.
19. These test ids exist and are keyed by the parent chat id: `side-chat-panel-<id>`,
    `side-chat-toggle-<id>` (the header toggle), `side-chat-collapse-<id>`, and
    `side-chat-close-<id>`. The context-menu items are `sessions-ctx-side-chat` and
    `session-tab-ctx-side-chat`. None of these items renders for a draft or an archived
    chat.
20. Collapse hides the panel without deleting the row. The collapsed state survives a UI
    reload. While the panel is collapsed, `side-chat-toggle-<parentChatId>` shows the
    running state during a side-chat turn and the waiting state while a gate is pending.
    A gate raised while the parent is on screen expands the panel.
21. While a side chat has a pending gate and its parent is not on screen, the parent's
    sidebar row and session tab show the waiting state.
22. The parent's sidebar row shows no fork-lineage nesting, badge, or count for its side
    chat, and the side chat's panel shows no forked-from link.
23. Rust tests cover:
    - open, reveal, and the concurrent-open case;
    - each open refusal;
    - discard;
    - the listing exclusion with and without the temporary opt-in;
    - the pin, tag, archive, unarchive, and fork refusals;
    - the archive, temporary-parent discard, and project-removal cascades, including the
      worktree-deletion ordering;
    - the scratch-directory preservation;
    - the restart case with the mock adapter's capability on (fresh session, context
      loss stamped, no resume, not transcript-missing) and off (resume with history).
24. UI tests cover:
    - the panel inside a split zone and in the single view;
    - collapse, close, and reveal;
    - the tab-strip, zone, and sidebar exclusions;
    - the compact not-preserved note and its dismissal;
    - the provider-transcript note for an adapter without the capability;
    - the toggle's status states and the auto-expand on a gate.
25. No changed or new file exceeds 300 lines, and no function exceeds 50 lines. A
    changeset is included.

## Decisions

- **hard-to-reverse**: A side chat is a chat row that is temporary and has a parent.
  There is no new column and no new concept. This is the brief's rule. Forks are never
  temporary, because fork refuses temporary parents and creates permanent chats, so the
  pair of properties is unambiguous.
- **hard-to-reverse**: Side chats are excluded from every listing on the server, even
  with the temporary opt-in. The desktop sidebar opts in to temporary chats since #346,
  so excluding them only by default would put side chats in the sidebar. A UI-only
  filter would leak them to other clients.
- **hard-to-reverse**: A side chat does not survive a restart, offload, or respawn with
  its conversation when its adapter has no persistence. This is the user's confirmed
  2026-09-24 feedback, and the brief's own tradeoff.
- **hard-to-reverse**: Closing a side chat hard-deletes it with #346's discard and asks
  for no confirmation. That is what a throwaway chat means, and collapse exists for
  "hide but keep".
- reversible: The panel docks at the bottom of the parent's chat column, not at the
  side. A zone can be as narrow as 480px, where a side-by-side panel would not fit. The
  design direction does not set a position.
- reversible: The panel can be collapsed as well as closed, and the collapsed state is
  remembered per parent on the device. The brief says the parent's reopen affordance
  survives restarts, which implies a state where the side chat exists but is hidden.
- reversible: The parent's payload identifies its side chat, and the field name is left
  to the planner. The UI must find the side chat after a restart without a listing.
- reversible: The side chat takes a one-time copy of the parent's model and permission
  mode, and its adapter is locked. Later parent changes do not propagate, because an
  adapter switch would trigger #346's respawn and context-loss path.
- reversible: Open refuses a parent that is archived, is a side chat, or has a missing
  working directory. Drafts never show the action. A side chat that could never spawn
  is worse than a clear refusal.
- reversible: Side chats are allowed on temporary parents and on non-project parents.
  They run in the parent's scratch directory and never delete it. The brief says "from
  any chat".
- reversible: Discarding a temporary parent also discards its side chat. This extends
  the brief's cascade list, because a temporary parent cannot be archived and would
  otherwise orphan its side chat.
- reversible: Idle offload applies to side chats unchanged, and #346's context-loss
  rule covers it. The brief says every point where the CLI goes away follows #346.
  Exempting side chats would keep a Claude process alive indefinitely.
- reversible: A gate raised while the parent is on screen expands the panel. A waiting
  side chat marks its parent's sidebar row and tab as waiting. The brief requires the
  gate to be visible "without hunting". Running state is shown only on the parent's
  toggle, to keep sidebar noise down.
- reversible: The existing `POST /api/chats/{id}/discard` is the side chat's discard
  command. It already handles temporary chats, so no second route is needed.
- **Design conflict, resolved in favor of the later user ruling**: reversible. The
  design direction builds the compact note on #346's variant A (a persistent Marker).
  The shipped #346 notice is the user's later override, variant C: a dismissible
  default Alert. The spec keeps the design direction's compact placement (a slim line
  under the header, the same component with a compact variant, and parent-keyed test
  ids). It makes the not-preserved line dismissible, with #346's dismissal rule.
- **Design conflict, resolved in favor of the design direction**: reversible. The brief
  keys the not-preserved notice by the chat id. The design direction keys both panel
  notices by the parent chat id, and it is the approved gate outcome. The panel also
  never renders the full-size, side-chat-keyed Alert, so ids never collide.
- reversible: The provider-transcript note cannot be dismissed. It is a standing fact
  about where the conversation is stored, and the brief forbids any UI that could
  suggest nothing was saved.
- reversible: The header toggle, the collapse and close controls, and the waiting
  indicators have no approved design. They reuse the existing header icon-button and
  status-dot vocabulary.
- reversible: The "Open side chat" menu item ids follow the existing unkeyed
  `sessions-ctx-*` and `session-tab-ctx-*` convention. The panel and its controls are
  keyed by the parent id, as the brief requires.
