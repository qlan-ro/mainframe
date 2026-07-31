# GitHub Issues sync for the tasks board (#286)

## Problem

Tasks live in Mainframe's board; the same work often lives as a GitHub issue that collaborators can see. Nothing
connects the two. A user working an issue retypes it as a task, and a task that ought to be visible to a team is
retyped as an issue. After that, each copy drifts on its own: a title fixed on GitHub stays wrong on the board, a
task closed in Mainframe leaves the issue open, and nothing records that the two are the same piece of work.

Matching them by number is impossible. Board numbers are per project, allocated as the current maximum plus one,
and reused after a deletion; GitHub numbers are server-allocated, never reused, and shared with pull requests. Any
connection has to be an explicit stored pairing. The board also carries Mainframe's own pipeline vocabulary in the
same label column as ordinary user labels, so a naive sync would publish the internal state machine to a public
tracker.

## Behavior

### Linking a project to a repository

The tasks board header carries the sync control, right-aligned in the trailing control group. When the project is
not linked it is an outline button, "Link GitHub repo", with GitHub's open-issue glyph. When it is linked it
becomes a connected pill: a status dot, `owner/repo`, a separator, and the last-synced string ("synced 3m ago", or
"never synced" before the first run).

The link dialog offers the GitHub remotes already configured in the project's repository as a radio list — the
derived `owner/repo` as the label, the remote name (`origin`, `upstream`) as secondary text — plus a credential row
reusing the existing GitHub credential control. A remote whose URL is not a GitHub `owner/repo` is not offered. A
free-text repository field is not the primary path and is not offered in v1. A project already linked must be
unlinked before it can be linked elsewhere; two projects may link to the same repository.

The pill is the sync menu — there is no separate sync button. It opens: **Sync now** · **Import issues…** ·
**Last sync report** · separator · **Unlink repo…** (danger). "Last sync report" is disabled until a run has
completed. While a run is in progress "Sync now" is disabled and the pill reads "syncing…".

Unlinking asks for confirmation and states both facts: how many pairs stop syncing, and that nothing is deleted —
"5 pairs stop syncing. Both the tasks and the issues stay exactly as they are — unlinking never deletes anything."
It drops every pairing, every baseline, and the stored reports for the project. No task and no issue is edited.

### Creating a pair

A pair is created only by an explicit act, in one of two directions. An unpaired task is never pushed to GitHub and
is never read by a sync run; the board holds internal work that must not leak.

**Import.** A list dialog shows the repository's open issues: a select-all row with the open count, then one row per
issue — checkbox, `#N`, title, and the issue's labels as chips. Its header states the rule once: "Each imported
issue becomes a task paired with it. Labels come across; Mainframe's own workflow labels are never taken from
GitHub." An issue already paired renders disabled, with "Already paired with task #219" in place of its label
chips — import shows the issue and refuses it rather than hiding it, so it can never silently create a duplicate.
The footer action counts the selection: "Import 5 issues". Each imported issue becomes a new task with a fresh
board number, the issue's title and body verbatim, status `open`, and the issue's syncable labels. Nothing is
injected into the body — no backlink header, no attribution footer — because injected text would read as a
difference on the next run.

**Publish.** An unpaired task's row carries a publish action, revealed on hover. It opens a confirm dialog,
"Publish task #285 to owner/repo?", showing the exact payload before anything is created: Title, Body, and Labels
on labelled rows. Whenever the task carries workflow labels, the dialog names them: "3 workflow labels stay local —
route:no-spec, gate:brief, ready-for-agent. Mainframe's pipeline labels are never published and never accepted back
from GitHub." The primary action is "Create issue". Publishing a task whose status is `done` creates the issue and
immediately closes it as completed, so the pair starts in agreement.

Either way the pair records the repository, the issue number, the issue URL, and a baseline: the values both sides
agreed on at that moment — title, body, the projected state, and the syncable label set — plus the time of the
agreement.

### What a sync run does

A run reconciles every pair in the project. It never stops to ask a question: it resolves every disagreement by the
rules below, completes, and reports what it did afterwards. Sync is manual in v1 — a run happens when the user
picks "Sync now".

For each pair the run compares three things per field family: the local value now, the remote value now, and the
baseline. That three-way comparison — not any timestamp — decides what changed. An issue whose modification time
advanced because of a comment, a project-board move, or a bot label edit shows no change in any synced field and
produces no write and no report entry. Modification times and conditional-request validators may be used only to
skip fetching an issue that certainly did not change.

Synced field families are **title**, **body**, **state**, and **labels**. Priority, type, milestone, dependencies,
order, and assignees are local-only and are never read or written by sync.

- **One side changed.** The changed side is written to the other. No clock is consulted.
- **Neither side changed.** Nothing is written.
- **Both sides changed a scalar (title or body).** The more recent change wins and is written over the other. The
  losing value is recorded in the report verbatim. Bodies are never merged line by line — a task body carries
  machine-written sections that a merge would corrupt.
- **Labels.** Reconciled per label against the baseline: a label added on one side is added to the other, a label
  removed on one side is removed from the other, and a label both sides changed was necessarily changed the same
  way. Labels consult no clock, overwrite nothing, and produce no report entries.

**What "more recent" means.** On the local side it is the moment that field family's value *last actually changed*.
A write that sets a field to the value it already holds, a write that touches only workflow labels, and a write
that touches only local-only fields all count as no local change at all. The task row's general modification time
is never the local clock — it advances on every edit request before any field is examined, so using it would let a
pipeline label write silently overwrite a real GitHub edit.

On the remote side it is the dated event for that family: the rename event for a title, the close or reopen event
for state. A body has no dated event on GitHub's REST surface, so a body dispute falls back to the issue's own
modification time, which is a coarse upper bound that also advances for comments — the report says so in that case.

The two timestamps are compared truncated to whole seconds. **On a tie, and whenever the remote timestamp cannot be
resolved, GitHub wins** — the remote copy is the one collaborators can see, and the replaced value survives in the
report either way.

### State

The board's statuses are `open`, `in_progress`, and `done`. GitHub has open and closed. State is reconciled on the
projection: `done` is closed; `open` and `in_progress` are both open. The baseline stores the projection.

- A task moved to `done` closes its issue as completed.
- A task moved off `done` reopens its issue.
- An issue closed on GitHub sets its task to `done`. The task is never deleted.
- An issue reopened on GitHub sets its task to `open` when the task was `done`.
- Moving a task between `open` and `in_progress` changes no projection: it writes nothing, counts as no state
  change, and a following run with nothing else changed sends GitHub no write of any kind. That run still reads the
  issue — the three-way comparison is how it learns nothing changed — so the traffic that must be absent is
  outbound writes, not reads.
- A close arriving from GitHub for an `in_progress` task is a one-sided remote change against the projection, so it
  applies immediately and the task becomes `done`. Nothing blocks and nothing waits. Because that write discards
  local information GitHub could not see, it is always recorded in the report.

State values are shown to the reader as "Open", "In progress", and "Done" everywhere this feature writes. The raw
key `in_progress` never reaches a reader.

### Workflow labels

Labels whose name starts with `route:`, `gate:`, `approved:`, `rework:`, `pipeline:`, `pr:`, or `wayfinder:`, and
the exact labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, `parked`, and
`dispatched`, are Mainframe's own. They are never sent to GitHub, never accepted from GitHub, never recorded in a
baseline, and never count as a local change. Every other label syncs, including labels created after this feature
ships. A label sent to an issue that the repository does not define yet is created there by GitHub, with its
default colour.

### Pair state on the board

Task rows are otherwise unchanged — no new column, no shifted anatomy. Sync state shows in the row's trailing glyph
slot. On an unpaired row that slot is empty at rest and reveals the publish action on hover; on a paired row it
holds the issue number, so a paired row's unlink action sits in the row's existing hover-revealed action cluster
instead:

| Pair state | Trailing glyph |
|---|---|
| unpaired | publish action, revealed on hover |
| paired, clean | the GitHub issue number, `#N`, in muted mono |
| paired, overwritten in the last run | the same, in amber with a leading dot; clicking it opens the report |
| errored in the last run | a warning triangle and `#N`, amber, reason on hover |
| remotely-unlinked | an unlink glyph and `#N`, amber, reason on hover |

Amber means a person should look; ordinary sync activity is never amber.

**Remotely-unlinked** is a pair state, not a report entry: the issue is missing on GitHub, or has been transferred
to another repository. The task is never deleted and the pair is skipped by every following run until a person
re-links or unlinks it. A transfer redirect is never followed — following it would silently re-point the pair at a
repository the project is not linked to.

### The run summary and the report

After a run, a dismissable banner appears under the board header: "5 pairs synced · 4 fields overwritten", with a
"View report" text button — the only entry point to the report. When a run stopped partway the banner is amber and
carries the reason on a second line: "Rate limited by GitHub after 3 of 7 pairs. The 4 pairs not reached were left
untouched." When nothing was overwritten the banner says so and offers no report link.

The report is a dialog of flat expandable rows, one per overwrite, any number expanded at once. Its header reads
"5 pairs reconciled at 14:22. 4 fields were overwritten — the replaced values are below."; a failure sentence, when
there is one, sits directly beneath it. A collapsed row shows the issue number, the field family (Title / Body /
State / Labels), the task title truncated, and a winner chip — "GitHub won" or "Mainframe won".

An expanded row carries exactly two things:

1. **The rule line**, always — for example "more recent change won — Mainframe 13:58:02, GitHub 14:04:11". The
   three rules render as fixed strings: recency → "more recent change won", tie → "tie — remote wins",
   in-progress close → "remote close applied to an in-progress todo". When the remote stamp is the issue's coarse
   modification time (the body case), the line appends "(issue timestamp, to the minute)".

   A row shows the timestamps its decision compared and no others. Recency shows both. A tie shows both when the
   stamps were equal, and the local stamp alone — followed by "GitHub timestamp unavailable" — when the remote one
   could not be resolved. An in-progress close compared nothing and shows no timestamp at all; the row stores both
   as absent rather than substituting the run's own clock.
2. **The replaced value only.** A "Now" line states what the field holds today — the literal value for title and
   state, and "the body shown on task #N" for a body, which is already on screen elsewhere. Beneath it, the
   replaced value verbatim in an amber block, scrolling past a few lines and sized to short values rather than
   stretched to full width, with a "Copy replaced <field>" button under it.

The report never shows a kept-versus-replaced pair. The winning value is already on the task; the replaced one
exists nowhere else, and handing it back verbatim and copyable is the reason the dialog exists. A run that resolved
nothing shows the same dialog, three lines tall: "Nothing was overwritten in this run."

Reports are kept for the last ten runs per project and older ones are dropped at the end of each run, because a
replaced body is a full copy of a task body.

### Failures and partial progress

Authentication failure, rate limiting, and network failure are ordinary conditions. A run that cannot finish leaves
every pair it did not reach exactly as it found it and keeps the new baselines of the pairs it already reconciled,
so the next run resumes rather than restarting. A pair that failed on its own — a single bad request — is marked
errored and does not stop the run. GitHub's rate-limit and retry-after signals are respected instead of blind
retries. Every failure produces a sentence a person can act on, and no message, log line, or report row ever
contains credential material.

### Deletion

Deleting a task deletes its pairing and sends nothing to GitHub. The issue is untouched and simply becomes
unpaired; it can be imported again later as a new task with a new number. Unlinking a single pair drops the pairing
and baseline only: no field is written on either side, the task stays, and the issue stays.

The unlink action is an icon button in the task's existing hover-revealed action cluster — the same cluster that
carries start, edit, and delete on a list row and on a board card. It appears only on a paired task, because the
trailing glyph slot that reveals publish on an unpaired row holds the issue number once the task is paired. The
cluster grows by one control at most and the row's resting anatomy is unchanged. There is no per-task menu on this
board and this feature does not introduce one.

## Not Included

- Interactive conflict resolution — no per-field chooser, no "pick a side" prompt, no pair that waits. `declined`
- One-click restore of a replaced value; the report shows it in full for manual recovery. `deferred`
- Assignees. The local column carries Mainframe-local strings such as `@me` rather than GitHub logins, and GitHub
  silently drops non-collaborators, so an outbound write would fail invisibly. `declined`
- Importing closed issues; the import dialog lists open issues only. `deferred`
- Opening the paired issue in a browser from the board row. `deferred`
- Pull requests, comments, reactions, milestones, and GitHub Projects. `declined`
- Trackers other than GitHub, and GitHub Enterprise host configuration. `declined`
- Webhooks, real-time push, and automatic interval sync. `deferred`
- A precise remote body-edit timestamp from GitHub's GraphQL API. `deferred`
- Changing the pipeline's label semantics, or refactoring the existing oversized todos module beyond stamping
  local change times in its three write paths. `declined`
- Moving the board to GitHub-backed storage — this is sync, not a storage swap. `declined`
- The mobile client. `platform`

## Edge cases

- A task's board number is reused after a deletion. The reused number must not inherit the deleted task's pairing.
- An import run repeated over the same issues creates no second task and no second pairing.
- An issue is edited on GitHub while a run is in flight. The run works from what it fetched; the later edit is
  picked up by the next run, with the baseline preventing a phantom conflict.
- An issue's modification time advances with no synced-field change (comment, bot label, project-board move).
- Both sides changed the same body, and the remote stamp is only the issue's modification time. The rule line marks
  the coarse timestamp; the replaced body is recorded in full.
- The remote per-field event cannot be resolved — the timeline is unavailable or the event has aged out of it.
  GitHub wins the tie, and the report says so.
- A pipeline write changes only workflow labels, or an edit rewrites a field with the value it already had.
  Neither counts as a local change.
- An inbound change applied by sync must not read as a fresh local edit on the following run.
- A malformed label array in an existing task row falls back to an empty list with a warning rather than failing
  the run.
- The repository has no configured GitHub remote, or the only remote URL is not a valid `owner/repo`.
- The stored credential is missing, revoked, or lacks write access to the repository.
- The repository is archived or read-only: outbound writes fail per pair and mark the pair errored.
- The linked repository is renamed or transferred; every pair reports as remotely-unlinked rather than following
  the redirect.
- A task with no pairing exists in a linked project, and a task with a pairing exists after the project is
  unlinked.
- An existing database that has never held any of this feature's state, and one where the migration already ran.
- A run is triggered while one is already in progress for the same project.

## Acceptance criteria

1. A project can be linked to a GitHub repository chosen from its detected GitHub remotes, and unlinked again;
   after unlinking, no pairing, baseline, or report remains for the project and every task and issue is
   byte-identical to its pre-unlink state.
2. A remote whose URL does not yield a valid `owner/repo` is not offered in the link dialog, and no derived value
   reaches a URL or a process argument without matching a strict `owner/repo` shape.
3. The import dialog lists the repository's open issues; selecting and confirming creates one task per selected
   issue with the issue's title, body, `open` status, and syncable labels, plus a pairing and a baseline.
4. Re-running import over the same issues creates no duplicate task and no duplicate pairing; already-paired issues
   render disabled with "Already paired with task #N".
5. An imported task's body equals the issue body exactly — no injected backlink, header, or footer — and a
   published issue's body equals the task body exactly.
6. Publishing an unpaired task creates an issue with the task's title, body, and syncable labels and records a
   pairing and baseline; publishing a `done` task leaves the issue closed as completed.
7. A test proves an unpaired task is never included in any outbound request and is never read by a sync run.
8. After a pair exists, a local edit to title, body, or a syncable label reaches the issue on the next run with no
   further confirmation, and a remote edit to the same fields reaches the task.
9. A test proves the pairing survives board renumbering: delete the highest-numbered task, create a new one that
   reuses that number, and no pair is mis-associated.
10. A one-sided title or body change is applied to the other side, and a test proves no timestamp on either side
    was consulted.
11. A both-sides-changed title resolves in the same run: the more recent change is written to the other side, the
    run completes, and no pair is left waiting. Tests cover local-newer and remote-newer.
12. A both-sides-changed body resolves by the same rule, using the local body change time against the issue's
    modification time; a test documents that the remote value is a coarse upper bound.
13. When the two timestamps are equal at whole-second granularity, or the remote per-field timestamp cannot be
    resolved, GitHub wins and the overwrite is reported. Both cases have tests.
14. A write that changes only workflow labels, and an edit that rewrites a field with its existing value, both
    leave every local change time untouched — so a following remote body edit applies to the task. The test fails
    if the implementation reads the task row's general modification time as the local clock.
15. An inbound change applied by a run does not read as a local edit on the next run: a second run with nothing
    else changed produces no write.
16. Label reconciliation passes a three-way test — a label added only locally survives, a label removed only
    remotely is removed locally, a label both sides removed stays gone — with no timestamp consulted and no report
    entry produced.
17. An issue whose modification time advanced with no synced-field change produces no conflict, no write, and no
    report entry.
18. Each of the four state directions has a test: local `done` closes the issue as completed, local move off `done`
    reopens it, a remote close sets the task to `done`, and a remote reopen sets a `done` task to `open`.
19. An outbound run for an `in_progress` task issues no state write and leaves the issue open; a move between
    `open` and `in_progress` records no state change; a following run with nothing else changed issues zero
    outbound writes to GitHub (issue create, issue update, state change, label change) — reads are expected and are
    not counted by this test.
20. A remote close arriving for an `in_progress` task resolves to `done` in the same run, with no blocking and no
    prompt, and the report records that the local `in_progress` status was replaced by a remote close.
21. Every automatic overwrite produces a report row carrying the pair, the field family, the winning side, the
    replaced value in full, the winning value, the deciding rule as one of the three enum values (`recency`, `tie`,
    `in-progress-close`), and only the timestamps the decision actually compared — never prose assembled in the
    UI. A test covers each rule's timestamp pair: `recency` and a `tie` decided by equal stamps carry both stamps;
    a `tie` decided by an unresolvable remote stamp carries the local stamp and records the remote one as absent;
    `in-progress-close` records both as absent. A row never carries a timestamp that was not compared. A further
    test asserts a replaced body is stored verbatim and is recoverable from the report.
22. A run that overwrote nothing produces an empty report; one-sided applications and label merges produce no
    report rows.
23. Reports older than the last ten runs for a project are removed at the end of a run, proven by a test.
24. Deleting a task removes its pairing, issues no GitHub request, and leaves the issue untouched.
25. A paired issue that is missing or transferred marks the pair remotely-unlinked, never deletes the task, never
    follows a transfer redirect, is excluded from following runs' writes, and is surfaced as a pair state distinct
    from any report row.
26. Unlinking a single pair drops the pairing and baseline only, with a test asserting no field write on either
    side. The unlink control is a hover-revealed icon button in the task's existing action cluster on both the list
    row and the board card, present only for a paired task; the publish control is a hover-revealed button in the
    row's trailing glyph slot, present only for an unpaired task; and no dropdown menu is added to a task row or
    card.
27. No workflow label — the seven declared prefixes or the seven declared exact labels — appears in any outbound
    request, and no label arriving from GitHub introduces one locally. Tests cover both directions and read the
    single declared constant.
28. A test asserts the workflow-label list is declared in exactly one place in the daemon.
29. Authentication failure, rate limiting, and network failure each leave unreached pairs untouched, preserve the
    baselines of pairs already reconciled in the run, and produce a readable reason; a test asserts no credential
    material appears in any message, log record, or report row.
30. GitHub's rate-limit and retry-after signals are honoured rather than retried blindly, proven by a test against
    a stubbed rate-limited response.
31. The migration is tested against a database populated with existing tasks that carry none of this feature's
    state, and against a database where it has already run.
32. New routes validate input by typed deserialization plus explicit checks and reject malformed bodies with a 400;
    routes on the todos plugin's sub-router return raw JSON bodies matching the existing client contract, and any
    route on the daemon's own surface uses the `ok`/`ok_empty`/`fail` envelope. Every new route and data-layer
    method has tests.
33. The report renders `open`, `in_progress`, and `done` as "Open", "In progress", and "Done"; a test asserts the
    raw key `in_progress` never reaches the DOM in this feature's surfaces.
34. Every new interactive element carries a `data-testid` in `<surface>-<element>` kebab-case, keyed by the task's
    board number (matching the existing `tasks-list-row-*` convention) or by the issue number, never by array
    index.
35. A second "Sync now" while a run is in progress is refused: the action is disabled and no concurrent run starts
    for the same project.
36. The UI test suite, the UI typecheck, and the Rust crate tests pass; every new file is under 300 lines and every
    new function under 50.
37. The pull request includes a changeset.

## Decisions

- **Two-way sync is the v1 deliverable, and both-sides changes resolve automatically by most-recent-write-wins with
  an after-the-fact report.** Settled by the user at the brief gate; carried through unchanged. `hard-to-reverse`
- **Local recency is a per-field-family record of when a synced value last actually changed, never the task row's
  general modification time.** Verified in the code: the patch handler sets the row's modification time first,
  unconditionally, before any field is examined, so a pipeline label write would otherwise win a body it never
  touched. `hard-to-reverse`
- **Remote recency comes from the issue's dated events, with the issue's modification time as the body fallback.**
  GitHub's REST surface records no body-edit event; the coarse fallback is stated in the report rather than
  hidden. `hard-to-reverse`
- **Ties, and unresolvable remote timestamps, go to GitHub.** The remote copy is the one collaborators see;
  reverting a visible edit is the more surprising failure, and the replaced value survives in the report.
  `hard-to-reverse`
- **Change detection is a three-way comparison against a stored per-pair baseline; modification times and
  validators are fetch optimisations only.** Timestamps alone cannot tell a real edit from a comment or a bot
  label. `hard-to-reverse`
- **State is reconciled on the projection of the board status onto open/closed, and the baseline stores the
  projection.** This is what keeps `in_progress` from oscillating and makes a remote close a one-sided change.
  `hard-to-reverse`
- **The workflow-label rule is a denylist declared once in the daemon**, covering the seven prefixes and the seven
  exact labels. An allowlist would silently drop new user labels; the pipeline's own contract lives in a
  user-level skill outside this repository, so the runtime must own its copy. `hard-to-reverse`
- **A pair is created only by an explicit import or publish; after that, changes flow with no per-change
  confirmation.** Per-change confirmation would make two-way sync unusable without protecting anything the opt-in
  pairing does not already protect. `hard-to-reverse`
- **Everything lives inside the todos plugin.** The pairing, baseline, change times, and report are all task state,
  and a second plugin would need the cross-plugin database access the security model restricts.
  `hard-to-reverse`
- **Authentication reuses the daemon's existing GitHub client and credential store under a GitHub credential
  label.** Verified: the client and the store trait exist in the automations crate; the daemon never invokes the
  `gh` CLI, and the `keyring` crate belongs to the Tauri shell, not the daemon. `hard-to-reverse`
- **Imported and published bodies are verbatim — no backlink, header, or attribution footer.** Any injected text
  would read as a difference on the next run and would have to be stripped forever after. `hard-to-reverse`
- **Report retention is the last ten runs per project, pruned at the end of each run.** The brief asked for rolling
  retention without a number; ten covers "what did the last few runs do to my board" while bounding a store whose
  rows hold full body copies. `reversible`
- **Import lists open issues only in v1.** A closed issue imports as a `done` task nobody is working, and the
  import dialog's counts and select-all are built around the open set. `reversible`
- **Publishing a `done` task creates the issue and closes it as completed.** The alternative — refusing to publish
  it — blocks a legitimate act of recording finished work, and leaving it open would make the pair's first run
  immediately write a close. `reversible`
- **Outbound labels the repository does not define are allowed; GitHub creates them.** Filtering to existing repo
  labels would drop a label the user just added locally with no feedback. `reversible`
- **One run per project at a time; "Sync now" is disabled while a run is in progress.** Concurrent runs on the same
  pairs would race on baselines. `reversible`
- **The clean-state trailing glyph is the GitHub issue number as static text, not a link.** The row already carries
  the task number, and the design direction reserves clickability for the amber overwritten state; opening the
  issue in a browser is deferred. `reversible`
- **Unlinking a pair is an icon button in the task's existing hover-revealed action cluster, not a menu item and
  not the trailing glyph.** The design direction assigns the trailing glyph to the publish action on an unpaired row
  and to the issue number on a paired one, and it does not place per-pair unlink. Verified in the code:
  `TaskListRow.tsx`
  and `TaskCard.tsx` render start, edit, and delete as icon buttons in one `opacity-0 group-hover:opacity-100`
  cluster, and the tasks feature has no per-task dropdown — `DropdownMenu` appears there only in the board-level
  `FilterMenu`. Reusing that cluster keeps the resting row unchanged and commissions no new control type on a
  `needs-ui` surface. `reversible`
- **A report row stores only the timestamps its decision compared; the two no-comparison paths store none.** An
  in-progress close and a tie on an unresolvable remote stamp consulted no remote clock, so recording one would
  invent a comparison that never happened. `reversible`
- **A pair that fails on its own is marked errored and the run continues; only run-wide failures stop a run.** One
  bad issue should not strand the rest of the project. `reversible`
- **Validation is typed deserialization plus explicit checks, not Zod, and there is no second runtime to keep in
  parity.** The Rust daemon is the only runtime; the project rule naming Zod and daemon parity predates the
  cutover. `reversible`

### Brief-vs-code notes

- The brief says the daemon's git service "can enumerate a project's remotes". It enumerates remote *names* only
  (`git remote`); no remote URL is read or exposed on any route today. Deriving `owner/repo` for the link dialog
  needs a new read. This changes no behavior in this spec — the dialog still lists remotes with their derived
  `owner/repo` — but it is more work than "reuse the existing enumeration".
- The design direction places the sync control "left of the close button" in the board header. In the shipped
  header the close button is the first element on the left and the trailing group (view switch, "New task") is
  right-aligned. The control belongs in that trailing group; the spec says right-aligned rather than repeating the
  prototype's ordering.
- Existing task-row test ids are keyed by the task's board number, not its id. Criterion 34 keeps that convention
  rather than introducing a second keying scheme mid-surface.
