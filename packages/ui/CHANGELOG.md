# @qlan-ro/mainframe-ui

## 2.1.0

### Minor Changes

- [#674](https://github.com/qlan-ro/mainframe/pull/674) [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix "Run an action" steps, which could not be configured at all. The daemon described each action's parameters as JSON Schema while the editor expected a different shape, so every action rendered an empty form — no script field for Run command, no URL for an HTTP request — and the step saved with no parameters and failed when it ran. The daemon now publishes the field descriptions the editor actually needs, so the form appears.

  Two bugs fell out of making both sides share one schema. A custom working directory for Run command was written under a key the engine never read, so filling it in produced "path required" while the path sat there on screen. And "Treat output as" was tied to Run command specifically, so Read file silently lost the setting it also supports.

  The action catalog now also says whether an action is safe to repeat, which turns the Retry block's warning from a blanket disclaimer into a specific one: it names the steps that would run twice — "Retrying will run these again: Open a pull request" — and disappears entirely when everything in the block is safe.

  One removal worth noting: Notion's column picker was demonstration data with nothing behind it, offering databases and columns that did not exist. It is gone until there is a real lookup; the step takes explicit key/value pairs, as it always did in practice.

- [#674](https://github.com/qlan-ro/mainframe/pull/674) [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Automations can now run a `repeat` block's iterations concurrently. Set `concurrency` and a fan-out of agents starts together instead of one after another — the shape a review panel or a per-item agent sweep actually wants. Absent or `1` leaves the sequential path untouched.

  The engine could already hold several places at once — restarting a daemon re-attaches every waiting agent, cancelling a run reaches all of them, and checkpoint writes are transactional. What it couldn't do was start the second branch: the walker stopped at the first step that had to wait, and an agent in flight is a step that has to wait. It now starts every branch before parking, and converges as each one settles.

  Two supporting changes were needed to make that honest. A run's wake-up deadline used to be a single value, so two branches waiting on different deadlines would silently lose one; each waiting step now carries its own, and the run-level value became a cheap filter over them. And a branch that fails while its siblings are still running no longer ends the run underneath them — the run waits for every branch to settle before reporting, so an agent is never left working on a run the user already sees as finished.

  Also fixes a bug from the preceding blocks: a step lookup didn't descend into `loop` or `retry` bodies, so an `ask_agent` inside one silently lost its `expects` output contract — the JSON was never parsed and downstream tokens resolved to nothing while the step still reported success. The same gap made `keepGoing` and restart-safety decisions read the wrong values inside those blocks.

- [#674](https://github.com/qlan-ro/mainframe/pull/674) [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a condition loop and a `break` step to Automations. `repeat` walks a list resolved once before it starts, so it can't poll or converge; the new `loop` re-tests its condition before every pass and comes in `while` and `until` flavours, which is what "keep checking until the build is green" needs. `break` leaves the innermost loop early, from inside an `if` arm too.

  Two rules are worth knowing. Before the first pass there is nothing for a condition about the loop's own body to read, so an unresolved condition there runs the pass — without that, "repeat while the build is running" would exit before running anything. And a loop must declare how many passes it may run: exhausting that ceiling fails the block rather than continuing quietly, because a poll that never went green must not read as one that did.

- [#674](https://github.com/qlan-ro/mainframe/pull/674) [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a `parallel` block to Automations, and a control for running a repeat's iterations at once.

  `parallel` runs branches you author separately — review this diff while drafting the release note while checking the build — rather than the same steps once per item. Branches all start before the block waits, and a failing branch doesn't cut its siblings off partway; the block reports once every branch has settled.

  The concurrency setting on `repeat` shipped in the engine last release with no way to set it. It now has one, defaulting to one-at-a-time, which is what every existing automation already does.

  Both carry the same caveat, stated in the editor and the guide: steps that _wait_ — agents, forms, waits — genuinely overlap, while local work inside a single branch still runs one step at a time. Concurrency here is about how many chats can be outstanding, not about making commands faster.

  Also fixes the read-only Details pane, which rendered nothing at all for `loop` and `retry` blocks — they were added without teaching that view they exist.

- [#674](https://github.com/qlan-ro/mainframe/pull/674) [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Connect real accounts to Automations. Notion and Azure DevOps take a token you paste; GitHub signs in through a code you approve in the browser, once an OAuth App is registered for it.

  Until now "Connect" stored a placeholder string and showed a connected badge, so both token connectors looked ready and failed when they ran.

  Credentials now live in the OS keychain rather than a file on disk, and existing stored credentials move there on first start.

  Azure DevOps asks for an organization-scoped token, and says so — Microsoft stops issuing the older account-wide tokens in March 2026 and retires them in December. Notion explains why its token is manual: its API needs a server-side secret a desktop app cannot hold.

  The GitHub actions no longer need the `gh` command-line tool installed and signed in. Automations that already use them keep working without being re-edited.

- [#674](https://github.com/qlan-ro/mainframe/pull/674) [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a `retry` block to Automations: wrap steps that fail transiently and they run again, up to a declared number of attempts, with the run failing on the last attempt's error rather than the first.

  Each attempt runs in its own frame and records its outcome, which is what makes it correct rather than merely convenient — the walk treats an already-failed step as settled, so a retry that inferred its state by replaying would skip the failed step and report success. That bookkeeping also lets a run interrupted mid-retry resume on the right attempt instead of starting over, and it stays out of the run timeline, since it is engine state rather than a step anyone wrote.

  One thing the editor says plainly rather than guarding: every attempt re-runs the whole body, including steps that already had an effect. A retry around "open a PR" opens a second one. The engine's idempotence flag is internal and never reaches the editor, so a check here would half-work; the honest version is the warning next to the field.

- [#674](https://github.com/qlan-ro/mainframe/pull/674) [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a `wait` step to Automations, so a run can pause for a fixed delay and carry on. It parks on the run's checkpoint rather than holding a timer, which costs nothing while waiting and survives a daemon restart — a run interrupted mid-wait resumes on schedule instead of losing the delay. Durations are set as an amount plus a unit and stored canonically in seconds, capped at seven days, since anything longer is a unit mix-up far more often than an intent.

  This also fixes a latent bug it depended on: the sweep that resolves a run's `wakeAt` was never armed at boot, so `ask_agent` timeouts could not fire and a hung agent step waited forever. Arming that sweep enforces those timeouts for the first time.

- [#674](https://github.com/qlan-ro/mainframe/pull/674) [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Anything running on this machine can now raise a Mainframe notification, not just a step inside an automation run. Work that an automation launches — a todo lane, a script, a scheduled job — reaches the desktop and your phone the same way an automation's own `notify` step does.

  This closes a gap that made scheduled work silent: a lane invoked from an automation runs as a CLI session, which has no notification tool of its own, so it had no way to say a stage had started or finished.

### Patch Changes

- [#669](https://github.com/qlan-ro/mainframe/pull/669) [`91c18fe`](https://github.com/qlan-ro/mainframe/commit/91c18fe23da189f5d76cd76acdcb1a469cb10d1f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep a session row's hover card tied to the pointer: clicking a row no longer pops the card open half a second later and leaves it wedged over the sidebar, two rows can no longer sit open at once, and a right-click now gets a context menu that Escape actually closes.

- [#671](https://github.com/qlan-ro/mainframe/pull/671) [`ae77a83`](https://github.com/qlan-ro/mainframe/commit/ae77a839f28b4a9c18f830bc3ca9be72c370b10d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebuild the first-run tour as a nine-step walk of the app — projects, sessions, the sessions list and tabs, the session rail, the workspace, ⌘K, Kanban, Automations and the daemon zone. It replaces a four-step tour that skipped from step 1 to step 4, because two of its steps pointed at a composer the empty workspace never mounts. The tour now waits for a first project before opening, so every step has something real to point at, and the counter is derived from the steps it can actually show. The first-run screen says the tour is coming, so the wait reads as promised rather than missing.

- Updated dependencies [[`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b)]:
  - @qlan-ro/mainframe-types@2.1.0
