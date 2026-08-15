# Project scope for the Kanban board and the Automations library

Todo #326 · route:full · branch `todo/326-automations-kanban-project`

The todo's `## Design direction` delegates the visual calls to this lane. The two picker
treatments named in `## Decisions` mirror shipped patterns (the welcome screen's project chip,
the import dialog's pick-a-project step) rather than inventing a treatment.

## Problem

The sidebar has three actions above the project switcher: New Thread, Kanban and Automations.
New Thread follows the sidebar's project filter; the other two ignore it and take their project
from whatever session happens to be active. Select project B in the switcher while a project-A
session is open, click Kanban, and the board shows project A's tasks — with nothing on screen
naming the project and no way to change it without closing the board, switching sessions, and
reopening. Automations behaves the same way, and it re-scopes itself whenever the active session
changes, so a background switch can retarget the library under the user's cursor.

With no session open, or with a projectless draft active, the Kanban entry is worse than wrong:
clicking it produces nothing at all — no dialog, no empty state, no message. The quick-add
shortcut is dead in the same state. Automations in that state lists every project's automations
with no explanation, so what the user sees depends on invisible session state instead of on
anything they chose.

## Behavior

**Each modal owns its own project scope, per open.** Both surfaces stay modal dialogs. Opening
one gives it a project scope that lives only as long as that open.

**The seeding rule.** Each time a modal opens, its scope starts on the first of these that
resolves:

1. the sidebar's project filter, when it names a project that still exists;
2. the active session's project, including a draft's chosen project;
3. the only project, when exactly one project exists;
4. otherwise, no project — the modal opens unscoped.

A sidebar filter set to "All projects" is not a project, so it falls through to rule 2. A filter
naming a project that has since been removed is treated as unset and falls through as well.

**Each modal names its project and can change it.** The header of the Kanban modal and of the
Automations library shows the scope's project — its avatar and name — and that display is the
picker: activating it lists the projects and switching scope reloads what the modal shows. The
Automations picker also offers "All projects"; the Kanban picker does not, because a board that
mixes projects has no meaningful columns. After a change, no rows from the previous project
remain on screen.

**An in-modal change goes nowhere else.** It does not change the sidebar filter, does not reach
the other modal, does not survive the close, and is not stored. Reopening the modal re-runs the
seeding rule against the sidebar filter as it stands then, including after a reload or an app
restart. Propagation runs one way only: sidebar to modal, at open time.

**An open modal is stable.** While a modal is open, only its own picker changes its scope.
Activating a different session, or changing the sidebar filter, leaves the open modal showing
what it was showing. The new seed applies at the next open.

**Reads and writes both follow the scope.** Creating, editing, moving, deleting and starting a
session from a task all act on the scope the board is showing. A new automation saves to the
scope the library is showing, and the editor's project-scoped choices — skills, files, branches
— offer that project's. Changing scope reloads the modal's data rather than mixing two projects.

**Unscoped opens.** With no project resolved, the Automations library opens on "All projects": it
lists every project's automations plus the ones that belong to no project, each row keeping its
existing project badge, and the picker narrows from there. Creating an automation is unavailable
until a single project is picked, and the editor says so. The Kanban modal opens on a
pick-a-project state: the project list, one row each, and no board until one is chosen. Neither
entry is ever a no-op click.

**Quick-add.** The quick-add task dialog is its own open and seeds by the same rule. It does not
inherit an open board's picked project. With no project resolved it opens on the same
pick-a-project state as the board, so the keyboard shortcut always produces a dialog. Opening
always shows a surface immediately; nothing is deferred to a later moment when a project happens
to resolve.

**Automations sub-views are pinned.** While the editor, the details view or a run view is open,
the library's project picker is unavailable — those views belong to one automation, and
re-scoping under a half-built draft would retarget where it saves. Returning to the library
re-enables the picker.

**Counts that stay global.** The sidebar's pending-interaction badge keeps counting while both
modals are closed, and neither modal's picked project changes it. The "N need you" count in the
Automations header counts the same global set, unaffected by the modal's scope.

## Not Included

- Automations that read, create or move Kanban tasks, and any new trigger or action of any kind
  — `deferred` (its own todo).
- GitHub Projects integration, and any change to the existing GitHub issue sync — `declined`.
- Promoting either surface out of a modal into a first-class or dockable surface — `declined`.
- Changes to the board's columns, card design, filters or sorting — `declined`.
- Changes to the sidebar filter's own semantics, persistence or clear-on-cross-project-activate
  behavior — `declined`.
- Per-project pending-interaction counts, which the daemon does not expose — `deferred`.
- The mobile client — `platform` (separate repo and PR).

## Edge cases

- **The sidebar filter names a deleted project.** Treated as unset; the seeding rule falls
  through to the active session's project.
- **The scope's project is removed while its modal is open.** The modal falls back to its
  unscoped state — the pick-a-project state for the board, "All projects" for the library.
- **Zero projects exist.** Both modals open on an empty state that says there is no project yet;
  the picker lists nothing.
- **A scope change lands mid-load.** The modal shows the newly picked project's data; a slower
  response for the previous project never replaces it.
- **The scope has no tasks or no automations.** The existing empty state renders, and the header
  still names the project — an empty board is not the same as an unresolved scope.
- **Quick-add opened while the board is open on a different picked project.** Quick-add uses its
  own seed, so the two can differ; the quick-add dialog names the project it will write to.
- **A task is created in quick-add while the board shows another project.** The board does not
  gain the task; reopening the board on that project shows it.
- **Escape or close during a pick-a-project state.** The modal closes and nothing is remembered;
  the next open re-runs the seeding rule.

## Acceptance criteria

1. With a session open in project A and project B selected in the sidebar switcher, opening the
   Kanban modal shows project B's tasks, and the modal header names project B.
2. Under the same conditions, the Automations library lists project B's automations plus the
   automations that belong to no project, and its header names project B.
3. Each modal's header has a project picker; activating it lists the available projects, and
   choosing one changes what that modal shows.
4. After a scope change in either modal, no task or automation belonging to the previous project
   is present in the modal's list.
5. After changing the project inside a modal, the sidebar project switcher's selection is
   unchanged.
6. After changing the project inside one modal, opening the other modal shows the project the
   sidebar filter names, not the first modal's pick.
7. Closing a modal after an in-modal change and reopening it shows the sidebar filter's project
   again; the same holds after a webview reload and after an app restart.
8. Activating a different session while a modal is open leaves that modal's header and list
   unchanged; changing the sidebar filter while a modal is open does the same. Closing and
   reopening the modal then shows the new seed.
9. Creating, editing, moving and deleting a task while the board shows project B writes to
   project B: reopening the board on project B shows the change, and project A's board does not.
10. Creating an automation while the library shows project B saves it to project B, and the
    editor's skills, files and branch choices are project B's.
11. With no session open, or with a projectless draft active, and the sidebar filter on "All
    projects", clicking the sidebar Kanban entry opens a dialog: the board scoped by the seeding
    rule when a project resolves, otherwise a list of projects to pick from. The click never
    leaves the screen unchanged.
12. In that same state, the quick-add shortcut opens the quick-add dialog: scoped when a project
    resolves, otherwise showing the same project list. It is never a no-op, and no dialog appears
    later without a further user action.
13. With the Automations editor, details or run view open, the library's project picker is not
    operable; returning to the library makes it operable again.
14. The sidebar's automations pending badge is present after boot with both modals never opened,
    and its presence is unchanged by a scope change in either modal.
15. Every interactive element added by this work carries a `data-testid` of the form
    `<surface>-<element>`, keyed by project id or task id where per-row, never by array index.
16. Unit tests cover the seeding rule for four inputs: sidebar filter set to a live project;
    sidebar filter set to an id no longer in the project list; sidebar filter unset with an
    active session's project available; neither resolvable.
17. A unit test asserts that an in-modal scope change leaves the sidebar filter's stored value
    untouched.
18. New and changed core logic ships with tests; any daemon route added or changed validates its
    input with Zod, returns the `ok`/`fail` envelope, has tests, and keeps Rust daemon parity. No
    daemon change is expected — the todos endpoints and the automations list filter are already
    project-parameterised.

## Decisions

1. **The title means project scope for both sidebar surfaces, not automations that drive Kanban
   tasks.** Verified: triggers today are schedule, event and webhook, and the action catalog has
   no task action, so task-driven automation is separate work. `reversible`
2. **Both surfaces stay modal dialogs, each with its own in-modal picker.** User-confirmed in the
   brief's feedback, not this lane's call. `hard-to-reverse` (it fixes the surface model this
   work builds on)
3. **The in-modal scope is ephemeral, per-open, and never propagates.** User-confirmed in the
   brief's feedback, overruling an earlier shared-persisted-scope proposal. It rules out a stored
   per-modal scope and a shared "last project". `hard-to-reverse` (persisting it later would
   change what every reopen shows)
4. **The seeding chain is sidebar filter, then active session's project, then the only project,
   then unscoped.** Both surfaces already resolve the active session's project, so the fallback
   is the smallest change, and selecting a project in the sidebar already activates that
   project's most recent session, so the two rarely disagree. `reversible`
5. **A sidebar filter naming a missing project is treated as unset.** The filter is raw persisted
   state and can outlive the project it names; falling through beats opening on nothing.
   `reversible`
6. **Unscoped means "All projects" for Automations and pick-a-project for Kanban.** A board that
   mixes projects has no meaningful columns; a library that does has a project badge per row
   already. `reversible`
7. **Correction to the brief:** it says a projectless Automations library "falls back to the
   unscoped set". The daemon returns *everything* when no project is given — every project's
   automations plus the ones scoped to none. The behavior above is written against the daemon's
   actual response, which is what decision 6 needs anyway. `reversible`
8. **The in-modal picker looks like the welcome screen's project chip:** an avatar-and-name chip
   in the header that opens a list of avatar-and-name rows. Closest shipped pattern for
   "displays the project and changes it", per the delegated design direction. `reversible`
9. **The pick-a-project state looks like the import dialog's first step:** a plain list of
   projects, one row each, avatar and name. Closest shipped pattern for "no project yet, choose
   one". `reversible`
10. **Quick-add with no resolvable project shows the picker rather than being disabled.** One
    rule for both task surfaces, and a keyboard shortcut that opens a dialog explaining what to
    do beats one that does nothing. `reversible`
11. **Quick-add does not inherit an open board's picked project.** It is its own open, and the
    brief's "override never propagates" rule applies to it too. `reversible`
12. **The Automations picker is unavailable while a sub-view is open.** Re-scoping under an
    unsaved draft would retarget where it saves and which skills, files and branches it offers.
    `reversible`
13. **The pending-interaction count stays global in both places.** Neither the list call nor the
    interaction summary carries a project, so per-project counts are not available without a
    daemon change, which this work does not make. `reversible`
14. **No daemon change.** The todos endpoints are project-keyed and the automations list takes a
    project filter, so the change is where the project id comes from, not the call shape. Any gap
    found in implementation must be additive — the contract is co-owned by the mobile submodule.
    `hard-to-reverse` (a contract change would need its own review and a mobile PR)
