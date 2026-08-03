# Todo #243 — Install and uninstall skills from the Setup Advisor

Spec for a Skills section in the Setup Advisor dialog that installs and uninstalls skills by
running the `skills` CLI on the daemon host. Route: full. The design direction recorded on
todo #243 (rewritten 2026-07-29) is an approved gate outcome and is honored below; nothing in
the codebase contradicts it.

Supersedes the scope PR 535 shipped (a skill viewer and deleter), which the user rejected on
2026-07-29. Browsing, inspecting and delete-with-confirm are not this deliverable.

## Problem

Mainframe can read skills but cannot install one. Every skills surface in the app — the
composer's `/` popover, the sidebar's Skills tab — is a read-only view of whatever already
sits on disk. The `skills` CLI is how the ecosystem actually installs them; this repository's
own skills arrived that way. So adding a skill to a project means leaving the app, finding a
terminal on the machine the project lives on, and running a command by hand — and on a remote
daemon, that machine is not the user's laptop.

Removing one is worse. A daemon route that deletes a skill's directory exists but nothing in
the UI calls it, and for a CLI-installed skill it is the wrong tool: it deletes the payload
directory and leaves a dangling link in the agent directory plus a stale entry in the CLI's
lockfile. There is no supported way to undo an install from inside the product.

## Behavior

**Two sections in the advisor.** The Setup Advisor dialog gains top-level section navigation:
Recommendations (the existing body, and the default) and Skills. The control is a segmented
pill group in the dialog header, on the opposite side of the header divider from the in-body
category tab strip and made of visibly different material, so the two levels never read as one
control — neither is renamed. A caller can open the dialog directly on either section; the
toolbar button opens on Recommendations. Nothing about the section choice persists across
opens. Every existing advisor behavior is unchanged: the report still fetches on the open
rising edge (including when a caller opens straight onto Skills), still refetches and drops
the stale report when the project changes while open, and the category tabs, per-row copy,
copied-count footer, loading/error/empty/retry states and daemon-switch reset all behave as
they do today.

**The Skills section is two bands.** An Install band on top, the installed manifest below,
separated by the app's section-header eyebrow and nothing heavier. The body scrolls inside the
dialog's own column; the section never introduces its own fixed height.

**Install band.** One row that reads left to right as a single sentence of work: a source
field, a skill picker, a project/global scope pair, and an Install button. The source field
accepts a GitHub `owner/repo` shorthand, a full GitHub or GitLab URL, an SSH-form repository
address, or a URL pointing at one skill inside a repository. At a narrow dialog width the row
wraps to two lines — source on the first, picker, scope and button on the second. It never
scrolls horizontally.

Its states:

- *empty* — picker and Install both disabled.
- *probing* — leaving the source field or pressing Enter probes the source; the picker shows a
  spinner and Install stays disabled. The probe never fires per keystroke: it clones a
  repository.
- *probed* — the picker lists the skills that source offers. Install enables once at least one
  skill is selected. A selection is always required; there is no "install everything".
- *probe failed or unreadable* — an inline message under the field, and the picker degrades to
  manual skill-name entry so the user can still install by name. Never to a printed command.
- *rejected input* — a source that is empty, starts with `-`, is a local filesystem path, or
  points at a host outside the allowlist produces an inline message under the field and no
  process runs.
- *installing* — Install shows a running state, and the whole band plus every manifest row's
  Uninstall goes disabled until the operation resolves.

**Manifest.** One row per skill the CLI has installed for this project, with project-scope and
global-scope entries merged into a single list. Each row is one line: the skill's name, its
source and its scope as chips, then Uninstall in a slot that is reserved whether or not the
button is showing a running state, so a row entering that state does not reflow its
neighbours. While the manifest loads, the section shows skeleton rows rather than a spinner in
an empty box. With nothing installed it reads "No skills installed by the CLI", in the
advisor's existing empty-state voice, not as an error.

**Install and uninstall are buttons that do the thing.** Pressing Install runs the CLI's add
command on the daemon host. Pressing Uninstall runs its remove command with that row's name
and the scope the row records. No command is rendered anywhere in this section for the user to
copy — not in the empty state, not in a failure, not when the CLI is missing.

**One operation at a time.** While a command runs for a project, a second install or uninstall
for that project is refused rather than queued or started. The refusal is enforced on the
daemon, not only by the disabled controls, and a refused request says so plainly.

**Results are summarized, not streamed.** No CLI output appears live. On success the section
raises a success toast and re-reads the manifest from the daemon. On failure — a non-zero
exit, a failure to start the process, or a timeout — the section raises a visible error and
shows the tail of the CLI's output, cleaned of terminal control characters, in an expandable
block inside the section so it survives the toast being dismissed. The displayed manifest is
always re-read after an attempt, never guessed at: what the section shows is what the daemon
reports. No failure is silent.

**The rest of the app catches up.** After a successful install or uninstall, the composer's
`/` popover and the sidebar's Skills tab — including its count badge — reflect the change
without an app reload. The sidebar tab itself stays read-only, carries no install or uninstall
control, and gains one link that opens this section.

**When the CLI is not there.** If neither the `skills` executable nor the package-runner
fallback resolves on the daemon host, the section is replaced by one explanatory block naming
both, and — when the active daemon is remote — saying the check applies to the daemon host,
not this computer. The install and uninstall controls are absent, not disabled. There is no
copyable command, no suggestion row, and no button that installs the CLI. The section is
neither hidden nor presented as an error.

**Adapters other than Claude.** The install still runs; the section states plainly that the
app's own skill views reflect Claude today. An unknown adapter is treated as Claude, matching
what the sidebar tab already does.

**No active project.** The existing gate is unchanged: with no active project the dialog does
not open at all, for either section.

## Not Included

- `declined` — Browsing, searching, inspecting or rendering skill content, and scope grouping
  or filtering over the full skill set. This was PR 535's deliverable and the user rejected it.
- `declined` — A copyable command anywhere in the section, a dismissible CLI-suggestion row,
  and an install-the-CLI button. The 2026-07-29 feedback rules a printed command out by
  construction.
- `declined` — A confirmation dialog before uninstall. Rejected with the rest of PR 535's
  delete flow; the running state and the result are the feedback.
- `deferred` — The daemon's existing skill list and delete routes stay as they are and are not
  called from this section. Deleting hand-authored (non-CLI-managed) skills from the app, and
  the delete route's behavior on symlinked or command-group entries, are separate todos.
- `deferred` — Creating or editing skills in-app, and the CLI's init, use, update, find and
  sync commands.
- `deferred` — Installing the `skills` CLI itself, and any bundling or vendoring of it.
- `deferred` — Streaming live CLI output, or any terminal-emulating output view. The tail of a
  failed run is all this iteration shows.
- `deferred` — A registry or marketplace browser, skill sharing, and any account or telemetry
  opt-out work.
- `deferred` — Enable/disable or per-chat skill activation state.
- `deferred` — Managing agents (the sibling Agents tab). Same pattern, separate todo.
- `deferred` — Moving any other surface into the Setup Advisor. This adds exactly one section.
- `deferred` — Changing the recommendation engine, its rules, its categories, or the
  recommendations view's content.
- `deferred` — The automations trigger field's own skills fetch. It is a third consumer of the
  skills list that the brief did not account for; it refetches when its editor mounts and does
  not subscribe to the new revalidation signal.
- `platform` — Any Node-daemon parity work. The Rust daemon is the only runtime; there is no
  second implementation to mirror.
- `platform` — Suppressing the CLI's own install telemetry. Noted, not solved.

## Edge cases

- **Source names a repository with one skill.** The picker still requires an explicit
  selection; a single-entry list is pre-selectable but never implicit.
- **Probe returns no skills.** The picker says so and Install stays disabled; this is not an
  error state and does not fall back to manual entry.
- **Probe output cannot be parsed.** The picker degrades to manual skill-name entry. The
  install then runs with exactly the names typed.
- **Skill name contains spaces or dots.** Accepted. The repository's usual identifier rule is
  too strict here — the CLI's own documented examples include a name with spaces.
- **Skill name starts with `-`, or contains control characters.** Rejected before any process
  runs; it would otherwise be read as a flag.
- **Source is a local filesystem path.** Rejected. The daemon serves remote clients, so a local
  path would let a caller aim the CLI at arbitrary content on the daemon host.
- **Install succeeds but the skill does not appear in the composer or sidebar.** Possible when
  the CLI targets an agent whose directories the app does not scan. The manifest still shows
  the row; the section's adapter note explains that the read views reflect Claude.
- **Uninstall of a row whose files are already gone.** The CLI's own exit status decides:
  zero is a success and the manifest simply loses the row; non-zero surfaces the tail.
- **A command hangs.** The bounded timeout resolves it as a failure with the captured tail; the
  section does not stay in a running state indefinitely.
- **The dialog is closed mid-operation.** The daemon operation is not cancelled by closing the
  dialog; reopening the section shows the manifest as the daemon then reports it.
- **The project is switched while the section is open.** The manifest reloads for the new
  project, and the concurrency guard is per project, so a run for the previous project does not
  block the new one.
- **The CLI prompts unexpectedly.** Standard input is closed, so it fails fast rather than
  hanging; the failure carries the tail that shows the prompt.
- **Two skills from different sources share a name.** Rows are distinguished by name and scope
  together; an uninstall targets the scope its row records.
- **The daemon switches while the section is open.** The section re-reads for the new daemon,
  including the CLI-availability outcome, which can differ per host.

## Acceptance criteria

1. Opening the Setup Advisor from the toolbar shows a segmented control in the dialog header
   with Recommendations and Skills, lands on Recommendations, and the toolbar button's
   `data-testid` is unchanged from its current value.
2. All six existing advisor `data-testid` values are present and unchanged, verified by a grep
   assertion in a test; the existing advisor host and sheet tests pass without edits to their
   assertions.
3. A test asserts the advisor's open action normalizes any argument that is not a known section
   to Recommendations, and that the toolbar's click handler cannot pass its click event through
   as a section.
4. Opening straight onto the Skills section still triggers the recommendation report fetch, and
   a project switch while open still clears the stale report and refetches — asserted by test.
5. The Skills section lists the CLI-managed skills for the active project with project-scope
   and global-scope entries merged, each row showing name, source and scope, each row's
   `data-testid` derived from the skill's name and scope, never from an array index.
6. Entering a source and pressing Install runs the CLI's add command on the daemon host with
   explicit skill names, an explicit agent, an explicit scope flag and the skip-prompts flag —
   asserted against a faked runner that records the exact argument vector, proving no shell
   string is built and no argument derived from user input begins with `-`.
7. Pressing Uninstall on a row runs the CLI's remove command with that row's skill name, the
   row's scope flag, the agent and the skip-prompts flag, argument-vector-asserted the same
   way.
8. Neither the telemetry-metadata flag nor any `--dangerously-accept-*` flag appears in any
   recorded argument vector, asserted by test.
9. A source that is empty, begins with `-`, is a local filesystem path, or names a host outside
   the allowlist is rejected with a visible message and spawns no process — asserted at the
   daemon route and in the UI, and the daemon test asserts the runner was never invoked.
10. While a command runs, its control shows a running state, the Install band and every row's
    Uninstall are disabled, and a second install or uninstall request for the same project
    returns a failure envelope naming the in-flight operation rather than starting a second
    process — the refusal asserted daemon-side, independently of the disabled controls.
11. A zero-exit install and a zero-exit uninstall each produce a success toast and a manifest
    re-read, and each makes the change visible in the composer `/` popover and in the sidebar
    Skills tab including its count badge, with no app reload — asserted by test.
12. A non-zero exit, a spawn failure and a timeout each produce a visible error carrying the
    ANSI-stripped output tail in an expandable block that survives dismissing the toast, leave
    the rendered manifest equal to what the daemon returns on re-read rather than a locally
    mutated list, and are logged daemon-side. No catch on the path is silent.
13. When neither the `skills` executable nor the package-runner fallback resolves, the manifest
    route returns a CLI-unavailable outcome the client can distinguish from a generic failure,
    and the section renders the explanatory block with no install or uninstall controls in the
    DOM and no copyable command anywhere in the section; the section is neither hidden nor
    rendered as an error state. When the active daemon is remote, the block's copy names the
    daemon host.
14. The four new daemon routes take a project id and resolve the project path server-side; a
    request carrying a filesystem path in place of a project id is rejected. All four return the
    standard `ok`/`fail` envelope.
15. Rust tests cover: manifest merge across both scopes, the CLI-unavailable outcome, argument
    construction for install and uninstall, non-zero-exit mapping to the failure envelope with
    the captured tail, source and skill-name rejection, and the per-project concurrency refusal.
16. The child process is started with array arguments and no shell, with the boot-resolved
    login-shell PATH in its environment, the project path as its working directory, standard
    input closed, a bounded timeout, capped output capture and kill-on-drop — each asserted or
    inspected by test.
17. UI tests, each run as a single file, cover: section navigation, manifest render, source
    probe, install success, uninstall success, install failure, the CLI-unavailable state, and
    revalidation of the composer and sidebar surfaces after a successful operation.
18. The sidebar Skills tab renders no install or uninstall control and renders one link that
    opens the advisor on the Skills section — asserted by test.
19. Every interactive element added by this change carries a `data-testid` in
    `<surface>-<element>` kebab-case.
20. Every file touched or added by this change is under 300 lines and every function under 50.
21. `cargo test -p mainframe-server` and the touched UI test files pass; the UI package
    typechecks. `packages/core-rs` is the only daemon runtime touched.
22. Neither `.claude/skills/mainframe-design-system/SKILL.md` nor
    `.claude/skills/mainframe-design-system/references/recipes.md` names `MainToolbar` on a line
    mentioning `CHIP_BASE` or in the heading of the block that defines it; both name
    `components/ui/chip.ts` as the chip recipe's home. `ICON_BTN` still resolves to
    `layout/MainToolbar.tsx` in `recipes.md`, and `grep -rn CHIP_BASE packages/ui/src` shows no
    definition outside `components/ui/chip.ts`, `TagFilterBar.tsx` and automations'
    `ChipButton.tsx`.
23. The PR includes a changeset.

## Decisions

Hard-to-reverse first.

1. **The execution door is a new set of daemon endpoints, not a Tauri shell command.**
   `hard-to-reverse` — the project lives on the daemon host and remote daemons are first-class,
   so a Tauri command would install onto the user's laptop where a remote project's agents
   would never see the skill; the daemon also already owns the login-shell PATH and this exact
   shape of child spawn, while the Tauri shell registers no exec command at all.
2. **The four routes are keyed by project id and resolve the path server-side; they never accept
   a caller-supplied filesystem path the way the older skill routes do.** `hard-to-reverse` —
   the REST surface is co-owned with the mobile submodule and a path-taking route cannot be
   tightened later without breaking callers; a daemon that serves remote clients must not take
   a host path from the wire.
3. **The section's data source is the CLI's own install manifest, and uninstall goes through the
   CLI's remove command — the existing daemon skill-delete route is neither called nor
   surfaced here.** `hard-to-reverse` — it defines what a row is and what uninstall means; the
   delete route removes the canonical payload directory, which for a CLI-installed skill leaves
   a dangling link and a stale lockfile entry, while the CLI cleans all three.
4. **The previous "no new daemon endpoints" acceptance criterion is lifted.** `hard-to-reverse`
   — a user ruling in the 2026-07-29 feedback; recorded so it is not re-litigated, and because
   any plan that re-derives "cannot execute, therefore print the command" is wrong by
   construction.
5. **The wire verbs are the CLI's `add` and `remove`; the lockfile-restore command is never
   used.** `reversible` — the brief verified this against the shipped CLI; the user-facing
   labels stay Install and Uninstall, so the wire choice is invisible and cheap to correct.
6. **The CLI is absent from the machine this spec was written on, so its argument contract is
   adopted from the brief as verified rather than re-derived; implementation pins it with
   argument-vector tests against a faked runner, not against a live CLI.** `reversible` — the
   tests then fail loudly if the contract was wrong, which is the only check available without
   the binary. This is the spec's largest open risk.
7. **Output is summarized, not streamed.** `reversible` — the CLI draws a spinner TUI with
   cursor-control escapes and offers no machine-readable mode for add/remove, so a line view
   would show garbage; a live console can be added later as a separate surface.
8. **A failure shows a toast plus the ANSI-stripped tail in an expandable block inside the
   section, and the manifest is always re-read rather than optimistically mutated.**
   `reversible` — a toast alone loses the diagnostic the moment it dismisses, and an optimistic
   list can disagree with the daemon after a partial failure.
9. **Install always sends explicit skill names; the CLI's install-everything shorthand is never
   used.** `reversible` — one click would otherwise pull a whole repository's skills.
10. **The source probe fires on blur or Enter, never per keystroke.** `reversible` — it clones a
    repository.
11. **An unparseable probe degrades to manual skill-name entry, never to a printed command.**
    `reversible` — the probe's output is TUI text, not JSON, so it will eventually drift; the
    user must still be able to install.
12. **Scope is a two-value choice defaulting to project on install; uninstall uses the scope its
    row records, and both scopes appear in one merged, labeled manifest.** `reversible` —
    adopts the brief; project is the safer default and merging keeps the list one thing.
13. **No confirmation before uninstall.** `reversible` — the user rejected the confirm flow with
    the rest of PR 535, and the manifest records the source, so the action is reversible; the
    running state and the result are the feedback.
14. **CLI-unavailable renders an explanatory block naming both the executable and the
    package-runner fallback, with no controls, no copyable command and no install-the-CLI
    button.** `reversible` — installing the CLI is out of scope, and a printed command is the
    rejected pattern.
15. **The CLI agent target is derived server-side from the active adapter, defaulting to Claude
    for an unknown adapter, and never taken as free text from the caller.** `reversible` —
    mirrors the sidebar tab's fallback and keeps an install landing where the app's read
    surfaces look; caller-supplied agent text would be another injection edge.
16. **One CLI operation per project, refused daemon-side.** `reversible` — the CLI writes a
    project lockfile and two runs would race it; the UI's disabled controls are a second guard,
    not the guard.
17. **Skill names accept spaces and dots and reject a leading `-` and control characters — a
    deliberate deviation from the repository's `^[a-zA-Z0-9_-]+$` identifier rule.**
    `reversible` — the CLI's own documented examples include a name with spaces, so the strict
    rule would reject valid installs; the injection risk the rule guards is covered by the
    leading-`-` and control-character checks plus array-argument spawning.
18. **Sources accept `owner/repo`, `https://` URLs on a host allowlist, and the SSH form; local
    filesystem paths are rejected in this iteration.** `reversible` — loosening later is
    additive, and a local path on a remote-serving daemon points the CLI at arbitrary host
    content.
19. **Input validation lives in the Rust route as explicit checks; there is no Zod layer,
    because there is no TypeScript endpoint left to put one on.** `reversible` — the repository
    rule predates the Rust cutover and the UI's API wrappers validate nothing today; recorded
    rather than silently skipped, and the route tests carry the rejection cases instead.
20. **No section persistence; the dialog always opens on Recommendations unless a caller asks
    for Skills.** `reversible` — keeps the dialog's existing fresh-open semantics.
21. **The recommendation report still fetches when a caller opens straight onto Skills.**
    `reversible` — one unread fetch is cheaper than perturbing a working advisor behavior and
    its existing tests.
22. **The revalidation signal has exactly three subscribers: this section's manifest, the
    composer `/` trigger provider and the sidebar Skills tab. The automations trigger field —
    a third skills consumer the brief missed — does not subscribe.** `reversible` — verified in
    the codebase; it fetches when its editor field mounts and is never on screen behind the
    advisor's modal dialog, so a subscription would buy nothing.
23. **Half of the toolbar chip-recipe extraction landed on main and is out of scope; the two
    design-system doc pointers did not land, and this spec fixes them.** `reversible` — the
    shared module exists (`components/ui/chip.ts` exports `CHIP_BASE`; `layout/MainToolbar.tsx`
    now only imports it), so re-doing that half would be a no-op diff. Both doc pointers still
    name `layout/MainToolbar.tsx` as the recipe's home — the skill's Chip / pill table row and
    the `CHIP_BASE` block under its `Toolbar chrome — layout/MainToolbar.tsx` heading — so each
    sends a reader to a file that no longer defines the recipe. That skill loads on every
    `packages/ui` task, including this one, and this section renders chips on that recipe, so
    the staleness costs on the first task that trusts it. The pointers are re-derived, not
    lifted: the abandoned branch pointed them at `components/ui/chip-classes.ts`, a path that
    does not exist on main. `ICON_BTN` genuinely still lives in `MainToolbar.tsx`, so only the
    chip lines move.
24. **The advisor's open action takes an optional section and normalizes anything else to
    Recommendations, and the toolbar's click handler is fixed to stop passing its click event
    as that argument.** `reversible` — the current handler is wired directly to the open
    action, so the arity change would silently turn a React event into a section value.
25. **The CLI's own install telemetry is left alone; the telemetry-metadata flag is never
    passed.** `reversible` — suppressing a third-party tool's reporting is its own decision and
    is not made here.

## Revision — 2026-08-03

User decision after seeing the section running. The original text above is left intact; this
section supersedes it where they conflict. Implementation plan:
`docs/plans/2026-08-03-todo-243-skills-browse-plan.md`.

**The declined browsing scope is overturned.** "Browsing, searching, inspecting" was declined in
*Not Included* as PR 535's rejected deliverable. That rejection was about inspecting and deleting
skills already on disk. Discovering skills that are *not* yet installed is a different capability,
and without it the section can only install something the user already knows the name of.

**The section's top-level control is Browse and Installed, not project and global.** Scope stays a
two-value choice but moves onto the install action, where the choice is made. Decision 12 above is
amended in that respect only; the merged manifest and the row-recorded uninstall scope are unchanged.

**Browse is backed by the skills.sh registry, through the daemon.** Before a query it lists the top
50 of the registry's all-time ranking. Any query goes to the registry's search API, so skills
outside that top 50 are reachable — the ranking is a starting point, not the boundary of what can be
installed. Both calls are proxied by the daemon; the renderer never reaches the registry directly.

**The source-and-probe install path stays** as a secondary affordance inside Browse. It is the only
route to a private, unlisted or self-hosted repository, which a registry cannot serve.

**The registry is a best-effort source, never a dependency.** The all-time ranking is extracted from
the registry homepage's server-rendered payload, which is someone else's implementation detail. When
extraction fails, Browse falls back to search-only and says nothing alarming; the section keeps
working.

Additional acceptance criteria:

24. The manifest route returns the host's real CLI-installed skills when the resolved CLI is the
    package-runner fallback whose stderr carries warning lines — asserted by a Rust test whose fake
    outcome puts valid JSON on stdout and `npm warn` lines on stderr. This fails on the code as
    shipped in the first pass, where stdout and stderr are concatenated before the JSON parse.
25. With no query, Browse renders the top 50 catalog entries and not the 51st. With a query of at
    least two characters it renders the search API's results, including a skill absent from the
    catalog — asserted by test, since reachability beyond the ranking is the point of the split.
26. A query under two characters issues no outbound request; the daemon rejects it before the
    round trip.
27. When catalog extraction fails, the catalog route returns an outcome the client distinguishes
    from a generic failure, Browse renders search-only with no error surface, and the failure is
    logged daemon-side. The parser is covered by a fixture-backed unit test, and a payload missing
    the expected key returns that outcome rather than an empty success.
28. Neither the catalog nor the search call is made from the renderer; both go through the daemon.
29. Every interactive element Browse adds carries a `data-testid` keyed by the skill's source and
    id, never an array index.
