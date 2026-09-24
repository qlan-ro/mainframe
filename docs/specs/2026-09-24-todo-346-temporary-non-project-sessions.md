# Temporary and non-project sessions

Todo #346. Sources: the todo's `## Agent Brief`, its two 2026-09-24 feedback rounds,
and its user-approved design direction. That direction is the sidebar-lineage walk
(variant A glyph vocabulary), the no-project entry point (variant D, single dropdown
trigger, which supersedes variant A's segmented control), and the "context not
preserved" notice (variant C, a dismissible default Alert, which overrides the walk's
first pick). Brief claims were re-checked against `origin/main` at `962e505b`.
Conflicts with the brief are recorded in `## Decisions`.

## Problem

Every chat in Mainframe belongs to a project and stays in the sessions list for good.
"Delete" only archives. This blocks two things users want. The first is a throwaway
conversation: one that disappears when closed and whose content is not left on disk by
the vendor CLI (Claude's session JSONL, Codex's rollout file and `threads` row). The
second is a question that has nothing to do with a repository, which today has to be
parked in an unrelated project and runs with that project's directory as its working
directory. With zero projects, a new user cannot type anything at all.

Side chats (#344) need the first of these as a primitive. The create endpoint also has
a latent bug to fix along the way: an unknown project id returns `ok` with a chat that
was never persisted.

## Behavior

Two independent chat properties are set at creation and never change afterwards.
**Temporary** and **non-project** can be combined in any way. Every chat that exists
before this change is neither.

**Temporary chats.** While its CLI session is alive, a temporary chat behaves like any
other chat: it streams, raises permission gates, and can be interrupted. It is left out
of the default chat listings: both list endpoints, the sidebar, the archived-sessions
dialog, and the command palette. A caller that explicitly asks for temporary chats gets
them in both list endpoints. Fetching a temporary chat by id always works. A temporary
chat cannot be pinned, tagged or archived, and each attempt fails. Only these events
delete it:
- an explicit discard, which stops its CLI process, clears its live state, removes its
  scratch directory if it has one, and then deletes the row;
- removal of its project, which already hard-deletes every chat in that project.

A daemon restart never deletes a temporary chat. In v1 the desktop UI has no action
that creates a temporary chat. The API supports it, and side chats are the first
consumer. When a temporary chat is shown in a sidebar row, the row's meta-line glyph
cluster includes a `Timer` glyph with the hint "Temporary — deleted when closed". The
default v1 sidebar never lists temporary chats, so this glyph does not appear there.

**No vendor persistence.** Each adapter reports whether it has a no-persistence
capability, and the UI can see that flag in the adapter info. When a temporary chat's
adapter reports it, every CLI session Mainframe starts for that chat uses the adapter's
native mechanism: Claude's `--no-session-persistence`, and Codex's `ephemeral` thread
start. No vendor transcript is then written for the chat, across turns, interrupts and
fresh sessions. A non-temporary chat never gets the mechanism. A temporary chat on an
adapter without the capability keeps the rest of the temporary behavior: its CLI writes
its transcript as usual, it resumes after restarts like a normal chat, and Mainframe
never deletes that transcript. Claude and Codex report the capability only if the
prerequisite spike (acceptance criterion 1) confirms their mechanism in interactive
mode.

**When a no-persistence chat's CLI goes away.** The vendor context lives only in the
running CLI process. The process can go away through a daemon restart, a CLI exit, a
config change that needs a respawn (an adapter switch, or a model change that crosses
endpoints), or a degraded-recovery action that rebinds the working directory. In every
case the row is kept, and Mainframe never attempts to resume a vendor session that it
started without persistence. The next message starts a fresh vendor session in the
same chat, with the same mechanism, and the new provider session id replaces the old
one. Within one daemon run, earlier messages stay visible from Mainframe's in-memory
cache. After a daemon restart they cannot be rebuilt.

In both cases the chat view shows a non-error notice saying that earlier context was
not preserved. The notice is a dismissible default-variant Alert at the top of the
thread. It is not in the sticky footer, has no action button, uses no destructive tint,
and never blocks the composer. Dismissing it hides it for that chat on that device. It
comes back if the chat loses context again later. Transcript-presence reconciliation
never marks these chats as missing a transcript, and the degraded recovery card never
appears for them.

**Non-project chats.** A chat can be created without a project. It runs in a scratch
directory that Mainframe owns, under Mainframe's data directory, specific to that chat.
The directory is never a project path and never the user's home directory itself. It is
created the first time the chat's CLI spawns, not while the chat is a draft. Its path
stays the same across restarts, so a persisted chat resumes in it. If the directory has
disappeared by the time of a later spawn, it is recreated at the same path. It is
removed only when the chat row is deleted, so an archived non-project chat keeps it.
Apart from that, a non-project chat is listed, opened, archived and restored like any
other chat.

For a non-project chat, the git, worktree, branch, launch-config and diff surfaces are
disabled and explain that the chat has no project. They do not fail. The chat payload
tells API consumers whether a chat has no project. The daemon represents "no project"
internally with a hidden project that no project listing or picker shows and that
cannot be removed.

**Sidebar and other lists.** A non-project chat's row shows a muted, italic "No
project" label with a small dashed glyph in the project slot. It never shows a project
name or avatar. Non-project chats are grouped in a trailing "No project" section:
- in recency mode, after Pinned, Today, Yesterday and Earlier;
- in project mode, after the named-project sections and after any sections for unknown
  projects.

A pinned non-project chat stays in Pinned. An active project filter pill hides
non-project chats. The archived-sessions dialog and the command palette show "No
project" for these chats wherever they would show a project name.

**Starting a new session.** The draft still picks a default without asking: an active
project pill first, then the project of the session that was active when "+" was
clicked. The welcome screen's project control is a single trigger that shows the
current choice: a colored dot and the project name, or the dashed glyph and an italic
"No project". Opening it shows the "Start in…" list, with every real project
(most-recent first, the resolved default tagged "Resolved default") and a trailing "No
project" entry, below a separator, at the same row weight. When no default resolves but
projects exist, the trigger reads "Choose a project" and the composer stays hidden
until something is chosen. "No project" counts as a choice. Choosing "No project" shows
the composer, hides the branch chip and repo suggestions, disables the worktree controls
with an explanation, and clears any active project pill.

Until the first send, the draft can switch between "No project" and any project, in
either direction, as often as the user likes. The chat is created on the first send
with the last choice. After that the project is locked: no UI offers to change it, and
the daemon refuses any request that tries to.

**Zero projects.** The first-run hero keeps its primary "Add project…" button and adds
a secondary "Start with no project" button of equal height next to it. Clicking it
replaces the hero with the normal welcome screen, set to "No project", with a live
composer.

## Not Included

- Side chats, including deleting a temporary chat when its parent is archived. #344
  owns that and calls this todo's discard. — deferred
- The parent-chat reference and the fork capability flag (#343). — deferred
- A desktop UI action that creates a standalone temporary chat, and any "show temporary
  chats" view. — deferred
- Promoting a temporary chat to permanent. — deferred
- Moving a non-project chat into a project, or changing any chat's project, after its
  first send. — deferred
- Startup deletion of any chat, temporary or not, including chats that were created but
  never spawned. — declined
- Deleting or scrubbing a vendor transcript that has already been written (for example,
  on an adapter without the capability). — declined
- Preserving, storing or replaying a no-persistence chat's context across a restart or
  respawn. — declined
- No-persistence for non-temporary chats, or a user setting that enables it. — declined
- Hard-delete for ordinary chats, or any change to how they are archived. As a result,
  a permanent non-project chat's scratch directory is never removed. — declined
- A "No project" project filter pill. — deferred
- Rendering non-project chats in the mobile app, which lives in a separate repository.
  — deferred
- The draft-flow races owned by #359, #365 and #366. This todo must not widen #366's
  window. — deferred
- Vendor transcripts for adapters whose mechanism fails the spike. They keep writing,
  and the capability flag says so. — platform

## Edge cases

- **Create request with both a project id and the no-project opt-out, or with
  neither:** fails. No row is written.
- **Create request with no project plus a worktree path or branch name:** fails.
- **Create request with an unknown project id:** fails. No row is written.
- **Create request that names the hidden scratch project directly:** fails. The
  explicit opt-out is the only way to get a non-project chat.
- **Removing, or fetching by id, the hidden scratch project through the projects API:**
  fails with not-found or a refusal. It never appears in `GET /api/projects`.
- **Discarding a non-temporary chat:** fails. The chat is unchanged.
- **Discarding a chat that is mid-turn or has a permission gate pending:** the process
  is stopped, the gate is dropped, and the row is deleted.
- **Discard interrupted after the scratch directory was removed but before the row was
  deleted:** the chat still exists and can be discarded again. No directory is
  orphaned.
- **Unarchiving a temporary chat:** fails, like archiving. A temporary chat can never be
  archived in the first place.
- **Temporary chat whose adapter reports the capability, switched to an adapter
  without it:** the new session writes its transcript. The earlier context is gone and
  the notice appears. From then on, resumes work as for a normal temporary chat.
- **Switched the other way:** the next session uses no persistence. The transcript the
  earlier adapter wrote is left alone.
- **Adapter capability changes between daemon versions:** the decision is made per
  spawn from the current capability. Resume is skipped only for a vendor session that
  Mainframe started without persistence.
- **No-persistence chat restarted before its first turn ever spawned a CLI:** there is
  no earlier context, so no notice appears.
- **Notice dismissed, then context lost again:** the notice reappears.
- **Non-project chat whose adapter reports a transcript in a cwd-keyed store (Claude):**
  resume after restart finds it, because the scratch path is stable.
- **Non-project temporary chat:** is discarded like any temporary chat, and its scratch
  directory is removed first.
- **Project pill active when the user picks "No project" on the draft:** the pill is
  cleared.
- **Mobile or other REST consumers:** temporary chats are excluded by default, so they
  never see them. They do see non-project chats, with the no-project indicator set.

## Acceptance criteria

1. **Prerequisite spike, done before the plan is written.** Live checks with the
   protocol-debugger skills confirm, for each adapter, whether its mechanism works in
   Mainframe's interactive mode. The checks cover streaming, at least two turns, an
   interrupt, and a permission gate. Claude is checked with `--no-session-persistence`
   on the stream-json spawn, which has no `--print`. Codex is checked with `ephemeral:
   true` on `thread/start`, alongside the existing `persistFullHistory` and
   `persistExtendedHistory` params. The checks also record what happens on a respawn and
   on an attempted resume. The findings are written as new rows in each adapter's
   consumed-surface doc under `docs/research/adapters/`, and the Claude row that calls
   the flag undocumented is updated. An adapter whose mechanism fails reports the
   capability as `false`.
2. `GET /api/adapters` (the adapter info) includes the no-persistence capability for
   every adapter, and the mock adapter can be set to report either value in tests. The
   chat layer and the UI read only this flag: no code in either branches on an adapter
   id to decide persistence.
3. Unit tests on the Claude spawn-args builder and the Codex `thread/start` params
   builder show three things. A no-persistence spawn carries the mechanism. A normal
   spawn does not. A no-persistence spawn carries no resume target (`--resume` or
   `thread/resume`).
4. On each capable adapter, a temporary chat is run for at least two turns including an
   interrupt, and afterwards no vendor transcript exists for it. For Claude that means
   no session JSONL for its session id. For Codex it means no rollout file and no
   `threads` row for its thread id. This is an integration test against the real CLIs,
   or a recorded live-QA check in the PR if CI cannot run them.
5. `POST /api/chats` accepts a temporary flag and an explicit no-project opt-out. The
   body is serde-validated, and every response uses the `ok`/`fail` envelope. Each of
   these returns `fail` and writes no row:
   - an unknown project id;
   - both a project id and the opt-out;
   - neither a project id nor the opt-out;
   - the opt-out together with a worktree path or branch name;
   - the hidden scratch project's id.
6. The chat payload, in both the Rust and the TS `Chat` shapes and serialized as
   camelCase, marks whether the chat is temporary and whether it has no project. Every
   chat that existed before the migration reads as non-temporary and keeps its
   original project id.
7. A temporary chat is absent from `GET /api/chats` and `GET
   /api/projects/{id}/chats` by default, and present when the request opts in to
   temporary chats. It is absent from the sidebar, the archived-sessions dialog and the
   command palette. `GET /api/chats/{id}` returns it.
8. The discard command on a temporary chat stops its process, deletes the row, and
   removes its scratch directory if it has one. Afterwards `GET /api/chats/{id}` returns
   not-found. The same command on a non-temporary chat returns `fail`, and the chat is
   unchanged.
9. For a temporary chat, pin, tag assignment, archive and unarchive each return `fail`.
10. Removing a project deletes that project's temporary chats and stops their
    processes.
11. After a daemon restart, a temporary chat is still excluded from the default
    listings, still fetchable by id, and not deleted. With the mock adapter reporting
    the capability:
    - the next message starts a fresh session with no resume attempt;
    - the stored provider session id changes;
    - the chat is never marked transcript-missing or degraded;
    - `chat-context-not-preserved-<chatId>` renders.

    With the capability off, the next message resumes as it does today.
12. With the capability on, each mid-life respawn path starts a fresh session, never
    attempts a resume, never returns an error, and makes the notice render. The paths
    are a config change that needs a respawn, a degraded-recovery action that rebinds
    the working directory, and the next message after an unexpected CLI exit. With the
    capability off, each path resumes as today.
13. Transcript-presence reconciliation, both on history load and in the periodic sweep,
    leaves a no-persistence temporary chat unflagged.
14. The notice `chat-context-not-preserved-<chatId>` is a default-variant Alert at the
    top of the thread. It has no action button and a dismiss control. After it is
    dismissed it stays hidden for that chat across a UI reload, and it renders again
    after a later context loss.
15. A chat created with the no-project opt-out spawns its CLI in a directory under
    Mainframe's data directory whose path contains the chat id. That path is not a
    project path and not `$HOME` itself. After a daemon restart, the chat spawns in the
    same path.
16. Before a no-project draft's first send, no scratch directory exists for it.
17. `GET /api/projects` never lists the hidden scratch project. `DELETE
    /api/projects/{id}` on it returns `fail`, and `GET /api/projects/{id}` on it returns
    not-found.
18. `PATCH /api/chats/{id}/config` with a `projectId` in the body returns `fail`, and
    the chat's project is unchanged. No route changes a chat's project.
19. On the new-session welcome screen:
    - `welcome-project` is the only project control, and it shows the resolved
      choice.
    - Opening it shows `welcome-project-picker`, with each project as
      `welcome-project-<projectId>`, the resolved default tagged "Resolved default",
      and a trailing `welcome-project-picker-no-project`.
    - Choosing "No project" makes the trigger read "No project", shows the composer,
      hides the branch chip and repo suggestions, and clears an active project pill.
    - The first send then creates a chat that reads as having no project.
20. Before the first send, the draft can switch from "No project" to a project and
    back, and the created chat uses the last choice. After the first send, no UI
    surface offers a project change.
21. With zero projects, `sessions-firstrun-no-project` renders next to "Add project…".
    Clicking it shows the welcome screen, set to "No project", with a live composer.
22. A non-project chat is in a trailing `sessions-group-header-No project` section in
    both recency mode and project mode, unless it is pinned. Its row shows
    `sessions-row-no-project` and no project name or `ProjectAvatar`. A project pill
    hides it.
23. Component tests show that, for a non-project chat or draft, the git, worktree,
    branch, launch and diff surfaces, including the draft's worktree controls, render
    a disabled explanatory state, and no request to a git, worktree, launch or diff
    route is made for that chat.
24. A row component test that renders a temporary chat shows
    `sessions-row-temporary-glyph` with the hint "Temporary — deleted when closed".
25. The additive migration adds the temporary column with a default of false and
    creates the hidden scratch project row. It follows the append-only migration chain
    and its version bump. The project column stays non-nullable.
26. Rust route tests cover:
    - create with and without a project;
    - create temporary;
    - each create rejection in AC 5;
    - both list endpoints with and without the temporary opt-in;
    - discard of a temporary and a non-temporary chat;
    - the pin, tag, archive and unarchive refusals;
    - project removal;
    - scratch project listing and removal;
    - the config `projectId` refusal;
    - restart survival and each respawn path, with the mock adapter's capability both
      on and off;
    - reconciliation skipping these chats.
27. UI tests cover:
    - the picker's "No project" entry and trigger label;
    - switching before the first send;
    - the first-run no-project button;
    - the non-project group header and row;
    - the temporary glyph;
    - the notice rendering, being dismissed, and reappearing.
28. No changed or new file exceeds 300 lines and no function exceeds 50 lines. A
    changeset is included.

## Decisions

- **hard-to-reverse** — "No project" is a hidden, daemon-owned scratch project row, and
  the project column is not made nullable. SQLite would need a table rebuild to drop
  NOT NULL, and every cwd lookup resolves the project by id.
- **hard-to-reverse** — Temporary and non-project are two independent flags, fixed at
  creation. A temporary chat on a real project (side chats) and a permanent chat with no
  project are both real cases.
- **hard-to-reverse** — Discard hard-deletes the row, and a discarded chat's history
  cannot be recovered. That is what "temporary" means.
- **hard-to-reverse** — Mainframe never resumes a vendor session that it started
  without persistence. After a restart or respawn it keeps the row, starts a fresh
  session, and shows the notice. Deleting the chat, replaying messages, or refusing
  sends are all worse (see the brief).
- **hard-to-reverse** — A non-project chat's scratch directory sits under Mainframe's
  data directory, is keyed by chat id, is created on first spawn, and is removed only
  when the row is deleted. The path has to be stable, because Claude's transcripts are
  keyed by cwd.
- **hard-to-reverse** — An unknown project id on create now returns `fail` instead of an
  unpersisted stub. The validator is being rewritten anyway, and the stub is a bug.
- reversible — No-persistence is gated by an `AdapterCapabilities` flag surfaced
  through the adapter info, mirroring #343's fork flag. The chat layer and the UI never
  check adapter ids.
- reversible — No-persistence is decided at each spawn from the current adapter's
  capability. The decision to skip resume keys off whether the current vendor session
  was started without persistence. This handles adapter switches in both directions.
- reversible — A temporary chat on an adapter without the capability gets only the
  Mainframe-level behavior. The capability flag is the only signal that its transcript
  is written, and #344's UI must present that honestly.
- reversible — Every mid-life respawn path follows the fresh-session rule, as the brief
  recommends. The spike may turn a path into a `fail` refusal instead, but no path may
  resume.
- reversible — Codex keeps `persistFullHistory` and `persistExtendedHistory` on an
  ephemeral thread unless the spike shows they conflict. If they do, they are dropped
  for ephemeral threads only.
- reversible — Unarchive also refuses temporary chats, a symmetry the brief did not
  state. A temporary chat can never be archived, so this closes an odd path.
- reversible — Creating a chat by naming the scratch project's id directly fails. The
  explicit opt-out is the only way in, so the hidden row cannot leak into clients.
- reversible — `GET /api/projects/{id}` returns not-found for the scratch project. It
  stays hidden from every client, and the daemon resolves the cwd internally.
- reversible — The project lock is enforced by having no project-change route, and by
  `PATCH /config` rejecting a `projectId`. Today serde would silently ignore that
  field, which does not meet the brief's requirement for a `fail` envelope.
- reversible — The lock takes effect at the first send, which is also when the row is
  created. Before that, the draft config is the only place the project lives. This is
  the brief's rule, simplified by the fact that no row exists before the first send.
- reversible — The field names for the temporary and no-project indicators are left to
  the planner. They must be camelCase and present on every chat payload.
- **Design conflict, resolved in favor of the approved design** — reversible. The
  brief's text asks for "No project" to be visible side by side and "not hidden in a
  menu". The later user-approved variant D uses a single trigger and puts "No project"
  in its list at equal weight, with an explicit "Add project…" peer only on the
  first-run hero. The spec follows variant D.
- **Design conflict, resolved in favor of the user** — reversible. The notice is the
  dismissible default Alert (variant C), which overrides the walk's inline, persistent
  Marker. Dismissal is remembered per chat on the device and cleared by a new context
  loss, so a returning user still learns about each new loss.
- reversible — The notice sits at the top of the thread, not in the sticky footer the
  degraded card uses. The brief requires it never to block the composer and never to
  be confused with the degraded card.
- reversible — The trigger keeps its shipped `welcome-project` test id rather than
  taking the prototype's `welcome-project-picker-trigger` name. Existing unit tests and
  the `sessions-draft` e2e suite select `welcome-project`. The picker list's ids match
  the design direction.
- reversible — The sidebar's non-project slot ships the muted "No project" label, not
  the blank-slot variant E, which is still awaiting the user's comparison. Switching is
  a one-line change.
- reversible — The trailing "No project" section comes after the ghost sections for
  unknown projects, and a pinned non-project chat stays in Pinned. Pinned is an
  explicit user choice, and "No project" is the least specific grouping.
- reversible — "Start with no project" on the first-run hero replaces the hero with the
  welcome screen, as the design walk proposed. That is the same state a normal "No
  project" pick reaches, so no combined hero-and-composer layout is invented.
- reversible — The `Timer` temporary glyph is built into the row now, even though the
  v1 default sidebar never shows it. The design direction settles this vocabulary for
  #344.
- reversible — A no-project draft clears an active project pill, and a pill hides
  non-project chats. This matches today's behavior when a draft picks a project that
  differs from the pill.
- reversible — There is no startup cleanup of any kind. The brief's second feedback
  round removed it. This goes further than the first feedback round's allowance for
  cleaning up creation litter, because no such cleanup exists for any chat today and it
  belongs in its own todo.
- reversible — A non-project chat whose scratch directory has gone missing gets it
  recreated at the same path on the next spawn, instead of entering degraded recovery.
  Mainframe owns that directory.
